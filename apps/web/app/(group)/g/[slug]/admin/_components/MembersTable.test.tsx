import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GroupMemberRow } from '@/lib/admin/groupMembers';
import { InviteCard } from './InviteCard';
import { MembersTable } from './MembersTable';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));

/**
 * Members and the invite card (M14.22 acceptance 7, 8, 11; M13.14 acceptance 2): every write opens a
 * confirm with focus on Cancel, posts to its route only from the confirm, and shows a refusal inside
 * the dialog. Role and text queries only.
 */

const GROUP_ID = '11111111-1111-4111-8111-111111111111';
const ROWS: GroupMemberRow[] = [
  {
    playerId: 'p-owner',
    puuid: 'a',
    name: 'Hana',
    named: true,
    role: 'owner',
    games: 40,
    lastPlayedAt: '2026-10-02T20:00:00Z',
    aiOptOut: false,
    discordLinked: false,
  },
  {
    playerId: 'p-admin',
    puuid: 'b',
    name: 'TheSHADOWREAPER',
    named: true,
    role: 'admin',
    games: 33,
    lastPlayedAt: null,
    aiOptOut: false,
    discordLinked: false,
  },
  {
    playerId: 'p-member',
    puuid: 'c',
    name: 'Ramzyinhović',
    named: true,
    role: 'member',
    games: 0,
    lastPlayedAt: null,
    aiOptOut: false,
    discordLinked: false,
  },
];

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

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

