//! The command runner (parity row 16, port of `apps/companion/src/commandRunner.ts` and `executed.ts`):
//! polls `GET /api/companion/commands`, runs each command through the three lobby writes, and answers with
//! an ack (result) or a nack (reason). **Lobby commands only** (create lobby, invite, switch side): never
//! champion select, never a game, never a queue (CLAUDE.md "Never automate gameplay").
//!
//! Rules, in the order applied to every command (the TS order):
//! 1. **Executed once.** An id in `commands-done.json` is re-answered from its record; no client call. The
//!    record is written after the client call and before the ack.
//! 2. **Stale** (held longer than its own TTL since the poll, e.g. the PC slept): `expired`. `expiresAt` is
//!    never compared with the local clock.
//! 3. **Malformed** (a kind the enum does not name, a payload that fails its schema): `malformed_payload`.
//! 4. **Gate:** a write whose docs/03 row is not verified: `endpoint_unverified`, no client call.
//! 5. **No client:** `not_connected`, retryable (nothing ran, so nothing is recorded).
//! 6. **Phase** other than `None`/`Lobby`: `wrong_phase`.
//! 7. **Read before write:** every executor reads the lobby first; a second create finds the lobby and nacks
//!    `already_in_lobby`; a second invite or switch finds the work done and acks without a POST.
//! 8. **Ids from the client:** the create body's id is the dialog's draft entry, never a constant.
//!
//! Polling: every `nextPollInMs` (5 s) while connected, every 60 s with `clientConnected=false` while not.
//! One command at a time, in the order handed out. The password of a lobby this process created is kept
//! in memory ([`CommandRunnerHandle::passwords`]) so the lobby watcher sends it with every post for that
//! party. Nothing here panics or ends the process.

use std::collections::HashMap;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, UNIX_EPOCH};

use serde_json::{Map, Value, json};
use tokio::sync::{mpsc, watch};
use tokio::task::JoinSet;

use super::connection::{ConnectedContext, MachineEvent, WATCHER_QUEUE, WatcherFeed};
use super::lobby::{Cancel, Scheduler, TokioScheduler};
use super::{CommandOutcome as RecordedOutcome, CommandsDoneEntry, CommandsDoneFile};
use crate::api::wire::{
    CommandAck, CommandEnvelope, CommandNack, CommandResult, CommandsPoll, CommandsResponse,
};
use crate::lcu::events::RoutedEvent;
use crate::lcu::mapper::is_placeholder_puuid;
use crate::lcu::types::{CreateLobbyBody, InviteTarget, Lobby, TeamId};
use crate::lcu::writes::{
    CustomLobbyMode, LobbyWriteKind, custom_lobby_id_for, describe_mutators, is_lobby_write_verified,
    summoners_rift_subcategory,
};
use crate::lcu::{LcuClient, LcuFailure};
use crate::log::Clock;

/// The poll while connected, until the server dials it.
pub const POLL_INTERVAL: Duration = Duration::from_millis(5_000);
/// The poll while the client is away (the answer is empty by contract).
pub const DISCONNECTED_POLL_INTERVAL: Duration = Duration::from_secs(60);
/// A custom side holds five.
pub const MAX_TEAM_SIZE: usize = 5;
/// The only phases a command runs in.
pub const ACTIONABLE_PHASES: [&str; 2] = ["None", "Lobby"];
/// `commands-done.json`.
pub const EXECUTED_FILE: &str = "commands-done.json";
/// Entries kept.
pub const MAX_EXECUTED: usize = 200;
/// Entries older than this are dropped.
pub const MAX_EXECUTED_AGE: Duration = Duration::from_secs(24 * 60 * 60);
const CUSTOM_GAME_QUEUES_PATH: &str = "/lol-game-queues/v1/custom";
const GAME_QUEUES_PATH: &str = "/lol-game-queues/v1/queues";
const CREATE_PATH: &str = "/lol-lobby/v2/lobby";
const INVITE_PATH: &str = "/lol-lobby/v2/lobby/invitations";

// --- the API seam -------------------------------------------------------------------------------------------

/// How an ack or nack went.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AnswerOutcome {
    /// 2xx.
    Ok,
    /// The API answered this status (409: already recorded; 404: unknown id).
    Http(u16),
    /// Anything else.
    Failed(String),
}

/// How a poll went.
#[derive(Debug, Clone, PartialEq)]
pub enum PollOutcome {
    /// The page.
    Ok(CommandsResponse),
    /// Why not, briefly.
    Failed(String),
}

/// The command routes. M17.6's API client implements it; tests use a fake.
pub trait CommandApi: Send + Sync + 'static {
    /// `GET /api/companion/commands?clientConnected=`.
    fn poll(&self, poll: CommandsPoll) -> impl Future<Output = PollOutcome> + Send;
    /// `POST /api/companion/commands/{id}/ack`.
    fn ack(&self, id: &str, body: &CommandAck) -> impl Future<Output = AnswerOutcome> + Send;
    /// `POST /api/companion/commands/{id}/nack`.
    fn nack(&self, id: &str, body: &CommandNack) -> impl Future<Output = AnswerOutcome> + Send;
}

fn answer_from<T>(result: crate::api::ApiResult<T>) -> AnswerOutcome {
    match result {
        Ok(_) => AnswerOutcome::Ok,
        Err(crate::api::ApiFailure::Http { status, .. }) => AnswerOutcome::Http(status),
        Err(other) => AnswerOutcome::Failed(format!("{other:?}")),
    }
}

