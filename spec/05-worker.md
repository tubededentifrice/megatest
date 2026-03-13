# 05 - Worker Execution

The worker is the most complex component of Megatest. It consumes jobs from a
BullMQ queue, spins up isolated Docker containers for the user's application,
drives a headless browser via `agent-browser` in the worker runtime
environment, performs pixel-level screenshot comparison with `pixelmatch`, and
reports results back through the API and GitHub.

---

## 1. Job Processing

### BullMQ Worker Configuration

The worker connects to the same Redis instance used by the API server. It listens on the `megatest:runs` queue.

```ts
const worker = new Worker('megatest:runs', processRun, {
  connection: redis,
  concurrency: 2,
  limiter: {
    max: 1,
    groupKey: 'projectId',    // 1 concurrent run per project
  },
});
```

### Job Data Structure

Every job placed on the queue contains the following payload:

```ts
interface RunJob {
  runId: string;            // UUID, primary key in the runs table
  projectId: string;        // UUID, foreign key to projects
  repoUrl: string;          // e.g. "https://github.com/acme/web-app"
  branch: string;           // The branch being tested
  commitSha: string;        // Full 40-char SHA
  baseBranch: string | null; // Target branch for PRs, null for push runs
  prNumber: number | null;  // GitHub PR number, null for push runs
  installationId: number;   // GitHub App installation ID (for auth)
}
```

### Concurrency

- **2 workers per instance** -- each worker handles one run at a time.
- **1 concurrent run per project** -- enforced via BullMQ group concurrency on `projectId`. If a second run for the same project arrives while one is active, it waits in the queue.

### Shared Worker Pool (SaaS)

In the hosted SaaS deployment, multiple worker instances form a shared pool serving all tenants. Job distribution uses BullMQ group concurrency to enforce fairness:

- **Per-project concurrency:** 1 concurrent run per project (unchanged from single-tenant).
- **Per-organization concurrency:** Maximum concurrent runs per org depends on tier:
  - Free: 1 concurrent run
  - Pro: 3 concurrent runs
  - Enterprise: configurable
- **Global fairness:** BullMQ rate limiter ensures no single org can monopolize the worker pool. Each org gets at most `max_concurrent_runs` active jobs at any time.

```ts
const worker = new Worker('megatest:runs', processRun, {
  connection: redis,
  concurrency: 2,
  limiter: {
    max: 1,
    groupKey: 'projectId',
  },
});
```

The `groupKey` ensures per-project serialization. Per-org limits are enforced by a pre-processing check: before starting a run, the worker queries the count of active runs for the org. If the org is at its limit, the job is re-queued with a short delay.

### Retry Policy

- **1 retry on infrastructure failure** -- Docker pull timeout, network error, OOM kill, agent-browser crash that cannot be recovered. BullMQ `attempts: 2` with `backoff: { type: 'fixed', delay: 5000 }`.
- **No retry on test failure** -- if the run completes but screenshots differ, the result is recorded as-is. Re-running is a manual action triggered from the UI or by pushing a new commit.

Infrastructure failures are distinguished from test failures by error type. The `processRun` function throws a typed `InfrastructureError` for retryable conditions and returns normally (with a `fail` result) for test failures.

---

## 2. Docker Isolation Model

Every run executes inside a fresh Docker container. The container runs the
user's application (clone, install, dev server). The browser and comparison
logic run alongside the worker process, outside the user app container.

### Architecture

```
+-----------------------------+     +-------------------------+
| Worker Runtime              |     | Docker Container        |
|                             |     |                         |
| agent-browser --- http://megatest-run:PORT ---> dev server |
|   (Chromium)                |     |   (npm run dev)         |
|                             |     |                         |
| Worker process              |     |                         |
|   - orchestrates steps      |     |                         |
|   - runs pixelmatch         |     |                         |
|   - uploads to storage      |     |                         |
+-----------------------------+     +-------------------------+
```

`agent-browser` and Chromium run alongside the worker process, not inside the
user app container. The worker creates a per-run Docker bridge network and
attaches the app container with a stable alias. `agent-browser` connects to the
rewritten `serve.ready` URL on that private network.

### Base Image

The default base image is `megatest/runner:latest`, which includes:

