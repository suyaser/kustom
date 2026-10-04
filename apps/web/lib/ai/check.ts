import 'server-only';
import type { AiClaim, AiFact, AiFactUnit, AiLineKind, AiLineStatus, AiTokenMap } from '@customs/db/schemas';
import { listChampions } from '../champs/names';
import { type AiGate, aiGateOpen } from '../premium';
import { CLEAR_LEAD_NOTE, CLOSE_RACE_NOTE, type FactList } from './facts';
import { AI_FEATURES } from './meter';

/**
 * The checker (M16.3; brief 4.4, decisions M16.1 D4 and D5): deterministic code, no second model.
 * A line is published only if **every** check passes; a rejected line is stored with the reason
 * and shown nowhere.
 *
 * 0. Characters: printable ASCII only, after `normalizeLine` maps curly quotes. Every check below
 *    reads ASCII, so a fullwidth or Arabic-Indic digit, a zero-width space inside `baron`, a
 *    combining mark, a fullwidth `Ｓａｍｉ` or a Cyrillic insult would walk past them: rejected first.
 * 1. Shape: one to two sentences for a game (220 characters), two to six for the week (600), two
 *    or three for a player (300). No links, emoji, markdown, mentions or line breaks.
 * 2. Player tokens: every `{Pn}` is in the facts; no other brace, no bare `P4`.
 * 3. Forbidden vocabulary: causal claims, events Kustom cannot see, odds, MVP/ACE, ratings on a
 *    game, advice in a scouting report, counterfactuals, and the insult and personal deny-list.
 * 4. Names: a capitalised word that is not a known champion, `Blue`, `Red`, a role, a weekday, a
 *    month or a game abbreviation is a possible invented name, mid-sentence **or** at the start of
 *    a sentence (where only common sentence openers pass).
 * 5. Champions: every champion named is in the facts, and belongs to a player the sentence names.
 * 6. Numbers: digits, `24.3k`, `14 of 19`, percentages, ordinals and number words (`four`,
 *    `twice`, `ninth`) each match a fact's value **and unit** (read off the words after it), and a
 *    player's number sits in a sentence that names that player.
 * 7. Absolute words (`most`, `best`, `first`, `only`, `never`, ...) only in a sentence whose
 *    player holds a fact claiming that word.
 * 8. Loser barbs (D5, "only the winning side can be teased"): a sentence that names a player of
 *    the losing side carries no negative-performance word (`died`, `fed`, `struggled`, ...).
 *
 * The checker errs towards silence: a false rejection costs one line, a false pass costs trust.
 */

export type CheckResult = { ok: true; text: string } | { ok: false; code: CheckCode; reason: string };

export type CheckCode =
  | 'characters'
  | 'shape'
  | 'token'
  | 'forbidden'
  | 'name'
  | 'champion'
  | 'number'
  | 'absolute'
  | 'barb';

/* ---------------------------------------------------------------------------------------------
 * Vocabulary
 * ------------------------------------------------------------------------------------------- */

const CHAMPIONS: readonly string[] = [...new Set(listChampions().map((entry) => entry.name))].sort(
  (a, b) => b.length - a.length,
);

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Capitalised words that are never a person. */
const ALLOWED_CAPS: ReadonlySet<string> = new Set([
  'Blue',
  'Red',
  'Kustom',
  'Top',
  'Jungle',
  'Mid',
  'ADC',
  'Bot',
  'Support',
  'CS',
  'KDA',
  'KP',
  'ARAM',
  'GG',
  'Rift',
  "Summoner's",
  'Rating',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]);

/**
 * Words a sentence may start with. A capitalised first word not in here (and not allowed
 * anywhere, a champion or a token) is treated as a possible name: `Sami carried.` is rejected.
 */
const SENTENCE_OPENERS: ReadonlySet<string> = new Set(
  `a about after again against all along also although an and another any anyway apparently around as at
  back behind being between big both but by call clean come could did different do does done down
  each easy either enough even ever everybody everyone everything far few for from full give go good
  great half hard he her here hers him his how however huge if in into is it it's its just keep kind
  last late less let let's like little long look lot make many maybe me meanwhile more much my nice no
  nobody none nor not nothing now of off on once one only or other our out over plenty pretty quick
  quiet quite rather really safe say she short simple since slow so solid some somebody someone
  something somehow soon still such sure take talk than that that's the their them then there these
  they this those though three through to today together tonight too two under until up very
  wait was way we well what what's when where which while who whoever why with without wow yes yet
  you your upset underdog underdogs`
    .split(/\s+/)
    .filter((word) => word !== ''),
);

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
  dozen: 12,
  once: 1,
  twice: 2,
  thrice: 3,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
  eleventh: 11,
  twelfth: 12,
  double: 2,
  triple: 3,
};

/** Unit words, read in the few words after a number. */
const UNIT_WORDS: Readonly<Record<string, AiFactUnit>> = {
  kill: 'kills',
  kills: 'kills',
  death: 'deaths',
  deaths: 'deaths',
  assist: 'assists',
  assists: 'assists',
  cs: 'cs',
  minion: 'cs',
  minions: 'cs',
  farm: 'cs',
  creep: 'cs',
  creeps: 'cs',
  damage: 'damage',
  dmg: 'damage',
  vision: 'vision',
  gold: 'gold',
  minute: 'minutes',
  minutes: 'minutes',
  min: 'minutes',
  mins: 'minutes',
  game: 'games',
  games: 'games',
  match: 'games',
  matches: 'games',
  win: 'wins',
  wins: 'wins',
  victory: 'wins',
  victories: 'wins',
  percent: 'percent',
  rating: 'rating',
  points: 'rating',
  climb: 'rating',
  place: 'place',
  spot: 'place',
  position: 'place',
};

/** Plural unit words a single `1` may not take (M16.14). */
const PLURAL_UNITS: ReadonlySet<string> = new Set([
  'kills',
  'deaths',
  'assists',
  'minions',
  'creeps',
  'minutes',
  'mins',
  'games',
  'matches',
  'wins',
  'victories',
  'points',
  'places',
  'spots',
  'positions',
  'streaks',
]);

/** A run of wins: `4 in a row`, `4 straight`, `a 4-game streak`. */
const STREAK_WORDS: ReadonlySet<string> = new Set(['row', 'straight', 'streak', 'consecutive', 'running']);

const ABSOLUTE_WORDS: Readonly<Record<string, AiClaim | 'never-backed'>> = {
  most: 'max',
  highest: 'max',
  best: 'max',
  biggest: 'max',
  longest: 'max',
  record: 'max',
  greatest: 'max',
  top: 'max',
  least: 'min',
  fewest: 'min',
  lowest: 'min',
  always: 'all',
  never: 'all',
  every: 'all',
  only: 'all',
  ever: 'all',
  unbeaten: 'all',
  undefeated: 'all',
  perfect: 'all',
  flawless: 'all',
  deathless: 'all',
  spotless: 'all',
  first: 'first',
  worst: 'never-backed',
};

