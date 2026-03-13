# 04 - REST API Specification

Megatest exposes a Fastify HTTP server on port 3000 that serves three
concerns through a single process:

1. **Authentication** -- GitHub OAuth flow and session management.
2. **Webhooks** -- GitHub App event ingestion (HMAC-validated).
3. **REST API** -- JSON endpoints consumed by the SPA and (eventually)
   third-party integrations.
4. **Static files** -- The SPA bundle and its assets.

All JSON responses use `Content-Type: application/json; charset=utf-8`.
Dates are ISO-8601 strings in UTC.  IDs are UUIDs unless noted otherwise.

---

## 1  Authentication

Authentication is cookie-based.  A successful OAuth flow sets an
`HttpOnly` / `SameSite=Lax` session cookie. `Secure` is enabled for HTTPS
deployments and may be disabled only for local `http://localhost` /
loopback development. Every `/api/v1/*`
endpoint requires this cookie; missing or invalid sessions return **401**.

### 1.1  GET /auth/github

Redirects the browser to GitHub's OAuth authorization URL.

| Query param | Type   | Required | Description |
|-------------|--------|----------|-------------|
| `redirect`  | string | no       | URL to redirect to after login completes. Stored in the OAuth `state` parameter. Defaults to `/`. |

**Response:** 302 redirect to `https://github.com/login/oauth/authorize?...`

---

### 1.2  GET /auth/github/callback

GitHub redirects here after the user authorizes.  The server exchanges the
temporary code for an access token, creates or updates the user record, sets
the session cookie, and redirects.

| Query param | Type   | Required | Description |
|-------------|--------|----------|-------------|
| `code`      | string | yes      | Temporary OAuth code from GitHub. |
| `state`     | string | yes      | Opaque state value (contains CSRF token and redirect URL). |

**Response:** 302 redirect to the `redirect` URL embedded in `state`, or `/`.

**Error:** If the code exchange fails, redirects to `/?error=auth_failed`.

---

### 1.2b  GET /auth/github/setup

Optional post-install landing route from the GitHub App Setup URL. Associates
the current session with the installation context and redirects back into the
SPA so the repo picker can show repositories immediately.

| Query param        | Type   | Required | Description |
|--------------------|--------|----------|-------------|
| `installation_id`  | number | yes      | GitHub App installation ID. |

**Response:** 302 redirect to `/` (or a stored return path).

---

### 1.3  GET /auth/me

Returns the currently authenticated user.

**Auth:** Required.

**Response: 200**

```json
{
  "user": {
    "id": "b1a2c3d4-...",
    "github_login": "octocat",
    "github_name": "The Octocat",
    "github_avatar_url": "https://avatars.githubusercontent.com/u/1?v=4"
  }
}
```

**Response: 401** (no valid session)

```json
{
  "error": "unauthorized",
  "message": "Not logged in"
}
```

---

### 1.4  POST /auth/logout

Clears the session cookie.

**Auth:** Required (no-op if already logged out).

**Response: 200**

```json
{
  "ok": true
}
```

---

### 1.5  API Token Authentication

In addition to cookie-based sessions, the API supports bearer token authentication for CI/CD integrations and third-party tooling.

**Header:** `Authorization: Bearer mt_<token>`

API tokens are created per-organization in the settings UI or via `POST /api/v1/organizations/:id/tokens`. Each token is scoped to an organization and inherits the creating user's access. Tokens do not expire by default but can be revoked.

When both a session cookie and a bearer token are present, the bearer token takes precedence.

---

## 2  Webhook Endpoint

### 2.1  POST /api/webhooks/github

Receives GitHub App webhook deliveries.  No session cookie is required.
The request is validated using the HMAC-SHA256 signature in the
`X-Hub-Signature-256` header against the configured webhook secret.

| Header                 | Description |
|------------------------|-------------|
| `X-Hub-Signature-256`  | `sha256=<hex-digest>` HMAC of the raw request body. |
| `X-GitHub-Event`       | Event type (`push`, `pull_request`, etc.). |
| `X-GitHub-Delivery`    | Unique delivery UUID. |

**Supported events:**

