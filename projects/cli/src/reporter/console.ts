import type { RunResult } from '@megatest/core';

export function printProgress(
    index: number,
    total: number,
    workflow: string,
    viewport: string,
    step: number,
    totalSteps: number,
): void {
    process.stdout.write(`\r  ${index}/${total} ${workflow} [${viewport}] step ${step}/${totalSteps}`);
}

export function printStepComplete(index: number, total: number, workflow: string, viewport: string): void {
    // Clear the progress line before printing completion
    process.stdout.write('\r\x1b[K');
    console.log(`  ${index}/${total} \u2713 ${workflow} [${viewport}]`);
}

export function printStepError(
    index: number,
    total: number,
    workflow: string,
    viewport: string,
    error: string,
    stepDetail?: string,
): void {
    // Clear the progress line before printing error
    process.stdout.write('\r\x1b[K');
    console.error(`  ${index}/${total} \u2717 ${workflow} [${viewport}]: ${error}`);
    if (stepDetail) {
        console.error(`    step: ${stepDetail}`);
    }
}

export function printTaskStart(index: number, total: number, workflow: string, viewport: string): void {
    console.log(`  [${index}/${total}] Starting ${workflow} [${viewport}]...`);
}

export function printTaskComplete(
    index: number,
    total: number,
    workflow: string,
    viewport: string,
    stepCount: number,
    durationMs: number,
): void {
    console.log(
        `  [${index}/${total}] \u2713 ${workflow} [${viewport}] (${stepCount} steps, ${(durationMs / 1000).toFixed(1)}s)`,
    );
}

export function printTaskError(
    index: number,
    total: number,
    workflow: string,
    viewport: string,
    error: string,
    stepDetail?: string,
): void {
    console.error(`  [${index}/${total}] \u2717 ${workflow} [${viewport}]: ${error}`);
    if (stepDetail) {
        console.error(`    step: ${stepDetail}`);
    }
}

export function printSummary(result: RunResult): void {
    console.log('');
    console.log('\u2500'.repeat(50));
    console.log(`Run complete: ${result.commitHash} (${(result.duration / 1000).toFixed(1)}s)`);
    console.log('');

    if (result.passed > 0) console.log(`  \u2713 ${result.passed} passed`);
    if (result.failed > 0) console.log(`  \u2717 ${result.failed} changed`);
    if (result.newCount > 0) console.log(`  \u25CF ${result.newCount} new`);
    if (result.errors > 0) console.log(`  ! ${result.errors} failed`);

    console.log('');

    const total = result.passed + result.failed + result.newCount + result.errors;
    if (result.failed === 0 && result.newCount === 0 && result.errors === 0) {
        console.log(`All ${total} checkpoints passed.`);
    } else {
        console.log(`${total} checkpoints total.`);
    }
}
