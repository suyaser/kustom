import { AI_RECAP_LABEL } from '../ai/recapCopy';
import { aiGateOpen, readAiGate } from '../premium';
import type { ServiceClient } from '../supabase';
import { aiRecapEmbed, type Embed, renderName, SLATE_COLOR, type WebhookPayload } from './embeds';
import { guardMessage } from './limits';
import { editWebhookMessage, selectWebhookUrl, type WebhookOptions, type WebhookOutcome } from './webhook';

/**
 * The AI recap's edit of the Discord result post (M16.4; brief m16.1 sections 1.2, 1.3, 4.2; D8).
 *
 * The result post goes out exactly when it always did, before any line is written. When the
 * game's recap line lands, the **same message** is edited to carry it as its own last embed (slate,
 * M14.61), under the result and the rating changes, labelled `AI recap` -- and only if that happens within
 * {@link RECAP_EDIT_WINDOW_MS} of the post. Never a second message, never an edit after 15 minutes.
 *
 * To edit, the post's message id is needed. The result post of a group whose AI lines are on asks
 * Discord for it (`?wait=true`, {@link resultPostWantsId}) and {@link rememberResultPost} keeps it in
 * this process's memory together with the payload it sent; generation runs in the same request's
 * `after()` (`lib/ai/afterIngest.ts`), so the memory is where the edit looks. Nothing is stored in
 * the database: a line generated on another instance (a second companion's retry) shows on the
 * site only, which the brief allows for any line that does not make the window.
 *
 * Names are escaped exactly like every other name Kustom posts ({@link renderName}), the rest of
 * the line is escaped too, and the edit is sent with mentions off.
 */

/** The window, from the post, inside which the recap may still be added (brief 1.2, D8). */
export const RECAP_EDIT_WINDOW_MS = 15 * 60 * 1000;

/** The block's title on the post (brief 1.3): the shared label, now an embed title (M14.61). */
export const AI_RECAP_FIELD_NAME = AI_RECAP_LABEL;

/** A recap is at most 220 characters before escaping; 1024 is a generous cap on the escaped line. */
const FIELD_VALUE_MAX = 1024;

export interface ResultPostRecord {
  groupId: string;
  messageId: string;
  postedAt: Date;
  /** Exactly what was posted, so the edit changes nothing but the added block. */
  payload: WebhookPayload;
}

const posts = new Map<string, ResultPostRecord>();

function prune(now: Date): void {
  for (const [gameId, record] of posts) {
    if (now.getTime() - record.postedAt.getTime() > RECAP_EDIT_WINDOW_MS) posts.delete(gameId);
  }
}

/**
 * Does this group's result post need its message id back? Only while Premium and AI lines are on;
 * every other group's post is the plain request it has always been. Never throws (the gate read
 * fails closed).
 */
export async function resultPostWantsId(client: ServiceClient, groupId: string): Promise<boolean> {
  return aiGateOpen(await readAiGate(client, groupId));
}

/** Keeps a posted result's message id for the recap edit. A post that did not land is ignored. */
export function rememberResultPost(
  gameId: string,
  input: { groupId: string; outcome: WebhookOutcome; payload: WebhookPayload },
  now: Date,
): void {
  prune(now);
  const messageId = input.outcome.messageId;
  if (input.outcome.status !== 'posted' || messageId === undefined || messageId === null) return;
  posts.set(gameId, { groupId: input.groupId, messageId, postedAt: now, payload: input.payload });
}

/** The remembered post of a game, or null (never posted here, or older than the window). */
export function resultPostOf(gameId: string, now: Date): ResultPostRecord | null {
  prune(now);
  return posts.get(gameId) ?? null;
}

/** Tests only. */
export function forgetResultPosts(): void {
  posts.clear();
}

