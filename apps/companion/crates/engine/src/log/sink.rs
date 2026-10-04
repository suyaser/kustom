//! The file half of the log: daily `logs/companion-<YYYY-MM-DD>.log`, one JSON object per line, pruned to
//! the newest [`DEFAULT_KEEP_DAYS`] files (`log.ts` `FileSink`, same names, same line shape:
//! `{"ts","level","msg",...fields}`).
//!
//! Every line is scrubbed ([`super::scrub`]) and redacted ([`super::secrets`]) before it is formatted. A
//! write that fails (disk full, permissions) is reported once on the console and otherwise ignored:
//! logging never panics and never returns an error to the code that logged.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde_json::Value;

use super::clock::{Clock, date_stamp, iso_timestamp};
use super::scrub::{REDACTED, is_sensitive_key, scrub_value};
use super::secrets::{redact_text, redact_value};

/// Files beyond this many (by the date in the name) are deleted when the day rolls over.
pub const DEFAULT_KEEP_DAYS: usize = 14;

/// The file name's prefix.
pub const LOG_FILE_PREFIX: &str = "companion-";

/// A log level, as the line spells it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum LogLevel {
    /// `debug` (and `tracing`'s `TRACE`).
    Debug,
    /// `info`.
    Info,
    /// `warn`.
    Warn,
    /// `error`.
    Error,
}

impl LogLevel {
    /// The word on the line.
    pub fn as_str(self) -> &'static str {
        match self {
            LogLevel::Debug => "debug",
            LogLevel::Info => "info",
            LogLevel::Warn => "warn",
            LogLevel::Error => "error",
        }
    }

    /// `debug | info | warn | error`, else `None`.
    pub fn parse(text: &str) -> Option<Self> {
        match text.trim().to_ascii_lowercase().as_str() {
            "debug" => Some(LogLevel::Debug),
            "info" => Some(LogLevel::Info),
            "warn" => Some(LogLevel::Warn),
            "error" => Some(LogLevel::Error),
            _ => None,
        }
    }

    /// `tracing`'s level, with `TRACE` folded into `debug`.
    pub fn from_tracing(level: &tracing::Level) -> Self {
        match *level {
            tracing::Level::ERROR => LogLevel::Error,
            tracing::Level::WARN => LogLevel::Warn,
            tracing::Level::INFO => LogLevel::Info,
            _ => LogLevel::Debug,
        }
    }
}

/// `companion-2026-10-04.log` for a date stamp.
pub fn log_file_name(stamp: &str) -> String {
    format!("{LOG_FILE_PREFIX}{stamp}.log")
}

fn is_log_file_name(name: &str) -> bool {
    let Some(stamp) = name
        .strip_prefix(LOG_FILE_PREFIX)
        .and_then(|rest| rest.strip_suffix(".log"))
    else {
        return false;
    };
    let bytes = stamp.as_bytes();
    bytes.len() == 10
        && bytes.iter().enumerate().all(|(i, b)| {
            if i == 4 || i == 7 {
                *b == b'-'
            } else {
                b.is_ascii_digit()
            }
        })
}

/// The log files in `dir`, newest first by the date in the name. A missing directory has none.
pub fn list_log_files(dir: &Path) -> Vec<String> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut names: Vec<String> = entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| is_log_file_name(name))
        .collect();
    names.sort_by(|a, b| b.cmp(a));
    names
}

/// Deletes every log file beyond the newest `keep_days`. Returns what it deleted.
pub fn prune_log_files(dir: &Path, keep_days: usize) -> Vec<String> {
    let mut deleted = Vec::new();
    for name in list_log_files(dir).into_iter().skip(keep_days) {
        if fs::remove_file(dir.join(&name)).is_ok() {
            deleted.push(name);
        }
    }
    deleted
}

/// Where console lines go. `None` silences the console.
pub type ConsoleFn = Box<dyn Fn(LogLevel, &str) + Send + Sync>;

/// How a [`LogSink`] is set up.
pub struct SinkOptions {
    /// The `logs/` directory. `None` disables the file (the console still works).
    pub dir: Option<PathBuf>,
    /// Lowest level written to the file. Default `debug`.
    pub file_level: LogLevel,
    /// Lowest level echoed on the console. Default `info`.
    pub console_level: LogLevel,
    /// The console. Default: none (the shipped app is a windowed app with no console).
    pub console: Option<ConsoleFn>,
    /// The clock for `ts` and the file's date.
    pub clock: Clock,
    /// Files kept. Default [`DEFAULT_KEEP_DAYS`].
    pub keep_days: usize,
}

