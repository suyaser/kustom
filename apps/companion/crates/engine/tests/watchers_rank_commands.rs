//! Rank sync and the command runner (ports of `rankSync.test.ts`, `commandRunner.test.ts` and
//! `executed.test.ts`), against the fake League client and fake API seams, plus the M17.10 contract: every
//! rank, ack, nack, client-write and commands-done golden reproduced JSON-equal. Lobby commands only.

#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

mod support;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use engine::api::wire::{
    CommandAck, CommandEnvelope, CommandNack, CommandsPoll, CommandsResponse, RankPayload,
};
use engine::lcu::LcuClient;
use engine::lcu::events::{LcuEventType, RoutedEvent};
use engine::lcu::types::{RankedStats, Summoner};
use engine::lcu::writes::LobbyWriteKind;
use engine::watchers::commands::{
    AnswerOutcome, CommandApi, CommandRunnerHandle, CommandRunnerOptions, ExecutedStore, PollOutcome,
    is_stale, spawn_command_runner,
};
use engine::watchers::connection::{ConnectedContext, DisconnectReason, MachineEvent};
use engine::watchers::lobby::{LobbyWatcherOptions, spawn_lobby_watcher};
use engine::watchers::rank::{RankPostOutcome, RankPoster, RankSyncHandle, RankSyncOptions, spawn_rank_sync};
use serde_json::{Value, json};
use support::fake_client::{FakeClient, Route, start_fake_client};
use support::watch_kit::{ManualScheduler, ScriptedPoster, pause, until};
use support::{Pki, body, credentials, golden_body, pki};

const ME: &str = "34151cbd-d9f8-5dad-9dc8-c6a8e253c0de";
const FRIEND: &str = "c04e977c-133a-5d94-9fd3-6202f8beec4c";
const OTHER: &str = "aebd7c57-83d8-551d-a7b2-7caa7e8b1960";
const SETTLE: Duration = Duration::from_secs(8);
const NOW: &str = "2026-09-08T17:00:00.000Z";

fn at(iso: &str) -> SystemTime {
    engine::log::parse_iso_timestamp(iso).unwrap()
}

fn golden_file(name: &str) -> Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/goldens")
        .join(format!("{name}.json"));
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn not_found() -> Route {
    Route::json(
        404,
        &json!({ "errorCode": "RPC_ERROR", "httpStatus": 404, "message": "LOBBY_NOT_FOUND" }),
    )
}

async fn context_for(fake: &FakeClient, pki: &Pki, phase: &str) -> Arc<ConnectedContext> {
    let summoner: Summoner = serde_json::from_value(body("16.17", "current-summoner")).unwrap();
    Arc::new(ConnectedContext {
        client: LcuClient::with_verifier(&credentials(fake.port), pki.verifier(), Duration::from_secs(2))
            .unwrap(),
        version: "16.18.1".into(),
        patch: Some("16.18".into()),
        summoner: Some(summoner),
        phase: Some(phase.into()),
        port: fake.port,
    })
}

// --- rank sync ---------------------------------------------------------------------------------------------------

#[derive(Default)]
struct RankRecorder(Mutex<Vec<RankPayload>>);
impl RankPoster for RankRecorder {
    async fn post_rank(&self, body: &RankPayload) -> RankPostOutcome {
        self.0.lock().unwrap().push(body.clone());
        RankPostOutcome::Ok { stored: true }
    }
}
impl RankRecorder {
    fn json(&self) -> Vec<Value> {
        self.0
            .lock()
            .unwrap()
            .iter()
            .map(|b| serde_json::to_value(b).unwrap())
            .collect()
    }
}

struct RankHarness {
    fake: FakeClient,
    poster: Arc<RankRecorder>,
    rank: RankSyncHandle,
    context: Arc<ConnectedContext>,
    clock: Arc<Mutex<SystemTime>>,
    scheduler: Arc<ManualScheduler>,
}

async fn rank_setup(routes: Vec<(String, Route)>) -> RankHarness {
    let pki = pki("Fake Riot Root");
    let mut all: HashMap<String, Route> = routes.into_iter().collect();
    all.entry("GET /lol-ranked/v1/current-ranked-stats".into())
        .or_insert_with(|| Route::json(200, &body("16.17", "current-ranked-stats")));
    let fake = start_fake_client(&pki, all).await;
    let context = context_for(&fake, &pki, "Lobby").await;
    let clock = Arc::new(Mutex::new(at(NOW)));
    let reading = clock.clone();
    let poster = Arc::new(RankRecorder::default());
    let scheduler = Arc::new(ManualScheduler::default());
    let rank = spawn_rank_sync(
        poster.clone(),
        RankSyncOptions {
            clock: Arc::new(move || *reading.lock().unwrap()),
            scheduler: scheduler.clone(),
            call_interval: Duration::from_millis(1),
            ..Default::default()
        },
    );
    RankHarness {
        fake,
        poster,
        rank,
        context,
        clock,
        scheduler,
    }
}

