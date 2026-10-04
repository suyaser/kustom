import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminNav } from '@/lib/admin/adminNav';
import { deriveChecklist } from '@/lib/admin/checklist';
import { FINISH_TONIGHT_FIRST, ONLY_OWNER_RESETS, RESET_RATINGS_BODY } from '@/lib/admin/homeCopy';
import { AdminHome } from './AdminHome';
import { ResetRatingsCard } from './ResetRatingsCard';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));

/**
 * The owner's `Reset ratings` (M14.18, STRATEGY 3.6): owner only, the typed-link confirm, refusals in
 * place. Role and text queries only.
 */

const GROUP = { id: '11111111-1111-4111-8111-111111111111', slug: 'friday-five', name: 'Friday Five' };
type HomeProps = Extract<ComponentProps<typeof AdminHome>, { kind: 'home' }>;

function home(access: HomeProps['access']) {
  return render(
    <AdminHome
      kind="home"
      group={GROUP}
      access={access}
      checklist={deriveChecklist(
        {
          discord: { webhookSet: false, testPostAt: null, testPostError: null },
          members: 1,
          hosts: [],
          hasGame: false,
        },
        { now: new Date('2026-10-03T21:00:00.000Z'), groupLink: 'kustom.gg/g/friday-five' },
      )}
      discordHref="/g/friday-five/admin/discord"
      invite={{ state: 'shown', url: 'https://kustom.gg/join/x' }}
      origin="https://kustom.gg"
      members={1}
      nav={adminNav(GROUP, 'home')}
      ratingsReset={{ lastResetDay: null }}
    />,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockReset();
});

describe('who sees Reset ratings', () => {
  it('the owner, at the bottom of the admin home', () => {
    home('owner');
    expect(screen.getByRole('heading', { level: 2, name: 'Reset ratings' })).toBeInTheDocument();
    expect(screen.getByText(RESET_RATINGS_BODY)).toBeInTheDocument();
  });

  it('an admin, disabled, with the reason', () => {
    home('admin');
    expect(screen.getByRole('heading', { level: 2, name: 'Reset ratings' })).toBeInTheDocument();
    expect(screen.getByText(ONLY_OWNER_RESETS)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset ratings' })).toBeDisabled();
  });

  it.each(['operator', 'creator-unlinked'] as const)('never %s', (access) => {
    home(access);
    expect(screen.queryByRole('heading', { name: 'Reset ratings' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reset ratings' })).toBeNull();
  });
});

describe('the confirm', () => {
  function open() {
    render(<ResetRatingsCard groupId={GROUP.id} slug={GROUP.slug} lastResetDay="1 Nov" />);
    expect(screen.getByText(`${RESET_RATINGS_BODY} Last reset on 1 Nov.`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reset ratings' }));
    return screen.getByRole('alertdialog');
  }

  it('keeps the action disabled until the group link is typed exactly', () => {
    open();
    const field = screen.getByLabelText('Type friday-five to confirm');
    const action = () => screen.getAllByRole('button', { name: 'Reset ratings' }).at(-1) as HTMLElement;
    expect(action()).toBeDisabled();
    fireEvent.change(field, { target: { value: 'friday-fiv' } });
    expect(action()).toBeDisabled();
    fireEvent.change(field, { target: { value: 'friday-five' } });
    expect(action()).toBeEnabled();
  });

  it('posts the group and the typed link, then closes and refreshes', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    open();
    fireEvent.change(screen.getByLabelText('Type friday-five to confirm'), {
      target: { value: ' friday-five ' },
    });
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Reset ratings' }).at(-1) as HTMLElement);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/ratings/reset',
      expect.objectContaining({ body: JSON.stringify({ groupId: GROUP.id, confirmSlug: 'friday-five' }) }),
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("prints a refusal in place and stays open: Finish tonight's game first.", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ ok: false, error: FINISH_TONIGHT_FIRST }), { status: 409 }),
      ),
    );
    open();
    fireEvent.change(screen.getByLabelText('Type friday-five to confirm'), {
      target: { value: 'friday-five' },
    });
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Reset ratings' }).at(-1) as HTMLElement);
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(FINISH_TONIGHT_FIRST);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
