//! `engine::host::start` end to end with the fakes (the M17.8 window's `Host`, one handle): an old engine
//! blocks the start until Retry; the session then posts a lobby with the selected group's token and shows
//! the client (phase, signed in, PUUID for pairing); a group switch during a game is held until the game is
//! recorded, then the new group's session starts; Stop. Link runs the machine alone; a pairing is adopted;
//! a token refused mid-run turns into `Refused(sentence)`.

#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

mod support;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use engine::api::transport::HttpRequest;
use engine::backoff::BackoffOptions;
use engine::config::ProcessProbe;
use engine::host::{HostBoot, HostOptions, HostStatus, SwitchOutcome, start};
use engine::lcu::LcuDiscovery;
use engine::test_support::{FakeTransport, respond};
use engine::watchers::connection::{LeagueStatus, MachineOptions};
use serde_json::{Value, json};
use support::fake_client::{Route, start_fake_client};
use support::{PASSWORD, Pki, body, golden_body, pki};

const G1: &str = "11111111-1111-4111-8111-111111111111";
const G2: &str = "22222222-2222-4222-8222-222222222222";
const T1: &str = "SYNTHETIC_hostgroupone_xxxxxxxxxxxxxxxxxxxx";
const T2: &str = "SYNTHETIC_hostgrouptwo_xxxxxxxxxxxxxxxxxxxx";
const WAIT: Duration = Duration::from_secs(8);
/// Another player in the lobby whose rank the server asks for (`ranksNeeded`).
const OTHER: &str = "aebd7c57-83d8-551d-a7b2-7caa7e8b1960";

struct Probe(Arc<AtomicBool>);
impl ProcessProbe for Probe {
    fn processes(&self) -> Option<Vec<(String, u32)>> {
        let mut list = vec![("explorer.exe".to_string(), 1)];
        if self.0.load(Ordering::SeqCst) {
            list.push(("kustom-engine.exe".to_string(), 4242));
        }
        Some(list)
    }
}

fn bearer(request: &HttpRequest) -> String {
    request
        .header("authorization")
        .and_then(|h| h.strip_prefix("Bearer "))
        .unwrap_or_default()
        .to_owned()
}

async fn wait_status(
    rx: &mut tokio::sync::watch::Receiver<HostStatus>,
    what: &str,
    f: impl Fn(&HostStatus) -> bool,
) -> HostStatus {
    let found = match tokio::time::timeout(WAIT, rx.wait_for(|s| f(s))).await {
        Ok(Ok(status)) => Some(status.clone()),
        _ => None,
    };
    found.unwrap_or_else(|| panic!("timed out waiting for: {what}; last status {:?}", rx.borrow()))
}

