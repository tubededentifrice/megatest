# 13 - Trigger Rules

Status: Draft

Trigger rules define which GitHub events cause Megatest visual test runs for a given project. They are server-side project settings (not part of the `.megatest/` config schema) because:

- Trigger config is operational ("when to run"), not test definition ("what to test").
- Trigger rules need to be evaluated BEFORE the repo is cloned (can't read config from a repo you haven't cloned yet).
- Avoids a bootstrap problem for first-time setup.

---

## 1. Overview

Each project has a `trigger_rules` JSONB column on the `projects` table (spec 03). This column holds an array of rule objects that the webhook handler evaluates when a GitHub event arrives. If any rule matches the incoming event, a run is created. If no rule matches, the webhook is acknowledged (200) but no run is created.

Trigger rules are distinct from the `.megatest/` config schema (spec 02), which defines *what* to test. Trigger rules define *when* to test. The config schema note in spec 02 explicitly defers trigger configuration to this spec.

Key design points:

- **Server-side only.** Trigger rules are stored in the database and managed through the API/UI. They are never read from the repository.
- **Evaluated before cloning.** The webhook handler checks trigger rules against the event payload before any worker job is enqueued. No repository checkout is needed.
- **Per-project.** Each project has its own trigger rules. There is no global or org-level trigger config.
- **Manual runs bypass trigger rules.** A run created via `POST /api/v1/projects/:id/runs` (spec 04) always proceeds regardless of trigger rules.
- **Merged-PR events bypass trigger rules.** `pull_request.closed` with `merged=true` always proceeds for baseline promotion and route detection (spec 06, section 9; spec 12).

---

## 2. Rule Format

Trigger rules are stored as a JSONB value in the `projects.trigger_rules` column. The top-level structure is an object with a `triggers` array. Each element of the array is a rule object that specifies an event type and optional conditions.

### Schema

```json
{
  "triggers": [
    {
      "event": "pull_request",
      "actions": ["opened", "synchronize", "reopened"],
      "base_branches": ["main", "release/*"],
      "head_branches": ["*"]
    },
    {
      "event": "push",
      "branches": ["main", "release/*"]
    }
  ]
}
```

### Fields

#### Rule object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `event` | string | yes | GitHub event type: `push` or `pull_request` |
| `actions` | string[] | no | For `pull_request` only: which PR actions to match. Default: `["opened", "synchronize", "reopened"]` |
| `branches` | string[] | no | For `push` only: which branches to match. Supports glob patterns. Default: `["*"]` (all branches) |
| `base_branches` | string[] | no | For `pull_request` only: match PRs targeting these base branches. Supports glob patterns. Default: `["*"]` |
| `head_branches` | string[] | no | For `pull_request` only: match PRs from these head branches. Supports glob patterns. Default: `["*"]` |

Fields that do not apply to the given event type are ignored. For example, `branches` on a `pull_request` rule is ignored, and `actions` on a `push` rule is ignored.

### Empty Triggers

If `triggers` is an empty array `[]`, no events will create runs. The project is effectively paused. Runs can still be triggered manually via the API or UI.

If `triggers` is null or undefined (not yet configured), the project has no trigger rules and no events will create runs. The UI should prompt the user to configure trigger rules (see section 8).

---

## 3. Branch Patterns

Branch patterns use glob-style matching. The matching algorithm is applied to the bare branch name (e.g., `main`, not `refs/heads/main`).

### Pattern syntax

| Pattern | Matches | Does NOT Match |
|---------|---------|----------------|
| `main` | `main` | `main-v2`, `my-main` |
| `release/*` | `release/1.0`, `release/hotfix` | `release/1.0/patch`, `releases/1.0` |
| `release/**` | `release/1.0`, `release/1.0/patch` | `releases/1.0` |
| `feature/*` | `feature/login`, `feature/dashboard` | `feature/auth/login` |
| `*` | Any branch | (matches everything) |
| `!experimental/*` | Any branch NOT matching `experimental/*` | `experimental/test` |