/** Whole phrases, matched on the lower-cased line with champions and tokens blanked out. */
const FORBIDDEN: readonly { category: string; phrases: readonly string[]; kinds?: readonly AiLineKind[] }[] =
  [
    {
      category: 'causal claim',
      phrases: [
        'because',
        'due to',
        'thanks to',
        'owing to',
        'cost them',
        'cost him',
        'cost her',
        'cost the',
        'as a result',
        'led to',
        'leading to',
        'resulted in',
        'result of',
        'responsible for',
        'caused',
        'causing',
        'which is why',
        "that's why",
        'the reason',
        'so that',
      ],
    },
    {
      category: 'event Kustom cannot see',
      phrases: [
        'baron',
        'nashor',
        'dragon',
        'dragons',
        'drake',
        'drakes',
        'elder',
        'herald',
        'voidgrub',
        'voidgrubs',
        'grubs',
        'atakhan',
        'teamfight',
        'teamfights',
        'team fight',
        'team fights',
        'gank',
        'ganks',
        'ganked',
        'ganking',
        'steal',
        'steals',
        'stole',
        'stolen',
        'throw',
        'throws',
        'threw',
        'thrown',
        'throwing',
        'comeback',
        'came back',
        'first blood',
        'inhib',
        'inhibitor',
        'inhibitors',
        'tower',
        'towers',
        'turret',
        'turrets',
        'nexus',
        'pentakill',
        'penta',
        'quadra',
        'quadrakill',
        'triple kill',
        'double kill',
        'solo kill',
        'solo kills',
        'outplay',
        'outplayed',
        'flash',
        'ult',
        'ultimate',
        'smite',
        'backdoor',
        'invade',
        'invaded',
        'early game',
        'late game',
        'mid game',
        'laning',
        'lane phase',
        'snowball',
        'snowballed',
        'objective',
        'objectives',
        'dragon soul',
        'ward',
        'wards',
        'clutch',
      ],
    },
    {
      category: 'odds',
      phrases: [
        'odds',
        'chance',
        'chances',
        'probability',
        'likely',
        'unlikely',
        'favored',
        'favoured',
        'favorite',
        'favourite',
        'favorites',
        'favourites',
        'predicted',
        'prediction',
        'expected',
        'coin flip',
        'coinflip',
        'fifty-fifty',
        'win chance',
      ],
    },
    { category: 'odds', phrases: ['win rate', 'winrate'], kinds: ['game', 'week'] },
    { category: 'MVP or ACE', phrases: ['mvp', 'ace', 'aces'] },
    // M16.5: the storyline is read all week under `Last week`, beside a `This week` tab.
    { category: 'stale week word', phrases: ['this week', 'this weeks'], kinds: ['week'] },
    {
      category: 'rating on a game',
      phrases: ['rating', 'ratings', 'elo', 'mmr', 'lp', 'points', 'rank', 'ranked', 'climb', 'climbed'],
      kinds: ['game'],
    },
    {
      category: 'advice',
      phrases: ['should', 'needs to', 'need to', 'must', 'ought', 'has to', 'have to', 'try to', 'if only'],
      kinds: ['player'],
    },
    { category: 'stale week word', phrases: ['this week', 'this weeks'], kinds: ['week', 'player'] },
    {
      category: 'stale week word',
      phrases: ['last week', 'lately', 'recently', 'right now', 'these days', 'currently'],
      kinds: ['player'],
    },
    {
      // M16.19 (tone ruling): a losing week on a player's own page is a plain count, no adjective.
      category: 'adjective for a losing week',
      phrases: ['rough', 'rougher', 'tough', 'tougher', 'quiet', 'quieter', 'cold', 'colder'],
      kinds: ['player'],
    },
    {
      // M16.18: words about the writing itself -- the model narrating its own line or the rules.
      category: 'about the writing',
      phrases: [
        'tease',
        'teased',
        'teases',
        'teasing',
        'ribbing',
        'joke',
        'jokes',
        'joking',
        'roast',
        'roasted',
        'roasting',
        'rule',
        'rules',
        'fact',
        'facts',
        'fixed',
        'here is',
        "here's",
      ],
    },
    {
      category: 'counterfactual',
      phrases: ['could have', 'should have', 'would have', "could've", "would've"],
    },
    {
      category: 'insult or personal',
      phrases: [
        'noob',
        'noobs',
        'trash',
        'garbage',
        'bad',
        'terrible',
        'awful',
        'horrible',
        'useless',
        'idiot',
        'idiots',
        'stupid',
        'dumb',
        'moron',
        'loser',
        'losers',
        'pathetic',
        'clown',
        'clowns',
        'inted',
        'inting',
        'int',
        'inter',
        'feeder',
        'feeding',
        'griefer',
        'griefing',
        'toxic',
        'boosted',
        // M16.17 (tone ruling 2026-10-04): a winner is never carried, lucky, scripting or hacking.
        'got carried',
        'get carried',
        'gets carried',
        'getting carried',
        'carried by',
        'script',
        'scripts',
        'scripted',
        'scripting',
        'lucky',
        'luckily',
        'luck',
        'hack',
        'hacks',
        'hacked',
        'hacking',
        'hacker',
        'hardstuck',
        'washed',
        'choke',
        'choked',
        'choking',
        'embarrassing',
        'embarrassed',
        'embarrassment',
        'humiliated',
        'humiliating',
        'humiliation',
        'shame',
        'shameful',
        'cringe',
        'ugly',
        'fat',
        'old',
        'kid',
        'kids',
        'girl',
        'boy',
        'gay',
        'retard',
        'retarded',
        'kys',
        'hate',
        'worst',
        'suck',
        'sucks',
        'sucked',
        'lame',
        'weak',
        'weakest',
        'skill issue',
        'iron',
        'bronze',
        'silver',
        'platinum',
        'plat',
        'emerald',
        'diamond',
        'grandmaster',
        'challenger',
        'real life',
        'irl',
        'job',
        'girlfriend',
        'boyfriend',
        'wife',
        'husband',
        'mom',
        'mother',
        'dad',
        'father',
        'school',
        'country',
        'religion',
        'age',
      ],
    },
  ];

const FORBIDDEN_RES = FORBIDDEN.map((entry) => ({
  ...entry,
  res: entry.phrases.map((phrase) => ({
    phrase,
    re: new RegExp(`(?<![a-z'])${escapeRegex(phrase).replace(/ /g, '\\s+')}(?![a-z])`),
  })),
}));

/**
 * Words that put down a player's game. Never in a sentence that names someone who lost (D5): the
 * fact list gives a loser only their best numbers, and this keeps the words around them kind too.
 */
const LOSER_BARBS: readonly string[] = [
  'died',
  'dies',
  'dying',
  'death',
  'deaths',
  'feed',
  'feeds',
  'fed',
  'feeding',
  'threw',
  'lost it',
  'bad',
  'badly',
  'worst',
  'struggled',
  'struggle',
  'struggles',
  'struggling',
  'rough',
  'poor',
  'poorly',
  'weak',
  'failed',
  'fail',
  'flop',
  'flopped',
  'whiffed',
  'missed',
  'tilted',
  'behind',
  'outclassed',
  'stomped',
  'crushed',
  'destroyed',
  'dominated',
  'humbled',
  'ran it down',
  'invisible',
  'quiet game',
  'nothing',
  'barely',
  'only',
  // M16.9 r3: "at least" beside a loser is a dig, whatever follows it.
  'at least',
  // M16.8: what a losing player "could not" do is a barb too.
  "couldn't",
  'could not',
  "can't",
  'cannot',
  "wasn't enough",
  'not enough',
  'fell short',
  'in vain',
  'for nothing',
  'wasted',
];

/**
 * Story claims no number shows (DeepSeek A/B read, 2026-10-04; any provider). Closeness words need
 * a close-game note (a game's `close game`, a week's close race) and never sit beside a winner on a
 * game; margin words need a stated margin (a game's `lopsided game`, a week's clear lead); timing
 * inside the week needs a fact no list carries, so it is always refused there.
 */
