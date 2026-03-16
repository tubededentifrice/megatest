import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import type { ReportMeta, ReviewCheckpoint, ServeConfig, ServeProjectConfig } from '../types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DiscoveredProject {
    name: string;
    repoPath: string;
    megatestDir: string;
    reportsDir: string;
}

interface ReportEntry {
    commitHash: string;
    meta: ReportMeta | null;
    mtime: Date;
    reportUrl: string;
}

interface ReviewData {
    extension: string;
    checkpoints: ReviewCheckpoint[];
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

function loadConfig(configPath: string): ServeConfig {
    if (!fs.existsSync(configPath)) {
        console.error(`Config file not found: ${configPath}`);
        console.error('Create one from serve.config.sample.yml');
        process.exit(1);
    }

    const raw = fs.readFileSync(configPath, 'utf-8');
    const doc = yaml.load(raw) as Record<string, unknown>;

    if (!doc || typeof doc !== 'object') {
        console.error(`Invalid config file: ${configPath}`);
        process.exit(1);
    }

    const server = (doc.server as Record<string, unknown>) ?? {};
    const projects = (doc.projects as Array<Record<string, unknown>>) ?? [];

    if (!Array.isArray(projects) || projects.length === 0) {
        console.error(`Config must have at least one project in 'projects' list`);
        process.exit(1);
    }

    const parsed: ServeConfig = {
        title: (doc.title as string) ?? 'Megatest Reports',
        server: {
            port: (server.port as number) ?? 3000,
            host: (server.host as string) ?? '0.0.0.0',
        },
        projects: projects.map((p, i) => {
            if (!p.name || !p.path) {
                console.error(`Project at index ${i} must have 'name' and 'path'`);
                process.exit(1);
            }
            return { name: p.name as string, path: p.path as string };
        }),
    };

    return parsed;
}

// ---------------------------------------------------------------------------
// Project discovery
// ---------------------------------------------------------------------------

function discoverProjects(projects: ServeProjectConfig[]): DiscoveredProject[] {
    const discovered: DiscoveredProject[] = [];

    for (const proj of projects) {
        const repoPath = path.resolve(proj.path);
        const megatestDir = path.join(repoPath, '.megatest');
        const reportsDir = path.join(megatestDir, 'reports');

        if (!fs.existsSync(reportsDir)) {
            console.warn(`Warning: No .megatest/reports/ in ${repoPath} (project: ${proj.name})`);
            continue;
        }

        discovered.push({
            name: proj.name,
            repoPath,
            megatestDir,
            reportsDir,
        });
    }

    return discovered;
}

// ---------------------------------------------------------------------------
// Report listing
// ---------------------------------------------------------------------------

function listReports(project: DiscoveredProject): ReportEntry[] {
    const entries: ReportEntry[] = [];

    let dirs: string[];
    try {
        dirs = fs
            .readdirSync(project.reportsDir, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name);
    } catch {
        return entries;
    }

    for (const dirName of dirs) {
        const reportPath = path.join(project.reportsDir, dirName);
        const indexPath = path.join(reportPath, 'index.html');

        if (!fs.existsSync(indexPath)) continue;

        let meta: ReportMeta | null = null;
        const metaPath = path.join(reportPath, 'meta.json');
        try {
            if (fs.existsSync(metaPath)) {
                meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as ReportMeta;
            }
        } catch {
            // Ignore parse errors
        }

        const stat = fs.statSync(reportPath);

        entries.push({
            commitHash: dirName,
            meta,
            mtime: stat.mtime,
            reportUrl: `/projects/${encodeURIComponent(project.name)}/reports/${encodeURIComponent(dirName)}/review`,
        });
    }

    // Sort newest first
    entries.sort((a, b) => {
        const timeA = a.meta ? new Date(a.meta.timestamp).getTime() : a.mtime.getTime();
        const timeB = b.meta ? new Date(b.meta.timestamp).getTime() : b.mtime.getTime();
        return timeB - timeA;
    });

    return entries;
}

// ---------------------------------------------------------------------------
// Review data loading
// ---------------------------------------------------------------------------

function loadReviewData(megatestDir: string, commitDir: string): ReviewData | null {
    // Try results.json first
    const resultsPath = path.join(commitDir, 'results.json');
    if (fs.existsSync(resultsPath)) {
        try {
            return JSON.parse(fs.readFileSync(resultsPath, 'utf-8')) as ReviewData;
        } catch {
            // Fall through to reconstruction
        }
    }

    // Reconstruct from filesystem
    const baselinesDir = path.join(megatestDir, 'baselines');
    let files: string[];
    try {
        files = fs.readdirSync(commitDir);
    } catch {
        return null;
    }

    // Detect extension
    const hasWebp = files.some((f) => f.endsWith('.webp'));
    const ext = hasWebp ? '.webp' : '.png';

    const actualFiles = files.filter((f) => f.includes('-actual') && f.endsWith(ext));
    const diffFiles = new Set(files.filter((f) => f.includes('-diff') && f.endsWith(ext)));

    const checkpoints: ReviewCheckpoint[] = [];

    for (const af of actualFiles) {
        const slug = af.replace(`-actual${ext}`, '');
        const lastDash = slug.lastIndexOf('-');
        if (lastDash === -1) continue;
        const cp = slug.substring(0, lastDash);
        const vp = slug.substring(lastDash + 1);
        const hasDiff = diffFiles.has(`${slug}-diff${ext}`);

        checkpoints.push({
            workflow: '',
            checkpoint: cp,
            viewport: vp,
            status: hasDiff ? 'fail' : 'new',
            diffPercent: null,
            diffPixels: null,
            error: null,
        });
    }

    // Find passed checkpoints from baselines not in the fail/new set
    const knownSlugs = new Set(checkpoints.map((c) => `${c.checkpoint}-${c.viewport}`));
    if (fs.existsSync(baselinesDir)) {
        try {
            for (const bf of fs.readdirSync(baselinesDir)) {
                if (!bf.endsWith(ext)) continue;
                const slug = bf.replace(ext, '');
                if (knownSlugs.has(slug)) continue;
                const lastDash = slug.lastIndexOf('-');
                if (lastDash === -1) continue;
                checkpoints.push({
                    workflow: '',
                    checkpoint: slug.substring(0, lastDash),
                    viewport: slug.substring(lastDash + 1),
                    status: 'pass',
                    diffPercent: null,
                    diffPixels: null,
                    error: null,
                });
            }
        } catch {
            // Ignore
        }
    }

    return { extension: ext, checkpoints };
}

// ---------------------------------------------------------------------------
// MIME types
// ---------------------------------------------------------------------------

const MIME_TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.gif': 'image/gif',
};

function getMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    return MIME_TYPES[ext] ?? 'application/octet-stream';
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDuration(ms: number): string {
    const sec = ms / 1000;
    if (sec < 60) return `${sec.toFixed(1)}s`;
    const min = Math.floor(sec / 60);
    const remSec = (sec % 60).toFixed(0);
    return `${min}m ${remSec}s`;
}

function timeTag(dateStr: string): string {
    return `<time data-ts="${escapeHtml(dateStr)}"></time>`;
}

function jsonReply(res: http.ServerResponse, status: number, data: Record<string, unknown>): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

function parseJsonBody(req: http.IncomingMessage, maxBytes = 10240): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
        let body = '';
        let size = 0;
        req.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > maxBytes) {
                reject(new Error('Body too large'));
                req.destroy();
                return;
            }
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                resolve(body.length > 0 ? (JSON.parse(body) as Record<string, unknown>) : {});
            } catch {
                reject(new Error('Invalid JSON'));
            }
        });
        req.on('error', reject);
    });
}

// ---------------------------------------------------------------------------
// Dashboard HTML
// ---------------------------------------------------------------------------

function renderBadges(meta: ReportMeta): string {
    const parts: string[] = [];
    if (meta.passed > 0) parts.push(`<span class="badge badge--pass">${meta.passed} passed</span>`);
    if (meta.failed > 0) parts.push(`<span class="badge badge--changed">${meta.failed} changed</span>`);
    if (meta.newCount > 0) parts.push(`<span class="badge badge--new">${meta.newCount} new</span>`);
    if (meta.errors > 0) parts.push(`<span class="badge badge--fail">${meta.errors} failed</span>`);
    return parts.join(' ');
}