impl CommandApi for crate::api::ApiClient {
    async fn poll(&self, poll: CommandsPoll) -> PollOutcome {
        match self.poll_commands(poll).await {
            Ok(ok) => PollOutcome::Ok(ok.data),
            Err(failure) => PollOutcome::Failed(format!("{failure:?}")),
        }
    }

    async fn ack(&self, id: &str, body: &CommandAck) -> AnswerOutcome {
        answer_from(crate::api::ApiClient::ack(self, id, body).await)
    }

    async fn nack(&self, id: &str, body: &CommandNack) -> AnswerOutcome {
        answer_from(crate::api::ApiClient::nack(self, id, body).await)
    }
}

// --- outcomes ---------------------------------------------------------------------------------------------------

/// What a command came to.
#[derive(Debug, Clone, PartialEq)]
pub enum Outcome {
    /// Done: the kind's result (acked).
    Done(Map<String, Value>),
    /// Failed: the nack text (`reason: detail`) and whether nothing ran (retryable).
    Failed {
        /// `reason` or `reason: detail`, at most 500 characters.
        error: String,
        /// True only when nothing was executed.
        retryable: bool,
    },
}

fn failed(reason: &str, detail: &str, retryable: bool) -> Outcome {
    let error = if detail.is_empty() {
        reason.to_owned()
    } else {
        format!("{reason}: {detail}")
    };
    Outcome::Failed {
        error: error.chars().take(500).collect(),
        retryable,
    }
}

fn done(value: Value) -> Outcome {
    match value {
        Value::Object(map) => Outcome::Done(map),
        _ => Outcome::Done(Map::new()),
    }
}

// --- execute-once record (`executed.ts`) -------------------------------------------------------------------------

/// `<stateDir>/commands-done.json`: the outcome of every command this PC finished, for 24 hours (at most
/// 200), so a lost ack is re-sent without running the command twice. Same file as the TS engine.
pub struct ExecutedStore {
    path: PathBuf,
    clock: Clock,
    entries: Option<Vec<CommandsDoneEntry>>,
}

impl ExecutedStore {
    /// The store for a state directory.
    pub fn new(state_dir: &Path, clock: Clock) -> Self {
        Self {
            path: state_dir.join(EXECUTED_FILE),
            clock,
            entries: None,
        }
    }

    fn load(&mut self) -> &mut Vec<CommandsDoneEntry> {
        if self.entries.is_none() {
            let entries = match std::fs::read_to_string(&self.path) {
                Err(_) => Vec::new(),
                Ok(text) => match serde_json::from_str::<CommandsDoneFile>(&text) {
                    Ok(file) if file.version == 1 => file.entries,
                    _ => {
                        tracing::warn!(component = "commands-done", path = %self.path.display(), "commands-done.json no longer parses; starting it over");
                        Vec::new()
                    }
                },
            };
            self.entries = Some(entries);
        }
        self.entries.get_or_insert_with(Vec::new)
    }

    /// The recorded outcome for a command id.
    pub fn get(&mut self, id: &str) -> Option<CommandsDoneEntry> {
        self.load().iter().find(|entry| entry.id == id).cloned()
    }

    /// Records an outcome and writes the file (tmp + rename, owner-only). False when the write failed: the
    /// caller still answers, because the client call already happened.
    pub fn record(&mut self, entry: CommandsDoneEntry) -> bool {
        let now = (self.clock)();
        let cutoff = now.checked_sub(MAX_EXECUTED_AGE).unwrap_or(UNIX_EPOCH);
        let id = entry.id.clone();
        let entries = self.load();
        entries.retain(|existing| existing.id != id);
        entries.push(entry);
        entries.retain(|existing| {
            existing.id == id || crate::log::parse_iso_timestamp(&existing.at).is_some_and(|at| at >= cutoff)
        });
        if entries.len() > MAX_EXECUTED {
            let excess = entries.len() - MAX_EXECUTED;
            entries.drain(..excess);
        }
        let file = CommandsDoneFile {
            version: 1,
            entries: entries.clone(),
        };
        let written = serde_json::to_string_pretty(&file)
            .map_err(std::io::Error::other)
            .and_then(|body| super::write_private_file(&self.path, &format!("{body}\n")));
        if let Err(error) = written {
            tracing::error!(component = "commands-done", error = %error.kind(), "could not write commands-done.json; a lost ack may run this command again");
            return false;
        }
        true
    }
}

// --- payloads (the kind's schema, `companionCommandPayloadSchemas`) ------------------------------------------

struct CreatePayload {
    lobby_name: String,
    lobby_password: String,
    /// `pickType` (M17.17): absent is draft, the only lobby a payload from before it could mean.
    mode: CustomLobbyMode,
}

struct InvitePayload {
    puuid: String,
    summoner_id: Option<String>,
}

fn type_name(value: Option<&Value>) -> &'static str {
    match value {
        None => "undefined",
        Some(Value::Null) => "null",
        Some(Value::Bool(_)) => "boolean",
        Some(Value::Number(_)) => "number",
        Some(Value::String(_)) => "string",
        Some(Value::Array(_)) => "array",
        Some(Value::Object(_)) => "object",
    }
}

fn expect_string(payload: &Map<String, Value>, key: &str, issues: &mut Vec<String>) -> Option<String> {
    match payload.get(key) {
        Some(Value::String(s)) => Some(s.clone()),
        other => {
            issues.push(format!(
                "{key}: Invalid input: expected string, received {}",
                type_name(other)
            ));
            None
        }
    }
}

