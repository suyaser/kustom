import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CONNECT_LINE,
  DISCORD_JUST_CONNECTED,
  DISCORD_NOT_CONNECTED,
  WEBHOOK_HOWTO,
  WEBHOOK_INVALID,
} from '@/lib/admin/sectionCopy';
import { CONNECT_FAILED } from '@/lib/discord/connect';
import { pasteRefusal } from './DiscordControls';
import { type DiscordStatus, DiscordView } from './DiscordView';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));

/** The Discord page's four states (M14.23 acceptance 8) and its two writes. Role and text queries only. */

const GROUP_ID = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-10-03T21:00:00.000Z');
const NONE: DiscordStatus = { connected: false, guildId: null, testPostAt: null, testPostError: null };
const TESTED: DiscordStatus = {
  connected: true,
  guildId: '123',
  testPostAt: '2026-10-03T20:55:00.000Z',
  testPostError: null,
};

function view(
  status: DiscordStatus,
  result: 'connected' | 'test_failed' | 'failed' | null = null,
  readOnly = false,
) {
  return render(
    <DiscordView groupId={GROUP_ID} status={status} result={result} readOnly={readOnly} now={NOW} />,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockReset();
});

describe('the Discord page', () => {
  it('not connected: Connect Discord links to the connect route, with the permission line and the paste fallback', () => {
    view(NONE);
    expect(screen.getByRole('heading', { name: 'Not connected' })).toBeInTheDocument();
    expect(screen.getByText(DISCORD_NOT_CONNECTED)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Connect Discord' })).toHaveAttribute(
      'href',
      `/api/admin/discord/connect?groupId=${GROUP_ID}`,
    );
    expect(screen.getByText(CONNECT_LINE)).toBeInTheDocument();
    expect(screen.getByText('Or paste a webhook link instead')).toBeInTheDocument();
    expect(screen.getByLabelText('Webhook link')).toHaveAccessibleDescription(WEBHOOK_HOWTO);
    expect(screen.queryByRole('button', { name: 'Send a test post' })).not.toBeInTheDocument();
  });

  it('connected: Done · test post sent <time ago>, a test button, and connect again', () => {
    view(TESTED, 'connected');
    expect(screen.getByRole('heading', { name: 'Connected' })).toBeInTheDocument();
    expect(screen.getByText('Done · test post sent 5 minutes ago')).toBeInTheDocument();
    expect(screen.getByText(DISCORD_JUST_CONNECTED)).toHaveAttribute('role', 'status');
    expect(screen.getByRole('button', { name: 'Send a test post' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Connect a different channel' })).toBeInTheDocument();
  });

  it("cancelled on Discord: Discord wasn't connected, in place", () => {
    view(NONE, 'failed');
    expect(screen.getByRole('alert')).toHaveTextContent(CONNECT_FAILED);
  });

  it("failed test: Discord's reason, read from the database, not the URL", () => {
    view(
      { connected: true, guildId: '123', testPostAt: null, testPostError: 'Unknown Webhook' },
      'test_failed',
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      "The test post didn't go through. Discord said: Unknown Webhook",
    );
  });

  it('has no voice-split settings, no channel ids, and no mode or fearless control', () => {
    const { container } = view(TESTED);
    expect(container.textContent).not.toMatch(/voice|guild|channel id|fearless|\bmode\b/i);
    expect(container.textContent).not.toContain('123');
  });

  it('the operator reads the state with no control', () => {
    view(TESTED, null, true);
    expect(screen.getByText('Done · test post sent 5 minutes ago')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Webhook link')).not.toBeInTheDocument();
  });

  it('the paste posts the link with sendTestPost and refreshes; a refused link reads plainly', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: false,
            error: 'request body failed validation',
            issues: [{ path: 'webhookUrl', message: 'must be a https://discord.com/api/webhooks/... URL' }],
          }),
          { status: 400 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    view(NONE);
    fireEvent.change(screen.getByLabelText('Webhook link'), { target: { value: 'https://example.com/x' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save and send a test post' }));
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/admin/discord-config');
    expect(JSON.parse(String(init.body))).not.toHaveProperty('guildId');
    expect(JSON.parse(String(init.body))).toMatchObject({
      groupId: GROUP_ID,
      webhookUrl: 'https://example.com/x',
      sendTestPost: true,
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(WEBHOOK_INVALID);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('Send a test post posts to the test route and says so in place', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ ok: true, posted: true, testPostAt: NOW.toISOString(), testPostError: null }),
            {
              status: 200,
            },
          ),
      ),
    );
    view(TESTED);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send a test post' }));
    });
    expect(screen.getByRole('button', { name: 'Test post sent' })).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("Discord's own refusals of a pasted link are shown in the route's words", () => {
    const unknown = "Discord didn't recognise that webhook link. Copy it again from the channel's settings.";
    expect(pasteRefusal(400, { ok: false, error: unknown })).toBe(unknown);
    expect(pasteRefusal(502, { ok: false, error: "Discord didn't answer in time." })).toBe(
      "Discord didn't answer in time.",
    );
    expect(pasteRefusal(401, { ok: false, error: 'sign in required' })).toBe(
      'Your sign-in ran out. Sign in again.',
    );
    expect(pasteRefusal(500, { ok: false, error: 'internal error' })).not.toContain('internal');
  });

  it('a failed test post: the heading says so, and the reason is an alert', () => {
    view({ connected: true, guildId: '1', testPostAt: null, testPostError: 'Unknown Webhook' });
    expect(screen.getByRole('heading', { name: 'Test post failed' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Connected' })).not.toBeInTheDocument();
  });
});
