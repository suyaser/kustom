//! The config file and the per-group state directories (parity rows 2 to 4 and 21; `config.ts`,
//! `groups.ts`, `status.ts`).
//!
//! - **Where:** `%APPDATA%/customs-night/config.json` on Windows, `~/Library/Application
//!   Support/customs-night/config.json` on macOS, `$XDG_CONFIG_HOME/customs-night` elsewhere;
//!   `CUSTOMS_NIGHT_CONFIG_DIR` overrides it for development ([`config_dir`]).
//! - **What:** `apiBase`, `lockfilePath`, `groups[]` (`{ groupId, slug, name, companionToken? }`, a token
//!   per group since 0.4.0), `lastGroupId`, the 0.2.x/0.3.x top-level `companionToken`, `mode` (0.2.x/0.3.x;
//!   read, ignored, never written) and, since M17.5, `leagueInstallDir`. Every shape a real install can
//!   have is read ([`load_config`]); nothing in a file can make loading fail except a file that is not a
//!   JSON object, and even that is never overwritten.
//! - **Unknown keys are preserved**, at the top level and inside a group entry: every write is a
//!   read-modify-write of the raw object under the lock ([`update_config`]), touching only the keys it
//!   owns, in their original order. A person who goes back to 0.3.x during the rollout loses nothing.
//! - **Tokens:** [`CompanionToken`], the 43-character shape check; a bad one is "no token" and the window
//!   shows Link. Never logged.
//! - **Writes:** atomic (`config.json.tmp` + rename, retried while Windows holds the file) under
//!   `config.json.lock` (an owner-token file; a stale one is broken by rename; a live one is waited for
//!   and never taken). Before a write replaces the top-level token, the outgoing token is recorded as the
//!   owner of the root state ([`state`]).
//! - **State:** `groups/<groupId>/` per group (queue, `backfill.json`, `commands-done.json`, and the
//!   additive `last-posted.json`); the 0.2.x/0.3.x token's root state, its owner fingerprint, and its move
//!   into the group `/me` names ([`state`], [`startup`]).
//! - **Old engine check:** an old Kustom still running means no watchers ([`old_engine`]).

mod old_engine;
pub mod startup;
pub mod state;
mod token;
mod write;

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde_json::{Map, Value};

pub use old_engine::{
    OLD_ENGINE_SENTENCE, OldEngineCheck, ProcessProbe, STATUS_FILE_NAME, STATUS_FRESH_FOR,
    SystemProcessProbe, check_old_engine, parse_tasklist_csv,
};
pub use token::{
    COMPANION_TOKEN_LENGTH, CompanionToken, clean_token_input, fingerprint_of, looks_like_companion_token,
};
pub use write::{
    CONFIG_LOCK_STALE, CONFIG_LOCK_WAIT, ConfigWriteError, GroupRef, file_token_under_group, set_last_group,
    update_config, write_league_install_dir,
};

/// Overrides the config directory (development and tests).
pub const CONFIG_DIR_ENV: &str = "CUSTOMS_NIGHT_CONFIG_DIR";
/// The directory name under the platform's config root.
pub const CONFIG_DIR_NAME: &str = "customs-night";
/// The file.
pub const CONFIG_FILE_NAME: &str = "config.json";
/// `leagueInstallDir` (M17.5): the League folder a person picked when discovery could not find the client.
pub const LEAGUE_INSTALL_DIR_KEY: &str = "leagueInstallDir";
/// The 0.2.x/0.3.x key for a lockfile at a non-default path.
pub const LOCKFILE_PATH_KEY: &str = "lockfilePath";
/// The API origin key.
pub const API_BASE_KEY: &str = "apiBase";
/// The 0.2.x/0.3.x single token.
pub const COMPANION_TOKEN_KEY: &str = "companionToken";
/// The groups list.
pub const GROUPS_KEY: &str = "groups";
/// The group the next start opens on.
pub const LAST_GROUP_ID_KEY: &str = "lastGroupId";
/// 0.2.x/0.3.x's `host | overlay`. Read, ignored, never written.
pub const MODE_KEY: &str = "mode";

/// The local dev server, the API origin when nothing else names one.
pub const LOCAL_API_BASE: &str = "http://localhost:3000";