- Node.js LTS (current: 22.x)
- npm, yarn, pnpm
- Common build tools (gcc, g++, make, python3)
- Git

Users can install additional system packages via `setup.system` commands, which run as root inside the container.

### Container Configuration

```ts
const container = await docker.createContainer({
  Image: baseImage,
  Cmd: ['sleep', 'infinity'],       // Keep alive; commands run via exec
  WorkingDir: '/app',
  HostConfig: {
    Binds: [`${repoDir}:/app:rw`],  // Mount cloned repo
    Memory: 2 * 1024 * 1024 * 1024, // 2 GB RAM
    NanoCpus: 2_000_000_000,         // 2 CPU cores
    DiskQuota: 10 * 1024 * 1024 * 1024, // 10 GB disk
    NetworkMode: 'bridge',
  },
  Env: envVars,                      // From serve.env + project secrets
});
```

### Resource Limits

| Resource | Limit |
|----------|-------|
| RAM | 2 GB |
| CPU | 2 cores |
| Disk | 10 GB |
| Network | Dedicated bridge network per run |

### Tier-Aware Resource Limits (SaaS)

In the hosted SaaS, container resource limits vary by the organization's tier:

| Resource | Free Tier | Pro Tier | Enterprise |
|----------|-----------|----------|------------|
| RAM | 1 GB | 2 GB | 4 GB |
| CPU | 1 core | 2 cores | 4 cores |
| Disk | 5 GB | 10 GB | 20 GB |
| Run timeout | 5 min | 10 min | 30 min |

The worker reads the org's tier from the job data and applies the corresponding limits when creating the container.

### Container Lifecycle

1. **Created** -- `docker.createContainer()`
2. **Started** -- `container.start()`
3. **Used** -- setup commands, dev server, and step execution all happen via `container.exec()`
4. **Killed** -- `container.kill()` (SIGKILL, no graceful shutdown needed)
5. **Removed** -- `container.remove({ force: true })`

Cleanup (kill + remove) always runs, even if the run fails or throws. See section 3.9.

---

## 3. Execution Flow

The `processRun` function orchestrates the entire lifecycle of a run. Each phase is described below in order.

### 3.1 Clone

Create a temporary working directory and shallow-clone the repository.

```
Directory: /tmp/megatest-{runId}/
```

Steps:

1. `mkdir -p /tmp/megatest-{runId}`
2. Obtain a GitHub App installation token using `installationId`.
3. Clone:
   ```
   git clone --depth=1 --branch={branch} \
     https://x-access-token:{token}@github.com/{owner}/{repo}.git \
     /tmp/megatest-{runId}/repo
   ```
4. Verify that `HEAD` matches `commitSha`. If not (e.g., branch was force-pushed between queue and execution), fetch the exact SHA and check it out:
   ```
   git fetch --depth=1 origin {commitSha}
   git checkout {commitSha}
   ```
   Abort only if the SHA cannot be fetched.

The installation token is short-lived (1 hour) and scoped to the repository. It is never written to disk or passed into the Docker container.

### 3.2 Parse Config

Read and validate all configuration files from the cloned repo's `.megatest/` directory.

**Files read:**

| Path | Required | Purpose |
|------|----------|---------|
| `.megatest/config.yml` | Yes | Project-level config (setup, serve, defaults) |
| `.megatest/workflows/*.yml` | Yes (at least one) | Workflow definitions |
| `.megatest/includes/*.yml` | No | Reusable step sequences |

**Processing order:**

1. Parse `.megatest/config.yml` -- extract setup commands, serve config, default values, and variables.
2. Parse all files matching `.megatest/workflows/*.yml` -- each defines one workflow.
3. Parse all files matching `.megatest/includes/*.yml` -- each defines a named step sequence.
4. Validate each file against its JSON Schema. Abort with a descriptive error on validation failure.
5. Resolve variables:
   - `${VAR_NAME}` -- looked up from `config.yml` variables section.
   - `${env:VAR_NAME}` -- looked up from project secrets stored in the database. These are decrypted at this stage and injected into the Docker container's environment.
6. Resolve includes: replace `include: name` steps with the corresponding steps from `.megatest/includes/{name}.yml`. Includes may reference other includes (nested), but **circular includes are detected and cause an error**. Detection uses a visited-set during recursive resolution.

