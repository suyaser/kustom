import type { RoleValue } from '@customs/db';
import { winLossLabel } from '../board/copy';
import { MIN_DUO_GAMES, MIN_RECORD_GAMES, percentLabel } from './copy';

/**
 * Every word `/fun` says (M5.24). The page and its tests read these strings; a component
 * does not invent a second sentence for the same fact.
 */

/** The nav tab, the heading beside the window's name, the `<title>`. */
export const FUN_LABEL = 'Fun';

export const CS_HEADING = 'CS by role';
export const RECORDS_HEADING = 'One game';
export const HABITS_HEADING = 'The habit';
/** Opens the scoreboard of the counted custom a one-game record came from. */
export const THIS_GAME = 'This game';
/** Opens the list of counted customs behind a window total or a multi-kill museum row. */
export const SEE_GAMES = 'See games';

export const FIRST_BLOOD_TITLE = 'First Blood Museum';
export const FIRST_BLOOD_INTRO =
  'Who opened the map, on which champion, and which night. The block names the killer.';
export const FIRST_BLOOD_EMPTY = 'No first blood flag in this window.';
export const FIRST_BLOOD_MOST = 'Most first bloods';
export const FIRST_BLOOD_MOST_RULE = 'Counted games whose stored block named a killer.';

export const FIRST_BLOOD_TAKEN_TITLE = 'First Blood Donated';
export const FIRST_BLOOD_TAKEN_INTRO =
  'Who fed the opening kill, on which champion, and which night. Only when the stored block named the death.';
export const FIRST_BLOOD_TAKEN_EMPTY =
  'No first-blood death flag in this window. The block names the killer; it does not name who died.';
export const FIRST_BLOOD_TAKEN_ONE = '1 first blood taken';
export const FIRST_BLOOD_TAKEN_MANY = 'first bloods taken';

export const PENTA_TITLE = 'Pentakill Museum';
export const PENTA_INTRO = 'Who closed five. Counted from the stored pentaKills field.';
export const PENTA_EMPTY = 'No pentakill in this window.';
export const PENTA_ONE = '1 penta';
export const PENTA_MANY = 'pentas';

export const QUADRA_TITLE = 'Quadrakill Museum';
export const QUADRA_INTRO = 'Who got four. Counted from the stored quadraKills field.';
export const QUADRA_EMPTY = 'No quadrakill in this window.';
export const QUADRA_ONE = '1 quadra';
export const QUADRA_MANY = 'quadras';

export const TRIPLE_TITLE = 'Triple Museum';
export const TRIPLE_INTRO = 'Who got three. Counted from the stored tripleKills field.';
export const TRIPLE_EMPTY = 'No triple in this window.';
export const TRIPLE_ONE = '1 triple';
export const TRIPLE_MANY = 'triples';

export const DOUBLE_TITLE = 'Double Museum';
export const DOUBLE_INTRO = 'Who got two. Counted from the stored doubleKills field.';
export const DOUBLE_EMPTY = 'No double in this window.';
export const DOUBLE_ONE = '1 double';
export const DOUBLE_MANY = 'doubles';

export const TURRET_TITLE = 'First Turret';
export const TURRET_INTRO = 'Who took the first tower. The block names firstTowerKill.';
export const TURRET_EMPTY = 'No first-tower flag in this window.';
export const TURRET_ONE = '1 first turret';
export const TURRET_MANY = 'first turrets';

export const DEATH_HALL_TITLE = 'Death Hall of Fame';
export const SHORTEST_LIFE = 'Shortest life';
export const SHORTEST_LIFE_RULE =
  'Shortest time spent living in one counted game they died in. The in-game first-death clock is not stored.';
export const MOST_DEATHS_WINDOW = 'Most deaths';
export const MOST_DEATHS_WINDOW_RULE = 'Deaths summed over counted games in the window.';
export const DEATHLESS_STREAK = 'Longest deathless streak';
export const DEATHLESS_STREAK_RULE = 'Consecutive counted games with zero deaths.';
export const DEATHLESS_GAMES = 'Most games without dying';
export const DEATHLESS_GAMES_RULE = 'Counted games with zero deaths.';

export const THIEF_TITLE = 'Objective Thief';
export const MOST_STEALS = 'Most steals';
export const MOST_STEALS_RULE = 'Objectives stolen in one counted game.';
export const MOST_STEALS_WINDOW = 'Career thief';
export const MOST_STEALS_WINDOW_RULE = 'Objectives stolen, summed over the window.';
export const MOST_DRAGONS = 'Most dragons';
export const MOST_DRAGONS_RULE = 'Dragon kills in one counted game.';
export const MOST_BARONS = 'Most barons';
export const MOST_BARONS_RULE = 'Baron kills in one counted game.';
export const THIEF_EMPTY = 'Nobody stole an objective in this window.';

