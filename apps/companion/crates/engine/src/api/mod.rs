//! The client for `apps/web`'s `/api/companion/*` routes (`api.ts`, `identity.ts`; parity rows 7 and the
//! posting half of 6 and 12 to 18).
//!
//! - Every call carries `Authorization: Bearer <group token>` (none for `POST /api/companion/pair` and the
//!   health check), `accept: application/json`, JSON bodies, and
//!   `User-Agent: customs-night-companion/<version> (<platform>)` as the TypeScript engine sends it
//!   (`version.ts`; the platform is Node's name for it: `win32`, `darwin`, `linux`). M17 keeps the name.
//! - The one envelope: `{ ok: true, ... }` parsed into a typed answer ([`wire`]), `{ ok: false, error,
//!   issues? }` read into [`ApiFailure::Http`]. Nothing untyped gets past the parse.
//! - **Retries on network errors and 5xx only, never on 4xx**, with backoff 1 s to 30 s, up to the call's
//!   attempt count. The counts are per route, exactly as 0.4.0 passes them (M17.4 report): `in_progress` 4,
//!   lobby 1 (the lobby watcher has its own newest-payload retry), rank 2, backfill scan 2, ack/nack 2, a
//!   queued game 1 per pass (the queue has its own outer backoff), commands poll 1, `/me` 1, pair 1 (a code
//!   is single use), health 1. Per-request timeout 15 s.
//! - Nothing here panics or returns an untyped error: every outcome is an [`ApiResult`]. The first time the
//!   API answers 401 or 403 to this client's token, `on_refused` is called once (the session turns it into
//!   a sentence and stops posting).
//! - [`ApiClient::stop`] ends the session's calls: a call not yet sent is never sent, a retry wait ends,
//!   an in-flight request is abandoned, so a group switch is never followed by one more post on the old
//!   token.
//! - Logs name the endpoint, status and the server's sentence; never a header, never a body.

pub mod identity;
pub mod transport;
pub mod wire;

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Serialize;
use serde::de::DeserializeOwned;
use tokio::sync::watch;

use crate::backoff::{Backoff, BackoffOptions};
use crate::config::CompanionToken;
use transport::{HttpRequest, Method, Transport};
use wire::{
    AckResponse, ApiIssue, BackfillScanRequest, BackfillScanResponse, CommandAck, CommandNack, CommandsPoll,
    CommandsResponse, ErrorResponse, GamePayload, GameResponse, HealthResponse, LobbyPayload, LobbyResponse,
    MeResponse, PairRequest, PairResponse, RankPayload, RankResponse,
};

/// `GET /api/companion/me`.
pub const ME_PATH: &str = "/api/companion/me";
/// `POST /api/companion/pair`.
pub const PAIR_PATH: &str = "/api/companion/pair";
/// `POST /api/companion/lobby`.
pub const LOBBY_PATH: &str = "/api/companion/lobby";
/// `POST /api/companion/game`.
pub const GAME_PATH: &str = "/api/companion/game";
/// `POST /api/companion/rank`.
pub const RANK_PATH: &str = "/api/companion/rank";
/// `POST /api/companion/backfill/scan`.
pub const BACKFILL_SCAN_PATH: &str = "/api/companion/backfill/scan";
/// `/api/companion/commands`.
pub const COMMANDS_PATH: &str = "/api/companion/commands";
/// `GET /api/health`.
pub const HEALTH_PATH: &str = "/api/health";

/// Attempts per call, including the first (0.4.0's numbers, see the module docs).
pub mod attempts {
    /// Default for a call that names none.
    pub const DEFAULT: u32 = 4;
    /// `POST game` phase `in_progress`.
    pub const IN_PROGRESS: u32 = 4;
    /// `POST lobby`: one; the watcher retries only while its payload is the newest.
    pub const LOBBY: u32 = 1;
    /// `POST game` phase `eog` from the queue: one per pass.
    pub const QUEUED_GAME: u32 = 1;
    /// `POST rank`.
    pub const RANK: u32 = 2;
    /// `POST backfill/scan`.
    pub const BACKFILL_SCAN: u32 = 2;
    /// `POST commands/{id}/ack` and `/nack`.
    pub const ACK: u32 = 2;
    /// `GET commands`.
    pub const COMMANDS_POLL: u32 = 1;
    /// `GET me`.
    pub const ME: u32 = 1;
    /// `POST pair`: a code is single use.
    pub const PAIR: u32 = 1;
    /// `GET /api/health`.
    pub const HEALTH: u32 = 1;
}

