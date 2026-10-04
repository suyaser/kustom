import { ddragonChampionId } from '../champs/ddragon';
import { listChampions } from '../champs/names';

/**
 * A champion as a friend reads it (M14.38 design): the client's `championName` is the Data Dragon
 * id (`LeeSin`, `MonkeyKing`), so the daily card turns it into the champion table's display name
 * (`Lee Sin`, `Wukong`). An id the table does not know prints as stored.
 */
let byDataDragonId: Map<string, string> | null = null;

export function championDisplayName(stored: string): string {
  if (byDataDragonId === null) {
    byDataDragonId = new Map();
    for (const champion of listChampions()) {
      const key = ddragonChampionId(champion.id);
      if (key !== null) byDataDragonId.set(key.toLowerCase(), champion.name);
    }
  }
  return byDataDragonId.get(stored.trim().toLowerCase()) ?? stored;
}
