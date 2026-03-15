export type { ImageCodec, RawImage } from './codec.js';
export { PngCodec } from './png.js';
export { WebpCodec } from './webp.js';

import type { ImageCodec } from './codec.js';
import { PngCodec } from './png.js';
import { WebpCodec } from './webp.js';

export type ImageFormat = 'png' | 'webp';

export function createCodec(format: ImageFormat): ImageCodec {
  switch (format) {
    case 'png':
      return new PngCodec();
    case 'webp':
      return new WebpCodec();
    default:
      throw new Error(`Unsupported image format: ${format as string}`);
  }
}
