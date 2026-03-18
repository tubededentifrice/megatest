import * as fs from 'node:fs';
import type * as http from 'node:http';
import * as path from 'node:path';
import { loadReviewData } from './discovery.js';
import type { ServeProjectConfig } from './types.js';
import { jsonReply, parseJsonBody } from './utils.js';

export function resolveProjectDir(
    configMap: Map<string, ServeProjectConfig>,
    projectName: string,
): { megatestDir: string } | null {
    const projConfig = configMap.get(projectName);
    if (!projConfig) return null;
    return { megatestDir: path.join(path.resolve(projConfig.path), '.megatest') };
}

const SAFE_SLUG = /^[a-zA-Z0-9_-]+$/;

export async function handleAccept(
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

        // Update results.json so refreshes reflect the acceptance
        if (reviewData) {
            const match = reviewData.checkpoints.find((c) => c.checkpoint === cp && c.viewport === vp);
            if (match) {
                match.status = 'pass';
                const resultsPath = path.join(commitDir, 'results.json');
                fs.writeFileSync(resultsPath, JSON.stringify(reviewData, null, 2));
            }
        }

        jsonReply(res, 200, { ok: true });
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        jsonReply(res, 400, { ok: false, error: msg });
    }
}

export async function handleAcceptAll(
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
                cp.status = 'pass';
                accepted++;
            }
        }

        // Persist updated statuses so refreshes reflect the acceptance
        const resultsPath = path.join(commitDir, 'results.json');
        fs.writeFileSync(resultsPath, JSON.stringify(reviewData, null, 2));

        jsonReply(res, 200, { ok: true, accepted });
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        jsonReply(res, 400, { ok: false, error: msg });
    }
}
