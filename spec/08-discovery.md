# Spec 08: AI-Powered Workflow Discovery

Status: Draft

## 1. What is Discovery?

Discovery is the process of automatically generating `.megatest/` config files for a project. An AI agent:

1. Spins up the user's app (using the same Docker isolation as regular runs)
2. Explores the app systematically using agent-browser
3. Identifies key pages, flows, and visual checkpoints
4. Generates workflow configs with stable locators
5. Creates a PR to the repo with the generated `.megatest/` directory

The `.megatest/` config directory is not hand-written by users. It is produced by this discovery agent and then reviewed/merged by the team. Users may later hand-edit individual files to fine-tune behavior, but the initial generation is always automated.

Discovery can be triggered:

- **Initial setup** -- when a project is first connected to Megatest
- **Manual re-discovery** -- via the API or UI ("Re-discover workflows")
- **Scheduled re-discovery** -- periodic runs to detect new pages or flows that have been added since the last discovery
- **Auto-triggered on repo connect** -- when a project is first connected to Megatest and no `.megatest/` config exists, discovery runs automatically (see spec 10)
- **Merge-triggered route detection** -- after a PR merge, diff-based static analysis detects new routes not covered by existing workflows, which may trigger targeted re-discovery (see spec 12)

Discovery is a best-effort, additive process. It produces a PR for human review rather than silently committing config. The user always has final say over what gets merged.


## 2. Discovery Agent Architecture

The discovery agent is an LLM-powered process that uses agent-browser (a Rust CLI by Vercel Labs) to explore a running instance of the user's application and produce YAML config files.

### What the Agent Has Access To

- **agent-browser CLI** -- for navigation, snapshots, screenshots, and interaction
- **The app's URL** -- the application running inside a Docker container, identical to the environment used for regular Megatest runs
- **Project metadata** -- repository name, detected tech stack (from package.json, requirements.txt, Gemfile, etc.), and any existing `.megatest/` config

### What the Agent Does NOT Do

- Modify the application's source code or state in any destructive way
- Access the application's database directly
- Make network requests to hosts outside the running app container
- Persist any browser state between discovery sessions

### agent-browser Capabilities Used

The discovery agent relies on two core capabilities of agent-browser:

1. **`snapshot -i`** -- returns a structured list of all interactive elements on the current page, each tagged with a ref ID. This is the primary way the agent understands page structure without parsing raw HTML.

2. **Semantic locators** -- agent-browser supports `find testid`, `find role`, `find text`, and `find label` commands. These allow the agent to locate elements by their semantic meaning rather than brittle CSS paths. The agent uses these to build stable locator strategies in the generated config.


## 3. Discovery Flow

### 3.1 Setup Phase

The setup phase is identical to a regular Megatest run:

1. Clone the repository at the specified branch (or default branch)
2. Parse any existing `.megatest/config.yml` if present (may not exist for first discovery)
3. Start the Docker container with the user's application
4. Wait for the app to become ready (poll the serve.ready URL or port)

If this is first discovery and no config.yml exists, the agent enters **setup detection mode** (Section 4) to figure out how to install dependencies and start the app.

### 3.1b Auto-Discovery on Repo Connection

When a project is first connected via `POST /api/v1/projects` and the repository does not contain a `.megatest/` directory, a discovery job is automatically enqueued. This is the zero-config onboarding experience.

The auto-discovery flow:
1. Project is created via the API.
2. Server performs a lightweight check: use the GitHub Contents API to probe for `.megatest/config.yml` in the repo's default branch.
3. If the file does not exist, enqueue a discovery job and return the `discovery_id` in the project creation response.
4. The discovery job runs the full setup detection (section 4) and exploration (section 3.2) flow.
5. Discovery progress is visible in the UI via the project dashboard's onboarding card.
6. On completion, behavior depends on the project's `config_storage_mode`:
   - **repo (default):** The user is prompted to review results and create a PR (or auto-PR if configured).
   - **server:** Config files are stored directly in the database. No PR needed.
   - **config_repo:** A PR is created on the config repository.

### 3.2 Exploration Phase

Once the app is running, the AI agent begins systematic exploration:

1. Open the app's root URL in agent-browser
2. Take a snapshot (`snapshot -i`) to understand the initial page structure
3. Identify global navigation elements -- nav bars, sidebars, menus, footer links
4. Build a map of top-level sections by extracting links from navigation
5. Systematically visit each major section/page

For each page visited, the agent:

- Takes a `snapshot -i` to catalog all interactive elements
- Identifies the page's purpose (landing page, form, list view, detail view, etc.)
- Notes key visual sections that are worth screenshotting as checkpoints
- Records interactive elements (forms, buttons, tabs, modals) that indicate user flows
- Detects authentication requirements (redirects to login, auth-gated content)
- Extracts any sub-navigation or in-page links that lead to deeper pages

The agent maintains a visited-URL set to avoid cycles and a queue of URLs to explore. It prioritizes breadth-first exploration of navigation links before diving into individual flows.

### 3.3 Flow Detection

After the exploration phase maps out the page structure, the agent identifies common application patterns and groups them into workflows:

**Public pages** -- pages accessible without authentication:
- Homepage, about, pricing, documentation, blog
- These become simple screenshot-only workflows (navigate, wait, screenshot)

**Auth flows** -- authentication-related sequences:
- Login (email/password, OAuth buttons)
- Signup (registration form, email verification)
- Password reset
- These become workflows with form interactions and multiple checkpoints

**Authenticated pages** -- pages behind login:
- Dashboard, settings, profile, account
- The agent detects auth gates (redirects to /login, 401 responses, "please log in" text)
- These workflows include a login prerequisite (referencing an `includes/login.yml`)

**CRUD flows** -- create/read/update/delete patterns:
- List view with items -> click into detail -> edit -> save
- "New" or "Create" buttons leading to forms
- Delete confirmations
- These become multi-step workflows with form fills and state transitions

**Form flows** -- multi-step or complex form interactions:
- Multi-page wizards (step 1 of 3, next, next, submit)
- Forms with validation states (empty, invalid, valid)
- These become workflows that exercise multiple states

**Stateful UI patterns**:
- Tabs, accordions, dropdown menus
- Modals and dialogs
- Toast notifications and alerts
- These may be captured as checkpoints within larger workflows

### 3.4 Locator Selection

For each interaction step in a generated workflow, the agent must choose a locator strategy. Locators are ranked by stability -- how likely they are to survive code changes without breaking:

| Priority | Locator Type | agent-browser Command | Stability | Example |
|----------|-------------|----------------------|-----------|---------|
| 1 | `testid` | `find testid "login-button"` | Most stable | `data-testid="login-button"` |
| 2 | `role` + `name` | `find role "button" "Submit"` | Very stable | `<button>Submit</button>` |
| 3 | `label` | `find label "Email address"` | Stable | `<label>Email address</label>` + associated input |
| 4 | `text` | `find text "Get Started"` | Moderate | Visible text content of an element |
| 5 | `placeholder` | CSS fallback | Less stable | `<input placeholder="Enter email">` |
| 6 | `css` | CSS selector | Least stable | `.header > nav > a:nth-child(2)` |

The agent's locator selection logic:

1. Run `snapshot -i` to get all interactive elements with their attributes
2. For each element the agent needs to interact with, check attributes in priority order
3. If a `data-testid` attribute exists, use it (always preferred)
4. If the element has an ARIA role and accessible name, use `role` + `name`
5. If it is a form field with an associated `<label>`, use `label`
6. If it has unique visible text (buttons, links), use `text`
7. Fall back to `css` only when no semantic locator is available

When the agent finishes discovery, if fewer than 30% of interactions used `testid` locators, it adds a recommendation to the discovery report:

> "This project has limited data-testid coverage. Adding data-testid attributes to key interactive elements will make Megatest workflows significantly more stable. See: [link to docs]"

### 3.5 Config Generation

After exploration and flow detection, the agent generates the `.megatest/` directory structure:

```
.megatest/
  config.yml              # Global setup: install, serve, viewport, defaults
  workflows/
    homepage.yml          # One file per discovered workflow
    login.yml
    dashboard.yml
    pricing.yml
    settings-profile.yml
    ...
  includes/
    login.yml             # Reusable sequences (e.g., login steps)
    navigate-to-settings.yml
    ...
```

