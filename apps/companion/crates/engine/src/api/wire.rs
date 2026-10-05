//! The request bodies Kustom sends to `/api/companion/*` and the answers it reads, as serde types (M17.6).
//!
//! **Requests** are pinned by the TypeScript engine's goldens (`tests/goldens/*.json`): `tests/goldens.rs`
//! proves every golden deserialises into them and serialises back JSON-equal, so the field names, the
//! `null`-versus-absent distinctions and the number types are fixed. They keep `deny_unknown_fields`: the
//! goldens prove the whole shape, and a field the Rust side invents would be caught here. A change that
//! breaks a golden is a contract change, which is a platform task with its own ID.
//!
//! **Responses** mirror `companionResponses.ts` and `invites.ts` (the `{ ok: true, ... }` half; the
//! failure half is [`ErrorResponse`]). They do *not* deny unknown fields: zod's `z.object` strips extra
//! keys, so a server that adds a field must not break an installed Kustom. `ok` must be `true`
//! ([`OkTrue`]); enums are as strict as the zod enums they mirror.
//!
//! The server's zod schemas in `packages/db/src/schemas/companion.ts`, `companionResponses.ts` and
//! `invites.ts` are the authority; these mirror what the TypeScript engine actually sends, which is a
//! subset (for example it never sends `visionScore` or `droppedMembers`).

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::{Map, Value};

use crate::config::CompanionToken;

/// A team side: `100` (blue) or `200` (red), as the client and the API spell it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Side {
    /// `100`.
    Blue,
    /// `200`.
    Red,
}

impl Side {
    /// The number on the wire.
    pub fn as_u16(self) -> u16 {
        match self {
            Side::Blue => 100,
            Side::Red => 200,
        }
    }
}

impl Serialize for Side {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_u16(self.as_u16())
    }
}

impl<'de> Deserialize<'de> for Side {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        match u16::deserialize(deserializer)? {
            100 => Ok(Side::Blue),
            200 => Ok(Side::Red),
            other => Err(serde::de::Error::custom(format!(
                "side must be 100 or 200, got {other}"
            ))),
        }
    }
}

/// A role as the API names it. The client's `detectedTeamPosition` maps onto these (`UTILITY` is
/// `support`, `BOTTOM` is `adc`); anything else is `null`, never guessed from the champion.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    /// `top`.
    Top,
    /// `jungle`.
    Jungle,
    /// `mid`.
    Mid,
    /// `adc`.
    Adc,
    /// `support`.
    Support,
}

/// `POST /api/companion/lobby`: the whole roster, posted every time it changes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LobbyPayload {
    /// `lobby.partyId`, the dedupe key (`lcu_party_id`).
    pub party_id: String,
    /// `gameConfig.customLobbyName`.
    pub lobby_name: Option<String>,
    /// The password this process set when it created the party, else `null` (the server never clears on
    /// `null`). Always present on the wire.
    pub lobby_password: Option<String>,
    /// Humans from `members[]` only.
    pub members: Vec<LobbyMember>,
}

/// One person in the lobby.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LobbyMember {
    /// `members[].puuid`.
    pub puuid: String,
    /// `members[].summonerId`, the client's number as a JSON number.
    pub summoner_id: i64,
    /// From a name the process already knows; `null` otherwise (a post never waits on a lookup).
    pub game_name: Option<String>,
    /// As `game_name`.
    pub tag_line: Option<String>,
    /// Membership of `customTeam100`/`customTeam200`; `null` for a spectator or an unplaced member.
    pub side: Option<Side>,
    /// `members[].isSpectator` or membership of `customSpectators`.
    pub is_spectator: bool,
}

/// `POST /api/companion/game`: the two posts per game, switched on `phase`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "phase", rename_all = "snake_case")]
pub enum GamePayload {
    /// At `GameStart` (or `InProgress`), from one session read.
    InProgress(InProgressPayload),
    /// The end-of-game block, live or from a backfilled match detail.
    Eog(EogPayload),
}

/// `phase: "in_progress"`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InProgressPayload {
    /// `gameflow-session.gameData.gameId`, read from `GameStart` on only.
    pub game_id: u64,
    /// The last custom lobby's `partyId` this process saw, or `null`.
    pub party_id: Option<String>,
    /// When the phase was observed, ISO 8601.
    pub started_at: Option<String>,
    /// The game mode from the session (`gameData.queue.gameMode`, else `map.gameMode`; M21.12), upper
    /// case. Omitted from the body when the session names none. Unverified for ARAM on a live client.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub game_mode: Option<String>,
}

