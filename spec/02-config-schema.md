# Megatest Configuration Schema Specification

**Version:** 1.0
**Status:** Draft

## 1. Overview

Megatest configuration is not a single file. It is a `.megatest/` directory containing multiple YAML files organized by concern. This structure is designed to be generated and maintained by AI agents, not hand-edited by users, though the format remains human-readable for inspection and debugging.

All YAML files in the `.megatest/` directory MUST be valid YAML 1.2. Parsers MUST reject files with syntax errors rather than attempting partial interpretation.

### Config Repository

This schema is the canonical format regardless of where config is stored. Config always lives in a Git repository:

- By default, config lives in a **dedicated config repo**. Discovery creates PRs to add or update config files on the config repo.
- Alternatively, the project can be configured so that config lives in the **project repository itself**, under `.megatest/`.

The project's `config_repo_url` setting determines the source:

- When `config_repo_url` is **null or matches the project repo URL**, config is read from `.megatest/` in the project repo.
- When `config_repo_url` points to a **different repo**, config is read from that repo (optionally at a subdirectory path).

In both cases, the YAML format and validation rules described in this spec apply identically.

## 2. Directory Structure

```
.megatest/
  config.yml              # Required. Global configuration.
  workflows/              # Required. At least one workflow file.
    <workflow-name>.yml
    ...
  includes/               # Optional. Reusable step sequences.
    <include-name>.yml
    ...
```

### 2.1 File Naming Rules

- All filenames MUST use lowercase alphanumeric characters and hyphens only: `[a-z0-9-]+\.yml`.
- Workflow filenames MUST match the `name` field inside the file (without the `.yml` extension). A mismatch is a validation error.
- Include filenames MUST match the `name` field inside the file (without the `.yml` extension).
- No two workflow files may share the same `name`. No two include files may share the same `name`.
- Files that do not match the naming pattern MUST be ignored with a warning.

### 2.2 Required vs Optional Paths

| Path | Required | Notes |
|------|----------|-------|
| `.megatest/config.yml` | Yes | Validation fails without it |
| `.megatest/workflows/` | Yes | Must contain at least one `.yml` file |
| `.megatest/includes/` | No | Only required if any workflow uses `include` steps |

## 3. config.yml Schema

**Note:** Trigger rules (which GitHub events cause Megatest runs) are NOT part of this schema. They are server-side project settings configured through the Megatest UI/API. See spec 13 for the trigger rules specification.

The root configuration file defines environment setup, default parameters, viewport presets, and variable bindings.

```yaml
version: "1"             # Required. Schema version string.

setup:                    # Optional. Environment setup instructions.
  system: [string]
  install: [string]
  serve:
    cmd: string           # Managed mode: start a dev server in a container
    ready: string
    timeout: number
    env: object
    url: string           # External mode: test against an already-deployed URL
  prepare: [string]

defaults:                 # Optional. Default values for all workflows.
  viewport: { width: number, height: number }
  threshold: number
  waitAfterNavigation: string
  screenshotMode: string
  timeout: number

viewports:                # Optional. Named viewport presets.
  <name>: { width: number, height: number }

variables:                # Optional. Key-value variable bindings.
  <name>: string
```

### 3.1 `version` (required)

- **Type:** `string`
- **Allowed values:** `"1"`
- **Description:** Schema version. Future versions may introduce breaking changes. Parsers MUST reject unknown versions.

### 3.2 `setup` (optional)

Defines how to prepare the runtime environment. Setup operates in one of two modes:

- **Managed mode** (`serve.cmd` is set): Megatest clones the repo, spins up a Docker container, installs dependencies, and starts a dev server. Steps execute in order: `system` -> `install` -> `serve` (start cmd, wait for ready) -> `prepare`. This is the default mode.
- **External mode** (`serve.url` is set): Megatest tests against an already-deployed URL (e.g., a Vercel preview deployment, a staging server, or any externally-hosted environment). No Docker container is created for the app. The `system`, `install`, and `prepare` fields are ignored.

If `setup` is omitted entirely, the runner assumes the application is already running and accessible. In this case, the runner requires a `deploy_url_template` in project settings or a `deployment_status` trigger to know where the app is (see spec 13).

#### 3.2.1 `setup.system` (optional)

- **Type:** `array of string`
- **Default:** `[]`
- **Description:** Shell commands to install system-level dependencies. These run as root inside the container. Each string is passed to `sh -c`.
- **Examples:** `["apt-get update && apt-get install -y libvips"]`
- **Constraints:** Commands MUST be idempotent. The runner may cache layers and re-run these only when the list changes.

#### 3.2.2 `setup.install` (optional)

- **Type:** `array of string`
- **Default:** `[]`
- **Description:** Shell commands to install application dependencies. These run as the application user.
- **Examples:** `["npm ci", "pip install -r requirements.txt"]`

#### 3.2.3 `setup.serve` (optional)

- **Type:** `object`
- **Description:** Defines how the application under test is served. Supports two mutually exclusive modes: **managed** (start a dev server in a container) and **external** (test against an already-deployed URL).

##### Managed Mode (default)

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `cmd` | `string` | Yes | -- | Shell command to start the server. Supports variable interpolation. |
| `ready` | `string` | Yes | -- | URL to poll with GET requests. Must return HTTP 200 to indicate readiness. |
| `timeout` | `number` | No | `120` | Maximum seconds to wait for the ready URL. Must be a positive integer. If exceeded, the run fails with a setup timeout error. |
| `env` | `object` | No | `{}` | Additional environment variables for the server process. Keys are variable names, values are strings. Supports variable interpolation in values. |

- If `cmd` is present, `ready` is required. Omitting `ready` when `cmd` is set is a validation error.
- The server process is expected to remain running for the duration of all workflow execution. If it exits prematurely, the run fails.

##### External Mode

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `url` | `string` | Yes | -- | URL of the externally-hosted application. Supports variable interpolation (e.g., `"${DEPLOY_URL}"`). |
| `timeout` | `number` | No | `120` | Maximum seconds to wait for the URL to return HTTP 200. |

