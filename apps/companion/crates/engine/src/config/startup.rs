//! What happens on every start before any watcher runs (M17 "First start after 0.3.x", parity rows 4, 7,
//! 21; `main.ts` and `groups.ts` `resolveTopLevelToken`):
//!
//! 1. Read `config.json` (every shape; an unreadable file is left alone and the app opens on Link).
//! 2. The old-engine check: an old Kustom still running means **nothing else happens** (no `/me`, no
//!    write, no watcher) until Retry.
//! 3. A top-level 0.2.x/0.3.x token is filed under the group `GET /api/companion/me` names (that answer's
//!    `group` only; the `GET /api/overlay/groups` fallback is gone, row 4). The root state moves with it
//!    when the group had no token before. Offline, refused, or no `group`: the token stays where it is and
//!    keeps posting from the root state, unlabelled.
//! 4. The session's group: `lastGroupId` if it has a token, else the first with one; none means Link.
//! 5. `/me` with that group's token (reusing step 3's answer when it was the same token).
//!
//! [`boot`] runs it and returns everything the window and the watchers need; it never fails and never
//! panics. Retry (old engine) is calling it again.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::SystemTime;

use super::state::{GroupView, adopt_legacy_state, host_groups, host_state_dir_for, select_group};
use super::write::{GroupRef, file_token_under_group};
use super::{Config, LoadOutcome, OldEngineCheck, ProcessProbe, check_old_engine, load_config};
use crate::api::identity::{IdentityOutcome, announce_identity, check_identity};
use crate::api::transport::Transport;
use crate::api::wire::GroupSummary;
use crate::api::{ApiClient, ApiClientOptions};

/// What [`boot`] needs from the outside.
pub struct BootDeps {
    /// The HTTP transport for `/me`.
    pub transport: Arc<dyn Transport>,
    /// The process list for the old-engine check.
    pub probe: Arc<dyn ProcessProbe>,
    /// Now.
    pub now: SystemTime,
    /// The app's version, for the `User-Agent`.
    pub version: String,
}

/// Where a start ended up.
#[derive(Debug, Clone, PartialEq, Eq)]
#[allow(clippy::large_enum_variant)] // built once per start
pub enum BootState {
    /// `config.json` exists but cannot be used; it was not touched. The window opens on Link.
    ConfigUnreadable {
        /// For the log.
        reason: String,
    },
    /// An old Kustom is running: show the sentence and Retry; start nothing.
    OldEngineRunning {
        /// For the log.
        evidence: String,
    },
    /// No group with a token: the window opens on Link.
    NeedsLink,
    /// A group to run on.
    Ready {
        /// The session's group.
        group: GroupView,
        /// Its state directory.
        state_dir: PathBuf,
        /// What `/me` said for its token. `Refused` means Link with the server's sentence.
        identity: IdentityOutcome,
    },
}

/// Everything [`boot`] found.
#[derive(Debug, Clone)]
pub struct Boot {
    /// The config, as read after any filing (empty for a missing or unreadable file).
    pub config: Config,
    /// Every group this PC can host for (for Switch group).
    pub groups: Vec<GroupView>,
    /// The group the top-level token was filed under on this start, if it was.
    pub filed: Option<GroupSummary>,
    /// The outcome.
    pub state: BootState,
}

fn client(config: &Config, view_token: &super::CompanionToken, deps: &BootDeps) -> ApiClient {
    let mut options = ApiClientOptions::new(
        config.api_base.clone(),
        Some(view_token.clone()),
        deps.transport.clone(),
    );
    options.version = deps.version.clone();
    ApiClient::new(options)
}

