//! The lobby watcher (port of `apps/companion/src/lobbyWatcher.test.ts`, case for case, the numbered M2.2
//! checks in the names), against the fake League client for its reads and a scripted poster for its posts,
//! plus the M17.7 contract: the recorded 16.17 evening replayed through the connection machine produces the
//! 45 lobby bodies of the TypeScript golden, JSON-equal and in order.

#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

mod support;

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use engine::api::wire::{LobbyPayload, Side};
use engine::backoff::BackoffOptions;
use engine::lcu::LcuClient;
use engine::lcu::discovery::{Discovery, DiscoveryInputs, FsReader};
use engine::lcu::events::{LcuEventType, RoutedEvent};
use engine::lcu::mapper::{NameCache, RiotIdName, map_lobby};
use engine::lcu::process::{ProcessList, ProcessLister};
use engine::lcu::types::{Lobby, Summoner};
use engine::watchers::connection::{
    ConfiguredDiscovery, ConnectedContext, MachineEvent, MachineOptions, MachineState, spawn_machine,
};
use engine::watchers::lobby::{
    LobbyAnswer, LobbyGoneReason, LobbySignal, LobbyWatcherHandle, LobbyWatcherOptions, PostOutcome,
    TokioScheduler, spawn_lobby_watcher,
};
use serde_json::{Value, json};
use support::fake_client::{FakeClient, Route, start_fake_client};
use support::watch_kit::{ManualScheduler, ScriptedPoster, capture_logs, ok_answer, pause, until};
use support::{PASSWORD, Pki, body, credentials, fixtures_dir, golden_body, pki};
use tokio::sync::mpsc;

const PARTY: &str = "e3c69392-a134-43cb-97ae-8add18c72494";
const LEADER: &str = "34151cbd-d9f8-5dad-9dc8-c6a8e253c0de";
const FRIEND: &str = "c04e977c-133a-5d94-9fd3-6202f8beec4c";
const LOBBY_GET: &str = "GET /lol-lobby/v2/lobby";
const SETTLE: Duration = Duration::from_secs(8);

fn friend_lookup() -> String {
    format!("GET /lol-summoner/v2/summoners/puuid/{FRIEND}")
}

fn lobby(id: &str) -> Lobby {
    serde_json::from_value(body("16.17", id)).unwrap()
}

fn own() -> Summoner {
    serde_json::from_value(body("16.17", "current-summoner")).unwrap()
}

fn answer(f: impl FnOnce(&mut LobbyAnswer)) -> PostOutcome {
    let mut a = LobbyAnswer {
        status: "open".into(),
        created: true,
        member_count: 1,
        ..Default::default()
    };
    f(&mut a);
    PostOutcome::Ok(a)
}

fn now(outcome: PostOutcome) -> (PostOutcome, Duration) {
    (outcome, Duration::ZERO)
}

fn http(status: u16) -> PostOutcome {
    PostOutcome::Http {
        status,
        error: format!("HTTP {status}"),
    }
}

struct Harness {
    fake: FakeClient,
    poster: Arc<ScriptedPoster>,
    scheduler: Arc<ManualScheduler>,
    watcher: LobbyWatcherHandle,
    signals: mpsc::Receiver<LobbySignal>,
    context: Arc<ConnectedContext>,
}

struct Setup {
    script: Vec<(PostOutcome, Duration)>,
    routes: Vec<(String, Route)>,
    lobby_at_connect: Option<Route>,
    manual_timers: bool,
    summoner: Option<Summoner>,
    skip_connect: bool,
    lookup_interval: Duration,
    backoff: BackoffOptions,
}

impl Default for Setup {
    fn default() -> Self {
        Self {
            script: vec![now(ok_answer())],
            routes: Vec::new(),
            lobby_at_connect: None,
            manual_timers: false,
            summoner: Some(own()),
            skip_connect: false,
            lookup_interval: Duration::from_millis(5),
            backoff: BackoffOptions {
                min: Duration::from_millis(10),
                max: Duration::from_millis(40),
                ..Default::default()
            },
        }
    }
}

async fn setup(options: Setup) -> Harness {
    let pki: Arc<Pki> = Arc::new(pki("Fake Riot Root"));
    let mut routes: HashMap<String, Route> = options.routes.into_iter().collect();
    routes.insert(
        LOBBY_GET.into(),
        options.lobby_at_connect.unwrap_or_else(|| {
            Route::json(
                404,
                &json!({ "errorCode": "RPC_ERROR", "httpStatus": 404, "message": "LOBBY_NOT_FOUND" }),
            )
        }),
    );
    let fake = start_fake_client(&pki, routes).await;
    let client =
        LcuClient::with_verifier(&credentials(fake.port), pki.verifier(), Duration::from_secs(2)).unwrap();
    let context = Arc::new(ConnectedContext {
        client,
        version: "16.17.8104348+branch.releases-16-17".into(),
        patch: Some("16.17".into()),
        summoner: options.summoner,
        phase: Some("Lobby".into()),
        port: fake.port,
    });
    let poster = ScriptedPoster::new(options.script);
    let scheduler = Arc::new(ManualScheduler::default());
    let watcher_options = LobbyWatcherOptions {
        lookup_interval: options.lookup_interval,
        backoff: options.backoff,
        scheduler: if options.manual_timers {
            scheduler.clone()
        } else {
            Arc::new(TokioScheduler)
        },
    };
    let (watcher, signals) = spawn_lobby_watcher(poster.clone(), watcher_options);
    let h = Harness {
        fake,
        poster,
        scheduler,
        watcher,
        signals,
        context,
    };
    if !options.skip_connect {
        h.watcher.send(MachineEvent::Connected(h.context.clone()));
        until(
            || h.fake.requests_to("/lol-lobby/v2/lobby") == 1,
            "connect-time GET",
        )
        .await;
        assert!(h.watcher.settled(SETTLE).await);
    }
    h
}

