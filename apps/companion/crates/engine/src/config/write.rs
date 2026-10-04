//! Writing `config.json`: read-modify-write of the raw object under `config.json.lock`, atomic
//! tmp + rename (`config.ts` `updateConfig`, `withConfigLock`, `writeConfigBody`; `groups.ts`
//! `fileTokenUnderGroup`, `setLastGroup`).
//!
//! Synchronous, like the TypeScript writes it ports: a write waits for the lock for at most
//! [`CONFIG_LOCK_WAIT`] with short sleeps, so async callers run it in `spawn_blocking`.

use std::fmt;
use std::fs::{self, OpenOptions};
use std::io::{self, Read as _, Write as _};
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, SystemTime};

use serde_json::{Map, Value};

use super::state::protect_root_state;
use super::{
    API_BASE_KEY, COMPANION_TOKEN_KEY, CONFIG_FILE_NAME, CompanionToken, GROUPS_KEY, LAST_GROUP_ID_KEY,
    LEAGUE_INSTALL_DIR_KEY, config_path, is_safe_group_id,
};
use crate::log::create_private_dir;

/// A lock older than this is a crashed process's; it is broken (`CONFIG_LOCK_STALE_MS`).
pub const CONFIG_LOCK_STALE: Duration = Duration::from_secs(10);
/// Waiting longer than this for a live lock fails the write; a live lock is never taken
/// (`CONFIG_LOCK_WAIT_MS`).
pub const CONFIG_LOCK_WAIT: Duration = Duration::from_secs(5);

/// Why a config write did not happen. Never carries the file's content (it holds tokens).
#[derive(Debug)]
pub enum ConfigWriteError {
    /// `config.json` exists but is not a JSON object; it is left alone rather than overwritten.
    NotAnObject,
    /// Another writer held the lock for longer than the wait.
    Locked,
    /// A value the write was asked to store is not valid (a group id that is not a safe directory name).
    Invalid(&'static str),
    /// A filesystem error.
    Io(io::Error),
}

impl fmt::Display for ConfigWriteError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ConfigWriteError::NotAnObject => {
                write!(f, "config.json is not valid JSON; fix or delete it first")
            }
            ConfigWriteError::Locked => write!(
                f,
                "config.json is being written by another Kustom process; try again in a moment"
            ),
            ConfigWriteError::Invalid(what) => write!(f, "not written: {what}"),
            ConfigWriteError::Io(error) => write!(f, "could not write config.json: {}", error.kind()),
        }
    }
}

impl std::error::Error for ConfigWriteError {}

fn lock_path(dir: &Path) -> PathBuf {
    dir.join(format!("{CONFIG_FILE_NAME}.lock"))
}

/// 24 hex characters that tell this holder from any other (`randomBytes(12)`); not a secret.
fn owner_tag() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let mut out = String::new();
    for salt in 0..2_u64 {
        let mut hasher = RandomState::new().build_hasher();
        hasher.write_u64(salt);
        hasher.write_u32(std::process::id());
        if let Ok(since) = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH) {
            hasher.write_u128(since.as_nanos());
        }
        out.push_str(&format!("{:016x}", hasher.finish()));
    }
    out[..24].to_owned()
}

fn read_small(path: &Path) -> Option<String> {
    let mut text = String::new();
    fs::File::open(path).ok()?.read_to_string(&mut text).ok()?;
    Some(text)
}

fn age(path: &Path) -> Option<Duration> {
    fs::metadata(path)
        .ok()?
        .modified()
        .ok()?
        .elapsed()
        .ok()
        .or(Some(Duration::ZERO))
}

/// `config.json.lock`, held while alive. Released only if it still holds our tag, so a lock somebody else
/// took after ours was broken is never deleted by us.
struct ConfigLock {
    path: PathBuf,
    owner: String,
}

