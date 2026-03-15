import * as fs from 'fs';
import { PNG } from 'pngjs';

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
  threshold: number  // pixelmatch per-pixel threshold (0-1), NOT the megatest percentage threshold
): Promise<CompareResult> {
  // pixelmatch v6 is ESM-only; use dynamic import for CJS compatibility
  const pixelmatch = (await import('pixelmatch')).default;

  const baselinePng = PNG.sync.read(fs.readFileSync(baselinePath));
  const actualPng = PNG.sync.read(fs.readFileSync(actualPath));

  // Check dimension mismatch
  if (baselinePng.width !== actualPng.width || baselinePng.height !== actualPng.height) {
    return {
      diffPixels: -1,
      diffPercent: 100,
      totalPixels: baselinePng.width * baselinePng.height,
      dimensionMismatch: true,
    };
  }

  const { width, height } = baselinePng;
  const diff = new PNG({ width, height });
  const totalPixels = width * height;

  const diffPixels = pixelmatch(
    baselinePng.data,
    actualPng.data,
    diff.data,
    width,
    height,
    { threshold }
  );

  // Write diff image
  fs.writeFileSync(diffOutputPath, PNG.sync.write(diff));

  const diffPercent = (diffPixels / totalPixels) * 100;

  return {
    diffPixels,
    diffPercent,
    totalPixels,
    dimensionMismatch: false,
  };
}
