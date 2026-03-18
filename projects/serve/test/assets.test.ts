import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Use vi.hoisted to declare the mock fn before vi.mock hoisting
const { mockReadFileSync } = vi.hoisted(() => {
    return { mockReadFileSync: vi.fn() };
});

vi.mock('node:fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:fs')>();
    return {
        ...actual,
        readFileSync: mockReadFileSync,
    };
});

describe('asset', () => {
    beforeEach(() => {
        vi.resetModules();
        mockReadFileSync.mockReset();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns hashed path when manifest is present', async () => {
        mockReadFileSync.mockImplementation((filePath: unknown) => {
            if (typeof filePath === 'string' && filePath.includes('manifest.json')) {
                return JSON.stringify({
                    'css/tokens.css': 'css/tokens.abc123.css',
                    'js/review.js': 'js/review.def456.js',
                });
            }
            throw new Error(`Unexpected readFileSync call: ${filePath}`);
        });

        const { asset } = await import('../src/assets.js');
        expect(asset('css/tokens.css')).toBe('/static/css/tokens.abc123.css');
        expect(asset('js/review.js')).toBe('/static/js/review.def456.js');
    });

    it('returns unhashed path when manifest entry is missing', async () => {
        mockReadFileSync.mockImplementation((filePath: unknown) => {
            if (typeof filePath === 'string' && filePath.includes('manifest.json')) {
                return JSON.stringify({ 'css/tokens.css': 'css/tokens.abc.css' });
            }
            throw new Error(`Unexpected readFileSync call: ${filePath}`);
        });

        const { asset } = await import('../src/assets.js');
        // Known entry returns hashed path
        expect(asset('css/tokens.css')).toBe('/static/css/tokens.abc.css');
        // Unknown entry falls back to unhashed
        expect(asset('css/unknown.css')).toBe('/static/css/unknown.css');
    });

    it('returns unhashed path when manifest file is missing', async () => {
        mockReadFileSync.mockImplementation((filePath: unknown) => {
            if (typeof filePath === 'string' && filePath.includes('manifest.json')) {
                throw new Error('ENOENT');
            }
            throw new Error(`Unexpected readFileSync call: ${filePath}`);
        });

        // Suppress the console.warn from assets.ts
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        const { asset } = await import('../src/assets.js');
        expect(asset('css/tokens.css')).toBe('/static/css/tokens.css');
        expect(asset('js/review.js')).toBe('/static/js/review.js');
    });
});
