import { cache } from 'react';
import { gameCopy, MYSTERY_TITLE } from '@/lib/mystery/copy';
import { loadMysteryOrNone } from '@/lib/mystery/load';
import type { MysteryPageState } from '@/lib/mystery/service';
import { MysteryLive } from '../../_mystery/MysteryLive';
import '../../mystery.css';
import '../../tonight.css';

/**
 * `/mystery` (M5.32, M8.4): today's one accountless daily game — Daily Mystery or Guess the
 * Award, whichever civil day this is. The same card lives on `/` so the WhatsApp link opens
 * it without a second tap.
 */
export const dynamic = 'force-dynamic';

/**
 * One load per request, shared with `generateMetadata`. `React.cache` and not a second call:
 * the loader reads the visitor's cookie and touches their session row, and doing that twice
 * for one page view would be two round trips to say the same thing.
 */
const loadTodayGame = cache(() => loadMysteryOrNone());

/**
 * The tab says which game today is, because a tab reading `Daily Mystery` over a card reading
 * `Guess the Award` is the page arguing with itself. An empty day keeps the neutral title
 * rather than naming a game nothing built.
 */
export async function generateMetadata() {
  return { title: `${titleOf(await loadTodayGame())} · Kustom` };
}

function titleOf(state: MysteryPageState): string {
  if (state.kind === 'play') return gameCopy(state.play.kind).title;
  if (state.kind === 'closed') return gameCopy(state.result.kind).title;
  return MYSTERY_TITLE;
}

export default async function MysteryPage() {
  const mystery = await loadTodayGame();

  return (
    <main className="cn-page">
      <MysteryLive initial={mystery} />
    </main>
  );
}
