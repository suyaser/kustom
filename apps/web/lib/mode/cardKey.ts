/** Free of React, so a server component can build the key it hands the client store (M22.6). */

/**
 * The store key of a lobby's card (M22.4, M22 D5): every entry of `./clientStore.ts` is keyed by it. A one-lobby
 * night, and the lobby whose card is `group_modes`, use the group id itself, so today's keys and
 * the `group_modes` rows `TonightLive` applies are unchanged. A forked lobby's card (its own
 * `lobby_modes` row) gets its own key: a `group_modes` row, which is another lobby's card, can
 * never land on it. Such a card is patched only by its own route answers and otherwise follows
 * the server render (each mode write bumps the group's live signal, M19.9).
 */
export function modeCardKey(groupId: string, forkedPartyId: string | null = null): string {
  return forkedPartyId === null ? groupId : `${groupId}#lobby:${forkedPartyId}`;
}