impl Harness {
    fn update(&self, lobby: Lobby, event_type: LcuEventType) {
        self.watcher
            .send(MachineEvent::Event(Arc::new(RoutedEvent::Lobby {
                event_type,
                lobby: Some(Box::new(lobby)),
            })));
    }

    fn remove(&self) {
        self.watcher
            .send(MachineEvent::Event(Arc::new(RoutedEvent::Lobby {
                event_type: LcuEventType::Delete,
                lobby: None,
            })));
    }

    async fn settled(&self) {
        assert!(self.watcher.settled(SETTLE).await, "watcher did not settle");
    }

    fn posts(&self) -> Vec<LobbyPayload> {
        self.poster.posted()
    }

    fn lookups(&self) -> usize {
        self.fake
            .requests_to(&format!("/lol-summoner/v2/summoners/puuid/{FRIEND}"))
    }

    fn drain_signals(&mut self) -> Vec<LobbySignal> {
        let mut out = Vec::new();
        while let Ok(s) = self.signals.try_recv() {
            out.push(s);
        }
        out
    }
}

fn recorded_lobby_events(from: &str, to: &str) -> Vec<(LcuEventType, Option<Lobby>)> {
    let text = std::fs::read_to_string(fixtures_dir().join("16.17/ws-events.ndjson")).unwrap();
    text.lines()
        .filter(|l| !l.is_empty())
        .map(|l| serde_json::from_str::<Value>(l).unwrap())
        .filter(|r| r["uri"] == "/lol-lobby/v2/lobby" && r.get("dropped").is_none())
        .filter(|r| {
            let ts = r["ts"].as_str().unwrap();
            ts >= from && ts <= to
        })
        .map(|r| match r["eventType"].as_str().unwrap() {
            "Delete" => (LcuEventType::Delete, None),
            "Create" => (
                LcuEventType::Create,
                Some(serde_json::from_value(r["data"].clone()).unwrap()),
            ),
            _ => (
                LcuEventType::Update,
                Some(serde_json::from_value(r["data"].clone()).unwrap()),
            ),
        })
        .collect()
}

fn all_recorded() -> Vec<(LcuEventType, Option<Lobby>)> {
    recorded_lobby_events("", "\u{10FFFF}")
}

// --- posting the roster ------------------------------------------------------------------------------

#[tokio::test]
async fn check_2_posts_lobby_json_one_member_side_100_named_no_password() {
    let (logs, _g) = capture_logs();
    let h = setup(Setup::default()).await;
    h.update(lobby("lobby"), LcuEventType::Update);
    h.settled().await;
    let posts = h.poster.posted_json();
    assert_eq!(posts.len(), 1);
    assert_eq!(
        posts[0],
        json!({
            "partyId": PARTY, "lobbyName": "PRT Empty's Game", "lobbyPassword": null,
            "members": [{ "puuid": LEADER, "summonerId": 47890856, "gameName": "PRT Empty", "tagLine": "EUNE", "side": 100, "isSpectator": false }]
        })
    );
    assert_eq!(posts[0], golden_body("lobby--lobby"));
    assert!(logs.text().contains("lobby posted"));
}

#[tokio::test]
async fn checks_3_4_two_player_and_spectator_fixtures() {
    let h = setup(Setup {
        routes: vec![(friend_lookup(), Route::json(404, &json!({})))],
        ..Default::default()
    })
    .await;
    h.update(lobby("lobby--two-players"), LcuEventType::Update);
    h.settled().await;
    h.update(lobby("lobby--spectator"), LcuEventType::Update);
    h.settled().await;
    let posts = h.posts();
    assert_eq!(posts.len(), 2);
    let summary = |p: &LobbyPayload| {
        p.members
            .iter()
            .map(|m| (m.puuid.clone(), m.side, m.is_spectator))
            .collect::<Vec<_>>()
    };
    assert_eq!(
        summary(&posts[0]),
        [
            (LEADER.into(), Some(Side::Blue), false),
            (FRIEND.into(), Some(Side::Red), false)
        ]
    );
    assert_eq!(
        summary(&posts[1]),
        [
            (LEADER.into(), Some(Side::Blue), false),
            (FRIEND.into(), None, true)
        ]
    );
    let json = h.poster.posted_json();
    assert_eq!(json[0], golden_body("lobby--lobby--two-players"));
    assert_eq!(json[1], golden_body("lobby--lobby--spectator"));
}

#[tokio::test]
async fn check_5_drops_a_bot_member_and_a_bot_in_a_team_array() {
    let h = setup(Setup::default()).await;
    let mut raw = body("16.17", "lobby");
    let mut bot = raw["members"][0].clone();
    bot["puuid"] = json!("");
    bot["summonerId"] = json!(0);
    bot["isBot"] = json!(true);
    raw["members"].as_array_mut().unwrap().push(bot.clone());
    raw["gameConfig"]["customTeam100"]
        .as_array_mut()
        .unwrap()
        .push(bot);
    h.update(serde_json::from_value(raw).unwrap(), LcuEventType::Update);
    h.settled().await;
    assert_eq!(
        h.posts()[0]
            .members
            .iter()
            .map(|m| m.puuid.as_str())
            .collect::<Vec<_>>(),
        [LEADER]
    );
    assert_eq!(h.lookups(), 0);
}

#[tokio::test]
async fn check_6_posts_nothing_on_the_two_recorded_deletes() {
    let (logs, _g) = capture_logs();
    let mut h = setup(Setup::default()).await;
    let deletes = all_recorded()
        .into_iter()
        .filter(|(t, _)| *t == LcuEventType::Delete)
        .count();
    assert_eq!(deletes, 2);
    for _ in 0..deletes {
        h.remove();
    }
    pause(50).await;
    h.settled().await;
    assert!(h.posts().is_empty());
    assert_eq!(logs.count("lobby closed; nothing posted"), 2);
    let gone = h
        .drain_signals()
        .into_iter()
        .filter(|s| {
            *s == LobbySignal::LobbyGone {
                reason: LobbyGoneReason::Deleted,
            }
        })
        .count();
    assert_eq!(gone, 2, "the game watcher's lobby-gone signal");
}