function renderLatestReport(report: ReportEntry): string {
    if (report.meta) {
        const meta = report.meta;
        return `
      <a href="${escapeHtml(report.reportUrl)}" class="latest-report">
        <div class="latest-report__header">
          <span class="mono" style="font-size:var(--fs-lg);font-weight:600">${escapeHtml(report.commitHash)}</span>
          <span class="muted">${timeTag(meta.timestamp)}</span>
          <span class="muted">${formatDuration(meta.duration)}</span>
        </div>
        <div class="latest-report__badges">
          ${renderBadges(meta)}
          <span class="muted text-xs">${meta.totalCheckpoints} checkpoint${meta.totalCheckpoints !== 1 ? 's' : ''}</span>
        </div>
      </a>`;
    }

    return `
    <a href="${escapeHtml(report.reportUrl)}" class="latest-report">
      <div class="latest-report__header">
        <span class="mono" style="font-size:var(--fs-lg);font-weight:600">${escapeHtml(report.commitHash)}</span>
        <span class="muted">${timeTag(report.mtime.toISOString())}</span>
      </div>
    </a>`;
}

function renderOlderReport(report: ReportEntry): string {
    const dateStr = report.meta ? timeTag(report.meta.timestamp) : timeTag(report.mtime.toISOString());
    const badges = report.meta ? renderBadges(report.meta) : '';

    return `
    <a href="${escapeHtml(report.reportUrl)}" class="report-row">
      <span class="mono">${escapeHtml(report.commitHash)}</span>
      <span class="muted text-sm">${dateStr}</span>
      <span class="report-row__badges">${badges}</span>
    </a>`;
}

function renderDashboard(title: string, projects: DiscoveredProject[]): string {
    const projectCards = projects
        .map((project) => {
            const reports = listReports(project);

            if (reports.length === 0) {
                return `
        <div class="card">
          <div class="card__header">
            <h2>${escapeHtml(project.name)}</h2>
            <span class="muted text-xs">${escapeHtml(project.repoPath)}</span>
          </div>
          <div class="card__body">
            <div class="empty">
              <span class="muted">No reports yet</span>
            </div>
          </div>
        </div>`;
            }

            const [latest, ...older] = reports;

            const olderHtml =
                older.length > 0
                    ? `<div class="older-reports">
          <div class="older-reports__header muted text-xs">
            ${older.length} older report${older.length !== 1 ? 's' : ''}
          </div>
          ${older.map((r) => renderOlderReport(r)).join('\n')}
        </div>`
                    : '';

            return `
      <div class="card">
        <div class="card__header">
          <h2>${escapeHtml(project.name)}</h2>
          <span class="muted text-xs">${escapeHtml(project.repoPath)}</span>
          <span class="badge badge--muted ml-auto">${reports.length} report${reports.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="card__body">
          ${renderLatestReport(latest)}
          ${olderHtml}
        </div>
      </div>`;
        })
        .join('\n');

    const noProjects =
        projects.length === 0
            ? `<div class="empty" style="padding:var(--sp-2xl)">
        <span class="muted">No projects found. Check your serve.config.yml</span>
      </div>`
            : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
${DASHBOARD_CSS}
  </style>
</head>
<body>
  <div class="app">
    <div class="main">
      <div class="topbar">
        <div class="topbar__breadcrumb">
          <span>${escapeHtml(title)}</span>
        </div>
        <a href="/" class="ml-auto text-sm">Refresh</a>
      </div>
      <div class="page">
        <div class="stack gap-lg">
          ${noProjects}
          ${projectCards}
        </div>
      </div>
    </div>
  </div>
  <script>
    document.querySelectorAll('time[data-ts]').forEach(el => {
      const d = new Date(el.dataset.ts);
      if (!isNaN(d)) el.textContent = d.toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
      });
      else el.textContent = el.dataset.ts;
    });
  </script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Review page HTML
// ---------------------------------------------------------------------------

