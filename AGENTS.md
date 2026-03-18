# Agent Instructions for Megatest

> **Self-Improving Document**: When you encounter issues or discover better approaches, update this file or the relevant skill/agent.

## Ask First (CRITICAL)

**Use `AskUserQuestion` for any non-obvious decision.** When in doubt, ask.

## Shared Codebase (CRITICAL)

**Multiple agents may be working on this codebase concurrently.** Before running `git checkout`, `git stash`, `git clean`, or `git reset`, check `git status` for uncommitted changes that belong to another agent's in-progress work. Never discard or overwrite changes you didn't make.

## Project Overview

Megatest is a local-first visual regression testing tool written in TypeScript, organized as a monorepo with three packages:

- **`@megatest/core`** (`projects/core/`): Shared types and image codec used across packages
- **`@megatest/cli`** (`projects/cli/`): CLI tool — validate, run, and accept visual regression tests
- **`@megatest/serve`** (`projects/serve/`): Standalone web dashboard for browsing reports and accepting changes
- **Megatest skill** (`.claude/skills/megatest/`): A Claude Code skill that auto-generates `.megatest/` configs by browsing live sites

### Tech Stack

| Component | Technology |
|-----------|------------|
| Language | TypeScript (ES2022, strict mode) |
| Runtime | Node.js |
| Build | tsc (TypeScript compiler, project references) |
| Monorepo | npm workspaces |
| CLI Framework | Commander 12.x |
| Browser Automation | Playwright 1.48.x |
| Image Diffing | pixelmatch 6.x, pngjs 7.x |
| Config Format | YAML (js-yaml 4.x) |
| Testing | Vitest 4.x, @vitest/coverage-v8 |

### Key Directories

```
projects/
  core/               # @megatest/core — shared types + image codec
    src/
      types.ts        # CheckpointResult, ReportMeta, ReviewCheckpoint, etc.
      codec/          # PNG and WebP image encode/decode
      index.ts        # Barrel re-exports
  cli/                # @megatest/cli — CLI tool
    src/
      commands/       # CLI commands (run, validate, accept)
      config/         # Config loading, validation, schema, variables
      runner/         # Playwright engine, step execution, locators
      differ/         # Screenshot comparison pipeline
      reporter/       # HTML and console report generation
      cli.ts          # Commander entry point
      utils.ts        # Git and filesystem utilities
    bin/
      megatest.js     # Executable entry point
  serve/              # @megatest/serve — web dashboard
    src/
      config.ts       # Serve config loading
      discovery.ts    # Project/report discovery
      router.ts       # HTTP request routing
      handlers.ts     # Accept/accept-all POST handlers
      utils.ts        # HTTP and rendering utilities
      types.ts        # Serve-local types
      views/          # HTML rendering (dashboard, review, styles)
      index.ts        # Entry point (runServe)
    bin/
      megatest-serve.js  # Standalone entry point
spec/                 # Design specifications (historical reference)
mocks/                # UI mockups (Docker/nginx)
.claude/
  skills/megatest/    # Config generation skill
```

## Development

### Build & Run

```bash
npm install                      # Install all workspace dependencies
npm run build                    # Build all packages (core → cli → serve)
npm run build -w @megatest/cli   # Build a single package

# Run the CLI
node projects/cli/bin/megatest.js validate --repo <path>
node projects/cli/bin/megatest.js run --repo <path> --url <url>
node projects/cli/bin/megatest.js accept --repo <path>

# Run the serve dashboard standalone
node projects/serve/bin/megatest-serve.js --config serve.config.yml
```

### Testing

```bash
npm test                              # Run all tests
npm test -w @megatest/cli             # Run tests for a single package
npx vitest --watch                    # Watch mode (development)
npm run test:coverage                 # Run with coverage report (80% threshold)
```

Test files live in `projects/<pkg>/test/` directories. Tests are written with Vitest.

### Prerequisites

```bash
npm install
npx playwright install chromium
```

### Serve (Docker)

The serve dashboard runs in a Docker container via Traefik. After code changes, rebuild and restart with:

```bash
npm run build
docker compose up --build -d
```

### Accessing the Live Site

The public URL `https://megatest.opendle.com/` is behind badger auth and **cannot be accessed by agents**. When the user references this URL, use the local Docker container instead:

- **Local URL**: `http://172.26.0.6:3000/` (container IP on the `traefik-proxy` Docker network)
- If the container IP changes after a rebuild, re-inspect with: `docker inspect megatest-megatest-1 --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'`
- The container serves on port 3000 internally

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
npm run build          # Must compile cleanly (strict mode)
npm run check          # Biome lint + format check (warnings OK, errors fail)
npm test               # All tests must pass
```

For coverage reports: `npm run test:coverage` (must meet 80% threshold).

A pre-commit hook auto-formats staged `.ts` files and runs the linter. Install with: `bash scripts/install_git_hooks.sh`

## Code Style

- Strict TypeScript — no `any` types without justification
- Shared types in `projects/core/src/types.ts`
- CLI-specific config types in `projects/cli/src/config/schema.ts`
- Keep functions small and focused
- Use descriptive names for checkpoint and workflow identifiers
- Follow existing patterns in the codebase

## Architecture Notes

### Package Dependencies

```
@megatest/core    ← no internal deps (shared types + codec)
@megatest/cli     ← depends on @megatest/core
@megatest/serve   ← depends on @megatest/core (independent from CLI)
```

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
2. **Build order matters**: core must build before cli or serve (`npm run build` handles this)
3. **Playwright needs Chromium**: Run `npx playwright install chromium` if missing
4. **Config filenames must match name fields**: `homepage.yml` must contain `name: homepage`
5. **Variable interpolation**: `${VAR}` from config, `${env:VAR}` from environment
6. **Circular includes**: The validator detects these via DFS — don't create circular `include` references
7. **Exit codes matter**: `run` returns 0 (all pass) or 1 (failures/new/errors) for CI integration

## Plan Mode (MANDATORY)

Every plan MUST end with this final step:

> **After implementation is committed**, run `/selfreview` to catch bugs, missing pieces, and unintended consequences. Fix any issues found before pushing.

This applies to all plans, regardless of scope. The self-review enters its own plan mode — this is intentional.

## Session Completion

**Work is NOT complete until `git push` succeeds.**

1. Run quality gates (`npm run build`)
2. Push: `git pull --rebase && git push`
3. Verify: `git status` shows "up to date with origin"
