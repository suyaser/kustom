//! The League client bridge: **the only code in shipped Kustom that reads the lockfile or connects to
//! `127.0.0.1`** (CLAUDE.md hard rule). M17.5.
//!
//! - [`discovery`]: where the client is. The running client's process first (zero setup for a custom
//!   install), then the saved `leagueInstallDir` / `lockfilePath`, then the platform default, else
//!   [`discovery::LcuDiscovery::NotFound`] with every path searched. [`process`] lists and parses the client's
//!   UI process; [`lockfile`] parses the lockfile; [`install`] validates and saves a picked folder.
//! - [`tls`]: the rustls verifier pinned to Riot's root, `127.0.0.1` only. What is trusted is spelled out
//!   there.
//! - [`client`]: HTTPS with basic auth; every 2xx deserialised into a [`types`] struct, every failure typed
//!   and logged with the endpoint, never panicking. [`endpoints`]: one typed function per call the engine
//!   makes, and the three lobby writes behind an allow-list.
//! - [`socket`] and [`events`]: the WebSocket (`[5, "OnJsonApiEvent"]`, ping/pong, reconnect forever) and the
//!   routing of the four URIs the watchers read.
//!
//! Still to come in later tasks: the mappers (`mapLobby`, `mapEog`, `mapMatchDetail`, `mapRank`, pinned by
//! the goldens; M17.7 to M17.11) and the write verification gate (M17.10).
//!
//! Every endpoint here is `verified` in `docs/03-lcu-reference.md` for the TypeScript bridge; this Rust
//! bridge stays unverified until `cargo run -p engine --example lcu-probe` has run against a live client.

pub mod client;
pub mod discovery;
pub mod endpoints;
pub mod events;
pub mod install;
pub mod lockfile;
pub mod mapper;
pub mod process;
pub mod socket;
pub mod tls;
pub mod types;
pub mod writes;

pub use client::{LcuClient, LcuFailure, LcuOk, LcuResponse};
pub use discovery::{CredentialSource, Discovery, DiscoveryInputs, DiscoveryStep, LcuDiscovery};
pub use install::{InvalidInstall, ValidInstall, save_install_dir, validate_install_dir};
pub use lockfile::Credentials;
