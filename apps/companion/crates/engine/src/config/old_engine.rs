//! "Is the old Kustom still running?" (parity row 21; M17 migration: "If it finds a fresh `status.json`
//! (an old engine still running), it starts no watchers and says `The old Kustom is still running. Close
//! it, then press Retry.`, because two engines on one queue can double-handle a command.")
//!
//! 0.2.x to 0.4.0 write `status.json` beside the config only when their state changes (`status.ts`), and
//! never remove it on exit, so the file's age alone cannot tell an idle old engine from one that quit last
//! week. The rule is therefore:
//! 1. No `status.json`: no old engine (a 0.1.x install, a fresh one, or the Rust app's own PC). No probe.
//! 2. `status.json` is there and the process list answers: running exactly when a process with an old
//!    engine's image name is up that is not this process (`kustom-engine*.exe`, the 0.2.x+ sidecar,
//!    always; `Kustom.exe` and `customs-night-companion.exe`, the console builds, when the PID is not
//!    ours).
//! 3. `status.json` is there and the process list cannot be read (macOS development, or `tasklist`
//!    failed): running when its `updatedAt` (else its modification time) is younger than
//!    [`STATUS_FRESH_FOR`].
//!
//! **Once the check passes, `status.json` is retired** (renamed to `status.json.retired-<UTC date>`;
//! nothing else reads it), so the rule fires only while a real pre-1.0 engine may be around. Without that,
//! a second Rust instance or the updater's relaunch (the previous `Kustom.exe` still exiting) would read as
//! "the old Kustom is still running" on every start, forever, because 0.x never deletes the file. A 0.x run
//! after a rollback writes a new `status.json`, and the next Rust start checks again.
//!
//! Read once per start (and on Retry). The Rust app never writes `status.json`.

use std::fs;
use std::path::Path;
use std::time::{Duration, SystemTime};

use crate::log::{date_stamp, parse_iso_timestamp};

/// The old engine's status file.
pub const STATUS_FILE_NAME: &str = "status.json";

/// How young a `status.json` must be to mean "running" when the process list cannot be read.
pub const STATUS_FRESH_FOR: Duration = Duration::from_secs(120);

/// The sentence the window shows (M17.2 §9, signed copy).
pub const OLD_ENGINE_SENTENCE: &str = "The old Kustom is still running. Close it, then press Retry.";

/// What the check found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OldEngineCheck {
    /// Start as normal.
    NotRunning,
    /// Start no watchers; show [`OLD_ENGINE_SENTENCE`] and Retry.
    Running {
        /// Why: the process names seen, or `fresh status.json`. For the log.
        evidence: String,
    },
}

/// The process list, injected so the rule is tested on every platform.
pub trait ProcessProbe: Send + Sync {
    /// Image names and PIDs of running processes, or `None` when the list cannot be read here.
    fn processes(&self) -> Option<Vec<(String, u32)>>;
    /// This process's PID.
    fn own_pid(&self) -> u32 {
        std::process::id()
    }
}

/// The real process list: `tasklist /FO CSV /NH` on Windows (no window flashes), nothing elsewhere.
pub struct SystemProcessProbe;

