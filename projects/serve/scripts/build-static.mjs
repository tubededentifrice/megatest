import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { transform } from 'esbuild';

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '..');
const srcDir = join(root, 'static', 'src');
const distDir = join(root, 'static', 'dist');

// Sources to process (relative to srcDir)
const sources = [
    'css/tokens.css',
    'css/dashboard.css',
    'css/review.css',
    'js/dashboard.js',
    'js/review.js',
];

// htmx from npm — already minified, just hash it
const htmxSrc = resolve(dirname(require.resolve('htmx.org')), 'htmx.min.js');

function hash(content) {
    return createHash('sha256').update(content).digest('hex').slice(0, 8);
}

function hashedName(relPath, contentHash) {
    const ext = extname(relPath);
    const base = basename(relPath, ext);
    const dir = dirname(relPath);
    return join(dir, `${base}.${contentHash}${ext}`);
}

async function build() {
    // Clean
    rmSync(distDir, { recursive: true, force: true });
    mkdirSync(join(distDir, 'css'), { recursive: true });
    mkdirSync(join(distDir, 'js'), { recursive: true });

    const manifest = {};

    // Process our source files
    for (const rel of sources) {
        const src = readFileSync(join(srcDir, rel), 'utf-8');
        const loader = rel.endsWith('.css') ? 'css' : 'js';
        const result = await transform(src, { minify: true, loader });
        const content = Buffer.from(result.code);
        const h = hash(content);
        const out = hashedName(rel, h);
        writeFileSync(join(distDir, out), content);
        manifest[rel] = out;
    }

    // htmx — already minified
    const htmxContent = readFileSync(htmxSrc);
    const htmxHash = hash(htmxContent);
    const htmxOut = hashedName('js/htmx.min.js', htmxHash);
    writeFileSync(join(distDir, htmxOut), htmxContent);
    manifest['js/htmx.min.js'] = htmxOut;

    // Write manifest
    writeFileSync(join(distDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

    console.log('Static build complete:');
    for (const [src, out] of Object.entries(manifest)) {
        console.log(`  ${src} → ${out}`);
    }
}

build().catch((err) => {
    console.error(err);
    process.exit(1);
});
