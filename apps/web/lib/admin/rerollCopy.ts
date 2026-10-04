/**
 * The reroll's one friend-facing sentence, on its own (M14.44): `RerollControl` is a client
 * component, and importing it from `lib/admin/reroll.ts` put that file's command queue, the
 * service client and `supabase-js` (with zod) in Tonight's bundle for one string.
 * `lib/admin/reroll.ts` re-exports it.
 */

/** The sentence for a third press. `05-design.md`, "The title on a reroll"; verbatim. */
export const NO_MORE_SPLITS = 'No more splits. Change who is in the lobby and roll again, or play these.';
