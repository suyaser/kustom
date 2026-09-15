import type { RoleValue, SideValue } from '@customs/db';
import { roleFromDetectedTeamPosition } from '@customs/db';

/**
 * The extra scoreboard the companion already keeps on `games.raw` and that `/fun`
 * now reads (M5.27). Two shapes land in that column: an end-of-game block
 * (`teams[].players[].stats`) and a match-history detail (`participants` +
 * `participantIdentities` + `teams[].bans`).
 *
 * Pure. A malformed blob is empty facts, never a throw — the page still has the
 * columns `game_players` stores.
 */

const BOT_PUUID = '00000000-0000-0000-0000-000000000000';
const SMITE = 11;

export interface RawPlayerFacts {
  firstBloodKill: boolean;
  firstBloodAssist: boolean;
  /**
   * Named only when the blob carried `firstBloodDeath`. The 16.17 fixtures
   * do not. A missing flag stays false — we never infer the corpse.
   */
  firstBloodDeath: boolean;
  visionScore: number | null;
  /**
   * `TOTAL_DAMAGE_SELF_MITIGATED` / `damageSelfMitigated`. Null when the blob did not
   * say — never 0, which is a real tank's worst game and not a missing key (M7.7).
   */
  damageSelfMitigated: number | null;
  objectivesStolen: number;
  objectivesStolenAssists: number;
  baronKills: number;
  dragonKills: number;
  riftHeraldKills: number;
  hordeKills: number;
  atakhanKills: number;
  /** Seconds. The client's `longestTimeSpentLiving`. */
  longestLivedS: number | null;
  championName: string | null;
  /**
   * From `detectedTeamPosition` on an end-of-game block. Null on match-history
   * raw — that shape has no detected position, and `timeline.lane` is a
   * different vocabulary (M5.18).
   */
  role: RoleValue | null;
  /** True when either summoner spell is Smite (id 11). */
  smite: boolean;
  timelineLane: string | null;
  timelineRole: string | null;
  /** Counted multi-kills from the stored block. Zero when the field is missing. */
  pentaKills: number;
  quadraKills: number;
  tripleKills: number;
  doubleKills: number;
  /** The client's `largestKillingSpree`. Zero when missing. */
  largestKillingSpree: number;
  /** Named only when the blob carried `firstTowerKill`. Never inferred from gold or towers. */
  firstTowerKill: boolean;
  /** `totalDamageTaken` when the block stored it. Null when it did not. */
  damageTaken: number | null;
}

export interface RawBan {
  championId: number;
  teamId: SideValue;
}

export interface RawGameFacts {
  byPuuid: Record<string, RawPlayerFacts>;
  bans: RawBan[];
}

export function emptyRawFacts(): RawGameFacts {
  return { byPuuid: {}, bans: [] };
}

export function playerFacts(partial: Partial<RawPlayerFacts> = {}): RawPlayerFacts {
  return {
    firstBloodKill: false,
    firstBloodAssist: false,
    firstBloodDeath: false,
    visionScore: null,
    damageSelfMitigated: null,
    objectivesStolen: 0,
    objectivesStolenAssists: 0,
    baronKills: 0,
    dragonKills: 0,
    riftHeraldKills: 0,
    hordeKills: 0,
    atakhanKills: 0,
    longestLivedS: null,
    championName: null,
    role: null,
    smite: false,
    timelineLane: null,
    timelineRole: null,
    pentaKills: 0,
    quadraKills: 0,
    tripleKills: 0,
    doubleKills: 0,
    largestKillingSpree: 0,
    firstTowerKill: false,
    damageTaken: null,
    ...partial,
  };
}

export function rawFactsFromUnknown(raw: unknown): RawGameFacts {
  if (!isRecord(raw)) return emptyRawFacts();
  const facts =
    Array.isArray(raw.participants) && Array.isArray(raw.participantIdentities)
      ? fromMatchDetail(raw)
      : Array.isArray(raw.teams)
        ? fromEog(raw)
        : emptyRawFacts();
  // Bans live on `teams[]` in every verified shape. Collect them after the player
  // branch: an end-of-game team has `players` and no bans; a match-history team
  // has `bans` and no players. Taking only one branch used to drop the list.
  facts.bans = collectBans(raw);
  return facts;
}

/** True when `teams[]` already carries a `bans` array — including an empty blind draft. */
export function rawHasDraftBanList(raw: unknown): boolean {
  if (!isRecord(raw) || !Array.isArray(raw.teams)) return false;
  return raw.teams.some((team) => isRecord(team) && Array.isArray(team.bans));
}

/**
 * Whether a stored row still needs a match-history detail so Most banned can
 * see it. ARAM and other non-Rift modes have no draft — we do not keep asking.
 * A missing `gameMode` is old Rift (every night before the queue picker).
 */
