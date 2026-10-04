import { HOST_PAIRING_TOKEN_LABEL } from '../groups/copy';
import { pcOf, UNNAMED_HOST } from './sectionCopy';

/**
 * A host's name, the same on the Hosts list, its `Stop … ?` confirm and the checklist's
 * `Kustom seen on …` (M14.50). Pure.
 *
 * A name an admin typed for a hand-made key wins. A pairing's token carries the fixed label
 * `Kustom (paired)` on every device, so it (and a key with no name) is named after its League
 * account: `Hana’s PC`. With neither, `Unnamed PC`. Never `This PC`: the admin reading the list is
 * usually not on that PC.
 */
export function hostName(host: { label: string | null; account: string | null }): string {
  const label = host.label?.trim();
  if (label && host.label !== HOST_PAIRING_TOKEN_LABEL) return label;
  const account = host.account?.trim();
  return account ? pcOf(account) : UNNAMED_HOST;
}

/**
 * The account half of `<Account>’s PC`: the player's name without the `#tag` (a possessive on
 * `Hana#EUW` reads badly), or `null` when the row has no name yet. A PUUID fragment never names a PC.
 */
export function hostAccount(row: { displayName: string | null; gameName: string | null }): string | null {
  return row.displayName?.trim() || row.gameName?.trim() || null;
}