**config.yml** -- generated from setup detection (Section 4):
```yaml
version: "1"
setup:
  install:
    - npm ci
  serve:
    cmd: npm run dev
    ready: http://localhost:3000
defaults:
  viewport: { width: 1280, height: 800 }
  waitAfterNavigation: "1000"
```

**workflows/{name}.yml** -- one per discovered flow:
```yaml
name: login
description: Tests the login flow with email and password
steps:
  - open: http://localhost:3000/login
  - wait: 500
  - screenshot: login-page-empty
  - fill:
      label: "Email"
      text: "${TEST_USER}"
  - fill:
      label: "Password"
      text: "${TEST_PASS}"
  - screenshot: login-page-filled
  - click:
      role: "button"
      name: "Sign in"
  - wait: 1000
  - screenshot: login-success-dashboard
```

**includes/{name}.yml** -- reusable step sequences:
```yaml
# includes/login.yml
name: login
steps:
  - open: http://localhost:3000/login
  - fill:
      label: "Email"
      text: "${TEST_USER}"
  - fill:
      label: "Password"
      text: "${TEST_PASS}"
  - click:
      role: "button"
      name: "Sign in"
  - wait: 1000
```

Workflows that need authentication reference the include:
```yaml
name: dashboard
description: Screenshots of the main dashboard after login
steps:
  - include: login
  - open: http://localhost:3000/dashboard
  - wait: 500
  - screenshot: dashboard-main
```

### Config Storage Mode Awareness

Config generation produces the same YAML files regardless of storage mode. The difference is in how the output is applied:

- **Repo mode:** Files are committed to a branch and a PR is created via the GitHub API (section 5.3).
- **Server mode:** Files are written to the `project_configs` table via `PUT /api/v1/projects/:id/config`.
- **Config repo mode:** Files are committed to the config repository and a PR is created there.

The `POST /api/v1/discoveries/:id/apply` endpoint handles all three modes transparently. The caller does not need to know the storage mode.

### 3.6 Output

The discovery process produces three artifacts:

**1. Generated config files** -- the complete `.megatest/` directory contents, ready to be committed.

**2. A discovery report** -- structured metadata about what was found:
```json
{
  "pages_visited": 14,
  "pages_skipped": 2,
  "workflows_generated": 8,
  "includes_generated": 1,
  "auth_detected": true,
  "auth_method": "email_password",
  "locator_stats": {
    "testid": 3,
    "role": 12,
    "label": 8,
    "text": 15,
    "css": 2
  },
  "recommendations": [
    "Add data-testid attributes to key interactive elements for more stable locators",
    "The /admin section requires a role not available during discovery -- add manually"
  ],
  "warnings": [
    "Could not detect the signup flow -- /signup returned a 404",
    "The /settings page had a loading spinner that did not resolve within 10 seconds"
  ]
}
```

**3. Confidence scores** -- each generated workflow gets a confidence rating:
- **High** (0.8-1.0): Simple navigation + screenshot, stable locators, no auth required
- **Medium** (0.5-0.8): Form interactions with semantic locators, auth required but detectable
- **Low** (0.2-0.5): Complex multi-step flows, CSS-based locators, timing-dependent UI
- **Very low** (0.0-0.2): Speculative workflows the agent is unsure about

Confidence is based on: locator stability, number of interaction steps, timing dependencies, and whether the agent successfully completed the flow during exploration.


## 4. Setup Detection

When no `.megatest/config.yml` exists, the discovery agent inspects the repository to auto-detect the correct setup configuration.

### Detection Rules

