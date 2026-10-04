//! The connection machine (parity row 8, port of `apps/companion/src/connection.ts`):
//!
//! ```text
//! disconnected --(client_reached)--> connected --(socket_open)--> watching
//! connected/watching --(client_lost | socket_closed)--> disconnected
//! any --(stop)--> stopped
//! ```
//!
//! `disconnected` runs M17.5's discovery every `poll_interval` (5 s). `connected` means HTTPS answered
//! `GET /lol-patch/v1/game-version`; `current-summoner` and the gameflow phase are read and every watcher is
//! told ([`MachineEvent::Connected`]). `watching` means the WebSocket is open and subscribed; events are
//! routed by URI ([`crate::lcu::events::route`], a payload that does not fit is logged and dropped) and
//! handed to every watcher. Back to `disconnected` when the socket closes, discovery stops finding the
//! client or finds it with another port or password (a restart), or HTTPS fails during `connected`.
//! Reconnects use the 1 s to 60 s jittered backoff, reset once `watching` is reached. It never ends on an
//! error; only [`MachineHandle::stop`] ends it.
//!
//! The socket is M17.5's [`run_once`] rather than `run_forever`: the machine must read the client over HTTPS
//! between discovering it and opening the socket, and must tell the watchers about each connect and
//! disconnect, which `run_forever` has no seam for. Discovery runs before every attempt all the same.
//!
//! Watchers run as their own tasks fed by an unbounded channel each: one that is slow or broken never holds
//! up the machine or another watcher (row 20, what `composeHooks` did).
//!
//! For the window (M17.8) the machine publishes a [`ConnectionStatus`] on a `watch` channel: League not
//! found (with every path searched, for "Can't find League" and its Browse button), connecting, connected,
//! lost.

use std::future::Future;
use std::panic::AssertUnwindSafe;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::FutureExt as _;

use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;

use crate::backoff::{Backoff, BackoffOptions};
use crate::lcu::discovery::{Discovery, DiscoveryInputs, DiscoveryStep, LockfileReader};
use crate::lcu::events::{RoutedEvent, route};
use crate::lcu::process::ProcessLister;
use crate::lcu::socket::{SocketMessage, SocketOptions, run_once};
use crate::lcu::tls::{AnchorError, LcuCertVerifier, client_config};
use crate::lcu::types::Summoner;
use crate::lcu::{Credentials, LcuClient, LcuDiscovery, LcuFailure};

/// The machine's states (the TypeScript names).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MachineState {
    /// Looking for the client.
    Disconnected,
    /// HTTPS answered; reading the local player and phase, opening the socket.
    Connected,
    /// The socket is open and subscribed.
    Watching,
    /// Stopped for good.
    Stopped,
}

/// What moves the machine.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Trigger {
    /// HTTPS answered the version probe.
    ClientReached,
    /// The socket opened.
    SocketOpen,
    /// The socket closed.
    SocketClosed,
    /// The client went away (discovery, a changed lockfile, a failed read, a socket that never opened).
    ClientLost,
    /// [`MachineHandle::stop`].
    Stop,
}

/// The transition table; `None` is an illegal move, logged and not taken.
pub fn next_state(from: MachineState, trigger: Trigger) -> Option<MachineState> {
    use MachineState::*;
    use Trigger::*;
    match (from, trigger) {
        (Disconnected, ClientReached) => Some(Connected),
        (Connected, SocketOpen) => Some(Watching),
        (Connected, ClientLost) | (Watching, SocketClosed) | (Watching, ClientLost) => Some(Disconnected),
        (Stopped, _) => None,
        (_, Stop) => Some(Stopped),
        _ => None,
    }
}

/// One move, for tests and the log.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Transition {
    /// Before.
    pub from: MachineState,
    /// After.
    pub to: MachineState,
    /// Why.
    pub trigger: Trigger,
}

/// Why the watchers were told the client is gone.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DisconnectReason {
    /// The socket closed.
    SocketClosed,
    /// The client went away.
    ClientLost,
}

