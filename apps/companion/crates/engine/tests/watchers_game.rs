//! The game watcher and the durable queue (port of `apps/companion/src/gameWatcher.test.ts` and
//! `queue.test.ts`, case for case; the numbered M2.3 checks in the names), against the fake League client for
//! its two reads and a scripted poster for its posts, with the queue in a temp state directory. Plus the M17.9
//! contract: the TypeScript goldens (in_progress, eog observed and derived, the queue file, the recorded
//! evening through the connection machine), the stale-partyId fix, and 0.3.x files posted verbatim.

#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

mod support;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use engine::backoff::BackoffOptions;
use engine::lcu::LcuClient;
use engine::lcu::discovery::{Discovery, DiscoveryInputs, FsReader};
use engine::lcu::events::{LcuEventType, RoutedEvent};
use engine::lcu::process::{ProcessList, ProcessLister};
use engine::lcu::types::{EogStatsBlock, Lobby, Summoner};
use engine::queue::{MAX_QUEUED_GAMES, queue_dir, write_queued};
use engine::watchers::connection::{
    ConfiguredDiscovery, ConnectedContext, DisconnectReason, MachineEvent, MachineOptions, MachineState,
    spawn_machine,
};
use engine::watchers::game::{GameWatcherHandle, GameWatcherOptions, spawn_game_watcher};
use engine::watchers::lobby::TokioScheduler;
use serde_json::{Value, json};
use support::fake_client::{FakeClient, Route, start_fake_client};
use support::watch_kit::{
    ManualScheduler, ScriptedGamePoster, capture_logs, game_http, game_ok, pause, until,
};
use support::{PASSWORD, Pki, body, credentials, fixtures_dir, golden_body, pki};

const PARTY: &str = "e3c69392-a134-43cb-97ae-8add18c72494";
const GAME_ONE: u64 = 4000965483;
const GAME_TWO: u64 = 4000969091;
const SETTLE: Duration = Duration::from_secs(8);
const SESSION_GET: &str = "GET /lol-gameflow/v1/session";
const EOG_GET: &str = "GET /lol-end-of-game/v1/eog-stats-block";

fn ms(iso: &str) -> SystemTime {
    engine::log::parse_iso_timestamp(iso).unwrap()
}

fn not_found() -> Route {
    Route::json(
        404,
        &json!({ "errorCode": "RPC_ERROR", "httpStatus": 404, "message": "gone" }),
    )
}

fn eog_raw() -> Value {
    body("16.17", "eog-stats-block")
}

fn eog_event(raw: Value, event_type: LcuEventType) -> MachineEvent {
    let block: EogStatsBlock = serde_json::from_value(raw.clone()).unwrap();
    MachineEvent::Event(Arc::new(RoutedEvent::EogBlock {
        event_type,
        block: Some(Box::new(block)),
        raw,
    }))
}

fn lobby_event(raw: Option<Value>) -> MachineEvent {
    let event_type = if raw.is_some() {
        LcuEventType::Update
    } else {
        LcuEventType::Delete
    };
    let lobby: Option<Box<Lobby>> = raw.map(|r| Box::new(serde_json::from_value(r).unwrap()));
    MachineEvent::Event(Arc::new(RoutedEvent::Lobby { event_type, lobby }))
}

fn phase_event(name: &str) -> MachineEvent {
    MachineEvent::Event(Arc::new(RoutedEvent::GameflowPhase(name.into())))
}

struct Harness {
    fake: FakeClient,
    poster: Arc<ScriptedGamePoster>,
    scheduler: Arc<ManualScheduler>,
    watcher: GameWatcherHandle,
    context: Arc<ConnectedContext>,
    clock: Arc<Mutex<SystemTime>>,
    state: PathBuf,
    _dir: Option<tempfile::TempDir>,
}

struct Setup {
    script: Vec<engine::watchers::game::GamePostOutcome>,
    routes: Vec<(String, Route)>,
    phase: Option<String>,
    state: Option<PathBuf>,
    manual_timers: bool,
    connect: bool,
}

impl Default for Setup {
    fn default() -> Self {
        Self {
            script: vec![game_ok(true)],
            routes: Vec::new(),
            phase: Some("Lobby".into()),
            state: None,
            manual_timers: false,
            connect: true,
        }
    }
}

async fn setup(options: Setup) -> Harness {
    let pki: Arc<Pki> = Arc::new(pki("Fake Riot Root"));
    let mut routes: HashMap<String, Route> =
        HashMap::from([(SESSION_GET.into(), not_found()), (EOG_GET.into(), not_found())]);
    routes.extend(options.routes);
    let fake = start_fake_client(&pki, routes).await;
    let client =
        LcuClient::with_verifier(&credentials(fake.port), pki.verifier(), Duration::from_secs(2)).unwrap();
    let summoner: Summoner = serde_json::from_value(body("16.17", "current-summoner")).unwrap();
    let context = Arc::new(ConnectedContext {
        client,
        version: "16.17.8104348+branch.releases-16-17".into(),
        patch: Some("16.17".into()),
        summoner: Some(summoner),
        phase: options.phase,
        port: fake.port,
    });
    let (dir, state) = match options.state {
        Some(state) => (None, state),
        None => {
            let dir = tempfile::tempdir().unwrap();
            let state = dir.path().join("groups").join("g1");
            (Some(dir), state)
        }
    };
    let clock = Arc::new(Mutex::new(ms("2026-09-08T16:30:00.000Z")));
    let reading = clock.clone();
    let poster = ScriptedGamePoster::new(options.script);
    let scheduler = Arc::new(ManualScheduler::default());
    let watcher = spawn_game_watcher(
        poster.clone(),
        GameWatcherOptions {
            state_dir: state.clone(),
            clock: Arc::new(move || *reading.lock().unwrap()),
            scheduler: if options.manual_timers {
                scheduler.clone()
            } else {
                Arc::new(TokioScheduler)
            },
            backoff: BackoffOptions::new(Duration::from_millis(10), Duration::from_millis(30)),
            max_queued: MAX_QUEUED_GAMES,
        },
    );
    let h = Harness {
        fake,
        poster,
        scheduler,
        watcher,
        context,
        clock,
        state,
        _dir: dir,
    };
    if options.connect {
        h.watcher.send(MachineEvent::Connected(h.context.clone()));
    }
    h
}

