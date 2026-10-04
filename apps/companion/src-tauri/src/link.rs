//! Link (parity row 6, 05-design §9.4): the six-character code plus the PUUID League says is signed in,
//! sent to `POST /api/companion/pair` with `mode: 'host'` through the engine's API client.
//!
//! - A token comes back (an admin's code): it is saved under its group (`file_token_under_group`, atomic,
//!   locked, every other key kept) and the group becomes the current one through the guarded switch.
//! - `hostRefusal` comes back (a member's code): its sentence is shown and **nothing is saved**; the person
//!   is linked and joined on the server, and this app only hosts.
//! - A refusal (404, 409, 410, 429 ...) shows the server's sentence verbatim.
//!
//! One attempt, never retried: a code is single use, so a retry after a lost answer would read "ran out"
//! for a pairing that worked.

use std::path::Path;
use std::sync::Arc;

use engine::api::transport::Transport;
use engine::api::wire::{GroupSummary, PairMode, PairRequest};
use engine::api::{ApiClient, ApiClientOptions, ApiFailure};
use engine::config::{CompanionToken, GroupRef, file_token_under_group};

use crate::copy;

/// The code alphabet (`PAIRING_CODE_ALPHABET` in `packages/db`): no `O`, `0`, `I` or `1`.
pub const CODE_ALPHABET: &str = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/// The code's length.
pub const CODE_LENGTH: usize = 6;
/// Characters the alphabet leaves out on purpose (L5's sentence names them).
const LOOK_ALIKES: [char; 4] = ['O', '0', 'I', '1'];

/// The field after clean-up: upper case, spaces and dashes stripped, at most six characters.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CleanCode {
    /// What the field shows.
    pub code: String,
    /// A look-alike was typed (L5); it is dropped from `code`.
    pub look_alike: bool,
}

/// Cleans what the person typed or pasted (`k7m-q2x` works). Characters outside the alphabet are dropped;
/// `O`, `0`, `I` and `1` also raise L5. `maxlength` applies after the clean-up.
pub fn clean_code(raw: &str) -> CleanCode {
    let mut code = String::new();
    let mut look_alike = false;
    for ch in raw.chars().flat_map(char::to_uppercase) {
        if LOOK_ALIKES.contains(&ch) {
            look_alike = true;
            continue;
        }
        if CODE_ALPHABET.contains(ch) && code.chars().count() < CODE_LENGTH {
            code.push(ch);
        }
    }
    CleanCode { code, look_alike }
}

/// What the slot says after Link was pressed (L4, L6, L7, L8, L8b, and a save failure).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LinkAnswer {
    /// L4.
    TooShort,
    /// L5 (as typed).
    LookAlike,
    /// L6: the server's sentence, verbatim.
    Refused(String),
    /// L7: the server's `hostRefusal`, verbatim; nothing saved.
    Member(String),
    /// L8, no answer.
    Network,
    /// L8, 5xx or unreadable.
    Server,
    /// L8b.
    LeagueGone,
    /// The token came back but could not be written.
    SaveFailed,
    /// L9: the server's 401 sentence for the current group's token, shown first on "Link this PC again".
    TokenRefused(String),
}

impl LinkAnswer {
    /// The slot's lines.
    pub fn lines(&self) -> Vec<String> {
        match self {
            LinkAnswer::TooShort => vec![copy::LINK_TOO_SHORT.to_owned()],
            LinkAnswer::LookAlike => vec![copy::LINK_BAD_CHARACTER.to_owned()],
            LinkAnswer::Refused(sentence) | LinkAnswer::TokenRefused(sentence) => vec![sentence.clone()],
            LinkAnswer::Member(sentence) => vec![sentence.clone(), copy::LINK_MEMBER_AFTER.to_owned()],
            LinkAnswer::Network => vec![copy::LINK_NETWORK.to_owned()],
            LinkAnswer::Server => vec![copy::LINK_SERVER.to_owned()],
            LinkAnswer::LeagueGone => vec![copy::LINK_LEAGUE_GONE.to_owned()],
            LinkAnswer::SaveFailed => vec![copy::LINK_SAVE_FAILED.to_owned()],
        }
    }