| File(s) Found | Detected `install` | Detected `serve.cmd` | Notes |
|---|---|---|---|
| `package.json` with `"dev"` script | `["npm ci"]` | `npm run dev` | Most common for modern JS apps |
| `package.json` with `"start"` script (no `"dev"`) | `["npm ci"]` | `npm start` | Production-style start |
| `package.json` with `"preview"` script | `["npm ci", "npm run build"]` | `npm run preview` | Vite/SvelteKit preview mode |
| `yarn.lock` present | `["yarn install --frozen-lockfile"]` | `yarn dev` or `yarn start` | Yarn instead of npm |
| `pnpm-lock.yaml` present | `["pnpm install --frozen-lockfile"]` | `pnpm dev` or `pnpm start` | pnpm instead of npm |
| `requirements.txt` | `["pip install -r requirements.txt"]` | Detect from framework | Python app |
| `requirements.txt` + Django detected | `["pip install -r requirements.txt"]` | `python manage.py runserver` | Django specifically |
| `requirements.txt` + Flask detected | `["pip install -r requirements.txt"]` | `flask run` | Flask specifically |
| `Gemfile` | `["bundle install"]` | `rails server` or `bundle exec rackup` | Ruby app |
| `docker-compose.yml` | `["docker compose up -d"]` | (special: no serve.cmd) | Docker-based app |
| `Makefile` with `dev` target | `[]` | `make dev` | Makefile-based setup |
| `Cargo.toml` | `["cargo build"]` | `cargo run` | Rust app |
| `go.mod` | `["go build ./..."]` | `go run .` | Go app |

### Port Detection for `serve.ready`

The agent determines the correct port for readiness checks:

1. **Explicit in package.json** -- check `"port"` in config, `--port` flags in scripts
2. **Framework defaults** -- Next.js: 3000, Vite: 5173, Angular: 4200, Django: 8000, Rails: 3000, Flask: 5000
3. **Environment files** -- check `.env`, `.env.local`, `.env.development` for `PORT=` variables
4. **Serve command output** -- if the agent starts the app during discovery, parse stdout for "listening on port XXXX"
5. **Fallback probe** -- try common ports in order: 3000, 8080, 5173, 4200, 8000, 5000

The resulting `serve.ready` value is an HTTP URL: `http://localhost:{port}`.

### Ambiguity Handling

When detection is ambiguous (e.g., both `package.json` and `docker-compose.yml` exist), the agent:

1. Prefers `docker-compose.yml` if it defines a service that looks like the main app
2. Falls back to the package.json-based approach
3. Records the ambiguity in the discovery report as a warning


## 5. Discovery API

### 5.1 Trigger Discovery

Start a new discovery run for a project.

```
POST /api/v1/projects/:id/discover
Content-Type: application/json

{
  "branch": "main",              // optional, defaults to repo's default branch
  "base_url_hint": "/app"        // optional, hint for SPA base path
}
```

Response (202 Accepted):
```json
{
  "discovery_id": "disc_abc123",
  "status": "queued",
  "estimated_duration_seconds": 120
}
```

The discovery is queued as a job and executed asynchronously. Only one discovery can run per project at a time. If a discovery is already running, the endpoint returns `409 Conflict`.

### 5.2 Get Discovery Status

Poll for discovery progress and results.

```
GET /api/v1/discoveries/:id
```

Response while running (200 OK):
```json
{
  "discovery": {
    "id": "disc_abc123",
    "project_id": "proj_xyz",
    "status": "running",
    "progress": {
      "phase": "exploration",
      "pages_visited": 7,
      "elapsed_seconds": 45
    },
    "created_at": "2026-03-13T10:00:00Z"
  }
}
```

Response when completed (200 OK):
```json
{
  "discovery": {
    "id": "disc_abc123",
    "project_id": "proj_xyz",
    "status": "completed",
    "report": {
      "pages_visited": 14,
      "pages_skipped": 2,
      "workflows_generated": 8,
      "includes_generated": 1,
      "auth_detected": true,
      "auth_method": "email_password",
      "locator_stats": {
        "testid": 3,
        "role": 12,
        "label": 8,
        "text": 15,
        "css": 2
      },
      "recommendations": [
        "Add data-testid attributes to interactive elements for more stable locators"
      ],
      "warnings": [
        "Could not access /admin -- requires elevated permissions"
      ]
    },
    "workflows": [
      {
        "name": "Homepage",
        "file": "workflows/homepage.yml",
        "confidence": 0.95,
        "steps_count": 3,
        "screenshots_count": 2
      },
      {
        "name": "User Login",
        "file": "workflows/login.yml",
        "confidence": 0.82,
        "steps_count": 7,
        "screenshots_count": 3
      }
    ],
    "config_files": {
      "config.yml": "version: \"1\"\nsetup:\n  install:\n    - npm ci\n  serve:\n    cmd: npm run dev\n    ready: http://localhost:3000\n...",
      "workflows/homepage.yml": "name: homepage\n...",
      "workflows/login.yml": "name: login\n...",
      "includes/login.yml": "name: login\nsteps:\n  - open: http://localhost:3000/login\n..."
    },
    "created_at": "2026-03-13T10:00:00Z",
    "completed_at": "2026-03-13T10:02:15Z"
  }
}
```

