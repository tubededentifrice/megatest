# 11 - Config Storage

Megatest supports three config storage modes per project. The YAML format
(spec 02) is identical in all modes. Only the storage location and access
mechanism differ.

---

## 1. Overview

Every Megatest project has a `config_storage_mode` column (on the `projects`
table) that determines where the `.megatest/` configuration files live and how
workers, discovery, and the API interact with them. The three modes are:

| Mode | Value | Location |
|------|-------|----------|
| Repo-side | `repo` | `.megatest/` directory in the project's repository |
| Server-side | `server` | `project_configs` table in Megatest's database |
| Config repo | `config_repo` | `.megatest/` directory in a separate Git repository |

Regardless of mode, all files conform to the schema defined in spec 02. The
`version` field in `config.yml` must be present and valid. Validation rules
apply identically across all modes.

---

## 2. Storage Modes

### 2.1 Repo-Side (Default)

Config lives in the `.megatest/` directory in the project's repository. This
is the default mode for all new projects.

- Workers read config by cloning the repo and reading files from disk.
- Discovery creates PRs to add or update config files.
- Config changes are version-controlled alongside application code.
- Team members can review config changes in PR diffs.

**Advantages:** Version-controlled, reviewable, transparent.

**Disadvantages:** Requires PR merge before config takes effect, adds files to
the repo.

### 2.2 Server-Side

Config is stored in Megatest's database (`project_configs` table). No files
are committed to the project's repository.

- Workers fetch config from the Megatest API (internal endpoint).
- Discovery stores results directly in the database.
- Config changes take effect immediately (no PR merge needed).
- Config is editable via the Megatest UI or API.

**Advantages:** No repo changes, instant config updates, works for repos where
Megatest cannot push.

**Disadvantages:** Not version-controlled, not reviewable in PRs, less
transparent to the team.

**Use cases:**

- Projects where Megatest does not have write access to the repo.
- Projects that prefer to keep their repo clean of tooling config.
- Rapid iteration during initial setup.

### 2.3 Config Repo

Config lives in the `.megatest/` directory in a separate Git repository. The
config repo can be user-controlled or Megatest-controlled.

- Workers clone both the project repo (for app code) and the config repo (for
  test config).
- Discovery creates PRs on the config repo, not the main project repo.
- Provides version control and PR review without cluttering the main repo.

**Advantages:** Version-controlled, reviewable, keeps main repo clean.

**Disadvantages:** Extra repository to manage, slightly more complex cloning.

**Configuration:**