    /// `alert` for refusals and errors, `status` for a member's code and inline help (9.4).
    pub fn role(&self) -> SlotRole {
        match self {
            LinkAnswer::Member(_) | LinkAnswer::TooShort | LinkAnswer::LookAlike => SlotRole::Status,
            _ => SlotRole::Alert,
        }
    }

    /// What the field does when this answer arrives: L6 keeps the code selected so a retype replaces it,
    /// L7 clears it, L8c clears and focuses it.
    pub fn field_action(&self) -> FieldAction {
        match self {
            LinkAnswer::Refused(_) => FieldAction::Select,
            LinkAnswer::Member(_) => FieldAction::Clear,
            LinkAnswer::SaveFailed => FieldAction::ClearAndFocus,
            _ => FieldAction::None,
        }
    }
}

/// How a slot is announced.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SlotRole {
    /// Plain text (help).
    None,
    /// `role="status"`.
    Status,
    /// `role="alert"`.
    Alert,
}

/// What the field does with a new answer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FieldAction {
    /// Nothing.
    None,
    /// Select the code.
    Select,
    /// Empty the field.
    Clear,
    /// Empty the field and focus it (L8c: the code is spent).
    ClearAndFocus,
}

/// How a pair call ended, before anything is saved.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PairStep {
    /// An admin's code: a host token for `group`.
    Token {
        /// The group.
        group: GroupSummary,
        /// The token (redacted in `Debug`, registered as a log secret when it was parsed).
        token: CompanionToken,
    },
    /// Anything else: the slot's answer.
    Answer(LinkAnswer),
}

/// Maps the pair route's outcome to the next step (pure; the tests feed it every case).
pub fn pair_step(
    result: Result<engine::api::ApiOk<engine::api::wire::PairResponse>, ApiFailure>,
) -> PairStep {
    match result {
        Ok(ok) => {
            let data = ok.data;
            if let Some(token) = data.companion_token {
                PairStep::Token {
                    group: data.group,
                    token,
                }
            } else if let Some(refusal) = data.host_refusal {
                PairStep::Answer(LinkAnswer::Member(refusal))
            } else {
                // A host-mode request answered with neither: an old server. Nothing to save.
                tracing::warn!(
                    component = "pairing",
                    "the pair answer had no token and no refusal"
                );
                PairStep::Answer(LinkAnswer::Server)
            }
        }
        Err(ApiFailure::Http { status, error, .. }) => {
            // The envelope's sentence, verbatim, for every 4xx that carried one. A bare `HTTP <n>` (no
            // envelope) and any 5xx are "couldn't link just now".
            let bare = error
                .strip_prefix("HTTP ")
                .is_some_and(|rest| rest.parse::<u16>().is_ok());
            if status >= 500 || bare || error.trim().is_empty() {
                PairStep::Answer(LinkAnswer::Server)
            } else {
                tracing::info!(component = "pairing", status, "pairing refused");
                PairStep::Answer(LinkAnswer::Refused(error))
            }
        }
        Err(ApiFailure::Network { .. }) => PairStep::Answer(LinkAnswer::Network),
        Err(ApiFailure::Malformed { .. } | ApiFailure::Schema { .. }) => PairStep::Answer(LinkAnswer::Server),
    }
}

/// Checks the code before any request (L4). `Err` is the slot's answer.
pub fn code_for_request(raw: &str) -> Result<String, LinkAnswer> {
    let clean = clean_code(raw);
    if clean.code.chars().count() != CODE_LENGTH {
        return Err(LinkAnswer::TooShort);
    }
    Ok(clean.code)
}

/// One `POST /api/companion/pair` with `mode: 'host'` (no token on this client).
pub async fn pair(
    api_base: &str,
    transport: Arc<dyn Transport>,
    version: &str,
    code: &str,
    puuid: &str,
) -> PairStep {
    let mut options = ApiClientOptions::new(api_base.to_owned(), None, transport);
    options.version = version.to_owned();
    let api = ApiClient::new(options);
    let body = PairRequest {
        code: code.to_owned(),
        puuid: puuid.to_owned(),
        mode: Some(PairMode::Host),
    };
    pair_step(api.pair(&body).await)
}

