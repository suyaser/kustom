import Link from 'next/link';
import {
  gamesLabel,
  ROLE_RECORD_HEADING,
  WINDOW_LABELS,
  windowSlotLine,
  winLossLabel,
} from '@/lib/board/copy';
import { formatStreak } from '@/lib/board/streak';
import {
  AWARDS_HEADING,
  averageGameLine,
  BEST_TOGETHER,
  blueWinLine,
  capLine,
  DUOS_HEADING,
  LONGEST_LOSS,
  LONGEST_WIN,
  NO_DUOS,
  NOBODY_ON_A_STREAK,
  noRoleEntries,
  noRoleFootnote,
  ON_A_STREAK,
  pairLabel,
  percentLabel,
  playersLine,
  STATS_LABEL,
  STREAKS_HEADING,
  WORST_TOGETHER,
} from '@/lib/stats/copy';
import type {
  AwardBlock,
  DuoRecord,
  PlayerRef,
  PlayerStreaks,
  RoleBlock,
  StatsRecord,
  StatsView as StatsViewModel,
  StreakHolders,
} from '@/lib/stats/types';
import { renderWebName } from '@/lib/tonight/copy';
import '../board-parts.css';
import { WindowPicker } from '../_board/WindowPicker';
import { WindowSlot } from '../_board/WindowSlot';
import { RoleIcon } from '../_icons/RoleIcon';

/**
 * `/stats` (M5.4): the window's numbers, its three awards, and nothing to press.
 *
 * A pure function of one snapshot, so every edge case in the brief is a component test rather
 * than a month of waiting: a window with no games, a window with two, a month of pure backfill
 * with no role in it, a quiet week where every minimum bites.
 *
 * **The layout is plain and is meant to be** (M5.4's acceptance 11): the numbers are product's
 * and are pinned, the dress is the designer's and lands with **M5.8**. Everything here reuses a
 * class the board pages already own — the strip, the card, the `raise` header bar, the record
 * row — and invents no token.
 *
 * The order down the page is product's, and it is not the order of a dashboard: the window,
 * then who won something, then the two group numbers, then the five roles, the duos and the
 * streaks. Nothing on this page is per-night and nothing on it can be filtered.
 */

export interface StatsViewProps {
  stats: StatsViewModel;
}

export function StatsView({ stats }: StatsViewProps) {
  /**
   * **A window with nothing in it** is a header and one sentence (M5.12's slot rule, M3.5's
   * "no empty page and no spinner"): the range is `null` exactly when no counted game falls
   * inside, and no section below the strip is drawn at all — a page of five empty blocks reads
   * as broken where one sentence reads as a quiet week.
   */
  const empty = stats.range === null;

  /**
   * **A running window's awards are one line, and it lives in the header** (the designer,
   * 2026-09-10): `Awards are handed out when the month ends.` under the slot, as a hint. A card
   * with a header bar and one grey sentence in it is a card promising something it has not got,
   * and on `This month` — the page's own default — it was the first thing under the picker.
   *
   * `All time` has no awards at all, so it has no line either.
   */
  const pending = stats.awards?.kind === 'running' ? stats.awards.line : null;

  return (
    <main className="cn-page">
      <header className="cn-strip">
        <h1 className="cn-strip-title">
          {WINDOW_LABELS[stats.window]} <span className="cn-strip-sub">{STATS_LABEL}</span>
        </h1>
        {/* The same control, in the same slot, as the two board pages. `This month` by default. */}
        <WindowPicker path="/stats" selected={stats.window} />

        {/*
         * **The same slot, in the same element, as the two board pages** (the designer,
         * 2026-09-11, M5.23). This page used to print the window's empty sentence in the body at
         * `t-base` in `text`, under a strip with its hairline taken off — M5.8's rule 6, written
         * when this was the only page whose whole subject is the window. Three pages carrying
         * one picker may not answer the same tap three ways, so the sentence moved into the slot
         * the picker already has and the hairline stays: on every window with games the same
         * strip closes over cards, and a rule that comes and goes with the answer is a header
         * that looks like it failed rather than one that is empty.
         */}
        <WindowSlot
          window={stats.window}
          line={empty ? null : windowSlotLine(stats.range as string, stats.games)}
        />

        {pending === null ? null : <p className="cn-hint">{pending}</p>}

        {/* Nothing drops silently: over the cap the page says which games it is showing. */}
        {stats.capped ? <p className="cn-hint">{capLine(stats.cap)}</p> : null}
      </header>

      {empty ? null : (
        <>
          <Awards awards={stats.awards} />

          {/*
           * The window's three facts, in one card (the designer, 2026-09-10): they are one
           * subject — what the whole group did — and three bare sentences between two cards read
           * as a gap rather than as a block. No header bar: they name themselves.
           *
           * **Three parallel stopped sentences, and the count is in none of them** (product,
           * 2026-09-11, M5.22): all three numbers on this band are one `countedGames` length, so
           * `· 32 games` beside two of them was the slot above retyped twice. The slot keeps it,
           * byte for byte, because M5.10's Sunday post is that same string.
           */}
          <section className="cn-block">
            <section className="cn-card cn-stats-lines">
              {stats.blueWinRate === null ? null : (
                <p className="cn-stats-line">{blueWinLine(stats.blueWinRate)}</p>
              )}
              {stats.averageMinutes === null ? null : (
                <p className="cn-stats-line">{averageGameLine(stats.averageMinutes)}</p>
              )}
              <p className="cn-stats-line">{playersLine(stats.players)}</p>
            </section>
          </section>

          <Roles roles={stats.roles} noRoleGames={stats.noRoleGames} />
          <Duos best={stats.bestDuos} worst={stats.worstDuos} />
          <Streaks
            longestWin={stats.longestWin}
            longestLoss={stats.longestLoss}
            onAStreak={stats.onAStreak}
          />
        </>
      )}
    </main>
  );
}

