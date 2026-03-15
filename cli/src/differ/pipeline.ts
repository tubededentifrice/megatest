import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ImageCodec } from '../codec/index.js';
import type { CheckpointResult } from '../types.js';
import { compareScreenshots } from './compare.js';

export interface DiffPipelineOptions {
  baselinesDir: string; // .megatest/baselines/
  actualsDir: string; // .megatest/actuals/
  reportDir: string; // .megatest/reports/<commit>/
  threshold: number; // megatest percentage threshold (e.g., 0.1 means 0.1%)
  codec: ImageCodec;
}

export async function runDiffPipeline(
  results: CheckpointResult[],
  opts: DiffPipelineOptions,
): Promise<CheckpointResult[]> {
  const { baselinesDir, reportDir, threshold, codec } = opts;
  const ext = codec.extension;

  // Ensure report directory exists
  fs.mkdirSync(reportDir, { recursive: true });

  const updated: CheckpointResult[] = [];

  for (const result of results) {
    // Skip error results (no screenshot taken)
    if (result.status === 'error' || !result.actualPath) {
      updated.push(result);
      continue;
    }

    // Determine baseline path
    const filename = `${result.checkpoint}-${result.viewport}${ext}`;
    const baselinePath = path.join(baselinesDir, filename);

    if (!fs.existsSync(baselinePath)) {
      // No baseline - status = "new"
      // Copy actual to report dir
      const reportActual = path.join(reportDir, `${result.checkpoint}-${result.viewport}-actual${ext}`);
      fs.copyFileSync(result.actualPath, reportActual);

      updated.push({
        ...result,
        status: 'new',
        baselinePath: null,
        actualPath: result.actualPath,
      });
      continue;
    }

    // Baseline exists - compare
    const diffFilename = `${result.checkpoint}-${result.viewport}-diff${ext}`;
    const diffOutputPath = path.join(reportDir, diffFilename);

    const comparison = await compareScreenshots(
      baselinePath,
      result.actualPath,
      diffOutputPath,
      0.1, // pixelmatch per-pixel threshold (NOT the megatest percentage threshold)
      codec,
    );

    if (comparison.dimensionMismatch) {
      // Dimension mismatch = fail
      const reportActual = path.join(reportDir, `${result.checkpoint}-${result.viewport}-actual${ext}`);
      fs.copyFileSync(result.actualPath, reportActual);

      updated.push({
        ...result,
        status: 'fail',
        diffPercent: 100,
        diffPixels: -1,
        totalPixels: comparison.totalPixels,
        dimensionMismatch: true,
        baselinePath,
        diffPath: null,
      });
      continue;
    }

    if (comparison.diffPercent > threshold) {
      // Diff exceeds threshold = fail
      // Save actual + diff to report dir
      const reportActual = path.join(reportDir, `${result.checkpoint}-${result.viewport}-actual${ext}`);
      fs.copyFileSync(result.actualPath, reportActual);

      updated.push({
        ...result,
        status: 'fail',
        diffPercent: comparison.diffPercent,
        diffPixels: comparison.diffPixels,
        totalPixels: comparison.totalPixels,
        dimensionMismatch: false,
        baselinePath,
        actualPath: result.actualPath,
        diffPath: diffOutputPath,
      });
    } else {
      // Pass - do NOT save actual (dedup: report references baseline)
      // Clean up diff file if it was created
      if (fs.existsSync(diffOutputPath)) {
        fs.unlinkSync(diffOutputPath);
      }

      updated.push({
        ...result,
        status: 'pass',
        diffPercent: comparison.diffPercent,
        diffPixels: comparison.diffPixels,
        totalPixels: comparison.totalPixels,
        dimensionMismatch: false,
        baselinePath,
        actualPath: null, // Not saved (dedup)
        diffPath: null,
      });
    }
  }

  return updated;
}
