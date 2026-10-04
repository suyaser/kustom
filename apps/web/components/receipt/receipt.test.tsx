import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { oddsSentence, RECEIPT_ANCHOR } from '@/lib/receipt/copy';
import { CompactReceipt } from './compact-receipt';
import { FairnessReceipt } from './fairness-receipt';
import {
  CALIBRATION_EARLY,
  CALIBRATION_READY,
  CLEAR,
  CLOSER_RUNNER_UP,
  FIXTURE_NAMES,
  GARBAGE_EXPLANATION,
  ONLY_ONE,
  RATINGS_KNOWN,
  RATINGS_MISSING,
  REROLLED,
  SPLIT_1,
  THREE_SPLITS,
} from './fixtures';
import { PreGameReceipt } from './pre-game-receipt';

/** Finds the element whose whole text is `text`, across the bold names and mono numbers inside it. */
function byWholeText(text: string) {
  return (_: string, el: Element | null): boolean =>
    el !== null && el.textContent === text && [...el.children].every((child) => child.textContent !== text);
}

const getWhole = (text: string, container: HTMLElement = document.body) =>
  within(container).getByText(byWholeText(text));

/** The one match above the disclosure (the split cards inside it repeat some chip words). */
const getAboveDisclosure = (text: string) => {
  const found = screen.getAllByText(byWholeText(text)).filter((el) => el.closest('details') === null);
  expect(found).toHaveLength(1);
  return found[0] as HTMLElement;
};

