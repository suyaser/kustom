import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/**
 * `/g/<slug>/mystery`'s frame (M14.38): the page's one h1 names today's game and a back link goes
 * to the group's Tonight. Loaders mocked: what is under test is the page, not the challenge.
 */

const GROUP = { id: '00000000-0000-0000-0000-000000000009', slug: 'thursday-flex', name: 'Thursday Flex' };
vi.mock('@/lib/groups/requirePageGroup', () => ({ requirePageGroup: async () => GROUP }));
vi.mock('@/lib/mystery/load', () => ({
  loadMysteryOrNone: async () => ({
    kind: 'empty',
    empty: { empty: true, expiresAt: '2030-01-01T00:00:00Z' },
  }),
}));

describe('the daily page', () => {
  it("is one h1 for today's game and a back link to the group's Tonight", async () => {
    const { default: Page } = await import('../(group)/g/[slug]/mystery/page');
    render(await Page({ params: Promise.resolve({ slug: GROUP.slug }) }));
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['Daily Mystery']);
    expect(screen.getByRole('link', { name: 'Tonight' })).toHaveAttribute('href', '/g/thursday-flex');
    // The empty card does not repeat the h1 as its own title.
    expect(screen.queryAllByRole('heading', { name: 'Daily Mystery' })).toHaveLength(1);
  });
});
