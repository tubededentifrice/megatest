import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/loader.js';

/** Create a temp dir with a .megatest/ skeleton and return the repo path */
function makeTempRepo(): string {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'megatest-test-'));
    fs.mkdirSync(path.join(tmpDir, '.megatest', 'workflows'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.megatest', 'includes'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.megatest', 'plans'), { recursive: true });
    return tmpDir;
}

const tempDirs: string[] = [];

function createTempRepo(): string {
    const dir = makeTempRepo();
    tempDirs.push(dir);
    return dir;
}

afterEach(() => {
    for (const dir of tempDirs) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
});

describe('loadConfig', () => {
    it('loads a minimal config.yml and returns defaults', () => {
        const repo = createTempRepo();
        fs.writeFileSync(path.join(repo, '.megatest', 'config.yml'), 'version: "1"\n');
        const loaded = loadConfig(repo);
        expect(loaded.config.version).toBe('1');
        expect(loaded.config.defaults.threshold).toBe(0.1);
        expect(loaded.config.defaults.screenshotMode).toBe('viewport');
        expect(loaded.config.defaults.format).toBe('webp');
        expect(loaded.config.defaults.concurrency).toBe(4);
    });

    it('fills in default values when config.yml is missing', () => {
        const repo = createTempRepo();
        // No config.yml — loadConfig should still work with defaults
        const loaded = loadConfig(repo);
        expect(loaded.config.version).toBe('1');
        expect(loaded.config.viewports).toHaveProperty('desktop');
        expect(loaded.config.viewports).toHaveProperty('mobile');
    });

    it('overrides defaults with explicit config values', () => {
        const repo = createTempRepo();
        const configYml = `
version: "1"
defaults:
  threshold: 0.5
  timeout: 60000
  format: png
  concurrency: 2
viewports:
  tablet:
    width: 768
    height: 1024
variables:
  BASE_URL: https://example.com
`;
        fs.writeFileSync(path.join(repo, '.megatest', 'config.yml'), configYml);
        const loaded = loadConfig(repo);
        expect(loaded.config.defaults.threshold).toBe(0.5);
        expect(loaded.config.defaults.timeout).toBe(60000);
        expect(loaded.config.defaults.format).toBe('png');
        expect(loaded.config.defaults.concurrency).toBe(2);
        expect(loaded.config.viewports.tablet).toEqual({ width: 768, height: 1024 });
        expect(loaded.config.variables.BASE_URL).toBe('https://example.com');
    });

    it('throws when .megatest/ directory does not exist', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'megatest-test-'));
        tempDirs.push(tmpDir);
        expect(() => loadConfig(tmpDir)).toThrow('Directory not found');
    });

    it('loads workflows from YAML files', () => {
        const repo = createTempRepo();
        fs.writeFileSync(path.join(repo, '.megatest', 'config.yml'), 'version: "1"\n');
        fs.writeFileSync(
            path.join(repo, '.megatest', 'workflows', 'login.yml'),
            `name: login
description: Login flow
steps:
  - open: /login
  - screenshot: login-page
`,
        );
        const loaded = loadConfig(repo);
        expect(loaded.workflows.has('login')).toBe(true);
        const wf = loaded.workflows.get('login');
        expect(wf).toBeDefined();
        expect(wf?.description).toBe('Login flow');
        expect(wf?.steps).toHaveLength(2);
        expect(wf?.steps[0]).toEqual({ open: '/login' });
    });

    it('loads includes from YAML files', () => {
        const repo = createTempRepo();
        fs.writeFileSync(path.join(repo, '.megatest', 'config.yml'), 'version: "1"\n');
        fs.writeFileSync(
            path.join(repo, '.megatest', 'includes', 'auth.yml'),
            `name: auth
steps:
  - fill:
      css: "#user"
      value: admin
`,
        );
        const loaded = loadConfig(repo);
        expect(loaded.includes.has('auth')).toBe(true);
        const inc = loaded.includes.get('auth');
        expect(inc).toBeDefined();
        expect(inc?.steps).toHaveLength(1);
    });

    it('loads plans from YAML files', () => {
        const repo = createTempRepo();
        fs.writeFileSync(path.join(repo, '.megatest', 'config.yml'), 'version: "1"\n');
        fs.writeFileSync(
            path.join(repo, '.megatest', 'plans', 'smoke.yml'),
            `name: smoke
description: Smoke test plan
workflows:
  - login
  - homepage
`,
        );
        const loaded = loadConfig(repo);
        expect(loaded.plans.has('smoke')).toBe(true);
        const plan = loaded.plans.get('smoke');
        expect(plan).toBeDefined();
        expect(plan?.workflows).toEqual(['login', 'homepage']);
    });

    it('resolves basePath to an absolute path', () => {
        const repo = createTempRepo();
        fs.writeFileSync(path.join(repo, '.megatest', 'config.yml'), 'version: "1"\n');
        const loaded = loadConfig(repo);
        expect(path.isAbsolute(loaded.basePath)).toBe(true);
        expect(loaded.basePath).toContain('.megatest');
    });

    it('skips workflow files without a name field', () => {
        const repo = createTempRepo();
        fs.writeFileSync(path.join(repo, '.megatest', 'config.yml'), 'version: "1"\n');
        // Write a workflow file with no name field
        fs.writeFileSync(
            path.join(repo, '.megatest', 'workflows', 'broken.yml'),
            `steps:
  - screenshot: snap
`,
        );
        const loaded = loadConfig(repo);
        expect(loaded.workflows.size).toBe(0);
    });

    it('handles teardown steps in config', () => {
        const repo = createTempRepo();
        const configYml = `
version: "1"
teardown:
  - eval: "window.cleanup()"
`;
        fs.writeFileSync(path.join(repo, '.megatest', 'config.yml'), configYml);
        const loaded = loadConfig(repo);
        expect(loaded.config.teardown).toBeDefined();
        expect(loaded.config.teardown).toHaveLength(1);
        expect(loaded.config.teardown?.[0]).toEqual({ eval: 'window.cleanup()' });
    });
});