/**
 * The awards block: three statements on a closed window, one line on a running one, and
 * nothing at all on `All time`.
 *
 * Every string here — the rule, the winner, the sentence nobody qualifying prints — is
 * `lib/stats/awards.ts`'s, and the **same strings go into the Sunday Discord post**. The page
 * adds the heading and the layout and not one word.
 */
function Awards({ awards }: { awards: StatsViewModel['awards'] }) {
  /**
   * **Only a closed window draws a card here** (the designer, 2026-09-10). `All time` has no
   * awards at all, and a running window's one line is a hint in the header strip — printed by
   * the page above, not by a card with a header bar and nothing under it.
   */
  if (awards === null || awards.kind === 'running') return null;

  /**
   * **The `brand` edge is the team card's, and it means the same thing**: something was won
   * here. It goes on only when at least one of the three has a winner, so a month where nobody
   * cleared a minimum is three sentences in a plain card and not a lit one.
   */
  const won = awards.blocks.some((block) => block.won);

  return (
    <section className="cn-block">
      <section className={won ? 'cn-card cn-list-card cn-awards-won' : 'cn-card cn-list-card'}>
        <header className="cn-card-head cn-list-head">
          <h2 className="cn-board-title">{AWARDS_HEADING}</h2>
        </header>
        <div className="cn-awards">
          <p className="cn-stats-intro">{awards.intro}</p>
          {awards.blocks.map((block) => (
            <Award key={block.label} block={block} />
          ))}
        </div>
      </section>
    </section>
  );
}

/**
 * One award: who won it, in the size the page reads first, with the label above and the rule
 * under it (the designer, 2026-09-10).
 *
 * The order is deliberate — **the winner outranks the label and the rule outranks nothing**: a
 * reader arrives for the name, and the bar it was won over is what they check second.
 */
function Award({ block }: { block: AwardBlock }) {
  return (
    <div className="cn-award">
      <p className="cn-award-label">{block.label}</p>
      {block.lines.map((line) => (
        <p key={line.key} className={block.won ? 'cn-award-line' : 'cn-award-line cn-award-none'}>
          {line.text}
        </p>
      ))}
      <p className="cn-award-rule">{block.rule}</p>
      {block.note === null ? null : <p className="cn-award-rule">{block.note}</p>}
    </div>
  );
}

/**
 * Five blocks, one per role, each a ranked list of the players with five rows or more at it —
 * and never a group-wide role win rate, which is 50% by construction and would be the one
 * number on this page that means nothing.
 */
function Roles({ roles, noRoleGames }: { roles: RoleBlock[]; noRoleGames: number }) {
  return (
    <section className="cn-block">
      <section className="cn-card cn-list-card">
        <header className="cn-card-head cn-list-head">
          <h2 className="cn-board-title">{ROLE_RECORD_HEADING}</h2>
        </header>
        {roles.map((block) => (
          <div key={block.role} className="cn-role-block">
            <p className="cn-num cn-lineup-role">
              <RoleIcon role={block.role} size={16} />
              {block.role}
            </p>
            {block.entries.length === 0 ? (
              <p className="cn-stats-empty">{noRoleEntries(block.role)}</p>
            ) : (
              <ol className="cn-records">
                {block.entries.map((entry, index) => (
                  <li key={entry.puuid} className="cn-record cn-stats-record">
                    <span className="cn-num cn-stats-rank">{index + 1}</span>
                    <PlayerName player={entry} />
                    <Record record={entry} />
                  </li>
                ))}
              </ol>
            )}
          </div>
        ))}
      </section>
      {/*
       * Only above zero, and only ever once: a month of backfilled games has no role numbers at
       * all and this sentence is the whole of the section's answer.
       */}
      {noRoleGames === 0 ? null : <p className="cn-hint">{noRoleFootnote(noRoleGames)}</p>}
    </section>
  );
}