| Event                        | Action(s)                          | Behaviour |
|------------------------------|------------------------------------|-----------|
| `push`                       | --                                 | Creates a run for the pushed branch. Subject to the project's trigger rules (see spec 13). If no trigger rule matches this event, the webhook is acknowledged but no run is created. |
| `pull_request`               | `opened`, `synchronize`, `reopened`| Creates a run for the PR head commit. Subject to the project's trigger rules (see spec 13). If no trigger rule matches this event, the webhook is acknowledged but no run is created. |
| `pull_request`               | `closed`                           | Promotes approved baselines if `merged=true`. |
| `installation`               | `created`                          | Records the new GitHub App installation. |
| `installation`               | `deleted`                          | Removes the installation and deactivates linked projects. |
| `installation_repositories`  | `added`                            | Grants Megatest access to the newly added repos. |
| `installation_repositories`  | `removed`                          | Revokes access to the removed repos. |

Unrecognised events or actions are acknowledged with 200 and ignored.

**Response (push / pull_request): 202**

```json
{
  "run_id": "a1b2c3d4-..."
}
```

**Response (installation / installation_repositories): 200**

```json
{
  "ok": true
}
```

**Response: 401** (signature mismatch)

```json
{
  "error": "invalid_signature",
  "message": "Webhook signature verification failed"
}
```

---

## 3  REST API

All endpoints below are prefixed with `/api/v1/` and require a valid
session cookie.  Unauthorised requests receive **401**.  Requests for
resources the user does not have access to receive **403**.  Missing
resources receive **404**.

### 3.1  Error envelope

Every error response uses the same shape:

```json
{
  "error": "short_code",
  "message": "Human-readable explanation"
}
```

Common codes:

| Status | `error`           | When |
|--------|-------------------|------|
| 400    | `bad_request`     | Malformed JSON or missing required fields. |
| 401    | `unauthorized`    | No valid session. |
| 403    | `forbidden`       | User lacks access to the resource. |
| 404    | `not_found`       | Resource does not exist. |
| 409    | `conflict`        | Action conflicts with current state (e.g. cancelling a completed run). |
| 422    | `unprocessable`   | Validation error. Additional `details` array may be present. |
| 500    | `internal`        | Unexpected server error. |

---

### 3.2  Projects

#### GET /api/v1/projects

Lists projects the current user has access to via their GitHub App
installations.

| Query param | Type   | Default | Description |
|-------------|--------|---------|-------------|
| `page`      | number | 1       | Page number. |
| `per_page`  | number | 20      | Items per page (max 100). |

**Response: 200**

```json
{
  "projects": [
    {
      "id": "9a8b7c6d-1111-4444-8888-0123456789ab",
      "name": "octocat/hello-world",
      "repo_url": "https://github.com/octocat/hello-world",
      "default_branch": "main",
      "is_active": true,
      "last_run": {
        "id": "a1b2c3d4-1111-4444-8888-0123456789ab",
        "status": "completed",
        "result": "pass",
        "created_at": "2026-03-12T14:30:00Z"
      }
    },
    {
      "id": "9a8b7c6d-2222-4444-8888-0123456789ab",
      "name": "octocat/spoon-knife",
      "repo_url": "https://github.com/octocat/spoon-knife",
      "default_branch": "main",
      "is_active": true,
      "last_run": null
    }
  ],
  "total": 2,
  "page": 1
}
```

---

#### POST /api/v1/projects

Connects a GitHub repository as a Megatest project.  The server uses the
provided `installation_id` to fetch repository details from the GitHub API.

**Request body:**

| Field             | Type   | Required | Description |
|-------------------|--------|----------|-------------|
| `repo_id`         | number | yes      | GitHub repository ID. |
| `installation_id` | number | yes      | GitHub App installation ID that has access to the repo. |

```json
{
  "repo_id": 123456,
  "installation_id": 78901
}
```

**Response: 201**

```json
{
  "project": {
    "id": "9a8b7c6d-1111-4444-8888-0123456789ab",
    "name": "octocat/hello-world",
    "repo_url": "https://github.com/octocat/hello-world",
    "default_branch": "main",
    "config_repo_url": null,
    "is_active": true,
    "settings": {},
    "created_at": "2026-03-13T10:00:00Z"
  }
}
```

**Side effect:** If the newly connected repository does not contain a `.megatest/` directory, a discovery job is automatically enqueued. The response includes a `discovery_id` field when this occurs:
```json
{
  "project": { "..." : "..." },
  "discovery_id": "7c0a4de1-1111-4444-8888-0123456789ab"
}
```

**Response: 409** (repo already connected)

```json
{
  "error": "conflict",
  "message": "Repository is already connected as a project"
}
```

---

#### GET /api/v1/installations

Lists GitHub App installations visible to the current user.

**Response: 200**

