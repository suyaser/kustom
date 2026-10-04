//! M17.7 follow-up to M17.6's `log_redaction.rs`: a client password parsed by the League bridge (from the
//! lockfile or the client's command line) never appears in a log file, neither plain nor as the base64
//! `riot:<password>` of the Basic header. Own test binary: it installs the real process-wide log as the
//! global default, then greps every file the run wrote.

#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

use std::fs;
use std::sync::Arc;
use std::time::Duration;

use engine::lcu::LcuClient;
use engine::lcu::client::{basic_auth, basic_auth_credential};
use engine::lcu::lockfile::parse_lockfile;
use engine::lcu::process::parse_ux_command_line;
use engine::log::{
    DEFAULT_KEEP_DAYS, LogLevel, LogSink, SinkOptions, list_log_files, subscriber, system_clock,
};
use engine::test_support::TempDir;

const LOCKFILE_PASSWORD: &str = "LockfilePw_UnderTest_9z";
const COMMAND_LINE_TOKEN: &str = "RemotingToken_UnderTest_Q4";

#[test]
fn a_parsed_lockfile_password_never_appears_in_a_log_file() {
    let temp = TempDir::new("lcu-log-secrets");
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
        .build()
        .unwrap();
    runtime.block_on(async {
        let text = format!("LeagueClient:4242:1:{LOCKFILE_PASSWORD}:https");
        let credentials = parse_lockfile(&text).unwrap();
        let args = parse_ux_command_line(&format!(r#""--app-port=2" "--remoting-auth-token={COMMAND_LINE_TOKEN}""#))
            .unwrap();

        // The worst things a careless line could do with them, in plain text, in fields and in JSON.
        tracing::warn!(lockfile = %text, "lockfile read");
        tracing::warn!(header = %basic_auth(LOCKFILE_PASSWORD), "authorization header");
        tracing::warn!("password inline: {} and {}", credentials.password, args.password);
        tracing::warn!(json = %format!(r#"{{"note":"{}"}}"#, basic_auth_credential(COMMAND_LINE_TOKEN)), "json field");
        tracing::error!(debug = ?credentials, args = ?args, "debug forms");

        // A real failing call with those credentials (nothing listens on the port).
        let closed = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = closed.local_addr().unwrap().port();
        drop(closed);
        let mut dead = credentials.clone();
        dead.port = port;
        let client = LcuClient::new(&dead).unwrap();
        let failure = client.lobby().await.unwrap_err();
        tracing::warn!(?failure, password = %dead.password, "lobby read failed");
        tokio::time::sleep(Duration::from_millis(20)).await;
    });

    let files = list_log_files(&logs);
    assert!(!files.is_empty(), "the run wrote a log file");
    let text: String = files
        .iter()
        .map(|name| fs::read_to_string(logs.join(name)).unwrap())
        .collect();
    assert!(text.contains("lockfile read") && text.contains("lobby read failed"));
    for secret in [
        LOCKFILE_PASSWORD.to_string(),
        COMMAND_LINE_TOKEN.to_string(),
        basic_auth_credential(LOCKFILE_PASSWORD),
        basic_auth_credential(COMMAND_LINE_TOKEN),
    ] {
        assert!(!text.contains(&secret), "{secret} reached a log file");
    }
}
