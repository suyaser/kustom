//! The API client (M17.6): envelope, headers, per-route attempt counts, retry rules (network and 5xx only),
//! refusals, stop, and the bodies JSON-equal to the TypeScript goldens. Ports `api.test.ts` and
//! `identity.test.ts`; the clock is tokio's, paused, so the backoff waits take no real time.

#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use engine::api::identity::{IdentityOutcome, check_identity};
use engine::api::transport::{HttpRequest, Method, ReqwestTransport};
use engine::api::wire::{
    BackfillScanRequest, CommandAck, CommandNack, CommandsPoll, GamePayload, LobbyPayload, LobbyStatus,
    PairMode, PairRequest, RankPayload,
};
use engine::api::{ApiClient, ApiClientOptions, ApiFailure, attempts, node_platform};
use engine::config::CompanionToken;
use engine::test_support::{FakeTransport, respond};
use serde_json::{Value, json};

const TOKEN: &str = "TestToken_for_the_api_client_tests_00000000";

fn token() -> CompanionToken {
    CompanionToken::parse(TOKEN).unwrap()
}

fn golden_body(name: &str) -> Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/goldens")
        .join(format!("{name}.json"));
    let golden: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    golden["body"].clone()
}

fn client(transport: Arc<FakeTransport>) -> ApiClient {
    let mut options = ApiClientOptions::new("https://kustom.example/", Some(token()), transport);
    options.version = "1.0.0".into();
    ApiClient::new(options)
}

fn body_of(request: &HttpRequest) -> Value {
    serde_json::from_slice(request.body.as_deref().unwrap()).unwrap()
}

const LOBBY_OK: &str = r#"{"ok":true,"lobbyId":"3f6c2a52-6f87-4b9a-9a59-0e4f1f1b2a10","status":"open","created":true,"memberCount":2,"rosterFrozen":false,"recheckInMs":null,"ranksNeeded":["p1"],"addedLater":1}"#;
const GAME_OK: &str =
    r#"{"ok":true,"phase":"in_progress","created":false,"gameId":null,"lobbyId":null,"participants":0}"#;

#[tokio::test(start_paused = true)]
async fn a_lobby_post_sends_the_golden_body_with_every_header() {
    let fake = FakeTransport::new(|_| respond(200, LOBBY_OK));
    let api = client(fake.clone());
    let body: LobbyPayload = serde_json::from_value(golden_body("lobby--lobby")).unwrap();
    let ok = api.post_lobby(&body).await.unwrap();
    assert_eq!(ok.data.status, LobbyStatus::Open);
    assert_eq!(ok.data.recheck_in_ms, None);
    assert_eq!(ok.data.ranks_needed, ["p1"]);

    let requests = fake.requests();
    assert_eq!(requests.len(), 1);
    let request = &requests[0];
    assert_eq!(request.method, Method::Post);
    assert_eq!(request.url, "https://kustom.example/api/companion/lobby");
    assert_eq!(
        request.header("authorization"),
        Some(format!("Bearer {TOKEN}").as_str())
    );
    assert_eq!(request.header("accept"), Some("application/json"));
    assert_eq!(request.header("content-type"), Some("application/json"));
    assert_eq!(
        request.header("user-agent").unwrap(),
        format!("customs-night-companion/1.0.0 ({})", node_platform())
    );
    assert_eq!(request.timeout, Duration::from_secs(15));
    assert_eq!(body_of(request), golden_body("lobby--lobby"));
    // The Debug of a request never shows the token.
    assert!(!format!("{request:?}").contains(TOKEN));
}

