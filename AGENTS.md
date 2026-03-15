# Agent Instructions for Megatest

> **Self-Improving Document**: When you encounter issues or discover better approaches, update this file or the relevant skill/agent.

## Ask First (CRITICAL)

**Use `AskUserQuestion` for any non-obvious decision.** When in doubt, ask.

## Shared Codebase (CRITICAL)

**Multiple agents may be working on this codebase concurrently.** Before running `git checkout`, `git stash`, `git clean`, or `git reset`, check `git status` for uncommitted changes that belong to another agent's in-progress work. Never discard or overwrite changes you didn't make.

## Project Overview

Megatest is a local-first visual regression testing CLI written in TypeScript. It runs Playwright workflows, captures screenshots, diffs them with pixelmatch, and generates standalone HTML reports.

The project has two parts:
- **CLI tool** (`cli/`): The core product — validate, run, and accept visual regression tests
- **Megatest skill** (`.claude/skills/megatest/`): A Claude Code skill that auto-generates `.megatest/` configs by browsing live sites

### Tech Stack

| Component | Technology |
|-----------|------------|
| Language | TypeScript (ES2022, strict mode) |
| Runtime | Node.js |
| Build | tsc (TypeScript compiler) |
| CLI Framework | Commander 12.x |
| Browser Automation | Playwright 1.48.x |
| Image Diffing | pixelmatch 6.x, pngjs 7.x |
| Config Format | YAML (js-yaml 4.x) |

### Key Directories

```
cli/                # Main CLI implementation
  src/
    commands/       # CLI commands (run, validate, accept)
    config/         # Config loading, validation, schema, variables
    runner/         # Playwright engine, step execution, locators
    differ/         # Screenshot comparison pipeline
    reporter/       # HTML and console report generation
    types/          # TypeScript type definitions
    cli.ts          # Commander entry point
    types.ts        # Core type definitions
    utils.ts        # Git and filesystem utilities
  bin/
    megatest.js     # Executable entry point
  dist/             # Compiled output (gitignored)
spec/               # Design specifications (historical reference)
mocks/              # UI mockups (Docker/nginx)
.claude/
  skills/megatest/  # Config generation skill
```

## Development

### Build & Run

```bash
cd cli && npm run build          # Compile TypeScript
cd cli && npm run dev            # Watch mode

# Run the CLI
node cli/bin/megatest.js validate --repo <path>
node cli/bin/megatest.js run --repo <path> --url <url>
node cli/bin/megatest.js accept --repo <path>
```

### Prerequisites

```bash
cd cli && npm install
npx playwright install chromium
```

### No Docker Required

Unlike many projects, the CLI runs directly on the host. No containers needed for development or testing.

## Specs (Historical Reference Only)

The `spec/` directory contains **design documents written before and during development**. The code may have diverged from these specs.

- **Don't implement against specs blindly** — read the code first
- **OK to read specs for context** — understanding original design intent
- Specs cover the full SaaS vision (API, workers, GitHub integration, multi-tenancy) but only the CLI is implemented so far

## Skill Routing

| Task Type | Skill/Resource |
|-----------|---------------|
| Generate/update `.megatest/` configs | `.claude/skills/megatest/SKILL.md` |
| Self-review after coding | `.claude/skills/selfreview/SKILL.md` |
| TypeScript implementation | Coder agent |
| Code review | Reviewer agent |
| Git operations | Commiter agent |
| Research hard problems | Oracle agent |

## Quality Gates

Before committing:

```bash
cd cli && npm run build          # Must compile cleanly (strict mode)
cd cli && npm run check          # Biome lint + format check (warnings OK, errors fail)
```

No test framework is set up yet — rely on manual testing with the CLI commands and TypeScript compiler strictness.

A pre-commit hook auto-formats staged `.ts` files and runs the linter. Install with: `bash scripts/install_git_hooks.sh`

## Code Style

- Strict TypeScript — no `any` types without justification
- Type definitions in `types/` or `types.ts`
- Keep functions small and focused
- Use descriptive names for checkpoint and workflow identifiers
- Follow existing patterns in the codebase

## Architecture Notes

### Config Format (`.megatest/` directory in target repos)

```
config.yml          # Global settings (viewports, thresholds, variables)
workflows/          # One YAML file per test flow
includes/           # Reusable step sequences
plans/              # Named subsets of workflows
baselines/          # Golden screenshots (committed to git)
actuals/            # Current run screenshots (gitignored)
reports/            # Generated HTML reports
```

### Step Types

`open`, `wait`, `screenshot`, `click`, `fill`, `hover`, `select`, `press`, `scroll`, `eval`, `include`, `set-viewport`

### Locator Priority

1. `testid` (data-testid)
2. `role` + `name` (ARIA)
3. `label` (form label)
4. `text` (visible text)
5. `placeholder`
6. `css` (fallback)

### Screenshot Naming

Format: `<checkpoint>-<viewport>.png` (e.g., `hero-section-desktop.png`)

### Diff Pipeline

1. Load actual and baseline PNGs
2. Check dimension match (mismatch = 100% diff)
3. Run pixelmatch (threshold 0.1 per pixel)
4. Generate diff PNG highlighting changes
5. Compare diff percentage against configured threshold

### Report Generation

Standalone HTML files with embedded images (base64), GitHub-style dark theme, filter chips for Failed/New/Passed.

## Common Pitfalls

1. **Always rebuild after TypeScript changes**: `npm run build` — the CLI runs from `dist/`, not `src/`
2. **Playwright needs Chromium**: Run `npx playwright install chromium` if missing
3. **Config filenames must match name fields**: `homepage.yml` must contain `name: homepage`
4. **Variable interpolation**: `${VAR}` from config, `${env:VAR}` from environment
5. **Circular includes**: The validator detects these via DFS — don't create circular `include` references
6. **Exit codes matter**: `run` returns 0 (all pass) or 1 (failures/new/errors) for CI integration

## Plan Mode (MANDATORY)

Every plan MUST end with this final step:

> **After implementation is committed**, run `/selfreview` to catch bugs, missing pieces, and unintended consequences. Fix any issues found before pushing.

This applies to all plans, regardless of scope. The self-review enters its own plan mode — this is intentional.

## Session Completion

**Work is NOT complete until `git push` succeeds.**

1. Run quality gates (`npm run build`)
2. Push: `git pull --rebase && git push`
3. Verify: `git status` shows "up to date with origin"
