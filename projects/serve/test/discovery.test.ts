import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { discoverProjects, listReports, loadReviewData } from '../src/discovery.js';
import type { DiscoveredProject, ServeProjectConfig } from '../src/types.js';

describe('discoverProjects', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'megatest-disc-'));
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('discovers projects with a .megatest/reports directory', () => {
        const repoDir = path.join(tmpDir, 'my-repo');
        fs.mkdirSync(path.join(repoDir, '.megatest', 'reports'), { recursive: true });

        const projects: ServeProjectConfig[] = [{ name: 'my-repo', path: repoDir }];
        const result = discoverProjects(projects);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('my-repo');
        expect(result[0].repoPath).toBe(repoDir);
        expect(result[0].megatestDir).toBe(path.join(repoDir, '.megatest'));
        expect(result[0].reportsDir).toBe(path.join(repoDir, '.megatest', 'reports'));
    });

    it('skips projects without a .megatest/reports directory', () => {
        const repoDir = path.join(tmpDir, 'no-reports');
        fs.mkdirSync(repoDir, { recursive: true });

        const projects: ServeProjectConfig[] = [{ name: 'no-reports', path: repoDir }];
        const result = discoverProjects(projects);

        expect(result).toHaveLength(0);
        expect(console.warn).toHaveBeenCalled();
    });

    it('discovers multiple projects', () => {
        const repo1 = path.join(tmpDir, 'repo1');
        const repo2 = path.join(tmpDir, 'repo2');
        fs.mkdirSync(path.join(repo1, '.megatest', 'reports'), { recursive: true });
        fs.mkdirSync(path.join(repo2, '.megatest', 'reports'), { recursive: true });

        const projects: ServeProjectConfig[] = [
            { name: 'repo1', path: repo1 },
            { name: 'repo2', path: repo2 },
        ];
        const result = discoverProjects(projects);
        expect(result).toHaveLength(2);
    });

    it('returns empty array when no projects have reports', () => {
        const result = discoverProjects([]);
        expect(result).toEqual([]);
    });
});

