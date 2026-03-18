import type { RunResult } from '@megatest/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    printProgress,
    printStepComplete,
    printStepError,
    printSummary,
    printTaskComplete,
    printTaskError,
    printTaskStart,
} from '../../src/reporter/console.js';

describe('console reporter', () => {
    let stdoutSpy: ReturnType<typeof vi.spyOn>;
    let logSpy: ReturnType<typeof vi.spyOn>;
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
        logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        stdoutSpy.mockRestore();
        logSpy.mockRestore();
        errorSpy.mockRestore();
    });

    describe('printSummary', () => {
        it('prints all-pass summary', () => {
            const result: RunResult = {
                commitHash: 'abc1234',
                timestamp: '2024-01-01T00:00:00Z',
                checkpoints: [],
                passed: 5,
                failed: 0,
                newCount: 0,
                errors: 0,
                duration: 3000,
            };
            printSummary(result);

            // Should log passed count
            const allOutput = logSpy.mock.calls.map((c) => c[0]).join('\n');
            expect(allOutput).toContain('5 passed');
            expect(allOutput).toContain('All 5 checkpoints passed');
            expect(allOutput).toContain('abc1234');
        });

        it('prints mixed results summary', () => {
            const result: RunResult = {
                commitHash: 'def5678',
                timestamp: '2024-01-01T00:00:00Z',
                checkpoints: [],
                passed: 3,
                failed: 2,
                newCount: 1,
                errors: 1,
                duration: 10000,
            };
            printSummary(result);

            const allOutput = logSpy.mock.calls.map((c) => c[0]).join('\n');
            expect(allOutput).toContain('3 passed');
            expect(allOutput).toContain('2 changed');
            expect(allOutput).toContain('1 new');
            expect(allOutput).toContain('1 failed');
            expect(allOutput).toContain('7 checkpoints total');
        });

        it('omits categories with zero count', () => {
            const result: RunResult = {
                commitHash: 'abc1234',
                timestamp: '2024-01-01T00:00:00Z',
                checkpoints: [],
                passed: 2,
                failed: 0,
                newCount: 1,
                errors: 0,
                duration: 1000,
            };
            printSummary(result);

            const allOutput = logSpy.mock.calls.map((c) => c[0]).join('\n');
            expect(allOutput).toContain('2 passed');
            expect(allOutput).toContain('1 new');
            expect(allOutput).not.toContain('changed');
            expect(allOutput).not.toContain('failed');
        });
    });

    describe('printProgress', () => {
        it('writes progress line to stdout', () => {
            printProgress(1, 10, 'homepage', 'desktop', 3, 5);

            expect(stdoutSpy).toHaveBeenCalled();
            const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
            expect(output).toContain('1/10');
            expect(output).toContain('homepage');
            expect(output).toContain('desktop');
            expect(output).toContain('3/5');
        });
    });

    describe('printStepComplete', () => {
        it('outputs completion message', () => {
            printStepComplete(2, 10, 'login', 'mobile');

            expect(stdoutSpy).toHaveBeenCalled(); // clears progress line
            const logOutput = logSpy.mock.calls.map((c) => c[0]).join('\n');
            expect(logOutput).toContain('2/10');
            expect(logOutput).toContain('login');
            expect(logOutput).toContain('mobile');
        });
    });

    describe('printStepError', () => {
        it('outputs error message', () => {
            printStepError(3, 10, 'checkout', 'desktop', 'Timeout');

            const errorOutput = errorSpy.mock.calls.map((c) => c[0]).join('\n');
            expect(errorOutput).toContain('3/10');
            expect(errorOutput).toContain('checkout');
            expect(errorOutput).toContain('Timeout');
        });

        it('includes step detail when provided', () => {
            printStepError(1, 5, 'flow', 'desktop', 'Element not found', 'click: #btn');

            const errorOutput = errorSpy.mock.calls.map((c) => c[0]).join('\n');
            expect(errorOutput).toContain('Element not found');
            expect(errorOutput).toContain('click: #btn');
        });
    });

    describe('printTaskStart', () => {
        it('outputs start message', () => {
            printTaskStart(1, 5, 'homepage', 'desktop');

            const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
            expect(output).toContain('1/5');
            expect(output).toContain('Starting');
            expect(output).toContain('homepage');
            expect(output).toContain('desktop');
        });
    });

    describe('printTaskComplete', () => {
        it('outputs task completion with duration', () => {
            printTaskComplete(2, 5, 'login', 'mobile', 8, 3500);

            const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
            expect(output).toContain('2/5');
            expect(output).toContain('login');
            expect(output).toContain('mobile');
            expect(output).toContain('8 steps');
            expect(output).toContain('3.5s');
        });
    });

    describe('printTaskError', () => {
        it('outputs task error message', () => {
            printTaskError(3, 5, 'checkout', 'desktop', 'Browser crashed');

            const errorOutput = errorSpy.mock.calls.map((c) => c[0]).join('\n');
            expect(errorOutput).toContain('3/5');
            expect(errorOutput).toContain('checkout');
            expect(errorOutput).toContain('Browser crashed');
        });

        it('includes step detail when provided', () => {
            printTaskError(1, 5, 'flow', 'desktop', 'Failure', 'eval: window.x');

            const errorOutput = errorSpy.mock.calls.map((c) => c[0]).join('\n');
            expect(errorOutput).toContain('Failure');
            expect(errorOutput).toContain('eval: window.x');
        });
    });
});