impl Harness {
    async fn settled(&self) {
        assert!(self.watcher.settled(SETTLE).await, "game watcher did not settle");
    }

    async fn phase(&self, name: &str) {
        self.watcher.send(phase_event(name));
        self.settled().await;
    }

    async fn eog(&self, raw: Value, event_type: LcuEventType) {
        self.watcher.send(eog_event(raw, event_type));
        self.settled().await;
    }

    fn lobby(&self, raw: Option<Value>) {
        self.watcher.send(lobby_event(raw));
    }

    fn set_clock(&self, iso: &str) {
        *self.clock.lock().unwrap() = ms(iso);
    }

    fn files(&self) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(queue_dir(&self.state))
            .map(|entries| {
                entries
                    .filter_map(Result::ok)
                    .filter(|e| e.path().is_file())
                    .map(|e| e.file_name().to_string_lossy().into_owned())
                    .collect()
            })
            .unwrap_or_default();
        names.sort();
        names
    }

    fn posts(&self) -> Vec<Value> {
        self.poster.posted()
    }

    fn by_phase(&self, phase: &str) -> Vec<Value> {
        self.posts().into_iter().filter(|p| p["phase"] == phase).collect()
    }

    fn gets(&self, path: &str) -> usize {
        self.fake.requests_to(path)
    }

    fn view(&self) -> engine::watchers::game::GameWatcherView {
        self.watcher.view().borrow().clone()
    }
}

fn session_with(phase: &str, f: impl FnOnce(&mut Value)) -> Route {
    let mut session = body("16.17", "gameflow-session");
    session["phase"] = json!(phase);
    f(&mut session);
    Route::json(200, &session)
}

struct Line {
    ts: String,
    uri: String,
    event_type: String,
    data: Value,
}

fn recorded(uris: &[&str]) -> Vec<Line> {
    std::fs::read_to_string(fixtures_dir().join("16.17/ws-events.ndjson"))
        .unwrap()
        .lines()
        .filter(|l| !l.is_empty())
        .map(|l| serde_json::from_str::<Value>(l).unwrap())
        .filter(|r| r.get("dropped").is_none() && r.get("redacted").is_none())
        .filter(|r| r["uri"].as_str().is_some_and(|u| uris.contains(&u)))
        .map(|r| Line {
            ts: r["ts"].as_str().unwrap().into(),
            uri: r["uri"].as_str().unwrap().into(),
            event_type: r["eventType"].as_str().unwrap().into(),
            data: r["data"].clone(),
        })
        .collect()
}

const LOBBY_URI: &str = "/lol-lobby/v2/lobby";
const PHASE_URI: &str = "/lol-gameflow/v1/gameflow-phase";
const SESSION_URI: &str = "/lol-gameflow/v1/session";
const EOG_URI: &str = "/lol-end-of-game/v1/eog-stats-block";

/// The TS `replay`: the clock follows each line, every session frame becomes the next session GET's answer,
/// each phase and eog event settles before the next line.
async fn replay(h: &Harness, lines: &[Line]) {
    for line in lines {
        h.set_clock(&line.ts);
        match line.uri.as_str() {
            SESSION_URI => h.fake.set_route(SESSION_GET, Route::json(200, &line.data)),
            PHASE_URI => h.phase(line.data.as_str().unwrap()).await,
            EOG_URI => {
                if line.data.is_null() || line.event_type == "Delete" {
                    h.watcher
                        .send(MachineEvent::Event(Arc::new(RoutedEvent::EogBlock {
                            event_type: LcuEventType::Delete,
                            block: None,
                            raw: Value::Null,
                        })));
                    h.settled().await;
                } else {
                    let event_type = if line.event_type == "Create" {
                        LcuEventType::Create
                    } else {
                        LcuEventType::Update
                    };
                    h.eog(line.data.clone(), event_type).await;
                }
            }
            LOBBY_URI => h.lobby(if line.data.is_null() {
                None
            } else {
                Some(line.data.clone())
            }),
            _ => {}
        }
    }
    h.settled().await;
}

// --- post 1, in_progress ------------------------------------------------------------------------------------