#[tokio::test]
async fn check_1_replays_every_recorded_lobby_event_each_post_with_a_party_id() {
    let (logs, _g) = capture_logs();
    let h = setup(Setup {
        routes: vec![(friend_lookup(), Route::json(404, &json!({})))],
        ..Default::default()
    })
    .await;
    let events = all_recorded();
    for (event_type, lobby) in &events {
        match lobby {
            None => h.remove(),
            Some(l) => h.update(l.clone(), *event_type),
        }
        h.settled().await;
    }
    let posts = h.posts();
    assert_eq!(posts.len(), events.len() - 2);
    assert!(posts.iter().all(|p| !p.party_id.is_empty()));
    assert!(!logs.text().contains("ERROR"));
}

#[tokio::test]
async fn skips_a_lobby_that_is_not_a_custom_game_once_per_party() {
    let (logs, _g) = capture_logs();
    let h = setup(Setup::default()).await;
    let mut raw = body("16.17", "lobby");
    raw["gameConfig"]["isCustom"] = json!(false);
    raw["gameConfig"]["queueId"] = json!(450);
    let normal: Lobby = serde_json::from_value(raw).unwrap();
    h.update(normal.clone(), LcuEventType::Update);
    h.update(normal, LcuEventType::Update);
    pause(30).await;
    h.settled().await;
    assert!(h.posts().is_empty());
    assert_eq!(logs.count("not a custom game"), 1);
}

// --- connect while already in a lobby (check 7) --------------------------------------------------------

#[tokio::test]
async fn check_7_gets_the_lobby_once_at_connect_and_posts_it_once() {
    let (logs, _g) = capture_logs();
    let h = setup(Setup {
        lobby_at_connect: Some(Route::json(200, &body("16.17", "lobby"))),
        skip_connect: true,
        ..Default::default()
    })
    .await;
    h.watcher.send(MachineEvent::Connected(h.context.clone()));
    until(|| h.posts().len() == 1, "one post").await;
    h.settled().await;
    assert_eq!(h.posts().len(), 1);
    assert_eq!(h.posts()[0].party_id, PARTY);
    assert_eq!(h.fake.requests_to("/lol-lobby/v2/lobby"), 1);
    assert!(logs.text().contains("already in a lobby at connect"));
}

#[tokio::test]
async fn check_7_posts_nothing_when_the_connect_get_is_a_404() {
    let (logs, _g) = capture_logs();
    let h = setup(Setup {
        skip_connect: true,
        ..Default::default()
    })
    .await;
    h.watcher.send(MachineEvent::Connected(h.context.clone()));
    until(|| logs.text().contains("no lobby open at connect"), "404 logged").await;
    pause(30).await;
    assert!(h.posts().is_empty());
    assert_eq!(logs.count("no lobby open at connect"), 1);
}

#[tokio::test]
async fn check_7_a_lobby_event_that_arrives_first_wins_over_a_slow_connect_get() {
    let (logs, _g) = capture_logs();
    let h = setup(Setup {
        lobby_at_connect: Some(Route::json(200, &body("16.17", "lobby")).delayed(Duration::from_millis(150))),
        routes: vec![(friend_lookup(), Route::json(404, &json!({})))],
        skip_connect: true,
        ..Default::default()
    })
    .await;
    h.watcher.send(MachineEvent::Connected(h.context.clone()));
    h.update(lobby("lobby--two-players"), LcuEventType::Update);
    pause(300).await;
    h.settled().await;
    let posts = h.posts();
    assert_eq!(posts.len(), 1);
    assert_eq!(posts[0].members.len(), 2);
    assert!(logs.text().contains("superseded by an event"));
}

// --- one post in flight, newest wins (check 8) ------------------------------------------------------------

#[tokio::test]
async fn check_8_the_recorded_burst_with_a_500ms_post_gives_at_most_two_posts_the_last_carrying_the_last_event()
 {
    let h = setup(Setup {
        script: vec![now(ok_answer()), (ok_answer(), Duration::from_millis(500))],
        ..Default::default()
    })
    .await;
    let burst = recorded_lobby_events("2026-09-08T16:36:41.502Z", "2026-09-08T16:36:46.976Z");
    assert!(burst.len() >= 11);
    assert!(burst.iter().all(|(t, _)| *t != LcuEventType::Delete));
    let lobbies: Vec<Lobby> = burst.into_iter().map(|(_, l)| l.unwrap()).collect();
    for (i, l) in lobbies.iter().enumerate() {
        h.update(
            l.clone(),
            if i == 0 {
                LcuEventType::Create
            } else {
                LcuEventType::Update
            },
        );
    }
    pause(100).await;
    h.settled().await;
    let posts = h.posts();
    assert!((1..=2).contains(&posts.len()), "{}", posts.len());
    let names: NameCache = HashMap::from([(
        LEADER.to_string(),
        RiotIdName {
            game_name: Some("PRT Empty".into()),
            tag_line: Some("EUNE".into()),
        },
    )]);
    assert_eq!(posts.last().unwrap(), &map_lobby(lobbies.last().unwrap(), &names));
}

// --- names without waiting (check 9) ---------------------------------------------------------------------

