import * as fs from 'node:fs';
import type { Browser } from 'playwright';
import type { ImageCodec } from '../codec/index.js';
import type { Include, LoadedConfig, Step, Viewport } from '../config/schema.js';
import { interpolateStep } from '../config/variables.js';
import {
    printProgress,
    printStepComplete,
    printStepError,
    printTaskComplete,
    printTaskError,
    printTaskStart,
} from '../reporter/console.js';
import type { CheckpointResult } from '../types.js';
import { createContext, createPage, launchBrowser } from './browser.js';
import { type StepContext, executeStep } from './steps.js';

/** Format step data as a compact string for error context */
function formatStepSummary(stepType: string, stepData: unknown): string {
    if (stepData === undefined || stepData === null) return stepType;
    if (typeof stepData === 'string' || typeof stepData === 'number') {
        return `${stepType}: ${stepData}`;
    }
    if (typeof stepData === 'object') {
        const parts: string[] = [];
        for (const [k, v] of Object.entries(stepData as Record<string, unknown>)) {
            if (typeof v === 'string') {
                // Truncate long values
                const display = v.length > 60 ? `${v.slice(0, 57)}...` : v;
                parts.push(`${k}: "${display}"`);
            } else if (v !== undefined) {
                parts.push(`${k}: ${JSON.stringify(v)}`);
            }
        }
        return `${stepType}: { ${parts.join(', ')} }`;
    }
    return `${stepType}: ${JSON.stringify(stepData)}`;
}

export interface EngineOptions {
    config: LoadedConfig;
    baseUrl: string;
    workflowNames: string[];
    actualsDir: string;
    codec: ImageCodec;
    concurrency: number;
}

interface WorkTask {
    workflowName: string;
    vpName: string;
    vpSize: Viewport;
    resolvedSteps: Step[];
}

// Resolve includes: expand include steps inline, detect circular refs
function resolveIncludes(steps: Step[], includes: Map<string, Include>, visited: Set<string> = new Set()): Step[] {
    const resolved: Step[] = [];
    for (const step of steps) {
        if ('include' in step) {
            const name = (step as { include: string }).include;
            if (visited.has(name)) {
                throw new Error(`Circular include detected: ${name}`);
            }
            const inc = includes.get(name);
            if (!inc) {
                throw new Error(`Include not found: ${name}`);
            }
            visited.add(name);
            const expanded = resolveIncludes(inc.steps, includes, new Set(visited));
            resolved.push(...expanded);
        } else {
            resolved.push(step);
        }
    }
    return resolved;
}