- `*` matches any sequence of characters except `/`.
- `**` matches any sequence of characters including `/` (recursive).
- Literal characters match themselves. No regex syntax is supported.

### Negation patterns

Patterns starting with `!` are negation patterns. They exclude branches that would otherwise match. Negation patterns are evaluated after positive patterns:

1. A branch must match at least one positive pattern (non-`!` pattern).
2. A branch must not match any negation pattern.

If all patterns are negation patterns (no positive patterns), no branches will match.

### Examples

```
["main", "release/*"]
  → matches: main, release/1.0, release/hotfix
  → does not match: develop, feature/login

["*", "!experimental/*"]
  → matches: main, develop, feature/login
  → does not match: experimental/test, experimental/beta

["release/**", "!release/nightly/**"]
  → matches: release/1.0, release/1.0/patch
  → does not match: release/nightly/2026-03-13, main
```

### Implementation

```ts
function matchesAnyPattern(branch: string, patterns: string[]): boolean {
  const positive = patterns.filter(p => !p.startsWith('!'));
  const negative = patterns.filter(p => p.startsWith('!')).map(p => p.slice(1));

  // Must match at least one positive pattern
  if (positive.length === 0) return false;
  const matchesPositive = positive.some(p => globMatch(branch, p));
  if (!matchesPositive) return false;

  // Must not match any negation pattern
  const matchesNegative = negative.some(p => globMatch(branch, p));
  return !matchesNegative;
}

function globMatch(value: string, pattern: string): boolean {
  // Convert glob pattern to regex:
  //   ** → .*        (matches everything including /)
  //   *  → [^/]*     (matches everything except /)
  //   ?  → [^/]      (matches single char except /)
  //   All other chars are escaped for regex safety.
  const regex = pattern
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/{{GLOBSTAR}}/g, '.*');
  return new RegExp(`^${regex}$`).test(value);
}
```

---

## 4. Evaluation Logic

When a webhook arrives at `POST /api/webhooks/github`, the API server evaluates trigger rules before creating a run. This evaluation happens inline in the webhook handler (spec 06, sections 4.1 and 4.2).

### Algorithm

```
function shouldCreateRun(project, event, payload):
    rules = project.trigger_rules

    if rules is null or rules.triggers is empty:
        return false  // No rules configured, no runs

    for rule in rules.triggers:
        if rule.event != event:
            continue

        if event == 'push':
            branch = extractBranch(payload.ref)  // strip refs/heads/
            if matchesAnyPattern(branch, rule.branches || ['*']):
                return true

        if event == 'pull_request':
            action = payload.action
            baseBranch = payload.pull_request.base.ref
            headBranch = payload.pull_request.head.ref

            if action not in (rule.actions || ['opened', 'synchronize', 'reopened']):
                continue
            if not matchesAnyPattern(baseBranch, rule.base_branches || ['*']):
                continue
            if not matchesAnyPattern(headBranch, rule.head_branches || ['*']):
                continue
            return true

    return false
```

The function `extractBranch` strips the `refs/heads/` prefix from the `ref` field in push payloads. For example, `refs/heads/main` becomes `main`.

### Special Cases

#### 1. Merged PRs

`pull_request.closed` with `merged=true` is **always processed** regardless of trigger rules. This event drives two critical operations that must not be blocked by trigger config:

- **Baseline promotion** (spec 06, section 9): approved baselines from the PR are promoted to the default branch.
- **Route detection** (spec 12): the merged diff is analyzed for new routes that may need workflow coverage.

The webhook handler checks for the merged-PR case before evaluating trigger rules.

#### 2. Manual triggers

Runs created via `POST /api/v1/projects/:id/runs` (spec 04, section 3.2) are **always allowed** regardless of trigger rules. The API creates a run with `trigger: 'manual'`. The trigger rule check is only performed in the webhook handler, not in the manual run creation endpoint.

