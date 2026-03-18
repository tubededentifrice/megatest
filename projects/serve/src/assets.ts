import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.resolve(__dirname, '..', 'static', 'dist', 'manifest.json');

let manifest: Record<string, string> | null = null;

try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, string>;
} catch {
    console.warn('[megatest-serve] static/dist/manifest.json not found — serving unprocessed assets');
}

/** Resolve a static asset name to its cache-busted path. */
export function asset(name: string): string {
    if (manifest) {
        const hashed = manifest[name];
        if (hashed) return `/static/${hashed}`;
    }
    return `/static/${name}`;
}
