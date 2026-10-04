//! Every recorded fixture in `packages/lcu/fixtures/16.17` and `16.18` that the engine reads parses into its
//! Rust type, and every recorded WebSocket event on a routed URI routes without a drop (M17.5 acceptance:
//! "unit tests on the fixtures for every parse").

#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

mod support;

use engine::lcu::events::{Frame, LcuEvent, LcuEventType, RoutedEvent, parse_frame, route};
use engine::lcu::types::{
    CustomGameQueues, EogStatsBlock, GameQueue, GameflowSession, LcuErrorBody, Lobby, MatchDetail,
    MatchHistoryList, RankedStats, Summoner, TeamId,
};
use serde::de::DeserializeOwned;
use serde_json::Value;
use support::{body, fixtures_dir};

fn parse<T: DeserializeOwned>(patch: &str, id: &str) -> T {
    serde_json::from_value(body(patch, id)).unwrap_or_else(|e| panic!("{patch}/{id}: {e}"))
}

#[test]
fn every_read_fixture_parses() {
    let version: String = parse("16.17", "game-version");
    assert!(version.starts_with("16.17."));
    let me: Summoner = parse("16.17", "current-summoner");
    assert_eq!(me.puuid, "34151cbd-d9f8-5dad-9dc8-c6a8e253c0de");
    assert_eq!(me.game_name, "PRT Empty");
    let _: Summoner = parse("16.17", "summoner-by-puuid");
    let other: Summoner = parse("16.17", "summoner-by-puuid--other");
    assert_eq!(other.game_name, "XETA");

    for id in [
        "current-ranked-stats",
        "ranked-stats-by-puuid",
        "ranked-stats-by-puuid--other",
        "ranked-stats-by-puuid--ws-cached",
    ] {
        let stats: RankedStats = parse("16.17", id);
        let solo = stats.queue_map.ranked_solo_5x5.expect(id);
        assert_eq!(solo.queue_type, "RANKED_SOLO_5x5");
    }
    let own: RankedStats = parse("16.17", "current-ranked-stats");
    let solo = own.queue_map.ranked_solo_5x5.unwrap();
    assert_eq!(
        (solo.tier.as_str(), solo.division.as_str(), solo.league_points),
        ("SILVER", "IV", 30)
    );
    assert!(
        !own.queue_map.other.is_empty(),
        "the TFT queues ride along unread"
    );
    let unranked: RankedStats = parse("16.17", "ranked-stats-by-puuid--ws-cached");
    let solo = unranked.queue_map.ranked_solo_5x5.unwrap();
    assert_eq!((solo.tier.as_str(), solo.division.as_str()), ("", "NA"));

    let phase: String = parse("16.17", "gameflow-phase");
    assert_eq!(phase, "EndOfGame");
    let session: GameflowSession = parse("16.17", "gameflow-session");
    assert_eq!(
        (
            session.phase.as_str(),
            session.game_data.game_id,
            session.game_data.is_custom_game
        ),
        ("EndOfGame", 4000969091, true)
    );
    let in_lobby: GameflowSession = parse("16.17", "gameflow-session--in-lobby");
    assert_eq!(in_lobby.phase, "Lobby");

    for (patch, id) in [
        ("16.17", "lobby"),
        ("16.17", "lobby--two-players"),
        ("16.17", "lobby--spectator"),
        ("16.18", "create-lobby"),
        ("16.18", "create-lobby--ui-live-3110"),
    ] {
        let lobby: Lobby = parse(patch, id);
        assert!(lobby.game_config.is_custom, "{patch}/{id}");
        assert!(!lobby.party_id.is_empty());
    }
    let spectator: Lobby = parse("16.17", "lobby--spectator");
    assert!(spectator.members.iter().any(|m| m.is_spectator));
    assert_eq!(
        spectator.game_config.custom_spectators.as_ref().map(Vec::len),
        Some(1)
    );

    let block: EogStatsBlock = parse("16.17", "eog-stats-block");
    assert_eq!(
        (block.game_id, block.game_type.as_str(), block.game_length),
        (4000969091, "CUSTOM_GAME", 913)
    );
    assert_eq!(
        block.teams.iter().find(|t| t.is_winning_team).map(|t| t.team_id),
        Some(TeamId::Red)
    );
    assert_eq!(block.end_of_game_timestamp, Some(1788886380672.0));
    assert_eq!(
        block.local_player.detected_team_position.as_deref(),
        Some("JUNGLE")
    );

    for id in ["match-history", "match-history--other"] {
        let list: MatchHistoryList = parse("16.17", id);
        assert_eq!(list.games.games.len(), 21, "{id}");
    }
    let detail: MatchDetail = parse("16.17", "match-detail");
    assert_eq!(
        (
            detail.game_id,
            detail.participants.len(),
            detail.participant_identities.len()
        ),
        (4000769615, 10, 10)
    );

    let dialog: CustomGameQueues = parse("16.18", "custom-game-queues");
    assert_eq!(dialog.game_server_regions, None, "null on 16.18, accepted");
    assert!(
        dialog
            .subcategories
            .iter()
            .any(|s| s.map_id == 11 && s.game_mode == "CLASSIC")
    );
    let queues: Vec<GameQueue> = parse("16.18", "game-queues");
    assert_eq!(
        queues
            .iter()
            .find(|q| q.id == 3110)
            .and_then(|q| q.name.as_deref()),
        Some("SR Draft Pick Custom")
    );
}

