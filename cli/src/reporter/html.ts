import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CheckpointResult, ReportMeta, RunResult } from '../types.js';

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

function formatDiffPercent(pct: number | null): string {
  if (pct === null) return 'N/A';
  return `${pct.toFixed(2)}%`;
}

function badgeClass(status: string): string {
  switch (status) {
    case 'pass':
      return 'badge--pass';
    case 'fail':
      return 'badge--changed';
    case 'new':
      return 'badge--new';
    case 'error':
      return 'badge--fail';
    default:
      return 'badge--muted';
  }
}

function badgeLabel(status: string): string {
  switch (status) {
    case 'pass':
      return 'Passed';
    case 'fail':
      return 'Changed';
    case 'new':
      return 'New';
    case 'error':
      return 'Failed';
    default:
      return status;
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'pass':
      return 'var(--c-pass)';
    case 'fail':
      return 'var(--c-changed)';
    case 'new':
      return 'var(--c-new)';
    case 'error':
      return 'var(--c-fail)';
    default:
      return 'var(--c-muted)';
  }
}

function checkpointModifier(status: string): string {
  switch (status) {
    case 'fail':
      return 'checkpoint--changed';
    case 'new':
      return 'checkpoint--new';
    case 'error':
      return 'checkpoint--fail';
    default:
      return '';
  }
}

function getImagePath(cp: CheckpointResult, type: 'actual' | 'diff' | 'baseline'): string {
  const slug = `${cp.checkpoint}-${cp.viewport}`;
  switch (type) {
    case 'actual':
      return `${slug}-actual.png`;
    case 'diff':
      return `${slug}-diff.png`;
    case 'baseline':
      return `../../baselines/${slug}.png`;
  }
}

function renderFailedCheckpoint(cp: CheckpointResult): string {
  const baselineSrc = getImagePath(cp, 'baseline');
  const actualSrc = getImagePath(cp, 'actual');
  const diffSrc = getImagePath(cp, 'diff');
  const diffText = cp.diffPercent !== null ? `${cp.diffPercent.toFixed(2)}% diff` : 'N/A';
  const pixelText = cp.diffPixels !== null ? `${formatNumber(cp.diffPixels)} changed px` : '';

  return `
        <div class="checkpoint ${checkpointModifier(cp.status)}" data-status="${cp.status}">
          <div class="checkpoint__header">
            <span class="badge ${badgeClass(cp.status)}">${badgeLabel(cp.status)}</span>
            <span class="checkpoint__title">${escapeHtml(cp.workflow)} &mdash; ${escapeHtml(cp.checkpoint)}</span>
            <div class="checkpoint__meta">
              <span class="mono">${escapeHtml(cp.viewport)}</span>
              <span style="color:${statusColor(cp.status)}">${diffText}</span>
              ${pixelText ? `<span>${pixelText}</span>` : ''}
            </div>
          </div>
          <div class="checkpoint__images">
            <div class="checkpoint__image-slot">
              <div class="checkpoint__image-label">Baseline</div>
              <div class="checkpoint__image-wrap">
                <img src="${escapeHtml(baselineSrc)}" alt="Baseline — ${escapeHtml(cp.workflow)} — ${escapeHtml(cp.checkpoint)} (${escapeHtml(cp.viewport)})" onclick="openLightbox(this.src, this.alt)" class="lightbox-trigger">
              </div>
            </div>
            <div class="checkpoint__image-slot">
              <div class="checkpoint__image-label">Actual</div>
              <div class="checkpoint__image-wrap">
                <img src="${escapeHtml(actualSrc)}" alt="Actual — ${escapeHtml(cp.workflow)} — ${escapeHtml(cp.checkpoint)} (${escapeHtml(cp.viewport)})" onclick="openLightbox(this.src, this.alt)" class="lightbox-trigger">
              </div>
            </div>
            <div class="checkpoint__image-slot">
              <div class="checkpoint__image-label">Diff</div>
              <div class="checkpoint__image-wrap">
                <img src="${escapeHtml(diffSrc)}" alt="Diff — ${escapeHtml(cp.workflow)} — ${escapeHtml(cp.checkpoint)} (${escapeHtml(cp.viewport)})" onclick="openLightbox(this.src, this.alt)" class="lightbox-trigger">
              </div>
            </div>
          </div>
          ${cp.error ? `<div class="checkpoint__actions"><span class="text-xs" style="color:var(--c-fail)">Error: ${escapeHtml(cp.error)}</span></div>` : ''}
        </div>`;
}

