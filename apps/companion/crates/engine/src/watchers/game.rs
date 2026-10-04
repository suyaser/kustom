//! Game capture (parity rows 13 and 14, port of `apps/companion/src/gameWatcher.ts`): notice the game
//! started, notice how it ended, and never lose it.
//!
//! **Post 1, `in_progress`.** On the phase `GameStart` (or `InProgress` when `GameStart` was missed): one
//! `GET /lol-gameflow/v1/session` and one POST (the API client's four attempts) with `gameData.gameId`, the
//! moment the phase was observed (the injected clock) and the last custom lobby's `partyId`. Never read in
//! any other phase (in `Lobby` the session holds the previous game's id). Not queued; a failure is one log
//! line. `{ gameId, startedAt, partyId }` is held for the end-of-game post.
//!
//! **Post 2, `eog`, from the WebSocket event held in memory** (the GET 404s once anyone clicks past the score
//! screen). One GET only at connect when the phase is already `EndOfGame`/`WaitingForStats`. Pipeline:
//! ignore a withdrawal; dedupe on `gameId` (posted this process, queued, or a file on disk); drop a
//! non-custom or no-winner block; map (`map_eog`, which scrubs `raw`); write the queue file; post the file's
//! payload **as read back** (`ApiClient::post_queued_game`, one attempt per pass).
//!
//! **The queue** ([`crate::queue`], the TypeScript format so 0.3.x blocks replay): replayed at start before
//! League is even looked for, oldest first, one at a time. A file is deleted on any 2xx (a readable or not)
//! and on a permanent refusal (400, 403, 404, 422); kept and retried on an outer backoff (30 s to 15 min) for
//! everything else, as long as the process runs. A file that cannot be read is quarantined, never deleted.
//!
//! **The held `partyId`** follows custom lobby events, and is cleared on a lobby `Delete` and on a disconnect
//! (decision row 2026-10-04: the TS engine kept a dead party, a bug). The id captured at `GameStart` is kept
//! for that game: the lobby `Delete` follows `GameStart` by 30 to 100 ms. The watcher reads lobby events from
//! the machine's own stream, in socket order, rather than the lobby watcher's signal channel, so a `Create`
//! can never be seen after the `GameStart` that follows it.
//!
//! After every 2xx on an end-of-game post it writes `last-posted.json` (decision row 2026-10-04) and shows it
//! in [`GameWatcherView::last_posted`] for the window. [`GameWatcherView::busy`] is the M14.13 swap guard.
//!
//! Log fields are ids, phases and counts; never a block (it carries chat credentials).

use std::collections::{HashMap, HashSet, VecDeque};
use std::future::Future;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::UNIX_EPOCH;

use serde_json::Value;
use tokio::sync::{mpsc, watch};
use tokio::task::JoinSet;

use super::connection::{ConnectedContext, MachineEvent, WATCHER_QUEUE, WatcherFeed};
use super::lobby::{Cancel, Scheduler, TokioScheduler};
use crate::api::wire::{GamePayload, InProgressPayload, Side};
use crate::backoff::{Backoff, BackoffOptions};
use crate::config::state::{LastPosted, read_last_posted, write_last_posted};
use crate::lcu::events::RoutedEvent;
use crate::lcu::mapper::map_eog;
use crate::lcu::types::{EogStatsBlock, GameflowSession};
use crate::lcu::{LcuFailure, LcuResponse};
use crate::log::Clock;
use crate::queue::{
    QueuedGame, delete_queued, enforce_cap, has_queued, queued_count, read_queue, write_queued,
};

/// The block is read from the client only at connect time, and only in these phases.
pub const EOG_CONNECT_PHASES: [&str; 2] = ["EndOfGame", "WaitingForStats"];
const START_PHASES: [&str; 2] = ["GameStart", "InProgress"];
/// Session phases whose `gameData.gameId` is the previous game's.
const STALE_SESSION_PHASES: [&str; 2] = ["Lobby", "None"];
/// The only game type posted.
pub const CUSTOM_GAME_TYPE: &str = "CUSTOM_GAME";
/// Statuses that mean the server refused the game for good.
pub const PERMANENT_REFUSALS: [u16; 4] = [400, 403, 404, 422];