```json
{
  "installations": [
    {
      "id": "1d5c6c6e-6fa8-49fb-a31b-1fcb6ff0e000",
      "installation_id": 78901,
      "account_login": "octocat",
      "account_type": "user"
    }
  ]
}
```

---

#### GET /api/v1/installations/:id/repositories

Lists repositories currently accessible through an installation. Used by the
dashboard repo picker.

**Response: 200**

```json
{
  "repositories": [
    {
      "repo_id": 123456,
      "full_name": "octocat/hello-world",
      "default_branch": "main"
    }
  ]
}
```

---

#### GET /api/v1/projects/:id

Returns full details for a single project.

**Response: 200**

```json
{
  "project": {
    "id": "9a8b7c6d-1111-4444-8888-0123456789ab",
    "name": "octocat/hello-world",
    "repo_url": "https://github.com/octocat/hello-world",
    "default_branch": "main",
    "config_repo_url": null,
    "is_active": true,
    "settings": {
      "tracked_branches": ["main", "release/*"],
      "run_timeout_seconds": 900
    },
    "created_at": "2026-03-13T10:00:00Z"
  }
}
```

---

#### PATCH /api/v1/projects/:id

Updates project settings.  All body fields are optional; only provided
fields are changed.

**Request body:**

| Field            | Type   | Required | Description |
|------------------|--------|----------|-------------|
| `settings`       | object | no       | Operational settings object (merged with existing). Does not override repo `.megatest` workflow semantics. |
| `default_branch` | string | no       | Default branch name. |

```json
{
  "settings": {
    "run_timeout_seconds": 1200
  },
  "default_branch": "develop"
}
```

**Response: 200**

```json
{
  "project": {
    "id": "9a8b7c6d-1111-4444-8888-0123456789ab",
    "name": "octocat/hello-world",
    "repo_url": "https://github.com/octocat/hello-world",
    "default_branch": "develop",
    "config_repo_url": null,
    "is_active": true,
    "settings": {
      "tracked_branches": ["main", "release/*"],
      "run_timeout_seconds": 1200
    },
    "created_at": "2026-03-13T10:00:00Z"
  }
}
```

---

#### DELETE /api/v1/projects/:id

Soft-deletes the project by setting `is_active = false`.  The project and
its data remain in the database but are excluded from listings and webhook
processing.

**Response: 204** No Content (empty body).

---

#### POST /api/v1/projects/:id/secrets

Sets encrypted environment secrets for a project.  Secrets are encrypted at
rest and injected as `${env:KEY}` placeholders during run execution.
Providing a key with an empty string value deletes that secret.

**Request body:**

| Field    | Type   | Required | Description |
|----------|--------|----------|-------------|
| `secrets`| object | yes      | Key-value map of secret names to values. |

```json
{
  "secrets": {
    "API_KEY": "sk-live-abc123",
    "DATABASE_URL": "postgres://...",
    "OLD_SECRET": ""
  }
}
```

**Response: 200**

```json
{
  "keys": ["API_KEY", "DATABASE_URL"]
}
```

Note: secret values are never returned by any endpoint.  Only the key names
are listed.

---

#### GET /api/v1/projects/:id/secrets

Returns the configured secret key names for a project.

**Response: 200**

```json
{
  "keys": ["API_KEY", "DATABASE_URL"]
}
```

---

#### GET /api/v1/projects/:id/baselines

Lists the current approved baselines for a project branch.

| Query param | Type   | Default | Description |
|-------------|--------|---------|-------------|
| `branch`    | string | project's `default_branch` | Branch whose baselines should be listed. |

**Response: 200**

```json
{
  "baselines": [
    {
      "workflow": "homepage",
      "checkpoint": "hero",
      "viewport": "desktop",
      "updated_at": "2026-03-13T10:10:00Z"
    }
  ]
}
```

---

### 3.3  Runs

#### GET /api/v1/runs/recent

Lists recent runs across all projects accessible to the current user.

| Query param | Type   | Default | Description |
|-------------|--------|---------|-------------|
| `limit`     | number | 10      | Maximum number of runs to return (max 50). |

**Response: 200**

```json
{
  "runs": [
    {
      "id": "a1b2c3d4-1111-4444-8888-0123456789ab",
      "project_id": "9a8b7c6d-1111-4444-8888-0123456789ab",
      "project_name": "octocat/hello-world",
      "branch": "main",
      "status": "completed",
      "result": "pass",
      "created_at": "2026-03-12T14:29:55Z"
    }
  ]
}
```

