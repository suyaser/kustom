/**
 * Fetches `GET /api/overlay?puuid=` — public, no companion token.
 */

import { z } from 'zod';

const recordSchema = z.object({
  games: z.number(),
  wins: z.number(),
  losses: z.number(),
});

const seatSchema = z.object({
  puuid: z.string(),
  name: z.string().nullable(),
  role: z.enum(['top', 'jungle', 'mid', 'adc', 'support']).nullable(),
  rating: z.number(),
  side: z.union([z.literal(100), z.literal(200)]),
  with: recordSchema.nullable(),
  against: recordSchema.nullable(),
  isLaneOpponent: z.boolean(),
  lane: recordSchema.nullable(),
});

export const overlayPayloadSchema = z.object({
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
      teams: z
        .object({
          blue: z.array(seatSchema),
          red: z.array(seatSchema),
        })
        .nullable(),
    })
    .nullable(),
});

export type OverlayPayload = z.infer<typeof overlayPayloadSchema>;

export async function fetchOverlay(
  apiBase: string,
  puuid: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OverlayPayload> {
  const url = `${apiBase}/api/overlay?puuid=${encodeURIComponent(puuid)}`;
  const response = await fetchImpl(url, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`overlay API ${response.status} (${url})`);
  }
  const json: unknown = await response.json();
  return overlayPayloadSchema.parse(json);
}
