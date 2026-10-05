//! Typed League client responses: a serde struct per endpoint the engine reads, a port of the zod schemas in
//! `packages/lcu/src/schemas.ts` field for field. Required there is required here (a missing field is a
//! parse failure, logged with the endpoint and dropped); `.optional()` there is `Option` here. Unknown keys
//! are ignored, as zod's `looseObject` lets them through; where the whole body matters (the end-of-game
//! block and a match detail ride to the server as `raw`), the client hands back the raw JSON beside the
//! typed value. Shapes are checked against every recorded fixture in `packages/lcu/fixtures/` by
//! `tests/lcu_fixtures.rs`.
//!
//! Numbers: zod's `z.number().int()` is `i64` here (ids such as `gameId` exceed `i32`); the one plain
//! `z.number()` (`endOfGameTimestamp`) is `f64`.

use serde::{Deserialize, Deserializer};
use serde_json::{Map, Value};

/// A team: `100` (blue) or `200` (red). Re-uses the API's side type.
pub use crate::api::wire::Side as TeamId;

/// The client's error body (`{ errorCode, httpStatus, message }`).
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LcuErrorBody {
    /// `RPC_ERROR`, `RESOURCE_NOT_FOUND`, ...
    pub error_code: String,
    /// The HTTP status it mirrors.
    pub http_status: i64,
    /// `LOBBY_NOT_FOUND`, `INVALID_LOBBY`, ...
    pub message: String,
}

/// `GET /lol-summoner/v1/current-summoner`, `GET /lol-summoner/v2/summoners/puuid/{puuid}`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Summoner {
    /// The player's puuid.
    pub puuid: String,
    /// The summoner id (invites use it).
    pub summoner_id: i64,
    /// `accountId`.
    pub account_id: Option<i64>,
    /// Riot ID name; `""` when unknown.
    pub game_name: String,
    /// Riot ID tag; `""` when unknown.
    pub tag_line: String,
    /// `summonerLevel`.
    pub summoner_level: Option<i64>,
    /// `profileIconId`.
    pub profile_icon_id: Option<i64>,
    /// `privacy`.
    pub privacy: Option<String>,
    /// `unnamed`.
    pub unnamed: Option<bool>,
}

/// One `queueMap` entry of the ranked stats.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RankedQueueEntry {
    /// `RANKED_SOLO_5x5`, ...
    pub queue_type: String,
    /// `""` for unranked.
    pub tier: String,
    /// `"NA"` for unranked.
    pub division: String,
    /// LP.
    pub league_points: i64,
    /// Read for the own player only (another player's counters are not truth).
    pub wins: i64,
    /// As `wins`.
    pub losses: i64,
    /// `isProvisional`.
    pub is_provisional: bool,
    /// `highestTier`.
    pub highest_tier: Option<String>,
    /// `highestDivision`.
    pub highest_division: Option<String>,
    /// `previousSeasonEndTier`.
    pub previous_season_end_tier: Option<String>,
    /// `previousSeasonEndDivision`.
    pub previous_season_end_division: Option<String>,
}

/// `GET /lol-ranked/v1/current-ranked-stats`, `GET /lol-ranked/v1/ranked-stats/{puuid}`, and the
/// `/lol-ranked/v1/cached-ranked-stats/{puuid}` event.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RankedStats {
    /// Queue name to entry. Other queues (TFT, ...) are kept unread as raw JSON; only the two SR queues
    /// are checked when present, as the zod schema does.
    pub queue_map: QueueMap,
    /// `highestRankedEntry`.
    pub highest_ranked_entry: Option<RankedQueueEntry>,
    /// `highestRankedEntrySR`.
    #[serde(rename = "highestRankedEntrySR")]
    pub highest_ranked_entry_sr: Option<RankedQueueEntry>,
    /// `highestCurrentSeasonReachedTierSR`.
    #[serde(rename = "highestCurrentSeasonReachedTierSR")]
    pub highest_current_season_reached_tier_sr: Option<String>,
}

/// `queueMap`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct QueueMap {
    /// Solo/duo, the one queue a rating is seeded from.
    #[serde(rename = "RANKED_SOLO_5x5")]
    pub ranked_solo_5x5: Option<RankedQueueEntry>,
    /// Flex.
    #[serde(rename = "RANKED_FLEX_SR")]
    pub ranked_flex_sr: Option<RankedQueueEntry>,
    /// Every other queue, unread.
    #[serde(flatten)]
    pub other: Map<String, Value>,
}

