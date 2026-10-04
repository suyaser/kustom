import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HOSTS_EMPTY, HOSTS_INTRO, REVOKE_BODY } from '@/lib/admin/sectionCopy';
import { type HostRow, HostsView } from './HostsView';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));

/**
 * Hosts (M14.23 acceptance 6 and 7): stop behind a confirm, no developer words. M17.12 (Kustom 1.0): no
 * hand-made key, no paste; every host links itself with a code from the admin home.
 */

const GROUP_ID = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-10-03T21:00:00.000Z');
const HOSTS: HostRow[] = [
  {
    id: '22222222-2222-4222-8222-222222222222',
    person: 'Hana#EUW',
    account: 'Hana',
    label: 'Kustom (paired)',
    createdAt: '2026-10-01T20:00:00Z',
    lastSeenAt: '2026-10-03T20:58:00Z',
    stopped: false,
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    person: 'TheSHADOWREAPER',
    account: null,
    label: null,
    createdAt: '2026-09-01T20:00:00Z',
    lastSeenAt: null,
    stopped: true,
  },
  {
    id: '66666666-6666-4666-8666-666666666666',
    person: 'Ramzyinhović',
    account: 'Ramzyinhović',
    label: 'Ramzy’s laptop',
    createdAt: '2026-09-02T20:00:00Z',
    lastSeenAt: '2026-09-20T20:00:00Z',
    stopped: false,
  },
];

const rowOf = (name: string) => screen.getByRole('rowheader', { name }).closest('[role=row]') as HTMLElement;

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockReset();
});

