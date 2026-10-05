import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ORIGINAL_GROUP } from '@/lib/groups/pageGroup';
import { tapeEntry } from '@/lib/testing/tonightFixtures';
import type { TapeEntry } from '@/lib/tonight/types';
import { Tape } from './Tape';

/** M15.19: the tape names the rule a game was played under; the check line stays off it (D6). */
const result = (over: Partial<NonNullable<TapeEntry['result']>>): TapeEntry =>
  tapeEntry({ result: { ...(tapeEntry().result as NonNullable<TapeEntry['result']>), ...over } });

const draw = (entry: TapeEntry) => render(<Tape tape={[entry]} group={ORIGINAL_GROUP} />);

describe('the tape names the rule', () => {
  it('Tanks only · not rated', () => {
    draw(result({ rated: false, rule: { id: 'class', tag: 'Tank' } }));
    expect(screen.getByText('Tanks only · not rated')).toBeInTheDocument();
    expect(screen.queryByText('not rated')).toBeNull();
  });

  it('Ionia vs Noxus · not rated', () => {
    draw(result({ rated: false, rule: { id: 'region', blue: 'ionia', red: 'noxus' } }));
    expect(screen.getByText('Ionia vs Noxus · not rated')).toBeInTheDocument();
  });

  it('Mirror match, rated', () => {
    draw(result({ rated: true, rule: { id: 'mirror' } }));
    expect(screen.getByText('Mirror match')).toBeInTheDocument();
    expect(screen.queryByText(/not rated/)).toBeNull();
  });

  it('never the kept/broke check line', () => {
    draw(result({ rated: true, rule: { id: 'mirror' } }));
    expect(screen.queryByText(/kept|broke/i)).toBeNull();
  });

  it('M23.2: a voided game says why, as its Games row does, rule or none', () => {
    const early = draw(result({ rated: false, voidReason: 'early-end' }));
    expect(screen.getByText('Not rated · ended early')).toBeInTheDocument();
    expect(screen.queryByText('not rated')).toBeNull();
    early.unmount();
    draw(result({ rated: false, voidReason: 'admin', rule: { id: 'mirror' } }));
    expect(screen.getByText('Not rated · voided')).toBeInTheDocument();
  });

  it('a game with no result (a remake, a dropped lobby) is no result and not counted as played', () => {
    render(<Tape tape={[tapeEntry(), tapeEntry({ lobbyId: 'l2', result: null })]} group={ORIGINAL_GROUP} />);
    expect(screen.getByText('No result')).toBeInTheDocument();
    expect(screen.getByText('1 played')).toBeInTheDocument();
  });

  it('a remake (05-design.md 15.2): Remake, its minutes, one link to its page, no side, not played', () => {
    render(
      <Tape
        tape={[
          tapeEntry(),
          tapeEntry({ lobbyId: 'l2', result: null, remake: { gameId: 'remake-1', durationS: 245 } }),
          tapeEntry({ lobbyId: 'l3', result: null }),
        ]}
        group={ORIGINAL_GROUP}
      />,
    );
    const tile = screen.getByRole('link', { name: 'Game 2, Remake, 4 minutes' });
    expect(tile).toHaveAttribute('href', '/g/customs/games/remake-1');
    expect(tile).toHaveTextContent('4 min');
    expect(tile.textContent).not.toMatch(/BLUE|RED|won|MVP|not rated/i);
    expect(tile.querySelector('[data-side-fill]')).toBeNull();
    // A lobby that never produced a game keeps `No result`, with no link.
    expect(screen.getByText('No result').closest('a')).toBeNull();
    expect(screen.getByText('1 played')).toBeInTheDocument();
  });

  it('a plain game is unchanged: not rated on a game played not rated, nothing on a rated game', () => {
    const notRated = draw(result({ rated: false }));
    expect(screen.getByText('not rated')).toBeInTheDocument();
    notRated.unmount();
    draw(result({ rated: true }));
    expect(screen.queryByText(/not rated/)).toBeNull();
  });
});