export const FEAR_BAN_TITLE = 'Fear Ban';
export const FEAR_BAN_INTRO =
  "How often the other side banned someone's champion while they were in the lobby.";
export const FEAR_BAN_EMPTY = 'No draft bans in this window. Blind customs do not ban.';
export const FEAR_BAN_RULE = `Their most-played champion, banned by the other side, in at least ${MIN_RECORD_GAMES} counted games.`;

export const MOST_BANNED_TITLE = 'Most banned';
export const MOST_BANNED_INTRO = 'Champions the lobby banned, regardless of who was playing them.';
export const MOST_BANNED_EMPTY = 'No draft bans in this window. Blind customs do not ban.';
export const MOST_BANNED_RULE = 'Each ban in a counted game, once.';

export const MOST_PICKED_TITLE = 'Most picked';
export const MOST_PICKED_INTRO = 'Champions taken in counted games, regardless of who locked them.';
export const MOST_PICKED_EMPTY = 'No champion id in this window.';
export const MOST_PICKED_RULE = 'Each seat in a counted game, once.';

export function fearBanLine(
  name: string,
  champion: string,
  rate: number,
  banned: number,
  available: number,
): string {
  return `${name}'s ${champion} has been banned in ${rate}% of games where they were available (${banned} of ${available}).`;
}

export function noCsAtRole(role: RoleValue): string {
  return `Nobody has a counted game on ${role} yet.`;
}

export const CS_HIGH_LABEL = 'Highest CS';
export const CS_LOW_LABEL = 'Lowest CS';

export function csValue(cs: number, perMin: number): string {
  return `${cs} CS · ${perMin.toFixed(1)}/min`;
}

export const MOST_KILLS = 'Most kills';
export const MOST_KILLS_RULE = 'One counted game.';
export const LONGEST_SPREE = 'Longest killing spree';
export const LONGEST_SPREE_RULE =
  'Largest killing spree in one counted game. The stored largestKillingSpree field. At least three.';
export const MOST_DEATHS = 'Most deaths';
export const MOST_DEATHS_RULE = 'One counted game.';
export const MOST_ASSISTS = 'Most assists';
export const MOST_ASSISTS_RULE = 'One counted game.';
export const CLEAN_KDA = 'Cleanest night';
export const CLEAN_KDA_RULE = 'At least 8 takedowns in one counted game.';
export const ZERO_X = 'The 0/X club';
export const ZERO_X_RULE = 'Zero kills and at least 8 deaths in one counted game.';
export const MOST_DAMAGE = 'Most damage';
export const MOST_DAMAGE_RULE = 'Damage to champions, one counted game.';
export const PAPER = 'Paper champion';
export const PAPER_RULE = 'Lowest damage in a game of 25 minutes or more, not on support.';
export const WON_UGLY = 'Won ugly';
export const WON_UGLY_RULE = 'A win with the worst KDA in the window.';
export const LOST_PRETTY = 'Lost pretty';
export const LOST_PRETTY_RULE = 'A loss with at least 6 takedowns and the best KDA.';
export const RICH_WRONG = 'Rich and wrong';
export const RICH_WRONG_RULE = 'Most gold in a defeat.';
export const LOST_JUNGLE = 'The lost jungle';
export const LOST_JUNGLE_RULE = 'Lowest jungle CS in a game of 25 minutes or more.';
export const GREEDY_SUP = 'Support who farmed';
export const GREEDY_SUP_RULE = 'Highest support CS in one counted game.';
export const FOUNTAIN = 'Fountain resident';
export const FOUNTAIN_RULE = 'Twenty minutes or more, under 30 CS, under 4 takedowns.';
export const GHOST = 'The ghost';
export const GHOST_RULE = 'Lowest kill participation in a lobby with at least 8 team kills.';
export const GLUE = 'Always in the play';
export const GLUE_RULE = 'Highest kill participation in a lobby with at least 5 team kills.';
export const LONGEST = 'Longest custom';
export const LONGEST_RULE = 'The counted game that refused to end.';
export const SHORTEST = 'Shortest scored game';
export const SHORTEST_RULE = 'The shortest counted game in the window.';
export const NEVER_MISSES = 'Never misses';
export const NEVER_MISSES_RULE = 'Most counted games in the window.';
export const POOLS_HEADING = 'Who they lock';
export const OTP_TITLE = 'One-trick';
export const OTP_INTRO = 'Highest share of counted games on one champion.';
export const OTP_RULE = `Most-played champion as a share of ${MIN_RECORD_GAMES} or more counted games.`;
export const VARIETY_TITLE = 'Always a new champ';
export const VARIETY_INTRO = 'Most distinct champions locked in counted games.';
export const VARIETY_RULE = `Distinct champions across ${MIN_RECORD_GAMES} or more counted games.`;
export const POOL_EMPTY = `Nobody has ${MIN_RECORD_GAMES} counted games with a champion in this window.`;
/** Opens one person's champion × games list. */
export const SEE_CHAMPS = 'See champs';
export const FATES_HEADING = 'Luck';
export const LUCKY_TRASH = 'Lucky trash';
export const LUCKY_TRASH_RULE = 'Lowest KDA on the winning side of a counted custom. Ranked by how often.';
export const ROBBED = 'Most robbed';
export const ROBBED_RULE = 'Highest KDA on the losing side of a counted custom. Ranked by how often.';

