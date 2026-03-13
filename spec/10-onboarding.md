# Spec 10 — Zero-Config Onboarding

Status: **draft**
Depends on: spec-03 (data model), spec-04 (API), spec-06 (GitHub integration), spec-07 (review UI), spec-08 (discovery)

---

## 1. Overview

The onboarding flow is designed to get a user from signup to their first visual test results with zero configuration. The user connects a repo, Megatest auto-discovers workflows, and the first push/PR triggers a run.

The flow has five stages:

```
Signup ──> Install GitHub App ──> Connect repo ──> Auto-discover ──> First run
```

Each stage is designed to require the minimum number of decisions from the user. Sensible defaults are chosen throughout so that the first run can happen without any manual configuration. The onboarding checklist (section 6) guides users through each stage and tracks completion.

---

## 2. Signup Flow

### Step-by-step

1. **User visits megatest.dev.** The marketing landing page explains what Megatest does. The primary CTA is a "Get Started" button.

2. **User clicks "Get Started" or "Sign in with GitHub".** Both buttons initiate the same flow.

3. **GitHub OAuth flow.** The browser redirects to GitHub's authorization page. The server handles the OAuth exchange as specified in spec 06 section 2.

4. **On first login (new user record):**
   - a. A `users` row is created from the GitHub profile (spec 06 section 2, step 7).
   - b. An `organizations` row is auto-created, named after the user's GitHub login (e.g., `"octocat"`). The slug is derived from the login (lowercased, non-alphanumerics replaced with hyphens).
   - c. A `memberships` row is created with `role = 'owner'`, linking the user to the new organization.

5. **User lands on the dashboard (`/`).** At this point the user has no projects, so the dashboard shows the empty state (section 7) and the onboarding checklist (section 6).

6. **GitHub App installation check.** The SPA calls `GET /api/v1/installations` to check for active installations linked to the user's GitHub account.

   - **No installation exists:** Show a prompt card at the top of the dashboard:

   ```
   ┌──────────────────────────────────────────────────────────────┐
   │  Install the Megatest GitHub App                             │
   │                                                              │
   │  Megatest needs access to your repositories to run           │
   │  visual tests. Install the GitHub App to get started.        │
   │                                                              │
   │  [Install on GitHub →]                                       │
   └──────────────────────────────────────────────────────────────┘
   ```

   The button links to the GitHub App installation page (`https://github.com/apps/megatest`). After installing, GitHub redirects back via the setup URL (spec 06, section 1) with the `installation_id` parameter, and the `installation.created` webhook populates the installation record.

   - **Installation exists:** Show the repo picker (section 3).

### Returning users

Returning users who already have projects skip straight to the normal dashboard view. The onboarding checklist only appears when at least one step is incomplete.

---

## 3. Repo Connection

### 3.1 Repo Picker

When the user clicks "+ Connect repo" on the dashboard (or when the onboarding flow reaches this stage), a dialog appears listing all repos accessible via the user's GitHub App installations.

```
┌──────────────────────────────────────────────────────────────┐
│  Connect a repository                                        │
│  ────────────────────────────────────────────────────────     │
│  Search: [____________________]                              │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  octocat/web-app             public    JavaScript      │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │  octocat/api-server          private   TypeScript      │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │  octocat/marketing-site      public    JavaScript      │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │  octocat/docs                public    MDX             │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  Showing repos from: octocat (GitHub App)                    │
│  Don't see your repo? [Manage GitHub App permissions →]      │
└──────────────────────────────────────────────────────────────┘
```

For each repo the picker shows:
- **Name** -- `owner/repo` format
- **Visibility** -- public or private badge
- **Language** -- primary language from GitHub metadata

The picker is populated from `GET /api/v1/installations/:id/repositories` for each installation. If the user has multiple installations (personal + organization accounts), repos from all installations are shown, grouped by account.

A search field filters repos by name (client-side filter for the initial list; if the installation has many repos, the GitHub API is queried server-side).

The "Manage GitHub App permissions" link opens the GitHub App installation settings page where the user can add repos they do not see.

### 3.2 Connection Flow

1. **User selects a repo** from the picker.

2. **`POST /api/v1/projects`** creates the project with the selected `repo_id` and `installation_id` (spec 04 section 3.2).