Response when failed (200 OK):
```json
{
  "discovery": {
    "id": "disc_abc123",
    "project_id": "proj_xyz",
    "status": "failed",
    "error": {
      "phase": "setup",
      "message": "App failed to start: 'npm run dev' exited with code 1",
      "suggestion": "Check that your dev server starts correctly. You may need to provide a custom config.yml."
    },
    "created_at": "2026-03-13T10:00:00Z",
    "failed_at": "2026-03-13T10:00:45Z"
  }
}
```

### 5.3 Apply Discovery Results

After reviewing the discovery results, apply them to the repository.

```
POST /api/v1/discoveries/:id/apply
Content-Type: application/json

{
  "files_to_include": [
    "config.yml",
    "workflows/homepage.yml",
    "workflows/login.yml",
    "includes/login.yml"
  ],
  "create_pr": true,
  "branch_name": "megatest/initial-config",
  "pr_title": "Add Megatest visual testing configuration",
  "pr_body": "Auto-generated by Megatest discovery. Review the workflows and merge to enable visual regression testing."
}
```

All fields in the request body are optional:
- `files_to_include` -- subset of generated files to apply. If omitted, all files are included.
- `create_pr` -- if true, creates a PR on the repo. If false, returns the file contents without committing. Defaults to `true`.
- `branch_name` -- branch to commit to. Defaults to `megatest/initial-config` for first discovery, `megatest/rediscovery-{date}` for subsequent runs.
- `pr_title` -- custom PR title. A sensible default is generated.
- `pr_body` -- custom PR body. A sensible default including the discovery report is generated.

Response (201 Created):
```json
{
  "pr_url": "https://github.com/org/repo/pull/123",
  "branch": "megatest/initial-config",
  "files_committed": [
    ".megatest/config.yml",
    ".megatest/workflows/homepage.yml",
    ".megatest/workflows/login.yml",
    ".megatest/includes/login.yml"
  ]
}
```

If `create_pr: false`:
```json
{
  "files": {
    ".megatest/config.yml": "version: \"1\"\nsetup:\n  install:\n    - npm ci\n...",
    ".megatest/workflows/homepage.yml": "name: homepage\n...",
    ".megatest/workflows/login.yml": "name: login\n...",
    ".megatest/includes/login.yml": "name: login\nsteps:\n  - open: http://localhost:3000/login\n..."
  }
}
```

**Server-side mode behavior:** When the project uses `config_storage_mode = 'server'`, the apply endpoint stores config files directly in the database. The `create_pr` parameter is ignored (no PR is possible). The response omits `pr_url` and `branch`:

```json
{
  "files_applied": [".megatest/config.yml", ".megatest/workflows/homepage.yml"],
  "storage_mode": "server"
}
```

**Config repo mode behavior:** When the project uses `config_storage_mode = 'config_repo'`, the PR is created on the config repository (not the main project repo). The response includes the config repo's PR URL.

### 5.4 List Discoveries

```
GET /api/v1/projects/:id/discoveries?limit=10&offset=0
```

Response (200 OK):
```json
{
  "discoveries": [
    {
      "id": "disc_abc123",
      "status": "completed",
      "workflows_generated": 8,
      "created_at": "2026-03-13T10:00:00Z"
    }
  ],
  "total": 1
}
```


## 6. Discovery LLM Integration

