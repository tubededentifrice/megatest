# Spec 07 — Review UI (Web Interface)

Status: **draft**
Depends on: spec-03 (API), spec-04 (comparison engine), spec-06 (GitHub integration)

---

## Overview

Megatest ships an embedded SPA served by the Fastify API server. There is no
separate build step for the MVP — the UI is vanilla JS (with Preact available
if component structure is needed). The review page is the **primary interface**:
it is the page linked from GitHub PR comments and is where users approve or
reject visual diffs.

All users must authenticate via GitHub OAuth. The UI is multi-tenant — users
only see projects linked to GitHub App installations they have access to.

---

## 1. Pages

### 1.1 Dashboard (`/`)

Requires login. Unauthenticated users are redirected to `/auth/github`.

```
┌─────────────────────────────────────────────────────────────────────┐
│  MEGATEST   [Acme Corp ▾]                          [avatar] [logout]│
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Projects                                      [+ Connect repo]    │
│  ───────────────────────────────────────────────────────────────    │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  acme/web-app              ● passed     2 min ago           │   │
│  │  github.com/acme/web-app   12 pass / 0 fail / 0 new        │   │
│  ├─────────────────────────────────────────────────────────────┤   │
│  │  acme/marketing-site       ✖ failed     18 min ago          │   │
│  │  github.com/acme/mktg      8 pass / 3 fail / 1 new         │   │
│  ├─────────────────────────────────────────────────────────────┤   │
│  │  acme/docs                 ● passed     1 hour ago          │   │
│  │  github.com/acme/docs      4 pass / 0 fail / 0 new         │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  Recent Runs                                                        │
│  ───────────────────────────────────────────────────────────────    │
│  ┌────────────┬──────────┬──────────┬────────┬─────────────────┐   │
│  │ Project    │ Branch   │ Status   │ Result │ Time            │   │
│  ├────────────┼──────────┼──────────┼────────┼─────────────────┤   │
│  │ web-app    │ main     │ completed │ pass  │ 2 min ago       │   │
│  │ mktg       │ feat/cta │ completed │ fail  │ 18 min ago      │   │
│  │ docs       │ main     │ completed │ pass  │ 1 hour ago      │   │
│  │ web-app    │ fix/nav  │ completed │ pass  │ 2 hours ago     │   │
│  │ ...        │          │          │        │                 │   │
│  └────────────┴──────────┴──────────┴────────┴─────────────────┘   │
│  Shows last 10 runs across all projects.                            │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

The org selector dropdown in the header allows switching between organizations. The selected org filters all projects and runs shown on the page.

**Project cards** show:
- Project name (clickable, links to project page)
- Repository URL
- Last run status/result with color-coded badge
- Last run timestamp (relative, e.g. "2 min ago")
- Checkpoint summary from last run (X pass / Y fail / Z new)

**"Connect repo" button** opens a dialog listing repositories from the user's
GitHub App installations. Selecting a repo creates a new project.

**Onboarding state:** When a newly connected repo is being auto-discovered, a progress card appears at the top of the project list:

```
┌─────────────────────────────────────────────────────────────┐
│  ◐ Discovering workflows for acme/web-app...                │
│  7 pages explored · 3 workflows generated · 45s elapsed     │
│  [View progress]                                            │
└─────────────────────────────────────────────────────────────┘
```

This card updates via polling and transitions to a 'Discovery complete' state with an action to review the generated config.

**Recent runs table** shows the last 10 runs across all accessible projects.
Each row links to the corresponding review page.

---

### 1.2 Project Page (`/project/:projectId`)

```
┌─────────────────────────────────────────────────────────────────────┐
│  MEGATEST                                          [avatar] [logout]│
├─────────────────────────────────────────────────────────────────────┤
│  Dashboard > acme/web-app                                           │
│                                                                     │
│  acme/web-app                              ● passed                 │
│  github.com/acme/web-app · default: main                            │
│                                                                     │
│  ┌──────────┬──────────────┬──────────────┐                         │
│  │  Runs    │  Baselines   │  Settings    │                         │
│  └──────────┴──────────────┴──────────────┘                         │
│  ════════════                                                       │
│                                                                     │
│  (tab content below)                                                │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Header** contains:
- Project name
- Repository URL (linked)
- Default branch name
- Status badge from most recent run

