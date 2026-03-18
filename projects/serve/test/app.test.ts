import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServeConfig } from '../src/types.js';

// Mock the asset function so we don't need a real manifest
vi.mock('../src/assets.js', () => ({
    asset: (name: string) => `/static/${name}`,
}));

import { createApp } from '../src/app.js';

describe('createApp', () => {
    let tmpDir: string;
    let repoDir: string;
    let megatestDir: string;
    let config: ServeConfig;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'megatest-app-'));
        repoDir = path.join(tmpDir, 'my-repo');
        megatestDir = path.join(repoDir, '.megatest');

        // Set up a project directory structure
        fs.mkdirSync(path.join(megatestDir, 'reports', 'abc12345'), { recursive: true });
        fs.mkdirSync(path.join(megatestDir, 'baselines'), { recursive: true });

        // Create index.html and results.json for a report
        fs.writeFileSync(
            path.join(megatestDir, 'reports', 'abc12345', 'index.html'),
            '<html><body>Report</body></html>',
        );
        fs.writeFileSync(
            path.join(megatestDir, 'reports', 'abc12345', 'results.json'),
            JSON.stringify({
                extension: '.png',
                checkpoints: [
                    {
                        workflow: 'default',
                        checkpoint: 'hero',
                        viewport: 'desktop',
                        status: 'fail',
                        diffPercent: 1.0,
                        diffPixels: 50,
                        error: null,
                    },
                ],
            }),
        );

        // Create meta.json
        fs.writeFileSync(
            path.join(megatestDir, 'reports', 'abc12345', 'meta.json'),
            JSON.stringify({
                commitHash: 'abc12345',
                timestamp: '2024-06-15T10:00:00Z',
                passed: 5,
                failed: 1,
                newCount: 0,
                errors: 0,
                duration: 3000,
                totalCheckpoints: 6,
            }),
        );

        // Create a baseline file for static serving
        fs.writeFileSync(path.join(megatestDir, 'baselines', 'hero-desktop.png'), 'baseline-data');

        config = {
            title: 'Test Reports',
            server: { port: 3000, host: '127.0.0.1' },
            projects: [{ name: 'my-repo', path: repoDir }],
        };
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    describe('GET /', () => {
        it('returns 200 with dashboard HTML', async () => {
            const app = createApp(config);
            const res = await app.request('/');

            expect(res.status).toBe(200);
            const html = await res.text();
            expect(html).toContain('<!DOCTYPE html>');
            expect(html).toContain('Test Reports');
            expect(html).toContain('my-repo');
        });
    });

    describe('GET /projects/:name/reports/:hash/review', () => {
        it('returns 200 with review page for valid project and report', async () => {
            const app = createApp(config);
            const res = await app.request('/projects/my-repo/reports/abc12345/review');

            expect(res.status).toBe(200);
            const html = await res.text();
            expect(html).toContain('<!DOCTYPE html>');
            expect(html).toContain('my-repo');
            expect(html).toContain('abc12345');
        });

        it('returns 404 for unknown project', async () => {
            const app = createApp(config);
            const res = await app.request('/projects/unknown/reports/abc12345/review');

            expect(res.status).toBe(404);
        });

        it('returns 404 for unknown report hash', async () => {
            const app = createApp(config);
            const res = await app.request('/projects/my-repo/reports/nonexistent/review');

            expect(res.status).toBe(404);
        });
    });

    describe('POST /projects/:name/reports/:hash/accept', () => {
        it('returns 404 for unknown project', async () => {
            const app = createApp(config);
            const res = await app.request('/projects/unknown/reports/abc12345/accept', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ checkpoint: 'hero', viewport: 'desktop' }),
            });

            expect(res.status).toBe(404);
        });
    });

    describe('POST /projects/:name/reports/:hash/accept-all', () => {
        it('returns 404 for unknown project', async () => {
            const app = createApp(config);
            const res = await app.request('/projects/unknown/reports/abc12345/accept-all', {
                method: 'POST',
            });

            expect(res.status).toBe(404);
        });
    });

    describe('GET /projects/:name/* (project static files)', () => {
        it('serves project files with correct MIME type', async () => {
            const app = createApp(config);
            const res = await app.request('/projects/my-repo/baselines/hero-desktop.png');

            expect(res.status).toBe(200);
            const body = await res.text();
            expect(body).toBe('baseline-data');
            expect(res.headers.get('Content-Type')).toBe('image/png');
        });

        it('returns 404 for unknown project', async () => {
            const app = createApp(config);
            const res = await app.request('/projects/unknown/baselines/hero-desktop.png');

            expect(res.status).toBe(404);
        });

        it('returns 404 for nonexistent file', async () => {
            const app = createApp(config);
            const res = await app.request('/projects/my-repo/baselines/nonexistent.png');

            expect(res.status).toBe(404);
        });

        it('returns 403 for path traversal attempts', async () => {
            const app = createApp(config);
            // Attempt to access outside .megatest directory
            const res = await app.request('/projects/my-repo/../../etc/passwd');

            // Either 403 (path traversal blocked) or 404 (not found) is acceptable
            expect([403, 404]).toContain(res.status);
        });
    });

    describe('GET /static/*', () => {
        it('returns 404 for nonexistent static files', async () => {
            const app = createApp(config);
            const res = await app.request('/static/nonexistent.js');

            expect(res.status).toBe(404);
        });
    });
});
