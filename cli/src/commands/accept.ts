import * as fs from 'fs';
import * as path from 'path';

export async function runAccept(repoPath: string, checkpoint?: string): Promise<number> {
  const megatestDir = path.resolve(repoPath, '.megatest');
  const actualsDir = path.join(megatestDir, 'actuals');
  const baselinesDir = path.join(megatestDir, 'baselines');

  if (!fs.existsSync(actualsDir)) {
    console.error('No actuals directory found. Run tests first.');
    return 1;
  }

  // Get all PNG files in actuals/
  const files = fs.readdirSync(actualsDir).filter(f => f.endsWith('.png'));

  if (files.length === 0) {
    console.log('No screenshots to accept.');
    return 0;
  }

  // Filter by checkpoint name if specified
  let toAccept = files;
  if (checkpoint) {
    // Checkpoint files are named <checkpoint>-<viewport>.png
    // Extract checkpoint by removing the last -<segment> (viewport name) from the filename
    toAccept = files.filter(f => {
      const withoutExt = f.replace('.png', '');
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
  return 0;
}
