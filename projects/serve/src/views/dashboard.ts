import type { ReportMeta } from '@megatest/core';
import { listReports } from '../discovery.js';
import type { DiscoveredProject, ReportEntry } from '../types.js';
import { escapeHtml, formatDuration, timeTag } from '../utils.js';
import { DASHBOARD_CSS } from './styles.js';

export function renderBadges(meta: ReportMeta): string {
    const parts: string[] = [];
    if (meta.passed > 0) parts.push(`<span class="badge badge--pass">${meta.passed} passed</span>`);
    if (meta.failed > 0) parts.push(`<span class="badge badge--changed">${meta.failed} changed</span>`);
    if (meta.newCount > 0) parts.push(`<span class="badge badge--new">${meta.newCount} new</span>`);
    if (meta.errors > 0) parts.push(`<span class="badge badge--fail">${meta.errors} failed</span>`);
    return parts.join(' ');
}

export function renderLatestReport(report: ReportEntry): string {
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

export function renderOlderReport(report: ReportEntry): string {
    const dateStr = report.meta ? timeTag(report.meta.timestamp) : timeTag(report.mtime.toISOString());
    const badges = report.meta ? renderBadges(report.meta) : '';

    return `
    <a href="${escapeHtml(report.reportUrl)}" class="report-row">
      <span class="mono">${escapeHtml(report.commitHash)}</span>
      <span class="muted text-sm">${dateStr}</span>
      <span class="report-row__badges">${badges}</span>
    </a>`;
}

export function renderDashboard(title: string, projects: DiscoveredProject[]): string {
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
