# 05 - Worker Execution

The worker is the most complex component of Megatest. It consumes jobs from a
BullMQ queue, spins up isolated Docker containers for the user's application,
drives a headless browser via Playwright in the worker runtime
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
  deployUrl: string | null; // External deploy URL (from deployment_status event or deploy_url_template). Null for managed mode runs.
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

- **1 retry on infrastructure failure** -- Docker pull timeout, network error, OOM kill, Playwright/Chromium crash that cannot be recovered. BullMQ `attempts: 2` with `backoff: { type: 'fixed', delay: 5000 }`.
- **No retry on test failure** -- if the run completes but screenshots differ, the result is recorded as-is. Re-running is a manual action triggered from the UI or by pushing a new commit.

Infrastructure failures are distinguished from test failures by error type. The `processRun` function throws a typed `InfrastructureError` for retryable conditions and returns normally (with a `fail` result) for test failures.

---

## 2. Serve Modes

The worker supports two serve modes, determined by the project's `.megatest/config.yml`:

- **Managed mode** (`serve.cmd` is set): Megatest spins up a Docker container, clones the repo, installs dependencies, and starts a dev server. This is the default mode.
- **External mode** (`serve.url` is set): Megatest tests against an already-deployed URL. No Docker container is created for the application. This is used with preview deployments (Vercel, Netlify, Render, Cloudflare Pages, etc.), staging servers, or any externally-hosted environment.

In both modes, Playwright and the worker process run on the worker host. The only difference is where the application under test is hosted.

### 2.1 Managed Mode Architecture

```
+-----------------------------+     +-------------------------+
| Worker Runtime              |     | Docker Container        |
|                             |     |                         |
| Playwright --- http://megatest-run:PORT ---> dev server    |
|   (Chromium)                |     |   (npm run dev)         |
|                             |     |                         |
| Worker process              |     |                         |
|   - orchestrates steps      |     |                         |
|   - runs pixelmatch         |     |                         |
|   - uploads to storage      |     |                         |
+-----------------------------+     +-------------------------+
```

Playwright and Chromium run alongside the worker process, not inside the
user app container. The worker creates a per-run Docker bridge network and
attaches the app container with a stable alias. Playwright connects to the
rewritten `serve.ready` URL on that private network.

### 2.2 External Mode Architecture

```
+-----------------------------+           +-------------------------+
| Worker Runtime              |           | External Server         |
|                             |           | (Vercel, Netlify, etc.) |
| Playwright --- https://preview-xyz.vercel.app ------------->     |
|   (Chromium)                |           |                         |
|                             |           |                         |
| Worker process              |           |                         |
|   - orchestrates steps      |           |                         |
|   - runs pixelmatch         |           |                         |
|   - uploads to storage      |           |                         |
+-----------------------------+           +-------------------------+
```

No Docker container or bridge network is created. Playwright connects
directly to the external URL over the public internet. The worker still
clones the repo to parse `.megatest/` config and fetch baselines.

### 2.3 Base Image (Managed Mode Only)

The default base image is `megatest/runner:latest`, which includes:

- Node.js LTS (current: 22.x)
- npm, yarn, pnpm
- Common build tools (gcc, g++, make, python3)
- Git

Users can install additional system packages via `setup.system` commands, which run as root inside the container.

### 2.4 Container Configuration (Managed Mode Only)

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

### 2.5 Resource Limits (Managed Mode Only)

| Resource | Limit |
|----------|-------|
| RAM | 2 GB |
| CPU | 2 cores |
| Disk | 10 GB |
| Network | Dedicated bridge network per run |

### 2.6 Tier-Aware Resource Limits (SaaS, Managed Mode Only)

In the hosted SaaS, container resource limits vary by the organization's tier:

| Resource | Free Tier | Pro Tier | Enterprise |
|----------|-----------|----------|------------|
| RAM | 1 GB | 2 GB | 4 GB |
| CPU | 1 core | 2 cores | 4 cores |
| Disk | 5 GB | 10 GB | 20 GB |
| Run timeout | 5 min | 10 min | 30 min |

The worker reads the org's tier from the job data and applies the corresponding limits when creating the container.

