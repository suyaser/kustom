//! The watchers: everything the host does between "League is open" and "the game is on the site".
//! M17.7 landed [`connection`] and [`lobby`], M17.9 [`game`] (with the queue), M17.10 [`rank`] and
//! [`commands`], M17.11 [`backfill`]. Each watcher is its own task fed by the machine,
//! so one that fails never stops another (parity row 20, `composeHooks` today).
//!
//! What lands here, one submodule each, each a port of the TypeScript file named and of its tests one for
//! one:
//! - **connection** (M17.7, row 8, `connection.ts`, `backoff.ts`): `disconnected -> connected -> watching`,
//!   the `/lol-patch/v1/game-version` probe, reconnect forever with jittered backoff from 1 s to 60 s, reset
//!   on `watching`. Reads `current-summoner` and the gameflow phase at connect and hands them to the others.
//! - **lobby** (M17.7, row 12, `lobbyWatcher.ts`): one POST in flight, newest wins, retry only while
//!   newest, `recheckInMs`, `ranksNeeded` to rank sync, a 403 stops that party until the next `Create`, one
//!   GET at connect. Names never hold a post up; looked up in the background and re-posted once.
//! - **game** (M17.9, row 13, `gameWatcher.ts`): `in_progress` at `GameStart`/`InProgress` from one
//!   session GET; `eog` **from the WebSocket event held in memory** (the GET is a 404 once someone clicks
//!   past the score screen); one GET only at connect when already on the end-of-game screen; drop
//!   non-custom and no-winner blocks; dedupe on `gameId`; written to the queue before the first POST.
//! - **rank** (M17.10, row 15, `rankSync.ts`): own rank on connect and every 6 h; others only for the
//!   server's `ranksNeeded`; the `cached-ranked-stats` event as a shortcut; 200 ms pacing.
//! - **commands** (M17.10, row 16, `commandRunner.ts`, `executed.ts`): poll
//!   `GET /api/companion/commands?clientConnected=` every 5 s; execute once (`commands-done.json` written
//!   after the client call and before the ack); stale, malformed, gate, phase, read-before-write; ack/nack.
//! - **backfill** (M17.11, row 18, `backfill.ts`): the match-history walk 60 s after connect then every
//!   6 h, idle phases only, page and detail caps, `backfill.json`, `POST /api/companion/backfill/scan`,
//!   games through the queue as `source: 'backfill'`.
//!
//! One group per session: a group switch stops every watcher before the next group's start, and waits
//! while a game is in progress or a block is unposted (row 5, the M14.13 swap guard).

pub mod backfill;
pub mod commands;
pub mod connection;
pub mod game;
pub mod lobby;
pub mod rank;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// `<stateDir>/commands-done.json`, the execute-once record (`executed.ts`), written by
/// [`commands::ExecutedStore`] and pinned by the `commands-done-file--*` golden. Entries are kept for 24 h,
/// at most 200.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CommandsDoneFile {
    /// Always `1`.
    pub version: u32,
    /// Oldest first.
    pub entries: Vec<CommandsDoneEntry>,
}

/// One executed command.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CommandsDoneEntry {
    /// The command id.
    pub id: String,
    /// The command kind, as the server named it.
    pub kind: String,
    /// When the client call returned (or the refusal was decided), ISO 8601.
    pub at: String,
    /// `done` or `failed`.
    pub outcome: CommandOutcome,
    /// The kind's result, on `done` only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Map<String, Value>>,
    /// The nack text, on `failed` only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Writes `body` to `path` through `<path>.tmp` and a rename, owner-only (0600; the directory 0700). A
/// crash mid-write leaves the old file or the new one, never half of either.
pub(crate) fn write_private_file(path: &std::path::Path, body: &str) -> std::io::Result<()> {
    use std::io::Write as _;
    if let Some(dir) = path.parent() {
        crate::log::create_private_dir(dir)?;
    }
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = std::path::PathBuf::from(tmp);
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.mode(0o600);
    }
    let written = options
        .open(&tmp)
        .and_then(|mut handle| handle.write_all(body.as_bytes()));
    if let Err(error) = written.and_then(|()| std::fs::rename(&tmp, path)) {
        let _ = std::fs::remove_file(&tmp);
        return Err(error);
    }
    Ok(())
}

/// How a command ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CommandOutcome {
    /// Acked with a result.
    Done,
    /// Nacked, not retryable.
    Failed,
}
