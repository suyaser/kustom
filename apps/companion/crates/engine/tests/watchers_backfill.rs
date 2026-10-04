//! Backfill (port of `backfill.test.ts`, M17.11) against the fake League client (list pages and details from
//! the 16.17 fixtures), a fake scan API, and the real game watcher's queue in a temp dir. The scan body and the
//! posted game body are the TypeScript engine's goldens, JSON-equal.

#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

mod support;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use engine::lcu::LcuClient;
use engine::lcu::events::RoutedEvent;
use engine::lcu::types::Summoner;
use engine::watchers::backfill::{
    BackfillCache, BackfillHandle, BackfillOptions, BackfillSink, PassEnd, ScanOutcome, spawn_backfill,
};
use engine::watchers::connection::{ConnectedContext, DisconnectReason, MachineEvent};
use engine::watchers::game::{EnqueueOutcome, GameWatcherOptions, spawn_game_watcher};
use serde_json::{Value, json};
use support::fake_client::{FakeClient, Route, start_fake_client};
use support::watch_kit::{ManualScheduler, ScriptedGamePoster, game_ok, until};
use support::{body, credentials, golden_body, pki};

const OWN: &str = "34151cbd-d9f8-5dad-9dc8-c6a8e253c0de";
const ABORTED: u64 = 4_000_965_483;
const DETAIL_GAME: u64 = 4_000_769_615;
const SETTLE: Duration = Duration::from_secs(10);
const SIX_HOURS: Duration = Duration::from_secs(6 * 60 * 60);
const TEN_MINUTES: Duration = Duration::from_secs(10 * 60);

fn list_path(beg: u32) -> String {
    format!(
        "/lol-match-history/v1/products/lol/{OWN}/matches?begIndex={beg}&endIndex={}",
        beg + 20
    )
}

fn detail_path(id: u64) -> String {
    format!("/lol-match-history/v1/games/{id}")
}

fn history() -> Value {
    body("16.17", "match-history")
}

fn fixture_customs() -> Vec<u64> {
    history()["games"]["games"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|g| g["gameType"] == "CUSTOM_GAME" && g["endOfGameResult"] == "GameComplete")
        .map(|g| g["gameId"].as_u64().unwrap())
        .collect()
}

fn custom_entry(id: u64) -> Value {
    let mut entry = history()["games"]["games"]
        .as_array()
        .unwrap()
        .iter()
        .find(|g| g["gameId"] == DETAIL_GAME)
        .unwrap()
        .clone();
    entry["gameId"] = json!(id);
    entry["gameCreation"] = json!(1_788_000_000_000u64 + id);
    entry
}

fn page(games: Vec<Value>, beg: u32) -> Route {
    let mut base = history();
    base["games"]["gameCount"] = json!(games.len());
    base["games"]["gameIndexBegin"] = json!(beg);
    base["games"]["gameIndexEnd"] = json!(beg + 20);
    base["games"]["games"] = Value::Array(games);
    Route::json(200, &base)
}

fn detail_for(id: u64, edit: impl FnOnce(&mut Value)) -> Route {
    let mut detail = body("16.17", "match-detail");
    detail["gameId"] = json!(id);
    edit(&mut detail);
    Route::json(200, &detail)
}

/// The fixture list (21 games) as page 0, then a 404 page 20: the end of what the client gives.
fn fixture_routes() -> HashMap<String, Route> {
    HashMap::from([(format!("GET {}", list_path(0)), Route::json(200, &history()))])
}

#[derive(Default)]
struct FakeScanner {
    script: Mutex<Vec<ScanOutcome>>,
    batches: Mutex<Vec<Vec<u64>>>,
}

impl FakeScanner {
    fn answering(script: Vec<ScanOutcome>) -> Arc<Self> {
        Arc::new(Self {
            script: Mutex::new(script),
            batches: Mutex::default(),
        })
    }
    fn batches(&self) -> Vec<Vec<u64>> {
        self.batches.lock().unwrap().clone()
    }
}

impl engine::watchers::backfill::BackfillScanner for FakeScanner {
    async fn scan(&self, game_ids: Vec<u64>) -> ScanOutcome {
        self.batches.lock().unwrap().push(game_ids.clone());
        let mut script = self.script.lock().unwrap();
        let next = if script.len() > 1 {
            script.remove(0)
        } else {
            script
                .first()
                .cloned()
                .unwrap_or(ScanOutcome::Unknown(Vec::new()))
        };
        match next {
            // `All` stands for "every id of the batch is unknown".
            ScanOutcome::Unknown(ids) if ids == [0] => ScanOutcome::Unknown(game_ids),
            other => other,
        }
    }
}

