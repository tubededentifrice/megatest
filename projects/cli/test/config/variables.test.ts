import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { interpolateStep, interpolateVariables, interpolateWorkflow } from '../../src/config/variables.js';

// Mock the totp module so we don't depend on real HMAC computation
vi.mock('../../src/config/totp.js', () => ({
    generateTOTP: vi.fn((secret: string) => `totp(${secret})`),
}));

describe('interpolateVariables', () => {
    const env = process.env;

    beforeEach(() => {
        process.env = { ...env };
    });

    afterEach(() => {
        process.env = env;
    });

    it('replaces ${VAR} from variables map', () => {
        const { result, warnings } = interpolateVariables('Hello ${NAME}', { NAME: 'world' });
        expect(result).toBe('Hello world');
        expect(warnings).toHaveLength(0);
    });

    it('replaces ${env:VAR} from process.env', () => {
        process.env.TEST_USER = 'alice';
        const { result, warnings } = interpolateVariables('User: ${env:TEST_USER}', {});
        expect(result).toBe('User: alice');
        expect(warnings).toHaveLength(0);
    });

    it('leaves placeholder and warns for missing variable', () => {
        const { result, warnings } = interpolateVariables('${MISSING}', {});
        expect(result).toBe('${MISSING}');
        expect(warnings).toContain('Variable not defined: MISSING');
    });

    it('leaves placeholder and warns for missing env variable', () => {
        process.env.NO_SUCH_VAR = undefined;
        const { result, warnings } = interpolateVariables('${env:NO_SUCH_VAR}', {});
        expect(result).toBe('${env:NO_SUCH_VAR}');
        expect(warnings).toContain('Environment variable not set: NO_SUCH_VAR');
    });

    it('handles multiple substitutions in one string', () => {
        const { result, warnings } = interpolateVariables('${GREETING} ${TARGET}!', {
            GREETING: 'Hello',
            TARGET: 'world',
        });
        expect(result).toBe('Hello world!');
        expect(warnings).toHaveLength(0);
    });

    it('returns unchanged string when no variables present', () => {
        const { result, warnings } = interpolateVariables('no vars here', { X: 'unused' });
        expect(result).toBe('no vars here');
        expect(warnings).toHaveLength(0);
    });

    it('replaces ${totp:VAR} using variables map secret', () => {
        const { result, warnings } = interpolateVariables('Code: ${totp:SECRET}', { SECRET: 'JBSWY3DP' });
        expect(result).toBe('Code: totp(JBSWY3DP)');
        expect(warnings).toHaveLength(0);
    });

    it('replaces ${totp:env:VAR} using env var secret', () => {
        process.env.TOTP_SECRET = 'ENVBASE32';
        const { result, warnings } = interpolateVariables('Code: ${totp:env:TOTP_SECRET}', {});
        expect(result).toBe('Code: totp(ENVBASE32)');
        expect(warnings).toHaveLength(0);
    });

    it('warns for missing totp variable', () => {
        const { result, warnings } = interpolateVariables('${totp:MISSING}', {});
        expect(result).toBe('${totp:MISSING}');
        expect(warnings).toContain('Variable not defined for TOTP: MISSING');
    });

    it('warns for missing totp env variable', () => {
        process.env.NO_TOTP = undefined;
        const { result, warnings } = interpolateVariables('${totp:env:NO_TOTP}', {});
        expect(result).toBe('${totp:env:NO_TOTP}');
        expect(warnings).toContain('Environment variable not set for TOTP: NO_TOTP');
    });

    it('handles mixed variable types in one string', () => {
        process.env.HOST = 'example.com';
        const { result, warnings } = interpolateVariables('https://${env:HOST}/${PATH}', { PATH: 'api' });
        expect(result).toBe('https://example.com/api');
        expect(warnings).toHaveLength(0);
    });
});

