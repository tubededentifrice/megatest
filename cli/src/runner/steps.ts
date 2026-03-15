import * as path from 'node:path';
import type { Page } from 'playwright';
import type { ImageCodec } from '../codec/index.js';
import type { Step, Viewport } from '../config/schema.js';
import { resolveLocator } from './locator.js';

export interface StepContext {
  baseUrl: string;
  viewports: Record<string, Viewport>;
  screenshotMode: 'viewport' | 'full';
  actualsDir: string;
  viewportName: string;
  timeout: number;
  waitAfterNavigation: string;
  codec: ImageCodec;
}

export interface StepResult {
  screenshotPath?: string;
  checkpointName?: string;
}

function getStepType(step: Step): string {
  return Object.keys(step)[0];
}

export async function executeStep(page: Page, step: Step, ctx: StepContext): Promise<StepResult> {
  const type = getStepType(step);
  const timeout = ctx.timeout;

  switch (type) {
    case 'open': {
      const urlPath = (step as { open: string }).open;
      const fullUrl = urlPath.startsWith('http') ? urlPath : ctx.baseUrl.replace(/\/$/, '') + urlPath;
      const waitUntil =
        ctx.waitAfterNavigation === 'networkidle'
          ? ('networkidle' as const)
          : ctx.waitAfterNavigation === 'load'
            ? ('load' as const)
            : ('load' as const);
      await page.goto(fullUrl, { waitUntil, timeout });
      // If waitAfterNavigation is a ms number, also wait
      if (ctx.waitAfterNavigation !== 'networkidle' && ctx.waitAfterNavigation !== 'load') {
        const ms = Number.parseInt(ctx.waitAfterNavigation, 10);
        if (!Number.isNaN(ms) && ms > 0) {
          await page.waitForTimeout(ms);
        }
      }
      return {};
    }

    case 'wait': {
      const ms = (step as { wait: number }).wait;
      await page.waitForTimeout(ms);
      return {};
    }

    case 'screenshot': {
      const name = (step as { screenshot: string }).screenshot;
      const filename = `${name}-${ctx.viewportName}${ctx.codec.extension}`;
      const screenshotPath = path.join(ctx.actualsDir, filename);
      const pngBuffer = await page.screenshot({
        fullPage: ctx.screenshotMode === 'full',
      });
      await ctx.codec.writeScreenshot(pngBuffer, screenshotPath);
      return { screenshotPath, checkpointName: name };
    }

    case 'click': {
      const loc = (step as { click: Record<string, unknown> }).click;
      await resolveLocator(page, loc).click({ timeout });
      return {};
    }

    case 'fill': {
      const fillData = (step as unknown as { fill: Record<string, unknown> }).fill;
      const { value, ...loc } = fillData;
      if (value === undefined) {
        const keys = Object.keys(fillData).join(', ');
        throw new Error(
          `fill step is missing "value" field (got keys: ${keys}). ` +
            `Expected: fill: { <locator>, value: "text to type" }`,
        );
      }
      if (typeof value !== 'string') {
        throw new Error(`fill step "value" must be a string, got ${typeof value}: ${JSON.stringify(value)}`);
      }
      await resolveLocator(page, loc).fill(value, { timeout });
      return {};
    }

    case 'hover': {
      const loc = (step as { hover: Record<string, unknown> }).hover;
      await resolveLocator(page, loc).hover({ timeout });
      return {};
    }

    case 'select': {
      const selectData = (step as unknown as { select: Record<string, unknown> }).select;
      const { value, ...loc } = selectData;
      if (value === undefined) {
        const keys = Object.keys(selectData).join(', ');
        throw new Error(
          `select step is missing "value" field (got keys: ${keys}). ` +
            `Expected: select: { <locator>, value: "option to select" }`,
        );
      }
      if (typeof value !== 'string') {
        throw new Error(`select step "value" must be a string, got ${typeof value}: ${JSON.stringify(value)}`);
      }
      await resolveLocator(page, loc).selectOption(value, { timeout });
      return {};
    }

    case 'press': {
      const key = (step as { press: string }).press;
      await page.keyboard.press(key);
      return {};
    }

    case 'scroll': {
      const scrollData = (step as { scroll: { up?: number; down?: number; left?: number; right?: number } }).scroll;
      const x = (scrollData.right || 0) - (scrollData.left || 0);
      const y = (scrollData.down || 0) - (scrollData.up || 0);
      await page.evaluate(([dx, dy]: [number, number]) => window.scrollBy(dx, dy), [x, y] as [number, number]);
      return {};
    }

    case 'eval': {
      const code = (step as { eval: string }).eval;
      await page.evaluate(code);
      return {};
    }

    case 'set-viewport': {
      const vpName = (step as { 'set-viewport': string })['set-viewport'];
      const vp = ctx.viewports[vpName];
      if (!vp) throw new Error(`Unknown viewport: ${vpName}`);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      return {};
    }

    case 'include': {
      // Includes should have been resolved before execution
      throw new Error('Include steps must be resolved before execution');
    }

    default:
      throw new Error(`Unknown step type: ${type}`);
  }
}