describe('the Hosts page', () => {
  it('lists hosts in words: <Account>’s PC, a typed name, Unnamed PC, last seen, Working / Stopped', () => {
    render(
      <HostsView
        groupId={GROUP_ID}
        hostCardHref="/g/x/admin#host"
        hosts={HOSTS}
        readOnly={false}
        now={NOW}
      />,
    );
    expect(within(rowOf('Hana’s PC')).getByText('2 minutes ago')).toBeInTheDocument();
    expect(within(rowOf('Hana’s PC')).getByText('Working')).toBeInTheDocument();
    expect(within(rowOf('Hana’s PC')).getByText('Hana#EUW')).toBeInTheDocument();
    expect(within(rowOf('Ramzy’s laptop')).getByText('Working')).toBeInTheDocument();
    // M14.71: a host never seen reads `Not seen yet`, never a bare `Never`.
    expect(within(rowOf('Unnamed PC')).getByText('Not seen yet')).toBeInTheDocument();
    expect(within(rowOf('Unnamed PC')).queryByText('Never')).not.toBeInTheDocument();
    expect(within(rowOf('Unnamed PC')).getByText('Stopped')).toBeInTheDocument();
    expect(within(rowOf('Unnamed PC')).queryByRole('button')).not.toBeInTheDocument();
  });

  it('never says This PC (M14.50)', () => {
    const { container } = render(
      <HostsView
        groupId={GROUP_ID}
        hostCardHref="/g/x/admin#host"
        hosts={HOSTS}
        readOnly={false}
        now={NOW}
      />,
    );
    expect(container.textContent).not.toContain('This PC');
  });

  it('folds stopped hosts under a closed Stopped (N) disclosure (M14.50)', () => {
    render(
      <HostsView
        groupId={GROUP_ID}
        hostCardHref="/g/x/admin#host"
        hosts={HOSTS}
        readOnly={false}
        now={NOW}
      />,
    );
    const summary = screen.getByText('Stopped (1)');
    const fold = summary.closest('details') as HTMLDetailsElement;
    expect(fold.open).toBe(false);
    expect(within(fold).getByRole('rowheader', { name: 'Unnamed PC' })).toBeInTheDocument();
    // The working list above holds only the working hosts.
    const working = screen.getByRole('table', { name: 'Hosts' });
    expect(within(working).queryByRole('rowheader', { name: 'Unnamed PC' })).not.toBeInTheDocument();
    expect(within(working).getByRole('rowheader', { name: 'Hana’s PC' })).toBeInTheDocument();
  });

  it('no fold when nothing is stopped, and the empty line when only stopped hosts are left', () => {
    const { unmount } = render(
      <HostsView
        groupId={GROUP_ID}
        hostCardHref="/g/x/admin#host"
        hosts={HOSTS.filter((host) => !host.stopped)}
        readOnly={false}
        now={NOW}
      />,
    );
    expect(screen.queryByText(/^Stopped \(/)).not.toBeInTheDocument();
    unmount();
    render(
      <HostsView
        groupId={GROUP_ID}
        hostCardHref="/g/x/admin#host"
        hosts={HOSTS.filter((host) => host.stopped)}
        readOnly={false}
        now={NOW}
      />,
    );
    expect(screen.getByText(HOSTS_EMPTY)).toBeInTheDocument();
    expect(screen.getByText('Stopped (1)')).toBeInTheDocument();
  });

  it('Stop this host opens a confirm with focus on Cancel, then posts the revoke', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <HostsView
        groupId={GROUP_ID}
        hostCardHref="/g/x/admin#host"
        hosts={HOSTS}
        readOnly={false}
        now={NOW}
      />,
    );
    fireEvent.click(within(rowOf('Hana’s PC')).getByRole('button', { name: 'Stop this host' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByRole('heading', { name: 'Stop Hana’s PC?' })).toBeInTheDocument();
    expect(within(dialog).getByText(REVOKE_BODY)).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus());
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Stop this host' }));
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/tokens',
      expect.objectContaining({
        body: JSON.stringify({ action: 'revoke', groupId: GROUP_ID, tokenId: HOSTS[0]?.id }),
      }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('says no paste and no key, and sends a new host to the admin home for a code (M17.12)', () => {
    const { container } = render(
      <HostsView
        groupId={GROUP_ID}
        hostCardHref="/g/x/admin#host"
        hosts={HOSTS}
        readOnly={false}
        now={NOW}
      />,
    );
    expect(container.querySelector('p')).toHaveTextContent(HOSTS_INTRO);
    expect(screen.getByRole('link', { name: 'admin home' })).toHaveAttribute('href', '/g/x/admin#host');
    expect(screen.queryByText('Add a host by hand')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    // Every button is a row's stop; nothing makes a host here.
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Stop this host',
      'Stop this host',
    ]);
    const words = [
      container.textContent ?? '',
      ...[...container.querySelectorAll('[aria-label],[title],[placeholder]')].map((element) =>
        ['aria-label', 'title', 'placeholder'].map((name) => element.getAttribute(name) ?? '').join(' '),
      ),
    ].join(' ');
    expect(words).not.toMatch(/paste|key/i);
  });

  it('the stop confirm says no key either: the PC comes back with a code', async () => {
    render(
      <HostsView
        groupId={GROUP_ID}
        hostCardHref="/g/x/admin#host"
        hosts={HOSTS}
        readOnly={false}
        now={NOW}
      />,
    );
    fireEvent.click(within(rowOf('Hana’s PC')).getByRole('button', { name: 'Stop this host' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).not.toMatch(/paste|key/i);
    expect(within(dialog).getByText(REVOKE_BODY)).toBeInTheDocument();
    expect(REVOKE_BODY).toBe(
      'Kustom on that PC stops recording games until someone sets it up again with a code.',
    );
  });

  it('says nothing a developer would: no revoked_at, pnpm, token hash, or ids', () => {
    const { container } = render(
      <HostsView
        groupId={GROUP_ID}
        hostCardHref="/g/x/admin#host"
        hosts={HOSTS}
        readOnly={false}
        now={NOW}
      />,
    );
    expect(container.textContent).not.toMatch(/revoked_at|last_seen_at|pnpm|hash|token|puuid|snowflake/i);
    expect(container.textContent).not.toMatch(/fearless|\bmode\b/i);
    expect(container.textContent).not.toContain(HOSTS[0]?.id ?? 'x');
  });

  it('the operator reads the list with no stop and no mint', () => {
    render(<HostsView groupId={GROUP_ID} hostCardHref="/g/x/admin#host" hosts={HOSTS} readOnly now={NOW} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText('Add a host by hand')).not.toBeInTheDocument();
  });
});