export function rawNeedsDraftBanEnrichment(raw: unknown): boolean {
  if (rawHasDraftBanList(raw)) return false;
  if (!isRecord(raw)) return true;
  const mode = typeof raw.gameMode === 'string' ? raw.gameMode.trim().toUpperCase() : '';
  return mode === '' || mode === 'CLASSIC';
}

/**
 * Copy `teams[].bans` from a match-history block onto an end-of-game row that
 * never stored them. Returns a new raw object when something was added, else null.
 * Never replaces players, stats, or a list that is already present.
 */
export function mergeDraftBans(stored: unknown, incoming: unknown): Record<string, unknown> | null {
  if (
    !isRecord(stored) ||
    rawHasDraftBanList(stored) ||
    !isRecord(incoming) ||
    !Array.isArray(incoming.teams)
  ) {
    return null;
  }
  if (!Array.isArray(stored.teams)) return null;

  const incomingBans = new Map<SideValue, unknown[]>();
  for (const team of incoming.teams) {
    if (!isRecord(team) || !Array.isArray(team.bans)) continue;
    const teamId = asSide(team.teamId);
    if (teamId === null) continue;
    incomingBans.set(teamId, team.bans);
  }
  if (incomingBans.size === 0) return null;

  let changed = false;
  const teams = stored.teams.map((team) => {
    if (!isRecord(team) || Array.isArray(team.bans)) return team;
    const teamId = asSide(team.teamId);
    if (teamId === null) return team;
    const bans = incomingBans.get(teamId);
    if (bans === undefined) return team;
    changed = true;
    return { ...team, bans };
  });
  return changed ? { ...stored, teams } : null;
}

export type EpicKind = 'dragon' | 'baron' | 'herald' | 'void-grub' | 'atakhan';

const EPIC_NOUN: Record<EpicKind, { one: string; many: string }> = {
  dragon: { one: 'dragon steal', many: 'dragon steals' },
  baron: { one: 'baron steal', many: 'baron steals' },
  herald: { one: 'herald steal', many: 'herald steals' },
  'void-grub': { one: 'void grub steal', many: 'void grub steals' },
  atakhan: { one: 'Atakhan steal', many: 'Atakhan steals' },
};

/** Epic monster kills that can name a steal. Zeroes are dropped. */
export function epicKills(facts: RawPlayerFacts): { kind: EpicKind; kills: number }[] {
  return (
    [
      { kind: 'dragon' as const, kills: facts.dragonKills },
      { kind: 'baron' as const, kills: facts.baronKills },
      { kind: 'herald' as const, kills: facts.riftHeraldKills },
      { kind: 'void-grub' as const, kills: facts.hordeKills },
      { kind: 'atakhan' as const, kills: facts.atakhanKills },
    ] as const
  ).filter((row) => row.kills > 0);
}

/**
 * `1 dragon steal` when the block named exactly one epic type they also killed.
 * `1 steal` when the type is ambiguous or missing — we do not guess a corpse.
 */
export function stealLine(facts: RawPlayerFacts): string {
  const n = facts.objectivesStolen;
  if (n <= 0) return n === 0 ? '0 steals' : `${n} steals`;
  const named = epicKills(facts);
  if (named.length === 1) {
    const noun = named[0] === undefined ? null : EPIC_NOUN[named[0].kind];
    if (noun !== null) return n === 1 ? `1 ${noun.one}` : `${n} ${noun.many}`;
  }
  return n === 1 ? '1 steal' : `${n} steals`;
}

function fromEog(raw: Record<string, unknown>): RawGameFacts {
  const facts = emptyRawFacts();
  for (const team of raw.teams as unknown[]) {
    if (!isRecord(team) || !Array.isArray(team.players)) continue;
    for (const player of team.players) {
      if (!isRecord(player)) continue;
      const puuid = asPuuid(player.puuid);
      if (puuid === null) continue;
      const stats = isRecord(player.stats) ? player.stats : {};
      facts.byPuuid[puuid] = extrasFromStats(stats, {
        championName: asText(player.championName),
        role: roleFromDetectedTeamPosition(asText(player.detectedTeamPosition)),
        smite: hasSmite(player.spell1Id, player.spell2Id, stats),
        timelineLane: null,
        timelineRole: null,
      });
    }
  }
  return facts;
}