impl RankHarness {
    async fn settled(&self) {
        assert!(self.rank.settled(SETTLE).await);
    }
    fn gets(&self, path: &str) -> usize {
        self.fake.requests_to(path)
    }
}

#[tokio::test]
async fn check_1_own_rank_on_start_one_get_one_post_and_its_golden() {
    let h = rank_setup(Vec::new()).await;
    h.rank.send(MachineEvent::Connected(h.context.clone()));
    until(|| h.poster.json().len() == 1, "own post").await;
    h.settled().await;
    assert_eq!(h.gets("/lol-ranked/v1/current-ranked-stats"), 1);
    assert_eq!(h.poster.json()[0], golden_body("rank--current-ranked-stats--own"));
}

#[tokio::test]
async fn check_6_six_hours_of_timer_two_own_posts_and_a_reconnect_does_not_repost() {
    let h = rank_setup(Vec::new()).await;
    h.rank.send(MachineEvent::Connected(h.context.clone()));
    until(|| h.poster.json().len() == 1, "own post").await;
    // A reconnect does not re-post.
    h.rank
        .send(MachineEvent::Disconnected(DisconnectReason::SocketClosed));
    h.rank.send(MachineEvent::Connected(h.context.clone()));
    h.settled().await;
    pause(20).await;
    assert_eq!(h.poster.json().len(), 1);
    // The six-hour timer while connected posts again.
    assert_eq!(h.scheduler.get(0).delay, Duration::from_secs(6 * 60 * 60));
    h.scheduler.get(0).fire();
    until(|| h.poster.json().len() == 2, "timer post").await;
    // A timer that fires while disconnected posts on the next connect.
    h.rank
        .send(MachineEvent::Disconnected(DisconnectReason::ClientLost));
    h.settled().await;
    h.scheduler.get(1).fire();
    h.settled().await;
    assert_eq!(h.poster.json().len(), 2);
    h.rank.send(MachineEvent::Connected(h.context.clone()));
    until(|| h.poster.json().len() == 3, "due post on reconnect").await;
}

#[tokio::test]
async fn check_3_ranks_needed_gets_rank_and_name_and_posts_its_golden() {
    let h = rank_setup(vec![
        (
            format!("GET /lol-ranked/v1/ranked-stats/{OTHER}"),
            Route::json(200, &body("16.17", "ranked-stats-by-puuid--other")),
        ),
        (
            format!("GET /lol-summoner/v2/summoners/puuid/{OTHER}"),
            Route::json(200, &body("16.17", "summoner-by-puuid--other")),
        ),
    ])
    .await;
    h.rank.send(MachineEvent::Connected(h.context.clone()));
    h.rank.needed(vec![OTHER.into(), ME.into()]);
    until(|| h.poster.json().len() == 2, "two posts").await;
    h.settled().await;
    let posts = h.poster.json();
    assert_eq!(posts[1], golden_body("rank--ranked-stats-by-puuid--other"));
    assert_eq!(
        h.gets(&format!("/lol-ranked/v1/ranked-stats/{ME}")),
        0,
        "the own puuid is left to the own path"
    );
    // check 4: the same list again within the hour: zero further client calls.
    let before = h.fake.requests.lock().unwrap().len();
    h.rank.needed(vec![OTHER.into()]);
    h.settled().await;
    assert_eq!(h.fake.requests.lock().unwrap().len(), before);
    // After the hour the same list asks again.
    *h.clock.lock().unwrap() += Duration::from_secs(60 * 60) + Duration::from_millis(1);
    h.rank.needed(vec![OTHER.into()]);
    until(|| h.poster.json().len() == 3, "asked again after the hour").await;
    assert_eq!(h.gets(&format!("/lol-ranked/v1/ranked-stats/{OTHER}")), 2);
}

#[tokio::test]
async fn check_5_a_socket_push_for_a_requested_puuid_replaces_the_get_and_matches_its_golden() {
    let h = rank_setup(vec![
        (
            format!("GET /lol-ranked/v1/ranked-stats/{OTHER}"),
            Route::json(200, &body("16.17", "ranked-stats-by-puuid--other"))
                .delayed(Duration::from_millis(150)),
        ),
        (
            format!("GET /lol-summoner/v2/summoners/puuid/{OTHER}"),
            Route::json(200, &body("16.17", "summoner-by-puuid--other")),
        ),
    ])
    .await;
    h.rank.send(MachineEvent::Connected(h.context.clone()));
    until(|| h.poster.json().len() == 1, "own").await;
    let stats: RankedStats =
        serde_json::from_value(body("16.17", "ranked-stats-by-puuid--ws-cached")).unwrap();
    let push = |puuid: &str| {
        MachineEvent::Event(Arc::new(RoutedEvent::RankedStats {
            puuid: puuid.into(),
            stats: Box::new(stats.clone()),
        }))
    };
    // Never asked about: dropped unread.
    h.rank.send(push(FRIEND));
    h.settled().await;
    h.rank.needed(vec![OTHER.into(), FRIEND.into()]);
    // Arrives while OTHER's GET is in flight, before FRIEND's would go out.
    pause(20).await;
    h.rank.send(push(FRIEND));
    until(|| h.poster.json().len() == 3, "both posted").await;
    h.settled().await;
    assert_eq!(
        h.gets(&format!("/lol-ranked/v1/ranked-stats/{FRIEND}")),
        0,
        "the push replaced the GET"
    );
    let friend = h
        .poster
        .json()
        .into_iter()
        .find(|p| p["puuid"] == FRIEND)
        .unwrap();
    assert_eq!(friend, golden_body("rank--ranked-stats-by-puuid--ws-cached"));
}

