import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReportMeta } from '@megatest/core';
import { Hono } from 'hono';
import { discoverProjects, loadReviewData } from './discovery.js';
import { handleAccept, handleAcceptAll, resolveProjectDir } from './handlers.js';
import type { ServeConfig, ServeProjectConfig } from './types.js';
import { getMimeType } from './utils.js';
import { renderDashboard } from './views/dashboard.js';
import { renderReviewPage } from './views/review.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const staticDistDir = path.resolve(__dirname, '..', 'static', 'dist');
const staticSrcDir = path.resolve(__dirname, '..', 'static', 'src');

export function createApp(config: ServeConfig): Hono {
    const app = new Hono();

    app.onError((err, c) => {
        console.error('Handler error:', err);
        return c.text('Internal Server Error', 500);
    });

    const configMap = new Map<string, ServeProjectConfig>();
    for (const p of config.projects) configMap.set(p.name, p);

    // --- Static assets from /static/ ---
    app.get('/static/*', async (c) => {
        const rel = c.req.path.replace(/^\/static\//, '');

        // Try dist/ first (hashed, production build)
        const distPath = path.resolve(staticDistDir, rel);
        if (distPath.startsWith(staticDistDir + path.sep)) {
            try {
                const content = await fs.promises.readFile(distPath);
                c.header('Content-Type', getMimeType(distPath));
                c.header('Cache-Control', 'public, max-age=31536000, immutable');
                return c.body(content);
            } catch {
                // fall through to src/
            }
        }

        // Fallback to src/ (unprocessed, dev convenience)
        const srcPath = path.resolve(staticSrcDir, rel);
        if (!srcPath.startsWith(staticSrcDir + path.sep)) return c.text('Forbidden', 403);
        try {
            const content = await fs.promises.readFile(srcPath);
            c.header('Content-Type', getMimeType(srcPath));
            c.header('Cache-Control', 'public, max-age=5');
            return c.body(content);
        } catch {
            return c.text('Not Found', 404);
        }
    });

    // --- Dashboard ---
    app.get('/', (c) => {
        const freshProjects = discoverProjects(config.projects);
        return c.html(renderDashboard(config.title, freshProjects));
    });

    // --- Review page ---
    app.get('/projects/:name/reports/:hash/review', (c) => {
        const projectName = c.req.param('name');
        const commitHash = c.req.param('hash');
        const proj = resolveProjectDir(configMap, projectName);
        if (!proj) return c.text('Project not found', 404);

        const commitDir = path.join(proj.megatestDir, 'reports', commitHash);
        if (!fs.existsSync(commitDir)) return c.text('Report not found', 404);

        const data = loadReviewData(proj.megatestDir, commitDir);
        if (!data) return c.text('No review data', 404);

        let meta: ReportMeta | null = null;
        try {
            const metaPath = path.join(commitDir, 'meta.json');
            if (fs.existsSync(metaPath)) meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as ReportMeta;
        } catch {
            /* ignore */
        }

        return c.html(renderReviewPage(projectName, commitHash, data, meta, config.title));
    });

    // --- Accept single ---
    app.post('/projects/:name/reports/:hash/accept', async (c) => {
        const proj = resolveProjectDir(configMap, c.req.param('name'));
        if (!proj) return c.json({ ok: false, error: 'Project not found' }, 404);
        return handleAccept(c, proj.megatestDir, c.req.param('hash'));
    });

    // --- Accept all ---
    app.post('/projects/:name/reports/:hash/accept-all', async (c) => {
        const proj = resolveProjectDir(configMap, c.req.param('name'));
        if (!proj) return c.json({ ok: false, error: 'Project not found' }, 404);
        return handleAcceptAll(c, proj.megatestDir, c.req.param('hash'));
    });

    // --- Project static files (screenshots from .megatest/ dirs) ---
    app.get('/projects/:name/*', async (c) => {
        const projectName = c.req.param('name');
        const relativePath = c.req.path.replace(`/projects/${projectName}/`, '');
        const projConfig = configMap.get(projectName);
        if (!projConfig) return c.text('Project not found', 404);

        const megatestDir = path.join(path.resolve(projConfig.path), '.megatest');
        const fsPath = path.resolve(megatestDir, relativePath);
        if (!fsPath.startsWith(megatestDir + path.sep) && fsPath !== megatestDir) return c.text('Forbidden', 403);

        try {
            const stat = await fs.promises.stat(fsPath);
            if (!stat.isFile()) return c.text('Not Found', 404);
            const content = await fs.promises.readFile(fsPath);
            c.header('Content-Type', getMimeType(fsPath));
            c.header('Content-Length', String(stat.size));
            c.header('Cache-Control', 'public, max-age=300, immutable');
            return c.body(content);
        } catch {
            return c.text('Not Found', 404);
        }
    });

    return app;
}
