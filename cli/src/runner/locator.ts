import type { Page, Locator as PlaywrightLocator } from 'playwright';
import type { Locator } from '../config/schema.js';

export function resolveLocator(page: Page, loc: Locator): PlaywrightLocator {
  if (loc.testid) return page.getByTestId(loc.testid);
  if (loc.role)
    return page.getByRole(loc.role as Parameters<Page['getByRole']>[0], loc.name ? { name: loc.name } : undefined);
  if (loc.label) return page.getByLabel(loc.label);
  if (loc.text) return page.getByText(loc.text);
  if (loc.placeholder) return page.getByPlaceholder(loc.placeholder);
  if (loc.css) return page.locator(loc.css);
  throw new Error('No valid locator key found in: ' + JSON.stringify(loc));
}
