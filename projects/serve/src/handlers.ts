import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Context } from 'hono';
import { loadReviewData } from './discovery.js';
import type { ServeProjectConfig } from './types.js';
import { escapeHtml } from './utils.js';

export function resolveProjectDir(
    configMap: Map<string, ServeProjectConfig>,
    projectName: string,
): { megatestDir: string } | null {
    const projConfig = configMap.get(projectName);
    if (!projConfig) return null;
    return { megatestDir: path.join(path.resolve(projConfig.path), '.megatest') };
}

const SAFE_SLUG = /^[a-zA-Z0-9_-]+$/;

export async function handleAccept(c: Context, megatestDir: string, commitHash: string): Promise<Response> {
    try {
        const body = await c.req.json();
        const cp = body.checkpoint as string;
        const vp = body.viewport as string;

        if (!cp || !vp || !SAFE_SLUG.test(cp) || !SAFE_SLUG.test(vp)) {
            return c.json({ ok: false, error: 'Invalid checkpoint or viewport' }, 400);
        }

        const commitDir = path.join(megatestDir, 'reports', commitHash);
        const reviewData = loadReviewData(megatestDir, commitDir);
        const ext = reviewData?.extension ?? '.png';

        const src = path.join(commitDir, `${cp}-${vp}-actual${ext}`);
        const dest = path.join(megatestDir, 'baselines', `${cp}-${vp}${ext}`);

        // Path traversal protection
        if (!src.startsWith(path.join(megatestDir, 'reports') + path.sep)) {
            return c.json({ ok: false, error: 'Forbidden' }, 403);
        }
        if (!dest.startsWith(path.join(megatestDir, 'baselines') + path.sep)) {
            return c.json({ ok: false, error: 'Forbidden' }, 403);
        }

        if (!fs.existsSync(src)) {
            return c.json({ ok: false, error: 'Actual screenshot not found' }, 404);
        }

        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);

        // Update results.json so refreshes reflect the acceptance
        if (reviewData) {
            const match = reviewData.checkpoints.find((ch) => ch.checkpoint === cp && ch.viewport === vp);
            if (match) {
                match.status = 'pass';
                const resultsPath = path.join(commitDir, 'results.json');
                fs.writeFileSync(resultsPath, JSON.stringify(reviewData, null, 2));
            }
        }

        // htmx: return accepted thumbnail fragment
        if (c.req.header('HX-Request')) {
            const slug = `${cp}-${vp}`;
            return c.html(
                `<div class="rv-thumb accepted" data-cp="${escapeHtml(cp)}" data-vp="${escapeHtml(vp)}"
             data-status="pass" data-slug="${escapeHtml(slug)}">
          <div class="rv-thumb__wrap">
            <img src="" alt="${escapeHtml(slug)}" class="rv-thumb__img" loading="lazy">
          </div>
          <div class="rv-thumb__label">
            <span class="rv-thumb__name">${escapeHtml(cp)}</span>
            <span class="rv-thumb__meta">${escapeHtml(vp)}</span>
          </div>
        </div>`,
            );
        }

        return c.json({ ok: true });
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return c.json({ ok: false, error: msg }, 400);
    }
}

export async function handleAcceptAll(c: Context, megatestDir: string, commitHash: string): Promise<Response> {
    try {
        const commitDir = path.join(megatestDir, 'reports', commitHash);
        const reviewData = loadReviewData(megatestDir, commitDir);
        if (!reviewData) {
            return c.json({ ok: false, error: 'No review data found' }, 404);
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
                cp.status = 'pass';
                accepted++;
            }
        }

        // Persist updated statuses so refreshes reflect the acceptance
        const resultsPath = path.join(commitDir, 'results.json');
        fs.writeFileSync(resultsPath, JSON.stringify(reviewData, null, 2));

        // htmx: return done button + trigger event to mark all thumbs
        if (c.req.header('HX-Request')) {
            c.header('HX-Trigger', JSON.stringify({ acceptedAll: { count: accepted } }));
            return c.html(
                `<button class="rv-accept-all rv-accept-all--done" disabled>All accepted (${accepted})</button>`,
            );
        }

        return c.json({ ok: true, accepted });
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return c.json({ ok: false, error: msg }, 400);
    }
}