- If `url` is present, `cmd` and `ready` must NOT be set (validation error).
- When `url` is set, the runner skips Docker container creation entirely. The `system`, `install`, and `prepare` sections are ignored (validation warning if present).
- The runner polls the `url` with HTTP GET requests until it returns a 200 status code. This handles the common case where a preview deployment is still provisioning when the run starts.
- The resolved URL is stored on the run record as `deploy_url` for debugging (see spec 03).
- Playwright navigates to the external URL using the `open` step's path appended to the `url` as the base.

**Example -- static staging URL:**
```yaml
setup:
  serve:
    url: "https://staging.example.com"
```

**Example -- preview deployment URL via variable:**
```yaml
setup:
  serve:
    url: "${DEPLOY_URL}"
    timeout: 180
```

The `DEPLOY_URL` variable is populated automatically when a run is triggered by a `deployment_status` event (see spec 13), or resolved from the project's `deploy_url_template` setting (see spec 03). It can also be set manually in the `variables` section.

##### Mode Resolution

| `cmd` set | `url` set | Mode | Behavior |
|-----------|-----------|------|----------|
| Yes | No | Managed | Clone, Docker, build, serve |
| No | Yes | External | Poll external URL, no Docker |
| Yes | Yes | -- | Validation error |
| No | No | -- | `serve` is effectively omitted |

- If `serve` is omitted entirely, no server is started in managed mode. In this case, the runner requires the deploy URL to come from project settings or the trigger event.
- If `serve` is omitted and no deploy URL is available, the run fails with error: "No serve command or external URL configured."

#### 3.2.4 `setup.prepare` (optional)

- **Type:** `array of string`
- **Default:** `[]`
- **Description:** Shell commands to run after the server is ready. Used for database migrations, seed data, cache warming, etc. Supports variable interpolation.
- **Examples:** `["npx prisma migrate deploy", "node scripts/seed.js"]`
- **Constraints:** Each command must exit 0. A non-zero exit code fails the run.

### 3.3 `defaults` (optional)

Default values inherited by all workflows unless overridden at the workflow or step level.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `viewport` | `Viewport` | `{ width: 1280, height: 720 }` | Default browser viewport dimensions. |
| `threshold` | `number` | `0.1` | Percentage of pixels allowed to differ in screenshot comparison (0.0 to 100.0). |
| `waitAfterNavigation` | `string` | `"load"` | Wait strategy after navigation. One of: `"networkidle"`, `"load"`, or a string of digits representing milliseconds (e.g., `"2000"`). |
| `screenshotMode` | `string` | `"viewport"` | One of: `"viewport"` (visible area only) or `"full"` (full page scroll capture). |
| `timeout` | `number` | `30000` | Per-step timeout in milliseconds. Must be a positive integer. |

#### Threshold Semantics

- `0.0` means zero tolerance -- any pixel difference fails.
- `0.1` (the default) means up to 0.1% of pixels may differ.
- Values above `10.0` should trigger a validation warning (likely a mistake).
- Values above `100.0` are a validation error.
- Negative values are a validation error.

#### waitAfterNavigation Semantics

- `"networkidle"`: Wait until no network requests are in-flight for 500ms.
- `"load"`: Wait until the `load` event fires.
- A numeric string (e.g., `"2000"`): Wait a fixed number of milliseconds after the `load` event.

### 3.4 `viewports` (optional)

- **Type:** `map of string -> Viewport`
- **Default:** `{ desktop: { width: 1280, height: 720 } }`
- **Description:** Named viewport presets that workflows can reference by name.

Each value is a `Viewport` object:

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `width` | `number` | Yes | Positive integer, >= 320, <= 3840 |
| `height` | `number` | Yes | Positive integer, >= 240, <= 2160 |

Built-in convention (not enforced, but recommended):

```yaml
viewports:
  desktop: { width: 1280, height: 720 }
  tablet: { width: 768, height: 1024 }
  mobile: { width: 375, height: 812 }
```

If `viewports` is omitted, only the name `"desktop"` is available, defaulting to the `defaults.viewport` dimensions (or `1280x720` if that is also omitted).

### 3.5 `variables` (optional)

- **Type:** `map of string -> string`
- **Default:** `{}`
- **Description:** Named values available for interpolation in workflows, includes, and setup commands.

Variable names MUST match `[A-Z][A-Z0-9_]*` (uppercase with underscores). Lowercase or mixed-case names are a validation error.

```yaml
variables:
  BASE_URL: "http://localhost:3000"
  TEST_USER: "admin@example.com"
  TEST_PASS: "${env:TEST_PASSWORD}"
```

See Section 8 for interpolation syntax.

## 4. Workflow File Schema (workflows/*.yml)

Each file in `workflows/` defines a single test workflow: a named sequence of browser actions and screenshots.

```yaml
name: string              # Required.
description: string       # Optional.
viewports: [string]       # Optional. Default: ["desktop"]
steps: [Step]             # Required. Non-empty.
```

### 4.1 Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | `string` | Yes | -- | Workflow identifier. Must match the filename (without `.yml`). Pattern: `[a-z0-9-]+`. |
| `description` | `string` | No | `""` | Human-readable description of what the workflow tests. |
| `viewports` | `array of string` | No | `["desktop"]` | List of named viewport references. The workflow runs once per viewport. Each name must be defined in `config.yml` `viewports` (or be `"desktop"` if no viewports are defined). |
| `steps` | `array of Step` | Yes | -- | Ordered list of steps. Must contain at least one step. |

### 4.2 Multi-Viewport Execution

When a workflow specifies multiple viewports (e.g., `[desktop, mobile]`), the runner executes the entire step sequence once per viewport, in order. Screenshots are namespaced by viewport:

- Workflow `homepage` with viewport `desktop` and step `screenshot: hero` produces: `homepage/desktop/hero.png`
- Same workflow with viewport `mobile` produces: `homepage/mobile/hero.png`

Each viewport run starts with a fresh browser context (clean cookies, storage, etc.).

## 5. Include File Schema (includes/*.yml)

Each file in `includes/` defines a reusable sequence of steps.

```yaml
name: string              # Required.
steps: [Step]             # Required. Non-empty.
```