/// Saves a pairing's token under its group. `false` (logged) when `config.json` could not be written.
pub fn save_token(config_dir: &Path, api_base: &str, group: &GroupSummary, token: &CompanionToken) -> bool {
    match file_token_under_group(
        config_dir,
        api_base,
        GroupRef {
            group_id: &group.id,
            slug: &group.slug,
            name: &group.name,
        },
        token,
    ) {
        Ok(()) => {
            tracing::info!(component = "pairing", groupId = %group.id, slug = %group.slug, "linked: a host token is saved for this group");
            true
        }
        Err(error) => {
            tracing::error!(component = "pairing", error = %error, "paired, but the config could not be written");
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use engine::api::transport::HttpRequest;
    use engine::config::load_config;
    use engine::config::state::host_groups;
    use engine::test_support::{FakeTransport, respond};

    const TOKEN: &str = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";

    #[test]
    fn the_field_is_cleaned_as_typed() {
        assert_eq!(clean_code("k7m-q2x").code, "K7MQ2X");
        assert_eq!(clean_code(" k7m q2x ").code, "K7MQ2X");
        assert_eq!(
            clean_code("K7MQ2XAB").code,
            "K7MQ2X",
            "maxlength after the clean-up"
        );
        let typed = clean_code("K7O");
        assert_eq!(typed.code, "K7");
        assert!(typed.look_alike, "O is a look-alike: L5");
        for ch in ["0", "i", "1", "o"] {
            assert!(clean_code(ch).look_alike, "{ch}");
        }
        assert!(!clean_code("K7M").look_alike);
        assert_eq!(
            clean_code("K#7!M").code,
            "K7M",
            "anything else is dropped quietly"
        );
    }

    #[test]
    fn too_short_never_sends() {
        assert_eq!(code_for_request("K7M"), Err(LinkAnswer::TooShort));
        assert_eq!(code_for_request("k7m-q2x"), Ok("K7MQ2X".to_owned()));
    }

    fn answer(status: u16, body: &str) -> Arc<FakeTransport> {
        let body = body.to_owned();
        FakeTransport::new(move |_| respond(status, &body))
    }

    async fn run(transport: Arc<FakeTransport>) -> PairStep {
        pair("http://kustom.test", transport, "1.0.0", "K7MQ2X", "puuid-1").await
    }

    #[tokio::test]
    async fn an_admin_code_is_a_token_for_its_group_and_the_request_says_host() {
        let transport = answer(
            200,
            &format!(
                r#"{{"ok":true,"group":{{"id":"g-1","slug":"customs","name":"Customs Night"}},"companionToken":"{TOKEN}"}}"#
            ),
        );
        let step = run(transport.clone()).await;
        let PairStep::Token { group, token } = step else {
            panic!("expected a token, got {step:?}");
        };
        assert_eq!(group.slug, "customs");
        assert_eq!(token.expose(), TOKEN);
        let requests: Vec<HttpRequest> = transport.requests();
        assert_eq!(requests.len(), 1, "one attempt");
        assert_eq!(requests[0].url, "http://kustom.test/api/companion/pair");
        assert!(
            requests[0].header("authorization").is_none(),
            "no bearer on pairing"
        );
        let body: serde_json::Value = serde_json::from_slice(requests[0].body.as_ref().unwrap()).unwrap();
        assert_eq!(
            body,
            serde_json::json!({"code": "K7MQ2X", "puuid": "puuid-1", "mode": "host"})
        );
    }

    #[tokio::test]
    async fn a_member_code_shows_the_refusal_and_the_quit_line() {
        let refusal = "You're in. Only admins can host. Ask an admin to host, or to make you one.";
        let transport = answer(
            200,
            &format!(
                r#"{{"ok":true,"group":{{"id":"g-1","slug":"customs","name":"Customs Night"}},"hostRefusal":"{refusal}"}}"#
            ),
        );
        let step = run(transport).await;
        let PairStep::Answer(answer) = step else {
            panic!("a member saves nothing");
        };
        assert_eq!(answer, LinkAnswer::Member(refusal.to_owned()));
        assert_eq!(
            answer.lines(),
            vec![refusal.to_owned(), copy::LINK_MEMBER_AFTER.to_owned()]
        );
        assert_eq!(answer.role(), SlotRole::Status);
        assert_eq!(answer.field_action(), FieldAction::Clear);
    }

    #[tokio::test]
    async fn refusals_are_the_servers_sentences_verbatim() {
        for (status, sentence) in [
            (404, "That code doesn't match. Check the page and type it again."),
            (410, "That code ran out. Get a new one where you got this one."),
            (409, "That League account is already linked to someone else."),
            (429, "Too many tries. Wait a minute, then type the code again."),
        ] {
            let step = run(answer(status, &format!(r#"{{"ok":false,"error":"{sentence}"}}"#))).await;
            let PairStep::Answer(answer) = step else { panic!() };
            assert_eq!(answer, LinkAnswer::Refused(sentence.to_owned()), "{status}");
            assert_eq!(answer.lines(), vec![sentence.to_owned()]);
            assert_eq!(answer.role(), SlotRole::Alert);
            assert_eq!(answer.field_action(), FieldAction::Select);
        }
    }

    #[tokio::test]
    async fn server_trouble_and_no_answer_have_their_own_lines() {
        let step = run(answer(500, r#"{"ok":false,"error":"boom"}"#)).await;
        assert_eq!(step, PairStep::Answer(LinkAnswer::Server));
        let step = run(answer(404, "<html>not found</html>")).await;
        assert_eq!(
            step,
            PairStep::Answer(LinkAnswer::Server),
            "a 4xx with no envelope"
        );
        let step = run(answer(200, "not json")).await;
        assert_eq!(step, PairStep::Answer(LinkAnswer::Server));
        let both = format!(
            r#"{{"ok":true,"group":{{"id":"g","slug":"s","name":"n"}},"companionToken":"{TOKEN}","hostRefusal":"x"}}"#
        );
        assert_eq!(
            run(answer(200, &both)).await,
            PairStep::Answer(LinkAnswer::Server)
        );
        let offline = FakeTransport::new(|_| Err("connection refused".to_owned()));
        assert_eq!(run(offline).await, PairStep::Answer(LinkAnswer::Network));
        assert_eq!(LinkAnswer::Network.lines(), vec![copy::LINK_NETWORK.to_owned()]);
    }

    #[test]
    fn a_saved_token_lands_under_its_group_and_keeps_other_keys() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("config.json"),
            "{\n  \"apiBase\": \"http://kustom.test\",\n  \"zFuture\": 1\n}\n",
        )
        .unwrap();
        let group = GroupSummary {
            id: "g-1".into(),
            slug: "customs".into(),
            name: "Customs Night".into(),
        };
        let token = CompanionToken::parse(TOKEN).unwrap();
        assert!(save_token(dir.path(), "http://kustom.test", &group, &token));
        let config = load_config(dir.path()).config().unwrap();
        let groups = host_groups(&config);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].group_id, "g-1");
        assert_eq!(groups[0].token.expose(), TOKEN);
        let raw: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(dir.path().join("config.json")).unwrap()).unwrap();
        assert_eq!(raw["zFuture"], 1, "unknown keys survive");
    }
}

#[cfg(test)]
mod save_failed_tests {
    use super::*;

    #[test]
    fn l8c_is_an_alert_that_clears_and_focuses_the_field() {
        let answer = LinkAnswer::SaveFailed;
        assert_eq!(answer.role(), SlotRole::Alert);
        assert_eq!(answer.field_action(), FieldAction::ClearAndFocus);
        assert_eq!(
            answer.lines(),
            vec![
                "Kustom couldn't save the link on this PC. Get a new code from the site, then type it here."
            ]
        );
    }
}