The discovery agent is driven by an LLM that observes the application state and decides what to do next. This section specifies the agent loop, the context provided to the LLM, and the structured output format.

### 6.1 Agent Loop

The discovery agent runs a observe-think-act-record loop:

```
state = {
  visited_urls: [],
  url_queue: [app_root],
  current_workflow: null,
  workflows: [],
  includes: [],
  config: null
}

while not done:
  1. OBSERVE
     - current_url = agent-browser current URL
     - snapshot = agent-browser snapshot -i
     - screenshot = agent-browser screenshot (for LLM vision if needed)

  2. THINK
     - Send observation + state to LLM
     - LLM returns one or more structured actions

  3. ACT
     - Execute each action via agent-browser
     - Handle errors (element not found, navigation timeout, etc.)

  4. RECORD
     - Update visited_urls
     - Update url_queue with newly discovered links
     - Append steps to current workflow if recording
     - Store screenshots for checkpoint steps

  5. CHECK LIMITS
     - Max pages visited (default: 50)
     - Max total actions (default: 200)
     - Max wall-clock time (default: 5 minutes)
     - If any limit reached, transition to config generation
```

The loop terminates when the LLM returns a `finish` action or when any limit is reached.

### 6.2 LLM Context

Each iteration of the loop, the LLM receives a structured prompt containing:

**System prompt** (constant across iterations):
```
You are a Megatest discovery agent. Your job is to explore a web application
and generate visual regression test configurations.

Goals:
- Find all major pages and user flows
- Identify visual checkpoints worth screenshotting
- Generate stable, maintainable workflow configurations
- Prefer semantic locators (testid, role, label) over CSS selectors
- Group related steps into logical workflows
- Extract reusable sequences (like login) into includes

Output your next action(s) as structured JSON.
```

**Per-iteration context:**
```
Current URL: https://localhost:3000/dashboard
Pages visited: [/, /login, /dashboard]
Pages in queue: [/settings, /profile, /docs]
Current workflow: "Dashboard" (3 steps recorded so far)
Workflows completed: ["Homepage", "User Login"]
Includes generated: ["login"]

Project: acme-app (Next.js, detected from package.json)

Page snapshot (from agent-browser snapshot -i):
[ref=1] <nav role="navigation">
  [ref=2] <a href="/">Home</a>
  [ref=3] <a href="/dashboard">Dashboard</a>
  [ref=4] <a href="/settings">Settings</a>
[ref=5] <main>
  [ref=6] <h1>Welcome back, User</h1>
  [ref=7] <div class="stats-grid">
    [ref=8] <div data-testid="total-users">1,234 users</div>
    [ref=9] <div data-testid="revenue">$12,345</div>
  [ref=10] <button>Export Report</button>
```

### 6.3 LLM Output Format

The LLM returns one or more actions as a JSON array:

```json
[
  {
    "action": "checkpoint",
    "name": "dashboard-stats",
    "description": "Dashboard with user stats and revenue metrics"
  },
  {
    "action": "navigate",
    "url": "/settings"
  }
]
```

#### Available Actions

**`navigate`** -- navigate to a URL
```json
{
  "action": "navigate",
  "url": "/settings",
  "reason": "Explore settings page found in nav"
}
```

**`interact`** -- interact with an element on the page
```json
{
  "action": "interact",
  "type": "click",
  "locator": { "role": "button", "name": "Export Report" },
  "reason": "Test the export button interaction"
}
```

```json
{
  "action": "interact",
  "type": "fill",
  "locator": { "label": "Search" },
  "value": "test query",
  "reason": "Test search functionality"
}
```

Supported interaction types: `click`, `fill`, `select`, `hover`, `press` (keyboard).

**`checkpoint`** -- mark the current page state as a screenshot point
```json
{
  "action": "checkpoint",
  "name": "dashboard-main",
  "description": "Main dashboard view with stats loaded"
}
```

This becomes a `screenshot:` step in the generated workflow YAML.

**`start_workflow`** -- begin recording a new workflow
```json
{
  "action": "start_workflow",
  "name": "User Settings",
  "description": "Navigate to settings and verify profile form",
  "tags": ["authenticated", "settings"]
}
```

