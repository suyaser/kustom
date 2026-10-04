import { render, screen, within } from '@testing-library/react';
import type { Route } from 'next';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AiRecap } from '@/components/ai/AiRecap';
import { AI_RECAP_TAP, AI_STORYLINE_TAP } from '@/lib/ai/recapCopy';
import type { WindowKind } from '@/lib/night';
import { workedWindowBoard } from '@/lib/testing/boardFixtures';
import { BoardView } from './BoardView';

/**
 * M16.5: the weekly storyline on the board, under the window header and above the list, on
 * `Last week` only; the admin's `Hide` beside it for admins and the owner, never for a member.
 * Role and text queries only.
 */

const PATH = '/g/customs/leaderboard';
const GROUP_ID = '00000000-0000-4000-8000-00000000000a';
const LINE_ID = '10000000-0000-4000-8000-000000000001';
const TEXT = 'Nadia took the week with 5 wins from 6 games, and Yuki won 4 in a row.';
const playerHref = (puuid: string) => `/g/customs/p/${puuid}` as Route;

function storyline(canHide: boolean) {
  return (
    <AiRecap
      recap={{ kind: 'line', lineId: LINE_ID, text: TEXT }}
      groupId={GROUP_ID}
      tap={AI_STORYLINE_TAP}
      canHide={canHide}
      hideRedirect={`${PATH}?window=last-week`}
    />
  );
}

function board(window: WindowKind, node: React.ReactNode | undefined) {
  return (
    <BoardView
      board={workedWindowBoard(window)}
      viewerPuuid={null}
      sort="rating"
      page={1}
      path={PATH}
      playerHref={playerHref}
      storyline={node}
    />
  );
}

describe('the storyline on the board', () => {
  it("shows on Last week, labelled, with the week's tap text, above the list", () => {
    render(board('last-week', storyline(false)));
    const section = screen.getByRole('region', { name: 'AI recap' });
    expect(within(section).getByText(TEXT)).toBeInTheDocument();
    expect(within(section).getByText(AI_STORYLINE_TAP)).toBeInTheDocument();
    expect(within(section).queryByText(AI_RECAP_TAP)).not.toBeInTheDocument();
    const list = screen.getAllByRole('list').at(-1) as HTMLElement;
    const sort = screen.getByRole('combobox', { name: 'Sort by' });
    const slot = screen.getByText('Sunday 6 Sep to Saturday 12 Sep · 6 rated games');
    const precedes = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    // Title, tabs, slot line, AI recap, Sort by, list (design round 1).
    expect(precedes(slot, section)).toBe(true);
    expect(precedes(section, sort)).toBe(true);
    expect(precedes(sort, list)).toBe(true);
    expect(section.closest('header')).not.toBeNull();
  });

  it('shows on Last week only: This week and All time never draw it', () => {
    for (const window of ['this-week', 'all-time'] as const) {
      const { unmount } = render(board(window, storyline(true)));
      expect(screen.queryByRole('region', { name: 'AI recap' })).not.toBeInTheDocument();
      expect(screen.queryByText(TEXT)).not.toBeInTheDocument();
      unmount();
    }
  });

  it('without a line, Last week is exactly the board of a group without Premium', () => {
    expect(renderToStaticMarkup(board('last-week', undefined))).toBe(
      renderToStaticMarkup(board('last-week', null)),
    );
    expect(renderToStaticMarkup(board('last-week', undefined))).not.toMatch(/AI recap|Premium/);
  });

  it('a member sees no Hide; an admin gets one Hide that posts this line', () => {
    const { unmount } = render(board('last-week', storyline(false)));
    expect(screen.queryByRole('button', { name: 'Hide' })).not.toBeInTheDocument();
    unmount();

    render(board('last-week', storyline(true)));
    const hide = screen.getByRole('button', { name: 'Hide' });
    const form = hide.closest('form') as HTMLFormElement;
    expect(form).toHaveAttribute('action', '/api/admin/ai/hide');
    expect(form).toHaveAttribute('method', 'post');
    const data = new FormData(form);
    expect(data.get('lineId')).toBe(LINE_ID);
    expect(data.get('groupId')).toBe(GROUP_ID);
    expect(data.get('redirectTo')).toBe(`${PATH}?window=last-week`);
  });
});
