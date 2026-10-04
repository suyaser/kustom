import { isNameless, renderWebName } from '../tonight/copy';
import type { PlayerName } from '../tonight/types';

/**
 * Two people with the same name, told apart (M14.69, flow audit; roster-wide since design review).
 * Every list of names -- the board, the Games filter, the admin Members list, Tonight's Top this
 * week, the lobby list and the team cards -- prints the same label for the same person, decided
 * over the group's whole roster (`./roster.ts`), so a lone `Ali (2)` in a quiet week still reads
 * `Ali (2)`.
 *
 * The rule, per set of people whose printed names match (case-insensitively):
 *
 * - every one of them has a Riot tag and no two tags match: each gets their tag, `Ali #EUW`;
 * - otherwise (a tag missing, or tags colliding too): by first game in the group, the first keeps
 *   the plain name and the rest get `Ali (2)`, `Ali (3)`, in the order they first played.
 *
 * A nameless row (`Someone`) is left alone: it is its own state with its own hint line.
 *
 * The label comes in two halves so a page can set the suffix muted at weight 400 (design review):
 * `base` is the printed name (already cut so the whole label fits 32 characters) and `suffix` is
 * `#EUW` or `(2)`, with no leading space. A plain-text surface (a select option) joins them with
 * {@link labelText}. Pure and client-safe.
 */

/** Same rule as `renderWebName`: a printed name is at most this many characters. */
const MAX_NAME_LENGTH = 32;

export interface NamedPlayer {
  puuid: string;
  name: PlayerName;
  /** `players.tag_line`, the part after `#` in a Riot ID. */
  tag?: string | null;
  /** ISO 8601: the player's first game in this group, `null` when unknown. */
  firstGameAt?: string | null;
}

/** A clashing person's label: the printed name and the muted part after it. */
export interface NameLabel {
  base: string;
  suffix: string;
}

/** `Ali #EUW` / `Ali (2)` as one string, for a surface with no styling (a select option). */
export function labelText(label: NameLabel): string {
  return `${label.base} ${label.suffix}`;
}

/** The plain-text name a list prints for this person: their label when they clash, else the name. */
export function printedName(name: PlayerName, label: NameLabel | null | undefined): string {
  return label == null ? renderWebName(name) : labelText(label);
}

function key(name: PlayerName): string {
  return renderWebName(name).toLocaleLowerCase('en');
}

/** The puuids whose printed name another person in `players` also prints. Nameless rows never. */
export function collidingNames(players: readonly Pick<NamedPlayer, 'puuid' | 'name'>[]): Set<string> {
  const byKey = new Map<string, string[]>();
  for (const player of players) {
    if (isNameless(player.name)) continue;
    const list = byKey.get(key(player.name)) ?? [];
    if (!list.includes(player.puuid)) list.push(player.puuid);
    byKey.set(key(player.name), list);
  }
  const out = new Set<string>();
  for (const list of byKey.values()) if (list.length > 1) for (const puuid of list) out.add(puuid);
  return out;
}

/** The name cut so `base + ' ' + suffix` stays inside 32 characters with the suffix intact. */
function labelOf(name: PlayerName, suffix: string): NameLabel {
  const base = renderWebName(name);
  if (base.length + 1 + suffix.length <= MAX_NAME_LENGTH) return { base, suffix };
  const plain = base.endsWith('…') ? base.slice(0, -1) : base;
  return { base: `${plain.slice(0, MAX_NAME_LENGTH - suffix.length - 2)}…`, suffix };
}

function cleanTag(tag: string | null | undefined): string | null {
  const trimmed = (tag ?? '').trim().replace(/^#/, '');
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * The labels of everybody in `players` whose printed name clashes with somebody else's, by puuid.
 * A person who clashes with nobody is absent: their name prints as it is. The first player of a
 * numbered set has no suffix and is absent too.
 */
export function distinctNames(players: readonly NamedPlayer[]): Map<string, NameLabel> {
  const out = new Map<string, NameLabel>();
  const colliding = collidingNames(players);
  if (colliding.size === 0) return out;

  const groups = new Map<string, NamedPlayer[]>();
  const seen = new Set<string>();
  for (const player of players) {
    if (!colliding.has(player.puuid) || seen.has(player.puuid)) continue;
    seen.add(player.puuid);
    const list = groups.get(key(player.name)) ?? [];
    list.push(player);
    groups.set(key(player.name), list);
  }

  for (const group of groups.values()) {
    const tags = group.map((player) => cleanTag(player.tag));
    const lowered = tags.map((tag) => tag?.toLocaleLowerCase('en') ?? null);
    const tagsTell = lowered.every((tag) => tag !== null) && new Set(lowered).size === lowered.length;
    if (tagsTell) {
      group.forEach((player, index) => {
        out.set(player.puuid, labelOf(player.name, `#${tags[index]}`));
      });
      continue;
    }
    const ordered = [...group].sort((a, b) => {
      const at = a.firstGameAt == null ? Number.POSITIVE_INFINITY : Date.parse(a.firstGameAt);
      const bt = b.firstGameAt == null ? Number.POSITIVE_INFINITY : Date.parse(b.firstGameAt);
      return at - bt || a.puuid.localeCompare(b.puuid);
    });
    ordered.forEach((player, index) => {
      if (index > 0) out.set(player.puuid, labelOf(player.name, `(${index + 1})`));
    });
  }
  return out;
}