fn all_unknown() -> ScanOutcome {
    ScanOutcome::Unknown(vec![0])
}

#[derive(Default)]
struct RecordingSink {
    payloads: Mutex<Vec<Value>>,
    refuse: Mutex<bool>,
}

impl BackfillSink for RecordingSink {
    async fn enqueue(&self, payload: Value) -> EnqueueOutcome {
        if *self.refuse.lock().unwrap() {
            return EnqueueOutcome::Refused;
        }
        let mut payloads = self.payloads.lock().unwrap();
        if payloads.iter().any(|p| p["gameId"] == payload["gameId"]) {
            return EnqueueOutcome::Duplicate;
        }
        payloads.push(payload);
        EnqueueOutcome::Queued
    }
}

impl RecordingSink {
    fn ids(&self) -> Vec<u64> {
        self.payloads
            .lock()
            .unwrap()
            .iter()
            .map(|p| p["gameId"].as_u64().unwrap())
            .collect()
    }
}

struct Harness {
    fake: FakeClient,
    context: Arc<ConnectedContext>,
    scanner: Arc<FakeScanner>,
    sink: Arc<RecordingSink>,
    backfill: BackfillHandle,
    scheduler: Arc<ManualScheduler>,
    dir: tempfile::TempDir,
}

struct Setup {
    routes: HashMap<String, Route>,
    scan: Vec<ScanOutcome>,
    phase: &'static str,
    summoner: bool,
    edit: fn(&mut BackfillOptions),
}

impl Default for Setup {
    fn default() -> Self {
        Self {
            routes: fixture_routes(),
            scan: vec![all_unknown()],
            phase: "None",
            summoner: true,
            edit: |_| {},
        }
    }
}

async fn setup(s: Setup) -> Harness {
    let pki = pki("Fake Riot Root");
    let fake = start_fake_client(&pki, s.routes).await;
    let summoner: Summoner = serde_json::from_value(body("16.17", "current-summoner")).unwrap();
    let context = Arc::new(ConnectedContext {
        client: LcuClient::with_verifier(&credentials(fake.port), pki.verifier(), Duration::from_secs(2))
            .unwrap(),
        version: "16.17.1".into(),
        patch: Some("16.17".into()),
        summoner: s.summoner.then_some(summoner),
        phase: Some(s.phase.into()),
        port: fake.port,
    });
    let dir = tempfile::tempdir().unwrap();
    let scheduler = Arc::new(ManualScheduler::default());
    let mut options = BackfillOptions::new(dir.path().join("g"));
    options.scheduler = scheduler.clone();
    options.detail_interval = Duration::from_millis(1);
    (s.edit)(&mut options);
    let scanner = FakeScanner::answering(s.scan);
    let sink = Arc::new(RecordingSink::default());
    let backfill = spawn_backfill(scanner.clone(), sink.clone(), options);
    Harness {
        fake,
        context,
        scanner,
        sink,
        backfill,
        scheduler,
        dir,
    }
}

impl Harness {
    async fn connect(&self) {
        self.backfill.send(MachineEvent::Connected(self.context.clone()));
        assert!(self.backfill.settled(SETTLE).await);
    }
    async fn pass(&self) -> engine::watchers::backfill::PassSummary {
        self.backfill.run_now().await.unwrap()
    }
    fn phase(&self, phase: &str) {
        self.backfill
            .send(MachineEvent::Event(Arc::new(RoutedEvent::GameflowPhase(
                phase.into(),
            ))));
    }
    fn list_gets(&self) -> Vec<String> {
        self.fake
            .requests
            .lock()
            .unwrap()
            .iter()
            .filter(|r| r.path.contains("/matches?"))
            .map(|r| r.path.clone())
            .collect()
    }
    fn detail_gets(&self) -> usize {
        self.fake
            .requests
            .lock()
            .unwrap()
            .iter()
            .filter(|r| r.path.starts_with("/lol-match-history/v1/games/"))
            .count()
    }
    fn scheduled(&self) -> Option<Duration> {
        self.backfill.view().borrow().scheduled
    }
}

