import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateTOTP } from '../../src/config/totp.js';

describe('generateTOTP', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('produces a 6-digit string', () => {
        // Fix time to a known epoch
        vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
        const secret = 'JBSWY3DPEHPK3PXP'; // common test secret
        const code = generateTOTP(secret);
        expect(code).toMatch(/^\d{6}$/);
    });

    it('returns deterministic output for fixed time and secret', () => {
        vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
        const secret = 'JBSWY3DPEHPK3PXP';
        const code1 = generateTOTP(secret);
        const code2 = generateTOTP(secret);
        expect(code1).toBe(code2);
    });

    it('produces different codes for different time steps', () => {
        const secret = 'JBSWY3DPEHPK3PXP';

        vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
        const code1 = generateTOTP(secret);

        // Advance 30 seconds to the next time step
        vi.setSystemTime(new Date('2024-01-01T00:00:30Z'));
        const code2 = generateTOTP(secret);

        // They should differ (extremely unlikely to collide)
        expect(code1).not.toBe(code2);
    });

    it('zero-pads codes shorter than 6 digits', () => {
        // We can't easily force a zero-padded result, but the code always pads.
        // Instead, verify the output is always exactly 6 characters.
        vi.setSystemTime(new Date('2000-01-01T00:00:00Z'));
        const secret = 'JBSWY3DPEHPK3PXP';
        const code = generateTOTP(secret);
        expect(code).toHaveLength(6);
        expect(Number.parseInt(code, 10)).toBeLessThan(1_000_000);
    });

    it('produces different codes for different secrets', () => {
        vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
        const code1 = generateTOTP('JBSWY3DPEHPK3PXP');
        const code2 = generateTOTP('HXDMVJECJJWSRB3HWIZR4IFUGFTMXBOZ');
        expect(code1).not.toBe(code2);
    });

    it('handles secrets with lowercase and padding characters', () => {
        vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
        // base32Decode strips whitespace and '=' padding, uppercases
        const code1 = generateTOTP('JBSWY3DPEHPK3PXP');
        const code2 = generateTOTP('jbswy3dpehpk3pxp');
        expect(code1).toBe(code2);
    });

    it('throws on invalid base32 characters', () => {
        vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
        expect(() => generateTOTP('INVALID!SECRET')).toThrow('Invalid base32 character');
    });
});