3. **Server probes for existing config.** The server uses the GitHub Contents API to check for `.megatest/config.yml` in the repo's default branch:
   ```
   GET https://api.github.com/repos/{owner}/{repo}/contents/.megatest/config.yml
   Authorization: token {INSTALLATION_TOKEN}
   ```

4. **Branch on config existence:**

   - **Config exists:** The project is immediately ready. The dialog closes and the project card appears on the dashboard with a success message:

   ```
   ┌──────────────────────────────────────────────────────────────┐
   │  ✓ Project connected!                                        │
   │                                                              │
   │  Runs will trigger on your configured events.               │
   │  Waiting for the next push or PR...                         │
   └──────────────────────────────────────────────────────────────┘
   ```

   - **Config does NOT exist:** Auto-discovery begins (section 4). The `POST /api/v1/projects` response includes a `discovery_id` field, and the dashboard transitions to the discovery progress view.

### 3.3 Trigger Rules Setup

After connecting a repo -- either immediately (if config exists) or after discovery completes -- the user is prompted to configure trigger rules. This step determines when Megatest runs visual tests.

```
┌──────────────────────────────────────────────────────────────┐
│  When should Megatest run visual tests?                      │
│                                                              │
│  ○ PRs only                        ← recommended for most   │
│                                       projects              │
│  ○ PRs + pushes to main            ← recommended for        │
│                                       production monitoring  │
│  ○ All pushes and PRs              ← maximum coverage,      │
│                                       higher usage           │
│  ○ Custom...                       ← advanced: configure    │
│                                       specific rules         │
│                                                              │
│  [Save]                                                      │
└──────────────────────────────────────────────────────────────┘
```

Each option maps to a trigger rule configuration saved via `PUT /api/v1/projects/:id/triggers`:

| Option | Trigger rules |
|--------|---------------|
| PRs only | `[{ "event": "pull_request", "actions": ["opened", "synchronize", "reopened"] }]` |
| PRs + pushes to main | `[{ "event": "pull_request", "actions": ["opened", "synchronize", "reopened"] }, { "event": "push", "branches": ["{default_branch}"] }]` |
| All pushes and PRs | `[{ "event": "pull_request", "actions": ["opened", "synchronize", "reopened"] }, { "event": "push", "branches": ["*"] }]` |
| Custom | Opens the full trigger rules editor in the project settings tab (spec 07 section 1.2, Settings tab) |

If the user skips this step (dismisses the prompt), the default is **PRs only** -- the safest option with the lowest usage.

---

## 4. Auto-Discovery

Auto-discovery runs when a newly connected repo has no `.megatest/` config. The full discovery mechanics are specified in spec 08. This section covers the onboarding-specific UX around discovery.

### 4.1 Discovery Trigger

1. Project is created via `POST /api/v1/projects`.
2. Server detects no `.megatest/` config in the repo (GitHub Contents API probe).
3. A discovery job is automatically enqueued (spec 08 section 3.1b).
4. The `discovery_id` is returned in the project creation response.

### 4.2 Progress Display

The dashboard shows a discovery progress card for the newly connected project. Progress updates are fetched by polling `GET /api/v1/discoveries/:id` at a 5-second interval (consistent with the review page polling mechanism from spec 07 section 6).

**Setup phase:**

```
┌──────────────────────────────────────────────────────────────┐
│  ◐ Setting up acme/web-app...                                │
│  Phase: Installing dependencies (npm ci)                     │
│  [View logs]                                                 │
└──────────────────────────────────────────────────────────────┘
```

**Exploration phase:**

```
┌──────────────────────────────────────────────────────────────┐
│  ◐ Discovering workflows for acme/web-app...                 │
│  Phase: Exploring pages... 7 visited, 3 workflows found      │
│  Elapsed: 45s                                                │
│  [View logs]                                                 │
└──────────────────────────────────────────────────────────────┘
```

**Generation phase:**

```
┌──────────────────────────────────────────────────────────────┐
│  ◐ Discovering workflows for acme/web-app...                 │
│  Phase: Generating workflow configuration...                 │
│  [View logs]                                                 │
└──────────────────────────────────────────────────────────────┘
```

The progress card maps discovery phases to user-facing messages:

| Discovery status | `progress.phase` | Display message |
|-----------------|-------------------|-----------------|
| `running` | `setup` | "Installing dependencies..." |
| `running` | `exploration` | "Exploring pages... {pages_visited} visited, {workflows so far} workflows found" |
| `running` | `generation` | "Generating workflow configuration..." |
| `completed` | -- | Discovery complete card (section 4.3) |
| `failed` | -- | Discovery failure card (section 4.4) |

### 4.3 Discovery Complete

When discovery finishes successfully, the progress card transitions to a results view:

```
┌──────────────────────────────────────────────────────────────┐
│  ✓ Discovery complete for acme/web-app                       │
│                                                              │
│  Found 8 workflows across 14 pages                           │
│  Authentication detected (email/password login)              │
│                                                              │
│  Generated files:                                            │
│  ├── config.yml                                              │
│  ├── workflows/homepage.yml          (confidence: 95%)       │
│  ├── workflows/login.yml             (confidence: 82%)       │
│  ├── workflows/dashboard.yml         (confidence: 88%)       │
│  ├── workflows/settings.yml          (confidence: 75%)       │
│  └── includes/login.yml                                      │
│                                                              │
│  [Review & create PR]  [Edit first]                          │
└──────────────────────────────────────────────────────────────┘
```

The card displays:
- Number of workflows generated and pages explored (from `discovery.report`)
- Authentication method detected, if any
- File tree of generated configs with confidence scores for each workflow (from `discovery.workflows`)
- Three action buttons for applying the results

#### Apply options

The user chooses how to apply the generated config:

**Review & create PR** (default):

1. User clicks the button.
2. A preview dialog shows the generated files in a read-only YAML viewer, organized as a file tree. Each file is expandable.
3. User can uncheck individual files to exclude them.
4. User clicks "Create PR".
5. `POST /api/v1/discoveries/:id/apply` is called with `create_pr: true` and the selected `files_to_include`.
6. The PR is created on the config repo (which is the project repo by default).
7. The response includes the `pr_url`.
8. The card updates to show the PR link:

   ```
   ┌──────────────────────────────────────────────────────────────┐
   │  ✓ Config PR created for acme/web-app                        │
   │                                                              │
   │  PR #42: Add Megatest visual testing configuration           │
   │  [View PR on GitHub →]                                       │
   │                                                              │
   │  Merge the PR to enable visual test runs.                    │
   └──────────────────────────────────────────────────────────────┘
   ```

9. After the user merges, the next push/PR event (matching trigger rules) triggers a run.

**Edit first:**

1. User clicks the button.
2. A config editor opens: a simple in-browser code editor (monospace textarea with syntax highlighting or a lightweight library like CodeMirror) displaying the generated YAML files in a tabbed interface.
3. User can modify any file, add new files, or remove files.
4. User clicks "Apply" when satisfied.
5. A PR is created on the config repo with the edited files (`POST /api/v1/discoveries/:id/apply` with modified `config_files`).
6. The flow continues as with "Review & create PR".

### 4.4 Discovery Failure

If discovery fails (the app will not start, complex setup requirements, timeout), the progress card transitions to a failure state:

```
┌──────────────────────────────────────────────────────────────┐
│  ✖ Discovery failed for acme/web-app                         │
│                                                              │
│  Error: App failed to start. 'npm run dev' exited with       │
│  code 1 after 30 seconds.                                    │
│                                                              │
│  This usually means the app needs additional setup.          │
│                                                              │
│  [Provide setup commands]  [Upload config manually]          │
│  [Try again]               [Skip discovery]                  │
└──────────────────────────────────────────────────────────────┘
```

The error message comes from `discovery.error.message`. The card offers four recovery options:

**Provide setup commands:**

1. Opens a form for specifying the setup configuration:

   ```
   ┌──────────────────────────────────────────────────────────────┐
   │  Setup Configuration                                         │
   │                                                              │
   │  Install commands (one per line):                            │
   │  ┌────────────────────────────────────────────────────────┐  │
   │  │ npm ci                                                 │  │
   │  │ cp .env.example .env                                   │  │
   │  └────────────────────────────────────────────────────────┘  │
   │                                                              │
   │  Serve command:                                              │
   │  [npm run dev                    ]                           │
   │                                                              │
   │  Ready URL (the URL to poll until the app is up):            │
   │  [http://localhost:3000          ]                           │
   │                                                              │
   │  Prepare commands (optional, run before serve):              │
   │  ┌────────────────────────────────────────────────────────┐  │
   │  │ npm run db:migrate                                     │  │
   │  │ npm run db:seed                                        │  │
   │  └────────────────────────────────────────────────────────┘  │
   │                                                              │
   │  [Re-run discovery with these settings]                      │
   └──────────────────────────────────────────────────────────────┘
   ```

