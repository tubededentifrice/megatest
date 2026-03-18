import type { Include, Step } from '../config/schema.js';

/** Format step data as a compact string for error context */
export function formatStepSummary(stepType: string, stepData: unknown): string {
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

/** Resolve includes: expand include steps inline, detect circular refs */
export function resolveIncludes(
    steps: Step[],
    includes: Map<string, Include>,
    visited: Set<string> = new Set(),
): Step[] {
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