/// A string, or `None` for anything else (a null, a number, an object): the game mode is read for the
/// `in_progress` post (M21.12), and a field the client changed must never cost the post.
fn string_or_none<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<String>, D::Error> {
    Ok(match Value::deserialize(deserializer)? {
        Value::String(text) => Some(text),
        _ => None,
    })
}

/// One player of a gameflow session team.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameflowTeamMember {
    /// The puuid.
    pub puuid: String,
    /// `summonerId`.
    pub summoner_id: Option<i64>,
    /// `championId`.
    pub champion_id: Option<i64>,
    /// `teamParticipantId`.
    pub team_participant_id: Option<i64>,
    /// `selectedPosition`.
    pub selected_position: Option<String>,
}

/// `gameData.queue`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameflowQueue {
    /// Queue id.
    pub id: i64,
    /// `type`.
    #[serde(rename = "type")]
    pub kind: Option<String>,
    /// `gameMode`.
    #[serde(default, deserialize_with = "string_or_none")]
    pub game_mode: Option<String>,
    /// `name`.
    pub name: Option<String>,
    /// `isCustom`.
    pub is_custom: Option<bool>,
    /// `mapId`.
    pub map_id: Option<i64>,
}

/// `gameData`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameflowGameData {
    /// The game id: the current game's from `GameStart` on, **the previous game's** in `Lobby`/`None`.
    pub game_id: i64,
    /// `isCustomGame`.
    pub is_custom_game: bool,
    /// `gameName`.
    pub game_name: Option<String>,
    /// `queue`.
    pub queue: GameflowQueue,
    /// `teamOne`.
    pub team_one: Vec<GameflowTeamMember>,
    /// `teamTwo`.
    pub team_two: Vec<GameflowTeamMember>,
}

/// `map`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameflowMap {
    /// Map id.
    pub id: i64,
    /// `gameMode`.
    #[serde(default, deserialize_with = "string_or_none")]
    pub game_mode: Option<String>,
    /// `name`.
    pub name: Option<String>,
}

/// `gameClient`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct GameflowGameClient {
    /// `running`.
    pub running: bool,
    /// `visible`.
    pub visible: bool,
}

/// `GET /lol-gameflow/v1/session`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameflowSession {
    /// The phase (`Lobby`, `InProgress`, ...).
    pub phase: String,
    /// `gameData`.
    pub game_data: GameflowGameData,
    /// `map`.
    pub map: GameflowMap,
    /// `gameClient`.
    pub game_client: Option<GameflowGameClient>,
}

impl GameflowSession {
    /// The game mode the client names, for the `in_progress` post (M21.12): `gameData.queue.gameMode`,
    /// else `map.gameMode`, trimmed and upper-cased (`CLASSIC`, `ARAM`, ...). `None` for a missing,
    /// blank or implausible value (over 32 chars or not alphanumeric/underscore), so a malformed
    /// session never sends a junk field; the server then behaves as for an old companion.
    #[must_use]
    pub fn game_mode(&self) -> Option<String> {
        [
            self.game_data.queue.game_mode.as_deref(),
            self.map.game_mode.as_deref(),
        ]
        .into_iter()
        .flatten()
        .map(|mode| mode.trim().to_ascii_uppercase())
        .find(|mode| {
            !mode.is_empty()
                && mode.len() <= 32
                && mode.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
        })
    }
}

/// One lobby member (`members[]`, `customTeam100/200[]`, `customSpectators[]`, `localMember`).
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LobbyMember {
    /// `""` for a bot slot.
    pub puuid: String,
    /// `summonerId`.
    pub summoner_id: i64,
    /// Always `""` on 16.17.
    pub summoner_name: Option<String>,
    /// `summonerLevel`.
    pub summoner_level: Option<i64>,
    /// `summonerIconId`.
    pub summoner_icon_id: Option<i64>,
    /// The client's bot flag.
    pub is_bot: bool,
    /// `isLeader`.
    pub is_leader: bool,
    /// `isSpectator`.
    pub is_spectator: bool,
    /// `ready`.
    pub ready: Option<bool>,
    /// Always `0` in a custom lobby: never read for the side.
    pub team_id: i64,
    /// `botChampionId`.
    pub bot_champion_id: Option<i64>,
    /// `botDifficulty`.
    pub bot_difficulty: Option<String>,
    /// `firstPositionPreference`.
    pub first_position_preference: Option<String>,
    /// `secondPositionPreference`.
    pub second_position_preference: Option<String>,
    /// `allowedInviteOthers`.
    pub allowed_invite_others: Option<bool>,
    /// `allowedStartActivity`.
    pub allowed_start_activity: Option<bool>,
}