If no workflows are found, the run fails with error: "No workflow files found in .megatest/workflows/".

### Config Source Resolution

The worker resolves config from one of three sources based on `project.config_storage_mode`:

1. **`repo` (default):** Read config from `.megatest/` in the cloned repository. This is the behavior described above.

2. **`server`:** Fetch config from the Megatest API via `GET /api/v1/projects/:id/config` (internal endpoint). The response contains all config files as a key-value map. Parse them identically to repo-side files.

3. **`config_repo`:** Clone a second repository (`project.config_repo_url`) alongside the main repo. Read config from `.megatest/` in the config repo. The main repo is still cloned for app code.

The `config_storage_mode` is included in the job data so the worker knows which source to use without an extra API call.

### 3.3 Docker Setup

Build or pull the base image, create and configure the container, run setup commands, and start the dev server.

**Sequence:**

1. **Pull base image** (if not cached locally). Timeout: 2 minutes.

2. **Create a per-run Docker network** and **create container** with:
   - Repo directory (`/tmp/megatest-{runId}/repo`) mounted at `/app`.
   - Network alias: `megatest-run-{runId}`.
   - Resource limits (see section 2).
   - Environment variables: merge of `serve.env` values and project secrets.

3. **Start container.**

4. **Resolve the app URL** by rewriting `setup.serve.ready` from
   `http://localhost:{port}` to
   `http://megatest-run-{runId}:{port}` on the per-run network.

5. **Run `setup.system` commands** (if any) -- executed as root inside the container via `container.exec()`. These typically install system-level dependencies (e.g., `apt-get install -y libvips`). Each command runs sequentially; a non-zero exit code aborts the run.

6. **Run `setup.install` commands** -- executed as the `app` user (UID 1000). Typically `npm ci` or equivalent. Each command runs sequentially; a non-zero exit code aborts the run.

7. **Start `serve.cmd`** in background -- executed as the `app` user via `container.exec()` with `Detach: true`. The exec ID is stored so its logs can be captured if the server fails to start.

8. **Poll `serve.ready` URL** until it responds with HTTP 200:
   - The URL from config (e.g., `http://localhost:3000`) is rewritten to the
     run-network alias: `http://megatest-run-{runId}:3000`.
   - Poll interval: 1 second.
   - Timeout: `serve.timeout` from config, default 120 seconds.
   - On timeout: capture the last 50 lines of serve.cmd output and include in the error message ("Server failed to start within {timeout}s").

9. **Run `setup.prepare` commands** (if any) -- executed as the `app` user. These run after the server is healthy. Useful for seeding a database or warming caches.

### 3.4 Fetch Baselines

Download baseline screenshots to compare against.

**Baseline resolution logic:** use the algorithm from spec 03.

- **For PR runs**: query for baselines on `baseBranch`.
- **For pushes to the default branch**: query for baselines on the same branch.
- **For pushes to a non-default branch**: query for baselines on the same
  branch first, then fall back to the project's default branch.

Baselines are identified by the composite key: `(project_id, branch, workflow_name, checkpoint_name, viewport)`.

**Download:**

```
/tmp/megatest-{runId}/baselines/{workflow}/{checkpointName}/{viewport}.png
```

If no baselines exist after applying the full resolution algorithm, the
checkpoint is classified as `new`.

### 3.5 Execute Workflows

This is the core test execution phase. Each workflow is run against each
configured viewport. Workflow/viewport pairs may execute in parallel.

**Concurrency:** Up to 3 workflow/viewport pairs run concurrently (default). Each pair gets its own agent-browser session with its own Chromium instance.

**Per workflow/viewport pair:**

1. **Start a browser session:**
   ```
   agent-browser --session megatest-{runId}-{wf}-{vp} launch
   ```
   The session name is unique to this run, workflow, and viewport.

2. **Set viewport:**
   ```
   agent-browser --session megatest-{runId}-{wf}-{vp} set viewport {width} {height}
   ```