**Tabs** are controlled via query parameter (`?tab=runs|baselines|settings`).

#### Runs tab (default)

```
  Filter: [branch ▾]  [status ▾]
  ┌────────────┬──────────┬──────────┬──────────┬───────────┬────────┐
  │ Commit     │ Branch   │ Trigger  │ Status   │ Summary   │ Time   │
  ├────────────┼──────────┼──────────┼──────────┼───────────┼────────┤
  │ a1b2c3d    │ main     │ push     │ ● passed │ 12/0/0    │ 2m ago │
  │ e4f5g6h    │ feat/cta │ pr       │ ✖ failed │ 8/3/1     │ 18m    │
  │ i7j8k9l    │ main     │ push     │ ● passed │ 12/0/0    │ 1h ago │
  │ ...        │          │          │          │           │        │
  └────────────┴──────────┴──────────┴──────────┴───────────┴────────┘
  Page: [< 1 2 3 ... >]
```

- Commit SHA is a link to the GitHub commit
- Summary column format: `{pass}/{fail}/{new}`
- Each row links to the review page for that run
- Filterable by branch (dropdown of known branches) and status
- Paginated, 25 runs per page

#### Baselines tab

```
  Current baselines for default branch (main)
  ┌────────────────────────────────────┬─────────────┬───────────────┐
  │ Checkpoint                         │ Viewport    │ Last Updated  │
  ├────────────────────────────────────┼─────────────┼───────────────┤
  │ homepage / hero-section            │ 1280x720    │ 2 days ago    │
  │ homepage / hero-section            │ 375x667     │ 2 days ago    │
  │ homepage / footer                  │ 1280x720    │ 1 week ago    │
  │ checkout / payment-form            │ 1280x720    │ 3 days ago    │
  │ ...                                │             │               │
  └────────────────────────────────────┴─────────────┴───────────────┘
```

- Grouped by workflow, then sorted by checkpoint name and viewport
- Shows thumbnail of the baseline image on hover or click
- Last updated timestamp

#### Discovery tab

```
  Last discovery: 2 days ago (completed, 8 workflows generated)

  Re-discovery behavior: [Auto-open PR ▾]    [Run discovery now]

  Uncovered Routes (3)
  ────────────────────────────────────────────────────────────
  ┌─────────────────────┬────────────┬───────────┬──────────┐
  │ Route               │ Framework  │ Source    │ Action   │
  ├─────────────────────┼────────────┼───────────┼──────────┤
  │ /blog               │ Next.js    │ pages/    │ [Discover]│
  │ /changelog          │ Next.js    │ pages/    │ [Discover]│
  │ /integrations       │ Next.js    │ pages/    │ [Discover]│
  └─────────────────────┴────────────┴───────────┴──────────┘
  [Discover all uncovered routes]

  Discovery History
  ────────────────────────────────────────────────────────────
  ┌────────────┬───────────┬──────────────┬──────────────────┐
  │ Date       │ Status    │ Workflows    │ Action           │
  ├────────────┼───────────┼──────────────┼──────────────────┤
  │ Mar 11     │ completed │ 8 generated  │ [View report]    │
  │ Mar 1      │ completed │ 5 generated  │ [View report]    │
  └────────────┴───────────┴──────────────┴──────────────────┘
```

#### Settings tab

```
  Project Settings
  ────────────────

  Default branch:  [main          ] [Save]

  Secrets
  ────────────────
  Secrets are injected as environment variables during workflow runs.
  Values are write-only — they cannot be read back after being set.

  ┌──────────────────┬──────────────────┬──────────┐
  │ Name             │ Value            │          │
  ├──────────────────┼──────────────────┼──────────┤
  │ API_KEY          │ ••••••••         │ [Delete] │
  │ DB_PASSWORD      │ ••••••••         │ [Delete] │
  └──────────────────┴──────────────────┴──────────┘

  [+ Add secret]

  Name:  [________________]
  Value: [________________]
  [Save]

  Trigger Rules
  ────────────────
  Configure which GitHub events trigger visual test runs.

  ┌──────────────────────────────────────────────────────────┐
  │ Templates: [PRs only] [PRs + default branch] [All]      │
  │                                                          │
  │ ☑ Pull requests  Actions: opened, synchronize, reopened  │
  │ ☑ Pushes         Branches: [main, release/*           ]  │
  │ ☐ Manual only                                            │
  │                                                          │
  │ [Save trigger rules]                                     │
  └──────────────────────────────────────────────────────────┘

  Config Repository
  ────────────────
  Configure where Megatest workflow configuration files are stored.

  Config repo: [same as project repo      ▾]

  ○ Use project repository (default)
    Config is stored in .megatest/ alongside your application code.

  ○ Use separate config repository
    Config repo URL: [________________________]
    Branch: [main          ]
    Path: [               ]  (subdirectory within config repo, leave empty for root)

  [Save]

  Danger Zone
  ────────────────
  [Delete project]
```

