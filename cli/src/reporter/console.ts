import { RunResult } from '../types.js';

export function printProgress(workflow: string, viewport: string, step: number, totalSteps: number): void {
  process.stdout.write(`\r  ${workflow} [${viewport}] step ${step}/${totalSteps}`);
}

export function printStepComplete(workflow: string, viewport: string): void {
  console.log(`  \u2713 ${workflow} [${viewport}]`);
}

export function printStepError(workflow: string, viewport: string, error: string): void {
  console.error(`  \u2717 ${workflow} [${viewport}]: ${error}`);
}

export function printSummary(result: RunResult): void {
  console.log('');
  console.log('\u2500'.repeat(50));
  console.log(`Run complete: ${result.commitHash} (${(result.duration / 1000).toFixed(1)}s)`);
  console.log('');

  if (result.passed > 0) console.log(`  \u2713 ${result.passed} passed`);
  if (result.failed > 0) console.log(`  \u2717 ${result.failed} failed`);
  if (result.newCount > 0) console.log(`  \u25CF ${result.newCount} new`);
  if (result.errors > 0) console.log(`  ! ${result.errors} errors`);

  console.log('');

  const total = result.passed + result.failed + result.newCount + result.errors;
  if (result.failed === 0 && result.newCount === 0 && result.errors === 0) {
    console.log(`All ${total} checkpoints passed.`);
  } else {
    console.log(`${total} checkpoints total.`);
  }
}
