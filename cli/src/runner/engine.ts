import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ImageCodec } from '../codec/index.js';
import { type Include, type LoadedConfig, type Step, Workflow } from '../config/schema.js';
import { interpolateStep } from '../config/variables.js';
import { printProgress, printStepComplete, printStepError } from '../reporter/console.js';
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

export async function runEngine(opts: EngineOptions): Promise<CheckpointResult[]> {
  const { config, baseUrl, workflowNames, actualsDir } = opts;
  const results: CheckpointResult[] = [];

  // Ensure actuals directory exists
  fs.mkdirSync(actualsDir, { recursive: true });

  const browser = await launchBrowser();

  try {
    const viewports = config.config.viewports;
    const viewportEntries = Object.entries(viewports);
    const totalRuns = workflowNames.length * viewportEntries.length;
    let runIndex = 0;

    for (const workflowName of workflowNames) {
      const workflow = config.workflows.get(workflowName);
      if (!workflow) {
        console.error(`Workflow not found: ${workflowName}`);
        continue;
      }

      // Resolve includes, then interpolate variables (includes may contain ${VAR} references)
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
        runIndex++;
        const context = await createContext(browser, vpSize);
        const page = await createPage(context);

        const stepCtx: StepContext = {
          baseUrl,
          viewports,
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
            await page.evaluate(() => window.scrollTo(0, 0));
          }

          printProgress(runIndex, totalRuns, workflowName, vpName, i + 1, resolvedSteps.length);
          try {
            const result = await executeStep(page, step, stepCtx);
            // Track explicit scroll steps so we don't override intentional scroll positioning
            if (stepType === 'scroll') {
              hasExplicitScroll = true;
            } else if (stepType === 'screenshot') {
              hasExplicitScroll = false;
            }

            if (result.checkpointName) {
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
                actualPath: result.screenshotPath!,
                diffPath: null,
                error: null,
              });
            }
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            const stepSummary = formatStepSummary(stepType, stepData);
            printStepError(
              runIndex,
              totalRuns,
              workflowName,
              vpName,
              `step ${i + 1}/${resolvedSteps.length} (${stepType}): ${message}`,
              stepSummary,
            );
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
          printStepComplete(runIndex, totalRuns, workflowName, vpName);
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  return results;
}
