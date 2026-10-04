import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { adminNav } from '@/lib/admin/adminNav';
import type { CapturedGameRow, RatedReason } from '@/lib/admin/games';
import { GamesView } from './GamesView';

/** Recording (M14.53): the Rated column says why, never `Not yet`; the page is not called Games. */

const GROUP = { id: '11111111-1111-4111-8111-111111111111', slug: 'friday-five', name: 'Friday five' };

const REASONS: [RatedReason, string][] = [
  [{ kind: 'rated' }, 'Yes'],
  [{ kind: 'aram' }, 'No · ARAM'],
  [{ kind: 'rule', rule: { id: 'class', tag: 'Tank' } }, 'No · Tanks only'],
  [{ kind: 'switched-off' }, 'No · Rated was off'],
  [{ kind: 'gate' }, 'No · too short or not ten players'],
  [{ kind: 'waiting' }, 'Waiting to be counted'],
];

const ROWS: CapturedGameRow[] = REASONS.map(([reason], index) => ({
  id: `00000000-0000-4000-8000-00000000000${index}`,
  lcuGameId: String(9000 + index),
  night: 'Sat 3 Oct',
  startedAt: `21:0${index}`,
  duration: '30 min',
  source: 'eog',
  participants: 10,
  rated: reason.kind === 'rated',
  ratedReason: reason,
  partyId: null,
}));

describe('the Recording page', () => {
  it('says why each game is or is not rated, and never Not yet', () => {
    const { container } = render(
      <GamesView group={GROUP} missed={{ rows: [], total: 0, cap: 100 }} captured={ROWS} />,
    );
    const table = screen.getByRole('table', { name: 'Captured' });
    REASONS.forEach(([, text], index) => {
      const row = within(table)
        .getByRole('rowheader', { name: `Sat 3 Oct, 21:0${index}` })
        .closest('[role=row]');
      expect(within(row as HTMLElement).getByText(text)).toBeInTheDocument();
    });
    expect(container.textContent).not.toMatch(/not yet/i);
  });

  it('opens with the page line and drops the recalculation copy', () => {
    const { container } = render(
      <GamesView group={GROUP} missed={{ rows: [], total: 0, cap: 100 }} captured={ROWS} />,
    );
    expect(screen.getByText('Every game Kustom saw, and any it missed.')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/recalculat/i);
  });

  it('is Recording in the admin nav, at the same URL', () => {
    const link = adminNav(GROUP, 'games').find((item) => item.current);
    expect(link).toEqual({ label: 'Recording', href: '/g/friday-five/admin/games', current: true });
    expect(adminNav(GROUP, 'home').map((item) => item.label)).not.toContain('Games');
  });
});