#[tokio::test(start_paused = true)]
async fn every_route_body_is_json_equal_to_its_golden() {
    let fake = FakeTransport::new(|request| {
        if request.url.ends_with("/rank") {
            respond(200, r#"{"ok":true,"playerId":"x","stored":true}"#)
        } else if request.url.ends_with("/backfill/scan") {
            respond(200, r#"{"ok":true,"approved":true,"unknown":[1]}"#)
        } else if request.url.ends_with("/ack") || request.url.ends_with("/nack") {
            respond(200, r#"{"ok":true}"#)
        } else {
            respond(200, GAME_OK)
        }
    });
    let api = client(fake.clone());
    let in_progress: GamePayload =
        serde_json::from_value(golden_body("game--in-progress--gameflow-session")).unwrap();
    api.post_in_progress(&in_progress).await.unwrap();
    let eog = golden_body("game--eog--eog-stats-block--at-connect");
    api.post_queued_game(&eog).await.unwrap();
    let rank: RankPayload = serde_json::from_value(golden_body("rank--current-ranked-stats--own")).unwrap();
    api.post_rank(&rank).await.unwrap();
    let scan: BackfillScanRequest =
        serde_json::from_value(golden_body("backfill-scan--match-history")).unwrap();
    assert_eq!(api.backfill_scan(&scan).await.unwrap().data.unknown, [1]);
    let ack: CommandAck = serde_json::from_value(golden_body("command-ack--create-lobby")).unwrap();
    api.ack("7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", &ack)
        .await
        .unwrap();
    let nack: CommandNack = serde_json::from_value(golden_body("command-nack--unknown-kind")).unwrap();
    api.nack("7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", &nack)
        .await
        .unwrap();

    let requests = fake.requests();
    let bodies: Vec<Value> = requests.iter().map(body_of).collect();
    assert_eq!(bodies[0], golden_body("game--in-progress--gameflow-session"));
    assert_eq!(bodies[1], eog);
    assert_eq!(bodies[2], golden_body("rank--current-ranked-stats--own"));
    assert_eq!(bodies[3], golden_body("backfill-scan--match-history"));
    assert_eq!(bodies[4], golden_body("command-ack--create-lobby"));
    assert_eq!(bodies[5], golden_body("command-nack--unknown-kind"));
    assert!(
        requests[4]
            .url
            .ends_with("/api/companion/commands/7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d/ack")
    );
}

#[tokio::test(start_paused = true)]
async fn the_poll_and_me_have_no_body() {
    let fake = FakeTransport::new(|request| {
        if request.url.contains("/commands?") {
            respond(200, r#"{"ok":true,"commands":[]}"#)
        } else {
            respond(
                200,
                r#"{"ok":true,"puuid":"p","playerId":"u","displayName":null,"group":{"id":"g","slug":"s","name":"N"}}"#,
            )
        }
    });
    let api = client(fake.clone());
    api.poll_commands(CommandsPoll {
        client_connected: false,
    })
    .await
    .unwrap();
    let identity = check_identity(&api).await;
    assert!(matches!(identity, IdentityOutcome::Ok { group: Some(ref g), .. } if g.id == "g"));
    let requests = fake.requests();
    assert_eq!(
        requests[0].url,
        "https://kustom.example/api/companion/commands?clientConnected=false"
    );
    assert_eq!(requests[0].method, Method::Get);
    assert!(
        requests
            .iter()
            .all(|r| r.body.is_none() && r.header("content-type").is_none())
    );
}

/// How many requests a call makes against an API that always answers `status`.
async fn attempts_against(status: u16, call: impl AsyncFnOnce(&ApiClient)) -> usize {
    let fake = FakeTransport::new(move |_| respond(status, r#"{"ok":false,"error":"nope"}"#));
    let api = client(fake.clone());
    call(&api).await;
    fake.requests().len()
}

#[tokio::test(start_paused = true)]
async fn attempt_counts_per_route_match_the_typescript_engine() {
    let lobby: LobbyPayload = serde_json::from_value(golden_body("lobby--lobby")).unwrap();
    let game: GamePayload =
        serde_json::from_value(golden_body("game--in-progress--gameflow-session")).unwrap();
    let rank: RankPayload = serde_json::from_value(golden_body("rank--current-ranked-stats--own")).unwrap();
    let scan = BackfillScanRequest { game_ids: vec![1] };
    let nack = CommandNack {
        error: "not_connected: x".into(),
        retryable: true,
    };
    let pair = PairRequest {
        code: "K7QM4X".into(),
        puuid: "p".into(),
        mode: Some(PairMode::Host),
    };

    assert_eq!(
        attempts_against(503, async |api| drop(api.post_in_progress(&game).await)).await,
        4
    );
    assert_eq!(
        attempts_against(503, async |api| drop(api.post_lobby(&lobby).await)).await,
        1
    );
    assert_eq!(
        attempts_against(503, async |api| drop(api.post_queued_game(&game).await)).await,
        1
    );
    assert_eq!(
        attempts_against(503, async |api| drop(api.post_rank(&rank).await)).await,
        2
    );
    assert_eq!(
        attempts_against(503, async |api| drop(api.backfill_scan(&scan).await)).await,
        2
    );
    assert_eq!(
        attempts_against(503, async |api| drop(api.nack("id", &nack).await)).await,
        2
    );
    assert_eq!(
        attempts_against(503, async |api| drop(
            api.poll_commands(CommandsPoll {
                client_connected: true
            })
            .await
        ))
        .await,
        1
    );
    assert_eq!(attempts_against(503, async |api| drop(api.me().await)).await, 1);
    assert_eq!(
        attempts_against(503, async |api| drop(api.pair(&pair).await)).await,
        1
    );
    assert_eq!(attempts::IN_PROGRESS, 4);

    // Never on a 4xx.
    for status in [400, 401, 403, 404, 409, 422, 429] {
        assert_eq!(
            attempts_against(status, async |api| drop(api.post_in_progress(&game).await)).await,
            1
        );
    }
}

#[tokio::test(start_paused = true)]
async fn a_network_error_then_a_5xx_then_success_is_three_attempts() {
    let calls = Arc::new(AtomicUsize::new(0));
    let counter = calls.clone();
    let fake = FakeTransport::new(move |_| match counter.fetch_add(1, Ordering::SeqCst) {
        0 => Err("connect failed: Connection refused".into()),
        1 => respond(502, "<html>bad gateway</html>"),
        _ => respond(200, GAME_OK),
    });
    let api = client(fake.clone());
    let game: GamePayload =
        serde_json::from_value(golden_body("game--in-progress--gameflow-session")).unwrap();
    let ok = api.post_in_progress(&game).await.unwrap();
    assert_eq!(ok.status, 200);
    assert_eq!(fake.requests().len(), 3);
}

#[tokio::test(start_paused = true)]
async fn failures_are_typed() {
    let game: GamePayload =
        serde_json::from_value(golden_body("game--in-progress--gameflow-session")).unwrap();

    let api = client(FakeTransport::new(|_| {
        respond(
            400,
            r#"{"ok":false,"error":"Invalid body","issues":[{"path":"gameId","message":"Required"}]}"#,
        )
    }));
    match api.post_queued_game(&game).await.unwrap_err() {
        ApiFailure::Http {
            status,
            error,
            issues,
            attempts,
        } => {
            assert_eq!(
                (status, error.as_str(), issues.len(), attempts),
                (400, "Invalid body", 1, 1)
            );
        }
        other => panic!("{other:?}"),
    }

    let api = client(FakeTransport::new(|_| respond(404, "<html>not found</html>")));
    let failure = api.post_queued_game(&game).await.unwrap_err();
    assert_eq!(failure.describe(), "HTTP 404 HTTP 404");

    let api = client(FakeTransport::new(|_| respond(200, "<html>ok</html>")));
    assert!(matches!(
        api.post_queued_game(&game).await.unwrap_err(),
        ApiFailure::Malformed { status: 200, .. }
    ));

    let api = client(FakeTransport::new(|_| {
        respond(200, r#"{"ok":true,"phase":"later"}"#)
    }));
    assert!(matches!(
        api.post_queued_game(&game).await.unwrap_err(),
        ApiFailure::Schema { .. }
    ));

    // A 2xx whose envelope says ok: false is not a success.
    let api = client(FakeTransport::new(|_| {
        respond(200, r#"{"ok":false,"error":"x"}"#)
    }));
    assert!(matches!(
        api.post_queued_game(&game).await.unwrap_err(),
        ApiFailure::Schema { .. }
    ));

    // More than ten commands: the page is refused whole.
    let commands: Vec<Value> = (0..11)
        .map(|i| json!({ "id": format!("{i}"), "kind": "invite", "payload": {}, "createdAt": "x", "expiresAt": "y" }))
        .collect();
    let page = json!({ "ok": true, "commands": commands }).to_string();
    let api = client(FakeTransport::new(move |_| respond(200, &page)));
    assert!(matches!(
        api.poll_commands(CommandsPoll {
            client_connected: true
        })
        .await
        .unwrap_err(),
        ApiFailure::Schema { .. }
    ));
}

#[tokio::test(start_paused = true)]
async fn a_refused_token_is_reported_once() {
    let reported = Arc::new(AtomicUsize::new(0));
    let seen = reported.clone();
    let fake = FakeTransport::new(|_| respond(403, r#"{"ok":false,"error":"Not a member of this group"}"#));
    let mut options = ApiClientOptions::new("https://kustom.example", Some(token()), fake);
    options.on_refused = Some(Arc::new(move |status| {
        assert_eq!(status, 403);
        seen.fetch_add(1, Ordering::SeqCst);
    }));
    let api = ApiClient::new(options);
    let identity = check_identity(&api).await;
    assert_eq!(
        identity,
        IdentityOutcome::Refused {
            status: 403,
            error: "Not a member of this group".into()
        }
    );
    let _ = api.me().await;
    assert_eq!(reported.load(Ordering::SeqCst), 1);
}

#[tokio::test(start_paused = true)]
async fn identity_unavailable_for_anything_but_a_refusal() {
    let api = client(FakeTransport::new(|_| respond(404, "")));
    assert!(matches!(
        check_identity(&api).await,
        IdentityOutcome::Unavailable { .. }
    ));
    let api = client(FakeTransport::new(|_| Err("timeout".into())));
    assert_eq!(
        check_identity(&api).await,
        IdentityOutcome::Unavailable {
            reason: "timeout".into()
        }
    );
}

#[tokio::test(start_paused = true)]
async fn stop_ends_a_retry_wait_and_sends_nothing_more() {
    let fake = FakeTransport::new(|_| respond(503, ""));
    let api = Arc::new(client(fake.clone()));
    let game: GamePayload =
        serde_json::from_value(golden_body("game--in-progress--gameflow-session")).unwrap();
    let running = {
        let api = api.clone();
        tokio::spawn(async move { api.post_in_progress(&game).await })
    };
    // Let the first attempt fail and the wait begin.
    tokio::time::sleep(Duration::from_millis(10)).await;
    api.stop();
    let result = tokio::time::timeout(Duration::from_millis(50), running)
        .await
        .unwrap()
        .unwrap();
    assert!(result.is_err());
    assert_eq!(fake.requests().len(), 1);
    assert!(api.me().await.is_err());
    assert_eq!(fake.requests().len(), 1, "a stopped client sends nothing");
}

#[tokio::test(start_paused = true)]
async fn pairing_reads_a_token_or_a_refusal_never_both() {
    let pair: PairRequest = serde_json::from_value(golden_body("pair--host")).unwrap();
    let token_answer =
        format!(r#"{{"ok":true,"group":{{"id":"g","slug":"s","name":"N"}},"companionToken":"{TOKEN}"}}"#);
    let fake = FakeTransport::new(move |_| respond(200, &token_answer));
    let api = ApiClient::new(ApiClientOptions::new(
        "https://kustom.example",
        None,
        fake.clone(),
    ));
    let ok = api.pair(&pair).await.unwrap();
    assert_eq!(
        ok.data.companion_token.as_ref().map(CompanionToken::expose),
        Some(TOKEN)
    );
    assert!(!format!("{:?}", ok.data).contains(TOKEN));
    let request = &fake.requests()[0];
    assert_eq!(request.header("authorization"), None);
    assert_eq!(body_of(request), golden_body("pair--host"));

    let both = format!(
        r#"{{"ok":true,"group":{{"id":"g","slug":"s","name":"N"}},"companionToken":"{TOKEN}","hostRefusal":"no"}}"#
    );
    let api = ApiClient::new(ApiClientOptions::new(
        "https://kustom.example",
        None,
        FakeTransport::new(move |_| respond(200, &both)),
    ));
    assert!(matches!(
        api.pair(&pair).await.unwrap_err(),
        ApiFailure::Schema { .. }
    ));
}

/// Redirects are off: a 302 is a failure the caller sees, and the bearer token never follows it.
#[tokio::test]
async fn the_reqwest_transport_does_not_follow_redirects() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = tokio::spawn(async move {
        let mut accepted = 0;
        while let Ok(Ok((mut socket, _))) =
            tokio::time::timeout(Duration::from_millis(500), listener.accept()).await
        {
            accepted += 1;
            let mut buffer = [0_u8; 4096];
            let _ = socket.read(&mut buffer).await.unwrap();
            let response = format!(
                "HTTP/1.1 302 Found\r\nlocation: http://127.0.0.1:{port}/elsewhere\r\ncontent-length: 0\r\nconnection: close\r\n\r\n"
            );
            socket.write_all(response.as_bytes()).await.unwrap();
        }
        accepted
    });
    let transport = Arc::new(ReqwestTransport::new().unwrap());
    let api = ApiClient::new(ApiClientOptions::new(
        format!("http://127.0.0.1:{port}"),
        Some(token()),
        transport,
    ));
    let failure = api.me().await.unwrap_err();
    assert_eq!(failure.status(), Some(302));
    assert_eq!(server.await.unwrap(), 1, "the redirect was not followed");
}

/// The real transport, against a one-shot HTTP server on loopback: the headers reach the wire.
#[tokio::test]
async fn the_reqwest_transport_speaks_http() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut seen = Vec::new();
        let mut buffer = [0_u8; 4096];
        loop {
            let n = socket.read(&mut buffer).await.unwrap();
            seen.extend_from_slice(&buffer[..n]);
            let text = String::from_utf8_lossy(&seen).to_string();
            if let Some(end) = text.find("\r\n\r\n") {
                let length: usize = text
                    .lines()
                    .find_map(|l| {
                        l.to_ascii_lowercase()
                            .strip_prefix("content-length:")
                            .map(|v| v.trim().to_owned())
                    })
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(0);
                if seen.len() >= end + 4 + length {
                    break;
                }
            }
            if n == 0 {
                break;
            }
        }
        let body = r#"{"ok":true,"playerId":"x","stored":false}"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
            body.len()
        );
        socket.write_all(response.as_bytes()).await.unwrap();
        String::from_utf8_lossy(&seen).to_string()
    });
    let transport = Arc::new(ReqwestTransport::new().unwrap());
    let mut options = ApiClientOptions::new(format!("http://127.0.0.1:{port}"), Some(token()), transport);
    options.version = "1.2.3".into();
    let api = ApiClient::new(options);
    let rank: RankPayload = serde_json::from_value(golden_body("rank--current-ranked-stats--own")).unwrap();
    let ok = api.post_rank(&rank).await.unwrap();
    assert!(!ok.data.stored);
    let request = server.await.unwrap().to_ascii_lowercase();
    assert!(
        request.starts_with("post /api/companion/rank http/1.1"),
        "{request}"
    );
    assert!(request.contains(&format!(
        "user-agent: customs-night-companion/1.2.3 ({})",
        node_platform()
    )));
    assert!(request.contains(&format!("authorization: bearer {}", TOKEN.to_ascii_lowercase())));
}