#[tokio::test]
async fn check_9_posts_null_names_at_once_looks_up_once_and_reposts_once_with_names() {
    let h = setup(Setup {
        routes: vec![(
            friend_lookup(),
            Route::json(200, &body("16.17", "summoner-by-puuid--other")).delayed(Duration::from_millis(100)),
        )],
        lookup_interval: Duration::from_millis(200),
        ..Default::default()
    })
    .await;
    let started = Instant::now();
    let l = lobby("lobby--two-players");
    h.update(l.clone(), LcuEventType::Update);
    until(|| !h.posts().is_empty(), "first post").await;
    assert!(
        started.elapsed() < Duration::from_millis(50),
        "the post never waits on a name"
    );
    assert_eq!(h.posts()[0].members[1].game_name, None);
    h.update(l.clone(), LcuEventType::Update);
    h.update(l, LcuEventType::Update);
    until(
        || {
            h.posts()
                .iter()
                .any(|p| p.members[1].game_name.as_deref() == Some("XETA"))
        },
        "named re-post",
    )
    .await;
    h.settled().await;
    pause(50).await;
    assert_eq!(h.lookups(), 1);
    let posts = h.posts();
    let named: Vec<_> = posts
        .iter()
        .filter(|p| p.members[1].game_name.as_deref() == Some("XETA"))
        .collect();
    assert_eq!(named.len(), 1);
    assert_eq!(posts.last().unwrap(), named[0]);
    assert!(
        posts[..posts.len() - 1]
            .iter()
            .all(|p| p.members[1].game_name.is_none())
    );
    assert_eq!(named[0].members[1].tag_line.as_deref(), Some("EUNE"));
    assert_eq!(named[0].members[1].side, Some(Side::Red));
    let view = h.watcher.view().borrow().clone();
    assert_eq!(
        view.known_names
            .get(FRIEND)
            .and_then(|n| n.game_name.clone())
            .as_deref(),
        Some("XETA")
    );
}

#[tokio::test]
async fn check_9_a_404_lookup_is_logged_once_and_never_retried() {
    let (logs, _g) = capture_logs();
    let h = setup(Setup {
        routes: vec![(
            friend_lookup(),
            Route::json(404, &json!({ "errorCode": "RPC_ERROR" })),
        )],
        ..Default::default()
    })
    .await;
    let l = lobby("lobby--two-players");
    h.update(l.clone(), LcuEventType::Update);
    h.settled().await;
    pause(30).await;
    h.update(l, LcuEventType::Update);
    h.settled().await;
    pause(30).await;
    assert_eq!(h.lookups(), 1);
    assert_eq!(h.posts().len(), 2);
    assert!(h.posts().iter().all(|p| p.members[1].game_name.is_none()));
    assert_eq!(logs.count("summoner lookup failed"), 1);
}

#[tokio::test]
async fn check_9_never_looks_up_the_local_player() {
    let h = setup(Setup::default()).await;
    h.update(lobby("lobby"), LcuEventType::Update);
    h.settled().await;
    pause(30).await;
    assert_eq!(
        h.fake
            .requests_to(&format!("/lol-summoner/v2/summoners/puuid/{LEADER}")),
        0
    );
    assert_eq!(h.posts()[0].members[0].game_name.as_deref(), Some("PRT Empty"));
}

#[tokio::test]
async fn names_unknown_then_repost_match_their_goldens() {
    let h = setup(Setup {
        summoner: None,
        routes: vec![(
            format!("GET /lol-summoner/v2/summoners/puuid/{LEADER}"),
            Route::json(200, &body("16.17", "summoner-by-puuid")),
        )],
        ..Default::default()
    })
    .await;
    h.update(lobby("lobby"), LcuEventType::Update);
    until(|| h.posts().len() == 2, "two posts").await;
    h.settled().await;
    let json = h.poster.posted_json();
    assert_eq!(json[0], golden_body("lobby--lobby--names-unknown"));
    assert_eq!(json[1], golden_body("lobby--lobby--names-repost"));
}

// --- the recheck knock (check 10) -----------------------------------------------------------------------

#[tokio::test]
async fn check_10_reposts_the_identical_payload_after_recheck_in_ms_once() {
    let h = setup(Setup {
        script: vec![now(answer(|a| a.recheck_in_ms = Some(7000))), now(ok_answer())],
        manual_timers: true,
        ..Default::default()
    })
    .await;
    h.update(lobby("lobby"), LcuEventType::Update);
    h.settled().await;
    assert_eq!(h.scheduler.len(), 1);
    assert_eq!(h.scheduler.get(0).delay, Duration::from_millis(7000));
    h.scheduler.get(0).fire();
    until(|| h.posts().len() == 2, "re-post").await;
    h.settled().await;
    assert_eq!(h.posts()[0], h.posts()[1]);
    assert_eq!(h.scheduler.len(), 1, "the second answer said null");
}

#[tokio::test]
async fn check_10_schedules_nothing_for_null() {
    let h = setup(Setup {
        manual_timers: true,
        ..Default::default()
    })
    .await;
    h.update(lobby("lobby"), LcuEventType::Update);
    h.settled().await;
    assert_eq!(h.scheduler.len(), 0);
}

#[tokio::test]
async fn check_10_a_real_event_supersedes_the_recheck() {
    let h = setup(Setup {
        script: vec![now(answer(|a| a.recheck_in_ms = Some(7000))), now(ok_answer())],
        manual_timers: true,
        routes: vec![(friend_lookup(), Route::json(404, &json!({})))],
        ..Default::default()
    })
    .await;
    h.update(lobby("lobby"), LcuEventType::Update);
    h.settled().await;
    assert_eq!(h.scheduler.len(), 1);
    h.update(lobby("lobby--two-players"), LcuEventType::Update);
    h.settled().await;
    assert!(h.scheduler.get(0).is_cancelled());
    h.scheduler.get(0).fire();
    pause(30).await;
    assert_eq!(h.posts().len(), 2);
    assert_eq!(h.posts()[1].members.len(), 2);
}

