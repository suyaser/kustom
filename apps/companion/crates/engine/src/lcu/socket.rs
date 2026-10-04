//! The client's WebSocket (port of `LcuSocket` in `packages/lcu/src/socket.ts`): `wss://127.0.0.1:<port>`
//! with the same basic auth and the same pinned verifier as HTTPS, `[5, "OnJsonApiEvent"]` on open (every
//! event; [`super::events::route`] keeps the four URIs the watchers read), a ping every 30 s and a dead
//! socket declared after 10 s without a pong (the PC slept, the client was killed without a close frame).
//!
//! [`run_once`] is one connection; [`run_forever`] reconnects with jittered backoff from 1 s to 60 s, reset
//! after a connection that opened, and rediscovers the client before every attempt (the port changes when
//! the client restarts on a patch). It never returns on an error, only when told to stop. Malformed frames
//! are logged and dropped; nothing here panics.

use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt as _, StreamExt as _};
use rustls::ClientConfig;
use rustls::pki_types::{IpAddr as PkiIpAddr, ServerName};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, watch};
use tokio_rustls::TlsConnector;
use tokio_tungstenite::tungstenite::client::IntoClientRequest as _;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::protocol::Message;
use tokio_tungstenite::{WebSocketStream, client_async};

use super::client::basic_auth;
use super::events::{ALL_EVENTS_TOPIC, Frame, LcuEvent, parse_frame, subscribe_message};
use super::lockfile::Credentials;
use super::tls::LCU_IP;

/// Ping interval.
pub const DEFAULT_HEARTBEAT: Duration = Duration::from_secs(30);
/// How long a pong may take.
pub const DEFAULT_HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(10);
/// Reconnect backoff bounds.
pub const BACKOFF_MIN: Duration = Duration::from_secs(1);
/// Upper bound of the reconnect backoff.
pub const BACKOFF_MAX: Duration = Duration::from_secs(60);

/// Heartbeat settings.
#[derive(Debug, Clone, Copy)]
pub struct SocketOptions {
    /// Ping every this long; zero disables the heartbeat (tests).
    pub heartbeat: Duration,
    /// Terminate when a pong takes longer than this.
    pub heartbeat_timeout: Duration,
}

impl Default for SocketOptions {
    fn default() -> Self {
        Self {
            heartbeat: DEFAULT_HEARTBEAT,
            heartbeat_timeout: DEFAULT_HEARTBEAT_TIMEOUT,
        }
    }
}

/// What the socket reports to its owner.
#[derive(Debug, Clone, PartialEq)]
pub enum SocketMessage {
    /// Connected and subscribed.
    Open {
        /// The port it connected to.
        port: u16,
    },
    /// An event (not yet routed).
    Event(LcuEvent),
    /// The connection ended; `run_forever` will try again.
    Closed(CloseReason),
}

/// Why a connection ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CloseReason {
    /// Could not connect (refused, TLS refused, upgrade refused). One line, no secret.
    ConnectFailed(String),
    /// The client closed it (code and reason as sent).
    ClosedByPeer {
        /// The close code, when one was sent.
        code: Option<u16>,
        /// The close reason.
        reason: String,
    },
    /// No pong within the timeout.
    Heartbeat,
    /// A read or write failed mid-stream.
    Broken(String),
    /// The owner asked to stop.
    Stopped,
    /// The receiver of [`SocketMessage`]s went away.
    OwnerGone,
}

type Stream = WebSocketStream<tokio_rustls::client::TlsStream<TcpStream>>;

/// Opens the socket: TCP to `127.0.0.1:<port>`, TLS with `tls` (the pinned verifier), the upgrade with basic
/// auth and no subprotocol (the client negotiates none, docs/03).
pub async fn connect(credentials: &Credentials, tls: Arc<ClientConfig>) -> Result<Stream, String> {
    let addr = (LCU_IP, credentials.port);
    let tcp = tokio::time::timeout(Duration::from_secs(10), TcpStream::connect(addr))
        .await
        .map_err(|_| "connect timed out".to_string())?
        .map_err(|e| format!("connect: {}", e.kind()))?;
    let _ = tcp.set_nodelay(true);
    let name = ServerName::IpAddress(PkiIpAddr::from(std::net::IpAddr::V4(LCU_IP)));
    let tls_stream = TlsConnector::from(tls)
        .connect(name, tcp)
        .await
        .map_err(|e| format!("tls: {e}"))?;
    let mut request = format!("wss://127.0.0.1:{}", credentials.port)
        .into_client_request()
        .map_err(|e| format!("request: {e}"))?;
    let auth = HeaderValue::from_str(&basic_auth(&credentials.password))
        .map_err(|_| "bad auth header".to_string())?;
    request.headers_mut().insert("Authorization", auth);
    let (stream, _response) = client_async(request, tls_stream)
        .await
        .map_err(|e| format!("upgrade: {e}"))?;
    Ok(stream)
}