3. **Execute each step** in sequence:

   Each step in the workflow config is mapped to an agent-browser CLI command. The mapping depends on the step type.

   **Step type mapping:**

   | Step Type | agent-browser Command |
   |-----------|----------------------|
   | `open: <url>` | `open <url>` |
   | `click: <locator>` | `find ...` then `click` |
   | `fill: <locator+text>` | `find ...` then `fill {text}` |
   | `type: <locator+text>` | `find ...` then `type {text}` |
   | `select: <locator+value>` | `find ...` then `select {value}` |
   | `hover: <locator>` | `find ...` then `hover` |
   | `wait: <condition>` | `wait ...` |
   | `screenshot: <name|config>` | `screenshot {outputPath}` |
   | `scroll: <direction>` | `scroll ...` |
   | `press: <key>` | `press <key>` |
   | `eval: <javascript>` | `eval <javascript>` |
   | `include: <name>` | (resolved during config parsing, not a runtime step) |
   | `set-viewport: <viewport>` | `set viewport <width> <height>` |

   **Semantic locators** are resolved from the step config to agent-browser `find` subcommands:

   | Locator key | agent-browser find type |
   |------------|-------------------------|
   | `testid` | `find testid {value}` |
   | `role` (+ optional `name`) | `find role {value}` |
   | `text` | `find text {value}` |
   | `label` | `find label {value}` |
   | `placeholder` | `find placeholder {value}` |
   | `css` | `find first {value}` |
   | `nth` | `find nth {index} {selector}` |

   **Execution:** Each command is run via
   `child_process.execFile('agent-browser', args)` with a per-step timeout
   (default 30s, configurable via `defaults.timeout`).

   **Screenshot steps:**
   - Output path: `/tmp/megatest-{runId}/screenshots/{workflow}/{name}/{viewport}.png`
   - If `mode: full`, append `--full` flag to the screenshot command.
   - If the screenshot config includes `selector`, capture that element rather
     than the full page.
   - The screenshot file is written by agent-browser directly to the worker
     runtime filesystem (not inside the user app container).

   **Step failure handling:**
   - If a step fails (non-zero exit, timeout), record the error on the step.
   - Default behavior: abort the remaining steps in this workflow/viewport pair.
   - The config DSL does not support per-step `continueOnError` in schema v1.
     Recovery is therefore handled at the workflow/runner level, not in YAML.

4. **Close the browser session:**
   ```
   agent-browser --session megatest-{runId}-{wf}-{vp} close
   ```

### 3.6 Compare Screenshots

After all workflows complete, compare every captured screenshot against its baseline using pixelmatch.

**Per screenshot:**

1. **Locate the baseline** at `/tmp/megatest-{runId}/baselines/{workflow}/{name}/{viewport}.png`.

2. **No baseline exists** -- status = `"new"`. The screenshot is a new checkpoint with no prior reference. It will be presented for review.

3. **Baseline exists -- dimension check:**
   - Load both images using `sharp` or `pngjs` to extract dimensions.
   - If `baseline.width !== actual.width` or `baseline.height !== actual.height`:
     - status = `"fail"`
     - reason = `"dimension_mismatch"`
     - No pixel diff is generated (pixelmatch requires identical dimensions).

4. **Baseline exists -- pixel comparison:**
   ```ts
   const numDiffPixels = pixelmatch(
     baselineData,
     actualData,
     diffData,        // Output: diff image buffer
     width,
     height,
     { threshold: 0.1 }
   );
   ```
   - `threshold: 0.1` here is the `pixelmatch` per-pixel color-distance
     threshold (0 = exact match, 1 = very tolerant). This internal tuning value
     is distinct from Megatest's user-facing checkpoint threshold percentage.
   - `diffPercent = (numDiffPixels / (width * height)) * 100`
   - The diff image renders differing pixels in red on a transparent background.

5. **Apply checkpoint threshold:**
   - Each checkpoint may specify a `threshold` value (percentage, e.g., `0.1`
     means 0.1% of pixels).
   - Default checkpoint threshold: inherited from config schema (`defaults.threshold`, default `0.1`).
   - If `diffPercent > checkpointThreshold`: status = `"fail"`.
   - Else: status = `"pass"`.

6. **Upload to storage:**
   - `actual` image: always uploaded.
   - `diff` image: uploaded if a baseline existed and dimensions matched (i.e., a diff image was generated).
   - `baseline` image: not re-uploaded (already in storage).
   - Storage paths follow the pattern: `{projectId}/{runId}/{workflow}/{name}/{viewport}/{type}.png`

### 3.7 Record Results