#[tokio::test]
async fn check_10_a_real_timer_reposts_about_120ms_later() {
    let h = setup(Setup {
        script: vec![now(answer(|a| a.recheck_in_ms = Some(120))), now(ok_answer())],
        ..Default::default()
    })
    .await;
    h.update(lobby("lobby"), LcuEventType::Update);
    h.settled().await;
    let posted = Instant::now();
    until(|| h.posts().len() == 2, "re-post").await;
    let elapsed = posted.elapsed();
    assert!(
        elapsed >= Duration::from_millis(100) && elapsed < Duration::from_secs(1),
        "{elapsed:?}"
    );
}

#[tokio::test]
async fn keeps_ranks_needed_and_logs_roster_frozen_once() {
    let (logs, _g) = capture_logs();
    let mut h = setup(Setup {
        script: vec![now(answer(|a| {
            a.ranks_needed = vec![FRIEND.into()];
            a.roster_frozen = true;
            a.status = "in_game".into();
            a.member_count = 10;
        }))],
        routes: vec![(friend_lookup(), Route::json(404, &json!({})))],
        ..Default::default()
    })
    .await;
    h.update(lobby("lobby--two-players"), LcuEventType::Update);
    h.settled().await;
    h.update(lobby("lobby--two-players"), LcuEventType::Update);
    h.settled().await;
    let view = h.watcher.view().borrow().clone();
    assert_eq!(view.ranks_needed(), [FRIEND]);
    assert!(view.last_response.unwrap().roster_frozen);
    assert_eq!(logs.count("roster is frozen"), 1);
    assert!(
        h.drain_signals()
            .contains(&LobbySignal::RanksNeeded(vec![FRIEND.into()]))
    );
}

// --- failures ---------------------------------------------------------------------------------------------

#[tokio::test]
async fn retries_a_5xx_while_newest_and_a_newer_roster_cancels_the_retry() {
    let h = setup(Setup {
        script: vec![now(http(503)), now(ok_answer())],
        manual_timers: true,
        routes: vec![(friend_lookup(), Route::json(404, &json!({})))],
        ..Default::default()
    })
    .await;
    h.update(lobby("lobby"), LcuEventType::Update);
    h.settled().await;
    assert_eq!(h.posts().len(), 1);
    assert_eq!(h.scheduler.len(), 1);
    assert!(h.scheduler.get(0).delay <= Duration::from_millis(40));
    h.scheduler.get(0).fire();
    until(|| h.posts().len() == 2, "retry").await;
    h.settled().await;
    assert_eq!(h.posts()[0], h.posts()[1], "the retry is the same payload");

    let h2 = setup(Setup {
        script: vec![now(http(500)), now(ok_answer())],
        manual_timers: true,
        routes: vec![(friend_lookup(), Route::json(404, &json!({})))],
        ..Default::default()
    })
    .await;
    h2.update(lobby("lobby"), LcuEventType::Update);
    h2.settled().await;
    assert_eq!(h2.scheduler.len(), 1);
    h2.update(lobby("lobby--two-players"), LcuEventType::Update);
    h2.settled().await;
    assert!(h2.scheduler.get(0).is_cancelled());
    assert_eq!(h2.posts().len(), 2);
    assert_eq!(h2.posts()[1].members.len(), 2);
}

#[tokio::test]
async fn never_resends_a_superseded_5xx_payload_one_attempt_per_post() {
    let h = setup(Setup {
        script: vec![now(http(503)), now(ok_answer())],
        manual_timers: true,
        routes: vec![(friend_lookup(), Route::json(404, &json!({})))],
        ..Default::default()
    })
    .await;
    h.update(lobby("lobby"), LcuEventType::Update);
    h.settled().await;
    assert_eq!(h.posts().len(), 1);
    let started = Instant::now();
    h.update(lobby("lobby--two-players"), LcuEventType::Update);
    until(|| h.posts().len() == 2, "new roster posted").await;
    assert!(started.elapsed() < Duration::from_millis(500));
    h.settled().await;
    pause(50).await;
    let posts = h.posts();
    assert_eq!(posts.len(), 2);
    assert_eq!((posts[0].members.len(), posts[1].members.len()), (1, 2));
    assert!(h.scheduler.get(0).is_cancelled());
}

#[tokio::test]
async fn a_new_payload_starts_a_fresh_retry_schedule() {
    let h = setup(Setup {
        script: vec![now(http(503)), now(http(503)), now(http(503)), now(ok_answer())],
        manual_timers: true,
        backoff: BackoffOptions {
            min: Duration::from_millis(100),
            max: Duration::from_millis(10_000),
            factor: 10.0,
            random: Arc::new(|| 1.0),
        },
        routes: vec![(friend_lookup(), Route::json(404, &json!({})))],
        ..Default::default()
    })
    .await;
    h.update(lobby("lobby"), LcuEventType::Update);
    h.settled().await;
    assert_eq!(h.scheduler.get(0).delay, Duration::from_millis(100));
    h.scheduler.get(0).fire();
    until(|| h.posts().len() == 2, "first retry").await;
    h.settled().await;
    assert_eq!(h.scheduler.get(1).delay, Duration::from_millis(1_000));
    h.update(lobby("lobby--two-players"), LcuEventType::Update);
    until(|| h.posts().len() == 3, "new roster").await;
    h.settled().await;
    assert_eq!(h.scheduler.get(2).delay, Duration::from_millis(100), "not 10 000");
}

#[tokio::test]
async fn no_name_lookups_for_a_party_refused_with_403() {
    let h = setup(Setup {
        script: vec![now(http(403))],
        routes: vec![(
            friend_lookup(),
            Route::json(200, &body("16.17", "summoner-by-puuid--other")),
        )],
        ..Default::default()
    })
    .await;
    h.update(lobby("lobby"), LcuEventType::Update);
    h.settled().await;
    h.update(lobby("lobby--two-players"), LcuEventType::Update);
    pause(50).await;
    h.settled().await;
    assert_eq!(h.posts().len(), 1);
    assert_eq!(h.lookups(), 0);
}

