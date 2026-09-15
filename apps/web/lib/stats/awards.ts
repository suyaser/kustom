import { displayRating } from '@customs/core';
import type { RoleValue } from '@customs/db';
import type { WindowKind } from '../night';
import { formatWebDelta } from '../ratingDisplay';
import { renderWebName } from '../tonight/copy';
import type { PlayerName } from '../tonight/types';
import {
  AWARD_MINIMUMS,
  type AwardPeriod,
  awardsIntro,
  awardsPending,
  BEST_OFF_ROLE,
  bestOffRoleLine,
  bestOffRoleNobody,
  bestOffRoleRule,
  CURSED_DUO,
  cursedDuoLine,
  cursedDuoNobody,
  cursedDuoRule,
  MOST_IMPROVED,
  mostImprovedLine,
  mostImprovedNobody,
  mostImprovedRule,
  NO_MAIN_ROLE_NOTE,
  pairLabel,
} from './copy';
import { compareDuosWorst, compareRecords, duoRecords, winRate } from './fold';
import type {
  AwardBlock,
  AwardLine,
  AwardsView,
  PlayerRef,
  StatsGame,
  StatsPlayer,
  StatsRecord,
} from './types';

/**
 * The three awards a closed window hands out (M5.4): most improved, best off-role, cursed duo.
 *
 * **They are computed at request time and never stored.** A late backfill or a rebuild then
 * corrects an award instead of freezing a wrong one in a table forever — which is also what
 * makes the Sunday Discord post and the page it links to agree a week later.
 *
 * **They appear only on a window that has closed.** `Last week` and `Last month` have them;
 * `This week` and `This month` print one line instead, because an award that changes every
 * night is a statistic, not an award; `All time` has no block at all, because a window that
 * never closes has no last night to read them on.
 *
 * Every line here is rendered once, in this file, and handed to **both** surfaces: the page
 * renders them and `lib/discord/post.ts` puts the same strings in the post's `Awards` field.
 */

/**
 * The two things a surface formats differently: a name (Discord escapes markdown) and a delta
 * (`−212` on the web, `-212` in a message that gets copy-pasted).
 *
 * Everything else about an award line is identical on both, which is the point — the group
 * reads the line in the channel and then opens the page to argue with it.
 */
export interface AwardRender {
  name(name: PlayerName): string;
  delta(delta: number): string;
}

/** The web's: `05-design.md`'s truncation and its U+2212 minus. */
export const WEB_AWARD_RENDER: AwardRender = { name: renderWebName, delta: formatWebDelta };

/**
 * Which calendar a window's awards are about, and whether it has closed.
 *
 * `null` is `All time`, which has none: "most improved of all time" is a different question
 * from the one these three ask.
 */
export function awardPeriod(kind: WindowKind): { period: AwardPeriod; closed: boolean } | null {
  switch (kind) {
    case 'this-week':
      return { period: 'week', closed: false };
    case 'last-week':
      return { period: 'week', closed: true };
    case 'this-month':
      return { period: 'month', closed: false };
    case 'last-month':
      return { period: 'month', closed: true };
    default:
      return null;
  }
}

/**
 * The awards section for one window: three awards, one line, or nothing at all.
 *
 * The games are already the window's counted games (`countedGames`), so this adds no filter of
 * its own — the awards and the numbers above them are read from one list.
 */
export function awardsView(
  kind: WindowKind,
  games: readonly StatsGame[],
  players: readonly StatsPlayer[],
  render: AwardRender = WEB_AWARD_RENDER,
): AwardsView | null {
  const window = awardPeriod(kind);
  if (window === null) return null;
  if (!window.closed) return { kind: 'running', line: awardsPending(window.period) };

  return {
    kind: 'closed',
    intro: awardsIntro(window.period),
    blocks: awardBlocks(games, players, window.period, render),
  };
}

/** The three, in product's order. Always three, whether or not anybody qualified. */
export function awardBlocks(
  games: readonly StatsGame[],
  players: readonly StatsPlayer[],
  period: AwardPeriod,
  render: AwardRender = WEB_AWARD_RENDER,
): AwardBlock[] {
  return [
    mostImproved(games, players, period, render),
    bestOffRole(games, players, period, render),
    cursedDuo(games, players, period, render),
  ];
}