Write all results to the database and determine the overall run outcome.

**Per checkpoint:**

```ts
await db.checkpoints.create({
  run_id: runId,
  workflow_name: workflow,
  checkpoint_name: name,
  viewport: viewport,
  status: 'new' | 'pass' | 'fail' | 'error',
  diff_percent: number | null,
  diff_reason: string | null,          // e.g. "dimension_mismatch"
  actual_image_url: string,
  diff_image_url: string | null,
  baseline_image_url: string | null,
  error_message: string | null,
});
```

**Run result determination:**

| Condition | Run Result |
|-----------|-----------|
| All checkpoints `pass` | `"pass"` |
| Any checkpoint `new` | `"fail"` |
| Any checkpoint `fail` | `"fail"` |
| Any checkpoint `error` | `"error"` |

`new` checkpoints are review-required and therefore keep the run result at
`fail` until they are approved or a baseline is otherwise established.

**Update run record:**

```ts
await db.runs.update(runId, {
  status: 'completed',
  result: runResult,
  completed_at: new Date(),
});
```

### 3.7b Meter Usage

After recording checkpoint results, the worker increments usage counters for the organization:

- **Screenshot count:** Add the number of screenshots captured in this run.
- **Run count:** Increment by 1.

Usage is recorded in the `usage_records` table for the current billing period. If the org has exceeded its tier's screenshot limit, a warning is included in the PR comment (see 3.8 Notify).

```ts
await db.usageRecords.increment(orgId, currentPeriod, {
  screenshot_count: checkpoints.length,
  run_count: 1,
});
```

**Quota enforcement:** Before starting a run (at the beginning of `processRun`), the worker checks the org's current usage against its tier limits. If the org has exceeded its hard limit, the run is immediately failed with error: 'Organization screenshot quota exceeded. Upgrade your plan or wait for the next billing period.'

### 3.8 Notify

Report the run outcome to GitHub and to users via the review UI.

**GitHub Commit Status:**

The commit status is set at multiple points during the run lifecycle:

| Point | State | Description |
|-------|-------|-------------|
| Run starts | `pending` | "Megatest: running visual tests..." |
| Run completes, all pass | `success` | "Megatest: all visual tests passed" |
| Run completes, any failed or new checkpoints pending review | `failure` | "Megatest: {N} failed/new checkpoints require review" |
| Run fails with error | `error` | "Megatest: run failed - {reason}" |

The `target_url` on the commit status points to the review page: `{BASE_URL}/review/{runId}`.

**PR Comment (for PR runs only):**

If `prNumber` is set, the worker posts or updates a comment on the pull
request. The comment is identified by a hidden marker
(`<!-- megatest:run:{runId} -->`) so that subsequent runs update the same
comment rather than creating new ones.

Comment contents:
- Summary line: result emoji/text, number of checkpoints by status.
- Table of failed/new checkpoints (truncated if more than 20).
- Link to full review page: `{BASE_URL}/review/{runId}`.

### 3.8b Post-Merge Route Detection

When a run was triggered by a merged pull request (`trigger = 'pull_request'` and the PR has been merged), the worker enqueues a route detection job after baseline promotion completes. This job performs diff-based static analysis to identify new routes not covered by existing workflows (see spec 12).

The route detection job is a lightweight, separate queue (`megatest:route-detection`) that does not consume a run slot.

### 3.9 Cleanup

Cleanup runs unconditionally in a `finally` block, regardless of whether the run succeeded, failed, or threw an unhandled exception.

**Steps:**

1. **Kill and remove the Docker container:**
   ```ts
   try {
     await container.kill();
   } catch (e) {
     // Container may already be stopped
   }
   await container.remove({ force: true });
   ```

2. **Remove the per-run Docker network.**

3. **Remove the temporary directory:**
   ```
   rm -rf /tmp/megatest-{runId}/
   ```

4. **Close any remaining agent-browser sessions:**
   ```
   agent-browser --session megatest-{runId}-* close
   ```
   This uses a glob pattern to catch any sessions that were not properly closed during execution (e.g., due to an early abort).

If cleanup itself fails (e.g., Docker daemon unreachable), the error is logged but does not affect the run result (which has already been recorded).

---

## 4. Timeouts