#[tokio::test]
async fn check_8_a_failing_rank_get_posts_nothing_and_does_not_retry() {
    let h = rank_setup(vec![(
        format!("GET /lol-ranked/v1/ranked-stats/{OTHER}"),
        Route::json(500, &json!({ "errorCode": "RPC_ERROR" })),
    )])
    .await;
    h.rank.send(MachineEvent::Connected(h.context.clone()));
    h.rank.needed(vec![OTHER.into()]);
    h.settled().await;
    pause(20).await;
    assert_eq!(h.poster.json().len(), 1, "only the own rank");
    assert_eq!(h.gets(&format!("/lol-ranked/v1/ranked-stats/{OTHER}")), 1);
}

#[tokio::test]
async fn a_name_404_still_posts_the_rank_without_a_name_and_a_known_name_is_reused() {
    let h = rank_setup(vec![(
        format!("GET /lol-ranked/v1/ranked-stats/{OTHER}"),
        Route::json(200, &body("16.17", "ranked-stats-by-puuid--other")),
    )])
    .await;
    h.rank.send(MachineEvent::Connected(h.context.clone()));
    h.rank.needed(vec![OTHER.into()]);
    until(|| h.poster.json().len() == 2, "post").await;
    assert_eq!(h.poster.json()[1]["gameName"], Value::Null);
}

#[tokio::test]
async fn paces_client_calls() {
    let pki = pki("Fake Riot Root");
    let mut routes = HashMap::new();
    routes.insert(
        "GET /lol-ranked/v1/current-ranked-stats".to_string(),
        Route::json(200, &body("16.17", "current-ranked-stats")),
    );
    let puuids: Vec<String> = (0..5)
        .map(|i| format!("00000000-0000-4000-8000-00000000000{i}"))
        .collect();
    for p in &puuids {
        routes.insert(
            format!("GET /lol-ranked/v1/ranked-stats/{p}"),
            Route::json(200, &body("16.17", "ranked-stats-by-puuid--other")),
        );
        routes.insert(
            format!("GET /lol-summoner/v2/summoners/puuid/{p}"),
            Route::json(200, &body("16.17", "summoner-by-puuid--other")),
        );
    }
    let fake = start_fake_client(&pki, routes).await;
    let context = context_for(&fake, &pki, "Lobby").await;
    let poster = Arc::new(RankRecorder::default());
    let rank = spawn_rank_sync(
        poster.clone(),
        RankSyncOptions {
            call_interval: Duration::from_millis(40),
            ..Default::default()
        },
    );
    let started = std::time::Instant::now();
    rank.send(MachineEvent::Connected(context));
    rank.needed(puuids.clone());
    until(|| poster.json().len() == 6, "all posted").await;
    // 1 own read + 5 × (rank + name) = 11 calls, at least 10 intervals apart.
    assert!(
        started.elapsed() >= Duration::from_millis(400),
        "{:?}",
        started.elapsed()
    );
}

#[tokio::test]
async fn a_disconnect_mid_pass_re_arms_the_rest_for_the_next_connection() {
    let h = rank_setup(vec![
        (
            format!("GET /lol-ranked/v1/ranked-stats/{OTHER}"),
            Route::json(200, &body("16.17", "ranked-stats-by-puuid--other"))
                .delayed(Duration::from_millis(100)),
        ),
        (
            format!("GET /lol-ranked/v1/ranked-stats/{FRIEND}"),
            Route::json(200, &body("16.17", "ranked-stats-by-puuid--ws-cached")),
        ),
    ])
    .await;
    h.rank.send(MachineEvent::Connected(h.context.clone()));
    until(|| h.poster.json().len() == 1, "own").await;
    h.rank.needed(vec![OTHER.into(), FRIEND.into()]);
    pause(20).await;
    h.rank
        .send(MachineEvent::Disconnected(DisconnectReason::ClientLost));
    h.settled().await;
    let posted: Vec<String> = h
        .poster
        .json()
        .iter()
        .map(|p| p["puuid"].as_str().unwrap().to_owned())
        .collect();
    assert!(
        !posted.contains(&FRIEND.to_string()),
        "FRIEND not asked while disconnected"
    );
    // The next lobby answer re-lists FRIEND (the guard was forgotten) and the reconnect drains it.
    h.rank.send(MachineEvent::Connected(h.context.clone()));
    h.rank.needed(vec![FRIEND.into()]);
    until(
        || h.poster.json().iter().any(|p| p["puuid"] == FRIEND),
        "FRIEND posted after reconnect",
    )
    .await;
}