/** The markdown Discord would read in a field value, plus `[`/`]` (masked links) and `<`/`>`. */
function escapeText(value: string): string {
  return value.replace(/([`*_~|\\[\]<>#])/g, '\\$1');
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: the slot markers are NUL-delimited on purpose.
const SLOT = /\u0000(\d+)\u0000/g;

/**
 * The Discord text of a rendered line whose names were left as NUL-delimited slot markers
 * (`\u0000<n>\u0000`, see `lib/ai/recap.ts`): the text around them is escaped, then each slot
 * becomes its name through {@link renderName} (truncated and escaped the way every post prints a
 * name). A marker with no name is no line.
 */
export function discordRecapText(withSlots: string, names: readonly (string | null)[]): string | null {
  let missing = false;
  const parts = withSlots.split(SLOT);
  // split with one capture group: even indexes are text, odd indexes are slot numbers.
  const out = parts.map((part, index) => {
    if (index % 2 === 0) return escapeText(part);
    const slot = Number(part);
    if (!Number.isInteger(slot) || slot < 0 || slot >= names.length) {
      missing = true;
      return '';
    }
    return renderName(names[slot] ?? null);
  });
  const text = out.join('').trim();
  return missing || text.length === 0 ? null : text.slice(0, FIELD_VALUE_MAX);
}

/**
 * Pure: the posted payload with the recap as its own last embed (M14.61, 05-design 10.5): a slate
 * `AI recap` E4 under the two sides, never a field on E1 (which would sit above the ten ratings).
 * Everything else is the posted payload, untouched; a second edit replaces the block rather than
 * adding another. The message guard drops the block whole if the message would ever exceed
 * Discord's 6,000 characters.
 */
export function recapPayload(payload: WebhookPayload, line: string): WebhookPayload {
  if (payload.embeds.length === 0) return payload;
  const posted = payload.embeds.filter((embed) => !isRecapEmbed(embed));
  return { ...payload, embeds: guardMessage([...posted, aiRecapEmbed(line.slice(0, FIELD_VALUE_MAX))]) };
}

/** The recap block this module adds: slate, titled `AI recap`. */
function isRecapEmbed(embed: Embed): boolean {
  return embed.color === SLATE_COLOR && embed.title === AI_RECAP_FIELD_NAME;
}

export type RecapEditOutcome =
  | { status: 'edited' }
  | { status: 'skipped'; reason: 'no_post' | 'late' | 'no_webhook' }
  | { status: 'failed'; reason: string };

/**
 * Adds the recap to the game's result post, if that post was made here and `now` is still within
 * {@link RECAP_EDIT_WINDOW_MS} of it. `line` is Discord-ready ({@link discordRecapText}). Never
 * throws.
 */
export async function editResultWithRecap(
  client: ServiceClient,
  input: { gameId: string; line: string; now: Date },
  options: WebhookOptions & { record?: ResultPostRecord | null } = {},
): Promise<RecapEditOutcome> {
  try {
    const record = options.record !== undefined ? options.record : (posts.get(input.gameId) ?? null);
    if (record === null) return { status: 'skipped', reason: 'no_post' };
    if (input.now.getTime() - record.postedAt.getTime() > RECAP_EDIT_WINDOW_MS) {
      return { status: 'skipped', reason: 'late' };
    }
    const url = await selectWebhookUrl(client, record.groupId);
    if (url === null) return { status: 'skipped', reason: 'no_webhook' };
    const outcome = await editWebhookMessage(
      url,
      record.messageId,
      recapPayload(record.payload, input.line),
      options,
    );
    if (outcome.status !== 'posted') {
      console.error(`discord: adding the AI recap to the result post failed: ${outcome.reason}`);
      return { status: 'failed', reason: outcome.reason ?? 'failed' };
    }
    posts.delete(input.gameId);
    return { status: 'edited' };
  } catch (error) {
    console.error('discord: AI recap edit failed', error instanceof Error ? error.message : 'unknown error');
    return { status: 'failed', reason: 'exception' };
  }
}
