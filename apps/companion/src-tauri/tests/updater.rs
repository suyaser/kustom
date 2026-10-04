//! M17.12 part 2: the updater and the restart rule.
//!
//! Part A drives the real [`App`] with a fake host, shell and updater: an update that is ready restarts only
//! when League is closed or idle in `None`, nothing is queued and no game is in progress. Part B runs the
//! real `tauri-plugin-updater` on Tauri's mock runtime against a local HTTP server, with an installer
//! signed by a throwaway minisign key made in memory: a good update becomes a card; a bad signature, a
//! network error and a 404 each make one log line and no card.

#![allow(clippy::unwrap_used, clippy::expect_used)] // tests and their helpers may unwrap

use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use engine::api::transport::{BoxFuture as TransportFuture, HttpRequest, HttpResponse, Transport};
use engine::lcu::LcuDiscovery;
use engine::watchers::connection::LeagueStatus;
use kustom_companion_lib::app::{App, Shell, Updater};
use kustom_companion_lib::host_api::{BoxFuture, Host, HostBoot, HostGroup, HostStatus};
use kustom_companion_lib::model::{TrayModel, UpdateState, View};
use kustom_companion_lib::updater::{
    FailureKind, Schedule, TauriUpdater, UpdateSource, check_once, classify,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::watch;

// =========================================================================================================
// Fakes
// =========================================================================================================

struct FakeHost {
    tx: watch::Sender<HostStatus>,
    stops: AtomicUsize,
}

impl FakeHost {
    fn new() -> Arc<Self> {
        let (tx, _rx) = watch::channel(HostStatus::default());
        Arc::new(Self {
            tx,
            stops: AtomicUsize::new(0),
        })
    }

    fn set(&self, change: impl FnOnce(&mut HostStatus)) {
        self.tx.send_modify(change);
    }
}

impl Host for FakeHost {
    fn status(&self) -> watch::Receiver<HostStatus> {
        self.tx.subscribe()
    }
    fn switch_group(&self, _group_id: String) -> BoxFuture<'_, ()> {
        Box::pin(async {})
    }
    fn retry_discovery(&self) -> BoxFuture<'_, LcuDiscovery> {
        Box::pin(async { LcuDiscovery::NotFound { searched: vec![] } })
    }
    fn retry_boot(&self) -> BoxFuture<'_, ()> {
        Box::pin(async {})
    }
    fn adopt_linked_group(&self, _group_id: String) -> BoxFuture<'_, ()> {
        Box::pin(async {})
    }
    fn stop(&self) -> BoxFuture<'_, ()> {
        self.stops.fetch_add(1, Ordering::SeqCst);
        Box::pin(async {})
    }
}

struct FakeShell;

impl Shell for FakeShell {
    fn render(&self, _view: &View) {}
    fn tray(&self, _tray: &TrayModel) {}
    fn open_url(&self, _url: &str) {}
    fn open_path(&self, _path: &Path) {}
    fn pick_folder(&self, _title: &str, _start: PathBuf) -> BoxFuture<'static, Option<PathBuf>> {
        Box::pin(async { None })
    }
    fn autostart(&self) -> Option<bool> {
        Some(false)
    }
    fn set_autostart(&self, on: bool) -> Option<bool> {
        Some(on)
    }
    fn exit(&self) {}
}

#[derive(Default)]
struct FakeUpdater {
    restarts: AtomicUsize,
}

impl Updater for FakeUpdater {
    fn restart_to_update(&self) {
        self.restarts.fetch_add(1, Ordering::SeqCst);
    }
}

struct NoNetwork;

impl Transport for NoNetwork {
    fn send(&self, _request: HttpRequest) -> TransportFuture<'_, Result<HttpResponse, String>> {
        Box::pin(async { Err("no network in this test".to_owned()) })
    }
}

struct Rig {
    app: Arc<App>,
    host: Arc<FakeHost>,
    updater: Arc<FakeUpdater>,
    _dir: tempfile::TempDir,
}

