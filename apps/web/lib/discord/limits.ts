import type { Embed, EmbedField } from './embeds';

/**
 * Discord's length limits, in one place, applied where the embeds are built (M4.12).
 *
 * Discord does not truncate. A field value of 1025 characters is a 400 on the **whole** webhook,
 * so one long line loses the post — the teams, the result, the board — not just itself. Every
 * value in `embeds.ts` is a join of lines that each carry a name we do not control, and
 * `renderName` escaping markdown can double a 32-character name to 64: ten `Swap:` lines of
 * escapable names is a `Seats` value of ~1500 characters (reviewer, 2026-09-11). So the guard
 * lives here and every builder emits through it.
 *
 * Three rules, and they are the whole file:
 *
 * 1. **Below the limit it is the identity.** `fieldValue` joins and returns; it does not
 *    normalise, re-escape or re-order. Every existing snapshot is byte-identical, which is how
 *    you can tell the guard is off the normal path.
 * 2. **Cuts land on line boundaries.** A field is a list of lines and a cut drops whole lines,
 *    so a name is never sliced in half and a backslash is never separated from the character it
 *    escapes. One `…` line marks where lines went, at the first gap.
 * 3. **The line that matters survives.** Each line carries a `keep` rank and the lowest rank
 *    goes first, the lowest line of a rank before the ones above it. The side line of `Seats`
 *    outranks the move lines, an award's first line outranks the tie's extra names, and a board
 *    is all one rank so it loses its bottom rows.
 *
 * Only when a single line is itself over the limit does {@link cutText} cut inside it — and even
 * then it refuses to end on a half-written escape or half a surrogate pair.
 */

/** The one this task is about: an embed field's `value`. */
export const FIELD_VALUE_LIMIT = 1024;
/** An embed field's `name`. */
export const FIELD_NAME_LIMIT = 256;
/** The embed's `title`. */
export const TITLE_LIMIT = 256;
/** The embed's `description` — the explanation, verbatim, and the window's date range. */
export const DESCRIPTION_LIMIT = 4096;
/** `footer.text`. */
export const FOOTER_LIMIT = 2048;
/** `author.name`. */
export const AUTHOR_LIMIT = 256;
/**
 * Title + description + every field name and value + the footer + the author name, summed over
 * **every embed in the message** (M14.61, 05-design 10.12): Discord's limit is per message.
 */
export const TOTAL_LIMIT = 6000;
/** Embeds in one message. */
export const EMBEDS_LIMIT = 10;

/** The mark a cut leaves: its own line between lines, and the last character inside one. */
export const ELLIPSIS = '…';

/**
 * A line of a field value, with how hard it fights to stay.
 *
 * `keep` defaults to 0, which is what a plain string means, so a field whose lines are all
 * equal is written as an array of strings and loses its last lines first.
 */
export interface KeptLine {
  text: string;
  /** Higher survives longer. {@link KEEP_LAST_STANDING} is the highest rank in use. */
  keep?: number;
}

export type FieldLine = string | KeptLine;

/**
 * The rank of a line that has to be in the post for the post to do its job: the side line of
 * `Seats`, the winner's first line of an award. Nothing outranks it, so it is the survivor.
 */
export const KEEP_LAST_STANDING = 1;

interface RankedLine {
  text: string;
  keep: number;
}

/**
 * The field value: the lines joined, cut to `limit` on line boundaries if they do not fit.
 *
 * Identity below the limit. Above it, lines are dropped one at a time — lowest `keep` first,
 * and within a rank the **lowest line** first, so a field keeps its top and its keepers — until
 * the rendered value fits. One `…` line stands where the first dropped line was; further gaps
 * are not marked twice, because a value full of ellipses says less than the lines it replaced.
 */
