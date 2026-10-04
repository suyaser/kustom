//! HTTPS to the League client (port of `packages/lcu/src/client.ts`): basic auth `riot:<password>`, the
//! pinned verifier from [`super::tls`], JSON in and out, every 2xx body deserialised into the caller's serde
//! type. Nothing here panics or returns an untyped error: a dead client, a non-2xx, a non-JSON body and a
//! body that does not match the type are each a [`LcuFailure`], logged once with the endpoint (never the
//! body: lobby and end-of-game bodies carry chat credentials).

use std::time::Duration;

use base64::Engine as _;
use reqwest::Method;
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, HeaderValue};
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::Value;

use super::lockfile::Credentials;
use super::tls::{LcuCertVerifier, client_config};

/// The basic-auth user is always `riot`.
pub const LCU_USER: &str = "riot";
/// Per-request timeout, as the TypeScript client.
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(10);

/// `base64("riot:<password>")`, the credential part of the header.
pub fn basic_auth_credential(password: &str) -> String {
    base64::engine::general_purpose::STANDARD.encode(format!("{LCU_USER}:{password}"))
}

/// `Basic base64("riot:<password>")`.
pub fn basic_auth(password: &str) -> String {
    format!("Basic {}", basic_auth_credential(password))
}

/// A 2xx with its typed body, the raw JSON beside it (the end-of-game block and a match detail ride to the
/// server whole as `raw`).
#[derive(Clone, PartialEq)]
pub struct LcuOk<T> {
    /// The HTTP status.
    pub status: u16,
    /// The typed body.
    pub value: T,
    /// The body as JSON (`null` for an empty body).
    pub raw: Value,
}

/// Every way a call can fail. Carries no body text except the client's own error `message`.
#[derive(Clone, PartialEq)]
pub enum LcuFailure {
    /// The client answered outside 2xx. `message` is its `message` (or `errorCode`), when it sent one.
    Http {
        /// The status.
        status: u16,
        /// `LOBBY_NOT_FOUND`, ...
        message: Option<String>,
        /// The error body as JSON (for a write's nack text).
        json: Option<Value>,
    },
    /// 2xx but not JSON.
    Malformed {
        /// The status.
        status: u16,
    },
    /// 2xx JSON that did not deserialise into the type.
    Schema {
        /// The status.
        status: u16,
        /// serde's reason (field and expected type).
        error: String,
        /// The body, for a caller that wants to look anyway (the probe's shape diff).
        raw: Value,
    },
    /// No HTTP answer: refused, timed out, TLS refused.
    Network {
        /// What happened, one line.
        message: String,
        /// True when the TLS handshake or certificate check failed (the probe says so loudly).
        tls: bool,
    },
}

/// Response bodies never reach a `Debug` string: lobby and end-of-game bodies carry chat credentials, and a
/// serde error can quote a value. Only statuses, the client's own error `message` and the network reason
/// are shown.
const REDACTED: &str = "[redacted]";

impl<T> std::fmt::Debug for LcuOk<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LcuOk")
            .field("status", &self.status)
            .field("value", &REDACTED)
            .field("raw", &REDACTED)
            .finish()
    }
}

impl std::fmt::Debug for LcuFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LcuFailure::Http {
                status,
                message,
                json,
            } => f
                .debug_struct("Http")
                .field("status", status)
                .field("message", message)
                .field("json", &json.as_ref().map(|_| REDACTED))
                .finish(),
            LcuFailure::Malformed { status } => f.debug_struct("Malformed").field("status", status).finish(),
            LcuFailure::Schema { status, .. } => f
                .debug_struct("Schema")
                .field("status", status)
                .field("error", &REDACTED)
                .field("raw", &REDACTED)
                .finish(),
            LcuFailure::Network { message, tls } => f
                .debug_struct("Network")
                .field("message", message)
                .field("tls", tls)
                .finish(),
        }
    }
}

impl LcuFailure {
    /// The serde reason of a `Schema` failure with quoted values redacted (safe to print).
    pub fn safe_schema_error(&self) -> Option<String> {
        match self {
            LcuFailure::Schema { error, .. } => Some(super::events::redact_quoted(error)),
            _ => None,
        }
    }

    /// The HTTP status, when there was one.
    pub fn status(&self) -> Option<u16> {
        match self {
            LcuFailure::Http { status, .. }
            | LcuFailure::Malformed { status }
            | LcuFailure::Schema { status, .. } => Some(*status),
            LcuFailure::Network { .. } => None,
        }
    }