/// The per-request timeout.
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

/// Characters of a non-JSON 2xx body kept for the log.
pub const PREVIEW_CHARS: usize = 120;

/// Node's `process.platform` for this build.
pub fn node_platform() -> &'static str {
    if cfg!(windows) {
        "win32"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else {
        "linux"
    }
}

/// `customs-night-companion/<version> (<platform>)`.
pub fn user_agent(version: &str) -> String {
    format!("customs-night-companion/{version} ({})", node_platform())
}

/// Why a call did not succeed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ApiFailure {
    /// The API refused (4xx, or a 5xx after the last attempt). `error` is the envelope's sentence or
    /// `HTTP <n>`.
    Http {
        /// The status.
        status: u16,
        /// The server's sentence.
        error: String,
        /// Validation issues.
        issues: Vec<ApiIssue>,
        /// Attempts made.
        attempts: u32,
    },
    /// No HTTP answer on the last attempt (refused, DNS, TLS, timeout, or stopped).
    Network {
        /// Why, briefly.
        message: String,
        /// Attempts made.
        attempts: u32,
    },
    /// 2xx, but the body was not JSON.
    Malformed {
        /// The status.
        status: u16,
        /// The first [`PREVIEW_CHARS`] characters.
        preview: String,
    },
    /// 2xx JSON that did not match the answer's type.
    Schema {
        /// The status.
        status: u16,
        /// What did not match.
        issues: Vec<String>,
    },
}

impl ApiFailure {
    fn retryable(&self) -> bool {
        match self {
            ApiFailure::Network { .. } => true,
            ApiFailure::Http { status, .. } => *status >= 500,
            _ => false,
        }
    }

    /// The HTTP status, when there was an answer.
    pub fn status(&self) -> Option<u16> {
        match self {
            ApiFailure::Http { status, .. }
            | ApiFailure::Malformed { status, .. }
            | ApiFailure::Schema { status, .. } => Some(*status),
            ApiFailure::Network { .. } => None,
        }
    }

    /// One line for a person or the log (`describeFailure`).
    pub fn describe(&self) -> String {
        match self {
            ApiFailure::Http { status, error, .. } => format!("HTTP {status} {error}"),
            ApiFailure::Network { message, .. } => message.clone(),
            ApiFailure::Malformed { status, .. } => format!("HTTP {status} with a non-JSON body"),
            ApiFailure::Schema { issues, .. } => format!("unexpected response shape: {}", issues.join("; ")),
        }
    }

    fn reason(&self) -> &'static str {
        match self {
            ApiFailure::Http { .. } => "http",
            ApiFailure::Network { .. } => "network",
            ApiFailure::Malformed { .. } => "malformed",
            ApiFailure::Schema { .. } => "schema",
        }
    }

    fn log_detail(&self) -> String {
        match self {
            ApiFailure::Http { error, issues, .. } => {
                if issues.is_empty() {
                    error.clone()
                } else {
                    let list: Vec<String> = issues
                        .iter()
                        .map(|i| format!("{}: {}", i.path, i.message))
                        .collect();
                    format!("{error} ({})", list.join("; "))
                }
            }
            ApiFailure::Network { message, .. } => message.clone(),
            ApiFailure::Malformed { preview, .. } => preview.clone(),
            ApiFailure::Schema { issues, .. } => issues.join("; "),
        }
    }
}

/// A successful call: the status and the typed answer.
#[derive(Debug, Clone, PartialEq)]
pub struct ApiOk<T> {
    /// The 2xx status.
    pub status: u16,
    /// The answer.
    pub data: T,
}

/// Every call's outcome.
pub type ApiResult<T> = Result<ApiOk<T>, ApiFailure>;

/// Called once with 401 or 403 when the API finally refuses this client's token.
pub type OnRefused = Arc<dyn Fn(u16) + Send + Sync>;

/// How an [`ApiClient`] is set up.
pub struct ApiClientOptions {
    /// The API origin, e.g. `https://kustom.example` (trailing slashes dropped).
    pub api_base: String,
    /// The group's token. `None` for pairing and the health check.
    pub token: Option<CompanionToken>,
    /// The HTTP transport.
    pub transport: Arc<dyn Transport>,
    /// The app's version, for the `User-Agent`.
    pub version: String,
    /// Delay between attempts. Default 1 s to 30 s.
    pub backoff: BackoffOptions,
    /// Per-request timeout. Default [`REQUEST_TIMEOUT`].
    pub timeout: Duration,
    /// See [`OnRefused`].
    pub on_refused: Option<OnRefused>,
}