export const NOBODY_THIS = 'Nobody qualifies.';

/* ---------------------------------------------------------------------------
 * Friends and enemies (M8.1): nemesis and best duo.
 *
 * Both minimums are {@link MIN_DUO_GAMES} — the one `duoRecords` already applies. There is no
 * second floor on this page and there must not be one: a reader who meets the two lists meets
 * one rule twice, not two rules.
 *
 * The lines below are declared above {@link FUN_ROAST} because that table keys on them.
 * ------------------------------------------------------------------------- */

export const RIVALS_HEADING = 'Friends and enemies';

export const NEMESIS_TITLE = 'Nemesis';
export const NEMESIS_INTRO = 'The person who has beaten them most, and how often the two have met.';
/**
 * **A nemesis is one-way.** Yuki's is Lena; Lena's is somebody else. The rule says so out loud
 * because the row does not: a reader who takes the list for a table of pairs will look for the
 * mirror row and not find it.
 */
export const NEMESIS_RULE = `Losses to one person, over at least ${MIN_DUO_GAMES} counted games on opposite sides. A nemesis is one-way.`;
/** The twin of {@link NO_DUOS}, the same noun at the same bar, for the other side of the card. */
export const NO_NEMESIS = `No pair has ${MIN_DUO_GAMES} games against each other yet.` as const;

export const BEST_DUO_TITLE = 'Best duo';
export const BEST_DUO_INTRO = 'The best record on the same side — the pairs Partners already draws.';
export const BEST_DUO_RULE = `Wins on the same side, over at least ${MIN_DUO_GAMES} games together.`;

/**
 * `7 of 9` — a count and the denominator it was won over.
 *
 * **The count alone would be an attendance award**: in a group of ten who play the same ten,
 * whoever turns up most is everybody's nemesis by raw losses. The denominator is the honest half
 * of the sentence and a reader can see a rivalry from a rota with it.
 */
export function ofGamesLine(count: number, games: number): string {
  return `${count} of ${games}`;
}

/** `Lost 7 of 9 to Lena.` */
export function nemesisLine(name: string, losses: number, games: number): string {
  return `Lost ${ofGamesLine(losses, games)} to ${name}.`;
}

/** `8W 2L · 80%` — the partners line, from the two helpers `/stats` already prints it with. */
export function duoRecordLine(wins: number, losses: number, winRate: number): string {
  return `${winLossLabel(wins, losses)} · ${percentLabel(winRate)}`;
}

/**
 * Egyptian 3ameya roast under each English `/fun` title. Not فصحى and not a
 * translation — the line a friend would shout after the custom. The English
 * heading stays so a test and a pasted link still name the same fact.
 * Missing keys print nothing.
 */