impl ProcessProbe for SystemProcessProbe {
    #[cfg(windows)]
    fn processes(&self) -> Option<Vec<(String, u32)>> {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let output = std::process::Command::new("tasklist")
            .args(["/FO", "CSV", "/NH"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        Some(parse_tasklist_csv(&String::from_utf8_lossy(&output.stdout)))
    }

    #[cfg(not(windows))]
    fn processes(&self) -> Option<Vec<(String, u32)>> {
        None
    }
}

/// Parses `tasklist /FO CSV /NH` (`"Kustom.exe","1234","Console","1","95,000 K"`): image name and PID per
/// line; lines that do not parse are skipped.
pub fn parse_tasklist_csv(text: &str) -> Vec<(String, u32)> {
    text.lines()
        .filter_map(|line| {
            let mut fields = line.trim().split("\",\"");
            let name = fields.next()?.trim_start_matches('"');
            let pid = fields.next()?.trim_end_matches('"').parse().ok()?;
            (!name.is_empty()).then(|| (name.to_owned(), pid))
        })
        .collect()
}

fn is_old_engine(name: &str, pid: u32, own_pid: u32) -> bool {
    let lower = name.to_ascii_lowercase();
    if lower.starts_with("kustom-engine") && lower.ends_with(".exe") {
        return true;
    }
    pid != own_pid && (lower == "kustom.exe" || lower == "customs-night-companion.exe")
}

fn status_time(path: &Path) -> Option<SystemTime> {
    let text = fs::read_to_string(path).ok()?;
    let from_body = serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|v| v.get("updatedAt")?.as_str().and_then(parse_iso_timestamp));
    from_body.or_else(|| fs::metadata(path).ok()?.modified().ok())
}

/// Runs the check against `<config dir>/status.json`, and retires the file when the answer is
/// [`OldEngineCheck::NotRunning`]. Never fails.
pub fn check_old_engine(config_dir: &Path, now: SystemTime, probe: &dyn ProcessProbe) -> OldEngineCheck {
    let status = config_dir.join(STATUS_FILE_NAME);
    if !status.exists() {
        return OldEngineCheck::NotRunning;
    }
    let check = evaluate(&status, now, probe);
    if check == OldEngineCheck::NotRunning {
        retire_status(config_dir, &status, now);
    }
    check
}

/// `status.json` -> `status.json.retired-<date>` (a numeric suffix if that is taken). A failure is a log
/// line: the check then simply runs again on the next start.
fn retire_status(config_dir: &Path, status: &Path, now: SystemTime) {
    let base = format!("{STATUS_FILE_NAME}.retired-{}", date_stamp(now));
    let mut target = config_dir.join(&base);
    let mut n = 1;
    while target.exists() {
        target = config_dir.join(format!("{base}.{n}"));
        n += 1;
    }
    match fs::rename(status, &target) {
        Ok(()) => tracing::info!(
            component = "startup",
            retired = %target.display(),
            "the old Kustom's status.json is retired"
        ),
        Err(error) => tracing::warn!(component = "startup", error = %error, "could not retire status.json"),
    }
}

fn evaluate(status: &Path, now: SystemTime, probe: &dyn ProcessProbe) -> OldEngineCheck {
    let own_pid = probe.own_pid();
    match probe.processes() {
        Some(processes) => {
            let seen: Vec<String> = processes
                .into_iter()
                .filter(|(name, pid)| is_old_engine(name, *pid, own_pid))
                .map(|(name, pid)| format!("{name} ({pid})"))
                .collect();
            if seen.is_empty() {
                OldEngineCheck::NotRunning
            } else {
                OldEngineCheck::Running {
                    evidence: seen.join(", "),
                }
            }
        }
        None => match status_time(status) {
            Some(at) if now.duration_since(at).unwrap_or(Duration::ZERO) < STATUS_FRESH_FOR => {
                OldEngineCheck::Running {
                    evidence: "fresh status.json".to_owned(),
                }
            }
            _ => OldEngineCheck::NotRunning,
        },
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use crate::test_support::TempDir;
    use std::time::UNIX_EPOCH;

    struct Fake(Option<Vec<(String, u32)>>);
    impl ProcessProbe for Fake {
        fn processes(&self) -> Option<Vec<(String, u32)>> {
            self.0.clone()
        }
        fn own_pid(&self) -> u32 {
            42
        }
    }

    fn list(items: &[(&str, u32)]) -> Fake {
        Fake(Some(items.iter().map(|(n, p)| ((*n).to_owned(), *p)).collect()))
    }

    const STATUS: &str = r#"{"mode":"host","state":"waiting","phase":null,"playerName":null,"overlayUrl":"http://127.0.0.1:5000/","overlayVisible":false,"error":null,"updatedAt":"2026-10-04T18:00:00.000Z"}"#;

    fn at(iso: &str) -> SystemTime {
        parse_iso_timestamp(iso).unwrap()
    }

    #[test]
    fn parses_tasklist() {
        let text = "\"System Idle Process\",\"0\",\"Services\",\"0\",\"8 K\"\r\n\"Kustom.exe\",\"1234\",\"Console\",\"1\",\"95,000 K\"\r\ngarbage\r\n";
        assert_eq!(
            parse_tasklist_csv(text),
            vec![
                ("System Idle Process".to_owned(), 0),
                ("Kustom.exe".to_owned(), 1234)
            ]
        );
    }

    #[test]
    fn no_status_file_means_no_old_engine_without_a_probe() {
        let temp = TempDir::new("old-engine-none");
        assert_eq!(
            check_old_engine(temp.path(), UNIX_EPOCH, &list(&[("kustom-engine.exe", 7)])),
            OldEngineCheck::NotRunning
        );
    }

    #[test]
    fn the_process_list_decides_when_it_answers() {
        let temp = TempDir::new("old-engine-probe");
        fs::write(temp.path().join(STATUS_FILE_NAME), STATUS).unwrap();
        let now = at("2026-10-04T18:00:10.000Z");
        assert!(matches!(
            check_old_engine(
                temp.path(),
                now,
                &list(&[("kustom-engine-x86_64-pc-windows-msvc.exe", 7)])
            ),
            OldEngineCheck::Running { .. }
        ));
        assert!(matches!(
            check_old_engine(temp.path(), now, &list(&[("Kustom.exe", 9)])),
            OldEngineCheck::Running { .. }
        ));
        // Our own Kustom.exe, and an old status.json, is not an old engine.
        assert_eq!(
            check_old_engine(
                temp.path(),
                now,
                &list(&[("Kustom.exe", 42), ("explorer.exe", 1)])
            ),
            OldEngineCheck::NotRunning
        );
    }

    fn retired(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|n| n.starts_with("status.json.retired-"))
            .collect();
        names.sort();
        names
    }

    #[test]
    fn a_pass_retires_status_json_and_a_running_old_engine_keeps_it() {
        let temp = TempDir::new("old-engine-retire");
        fs::write(temp.path().join(STATUS_FILE_NAME), STATUS).unwrap();
        let now = at("2026-10-04T18:00:10.000Z");
        assert!(matches!(
            check_old_engine(temp.path(), now, &list(&[("kustom-engine.exe", 7)])),
            OldEngineCheck::Running { .. }
        ));
        assert!(
            temp.path().join(STATUS_FILE_NAME).exists(),
            "kept while the old engine runs"
        );
        assert_eq!(
            check_old_engine(temp.path(), now, &list(&[("Kustom.exe", 42)])),
            OldEngineCheck::NotRunning
        );
        assert!(!temp.path().join(STATUS_FILE_NAME).exists());
        assert_eq!(retired(temp.path()), ["status.json.retired-2026-10-04"]);
        // A rollback to 0.x writes a new one; the next pass retires it beside the first.
        fs::write(temp.path().join(STATUS_FILE_NAME), STATUS).unwrap();
        check_old_engine(temp.path(), now, &list(&[]));
        assert_eq!(
            retired(temp.path()),
            [
                "status.json.retired-2026-10-04",
                "status.json.retired-2026-10-04.1"
            ]
        );
    }

    #[test]
    fn a_second_rust_instance_with_a_stale_0_3_status_is_not_an_old_engine() {
        let temp = TempDir::new("old-engine-second-instance");
        fs::write(temp.path().join(STATUS_FILE_NAME), STATUS).unwrap();
        let now = at("2026-10-05T09:00:00.000Z");
        // The first Rust start (only itself running) passes and retires the 0.3.x file.
        assert_eq!(
            check_old_engine(temp.path(), now, &list(&[("Kustom.exe", 42)])),
            OldEngineCheck::NotRunning
        );
        // A second Rust instance starts while the first runs: another PID's Kustom.exe, no status.json.
        assert_eq!(
            check_old_engine(temp.path(), now, &list(&[("Kustom.exe", 42), ("Kustom.exe", 77)])),
            OldEngineCheck::NotRunning
        );
    }

    #[test]
    fn the_updater_relaunch_is_not_an_old_engine() {
        let temp = TempDir::new("old-engine-relaunch");
        fs::write(temp.path().join(STATUS_FILE_NAME), STATUS).unwrap();
        // 1.0.0 starts and retires the file.
        check_old_engine(
            temp.path(),
            at("2026-10-05T09:00:00.000Z"),
            &list(&[("Kustom.exe", 42)]),
        );
        // 1.0.1 relaunches while 1.0.0's process (another PID) is still exiting.
        let relaunch = check_old_engine(
            temp.path(),
            at("2026-10-06T21:30:00.000Z"),
            &list(&[
                ("Kustom.exe", 4100),
                ("Kustom.exe", 42),
                ("msedgewebview2.exe", 900),
            ]),
        );
        assert_eq!(relaunch, OldEngineCheck::NotRunning);
    }

    #[test]
    fn without_a_process_list_the_status_age_decides() {
        let temp = TempDir::new("old-engine-age");
        fs::write(temp.path().join(STATUS_FILE_NAME), STATUS).unwrap();
        assert!(matches!(
            check_old_engine(temp.path(), at("2026-10-04T18:01:00.000Z"), &Fake(None)),
            OldEngineCheck::Running { .. }
        ));
        assert_eq!(
            check_old_engine(temp.path(), at("2026-10-04T19:00:00.000Z"), &Fake(None)),
            OldEngineCheck::NotRunning
        );
    }
}
