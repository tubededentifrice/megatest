import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
    let tmpDir: string;
    let exitSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'megatest-config-'));
        exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
            throw new Error('process.exit');
        });
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('parses a valid config file', () => {
        const configPath = path.join(tmpDir, 'serve.config.yml');
        fs.writeFileSync(
            configPath,
            `title: My Reports
server:
  port: 4000
  host: 127.0.0.1
projects:
  - name: my-app
    path: /home/user/my-app
`,
        );

        const config = loadConfig(configPath);
        expect(config.title).toBe('My Reports');
        expect(config.server.port).toBe(4000);
        expect(config.server.host).toBe('127.0.0.1');
        expect(config.projects).toHaveLength(1);
        expect(config.projects[0].name).toBe('my-app');
        expect(config.projects[0].path).toBe('/home/user/my-app');
    });

    it('uses default values when server section is missing', () => {
        const configPath = path.join(tmpDir, 'serve.config.yml');
        fs.writeFileSync(
            configPath,
            `projects:
  - name: app
    path: /tmp/app
`,
        );

        const config = loadConfig(configPath);
        expect(config.title).toBe('Megatest Reports');
        expect(config.server.port).toBe(3000);
        expect(config.server.host).toBe('0.0.0.0');
    });

    it('exits when config file does not exist', () => {
        const missingPath = path.join(tmpDir, 'nonexistent.yml');
        expect(() => loadConfig(missingPath)).toThrow('process.exit');
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('exits when config is invalid YAML (not an object)', () => {
        const configPath = path.join(tmpDir, 'bad.yml');
        fs.writeFileSync(configPath, 'just a string');
        expect(() => loadConfig(configPath)).toThrow('process.exit');
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('exits when projects array is empty', () => {
        const configPath = path.join(tmpDir, 'empty.yml');
        fs.writeFileSync(
            configPath,
            `title: Test
projects: []
`,
        );
        expect(() => loadConfig(configPath)).toThrow('process.exit');
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('exits when projects is missing', () => {
        const configPath = path.join(tmpDir, 'noprojects.yml');
        fs.writeFileSync(configPath, 'title: Test\n');
        expect(() => loadConfig(configPath)).toThrow('process.exit');
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('exits when a project is missing name or path', () => {
        const configPath = path.join(tmpDir, 'badproject.yml');
        fs.writeFileSync(
            configPath,
            `projects:
  - name: good
    path: /tmp/good
  - name: incomplete
`,
        );
        expect(() => loadConfig(configPath)).toThrow('process.exit');
        expect(exitSpy).toHaveBeenCalledWith(1);
    });
});
