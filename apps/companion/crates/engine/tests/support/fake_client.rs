//! A fake League client on one port, as the real one is: HTTPS with canned routes (changeable at runtime,
//! with optional delays) and the WebSocket upgrade on the same listener, playing frames the test emits.
//! Basic auth is checked on both. Test-only.

#![allow(dead_code, clippy::unwrap_used, clippy::expect_used, missing_docs)]

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{SinkExt as _, StreamExt as _};
use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::mpsc;
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::handshake::derive_accept_key;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::protocol::{CloseFrame, Role};

use super::{PASSWORD, Pki};

#[derive(Clone, Debug)]
pub struct Route {
    pub status: u16,
    pub body: String,
    pub delay: Duration,
}

impl Route {
    pub fn json(status: u16, value: &Value) -> Self {
        Route {
            status,
            body: value.to_string(),
            delay: Duration::ZERO,
        }
    }

    pub fn delayed(mut self, delay: Duration) -> Self {
        self.delay = delay;
        self
    }
}

#[derive(Debug, Clone)]
pub struct Request {
    pub method: String,
    pub path: String,
    pub body: String,
}

/// A stateful answer, consulted before the routes (a lobby that exists after a create, a side that moves).
pub type Handler = Arc<dyn Fn(&str, &str, &str) -> Option<Route> + Send + Sync>;

enum WsCmd {
    Text(String),
    Close(u16, String),
}

#[derive(Clone)]
pub struct FakeClient {
    pub port: u16,
    routes: Arc<Mutex<HashMap<String, Route>>>,
    handler: Arc<Mutex<Option<Handler>>>,
    pub requests: Arc<Mutex<Vec<Request>>>,
    pub ws_received: Arc<Mutex<Vec<String>>>,
    sockets: Arc<Mutex<Vec<mpsc::UnboundedSender<WsCmd>>>>,
}

impl FakeClient {
    pub fn set_route(&self, key: &str, route: Route) {
        self.routes.lock().unwrap().insert(key.to_string(), route);
    }

    pub fn set_handler(&self, handler: Handler) {
        *self.handler.lock().unwrap() = Some(handler);
    }

    /// Every write (non-GET) so far.
    pub fn writes(&self) -> Vec<Request> {
        self.requests
            .lock()
            .unwrap()
            .iter()
            .filter(|r| r.method != "GET")
            .cloned()
            .collect()
    }

    pub fn requests_to(&self, path: &str) -> usize {
        self.requests
            .lock()
            .unwrap()
            .iter()
            .filter(|r| r.path == path)
            .count()
    }

    pub fn emit(&self, uri: &str, event_type: &str, data: Value) {
        let frame =
            serde_json::json!([8, "OnJsonApiEvent", { "data": data, "eventType": event_type, "uri": uri }]);
        self.emit_raw(&frame.to_string());
    }

    pub fn emit_raw(&self, text: &str) {
        for socket in self.sockets.lock().unwrap().iter() {
            let _ = socket.send(WsCmd::Text(text.to_string()));
        }
    }

    pub fn close_sockets(&self, code: u16, reason: &str) {
        for socket in self.sockets.lock().unwrap().drain(..) {
            let _ = socket.send(WsCmd::Close(code, reason.to_string()));
        }
    }

    pub fn socket_count(&self) -> usize {
        let mut sockets = self.sockets.lock().unwrap();
        sockets.retain(|s| !s.is_closed());
        sockets.len()
    }

    pub fn frames(&self) -> Vec<String> {
        self.ws_received.lock().unwrap().clone()
    }