const CLOSENESS_WORDS: readonly string[] = [
  'keep it close',
  'kept it close',
  'keeping it close',
  'kept things close',
  'keep things close',
  'close game',
  'close one',
  'close finish',
  'close race',
  'close call',
  'tight',
  'tighter',
  'nearly',
  'squeeze',
  'squeezed',
  'whisker',
  'edged',
  'edges',
  'to the wire',
  'neck and neck',
  'photo finish',
  'razor',
  'narrow',
  'narrowly',
];
/** On a game, `came close` is the losers nearly winning; on a week it is `nobody came close`. */
const GAME_CLOSENESS_EXTRA: readonly string[] = ['came close', 'so close'];
const MARGIN_WORDS: readonly string[] = [
  'ran away',
  'run away',
  'runs away',
  'running away',
  'runaway',
  'ran off with',
  'comfortable',
  'comfortably',
  'by a distance',
  'by a mile',
  'nobody got near',
  'got near',
  'came close',
  'got close',
  'well clear',
  'cruised',
  'cruise',
  'cruising',
  'out of reach',
  'out of sight',
  'miles ahead',
  'streets ahead',
  'pulled away',
  'never in doubt',
  'untouchable',
  'easy',
  'easily',
];
const WEEK_TIMING_WORDS: readonly string[] = [
  'early',
  'start to finish',
  'wire to wire',
  'from the front',
  'the whole way',
  'never looked back',
  'late in the week',
  'down the stretch',
  'midweek',
  'by the weekend',
  'opened the week',
  'closed the week',
  'to open the week',
  'got going',
  'over before',
  'before anyone',
  'all week',
  'closed with',
  'closed last week',
  'ended the week with',
  'ended last week with',
  'late',
];
const wordRes = (phrases: readonly string[]) =>
  phrases.map((phrase) => ({
    phrase,
    re: new RegExp(`(?<![a-z'])${escapeRegex(phrase).replace(/ /g, '\\s+')}(?![a-z])`),
  }));
const CLOSENESS_RES = wordRes(CLOSENESS_WORDS);
const GAME_CLOSENESS_RES = wordRes(GAME_CLOSENESS_EXTRA);
const MARGIN_RES = wordRes(MARGIN_WORDS);
const WEEK_TIMING_RES = wordRes(WEEK_TIMING_WORDS);
/** Words that make a sentence about the game even with no token, number or champion in it. */
const FACT_WORDS: ReadonlySet<string> = new Set([
  'blue',
  'red',
  'team',
  'teams',
  'underdog',
  'underdogs',
  'upset',
]);

/**
 * After `still`, what makes it a win despite something: `still won`, `still came through`, or a
 * take-verb with the win as its object (`still took the win`, `still got it`). `still took 8 kills`
 * on a winner reads as a loss (round-2 read, Gr-15 B: `Zizo still took`).
 */
const STILL_WON: ReadonlySet<string> = new Set(['won', 'win', 'wins', 'came']);
const STILL_TOOK: ReadonlySet<string> = new Set(['got', 'took', 'takes', 'picked', 'grabbed', 'pulled']);
const STILL_TOOK_OBJECT = /^(it|the win|a win|the game|up the win|out the win|off the win)\b/;

function stillWon(sentence: readonly Tok[], at: number): boolean {
  const next = sentence[at + 1];
  if (next?.t !== 'word') return false;
  if (STILL_WON.has(next.lower)) return true;
  if (!STILL_TOOK.has(next.lower)) return false;
  const rest = sentence
    .slice(at + 2, at + 5)
    .map((tok) => (tok.t === 'word' ? tok.lower : '_'))
    .join(' ');
  return STILL_TOOK_OBJECT.test(rest);
}

/** Closeness, margin, timing, a doubled streak and a sentence with no fact in it. */
function checkStoryClaims(list: FactList, sentences: readonly Tok[][]): CheckResult | null {
  const notes = list.facts.flatMap((fact) => (fact.token === null ? fact.notes : []));
  const closeFact =
    list.kind === 'game'
      ? notes.some((note) => note.startsWith('close game'))
      : list.kind === 'week' && notes.includes(CLOSE_RACE_NOTE);
  const marginFact =
    list.kind === 'game'
      ? notes.includes('lopsided game')
      : list.kind === 'week' && notes.includes(CLEAR_LEAD_NOTE);
  const winners = new Set(
    list.facts.flatMap((fact) => (fact.token !== null && fact.notes.includes('won') ? [fact.token] : [])),
  );
  for (const sentence of sentences) {
    const words = ` ${sentence.map((tok) => (tok.t === 'word' ? tok.lower : '_')).join(' ')} `;
    // A doubled streak: `4 wins in a row, their longest run of wins in a row`.
    if ((words.match(/\bin\s+a\s+row\b/g) ?? []).length > 1 || /\brun\s+of\s+wins\b/.test(words))
      return reject('shape', 'wins in a row said twice in one sentence');
    const hasFact = sentence.some(
      (tok) =>
        tok.t === 'ptoken' ||
        tok.t === 'num' ||
        tok.t === 'champ' ||
        (tok.t === 'word' && FACT_WORDS.has(tok.lower)),
    );
    if (!hasFact) return reject('shape', 'a sentence with no fact in it');
    // Margin first, so `nobody came close` on a week reads as a margin claim.
    const marginRes = list.kind === 'player' ? [] : MARGIN_RES;
    for (const { phrase, re } of list.kind === 'game'
      ? marginRes.filter((m) => m.phrase !== 'came close')
      : marginRes) {
      if (re.test(words) && !marginFact)
        return reject('forbidden', `a margin the facts do not state: "${phrase}"`);
    }
    const closeRes = list.kind === 'game' ? [...CLOSENESS_RES, ...GAME_CLOSENESS_RES] : CLOSENESS_RES;
    for (const { phrase, re } of closeRes) {
      if (!re.test(words)) continue;
      if (!closeFact) return reject('forbidden', `a close finish the facts do not state: "${phrase}"`);
      if (list.kind === 'game' && sentence.some((tok) => tok.t === 'ptoken' && winners.has(tok.token)))
        return reject('forbidden', `"${phrase}" beside a player who won`);
    }
    // `still` on a winner reads as a loss (A/B read): only `still won`, `still got the win`, ...
    // Since a recap must name a winner (2026-10-04), `still` belongs to its own player -- the
    // nearest token before it, else the first after -- so `{P2} won, and {P8} still had` passes.
    if (list.kind === 'game') {
      for (let i = 0; i < sentence.length; i += 1) {
        const tok = sentence[i] as Tok;
        if (tok.t !== 'word' || tok.lower !== 'still') continue;
        const owner = ownerAt(sentence, i);
        if (owner === null || !winners.has(owner)) continue;
        if (stillWon(sentence, i)) continue;
        return reject('forbidden', '"still" beside a player who won');
      }
    }
    if (list.kind !== 'game') {
      for (const { phrase, re } of WEEK_TIMING_RES) {
        if (re.test(words)) return reject('forbidden', `timing inside the week no fact shows: "${phrase}"`);
      }
      if (/\bput\b(?:\s+\S+){0,4}\s+to\s+bed\b/.test(words))
        return reject('forbidden', 'timing inside the week no fact shows: "put ... to bed"');
    }
  }
  return null;
}

/**
 * The sides of a game (product's round-2 read, 2026-10-04; any provider). A recap is about the game
 * the winners won, so it names at least one of them (six loser-only lines in the read); and a near
 * win is never a fact (`Red nearly took the win` on a close kill count), so no sentence says anyone
 * nearly won, and no sentence about the losing side says nearly or almost at all.
 */
