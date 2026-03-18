import type { CheckpointResult, RunResult } from '@megatest/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateHtmlReport } from '../../src/reporter/html.js';

vi.mock('node:fs', () => ({
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
}));

import * as fs from 'node:fs';

function makeCheckpoint(overrides: Partial<CheckpointResult> = {}): CheckpointResult {
    return {
        workflow: 'homepage',
        checkpoint: 'hero',
        viewport: 'desktop',
        status: 'pass',
        diffPercent: 0,
        diffPixels: 0,
        totalPixels: 921600,
        dimensionMismatch: false,
        baselinePath: '/baselines/hero-desktop.png',
        actualPath: null,
        diffPath: null,
        error: null,
        ...overrides,
    };
}

function makeRunResult(checkpoints: CheckpointResult[]): RunResult {
    const passed = checkpoints.filter((cp) => cp.status === 'pass').length;
    const failed = checkpoints.filter((cp) => cp.status === 'fail').length;
    const newCount = checkpoints.filter((cp) => cp.status === 'new').length;
    const errors = checkpoints.filter((cp) => cp.status === 'error').length;
    return {
        commitHash: 'abc1234',
        timestamp: '2024-01-15T10:30:00Z',
        checkpoints,
        passed,
        failed,
        newCount,
        errors,
        duration: 5000,
    };
}

describe('generateHtmlReport', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
        vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
    });

    it('generates report with mixed statuses', () => {
        const checkpoints = [
            makeCheckpoint({ status: 'pass', workflow: 'home', checkpoint: 'hero' }),
            makeCheckpoint({
                status: 'fail',
                workflow: 'home',
                checkpoint: 'footer',
                diffPercent: 5.2,
                diffPixels: 100,
            }),
            makeCheckpoint({ status: 'new', workflow: 'about', checkpoint: 'banner' }),
            makeCheckpoint({ status: 'error', workflow: 'login', checkpoint: 'form', error: 'Timeout' }),
        ];
        const result = makeRunResult(checkpoints);
        const outputPath = generateHtmlReport(result, '/reports/abc1234', '/baselines');

        expect(outputPath).toBe('/reports/abc1234/index.html');
        expect(fs.mkdirSync).toHaveBeenCalledWith('/reports/abc1234', { recursive: true });

        // Check HTML was written
        const htmlCall = vi.mocked(fs.writeFileSync).mock.calls.find((call) => String(call[0]).endsWith('index.html'));
        expect(htmlCall).toBeDefined();
        const html = htmlCall?.[1] as string;

        // Contains badges for different statuses
        expect(html).toContain('1 passed');
        expect(html).toContain('1 changed');
        expect(html).toContain('1 new');
        expect(html).toContain('1 failed');
    });

    it('all-passing report has correct badge counts', () => {
        const checkpoints = [
            makeCheckpoint({ status: 'pass', workflow: 'home', checkpoint: 'hero' }),
            makeCheckpoint({ status: 'pass', workflow: 'home', checkpoint: 'footer' }),
            makeCheckpoint({ status: 'pass', workflow: 'about', checkpoint: 'banner' }),
        ];
        const result = makeRunResult(checkpoints);
        generateHtmlReport(result, '/reports/abc1234', '/baselines');

        const htmlCall = vi.mocked(fs.writeFileSync).mock.calls.find((call) => String(call[0]).endsWith('index.html'));
        const html = htmlCall?.[1] as string;
        expect(html).toContain('3 passed');
        // No "changed" or "new" badges should appear in the header bar
        // (the word "changed" exists in CSS class names, so match the badge specifically)
        expect(html).not.toMatch(/\d+ changed/);
        expect(html).not.toMatch(/\d+ new/);
    });

    it('writes meta.json with correct data', () => {
        const checkpoints = [makeCheckpoint({ status: 'pass' }), makeCheckpoint({ status: 'fail', diffPercent: 1.5 })];
        const result = makeRunResult(checkpoints);
        generateHtmlReport(result, '/reports/abc1234', '/baselines');

        const metaCall = vi.mocked(fs.writeFileSync).mock.calls.find((call) => String(call[0]).endsWith('meta.json'));
        expect(metaCall).toBeDefined();
        const meta = JSON.parse(metaCall?.[1] as string);
        expect(meta.commitHash).toBe('abc1234');
        expect(meta.passed).toBe(1);
        expect(meta.failed).toBe(1);
        expect(meta.totalCheckpoints).toBe(2);
        expect(meta.duration).toBe(5000);
    });

    it('writes results.json with checkpoint data', () => {
        const checkpoints = [makeCheckpoint({ status: 'pass', workflow: 'flow1', checkpoint: 'cp1' })];
        const result = makeRunResult(checkpoints);
        generateHtmlReport(result, '/reports/abc1234', '/baselines');

        const resultsCall = vi
            .mocked(fs.writeFileSync)
            .mock.calls.find((call) => String(call[0]).endsWith('results.json'));
        expect(resultsCall).toBeDefined();
        const data = JSON.parse(resultsCall?.[1] as string);
        expect(data.extension).toBe('.png');
        expect(data.checkpoints).toHaveLength(1);
        expect(data.checkpoints[0].workflow).toBe('flow1');
        expect(data.checkpoints[0].checkpoint).toBe('cp1');
        expect(data.checkpoints[0].status).toBe('pass');
    });

    it('escapes special HTML characters', () => {
        const checkpoints = [
            makeCheckpoint({
                status: 'error',
                workflow: '<script>alert("xss")</script>',
                checkpoint: 'test&check',
                error: 'Error: "quoted" <value>',
            }),
        ];
        const result = makeRunResult(checkpoints);
        generateHtmlReport(result, '/reports/abc1234', '/baselines');

        const htmlCall = vi.mocked(fs.writeFileSync).mock.calls.find((call) => String(call[0]).endsWith('index.html'));
        const html = htmlCall?.[1] as string;

        // Should contain escaped versions, not raw HTML
        expect(html).toContain('&lt;script&gt;');
        expect(html).toContain('test&amp;check');
        expect(html).toContain('&quot;quoted&quot;');
        expect(html).not.toContain('<script>alert');
    });

    it('uses custom extension when provided', () => {
        const checkpoints = [makeCheckpoint({ status: 'pass' })];
        const result = makeRunResult(checkpoints);
        generateHtmlReport(result, '/reports/abc1234', '/baselines', '.webp');

        const resultsCall = vi
            .mocked(fs.writeFileSync)
            .mock.calls.find((call) => String(call[0]).endsWith('results.json'));
        const data = JSON.parse(resultsCall?.[1] as string);
        expect(data.extension).toBe('.webp');
    });

    it('renders commit hash and timestamp in HTML', () => {
        const checkpoints = [makeCheckpoint({ status: 'pass' })];
        const result = makeRunResult(checkpoints);
        generateHtmlReport(result, '/reports/abc1234', '/baselines');

        const htmlCall = vi.mocked(fs.writeFileSync).mock.calls.find((call) => String(call[0]).endsWith('index.html'));
        const html = htmlCall?.[1] as string;
        expect(html).toContain('abc1234');
        expect(html).toContain('2024-01-15T10:30:00Z');
    });
});
