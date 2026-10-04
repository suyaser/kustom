import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HostSetupCard } from '@/app/(group)/g/[slug]/admin/_components/HostSetupCard';
import { WHICH_ACCOUNT_REASON } from '@/lib/groups/pageCopy';
import { JoinPairing } from './JoinControls';
import { JoinView } from './JoinView';
import { PAIRING_POLL_MS } from './PairingCode';

/**
 * M14.33 acceptance 1 for the two pairing paths: once Kustom uses the code (the account is now
 * linked), the page lands on the group's You tab with the welcome card. Role and text queries.
 */

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

const EXPIRES = new Date(Date.now() + 15 * 60_000).toISOString();
const GROUP = { id: '11111111-1111-4111-8111-111111111111', slug: 'friday-five', name: 'Friday Five' };

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

/** Issues `K7QX2M`, then answers every poll `used`. */
function usedOnFirstPoll() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) =>
      String(input) === '/api/me/pairing'
        ? json({ ok: true, code: 'K7QX2M', expiresAt: EXPIRES, group: GROUP })
        : json({ ok: true, status: 'used', group: GROUP }),
    ),
  );
}

async function untilUsed(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(PAIRING_POLL_MS);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  push.mockReset();
  refresh.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the /join Kustom-code card', () => {
  it('lands on /g/<slug>/you?welcome=1 once the code is used', async () => {
    usedOnFirstPoll();
    render(<JoinPairing code="AbCdEfGhIjKlMnOpQrStUv" />);
    await untilUsed();
    expect(push).toHaveBeenCalledWith('/g/friday-five/you?welcome=1');
  });

  it('says why it asks, under the heading', () => {
    vi.useRealTimers();
    render(
      <JoinView kind="unlinked" code="AbCd" group={GROUP} preview={{ kind: 'waiting', code: 'K7QX2M' }} />,
    );
    expect(screen.getByText(WHICH_ACCOUNT_REASON)).toHaveTextContent(
      "Once we know, you'll see every game you've played with this group.",
    );
  });
});

describe("an admin's Host-mode pairing card", () => {
  it('says open Kustom with League running, with no mode to pick (M17.12)', () => {
    vi.useRealTimers();
    render(<HostSetupCard groupId={GROUP.id} />);
    expect(screen.getByText('Open Kustom with League running.')).toBeInTheDocument();
    expect(screen.queryByText(/pick Host/)).not.toBeInTheDocument();
  });

  it('lands on the welcome URL when the pairing links an unlinked creator', async () => {
    usedOnFirstPoll();
    render(<HostSetupCard groupId={GROUP.id} linkedHref="/g/friday-five/you?welcome=1" />);
    await act(async () => {
      screen.getByRole('button').click();
    });
    await untilUsed();
    expect(push).toHaveBeenCalledWith('/g/friday-five/you?welcome=1');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('only refreshes in place for an admin who was already linked', async () => {
    usedOnFirstPoll();
    render(<HostSetupCard groupId={GROUP.id} />);
    await act(async () => {
      screen.getByRole('button').click();
    });
    await untilUsed();
    expect(refresh).toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});
