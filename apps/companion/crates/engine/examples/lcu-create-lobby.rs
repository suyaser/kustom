//! `cargo run -p engine --example lcu-create-lobby -- --blind|--draft` (M17.17): the dev-only live check of
//! the one write M17.17 changed, the create body's pick type. It WRITES: it opens a real custom lobby on the
//! League client running on this machine. Run it only with the owner of that client present.
//!
//! 1. discovers the client and refuses to go on if the client is already in a lobby (it never dissolves one);
//! 2. resolves the entry exactly as the command runner does: `GET /lol-game-queues/v1/custom` joined with
//!    `GET /lol-game-queues/v1/queues` (`custom_lobby_id_for`), blind (16.18: 3100) or draft (3110);
//! 3. asks for Enter, then sends the same `POST /lol-lobby/v2/lobby` the runner sends (the allow-list is
//!    unchanged: one path, `LOBBY_WRITE_PATHS[0]`);
//! 4. reads `GET /lol-lobby/v2/lobby` back and prints `gameConfig.queueId` and `customMutatorName`, which is
//!    the acceptance line: blind reads back queue 3100 (`SimulPickStrategy`), draft 3110
//!    (`TeamBuilderDraftPickStrategy`).
//!
//! Afterwards leave the lobby by hand in the client. Nothing touches champion select, nothing is queued,
//! no invite is sent. Never shipped (an example, not a bin). Paste the whole output back.

#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

use std::sync::{Arc, Mutex};
use std::time::Duration;

use engine::lcu::discovery::{DiscoveryInputs, FsReader, default_lockfile_candidates};
use engine::lcu::process::SystemProcessLister;
use engine::lcu::tls::LcuCertVerifier;
use engine::lcu::types::CreateLobbyBody;
use engine::lcu::writes::{
    CustomLobbyMode, custom_lobby_id_for, describe_mutators, summoners_rift_subcategory,
};
use engine::lcu::{Discovery, LcuClient, LcuDiscovery};

#[tokio::main]
async fn main() {
    let mode = if std::env::args().any(|a| a == "--draft") {
        CustomLobbyMode::Draft
    } else if std::env::args().any(|a| a == "--blind") {
        CustomLobbyMode::Blind
    } else {
        println!("usage: cargo run -p engine --example lcu-create-lobby -- --blind|--draft");
        std::process::exit(2);
    };
    let label = if mode == CustomLobbyMode::Blind {
        "blind"
    } else {
        "draft"
    };

    let config_dir = engine::config::config_dir();
    let inputs = DiscoveryInputs {
        saved_install_dir: config_dir
            .as_deref()
            .and_then(engine::config::read_league_install_dir),
        saved_lockfile_path: config_dir.as_deref().and_then(engine::config::read_lockfile_path),
        defaults: default_lockfile_candidates(),
    };
    let mut discovery = Discovery::new(SystemProcessLister, FsReader);
    let credentials = match discovery.discover(&inputs).await {
        LcuDiscovery::Found {
            credentials, step, ..
        } => {
            println!("client found by step: {}", step.label());
            credentials
        }
        LcuDiscovery::NotFound { searched } => {
            println!("League is not running ({searched:?}). Open it, log in, run again.");
            std::process::exit(2);
        }
    };
    let chain = Arc::new(Mutex::new(Vec::new()));
    let verifier = LcuCertVerifier::riot().unwrap().recording(chain);
    let client = LcuClient::with_verifier(&credentials, verifier, Duration::from_secs(10)).unwrap();

    match client.lobby().await {
        Ok(ok) => {
            println!(
                "already in a lobby (queueId {}); not creating another. Leave it in the client and run again.",
                ok.value.game_config.queue_id
            );
            std::process::exit(1);
        }
        Err(engine::lcu::LcuFailure::Http { status: 404, .. }) => {}
        Err(failure) => {
            println!("could not read the lobby: {}", failure.describe());
            std::process::exit(1);
        }
    }
    let dialog = client
        .custom_game_queues()
        .await
        .expect("custom dialog data")
        .value;
    let queues = client.game_queues().await.expect("queue list").value;
    let Some(entry) = custom_lobby_id_for(&dialog, mode, &queues) else {
        let has = summoners_rift_subcategory(&dialog)
            .map(describe_mutators)
            .unwrap_or_else(|| "no Summoner's Rift subcategory".into());
        println!("no {label} entry resolved (the dialog has: {has}); nothing sent.");
        std::process::exit(1);
    };
    println!("resolved the {label} entry: {entry}");

    let body = CreateLobbyBody::summoners_rift("customs-probe", "4821", entry);
    let mut shown = serde_json::to_value(&body).unwrap();
    shown["customGameLobby"]["lobbyPassword"] = "[redacted]".into();
    println!(
        "POST /lol-lobby/v2/lobby\n{}",
        serde_json::to_string_pretty(&shown).unwrap()
    );
    println!("\nThis opens a REAL custom lobby on this client. Press Enter to send, Ctrl-C to stop.");
    let mut line = String::new();
    let _ = std::io::stdin().read_line(&mut line);

    match client.create_lobby(&body).await {
        Ok(answer) => println!("create answered {}", answer.status),
        Err(failure) => {
            println!("create refused: {}", failure.describe());
            std::process::exit(1);
        }
    }
    match client.lobby().await {
        Ok(ok) => {
            let config = &ok.value.game_config;
            println!(
                "READ BACK: queueId {} customMutatorName {:?} isCustom {} gameMode {} mapId {} customLobbyName {:?}",
                config.queue_id,
                config.custom_mutator_name,
                config.is_custom,
                config.game_mode,
                config.map_id,
                config.custom_lobby_name
            );
            let expected: i64 = entry;
            println!(
                "{}",
                if config.queue_id == expected {
                    format!("PASS: the lobby is the {label} queue ({expected}).")
                } else {
                    format!(
                        "FAIL: asked for {expected}, the client opened {}.",
                        config.queue_id
                    )
                }
            );
        }
        Err(failure) => println!("created, but the read back failed: {}", failure.describe()),
    }
    println!("\nNow leave the lobby in the client yourself.");
}
