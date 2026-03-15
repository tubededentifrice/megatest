import type { ImageCodec } from '../codec/index.js';

export interface CompareResult {
    diffPixels: number;
    diffPercent: number;
    totalPixels: number;
    dimensionMismatch: boolean;
}

export async function compareScreenshots(
    baselinePath: string,
    actualPath: string,
    diffOutputPath: string,
    threshold: number, // pixelmatch per-pixel threshold (0-1), NOT the megatest percentage threshold
    codec: ImageCodec,
): Promise<CompareResult> {
    // pixelmatch v6 is ESM-only; use dynamic import for CJS compatibility
    const pixelmatch = (await import('pixelmatch')).default;

    const baseline = await codec.decode(baselinePath);
    const actual = await codec.decode(actualPath);

    // Check dimension mismatch
    if (baseline.width !== actual.width || baseline.height !== actual.height) {
        return {
            diffPixels: -1,
            diffPercent: 100,
            totalPixels: baseline.width * baseline.height,
            dimensionMismatch: true,
        };
    }

    const { width, height } = baseline;
    const totalPixels = width * height;
    const diffData = Buffer.alloc(width * height * 4);

    const diffPixels = pixelmatch(baseline.data, actual.data, diffData, width, height, { threshold });

    // Write diff image via codec
    await codec.encode({ data: diffData, width, height }, diffOutputPath);

    const diffPercent = (diffPixels / totalPixels) * 100;

    return {
        diffPixels,
        diffPercent,
        totalPixels,
        dimensionMismatch: false,
    };
}