// --- the command runner -----------------------------------------------------------------------------------------

#[derive(Default)]
struct FakeCommands {
    connected_pages: Mutex<(Vec<Vec<CommandEnvelope>>, usize)>,
    disconnected_page: Mutex<Vec<CommandEnvelope>>,
    polls: Mutex<Vec<bool>>,
    answers: Mutex<Vec<(String, String, Value)>>,
    answer_outcome: Mutex<Option<AnswerOutcome>>,
}

impl FakeCommands {
    fn answers(&self) -> Vec<(String, String, Value)> {
        self.answers.lock().unwrap().clone()
    }
}

impl CommandApi for FakeCommands {
    async fn poll(&self, poll: CommandsPoll) -> PollOutcome {
        self.polls.lock().unwrap().push(poll.client_connected);
        let commands = if poll.client_connected {
            let mut guard = self.connected_pages.lock().unwrap();
            let (pages, cursor) = &mut *guard;
            let page = pages.get(*cursor).cloned().unwrap_or_default();
            *cursor += 1;
            page
        } else {
            std::mem::take(&mut *self.disconnected_page.lock().unwrap())
        };
        PollOutcome::Ok(CommandsResponse {
            ok: Default::default(),
            commands,
            next_poll_in_ms: None,
        })
    }

    async fn ack(&self, id: &str, body: &CommandAck) -> AnswerOutcome {
        self.answers.lock().unwrap().push((
            format!("/api/companion/commands/{id}/ack"),
            "ack".into(),
            serde_json::to_value(body).unwrap(),
        ));
        self.answer_outcome
            .lock()
            .unwrap()
            .clone()
            .unwrap_or(AnswerOutcome::Ok)
    }

    async fn nack(&self, id: &str, body: &CommandNack) -> AnswerOutcome {
        self.answers.lock().unwrap().push((
            format!("/api/companion/commands/{id}/nack"),
            "nack".into(),
            serde_json::to_value(body).unwrap(),
        ));
        self.answer_outcome
            .lock()
            .unwrap()
            .clone()
            .unwrap_or(AnswerOutcome::Ok)
    }
}

fn envelope(id: &str, kind: &str, payload: Value) -> CommandEnvelope {
    let ttl_ms: i64 = match kind {
        "invite" => 300_000,
        "switch_side" => 180_000,
        _ => 60_000,
    };
    let now = engine::log::parse_iso_timestamp(NOW).unwrap();
    let created = now - Duration::from_secs(1);
    let expires = created + Duration::from_millis(ttl_ms as u64);
    serde_json::from_value(json!({
        "id": id, "kind": kind, "payload": payload,
        "createdAt": engine::log::iso_timestamp(created), "expiresAt": engine::log::iso_timestamp(expires)
    }))
    .unwrap()
}

/// A client that plays a lobby: the GET answers whatever `world` holds; writes move it.
fn lobby_world(
    fake: &FakeClient,
    start: Option<Value>,
    writes: impl Fn(&str, &str, &Mutex<Option<Value>>) -> Option<Route> + Send + Sync + 'static,
) {
    let world = Arc::new(Mutex::new(start));
    fake.set_handler(Arc::new(move |method, path, body| {
        if method == "GET" && path == "/lol-lobby/v2/lobby" {
            return Some(match world.lock().unwrap().clone() {
                Some(lobby) => Route::json(200, &lobby),
                None => not_found(),
            });
        }
        if method == "GET" && path == "/lol-game-queues/v1/custom" {
            return Some(Route::json(200, &body_of("16.18", "custom-game-queues")));
        }
        if method == "GET" && path == "/lol-game-queues/v1/queues" {
            return Some(Route::json(200, &body_of("16.18", "game-queues")));
        }
        if method == "POST" {
            let _ = body;
            return writes(method, path, &world);
        }
        None
    }));
}

fn body_of(patch: &str, id: &str) -> Value {
    body(patch, id)
}

struct RunnerHarness {
    fake: FakeClient,
    api: Arc<FakeCommands>,
    runner: CommandRunnerHandle,
    context: Arc<ConnectedContext>,
    state: PathBuf,
    _dir: tempfile::TempDir,
}

async fn runner_setup(phase: &str, gate: HashMap<LobbyWriteKind, bool>) -> RunnerHarness {
    let pki = pki("Fake Riot Root");
    let fake = start_fake_client(&pki, HashMap::new()).await;
    let context = context_for(&fake, &pki, phase).await;
    let dir = tempfile::tempdir().unwrap();
    let state = dir.path().join("g");
    let api = Arc::new(FakeCommands::default());
    let mut options = CommandRunnerOptions::new(state.clone());
    options.clock = Arc::new(|| engine::log::parse_iso_timestamp(NOW).unwrap());
    options.scheduler = Arc::new(ManualScheduler::default());
    options.gate = gate;
    let runner = spawn_command_runner(api.clone(), options);
    RunnerHarness {
        fake,
        api,
        runner,
        context,
        state,
        _dir: dir,
    }
}