### 2.7 Container Lifecycle (Managed Mode Only)

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
5. Inject built-in run variables (`BRANCH`, `COMMIT_SHA`, `PR_NUMBER`, `DEPLOY_URL`) into the variable context. See spec 02, section 8.3 for the full list and resolution order.
6. Resolve variables:
   - Built-in run variables are checked first (cannot be overridden).
   - `${VAR_NAME}` -- looked up from `config.yml` variables section.
   - `${env:VAR_NAME}` -- looked up from project secrets stored in the database. These are decrypted at this stage and injected into the Docker container's environment (managed mode) or kept in-process (external mode).
7. Resolve includes: replace `include: name` steps with the corresponding steps from `.megatest/includes/{name}.yml`. Includes may reference other includes (nested), but **circular includes are detected and cause an error**. Detection uses a visited-set during recursive resolution.
8. Determine serve mode: check if `setup.serve.url` is set (external mode) or `setup.serve.cmd` is set (managed mode).

If no workflows are found, the run fails with error: "No workflow files found in .megatest/workflows/".

### Config Source Resolution

The worker resolves config from a Git repository based on the project's `config_repo_url`:

1. **`config_repo_url` is null or matches the project repo URL:** Read config from `.megatest/` in the cloned project repository. This is the behavior described above.

2. **`config_repo_url` points to a different repo:** Clone a second repository (`project.config_repo_url`) alongside the main repo. Read config from `.megatest/` in the config repo (optionally at a subdirectory path). The main repo is still cloned for app code.

The `config_repo_url` is included in the job data so the worker knows which source to use without an extra API call.

### 3.3 App Setup

This phase prepares the application under test. The behavior depends on the serve mode determined during config parsing.

#### 3.3a Managed Mode (Docker Setup)

When `setup.serve.cmd` is set, the worker builds or pulls the base image, creates a Docker container, runs setup commands, and starts the dev server.

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

#### 3.3b External Mode (External URL)

When `setup.serve.url` is set, the worker skips Docker container creation entirely and tests against the external URL.

**Sequence:**

1. **Resolve the deploy URL.** The `serve.url` value is already interpolated during config parsing (step 6 of section 3.2). The resolved URL is stored on the run record as `deploy_url`.

2. **Poll the deploy URL** with HTTP GET requests until it returns a 200 status code:
   - Poll interval: 3 seconds (longer than managed mode because external deployments may take time to provision).
   - Timeout: `serve.timeout` from config, default 120 seconds.
   - On timeout: run fails with error: "External URL {url} did not become ready within {timeout}s". The worker logs the last HTTP status code and any connection errors.
   - Accept any 2xx status as ready (not just 200), to accommodate various deployment platforms.
   - Follow redirects (up to 5). The final resolved URL is used for workflow execution.

3. **Set the app base URL** to the resolved deploy URL. The `open` step in workflows will resolve paths relative to this base URL (e.g., `open: /pricing` becomes `https://preview-xyz.vercel.app/pricing`).

**What is skipped in external mode:**
- No Docker container, network, or image pull.
- `setup.system`, `setup.install`, and `setup.prepare` are not executed (there is no container to run them in).
- No container cleanup is needed after the run.

**URL resolution priority:**
The `DEPLOY_URL` built-in variable is populated from the first available source:
1. The `deployment_status` webhook payload (`deployment_status.environment_url` or `deployment_status.target_url`), when the run was triggered by a `deployment_status` event.
2. The project's `deploy_url_template` setting, with run metadata interpolated (`${BRANCH}`, `${COMMIT_SHA}`, `${PR_NUMBER}`).
3. A literal value in `config.yml` variables: `variables: { DEPLOY_URL: "https://staging.example.com" }`.
If none of these sources provide a value and `serve.url` references `${DEPLOY_URL}`, the run fails at variable interpolation with "variable DEPLOY_URL not found".

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

**Concurrency:** Up to 3 workflow/viewport pairs run concurrently (default). Each pair gets its own Playwright BrowserContext (not a separate Chromium process -- Playwright is more efficient with contexts, sharing a single browser instance across multiple isolated contexts).

**Per workflow/viewport pair:**

1. **Start a browser session:**
   ```js
   const browser = await chromium.launch({ headless: true });
   const context = await browser.newContext({ viewport: { width, height } });
   const page = await context.newPage();
   ```

2. **Set viewport:**
   ```js
   await page.setViewportSize({ width, height });
   ```