describe('the members list', () => {
  it('roles in words, last played, games; the owner row has a note and no remove', () => {
    render(<MembersTable groupId={GROUP_ID} rows={ROWS} viewer={{ role: 'owner', playerId: 'p-owner' }} />);
    expect(within(rowOf('Hana')).getByText('Owner')).toBeInTheDocument();
    // N2: the name, then the `you` chip.
    expect(within(rowOf('Hana')).getByText('You')).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Hana You' })).toBeInTheDocument();
    expect(within(rowOf('Hana')).getByText('2 Oct 2026')).toBeInTheDocument();
    expect(within(rowOf('Hana')).queryByRole('button')).not.toBeInTheDocument();
    expect(
      within(rowOf('Hana')).getByText("You're the owner. To step back, make an admin the owner."),
    ).toBeInTheDocument();
    expect(within(rowOf('Ramzyinhović')).getByText('Not yet')).toBeInTheDocument();
    expect(
      within(managed('TheSHADOWREAPER')).getByRole('button', { name: 'Remove from group' }),
    ).toBeInTheDocument();
    expect(
      within(managed('TheSHADOWREAPER')).getByRole('button', { name: 'Make owner' }),
    ).toBeInTheDocument();
  });

  it('an admin sees no remove on another admin, and Make admin / Remove on a member', () => {
    render(<MembersTable groupId={GROUP_ID} rows={ROWS} viewer={{ role: 'admin', playerId: 'p-admin' }} />);
    expect(within(rowOf('TheSHADOWREAPER')).queryByRole('button')).not.toBeInTheDocument();
    expect(within(managed('Ramzyinhović')).getByRole('button', { name: 'Make admin' })).toBeInTheDocument();
    expect(
      within(managed('Ramzyinhović')).getByRole('button', { name: 'Remove from group' }),
    ).toBeInTheDocument();
  });

  it('admin round 2: a row with no name yet reads Someone, with the hint once and no PUUID fragment', () => {
    const unnamed = [
      { ...ROWS[0], puuid: '34151cbd-0000', name: 'Someone', named: false } as GroupMemberRow,
      {
        ...ROWS[2],
        playerId: 'p-anon',
        puuid: '99aa77ff-0000',
        name: 'Someone',
        named: false,
      } as GroupMemberRow,
      ...ROWS.slice(1),
    ];
    render(
      <MembersTable groupId={GROUP_ID} rows={unnamed} viewer={{ role: 'owner', playerId: 'p-owner' }} />,
    );
    expect(screen.getByRole('rowheader', { name: 'Someone You' })).toBeInTheDocument();
    expect(screen.queryByText(/Not linked yet/)).not.toBeInTheDocument();
    expect(screen.getAllByText("Names fill in after someone's first game.")).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(/34151cbd|99aa77ff/);
    // Two `Someone`s are told apart by their place in the whole list; named rows keep their name.
    expect(screen.getByRole('button', { name: 'Manage Someone, row 2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manage TheSHADOWREAPER' })).toBeInTheDocument();
    // `this player` only inside the sentences.
    fireEvent.click(screen.getByRole('button', { name: 'Manage Someone, row 2' }));
    expect(screen.getByRole('button', { name: 'Remove from group' })).toBeInTheDocument();
  });

  it('no hint when everyone has a name', () => {
    render(<MembersTable groupId={GROUP_ID} rows={ROWS} viewer={{ role: 'read-only' }} />);
    expect(screen.queryByText("Names fill in after someone's first game.")).not.toBeInTheDocument();
  });

  it('the operator: no actions column, no buttons', () => {
    render(<MembersTable groupId={GROUP_ID} rows={ROWS} viewer={{ role: 'read-only' }} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Actions' })).not.toBeInTheDocument();
  });

  it('Remove opens a confirm with focus on Cancel; nothing is posted until the action is pressed', async () => {
    const fetchMock = stubFetch(200, { ok: true, groupId: GROUP_ID, playerId: 'p-member' });
    render(<MembersTable groupId={GROUP_ID} rows={ROWS} viewer={{ role: 'owner', playerId: 'p-owner' }} />);
    fireEvent.click(within(managed('Ramzyinhović')).getByRole('button', { name: 'Remove from group' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(
      within(dialog).getByRole('heading', { name: 'Remove Ramzyinhović from the group?' }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Ramzyinhović leaves the board. Their games stay in history. If they play with you again, they're back.",
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus());
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Remove from group' }));
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/members/remove',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ groupId: GROUP_ID, playerId: 'p-member' }),
      }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it.each([
    ['Make admin', 'Ramzyinhović', '/api/admin/members/role', { playerId: 'p-member', role: 'admin' }],
    ['Make member', 'TheSHADOWREAPER', '/api/admin/members/role', { playerId: 'p-admin', role: 'member' }],
    ['Make owner', 'TheSHADOWREAPER', '/api/admin/owner/transfer', { playerId: 'p-admin' }],
  ])('%s confirms first (focus on Cancel), then posts to its route', async (label, name, url, body) => {
    const fetchMock = stubFetch(200, { ok: true });
    render(<MembersTable groupId={GROUP_ID} rows={ROWS} viewer={{ role: 'owner', playerId: 'p-owner' }} />);
    fireEvent.click(within(managed(name)).getByRole('button', { name: label }));
    const dialog = await screen.findByRole('alertdialog');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus());
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: label }));
    });
    expect(fetchMock).toHaveBeenCalledWith(
      url,
      expect.objectContaining({ body: JSON.stringify({ groupId: GROUP_ID, ...body }) }),
    );
  });

  it('a refusal stays in the dialog, in the route’s words', async () => {
    stubFetch(409, { ok: false, error: 'This group needs at least one admin.' });
    render(<MembersTable groupId={GROUP_ID} rows={ROWS} viewer={{ role: 'owner', playerId: 'p-owner' }} />);
    fireEvent.click(within(managed('TheSHADOWREAPER')).getByRole('button', { name: 'Make member' }));
    const dialog = await screen.findByRole('alertdialog');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Make member' }));
    });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This group needs at least one admin.',
    );
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('M14.60: Unlink Discord in the Manage panel', () => {
  const LINKED = ROWS.map((row) => ({ ...row, discordLinked: true }));
  const ownerViews = (rows: GroupMemberRow[]) =>
    render(<MembersTable groupId={GROUP_ID} rows={rows} viewer={{ role: 'owner', playerId: 'p-owner' }} />);

  it('shows only when a Discord account is linked to the player', () => {
    const rows = LINKED.map((row) => (row.playerId === 'p-member' ? { ...row, discordLinked: false } : row));
    ownerViews(rows);
    expect(
      within(managed('TheSHADOWREAPER')).getByRole('button', { name: 'Unlink Discord' }),
    ).toBeInTheDocument();
    expect(
      within(managed('Ramzyinhović')).queryByRole('button', { name: 'Unlink Discord' }),
    ).not.toBeInTheDocument();
  });

  it('an admin gets it on a member and on their own row, never on the owner or another admin', () => {
    const rows = [
      ...LINKED,
      { ...LINKED[1], playerId: 'p-admin-2', name: 'Ada', puuid: 'e' } as GroupMemberRow,
    ];
    render(<MembersTable groupId={GROUP_ID} rows={rows} viewer={{ role: 'admin', playerId: 'p-admin' }} />);
    expect(
      within(managed('Ramzyinhović')).getByRole('button', { name: 'Unlink Discord' }),
    ).toBeInTheDocument();
    expect(
      within(managed('TheSHADOWREAPER')).getByRole('button', { name: 'Unlink Discord' }),
    ).toBeInTheDocument();
    expect(within(rowOf('Hana')).queryByRole('button')).not.toBeInTheDocument();
    expect(within(rowOf('Ada')).queryByRole('button')).not.toBeInTheDocument();
  });

  it("the owner's own row has no Unlink (they hand ownership on first): just the note", () => {
    ownerViews(LINKED);
    expect(within(rowOf('Hana')).queryByRole('button')).not.toBeInTheDocument();
    expect(
      within(rowOf('Hana')).getByText("You're the owner. To step back, make an admin the owner."),
    ).toBeInTheDocument();
  });

  it('a member: confirm first with focus on Cancel, the tap-your-name body, then the post', async () => {
    const fetchMock = stubFetch(200, { ok: true, groupId: GROUP_ID, playerId: 'p-member', changed: true });
    ownerViews(LINKED);
    fireEvent.click(within(managed('Ramzyinhović')).getByRole('button', { name: 'Unlink Discord' }));

    const dialog = await screen.findByRole('alertdialog', { name: "Unlink Ramzyinhović's Discord?" });
    expect(
      within(dialog).getByText(
        "They link again by signing in and tapping their name at their next game. Their games and Rating stay. This unlinks them in every group they're in, not just this one.",
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus());
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Unlink Discord' }));
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/members/unlink-discord',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ groupId: GROUP_ID, playerId: 'p-member' }),
      }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('another admin (the owner looking): the pair-again body, no tap for admins', async () => {
    ownerViews(LINKED);
    fireEvent.click(within(managed('TheSHADOWREAPER')).getByRole('button', { name: 'Unlink Discord' }));
    const dialog = await screen.findByRole('alertdialog', { name: "Unlink TheSHADOWREAPER's Discord?" });
    expect(
      within(dialog).getByText(
        "They'll need the group's invite link to pair Kustom again with a new code. Tapping their name won't work for an admin. Their games and Rating stay. This unlinks them in every group they're in, not just this one.",
      ),
    ).toBeInTheDocument();
  });

  it('an admin on their own row: your Discord, you lose these pages, copy the invite link first', async () => {
    render(<MembersTable groupId={GROUP_ID} rows={LINKED} viewer={{ role: 'admin', playerId: 'p-admin' }} />);
    fireEvent.click(within(managed('TheSHADOWREAPER')).getByRole('button', { name: 'Unlink Discord' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Unlink your Discord?' });
    expect(
      within(dialog).getByText(
        "You'll lose these admin pages until you pair Kustom again with a new code from the group's invite link, so copy it first. Tapping your name won't work for an admin. Your games and Rating stay. This unlinks you in every group you're in, not just this one.",
      ),
    ).toBeInTheDocument();
  });

  it('while it posts, the action reads Unlinking…', async () => {
    let release: (value: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      ),
    );
    ownerViews(LINKED);
    fireEvent.click(within(managed('Ramzyinhović')).getByRole('button', { name: 'Unlink Discord' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Unlink Discord' }));
    expect(await within(dialog).findByRole('button', { name: 'Unlinking…' })).toBeInTheDocument();
    await act(async () => {
      release(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    });
  });

  it("a refusal stays in the dialog, in the route's words", async () => {
    stubFetch(403, { ok: false, error: 'Hand ownership to an admin before you unlink your own Discord.' });
    ownerViews(LINKED);
    fireEvent.click(within(managed('TheSHADOWREAPER')).getByRole('button', { name: 'Unlink Discord' }));
    const dialog = await screen.findByRole('alertdialog');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Unlink Discord' }));
    });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Hand ownership to an admin before you unlink your own Discord.',
    );
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('M14.52: finding someone at 375', () => {
  const many: GroupMemberRow[] = Array.from({ length: 40 }, (_, index) => ({
    playerId: `p-${index}`,
    puuid: `puuid-${index}`,
    name: index === 0 ? 'Hana' : `Friend ${String(index).padStart(2, '0')}`,
    named: true,
    role: index === 0 ? 'owner' : 'member',
    games: index,
    lastPlayedAt: null,
    aiOptOut: false,
    discordLinked: false,
  }));

  it('each row is one Manage toggle, not a row of buttons, until it is opened', () => {
    render(<MembersTable groupId={GROUP_ID} rows={many} viewer={{ role: 'owner', playerId: 'p-0' }} />);
    const row = rowOf('Friend 30');
    const buttons = within(row).getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName('Manage Friend 30');
    expect(buttons[0]).toHaveAttribute('aria-expanded', 'false');
    expect(within(row).getByText('30 games')).toBeInTheDocument();
    fireEvent.click(buttons[0] as HTMLElement);
    expect(buttons[0]).toHaveAttribute('aria-expanded', 'true');
    expect(within(row).getByRole('button', { name: 'Make admin' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Remove from group' })).toBeInTheDocument();
    // One row open at a time.
    fireEvent.click(within(rowOf('Friend 31')).getByRole('button', { name: /^Manage/ }));
    expect(within(rowOf('Friend 30')).queryByRole('button', { name: 'Make admin' })).not.toBeInTheDocument();
  });

  it('Find someone filters as you type, with no request, and says when nobody matches', () => {
    const fetchMock = stubFetch(200, {});
    render(<MembersTable groupId={GROUP_ID} rows={many} viewer={{ role: 'owner', playerId: 'p-0' }} />);
    expect(screen.getAllByRole('rowheader')).toHaveLength(40);
    const find = screen.getByRole('searchbox', { name: 'Find someone' });
    fireEvent.change(find, { target: { value: 'friend 3' } });
    expect(screen.getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual([
      'Friend 30',
      'Friend 31',
      'Friend 32',
      'Friend 33',
      'Friend 34',
      'Friend 35',
      'Friend 36',
      'Friend 37',
      'Friend 38',
      'Friend 39',
    ]);
    expect(screen.getByRole('status')).toHaveTextContent('10 people');
    fireEvent.change(find, { target: { value: 'zzz' } });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Nobody called “zzz” in this group.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('making the 30th member an admin: type, Manage, Make admin, confirm', async () => {
    const fetchMock = stubFetch(200, { ok: true });
    render(<MembersTable groupId={GROUP_ID} rows={many} viewer={{ role: 'owner', playerId: 'p-0' }} />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find someone' }), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Manage Friend 30' }));
    fireEvent.click(screen.getByRole('button', { name: 'Make admin' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Make Friend 30 an admin?' });
    // M14.55: the confirm says what an admin can do now that rules exist.
    expect(
      within(dialog).getByText('They can roll teams, set the mode or a rule, and open these admin pages.'),
    ).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Make admin' }));
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/members/role',
      expect.objectContaining({
        body: JSON.stringify({ groupId: GROUP_ID, playerId: 'p-30', role: 'admin' }),
      }),
    );
  });
});

describe('design round 1', () => {
  it('F4: Clear empties the search and puts focus back in it; hidden while empty', () => {
    render(<MembersTable groupId={GROUP_ID} rows={ROWS} viewer={{ role: 'owner', playerId: 'p-owner' }} />);
    const find = screen.getByRole('searchbox', { name: 'Find someone' });
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
    fireEvent.change(find, { target: { value: 'ram' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(find).toHaveValue('');
    expect(find).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('rowheader')).toHaveLength(3);
  });

  it("N3: an admin doesn't get the owner's note", () => {
    render(<MembersTable groupId={GROUP_ID} rows={ROWS} viewer={{ role: 'admin', playerId: 'p-admin' }} />);
    expect(screen.queryByText(/You're the owner/)).not.toBeInTheDocument();
  });

  it('N4: the panel reads role change, then Don’t write about, then Remove last', () => {
    render(
      <MembersTable groupId={GROUP_ID} rows={ROWS} viewer={{ role: 'owner', playerId: 'p-owner' }} aiLines />,
    );
    const names = within(managed('TheSHADOWREAPER'))
      .getAllByRole('button')
      .map((button) => button.textContent)
      .slice(1);
    expect(names).toEqual([
      'Make member',
      'Make owner',
      "Don't write about TheSHADOWREAPER",
      'Remove from group',
    ]);
  });

  it('M14.69: the roster-wide suffix prints muted after the name; Find someone matches the plain name', () => {
    const twins: GroupMemberRow[] = [
      ...ROWS,
      {
        ...(ROWS[2] as GroupMemberRow),
        playerId: 'p-twin-a',
        name: 'Player3',
        tagLine: 'EUW',
        nameSuffix: '#EUW',
      },
      {
        ...(ROWS[2] as GroupMemberRow),
        playerId: 'p-twin-b',
        name: 'Player3',
        tagLine: 'EUNE',
        nameSuffix: '#EUNE',
      },
      { ...(ROWS[2] as GroupMemberRow), playerId: 'p-num', name: 'Ali', tagLine: 'EUW', nameSuffix: '(2)' },
      { ...(ROWS[2] as GroupMemberRow), playerId: 'p-solo', name: 'Solo', tagLine: 'EUW', nameSuffix: null },
    ];
    render(<MembersTable groupId={GROUP_ID} rows={twins} viewer={{ role: 'read-only' }} />);
    expect(screen.getByRole('rowheader', { name: 'Player3 #EUW' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Player3 #EUNE' })).toBeInTheDocument();
    const ali = screen.getByRole('rowheader', { name: 'Ali (2)' });
    expect(within(ali).getByText('(2)')).toHaveClass('font-normal');
    expect(screen.getByRole('rowheader', { name: 'Solo' })).toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: /Find someone/ }), { target: { value: 'ali' } });
    expect(screen.getByRole('rowheader', { name: 'Ali (2)' })).toBeInTheDocument();
  });

  it('M14.69: no suffix on a name that is already a Riot ID, or on Someone', () => {
    const rows: GroupMemberRow[] = [
      {
        ...(ROWS[2] as GroupMemberRow),
        playerId: 'p-rid',
        name: 'Player7#EUW',
        tagLine: 'EUW',
        nameSuffix: '#EUW',
      },
      { ...(ROWS[2] as GroupMemberRow), playerId: 'p-n1', name: 'Someone', named: false, nameSuffix: null },
    ];
    render(<MembersTable groupId={GROUP_ID} rows={rows} viewer={{ role: 'read-only' }} />);
    expect(screen.getByRole('rowheader', { name: 'Player7#EUW' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Someone' })).toBeInTheDocument();
  });

  it('dates read 8 Sep, in the group time zone (design review)', () => {
    const rows: GroupMemberRow[] = [
      {
        ...(ROWS[2] as GroupMemberRow),
        playerId: 'p-d',
        name: 'Dated',
        lastPlayedAt: '2026-09-08T18:00:00Z',
      },
    ];
    render(
      <MembersTable groupId={GROUP_ID} rows={rows} viewer={{ role: 'read-only' }} timeZone="Africa/Cairo" />,
    );
    expect(screen.getByText('8 Sep')).toBeInTheDocument();
    expect(screen.getByText('8 Sep 2026')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('Sept');
  });
});

describe('the invite card', () => {
  it('New link confirms (focus on Cancel), rotates, and shows the new link in place', async () => {
    const fetchMock = stubFetch(200, { ok: true, groupId: GROUP_ID, code: 'ZyXwVuTsRqPoNmLkJiHgFe' });
    render(
      <InviteCard
        groupId={GROUP_ID}
        origin="https://kustom.gg"
        invite={{ state: 'shown', url: 'https://kustom.gg/join/AbCdEfGhIjKlMnOpQrStUv' }}
        canRotate
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'New link' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('The old link will stop working.')).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus());
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Make a new link' }));
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/invite/rotate',
      expect.objectContaining({ body: JSON.stringify({ groupId: GROUP_ID }) }),
    );
    expect(await screen.findByText('https://kustom.gg/join/ZyXwVuTsRqPoNmLkJiHgFe')).toBeInTheDocument();
  });

  it('a session expiry inside the confirm reads as a person would want', async () => {
    stubFetch(401, { ok: false, error: 'sign in required' });
    render(
      <InviteCard
        groupId={GROUP_ID}
        origin="https://kustom.gg"
        invite={{ state: 'shown', url: 'x' }}
        canRotate
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'New link' }));
    const dialog = await screen.findByRole('alertdialog');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Make a new link' }));
    });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Your sign-in ran out. Sign in again.',
    );
  });
});
