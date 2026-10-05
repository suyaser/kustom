import { describe, expect, it } from 'vitest';
import { type KickoffRow, kickoffFromRow, kickoffIsAram, kickoffRowOf, type LobbyKickoff } from './kickoff';

const blue = ['b0', 'b1', 'b2', 'b3', 'b4'];
const red = ['r0', 'r1', 'r2', 'r3', 'r4'];
const at = '2026-10-05T20:00:00.000Z';

const none: KickoffRow = {
  kickoff_kind: null,
  kickoff_blue: null,
  kickoff_red: null,
  kickoff_swapped: false,
  kickoff_blue_win_prob: null,
  kickoff_odds_model: null,
  kickoff_at: null,
};

/** M21.4 (0046): the kickoff record as every reader parses it. */
describe('kickoffFromRow / kickoffRowOf', () => {
  it('no record reads as null', () => {
    expect(kickoffFromRow(none)).toBeNull();
  });

  it.each<LobbyKickoff>([
    { kind: 'rolled', blue, red, at, swapped: false },
    { kind: 'rolled', blue: red, red: blue, at, swapped: true },
    { kind: 'custom', blue, red, at, blueWinProb: 0.62, oddsModel: 'kustom' },
    {
      kind: 'unrolled',
      blue: blue.slice(0, 3),
      red: red.slice(0, 3),
      at,
      blueWinProb: 0.5,
      oddsModel: 'kustom',
    },
  ])('round-trips $kind', (record) => {
    expect(kickoffFromRow(kickoffRowOf(record))).toEqual(record);
  });

  it('carries the game mode (M21.12): round-trips, ARAM is read as ARAM, none stays absent', () => {
    const aram: LobbyKickoff = {
      kind: 'custom',
      blue,
      red,
      at,
      blueWinProb: 0.62,
      oddsModel: 'kustom',
      gameMode: 'ARAM',
    };
    const row = kickoffRowOf(aram);
    expect(row.kickoff_game_mode).toBe('ARAM');
    const back = kickoffFromRow(row);
    expect(back).toEqual(aram);
    expect(back !== null && kickoffIsAram(back)).toBe(true);
    // A row without the mode (an older companion's, or the column null) has no gameMode key at all.
    const plain = kickoffFromRow(kickoffRowOf({ ...aram, gameMode: null }));
    expect(plain).not.toBeNull();
    expect(plain !== null && 'gameMode' in plain).toBe(false);
    expect(kickoffIsAram({ gameMode: undefined })).toBe(false);
    expect(kickoffIsAram({ gameMode: 'CLASSIC' })).toBe(false);
  });

  it('a rolled row writes no odds; a priced row writes no swap', () => {
    expect(kickoffRowOf({ kind: 'rolled', blue, red, at, swapped: true })).toMatchObject({
      kickoff_blue_win_prob: null,
      kickoff_odds_model: null,
      kickoff_swapped: true,
    });
    expect(
      kickoffRowOf({ kind: 'custom', blue, red, at, blueWinProb: 0.4, oddsModel: 'kustom' }),
    ).toMatchObject({ kickoff_swapped: false, kickoff_blue_win_prob: 0.4, kickoff_odds_model: 'kustom' });
  });

  it.each<[string, Partial<KickoffRow>]>([
    ['unequal sides', { kickoff_kind: 'unrolled', kickoff_red: red.slice(0, 4) }],
    ['a puuid on both sides', { kickoff_kind: 'unrolled', kickoff_red: ['b0', 'r1', 'r2', 'r3', 'r4'] }],
    ['an empty side', { kickoff_kind: 'unrolled', kickoff_blue: [], kickoff_red: [] }],
    ['six a side', { kickoff_kind: 'unrolled', kickoff_blue: [...blue, 'b5'], kickoff_red: [...red, 'r5'] }],
    ['custom with no odds', { kickoff_kind: 'custom', kickoff_blue_win_prob: null }],
    ['an unknown kind', { kickoff_kind: 'guessed' }],
    ['no time', { kickoff_kind: 'rolled', kickoff_at: null }],
  ])('a row this build cannot read is null: %s', (_why, patch) => {
    const row: KickoffRow = {
      ...none,
      kickoff_kind: 'unrolled',
      kickoff_blue: blue,
      kickoff_red: red,
      kickoff_blue_win_prob: 0.5,
      kickoff_odds_model: 'kustom',
      kickoff_at: at,
      ...patch,
    };
    expect(kickoffFromRow(row)).toBeNull();
    // M21.5: the reader hears why, once, so it can log the drop.
    const drops: string[] = [];
    expect(kickoffFromRow(row, (reason) => drops.push(reason))).toBeNull();
    expect(drops).toHaveLength(1);
    expect(drops[0]?.length).toBeGreaterThan(0);
  });

  it('never reports a drop for a lobby with no record, or for a good one', () => {
    const drops: string[] = [];
    kickoffFromRow(none, (reason) => drops.push(reason));
    kickoffFromRow(
      {
        ...none,
        kickoff_kind: 'unrolled',
        kickoff_blue: blue,
        kickoff_red: red,
        kickoff_blue_win_prob: 0.5,
        kickoff_odds_model: 'kustom',
        kickoff_at: at,
      },
      (reason) => drops.push(reason),
    );
    expect(drops).toEqual([]);
  });
});