#[tokio::test]
async fn stops_posting_a_party_after_a_403_until_the_next_create() {
    let (logs, _g) = capture_logs();
    let h = setup(Setup {
        script: vec![now(http(403)), now(ok_answer())],
        ..Default::default()
    })
    .await;
    let l = lobby("lobby");
    h.update(l.clone(), LcuEventType::Update);
    h.settled().await;
    h.update(l.clone(), LcuEventType::Update);
    h.update(l.clone(), LcuEventType::Update);
    pause(30).await;
    h.settled().await;
    assert_eq!(h.posts().len(), 1);
    assert_eq!(logs.count("api refused the lobby post"), 1);
    h.update(l, LcuEventType::Create);
    h.settled().await;
    assert_eq!(h.posts().len(), 2);
}

#[tokio::test]
async fn drops_an_unreadable_2xx_without_retrying_or_erroring() {
    let (logs, _g) = capture_logs();
    let h = setup(Setup {
        script: vec![now(PostOutcome::Unreadable("lobbyId: invalid".into()))],
        manual_timers: true,
        ..Default::default()
    })
    .await;
    h.update(lobby("lobby"), LcuEventType::Update);
    h.settled().await;
    assert_eq!(h.posts().len(), 1);
    assert_eq!(h.scheduler.len(), 0);
    assert!(logs.text().contains("lobby post dropped") && logs.text().contains("schema"));
    assert!(!logs.text().contains("ERROR"));
}

#[tokio::test]
async fn drops_a_400_without_retrying() {
    let (logs, _g) = capture_logs();
    let h = setup(Setup {
        script: vec![now(http(400))],
        manual_timers: true,
        ..Default::default()
    })
    .await;
    h.update(lobby("lobby"), LcuEventType::Update);
    h.settled().await;
    assert_eq!(h.scheduler.len(), 0);
    assert!(logs.text().contains("lobby post dropped") && logs.text().contains("400"));
}

#[tokio::test]
async fn check_11_writes_no_event_body_and_no_chat_credential_to_the_log() {
    let (logs, _g) = capture_logs();
    let h = setup(Setup {
        script: vec![
            now(answer(|a| a.recheck_in_ms = Some(50))),
            now(PostOutcome::Http {
                status: 500,
                error: "x".into(),
            }),
            now(ok_answer()),
        ],
        routes: vec![(friend_lookup(), Route::json(404, &json!({})))],
        ..Default::default()
    })
    .await;
    let mut raw = body("16.17", "lobby--spectator");
    assert!(raw.get("mucJwtDto").is_some());
    raw["mucJwtDto"] = json!({ "jwt": "live-jwt-value" });
    raw["multiUserChatPassword"] = json!("live-chat-password");
    h.update(serde_json::from_value(raw).unwrap(), LcuEventType::Create);
    h.settled().await;
    h.remove();
    pause(150).await;
    h.settled().await;
    let text = logs.text();
    for needle in [
        "mucJwtDto",
        "multiUserChatPassword",
        "live-jwt-value",
        "live-chat-password",
        "customTeam100",
    ] {
        assert!(!text.contains(needle), "{needle} leaked");
    }
}

#[tokio::test]
async fn emits_custom_lobby_and_lobby_gone_on_disconnect_for_the_game_watcher() {
    let mut h = setup(Setup::default()).await;
    h.update(lobby("lobby"), LcuEventType::Update);
    h.settled().await;
    h.watcher.send(MachineEvent::Disconnected(
        engine::watchers::connection::DisconnectReason::SocketClosed,
    ));
    h.settled().await;
    let signals = h.drain_signals();
    assert!(signals.contains(&LobbySignal::CustomLobby {
        party_id: PARTY.into()
    }));
    assert_eq!(
        signals.last(),
        Some(&LobbySignal::LobbyGone {
            reason: LobbyGoneReason::Disconnected
        })
    );
}

// --- through the connection machine ---------------------------------------------------------------------

struct NoProcesses;
impl ProcessLister for NoProcesses {
    async fn list(&self) -> ProcessList {
        ProcessList::Listed(Vec::new())
    }
}

fn machine_routes() -> HashMap<String, Route> {
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
            Route::json(200, &body("16.17", "current-summoner")),
        ),
        (
            "GET /lol-gameflow/v1/gameflow-phase".into(),
            Route::json(200, &json!("Lobby")),
        ),
    ])
}

async fn machine_with(
    pki: Arc<Pki>,
    fake: &FakeClient,
    watcher: &LobbyWatcherHandle,
) -> (engine::watchers::connection::MachineHandle, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
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
        backoff: BackoffOptions {
            min: Duration::from_millis(20),
            max: Duration::from_millis(60),
            ..Default::default()
        },
        request_timeout: Duration::from_secs(2),
        ..Default::default()
    };
    let machine = spawn_machine(
        discover,
        Arc::new(move || Ok(pki.verifier())),
        options,
        vec![watcher.feed()],
    );
    (machine, dir)
}