/// The League side of the status, for the window.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LeagueStatus {
    /// Not started yet.
    Starting,
    /// League is not running or not where we looked. `searched` is every lockfile path tried, in order.
    NotRunning {
        /// Paths tried.
        searched: Vec<PathBuf>,
    },
    /// Found; HTTPS or the socket is being opened (or the client is not answering yet).
    Connecting {
        /// The port from the lockfile or command line.
        port: u16,
        /// Which discovery step found it.
        step: DiscoveryStep,
        /// The install folder, when discovery knows it (the window's League folder row, M17.8).
        install_dir: Option<PathBuf>,
    },
    /// Watching.
    Connected {
        /// The port.
        port: u16,
        /// Which discovery step found it.
        step: DiscoveryStep,
        /// `major.minor` of the client version.
        patch: Option<String>,
        /// The install folder, when discovery knows it (the window's League folder row, M17.8).
        install_dir: Option<PathBuf>,
    },
    /// Was connected; looking again.
    Lost {
        /// Why.
        reason: DisconnectReason,
    },
    /// The machine stopped.
    Stopped,
}

/// The machine's state plus the League status.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConnectionStatus {
    /// The machine state.
    pub state: MachineState,
    /// The League status.
    pub league: LeagueStatus,
}

/// What a connect learned, handed to every watcher.
#[derive(Debug, Clone)]
pub struct ConnectedContext {
    /// HTTPS to the client, for the watchers' own reads.
    pub client: LcuClient,
    /// The full client version string.
    pub version: String,
    /// `major.minor`, when it parsed.
    pub patch: Option<String>,
    /// The local player, or `None` when `current-summoner` did not answer (logged).
    pub summoner: Option<Summoner>,
    /// The gameflow phase at connect, or `None`.
    pub phase: Option<String>,
    /// The port.
    pub port: u16,
}

/// What the watchers receive.
#[derive(Debug, Clone)]
pub enum MachineEvent {
    /// Connected; sent before the socket opens.
    Connected(Arc<ConnectedContext>),
    /// A routed event (never `Ignored`).
    Event(Arc<RoutedEvent>),
    /// The client is gone.
    Disconnected(DisconnectReason),
}

/// Resolves once `stop` turns true (or its sender is gone). Holds no borrow across an await.
pub(crate) async fn until_stopped(stop: &mut watch::Receiver<bool>) {
    let _ = stop.wait_for(|s| *s).await.map(|_| ());
}

/// `16.17.8104348+branch...` -> `16.17`.
pub fn patch_from_version(version: &str) -> Option<String> {
    let mut parts = version.trim().split('.');
    let major = parts
        .next()
        .filter(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))?;
    let minor_raw = parts.next()?;
    let minor: String = minor_raw.chars().take_while(char::is_ascii_digit).collect();
    (!minor.is_empty()).then(|| format!("{major}.{minor}"))
}

/// Room in each watcher's inbox. The machine waits for room (backpressure: no event is ever dropped), but
/// never past a stop.
pub const WATCHER_QUEUE: usize = 256;

/// One watcher's inbox: a bounded channel, plus an optional counter of what was handed over (the lobby
/// watcher's `settled` uses it).
#[derive(Debug, Clone)]
pub struct WatcherFeed {
    tx: mpsc::Sender<MachineEvent>,
    sent: Option<Arc<AtomicU64>>,
}

impl WatcherFeed {
    /// A feed into `tx`.
    pub fn new(tx: mpsc::Sender<MachineEvent>) -> Self {
        Self { tx, sent: None }
    }

    /// A feed that counts every event into `sent` before sending it.
    pub fn counted(tx: mpsc::Sender<MachineEvent>, sent: Arc<AtomicU64>) -> Self {
        Self { tx, sent: Some(sent) }
    }

    /// Waits for room and delivers. `false` when the watcher is gone (its events are then skipped).
    pub async fn deliver(&self, event: MachineEvent) -> bool {
        if let Some(sent) = &self.sent {
            sent.fetch_add(1, Ordering::SeqCst);
        }
        self.tx.send(event).await.is_ok()
    }
}

/// Finds the client. Production wraps M17.5's [`Discovery`] with inputs read from config each time.
pub trait Discover: Send + 'static {
    /// One pass.
    fn discover(&mut self) -> impl Future<Output = LcuDiscovery> + Send;
    /// Forget anything remembered (the last process listing) so the next pass looks afresh. Called on a
    /// retry ([`MachineHandle::retry_now`]).
    fn refresh(&mut self) {}
}

/// [`Discovery`] plus a function that reads the saved folder and defaults fresh on every pass.
pub struct ConfiguredDiscovery<L, R> {
    /// The discovery (process list memory and rate limit live here).
    pub discovery: Discovery<L, R>,
    /// Reads `leagueInstallDir`, `lockfilePath` and the defaults.
    pub inputs: Box<dyn FnMut() -> DiscoveryInputs + Send>,
}