function renderNewCheckpoint(cp: CheckpointResult): string {
  const actualSrc = getImagePath(cp, 'actual');

  return `
        <div class="checkpoint ${checkpointModifier(cp.status)}" data-status="${cp.status}">
          <div class="checkpoint__header">
            <span class="badge ${badgeClass(cp.status)}">${badgeLabel(cp.status)}</span>
            <span class="checkpoint__title">${escapeHtml(cp.workflow)} &mdash; ${escapeHtml(cp.checkpoint)}</span>
            <div class="checkpoint__meta">
              <span class="mono">${escapeHtml(cp.viewport)}</span>
              <span style="color:${statusColor(cp.status)}">No baseline</span>
            </div>
          </div>
          <div class="checkpoint__images checkpoint__images--two">
            <div class="checkpoint__image-slot">
              <div class="checkpoint__image-label">Actual</div>
              <div class="checkpoint__image-wrap">
                <img src="${escapeHtml(actualSrc)}" alt="Actual — ${escapeHtml(cp.workflow)} — ${escapeHtml(cp.checkpoint)} (${escapeHtml(cp.viewport)})" onclick="openLightbox(this.src, this.alt)" class="lightbox-trigger">
              </div>
            </div>
            <div class="checkpoint__image-slot" style="display:flex;align-items:center;justify-content:center">
              <div class="empty" style="padding:var(--sp-lg)">
                <span class="text-xs muted">No baseline yet</span>
              </div>
            </div>
          </div>
        </div>`;
}

function renderErrorCheckpoint(cp: CheckpointResult): string {
  return `
        <div class="checkpoint ${checkpointModifier(cp.status)}" data-status="${cp.status}">
          <div class="checkpoint__header">
            <span class="badge ${badgeClass(cp.status)}">${badgeLabel(cp.status)}</span>
            <span class="checkpoint__title">${escapeHtml(cp.workflow)} &mdash; ${escapeHtml(cp.checkpoint)}</span>
            <div class="checkpoint__meta">
              <span class="mono">${escapeHtml(cp.viewport)}</span>
              <span style="color:${statusColor(cp.status)}">Error</span>
            </div>
          </div>
          <div class="card__body">
            <pre class="text-sm" style="color:var(--c-fail);white-space:pre-wrap">${escapeHtml(cp.error ?? 'Unknown error')}</pre>
          </div>
        </div>`;
}

function renderPassedRow(cp: CheckpointResult): string {
  const diffText = formatDiffPercent(cp.diffPercent);
  const baselineSrc = getImagePath(cp, 'baseline');
  const rowId = `passed-${escapeHtml(cp.workflow)}-${escapeHtml(cp.checkpoint)}-${escapeHtml(cp.viewport)}`;
  return `
            <div class="checkpoint" style="border:none;border-radius:0;border-bottom:1px solid var(--c-border)">
              <div class="checkpoint__header passed-row-toggle" onclick="togglePassedRow('${rowId}')" style="cursor:pointer">
                <span class="dot dot--pass"></span>
                <span class="checkpoint__title" style="font-size:var(--fs-sm)">${escapeHtml(cp.workflow)} &mdash; ${escapeHtml(cp.checkpoint)}</span>
                <div class="checkpoint__meta">
                  <span class="mono">${escapeHtml(cp.viewport)}</span>
                  <span style="color:var(--c-pass)">${diffText} diff</span>
                  <span class="text-xs muted passed-row-arrow" id="${rowId}-arrow">&#9654;</span>
                </div>
              </div>
              <div class="passed-row__body" id="${rowId}">
                <div class="checkpoint__images checkpoint__images--one">
                  <div class="checkpoint__image-slot">
                    <div class="checkpoint__image-label">Baseline</div>
                    <div class="checkpoint__image-wrap">
                      <img src="${escapeHtml(baselineSrc)}" alt="Baseline — ${escapeHtml(cp.workflow)} — ${escapeHtml(cp.checkpoint)} (${escapeHtml(cp.viewport)})" onclick="openLightbox(this.src, this.alt)" class="lightbox-trigger">
                    </div>
                  </div>
                </div>
              </div>
            </div>`;
}

