import * as fs from 'node:fs';
import * as path from 'node:path';
import { createCodec } from '../codec/index.js';
import { loadConfig } from '../config/loader.js';

export async function runAccept(repoPath: string, checkpoint?: string): Promise<number> {
    const megatestDir = path.resolve(repoPath, '.megatest');
    const actualsDir = path.join(megatestDir, 'actuals');
    const baselinesDir = path.join(megatestDir, 'baselines');

    if (!fs.existsSync(actualsDir)) {
        console.error('No actuals directory found. Run tests first.');
        return 1;
    }

    // Determine format from config
    let ext = '.png';
    try {
        const config = loadConfig(repoPath);
        ext = createCodec(config.config.defaults.format).extension;
    } catch {
        // Fall back to .png if config can't be loaded
    }

    // Get all image files in actuals/
    const files = fs.readdirSync(actualsDir).filter((f) => f.endsWith(ext));

    if (files.length === 0) {
        console.log('No screenshots to accept.');
        return 0;
    }

    // Filter by checkpoint name if specified
    let toAccept = files;
    if (checkpoint) {
        // Checkpoint files are named <checkpoint>-<viewport><ext>
        // Extract checkpoint by removing the last -<segment> (viewport name) from the filename
        toAccept = files.filter((f) => {
            const withoutExt = f.replace(ext, '');
            const lastDash = withoutExt.lastIndexOf('-');
            if (lastDash === -1) return withoutExt === checkpoint;
            const cpName = withoutExt.substring(0, lastDash);
            return cpName === checkpoint;
        });

        if (toAccept.length === 0) {
            console.error(`No screenshots found matching checkpoint "${checkpoint}"`);
            return 1;
        }
    }

    // Ensure baselines directory exists
    if (!fs.existsSync(baselinesDir)) {
        fs.mkdirSync(baselinesDir, { recursive: true });
    }

    // Copy each actual to baselines
    let accepted = 0;
    for (const file of toAccept) {
        const src = path.join(actualsDir, file);
        const dest = path.join(baselinesDir, file);
        fs.copyFileSync(src, dest);
        // Remove from actuals
        fs.unlinkSync(src);
        accepted++;
        console.log(`  \u2713 ${file}`);
    }

    console.log(`\n${accepted} baseline${accepted !== 1 ? 's' : ''} accepted`);

    // Update the latest report's results.json so the serve app reflects acceptance
    const reportsDir = path.join(megatestDir, 'reports');
    if (fs.existsSync(reportsDir)) {
        const reportDirs = fs
            .readdirSync(reportsDir, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => ({ name: d.name, mtime: fs.statSync(path.join(reportsDir, d.name)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime);

        if (reportDirs.length > 0) {
            const resultsPath = path.join(reportsDir, reportDirs[0].name, 'results.json');
            if (fs.existsSync(resultsPath)) {
                try {
                    const reviewData = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'));
                    const acceptedSlugs = new Set(toAccept.map((f) => f.replace(ext, '')));
                    let updated = 0;

                    for (const cp of reviewData.checkpoints ?? []) {
                        const slug = `${cp.checkpoint}-${cp.viewport}`;
                        if (acceptedSlugs.has(slug)) {
                            cp.status = 'pass';
                            updated++;
                        }
                    }

                    if (updated > 0) {
                        fs.writeFileSync(resultsPath, JSON.stringify(reviewData, null, 2));
                    }
                } catch {
                    // Non-critical: serve app will still work via filesystem fallback
                }
            }
        }
    }

    return 0;
}
