//! Client shapes to companion payloads (port of `packages/lcu/src/mapper.ts`). M17.7 ports `mapLobby`; the
//! end-of-game, match-detail and rank mappers follow with their watchers (M17.9 to M17.11). The output is
//! pinned JSON-equal by the TypeScript engine's goldens in `tests/goldens/`.

use std::collections::HashMap;
use std::time::{Duration, UNIX_EPOCH};

use serde_json::{Map, Value};

use super::types::{
    EogPlayer, EogStatsBlock, Lobby, LobbyMember, MatchDetail, MatchTeam, MatchTimeline, RankedStats,
    Summoner,
};
use crate::api::wire::{
    EogPayload, GameParticipant, GameSource, LobbyMember as LobbyMemberBody, LobbyPayload, RankPayload, Role,
    Side,
};

/// The all-zero puuid the client gives a bot.
pub const ZERO_PUUID: &str = "00000000-0000-0000-0000-000000000000";

/// `isPlaceholderPuuid` (`packages/db/src/schemas/common.ts`): empty or all-zero, after trim, any case.
pub fn is_placeholder_puuid(value: &str) -> bool {
    let trimmed = value.trim();
    trimmed.is_empty() || trimmed.eq_ignore_ascii_case(ZERO_PUUID)
}

/// A Riot ID as the companion knows it; `""` from the client is `None`.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RiotIdName {
    /// The name.
    pub game_name: Option<String>,
    /// The tag.
    pub tag_line: Option<String>,
}

/// `nameFromSummoner`.
pub fn name_from_summoner(summoner: &Summoner) -> RiotIdName {
    RiotIdName {
        game_name: Some(summoner.game_name.clone()).filter(|n| !n.is_empty()),
        tag_line: Some(summoner.tag_line.clone()).filter(|t| !t.is_empty()),
    }
}

/// Names the companion already has, by puuid. The mapper reads it and never fills it.
pub type NameCache = HashMap<String, RiotIdName>;

/// `isLobbyBot`: the client's flag, and the placeholder puuid behind it.
pub fn is_lobby_bot(member: &LobbyMember) -> bool {
    member.is_bot || is_placeholder_puuid(&member.puuid)
}

fn has_puuid(entries: &[LobbyMember], puuid: &str) -> bool {
    entries.iter().any(|entry| entry.puuid == puuid)
}

/// `mapLobby`: `members[]` humans only; side by membership of `customTeam100`/`200` (never `teamId`),
/// `null` for neither; spectator by the flag or `customSpectators`; names from `names` or `null`;
/// `lobbyPassword` always `null` (the watcher fills it for a party this process created).
pub fn map_lobby(lobby: &Lobby, names: &NameCache) -> LobbyPayload {
    let config = &lobby.game_config;
    let spectators = config.custom_spectators.as_deref().unwrap_or_default();
    let side_of = |puuid: &str| -> Option<Side> {
        if has_puuid(&config.custom_team_100, puuid) {
            Some(Side::Blue)
        } else if has_puuid(&config.custom_team_200, puuid) {
            Some(Side::Red)
        } else {
            None
        }
    };
    let members = lobby
        .members
        .iter()
        .filter(|member| !is_lobby_bot(member))
        .map(|member| {
            let name = names.get(&member.puuid);
            LobbyMemberBody {
                puuid: member.puuid.clone(),
                // Passed through as the client sent it, as `mapLobby` does (a negative one would be refused by the
                // server, as it is from the TypeScript engine; never seen).
                summoner_id: member.summoner_id,
                game_name: name.and_then(|n| n.game_name.clone()),
                tag_line: name.and_then(|n| n.tag_line.clone()),
                side: side_of(&member.puuid),
                is_spectator: member.is_spectator || has_puuid(spectators, &member.puuid),
            }
        })
        .collect();
    LobbyPayload {
        party_id: lobby.party_id.clone(),
        lobby_name: config.custom_lobby_name.clone(),
        lobby_password: None,
        members,
    }
}

/// `roleFromDetectedTeamPosition` (`packages/db/src/constants.ts`): the published table, anything else
/// `None`, never inferred from the champion.
pub fn role_from_detected_team_position(position: Option<&str>) -> Option<Role> {
    match position?.trim().to_ascii_uppercase().as_str() {
        "TOP" => Some(Role::Top),
        "JUNGLE" => Some(Role::Jungle),
        "MIDDLE" => Some(Role::Mid),
        "BOTTOM" => Some(Role::Adc),
        "UTILITY" => Some(Role::Support),
        _ => None,
    }
}

/// `isEogBot`: `botPlayer`, and the all-zero puuid behind it.
pub fn is_eog_bot(player: &EogPlayer) -> bool {
    player.bot_player || is_placeholder_puuid(&player.puuid)
}

/// `new Date(ms).toISOString()`: milliseconds, UTC, `Z`. A time before 1970 (a broken clock) clamps to it.
pub fn iso_from_millis(ms: i64) -> String {
    crate::log::iso_timestamp(UNIX_EPOCH + Duration::from_millis(u64::try_from(ms).unwrap_or(0)))
}

