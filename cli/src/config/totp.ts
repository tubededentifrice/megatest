import { createHmac } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Decodes a base32-encoded string (RFC 4648) to a Buffer.
 */
function base32Decode(encoded: string): Buffer {
    const clean = encoded.toUpperCase().replace(/[\s=]/g, '');
    let bits = '';
    for (const char of clean) {
        const val = BASE32_ALPHABET.indexOf(char);
        if (val === -1) throw new Error(`Invalid base32 character: ${char}`);
        bits += val.toString(2).padStart(5, '0');
    }
    const bytes: number[] = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) {
        bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
    }
    return Buffer.from(bytes);
}

/**
 * Generates a 6-digit TOTP code per RFC 6238 / RFC 4226.
 * Uses HMAC-SHA1 with a 30-second time step.
 */
export function generateTOTP(secret: string): string {
    const key = base32Decode(secret);
    const time = Math.floor(Date.now() / 1000 / 30);
    const timeBuffer = Buffer.alloc(8);
    timeBuffer.writeBigUInt64BE(BigInt(time));

    const hmac = createHmac('sha1', key).update(timeBuffer).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const code =
        ((hmac[offset] & 0x7f) << 24) |
        ((hmac[offset + 1] & 0xff) << 16) |
        ((hmac[offset + 2] & 0xff) << 8) |
        (hmac[offset + 3] & 0xff);

    return (code % 1_000_000).toString().padStart(6, '0');
}