#[tokio::test]
async fn check_1_replays_two_in_progress_posts_with_start_at_each_game_start() {
    let h = setup(Setup::default()).await;
    replay(&h, &recorded(&[SESSION_URI, PHASE_URI, LOBBY_URI])).await;
    let posts = h.by_phase("in_progress");
    assert_eq!(
        posts
            .iter()
            .map(|p| p["gameId"].as_u64().unwrap())
            .collect::<Vec<_>>(),
        [GAME_ONE, GAME_TWO]
    );
    assert_eq!(posts[0]["startedAt"], "2026-09-08T16:34:20.911Z");
    assert_eq!(posts[1]["startedAt"], "2026-09-08T16:37:38.903Z");
    // Captured at GameStart, before the lobby Delete that follows it.
    assert_eq!(posts[0]["partyId"], "c85a9f77-e83a-4b37-b8a1-502ee3d540b2");
    assert_eq!(posts[1]["partyId"], PARTY);
    assert_eq!(h.gets("/lol-gameflow/v1/session"), 2, "one session read per game");
    assert!(h.files().is_empty());
}

#[tokio::test]
async fn check_3_never_posts_the_stale_id_from_a_lobby_phase_session() {
    let (logs, _g) = capture_logs();
    let h = setup(Setup {
        routes: vec![(
            SESSION_GET.into(),
            Route::json(200, &body("16.17", "gameflow-session--in-lobby")),
        )],
        ..Default::default()
    })
    .await;
    for p in ["Lobby", "ChampSelect", "None"] {
        h.phase(p).await;
    }
    assert_eq!(h.gets("/lol-gameflow/v1/session"), 0);
    assert!(h.posts().is_empty());
    h.phase("GameStart").await;
    assert_eq!(h.gets("/lol-gameflow/v1/session"), 1);
    assert!(h.posts().is_empty());
    assert!(logs.text().contains("stale"));
}

#[tokio::test]
async fn posts_nothing_when_the_session_read_fails_or_carries_game_id_0() {
    let (logs, _g) = capture_logs();
    let h = setup(Setup::default()).await;
    h.phase("GameStart").await;
    h.phase("InProgress").await;
    assert_eq!(h.gets("/lol-gameflow/v1/session"), 1);
    assert!(h.posts().is_empty());
    assert_eq!(logs.count("could not read the gameflow session"), 1);
    h.fake.set_route(
        SESSION_GET,
        session_with("GameStart", |s| s["gameData"]["gameId"] = json!(0)),
    );
    h.phase("WaitingForStats").await;
    h.phase("GameStart").await;
    assert!(h.posts().is_empty());
    assert!(logs.text().contains("no game id"));
}

#[tokio::test]
async fn posts_on_in_progress_when_game_start_was_missed_once_and_never_for_a_non_custom() {
    let (logs, _g) = capture_logs();
    let h = setup(Setup {
        routes: vec![(SESSION_GET.into(), session_with("InProgress", |_| {}))],
        ..Default::default()
    })
    .await;
    h.phase("InProgress").await;
    h.phase("InProgress").await;
    let posts = h.by_phase("in_progress");
    assert_eq!(
        posts
            .iter()
            .map(|p| p["gameId"].as_u64().unwrap())
            .collect::<Vec<_>>(),
        [GAME_TWO]
    );
    assert_eq!(posts[0]["partyId"], Value::Null);
    h.fake.set_route(
        SESSION_GET,
        session_with("GameStart", |s| {
            s["gameData"]["gameId"] = json!(4000970000u64);
            s["gameData"]["isCustomGame"] = json!(false);
        }),
    );
    h.phase("None").await;
    h.phase("GameStart").await;
    assert_eq!(h.posts().len(), 1);
    assert!(logs.text().contains("not a custom"));
}

#[tokio::test]
async fn gives_up_on_a_failed_in_progress_post_with_one_line_and_no_file() {
    let (logs, _g) = capture_logs();
    let h = setup(Setup {
        script: vec![game_http(500)],
        routes: vec![(SESSION_GET.into(), session_with("GameStart", |_| {}))],
        ..Default::default()
    })
    .await;
    h.phase("GameStart").await;
    assert_eq!(h.posts().len(), 1);
    assert!(h.files().is_empty());
    assert_eq!(logs.count("in_progress post failed"), 1);
    assert_eq!(
        h.view().held_starts.get(&(GAME_TWO as i64)).unwrap().started_at,
        "2026-09-08T16:30:00.000Z"
    );
}

// --- post 2, eog from the socket ----------------------------------------------------------------------------

#[tokio::test]
async fn check_2_replays_the_eog_frames_one_post_the_no_winner_block_dropped() {
    let (logs, _g) = capture_logs();
    let h = setup(Setup::default()).await;
    replay(&h, &recorded(&[SESSION_URI, PHASE_URI, EOG_URI, LOBBY_URI])).await;
    assert_eq!(h.by_phase("in_progress").len(), 2);
    let eogs = h.by_phase("eog");
    assert_eq!(eogs.len(), 1);
    assert_eq!(
        (
            eogs[0]["gameId"].as_u64(),
            eogs[0]["partyId"].as_str(),
            eogs[0]["winningSide"].as_u64()
        ),
        (Some(GAME_TWO), Some(PARTY), Some(200))
    );
    assert_eq!(
        eogs[0]["startedAt"], "2026-09-08T16:37:38.903Z",
        "check 4, first half: the held moment"
    );
    assert_eq!(logs.count("no winning team"), 1);
    assert!(logs.text().contains(&GAME_ONE.to_string()));
    assert!(h.files().is_empty());
    assert_eq!(h.gets("/lol-end-of-game/v1/eog-stats-block"), 0);
}