#[tokio::test]
async fn arms_the_first_pass_60_s_after_the_first_connect_and_only_once() {
    let h = setup(Setup::default()).await;
    h.connect().await;
    assert_eq!(h.scheduled(), Some(Duration::from_secs(60)));
    h.backfill
        .send(MachineEvent::Disconnected(DisconnectReason::ClientLost));
    h.connect().await;
    assert_eq!(h.scheduler.len(), 1, "a reconnect does not re-arm");
    assert!(h.fake.requests.lock().unwrap().is_empty());
    // The timer runs a pass.
    h.scheduler.get(0).fire();
    until(|| !h.backfill.view().borrow().passes.is_empty(), "a pass").await;
}

#[tokio::test]
async fn walks_the_fixture_list_and_scans_its_golden_body_check_1() {
    let h = setup(Setup {
        scan: vec![ScanOutcome::Unknown(Vec::new())],
        ..Default::default()
    })
    .await;
    h.connect().await;
    let summary = h.pass().await;
    assert_eq!(
        h.list_gets(),
        [list_path(0), list_path(20)],
        "page 0, then the 404 page 20 is the end"
    );
    let golden = golden_body("backfill-scan--match-history");
    assert_eq!(json!({ "gameIds": h.scanner.batches()[0] }), golden);
    assert_eq!(h.scanner.batches()[0], fixture_customs());
    assert_eq!(summary.end, PassEnd::Done);
    assert!(summary.walk_ended);
    let cache = h.backfill.cache();
    assert!(
        cache.known_game_ids.contains(&ABORTED),
        "the abort is remembered as handled"
    );
    assert_eq!(cache.resume_beg_index, None);
    // The steady state: the next pass reads page 0 only and scans nothing.
    h.pass().await;
    assert_eq!(h.list_gets().len(), 3);
    assert_eq!(h.scanner.batches().len(), 1);
}

#[tokio::test]
async fn fetches_only_unknown_ids_and_the_posted_body_is_the_golden_check_4() {
    let mut routes = fixture_routes();
    routes.insert(
        format!("GET {}", detail_path(DETAIL_GAME)),
        Route::json(200, &body("16.17", "match-detail")),
    );
    let h = setup(Setup {
        routes,
        scan: vec![ScanOutcome::Unknown(vec![DETAIL_GAME])],
        ..Default::default()
    })
    .await;
    // The real queue: the body that reaches the API.
    let poster = ScriptedGamePoster::new(vec![game_ok(true)]);
    let game = spawn_game_watcher(poster.clone(), GameWatcherOptions::new(h.dir.path().join("g")));
    let real = spawn_backfill(
        h.scanner.clone(),
        Arc::new(game.enqueuer()),
        BackfillOptions {
            scheduler: h.scheduler.clone(),
            ..BackfillOptions::new(h.dir.path().join("g"))
        },
    );
    real.send(MachineEvent::Connected(h.context.clone()));
    let summary = real.run_now().await.unwrap();
    assert_eq!(
        (summary.fetched, summary.queued, summary.end),
        (1, 1, PassEnd::Done)
    );
    assert_eq!(h.detail_gets(), 1);
    until(|| poster.posted().len() == 1, "the queued backfill posted").await;
    let posted = poster.posted()[0].clone();
    assert_eq!(posted, golden_body("game--backfill--match-detail"));
    assert!(posted.get("partyId").is_none());
    let file: Value =
        serde_json::from_str(&std::fs::read_to_string(h.dir.path().join("g/backfill.json")).unwrap())
            .unwrap();
    assert!(
        file["knownGameIds"]
            .as_array()
            .unwrap()
            .contains(&json!(DETAIL_GAME))
    );
    assert!(!h.dir.path().join("g/backfill.json.tmp").exists());
    let parsed: BackfillCache = serde_json::from_value(file.clone()).unwrap();
    assert_eq!(parsed.version, 2);
    let keys: Vec<&String> = file.as_object().unwrap().keys().collect();
    assert_eq!(
        keys,
        [
            "version",
            "lastRunAt",
            "deepestBegIndex",
            "knownGameIds",
            "pendingGameIds",
            "resumeBegIndex"
        ]
    );
}