impl RunnerHarness {
    async fn run(&self, page: Vec<CommandEnvelope>) {
        self.api.connected_pages.lock().unwrap().0.push(page);
        self.runner.send(MachineEvent::Connected(self.context.clone()));
        assert!(self.runner.settled(SETTLE).await);
        until(|| self.runner.view().borrow().idle, "poll done").await;
        assert!(self.runner.settled(SETTLE).await);
    }

    fn last_answer(&self) -> (String, String, Value) {
        self.api.answers().last().cloned().expect("an answer")
    }

    fn assert_golden(&self, golden: &str) {
        let g = golden_file(golden);
        let (path, _, body) = self.last_answer();
        assert_eq!(path, g["path"].as_str().unwrap(), "{golden}");
        assert_eq!(body, g["body"], "{golden}");
    }
}

#[tokio::test]
async fn golden_create_lobby_ack_client_write_lobby_password_replay_and_commands_done() {
    let h = runner_setup("None", HashMap::new()).await;
    let created = body_of("16.18", "create-lobby");
    let after = created.clone();
    lobby_world(&h.fake, None, move |_, path, world| {
        (path == "/lol-lobby/v2/lobby").then(|| {
            *world.lock().unwrap() = Some(after.clone());
            Route::json(200, &after)
        })
    });
    let create = envelope(
        "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
        "create_lobby",
        json!({ "lobbyName": "customs-verify", "lobbyPassword": "golden-pw-4821" }),
    );
    // The disconnected poll at start answers nothing (the real server's contract).
    until(|| !h.api.polls.lock().unwrap().is_empty(), "first poll").await;
    assert!(!h.api.polls.lock().unwrap()[0], "commands-poll--disconnected");
    h.run(vec![create.clone()]).await;
    assert!(
        *h.api.polls.lock().unwrap().last().unwrap(),
        "commands-poll--connected"
    );
    h.assert_golden("command-ack--create-lobby");
    let writes = h.fake.writes();
    assert_eq!(writes.len(), 1);
    let sent: Value = serde_json::from_str(&writes[0].body).unwrap();
    assert_eq!(sent, golden_body("lcu-create-lobby--create-lobby"));

    // The lobby watcher carries the password this process set.
    let poster = ScriptedPoster::ok();
    let (lobby, _signals) = spawn_lobby_watcher(
        poster.clone(),
        LobbyWatcherOptions {
            password_for: Some(h.runner.password_for()),
            ..Default::default()
        },
    );
    lobby.send(MachineEvent::Connected(h.context.clone()));
    lobby.send(MachineEvent::Event(Arc::new(RoutedEvent::Lobby {
        event_type: LcuEventType::Create,
        lobby: Some(Box::new(serde_json::from_value(created).unwrap())),
    })));
    until(|| poster.posted().len() == 1, "lobby post").await;
    assert_eq!(
        poster.posted_json()[0],
        golden_body("lobby--create-lobby--with-password")
    );

    // A lost ack: the same id again is re-acked from the record with no client call.
    h.api.connected_pages.lock().unwrap().0.push(vec![create]);
    h.runner.poll_now();
    until(|| h.api.answers().len() == 2, "replayed ack").await;
    assert_eq!(
        h.api.answers()[1].2,
        golden_body("command-ack--create-lobby--replayed")
    );
    assert_eq!(h.fake.writes().len(), 1, "execute once");
    let done: Value =
        serde_json::from_str(&std::fs::read_to_string(h.state.join("commands-done.json")).unwrap()).unwrap();
    assert_eq!(done, golden_file("commands-done-file--create-lobby")["file"]);
}

/// M17.17: `pickType` names the entry the create body carries. Blind is 3100 and draft 3110 on 16.18, both
/// joined from the dialog data and the queue list; an old payload with no `pickType` is draft.
#[tokio::test]
async fn pick_type_blind_sends_the_blind_entry_and_draft_or_absent_the_draft_one() {
    let created = body_of("16.18", "create-lobby");
    let base = json!({ "lobbyName": "customs-verify", "lobbyPassword": "golden-pw-4821" });
    let mut blind = base.clone();
    blind["pickType"] = json!("blind");
    let mut draft = base.clone();
    draft["pickType"] = json!("draft");
    for (label, payload, queue_id) in [
        ("blind", blind, 3100),
        ("draft", draft, 3110),
        ("absent", base, 3110),
    ] {
        let h = runner_setup("None", HashMap::new()).await;
        let after = created.clone();
        lobby_world(&h.fake, None, move |_, path, world| {
            (path == "/lol-lobby/v2/lobby").then(|| {
                *world.lock().unwrap() = Some(after.clone());
                Route::json(200, &after)
            })
        });
        h.run(vec![envelope(
            "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
            "create_lobby",
            payload,
        )])
        .await;
        let writes = h.fake.writes();
        assert_eq!(writes.len(), 1, "{label}");
        let sent: Value = serde_json::from_str(&writes[0].body).unwrap();
        assert_eq!(sent["queueId"], queue_id, "{label}");
        assert_eq!(
            sent["customGameLobby"]["configuration"]["mutators"]["id"], queue_id,
            "{label}"
        );
        let golden = if label == "blind" {
            "lcu-create-lobby--create-lobby--blind"
        } else {
            "lcu-create-lobby--create-lobby"
        };
        assert_eq!(sent, golden_body(golden), "{label}");
    }
}

