import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadConfig } from '../config/loader.js';
import type { LoadedConfig } from '../config/schema.js';
import { ValidationError, validate } from '../config/validator.js';
import { interpolateWorkflow } from '../config/variables.js';
import { runDiffPipeline } from '../differ/pipeline.js';
import { printSummary } from '../reporter/console.js';
import { generateHtmlReport } from '../reporter/html.js';
import { runEngine } from '../runner/engine.js';
import type { CheckpointResult, RunResult } from '../types.js';
import { ensureGitignore, getCommitHash, resolveMegatestDir } from '../utils.js';

export interface RunOptions {
  repo: string;
  url: string;
  plan?: string;
  workflow?: string;
}

export async function runRun(opts: RunOptions): Promise<number> {
  const startTime = Date.now();
  const { repo, url } = opts;

  // 1. Resolve paths
  const megatestDir = resolveMegatestDir(repo);
  if (!fs.existsSync(megatestDir)) {
    console.error(`Error: .megatest/ directory not found at ${megatestDir}`);
    return 1;
  }

  // 2. Load and validate config
  console.log('Loading configuration...');
  let config: LoadedConfig;
  try {
    config = loadConfig(repo);
  } catch (err: any) {
    console.error(`Error loading config: ${err.message}`);
    return 1;
  }

  const errors = validate(config);
  const errs = errors.filter((e) => e.severity === 'error');
  if (errs.length > 0) {
    console.error('Configuration errors:');
    for (const e of errs) {
      console.error(`  \u2717 ${e.file}: ${e.message}`);
    }
    return 1;
  }

  // 3. Interpolate variables in all workflows
  const variables = config.config.variables;
  for (const [name, workflow] of config.workflows) {
    const { workflow: interpolated, warnings } = interpolateWorkflow(workflow, variables);
    config.workflows.set(name, interpolated);
    for (const w of warnings) {
      console.warn(`  \u26A0 ${name}: ${w}`);
    }
  }

  // 4. Determine workflow list
  let workflowNames: string[];
  if (opts.workflow) {
    if (!config.workflows.has(opts.workflow)) {
      console.error(`Workflow "${opts.workflow}" not found`);
      return 1;
    }
    workflowNames = [opts.workflow];
  } else if (opts.plan) {
    const plan = config.plans.get(opts.plan);
    if (!plan) {
      console.error(`Plan "${opts.plan}" not found`);
      return 1;
    }
    workflowNames = plan.workflows;
  } else if (config.plans.has('default')) {
    // biome-ignore lint/style/noNonNullAssertion: guarded by .has() above
    workflowNames = config.plans.get('default')!.workflows;
  } else {
    workflowNames = Array.from(config.workflows.keys());
  }

  console.log(`Running ${workflowNames.length} workflow(s): ${workflowNames.join(', ')}`);
  console.log(`Viewports: ${Object.keys(config.config.viewports).join(', ')}`);
  console.log(`Base URL: ${url}`);
  console.log('');

  // 5. Prepare directories
  const commitHash = getCommitHash(repo);
  const reportDirName = commitHash !== 'unknown' ? commitHash : `run-${Date.now()}`;
  const actualsDir = path.join(megatestDir, 'actuals');
  const baselinesDir = path.join(megatestDir, 'baselines');
  const reportDir = path.join(megatestDir, 'reports', reportDirName);

  fs.mkdirSync(actualsDir, { recursive: true });
  fs.mkdirSync(baselinesDir, { recursive: true });
  fs.mkdirSync(reportDir, { recursive: true });
  ensureGitignore(megatestDir);

  // 6. Run Playwright engine
  console.log('Launching browser...');
  let results: CheckpointResult[];
  try {
    results = await runEngine({
      config,
      baseUrl: url,
      workflowNames,
      actualsDir,
    });
  } catch (err: any) {
    console.error(`Browser error: ${err.message}`);
    return 1;
  }

  // 7. Run diff pipeline
  console.log('Comparing screenshots...');
  results = await runDiffPipeline(results, {
    baselinesDir,
    actualsDir,
    reportDir,
    threshold: config.config.defaults.threshold,
  });

  // 8. Build RunResult
  const runResult: RunResult = {
    commitHash,
    timestamp: new Date().toISOString(),
    checkpoints: results,
    passed: results.filter((r) => r.status === 'pass').length,
    failed: results.filter((r) => r.status === 'fail').length,
    newCount: results.filter((r) => r.status === 'new').length,
    errors: results.filter((r) => r.status === 'error').length,
    duration: Date.now() - startTime,
  };

  // 9. Generate HTML report
  const reportPath = generateHtmlReport(runResult, reportDir, baselinesDir);
  console.log(`\nReport: ${reportPath}`);

  // 10. Print summary
  printSummary(runResult);

  // 11. Exit code
  return runResult.failed > 0 || runResult.newCount > 0 || runResult.errors > 0 ? 1 : 0;
}
