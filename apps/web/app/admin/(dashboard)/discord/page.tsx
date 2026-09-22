import type { Metadata } from 'next';
import { listDiscordConfigs, maskSecret } from '@/lib/admin/discordConfig';
import { requireAdmin } from '@/lib/adminPage';
import { getServiceClient } from '@/lib/supabase';
import { AdminForm } from '../../_components/AdminForm';
import { Card, Notices, PageHeader, type SearchParams } from '../../_components/ui';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Discord — Kustom admin',
  robots: { index: false, follow: false },
};

/**
 * The single `discord_config` row: where results are posted (M3) and which voice channels the
 * bot moves people between (M4).
 *
 * The webhook URL is a credential — anyone holding it can post as the bot — so it is shown
 * masked and never sent back to the browser in full. An empty field leaves the stored one
 * alone; clearing it takes the explicit checkbox.
 */
export default async function AdminDiscordPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [params] = await Promise.all([searchParams, requireAdmin()]);
  const configs = await listDiscordConfigs(getServiceClient());
  const config = configs[0] ?? null;

  return (
    <main>
      <PageHeader title="Discord">
        <p className="admin-muted">
          One guild, one row. The browser can never read this table on its own — the server reads it and sends
          out only what you see here.
        </p>
      </PageHeader>

      <Notices params={params} />

      {configs.length > 1 ? (
        <p className="admin-error" role="alert">
          {configs.length} guilds are configured ({configs.map((row) => row.guildId).join(', ')}). Saving
          writes the guild id in the form and leaves the others alone; the bot reads the oldest, shown below.
          Delete the stale rows in Studio.
        </p>
      ) : null}

      <Card title="Config">
        {config === null ? (
          <p className="admin-empty">
            Discord is not configured yet. Fill this in now and the team posts and the voice split will have
            somewhere to go when they are built.
          </p>
        ) : (
          <p className="admin-muted">Last saved {config.updatedAt.slice(0, 19).replace('T', ' ')} UTC.</p>
        )}

        <AdminForm action="/api/admin/discord-config" kind="discord" className="admin-stacked">
          <label className="admin-field">
            <span>Guild id</span>
            <input
              type="text"
              name="guildId"
              inputMode="numeric"
              required
              defaultValue={config?.guildId ?? ''}
              size={24}
            />
          </label>

          <label className="admin-field">
            <span>
              Results webhook{' '}
              <span className="admin-muted">
                {config?.webhookUrl ? `stored: ${maskSecret(config.webhookUrl)}` : 'none stored'} — leave
                empty to keep it
              </span>
            </span>
            <input
              type="url"
              name="webhookUrl"
              placeholder="https://discord.com/api/webhooks/..."
              size={40}
              autoComplete="off"
            />
          </label>

          <label className="admin-field admin-field-check">
            <input type="checkbox" name="clearWebhook" value="true" /> <span>Clear the stored webhook</span>
          </label>

          <label className="admin-field">
            <span>Results channel id</span>
            <input
              type="text"
              name="resultsChannelId"
              inputMode="numeric"
              defaultValue={config?.resultsChannelId ?? ''}
              size={24}
            />
          </label>

          <label className="admin-field">
            <span>Lobby voice channel id</span>
            <input
              type="text"
              name="lobbyVoiceChannelId"
              inputMode="numeric"
              defaultValue={config?.lobbyVoiceChannelId ?? ''}
              size={24}
            />
          </label>

          <label className="admin-field">
            <span>Blue voice channel id</span>
            <input
              type="text"
              name="blueVoiceChannelId"
              inputMode="numeric"
              defaultValue={config?.blueVoiceChannelId ?? ''}
              size={24}
            />
          </label>

          <label className="admin-field">
            <span>Red voice channel id</span>
            <input
              type="text"
              name="redVoiceChannelId"
              inputMode="numeric"
              defaultValue={config?.redVoiceChannelId ?? ''}
              size={24}
            />
          </label>

          <button type="submit" className="admin-primary">
            Save
          </button>
        </AdminForm>
      </Card>
    </main>
  );
}