fn connected(phase: Option<&str>) -> impl FnOnce(&mut HostStatus) {
    let phase = phase.map(str::to_owned);
    move |s| {
        s.boot = HostBoot::Ready;
        s.groups = vec![HostGroup {
            id: "g1".into(),
            slug: "customs".into(),
            name: "Customs Night".into(),
        }];
        s.current_group = Some("g1".into());
        s.league = LeagueStatus::Connected {
            port: 1,
            step: engine::lcu::DiscoveryStep::RunningClient,
            patch: None,
            install_dir: None,
        };
        s.phase = phase;
    }
}

/// An app following a fake host that is Ready, League connected in `phase`.
async fn rig(phase: Option<&str>) -> Rig {
    let dir = tempfile::tempdir().unwrap();
    let host = FakeHost::new();
    host.set(connected(phase));
    let updater = Arc::new(FakeUpdater::default());
    let app = App::new(
        "1.0.0",
        dir.path().to_path_buf(),
        host.clone(),
        Arc::new(FakeShell),
        updater.clone(),
        Arc::new(NoNetwork),
        "http://127.0.0.1:9".to_owned(),
    );
    tokio::spawn(app.clone().follow());
    settle().await;
    Rig {
        app,
        host,
        updater,
        _dir: dir,
    }
}