fn parse_create(payload: &Map<String, Value>) -> Result<CreatePayload, Vec<String>> {
    let mut issues = Vec::new();
    let name = expect_string(payload, "lobbyName", &mut issues).map(|n| n.trim().to_owned());
    if let Some(name) = &name {
        let len = name.chars().count();
        if len < 1 {
            issues.push("lobbyName: Too small: expected string to have >=1 characters".into());
        } else if len > 30 {
            issues.push("lobbyName: Too big: expected string to have <=30 characters".into());
        }
    }
    let password = expect_string(payload, "lobbyPassword", &mut issues);
    if let Some(password) = &password {
        let len = password.chars().count();
        if len < 4 {
            issues.push("lobbyPassword: Too small: expected string to have >=4 characters".into());
        } else if len > 16 {
            issues.push("lobbyPassword: Too big: expected string to have <=16 characters".into());
        }
    }
    let mode = match payload.get("pickType") {
        None => CustomLobbyMode::Draft,
        Some(Value::String(pick)) if pick == "draft" => CustomLobbyMode::Draft,
        Some(Value::String(pick)) if pick == "blind" => CustomLobbyMode::Blind,
        Some(_) => {
            issues.push("pickType: Invalid option: expected one of \"draft\"|\"blind\"".into());
            CustomLobbyMode::Draft
        }
    };
    match (name, password) {
        (Some(lobby_name), Some(lobby_password)) if issues.is_empty() => Ok(CreatePayload {
            lobby_name,
            lobby_password,
            mode,
        }),
        _ => Err(issues),
    }
}

fn parse_invite(payload: &Map<String, Value>) -> Result<InvitePayload, Vec<String>> {
    let mut issues = Vec::new();
    let puuid = expect_string(payload, "puuid", &mut issues);
    if let Some(p) = &puuid {
        if is_placeholder_puuid(p) {
            issues.push(
                "puuid: puuid is a placeholder (empty or all-zero): a bot or an empty slot, never a player"
                    .into(),
            );
        }
    }
    let summoner_id = match payload.get("summonerId") {
        Some(Value::Null) => Some(None),
        Some(Value::String(s)) if !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()) => {
            Some(Some(s.clone()))
        }
        Some(Value::String(_)) => {
            issues.push("summonerId: Invalid string: must match pattern /^\\d+$/".into());
            None
        }
        other => {
            issues.push(format!(
                "summonerId: Invalid input: expected string, received {}",
                type_name(other)
            ));
            None
        }
    };
    match (puuid, summoner_id) {
        (Some(puuid), Some(summoner_id)) if issues.is_empty() => Ok(InvitePayload { puuid, summoner_id }),
        _ => Err(issues),
    }
}

fn parse_switch(payload: &Map<String, Value>) -> Result<TeamId, Vec<String>> {
    match payload.get("targetSide").and_then(Value::as_u64) {
        Some(100) => Ok(TeamId::Blue),
        Some(200) => Ok(TeamId::Red),
        _ => Err(vec!["targetSide: Invalid input".into()]),
    }
}

/// Whether a command was held longer than its own TTL since the poll that handed it out. Two local instants
/// against two server instants: a PC clock that is minutes off never fails anything.
pub fn is_stale(created_at: &str, expires_at: &str, received_at_ms: i64, now_ms: i64) -> bool {
    let ms = |text: &str| {
        crate::log::parse_iso_timestamp(text)
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
    };
    let (Some(created), Some(expires)) = (ms(created_at), ms(expires_at)) else {
        return false;
    };
    let ttl = expires - created;
    ttl > 0 && now_ms - received_at_ms > ttl
}

/// `Accepted` when the puuid is a member, `Pending` for an outstanding invitation, else `None`.
pub fn invite_state(lobby: &Lobby, puuid: &str) -> Option<&'static str> {
    if lobby.members.iter().any(|m| m.puuid == puuid) {
        return Some("Accepted");
    }
    let row = lobby.invitations.as_ref()?.iter().find(|i| i.to_puuid == puuid)?;
    Some(if row.state == "Accepted" {
        "Accepted"
    } else {
        "Pending"
    })
}

/// The side a puuid is on, by `customTeam100`/`customTeam200`.
pub fn side_of(lobby: &Lobby, puuid: &str) -> Option<TeamId> {
    if lobby.game_config.custom_team_100.iter().any(|m| m.puuid == puuid) {
        Some(TeamId::Blue)
    } else if lobby.game_config.custom_team_200.iter().any(|m| m.puuid == puuid) {
        Some(TeamId::Red)
    } else {
        None
    }
}

// --- executors -------------------------------------------------------------------------------------------------

enum LobbyRead {
    Lobby(Box<Lobby>),
    None,
    Failed(Outcome),
}

async fn read_lobby(client: &LcuClient) -> LobbyRead {
    match client.lobby().await {
        Ok(ok) => LobbyRead::Lobby(Box::new(ok.value)),
        Err(LcuFailure::Http { status: 404, .. }) => LobbyRead::None,
        Err(failure @ LcuFailure::Network { .. }) => {
            LobbyRead::Failed(failed("not_connected", &failure.describe(), true))
        }
        Err(failure) => LobbyRead::Failed(failed(
            "client_rejected",
            &format!("lobby answered {}", failure.describe()),
            false,
        )),
    }
}

fn outcome_error(outcome: &Outcome) -> String {
    match outcome {
        Outcome::Failed { error, .. } => error.clone(),
        Outcome::Done(_) => "done".into(),
    }
}