/// Where an end-of-game post came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GameSource {
    /// Captured live (the default; the TypeScript engine never sends it).
    Eog,
    /// A match-history detail the backfill walked.
    Backfill,
}

/// `phase: "eog"`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EogPayload {
    /// The block's own `gameId` (or the detail's), the dedupe key (`lcu_game_id`).
    pub game_id: u64,
    /// A live block: present, the held `partyId` or `null`. A backfilled game: **absent**, no key at all.
    #[serde(default, skip_serializing_if = "Option::is_none", with = "double_option")]
    pub party_id: Option<Option<String>>,
    /// Absent for a live block; `"backfill"` for a backfilled game.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<GameSource>,
    /// The block's `gameType` (`CUSTOM_GAME`).
    pub game_type: Option<String>,
    /// ISO 8601: the observed `InProgress` moment, else `endOfGameTimestamp - gameLength * 1000`; for a
    /// backfilled game `gameCreation`.
    pub started_at: String,
    /// `gameLength` (or `gameDuration`), seconds.
    pub duration_s: u64,
    /// The winning team's `teamId`. The companion never posts a `null` (it drops the block instead).
    pub winning_side: Option<Side>,
    /// Humans only.
    pub participants: Vec<GameParticipant>,
    /// The whole block (or detail), scrubbed of credentials.
    pub raw: Map<String, Value>,
}

/// One participant line of an end-of-game post.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GameParticipant {
    /// The player's puuid.
    pub puuid: String,
    /// The team's `teamId`.
    pub side: Side,
    /// `detectedTeamPosition` through the published table; always `null` for a backfilled game on 16.17.
    pub role: Option<Role>,
    /// `championId`.
    pub champion_id: u64,
    /// `CHAMPIONS_KILLED` (`kills` in a match detail).
    pub kills: u64,
    /// `NUM_DEATHS` (`deaths`).
    pub deaths: u64,
    /// `ASSISTS` (`assists`).
    pub assists: u64,
    /// `GOLD_EARNED` (`goldEarned`).
    pub gold: u64,
    /// `TOTAL_DAMAGE_DEALT_TO_CHAMPIONS` (`totalDamageDealtToChampions`).
    pub damage_to_champs: u64,
    /// Lane minions plus neutral minions.
    pub cs: u64,
    /// `WIN === 1` (`stats.win`).
    pub win: bool,
    /// `riotIdGameName` (`player.gameName`), `""` sent as `null`.
    pub game_name: Option<String>,
    /// `riotIdTagLine` (`player.tagLine`), `""` sent as `null`.
    pub tag_line: Option<String>,
    /// The client's summoner id, as a number.
    pub summoner_id: i64,
}

/// `POST /api/companion/rank`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RankPayload {
    /// The puuid the companion asked about (the response carries none).
    pub puuid: String,
    /// `queueMap[queue].tier`, verbatim (`""` for unranked; the server folds it).
    pub tier: Option<String>,
    /// `queueMap[queue].division`, verbatim (`"NA"` for unranked).
    pub division: Option<String>,
    /// `queueMap[queue].leaguePoints`.
    pub lp: Option<u64>,
    /// The `queueMap` key, `RANKED_SOLO_5x5`.
    pub queue: String,
    /// From the summoner lookup, or `null`.
    pub game_name: Option<String>,
    /// From the summoner lookup, or `null`.
    pub tag_line: Option<String>,
}

/// `POST /api/companion/backfill/scan`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackfillScanRequest {
    /// 1 to 100 game ids, in match-history order.
    pub game_ids: Vec<u64>,
}

/// `GET /api/companion/commands?clientConnected=true|false`: the poll has no body, only this query.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CommandsPoll {
    /// Whether the League client is up right now.
    pub client_connected: bool,
}

impl CommandsPoll {
    /// The path and query, exactly as the TypeScript engine builds it by hand.
    pub fn path(self) -> String {
        format!(
            "/api/companion/commands?clientConnected={}",
            if self.client_connected { "true" } else { "false" }
        )
    }
}

/// `POST /api/companion/commands/{id}/ack`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CommandAck {
    /// The kind's result.
    pub result: CommandResult,
}

/// An ack's `result`, one shape per command kind. The kind is not on the wire; the runner knows it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum CommandResult {
    /// `switch_side`.
    SwitchSide(SwitchSideResult),
}

impl CommandResult {
    /// The command kind this result answers, as the server spells it.
    pub fn kind(&self) -> &'static str {
        match self {
            CommandResult::SwitchSide(_) => "switch_side",
        }
    }
}