function fromMatchDetail(raw: Record<string, unknown>): RawGameFacts {
  const facts = emptyRawFacts();
  const identities = new Map<number, string>();
  for (const identity of raw.participantIdentities as unknown[]) {
    if (!isRecord(identity) || !isRecord(identity.player)) continue;
    const id = asInt(identity.participantId);
    const puuid = asPuuid(identity.player.puuid);
    if (id === null || puuid === null) continue;
    identities.set(id, puuid);
  }

  for (const participant of raw.participants as unknown[]) {
    if (!isRecord(participant)) continue;
    const id = asInt(participant.participantId);
    const puuid = id === null ? null : (identities.get(id) ?? null);
    if (puuid === null) continue;
    const stats = isRecord(participant.stats) ? participant.stats : {};
    const timeline = isRecord(participant.timeline) ? participant.timeline : {};
    facts.byPuuid[puuid] = extrasFromStats(stats, {
      championName: null,
      role: null,
      smite: hasSmite(participant.spell1Id, participant.spell2Id, stats),
      timelineLane: asText(timeline.lane),
      timelineRole: asText(timeline.role),
    });
  }

  return facts;
}

function extrasFromStats(
  stats: Record<string, unknown>,
  extra: {
    championName: string | null;
    role: RoleValue | null;
    smite: boolean;
    timelineLane: string | null;
    timelineRole: string | null;
  },
): RawPlayerFacts {
  return playerFacts({
    firstBloodKill: flag(stats.firstBloodKill),
    firstBloodAssist: flag(stats.firstBloodAssist),
    firstBloodDeath: flag(stats.firstBloodDeath) || flag(stats.FIRST_BLOOD_DEATH),
    visionScore: asInt(stats.VISION_SCORE) ?? asInt(stats.visionScore),
    damageSelfMitigated: asInt(stats.TOTAL_DAMAGE_SELF_MITIGATED) ?? asInt(stats.damageSelfMitigated),
    objectivesStolen: asInt(stats.objectivesStolen) ?? 0,
    objectivesStolenAssists: asInt(stats.objectivesStolenAssists) ?? 0,
    baronKills: asInt(stats.baronKills) ?? 0,
    dragonKills: asInt(stats.dragonKills) ?? 0,
    riftHeraldKills: asInt(stats.riftHeraldKills) ?? 0,
    hordeKills: asInt(stats.hordeKills) ?? 0,
    atakhanKills: asInt(stats.atakhanKills) ?? 0,
    longestLivedS: asInt(stats.longestTimeSpentLiving),
    championName: extra.championName,
    role: extra.role,
    smite: extra.smite,
    timelineLane: extra.timelineLane,
    timelineRole: extra.timelineRole,
    pentaKills: asCount(stats.pentaKills, stats.PENTA_KILLS),
    quadraKills: asCount(stats.quadraKills, stats.QUADRA_KILLS),
    tripleKills: asCount(stats.tripleKills, stats.TRIPLE_KILLS),
    doubleKills: asCount(stats.doubleKills, stats.DOUBLE_KILLS),
    largestKillingSpree: asCount(stats.largestKillingSpree, stats.LARGEST_KILLING_SPREE),
    firstTowerKill: flag(stats.firstTowerKill) || flag(stats.FIRST_TOWER_KILL),
    damageTaken: asInt(stats.totalDamageTaken) ?? asInt(stats.TOTAL_DAMAGE_TAKEN),
  });
}

function hasSmite(spell1: unknown, spell2: unknown, stats: Record<string, unknown>): boolean {
  return (
    asInt(spell1) === SMITE ||
    asInt(spell2) === SMITE ||
    asInt(stats.spell1Id) === SMITE ||
    asInt(stats.spell2Id) === SMITE
  );
}

function collectBans(raw: Record<string, unknown>): RawBan[] {
  const bans: RawBan[] = [];
  if (!Array.isArray(raw.teams)) return bans;
  for (const team of raw.teams) {
    if (!isRecord(team) || !Array.isArray(team.bans)) continue;
    const teamId = asSide(team.teamId);
    if (teamId === null) continue;
    for (const ban of team.bans) {
      if (!isRecord(ban)) continue;
      const championId = asChampionId(ban.championId);
      if (championId === null) continue;
      bans.push({ championId, teamId });
    }
  }
  return bans;
}

function asChampionId(value: unknown): number | null {
  const n = typeof value === 'string' ? asInt(Number(value.trim())) : asInt(value);
  return n !== null && n > 0 ? n : null;
}

function flag(value: unknown): boolean {
  return value === true || value === 1;
}

function asInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}

/** First named finite number, floored at zero. Missing stays 0 — never a guess. */
function asCount(...values: unknown[]): number {
  for (const value of values) {
    const n = asInt(value);
    if (n !== null) return n < 0 ? 0 : n;
  }
  return 0;
}

function asText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function asSide(value: unknown): SideValue | null {
  return value === 100 || value === 200 ? value : null;
}

function asPuuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === BOT_PUUID) return null;
  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