#[test]
fn every_error_fixture_parses_as_the_clients_error_body() {
    for (patch, id) in [
        ("16.17", "create-lobby--legacy-blind"),
        ("16.17", "create-lobby--legacy-draft"),
        ("16.17", "lobby-invitations--no-lobby"),
        ("16.17", "lobby-invitations--by-puuid--no-lobby"),
    ] {
        let error: LcuErrorBody = parse(patch, id);
        assert!(error.http_status >= 400, "{patch}/{id}");
    }
}

#[test]
fn every_fixture_file_is_read_by_a_test_or_listed_as_unread() {
    // A new fixture must be parsed above or named here with a reason, so nothing the engine reads goes untested.
    let read = [
        "game-version",
        "current-summoner",
        "summoner-by-puuid",
        "summoner-by-puuid--other",
        "current-ranked-stats",
        "ranked-stats-by-puuid",
        "ranked-stats-by-puuid--other",
        "ranked-stats-by-puuid--ws-cached",
        "gameflow-phase",
        "gameflow-session",
        "gameflow-session--in-lobby",
        "lobby",
        "lobby--two-players",
        "lobby--spectator",
        "create-lobby",
        "create-lobby--ui-live-3110",
        "eog-stats-block",
        "match-history",
        "match-history--other",
        "match-detail",
        "custom-game-queues",
        "game-queues",
        "create-lobby--legacy-blind",
        "create-lobby--legacy-draft",
        "lobby-invitations--no-lobby",
        "lobby-invitations--by-puuid--no-lobby",
        // Write answers: the client's answer body is never depended on (any 2xx is accepted).
        "lobby-invitations",
        "lobby-team",
        // Smoke-only reads the Rust bridge never makes (M17 endpoint list).
        "alias-lookup",
        "system-builds",
        // Not an endpoint.
        "manifest",
    ];
    for patch in ["16.17", "16.18"] {
        for entry in std::fs::read_dir(fixtures_dir().join(patch)).unwrap() {
            let name = entry.unwrap().file_name().to_string_lossy().into_owned();
            // The client's raw OpenAPI dumps are gitignored (`packages/lcu/fixtures/**/swagger-*.json` and
            // `openapi-*.json` in `.gitignore`): they exist only on a developer's disk, never in CI, and are
            // not endpoints the engine reads. Same patterns, no git call.
            let gitignored_dump =
                (name.starts_with("swagger-") || name.starts_with("openapi-")) && name.ends_with(".json");
            if gitignored_dump {
                continue;
            }
            if let Some(id) = name.strip_suffix(".json") {
                assert!(read.contains(&id), "{patch}/{name} is not covered");
            }
        }
    }
}