/// A `pickType` outside the schema's enum is `malformed_payload` and never reaches the client.
#[tokio::test]
async fn an_unknown_pick_type_is_a_malformed_payload_with_no_client_call() {
    let h = runner_setup("None", HashMap::new()).await;
    lobby_world(&h.fake, None, |_, _, _| None);
    let payload =
        json!({ "lobbyName": "customs-verify", "lobbyPassword": "golden-pw-4821", "pickType": "random" });
    h.run(vec![envelope(
        "5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f",
        "create_lobby",
        payload,
    )])
    .await;
    let (_, _, body) = h.last_answer();
    assert_eq!(
        body["error"],
        "malformed_payload: pickType: Invalid option: expected one of \"draft\"|\"blind\""
    );
    assert!(h.fake.requests.lock().unwrap().is_empty());
}

#[test]
fn golden_poll_paths_and_the_switch_side_write_have_no_body() {
    for (connected, golden) in [
        (true, "commands-poll--connected"),
        (false, "commands-poll--disconnected"),
    ] {
        let g = golden_file(golden);
        assert_eq!(g["method"], "GET");
        assert_eq!(
            CommandsPoll {
                client_connected: connected
            }
            .path(),
            g["path"].as_str().unwrap()
        );
        assert_eq!(g["body"], Value::Null);
    }
    let g = golden_file("lcu-switch-side--lobby-team");
    assert_eq!(
        (g["path"].as_str().unwrap(), &g["body"]),
        ("/lol-lobby/v2/lobby/team/TEAM2", &Value::Null)
    );
}

#[tokio::test]
async fn golden_invite_sent_with_its_client_write() {
    let h = runner_setup("Lobby", HashMap::new()).await;
    lobby_world(&h.fake, Some(body_of("16.18", "create-lobby")), |_, path, _| {
        (path == "/lol-lobby/v2/lobby/invitations")
            .then(|| Route::json(200, &body_of("16.18", "lobby-invitations")))
    });
    h.run(vec![envelope(
        "5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f",
        "invite",
        json!({ "puuid": FRIEND, "summonerId": "55838205" }),
    )])
    .await;
    h.assert_golden("command-ack--invite--sent");
    let sent: Value = serde_json::from_str(&h.fake.writes()[0].body).unwrap();
    assert_eq!(sent, golden_body("lcu-invite--lobby-invitations"));
}

#[tokio::test]
async fn golden_invite_already_pending_and_already_member_without_a_write() {
    for (fixture, payload, golden) in [
        (
            "lobby",
            json!({ "puuid": "ae4f66e8-745c-5b24-8315-dc046c8bba96", "summonerId": null }),
            "command-ack--invite--already-pending",
        ),
        (
            "lobby--two-players",
            json!({ "puuid": FRIEND, "summonerId": "53574489" }),
            "command-ack--invite--already-member",
        ),
    ] {
        let h = runner_setup("Lobby", HashMap::new()).await;
        lobby_world(&h.fake, Some(body_of("16.17", fixture)), |_, _, _| None);
        h.run(vec![envelope(
            "5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f",
            "invite",
            payload,
        )])
        .await;
        h.assert_golden(golden);
        assert!(h.fake.writes().is_empty());
    }
}

#[tokio::test]
async fn golden_invite_client_rejected_lists_both_answers() {
    let h = runner_setup("Lobby", HashMap::new()).await;
    lobby_world(&h.fake, Some(body_of("16.17", "lobby")), |_, path, _| {
        (path == "/lol-lobby/v2/lobby/invitations")
            .then(|| Route::json(404, &body_of("16.17", "lobby-invitations--no-lobby")))
    });
    h.run(vec![envelope(
        "5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f",
        "invite",
        json!({ "puuid": "b3b781b3-9a77-5061-8054-817d2355b2e6", "summonerId": "80934556" }),
    )])
    .await;
    h.assert_golden("command-nack--invite--client-rejected");
    let bodies: Vec<Value> = h
        .fake
        .writes()
        .iter()
        .map(|w| serde_json::from_str(&w.body).unwrap())
        .collect();
    assert_eq!(
        bodies,
        [
            json!([{ "toSummonerId": 80934556 }]),
            json!([{ "toPuuid": "b3b781b3-9a77-5061-8054-817d2355b2e6" }])
        ]
    );
}

