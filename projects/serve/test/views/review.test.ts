import type { ReportMeta, ReviewCheckpoint } from '@megatest/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewData } from '../../src/types.js';

// Mock the asset function so we don't need the real manifest
vi.mock('../../src/assets.js', () => ({
    asset: (name: string) => `/static/${name}`,
}));

import { renderReviewPage } from '../../src/views/review.js';

function makeCheckpoint(overrides: Partial<ReviewCheckpoint> = {}): ReviewCheckpoint {
    return {
        workflow: 'default',
        checkpoint: 'hero',
        viewport: 'desktop',
        status: 'pass',
        diffPercent: null,
        diffPixels: null,
        error: null,
        ...overrides,
    };
}

function makeMeta(overrides: Partial<ReportMeta> = {}): ReportMeta {
    return {
        commitHash: 'abc12345',
        timestamp: '2024-06-15T10:00:00Z',
        passed: 5,
        failed: 2,
        newCount: 1,
        errors: 0,
        duration: 12000,
        totalCheckpoints: 8,
        ...overrides,
    };
}

describe('renderReviewPage', () => {
    it('renders failed checkpoints with diff thumbnails and accept buttons', () => {
        const data: ReviewData = {
            extension: '.png',
            checkpoints: [
                makeCheckpoint({
                    checkpoint: 'login-form',
                    viewport: 'desktop',
                    status: 'fail',
                    diffPercent: 3.45,
                }),
            ],
        };

        const html = renderReviewPage('my-app', 'abc12345', data, null, 'Megatest');

        // Should contain diff thumbnail
        expect(html).toContain('data-status="fail"');
        expect(html).toContain('login-form-desktop-diff.png');
        expect(html).toContain('login-form-desktop-actual.png');
        expect(html).toContain('login-form-desktop-baseline.png');
        // Should show diff percentage
        expect(html).toContain('3.45%');
        // Should have accept button
        expect(html).toContain('Accept</button>');
        // Diff zone labels
        expect(html).toContain('Diff</div>');
        expect(html).toContain('Baseline</div>');
        expect(html).toContain('Actual</div>');
    });

    it('renders new checkpoints with actual thumbnails', () => {
        const data: ReviewData = {
            extension: '.png',
            checkpoints: [
                makeCheckpoint({
                    checkpoint: 'signup',
                    viewport: 'mobile',
                    status: 'new',
                }),
            ],
        };

        const html = renderReviewPage('my-app', 'abc12345', data, null, 'Megatest');

        expect(html).toContain('data-status="new"');
        expect(html).toContain('signup-mobile-actual.png');
        expect(html).toContain('Accept</button>');
        expect(html).toContain('new</span>');
    });

    it('renders passed checkpoints with baseline thumbnails', () => {
        const data: ReviewData = {
            extension: '.png',
            checkpoints: [
                makeCheckpoint({
                    checkpoint: 'footer',
                    viewport: 'desktop',
                    status: 'pass',
                }),
            ],
        };

        const html = renderReviewPage('my-app', 'abc12345', data, null, 'Megatest');

        expect(html).toContain('data-status="pass"');
        // Passed checkpoints use baselines path (not from reports dir)
        expect(html).toContain('/projects/my-app/baselines/footer-desktop.png');
        // No accept button for passed
        expect(html).not.toContain('rv-accept-btn');
    });

    it('shows accept-all button when there are changes', () => {
        const data: ReviewData = {
            extension: '.png',
            checkpoints: [
                makeCheckpoint({ status: 'fail', diffPercent: 1.0 }),
                makeCheckpoint({ checkpoint: 'nav', status: 'new' }),
            ],
        };

        const html = renderReviewPage('my-app', 'abc12345', data, null, 'Megatest');

        expect(html).toContain('Accept All Changes');
        expect(html).toContain('rv-accept-all');
        expect(html).toContain('accept-all');
    });

    it('does not show accept-all button when all checkpoints pass', () => {
        const data: ReviewData = {
            extension: '.png',
            checkpoints: [makeCheckpoint({ status: 'pass' })],
        };

        const html = renderReviewPage('my-app', 'abc12345', data, null, 'Megatest');

        expect(html).not.toContain('Accept All Changes');
        expect(html).not.toContain('rv-accept-all');
    });

    it('defaults to diff tab when there are failures', () => {
        const data: ReviewData = {
            extension: '.png',
            checkpoints: [
                makeCheckpoint({ status: 'fail', diffPercent: 0.5 }),
                makeCheckpoint({ checkpoint: 'nav', status: 'new' }),
                makeCheckpoint({ checkpoint: 'footer', status: 'pass' }),
            ],
        };

        const html = renderReviewPage('my-app', 'abc12345', data, null, 'Megatest');

        expect(html).toContain('data-default-tab="diff"');
        // Diff tab should be active
        expect(html).toContain('data-tab="diff">\n            Differences');
    });

    it('defaults to new tab when there are no failures but new checkpoints exist', () => {
        const data: ReviewData = {
            extension: '.png',
            checkpoints: [makeCheckpoint({ status: 'new' }), makeCheckpoint({ checkpoint: 'footer', status: 'pass' })],
        };

        const html = renderReviewPage('my-app', 'abc12345', data, null, 'Megatest');

        expect(html).toContain('data-default-tab="new"');
    });

    it('defaults to pass tab when all checkpoints pass', () => {
        const data: ReviewData = {
            extension: '.png',
            checkpoints: [makeCheckpoint({ status: 'pass' })],
        };

        const html = renderReviewPage('my-app', 'abc12345', data, null, 'Megatest');

        expect(html).toContain('data-default-tab="pass"');
    });

    it('escapes HTML in user-facing strings', () => {
        const data: ReviewData = {
            extension: '.png',
            checkpoints: [
                makeCheckpoint({
                    checkpoint: '<script>alert(1)</script>',
                    viewport: 'desktop',
                    status: 'pass',
                }),
            ],
        };

        const html = renderReviewPage('<script>xss</script>', 'abc12345', data, null, '<b>Title</b>');

        expect(html).not.toContain('<script>xss</script>');
        expect(html).not.toContain('<script>alert(1)</script>');
        expect(html).toContain('&lt;script&gt;xss&lt;/script&gt;');
        expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(html).toContain('&lt;b&gt;Title&lt;/b&gt;');
    });

    it('renders meta info line when meta is provided', () => {
        const data: ReviewData = {
            extension: '.png',
            checkpoints: [makeCheckpoint({ status: 'pass' })],
        };
        const meta = makeMeta({ duration: 12000, totalCheckpoints: 8 });

        const html = renderReviewPage('my-app', 'abc12345', data, meta, 'Megatest');

        expect(html).toContain('12.0s');
        expect(html).toContain('8 checkpoints');
    });

    it('does not render meta info line when meta is null', () => {
        const data: ReviewData = {
            extension: '.png',
            checkpoints: [makeCheckpoint({ status: 'pass' })],
        };

        const html = renderReviewPage('my-app', 'abc12345', data, null, 'Megatest');

        // The muted text-xs span for meta should not appear
        expect(html).not.toContain('checkpoints</span>');
    });

    it('uses webp extension when data specifies it', () => {
        const data: ReviewData = {
            extension: '.webp',
            checkpoints: [makeCheckpoint({ status: 'fail', diffPercent: 1.0 })],
        };

        const html = renderReviewPage('my-app', 'abc12345', data, null, 'Megatest');

        expect(html).toContain('hero-desktop-diff.webp');
        expect(html).toContain('hero-desktop-actual.webp');
        expect(html).toContain('hero-desktop-baseline.webp');
    });

    it('shows correct tab counts', () => {
        const data: ReviewData = {
            extension: '.png',
            checkpoints: [
                makeCheckpoint({ checkpoint: 'a', status: 'fail', diffPercent: 1.0 }),
                makeCheckpoint({ checkpoint: 'b', status: 'fail', diffPercent: 2.0 }),
                makeCheckpoint({ checkpoint: 'c', status: 'new' }),
                makeCheckpoint({ checkpoint: 'd', status: 'pass' }),
                makeCheckpoint({ checkpoint: 'e', status: 'pass' }),
                makeCheckpoint({ checkpoint: 'f', status: 'pass' }),
            ],
        };

        const html = renderReviewPage('my-app', 'abc12345', data, null, 'Megatest');

        // Diff tab count: 2
        expect(html).toContain('Differences <span class="rv__tab-count">2</span>');
        // New tab count: 1
        expect(html).toContain('New <span class="rv__tab-count">1</span>');
        // Pass tab count: 3
        expect(html).toContain('Passed <span class="rv__tab-count">3</span>');
    });

    it('displays truncated commit hash in breadcrumb', () => {
        const data: ReviewData = {
            extension: '.png',
            checkpoints: [],
        };

        const html = renderReviewPage('my-app', 'abc12345deadbeef', data, null, 'Megatest');

        expect(html).toContain('abc12345');
        // Should be truncated to 8 chars
        expect(html).toContain('<span class="rv__current mono">abc12345</span>');
    });

    it('includes error checkpoint count in HTML comment', () => {
        const data: ReviewData = {
            extension: '.png',
            checkpoints: [makeCheckpoint({ status: 'error', error: 'Timeout' })],
        };

        const html = renderReviewPage('my-app', 'abc12345', data, null, 'Megatest');

        expect(html).toContain('<!-- 1 error checkpoint(s) omitted from review -->');
    });
});