const NEAR_WIN_RE =
  /\b(nearly|almost)\s+(won|win|wins|took|take|takes|stole|steal|snatched|snatch|pulled|pull|had|got|came|stopped|stop|turned|turn|forced|force|flipped|flip|closed|close|clawed|dragged|made)\b/;

function checkGameSides(list: FactList, sentences: readonly Tok[][]): CheckResult | null {
  if (list.kind !== 'game') return null;
  const winners = new Set<string>();
  const losers = new Set<string>();
  let winningSide: 100 | 200 | null = null;
  for (const fact of list.facts) {
    if (fact.token === null) continue;
    if (fact.notes.includes('won')) {
      winners.add(fact.token);
      if (fact.side !== null) winningSide = fact.side;
    } else if (fact.notes.includes('lost')) losers.add(fact.token);
  }
  const losingWord = winningSide === null ? null : winningSide === 100 ? 'red' : 'blue';
  const winningWord = winningSide === null ? null : winningSide === 100 ? 'blue' : 'red';
  // A winner's token, the winning side (`Blue won`) or, on an upset, the underdogs. Only when a
  // winner is in the facts at all (every winner opted out leaves nobody to name).
  if (winners.size > 0) {
    const namesWinner = sentences.some((sentence) =>
      sentence.some(
        (tok) =>
          (tok.t === 'ptoken' && winners.has(tok.token)) ||
          (tok.t === 'word' &&
            (tok.lower === winningWord ||
              (list.upset && (tok.lower === 'underdog' || tok.lower === 'underdogs')))),
      ),
    );
    if (!namesWinner) return reject('shape', 'a game line that names nobody from the winning team');
  }
  for (const sentence of sentences) {
    const words = ` ${sentence.map((tok) => (tok.t === 'word' ? tok.lower : '_')).join(' ')} `;
    if (NEAR_WIN_RE.test(words)) return reject('forbidden', 'a near win, which no fact shows');
    const aboutLosers = sentence.some(
      (tok) =>
        (tok.t === 'ptoken' && losers.has(tok.token)) || (tok.t === 'word' && tok.lower === losingWord),
    );
    if (aboutLosers && /\b(almost|nearly)\b/.test(words))
      return reject('forbidden', '"almost" or "nearly" about the losing side');
  }
  return null;
}

/**
 * Fact-label echoes and role verbs (product's round-2 read, 2026-10-04; any provider). A label
 * copied into the line reads like a form (`the week before this report`, `bot lane carry (ADC)`,
 * `added Blitzcrank with 1 game on Blitzcrank`); and owning a role (owns, holds, runs, anchors,
 * rules) is praise a losing or level record there does not earn (`owns top lane` on 24 wins in 58).
 */
const ROLE_VERB_RE =
  /^(own|owns|owned|owning|hold|holds|held|holding|run|runs|ran|running|anchor|anchors|anchored|anchoring|rule|rules|ruled|ruling)$/;
const ROLE_OF_WORD: Readonly<Record<string, string>> = {
  top: 'top',
  jungle: 'jungle',
  mid: 'mid',
  middle: 'mid',
  bot: 'adc',
  adc: 'adc',
  carry: 'adc',
  support: 'support',
};

/** A scouting role fact's note (`role: bot lane`) as one of {@link ROLE_OF_WORD}'s values. */
function roleOfNote(note: string): string | null {
  if (!note.startsWith('role: ')) return null;
  const first = note.slice('role: '.length).split(' ')[0] ?? '';
  return ROLE_OF_WORD[first] ?? null;
}

function checkLabelEchoes(list: FactList, text: string, sentences: readonly Tok[][]): CheckResult | null {
  if (/\bbefore\s+this\s+report\b/i.test(text))
    return reject('forbidden', 'a fact label copied: "before this report"');
  if (/\(\s*adc\s*\)/i.test(text)) return reject('forbidden', 'a fact label copied: "(ADC)"');
  for (const sentence of sentences) {
    // `picked up Hecarim with 1 game on Hecarim`: the champion said twice around its own count.
    for (let i = 0; i + 4 < sentence.length; i += 1) {
      const [w, n, g, on, champ] = sentence.slice(i, i + 5) as [Tok, Tok, Tok, Tok, Tok];
      if (
        w.t === 'word' &&
        w.lower === 'with' &&
        n.t === 'num' &&
        g.t === 'word' &&
        /^games?$/.test(g.lower) &&
        on.t === 'word' &&
        on.lower === 'on' &&
        champ.t === 'champ' &&
        sentence.slice(0, i).some((tok) => tok.t === 'champ' && tok.name === champ.name)
      )
        return reject('forbidden', `a fact label copied: "with ${n.raw} ${g.raw} on ${champ.name}"`);
    }
  }
  if (list.kind !== 'player') return null;
  const records = new Map<string, { games: number; wins: number }>();
  for (const fact of list.facts) {
    const role = fact.notes.map(roleOfNote).find((r) => r !== null);
    if (role === undefined || role === null) continue;
    const games = fact.values.find((v) => v.unit === 'games')?.value;
    const wins = fact.values.find((v) => v.unit === 'wins')?.value;
    if (games !== undefined && wins !== undefined) records.set(role, { games, wins });
  }
  for (const sentence of sentences) {
    for (let i = 0; i < sentence.length; i += 1) {
      const tok = sentence[i] as Tok;
      if (tok.t !== 'word' || !ROLE_VERB_RE.test(tok.lower)) continue;
      // The role named within the next five words or numbers (`runs the group through jungle`,
      // `holds 28 games in support`); a token or a champion ends the reach.
      for (let j = i + 1; j < sentence.length && j <= i + 5; j += 1) {
        const ahead = sentence[j] as Tok;
        if (ahead.t === 'num') continue;
        if (ahead.t !== 'word') break;
        const role = ROLE_OF_WORD[ahead.lower];
        if (role === undefined) continue;
        const record = records.get(role);
        // A losing or level record there (or none in the facts) owns nothing.
        if (record === undefined || record.wins * 2 <= record.games)
          return reject('forbidden', `"${tok.raw}" ${ahead.raw} without a winning record there`);
        break;
      }
    }
  }
  return null;
}

const LOSER_BARB_RES = LOSER_BARBS.map((phrase) => ({
  phrase,
  re: new RegExp(`(?<![a-z'])${escapeRegex(phrase).replace(/ /g, '\\s+')}(?![a-z])`),
}));

/* ---------------------------------------------------------------------------------------------
 * Tokenising
 * ------------------------------------------------------------------------------------------- */

type Tok =
  | { t: 'ptoken'; token: string }
  | { t: 'badtoken'; raw: string }
  | { t: 'champ'; name: string }
  | { t: 'num'; value: number; raw: string; thousands: boolean; decimals: number; percent: boolean }
  | { t: 'word'; raw: string; lower: string }
  | { t: 'end' };

const MASTER = new RegExp(
  [
    '(\\{P[1-9]\\d?\\})', // 1 player token
    '(\\{[^}]*\\}?|\\})', // 2 any other brace
    `(?<![A-Za-z])(${CHAMPIONS.map(escapeRegex).join('|')})(?![A-Za-z])`, // 3 champion
    '(\\d[\\d,]*(?:\\.\\d+)?)(k(?![a-z]))?(?:st|nd|rd|th)?(\\s?%)?', // 4 number, 5 k, 6 percent
    "([A-Za-z][A-Za-z']*)", // 7 word
    '([.!?]+)', // 8 sentence end
  ].join('|'),
  'g',
);

