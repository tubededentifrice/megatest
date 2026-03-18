import { describe, expect, it } from 'vitest';
import type { Include, Step } from '../../src/config/schema.js';
import { formatStepSummary, resolveIncludes } from '../../src/runner/utils.js';

describe('resolveIncludes', () => {
    it('expands a simple include', () => {
        const steps: Step[] = [{ open: '/' }, { include: 'auth' }, { screenshot: 'home' }];
        const includes = new Map<string, Include>([
            [
                'auth',
                {
                    name: 'auth',
                    steps: [{ fill: { css: '#user', value: 'admin' } }, { click: { css: '#login' } }],
                },
            ],
        ]);

        const resolved = resolveIncludes(steps, includes);
        expect(resolved).toHaveLength(4);
        expect(resolved[0]).toEqual({ open: '/' });
        expect(resolved[1]).toEqual({ fill: { css: '#user', value: 'admin' } });
        expect(resolved[2]).toEqual({ click: { css: '#login' } });
        expect(resolved[3]).toEqual({ screenshot: 'home' });
    });

    it('handles nested includes', () => {
        const steps: Step[] = [{ include: 'outer' }];
        const includes = new Map<string, Include>([
            [
                'outer',
                {
                    name: 'outer',
                    steps: [{ include: 'inner' }, { screenshot: 'after-inner' }],
                },
            ],
            [
                'inner',
                {
                    name: 'inner',
                    steps: [{ open: '/page' }],
                },
            ],
        ]);

        const resolved = resolveIncludes(steps, includes);
        expect(resolved).toHaveLength(2);
        expect(resolved[0]).toEqual({ open: '/page' });
        expect(resolved[1]).toEqual({ screenshot: 'after-inner' });
    });

    it('throws on circular include', () => {
        const steps: Step[] = [{ include: 'a' }];
        const includes = new Map<string, Include>([
            ['a', { name: 'a', steps: [{ include: 'b' }] }],
            ['b', { name: 'b', steps: [{ include: 'a' }] }],
        ]);

        expect(() => resolveIncludes(steps, includes)).toThrow('Circular include detected: a');
    });

    it('throws when include is not found', () => {
        const steps: Step[] = [{ include: 'missing' }];
        const includes = new Map<string, Include>();

        expect(() => resolveIncludes(steps, includes)).toThrow('Include not found: missing');
    });

    it('returns steps unchanged when there are no includes', () => {
        const steps: Step[] = [{ open: '/' }, { screenshot: 'snap' }];
        const includes = new Map<string, Include>();

        const resolved = resolveIncludes(steps, includes);
        expect(resolved).toEqual(steps);
    });

    it('treats repeated include in the same step list as circular', () => {
        // The visited set persists across siblings, so using the same
        // include twice at the same level is treated as circular.
        const steps: Step[] = [{ include: 'shared' }, { screenshot: 'mid' }, { include: 'shared' }];
        const includes = new Map<string, Include>([['shared', { name: 'shared', steps: [{ wait: 500 }] }]]);

        expect(() => resolveIncludes(steps, includes)).toThrow('Circular include detected: shared');
    });
});

describe('formatStepSummary', () => {
    it('returns step type alone for null data', () => {
        expect(formatStepSummary('screenshot', null)).toBe('screenshot');
    });

    it('returns step type alone for undefined data', () => {
        expect(formatStepSummary('screenshot', undefined)).toBe('screenshot');
    });

    it('formats string data', () => {
        expect(formatStepSummary('open', '/page')).toBe('open: /page');
    });

    it('formats number data', () => {
        expect(formatStepSummary('wait', 1000)).toBe('wait: 1000');
    });

    it('formats object data', () => {
        const result = formatStepSummary('click', { css: '#btn', name: 'Submit' });
        expect(result).toContain('click:');
        expect(result).toContain('css: "#btn"');
        expect(result).toContain('name: "Submit"');
    });

    it('truncates long string values in objects at 60 chars', () => {
        const longValue = 'a'.repeat(100);
        const result = formatStepSummary('eval', { code: longValue });
        expect(result).toContain('...');
        expect(result).not.toContain(longValue);
        // The truncated portion should be 57 chars + '...'
        expect(result).toContain('a'.repeat(57) + '...');
    });

    it('uses JSON.stringify for non-string, non-object, non-number data', () => {
        const result = formatStepSummary('eval', true);
        expect(result).toBe('eval: true');
    });

    it('handles object values that are not strings', () => {
        const result = formatStepSummary('scroll', { down: 100, right: 50 });
        expect(result).toContain('down: 100');
        expect(result).toContain('right: 50');
    });

    it('skips undefined values in object entries', () => {
        const result = formatStepSummary('click', { css: '#btn', extra: undefined });
        expect(result).toContain('css: "#btn"');
        expect(result).not.toContain('extra');
    });
});
