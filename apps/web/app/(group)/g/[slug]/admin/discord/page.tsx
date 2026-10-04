import type { Metadata } from 'next';
import { adminNav } from '@/lib/admin/adminNav';
import { DISCORD_TITLE } from '@/lib/admin/homeCopy';
import { supabaseDiscordConnectStore } from '@/lib/discord/connect';
import { getServiceClient } from '@/lib/supabase';
import { AdminFrame } from '../_components/AdminFrame';
import { sectionAccess } from '../_components/sectionAccess';
import { type ConnectResult, DiscordView } from './DiscordView';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: `${DISCORD_TITLE} · Kustom`,
  robots: { index: false, follow: false },
};

const RESULTS: readonly string[] = ['connected', 'test_failed', 'failed'];

/**
 * `/g/<slug>/admin/discord` (M14.23; STRATEGY 3.2 step 2): this group's webhook only. The state is
 * `readStatus` (M14.20), never the webhook URL, not even masked; `?discord=` is the callback's word.
 */
export default async function GroupDiscordPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ discord?: string | string[] }>;
}) {
  const gate = await sectionAccess((await params).slug, 'discord');
  if ('refusal' in gate) return gate.refusal;
  const { group, reader } = gate;

  const raw = (await searchParams).discord;
  const word = typeof raw === 'string' ? raw : null;
  const result: ConnectResult = word !== null && RESULTS.includes(word) ? (word as ConnectResult) : null;
  const status = await supabaseDiscordConnectStore(getServiceClient()).readStatus(group.id);

  return (
    <AdminFrame
      group={group}
      title={DISCORD_TITLE}
      // The unlinked creator may only be here and on the admin home (M14.40): no section nav for them.
      nav={reader.kind === 'creator-unlinked' ? [] : adminNav(group, 'discord')}
      readOnly={reader.kind === 'operator'}
    >
      <DiscordView
        groupId={group.id}
        status={{
          connected: status?.webhookSet ?? false,
          guildId: status?.guildId ?? null,
          testPostAt: status?.testPostAt ?? null,
          testPostError: status?.testPostError ?? null,
        }}
        result={result}
        readOnly={reader.kind === 'operator'}
        now={new Date()}
      />
    </AdminFrame>
  );
}