#[test]
fn every_recorded_event_on_a_routed_uri_routes() {
    let text = std::fs::read_to_string(fixtures_dir().join("16.17/ws-events.ndjson")).unwrap();
    let mut counts = std::collections::BTreeMap::<&str, usize>::new();
    for line in text.lines().filter(|l| !l.is_empty()) {
        let record: Value = serde_json::from_str(line).unwrap();
        if record.get("dropped").is_some() || record.get("redacted").is_some() {
            continue;
        }
        // Re-frame it as the client sent it and run it through the real parser.
        let frame = serde_json::json!([8, record["topic"], { "data": record["data"], "eventType": record["eventType"], "uri": record["uri"] }]);
        let Frame::Event(event) = parse_frame(&frame.to_string()) else {
            panic!("{line}")
        };
        let routed = route(&event).unwrap_or_else(|d| panic!("dropped {}: {}", d.uri, d.reason));
        let key = match routed {
            RoutedEvent::Lobby { lobby: Some(_), .. } => "lobby",
            RoutedEvent::Lobby { lobby: None, .. } => "lobby delete",
            RoutedEvent::GameflowPhase(_) => "phase",
            RoutedEvent::EogBlock { block: Some(_), .. } => "eog",
            RoutedEvent::EogBlock { block: None, .. } => "eog delete",
            RoutedEvent::RankedStats { .. } => "ranked",
            RoutedEvent::Ignored => "ignored",
        };
        *counts.entry(key).or_default() += 1;
    }
    assert_eq!(counts.get("lobby"), Some(&45));
    assert_eq!(counts.get("lobby delete"), Some(&2));
    assert_eq!(counts.get("phase"), Some(&20));
    assert_eq!(counts.get("eog"), Some(&4));
    assert_eq!(counts.get("eog delete"), Some(&1));
}

#[test]
fn the_ws_cached_ranked_overlay_routes_by_its_uri() {
    let event = LcuEvent {
        topic: "OnJsonApiEvent".into(),
        uri: "/lol-ranked/v1/cached-ranked-stats/c04e977c-133a-5d94-9fd3-6202f8beec4c".into(),
        event_type: LcuEventType::Update,
        data: body("16.17", "ranked-stats-by-puuid--ws-cached"),
    };
    let RoutedEvent::RankedStats { puuid, .. } = route(&event).unwrap() else {
        panic!()
    };
    assert_eq!(puuid, "c04e977c-133a-5d94-9fd3-6202f8beec4c");
}

/// Live, 16.19: `mucJwtDto` changed type against the 16.17 fixture. The lobby struct never reads it (chat
/// credentials), so any shape, or none, still parses and maps the same.
#[test]
fn the_lobby_does_not_depend_on_muc_jwt_dto() {
    let base = support::body("16.17", "lobby");
    let expected: engine::lcu::types::Lobby = serde_json::from_value(base.clone()).unwrap();
    for muc in [
        serde_json::json!("a-string-now"),
        serde_json::json!(42),
        serde_json::json!(null),
        serde_json::json!({ "jwt": "x", "channelClaim": "y", "domain": "z", "targetRegion": "eun1" }),
    ] {
        let mut lobby = base.clone();
        lobby["mucJwtDto"] = muc;
        let parsed: engine::lcu::types::Lobby = serde_json::from_value(lobby).unwrap();
        assert_eq!(parsed, expected);
    }
    let mut without = base.clone();
    without.as_object_mut().unwrap().remove("mucJwtDto");
    let parsed: engine::lcu::types::Lobby = serde_json::from_value(without).unwrap();
    assert_eq!(parsed, expected);
}