### 5.1 Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Include identifier. Must match the filename (without `.yml`). Pattern: `[a-z0-9-]+`. |
| `steps` | `array of Step` | Yes | Ordered list of steps. Must contain at least one step. |

### 5.2 Include Resolution

When a workflow step is `include: <name>`, the runner replaces that step with the full step sequence from the matching include file. Includes are resolved before execution begins (static expansion).

Include files MAY themselves contain `include` steps (nested includes). See Section 9.2 for cycle detection rules.

## 6. Step Types

A step is a single-key YAML mapping. The key identifies the step type; the value provides the step's parameters. Each step mapping MUST have exactly one key.

```yaml
# Valid: one key per mapping
- open: "http://localhost:3000"

# Invalid: multiple keys in one mapping
- open: "http://localhost:3000"
  wait: 1000
```

### 6.1 `open`

Navigate the browser to a URL.

```yaml
- open: <url>
```

- **Value type:** `string`
- **Required fields:** The URL string.
- **Variable interpolation:** Yes.
- **Maps to:** `page.goto(url)`
- **Behavior:** Navigates to the URL, then waits according to `defaults.waitAfterNavigation`.

### 6.2 `click`

Click an element identified by a locator.

```yaml
- click: <Locator>
```

- **Value type:** `Locator` (see Section 7).
- **Maps to:** `page.locator(selector).click()` (locator resolved via Playwright semantic locators; see Section 7).

### 6.3 `fill`

Clear an input field and type new text into it.

```yaml
- fill:
    <locator-key>: <locator-value>
    text: <string>
```

- **Value type:** `Locator` (see Section 7) extended with a required `text` field.
- **`text`:** The string to fill. Variable interpolation applies.
- **Maps to:** `page.locator(selector).fill(text)`
- **Behavior:** The existing field content is cleared before filling.

### 6.4 `type`

Type text into an element without clearing existing content first.

```yaml
- type:
    <locator-key>: <locator-value>
    text: <string>
```

- **Value type:** Same shape as `fill`.
- **Maps to:** `page.locator(selector).pressSequentially(text)`

### 6.5 `hover`

Hover over an element.

```yaml
- hover: <Locator>
```

- **Value type:** `Locator` (see Section 7).
- **Maps to:** `page.locator(selector).hover()`

### 6.6 `select`

Select an option from a `<select>` element.

```yaml
- select:
    <locator-key>: <locator-value>
    value: <string>
```

- **Value type:** `Locator` extended with a required `value` field.
- **`value`:** The option value to select.
- **Maps to:** `page.locator(selector).selectOption(value)`

### 6.7 `wait`

Wait for a condition to be met.

```yaml
# Fixed delay
- wait: <milliseconds>

# Wait for text to appear
- wait: { text: <string> }

# Wait for element to appear (by CSS selector)
- wait: { css: <string> }

# Wait for element to appear (by test ID)
- wait: { testid: <string> }

# Wait for navigation/network state
- wait: { load: <strategy> }
```

- **Value type:** `number` or `object`.
- **Forms:**

| Form | Value Type | Maps To |
|------|-----------|---------|
| `wait: 2000` | `number` | `page.waitForTimeout(2000)` |
| `wait: { text: "x" }` | `object` | `page.getByText("x").waitFor()` |
| `wait: { css: ".x" }` | `object` | `page.waitForSelector(".x")` |
| `wait: { testid: "x" }` | `object` | `page.getByTestId("x").waitFor()` |
| `wait: { load: "networkidle" }` | `object` | `page.waitForLoadState("networkidle")` |

- When `wait` is a number, it must be a non-negative integer. A value of `0` is valid (no-op).
- When `wait` is an object, exactly one key must be present.
- `wait: { load: <strategy> }` accepts `"networkidle"` or `"load"`.

### 6.8 `screenshot`

Capture a screenshot for visual comparison.

```yaml
# Simple form
- screenshot: <name>

# Extended form
- screenshot:
    name: <string>
    threshold: <number>
    mode: <string>
    selector: <string>
    mask: [<string>, ...]
```

- **Value type:** `string` or `object`.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | `string` | Yes | -- | Screenshot identifier. Pattern: `[a-z0-9-]+`. Must be unique within a workflow. |
| `threshold` | `number` | No | Inherits from `defaults.threshold` | Override pixel diff threshold for this screenshot. |
| `mode` | `string` | No | Inherits from `defaults.screenshotMode` | `"viewport"` or `"full"`. |
| `selector` | `string` | No | -- | CSS selector to capture a specific element instead of the full viewport/page. |
| `mask` | `array of string` | No | `[]` | CSS selectors for regions to ignore during comparison (dynamic timestamps, ads, live counters, etc.). |

- **Maps to:** `page.screenshot({ path })` with `fullPage: true` when `mode: full`.
- The output path is determined by the runner: `<workflow-name>/<viewport-name>/<screenshot-name>.png`.
- Screenshot names MUST be unique within a single workflow. Duplicate names within the same workflow are a validation error. Different workflows may reuse the same screenshot name.
- When `mask` is present, the runner removes or neutralizes the matching regions
  in both baseline and actual images before diffing.

### 6.9 `scroll`

Scroll the page.

```yaml
- scroll: { down: <pixels> }
- scroll: { up: <pixels> }
```

- **Value type:** `object` with exactly one key.
- **`down`:** Scroll down by N pixels. Positive integer.
- **`up`:** Scroll up by N pixels. Positive integer.
- **Maps to:** `page.evaluate(() => window.scrollBy(0, n))` or `page.evaluate(() => window.scrollBy(0, -n))`
- Specifying both `down` and `up` in the same step is a validation error.

### 6.10 `press`

Press a keyboard key or key combination.

```yaml
- press: <key>
```

- **Value type:** `string`
- **Description:** The key or key combination to press. Uses Playwright key naming conventions.
- **Examples:** `"Enter"`, `"Tab"`, `"Escape"`, `"Control+a"`, `"Meta+Shift+p"`
- **Maps to:** `page.keyboard.press(key)`

### 6.11 `eval`