---

#### GET /api/v1/projects/:id/runs

Lists runs for a project with optional filters.

| Query param | Type   | Default | Description |
|-------------|--------|---------|-------------|
| `branch`    | string | --      | Filter by branch name. |
| `status`    | string | --      | Filter by status: `queued`, `cloning`, `setting_up`, `running`, `comparing`, `completed`, `failed`, `cancelled`. |
| `page`      | number | 1       | Page number. |
| `per_page`  | number | 20      | Items per page (max 100). |

**Response: 200**

```json
{
  "runs": [
    {
      "id": "a1b2c3d4-1111-4444-8888-0123456789ab",
      "project_id": "9a8b7c6d-1111-4444-8888-0123456789ab",
      "trigger": "push",
      "branch": "feat/login",
      "commit_sha": "abc123def456",
      "base_branch": "main",
      "pr_number": null,
      "status": "completed",
      "result": "fail",
      "error_message": null,
      "checkpoint_summary": {
        "total": 12,
        "passed": 10,
        "failed": 1,
        "new": 1
      },
      "started_at": "2026-03-12T14:30:00Z",
      "completed_at": "2026-03-12T14:32:15Z",
      "created_at": "2026-03-12T14:29:55Z"
    }
  ],
  "total": 47,
  "page": 1
}
```

---

#### GET /api/v1/runs/:id

Returns full run detail including its checkpoints.

**Response: 200**

```json
{
  "run": {
    "id": "a1b2c3d4-1111-4444-8888-0123456789ab",
    "project_id": "9a8b7c6d-1111-4444-8888-0123456789ab",
    "trigger": "push",
    "branch": "feat/login",
    "commit_sha": "abc123def456",
    "base_branch": "main",
    "pr_number": null,
    "status": "completed",
    "result": "fail",
    "error_message": null,
    "started_at": "2026-03-12T14:30:00Z",
    "completed_at": "2026-03-12T14:32:15Z",
    "created_at": "2026-03-12T14:29:55Z",
    "checkpoints": [
      {
        "id": "2fa6a512-1111-4444-8888-0123456789ab",
        "workflow": "auth",
        "name": "login-page",
        "viewport": "1280x720",
        "status": "pass",
        "review_state": "none",
        "diff_percent": 0.0,
        "threshold": 0.1,
        "dimensions": { "width": 1280, "height": 720 },
        "baseline_dimensions": { "width": 1280, "height": 720 }
      },
      {
        "id": "2fa6a512-2222-4444-8888-0123456789ab",
        "workflow": "auth",
        "name": "login-error",
        "viewport": "1280x720",
        "status": "fail",
        "review_state": "pending",
        "diff_percent": 4.7,
        "threshold": 0.1,
        "dimensions": { "width": 1280, "height": 720 },
        "baseline_dimensions": { "width": 1280, "height": 720 }
      },
      {
        "id": "2fa6a512-3333-4444-8888-0123456789ab",
        "workflow": "dashboard",
        "name": "empty-state",
        "viewport": "375x812",
        "status": "new",
        "review_state": "pending",
        "diff_percent": null,
        "threshold": 0.1,
        "dimensions": { "width": 375, "height": 812 },
        "baseline_dimensions": null
      }
    ]
  }
}
```

---

#### POST /api/v1/runs/:id/cancel

Cancels a run that is currently `queued` or `running`.

**Response: 200**

```json
{
  "run": {
      "id": "a1b2c3d4-1111-4444-8888-0123456789ab",
    "status": "cancelled",
    "result": null,
    "completed_at": "2026-03-13T10:05:00Z"
  }
}
```

**Response: 409** (run already completed or cancelled)

```json
{
  "error": "conflict",
  "message": "Run is already completed"
}
```

---

#### POST /api/v1/runs/:id/retry

Creates a new run with the same project, branch, and commit as the
original.

**Response: 201**

```json
{
  "run": {
    "id": "a1b2c3d4-2222-4444-8888-0123456789ab",
    "project_id": "9a8b7c6d-1111-4444-8888-0123456789ab",
    "trigger": "manual",
    "branch": "feat/login",
    "commit_sha": "abc123def456",
    "base_branch": "main",
    "pr_number": null,
    "status": "queued",
    "result": null,
    "error_message": null,
    "started_at": null,
    "completed_at": null,
    "created_at": "2026-03-13T10:06:00Z",
    "checkpoints": []
  }
}
```

