import { notFound } from 'next/navigation';
import { GamesList } from '@/app/_games/GamesList';
import { PageGroupProvider } from '@/app/_shell/PageGroup';
import { CALIBRATION_READY } from '@/components/receipt/fixtures';
import { Shell } from '@/components/shell/Shell';
import type { GameListItem } from '@/lib/games/list';
import { ORIGINAL_GROUP } from '@/lib/groups/pageGroup';
import { ruleRowNote } from '@/lib/mode/rowNote';

/**
 * Dev-only: the `/games` list with a night of rule games (M15.19), which the shared local stack
 * has none of: `Tanks only · not rated`, `Ionia vs Noxus · not rated`, `Mirror match`, beside a
 * plain Fearless game and an ARAM. A 404 in production.
 */
const row = (id: string, over: Partial<GameListItem>): GameListItem => ({
  id,
  dateLabel: '4 Oct',
  durationLabel: '28 min',
  winningSide: 100,
  remake: false,
  aram: false,
  odds: { kind: 'rolled', blueWinProb: 0.54, rank: 1 },
  ruleNote: null,
  lines: [],
  ...over,
});

const ITEMS: GameListItem[] = [
  row('g5', { ruleNote: ruleRowNote({ id: 'mirror' }, true), winningSide: 200 }),
  row('g4', { ruleNote: ruleRowNote({ id: 'region', blue: 'ionia', red: 'noxus' }, false) }),
  row('g3', {
    ruleNote: ruleRowNote({ id: 'class', tag: 'Tank' }, false),
    odds: { kind: 'rolled', blueWinProb: 0.46, rank: 2 },
    winningSide: 100,
  }),
  row('g2', {}),
  row('g1', { aram: true, odds: null, durationLabel: '19 min' }),
];

export default function KitGamesPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  const group = ORIGINAL_GROUP;
  return (
    <PageGroupProvider group={group}>
      <Shell group={group} isAdmin={false} account="signed-in">
        <GamesList
          base="/g/customs/games"
          view={{
            filters: { window: 'all-time', mode: 'sr', player: null, page: 1 },
            total: ITEMS.length,
            pages: 1,
            members: [],
            focusName: null,
            items: ITEMS,
            calibration: CALIBRATION_READY,
            groupHasGames: true,
          }}
        />
      </Shell>
    </PageGroupProvider>
  );
}