| Scope | Default | Configurable | Config Path |
|-------|---------|--------------|-------------|
| Total run | 10 min | Yes | Project settings (database) |
| Docker setup (pull + create + start) | 2 min | No | -- |
| `serve.ready` polling | 120s | Yes | `serve.timeout` in config.yml |
| Individual step | 30s | Yes | `defaults.timeout` in config.yml |
| Screenshot comparison | 10s per image | No | -- |

The total run timeout is enforced by wrapping the entire `processRun` function in a `Promise.race` with a timeout. When the total timeout fires:

1. The current operation is aborted.
2. Any incomplete checkpoints are marked as `error` with message "run timeout exceeded".
3. The run result is set to `"error"`.
4. Cleanup runs normally.

---

## 5. Error Handling

Each failure mode is handled specifically to provide actionable error messages.

| Failure | Classification | Behavior |
|---------|---------------|----------|
| Docker pull/build failure | Infrastructure | Run fails with error. Message includes Docker output. Retryable. |
| `setup.system` command fails | User config | Run fails. Message includes command, exit code, and stderr. Not retryable. |
| `setup.install` command fails | User config | Run fails. Message includes command, exit code, and stderr. Not retryable. |
| `serve.ready` timeout | User config | Run fails. Message: "Server failed to start within {N}s". Includes last 50 lines of serve.cmd output. Not retryable. |
| `serve.cmd` exits unexpectedly | User config | Run fails. Message: "Dev server exited with code {N}". Includes captured output. Not retryable. |
| Step timeout | Test error | Checkpoint status = `error`. Message: "Step timed out after {N}s". Remaining steps in that workflow/viewport pair are skipped. Other pairs continue. |
| agent-browser crash (mid-session) | Infrastructure | Attempt to restart the session and retry the current step once. If restart fails, mark all remaining checkpoints in that workflow/viewport pair as `error`. Other pairs continue. |
| agent-browser crash (all sessions) | Infrastructure | Mark all remaining checkpoints as `error`. Run result = `error`. Retryable. |
| Out of memory (container OOM killed) | Infrastructure | Detected via container exit code 137. Run fails with "Container killed: out of memory". Retryable. |
| Disk quota exceeded | Infrastructure | Run fails with "Container disk quota exceeded". Retryable. |
| Unhandled exception | Infrastructure | Run fails. Error message and stack trace saved. Cleanup runs in `finally` block. Retryable. |
| Storage upload failure | Infrastructure | Retry upload 3 times with exponential backoff. If all retries fail, checkpoint is marked as `error`. |
| GitHub API failure (status/comment) | Infrastructure | Retry 3 times with exponential backoff. If all retries fail, log the error but do not fail the run (results are already recorded). |

**Retryable vs non-retryable:** Only infrastructure errors trigger BullMQ's automatic retry (up to 1 retry). User config errors and test failures are recorded as final results immediately.

---

## 6. Concurrency

| Level | Default | Notes |
|-------|---------|-------|
| Workers per instance | 2 | Each worker handles one run at a time. Configured via BullMQ `concurrency`. |
| Concurrent runs per project | 1 | Enforced via BullMQ group concurrency on `projectId`. Prevents race conditions on baselines. |
| Concurrent workflow/viewport pairs | 3 | Each pair gets its own agent-browser session (own Chromium process). Configured by the worker, not by schema v1. |
| Max concurrent Docker containers | 4 | Global semaphore across all workers in the process. Prevents resource exhaustion on the host. |

**Why 1 concurrent run per project:** Baseline management requires serial execution. If two runs for the same project execute simultaneously, they could both read the same baselines, both generate "new" results, and create conflicting baseline records when approved. Serial execution per project avoids this entirely.

**Why max 4 containers:** With 2 workers per instance and potential for retries, the theoretical max is already bounded. The container limit of 4 provides an additional safety net. On a host with 8 GB RAM and 4 CPU cores, 4 containers at 2 GB / 2 cores each would saturate resources. The limit should be tuned to the host's capacity.

**Workflow/viewport parallelism:** Within a single run, up to 3 workflow/viewport pairs execute concurrently. Each launches its own agent-browser session, which spawns a separate Chromium process. This is the primary knob for trading speed against resource usage. The value of 3 is a conservative default for hosts with 8+ GB RAM.
