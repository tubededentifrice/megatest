import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { Viewport } from '../config/schema.js';

export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({ headless: true });
}

export async function createContext(browser: Browser, viewport: Viewport): Promise<BrowserContext> {
  return browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
  });
}

export async function createPage(context: BrowserContext): Promise<Page> {
  return context.newPage();
}