impl<L, R> Discover for ConfiguredDiscovery<L, R>
where
    L: ProcessLister + 'static,
    R: LockfileReader + Send + Sync + 'static,
{
    async fn discover(&mut self) -> LcuDiscovery {
        let inputs = (self.inputs)();
        self.discovery.discover(&inputs).await
    }

    fn refresh(&mut self) {
        self.discovery.forget_listing();
    }
}

/// Builds the pinned verifier for each connection (tests pin to their own CA).
pub type VerifierFactory = Arc<dyn Fn() -> Result<LcuCertVerifier, AnchorError> + Send + Sync>;

/// Timings.
#[derive(Debug, Clone)]
pub struct MachineOptions {
    /// Discovery while disconnected, and the lockfile check while watching. Default 5 s.
    pub poll_interval: Duration,
    /// Reconnect backoff. Default 1 s to 60 s.
    pub backoff: BackoffOptions,
    /// Per-request timeout. Default 10 s.
    pub request_timeout: Duration,
    /// Heartbeat.
    pub socket: SocketOptions,
}

impl Default for MachineOptions {
    fn default() -> Self {
        Self {
            poll_interval: Duration::from_secs(5),
            backoff: BackoffOptions::default(),
            request_timeout: Duration::from_secs(10),
            socket: SocketOptions::default(),
        }
    }
}

/// The running machine.
pub struct MachineHandle {
    stop: watch::Sender<bool>,
    poke: Arc<tokio::sync::Notify>,
    status: watch::Receiver<ConnectionStatus>,
    transitions: Arc<Mutex<Vec<Transition>>>,
    join: Mutex<Option<JoinHandle<()>>>,
}

impl MachineHandle {
    /// The status, live.
    pub fn status(&self) -> watch::Receiver<ConnectionStatus> {
        self.status.clone()
    }

    /// Every transition so far (the last 200).
    pub fn transitions(&self) -> Vec<Transition> {
        self.transitions.lock().map(|t| t.clone()).unwrap_or_default()
    }

    /// Waits until the state is `target`. `false` on timeout.
    pub async fn wait_for_state(&self, target: MachineState, timeout: Duration) -> bool {
        let mut rx = self.status.clone();
        tokio::time::timeout(timeout, rx.wait_for(|s| s.state == target))
            .await
            .is_ok_and(|r| r.is_ok())
    }

    /// Waits until the next time the state becomes `target` (not counting now).
    pub async fn wait_for_next_state(&self, target: MachineState, timeout: Duration) -> bool {
        let mut rx = self.status.clone();
        rx.borrow_and_update();
        tokio::time::timeout(timeout, async {
            loop {
                if rx.changed().await.is_err() {
                    return false;
                }
                if rx.borrow_and_update().state == target {
                    return true;
                }
            }
        })
        .await
        .unwrap_or(false)
    }

    /// Ends the current wait at once (the poll while League is not found, or a reconnect backoff) and looks
    /// again with a fresh process listing: the window's Retry, or a saved install folder.
    pub fn retry_now(&self) {
        self.poke.notify_one();
    }

    /// Stops the machine and waits for it: closes the socket, no reconnect. Safe to call twice.
    pub async fn stop(&self) {
        let _ = self.stop.send(true);
        let join = self.join.lock().ok().and_then(|mut j| j.take());
        if let Some(join) = join {
            let _ = join.await;
        }
    }
}

struct Machine<D> {
    discover: D,
    verifier: VerifierFactory,
    options: MachineOptions,
    subscribers: Vec<WatcherFeed>,
    status: watch::Sender<ConnectionStatus>,
    transitions: Arc<Mutex<Vec<Transition>>>,
    stop: watch::Receiver<bool>,
    poke: Arc<tokio::sync::Notify>,
    state: MachineState,
    backoff: Backoff,
    last_not_found: Option<Vec<PathBuf>>,
    /// The port "not answering yet" was last warned for: a client that answers 204 for two minutes while
    /// it starts is one warn line, then debug, until it answers or the port changes.
    not_answering_warned: Option<u16>,
}

enum WatchOutcome {
    SocketClosed,
    ClientLost,
    Stop,
}

