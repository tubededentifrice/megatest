---
name: megatest
description: Generate and update visual regression test configurations by analyzing code diffs and browsing the live site via Playwright MCP.
---

# Megatest: Visual Regression Test Config Generator

Generate and incrementally update `.megatest/` config by analyzing code changes and browsing the live site.

## Usage

```
/megatest <repo_path> <base_url> [focus_text] [--plan <name>]
```

**Examples:**
```
/megatest ../fj2 http://localhost:8001
/megatest ../fj2 http://localhost:8001 "checkout flow"
/megatest ../fj2 http://localhost:8001 --plan smoke
```

## Arguments

Parse `$ARGUMENTS` to extract:
- `repo_path` (required): Path to target repository (e.g., `../fj2`)
- `base_url` (required): URL of the running application (e.g., `http://localhost:8001`)
- `focus_text` (optional): Specific area to focus on (e.g., `"login flow"`, `"checkout"`)
- `--plan <name>` (optional): Name for the plan to create/update (default: `default`)

## Mode Detection

Read `.megatest/state.json` in the target repo:
- **Missing** → Bootstrap mode (create everything from scratch)
- **Present** → Incremental mode (update based on changes since last run)

## Bootstrap Mode

When `.megatest/` doesn't exist or has no `state.json`:

### Step 1: Create directory structure

Use the Write tool to create:

```
<repo_path>/.megatest/
  config.yml
  workflows/          (empty, will be populated)
  includes/           (empty, will be populated)
  plans/              (empty, will be populated)
  baselines/          (empty)
  .gitignore
```

**config.yml** (adapt viewports/variables to the project):
```yaml
version: "1"
defaults:
  viewport: { width: 1280, height: 720 }
  threshold: 0.1
  waitAfterNavigation: "1000"
  screenshotMode: viewport
  timeout: 30000
viewports:
  desktop: { width: 1280, height: 720 }
  mobile: { width: 375, height: 812 }
variables:
  TEST_USER: test@example.com
  TEST_PASS: testpass123
```

**.gitignore:**
```
reports/
actuals/
```

### Step 2: Analyze target repo

Read key source files to understand the project:
- For **Django**: `urls.py`, `views.py`, templates directory
- For **Next.js**: `pages/` or `app/` directory, `next.config.js`
- For **React/Vite**: `src/App.tsx`, router config
- For **Generic**: Look for route definitions, page components

### Step 3: Browse the live site

Use Playwright MCP to discover pages and get locators:

```
mcp__playwright__browser_navigate  → navigate to base_url
mcp__playwright__browser_snapshot  → get accessibility tree (PRIMARY source for locators)
mcp__playwright__browser_click     → test interactive elements
mcp__playwright__browser_type      → test form inputs
mcp__playwright__browser_close     → clean up when done
```

**Exploration strategy:**
1. Navigate to the root URL
2. Take a snapshot to understand the page structure
3. Identify navigation links from the accessibility tree
4. Visit each major section/page
5. For each page, identify:
   - Key visual sections worth screenshotting
   - Interactive elements (forms, buttons, tabs)
   - Authentication requirements
6. Note form fields and their labels for locator selection

### Step 4: Generate workflow files

For each discovered page/flow, create a `workflows/<name>.yml` file:

```yaml
name: homepage
description: Homepage visual checks
steps:
  - open: /
  - wait: 500
  - screenshot: homepage-hero
  - scroll: { down: 500 }
  - screenshot: homepage-content
  - scroll: { down: 500 }
  - screenshot: homepage-footer
```

**Naming conventions:**
- Filenames: `[a-z0-9-]+.yml` (lowercase, hyphens only)
- Filename MUST match the `name` field inside the file
- Checkpoint names: descriptive, lowercase-hyphens (e.g., `login-form-empty`, `dashboard-stats`)

**Step types reference:**

| Step | Example | Description |
|------|---------|-------------|
| `open` | `open: /login` | Navigate to URL path (relative to base_url) |
| `wait` | `wait: 500` | Wait milliseconds |
| `screenshot` | `screenshot: page-name` | Take screenshot checkpoint |
| `click` | `click: { role: "button", name: "Sign in" }` | Click element |
| `fill` | `fill: { label: "Email", value: "${TEST_USER}" }` | Fill form field |
| `hover` | `hover: { testid: "menu-trigger" }` | Hover over element |
| `select` | `select: { label: "Country", value: "FR" }` | Select dropdown option |
| `press` | `press: "Enter"` | Press keyboard key |
| `scroll` | `scroll: { down: 500 }` | Scroll the page |
| `eval` | `eval: "document.querySelector('.modal').remove()"` | Run JavaScript |
| `include` | `include: login` | Include reusable steps |
| `set-viewport` | `set-viewport: mobile` | Change viewport size |

