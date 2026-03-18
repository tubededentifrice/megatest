export const CSS_TOKENS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --c-bg:        #0d1117;
  --c-surface:   #161b22;
  --c-border:    #30363d;
  --c-text:      #e6edf3;
  --c-muted:     #8b949e;
  --c-accent:    #58a6ff;
  --c-accent-bg: rgba(56,139,253,.15);
  --c-pass:      #3fb950;
  --c-pass-bg:   rgba(63,185,80,.15);
  --c-fail:      #f85149;
  --c-fail-bg:   rgba(248,81,73,.15);
  --c-changed:   #d29922;
  --c-changed-bg:rgba(210,153,34,.15);
  --c-new:       #58a6ff;
  --c-new-bg:    rgba(56,139,253,.15);

  --sp-xs: 4px;  --sp-sm: 8px;  --sp-md: 16px;  --sp-lg: 24px;  --sp-xl: 32px;  --sp-2xl: 48px;

  --ff: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
  --ff-mono: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
  --fs-xs: 11px;  --fs-sm: 12px;  --fs-md: 14px;  --fs-lg: 16px;  --fs-xl: 20px;  --fs-2xl: 24px;

  --r-sm: 4px;  --r-md: 6px;  --r-lg: 12px;  --r-pill: 100px;
}

html { font-size: var(--fs-md); }
body {
  font-family: var(--ff);
  color: var(--c-text);
  background: var(--c-bg);
  line-height: 1.5;
  min-height: 100vh;
}

a { color: var(--c-accent); text-decoration: none; }
a:hover { text-decoration: underline; }

.badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px;
  font-size: var(--fs-xs); font-weight: 600;
  border-radius: var(--r-pill); text-transform: uppercase; letter-spacing: .03em;
}
.badge--pass    { background: var(--c-pass-bg); color: var(--c-pass); }
.badge--fail    { background: var(--c-fail-bg); color: var(--c-fail); }
.badge--changed { background: var(--c-changed-bg); color: var(--c-changed); }
.badge--new     { background: var(--c-new-bg);  color: var(--c-new); }
.badge--muted   { background: rgba(139,148,158,.15); color: var(--c-muted); }

.muted { color: var(--c-muted); }
.mono { font-family: var(--ff-mono); }
.text-sm { font-size: var(--fs-sm); }
.text-xs { font-size: var(--fs-xs); }
.ml-auto { margin-left: auto; }
.stack { display: flex; flex-direction: column; }
.gap-lg { gap: var(--sp-lg); }
`;

export const DASHBOARD_CSS = `
${CSS_TOKENS}

.app  { display: flex; min-height: 100vh; }
.main { flex: 1; }
.page { padding: var(--sp-xl); max-width: 960px; margin: 0 auto; }

.topbar {
  display: flex; align-items: center; gap: var(--sp-md);
  padding: var(--sp-md) var(--sp-xl);
  border-bottom: 1px solid var(--c-border);
  background: var(--c-surface);
  position: sticky; top: 0; z-index: 5;
}
.topbar__breadcrumb { display: flex; align-items: center; gap: var(--sp-xs); font-size: var(--fs-md); color: var(--c-muted); }
.topbar__breadcrumb span { color: var(--c-text); font-weight: 600; }

.card {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-lg);
  overflow: hidden;
}
.card__header {
  display: flex; align-items: center; gap: var(--sp-md);
  padding: var(--sp-md) var(--sp-lg);
  border-bottom: 1px solid var(--c-border);
}
.card__header h2 { font-size: var(--fs-lg); font-weight: 600; }
.card__body { padding: var(--sp-lg); }

.latest-report {
  display: block;
  padding: var(--sp-md);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  color: var(--c-text);
  transition: border-color .15s;
}
.latest-report:hover { border-color: var(--c-accent); text-decoration: none; }
.latest-report__header {
  display: flex; align-items: center; gap: var(--sp-md); flex-wrap: wrap;
}
.latest-report__badges {
  display: flex; align-items: center; gap: var(--sp-sm); margin-top: var(--sp-sm); flex-wrap: wrap;
}

