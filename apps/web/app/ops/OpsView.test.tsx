import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OpsView } from './OpsView';

const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});
vi.mock('next/navigation', () => ({ notFound: () => notFound() }));
const currentOperator = vi.fn();
vi.mock('@/lib/ops/operator', () => ({ currentOperator: () => currentOperator() }));
vi.mock('@/lib/ops/groups', () => ({ listOpsGroups: async () => [] }));
vi.mock('@/lib/supabase', () => ({ getServiceClient: () => ({}) }));

/** `/ops` (M13.14 acceptance 4, M14.23 acceptance 10): the table for the operator, a 404 for anyone else. */

const GROUPS = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'customs',
    name: 'Customs Night',
    createdAt: '2026-09-01T10:00:00Z',
    memberCount: 23,
    adminCount: 2,
    lastGameAt: '2026-10-03T19:00:00Z',
    webhookSet: true,
    premium: { premium: true, premiumChangedAt: '2026-10-04T09:00:00Z', monthlyCapUsd: 2 },
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    slug: 'friday-five',
    name: 'Friday Five',
    createdAt: '2026-10-03T10:00:00Z',
    memberCount: 1,
    adminCount: 1,
    lastGameAt: null,
    webhookSet: false,
    premium: { premium: false, premiumChangedAt: null, monthlyCapUsd: 2.5 },
  },
];

describe('/ops', () => {
  it('lists every group with its numbers, each linking to its admin pages; no write, no mode control', () => {
    const { container } = render(<OpsView groups={GROUPS} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('All groups');
    const row = screen.getByRole('rowheader', { name: /Friday Five/ }).closest('[role=row]') as HTMLElement;
    expect(within(row).getByText('None yet')).toBeInTheDocument();
    expect(within(row).getByText('Not connected')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'Open admin: Friday Five' })).toHaveAttribute(
      'href',
      '/g/friday-five/admin',
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/fearless|\bmode\b/i);
  });

  it('shows Premium read-only for each group: on or off, since when, the monthly cap (M16.2)', () => {
    render(<OpsView groups={GROUPS} />);
    const on = screen.getByRole('rowheader', { name: /Customs Night/ }).closest('[role=row]') as HTMLElement;
    expect(within(on).getByText('On since 4 Oct 2026')).toBeInTheDocument();
    expect(within(on).getByText('$2.00 a month cap')).toBeInTheDocument();
    const off = screen.getByRole('rowheader', { name: /Friday Five/ }).closest('[role=row]') as HTMLElement;
    expect(within(off).getByText('Off')).toBeInTheDocument();
    expect(within(off).getByText('$2.50 a month cap')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('M16.10: a group at its monthly cap reads Paused · cap reached; a group under it does not', () => {
    const [capped, under] = GROUPS as [(typeof GROUPS)[number], (typeof GROUPS)[number]];
    render(
      <OpsView
        groups={[
          { ...capped, aiCapReached: true },
          { ...under, aiCapReached: false },
        ]}
      />,
    );
    const at = screen.getByRole('rowheader', { name: /Customs Night/ }).closest('[role=row]') as HTMLElement;
    expect(within(at).getByText('Paused · cap reached')).toBeInTheDocument();
    const below = screen.getByRole('rowheader', { name: /Friday Five/ }).closest('[role=row]') as HTMLElement;
    expect(within(below).queryByText('Paused · cap reached')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('is a 404 for everyone who is not the operator', async () => {
    const { default: OpsPage } = await import('./page');
    for (const status of [401, 403] as const) {
      currentOperator.mockResolvedValueOnce({ ok: false, status, error: 'operator only' });
      await expect(OpsPage()).rejects.toThrow('NEXT_NOT_FOUND');
    }
    currentOperator.mockResolvedValueOnce({ ok: true, operator: { userId: 'u', email: null } });
    await expect(OpsPage()).resolves.toBeTruthy();
  });
});