function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  for (const match of text.matchAll(MASTER)) {
    const [, ptoken, brace, champ, num, k, pct, word, end] = match;
    if (ptoken !== undefined) out.push({ t: 'ptoken', token: ptoken.slice(1, -1) });
    else if (brace !== undefined) out.push({ t: 'badtoken', raw: brace });
    else if (champ !== undefined) out.push({ t: 'champ', name: champ });
    else if (num !== undefined) {
      const plain = num.replace(/,/g, '');
      const decimals = plain.includes('.') ? (plain.split('.')[1] ?? '').length : 0;
      const base = Number(plain);
      out.push({
        t: 'num',
        value: k === undefined ? base : base * 1000,
        raw: match[0],
        thousands: k !== undefined,
        decimals,
        percent: pct !== undefined,
      });
    } else if (word !== undefined) {
      const lower = word.toLowerCase().replace(/'s$/, '');
      const n = NUMBER_WORDS[lower];
      if (n !== undefined) {
        out.push({ t: 'num', value: n, raw: word, thousands: false, decimals: 0, percent: false });
      } else {
        out.push({ t: 'word', raw: word, lower: word.toLowerCase() });
      }
    } else if (end !== undefined) out.push({ t: 'end' });
  }
  return out;
}

function sentencesOf(toks: readonly Tok[]): Tok[][] {
  const sentences: Tok[][] = [];
  let current: Tok[] = [];
  for (const tok of toks) {
    if (tok.t === 'end') {
      if (current.length > 0) sentences.push(current);
      current = [];
    } else current.push(tok);
  }
  if (current.length > 0) sentences.push(current);
  return sentences;
}

/* ---------------------------------------------------------------------------------------------
 * The checks
 * ------------------------------------------------------------------------------------------- */

const reject = (code: CheckCode, reason: string): CheckResult => ({ ok: false, code, reason });

/** Normalises what a model wraps a line in: outer quotes, curly apostrophes, spaces. */
export function normalizeLine(raw: string): string {
  let text = raw.replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').trim();
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) text = text.slice(1, -1).trim();
  return text.replace(/[ \t]+/g, ' ');
}

function factsBy(list: FactList) {
  const byToken = new Map<string, AiFact[]>();
  for (const fact of list.facts) {
    if (fact.token === null) continue;
    const facts = byToken.get(fact.token) ?? [];
    facts.push(fact);
    byToken.set(fact.token, facts);
  }
  const sideOfToken = new Map<string, 100 | 200>();
  for (const fact of list.facts)
    if (fact.token !== null && fact.side !== null) sideOfToken.set(fact.token, fact.side);
  return { byToken, sideOfToken };
}

/** Does `n` (as written) equal `target`? `24.3k` matches 24312; `24k` matches 24312 too. */
function sameNumber(tok: Extract<Tok, { t: 'num' }>, target: number): boolean {
  if (tok.thousands) {
    const scale = 1000 / 10 ** tok.decimals;
    return Math.round(target / scale) === Math.round(tok.value / scale);
  }
  if (tok.decimals > 0) return Math.abs(Number(target.toFixed(tok.decimals)) - tok.value) < 1e-9;
  return target === tok.value;
}

