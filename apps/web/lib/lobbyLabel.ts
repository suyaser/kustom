/**
 * **The lobby label** (05-design.md 14.1, the 2026-10-05 "M22.2 rulings" row): the only name a lobby
 * ever has while two or more are live. Pure, and free of any renderer, so Discord (M22.7, through
 * `renderName`, escaped) and Tonight (M22.6, through its own web renderer) print the same label.
 *
 * - `‹host›'s lobby`: the host is the table's first reporter tonight (`liveTables`' label input),
 *   game name only, straight apostrophe, also after an s, the name's own case.
 * - Two live tables with the same host name: the older keeps `Ana's lobby`, the newer is
 *   `Ana's lobby 2` (`3`, ...), numbered by when the table opened tonight.
 * - No host name known: `Lobby ‹n›`, n by when the table opened tonight (a fallback only).
 */

/** A label, before a surface renders the host's name. */
export type LobbyLabel =
  /** `Ana's lobby`; `repeat` 2 or more prints `Ana's lobby 2`. */
  | { kind: 'host'; name: string; repeat: number }
  /** `Lobby 2`. */
  | { kind: 'numbered'; n: number };

/** What {@link lobbyLabels} reads of a live table. */
export interface LabelInput {
  /** Any stable key for the table (its party id). */
  key: string;
  /** The host's display name, or `null` when there is no host or no name. */
  hostName: string | null;
  /** ISO 8601: the table's first row tonight. */
  openedAt: string;
}

/**
 * Every live table's label, by key. Same-name tables are told apart by `render(name)`, the name as
 * the surface prints it, so two names that print alike are numbered.
 */
export function lobbyLabels(
  tables: readonly LabelInput[],
  render: (name: string) => string,
): Map<string, LobbyLabel> {
  const ordered = [...tables].sort(
    (a, b) => Date.parse(a.openedAt) - Date.parse(b.openedAt) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
  const seen = new Map<string, number>();
  const labels = new Map<string, LobbyLabel>();
  ordered.forEach((table, index) => {
    const name = table.hostName?.trim() ?? '';
    if (name.length === 0) {
      labels.set(table.key, { kind: 'numbered', n: index + 1 });
      return;
    }
    const printed = render(name);
    const repeat = (seen.get(printed) ?? 0) + 1;
    seen.set(printed, repeat);
    labels.set(table.key, { kind: 'host', name, repeat });
  });
  return labels;
}

/** The label as text: `render` prints the host's name (escaped, on Discord). */
export function formatLobbyLabel(label: LobbyLabel, render: (name: string) => string): string {
  if (label.kind === 'numbered') return `Lobby ${label.n}`;
  const head = `${render(label.name)}'s lobby`;
  return label.repeat > 1 ? `${head} ${label.repeat}` : head;
}