/// One lobby invitation.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LobbyInvitation {
    /// `invitationId`.
    pub invitation_id: String,
    /// `invitationType`.
    pub invitation_type: String,
    /// `Pending`, `Accepted`, ...
    pub state: String,
    /// `timestamp`.
    pub timestamp: String,
    /// `toPuuid`.
    pub to_puuid: String,
    /// `toSummonerId`.
    pub to_summoner_id: i64,
    /// `toSummonerName`.
    pub to_summoner_name: Option<String>,
}

/// `gameConfig`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LobbyGameConfig {
    /// `queueId`.
    pub queue_id: i64,
    /// `gameMode`.
    pub game_mode: String,
    /// Only custom lobbies are posted.
    pub is_custom: bool,
    /// `mapId`.
    pub map_id: i64,
    /// `customLobbyName`.
    pub custom_lobby_name: Option<String>,
    /// `customMutatorName`.
    pub custom_mutator_name: Option<String>,
    /// `customSpectatorPolicy`.
    pub custom_spectator_policy: Option<String>,
    /// `maxTeamSize`.
    pub max_team_size: Option<i64>,
    /// `isLobbyFull`.
    pub is_lobby_full: Option<bool>,
    /// Side 100, by puuid.
    #[serde(rename = "customTeam100")]
    pub custom_team_100: Vec<LobbyMember>,
    /// Side 200, by puuid.
    #[serde(rename = "customTeam200")]
    pub custom_team_200: Vec<LobbyMember>,
    /// `customSpectators`.
    pub custom_spectators: Option<Vec<LobbyMember>>,
}

/// `GET /lol-lobby/v2/lobby` and its event.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Lobby {
    /// The dedupe key.
    #[serde(deserialize_with = "non_empty")]
    pub party_id: String,
    /// `partyType`.
    pub party_type: Option<String>,
    /// `canStartActivity`.
    pub can_start_activity: Option<bool>,
    /// `gameConfig`.
    pub game_config: LobbyGameConfig,
    /// The roster (humans; bots live in the team arrays).
    pub members: Vec<LobbyMember>,
    /// The local player.
    pub local_member: LobbyMember,
    /// `invitations`.
    pub invitations: Option<Vec<LobbyInvitation>>,
}

/// One mutator of the Create Custom dialog.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomGameMutator {
    /// The id the create body sends as `queueId` and `mutators.id`.
    pub id: i64,
    /// `name` (often empty on 16.18).
    pub name: Option<String>,
    /// `pickMode`.
    pub pick_mode: Option<String>,
    /// `banMode`.
    pub ban_mode: Option<String>,
    /// `numPlayersPerTeamOverride`.
    pub num_players_per_team_override: Option<i64>,
}

/// One subcategory (map + mode) of the dialog.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomGameSubcategory {
    /// `mapId`.
    pub map_id: i64,
    /// `gameMode`.
    pub game_mode: String,
    /// `mutators`.
    pub mutators: Vec<CustomGameMutator>,
    /// `numPlayersPerTeam`.
    pub num_players_per_team: Option<i64>,
    /// `maximumParticipantListSize`.
    pub maximum_participant_list_size: Option<i64>,
    /// `queueAvailability`.
    pub queue_availability: Option<String>,
    /// `customSpectatorPolicies`.
    pub custom_spectator_policies: Option<Vec<String>>,
}

/// `GET /lol-game-queues/v1/custom`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomGameQueues {
    /// `subcategories`.
    pub subcategories: Vec<CustomGameSubcategory>,
    /// `queueAvailability`.
    pub queue_availability: Option<String>,
    /// `spectatorPolicies`.
    pub spectator_policies: Option<Vec<String>>,
    /// `spectatorSlotLimit`.
    pub spectator_slot_limit: Option<i64>,
    /// `null` on 16.18, not absent.
    pub game_server_regions: Option<Vec<String>>,
}

/// `gameTypeConfig` of a queue.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameTypeConfig {
    /// `id`.
    pub id: i64,
    /// `name`.
    pub name: Option<String>,
    /// `pickMode`.
    pub pick_mode: Option<String>,
    /// `banMode`.
    pub ban_mode: Option<String>,
}

