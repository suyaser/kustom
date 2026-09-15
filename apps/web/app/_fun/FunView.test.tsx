import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { QueueKind } from '@/lib/games/queue';
import type { WindowKind } from '@/lib/night';
import {
  FATES_HEADING,
  FIRST_BLOOD_EMPTY,
  FIRST_BLOOD_TAKEN_TITLE,
  FIRST_BLOOD_TITLE,
  FUN_LABEL,
  LUCKY_TRASH,
  MOST_BANNED_TITLE,
  MOST_PICKED_TITLE,
  ODDS_EMPTY,
  ODDS_NONE_TWICE,
  ODDS_RECORD_TITLE,
  ODDS_RULE,
  ODDS_TITLE,
  OTP_TITLE,
  PENTA_EMPTY,
  PENTA_TITLE,
  POOL_EMPTY,
  POOLS_HEADING,
  ROBBED,
  SEE_CHAMPS,
  SEE_GAMES,
  THIS_GAME,
  TRIPLE_TITLE,
  VARIETY_TITLE,
} from '@/lib/stats/funCopy';
import { assembleFunFacts } from '@/lib/stats/funView';
import { playerFacts } from '@/lib/stats/rawFacts';
import type { FunFactsView } from '@/lib/stats/types';
import { rosterFor, tenPlayerGame } from '@/lib/testing/statsFixtures';
import { FunView } from './FunView';

const MONTH = { start: new Date('2026-09-01T03:00:00Z'), end: new Date('2026-10-01T03:00:00Z') };

function view(
  options: { window?: WindowKind; queue?: QueueKind; gameMode?: string | null } = {},
): FunFactsView {
  const game = tenPlayerGame({
    at: '2026-09-02T20:00:00Z',
    durationS: 1_800,
    winner: 100,
    ...(options.gameMode === undefined ? {} : { gameMode: options.gameMode }),
    blue: [
      {
        key: 'lena',
        role: 'adc',
        championId: 103,
        kills: 12,
        deaths: 2,
        assists: 8,
        cs: 240,
        damageToChamps: 20_000,
      },
    ],
  });
  return assembleFunFacts(
    {
      window: options.window ?? 'this-month',
      games: [game],
      players: rosterFor([game]),
      range: MONTH,
      capped: false,
      cap: 2_000,
      timeZone: 'Africa/Cairo',
    },
    options.queue,
  );
}