#[tokio::test]
async fn check_4_derives_started_at_when_only_the_eog_frame_was_seen() {
    let h = setup(Setup::default()).await;
    h.eog(eog_raw(), LcuEventType::Create).await;
    until(|| h.files().is_empty() && h.posts().len() == 1, "posted").await;
    let post = &h.posts()[0];
    assert_eq!(
        (post["phase"].as_str(), post["gameId"].as_u64()),
        (Some("eog"), Some(GAME_TWO))
    );
    assert_eq!(post["partyId"], Value::Null);
    assert_eq!(post["startedAt"], "2026-09-08T16:37:47.672Z");
}

#[tokio::test]
async fn dedupes_create_and_update_one_file_one_post() {
    let h = setup(Setup {
        script: vec![game_http(500)],
        manual_timers: true,
        ..Default::default()
    })
    .await;
    h.eog(eog_raw(), LcuEventType::Create).await;
    h.eog(eog_raw(), LcuEventType::Update).await;
    h.eog(eog_raw(), LcuEventType::Create).await;
    assert_eq!(h.files(), [format!("{GAME_TWO}.json")]);
    assert_eq!(h.posts().len(), 1);
}

#[tokio::test]
async fn writes_the_file_before_the_post_and_the_post_is_the_file_payload() {
    let h = setup(Setup {
        script: vec![game_http(500)],
        manual_timers: true,
        ..Default::default()
    })
    .await;
    h.eog(eog_raw(), LcuEventType::Create).await;
    let text = std::fs::read_to_string(queue_dir(&h.state).join(format!("{GAME_TWO}.json"))).unwrap();
    let on_disk: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(on_disk["version"], 1);
    assert_eq!(on_disk["queuedAt"], "2026-09-08T16:30:00.000Z");
    assert_eq!(on_disk["payload"], h.posts()[0]);
    assert_eq!(
        format!("{}\n", serde_json::to_string_pretty(&on_disk).unwrap()),
        text,
        "two-space JSON and a newline"
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        let mode = std::fs::metadata(queue_dir(&h.state).join(format!("{GAME_TWO}.json")))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }
}

#[tokio::test]
async fn check_11_a_matched_game_block_produces_no_file_and_no_post() {
    let (logs, _g) = capture_logs();
    let h = setup(Setup::default()).await;
    let mut raw = eog_raw();
    raw["gameType"] = json!("MATCHED_GAME");
    h.eog(raw, LcuEventType::Create).await;
    assert!(h.posts().is_empty());
    assert!(h.files().is_empty());
    assert!(logs.text().contains("not a custom game") && logs.text().contains("MATCHED_GAME"));
}

#[tokio::test]
async fn check_7_the_queued_file_is_scrubbed_and_no_log_line_carries_a_secret() {
    let (logs, _g) = capture_logs();
    let h = setup(Setup {
        script: vec![game_http(500)],
        manual_timers: true,
        ..Default::default()
    })
    .await;
    let mut raw = eog_raw();
    raw["mucJwtDto"] = json!({ "jwt": "SECRET_JWT_VALUE_0123456789" });
    raw["multiUserChatPassword"] = json!("SECRET_CHAT_PASSWORD_abcdef");
    h.eog(raw, LcuEventType::Create).await;
    let text = std::fs::read_to_string(queue_dir(&h.state).join(format!("{GAME_TWO}.json"))).unwrap();
    assert!(!text.contains("SECRET_JWT_VALUE") && !text.contains("SECRET_CHAT_PASSWORD"));
    let parsed: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(parsed["payload"]["raw"]["mucJwtDto"], "[redacted]");
    assert_eq!(parsed["payload"]["raw"]["multiUserChatPassword"], "[redacted]");
    let log = logs.text();
    for needle in ["SECRET_JWT_VALUE", "SECRET_CHAT_PASSWORD", PASSWORD, "\"teams\""] {
        assert!(!log.contains(needle), "{needle}");
    }
}

// --- the connect-time GET -------------------------------------------------------------------------------------

#[tokio::test]
async fn check_10_reads_the_block_once_at_connect_in_end_of_game_and_posts_it() {
    let h = setup(Setup {
        phase: Some("EndOfGame".into()),
        routes: vec![(EOG_GET.into(), Route::json(200, &eog_raw()))],
        ..Default::default()
    })
    .await;
    until(|| h.posts().len() == 1, "posted").await;
    h.settled().await;
    assert_eq!(h.gets("/lol-end-of-game/v1/eog-stats-block"), 1);
    assert_eq!(h.posts()[0]["startedAt"], "2026-09-08T16:37:47.672Z");
    h.eog(eog_raw(), LcuEventType::Update).await;
    assert_eq!(h.posts().len(), 1, "the socket copy afterwards is a no-op");
    until(|| h.files().is_empty(), "file gone").await;
}

#[tokio::test]
async fn check_10_a_404_at_connect_posts_nothing_names_backfill_and_never_asks_again() {
    let (logs, _g) = capture_logs();
    let h = setup(Setup {
        phase: Some("WaitingForStats".into()),
        manual_timers: true,
        ..Default::default()
    })
    .await;
    until(|| h.gets("/lol-end-of-game/v1/eog-stats-block") == 1, "one GET").await;
    h.settled().await;
    assert_eq!(logs.count("backfill"), 1);
    assert!(logs.text().contains("WaitingForStats"));
    *h.clock.lock().unwrap() += Duration::from_secs(60);
    assert_eq!(h.scheduler.len(), 0, "nothing scheduled to ask again");
    pause(20).await;
    assert_eq!(h.gets("/lol-end-of-game/v1/eog-stats-block"), 1);
    assert!(h.posts().is_empty());
}

