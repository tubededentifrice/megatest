#!/usr/bin/env node
/**
 * Generate a synthetic test report for the megatest serve UI demo.
 * Creates PNG images and metadata files in .megatest/
 *
 * Produces:
 * - 4 passed checkpoints (baseline only)
 * - 3 failed/changed checkpoints (baseline + actual + diff)
 * - 2 new checkpoints (actual only)
 */

const { PNG } = require('pngjs');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MEGATEST = path.join(ROOT, '.megatest');
const BASELINES = path.join(MEGATEST, 'baselines');
const REPORT_DIR = path.join(MEGATEST, 'reports', 'demo-report');

// Ensure dirs exist
for (const d of [BASELINES, REPORT_DIR]) {
    fs.mkdirSync(d, { recursive: true });
}

// --- PNG generation helpers ---

function createPng(width, height, fillFn) {
    const png = new PNG({ width, height });
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) << 2;
            const [r, g, b, a] = fillFn(x, y, width, height);
            png.data[idx] = r;
            png.data[idx + 1] = g;
            png.data[idx + 2] = b;
            png.data[idx + 3] = a;
        }
    }
    return PNG.sync.write(png);
}

function solidColor(r, g, b) {
    return () => [r, g, b, 255];
}

function gradient(r1, g1, b1, r2, g2, b2) {
    return (_x, y, _w, h) => {
        const t = y / h;
        return [
            Math.round(r1 + (r2 - r1) * t),
            Math.round(g1 + (g2 - g1) * t),
            Math.round(b1 + (b2 - b1) * t),
            255,
        ];
    };
}

function checkerboard(size, r1, g1, b1, r2, g2, b2) {
    return (x, y) => {
        const cx = Math.floor(x / size);
        const cy = Math.floor(y / size);
        return (cx + cy) % 2 === 0 ? [r1, g1, b1, 255] : [r2, g2, b2, 255];
    };
}

function stripes(size, r1, g1, b1, r2, g2, b2) {
    return (_x, y) => {
        return Math.floor(y / size) % 2 === 0 ? [r1, g1, b1, 255] : [r2, g2, b2, 255];
    };
}

function withBanner(baseFn, bannerY, bannerH, br, bg, bb) {
    return (x, y, w, h) => {
        if (y >= bannerY && y < bannerY + bannerH) {
            return [br, bg, bb, 255];
        }
        return baseFn(x, y, w, h);
    };
}

// Diff image: highlight changed areas in magenta on a dark background
function diffImage(baselineFn, actualFn) {
    return (x, y, w, h) => {
        const [r1, g1, b1] = baselineFn(x, y, w, h);
        const [r2, g2, b2] = actualFn(x, y, w, h);
        if (r1 !== r2 || g1 !== g2 || b1 !== b2) {
            return [255, 0, 255, 255]; // magenta for diff
        }
        return [30, 30, 30, 255]; // dark gray for unchanged
    };
}

const W = 1280;
const H = 720;
const MW = 375;
const MH = 812;

// --- Checkpoint definitions ---

// PASSED checkpoints (baseline only, no report files)
const passed = [
    { name: 'homepage-hero', vp: 'desktop', w: W, h: H, fill: gradient(13, 17, 23, 22, 27, 34) },
    { name: 'homepage-hero', vp: 'mobile', w: MW, h: MH, fill: gradient(13, 17, 23, 22, 27, 34) },
    { name: 'homepage-footer', vp: 'desktop', w: W, h: H, fill: solidColor(22, 27, 34) },
    { name: 'settings-general', vp: 'desktop', w: W, h: H, fill: checkerboard(40, 33, 38, 45, 22, 27, 34) },
];

// FAILED checkpoints (baseline + actual differ, diff generated)
const failed = [
    {
        name: 'dashboard-stats',
        vp: 'desktop',
        w: W,
        h: H,
        baseline: gradient(22, 27, 34, 40, 50, 65),
        actual: withBanner(gradient(22, 27, 34, 40, 50, 65), 200, 80, 200, 60, 30),
        diffPct: 8.52,
        diffPx: 78182,
    },
    {
        name: 'dashboard-stats',
        vp: 'mobile',
        w: MW,
        h: MH,
        baseline: gradient(22, 27, 34, 40, 50, 65),
        actual: withBanner(gradient(22, 27, 34, 40, 50, 65), 300, 60, 180, 50, 25),
        diffPct: 7.38,
        diffPx: 22476,
    },
    {
        name: 'login-form',
        vp: 'desktop',
        w: W,
        h: H,
        baseline: stripes(30, 33, 38, 45, 22, 27, 34),
        actual: stripes(30, 33, 38, 45, 45, 55, 70),
        diffPct: 47.22,
        diffPx: 435340,
    },
];

