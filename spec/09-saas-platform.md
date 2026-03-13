# 09 - SaaS Platform

Megatest is offered as a hosted SaaS at megatest.dev. The source code is also open source and can be self-hosted via Docker Compose. This spec covers the platform layer required for multi-tenant SaaS operation: the tenant model, pricing tiers, quota enforcement, metered billing, resource isolation, rate limiting, data retention, and admin tooling.

---

## 1. Overview

The SaaS platform layer sits between the core Megatest engine (worker, API, storage) and the outside world. Its responsibilities:

- **Tenant boundaries** -- organizations own projects, users, and billing.
- **Pricing enforcement** -- free, pro, and enterprise tiers with per-tier limits.
- **Usage metering** -- counting screenshots, runs, and storage per billing period.
- **Billing integration** -- Stripe subscriptions and metered usage reporting.
- **Resource isolation** -- per-org concurrency, per-project serialization, container limits.
- **Rate limiting** -- per-tier API and webhook rate limits.
- **Data retention** -- automated purging of expired run data.
- **Admin tooling** -- internal endpoints for platform operators.

When self-hosting, the platform layer is present but inert: a single organization is created during setup, all limits are disabled, and billing is not wired up.

---

## 2. Tenant Model

### Organizations

Organizations are the top-level billing and access boundary. Every project, every run, and every screenshot belongs to exactly one organization.

```sql
-- See spec 03 for the full schema. Key columns:
-- organizations.id           UUID
-- organizations.slug         TEXT UNIQUE (immutable URL-safe identifier)
-- organizations.name         TEXT (display name, mutable)
-- organizations.tier         TEXT DEFAULT 'free' (free|pro|enterprise)
-- organizations.tier_limits  JSONB (override defaults for enterprise)
-- organizations.stripe_customer_id TEXT
```

### Users and Memberships

Users authenticate via GitHub OAuth (spec 04). A user belongs to one or more organizations through the `memberships` table.

| Role | Capabilities |
|------|-------------|
| `owner` | Full access. Manage billing, delete the org, transfer ownership. Exactly one owner per org. |
| `admin` | Manage members, manage projects, manage settings. Cannot delete the org or change billing. |
| `member` | View projects and runs, approve/reject checkpoints, trigger manual runs and discoveries. |

### Onboarding

When a user signs up for the first time (completes GitHub OAuth with no existing memberships):

1. An organization is created automatically.
2. The org `slug` is set to the user's GitHub login (lowercased, non-alphanumeric characters replaced with hyphens).
3. The org `name` is set to the GitHub display name (or login if no display name).
4. The user is added as `owner`.
5. The org starts on the `free` tier with no Stripe customer.

### Org Lifecycle

- **Rename:** The display `name` can be changed at any time. The `slug` is immutable once created. All URLs, API paths, and storage prefixes use the org `id` (UUID), not the slug, so renaming is safe.
- **Delete:** Deleting an organization:
  1. Cancels the Stripe subscription (if any).
  2. Sets `is_active = false` on all projects.
  3. Marks all queued/running runs as `cancelled`.
  4. Retains data for 30 days (grace period for re-activation), then purges.
  5. The org row is soft-deleted (`deleted_at` timestamp), not physically removed.

---

## 3. Pricing Tiers

### 3.1 Tier Definitions

#### Free

For individuals and small open-source projects evaluating Megatest.

| Limit | Value |
|-------|-------|
| Screenshots per month | 500 |
| Projects | 3 |
| Concurrent runs | 1 |
| Run data retention | 7 days |
| Baseline retention | Indefinite |
| Support | Community only |

No credit card required. No Stripe customer is created.

#### Pro (usage-based)

For teams shipping production applications.

| Limit | Value |
|-------|-------|
| Included screenshots per month | 5,000 |
| Additional screenshots | $0.002 each |
| Projects | Unlimited |
| Concurrent runs (included) | 3 |
| Additional concurrent runs | $10/month each |
| Run data retention | 90 days |
| Baseline retention | Indefinite |
| Support | Email |

Billed monthly via Stripe. Overage charges are metered and reported at the end of each billing period.

#### Enterprise

For organizations with custom requirements.