/// One connection: connect, subscribe to every event, forward frames until the socket ends or `stop` turns
/// true. Never panics.
pub async fn run_once(
    credentials: &Credentials,
    tls: Arc<ClientConfig>,
    options: SocketOptions,
    tx: &mpsc::Sender<SocketMessage>,
    stop: &mut watch::Receiver<bool>,
) -> CloseReason {
    let mut stream = match connect(credentials, tls).await {
        Ok(stream) => stream,
        Err(reason) => return CloseReason::ConnectFailed(reason),
    };
    if let Err(e) = stream
        .send(Message::text(subscribe_message(ALL_EVENTS_TOPIC)))
        .await
    {
        return CloseReason::Broken(format!("subscribe: {e}"));
    }
    tracing::info!(port = credentials.port, "lcu socket open");
    if tx
        .send(SocketMessage::Open {
            port: credentials.port,
        })
        .await
        .is_err()
    {
        return CloseReason::OwnerGone;
    }
    let heartbeat_on = !options.heartbeat.is_zero();
    let mut ping = tokio::time::interval(if heartbeat_on {
        options.heartbeat
    } else {
        Duration::from_secs(3600)
    });
    ping.tick().await;
    let mut pong_deadline: Option<tokio::time::Instant> = None;
    loop {
        let deadline = pong_deadline;
        tokio::select! {
            changed = stop.changed() => {
                if changed.is_err() || *stop.borrow() {
                    let _ = stream.close(None).await;
                    return CloseReason::Stopped;
                }
            }
            _ = ping.tick(), if heartbeat_on => {
                if pong_deadline.is_none() {
                    pong_deadline = Some(tokio::time::Instant::now() + options.heartbeat_timeout);
                }
                if let Err(e) = stream.send(Message::Ping(Vec::new().into())).await {
                    return CloseReason::Broken(format!("ping: {e}"));
                }
            }
            _ = async { if let Some(at) = deadline { tokio::time::sleep_until(at).await } }, if deadline.is_some() => {
                tracing::warn!(timeout_ms = options.heartbeat_timeout.as_millis() as u64, "lcu socket silent: no pong; terminating it");
                return CloseReason::Heartbeat;
            }
            frame = stream.next() => {
                match frame {
                    None => return CloseReason::ClosedByPeer { code: None, reason: String::new() },
                    Some(Err(e)) => return CloseReason::Broken(e.to_string()),
                    Some(Ok(Message::Pong(_))) => pong_deadline = None,
                    Some(Ok(Message::Close(frame))) => {
                        return CloseReason::ClosedByPeer {
                            code: frame.as_ref().map(|f| u16::from(f.code)),
                            reason: frame.map(|f| f.reason.to_string()).unwrap_or_default(),
                        };
                    }
                    Some(Ok(Message::Text(text))) => match parse_frame(text.as_str()) {
                        Frame::Event(event) => {
                            if let Some(reason) = forward(tx, SocketMessage::Event(event), stop).await {
                                return reason;
                            }
                        }
                        Frame::Empty => tracing::debug!("lcu socket empty frame"),
                        Frame::Malformed(reason) => tracing::warn!(%reason, "lcu socket dropped frame"),
                    },
                    Some(Ok(Message::Binary(bytes))) => match parse_frame(&String::from_utf8_lossy(&bytes)) {
                        Frame::Event(event) => {
                            if let Some(reason) = forward(tx, SocketMessage::Event(event), stop).await {
                                return reason;
                            }
                        }
                        Frame::Empty => {}
                        Frame::Malformed(reason) => tracing::warn!(%reason, "lcu socket dropped binary frame"),
                    },
                    Some(Ok(_)) => {}
                }
            }
        }
    }
}

