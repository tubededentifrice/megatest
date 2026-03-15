import * as fs from 'node:fs';
import * as path from 'node:path';
import { type Include, type LoadedConfig, type Step, Workflow } from '../config/schema.js';
import { printProgress, printStepComplete, printStepError } from '../reporter/console.js';
import type { CheckpointResult } from '../types.js';
import { createContext, createPage, launchBrowser } from './browser.js';
import { type StepContext, executeStep } from './steps.js';

export interface EngineOptions {
  config: LoadedConfig;
  baseUrl: string;
  workflowNames: string[];
  actualsDir: string;
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

    for (const workflowName of workflowNames) {
      const workflow = config.workflows.get(workflowName);
      if (!workflow) {
        console.error(`Workflow not found: ${workflowName}`);
        continue;
      }

      // Resolve includes
      let resolvedSteps: Step[];
      try {
        resolvedSteps = resolveIncludes(workflow.steps, config.includes);
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
        };

        let stepFailed = false;
        for (let i = 0; i < resolvedSteps.length; i++) {
          const step = resolvedSteps[i];
          printProgress(workflowName, vpName, i + 1, resolvedSteps.length);
          try {
            const result = await executeStep(page, step, stepCtx);
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
            printStepError(workflowName, vpName, message);
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
              error: `Step ${i + 1} failed: ${message}`,
            });
            stepFailed = true;
            break; // Skip remaining steps in this workflow/viewport pair
          }
        }

        if (!stepFailed) {
          printStepComplete(workflowName, vpName);
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  return results;
}
