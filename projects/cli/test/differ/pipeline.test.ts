import type { CheckpointResult, ImageCodec } from '@megatest/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock node:fs
vi.mock('node:fs', () => ({
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    copyFileSync: vi.fn(),
    unlinkSync: vi.fn(),
}));

// Mock the compare module
vi.mock('../../src/differ/compare.js', () => ({
    compareScreenshots: vi.fn(),
}));

import * as fs from 'node:fs';
import { compareScreenshots } from '../../src/differ/compare.js';
import { type DiffPipelineOptions, runDiffPipeline } from '../../src/differ/pipeline.js';

function makeCheckpoint(overrides: Partial<CheckpointResult> = {}): CheckpointResult {
    return {
        workflow: 'homepage',
        checkpoint: 'hero',
        viewport: 'desktop',
        status: 'pass',
        diffPercent: null,
        diffPixels: null,
        totalPixels: null,
        dimensionMismatch: false,
        baselinePath: null,
        actualPath: '/actuals/hero-desktop.webp',
        diffPath: null,
        error: null,
        ...overrides,
    };
}

function makePipelineOpts(overrides: Partial<DiffPipelineOptions> = {}): DiffPipelineOptions {
    return {
        baselinesDir: '/baselines',
        actualsDir: '/actuals',
        reportDir: '/reports/abc1234',
        threshold: 0.1,
        codec: {
            extension: '.webp',
            mimeType: 'image/webp',
            decode: vi.fn(),
            encode: vi.fn(),
            writeScreenshot: vi.fn(),
        } as unknown as ImageCodec,
        ...overrides,
    };
}

describe('runDiffPipeline', () => {
    beforeEach(() => {
        vi.mocked(fs.existsSync).mockReturnValue(false);
        vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
        vi.mocked(fs.copyFileSync).mockReturnValue(undefined);
        vi.mocked(fs.unlinkSync).mockReturnValue(undefined);
        vi.mocked(compareScreenshots).mockReset();
    });

    it('passes error results through unchanged', async () => {
        const errorResult = makeCheckpoint({
            status: 'error',
            error: 'Browser crashed',
            actualPath: null,
        });
        const opts = makePipelineOpts();
        const results = await runDiffPipeline([errorResult], opts);

        expect(results).toHaveLength(1);
        expect(results[0].status).toBe('error');
        expect(results[0].error).toBe('Browser crashed');
    });

    it('marks result as "new" when baseline does not exist', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);

        const result = makeCheckpoint({ status: 'pass' });
        const opts = makePipelineOpts();
        const results = await runDiffPipeline([result], opts);

        expect(results).toHaveLength(1);
        expect(results[0].status).toBe('new');
        expect(results[0].baselinePath).toBeNull();
        // Should copy actual to report dir
        expect(fs.copyFileSync).toHaveBeenCalled();
    });

    it('marks result as "fail" when diff exceeds threshold', async () => {
        // Baseline exists
        vi.mocked(fs.existsSync).mockImplementation((p) => {
            if (String(p).includes('baselines')) return true;
            return false;
        });

        vi.mocked(compareScreenshots).mockResolvedValue({
            diffPixels: 500,
            diffPercent: 5.0,
            totalPixels: 10000,
            dimensionMismatch: false,
        });

        const result = makeCheckpoint({ status: 'pass' });
        const opts = makePipelineOpts({ threshold: 0.1 });
        const results = await runDiffPipeline([result], opts);

        expect(results).toHaveLength(1);
        expect(results[0].status).toBe('fail');
        expect(results[0].diffPercent).toBe(5.0);
        expect(results[0].diffPixels).toBe(500);
    });

    it('marks result as "pass" when diff is within threshold', async () => {
        // Baseline exists
        vi.mocked(fs.existsSync).mockImplementation((p) => {
            if (String(p).includes('baselines')) return true;
            // Simulate the diff file existing (it was just created by compareScreenshots)
            if (String(p).includes('diff')) return true;
            return false;
        });

        vi.mocked(compareScreenshots).mockResolvedValue({
            diffPixels: 2,
            diffPercent: 0.02,
            totalPixels: 10000,
            dimensionMismatch: false,
        });

        const result = makeCheckpoint({ status: 'pass' });
        const opts = makePipelineOpts({ threshold: 0.1 });
        const results = await runDiffPipeline([result], opts);

        expect(results).toHaveLength(1);
        expect(results[0].status).toBe('pass');
        expect(results[0].diffPercent).toBe(0.02);
        expect(results[0].actualPath).toBeNull(); // dedup: not saved
        expect(results[0].diffPath).toBeNull();
        // Diff file should be cleaned up
        expect(fs.unlinkSync).toHaveBeenCalled();
    });

    it('handles dimension mismatch as "fail"', async () => {
        vi.mocked(fs.existsSync).mockImplementation((p) => {
            if (String(p).includes('baselines')) return true;
            return false;
        });

        vi.mocked(compareScreenshots).mockResolvedValue({
            diffPixels: -1,
            diffPercent: 100,
            totalPixels: 10000,
            dimensionMismatch: true,
        });

        const result = makeCheckpoint({ status: 'pass' });
        const opts = makePipelineOpts();
        const results = await runDiffPipeline([result], opts);

        expect(results).toHaveLength(1);
        expect(results[0].status).toBe('fail');
        expect(results[0].dimensionMismatch).toBe(true);
        expect(results[0].diffPercent).toBe(100);
    });

    it('skips results with no actualPath', async () => {
        const result = makeCheckpoint({ status: 'pass', actualPath: null });
        const opts = makePipelineOpts();
        const results = await runDiffPipeline([result], opts);

        // Should pass through without calling compare
        expect(results).toHaveLength(1);
        expect(compareScreenshots).not.toHaveBeenCalled();
    });

    it('creates report directory', async () => {
        const result = makeCheckpoint({ status: 'error', actualPath: null });
        const opts = makePipelineOpts();
        await runDiffPipeline([result], opts);

        expect(fs.mkdirSync).toHaveBeenCalledWith('/reports/abc1234', { recursive: true });
    });
});