#[tokio::test]
async fn through_the_machine_posts_at_connect_on_events_and_after_a_reconnect() {
    let pki: Arc<Pki> = Arc::new(pki("Fake Riot Root"));
    let mut routes = machine_routes();
    routes.insert(LOBBY_GET.into(), Route::json(200, &body("16.17", "lobby")));
    routes.insert(
        friend_lookup(),
        Route::json(200, &body("16.17", "summoner-by-puuid--other")),
    );
    let fake = start_fake_client(&pki, routes).await;
    let poster = ScriptedPoster::ok();
    let (watcher, _signals) = spawn_lobby_watcher(
        poster.clone(),
        LobbyWatcherOptions {
            lookup_interval: Duration::from_millis(5),
            ..Default::default()
        },
    );
    let (machine, _dir) = machine_with(pki, &fake, &watcher).await;
    assert!(
        machine
            .wait_for_state(MachineState::Watching, Duration::from_secs(5))
            .await
    );
    until(|| poster.posted().len() == 1, "post at connect").await;
    assert_eq!(poster.posted()[0].members.len(), 1);

    fake.wait_for_sockets(1).await;
    fake.emit("/lol-lobby/v2/lobby", "Update", body("16.17", "lobby--spectator"));
    until(
        || {
            poster.posted().len() >= 2
                && poster
                    .posted()
                    .last()
                    .unwrap()
                    .members
                    .get(1)
                    .is_some_and(|m| m.game_name.is_some())
        },
        "spectator post with the friend's name",
    )
    .await;
    let last = poster.posted().last().unwrap().clone();
    assert_eq!(
        (
            last.members[1].puuid.as_str(),
            last.members[1].side,
            last.members[1].is_spectator
        ),
        (FRIEND, None, true)
    );
    assert_eq!(last.members[1].game_name.as_deref(), Some("XETA"));

    fake.emit("/lol-lobby/v2/lobby", "Delete", Value::Null);
    pause(50).await;
    let before = poster.posted().len();
    fake.close_sockets(1001, "restart");
    assert!(
        machine
            .wait_for_next_state(MachineState::Disconnected, Duration::from_secs(5))
            .await
    );
    assert!(
        machine
            .wait_for_state(MachineState::Watching, Duration::from_secs(5))
            .await
    );
    until(|| poster.posted().len() == before + 1, "reconnect GET posted").await;
    assert_eq!(poster.posted().last().unwrap().members.len(), 1);
    assert_eq!(fake.requests_to("/lol-lobby/v2/lobby"), 2);
    machine.stop().await;
    watcher.stop();
}

#[tokio::test]
async fn the_recorded_evening_through_the_machine_matches_the_45_golden_lobby_bodies() {
    let golden: Value = serde_json::from_str(
        &std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/goldens/sequence--ws-events.json"),
        )
        .unwrap(),
    )
    .unwrap();
    let expected: Vec<Value> = golden["requests"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|r| r["route"] == "lobby")
        .map(|r| r["body"].clone())
        .collect();
    assert_eq!(expected.len(), 45);

    let pki: Arc<Pki> = Arc::new(pki("Fake Riot Root"));
    let mut routes = machine_routes();
    routes.insert(
        LOBBY_GET.into(),
        Route::json(
            404,
            &json!({ "errorCode": "RPC_ERROR", "httpStatus": 404, "message": "LOBBY_NOT_FOUND" }),
        ),
    );
    let fake = start_fake_client(&pki, routes).await;
    let poster = ScriptedPoster::ok();
    let (watcher, _signals) = spawn_lobby_watcher(
        poster.clone(),
        LobbyWatcherOptions {
            lookup_interval: Duration::from_millis(1),
            ..Default::default()
        },
    );
    let (machine, _dir) = machine_with(pki, &fake, &watcher).await;
    assert!(
        machine
            .wait_for_state(MachineState::Watching, Duration::from_secs(5))
            .await
    );
    fake.wait_for_sockets(1).await;
    assert!(watcher.settled(SETTLE).await);

    let text = std::fs::read_to_string(fixtures_dir().join("16.17/ws-events.ndjson")).unwrap();
    let mut lobby_events = 0u64;
    let mut view = watcher.view();
    for line in text.lines().filter(|l| !l.is_empty()) {
        let record: Value = serde_json::from_str(line).unwrap();
        if record.get("dropped").is_some() || record.get("redacted").is_some() {
            continue;
        }
        let uri = record["uri"].as_str().unwrap();
        fake.emit(uri, record["eventType"].as_str().unwrap(), record["data"].clone());
        if uri == "/lol-lobby/v2/lobby" {
            lobby_events += 1;
            let target = lobby_events;
            tokio::time::timeout(
                Duration::from_secs(5),
                view.wait_for(|v| v.lobby_events >= target),
            )
            .await
            .unwrap()
            .unwrap();
            assert!(watcher.settled(SETTLE).await);
        }
    }
    let posted = poster.posted_json();
    assert_eq!(
        posted.len(),
        expected.len(),
        "every Create/Update posted, no dedupe"
    );
    for (i, (got, want)) in posted.iter().zip(&expected).enumerate() {
        assert_eq!(got, want, "lobby post {i} differs from the golden");
    }
    machine.stop().await;
    watcher.stop();
}

// --- review round 1: no task outlives stop; dropping the handle stops it -----------------------------------

async fn hanging_watcher() -> (LobbyWatcherHandle, tokio::net::TcpListener) {
    // A port that accepts TCP (the backlog) but never speaks TLS: every client read hangs.
    let hole = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let pki = pki("Fake Riot Root");
    let client = LcuClient::with_verifier(
        &credentials(hole.local_addr().unwrap().port()),
        pki.verifier(),
        Duration::from_secs(30),
    )
    .unwrap();
    let context = Arc::new(ConnectedContext {
        client,
        version: "16.17.1".into(),
        patch: Some("16.17".into()),
        summoner: None,
        phase: Some("Lobby".into()),
        port: 1,
    });
    let poster = ScriptedPoster::new(vec![(ok_answer(), Duration::from_secs(30))]);
    let (watcher, _signals) = spawn_lobby_watcher(poster, LobbyWatcherOptions::default());
    watcher.send(MachineEvent::Connected(context));
    watcher.send(MachineEvent::Event(Arc::new(RoutedEvent::Lobby {
        event_type: LcuEventType::Update,
        lobby: Some(Box::new(lobby("lobby"))),
    })));
    let mut view = watcher.view();
    tokio::time::timeout(Duration::from_secs(2), view.wait_for(|v| v.live_tasks >= 3))
        .await
        .unwrap()
        .unwrap();
    (watcher, hole)
}

