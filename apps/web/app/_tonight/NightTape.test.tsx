import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { tapeEntry } from '@/lib/testing/tonightFixtures';
import { NightTape } from './NightTape';

/** The night tape's rows (M11.2): product's lines inside the designer's time | body grid. */

const rowsOf = (container: HTMLElement) => [...container.querySelectorAll('.cn-tape > li')];

describe('NightTape', () => {
  it('draws nothing at all for an empty night: no card, no heading', () => {
    const { container } = render(<NightTape tape={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('numbers the rows oldest first under Earlier tonight', () => {
    const { container, getByRole } = render(
      <NightTape
        tape={[tapeEntry({ lobbyId: 'a', clock: '20:10' }), tapeEntry({ lobbyId: 'b', clock: '22:41' })]}
      />,
    );
    expect(getByRole('heading', { name: 'Earlier tonight' })).toBeInTheDocument();
    const rows = rowsOf(container);
    expect(rows.map((row) => row.querySelector('.cn-tape-game')?.textContent)).toEqual(['GAME 1', 'GAME 2']);
    expect(rows.map((row) => row.querySelector('time')?.textContent)).toEqual(['20:10', '22:41']);
  });

  it('prints the winner and the duration, colouring only the side word', () => {
    const { container } = render(<NightTape tape={[tapeEntry()]} />);
    expect(container.querySelector('.cn-tape-result')).toHaveTextContent(/^RED WINS · 31:04$/);
    expect(container.querySelector('.cn-tape-side')).toHaveTextContent(/^RED$/);
    expect(container.querySelector('.cn-tape-side')).toHaveClass('cn-tape-red');
  });

  it('prints NO RESULT with no duration for a dropped lobby, and dims the row', () => {
    const { container } = render(<NightTape tape={[tapeEntry({ status: 'dropped', result: null })]} />);
    expect(container.querySelector('.cn-tape-result')).toHaveTextContent(/^NO RESULT$/);
    expect(rowsOf(container)[0]).toHaveClass('cn-tape-dropped');
  });

  it('says ARAM · not rated on ARAM and not rated on an unrated Rift game', () => {
    const base = tapeEntry().result;
    if (base === null) throw new Error('fixture');
    const { container } = render(
      <NightTape
        tape={[
          tapeEntry({ lobbyId: 'a', result: { ...base, aram: true, rated: false } }),
          tapeEntry({ lobbyId: 'b', result: { ...base, rated: false } }),
          tapeEntry({ lobbyId: 'c' }),
        ]}
      />,
    );
    expect(rowsOf(container).map((row) => row.querySelector('.cn-tape-result')?.textContent)).toEqual([
      'RED WINS · 31:04 · ARAM · not rated',
      'RED WINS · 31:04 · not rated',
      'RED WINS · 31:04',
    ]);
  });

  it("prints M11.3's underdog line only when the underdog won", () => {
    const base = tapeEntry().result;
    if (base === null) throw new Error('fixture');
    const upset = render(<NightTape tape={[tapeEntry({ blueWinProb: 0.62 })]} />);
    expect(upset.container).toHaveTextContent('Red was 38%. Red won.');
    upset.unmount();

    const favourite = render(<NightTape tape={[tapeEntry({ blueWinProb: 0.38 })]} />);
    expect(favourite.container).not.toHaveTextContent(/won\./);
  });

  it('prints the evenness line with a split and none without', () => {
    const split = render(<NightTape tape={[tapeEntry({ blueWinProb: 0.54 })]} />);
    expect(split.container).toHaveTextContent('Teams are 92% even.');
    split.unmount();

    const none = render(<NightTape tape={[tapeEntry({ blueWinProb: null })]} />);
    expect(none.container).not.toHaveTextContent(/even/);
  });

  it('names the sitters in join order, and says nothing when nobody sat', () => {
    const sat = render(<NightTape tape={[tapeEntry({ sitters: ['Yuki', null, 'Omar'] })]} />);
    expect(sat.container).toHaveTextContent('Sat out: Yuki, Someone, Omar.');
    sat.unmount();

    const none = render(<NightTape tape={[tapeEntry()]} />);
    expect(none.container).not.toHaveTextContent('Sat out');
  });

  it('carries no rating, delta, award or champion icon', () => {
    const { container } = render(<NightTape tape={[tapeEntry({ sitters: ['Yuki'] })]} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).not.toMatch(/MVP|ACE|\([+−]\d+\)|\d{4}/);
  });

  it("links a row with a game to that game's page, and leaves a dropped row unlinked (M11.4)", () => {
    const { container } = render(
      <NightTape
        tape={[
          tapeEntry({ lobbyId: 'a', result: { ...(tapeEntry().result ?? fail()), gameId: 'game-a' } }),
          tapeEntry({ lobbyId: 'b', status: 'dropped', result: null }),
        ]}
      />,
    );
    const [played, dropped] = rowsOf(container);
    const link = played?.querySelector('a');
    expect(link).toHaveAttribute('href', '/g/game-a');
    expect(link).toHaveTextContent(/^RED WINS · 31:04$/);
    expect(dropped?.querySelector('a')).toBeNull();
    expect(container.querySelectorAll('a')).toHaveLength(1);
  });
});

function fail(): never {
  throw new Error('fixture');
}
