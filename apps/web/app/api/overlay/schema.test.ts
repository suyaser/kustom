import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { overlayFearless } from '@/lib/overlay/fold';
import { emptyOverlay, type OverlayResponse, overlayResponseSchema } from './schema';

/**
 * `GET /api/overlay` after M14.29: the fearless block gains `enabled` (`mode === 'fearless'`) and
 * nothing else changes, so the panel already in friends' hands keeps parsing the answer.
 *
 * `OLD_PANEL_SCHEMA` is a frozen copy of `overlayPayloadSchema` from
 * `apps/companion/src/panel/api.ts` as the 0.2.x / M14.6 companion ships it. It is copied, not
 * imported: the point is the schema already released, not whatever the companion says next.
 */
const oldRecord = z.object({ games: z.number(), wins: z.number(), losses: z.number() });
const oldSeat = z.object({
  puuid: z.string(),
  name: z.string().nullable(),
  role: z.enum(['top', 'jungle', 'mid', 'adc', 'support']).nullable(),
  rating: z.number(),
  side: z.union([z.literal(100), z.literal(200)]),
  with: oldRecord.nullable(),
  against: oldRecord.nullable(),
  isLaneOpponent: z.boolean(),
  lane: oldRecord.nullable(),
});
const OLD_PANEL_SCHEMA = z.object({
  ok: z.literal(true),
  viewerPuuid: z.string(),
  fearless: z.object({
    champions: z.array(
      z.object({
        id: z.number(),
        name: z.string(),
        role: z.enum(['top', 'jungle', 'mid', 'adc', 'support']).nullable(),
        iconUrl: z.string().nullable(),
      }),
    ),
    resetAt: z.string().nullable(),
  }),
  lobby: z
    .object({
      status: z.string(),
      teams: z.object({ blue: z.array(oldSeat), red: z.array(oldSeat) }).nullable(),
    })
    .nullable(),
});

const PUUID = 'f1a2b3c4-d5e6-7890-abcd-ef1234567890';
const POOL = [
  { id: 103, name: 'Ahri', role: 'mid' as const },
  { id: 222, name: 'Jinx', role: 'adc' as const },
];
const RESET_AT = '2026-10-01T18:00:00.000Z';

function answer(mode: 'normal' | 'fearless'): OverlayResponse {
  return overlayResponseSchema.parse({
    ok: true,
    viewerPuuid: PUUID,
    fearless: overlayFearless(mode, POOL, RESET_AT),
    lobby: null,
  });
}

describe('GET /api/overlay fearless block (M14.29)', () => {
  it("Fearless: enabled, today's list", () => {
    const body = answer('fearless');
    expect(body.fearless.enabled).toBe(true);
    expect(body.fearless.champions.map((champion) => champion.id).sort()).toEqual([103, 222]);
    expect(body.fearless.resetAt).toBe(RESET_AT);
  });

  it('Normal: not enabled and no champions, the cursor kept', () => {
    const body = answer('normal');
    expect(body.fearless).toEqual({ enabled: false, champions: [], resetAt: RESET_AT });
  });

  it('a PUUID in no group: the empty answer, now with enabled false', () => {
    expect(overlayResponseSchema.parse(emptyOverlay(PUUID))).toEqual({
      ok: true,
      viewerPuuid: PUUID,
      fearless: { enabled: false, champions: [], resetAt: null },
      lobby: null,
    });
  });

  it('refuses an answer without enabled (the server always says it)', () => {
    const body = answer('fearless');
    const { enabled: _enabled, ...withoutEnabled } = body.fearless;
    expect(overlayResponseSchema.safeParse({ ...body, fearless: withoutEnabled }).success).toBe(false);
  });

  it('the released panel schema still parses every answer, and Normal lists no bans in it', () => {
    for (const body of [answer('fearless'), answer('normal'), emptyOverlay(PUUID)]) {
      expect(OLD_PANEL_SCHEMA.safeParse(JSON.parse(JSON.stringify(body))).success).toBe(true);
    }
    expect(OLD_PANEL_SCHEMA.parse(answer('normal')).fearless.champions).toEqual([]);
  });
});