impl ConfigLock {
    fn acquire(dir: &Path, wait: Duration) -> Result<Self, ConfigWriteError> {
        create_private_dir(dir).map_err(ConfigWriteError::Io)?;
        let path = lock_path(dir);
        let owner = owner_tag();
        let started = std::time::Instant::now();
        loop {
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            match options.open(&path) {
                Ok(mut file) => {
                    file.write_all(owner.as_bytes()).map_err(ConfigWriteError::Io)?;
                    return Ok(ConfigLock { path, owner });
                }
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
                // Windows answers a file being deleted right now with access denied: wait like a held lock.
                Err(error) if error.kind() == io::ErrorKind::PermissionDenied => {}
                Err(error) => return Err(ConfigWriteError::Io(error)),
            }
            match age(&path) {
                // Released between the two calls.
                None => continue,
                Some(lock_age) if lock_age > CONFIG_LOCK_STALE => {
                    // Broken by rename, not unlink, so of several waiters only one breaks it.
                    let grave = path.with_extension(format!("lock.stale-{}", &owner_tag()[..12]));
                    if fs::rename(&path, &grave).is_ok() {
                        // The rename took whatever sat at the path at that instant, re-checked now. If it was
                        // a fresh lock a faster waiter had just made, put it back with a hard link, which fails
                        // when the path is taken again (no check-then-act window), then drop the grave name.
                        let fresh = age(&grave).is_some_and(|a| a <= CONFIG_LOCK_STALE);
                        if fresh {
                            let _ = fs::hard_link(&grave, &path);
                        }
                        let _ = fs::remove_file(&grave);
                    }
                    continue;
                }
                Some(_) => {}
            }
            if started.elapsed() > wait {
                return Err(ConfigWriteError::Locked);
            }
            thread::sleep(Duration::from_millis(10));
        }
    }
}

impl Drop for ConfigLock {
    fn drop(&mut self) {
        // Move the lock aside first, then look at what was moved: a lock somebody else took after ours was
        // broken is never deleted by a read-then-unlink race. If it was not ours, it goes back (hard link:
        // only if the path is still free).
        let aside = self
            .path
            .with_extension(format!("lock.release-{}", &owner_tag()[..12]));
        if fs::rename(&self.path, &aside).is_err() {
            return;
        }
        if read_small(&aside).as_deref() != Some(self.owner.as_str()) {
            let _ = fs::hard_link(&aside, &self.path);
        }
        let _ = fs::remove_file(&aside);
    }
}

/// Writes `value` as `config.json` (two-space JSON plus a newline, as `config.ts` writes it): the body goes to
/// `config.json.tmp`, owner-only, and is renamed over the file; a rename Windows refuses for a moment (an
/// antivirus or a reader has the file open) is retried 20 times. Caller holds the lock.
fn write_body(dir: &Path, value: &Map<String, Value>) -> Result<(), ConfigWriteError> {
    let path = config_path(dir);
    let tmp = dir.join(format!("{CONFIG_FILE_NAME}.tmp"));
    protect_root_state(dir, value);
    let mut body =
        serde_json::to_string_pretty(value).map_err(|e| ConfigWriteError::Io(io::Error::other(e)))?;
    body.push('\n');
    let written = (|| -> io::Result<()> {
        let mut options = OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&tmp)?;
        file.write_all(body.as_bytes())?;
        file.sync_all()?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600))?;
        }
        Ok(())
    })();
    if let Err(error) = written {
        let _ = fs::remove_file(&tmp);
        return Err(ConfigWriteError::Io(error));
    }
    let mut attempt = 0;
    loop {
        match fs::rename(&tmp, &path) {
            Ok(()) => return Ok(()),
            Err(error) if error.kind() == io::ErrorKind::PermissionDenied && attempt < 20 => {
                attempt += 1;
                thread::sleep(Duration::from_millis(25));
            }
            Err(error) => {
                let _ = fs::remove_file(&tmp);
                return Err(ConfigWriteError::Io(error));
            }
        }
    }
}

/// Read-modify-write of the raw config object under the lock, keeping every key `mutate` does not touch, in
/// order. A missing file starts from `{}`; a file that is not a JSON object is left alone
/// ([`ConfigWriteError::NotAnObject`]). The read happens inside the lock, so two writers each see the
/// other's finished write.
pub fn update_config(
    dir: &Path,
    mutate: impl FnOnce(&mut Map<String, Value>) -> Result<(), ConfigWriteError>,
) -> Result<(), ConfigWriteError> {
    update_config_with_wait(dir, CONFIG_LOCK_WAIT, mutate)
}

