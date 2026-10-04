//! The connection machine against the fake League client (port of `apps/companion/src/connection.test.ts`,
//! case for case; the TS hint case becomes the `NotRunning` status the window shows). No live client: the
//! lockfile is a temp file pointing at the fake, read through M17.5's discovery as a saved `lockfilePath`.

#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

mod support;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use engine::backoff::BackoffOptions;
use engine::lcu::discovery::{Discovery, DiscoveryInputs, FsReader};
use engine::lcu::events::{LcuEventType, RoutedEvent};
use engine::lcu::process::{ProcessList, ProcessLister};
use engine::watchers::connection::WatcherFeed;
use engine::watchers::connection::{
    ConfiguredDiscovery, ConnectedContext, DisconnectReason, LeagueStatus, MachineEvent, MachineHandle,
    MachineOptions, MachineState, Trigger, spawn_machine,
};
use serde_json::{Value, json};
use support::fake_client::{FakeClient, Route, start_fake_client};
use support::watch_kit::{capture_logs, pause, until};
use support::{PASSWORD, Pki, body, fixtures_dir, pki};
use tokio::sync::mpsc;

const PUUID: &str = "11111111-2222-3333-4444-555555555555";
const SECOND: Duration = Duration::from_secs(5);

struct NoProcesses;
impl ProcessLister for NoProcesses {
    async fn list(&self) -> ProcessList {
        ProcessList::Listed(Vec::new())
    }
}

fn base_routes() -> HashMap<String, Route> {
    HashMap::from([
        (
            "GET /lol-patch/v1/game-version".into(),
            Route::json(
                200,
                &json!("16.17.8104348+branch.releases-16-17.code.public.content.release.anticheat.vanguard"),
            ),
        ),
        (
            "GET /lol-summoner/v1/current-summoner".into(),
            Route::json(
                200,
                &json!({ "puuid": PUUID, "summonerId": 7, "gameName": "Test Name", "tagLine": "EUNE", "accountId": 1 }),
            ),
        ),
        (
            "GET /lol-gameflow/v1/gameflow-phase".into(),
            Route::json(200, &json!("None")),
        ),
    ])
}

#[derive(Default)]
struct Recorded {
    connected: Vec<Arc<ConnectedContext>>,
    events: Vec<Arc<RoutedEvent>>,
    disconnected: Vec<DisconnectReason>,
}

struct Harness {
    fake: FakeClient,
    _dir: tempfile::TempDir,
    lockfile: PathBuf,
    record: Arc<Mutex<Recorded>>,
    machine: MachineHandle,
}

impl Harness {
    fn write_lockfile(&self, port: u16) {
        std::fs::write(
            &self.lockfile,
            format!("LeagueClient:4242:{port}:{PASSWORD}:https"),
        )
        .unwrap();
    }

    fn connected(&self) -> usize {
        self.record.lock().unwrap().connected.len()
    }

    fn events(&self) -> Vec<Arc<RoutedEvent>> {
        self.record.lock().unwrap().events.clone()
    }

    fn disconnected(&self) -> Vec<DisconnectReason> {
        self.record.lock().unwrap().disconnected.clone()
    }

    fn phases(&self) -> Vec<String> {
        self.events()
            .iter()
            .filter_map(|e| match e.as_ref() {
                RoutedEvent::GameflowPhase(p) => Some(p.clone()),
                _ => None,
            })
            .collect()
    }

    async fn watching(&self) {
        assert!(
            self.machine.wait_for_state(MachineState::Watching, SECOND).await,
            "never reached watching"
        );
    }
}

async fn start(
    routes: HashMap<String, Route>,
    lockfile_port: Option<u16>,
    request_timeout: Duration,
) -> Harness {
    start_with(routes, lockfile_port, request_timeout, Vec::new()).await
}

