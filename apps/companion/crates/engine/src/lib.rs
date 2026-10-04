//! Kustom's host engine (M17), as a library with no Tauri dependency.
//!
//! The Tauri app in `apps/companion/src-tauri` runs it in-process from M17.8; CI tests it on Linux with no
//! webview (`cargo test -p engine`). It is a port of the TypeScript engine in `apps/companion/src` (the
//! 0.4.0 code), behaviour for behaviour: same server routes, same request bodies, same files on disk, same
//! log format. The parity inventory in `docs/02-milestones.md` (M17) is the checklist, and the goldens in
//! `tests/goldens/` are the TypeScript engine's exact request bodies for every recorded fixture: a Rust
//! body that is not JSON-equal to its golden is a bug in the port, not in the golden.
//!
//! M17.6 fills `config`, `log` and `api` (plus the shared `backoff`); the watchers follow in M17.7 to M17.11.
//!
//! Ground rules every module keeps:
//! - **Never automate gameplay.** No `/lol-champ-select/*`, no in-game state; the only client writes are
//!   the three verified lobby writes (create lobby, invite, switch side).
//! - **Log and drop, never panic.** A malformed client or API payload is one log line with the endpoint
//!   and is dropped; a watcher never takes the process down.
//! - **Idempotent by construction.** Lobby posts carry `partyId`, game posts carry `gameId`; a re-send is
//!   always safe and the server dedupes.
//! - **Clock and filesystem injected**, so the watcher tests run on a fake clock like the TypeScript ones.

pub mod api;
pub mod backoff;
pub mod config;
pub mod host;
pub mod lcu;
pub mod log;
pub mod queue;
pub mod watchers;

#[doc(hidden)]
pub mod test_support;

/// The engine's own version, for the `User-Agent` and the window. The shipped app reports the Tauri app's
/// version instead (M17.8); this is the crate's.
pub const ENGINE_VERSION: &str = env!("CARGO_PKG_VERSION");
