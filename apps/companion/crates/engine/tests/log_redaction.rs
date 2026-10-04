//! M17.6 acceptance: **no token ever appears in a log line.** One test binary with the real process-wide log
//! (`engine::log::subscriber` set as the global default, so spawned tasks and blocking threads log through
//! it too), a run of every path that handles a token, the worst failures we can provoke with the token in
//! them, and then a grep over every file the run wrote.

#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

use std::fs;
use std::path::Path;
use std::sync::Arc;
use std::time::SystemTime;

use engine::api::transport::HttpRequest;
use engine::api::wire::{CommandNack, PairRequest, PairResponse};
use engine::api::{ApiClient, ApiClientOptions};
use engine::config::startup::{BootDeps, boot};
use engine::config::{CompanionToken, ProcessProbe, load_config};
use engine::log::{
    DEFAULT_KEEP_DAYS, LogLevel, LogSink, SinkOptions, add_secret, list_log_files, subscriber, system_clock,
};
use engine::test_support::{FakeTransport, TempDir, copy_tree, respond};
use serde_json::Value;

const FIXTURE_TOKENS: [&str; 4] = [
    "SYNTHETIC_topLevel02_xxxxxxxxxxxxxxxxxxxxxx",
    "SYNTHETIC_topLevel03_xxxxxxxxxxxxxxxxxxxxxx",
    "SYNTHETIC_customs04_xxxxxxxxxxxxxxxxxxxxxxx",
    "SYNTHETIC_weekend04_xxxxxxxxxxxxxxxxxxxxxxx",
];
const PAIRED_TOKEN: &str = "PairedToken_minted_once_by_the_server_00000";
const LOCKFILE_PASSWORD: &str = "LcuRemotingPassw0rd_x";

struct NoOldEngine;
impl ProcessProbe for NoOldEngine {
    fn processes(&self) -> Option<Vec<(String, u32)>> {
        Some(Vec::new())
    }
}

fn bearer(request: &HttpRequest) -> String {
    request
        .header("authorization")
        .and_then(|h| h.strip_prefix("Bearer "))
        .unwrap_or_default()
        .to_owned()
}

