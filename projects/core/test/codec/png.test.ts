import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PngCodec } from '../../src/codec/png.js';

describe('PngCodec', () => {
    let tmpDir: string;
    let codec: PngCodec;

    // A 2x2 red/green/blue/white test image (RGBA, 4 channels)
    const testWidth = 2;
    const testHeight = 2;
    const testPixels = Buffer.from([
        // Row 0: red, green
        255, 0, 0, 255, 0, 255, 0, 255,
        // Row 1: blue, white
        0, 0, 255, 255, 255, 255, 255, 255,
    ]);

    beforeAll(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'megatest-png-test-'));
        codec = new PngCodec();
    });

    afterAll(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    /** Helper: write a PNG file from raw pixels using pngjs directly. */
    function writePng(filePath: string, width: number, height: number, data: Buffer): void {
        const png = new PNG({ width, height });
        data.copy(png.data);
        fs.writeFileSync(filePath, PNG.sync.write(png));
    }

    describe('decode()', () => {
        it('decodes a PNG file into raw RGBA data with correct dimensions', async () => {
            const filePath = path.join(tmpDir, 'decode-test.png');
            writePng(filePath, testWidth, testHeight, testPixels);

            const raw = await codec.decode(filePath);
            expect(raw.width).toBe(testWidth);
            expect(raw.height).toBe(testHeight);
            expect(raw.data.length).toBe(testWidth * testHeight * 4);
            // Verify pixel data matches the original
            expect(Buffer.compare(raw.data, testPixels)).toBe(0);
        });
    });

    describe('encode()', () => {
        it('encodes raw RGBA data to a PNG file and roundtrips correctly', async () => {
            const outputPath = path.join(tmpDir, 'encode-test.png');

            await codec.encode({ data: testPixels, width: testWidth, height: testHeight }, outputPath);

            // File should exist
            expect(fs.existsSync(outputPath)).toBe(true);

            // Roundtrip: decode back and verify
            const decoded = await codec.decode(outputPath);
            expect(decoded.width).toBe(testWidth);
            expect(decoded.height).toBe(testHeight);
            expect(Buffer.compare(decoded.data, testPixels)).toBe(0);
        });
    });

    describe('writeScreenshot()', () => {
        it('writes a PNG buffer to a file with correct contents', async () => {
            const outputPath = path.join(tmpDir, 'screenshot-test.png');

            // Create a valid PNG buffer to simulate a Playwright screenshot
            const png = new PNG({ width: testWidth, height: testHeight });
            testPixels.copy(png.data);
            const pngBuffer = PNG.sync.write(png);

            await codec.writeScreenshot(pngBuffer, outputPath);

            // File should exist with the exact same bytes
            expect(fs.existsSync(outputPath)).toBe(true);
            const written = fs.readFileSync(outputPath);
            expect(Buffer.compare(written, pngBuffer)).toBe(0);
        });
    });

    it('has extension .png', () => {
        expect(codec.extension).toBe('.png');
    });

    it('has mimeType image/png', () => {
        expect(codec.mimeType).toBe('image/png');
    });
});
