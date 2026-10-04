import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewerState } from '@/lib/tonight/viewer';

/**
 * The no-JS Reset confirm page's gate (M14.30): admins and the owner get the question and a POST
 * form back to Tonight; everybody else gets a 404, exactly as if the page did not exist.
 */

const GROUP = { id: '22222222-2222-4222-8222-222222222222', slug: 'thursday-flex', name: 'Thursday Flex' };
const viewer = vi.hoisted(() => ({ current: { kind: 'anonymous' } as ViewerState & { isOwner?: boolean } }));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('@/lib/groups/requirePageGroup', () => ({ requirePageGroup: vi.fn(async () => GROUP) }));
vi.mock('@/lib/viewer', () => ({ currentViewerState: vi.fn(async () => viewer.current) }));
vi.mock('@/lib/publicClient', () => ({ createPublicClient: () => ({}) }));
vi.mock('@/lib/fearless/load', () => ({
  loadFearless: vi.fn(async () => ({
    mode: 'fearless',
    resetAt: null,
    champions: [
      { id: 103, name: 'Ahri', role: 'mid' },
      { id: 222, name: 'Jinx', role: 'adc' },
    ],
  })),
}));

const { default: ResetFearlessConfirm } = await import('./page');

async function open(): Promise<void> {
  const page = await ResetFearlessConfirm({ params: Promise.resolve({ slug: GROUP.slug }) });
  render(page);
}

beforeEach(() => {
  viewer.current = { kind: 'anonymous' };
});

describe('the reset confirm page', () => {
  it.each<[string, ViewerState]>([
    ['a visitor', { kind: 'anonymous' }],
    ['a signed-in visitor with no player row', { kind: 'unlinked', claimable: [] }],
    ['a member', { kind: 'linked', puuid: 'p1', isAdmin: false }],
  ])('is a 404 for %s', async (_who, state) => {
    viewer.current = state;
    await expect(open()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it.each<[string, ViewerState & { isOwner?: boolean }]>([
    ['an admin', { kind: 'linked', puuid: 'p1', isAdmin: true }],
    ['the owner', { kind: 'linked', puuid: 'p1', isAdmin: true, isOwner: true }],
  ])('asks %s, and posts the reset back to Tonight', async (_who, state) => {
    viewer.current = state;
    await open();
    expect(screen.getByRole('heading', { level: 1, name: 'Reset the fearless pool?' })).toBeInTheDocument();
    expect(screen.getByText(/All 2 bans are cleared/)).toBeInTheDocument();
    const form = screen.getByRole('button', { name: 'Reset fearless' }).closest('form');
    expect(form).toHaveAttribute('method', 'post');
    expect(form).toHaveAttribute('action', '/api/admin/fearless/reset');
    expect(form?.querySelector('input[name="groupId"]')).toHaveValue(GROUP.id);
    expect(form?.querySelector('input[name="redirectTo"]')).toHaveValue('/g/thursday-flex');
    expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute('href', '/g/thursday-flex');
  });
});