async fn start_with(
    routes: HashMap<String, Route>,
    lockfile_port: Option<u16>,
    request_timeout: Duration,
    extra: Vec<WatcherFeed>,
) -> Harness {
    let pki: Arc<Pki> = Arc::new(pki("Fake Riot Root"));
    let mut all = base_routes();
    all.extend(routes);
    let fake = start_fake_client(&pki, all).await;
    let dir = tempfile::tempdir().unwrap();
    let lockfile = dir.path().join("lockfile");
    std::fs::write(
        &lockfile,
        format!(
            "LeagueClient:4242:{}:{PASSWORD}:https",
            lockfile_port.unwrap_or(fake.port)
        ),
    )
    .unwrap();
    let record = Arc::new(Mutex::new(Recorded::default()));
    let (tx, mut rx) = mpsc::channel(engine::watchers::connection::WATCHER_QUEUE);
    let sink = record.clone();
    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            let mut r = sink.lock().unwrap();
            match event {
                MachineEvent::Connected(c) => r.connected.push(c),
                MachineEvent::Event(e) => r.events.push(e),
                MachineEvent::Disconnected(d) => r.disconnected.push(d),
            }
        }
    });
    let saved = lockfile.clone();
    let discover = ConfiguredDiscovery {
        discovery: Discovery::new(NoProcesses, FsReader),
        inputs: Box::new(move || DiscoveryInputs {
            saved_lockfile_path: Some(saved.clone()),
            ..Default::default()
        }),
    };
    let verifier_pki = pki.clone();
    let options = MachineOptions {
        poll_interval: Duration::from_millis(40),
        backoff: BackoffOptions {
            min: Duration::from_millis(20),
            max: Duration::from_millis(60),
            ..Default::default()
        },
        request_timeout,
        ..Default::default()
    };
    let mut subscribers = vec![WatcherFeed::new(tx)];
    subscribers.extend(extra);
    let machine = spawn_machine(
        discover,
        Arc::new(move || Ok(verifier_pki.verifier())),
        options,
        subscribers,
    );
    Harness {
        fake,
        _dir: dir,
        lockfile,
        record,
        machine,
    }
}

async fn default_start() -> Harness {
    start(HashMap::new(), None, Duration::from_secs(2)).await
}

