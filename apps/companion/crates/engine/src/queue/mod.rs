//! The durable end-of-game queue (parity row 14, `queue.ts`). The file format and its reader are here
//! (M17.6 review); the queue itself (write before the first POST, replay, delete, cap, backoff) is M17.9's.
//!
//! **Same file format as the TypeScript engine**, so a block 0.3.x queued is replayed by the Rust app on
//! its first start: one file per game at `<stateDir>/queue/<gameId>.json` holding
//! `{ "version": 1, "queuedAt": <ISO 8601>, "payload": <the exact POST /api/companion/game body> }`,
//! pretty-printed with two spaces and a trailing newline. Written as `<gameId>.json.tmp` then renamed,
//! owner-only; only digits in a name. Written **before the first POST**, replayed at start oldest
//! `queuedAt` first, deleted on any 2xx and on a permanent 4xx (400, 403, 404, 422), kept and retried on an
//! outer backoff (30 s to 15 min) for anything else. Capped at 50 files: the
//! oldest is moved to `queue/quarantine/`, never deleted.
//!
//! **Lenient on read, verbatim on replay** (review ruling; a change from 0.4.0, which deleted a file that no
//! longer parsed): the payload is kept as raw JSON and posted exactly as written, so a block an older or
//! newer engine queued with a key the Rust types do not know still reaches the server (whose zod strips
//! unknown keys). The checks are only what replay needs: `version` 1, a `queuedAt` string, and a payload
//! object whose `gameId` is the file's own positive integer id. A file that fails them is moved to
//! `queue/quarantine/` with a log line, **never deleted**: it may be the only copy of a game.
//!
//! The golden `queue-file--eog-stats-block.json` in `tests/goldens/` is a real file the TypeScript
//! engine wrote.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The queue directory's name inside a state directory.
pub const QUEUE_DIR_NAME: &str = "queue";
/// Where files that do not parse are kept, inside the queue directory.
pub const QUARANTINE_DIR_NAME: &str = "quarantine";
/// The only file version.
pub const QUEUE_FILE_VERSION: u64 = 1;

/// The file format, version 1. Unknown top-level keys are accepted and ignored.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueFile {
    /// Always `1`.
    pub version: u64,
    /// When the block was captured (ISO 8601, the injected clock).
    pub queued_at: String,
    /// The exact `POST /api/companion/game` body, as written: posted verbatim.
    pub payload: Value,
}

/// One queued block, read and checked.
#[derive(Debug, Clone, PartialEq)]
pub struct QueuedGame {
    /// The game id, decimal digits as in the file name.
    pub game_id: String,
    /// The file.
    pub path: PathBuf,
    /// Its content.
    pub file: QueueFile,
}

/// `<state dir>/queue`.
pub fn queue_dir(state_dir: &Path) -> PathBuf {
    state_dir.join(QUEUE_DIR_NAME)
}

/// `"123"` for `123.json`; `None` for any other name.
fn stem_of(name: &str) -> Option<&str> {
    let stem = name.strip_suffix(".json")?;
    (!stem.is_empty() && stem.bytes().all(|b| b.is_ascii_digit()) && stem.parse::<u64>().is_ok_and(|n| n > 0))
        .then_some(stem)
}

/// Checks one file's text against what replay needs. `Err` names what is wrong (never the content).
pub fn parse_queue_file(game_id: &str, text: &str) -> Result<QueueFile, String> {
    let file: QueueFile =
        serde_json::from_str(text).map_err(|e| format!("not a queue file: line {}", e.line()))?;
    if file.version != QUEUE_FILE_VERSION {
        return Err(format!("version {}", file.version));
    }
    let payload_id = file
        .payload
        .as_object()
        .and_then(|p| p.get("gameId"))
        .and_then(Value::as_u64);
    if payload_id.map(|id| id.to_string()).as_deref() != Some(game_id) {
        return Err("payload.gameId is not the file's game id".to_owned());
    }
    Ok(file)
}

/// Moves a file to `queue/quarantine/`, keeping its name (a numeric suffix if taken). Never deletes.
pub fn quarantine(path: &Path) -> Option<PathBuf> {
    let dir = path.parent()?.join(QUARANTINE_DIR_NAME);
    crate::log::create_private_dir(&dir).ok()?;
    let name = path.file_name()?.to_string_lossy().into_owned();
    let mut target = dir.join(&name);
    let mut n = 1;
    while target.exists() {
        target = dir.join(format!("{name}.{n}"));
        n += 1;
    }
    fs::rename(path, &target).ok()?;
    Some(target)
}

