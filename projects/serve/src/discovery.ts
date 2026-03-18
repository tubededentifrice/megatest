import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ReportMeta, ReviewCheckpoint } from '@megatest/core';
import type { DiscoveredProject, ReportEntry, ReviewData, ServeProjectConfig } from './types.js';

// ---------------------------------------------------------------------------
// Project discovery
// ---------------------------------------------------------------------------

export function discoverProjects(projects: ServeProjectConfig[]): DiscoveredProject[] {
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

export function listReports(project: DiscoveredProject): ReportEntry[] {
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

export function loadReviewData(megatestDir: string, commitDir: string): ReviewData | null {
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
