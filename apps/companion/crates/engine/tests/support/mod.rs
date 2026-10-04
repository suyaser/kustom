//! Test-only stand-ins for the League client (M17.5): a throwaway CA standing in for Riot's root, a leaf
//! for `127.0.0.1` signed by it, a minimal HTTPS server answering canned routes and recording requests, a
//! WebSocket server playing scripted frames, and readers for the recorded fixtures in `packages/lcu`.
//! Nothing here talks to a real client.

#![allow(dead_code, clippy::unwrap_used, clippy::expect_used, missing_docs)]

pub mod fake_client;
pub mod watch_kit;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use engine::lcu::tls::{LcuCertVerifier, roots_from_pem};
use rcgen::{BasicConstraints, CertificateParams, CertifiedIssuer, DnType, IsCa, KeyPair, SanType};
use rustls::ServerConfig;
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio_rustls::TlsAcceptor;

pub const PASSWORD: &str = "fake-lockfile-password-Q7";

pub fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../../packages/lcu/fixtures")
}

/// `{ body, request, ... }` envelope of one fixture.
pub fn envelope(patch: &str, id: &str) -> Value {
    let path = fixtures_dir().join(patch).join(format!("{id}.json"));
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    serde_json::from_str(&text).unwrap()
}

pub fn body(patch: &str, id: &str) -> Value {
    envelope(patch, id)["body"].clone()
}

pub fn golden_body(name: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/goldens")
        .join(format!("{name}.json"));
    let golden: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    golden["body"].clone()
}

/// A CA and a server certificate for `127.0.0.1` it signed.
pub struct Pki {
    pub ca_pem: String,
    pub leaf: CertificateDer<'static>,
    pub key: PrivateKeyDer<'static>,
}

pub fn pki(common_name: &str) -> Pki {
    let mut ca_params = CertificateParams::new(Vec::<String>::new()).unwrap();
    ca_params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
    ca_params.distinguished_name.push(DnType::CommonName, common_name);
    let ca = CertifiedIssuer::self_signed(ca_params, KeyPair::generate().unwrap()).unwrap();
    let mut leaf_params = CertificateParams::new(Vec::<String>::new()).unwrap();
    leaf_params.subject_alt_names = vec![SanType::IpAddress("127.0.0.1".parse().unwrap())];
    leaf_params
        .distinguished_name
        .push(DnType::CommonName, "127.0.0.1");
    let leaf_key = KeyPair::generate().unwrap();
    let leaf = leaf_params.signed_by(&leaf_key, &ca).unwrap();
    Pki {
        ca_pem: ca.pem(),
        leaf: leaf.der().clone(),
        key: PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(leaf_key.serialize_der())),
    }
}

impl Pki {
    pub fn verifier(&self) -> LcuCertVerifier {
        LcuCertVerifier::pinned_to(roots_from_pem(&self.ca_pem).unwrap()).unwrap()
    }

    pub fn acceptor(&self) -> TlsAcceptor {
        let config = ServerConfig::builder_with_provider(engine::lcu::tls::provider())
            .with_safe_default_protocol_versions()
            .unwrap()
            .with_no_client_auth()
            .with_single_cert(vec![self.leaf.clone()], self.key.clone_key())
            .unwrap();
        TlsAcceptor::from(Arc::new(config))
    }
}

#[derive(Debug, Clone)]
pub struct Recorded {
    pub method: String,
    pub path: String,
    pub authorization: Option<String>,
    pub body: String,
}

#[derive(Clone)]
pub struct Canned {
    pub status: u16,
    pub body: String,
}

impl Canned {
    pub fn json(status: u16, value: &Value) -> Self {
        Canned {
            status,
            body: value.to_string(),
        }
    }
}

/// A one-request-per-connection HTTPS server on `127.0.0.1`. Unknown routes answer the client's 404 body;
/// a wrong `Authorization` answers 401.
pub struct FakeLcu {
    pub port: u16,
    pub requests: Arc<Mutex<Vec<Recorded>>>,
}

pub async fn start_fake_lcu(pki: &Pki, routes: HashMap<String, Canned>) -> FakeLcu {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let requests = Arc::new(Mutex::new(Vec::new()));
    let acceptor = pki.acceptor();
    let recorded = requests.clone();
    let expected_auth = engine::lcu::client::basic_auth(PASSWORD);
    tokio::spawn(async move {
        loop {
            let Ok((tcp, _)) = listener.accept().await else {
                return;
            };
            let acceptor = acceptor.clone();
            let routes = routes.clone();
            let recorded = recorded.clone();
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
                let mut length = 0usize;
                let mut authorization = None;
                for line in lines {
                    if let Some((k, v)) = line.split_once(':') {
                        match k.trim().to_ascii_lowercase().as_str() {
                            "content-length" => length = v.trim().parse().unwrap_or(0),
                            "authorization" => authorization = Some(v.trim().to_string()),
                            _ => {}
                        }
                    }
                }
                while buf.len() < header_end + length {
                    let Ok(n) = tls.read(&mut chunk).await else { return };
                    if n == 0 {
                        break;
                    }
                    buf.extend_from_slice(&chunk[..n]);
                }
                let body = String::from_utf8_lossy(&buf[header_end..]).to_string();
                recorded.lock().unwrap().push(Recorded {
                    method: method.clone(),
                    path: path.clone(),
                    authorization: authorization.clone(),
                    body,
                });
                let answer = if authorization.as_deref() != Some(expected_auth.as_str()) {
                    Canned {
                        status: 401,
                        body: r#"{"errorCode":"UNAUTHORIZED","httpStatus":401,"message":"bad auth"}"#.into(),
                    }
                } else {
                    routes.get(&format!("{method} {path}")).cloned().unwrap_or(Canned {
                        status: 404,
                        body: r#"{"errorCode":"RPC_ERROR","httpStatus":404,"message":"fake lcu: no such route"}"#.into(),
                    })
                };
                let response = format!(
                    "HTTP/1.1 {} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    answer.status,
                    answer.body.len(),
                    answer.body
                );
                let _ = tls.write_all(response.as_bytes()).await;
                let _ = tls.shutdown().await;
            });
        }
    });
    FakeLcu { port, requests }
}

pub fn credentials(port: u16) -> engine::lcu::Credentials {
    engine::lcu::Credentials {
        name: "LeagueClient".into(),
        pid: 1,
        port,
        password: PASSWORD.into(),
    }
}