/// The deployed origin; what every release build uses unless `CUSTOMS_NIGHT_API_BASE` names another.
/// The TypeScript companion's `RELEASE_API_BASE`.
pub const RELEASE_API_BASE: &str = "https://playkustom.com";

/// Origins that used to be the deployed site and now only 308-redirect to [`RELEASE_API_BASE`]. The API
/// transport never follows redirects, so a saved `apiBase` naming one is replaced by the release origin
/// (in memory on every load, and on disk once by [`load_config`]). Normalised form, as [`parse_api_base`] returns.
pub const LEGACY_API_BASES: &[&str] = &["https://kustom-delta.vercel.app"];

/// Whether a normalised origin is one of [`LEGACY_API_BASES`] (also `http://` spelling, any case).
fn is_legacy_api_base(origin: &str) -> bool {
    let host = origin
        .strip_prefix("http://")
        .or_else(|| origin.strip_prefix("https://"))
        .unwrap_or(origin);
    LEGACY_API_BASES.iter().any(|legacy| {
        legacy
            .strip_prefix("https://")
            .is_some_and(|legacy_host| legacy_host.eq_ignore_ascii_case(host))
    })
}

/// The API origin used when `config.json` names none: `CUSTOMS_NIGHT_API_BASE` at build time if set (and
/// non-empty), else the deployed origin in a release build and the local dev server in a debug build
/// (`tauri:dev`, tests). A file's own `apiBase` always wins. A release build can never default to
/// localhost: v1.0.0 did, because nothing set the variable and pairing does not carry an origin.
pub const DEFAULT_API_BASE: &str = match option_env!("CUSTOMS_NIGHT_API_BASE") {
    Some(base) if !base.is_empty() => base,
    _ => {
        if cfg!(debug_assertions) {
            LOCAL_API_BASE
        } else {
            RELEASE_API_BASE
        }
    }
};

/// Which platform's config root to use.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    /// `%APPDATA%`.
    Windows,
    /// `~/Library/Application Support`.
    MacOs,
    /// `$XDG_CONFIG_HOME` or `~/.config`.
    Other,
}

impl Platform {
    /// This build's platform.
    pub fn current() -> Self {
        if cfg!(windows) {
            Platform::Windows
        } else if cfg!(target_os = "macos") {
            Platform::MacOs
        } else {
            Platform::Other
        }
    }
}

/// `config.ts` `configDir` with the environment injected: `env` answers a variable's value.
pub fn config_dir_from(platform: Platform, env: &dyn Fn(&str) -> Option<String>) -> Option<PathBuf> {
    let var = |name: &str| env(name).map(|v| v.trim().to_owned()).filter(|v| !v.is_empty());
    if let Some(dir) = var(CONFIG_DIR_ENV) {
        return Some(PathBuf::from(dir));
    }
    let home = var(if platform == Platform::Windows {
        "USERPROFILE"
    } else {
        "HOME"
    })
    .map(PathBuf::from);
    match platform {
        Platform::Windows => {
            let appdata = var("APPDATA")
                .map(PathBuf::from)
                .or_else(|| home.map(|h| h.join("AppData").join("Roaming")))?;
            Some(appdata.join(CONFIG_DIR_NAME))
        }
        Platform::MacOs => Some(
            home?
                .join("Library")
                .join("Application Support")
                .join(CONFIG_DIR_NAME),
        ),
        Platform::Other => Some(
            var("XDG_CONFIG_HOME")
                .map(PathBuf::from)
                .or_else(|| home.map(|h| h.join(".config")))?
                .join(CONFIG_DIR_NAME),
        ),
    }
}

/// The config directory for this host and process environment. `None` only with no home directory.
pub fn config_dir() -> Option<PathBuf> {
    config_dir_from(Platform::current(), &|name| std::env::var(name).ok())
}

/// `<dir>/config.json`.
pub fn config_path(dir: &Path) -> PathBuf {
    dir.join(CONFIG_FILE_NAME)
}