#[tokio::test]
async fn host_session_end_to_end_old_engine_then_lobby_then_a_switch_after_the_game() {
    let pki: Arc<Pki> = Arc::new(pki("Fake Riot Root"));
    let mut session = body("16.17", "gameflow-session");
    session["phase"] = json!("GameStart");
    let fake = start_fake_client(
        &pki,
        HashMap::from([
            (
                "GET /lol-patch/v1/game-version".into(),
                Route::json(200, &json!("16.17.8104348+branch.releases-16-17")),
            ),
            (
                "GET /lol-summoner/v1/current-summoner".into(),
                Route::json(200, &body("16.17", "current-summoner")),
            ),
            (
                "GET /lol-gameflow/v1/gameflow-phase".into(),
                Route::json(200, &json!("Lobby")),
            ),
            ("GET /lol-gameflow/v1/session".into(), Route::json(200, &session)),
            (
                "GET /lol-ranked/v1/current-ranked-stats".into(),
                Route::json(200, &body("16.17", "current-ranked-stats")),
            ),
            (
                format!("GET /lol-ranked/v1/ranked-stats/{OTHER}"),
                Route::json(200, &body("16.17", "ranked-stats-by-puuid--other")),
            ),
            (
                format!("GET /lol-summoner/v2/summoners/puuid/{OTHER}"),
                Route::json(200, &body("16.17", "summoner-by-puuid--other")),
            ),
        ]),
    )
    .await;

    let dir = tempfile::tempdir().unwrap();
    let config_dir = dir.path().join("customs-night");
    std::fs::create_dir_all(&config_dir).unwrap();
    let lockfile = dir.path().join("lockfile");
    std::fs::write(
        &lockfile,
        format!("LeagueClient:4242:{}:{PASSWORD}:https", fake.port),
    )
    .unwrap();
    std::fs::write(
        config_dir.join("config.json"),
        serde_json::to_string_pretty(&json!({
            "apiBase": "https://kustom.invalid",
            "groups": [
                { "groupId": G1, "slug": "customs", "name": "Customs", "companionToken": T1 },
                { "groupId": G2, "slug": "weekend-crew", "name": "Weekend Crew", "companionToken": T2 }
            ],
            "lastGroupId": G1,
            "lockfilePath": lockfile.to_string_lossy(),
            "someFutureKey": { "kept": true }
        }))
        .unwrap(),
    )
    .unwrap();

    // A 0.3.x engine left its status.json (the old-engine check only runs when there is one).
    std::fs::write(config_dir.join("status.json"), r#"{"state":"watching"}"#).unwrap();
    let posts: Arc<Mutex<Vec<(String, String, Value)>>> = Arc::new(Mutex::new(Vec::new()));
    let seen = posts.clone();
    let transport = FakeTransport::new(move |request| {
        let token = bearer(request);
        let body: Value = request
            .body
            .as_deref()
            .map(|b| serde_json::from_slice(b).unwrap())
            .unwrap_or(Value::Null);
        let path = request
            .url
            .trim_start_matches("https://kustom.invalid")
            .to_owned();
        seen.lock()
            .unwrap()
            .push((path.clone(), token.clone(), body.clone()));
        if path == "/api/companion/me" {
            let (id, slug, name) = if token == T1 {
                (G1, "customs", "Customs")
            } else {
                (G2, "weekend-crew", "Weekend Crew")
            };
            return respond(
                200,
                &json!({ "ok": true, "puuid": "34151cbd-d9f8-5dad-9dc8-c6a8e253c0de", "playerId": "0f1e2d3c-4b5a-4697-8877-665544332211",
                         "displayName": "PRT Empty", "group": { "id": id, "slug": slug, "name": name } })
                .to_string(),
            );
        }
        if path == "/api/companion/lobby" {
            return respond(
                200,
                r#"{"ok":true,"lobbyId":"3f1e2d4c-5b6a-4798-8c9d-0e1f2a3b4c5d","status":"open","created":true,"memberCount":1,"rosterFrozen":false,"recheckInMs":null,"ranksNeeded":["aebd7c57-83d8-551d-a7b2-7caa7e8b1960"]}"#,
            );
        }
        if path == "/api/companion/rank" {
            return respond(200, r#"{"ok":true,"stored":true}"#);
        }
        if path.starts_with("/api/companion/commands?") {
            return respond(200, r#"{"ok":true,"commands":[]}"#);
        }
        if path == "/api/companion/game" {
            let phase = body["phase"].as_str().unwrap_or("eog").to_owned();
            return respond(
                200,
                &json!({ "ok": true, "phase": phase, "created": true, "gameId": null, "lobbyId": null, "participants": 1 }).to_string(),
            );
        }
        respond(404, r#"{"ok":false,"error":"no route"}"#)
    });

    let old_engine = Arc::new(AtomicBool::new(true));
    let mut options = HostOptions::new(
        config_dir.clone(),
        transport,
        Arc::new(Probe(old_engine.clone())),
        "1.0.0".into(),
    );
    options.process_list = false;
    options.default_lockfiles = Vec::new();
    let verifier_pki = pki.clone();
    options.verifier = Arc::new(move || Ok(verifier_pki.verifier()));
    options.machine = MachineOptions {
        poll_interval: Duration::from_millis(40),
        backoff: BackoffOptions::new(Duration::from_millis(20), Duration::from_millis(60)),
        request_timeout: Duration::from_secs(2),
        ..Default::default()
    };
    options.queue_backoff = Some(BackoffOptions::new(
        Duration::from_millis(10),
        Duration::from_millis(30),
    ));
    options.refresh_every = Duration::from_millis(20);
    let host = start(options);
    let mut status = host.status();

    // 1. An old engine blocks everything until Retry.
    let blocked = wait_status(&mut status, "old engine", |s| {
        s.boot == HostBoot::OldEngineRunning
    })
    .await;
    assert!(blocked.client.is_none());
    assert!(
        posts.lock().unwrap().is_empty(),
        "no /me, no watcher while the old engine runs"
    );
    old_engine.store(false, Ordering::SeqCst);
    host.retry_boot().await;

    // 2. Running on lastGroupId, League connected, groups listed for Switch group.
    let running = wait_status(&mut status, "connected on g1", |s| {
        s.boot == HostBoot::Ready
            && s.current_group.as_deref() == Some(G1)
            && matches!(s.league, LeagueStatus::Connected { .. })
            && s.client.is_some()
    })
    .await;
    assert_eq!(running.groups.len(), 2);
    assert!(running.signed_in);
    assert_eq!(
        running.puuid.as_deref(),
        Some("34151cbd-d9f8-5dad-9dc8-c6a8e253c0de")
    );
    assert_eq!(running.phase.as_deref(), Some("Lobby"));
    assert!(!running.busy);
    fake.wait_for_sockets(1).await;

    // The folder the connected client reported is saved, since config had no leagueInstallDir.
    for _ in 0..400 {
        if engine::config::read_league_install_dir(&config_dir).is_some() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert_eq!(
        engine::config::read_league_install_dir(&config_dir).as_deref(),
        Some(dir.path())
    );
    assert_eq!(running.reported_install_dir.as_deref(), Some(dir.path()));

    // A lobby: posted with group one's token.
    fake.emit("/lol-lobby/v2/lobby", "Update", body("16.17", "lobby"));
    for _ in 0..400 {
        if posts
            .lock()
            .unwrap()
            .iter()
            .any(|(p, _, _)| p == "/api/companion/lobby")
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    let lobby_post = posts
        .lock()
        .unwrap()
        .iter()
        .find(|(p, _, _)| p == "/api/companion/lobby")
        .cloned()
        .unwrap();
    assert_eq!(lobby_post.1, T1);
    assert_eq!(lobby_post.2["partyId"], "e3c69392-a134-43cb-97ae-8add18c72494");
    // M17.10: the own rank and the command poll run in the session, on the same group's token.
    for _ in 0..500 {
        let seen = posts.lock().unwrap().clone();
        let rank = seen.iter().any(|(p, t, _)| p == "/api/companion/rank" && t == T1);
        let poll = seen
            .iter()
            .any(|(p, t, _)| p == "/api/companion/commands?clientConnected=true" && t == T1);
        if rank && poll {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    let seen = posts.lock().unwrap().clone();
    let rank = seen
        .iter()
        .find(|(p, _, _)| p == "/api/companion/rank")
        .cloned()
        .unwrap();
    assert_eq!(rank.1, T1);
    assert_eq!(rank.2["puuid"], "34151cbd-d9f8-5dad-9dc8-c6a8e253c0de");
    assert!(
        seen.iter()
            .any(|(p, t, _)| p == "/api/companion/commands?clientConnected=true" && t == T1)
    );

    // M17.10 live: the lobby answer's ranksNeeded reaches rank sync: the client GET, then the post.
    for _ in 0..500 {
        if posts
            .lock()
            .unwrap()
            .iter()
            .any(|(p, _, b)| p == "/api/companion/rank" && b["puuid"] == OTHER)
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert_eq!(
        fake.requests_to(&format!("/lol-ranked/v1/ranked-stats/{OTHER}")),
        1
    );
    let other = posts
        .lock()
        .unwrap()
        .iter()
        .find(|(p, _, b)| p == "/api/companion/rank" && b["puuid"] == OTHER)
        .cloned()
        .expect("the requested rank was posted");
    assert_eq!(other.1, T1);
    assert_eq!(other.2, golden_body("rank--ranked-stats-by-puuid--other"));

    // 3. A game starts: the switch waits for it.
    fake.emit("/lol-gameflow/v1/gameflow-phase", "Update", json!("GameStart"));
    wait_status(&mut status, "busy", |s| s.busy).await;
    assert_eq!(host.switch_group(G2).await, SwitchOutcome::AfterThisGame);
    assert_eq!(host.switch_group("nope").await, SwitchOutcome::Nothing);
    let pending = wait_status(&mut status, "switch pending", |s| {
        s.pending_group.as_deref() == Some(G2)
    })
    .await;
    assert_eq!(
        pending.current_group.as_deref(),
        Some(G1),
        "still on g1 during the game"
    );
    // Choosing g1 again cancels the held switch; choosing g2 holds it again.
    assert_eq!(host.switch_group(G1).await, SwitchOutcome::Cancelled);
    assert_eq!(status.borrow().pending_group, None);
    assert_eq!(host.switch_group(G2).await, SwitchOutcome::AfterThisGame);

    // The game ends and is recorded; the client goes idle: then the switch happens by itself.
    fake.emit(
        "/lol-end-of-game/v1/eog-stats-block",
        "Create",
        body("16.17", "eog-stats-block"),
    );
    fake.emit("/lol-gameflow/v1/gameflow-phase", "Update", json!("EndOfGame"));
    fake.emit("/lol-gameflow/v1/gameflow-phase", "Update", json!("None"));
    let switched = wait_status(&mut status, "running on g2", |s| {
        s.boot == HostBoot::Ready
            && s.current_group.as_deref() == Some(G2)
            && s.pending_group.is_none()
            && !s.switching
            && matches!(s.league, LeagueStatus::Connected { .. })
    })
    .await;
    assert_eq!(switched.queued, 0);
    let game_posts: Vec<(String, String, Value)> = posts
        .lock()
        .unwrap()
        .iter()
        .filter(|(p, _, _)| p == "/api/companion/game")
        .cloned()
        .collect();
    let eog = game_posts
        .iter()
        .find(|(_, _, b)| b["phase"] == "eog")
        .expect("the game was recorded before the switch");
    assert_eq!(eog.1, T1, "the game posted on the group it was played for");
    assert!(
        posts
            .lock()
            .unwrap()
            .iter()
            .any(|(p, t, _)| p.starts_with("/api/companion/commands?") && t == T2),
        "the new group's watchers run on its token (a switch does not re-run /me, as LocalHost)"
    );
    let config: Value =
        serde_json::from_str(&std::fs::read_to_string(config_dir.join("config.json")).unwrap()).unwrap();
    assert_eq!(config["lastGroupId"], G2);
    assert_eq!(
        config["someFutureKey"]["kept"], true,
        "unknown keys survive the switch"
    );
    let last = switched.last_posted.clone();
    assert!(last.is_none() || last.as_ref().is_some_and(|l| l.duration_s == 913));

    // 4. Quit.
    host.stop().await;
    assert!(host.status().borrow().stopped);
}

#[tokio::test]
async fn link_runs_the_machine_alone_then_a_pairing_is_adopted_and_a_refused_token_shows_its_sentence() {
    let dir = tempfile::tempdir().unwrap();
    let config_dir = dir.path().join("customs-night");
    std::fs::create_dir_all(&config_dir).unwrap();
    std::fs::write(
        config_dir.join("config.json"),
        r#"{"apiBase":"https://kustom.invalid","groups":[]}"#,
    )
    .unwrap();
    // Every call on T1 is refused (the token was revoked right after pairing).
    let transport = FakeTransport::new(|request| {
        if bearer(request) == T1 {
            return respond(401, r#"{"ok":false,"error":"Unknown companion token"}"#);
        }
        respond(404, r#"{"ok":false,"error":"no route"}"#)
    });
    let mut options = HostOptions::new(
        config_dir.clone(),
        transport.clone(),
        Arc::new(Probe(Arc::new(AtomicBool::new(false)))),
        "1.0.0".into(),
    );
    options.process_list = false;
    options.default_lockfiles = vec![dir.path().join("no-league").join("lockfile")];
    options.machine = MachineOptions {
        poll_interval: Duration::from_millis(40),
        backoff: BackoffOptions::new(Duration::from_millis(20), Duration::from_millis(60)),
        ..Default::default()
    };
    let host = start(options);
    let mut status = host.status();
    // Link, and the machine still runs: the window shows "Can't find League".
    wait_status(&mut status, "link with league status", |s| {
        s.boot == HostBoot::NeedsLink && matches!(s.league, LeagueStatus::NotRunning { .. })
    })
    .await;
    assert_eq!(host.switch_group(G1).await, SwitchOutcome::Nothing);
    match host.retry_discovery().await {
        LcuDiscovery::NotFound { searched } => assert!(searched.iter().any(|p| p.ends_with("lockfile"))),
        other => panic!("expected NotFound, got {other:?}"),
    }

    // Pairing saved a token: adopted at once (nothing was recording), then the API refuses it mid-run.
    std::fs::write(
        config_dir.join("config.json"),
        json!({ "apiBase": "https://kustom.invalid", "groups": [{ "groupId": G1, "slug": "customs", "name": "Customs", "companionToken": T1 }] })
            .to_string(),
    )
    .unwrap();
    host.adopt_linked_group(G1).await;
    assert_eq!(status.borrow().groups.len(), 1);
    let refused = wait_status(&mut status, "refused mid-run", |s| {
        matches!(s.boot, HostBoot::Refused(_))
    })
    .await;
    assert_eq!(refused.boot, HostBoot::Refused("Unknown companion token".into()));
    assert_eq!(refused.current_group.as_deref(), Some(G1));
    assert!(
        transport
            .requests()
            .iter()
            .any(|r| r.url.ends_with("/api/companion/me"))
    );

    // Retry boot: /me refuses at boot too, the same sentence, the machine alone.
    host.retry_boot().await;
    assert_eq!(
        status.borrow().boot,
        HostBoot::Refused("Unknown companion token".into())
    );
    host.stop().await;
    assert!(host.status().borrow().stopped);
}

/// The M17.8 window's `Host` trait (`src-tauri/src/host_api.rs`), with its `HostStatus`/`HostBoot` taken from
/// the engine: `HostHandle` implements it in one `impl` of one-line methods.
mod window_seam {
    use std::future::Future;
    use std::pin::Pin;

    use engine::host::{HostHandle, HostStatus};
    use engine::lcu::LcuDiscovery;
    use tokio::sync::watch;

    pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

    pub trait Host: Send + Sync + 'static {
        fn status(&self) -> watch::Receiver<HostStatus>;
        fn switch_group(&self, group_id: String) -> BoxFuture<'_, ()>;
        fn retry_discovery(&self) -> BoxFuture<'_, LcuDiscovery>;
        fn retry_boot(&self) -> BoxFuture<'_, ()>;
        fn adopt_linked_group(&self, group_id: String) -> BoxFuture<'_, ()>;
        fn stop(&self) -> BoxFuture<'_, ()>;
    }

    impl Host for HostHandle {
        fn status(&self) -> watch::Receiver<HostStatus> {
            HostHandle::status(self)
        }
        fn switch_group(&self, group_id: String) -> BoxFuture<'_, ()> {
            Box::pin(async move {
                HostHandle::switch_group(self, &group_id).await;
            })
        }
        fn retry_discovery(&self) -> BoxFuture<'_, LcuDiscovery> {
            Box::pin(HostHandle::retry_discovery(self))
        }
        fn retry_boot(&self) -> BoxFuture<'_, ()> {
            Box::pin(HostHandle::retry_boot(self))
        }
        fn adopt_linked_group(&self, group_id: String) -> BoxFuture<'_, ()> {
            Box::pin(async move { HostHandle::adopt_linked_group(self, &group_id).await })
        }
        fn stop(&self) -> BoxFuture<'_, ()> {
            Box::pin(HostHandle::stop(self))
        }
    }

    #[tokio::test]
    async fn host_handle_is_the_windows_host_in_one_impl() {
        use std::sync::Arc;
        use std::sync::atomic::AtomicBool;

        use engine::host::{HostBoot, HostOptions, start};
        use engine::test_support::{FakeTransport, respond};

        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("config.json"),
            r#"{"apiBase":"https://kustom.invalid","groups":[]}"#,
        )
        .unwrap();
        let transport = FakeTransport::new(|_| respond(404, r#"{"ok":false,"error":"no route"}"#));
        let mut options = HostOptions::new(
            dir.path().to_path_buf(),
            transport,
            Arc::new(super::Probe(Arc::new(AtomicBool::new(false)))),
            "1.0.0".into(),
        );
        options.process_list = false;
        options.default_lockfiles = Vec::new();
        let host: Box<dyn Host> = Box::new(start(options));
        let mut status = host.status();
        let _ = tokio::time::timeout(super::WAIT, status.wait_for(|s| s.boot == HostBoot::NeedsLink))
            .await
            .unwrap();
        host.switch_group("nope".into()).await;
        assert!(matches!(
            host.retry_discovery().await,
            LcuDiscovery::NotFound { .. }
        ));
        host.retry_boot().await;
        host.adopt_linked_group("nope".into()).await;
        assert_eq!(status.borrow().boot, HostBoot::NeedsLink);
        host.stop().await;
        assert!(host.status().borrow().stopped);
    }
}