| Limit | Value |
|-------|-------|
| Screenshots per month | Custom |
| Projects | Unlimited |
| Concurrent runs | Custom |
| Run data retention | Custom |
| Baseline retention | Indefinite |
| Dedicated worker pool | Optional |
| SSO/SAML | Future |
| Support | SLA, priority |

Enterprise terms are negotiated per-customer. Custom limits are stored in `organizations.tier_limits` as a JSONB override.

### 3.2 Tier Comparison

| Feature | Free | Pro | Enterprise |
|---------|------|-----|------------|
| Screenshots/month | 500 | 5,000 (+ overage) | Custom |
| Projects | 3 | Unlimited | Unlimited |
| Concurrent runs | 1 | 3 (+ add-ons) | Custom |
| Run data retention | 7 days | 90 days | Custom |
| Baseline retention | Indefinite | Indefinite | Indefinite |
| Container RAM | 1 GB | 2 GB | 4 GB |
| Container CPU | 1 core | 2 cores | 4 cores |
| Container disk | 5 GB | 10 GB | 20 GB |
| Run timeout | 5 min | 10 min | 30 min |
| Support | Community | Email | SLA + priority |
| Overage billing | N/A (blocked) | $0.002/screenshot | Custom |
| SSO/SAML | No | No | Future |
| Dedicated workers | No | No | Optional |

### 3.3 Tier Defaults

Tier limits are defined as constants in the application code and can be overridden per-org via `tier_limits`:

```ts
const TIER_DEFAULTS = {
  free: {
    screenshots_per_month: 500,
    max_projects: 3,
    max_concurrent_runs: 1,
    retention_days_runs: 7,
    retention_days_metadata: 30,
    container_ram_mb: 1024,
    container_cpus: 1,
    container_disk_gb: 5,
    run_timeout_seconds: 300,
  },
  pro: {
    screenshots_per_month: 5000,
    max_projects: null,        // unlimited
    max_concurrent_runs: 3,
    retention_days_runs: 90,
    retention_days_metadata: 365,
    container_ram_mb: 2048,
    container_cpus: 2,
    container_disk_gb: 10,
    run_timeout_seconds: 600,
    overage_per_screenshot: 0.002,   // USD
    concurrent_run_addon_price: 10,  // USD/month
  },
  enterprise: {
    // All values come from tier_limits JSONB on the org row.
    // Defaults here are the same as pro, overridden per customer.
    screenshots_per_month: 5000,
    max_projects: null,
    max_concurrent_runs: 3,
    retention_days_runs: 90,
    retention_days_metadata: 365,
    container_ram_mb: 4096,
    container_cpus: 4,
    container_disk_gb: 20,
    run_timeout_seconds: 1800,
  },
};
```

To resolve the effective limits for an org:

```ts
function getOrgLimits(org) {
  const defaults = TIER_DEFAULTS[org.tier];
  return { ...defaults, ...(org.tier_limits || {}) };
}
```

---

## 4. Quotas and Metering

### 4.1 Screenshot Metering

Each screenshot captured during a run increments the organization's monthly screenshot counter. Counting rules:

- Screenshots are counted at **capture time**, not at comparison time. A screenshot that fails comparison still counts.
- Re-runs of the same commit produce new captures and re-count screenshots.
- Discovery runs (spec 08) do **not** count against the screenshot quota. Discovery screenshots are internal to the agent and are not stored as checkpoint images.
- The counter resets to zero at the start of each billing period.

The `usage_records` table (spec 03) tracks per-org, per-period usage:

```sql
-- Relevant columns:
-- usage_records.organization_id  UUID
-- usage_records.period_start     TIMESTAMPTZ
-- usage_records.period_end       TIMESTAMPTZ
-- usage_records.screenshot_count INTEGER DEFAULT 0
-- usage_records.run_count        INTEGER DEFAULT 0
-- usage_records.storage_bytes    BIGINT DEFAULT 0
```

The worker increments counters atomically after recording checkpoint results (spec 05, section 3.7b):

```sql
UPDATE usage_records
SET screenshot_count = screenshot_count + $1,
    run_count = run_count + 1
WHERE organization_id = $2
  AND period_start = $3;
```

### 4.2 Quota Enforcement

Quota checks are performed at two points: before a run starts (proactive) and after each run completes (informational).

#### Pre-Run Check

Before the worker begins Docker setup, it queries the org's current usage and tier limits:

```ts
const usage = await db.usageRecords.getCurrent(orgId);
const limits = getOrgLimits(org);

// Hard limit check
if (org.tier === 'free' && usage.screenshot_count >= limits.screenshots_per_month) {
  throw new QuotaExceededError(
    'Organization screenshot quota exceeded. ' +
    'Upgrade your plan or wait for the next billing period.'
  );
}

// Proactive block: if this run's config defines more screenshots
// than the remaining quota, block it early
const configScreenshots = countScreenshotsInConfig(config);
const remaining = limits.screenshots_per_month - usage.screenshot_count;
if (org.tier === 'free' && configScreenshots > remaining) {
  throw new QuotaExceededError(
    `This run would capture ${configScreenshots} screenshots, ` +
    `but only ${remaining} remain in this billing period.`
  );
}
```

#### Soft Warning (80% Threshold)

When an org reaches 80% of its monthly screenshot quota:

- A warning banner is shown in the UI on the org dashboard.
- PR comments for subsequent runs include a warning line: "This organization has used 80% of its monthly screenshot quota (400/500)."
- No runs are blocked.

#### Hard Limit Behavior

| Tier | At 100% quota | Behavior |
|------|---------------|----------|
| Free | Runs are blocked | Error message returned. Existing baselines preserved. No data lost. |
| Pro | Overage charges apply | Runs continue. Each screenshot beyond the included amount is charged at $0.002. |
| Enterprise | Per-contract | Depends on customer agreement. Default behavior matches pro. |

#### Project Limit Enforcement

On the free tier, the org is limited to 3 projects. The check is performed when creating a new project:

```ts
const projectCount = await db.projects.countActive(orgId);
const limits = getOrgLimits(org);
if (limits.max_projects && projectCount >= limits.max_projects) {
  throw new LimitExceededError(
    `Your plan allows ${limits.max_projects} projects. ` +
    'Upgrade to Pro for unlimited projects.'
  );
}
```

### 4.3 Usage API

Current usage is queryable via the REST API:

```
GET /api/v1/organizations/:id/usage
```

**Response: 200**

```json
{
  "usage": {
    "period_start": "2026-03-01T00:00:00Z",
    "period_end": "2026-04-01T00:00:00Z",
    "screenshot_count": 342,
    "screenshot_limit": 500,
    "screenshot_percent": 68.4,
    "run_count": 47,
    "storage_bytes": 1073741824
  }
}
```

---

## 5. Billing Integration (Stripe)

### 5.1 Subscription Lifecycle

```
Free (no Stripe) --[upgrade]--> Pro (Stripe customer + subscription)
Pro              --[downgrade]-> Free (at end of billing period)
Pro              --[cancel]----> Free (at end of billing period)
Pro              --[upgrade]--> Enterprise (manual migration)
Enterprise       --[cancel]----> Free (manual migration)
```

#### Upgrade to Pro

When an org owner clicks "Upgrade to Pro":

1. Create a Stripe Customer (if none exists) using the org's billing email.
2. Create a Stripe Checkout Session with:
   - A recurring subscription for the Pro plan base price (if any; may be $0 base with pure usage billing).
   - A metered usage component for screenshot overages.
3. Redirect the user to Stripe Checkout.
4. On successful payment (`checkout.session.completed` webhook), update `organizations.tier = 'pro'` and store `stripe_customer_id`.

#### Downgrade to Free

When a pro org owner clicks "Downgrade":

1. Schedule the Stripe subscription for cancellation at the end of the current billing period (`cancel_at_period_end = true`).
2. At period end, Stripe fires `customer.subscription.deleted`.
3. On receiving that webhook, update `organizations.tier = 'free'` and clear `stripe_customer_id`.
4. If the org exceeds free-tier limits (more than 3 projects, etc.), the excess projects are not deleted but become read-only (no new runs) until the org is back within limits.

#### Cancellation

Cancellation follows the same flow as downgrade. The org reverts to the free tier at the end of the current billing period.

### 5.2 Metered Billing

Screenshot overage is reported to Stripe as metered usage:

1. At the end of each billing period (triggered by Stripe's `invoice.created` webhook or a daily cron), calculate the total screenshots for the period.
2. Subtract the included amount (5,000 for pro).
3. If overage > 0, report the overage count to Stripe via `stripe.subscriptionItems.createUsageRecord()`.
4. Stripe includes the overage amount on the next invoice.

```ts
async function reportUsageToStripe(org, period) {
  const usage = await db.usageRecords.getForPeriod(org.id, period);
  const limits = getOrgLimits(org);
  const overage = Math.max(0, usage.screenshot_count - limits.screenshots_per_month);

  if (overage > 0 && org.stripe_subscription_item_id) {
    await stripe.subscriptionItems.createUsageRecord(
      org.stripe_subscription_item_id,
      {
        quantity: overage,
        timestamp: Math.floor(period.end.getTime() / 1000),
        action: 'set',
      }
    );
  }
}
```

### 5.3 Stripe Webhooks

The API server listens for Stripe webhooks at `POST /api/webhooks/stripe`. The endpoint validates the webhook signature using the Stripe webhook secret.

| Event | Behavior |
|-------|----------|
| `checkout.session.completed` | Activate pro tier, store Stripe customer and subscription IDs. |
| `invoice.paid` | Record successful payment. No action needed on the org. |
| `invoice.payment_failed` | Send warning email to billing contact. After 3 consecutive failures, downgrade to free tier. |
| `customer.subscription.updated` | Sync tier and limits from subscription metadata. Handle add-on changes (extra concurrent runs). |
| `customer.subscription.deleted` | Revert org to free tier. Clear Stripe IDs. |

### 5.4 Billing Portal

Org owners can access the Stripe Customer Portal for self-service management of:

- Payment methods (add, update, remove credit cards)
- Invoice history and PDF downloads
- Subscription cancellation

The portal link is generated on demand:

```
POST /api/v1/organizations/:id/billing-portal
```

**Response: 200**

```json
{
  "url": "https://billing.stripe.com/session/..."
}
```

The URL is short-lived (expires after use or after 24 hours). The return URL points back to the org settings page.

---

## 6. Resource Isolation

### 6.1 Shared Worker Pool

All tenants share a common pool of worker instances. The pool scales horizontally by adding worker processes. Job distribution and fairness are enforced through BullMQ:

- **Per-project concurrency:** 1 concurrent run per project (BullMQ group concurrency on `projectId`). This prevents baseline race conditions.
- **Per-org concurrency:** Maximum concurrent runs per org depends on tier. Enforced by a pre-processing check in the worker (see spec 05, section 1).
- **No priority queue:** All tiers use the same BullMQ queue. The only difference is the concurrency ceiling per org. A free-tier org with 1 allowed concurrent run simply waits longer when the pool is busy.

#### Org Concurrency Check

Before starting a run, the worker queries active runs for the org:

```ts
const activeRuns = await db.runs.countActive(orgId);
const limits = getOrgLimits(org);

if (activeRuns >= limits.max_concurrent_runs) {
  // Re-queue with a 10-second delay
  throw new DelayedError('Org concurrency limit reached', { delay: 10000 });
}
```

### 6.2 Container Isolation

Each run executes in a dedicated Docker container (spec 05, section 2). Container resource limits are tier-aware:

| Resource | Free | Pro | Enterprise |
|----------|------|-----|------------|
| RAM | 1 GB | 2 GB | 4 GB |
| CPU | 1 core | 2 cores | 4 cores |
| Disk | 5 GB | 10 GB | 20 GB |
| Run timeout | 5 min | 10 min | 30 min |

The worker reads the org's tier from the job data and applies the corresponding limits when creating the container:

```ts
const limits = getOrgLimits(org);
const container = await docker.createContainer({
  Image: baseImage,
  HostConfig: {
    Memory: limits.container_ram_mb * 1024 * 1024,
    NanoCpus: limits.container_cpus * 1_000_000_000,
    DiskQuota: limits.container_disk_gb * 1024 * 1024 * 1024,
  },
  // ...
});
```

### 6.3 Data Isolation

All data access is scoped by organization. There is no mechanism for cross-org data access.

**Database queries:** Every query that touches tenant data includes an `organization_id` filter. The API authorization middleware resolves the current user's org memberships and rejects requests for resources outside those orgs.

**Storage paths:** Screenshot and baseline images are stored under org-scoped prefixes:

```
{org_id}/{project_id}/{run_id}/{workflow}/{checkpoint}/{viewport}/actual.png
{org_id}/{project_id}/baselines/{branch}/{workflow}/{checkpoint}/{viewport}/baseline.png
```

Note: The current storage path convention in spec 03 uses `project_id` as the top-level prefix. In the SaaS deployment, `org_id` is prepended as an additional prefix for bucket-level isolation. Self-hosted deployments can omit the org prefix.

**API authorization flow:**

```
1. Extract user from session cookie or bearer token
2. Resolve user's org memberships
3. For any resource request, verify the resource's org_id is in the user's membership set
4. If not, return 403 Forbidden
```

---

## 7. Rate Limiting by Tier

Rate limits are applied per organization (not per user) and vary by tier. Limits use a sliding window counter backed by Redis.

| Scope | Free | Pro | Enterprise |
|-------|------|-----|------------|
| API requests (`/api/v1/*`) | 60/min | 120/min | 300/min |
| Image serving (`/api/v1/checkpoints/:id/actual`, etc.) | 150/min | 300/min | 600/min |
| Webhook ingestion (`/api/webhooks/*`) | 300/min | 600/min | 1200/min |
| Discovery runs | 3/day | 10/day | Unlimited |

When a limit is exceeded, the server returns **429 Too Many Requests** with a `Retry-After` header (in seconds).

### Implementation

Rate limiting uses Redis sorted sets for sliding window counters:

```ts
async function checkRateLimit(orgId, scope, limit, windowSeconds) {
  const key = `ratelimit:${scope}:${orgId}`;
  const now = Date.now();
  const windowStart = now - (windowSeconds * 1000);

  // Remove expired entries
  await redis.zremrangebyscore(key, 0, windowStart);

  // Count current window
  const count = await redis.zcard(key);

  if (count >= limit) {
    const oldestInWindow = await redis.zrange(key, 0, 0, 'WITHSCORES');
    const retryAfter = Math.ceil((oldestInWindow[1] - windowStart) / 1000);
    return { allowed: false, retryAfter };
  }

  // Add this request
  await redis.zadd(key, now, `${now}:${crypto.randomUUID()}`);
  await redis.expire(key, windowSeconds);

  return { allowed: true, remaining: limit - count - 1 };
}
```

Rate limit headers are included on every response:

```
X-RateLimit-Limit: 120
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1710345600
```

---

## 8. Data Retention

### 8.1 Retention Policies

| Data Type | Free | Pro | Enterprise |
|-----------|------|-----|------------|
| Run screenshots (actual, diff) | 7 days | 90 days | Custom |
| Baselines | Indefinite | Indefinite | Indefinite |
| Run metadata (database rows) | 30 days | 1 year | Custom |
| Discovery reports | 30 days | 1 year | Custom |

Baselines are never automatically deleted. They are only replaced when a new baseline is approved.

### 8.2 Cleanup Job

A daily cleanup job runs at 03:00 UTC to purge expired data. The job is a scheduled BullMQ repeatable job on a dedicated `megatest:cleanup` queue.

```ts
async function cleanupExpiredData() {
  const orgs = await db.organizations.listActive();

  for (const org of orgs) {
    const limits = getOrgLimits(org);
    const now = new Date();

    // 1. Delete expired run screenshots from storage
    const screenshotCutoff = new Date(now - limits.retention_days_runs * 86400000);
    const expiredRuns = await db.runs.findExpired(org.id, screenshotCutoff);

    for (const run of expiredRuns) {
      await storage.deletePrefix(`${org.id}/${run.project_id}/${run.id}/`);
      await db.checkpoints.clearPaths(run.id);  // null out actual_path, diff_path
    }

    // 2. Delete expired run metadata
    const metadataCutoff = new Date(now - limits.retention_days_metadata * 86400000);
    await db.runs.deleteOlderThan(org.id, metadataCutoff);
    // CASCADE deletes checkpoints and approvals for those runs

    // 3. Delete expired discovery reports
    await db.discoveries.deleteOlderThan(org.id, metadataCutoff);
  }
}
```

### 8.3 Retention on Downgrade

When an org downgrades from pro to free:

- The new (shorter) retention policy takes effect immediately for the cleanup job.
- Data that was within the pro retention window but exceeds the free retention window is purged on the next cleanup run.
- Baselines are never affected by downgrades.

---

## 9. Admin API (Internal)

Internal endpoints for platform operators. These are not exposed to tenants and require a separate admin token (`Authorization: Bearer mt_admin_<token>`). The admin token is configured via the `ADMIN_API_TOKEN` environment variable.

### 9.1 Endpoints

#### GET /admin/organizations

Lists all organizations with usage summaries.

| Query param | Type | Default | Description |
|-------------|------|---------|-------------|
| `tier` | string | -- | Filter by tier. |
| `page` | number | 1 | Page number. |
| `per_page` | number | 50 | Items per page (max 200). |
| `sort` | string | `created_at` | Sort field: `created_at`, `screenshot_count`, `run_count`. |

**Response: 200**

```json
{
  "organizations": [
    {
      "id": "org-uuid",
      "name": "Acme Corp",
      "slug": "acme-corp",
      "tier": "pro",
      "member_count": 5,
      "project_count": 12,
      "current_usage": {
        "screenshot_count": 3421,
        "run_count": 89,
        "storage_bytes": 5368709120
      },
      "created_at": "2026-01-15T10:00:00Z"
    }
  ],
  "total": 247,
  "page": 1
}
```

---

#### GET /admin/organizations/:id

Returns detailed information about a single organization, including members, projects, billing status, and full usage history.

**Response: 200**

```json
{
  "organization": {
    "id": "org-uuid",
    "name": "Acme Corp",
    "slug": "acme-corp",
    "tier": "pro",
    "tier_limits": null,
    "stripe_customer_id": "cus_abc123",
    "billing_email": "billing@acme.com",
    "members": [
      { "user_id": "user-uuid", "github_login": "alice", "role": "owner" },
      { "user_id": "user-uuid-2", "github_login": "bob", "role": "member" }
    ],
    "projects": [
      { "id": "proj-uuid", "name": "acme/web-app", "is_active": true }
    ],
    "usage_history": [
      {
        "period_start": "2026-02-01T00:00:00Z",
        "period_end": "2026-03-01T00:00:00Z",
        "screenshot_count": 4200,
        "run_count": 112,
        "storage_bytes": 4294967296
      },
      {
        "period_start": "2026-03-01T00:00:00Z",
        "period_end": "2026-04-01T00:00:00Z",
        "screenshot_count": 3421,
        "run_count": 89,
        "storage_bytes": 5368709120
      }
    ],
    "created_at": "2026-01-15T10:00:00Z"
  }
}
```

---

#### POST /admin/organizations/:id/tier

Override an organization's tier. Used for manual enterprise onboarding and support escalations.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tier` | string | yes | `free`, `pro`, or `enterprise` |
| `tier_limits` | object | no | Custom limit overrides (merged with tier defaults) |
| `reason` | string | yes | Audit trail reason for the change |

```json
{
  "tier": "enterprise",
  "tier_limits": {
    "screenshots_per_month": 50000,
    "max_concurrent_runs": 10,
    "retention_days_runs": 365,
    "container_ram_mb": 4096
  },
  "reason": "Enterprise contract signed 2026-03-10, annual agreement"
}
```

**Response: 200**

```json
{
  "organization": {
    "id": "org-uuid",
    "tier": "enterprise",
    "tier_limits": {
      "screenshots_per_month": 50000,
      "max_concurrent_runs": 10,
      "retention_days_runs": 365,
      "container_ram_mb": 4096
    }
  }
}
```

---

#### GET /admin/metrics

System-wide operational metrics for monitoring dashboards.

**Response: 200**

```json
{
  "metrics": {
    "active_runs": 7,
    "queued_runs": 12,
    "queue_depth": 19,
    "worker_count": 4,
    "workers_busy": 7,
    "workers_idle": 1,
    "active_discoveries": 2,
    "orgs_total": 247,
    "orgs_free": 198,
    "orgs_pro": 42,
    "orgs_enterprise": 7,
    "screenshots_today": 14523,
    "runs_today": 312,
    "storage_total_bytes": 1099511627776
  }
}
```

---

#### POST /admin/organizations/:id/suspend

Suspends an organization due to abuse, non-payment, or ToS violation. Suspended orgs cannot create runs, and existing queued runs are cancelled.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `reason` | string | yes | Reason for suspension (stored in audit log) |

```json
{
  "reason": "Automated abuse detection: excessive API calls from bot"
}
```

**Response: 200**

```json
{
  "organization": {
    "id": "org-uuid",
    "status": "suspended",
    "suspended_at": "2026-03-13T15:30:00Z"
  }
}
```

When a suspended org's user attempts any API action, the server returns **403** with:

```json
{
  "error": "org_suspended",
  "message": "This organization has been suspended. Contact support@megatest.dev."
}
```

---

#### POST /admin/organizations/:id/unsuspend

Restores a suspended organization.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `reason` | string | yes | Reason for unsuspension (stored in audit log) |

**Response: 200**

```json
{
  "organization": {
    "id": "org-uuid",
    "status": "active",
    "unsuspended_at": "2026-03-13T16:00:00Z"
  }
}
```

---

### 9.2 Admin Authentication

Admin endpoints require a static token configured via the `ADMIN_API_TOKEN` environment variable. This token is checked by middleware before any admin route handler executes.

```ts
function adminAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token !== process.env.ADMIN_API_TOKEN) {
    return res.status(401).send({ error: 'unauthorized', message: 'Invalid admin token' });
  }
  next();
}
```

Admin actions are logged to an `admin_audit_log` table for accountability:

```sql
CREATE TABLE admin_audit_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action      TEXT NOT NULL,         -- e.g. "tier_override", "suspend", "unsuspend"
    target_org  UUID REFERENCES organizations(id),
    payload     JSONB,                 -- request body
    admin_token TEXT,                  -- last 4 chars of the token used (for identification)
    created_at  TIMESTAMPTZ DEFAULT now()
);
```

---

## 10. Self-Hosted Differences

When Megatest is deployed via Docker Compose for self-hosting, the SaaS platform layer is present but effectively disabled. This avoids maintaining two separate codebases.

### Configuration

Self-hosted mode is activated by setting `SELF_HOSTED=true` in the environment.

The operator must also configure the following environment variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `SELF_HOSTED` | Yes | Set to `true` to enable self-hosted mode |
| `LLM_PROVIDER` | Yes | LLM provider for discovery: `anthropic`, `openai`, or `openai_compatible` |
| `LLM_API_KEY` | Yes | API key for the configured LLM provider |
| `LLM_MODEL` | No | Model identifier (defaults vary by provider) |
| `LLM_BASE_URL` | No | Base URL for OpenAI-compatible providers |

### Behavioral Differences

| Concern | SaaS | Self-Hosted |
|---------|------|-------------|
| Organizations | Multiple, user-created | Single org created during setup |
| Tier enforcement | Active (free/pro/enterprise limits) | Disabled (all limits are unlimited) |
| Quota checks | Enforced per tier | Skipped |
| Billing integration | Stripe | None |
| Usage metering | Active (counters incremented) | Counters still increment (for dashboard display) but no enforcement |
| Rate limiting | Per-tier limits | Disabled |
| Data retention cleanup | Automated by tier | Disabled (operator manages storage manually) |
| Admin API | Token-authenticated endpoints | Disabled (operator has direct database access) |
| Onboarding | Auto-create org from GitHub login | Setup wizard creates org with operator-chosen name |

### Implementation

The self-hosted flag is checked at each enforcement point:

```ts
function isSelfHosted() {
  return process.env.SELF_HOSTED === 'true';
}

// In quota check:
if (!isSelfHosted()) {
  enforceQuota(org, usage);
}

// In rate limiter:
if (isSelfHosted()) {
  return { allowed: true, remaining: Infinity };
}

// In tier defaults resolution:
if (isSelfHosted()) {
  return {
    screenshots_per_month: null,   // unlimited
    max_projects: null,            // unlimited
    max_concurrent_runs: null,     // unlimited (bounded by hardware)
    retention_days_runs: null,     // never expires
    retention_days_metadata: null,
    container_ram_mb: 2048,        // sensible defaults
    container_cpus: 2,
    container_disk_gb: 10,
    run_timeout_seconds: 600,
  };
}
```

The org model still exists in self-hosted mode for data consistency. All projects belong to the single org. The database schema is identical. This means a self-hosted instance can be migrated to a SaaS account (or vice versa) by exporting and importing the database.