describe('FunView', () => {
  it('names the window and the page', () => {
    render(<FunView facts={view()} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(`This month ${FUN_LABEL}`);
    expect(screen.getByText(FIRST_BLOOD_TITLE)).toBeInTheDocument();
    expect(screen.queryByText(FIRST_BLOOD_TAKEN_TITLE)).not.toBeInTheDocument();
    expect(screen.getByText(MOST_PICKED_TITLE)).toBeInTheDocument();
    expect(screen.getByText(POOLS_HEADING)).toBeInTheDocument();
    expect(screen.getByText(OTP_TITLE)).toBeInTheDocument();
    expect(screen.getByText(VARIETY_TITLE)).toBeInTheDocument();
    expect(screen.getByText(FATES_HEADING)).toBeInTheDocument();
    expect(screen.getByText(LUCKY_TRASH)).toBeInTheDocument();
    expect(screen.getByText(ROBBED)).toBeInTheDocument();
    expect(screen.getByText('المحظوظ طرش')).toBeInTheDocument();
    expect(screen.getByText('المظلوم بزيادة')).toBeInTheDocument();
    expect(screen.getAllByText(POOL_EMPTY).length).toBe(2);
    expect(screen.getByText(FIRST_BLOOD_EMPTY)).toBeInTheDocument();
    expect(screen.getByText(PENTA_TITLE)).toBeInTheDocument();
    expect(screen.getByText(TRIPLE_TITLE)).toBeInTheDocument();
    expect(screen.getByText(PENTA_EMPTY)).toBeInTheDocument();
    expect(screen.getByText('مين فتحها')).toBeInTheDocument();
    expect(screen.getByText('كنسهم كنس')).toBeInTheDocument();
    expect(screen.getByText('كسب وهو زبالة')).toBeInTheDocument();
    expect(screen.queryByText(/we do not store it/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Vision score is not stored/i)).not.toBeInTheDocument();
  });

  it('links a record holder to their page', () => {
    render(<FunView facts={view()} />);
    expect(screen.getAllByRole('link', { name: 'Lena' })[0]).toHaveAttribute('href', '/p/u-lena');
  });

  it('opens the counted custom under a one-game record', () => {
    const { container } = render(<FunView facts={view()} />);
    const mostKills = screen.getByText('Most kills').closest('.cn-role-block');
    expect(mostKills).not.toBeNull();
    const card = mostKills?.querySelector('details');
    expect(card).not.toBeNull();
    expect(card).not.toHaveAttribute('open');
    expect(within(mostKills as HTMLElement).getByText(THIS_GAME)).toBeInTheDocument();
    expect(within(card as HTMLElement).getByText('Blue · 12')).toBeInTheDocument();
    expect(within(card as HTMLElement).getByText('Ahri')).toBeInTheDocument();
    expect(container.querySelectorAll('details').length).toBeGreaterThan(0);
  });

  it('keeps a record name, number and date as separate cells', () => {
    render(<FunView facts={view()} />);
    expect(screen.getAllByRole('link', { name: 'Lena' })[0]).toHaveTextContent(/^Lena$/);
    expect(screen.getByText('Highest CS')).toBeInTheDocument();
    expect(screen.getByText('Most kills')).toBeInTheDocument();
    expect(screen.getAllByText('12/2/8').length).toBeGreaterThan(0);
  });

  it('defaults to Rift and keeps the window when switching to ARAM', () => {
    render(<FunView facts={view()} />);
    expect(screen.getByRole('link', { name: "Summoner's Rift" })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'ARAM' })).toHaveAttribute(
      'href',
      '/fun?window=this-month&queue=aram',
    );
  });

  it('names a first-blood taker from the stored block', () => {
    const game = tenPlayerGame({
      at: '2026-09-02T20:00:00Z',
      durationS: 1_800,
      winner: 100,
      blue: [{ key: 'lena', role: 'adc', championId: 103, kills: 4, deaths: 1, assists: 2 }],
      rawFacts: {
        byPuuid: {
          'u-lena': playerFacts({ firstBloodKill: true, championName: 'Ahri' }),
        },
        bans: [],
      },
    });
    const facts = assembleFunFacts({
      window: 'this-month',
      games: [game],
      players: rosterFor([game]),
      range: MONTH,
      capped: false,
      cap: 2_000,
      timeZone: 'Africa/Cairo',
    });
    render(<FunView facts={facts} />);
    expect(screen.getAllByText('Ahri').length).toBeGreaterThan(0);
    expect(screen.queryByText(FIRST_BLOOD_EMPTY)).not.toBeInTheDocument();
    expect(
      within(screen.getByText(FIRST_BLOOD_TITLE).closest('.cn-card') as HTMLElement).getByText(THIS_GAME),
    ).toBeInTheDocument();
    expect(screen.queryByText(FIRST_BLOOD_TAKEN_TITLE)).not.toBeInTheDocument();
  });

  it('shows First Blood Donated only when the block named the death', () => {
    const game = tenPlayerGame({
      at: '2026-09-02T20:00:00Z',
      durationS: 1_800,
      winner: 100,
      blue: [{ key: 'lena', role: 'adc', championId: 103, kills: 4, deaths: 0, assists: 2 }],
      red: [{ key: 'yuki', role: 'adc', championId: 22, kills: 1, deaths: 4, assists: 1 }],
      rawFacts: {
        byPuuid: {
          'u-lena': playerFacts({ firstBloodKill: true, championName: 'Ahri' }),
          'u-yuki': playerFacts({ firstBloodDeath: true, championName: 'Ashe' }),
        },
        bans: [],
      },
    });
    const facts = assembleFunFacts({
      window: 'this-month',
      games: [game],
      players: rosterFor([game]),
      range: MONTH,
      capped: false,
      cap: 2_000,
      timeZone: 'Africa/Cairo',
    });
    render(<FunView facts={facts} />);
    expect(screen.getByText(FIRST_BLOOD_TAKEN_TITLE)).toBeInTheDocument();
    expect(screen.getByText('اتفتح عليه أول واحد')).toBeInTheDocument();
  });

  it('opens each first blood under a player who took more than one', () => {
    const games = ['2026-09-02T20:00:00Z', '2026-09-03T20:00:00Z'].map((at, index) =>
      tenPlayerGame({
        id: `fb-${index}`,
        at,
        durationS: 1_800,
        winner: 100,
        blue: [{ key: 'lena', role: 'adc', championId: 103, kills: 4, deaths: 1, assists: 2 }],
        rawFacts: {
          byPuuid: { 'u-lena': playerFacts({ firstBloodKill: true, championName: 'Ahri' }) },
          bans: [],
        },
      }),
    );
    const facts = assembleFunFacts({
      window: 'this-month',
      games,
      players: rosterFor(games),
      range: MONTH,
      capped: false,
      cap: 2_000,
      timeZone: 'Africa/Cairo',
    });
    render(<FunView facts={facts} />);
    const museum = screen.getByText(FIRST_BLOOD_TITLE).closest('.cn-card') as HTMLElement;
    expect(within(museum).getByText('2 first bloods')).toBeInTheDocument();
    expect(within(museum).getByText(SEE_GAMES)).toBeInTheDocument();
    expect(within(museum).getAllByText(THIS_GAME).length).toBe(2);
  });

  it('opens each triple under a player who hit more than once', () => {
    const games = ['2026-09-02T20:00:00Z', '2026-09-03T20:00:00Z'].map((at, index) =>
      tenPlayerGame({
        id: `tr-${index}`,
        at,
        durationS: 1_800,
        winner: 100,
        blue: [{ key: 'lena', role: 'adc', championId: 103, kills: 8, deaths: 1, assists: 2 }],
        rawFacts: {
          byPuuid: {
            'u-lena': playerFacts({
              tripleKills: index === 0 ? 2 : 1,
              championName: 'Ahri',
            }),
          },
          bans: [],
        },
      }),
    );
    const facts = assembleFunFacts({
      window: 'this-month',
      games,
      players: rosterFor(games),
      range: MONTH,
      capped: false,
      cap: 2_000,
      timeZone: 'Africa/Cairo',
    });
    render(<FunView facts={facts} />);
    const museum = screen.getByText(TRIPLE_TITLE).closest('.cn-card') as HTMLElement;
    expect(within(museum).getByText('3 triples')).toBeInTheDocument();
    expect(within(museum).getByText(SEE_GAMES)).toBeInTheDocument();
    expect(within(museum).getByText('Ahri · 2 triples')).toBeInTheDocument();
    expect(within(museum).getAllByText(THIS_GAME).length).toBe(2);
  });

  it('opens a collapsed champion × games list under the one-trick', () => {
    const champs = [103, 22, 51, 67, 222];
    const games = champs.map((championId, index) =>
      tenPlayerGame({
        id: `pool-${index}`,
        at: `2026-09-0${index + 1}T20:00:00Z`,
        durationS: 1_800,
        winner: 100,
        blue: [
          { key: 'omar', role: 'mid', championId: 35 },
          { key: 'lena', role: 'adc', championId },
        ],
      }),
    );
    const facts = assembleFunFacts({
      window: 'this-month',
      games,
      players: rosterFor(games),
      range: MONTH,
      capped: false,
      cap: 2_000,
      timeZone: 'Africa/Cairo',
    });
    render(<FunView facts={facts} />);
    const otp = screen.getByText(OTP_TITLE).closest('.cn-role-block') as HTMLElement;
    const variety = screen.getByText(VARIETY_TITLE).closest('.cn-role-block') as HTMLElement;
    expect(within(otp).getByText('اكتر واحد معرق')).toBeInTheDocument();
    expect(within(variety).getByText('لعيب بيلعب بشامبيونات مختلفة')).toBeInTheDocument();
    expect(within(otp).getByRole('link', { name: 'Omar' })).toBeInTheDocument();
    expect(within(variety).getByRole('link', { name: 'Lena' })).toBeInTheDocument();
    const card = otp.querySelector('details');
    expect(card).not.toBeNull();
    expect(card).not.toHaveAttribute('open');
    expect(within(otp).getAllByText(SEE_CHAMPS).length).toBeGreaterThan(0);
    expect(within(otp).getByText('Shaco')).toBeInTheDocument();
    expect(within(otp).getByText('× 5')).toBeInTheDocument();
    expect(within(variety).getByText('Ahri')).toBeInTheDocument();
    expect(within(variety).getAllByText('× 1').length).toBe(5);
  });

  it('opens collapsed lucky-trash and robbed games under the count', () => {
    const fine = { kills: 4, deaths: 4, assists: 4 };
    const trash = { kills: 0, deaths: 8, assists: 1 };
    const carry = { kills: 12, deaths: 2, assists: 8 };
    const seat = (key: string, role: 'top' | 'jungle' | 'mid' | 'adc' | 'support') => ({
      key,
      role,
      championId: 1,
      ...fine,
    });
    const games = ['2026-09-01T20:00:00Z', '2026-09-02T20:00:00Z'].map((at, index) =>
      tenPlayerGame({
        id: `fate-${index}`,
        at,
        durationS: 1_800,
        winner: 100,
        blue: [
          { key: 'bilal', role: 'support', championId: 12, ...trash },
          seat('iris', 'top'),
          seat('rami', 'jungle'),
          seat('omar', 'mid'),
          seat('theo', 'adc'),
        ],
        red: [
          { key: 'lena', role: 'adc', championId: 103, ...carry },
          seat('yuki', 'support'),
          seat('nadia', 'top'),
          seat('karim', 'jungle'),
          seat('hana', 'mid'),
        ],
      }),
    );
    const facts = assembleFunFacts({
      window: 'this-month',
      games,
      players: rosterFor(games),
      range: MONTH,
      capped: false,
      cap: 2_000,
      timeZone: 'Africa/Cairo',
    });
    render(<FunView facts={facts} />);
    const lucky = screen.getByText(LUCKY_TRASH).closest('.cn-role-block') as HTMLElement;
    const robbed = screen.getByText(ROBBED).closest('.cn-role-block') as HTMLElement;
    expect(within(lucky).getByRole('link', { name: 'Bilal' })).toBeInTheDocument();
    expect(within(lucky).getByText('2 times')).toBeInTheDocument();
    expect(within(robbed).getByRole('link', { name: 'Lena' })).toBeInTheDocument();
    expect(within(robbed).getByText('2 times')).toBeInTheDocument();
    const card = lucky.querySelector('details');
    expect(card).not.toBeNull();
    expect(card).not.toHaveAttribute('open');
    expect(within(lucky).getByText(SEE_GAMES)).toBeInTheDocument();
    expect(within(lucky).getAllByText('0/8/1 · Alistar').length).toBe(2);
    expect(within(robbed).getAllByText('12/2/8 · Ahri').length).toBe(2);
  });

  it('hides CS by role on ARAM', () => {
    render(<FunView facts={view({ queue: 'aram', gameMode: 'ARAM' })} />);
    expect(screen.getByRole('link', { name: 'ARAM' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: "Summoner's Rift" })).toHaveAttribute(
      'href',
      '/fun?window=this-month',
    );
    expect(screen.getByRole('link', { name: 'Last month' })).toHaveAttribute(
      'href',
      '/fun?window=last-month&queue=aram',
    );
    expect(screen.queryByText('CS by role')).not.toBeInTheDocument();
    expect(screen.queryByText('Objective Thief')).not.toBeInTheDocument();
    expect(screen.queryByText(MOST_BANNED_TITLE)).not.toBeInTheDocument();
    expect(screen.getByText(MOST_PICKED_TITLE)).toBeInTheDocument();
    expect(screen.getByText('Most kills')).toBeInTheDocument();
  });

  /* -------------------------------------------------------------------------
   * Won against the odds (M8.2).
   * ----------------------------------------------------------------------- */

  it('ranks the wins from under the posted chance and names the record game', () => {
    const games = ['2026-09-01T20:00:00Z', '2026-09-02T20:00:00Z'].map((at, index) =>
      tenPlayerGame({
        id: `odds-${index}`,
        at,
        durationS: 1_800,
        winner: 100,
        blueWinProb: index === 0 ? 0.31 : 0.4,
        blue: [{ key: 'lena', role: 'adc', championId: 103, kills: 4, deaths: 1, assists: 2 }],
      }),
    );
    const facts = assembleFunFacts({
      window: 'this-month',
      games,
      players: rosterFor(games),
      range: MONTH,
      capped: false,
      cap: 2_000,
      timeZone: 'Africa/Cairo',
    });
    render(<FunView facts={facts} />);
    const card = screen.getByText(ODDS_TITLE).closest('.cn-card') as HTMLElement;

    expect(within(card).getByText('كسبوا وهما خسرانين')).toBeInTheDocument();
    expect(within(card).getAllByText('2 wins').length).toBe(5);
    expect(within(card).getAllByText(SEE_GAMES).length).toBe(5);
    expect(within(card).getAllByText('31% · Won · Tuesday').length).toBe(5);
    expect(within(card).getByText('Blue won at 31%.')).toBeInTheDocument();
    expect(within(card).getByText(ODDS_RECORD_TITLE)).toBeInTheDocument();
    expect(within(card).getAllByRole('link', { name: 'Lena' })[0]).toHaveAttribute('href', '/p/u-lena');
    expect(within(card).queryByText(ODDS_EMPTY)).not.toBeInTheDocument();
    // Collapsed on arrival, like every other expander on the page.
    expect(card.querySelector('details')).not.toHaveAttribute('open');
  });

  it('says the section is thin rather than looking broken when no game has a posted chance', () => {
    render(<FunView facts={view()} />);
    const card = screen.getByText(ODDS_TITLE).closest('.cn-card') as HTMLElement;

    expect(within(card).getByText(ODDS_EMPTY)).toBeInTheDocument();
    expect(within(card).queryByText(ODDS_RECORD_TITLE)).not.toBeInTheDocument();
    expect(within(card).getByText(ODDS_RULE)).toBeInTheDocument();
  });

  it('says nobody did it twice rather than contradicting the record under it', () => {
    const game = tenPlayerGame({
      id: 'odds-once',
      at: '2026-09-02T20:00:00Z',
      durationS: 1_800,
      winner: 100,
      blueWinProb: 0.31,
      blue: [{ key: 'lena', role: 'adc', championId: 103, kills: 4, deaths: 1, assists: 2 }],
    });
    const facts = assembleFunFacts({
      window: 'this-month',
      games: [game],
      players: rosterFor([game]),
      range: MONTH,
      capped: false,
      cap: 2_000,
      timeZone: 'Africa/Cairo',
    });
    render(<FunView facts={facts} />);
    const card = screen.getByText(ODDS_TITLE).closest('.cn-card') as HTMLElement;

    expect(within(card).getByText(ODDS_NONE_TWICE)).toBeInTheDocument();
    expect(within(card).queryByText(ODDS_EMPTY)).not.toBeInTheDocument();
    expect(within(card).getByText('Blue won at 31%.')).toBeInTheDocument();
  });

  it('keeps the section on ARAM: it reads results, not the map', () => {
    render(<FunView facts={view({ queue: 'aram', gameMode: 'ARAM' })} />);
    expect(screen.getByText(ODDS_TITLE)).toBeInTheDocument();
  });

  it('draws nothing under the strip on an empty window', () => {
    const empty = assembleFunFacts({
      window: 'last-week',
      games: [],
      players: [],
      range: { start: new Date('2026-08-31T03:00:00Z'), end: new Date('2026-09-07T03:00:00Z') },
      capped: false,
      cap: 2_000,
      timeZone: 'Africa/Cairo',
    });
    render(<FunView facts={empty} />);
    expect(screen.queryByText('CS by role')).not.toBeInTheDocument();
  });
});
