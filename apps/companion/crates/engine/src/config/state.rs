//! The groups a host can post to, which one a session runs on, and where each group's state lives
//! (`groups.ts`: `groupViews`, `selectGroup`, `hostStateDir`, `legacyStateDir`, `adoptLegacyState`; the
//! root-state owner of `config.ts`; decision row 2026-10-03, M14.13).
//!
//! **One token per group, one group per session.** Each group posts from its own directory
//! `groups/<groupId>/` (queue, `backfill.json`, `commands-done.json`, `last-posted.json`), so a block
//! queued for one group can only be replayed with that group's token.
//!
//! **The 0.2.x/0.3.x top-level token** is a group of its own ([`LEGACY_GROUP_ID`]) until `/me` names its
//! group. Its state is the config root's `queue/`, `backfill.json` and `commands-done.json`, which belong
//! to the first top-level token that used them, recorded as a fingerprint in `legacy-state-owner`; any
//! other unfiled token gets `groups/legacy-<fingerprint>/`. When the token is filed, the root state moves
//! into its group's directory ([`adopt_legacy_state`]), unless the root belongs to another token.
//!
//! Groups without a token (0.3.x Overlay pairings) are not views: they cannot host (parity row 4).

use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::{COMPANION_TOKEN_KEY, CompanionToken, Config, config_path, fingerprint_of};
use crate::api::wire::Side;
use crate::log::create_private_dir;

/// The runtime id of a top-level token whose group is not known yet. Never written, never sent.
pub const LEGACY_GROUP_ID: &str = "legacy-token";
/// What that group is called until the server says.
pub const LEGACY_GROUP_NAME: &str = "Your group";
/// The root state's owner record.
pub const STATE_OWNER_FILE: &str = "legacy-state-owner";
/// What moves from the root into a group's directory when a legacy token is filed.
pub const ROOT_STATE_NAMES: [&str; 3] = ["queue", "backfill.json", "commands-done.json"];
/// The directory under the config root holding every group's state.
pub const GROUPS_DIR_NAME: &str = "groups";
/// Home's Last game (decision row 2026-10-04): `groups/<groupId>/last-posted.json`.
pub const LAST_POSTED_FILE: &str = "last-posted.json";

/// A group this PC can host for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GroupView {
    /// The server's id, or [`LEGACY_GROUP_ID`].
    pub group_id: String,
    /// The slug (`""` for the legacy group).
    pub slug: String,
    /// The name.
    pub name: String,
    /// The group's token.
    pub token: CompanionToken,
}

impl GroupView {
    /// The unfiled top-level token's group.
    pub fn is_legacy(&self) -> bool {
        self.group_id == LEGACY_GROUP_ID
    }
}

/// The groups as the host uses them (`groupViews`, host half): every group with a token, then (first) the
/// top-level token as a group of its own if no group carries it.
pub fn host_groups(config: &Config) -> Vec<GroupView> {
    let mut views: Vec<GroupView> = config
        .groups
        .iter()
        .filter_map(|group| {
            Some(GroupView {
                group_id: group.group_id.clone(),
                slug: group.slug.clone(),
                name: group.name.clone(),
                token: group.token.clone()?,
            })
        })
        .collect();
    if let Some(token) = &config.top_level_token
        && !views.iter().any(|view| &view.token == token)
    {
        views.insert(
            0,
            GroupView {
                group_id: LEGACY_GROUP_ID.to_owned(),
                slug: String::new(),
                name: LEGACY_GROUP_NAME.to_owned(),
                token: token.clone(),
            },
        );
    }
    views
}

/// The group a session runs on (`selectGroup`, host): `lastGroupId` if it still has a token, else the
/// first; `None` when no group has a token (the window shows Link).
pub fn select_group<'a>(views: &'a [GroupView], last_group_id: Option<&str>) -> Option<&'a GroupView> {
    views
        .iter()
        .find(|view| Some(view.group_id.as_str()) == last_group_id)
        .or_else(|| views.first())
}

/// Where a group's state lives (`hostStateDir`): the root for the legacy group, else `groups/<groupId>`.
pub fn host_state_dir(config_dir: &Path, group_id: &str) -> PathBuf {
    if group_id == LEGACY_GROUP_ID {
        config_dir.to_path_buf()
    } else {
        config_dir.join(GROUPS_DIR_NAME).join(group_id)
    }
}

/// The root state's owner fingerprint, if recorded.
pub fn read_state_owner(config_dir: &Path) -> Option<String> {
    let text = fs::read_to_string(config_dir.join(STATE_OWNER_FILE)).ok()?;
    let owner = text.trim();
    (!owner.is_empty()).then(|| owner.to_owned())
}

/// Records who owns the root's queue, backfill and executed state, once (create-new; never replaced).
/// Never fails: an unrecorded owner is asked again on the next start.
pub fn record_state_owner(config_dir: &Path, token: &str) {
    if read_state_owner(config_dir).is_some() || create_private_dir(config_dir).is_err() {
        return;
    }
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    if let Ok(mut file) = options.open(config_dir.join(STATE_OWNER_FILE)) {
        let _ = writeln!(file, "{}", fingerprint_of(token));
    }
}

