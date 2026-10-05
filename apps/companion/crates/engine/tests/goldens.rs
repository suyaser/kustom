//! Every golden in `tests/goldens/` (the TypeScript engine's exact requests for every recorded fixture,
//! written by `pnpm --filter companion make-goldens`) deserialises into the engine's wire types and
//! serialises back JSON-equal (M17.4).
//!
//! JSON-equal, not byte-equal: key order and whitespace are free, but every key, every `null` and every
//! absent key must survive the round trip, so the placeholder types already pin the contract the Rust
//! watchers will be held to byte for byte in M17.7 to M17.11 (where the bodies come from the Rust mappers
//! instead of from the golden itself).

#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use engine::api::wire::{
    BackfillScanRequest, CommandAck, CommandNack, CommandsPoll, GamePayload, LobbyPayload, PairRequest,
    RankPayload,
};
use engine::queue::QueueFile;
use engine::watchers::CommandsDoneFile;
use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::Value;

fn goldens_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("goldens")
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Index {
    counts: Counts,
    goldens: Vec<IndexEntry>,
}

#[derive(Debug, Deserialize)]
struct Counts {
    total: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IndexEntry {
    file: String,
    route: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Golden {
    name: String,
    kind: String,
    target: String,
    route: String,
    patch: String,
    fixtures: Vec<String>,
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    command_kind: Option<String>,
    #[serde(default)]
    body: Value,
    #[serde(default)]
    requests: Vec<SequenceRequest>,
    #[serde(default)]
    file: Value,
}

#[derive(Debug, Deserialize)]
struct SequenceRequest {
    route: String,
    method: String,
    path: String,
    #[serde(default)]
    body: Value,
}

fn read_index() -> Index {
    let text = fs::read_to_string(goldens_dir().join("index.json")).expect("index.json");
    serde_json::from_str(&text).expect("index.json parses")
}

fn read_golden(file: &str) -> Golden {
    let text = fs::read_to_string(goldens_dir().join(file)).unwrap_or_else(|e| panic!("{file}: {e}"));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{file}: not a golden: {e}"))
}

/// Deserialises `value` as `T` and serialises it back; the two must be the same JSON.
fn round_trip<T: DeserializeOwned + serde::Serialize>(label: &str, value: &Value) -> T {
    let typed: T = serde_json::from_value(value.clone())
        .unwrap_or_else(|e| panic!("{label}: does not deserialise: {e}\n{value:#}"));
    let back = serde_json::to_value(&typed).expect("serialises");
    assert_eq!(&back, value, "{label}: the round trip changed the JSON");
    typed
}

/// Checks one request against the wire type for its route.
fn check(label: &str, route: &str, path: &str, body: &Value, command_kind: Option<&str>) {
    match route {
        "lobby" => {
            round_trip::<LobbyPayload>(label, body);
        }
        "game" => {
            round_trip::<GamePayload>(label, body);
        }
        "rank" => {
            round_trip::<RankPayload>(label, body);
        }
        "backfill-scan" => {
            round_trip::<BackfillScanRequest>(label, body);
        }
        "pair" => {
            round_trip::<PairRequest>(label, body);
        }
        "command-ack" => {
            let ack = round_trip::<CommandAck>(label, body);
            assert_eq!(
                Some(ack.result.kind()),
                command_kind,
                "{label}: result is for the wrong kind"
            );
            assert!(path.ends_with("/ack"), "{label}: {path}");
        }
        "command-nack" => {
            let nack = round_trip::<CommandNack>(label, body);
            assert!(
                !nack.error.is_empty() && nack.error.chars().count() <= 500,
                "{label}"
            );
            assert!(path.ends_with("/nack"), "{label}: {path}");
        }
        "commands-poll" => {
            assert!(body.is_null(), "{label}: a poll has no body");
            let client_connected = match path.rsplit_once("clientConnected=") {
                Some((_, "true")) => true,
                Some((_, "false")) => false,
                _ => panic!("{label}: not a poll path: {path}"),
            };
            assert_eq!(CommandsPoll { client_connected }.path(), path, "{label}");
        }
        "queue-file" => {
            // The file is read leniently (payload kept verbatim), but what the engine writes is a real body.
            let file = round_trip::<QueueFile>(label, body);
            round_trip::<GamePayload>(label, &file.payload);
        }
        "commands-done-file" => {
            round_trip::<CommandsDoneFile>(label, body);
        }
        // Writes to the League client: their types arrive with the bridge (M17.5) and the command runner
        // (M17.10). Until then, the path is the verified lobby write.
        "lcu-switch-side" => {
            assert!(
                path == "/lol-lobby/v2/lobby/team/TEAM1" || path == "/lol-lobby/v2/lobby/team/TEAM2",
                "{label}: {path}"
            );
            assert!(body.is_null(), "{label}: the switch has no body");
        }
        other => panic!("{label}: unknown route {other}"),
    }
}

#[test]
fn the_index_lists_every_golden_file() {
    let index = read_index();
    let listed: BTreeSet<String> = index.goldens.iter().map(|entry| entry.file.clone()).collect();
    let on_disk: BTreeSet<String> = fs::read_dir(goldens_dir())
        .expect("goldens dir")
        .map(|entry| entry.expect("entry").file_name().to_string_lossy().into_owned())
        .filter(|name| name.ends_with(".json") && name != "index.json")
        .collect();
    assert_eq!(listed, on_disk);
    assert_eq!(index.counts.total, on_disk.len());
    assert!(
        on_disk.len() >= 25,
        "expected the full golden set, found {}",
        on_disk.len()
    );
}

#[test]
fn every_golden_round_trips_through_the_wire_types() {
    let index = read_index();
    let mut routes = BTreeSet::new();
    for entry in &index.goldens {
        let golden = read_golden(&entry.file);
        assert_eq!(
            golden.route, entry.route,
            "{}: index and file disagree",
            entry.file
        );
        assert_eq!(format!("{}.json", golden.name), entry.file);
        assert!(
            golden.patch == "16.17" || golden.patch == "16.18",
            "{}: patch {}",
            entry.file,
            golden.patch
        );
        assert!(golden.fixtures.iter().all(|f| f.contains('/')), "{}", entry.file);
        match golden.kind.as_str() {
            "request" => {
                let path = golden.path.as_deref().unwrap_or_default();
                check(
                    &golden.name,
                    &golden.route,
                    path,
                    &golden.body,
                    golden.command_kind.as_deref(),
                );
                routes.insert(golden.route.clone());
            }
            "file" => {
                assert_eq!(golden.target, "disk", "{}", golden.name);
                check(&golden.name, &golden.route, "", &golden.file, None);
                routes.insert(golden.route.clone());
            }
            "sequence" => {
                assert!(!golden.requests.is_empty(), "{}: empty sequence", golden.name);
                for (i, request) in golden.requests.iter().enumerate() {
                    let label = format!("{}[{i}] {} {}", golden.name, request.method, request.path);
                    check(&label, &request.route, &request.path, &request.body, None);
                    routes.insert(request.route.clone());
                }
            }
            other => panic!("{}: unknown kind {other}", golden.name),
        }
    }
    for route in [
        "lobby",
        "game",
        "rank",
        "backfill-scan",
        "commands-poll",
        "command-ack",
        "command-nack",
        "pair",
        "queue-file",
        "commands-done-file",
    ] {
        assert!(routes.contains(route), "no golden for {route}");
    }
}

#[test]
fn a_backfilled_game_has_no_party_id_key_and_a_live_one_has_it() {
    let backfill = read_golden("game--backfill--match-detail.json").body;
    assert!(backfill.get("partyId").is_none());
    assert_eq!(backfill["source"], "backfill");
    let live = read_golden("game--eog--eog-stats-block--at-connect.json").body;
    assert!(live.get("partyId").is_some_and(Value::is_null));
    assert!(live.get("source").is_none());
}