#[tokio::test]
async fn pages_in_steps_of_20_at_most_5_a_pass_and_resumes_the_deep_walk() {
    let mut routes = HashMap::new();
    let mut next = 1_000u64;
    for p in 0..7u32 {
        let games: Vec<Value> = (0..21)
            .map(|_| {
                next += 1;
                custom_entry(next)
            })
            .collect();
        routes.insert(format!("GET {}", list_path(p * 20)), page(games, p * 20));
    }
    routes.insert(
        format!("GET {}", list_path(140)),
        page(vec![custom_entry(9_999)], 140),
    );
    let h = setup(Setup {
        routes,
        scan: vec![ScanOutcome::Unknown(Vec::new())],
        ..Default::default()
    })
    .await;
    h.connect().await;
    let first = h.pass().await;
    assert_eq!(first.pages, 5);
    assert_eq!(first.end, PassEnd::More);
    assert_eq!(h.backfill.cache().resume_beg_index, Some(100));
    assert_eq!(h.scheduled(), Some(TEN_MINUTES));
    let second = h.pass().await;
    assert_eq!(
        h.list_gets()[5..],
        [list_path(100), list_path(120), list_path(140)]
    );
    assert!(second.walk_ended);
    assert_eq!(second.deepest_beg_index, 140);
    assert_eq!(h.backfill.cache().resume_beg_index, None);
    assert_eq!(second.end, PassEnd::Done);
    assert_eq!(h.scheduled(), Some(SIX_HOURS));
}

#[tokio::test]
async fn never_asks_past_the_depth_cap() {
    let mut routes = HashMap::new();
    for p in 0..3u32 {
        let games: Vec<Value> = (0..21)
            .map(|i| custom_entry(u64::from(p) * 100 + i + 1))
            .collect();
        routes.insert(format!("GET {}", list_path(p * 20)), page(games, p * 20));
    }
    let h = setup(Setup {
        routes,
        scan: vec![ScanOutcome::Unknown(Vec::new())],
        edit: |o| o.max_depth = 40,
        ..Default::default()
    })
    .await;
    h.connect().await;
    let summary = h.pass().await;
    assert_eq!(h.list_gets(), [list_path(0), list_path(20)]);
    assert!(summary.walk_ended);
}

#[tokio::test]
async fn gives_the_deep_cursor_up_after_three_passes_stuck_on_one_page() {
    let mut routes = HashMap::new();
    routes.insert(
        format!("GET {}", list_path(0)),
        page((1..=21).map(custom_entry).collect(), 0),
    );
    routes.insert(
        format!("GET {}", list_path(20)),
        Route::json(500, &json!({ "message": "boom" })),
    );
    let h = setup(Setup {
        routes,
        scan: vec![ScanOutcome::Unknown(Vec::new())],
        ..Default::default()
    })
    .await;
    h.connect().await;
    for _ in 0..2 {
        assert_eq!(h.pass().await.end, PassEnd::More);
    }
    assert_eq!(h.backfill.cache().resume_beg_index, Some(20));
    h.pass().await;
    assert_eq!(
        h.backfill.cache().resume_beg_index,
        None,
        "the third strike gives the cursor up"
    );
}

#[tokio::test]
async fn a_page_error_stops_the_walk_and_comes_back_in_10_min() {
    let routes = HashMap::from([(format!("GET {}", list_path(0)), Route::json(500, &json!({})))]);
    let h = setup(Setup {
        routes,
        ..Default::default()
    })
    .await;
    h.connect().await;
    let summary = h.pass().await;
    assert_eq!((summary.end, summary.pages), (PassEnd::More, 1));
    assert_eq!(h.scheduled(), Some(TEN_MINUTES));
    assert!(h.scanner.batches().is_empty());
}

#[tokio::test]
async fn a_403_is_one_sentence_a_stop_and_a_retry_in_6_h() {
    let h = setup(Setup {
        scan: vec![ScanOutcome::Refused],
        ..Default::default()
    })
    .await;
    h.connect().await;
    let summary = h.pass().await;
    assert_eq!(summary.end, PassEnd::Refused);
    assert_eq!(h.scheduled(), Some(SIX_HOURS));
    assert_eq!(h.detail_gets(), 0);
}

#[tokio::test]
async fn the_api_down_is_a_retry_in_10_min_and_the_ids_wait_in_the_cache() {
    let h = setup(Setup {
        scan: vec![ScanOutcome::Failed("no answer".into())],
        ..Default::default()
    })
    .await;
    h.connect().await;
    let summary = h.pass().await;
    assert_eq!(summary.end, PassEnd::ScanFailed);
    assert_eq!(h.scheduled(), Some(TEN_MINUTES));
    assert_eq!(h.backfill.cache().pending_game_ids, fixture_customs());
}