describe('interpolateStep', () => {
    it('interpolates string values in a step', () => {
        const step = { open: '${BASE_URL}/page' };
        const { step: result, warnings } = interpolateStep(step, { BASE_URL: 'https://example.com' });
        expect(result).toEqual({ open: 'https://example.com/page' });
        expect(warnings).toHaveLength(0);
    });

    it('interpolates nested object values', () => {
        const step = { fill: { css: '#input', value: '${USER}' } };
        const { step: result, warnings } = interpolateStep(step, { USER: 'admin' });
        expect(result).toEqual({ fill: { css: '#input', value: 'admin' } });
        expect(warnings).toHaveLength(0);
    });

    it('passes through non-string values unchanged', () => {
        const step = { wait: 1000 };
        const { step: result, warnings } = interpolateStep(step, {});
        expect(result).toEqual({ wait: 1000 });
        expect(warnings).toHaveLength(0);
    });

    it('interpolates arrays within steps', () => {
        // Construct a step-like object with an array (hypothetical)
        const step = { scroll: { down: 100, right: 50 } };
        const { step: result } = interpolateStep(step, {});
        expect(result).toEqual({ scroll: { down: 100, right: 50 } });
    });

    it('collects warnings from nested interpolation', () => {
        const step = { fill: { css: '${SELECTOR}', value: '${VALUE}' } };
        const { warnings } = interpolateStep(step, {});
        expect(warnings).toHaveLength(2);
        expect(warnings).toContain('Variable not defined: SELECTOR');
        expect(warnings).toContain('Variable not defined: VALUE');
    });

    it('handles boolean values by passing them through', () => {
        // Force an object with a boolean value for testing
        const step = { click: { css: '#btn', force: true } } as unknown as import('../../src/config/schema.js').Step;
        const { step: result } = interpolateStep(step, {});
        expect((result as Record<string, unknown>).click).toEqual({ css: '#btn', force: true });
    });

    it('handles null values by passing them through', () => {
        const step = { click: { css: '#btn', name: null } } as unknown as import('../../src/config/schema.js').Step;
        const { step: result } = interpolateStep(step, {});
        expect((result as Record<string, unknown>).click).toEqual({ css: '#btn', name: null });
    });
});

describe('interpolateWorkflow', () => {
    it('interpolates all steps and the workflow name', () => {
        const workflow = {
            name: '${APP}-flow',
            steps: [{ open: '${BASE}/' }, { screenshot: 'home' }],
        };
        const { workflow: result, warnings } = interpolateWorkflow(workflow, {
            APP: 'myapp',
            BASE: 'https://example.com',
        });
        expect(result.name).toBe('myapp-flow');
        expect(result.steps[0]).toEqual({ open: 'https://example.com/' });
        expect(result.steps[1]).toEqual({ screenshot: 'home' });
        expect(warnings).toHaveLength(0);
    });

    it('interpolates the description if present', () => {
        const workflow = {
            name: 'test',
            description: 'Testing ${ENV}',
            steps: [{ screenshot: 'snap' }],
        };
        const { workflow: result, warnings } = interpolateWorkflow(workflow, { ENV: 'staging' });
        expect(result.description).toBe('Testing staging');
        expect(warnings).toHaveLength(0);
    });

    it('accumulates warnings from all steps', () => {
        const workflow = {
            name: 'flow',
            steps: [{ open: '${URL}' }, { fill: { css: '#x', value: '${VAL}' } }],
        };
        const { warnings } = interpolateWorkflow(workflow, {});
        expect(warnings).toContain('Variable not defined: URL');
        expect(warnings).toContain('Variable not defined: VAL');
        expect(warnings.length).toBeGreaterThanOrEqual(2);
    });

    it('preserves undefined description', () => {
        const workflow = {
            name: 'flow',
            steps: [{ screenshot: 'snap' }],
        };
        const { workflow: result } = interpolateWorkflow(workflow, {});
        expect(result.description).toBeUndefined();
    });
});