impl ApiClientOptions {
    /// Defaults for everything but the origin, token and transport.
    pub fn new(
        api_base: impl Into<String>,
        token: Option<CompanionToken>,
        transport: Arc<dyn Transport>,
    ) -> Self {
        ApiClientOptions {
            api_base: api_base.into(),
            token,
            transport,
            version: crate::ENGINE_VERSION.to_owned(),
            backoff: BackoffOptions::new(Duration::from_secs(1), Duration::from_secs(30)),
            timeout: REQUEST_TIMEOUT,
            on_refused: None,
        }
    }
}

/// The client for one session (one group, one token).
pub struct ApiClient {
    api_base: String,
    token: Option<CompanionToken>,
    transport: Arc<dyn Transport>,
    user_agent: String,
    backoff: BackoffOptions,
    timeout: Duration,
    on_refused: Option<OnRefused>,
    refused_reported: AtomicBool,
    stop_tx: watch::Sender<bool>,
}

impl ApiClient {
    /// A client.
    pub fn new(options: ApiClientOptions) -> Self {
        let (stop_tx, _) = watch::channel(false);
        ApiClient {
            api_base: options.api_base.trim_end_matches('/').to_owned(),
            token: options.token,
            transport: options.transport,
            user_agent: user_agent(&options.version),
            backoff: options.backoff,
            timeout: options.timeout,
            on_refused: options.on_refused,
            refused_reported: AtomicBool::new(false),
            stop_tx,
        }
    }

    /// The origin.
    pub fn api_base(&self) -> &str {
        &self.api_base
    }

    /// Whether this client carries a token.
    pub fn has_token(&self) -> bool {
        self.token.is_some()
    }

    /// Ends the session's calls (see the module docs). Idempotent.
    pub fn stop(&self) {
        self.stop_tx.send_replace(true);
    }

    /// Whether [`ApiClient::stop`] was called.
    pub fn is_stopped(&self) -> bool {
        *self.stop_tx.borrow()
    }

    fn request_for(&self, method: Method, path: &str, body: Option<&[u8]>) -> HttpRequest {
        let mut headers = Vec::with_capacity(4);
        if let Some(token) = &self.token {
            headers.push(("authorization".to_owned(), format!("Bearer {}", token.expose())));
        }
        headers.push(("accept".to_owned(), "application/json".to_owned()));
        headers.push(("user-agent".to_owned(), self.user_agent.clone()));
        if body.is_some() {
            headers.push(("content-type".to_owned(), "application/json".to_owned()));
        }
        let url = if path.starts_with('/') {
            format!("{}{path}", self.api_base)
        } else {
            format!("{}/{path}", self.api_base)
        };
        HttpRequest {
            method,
            url,
            headers,
            body: body.map(<[u8]>::to_vec),
            timeout: self.timeout,
        }
    }

    async fn once<T: DeserializeOwned>(&self, request: HttpRequest, attempt: u32) -> ApiResult<T> {
        let mut stop = self.stop_tx.subscribe();
        let sent = tokio::select! {
            sent = self.transport.send(request) => sent,
            _ = stop.wait_for(|stopped| *stopped) => Err("aborted".to_owned()),
        };
        let response = match sent {
            Ok(response) => response,
            Err(message) => {
                return Err(ApiFailure::Network {
                    message,
                    attempts: attempt,
                });
            }
        };
        let status = response.status;
        let json: Option<serde_json::Value> = if response.body.trim().is_empty() {
            Some(serde_json::Value::Null)
        } else {
            serde_json::from_str(&response.body).ok()
        };
        if !(200..300).contains(&status) {
            let envelope = json
                .and_then(|value| serde_json::from_value::<ErrorResponse>(value).ok())
                .filter(|envelope| !envelope.ok);
            return Err(match envelope {
                Some(envelope) => ApiFailure::Http {
                    status,
                    error: envelope.error,
                    issues: envelope.issues.unwrap_or_default(),
                    attempts: attempt,
                },
                None => ApiFailure::Http {
                    status,
                    error: format!("HTTP {status}"),
                    issues: Vec::new(),
                    attempts: attempt,
                },
            });
        }
        let Some(json) = json else {
            return Err(ApiFailure::Malformed {
                status,
                preview: response.body.chars().take(PREVIEW_CHARS).collect(),
            });
        };
        match serde_json::from_value::<T>(json) {
            Ok(data) => Ok(ApiOk { status, data }),
            Err(error) => Err(ApiFailure::Schema {
                status,
                issues: vec![error.to_string()],
            }),
        }
    }