- Default branch is editable
- Secrets: set and delete only; values are never displayed (shown as bullets)
- Delete project requires confirmation dialog

---

### 1.2b Organization Settings (`/org/:orgId/settings`)

Accessible from the org selector dropdown. Includes:

- **Members:** List of org members with role management (invite, remove, change role).
- **Usage:** Screenshot count and run count for the current billing period, with a bar chart showing daily usage. Tier limits displayed alongside current usage. Upgrade CTA when approaching limits.
- **Billing:** Current plan, payment method, invoice history. Links to Stripe billing portal for plan changes.
- **API Tokens:** Create and revoke API tokens for CI/CD integrations.

```
  Usage (March 2026)
  ────────────────────────────────────────────────────────────
  Screenshots:  142 / 500    ████████░░░░░░░░░░  28%
  Runs:         23  / ∞
  Projects:     2   / 3

  [Upgrade to Pro →]
```

---

### 1.3 Review Page (`/review/:runId`) — PRIMARY INTERFACE

This is the most important page in the application. It is linked directly from
GitHub PR comments and commit status details.

#### Full layout wireframe

```
┌─────────────────────────────────────────────────────────────────────┐
│  MEGATEST   acme/web-app   a1b2c3d   feat/cta                     │
│             PR #42: Add CTA banner                                  │
│             ✖ 3 failed · 1 new · 8 passed       Duration: 47s      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  [All 12] [Failed 3] [New 1] [Passed 8]          [Approve All]    │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ ▼ homepage / hero-section / 1280x720       FAIL   2.34%    │   │
│  │                                                             │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │   │
│  │  │  BASELINE   │  │   ACTUAL    │  │    DIFF     │        │   │
│  │  │             │  │             │  │             │        │   │
│  │  │             │  │             │  │             │        │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘        │   │
│  │                                                             │   │
│  │  [Approve] [Reject]   View: [SxS|Overlay|Slider|Diff]     │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ ▼ homepage / hero-section / 375x667        FAIL   5.17%    │   │
│  │                                                             │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │   │
│  │  │  BASELINE   │  │   ACTUAL    │  │    DIFF     │        │   │
│  │  │             │  │             │  │             │        │   │
│  │  │             │  │             │  │             │        │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘        │   │
│  │                                                             │   │
│  │  [Approve] [Reject]   View: [SxS|Overlay|Slider|Diff]     │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ ▼ checkout / payment-form / 1280x720       FAIL   0.89%    │   │
│  │  ...                                                        │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ ▼ homepage / nav-bar / 1280x720            NEW              │   │
│  │                                                             │   │
│  │  ┌─────────────┐                                            │   │
│  │  │   ACTUAL    │  No baseline — first capture               │   │
│  │  │             │                                            │   │
│  │  │             │                                            │   │
│  │  └─────────────┘                                            │   │
│  │                                                             │   │
│  │  [Approve]                                                  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ ▷ homepage / footer / 1280x720             PASS   0.00%    │   │
│  ├─────────────────────────────────────────────────────────────┤   │
│  │ ▷ homepage / footer / 375x667              PASS   0.00%    │   │
│  ├─────────────────────────────────────────────────────────────┤   │
│  │ ▷ checkout / summary / 1280x720            PASS   0.01%    │   │
│  ├─────────────────────────────────────────────────────────────┤   │
│  │ ...                                                         │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

#### Header

The header is a fixed-height bar at the top of the review page containing:

| Element               | Detail                                           |
|-----------------------|--------------------------------------------------|
| Megatest logo/name    | Links to dashboard                               |
| Project name          | Links to project page                            |
| Commit SHA            | Short form (7 chars), links to GitHub commit     |
| Branch name           | Plain text                                       |
| PR info               | "PR #42: Add CTA banner" (if run is tied to PR)  |
| Status + summary      | Color-coded badge: "3 failed, 1 new, 8 passed"  |
| Duration              | Total run wall-clock time                        |

#### Filter bar

Directly below the header. Contains tab-style filter buttons and the bulk
approve action.

```
┌────────┐ ┌──────────┐ ┌───────┐ ┌──────────┐              ┌─────────────┐
│ All 12 │ │ Failed 3 │ │ New 1 │ │ Passed 8 │              │ Approve All │
└────────┘ └──────────┘ └───────┘ └──────────┘              └─────────────┘
```

- **All**: shows every checkpoint (default)
- **Failed**: shows only checkpoints with `status = fail`
- **New**: shows only checkpoints with `status = new` (no baseline existed)
- **Passed**: shows only checkpoints with `status = pass`
- Each tab shows a count in parentheses
- Active tab is visually highlighted (underline or filled background)
- **Approve All** button is only visible when there are unapproved failed or
  new checkpoints. It is styled as a primary action (filled, prominent color).
- Selecting a filter updates the URL query parameter (`?filter=failed`) without
  a full page reload.

#### Checkpoint cards

Each checkpoint is rendered as a collapsible card. Cards are sorted:
1. Failed checkpoints first
2. New checkpoints second
3. Passed checkpoints third
4. Error checkpoints last

Within each group, cards are sorted alphabetically by
`{workflow}/{name}/{viewport}`.

##### FAILED checkpoint (expanded by default)

```
┌─────────────────────────────────────────────────────────────────┐
│ ▼ homepage / hero-section / 1280x720           FAIL   2.34%    │
│─────────────────────────────────────────────────────────────────│
│                                                                 │
│  BASELINE                 ACTUAL                  DIFF          │
│  ┌───────────────┐        ┌───────────────┐       ┌───────────────┐
│  │               │        │               │       │               │
│  │               │        │               │       │  (red pixels  │
│  │  (screenshot) │        │  (screenshot) │       │   showing     │
│  │               │        │               │       │   changes)    │
│  │               │        │               │       │               │
│  └───────────────┘        └───────────────┘       └───────────────┘
│                                                                 │
│  [Approve] [Reject]      View: [Side-by-side|Overlay|Slider|Diff]
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