export function fieldValue(lines: readonly FieldLine[], limit: number = FIELD_VALUE_LIMIT): string {
  const ranked: RankedLine[] = lines.map((line) =>
    typeof line === 'string' ? { text: line, keep: 0 } : { text: line.text, keep: line.keep ?? 0 },
  );

  const whole = ranked.map((line) => line.text).join('\n');
  if (whole.length <= limit) return whole;

  const order = ranked
    .map((line, index) => ({ keep: line.keep, index }))
    .sort((a, b) => a.keep - b.keep || b.index - a.index)
    .map((entry) => entry.index);

  const dropped = new Set<number>();
  for (const index of order) {
    // Never drop the last line standing: a field with an empty value is as rejected as a field
    // with an over-long one. The survivor is the highest-ranked, lowest-indexed line.
    if (dropped.size >= ranked.length - 1) break;
    dropped.add(index);
    const rendered = render(ranked, dropped);
    if (rendered.length <= limit) return rendered;
  }

  return cutText(render(ranked, dropped), limit);
}

/** The surviving lines in their original order, with one `…` where the first gap is. */
function render(lines: readonly RankedLine[], dropped: ReadonlySet<number>): string {
  const out: string[] = [];
  let marked = false;
  for (const [index, line] of lines.entries()) {
    if (dropped.has(index)) {
      if (!marked) {
        out.push(ELLIPSIS);
        marked = true;
      }
      continue;
    }
    out.push(line.text);
  }
  return out.join('\n');
}

/**
 * A hard character cut, for the things that are one string and not a list of lines: the title,
 * the description, the footer — and the single line that is over the limit all by itself.
 *
 * The last character is `…` and the cut never lands **inside a markdown escape**: a run of
 * backslashes before the cut has to be even, or the backslash that is left behind escapes the
 * `…` and eats it. Nor inside a surrogate pair, which would leave a lone half-character that
 * renders as a replacement box.
 */
