import { kustomCardModel } from '@/lib/og/cards';
import { cardResponse, PitchCard } from '../../_og/Cards';

/**
 * `/og/kustom`: the plain Kustom card (M14.42, scene-walk gap 9) for `/`, `/about` and a dead
 * invite. It names no group and reads nothing, so a dead code's preview can never leak whose link
 * it was. A day's cache: the words only change with a deploy.
 */
export async function GET() {
  return cardResponse(<PitchCard model={kustomCardModel()} />, 'public, max-age=86400, s-maxage=86400');
}