| Setting | Column / Field | Description |
|---------|---------------|-------------|
| Config repo URL | `projects.config_repo_url` | HTTPS clone URL of the config repo |
| Config repo branch | `projects.settings->config_repo_branch` | Branch to use (default: the repo's default branch) |
| Config repo path | `projects.settings->config_repo_path` | Subdirectory within the config repo (default: root) |

The config repo must be accessible via the same GitHub App installation as the
main project repo, or via a separate installation if the repos are in different
orgs.

**Directory structure -- shared config repo (one repo serves multiple projects):**

```
config-repo/
  {project-name}/
    config.yml
    workflows/
      homepage.yml
      login.yml
    includes/
      login.yml
```

**Directory structure -- dedicated config repo (one repo per project):**

```
config-repo/
  config.yml
  workflows/
    homepage.yml
    login.yml
  includes/
    login.yml
```

The `config_repo_path` setting specifies the subdirectory within the config
repo. When set to `""` or omitted, files are read from the repository root.

---

## 3. Mode Selection

### Per-Project Setting

Storage mode is configured per-project via:

- **API:** `PATCH /api/v1/projects/:id/config-mode`
- **UI:** Project settings -> Config Storage section

### API Endpoint

```
PATCH /api/v1/projects/:id/config-mode
Content-Type: application/json

{
  "mode": "repo" | "server" | "config_repo",
  "config_repo_url": "https://github.com/org/megatest-config.git",
  "config_repo_branch": "main",
  "config_repo_path": "my-project"
}
```

The `config_repo_url`, `config_repo_branch`, and `config_repo_path` fields are
required when `mode` is `config_repo` and ignored otherwise.

**Response (200 OK):**

```json
{
  "mode": "config_repo",
  "migration": {
    "status": "pr_created",
    "pr_url": "https://github.com/org/megatest-config/pull/42"
  }
}
```

**Response when no migration is needed (e.g., project has no existing config):**

```json
{
  "mode": "server",
  "migration": null
}
```

### Default

New projects default to `repo` mode.

### Switching Modes

When switching between modes, existing config is migrated automatically. The
migration is triggered by the mode switch API call and its status is included
in the response.

| From | To | Migration |
|------|-----|-----------|
| repo -> server | Config files are read from the repo and stored in the database. `.megatest/` directory remains in the repo (not deleted). |
| repo -> config_repo | Config files are copied from the main repo to the config repo via a PR. `.megatest/` directory remains in the main repo. |
| server -> repo | Config files from the database are committed to the repo via a PR. |
| server -> config_repo | Config files from the database are committed to the config repo via a PR. |
| config_repo -> repo | Config files are copied from the config repo to the main repo via a PR. |
| config_repo -> server | Config files from the config repo are read and stored in the database. |

**Migration rules:**

- Migrations that write to a Git repository always create a PR (never commit
  directly to the default branch).
- Migrations that write to the database take effect immediately.
- The source config is never deleted during migration. The `.megatest/`
  directory in the source repo remains intact.
- If the migration creates a PR, the mode switch takes effect immediately on
  the `projects` row. The PR is informational -- future runs will read config
  from the new location even before the PR is merged.
- If no config exists in the source location, the migration is a no-op and
  `migration` in the response is `null`.

---

## 4. Worker Config Resolution

When a worker starts processing a run, it resolves config based on
`project.config_storage_mode`. The storage mode and config repo settings are
included in the job data so the worker does not need to query the API for
project settings.

### Job Data Fields

The `RunJob` interface (spec 05) is extended with these fields:

```ts
interface RunJob {
  // ... existing fields from spec 05 ...
  configStorageMode: 'repo' | 'server' | 'config_repo';
  configRepoUrl: string | null;      // only set when mode = config_repo
  configRepoBranch: string | null;    // only set when mode = config_repo
  configRepoPath: string | null;      // only set when mode = config_repo
}
```

### Resolution Algorithm

```
function resolveConfig(job):
    mode = job.configStorageMode

    if mode == 'repo':
        // Config is in the cloned repo at .megatest/
        return parseConfigFromDirectory(job.repoDir + '/.megatest/')

    if mode == 'server':
        // Fetch from internal API
        response = GET /internal/projects/{job.projectId}/config
        return parseConfigFromMap(response.files)

    if mode == 'config_repo':
        // Clone the config repo alongside the main repo
        token = getInstallationToken(job.installationId)
        configRepoDir = cloneRepo(job.configRepoUrl, job.configRepoBranch, token)
        configPath = job.configRepoPath || '.'
        return parseConfigFromDirectory(configRepoDir + '/' + configPath)
```

### Internal Config Endpoint

The worker uses an internal endpoint to fetch server-side config. This endpoint
is not exposed to external clients.

```
GET /internal/projects/:id/config
```

**Response (200 OK):**

```json
{
  "files": {
    "config.yml": "version: \"1\"\nsetup:\n  install:\n    - npm ci\n...",
    "workflows/homepage.yml": "name: homepage\nsteps:\n  - open: ...",
    "workflows/login.yml": "name: login\nsteps:\n  - open: ...",
    "includes/login.yml": "name: login\nsteps:\n  - open: ..."
  }
}
```

The keys are relative file paths (same as `file_path` in the `project_configs`
table). The values are raw YAML strings. The worker parses them identically to
files read from disk.

**Response when no config exists (404 Not Found):**

```json
{
  "error": "no_config",
  "message": "No server-side config found for this project"
}
```

The worker treats a 404 the same as a missing `.megatest/` directory: the run
fails with error "No config found".

### Config Repo Cloning

When `configStorageMode` is `config_repo`, the worker clones two repositories:

1. **Main repo** -- cloned as usual for application code (spec 05, section 3.1).
2. **Config repo** -- cloned into a separate directory within the run's temp
   directory:
   ```
   /tmp/megatest-{runId}/config-repo/
   ```

The config repo clone uses the same installation token mechanism as the main
repo. If the config repo is in a different GitHub organization, a separate
installation token is obtained for that org's installation.

The config repo is shallow-cloned (`--depth=1`) at the configured branch.

---

## 5. Discovery Output Routing

When discovery completes, the output is routed based on storage mode:

| Mode | Discovery Output |
|------|-----------------|
| `repo` | Create PR on the project repo with `.megatest/` files |
| `server` | Store files in `project_configs` table via API |
| `config_repo` | Create PR on the config repo with files at `config_repo_path` |

### Repo Mode

Discovery creates a PR on the main project repository. The PR adds or updates
files under `.megatest/`. This is the standard behavior described in spec 08,
section 5.3.

### Server Mode

For `server` mode, the discovery apply endpoint
(`POST /api/v1/discoveries/:id/apply`) writes directly to the database. The
`create_pr` parameter is ignored -- no PR is possible because there is no
target repo for config files.

Each file is upserted into the `project_configs` table:

```sql
INSERT INTO project_configs (project_id, file_path, content, updated_at)
VALUES ($1, $2, $3, now())
ON CONFLICT (project_id, file_path)
DO UPDATE SET content = $3, updated_at = now();
```

The response omits `pr_url` and `branch`:

```json
{
  "files_applied": [
    "config.yml",
    "workflows/homepage.yml",
    "workflows/login.yml",
    "includes/login.yml"
  ],
  "storage_mode": "server"
}
```

### Config Repo Mode

Discovery creates a PR on the config repository instead of the main project
repo. Files are placed at the path specified by `config_repo_path`:

- If `config_repo_path` is `"my-project"`, the PR adds files like
  `my-project/config.yml`, `my-project/workflows/homepage.yml`, etc.
- If `config_repo_path` is empty or unset, files are placed at the repository
  root.

The response includes the config repo's PR URL:

```json
{
  "pr_url": "https://github.com/org/megatest-config/pull/42",
  "branch": "megatest/initial-config",
  "files_committed": [
    "my-project/config.yml",
    "my-project/workflows/homepage.yml",
    "my-project/workflows/login.yml",
    "my-project/includes/login.yml"
  ]
}
```

---

## 6. Sync Operations

Users may need to sync config between storage locations outside of a mode
switch. This is useful for backup, migration preparation, or one-off transfers.

### Sync Directions

**Repo -> Server:**
Read `.megatest/` from the repo's default branch and write to
`project_configs`. Each file in `.megatest/` becomes a row in the table. The
repo files are not modified.

**Server -> Repo:**
Create a PR that adds or updates `.megatest/` files in the repo with the
content from `project_configs`. The database rows are not modified.

**Repo -> Config Repo:**
Copy files from the main repo's `.megatest/` directory to the config repo's
designated path. Implemented as a PR on the config repo.

**Config Repo -> Repo:**
Copy files from the config repo's designated path to the main repo's
`.megatest/` directory. Implemented as a PR on the main repo.

### API

```
POST /api/v1/projects/:id/config/sync
Content-Type: application/json

{
  "direction": "repo_to_server" | "server_to_repo" | "repo_to_config_repo" | "config_repo_to_repo"
}
```

**Response (200 OK) -- when writing to database (no PR):**

```json
{
  "status": "completed",
  "files_synced": [
    "config.yml",
    "workflows/homepage.yml",
    "workflows/login.yml"
  ]
}
```

**Response (201 Created) -- when a PR was created:**

```json
{
  "status": "pr_created",
  "pr_url": "https://github.com/org/repo/pull/456",
  "files_synced": [
    "config.yml",
    "workflows/homepage.yml",
    "workflows/login.yml"
  ]
}
```

**Error (400 Bad Request) -- invalid direction for current mode:**

If the project does not have the required source or destination configured
(e.g., `repo_to_config_repo` when no config repo is set), the endpoint
returns:

```json
{
  "error": "invalid_sync_direction",
  "message": "Cannot sync repo_to_config_repo: no config repo configured for this project"
}
```

**Error (404 Not Found) -- no config at source:**

```json
{
  "error": "no_config",
  "message": "No config files found in the source location"
}
```

### Sync vs Mode Switch

Sync operations copy config between locations without changing
`config_storage_mode`. The project continues to read config from its current
mode. Mode switching (section 3) both copies config and updates the mode.

---

## 7. Database Schema

Server-side config uses the `project_configs` table defined in spec 03:

```sql
CREATE TABLE project_configs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id),
    file_path       TEXT NOT NULL,              -- relative path, e.g. "config.yml" or "workflows/login.yml"
    content         TEXT NOT NULL,              -- raw YAML content
    updated_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE(project_id, file_path)
);
```

### File Path Convention

The `file_path` column stores paths relative to the `.megatest/` root:

| File | `file_path` value |
|------|-------------------|
| `.megatest/config.yml` | `config.yml` |
| `.megatest/workflows/homepage.yml` | `workflows/homepage.yml` |
| `.megatest/workflows/login.yml` | `workflows/login.yml` |
| `.megatest/includes/login.yml` | `includes/login.yml` |

Paths never include the `.megatest/` prefix. They use forward slashes
regardless of operating system.

### Project Table Fields

The `projects` table (spec 03) includes these config-storage-related columns:

```sql
config_storage_mode TEXT NOT NULL DEFAULT 'repo',  -- repo|server|config_repo
config_repo_url     TEXT,                          -- URL of config repo (when mode = config_repo)
```

Additional config repo settings (`config_repo_branch`, `config_repo_path`) are
stored in the `settings` JSONB column:

```json
{
  "config_repo_branch": "main",
  "config_repo_path": "my-project"
}
```

---

## 8. Format Consistency

The YAML format from spec 02 is used in all storage modes:

- File paths are relative to the `.megatest/` root (e.g., `config.yml`,
  `workflows/homepage.yml`).
- In server-side mode, each file is stored as a row in `project_configs` with
  `file_path` as the key and `content` as the raw YAML string.
- Validation rules from spec 02 apply regardless of storage mode.
- The `version` field in `config.yml` must be present and valid in all modes.
- The `parseConfigFromMap()` function used for server-side config applies the
  same JSON Schema validation as `parseConfigFromDirectory()` used for
  repo-side and config-repo modes.

### Equivalence Guarantee

For any given set of config files, the behavior of a Megatest run must be
identical regardless of storage mode. The following invariant holds:

> Given the same YAML content, `parseConfigFromDirectory(dir)` and
> `parseConfigFromMap(files)` produce identical parsed config objects.

This is enforced by sharing the same parsing and validation code path. The only
difference is the I/O layer: one reads files from disk, the other receives them
as a key-value map from the API.