fn count(value: i64) -> u64 {
    // The client's counters are never negative; a negative one would fail the server's schema either way.
    u64::try_from(value).unwrap_or(0)
}

/// `mapEog`: the end-of-game block (event or GET) to the body of `POST /api/companion/game`, phase `eog`.
///
/// - `gameId` is the block's own; `partyId` the one held for this game, else `null`.
/// - `startedAt` is the moment the game start was observed (held from `in_progress`), else
///   `endOfGameTimestamp - gameLength * 1000` (`now_ms` stands in when the block has no timestamp, never seen).
/// - `winningSide` is the `teamId` of the first team with `isWinningTeam`; `null` when none (the watcher
///   then drops the block).
/// - Participants: humans only, side from the team, role from `detectedTeamPosition`, the uppercase stats
///   (`cs` = minions + neutral minions, `win` = `WIN == 1`), `""` names as `null`.
/// - `raw` is the whole block, scrubbed of credentials (`scrubValue`).
pub fn map_eog(
    block: &EogStatsBlock,
    raw: &Value,
    party_id: Option<String>,
    started_at: Option<String>,
    now_ms: i64,
) -> EogPayload {
    let participants = block
        .teams
        .iter()
        .flat_map(|team| {
            team.players
                .iter()
                .filter(|player| !is_eog_bot(player))
                .map(move |player| {
                    let stats = &player.stats;
                    GameParticipant {
                        puuid: player.puuid.clone(),
                        side: team.team_id,
                        role: role_from_detected_team_position(player.detected_team_position.as_deref()),
                        champion_id: count(player.champion_id),
                        kills: count(stats.CHAMPIONS_KILLED),
                        deaths: count(stats.NUM_DEATHS),
                        assists: count(stats.ASSISTS),
                        gold: count(stats.GOLD_EARNED),
                        damage_to_champs: count(stats.TOTAL_DAMAGE_DEALT_TO_CHAMPIONS),
                        cs: count(stats.MINIONS_KILLED + stats.NEUTRAL_MINIONS_KILLED),
                        win: stats.WIN == 1,
                        game_name: Some(player.riot_id_game_name.clone()).filter(|n| !n.is_empty()),
                        tag_line: Some(player.riot_id_tag_line.clone()).filter(|t| !t.is_empty()),
                        summoner_id: player.summoner_id,
                    }
                })
        })
        .collect();
    let winner = block
        .teams
        .iter()
        .find(|team| team.is_winning_team)
        .map(|team| team.team_id);
    let ended_at_ms = block
        .end_of_game_timestamp
        .map(|t| t.trunc() as i64)
        .unwrap_or(now_ms);
    let started_at = started_at.unwrap_or_else(|| iso_from_millis(ended_at_ms - block.game_length * 1000));
    let raw = match crate::log::scrub::scrub_value(raw) {
        Value::Object(map) => map,
        _ => Map::new(),
    };
    EogPayload {
        game_id: count(block.game_id),
        party_id: Some(party_id),
        source: None,
        game_type: Some(block.game_type.clone()),
        started_at,
        duration_s: count(block.game_length),
        winning_side: winner,
        participants,
        raw,
    }
}

/// `MATCH_TEAM_WIN`: `teams[].win` of the team that won a match-history game.
pub const MATCH_TEAM_WIN: &str = "Win";

/// `matchDetailWinningSide`: the one team whose `win` is `"Win"`; `None` when no team has it (an aborted
/// game) or when both do (never seen; not a game we can rate).
pub fn match_detail_winning_side(teams: &[MatchTeam]) -> Option<Side> {
    let mut winners = teams.iter().filter(|team| team.win == MATCH_TEAM_WIN);
    match (winners.next(), winners.next()) {
        (Some(winner), None) => Some(winner.team_id),
        _ => None,
    }
}

/// `matchTimelineKey`: `LANE+ROLE`, trimmed and uppercased; a missing half is empty.
pub fn match_timeline_key(lane: Option<&str>, role: Option<&str>) -> String {
    format!(
        "{}+{}",
        lane.unwrap_or_default().trim().to_uppercase(),
        role.unwrap_or_default().trim().to_uppercase()
    )
}

/// `MATCH_TIMELINE_ROLES` (`timelineRoles.ts`, M5.18): the `timeline.lane`/`role` pairs proved against a live
/// capture of the same game. Empty on 16.17 (decision 2026-09-10), so every backfilled role is `null` today.
pub const MATCH_TIMELINE_ROLES: &[(&str, Role)] = &[];

/// `roleFromMatchTimeline`.
pub fn role_from_match_timeline(timeline: Option<&MatchTimeline>) -> Option<Role> {
    let timeline = timeline?;
    let key = match_timeline_key(timeline.lane.as_deref(), timeline.role.as_deref());
    MATCH_TIMELINE_ROLES
        .iter()
        .find(|(k, _)| *k == key)
        .map(|(_, role)| *role)
}

