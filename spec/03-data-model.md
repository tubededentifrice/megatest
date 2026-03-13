# 03 - Data Model

This document defines the database schema for Megatest. All SQL is written to be compatible with both SQLite and PostgreSQL: UUIDs are stored as TEXT, timestamps as DATETIME, and structured data as JSON.

Application code is responsible for generating UUIDs (v4) before insertion.

---

## Tables

### users

GitHub OAuth users.

```sql
CREATE TABLE users (
    id                  TEXT PRIMARY KEY,          -- uuid v4
    github_id           INTEGER NOT NULL UNIQUE,
    github_login        TEXT NOT NULL,             -- username (e.g. "octocat")
    github_name         TEXT,                      -- display name
    github_email        TEXT,                      -- primary verified email, if available
    github_avatar_url   TEXT,
    github_access_token TEXT NOT NULL,             -- encrypted at rest
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### github_installations

GitHub App installations on user or organization accounts. Created/updated via GitHub App webhook events (`installation` and `installation_repositories`).

```sql
CREATE TABLE github_installations (
    id                TEXT PRIMARY KEY,            -- uuid v4
    installation_id   INTEGER NOT NULL UNIQUE,    -- GitHub's numeric installation ID
    account_type      TEXT NOT NULL,              -- "user" | "organization"
    account_login     TEXT NOT NULL,              -- org or user login
    account_id        INTEGER NOT NULL,           -- GitHub's numeric account ID
    permissions       JSON,                       -- permissions granted to the installation
    status            TEXT NOT NULL DEFAULT 'active', -- active|deleted
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### installation_repositories

Repositories currently accessible through a GitHub App installation. This table
drives the repo picker in the UI and is maintained from
`installation.created` / `installation_repositories.*` webhook events.

```sql
CREATE TABLE installation_repositories (
    id                TEXT PRIMARY KEY,            -- uuid v4
    installation_id   TEXT NOT NULL REFERENCES github_installations(id),
    repo_id           INTEGER NOT NULL,
    repo_name         TEXT NOT NULL,
    repo_full_name    TEXT NOT NULL,
    is_active         BOOLEAN DEFAULT true,
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(installation_id, repo_id)
);
```

### projects

Connected repositories. A project is created when a user selects a repo from an active installation.

```sql
CREATE TABLE projects (
    id                TEXT PRIMARY KEY,            -- uuid v4
    installation_id   TEXT NOT NULL REFERENCES github_installations(id),
    name              TEXT NOT NULL,              -- "org/repo"
    repo_url          TEXT NOT NULL,              -- https clone URL
    repo_id           INTEGER NOT NULL,           -- GitHub's numeric repo ID
    default_branch    TEXT DEFAULT 'main',
    settings          JSON,                       -- operational settings only (e.g. branch filters, run timeout)
    secrets           JSON,                       -- encrypted project secrets for ${env:VAR}
    is_active         BOOLEAN DEFAULT true,
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(repo_id)
);
```

### runs

One execution triggered by a commit push or pull request event. A run walks through a lifecycle of statuses and, on completion, records a final result.

```sql
CREATE TABLE runs (
    id                TEXT PRIMARY KEY,            -- uuid v4
    project_id        TEXT NOT NULL REFERENCES projects(id),
    trigger           TEXT NOT NULL,              -- "push" | "pull_request" | "manual"
    branch            TEXT NOT NULL,              -- head branch
    commit_sha        TEXT NOT NULL,
    base_branch       TEXT,                       -- target branch (for PRs)
    base_sha          TEXT,                       -- target SHA (for PRs)
    pr_number         INTEGER,
    status            TEXT DEFAULT 'queued',      -- queued|cloning|setting_up|running|comparing|completed|failed|cancelled
    result            TEXT,                       -- pass|fail|error (set when status = completed)
    error_message     TEXT,
    config_snapshot   JSON,                       -- parsed .megatest/ config at time of run
    started_at        DATETIME,
    completed_at      DATETIME,
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

Status lifecycle:

```
queued -> cloning -> setting_up -> running -> comparing -> completed
                                                        -> failed
Any state -----------------------------------------> cancelled
```

### checkpoints

Individual screenshots captured within a run. Each checkpoint belongs to a workflow and is identified by the combination of workflow name, checkpoint name, and viewport.

```sql
CREATE TABLE checkpoints (
    id                  TEXT PRIMARY KEY,          -- uuid v4
    run_id              TEXT NOT NULL REFERENCES runs(id),
    workflow            TEXT NOT NULL,             -- workflow name from config
    name                TEXT NOT NULL,             -- screenshot/checkpoint name
    viewport            TEXT NOT NULL,             -- viewport name or "WxH" (e.g. "desktop" or "1280x720")
    status              TEXT NOT NULL,             -- pass|fail|new|error
    diff_reason         TEXT,                      -- e.g. "dimension_mismatch"
    diff_percent        REAL,                     -- percentage of pixels that differ
    threshold           REAL NOT NULL,            -- configured threshold at time of comparison
    pixel_count         INTEGER,                  -- total pixels in image
    diff_pixels         INTEGER,                  -- number of differing pixels
    dimensions          JSON,                     -- { "width": N, "height": N }
    baseline_dimensions JSON,                     -- { "width": N, "height": N } (null if new)
    error_message       TEXT,
    actual_path         TEXT,                     -- storage path to captured screenshot
    baseline_path       TEXT,                     -- storage path to baseline used for comparison
    diff_path           TEXT,                     -- storage path to diff image
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### baselines

The approved source-of-truth image for a given project, branch, workflow, checkpoint, and viewport combination. There is exactly one active baseline per combination at any time.

```sql
CREATE TABLE baselines (
    id              TEXT PRIMARY KEY,              -- uuid v4
    project_id      TEXT NOT NULL REFERENCES projects(id),
    branch          TEXT NOT NULL,
    workflow        TEXT NOT NULL,
    checkpoint      TEXT NOT NULL,                -- checkpoint name
    viewport        TEXT NOT NULL,
    storage_path    TEXT NOT NULL,                -- path in storage backend
    approved_from   TEXT REFERENCES runs(id),     -- the run that produced the approved image
    approved_by     TEXT REFERENCES users(id),    -- the user who approved it
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, branch, workflow, checkpoint, viewport)
);
```

### approvals

Audit trail of approve and reject actions taken on checkpoints. Every user action on a diff is recorded here, regardless of outcome.

```sql
CREATE TABLE approvals (
    id              TEXT PRIMARY KEY,              -- uuid v4
    checkpoint_id   TEXT NOT NULL REFERENCES checkpoints(id),
    run_id          TEXT NOT NULL REFERENCES runs(id),
    action          TEXT NOT NULL,                -- "approve" | "reject"
    user_id         TEXT REFERENCES users(id),   -- nullable for system-generated actions
    comment         TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

The latest approval row for a checkpoint is the source of truth for its
current review state:

- No approval rows: review state = `pending`
- Latest action = `approve`: review state = `approved`
- Latest action = `reject`: review state = `rejected`

Execution status on `checkpoints.status` remains immutable (`pass|fail|new|error`)
and never changes to `approved` or `rejected`.

### discoveries

Asynchronous discovery jobs and their generated outputs.

```sql
CREATE TABLE discoveries (
    id                TEXT PRIMARY KEY,            -- uuid v4
    project_id        TEXT NOT NULL REFERENCES projects(id),
    branch            TEXT NOT NULL,
    status            TEXT NOT NULL,              -- queued|running|completed|failed
    error_phase       TEXT,
    error_message     TEXT,
    report            JSON,                       -- discovery report metadata
    workflows         JSON,                       -- generated workflow summaries
    config_files      JSON,                       -- generated file contents keyed by relative .megatest path
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at      DATETIME
);
```

### webhook_deliveries

Webhook idempotency and delivery audit. Every GitHub delivery UUID is recorded
before side effects are committed.

```sql
CREATE TABLE webhook_deliveries (
    id                TEXT PRIMARY KEY,            -- uuid v4
    provider          TEXT NOT NULL,              -- "github"
    delivery_id       TEXT NOT NULL,              -- X-GitHub-Delivery
    event_name        TEXT NOT NULL,
    processed_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    outcome           TEXT NOT NULL,              -- processed|ignored|failed
    error_message     TEXT,
    UNIQUE(provider, delivery_id)
);
```

---

## Indexes

Indexes for the most common query patterns.

```sql
-- Find runs for a project filtered by status (e.g. "show me all running jobs")
CREATE INDEX idx_runs_project_status ON runs(project_id, status);

-- Find runs for a project filtered by branch (e.g. "runs on main", "runs on feature-x")
CREATE INDEX idx_runs_project_branch ON runs(project_id, branch);

-- List all checkpoints for a run (the primary view when inspecting a run)
CREATE INDEX idx_checkpoints_run_id ON checkpoints(run_id);

-- Look up baselines for a project + branch (used during comparison phase)
CREATE INDEX idx_baselines_project_branch ON baselines(project_id, branch);

-- Resolve current review state quickly
CREATE INDEX idx_approvals_checkpoint_created_at ON approvals(checkpoint_id, created_at);

-- Repo picker
CREATE INDEX idx_installation_repositories_installation_id ON installation_repositories(installation_id, is_active);

-- Discovery history
CREATE INDEX idx_discoveries_project_created_at ON discoveries(project_id, created_at);
```

---

## Baseline Resolution Logic

When a run reaches the `comparing` phase, each checkpoint must be compared against a baseline. The resolution algorithm determines which baseline image to use.

### Algorithm

1. **PR runs** (`trigger = "pull_request"`): Look for a baseline matching `(project_id, base_branch, workflow, checkpoint, viewport)`. The base branch is the PR's target branch (e.g. `main`). This ensures PR diffs are computed against the merged state of the target branch.

2. **Push to default branch** (`trigger = "push"` and `branch = project.default_branch`): Look for a baseline matching `(project_id, branch, workflow, checkpoint, viewport)` on the same branch. This baseline was set by the previous approved run.

3. **Push to non-default branch**: Same lookup as push to default branch -- `(project_id, branch, workflow, checkpoint, viewport)`. If no branch-specific baseline exists, falls back to the default branch baseline.

4. **No baseline found**: The checkpoint status is set to `"new"`. It will appear in the review UI for approval. No diff image is generated.

5. **Baseline found**: The actual screenshot is compared pixel-by-pixel against the baseline image. If `diff_percent > threshold`, the checkpoint status is `"fail"`. Otherwise, it is `"pass"`.

### Pseudocode

```
function resolve_baseline(project, run, checkpoint):
    if run.trigger == "pull_request":
        branch = run.base_branch
    else:
        branch = run.branch

    baseline = query baselines WHERE
        project_id = project.id
        AND branch = branch
        AND workflow = checkpoint.workflow
        AND checkpoint = checkpoint.name
        AND viewport = checkpoint.viewport

    if baseline is NULL and branch != project.default_branch:
        baseline = query baselines WHERE
            project_id = project.id
            AND branch = project.default_branch
            AND workflow = checkpoint.workflow
            AND checkpoint = checkpoint.name
            AND viewport = checkpoint.viewport

    return baseline  -- may be NULL (checkpoint is "new")
```

---

## Baseline Promotion on Merge

When a pull request is merged (detected via `pull_request.closed` webhook with `merged = true`):

1. Find the most recent completed run for that PR (`project_id`, `pr_number`, `status = 'completed'`).
2. For each checkpoint in that run that was **approved** (has a corresponding entry in `approvals` with `action = 'approve'`):
   - Upsert the `baselines` row for `(project_id, default_branch, workflow, checkpoint, viewport)` with the actual image from the approved checkpoint.
   - The `approved_from` and `approved_by` fields are carried forward from the approval record.
3. Checkpoints that were **not approved** or were **rejected** are not promoted. Their diffs will appear again on the next run against the default branch.

This ensures that only explicitly reviewed and accepted visual changes reach the default branch baselines.

---

## Storage Path Convention

All images are stored under a consistent path hierarchy. The storage backend (local filesystem for single-node, S3-compatible for scaled deployments) uses the same logical paths.

```
{project_id}/{run_id}/{workflow}/{checkpoint}/{viewport}/actual.png
{project_id}/{run_id}/{workflow}/{checkpoint}/{viewport}/diff.png
{project_id}/baselines/{branch}/{workflow}/{checkpoint}/{viewport}/baseline.png
```

### Examples

```
a1b2c3d4/.../checkout/cart-page/desktop/actual.png
a1b2c3d4/.../checkout/cart-page/desktop/diff.png
a1b2c3d4/baselines/main/checkout/cart-page/desktop/baseline.png
```

- `actual.png` -- the screenshot captured during the run.
- `diff.png` -- the visual diff overlay (only generated when a baseline exists and `diff_percent > 0`).
- `baseline.png` -- the approved source-of-truth image.

Run images are immutable once written. Baseline images are replaced in-place when a new baseline is approved (the old baseline is not preserved in the baselines path; the historical actual image is still available under the original run's path).
