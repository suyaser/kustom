//! "Saying who you are, on every start" (parity row 7, `identity.ts`): one `GET /api/companion/me` with the
//! session's token. Its answer feeds the window's group and name; a 401/403 is the server's sentence and
//! the Link screen, never a crash; anything else is "the API is not answering yet" and the session carries
//! on (the queue still has work). One attempt; never blocks a watcher.

use super::wire::GroupSummary;
use super::{ApiClient, ApiFailure};

/// What `/me` said.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IdentityOutcome {
    /// The token is good.
    Ok {
        /// The token's player.
        puuid: String,
        /// `players.id`.
        player_id: String,
        /// `players.display_name`.
        display_name: Option<String>,
        /// The token's group, when the server says.
        group: Option<GroupSummary>,
    },
    /// The API answered 401 or 403 to this token.
    Refused {
        /// 401 or 403.
        status: u16,
        /// The server's sentence (what the window shows).
        error: String,
    },
    /// No usable answer: network, 5xx, another status (a 404 is a wrong `apiBase`, not a bad token), a
    /// body that did not parse.
    Unavailable {
        /// Why, in a few words.
        reason: String,
    },
}

/// One `GET /api/companion/me`.
pub async fn check_identity(api: &ApiClient) -> IdentityOutcome {
    match api.me().await {
        Ok(ok) => IdentityOutcome::Ok {
            puuid: ok.data.puuid,
            player_id: ok.data.player_id,
            display_name: ok.data.display_name,
            group: ok.data.group,
        },
        Err(ApiFailure::Http {
            status: status @ (401 | 403),
            error,
            ..
        }) => IdentityOutcome::Refused { status, error },
        Err(failure) => IdentityOutcome::Unavailable {
            reason: failure.describe(),
        },
    }
}

/// The one log line for each outcome (`announceIdentity`).
pub fn announce_identity(outcome: &IdentityOutcome) {
    match outcome {
        IdentityOutcome::Ok {
            puuid,
            player_id,
            display_name,
            group,
        } => {
            let who = display_name
                .clone()
                .unwrap_or_else(|| format!("player {puuid} (no display name yet)"));
            tracing::info!(
                component = "identity",
                puuid = %puuid,
                playerId = %player_id,
                groupId = group.as_ref().map(|g| g.id.as_str()),
                "signed in as {who}"
            );
        }
        IdentityOutcome::Refused { status, error } => {
            tracing::error!(component = "identity", status, error = %error, "the API refused this companion token");
        }
        IdentityOutcome::Unavailable { reason } => {
            tracing::warn!(
                component = "identity",
                reason = %reason,
                "the API is not answering yet; it will be retried with every post"
            );
        }
    }
}