describe('listReports', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'megatest-list-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function makeProject(name: string): DiscoveredProject {
        const repoDir = path.join(tmpDir, name);
        const megatestDir = path.join(repoDir, '.megatest');
        const reportsDir = path.join(megatestDir, 'reports');
        fs.mkdirSync(reportsDir, { recursive: true });
        return { name, repoPath: repoDir, megatestDir, reportsDir };
    }

    it('finds directories with index.html and sorts newest first', () => {
        const project = makeProject('app');

        // Create two report directories with index.html
        const dir1 = path.join(project.reportsDir, 'abc1234');
        const dir2 = path.join(project.reportsDir, 'def5678');
        fs.mkdirSync(dir1);
        fs.mkdirSync(dir2);
        fs.writeFileSync(path.join(dir1, 'index.html'), '<html></html>');
        fs.writeFileSync(path.join(dir2, 'index.html'), '<html></html>');

        const reports = listReports(project);
        expect(reports).toHaveLength(2);
        expect(reports.map((r) => r.commitHash)).toContain('abc1234');
        expect(reports.map((r) => r.commitHash)).toContain('def5678');
    });

    it('skips directories without index.html', () => {
        const project = makeProject('app');
        const dir = path.join(project.reportsDir, 'noindex');
        fs.mkdirSync(dir);
        fs.writeFileSync(path.join(dir, 'other.txt'), 'stuff');

        const reports = listReports(project);
        expect(reports).toHaveLength(0);
    });

    it('parses meta.json when present', () => {
        const project = makeProject('app');
        const dir = path.join(project.reportsDir, 'abc1234');
        fs.mkdirSync(dir);
        fs.writeFileSync(path.join(dir, 'index.html'), '<html></html>');

        const meta = {
            commitHash: 'abc1234',
            timestamp: '2024-06-15T10:00:00Z',
            passed: 10,
            failed: 2,
            newCount: 1,
            errors: 0,
            duration: 5000,
            totalCheckpoints: 13,
        };
        fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta));

        const reports = listReports(project);
        expect(reports).toHaveLength(1);
        expect(reports[0].meta).toEqual(meta);
        expect(reports[0].commitHash).toBe('abc1234');
    });

    it('handles missing meta.json gracefully', () => {
        const project = makeProject('app');
        const dir = path.join(project.reportsDir, 'abc1234');
        fs.mkdirSync(dir);
        fs.writeFileSync(path.join(dir, 'index.html'), '<html></html>');

        const reports = listReports(project);
        expect(reports).toHaveLength(1);
        expect(reports[0].meta).toBeNull();
    });

    it('handles corrupt meta.json gracefully', () => {
        const project = makeProject('app');
        const dir = path.join(project.reportsDir, 'abc1234');
        fs.mkdirSync(dir);
        fs.writeFileSync(path.join(dir, 'index.html'), '<html></html>');
        fs.writeFileSync(path.join(dir, 'meta.json'), '{corrupt json');

        const reports = listReports(project);
        expect(reports).toHaveLength(1);
        expect(reports[0].meta).toBeNull();
    });

    it('sorts by meta timestamp when available', () => {
        const project = makeProject('app');

        const dir1 = path.join(project.reportsDir, 'older');
        const dir2 = path.join(project.reportsDir, 'newer');
        fs.mkdirSync(dir1);
        fs.mkdirSync(dir2);
        fs.writeFileSync(path.join(dir1, 'index.html'), '');
        fs.writeFileSync(path.join(dir2, 'index.html'), '');

        const olderMeta = {
            commitHash: 'older',
            timestamp: '2024-01-01T00:00:00Z',
            passed: 1,
            failed: 0,
            newCount: 0,
            errors: 0,
            duration: 1000,
            totalCheckpoints: 1,
        };
        const newerMeta = {
            commitHash: 'newer',
            timestamp: '2024-06-15T00:00:00Z',
            passed: 1,
            failed: 0,
            newCount: 0,
            errors: 0,
            duration: 1000,
            totalCheckpoints: 1,
        };
        fs.writeFileSync(path.join(dir1, 'meta.json'), JSON.stringify(olderMeta));
        fs.writeFileSync(path.join(dir2, 'meta.json'), JSON.stringify(newerMeta));

        const reports = listReports(project);
        expect(reports[0].commitHash).toBe('newer');
        expect(reports[1].commitHash).toBe('older');
    });

    it('returns correct report URLs', () => {
        const project = makeProject('my app');
        const dir = path.join(project.reportsDir, 'abc1234');
        fs.mkdirSync(dir);
        fs.writeFileSync(path.join(dir, 'index.html'), '');

        const reports = listReports(project);
        expect(reports[0].reportUrl).toBe('/projects/my%20app/reports/abc1234/review');
    });

    it('returns empty array when reports directory is empty', () => {
        const project = makeProject('empty');
        const reports = listReports(project);
        expect(reports).toEqual([]);
    });
});