- Card header shows workflow, checkpoint name, viewport dimensions, result
  badge, and diff percentage
- Three images displayed side-by-side (default view mode)
- Images are loaded from API endpoints:
  - Baseline: `GET /api/v1/checkpoints/:id/baseline`
  - Actual: `GET /api/v1/checkpoints/:id/actual`
  - Diff: `GET /api/v1/checkpoints/:id/diff`
- `[Approve]` button: green outline, becomes filled on hover
- `[Reject]` button: red outline, becomes filled on hover
- View mode selector: toggle group, default is side-by-side

##### NEW checkpoint (expanded by default)

```
┌─────────────────────────────────────────────────────────────────┐
│ ▼ homepage / nav-bar / 1280x720                NEW             │
│─────────────────────────────────────────────────────────────────│
│                                                                 │
│  ACTUAL                                                         │
│  ┌───────────────┐                                              │
│  │               │   No baseline exists for this checkpoint.    │
│  │  (screenshot) │   This is the first capture.                 │
│  │               │   Approve to set it as the baseline.         │
│  └───────────────┘                                              │
│                                                                 │
│  [Approve]                                                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

- Only the actual image is shown (no baseline or diff exist)
- Explanatory text: "No baseline exists for this checkpoint."
- Only `[Approve]` is available (reject makes no sense for new checkpoints)

##### PASSED checkpoint (collapsed by default)

```
┌─────────────────────────────────────────────────────────────────┐
│ ▷ homepage / footer / 1280x720                 PASS   0.00%    │
└─────────────────────────────────────────────────────────────────┘
```

- Single line, collapsed
- Clicking the row or the `▷` arrow expands the card to reveal images
- When expanded, shows the same three-image layout as failed checkpoints
- No approve/reject buttons (already passing)

##### ERROR checkpoint (collapsed by default)

```
┌─────────────────────────────────────────────────────────────────┐
│ ▷ checkout / payment-form / 1280x720           ERROR           │
│   Error: Timeout waiting for page load after 30000ms           │
└─────────────────────────────────────────────────────────────────┘
```

- Shows the error message inline beneath the header
- Collapsed by default; expanding may show a partial actual image if one was
  captured before the error
- No approve/reject buttons

##### APPROVED checkpoint (post-action state)

```
┌─────────────────────────────────────────────────────────────────┐
│ ▷ homepage / hero-section / 1280x720      ✓ APPROVED   2.34%   │
└─────────────────────────────────────────────────────────────────┘
```

- After approval, the card collapses and the badge changes to a green
  "APPROVED" with a check icon
- Can be expanded to review images again
- No further actions available

##### REJECTED checkpoint (post-action state)

```
┌─────────────────────────────────────────────────────────────────┐
│ ▼ homepage / hero-section / 1280x720      ✖ REJECTED   2.34%   │
│─────────────────────────────────────────────────────────────────│
│                                                                 │
│  (images remain visible)                                        │
│                                                                 │
│  [Approve]    ← can still change decision                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