/// Lets the follower task run.
async fn settle() {
    for _ in 0..20 {
        tokio::task::yield_now().await;
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}

fn restarts(rig: &Rig) -> usize {
    rig.updater.restarts.load(Ordering::SeqCst)
}

// =========================================================================================================
// A. The restart rule, end to end
// =========================================================================================================

#[tokio::test]
async fn ready_in_a_lobby_holds_then_restarts_when_league_is_idle() {
    let rig = rig(Some("Lobby")).await;
    rig.app.update_ready("1.0.1".into());
    settle().await;
    assert_eq!(restarts(&rig), 0, "a lobby is open: no restart");
    let card = rig.app.view().home.unwrap().update.expect("the card shows");
    assert_eq!(card.button, "Restart now");
    assert_eq!(card.line, None, "the line appears once Restart now is pressed");
    rig.app.restart_now();
    assert_eq!(
        restarts(&rig),
        0,
        "pressed while a lobby is open: scheduled, not run"
    );
    let card = rig.app.view().home.unwrap().update.expect("still a card");
    assert_eq!(card.line.as_deref(), Some("Kustom restarts after this game."));

    rig.host.set(|s| s.phase = Some("None".into()));
    settle().await;
    assert_eq!(restarts(&rig), 1, "None: the restart happens by itself");
    assert_eq!(rig.app.model().update, UpdateState::Restarting);
    settle().await;
    assert_eq!(restarts(&rig), 1, "and only once");
}

#[tokio::test]
async fn champ_select_holds() {
    let rig = rig(Some("ChampSelect")).await;
    rig.app.update_ready("1.0.1".into());
    settle().await;
    assert_eq!(restarts(&rig), 0);
    rig.host.set(|s| s.phase = Some("Matchmaking".into()));
    settle().await;
    assert_eq!(restarts(&rig), 0, "queued for a game is not idle either");
}

#[tokio::test]
async fn a_queued_block_holds_the_restart() {
    let rig = rig(None).await;
    rig.host.set(|s| {
        s.queued = 1;
        s.busy = true;
    });
    settle().await;
    rig.app.update_ready("1.0.1".into());
    settle().await;
    assert_eq!(restarts(&rig), 0, "a block is waiting to post");
    rig.app.restart_now();
    assert_eq!(
        restarts(&rig),
        0,
        "Restart now while guarded schedules, it does not restart"
    );
    assert!(matches!(rig.app.model().update, UpdateState::Scheduled { .. }));

    rig.host.set(|s| {
        s.queued = 0;
        s.busy = false;
    });
    settle().await;
    assert_eq!(restarts(&rig), 1, "the queue drained: the scheduled restart runs");
}

#[tokio::test]
async fn a_queue_alone_holds_even_if_busy_were_false() {
    let rig = rig(None).await;
    rig.host.set(|s| s.queued = 2);
    settle().await;
    rig.app.update_ready("1.0.1".into());
    settle().await;
    assert_eq!(restarts(&rig), 0);
}

#[tokio::test]
async fn in_game_holds_until_the_game_is_over_and_idle() {
    let rig = rig(Some("InProgress")).await;
    rig.app.update_ready("1.0.1".into());
    settle().await;
    assert_eq!(restarts(&rig), 0, "in game");
    rig.app.restart_now();
    settle().await;
    assert_eq!(restarts(&rig), 0, "Restart now in game is scheduled, not run");
    assert!(matches!(rig.app.model().update, UpdateState::Scheduled { .. }));

    // The game ends: the end-of-game phases are still not idle, and the block is queued.
    rig.host.set(|s| s.phase = Some("EndOfGame".into()));
    settle().await;
    assert_eq!(restarts(&rig), 0, "the end-of-game screen");
    rig.host.set(|s| {
        s.phase = Some("None".into());
        s.queued = 1;
        s.busy = true;
    });
    settle().await;
    assert_eq!(restarts(&rig), 0, "back in None but the block is not posted yet");
    rig.host.set(|s| {
        s.queued = 0;
        s.busy = false;
    });
    settle().await;
    assert_eq!(restarts(&rig), 1, "posted: now it restarts");
}

#[tokio::test]
async fn league_closed_restarts_at_once_and_restart_now_works_when_idle() {
    let rig = rig(None).await;
    rig.host
        .set(|s| s.league = LeagueStatus::NotRunning { searched: vec![] });
    settle().await;
    rig.app.update_ready("1.0.1".into());
    settle().await;
    assert_eq!(restarts(&rig), 1, "League is not open: nothing to interrupt");

    let idle = rig_idle_ready().await;
    idle.app.restart_now();
    assert_eq!(restarts(&idle), 1);
}

/// Idle League with the update ready but the automatic restart not yet taken (the card is pressed first).
async fn rig_idle_ready() -> Rig {
    let rig = rig(Some("Lobby")).await;
    rig.app.update_ready("1.0.1".into());
    settle().await;
    rig.host.set(|s| s.phase = Some("None".into()));
    // Pressing the button is the same rule; either path restarts exactly once.
    rig.app.restart_now();
    settle().await;
    rig
}

#[tokio::test]
async fn a_failed_install_drops_the_card_and_the_next_check_may_try_again() {
    let rig = rig(None).await;
    rig.app.update_ready("1.0.1".into());
    assert_eq!(rig.app.model().update, UpdateState::Restarting);
    rig.app.update_failed();
    assert_eq!(rig.app.model().update, UpdateState::None);
    assert!(rig.app.view().home.unwrap().update.is_none());
    assert!(!rig.app.update_pending());
}

// =========================================================================================================
// B. The schedule against a fake source
// =========================================================================================================

enum Answer {
    Ready(&'static str),
    UpToDate,
    Fail(FailureKind),
}

struct ScriptedSource {
    answers: Mutex<Vec<Answer>>,
    calls: AtomicUsize,
}

impl UpdateSource for ScriptedSource {
    fn check_and_download(
        &self,
    ) -> BoxFuture<'_, Result<Option<String>, kustom_companion_lib::updater::Failure>> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let answer = self.answers.lock().unwrap().remove(0);
        Box::pin(async move {
            match answer {
                Answer::Ready(v) => Ok(Some(v.to_owned())),
                Answer::UpToDate => Ok(None),
                Answer::Fail(kind) => Err(kustom_companion_lib::updater::Failure {
                    kind,
                    detail: "scripted".into(),
                }),
            }
        })
    }
}

#[tokio::test]
async fn the_schedule_waits_the_right_time_and_stops_checking_while_one_is_pending() {
    let rig = rig(Some("Lobby")).await;
    let schedule = Schedule::default();
    assert_eq!(schedule.every, Duration::from_secs(6 * 3600));
    let source = ScriptedSource {
        answers: Mutex::new(vec![
            Answer::Fail(FailureKind::Network),
            Answer::UpToDate,
            Answer::Ready("1.0.1"),
        ]),
        calls: AtomicUsize::new(0),
    };
    assert_eq!(
        check_once(&rig.app, &source, &schedule).await,
        schedule.retry,
        "failed: retry sooner"
    );
    assert!(!rig.app.update_pending());
    assert_eq!(check_once(&rig.app, &source, &schedule).await, schedule.every);
    assert_eq!(check_once(&rig.app, &source, &schedule).await, schedule.every);
    assert!(matches!(rig.app.model().update, UpdateState::Ready { .. }));
    assert_eq!(check_once(&rig.app, &source, &schedule).await, schedule.every);
    assert_eq!(
        source.calls.load(Ordering::SeqCst),
        3,
        "no fourth check while one is pending"
    );
}

// =========================================================================================================
// C. The real plugin against a local server
// =========================================================================================================

/// What the local server answers.
#[derive(Clone)]
enum Server {
    /// `latest.json` for `version`, an installer signed with `sign_key`.
    Release {
        version: &'static str,
        installer: Vec<u8>,
        signature: String,
    },
    /// Every path is 404.
    NotFound,
}

async fn serve(mode: Server) -> (String, tokio::task::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let host = base.clone();
    let task = tokio::spawn(async move {
        loop {
            let Ok((mut stream, _)) = listener.accept().await else {
                return;
            };
            let mode = mode.clone();
            let host = host.clone();
            tokio::spawn(async move {
                let mut buf = vec![0u8; 4096];
                let n = stream.read(&mut buf).await.unwrap_or(0);
                let head = String::from_utf8_lossy(&buf[..n]).to_string();
                let path = head.split_whitespace().nth(1).unwrap_or("/").to_owned();
                let (status, content_type, body): (&str, &str, Vec<u8>) = match (&mode, path.as_str()) {
                    (
                        Server::Release {
                            version, signature, ..
                        },
                        "/latest.json",
                    ) => {
                        let manifest = serde_json::json!({
                            "version": version,
                            "notes": "test",
                            "pub_date": "2026-10-04T12:00:00Z",
                            "platforms": {
                                "test-target": {
                                    "signature": signature,
                                    "url": format!("{host}/Kustom-setup.exe"),
                                }
                            }
                        });
                        ("200 OK", "application/json", manifest.to_string().into_bytes())
                    }
                    (Server::Release { installer, .. }, "/Kustom-setup.exe") => {
                        ("200 OK", "application/octet-stream", installer.clone())
                    }
                    _ => ("404 Not Found", "text/plain", b"not found".to_vec()),
                };
                let head = format!(
                    "HTTP/1.1 {status}\r\ncontent-type: {content_type}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
                    body.len()
                );
                let _ = stream.write_all(head.as_bytes()).await;
                let _ = stream.write_all(&body).await;
                let _ = stream.shutdown().await;
            });
        }
    });
    (base, task)
}

/// A throwaway key: (public key as `tauri.conf.json` wants it, a signer for installer bytes).
struct Throwaway {
    pk: minisign::PublicKey,
    sk: minisign::SecretKey,
}

impl Throwaway {
    fn new() -> Self {
        let pair = minisign::KeyPair::generate_unencrypted_keypair().unwrap();
        Self {
            pk: pair.pk,
            sk: pair.sk,
        }
    }
    fn pubkey(&self) -> String {
        STANDARD.encode(self.pk.to_box().unwrap().to_string())
    }
    fn sign(&self, bytes: &[u8]) -> String {
        let sig = minisign::sign(
            Some(&self.pk),
            &self.sk,
            Cursor::new(bytes),
            Some("timestamp:1\tfile:Kustom-setup.exe"),
            Some("throwaway test key"),
        )
        .unwrap();
        STANDARD.encode(sig.to_string())
    }
}

/// The logs of one test, one line per event.
#[derive(Clone, Default)]
struct LogCapture(Arc<Mutex<Vec<u8>>>);

impl std::io::Write for LogCapture {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(buf);
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl LogCapture {
    fn lines(&self) -> Vec<String> {
        String::from_utf8_lossy(&self.0.lock().unwrap())
            .lines()
            .map(str::to_owned)
            .collect()
    }
}

fn capture() -> (LogCapture, tracing::subscriber::DefaultGuard) {
    let log = LogCapture::default();
    let writer = log.clone();
    let subscriber = tracing_subscriber::fmt()
        .with_writer(move || writer.clone())
        .with_ansi(false)
        .with_max_level(tracing::Level::INFO)
        .finish();
    (log, tracing::subscriber::set_default(subscriber))
}

struct Plugin {
    rig: Rig,
    updater: Arc<TauriUpdater<tauri::test::MockRuntime>>,
    _mock: tauri::App<tauri::test::MockRuntime>,
}

/// The real plugin on the mock runtime, pointed at `endpoint`, trusting `pubkey`.
async fn plugin(endpoint: String, pubkey: String) -> Plugin {
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context.config_mut().plugins.0.insert(
        "updater".to_owned(),
        serde_json::json!({ "pubkey": pubkey, "endpoints": [endpoint] }),
    );
    let mock = tauri::test::mock_builder()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .build(context)
        .expect("the mock app builds");
    let host = FakeHost::new();
    let fake_exe = std::env::temp_dir().join("Kustom-test.app/Contents/MacOS/Kustom");
    let updater = Arc::new(TauriUpdater::with_configure(
        mock.handle().clone(),
        host.clone(),
        move |b| {
            b.endpoints(vec![endpoint.parse().unwrap()])
                .unwrap()
                .pubkey(pubkey.clone())
                .target("test-target")
                .executable_path(&fake_exe)
        },
    ));
    let dir = tempfile::tempdir().unwrap();
    host.set(connected(Some("Lobby")));
    let app = App::new(
        "1.0.0",
        dir.path().to_path_buf(),
        host.clone(),
        Arc::new(FakeShell),
        Arc::new(FakeUpdater::default()),
        Arc::new(NoNetwork),
        "http://127.0.0.1:9".to_owned(),
    );
    tokio::spawn(app.clone().follow());
    settle().await;
    updater.bind(&app);
    Plugin {
        rig: Rig {
            app,
            host,
            updater: Arc::new(FakeUpdater::default()),
            _dir: dir,
        },
        updater,
        _mock: mock,
    }
}

fn failure_lines(log: &LogCapture) -> Vec<String> {
    log.lines()
        .into_iter()
        .filter(|l| l.contains("update check failed"))
        .collect()
}

#[tokio::test]
async fn a_signed_newer_release_downloads_and_shows_the_card() {
    let (log, _guard) = capture();
    let key = Throwaway::new();
    let installer = b"pretend this is an NSIS installer".to_vec();
    let (base, server) = serve(Server::Release {
        version: "9.9.9",
        signature: key.sign(&installer),
        installer,
    })
    .await;
    let p = plugin(format!("{base}/latest.json"), key.pubkey()).await;
    let wait = check_once(&p.rig.app, p.updater.as_ref(), &Schedule::default()).await;
    assert_eq!(wait, Schedule::default().every);
    assert!(failure_lines(&log).is_empty(), "{:?}", log.lines());
    assert!(matches!(&p.rig.app.model().update, UpdateState::Ready { version } if version == "9.9.9"));
    let card = p.rig.app.view().home.unwrap().update.expect("the card");
    assert_eq!(card.text, "Update ready: Kustom\u{a0}9.9.9.");
    server.abort();
}

#[tokio::test]
async fn a_release_that_is_not_newer_shows_nothing() {
    let (log, _guard) = capture();
    let key = Throwaway::new();
    let installer = b"x".to_vec();
    let (base, server) = serve(Server::Release {
        version: "0.0.1",
        signature: key.sign(&installer),
        installer,
    })
    .await;
    let p = plugin(format!("{base}/latest.json"), key.pubkey()).await;
    check_once(&p.rig.app, p.updater.as_ref(), &Schedule::default()).await;
    assert_eq!(p.rig.app.model().update, UpdateState::None);
    assert!(failure_lines(&log).is_empty());
    server.abort();
}

#[tokio::test]
async fn a_bad_signature_is_one_log_line_and_no_card() {
    let (log, _guard) = capture();
    let ours = Throwaway::new();
    let someone_else = Throwaway::new();
    let installer = b"an installer signed by the wrong key".to_vec();
    let (base, server) = serve(Server::Release {
        version: "9.9.9",
        signature: someone_else.sign(&installer),
        installer,
    })
    .await;
    let p = plugin(format!("{base}/latest.json"), ours.pubkey()).await;
    let wait = check_once(&p.rig.app, p.updater.as_ref(), &Schedule::default()).await;
    assert_eq!(wait, Schedule::default().retry);
    assert_eq!(p.rig.app.model().update, UpdateState::None, "no card");
    let lines = failure_lines(&log);
    assert_eq!(lines.len(), 1, "{:?}", log.lines());
    assert!(lines[0].contains("kind=signature"), "{}", lines[0]);
    server.abort();
}

#[tokio::test]
async fn the_placeholder_public_key_is_a_signature_failure_not_a_crash() {
    let (log, _guard) = capture();
    let key = Throwaway::new();
    let installer = b"x".to_vec();
    let (base, server) = serve(Server::Release {
        version: "9.9.9",
        signature: key.sign(&installer),
        installer,
    })
    .await;
    let placeholder = "REPLACE_WITH_THE_PUBLIC_KEY_FROM_TAURI_SIGNER_GENERATE".to_owned();
    let p = plugin(format!("{base}/latest.json"), placeholder).await;
    check_once(&p.rig.app, p.updater.as_ref(), &Schedule::default()).await;
    assert_eq!(p.rig.app.model().update, UpdateState::None);
    assert_eq!(failure_lines(&log).len(), 1, "{:?}", log.lines());
    server.abort();
}

#[tokio::test]
async fn a_network_error_is_one_log_line_and_no_card() {
    let (log, _guard) = capture();
    // A port nothing listens on: bind, note the port, drop.
    let port = TcpListener::bind("127.0.0.1:0")
        .await
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let p = plugin(
        format!("http://127.0.0.1:{port}/latest.json"),
        Throwaway::new().pubkey(),
    )
    .await;
    let wait = check_once(&p.rig.app, p.updater.as_ref(), &Schedule::default()).await;
    assert_eq!(wait, Schedule::default().retry);
    assert_eq!(p.rig.app.model().update, UpdateState::None);
    let lines = failure_lines(&log);
    assert_eq!(lines.len(), 1, "{:?}", log.lines());
    assert!(lines[0].contains("kind=network"), "{}", lines[0]);
}

#[tokio::test]
async fn a_404_is_one_log_line_and_no_card() {
    let (log, _guard) = capture();
    let (base, server) = serve(Server::NotFound).await;
    let p = plugin(format!("{base}/latest.json"), Throwaway::new().pubkey()).await;
    let wait = check_once(&p.rig.app, p.updater.as_ref(), &Schedule::default()).await;
    assert_eq!(wait, Schedule::default().retry);
    assert_eq!(p.rig.app.model().update, UpdateState::None);
    let lines = failure_lines(&log);
    assert_eq!(lines.len(), 1, "{:?}", log.lines());
    assert!(lines[0].contains("kind=not-found"), "{}", lines[0]);
    server.abort();
}

#[test]
fn the_error_classes() {
    use tauri_plugin_updater::Error;
    assert_eq!(classify(&Error::ReleaseNotFound).kind, FailureKind::NotFound);
    assert_eq!(classify(&Error::Network("x".into())).kind, FailureKind::Network);
    assert_eq!(
        classify(&Error::SignatureUtf8("x".into())).kind,
        FailureKind::Signature
    );
    assert_eq!(classify(&Error::EmptyEndpoints).kind, FailureKind::Other);
}
