import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Include, LoadedConfig, MegatestConfig, Plan, Step, Workflow } from '../../src/config/schema.js';
import { validate } from '../../src/config/validator.js';

// Mock node:fs so the validator's existsSync/readdirSync calls don't hit disk
vi.mock('node:fs', () => ({
    existsSync: vi.fn(() => false),
    readdirSync: vi.fn(() => []),
}));

import * as fs from 'node:fs';

/** Helper to build a minimal valid config for testing */
function makeConfig(
    overrides: Partial<{
        version: string;
        viewports: Record<string, { width: number; height: number }>;
        workflows: Map<string, Workflow>;
        includes: Map<string, Include>;
        plans: Map<string, Plan>;
        teardown: Step[];
    }>,
): LoadedConfig {
    const config: MegatestConfig = {
        version: overrides.version ?? '1',
        defaults: {
            viewport: { width: 1280, height: 720 },
            threshold: 0.1,
            waitAfterNavigation: '1000',
            screenshotMode: 'viewport',
            timeout: 30000,
            format: 'webp',
            concurrency: 4,
        },
        viewports: overrides.viewports ?? { desktop: { width: 1280, height: 720 } },
        variables: {},
    };
    if (overrides.teardown) {
        config.teardown = overrides.teardown;
    }
    return {
        config,
        workflows: overrides.workflows ?? new Map(),
        includes: overrides.includes ?? new Map(),
        plans: overrides.plans ?? new Map(),
        basePath: '/fake/.megatest',
    };
}

