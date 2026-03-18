export interface RawImage {
    data: Buffer;
    width: number;
    height: number;
}

export interface ImageCodec {
    /** File extension including the dot, e.g. '.png' or '.webp' */
    readonly extension: string;

    /** MIME type for HTTP serving, e.g. 'image/png' or 'image/webp' */
    readonly mimeType: string;

    /** Decode an image file into raw RGBA pixel data for pixelmatch */
    decode(filePath: string): Promise<RawImage>;

    /** Encode raw RGBA pixel data and write to disk in this format */
    encode(image: RawImage, outputPath: string): Promise<void>;

    /** Write a Playwright PNG screenshot buffer to disk in this format */
    writeScreenshot(pngBuffer: Buffer, outputPath: string): Promise<void>;
}