/** `Best together` and `Worst together`, five each — the full pair table is not a page. */
function Duos({ best, worst }: { best: DuoRecord[]; worst: DuoRecord[] }) {
  return (
    <section className="cn-block">
      <section className="cn-card cn-list-card">
        <header className="cn-card-head cn-list-head">
          <h2 className="cn-board-title">{DUOS_HEADING}</h2>
        </header>
        <DuoList title={BEST_TOGETHER} pairs={best} />
        <DuoList title={WORST_TOGETHER} pairs={worst} />
      </section>
    </section>
  );
}

function DuoList({ title, pairs }: { title: string; pairs: DuoRecord[] }) {
  return (
    <div className="cn-role-block">
      <p className="cn-stats-subtitle">{title}</p>
      {pairs.length === 0 ? (
        <p className="cn-stats-empty">{NO_DUOS}</p>
      ) : (
        <ul className="cn-records">
          {pairs.map((pair) => (
            <li key={`${pair.players[0].puuid}|${pair.players[1].puuid}`} className="cn-record cn-stats-duo">
              <span className="cn-stats-pair">
                {pairLabel(renderWebName(pair.players[0].name), renderWebName(pair.players[1].name))}
              </span>
              <span className="cn-num cn-record-wl">
                {winLossLabel(pair.wins, pair.losses)} · {percentLabel(pair.winRate)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Three blocks of the same shape (the designer, 2026-09-10): the two the window holds, then
 * anyone on a streak right now. Each is a group label over 44px rows — name left, `W10` right in
 * mono — so a record two people share is two rows and not a list inside a sentence.
 *
 * `W3` and `L2` are the leaderboard row's own form, from the same helper.
 */
function Streaks({
  longestWin,
  longestLoss,
  onAStreak,
}: {
  longestWin: StreakHolders | null;
  longestLoss: StreakHolders | null;
  onAStreak: PlayerStreaks[];
}) {
  return (
    <section className="cn-block">
      <section className="cn-card cn-list-card">
        <header className="cn-card-head cn-list-head">
          <h2 className="cn-board-title">{STREAKS_HEADING}</h2>
        </header>

        <Longest title={LONGEST_WIN} kind="W" holders={longestWin} />
        <Longest title={LONGEST_LOSS} kind="L" holders={longestLoss} />

        <div className="cn-role-block">
          <p className="cn-stats-subtitle">{ON_A_STREAK}</p>
          {onAStreak.length === 0 ? (
            <p className="cn-stats-empty">{NOBODY_ON_A_STREAK}</p>
          ) : (
            <ul className="cn-records">
              {onAStreak.map((streak) => (
                <li key={streak.puuid} className="cn-record cn-stats-duo">
                  <PlayerName player={streak} />
                  <span className="cn-num cn-record-wl">
                    {formatStreak(streak.current as { kind: 'W' | 'L'; length: number })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </section>
  );
}

function Longest({
  title,
  kind,
  holders,
}: {
  title: string;
  kind: 'W' | 'L';
  holders: StreakHolders | null;
}) {
  // Nothing to name: a window with no counted game draws no section at all, so this is only
  // ever null on a kind nobody managed — which cannot happen while a game has a winner.
  if (holders === null) return null;

  return (
    <div className="cn-role-block">
      <p className="cn-stats-subtitle">{title}</p>
      <ul className="cn-records">
        {holders.holders.map((ref) => (
          <li key={ref.puuid} className="cn-record cn-stats-duo">
            <PlayerName player={ref} />
            <span className="cn-num cn-record-wl">{formatStreak({ kind, length: holders.length })}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A name on this page is a link to that person's own page, exactly as it is on the board: these
 * lists are where an argument starts and `/p/<puuid>` is where it is settled.
 */
function PlayerName({ player }: { player: PlayerRef | StatsRecord }) {
  return (
    <Link className="cn-stats-name" href={`/p/${player.puuid}`}>
      {renderWebName(player.name)}
    </Link>
  );
}

function Record({ record }: { record: StatsRecord }) {
  return (
    <span className="cn-num cn-record-wl">
      {winLossLabel(record.wins, record.losses)}
      {record.winRate === null ? null : ` · ${percentLabel(record.winRate)}`}
      <span className="cn-sr"> over {gamesLabel(record.games)}</span>
    </span>
  );
}