#[tokio::test]
async fn does_not_read_the_block_at_connect_in_any_other_phase() {
    for phase in [
        Some("Lobby"),
        Some("InProgress"),
        Some("None"),
        Some("PreEndOfGame"),
        None,
    ] {
        let h = setup(Setup {
            phase: phase.map(String::from),
            routes: vec![(EOG_GET.into(), Route::json(200, &eog_raw()))],
            ..Default::default()
        })
        .await;
        pause(20).await;
        h.settled().await;
        assert_eq!(h.gets("/lol-end-of-game/v1/eog-stats-block"), 0, "{phase:?}");
        assert!(h.posts().is_empty());
    }
}

#[tokio::test]
async fn reconnecting_after_the_score_screen_is_gone_posts_nothing() {
    let h = setup(Setup {
        phase: Some("EndOfGame".into()),
        ..Default::default()
    })
    .await;
    until(|| h.gets("/lol-end-of-game/v1/eog-stats-block") == 1, "one GET").await;
    h.watcher
        .send(MachineEvent::Disconnected(DisconnectReason::SocketClosed));
    let mut again = (*h.context).clone();
    again.phase = Some("Lobby".into());
    h.watcher.send(MachineEvent::Connected(Arc::new(again)));
    pause(20).await;
    h.settled().await;
    assert_eq!(h.gets("/lol-end-of-game/v1/eog-stats-block"), 1);
    assert!(h.posts().is_empty());
}

// --- the queue ---------------------------------------------------------------------------------------------

#[tokio::test]
async fn check_6_a_422_or_a_403_deletes_the_file_and_names_backfill() {
    for status in [422u16, 403] {
        let (logs, _g) = capture_logs();
        let h = setup(Setup {
            script: vec![game_http(status)],
            ..Default::default()
        })
        .await;
        h.eog(eog_raw(), LcuEventType::Create).await;
        until(|| h.files().is_empty(), "file deleted").await;
        assert_eq!(h.posts().len(), 1);
        let text = logs.text();
        assert!(
            text.contains("refused the game for good") && text.contains("backfill"),
            "{status}"
        );
    }
}

#[tokio::test]
async fn check_6_five_500s_leave_the_file_and_the_fifth_line_names_it() {
    let (logs, _g) = capture_logs();
    let h = setup(Setup {
        script: vec![game_http(500)],
        manual_timers: true,
        ..Default::default()
    })
    .await;
    h.eog(eog_raw(), LcuEventType::Create).await;
    for attempt in 1..5 {
        until(|| h.posts().len() == attempt, "post").await;
        until(|| h.scheduler.len() == attempt, "retry timer").await;
        h.scheduler.get(attempt - 1).fire();
    }
    until(|| h.posts().len() == 5, "fifth post").await;
    h.settled().await;
    assert_eq!(h.files(), [format!("{GAME_TWO}.json")]);
    assert_eq!(
        logs.count("game post failed; the queued copy is kept and retried"),
        5
    );
}

#[tokio::test]
async fn keeps_the_file_on_a_network_error_a_429_and_a_401() {
    for outcome in [
        engine::watchers::game::GamePostOutcome::Network("refused".into()),
        game_http(429),
        game_http(401),
    ] {
        let h = setup(Setup {
            script: vec![outcome.clone()],
            manual_timers: true,
            ..Default::default()
        })
        .await;
        h.eog(eog_raw(), LcuEventType::Create).await;
        until(|| h.scheduler.len() == 1, "retry scheduled").await;
        assert_eq!(h.files(), [format!("{GAME_TWO}.json")], "{outcome:?}");
    }
}

#[tokio::test]
async fn check_5_the_crash_sequence_500_then_killed_then_restart_posts_once() {
    let dir = tempfile::tempdir().unwrap();
    let state = dir.path().join("groups").join("g1");
    let first = setup(Setup {
        script: vec![game_http(500)],
        manual_timers: true,
        state: Some(state.clone()),
        ..Default::default()
    })
    .await;
    first.eog(eog_raw(), LcuEventType::Create).await;
    until(|| !first.posts().is_empty(), "first post").await;
    assert_eq!(first.files(), [format!("{GAME_TWO}.json")]);
    first.watcher.stop();
    first.watcher.stopped().await;

    let second = setup(Setup {
        state: Some(state.clone()),
        connect: false,
        ..Default::default()
    })
    .await;
    until(
        || second.posts().len() == 1 && second.files().is_empty(),
        "replayed",
    )
    .await;
    pause(20).await;
    assert_eq!(second.posts().len(), 1);
    assert_eq!(
        (
            second.posts()[0]["phase"].as_str(),
            second.posts()[0]["gameId"].as_u64()
        ),
        (Some("eog"), Some(GAME_TWO))
    );
    assert_eq!(second.gets("/lol-end-of-game/v1/eog-stats-block"), 0);
    assert_eq!(
        second.view().last_posted.as_ref().map(|l| l.duration_s),
        Some(913),
        "Home's Last game"
    );

    let third = setup(Setup {
        state: Some(state),
        connect: false,
        ..Default::default()
    })
    .await;
    pause(50).await;
    third.settled().await;
    assert!(third.posts().is_empty());
    assert!(third.files().is_empty());
}

