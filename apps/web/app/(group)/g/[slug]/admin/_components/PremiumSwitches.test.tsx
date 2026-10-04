import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiLinesAboutYou } from '@/components/premium/AiLinesAboutYou';
import { YouPage } from '@/components/shell/YouPage';
import { adminNav } from '@/lib/admin/adminNav';
import { deriveChecklist } from '@/lib/admin/checklist';
import type { GroupMemberRow } from '@/lib/admin/groupMembers';
import {
  AI_LINES_OFF_LINE,
  AI_LINES_ON_LINE,
  aiPausedLine,
  dontWriteAboutBody,
  NOT_IN_AI_LINES,
  SWITCH_FAILED,
  WRITE_ABOUT_ME_ON_DONE,
  writeAboutMeOffDone,
} from '@/lib/aiLinesCopy';
import { AdminHome } from './AdminHome';
import { MembersTable } from './MembersTable';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));

/**
 * M16.3b: Premium's switches on the admin home, the members list and You. A group without Premium
 * draws no Premium surface (admin home and You byte-identical; the members list gains no AI control, though M14.52's order applies to every group), the word `Premium` never reaches a member,
 * and the admin's member control only ever sets the opt-out. Role and text queries only.
 */

const GROUP = { id: '11111111-1111-4111-8111-111111111111', slug: 'friday-five', name: 'Friday Five' };
const checklist = deriveChecklist(
  {
    discord: { webhookSet: true, testPostAt: '2026-10-02T20:00:00Z', testPostError: null },
    members: 3,
    hosts: [{ label: 'Hana PC', account: null, lastSeenAt: '2026-10-03T20:58:00Z' }],
    hasGame: true,
  },
  { now: new Date('2026-10-03T21:00:00.000Z'), groupLink: 'kustom.gg/g/friday-five' },
);

type HomeProps = Extract<ComponentProps<typeof AdminHome>, { kind: 'home' }>;
const homeProps = (overrides: Partial<HomeProps> = {}): HomeProps => ({
  kind: 'home',
  group: GROUP,
  access: 'owner',
  checklist,
  discordHref: '/g/friday-five/admin/discord',
  invite: { state: 'shown', url: 'https://kustom.gg/join/AbCdEfGhIjKlMnOpQrStUv' },
  origin: 'https://kustom.gg',
  members: 3,
  nav: adminNav(GROUP, 'home'),
  ...overrides,
});

const ROWS: GroupMemberRow[] = [
  {
    playerId: 'p-owner',
    puuid: 'a',
    name: 'Hana',
    named: true,
    role: 'owner',
    games: 40,
    lastPlayedAt: null,
    aiOptOut: false,
    discordLinked: false,
  },
  {
    playerId: 'p-member',
    puuid: 'c',
    name: 'Ramzy',
    named: true,
    role: 'member',
    games: 2,
    lastPlayedAt: null,
    aiOptOut: false,
    discordLinked: false,
  },
  {
    playerId: 'p-quiet',
    puuid: 'd',
    name: 'Bilal',
    named: true,
    role: 'member',
    games: 5,
    lastPlayedAt: null,
    aiOptOut: true,
    discordLinked: false,
  },
];

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const sentBody = (fetchMock: ReturnType<typeof stubFetch>) =>
  JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;

const rowOf = (name: string) =>
  screen.getByRole('rowheader', { name: new RegExp(name) }).closest('[role=row]') as HTMLElement;

/** The row with its `Manage` actions open (M14.52: one toggle per row). */
const managed = (name: string) => {
  const toggle = within(rowOf(name)).getByRole('button', { name: /^Manage/ });
  if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
  return rowOf(name);
};

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockReset();
});