/// Starts the machine. Every feed receives every [`MachineEvent`], in order.
pub fn spawn_machine<D: Discover>(
    discover: D,
    verifier: VerifierFactory,
    options: MachineOptions,
    subscribers: Vec<WatcherFeed>,
) -> MachineHandle {
    let (stop_tx, stop_rx) = watch::channel(false);
    let initial = ConnectionStatus {
        state: MachineState::Disconnected,
        league: LeagueStatus::Starting,
    };
    let (status_tx, status_rx) = watch::channel(initial);
    let transitions = Arc::new(Mutex::new(Vec::new()));
    let backoff = Backoff::new(options.backoff.clone());
    let poke = Arc::new(tokio::sync::Notify::new());
    let machine = Machine {
        poke: poke.clone(),
        discover,
        verifier,
        options,
        subscribers,
        status: status_tx,
        transitions: transitions.clone(),
        stop: stop_rx,
        state: MachineState::Disconnected,
        backoff,
        last_not_found: None,
        not_answering_warned: None,
    };
    let join = tokio::spawn(machine.run());
    MachineHandle {
        stop: stop_tx,
        poke,
        status: status_rx,
        transitions,
        join: Mutex::new(Some(join)),
    }
}

impl<D: Discover> Machine<D> {
    fn stopped(&self) -> bool {
        *self.stop.borrow()
    }

    async fn run(mut self) {
        while !self.stopped() {
            // A bug in one cycle must not end the companion: a panic is contained here, the watchers are told
            // the client is gone, and the loop goes around again after a backoff. Only `stop()` ends it.
            // (Needs the release profile's `panic = "unwind"`.)
            if AssertUnwindSafe(self.cycle()).catch_unwind().await.is_err() {
                tracing::error!("connection cycle panicked; starting over");
                if matches!(self.state, MachineState::Connected | MachineState::Watching) {
                    self.transition(Trigger::ClientLost);
                    self.tell(MachineEvent::Disconnected(DisconnectReason::ClientLost))
                        .await;
                    self.publish(LeagueStatus::Lost {
                        reason: DisconnectReason::ClientLost,
                    });
                }
                self.backoff_pause().await;
            }
        }
        self.transition(Trigger::Stop);
        self.publish(LeagueStatus::Stopped);
    }

    fn publish(&self, league: LeagueStatus) {
        let _ = self.status.send(ConnectionStatus {
            state: self.state,
            league,
        });
    }

    fn transition(&mut self, trigger: Trigger) -> bool {
        let from = self.state;
        let Some(to) = next_state(from, trigger) else {
            if from != MachineState::Stopped {
                tracing::error!(?from, ?trigger, "illegal connection transition ignored");
            }
            return false;
        };
        self.state = to;
        tracing::debug!(?from, ?to, ?trigger, "connection transition");
        if let Ok(mut list) = self.transitions.lock() {
            list.push(Transition { from, to, trigger });
            if list.len() > 200 {
                list.remove(0);
            }
        }
        self.status.send_modify(|s| s.state = to);
        true
    }

    /// Hands `event` to every watcher, waiting for room in each inbox but never past a stop.
    async fn tell(&mut self, event: MachineEvent) {
        let mut stop = self.stop.clone();
        for feed in &self.subscribers {
            tokio::select! {
                _ = feed.deliver(event.clone()) => {}
                _ = until_stopped(&mut stop) => return,
            }
        }
    }

    /// Sleeps, or returns early on stop.
    async fn pause(&mut self, delay: Duration) {
        let mut stop = self.stop.clone();
        let poke = self.poke.clone();
        tokio::select! {
            _ = tokio::time::sleep(delay) => {}
            _ = until_stopped(&mut stop) => {}
            _ = poke.notified() => {
                tracing::debug!("retrying discovery now");
                self.discover.refresh();
            }
        }
    }

    async fn backoff_pause(&mut self) {
        let delay = self.backoff.next_delay();
        self.pause(delay).await;
    }