#[tokio::test]
async fn check_5_killed_between_capture_and_post_the_file_alone_is_enough() {
    let dir = tempfile::tempdir().unwrap();
    let state = dir.path().join("groups").join("g1");
    // The process dies after the rename and before any answer: the post never completes.
    let first = setup(Setup {
        state: Some(state.clone()),
        ..Default::default()
    })
    .await;
    let _held = first.poster.hold();
    first.watcher.send(eog_event(eog_raw(), LcuEventType::Create));
    until(|| first.posts().len() == 1, "post started").await;
    assert_eq!(first.files(), [format!("{GAME_TWO}.json")]);
    drop(first.watcher);

    let second = setup(Setup {
        state: Some(state),
        script: vec![game_ok(false)],
        connect: false,
        ..Default::default()
    })
    .await;
    until(
        || second.posts().len() == 1 && second.files().is_empty(),
        "replayed",
    )
    .await;
    assert_eq!(second.posts()[0]["gameId"].as_u64(), Some(GAME_TWO));
    assert_eq!(
        second.posts()[0],
        first.poster.posted()[0],
        "the same bytes as the interrupted post"
    );
}

#[tokio::test]
async fn a_0_3_x_queue_file_with_extra_keys_is_posted_verbatim() {
    let dir = tempfile::tempdir().unwrap();
    let state = dir.path().join("groups").join("g1");
    std::fs::create_dir_all(queue_dir(&state)).unwrap();
    let mut payload = golden_body("game--eog--eog-stats-block--observed-start");
    payload["aFieldFromAnOlderEngine"] = json!({ "kept": true });
    payload["participants"][0]["visionScore"] = json!(12);
    let file = json!({ "version": 1, "queuedAt": "2026-09-01T20:00:00.000Z", "payload": payload, "writtenBy": "0.3.2" });
    std::fs::write(
        queue_dir(&state).join(format!("{GAME_TWO}.json")),
        serde_json::to_string(&file).unwrap(),
    )
    .unwrap();
    let h = setup(Setup {
        state: Some(state),
        connect: false,
        ..Default::default()
    })
    .await;
    until(|| h.posts().len() == 1 && h.files().is_empty(), "posted").await;
    assert_eq!(h.posts()[0], payload, "every key the old engine wrote, unchanged");
}

#[tokio::test]
async fn an_unreadable_queue_file_is_quarantined_never_deleted() {
    let dir = tempfile::tempdir().unwrap();
    let state = dir.path().join("groups").join("g1");
    std::fs::create_dir_all(queue_dir(&state)).unwrap();
    std::fs::write(queue_dir(&state).join("4000000001.json"), "{ not json").unwrap();
    let h = setup(Setup {
        state: Some(state.clone()),
        connect: false,
        ..Default::default()
    })
    .await;
    pause(50).await;
    h.settled().await;
    assert!(h.posts().is_empty());
    assert_eq!(
        std::fs::read_to_string(queue_dir(&state).join("quarantine").join("4000000001.json")).unwrap(),
        "{ not json"
    );
}

#[tokio::test]
async fn check_8_a_companion_killed_mid_game_still_lands_the_game_through_the_other() {
    let route = vec![(SESSION_GET.to_string(), session_with("GameStart", |_| {}))];
    let a = setup(Setup {
        routes: route.clone(),
        ..Default::default()
    })
    .await;
    let b = setup(Setup {
        routes: route,
        ..Default::default()
    })
    .await;
    a.phase("GameStart").await;
    b.phase("GameStart").await;
    a.watcher.stop();
    b.eog(eog_raw(), LcuEventType::Create).await;
    until(
        || b.files().is_empty() && b.by_phase("eog").len() == 1,
        "b posted",
    )
    .await;
    assert_eq!(b.by_phase("eog")[0]["startedAt"], "2026-09-08T16:30:00.000Z");
}

#[tokio::test]
async fn check_9_two_companions_one_end_of_game_both_post_and_both_delete() {
    let a = setup(Setup {
        script: vec![game_ok(true)],
        ..Default::default()
    })
    .await;
    let b = setup(Setup {
        script: vec![game_ok(false)],
        ..Default::default()
    })
    .await;
    a.eog(eog_raw(), LcuEventType::Create).await;
    b.eog(eog_raw(), LcuEventType::Create).await;
    until(|| a.files().is_empty() && b.files().is_empty(), "both deleted").await;
    assert_eq!(a.posts(), b.posts());
}

#[tokio::test]
async fn check_12_51_queued_files_the_oldest_quarantined_and_50_posted_oldest_first() {
    let dir = tempfile::tempdir().unwrap();
    let state = dir.path().join("groups").join("g1");
    let template = golden_body("game--eog--eog-stats-block--at-connect");
    for i in 0..51u64 {
        let mut payload = template.clone();
        payload["gameId"] = json!(4000970000u64 + i);
        write_queued(
            &state,
            &(4000970000u64 + i).to_string(),
            &format!("2026-09-08T15:{i:02}:00.000Z"),
            &payload,
        )
        .unwrap();
    }
    let replayable = std::fs::read_dir(queue_dir(&state))
        .unwrap()
        .filter(|e| e.as_ref().unwrap().path().is_file())
        .count();
    assert_eq!(replayable, 50);
    assert!(
        queue_dir(&state)
            .join("quarantine")
            .join("4000970000.json")
            .is_file(),
        "moved, not deleted"
    );
    let h = setup(Setup {
        state: Some(state),
        connect: false,
        ..Default::default()
    })
    .await;
    until(|| h.posts().len() == 50 && h.files().is_empty(), "all posted").await;
    let ids: Vec<u64> = h.posts().iter().map(|p| p["gameId"].as_u64().unwrap()).collect();
    assert_eq!((ids[0], ids[49]), (4000970001, 4000970050));
    assert!(!ids.contains(&4000970000));
}