describe('a group without Premium draws none of it', () => {
  it('admin home: null and absent are byte-identical, and no Premium or AI word', () => {
    const before = render(<AdminHome {...homeProps()} />).container.innerHTML;
    const after = render(<AdminHome {...homeProps({ premium: null })} />).container.innerHTML;
    expect(after).toBe(before);
    expect(after).not.toMatch(/Premium|AI lines/);
  });

  it('members: aiLines off adds no AI control or word (same markup as no aiLines prop)', () => {
    const viewer = { role: 'owner', playerId: 'p-owner' } as const;
    // React's generated ids differ per render; everything else matches.
    const html = (node: HTMLElement) => node.innerHTML.replace(/(id|for|aria-controls)="[^"]*"/g, '$1=""');
    const before = html(render(<MembersTable groupId={GROUP.id} rows={ROWS} viewer={viewer} />).container);
    const after = html(
      render(<MembersTable groupId={GROUP.id} rows={ROWS} viewer={viewer} aiLines={false} />).container,
    );
    expect(after).toBe(before);
    expect(after).not.toMatch(/write about|AI lines/i);
  });

  it('You: no aiLines card is byte-identical', () => {
    const common = {
      kind: 'linked',
      group: GROUP,
      here: '/g/friday-five/you',
      daily: null,
      admin: null,
      playerPage: null,
      self: <h1>Hana</h1>,
    } as const;
    const before = render(<YouPage {...common} />).container.innerHTML;
    const after = render(<YouPage {...common} aiLines={null} />).container.innerHTML;
    expect(after).toBe(before);
    expect(after).not.toMatch(/Premium|AI lines/);
  });
});

describe('the admin home: Kustom Premium', () => {
  it('owner and admin get the section with the AI lines switch and its state line', () => {
    render(<AdminHome {...homeProps({ premium: { linesEnabled: true, pausedUntilDay: null } })} />);
    const section = screen
      .getByRole('heading', { level: 2, name: 'Kustom Premium' })
      .closest('[data-slot=card]');
    const toggle = within(section as HTMLElement).getByRole('switch', { name: 'AI lines' });
    expect(toggle).toBeChecked();
    expect(within(section as HTMLElement).getByText(AI_LINES_ON_LINE)).toBeInTheDocument();
    expect(screen.queryByText(/paused until/)).not.toBeInTheDocument();
  });

  it('shows the budget line only when paused', () => {
    render(
      <AdminHome
        {...homeProps({ access: 'admin', premium: { linesEnabled: true, pausedUntilDay: '1 Nov' } })}
      />,
    );
    expect(screen.getByText(aiPausedLine('1 Nov'))).toBeInTheDocument();
    // F3: a static Paused chip leads the row.
    expect(screen.getByText('Paused')).toBeInTheDocument();
    // Moved from M16.4's AdminHomeAiBudget.test: the brief's sentence, inside the one Premium card.
    expect(aiPausedLine('1 Nov')).toBe(
      "AI lines are paused until 1 Nov: this month's budget is used up. Everything else works as usual.",
    );
    expect(screen.getAllByRole('heading', { name: 'Kustom Premium' })).toHaveLength(1);
  });

  it('a member never reaches it (not-admin page)', () => {
    const { container } = render(<AdminHome kind="not-admin" group={GROUP} />);
    expect(container.textContent).not.toMatch(/Premium|AI lines/);
  });

  it('the unlinked creator and the operator never get it, even for a Premium group', () => {
    const premium = { linesEnabled: true, pausedUntilDay: '1 Nov' };
    const { unmount } = render(<AdminHome {...homeProps({ access: 'creator-unlinked', premium })} />);
    expect(screen.queryByText(/Premium|AI lines/)).not.toBeInTheDocument();
    unmount();
    render(<AdminHome {...homeProps({ access: 'operator', premium })} />);
    expect(screen.queryByText(/Premium|AI lines/)).not.toBeInTheDocument();
  });

  it('flipping the switch posts at once, with no confirm, and the line follows', async () => {
    const fetchMock = stubFetch(200, { ok: true, groupId: GROUP.id, enabled: false });
    render(<AdminHome {...homeProps({ premium: { linesEnabled: true, pausedUntilDay: null } })} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('switch', { name: 'AI lines' }));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/admin/ai-lines');
    expect(sentBody(fetchMock)).toEqual({ groupId: GROUP.id, enabled: false });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'AI lines' })).not.toBeChecked();
    expect(screen.getByText(AI_LINES_OFF_LINE)).toBeInTheDocument();
  });

  it('a refusal flips it back and says so in place', async () => {
    stubFetch(403, { ok: false, error: 'not a group admin' });
    render(<AdminHome {...homeProps({ premium: { linesEnabled: false, pausedUntilDay: null } })} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('switch', { name: 'AI lines' }));
    });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(SWITCH_FAILED));
    expect(screen.getByRole('switch', { name: 'AI lines' })).not.toBeChecked();
    expect(screen.getByText(AI_LINES_OFF_LINE)).toBeInTheDocument();
  });
});