/// Hands one message to the owner, but never waits past a stop: a slow owner cannot hold up a stop request.
/// (The ping is not starved for long either: the owner's queue is bounded and drained continuously.)
async fn forward(
    tx: &mpsc::Sender<SocketMessage>,
    message: SocketMessage,
    stop: &mut watch::Receiver<bool>,
) -> Option<CloseReason> {
    loop {
        tokio::select! {
            permit = tx.reserve() => {
                return match permit {
                    Ok(permit) => {
                        permit.send(message);
                        None
                    }
                    Err(_) => Some(CloseReason::OwnerGone),
                };
            }
            changed = stop.changed() => {
                if changed.is_err() || *stop.borrow() {
                    return Some(CloseReason::Stopped);
                }
            }
        }
    }
}

/// Jittered exponential backoff (1 s to 60 s, the connection machine's bounds). Deterministic per `seed`.
#[derive(Debug, Clone)]
pub struct Backoff {
    attempt: u32,
    state: u64,
    min: Duration,
    max: Duration,
}

impl Backoff {
    /// A backoff with the given bounds.
    pub fn new(min: Duration, max: Duration, seed: u64) -> Self {
        Self {
            attempt: 0,
            state: seed | 1,
            min,
            max,
        }
    }

    /// The next delay: `min * 2^attempt` capped at `max`, then jittered down to between half and all of it.
    pub fn next_delay(&mut self) -> Duration {
        let exp = self.min.saturating_mul(1u32 << self.attempt.min(16));
        let capped = exp.min(self.max);
        self.attempt = self.attempt.saturating_add(1);
        // xorshift64: jitter without a `rand` dependency.
        self.state ^= self.state << 13;
        self.state ^= self.state >> 7;
        self.state ^= self.state << 17;
        let fraction = 0.5 + (self.state % 1000) as f64 / 2000.0;
        capped.mul_f64(fraction).max(self.min.min(capped))
    }

    /// Back to the first delay.
    pub fn reset(&mut self) {
        self.attempt = 0;
    }
}

/// Reconnects forever: `discover` before every attempt (`None` = the client is not running), then one
/// connection; the backoff resets after a connection that opened. Returns only when `stop` turns true or
/// the receiver of `tx` is gone.
pub async fn run_forever<D, F>(
    mut discover: D,
    tls: Arc<ClientConfig>,
    options: SocketOptions,
    backoff: (Duration, Duration),
    tx: mpsc::Sender<SocketMessage>,
    mut stop: watch::Receiver<bool>,
) -> CloseReason
where
    D: FnMut() -> F,
    F: std::future::Future<Output = Option<Credentials>>,
{
    let seed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(7);
    let mut delays = Backoff::new(backoff.0, backoff.1, seed);
    loop {
        if *stop.borrow() {
            return CloseReason::Stopped;
        }
        let reason = match discover().await {
            Some(credentials) => {
                let reason = run_once(&credentials, tls.clone(), options, &tx, &mut stop).await;
                if !matches!(reason, CloseReason::ConnectFailed(_)) {
                    delays.reset();
                }
                reason
            }
            None => CloseReason::ConnectFailed("League client not found".into()),
        };
        match reason {
            CloseReason::Stopped | CloseReason::OwnerGone => return reason,
            other => {
                tracing::info!(reason = ?other, "lcu socket closed; reconnecting");
                if tx.send(SocketMessage::Closed(other)).await.is_err() {
                    return CloseReason::OwnerGone;
                }
            }
        }
        let delay = delays.next_delay();
        tokio::select! {
            _ = tokio::time::sleep(delay) => {}
            changed = stop.changed() => {
                if changed.is_err() || *stop.borrow() {
                    return CloseReason::Stopped;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_grows_caps_jitters_and_resets() {
        let mut b = Backoff::new(BACKOFF_MIN, BACKOFF_MAX, 42);
        let delays: Vec<Duration> = (0..10).map(|_| b.next_delay()).collect();
        for (i, d) in delays.iter().enumerate() {
            let ceiling = BACKOFF_MIN.saturating_mul(1 << i).min(BACKOFF_MAX);
            assert!(
                *d <= ceiling && *d >= ceiling / 2 && *d >= BACKOFF_MIN,
                "{i}: {d:?}"
            );
        }
        assert!(delays[9] >= Duration::from_secs(30));
        b.reset();
        assert!(b.next_delay() <= BACKOFF_MIN);
    }
}
