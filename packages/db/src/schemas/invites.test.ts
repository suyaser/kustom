import { describe, expect, it } from 'vitest';
import {
  companionPairRequestSchema,
  createGroupRequestSchema,
  GROUP_NAME_RULE,
  GROUP_SLUG_RULE,
  INVITE_CODE_PATTERN,
  inviteCodeSchema,
  ORIGINAL_GROUP_ID,
  PAIRING_CODE_ALPHABET,
  pairingCodeSchema,
  pairingRequestSchema,
  pairingStatusResponseSchema,
} from './index';

describe('pairing codes (M13.5)', () => {
  it('the alphabet is upper case and digits with no 0 O 1 I, 32 letters', () => {
    expect(PAIRING_CODE_ALPHABET).toHaveLength(32);
    expect(new Set(PAIRING_CODE_ALPHABET).size).toBe(32);
    for (const confusable of ['0', 'O', '1', 'I']) expect(PAIRING_CODE_ALPHABET).not.toContain(confusable);
  });

  it.each([
    ['K7QM4X', true],
    ['ABCDEF', true],
    ['k7qm4x', false],
    ['K7QM4', false],
    ['K7QM4XX', false],
    ['K7QM0X', false],
    ['K7 QM4', false],
    [' K7QM4X', false],
  ])('%s -> %s, never trimmed or upper-cased', (code, valid) => {
    expect(pairingCodeSchema.safeParse(code).success).toBe(valid);
  });

  it('the pair body needs a real PUUID: the bot placeholder is refused', () => {
    expect(companionPairRequestSchema.safeParse({ code: 'K7QM4X', puuid: 'abc-123' }).success).toBe(true);
    expect(
      companionPairRequestSchema.safeParse({ code: 'K7QM4X', puuid: '00000000-0000-0000-0000-000000000000' })
        .success,
    ).toBe(false);
    expect(companionPairRequestSchema.safeParse({ code: 'K7QM4X', puuid: '' }).success).toBe(false);
  });
});

describe('invite codes (M13.5)', () => {
  it('are 22 url-safe characters', () => {
    expect(inviteCodeSchema.safeParse('q3XbTaLm9VZpR2kYw8sNe-').success).toBe(true);
    expect(inviteCodeSchema.safeParse('q3XbTaLm9VZpR2kYw8sN_-').success).toBe(true);
    expect(inviteCodeSchema.safeParse('q3XbTaLm9VZpR2kYw8sNe').success).toBe(false);
    expect(inviteCodeSchema.safeParse('q3XbTaLm9VZpR2kYw8sNe+').success).toBe(false);
    expect(INVITE_CODE_PATTERN.source).toBe('^[A-Za-z0-9_-]{22}$');
  });
});

describe('createGroupRequestSchema (M13.5)', () => {
  it('trims the name and keeps the slug exactly as sent', () => {
    expect(createGroupRequestSchema.parse({ name: '  Thursday Flex ', slug: 'thursday-flex' })).toEqual({
      name: 'Thursday Flex',
      slug: 'thursday-flex',
    });
  });

  it.each(['Abc', 'ab', 'new', 'a'.repeat(33), '-abc', 'thursday flex'])(
    "slug %s fails with product's one sentence",
    (slug) => {
      const result = createGroupRequestSchema.safeParse({ name: 'x', slug });
      expect(result.success).toBe(false);
      expect(result.error?.issues.map((i) => [i.path.join('.'), i.message])).toEqual([
        ['slug', GROUP_SLUG_RULE],
      ]);
    },
  );

  it.each(['', '   ', 'x'.repeat(41)])('name %j fails with the name sentence', (name) => {
    const result = createGroupRequestSchema.safeParse({ name, slug: 'abc' });
    expect(result.error?.issues.map((i) => [i.path.join('.'), i.message])).toEqual([
      ['name', GROUP_NAME_RULE],
    ]);
  });

  it('a 40-character name after trimming passes', () => {
    expect(createGroupRequestSchema.safeParse({ name: ` ${'x'.repeat(40)} `, slug: 'abc' }).success).toBe(
      true,
    );
  });
});

describe('pairingRequestSchema (M13.5)', () => {
  it('takes exactly one of groupId and inviteCode', () => {
    expect(pairingRequestSchema.safeParse({ groupId: ORIGINAL_GROUP_ID }).success).toBe(true);
    expect(pairingRequestSchema.safeParse({ inviteCode: 'q3XbTaLm9VZpR2kYw8sNe-' }).success).toBe(true);
    expect(
      pairingRequestSchema.safeParse({ groupId: ORIGINAL_GROUP_ID, inviteCode: 'q3XbTaLm9VZpR2kYw8sNe-' })
        .success,
    ).toBe(false);
    expect(pairingRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('pairingStatusResponseSchema (M13.5)', () => {
  it('is a union on status: used carries the group, waiting the expiry, expired nothing', () => {
    const group = { id: ORIGINAL_GROUP_ID, slug: 'customs', name: 'Customs Night' };
    expect(pairingStatusResponseSchema.safeParse({ ok: true, status: 'used', group }).success).toBe(true);
    expect(pairingStatusResponseSchema.safeParse({ ok: true, status: 'used' }).success).toBe(false);
    expect(
      pairingStatusResponseSchema.safeParse({
        ok: true,
        status: 'waiting',
        expiresAt: '2026-10-03T20:15:00.000Z',
      }).success,
    ).toBe(true);
    expect(pairingStatusResponseSchema.safeParse({ ok: true, status: 'expired' }).success).toBe(true);
    expect(pairingStatusResponseSchema.safeParse({ ok: true, status: 'pending' }).success).toBe(false);
  });
});
