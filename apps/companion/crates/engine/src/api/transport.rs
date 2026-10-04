//! The one HTTP exchange the API client needs, behind a trait so the client's rules (envelope, retries,
//! refusals, logging) are tested with a scripted fake, like `api.test.ts` injects `fetch`.

use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

/// A boxed, sendable future (the trait stays object-safe).
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// `GET` or `POST`: the only two the companion routes use.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {
    /// `GET`.
    Get,
    /// `POST`.
    Post,
}

impl Method {
    /// As on the wire and in the log's `endpoint`.
    pub fn as_str(self) -> &'static str {
        match self {
            Method::Get => "GET",
            Method::Post => "POST",
        }
    }
}

/// One request. `headers` carries the bearer token: never log a request.
#[derive(Clone)]
pub struct HttpRequest {
    /// The method.
    pub method: Method,
    /// The full URL.
    pub url: String,
    /// Lower-case header names and their values.
    pub headers: Vec<(String, String)>,
    /// The JSON body, if any.
    pub body: Option<Vec<u8>>,
    /// The per-request timeout.
    pub timeout: Duration,
}

impl HttpRequest {
    /// A header's value.
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }
}

impl std::fmt::Debug for HttpRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // No headers (the token) and no body.
        f.debug_struct("HttpRequest")
            .field("method", &self.method)
            .field("url", &self.url)
            .finish_non_exhaustive()
    }
}

/// One answer: the status and the body text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpResponse {
    /// The HTTP status.
    pub status: u16,
    /// The body as text (lossy UTF-8).
    pub body: String,
}

/// Sends one request. `Err` is "no HTTP answer" (refused, DNS, TLS, timeout), with a short reason.
pub trait Transport: Send + Sync {
    /// Sends `request`.
    fn send(&self, request: HttpRequest) -> BoxFuture<'_, Result<HttpResponse, String>>;
}

/// The real transport: reqwest over rustls (`ring`), the platform's root store, redirects off.
pub struct ReqwestTransport {
    client: reqwest::Client,
}

impl ReqwestTransport {
    /// Builds the client. Installs the `ring` crypto provider for the process if none is installed yet
    /// (reqwest is built with `rustls-no-provider` and would otherwise refuse).
    pub fn new() -> Result<Self, String> {
        let _ = rustls::crypto::ring::default_provider().install_default();
        // No redirects: a 3xx is a failure the caller sees (`HTTP 30x`), never a re-sent bearer token or
        // body to another URL. The LCU client does the same.
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|error| format!("could not build the HTTP client: {error}"))?;
        Ok(ReqwestTransport { client })
    }
}

fn describe(error: &reqwest::Error) -> String {
    // Node's `fetch failed: ECONNREFUSED` equivalent: the error plus its innermost cause. Never a header.
    let mut text = if error.is_timeout() {
        "timeout".to_owned()
    } else if error.is_connect() {
        "connect failed".to_owned()
    } else {
        "request failed".to_owned()
    };
    let mut source: Option<&dyn std::error::Error> = std::error::Error::source(error);
    let mut innermost = None;
    while let Some(inner) = source {
        innermost = Some(inner.to_string());
        source = inner.source();
    }
    if let Some(cause) = innermost {
        text.push_str(": ");
        text.push_str(&cause);
    }
    text
}

impl Transport for ReqwestTransport {
    fn send(&self, request: HttpRequest) -> BoxFuture<'_, Result<HttpResponse, String>> {
        Box::pin(async move {
            let method = match request.method {
                Method::Get => reqwest::Method::GET,
                Method::Post => reqwest::Method::POST,
            };
            let mut builder = self.client.request(method, &request.url).timeout(request.timeout);
            for (name, value) in &request.headers {
                builder = builder.header(name.as_str(), value.as_str());
            }
            if let Some(body) = request.body {
                builder = builder.body(body);
            }
            let response = builder.send().await.map_err(|e| describe(&e))?;
            let status = response.status().as_u16();
            // A body that cannot be read is an empty body, as `readText` does.
            let body = response.text().await.unwrap_or_default();
            Ok(HttpResponse { status, body })
        })
    }
}