function renderReviewPage(
    projectName: string,
    commitHash: string,
    data: ReviewData,
    meta: ReportMeta | null,
    title: string,
): string {
    const ext = data.extension;
    const base = `/projects/${encodeURIComponent(projectName)}`;
    const reportBase = `${base}/reports/${encodeURIComponent(commitHash)}`;

    const failed = data.checkpoints.filter((c) => c.status === 'fail');
    const newCps = data.checkpoints.filter((c) => c.status === 'new');
    const passed = data.checkpoints.filter((c) => c.status === 'pass');
    const errors = data.checkpoints.filter((c) => c.status === 'error');

    function imgUrl(type: 'actual' | 'diff' | 'baseline', cp: ReviewCheckpoint): string {
        const slug = `${cp.checkpoint}-${cp.viewport}`;
        switch (type) {
            case 'actual':
                return `${reportBase}/${slug}-actual${ext}`;
            case 'diff':
                return `${reportBase}/${slug}-diff${ext}`;
            case 'baseline':
                return `${base}/baselines/${slug}${ext}`;
        }
    }

    function renderDiffThumb(cp: ReviewCheckpoint): string {
        const slug = `${cp.checkpoint}-${cp.viewport}`;
        const diffUrl = imgUrl('diff', cp);
        const baselineUrl = imgUrl('baseline', cp);
        const actualUrl = imgUrl('actual', cp);
        const pct = cp.diffPercent !== null ? `${cp.diffPercent.toFixed(2)}%` : '';

        return `
        <div class="rv-thumb" data-cp="${escapeHtml(cp.checkpoint)}" data-vp="${escapeHtml(cp.viewport)}"
             data-status="fail" data-default="${escapeHtml(diffUrl)}" data-slug="${escapeHtml(slug)}">
          <div class="rv-thumb__wrap">
            <img src="${escapeHtml(diffUrl)}" alt="${escapeHtml(slug)}" class="rv-thumb__img" loading="lazy">
            <div class="rv-thumb__overlay">
              <div class="rv-zone rv-zone--diff" data-img="${escapeHtml(diffUrl)}">Diff</div>
              <div class="rv-zone rv-zone--baseline" data-img="${escapeHtml(baselineUrl)}">Baseline</div>
              <div class="rv-zone rv-zone--actual" data-img="${escapeHtml(actualUrl)}">Actual</div>
            </div>
            <button class="rv-accept-btn" data-cp="${escapeHtml(cp.checkpoint)}" data-vp="${escapeHtml(cp.viewport)}">Accept</button>
          </div>
          <div class="rv-thumb__label">
            <span class="rv-thumb__name">${escapeHtml(cp.checkpoint)}</span>
            <span class="rv-thumb__meta">${escapeHtml(cp.viewport)}${pct ? ` &middot; ${pct}` : ''}</span>
          </div>
        </div>`;
    }

    function renderNewThumb(cp: ReviewCheckpoint): string {
        const slug = `${cp.checkpoint}-${cp.viewport}`;
        const actualUrl = imgUrl('actual', cp);

        return `
        <div class="rv-thumb" data-cp="${escapeHtml(cp.checkpoint)}" data-vp="${escapeHtml(cp.viewport)}"
             data-status="new" data-default="${escapeHtml(actualUrl)}" data-slug="${escapeHtml(slug)}">
          <div class="rv-thumb__wrap">
            <img src="${escapeHtml(actualUrl)}" alt="${escapeHtml(slug)}" class="rv-thumb__img" loading="lazy">
            <button class="rv-accept-btn" data-cp="${escapeHtml(cp.checkpoint)}" data-vp="${escapeHtml(cp.viewport)}">Accept</button>
          </div>
          <div class="rv-thumb__label">
            <span class="rv-thumb__name">${escapeHtml(cp.checkpoint)}</span>
            <span class="rv-thumb__meta">${escapeHtml(cp.viewport)} &middot; new</span>
          </div>
        </div>`;
    }

    function renderPassedThumb(cp: ReviewCheckpoint): string {
        const slug = `${cp.checkpoint}-${cp.viewport}`;
        const baselineUrl = imgUrl('baseline', cp);

        return `
        <div class="rv-thumb" data-cp="${escapeHtml(cp.checkpoint)}" data-vp="${escapeHtml(cp.viewport)}"
             data-status="pass" data-default="${escapeHtml(baselineUrl)}" data-slug="${escapeHtml(slug)}">
          <div class="rv-thumb__wrap">
            <img src="${escapeHtml(baselineUrl)}" alt="${escapeHtml(slug)}" class="rv-thumb__img" loading="lazy">
          </div>
          <div class="rv-thumb__label">
            <span class="rv-thumb__name">${escapeHtml(cp.checkpoint)}</span>
            <span class="rv-thumb__meta">${escapeHtml(cp.viewport)}</span>
          </div>
        </div>`;
    }

    const diffThumbs = failed.map((cp) => renderDiffThumb(cp)).join('\n');
    const newThumbs = newCps.map((cp) => renderNewThumb(cp)).join('\n');
    const passedThumbs = passed.map((cp) => renderPassedThumb(cp)).join('\n');

    const hasChanges = failed.length + newCps.length > 0;
    const acceptAllBtn = hasChanges
        ? `<button class="rv-accept-all" id="accept-all-btn">Accept All Changes</button>`
        : '';

    // Determine default active tab
    const defaultTab = failed.length > 0 ? 'diff' : newCps.length > 0 ? 'new' : 'pass';

    // Meta info line
    const metaLine = meta
        ? `<span class="muted text-xs">${formatDuration(meta.duration)} &middot; ${meta.totalCheckpoints} checkpoints</span>`
        : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Review &mdash; ${escapeHtml(projectName)} &mdash; ${escapeHtml(commitHash)}</title>
  <style>
${REVIEW_CSS}
  </style>
</head>
<body>
  <div class="rv">
    <div class="rv__topbar">
      <div class="rv__breadcrumb">
        <a href="/">${escapeHtml(title)}</a>
        <span class="rv__sep">/</span>
        <a href="/">${escapeHtml(projectName)}</a>
        <span class="rv__sep">/</span>
        <span class="rv__current mono">${escapeHtml(commitHash.substring(0, 8))}</span>
      </div>
      ${metaLine}
    </div>

    <div class="rv__layout">
      <div class="rv__sidebar">
        <div class="rv__tabs">
          <button class="rv__tab${defaultTab === 'diff' ? ' active' : ''}" data-tab="diff">
            Differences <span class="rv__tab-count">${failed.length}</span>
          </button>
          <button class="rv__tab${defaultTab === 'new' ? ' active' : ''}" data-tab="new">
            New <span class="rv__tab-count">${newCps.length}</span>
          </button>
          <button class="rv__tab${defaultTab === 'pass' ? ' active' : ''}" data-tab="pass">
            Passed <span class="rv__tab-count">${passed.length}</span>
          </button>
        </div>

        <div class="rv__panels">
          <div class="rv__panel${defaultTab === 'diff' ? '' : ' hidden'}" id="tab-diff">
            ${diffThumbs || '<div class="rv__empty muted text-xs">No differences</div>'}
          </div>
          <div class="rv__panel${defaultTab === 'new' ? '' : ' hidden'}" id="tab-new">
            ${newThumbs || '<div class="rv__empty muted text-xs">No new checkpoints</div>'}
          </div>
          <div class="rv__panel${defaultTab === 'pass' ? '' : ' hidden'}" id="tab-pass">
            ${passedThumbs || '<div class="rv__empty muted text-xs">No passed checkpoints</div>'}
          </div>
        </div>

        <div class="rv__sidebar-footer">
          ${acceptAllBtn}
        </div>
      </div>

      <div class="rv__preview" id="preview">
        <img id="preview-img" src="" alt="" style="display:none">
        <div class="rv__preview-empty" id="preview-empty">
          <span class="muted">Hover a thumbnail to preview</span>
        </div>
        <div class="rv__preview-label" id="preview-label"></div>
      </div>
    </div>
  </div>

  ${errors.length > 0 ? `<!-- ${errors.length} error checkpoint(s) omitted from review -->` : ''}

  <script>
(function() {
  var ACCEPT_URL = '${escapeHtml(reportBase)}/accept';
  var ACCEPT_ALL_URL = '${escapeHtml(reportBase)}/accept-all';
  var previewImg = document.getElementById('preview-img');
  var previewEmpty = document.getElementById('preview-empty');
  var previewLabel = document.getElementById('preview-label');
  var selectedThumb = null;

  // --- Tab switching ---
  var tabs = document.querySelectorAll('.rv__tab');
  var panels = document.querySelectorAll('.rv__panel');
  tabs.forEach(function(tab) {
    tab.addEventListener('click', function() {
      var target = this.dataset.tab;
      tabs.forEach(function(t) { t.classList.toggle('active', t.dataset.tab === target); });
      panels.forEach(function(p) { p.classList.toggle('hidden', p.id !== 'tab-' + target); });
    });
  });

  // --- Preview ---
  function showPreview(url, label) {
    if (!url) return;
    previewImg.src = url;
    previewImg.style.display = '';
    previewEmpty.style.display = 'none';
    if (label) previewLabel.textContent = label;
  }

  // --- Thumbnails ---
  document.querySelectorAll('.rv-thumb').forEach(function(thumb) {
    // Zone hover: switch preview
    thumb.querySelectorAll('.rv-zone').forEach(function(zone) {
      zone.addEventListener('mouseenter', function() {
        var label = this.textContent + ' — ' + thumb.dataset.slug;
        showPreview(this.dataset.img, label);
      });
    });

    // Thumbnail hover: select and show default preview
    thumb.addEventListener('mouseenter', function() {
      if (selectedThumb) selectedThumb.classList.remove('selected');
      selectedThumb = this;
      this.classList.add('selected');
      var statusLabel = this.dataset.status === 'fail' ? 'Diff'
        : this.dataset.status === 'new' ? 'Actual' : 'Baseline';
      showPreview(this.dataset.default, statusLabel + ' — ' + this.dataset.slug);
    });

    // Click to pin
    thumb.addEventListener('click', function(e) {
      if (e.target.closest('.rv-accept-btn')) return;
      if (selectedThumb) selectedThumb.classList.remove('selected');
      selectedThumb = this;
      this.classList.add('selected');
      var statusLabel = this.dataset.status === 'fail' ? 'Diff'
        : this.dataset.status === 'new' ? 'Actual' : 'Baseline';
      showPreview(this.dataset.default, statusLabel + ' — ' + this.dataset.slug);
    });
  });

  // --- Accept single ---
  document.querySelectorAll('.rv-accept-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var thumb = this.closest('.rv-thumb');
      var self = this;
      self.disabled = true;
      self.textContent = '...';
      fetch(ACCEPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkpoint: thumb.dataset.cp, viewport: thumb.dataset.vp })
      }).then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.ok) {
            thumb.classList.add('accepted');
          } else {
            self.textContent = 'Error';
          }
        })
        .catch(function() { self.textContent = 'Error'; });
    });
  });

  // --- Accept all ---
  var acceptAllBtn = document.getElementById('accept-all-btn');
  if (acceptAllBtn) {
    acceptAllBtn.addEventListener('click', function() {
      var self = this;
      self.disabled = true;
      self.textContent = 'Accepting...';
      fetch(ACCEPT_ALL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }).then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.ok) {
            self.textContent = 'All accepted (' + (data.accepted || 0) + ')';
            self.classList.add('rv-accept-all--done');
            document.querySelectorAll('.rv-thumb[data-status="fail"], .rv-thumb[data-status="new"]')
              .forEach(function(t) { t.classList.add('accepted'); });
          } else {
            self.textContent = 'Error';
          }
        })
        .catch(function() { self.textContent = 'Error'; });
    });
  }

  // --- Initial state: select first thumbnail ---
  var first = document.querySelector('#tab-' + '${defaultTab}' + ' .rv-thumb');
  if (first) {
    first.classList.add('selected');
    selectedThumb = first;
    var statusLabel = first.dataset.status === 'fail' ? 'Diff'
      : first.dataset.status === 'new' ? 'Actual' : 'Baseline';
    showPreview(first.dataset.default, statusLabel + ' — ' + first.dataset.slug);
  }
})();
  </script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// CSS constants
