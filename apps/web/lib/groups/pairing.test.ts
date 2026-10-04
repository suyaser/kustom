import { createHash } from 'node:crypto';
import { PAIRING_CODE_ALPHABET, pairingCodeSchema } from '@customs/db/schemas';
import { describe, expect, it } from 'vitest';
import { FALLBACK_LINKED_NAME, HOST_NOT_ADMIN, pairingDiscordLinked } from './copy';
import { clientAddress, generatePairingCode, hashPairingCode } from './pairing';

describe('generatePairingCode', () => {
  it('is six characters of the alphabet, every time', () => {
    for (let i = 0; i < 500; i += 1) {
      expect(pairingCodeSchema.safeParse(generatePairingCode()).success).toBe(true);
    }
  });

  it('draws each character from the whole alphabet', () => {
    let next = 0;
    const sequential = (max: number): number => {
      const value = next % max;
      next += 1;
      return value;
    };
    const seen = new Set<string>();
    for (let i = 0; i < 6; i += 1) for (const char of generatePairingCode(sequential)) seen.add(char);
    expect([...seen].sort().join('')).toBe([...PAIRING_CODE_ALPHABET].sort().join(''));
  });
});

describe('hashPairingCode', () => {
  it('is SHA-256 hex of the code as typed, the shape pairing_codes_hash_shape checks', () => {
    expect(hashPairingCode('K7QM4X')).toBe(createHash('sha256').update('K7QM4X').digest('hex'));
    expect(hashPairingCode('K7QM4X')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashPairingCode('K7QM4X')).not.toBe(hashPairingCode('K7QM4Y'));
  });
});

describe('clientAddress', () => {
  const at = (headers: Record<string, string>) => clientAddress(new Request('http://x/', { headers }));

  it('is the first x-forwarded-for entry, then x-real-ip, then one shared bucket', () => {
    expect(at({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' })).toBe('203.0.113.7');
    expect(at({ 'x-real-ip': '198.51.100.2' })).toBe('198.51.100.2');
    expect(at({})).toBe('unknown');
  });
});

describe('pairingDiscordLinked', () => {
  it("is product's sentence with the name, and a fallback for a row with none", () => {
    expect(pairingDiscordLinked('Hana')).toBe('This Discord account is already linked to Hana.');
    expect(pairingDiscordLinked(null)).toBe(
      `This Discord account is already linked to ${FALLBACK_LINKED_NAME}.`,
    );
  });
});

describe('HOST_NOT_ADMIN', () => {
  it('is the sentence Kustom shows a member on its Link screen, with no overlay to fall back to (M17.12)', () => {
    expect(HOST_NOT_ADMIN).toBe("You're in. Only admins can host. Ask an admin to host, or to make you one.");
    expect(HOST_NOT_ADMIN).not.toMatch(/overlay/i);
  });
});
