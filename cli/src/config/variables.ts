import type { Step, Workflow } from './schema.js';

/**
 * Replaces ${VAR_NAME} with values from the variables map,
 * and ${env:VAR_NAME} with process.env.VAR_NAME.
 * Returns the interpolated string and any warnings for unresolved variables.
 */
export function interpolateVariables(
    text: string,
    variables: Record<string, string>,
): { result: string; warnings: string[] } {
    const warnings: string[] = [];

    // Replace ${env:VAR_NAME} first so they don't conflict with plain ${VAR_NAME}
    let result = text.replace(/\$\{env:([^}]+)\}/g, (_match, varName: string) => {
        const value = process.env[varName];
        if (value === undefined) {
            warnings.push(`Environment variable not set: ${varName}`);
            return `\${env:${varName}}`;
        }
        return value;
    });

    // Replace ${VAR_NAME} with values from the variables map
    result = result.replace(/\$\{([^}:]+)\}/g, (_match, varName: string) => {
        const value = variables[varName];
        if (value === undefined) {
            warnings.push(`Variable not defined: ${varName}`);
            return `\${${varName}}`;
        }
        return value;
    });

    return { result, warnings };
}

/**
 * Recursively interpolates all string values in a step.
 */
export function interpolateStep(step: Step, variables: Record<string, string>): { step: Step; warnings: string[] } {
    const allWarnings: string[] = [];

    function interpolateValue(value: unknown): unknown {
        if (typeof value === 'string') {
            const { result, warnings } = interpolateVariables(value, variables);
            allWarnings.push(...warnings);
            return result;
        }
        if (Array.isArray(value)) {
            return value.map((item) => interpolateValue(item));
        }
        if (value !== null && typeof value === 'object') {
            const obj: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
                obj[k] = interpolateValue(v);
            }
            return obj;
        }
        return value;
    }

    const interpolated = interpolateValue(step) as Step;
    return { step: interpolated, warnings: allWarnings };
}

/**
 * Interpolates all steps in a workflow.
 */
export function interpolateWorkflow(
    workflow: Workflow,
    variables: Record<string, string>,
): { workflow: Workflow; warnings: string[] } {
    const allWarnings: string[] = [];
    const interpolatedSteps: Step[] = [];

    for (const step of workflow.steps) {
        const { step: interpolated, warnings } = interpolateStep(step, variables);
        interpolatedSteps.push(interpolated);
        allWarnings.push(...warnings);
    }

    // Interpolate name and description too
    const { result: name, warnings: nameWarnings } = interpolateVariables(workflow.name, variables);
    allWarnings.push(...nameWarnings);

    let description = workflow.description;
    if (description) {
        const { result, warnings } = interpolateVariables(description, variables);
        description = result;
        allWarnings.push(...warnings);
    }

    return {
        workflow: {
            name,
            description,
            steps: interpolatedSteps,
        },
        warnings: allWarnings,
    };
}