// ---------------------------------------------------------------------------

const CSS_TOKENS = `
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

const DASHBOARD_CSS = `
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

const REVIEW_CSS = `
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
  width: 300px; min-width: 300px;
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

.rv__panels { flex: 1; overflow-y: auto; }
.rv__panel { padding: var(--sp-sm); }
.rv__panel.hidden { display: none; }

.rv__empty { padding: var(--sp-lg); text-align: center; }

.rv__sidebar-footer {
  flex-shrink: 0;
  padding: var(--sp-sm);
  border-top: 1px solid var(--c-border);
}

/* --- Thumbnails --- */
.rv-thumb {
  margin-bottom: var(--sp-sm);
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

.rv-thumb__wrap { position: relative; }
.rv-thumb__img { width: 100%; display: block; }

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
  grid-template-rows: 1fr 1fr;
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
  background: var(--c-changed-bg); color: var(--c-changed);
  border: 1px solid rgba(210,153,34,.3); border-radius: var(--r-md);
  cursor: pointer; transition: all .15s;
}
.rv-accept-all:hover { background: rgba(210,153,34,.25); border-color: var(--c-changed); }
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

// ---------------------------------------------------------------------------
// Accept handlers
// ---------------------------------------------------------------------------

function resolveProjectDir(
    configMap: Map<string, ServeProjectConfig>,
    projectName: string,
): { megatestDir: string } | null {
    const projConfig = configMap.get(projectName);
    if (!projConfig) return null;
    return { megatestDir: path.join(path.resolve(projConfig.path), '.megatest') };
}

const SAFE_SLUG = /^[a-zA-Z0-9_-]+$/;

async function handleAccept(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    megatestDir: string,
    commitHash: string,
): Promise<void> {
    try {
        const body = await parseJsonBody(req);
        const cp = body.checkpoint as string;
        const vp = body.viewport as string;

        if (!cp || !vp || !SAFE_SLUG.test(cp) || !SAFE_SLUG.test(vp)) {
            jsonReply(res, 400, { ok: false, error: 'Invalid checkpoint or viewport' });
            return;
        }

        const commitDir = path.join(megatestDir, 'reports', commitHash);
        const reviewData = loadReviewData(megatestDir, commitDir);
        const ext = reviewData?.extension ?? '.png';

        const src = path.join(commitDir, `${cp}-${vp}-actual${ext}`);
        const dest = path.join(megatestDir, 'baselines', `${cp}-${vp}${ext}`);

        // Path traversal protection
        if (!src.startsWith(path.join(megatestDir, 'reports') + path.sep)) {
            jsonReply(res, 403, { ok: false, error: 'Forbidden' });
            return;
        }
        if (!dest.startsWith(path.join(megatestDir, 'baselines') + path.sep)) {
            jsonReply(res, 403, { ok: false, error: 'Forbidden' });
            return;
        }

        if (!fs.existsSync(src)) {
            jsonReply(res, 404, { ok: false, error: 'Actual screenshot not found' });
            return;
        }

        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
        jsonReply(res, 200, { ok: true });
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        jsonReply(res, 400, { ok: false, error: msg });
    }
}

async function handleAcceptAll(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    megatestDir: string,
    commitHash: string,
): Promise<void> {
    try {
        // Consume body even if empty
        await parseJsonBody(req);

        const commitDir = path.join(megatestDir, 'reports', commitHash);
        const reviewData = loadReviewData(megatestDir, commitDir);
        if (!reviewData) {
            jsonReply(res, 404, { ok: false, error: 'No review data found' });
            return;
        }

        const ext = reviewData.extension;
        const baselinesDir = path.join(megatestDir, 'baselines');
        fs.mkdirSync(baselinesDir, { recursive: true });

        let accepted = 0;
        for (const cp of reviewData.checkpoints) {
            if (cp.status !== 'fail' && cp.status !== 'new') continue;
            if (!SAFE_SLUG.test(cp.checkpoint) || !SAFE_SLUG.test(cp.viewport)) continue;
            const slug = `${cp.checkpoint}-${cp.viewport}`;
            const src = path.join(commitDir, `${slug}-actual${ext}`);
            const dest = path.join(baselinesDir, `${slug}${ext}`);

            if (fs.existsSync(src)) {
                fs.copyFileSync(src, dest);
                accepted++;
            }
        }

        jsonReply(res, 200, { ok: true, accepted });
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        jsonReply(res, 400, { ok: false, error: msg });
    }
}

// ---------------------------------------------------------------------------
// Static file server
// ---------------------------------------------------------------------------

function serveFile(res: http.ServerResponse, filePath: string): void {
    try {
        const data = fs.readFileSync(filePath);
        res.writeHead(200, { 'Content-Type': getMimeType(filePath) });
        res.end(data);
    } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    }
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

function createHandler(config: ServeConfig) {
    const configMap = new Map<string, ServeProjectConfig>();
    for (const p of config.projects) {
        configMap.set(p.name, p);
    }

    return (req: http.IncomingMessage, res: http.ServerResponse) => {
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
        const pathname = decodeURIComponent(url.pathname);

        // Dashboard
        if (pathname === '/' || pathname === '') {
            const freshProjects = discoverProjects(config.projects);
            const html = renderDashboard(config.title, freshProjects);
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
            return;
        }

        // Review page: /projects/<name>/reports/<commit>/review
        const reviewMatch = pathname.match(/^\/projects\/([^/]+)\/reports\/([^/]+)\/review$/);
        if (reviewMatch && req.method === 'GET') {
            const projectName = reviewMatch[1];
            const commitHash = reviewMatch[2];
            const proj = resolveProjectDir(configMap, projectName);
            if (!proj) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Project not found');
                return;
            }
            const commitDir = path.join(proj.megatestDir, 'reports', commitHash);
            if (!fs.existsSync(commitDir)) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Report not found');
                return;
            }
            const data = loadReviewData(proj.megatestDir, commitDir);
            if (!data) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('No review data');
                return;
            }
            let meta: ReportMeta | null = null;
            try {
                const metaPath = path.join(commitDir, 'meta.json');
                if (fs.existsSync(metaPath)) {
                    meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as ReportMeta;
                }
            } catch {
                // Ignore
            }
            const html = renderReviewPage(projectName, commitHash, data, meta, config.title);
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
            return;
        }

        // Accept single: POST /projects/<name>/reports/<commit>/accept
        const acceptMatch = pathname.match(/^\/projects\/([^/]+)\/reports\/([^/]+)\/accept$/);
        if (acceptMatch && req.method === 'POST') {
            const proj = resolveProjectDir(configMap, acceptMatch[1]);
            if (!proj) {
                jsonReply(res, 404, { ok: false, error: 'Project not found' });
                return;
            }
            handleAccept(req, res, proj.megatestDir, acceptMatch[2]).catch(() => {});
            return;
        }

        // Accept all: POST /projects/<name>/reports/<commit>/accept-all
        const acceptAllMatch = pathname.match(/^\/projects\/([^/]+)\/reports\/([^/]+)\/accept-all$/);
        if (acceptAllMatch && req.method === 'POST') {
            const proj = resolveProjectDir(configMap, acceptAllMatch[1]);
            if (!proj) {
                jsonReply(res, 404, { ok: false, error: 'Project not found' });
                return;
            }
            handleAcceptAll(req, res, proj.megatestDir, acceptAllMatch[2]).catch(() => {});
            return;
        }

        // Static file serving: /projects/<name>/...
        const match = pathname.match(/^\/projects\/([^/]+)\/(.+)$/);
        if (!match) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
            return;
        }

        const projectName = match[1];
        const relativePath = match[2];
        const projConfig = configMap.get(projectName);

        if (!projConfig) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Project not found');
            return;
        }

        const megatestDir = path.join(path.resolve(projConfig.path), '.megatest');
        const fsPath = path.resolve(megatestDir, relativePath);

        // Path traversal protection
        if (!fsPath.startsWith(megatestDir + path.sep) && fsPath !== megatestDir) {
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            res.end('Forbidden');
            return;
        }

        serveFile(res, fsPath);
    };
}

// ---------------------------------------------------------------------------
// Serve command entry point
// ---------------------------------------------------------------------------

export interface ServeOptions {
    config: string;
    port?: string;
    host?: string;
}

export async function runServe(opts: ServeOptions): Promise<void> {
    const configPath = path.resolve(opts.config);
    const config = loadConfig(configPath);

    // CLI flags override config
    if (opts.port) {
        const parsed = Number.parseInt(opts.port, 10);
        if (Number.isNaN(parsed) || parsed < 1 || parsed > 65535) {
            console.error(`Invalid port: ${opts.port}`);
            process.exit(1);
        }
        config.server.port = parsed;
    }
    if (opts.host) config.server.host = opts.host;

    const projects = discoverProjects(config.projects);

    if (projects.length === 0) {
        console.warn('No projects with reports found. Dashboard will be empty.');
    } else {
        console.log(`Found ${projects.length} project(s):`);
        for (const p of projects) {
            const reports = listReports(p);
            console.log(`  ${p.name}: ${reports.length} report(s) — ${p.repoPath}`);
        }
    }

    const handler = createHandler(config);
    const server = http.createServer(handler);

    const { port, host } = config.server;

    server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`Port ${port} is already in use. Try --port <number>`);
        } else {
            console.error(`Server error: ${err.message}`);
        }
        process.exit(1);
    });

    server.listen(port, host, () => {
        console.log(`\nMegatest report server running at http://${host}:${port}/`);
    });
}