/// The state directory for an unfiled top-level token (`legacyStateDir`): the root if it is (or becomes)
/// the root's owner, else `groups/legacy-<fingerprint>`, so a block queued under another token is never
/// replayed under this one.
pub fn legacy_state_dir(config_dir: &Path, token: &CompanionToken) -> PathBuf {
    match read_state_owner(config_dir) {
        None => {
            record_state_owner(config_dir, token.expose());
            config_dir.to_path_buf()
        }
        Some(owner) if owner == token.fingerprint() => config_dir.to_path_buf(),
        Some(_) => config_dir
            .join(GROUPS_DIR_NAME)
            .join(format!("legacy-{}", token.fingerprint())),
    }
}

/// [`host_state_dir`] for a view: an unfiled token goes through [`legacy_state_dir`].
pub fn host_state_dir_for(config_dir: &Path, view: &GroupView) -> PathBuf {
    if view.is_legacy() {
        legacy_state_dir(config_dir, &view.token)
    } else {
        host_state_dir(config_dir, &view.group_id)
    }
}

/// A legacy token just got its group: its root queue, backfill cache and executed record move into the
/// group's directory (`adoptLegacyState`). Skips anything already there; with `token`, does nothing when
/// the root belongs to a different token. Never fails; returns what moved (each failure is a log line).
pub fn adopt_legacy_state(
    config_dir: &Path,
    group_id: &str,
    token: Option<&CompanionToken>,
) -> Vec<&'static str> {
    let mut moved = Vec::new();
    if let (Some(token), Some(owner)) = (token, read_state_owner(config_dir))
        && owner != token.fingerprint()
    {
        return moved;
    }
    let to = host_state_dir(config_dir, group_id);
    for name in ROOT_STATE_NAMES {
        let source = config_dir.join(name);
        let target = to.join(name);
        if !source.exists() || target.exists() {
            continue;
        }
        match create_private_dir(&to).and_then(|()| fs::rename(&source, &target)) {
            Ok(()) => moved.push(name),
            Err(error) => {
                tracing::warn!(name, error = %error, "could not move legacy state into the group directory");
            }
        }
    }
    moved
}

/// The upgrade gap (`protectRootState`): a 0.2.x/0.3.0 PC has root state captured under its top-level token
/// and no owner record yet. Before a write replaces that token with a different one (or removes it), the
/// outgoing token is recorded as the owner, so a new token can never claim the old token's queue. Called by
/// every config write, inside the lock.
pub(crate) fn protect_root_state(config_dir: &Path, next: &Map<String, Value>) {
    if read_state_owner(config_dir).is_some() {
        return;
    }
    if !ROOT_STATE_NAMES.iter().any(|name| config_dir.join(name).exists()) {
        return;
    }
    let Ok(text) = fs::read_to_string(config_path(config_dir)) else {
        return;
    };
    let Ok(Value::Object(current)) = serde_json::from_str::<Value>(&text) else {
        return;
    };
    let Some(outgoing) = current.get(COMPANION_TOKEN_KEY).and_then(Value::as_str) else {
        return;
    };
    if outgoing.is_empty() {
        return;
    }
    if next.get(COMPANION_TOKEN_KEY).and_then(Value::as_str) != Some(outgoing) {
        record_state_owner(config_dir, outgoing);
    }
}

/// Home's Last game, kept across restarts (decision row 2026-10-04; written by M17.8/M17.9 after a 2xx on
/// an end-of-game post). Additive: 0.3.x never reads it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LastPosted {
    /// When the game was recorded, ISO 8601.
    pub at: String,
    /// The winning side.
    pub winning_side: Side,
    /// The game's length in seconds.
    pub duration_s: u64,
}

/// `<state dir>/last-posted.json`. A missing or malformed file is `None` (Home reads `No game recorded
/// yet`), never an error.
pub fn read_last_posted(state_dir: &Path) -> Option<LastPosted> {
    let text = fs::read_to_string(state_dir.join(LAST_POSTED_FILE)).ok()?;
    match serde_json::from_str(&text) {
        Ok(value) => Some(value),
        Err(error) => {
            tracing::warn!(error = %error, "last-posted.json does not parse; ignored");
            None
        }
    }
}

