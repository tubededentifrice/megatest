import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        coverage: {
            provider: 'v8',
            include: ['projects/*/src/**/*.ts'],
            exclude: [
                'projects/*/src/types/**',
                'projects/cli/src/types/**',
                'projects/cli/src/cli.ts',
                'projects/cli/src/runner/engine.ts',
                'projects/cli/src/runner/steps.ts',
                'projects/cli/src/runner/browser.ts',
                'projects/cli/src/runner/locator.ts',
                'projects/cli/src/commands/**',
                'projects/serve/src/index.ts',
            ],
            thresholds: {
                lines: 80,
                functions: 80,
                branches: 80,
                statements: 80,
            },
            reporter: ['text', 'text-summary', 'html'],
            reportsDirectory: 'coverage',
        },
    },
});
