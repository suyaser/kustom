import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CURSED_DUO, MOST_IMPROVED } from '@/lib/stats/copy';
import {
  badgedWindowRows,
  workedBoardGame,
  workedBoardRows,
  workedWindowBoard,
  workedWindowRows,
} from '@/lib/testing/boardFixtures';
import { workedPuuid } from '@/lib/testing/workedExample';
import { BoardCard } from './BoardCard';
import { BoardRow } from './BoardRow';

/**
 * The award badge on a board row (M8.3): the three awards a **closed** window handed out,
 * printed as a third line under the meta.
 *
 * What these tests are about is the dress and the structure, because both are load-bearing. The
 * badge is a label and not a control — an `<a>` or a `<button>` inside the row's `<summary>`
 * would be a nested control, and a thumb landing near it would either toggle nothing or navigate
 * by accident — and it is drawn inside the row's own tap target rather than after it, or an open
 * row would print its award under the list of games it won the award with.
 *
 * Which rows carry which words is `lib/stats/winners.test.ts`; this file is handed a list.
 */

const NADIA = workedPuuid('Nadia');

function rowOf(container: HTMLElement, puuid: string): HTMLElement {
  const row = container.querySelector(`[href="/p/${puuid}"]`)?.closest('.cn-row');
  if (row === null || row === undefined) throw new Error(`no row for ${puuid}`);
  return row as HTMLElement;
}

function badgeText(row: HTMLElement): string[] {
  return [...row.querySelectorAll('.cn-award')].map((badge) => badge.textContent ?? '');
}

function drawBadged() {
  return render(<BoardCard rows={badgedWindowRows('last-week')} viewerPuuid={null} />);
}

describe('a row that won one of the window awards', () => {
  it('prints the award title, and the title alone', () => {
    const { container } = drawBadged();

    expect(badgeText(rowOf(container, NADIA))).toEqual([MOST_IMPROVED, CURSED_DUO]);
    expect(badgeText(rowOf(container, workedPuuid('Yuki')))).toEqual([CURSED_DUO]);
  });

  /**
   * **In the awards' own order, never re-sorted per row.** The fixture hands the row
   * `Most improved` then `Cursed duo`, which is `awardBlocks`' order and is not alphabetical: a
   * reader comparing two badged rows meets the same sequence on both.
   */
  it('keeps the order the loader handed it', () => {
    const { container } = drawBadged();
    const badges = badgeText(rowOf(container, NADIA));

    expect(badges).toEqual([MOST_IMPROVED, CURSED_DUO]);
    expect([...badges].sort()).not.toEqual(badges);
  });

  /** Its own run on a third line, after line 2 — not the last item of the middot run. */
  it('is a run of its own under the meta, not an item of line 2', () => {
    const { container } = drawBadged();
    const row = rowOf(container, NADIA);
    const run = row.querySelector('.cn-row-awards');

    expect(run).not.toBeNull();
    expect(run?.previousElementSibling).toHaveClass('cn-row-bottom');
    expect(row.querySelector('.cn-row-meta')?.textContent).not.toContain(MOST_IMPROVED);
    expect(run?.textContent).not.toContain('·');
  });

  /**
   * Inside the `<summary>` on a row that opens (M5.30) — so the whole row, badges included,
   * stays **one** tap target and the badge enlarges it rather than competing with it.
   */
  it('sits inside the summary of an expandable row, never after the details', () => {
    const { container } = render(
      <BoardCard
        rows={badgedWindowRows('last-week').map((row) =>
          row.puuid === NADIA ? { ...row, breakdown: [workedBoardGame()] } : row,
        )}
        viewerPuuid={null}
      />,
    );
    const run = rowOf(container, NADIA).querySelector('.cn-row-awards');

    expect(run?.closest('summary')).not.toBeNull();
    expect(run?.closest('.cn-row-games')).toBeNull();
  });

  /** And inside the `<li>` on a row with nothing to open: one place in the component. */
  it('sits inside the row of a board that does not open', () => {
    const { container } = drawBadged();

    expect(container.querySelector('details')).toBeNull();
    expect(rowOf(container, NADIA).querySelector('.cn-row-awards')).not.toBeNull();
  });

  /**
   * **Never a control.** No link, no button, nothing focusable and no `title` — a tooltip is a
   * hover, the page is read on a phone, and a badge that needs explaining should have been a
   * sentence.
   */
  it('is not a control and carries no tooltip', () => {
    const { container } = drawBadged();
    const run = rowOf(container, NADIA).querySelector('.cn-row-awards') as HTMLElement;

    expect(run.querySelector('a, button, [tabindex], [role], [title], [aria-label]')).toBeNull();
    // The one link on the row is still the name, and the badge did not become a second one.
    expect(screen.getAllByRole('link', { name: 'Nadia' })).toHaveLength(1);
  });

  /** Floodlit: no emoji, no icon, no award colour of its own, no `#1`. */
  it('is words and a hairline: no icon, no rank, no emoji', () => {
    const { container } = drawBadged();
    const run = rowOf(container, NADIA).querySelector('.cn-row-awards') as HTMLElement;

    expect(run.querySelector('svg, img')).toBeNull();
    expect(run.textContent).toMatch(/^[A-Za-z\- ]+$/);
    expect(run.textContent).not.toContain('#');
    for (const badge of run.querySelectorAll('.cn-award')) {
      // One class, the one the stylesheet dresses. No side, no brand, no state.
      expect(badge.className).toBe('cn-award');
    }
  });
});