#[tokio::test]
async fn walks_disconnected_connected_watching_and_reads_the_local_player() {
    let (logs, _guard) = capture_logs();
    let h = default_start().await;
    h.watching().await;
    let moves: Vec<(MachineState, MachineState)> =
        h.machine.transitions().iter().map(|t| (t.from, t.to)).collect();
    assert_eq!(
        moves,
        [
            (MachineState::Disconnected, MachineState::Connected),
            (MachineState::Connected, MachineState::Watching)
        ]
    );
    until(|| h.connected() == 1, "connected").await;
    let context = h.record.lock().unwrap().connected[0].clone();
    assert_eq!(context.summoner.as_ref().unwrap().puuid, PUUID);
    assert!(context.version.contains("16.17"));
    assert_eq!(context.patch.as_deref(), Some("16.17"));
    assert_eq!(context.phase.as_deref(), Some("None"));
    assert_eq!(h.fake.wait_for_frames(1).await, [r#"[5,"OnJsonApiEvent"]"#]);
    assert!(logs.text().contains("connected to the League client") && logs.text().contains(PUUID));
    let status = h.machine.status().borrow().clone();
    assert!(matches!(status.league, LeagueStatus::Connected { patch: Some(ref p), .. } if p == "16.17"));
    h.machine.stop().await;
}

#[tokio::test]
async fn delivers_a_lobby_event_and_drops_a_malformed_one() {
    let (logs, _guard) = capture_logs();
    let h = default_start().await;
    h.watching().await;
    h.fake.wait_for_sockets(1).await;
    h.fake
        .emit("/lol-lobby/v2/lobby", "Update", body("16.17", "lobby"));
    h.fake
        .emit("/lol-lobby/v2/lobby", "Update", json!({ "partyId": 42 }));
    h.fake.emit("/lol-lobby/v2/lobby", "Delete", Value::Null);
    h.fake.emit(
        "/lol-chat/v1/me",
        "Update",
        json!({ "secret": "chat-payload-value" }),
    );
    until(|| h.events().len() == 2, "two lobby events").await;
    let events = h.events();
    let RoutedEvent::Lobby {
        event_type: LcuEventType::Update,
        lobby: Some(lobby),
    } = events[0].as_ref()
    else {
        panic!("{:?}", events[0])
    };
    assert_eq!(lobby.party_id, "e3c69392-a134-43cb-97ae-8add18c72494");
    assert!(!lobby.game_config.custom_team_100.is_empty());
    assert_eq!(
        *events[1],
        RoutedEvent::Lobby {
            event_type: LcuEventType::Delete,
            lobby: None
        }
    );
    assert!(logs.text().contains("lcu event did not match its type; dropped"));
    assert!(logs.text().contains("/lol-lobby/v2/lobby"));
    assert!(!logs.text().contains("chat-payload-value"));
    h.machine.stop().await;
}

#[tokio::test]
async fn routes_a_cached_ranked_stats_push_and_drops_a_malformed_one() {
    let (logs, _guard) = capture_logs();
    let h = default_start().await;
    h.watching().await;
    h.fake.wait_for_sockets(1).await;
    let puuid = "c04e977c-133a-5d94-9fd3-6202f8beec4c";
    let uri = format!("/lol-ranked/v1/cached-ranked-stats/{puuid}");
    h.fake
        .emit(&uri, "Update", body("16.17", "ranked-stats-by-puuid--ws-cached"));
    h.fake.emit(&uri, "Update", json!({ "queueMap": "nope" }));
    h.fake.emit(&uri, "Delete", Value::Null);
    h.fake.emit(
        "/lol-ranked/v1/cached-ranked-stats/",
        "Update",
        body("16.17", "ranked-stats-by-puuid--ws-cached"),
    );
    h.fake
        .emit("/lol-gameflow/v1/gameflow-phase", "Update", json!("Lobby"));
    until(|| h.phases().len() == 1, "phase").await;
    let ranked: Vec<_> = h
        .events()
        .iter()
        .filter_map(|e| match e.as_ref() {
            RoutedEvent::RankedStats { puuid, stats } => Some((puuid.clone(), stats.clone())),
            _ => None,
        })
        .collect();
    assert_eq!(ranked.len(), 1);
    assert_eq!(ranked[0].0, puuid);
    assert_eq!(ranked[0].1.queue_map.ranked_solo_5x5.as_ref().unwrap().tier, "");
    assert_eq!(logs.count("dropped"), 1);
    assert!(logs.text().contains(&uri));
    h.machine.stop().await;
}

#[tokio::test]
async fn replays_the_recorded_custom_game_phases_then_the_end_of_game_block() {
    let h = default_start().await;
    h.watching().await;
    h.fake.wait_for_sockets(1).await;
    let text = std::fs::read_to_string(fixtures_dir().join("16.17/ws-events.ndjson")).unwrap();
    let uris = [
        "/lol-gameflow/v1/gameflow-phase",
        "/lol-end-of-game/v1/eog-stats-block",
    ];
    let mut phase_count = 0;
    for line in text.lines().filter(|l| !l.is_empty()) {
        let record: Value = serde_json::from_str(line).unwrap();
        let Some(uri) = record["uri"].as_str() else {
            continue;
        };
        if !uris.contains(&uri) || record.get("redacted").is_some() {
            continue;
        }
        if uri == uris[0] {
            phase_count += 1;
        }
        h.fake
            .emit(uri, record["eventType"].as_str().unwrap(), record["data"].clone());
    }
    assert!(phase_count > 10);
    until(|| h.phases().len() == phase_count, "every phase").await;
    let phases = h.phases();
    let first = phases.iter().position(|p| p == "InProgress").unwrap();
    let end = phases.iter().position(|p| p == "EndOfGame").unwrap();
    assert!(end > first);
    let blocks: Vec<_> = h
        .events()
        .iter()
        .filter_map(|e| match e.as_ref() {
            RoutedEvent::EogBlock { block: Some(b), .. } => Some(b.clone()),
            _ => None,
        })
        .collect();
    assert!(!blocks.is_empty());
    assert!(blocks.iter().all(|b| b.game_type == "CUSTOM_GAME"));
    assert!(blocks.iter().any(|b| b.teams.iter().any(|t| t.is_winning_team)));
    // Order preserved: the first block arrived before the EndOfGame phase, as on the real client.
    let events = h.events();
    let block_at = events
        .iter()
        .position(|e| matches!(e.as_ref(), RoutedEvent::EogBlock { block: Some(_), .. }))
        .unwrap();
    let end_at = events
        .iter()
        .position(|e| matches!(e.as_ref(), RoutedEvent::GameflowPhase(p) if p == "EndOfGame"))
        .unwrap();
    assert!(block_at < end_at);
    h.machine.stop().await;
}

#[tokio::test]
async fn reconnects_after_the_socket_drops_with_the_subscription_re_sent() {
    let h = default_start().await;
    h.watching().await;
    h.fake.wait_for_frames(1).await;
    h.fake.close_sockets(1001, "client exiting");
    assert!(h.machine.wait_for_state(MachineState::Disconnected, SECOND).await);
    h.watching().await;
    assert_eq!(
        h.fake.wait_for_frames(2).await,
        [r#"[5,"OnJsonApiEvent"]"#, r#"[5,"OnJsonApiEvent"]"#]
    );
    until(|| h.connected() == 2, "two connects").await;
    assert_eq!(h.disconnected(), [DisconnectReason::SocketClosed]);
    let triggers: Vec<Trigger> = h.machine.transitions().iter().map(|t| t.trigger).collect();
    assert_eq!(
        triggers,
        [
            Trigger::ClientReached,
            Trigger::SocketOpen,
            Trigger::SocketClosed,
            Trigger::ClientReached,
            Trigger::SocketOpen
        ]
    );
    h.fake.wait_for_sockets(1).await;
    h.fake
        .emit("/lol-gameflow/v1/gameflow-phase", "Update", json!("Lobby"));
    until(
        || h.phases().contains(&"Lobby".to_string()),
        "event after reconnect",
    )
    .await;
    h.machine.stop().await;
}

#[tokio::test]
async fn the_lockfile_disappearing_is_a_lost_client_and_not_running_lists_what_was_searched() {
    let (logs, _guard) = capture_logs();
    let h = default_start().await;
    h.watching().await;
    std::fs::remove_file(&h.lockfile).unwrap();
    assert!(h.machine.wait_for_state(MachineState::Disconnected, SECOND).await);
    until(|| h.disconnected().len() == 1, "one disconnect").await;
    assert_eq!(h.disconnected(), [DisconnectReason::ClientLost]);
    let mut status = h.machine.status();
    tokio::time::timeout(
        SECOND,
        status.wait_for(|s| matches!(s.league, LeagueStatus::NotRunning { .. })),
    )
    .await
    .unwrap()
    .unwrap();
    let league = h.machine.status().borrow().league.clone();
    assert_eq!(
        league,
        LeagueStatus::NotRunning {
            searched: vec![h.lockfile.clone()]
        }
    );
    pause(150).await;
    assert_eq!(h.machine.status().borrow().state, MachineState::Disconnected);
    assert_eq!(
        logs.count("waiting for the League client"),
        1,
        "said once, not every poll"
    );
    h.write_lockfile(h.fake.port);
    h.watching().await;
    until(|| h.connected() == 2, "reconnected").await;
    h.machine.stop().await;
}

#[tokio::test]
async fn a_changed_lockfile_is_a_lost_client() {
    let h = default_start().await;
    h.watching().await;
    std::fs::write(
        &h.lockfile,
        format!("LeagueClient:9:{}:another-password-1234:https", h.fake.port),
    )
    .unwrap();
    assert!(h.machine.wait_for_state(MachineState::Disconnected, SECOND).await);
    until(|| h.disconnected().len() == 1, "disconnect").await;
    assert_eq!(h.disconnected(), [DisconnectReason::ClientLost]);
    h.machine.stop().await;
}

#[tokio::test]
async fn stays_disconnected_on_a_dead_port_then_connects_once_it_answers() {
    let (logs, _guard) = capture_logs();
    let closed = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let dead = closed.local_addr().unwrap().port();
    drop(closed);
    let h = start(HashMap::new(), Some(dead), Duration::from_secs(2)).await;
    until(|| logs.text().contains("not answering"), "not answering").await;
    assert_eq!(h.machine.status().borrow().state, MachineState::Disconnected);
    assert!(h.machine.transitions().is_empty());
    assert!(
        matches!(h.machine.status().borrow().league, LeagueStatus::Connecting { port, .. } if port == dead)
    );
    h.write_lockfile(h.fake.port);
    h.watching().await;
    h.machine.stop().await;
}

#[tokio::test]
async fn hands_the_connect_time_phase_and_a_usable_client_to_the_watchers() {
    let routes = HashMap::from([(
        "GET /lol-gameflow/v1/gameflow-phase".to_string(),
        Route::json(200, &json!("EndOfGame")),
    )]);
    let h = start(routes, None, Duration::from_secs(2)).await;
    h.watching().await;
    until(|| h.connected() == 1, "connected").await;
    let context = h.record.lock().unwrap().connected[0].clone();
    assert_eq!(context.phase.as_deref(), Some("EndOfGame"));
    assert_eq!(context.client.gameflow_phase().await.unwrap().value, "EndOfGame");
    h.machine.stop().await;
}

#[tokio::test]
async fn a_watcher_that_goes_away_never_stops_delivery_to_the_others() {
    let (gone_tx, gone_rx) = mpsc::channel(1);
    drop(gone_rx);
    let h = start_with(
        HashMap::new(),
        None,
        Duration::from_secs(2),
        vec![WatcherFeed::new(gone_tx)],
    )
    .await;
    h.watching().await;
    h.fake.wait_for_sockets(1).await;
    h.fake
        .emit("/lol-gameflow/v1/gameflow-phase", "Update", json!("Lobby"));
    h.fake
        .emit("/lol-gameflow/v1/gameflow-phase", "Update", json!("Matchmaking"));
    until(|| h.phases().len() == 2, "both phases").await;
    assert_eq!(h.machine.status().borrow().state, MachineState::Watching);
    h.machine.stop().await;
}

#[tokio::test]
async fn continues_without_the_local_player_when_current_summoner_fails() {
    let (logs, _guard) = capture_logs();
    let routes = HashMap::from([(
        "GET /lol-summoner/v1/current-summoner".to_string(),
        Route::json(500, &json!({ "errorCode": "RPC_ERROR" })),
    )]);
    let h = start(routes, None, Duration::from_secs(2)).await;
    h.watching().await;
    until(|| h.connected() == 1, "connected").await;
    assert!(h.record.lock().unwrap().connected[0].summoner.is_none());
    assert!(logs.text().contains("current-summoner unavailable"));
    h.machine.stop().await;
}

#[tokio::test]
async fn stops_cleanly_from_watching() {
    let h = default_start().await;
    h.watching().await;
    h.fake.wait_for_sockets(1).await;
    h.machine.stop().await;
    assert_eq!(h.machine.status().borrow().state, MachineState::Stopped);
    assert_eq!(h.machine.status().borrow().league, LeagueStatus::Stopped);
    until(|| h.fake.socket_count() == 0, "socket closed").await;
    pause(100).await;
    assert_eq!(h.fake.frames().len(), 1, "nothing reconnected");
}

#[tokio::test]
async fn stops_cleanly_while_the_connect_time_reads_are_in_flight() {
    let (logs, _guard) = capture_logs();
    let mut routes = base_routes();
    let summoner = routes.remove("GET /lol-summoner/v1/current-summoner").unwrap();
    let routes = HashMap::from([(
        "GET /lol-summoner/v1/current-summoner".to_string(),
        summoner.delayed(Duration::from_millis(600)),
    )]);
    let h = start(routes, None, Duration::from_millis(150)).await;
    assert!(h.machine.wait_for_state(MachineState::Connected, SECOND).await);
    h.machine.stop().await;
    assert_eq!(h.machine.status().borrow().state, MachineState::Stopped);
    assert_eq!(h.connected(), 0);
    assert!(h.disconnected().is_empty());
    assert!(!logs.text().contains("ERROR"));
    assert!(!logs.text().contains("illegal connection transition"));
    let triggers: Vec<Trigger> = h.machine.transitions().iter().map(|t| t.trigger).collect();
    assert_eq!(triggers, [Trigger::ClientReached, Trigger::Stop]);
}

#[tokio::test]
async fn stops_cleanly_while_waiting_for_a_lockfile() {
    let h = default_start().await;
    h.watching().await;
    std::fs::remove_file(&h.lockfile).unwrap();
    assert!(h.machine.wait_for_state(MachineState::Disconnected, SECOND).await);
    let started = std::time::Instant::now();
    h.machine.stop().await;
    assert!(started.elapsed() < Duration::from_secs(1));
    assert_eq!(h.machine.status().borrow().state, MachineState::Stopped);
}

#[tokio::test]
async fn writes_no_secret_to_the_log_across_connect_disconnect_and_reconnect() {
    let (logs, _guard) = capture_logs();
    let h = default_start().await;
    h.watching().await;
    h.fake.wait_for_sockets(1).await;
    let mut lobby = body("16.17", "lobby");
    lobby["multiUserChatPassword"] = json!("live-chat-password");
    h.fake.emit("/lol-lobby/v2/lobby", "Update", lobby);
    h.fake.emit(
        "/lol-lobby/v2/lobby",
        "Update",
        json!({ "partyId": 5, "multiUserChatPassword": "live-chat-password" }),
    );
    until(|| !h.events().is_empty(), "lobby event").await;
    h.fake.close_sockets(1001, "restart");
    assert!(h.machine.wait_for_state(MachineState::Disconnected, SECOND).await);
    h.watching().await;
    h.machine.stop().await;
    let text = logs.text();
    assert!(!text.is_empty());
    assert!(!text.contains(PASSWORD));
    assert!(!text.contains(&engine::lcu::client::basic_auth(PASSWORD)["Basic ".len()..]));
    assert!(!text.contains("live-chat-password"));
    assert!(!text.contains("multiUserChatPassword"));
    assert!(text.contains(PUUID));
}

#[tokio::test]
async fn not_running_carries_every_searched_path_for_the_window() {
    // Replaces the TS "add lockfilePath to config.json" hint: the window shows Can't find League + Browse.
    let pki = Arc::new(pki("Fake Riot Root"));
    let dir = tempfile::tempdir().unwrap();
    let saved = dir.path().join("Custom").join("League of Legends");
    let legacy = dir.path().join("old").join("lockfile");
    let default = dir.path().join("default").join("lockfile");
    let inputs = DiscoveryInputs {
        saved_install_dir: Some(saved.clone()),
        saved_lockfile_path: Some(legacy.clone()),
        defaults: vec![default.clone()],
    };
    let discover = ConfiguredDiscovery {
        discovery: Discovery::new(NoProcesses, FsReader),
        inputs: Box::new(move || inputs.clone()),
    };
    let options = MachineOptions {
        poll_interval: Duration::from_millis(40),
        ..Default::default()
    };
    let machine = spawn_machine(
        discover,
        Arc::new(move || Ok(pki.verifier())),
        options,
        Vec::new(),
    );
    let mut status = machine.status();
    let seen = tokio::time::timeout(
        SECOND,
        status.wait_for(|s| matches!(s.league, LeagueStatus::NotRunning { .. })),
    )
    .await
    .unwrap()
    .unwrap()
    .clone();
    assert_eq!(
        seen.league,
        LeagueStatus::NotRunning {
            searched: vec![saved.join("lockfile"), legacy, default]
        }
    );
    machine.stop().await;
}

// --- review round 1: stop is prompt, a panicking cycle is contained ----------------------------------------

struct HangingDiscovery;
impl engine::watchers::connection::Discover for HangingDiscovery {
    async fn discover(&mut self) -> engine::lcu::LcuDiscovery {
        tokio::time::sleep(Duration::from_secs(60)).await;
        engine::lcu::LcuDiscovery::NotFound { searched: Vec::new() }
    }
}

async fn assert_prompt_stop(machine: &MachineHandle) {
    let started = std::time::Instant::now();
    tokio::time::timeout(Duration::from_secs(2), machine.stop())
        .await
        .expect("stop hung");
    assert!(
        started.elapsed() < Duration::from_millis(500),
        "stop took {:?}",
        started.elapsed()
    );
    assert_eq!(machine.status().borrow().state, MachineState::Stopped);
}

#[tokio::test]
async fn stop_is_prompt_while_discovery_hangs() {
    let pki = Arc::new(pki("Fake Riot Root"));
    let machine = spawn_machine(
        HangingDiscovery,
        Arc::new(move || Ok(pki.verifier())),
        MachineOptions::default(),
        Vec::new(),
    );
    pause(50).await;
    assert_prompt_stop(&machine).await;
}

#[tokio::test]
async fn stop_is_prompt_while_the_version_probe_hangs() {
    let routes = HashMap::from([(
        "GET /lol-patch/v1/game-version".to_string(),
        Route::json(200, &json!("16.17.1")).delayed(Duration::from_secs(10)),
    )]);
    let h = start(routes, None, Duration::from_secs(30)).await;
    let mut status = h.machine.status();
    tokio::time::timeout(
        SECOND,
        status.wait_for(|s| matches!(s.league, LeagueStatus::Connecting { .. })),
    )
    .await
    .unwrap()
    .unwrap();
    pause(50).await;
    assert_prompt_stop(&h.machine).await;
}

#[tokio::test]
async fn stop_is_prompt_while_the_connect_reads_hang() {
    let routes = HashMap::from([(
        "GET /lol-summoner/v1/current-summoner".to_string(),
        Route::json(
            200,
            &json!({ "puuid": PUUID, "summonerId": 7, "gameName": "x", "tagLine": "y" }),
        )
        .delayed(Duration::from_secs(10)),
    )]);
    let h = start(routes, None, Duration::from_secs(30)).await;
    assert!(h.machine.wait_for_state(MachineState::Connected, SECOND).await);
    pause(50).await;
    assert_prompt_stop(&h.machine).await;
    assert_eq!(h.connected(), 0);
}

struct PanicsOnce {
    calls: usize,
    searched: PathBuf,
}
impl engine::watchers::connection::Discover for PanicsOnce {
    async fn discover(&mut self) -> engine::lcu::LcuDiscovery {
        self.calls += 1;
        if self.calls == 1 {
            panic!("discovery bug (test)");
        }
        engine::lcu::LcuDiscovery::NotFound {
            searched: vec![self.searched.clone()],
        }
    }
}

#[tokio::test]
async fn a_cycle_that_panics_is_contained_and_the_machine_goes_on() {
    let (logs, _guard) = capture_logs();
    let pki = Arc::new(pki("Fake Riot Root"));
    let searched = PathBuf::from("/nowhere/lockfile");
    let options = MachineOptions {
        poll_interval: Duration::from_millis(20),
        backoff: BackoffOptions {
            min: Duration::from_millis(10),
            max: Duration::from_millis(20),
            ..Default::default()
        },
        ..Default::default()
    };
    let machine = spawn_machine(
        PanicsOnce {
            calls: 0,
            searched: searched.clone(),
        },
        Arc::new(move || Ok(pki.verifier())),
        options,
        Vec::new(),
    );
    let mut status = machine.status();
    let seen = tokio::time::timeout(
        SECOND,
        status.wait_for(|s| matches!(s.league, LeagueStatus::NotRunning { .. })),
    )
    .await
    .expect("the machine kept going after the panic")
    .unwrap()
    .clone();
    assert_eq!(
        seen.league,
        LeagueStatus::NotRunning {
            searched: vec![searched]
        }
    );
    assert_eq!(seen.state, MachineState::Disconnected);
    assert!(logs.text().contains("connection cycle panicked"));
    assert_prompt_stop(&machine).await;
}

/// Live, 16.19 on macOS: a starting client answers `game-version` with an empty 204 for about two minutes.
/// That is "not answering yet": one warn line for the port, the rest at debug, and no type-mismatch warn.
#[tokio::test]
async fn a_starting_client_answering_204_is_one_warn_not_one_per_pass() {
    let (logs, _guard) = capture_logs();
    let empty = Route {
        status: 204,
        body: String::new(),
        delay: Duration::ZERO,
    };
    let h = start(
        HashMap::from([("GET /lol-patch/v1/game-version".to_string(), empty)]),
        None,
        Duration::from_secs(2),
    )
    .await;
    until(
        || h.fake.requests_to("/lol-patch/v1/game-version") >= 5,
        "several passes",
    )
    .await;
    let warns = |needle: &str| {
        logs.text()
            .lines()
            .filter(|l| l.contains("WARN") && l.contains(needle))
            .count()
    };
    assert_eq!(warns("not answering yet"), 1, "{}", logs.text());
    assert_eq!(warns("did not match its type"), 0);
    // It answers: watching.
    h.fake.set_route(
        "GET /lol-patch/v1/game-version",
        Route::json(200, &json!("16.19.1+branch.releases-16-19")),
    );
    h.watching().await;
    h.machine.stop().await;
}
