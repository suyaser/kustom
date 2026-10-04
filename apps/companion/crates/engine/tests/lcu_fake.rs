//! The bridge against an in-process fake League client (M17.5): HTTPS with basic auth through the pinned
//! verifier, typed reads of the recorded fixtures, every failure typed and never a panic, the three writes'
//! bodies equal to the TypeScript engine's goldens, the verifier refusing another CA and any name but
//! `127.0.0.1`, and the WebSocket subscribing, routing, dropping a bad frame, noticing a dead peer and
//! reconnecting.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::result_large_err,
    missing_docs
)]

mod support;

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use engine::lcu::client::LcuFailure;
use engine::lcu::events::{RoutedEvent, route};
use engine::lcu::socket::{CloseReason, SocketMessage, SocketOptions, run_forever, run_once};
use engine::lcu::tls::client_config;
use engine::lcu::types::{CreateLobbyBody, InviteTarget, TeamId};
use engine::lcu::{Credentials, LcuClient};
use futures_util::{SinkExt as _, StreamExt as _};
use rustls::client::danger::ServerCertVerifier as _;
use rustls::pki_types::{ServerName, UnixTime};
use serde_json::{Value, json};
use support::{Canned, Pki, body, credentials, golden_body, pki, start_fake_lcu};
use tokio::net::TcpListener;
use tokio::sync::{mpsc, watch};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};

fn client(pki: &Pki, port: u16) -> LcuClient {
    LcuClient::with_verifier(&credentials(port), pki.verifier(), Duration::from_secs(5)).unwrap()
}

#[tokio::test]
async fn typed_reads_with_basic_auth() {
    let pki = pki("Fake Riot Root");
    let routes = HashMap::from([
        ("GET /lol-lobby/v2/lobby".to_string(), Canned::json(200, &body("16.17", "lobby--two-players"))),
        ("GET /lol-patch/v1/game-version".to_string(), Canned::json(200, &body("16.17", "game-version"))),
        (
            "GET /lol-end-of-game/v1/eog-stats-block".to_string(),
            Canned::json(200, &body("16.17", "eog-stats-block")),
        ),
        (
            "GET /lol-match-history/v1/products/lol/34151cbd-d9f8-5dad-9dc8-c6a8e253c0de/matches?begIndex=0&endIndex=20".to_string(),
            Canned::json(200, &body("16.17", "match-history")),
        ),
    ]);
    let fake = start_fake_lcu(&pki, routes).await;
    let c = client(&pki, fake.port);

    let lobby = c.lobby().await.unwrap();
    assert_eq!(lobby.value.members.len(), 2);
    assert_eq!(
        lobby.raw,
        body("16.17", "lobby--two-players"),
        "the raw JSON rides beside the typed value"
    );
    assert!(c.game_version().await.unwrap().value.starts_with("16.17"));
    let eog = c.eog_stats_block().await.unwrap();
    assert_eq!(eog.value.game_id, 4000969091);
    let history = c
        .match_history("34151cbd-d9f8-5dad-9dc8-c6a8e253c0de", 0, 20)
        .await
        .unwrap();
    assert_eq!(history.value.games.games.len(), 21);

    let requests = fake.requests.lock().unwrap().clone();
    assert!(
        requests.iter().all(|r| r.authorization.as_deref()
            == Some(engine::lcu::client::basic_auth(support::PASSWORD).as_str()))
    );
}