pub(crate) fn update_config_with_wait(
    dir: &Path,
    wait: Duration,
    mutate: impl FnOnce(&mut Map<String, Value>) -> Result<(), ConfigWriteError>,
) -> Result<(), ConfigWriteError> {
    let _lock = ConfigLock::acquire(dir, wait)?;
    let mut raw = match fs::read_to_string(config_path(dir)) {
        Ok(text) => match serde_json::from_str::<Value>(&text) {
            Ok(Value::Object(map)) => map,
            _ => return Err(ConfigWriteError::NotAnObject),
        },
        Err(error) if error.kind() == io::ErrorKind::NotFound => Map::new(),
        Err(_) => return Err(ConfigWriteError::NotAnObject),
    };
    mutate(&mut raw)?;
    write_body(dir, &raw)
}

/// Sets `leagueInstallDir` (M17.5's Browse…), keeping every other key and their order.
pub fn write_league_install_dir(config_dir: &Path, install_dir: &Path) -> Result<(), ConfigWriteError> {
    update_config(config_dir, |raw| {
        raw.insert(
            LEAGUE_INSTALL_DIR_KEY.to_owned(),
            Value::String(install_dir.to_string_lossy().into_owned()),
        );
        Ok(())
    })
}

/// Records the group last used, so the next start opens on it (`setLastGroup`).
pub fn set_last_group(config_dir: &Path, group_id: &str) -> Result<(), ConfigWriteError> {
    if !is_safe_group_id(group_id) && group_id != super::state::LEGACY_GROUP_ID {
        return Err(ConfigWriteError::Invalid("not a group id"));
    }
    update_config(config_dir, |raw| {
        raw.insert(LAST_GROUP_ID_KEY.to_owned(), Value::String(group_id.to_owned()));
        Ok(())
    })
}

/// The group a token is filed under.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GroupRef<'a> {
    /// The server's id.
    pub group_id: &'a str,
    /// Its slug.
    pub slug: &'a str,
    /// Its name.
    pub name: &'a str,
}