#[tokio::test]
async fn no_task_outlives_stop() {
    // A connect read, a name lookup and a post, all hanging.
    let (watcher, _hole) = hanging_watcher().await;
    let started = Instant::now();
    watcher.stop();
    tokio::time::timeout(Duration::from_secs(2), watcher.stopped())
        .await
        .expect("watcher did not stop");
    assert!(started.elapsed() < Duration::from_millis(500));
    let view = watcher.view().borrow().clone();
    assert!(view.exited);
    assert_eq!(view.live_tasks, 0, "every task aborted");
}

#[tokio::test]
async fn dropping_the_handle_stops_the_watcher() {
    let (watcher, _hole) = hanging_watcher().await;
    let mut view = watcher.view();
    drop(watcher);
    tokio::time::timeout(Duration::from_secs(2), view.wait_for(|v| v.exited))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(view.borrow().live_tasks, 0);
}

// --- the real poster: M17.6's API client ---------------------------------------------------------------------

fn api_with(
    handler: impl Fn(&engine::api::transport::HttpRequest) -> Result<engine::api::transport::HttpResponse, String>
    + Send
    + Sync
    + 'static,
) -> (
    Arc<engine::api::ApiClient>,
    Arc<engine::test_support::FakeTransport>,
) {
    let fake = engine::test_support::FakeTransport::new(handler);
    let token = engine::config::CompanionToken::parse("SYNTHETIC_lobbyposter_xxxxxxxxxxxxxxxxxxxxx").unwrap();
    let mut options = engine::api::ApiClientOptions::new("https://kustom.invalid", Some(token), fake.clone());
    options.backoff.min = Duration::from_millis(1);
    options.backoff.max = Duration::from_millis(2);
    (Arc::new(engine::api::ApiClient::new(options)), fake)
}

fn lobby_answer_body(recheck: &str) -> String {
    format!(
        r#"{{"ok":true,"lobbyId":"3f1e2d4c-5b6a-4798-8c9d-0e1f2a3b4c5d","status":"open","created":true,"memberCount":1,"rosterFrozen":false,"recheckInMs":{recheck},"ranksNeeded":["{FRIEND}"]}}"#
    )
}

#[tokio::test]
async fn posts_through_the_api_client_one_attempt_each() {
    let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let counter = calls.clone();
    let (api, fake) = api_with(move |_| {
        // First post: 503 (one attempt only, the watcher owns the retry). Second: the answer.
        match counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst) {
            0 => engine::test_support::respond(503, r#"{"ok":false,"error":"try later"}"#),
            _ => engine::test_support::respond(200, &lobby_answer_body("null")),
        }
    });
    let scheduler = Arc::new(ManualScheduler::default());
    let (watcher, mut signals) = spawn_lobby_watcher(
        api,
        LobbyWatcherOptions {
            scheduler: scheduler.clone(),
            ..Default::default()
        },
    );
    let pki = pki("Fake Riot Root");
    let fake_client = start_fake_client(
        &pki,
        HashMap::from([(
            LOBBY_GET.to_string(),
            Route::json(
                404,
                &json!({ "errorCode": "RPC_ERROR", "httpStatus": 404, "message": "LOBBY_NOT_FOUND" }),
            ),
        )]),
    )
    .await;
    let client = LcuClient::with_verifier(
        &credentials(fake_client.port),
        pki.verifier(),
        Duration::from_secs(2),
    )
    .unwrap();
    watcher.send(MachineEvent::Connected(Arc::new(ConnectedContext {
        client,
        version: "16.17.1".into(),
        patch: Some("16.17".into()),
        summoner: Some(own()),
        phase: Some("Lobby".into()),
        port: fake_client.port,
    })));
    watcher.send(MachineEvent::Event(Arc::new(RoutedEvent::Lobby {
        event_type: LcuEventType::Update,
        lobby: Some(Box::new(lobby("lobby"))),
    })));
    assert!(watcher.settled(SETTLE).await);
    assert_eq!(fake.requests().len(), 1, "one attempt, no ApiClient retry");
    assert_eq!(scheduler.len(), 1, "the watcher scheduled its own retry");
    scheduler.get(0).fire();
    until(|| fake.requests().len() == 2, "watcher retry").await;
    assert!(watcher.settled(SETTLE).await);
    for request in fake.requests() {
        assert!(request.url.ends_with("/api/companion/lobby"));
        let sent: Value = serde_json::from_slice(request.body.as_deref().unwrap()).unwrap();
        assert_eq!(sent, golden_body("lobby--lobby"));
    }
    let view = watcher.view().borrow().clone();
    assert_eq!(
        view.last_response.as_ref().map(|a| a.status.as_str()),
        Some("open")
    );
    let mut saw_ranks = false;
    while let Ok(signal) = signals.try_recv() {
        saw_ranks |= signal == LobbySignal::RanksNeeded(vec![FRIEND.into()]);
    }
    assert!(saw_ranks);
}

#[tokio::test]
async fn an_unreadable_2xx_from_the_api_client_is_dropped_not_retried() {
    let (api, fake) = api_with(|_| engine::test_support::respond(200, r#"{"ok":true,"lobbyId":"nope"}"#));
    let scheduler = Arc::new(ManualScheduler::default());
    let (watcher, _signals) = spawn_lobby_watcher(
        api,
        LobbyWatcherOptions {
            scheduler: scheduler.clone(),
            ..Default::default()
        },
    );
    watcher.send(MachineEvent::Event(Arc::new(RoutedEvent::Lobby {
        event_type: LcuEventType::Update,
        lobby: Some(Box::new(lobby("lobby"))),
    })));
    assert!(watcher.settled(SETTLE).await);
    assert_eq!(fake.requests().len(), 1);
    assert_eq!(scheduler.len(), 0);
}