If another workflow is already being recorded, it is ended implicitly.

**`end_workflow`** -- stop recording the current workflow
```json
{
  "action": "end_workflow"
}
```

**`create_include`** -- extract a reusable sequence
```json
{
  "action": "create_include",
  "name": "login",
  "description": "Standard email/password login flow",
  "steps": [
    { "navigate": "/login" },
    { "fill": { "locator": { "label": "Email" }, "value": "test@example.com" } },
    { "fill": { "locator": { "label": "Password" }, "value": "password123" } },
    { "click": { "locator": { "role": "button", "name": "Sign in" } } },
    { "wait": 1000 }
  ]
}
```

**`wait`** -- pause before the next action (for animations, loading states)
```json
{
  "action": "wait",
  "duration_ms": 2000,
  "reason": "Wait for dashboard data to load"
}
```

**`finish`** -- signal that discovery is complete
```json
{
  "action": "finish",
  "reason": "All reachable pages explored, 8 workflows generated"
}
```

### 6.4 Error Handling in the Agent Loop

When an action fails (element not found, navigation timeout, unexpected page), the error is fed back to the LLM as context in the next iteration:

```
Previous action failed:
  Action: interact click { role: "button", name: "Submit" }
  Error: Element not found. No element matching role=button name="Submit" on current page.

  Current snapshot shows these buttons: [ref=5] <button>Send</button>, [ref=8] <button>Cancel</button>
```

The LLM can then decide to:
- Retry with a different locator
- Skip the interaction and move on
- Record the failure in the discovery report as a warning

After 3 consecutive failures on the same page, the agent skips to the next URL in the queue.

### 6.5 LLM Provider

The discovery agent uses the same LLM provider as the rest of the Megatest platform. The specific model should be configurable but defaults to a capable vision model (for interpreting screenshots when snapshot data is ambiguous). Vision capability is optional -- the agent can operate purely on snapshot text when a vision model is not available.


## 7. Limitations and Edge Cases

### Complex Setup Requirements

Apps that need databases, message queues, external APIs, or other services beyond the application itself may not start successfully with auto-detected setup. In these cases:

- The discovery agent fails at the setup phase with a descriptive error
- The user is prompted to provide a manual `config.yml` with the correct `install` and `serve` commands
- Once a valid `config.yml` exists, discovery can be re-triggered to generate only the workflow files

### Authentication

The discovery agent can handle simple email/password login forms. It cannot handle:

- OAuth/SSO flows (redirects to external identity providers)
- Two-factor authentication
- CAPTCHA-protected login pages
- Magic link / passwordless login

For these cases, the agent:
- Detects the auth pattern and notes it in the report
- Generates workflow files for public pages only
- Recommends that the user provide auth credentials or session tokens in the config

If the project provides test credentials via Megatest project secrets, the
discovery agent may reference them through schema-valid variables such as:

```yaml
variables:
  TEST_USER: "${env:MEGATEST_TEST_USER}"
  TEST_PASS: "${env:MEGATEST_TEST_PASS}"
```

Discovery MUST NOT commit raw secret values into generated `.megatest` files.

### Single-Page Applications

SPAs with client-side routing present challenges:

