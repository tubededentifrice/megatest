import * as realFs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock child_process for git commands
vi.mock('node:child_process', () => ({
    execSync: vi.fn(),
}));

import { execSync } from 'node:child_process';
import { ensureGitignore, getBranchName, getCommitHash, resolveMegatestDir } from '../src/utils.js';

describe('resolveMegatestDir', () => {
    it('returns an absolute path ending with .megatest', () => {
        const result = resolveMegatestDir('/home/user/project');
        expect(path.isAbsolute(result)).toBe(true);
        expect(result).toBe('/home/user/project/.megatest');
    });

    it('resolves relative paths to absolute', () => {
        const result = resolveMegatestDir('my-project');
        expect(path.isAbsolute(result)).toBe(true);
        expect(result.endsWith('.megatest')).toBe(true);
    });
});

describe('getCommitHash', () => {
    beforeEach(() => {
        vi.mocked(execSync).mockReset();
    });

    it('returns trimmed commit hash on success', () => {
        vi.mocked(execSync).mockReturnValue('abc1234\n');
        const hash = getCommitHash('/repo');
        expect(hash).toBe('abc1234');
        expect(execSync).toHaveBeenCalledWith(
            'git rev-parse --short=7 HEAD',
            expect.objectContaining({ cwd: '/repo' }),
        );
    });

    it('returns "unknown" when git fails', () => {
        vi.mocked(execSync).mockImplementation(() => {
            throw new Error('not a git repo');
        });
        const hash = getCommitHash('/not-a-repo');
        expect(hash).toBe('unknown');
    });
});

describe('getBranchName', () => {
    beforeEach(() => {
        vi.mocked(execSync).mockReset();
    });

    it('returns trimmed branch name on success', () => {
        vi.mocked(execSync).mockReturnValue('main\n');
        const branch = getBranchName('/repo');
        expect(branch).toBe('main');
        expect(execSync).toHaveBeenCalledWith(
            'git rev-parse --abbrev-ref HEAD',
            expect.objectContaining({ cwd: '/repo' }),
        );
    });

    it('returns "unknown" when git fails', () => {
        vi.mocked(execSync).mockImplementation(() => {
            throw new Error('not a git repo');
        });
        const branch = getBranchName('/not-a-repo');
        expect(branch).toBe('unknown');
    });
});

describe('ensureGitignore', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = realFs.mkdtempSync(path.join(os.tmpdir(), 'megatest-gitignore-'));
    });

    afterEach(() => {
        realFs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('creates .gitignore with required entries when it does not exist', () => {
        ensureGitignore(tmpDir);

        const content = realFs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8');
        expect(content).toContain('reports/');
        expect(content).toContain('actuals/');
    });

    it('appends missing entries to existing .gitignore', () => {
        const gitignorePath = path.join(tmpDir, '.gitignore');
        realFs.writeFileSync(gitignorePath, 'reports/\n');

        ensureGitignore(tmpDir);

        const content = realFs.readFileSync(gitignorePath, 'utf-8');
        expect(content).toContain('reports/');
        expect(content).toContain('actuals/');
    });

    it('does not duplicate entries that already exist', () => {
        const gitignorePath = path.join(tmpDir, '.gitignore');
        realFs.writeFileSync(gitignorePath, 'reports/\nactuals/\n');

        ensureGitignore(tmpDir);

        const content = realFs.readFileSync(gitignorePath, 'utf-8');
        // Count occurrences of 'reports/'
        const reportsCount = (content.match(/reports\//g) || []).length;
        expect(reportsCount).toBe(1);
    });

    it('handles .gitignore without trailing newline', () => {
        const gitignorePath = path.join(tmpDir, '.gitignore');
        realFs.writeFileSync(gitignorePath, 'some-entry'); // no trailing newline

        ensureGitignore(tmpDir);

        const content = realFs.readFileSync(gitignorePath, 'utf-8');
        expect(content).toContain('reports/');
        expect(content).toContain('actuals/');
    });
});
