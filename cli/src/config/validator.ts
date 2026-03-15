import * as path from 'node:path';
import * as fs from 'node:fs';
import type { LoadedConfig, Step } from './schema.js';

export interface ValidationError {
  file: string;
  message: string;
  severity: 'error' | 'warning';
}

const VALID_FILENAME_PATTERN = /^[a-z0-9-]+\.yml$/;

/**
 * Extracts all include references from a list of steps.
 */
function getIncludeReferences(steps: Step[]): string[] {
  const refs: string[] = [];
  for (const step of steps) {
    if ('include' in step) {
      refs.push(step.include);
    }
  }
  return refs;
}

/**
 * Detects circular include dependencies using DFS.
 * Returns a list of cycles found, each described as a string.
 */
function detectCircularIncludes(
  config: LoadedConfig,
): { file: string; message: string }[] {
  const cycles: { file: string; message: string }[] = [];
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const pathStack: string[] = [];

  function dfs(name: string): void {
    if (inStack.has(name)) {
      const cycleStart = pathStack.indexOf(name);
      const cycle = [...pathStack.slice(cycleStart), name];
      cycles.push({
        file: `includes/${name}.yml`,
        message: `Circular include detected: ${cycle.join(' -> ')}`,
      });
      return;
    }
    if (visited.has(name)) {
      return;
    }

    visited.add(name);
    inStack.add(name);
    pathStack.push(name);

    const include = config.includes.get(name);
    if (include) {
      const refs = getIncludeReferences(include.steps);
      for (const ref of refs) {
        dfs(ref);
      }
    }

    // Also check workflows that reference includes
    pathStack.pop();
    inStack.delete(name);
  }

  for (const name of config.includes.keys()) {
    dfs(name);
  }

  return cycles;
}

export function validate(config: LoadedConfig): ValidationError[] {
  const errors: ValidationError[] = [];
  const basePath = config.basePath;

  // Validate config version
  if (config.config.version !== '1') {
    errors.push({
      file: 'config.yml',
      message: `Invalid version "${config.config.version}", must be "1"`,
      severity: 'error',
    });
  }

  // Validate workflow filenames and contents
  const workflowsDir = path.join(basePath, 'workflows');
  if (fs.existsSync(workflowsDir)) {
    const workflowFiles = fs.readdirSync(workflowsDir).filter((f) => f.endsWith('.yml'));
    for (const filename of workflowFiles) {
      const filePath = `workflows/${filename}`;

      // Check filename pattern
      if (!VALID_FILENAME_PATTERN.test(filename)) {
        errors.push({
          file: filePath,
          message: `Invalid filename "${filename}", must match pattern [a-z0-9-]+.yml`,
          severity: 'error',
        });
      }

      // Check filename matches name field
      const expectedName = filename.replace(/\.yml$/, '');
      const workflow = config.workflows.get(expectedName);
      if (workflow && workflow.name !== expectedName) {
        errors.push({
          file: filePath,
          message: `Filename "${expectedName}" does not match name field "${workflow.name}"`,
          severity: 'error',
        });
      }
    }
  }

  // Validate each workflow
  const workflowNames = new Set<string>();
  for (const [name, workflow] of config.workflows) {
    const filePath = `workflows/${name}.yml`;

    // Check for duplicate names
    if (workflowNames.has(name)) {
      errors.push({
        file: filePath,
        message: `Duplicate workflow name: "${name}"`,
        severity: 'error',
      });
    }
    workflowNames.add(name);

    // Check at least one step
    if (!workflow.steps || workflow.steps.length === 0) {
      errors.push({
        file: filePath,
        message: 'Workflow must have at least one step',
        severity: 'error',
      });
    }

    // Check include references in workflow steps
    const includeRefs = getIncludeReferences(workflow.steps);
    for (const ref of includeRefs) {
      if (!config.includes.has(ref)) {
        errors.push({
          file: filePath,
          message: `Include reference "${ref}" not found`,
          severity: 'error',
        });
      }
    }
  }

  // Validate include filenames and contents
  const includesDir = path.join(basePath, 'includes');
  if (fs.existsSync(includesDir)) {
    const includeFiles = fs.readdirSync(includesDir).filter((f) => f.endsWith('.yml'));
    for (const filename of includeFiles) {
      const filePath = `includes/${filename}`;

      // Check filename pattern
      if (!VALID_FILENAME_PATTERN.test(filename)) {
        errors.push({
          file: filePath,
          message: `Invalid filename "${filename}", must match pattern [a-z0-9-]+.yml`,
          severity: 'error',
        });
      }

      // Check filename matches name field
      const expectedName = filename.replace(/\.yml$/, '');
      const include = config.includes.get(expectedName);
      if (include && include.name !== expectedName) {
        errors.push({
          file: filePath,
          message: `Filename "${expectedName}" does not match name field "${include.name}"`,
          severity: 'error',
        });
      }
    }
  }

  // Validate each include
  const includeNames = new Set<string>();
  for (const [name, include] of config.includes) {
    const filePath = `includes/${name}.yml`;

    // Check for duplicate names
    if (includeNames.has(name)) {
      errors.push({
        file: filePath,
        message: `Duplicate include name: "${name}"`,
        severity: 'error',
      });
    }
    includeNames.add(name);

    // Check at least one step
    if (!include.steps || include.steps.length === 0) {
      errors.push({
        file: filePath,
        message: 'Include must have at least one step',
        severity: 'error',
      });
    }

    // Check include references within includes
    const includeRefs = getIncludeReferences(include.steps);
    for (const ref of includeRefs) {
      if (!config.includes.has(ref)) {
        errors.push({
          file: filePath,
          message: `Include reference "${ref}" not found`,
          severity: 'error',
        });
      }
    }
  }

  // Detect circular includes
  const circularErrors = detectCircularIncludes(config);
  for (const err of circularErrors) {
    errors.push({
      file: err.file,
      message: err.message,
      severity: 'error',
    });
  }

  // Validate plan filenames and contents
  const plansDir = path.join(basePath, 'plans');
  if (fs.existsSync(plansDir)) {
    const planFiles = fs.readdirSync(plansDir).filter((f) => f.endsWith('.yml'));
    for (const filename of planFiles) {
      const filePath = `plans/${filename}`;

      // Check filename pattern
      if (!VALID_FILENAME_PATTERN.test(filename)) {
        errors.push({
          file: filePath,
          message: `Invalid filename "${filename}", must match pattern [a-z0-9-]+.yml`,
          severity: 'error',
        });
      }

      // Check filename matches name field
      const expectedName = filename.replace(/\.yml$/, '');
      const plan = config.plans.get(expectedName);
      if (plan && plan.name !== expectedName) {
        errors.push({
          file: filePath,
          message: `Filename "${expectedName}" does not match name field "${plan.name}"`,
          severity: 'error',
        });
      }
    }
  }

  // Validate each plan
  for (const [name, plan] of config.plans) {
    const filePath = `plans/${name}.yml`;

    // Check at least one workflow
    if (!plan.workflows || plan.workflows.length === 0) {
      errors.push({
        file: filePath,
        message: 'Plan must have at least one workflow entry',
        severity: 'error',
      });
    }

    // Check workflow references
    for (const workflowRef of plan.workflows) {
      if (!config.workflows.has(workflowRef)) {
        errors.push({
          file: filePath,
          message: `Workflow reference "${workflowRef}" not found`,
          severity: 'error',
        });
      }
    }
  }

  return errors;
}