2. The provided commands are submitted as a partial `config.yml` and discovery is re-triggered with the custom setup config, skipping the setup detection phase.

**Upload config manually:**

1. Opens the config editor (same as "Edit first" in section 4.3) with a blank template.
2. User writes or pastes their own YAML config.
3. Config is applied via PR on the config repo.

**Try again:**

1. Re-triggers discovery via `POST /api/v1/projects/:id/discover`.
2. The progress card resets to the setup phase.
3. Useful when the failure was transient (e.g., network timeout during `npm install`).

**Skip discovery:**

1. Dismisses the discovery failure.
2. The project is created but has no config. The project card shows an empty state.
3. The user can manually trigger discovery later from the project's Discovery tab or upload config manually.

---

## 5. First Run

After the config PR is merged, the project is ready for visual test runs. Since all config is applied via PR merge, the first run happens after the PR is merged and a subsequent push or PR event (matching trigger rules) triggers it. The merge itself creates a push event on the default branch, which triggers the first run if push-based trigger rules are configured.

### 5.1 First Run Behavior

The first run has special characteristics:

1. **No baselines exist.** Every checkpoint is `status = 'new'`.
2. **The review page shows all screenshots as NEW.** Each checkpoint card displays the actual image with the message "No baseline exists for this checkpoint. This is the first capture. Approve to set it as the baseline." (spec 07 section 1.3, NEW checkpoint).
3. **An "Approve All" button** is prominently displayed in the filter bar.
4. **Approving establishes the initial baselines.** When the user clicks "Approve All", each checkpoint's actual image is saved as the baseline for the project's branch via `POST /api/v1/runs/:id/approve-all`.
5. **Subsequent runs compare against these baselines.** Once baselines are set, future runs produce `pass` or `fail` results based on pixel comparison.

### 5.2 First Run Review Page

The review page for a first run has a slightly different header to guide the user:

```
┌─────────────────────────────────────────────────────────────────────┐
│  MEGATEST   acme/web-app   a1b2c3d   main                          │
│             First run — no baselines yet                             │
│             12 new checkpoints                     Duration: 47s    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  This is your first visual test run! Review the screenshots below   │
│  and approve them to set your initial baselines.                    │
│                                                                     │
│  [All 12] [New 12]                                  [Approve All]  │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ ▼ homepage / hero-section / 1280x720              NEW       │   │
│  │                                                             │   │
│  │  ┌─────────────┐                                            │   │
│  │  │   ACTUAL    │   No baseline exists. Approve to set it.   │   │
│  │  │             │                                            │   │
│  │  │             │                                            │   │
│  │  └─────────────┘                                            │   │
│  │                                                             │   │
│  │  [Approve]                                                  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ ▼ homepage / footer / 1280x720                    NEW       │   │
│  │  ...                                                        │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ...                                                                │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

The "First run" banner text is only shown when:
- The run is the first completed run for the project.
- All checkpoints in the run have `status = 'new'`.

---

## 6. Onboarding Checklist

The dashboard shows a persistent onboarding checklist for new users until all steps are complete. The checklist is rendered as a card in the dashboard sidebar or above the project list.

```
┌──────────────────────────────────────────────────────────────┐
│  Getting Started with Megatest                               │
│  ─────────────────────────────                               │
│  ✓ Sign in with GitHub                                       │
│  ✓ Install Megatest GitHub App                               │
│  ✓ Connect your first repository                             │
│  ◐ Wait for workflow discovery                               │
│  ○ Review and merge config PR                                │
│  ○ Configure trigger rules                                   │
│  ○ Approve first run baselines                               │
│                                                              │
│                                              [Dismiss]       │
└──────────────────────────────────────────────────────────────┘
```

### Step states

| Icon | State | Meaning |
|------|-------|---------|
| `✓` | Complete | Step is done |
| `◐` | In progress | Step is currently active |
| `○` | Pending | Step has not been reached yet |

### Step completion criteria

| Step | Complete when |
|------|---------------|
| Sign in with GitHub | Always complete if the user is logged in |
| Install Megatest GitHub App | `GET /api/v1/installations` returns at least one active installation |
| Connect your first repository | `GET /api/v1/projects` returns at least one project |
| Wait for workflow discovery | The project's most recent discovery has `status = 'completed'`, OR the project already had `.megatest/` config (discovery was skipped) |
| Review and merge config PR | Config is available for runs: the discovery PR was merged (`.megatest/` exists in the config repo) |
| Configure trigger rules | `GET /api/v1/projects/:id/triggers` returns a non-empty trigger configuration |
| Approve first run baselines | At least one run for the project has `status = 'completed'` and all reviewable checkpoints in that run have `review_state = 'approved'` |

### Interaction

Each checklist step is clickable and links to the relevant action:

| Step | Links to |
|------|----------|
| Sign in with GitHub | `/auth/github` (already completed if visible) |
| Install Megatest GitHub App | GitHub App installation page |
| Connect your first repository | Opens the repo picker dialog |
| Wait for workflow discovery | Project page with discovery status |
| Review and merge config PR | The PR URL on GitHub |
| Configure trigger rules | Project settings tab (`/project/:id?tab=settings`) |
| Approve first run baselines | Review page for the first completed run |

### Dismissal

The checklist disappears automatically when all steps are complete. The user can also dismiss it early by clicking the "Dismiss" link. Dismissal is stored as a user preference (e.g., a `preferences` JSONB field on the `users` table or a key in `localStorage`). Once dismissed, the checklist does not reappear.

---

## 7. Empty States

All empty states are designed to guide the user toward the next action. They include a clear message and a primary CTA button.

### No projects

Shown on the dashboard when `GET /api/v1/projects` returns an empty list.

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  No projects yet.                                            │
│                                                              │
│  Connect a GitHub repository to get started.                 │
│                                                              │
│                    [+ Connect repo]                          │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### No runs

Shown on the project page Runs tab when the project has no runs.

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  No runs yet.                                                │
│                                                              │
│  Push a commit or open a PR to trigger your first            │
│  visual test.                                                │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### No baselines

Shown on the review page when all checkpoints are `status = 'new'` (first run).

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  This is your first run!                                     │
│                                                              │
│  Review the screenshots and approve them to set              │
│  baselines.                                                  │
│                                                              │
│                    [Approve All]                              │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

This message appears as an inline banner above the checkpoint cards (see section 5.3).

### No trigger rules

Shown on the project page when trigger rules have not been configured.

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  No trigger rules configured.                                │
│                                                              │
│  Configure when Megatest should run visual tests.            │
│                                                              │
│                    [Set up triggers]                          │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

The button links to the project settings tab trigger rules section.

### No GitHub App installation

Shown on the dashboard when the user has no active installations (section 2, step 6).

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  Install the Megatest GitHub App                             │
│                                                              │
│  Megatest needs access to your repositories to run           │
│  visual tests. Install the GitHub App to get started.        │
│                                                              │
│                    [Install on GitHub →]                      │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 8. End-to-End Flow Diagram

The complete onboarding flow from first visit to established baselines:

```
                    ┌──────────────┐
                    │  User visits  │
                    │ megatest.dev  │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │  "Get Started"│
                    │  click       │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │  GitHub OAuth │
                    │  flow        │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │  User + Org   │
                    │  created      │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐    No     ┌────────────────┐
                    │  GitHub App   ├─────────►│  Install prompt │
                    │  installed?   │          │  → GitHub App   │
                    └──────┬───────┘          │    install page │
                           │ Yes              └────────┬───────┘
                           │                           │
                           │◄──────────────────────────┘
                           ▼
                    ┌──────────────┐
                    │  Repo picker  │
                    │  → select repo│
                    └──────┬───────┘
                           │
                           ▼
                  ┌────────────────┐
                  │  POST /projects │
                  │  + config probe │
                  └────────┬───────┘
                           │
              ┌────────────┴────────────┐
              │                         │
         Config exists            No config
              │                         │
              ▼                         ▼
     ┌────────────────┐        ┌────────────────┐
     │ "Project ready"│        │  Auto-discovery │
     │  card          │        │  job enqueued   │
     └────────┬───────┘        └────────┬───────┘
              │                         │
              │                         ▼
              │                ┌────────────────┐
              │                │  Progress card  │
              │                │  (polling)      │
              │                └────────┬───────┘
              │                         │
              │              ┌──────────┴──────────┐
              │              │                      │
              │         Completed               Failed
              │              │                      │
              │              ▼                      ▼
              │     ┌────────────────┐     ┌────────────────┐
              │     │  Results card   │     │  Error card     │
              │     │  [PR] [Edit]    │     │  [Retry]        │
              │     │                 │     │  [Setup cmds]   │
              │     └────────┬───────┘     │  [Manual]        │
              │              │             │  [Skip]          │
              │              ▼             └────────┬───────┘
              │     ┌────────────────┐              │
              │     │  Config PR      │◄─────────────┘
              │     │  created        │
              │     └────────┬───────┘
              │              │
              ▼              ▼
     ┌──────────────────────────┐
     │  Trigger rules prompt    │
     │  (PRs only / PRs+push / │
     │   All / Custom)          │
     └──────────┬───────────────┘
                │
                ▼
     ┌──────────────────────────┐
     │  First run triggered     │
     │  (push, PR, or manual)   │
     └──────────┬───────────────┘
                │
                ▼
     ┌──────────────────────────┐
     │  Review page             │
     │  All checkpoints: NEW    │
     │  [Approve All]           │
     └──────────┬───────────────┘
                │
                ▼
     ┌──────────────────────────┐
     │  Baselines established   │
     │  Onboarding complete ✓   │
     └──────────────────────────┘