describe('loadReviewData', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'megatest-review-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('loads from results.json when present', () => {
        const megatestDir = path.join(tmpDir, '.megatest');
        const commitDir = path.join(megatestDir, 'reports', 'abc123');
        fs.mkdirSync(commitDir, { recursive: true });

        const reviewData = {
            extension: '.png',
            checkpoints: [
                {
                    workflow: 'login',
                    checkpoint: 'hero',
                    viewport: 'desktop',
                    status: 'fail',
                    diffPercent: 1.5,
                    diffPixels: 100,
                    error: null,
                },
            ],
        };
        fs.writeFileSync(path.join(commitDir, 'results.json'), JSON.stringify(reviewData));

        const result = loadReviewData(megatestDir, commitDir);
        expect(result).toEqual(reviewData);
    });

    it('reconstructs review data from filesystem when results.json is missing', () => {
        const megatestDir = path.join(tmpDir, '.megatest');
        const commitDir = path.join(megatestDir, 'reports', 'abc123');
        const baselinesDir = path.join(megatestDir, 'baselines');
        fs.mkdirSync(commitDir, { recursive: true });
        fs.mkdirSync(baselinesDir, { recursive: true });

        // Create actual + diff files (simulates a fail)
        fs.writeFileSync(path.join(commitDir, 'hero-desktop-actual.png'), '');
        fs.writeFileSync(path.join(commitDir, 'hero-desktop-diff.png'), '');

        // Create an actual without diff (simulates a new checkpoint)
        fs.writeFileSync(path.join(commitDir, 'signup-mobile-actual.png'), '');

        // Create a baseline not in actuals (simulates a pass)
        fs.writeFileSync(path.join(baselinesDir, 'footer-desktop.png'), '');

        const result = loadReviewData(megatestDir, commitDir);
        expect(result).not.toBeNull();
        expect(result?.extension).toBe('.png');
        expect(result?.checkpoints).toHaveLength(3);

        const fail = result?.checkpoints.find((c) => c.checkpoint === 'hero');
        expect(fail).toBeDefined();
        expect(fail?.status).toBe('fail');
        expect(fail?.viewport).toBe('desktop');

        const newCp = result?.checkpoints.find((c) => c.checkpoint === 'signup');
        expect(newCp).toBeDefined();
        expect(newCp?.status).toBe('new');
        expect(newCp?.viewport).toBe('mobile');

        const pass = result?.checkpoints.find((c) => c.checkpoint === 'footer');
        expect(pass).toBeDefined();
        expect(pass?.status).toBe('pass');
    });

    it('detects webp extension from filesystem', () => {
        const megatestDir = path.join(tmpDir, '.megatest');
        const commitDir = path.join(megatestDir, 'reports', 'abc123');
        fs.mkdirSync(commitDir, { recursive: true });

        fs.writeFileSync(path.join(commitDir, 'hero-desktop-actual.webp'), '');

        const result = loadReviewData(megatestDir, commitDir);
        expect(result).not.toBeNull();
        expect(result?.extension).toBe('.webp');
    });

    it('returns null when commit directory does not exist', () => {
        const megatestDir = path.join(tmpDir, '.megatest');
        const commitDir = path.join(megatestDir, 'reports', 'nonexistent');
        fs.mkdirSync(megatestDir, { recursive: true });

        const result = loadReviewData(megatestDir, commitDir);
        expect(result).toBeNull();
    });

    it('falls through to reconstruction if results.json is corrupt', () => {
        const megatestDir = path.join(tmpDir, '.megatest');
        const commitDir = path.join(megatestDir, 'reports', 'abc123');
        fs.mkdirSync(commitDir, { recursive: true });

        fs.writeFileSync(path.join(commitDir, 'results.json'), '{bad json');
        fs.writeFileSync(path.join(commitDir, 'hero-desktop-actual.png'), '');

        const result = loadReviewData(megatestDir, commitDir);
        expect(result).not.toBeNull();
        expect(result?.checkpoints).toHaveLength(1);
        expect(result?.checkpoints[0].status).toBe('new');
    });

    it('does not duplicate passed baselines that also appear in actuals', () => {
        const megatestDir = path.join(tmpDir, '.megatest');
        const commitDir = path.join(megatestDir, 'reports', 'abc123');
        const baselinesDir = path.join(megatestDir, 'baselines');
        fs.mkdirSync(commitDir, { recursive: true });
        fs.mkdirSync(baselinesDir, { recursive: true });

        // Actual exists (new) and baseline exists for same slug
        fs.writeFileSync(path.join(commitDir, 'hero-desktop-actual.png'), '');
        fs.writeFileSync(path.join(baselinesDir, 'hero-desktop.png'), '');

        const result = loadReviewData(megatestDir, commitDir);
        expect(result).not.toBeNull();
        // hero-desktop should appear once as 'new', not also as 'pass'
        const heroEntries = result?.checkpoints.filter((c) => c.checkpoint === 'hero' && c.viewport === 'desktop');
        expect(heroEntries).toHaveLength(1);
        expect(heroEntries[0].status).toBe('new');
    });
});