export function cutText(value: string, limit: number): string {
  if (value.length <= limit) return value;
  if (limit <= 0) return '';

  let end = limit - 1;
  while (
    end > 0 &&
    (isHighSurrogate(value.charCodeAt(end - 1)) || trailingBackslashes(value, end) % 2 === 1)
  ) {
    end -= 1;
  }
  return end <= 0 ? ELLIPSIS : `${value.slice(0, end)}${ELLIPSIS}`;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/** How many backslashes run backwards from `end`. An odd count means the last one escapes. */
function trailingBackslashes(value: string, end: number): number {
  let count = 0;
  while (end - count > 0 && value.charAt(end - count - 1) === '\\') count += 1;
  return count;
}

/* ---------------------------------------------------------------------------
 * The message guard (M14.61, 05-design 10.12). `guardEmbed` became `guardMessage`: since posts
 * 2.0 a post is a stack of up to four embeds, and Discord's 6,000 characters are counted across
 * all of them. The three rules above still hold: identity below the limit, cuts on line
 * boundaries, and the line that matters survives.
 * ------------------------------------------------------------------------- */

/**
 * A line as a builder hands it over.
 *
 * - `keep` is the per-field rank {@link fieldValue} uses for the 1,024-character value limit.
 * - `shed` is the line's place in the **message's** give-way order (05-design 10.12): when the
 *   whole message is over 6,000, the lowest `shed` goes first, and within a rank the lowest line
 *   in the message first. No `shed` means the message guard never takes the line (the title, the
 *   odds, the bar, the side line, the seat lines); only the last-resort cut below can.
 */
export interface DraftLine {
  text: string;
  keep?: number;
  shed?: number;
}

/**
 * A description or a field value: a ready string (split on newlines, both ends kept, never shed)
 * or the builder's lines.
 */
export type DraftText = string | readonly (string | DraftLine)[];

export interface DraftField {
  name: string;
  value: DraftText;
  inline?: boolean;
}

/** An embed before the guard. `shed` on the embed drops it **whole** at that rank (an AI block). */
export interface DraftEmbed extends Omit<Embed, 'description' | 'fields'> {
  description?: DraftText;
  fields?: readonly DraftField[];
  shed?: number;
}

interface Line {
  text: string;
  keep: number;
  shed: number | undefined;
}

interface Block {
  /** `null` is the description; a string is a field's name. */
  name: string | null;
  inline: boolean | undefined;
  lines: Line[];
}

interface Draft {
  base: Omit<DraftEmbed, 'description' | 'fields' | 'shed'>;
  shed: number | undefined;
  description: Block | null;
  fields: Block[];
}

function toLines(text: DraftText): Line[] {
  if (typeof text === 'string') {
    const split = text.split('\n');
    return split.map((line, index) => ({
      text: line,
      keep: index === 0 || index === split.length - 1 ? KEEP_LAST_STANDING : 0,
      shed: undefined,
    }));
  }
  return text.map((line) =>
    typeof line === 'string'
      ? { text: line, keep: 0, shed: undefined }
      : { text: line.text, keep: line.keep ?? 0, shed: line.shed },
  );
}

/** A candidate for the give-way order: a whole embed, or one line of one block. */
interface Shed {
  rank: number;
  embed: number;
  /** -1 for the whole embed, 0 for the description, 1 + n for field n. */
  block: number;
  line: number;
}

const lineKey = (embed: number, block: number, line: number): string => `${embed}:${block}:${line}`;

/**
 * Renders one block: the surviving lines, one `…` where the first dropped run was, and the
 * part's own limit applied. `null` when the message guard took every line (the block goes).
 */
function renderBlock(
  block: Block,
  embed: number,
  index: number,
  dropped: ReadonlySet<string>,
  limit: number,
): string | null {
  const kept: KeptLine[] = [];
  let marked = false;
  let survivors = 0;
  for (const [line, entry] of block.lines.entries()) {
    if (dropped.has(lineKey(embed, index, line))) {
      if (!marked) {
        kept.push({ text: ELLIPSIS, keep: 0 });
        marked = true;
      }
      continue;
    }
    survivors += 1;
    kept.push({ text: entry.text, keep: entry.keep });
  }
  if (survivors === 0) return null;
  if (block.name === null) return cutText(kept.map((line) => line.text).join('\n'), limit);
  return fieldValue(kept, limit);
}

function renderDraft(draft: Draft, embed: number, dropped: ReadonlySet<string>): Embed {
  const { base } = draft;
  const out: Embed = { color: base.color };
  if (base.author !== undefined) {
    out.author = {
      name: cutText(base.author.name, AUTHOR_LIMIT),
      ...(base.author.url === undefined ? {} : { url: base.author.url }),
    };
  }
  if (base.title !== undefined) out.title = cutText(base.title, TITLE_LIMIT);
  if (base.url !== undefined) out.url = base.url;
  if (draft.description !== null) {
    const description = renderBlock(draft.description, embed, 0, dropped, DESCRIPTION_LIMIT);
    if (description !== null) out.description = description;
  }
  const fields: EmbedField[] = [];
  for (const [index, block] of draft.fields.entries()) {
    const value = renderBlock(block, embed, index + 1, dropped, FIELD_VALUE_LIMIT);
    if (value === null) continue;
    fields.push({
      name: cutText(block.name ?? '', FIELD_NAME_LIMIT),
      value,
      ...(block.inline === undefined ? {} : { inline: block.inline }),
    });
  }
  if (fields.length > 0) out.fields = fields;
  if (base.thumbnail !== undefined) out.thumbnail = base.thumbnail;
  if (base.footer !== undefined) out.footer = { text: cutText(base.footer.text, FOOTER_LIMIT) };
  return out;
}

/** Discord's count for one embed: title, description, field names and values, footer, author. */
export function embedLength(embed: Embed): number {
  const inFields = (embed.fields ?? []).reduce(
    (sum, field) => sum + field.name.length + field.value.length,
    0,
  );
  return (
    (embed.title?.length ?? 0) +
    (embed.description?.length ?? 0) +
    inFields +
    (embed.footer?.text.length ?? 0) +
    (embed.author?.name.length ?? 0)
  );
}

/** The 6,000 the limit is about: every embed of the message, summed. */
export function messageLength(embeds: readonly Embed[]): number {
  return embeds.reduce((sum, embed) => sum + embedLength(embed), 0);
}

/**
 * The last thing every builder does (M14.61): the drafts in, Discord-legal embeds out.
 *
 * 1. Every part gets its own limit (title 256, description 4,096, field value 1,024 by its lines'
 *    `keep`, field name 256, footer 2,048, author 256), and at most {@link EMBEDS_LIMIT} embeds.
 * 2. **Below 6,000 across the message it is the identity**: lines joined, nothing else.
 * 3. Over 6,000, the message gives way in the builders' order (`shed`, lowest first; 05-design
 *    10.12): a whole AI block, then the nerd lines, then the droppable lines of the header. Each
 *    drop leaves one `…` where its block's first gap is; a field that loses every line goes.
 * 4. Only if that is still not enough (no builder here can reach it) the last resort cuts field
 *    values from the last embed's last field backwards, keeping each value's first and last
 *    line, then descriptions from the last embed backwards.
 */
export function guardMessage(embeds: readonly DraftEmbed[]): Embed[] {
  const drafts: Draft[] = embeds.slice(0, EMBEDS_LIMIT).map((embed) => {
    const { description, fields, shed, ...base } = embed;
    return {
      base,
      shed,
      description:
        description === undefined ? null : { name: null, inline: undefined, lines: toLines(description) },
      fields: (fields ?? []).map((field) => ({
        name: field.name,
        inline: field.inline,
        lines: toLines(field.value),
      })),
    };
  });

  const droppedEmbeds = new Set<number>();
  const droppedLines = new Set<string>();
  const render = (): Embed[] =>
    drafts.flatMap((draft, index) =>
      droppedEmbeds.has(index) ? [] : [renderDraft(draft, index, droppedLines)],
    );

  let rendered = render();
  if (messageLength(rendered) <= TOTAL_LIMIT) return rendered;

  const order: Shed[] = [];
  for (const [embed, draft] of drafts.entries()) {
    if (draft.shed !== undefined) order.push({ rank: draft.shed, embed, block: -1, line: 0 });
    const blocks = [draft.description, ...draft.fields];
    for (const [block, entry] of blocks.entries()) {
      if (entry === null) continue;
      for (const [line, item] of entry.lines.entries()) {
        if (item.shed !== undefined) order.push({ rank: item.shed, embed, block, line });
      }
    }
  }
  // Lowest rank first; within a rank the lowest line in the message first.
  order.sort((a, b) => a.rank - b.rank || b.embed - a.embed || b.block - a.block || b.line - a.line);

  for (const step of order) {
    if (step.block === -1) droppedEmbeds.add(step.embed);
    else droppedLines.add(lineKey(step.embed, step.block, step.line));
    rendered = render();
    if (messageLength(rendered) <= TOTAL_LIMIT) return rendered;
  }

  return lastResort(rendered);
}

/** Step 4 of {@link guardMessage}: M4.12's `guardEmbed` cut, across the whole message. */
function lastResort(embeds: readonly Embed[]): Embed[] {
  let over = messageLength(embeds) - TOTAL_LIMIT;
  const out = embeds.map((embed) => (embed.fields ? { ...embed, fields: [...embed.fields] } : { ...embed }));
  for (let e = out.length - 1; e >= 0 && over > 0; e -= 1) {
    const fields = out[e]?.fields ?? [];
    for (let index = fields.length - 1; index >= 0 && over > 0; index -= 1) {
      const field = fields[index];
      if (field === undefined) continue;
      // At most down to a bare `…`: a field Discord will accept, saying that something was here.
      const cut = fieldValue(endsKept(field.value), Math.max(1, field.value.length - over));
      over -= field.value.length - cut.length;
      fields[index] = { ...field, value: cut };
    }
  }
  for (let e = out.length - 1; e >= 0 && over > 0; e -= 1) {
    const embed = out[e];
    if (embed?.description === undefined) continue;
    const cut = cutText(embed.description, Math.max(1, embed.description.length - over));
    over -= embed.description.length - cut.length;
    out[e] = { ...embed, description: cut };
  }
  return out;
}

/**
 * A value we did not build line by line, ranked: the first line and the last line are keepers.
 * Whichever end a field puts its keeper at, this pass keeps both and takes from the middle.
 */
function endsKept(value: string): FieldLine[] {
  const lines = value.split('\n');
  return lines.map((text, index) => ({
    text,
    keep: index === 0 || index === lines.length - 1 ? KEEP_LAST_STANDING : 0,
  }));
}