#[tokio::test]
async fn forty_unknown_ids_twenty_details_a_pass_spaced_and_the_rest_next_pass_check_8() {
    let ids: Vec<u64> = (1..=40).collect();
    let mut routes = HashMap::new();
    routes.insert(
        format!("GET {}", list_path(0)),
        page(ids[..20].iter().map(|i| custom_entry(*i)).collect(), 0),
    );
    routes.insert(
        format!("GET {}", list_path(20)),
        page(ids[20..].iter().map(|i| custom_entry(*i)).collect(), 20),
    );
    for id in &ids {
        routes.insert(format!("GET {}", detail_path(*id)), detail_for(*id, |_| {}));
    }
    let h = setup(Setup {
        routes,
        edit: |o| o.detail_interval = Duration::from_millis(15),
        ..Default::default()
    })
    .await;
    h.connect().await;
    let started = Instant::now();
    let first = h.pass().await;
    assert_eq!((first.fetched, first.queued, first.end), (20, 20, PassEnd::More));
    assert!(
        started.elapsed() >= Duration::from_millis(19 * 15),
        "{:?}",
        started.elapsed()
    );
    assert_eq!(h.backfill.cache().pending_game_ids.len(), 20);
    let second = h.pass().await;
    assert_eq!((second.fetched, second.queued), (20, 20));
    let mut queued = h.sink.ids();
    queued.sort_unstable();
    assert_eq!(queued, ids);
}

#[tokio::test]
async fn zero_client_requests_while_not_idle_and_put_back_10_min() {
    for phase in ["InProgress", "ChampSelect", "EndOfGame"] {
        let h = setup(Setup {
            phase,
            ..Default::default()
        })
        .await;
        h.connect().await;
        let summary = h.pass().await;
        assert_eq!(summary.end, PassEnd::NoClient);
        assert!(h.fake.requests.lock().unwrap().is_empty(), "{phase}");
        assert_eq!(h.scheduled(), Some(TEN_MINUTES));
    }
}

#[tokio::test]
async fn pauses_where_it_stands_when_the_phase_changes_mid_fetch() {
    let mut routes = HashMap::new();
    routes.insert(
        format!("GET {}", list_path(0)),
        page((1..=5).map(custom_entry).collect(), 0),
    );
    for id in 1..=5u64 {
        routes.insert(
            format!("GET {}", detail_path(id)),
            detail_for(id, |_| {}).delayed(Duration::from_millis(60)),
        );
    }
    let h = setup(Setup {
        routes,
        ..Default::default()
    })
    .await;
    h.connect().await;
    let run = h.backfill.run_now();
    let phase = async {
        until(|| h.detail_gets() == 1, "first detail asked").await;
        h.phase("ChampSelect");
    };
    let (summary, ()) = tokio::join!(run, phase);
    let summary = summary.unwrap();
    assert_eq!(summary.end, PassEnd::Paused);
    assert_eq!(h.detail_gets(), 1);
    assert_eq!(h.backfill.cache().pending_game_ids, [2, 3, 4, 5]);
    // Back to the lobby: the rest lands.
    h.phase("Lobby");
    let next = h.pass().await;
    assert_eq!(next.queued, 4);
}

#[tokio::test]
async fn a_disconnect_mid_pass_stops_it_and_the_next_connect_picks_up_the_rest() {
    let mut routes = HashMap::new();
    routes.insert(
        format!("GET {}", list_path(0)),
        page((1..=3).map(custom_entry).collect(), 0),
    );
    for id in 1..=3u64 {
        routes.insert(
            format!("GET {}", detail_path(id)),
            detail_for(id, |_| {}).delayed(Duration::from_millis(60)),
        );
    }
    let h = setup(Setup {
        routes,
        ..Default::default()
    })
    .await;
    h.connect().await;
    let run = h.backfill.run_now();
    let drop = async {
        until(|| h.detail_gets() == 1, "first detail").await;
        h.backfill
            .send(MachineEvent::Disconnected(DisconnectReason::ClientLost));
    };
    let (summary, ()) = tokio::join!(run, drop);
    assert_eq!(summary.unwrap().end, PassEnd::Paused);
    h.connect().await;
    let next = h.pass().await;
    let mut queued = h.sink.ids();
    queued.sort_unstable();
    assert_eq!(queued, [1, 2, 3]);
    assert_eq!(next.end, PassEnd::Done);
}