#[tokio::test]
async fn a_game_posted_in_this_process_is_not_captured_again_even_with_its_file_gone() {
    let h = setup(Setup::default()).await;
    h.eog(eog_raw(), LcuEventType::Create).await;
    until(|| h.files().is_empty(), "posted").await;
    h.eog(eog_raw(), LcuEventType::Update).await;
    assert_eq!(h.posts().len(), 1);
    assert!(h.view().settled_game_ids.contains(&GAME_TWO.to_string()));
}

#[tokio::test]
async fn a_queue_in_one_group_is_invisible_to_another() {
    let dir = tempfile::tempdir().unwrap();
    let one = dir.path().join("groups").join("one");
    let two = dir.path().join("groups").join("two");
    write_queued(
        &one,
        &GAME_TWO.to_string(),
        "2026-09-08T16:53:04.508Z",
        &golden_body("game--eog--eog-stats-block--at-connect"),
    )
    .unwrap();
    let h = setup(Setup {
        state: Some(two),
        connect: false,
        ..Default::default()
    })
    .await;
    pause(50).await;
    h.settled().await;
    assert!(h.posts().is_empty());
    assert!(queue_dir(&one).join(format!("{GAME_TWO}.json")).is_file());
}

#[tokio::test]
async fn the_queue_refuses_a_body_the_server_would_refuse_and_writes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let state = dir.path().join("g");
    let mut payload = golden_body("game--eog--eog-stats-block--at-connect");
    payload["participants"] = json!([]);
    assert!(
        write_queued(
            &state,
            &GAME_TWO.to_string(),
            "2026-09-08T16:53:04.508Z",
            &payload
        )
        .is_err()
    );
    assert!(write_queued(&state, "abc", "2026-09-08T16:53:04.508Z", &payload).is_err());
    assert!(!queue_dir(&state).join(format!("{GAME_TWO}.json")).exists());
}

// --- the stale-partyId fix (decision row 2026-10-04) --------------------------------------------------------

#[tokio::test]
async fn a_lobby_delete_clears_the_held_party_but_a_started_game_keeps_its_own() {
    let h = setup(Setup {
        script: vec![game_ok(false)],
        routes: vec![(SESSION_GET.into(), session_with("GameStart", |_| {}))],
        ..Default::default()
    })
    .await;
    h.lobby(Some(body("16.17", "lobby")));
    h.phase("GameStart").await;
    // The Delete that follows GameStart: the game keeps the party it captured.
    h.lobby(None);
    h.phase("InProgress").await;
    assert_eq!(h.by_phase("in_progress")[0]["partyId"], PARTY);
    assert_eq!(h.view().party_id, None);
    // Next game, no lobby event in between (the TS engine carried the dead party here).
    h.phase("EndOfGame").await;
    h.phase("None").await;
    h.fake.set_route(
        SESSION_GET,
        session_with("GameStart", |s| s["gameData"]["gameId"] = json!(4000970123u64)),
    );
    h.phase("GameStart").await;
    let posts = h.by_phase("in_progress");
    assert_eq!(posts.len(), 2);
    assert_eq!(
        posts[1]["partyId"],
        Value::Null,
        "no stale party on a game whose lobby was never seen"
    );
}

#[tokio::test]
async fn a_disconnect_clears_the_held_party() {
    let h = setup(Setup {
        script: vec![game_ok(false)],
        routes: vec![(SESSION_GET.into(), session_with("GameStart", |_| {}))],
        ..Default::default()
    })
    .await;
    h.lobby(Some(body("16.17", "lobby")));
    h.settled().await;
    assert_eq!(h.view().party_id.as_deref(), Some(PARTY));
    h.watcher
        .send(MachineEvent::Disconnected(DisconnectReason::ClientLost));
    h.watcher.send(MachineEvent::Connected(h.context.clone()));
    h.phase("GameStart").await;
    assert_eq!(h.by_phase("in_progress")[0]["partyId"], Value::Null);
}

// --- goldens ----------------------------------------------------------------------------------------------------