#[tokio::test]
async fn failures_are_typed_never_panics() {
    let pki = pki("Fake Riot Root");
    let routes = HashMap::from([
        (
            "GET /lol-gameflow/v1/gameflow-phase".to_string(),
            Canned {
                status: 200,
                body: "not json".into(),
            },
        ),
        (
            "GET /lol-gameflow/v1/session".to_string(),
            Canned::json(200, &json!({ "phase": "Lobby" })),
        ),
    ]);
    let fake = start_fake_lcu(&pki, routes).await;
    let c = client(&pki, fake.port);

    match c.lobby().await {
        Err(LcuFailure::Http {
            status: 404, message, ..
        }) => assert_eq!(message.as_deref(), Some("fake lcu: no such route")),
        other => panic!("{other:?}"),
    }
    assert_eq!(
        c.gameflow_phase().await,
        Err(LcuFailure::Malformed { status: 200 })
    );
    assert!(matches!(
        c.gameflow_session().await,
        Err(LcuFailure::Schema { status: 200, .. })
    ));

    let wrong_password = Credentials {
        password: "nope".into(),
        ..credentials(fake.port)
    };
    let c = LcuClient::with_verifier(&wrong_password, pki.verifier(), Duration::from_secs(5)).unwrap();
    assert!(matches!(
        c.lobby().await,
        Err(LcuFailure::Http { status: 401, .. })
    ));

    // Nothing listening: a network failure, not a panic.
    let closed = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = closed.local_addr().unwrap().port();
    drop(closed);
    let c = client(&pki, port);
    assert!(matches!(
        c.lobby().await,
        Err(LcuFailure::Network { tls: false, .. })
    ));
}

#[tokio::test]
async fn a_certificate_from_another_ca_is_refused() {
    let real = pki("Fake Riot Root");
    let impostor = pki("Some Other CA");
    let fake = start_fake_lcu(&impostor, HashMap::new()).await;
    let pinned_to_real = client(&real, fake.port);
    match pinned_to_real.lobby().await {
        Err(LcuFailure::Network { tls: true, .. }) => {}
        other => panic!("expected a TLS refusal, got {other:?}"),
    }
    assert!(
        fake.requests.lock().unwrap().is_empty(),
        "no request may reach a server that failed the pin"
    );
}

#[test]
fn the_verifier_refuses_any_name_but_127_0_0_1() {
    let pki = pki("Fake Riot Root");
    let verifier = pki.verifier();
    let now = UnixTime::since_unix_epoch(SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap());
    let ok = verifier.verify_server_cert(
        &pki.leaf,
        &[],
        &ServerName::try_from("127.0.0.1").unwrap(),
        &[],
        now,
    );
    assert!(ok.is_ok(), "{ok:?}");
    for name in ["localhost", "127.0.0.2", "10.1.2.3", "example.com", "::1"] {
        let refused =
            verifier.verify_server_cert(&pki.leaf, &[], &ServerName::try_from(name).unwrap(), &[], now);
        assert!(refused.is_err(), "{name} must be refused");
    }
    // And the Riot-pinned verifier refuses the test leaf even for 127.0.0.1.
    let riot = engine::lcu::tls::LcuCertVerifier::riot().unwrap();
    assert!(
        riot.verify_server_cert(
            &pki.leaf,
            &[],
            &ServerName::try_from("127.0.0.1").unwrap(),
            &[],
            now
        )
        .is_err()
    );
}