Evaluate arbitrary JavaScript in the browser context.

```yaml
- eval: <javascript>
```

- **Value type:** `string`
- **Description:** JavaScript code to execute in the page context. Supports variable interpolation.
- **Maps to:** `page.evaluate(javascript)`
- **Security note:** The runner does not sandbox `eval` beyond the browser context. This is acceptable because Megatest runs in disposable containers.

### 6.12 `include`

Inline a reusable step sequence from `includes/`.

```yaml
- include: <name>
```

- **Value type:** `string`
- **Description:** The `name` of an include file (without `.yml`). The runner replaces this step with the full step list from the referenced include.
- **Resolution:** Static, before execution. See Section 9.2 for rules.

### 6.13 `set-viewport`

Change the browser viewport dimensions mid-workflow.

```yaml
# Named viewport
- set-viewport: <viewport-name>

# Explicit dimensions
- set-viewport: { width: <number>, height: <number> }
```

- **Value type:** `string` or `Viewport`.
- When a string, it must reference a named viewport from `config.yml`.
- When an object, it must contain `width` and `height` (both required, positive integers).
- **Maps to:** `page.setViewportSize({ width, height })`

## 7. Locator Type

A Locator identifies a DOM element for interaction. It is a YAML object with exactly one locator key. Steps that accept a Locator (`click`, `fill`, `type`, `hover`, `select`) use this type.

### 7.1 Locator Keys

| Key | Value Type | Description | Playwright Method |
|-----|-----------|-------------|-------------------|
| `testid` | `string` | Matches `data-testid` attribute | `page.getByTestId(value)` |
| `role` | `string` | ARIA role. Optionally combined with `name`. | `page.getByRole(role, { name })` |
| `text` | `string` | Visible text content (exact or substring match) | `page.getByText(value)` |
| `label` | `string` | Associated `<label>` text or `aria-label` | `page.getByLabel(value)` |
| `placeholder` | `string` | `placeholder` attribute value | `page.getByPlaceholder(value)` |
| `css` | `string` | CSS selector (matches first element) | `page.locator(cssSelector)` |
| `xpath` | `string` | XPath expression | `page.locator(xpathSelector)` |
| `nth` | `object` | CSS selector + zero-based index | `page.locator(selector).nth(index)` |

### 7.2 Locator Constraints

- Exactly one locator key MUST be present. Specifying multiple locator keys (e.g., both `testid` and `text`) is a validation error.
- The `role` locator optionally accepts a sibling `name` key to further filter by accessible name.
- The `nth` locator value MUST be an object with `selector` (string) and `index` (non-negative integer).

```yaml
# role with name
- click: { role: "button", name: "Submit" }

# nth
- click: { nth: { selector: "a.nav-link", index: 2 } }
```

### 7.3 Locator Priority

When an AI agent generates configuration, it SHOULD prefer locator types in this order of stability (most stable first):

1. `testid` -- Explicitly set by developers for testing; immune to UI text changes.
2. `role` (with `name`) -- Semantic, accessibility-driven; stable across visual redesigns.
3. `label` -- Tied to form structure; stable for form interactions.
4. `text` -- Depends on visible copy; breaks on text changes.
5. `placeholder` -- Depends on placeholder copy; breaks on text changes.
6. `css` -- Tied to DOM structure; brittle.
7. `xpath` -- Tied to DOM structure; brittle (similar to `css`).
8. `nth` -- Positional; most brittle of all.

This ordering is advisory. The runner does not enforce it.

### 7.4 Variable Interpolation in Locators

All locator string values support variable interpolation. For example:

```yaml
- fill: { testid: "email-input", text: "${TEST_USER}" }
- click: { text: "${SUBMIT_LABEL}" }
```

## 8. Variable Interpolation

### 8.1 Syntax

Variables are referenced using `${...}` syntax within string values:

| Pattern | Description |
|---------|-------------|
| `${VAR_NAME}` | References a variable from `config.yml` `variables`. |
| `${env:VAR_NAME}` | References a runtime secret injected by the Megatest platform. |

### 8.2 Where Interpolation Applies

Interpolation is performed in the following contexts:

- `setup.serve.cmd`
- `setup.serve.url`
- `setup.serve.env` values
- `setup.prepare` commands
- All step string values (URLs in `open`, text in `fill`/`type`, locator values, JavaScript in `eval`, etc.)

Interpolation does NOT apply to:

- `setup.system` commands (system setup should not depend on app-level variables).
- `setup.install` commands (dependency installation should not depend on app-level variables).
- Field names, step type keys, or structural fields (`name`, `description`, `version`).
- Numeric values (`threshold`, `width`, `height`, `timeout`).

### 8.3 Resolution Order

1. **Built-in run variables** are injected first. These are read-only and cannot be overridden by `variables` in config:
   | Variable | Description | Source |
   |----------|-------------|--------|
   | `DEPLOY_URL` | The external deployment URL for the current run. | `deployment_status` event payload, or project `deploy_url_template` with interpolated run metadata. Only set for external serve mode runs. |
   | `BRANCH` | The branch being tested. | Run metadata (always available). |
   | `COMMIT_SHA` | The full 40-character commit SHA. | Run metadata (always available). |
   | `PR_NUMBER` | The pull request number. | Run metadata (only set for PR-triggered runs). |
2. `${VAR_NAME}` is resolved from `config.yml` `variables`.
3. `${env:VAR_NAME}` is resolved from the runtime environment (project secrets).
4. If a variable is not found, interpolation fails and the run reports an error before execution begins.

### 8.4 Escaping

To produce a literal `${` in output, use `$${`. Example: `$${NOT_A_VAR}` outputs `${NOT_A_VAR}`.

### 8.5 Nesting

Nested interpolation is NOT supported. `${${VAR}}` is a validation error.

## 9. Validation Rules

The runner MUST validate the full configuration before executing any steps. Validation errors are reported all at once, not one at a time.

### 9.1 Structural Validation