/// `config.ts` `apiBaseSchema`: trimmed, trailing slashes dropped, and an origin (`http(s)://host[:port]`,
/// no path). `None` for anything else.
pub fn parse_api_base(raw: &str) -> Option<String> {
    let value = raw.trim().trim_end_matches('/');
    let rest = value
        .strip_prefix("https://")
        .or_else(|| value.strip_prefix("http://"))?;
    if rest.is_empty() || rest.contains('/') || rest.chars().any(char::is_whitespace) {
        return None;
    }
    Some(value.to_owned())
}

/// Whether a group id is safe as a directory name (it becomes `groups/<groupId>/`). Server ids are UUIDs;
/// a hand-edited id with a separator or `..` is treated as a malformed entry, never as a path.
pub fn is_safe_group_id(id: &str) -> bool {
    !id.is_empty()
        && id != "."
        && id != ".."
        && id.len() <= 128
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// One group this PC knows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GroupEntry {
    /// The server's group id.
    pub group_id: String,
    /// The group's slug (may be empty in a hand-edited file).
    pub slug: String,
    /// The group's name.
    pub name: String,
    /// This PC's host token for it. `None` for a 0.3.x Overlay pairing, or a token that is not one.
    pub token: Option<CompanionToken>,
}

/// What `config.json` holds, as the engine uses it. The raw object (with every unknown key) stays on disk;
/// writes go through [`update_config`], never through this.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Config {
    /// The file's valid `apiBase`, else [`DEFAULT_API_BASE`].
    pub api_base: String,
    /// The file named an `apiBase` that is not an origin; [`DEFAULT_API_BASE`] is used instead.
    pub api_base_invalid: bool,
    /// `lockfilePath` (0.2.x/0.3.x), non-empty.
    pub lockfile_path: Option<String>,
    /// `leagueInstallDir` (M17.5), non-empty.
    pub league_install_dir: Option<String>,
    /// The 0.2.x/0.3.x top-level token, when it has a token's shape.
    pub top_level_token: Option<CompanionToken>,
    /// A top-level token was there but is not one (0.1.0's corrupted paste): "no token".
    pub top_level_token_malformed: bool,
    /// The groups that parsed, first entry per id kept.
    pub groups: Vec<GroupEntry>,
    /// Entries in `groups` that did not parse (left on disk untouched).
    pub malformed_groups: usize,
    /// `lastGroupId`, non-empty.
    pub last_group_id: Option<String>,
    /// `mode`, as 0.2.x/0.3.x wrote it. Informational only: the Rust app has one mode.
    pub legacy_mode: Option<String>,
}

/// What [`load_config`] found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LoadOutcome {
    /// No `config.json`: a fresh install. Opens on Link.
    Missing,
    /// A file that parsed.
    Loaded(Config),
    /// A file that exists but cannot be used (not JSON, not an object, unreadable). Never overwritten;
    /// `reason` never quotes the file (it may hold a token).
    Unreadable {
        /// What is wrong, in a few words.
        reason: String,
    },
}

impl LoadOutcome {
    /// The config, or an empty one for a missing file. `None` for an unreadable file.
    pub fn config(&self) -> Option<Config> {
        match self {
            LoadOutcome::Loaded(config) => Some(config.clone()),
            LoadOutcome::Missing => Some(Config::from_raw(&Map::new())),
            LoadOutcome::Unreadable { .. } => None,
        }
    }
}

fn non_empty_str(raw: &Map<String, Value>, key: &str) -> Option<String> {
    let value = raw.get(key)?.as_str()?.trim();
    (!value.is_empty()).then(|| value.to_owned())
}

/// One raw group entry, as `groupEntrySchema` reads it (`groupId` non-empty, `slug` and `name` strings,
/// `companionToken` optional). Unlike 0.4.0, a malformed token makes the entry tokenless rather than
/// dropping it: either way it cannot host, and the entry still names the group.
pub(crate) fn parse_group_entry(value: &Value) -> Option<GroupEntry> {
    let object = value.as_object()?;
    let group_id = object.get("groupId")?.as_str()?;
    if !is_safe_group_id(group_id) {
        return None;
    }
    Some(GroupEntry {
        group_id: group_id.to_owned(),
        slug: object.get("slug")?.as_str()?.to_owned(),
        name: object.get("name")?.as_str()?.to_owned(),
        token: object
            .get(COMPANION_TOKEN_KEY)
            .and_then(Value::as_str)
            .and_then(CompanionToken::parse),
    })
}