#### 3. Installation events

`installation.created`, `installation.deleted`, and `installation_repositories.*` events are **not affected** by trigger rules. These events manage the GitHub App installation lifecycle and are always processed.

#### 4. Multiple matching rules

If multiple rules match the same event, only one run is created. The evaluation short-circuits on the first matching rule.

#### 5. Tag pushes

Pushes to tags (`refs/tags/*`) are ignored. The `extractBranch` function returns null for tag refs, and the evaluation returns false.

---

## 5. Templates

The UI provides pre-built templates for common configurations. Templates are a UI convenience -- they populate the trigger rules form with a known-good configuration. The API does not enforce templates; any valid rule set is accepted.

### PRs Only

```json
{
  "triggers": [
    {
      "event": "pull_request",
      "actions": ["opened", "synchronize", "reopened"]
    }
  ]
}
```

**Best for:** Most projects. Visual tests run when PRs are opened or updated. Lowest usage -- keeps screenshot counts low on the free tier.

**Template key:** `prs_only`

### PRs + Default Branch

```json
{
  "triggers": [
    {
      "event": "pull_request",
      "actions": ["opened", "synchronize", "reopened"]
    },
    {
      "event": "push",
      "branches": ["main"]
    }
  ]
}
```

**Best for:** Projects that want to maintain baselines on every merge to main. Catches direct pushes that bypass the PR flow. Recommended default for most teams.

**Template key:** `prs_plus_default`

### All Pushes and PRs

```json
{
  "triggers": [
    {
      "event": "pull_request",
      "actions": ["opened", "synchronize", "reopened"]
    },
    {
      "event": "push",
      "branches": ["*"]
    }
  ]
}
```

**Best for:** Maximum coverage. Every branch push gets visual testing. Highest usage -- best for paid tiers where screenshot quotas are larger.

**Template key:** `all`

### Manual Only

```json
{
  "triggers": []
}
```

**Best for:** Projects where runs are triggered only via the API or UI. No automatic runs from webhooks. Useful for cost-sensitive projects or projects that integrate Megatest into a custom CI pipeline.

**Template key:** `manual_only`

### Template Detection

The API response for `GET /api/v1/projects/:id/triggers` includes a `template` field that indicates which pre-built template matches the current config, or `"custom"` if it does not match any template. Template detection is performed by comparing the stored trigger rules against each template's structure.

```ts
function detectTemplate(triggerRules: TriggerRules): string {
  if (!triggerRules || triggerRules.triggers.length === 0) return 'manual_only';

  // Compare against known templates by deep equality
  for (const [key, template] of Object.entries(TEMPLATES)) {
    if (deepEqual(triggerRules, template)) return key;
  }
  return 'custom';
}
```

---

## 6. API

Trigger rules are managed through two endpoints on the project resource. These endpoints are documented in brief in spec 04, section 3.8. This section provides the full specification.

### GET /api/v1/projects/:id/triggers

Returns the current trigger configuration for a project.

**Authorization:** User must be a member of the project's organization.

**Response: 200**

```json
{
  "triggers": [
    {
      "event": "pull_request",
      "actions": ["opened", "synchronize", "reopened"]
    },
    {
      "event": "push",
      "branches": ["main", "release/*"]
    }
  ],
  "template": "custom"
}
```

The `template` field indicates which pre-built template matches the current config, or `"custom"` if it does not match any template (see section 5).

**Response: 200** (no triggers configured)

```json
{
  "triggers": null,
  "template": null
}
```

When `triggers` is null, the project has no trigger rules configured. The UI should show the onboarding prompt (section 8).

### PUT /api/v1/projects/:id/triggers

Replaces the trigger configuration for a project. The entire trigger rules object is replaced atomically -- there is no partial update.

**Authorization:** User must have `admin` or `owner` role in the project's organization. Members cannot modify trigger rules.

