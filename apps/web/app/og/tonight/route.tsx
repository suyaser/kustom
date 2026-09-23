import { tonightCardModel } from '@/lib/og/cards';
import { createPublicClient } from '@/lib/publicClient';
import { loadTonight } from '@/lib/tonight/load';
import { nightTimeZone, tonightStart } from '@/lib/tonight/night';
import { cardResponse, TonightCard } from '../../_og/Cards';

/**
 * `/`'s share card (M11.4): the strip at the moment the unfurl bot asked. WhatsApp keeps a card
 * per URL, so one can be a night old; the slug on it says which night. Accepted, not busted.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const snapshot = await loadTonight(createPublicClient(), {
    nightStart: tonightStart(),
    timeZone: nightTimeZone(),
  });
  return cardResponse(<TonightCard model={tonightCardModel(snapshot)} />, 'public, max-age=60, s-maxage=60');
}
