import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SWITCH_SIDE_ENABLED } from '@/lib/commands/gate';
import { SIDE_LINE_AUTO, SIDE_LINE_MANUAL, sideLine } from '@/lib/tonight/copy';
import { SideLine } from './SideLine';

/**
 * The side line under the team cards (M4.7 (b)), in both states of the verification gate.
 *
 * The gate is a server constant that will flip exactly once — when the user's `verify-commands`
 * run proves `POST /lol-lobby/v2/lobby/team/{TEAM}` (M4.3) — and the sentence changes with it.
 * Both sides of that flip are tested here, today, so the commit that flips it does not have to
 * discover what this page will say.
 *
 * The words are product's, fixed in the M4.2 and M4.3 briefs, and they are pinned character for
 * character: an em dash, a straight apostrophe, and a full stop on both.
 */

describe('the two sentences, product s', () => {
  it('is `Move to your side in the lobby.` while nobody is moved for you', () => {
    expect(SIDE_LINE_MANUAL).toBe('Move to your side in the lobby.');
  });

  /**
   * **It still ends with `move yourself`.** A companion that is closed, offline, or looking at
   * a side that already holds five moves nobody, and the page cannot know which of the ten
   * that is true for (M4.3, "the bounce").
   */
  it('is the promise plus its escape hatch when the companion does the moving', () => {
    expect(SIDE_LINE_AUTO).toBe("You'll be moved to your side — if not, move yourself.");
    expect(SIDE_LINE_AUTO).toContain('move yourself');
  });

  it('is one of the two and never a third', () => {
    expect(sideLine(false)).toBe(SIDE_LINE_MANUAL);
    expect(sideLine(true)).toBe(SIDE_LINE_AUTO);
  });
});

describe('the line the page draws', () => {
  it('tells you to move yourself while the gate is off', () => {
    render(<SideLine switchSideEnabled={false} />);

    expect(screen.getByText(SIDE_LINE_MANUAL).tagName).toBe('P');
    expect(screen.queryByText(SIDE_LINE_AUTO)).not.toBeInTheDocument();
  });

  it('says the companion moves you once the gate is on', () => {
    render(<SideLine switchSideEnabled />);

    expect(screen.getByText(SIDE_LINE_AUTO)).toBeInTheDocument();
    expect(screen.queryByText(SIDE_LINE_MANUAL)).not.toBeInTheDocument();
  });

  /**
   * **The gate is read, not copied.** With no prop the component prints whatever
   * `COMMAND_KIND_ENABLED.switch_side` says today, so flipping that one boolean is the whole
   * change on this page — there is no second flag here to remember.
   */
  it('reads the shipped gate when nobody overrides it', () => {
    render(<SideLine />);

    expect(screen.getByText(sideLine(SWITCH_SIDE_ENABLED))).toBeInTheDocument();
  });
});