| Rule | Severity |
|------|----------|
| `config.yml` missing | Error |
| `version` missing or not `"1"` | Error |
| `workflows/` directory missing or empty | Error |
| Workflow `name` does not match filename | Error |
| Include `name` does not match filename | Error |
| Workflow has empty `steps` array | Error |
| Include has empty `steps` array | Error |
| Step mapping has zero keys | Error |
| Step mapping has more than one key | Error |
| Unknown step type key | Error |
| `serve` present but `cmd` or `ready` missing | Error |
| Viewport reference in workflow not defined in `config.yml` | Error |
| Duplicate screenshot name within a workflow | Error |
| Duplicate workflow names | Error |
| Duplicate include names | Error |
| File in `workflows/` or `includes/` not matching naming pattern `[a-z0-9-]+\.yml` | Warning |

### 9.2 Include Resolution Validation

| Rule | Severity |
|------|----------|
| `include` references a name not found in `includes/` | Error |
| Circular include detected (A includes B, B includes A) | Error |
| Transitive circular include (A -> B -> C -> A) | Error |
| Include depth exceeds 10 levels | Error |

Circular includes are detected via a depth-first traversal of the include graph before any execution begins. The runner MUST report the cycle path (e.g., `"login -> setup-mfa -> login"`).

### 9.3 Variable Validation

| Rule | Severity |
|------|----------|
| `${VAR_NAME}` used but `VAR_NAME` not defined in `variables` | Error |
| `${env:VAR_NAME}` used but not available at runtime | Error (at runtime, not at config validation) |
| Variable name does not match `[A-Z][A-Z0-9_]*` | Error |
| Nested interpolation `${${X}}` | Error |
| Unclosed interpolation `${VAR_NAME` | Error |

Note: `${env:...}` references cannot be validated at config-parse time since secrets are injected at runtime. These are validated at the start of execution, before any steps run.

### 9.4 Type Validation

| Rule | Severity |
|------|----------|
| `threshold` < 0 or > 100 | Error |
| `threshold` > 10 | Warning |
| `timeout` <= 0 | Error |
| `viewport.width` < 320 or > 3840 | Error |
| `viewport.height` < 240 or > 2160 | Error |
| `wait` with numeric value < 0 | Error |
| `scroll` pixel value <= 0 | Error |
| `screenshotMode` not one of `"viewport"`, `"full"` | Error |
| `waitAfterNavigation` not one of `"networkidle"`, `"load"`, or a numeric string | Error |
| Locator object has zero locator keys | Error |
| Locator object has multiple locator keys | Error |

## 10. Formal Type Definitions

The following TypeScript-style definitions specify every type in the schema. These are normative.

```typescript
// ─── Root Config ─────────────────────────────────────────────

interface ConfigFile {
  version: "1";                            // Required
  setup?: Setup;
  defaults?: Defaults;
  viewports?: Record<string, Viewport>;    // keys: [a-z0-9-]+
  variables?: Record<string, string>;      // keys: [A-Z][A-Z0-9_]*
}

// ─── Setup ───────────────────────────────────────────────────

interface Setup {
  system?: string[];
  install?: string[];
  serve?: Serve;
  prepare?: string[];
}

interface Serve {
  cmd: string;                             // Required
  ready: string;                           // Required. URL.
  timeout?: number;                        // Default: 120. Positive integer.
  env?: Record<string, string>;
}

// ─── Defaults ────────────────────────────────────────────────

interface Defaults {
  viewport?: Viewport;                     // Default: { width: 1280, height: 720 }
  threshold?: number;                      // Default: 0.1. Range: [0.0, 100.0].
  waitAfterNavigation?: WaitStrategy;      // Default: "load"
  screenshotMode?: "viewport" | "full";    // Default: "viewport"
  timeout?: number;                        // Default: 30000. Positive integer (ms).
}

type WaitStrategy = "networkidle" | "load" | NumericString;
// NumericString: a string matching /^[0-9]+$/

// ─── Viewport ────────────────────────────────────────────────

interface Viewport {
  width: number;                           // 320..3840, integer
  height: number;                          // 240..2160, integer
}

// ─── Workflow File ───────────────────────────────────────────

interface WorkflowFile {
  name: string;                            // Required. [a-z0-9-]+
  description?: string;
  viewports?: string[];                    // Default: ["desktop"]
  steps: Step[];                           // Required. Non-empty.
}

// ─── Include File ────────────────────────────────────────────

interface IncludeFile {
  name: string;                            // Required. [a-z0-9-]+
  steps: Step[];                           // Required. Non-empty.
}

// ─── Steps ───────────────────────────────────────────────────

type Step =
  | { open: string }
  | { click: Locator }
  | { fill: LocatorWithText }
  | { type: LocatorWithText }
  | { hover: Locator }
  | { select: LocatorWithValue }
  | { wait: WaitStep }
  | { screenshot: string | ScreenshotConfig }
  | { scroll: ScrollDirection }
  | { press: string }
  | { eval: string }
  | { include: string }
  | { "set-viewport": string | Viewport };

type WaitStep = number | WaitCondition;

interface WaitCondition {
  text?: string;
  css?: string;
  testid?: string;
  load?: "networkidle" | "load";
}
// Exactly one key must be present.

interface ScreenshotConfig {
  name: string;                            // Required. [a-z0-9-]+
  threshold?: number;
  mode?: "viewport" | "full";
  selector?: string;                       // CSS selector for element capture
  mask?: string[];                         // CSS selectors masked before diffing
}

interface ScrollDirection {
  down?: number;                           // Positive integer (pixels)
  up?: number;                             // Positive integer (pixels)
}
// Exactly one key must be present.

// ─── Locators ────────────────────────────────────────────────

// Base locator: exactly one of these keys must be present.
type Locator =
  | { testid: string }
  | { role: string; name?: string }
  | { text: string }
  | { label: string }
  | { placeholder: string }
  | { css: string }
  | { xpath: string }
  | { nth: NthLocator };

interface NthLocator {
  selector: string;                        // CSS selector
  index: number;                           // 0-based, non-negative integer
}

// Locator + text (for fill, type)
type LocatorWithText = Locator & { text: string };

// Locator + value (for select)
type LocatorWithValue = Locator & { value: string };
```

## 11. JSON Schema

