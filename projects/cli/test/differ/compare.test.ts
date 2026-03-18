import type { ImageCodec, RawImage } from '@megatest/core';
import { describe, expect, it } from 'vitest';
import { compareScreenshots } from '../../src/differ/compare.js';

/** Create a simple mock codec that stores decoded images and captures encode calls */
function createMockCodec(images: Record<string, RawImage>): ImageCodec & { encodedPaths: string[] } {
    const encodedPaths: string[] = [];
    return {
        extension: '.png',
        mimeType: 'image/png',
        encodedPaths,
        async decode(filePath: string): Promise<RawImage> {
            const img = images[filePath];
            if (!img) throw new Error(`Mock codec: no image at ${filePath}`);
            return img;
        },
        async encode(_image: RawImage, outputPath: string): Promise<void> {
            encodedPaths.push(outputPath);
        },
        async writeScreenshot(_buf: Buffer, _outputPath: string): Promise<void> {},
    };
}

/** Create a solid-color RGBA image buffer */
function makeImage(width: number, height: number, rgba: [number, number, number, number]): RawImage {
    const data = Buffer.alloc(width * height * 4);
    for (let i = 0; i < width * height; i++) {
        data[i * 4] = rgba[0];
        data[i * 4 + 1] = rgba[1];
        data[i * 4 + 2] = rgba[2];
        data[i * 4 + 3] = rgba[3];
    }
    return { data, width, height };
}

describe('compareScreenshots', () => {
    it('returns dimension mismatch when sizes differ', async () => {
        const baseline = makeImage(100, 100, [255, 0, 0, 255]);
        const actual = makeImage(200, 100, [255, 0, 0, 255]);

        const codec = createMockCodec({
            '/baselines/test.png': baseline,
            '/actuals/test.png': actual,
        });

        const result = await compareScreenshots(
            '/baselines/test.png',
            '/actuals/test.png',
            '/diff/test.png',
            0.1,
            codec,
        );

        expect(result.dimensionMismatch).toBe(true);
        expect(result.diffPercent).toBe(100);
        expect(result.diffPixels).toBe(-1);
        expect(result.totalPixels).toBe(10000); // baseline dimensions
    });

    it('returns zero diff for identical images', async () => {
        const image = makeImage(50, 50, [128, 128, 128, 255]);

        const codec = createMockCodec({
            '/baselines/test.png': image,
            '/actuals/test.png': image,
        });

        const result = await compareScreenshots(
            '/baselines/test.png',
            '/actuals/test.png',
            '/diff/test.png',
            0.1,
            codec,
        );

        expect(result.dimensionMismatch).toBe(false);
        expect(result.diffPixels).toBe(0);
        expect(result.diffPercent).toBe(0);
        expect(result.totalPixels).toBe(2500);
    });

    it('returns nonzero diff for different images', async () => {
        const baseline = makeImage(10, 10, [255, 0, 0, 255]); // solid red
        const actual = makeImage(10, 10, [0, 0, 255, 255]); // solid blue

        const codec = createMockCodec({
            '/baselines/test.png': baseline,
            '/actuals/test.png': actual,
        });

        const result = await compareScreenshots(
            '/baselines/test.png',
            '/actuals/test.png',
            '/diff/test.png',
            0.1,
            codec,
        );

        expect(result.dimensionMismatch).toBe(false);
        expect(result.diffPixels).toBeGreaterThan(0);
        expect(result.diffPercent).toBeGreaterThan(0);
        expect(result.totalPixels).toBe(100);
    });

    it('writes diff image via codec encode', async () => {
        const baseline = makeImage(10, 10, [255, 0, 0, 255]);
        const actual = makeImage(10, 10, [0, 255, 0, 255]);

        const codec = createMockCodec({
            '/baselines/test.png': baseline,
            '/actuals/test.png': actual,
        });

        await compareScreenshots('/baselines/test.png', '/actuals/test.png', '/diff/output.png', 0.1, codec);

        expect(codec.encodedPaths).toContain('/diff/output.png');
    });

    it('returns 100% diff for completely different images', async () => {
        // Use large threshold difference to ensure all pixels differ
        const baseline = makeImage(10, 10, [0, 0, 0, 255]); // black
        const actual = makeImage(10, 10, [255, 255, 255, 255]); // white

        const codec = createMockCodec({
            '/baselines/test.png': baseline,
            '/actuals/test.png': actual,
        });

        const result = await compareScreenshots(
            '/baselines/test.png',
            '/actuals/test.png',
            '/diff/test.png',
            0.1,
            codec,
        );

        expect(result.diffPercent).toBe(100);
        expect(result.diffPixels).toBe(100);
    });

    it('handles height mismatch', async () => {
        const baseline = makeImage(100, 50, [0, 0, 0, 255]);
        const actual = makeImage(100, 100, [0, 0, 0, 255]);

        const codec = createMockCodec({
            '/baselines/test.png': baseline,
            '/actuals/test.png': actual,
        });

        const result = await compareScreenshots(
            '/baselines/test.png',
            '/actuals/test.png',
            '/diff/test.png',
            0.1,
            codec,
        );

        expect(result.dimensionMismatch).toBe(true);
    });
});
