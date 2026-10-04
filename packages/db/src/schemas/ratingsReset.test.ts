import { describe, expect, it } from 'vitest';
import { ORIGINAL_GROUP_ID, ratingsResetRequestSchema, ratingsResetResponseSchema } from './index';

describe('ratingsResetRequestSchema (M14.18)', () => {
  it('takes a group and the typed slug, trimmed', () => {
    const parsed = ratingsResetRequestSchema.parse({ groupId: ORIGINAL_GROUP_ID, confirmSlug: ' customs ' });
    expect(parsed.confirmSlug).toBe('customs');
  });

  it('refuses a missing group or slug, and an absurdly long slug', () => {
    expect(ratingsResetRequestSchema.safeParse({ confirmSlug: 'customs' }).success).toBe(false);
    expect(ratingsResetRequestSchema.safeParse({ groupId: ORIGINAL_GROUP_ID }).success).toBe(false);
    expect(
      ratingsResetRequestSchema.safeParse({ groupId: ORIGINAL_GROUP_ID, confirmSlug: 'x'.repeat(65) })
        .success,
    ).toBe(false);
  });

  it('answers with the epoch and what happened to the Discord post', () => {
    expect(
      ratingsResetResponseSchema.safeParse({
        ok: true,
        groupId: ORIGINAL_GROUP_ID,
        ratingsSince: '2026-11-01T20:00:00.000Z',
        post: 'skipped',
      }).success,
    ).toBe(true);
    expect(
      ratingsResetResponseSchema.safeParse({
        ok: true,
        groupId: ORIGINAL_GROUP_ID,
        ratingsSince: 'x',
        post: 'maybe',
      }).success,
    ).toBe(false);
  });
});