/// One entry of `GET /lol-game-queues/v1/queues`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameQueue {
    /// `id`.
    pub id: i64,
    /// `SR Draft Pick Custom`, ...
    pub name: Option<String>,
    /// `gameMode`.
    pub game_mode: Option<String>,
    /// `mapId`.
    pub map_id: Option<i64>,
    /// `isCustom`.
    pub is_custom: Option<bool>,
    /// `category`.
    pub category: Option<String>,
    /// `gameTypeConfig`.
    pub game_type_config: Option<GameTypeConfig>,
}

/// The uppercase stats of an end-of-game line (the camelCase duplicates beside them are not read).
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[allow(non_snake_case, missing_docs)]
pub struct EogPlayerStats {
    pub CHAMPIONS_KILLED: i64,
    pub NUM_DEATHS: i64,
    pub ASSISTS: i64,
    pub GOLD_EARNED: i64,
    pub TOTAL_DAMAGE_DEALT_TO_CHAMPIONS: i64,
    pub MINIONS_KILLED: i64,
    pub NEUTRAL_MINIONS_KILLED: i64,
    pub LEVEL: i64,
    pub VISION_SCORE: i64,
    pub WIN: i64,
    pub kills: Option<i64>,
    pub deaths: Option<i64>,
    pub assists: Option<i64>,
    pub goldEarned: Option<i64>,
    pub totalMinionsKilled: Option<i64>,
    pub champLevel: Option<i64>,
    /// The stats no field above names (the mapper reads a missing one as 0).
    #[serde(flatten)]
    pub all: Map<String, Value>,
}

/// One player line of the end-of-game block.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EogPlayer {
    /// The all-zero puuid for a bot.
    pub puuid: String,
    /// `summonerId`.
    pub summoner_id: i64,
    /// `teamId`.
    pub team_id: TeamId,
    /// `championId`.
    pub champion_id: i64,
    /// `championName`.
    pub champion_name: Option<String>,
    /// `riotIdGameName`.
    pub riot_id_game_name: String,
    /// `riotIdTagLine`.
    pub riot_id_tag_line: String,
    /// `summonerName`.
    pub summoner_name: Option<String>,
    /// `isLocalPlayer`.
    pub is_local_player: bool,
    /// The bot flag.
    pub bot_player: bool,
    /// `leaver`.
    pub leaver: Option<bool>,
    /// `wasAfk`.
    pub was_afk: Option<bool>,
    /// `TOP`/`JUNGLE`/`MIDDLE`/`BOTTOM`/`UTILITY` or absent.
    pub detected_team_position: Option<String>,
    /// `selectedPosition`.
    pub selected_position: Option<String>,
    /// The stats.
    pub stats: EogPlayerStats,
}

/// One team of the end-of-game block.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EogTeam {
    /// `teamId`.
    pub team_id: TeamId,
    /// Nobody has it on a `TerminatedInError` block.
    pub is_winning_team: bool,
    /// `isPlayerTeam`.
    pub is_player_team: Option<bool>,
    /// `players`.
    pub players: Vec<EogPlayer>,
}

/// `GET /lol-end-of-game/v1/eog-stats-block` and its event.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EogStatsBlock {
    /// The game id (the dedupe key).
    pub game_id: i64,
    /// `CUSTOM_GAME` for a custom.
    pub game_type: String,
    /// `gameMode`.
    pub game_mode: Option<String>,
    /// Seconds.
    pub game_length: i64,
    /// `queueId` (may be `null`).
    pub queue_id: Option<i64>,
    /// `queueType`.
    pub queue_type: Option<String>,
    /// `ranked`.
    pub ranked: Option<bool>,
    /// `invalid`.
    pub invalid: Option<bool>,
    /// `gameEndedInEarlySurrender`.
    pub game_ended_in_early_surrender: Option<bool>,
    /// `teamEarlySurrendered`.
    pub team_early_surrendered: Option<bool>,
    /// Epoch milliseconds.
    pub end_of_game_timestamp: Option<f64>,
    /// `teams`.
    pub teams: Vec<EogTeam>,
    /// `localPlayer`.
    pub local_player: EogPlayer,
}