3. **Execute each step** in sequence:

   Each step in the workflow config is mapped to a Playwright API call. The mapping depends on the step type.

   **Step type mapping:**

   | Step Type | Playwright Implementation |
   |-----------|--------------------------|
   | `open: <url>` | `await page.goto(url)` |
   | `click: <locator>` | `await resolveLocator(page, locator).click()` |
   | `fill: <locator+text>` | `await resolveLocator(page, locator).fill(text)` |
   | `type: <locator+text>` | `await resolveLocator(page, locator).pressSequentially(text)` |
   | `select: <locator+value>` | `await resolveLocator(page, locator).selectOption(value)` |
   | `hover: <locator>` | `await resolveLocator(page, locator).hover()` |
   | `wait: <condition>` | `await page.waitForSelector(selector)` or `await page.waitForTimeout(ms)` |
   | `screenshot: <name>` | `await page.screenshot({ path: outputPath, fullPage })` |
   | `scroll: <direction>` | `await page.evaluate(() => window.scrollBy(0, pixels))` |
   | `press: <key>` | `await page.keyboard.press(key)` |
   | `eval: <js>` | `await page.evaluate(js)` |
   | `include: <name>` | (resolved during config parsing, not a runtime step) |
   | `set-viewport: <viewport>` | `await page.setViewportSize({ width, height })` |

   **Semantic locator resolution** maps step config locators to Playwright locator methods:

   ```ts
   function resolveLocator(page: Page, locator: Locator): Locator {
     if (locator.testid) return page.getByTestId(locator.testid);
     if (locator.role) return page.getByRole(locator.role, { name: locator.name });
     if (locator.label) return page.getByLabel(locator.label);
     if (locator.text) return page.getByText(locator.text);
     if (locator.placeholder) return page.getByPlaceholder(locator.placeholder);
     if (locator.css) return page.locator(locator.css);
     if (locator.xpath) return page.locator(locator.xpath);
     throw new Error('No valid locator found');
   }
   ```

   **Execution:** Each Playwright call is awaited with a per-step timeout
   (default 30s, configurable via `defaults.timeout`).

   **Screenshot steps:**
   - Output path: `/tmp/megatest-{runId}/screenshots/{workflow}/{name}/{viewport}.png`
   - If `mode: full`, pass `fullPage: true` to `page.screenshot()`.
   - If the screenshot config includes `selector`, use
     `page.locator(selector).screenshot()` to capture that element rather
     than the full page.
   - The screenshot file is written by Playwright directly to the worker
     runtime filesystem (not inside the user app container).

   **Step failure handling:**
   - If a step fails (Playwright error, timeout), record the error on the step.
   - Default behavior: abort the remaining steps in this workflow/viewport pair.
   - The config DSL does not support per-step `continueOnError` in schema v1.
     Recovery is therefore handled at the workflow/runner level, not in YAML.

