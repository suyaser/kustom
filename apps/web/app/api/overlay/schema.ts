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