/// A match-history participant's stats (camelCase here).
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchParticipantStats {
    /// `participantId`.
    pub participant_id: i64,
    /// `win`.
    pub win: bool,
    /// `kills`.
    pub kills: i64,
    /// `deaths`.
    pub deaths: i64,
    /// `assists`.
    pub assists: i64,
    /// `goldEarned`.
    pub gold_earned: i64,
    /// `totalDamageDealtToChampions`.
    pub total_damage_dealt_to_champions: i64,
    /// `totalMinionsKilled`.
    pub total_minions_killed: i64,
    /// `neutralMinionsKilled`.
    pub neutral_minions_killed: i64,
    /// `champLevel`.
    pub champ_level: i64,
    /// `visionScore`.
    pub vision_score: Option<i64>,
    /// `gameEndedInEarlySurrender`.
    pub game_ended_in_early_surrender: Option<bool>,
    /// The stats no field above names (the mapper reads a missing one as 0).
    #[serde(flatten)]
    pub all: Map<String, Value>,
}

/// `timeline` of a participant.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct MatchTimeline {
    /// `role`.
    pub role: Option<String>,
    /// `lane`.
    pub lane: Option<String>,
}

/// One match-history participant.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchParticipant {
    /// `participantId`.
    pub participant_id: i64,
    /// `teamId`.
    pub team_id: TeamId,
    /// `championId`.
    pub champion_id: i64,
    /// `spell1Id`.
    pub spell1_id: Option<i64>,
    /// `spell2Id`.
    pub spell2_id: Option<i64>,
    /// `stats`.
    pub stats: MatchParticipantStats,
    /// `timeline`.
    pub timeline: Option<MatchTimeline>,
}

/// `participantIdentities[].player`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchPlayer {
    /// `puuid`.
    pub puuid: String,
    /// `summonerId`.
    pub summoner_id: i64,
    /// `gameName`.
    pub game_name: String,
    /// `tagLine`.
    pub tag_line: String,
    /// `platformId`.
    pub platform_id: Option<String>,
}

/// `participantIdentities[]`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchParticipantIdentity {
    /// `participantId`.
    pub participant_id: i64,
    /// `player`.
    pub player: MatchPlayer,
}

/// A ban.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchBan {
    /// `championId`.
    pub champion_id: i64,
    /// `pickTurn`.
    pub pick_turn: i64,
}

/// `teams[]` of a match.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchTeam {
    /// `teamId`.
    pub team_id: TeamId,
    /// `"Win"` or `"Fail"`.
    pub win: String,
    /// `bans`.
    pub bans: Option<Vec<MatchBan>>,
}

/// A game, as a match-history list entry or `GET /lol-match-history/v1/games/{gameId}`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchGame {
    /// `gameId`.
    pub game_id: i64,
    /// `CUSTOM_GAME`, `MATCHED_GAME`.
    pub game_type: String,
    /// `queueId`.
    pub queue_id: i64,
    /// `gameMode`.
    pub game_mode: String,
    /// `mapId`.
    pub map_id: i64,
    /// Epoch milliseconds.
    pub game_creation: i64,
    /// `gameCreationDate`.
    pub game_creation_date: Option<String>,
    /// Seconds.
    pub game_duration: i64,
    /// `gameVersion`.
    pub game_version: Option<String>,
    /// `platformId`.
    pub platform_id: String,
    /// `GameComplete`, `Abort_TooFewPlayers`, ...
    pub end_of_game_result: Option<String>,
    /// `participants`.
    pub participants: Vec<MatchParticipant>,
    /// `participantIdentities`.
    pub participant_identities: Vec<MatchParticipantIdentity>,
    /// `teams`.
    pub teams: Vec<MatchTeam>,
}

/// A match detail is a game.
pub type MatchDetail = MatchGame;

/// `games` of the list.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchHistoryGames {
    /// `gameCount`.
    pub game_count: i64,
    /// `gameIndexBegin`.
    pub game_index_begin: i64,
    /// `gameIndexEnd`.
    pub game_index_end: i64,
    /// `games`.
    pub games: Vec<MatchGame>,
}

/// `GET /lol-match-history/v1/products/lol/{puuid}/matches?begIndex=&endIndex=`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchHistoryList {
    /// `accountId`.
    pub account_id: Option<i64>,
    /// `platformId`.
    pub platform_id: Option<String>,
    /// `games`.
    pub games: MatchHistoryGames,
}

fn non_empty<'de, D: Deserializer<'de>>(deserializer: D) -> Result<String, D::Error> {
    let value = String::deserialize(deserializer)?;
    if value.is_empty() {
        return Err(serde::de::Error::custom("must not be empty"));
    }
    Ok(value)
}