describe('a window that handed nothing out', () => {
  /**
   * `This week`, `This month` and `All time` hand out no award (M5.4), so their rows carry no
   * list and **the board is the board it was before M8.3** — no run, no empty element, nothing.
   */
  it('draws no run at all, and no empty one', () => {
    for (const window of ['this-week', 'this-month'] as const) {
      const { container } = render(<BoardCard rows={workedWindowRows(window)} viewerPuuid={null} />);

      expect(container.querySelector('.cn-row-awards')).toBeNull();
      expect(container.querySelector('.cn-award')).toBeNull();
      expect(container.innerHTML).not.toContain(MOST_IMPROVED);
    }
  });

  /**
   * And the badge adds **nothing else** to a row: take the runs back out of a badged board and
   * the markup is the unbadged board's, byte for byte. That is the acceptance criterion for the
   * three windows that hand nothing out, checked on the markup rather than on a promise.
   */
  it('is the same markup as a badged board with the runs removed', () => {
    const plain = render(<BoardCard rows={workedWindowRows('last-week')} viewerPuuid={null} />).container
      .innerHTML;
    const badged = drawBadged().container.innerHTML;

    expect(badged.replaceAll(/<p class="cn-row-awards">.*?<\/p>/g, '')).toBe(plain);
  });

  /** The rail is a snapshot of tonight, not a window's story: those five rows carry no list. */
  it('includes the tonight rail, whose rows are never badged', () => {
    expect(workedWindowBoard('this-week').rows.every((row) => row.awards.length === 0)).toBe(true);
    expect(workedBoardRows().every((row) => row.awards.length === 0)).toBe(true);
  });
});

/** A row on its own, outside a card: the component decides the same thing either way. */
describe('the row component on its own', () => {
  it('renders the run for the row it is handed', () => {
    const badged = badgedWindowRows('last-week').find((row) => row.puuid === NADIA);
    if (badged === undefined) throw new Error('the fixture no longer badges Nadia');

    const { container } = render(
      <ol>
        <BoardRow row={badged} rank={3} viewerPuuid={null} />
        <BoardRow row={{ ...badged, puuid: 'other', name: 'Omar', awards: [] }} rank={4} viewerPuuid={null} />
      </ol>,
    );

    expect(container.querySelectorAll('.cn-award')).toHaveLength(2);
    expect(container.querySelectorAll('.cn-row-awards')).toHaveLength(1);
  });
});