describe('FairnessReceipt, balanced (STRATEGY §4.5)', () => {
  it('is a region named by its title, with the bar spoken as one sentence', () => {
    render(<FairnessReceipt variant="balanced" splits={THREE_SPLITS} names={FIXTURE_NAMES} gameNumber={4} />);
    const receipt = screen.getByRole('region', { name: 'Win chance' });
    expect(within(receipt).getByText('Blue 49 percent, Red 51 percent.')).toBeInTheDocument();
    expect(getWhole('Game 4', receipt)).toBeInTheDocument();
  });

  it('labels both sides of the bar in words and numbers, not colour alone', () => {
    render(<FairnessReceipt variant="balanced" splits={THREE_SPLITS} names={FIXTURE_NAMES} />);
    expect(screen.getByText('BLUE')).toBeInTheDocument();
    expect(screen.getByText('49%')).toBeInTheDocument();
    expect(screen.getByText('RED')).toBeInTheDocument();
    expect(screen.getByText('51%')).toBeInTheDocument();
  });

  it('says the banded sentence, the three chips and the reason line', () => {
    render(<FairnessReceipt variant="balanced" splits={THREE_SPLITS} names={FIXTURE_NAMES} />);
    expect(screen.getByText('Basically a coin flip.')).toBeInTheDocument();
    expect(getAboveDisclosure('Rating gap 45 pts')).toBeInTheDocument();
    expect(getAboveDisclosure('Main roles 10/10')).toBeInTheDocument();
    expect(getWhole("Bot's pick #1 of 3")).toBeInTheDocument();
    expect(
      getWhole(
        "Next best: swap the adc players, SugarPapy and PRT Khokha. That's Blue 52%, with a bigger rating gap (93 vs 45 pts).",
      ),
    ).toBeInTheDocument();
  });

  it('never prints a win-chance chip, "N% even", a bare "Gap 45" or team totals', () => {
    render(<FairnessReceipt variant="balanced" splits={THREE_SPLITS} names={FIXTURE_NAMES} />);
    const receipt = screen.getByRole('region', { name: 'Win chance' });
    const details = receipt.querySelector('details');
    const outside = receipt.cloneNode(true) as HTMLElement;
    outside.querySelector('details')?.remove();
    expect(details).not.toBeNull();
    expect(outside.textContent).not.toMatch(/% even|Gap \d|Win chance \d/);
  });

  it('counts off-role players in the chip when there are some', () => {
    render(
      <FairnessReceipt
        variant="balanced"
        splits={CLOSER_RUNNER_UP.map((s, i) => ({ ...s, offRoleCount: i === 0 ? 2 : 4 }))}
        names={FIXTURE_NAMES}
      />,
    );
    expect(getAboveDisclosure('2 off main role')).toBeInTheDocument();
  });

  it('reads nothing from the explanation: a garbage one changes no bar, sentence, chip or reason', () => {
    const outsideText = (splits: typeof THREE_SPLITS) => {
      const { container, unmount } = render(
        <FairnessReceipt variant="balanced" splits={splits} names={FIXTURE_NAMES} />,
      );
      const clone = container.cloneNode(true) as HTMLElement;
      clone.querySelector('details')?.remove();
      const text = clone.textContent;
      unmount();
      return text;
    };
    expect(outsideText(GARBAGE_EXPLANATION)).toBe(outsideText(THREE_SPLITS));
  });

  it('a rank-1 split at 63% or more is "the fairest split these ten allow"', () => {
    render(<FairnessReceipt variant="balanced" splits={CLEAR} names={FIXTURE_NAMES} />);
    expect(
      screen.getByText('Blue is clearly favored. This was the fairest split these ten allow.'),
    ).toBeInTheDocument();
  });

  it('explains a runner-up with closer odds (the "rigged-looking" case, §4.4)', () => {
    render(<FairnessReceipt variant="balanced" splits={CLOSER_RUNNER_UP} names={FIXTURE_NAMES} />);
    expect(screen.getByText('Close. Blue has a slight edge.')).toBeInTheDocument();
    expect(
      getWhole('Next best: swap XETA (jungle) and knifiy (mid). Blue 51%, with 2 more off their main role.'),
    ).toBeInTheDocument();
    expect(getWhole('Closer odds, but ranked lower: 2 more people off their main role.')).toBeInTheDocument();
  });

  it('with no runner-up, says this was the only split that fit', () => {
    render(<FairnessReceipt variant="balanced" splits={ONLY_ONE} names={FIXTURE_NAMES} />);
    expect(screen.getByText('This was the only split that fit.')).toBeInTheDocument();
    expect(getWhole("Bot's pick #1 of 1")).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('prints the shared fallback word for a puuid with no name yet', () => {
    const { [SPLIT_1.blue[3]?.puuid as string]: _dropped, ...names } = FIXTURE_NAMES;
    render(<FairnessReceipt variant="balanced" splits={THREE_SPLITS} names={names} />);
    expect(
      getWhole(
        "Next best: swap the adc players, Someone and PRT Khokha. That's Blue 52%, with a bigger rating gap (93 vs 45 pts).",
      ),
    ).toBeInTheDocument();
  });

  it('renders nothing for a probability outside [0, 1], rather than a wrong bar', () => {
    const { container } = render(
      <FairnessReceipt
        variant="balanced"
        splits={[{ ...SPLIT_1, blueWinProb: 1.4 }]}
        names={FIXTURE_NAMES}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('FairnessReceipt after a reroll', () => {
  it('shows the reroll chip, drops "fairest", and words the next one down', () => {
    render(<FairnessReceipt variant="balanced" splits={REROLLED} names={FIXTURE_NAMES} />);
    expect(getWhole('Reroll 1 of 2 · pick #2')).toBeInTheDocument();
    expect(screen.getByText('Basically a coin flip.')).toBeInTheDocument();
    expect(screen.getByText('Rerolled past this one.')).toBeInTheDocument();
    const inPlay = screen.getByText('In play').closest('li') as HTMLElement;
    expect(within(inPlay).getByText('#2')).toBeInTheDocument();
  });

  it('a clear split reached by a reroll is not called the fairest', () => {
    render(
      <FairnessReceipt
        variant="balanced"
        splits={CLEAR.map((s) => ({ ...s, isChosen: s.rank === 2 }))}
        names={FIXTURE_NAMES}
      />,
    );
    expect(screen.getByText('Blue is clearly favored.')).toBeInTheDocument();
    // The last split has nothing below it: no reason line, and never "the only split that fit".
    expect(screen.queryByText(/^Next best/)).toBeNull();
    expect(screen.queryByText('This was the only split that fit.')).toBeNull();
  });
});

describe('How the bot decided (§4.6)', () => {
  it('is a native disclosure everyone gets, closed by default, with the splits in rank order', () => {
    // No session, no admin flag: there is nothing to pass. It renders for a signed-out visitor.
    render(
      <FairnessReceipt
        variant="balanced"
        splits={THREE_SPLITS}
        names={FIXTURE_NAMES}
        calibration={CALIBRATION_READY}
      />,
    );
    const summary = screen.getByText('How the bot decided');
    expect(summary.tagName).toBe('SUMMARY');
    const details = summary.closest('details') as HTMLElement;
    expect(details).not.toHaveAttribute('open');
    expect(details).toHaveAttribute('id', RECEIPT_ANCHOR);

    const items = within(details).getAllByRole('listitem');
    expect(items.map((li) => within(li).getByText(/^#\d$/).textContent)).toEqual(['#1', '#2', '#3']);
    expect(within(items[0] as HTMLElement).getByText('In play')).toBeInTheDocument();
    expect(within(items[0] as HTMLElement).getByText('These teams.')).toBeInTheDocument();
    expect(getWhole('Blue 52% · 48% Red', items[1] as HTMLElement)).toBeInTheDocument();
    expect(
      getWhole('Swap the adc players, SugarPapy and PRT Khokha.', items[1] as HTMLElement),
    ).toBeInTheDocument();
    expect(
      getWhole('Ranked lower: a bigger rating gap (93 vs 45 pts).', items[1] as HTMLElement),
    ).toBeInTheDocument();
    expect(getWhole('Off main role 2', items[2] as HTMLElement)).toBeInTheDocument();
  });

  it("holds the explainers, the bot's note verbatim, calibration and the link", () => {
    render(
      <FairnessReceipt
        variant="balanced"
        splits={THREE_SPLITS}
        names={FIXTURE_NAMES}
        calibration={CALIBRATION_READY}
        howHref="/how"
      />,
    );
    expect(screen.getByText('Why win chance and rating gap can disagree')).toBeInTheDocument();
    expect(screen.getByText('Nobody picked these teams.')).toBeInTheDocument();
    // M14.68: the note names the pre-roll powers (mode, Rated) as well as Roll and Reroll.
    expect(
      screen.getByText((text) =>
        text.startsWith(
          'Admins can set the mode and whether a game is rated, but only before its teams are rolled.',
        ),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/never after/)).toBeNull();
    expect(screen.getByText(`The bot's note: ${SPLIT_1.explanation}`)).toBeInTheDocument();
    expect(
      getWhole('The side the bot favored won 58 of 103 games (56%). It expected about 55%.'),
    ).toBeInTheDocument();
    expect(screen.getByText('The odds are honest when those two numbers are close.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'More on how it works' })).toHaveAttribute('href', '/how');
  });

  it('hides the calibration percentages under 20 games', () => {
    render(
      <FairnessReceipt
        variant="balanced"
        splits={THREE_SPLITS}
        names={FIXTURE_NAMES}
        calibration={CALIBRATION_EARLY}
      />,
    );
    expect(getWhole("Not enough games yet to check the bot's odds (7 of 20).")).toBeInTheDocument();
    expect(screen.queryByText(/The side the bot favored won/)).toBeNull();
  });

  it('opens on first paint when asked (the landing page)', () => {
    render(<FairnessReceipt variant="balanced" splits={THREE_SPLITS} names={FIXTURE_NAMES} defaultOpen />);
    expect(screen.getByText('How the bot decided').closest('details')).toHaveAttribute('open');
  });
});

describe('FairnessReceipt in game and finished (it never disappears, §4.2 rule 8)', () => {
  it('in game: "Odds at kickoff", bar and sentence, no chips, no disclosure', () => {
    render(<FairnessReceipt variant="in-game" splits={THREE_SPLITS} names={FIXTURE_NAMES} />);
    const receipt = screen.getByRole('region', { name: 'Odds at kickoff' });
    expect(within(receipt).getByText('Blue 49 percent, Red 51 percent.')).toBeInTheDocument();
    expect(within(receipt).getByText('Basically a coin flip.')).toBeInTheDocument();
    expect(within(receipt).queryByText(/Rating gap/)).toBeNull();
    expect(within(receipt).queryByText('How the bot decided')).toBeNull();
  });

  it('large text: only the compact bar drops its side words, below 18em of its own width (12.3a follow-up)', () => {
    const words = (bar: Element) =>
      [...bar.querySelectorAll('span')].filter(
        (span) => span.textContent === 'BLUE' || span.textContent === 'RED',
      );
    const { unmount } = render(
      <FairnessReceipt variant="in-game" splits={THREE_SPLITS} names={FIXTURE_NAMES} />,
    );
    const compact = document.querySelector('[data-slot="win-bar"]') as HTMLElement;
    expect(compact.className).toContain('@container');
    expect(words(compact)).toHaveLength(2);
    for (const word of words(compact)) expect(word.className).toBe('@max-[18em]:hidden');
    unmount();
    render(<FairnessReceipt variant="finished" winner={200} splits={THREE_SPLITS} names={FIXTURE_NAMES} />);
    const full = document.querySelector('[data-slot="win-bar"]') as HTMLElement;
    expect(full.className).not.toContain('@container');
    expect(words(full)).toHaveLength(2);
    for (const word of words(full)) expect(word.className).toBe('');
  });

  it('finished: "The odds were" and the result line in place of the sentence', () => {
    render(<FairnessReceipt variant="finished" winner={200} splits={THREE_SPLITS} names={FIXTURE_NAMES} />);
    const receipt = screen.getByRole('region', { name: 'The odds were' });
    expect(within(receipt).getByText('Red was 51%. Red won.')).toBeInTheDocument();
    expect(within(receipt).queryByText('Basically a coin flip.')).toBeNull();
    expect(within(receipt).getByText('How the bot decided')).toBeInTheDocument();
  });

  it('finished: an underdog win is an upset', () => {
    render(<FairnessReceipt variant="finished" winner={100} splits={THREE_SPLITS} names={FIXTURE_NAMES} />);
    expect(getWhole('Blue was 49%. Blue won. Upset!')).toBeInTheDocument();
  });

  it("Tonight's poster (winnerShown): the headline names the winner, so the line is the odds only (M14.45)", () => {
    const { rerender } = render(
      <FairnessReceipt
        variant="finished"
        winner={200}
        winnerShown
        splits={THREE_SPLITS}
        names={FIXTURE_NAMES}
      />,
    );
    expect(getWhole('Red was 51%.')).toBeInTheDocument();
    expect(screen.queryByText(/Red won/)).toBeNull();
    rerender(
      <FairnessReceipt
        variant="finished"
        winner={100}
        winnerShown
        splits={THREE_SPLITS}
        names={FIXTURE_NAMES}
      />,
    );
    expect(getWhole('Blue was 49%. Upset!')).toBeInTheDocument();
  });

  it('the off-role line, when the page knows the seats, only where the chip does not already say it (M14.45)', () => {
    const { rerender } = render(
      <FairnessReceipt variant="balanced" splits={THREE_SPLITS} names={FIXTURE_NAMES} offRole={[]} />,
    );
    // Beside `Main roles 10/10` the sentence would say it twice.
    expect(screen.queryByText("Everyone's on their main role.")).toBeNull();
    rerender(<FairnessReceipt variant="in-game" splits={THREE_SPLITS} names={FIXTURE_NAMES} offRole={[]} />);
    // In game there is no chip row, so the line stays.
    expect(screen.getByText("Everyone's on their main role.")).toBeInTheDocument();
    rerender(
      <FairnessReceipt
        variant="balanced"
        splits={THREE_SPLITS}
        names={FIXTURE_NAMES}
        offRole={[{ puuid: 'p-xeta', role: 'mid' }]}
      />,
    );
    expect(getWhole('XETA is off their main role (mid).')).toBeInTheDocument();
    rerender(
      <FairnessReceipt
        variant="balanced"
        splits={THREE_SPLITS}
        names={FIXTURE_NAMES}
        offRole={[
          { puuid: 'p-xeta', role: 'mid' },
          { puuid: 'p-knifiy', role: 'jungle' },
        ]}
      />,
    );
    // `2 off main role` is the chip; the sentence goes.
    expect(screen.queryByText('2 people are off their main role.')).toBeNull();
  });
});

describe('PreGameReceipt (§4.10)', () => {
  it('no split: pre-game odds and the honest line, nothing the bot did not decide', () => {
    render(<PreGameReceipt reason="no-split" ratingsBefore={RATINGS_KNOWN} winner={200} />);
    const receipt = screen.getByRole('region', { name: 'Pre-game odds' });
    expect(within(receipt).getByText(/^Blue \d+ percent, Red \d+ percent\.$/)).toBeInTheDocument();
    expect(
      within(receipt).getByText("Kustom didn't pick these teams. Odds from everyone's ratings going in."),
    ).toBeInTheDocument();
    expect(within(receipt).getByText(/^Red was \d+%\. Red won\./)).toBeInTheDocument();
    expect(within(receipt).queryByText(/Rating gap|Bot's pick|How the bot decided/)).toBeNull();
  });

  it('teams changed after the roll: the line says so and the rolled splits stay in the disclosure', () => {
    render(
      <PreGameReceipt
        reason="teams-changed"
        ratingsBefore={RATINGS_KNOWN}
        rolled={{ splits: THREE_SPLITS, names: FIXTURE_NAMES }}
      />,
    );
    expect(
      screen.getByText(
        'Teams changed in the lobby after the roll, so these are the odds for the teams that actually played.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('How the bot decided')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('a missing rating: no receipt, only "No odds for this game."', () => {
    render(<PreGameReceipt reason="no-split" ratingsBefore={RATINGS_MISSING} />);
    expect(screen.getByText('No odds for this game.')).toBeInTheDocument();
    expect(screen.queryByRole('region')).toBeNull();
  });
});

describe('CompactReceipt (§4.7)', () => {
  it("one line: the winner's odds and who won", () => {
    render(<CompactReceipt winner={100} blueWinProb={0.54} />);
    expect(screen.getByText('Blue was 54%. Blue won.')).toBeInTheDocument();
    expect(screen.queryByText('Upset')).toBeNull();
  });

  it('tags an upset, a reroll pick and ARAM', () => {
    render(<CompactReceipt winner={200} blueWinProb={0.53} rank={2} aram />);
    expect(screen.getByText('Red was 47%. Red won.')).toBeInTheDocument();
    expect(screen.getByText('Upset')).toBeInTheDocument();
    expect(screen.getByText('pick #2')).toBeInTheDocument();
    expect(screen.getByText('ARAM')).toBeInTheDocument();
  });

  it('even odds read 50–50', () => {
    render(<CompactReceipt winner={200} blueWinProb={0.5} />);
    expect(screen.getByText('50–50. Red won.')).toBeInTheDocument();
  });

  it('a game with no split uses pre-game odds, or says nothing without them', () => {
    const { container, rerender } = render(<CompactReceipt winner={100} ratingsBefore={RATINGS_KNOWN} />);
    expect(screen.getByText(/^Blue was \d+%\. Blue won\.$/)).toBeInTheDocument();
    rerender(<CompactReceipt winner={100} ratingsBefore={RATINGS_MISSING} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('oddsSentence (§4.3) as the page prints it', () => {
  it.each([
    [0.5, 1, 'Dead even.'],
    [0.53, 1, 'Basically a coin flip.'],
    [0.46, 1, 'Close. Red has a slight edge.'],
    [0.57, 1, 'Close. Blue has a slight edge.'],
    [0.58, 1, 'Blue is favored.'],
    [0.38, 1, 'Red is favored.'],
    [0.63, 1, 'Blue is clearly favored. This was the fairest split these ten allow.'],
    [0.63, 2, 'Blue is clearly favored.'],
  ])('%s at rank %s -> %s', (p, rank, sentence) => {
    expect(oddsSentence(p, rank)).toBe(sentence);
  });
});