    pub async fn wait_for_frames(&self, count: usize) -> Vec<String> {
        for _ in 0..500 {
            let frames = self.frames();
            if frames.len() >= count {
                return frames;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!(
            "timed out waiting for {count} websocket frames, saw {:?}",
            self.frames()
        );
    }

    pub async fn wait_for_sockets(&self, count: usize) {
        for _ in 0..500 {
            if self.socket_count() >= count {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("timed out waiting for {count} sockets");
    }
}

pub async fn start_fake_client(pki: &Pki, routes: HashMap<String, Route>) -> FakeClient {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let client = FakeClient {
        port: listener.local_addr().unwrap().port(),
        routes: Arc::new(Mutex::new(routes)),
        handler: Arc::new(Mutex::new(None)),
        requests: Arc::new(Mutex::new(Vec::new())),
        ws_received: Arc::new(Mutex::new(Vec::new())),
        sockets: Arc::new(Mutex::new(Vec::new())),
    };
    let acceptor = pki.acceptor();
    let shared = client.clone();
    let expected_auth = engine::lcu::client::basic_auth(PASSWORD);
    tokio::spawn(async move {
        loop {
            let Ok((tcp, _)) = listener.accept().await else {
                return;
            };
            let acceptor = acceptor.clone();
            let shared = shared.clone();
            let expected_auth = expected_auth.clone();
            tokio::spawn(async move {
                let Ok(mut tls) = acceptor.accept(tcp).await else {
                    return;
                };
                let mut buf = Vec::new();
                let mut chunk = [0u8; 8192];
                let header_end = loop {
                    let Ok(n) = tls.read(&mut chunk).await else { return };
                    if n == 0 {
                        return;
                    }
                    buf.extend_from_slice(&chunk[..n]);
                    if let Some(at) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                        break at + 4;
                    }
                };
                let head = String::from_utf8_lossy(&buf[..header_end]).to_string();
                let mut lines = head.lines();
                let mut first = lines.next().unwrap_or_default().split(' ');
                let method = first.next().unwrap_or_default().to_string();
                let path = first.next().unwrap_or_default().to_string();
                let mut headers = HashMap::new();
                for line in lines {
                    if let Some((k, v)) = line.split_once(':') {
                        headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
                    }
                }
                let authorized = headers.get("authorization") == Some(&expected_auth);
                let upgrade = headers
                    .get("upgrade")
                    .is_some_and(|u| u.eq_ignore_ascii_case("websocket"));
                if upgrade {
                    if !authorized {
                        let _ = tls
                            .write_all(b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n")
                            .await;
                        return;
                    }
                    let key = headers.get("sec-websocket-key").cloned().unwrap_or_default();
                    let response = format!(
                        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {}\r\n\r\n",
                        derive_accept_key(key.as_bytes())
                    );
                    if tls.write_all(response.as_bytes()).await.is_err() {
                        return;
                    }
                    let ws = WebSocketStream::from_raw_socket(tls, Role::Server, None).await;
                    serve_socket(ws, shared).await;
                    return;
                }
                let length: usize = headers
                    .get("content-length")
                    .and_then(|l| l.parse().ok())
                    .unwrap_or(0);
                while buf.len() < header_end + length {
                    let Ok(n) = tls.read(&mut chunk).await else { return };
                    if n == 0 {
                        break;
                    }
                    buf.extend_from_slice(&chunk[..n]);
                }
                let request_body = String::from_utf8_lossy(&buf[header_end..]).to_string();
                shared.requests.lock().unwrap().push(Request {
                    method: method.clone(),
                    path: path.clone(),
                    body: request_body.clone(),
                });
                let handled = if authorized {
                    let handler = shared.handler.lock().unwrap().clone();
                    handler.and_then(|h| h(&method, &path, &request_body))
                } else {
                    None
                };
                let route = if let Some(route) = handled {
                    route
                } else if authorized {
                    shared.routes.lock().unwrap().get(&format!("{method} {path}")).cloned().unwrap_or(Route {
                        status: 404,
                        body: r#"{"errorCode":"RPC_ERROR","httpStatus":404,"message":"fake lcu: no such route"}"#.into(),
                        delay: Duration::ZERO,
                    })
                } else {
                    Route {
                        status: 401,
                        body: r#"{"errorCode":"UNAUTHORIZED","httpStatus":401,"message":"bad auth"}"#.into(),
                        delay: Duration::ZERO,
                    }
                };
                if !route.delay.is_zero() {
                    tokio::time::sleep(route.delay).await;
                }
                let response = format!(
                    "HTTP/1.1 {} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    route.status,
                    route.body.len(),
                    route.body
                );
                let _ = tls.write_all(response.as_bytes()).await;
                let _ = tls.shutdown().await;
            });
        }
    });
    client
}

async fn serve_socket<S>(mut ws: WebSocketStream<S>, shared: FakeClient)
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    let (tx, mut rx) = mpsc::unbounded_channel();
    shared.sockets.lock().unwrap().push(tx);
    loop {
        tokio::select! {
            frame = ws.next() => match frame {
                Some(Ok(Message::Text(text))) => shared.ws_received.lock().unwrap().push(text.to_string()),
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => return,
                Some(Ok(_)) => {}
            },
            cmd = rx.recv() => match cmd {
                Some(WsCmd::Text(text)) => {
                    if ws.send(Message::text(text)).await.is_err() {
                        return;
                    }
                }
                Some(WsCmd::Close(code, reason)) => {
                    let _ = ws.close(Some(CloseFrame { code: CloseCode::from(code), reason: reason.into() })).await;
                    return;
                }
                None => return,
            },
        }
    }
}