/// Files a token under its group (`fileTokenUnderGroup`): the group's entry gets the token (a rotated token
/// replaces the old one) and its name and slug, keeping any other key on the entry; the top-level 0.2.x
/// token goes only if it *is* this one (a different one is another group's token waiting to be filed); the
/// group becomes `lastGroupId` when none is set; `apiBase` is written when the file has none (a first
/// pairing on a fresh install, as `rememberGroup` does). Entries that do not parse stay as they are.
pub fn file_token_under_group(
    config_dir: &Path,
    api_base: &str,
    group: GroupRef<'_>,
    token: &CompanionToken,
) -> Result<(), ConfigWriteError> {
    if !is_safe_group_id(group.group_id) {
        return Err(ConfigWriteError::Invalid("not a group id"));
    }
    update_config(config_dir, |raw| {
        let mut groups = match raw.get(GROUPS_KEY).cloned() {
            Some(Value::Array(items)) => items,
            _ => Vec::new(),
        };
        let at = groups.iter().position(|item| {
            item.as_object()
                .and_then(|o| o.get("groupId"))
                .and_then(Value::as_str)
                == Some(group.group_id)
                && super::parse_group_entry(item).is_some()
        });
        let mut entry = at
            .and_then(|i| groups.get(i))
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        entry.insert("groupId".to_owned(), Value::String(group.group_id.to_owned()));
        entry.insert("slug".to_owned(), Value::String(group.slug.to_owned()));
        entry.insert("name".to_owned(), Value::String(group.name.to_owned()));
        entry.insert(
            COMPANION_TOKEN_KEY.to_owned(),
            Value::String(token.expose().to_owned()),
        );
        match at {
            Some(i) => groups[i] = Value::Object(entry),
            None => groups.push(Value::Object(entry)),
        }
        if raw
            .get(COMPANION_TOKEN_KEY)
            .and_then(Value::as_str)
            .is_some_and(|legacy| {
                legacy == token.expose() || CompanionToken::parse(legacy).as_ref() == Some(token)
            })
        {
            raw.shift_remove(COMPANION_TOKEN_KEY);
        }
        let has_last = raw
            .get(LAST_GROUP_ID_KEY)
            .and_then(Value::as_str)
            .is_some_and(|v| !v.is_empty());
        if !has_last {
            raw.insert(
                LAST_GROUP_ID_KEY.to_owned(),
                Value::String(group.group_id.to_owned()),
            );
        }
        if !raw.contains_key(API_BASE_KEY) {
            raw.insert(API_BASE_KEY.to_owned(), Value::String(api_base.to_owned()));
        }
        raw.insert(GROUPS_KEY.to_owned(), Value::Array(groups));
        Ok(())
    })
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use crate::config::{Config, LoadOutcome, load_config};
    use crate::test_support::TempDir;
    use serde_json::json;

    fn token(n: char) -> CompanionToken {
        CompanionToken::parse(&std::iter::repeat_n(n, 43).collect::<String>()).unwrap()
    }

    fn raw(dir: &Path) -> Value {
        serde_json::from_str(&fs::read_to_string(config_path(dir)).unwrap()).unwrap()
    }

    #[test]
    fn unknown_keys_and_order_survive_a_write() {
        let temp = TempDir::new("config-unknown");
        fs::write(
            config_path(temp.path()),
            r#"{"zFuture":{"a":1},"mode":"overlay","apiBase":"https://kustom.gg","groups":[{"groupId":"g1","slug":"a","name":"A","color":"red"},{"broken":true}],"aFuture":[1,2]}"#,
        )
        .unwrap();
        file_token_under_group(
            temp.path(),
            "http://ignored",
            GroupRef {
                group_id: "g1",
                slug: "a2",
                name: "A2",
            },
            &token('a'),
        )
        .unwrap();
        let text = fs::read_to_string(config_path(temp.path())).unwrap();
        assert!(
            text.ends_with("}\n") && text.contains("\n  \"zFuture\""),
            "{text}"
        );
        let value = raw(temp.path());
        let keys: Vec<&str> = value.as_object().unwrap().keys().map(String::as_str).collect();
        assert_eq!(
            keys,
            ["zFuture", "mode", "apiBase", "groups", "aFuture", "lastGroupId"]
        );
        assert_eq!(value["zFuture"], json!({ "a": 1 }));
        assert_eq!(
            value["mode"], "overlay",
            "mode is never written, and never dropped"
        );
        assert_eq!(value["apiBase"], "https://kustom.gg");
        assert_eq!(value["groups"][0]["color"], "red");
        assert_eq!(value["groups"][0]["name"], "A2");
        assert_eq!(value["groups"][0]["companionToken"], token('a').expose());
        assert_eq!(value["groups"][1], json!({ "broken": true }));
        assert_eq!(value["lastGroupId"], "g1");
    }

    #[test]
    fn the_top_level_token_goes_only_when_it_is_the_one_filed() {
        let temp = TempDir::new("config-file-token");
        fs::write(
            config_path(temp.path()),
            format!(
                r#"{{"apiBase":"https://kustom.gg","companionToken":"{}"}}"#,
                token('b').expose()
            ),
        )
        .unwrap();
        file_token_under_group(
            temp.path(),
            "x",
            GroupRef {
                group_id: "g2",
                slug: "",
                name: "",
            },
            &token('c'),
        )
        .unwrap();
        assert_eq!(raw(temp.path())["companionToken"], token('b').expose());
        file_token_under_group(
            temp.path(),
            "x",
            GroupRef {
                group_id: "g1",
                slug: "",
                name: "",
            },
            &token('b'),
        )
        .unwrap();
        let value = raw(temp.path());
        assert!(value.get("companionToken").is_none());
        assert_eq!(value["lastGroupId"], "g2", "an existing lastGroupId is kept");
        let LoadOutcome::Loaded(config) = load_config(temp.path()) else {
            panic!()
        };
        assert_eq!(config.groups.len(), 2);
        assert_eq!(Config::from_raw(value.as_object().unwrap()), config);
    }

    #[test]
    fn a_broken_file_is_never_overwritten() {
        let temp = TempDir::new("config-broken");
        fs::write(config_path(temp.path()), "{ not json").unwrap();
        let error = set_last_group(temp.path(), "g1").unwrap_err();
        assert!(matches!(error, ConfigWriteError::NotAnObject));
        assert_eq!(
            fs::read_to_string(config_path(temp.path())).unwrap(),
            "{ not json"
        );
    }

    #[test]
    fn writes_a_fresh_file_with_the_install_dir() {
        let temp = TempDir::new("config-install-dir");
        let dir = temp.path().join("nested");
        write_league_install_dir(&dir, Path::new("D:\\Riot Games\\League of Legends")).unwrap();
        assert_eq!(
            raw(&dir),
            json!({ "leagueInstallDir": "D:\\Riot Games\\League of Legends" })
        );
        assert!(!lock_path(&dir).exists());
        assert!(!dir.join("config.json.tmp").exists());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(config_path(&dir)).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
    }

    #[test]
    fn a_live_lock_is_waited_for_and_never_taken() {
        let temp = TempDir::new("config-live-lock");
        fs::write(lock_path(temp.path()), "someone-else").unwrap();
        let error = update_config_with_wait(temp.path(), Duration::from_millis(50), |_| Ok(())).unwrap_err();
        assert!(matches!(error, ConfigWriteError::Locked));
        assert_eq!(
            fs::read_to_string(lock_path(temp.path())).unwrap(),
            "someone-else"
        );
    }

    #[test]
    fn a_stale_lock_is_broken() {
        let temp = TempDir::new("config-stale-lock");
        let lock = lock_path(temp.path());
        fs::write(&lock, "crashed").unwrap();
        let old = SystemTime::now() - Duration::from_secs(60);
        fs::File::options()
            .write(true)
            .open(&lock)
            .unwrap()
            .set_modified(old)
            .unwrap();
        set_last_group(temp.path(), "g1").unwrap();
        assert_eq!(raw(temp.path()), json!({ "lastGroupId": "g1" }));
        assert!(!lock.exists());
    }

    #[test]
    fn a_fresh_lock_caught_by_a_break_is_put_back_and_never_overwritten() {
        let temp = TempDir::new("config-put-back");
        let lock = lock_path(temp.path());
        // A stale lock whose break races a waiter that already made a fresh one: the fresh one survives.
        fs::write(&lock, "fresh-holder").unwrap();
        let grave = lock.with_extension("lock.stale-test");
        fs::rename(&lock, &grave).unwrap();
        fs::write(&lock, "another-new-holder").unwrap();
        // hard_link refuses a taken path.
        assert!(fs::hard_link(&grave, &lock).is_err());
        assert_eq!(fs::read_to_string(&lock).unwrap(), "another-new-holder");
    }

    #[test]
    fn release_leaves_a_lock_that_is_not_ours() {
        let temp = TempDir::new("config-release");
        let held = ConfigLock::acquire(temp.path(), Duration::from_millis(50)).unwrap();
        // Somebody broke ours and took the lock.
        fs::write(&held.path, "someone-else").unwrap();
        drop(held);
        assert_eq!(
            fs::read_to_string(lock_path(temp.path())).unwrap(),
            "someone-else"
        );
        let leftovers: Vec<_> = fs::read_dir(temp.path())
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(leftovers.len(), 1, "{leftovers:?}");
    }

    #[test]
    fn concurrent_writers_take_turns() {
        let temp = TempDir::new("config-concurrent");
        let dir = temp.path().to_path_buf();
        let handles: Vec<_> = (0..8)
            .map(|i| {
                let dir = dir.clone();
                thread::spawn(move || {
                    update_config(&dir, |raw| {
                        raw.insert(format!("k{i}"), Value::from(i));
                        Ok(())
                    })
                    .unwrap();
                })
            })
            .collect();
        for handle in handles {
            handle.join().unwrap();
        }
        assert_eq!(raw(&dir).as_object().unwrap().len(), 8);
    }

    #[test]
    fn a_path_like_group_id_is_refused() {
        let temp = TempDir::new("config-bad-id");
        assert!(matches!(
            file_token_under_group(
                temp.path(),
                "x",
                GroupRef {
                    group_id: "../x",
                    slug: "",
                    name: ""
                },
                &token('d')
            ),
            Err(ConfigWriteError::Invalid(_))
        ));
        assert!(!config_path(temp.path()).exists());
    }
}