impl Config {
    /// Reads the known keys of a raw config object. Never fails.
    pub fn from_raw(raw: &Map<String, Value>) -> Self {
        let file_api_base = raw.get(API_BASE_KEY).and_then(Value::as_str);
        let api_base = file_api_base.and_then(parse_api_base).map(|origin| {
            if is_legacy_api_base(&origin) {
                RELEASE_API_BASE.to_owned()
            } else {
                origin
            }
        });
        let top_level_raw = raw
            .get(COMPANION_TOKEN_KEY)
            .and_then(Value::as_str)
            .filter(|t| !t.trim().is_empty());
        let top_level_token = top_level_raw.and_then(CompanionToken::parse);
        let mut groups: Vec<GroupEntry> = Vec::new();
        let mut malformed_groups = 0;
        if let Some(Value::Array(items)) = raw.get(GROUPS_KEY) {
            for item in items {
                match parse_group_entry(item) {
                    Some(entry) if !groups.iter().any(|g| g.group_id == entry.group_id) => groups.push(entry),
                    Some(_) => {}
                    None => malformed_groups += 1,
                }
            }
        }
        Config {
            api_base: api_base.clone().unwrap_or_else(|| DEFAULT_API_BASE.to_owned()),
            api_base_invalid: file_api_base.is_some() && api_base.is_none(),
            lockfile_path: non_empty_str(raw, LOCKFILE_PATH_KEY),
            league_install_dir: non_empty_str(raw, LEAGUE_INSTALL_DIR_KEY),
            top_level_token_malformed: top_level_raw.is_some() && top_level_token.is_none(),
            top_level_token,
            groups,
            malformed_groups,
            last_group_id: raw
                .get(LAST_GROUP_ID_KEY)
                .and_then(Value::as_str)
                .filter(|v| !v.is_empty())
                .map(str::to_owned),
            legacy_mode: raw.get(MODE_KEY).and_then(Value::as_str).map(str::to_owned),
        }
    }
}

/// Reads `<dir>/config.json` as a raw object. `Ok(None)` when there is no file.
pub(crate) fn read_raw(dir: &Path) -> Result<Option<Map<String, Value>>, String> {
    let text = match fs::read_to_string(config_path(dir)) {
        Ok(text) => text,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("could not read config.json: {}", error.kind())),
    };
    match serde_json::from_str::<Value>(&text) {
        Ok(Value::Object(map)) => Ok(Some(map)),
        Ok(_) => Err("config.json is not a JSON object".to_owned()),
        // Never serde's message with a snippet: for a hand-edited file it may be the token.
        Err(error) => Err(format!("config.json is not JSON (line {})", error.line())),
    }
}

/// Reads and interprets `<dir>/config.json`. Never panics; logs one line per oddity, never a value.
pub fn load_config(dir: &Path) -> LoadOutcome {
    match read_raw(dir) {
        Ok(None) => LoadOutcome::Missing,
        Err(reason) => {
            tracing::warn!(reason = %reason, "config.json cannot be used; it is left as it is");
            LoadOutcome::Unreadable { reason }
        }
        Ok(Some(raw)) => {
            let config = Config::from_raw(&raw);
            let saved_legacy = raw
                .get(API_BASE_KEY)
                .and_then(Value::as_str)
                .and_then(parse_api_base)
                .is_some_and(|origin| is_legacy_api_base(&origin));
            if saved_legacy {
                match write::update_config(dir, |raw| {
                    raw.insert(
                        API_BASE_KEY.to_owned(),
                        Value::String(RELEASE_API_BASE.to_owned()),
                    );
                    Ok(())
                }) {
                    Ok(()) => {
                        tracing::info!(apiBase = %RELEASE_API_BASE, "config.json's legacy apiBase moved to the release origin")
                    }
                    Err(error) => tracing::warn!(
                        error = %error,
                        apiBase = %RELEASE_API_BASE,
                        "config.json's legacy apiBase could not be rewritten; using the release origin in memory"
                    ),
                }
            }
            if config.api_base_invalid {
                tracing::warn!(apiBase = %DEFAULT_API_BASE, "config.json's apiBase is not an origin; using the default");
            }
            if config.top_level_token_malformed {
                tracing::warn!("config.json's companionToken does not look like a token; it is not used");
            }
            if config.malformed_groups > 0 {
                tracing::warn!(
                    entries = config.malformed_groups,
                    "config.json has group entries that do not parse; they are kept on disk and not used"
                );
            }
            LoadOutcome::Loaded(config)
        }
    }
}

