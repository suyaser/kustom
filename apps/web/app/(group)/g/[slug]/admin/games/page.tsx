import type { Metadata } from 'next';
import { adminNav } from '@/lib/admin/adminNav';
import { GAMES_COPY, listCapturedGames, listMissedLobbies } from '@/lib/admin/games';
import { getServiceClient } from '@/lib/supabase';
import { nightTimeZone } from '@/lib/tonight/night';
import { AdminFrame } from '../_components/AdminFrame';
import { sectionAccess } from '../_components/sectionAccess';
import { GamesView } from './GamesView';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: `${GAMES_COPY.heading} · Kustom`,
  robots: { index: false, follow: false },
};

/**
 * `/g/<slug>/admin/games` (M14.23; M5.5's report, scoped to the group and restyled): lobbies that
 * started a game and never got a result, and the games Kustom has. **Read-only by rule**, as M5.5
 * said: no form, no route, nothing that clears the only evidence of a missed night. Party ids and the
 * old extra column are gone (developer detail).
 */
export default async function GroupAdminGamesPage({ params }: { params: Promise<{ slug: string }> }) {
  const gate = await sectionAccess((await params).slug, 'games');
  if ('refusal' in gate) return gate.refusal;
  const { group, reader } = gate;

  const client = getServiceClient();
  const options = { timeZone: nightTimeZone(), groupId: group.id };
  const [missed, captured] = await Promise.all([
    listMissedLobbies(client, options),
    listCapturedGames(client, options),
  ]);

  return (
    <AdminFrame
      group={group}
      title={GAMES_COPY.heading}
      nav={adminNav(group, 'games')}
      readOnly={reader.kind === 'operator'}
      wide
    >
      <GamesView group={group} missed={missed} captured={captured} />
    </AdminFrame>
  );
}