**Request body:**

```json
{
  "triggers": [
    {
      "event": "pull_request",
      "actions": ["opened", "synchronize", "reopened"]
    },
    {
      "event": "push",
      "branches": ["main"]
    }
  ]
}
```

**Response: 200**

```json
{
  "triggers": [
    {
      "event": "pull_request",
      "actions": ["opened", "synchronize", "reopened"]
    },
    {
      "event": "push",
      "branches": ["main"]
    }
  ],
  "template": "prs_plus_default"
}
```

**Response: 422** (invalid rule format)

```json
{
  "error": "unprocessable",
  "message": "Invalid trigger rule: 'event' must be 'push' or 'pull_request'",
  "details": [
    {
      "index": 0,
      "field": "event",
      "value": "tag",
      "message": "Must be 'push' or 'pull_request'"
    }
  ]
}
```

### Validation Rules

The PUT endpoint validates the request body before saving. Validation errors return 422 with a `details` array describing each invalid field.

| Rule | Error message |
|------|---------------|
| `triggers` is not an array | `'triggers' must be an array` |
| Rule object missing `event` field | `'event' is required` |
| `event` is not `push` or `pull_request` | `'event' must be 'push' or 'pull_request'` |
| `actions` contains an invalid action | `Invalid action '{value}'. Allowed: opened, synchronize, reopened, closed` |
| `actions` is set on a `push` rule | `'actions' is not valid for push rules; use 'branches' instead` |
| `branches` is set on a `pull_request` rule | `'branches' is not valid for pull_request rules; use 'base_branches' or 'head_branches'` |
| `branches` / `base_branches` / `head_branches` contains an empty string | `Branch pattern must not be empty` |
| A branch pattern contains invalid glob syntax | `Invalid glob pattern: '{value}'` |
| `triggers` array exceeds 20 rules | `Maximum of 20 trigger rules allowed` |

#### Valid PR actions

The following `actions` values are accepted for `pull_request` rules: `opened`, `synchronize`, `reopened`, `closed`. Note that `closed` is accepted in the schema but is not useful for triggering runs -- the merged-PR handler runs unconditionally (see section 4). Including `closed` in the actions list has no effect.

#### Glob syntax validation

A branch pattern is considered invalid if it contains unbalanced brackets, consecutive `**` without a separator (e.g., `***`), or characters that would produce an invalid regex.

---

## 7. UI

The trigger rules editor appears in the project settings tab (spec 07, section on Settings). It provides both a template picker for quick setup and a manual editor for custom configurations.

### Layout

```
Trigger Rules
────────────────
Configure which GitHub events trigger visual test runs.

Quick setup: [PRs only] [PRs + main] [All] [Manual only]

─── or configure manually ───

☑ Pull Requests
  Actions: ☑ opened  ☑ synchronize  ☑ reopened
  Target branches: [main, release/*              ]
  Source branches: [*                             ]

☑ Pushes
  Branches: [main                                ]

[Save trigger rules]
```

### Behavior

- **Template buttons** fill in the form fields with the corresponding template configuration. Selecting a template replaces all current form values.
- **Manual changes** to any form field switch the template indicator to "Custom". The template buttons become unselected.
- **Save** sends a `PUT /api/v1/projects/:id/triggers` request. On success, a toast notification confirms the save. On validation error (422), the error messages are displayed inline next to the offending fields.
- **Branch fields** accept comma-separated values. Each value is trimmed of whitespace. Glob patterns (`*`, `**`, `!prefix/*`) are supported and validated on save.
- **Action checkboxes** control the `actions` array for the `pull_request` rule. At least one action must be checked if the Pull Requests checkbox is enabled.
- **Disabling both checkboxes** (Pull Requests and Pushes both unchecked) produces an empty `triggers: []` array, equivalent to the "Manual only" template.

### Initial State