/// An API that throws the caller's own token back at it in every way it can.
fn hostile_api() -> Arc<FakeTransport> {
    FakeTransport::new(|request| {
        let token = bearer(request);
        if request.url.ends_with("/me") {
            if token == FIXTURE_TOKENS[3] {
                return respond(401, &format!(r#"{{"ok":false,"error":"Unknown token {token}"}}"#));
            }
            return Err(format!("connect failed: refused while sending Bearer {token}"));
        }
        if request.url.ends_with("/game") {
            return respond(200, &format!("<html>your token is {token}</html>"));
        }
        if request.url.ends_with("/rank") {
            return respond(
                400,
                &format!(
                    r#"{{"ok":false,"error":"Invalid body","issues":[{{"path":"{token}","message":"{token}"}}]}}"#
                ),
            );
        }
        if request.url.ends_with("/pair") {
            return respond(
                200,
                &format!(
                    r#"{{"ok":true,"group":{{"id":"g","slug":"s","name":"N"}},"companionToken":"{PAIRED_TOKEN}"}}"#
                ),
            );
        }
        respond(503, &format!(r#"{{"ok":false,"error":"down, token={token}"}}"#))
    })
}

fn fixture_dir(name: &str) -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/config")
        .join(name)
}

#[test]
fn no_token_ever_appears_in_a_log_line() {
    let temp = TempDir::new("log-redaction");
    let logs = temp.path().join("logs");
    let sink = Arc::new(LogSink::new(SinkOptions {
        dir: Some(logs.clone()),
        file_level: LogLevel::Debug,
        console_level: LogLevel::Debug,
        console: None,
        clock: system_clock(),
        keep_days: DEFAULT_KEEP_DAYS,
    }));
    tracing::subscriber::set_global_default(subscriber(sink)).unwrap();

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .start_paused(false)
        .build()
        .unwrap();
    runtime.block_on(async {
        let fake = hostile_api();
        for name in [
            "synthetic-0.2-top-level",
            "synthetic-0.3-host-tokenless-groups",
            "synthetic-0.3-overlay",
            "synthetic-0.4-groups",
        ] {
            let dir = temp.path().join(name);
            copy_tree(&fixture_dir(name), &dir).unwrap();
            let deps = BootDeps {
                transport: fake.clone(),
                probe: Arc::new(NoOldEngine),
                now: SystemTime::now(),
                version: "1.0.0".into(),
            };
            let booted = boot(&dir, &deps).await;
            tracing::warn!(state = ?booted.state, groups = ?booted.groups, config = ?booted.config, "boot finished");
        }

        // Every API failure shape, each carrying the token.
        let token = CompanionToken::parse(FIXTURE_TOKENS[2]).unwrap();
        let mut options = ApiClientOptions::new("https://kustom.example", Some(token.clone()), fake.clone());
        options.backoff.min = std::time::Duration::from_millis(1);
        options.backoff.max = std::time::Duration::from_millis(2);
        let api = ApiClient::new(options);
        let game = serde_json::json!({ "phase": "eog", "gameId": 1 });
        let _ = api.post_queued_game(&game).await;
        let rank = serde_json::from_value(serde_json::json!({
            "puuid": "p", "tier": null, "division": null, "lp": null, "queue": "RANKED_SOLO_5x5",
            "gameName": null, "tagLine": null
        }))
        .unwrap();
        let _ = api.post_rank(&rank).await;
        let _ = api.nack("id", &CommandNack { error: "x: y".into(), retryable: false }).await;
        let lobby = serde_json::from_value(serde_json::json!({
            "partyId": "p", "lobbyName": null, "lobbyPassword": null, "members": []
        }))
        .unwrap();
        let _ = api.post_lobby(&lobby).await;

        // Pairing mints a token we have never seen before.
        let pairing = ApiClient::new(ApiClientOptions::new("https://kustom.example", None, fake.clone()));
        let pair = PairRequest { code: "K7QM4X".into(), puuid: "p".into(), mode: None };
        let answer: PairResponse = pairing.pair(&pair).await.unwrap().data;
        tracing::warn!(answer = ?answer, "paired");
        let raw_answer = serde_json::to_string(&answer).unwrap();
        tracing::warn!(body = %raw_answer, "a careless line with the whole answer");

        // Careless call sites, on purpose.
        tracing::warn!("token in the message: {}", token.expose());
        tracing::warn!(companionToken = token.expose(), "a credential-looking key");
        tracing::warn!(note = token.expose(), "a plain key");
        tracing::warn!(nested = %format!(r#"{{"headers":{{"authorization":"Bearer {}"}}}}"#, token.expose()), "json in a string");
        add_secret(LOCKFILE_PASSWORD);
        tracing::warn!(url = %format!("https://riot:{LOCKFILE_PASSWORD}@127.0.0.1:50000"), "the lockfile password");
        tokio::task::spawn_blocking(move || {
            tracing::warn!(token = ?CompanionToken::parse(FIXTURE_TOKENS[0]), "from a blocking thread");
            let config = load_config(&fixture_dir("synthetic-0.4-groups"));
            tracing::warn!(config = ?config, "a whole config, Debug");
        })
        .await
        .unwrap();
    });

    // The grep. (Set KUSTOM_KEEP_LOG to print the run for a human look.)
    if std::env::var_os("KUSTOM_KEEP_LOG").is_some() {
        for file in list_log_files(&logs) {
            println!("{}", fs::read_to_string(logs.join(file)).unwrap());
        }
    }
    let files = list_log_files(&logs);
    assert!(!files.is_empty(), "the run wrote no log");
    let mut lines = 0;
    let mut redactions = 0;
    let secrets: Vec<&str> = FIXTURE_TOKENS
        .iter()
        .copied()
        .chain([PAIRED_TOKEN, LOCKFILE_PASSWORD])
        .collect();
    for file in files {
        let text = fs::read_to_string(logs.join(&file)).unwrap();
        for line in text.lines() {
            lines += 1;
            let parsed: Value =
                serde_json::from_str(line).unwrap_or_else(|e| panic!("not one JSON object: {e}: {line}"));
            assert!(parsed["ts"].is_string() && parsed["level"].is_string() && parsed["msg"].is_string());
            for secret in &secrets {
                assert!(!line.contains(secret), "a secret reached the log:\n{line}");
                // Not even a long piece of one.
                assert!(
                    !line.contains(&secret[..secret.len().min(16)]),
                    "a piece of a secret reached the log:\n{line}"
                );
            }
            redactions += line.matches("[redacted]").count();
        }
    }
    assert!(lines >= 15, "only {lines} lines: the run did not exercise enough");
    assert!(redactions >= 8, "only {redactions} redactions");
}