/// How a game post went.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GamePostOutcome {
    /// 2xx and readable.
    Ok {
        /// False when the server already had the game.
        created: bool,
        /// `game_players` rows.
        participants: u64,
        /// The lobby row, when known.
        lobby_id: Option<String>,
    },
    /// The API answered outside 2xx (after the call's attempts).
    Http {
        /// The status.
        status: u16,
        /// The server's sentence.
        error: String,
    },
    /// No HTTP answer.
    Network(String),
    /// 2xx whose body could not be read: the server has the game.
    Unreadable(String),
}

/// Posts game bodies. M17.6's [`crate::api::ApiClient`] implements it; tests use a fake.
pub trait GamePoster: Send + Sync + 'static {
    /// `POST /api/companion/game`, phase `in_progress` (the client's four attempts).
    fn post_in_progress(&self, body: &GamePayload) -> impl Future<Output = GamePostOutcome> + Send;
    /// `POST /api/companion/game` with a queued payload exactly as read from its file (one attempt).
    fn post_queued(&self, body: &Value) -> impl Future<Output = GamePostOutcome> + Send;
}

fn from_api(result: crate::api::ApiResult<crate::api::wire::GameResponse>) -> GamePostOutcome {
    use crate::api::ApiFailure;
    match result {
        Ok(ok) => GamePostOutcome::Ok {
            created: ok.data.created,
            participants: ok.data.participants,
            lobby_id: ok.data.lobby_id,
        },
        Err(ApiFailure::Http { status, error, .. }) => GamePostOutcome::Http { status, error },
        Err(ApiFailure::Network { message, .. }) => GamePostOutcome::Network(message),
        Err(ApiFailure::Malformed { status, .. }) => {
            GamePostOutcome::Unreadable(format!("{status} not JSON"))
        }
        Err(ApiFailure::Schema { status, issues }) => {
            GamePostOutcome::Unreadable(format!("{status} {}", issues.join("; ")))
        }
    }
}

impl GamePoster for crate::api::ApiClient {
    async fn post_in_progress(&self, body: &GamePayload) -> GamePostOutcome {
        from_api(crate::api::ApiClient::post_in_progress(self, body).await)
    }

    async fn post_queued(&self, body: &Value) -> GamePostOutcome {
        from_api(crate::api::ApiClient::post_queued_game(self, body).await)
    }
}

/// Where a payload handed to the queue came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Origin {
    /// Captured live (the socket or the connect-time GET).
    Live,
    /// A backfilled match detail (M17.11): posted even when a live copy was, so the server can copy bans.
    Backfill,
}

/// What [`GameWatcherHandle::enqueue`] did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EnqueueOutcome {
    /// Written to the queue and handed to the drain.
    Queued,
    /// Already handled.
    Duplicate,
    /// The queue would not take it (not a valid body, or the disk refused).
    Refused,
}

/// Settings.
#[derive(Clone)]
pub struct GameWatcherOptions {
    /// This group's state directory (`groups/<groupId>/`); the queue lives in its `queue/`.
    pub state_dir: PathBuf,
    /// The clock for `startedAt`, `queuedAt` and `last-posted.json`.
    pub clock: Clock,
    /// Timers (the queue's outer backoff).
    pub scheduler: Arc<dyn Scheduler>,
    /// Outer backoff between passes over the queue. Default 30 s to 15 min.
    pub backoff: BackoffOptions,
    /// Cap on queued files. Default 50.
    pub max_queued: usize,
}

impl GameWatcherOptions {
    /// Production defaults for a state directory.
    pub fn new(state_dir: PathBuf) -> Self {
        Self {
            state_dir,
            clock: crate::log::system_clock(),
            scheduler: Arc::new(TokioScheduler),
            backoff: BackoffOptions::new(
                std::time::Duration::from_secs(30),
                std::time::Duration::from_secs(15 * 60),
            ),
            max_queued: crate::queue::MAX_QUEUED_GAMES,
        }
    }
}

/// `{ gameId, startedAt, partyId }` held from `in_progress` for the end-of-game post.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HeldStart {
    /// The game.
    pub game_id: i64,
    /// When the start was observed, ISO 8601.
    pub started_at: String,
    /// The party held at that moment.
    pub party_id: Option<String>,
}