- Stays expanded so the reviewer can reconsider
- Badge changes to red "REJECTED" with an X icon
- `[Approve]` button remains available (user can change their mind)
- `[Reject]` button is replaced or disabled

---

## 2. Image Viewing Modes

Each checkpoint card has a view mode toggle. The mode is per-card (not global).
The selected mode persists in `sessionStorage` so refreshing retains the choice.

### 2.1 Side-by-side (default)

```
┌─────────────────────────────────────────────────────────────────┐
│  BASELINE               ACTUAL                 DIFF            │
│  ┌─────────────┐        ┌─────────────┐        ┌─────────────┐ │
│  │             │        │             │        │             │ │
│  │             │        │             │        │             │ │
│  │             │        │             │        │             │ │
│  │             │        │             │        │             │ │
│  └─────────────┘        └─────────────┘        └─────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

- Three columns, equal width, in a single row
- Images use `object-fit: contain` within their column to maintain aspect ratio
- All three columns share a synchronized vertical scroll — scrolling one column
  scrolls all three so the same region is always aligned
- Labels ("Baseline", "Actual", "Diff") positioned above each image
- Clicking any image opens a full-resolution lightbox modal:
  - Dark overlay behind the image
  - Image rendered at native resolution (scrollable if larger than viewport)
  - Close with Escape, clicking outside, or an X button
  - Left/right arrows to cycle between baseline, actual, and diff

### 2.2 Overlay

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│        ┌─────────────────────────────┐                          │
│        │                             │                          │
│        │   Actual layered on top     │                          │
│        │   of Baseline               │                          │
│        │                             │                          │
│        │   (opacity controlled       │                          │
│        │    by slider below)         │                          │
│        │                             │                          │
│        └─────────────────────────────┘                          │
│                                                                 │
│   Baseline ○─────────────●───────○ Actual                       │
│                       63%                                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

- Single image area with both images stacked via CSS absolute positioning
- Baseline is the bottom layer (always at 100% opacity)
- Actual is the top layer with adjustable opacity
- Horizontal slider below the image controls the actual image's opacity
  - Left end (0%): only baseline visible
  - Right end (100%): only actual visible
  - Default position: 50%
- Percentage value displayed next to or below the slider
- Useful for spotting subtle pixel shifts, anti-aliasing changes, and
  sub-pixel rendering differences

### 2.3 Slider (before/after wipe)

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│        ┌──────────────┼──────────────┐                          │
│        │              │              │                          │
│        │   BASELINE   │   ACTUAL     │                          │
│        │              │              │                          │
│        │           ◄──┼──►           │                          │
│        │              │              │                          │
│        │              │              │                          │
│        └──────────────┼──────────────┘                          │
│                       │                                         │
│                    (drag handle)                                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

- Both images are rendered at the same size, stacked
- A vertical divider line splits the view
- Left of divider: baseline image (clipped)
- Right of divider: actual image (clipped)
- The divider has a visible drag handle (a vertical bar with left/right arrows
  or a grip indicator)
- User drags the handle horizontally to reveal more of one image
- Default position: center (50%)
- Implemented via `clip-path` or overflow clipping on two overlapping `<div>`
  elements
- Touch-friendly: supports both mouse drag and touch drag

### 2.4 Diff-only

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│        ┌─────────────────────────────┐                          │
│        │                             │                          │
│        │   (diff image only)         │                          │
│        │                             │                          │
│        │   Red/magenta pixels on     │                          │
│        │   white background show     │                          │
│        │   changed areas             │                          │
│        │                             │                          │
│        └─────────────────────────────┘                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

- Shows only the diff image from `GET /api/v1/checkpoints/:id/diff`
- Changed pixels are rendered in red/magenta; unchanged areas are white or
  transparent
- Useful for quickly understanding exactly which regions changed
- Clicking the image opens the full-resolution lightbox

---

## 3. Approval Workflow

The checkpoint card may show a derived review badge (`APPROVED` or `REJECTED`)
after an action, but the underlying execution status remains `fail` or `new`.

### 3.1 Single checkpoint approval

**User action:** Click `[Approve]` on a checkpoint card.

**Request:** `POST /api/v1/checkpoints/:id/approve`

**Behavior:**
1. Button enters a loading state (spinner replaces text, button disabled)
2. On success:
   - Checkpoint badge changes from `FAIL`/`NEW` to `APPROVED` (green check)
   - Card collapses with a brief animation
   - Filter counts in the tab bar update (e.g., Failed 3 becomes Failed 2)
   - The actual image becomes the new baseline for this checkpoint on the
     current branch
3. On error:
   - Toast notification with error message
   - Button returns to its original state
4. If all reviewable checkpoints in the run are now approved:
   - GitHub commit status is updated to `success`
   - A success banner appears at the top of the page:
     "All reviewable checkpoints approved. Commit status updated to success."

### 3.2 Single checkpoint rejection

**User action:** Click `[Reject]` on a checkpoint card.

**Request:** `POST /api/v1/checkpoints/:id/reject`

**Behavior:**
1. Button enters a loading state
2. On success:
   - Checkpoint badge changes to `REJECTED` (red X)
   - Card stays expanded so the reviewer can reconsider
   - `[Reject]` button is replaced by or disabled; `[Approve]` remains
   - No baseline change occurs
3. On error:
   - Toast notification with error message

### 3.3 Bulk approval (Approve All)

**User action:** Click `[Approve All]` in the filter bar.

**Step 1 — Confirmation dialog:**

```
┌─────────────────────────────────────────────┐
│  Approve all checkpoints?                   │
│                                             │
│  This will approve 4 checkpoints and        │
│  update 4 baselines.                        │
│                                             │
│  • 3 failed checkpoints                     │
│  • 1 new checkpoint                         │
│                                             │
│           [Cancel]  [Approve All]            │
└─────────────────────────────────────────────┘
```

**Step 2 — Request:** `POST /api/v1/runs/:runId/approve-all`

**Behavior:**
1. Dialog shows a progress indicator
2. On success:
   - All failed and new checkpoints receive the derived review badge `APPROVED`
   - All cards collapse
   - Filter counts update
   - All corresponding baselines are updated
   - GitHub commit status is updated to `success`
   - Success banner: "All reviewable checkpoints approved. Commit status updated."
   - `[Approve All]` button disappears (nothing left to approve)
3. On error:
   - Toast notification; any partially-approved checkpoints reflect their
     actual state (re-fetch the run to reconcile)

### 3.4 Visual feedback summary

| State    | Badge color | Icon | Card state | Actions available     |
|----------|-------------|------|------------|-----------------------|
| Failed   | Red         | --   | Expanded   | Approve, Reject       |
| New      | Blue        | --   | Expanded   | Approve               |
| Passed   | Green       | --   | Collapsed  | (none)                |
| Error    | Orange      | --   | Collapsed  | (none)                |
| Approved | Green       | check| Collapsed  | (expand to view)      |
| Rejected | Red         | X    | Expanded   | Approve               |

When all reviewable checkpoints have been approved, a banner appears:

```
┌─────────────────────────────────────────────────────────────────┐
│  ✓  All reviewable checkpoints approved. Commit status: success.│
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Responsive Behavior