/// The word a refusal uses for the mode it could not find an entry for.
fn pick_name(mode: CustomLobbyMode) -> &'static str {
    match mode {
        CustomLobbyMode::Blind => "blind",
        CustomLobbyMode::Draft => "draft",
        CustomLobbyMode::TournamentDraft => "tournament draft",
        CustomLobbyMode::AllRandom => "all random",
    }
}

async fn create_lobby(
    context: &ConnectedContext,
    payload: CreatePayload,
    passwords: &Mutex<HashMap<String, String>>,
) -> Outcome {
    let client = &context.client;
    match read_lobby(client).await {
        LobbyRead::Failed(outcome) => return outcome,
        // Never dissolve a lobby somebody is standing in.
        LobbyRead::Lobby(lobby) => {
            return failed("already_in_lobby", &format!("partyId={}", lobby.party_id), false);
        }
        LobbyRead::None => {}
    }
    let dialog = match client.custom_game_queues().await {
        Ok(ok) => ok.value,
        Err(failure @ LcuFailure::Network { .. }) => {
            return failed("not_connected", &failure.describe(), true);
        }
        Err(failure) => {
            return failed(
                "client_rejected",
                &format!(
                    "{CUSTOM_GAME_QUEUES_PATH} answered {}; no lobby created",
                    failure.describe()
                ),
                false,
            );
        }
    };
    let queues = match client.game_queues().await {
        Ok(ok) => ok.value,
        Err(failure @ LcuFailure::Network { .. }) => {
            return failed("not_connected", &failure.describe(), true);
        }
        Err(failure) => {
            return failed(
                "client_rejected",
                &format!(
                    "{GAME_QUEUES_PATH} answered {}; no lobby created",
                    failure.describe()
                ),
                false,
            );
        }
    };
    let Some(entry) = custom_lobby_id_for(&dialog, payload.mode, &queues) else {
        let detail = match summoners_rift_subcategory(&dialog) {
            None => format!(
                "{CUSTOM_GAME_QUEUES_PATH} lists no Summoner's Rift classic subcategory; no lobby created"
            ),
            Some(rift) => format!(
                "{CUSTOM_GAME_QUEUES_PATH} lists no {} entry for Summoner's Rift (it has: {}); no lobby created",
                pick_name(payload.mode),
                describe_mutators(rift)
            ),
        };
        return failed("client_rejected", &detail, false);
    };
    tracing::debug!(component = "commands", lobby_name = %payload.lobby_name, mode = pick_name(payload.mode), entry, "creating a custom lobby");
    let body = CreateLobbyBody::summoners_rift(&payload.lobby_name, &payload.lobby_password, entry);
    let status = match client.create_lobby(&body).await {
        Ok(answer) => answer.status,
        Err(failure) => {
            return failed(
                "client_rejected",
                &format!("{CREATE_PATH} answered {}", failure.describe()),
                false,
            );
        }
    };
    // The lobby now exists whatever the read-back says: nothing from here on is retryable.
    let mut after = read_lobby(client).await;
    if let LobbyRead::Failed(outcome) = &after {
        tracing::warn!(component = "commands", error = %outcome_error(outcome), "lobby created but could not be read back; reading once more");
        after = read_lobby(client).await;
    }
    let lobby = match after {
        LobbyRead::Lobby(lobby) => lobby,
        LobbyRead::Failed(outcome) => {
            return failed(
                "client_rejected",
                &format!(
                    "create answered {status} but the lobby could not be read back ({})",
                    outcome_error(&outcome)
                ),
                false,
            );
        }
        LobbyRead::None => {
            return failed(
                "client_rejected",
                &format!("create answered {status} but no lobby followed"),
                false,
            );
        }
    };
    if !lobby.game_config.is_custom {
        return failed(
            "client_rejected",
            &format!("create answered {status} but the lobby is not custom"),
            false,
        );
    }
    if let Ok(mut map) = passwords.lock() {
        map.insert(lobby.party_id.clone(), payload.lobby_password.clone());
    }
    let lobby_name = lobby
        .game_config
        .custom_lobby_name
        .clone()
        .filter(|n| !n.is_empty())
        .unwrap_or(payload.lobby_name);
    tracing::info!(component = "commands", party_id = %lobby.party_id, %lobby_name, "custom lobby created");
    done(json!({ "partyId": lobby.party_id, "lobbyName": lobby_name }))
}