**Locator shape** (use in click, fill, hover, select):
```yaml
# Priority order - use the FIRST one available:
{ testid: "login-btn" }                    # 1. data-testid (most stable)
{ role: "button", name: "Sign in" }        # 2. ARIA role + name
{ label: "Email address" }                 # 3. Form label
{ text: "Get Started" }                    # 4. Visible text
{ placeholder: "Enter your email" }        # 5. Placeholder
{ css: ".header > nav > a:nth-child(2)" }  # 6. CSS selector (least stable)
```

**IMPORTANT:** Get locator values from the Playwright MCP `browser_snapshot` accessibility tree, NOT by guessing. The snapshot shows exact roles, names, and labels.

### Step 5: Create reusable includes

If authentication is needed, create `includes/login.yml`:
```yaml
name: login
steps:
  - open: /login
  - fill: { label: "Email", value: "${TEST_USER}" }
  - fill: { label: "Password", value: "${TEST_PASS}" }
  - click: { role: "button", name: "Sign in" }
  - wait: 1000
```

Then reference it in workflows that need auth:
```yaml
steps:
  - include: login
  - open: /dashboard
  - screenshot: dashboard-main
```

### Step 6: Create default plan

Create `plans/default.yml` listing all generated workflows:
```yaml
name: default
description: All visual regression tests
workflows:
  - homepage
  - login
  - dashboard
```

### Step 7: Write state.json

```json
{
  "last_plan_commit": "<full SHA from git rev-parse HEAD in target repo>",
  "last_plan_update": "<ISO 8601 timestamp>",
  "base_url": "<base_url argument>"
}
```

Get the commit SHA:
```bash
git -C <repo_path> rev-parse HEAD
```

### Step 8: Validate

Run the validator to confirm syntax:
```bash
node ~/git/megatest/cli/bin/megatest.js validate --repo <repo_path>
```

Fix any errors reported by the validator before finishing.

## Incremental Mode

When `.megatest/state.json` exists:

### Step 1: Check what changed

```bash
git -C <repo_path> diff <last_plan_commit>..HEAD --name-only
```

Categorize changed files:
- **Route changes**: urls.py, router configs, page components → may need new workflows
- **Template/view changes**: templates, components → may need workflow updates
- **Style changes**: CSS, theme → existing workflows cover this (no config change needed)
- **Backend-only changes**: models, serializers, utils → no config change needed

### Step 2: Read existing workflows

Read all files in `.megatest/workflows/` to understand current coverage.

### Step 3: Browse affected pages

Use Playwright MCP to visit ONLY pages affected by the changes. Take snapshots to get current locators.

### Step 4: Generate new workflows

- **New routes/pages**: Create new workflow files
- **Changed pages**: Do NOT modify existing workflows unless structure changed significantly. Instead, note in output that the user should review existing workflows.
- **Removed pages**: Note in output but do NOT delete existing workflows

### Step 5: Update plan

Add any new workflow names to `plans/default.yml`.

### Step 6: Update state.json

Update `last_plan_commit` and `last_plan_update`.

### Step 7: Validate

```bash
node ~/git/megatest/cli/bin/megatest.js validate --repo <repo_path>
```

## Important Rules

1. **Never guess locators.** Always use `browser_snapshot` to get the real accessibility tree and derive locators from it.
2. **Prefer semantic locators** over CSS selectors. Priority: testid > role > label > text > placeholder > css.
3. **Use variables** for credentials: `${TEST_USER}`, `${TEST_PASS}`, `${env:VAR_NAME}`.
4. **One workflow per flow** — don't cram everything into one file.
5. **Keep checkpoint names descriptive** — `dashboard-stats-loaded` not `screenshot-1`.
6. **Always close the browser** when done: `mcp__playwright__browser_close`.
7. **Run validate** after every config change.
8. **Filenames must match name fields** — `homepage.yml` must contain `name: homepage`.

## Variable Interpolation

- `${VAR_NAME}` → resolved from config.yml `variables` section
- `${env:VAR_NAME}` → resolved from environment variables at runtime
- Use variables for anything that might change between environments (credentials, URLs, test data)

## Output

When finished, print:
1. Summary of what was created/updated
2. How to run the tests:
   ```
   node ~/git/megatest/cli/bin/megatest.js run --repo <repo_path> --url <base_url>
   ```
3. How to accept baselines after first run:
   ```
   node ~/git/megatest/cli/bin/megatest.js accept --repo <repo_path>
   ```