.older-reports { margin-top: var(--sp-md); }
.older-reports__header {
  padding: var(--sp-xs) 0;
  text-transform: uppercase; letter-spacing: .04em;
}
.report-row {
  display: flex; align-items: center; gap: var(--sp-md);
  padding: var(--sp-sm) var(--sp-md);
  border-bottom: 1px solid var(--c-border);
  color: var(--c-text);
  transition: background .15s;
}
.report-row:hover { background: rgba(255,255,255,.03); text-decoration: none; }
.report-row__badges { margin-left: auto; display: flex; gap: var(--sp-xs); }

.empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: var(--sp-2xl) var(--sp-lg);
  text-align: center;
}
`;

export const REVIEW_CSS = `
${CSS_TOKENS}

/* --- Full-height layout --- */
.rv { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }

.rv__topbar {
  display: flex; align-items: center; gap: var(--sp-md);
  padding: var(--sp-sm) var(--sp-lg);
  border-bottom: 1px solid var(--c-border);
  background: var(--c-surface);
  flex-shrink: 0;
}
.rv__breadcrumb {
  display: flex; align-items: center; gap: var(--sp-xs);
  font-size: var(--fs-sm);
}
.rv__breadcrumb a { color: var(--c-muted); }
.rv__breadcrumb a:hover { color: var(--c-accent); }
.rv__sep { color: var(--c-border); margin: 0 2px; }
.rv__current { color: var(--c-text); font-weight: 600; }

.rv__layout { display: flex; flex: 1; overflow: hidden; }

/* --- Left sidebar --- */
.rv__sidebar {
  width: 500px; min-width: 500px;
  border-right: 1px solid var(--c-border);
  background: var(--c-surface);
  display: flex; flex-direction: column;
  overflow: hidden;
}

.rv__tabs {
  display: flex;
  border-bottom: 1px solid var(--c-border);
  flex-shrink: 0;
}
.rv__tab {
  flex: 1; padding: var(--sp-sm) var(--sp-xs);
  font-size: var(--fs-xs); font-family: var(--ff);
  background: none; border: none; color: var(--c-muted);
  cursor: pointer; border-bottom: 2px solid transparent;
  text-transform: uppercase; letter-spacing: .03em;
  transition: color .1s, border-color .1s;
}
.rv__tab:hover { color: var(--c-text); }
.rv__tab.active { color: var(--c-accent); border-bottom-color: var(--c-accent); }
.rv__tab-count {
  font-size: 10px; font-weight: 700;
  background: rgba(255,255,255,.08); border-radius: var(--r-pill);
  padding: 1px 5px; margin-left: 2px;
}

.rv__search {
  padding: var(--sp-xs) var(--sp-sm);
  border-bottom: 1px solid var(--c-border);
  flex-shrink: 0;
}
.rv__search-input {
  width: 100%; box-sizing: border-box;
  padding: var(--sp-xs) var(--sp-sm);
  font-size: var(--fs-xs); font-family: var(--ff);
  background: var(--c-bg); color: var(--c-text);
  border: 1px solid var(--c-border); border-radius: var(--r-md);
  outline: none;
}
.rv__search-input:focus { border-color: var(--c-accent); }
.rv__search-input::placeholder { color: var(--c-muted); }

.rv__panels { flex: 1; overflow-y: auto; }
.rv__panel {
  padding: var(--sp-sm);
  display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-sm);
  align-content: start;
}
.rv__panel.hidden { display: none; }

.rv__empty { padding: var(--sp-lg); text-align: center; grid-column: 1 / -1; }

.rv__sidebar-footer {
  flex-shrink: 0;
  padding: var(--sp-sm);
  border-top: 1px solid var(--c-border);
}

/* --- Thumbnails --- */
.rv-thumb {
  border: 2px solid var(--c-border);
  border-radius: var(--r-md);
  overflow: hidden;
  cursor: pointer;
  transition: border-color .15s;
}
.rv-thumb:hover { border-color: var(--c-muted); }
.rv-thumb.selected { border-color: var(--c-accent); }
.rv-thumb.accepted { opacity: .35; pointer-events: none; position: relative; }
.rv-thumb.accepted::after {
  content: 'Accepted';
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  background: rgba(63,185,80,.15);
  color: var(--c-pass); font-weight: 600; font-size: var(--fs-sm);
  letter-spacing: .03em;
}

