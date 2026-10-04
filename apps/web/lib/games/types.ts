import type { RoleValue, SideValue } from '@customs/db';
import type { RecentAward } from '../board/types';
import type { WindowKind } from '../night';
import type { PlayerName } from '../tonight/types';
import type { QueueKind } from './queue';

/**
 * What `/games` renders: one window of captured customs, each with both scoreboards.
 *
 * Assembled in `view.ts` from the same `games` / `game_players` read `/stats` uses, so a
 * number on this page cannot disagree with `/fun` about the same night. The page itself
 * decides nothing.
 */

export interface HistorySeat {
  puuid: string;
  name: PlayerName;
  role: RoleValue | null;
  /** `Ahri`, or `null` when the scoreboard never stored a champion. */
  champion: string | null;
  kills: number;
  deaths: number;
  assists: number;
  /** `15/5/6`. */
  kda: string;
  /** Kill participation as a whole percent, or `null` when the side scored no kills. */
  kp: number | null;
  gold: number;
  damageToChamps: number;
  cs: number;
  /** `vision_score`, or `null` on a row stored before migration `0014` (null is not zero). */
  vision: number | null;
  /** `24.3k` / `812` — the same compact form the embeds use for damage. */
  goldLabel: string;
  damageLabel: string;
  csLabel: string;
  /** 0–100, share of the lobby's highest damage. The bar reads this and nothing else. */
  damageShare: number;
  /**
   * `mvp` / `ace` when this seat is the one `gatedGameAward` named (M7.23), `null` for the other
   * eight and for every seat of a game with no award — a remake, a nine-player custom, an unrated
   * game, a game missing a stat column or a role. Always `null` on `/fun`'s one-game records:
   * only `/games` asks for it.
   */
  award: RecentAward | null;
}

export interface HistoryTeam {
  side: SideValue;
  label: string;
  kills: number;
  gold: number;
  goldLabel: string;
  won: boolean;
  seats: HistorySeat[];
}

export interface HistoryGame {
  id: string;
  startedAt: string;
  startedLabel: string;
  durationLabel: string;
  winningSide: SideValue;
  /** `Blue won` / `Red won`, or `Won` / `Lost` when the page is focused on one player. */
  result: string;
  /** `39–25`. */
  score: string;
  /** The focused player's side, when `?p=` is set; the winning side otherwise. */
  ruleSide: SideValue;
  blue: HistoryTeam;
  red: HistoryTeam;
  /**
   * The focused player's own row, and only then. The collapsed card prints their KDA
   * the way a match-history site prints the summoner you searched.
   */
  focus: HistorySeat | null;
  /** `15/5/6 · 84% KP · 28 CS`, or `null` on the group list. */
  focusMeta: string | null;
  /** The five on the focused player's side, lane order. Empty on the group list. */
  teammates: HistorySeat[];
}

export interface GamesHistoryView {
  window: WindowKind;
  /** Which map the list is filtered to. The toggle and `?queue=` are this word. */
  queue: QueueKind;
  /**
   * The slot's range half, or `null` when this list is empty — the same empty-window rule
   * `/stats` uses, so a quiet week is one sentence in the header and nothing under it.
   */
  range: string | null;
  /** Games on the list, newest first. The slot's count. */
  games: number;
  capped: boolean;
  cap: number;
  /** Set when the page is reading one person's customs (`?p=`). */
  focusPuuid: string | null;
  focusName: PlayerName | null;
  items: HistoryGame[];
}