#[tokio::test]
async fn golden_in_progress_and_eog_observed_start_and_the_queue_file() {
    let h = setup(Setup {
        script: vec![game_ok(false), game_http(503)],
        manual_timers: true,
        routes: vec![(
            SESSION_GET.into(),
            Route::json(200, &body("16.17", "gameflow-session")),
        )],
        ..Default::default()
    })
    .await;
    h.set_clock("2026-09-08T16:37:38.903Z");
    h.lobby(Some(body("16.17", "lobby")));
    h.phase("GameStart").await;
    h.set_clock("2026-09-08T16:37:38.920Z");
    h.phase("InProgress").await;
    h.set_clock("2026-09-08T16:53:04.508Z");
    h.eog(eog_raw(), LcuEventType::Create).await;
    let posts = h.posts();
    assert_eq!(posts.len(), 2);
    assert_eq!(posts[0], golden_body("game--in-progress--gameflow-session"));
    assert_eq!(
        posts[1],
        golden_body("game--eog--eog-stats-block--observed-start")
    );
    let file: Value = serde_json::from_str(
        &std::fs::read_to_string(queue_dir(&h.state).join(format!("{GAME_TWO}.json"))).unwrap(),
    )
    .unwrap();
    let golden: Value = serde_json::from_str(
        &std::fs::read_to_string(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/goldens/queue-file--eog-stats-block.json"),
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(file, golden["file"]);
}

#[tokio::test]
async fn golden_eog_at_connect() {
    let h = setup(Setup {
        phase: Some("EndOfGame".into()),
        routes: vec![(EOG_GET.into(), Route::json(200, &eog_raw()))],
        ..Default::default()
    })
    .await;
    until(|| h.posts().len() == 1, "posted").await;
    assert_eq!(
        h.posts()[0],
        golden_body("game--eog--eog-stats-block--at-connect")
    );
}

struct NoProcesses;
impl ProcessLister for NoProcesses {
    async fn list(&self) -> ProcessList {
        ProcessList::Listed(Vec::new())
    }
}

#[tokio::test]
async fn the_recorded_evening_through_the_machine_gives_the_golden_game_posts() {
    let golden: Value = serde_json::from_str(
        &std::fs::read_to_string(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/goldens/sequence--ws-events.json"),
        )
        .unwrap(),
    )
    .unwrap();
    let expected: Vec<Value> = golden["requests"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|r| r["route"] == "game")
        .map(|r| r["body"].clone())
        .collect();
    assert_eq!(expected.len(), 3);

    let pki: Arc<Pki> = Arc::new(pki("Fake Riot Root"));
    let fake = start_fake_client(
        &pki,
        HashMap::from([
            (
                "GET /lol-patch/v1/game-version".into(),
                Route::json(
                    200,
                    &json!(
                        "16.17.8104348+branch.releases-16-17.code.public.content.release.anticheat.vanguard"
                    ),
                ),
            ),
            (
                "GET /lol-summoner/v1/current-summoner".into(),
                Route::json(200, &body("16.17", "current-summoner")),
            ),
            (
                "GET /lol-gameflow/v1/gameflow-phase".into(),
                Route::json(200, &json!("Lobby")),
            ),
        ]),
    )
    .await;
    let dir = tempfile::tempdir().unwrap();
    let clock = Arc::new(Mutex::new(ms("2026-09-08T16:33:00.000Z")));
    let reading = clock.clone();
    let poster = ScriptedGamePoster::new(vec![game_ok(true)]);
    let watcher = spawn_game_watcher(
        poster.clone(),
        GameWatcherOptions {
            state_dir: dir.path().join("g"),
            clock: Arc::new(move || *reading.lock().unwrap()),
            scheduler: Arc::new(TokioScheduler),
            backoff: BackoffOptions::new(Duration::from_millis(10), Duration::from_millis(30)),
            max_queued: MAX_QUEUED_GAMES,
        },
    );
    let lockfile = dir.path().join("lockfile");
    std::fs::write(
        &lockfile,
        format!("LeagueClient:4242:{}:{PASSWORD}:https", fake.port),
    )
    .unwrap();
    let discover = ConfiguredDiscovery {
        discovery: Discovery::new(NoProcesses, FsReader),
        inputs: Box::new(move || DiscoveryInputs {
            saved_lockfile_path: Some(lockfile.clone()),
            ..Default::default()
        }),
    };
    let options = MachineOptions {
        poll_interval: Duration::from_millis(40),
        request_timeout: Duration::from_secs(2),
        ..Default::default()
    };
    let verifier_pki = pki.clone();
    let machine = spawn_machine(
        discover,
        Arc::new(move || Ok(verifier_pki.verifier())),
        options,
        vec![watcher.feed()],
    );
    assert!(
        machine
            .wait_for_state(MachineState::Watching, Duration::from_secs(5))
            .await
    );
    fake.wait_for_sockets(1).await;
    assert!(watcher.settled(SETTLE).await);

    let text = std::fs::read_to_string(fixtures_dir().join("16.17/ws-events.ndjson")).unwrap();
    let routed = [LOBBY_URI, PHASE_URI, EOG_URI];
    let mut delivered = watcher.view().borrow().processed;
    for line in text.lines().filter(|l| !l.is_empty()) {
        let record: Value = serde_json::from_str(line).unwrap();
        if record.get("dropped").is_some() || record.get("redacted").is_some() {
            continue;
        }
        *clock.lock().unwrap() = ms(record["ts"].as_str().unwrap());
        let uri = record["uri"].as_str().unwrap();
        if uri == SESSION_URI && record["eventType"] != "Delete" {
            fake.set_route(SESSION_GET, Route::json(200, &record["data"]));
        }
        fake.emit(uri, record["eventType"].as_str().unwrap(), record["data"].clone());
        if routed.contains(&uri) {
            delivered += 1;
            let target = delivered;
            let mut view = watcher.view();
            tokio::time::timeout(Duration::from_secs(5), view.wait_for(|v| v.processed >= target))
                .await
                .unwrap()
                .unwrap();
            assert!(watcher.settled(SETTLE).await);
        }
    }
    until(|| poster.posted().len() == 3, "three game posts").await;
    assert!(watcher.settled(SETTLE).await);
    let posted = poster.posted();
    for (i, (got, want)) in posted.iter().zip(&expected).enumerate() {
        assert_eq!(got, want, "game post {i} differs from the golden");
    }
    assert_eq!(posted.len(), 3);
    machine.stop().await;
}