---

### 3.4  Checkpoints

#### GET /api/v1/runs/:id/checkpoints

Lists all checkpoints for a run.

**Response: 200**

```json
{
  "checkpoints": [
    {
      "id": "2fa6a512-1111-4444-8888-0123456789ab",
      "workflow": "auth",
      "name": "login-page",
      "viewport": "1280x720",
      "status": "pass",
      "review_state": "none",
      "diff_percent": 0.0,
      "threshold": 0.1,
      "dimensions": { "width": 1280, "height": 720 },
      "baseline_dimensions": { "width": 1280, "height": 720 }
    }
  ]
}
```

---

#### GET /api/v1/checkpoints/:id

Returns full checkpoint detail including storage paths.

**Response: 200**

```json
{
  "checkpoint": {
    "id": "2fa6a512-2222-4444-8888-0123456789ab",
    "run_id": "a1b2c3d4-1111-4444-8888-0123456789ab",
    "project_id": "9a8b7c6d-1111-4444-8888-0123456789ab",
    "workflow": "auth",
    "name": "login-error",
    "viewport": "1280x720",
    "status": "fail",
    "review_state": "pending",
    "diff_percent": 4.7,
    "threshold": 0.1,
    "dimensions": { "width": 1280, "height": 720 },
    "baseline_dimensions": { "width": 1280, "height": 720 },
    "actual_path": "9a8b7c6d-1111-4444-8888-0123456789ab/a1b2c3d4-1111-4444-8888-0123456789ab/auth/login-error/1280x720/actual.png",
    "baseline_path": "9a8b7c6d-1111-4444-8888-0123456789ab/baselines/main/auth/login-error/1280x720/baseline.png",
    "diff_path": "9a8b7c6d-1111-4444-8888-0123456789ab/a1b2c3d4-1111-4444-8888-0123456789ab/auth/login-error/1280x720/diff.png",
    "created_at": "2026-03-12T14:31:00Z"
  }
}
```

---

#### GET /api/v1/checkpoints/:id/actual

Serves the actual (current) screenshot image captured during the run.

**Response: 200**
- `Content-Type: image/png`
- Body: raw PNG bytes.

**Response: 404** (image not yet captured or storage error)

---

#### GET /api/v1/checkpoints/:id/baseline

Serves the baseline screenshot for comparison.

**Response: 200**
- `Content-Type: image/png`
- Body: raw PNG bytes.

**Response: 404** (no baseline exists -- this is a new checkpoint)

---

#### GET /api/v1/checkpoints/:id/diff

Serves the visual diff overlay image highlighting pixel differences between
actual and baseline.

**Response: 200**
- `Content-Type: image/png`
- Body: raw PNG bytes.

**Response: 404** (no diff exists -- checkpoint passed or is new)

---

### 3.5  Approvals

#### POST /api/v1/checkpoints/:id/approve

Approves a single checkpoint. The actual screenshot becomes the new baseline
for this checkpoint's branch. Execution status remains unchanged; the API
returns a derived `review_state`. If all reviewable checkpoints in the parent
run are now approved, the server updates the GitHub commit status to `success`.

**Request body:**

| Field    | Type   | Required | Description |
|----------|--------|----------|-------------|
| `comment`| string | no       | Optional reviewer comment. |

```json
{
  "comment": "Intentional redesign of the error state"
}
```

**Response: 200**

```json
{
  "checkpoint": {
    "id": "2fa6a512-1111-4444-8888-0123456789ab",
    "run_id": "a1b2c3d4-1111-4444-8888-0123456789ab",
    "workflow": "auth",
    "name": "login-error",
    "viewport": "1280x720",
    "status": "fail",
    "review_state": "approved",
    "diff_percent": 4.7,
    "threshold": 0.1,
    "approved_by": "b1a2c3d4-...",
    "approved_at": "2026-03-13T10:10:00Z"
  },
  "baseline": {
    "id": "bl_new789",
    "project_id": "9a8b7c6d-1111-4444-8888-0123456789ab",
    "branch": "feat/login",
    "workflow": "auth",
    "name": "login-error",
    "viewport": "1280x720",
    "created_at": "2026-03-13T10:10:00Z"
  }
}
```

**Response: 409** (checkpoint already approved or not in a reviewable state)

```json
{
  "error": "conflict",
  "message": "Checkpoint is not in a reviewable state"
}
```

---

#### POST /api/v1/checkpoints/:id/reject