/// Files the top-level token under its `/me` group. Returns the group and the `/me` answer.
async fn file_top_level_token(
    config_dir: &Path,
    config: &Config,
    deps: &BootDeps,
) -> (Option<GroupSummary>, Option<IdentityOutcome>) {
    let Some(token) = &config.top_level_token else {
        return (None, None);
    };
    let identity = check_identity(&client(config, token, deps)).await;
    let group = match &identity {
        IdentityOutcome::Ok {
            group: Some(group), ..
        } => group.clone(),
        IdentityOutcome::Ok { group: None, .. } => {
            tracing::info!(
                component = "groups",
                "the saved token has no known group yet; it keeps working unlabelled"
            );
            return (None, Some(identity));
        }
        _ => return (None, Some(identity)),
    };
    let had_token = config
        .groups
        .iter()
        .any(|entry| entry.group_id == group.id && entry.token.is_some());
    let dir = config_dir.to_path_buf();
    let api_base = config.api_base.clone();
    let filed_group = group.clone();
    let filed_token = token.clone();
    let written = tokio::task::spawn_blocking(move || {
        let result = file_token_under_group(
            &dir,
            &api_base,
            GroupRef {
                group_id: &filed_group.id,
                slug: &filed_group.slug,
                name: &filed_group.name,
            },
            &filed_token,
        );
        // Only the first token a group ever had inherits the old root state; a rotation keeps its own.
        let moved = if result.is_ok() && !had_token {
            adopt_legacy_state(&dir, &filed_group.id, Some(&filed_token))
        } else {
            Vec::new()
        };
        (result, moved)
    })
    .await;
    match written {
        Ok((Ok(()), moved)) => {
            tracing::info!(
                component = "groups",
                groupId = %group.id,
                slug = %group.slug,
                moved = moved.join(","),
                "the saved token is filed under its group"
            );
            (Some(group), Some(identity))
        }
        Ok((Err(error), _)) => {
            tracing::warn!(component = "groups", error = %error, "could not file the saved token under its group; it keeps working unlabelled");
            (None, Some(identity))
        }
        Err(error) => {
            tracing::error!(component = "groups", error = %error, "filing the saved token stopped unexpectedly");
            (None, Some(identity))
        }
    }
}

/// Runs a start (see the module docs).
pub async fn boot(config_dir: &Path, deps: &BootDeps) -> Boot {
    let config = match load_config(config_dir) {
        LoadOutcome::Unreadable { reason } => {
            return Boot {
                config: Config::from_raw(&serde_json::Map::new()),
                groups: Vec::new(),
                filed: None,
                state: BootState::ConfigUnreadable { reason },
            };
        }
        outcome => outcome
            .config()
            .unwrap_or_else(|| Config::from_raw(&serde_json::Map::new())),
    };

    if let OldEngineCheck::Running { evidence } = check_old_engine(config_dir, deps.now, deps.probe.as_ref())
    {
        tracing::warn!(component = "startup", evidence = %evidence, "the old Kustom is still running; no watchers start");
        let groups = host_groups(&config);
        return Boot {
            config,
            groups,
            filed: None,
            state: BootState::OldEngineRunning { evidence },
        };
    }

    let legacy_token = config.top_level_token.clone();
    let (filed, legacy_identity) = file_top_level_token(config_dir, &config, deps).await;
    let config = if filed.is_some() {
        load_config(config_dir).config().unwrap_or(config)
    } else {
        config
    };

    let groups = host_groups(&config);
    let Some(group) = select_group(&groups, config.last_group_id.as_deref()).cloned() else {
        tracing::info!(
            component = "startup",
            "no group with a host token; opening on Link"
        );
        return Boot {
            config,
            groups,
            filed,
            state: BootState::NeedsLink,
        };
    };
    let state_dir = {
        let dir = config_dir.to_path_buf();
        let view = group.clone();
        tokio::task::spawn_blocking(move || host_state_dir_for(&dir, &view))
            .await
            .unwrap_or_else(|_| super::state::host_state_dir(config_dir, &group.group_id))
    };
    let same_token = legacy_token.as_ref() == Some(&group.token);
    let identity = match legacy_identity {
        Some(identity) if same_token => identity,
        _ => check_identity(&client(&config, &group.token, deps)).await,
    };
    announce_identity(&identity);
    tracing::info!(component = "startup", groupId = %group.group_id, slug = %group.slug, "posting tonight to a group");
    Boot {
        config,
        groups,
        filed,
        state: BootState::Ready {
            group,
            state_dir,
            identity,
        },
    }
}
