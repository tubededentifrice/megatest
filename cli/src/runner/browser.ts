import { type Browser, type BrowserContext, type Page, chromium } from 'playwright';
import type { Viewport } from '../config/schema.js';

export async function launchBrowser(): Promise<Browser> {
    return chromium.launch({ headless: true });
}

export async function createContext(browser: Browser, viewport: Viewport): Promise<BrowserContext> {
    return browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        reducedMotion: 'reduce',
        serviceWorkers: 'block',
    });
}

export async function createPage(context: BrowserContext): Promise<Page> {
    return context.newPage();
}