/** The unit named in the next few words after position `from`, or null. */
function unitAfter(sentence: readonly Tok[], from: number): { unit: AiFactUnit; streak: boolean } | null {
  let unit: AiFactUnit | null = null;
  let streak = false;
  let words = 0;
  for (let i = from; i < sentence.length && words < 4; i += 1) {
    const tok = sentence[i] as Tok;
    if (tok.t !== 'word') break;
    words += 1;
    const lower = tok.lower.replace(/'s$/, '');
    if (STREAK_WORDS.has(lower)) streak = true;
    if (unit === null && UNIT_WORDS[lower] !== undefined) unit = UNIT_WORDS[lower] as AiFactUnit;
    if (lower === 'score' && unit === null) unit = 'cs';
  }
  // `in a row` sits after the unit word: look a little further for it.
  for (let i = from; i < sentence.length && i < from + 7; i += 1) {
    const tok = sentence[i] as Tok;
    if (tok.t !== 'word') break;
    if (STREAK_WORDS.has(tok.lower)) streak = true;
  }
  if (streak && (unit === null || unit === 'wins' || unit === 'games')) return { unit: 'streak', streak };
  return unit === null ? null : { unit, streak };
}

/** The player a scouting report is about: always the first token (`buildPlayerFacts`). */
const SCOUTING_SUBJECT = 'P1';

/**
 * Whether a scouting fact owned by `factToken` may back a number whose nearest token is `owner`
 * (M16.19 r2). The subject's facts need the subject as owner (or a sentence naming nobody). The
 * duo partner's fact (games and wins together) binds to the partner, or is quoted from the
 * subject's side when the partner is named in the same sentence: `{P1} has 11 games with {P2}`.
 */
function scoutingOwns(factToken: string, owner: string | null, tokensHere: ReadonlySet<string>): boolean {
  const who = owner ?? SCOUTING_SUBJECT;
  // M16.19 r3: a sentence that names the partner carries duo numbers only, never the subject's.
  const namesPartner = [...tokensHere].some((token) => token !== SCOUTING_SUBJECT);
  if (factToken === SCOUTING_SUBJECT) return who === SCOUTING_SUBJECT && !namesPartner;
  return who === factToken || (who === SCOUTING_SUBJECT && tokensHere.has(factToken));
}

/**
 * Whether a scouting claim may back an absolute in this sentence (M16.19 r3). The subject's claims
 * always; the duo partner's claim (most wins together) only in a sentence that says `together` or
 * `with {P1}`, so a bare `{P2} has the most wins` is never backed by it.
 */
function scoutingClaimApplies(factToken: string | null, sentence: readonly Tok[]): boolean {
  if (factToken === null || factToken === SCOUTING_SUBJECT) return true;
  return sentence.some(
    (tok, i) =>
      (tok.t === 'word' && tok.lower === 'together') ||
      (tok.t === 'word' &&
        tok.lower === 'with' &&
        sentence[i + 1]?.t === 'ptoken' &&
        (sentence[i + 1] as { token: string }).token === SCOUTING_SUBJECT),
  );
}

/**
 * The player a number or champion at `index` belongs to (M16.11): the nearest `{Pn}` before it in
 * the sentence, or, when none comes before, the first one after it. Null for a sentence with none.
 */
function ownerAt(sentence: readonly Tok[], index: number): string | null {
  for (let j = index - 1; j >= 0; j -= 1) {
    const tok = sentence[j] as Tok;
    if (tok.t === 'ptoken') return tok.token;
  }
  for (let j = index + 1; j < sentence.length; j += 1) {
    const tok = sentence[j] as Tok;
    if (tok.t === 'ptoken') return tok.token;
  }
  return null;
}

function checkNumbers(list: FactList, sentences: readonly Tok[][]): CheckResult | null {
  const { sideOfToken } = factsBy(list);
  for (const sentence of sentences) {
    const tokensHere = new Set(sentence.flatMap((tok) => (tok.t === 'ptoken' ? [tok.token] : [])));
    const lowerWords = new Set(
      sentence.flatMap((tok) => (tok.t === 'word' ? [tok.lower.replace(/'s$/, '')] : [])),
    );
    const sidesHere = new Set<100 | 200>();
    if (lowerWords.has('blue')) sidesHere.add(100);
    if (lowerWords.has('red')) sidesHere.add(200);
    for (const tokenHere of tokensHere) {
      const side = sideOfToken.get(tokenHere);
      if (side !== undefined && (lowerWords.has('team') || lowerWords.has('side'))) sidesHere.add(side);
    }

    for (let i = 0; i < sentence.length; i += 1) {
      const tok = sentence[i] as Tok;
      if (tok.t !== 'num') continue;
      const at = i;
      // `no one`, `every one`, `any one`: not a number.
      const prev = sentence[i - 1];
      if (
        tok.raw.toLowerCase() === 'one' &&
        prev?.t === 'word' &&
        ['no', 'every', 'any', 'the'].includes(prev.lower)
      ) {
        continue;
      }

      // `14 of 19 kills`, `14 of Blue's 19 kills`, `14 of the team's 19 kills`.
      let of: Extract<Tok, { t: 'num' }> | null = null;
      let after = i + 1;
      const next = sentence[i + 1];
      if (next?.t === 'word' && next.lower === 'of') {
        for (let j = i + 2; j < sentence.length && j <= i + 4; j += 1) {
          const ahead = sentence[j] as Tok;
          if (ahead.t === 'num') {
            of = ahead;
            after = j + 1;
            break;
          }
          if (ahead.t !== 'word') break;
        }
        if (of !== null) i = after - 1; // the `of` number is consumed with this one
      }

      const unit = tok.percent ? { unit: 'percent' as const, streak: false } : unitAfter(sentence, after);
      if (unit === null) return reject('number', `"${tok.raw}" has no unit next to it`);

      // M16.14: a single one takes a singular unit (`1 kill`, `1 death`, `1 game`), never `1 kills`.
      // `1 of 19 team kills` is a share, plural on purpose.
      const nextWord = sentence[after];
      if (
        of === null &&
        !tok.percent &&
        !tok.thousands &&
        tok.decimals === 0 &&
        tok.value === 1 &&
        nextWord?.t === 'word' &&
        PLURAL_UNITS.has(nextWord.lower)
      ) {
        return reject('number', `"${tok.raw} ${nextWord.raw}": one takes a singular unit`);
      }

      const candidates = list.facts.filter((fact) =>
        fact.values.some(
          (v) =>
            v.unit === unit.unit &&
            sameNumber(tok, v.value) &&
            // `14 kills` is never the `14` of `14 of 19 team kills they took part in`.
            (of === null ? v.of === undefined : v.of !== undefined && sameNumber(of, v.of)),
        ),
      );
      if (candidates.length === 0) {
        const written = of === null ? tok.raw : `${tok.raw} of ${of.raw}`;
        return reject('number', `"${written} ${unit.unit}" is not in the facts`);
      }
      // M16.11: a player's number belongs to the token nearest before it (or, with none before, the
      // first after it): `{P1} had 8 kills and {P2} had 20 kills` binds 8 to P1 and 20 to P2.
      const owner = ownerAt(sentence, at);
      const bound = candidates.some((fact) => {
        if (fact.token !== null)
          return list.kind === 'player' ? scoutingOwns(fact.token, owner, tokensHere) : fact.token === owner;
        if (fact.side !== null) return sidesHere.has(fact.side);
        return true;
      });
      if (!bound) return reject('number', `"${tok.raw}" is not in a sentence with the player it belongs to`);

      // A percentage about a side with no player is how odds get written. M16.13 (precision): a
      // scouting report is about one player and carries no side at all, so its percent is that
      // player's (it matched one of their facts above), never odds.
      if (unit.unit === 'percent' && tokensHere.size === 0 && list.kind !== 'player') {
        return reject('forbidden', `"${tok.raw}" is a percentage about a side (odds)`);
      }
    }
  }
  return null;
}

/** The units a claim's own words name (`most CS in the game` -> cs). */
function unitsOfText(text: string): Set<AiFactUnit> {
  const units = new Set<AiFactUnit>();
  for (const word of text.toLowerCase().split(/[^a-z']+/)) {
    const unit = UNIT_WORDS[word.replace(/'s$/, '')];
    if (unit !== undefined) units.add(unit);
  }
  return units;
}

function checkAbsolutes(list: FactList, sentences: readonly Tok[][]): CheckResult | null {
  const { byToken } = factsBy(list);
  for (const sentence of sentences) {
    // M16.19 r2: the tokens the sentence names; a scouting sentence that names nobody is about the
    // report's subject, P1 (and never about the duo partner).
    const named = sentence.flatMap((tok) => (tok.t === 'ptoken' ? [tok.token] : []));
    const tokensHere = list.kind === 'player' && named.length === 0 ? [SCOUTING_SUBJECT] : named;
    for (let i = 0; i < sentence.length; i += 1) {
      const tok = sentence[i] as Tok;
      if (tok.t !== 'word') continue;
      const lower = tok.lower;
      // `top` is also a lane: `Top` mid-sentence (the role), `top lane`, `top laner`, `in top`.
      if (lower === 'top') {
        const next = sentence[i + 1];
        const prev = sentence[i - 1];
        const lane =
          (tok.raw === 'Top' && i > 0) ||
          (next?.t === 'word' && /^lane/.test(next.lower)) ||
          (prev?.t === 'word' &&
            ['in', 'at', 'the', 'from', 'on', 'plays', 'played', 'playing'].includes(prev.lower) &&
            next?.t !== 'word');
        if (lane) continue;
      }
      const group = ABSOLUTE_WORDS[lower];
      if (group === undefined) continue;
      if (group === 'never-backed') return reject('absolute', `"${tok.raw}" is never allowed`);
      // `most kills` needs a `most ... kills` claim, not any `most` claim: the unit named in the
      // next few words must be one the claim names too.
      let unit: AiFactUnit | null = null;
      for (let j = i + 1; j < sentence.length && j <= i + 5; j += 1) {
        const ahead = sentence[j] as Tok;
        if (ahead.t !== 'word') break;
        const found = UNIT_WORDS[ahead.lower.replace(/'s$/, '')];
        if (found !== undefined) {
          unit = found;
          break;
        }
      }
      // M16.15 follow-up: `longest` needs a claim that says longest, and whose: `their longest run`
      // is the player's own record (the streak claim); `the longest run in the group` would be a
      // group record, which only a claim without `their` can back (none exists today).
      const prev = sentence[i - 1];
      const own = prev?.t === 'word' && prev.lower === 'their';
      const longestBacked = (text: string) =>
        lower !== 'longest' ||
        (own ? /\btheir longest\b/.test(text) : /\blongest\b/.test(text) && !/\btheir longest\b/.test(text));
      const backed = tokensHere.some((token) =>
        (byToken.get(token) ?? []).some(
          (fact) =>
            (list.kind !== 'player' || scoutingClaimApplies(fact.token, sentence)) &&
            fact.claims.some(
              (c) =>
                c.claim === group &&
                longestBacked(c.text) &&
                (unit === null || group === 'all' || group === 'first' || unitsOfText(c.text).has(unit)),
            ),
        ),
      );
      if (!backed) {
        const what = unit === null ? `"${lower}"` : `"${lower} ... ${unit}"`;
        return reject('absolute', `${what} without a fact that says so for that player`);
      }
    }
  }
  return null;
}

/* ---------------------------------------------------------------------------------------------
 * Idioms (M16.9)
 * ------------------------------------------------------------------------------------------- */

/**
 * An exact phrase the checks would read literally (`made the most of` as a `most` claim, `this one`
 * as a number, `top three` as a superlative). Matched case-insensitively on whole words, never
 * when a unit word follows (`this one kill`, `top three kills` stay numbers), and only where
 * `allowed` holds for the sentence it sits in. A matched idiom becomes a neutral word for every
 * check after the shape checks; the stored text is unchanged. Where `allowed` fails, a `reject`
 * idiom refuses the line outright (a place claim the board does not back); any other stays as
 * written for the checks below (`at least` stays an absolute and a barb). Longest phrases first.
 */
export interface Idiom {
  phrase: string;
  kinds?: readonly AiLineKind[];
  /** The sentence's player tokens and the fact list: may the idiom stand here? */
  allowed?: (tokens: readonly string[], list: FactList) => boolean;
  /** Only when a written number follows (`only 6 games`): the number is then checked on its own. */
  numberAfter?: boolean;
  /** A failed `allowed` refuses the line instead of leaving the words to the other checks. */
  reject?: boolean;
}

/** No player in the sentence lost: words that can sting stay barbs next to a loser (D5). */
function noLoserNamed(tokens: readonly string[], list: FactList): boolean {
  return tokens.every(
    (token) => !list.facts.some((fact) => fact.token === token && fact.notes.includes('lost')),
  );
}

/** Every token in the sentence holds a place on the week's board at or above `n`. */
function placesWithin(n: number) {
  return (tokens: readonly string[], list: FactList): boolean =>
    tokens.every((token) =>
      list.facts.some(
        (fact) =>
          fact.token === token && fact.values.some((v) => v.unit === 'place' && v.value >= 1 && v.value <= n),
      ),
    );
}

/**
 * `at least` + a number: no loser named, and on a week nobody below 3rd place (M16.9 r2). Elsewhere
 * it stays a `least` absolute and a barb (`{P10} at least showed up`).
 */
function atLeastAllowed(tokens: readonly string[], list: FactList): boolean {
  return noLoserNamed(tokens, list) && (list.kind !== 'week' || placesWithin(3)(tokens, list));
}

export const IDIOMS: readonly Idiom[] = [
  // No claim at all: "made the most of a short week".
  { phrase: 'made the most of' },
  { phrase: 'make the most of' },
  { phrase: 'makes the most of' },
  { phrase: 'making the most of' },
  // A lower bound before a number, which is still checked on its own; never a dig at someone.
  { phrase: 'at least', numberAfter: true, allowed: atLeastAllowed },
  // "one" as a pronoun, not a count.
  { phrase: 'this one' },
  { phrase: 'that one' },
  { phrase: 'a close one' },
  { phrase: 'a tight one' },
  { phrase: 'one-sided' },
  // The week's board always has a top; naming a player there needs their place on it.
  { phrase: 'at the top', kinds: ['week'], allowed: placesWithin(1), reject: true },
  // The race, not a player: anyone named beside it must be on the podium.
  { phrase: 'the race at the top', kinds: ['week'], allowed: placesWithin(3), reject: true },
  { phrase: 'the race up top', kinds: ['week'], allowed: placesWithin(3), reject: true },
  // `only 6 games`: a count, not a uniqueness claim, and never next to a player who lost.
  { phrase: 'only', numberAfter: true, allowed: noLoserNamed },
  { phrase: 'top two', kinds: ['week'], allowed: placesWithin(2), reject: true },
  { phrase: 'top three', kinds: ['week'], allowed: placesWithin(3), reject: true },
  { phrase: 'top 3', kinds: ['week'], allowed: placesWithin(3), reject: true },
  { phrase: 'top five', kinds: ['week'], allowed: placesWithin(5), reject: true },
];

const UNIT_AFTER = new RegExp(
  `^[\\s,]+(${Object.keys(UNIT_WORDS).map(escapeRegex).join('|')})(?![a-z])`,
  'i',
);

const IDIOM_RES = [...IDIOMS]
  .sort((a, b) => b.phrase.length - a.phrase.length)
  .map((idiom) => ({
    idiom,
    re: new RegExp(`(?<![A-Za-z'-])${escapeRegex(idiom.phrase).replace(/ /g, '\\s+')}(?![A-Za-z'-])`, 'gi'),
  }));

/**
 * The text with every allowed idiom replaced by a neutral lowercase word, and the first `reject`
 * idiom whose guard failed (the line is then refused).
 */
export function neutralizeIdioms(text: string, list: FactList): { text: string; refused: string | null } {
  let out = text;
  let refused: string | null = null;
  for (const { idiom, re } of IDIOM_RES) {
    if (idiom.kinds !== undefined && !idiom.kinds.includes(list.kind)) continue;
    out = out.replace(re, (match, offset: number, whole: string) => {
      const rest = whole.slice(offset + match.length);
      if (idiom.numberAfter === true) {
        if (!/^\s+\d/.test(rest)) return match;
      } else if (UNIT_AFTER.test(rest)) return match;
      if (idiom.allowed !== undefined) {
        const start = Math.max(
          whole.lastIndexOf('.', offset),
          whole.lastIndexOf('!', offset),
          whole.lastIndexOf('?', offset),
        );
        const ends = [rest.indexOf('.'), rest.indexOf('!'), rest.indexOf('?')].filter((i) => i >= 0);
        const end = offset + match.length + (ends.length > 0 ? Math.min(...ends) : rest.length);
        const sentence = whole.slice(start + 1, end);
        const tokens = [...sentence.matchAll(/\{(P[1-9]\d?)\}/g)].map((m) => m[1] as string);
        if (!idiom.allowed(tokens, list)) {
          if (idiom.reject === true && refused === null) refused = idiom.phrase;
          return match;
        }
      }
      return 'idiomword';
    });
  }
  return { text: out, refused };
}

/**
 * Checks one model output against the fact list it was written from. `text` in a pass is the
 * normalised line, `{Pn}` tokens kept: that is what is stored.
 */
export function checkLine(
  raw: string,
  list: FactList,
  /** The API's `stop_reason` (M16.14): `max_tokens` means the line was cut off mid-sentence. */
  options: { stopReason?: string | null } = {},
): CheckResult {
  const feature = AI_FEATURES[list.kind];
  const text = normalizeLine(raw);

  // 1. Shape.
  if (options.stopReason === 'max_tokens') return reject('shape', 'cut off at max_tokens');
  if (text === '') return reject('shape', 'empty');
  if (/[\r\n]/.test(text)) return reject('shape', 'line break');
  // M16.14: a line ends a sentence; `{P1} led the way with 20 kills on Ezreal and the` does not.
  if (!/[.!?]$/.test(text)) return reject('shape', 'no full stop at the end');

  // 0. Characters: printable ASCII only (curly quotes were mapped by normalizeLine).
  const foreign = /[^\x20-\x7E]/u.exec(text);
  if (foreign !== null) {
    const code = (foreign[0].codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0');
    return reject('characters', `a character outside plain ASCII (U+${code})`);
  }
  if (text.length > feature.maxChars)
    return reject('shape', `${text.length} characters, over ${feature.maxChars}`);
  if (/https?:|www\.|\.(com|gg|net|org|io|app)\b/i.test(text)) return reject('shape', 'a link');
  if (/\p{Extended_Pictographic}/u.test(text)) return reject('shape', 'an emoji');
  if (/[*_`#~|<>[\]@\\"]/.test(text)) return reject('shape', 'markdown, a quote or a mention character');
  if (/(^|[^{])\bP\d{1,2}\b/.test(text.replace(/\{P\d{1,2}\}/g, '')))
    return reject('token', 'a player token without braces');
  // DeepSeek eval (2026-10-04): both were prompt-only rules; DeepSeek broke them, and Claude's own
  // eval month broke the pronoun one in 4 of 102 replies (`Elise made her debut`). A place always
  // has its ending (`1st place`, never `1 place`); no gendered pronoun, not even for a champion
  // (`on her`), since the model cannot know who anyone is.
  if (/\b\d+\s+place\b/i.test(text)) return reject('number', 'a place without its ending (1st place)');
  const gendered = /\b(he|she|him|his|her|hers|himself|herself)\b/i.exec(text);
  if (gendered !== null) return reject('forbidden', `a gendered pronoun: "${gendered[0]}"`);

  // Exact idioms that read literally as a number or an absolute (M16.9): each is a neutral word to
  // the checks below, and only where its own guard holds. Everything else is checked as written.
  const idioms = neutralizeIdioms(text, list);
  if (idioms.refused !== null)
    return reject('absolute', `"${idioms.refused}" names a player the week's board does not put there`);
  const toks = tokenize(idioms.text);
  const sentences = sentencesOf(toks);
  if (sentences.length < feature.minSentences || sentences.length > feature.maxSentences) {
    return reject(
      'shape',
      `${sentences.length} sentences, want ${feature.minSentences} to ${feature.maxSentences}`,
    );
  }

  // 2. Player tokens.
  const known = new Set(Object.keys(list.tokenMap));
  for (const tok of toks) {
    if (tok.t === 'badtoken') return reject('token', `malformed token ${tok.raw}`);
    if (tok.t === 'ptoken' && !known.has(tok.token)) return reject('token', `unknown player {${tok.token}}`);
  }

  // 3. Forbidden vocabulary, on the words alone (champion names and tokens blanked).
  const words = ` ${toks
    .map((tok) =>
      tok.t === 'word' ? tok.lower : tok.t === 'num' ? tok.raw.toLowerCase() : tok.t === 'end' ? '.' : '_',
    )
    .join(' ')} `;
  for (const entry of FORBIDDEN_RES) {
    if (entry.kinds !== undefined && !entry.kinds.includes(list.kind)) continue;
    for (const { phrase, re } of entry.res) {
      if (re.test(words)) return reject('forbidden', `${entry.category}: "${phrase}"`);
    }
  }
  // M16.18: a self-correction (`Wait, that breaks the rule. Fixed:`) starts a sentence with `wait`.
  if (/(^|[.!?:]\s*)wait\b/i.test(text)) return reject('forbidden', 'about the writing: "wait"');
  if (!list.upset && /(?<![a-z])(underdog|underdogs|upset|upsets)(?![a-z])/.test(words)) {
    return reject('forbidden', 'odds: an upset the facts do not have');
  }

  // 4. Names.
  for (const sentence of sentences) {
    for (let i = 0; i < sentence.length; i += 1) {
      const tok = sentence[i] as Tok;
      if (tok.t !== 'word' || !/^[A-Z]/.test(tok.raw)) continue;
      const bare = tok.raw.replace(/'s$/, '');
      if (ALLOWED_CAPS.has(bare) || ALLOWED_CAPS.has(tok.raw)) continue;
      if (i === 0 && SENTENCE_OPENERS.has(tok.lower.replace(/'s$/, ''))) continue;
      if (i === 0 && (ABSOLUTE_WORDS[tok.lower] !== undefined || UNIT_WORDS[tok.lower] !== undefined))
        continue;
      return reject('name', `"${tok.raw}" may be a name that is not in the facts`);
    }
  }

  // 5. Champions.
  const { byToken } = factsBy(list);
  const factChampions = new Set(list.facts.flatMap((fact) => fact.champions));
  for (const sentence of sentences) {
    for (let index = 0; index < sentence.length; index += 1) {
      const tok = sentence[index] as Tok;
      if (tok.t !== 'champ') continue;
      if (!factChampions.has(tok.name)) return reject('champion', `${tok.name} is not in this game's facts`);
      // M16.11: the champion belongs to the nearest token before it (or the first after it). In a
      // scouting report (M16.19 r2) champions are the subject's only: a sentence naming nobody is
      // theirs, and a champion bound to the duo partner is refused.
      const owner = ownerAt(sentence, index);
      if (list.kind === 'player' && owner !== null && owner !== SCOUTING_SUBJECT)
        return reject('champion', `${tok.name} is {${SCOUTING_SUBJECT}}'s, not {${owner}}'s`);
      if (owner !== null) {
        const owns = (byToken.get(owner) ?? []).some((fact) => fact.champions.includes(tok.name));
        if (!owns)
          return reject('champion', `${tok.name} does not belong to {${owner}}, the player named before it`);
      }
    }
  }

  // 6. Numbers.
  const numbers = checkNumbers(list, sentences);
  if (numbers !== null) return numbers;

  // 7. Absolute words.
  const absolutes = checkAbsolutes(list, sentences);
  if (absolutes !== null) return absolutes;

  // 8. Story claims (2026-10-04): closeness, margins, timing, doubled streaks, fact-less filler.
  const story = checkStoryClaims(list, sentences);
  if (story !== null) return story;

  // 9. Loser barbs: a sentence naming a losing player stays kind.
  const losers = new Set(
    list.facts.flatMap((fact) => (fact.token !== null && fact.notes.includes('lost') ? [fact.token] : [])),
  );
  if (losers.size > 0) {
    for (const sentence of sentences) {
      const named = sentence.some((tok) => tok.t === 'ptoken' && losers.has(tok.token));
      if (!named) continue;
      const sentenceWords = ` ${sentence.map((tok) => (tok.t === 'word' ? tok.lower : '_')).join(' ')} `;
      for (const { phrase, re } of LOSER_BARB_RES) {
        if (re.test(sentenceWords))
          return reject('barb', `"${phrase}" in a sentence about a player who lost`);
      }
    }
  }

  // 10. A game's sides, fact-label echoes and owned roles (product's round-2 read, 2026-10-04).
  const sides = checkGameSides(list, sentences);
  if (sides !== null) return sides;
  const echoes = checkLabelEchoes(list, text, sentences);
  if (echoes !== null) return echoes;

  return { ok: true, text };
}

/* ---------------------------------------------------------------------------------------------
 * The last check, at render
 * ------------------------------------------------------------------------------------------- */

export interface StoredLine {
  status: AiLineStatus;
  text: string | null;
  tokenMap: AiTokenMap;
}

const TOKEN_IN_TEXT = /\{(P[1-9]\d?)\}/g;

/** The players a stored line names (its tokens that appear in the text). */
export function playersNamedIn(line: Pick<StoredLine, 'text' | 'tokenMap'>): string[] {
  if (line.text === null) return [];
  const ids: string[] = [];
  for (const match of line.text.matchAll(TOKEN_IN_TEXT)) {
    const id = line.tokenMap[match[1] as string];
    if (id !== undefined) ids.push(id);
  }
  return ids;
}

/**
 * What a surface may show, or null for "show nothing, exactly like a group without Premium"
 * (brief 1.2, 4.6). Null unless the group's AI gate is open, the line is `published`, and no
 * player it names has opted out (checked here, at render, so an opt-out hides old lines at once,
 * D6). Tokens become the names `nameOf` gives -- the caller escapes for its surface -- and a token
 * with no name hides the line rather than printing a raw `{P3}`.
 */
export function renderLine(input: {
  gate: AiGate | null;
  line: StoredLine | null;
  optedOut: ReadonlySet<string>;
  nameOf: (playerId: string) => string | null;
}): string | null {
  const { gate, line } = input;
  if (!aiGateOpen(gate) || line === null || line.status !== 'published' || line.text === null) return null;
  const named = playersNamedIn(line);
  if (named.some((id) => input.optedOut.has(id))) return null;
  let missing = false;
  const text = line.text.replace(TOKEN_IN_TEXT, (_, token: string) => {
    const id = line.tokenMap[token];
    const name = id === undefined ? null : input.nameOf(id);
    if (name === null || name.trim() === '') {
      missing = true;
      return '';
    }
    return name;
  });
  return missing ? null : text;
}