// NEW checkpoints (actual only)
const newCps = [
    { name: 'notifications-panel', vp: 'desktop', w: W, h: H, fill: gradient(30, 40, 55, 13, 17, 23) },
    { name: 'notifications-panel', vp: 'mobile', w: MW, h: MH, fill: gradient(30, 40, 55, 13, 17, 23) },
];

// --- Generate files ---

console.log('Generating test report PNGs...');

// Passed: baselines only
for (const cp of passed) {
    const fname = `${cp.name}-${cp.vp}.png`;
    const fpath = path.join(BASELINES, fname);
    fs.writeFileSync(fpath, createPng(cp.w, cp.h, cp.fill));
    console.log(`  baseline: ${fname}`);
}

// Failed: baselines + report actuals/baselines/diffs
for (const cp of failed) {
    const slug = `${cp.name}-${cp.vp}`;

    // Baseline in baselines dir
    const baselineBuf = createPng(cp.w, cp.h, cp.baseline);
    fs.writeFileSync(path.join(BASELINES, `${slug}.png`), baselineBuf);
    console.log(`  baseline: ${slug}.png`);

    // Copy baseline to report dir too (serve UI expects it there for failed)
    fs.writeFileSync(path.join(REPORT_DIR, `${slug}-baseline.png`), baselineBuf);

    // Actual in report dir
    const actualBuf = createPng(cp.w, cp.h, cp.actual);
    fs.writeFileSync(path.join(REPORT_DIR, `${slug}-actual.png`), actualBuf);
    console.log(`  actual:   ${slug}-actual.png`);

    // Diff in report dir
    const diffBuf = createPng(cp.w, cp.h, diffImage(cp.baseline, cp.actual));
    fs.writeFileSync(path.join(REPORT_DIR, `${slug}-diff.png`), diffBuf);
    console.log(`  diff:     ${slug}-diff.png`);
}

// New: actuals only in report dir
for (const cp of newCps) {
    const slug = `${cp.name}-${cp.vp}`;
    fs.writeFileSync(path.join(REPORT_DIR, `${slug}-actual.png`), createPng(cp.w, cp.h, cp.fill));
    console.log(`  new:      ${slug}-actual.png`);
}

// --- Generate results.json ---

const checkpoints = [];

for (const cp of passed) {
    checkpoints.push({
        workflow: cp.name.split('-')[0],
        checkpoint: cp.name,
        viewport: cp.vp,
        status: 'pass',
        diffPercent: 0,
        diffPixels: 0,
        error: null,
    });
}

for (const cp of failed) {
    checkpoints.push({
        workflow: cp.name.split('-')[0],
        checkpoint: cp.name,
        viewport: cp.vp,
        status: 'fail',
        diffPercent: cp.diffPct,
        diffPixels: cp.diffPx,
        error: null,
    });
}

for (const cp of newCps) {
    checkpoints.push({
        workflow: cp.name.split('-')[0],
        checkpoint: cp.name,
        viewport: cp.vp,
        status: 'new',
        diffPercent: null,
        diffPixels: null,
        error: null,
    });
}

const resultsJson = {
    extension: '.png',
    checkpoints,
};

fs.writeFileSync(path.join(REPORT_DIR, 'results.json'), JSON.stringify(resultsJson, null, 2));
console.log('  results.json');

// --- Generate meta.json ---

const metaJson = {
    commitHash: 'demo-report',
    timestamp: '2026-03-17T12:00:00.000Z',
    passed: passed.length,
    failed: failed.length,
    newCount: newCps.length,
    errors: 0,
    duration: 4523,
    totalCheckpoints: passed.length + failed.length + newCps.length,
};

fs.writeFileSync(path.join(REPORT_DIR, 'meta.json'), JSON.stringify(metaJson, null, 2));
console.log('  meta.json');

// --- Generate a minimal index.html ---

const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Demo Report</title>
  <style>
    body { background: #0d1117; color: #e6edf3; font-family: system-ui; padding: 2rem; }
    h1 { font-size: 1.5rem; }
    .summary { display: flex; gap: 1rem; margin: 1rem 0; }
    .badge { padding: 0.25rem 0.75rem; border-radius: 999px; font-size: 0.875rem; font-weight: 600; }
    .pass { background: #238636; }
    .fail { background: #da3633; }
    .new { background: #1f6feb; }
    p { color: #8b949e; }
  </style>
</head>
<body>
  <h1>Megatest Demo Report</h1>
  <div class="summary">
    <span class="badge pass">${passed.length} passed</span>
    <span class="badge fail">${failed.length} changed</span>
    <span class="badge new">${newCps.length} new</span>
  </div>
  <p>This is a synthetic test report for UI development. Use the review page in the serve UI for the full experience.</p>
</body>
</html>`;

fs.writeFileSync(path.join(REPORT_DIR, 'index.html'), indexHtml);
console.log('  index.html');

console.log('\nDone! Report generated at .megatest/reports/demo-report/');
