import type { ReportMeta } from '@megatest/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiscoveredProject, ReportEntry } from '../../src/types.js';

// Mock assets so we don't need a real manifest
vi.mock('../../src/assets.js', () => ({
    asset: (name: string) => `/static/${name}`,
}));

// Mock discovery so renderDashboard doesn't hit the filesystem
vi.mock('../../src/discovery.js', () => ({
    listReports: vi.fn(() => []),
}));

import { listReports } from '../../src/discovery.js';
import { renderBadges, renderDashboard, renderLatestReport, renderOlderReport } from '../../src/views/dashboard.js';

const mockedListReports = vi.mocked(listReports);

function makeMeta(overrides: Partial<ReportMeta> = {}): ReportMeta {
    return {
        commitHash: 'abc12345',
        timestamp: '2024-06-15T10:00:00Z',
        passed: 5,
        failed: 2,
        newCount: 1,
        errors: 0,
        duration: 5000,
        totalCheckpoints: 8,
        ...overrides,
    };
}

function makeReport(overrides: Partial<ReportEntry> = {}): ReportEntry {
    return {
        commitHash: 'abc12345',
        meta: makeMeta(),
        mtime: new Date('2024-06-15T10:00:00Z'),
        reportUrl: '/projects/app/reports/abc12345/review',
        ...overrides,
    };
}

describe('renderBadges', () => {
    it('renders passed badge when passed > 0', () => {
        const html = renderBadges(makeMeta({ passed: 3 }));
        expect(html).toContain('badge--pass');
        expect(html).toContain('3 passed');
    });

    it('renders changed badge when failed > 0', () => {
        const html = renderBadges(makeMeta({ failed: 2 }));
        expect(html).toContain('badge--changed');
        expect(html).toContain('2 changed');
    });

    it('renders new badge when newCount > 0', () => {
        const html = renderBadges(makeMeta({ newCount: 4 }));
        expect(html).toContain('badge--new');
        expect(html).toContain('4 new');
    });

    it('renders fail badge when errors > 0', () => {
        const html = renderBadges(makeMeta({ errors: 1 }));
        expect(html).toContain('badge--fail');
        expect(html).toContain('1 failed');
    });

    it('does not render badge for zero counts', () => {
        const html = renderBadges(makeMeta({ passed: 0, failed: 0, newCount: 0, errors: 0 }));
        expect(html).toBe('');
    });

    it('renders multiple badges together', () => {
        const html = renderBadges(makeMeta({ passed: 5, failed: 2, newCount: 1, errors: 0 }));
        expect(html).toContain('5 passed');
        expect(html).toContain('2 changed');
        expect(html).toContain('1 new');
        expect(html).not.toContain('failed');
    });
});

describe('renderLatestReport', () => {
    it('renders with meta data including badges and duration', () => {
        const report = makeReport();
        const html = renderLatestReport(report);

        expect(html).toContain('latest-report');
        expect(html).toContain('abc12345');
        expect(html).toContain(report.reportUrl);
        expect(html).toContain('5.0s'); // formatDuration(5000)
        expect(html).toContain('8 checkpoints');
        // Should have badges
        expect(html).toContain('badge--pass');
    });

    it('renders without meta data using mtime', () => {
        const report = makeReport({ meta: null });
        const html = renderLatestReport(report);

        expect(html).toContain('latest-report');
        expect(html).toContain('abc12345');
        // Should use mtime for the time tag
        expect(html).toContain('<time');
        // No badges or duration
        expect(html).not.toContain('badge--pass');
        expect(html).not.toContain('checkpoints');
    });

    it('uses singular "checkpoint" for totalCheckpoints=1', () => {
        const report = makeReport({ meta: makeMeta({ totalCheckpoints: 1 }) });
        const html = renderLatestReport(report);
        expect(html).toContain('1 checkpoint');
        expect(html).not.toContain('1 checkpoints');
    });
});