```

---

## 9. API Interactions

This section summarizes the API endpoints involved in the onboarding flow and the order in which they are called. All endpoints are specified in detail in spec 04.

### Signup and login

| Step | Request | Response |
|------|---------|----------|
| Start OAuth | `GET /auth/github` | 302 to GitHub |
| OAuth callback | `GET /auth/github/callback?code=...&state=...` | 302 to dashboard, session cookie set |
| Verify session | `GET /auth/me` | 200 with user profile |

### Installation check

| Step | Request | Response |
|------|---------|----------|
| List installations | `GET /api/v1/installations` | 200 with installations array |
| List repos | `GET /api/v1/installations/:id/repositories` | 200 with repositories array |

### Project creation

| Step | Request | Response |
|------|---------|----------|
| Create project | `POST /api/v1/projects` with `{ repo_id, installation_id }` | 201 with project + optional `discovery_id` |

### Discovery

| Step | Request | Response |
|------|---------|----------|
| Poll status | `GET /api/v1/discoveries/:id` | 200 with discovery status and progress |
| Apply results | `POST /api/v1/discoveries/:id/apply` | 201 with PR URL or applied files |
| Re-trigger | `POST /api/v1/projects/:id/discover` | 202 with new `discovery_id` |

### Trigger rules

| Step | Request | Response |
|------|---------|----------|
| Set triggers | `PUT /api/v1/projects/:id/triggers` | 200 with saved trigger rules |

### First run

| Step | Request | Response |
|------|---------|----------|
| View run | `GET /api/v1/runs/:id` | 200 with run details and checkpoints |
| Approve all | `POST /api/v1/runs/:id/approve-all` | 200 with approved checkpoints |

---

## Open Questions

1. **GitHub App installation redirect.** After the user installs the GitHub App on GitHub, they are redirected back to Megatest via the setup URL. Should the redirect go to the dashboard (current spec) or directly to the repo picker to reduce clicks?

2. **Multiple organizations.** If a user belongs to multiple GitHub organizations, each with its own GitHub App installation, should the onboarding create one Megatest organization per GitHub org, or let the user choose which Megatest organization to assign repos to?

3. **Onboarding checklist persistence.** Should checklist dismissal be stored server-side (user preferences in the database) or client-side (localStorage)? Server-side is consistent across devices; client-side is simpler to implement.

4. **Discovery timeout UX.** Discovery has a 5-minute wall-clock limit (spec 08 section 6.1). If a large app approaches this limit, should the progress card show a warning, or just let it complete with partial results?
