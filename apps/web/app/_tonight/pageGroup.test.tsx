import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PageGroup } from '@/lib/groups/pageGroup';
import { START_LOBBY_BUTTON } from '@/lib/lobbyStart';
import { groupHref } from '@/lib/nav';
import { workedBoardRows } from '@/lib/testing/boardFixtures';
import { lobbyView, tapeEntry, workedMembers } from '@/lib/testing/tonightFixtures';
import { REROLL_LABEL, ROLL_LABEL } from '@/lib/tonight/copy';
import { TopOfBoard } from '../_leaderboard/BoardCard';
import { MysteryTeaser } from '../_mystery/MysteryTeaser';
import { PageGroupProvider } from '../_shell/PageGroup';
import { NightTape } from './NightTape';
import { RerollControl } from './RerollControl';
import { RoleTonight } from './RoleTonight';
import { RollControl } from './RollControl';
import { StartLobby, StartLobbySignIn } from './StartLobby';

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

  it('Start a lobby, and its sign-in, which returns to the group page it started from', async () => {
    answer(409, { ok: false, error: 'no' });
    const { container, unmount } = inGroup(<StartLobby start={null} press around={0} />);
    expect(container.querySelector('input[name="groupId"]')).toHaveValue(GROUP_B.id);
    expect(container.querySelector('input[name="redirectTo"]')).toHaveValue('/g/thursday-flex');
    fireEvent.click(screen.getByRole('button', { name: START_LOBBY_BUTTON }));
    await waitFor(() => expect(lastBody()).toEqual({ groupId: GROUP_B.id }));
    unmount();

    const signIn = inGroup(<StartLobbySignIn />);
    expect(signIn.container.querySelector('input[name="next"]')).toHaveValue('/g/thursday-flex');
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
    const { container } = inGroup(
      <NightTape tape={[tapeEntry({ result: { ...(tapeEntry().result ?? fail()), gameId: 'game-a' } })]} />,
    );
    expect(container.querySelector('a')).toHaveAttribute('href', '/g/thursday-flex/games/game-a');
  });

  it('draws rail names as text while the group has no player page', () => {
    const { container } = inGroup(
      <TopOfBoard
        rows={workedBoardRows().slice(0, 5)}
        viewerPuuid={null}
        playerHref={(puuid) => groupHref(GROUP_B, { page: 'player', puuid })}
      />,
    );
    expect(screen.getByText('Lena')).toBeInTheDocument();
    expect(container.querySelector('.cn-row-name a, a.cn-row-name')).toBeNull();
  });
});

describe('the daily pointer', () => {
  it("is not drawn while the group has no daily page, whatever the day's state", () => {
    const { container } = inGroup(
      <MysteryTeaser mystery={{ kind: 'empty' } as Parameters<typeof MysteryTeaser>[0]['mystery']} />,
    );
    expect(container.innerHTML).toBe('');
    expect(groupHref(GROUP_B, { page: 'mystery' })).toBeNull();
  });
});

function fail(): never {
  throw new Error('fixture');
}