async fn invite(context: &ConnectedContext, payload: InvitePayload) -> Outcome {
    let client = &context.client;
    let lobby = match read_lobby(client).await {
        LobbyRead::Failed(outcome) => return outcome,
        LobbyRead::None => return failed("no_lobby", "", false),
        LobbyRead::Lobby(lobby) => lobby,
    };
    if !lobby.game_config.is_custom {
        return failed(
            "not_custom_lobby",
            &format!("queueId={}", lobby.game_config.queue_id),
            false,
        );
    }
    let method = if payload.summoner_id.is_some() {
        "summonerId"
    } else {
        "puuid"
    };
    if let Some(state) = invite_state(&lobby, &payload.puuid) {
        tracing::info!(component = "commands", puuid = %payload.puuid, state, "invite already in place; no client call");
        return done(json!({ "puuid": payload.puuid, "method": method, "state": state }));
    }
    if !lobby.local_member.is_leader && lobby.local_member.allowed_invite_others == Some(false) {
        return failed(
            "client_rejected",
            "the local player may not invite (not the leader)",
            false,
        );
    }
    // `inviteWithFallback`: by summoner id first (what the client's UI sends), by puuid on a 4xx.
    let summoner_id = payload
        .summoner_id
        .as_deref()
        .and_then(|s| s.parse::<i64>().ok())
        .filter(|n| *n <= 9_007_199_254_740_991);
    let mut attempts: Vec<(&str, Result<u16, LcuFailure>)> = Vec::new();
    let mut used = "puuid";
    let mut fall_back = true;
    if let Some(id) = summoner_id {
        let first = client
            .invite(&InviteTarget::SummonerId { to_summoner_id: id })
            .await
            .map(|a| a.status);
        let rejected = matches!(&first, Err(LcuFailure::Http { status, .. }) if *status < 500);
        attempts.push(("toSummonerId", first));
        if !rejected {
            used = "summonerId";
            fall_back = false;
        }
    }
    if fall_back {
        let second = client
            .invite(&InviteTarget::Puuid {
                to_puuid: payload.puuid.clone(),
            })
            .await
            .map(|a| a.status);
        attempts.push(("toPuuid", second));
    }
    if !matches!(attempts.last(), Some((_, Ok(_)))) {
        let answers: Vec<String> = attempts
            .iter()
            .map(|(key, result)| {
                let answer = match result {
                    Ok(status) => status.to_string(),
                    Err(failure) => failure.describe(),
                };
                format!("{INVITE_PATH} by {key} answered {answer}")
            })
            .collect();
        return failed("client_rejected", &answers.join("; "), false);
    }
    let state = match read_lobby(client).await {
        LobbyRead::Lobby(after) => invite_state(&after, &payload.puuid),
        _ => None,
    };
    if state.is_none() {
        tracing::warn!(component = "commands", puuid = %payload.puuid, method = used, "invite accepted by the client but no invitation row followed; reporting Pending");
    }
    tracing::info!(component = "commands", puuid = %payload.puuid, method = used, "invite sent");
    done(json!({ "puuid": payload.puuid, "method": used, "state": state.unwrap_or("Pending") }))
}

async fn switch_side(context: &ConnectedContext, target: TeamId) -> Outcome {
    let client = &context.client;
    let lobby = match read_lobby(client).await {
        LobbyRead::Failed(outcome) => return outcome,
        LobbyRead::None => return failed("no_lobby", "", false),
        LobbyRead::Lobby(lobby) => lobby,
    };
    if !lobby.game_config.is_custom {
        return failed(
            "not_custom_lobby",
            &format!("queueId={}", lobby.game_config.queue_id),
            false,
        );
    }
    let puuid = context
        .summoner
        .as_ref()
        .map(|s| s.puuid.clone())
        .unwrap_or_else(|| lobby.local_member.puuid.clone());
    let Some(side) = side_of(&lobby, &puuid) else {
        let why = if lobby.local_member.is_spectator {
            "spectator"
        } else {
            "on neither side"
        };
        return failed("not_on_a_team", why, false);
    };
    if side == target {
        tracing::info!(
            component = "commands",
            side = side.as_u16(),
            "already on the target side; no client call"
        );
        return done(json!({ "side": side.as_u16() }));
    }
    let team = match target {
        TeamId::Blue => &lobby.game_config.custom_team_100,
        TeamId::Red => &lobby.game_config.custom_team_200,
    };
    if team.len() >= MAX_TEAM_SIZE {
        return failed(
            "side_full",
            &format!("side {} holds {}", target.as_u16(), team.len()),
            false,
        );
    }
    let path = crate::lcu::endpoints::switch_side_path(target);
    let status = match client.switch_side(target).await {
        Ok(answer) => answer.status,
        Err(failure) => {
            return failed(
                "client_rejected",
                &format!("{path} answered {}", failure.describe()),
                false,
            );
        }
    };
    let after = match read_lobby(client).await {
        LobbyRead::Lobby(after) => side_of(&after, &puuid),
        _ => None,
    };
    if after != Some(target) {
        let where_ = match after {
            None => "on no side".to_owned(),
            Some(side) => format!("still on {}", side.as_u16()),
        };
        return failed(
            "client_rejected",
            &format!("{path} answered {status} but the local player is {where_}"),
            false,
        );
    }
    tracing::info!(
        component = "commands",
        from = side.as_u16(),
        to = target.as_u16(),
        "switched side"
    );
    done(json!({ "side": target.as_u16() }))
}

// --- the actor ----------------------------------------------------------------------------------------------------

/// Settings.
#[derive(Clone)]
pub struct CommandRunnerOptions {
    /// This group's state directory (for `commands-done.json`).
    pub state_dir: PathBuf,
    /// The clock.
    pub clock: Clock,
    /// Timers (the poll).
    pub scheduler: Arc<dyn Scheduler>,
    /// The connected poll interval until the server dials it.
    pub poll_interval: Duration,
    /// The disconnected poll interval.
    pub disconnected_poll_interval: Duration,
    /// Tests only: per-kind override of the verification gate.
    pub gate: HashMap<LobbyWriteKind, bool>,
}

impl CommandRunnerOptions {
    /// Production settings for a state directory.
    pub fn new(state_dir: PathBuf) -> Self {
        Self {
            state_dir,
            clock: crate::log::system_clock(),
            scheduler: Arc::new(TokioScheduler),
            poll_interval: POLL_INTERVAL,
            disconnected_poll_interval: DISCONNECTED_POLL_INTERVAL,
            gate: HashMap::new(),
        }
    }
}