/// Writes `<state dir>/last-posted.json` atomically (tmp + rename, owner-only). A failure is a log line.
pub fn write_last_posted(state_dir: &Path, value: &LastPosted) -> bool {
    let path = state_dir.join(LAST_POSTED_FILE);
    let tmp = state_dir.join(format!("{LAST_POSTED_FILE}.tmp"));
    let result = (|| -> std::io::Result<()> {
        create_private_dir(state_dir)?;
        let mut body = serde_json::to_string_pretty(value).map_err(std::io::Error::other)?;
        body.push('\n');
        let mut options = fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        options.open(&tmp)?.write_all(body.as_bytes())?;
        fs::rename(&tmp, &path)
    })();
    if let Err(error) = result {
        let _ = fs::remove_file(&tmp);
        tracing::warn!(error = %error, "could not write last-posted.json");
        return false;
    }
    true
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use crate::config::GroupEntry;
    use crate::test_support::TempDir;

    fn token(n: char) -> CompanionToken {
        CompanionToken::parse(&std::iter::repeat_n(n, 43).collect::<String>()).unwrap()
    }

    fn config(top: Option<CompanionToken>, groups: Vec<GroupEntry>) -> Config {
        let mut config = Config::from_raw(&Map::new());
        config.top_level_token = top;
        config.groups = groups;
        config
    }

    fn group(id: &str, t: Option<CompanionToken>) -> GroupEntry {
        GroupEntry {
            group_id: id.into(),
            slug: id.into(),
            name: id.to_uppercase(),
            token: t,
        }
    }

    #[test]
    fn views_skip_tokenless_groups_and_lead_with_an_unfiled_token() {
        let views = host_groups(&config(
            Some(token('t')),
            vec![group("overlay-only", None), group("g1", Some(token('a')))],
        ));
        let ids: Vec<&str> = views.iter().map(|v| v.group_id.as_str()).collect();
        assert_eq!(ids, [LEGACY_GROUP_ID, "g1"]);
        // Filed already: no legacy view.
        let views = host_groups(&config(Some(token('a')), vec![group("g1", Some(token('a')))]));
        assert_eq!(views.len(), 1);
        // Overlay-only PC: nothing to host.
        assert!(host_groups(&config(None, vec![group("g1", None)])).is_empty());
    }

    #[test]
    fn selection_prefers_the_last_group_with_a_token() {
        let views = host_groups(&config(
            None,
            vec![group("g1", Some(token('a'))), group("g2", Some(token('b')))],
        ));
        assert_eq!(select_group(&views, Some("g2")).unwrap().group_id, "g2");
        assert_eq!(select_group(&views, Some("gone")).unwrap().group_id, "g1");
        assert_eq!(select_group(&[], Some("g1")), None);
    }

    #[test]
    fn the_root_belongs_to_its_first_token() {
        let temp = TempDir::new("state-owner");
        let dir = temp.path();
        assert_eq!(legacy_state_dir(dir, &token('a')), dir);
        assert_eq!(read_state_owner(dir), Some(token('a').fingerprint()));
        assert_eq!(legacy_state_dir(dir, &token('a')), dir);
        assert_eq!(
            legacy_state_dir(dir, &token('b')),
            dir.join("groups")
                .join(format!("legacy-{}", token('b').fingerprint()))
        );
    }

    #[test]
    fn adoption_moves_the_root_state_once_and_only_for_its_owner() {
        let temp = TempDir::new("state-adopt");
        let dir = temp.path();
        fs::create_dir_all(dir.join("queue")).unwrap();
        fs::write(dir.join("queue").join("1.json"), "{}").unwrap();
        fs::write(dir.join("backfill.json"), "{}").unwrap();
        record_state_owner(dir, token('a').expose());
        assert!(adopt_legacy_state(dir, "g1", Some(&token('b'))).is_empty());
        assert_eq!(
            adopt_legacy_state(dir, "g1", Some(&token('a'))),
            ["queue", "backfill.json"]
        );
        assert!(dir.join("groups/g1/queue/1.json").exists());
        assert!(!dir.join("queue").exists());
    }

    #[test]
    fn replacing_the_top_level_token_records_the_outgoing_owner() {
        let temp = TempDir::new("state-protect");
        let dir = temp.path();
        fs::write(dir.join("commands-done.json"), "{}").unwrap();
        fs::write(
            config_path(dir),
            format!(r#"{{"companionToken":"{}"}}"#, token('a').expose()),
        )
        .unwrap();
        let mut next = Map::new();
        next.insert(
            COMPANION_TOKEN_KEY.into(),
            Value::String(token('b').expose().into()),
        );
        protect_root_state(dir, &next);
        assert_eq!(read_state_owner(dir), Some(token('a').fingerprint()));
    }

    #[test]
    fn last_posted_round_trips_and_a_bad_file_is_none() {
        let temp = TempDir::new("state-last-posted");
        let dir = temp.path().join("groups").join("g1");
        assert_eq!(read_last_posted(&dir), None);
        let value = LastPosted {
            at: "2026-10-04T21:10:00.000Z".into(),
            winning_side: Side::Red,
            duration_s: 1_834,
        };
        assert!(write_last_posted(&dir, &value));
        assert_eq!(read_last_posted(&dir), Some(value));
        assert_eq!(
            fs::read_to_string(dir.join(LAST_POSTED_FILE)).unwrap(),
            "{\n  \"at\": \"2026-10-04T21:10:00.000Z\",\n  \"winningSide\": 200,\n  \"durationS\": 1834\n}\n"
        );
        fs::write(dir.join(LAST_POSTED_FILE), "{\"at\":1}").unwrap();
        assert_eq!(read_last_posted(&dir), None);
    }
}