The following JSON Schema can be used for programmatic validation of `config.yml`. Separate schemas for workflow and include files follow the same structure.

### 11.1 config.yml JSON Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://megatest.dev/schemas/config.json",
  "title": "Megatest Config",
  "type": "object",
  "required": ["version"],
  "additionalProperties": false,
  "properties": {
    "version": {
      "type": "string",
      "const": "1"
    },
    "setup": {
      "$ref": "#/$defs/Setup"
    },
    "defaults": {
      "$ref": "#/$defs/Defaults"
    },
    "viewports": {
      "type": "object",
      "additionalProperties": {
        "$ref": "#/$defs/Viewport"
      },
      "propertyNames": {
        "pattern": "^[a-z0-9-]+$"
      }
    },
    "variables": {
      "type": "object",
      "additionalProperties": {
        "type": "string"
      },
      "propertyNames": {
        "pattern": "^[A-Z][A-Z0-9_]*$"
      }
    }
  },
  "$defs": {
    "Setup": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "system": {
          "type": "array",
          "items": { "type": "string" }
        },
        "install": {
          "type": "array",
          "items": { "type": "string" }
        },
        "serve": {
          "$ref": "#/$defs/Serve"
        },
        "prepare": {
          "type": "array",
          "items": { "type": "string" }
        }
      }
    },
    "Serve": {
      "type": "object",
      "required": ["cmd", "ready"],
      "additionalProperties": false,
      "properties": {
        "cmd": { "type": "string" },
        "ready": { "type": "string", "format": "uri" },
        "timeout": { "type": "integer", "minimum": 1, "default": 120 },
        "env": {
          "type": "object",
          "additionalProperties": { "type": "string" }
        }
      }
    },
    "Defaults": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "viewport": { "$ref": "#/$defs/Viewport" },
        "threshold": { "type": "number", "minimum": 0, "maximum": 100 },
        "waitAfterNavigation": {
          "type": "string",
          "pattern": "^(networkidle|load|[0-9]+)$"
        },
        "screenshotMode": {
          "type": "string",
          "enum": ["viewport", "full"]
        },
        "timeout": { "type": "integer", "minimum": 1 }
      }
    },
    "Viewport": {
      "type": "object",
      "required": ["width", "height"],
      "additionalProperties": false,
      "properties": {
        "width": { "type": "integer", "minimum": 320, "maximum": 3840 },
        "height": { "type": "integer", "minimum": 240, "maximum": 2160 }
      }
    }
  }
}
```

### 11.2 Workflow File JSON Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://megatest.dev/schemas/workflow.json",
  "title": "Megatest Workflow",
  "type": "object",
  "required": ["name", "steps"],
  "additionalProperties": false,
  "properties": {
    "name": {
      "type": "string",
      "pattern": "^[a-z0-9-]+$"
    },
    "description": {
      "type": "string"
    },
    "viewports": {
      "type": "array",
      "items": { "type": "string", "pattern": "^[a-z0-9-]+$" },
      "minItems": 1,
      "uniqueItems": true
    },
    "steps": {
      "type": "array",
      "items": { "$ref": "#/$defs/Step" },
      "minItems": 1
    }
  },
  "$defs": {
    "Step": {
      "type": "object",
      "minProperties": 1,
      "maxProperties": 1,
      "oneOf": [
        {
          "required": ["open"],
          "properties": { "open": { "type": "string" } },
          "additionalProperties": false
        },
        {
          "required": ["click"],
          "properties": { "click": { "$ref": "#/$defs/Locator" } },
          "additionalProperties": false
        },
        {
          "required": ["fill"],
          "properties": { "fill": { "$ref": "#/$defs/LocatorWithText" } },
          "additionalProperties": false
        },
        {
          "required": ["type"],
          "properties": { "type": { "$ref": "#/$defs/LocatorWithText" } },
          "additionalProperties": false
        },
        {
          "required": ["hover"],
          "properties": { "hover": { "$ref": "#/$defs/Locator" } },
          "additionalProperties": false
        },
        {
          "required": ["select"],
          "properties": { "select": { "$ref": "#/$defs/LocatorWithValue" } },
          "additionalProperties": false
        },
        {
          "required": ["wait"],
          "properties": {
            "wait": {
              "oneOf": [
                { "type": "integer", "minimum": 0 },
                { "$ref": "#/$defs/WaitCondition" }
              ]
            }
          },
          "additionalProperties": false
        },
        {
          "required": ["screenshot"],
          "properties": {
            "screenshot": {
              "oneOf": [
                { "type": "string", "pattern": "^[a-z0-9-]+$" },
                { "$ref": "#/$defs/ScreenshotConfig" }
              ]
            }
          },
          "additionalProperties": false
        },
        {
          "required": ["scroll"],
          "properties": { "scroll": { "$ref": "#/$defs/ScrollDirection" } },
          "additionalProperties": false
        },
        {
          "required": ["press"],
          "properties": { "press": { "type": "string" } },
          "additionalProperties": false
        },
        {
          "required": ["eval"],
          "properties": { "eval": { "type": "string" } },
          "additionalProperties": false
        },
        {
          "required": ["include"],
          "properties": {
            "include": { "type": "string", "pattern": "^[a-z0-9-]+$" }
          },
          "additionalProperties": false
        },
        {
          "required": ["set-viewport"],
          "properties": {
            "set-viewport": {
              "oneOf": [
                { "type": "string", "pattern": "^[a-z0-9-]+$" },
                { "$ref": "#/$defs/Viewport" }
              ]
            }
          },
          "additionalProperties": false
        }
      ]
    },
    "Locator": {
      "type": "object",
      "oneOf": [
        {
          "required": ["testid"],
          "properties": { "testid": { "type": "string" } },
          "additionalProperties": false
        },
        {
          "required": ["role"],
          "properties": {
            "role": { "type": "string" },
            "name": { "type": "string" }
          },
          "additionalProperties": false
        },
        {
          "required": ["text"],
          "properties": { "text": { "type": "string" } },
          "additionalProperties": false
        },
        {
          "required": ["label"],
          "properties": { "label": { "type": "string" } },
          "additionalProperties": false
        },
        {
          "required": ["placeholder"],
          "properties": { "placeholder": { "type": "string" } },
          "additionalProperties": false
        },
        {
          "required": ["css"],
          "properties": { "css": { "type": "string" } },
          "additionalProperties": false
        },
        {
          "required": ["xpath"],
          "properties": { "xpath": { "type": "string" } },
          "additionalProperties": false
        },
        {
          "required": ["nth"],
          "properties": {
            "nth": {
              "type": "object",
              "required": ["selector", "index"],
              "additionalProperties": false,
              "properties": {
                "selector": { "type": "string" },
                "index": { "type": "integer", "minimum": 0 }
              }
            }
          },
          "additionalProperties": false
        }
      ]
    },
    "LocatorWithText": {
      "type": "object",
      "required": ["text"],
      "oneOf": [
        {
          "required": ["testid", "text"],
          "properties": {
            "testid": { "type": "string" },
            "text": { "type": "string" }
          },
          "additionalProperties": false
        },
        {
          "required": ["role", "text"],
          "properties": {
            "role": { "type": "string" },
            "name": { "type": "string" },
            "text": { "type": "string" }
          },
          "additionalProperties": false
        },
        {
          "required": ["label", "text"],
          "properties": {
            "label": { "type": "string" },
            "text": { "type": "string" }
          },
          "additionalProperties": false
        },
        {
          "required": ["placeholder", "text"],
          "properties": {
            "placeholder": { "type": "string" },
            "text": { "type": "string" }
          },
          "additionalProperties": false
        },
        {
          "required": ["css", "text"],
          "properties": {
            "css": { "type": "string" },
            "text": { "type": "string" }
          },
          "additionalProperties": false
        },
        {
          "required": ["xpath", "text"],
          "properties": {
            "xpath": { "type": "string" },
            "text": { "type": "string" }
          },
          "additionalProperties": false
        },
        {
          "required": ["nth", "text"],
          "properties": {
            "nth": {
              "type": "object",
              "required": ["selector", "index"],
              "additionalProperties": false,
              "properties": {
                "selector": { "type": "string" },
                "index": { "type": "integer", "minimum": 0 }
              }
            },
            "text": { "type": "string" }
          },
          "additionalProperties": false
        }
      ]
    },
    "LocatorWithValue": {
      "type": "object",
      "required": ["value"],
      "oneOf": [
        {
          "required": ["testid", "value"],
          "properties": {
            "testid": { "type": "string" },
            "value": { "type": "string" }
          },
          "additionalProperties": false
        },
        {
          "required": ["role", "value"],
          "properties": {
            "role": { "type": "string" },
            "name": { "type": "string" },
            "value": { "type": "string" }
          },
          "additionalProperties": false
        },
        {
          "required": ["label", "value"],
          "properties": {
            "label": { "type": "string" },
            "value": { "type": "string" }
          },
          "additionalProperties": false
        },
        {
          "required": ["placeholder", "value"],
          "properties": {
            "placeholder": { "type": "string" },
            "value": { "type": "string" }
          },
          "additionalProperties": false
        },
        {
          "required": ["css", "value"],
          "properties": {
            "css": { "type": "string" },
            "value": { "type": "string" }
          },
          "additionalProperties": false
        },
        {
          "required": ["xpath", "value"],
          "properties": {
            "xpath": { "type": "string" },
            "value": { "type": "string" }
          },
          "additionalProperties": false
        },
        {
          "required": ["nth", "value"],
          "properties": {
            "nth": {
              "type": "object",
              "required": ["selector", "index"],
              "additionalProperties": false,
              "properties": {
                "selector": { "type": "string" },
                "index": { "type": "integer", "minimum": 0 }
              }
            },
            "value": { "type": "string" }
          },
          "additionalProperties": false
        }
      ]
    },
    "WaitCondition": {
      "type": "object",
      "minProperties": 1,
      "maxProperties": 1,
      "properties": {
        "text": { "type": "string" },
        "css": { "type": "string" },
        "testid": { "type": "string" },
        "load": {
          "type": "string",
          "enum": ["networkidle", "load"]
        }
      },
      "additionalProperties": false
    },
    "ScreenshotConfig": {
      "type": "object",
      "required": ["name"],
      "additionalProperties": false,
      "properties": {
        "name": { "type": "string", "pattern": "^[a-z0-9-]+$" },
        "threshold": { "type": "number", "minimum": 0, "maximum": 100 },
        "mode": { "type": "string", "enum": ["viewport", "full"] },
        "selector": { "type": "string" },
        "mask": {
          "type": "array",
          "items": { "type": "string" }
        }
      }
    },
    "ScrollDirection": {
      "type": "object",
      "minProperties": 1,
      "maxProperties": 1,
      "properties": {
        "down": { "type": "integer", "minimum": 1 },
        "up": { "type": "integer", "minimum": 1 }
      },
      "additionalProperties": false
    },
    "Viewport": {
      "type": "object",
      "required": ["width", "height"],
      "additionalProperties": false,
      "properties": {
        "width": { "type": "integer", "minimum": 320, "maximum": 3840 },
        "height": { "type": "integer", "minimum": 240, "maximum": 2160 }
      }
    }
  }
}
```

