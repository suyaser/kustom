//! The log (parity row 19, `log.ts`).
//!
//! Daily files `logs/companion-<YYYY-MM-DD>.log` (UTC date) in the config directory, one JSON object per
//! line (`{"ts","level","msg",...fields}`), the newest 14 kept: the same directory, file name and line
//! shape as the TypeScript engine, so the README's "send the newest file" still works and a 0.3.x line
//! and a 1.0 line sit side by side in one folder.
//!
//! **Every module logs with `tracing`'s macros**; [`init`] installs [`KustomLayer`], which writes each
//! event through [`LogSink`]. Before a line is formatted:
//! - credential-looking keys are replaced at any depth, JSON inside strings included ([`scrub`], the
//!   `packages/lcu/src/scrub.ts` rules), and
//! - every registered secret ([`add_secret`]) is replaced wherever it appears: message, value or key.
//!
//! A companion token registers itself the moment it is parsed ([`crate::config::CompanionToken`]), so no
//! call site has to remember to. The League bridge registers the lockfile password with [`add_secret`].
//! Log fields are ids, phases and counts, never a lobby or end-of-game body (they carry chat credentials).
//! `CUSTOMS_NIGHT_LOG_LEVEL` (`debug | info | warn | error`, default `info`) is the console's level, for
//! development; the file always takes `debug`.

pub mod clock;
mod layer;
pub mod scrub;
mod secrets;
mod sink;

use std::path::{Path, PathBuf};
use std::sync::Arc;

pub use clock::{Clock, date_stamp, fixed_clock, iso_timestamp, parse_iso_timestamp, system_clock};
pub use layer::KustomLayer;
pub use secrets::{MIN_SECRET_LEN, add_secret, redact_text, redact_value};
pub(crate) use sink::create_private_dir;
pub use sink::{
    ConsoleFn, DEFAULT_KEEP_DAYS, Fields, LOG_FILE_PREFIX, LogLevel, LogSink, SinkOptions, list_log_files,
    log_file_name, prune_log_files,
};

use tracing_subscriber::layer::SubscriberExt;

/// The logs folder's name inside the config directory.
pub const LOGS_DIR_NAME: &str = "logs";

/// The console level's environment variable.
pub const LOG_LEVEL_ENV: &str = "CUSTOMS_NIGHT_LOG_LEVEL";

/// `<config dir>/logs`.
pub fn logs_dir(config_dir: &Path) -> PathBuf {
    config_dir.join(LOGS_DIR_NAME)
}

/// `CUSTOMS_NIGHT_LOG_LEVEL`, else `info`.
pub fn console_level_from_env() -> LogLevel {
    std::env::var(LOG_LEVEL_ENV)
        .ok()
        .and_then(|value| LogLevel::parse(&value))
        .unwrap_or(LogLevel::Info)
}

/// The sink the shipped app uses: the file at `debug` in `<config dir>/logs`, stderr at the env level.
pub fn default_sink(config_dir: &Path) -> Arc<LogSink> {
    Arc::new(LogSink::new(SinkOptions {
        dir: Some(logs_dir(config_dir)),
        file_level: LogLevel::Debug,
        console_level: console_level_from_env(),
        console: Some(Box::new(|_level, line| eprintln!("{line}"))),
        clock: system_clock(),
        keep_days: DEFAULT_KEEP_DAYS,
    }))
}

/// A subscriber with only the Kustom layer, writing to `sink`. Use with
/// `tracing::subscriber::with_default` in tests, or [`init`] for the process.
pub fn subscriber(sink: Arc<LogSink>) -> impl tracing::Subscriber + Send + Sync {
    tracing_subscriber::registry().with(KustomLayer::new(sink))
}

/// Installs the log for the whole process. Returns the sink (for "Open logs" and the current file), or
/// an error if a global subscriber was already set (the caller logs nothing more and carries on).
pub fn init(config_dir: &Path) -> Result<Arc<LogSink>, String> {
    let sink = default_sink(config_dir);
    tracing::subscriber::set_global_default(subscriber(sink.clone()))
        .map_err(|error| format!("the log was already set up: {error}"))?;
    Ok(sink)
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use std::fs;
    use std::time::{Duration, UNIX_EPOCH};

    use serde_json::Value;

    use super::*;
    use crate::test_support::TempDir;

    fn sink_at(dir: &Path, at_ms: u64) -> Arc<LogSink> {
        Arc::new(LogSink::new(SinkOptions {
            dir: Some(dir.to_path_buf()),
            file_level: LogLevel::Debug,
            console_level: LogLevel::Info,
            console: None,
            clock: fixed_clock(UNIX_EPOCH + Duration::from_millis(at_ms)),
            keep_days: 3,
        }))
    }

    #[test]
    fn one_json_object_per_line_with_span_fields() {
        let temp = TempDir::new("log-lines");
        let sink = sink_at(temp.path(), 1_791_138_605_123);
        tracing::subscriber::with_default(subscriber(sink.clone()), || {
            let span = tracing::info_span!("api", component = "api");
            let _entered = span.enter();
            tracing::warn!(
                endpoint = "POST /api/companion/lobby",
                status = 503_u64,
                "api call failed"
            );
            tracing::debug!(target: "hyper::proto", "chatty dependency line");
            tracing::warn!(target: "hyper::proto", "dependency warning");
        });
        let path = sink.current_file().unwrap();
        assert_eq!(path.file_name().unwrap(), "companion-2026-10-04.log");
        let text = fs::read_to_string(path).unwrap();
        let lines: Vec<Value> = text.lines().map(|l| serde_json::from_str(l).unwrap()).collect();
        assert_eq!(lines.len(), 2, "{text}");
        assert_eq!(
            text.lines().next().unwrap(),
            r#"{"ts":"2026-10-04T18:30:05.123Z","level":"warn","msg":"api call failed","component":"api","endpoint":"POST /api/companion/lobby","status":503}"#
        );
        assert_eq!(lines[1]["msg"], "dependency warning");
    }

    #[test]
    fn old_files_are_pruned_on_rotation() {
        let temp = TempDir::new("log-prune");
        for day in ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"] {
            fs::write(temp.path().join(log_file_name(day)), "{}\n").unwrap();
        }
        fs::write(temp.path().join("unrelated.txt"), "x").unwrap();
        let sink = sink_at(temp.path(), 1_791_138_605_123);
        sink.write(LogLevel::Info, "hello", Vec::new());
        assert_eq!(
            list_log_files(temp.path()),
            vec![
                "companion-2026-10-04.log",
                "companion-2026-09-04.log",
                "companion-2026-09-03.log"
            ]
        );
        assert!(temp.path().join("unrelated.txt").exists());
    }

    #[test]
    fn an_unwritable_directory_never_panics() {
        let temp = TempDir::new("log-broken");
        let file_not_dir = temp.path().join("logs");
        fs::write(&file_not_dir, "x").unwrap();
        let sink = sink_at(&file_not_dir, 0);
        sink.write(LogLevel::Error, "still fine", Vec::new());
    }
}