describe('validate', () => {
    beforeEach(() => {
        vi.mocked(fs.existsSync).mockReturnValue(false);
        vi.mocked(fs.readdirSync).mockReturnValue([]);
    });

    // --- Version ---

    it('reports error for invalid version', () => {
        const config = makeConfig({ version: '2' });
        const errors = validate(config);
        const versionError = errors.find((e) => e.message.includes('Invalid version'));
        expect(versionError).toBeDefined();
        expect(versionError?.severity).toBe('error');
    });

    it('accepts version "1"', () => {
        const config = makeConfig({ version: '1' });
        const errors = validate(config);
        const versionError = errors.find((e) => e.message.includes('Invalid version'));
        expect(versionError).toBeUndefined();
    });

    // --- Empty steps ---

    it('reports error when workflow has no steps', () => {
        const workflows = new Map<string, Workflow>([['empty', { name: 'empty', steps: [] }]]);
        const config = makeConfig({ workflows });
        const errors = validate(config);
        expect(errors.some((e) => e.message.includes('at least one step'))).toBe(true);
    });

    // --- Unknown step type ---

    it('reports error for unknown step type', () => {
        const workflows = new Map<string, Workflow>([
            ['test', { name: 'test', steps: [{ bogus: 'value' } as unknown as Step] }],
        ]);
        const config = makeConfig({ workflows });
        const errors = validate(config);
        expect(errors.some((e) => e.message.includes('Unknown step type "bogus"'))).toBe(true);
    });

    // --- Step type value validation ---

    it('reports error when "open" step has non-string value', () => {
        const workflows = new Map<string, Workflow>([
            ['test', { name: 'test', steps: [{ open: 123 } as unknown as Step] }],
        ]);
        const config = makeConfig({ workflows });
        const errors = validate(config);
        expect(errors.some((e) => e.message.includes('"open" requires a string'))).toBe(true);
    });

    it('reports error when "wait" step has non-number value', () => {
        const workflows = new Map<string, Workflow>([
            ['test', { name: 'test', steps: [{ wait: 'not-a-number' } as unknown as Step] }],
        ]);
        const config = makeConfig({ workflows });
        const errors = validate(config);
        expect(errors.some((e) => e.message.includes('"wait" requires a number'))).toBe(true);
    });

    it('reports error when "screenshot" step has non-string value', () => {
        const workflows = new Map<string, Workflow>([
            ['test', { name: 'test', steps: [{ screenshot: 42 } as unknown as Step] }],
        ]);
        const config = makeConfig({ workflows });
        const errors = validate(config);
        expect(errors.some((e) => e.message.includes('"screenshot" requires a string'))).toBe(true);
    });

    it('reports error when "click" step has non-object value', () => {
        const workflows = new Map<string, Workflow>([
            ['test', { name: 'test', steps: [{ click: 'not-an-object' } as unknown as Step] }],
        ]);
        const config = makeConfig({ workflows });
        const errors = validate(config);
        expect(errors.some((e) => e.message.includes('"click" requires an object'))).toBe(true);
    });

    it('reports error when "fill" step has non-object value', () => {
        const workflows = new Map<string, Workflow>([
            ['test', { name: 'test', steps: [{ fill: 'nope' } as unknown as Step] }],
        ]);
        const config = makeConfig({ workflows });
        const errors = validate(config);
        expect(errors.some((e) => e.message.includes('"fill" requires an object'))).toBe(true);
    });

    it('reports error when "press" step has non-string value', () => {
        const workflows = new Map<string, Workflow>([
            ['test', { name: 'test', steps: [{ press: 99 } as unknown as Step] }],
        ]);
        const config = makeConfig({ workflows });
        const errors = validate(config);
        expect(errors.some((e) => e.message.includes('"press" requires a string'))).toBe(true);
    });

    it('reports error when "eval" step has non-string value', () => {
        const workflows = new Map<string, Workflow>([
            ['test', { name: 'test', steps: [{ eval: false } as unknown as Step] }],
        ]);
        const config = makeConfig({ workflows });
        const errors = validate(config);
        expect(errors.some((e) => e.message.includes('"eval" requires a string'))).toBe(true);
    });

    it('reports error when "include" step has non-string value', () => {
        const workflows = new Map<string, Workflow>([
            ['test', { name: 'test', steps: [{ include: 42 } as unknown as Step] }],
        ]);
        const config = makeConfig({ workflows });
        const errors = validate(config);
        expect(errors.some((e) => e.message.includes('"include" requires a string'))).toBe(true);
    });

    it('reports error when "hover" step has non-object value', () => {
        const workflows = new Map<string, Workflow>([
            ['test', { name: 'test', steps: [{ hover: 'nope' } as unknown as Step] }],
        ]);
        const config = makeConfig({ workflows });
        const errors = validate(config);
        expect(errors.some((e) => e.message.includes('"hover" requires an object'))).toBe(true);
    });

    it('reports error when "select" step has non-object value', () => {
        const workflows = new Map<string, Workflow>([
            ['test', { name: 'test', steps: [{ select: 'nope' } as unknown as Step] }],
        ]);
        const config = makeConfig({ workflows });
        const errors = validate(config);
        expect(errors.some((e) => e.message.includes('"select" requires an object'))).toBe(true);
    });

    it('reports error when "scroll" step has non-object value', () => {
        const workflows = new Map<string, Workflow>([
            ['test', { name: 'test', steps: [{ scroll: 'nope' } as unknown as Step] }],
        ]);
        const config = makeConfig({ workflows });
        const errors = validate(config);
        expect(errors.some((e) => e.message.includes('"scroll" requires an object'))).toBe(true);
    });

    // --- set-viewport ---

    it('reports error when "set-viewport" references unknown viewport', () => {
        const workflows = new Map<string, Workflow>([
            ['test', { name: 'test', steps: [{ 'set-viewport': 'tablet' }] }],
        ]);
        const config = makeConfig({ workflows, viewports: { desktop: { width: 1280, height: 720 } } });
        const errors = validate(config);
        expect(errors.some((e) => e.message.includes('unknown viewport "tablet"'))).toBe(true);
    });

    it('accepts set-viewport with known viewport', () => {
        const workflows = new Map<string, Workflow>([
            ['test', { name: 'test', steps: [{ 'set-viewport': 'desktop' }] }],
        ]);
        const config = makeConfig({ workflows, viewports: { desktop: { width: 1280, height: 720 } } });
        const errors = validate(config);
        expect(errors.some((e) => e.message.includes('unknown viewport'))).toBe(false);
    });

    it('reports error when "set-viewport" has non-string value', () => {
        const workflows = new Map<string, Workflow>([
            ['test', { name: 'test', steps: [{ 'set-viewport': 123 } as unknown as Step] }],
        ]);
        const config = makeConfig({ workflows });
        const errors = validate(config);
        expect(errors.some((e) => e.message.includes('"set-viewport" requires a string'))).toBe(true);
    });

    // --- Self-dependency ---

    it('reports error for self-dependency', () => {
        const workflows = new Map<string, Workflow>([
            ['self', { name: 'self', depends_on: ['self'], steps: [{ screenshot: 'snap' }] }],
        ]);
        const config = makeConfig({ workflows });
        const errors = validate(config);
        expect(errors.some((e) => e.message.includes('cannot depend on itself'))).toBe(true);
    });

    // --- Missing dependency ---

    it('reports error for missing dependency reference', () => {
        const workflows = new Map<string, Workflow>([
            ['flow', { name: 'flow', depends_on: ['nonexistent'], steps: [{ screenshot: 'snap' }] }],
        ]);
        const config = makeConfig({ workflows });
        const errors = validate(config);
        expect(errors.some((e) => e.message.includes('"nonexistent" not found'))).toBe(true);
    });

    // --- Missing include ---

    it('reports error for missing include reference in workflow', () => {
        const workflows = new Map<string, Workflow>([['flow', { name: 'flow', steps: [{ include: 'ghost' }] }]]);
        const config = makeConfig({ workflows });
        const errors = validate(config);
        expect(errors.some((e) => e.message.includes('Include reference "ghost" not found'))).toBe(true);
    });

    it('reports error for missing include reference inside an include', () => {
        const includes = new Map<string, Include>([['inc-a', { name: 'inc-a', steps: [{ include: 'inc-missing' }] }]]);
        const config = makeConfig({ includes });
        const errors = validate(config);
        expect(errors.some((e) => e.message.includes('Include reference "inc-missing" not found'))).toBe(true);
    });

    // --- Filename / name mismatch ---

    it('reports error when workflow filename does not match name field', () => {
        vi.mocked(fs.existsSync).mockImplementation((p) => {
            return String(p).endsWith('workflows');
        });
        vi.mocked(fs.readdirSync).mockImplementation((p) => {
            if (String(p).endsWith('workflows')) {
                return ['login.yml'] as unknown as ReturnType<typeof fs.readdirSync>;
            }
            return [] as unknown as ReturnType<typeof fs.readdirSync>;
        });

        const workflows = new Map<string, Workflow>([
            ['login', { name: 'wrong-name', steps: [{ screenshot: 'snap' }] }],
        ]);
        const config = makeConfig({ workflows });
        const errors = validate(config);
        expect(errors.some((e) => e.message.includes('does not match name field'))).toBe(true);
    });

    // --- Circular include detection ---

    it('detects A->B->A circular include cycle', () => {
        const includes = new Map<string, Include>([
            ['a', { name: 'a', steps: [{ include: 'b' }] }],
            ['b', { name: 'b', steps: [{ include: 'a' }] }],
        ]);
        const config = makeConfig({ includes });
        const errors = validate(config);
        expect(errors.some((e) => e.message.includes('Circular include detected'))).toBe(true);
    });

    it('detects deeper circular include chain A->B->C->A', () => {
        const includes = new Map<string, Include>([
            ['a', { name: 'a', steps: [{ include: 'b' }] }],
            ['b', { name: 'b', steps: [{ include: 'c' }] }],
            ['c', { name: 'c', steps: [{ include: 'a' }] }],
        ]);
        const config = makeConfig({ includes });
        const errors = validate(config);
        expect(errors.some((e) => e.message.includes('Circular include detected'))).toBe(true);
    });

    it('does not report circular include when there is none', () => {
        const includes = new Map<string, Include>([
            ['a', { name: 'a', steps: [{ include: 'b' }] }],
            ['b', { name: 'b', steps: [{ screenshot: 'snap' }] }],
        ]);
        const config = makeConfig({ includes });
        const errors = validate(config);
        expect(errors.some((e) => e.message.includes('Circular include'))).toBe(false);
    });

    // --- Circular workflow dependency ---

    it('detects circular workflow dependency', () => {
        const workflows = new Map<string, Workflow>([
            ['a', { name: 'a', depends_on: ['b'], steps: [{ screenshot: 'snap' }] }],
            ['b', { name: 'b', depends_on: ['a'], steps: [{ screenshot: 'snap' }] }],
        ]);
        const config = makeConfig({ workflows });
        const errors = validate(config);
        expect(errors.some((e) => e.message.includes('Circular workflow dependency'))).toBe(true);
    });

    // --- Valid config ---

    it('returns no errors for a valid minimal config', () => {
        const workflows = new Map<string, Workflow>([
            ['homepage', { name: 'homepage', steps: [{ open: '/' }, { screenshot: 'home' }] }],
        ]);
        const config = makeConfig({ workflows });
        const errors = validate(config);
        expect(errors.filter((e) => e.severity === 'error')).toHaveLength(0);
    });

    // --- Plan validation ---

    it('reports error when plan has empty workflows list', () => {
        const plans = new Map<string, Plan>([['empty-plan', { name: 'empty-plan', workflows: [] }]]);
        const config = makeConfig({ plans });
        const errors = validate(config);
        expect(errors.some((e) => e.message.includes('at least one workflow entry'))).toBe(true);
    });

    it('reports error when plan references missing workflow', () => {
        const plans = new Map<string, Plan>([['my-plan', { name: 'my-plan', workflows: ['nonexistent'] }]]);
        const config = makeConfig({ plans });
        const errors = validate(config);
        expect(errors.some((e) => e.message.includes('Workflow reference "nonexistent" not found'))).toBe(true);
    });

    it('accepts plan that references existing workflows', () => {
        const workflows = new Map<string, Workflow>([['flow', { name: 'flow', steps: [{ screenshot: 'snap' }] }]]);
        const plans = new Map<string, Plan>([['my-plan', { name: 'my-plan', workflows: ['flow'] }]]);
        const config = makeConfig({ workflows, plans });
        const errors = validate(config);
        expect(errors.some((e) => e.message.includes('not found') && e.file.includes('plan'))).toBe(false);
    });

    // --- Teardown validation ---

    it('validates steps in teardown', () => {
        const teardown: Step[] = [{ bogus: 'value' } as unknown as Step];
        const config = makeConfig({ teardown });
        const errors = validate(config);
        expect(errors.some((e) => e.file.includes('teardown') && e.message.includes('Unknown step type'))).toBe(true);
    });

    it('validates include references in teardown', () => {
        const teardown: Step[] = [{ include: 'cleanup' }];
        const config = makeConfig({ teardown });
        const errors = validate(config);
        expect(
            errors.some(
                (e) => e.file.includes('teardown') && e.message.includes('Include reference "cleanup" not found'),
            ),
        ).toBe(true);
    });

    // --- Include validation ---

    it('reports error when include has no steps', () => {
        const includes = new Map<string, Include>([['empty', { name: 'empty', steps: [] }]]);
        const config = makeConfig({ includes });
        const errors = validate(config);
        expect(errors.some((e) => e.message.includes('Include must have at least one step'))).toBe(true);
    });

    // --- Step with no keys ---

    it('reports error for step with no keys', () => {
        const workflows = new Map<string, Workflow>([['test', { name: 'test', steps: [{} as unknown as Step] }]]);
        const config = makeConfig({ workflows });
        const errors = validate(config);
        expect(errors.some((e) => e.message.includes('Step has no keys'))).toBe(true);
    });
});