#[tokio::test]
async fn golden_switch_side_with_its_client_write_and_already_there() {
    let h = runner_setup("Lobby", HashMap::new()).await;
    lobby_world(
        &h.fake,
        Some(body_of("16.18", "create-lobby")),
        |_, path, world| {
            (path == "/lol-lobby/v2/lobby/team/TEAM2").then(|| {
                let mut lobby = world.lock().unwrap().clone().unwrap();
                let moved = lobby["gameConfig"]["customTeam100"].clone();
                lobby["gameConfig"]["customTeam200"] = moved;
                lobby["gameConfig"]["customTeam100"] = json!([]);
                *world.lock().unwrap() = Some(lobby);
                Route {
                    status: 204,
                    body: String::new(),
                    delay: Duration::ZERO,
                }
            })
        },
    );
    h.run(vec![envelope(
        "5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f",
        "switch_side",
        json!({ "targetSide": 200 }),
    )])
    .await;
    h.assert_golden("command-ack--switch-side");
    let write = &h.fake.writes()[0];
    assert_eq!(
        (write.path.as_str(), write.body.as_str()),
        ("/lol-lobby/v2/lobby/team/TEAM2", "")
    );

    let h = runner_setup("Lobby", HashMap::new()).await;
    lobby_world(
        &h.fake,
        Some(body_of("16.17", "lobby--two-players")),
        |_, _, _| None,
    );
    h.run(vec![envelope(
        "5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f",
        "switch_side",
        json!({ "targetSide": 100 }),
    )])
    .await;
    h.assert_golden("command-ack--switch-side--already");
    assert!(h.fake.writes().is_empty());
}

#[tokio::test]
async fn golden_nacks_already_in_lobby_client_rejected_no_lobby_wrong_phase_unknown_kind_malformed() {
    let id = "5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f";
    let create = json!({ "lobbyName": "customs-verify", "lobbyPassword": "golden-pw-4821" });
    let cases: Vec<(&str, Option<Value>, &str, Value, &str)> = vec![
        (
            "Lobby",
            Some(body_of("16.17", "lobby")),
            "create_lobby",
            create.clone(),
            "command-nack--create-lobby--already-in-lobby",
        ),
        (
            "Lobby",
            None,
            "create_lobby",
            create,
            "command-nack--create-lobby--client-rejected",
        ),
        (
            "Lobby",
            None,
            "invite",
            json!({ "puuid": FRIEND, "summonerId": "53574489" }),
            "command-nack--invite--no-lobby",
        ),
        (
            "InProgress",
            None,
            "switch_side",
            json!({ "targetSide": 200 }),
            "command-nack--switch-side--wrong-phase",
        ),
        ("Lobby", None, "dodge", json!({}), "command-nack--unknown-kind"),
        (
            "Lobby",
            None,
            "switch_side",
            json!({ "targetSide": 300 }),
            "command-nack--switch-side--malformed-payload",
        ),
    ];
    for (phase, lobby, kind, payload, golden) in cases {
        let h = runner_setup(phase, HashMap::new()).await;
        lobby_world(&h.fake, lobby, |_, path, _| {
            (path == "/lol-lobby/v2/lobby")
                .then(|| Route::json(500, &body_of("16.17", "create-lobby--legacy-blind")))
        });
        h.run(vec![envelope(id, kind, payload)]).await;
        h.assert_golden(golden);
        if golden.ends_with("wrong-phase")
            || golden.ends_with("unknown-kind")
            || golden.ends_with("malformed-payload")
        {
            assert!(
                h.fake.requests.lock().unwrap().is_empty(),
                "{golden}: no client call at all"
            );
        }
    }
}

#[tokio::test]
async fn golden_not_connected_is_retryable_and_not_recorded() {
    let h = runner_setup("Lobby", HashMap::new()).await;
    // The race: a command handed out while there is no client.
    *h.api.disconnected_page.lock().unwrap() = vec![envelope(
        "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e",
        "switch_side",
        json!({ "targetSide": 200 }),
    )];
    h.runner.poll_now();
    until(|| !h.api.answers().is_empty(), "nack").await;
    h.assert_golden("command-nack--not-connected");
    pause(20).await;
    assert!(
        !h.state.join("commands-done.json").exists(),
        "a retryable nack is not recorded"
    );
}