/// `switch_side`'s result.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SwitchSideResult {
    /// The side the local player is on now.
    pub side: Side,
}

/// `POST /api/companion/commands/{id}/nack`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CommandNack {
    /// A reason word, then `: ` and a detail (`client_rejected: /lol-lobby/v2/lobby answered 500 ...`).
    /// Prose, at most 500 characters; never a body.
    pub error: String,
    /// True only when nothing was executed (`not_connected`, or no HTTP answer at all).
    pub retryable: bool,
}

/// How a pairing asks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PairMode {
    /// Asks for a host token. The Rust app always sends this.
    Host,
    /// 0.3.x's overlay pairing. Never sent by the Rust app.
    Overlay,
}

/// `POST /api/companion/pair` (no bearer token).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PairRequest {
    /// The six-character code, upper-cased and stripped to the alphabet.
    pub code: String,
    /// `current-summoner.puuid`.
    pub puuid: String,
    /// Absent means overlay on the server; the Rust app always sends `host`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<PairMode>,
}

// ---------------------------------------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------------------------------------

/// The envelope's `ok: true`. Deserialising `false` (or anything else) fails.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct OkTrue;

impl Serialize for OkTrue {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_bool(true)
    }
}

impl<'de> Deserialize<'de> for OkTrue {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        if bool::deserialize(deserializer)? {
            Ok(OkTrue)
        } else {
            Err(serde::de::Error::custom("ok must be true"))
        }
    }
}

/// One issue in a failure envelope.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ApiIssue {
    /// The field path, dotted.
    pub path: String,
    /// What is wrong.
    pub message: String,
}

/// `{ ok: false, error, issues? }`, every route's failure answer (`companionErrorResponseSchema`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ErrorResponse {
    /// Always `false`.
    pub ok: bool,
    /// The server's sentence.
    pub error: String,
    /// Validation issues, on a 400.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub issues: Option<Vec<ApiIssue>>,
}

/// A group as the API names it (`groupSummarySchema`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GroupSummary {
    /// The group id (a UUID).
    pub id: String,
    /// Its slug.
    pub slug: String,
    /// Its name.
    pub name: String,
}

/// `GET /api/companion/me` (`companionMeResponseSchema`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeResponse {
    /// `true`.
    pub ok: OkTrue,
    /// The token's player.
    pub puuid: String,
    /// `players.id`.
    pub player_id: String,
    /// `players.display_name`, null until known.
    pub display_name: Option<String>,
    /// The token's group. Always sent since M14.12; read as optional (as 0.4.0 did) so an older server
    /// still parses, and the token then simply stays unfiled.
    #[serde(default)]
    pub group: Option<GroupSummary>,
}

/// `POST /api/companion/pair` (`companionPairResponseSchema`): the group, plus in host mode a token or a
/// refusal, never both ([`PairResponse::validate`]).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairResponse {
    /// `true`.
    pub ok: OkTrue,
    /// The group.
    pub group: GroupSummary,
    /// A host token, minted once. Registered as a log secret as it is parsed; its `Debug` is redacted.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub companion_token: Option<CompanionToken>,
    /// A member's code: the server's sentence, nothing to save.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host_refusal: Option<String>,
}

impl PairResponse {
    /// The schema's `.refine`: a token or a refusal, never both; a refusal is not empty.
    pub fn validate(&self) -> Result<(), String> {
        if self.companion_token.is_some() && self.host_refusal.is_some() {
            return Err("a pair answer carries a token or a host refusal, never both".to_owned());
        }
        if self.host_refusal.as_deref().is_some_and(str::is_empty) {
            return Err("hostRefusal: empty".to_owned());
        }
        Ok(())
    }
}

/// A lobby's status (`lobbyStatusSchema`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LobbyStatus {
    /// Filling.
    Open,
    /// Teams rolled.
    Balanced,
    /// Game running.
    InGame,
    /// `in_game` and nobody posted for two hours.
    Dropped,
    /// Recorded.
    Finished,
    /// Gone.
    Abandoned,
}

/// `POST /api/companion/lobby` (`companionLobbyResponseSchema`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LobbyResponse {
    /// `true`.
    pub ok: OkTrue,
    /// The lobby row.
    pub lobby_id: String,
    /// Its status, echoed for the log.
    pub status: LobbyStatus,
    /// False on the second identical post.
    pub created: bool,
    /// Stored members.
    pub member_count: u64,
    /// The roster is history; this post changed nothing.
    pub roster_frozen: bool,
    /// Knock again in this many milliseconds, or `null`. Required and nullable.
    pub recheck_in_ms: Option<u64>,
    /// PUUIDs the server wants a rank for.
    pub ranks_needed: Vec<String>,
}