const CSS = `/* ============================================================
   Megatest Design System — Standalone Report
   ============================================================ */

/* --- Reset & Base ------------------------------------------ */
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

  --shadow: 0 1px 3px rgba(0,0,0,.4);
  --sidebar-w: 0px;
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
img { max-width: 100%; display: block; }

/* --- Layout (standalone, no sidebar) ----------------------- */
.app           { display: flex; min-height: 100vh; }
.sidebar       { display: none; }
.main          { flex: 1; margin-left: 0; }
.page          { padding: var(--sp-xl); }

/* --- Header bar -------------------------------------------- */
.topbar {
  display: flex; align-items: center; gap: var(--sp-md);
  padding: var(--sp-md) var(--sp-xl);
  border-bottom: 1px solid var(--c-border);
  background: var(--c-surface);
  position: sticky; top: 0; z-index: 5;
}
.topbar__breadcrumb { display: flex; align-items: center; gap: var(--sp-xs); font-size: var(--fs-md); color: var(--c-muted); }
.topbar__breadcrumb span { color: var(--c-text); font-weight: 600; }

/* --- Badges & status -------------------------------------- */
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
.badge--run     { background: var(--c-accent-bg); color: var(--c-accent); }
.badge--muted   { background: rgba(139,148,158,.15); color: var(--c-muted); }

.dot         { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.dot--pass   { background: var(--c-pass); }
.dot--fail   { background: var(--c-fail); }
.dot--changed{ background: var(--c-changed); }
.dot--new    { background: var(--c-new); }

/* --- Cards & panels --------------------------------------- */
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
.card__header h2, .card__header h3 { font-size: var(--fs-lg); font-weight: 600; }
.card__body   { padding: var(--sp-lg); }

/* --- Filter bar -------------------------------------------- */
.filters {
  display: flex; align-items: center; gap: var(--sp-sm);
  padding: var(--sp-md) var(--sp-lg);
  flex-wrap: wrap;
}
.filter-chip {
  padding: 4px 12px;
  font-size: var(--fs-sm); font-family: var(--ff);
  border: 1px solid var(--c-border); border-radius: var(--r-pill);
  background: transparent; color: var(--c-muted);
  cursor: pointer; transition: all .15s;
}
.filter-chip:hover       { border-color: var(--c-accent); color: var(--c-text); }
.filter-chip.active      { background: var(--c-accent-bg); border-color: rgba(56,139,253,.4); color: var(--c-accent); }

/* --- Checkpoint card --------------------------------------- */
.checkpoint {
  border: 1px solid var(--c-border);
  border-radius: var(--r-lg);
  background: var(--c-surface);
  overflow: hidden;
  transition: border-color .15s;
}
.checkpoint:hover { border-color: rgba(139,148,158,.4); }
.checkpoint.checkpoint--fail    { border-color: rgba(248,81,73,.3); }
.checkpoint.checkpoint--changed{ border-color: rgba(210,153,34,.3); }
.checkpoint.checkpoint--new    { border-color: rgba(56,139,253,.3); }

.checkpoint__header {
  display: flex; align-items: center; gap: var(--sp-sm);
  padding: var(--sp-sm) var(--sp-md);
  border-bottom: 1px solid var(--c-border);
  font-size: var(--fs-sm);
}
.checkpoint__title   { font-weight: 600; font-size: var(--fs-md); }
.checkpoint__meta    { color: var(--c-muted); margin-left: auto; display: flex; gap: var(--sp-md); align-items: center; }

.checkpoint__images {
  display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1px;
  background: var(--c-border);
}
.checkpoint__images--two { grid-template-columns: 1fr 1fr; }

.checkpoint__image-slot {
  background: var(--c-bg);
  display: flex; flex-direction: column;
}
.checkpoint__image-label {
  font-size: var(--fs-xs); color: var(--c-muted); text-transform: uppercase; letter-spacing: .04em;
  padding: var(--sp-xs) var(--sp-sm);
  text-align: center;
}
.checkpoint__image-wrap {
  flex: 1; display: flex; align-items: center; justify-content: center;
  padding: var(--sp-sm);
  min-height: 180px;
}
.checkpoint__image-wrap img { border-radius: var(--r-sm); max-height: 260px; }

.checkpoint__actions {
  display: flex; align-items: center; gap: var(--sp-sm);
  padding: var(--sp-sm) var(--sp-md);
  border-top: 1px solid var(--c-border);
}

/* --- Empty state ------------------------------------------ */
.empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: var(--sp-2xl) var(--sp-lg);
  text-align: center;
}

/* --- Stats row -------------------------------------------- */
.stats {
  display: flex; gap: var(--sp-lg); padding: var(--sp-md) 0;
}
.stat        { display: flex; flex-direction: column; }
.stat__value { font-size: var(--fs-2xl); font-weight: 700; }
.stat__label { font-size: var(--fs-xs); color: var(--c-muted); text-transform: uppercase; letter-spacing: .04em; }
.stat--pass .stat__value { color: var(--c-pass); }
.stat--fail .stat__value { color: var(--c-fail); }
.stat--new  .stat__value { color: var(--c-new); }

/* --- Misc helpers ----------------------------------------- */
.gap-sm  { gap: var(--sp-sm); }
.gap-md  { gap: var(--sp-md); }
.gap-lg  { gap: var(--sp-lg); }
.stack   { display: flex; flex-direction: column; }
.row     { display: flex; align-items: center; }
.between { justify-content: space-between; }
.wrap    { flex-wrap: wrap; }
.grow    { flex: 1; }
.muted   { color: var(--c-muted); }
.mono    { font-family: var(--ff-mono); }
.text-sm { font-size: var(--fs-sm); }
.text-xs { font-size: var(--fs-xs); }
.ml-auto { margin-left: auto; }
.mt-md   { margin-top: var(--sp-md); }
.mt-lg   { margin-top: var(--sp-lg); }
.mb-md   { margin-bottom: var(--sp-md); }
.mb-lg   { margin-bottom: var(--sp-lg); }
.p-md    { padding: var(--sp-md); }
.p-lg    { padding: var(--sp-lg); }

/* --- Responsive ------------------------------------------- */
@media (max-width: 768px) {
  .checkpoint__images { grid-template-columns: 1fr; }
}

/* --- Passed section toggle -------------------------------- */
.passed-section__body { display: none; }
.passed-section__body.expanded { display: block; }
.passed-toggle { cursor: pointer; user-select: none; }

/* --- Passed row expand ------------------------------------ */
.passed-row__body { display: none; }
.passed-row__body.expanded { display: block; }
.passed-row-toggle:hover { background: rgba(255,255,255,.03); }
.passed-row-arrow { transition: transform .15s; display: inline-block; font-size: 10px; }
.passed-row-arrow.expanded { transform: rotate(90deg); }

.checkpoint__images--one { grid-template-columns: 1fr; }

/* --- Lightbox --------------------------------------------- */
.lightbox-trigger { cursor: pointer; transition: opacity .15s; }
.lightbox-trigger:hover { opacity: .85; }

.lightbox-overlay {
  display: none; position: fixed; inset: 0; z-index: 100;
  background: rgba(0,0,0,.92);
  align-items: center; justify-content: center;
  flex-direction: column; gap: var(--sp-md);
  cursor: pointer;
}
.lightbox-overlay.open { display: flex; }
.lightbox-overlay img {
  max-width: 95vw; max-height: 88vh;
  border-radius: var(--r-md);
  box-shadow: 0 4px 40px rgba(0,0,0,.6);
  object-fit: contain;
}
.lightbox-label {
  font-size: var(--fs-sm); color: var(--c-muted);
  text-transform: uppercase; letter-spacing: .04em;
}
.lightbox-close {
  position: absolute; top: var(--sp-md); right: var(--sp-lg);
  font-size: 28px; color: var(--c-muted); cursor: pointer;
  background: none; border: none; line-height: 1;
}
.lightbox-close:hover { color: var(--c-text); }
.lightbox-nav {
  position: absolute; top: 50%; transform: translateY(-50%);
  font-size: 36px; color: var(--c-muted); cursor: pointer;
  background: rgba(0,0,0,.5); border: none; line-height: 1;
  padding: 12px 16px; border-radius: var(--r-md);
  transition: color .15s, background .15s;
  user-select: none;
}
.lightbox-nav:hover { color: var(--c-text); background: rgba(255,255,255,.1); }
.lightbox-nav--prev { left: var(--sp-lg); }
.lightbox-nav--next { right: var(--sp-lg); }
.lightbox-counter {
  font-size: var(--fs-xs); color: var(--c-muted);
  letter-spacing: .04em;
}
`;

