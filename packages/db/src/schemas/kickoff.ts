import { z } from 'zod';

/**
 * The kickoff record (M21.4, `0046_lobby_kickoff.sql`): the teams that started the game, whether
 * they are the bot's roll, and Kustom's odds for them when they are not. The server writes it once
 * at the move to `in_game`; Tonight (M21.5), the `Game on` post (M21.6) and the after-game readers
 * (M21.7) read it through {@link kickoffFromRow}, so every reader agrees on one shape.
 *
 * - `rolled`: the chosen split's teams, roles ignored. `swapped` when they played on the split's
 *   opposite sides; the split's stored `blue_win_prob` is then the real red side's chance.
 * - `custom`: a chosen split exists and the teams differ. Odds stored.
 * - `unrolled`: no chosen split. Odds stored.
 *
 * Odds are stored for a not-rated or ARAM game too; whether they are shown is the reader's rule
 * (M15.18). The end-of-game sides win over this record for every surface once they land.
 */

export const KICKOFF_KINDS = ['rolled', 'custom', 'unrolled'] as const;
export const kickoffKindSchema = z.enum(KICKOFF_KINDS);
export type KickoffKind = z.infer<typeof kickoffKindSchema>;

/** The most players a side holds in a custom game; a 2v2 to 4v4 is a kickoff too (M21.1 note b). */
export const KICKOFF_MAX_SIDE = 5;

const puuid = z.string().min(1);
const side = z.array(puuid).min(1).max(KICKOFF_MAX_SIDE);

const teams = {
  blue: side,
  red: side,
  /** When the record was written (ISO). */
  at: z.string().min(1),
};

const rolledSchema = z.object({ kind: z.literal('rolled'), ...teams, swapped: z.boolean() });
const pricedSchema = z.object({
  kind: z.enum(['custom', 'unrolled']),
  ...teams,
  /** Blue's chance from core's `winProbability` over the summed all-time `ratings.r` (1200 for no row). */
  blueWinProb: z.number().finite().min(0).max(1),
  oddsModel: z.literal('kustom'),
});

function sidesAreTeams(record: { blue: readonly string[]; red: readonly string[] }): boolean {
  const all = [...record.blue, ...record.red];
  return record.blue.length === record.red.length && new Set(all).size === all.length;
}

export const lobbyKickoffSchema = z
  .discriminatedUnion('kind', [rolledSchema, pricedSchema])
  .refine(sidesAreTeams, { message: 'kickoff sides must be the same size with no puuid twice' });

export type LobbyKickoff = z.infer<typeof lobbyKickoffSchema>;

/** The `lobbies` columns the record lives in, as selected. */
export const KICKOFF_COLUMNS =
  'kickoff_kind, kickoff_blue, kickoff_red, kickoff_swapped, kickoff_blue_win_prob, kickoff_odds_model, kickoff_at' as const;

export interface KickoffRow {
  kickoff_kind: string | null;
  kickoff_blue: string[] | null;
  kickoff_red: string[] | null;
  kickoff_swapped: boolean;
  kickoff_blue_win_prob: number | null;
  kickoff_odds_model: string | null;
  kickoff_at: string | null;
}

/**
 * The lobby's kickoff record, or `null` for none (or a row this build cannot read).
 *
 * `onDrop` hears a row that has a kind but does not parse (the reviewer's ask, M21.5): the reader
 * logs it with what it knows (the lobby id) and carries on as if there were no record. It is never
 * called for a lobby with no record at all.
 */
export function kickoffFromRow(
  row: KickoffRow,
  onDrop?: (reason: string) => void,
): LobbyKickoff | null {
  if (row.kickoff_kind === null) return null;
  const candidate =
    row.kickoff_kind === 'rolled'
      ? {
          kind: row.kickoff_kind,
          blue: row.kickoff_blue,
          red: row.kickoff_red,
          at: row.kickoff_at,
          swapped: row.kickoff_swapped,
        }
      : {
          kind: row.kickoff_kind,
          blue: row.kickoff_blue,
          red: row.kickoff_red,
          at: row.kickoff_at,
          blueWinProb: row.kickoff_blue_win_prob,
          oddsModel: row.kickoff_odds_model,
        };
  const parsed = lobbyKickoffSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  onDrop?.(
    parsed.error.issues
      .map((issue) => `${issue.path.length === 0 ? 'record' : issue.path.join('.')}: ${issue.message}`)
      .join('; '),
  );
  return null;
}

/** A record as the columns the write sets (the inverse of {@link kickoffFromRow}). */
export function kickoffRowOf(record: LobbyKickoff): KickoffRow {
  return {
    kickoff_kind: record.kind,
    kickoff_blue: [...record.blue],
    kickoff_red: [...record.red],
    kickoff_swapped: record.kind === 'rolled' ? record.swapped : false,
    kickoff_blue_win_prob: record.kind === 'rolled' ? null : record.blueWinProb,
    kickoff_odds_model: record.kind === 'rolled' ? null : record.oddsModel,
    kickoff_at: record.at,
  };
}