The review page is designed for **desktop-first** usage. Tablet should work
acceptably. Mobile is not a priority but must not be broken.

### Breakpoints

| Breakpoint     | Width        | Behavior                                  |
|----------------|--------------|-------------------------------------------|
| Desktop        | >= 1024px    | Full three-column side-by-side images     |
| Tablet         | 768 - 1023px | Two-column images (baseline+actual above, diff below) |
| Mobile         | < 768px      | Single-column stacked images              |

### Desktop (>= 1024px)

- Side-by-side view shows three images in a row
- Filter bar and header are on one line each
- Checkpoint cards use full width

### Tablet (768 - 1023px)

- Side-by-side view wraps: baseline and actual in the first row, diff in the
  second row centered
- Overlay and slider modes remain single-image and work naturally
- Filter tabs may wrap to two lines if needed
- Header elements may stack (project info on one line, status on second line)

### Mobile (< 768px)

- Side-by-side view stacks all three images vertically
- Each image takes full card width
- Filter tabs become a horizontal scrollable strip
- `[Approve All]` button moves below the filter tabs
- Header stacks vertically
- Touch targets are at least 44x44px

---

## 5. Navigation

### Breadcrumb

Every page (except the dashboard) shows a breadcrumb trail:

```
Dashboard > acme/web-app > Run a1b2c3d
```

