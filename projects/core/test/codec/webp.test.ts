import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebpCodec } from '../../src/codec/webp.js';

describe('WebpCodec', () => {
    let tmpDir: string;
    let codec: WebpCodec;

    // A 4x4 solid red test image (RGBA, 4 channels).
    // Using 4x4 instead of 2x2 to avoid edge-case compression artifacts.
    const testWidth = 4;
    const testHeight = 4;
    const testPixels = Buffer.alloc(testWidth * testHeight * 4);
    for (let i = 0; i < testWidth * testHeight; i++) {
        testPixels[i * 4] = 255; // R
        testPixels[i * 4 + 1] = 0; // G
        testPixels[i * 4 + 2] = 0; // B
        testPixels[i * 4 + 3] = 255; // A
    }

    beforeAll(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'megatest-webp-test-'));
        codec = new WebpCodec();
    });

    afterAll(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    describe('decode()', () => {
        it('decodes a WebP file into raw RGBA data with correct dimensions', async () => {
            // First encode a known image so we have a valid WebP file to decode
            const filePath = path.join(tmpDir, 'decode-test.webp');
            await codec.encode({ data: testPixels, width: testWidth, height: testHeight }, filePath);

            const raw = await codec.decode(filePath);
            expect(raw.width).toBe(testWidth);
            expect(raw.height).toBe(testHeight);
            expect(raw.data.length).toBe(testWidth * testHeight * 4);
            // Lossless WebP should preserve pixel data exactly
            expect(Buffer.compare(raw.data, testPixels)).toBe(0);
        });
    });

    describe('encode()', () => {
        it('encodes raw RGBA data to a WebP file and roundtrips correctly', async () => {
            const outputPath = path.join(tmpDir, 'encode-test.webp');

            await codec.encode({ data: testPixels, width: testWidth, height: testHeight }, outputPath);

            // File should exist and have non-zero size
            expect(fs.existsSync(outputPath)).toBe(true);
            const stat = fs.statSync(outputPath);
            expect(stat.size).toBeGreaterThan(0);

            // Roundtrip: decode back and verify
            const decoded = await codec.decode(outputPath);
            expect(decoded.width).toBe(testWidth);
            expect(decoded.height).toBe(testHeight);
            expect(Buffer.compare(decoded.data, testPixels)).toBe(0);
        });
    });

    describe('writeScreenshot()', () => {
        it('converts a PNG buffer to WebP and writes to file', async () => {
            const outputPath = path.join(tmpDir, 'screenshot-test.webp');

            // Create a valid PNG buffer to simulate a Playwright screenshot
            const png = new PNG({ width: testWidth, height: testHeight });
            testPixels.copy(png.data);
            const pngBuffer = PNG.sync.write(png);

            await codec.writeScreenshot(pngBuffer, outputPath);

            // File should exist with non-zero size
            expect(fs.existsSync(outputPath)).toBe(true);
            const stat = fs.statSync(outputPath);
            expect(stat.size).toBeGreaterThan(0);

            // Decode the written WebP and verify pixel data survived the conversion
            const decoded = await codec.decode(outputPath);
            expect(decoded.width).toBe(testWidth);
            expect(decoded.height).toBe(testHeight);
            expect(Buffer.compare(decoded.data, testPixels)).toBe(0);
        });
    });

    it('has extension .webp', () => {
        expect(codec.extension).toBe('.webp');
    });

    it('has mimeType image/webp', () => {
        expect(codec.mimeType).toBe('image/webp');
    });
});