#[tokio::test]
async fn write_bodies_match_the_typescript_goldens() {
    let pki = pki("Fake Riot Root");
    let routes = HashMap::from([
        (
            "POST /lol-lobby/v2/lobby".to_string(),
            Canned::json(200, &body("16.18", "create-lobby")),
        ),
        (
            "POST /lol-lobby/v2/lobby/invitations".to_string(),
            Canned::json(200, &body("16.18", "lobby-invitations")),
        ),
        (
            "POST /lol-lobby/v2/lobby/team/TEAM2".to_string(),
            Canned {
                status: 204,
                body: String::new(),
            },
        ),
    ]);
    let fake = start_fake_lcu(&pki, routes).await;
    let c = client(&pki, fake.port);

    let create = CreateLobbyBody::summoners_rift("customs-verify", "golden-pw-4821", 3110);
    assert_eq!(c.create_lobby(&create).await.unwrap().status, 200);
    assert_eq!(
        c.invite(&InviteTarget::SummonerId {
            to_summoner_id: 55838205
        })
        .await
        .unwrap()
        .status,
        200
    );
    assert_eq!(c.switch_side(TeamId::Red).await.unwrap().status, 204);

    let requests = fake.requests.lock().unwrap().clone();
    let sent = |i: usize| -> Value {
        if requests[i].body.is_empty() {
            Value::Null
        } else {
            serde_json::from_str(&requests[i].body).unwrap()
        }
    };
    assert_eq!(
        (requests[0].method.as_str(), requests[0].path.as_str()),
        ("POST", "/lol-lobby/v2/lobby")
    );
    assert_eq!(sent(0), golden_body("lcu-create-lobby--create-lobby"));
    assert_eq!(sent(1), golden_body("lcu-invite--lobby-invitations"));
    assert_eq!(requests[2].path, "/lol-lobby/v2/lobby/team/TEAM2");
    assert_eq!(sent(2), golden_body("lcu-switch-side--lobby-team"));
    // The empty password goes as null, as the dialog sends it.
    let blank = serde_json::to_value(CreateLobbyBody::summoners_rift("x", "", 3110)).unwrap();
    assert_eq!(blank["customGameLobby"]["lobbyPassword"], Value::Null);
}

/// A scripted WebSocket server: checks auth, waits for the subscribe frame, then runs `script` per connection.
async fn start_fake_ws<F, Fut>(pki: &Pki, script: F) -> (u16, mpsc::UnboundedReceiver<String>)
where
    F: Fn(
            usize,
            tokio_tungstenite::WebSocketStream<tokio_rustls::server::TlsStream<tokio::net::TcpStream>>,
        ) -> Fut
        + Send
        + Sync
        + 'static,
    Fut: std::future::Future<Output = ()> + Send,
{
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let acceptor = pki.acceptor();
    let (seen_tx, seen_rx) = mpsc::unbounded_channel();
    let script = Arc::new(script);
    tokio::spawn(async move {
        let mut n = 0;
        loop {
            let Ok((tcp, _)) = listener.accept().await else {
                return;
            };
            let Ok(tls) = acceptor.accept(tcp).await else {
                continue;
            };
            let expected = engine::lcu::client::basic_auth(support::PASSWORD);
            let auth_ok = Arc::new(std::sync::atomic::AtomicBool::new(false));
            let flag = auth_ok.clone();
            let mut ws = tokio_tungstenite::accept_hdr_async(tls, move |req: &Request, resp: Response| {
                let ok = req.headers().get("authorization").and_then(|v| v.to_str().ok())
                    == Some(expected.as_str());
                flag.store(ok, std::sync::atomic::Ordering::SeqCst);
                Ok(resp)
            })
            .await
            .expect("upgrade");
            assert!(
                auth_ok.load(std::sync::atomic::Ordering::SeqCst),
                "the socket must carry basic auth"
            );
            let Some(Ok(Message::Text(first))) = ws.next().await else {
                panic!("no subscribe frame")
            };
            seen_tx.send(first.to_string()).unwrap();
            let script = script.clone();
            let index = n;
            n += 1;
            tokio::spawn(async move { script(index, ws).await });
        }
    });
    (port, seen_rx)
}