/// What the runner shows (tests).
#[derive(Debug, Clone, Default)]
pub struct CommandRunnerView {
    /// No poll running.
    pub idle: bool,
    /// Polls made.
    pub polls: u64,
    /// Machine events handled.
    pub processed: u64,
    /// The delay the next poll was scheduled with.
    pub next_poll: Option<Duration>,
    /// Stopped.
    pub exited: bool,
}

enum Msg {
    Machine(MachineEvent),
    PollNow,
    PollDone,
}

/// The running runner. Dropping it stops it.
pub struct CommandRunnerHandle {
    tx: mpsc::Sender<Msg>,
    machine: mpsc::Sender<MachineEvent>,
    stop: watch::Sender<bool>,
    sent: Arc<std::sync::atomic::AtomicU64>,
    view: watch::Receiver<CommandRunnerView>,
    passwords: Arc<Mutex<HashMap<String, String>>>,
}

impl CommandRunnerHandle {
    /// The feed the connection machine delivers into.
    pub fn feed(&self) -> WatcherFeed {
        WatcherFeed::counted(self.machine.clone(), self.sent.clone())
    }

    /// Hands a machine event over without waiting (tests).
    pub fn send(&self, event: MachineEvent) {
        self.sent.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        if self.machine.try_send(event).is_err() {
            self.sent.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
        }
    }

    /// One poll now (tests; production polls on its timer).
    pub fn poll_now(&self) {
        let _ = self.tx.try_send(Msg::PollNow);
    }

    /// The password this process set for a party, for the lobby post (M4.2).
    pub fn password_for(&self) -> super::lobby::PasswordFor {
        let passwords = self.passwords.clone();
        Arc::new(move |party: &str| passwords.lock().ok().and_then(|map| map.get(party).cloned()))
    }

    /// The view.
    pub fn view(&self) -> watch::Receiver<CommandRunnerView> {
        self.view.clone()
    }

    /// Waits until every input is handled and no poll runs.
    pub async fn settled(&self, timeout: Duration) -> bool {
        let mut view = self.view.clone();
        let sent = self.sent.clone();
        tokio::time::timeout(timeout, async move {
            loop {
                {
                    let v = view.borrow_and_update();
                    if v.idle && v.processed >= sent.load(std::sync::atomic::Ordering::SeqCst) {
                        return true;
                    }
                }
                tokio::select! {
                    changed = view.changed() => if changed.is_err() { return false },
                    _ = tokio::time::sleep(Duration::from_millis(5)) => {}
                }
            }
        })
        .await
        .unwrap_or(false)
    }

    /// Stops it.
    pub fn stop(&self) {
        let _ = self.stop.send(true);
    }

    /// Waits until stopped.
    pub async fn stopped(&self) {
        let mut view = self.view.clone();
        let _ = view.wait_for(|v| v.exited).await.map(|_| ());
    }
}

impl Drop for CommandRunnerHandle {
    fn drop(&mut self) {
        let _ = self.stop.send(true);
    }
}

/// Starts the runner: it polls at once (with `clientConnected=false` until the machine connects, as
/// `host.ts` starts it before League is found).
pub fn spawn_command_runner<A: CommandApi>(
    api: Arc<A>,
    options: CommandRunnerOptions,
) -> CommandRunnerHandle {
    let (tx, rx) = mpsc::channel(64);
    let (machine_tx, mut machine_rx) = mpsc::channel::<MachineEvent>(WATCHER_QUEUE);
    let (stop_tx, stop_rx) = watch::channel(false);
    let (view_tx, view_rx) = watch::channel(CommandRunnerView {
        idle: true,
        ..Default::default()
    });
    let passwords = Arc::new(Mutex::new(HashMap::new()));
    let forward = tx.clone();
    let mut forward_stop = stop_rx.clone();
    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = super::connection::until_stopped(&mut forward_stop) => return,
                event = machine_rx.recv() => match event {
                    Some(event) => if forward.send(Msg::Machine(event)).await.is_err() { return },
                    None => return,
                },
            }
        }
    });
    let shared = Shared {
        api,
        executed: Mutex::new(ExecutedStore::new(&options.state_dir, options.clock.clone())),
        passwords: passwords.clone(),
        context: Mutex::new(None),
        phase: Mutex::new(None),
        options,
        last_failure: Mutex::new(None),
        next_poll: Mutex::new(POLL_INTERVAL),
    };
    let actor = Actor {
        shared: Arc::new(shared),
        tx: tx.clone(),
        view: view_tx,
        processed: 0,
        polls: 0,
        polling: false,
        poll_again: false,
        timer: None,
        tasks: JoinSet::new(),
    };
    let _ = tx.try_send(Msg::PollNow);
    tokio::spawn(actor.run(rx, stop_rx));
    CommandRunnerHandle {
        tx,
        machine: machine_tx,
        stop: stop_tx,
        sent: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        view: view_rx,
        passwords,
    }
}

struct Shared<A> {
    api: Arc<A>,
    executed: Mutex<ExecutedStore>,
    passwords: Arc<Mutex<HashMap<String, String>>>,
    context: Mutex<Option<Arc<ConnectedContext>>>,
    phase: Mutex<Option<String>>,
    options: CommandRunnerOptions,
    last_failure: Mutex<Option<String>>,
    next_poll: Mutex<Duration>,
}

struct Actor<A> {
    shared: Arc<Shared<A>>,
    tx: mpsc::Sender<Msg>,
    view: watch::Sender<CommandRunnerView>,
    processed: u64,
    polls: u64,
    polling: bool,
    poll_again: bool,
    timer: Option<Cancel>,
    tasks: JoinSet<()>,
}