/// Every replayable block in `<state dir>/queue`, oldest `queuedAt` first. A file that fails the checks is
/// quarantined with one log line. Never fails; a missing directory is an empty queue.
pub fn read_queue(state_dir: &Path) -> Vec<QueuedGame> {
    let dir = queue_dir(state_dir);
    let Ok(entries) = fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut games = Vec::new();
    for entry in entries.filter_map(Result::ok) {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(game_id) = stem_of(&name).map(str::to_owned) else {
            continue;
        };
        let path = entry.path();
        let parsed = fs::read_to_string(&path)
            .map_err(|e| format!("unreadable: {}", e.kind()))
            .and_then(|text| parse_queue_file(&game_id, &text));
        match parsed {
            Ok(file) => games.push(QueuedGame { game_id, path, file }),
            Err(reason) => {
                let moved = quarantine(&path);
                tracing::warn!(
                    component = "queue",
                    gameId = %game_id,
                    reason = %reason,
                    quarantined = moved.as_ref().map(|p| p.display().to_string()),
                    "queued game does not parse; kept in quarantine, not replayed"
                );
            }
        }
    }
    games.sort_by(|a, b| {
        a.file
            .queued_at
            .cmp(&b.file.queued_at)
            .then(a.game_id.cmp(&b.game_id))
    });
    games
}

/// The cap on queued files. Over it, the oldest `queuedAt` is moved to quarantine (never deleted) with a log
/// line, so a long API outage cannot fill a friend's disk and no game is destroyed.
pub const MAX_QUEUED_GAMES: usize = 50;

/// `<state dir>/queue/<gameId>.json`.
pub fn queue_path(state_dir: &Path, game_id: &str) -> PathBuf {
    queue_dir(state_dir).join(format!("{game_id}.json"))
}

/// Whether a file for this game is on disk (the third dedupe layer).
pub fn has_queued(state_dir: &Path, game_id: &str) -> bool {
    stem_of(&format!("{game_id}.json")).is_some() && queue_path(state_dir, game_id).is_file()
}

/// The checks `queue.ts` runs through the wire schema before writing, as far as the server would refuse
/// the body: a phase, a positive integer `gameId` equal to the file's, and for `eog` one to ten
/// participants, a `startedAt`, a `raw` object.
pub fn check_payload(game_id: &str, payload: &Value) -> Result<(), String> {
    let object = payload.as_object().ok_or("payload is not an object")?;
    let id = object.get("gameId").and_then(Value::as_u64).filter(|id| *id > 0);
    if id.map(|id| id.to_string()).as_deref() != Some(game_id) {
        return Err("gameId is not a positive integer equal to the file's".into());
    }
    match object.get("phase").and_then(Value::as_str) {
        Some("in_progress") => Ok(()),
        Some("eog") => {
            let participants = object
                .get("participants")
                .and_then(Value::as_array)
                .map_or(0, Vec::len);
            if !(1..=10).contains(&participants) {
                return Err(format!("{participants} participants, not 1 to 10"));
            }
            if object.get("startedAt").and_then(Value::as_str).is_none() {
                return Err("no startedAt".into());
            }
            if !object.get("raw").is_some_and(Value::is_object) {
                return Err("raw is not an object".into());
            }
            Ok(())
        }
        _ => Err("unknown phase".into()),
    }
}

/// Writes `<state dir>/queue/<gameId>.json` as `{ version, queuedAt, payload }` (two-space JSON and a
/// newline, the TypeScript format): `<gameId>.json.tmp` first, owner-only, then renamed. Then applies the
/// cap. Never panics; a refusal or a failed write is an `Err` with a reason (never the payload).
pub fn write_queued(
    state_dir: &Path,
    game_id: &str,
    queued_at: &str,
    payload: &Value,
) -> Result<PathBuf, String> {
    if stem_of(&format!("{game_id}.json")).is_none() {
        return Err("the game id is not a positive integer".into());
    }
    check_payload(game_id, payload)?;
    let dir = queue_dir(state_dir);
    crate::log::create_private_dir(&dir)
        .map_err(|e| format!("could not create the queue directory: {}", e.kind()))?;
    let file = QueueFile {
        version: QUEUE_FILE_VERSION,
        queued_at: queued_at.to_owned(),
        payload: payload.clone(),
    };
    let mut body = serde_json::to_string_pretty(&file).map_err(|e| format!("could not serialise: {e}"))?;
    body.push('\n');
    let path = queue_path(state_dir, game_id);
    let tmp = dir.join(format!("{game_id}.json.tmp"));
    let written = (|| -> std::io::Result<()> {
        use std::io::Write as _;
        let mut options = fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt as _;
            options.mode(0o600);
        }
        let mut handle = options.open(&tmp)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            handle.set_permissions(fs::Permissions::from_mode(0o600))?;
        }
        handle.write_all(body.as_bytes())?;
        handle.sync_all()?;
        fs::rename(&tmp, &path)
    })();
    if let Err(error) = written {
        let _ = fs::remove_file(&tmp);
        return Err(format!("could not write the queue file: {}", error.kind()));
    }
    tracing::info!(component = "queue", gameId = %game_id, path = %path.display(), "game queued on disk");
    enforce_cap(state_dir, MAX_QUEUED_GAMES);
    Ok(path)
}