Rejects a single checkpoint. The run remains in a failed state and the GitHub
commit status stays `failure`.

**Request body:**

| Field    | Type   | Required | Description |
|----------|--------|----------|-------------|
| `comment`| string | no       | Optional reviewer comment. |

```json
{
  "comment": "This regression needs to be fixed"
}
```

**Response: 200**

```json
{
  "checkpoint": {
    "id": "2fa6a512-1111-4444-8888-0123456789ab",
    "run_id": "a1b2c3d4-1111-4444-8888-0123456789ab",
    "workflow": "auth",
    "name": "login-error",
    "viewport": "1280x720",
    "status": "fail",
    "review_state": "rejected",
    "diff_percent": 4.7,
    "threshold": 0.1,
    "rejected_by": "b1a2c3d4-...",
    "rejected_at": "2026-03-13T10:12:00Z"
  }
}
```

---

#### POST /api/v1/runs/:id/approve-all

Bulk-approves all checkpoints in the run that are in a reviewable state
(`fail` or `new`). Each approved checkpoint's actual screenshot becomes
the new baseline.  The GitHub commit status is updated to `success`.

**Request body:**

| Field    | Type   | Required | Description |
|----------|--------|----------|-------------|
| `comment`| string | no       | Optional reviewer comment applied to all approvals. |

```json
{
  "comment": "Approved in bulk -- new design system rollout"
}
```

**Response: 200**

```json
{
  "approved_count": 2,
  "run": {
    "id": "a1b2c3d4-1111-4444-8888-0123456789ab",
    "status": "completed",
    "result": "fail",
    "review_state": "approved",
    "checkpoints": [
      {
        "id": "2fa6a512-1111-4444-8888-0123456789ab",
        "status": "fail",
        "review_state": "approved",
        "approved_at": "2026-03-13T10:15:00Z"
      },
      {
        "id": "2fa6a512-2222-4444-8888-0123456789ab",
        "status": "new",
        "review_state": "approved",
        "approved_at": "2026-03-13T10:15:00Z"
      }
    ]
  }
}
```

**Response: 409** (no checkpoints to approve)

```json
{
  "error": "conflict",
  "message": "No checkpoints in a reviewable state"
}
```

---

### 3.7  Organizations

#### GET /api/v1/organizations

Lists organizations the current user is a member of.

**Response: 200**
```json
{
  "organizations": [
    {
      "id": "org-uuid",
      "name": "Acme Corp",
      "slug": "acme-corp",
      "tier": "free",
      "role": "owner"
    }
  ]
}
```

#### GET /api/v1/organizations/:id

Returns full details for an organization including usage summary.

**Response: 200**
```json
{
  "organization": {
    "id": "org-uuid",
    "name": "Acme Corp",
    "slug": "acme-corp",
    "tier": "free",
    "tier_limits": { "screenshots_per_month": 500, "max_projects": 3, "max_concurrent_runs": 1 },
    "usage": { "screenshot_count": 142, "run_count": 23, "period_start": "2026-03-01T00:00:00Z" },
    "members": [
      { "user_id": "user-uuid", "github_login": "octocat", "role": "owner" }
    ],
    "created_at": "2026-01-15T10:00:00Z"
  }
}
```

#### POST /api/v1/organizations/:id/members

Invites a user to the organization by GitHub login.

**Request body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `github_login` | string | yes | GitHub username to invite |
| `role` | string | no | `member` (default) or `admin` |

**Response: 201**
```json
{
  "membership": { "user_id": "user-uuid", "github_login": "newuser", "role": "member" }
}
```

#### DELETE /api/v1/organizations/:id/members/:userId

Removes a member from the organization.

**Response: 204** No Content.

---

### 3.8  Trigger Rules

#### GET /api/v1/projects/:id/triggers

Returns the current trigger configuration for a project.

**Response: 200**
```json
{
  "triggers": [
    { "event": "pull_request", "actions": ["opened", "synchronize", "reopened"] },
    { "event": "push", "branches": ["main", "release/*"] }
  ]
}
```

#### PUT /api/v1/projects/:id/triggers

Replaces the trigger configuration for a project.

**Request body:**
```json
{
  "triggers": [
    { "event": "pull_request", "actions": ["opened", "synchronize", "reopened"] },
    { "event": "push", "branches": ["main"] }
  ]
}
```

**Response: 200**
```json
{
  "triggers": [
    { "event": "pull_request", "actions": ["opened", "synchronize", "reopened"] },
    { "event": "push", "branches": ["main"] }
  ]
}
```