- "Dashboard" links to `/`
- Project name links to `/project/:projectId`
- Run identifier is plain text (current page)

### Back button

The browser's back button works correctly because all navigation is done via
`history.pushState`. The SPA router handles popstate events.

### Keyboard shortcuts

Keyboard shortcuts are active on the review page. They are displayed in a
help tooltip accessible via `?` key.

| Key   | Action                                    |
|-------|-------------------------------------------|
| `j`   | Move focus to the next checkpoint card    |
| `k`   | Move focus to the previous checkpoint card|
| `a`   | Approve the currently focused checkpoint  |
| `r`   | Reject the currently focused checkpoint   |
| `A`   | Approve all (opens confirmation dialog)   |
| `Enter` or `Space` | Toggle expand/collapse on focused card |
| `1`   | Switch to side-by-side view mode          |
| `2`   | Switch to overlay view mode               |
| `3`   | Switch to slider view mode                |
| `4`   | Switch to diff-only view mode             |
| `?`   | Show/hide keyboard shortcuts help         |
| `Esc` | Close lightbox/modal if open              |

**Focus behavior:**
- The focused checkpoint card has a visible outline/highlight (2px blue border)
- `j`/`k` cycle through cards in the current filter view
- Focus wraps around (pressing `j` on the last card focuses the first)
- When a card is approved and collapses, focus moves to the next unresolved
  checkpoint

---

## 6. Real-time Updates

While a run is in status `running` or `comparing`, the review page polls for
updates so the reviewer sees checkpoints appear as they complete.

### Polling mechanism

- Poll interval: **5 seconds**
- Endpoint: `GET /api/v1/runs/:runId` (returns run status and all checkpoints)
- Polling starts automatically when the page loads and the run status is not
  `completed`, `failed`, or `cancelled`
- Polling stops when the run reaches a terminal state (`completed`, `failed`, or `cancelled`)

### Update behavior

1. **New checkpoints appear:** When a poll returns checkpoints not currently
   displayed, they are inserted into the list at the correct sort position with
   a brief fade-in animation.

2. **Status bar updates:** The header summary ("3 failed, 1 new, 8 passed")
   and filter tab counts update to reflect the latest data.

3. **Progress indicator:** While the run is in progress, the header shows:
   ```
   ● Running...  12/20 checkpoints complete  (47s elapsed)
   ```
   The progress fraction updates with each poll.

4. **Run completion:** When the run reaches `completed`:
   - The running indicator is replaced by the final status badge
   - A brief "Run complete" toast appears
   - Polling stops

5. **Run failure:** If the run reaches `failed`:
   - An error banner appears at the top:
     ```
     ✖ Run failed: {error_message}
     ```
   - Any completed checkpoints are still displayed and reviewable
   - Polling stops

### Avoiding flicker

- Poll responses are diffed against the current client state
- Only changed/new checkpoints trigger DOM updates
- Approval states set by the current user are not overwritten by poll data
  (client state takes precedence for actions performed in this session)

---

## 7. URL Structure

All URLs are handled by the client-side SPA router. The Fastify server returns
the same HTML shell for all non-API routes.