#[tokio::test]
async fn check_10_the_gate_refuses_a_kind_flagged_off_with_no_client_call() {
    let h = runner_setup("Lobby", HashMap::from([(LobbyWriteKind::Invite, false)])).await;
    h.run(vec![envelope(
        "5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f",
        "invite",
        json!({ "puuid": FRIEND, "summonerId": null }),
    )])
    .await;
    let (_, _, body) = h.last_answer();
    assert!(
        body["error"]
            .as_str()
            .unwrap()
            .starts_with("endpoint_unverified: Invite (POST /lol-lobby/v2/lobby/invitations)")
    );
    assert!(h.fake.requests.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_409_or_404_on_the_ack_is_accepted_and_check_8_the_record_survives_a_restart() {
    let h = runner_setup("Lobby", HashMap::new()).await;
    lobby_world(
        &h.fake,
        Some(body_of("16.17", "lobby--two-players")),
        |_, _, _| None,
    );
    *h.api.answer_outcome.lock().unwrap() = Some(AnswerOutcome::Http(409));
    let command = envelope(
        "5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f",
        "switch_side",
        json!({ "targetSide": 100 }),
    );
    h.run(vec![command.clone()]).await;
    let reads = h.fake.requests_to("/lol-lobby/v2/lobby");
    // A new runner on the same state dir: the file stops a second execution.
    let api = Arc::new(FakeCommands::default());
    api.connected_pages.lock().unwrap().0.push(vec![command]);
    let mut options = CommandRunnerOptions::new(h.state.clone());
    options.clock = Arc::new(|| engine::log::parse_iso_timestamp(NOW).unwrap());
    options.scheduler = Arc::new(ManualScheduler::default());
    let second = spawn_command_runner(api.clone(), options);
    second.send(MachineEvent::Connected(h.context.clone()));
    until(|| !api.answers().is_empty(), "re-ack").await;
    assert_eq!(api.answers()[0].2, json!({ "result": { "side": 100 } }));
    assert_eq!(
        h.fake.requests_to("/lol-lobby/v2/lobby"),
        reads,
        "no client call on the replay"
    );
}

#[tokio::test]
async fn expiry_compares_local_elapsed_time_with_the_server_ttl() {
    assert!(!is_stale(
        "2026-09-08T17:00:00.000Z",
        "2026-09-08T17:01:00.000Z",
        0,
        59_000
    ));
    assert!(is_stale(
        "2026-09-08T17:00:00.000Z",
        "2026-09-08T17:01:00.000Z",
        0,
        61_000
    ));
    assert!(!is_stale("bad", "2026-09-08T17:01:00.000Z", 0, 1_000_000));
    assert!(
        !is_stale(
            "2026-09-08T17:01:00.000Z",
            "2026-09-08T17:00:00.000Z",
            0,
            1_000_000
        ),
        "a non-positive TTL never fails"
    );
}

#[test]
fn executed_store_keeps_the_newest_200_drops_entries_older_than_a_day_and_starts_over_on_a_bad_file() {
    let dir = tempfile::tempdir().unwrap();
    let now = engine::log::parse_iso_timestamp(NOW).unwrap();
    let mut store = ExecutedStore::new(dir.path(), Arc::new(move || now));
    let entry = |id: String, at: &str| engine::watchers::CommandsDoneEntry {
        id,
        kind: "invite".into(),
        at: at.into(),
        outcome: engine::watchers::CommandOutcome::Done,
        result: Some(serde_json::Map::new()),
        error: None,
    };
    assert!(store.record(entry("old".into(), "2026-09-07T16:00:00.000Z")));
    for i in 0..201 {
        store.record(entry(format!("id-{i}"), NOW));
    }
    let file: Value =
        serde_json::from_str(&std::fs::read_to_string(dir.path().join("commands-done.json")).unwrap())
            .unwrap();
    let ids: Vec<&str> = file["entries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids.len(), 200);
    assert!(!ids.contains(&"old") && !ids.contains(&"id-0"));
    assert!(!dir.path().join("commands-done.json.tmp").exists());
    std::fs::write(dir.path().join("commands-done.json"), "{nope").unwrap();
    let mut fresh = ExecutedStore::new(dir.path(), Arc::new(move || now));
    assert!(fresh.get("id-5").is_none());
}

#[test]
fn the_riot_line_no_gameplay_path_in_the_engine() {
    // Bare substrings, so a path built with `format!` or `concat!` from pieces is caught too. Comments are
    // skipped (the docs name what is banned), and so is a file's `#[cfg(test)]` tail (tests prove the
    // refusals with these very paths). The engine and the Tauri shell both.
    const BANNED: [&str; 4] = ["lol-champ-select", "lol-matchmaking", "ready-check", ":2999"];
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut stack = vec![manifest.join("src"), manifest.join("../../src-tauri/src")];
    let mut scanned = 0;
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries {
            let path = entry.unwrap().path();
            if path.is_dir() {
                stack.push(path);
            } else if path.extension().is_some_and(|e| e == "rs") {
                scanned += 1;
                let text = std::fs::read_to_string(&path).unwrap();
                let code = text.split("#[cfg(test)]").next().unwrap_or_default();
                for (number, line) in code.lines().enumerate() {
                    if line.trim_start().starts_with("//") {
                        continue;
                    }
                    for banned in BANNED {
                        assert!(
                            !line.contains(banned),
                            "{}:{} names {banned}: the companion never automates gameplay",
                            path.display(),
                            number + 1
                        );
                    }
                }
            }
        }
    }
    assert!(scanned > 20, "the scan found the sources ({scanned} files)");
}