### 11.3 Include File JSON Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://megatest.dev/schemas/include.json",
  "title": "Megatest Include",
  "type": "object",
  "required": ["name", "steps"],
  "additionalProperties": false,
  "properties": {
    "name": {
      "type": "string",
      "pattern": "^[a-z0-9-]+$"
    },
    "steps": {
      "type": "array",
      "items": { "$ref": "workflow.json#/$defs/Step" },
      "minItems": 1
    }
  }
}
```

## 12. Complete Example

### 12.1 config.yml

```yaml
version: "1"

setup:
  system:
    - apt-get update && apt-get install -y libvips-dev
  install:
    - npm ci
  serve:
    cmd: npm run dev
    ready: http://localhost:3000
    timeout: 60
    env:
      DATABASE_URL: "postgresql://test:test@localhost:5432/testdb"
      NODE_ENV: "test"
  prepare:
    - npx prisma migrate deploy
    - node scripts/seed-test-data.js

defaults:
  viewport: { width: 1280, height: 720 }
  threshold: 0.1
  waitAfterNavigation: networkidle
  screenshotMode: viewport
  timeout: 30000

viewports:
  desktop: { width: 1280, height: 720 }
  tablet: { width: 768, height: 1024 }
  mobile: { width: 375, height: 812 }

variables:
  BASE_URL: "http://localhost:3000"
  TEST_USER: "admin@example.com"
  TEST_PASS: "${env:TEST_PASSWORD}"