    /// One call with up to `max_attempts` attempts. `quiet` skips the final failure log line (the caller
    /// reports the outcome itself). Never panics.
    pub async fn request<T: DeserializeOwned>(
        &self,
        method: Method,
        path: &str,
        body: Option<&(impl Serialize + ?Sized)>,
        max_attempts: u32,
        quiet: bool,
    ) -> ApiResult<T> {
        let endpoint = format!("{} {path}", method.as_str());
        let max_attempts = max_attempts.max(1);
        let bytes = match body.map(serde_json::to_vec).transpose() {
            Ok(bytes) => bytes,
            Err(error) => {
                // Our own types always serialise; this is a log line, not a panic.
                tracing::error!(component = "api", endpoint = %endpoint, error = %error, "api body did not serialise");
                return Err(ApiFailure::Network {
                    message: "body did not serialise".to_owned(),
                    attempts: 0,
                });
            }
        };
        let mut backoff = Backoff::new(self.backoff.clone());
        let mut last: Option<ApiFailure> = None;
        for attempt in 1..=max_attempts {
            if self.is_stopped() {
                return Err(last.unwrap_or(ApiFailure::Network {
                    message: "aborted".to_owned(),
                    attempts: attempt - 1,
                }));
            }
            let request = self.request_for(method, path, bytes.as_deref());
            match self.once::<T>(request, attempt).await {
                Ok(ok) => {
                    tracing::debug!(component = "api", endpoint = %endpoint, status = ok.status, attempt, "api ok");
                    return Ok(ok);
                }
                Err(failure) => {
                    let retry = failure.retryable() && attempt < max_attempts && !self.is_stopped();
                    if retry {
                        let delay = backoff.next_delay();
                        tracing::warn!(
                            component = "api",
                            endpoint = %endpoint,
                            attempt,
                            max_attempts,
                            delay_ms = delay.as_millis() as u64,
                            reason = failure.reason(),
                            status = failure.status(),
                            detail = %failure.log_detail(),
                            "api call failed, retrying"
                        );
                        let mut stop = self.stop_tx.subscribe();
                        tokio::select! {
                            () = tokio::time::sleep(delay) => {}
                            _ = stop.wait_for(|stopped| *stopped) => {}
                        }
                        last = Some(failure);
                        continue;
                    }
                    last = Some(failure);
                    break;
                }
            }
        }
        let failure = last.unwrap_or(ApiFailure::Network {
            message: "no attempt made".to_owned(),
            attempts: 0,
        });
        if let ApiFailure::Http {
            status: status @ (401 | 403),
            ..
        } = &failure
            && let Some(on_refused) = &self.on_refused
            && self.token.is_some()
            && !self.refused_reported.swap(true, Ordering::SeqCst)
        {
            on_refused(*status);
        }
        if !quiet {
            let status = failure.status();
            if status == Some(401) {
                tracing::error!(
                    component = "api",
                    endpoint = %endpoint,
                    reason = failure.reason(),
                    status,
                    detail = %failure.log_detail(),
                    "api rejected the companion token; link this PC again from the site"
                );
            } else {
                tracing::warn!(
                    component = "api",
                    endpoint = %endpoint,
                    reason = failure.reason(),
                    status,
                    detail = %failure.log_detail(),
                    "api call failed"
                );
            }
        }
        Err(failure)
    }

    /// `GET /api/companion/me`: one attempt, quiet (the identity check words the outcome).
    pub async fn me(&self) -> ApiResult<MeResponse> {
        self.request::<MeResponse>(Method::Get, ME_PATH, None::<&()>, attempts::ME, true)
            .await
    }

    /// `POST /api/companion/pair` (no token on this client): one attempt, quiet; the refine checked.
    pub async fn pair(&self, body: &PairRequest) -> ApiResult<PairResponse> {
        let result = self
            .request::<PairResponse>(Method::Post, PAIR_PATH, Some(body), attempts::PAIR, true)
            .await?;
        match result.data.validate() {
            Ok(()) => Ok(result),
            Err(issue) => Err(ApiFailure::Schema {
                status: result.status,
                issues: vec![issue],
            }),
        }
    }

