import { describe, expect, it } from 'vitest';
import { escapeHtml, formatDuration, getMimeType, timeTag } from '../src/utils.js';

describe('getMimeType', () => {
    it('returns text/javascript for .js files', () => {
        expect(getMimeType('bundle.js')).toBe('text/javascript; charset=utf-8');
    });

    it('returns text/css for .css files', () => {
        expect(getMimeType('styles.css')).toBe('text/css; charset=utf-8');
    });

    it('returns text/html for .html files', () => {
        expect(getMimeType('index.html')).toBe('text/html; charset=utf-8');
    });

    it('returns image/png for .png files', () => {
        expect(getMimeType('screenshot.png')).toBe('image/png');
    });

    it('returns image/svg+xml for .svg files', () => {
        expect(getMimeType('icon.svg')).toBe('image/svg+xml');
    });

    it('returns image/webp for .webp files', () => {
        expect(getMimeType('photo.webp')).toBe('image/webp');
    });

    it('returns application/json for .json files', () => {
        expect(getMimeType('data.json')).toBe('application/json; charset=utf-8');
    });

    it('returns image/jpeg for .jpg files', () => {
        expect(getMimeType('photo.jpg')).toBe('image/jpeg');
    });

    it('returns image/jpeg for .jpeg files', () => {
        expect(getMimeType('photo.jpeg')).toBe('image/jpeg');
    });

    it('returns image/gif for .gif files', () => {
        expect(getMimeType('animation.gif')).toBe('image/gif');
    });

    it('returns application/octet-stream for unknown extensions', () => {
        expect(getMimeType('archive.tar.gz')).toBe('application/octet-stream');
    });

    it('returns application/octet-stream for files with no extension', () => {
        expect(getMimeType('Makefile')).toBe('application/octet-stream');
    });

    it('handles paths with directories', () => {
        expect(getMimeType('/static/dist/bundle.js')).toBe('text/javascript; charset=utf-8');
    });

    it('is case-insensitive for extensions', () => {
        expect(getMimeType('IMAGE.PNG')).toBe('image/png');
    });
});

describe('escapeHtml', () => {
    it('escapes ampersands', () => {
        expect(escapeHtml('a&b')).toBe('a&amp;b');
    });

    it('escapes less-than signs', () => {
        expect(escapeHtml('a<b')).toBe('a&lt;b');
    });

    it('escapes greater-than signs', () => {
        expect(escapeHtml('a>b')).toBe('a&gt;b');
    });

    it('escapes double quotes', () => {
        expect(escapeHtml('a"b')).toBe('a&quot;b');
    });

    it('returns empty string unchanged', () => {
        expect(escapeHtml('')).toBe('');
    });

    it('returns already-safe string unchanged', () => {
        expect(escapeHtml('hello world 123')).toBe('hello world 123');
    });

    it('escapes multiple special characters together', () => {
        expect(escapeHtml('<a href="foo&bar">')).toBe('&lt;a href=&quot;foo&amp;bar&quot;&gt;');
    });
});

describe('formatDuration', () => {
    it('formats sub-minute durations as seconds', () => {
        expect(formatDuration(5000)).toBe('5.0s');
    });

    it('formats fractional seconds', () => {
        expect(formatDuration(12345)).toBe('12.3s');
    });

    it('formats zero duration', () => {
        expect(formatDuration(0)).toBe('0.0s');
    });

    it('formats sub-second durations', () => {
        expect(formatDuration(500)).toBe('0.5s');
    });

    it('formats durations at exactly 60 seconds as minutes', () => {
        expect(formatDuration(60000)).toBe('1m 0s');
    });

    it('formats durations greater than 60 seconds as minutes and seconds', () => {
        expect(formatDuration(90000)).toBe('1m 30s');
    });

    it('formats multi-minute durations', () => {
        expect(formatDuration(185000)).toBe('3m 5s');
    });

    it('formats durations just under 60 seconds', () => {
        expect(formatDuration(59999)).toBe('60.0s');
    });
});

describe('timeTag', () => {
    it('returns a <time> element with data-ts attribute', () => {
        const result = timeTag('2024-01-15T10:30:00Z');
        expect(result).toBe('<time data-ts="2024-01-15T10:30:00Z"></time>');
    });

    it('escapes HTML in the date string', () => {
        const result = timeTag('"><script>alert(1)</script>');
        expect(result).toContain('&quot;');
        expect(result).toContain('&lt;script&gt;');
        expect(result).not.toContain('<script>');
    });
});
