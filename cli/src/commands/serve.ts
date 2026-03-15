import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import type { ReportMeta, ServeConfig, ServeProjectConfig } from '../types.js';

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
      reportUrl: `/projects/${encodeURIComponent(project.name)}/reports/${encodeURIComponent(dirName)}/index.html`,
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
// Dashboard HTML
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
// Dashboard CSS (reuses design tokens from report CSS)
// ---------------------------------------------------------------------------

const DASHBOARD_CSS = `
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

.stack { display: flex; flex-direction: column; }
.gap-lg { gap: var(--sp-lg); }
.muted { color: var(--c-muted); }
.mono { font-family: var(--ff-mono); }
.text-sm { font-size: var(--fs-sm); }
.text-xs { font-size: var(--fs-xs); }
.ml-auto { margin-left: auto; }
`;

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
  // Build project lookup from config (not discovery) so it includes all configured projects
  const configMap = new Map<string, ServeProjectConfig>();
  for (const p of config.projects) {
    configMap.set(p.name, p);
  }

  return (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);

    // Dashboard
    if (pathname === '/' || pathname === '') {
      // Re-discover on each request so new reports appear on refresh
      const freshProjects = discoverProjects(config.projects);
      const html = renderDashboard(config.title, freshProjects);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
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

    // Map to filesystem: /projects/<name>/X → <repo>/.megatest/X
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