describe("members: Don't write about <Name>", () => {
  it('an admin gets it on every other written-about member, never their own row', () => {
    render(
      <MembersTable
        groupId={GROUP.id}
        rows={ROWS}
        viewer={{ role: 'admin', playerId: 'p-member' }}
        aiLines
      />,
    );
    expect(
      within(managed('Hana')).getByRole('button', { name: "Don't write about Hana" }),
    ).toBeInTheDocument();
    expect(within(rowOf('Ramzy')).queryByRole('button', { name: /write about/ })).not.toBeInTheDocument();
  });

  it('an opted-out member reads Not in AI lines, with no way to switch them back on', () => {
    render(
      <MembersTable groupId={GROUP.id} rows={ROWS} viewer={{ role: 'owner', playerId: 'p-owner' }} aiLines />,
    );
    expect(within(rowOf('Bilal')).getByText(NOT_IN_AI_LINES)).toBeInTheDocument();
    expect(within(managed('Bilal')).queryByRole('button', { name: /write about/i })).not.toBeInTheDocument();
  });

  it('the operator gets no control', () => {
    render(<MembersTable groupId={GROUP.id} rows={ROWS} viewer={{ role: 'read-only' }} aiLines />);
    expect(screen.queryByRole('button', { name: /write about/i })).not.toBeInTheDocument();
  });

  it('confirms with focus on Cancel, then posts optOut true only', async () => {
    const fetchMock = stubFetch(200, { ok: true, groupId: GROUP.id, playerId: 'p-member', optOut: true });
    render(
      <MembersTable groupId={GROUP.id} rows={ROWS} viewer={{ role: 'owner', playerId: 'p-owner' }} aiLines />,
    );
    fireEvent.click(within(managed('Ramzy')).getByRole('button', { name: "Don't write about Ramzy" }));
    const dialog = await screen.findByRole('alertdialog', { name: "Don't write about Ramzy?" });
    expect(within(dialog).getByText(dontWriteAboutBody('Ramzy'))).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: "Don't write about them" }));
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/admin/members/ai-opt-out');
    expect(sentBody(fetchMock)).toEqual({ groupId: GROUP.id, playerId: 'p-member', optOut: true });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});

describe('You: AI lines about you', () => {
  it('F2: loaded already off, it says so standing, until a flip', async () => {
    stubFetch(200, { ok: true, groupId: GROUP.id, writeAboutMe: true });
    render(<AiLinesAboutYou groupId={GROUP.id} groupName={GROUP.name} writeAboutMe={false} />);
    expect(screen.getByText("Kustom won't write about you in Friday Five.")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('switch', { name: 'Write about me' }));
    });
    expect(screen.queryByText("Kustom won't write about you in Friday Five.")).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(WRITE_ABOUT_ME_ON_DONE);
  });

  it('Write about me is on by default and never says Premium', () => {
    render(<AiLinesAboutYou groupId={GROUP.id} groupName={GROUP.name} writeAboutMe />);
    expect(screen.getByRole('heading', { name: 'AI lines about you' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Write about me' })).toBeChecked();
    expect(document.body.textContent).not.toMatch(/Premium/);
  });

  it('turning it off posts writeAboutMe false and confirms; back on confirms the other way', async () => {
    const fetchMock = stubFetch(200, { ok: true, groupId: GROUP.id, writeAboutMe: false });
    render(<AiLinesAboutYou groupId={GROUP.id} groupName={GROUP.name} writeAboutMe />);
    await act(async () => {
      fireEvent.click(screen.getByRole('switch', { name: 'Write about me' }));
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/me/ai-opt-out');
    expect(sentBody(fetchMock)).toEqual({ groupId: GROUP.id, writeAboutMe: false });
    expect(screen.getByRole('status')).toHaveTextContent(writeAboutMeOffDone('Friday Five'));
    await act(async () => {
      fireEvent.click(screen.getByRole('switch', { name: 'Write about me' }));
    });
    expect(screen.getByRole('status')).toHaveTextContent(WRITE_ABOUT_ME_ON_DONE);
  });

  it('a failed save flips back and says so', async () => {
    stubFetch(500, { ok: false, error: 'internal error' });
    render(<AiLinesAboutYou groupId={GROUP.id} groupName={GROUP.name} writeAboutMe={false} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('switch', { name: 'Write about me' }));
    });
    expect(screen.getByRole('switch', { name: 'Write about me' })).not.toBeChecked();
    expect(screen.getByRole('alert')).toHaveTextContent(SWITCH_FAILED);
    expect(screen.getByRole('status')).toHaveTextContent('');
  });
});