/// `leagueInstallDir`, when set to a non-empty string. A missing or unreadable file is `None`.
pub fn read_league_install_dir(config_dir: &Path) -> Option<PathBuf> {
    let raw = read_raw(config_dir).ok()??;
    non_empty_str(&raw, LEAGUE_INSTALL_DIR_KEY).map(PathBuf::from)
}

/// `lockfilePath` (0.2.x/0.3.x), when set to a non-empty string.
pub fn read_lockfile_path(config_dir: &Path) -> Option<PathBuf> {
    let raw = read_raw(config_dir).ok()??;
    non_empty_str(&raw, LOCKFILE_PATH_KEY).map(PathBuf::from)
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use crate::test_support::TempDir;
    use serde_json::json;

    fn env_of(pairs: &'static [(&'static str, &'static str)]) -> impl Fn(&str) -> Option<String> {
        move |name| {
            pairs
                .iter()
                .find(|(k, _)| *k == name)
                .map(|(_, v)| (*v).to_owned())
        }
    }

    #[test]
    fn config_dir_per_platform() {
        let win = env_of(&[
            ("APPDATA", "C:\\Users\\a\\AppData\\Roaming"),
            ("USERPROFILE", "C:\\Users\\a"),
        ]);
        assert_eq!(
            config_dir_from(Platform::Windows, &win).unwrap(),
            PathBuf::from("C:\\Users\\a\\AppData\\Roaming").join("customs-night")
        );
        let mac = env_of(&[("HOME", "/Users/a")]);
        assert_eq!(
            config_dir_from(Platform::MacOs, &mac).unwrap(),
            PathBuf::from("/Users/a/Library/Application Support/customs-night")
        );
        let linux = env_of(&[("HOME", "/home/a")]);
        assert_eq!(
            config_dir_from(Platform::Other, &linux).unwrap(),
            PathBuf::from("/home/a/.config/customs-night")
        );
        let over = env_of(&[(CONFIG_DIR_ENV, " /tmp/x "), ("HOME", "/home/a")]);
        assert_eq!(
            config_dir_from(Platform::MacOs, &over).unwrap(),
            PathBuf::from("/tmp/x")
        );
        assert_eq!(config_dir_from(Platform::MacOs, &env_of(&[])), None);
    }

    #[test]
    fn default_api_base_is_a_valid_origin_and_never_local_in_release() {
        assert_eq!(
            parse_api_base(DEFAULT_API_BASE).as_deref(),
            Some(DEFAULT_API_BASE)
        );
        assert_eq!(
            parse_api_base(RELEASE_API_BASE).as_deref(),
            Some(RELEASE_API_BASE)
        );
        assert!(RELEASE_API_BASE.starts_with("https://"));
        if option_env!("CUSTOMS_NIGHT_API_BASE").is_none() {
            let expected = if cfg!(debug_assertions) {
                LOCAL_API_BASE
            } else {
                RELEASE_API_BASE
            };
            assert_eq!(DEFAULT_API_BASE, expected);
        }
    }

    #[test]
    fn a_hand_written_api_base_only_file_is_used_before_any_pairing() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().to_path_buf();
        fs::write(config_path(&dir), r#"{"apiBase":"https://kustom.gg"}"#).unwrap();
        let LoadOutcome::Loaded(config) = load_config(&dir) else {
            panic!("not loaded")
        };
        assert_eq!(config.api_base, "https://kustom.gg");
        assert!(!config.api_base_invalid);
        assert!(config.groups.is_empty());
    }

    #[test]
    fn a_saved_legacy_api_base_becomes_the_release_origin_and_the_file_is_rewritten() {
        for saved in [
            "https://kustom-delta.vercel.app",
            "https://kustom-delta.vercel.app/",
            "http://kustom-delta.vercel.app",
        ] {
            let tmp = tempfile::tempdir().unwrap();
            let dir = tmp.path().to_path_buf();
            let token = format!("kcn_{}", "a".repeat(40));
            let body = format!(
                r#"{{"zFuture":1,"apiBase":"{saved}","companionToken":"{token}","lastGroupId":"g1"}}"#
            );
            fs::write(config_path(&dir), body).unwrap();
            let LoadOutcome::Loaded(config) = load_config(&dir) else {
                panic!("not loaded")
            };
            assert_eq!(config.api_base, RELEASE_API_BASE, "{saved}");
            assert!(!config.api_base_invalid);
            let on_disk: Value =
                serde_json::from_str(&fs::read_to_string(config_path(&dir)).unwrap()).unwrap();
            assert_eq!(on_disk["apiBase"], RELEASE_API_BASE);
            assert_eq!(on_disk["zFuture"], 1);
            assert_eq!(on_disk["companionToken"], token.as_str());
            assert_eq!(on_disk["lastGroupId"], "g1");
        }
    }

    #[test]
    fn a_non_legacy_api_base_is_left_on_disk_untouched() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().to_path_buf();
        let body = r#"{"apiBase":"http://localhost:3000/"}"#;
        fs::write(config_path(&dir), body).unwrap();
        let LoadOutcome::Loaded(config) = load_config(&dir) else {
            panic!("not loaded")
        };
        assert_eq!(config.api_base, "http://localhost:3000");
        assert_eq!(fs::read_to_string(config_path(&dir)).unwrap(), body);
    }

    #[test]
    fn api_base_is_an_origin() {
        assert_eq!(
            parse_api_base(" https://kustom.gg/ ").as_deref(),
            Some("https://kustom.gg")
        );
        assert_eq!(
            parse_api_base("http://localhost:3000").as_deref(),
            Some("http://localhost:3000")
        );
        for bad in ["", "kustom.gg", "https://kustom.gg/api", "ftp://x", "https://"] {
            assert_eq!(parse_api_base(bad), None, "{bad}");
        }
    }

    #[test]
    fn reads_odd_files_without_failing() {
        let raw = json!({
            "apiBase": "not a url",
            "companionToken": "[200~corrupted",
            "groups": [
                { "groupId": "g1", "slug": "a", "name": "A" },
                { "groupId": "g1", "slug": "dup", "name": "Dup" },
                { "groupId": "../escape", "slug": "x", "name": "X" },
                "nonsense",
            ],
            "lastGroupId": "",
            "mode": "overlay",
        });
        let config = Config::from_raw(raw.as_object().unwrap());
        assert_eq!(config.api_base, DEFAULT_API_BASE);
        assert!(config.api_base_invalid);
        assert!(config.top_level_token_malformed);
        assert_eq!(config.top_level_token, None);
        assert_eq!(config.groups.len(), 1);
        assert_eq!(config.malformed_groups, 2);
        assert_eq!(config.last_group_id, None);
        assert_eq!(config.legacy_mode.as_deref(), Some("overlay"));
    }

    #[test]
    fn missing_and_unreadable_files() {
        let temp = TempDir::new("config-load");
        assert_eq!(load_config(temp.path()), LoadOutcome::Missing);
        fs::write(config_path(temp.path()), "{\"companionToken\": \"abc").unwrap();
        match load_config(temp.path()) {
            LoadOutcome::Unreadable { reason } => assert!(!reason.contains("abc"), "{reason}"),
            other => panic!("{other:?}"),
        }
        fs::write(config_path(temp.path()), "[1]").unwrap();
        assert!(matches!(load_config(temp.path()), LoadOutcome::Unreadable { .. }));
    }

    #[test]
    fn reads_the_league_keys_and_ignores_blanks() {
        let temp = TempDir::new("config-league-keys");
        fs::write(
            config_path(temp.path()),
            r#"{"lockfilePath":"  ","leagueInstallDir":"D:\\Games\\League of Legends"}"#,
        )
        .unwrap();
        assert_eq!(read_lockfile_path(temp.path()), None);
        assert_eq!(
            read_league_install_dir(temp.path()),
            Some(PathBuf::from("D:\\Games\\League of Legends"))
        );
    }
}
