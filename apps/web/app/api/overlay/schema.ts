import { groupIdSchema } from '@customs/db/schemas';
import { z } from 'zod';

/**
 * Request and response schemas for `GET /api/overlay` (M12).
 *
 * Public read of data `/`, `/p/[puuid]` and `/fun` already show. No companion token.
 */

const roleSchema = z.enum(['top', 'jungle', 'mid', 'adc', 'support']);
const sideSchema = z.union([z.literal(100), z.literal(200)]);

export const overlayQuerySchema = z.object({
  puuid: z.string().min(1).max(128),
  /**
   * The group to answer for (M13.3): `groups.id`. Answered only when the PUUID is a member of it.
   * Missing: the PUUID's only group, or the empty answer when they have several (the 0.2.x panel
   * sends none). `GET /api/overlay/groups` lists the choices. `groupIdSchema` (a guid), not
   * `z.uuid()`, which refuses the original group's fixed id (M13.4 fix).
   */
  group: groupIdSchema.optional(),
});

const recordSchema = z.object({
  games: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
});

const seatSchema = z.object({
  puuid: z.string(),
  name: z.string().nullable(),
  role: roleSchema.nullable(),
  rating: z.number().int(),
  side: sideSchema,
  with: recordSchema.nullable(),
  against: recordSchema.nullable(),
  isLaneOpponent: z.boolean(),
  lane: recordSchema.nullable(),
});

const fearlessChampionSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  role: roleSchema.nullable(),
  iconUrl: z.union([z.string().url(), z.null()]),
});

export const overlayResponseSchema = z.object({
  ok: z.literal(true),
  viewerPuuid: z.string(),
  fearless: z.object({
    /**
     * M14.29: `mode === 'fearless'`. False on Normal, with `champions` empty. Added, not changed:
     * the 0.2.x / M14.6 panel ignores it and still parses the answer.
     */
    enabled: z.boolean(),
    champions: z.array(fearlessChampionSchema),
    resetAt: z.string().nullable(),
  }),
  lobby: z
    .object({
      status: z.enum(['open', 'balanced', 'in_game', 'dropped', 'finished', 'abandoned']),
      teams: z
        .object({
          blue: z.array(seatSchema),
          red: z.array(seatSchema),
        })
        .nullable(),
    })
    .nullable(),
});

export type OverlayResponse = z.infer<typeof overlayResponseSchema>;

/**
 * The answer for a PUUID with no group to show (M13.3): not a member of the group asked for,
 * unknown, or in several groups with none named. Nothing banned, no lobby, and (M14.29) no
 * fearless in force.
 */
export function emptyOverlay(puuid: string): OverlayResponse {
  return {
    ok: true,
    viewerPuuid: puuid,
    fearless: { enabled: false, champions: [], resetAt: null },
    lobby: null,
  };
}