Trigger rules are evaluated by the webhook handler before creating runs. If no rule matches an incoming event, the webhook is acknowledged but no run is created. See spec 13 for the full trigger rules specification.

---

### 3.9  Config Management

#### GET /api/v1/projects/:id/config

Returns the project's current config files by reading from the config repo
(or the project repo itself if no separate config repo is configured).

**Response: 200**
```json
{
  "config_repo_url": null,
  "files": {
    "config.yml": "version: \"1\"\nsetup:\n  install:\n    - npm ci\n...",
    "workflows/homepage.yml": "name: homepage\n..."
  }
}
```

When a separate config repo is configured:
```json
{
  "config_repo_url": "https://github.com/org/megatest-config.git",
  "files": {
    "config.yml": "version: \"1\"\nsetup:\n  install:\n    - npm ci\n...",
    "workflows/homepage.yml": "name: homepage\n..."
  }
}
```

#### PATCH /api/v1/projects/:id/config-repo

Sets or changes the config repository for a project.

**Request body:**

| Field               | Type   | Required | Description |
|---------------------|--------|----------|-------------|
| `config_repo_url`   | string | yes      | HTTPS clone URL of the config repo, or `null` to use the project repo. |
| `config_repo_branch`| string | no       | Branch to read config from. Default: repo's default branch. |
| `config_repo_path`  | string | no       | Subdirectory within the config repo. Default: root. |

To set a separate config repo:
```json
{
  "config_repo_url": "https://github.com/org/megatest-config.git",
  "config_repo_branch": "main",
  "config_repo_path": "my-project"
}
```

To switch to reading config from the project repo itself (no separate config repo):
```json
{
  "config_repo_url": null
}
```

**Response: 200**
```json
{
  "config_repo_url": "https://github.com/org/megatest-config.git",
  "config_repo_branch": "main",
  "config_repo_path": "my-project"
}
```

---

### 3.10  Discovery

#### POST /api/v1/projects/:id/discover

Triggers AI-powered workflow discovery for the project. The server clones the
repository, starts the app, explores it with `Playwright`, and generates
`.megatest/` configuration files in the canonical schema from spec 02.

**Request body:**

| Field    | Type   | Required | Description |
|----------|--------|----------|-------------|
| `branch` | string | no       | Branch to discover against.  Defaults to project's `default_branch`. |

```json
{
  "branch": "main"
}
```

**Response: 202**

```json
{
  "discovery_id": "7c0a4de1-1111-4444-8888-0123456789ab"
}
```

---

#### GET /api/v1/discoveries/:id

Returns the current status and results of a discovery job.

**Response: 200** (in progress)

```json
{
  "discovery": {
    "id": "7c0a4de1-1111-4444-8888-0123456789ab",
    "project_id": "9a8b7c6d-1111-4444-8888-0123456789ab",
    "status": "running",
      "progress": {
        "phase": "exploration",
        "pages_visited": 7,
        "elapsed_seconds": 45
      },
      "config_files": {},
      "created_at": "2026-03-13T10:20:00Z"
  }
}
```

**Response: 200** (completed)

```json
{
  "discovery": {
    "id": "7c0a4de1-1111-4444-8888-0123456789ab",
    "project_id": "9a8b7c6d-1111-4444-8888-0123456789ab",
    "status": "completed",
    "report": {
      "pages_visited": 14,
      "pages_skipped": 2,
      "workflows_generated": 2,
      "includes_generated": 1,
      "auth_detected": true
    },
    "workflows": [
      {
        "name": "login",
        "file": "workflows/login.yml",
        "confidence": 0.82,
        "steps_count": 7,
        "screenshots_count": 3
      },
      {
        "name": "dashboard",
        "file": "workflows/dashboard.yml",
        "confidence": 0.95,
        "steps_count": 4,
        "screenshots_count": 2
      }
    ],
    "config_files": {
      ".megatest/config.yml": "version: \"1\"\nsetup:\n  install:\n    - npm ci\n  serve:\n    cmd: npm run dev\n    ready: http://localhost:3000\n...",
      ".megatest/workflows/login.yml": "name: login\nsteps:\n  - open: http://localhost:3000/login\n  - screenshot: login-page\n...",
      ".megatest/workflows/dashboard.yml": "name: dashboard\nsteps:\n  - include: login\n  - open: http://localhost:3000/dashboard\n  - screenshot: empty-state\n..."
    },
    "created_at": "2026-03-13T10:20:00Z"
  }
}
```