struct SinkState {
    stamp: Option<String>,
    path: Option<PathBuf>,
    broken: bool,
}

/// The writer every log line goes through.
pub struct LogSink {
    options: SinkOptions,
    state: Mutex<SinkState>,
}

/// One line's fields, in the order they were given. A later key replaces an earlier one in place.
pub type Fields = Vec<(String, Value)>;

/// Sets `key` in `fields`, replacing an earlier value in place.
pub fn set_field(fields: &mut Fields, key: &str, value: Value) {
    if let Some(slot) = fields.iter_mut().find(|(known, _)| known == key) {
        slot.1 = value;
    } else {
        fields.push((key.to_owned(), value));
    }
}

impl LogSink {
    /// A sink. Creates nothing until the first line.
    pub fn new(options: SinkOptions) -> Self {
        LogSink {
            options,
            state: Mutex::new(SinkState {
                stamp: None,
                path: None,
                broken: false,
            }),
        }
    }

    /// The lowest level anything is written at.
    pub fn min_level(&self) -> LogLevel {
        if self.options.console.is_some() {
            self.options.file_level.min(self.options.console_level)
        } else {
            self.options.file_level
        }
    }

    /// The file lines are going to now, once one has been written.
    pub fn current_file(&self) -> Option<PathBuf> {
        match self.state.lock() {
            Ok(state) => state.path.clone(),
            Err(poisoned) => poisoned.into_inner().path.clone(),
        }
    }

    /// Writes one line. Never panics, never fails.
    pub fn write(&self, level: LogLevel, message: &str, fields: Fields) {
        let to_file = level >= self.options.file_level && self.options.dir.is_some();
        let to_console = level >= self.options.console_level && self.options.console.is_some();
        if !to_file && !to_console {
            return;
        }
        let now = (self.options.clock)();
        let message = redact_text(message);
        let fields: Fields = fields
            .into_iter()
            .map(|(key, value)| {
                let value = if is_sensitive_key(&key) {
                    Value::String(REDACTED.to_owned())
                } else {
                    redact_value(&scrub_value(&value))
                };
                (redact_text(&key), value)
            })
            .collect();

        if to_file {
            let mut record: Fields = vec![
                ("ts".to_owned(), Value::String(iso_timestamp(now))),
                ("level".to_owned(), Value::String(level.as_str().to_owned())),
                ("msg".to_owned(), Value::String(message.clone())),
            ];
            for (key, value) in &fields {
                set_field(&mut record, key, value.clone());
            }
            let mut line = String::from("{");
            for (i, (key, value)) in record.iter().enumerate() {
                if i > 0 {
                    line.push(',');
                }
                line.push_str(&Value::String(key.clone()).to_string());
                line.push(':');
                line.push_str(&value.to_string());
            }
            line.push_str("}\n");
            self.append(&date_stamp(now), &line);
        }
        if to_console && let Some(console) = &self.options.console {
            let time = &iso_timestamp(now)[11..19];
            let mut text = format!("{time} {:<5} {message}", level.as_str());
            for (key, value) in &fields {
                let shown = match value {
                    Value::String(s) if !s.contains([' ', '"', '=']) => s.clone(),
                    other => other.to_string(),
                };
                text.push_str(&format!(" {key}={shown}"));
            }
            console(level, &text);
        }
    }

    fn append(&self, stamp: &str, line: &str) {
        let Some(dir) = &self.options.dir else {
            return;
        };
        let mut state = match self.state.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        let rotated = state.stamp.as_deref() != Some(stamp);
        let result = (|| -> std::io::Result<()> {
            if rotated {
                create_private_dir(dir)?;
                state.stamp = Some(stamp.to_owned());
                state.path = Some(dir.join(log_file_name(stamp)));
            }
            let path = state
                .path
                .clone()
                .unwrap_or_else(|| dir.join(log_file_name(stamp)));
            let mut options = OpenOptions::new();
            options.create(true).append(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            options.open(&path)?.write_all(line.as_bytes())
        })();
        match result {
            Ok(()) => {
                state.broken = false;
                if rotated {
                    // Today's file exists now, so "keep 14" counts it.
                    prune_log_files(dir, self.options.keep_days);
                }
            }
            Err(error) => {
                if !state.broken {
                    state.broken = true;
                    if let Some(console) = &self.options.console {
                        console(
                            LogLevel::Error,
                            &format!("log file write failed, continuing without file logging: {error}"),
                        );
                    }
                }
            }
        }
    }
}

/// `mkdir -p` with owner-only permissions where the platform has them.
pub(crate) fn create_private_dir(dir: &Path) -> std::io::Result<()> {
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(dir)
}