/// What the watcher shows from outside (the window and tests).
#[derive(Debug, Clone, Default)]
pub struct GameWatcherView {
    /// No session read, in-progress post, connect read or active queue pass (a pass asleep between
    /// retries counts as idle, as in the TS engine).
    pub idle: bool,
    /// Machine events handled.
    pub processed: u64,
    /// The swap guard (M14.13): a game is in progress or has just ended, a post is in flight, or a block is
    /// queued unposted. A group switch or an updater restart waits while this is true.
    pub busy: bool,
    /// Home's Last game.
    pub last_posted: Option<LastPosted>,
    /// Starts held for end-of-game posts.
    pub held_starts: HashMap<i64, HeldStart>,
    /// Game ids that reached a 2xx or a permanent refusal in this process.
    pub settled_game_ids: HashSet<String>,
    /// The party a game starting now would carry.
    pub party_id: Option<String>,
    /// Files in the queue directory.
    pub queued_files: usize,
    /// Background tasks not finished yet.
    pub live_tasks: usize,
    /// Stopped, every task gone.
    pub exited: bool,
}

enum Msg {
    SessionRead {
        observed_at: String,
        party_id: Option<String>,
        result: Box<LcuResponse<GameflowSession>>,
    },
    InProgressDone {
        game_id: i64,
        party_id: Option<String>,
        outcome: GamePostOutcome,
    },
    ConnectBlock {
        phase: String,
        result: Box<LcuResponse<EogStatsBlock>>,
    },
    QueuePosted {
        game: Box<QueuedGame>,
        outcome: GamePostOutcome,
    },
    Wake {
        token: u64,
    },
    Enqueue {
        payload: Value,
        origin: Origin,
        reply: tokio::sync::oneshot::Sender<EnqueueOutcome>,
    },
}

/// Hands payloads to the game watcher's queue from another task (backfill).
#[derive(Clone)]
pub struct GameEnqueuer {
    tx: mpsc::Sender<Msg>,
}

impl GameEnqueuer {
    /// Writes `payload` to the queue and hands it to the drain; waits for the answer.
    pub async fn enqueue(&self, payload: Value, origin: Origin) -> EnqueueOutcome {
        let (reply, answer) = tokio::sync::oneshot::channel();
        if self
            .tx
            .send(Msg::Enqueue {
                payload,
                origin,
                reply,
            })
            .await
            .is_err()
        {
            return EnqueueOutcome::Refused;
        }
        answer.await.unwrap_or(EnqueueOutcome::Refused)
    }
}

/// The running watcher. Dropping it stops it.
pub struct GameWatcherHandle {
    machine: mpsc::Sender<MachineEvent>,
    tx: mpsc::Sender<Msg>,
    stop: watch::Sender<bool>,
    sent: Arc<AtomicU64>,
    view: watch::Receiver<GameWatcherView>,
}

impl GameWatcherHandle {
    /// Hands a machine event over without waiting (tests; the machine uses [`Self::feed`]).
    pub fn send(&self, event: MachineEvent) {
        self.sent.fetch_add(1, Ordering::SeqCst);
        if self.machine.try_send(event).is_err() {
            self.sent.fetch_sub(1, Ordering::SeqCst);
            tracing::warn!(
                component = "game",
                "game watcher inbox full or closed; machine event dropped"
            );
        }
    }

    /// The feed the connection machine delivers into.
    pub fn feed(&self) -> WatcherFeed {
        WatcherFeed::counted(self.machine.clone(), self.sent.clone())
    }

    /// Hands a payload to the queue (backfill, M17.11). Waits for the answer.
    pub async fn enqueue(&self, payload: Value, origin: Origin) -> EnqueueOutcome {
        self.enqueuer().enqueue(payload, origin).await
    }

    /// A cheap handle another task keeps to hand payloads to this queue ([`Self::enqueue`]). It does not
    /// keep the watcher alive: once the watcher stops, every enqueue answers `Refused`.
    pub fn enqueuer(&self) -> GameEnqueuer {
        GameEnqueuer { tx: self.tx.clone() }
    }

    /// The live view.
    pub fn view(&self) -> watch::Receiver<GameWatcherView> {
        self.view.clone()
    }