/// A `timeline.lane`/`role` pair the table does not know, as the client spelled it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnmappedTimelinePair {
    /// `timeline.lane`.
    pub lane: Option<String>,
    /// `timeline.role`.
    pub role: Option<String>,
    /// [`match_timeline_key`] of the two.
    pub key: String,
}

/// `mapMatchDetail` (M5.1): `GET /lol-match-history/v1/games/{gameId}` to the body of
/// `POST /api/companion/game`, phase `eog`, `source: "backfill"`.
///
/// - `partyId` is **absent** (no key): a backfilled game belongs to no lobby.
/// - `startedAt` is `gameCreation` as ISO 8601; `durationS` is `gameDuration`.
/// - `winningSide` is [`match_detail_winning_side`]; `None` means the caller drops the game.
/// - Participants join `participantIdentities[]` on `participantId`; no identity row or a placeholder puuid
///   is dropped. `side` is the participant's `teamId`; `""` names are `null`.
/// - `role` goes through [`MATCH_TIMELINE_ROLES`]; a pair it does not know is `null` and is reported to
///   `on_unmapped` (the caller logs each distinct pair once).
/// - `raw` is the whole detail as the client sent it, scrubbed.
pub fn map_match_detail(
    detail: &MatchDetail,
    raw: &Value,
    mut on_unmapped: impl FnMut(UnmappedTimelinePair),
) -> EogPayload {
    let players: HashMap<i64, &super::types::MatchPlayer> = detail
        .participant_identities
        .iter()
        .map(|identity| (identity.participant_id, &identity.player))
        .collect();
    let mut participants = Vec::new();
    for participant in &detail.participants {
        let Some(player) = players.get(&participant.participant_id) else {
            continue;
        };
        if is_placeholder_puuid(&player.puuid) {
            continue;
        }
        let role = role_from_match_timeline(participant.timeline.as_ref());
        if role.is_none() {
            let lane = participant.timeline.as_ref().and_then(|t| t.lane.clone());
            let timeline_role = participant.timeline.as_ref().and_then(|t| t.role.clone());
            let key = match_timeline_key(lane.as_deref(), timeline_role.as_deref());
            on_unmapped(UnmappedTimelinePair {
                lane,
                role: timeline_role,
                key,
            });
        }
        let stats = &participant.stats;
        participants.push(GameParticipant {
            puuid: player.puuid.clone(),
            side: participant.team_id,
            role,
            champion_id: count(participant.champion_id),
            kills: count(stats.kills),
            deaths: count(stats.deaths),
            assists: count(stats.assists),
            gold: count(stats.gold_earned),
            damage_to_champs: count(stats.total_damage_dealt_to_champions),
            cs: count(stats.total_minions_killed + stats.neutral_minions_killed),
            win: stats.win,
            game_name: Some(player.game_name.clone()).filter(|n| !n.is_empty()),
            tag_line: Some(player.tag_line.clone()).filter(|t| !t.is_empty()),
            summoner_id: player.summoner_id,
        });
    }
    let raw = match crate::log::scrub::scrub_value(raw) {
        Value::Object(map) => map,
        _ => Map::new(),
    };
    EogPayload {
        game_id: count(detail.game_id),
        party_id: None,
        source: Some(GameSource::Backfill),
        game_type: Some(detail.game_type.clone()),
        started_at: iso_from_millis(detail.game_creation),
        duration_s: count(detail.game_duration),
        winning_side: match_detail_winning_side(&detail.teams),
        participants,
        raw,
    }
}

/// The one queue a rating is seeded from.
pub const RANK_QUEUE: &str = "RANKED_SOLO_5x5";

/// `mapRank`: `queueMap.RANKED_SOLO_5x5` of `current-ranked-stats` or `ranked-stats/{puuid}` to the body of
/// `POST /api/companion/rank`. The response carries no puuid, so the caller gives the one it asked about.
/// Tier, division and LP go verbatim (`""`/`"NA"` for unranked; the server folds them); wins and losses are
/// never sent. The name rides along when the caller looked it up.
pub fn map_rank(stats: &RankedStats, puuid: &str, name: Option<&RiotIdName>) -> RankPayload {
    let entry = stats.queue_map.ranked_solo_5x5.as_ref();
    RankPayload {
        puuid: puuid.to_owned(),
        tier: entry.map(|e| e.tier.clone()),
        division: entry.map(|e| e.division.clone()),
        lp: entry.map(|e| u64::try_from(e.league_points).unwrap_or(0)),
        queue: RANK_QUEUE.to_owned(),
        game_name: name.and_then(|n| n.game_name.clone()),
        tag_line: name.and_then(|n| n.tag_line.clone()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn placeholder_puuids() {
        assert!(is_placeholder_puuid(""));
        assert!(is_placeholder_puuid("  "));
        assert!(is_placeholder_puuid(ZERO_PUUID));
        assert!(!is_placeholder_puuid("34151cbd-d9f8-5dad-9dc8-c6a8e253c0de"));
    }
}