#[tokio::test]
async fn drops_no_winner_nine_participants_and_a_bad_schema_and_remembers_them() {
    let mut routes = HashMap::new();
    routes.insert(
        format!("GET {}", list_path(0)),
        page((1..=3).map(custom_entry).collect(), 0),
    );
    routes.insert(
        format!("GET {}", detail_path(1)),
        detail_for(1, |d| {
            for team in d["teams"].as_array_mut().unwrap() {
                team["win"] = json!("Fail");
            }
        }),
    );
    routes.insert(
        format!("GET {}", detail_path(2)),
        detail_for(2, |d| {
            d["participants"].as_array_mut().unwrap().pop();
        }),
    );
    routes.insert(
        format!("GET {}", detail_path(3)),
        detail_for(3, |d| d["participants"] = json!("nope")),
    );
    let h = setup(Setup {
        routes,
        ..Default::default()
    })
    .await;
    h.connect().await;
    let summary = h.pass().await;
    assert_eq!(
        (summary.dropped, summary.queued, summary.end),
        (3, 0, PassEnd::Done)
    );
    let cache = h.backfill.cache();
    for id in 1..=3 {
        assert!(cache.known_game_ids.contains(&id));
    }
    assert!(cache.pending_game_ids.is_empty());
}

#[tokio::test]
async fn a_queue_refusal_leaves_the_id_pending_and_it_lands_next_pass() {
    let mut routes = HashMap::new();
    routes.insert(format!("GET {}", list_path(0)), page(vec![custom_entry(7)], 0));
    routes.insert(format!("GET {}", detail_path(7)), detail_for(7, |_| {}));
    let h = setup(Setup {
        routes,
        ..Default::default()
    })
    .await;
    h.connect().await;
    *h.sink.refuse.lock().unwrap() = true;
    let first = h.pass().await;
    assert_eq!(first.end, PassEnd::More);
    assert_eq!(h.backfill.cache().pending_game_ids, [7]);
    *h.sink.refuse.lock().unwrap() = false;
    let second = h.pass().await;
    assert_eq!((second.queued, second.end), (1, PassEnd::Done));
    assert_eq!(h.sink.ids(), [7]);
}

#[tokio::test]
async fn stop_cancels_the_timer_and_no_pass_runs_afterwards() {
    let h = setup(Setup::default()).await;
    h.connect().await;
    h.backfill.stop();
    h.backfill.stopped().await;
    assert!(h.scheduler.get(0).is_cancelled());
    h.scheduler.get(0).fire();
    tokio::time::sleep(Duration::from_millis(20)).await;
    assert!(h.fake.requests.lock().unwrap().is_empty());
    assert!(h.backfill.run_now().await.is_none());
}

#[tokio::test]
async fn a_connect_with_no_local_player_does_nothing() {
    let h = setup(Setup {
        summoner: false,
        ..Default::default()
    })
    .await;
    h.connect().await;
    assert_eq!(h.pass().await.end, PassEnd::NoClient);
    assert!(h.fake.requests.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_bad_cache_file_is_an_empty_cache() {
    let h = setup(Setup::default()).await;
    std::fs::create_dir_all(h.dir.path().join("g")).unwrap();
    std::fs::write(
        h.dir.path().join("g/backfill.json"),
        r#"{"version":1,"knownGameIds":[1]}"#,
    )
    .unwrap();
    assert_eq!(h.backfill.cache(), BackfillCache::empty());
}

#[test]
fn map_match_detail_reports_every_unmapped_timeline_pair_and_leaves_roles_null_m5_18() {
    let raw = body("16.17", "match-detail");
    let detail: engine::lcu::types::MatchDetail = serde_json::from_value(raw.clone()).unwrap();
    let mut pairs = Vec::new();
    let payload = engine::lcu::mapper::map_match_detail(&detail, &raw, |pair| pairs.push(pair));
    assert_eq!(payload.participants.len(), 10);
    assert!(payload.participants.iter().all(|p| p.role.is_none()));
    assert_eq!(
        pairs.len(),
        10,
        "the 16.17 table is empty: every participant is reported"
    );
    assert!(pairs.iter().all(|p| p.key.contains('+')));
    assert_eq!(payload.party_id, None);
}