    /// `POST /api/companion/lobby`: one attempt.
    pub async fn post_lobby(&self, body: &LobbyPayload) -> ApiResult<LobbyResponse> {
        self.request(Method::Post, LOBBY_PATH, Some(body), attempts::LOBBY, false)
            .await
    }

    /// `POST /api/companion/game`, phase `in_progress`: four attempts.
    pub async fn post_in_progress(&self, body: &GamePayload) -> ApiResult<GameResponse> {
        self.request(Method::Post, GAME_PATH, Some(body), attempts::IN_PROGRESS, false)
            .await
    }

    /// `POST /api/companion/game` for a queued block: one attempt per queue pass. Takes the body as written
    /// in the queue file, so a 0.3.x block is re-sent exactly as it was captured.
    pub async fn post_queued_game(&self, body: &(impl Serialize + ?Sized)) -> ApiResult<GameResponse> {
        self.request(Method::Post, GAME_PATH, Some(body), attempts::QUEUED_GAME, false)
            .await
    }

    /// `POST /api/companion/rank`: two attempts.
    pub async fn post_rank(&self, body: &RankPayload) -> ApiResult<RankResponse> {
        self.request(Method::Post, RANK_PATH, Some(body), attempts::RANK, false)
            .await
    }

    /// `POST /api/companion/backfill/scan`: two attempts, quiet.
    pub async fn backfill_scan(&self, body: &BackfillScanRequest) -> ApiResult<BackfillScanResponse> {
        self.request(
            Method::Post,
            BACKFILL_SCAN_PATH,
            Some(body),
            attempts::BACKFILL_SCAN,
            true,
        )
        .await
    }

    /// `GET /api/companion/commands?clientConnected=`: one attempt, quiet; the page cap checked.
    pub async fn poll_commands(&self, poll: CommandsPoll) -> ApiResult<CommandsResponse> {
        let result = self
            .request::<CommandsResponse>(
                Method::Get,
                &poll.path(),
                None::<&()>,
                attempts::COMMANDS_POLL,
                true,
            )
            .await?;
        match result.data.validate() {
            Ok(()) => Ok(result),
            Err(issue) => Err(ApiFailure::Schema {
                status: result.status,
                issues: vec![issue],
            }),
        }
    }

    /// `POST /api/companion/commands/{id}/ack`: two attempts, quiet.
    pub async fn ack(&self, command_id: &str, body: &CommandAck) -> ApiResult<AckResponse> {
        let path = format!("{COMMANDS_PATH}/{}/ack", encode_segment(command_id));
        self.request(Method::Post, &path, Some(body), attempts::ACK, true)
            .await
    }

    /// `POST /api/companion/commands/{id}/nack`: two attempts, quiet.
    pub async fn nack(&self, command_id: &str, body: &CommandNack) -> ApiResult<AckResponse> {
        let path = format!("{COMMANDS_PATH}/{}/nack", encode_segment(command_id));
        self.request(Method::Post, &path, Some(body), attempts::ACK, true)
            .await
    }

    /// `GET /api/health`: reachability only. `None` when fine, else a reason.
    pub async fn health(&self) -> Option<String> {
        match self
            .request::<HealthResponse>(Method::Get, HEALTH_PATH, None::<&()>, attempts::HEALTH, false)
            .await
        {
            Ok(ok) if ok.data.service == "customs-night" => None,
            Ok(_) => Some("unexpected response shape: service".to_owned()),
            Err(failure) => Some(failure.describe()),
        }
    }
}

/// Percent-encodes everything but unreserved characters (a command id is a UUID; anything else must not
/// reach the path as a separator).
fn encode_segment(segment: &str) -> String {
    let mut out = String::with_capacity(segment.len());
    for byte in segment.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_agent_matches_version_ts() {
        assert_eq!(
            user_agent("1.0.0"),
            format!("customs-night-companion/1.0.0 ({})", node_platform())
        );
    }

    #[test]
    fn command_ids_cannot_escape_the_path() {
        assert_eq!(encode_segment("0b7c-11aa"), "0b7c-11aa");
        assert_eq!(encode_segment("../x?y"), "..%2Fx%3Fy");
    }
}