When a project has no trigger rules configured (`trigger_rules = null`), the settings tab shows a configuration prompt instead of the form:

```
Trigger Rules
────────────────
No trigger rules configured. Set up trigger rules to enable automatic
visual testing from GitHub events.

Quick setup:
  [PRs only]  [PRs + main]  [All]  [Manual only]

Or configure manually below.
```

### Template Indicator

When the current trigger rules match a known template, the corresponding template button appears highlighted/selected in the UI. This provides at-a-glance visibility into the current configuration without reading the form fields.

---

## 8. Migration for Existing Projects

When trigger rules are introduced, existing projects that were created before this feature have `trigger_rules = null`. The system handles this as follows:

### Default behavior for null trigger rules

- `null` trigger rules means no automatic runs. Webhooks are acknowledged but no runs are created.
- The project page shows a prompt: "Configure trigger rules to enable automatic visual testing."
- Manual runs (via the API or UI) continue to work normally.

### Migration path

There is no automatic migration of existing projects. The null state is intentional -- it requires the project admin to make an explicit decision about which events should trigger runs. This prevents unexpected run creation and quota usage after the feature is deployed.

The admin API provides a bulk-set endpoint for operators who want to apply a default configuration to existing projects:

```
POST /admin/projects/bulk-set-triggers
```

**Request body:**

```json
{
  "filter": {
    "trigger_rules_null": true,
    "is_active": true
  },
  "trigger_rules": {
    "triggers": [
      {
        "event": "pull_request",
        "actions": ["opened", "synchronize", "reopened"]
      }
    ]
  },
  "reason": "Set default trigger rules for existing projects during migration"
}
```

**Response: 200**

```json
{
  "updated_count": 47,
  "skipped_count": 3
}
```

The `skipped_count` includes projects that already have trigger rules configured (not null). The endpoint never overwrites existing trigger rules.

### New project onboarding

New projects are prompted to set trigger rules during onboarding (spec 10). The onboarding wizard suggests the "PRs only" template as the default and explains each option. The project is not fully set up until trigger rules are configured, though manual runs can be started without them.

---

## 9. Database

Trigger rules are stored in the `projects.trigger_rules` JSONB column (spec 03). No additional tables are required.

### Column definition

```sql
-- Already defined in spec 03, projects table:
trigger_rules     JSONB,                      -- per-project trigger configuration (see spec 13)
```

### Index

No index is needed on `trigger_rules`. Trigger rule evaluation queries the project by `repo_id` (already indexed via the `UNIQUE(repo_id)` constraint) and then reads the `trigger_rules` column from the matched row. There is no need to query by trigger rule content.

### Example values

**PRs only:**
```json
{"triggers": [{"event": "pull_request", "actions": ["opened", "synchronize", "reopened"]}]}
```

**Not configured:**
```sql
NULL
```

**Manual only (paused):**
```json
{"triggers": []}
```

---

## 10. Cross-Spec References

This spec is referenced by and interacts with the following specs:

| Spec | Section | Interaction |
|------|---------|-------------|
| 02 - Config Schema | Note after section 1 | Config schema explicitly defers trigger configuration to this spec. |
| 03 - Data Model | `projects` table | `trigger_rules` JSONB column stores the trigger configuration. |
| 04 - API | Section 2.1 (webhooks) | Webhook handler evaluates trigger rules before creating runs. |
| 04 - API | Section 3.8 | `GET/PUT /api/v1/projects/:id/triggers` endpoints. |
| 06 - GitHub | Sections 4.1, 4.2 | Push and pull_request webhook handlers check trigger rules. Merged PRs bypass trigger rules. |
| 07 - Review UI | Project settings tab | Trigger rules editor UI. |
| 09 - SaaS Platform | Quotas | Trigger rules affect run volume, which affects screenshot quota consumption. |
| 10 - Onboarding | Project setup | New projects are prompted to configure trigger rules during onboarding. |
