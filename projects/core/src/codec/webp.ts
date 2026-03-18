import type { ImageCodec, RawImage } from './codec.js';

type SharpFn = typeof import('sharp');

let _sharp: SharpFn | undefined;

async function getSharp(): Promise<SharpFn> {
    if (_sharp) return _sharp;
    try {
        // sharp uses `export =` so the default import is the function itself
        const mod = await import('sharp');
        _sharp = mod.default ?? mod;
        return _sharp;
    } catch {
        throw new Error('WebP format requires the "sharp" package. Install it with: npm install sharp');
    }
}

export class WebpCodec implements ImageCodec {
    readonly extension = '.webp';
    readonly mimeType = 'image/webp';

    async decode(filePath: string): Promise<RawImage> {
        const sharp = await getSharp();
        const image = sharp(filePath).ensureAlpha();
        const meta = await image.metadata();
        if (!meta.width || !meta.height) {
            throw new Error(`Cannot read image dimensions: ${filePath}`);
        }
        const data = await image.raw().toBuffer();
        return { data, width: meta.width, height: meta.height };
    }

    async encode(image: RawImage, outputPath: string): Promise<void> {
        const sharp = await getSharp();
        await sharp(image.data, {
            raw: { width: image.width, height: image.height, channels: 4 },
        })
            .webp({ lossless: true })
            .toFile(outputPath);
    }

    async writeScreenshot(pngBuffer: Buffer, outputPath: string): Promise<void> {
        const sharp = await getSharp();
        // Playwright always produces PNG buffers — sharp reads them natively
        await sharp(pngBuffer).webp({ lossless: true }).toFile(outputPath);
    }
}