- URL changes may not be detectable by watching navigation events
- The agent relies on snapshot changes to detect page transitions
- Hash-based routing (#/page) is supported
- Lazy-loaded content may require extra wait times

The agent handles this by:
- Taking snapshots after every interaction, not just navigations
- Comparing consecutive snapshots to detect meaningful state changes
- Using longer default wait times for SPA transitions (configurable)

### Feature Flags and A/B Tests

The agent sees only one variant of any A/B test or feature flag. It cannot:

- Discover pages behind disabled feature flags
- Test multiple variants of the same page

The discovery report notes if the agent suspects feature flags are present (e.g., cookie-based routing, variation parameters in URLs).

### Dynamic Content

Pages with dynamic content (randomized data, live feeds, timestamps) may produce unstable screenshots. The agent mitigates this by:

- Noting pages where content changes significantly between visits
- Recommending mask regions in the generated workflow for dynamic areas
- Setting appropriate diff thresholds in the workflow config

### Rate of False Positives

Not every discovered workflow will be useful. Common false positives:

- Error pages encountered during navigation
- Duplicate workflows for the same page reached via different paths
- Workflows for trivial pages (404, empty states)

The confidence score helps users prioritize which workflows to keep. Low-confidence workflows should be reviewed more carefully before merging.

### Scale Limits

Discovery is bounded by:

| Limit | Default | Rationale |
|-------|---------|-----------|
| Max pages visited | 50 | Prevents runaway exploration on large apps |
| Max total actions | 200 | Bounds compute cost |
| Max wall-clock time | 5 minutes | Prevents hanging on slow apps |
| Max workflow files | 30 | Keeps the config manageable |
| Max steps per workflow | 20 | Keeps individual workflows focused |

These limits are configurable via the discovery API request (for internal/enterprise use) but have sensible defaults for most applications.


## 8. Re-Discovery

When discovery is triggered on a project that already has a `.megatest/` directory, it enters re-discovery mode.

### Behavior Differences from Initial Discovery

1. **Read existing config first** -- the agent loads all existing `config.yml`, `workflows/*.yml`, and `includes/*.yml` files before starting exploration.

2. **Skip known workflows** -- the agent does not regenerate workflows that already exist. It compares by page URL and flow purpose, not by file name.

3. **Detect new content** -- the agent focuses on finding pages and flows that are NOT covered by existing workflows. It still visits known pages to check for structural changes but does not regenerate their configs.

4. **Additive output** -- re-discovery generates only NEW files. It does not modify or delete existing workflow files.

5. **Change detection** -- if an existing workflow's page has changed significantly (new sections, removed elements, restructured layout), the agent notes this in the report with a recommendation to update the workflow, but does not overwrite it.

### Re-Discovery Report

In addition to the standard discovery report fields, re-discovery includes:

```json
{
  "existing_workflows_checked": 8,
  "existing_workflows_still_valid": 7,
  "existing_workflows_stale": 1,
  "stale_workflows": [
    {
      "file": "workflows/pricing.yml",
      "reason": "Page structure has changed significantly -- the pricing tiers section is no longer present",
      "recommendation": "Review and update or delete this workflow"
    }
  ],
  "new_workflows_generated": 3,
  "new_pages_found": ["/blog", "/changelog", "/integrations"]
}
```

### PR Format for Re-Discovery

The generated PR for re-discovery contains:
- Only new files (no modifications to existing files)
- A clear PR description listing what was added and why
- Notes about stale workflows that may need manual attention

Example PR body:
```markdown
## Megatest Re-Discovery Results

### New workflows added
- `workflows/blog.yml` -- Blog listing page (confidence: 0.92)
- `workflows/changelog.yml` -- Changelog page (confidence: 0.88)
- `workflows/integrations.yml` -- Integrations marketplace (confidence: 0.75)

### Existing workflows checked
- 7 of 8 existing workflows are still valid
- `workflows/pricing.yml` may be stale (pricing tiers section removed)

### Recommendations
- Review `workflows/pricing.yml` and update or remove it
- The /integrations page has heavy dynamic content -- consider adding mask regions
```

### 8.1 Re-Discovery UX Modes

Re-discovery results are handled according to the project's `re_discovery_mode` setting (stored in project server-side settings):

**Mode 1: Auto-PR** (`re_discovery_mode: 'auto_pr'`)
- When new workflows are generated (from re-discovery or route detection), Megatest automatically creates a PR on the target repo (or config repo).
- The PR includes only new files. Existing workflows are never modified.
- PR title: 'Add Megatest workflows for {N} new pages'
- PR body includes the discovery report with confidence scores and recommendations.

**Mode 2: Suggest in UI** (`re_discovery_mode: 'suggest'`, default)
- New uncovered routes are stored as suggestions in the `detected_routes` table.
- The project's Discovery tab shows suggestions with 'Discover' buttons.
- The user can discover individual routes or all uncovered routes at once.
- After discovery completes, the user can review generated workflows and choose to create a PR or apply server-side.

The mode is configurable per-project in the project settings tab.