describe('renderOlderReport', () => {
    it('renders with meta timestamp and badges', () => {
        const report = makeReport({ commitHash: 'def5678' });
        const html = renderOlderReport(report);

        expect(html).toContain('report-row');
        expect(html).toContain('def5678');
        expect(html).toContain(report.reportUrl);
        expect(html).toContain('<time');
        expect(html).toContain('badge--pass');
    });

    it('renders without meta using mtime', () => {
        const report = makeReport({ meta: null, commitHash: 'ghi9012' });
        const html = renderOlderReport(report);

        expect(html).toContain('ghi9012');
        expect(html).toContain('<time');
        expect(html).not.toContain('badge--pass');
    });
});

describe('renderDashboard', () => {
    beforeEach(() => {
        mockedListReports.mockReset();
    });

    it('renders empty state when no projects exist', () => {
        const html = renderDashboard('Megatest', []);

        expect(html).toContain('No projects found');
        expect(html).toContain('serve.config.yml');
    });

    it('renders project card with "No reports yet" when listReports returns empty', () => {
        mockedListReports.mockReturnValue([]);

        const projects: DiscoveredProject[] = [
            {
                name: 'my-app',
                repoPath: '/home/user/my-app',
                megatestDir: '/home/user/my-app/.megatest',
                reportsDir: '/home/user/my-app/.megatest/reports',
            },
        ];

        const html = renderDashboard('Megatest', projects);

        expect(html).toContain('my-app');
        expect(html).toContain('No reports yet');
    });

    it('renders project with latest and older reports', () => {
        const reports = [
            makeReport({ commitHash: 'newest' }),
            makeReport({ commitHash: 'older1' }),
            makeReport({ commitHash: 'older2' }),
        ];
        mockedListReports.mockReturnValue(reports);

        const projects: DiscoveredProject[] = [
            {
                name: 'my-app',
                repoPath: '/home/user/my-app',
                megatestDir: '/home/user/my-app/.megatest',
                reportsDir: '/home/user/my-app/.megatest/reports',
            },
        ];

        const html = renderDashboard('Megatest', projects);

        expect(html).toContain('my-app');
        // Latest report
        expect(html).toContain('newest');
        // Older reports section
        expect(html).toContain('2 older reports');
        expect(html).toContain('older1');
        expect(html).toContain('older2');
        // Report count badge
        expect(html).toContain('3 reports');
    });

    it('renders singular "report" for single report', () => {
        mockedListReports.mockReturnValue([makeReport()]);

        const projects: DiscoveredProject[] = [
            {
                name: 'app',
                repoPath: '/tmp/app',
                megatestDir: '/tmp/app/.megatest',
                reportsDir: '/tmp/app/.megatest/reports',
            },
        ];

        const html = renderDashboard('Megatest', projects);

        expect(html).toContain('1 report');
        expect(html).not.toContain('1 reports');
    });

    it('renders singular "older report" for single older report', () => {
        const reports = [makeReport({ commitHash: 'newest' }), makeReport({ commitHash: 'older1' })];
        mockedListReports.mockReturnValue(reports);

        const projects: DiscoveredProject[] = [
            {
                name: 'app',
                repoPath: '/tmp/app',
                megatestDir: '/tmp/app/.megatest',
                reportsDir: '/tmp/app/.megatest/reports',
            },
        ];

        const html = renderDashboard('Megatest', projects);

        expect(html).toContain('1 older report');
        expect(html).not.toContain('1 older reports');
    });

    it('escapes HTML in title', () => {
        const html = renderDashboard('<script>alert(1)</script>', []);
        expect(html).not.toContain('<script>alert(1)</script>');
        expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    });

    it('escapes HTML in project name and path', () => {
        mockedListReports.mockReturnValue([]);

        const projects: DiscoveredProject[] = [
            {
                name: '<b>bad</b>',
                repoPath: '/path/"with/quotes',
                megatestDir: '/path/"with/quotes/.megatest',
                reportsDir: '/path/"with/quotes/.megatest/reports',
            },
        ];

        const html = renderDashboard('Test', projects);

        expect(html).not.toContain('<b>bad</b>');
        expect(html).toContain('&lt;b&gt;bad&lt;/b&gt;');
        expect(html).toContain('&quot;with');
    });

    it('renders valid HTML document structure', () => {
        const html = renderDashboard('Test', []);

        expect(html).toContain('<!DOCTYPE html>');
        expect(html).toContain('<html lang="en">');
        expect(html).toContain('</html>');
        expect(html).toContain('<title>Test</title>');
    });
});
