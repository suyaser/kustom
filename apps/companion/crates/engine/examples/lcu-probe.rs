//! `cargo run -p engine --example lcu-probe -- [--watch <seconds>]` (M17.5): the dev-only live check of the
//! Rust League client bridge. Needs League running and logged in on this machine. It:
//!
//! 1. runs discovery and says which step found the client (never prints the password);
//! 2. hits every GET the engine makes through the pinned verifier, deserialises each into its Rust type and
//!    diffs the top-level keys against the newest recorded fixture in `packages/lcu/fixtures/`;
//! 3. prints the certificate the client presented (public; it is what the pin is checked against);
//! 4. subscribes to the WebSocket for `--watch` seconds (default 90) and counts the four routed URIs;
//! 5. ends with a PASS/FAIL table. Paste the whole output back.
//!
//! Read-only: no write is ever sent, nothing touches champion select. Never shipped (an example, not a bin).

#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use engine::lcu::client::LcuFailure;
use engine::lcu::discovery::{DiscoveryInputs, FsReader, default_lockfile_candidates};
use engine::lcu::events::{RoutedEvent, route};
use engine::lcu::process::{ProcessList, ProcessLister, SystemProcessLister, parse_ux_command_line};
use engine::lcu::socket::{SocketMessage, SocketOptions, run_once};
use engine::lcu::tls::{LcuCertVerifier, client_config, to_pem};
use engine::lcu::{CredentialSource, Discovery, LcuClient, LcuDiscovery, LcuResponse};
use serde_json::Value;
use tokio::sync::{mpsc, watch};

const FIXTURE_PATCHES: [&str; 2] = ["16.18", "16.17"];

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../../packages/lcu/fixtures")
}

fn newest_fixture(id: &str) -> Option<(String, Value)> {
    for patch in FIXTURE_PATCHES {
        let path = fixtures_dir().join(patch).join(format!("{id}.json"));
        if let Ok(text) = std::fs::read_to_string(&path) {
            let envelope: Value = serde_json::from_str(&text).ok()?;
            return Some((patch.to_string(), envelope["body"].clone()));
        }
    }
    None
}

fn json_type(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

/// Top-level key diff, like `diffTopLevelKeys` in `packages/lcu/src/fixtures.ts`.
fn shape_diff(previous: &Value, current: &Value) -> String {
    let (previous, current) = match (previous, current) {
        (Value::Array(a), Value::Array(b)) => match (a.first(), b.first()) {
            (Some(x), Some(y)) => (x, y),
            _ => return "one side is an empty array".into(),
        },
        pair => pair,
    };
    match (previous, current) {
        (Value::Object(a), Value::Object(b)) => {
            let added: Vec<&String> = b.keys().filter(|k| !a.contains_key(*k)).collect();
            let removed: Vec<&String> = a.keys().filter(|k| !b.contains_key(*k)).collect();
            let retyped: Vec<&String> = a
                .keys()
                .filter(|k| b.get(*k).is_some_and(|v| json_type(v) != json_type(&a[*k])))
                .collect();
            if added.is_empty() && removed.is_empty() && retyped.is_empty() {
                "same top-level keys".into()
            } else {
                format!("added {added:?} removed {removed:?} retyped {retyped:?}")
            }
        }
        (a, b) if json_type(a) == json_type(b) => format!("both {}", json_type(a)),
        (a, b) => format!("type changed: {} -> {}", json_type(a), json_type(b)),
    }
}

struct Row {
    id: String,
    path: String,
    outcome: String,
    pass: Option<bool>,
}

fn report<T>(
    rows: &mut Vec<Row>,
    id: &str,
    path: &str,
    result: &LcuResponse<T>,
    expected_404: Option<&str>,
) -> Option<Value> {
    let fixture = newest_fixture(id);
    let (outcome, pass, raw) = match result {
        Ok(ok) => {
            let diff = fixture
                .as_ref()
                .map(|(patch, body)| format!("vs fixture {patch}: {}", shape_diff(body, &ok.raw)))
                .unwrap_or_else(|| "no fixture to compare".into());
            (
                format!("{} typed OK; {diff}", ok.status),
                Some(true),
                Some(ok.raw.clone()),
            )
        }
        Err(LcuFailure::Http {
            status: 404, message, ..
        }) if expected_404.is_some() => (
            format!(
                "404 {} ({}): not exercised",
                message.clone().unwrap_or_default(),
                expected_404.unwrap_or_default()
            ),
            None,
            None,
        ),
        Err(failure @ LcuFailure::Schema { status, raw, .. }) => {
            let error = failure.safe_schema_error().unwrap_or_default();
            let diff = fixture
                .as_ref()
                .map(|(p, b)| format!("; vs fixture {p}: {}", shape_diff(b, raw)))
                .unwrap_or_default();
            (
                format!("{status} DID NOT MATCH THE RUST TYPE: {error}{diff}"),
                Some(false),
                Some(raw.clone()),
            )
        }
        Err(failure) => (format!("FAILED: {}", failure.describe()), Some(false), None),
    };
    println!("  {id:<22} {path}\n      -> {outcome}");
    rows.push(Row {
        id: id.into(),
        path: path.into(),
        outcome,
        pass,
    });
    raw
}

fn arg_value(name: &str) -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1).cloned())
}