export const FUN_ROAST: Readonly<Record<string, string>> = {
  [FIRST_BLOOD_TITLE]: 'مين فتحها',
  [FIRST_BLOOD_TAKEN_TITLE]: 'اتفتح عليه أول واحد',
  [PENTA_TITLE]: 'كنسهم كنس',
  [QUADRA_TITLE]: 'لسه واحد ويبقا بنتا',
  [TRIPLE_TITLE]: 'التريبل يا معلم',
  [DOUBLE_TITLE]: 'دبل وخلاص',
  [TURRET_TITLE]: 'خد أول تاور',
  [DEATH_HALL_TITLE]: 'اللي بيموتوا أكتر',
  [THIEF_TITLE]: 'الحرامي',
  [FEAR_BAN_TITLE]: 'خايفين منه',
  [MOST_BANNED_TITLE]: 'البطل اللي بيتبن',
  [MOST_PICKED_TITLE]: 'اللي بيتلعب أوفر',
  [CS_HEADING]: 'مين فارم ومين جعان',
  [RECORDS_HEADING]: 'في جيم واحد',
  [HABITS_HEADING]: 'كده طول عمرهم',
  [MOST_KILLS]: 'صاحب الكيلات',
  [MOST_ASSISTS]: 'مع كل كيل',
  [LONGEST_SPREE]: 'فضل يقتل وموقفش',
  [CLEAN_KDA]: 'جيم نضيف',
  [ZERO_X]: 'صفر كيل وميت',
  [MOST_DAMAGE]: 'صاحب الدامج',
  [PAPER]: 'مبيضربش',
  [WON_UGLY]: 'كسب وهو زبالة',
  [LOST_PRETTY]: 'لعب حلو وخسر',
  [RICH_WRONG]: 'فلوس وخسر',
  [LOST_JUNGLE]: 'الجانجل نام',
  [GREEDY_SUP]: 'سبورت بيفرم',
  [FOUNTAIN]: 'قعد في البيس',
  [GHOST]: 'كان فين؟',
  [GLUE]: 'في كل فايت',
  [LONGEST]: 'جيم ما بيخلصش',
  [SHORTEST]: 'خلصت بدري',
  [NEVER_MISSES]: 'عمره ما غاب',
  [POOLS_HEADING]: 'معرق ولا كرييتيف',
  [OTP_TITLE]: 'اكتر واحد معرق',
  [VARIETY_TITLE]: 'لعيب بيلعب بشامبيونات مختلفة',
  [FATES_HEADING]: 'محظوظ ومظلوم',
  [LUCKY_TRASH]: 'المحظوظ طرش',
  [ROBBED]: 'المظلوم بزيادة',
  [MOST_DEATHS]: 'أكتر واحد بيموت',
  [SHORTEST_LIFE]: 'نزل ومات',
  [DEATHLESS_STREAK]: 'ما بيموتش',
  [DEATHLESS_GAMES]: 'جيمات من غير موتة',
  [MOST_STEALS]: 'سرقها من تحت إيدهم',
  [MOST_STEALS_WINDOW]: 'بيسرق طول الوقت',
  [MOST_DRAGONS]: 'بياكل الدراجون',
  [MOST_BARONS]: 'بياكل البارون',
  [CS_HIGH_LABEL]: 'مكينه فارم',
  [CS_LOW_LABEL]: 'جعان',
  [RIVALS_HEADING]: 'صحابه وخصومه',
  [NEMESIS_TITLE]: 'اللي دايما بيكسبه',
  [BEST_DUO_TITLE]: 'التنائي اللي مبيخسرش',
};

export function funRoast(title: string): string | null {
  return FUN_ROAST[title] ?? null;
}

export function kdaLine(kills: number, deaths: number, assists: number): string {
  return `${kills}/${deaths}/${assists}`;
}

export function kdaRatioLine(ratio: number, kills: number, deaths: number, assists: number): string {
  return `${ratio.toFixed(2)} KDA · ${kills}/${deaths}/${assists}`;
}

export function damageLine(damage: number): string {
  return `${Math.round(damage).toLocaleString()} damage`;
}

export function goldLine(gold: number): string {
  return `${Math.round(gold).toLocaleString()} gold`;
}

export function csCountLine(cs: number): string {
  return `${cs} CS`;
}

export function kpLine(percent: number): string {
  return `${percent}% KP`;
}

export function spreeLine(n: number): string {
  return n === 1 ? '1 kill streak' : `${n} kill streak`;
}

export function minutesLine(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}

export function gamesCountLine(games: number): string {
  return games === 1 ? '1 custom' : `${games} customs`;
}

export function comfortLine(gamesOnChamp: number, games: number): string {
  return `${Math.round((gamesOnChamp / games) * 100)}% of ${games} games`;
}

export function otpLine(champion: string, gamesOnChamp: number, games: number): string {
  return `${champion} · ${comfortLine(gamesOnChamp, games)}`;
}

export function varietyLine(unique: number, games: number): string {
  const champs = unique === 1 ? '1 champion' : `${unique} champions`;
  const nights = games === 1 ? '1 game' : `${games} games`;
  return `${champs} · ${nights}`;
}

export function champTimesLine(count: number): string {
  return `× ${count}`;
}

export function timesLine(count: number): string {
  return count === 1 ? '1 time' : `${count} times`;
}

export function matchDetail(startedAt: string, durationS: number): string {
  const day = new Date(startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${day} · ${minutesLine(durationS)}`;
}
