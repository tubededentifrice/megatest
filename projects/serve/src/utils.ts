import type * as http from 'node:http';
import * as path from 'node:path';

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

export function getMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    return MIME_TYPES[ext] ?? 'application/octet-stream';
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export function escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function formatDuration(ms: number): string {
    const sec = ms / 1000;
    if (sec < 60) return `${sec.toFixed(1)}s`;
    const min = Math.floor(sec / 60);
    const remSec = (sec % 60).toFixed(0);
    return `${min}m ${remSec}s`;
}

export function timeTag(dateStr: string): string {
    return `<time data-ts="${escapeHtml(dateStr)}"></time>`;
}

export function jsonReply(res: http.ServerResponse, status: number, data: Record<string, unknown>): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

export function parseJsonBody(req: http.IncomingMessage, maxBytes = 10240): Promise<Record<string, unknown>> {
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