impl<A: CommandApi> Actor<A> {
    async fn run(mut self, mut rx: mpsc::Receiver<Msg>, mut stop: watch::Receiver<bool>) {
        loop {
            tokio::select! {
                biased;
                _ = super::connection::until_stopped(&mut stop) => break,
                message = rx.recv() => match message {
                    None => break,
                    Some(Msg::Machine(event)) => {
                        self.on_machine(event);
                        self.processed += 1;
                    }
                    Some(Msg::PollNow) => self.poll_now(),
                    Some(Msg::PollDone) => {
                        self.polling = false;
                        if std::mem::take(&mut self.poll_again) {
                            self.poll_now();
                        } else {
                            self.schedule_next();
                        }
                    }
                },
            }
            while self.tasks.try_join_next().is_some() {}
            self.view.send_modify(|v| {
                v.idle = !self.polling && !self.poll_again;
                v.processed = self.processed;
                v.polls = self.polls;
            });
        }
        if let Some(cancel) = self.timer.take() {
            cancel();
        }
        self.tasks.shutdown().await;
        self.view.send_modify(|v| {
            v.idle = true;
            v.exited = true;
        });
    }

    fn on_machine(&mut self, event: MachineEvent) {
        match event {
            MachineEvent::Connected(context) => {
                if let Ok(mut phase) = self.shared.phase.lock() {
                    *phase = context.phase.clone();
                }
                if let Ok(mut slot) = self.shared.context.lock() {
                    *slot = Some(context);
                }
                // A command queued while the client was away should not wait a whole disconnected interval.
                self.poll_now();
            }
            MachineEvent::Disconnected(_) => {
                if let Ok(mut slot) = self.shared.context.lock() {
                    *slot = None;
                }
                if let Ok(mut phase) = self.shared.phase.lock() {
                    *phase = None;
                }
            }
            MachineEvent::Event(routed) => {
                if let RoutedEvent::GameflowPhase(phase) = routed.as_ref() {
                    if let Ok(mut slot) = self.shared.phase.lock() {
                        *slot = Some(phase.clone());
                    }
                }
            }
        }
    }

    fn poll_now(&mut self) {
        if self.polling {
            self.poll_again = true;
            return;
        }
        if let Some(cancel) = self.timer.take() {
            cancel();
        }
        self.polling = true;
        self.polls += 1;
        let shared = self.shared.clone();
        let tx = self.tx.clone();
        self.tasks.spawn(async move {
            shared.poll().await;
            let _ = tx.send(Msg::PollDone).await;
        });
    }

    fn schedule_next(&mut self) {
        let connected = self.shared.context.lock().map(|c| c.is_some()).unwrap_or(false);
        let delay = if connected {
            self.shared.next_poll.lock().map(|d| *d).unwrap_or(POLL_INTERVAL)
        } else {
            self.shared.options.disconnected_poll_interval
        };
        let tx = self.tx.clone();
        self.timer = Some(self.shared.options.scheduler.schedule(
            delay,
            Box::new(move || {
                let _ = tx.try_send(Msg::PollNow);
            }),
        ));
        self.view.send_modify(|v| v.next_poll = Some(delay));
    }
}