#[tokio::main]
async fn main() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "warn".into()),
        ))
        .with_writer(std::io::stderr)
        .try_init();
    let watch_secs: u64 = arg_value("--watch").and_then(|v| v.parse().ok()).unwrap_or(90);

    println!("=== Kustom LCU probe (M17.5) ===");
    println!(
        "engine {}  os {}/{}",
        engine::ENGINE_VERSION,
        std::env::consts::OS,
        std::env::consts::ARCH
    );

    // 1. Discovery.
    println!("\n[1] Discovery");
    let config_dir = engine::config::config_dir();
    let inputs = DiscoveryInputs {
        saved_install_dir: config_dir
            .as_deref()
            .and_then(engine::config::read_league_install_dir),
        saved_lockfile_path: config_dir.as_deref().and_then(engine::config::read_lockfile_path),
        defaults: default_lockfile_candidates(),
    };
    println!(
        "  config dir: {}",
        config_dir
            .as_deref()
            .map(Path::display)
            .map(|d| d.to_string())
            .unwrap_or("(none)".into())
    );
    println!(
        "  saved leagueInstallDir: {:?}; saved lockfilePath: {:?}",
        inputs.saved_install_dir, inputs.saved_lockfile_path
    );
    match SystemProcessLister.list().await {
        ProcessList::Listed(processes) => {
            println!("  process list: {} LeagueClientUx process(es)", processes.len());
            for p in &processes {
                let args = p.command_line.as_deref().and_then(parse_ux_command_line);
                println!(
                    "    pid {:?}: --app-port {} --remoting-auth-token {} --app-pid {:?} --install-directory {:?}",
                    p.pid,
                    args.as_ref()
                        .map(|a| a.port.to_string())
                        .unwrap_or("missing".into()),
                    if args.is_some() {
                        "present (not shown)"
                    } else {
                        "missing"
                    },
                    args.as_ref().and_then(|a| a.app_pid),
                    args.as_ref().and_then(|a| a.install_directory.clone()),
                );
            }
        }
        ProcessList::Unavailable(reason) => println!("  process list unavailable: {reason}"),
    }
    let mut discovery = Discovery::new(SystemProcessLister, FsReader);
    let (credentials, step_label) = match discovery.discover(&inputs).await {
        LcuDiscovery::Found {
            credentials,
            step,
            source,
            install_dir,
        } => {
            println!("  FOUND by step: {}", step.label());
            match &source {
                CredentialSource::Lockfile(path) => println!("  source: lockfile {}", path.display()),
                CredentialSource::CommandLine => println!("  source: the client's command line"),
            }
            println!("  install dir: {install_dir:?}");
            println!(
                "  port {} pid {} name {} (password not shown)",
                credentials.port, credentials.pid, credentials.name
            );
            (credentials, step.label())
        }
        LcuDiscovery::NotFound { searched } => {
            println!("  NOT FOUND. Searched: {searched:#?}");
            println!(
                "\nLeague does not seem to be running. Open League, log in, wait for the home screen, then run again:"
            );
            println!("  cd apps/companion && cargo run -p engine --example lcu-probe");
            std::process::exit(2);
        }
    };

    // 2. Reads.
    println!("\n[2] HTTPS reads (pinned to Riot's root, 127.0.0.1 only)");
    let chain = Arc::new(Mutex::new(Vec::new()));
    let verifier = LcuCertVerifier::riot().unwrap().recording(chain.clone());
    let client = LcuClient::with_verifier(&credentials, verifier, Duration::from_secs(10)).unwrap();
    let mut rows = Vec::new();

    let version = client.game_version().await;
    report(
        &mut rows,
        "game-version",
        "/lol-patch/v1/game-version",
        &version,
        None,
    );
    if let Err(LcuFailure::Network { tls: true, message }) = &version {
        println!("\n!!! THE TLS PIN FAILED: {message}");
    }
    let presented = chain.lock().unwrap().clone();
    if let Err(LcuFailure::Network { .. }) = &version {
        print_chain(&presented);
        println!("\nThe client could not be read at all; stopping here. Paste everything above back.");
        std::process::exit(1);
    }
    let me = client.current_summoner().await;
    report(
        &mut rows,
        "current-summoner",
        "/lol-summoner/v1/current-summoner",
        &me,
        None,
    );
    let puuid = me
        .as_ref()
        .ok()
        .map(|ok| ok.value.puuid.clone())
        .unwrap_or_default();
    let r = client.summoner_by_puuid(&puuid).await;
    report(
        &mut rows,
        "summoner-by-puuid",
        "/lol-summoner/v2/summoners/puuid/{own puuid}",
        &r,
        None,
    );
    let r = client.current_ranked_stats().await;
    report(
        &mut rows,
        "current-ranked-stats",
        "/lol-ranked/v1/current-ranked-stats",
        &r,
        None,
    );
    let r = client.ranked_stats(&puuid).await;
    report(
        &mut rows,
        "ranked-stats-by-puuid",
        "/lol-ranked/v1/ranked-stats/{own puuid}",
        &r,
        None,
    );
    let phase = client.gameflow_phase().await;
    report(
        &mut rows,
        "gameflow-phase",
        "/lol-gameflow/v1/gameflow-phase",
        &phase,
        None,
    );
    let r = client.gameflow_session().await;
    report(
        &mut rows,
        "gameflow-session",
        "/lol-gameflow/v1/session",
        &r,
        Some("no session: idle in None"),
    );
    let r = client.lobby().await;
    report(
        &mut rows,
        "lobby",
        "/lol-lobby/v2/lobby",
        &r,
        Some("no lobby open"),
    );
    let r = client.custom_game_queues().await;
    report(
        &mut rows,
        "custom-game-queues",
        "/lol-game-queues/v1/custom",
        &r,
        None,
    );
    let r = client.game_queues().await;
    report(&mut rows, "game-queues", "/lol-game-queues/v1/queues", &r, None);
    let r = client.eog_stats_block().await;
    report(
        &mut rows,
        "eog-stats-block",
        "/lol-end-of-game/v1/eog-stats-block",
        &r,
        Some("not on the end-of-game screen"),
    );
    let history = client.match_history(&puuid, 0, 20).await;
    report(
        &mut rows,
        "match-history",
        "/lol-match-history/v1/products/lol/{own puuid}/matches?begIndex=0&endIndex=20",
        &history,
        None,
    );
    let game_id = history
        .as_ref()
        .ok()
        .and_then(|h| h.value.games.games.first().map(|g| g.game_id));
    match game_id {
        Some(id) => {
            let r = client.match_detail(id).await;
            report(
                &mut rows,
                "match-detail",
                "/lol-match-history/v1/games/{newest gameId}",
                &r,
                None,
            );
        }
        None => rows.push(Row {
            id: "match-detail".into(),
            path: "/lol-match-history/v1/games/{gameId}".into(),
            outcome: "not exercised: no game in history".into(),
            pass: None,
        }),
    }

    // 3. Certificate.
    println!("\n[3] The certificate the client presented");
    print_chain(&presented);

    // 4. WebSocket.
    println!("\n[4] WebSocket: subscribed to every event for {watch_secs} s.");
    println!("    While it runs, please: open Play > Create Custom > Confirm (a lobby), then leave it;");
    println!(
        "    and open any friend's profile (a ranked-stats push). An end-of-game block only arrives after a game."
    );
    let tls = Arc::new(client_config(LcuCertVerifier::riot().unwrap()).unwrap());
    let (tx, mut rx) = mpsc::channel(1024);
    let (stop_tx, mut stop_rx) = watch::channel(false);
    let ws_credentials = credentials.clone();
    let socket = tokio::spawn(async move {
        run_once(&ws_credentials, tls, SocketOptions::default(), &tx, &mut stop_rx).await
    });
    let started = Instant::now();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(watch_secs);
    let mut opened = false;
    let mut total = 0usize;
    let mut dropped = 0usize;
    let mut seen: BTreeMap<&'static str, (usize, f64)> = BTreeMap::new();
    let mut other_uris = BTreeSet::new();
    loop {
        tokio::select! {
            _ = tokio::time::sleep_until(deadline) => break,
            message = rx.recv() => match message {
                Some(SocketMessage::Open { port }) => { opened = true; println!("    socket open on port {port}, [5,\"OnJsonApiEvent\"] sent"); }
                Some(SocketMessage::Event(event)) => {
                    total += 1;
                    let key = match route(&event) {
                        Ok(RoutedEvent::Lobby { .. }) => Some("/lol-lobby/v2/lobby"),
                        Ok(RoutedEvent::GameflowPhase(phase)) => { println!("    phase -> {phase}"); Some("/lol-gameflow/v1/gameflow-phase") }
                        Ok(RoutedEvent::EogBlock { .. }) => Some("/lol-end-of-game/v1/eog-stats-block"),
                        Ok(RoutedEvent::RankedStats { .. }) => Some("/lol-ranked/v1/cached-ranked-stats/{puuid}"),
                        Ok(RoutedEvent::Ignored) => { if other_uris.len() < 40 { other_uris.insert(event.uri.split('/').take(3).collect::<Vec<_>>().join("/")); } None }
                        Err(drop) => { dropped += 1; println!("    DROPPED {}: {}", drop.uri, drop.safe_reason()); None }
                    };
                    if let Some(key) = key {
                        let entry = seen.entry(key).or_insert((0, started.elapsed().as_secs_f64()));
                        if entry.0 == 0 { println!("    first {key} at {:.1} s", entry.1); }
                        entry.0 += 1;
                    }
                }
                Some(SocketMessage::Closed(reason)) => { println!("    socket closed: {reason:?}"); break; }
                None => break,
            }
        }
    }
    let _ = stop_tx.send(true);
    let end = socket.await;
    println!("    socket ended: {end:?}");
    println!("    {total} events, {dropped} dropped; other URI prefixes seen: {other_uris:?}");
    for uri in [
        "/lol-lobby/v2/lobby",
        "/lol-gameflow/v1/gameflow-phase",
        "/lol-end-of-game/v1/eog-stats-block",
        "/lol-ranked/v1/cached-ranked-stats/{puuid}",
    ] {
        let (count, first) = seen.get(uri).copied().unwrap_or((0, 0.0));
        let outcome = if count > 0 {
            format!("{count} event(s), all typed OK, first at {first:.1} s")
        } else {
            "not seen in this window".into()
        };
        println!("    {uri:<45} {outcome}");
        rows.push(Row {
            id: format!("ws {uri}"),
            path: "WebSocket".into(),
            outcome,
            pass: if count > 0 { Some(true) } else { None },
        });
    }
    rows.push(Row {
        id: "ws connect+subscribe".into(),
        path: "wss://127.0.0.1".into(),
        outcome: if opened {
            "opened and subscribed".into()
        } else {
            "did not open".into()
        },
        pass: Some(opened && dropped == 0),
    });

    // 5. Summary.
    println!("\n[5] Summary (discovery step: {step_label})");
    for row in &rows {
        let mark = match row.pass {
            Some(true) => "PASS",
            Some(false) => "FAIL",
            None => "----",
        };
        println!(
            "  {mark}  {:<45} {}",
            row.id,
            row.outcome.lines().next().unwrap_or_default()
        );
        let _ = &row.path;
    }
    let failed = rows.iter().filter(|r| r.pass == Some(false)).count();
    let unexercised = rows.iter().filter(|r| r.pass.is_none()).count();
    println!(
        "\n{} passed, {failed} failed, {unexercised} not exercised.",
        rows.len() - failed - unexercised
    );
    println!("Paste this whole output back. Nothing above contains the lockfile password.");
}