| URL                                   | Page           | Notes                        |
|---------------------------------------|----------------|------------------------------|
| `/`                                   | Dashboard      | Redirects to `/auth/github` if not logged in |
| `/project/:projectId`                 | Project detail | Default tab: runs            |
| `/project/:projectId?tab=runs`        | Project detail | Runs tab explicitly          |
| `/project/:projectId?tab=baselines`   | Project detail | Baselines tab                |
| `/project/:projectId?tab=settings`    | Project detail | Settings tab                 |
| `/review/:runId`                      | Review page    | Shows all checkpoints        |
| `/review/:runId?filter=failed`        | Review page    | Pre-filtered to failed       |
| `/review/:runId?filter=new`           | Review page    | Pre-filtered to new          |
| `/review/:runId?filter=passed`        | Review page    | Pre-filtered to passed       |
| `/auth/github`                        | (redirect)     | Initiates GitHub OAuth flow  |
| `/auth/github/callback`              | (redirect)     | OAuth callback, sets session |

### Deep linking

The review page URL with filter parameter is the format used in GitHub PR
comments. Example comment posted by the bot:

```
Megatest found 3 visual differences in this PR.

3 failed · 1 new · 8 passed

[Review changes](https://megatest.example.com/review/abc123?filter=failed)
```

This links directly to the review page filtered to show only failed checkpoints,
getting the reviewer to the actionable items immediately.

---

## 8. Authentication and Session

### Login flow

1. User visits any page while unauthenticated
2. SPA detects no session (API returns 401)
3. Redirect to `/auth/github`
4. GitHub OAuth consent screen
5. Callback to `/auth/github/callback`
6. Server sets an HTTP-only session cookie
7. Redirect to the originally requested page (stored in the `state` parameter)

### Session behavior

- Session is stored as an HTTP-only, secure, SameSite=Lax cookie
- Session expiry: 7 days (rolling — refreshed on each API request)
- The SPA includes credentials with every API request (`credentials: 'include'`)
- If any API request returns 401, the SPA redirects to `/auth/github`

### User avatar and logout

- Top-right corner shows the user's GitHub avatar (from OAuth profile)
- Dropdown menu with:
  - GitHub username
  - "Logout" link (`POST /auth/logout`, clears session cookie)

---

## 9. Error States

### API errors

All API errors are displayed as toast notifications in the bottom-right corner.
Toasts auto-dismiss after 5 seconds and can be manually dismissed.

```
┌──────────────────────────────────┐
│  ✖ Failed to approve checkpoint  │
│  Server returned 500             │
│                            [X]   │
└──────────────────────────────────┘
```

### Empty states

**No projects:**
```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  No projects yet.                                               │
│                                                                 │
│  Connect a GitHub repository to get started.                    │
│                                                                 │
│                    [+ Connect repo]                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**No runs for project:**
```
No runs yet. Push a commit or open a PR to trigger a visual test run.
```

**No checkpoints matching filter:**
```
No {filter} checkpoints in this run.
```

### Loading states

- Page load: centered spinner with "Loading..." text
- Image load: placeholder skeleton (grey rectangle at expected aspect ratio)
- Action in progress: button spinner, button disabled
- Polling: no visible indicator (silent background refresh)

---

## 10. Styling Notes

The MVP does not require a design system or component library. Styling
guidelines for consistency:

- **Font:** System font stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI',
  Roboto, sans-serif`)
- **Colors:**
  - Pass/success: `#22c55e` (green)
  - Fail/error: `#ef4444` (red)
  - New: `#3b82f6` (blue)
  - Warning/pending: `#f59e0b` (amber)
  - Background: `#f9fafb`
  - Card background: `#ffffff`
  - Text: `#111827`
  - Muted text: `#6b7280`
  - Border: `#e5e7eb`
- **Border radius:** 8px for cards, 4px for buttons
- **Spacing:** 8px base unit (multiples of 8 throughout)
- **Shadows:** `0 1px 3px rgba(0,0,0,0.1)` for cards
- **Max content width:** 1280px, centered

---

## Open Questions

1. **Undo approval?** Should users be able to un-approve a checkpoint after
   approving it? Current spec allows approving a rejected checkpoint but not
   un-approving an approved one. May need a "Reset" action.

2. **Batch reject?** The spec includes "Approve All" but no "Reject All". Is
   this needed? Rejecting all seems like an unusual workflow.

3. **Expose approval comments in UI?** The API supports optional comments on
   approve/reject actions. The remaining question is whether the MVP UI should
   expose an input for them or defer that until later.

4. **Notification preferences?** Should users be able to configure when they
   receive GitHub notifications vs. relying on the PR comment alone?