/// Which phase a game answer is for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GamePhase {
    /// `in_progress`.
    InProgress,
    /// `eog`.
    Eog,
}

/// `POST /api/companion/game` (`companionGameResponseSchema`). A 2xx deletes the queued copy.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameResponse {
    /// `true`.
    pub ok: OkTrue,
    /// The phase posted.
    pub phase: GamePhase,
    /// False when this `lcu_game_id` was already stored.
    pub created: bool,
    /// The game row, if stored.
    pub game_id: Option<String>,
    /// The lobby row, if known.
    pub lobby_id: Option<String>,
    /// `game_players` rows.
    pub participants: u64,
    /// Whether the rating fold ran.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rated: Option<bool>,
    /// The gate that stopped it, when not rated.
    #[serde(default, skip_serializing_if = "Option::is_none", with = "double_option")]
    pub reason: Option<Option<String>>,
    /// `1` when a backfilled game was not this group's.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skipped_not_this_group: Option<u64>,
}

/// `POST /api/companion/rank` (`companionRankResponseSchema`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RankResponse {
    /// `true`.
    pub ok: OkTrue,
    /// The player row.
    pub player_id: String,
    /// False for a queue ratings are not seeded from.
    pub stored: bool,
}

/// `approved: true`, the literal the server keeps for shipped companions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ApprovedTrue;

impl Serialize for ApprovedTrue {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_bool(true)
    }
}

impl<'de> Deserialize<'de> for ApprovedTrue {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        if bool::deserialize(deserializer)? {
            Ok(ApprovedTrue)
        } else {
            Err(serde::de::Error::custom("approved must be true"))
        }
    }
}

/// `POST /api/companion/backfill/scan` (`companionBackfillScanResponseSchema`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BackfillScanResponse {
    /// `true`.
    pub ok: OkTrue,
    /// Always `true`.
    pub approved: ApprovedTrue,
    /// The ids the server still wants a detail for.
    pub unknown: Vec<u64>,
}

/// One command as the poll hands it out (`companionCommandEnvelopeSchema`): loose on purpose, so the
/// runner can nack a kind or payload it does not know instead of dropping the page.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandEnvelope {
    /// The command id (a UUID).
    pub id: String,
    /// The kind, as the server names it.
    pub kind: String,
    /// The kind's payload, checked by the runner (M17.10).
    pub payload: Map<String, Value>,
    /// ISO 8601.
    pub created_at: String,
    /// ISO 8601.
    pub expires_at: String,
}

/// `GET /api/companion/commands` (`companionCommandsResponseSchema`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandsResponse {
    /// `true`.
    pub ok: OkTrue,
    /// At most [`COMMANDS_PAGE_SIZE`], oldest first.
    pub commands: Vec<CommandEnvelope>,
    /// The server's poll interval, when it sets one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_poll_in_ms: Option<u64>,
}

/// Commands per poll; the companion refuses a longer page.
pub const COMMANDS_PAGE_SIZE: usize = 10;

impl CommandsResponse {
    /// The schema's `.max(10)` and `.positive()`.
    pub fn validate(&self) -> Result<(), String> {
        if self.commands.len() > COMMANDS_PAGE_SIZE {
            return Err(format!("commands: more than {COMMANDS_PAGE_SIZE}"));
        }
        if self.next_poll_in_ms == Some(0) {
            return Err("nextPollInMs: must be positive".to_owned());
        }
        Ok(())
    }
}

/// `{ ok: true }`: the ack and nack answer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct AckResponse {
    /// `true`.
    pub ok: OkTrue,
}

/// `GET /api/health`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HealthResponse {
    /// `true`.
    pub ok: OkTrue,
    /// `customs-night`.
    pub service: String,
}

/// `Option<Option<T>>` that tells an absent key (`None`) from an explicit `null` (`Some(None)`).
mod double_option {
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    pub fn serialize<T: Serialize, S: Serializer>(
        value: &Option<Option<T>>,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        match value {
            Some(inner) => inner.serialize(serializer),
            None => serializer.serialize_none(),
        }
    }

    pub fn deserialize<'de, T: Deserialize<'de>, D: Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Option<Option<T>>, D::Error> {
        Option::<T>::deserialize(deserializer).map(Some)
    }
}
