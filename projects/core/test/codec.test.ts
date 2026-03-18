import { describe, expect, it } from 'vitest';
import { createCodec } from '../src/codec/index.js';
import type { ImageFormat } from '../src/codec/index.js';

describe('createCodec', () => {
    it('returns a PNG codec with correct extension and mimeType', () => {
        const codec = createCodec('png');
        expect(codec.extension).toBe('.png');
        expect(codec.mimeType).toBe('image/png');
    });

    it('returns a WebP codec with correct extension and mimeType', () => {
        const codec = createCodec('webp');
        expect(codec.extension).toBe('.webp');
        expect(codec.mimeType).toBe('image/webp');
    });

    it('throws for unsupported format', () => {
        expect(() => createCodec('gif' as ImageFormat)).toThrow('Unsupported image format: gif');
    });
});
