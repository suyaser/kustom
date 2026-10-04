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

  it('a plain game is unchanged: not rated on a remake, nothing on a rated game', () => {
    const remake = draw(result({ rated: false }));
    expect(screen.getByText('not rated')).toBeInTheDocument();
    remake.unmount();
    draw(result({ rated: true }));
    expect(screen.queryByText(/not rated/)).toBeNull();
  });
});