/* ---------------------------------------------------------------------------
 * Most improved.
 * ------------------------------------------------------------------------- */

/** What a player did to their Rating across the window, in the numbers the pages printed. */
export interface Climb extends PlayerRef {
  games: number;
  from: number;
  to: number;
  delta: number;
}

/**
 * The biggest climb in Rating: `displayRating` of their **last** counted game's `mu_after`
 * minus `displayRating` of their **first** counted game's `mu_before`.
 *
 * Both numbers come from `game_players`, so it is the subtraction of two numbers the pages
 * actually printed — the delta rule in `00-product.md`, and the same one `displayDelta` keeps
 * for a single game.
 *
 * **A window can hold counted games that carry no rating**: a backfilled game the rebuild has
 * not folded yet counts everywhere else on this page but has no `mu` at either end. The
 * minimum counts counted games, as product wrote it, and the climb is measured between the
 * first and last games that do carry a rating — a player with none has no climb and cannot win.
 */
export function climbs(games: readonly StatsGame[], players: readonly StatsPlayer[]): Climb[] {
  const roster = new Map(players.map((player) => [player.playerId, player]));
  const walked = new Map<string, { games: number; from: number | null; to: number | null }>();

  // `games` is oldest first, so the first `mu_before` seen is the window's first and the last
  // `mu_after` seen is its last.
  for (const game of games) {
    for (const row of game.rows) {
      const entry = walked.get(row.playerId) ?? { games: 0, from: null, to: null };
      entry.games += 1;
      if (entry.from === null && row.muBefore !== null) entry.from = displayRating(row.muBefore);
      if (row.muAfter !== null) entry.to = displayRating(row.muAfter);
      walked.set(row.playerId, entry);
    }
  }

  const climbed: Climb[] = [];
  for (const [playerId, entry] of walked) {
    const player = roster.get(playerId);
    if (player === undefined || entry.from === null || entry.to === null) continue;
    climbed.push({
      puuid: player.puuid,
      name: player.name,
      games: entry.games,
      from: entry.from,
      to: entry.to,
      delta: entry.to - entry.from,
    });
  }
  return climbed;
}

function mostImproved(
  games: readonly StatsGame[],
  players: readonly StatsPlayer[],
  period: AwardPeriod,
  render: AwardRender,
): AwardBlock {
  const minimum = AWARD_MINIMUMS[period].mostImproved;
  const eligible = climbs(games, players).filter((climb) => climb.games >= minimum);
  const rule = mostImprovedRule(minimum);

  if (eligible.length === 0) {
    return block(MOST_IMPROVED, rule, [nobody(mostImprovedNobody(minimum, period))], false);
  }

  // Ties: more games wins; still tied, **both are named**. Nothing after that separates them,
  // so two people who climbed the same amount over the same number of games both get the award.
  const best = [...eligible].sort((a, b) => b.delta - a.delta || b.games - a.games)[0] as Climb;
  const winners = eligible
    .filter((climb) => climb.delta === best.delta && climb.games === best.games)
    .sort((a, b) => renderWebName(a.name).localeCompare(renderWebName(b.name)));

  return block(
    MOST_IMPROVED,
    rule,
    winners.map((climb) => ({
      key: climb.puuid,
      text: mostImprovedLine(render.name(climb.name), render.delta(climb.delta), climb.from, climb.to),
    })),
    true,
  );
}

/* ---------------------------------------------------------------------------
 * Best off-role.
 * ------------------------------------------------------------------------- */

/** One player's record in the games they played away from their main. */
export interface OffRoleRecord extends StatsRecord {
  mainRole: RoleValue;
}

/**
 * Every player's off-role record: the counted rows where the role they played was **not** their
 * `players.main_role`.
 *
 * Secondary counts as off-role, exactly as the balancer counts it (`offRolePenalty` applies to
 * anyone not on a main role), and both the role and the main have to be known — a flexible
 * player has no off-role, because every role is theirs.
 */
