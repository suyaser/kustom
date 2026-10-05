/**
 * The reroll's one friend-facing sentence, on its own (M14.44): `RerollControl` is a client
 * component, and importing it from `lib/admin/reroll.ts` put that file's command queue, the
 * service client and `supabase-js` (with zod) in Tonight's bundle for one string.
 * `lib/admin/reroll.ts` re-exports it.
 */

/**
 * Roll's and Reroll's 409 for a lobby that was abandoned (lower case, no stop: `/admin` prints it
 * inline). Here, not in `./roll.ts`, so Tonight's `RollControl` can compare against it (M22.6:
 * with two lobbies it reads `That lobby has ended.`) without that file's server imports.
 */
export const LOBBY_ABANDONED = 'that lobby was abandoned';

/** The sentence for a third press. `05-design.md`, "The title on a reroll"; verbatim. */
export const NO_MORE_SPLITS = 'No more splits. Change who is in the lobby and roll again, or play these.';