    async fn cycle(&mut self) {
        let mut stop = self.stop.clone();
        let found = tokio::select! {
            found = self.discover.discover() => found,
            _ = until_stopped(&mut stop) => return,
        };
        let (credentials, step, install_dir) = match found {
            LcuDiscovery::Found {
                credentials,
                step,
                install_dir,
                ..
            } => (credentials, step, install_dir),
            LcuDiscovery::NotFound { searched } => {
                if self.last_not_found.as_ref() != Some(&searched) {
                    let tried: Vec<String> = searched.iter().map(|p| p.display().to_string()).collect();
                    tracing::info!(?tried, "waiting for the League client");
                    self.last_not_found = Some(searched.clone());
                }
                self.publish(LeagueStatus::NotRunning { searched });
                let poll = self.options.poll_interval;
                self.pause(poll).await;
                return;
            }
        };
        self.last_not_found = None;
        if step == DiscoveryStep::RunningClient {
            tracing::info!(
                port = credentials.port,
                step = step.label(),
                "League client found"
            );
        }
        self.publish(LeagueStatus::Connecting {
            port: credentials.port,
            step,
            install_dir: install_dir.clone(),
        });
        let verifier = match (self.verifier)() {
            Ok(v) => v,
            Err(error) => {
                tracing::error!(%error, "could not load the pinned certificate");
                self.backoff_pause().await;
                return;
            }
        };
        let client = match LcuClient::with_verifier(&credentials, verifier, self.options.request_timeout) {
            Ok(c) => c,
            Err(error) => {
                tracing::error!(%error, "could not build the League client connection");
                self.backoff_pause().await;
                return;
            }
        };
        let probe = tokio::select! {
            probe = client.game_version() => probe,
            _ = until_stopped(&mut stop) => return,
        };
        let version = match probe {
            Ok(ok) => ok.value,
            Err(failure) => {
                if self.not_answering_warned == Some(credentials.port) {
                    tracing::debug!(
                        port = credentials.port,
                        reason = %failure.describe(),
                        "lockfile present but the client is not answering yet"
                    );
                } else {
                    self.not_answering_warned = Some(credentials.port);
                    tracing::warn!(
                        port = credentials.port,
                        reason = %failure.describe(),
                        "lockfile present but the client is not answering yet"
                    );
                }
                self.backoff_pause().await;
                return;
            }
        };
        self.not_answering_warned = None;
        if self.stopped() || !self.transition(Trigger::ClientReached) {
            return;
        }
        let context = tokio::select! {
            context = Self::build_context(client, version, credentials.port) => context,
            _ = until_stopped(&mut stop) => return,
        };
        if self.stopped() {
            return;
        }
        let Some(context) = context else {
            self.transition(Trigger::ClientLost);
            self.publish(LeagueStatus::Lost {
                reason: DisconnectReason::ClientLost,
            });
            self.backoff_pause().await;
            return;
        };
        tracing::info!(
            version = %context.version,
            patch = ?context.patch,
            port = credentials.port,
            puuid = ?context.summoner.as_ref().map(|s| s.puuid.clone()),
            phase = ?context.phase,
            "connected to the League client"
        );
        let patch = context.patch.clone();
        self.tell(MachineEvent::Connected(Arc::new(context))).await;

        let tls = match (self.verifier)()
            .map_err(|e| e.to_string())
            .and_then(|v| client_config(v).map_err(|e| e.to_string()))
        {
            Ok(config) => Arc::new(config),
            Err(error) => {
                tracing::error!(%error, "could not set up the socket's TLS");
                self.transition(Trigger::ClientLost);
                self.tell(MachineEvent::Disconnected(DisconnectReason::ClientLost))
                    .await;
                self.publish(LeagueStatus::Lost {
                    reason: DisconnectReason::ClientLost,
                });
                self.backoff_pause().await;
                return;
            }
        };
        let (tx, mut rx) = mpsc::channel(1024);
        let (socket_stop_tx, mut socket_stop_rx) = watch::channel(false);
        let socket_credentials = credentials.clone();
        let socket_options = self.options.socket;
        let mut socket = tokio::spawn(async move {
            run_once(&socket_credentials, tls, socket_options, &tx, &mut socket_stop_rx).await
        });

        let opened = tokio::select! {
            message = rx.recv() => matches!(message, Some(SocketMessage::Open { .. })),
            result = &mut socket => {
                tracing::warn!(reason = ?result.ok(), "socket did not open");
                false
            }
            _ = until_stopped(&mut stop) => false,
        };
        if self.stopped() {
            let _ = socket_stop_tx.send(true);
            let _ = socket.await;
            return;
        }
        if !opened {
            let _ = socket_stop_tx.send(true);
            self.transition(Trigger::ClientLost);
            self.tell(MachineEvent::Disconnected(DisconnectReason::ClientLost))
                .await;
            self.publish(LeagueStatus::Lost {
                reason: DisconnectReason::ClientLost,
            });
            self.backoff_pause().await;
            return;
        }
        self.transition(Trigger::SocketOpen);
        self.backoff.reset();
        self.publish(LeagueStatus::Connected {
            port: credentials.port,
            step,
            patch,
            install_dir,
        });
        tracing::info!(port = credentials.port, "watching");

        let outcome = self.watch(&mut rx, &credentials).await;
        let _ = socket_stop_tx.send(true);
        let socket_result = socket.await;
        let reason = match outcome {
            WatchOutcome::Stop => return,
            WatchOutcome::SocketClosed => {
                tracing::info!(reason = ?socket_result.ok(), "socket closed");
                (Trigger::SocketClosed, DisconnectReason::SocketClosed)
            }
            WatchOutcome::ClientLost => (Trigger::ClientLost, DisconnectReason::ClientLost),
        };
        self.transition(reason.0);
        self.tell(MachineEvent::Disconnected(reason.1)).await;
        self.publish(LeagueStatus::Lost { reason: reason.1 });
        self.backoff_pause().await;
    }