```

### 12.2 workflows/homepage.yml

```yaml
name: homepage
description: "Public homepage visual regression checks"
viewports: [desktop, mobile]
steps:
  - open: ${BASE_URL}/
  - wait: { load: networkidle }
  - screenshot: hero
  - scroll: { down: 800 }
  - screenshot: below-fold
  - scroll: { down: 800 }
  - screenshot: footer
```

### 12.3 workflows/dashboard.yml

```yaml
name: dashboard
description: "Authenticated dashboard views"
steps:
  - include: login
  - screenshot: dashboard-overview
  - click: { testid: "stats-tab" }
  - wait: { testid: "stats-panel" }
  - screenshot: { name: stats, mode: full, threshold: 0.5 }
  - click: { role: "button", name: "Export" }
  - wait: { text: "Export complete" }
  - screenshot: export-confirmation
```

### 12.4 workflows/signup-form.yml

```yaml
name: signup-form
description: "Signup form validation and submission"
viewports: [desktop]
steps:
  - open: ${BASE_URL}/signup
  - wait: { load: networkidle }
  - screenshot: signup-empty
  - click: { role: "button", name: "Create Account" }
  - wait: { text: "Email is required" }
  - screenshot: signup-validation-errors
  - fill: { label: "Email", text: "newuser@example.com" }
  - fill: { label: "Password", text: "SecureP@ss123" }
  - fill: { label: "Confirm Password", text: "SecureP@ss123" }
  - select: { testid: "country-select", value: "US" }
  - screenshot: signup-filled
  - click: { role: "button", name: "Create Account" }
  - wait: { load: networkidle }
  - screenshot: signup-success
```

### 12.5 includes/login.yml

```yaml
name: login
steps:
  - open: ${BASE_URL}/login
  - wait: { load: networkidle }
  - fill: { label: "Email", text: "${TEST_USER}" }
  - fill: { label: "Password", text: "${TEST_PASS}" }
  - click: { role: "button", name: "Sign in" }
  - wait: { load: networkidle }
```

## 13. Edge Cases and Behavior

### 13.1 Empty or Missing Fields

| Scenario | Behavior |
|----------|----------|
| `steps: []` in a workflow or include | Validation error: steps must be non-empty. |
| `viewports: []` in a workflow | Validation error: viewports array must be non-empty if present. Omit the field entirely to use the default. |
| `setup` present but all sub-fields omitted | Valid. Equivalent to omitting `setup` entirely. |
| `serve.cmd` and `serve.url` both set | Validation error: managed and external modes are mutually exclusive. |
| `serve.url` set with `system`, `install`, or `prepare` | Validation warning: these fields are ignored in external mode. |
| `serve.url` references `${DEPLOY_URL}` but no source configured | Run fails at interpolation with "variable DEPLOY_URL not found". |
| `variables: {}` | Valid. No variables defined. |
| `viewports: {}` | Valid. No named viewports defined. Only `"desktop"` is available via the built-in default. |

### 13.2 Missing Includes Directory

If no workflow uses `include` steps, the `includes/` directory is not required and its absence is not an error. If a workflow references `include: login` and the `includes/` directory does not exist or does not contain `login.yml`, that is a validation error.

### 13.3 Circular Includes

Circular includes are detected statically during the include-expansion phase. The runner builds a directed graph of include dependencies and checks for cycles before expanding any includes. If a cycle is found, the error message MUST include the full cycle path.

### 13.4 Screenshot Name Collisions

Screenshot names must be unique within a single workflow's steps (after include expansion). Different workflows may use the same screenshot name because screenshots are namespaced by workflow and viewport in the output directory.

### 13.5 Server Startup Failure

**Managed mode:** If `setup.serve.cmd` exits before the `ready` URL returns 200, the run fails immediately with the server's stderr output included in the error. If the `timeout` is exceeded without a 200 response, the run fails with a timeout error and the server process is killed.

**External mode:** If the `serve.url` does not return HTTP 200 within the `timeout` period, the run fails with error: "External URL {url} did not become ready within {timeout}s". The worker logs the last HTTP status code and any connection error for debugging.

### 13.6 Step Timeout

Each step has an implicit timeout (from `defaults.timeout` or the global default of 30000ms). If a step does not complete within this timeout, it fails and the workflow run is aborted. The timeout applies to the Playwright action execution, not to the YAML parsing.

### 13.7 Variable Interpolation in Non-String Contexts

Variable interpolation ONLY applies to string values. If a numeric field (e.g., `threshold`, `width`) contains `${VAR}`, it is a validation error. Variables cannot be used to dynamically set numeric parameters.

### 13.8 Unknown Fields

Unknown top-level keys in `config.yml`, workflow files, or include files are validation errors (strict mode). This prevents typos from silently being ignored (e.g., `threshhold` instead of `threshold`).

### 13.9 YAML Anchors and Aliases

Standard YAML anchors (`&`) and aliases (`*`) are permitted since they are part of the YAML specification. However, AI agents generating configs SHOULD NOT use them because they reduce readability and are unnecessary given the `include` mechanism.

### 13.10 File Encoding

All `.yml` files MUST be UTF-8 encoded. A BOM (byte order mark) is permitted but not required.

## 14. Schema Versioning

The `version: "1"` field in `config.yml` identifies the schema version used by the configuration.

- Workers MUST reject configs with an unrecognized version.
- Future versions may introduce breaking changes; the version field enables graceful migration.
- When a worker encounters a version it does not support, the run MUST fail with the error: `"Unsupported config schema version: {version}. Please update Megatest."`