/// Deletes a game's file once the server has it (a 2xx) or has refused it for good. Already gone is fine.
pub fn delete_queued(state_dir: &Path, game_id: &str) {
    if let Err(error) = fs::remove_file(queue_path(state_dir, game_id)) {
        if error.kind() != std::io::ErrorKind::NotFound {
            tracing::warn!(component = "queue", gameId = %game_id, error = %error.kind(), "could not delete a queue file");
        }
    }
}

/// Moves the oldest files beyond `max` to quarantine (never deletes). Returns how many moved.
pub fn enforce_cap(state_dir: &Path, max: usize) -> usize {
    let games = read_queue(state_dir);
    let excess = games.len().saturating_sub(max);
    for game in games.iter().take(excess) {
        let moved = quarantine(&game.path);
        tracing::warn!(
            component = "queue",
            gameId = %game.game_id,
            queuedAt = %game.file.queued_at,
            cap = max,
            quarantined = moved.as_ref().map(|p| p.display().to_string()),
            "queue is over its cap; the oldest queued game moved to quarantine (left to backfill)"
        );
    }
    excess
}

/// How many replayable files are queued (the swap guard reads it).
pub fn queued_count(state_dir: &Path) -> usize {
    fs::read_dir(queue_dir(state_dir))
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .filter(|e| stem_of(&e.file_name().to_string_lossy()).is_some())
                .count()
        })
        .unwrap_or(0)
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use crate::test_support::TempDir;
    use serde_json::json;

    fn write(dir: &Path, name: &str, value: &Value) {
        fs::create_dir_all(dir).unwrap();
        fs::write(dir.join(name), serde_json::to_string_pretty(value).unwrap()).unwrap();
    }

    #[test]
    fn a_block_with_keys_we_do_not_know_is_kept_verbatim() {
        let temp = TempDir::new("queue-lenient");
        let queue = queue_dir(temp.path());
        let payload = json!({
            "phase": "eog", "gameId": 4000969091_u64, "partyId": null, "gameType": "CUSTOM_GAME",
            "startedAt": "2026-09-08T16:20:00.000Z", "durationS": 1800, "winningSide": 100,
            "participants": [{ "puuid": "p", "side": 100, "aFieldFrom03x": true }],
            "raw": {}, "someOlderKey": [1, 2]
        });
        write(
            &queue,
            "4000969091.json",
            &json!({
                "version": 1, "queuedAt": "2026-09-08T16:53:04.508Z", "payload": payload, "writtenBy": "0.3.2"
            }),
        );
        let games = read_queue(temp.path());
        assert_eq!(games.len(), 1);
        assert_eq!(games[0].game_id, "4000969091");
        assert_eq!(games[0].file.payload, payload);
    }

    #[test]
    fn a_file_that_does_not_parse_is_quarantined_never_deleted() {
        let temp = TempDir::new("queue-quarantine");
        let queue = queue_dir(temp.path());
        fs::create_dir_all(&queue).unwrap();
        fs::write(queue.join("11.json"), "{ half a file").unwrap();
        write(
            &queue,
            "12.json",
            &json!({ "version": 2, "queuedAt": "x", "payload": { "gameId": 12 } }),
        );
        write(
            &queue,
            "13.json",
            &json!({ "version": 1, "queuedAt": "x", "payload": { "gameId": 99 } }),
        );
        write(
            &queue,
            "14.json",
            &json!({ "version": 1, "queuedAt": "b", "payload": { "gameId": 14 } }),
        );
        write(
            &queue,
            "15.json",
            &json!({ "version": 1, "queuedAt": "a", "payload": { "gameId": 15 } }),
        );
        fs::write(queue.join("notes.txt"), "ignored").unwrap();
        let ids: Vec<String> = read_queue(temp.path()).into_iter().map(|g| g.game_id).collect();
        assert_eq!(ids, ["15", "14"], "oldest queuedAt first");
        for name in ["11.json", "12.json", "13.json"] {
            assert!(queue.join(QUARANTINE_DIR_NAME).join(name).exists(), "{name}");
            assert!(!queue.join(name).exists(), "{name}");
        }
        assert_eq!(
            fs::read_to_string(queue.join(QUARANTINE_DIR_NAME).join("11.json")).unwrap(),
            "{ half a file"
        );
        // A second file of the same name does not overwrite the first.
        fs::write(queue.join("11.json"), "again").unwrap();
        read_queue(temp.path());
        assert!(queue.join(QUARANTINE_DIR_NAME).join("11.json.1").exists());
    }
}