#[tokio::test]
async fn socket_subscribes_routes_drops_bad_frames_and_reconnects() {
    let pki = pki("Fake Riot Root");
    let lobby = body("16.17", "lobby");
    let (port, mut subscribes) = start_fake_ws(&pki, move |index, mut ws| {
        let lobby = lobby.clone();
        async move {
            ws.send(Message::text("")).await.unwrap();
            ws.send(Message::text("{not a frame")).await.unwrap();
            let frame = json!([8, "OnJsonApiEvent", { "data": lobby, "eventType": "Update", "uri": "/lol-lobby/v2/lobby" }]);
            ws.send(Message::text(frame.to_string())).await.unwrap();
            if index == 0 {
                ws.close(None).await.unwrap();
            } else {
                tokio::time::sleep(Duration::from_secs(30)).await;
            }
        }
    })
    .await;

    let tls = Arc::new(client_config(pki.verifier()).unwrap());
    let (tx, mut rx) = mpsc::channel(32);
    let (stop_tx, stop_rx) = watch::channel(false);
    let creds = credentials(port);
    let runner = tokio::spawn(run_forever(
        move || {
            let creds = creds.clone();
            async move { Some(creds) }
        },
        tls,
        SocketOptions {
            heartbeat: Duration::ZERO,
            heartbeat_timeout: Duration::from_secs(1),
        },
        (Duration::from_millis(10), Duration::from_millis(50)),
        tx,
        stop_rx,
    ));

    let mut seen = Vec::new();
    while seen.len() < 5 {
        let message = tokio::time::timeout(Duration::from_secs(10), rx.recv())
            .await
            .unwrap()
            .unwrap();
        seen.push(message);
    }
    assert_eq!(seen[0], SocketMessage::Open { port });
    let SocketMessage::Event(event) = &seen[1] else {
        panic!("{:?}", seen[1])
    };
    let RoutedEvent::Lobby {
        lobby: Some(lobby), ..
    } = route(event).unwrap()
    else {
        panic!()
    };
    assert_eq!(lobby.party_id, "e3c69392-a134-43cb-97ae-8add18c72494");
    assert!(matches!(
        seen[2],
        SocketMessage::Closed(CloseReason::ClosedByPeer { .. })
    ));
    assert_eq!(seen[3], SocketMessage::Open { port }, "reconnected");
    assert!(matches!(seen[4], SocketMessage::Event(_)));
    assert_eq!(subscribes.recv().await.unwrap(), r#"[5,"OnJsonApiEvent"]"#);
    assert_eq!(subscribes.recv().await.unwrap(), r#"[5,"OnJsonApiEvent"]"#);

    stop_tx.send(true).unwrap();
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(5), runner)
            .await
            .unwrap()
            .unwrap(),
        CloseReason::Stopped
    );
}

#[tokio::test]
async fn a_silent_peer_is_declared_dead_by_the_heartbeat() {
    let pki = pki("Fake Riot Root");
    // Never reads after the subscribe, so it never answers a ping.
    let (port, _subscribes) = start_fake_ws(&pki, |_, ws| async move {
        tokio::time::sleep(Duration::from_secs(30)).await;
        drop(ws);
    })
    .await;
    let tls = Arc::new(client_config(pki.verifier()).unwrap());
    let (tx, mut rx) = mpsc::channel(8);
    let (_stop_tx, mut stop_rx) = watch::channel(false);
    let options = SocketOptions {
        heartbeat: Duration::from_millis(50),
        heartbeat_timeout: Duration::from_millis(100),
    };
    let reason = tokio::time::timeout(
        Duration::from_secs(5),
        run_once(&credentials(port), tls, options, &tx, &mut stop_rx),
    )
    .await
    .unwrap();
    assert_eq!(reason, CloseReason::Heartbeat);
    assert_eq!(rx.recv().await, Some(SocketMessage::Open { port }));
}

#[tokio::test]
async fn the_socket_refuses_an_impostor_certificate() {
    let real = pki("Fake Riot Root");
    let impostor = pki("Some Other CA");
    let (port, _s) = start_fake_ws(&impostor, |_, ws| async move { drop(ws) }).await;
    let tls = Arc::new(client_config(real.verifier()).unwrap());
    let (tx, _rx) = mpsc::channel(8);
    let (_stop_tx, mut stop_rx) = watch::channel(false);
    let reason = run_once(
        &credentials(port),
        tls,
        SocketOptions::default(),
        &tx,
        &mut stop_rx,
    )
    .await;
    assert!(
        matches!(&reason, CloseReason::ConnectFailed(r) if r.starts_with("tls")),
        "{reason:?}"
    );
}