    /// Waits until every event handed over is handled and the watcher is idle. `false` on timeout.
    pub async fn settled(&self, timeout: std::time::Duration) -> bool {
        let mut view = self.view.clone();
        let sent = self.sent.clone();
        tokio::time::timeout(timeout, async move {
            loop {
                {
                    let v = view.borrow_and_update();
                    if v.idle && v.processed >= sent.load(Ordering::SeqCst) {
                        return true;
                    }
                }
                tokio::select! {
                    changed = view.changed() => if changed.is_err() { return false },
                    _ = tokio::time::sleep(std::time::Duration::from_millis(5)) => {}
                }
            }
        })
        .await
        .unwrap_or(false)
    }

    /// Stops the watcher; tasks in flight are aborted (their files stay for the next start).
    pub fn stop(&self) {
        let _ = self.stop.send(true);
    }

    /// Waits until the watcher has stopped.
    pub async fn stopped(&self) {
        let mut view = self.view.clone();
        let _ = view.wait_for(|v| v.exited).await.map(|_| ());
    }
}

impl Drop for GameWatcherHandle {
    fn drop(&mut self) {
        let _ = self.stop.send(true);
    }
}

/// Starts the watcher and replays the queue at once (before League is looked for, as `host.ts` does).
pub fn spawn_game_watcher<P: GamePoster>(poster: Arc<P>, options: GameWatcherOptions) -> GameWatcherHandle {
    let (tx, rx) = mpsc::channel(1024);
    let (machine_tx, machine_rx) = mpsc::channel(WATCHER_QUEUE);
    let (stop_tx, stop_rx) = watch::channel(false);
    let last_posted = read_last_posted(&options.state_dir);
    let (view_tx, view_rx) = watch::channel(GameWatcherView {
        idle: true,
        last_posted: last_posted.clone(),
        ..Default::default()
    });
    let actor = Actor {
        poster,
        backoff: Backoff::new(options.backoff.clone()),
        options,
        tx: tx.clone(),
        view: view_tx,
        processed: 0,
        context: None,
        last_party: None,
        session_read: SessionRead::Idle,
        starts: HashMap::new(),
        in_progress_posted: HashSet::new(),
        settled: HashSet::new(),
        queued: HashSet::new(),
        dropped: HashSet::new(),
        in_progress_in_flight: 0,
        in_game: false,
        connect_reading: false,
        drain: Drain::Off,
        pass: VecDeque::new(),
        pass_pending: 0,
        wake: None,
        next_token: 0,
        last_posted,
        tasks: JoinSet::new(),
    };
    tokio::spawn(actor.run(rx, machine_rx, stop_rx));
    GameWatcherHandle {
        machine: machine_tx,
        tx,
        stop: stop_tx,
        sent: Arc::new(AtomicU64::new(0)),
        view: view_rx,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SessionRead {
    Idle,
    Reading,
    Done,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Drain {
    /// No pass running.
    Off,
    /// A pass is posting.
    Posting,
    /// Asleep between passes (retrying later).
    Waiting,
}

struct Actor<P> {
    poster: Arc<P>,
    options: GameWatcherOptions,
    backoff: Backoff,
    tx: mpsc::Sender<Msg>,
    view: watch::Sender<GameWatcherView>,
    processed: u64,
    context: Option<Arc<ConnectedContext>>,
    last_party: Option<String>,
    session_read: SessionRead,
    starts: HashMap<i64, HeldStart>,
    in_progress_posted: HashSet<i64>,
    settled: HashSet<String>,
    queued: HashSet<String>,
    dropped: HashSet<String>,
    in_progress_in_flight: usize,
    in_game: bool,
    connect_reading: bool,
    drain: Drain,
    pass: VecDeque<QueuedGame>,
    pass_pending: usize,
    wake: Option<(u64, Cancel)>,
    next_token: u64,
    last_posted: Option<LastPosted>,
    tasks: JoinSet<()>,
}

fn now_iso(clock: &Clock) -> String {
    crate::log::iso_timestamp(clock())
}

fn now_ms(clock: &Clock) -> i64 {
    clock()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

impl<P: GamePoster> Actor<P> {
    async fn run(
        mut self,
        mut rx: mpsc::Receiver<Msg>,
        mut machine: mpsc::Receiver<MachineEvent>,
        mut stop: watch::Receiver<bool>,
    ) {
        self.start_drain();
        self.publish();
        loop {
            tokio::select! {
                biased;
                _ = stop.wait_for(|s| *s) => break,
                event = machine.recv() => match event {
                    Some(event) => {
                        self.on_machine(event);
                        self.processed += 1;
                    }
                    None => break,
                },
                message = rx.recv() => {
                    if let Some(message) = message {
                        self.on_message(message);
                    }
                }
            }
            while self.tasks.try_join_next().is_some() {}
            self.publish();
        }
        if let Some((_, cancel)) = self.wake.take() {
            cancel();
        }
        self.tasks.shutdown().await;
        self.drain = Drain::Off;
        self.in_progress_in_flight = 0;
        self.session_read = SessionRead::Idle;
        self.connect_reading = false;
        self.publish();
        self.view.send_modify(|v| v.exited = true);
    }

    fn publish(&self) {
        let queued_files = queued_count(&self.options.state_dir);
        let idle = self.session_read != SessionRead::Reading
            && self.in_progress_in_flight == 0
            && !self.connect_reading
            && self.drain != Drain::Posting;
        let busy = self.in_game
            || self.in_progress_in_flight > 0
            || self.session_read == SessionRead::Reading
            || !self.queued.is_empty()
            || queued_files > 0;
        self.view.send_modify(|v| {
            v.idle = idle;
            v.processed = self.processed;
            v.busy = busy;
            v.last_posted = self.last_posted.clone();
            v.held_starts = self.starts.clone();
            v.settled_game_ids = self.settled.clone();
            v.party_id = self.last_party.clone();
            v.queued_files = queued_files;
            v.live_tasks = self.tasks.len();
        });
    }

    fn on_machine(&mut self, event: MachineEvent) {
        match event {
            MachineEvent::Connected(context) => self.on_connected(context),
            MachineEvent::Disconnected(_) => {
                self.in_game = false;
                self.session_read = SessionRead::Idle;
                self.context = None;
                // The stale-partyId fix: a dead connection's party is never carried onto a later game.
                self.last_party = None;
            }
            MachineEvent::Event(routed) => match routed.as_ref() {
                RoutedEvent::Lobby { event_type, lobby } => match lobby {
                    Some(lobby) if lobby.game_config.is_custom => {
                        self.last_party = Some(lobby.party_id.clone())
                    }
                    Some(_) => {}
                    None => {
                        // The lobby is gone (the game started, or it closed). A start already observed keeps the
                        // party it captured; anything after carries none until the next custom lobby.
                        tracing::debug!(component = "game", ?event_type, "lobby gone; no party held");
                        self.last_party = None;
                    }
                },
                RoutedEvent::GameflowPhase(phase) => self.on_phase(phase),
                RoutedEvent::EogBlock {
                    event_type,
                    block,
                    raw,
                } => match block {
                    Some(block) => self.capture(block, raw, &format!("{event_type:?}")),
                    None => tracing::debug!(
                        component = "game",
                        ?event_type,
                        "end-of-game block withdrawn; nothing to do"
                    ),
                },
                _ => {}
            },
        }
    }

    fn on_connected(&mut self, context: Arc<ConnectedContext>) {
        self.session_read = SessionRead::Idle;
        if let Some(phase) = context
            .phase
            .clone()
            .filter(|p| EOG_CONNECT_PHASES.contains(&p.as_str()))
        {
            self.connect_reading = true;
            let tx = self.tx.clone();
            let reader = context.clone();
            self.tasks.spawn(async move {
                let result = Box::new(reader.client.eog_stats_block().await);
                let _ = tx.send(Msg::ConnectBlock { phase, result }).await;
            });
        }
        // Keep the context for the session read.
        self.context = Some(context);
    }

    fn on_phase(&mut self, phase: &str) {
        self.in_game = START_PHASES.contains(&phase) || EOG_CONNECT_PHASES.contains(&phase);
        if !START_PHASES.contains(&phase) {
            self.session_read = SessionRead::Idle;
            return;
        }
        if self.session_read != SessionRead::Idle {
            // InProgress follows GameStart by tens of milliseconds; one read per game.
            return;
        }
        let Some(context) = self.context.clone() else {
            return;
        };
        self.session_read = SessionRead::Reading;
        let observed_at = now_iso(&self.options.clock);
        let party_id = self.last_party.clone();
        let tx = self.tx.clone();
        self.tasks.spawn(async move {
            let result = Box::new(context.client.gameflow_session().await);
            let _ = tx
                .send(Msg::SessionRead {
                    observed_at,
                    party_id,
                    result,
                })
                .await;
        });
    }

    fn on_message(&mut self, message: Msg) {
        match message {
            Msg::SessionRead {
                observed_at,
                party_id,
                result,
            } => self.on_session(observed_at, party_id, *result),
            Msg::InProgressDone {
                game_id,
                party_id,
                outcome,
            } => {
                self.in_progress_in_flight = self.in_progress_in_flight.saturating_sub(1);
                match outcome {
                    GamePostOutcome::Ok { lobby_id, .. } => {
                        tracing::info!(
                            component = "game",
                            gameId = game_id,
                            ?party_id,
                            ?lobby_id,
                            "game start posted"
                        );
                    }
                    failure => tracing::warn!(
                        component = "game",
                        gameId = game_id,
                        ?party_id,
                        outcome = ?failure,
                        "in_progress post failed; giving up on it (the end-of-game post carries the same ids)"
                    ),
                }
            }
            Msg::ConnectBlock { phase, result } => {
                self.connect_reading = false;
                match *result {
                    Ok(ok) => {
                        tracing::info!(component = "game", %phase, gameId = ok.value.game_id, "end-of-game block read at connect");
                        self.capture(&ok.value, &ok.raw, "connect");
                    }
                    Err(LcuFailure::Http { status: 404, .. }) => tracing::warn!(
                        component = "game",
                        %phase,
                        "connected on the end-of-game screen but the client no longer has the block; if it does not arrive over the socket the game is left to backfill (M5.1). Not asking again."
                    ),
                    Err(failure) => tracing::warn!(
                        component = "game",
                        %phase,
                        reason = %failure.describe(),
                        "could not read the end-of-game block at connect; not asking again"
                    ),
                }
            }
            Msg::QueuePosted { game, outcome } => self.on_queue_posted(*game, outcome),
            Msg::Wake { token } => {
                if self.wake.as_ref().map(|(t, _)| *t) == Some(token) {
                    self.wake = None;
                    self.next_pass();
                }
            }
            Msg::Enqueue {
                payload,
                origin,
                reply,
            } => {
                let outcome = self.enqueue(payload, origin);
                let _ = reply.send(outcome);
            }
        }
    }

    fn on_session(
        &mut self,
        observed_at: String,
        party_id: Option<String>,
        result: LcuResponse<GameflowSession>,
    ) {
        if self.session_read == SessionRead::Reading {
            self.session_read = SessionRead::Done;
        }
        let session = match result {
            Ok(ok) => ok.value,
            Err(failure) => {
                tracing::warn!(
                    component = "game",
                    reason = %failure.describe(),
                    "could not read the gameflow session at game start; no in_progress post (the end-of-game block carries its own id)"
                );
                return;
            }
        };
        if STALE_SESSION_PHASES.contains(&session.phase.as_str()) {
            tracing::warn!(component = "game", session_phase = %session.phase, "gameflow session is not in a game; its game id is stale and is not posted");
            return;
        }
        let game_id = session.game_data.game_id;
        if game_id <= 0 {
            tracing::warn!(
                component = "game",
                game_id,
                "gameflow session carries no game id at game start; no in_progress post"
            );
            return;
        }
        if !session.game_data.is_custom_game {
            tracing::info!(
                component = "game",
                game_id,
                "game is not a custom; no in_progress post"
            );
            return;
        }
        if !self.in_progress_posted.insert(game_id) {
            tracing::debug!(
                component = "game",
                game_id,
                "in_progress already posted for this game"
            );
            return;
        }
        self.starts.insert(
            game_id,
            HeldStart {
                game_id,
                started_at: observed_at.clone(),
                party_id: party_id.clone(),
            },
        );
        tracing::info!(component = "game", gameId = game_id, ?party_id, startedAt = %observed_at, "game started");
        let body = GamePayload::InProgress(InProgressPayload {
            game_id: u64::try_from(game_id).unwrap_or(0),
            party_id: party_id.clone(),
            started_at: Some(observed_at),
        });
        self.in_progress_in_flight += 1;
        let poster = self.poster.clone();
        let tx = self.tx.clone();
        self.tasks.spawn(async move {
            let outcome = poster.post_in_progress(&body).await;
            let _ = tx
                .send(Msg::InProgressDone {
                    game_id,
                    party_id,
                    outcome,
                })
                .await;
        });
    }

    /// Dedupe, drop what the server would refuse, map, queue, post.
    fn capture(&mut self, block: &EogStatsBlock, raw: &Value, source: &str) {
        let game_id = block.game_id.to_string();
        if self.settled.contains(&game_id)
            || self.queued.contains(&game_id)
            || has_queued(&self.options.state_dir, &game_id)
        {
            tracing::debug!(component = "game", gameId = %game_id, source, "end-of-game block already handled");
            return;
        }
        if self.dropped.contains(&game_id) {
            return;
        }
        if block.game_type != CUSTOM_GAME_TYPE {
            self.dropped.insert(game_id.clone());
            tracing::info!(component = "game", gameId = %game_id, gameType = %block.game_type, source, "end-of-game block is not a custom game; not posting it");
            return;
        }
        let held = self.starts.get(&block.game_id).cloned();
        let payload = map_eog(
            block,
            raw,
            held.as_ref().and_then(|h| h.party_id.clone()),
            held.as_ref().map(|h| h.started_at.clone()),
            now_ms(&self.options.clock),
        );
        if payload.winning_side.is_none() {
            self.dropped.insert(game_id.clone());
            tracing::warn!(
                component = "game",
                gameId = %game_id,
                source,
                durationS = block.game_length,
                "end-of-game block has no winning team (remake or TerminatedInError); not posting it"
            );
            return;
        }
        tracing::info!(
            component = "game",
            gameId = %game_id,
            source,
            startedAtFrom = if held.is_some() { "observed" } else { "derived" },
            participants = payload.participants.len(),
            "end-of-game block captured"
        );
        let body = match serde_json::to_value(GamePayload::Eog(payload)) {
            Ok(body) => body,
            Err(error) => {
                tracing::error!(component = "game", gameId = %game_id, %error, "end-of-game payload did not serialise");
                return;
            }
        };
        self.enqueue(body, Origin::Live);
    }

    /// Writes a payload to the queue and starts a drain. A second live copy of a game is a no-op; a backfill
    /// of that id is still posted so the server can copy draft bans onto the live row.
    fn enqueue(&mut self, payload: Value, origin: Origin) -> EnqueueOutcome {
        let Some(game_id) = payload
            .get("gameId")
            .and_then(Value::as_u64)
            .map(|id| id.to_string())
        else {
            return EnqueueOutcome::Refused;
        };
        let already = self.settled.contains(&game_id)
            || self.queued.contains(&game_id)
            || has_queued(&self.options.state_dir, &game_id);
        if already && origin != Origin::Backfill {
            tracing::debug!(component = "game", gameId = %game_id, ?origin, "game already handled; not queued again");
            return EnqueueOutcome::Duplicate;
        }
        // A backfill copy of a settled game is posted again (bans); forget the settle so the drain takes it.
        self.settled.remove(&game_id);
        let queued_at = now_iso(&self.options.clock);
        if let Err(reason) = write_queued(&self.options.state_dir, &game_id, &queued_at, &payload) {
            tracing::warn!(component = "queue", gameId = %game_id, %reason, "game not queued");
            return EnqueueOutcome::Refused;
        }
        self.queued.insert(game_id);
        self.start_drain();
        EnqueueOutcome::Queued
    }

    /// Starts a pass, or wakes a sleeping one (a capture never waits out a retry delay).
    fn start_drain(&mut self) {
        match self.drain {
            Drain::Posting => {}
            Drain::Waiting => {
                if let Some((_, cancel)) = self.wake.take() {
                    cancel();
                }
                self.begin_pass();
            }
            Drain::Off => self.begin_pass(),
        }
    }

    fn begin_pass(&mut self) {
        enforce_cap(&self.options.state_dir, self.options.max_queued);
        let mut games = read_queue(&self.options.state_dir);
        // A file whose delete failed after a 2xx is not posted again and again in a tight loop.
        games.retain(|game| !self.settled.contains(&game.game_id));
        if games.is_empty() {
            self.backoff.reset();
            self.drain = Drain::Off;
            return;
        }
        self.drain = Drain::Posting;
        self.pass = games.into();
        self.pass_pending = 0;
        self.next_pass();
    }

    /// Posts the next file of the pass, or ends the pass.
    fn next_pass(&mut self) {
        if self.drain == Drain::Waiting {
            // Woken by the timer.
            self.begin_pass();
            return;
        }
        let Some(game) = self.pass.pop_front() else {
            if self.pass_pending == 0 {
                // Everything landed; look again in case a game was captured meanwhile.
                self.backoff.reset();
                self.begin_pass();
            } else {
                let delay = self.backoff.next_delay();
                tracing::warn!(
                    component = "game",
                    pending = self.pass_pending,
                    delay_ms = delay.as_millis() as u64,
                    "queued games still pending; retrying later"
                );
                self.drain = Drain::Waiting;
                self.next_token += 1;
                let token = self.next_token;
                let tx = self.tx.clone();
                let cancel = self.options.scheduler.schedule(
                    delay,
                    Box::new(move || {
                        if tx.try_send(Msg::Wake { token }).is_err() {
                            tracing::warn!(
                                component = "game",
                                "game watcher inbox full; queue retry wake dropped"
                            );
                        }
                    }),
                );
                self.wake = Some((token, cancel));
            }
            return;
        };
        self.queued.insert(game.game_id.clone());
        let poster = self.poster.clone();
        let tx = self.tx.clone();
        self.tasks.spawn(async move {
            // The payload exactly as read from the file: a 0.3.x block goes out as it was captured.
            let outcome = poster.post_queued(&game.file.payload).await;
            let _ = tx
                .send(Msg::QueuePosted {
                    game: Box::new(game),
                    outcome,
                })
                .await;
        });
    }

    fn on_queue_posted(&mut self, game: QueuedGame, outcome: GamePostOutcome) {
        let game_id = game.game_id.clone();
        match &outcome {
            GamePostOutcome::Ok {
                created,
                participants,
                lobby_id,
            } => {
                tracing::info!(component = "game", gameId = %game_id, created, participants, ?lobby_id, queuedAt = %game.file.queued_at, "game posted");
                self.record_last_posted(&game.file.payload);
                self.settle(&game_id, "posted");
            }
            GamePostOutcome::Unreadable(reason) => {
                tracing::warn!(component = "game", gameId = %game_id, %reason, "game posted but the answer was unreadable; treating the 2xx as delivered");
                self.record_last_posted(&game.file.payload);
                self.settle(&game_id, "posted");
            }
            GamePostOutcome::Http { status, error } if PERMANENT_REFUSALS.contains(status) => {
                let backfilled = game.file.payload.get("source").and_then(Value::as_str) == Some("backfill");
                if backfilled {
                    tracing::warn!(component = "game", gameId = %game_id, status, %error, "api refused the backfilled game for good; deleting the queued copy (it is not fetched again unless backfill.json is deleted)");
                } else {
                    tracing::warn!(component = "game", gameId = %game_id, status, %error, "api refused the game for good; deleting the queued copy (the game is left to backfill)");
                }
                self.settle(&game_id, "refused");
            }
            failure => {
                tracing::warn!(component = "game", gameId = %game_id, queuedAt = %game.file.queued_at, outcome = ?failure, "game post failed; the queued copy is kept and retried");
                self.pass_pending += 1;
            }
        }
        self.next_pass();
    }

    fn record_last_posted(&mut self, payload: &Value) {
        if payload.get("phase").and_then(Value::as_str) != Some("eog") {
            return;
        }
        let winning_side = match payload.get("winningSide").and_then(Value::as_u64) {
            Some(100) => Side::Blue,
            Some(200) => Side::Red,
            _ => return,
        };
        let value = LastPosted {
            at: now_iso(&self.options.clock),
            winning_side,
            duration_s: payload.get("durationS").and_then(Value::as_u64).unwrap_or(0),
        };
        write_last_posted(&self.options.state_dir, &value);
        self.last_posted = Some(value);
    }

    fn settle(&mut self, game_id: &str, how: &str) {
        self.settled.insert(game_id.to_owned());
        self.queued.remove(game_id);
        delete_queued(&self.options.state_dir, game_id);
        if let Ok(numeric) = game_id.parse::<i64>() {
            self.starts.remove(&numeric);
        }
        tracing::debug!(component = "game", gameId = %game_id, how, "queued game settled");
    }
}
