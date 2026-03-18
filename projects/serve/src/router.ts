import * as fs from 'node:fs';
import type * as http from 'node:http';
import * as path from 'node:path';
import type { ReportMeta } from '@megatest/core';
import { discoverProjects, loadReviewData } from './discovery.js';
import { handleAccept, handleAcceptAll, resolveProjectDir } from './handlers.js';
import type { ServeConfig, ServeProjectConfig } from './types.js';
import { getMimeType, jsonReply } from './utils.js';
import { renderDashboard } from './views/dashboard.js';
import { renderReviewPage } from './views/review.js';

function serveFile(res: http.ServerResponse, filePath: string): void {
    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
            return;
        }

        res.writeHead(200, {
            'Content-Type': getMimeType(filePath),
            'Content-Length': stats.size,
            'Cache-Control': 'public, max-age=300, immutable',
        });

        const stream = fs.createReadStream(filePath);
        stream.on('error', () => {
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
            }
            res.end();
        });
        stream.pipe(res);
    });
}

export function createHandler(config: ServeConfig) {
    const configMap = new Map<string, ServeProjectConfig>();
    for (const p of config.projects) {
        configMap.set(p.name, p);
    }

    return (req: http.IncomingMessage, res: http.ServerResponse) => {
        try {
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
        } catch (err) {
            console.error('Handler error:', err);
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
            }
            res.end('Internal Server Error');
        }
    };
}