4. **Close the browser:**
   ```js
   await browser.close();
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

**Steps (managed mode):**

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

4. **Close any remaining Playwright browser instances:**
   ```ts
   await browser.close();
   ```
   This ensures all Chromium processes spawned by Playwright for this run are terminated, even if they were not properly closed during execution (e.g., due to an early abort).

**Steps (external mode):**

1. **Remove the temporary directory** (contains cloned repo and screenshots):
   ```
   rm -rf /tmp/megatest-{runId}/
   ```

2. **Close any remaining Playwright browser instances:**
   ```ts
   await browser.close();
   ```

Steps 1-2 from managed mode (container kill/remove, network removal) are skipped because no container was created.

If cleanup itself fails (e.g., Docker daemon unreachable), the error is logged but does not affect the run result (which has already been recorded).

---

## 4. Timeouts

| Scope | Default | Configurable | Config Path | Applies to |
|-------|---------|--------------|-------------|------------|
| Total run | 10 min | Yes | Project settings (database) | Both modes |
| Docker setup (pull + create + start) | 2 min | No | -- | Managed only |
| `serve.ready` / `serve.url` polling | 120s | Yes | `serve.timeout` in config.yml | Both modes |
| Individual step | 30s | Yes | `defaults.timeout` in config.yml | Both modes |
| Screenshot comparison | 10s per image | No | -- | Both modes |

The total run timeout is enforced by wrapping the entire `processRun` function in a `Promise.race` with a timeout. When the total timeout fires:

1. The current operation is aborted.
2. Any incomplete checkpoints are marked as `error` with message "run timeout exceeded".
3. The run result is set to `"error"`.
4. Cleanup runs normally.

---

## 5. Error Handling

Each failure mode is handled specifically to provide actionable error messages.

| Failure | Classification | Mode | Behavior |
|---------|---------------|------|----------|
| Docker pull/build failure | Infrastructure | Managed | Run fails with error. Message includes Docker output. Retryable. |
| `setup.system` command fails | User config | Managed | Run fails. Message includes command, exit code, and stderr. Not retryable. |
| `setup.install` command fails | User config | Managed | Run fails. Message includes command, exit code, and stderr. Not retryable. |
| `serve.ready` timeout | User config | Managed | Run fails. Message: "Server failed to start within {N}s". Includes last 50 lines of serve.cmd output. Not retryable. |
| `serve.cmd` exits unexpectedly | User config | Managed | Run fails. Message: "Dev server exited with code {N}". Includes captured output. Not retryable. |
| `serve.url` timeout | User config | External | Run fails. Message: "External URL {url} did not become ready within {N}s". Includes last HTTP status. Not retryable. |
| `serve.url` DNS / connection error | Infrastructure | External | Retry with backoff (3 attempts). If all fail, run fails with "Cannot reach external URL {url}: {error}". Retryable. |
| `DEPLOY_URL` variable not found | User config | External | Run fails at config parsing. Message: "Variable DEPLOY_URL not found. Configure a deploy_url_template in project settings or use a deployment_status trigger." Not retryable. |
| Step timeout | Test error | Both | Checkpoint status = `error`. Message: "Step timed out after {N}s". Remaining steps in that workflow/viewport pair are skipped. Other pairs continue. |
| Playwright/Chromium crash (mid-session) | Infrastructure | Both | Attempt to relaunch the browser and retry the current step once. If relaunch fails, mark all remaining checkpoints in that workflow/viewport pair as `error`. Other pairs continue. |
| Playwright/Chromium crash (all sessions) | Infrastructure | Both | Mark all remaining checkpoints as `error`. Run result = `error`. Retryable. |
| Out of memory (container OOM killed) | Infrastructure | Managed | Detected via container exit code 137. Run fails with "Container killed: out of memory". Retryable. |
| Disk quota exceeded | Infrastructure | Managed | Run fails with "Container disk quota exceeded". Retryable. |
| Unhandled exception | Infrastructure | Both | Run fails. Error message and stack trace saved. Cleanup runs in `finally` block. Retryable. |
| Storage upload failure | Infrastructure | Both | Retry upload 3 times with exponential backoff. If all retries fail, checkpoint is marked as `error`. |
| GitHub API failure (status/comment) | Infrastructure | Both | Retry 3 times with exponential backoff. If all retries fail, log the error but do not fail the run (results are already recorded). |

**Retryable vs non-retryable:** Only infrastructure errors trigger BullMQ's automatic retry (up to 1 retry). User config errors and test failures are recorded as final results immediately.

---

## 6. Concurrency

| Level | Default | Notes |
|-------|---------|-------|
| Workers per instance | 2 | Each worker handles one run at a time. Configured via BullMQ `concurrency`. |
| Concurrent runs per project | 1 | Enforced via BullMQ group concurrency on `projectId`. Prevents race conditions on baselines. |
| Concurrent workflow/viewport pairs | 3 | Each pair gets its own Playwright BrowserContext (sharing a single Chromium instance for efficiency). Configured by the worker, not by schema v1. |
| Max concurrent Docker containers | 4 | Global semaphore across all workers in the process. Prevents resource exhaustion on the host. External mode runs do not consume a container slot. |

**Why 1 concurrent run per project:** Baseline management requires serial execution. If two runs for the same project execute simultaneously, they could both read the same baselines, both generate "new" results, and create conflicting baseline records when approved. Serial execution per project avoids this entirely.

**Why max 4 containers:** With 2 workers per instance and potential for retries, the theoretical max is already bounded. The container limit of 4 provides an additional safety net. On a host with 8 GB RAM and 4 CPU cores, 4 containers at 2 GB / 2 cores each would saturate resources. The limit should be tuned to the host's capacity.

**Workflow/viewport parallelism:** Within a single run, up to 3 workflow/viewport pairs execute concurrently. Each gets its own Playwright BrowserContext, sharing a single Chromium browser instance for efficiency. Contexts are fully isolated (separate cookies, storage, etc.) without the overhead of separate OS processes. This is the primary knob for trading speed against resource usage. The value of 3 is a conservative default for hosts with 8+ GB RAM.
