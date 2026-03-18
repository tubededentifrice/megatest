import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleAccept, handleAcceptAll, resolveProjectDir } from '../src/handlers.js';
import type { ServeProjectConfig } from '../src/types.js';

describe('resolveProjectDir', () => {
    it('returns megatestDir for a known project', () => {
        const configMap = new Map<string, ServeProjectConfig>();
        configMap.set('my-app', { name: 'my-app', path: '/home/user/my-app' });

        const result = resolveProjectDir(configMap, 'my-app');
        expect(result).not.toBeNull();
        expect(result?.megatestDir).toBe('/home/user/my-app/.megatest');
    });

    it('returns null for an unknown project', () => {
        const configMap = new Map<string, ServeProjectConfig>();
        configMap.set('my-app', { name: 'my-app', path: '/home/user/my-app' });

        const result = resolveProjectDir(configMap, 'nonexistent');
        expect(result).toBeNull();
    });

    it('returns null for an empty config map', () => {
        const configMap = new Map<string, ServeProjectConfig>();
        const result = resolveProjectDir(configMap, 'anything');
        expect(result).toBeNull();
    });
});

describe('handleAccept', () => {
    let tmpDir: string;
    let megatestDir: string;
    let commitDir: string;
    let app: Hono;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'megatest-handler-'));
        megatestDir = path.join(tmpDir, '.megatest');
        commitDir = path.join(megatestDir, 'reports', 'abc123');
        fs.mkdirSync(commitDir, { recursive: true });
        fs.mkdirSync(path.join(megatestDir, 'baselines'), { recursive: true });

        // Create results.json so loadReviewData works
        const reviewData = {
            extension: '.png',
            checkpoints: [
                {
                    workflow: 'default',
                    checkpoint: 'hero',
                    viewport: 'desktop',
                    status: 'fail',
                    diffPercent: 1.5,
                    diffPixels: 100,
                    error: null,
                },
                {
                    workflow: 'default',
                    checkpoint: 'footer',
                    viewport: 'mobile',
                    status: 'new',
                    diffPercent: null,
                    diffPixels: null,
                    error: null,
                },
            ],
        };
        fs.writeFileSync(path.join(commitDir, 'results.json'), JSON.stringify(reviewData));

        // Create actual screenshot
        fs.writeFileSync(path.join(commitDir, 'hero-desktop-actual.png'), 'fake-png-data');
        fs.writeFileSync(path.join(commitDir, 'footer-mobile-actual.png'), 'fake-new-data');

        // Build a Hono app that uses the handler
        app = new Hono();
        const capturedMegatestDir = megatestDir;
        app.post('/accept', async (c) => {
            return handleAccept(c, capturedMegatestDir, 'abc123');
        });
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('copies actual to baselines on valid request', async () => {
        const res = await app.request('/accept', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ checkpoint: 'hero', viewport: 'desktop' }),
        });

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.ok).toBe(true);

        // Check that the file was copied
        const destPath = path.join(megatestDir, 'baselines', 'hero-desktop.png');
        expect(fs.existsSync(destPath)).toBe(true);
        expect(fs.readFileSync(destPath, 'utf-8')).toBe('fake-png-data');
    });

    it('updates results.json status to pass after accept', async () => {
        await app.request('/accept', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ checkpoint: 'hero', viewport: 'desktop' }),
        });

        const updatedData = JSON.parse(fs.readFileSync(path.join(commitDir, 'results.json'), 'utf-8'));
        const cp = updatedData.checkpoints.find(
            (c: { checkpoint: string; viewport: string }) => c.checkpoint === 'hero' && c.viewport === 'desktop',
        );
        expect(cp.status).toBe('pass');
    });

    it('returns 400 for missing checkpoint or viewport', async () => {
        const res = await app.request('/accept', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ checkpoint: 'hero' }),
        });

        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.ok).toBe(false);
    });

    it('returns 400 for invalid slug characters (path traversal attempt)', async () => {
        const res = await app.request('/accept', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                checkpoint: '../../../etc/passwd',
                viewport: 'desktop',
            }),
        });

        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.ok).toBe(false);
        expect(json.error).toContain('Invalid');
    });

    it('returns 400 for empty checkpoint', async () => {
        const res = await app.request('/accept', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ checkpoint: '', viewport: 'desktop' }),
        });

        expect(res.status).toBe(400);
    });

    it('returns 404 when actual file does not exist', async () => {
        const res = await app.request('/accept', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                checkpoint: 'nonexistent',
                viewport: 'desktop',
            }),
        });

        expect(res.status).toBe(404);
        const json = await res.json();
        expect(json.error).toContain('not found');
    });

    it('returns htmx HTML fragment when HX-Request header is present', async () => {
        const res = await app.request('/accept', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'HX-Request': 'true',
            },
            body: JSON.stringify({ checkpoint: 'hero', viewport: 'desktop' }),
        });

        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain('rv-thumb accepted');
        expect(html).toContain('data-status="pass"');
        expect(html).toContain('data-slug="hero-desktop"');
    });

    it('returns 400 for malformed JSON body', async () => {
        const res = await app.request('/accept', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{invalid json',
        });

        expect(res.status).toBe(400);
    });
});