/** Run a single (workflow, viewport) pair in its own browser context */
async function runSinglePair(
    browser: Browser,
    task: WorkTask,
    opts: EngineOptions,
    taskIndex: number,
    totalTasks: number,
    parallel: boolean,
): Promise<CheckpointResult[]> {
    const { workflowName, vpName, vpSize, resolvedSteps } = task;
    const { config, baseUrl, actualsDir } = opts;
    const results: CheckpointResult[] = [];
    const taskStart = Date.now();

    if (parallel) {
        printTaskStart(taskIndex, totalTasks, workflowName, vpName);
    }

    const context = await createContext(browser, vpSize);
    const page = await createPage(context);

    // Disable smooth scrolling and CSS animations for deterministic screenshots.
    // Uses addInitScript so it persists across navigations automatically.
    await page.addInitScript(() => {
        if (document.getElementById('__megatest_deterministic')) return;
        const style = document.createElement('style');
        style.id = '__megatest_deterministic';
        style.textContent =
            '*, *::before, *::after { scroll-behavior: auto !important; animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; transition-delay: 0s !important; caret-color: transparent !important; }';
        (document.head || document.documentElement).appendChild(style);
    });

    const stepCtx: StepContext = {
        baseUrl,
        viewports: config.config.viewports,
        screenshotMode: config.config.defaults.screenshotMode,
        actualsDir,
        viewportName: vpName,
        timeout: config.config.defaults.timeout,
        waitAfterNavigation: config.config.defaults.waitAfterNavigation,
        codec: opts.codec,
    };

    let stepFailed = false;
    let hasExplicitScroll = false;
    for (let i = 0; i < resolvedSteps.length; i++) {
        const step = resolvedSteps[i];
        const stepType = Object.keys(step)[0];
        const stepData = (step as unknown as Record<string, unknown>)[stepType];

        // Before viewport screenshots, reset scroll to top to ensure deterministic captures.
        // Skip if the user explicitly scrolled (via a scroll step) since the last screenshot.
        if (stepType === 'screenshot' && stepCtx.screenshotMode === 'viewport' && !hasExplicitScroll) {
            await page.evaluate(() => window.scrollTo({ left: 0, top: 0, behavior: 'instant' }));
            // Wait for scroll event handlers to settle and DOM updates to paint
            await page.evaluate(
                () =>
                    new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
            );
        }

        // Clear hover state before screenshots to prevent CSS :hover effects
        // from leaking across steps (mouse position persists after click/fill/hover).
        // Exception: if the previous step was an explicit hover, the user wants hover state captured.
        if (stepType === 'screenshot') {
            const prevStepType = i > 0 ? Object.keys(resolvedSteps[i - 1])[0] : null;
            if (prevStepType !== 'hover') {
                await page.mouse.move(0, 0);
            }
        }

        // Clear focus state before screenshots to prevent CSS :focus/:focus-visible
        // effects from leaking into captures (e.g. after fill steps leave inputs focused).
        if (stepType === 'screenshot') {
            await page.evaluate(() => {
                const el = document.activeElement;
                if (el && el !== document.body) {
                    (el as HTMLElement).blur();
                }
            });
        }

        if (!parallel) {
            printProgress(taskIndex, totalTasks, workflowName, vpName, i + 1, resolvedSteps.length);
        }
        try {
            const result = await executeStep(page, step, stepCtx);
            // Track explicit scroll steps so we don't override intentional scroll positioning
            if (stepType === 'scroll') {
                hasExplicitScroll = true;
            } else if (stepType === 'screenshot') {
                hasExplicitScroll = false;
            }

            if (result.checkpointName && result.screenshotPath) {
                results.push({
                    workflow: workflowName,
                    checkpoint: result.checkpointName,
                    viewport: vpName,
                    status: 'new', // Will be updated by differ
                    diffPercent: null,
                    diffPixels: null,
                    totalPixels: null,
                    dimensionMismatch: false,
                    baselinePath: null,
                    actualPath: result.screenshotPath,
                    diffPath: null,
                    error: null,
                });
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            const stepSummary = formatStepSummary(stepType, stepData);
            if (parallel) {
                printTaskError(
                    taskIndex,
                    totalTasks,
                    workflowName,
                    vpName,
                    `step ${i + 1}/${resolvedSteps.length} (${stepType}): ${message}`,
                    stepSummary,
                );
            } else {
                printStepError(
                    taskIndex,
                    totalTasks,
                    workflowName,
                    vpName,
                    `step ${i + 1}/${resolvedSteps.length} (${stepType}): ${message}`,
                    stepSummary,
                );
            }
            results.push({
                workflow: workflowName,
                checkpoint: `step-${i + 1}-error`,
                viewport: vpName,
                status: 'error',
                diffPercent: null,
                diffPixels: null,
                totalPixels: null,
                dimensionMismatch: false,
                baselinePath: null,
                actualPath: null,
                diffPath: null,
                error: `Step ${i + 1} (${stepType}) failed: ${message}`,
            });
            stepFailed = true;
            break; // Skip remaining steps in this workflow/viewport pair
        }
    }

    if (!stepFailed) {
        if (parallel) {
            printTaskComplete(
                taskIndex,
                totalTasks,
                workflowName,
                vpName,
                resolvedSteps.length,
                Date.now() - taskStart,
            );
        } else {
            printStepComplete(taskIndex, totalTasks, workflowName, vpName);
        }
    }
    await context.close();

    return results;
}

export async function runEngine(opts: EngineOptions): Promise<CheckpointResult[]> {
    const { config, workflowNames, actualsDir } = opts;
    const results: CheckpointResult[] = [];
    const concurrency = opts.concurrency;
    const parallel = concurrency > 1;

    // Ensure actuals directory exists
    fs.mkdirSync(actualsDir, { recursive: true });

    const browser = await launchBrowser();

    try {
        const viewportEntries = Object.entries(config.config.viewports);

        // Build work queue: resolve includes and interpolate variables upfront
        const workQueue: WorkTask[] = [];
        for (const workflowName of workflowNames) {
            const workflow = config.workflows.get(workflowName);
            if (!workflow) {
                console.error(`Workflow not found: ${workflowName}`);
                continue;
            }

            let resolvedSteps: Step[];
            try {
                resolvedSteps = resolveIncludes(workflow.steps, config.includes);
                const variables = config.config.variables;
                resolvedSteps = resolvedSteps.map((step) => {
                    const { step: interpolated, warnings } = interpolateStep(step, variables);
                    for (const w of warnings) {
                        console.warn(`  \u26A0 ${workflowName}: ${w}`);
                    }
                    return interpolated;
                });
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                console.error(`Error resolving includes for workflow "${workflowName}": ${message}`);
                // Record error for all viewports
                for (const [vpName] of viewportEntries) {
                    results.push({
                        workflow: workflowName,
                        checkpoint: '*',
                        viewport: vpName,
                        status: 'error',
                        diffPercent: null,
                        diffPixels: null,
                        totalPixels: null,
                        dimensionMismatch: false,
                        baselinePath: null,
                        actualPath: null,
                        diffPath: null,
                        error: message,
                    });
                }
                continue;
            }

            for (const [vpName, vpSize] of viewportEntries) {
                workQueue.push({ workflowName, vpName, vpSize, resolvedSteps });
            }
        }

        const totalTasks = workQueue.length;

        // Run tasks with concurrency pool
        const active = new Set<Promise<void>>();
        let taskIndex = 0;

        for (const task of workQueue) {
            taskIndex++;
            const idx = taskIndex; // capture for closure
            const promise = runSinglePair(browser, task, opts, idx, totalTasks, parallel)
                .then((pairResults) => {
                    results.push(...pairResults);
                })
                .catch((err: unknown) => {
                    const message = err instanceof Error ? err.message : String(err);
                    console.error(`Fatal error in ${task.workflowName} [${task.vpName}]: ${message}`);
                    results.push({
                        workflow: task.workflowName,
                        checkpoint: '*',
                        viewport: task.vpName,
                        status: 'error',
                        diffPercent: null,
                        diffPixels: null,
                        totalPixels: null,
                        dimensionMismatch: false,
                        baselinePath: null,
                        actualPath: null,
                        diffPath: null,
                        error: message,
                    });
                })
                .finally(() => {
                    active.delete(promise);
                });
            active.add(promise);

            if (active.size >= concurrency) {
                await Promise.race(active);
            }
        }

        // Drain remaining tasks
        await Promise.all(active);

        // Run teardown steps (cleanup after all workflows complete)
        if (config.config.teardown && config.config.teardown.length > 0) {
            console.log('\n  Teardown: running cleanup steps...');
            try {
                let teardownSteps = resolveIncludes(config.config.teardown, config.includes);
                const variables = config.config.variables;
                teardownSteps = teardownSteps.map((step) => {
                    const { step: interpolated } = interpolateStep(step, variables);
                    return interpolated;
                });

                const defaultVp = config.config.defaults.viewport;
                const context = await createContext(browser, defaultVp);
                const page = await createPage(context);

                const stepCtx: StepContext = {
                    baseUrl: opts.baseUrl,
                    viewports: config.config.viewports,
                    screenshotMode: config.config.defaults.screenshotMode,
                    actualsDir,
                    viewportName: 'desktop',
                    timeout: config.config.defaults.timeout,
                    waitAfterNavigation: config.config.defaults.waitAfterNavigation,
                    codec: opts.codec,
                };

                for (let i = 0; i < teardownSteps.length; i++) {
                    const step = teardownSteps[i];
                    const stepType = Object.keys(step)[0];
                    await executeStep(page, step, stepCtx);
                    console.log(`  Teardown: step ${i + 1}/${teardownSteps.length} (${stepType}) done`);
                }

                await context.close();
                console.log('  Teardown: complete');
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                console.error(`  Teardown failed: ${message}`);
            }
        }
    } finally {
        await browser.close();
    }

    return results;
}
