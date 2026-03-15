import * as fs from 'node:fs';
import { PNG } from 'pngjs';
import type { ImageCodec, RawImage } from './codec.js';

export class PngCodec implements ImageCodec {
    readonly extension = '.png';
    readonly mimeType = 'image/png';

    async decode(filePath: string): Promise<RawImage> {
        const png = PNG.sync.read(fs.readFileSync(filePath));
        return { data: png.data as Buffer, width: png.width, height: png.height };
    }

    async encode(image: RawImage, outputPath: string): Promise<void> {
        const png = new PNG({ width: image.width, height: image.height });
        image.data.copy(png.data);
        fs.writeFileSync(outputPath, PNG.sync.write(png));
    }

    async writeScreenshot(pngBuffer: Buffer, outputPath: string): Promise<void> {
        fs.writeFileSync(outputPath, pngBuffer);
    }
}