export function offRoleRecords(
  games: readonly StatsGame[],
  players: readonly StatsPlayer[],
  minimum: number,
): OffRoleRecord[] {
  const roster = new Map(players.map((player) => [player.playerId, player]));
  const tallies = new Map<string, { games: number; wins: number }>();

  for (const game of games) {
    for (const row of game.rows) {
      const player = roster.get(row.playerId);
      if (player === undefined || row.role === null || player.mainRole === null) continue;
      if (row.role === player.mainRole) continue;
      const tally = tallies.get(row.playerId) ?? { games: 0, wins: 0 };
      tally.games += 1;
      if (row.side === game.winningSide) tally.wins += 1;
      tallies.set(row.playerId, tally);
    }
  }

  const records: OffRoleRecord[] = [];
  for (const [playerId, tally] of tallies) {
    const player = roster.get(playerId);
    if (player === undefined || player.mainRole === null || tally.games < minimum) continue;
    records.push({
      puuid: player.puuid,
      name: player.name,
      games: tally.games,
      wins: tally.wins,
      losses: tally.games - tally.wins,
      // Past the award's minimum a rate always prints: the bar is already above the browsing
      // minimum the rest of the page uses.
      winRate: winRate(tally.wins, tally.games, 1) as number,
      mainRole: player.mainRole,
    });
  }
  return records.sort(compareRecords);
}

function bestOffRole(
  games: readonly StatsGame[],
  players: readonly StatsPlayer[],
  period: AwardPeriod,
  render: AwardRender,
): AwardBlock {
  const minimum = AWARD_MINIMUMS[period].bestOffRole;
  const rule = bestOffRoleRule(minimum);
  const winner = offRoleRecords(games, players, minimum)[0];

  /**
   * The note is about **the window's players**, not about the database: a month in which
   * everybody's roles are known says nothing, and one where somebody is flexible explains why
   * they cannot be in this award. Since M5.17 a null main is the inference's `flexible`.
   */
  const played = new Set<string>();
  for (const game of games) for (const row of game.rows) played.add(row.playerId);
  const anyFlexible = players.some((player) => played.has(player.playerId) && player.mainRole === null);
  const note = anyFlexible ? NO_MAIN_ROLE_NOTE : null;

  if (winner === undefined) {
    return block(BEST_OFF_ROLE, rule, [nobody(bestOffRoleNobody(minimum))], false, note);
  }

  return block(
    BEST_OFF_ROLE,
    rule,
    [
      {
        key: winner.puuid,
        text: bestOffRoleLine(
          render.name(winner.name),
          winner.wins,
          winner.losses,
          winner.winRate as number,
          winner.mainRole,
        ),
      },
    ],
    true,
    note,
  );
}

/* ---------------------------------------------------------------------------
 * Cursed duo.
 * ------------------------------------------------------------------------- */

function cursedDuo(
  games: readonly StatsGame[],
  players: readonly StatsPlayer[],
  period: AwardPeriod,
  render: AwardRender,
): AwardBlock {
  const minimum = AWARD_MINIMUMS[period].cursedDuo;
  const rule = cursedDuoRule(minimum);
  // The award's own bar, above the browsing table's five: the list is for looking, an award
  // needs a little more before it crowns anybody.
  const pairs = duoRecords(games, players, minimum).sort(compareDuosWorst);
  const worst = pairs[0];

  if (worst === undefined) {
    return block(CURSED_DUO, rule, [nobody(cursedDuoNobody(minimum, period))], false);
  }

  // Ties: more games together; still tied, **both pairs are named**.
  const tied = pairs.filter((pair) => pair.winRate === worst.winRate && pair.games === worst.games);

  return block(
    CURSED_DUO,
    rule,
    tied.map((pair) => ({
      key: `${pair.players[0].puuid}|${pair.players[1].puuid}`,
      text: cursedDuoLine(
        pairLabel(render.name(pair.players[0].name), render.name(pair.players[1].name)),
        pair.wins,
        pair.losses,
        pair.winRate,
      ),
    })),
    true,
  );
}

/**
 * The sentence an award nobody won prints. **One key, and it is not the sentence**: the line is
 * about nobody, so it is keyed on that rather than on words that change with the minimum.
 */
function nobody(text: string): AwardLine {
  return { key: 'nobody', text };
}

function block(
  label: string,
  rule: string,
  lines: AwardLine[],
  won: boolean,
  note: string | null = null,
): AwardBlock {
  return { label, rule, lines, won, note };
}