fn print_chain(chain: &[rustls::pki_types::CertificateDer<'static>]) {
    if chain.is_empty() {
        println!("  (no certificate was presented: the TLS handshake did not get that far)");
        return;
    }
    for (i, cert) in chain.iter().enumerate() {
        println!(
            "  certificate {i} ({} bytes, X.509 {}):",
            cert.as_ref().len(),
            x509_version(cert.as_ref())
                .map(|v| format!("v{v}"))
                .unwrap_or("version unreadable".into())
        );
        print!("{}", to_pem(cert));
    }
}

/// Reads the version field of a DER certificate: `Certificate ::= SEQUENCE { tbsCertificate SEQUENCE {
/// [0] EXPLICIT version INTEGER DEFAULT v1, ... } }`. webpki only accepts v3 end-entity certificates.
fn x509_version(der: &[u8]) -> Option<u8> {
    fn header(bytes: &[u8]) -> Option<(u8, usize)> {
        let tag = *bytes.first()?;
        let first = *bytes.get(1)?;
        let len_bytes = if first & 0x80 == 0 {
            0
        } else {
            usize::from(first & 0x7f)
        };
        Some((tag, 2 + len_bytes))
    }
    let (outer, skip) = header(der)?;
    let tbs = der.get(skip..)?;
    let (inner, skip) = header(tbs)?;
    if outer != 0x30 || inner != 0x30 {
        return None;
    }
    let first = tbs.get(skip..)?;
    if *first.first()? != 0xa0 {
        return Some(1);
    }
    // a0 03 02 01 <n>: version n means v(n+1).
    Some(first.get(4)?.saturating_add(1))
}