fn now_ms(clock: &Clock) -> i64 {
    clock()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

impl<A: CommandApi> Shared<A> {
    fn context(&self) -> Option<Arc<ConnectedContext>> {
        self.context.lock().ok().and_then(|c| c.clone())
    }

    async fn poll(&self) {
        let connected = self.context().is_some();
        match self
            .api
            .poll(CommandsPoll {
                client_connected: connected,
            })
            .await
        {
            PollOutcome::Failed(reason) => {
                let repeat = self
                    .last_failure
                    .lock()
                    .map(|l| l.as_deref() == Some(reason.as_str()))
                    .unwrap_or(false);
                if repeat {
                    tracing::debug!(component = "commands", %reason, "command poll still failing");
                } else {
                    tracing::warn!(component = "commands", %reason, "command poll failed; trying again on the next interval");
                    if let Ok(mut last) = self.last_failure.lock() {
                        *last = Some(reason);
                    }
                }
            }
            PollOutcome::Ok(page) => {
                let was_failing = self
                    .last_failure
                    .lock()
                    .map(|mut l| l.take().is_some())
                    .unwrap_or(false);
                if was_failing {
                    tracing::info!(component = "commands", "command poll is answering again");
                }
                if let Ok(mut next) = self.next_poll.lock() {
                    *next = page
                        .next_poll_in_ms
                        .map(Duration::from_millis)
                        .unwrap_or(self.options.poll_interval);
                }
                let received_at = now_ms(&self.options.clock);
                for command in page.commands {
                    self.handle(command, received_at).await;
                }
            }
        }
    }

    async fn handle(&self, command: CommandEnvelope, received_at: i64) {
        let recorded = self
            .executed
            .lock()
            .ok()
            .and_then(|mut store| store.get(&command.id));
        if let Some(entry) = recorded {
            tracing::info!(component = "commands", command_id = %command.id, kind = %command.kind, "command already executed here; re-sending its outcome without a client call");
            let outcome = match entry.outcome {
                RecordedOutcome::Done => Outcome::Done(entry.result.unwrap_or_default()),
                RecordedOutcome::Failed => Outcome::Failed {
                    error: entry.error.unwrap_or_else(|| "failed".into()),
                    retryable: false,
                },
            };
            self.send(&command, outcome).await;
            return;
        }
        let outcome = self.execute(&command, received_at).await;
        if let Outcome::Failed {
            error,
            retryable: true,
        } = &outcome
        {
            // Nothing ran: no record, so a later delivery runs for real.
            tracing::info!(component = "commands", command_id = %command.id, %error, "command not run");
            self.send(&command, outcome).await;
            return;
        }
        let entry = CommandsDoneEntry {
            id: command.id.clone(),
            kind: command.kind.clone(),
            at: crate::log::iso_timestamp((self.options.clock)()),
            outcome: if matches!(outcome, Outcome::Done(_)) {
                RecordedOutcome::Done
            } else {
                RecordedOutcome::Failed
            },
            result: match &outcome {
                Outcome::Done(result) => Some(result.clone()),
                Outcome::Failed { .. } => None,
            },
            error: match &outcome {
                Outcome::Failed { error, .. } => Some(error.clone()),
                Outcome::Done(_) => None,
            },
        };
        if let Ok(mut store) = self.executed.lock() {
            store.record(entry);
        }
        match &outcome {
            Outcome::Done(result) => {
                tracing::info!(component = "commands", command_id = %command.id, ?result, "command done")
            }
            Outcome::Failed { error, .. } => {
                tracing::info!(component = "commands", command_id = %command.id, %error, "command failed")
            }
        }
        self.send(&command, outcome).await;
    }

    async fn execute(&self, command: &CommandEnvelope, received_at: i64) -> Outcome {
        if is_stale(
            &command.created_at,
            &command.expires_at,
            received_at,
            now_ms(&self.options.clock),
        ) {
            return failed(
                "expired",
                &format!(
                    "held for longer than its TTL after the poll (expiresAt={})",
                    command.expires_at
                ),
                false,
            );
        }
        let Some(kind) = LobbyWriteKind::parse(&command.kind) else {
            return failed(
                "malformed_payload",
                &format!("unknown kind \"{}\"", command.kind),
                false,
            );
        };
        enum Parsed {
            Create(CreatePayload),
            Invite(InvitePayload),
            Switch(TeamId),
        }
        let parsed = match kind {
            LobbyWriteKind::CreateLobby => parse_create(&command.payload).map(Parsed::Create),
            LobbyWriteKind::Invite => parse_invite(&command.payload).map(Parsed::Invite),
            LobbyWriteKind::SwitchSide => parse_switch(&command.payload).map(Parsed::Switch),
        };
        let parsed = match parsed {
            Ok(parsed) => parsed,
            Err(issues) => {
                return failed(
                    "malformed_payload",
                    &issues.into_iter().take(3).collect::<Vec<_>>().join("; "),
                    false,
                );
            }
        };
        let enabled = self
            .options
            .gate
            .get(&kind)
            .copied()
            .unwrap_or_else(|| is_lobby_write_verified(kind));
        if !enabled {
            tracing::warn!(
                component = "commands",
                verify = kind.reference_row(),
                "command refused: its client endpoint is not verified on this patch"
            );
            return failed(
                "endpoint_unverified",
                &format!("{} is not verified on this patch", kind.reference_row()),
                false,
            );
        }
        let Some(context) = self.context() else {
            return failed(
                "not_connected",
                "the League client went away before the command ran",
                true,
            );
        };
        let known_phase = self.phase.lock().ok().and_then(|p| p.clone());
        let phase = match known_phase {
            Some(phase) => phase,
            None => match context.client.gameflow_phase().await {
                Ok(ok) => {
                    if let Ok(mut slot) = self.phase.lock() {
                        *slot = Some(ok.value.clone());
                    }
                    ok.value
                }
                Err(failure @ LcuFailure::Network { .. }) => {
                    return failed("not_connected", &failure.describe(), true);
                }
                Err(failure) => {
                    return failed(
                        "client_rejected",
                        &format!("gameflow-phase answered {}", failure.describe()),
                        false,
                    );
                }
            },
        };
        if !ACTIONABLE_PHASES.contains(&phase.as_str()) {
            return failed("wrong_phase", &phase, false);
        }
        match parsed {
            Parsed::Create(payload) => create_lobby(&context, payload, &self.passwords).await,
            Parsed::Invite(payload) => invite(&context, payload).await,
            Parsed::Switch(target) => switch_side(&context, target).await,
        }
    }

    async fn send(&self, command: &CommandEnvelope, outcome: Outcome) {
        let result = match outcome {
            Outcome::Done(result) => {
                let parsed: Option<CommandResult> =
                    serde_json::from_value(Value::Object(result.clone())).ok();
                match parsed {
                    Some(result) => self.api.ack(&command.id, &CommandAck { result }).await,
                    None => {
                        tracing::error!(component = "commands", command_id = %command.id, "a done result does not fit its kind's shape; not acked");
                        return;
                    }
                }
            }
            Outcome::Failed { error, retryable } => {
                self.api
                    .nack(&command.id, &CommandNack { error, retryable })
                    .await
            }
        };
        match result {
            AnswerOutcome::Ok => {
                tracing::debug!(component = "commands", command_id = %command.id, "command answered")
            }
            AnswerOutcome::Http(409) => {
                tracing::debug!(component = "commands", command_id = %command.id, "the server already had this outcome")
            }
            AnswerOutcome::Http(404) => {
                tracing::warn!(component = "commands", command_id = %command.id, "the server does not know this command; nothing more to do")
            }
            other => {
                tracing::warn!(component = "commands", command_id = %command.id, outcome = ?other, "ack failed; it is re-sent from the local record on the next poll")
            }
        }
    }
}