export function generateHtmlReport(result: RunResult, reportDir: string, _baselinesDir: string): string {
  const failed = result.checkpoints.filter((cp) => cp.status === 'fail');
  const newCps = result.checkpoints.filter((cp) => cp.status === 'new');
  const errorCps = result.checkpoints.filter((cp) => cp.status === 'error');
  const passed = result.checkpoints.filter((cp) => cp.status === 'pass');
  const total = result.checkpoints.length;

  // Build failed/error checkpoints HTML
  const failedHtml = [...failed, ...errorCps]
    .map((cp) => {
      if (cp.status === 'error') {
        return renderErrorCheckpoint(cp);
      }
      return renderFailedCheckpoint(cp);
    })
    .join('\n');

  // Build new checkpoints HTML
  const newHtml = newCps.map((cp) => renderNewCheckpoint(cp)).join('\n');

  // Build passed checkpoints HTML
  const passedRows = passed.map((cp) => renderPassedRow(cp)).join('\n');

  const passedSection =
    passed.length > 0
      ? `
        <div class="card" data-status="pass">
          <div class="card__header passed-toggle" onclick="togglePassed()">
            <span class="badge badge--pass">Passed</span>
            <span style="font-weight:500">${passed.length} checkpoint${passed.length !== 1 ? 's' : ''} passed</span>
            <span class="text-xs muted ml-auto" id="passed-toggle-label">Click to expand</span>
          </div>
          <div class="passed-section__body" id="passed-body">
${passedRows}
          </div>
        </div>`
      : '';

  const timestamp = result.timestamp;
  const durationSec = (result.duration / 1000).toFixed(1);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Megatest Report &mdash; ${escapeHtml(result.commitHash)}</title>
  <style>
${CSS}
  </style>
</head>
<body>

<div class="app">
  <div class="main">
    <div class="topbar">
      <div class="topbar__breadcrumb">
        <span>Megatest Report</span>
      </div>
    </div>

    <!-- Run metadata -->
    <div class="p-lg" style="border-bottom:1px solid var(--c-border);background:var(--c-surface)">
      <div class="row gap-lg wrap">
        <div class="stack">
          <span class="text-xs muted">Commit</span>
          <span class="mono text-sm">${escapeHtml(result.commitHash)}</span>
        </div>
        <div class="stack">
          <span class="text-xs muted">Timestamp</span>
          <span class="text-sm">${escapeHtml(timestamp)}</span>
        </div>
        <div class="stack">
          <span class="text-xs muted">Duration</span>
          <span class="text-sm">${durationSec}s</span>
        </div>
        <div class="ml-auto row gap-sm">
          ${result.passed > 0 ? `<span class="badge badge--pass">${result.passed} passed</span>` : ''}
          ${result.failed > 0 ? `<span class="badge badge--changed">${result.failed} changed</span>` : ''}
          ${result.newCount > 0 ? `<span class="badge badge--new">${result.newCount} new</span>` : ''}
          ${result.errors > 0 ? `<span class="badge badge--fail">${result.errors} failed</span>` : ''}
        </div>
      </div>
    </div>

    <!-- Filters -->
    <div class="filters" style="background:var(--c-surface);border-bottom:1px solid var(--c-border)">
      <button class="filter-chip active" data-filter="all" onclick="setFilter('all')">All <span class="text-xs">(${total})</span></button>
      ${failed.length > 0 ? `<button class="filter-chip" data-filter="fail" onclick="setFilter('fail')">Changed <span class="text-xs">(${failed.length})</span></button>` : ''}
      ${newCps.length > 0 ? `<button class="filter-chip" data-filter="new" onclick="setFilter('new')">New <span class="text-xs">(${newCps.length})</span></button>` : ''}
      ${errorCps.length > 0 ? `<button class="filter-chip" data-filter="error" onclick="setFilter('error')">Failed <span class="text-xs">(${errorCps.length})</span></button>` : ''}
      ${passed.length > 0 ? `<button class="filter-chip" data-filter="pass" onclick="setFilter('pass')">Passed <span class="text-xs">(${passed.length})</span></button>` : ''}
    </div>

    <!-- Checkpoints -->
    <div class="page">
      <div class="stack gap-lg">
${failedHtml}
${newHtml}
${passedSection}
      </div>
    </div>
  </div>
</div>

<!-- Lightbox overlay -->
<div class="lightbox-overlay" id="lightbox" onclick="closeLightbox(event)">
  <button class="lightbox-close" onclick="closeLightbox(event)">&times;</button>
  <button class="lightbox-nav lightbox-nav--prev" id="lightbox-prev" onclick="navLightbox(event,-1)">&#8249;</button>
  <button class="lightbox-nav lightbox-nav--next" id="lightbox-next" onclick="navLightbox(event,1)">&#8250;</button>
  <img id="lightbox-img" src="" alt="">
  <div class="lightbox-label" id="lightbox-label"></div>
  <div class="lightbox-counter" id="lightbox-counter"></div>
</div>

<script>
function setFilter(status) {
  // Update active chip
  document.querySelectorAll('.filter-chip').forEach(function(chip) {
    chip.classList.toggle('active', chip.getAttribute('data-filter') === status);
  });

  // Show/hide checkpoints
  document.querySelectorAll('.checkpoint[data-status], .card[data-status]').forEach(function(el) {
    var elStatus = el.getAttribute('data-status');
    if (status === 'all') {
      el.style.display = '';
    } else if (status === 'fail') {
      el.style.display = (elStatus === 'fail') ? '' : 'none';
    } else if (status === 'error') {
      el.style.display = (elStatus === 'error') ? '' : 'none';
    } else {
      el.style.display = (elStatus === status) ? '' : 'none';
    }
  });
}

function togglePassed() {
  var body = document.getElementById('passed-body');
  var label = document.getElementById('passed-toggle-label');
  if (body.classList.contains('expanded')) {
    body.classList.remove('expanded');
    label.textContent = 'Click to expand';
  } else {
    body.classList.add('expanded');
    label.textContent = 'Click to collapse';
  }
}

function togglePassedRow(id) {
  var body = document.getElementById(id);
  var arrow = document.getElementById(id + '-arrow');
  if (body.classList.contains('expanded')) {
    body.classList.remove('expanded');
    arrow.classList.remove('expanded');
  } else {
    body.classList.add('expanded');
    arrow.classList.add('expanded');
  }
}

// Build lightbox image list from all triggers on the page
var lbItems = [];
var lbIndex = 0;

function buildLightboxItems() {
  lbItems = [];
  document.querySelectorAll('.lightbox-trigger').forEach(function(img) {
    lbItems.push({ src: img.src, label: img.alt || '' });
  });
}

function updateLightboxNav() {
  var counter = document.getElementById('lightbox-counter');
  counter.textContent = (lbIndex + 1) + ' / ' + lbItems.length;
}

function openLightbox(src, label) {
  buildLightboxItems();
  // Find the index of the clicked image
  for (var i = 0; i < lbItems.length; i++) {
    if (lbItems[i].src === src) { lbIndex = i; break; }
  }
  showLightboxImage();
  document.getElementById('lightbox').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function showLightboxImage() {
  var item = lbItems[lbIndex];
  document.getElementById('lightbox-img').src = item.src;
  document.getElementById('lightbox-label').textContent = item.label;
  updateLightboxNav();
}

function navLightbox(e, dir) {
  e.stopPropagation();
  if (lbItems.length === 0) return;
  lbIndex = (lbIndex + dir + lbItems.length) % lbItems.length;
  showLightboxImage();
}

function closeLightbox(e) {
  // Don't close when clicking the image or nav buttons
  if (e && e.target && (e.target.id === 'lightbox-img' || e.target.classList.contains('lightbox-nav'))) return;
  var overlay = document.getElementById('lightbox');
  overlay.classList.remove('open');
  document.body.style.overflow = '';
}

document.addEventListener('keydown', function(e) {
  var overlay = document.getElementById('lightbox');
  if (!overlay.classList.contains('open')) return;
  if (e.key === 'Escape') closeLightbox(null);
  if (e.key === 'ArrowLeft') navLightbox(e, -1);
  if (e.key === 'ArrowRight') navLightbox(e, 1);
});
</script>

</body>
</html>`;

  // Ensure reportDir exists
  fs.mkdirSync(reportDir, { recursive: true });

  const outputPath = path.join(reportDir, 'index.html');
  fs.writeFileSync(outputPath, html, 'utf-8');

  const meta: ReportMeta = {
    commitHash: result.commitHash,
    timestamp: result.timestamp,
    passed: result.passed,
    failed: result.failed,
    newCount: result.newCount,
    errors: result.errors,
    duration: result.duration,
    totalCheckpoints: result.checkpoints.length,
  };
  fs.writeFileSync(path.join(reportDir, 'meta.json'), JSON.stringify(meta, null, 2));

  return outputPath;
}
