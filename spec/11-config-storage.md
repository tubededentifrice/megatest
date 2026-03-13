# 11 - Config Repository

## 1. Overview

Megatest stores workflow configuration (`.megatest/` directory) in a Git repository. This can be:

- **The project's own repository** (default) -- config lives alongside application code.
- **A separate dedicated config repository** -- useful when Megatest doesn't have write access to the project repo, or when a team wants to manage configs centrally.

The `config_repo_url` field on the project determines which repo holds the config. When null, config is read from the project repository itself.

Regardless of location, all config files conform to the schema defined in spec 02. The `version` field in `config.yml` must be present and valid. Validation rules apply identically in both cases.

---

## 2. Configuration

### Per-Project Setting

| Setting | Storage | Description |
|---------|---------|-------------|
| `config_repo_url` | `projects.config_repo_url` | HTTPS clone URL of the config repo. NULL = use project repo. |
| `config_repo_branch` | `projects.settings` JSONB | Branch to read config from. Default: repo's default branch. |
| `config_repo_path` | `projects.settings` JSONB | Subdirectory within the config repo. Default: root. |

### API

```
PATCH /api/v1/projects/:id/config-repo
```

Set or change the config repository. See spec 04, section 3.9 for the full endpoint specification.

### Default (Project Repo)

When `config_repo_url` is null:

- Workers read config from `.megatest/` in the cloned project repo.
- Discovery creates PRs on the project repo to add config files.
- Config changes are version-controlled alongside application code.

### Separate Config Repo

When `config_repo_url` is set to a different repo:

- Workers clone both the project repo (app code) and the config repo (test config).
- Discovery creates PRs on the config repo.
- Config repo must be accessible via the same GitHub App installation, or a separate installation if in a different org.

### Directory Structures

**Shared config repo (multiple projects in one repo):**

```
config-repo/
  project-a/
    config.yml
    workflows/
      homepage.yml
      login.yml
    includes/
      login.yml
  project-b/
    config.yml
    workflows/
      dashboard.yml
```

Each project sets `config_repo_path` to its subdirectory (e.g., `project-a`).

**Dedicated config repo (one repo per project):**

```
config-repo/
  config.yml
  workflows/
    homepage.yml
    login.yml
  includes/
    login.yml
```

The `config_repo_path` is left empty or omitted; files are read from the repository root.

---

## 3. Worker Config Resolution

When a worker starts processing a run, it resolves config based on the project's `config_repo_url`. The config repo settings are included in the job data so the worker does not need to query the API for project settings.

### Job Data Fields

The `RunJob` interface (spec 05) includes these fields:

```ts
interface RunJob {
  // ... existing fields from spec 05 ...
  configRepoUrl: string | null;
  configRepoBranch: string | null;
  configRepoPath: string | null;
}
```

### Resolution Algorithm

```
function resolveConfig(job):
    if job.configRepoUrl is NULL or job.configRepoUrl == job.repoUrl:
        // Config is in the cloned project repo at .megatest/
        return parseConfigFromDirectory(job.repoDir + '/.megatest/')

    // Config is in a separate repo -- clone it
    token = getInstallationToken(job.installationId)
    configRepoDir = cloneRepo(job.configRepoUrl, job.configRepoBranch, token)
    configPath = job.configRepoPath || '.'
    return parseConfigFromDirectory(configRepoDir + '/' + configPath + '/.megatest/')
```

### Config Repo Cloning

When `configRepoUrl` points to a separate repo, the worker clones two repositories:

1. **Main repo** -- cloned as usual for application code (spec 05, section 3.1).
2. **Config repo** -- cloned into a separate directory within the run's temp directory:
   ```
   /tmp/megatest-{runId}/config-repo/
   ```

The config repo clone uses the same installation token mechanism as the main repo. If the config repo is in a different GitHub organization, a separate installation token is obtained for that org's installation.

The config repo is shallow-cloned (`--depth=1`) at the configured branch.

---

## 4. Discovery Output

Discovery always creates PRs:

- **When `config_repo_url` is null:** PR is created on the project repo with `.megatest/` files.
- **When `config_repo_url` is set:** PR is created on the config repo with files at `{config_repo_path}/.megatest/`.

The response from `POST /api/v1/discoveries/:id/apply` always includes a `pr_url` pointing to the appropriate repo.

---

## 5. Switching Config Repos

When changing from one config repo to another (or from project repo to separate repo):

- Config files from the old location are not automatically migrated.
- The user should manually copy the files, or the UI can offer to create a PR to transfer them.
- The switch takes effect immediately -- the next run reads from the new location.

To switch, use:

```
PATCH /api/v1/projects/:id/config-repo
```

Setting `config_repo_url` to `null` switches back to using the project repo. Setting it to a new URL switches to that repo.

---

## 6. Format Consistency

The YAML format from spec 02 is identical regardless of where config is stored:

- File paths are relative to the `.megatest/` root (e.g., `config.yml`, `workflows/homepage.yml`).
- Validation rules from spec 02 apply in all cases.
- The `version` field in `config.yml` must be present and valid.
- The same parsing and validation code path is used whether config is read from the project repo or a separate config repo. The only difference is which directory is read from disk.