    async fn build_context(client: LcuClient, version: String, port: u16) -> Option<ConnectedContext> {
        let summoner = match client.current_summoner().await {
            Ok(ok) => Some(ok.value),
            Err(LcuFailure::Network { .. }) => return None,
            Err(failure) => {
                tracing::warn!(reason = %failure.describe(), "current-summoner unavailable; continuing without the local player");
                None
            }
        };
        let phase = match client.gameflow_phase().await {
            Ok(ok) => Some(ok.value),
            Err(LcuFailure::Network { .. }) => return None,
            Err(_) => None,
        };
        Some(ConnectedContext {
            patch: patch_from_version(&version),
            client,
            version,
            summoner,
            phase,
            port,
        })
    }

    async fn watch(
        &mut self,
        rx: &mut mpsc::Receiver<SocketMessage>,
        credentials: &Credentials,
    ) -> WatchOutcome {
        let mut stop = self.stop.clone();
        let mut check = tokio::time::interval(self.options.poll_interval);
        check.tick().await;
        loop {
            tokio::select! {
                _ = until_stopped(&mut stop) => return WatchOutcome::Stop,
                message = rx.recv() => match message {
                    Some(SocketMessage::Event(event)) => {
                        // A payload that does not fit its type is logged inside `route` and dropped here.
                        if let Ok(routed) = route(&event) {
                            if routed != RoutedEvent::Ignored {
                                self.tell(MachineEvent::Event(Arc::new(routed))).await;
                            }
                        }
                    }
                    Some(_) => {}
                    None => return WatchOutcome::SocketClosed,
                },
                _ = check.tick() => match tokio::select! {
                    found = self.discover.discover() => found,
                    _ = until_stopped(&mut stop) => return WatchOutcome::Stop,
                } {
                    LcuDiscovery::NotFound { .. } => {
                        tracing::info!("lockfile gone; the client has exited");
                        return WatchOutcome::ClientLost;
                    }
                    LcuDiscovery::Found { credentials: found, .. } => {
                        if found.port != credentials.port || found.password != credentials.password {
                            tracing::info!(port = found.port, "lockfile changed; the client restarted");
                            return WatchOutcome::ClientLost;
                        }
                    }
                },
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_transition_table() {
        use MachineState::*;
        use Trigger::*;
        assert_eq!(next_state(Disconnected, ClientReached), Some(Connected));
        assert_eq!(next_state(Connected, SocketOpen), Some(Watching));
        assert_eq!(next_state(Watching, SocketClosed), Some(Disconnected));
        assert_eq!(next_state(Watching, ClientLost), Some(Disconnected));
        assert_eq!(next_state(Connected, ClientLost), Some(Disconnected));
        assert_eq!(next_state(Disconnected, SocketOpen), None);
        for trigger in [ClientReached, SocketOpen, SocketClosed, ClientLost, Stop] {
            assert_eq!(next_state(Stopped, trigger), None, "nothing leaves stopped");
        }
        for from in [Disconnected, Connected, Watching] {
            assert_eq!(next_state(from, Stop), Some(Stopped));
        }
    }

    #[test]
    fn patches() {
        assert_eq!(
            patch_from_version("16.17.8104348+branch.releases-16-17").as_deref(),
            Some("16.17")
        );
        assert_eq!(patch_from_version("16.17").as_deref(), Some("16.17"));
        assert_eq!(patch_from_version("latest"), None);
        assert_eq!(patch_from_version("16"), None);
    }
}