---

#### POST /api/v1/discoveries/:id/apply

Takes the discovery results and creates a pull request containing the
generated `.megatest/` configuration files. The PR is created on the config
repo (which may be the project repo itself when `config_repo_url` is null,
or a separate config repo when set).

**Response: 201**

```json
{
  "pr_url": "https://github.com/octocat/hello-world/pull/42"
}
```

**Response: 409** (discovery not yet completed)

```json
{
  "error": "conflict",
  "message": "Discovery has not completed yet"
}
```

---

## 4  Static Files

The Fastify server serves the SPA frontend and its assets.  These routes do
not require authentication -- the SPA handles login redirects client-side.

| Route pattern          | Behaviour |
|------------------------|-----------|
| `GET /`                | Serves `index.html` (SPA entry point). |
| `GET /project/:id`     | Serves `index.html` -- client-side router handles navigation. |
| `GET /review/:id`      | Serves `index.html` -- client-side router handles navigation. |
| `GET /ui/*`            | Serves static assets (JS, CSS, images, fonts) with cache headers. |

---

## 5  Pagination Convention

All list endpoints that support pagination use the same query parameters
and response envelope:

| Query param | Type   | Default | Constraints   |
|-------------|--------|---------|---------------|
| `page`      | number | 1       | >= 1          |
| `per_page`  | number | 20      | 1..100        |

The response always includes:

```json
{
  "<collection>": [...],
  "total": 142,
  "page": 2
}
```

`total` is the total number of items matching the filters (before
pagination).  The client can compute `total_pages = ceil(total / per_page)`.

---

## 6  Authentication & Authorisation Summary

| Endpoint group             | Auth mechanism              | Notes |
|----------------------------|-----------------------------|-------|
| `GET /auth/github`         | None                        | Starts OAuth flow. |
| `GET /auth/github/callback`| None (validates OAuth state)| Completes OAuth flow. |
| `GET /auth/me`             | Session cookie              | |
| `POST /auth/logout`        | Session cookie              | |
| `POST /api/webhooks/github`| HMAC-SHA256 signature       | `X-Hub-Signature-256` header. |
| `GET/POST/PATCH/DELETE /api/v1/*` | Session cookie or Bearer token | 401 if missing. 403 if user lacks access to the resource. Bearer token takes precedence when both are present. |
| `GET /`, `GET /ui/*`       | None                        | Public static files. |

---

## 7  Rate Limiting

The API applies rate limits per authenticated user:

| Scope              | Limit              |
|--------------------|--------------------|
| General API        | 120 requests / min |
| Image serving      | 300 requests / min |
| Webhook ingestion  | 600 requests / min |

When a limit is exceeded the server returns **429 Too Many Requests** with
a `Retry-After` header (in seconds).

---

## 8  Status and Result Enumerations

### Run status

| Value       | Description |
|-------------|-------------|
| `queued`    | Run created, waiting for a worker. |
| `cloning`   | Repository is being cloned. |
| `setting_up`| Environment setup is running. |
| `running`   | Workflows are being executed. |
| `comparing` | Screenshots are being compared. |
| `completed` | Run finished (inspect `result` for outcome). |
| `failed`    | Run terminated due to an infrastructure or configuration error. |
| `cancelled` | Run was cancelled by a user. |

### Run result

| Value      | Description |
|------------|-------------|
| `pass`     | All checkpoints passed within their thresholds. |
| `fail`     | One or more checkpoints failed or require review (`new`). |
| `error`    | The run failed due to an infrastructure or configuration error. |
| `null`     | Run has not completed yet. |

### Checkpoint status

| Value      | Description |
|------------|-------------|
| `pass`     | Diff is within threshold. |
| `fail`     | Diff exceeds threshold. |
| `new`      | No baseline exists -- requires initial approval. |
| `error`    | Screenshot capture or comparison failed. |

### Review state

| Value       | Description |
|-------------|-------------|
| `none`      | No review was required (`pass` / `error`). |
| `pending`   | Checkpoint is `fail` or `new` and awaiting review. |
| `approved`  | Latest review action approved the checkpoint. |
| `rejected`  | Latest review action rejected the checkpoint. |

### Discovery status

| Value       | Description |
|-------------|-------------|
| `queued`    | Discovery job created. |
| `running`   | AI analysis in progress. |
| `completed` | Discovery finished; results available. |
| `failed`    | Discovery encountered an error. |
