import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PageGroup } from '@/lib/groups/pageGroup';
import { groupHref } from '@/lib/nav';
import { workedBoardRows } from '@/lib/testing/boardFixtures';
import { lobbyView, tapeEntry, workedMembers } from '@/lib/testing/tonightFixtures';
import { REROLL_LABEL, ROLL_LABEL } from '@/lib/tonight/copy';
import { PageGroupProvider } from '../_shell/PageGroup';
import { DailyCard, TopFive } from './Cards';
import { RerollControl } from './RerollControl';
import { RoleTonight } from './RoleTonight';
import { RollControl } from './RollControl';
import { Tape } from './Tape';

/**
 * The tonight page's group-scoped parts under a group that is not the original one (M13.9):
 * every control puts **that** group's id in its body and its no-JavaScript form, every return
 * path and link starts with its `/g/<slug>`, and nothing links to a page that does not exist for
 * it yet. The per-component tests render without a provider and so prove the original group.
 */

const GROUP_B: PageGroup = {
  id: '22222222-2222-4222-8222-222222222222',
  slug: 'thursday-flex',
  name: 'Thursday Flex',
};
const LOBBY_ID = '0b0e5a1c-3f7d-4c2a-9a51-1d2e3f4a5b6c';

function inGroup(children: ReactNode) {
  return render(<PageGroupProvider group={GROUP_B}>{children}</PageGroupProvider>);
}

function answer(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: status < 400, status, json: async () => body }) as unknown as Response),
  );
}

function lastBody(): unknown {
  const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
  return JSON.parse(String(calls[calls.length - 1]?.[1]?.body));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the controls send the page's group", () => {
  it('Roll teams', async () => {
    answer(409, { ok: false, error: 'no' });
    const { container } = inGroup(<RollControl lobbyId={LOBBY_ID} members={workedMembers()} />);
    expect(container.querySelector('input[name="groupId"]')).toHaveValue(GROUP_B.id);
    expect(container.querySelector('input[name="redirectTo"]')).toHaveValue('/g/thursday-flex');

    fireEvent.click(screen.getByRole('button', { name: ROLL_LABEL }));
    await waitFor(() => expect(lastBody()).toMatchObject({ groupId: GROUP_B.id }));
  });

  it('Reroll', async () => {
    answer(409, { ok: false, error: 'no' });
    const splits = [1, 2, 3].map((rank) => ({ id: `split-${rank}`, rank, isChosen: rank === 1 }));
    const { container } = inGroup(<RerollControl lobbyId={LOBBY_ID} splits={splits} />);
    expect(container.querySelector('input[name="groupId"]')).toHaveValue(GROUP_B.id);
    expect(container.querySelector('input[name="redirectTo"]')).toHaveValue('/g/thursday-flex');

    fireEvent.click(screen.getByRole('button', { name: REROLL_LABEL }));
    await waitFor(() => expect(lastBody()).toEqual({ groupId: GROUP_B.id, splitId: 'split-2' }));
  });

  it("Role for tonight's sign-in and role tap", async () => {
    const live = lobbyView({ id: 'lobby-1', status: 'open' });
    const anonymous = inGroup(<RoleTonight lobby={live} viewer={{ kind: 'anonymous' }} />);
    expect(anonymous.container.querySelector('input[name="next"]')).toHaveValue('/g/thursday-flex');
    anonymous.unmount();

    answer(200, { ok: true });
    const me = live.members[0]?.puuid ?? '';
    const { container } = inGroup(
      <RoleTonight lobby={live} viewer={{ kind: 'linked', puuid: me, isAdmin: false }} />,
    );
    expect(container.querySelector('input[name="groupId"]')).toHaveValue(GROUP_B.id);
    expect(container.querySelector('input[name="redirectTo"]')).toHaveValue('/g/thursday-flex');
  });
});

describe("the page's links stay inside the group", () => {
  it("links the tape to the group's game page", () => {
    render(
      <Tape
        tape={[tapeEntry({ result: { ...(tapeEntry().result ?? fail()), gameId: 'game-a' } })]}
        group={GROUP_B}
      />,
    );
    expect(screen.getByRole('link', { name: /Game 1/ })).toHaveAttribute(
      'href',
      '/g/thursday-flex/games/game-a',
    );
  });

  it('links top-five names to the player page inside the group (M14.15 moved it under every group)', () => {
    render(<TopFive rows={workedBoardRows().slice(0, 5)} viewerPuuid={null} group={GROUP_B} />);
    const lena = screen.getByRole('link', { name: /Lena/ });
    expect(lena.getAttribute('href')).toMatch(new RegExp(`^/g/${GROUP_B.slug}/p/`));
  });
});

describe('Top this week prints same-name labels (M14.69)', () => {
  it('Ali (2), the suffix muted', () => {
    const rows = workedBoardRows()
      .slice(0, 5)
      .map((row, i) => (i === 2 ? { ...row, name: 'Ali', nameSuffix: '(2)' } : row));
    render(<TopFive rows={rows} viewerPuuid={null} group={GROUP_B} />);
    expect(screen.getByText('(2)')).toHaveClass('font-normal');
    expect(screen.getByRole('link', { name: /Ali \(2\)/ })).toBeInTheDocument();
  });
});

describe('an empty Top this week points somewhere (M14.70)', () => {
  it('links to last week on the board', () => {
    render(<TopFive rows={[]} viewerPuuid={null} group={GROUP_B} fallback="last-week" />);
    expect(screen.getByText('No games this week yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See last week' })).toHaveAttribute(
      'href',
      `/g/${GROUP_B.slug}/leaderboard?window=last-week`,
    );
  });

  it('links to all time when last week was empty too', () => {
    render(<TopFive rows={[]} viewerPuuid={null} group={GROUP_B} fallback="all-time" />);
    expect(screen.getByRole('link', { name: 'See all time' })).toHaveAttribute(
      'href',
      `/g/${GROUP_B.slug}/leaderboard?window=all-time`,
    );
  });

  it('offers no link when the group has never played a rated game', () => {
    render(<TopFive rows={[]} viewerPuuid={null} group={GROUP_B} fallback={null} />);
    expect(screen.queryByRole('link', { name: /^See / })).not.toBeInTheDocument();
  });
});

describe('the daily card', () => {
  it('is not drawn on a day with no game; every group has its own daily page (M14.17)', () => {
    const { container } = render(
      <DailyCard mystery={{ kind: 'empty' } as Parameters<typeof DailyCard>[0]['mystery']} group={GROUP_B} />,
    );
    expect(container.innerHTML).toBe('');
    expect(groupHref(GROUP_B, { page: 'mystery' })).toBe(`/g/${GROUP_B.slug}/mystery`);
  });
});

function fail(): never {
  throw new Error('fixture');
}