    /// `404` and friends, as the TypeScript `describeWriteResponse` words it (a nack's detail).
    pub fn describe(&self) -> String {
        match self {
            LcuFailure::Http {
                status,
                message: Some(m),
                ..
            } if !m.is_empty() => format!("{status} {m}"),
            LcuFailure::Http { status, .. } => status.to_string(),
            LcuFailure::Malformed { status } => format!("{status} (body is not JSON)"),
            LcuFailure::Schema { status, .. } => format!("{status} (unexpected shape)"),
            LcuFailure::Network { message, .. } => format!("no answer ({message})"),
        }
    }
}

/// The result of one call.
pub type LcuResponse<T> = Result<LcuOk<T>, LcuFailure>;

/// Why a client could not be built (only the TLS setup can fail).
#[derive(Debug)]
pub struct ClientBuildError(pub String);

impl std::fmt::Display for ClientBuildError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "could not build the League client connection: {}", self.0)
    }
}

impl std::error::Error for ClientBuildError {}

/// The HTTPS client for one running League client (one lockfile's credentials).
#[derive(Clone)]
pub struct LcuClient {
    http: reqwest::Client,
    base: String,
    authorization: HeaderValue,
}

impl std::fmt::Debug for LcuClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LcuClient").field("base", &self.base).finish()
    }
}

fn is_tls_error(error: &reqwest::Error) -> bool {
    let mut source: Option<&dyn std::error::Error> = Some(error);
    while let Some(current) = source {
        let text = current.to_string().to_ascii_lowercase();
        if text.contains("certificate") || text.contains("tls") || text.contains("handshake") {
            return true;
        }
        source = current.source();
    }
    false
}

fn describe_network(error: &reqwest::Error) -> String {
    if error.is_timeout() {
        return "timed out".into();
    }
    let mut parts = Vec::new();
    let mut source: Option<&dyn std::error::Error> = Some(error);
    while let Some(current) = source {
        parts.push(current.to_string());
        source = current.source();
    }
    parts.join(": ")
}

impl LcuClient {
    /// A client for `127.0.0.1:<port>` pinned to Riot's root.
    pub fn new(credentials: &Credentials) -> Result<Self, ClientBuildError> {
        let verifier = LcuCertVerifier::riot().map_err(|e| ClientBuildError(e.to_string()))?;
        Self::with_verifier(credentials, verifier, DEFAULT_TIMEOUT)
    }

    /// A client with its own verifier (tests pin to their CA; the probe records the chain). The address is
    /// always `127.0.0.1`.
    pub fn with_verifier(
        credentials: &Credentials,
        verifier: LcuCertVerifier,
        timeout: Duration,
    ) -> Result<Self, ClientBuildError> {
        let tls = client_config(verifier).map_err(|e| ClientBuildError(e.to_string()))?;
        let http = reqwest::Client::builder()
            .use_preconfigured_tls(tls)
            // The client never redirects; following one could carry the basic-auth header elsewhere.
            .redirect(reqwest::redirect::Policy::none())
            .no_proxy()
            .timeout(timeout)
            .connect_timeout(timeout)
            .pool_max_idle_per_host(4)
            .build()
            .map_err(|e| ClientBuildError(describe_network(&e)))?;
        let mut authorization = HeaderValue::from_str(&basic_auth(&credentials.password))
            .map_err(|_| ClientBuildError("the lockfile password is not a valid header value".into()))?;
        authorization.set_sensitive(true);
        Ok(Self {
            http,
            base: format!("https://127.0.0.1:{}", credentials.port),
            authorization,
        })
    }

    /// `GET path`, typed.
    pub async fn get<T: DeserializeOwned>(&self, path: &str) -> LcuResponse<T> {
        self.request(Method::GET, path, None::<&()>).await
    }

    /// `POST path` with a JSON body (or none), typed answer. **Only the lobby writes:** a path outside
    /// [`super::endpoints::LOBBY_WRITE_PATHS`] is refused here, before any request, so no other write can be
    /// expressed (never automate gameplay). Crate-private: the public writes are the three named methods in
    /// [`super::endpoints`].
    pub(crate) async fn post<B: Serialize + ?Sized, T: DeserializeOwned>(
        &self,
        path: &str,
        body: Option<&B>,
    ) -> LcuResponse<T> {
        if !super::endpoints::LOBBY_WRITE_PATHS.contains(&path) {
            tracing::error!(path, "refusing to POST outside the lobby allow-list");
            return Err(LcuFailure::Network {
                message: format!("refused: {path} is not a lobby write"),
                tls: false,
            });
        }
        self.request(Method::POST, path, body).await
    }