describe('handleAcceptAll', () => {
    let tmpDir: string;
    let megatestDir: string;
    let commitDir: string;
    let app: Hono;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'megatest-handler-'));
        megatestDir = path.join(tmpDir, '.megatest');
        commitDir = path.join(megatestDir, 'reports', 'abc123');
        fs.mkdirSync(commitDir, { recursive: true });
        fs.mkdirSync(path.join(megatestDir, 'baselines'), { recursive: true });

        const reviewData = {
            extension: '.png',
            checkpoints: [
                {
                    workflow: 'default',
                    checkpoint: 'hero',
                    viewport: 'desktop',
                    status: 'fail',
                    diffPercent: 1.5,
                    diffPixels: 100,
                    error: null,
                },
                {
                    workflow: 'default',
                    checkpoint: 'nav',
                    viewport: 'mobile',
                    status: 'new',
                    diffPercent: null,
                    diffPixels: null,
                    error: null,
                },
                {
                    workflow: 'default',
                    checkpoint: 'footer',
                    viewport: 'desktop',
                    status: 'pass',
                    diffPercent: null,
                    diffPixels: null,
                    error: null,
                },
            ],
        };
        fs.writeFileSync(path.join(commitDir, 'results.json'), JSON.stringify(reviewData));

        // Create actual screenshots for fail and new
        fs.writeFileSync(path.join(commitDir, 'hero-desktop-actual.png'), 'hero-data');
        fs.writeFileSync(path.join(commitDir, 'nav-mobile-actual.png'), 'nav-data');

        app = new Hono();
        const capturedMegatestDir = megatestDir;
        app.post('/accept-all', async (c) => {
            return handleAcceptAll(c, capturedMegatestDir, 'abc123');
        });
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('accepts all fail and new checkpoints', async () => {
        const res = await app.request('/accept-all', {
            method: 'POST',
        });

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.ok).toBe(true);
        expect(json.accepted).toBe(2);

        // Check baselines were created
        expect(fs.existsSync(path.join(megatestDir, 'baselines', 'hero-desktop.png'))).toBe(true);
        expect(fs.existsSync(path.join(megatestDir, 'baselines', 'nav-mobile.png'))).toBe(true);
        expect(fs.readFileSync(path.join(megatestDir, 'baselines', 'hero-desktop.png'), 'utf-8')).toBe('hero-data');
    });

    it('does not accept already-passed checkpoints', async () => {
        const res = await app.request('/accept-all', {
            method: 'POST',
        });

        const json = await res.json();
        // Only 2 accepted (fail + new), not the pass
        expect(json.accepted).toBe(2);
    });

    it('updates results.json with all statuses set to pass', async () => {
        await app.request('/accept-all', { method: 'POST' });

        const updatedData = JSON.parse(fs.readFileSync(path.join(commitDir, 'results.json'), 'utf-8'));
        for (const cp of updatedData.checkpoints) {
            expect(cp.status).toBe('pass');
        }
    });

    it('returns 404 when no review data exists', async () => {
        // Use a commit hash whose directory does not exist at all,
        // so loadReviewData returns null (readdirSync fails)
        const noDataApp = new Hono();
        const capturedMegatestDir = megatestDir;
        noDataApp.post('/accept-all', async (c) => {
            return handleAcceptAll(c, capturedMegatestDir, 'nonexistent');
        });

        const res = await noDataApp.request('/accept-all', { method: 'POST' });
        expect(res.status).toBe(404);
    });

    it('returns htmx HTML fragment with HX-Trigger header when HX-Request is set', async () => {
        const res = await app.request('/accept-all', {
            method: 'POST',
            headers: { 'HX-Request': 'true' },
        });

        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain('All accepted (2)');
        expect(html).toContain('rv-accept-all--done');

        const trigger = res.headers.get('HX-Trigger');
        expect(trigger).not.toBeNull();
        const parsed = JSON.parse(trigger!);
        expect(parsed.acceptedAll.count).toBe(2);
    });

    it('creates baselines directory if it does not exist', async () => {
        // Remove the baselines directory
        fs.rmSync(path.join(megatestDir, 'baselines'), { recursive: true });

        const res = await app.request('/accept-all', { method: 'POST' });
        expect(res.status).toBe(200);

        // Baselines directory should have been created
        expect(fs.existsSync(path.join(megatestDir, 'baselines'))).toBe(true);
    });
});