.rv-thumb__wrap {
  position: relative;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  background: var(--c-bg);
}
.rv-thumb__img {
  width: 100%; height: 100%;
  display: block;
  object-fit: contain;
}

.rv-thumb__label {
  padding: var(--sp-xs) var(--sp-sm);
  background: var(--c-surface);
  display: flex; align-items: center; justify-content: space-between; gap: var(--sp-xs);
}
.rv-thumb__name {
  font-size: var(--fs-xs); font-weight: 600;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.rv-thumb__meta {
  font-size: 10px; color: var(--c-muted);
  white-space: nowrap;
}

/* --- 3-zone hover overlay --- */
.rv-thumb__overlay {
  position: absolute; inset: 0;
  display: none;
  grid-template-rows: 1fr 2fr;
  grid-template-columns: 1fr 1fr;
}
.rv-thumb:hover .rv-thumb__overlay { display: grid; }

.rv-zone {
  display: flex; align-items: center; justify-content: center;
  font-size: var(--fs-xs); font-weight: 700;
  text-transform: uppercase; letter-spacing: .05em;
  color: rgba(255,255,255,.9);
  text-shadow: 0 1px 3px rgba(0,0,0,.6);
  transition: backdrop-filter .1s;
  cursor: pointer;
}
.rv-zone--diff {
  grid-column: 1 / -1;
  background: rgba(210,153,34,.4);
}
.rv-zone--diff:hover { background: rgba(210,153,34,.65); }

.rv-zone--baseline {
  background: rgba(63,185,80,.4);
}
.rv-zone--baseline:hover { background: rgba(63,185,80,.65); }

.rv-zone--actual {
  background: rgba(248,81,73,.4);
}
.rv-zone--actual:hover { background: rgba(248,81,73,.65); }

/* --- Accept button (on thumbnails) --- */
.rv-accept-btn {
  display: none;
  position: absolute; bottom: var(--sp-xs); right: var(--sp-xs);
  padding: 3px 10px;
  font-size: var(--fs-xs); font-family: var(--ff); font-weight: 600;
  background: var(--c-pass); color: #fff;
  border: none; border-radius: var(--r-pill);
  cursor: pointer; z-index: 2;
  transition: filter .1s;
}
.rv-thumb:hover .rv-accept-btn { display: block; }
.rv-accept-btn:hover { filter: brightness(1.15); }

/* --- Accept All button --- */
.rv-accept-all {
  width: 100%; padding: var(--sp-sm) var(--sp-md);
  font-size: var(--fs-sm); font-family: var(--ff); font-weight: 600;
  background: var(--c-pass); color: #fff;
  border: none; border-radius: var(--r-md);
  cursor: pointer; transition: all .15s;
}
.rv-accept-all:hover { filter: brightness(1.1); }
.rv-accept-all:disabled { opacity: .6; cursor: default; }
.rv-accept-all--done { background: var(--c-pass-bg); color: var(--c-pass); border-color: rgba(63,185,80,.3); }

/* --- Right preview column --- */
.rv__preview {
  flex: 1; display: flex;
  align-items: center; justify-content: center;
  background: var(--c-bg);
  padding: var(--sp-md);
  overflow: hidden;
  position: relative;
}
.rv__preview img {
  max-width: 100%; max-height: 100%;
  object-fit: contain;
  border-radius: var(--r-sm);
}
.rv__preview-empty {
  display: flex; align-items: center; justify-content: center;
}
.rv__preview-label {
  position: absolute; bottom: var(--sp-sm); left: 50%; transform: translateX(-50%);
  font-size: var(--fs-xs); color: var(--c-muted);
  background: rgba(22,27,34,.85); padding: 2px 10px; border-radius: var(--r-pill);
  letter-spacing: .03em;
}
`;