    /// One round trip: status and JSON body, no type. Private: every caller goes through `get` or the
    /// allow-listed `post`. Never panics.
    async fn raw<B: Serialize + ?Sized>(
        &self,
        method: Method,
        path: &str,
        body: Option<&B>,
    ) -> Result<(u16, Option<Value>), LcuFailure> {
        if !path.starts_with('/') {
            return Err(LcuFailure::Network {
                message: format!("path must start with \"/\": {path}"),
                tls: false,
            });
        }
        let mut request = self
            .http
            .request(method, format!("{}{path}", self.base))
            .header(AUTHORIZATION, self.authorization.clone())
            .header(ACCEPT, "application/json");
        if let Some(body) = body {
            let bytes = serde_json::to_vec(body).map_err(|e| LcuFailure::Network {
                message: format!("body did not serialise: {e}"),
                tls: false,
            })?;
            request = request.header(CONTENT_TYPE, "application/json").body(bytes);
        }
        let response = request.send().await.map_err(|e| LcuFailure::Network {
            message: describe_network(&e),
            tls: is_tls_error(&e),
        })?;
        let status = response.status().as_u16();
        let bytes = response.bytes().await.map_err(|e| LcuFailure::Network {
            message: describe_network(&e),
            tls: false,
        })?;
        if bytes.iter().all(u8::is_ascii_whitespace) {
            return Ok((status, Some(Value::Null)));
        }
        Ok((status, serde_json::from_slice(&bytes).ok()))
    }

    async fn request<B: Serialize + ?Sized, T: DeserializeOwned>(
        &self,
        method: Method,
        path: &str,
        body: Option<&B>,
    ) -> LcuResponse<T> {
        let endpoint = format!("{method} {path}");
        let (status, json) = match self.raw(method, path, body).await {
            Ok(answer) => answer,
            Err(failure) => {
                tracing::warn!(%endpoint, reason = %failure.describe(), "lcu request failed");
                return Err(failure);
            }
        };
        if !(200..300).contains(&status) {
            let message = json.as_ref().and_then(|j| {
                j.get("message")
                    .and_then(Value::as_str)
                    .filter(|m| !m.is_empty())
                    .map(String::from)
                    .or_else(|| j.get("errorCode").and_then(Value::as_str).map(String::from))
            });
            tracing::warn!(%endpoint, status, "lcu non-2xx");
            return Err(LcuFailure::Http {
                status,
                message,
                json,
            });
        }
        let Some(raw) = json else {
            tracing::warn!(%endpoint, status, "lcu body is not JSON; dropped");
            return Err(LcuFailure::Malformed { status });
        };
        match serde_json::from_value::<T>(raw.clone()) {
            Ok(value) => Ok(LcuOk { status, value, raw }),
            Err(error) => {
                // serde's message names the field and the expected type; values can appear in it, so the log
                // line keeps only the category and the position. An empty answer (the 204 a starting client
                // gives `game-version` for minutes) is expected noise: debug, and the caller says what it means.
                if raw.is_null() {
                    tracing::debug!(%endpoint, status, "lcu answered with an empty body; dropped");
                } else {
                    tracing::warn!(%endpoint, status, category = ?error.classify(), "lcu response did not match its type; dropped");
                }
                Err(LcuFailure::Schema {
                    status,
                    error: error.to_string(),
                    raw,
                })
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn basic_auth_is_riot_colon_password() {
        // base64("riot:fake-pw") = cmlvdDpmYWtlLXB3
        assert_eq!(basic_auth("fake-pw"), "Basic cmlvdDpmYWtlLXB3");
    }

    #[test]
    fn debug_never_shows_a_body() {
        let secret =
            serde_json::json!({ "mucJwtDto": { "jwt": "SECRET-JWT" }, "multiUserChatPassword": "SECRET-PW" });
        let failures = [
            LcuFailure::Http {
                status: 404,
                message: Some("LOBBY_NOT_FOUND".into()),
                json: Some(secret.clone()),
            },
            LcuFailure::Schema {
                status: 200,
                error: r#"invalid type: string "SECRET-PW", expected i64"#.into(),
                raw: secret.clone(),
            },
        ];
        for failure in &failures {
            let text = format!("{failure:?} {failure:#?}");
            assert!(!text.contains("SECRET"), "{text}");
        }
        assert!(format!("{:?}", failures[0]).contains("LOBBY_NOT_FOUND"));
        let ok = LcuOk {
            status: 200,
            value: secret.clone(),
            raw: secret,
        };
        assert!(!format!("{ok:?}").contains("SECRET"));
    }

    #[test]
    fn describe_words_failures_like_the_typescript_nacks() {
        let http = LcuFailure::Http {
            status: 404,
            message: Some("LOBBY_NOT_FOUND".into()),
            json: None,
        };
        assert_eq!(http.describe(), "404 LOBBY_NOT_FOUND");
        assert_eq!(
            LcuFailure::Http {
                status: 500,
                message: None,
                json: None
            }
            .describe(),
            "500"
        );
        assert_eq!(
            LcuFailure::Malformed { status: 200 }.describe(),
            "200 (body is not JSON)"
        );
    }
}
