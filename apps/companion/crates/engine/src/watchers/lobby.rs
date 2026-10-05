//! The lobby watcher (parity row 12, port of `apps/companion/src/lobbyWatcher.ts`): a faithful mirror of
//! `/lol-lobby/v2/lobby`, pushed to `POST /api/companion/lobby` the instant it changes. It decides nothing.
//!
//! Posting rules, identical to the TypeScript engine (the goldens pin the bodies):
//! - **Every** lobby `Create`/`Update` is posted, changed or not: no dedupe against the last body sent (the
//!   server dedupes). A `Delete` posts nothing (it fires after `GameStart`; an empty roster would wipe the
//!   ten people the game post needs).
//! - At most one POST in flight, **one attempt each**; the newest payload waits and everything it superseded
//!   is dropped. A failed post (network, 5xx) is retried with backoff only while it is still the newest; a
//!   new payload starts its own retry schedule.
//! - `recheckInMs` in the answer re-posts the identical payload unless a newer one lands first;
//!   `ranksNeeded` goes out as [`LobbySignal::RanksNeeded`]; `rosterFrozen` is logged once per party.
//! - A 403 stops posting that party until its next `Create`.
//! - Names never hold a post up: unknown puuids go out with `null` names, are looked up once per process
//!   in the background (one every `lookup_interval`), and the roster is re-posted once when the lookups
//!   change something.
//! - One `GET /lol-lobby/v2/lobby` at connect, superseded by any lobby event that lands first.
//!
//! For the game watcher (M17.9) it emits [`LobbySignal::CustomLobby`] for every custom lobby seen and
//! [`LobbySignal::LobbyGone`] on a `Delete` and on a disconnect, so the held `partyId` can be cleared (the
//! stale-partyId fix, decision row 2026-10-04).
//!
//! Posting goes through [`LobbyPoster`], a narrow seam: M17.6's API client implements it, tests use a fake.
//! Log fields are ids and counts, never a lobby body (it carries chat credentials).

use std::collections::{HashMap, HashSet, VecDeque};
use std::future::Future;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use tokio::sync::{mpsc, watch};
use tokio::task::JoinSet;

use super::connection::{ConnectedContext, MachineEvent, WATCHER_QUEUE, WatcherFeed};
use crate::api::wire::LobbyPayload;
use crate::backoff::{Backoff, BackoffOptions};
use crate::lcu::events::{LcuEventType, RoutedEvent};
use crate::lcu::mapper::{NameCache, RiotIdName, is_lobby_bot, map_lobby, name_from_summoner};
use crate::lcu::types::Lobby;
use crate::lcu::{LcuFailure, LcuResponse};

/// The answer to a lobby post, as far as the watcher reads it (`companionLobbyResponseSchema`).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct LobbyAnswer {
    /// `open`, `balanced`, `in_game`, ...
    pub status: String,
    /// False when the party was already known.
    pub created: bool,
    /// Rows stored.
    pub member_count: u64,
    /// The roster is history; posts no longer change it.
    pub roster_frozen: bool,
    /// Re-post the same payload after this many ms (`null` since 2026-10-03, still obeyed).
    pub recheck_in_ms: Option<u64>,
    /// PUUIDs the server wants a rank for.
    pub ranks_needed: Vec<String>,
}

/// How one post went.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PostOutcome {
    /// 2xx and readable.
    Ok(LobbyAnswer),
    /// The API answered outside 2xx (after its one attempt). `error` is the envelope's message.
    Http {
        /// The status.
        status: u16,
        /// The envelope's `error`, or `HTTP <n>`.
        error: String,
    },
    /// No HTTP answer.
    Network(String),
    /// 2xx whose body could not be read: logged and dropped, never retried.
    Unreadable(String),
}

impl PostOutcome {
    fn retryable(&self) -> bool {
        matches!(self, PostOutcome::Network(_))
            || matches!(self, PostOutcome::Http { status, .. } if *status >= 500)
    }
}

/// Posts one lobby body, one attempt (the watcher owns retries). M17.6's API client implements this.
pub trait LobbyPoster: Send + Sync + 'static {
    /// `POST /api/companion/lobby` with `body`.
    fn post_lobby(&self, body: &LobbyPayload) -> impl Future<Output = PostOutcome> + Send;
}

/// The real poster: M17.6's API client, one attempt per post (`attempts::LOBBY`). A 2xx is `Ok`, a 4xx or
/// 5xx is `Http`, no answer is `Network`, and a 2xx that is not JSON or not the answer's shape is
/// `Unreadable` (logged and dropped by the watcher, never retried).
impl LobbyPoster for crate::api::ApiClient {
    async fn post_lobby(&self, body: &LobbyPayload) -> PostOutcome {
        use crate::api::ApiFailure;
        match crate::api::ApiClient::post_lobby(self, body).await {
            Ok(ok) => PostOutcome::Ok(LobbyAnswer {
                status: serde_json::to_value(ok.data.status)
                    .ok()
                    .and_then(|v| v.as_str().map(String::from))
                    .unwrap_or_default(),
                created: ok.data.created,
                member_count: ok.data.member_count,
                roster_frozen: ok.data.roster_frozen,
                recheck_in_ms: ok.data.recheck_in_ms,
                ranks_needed: ok.data.ranks_needed,
            }),
            Err(ApiFailure::Http { status, error, .. }) => PostOutcome::Http { status, error },
            Err(ApiFailure::Network { message, .. }) => PostOutcome::Network(message),
            Err(ApiFailure::Malformed { status, .. }) => {
                PostOutcome::Unreadable(format!("{status} not JSON"))
            }
            Err(ApiFailure::Schema { status, issues }) => {
                PostOutcome::Unreadable(format!("{status} {}", issues.join("; ")))
            }
        }
    }
}

/// Cancels a scheduled call.
pub type Cancel = Box<dyn FnOnce() + Send>;

/// Runs a closure after a delay (injected in tests, which fire timers by hand).
pub trait Scheduler: Send + Sync + 'static {
    /// Schedules `fire` after `delay`; the returned closure cancels it.
    fn schedule(&self, delay: Duration, fire: Box<dyn FnOnce() + Send>) -> Cancel;
}

/// Real timers on tokio.
#[derive(Debug, Clone, Copy, Default)]
pub struct TokioScheduler;

impl Scheduler for TokioScheduler {
    fn schedule(&self, delay: Duration, fire: Box<dyn FnOnce() + Send>) -> Cancel {
        let task = tokio::spawn(async move {
            tokio::time::sleep(delay).await;
            fire();
        });
        Box::new(move || task.abort())
    }
}

/// What the watcher tells the rest of the engine.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LobbySignal {
    /// A successful answer listed these puuids (rank sync, M17.10).
    RanksNeeded(Vec<String>),
    /// A custom lobby is open with this party (posted or not).
    CustomLobby {
        /// The party.
        party_id: String,
    },
    /// The lobby is gone: a `Delete` (the game started, or the lobby closed) or the client disconnected.
    LobbyGone {
        /// Why.
        reason: LobbyGoneReason,
    },
}

/// Why the lobby went away.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LobbyGoneReason {
    /// The client sent `Delete`.
    Deleted,
    /// The client went away.
    Disconnected,
}

/// Settings.
#[derive(Clone)]
pub struct LobbyWatcherOptions {
    /// Minimum spacing between two summoner lookups. Default 200 ms.
    pub lookup_interval: Duration,
    /// Retry backoff for a failed post while it is the newest. Default 1 s to 60 s.
    pub backoff: BackoffOptions,
    /// Timers.
    pub scheduler: Arc<dyn Scheduler>,
}

impl Default for LobbyWatcherOptions {
    fn default() -> Self {
        Self {
            lookup_interval: Duration::from_millis(200),
            backoff: BackoffOptions::default(),
            scheduler: Arc::new(TokioScheduler),
        }
    }
}

/// What the watcher shows from outside (tests, the window's "last lobby").
#[derive(Debug, Clone, Default)]
pub struct LobbyWatcherView {
    /// Nothing in flight, queued, being looked up or read at connect.
    pub idle: bool,
    /// Machine events handled so far.
    pub processed: u64,
    /// The last successful answer.
    pub last_response: Option<LobbyAnswer>,
    /// Names known to this process.
    pub known_names: NameCache,
    /// Lobby events (Create/Update/Delete) seen.
    pub lobby_events: u64,
    /// Background tasks (connect read, lookups, posts) not finished yet.
    pub live_tasks: usize,
    /// The watcher has stopped and every task it started is gone.
    pub exited: bool,
}

impl LobbyWatcherView {
    /// `ranksNeeded` of the last answer.
    pub fn ranks_needed(&self) -> Vec<String> {
        self.last_response
            .as_ref()
            .map(|r| r.ranks_needed.clone())
            .unwrap_or_default()
    }
}

#[derive(Debug, Clone, PartialEq)]
struct Item {
    payload: LobbyPayload,
    sequence: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Source {
    Create,
    Update,
    Connect,
    Names,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DeferKind {
    Recheck,
    Retry,
}

/// Room in the watcher's own inbox (answers from its tasks and timers). Its tasks wait for room; a timer
/// that finds it full is logged and dropped (it cannot wait, and a lost re-post is recovered by the next
/// lobby event).
const INBOX: usize = 1024;
/// Room for signals; a full queue drops the signal with a log line rather than stall lobby posting.
const SIGNALS: usize = 256;

enum Msg {
    ConnectRead {
        generation: u64,
        events_at_start: u64,
        result: Box<LcuResponse<Lobby>>,
    },
    PostDone {
        item: Item,
        outcome: PostOutcome,
    },
    Deferred {
        token: u64,
        item: Item,
        kind: DeferKind,
    },
    LookupDone {
        puuid: String,
        result: Result<RiotIdName, String>,
    },
}

/// The running watcher. Dropping the handle stops it.
pub struct LobbyWatcherHandle {
    machine: mpsc::Sender<MachineEvent>,
    stop: watch::Sender<bool>,
    sent: Arc<AtomicU64>,
    view: watch::Receiver<LobbyWatcherView>,
}

impl LobbyWatcherHandle {
    /// Hands a machine event to the watcher without waiting (tests; the machine uses [`Self::feed`]). A full
    /// inbox drops it with a log line.
    pub fn send(&self, event: MachineEvent) {
        self.sent.fetch_add(1, Ordering::SeqCst);
        if self.machine.try_send(event).is_err() {
            self.sent.fetch_sub(1, Ordering::SeqCst);
            tracing::warn!("lobby watcher inbox full or closed; machine event dropped");
        }
    }

    /// The feed the connection machine delivers into: bounded, the machine waits for room.
    pub fn feed(&self) -> WatcherFeed {
        WatcherFeed::counted(self.machine.clone(), self.sent.clone())
    }

    /// The live view.
    pub fn view(&self) -> watch::Receiver<LobbyWatcherView> {
        self.view.clone()
    }

    /// Waits until every event handed over so far is handled and nothing is in flight. `false` on timeout.
    pub async fn settled(&self, timeout: Duration) -> bool {
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
                    _ = tokio::time::sleep(Duration::from_millis(5)) => {}
                }
            }
        })
        .await
        .unwrap_or(false)
    }

    /// Stops the watcher: cancels the timer and aborts every task it started (connect read, lookups and an
    /// in-flight post, as the TS host aborts its API calls when a session ends).
    pub fn stop(&self) {
        let _ = self.stop.send(true);
    }

    /// Waits until the watcher has stopped and every task it started is gone.
    pub async fn stopped(&self) {
        let mut view = self.view.clone();
        let _ = view.wait_for(|v| v.exited).await.map(|_| ());
    }
}

impl Drop for LobbyWatcherHandle {
    fn drop(&mut self) {
        let _ = self.stop.send(true);
    }
}

/// Starts the watcher. Returns its handle and the stream of [`LobbySignal`]s.
pub fn spawn_lobby_watcher<P: LobbyPoster>(
    poster: Arc<P>,
    options: LobbyWatcherOptions,
) -> (LobbyWatcherHandle, mpsc::Receiver<LobbySignal>) {
    let (tx, rx) = mpsc::channel(INBOX);
    let (machine_tx, machine_rx) = mpsc::channel(WATCHER_QUEUE);
    let (stop_tx, stop_rx) = watch::channel(false);
    let (signals_tx, signals_rx) = mpsc::channel(SIGNALS);
    let (view_tx, view_rx) = watch::channel(LobbyWatcherView {
        idle: true,
        ..Default::default()
    });
    let actor = Actor {
        poster,
        retry_backoff: Backoff::new(options.backoff.clone()),
        options,
        tx: tx.clone(),
        signals: signals_tx,
        view: view_tx,
        processed: 0,
        context: None,
        generation: 0,
        connect_read_outstanding: false,
        current_lobby: None,
        latest: None,
        pending: None,
        in_flight: false,
        sequence: 0,
        deferred: None,
        next_token: 0,
        blocked_party: None,
        event_count: 0,
        last_response: None,
        frozen_logged: HashSet::new(),
        skipped_parties: HashSet::new(),
        names: HashMap::new(),
        looked_up: HashSet::new(),
        lookup_queue: VecDeque::new(),
        draining: false,
        lookup_changed: false,
        last_lookup_at: None,
        stopped: false,
        tasks: JoinSet::new(),
    };
    tokio::spawn(actor.run(rx, machine_rx, stop_rx));
    (
        LobbyWatcherHandle {
            machine: machine_tx,
            stop: stop_tx,
            sent: Arc::new(AtomicU64::new(0)),
            view: view_rx,
        },
        signals_rx,
    )
}

struct Actor<P> {
    poster: Arc<P>,
    options: LobbyWatcherOptions,
    retry_backoff: Backoff,
    tx: mpsc::Sender<Msg>,
    signals: mpsc::Sender<LobbySignal>,
    view: watch::Sender<LobbyWatcherView>,
    processed: u64,
    context: Option<Arc<ConnectedContext>>,
    generation: u64,
    connect_read_outstanding: bool,
    current_lobby: Option<Lobby>,
    latest: Option<Item>,
    pending: Option<Item>,
    in_flight: bool,
    sequence: u64,
    deferred: Option<(u64, Cancel)>,
    next_token: u64,
    blocked_party: Option<String>,
    event_count: u64,
    last_response: Option<LobbyAnswer>,
    frozen_logged: HashSet<String>,
    skipped_parties: HashSet<String>,
    names: NameCache,
    looked_up: HashSet<String>,
    lookup_queue: VecDeque<String>,
    draining: bool,
    lookup_changed: bool,
    last_lookup_at: Option<Instant>,
    stopped: bool,
    /// Every task this watcher started; aborted on stop so none outlives it.
    tasks: JoinSet<()>,
}

impl<P: LobbyPoster> Actor<P> {
    async fn run(
        mut self,
        mut rx: mpsc::Receiver<Msg>,
        mut machine: mpsc::Receiver<MachineEvent>,
        mut stop: watch::Receiver<bool>,
    ) {
        loop {
            tokio::select! {
                biased;
                _ = stop.wait_for(|s| *s) => break,
                event = machine.recv() => match event {
                    Some(event) => {
                        self.on_machine(event);
                        self.processed += 1;
                    }
                    // Every feed is gone and the handle too: nothing more will arrive.
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
        self.cancel_deferred();
        self.stopped = true;
        self.pending = None;
        self.context = None;
        self.current_lobby = None;
        self.lookup_queue.clear();
        self.draining = false;
        self.in_flight = false;
        self.connect_read_outstanding = false;
        self.tasks.shutdown().await;
        self.publish();
        self.view.send_modify(|view| view.exited = true);
    }

    fn on_message(&mut self, message: Msg) {
        {
            match message {
                Msg::ConnectRead {
                    generation,
                    events_at_start,
                    result,
                } => {
                    self.on_connect_read(generation, events_at_start, *result);
                }
                Msg::PostDone { item, outcome } => self.on_post_done(item, outcome),
                Msg::Deferred { token, item, kind } => self.on_deferred(token, item, kind),
                Msg::LookupDone { puuid, result } => self.on_lookup_done(puuid, result),
            }
        }
    }

    fn publish(&self) {
        let idle =
            !self.in_flight && self.pending.is_none() && !self.draining && !self.connect_read_outstanding;
        self.view.send_modify(|view| {
            view.idle = idle;
            view.processed = self.processed;
            view.last_response = self.last_response.clone();
            view.known_names = self.names.clone();
            view.lobby_events = self.event_count;
            view.live_tasks = self.tasks.len();
        });
    }

    fn signal(&self, signal: LobbySignal) {
        if let Err(mpsc::error::TrySendError::Full(signal)) = self.signals.try_send(signal) {
            tracing::warn!(?signal, "lobby signal queue full; signal dropped");
        }
    }

    fn on_machine(&mut self, event: MachineEvent) {
        match event {
            MachineEvent::Connected(context) => self.on_connected(context),
            MachineEvent::Disconnected(_) => {
                self.context = None;
                self.current_lobby = None;
                self.cancel_deferred();
                self.signal(LobbySignal::LobbyGone {
                    reason: LobbyGoneReason::Disconnected,
                });
            }
            MachineEvent::Event(routed) => {
                if let RoutedEvent::Lobby { event_type, lobby } = routed.as_ref() {
                    self.on_lobby_event(*event_type, lobby.as_deref());
                }
            }
        }
    }

    fn on_connected(&mut self, context: Arc<ConnectedContext>) {
        self.generation += 1;
        if let Some(summoner) = &context.summoner {
            self.names
                .insert(summoner.puuid.clone(), name_from_summoner(summoner));
            self.looked_up.insert(summoner.puuid.clone());
        }
        self.context = Some(context.clone());
        let generation = self.generation;
        let events_at_start = self.event_count;
        self.connect_read_outstanding = true;
        let tx = self.tx.clone();
        self.tasks.spawn(async move {
            let result = Box::new(context.client.lobby().await);
            let _ = tx
                .send(Msg::ConnectRead {
                    generation,
                    events_at_start,
                    result,
                })
                .await;
        });
    }

    fn on_connect_read(&mut self, generation: u64, events_at_start: u64, result: LcuResponse<Lobby>) {
        self.connect_read_outstanding = false;
        if self.stopped
            || generation != self.generation
            || self.context.is_none()
            || self.event_count != events_at_start
        {
            tracing::debug!("lobby read at connect superseded by an event");
            return;
        }
        match result {
            Ok(ok) => {
                tracing::info!(
                    party_id = %ok.value.party_id,
                    members = ok.value.members.len(),
                    "already in a lobby at connect"
                );
                self.handle_lobby(ok.value, Source::Connect);
            }
            Err(LcuFailure::Http { status: 404, .. }) => tracing::debug!("no lobby open at connect"),
            Err(failure) => {
                tracing::warn!(reason = %failure.describe(), "could not read the lobby at connect; waiting for events");
            }
        }
    }

    fn on_lobby_event(&mut self, event_type: LcuEventType, lobby: Option<&Lobby>) {
        self.event_count += 1;
        let Some(lobby) = lobby else {
            // Delete: nothing is posted; a deferred re-post of the old roster is superseded, but a coalesced
            // newest payload still goes out.
            self.sequence += 1;
            self.cancel_deferred();
            self.current_lobby = None;
            tracing::info!(event_type = ?event_type, "lobby closed; nothing posted");
            self.signal(LobbySignal::LobbyGone {
                reason: LobbyGoneReason::Deleted,
            });
            return;
        };
        if event_type == LcuEventType::Create {
            self.blocked_party = None;
        }
        let source = if event_type == LcuEventType::Create {
            Source::Create
        } else {
            Source::Update
        };
        self.handle_lobby(lobby.clone(), source);
    }

    fn handle_lobby(&mut self, lobby: Lobby, source: Source) {
        if !lobby.game_config.is_custom {
            if self.skipped_parties.insert(lobby.party_id.clone()) {
                tracing::info!(
                    party_id = %lobby.party_id,
                    queue_id = lobby.game_config.queue_id,
                    "lobby is not a custom game; not posting it"
                );
            }
            self.current_lobby = None;
            return;
        }
        self.signal(LobbySignal::CustomLobby {
            party_id: lobby.party_id.clone(),
        });
        let payload = map_lobby(&lobby, &self.names);
        self.current_lobby = Some(lobby.clone());
        if self.enqueue(payload, source) {
            // Names are only worth fetching for a roster that is actually being posted.
            self.schedule_lookups(&lobby);
        }
    }

    /// Makes `payload` the newest; false when the party is blocked after a 403.
    fn enqueue(&mut self, payload: LobbyPayload, source: Source) -> bool {
        if self.blocked_party.as_deref() == Some(payload.party_id.as_str()) {
            tracing::debug!(party_id = %payload.party_id, ?source, "lobby post skipped: party refused earlier");
            return false;
        }
        self.sequence += 1;
        self.cancel_deferred();
        // A new payload starts its own retry schedule; the old one's delays belonged to the old roster.
        self.retry_backoff.reset();
        let item = Item {
            payload,
            sequence: self.sequence,
        };
        self.latest = Some(item.clone());
        tracing::debug!(
            party_id = %item.payload.party_id,
            members = item.payload.members.len(),
            ?source,
            coalesced = self.in_flight,
            "lobby payload ready"
        );
        if self.in_flight {
            self.pending = Some(item);
        } else {
            self.post(item);
        }
        true
    }

    fn post(&mut self, item: Item) {
        self.in_flight = true;
        let poster = self.poster.clone();
        let tx = self.tx.clone();
        self.tasks.spawn(async move {
            let outcome = poster.post_lobby(&item.payload).await;
            let _ = tx.send(Msg::PostDone { item, outcome }).await;
        });
    }

    fn on_post_done(&mut self, item: Item, outcome: PostOutcome) {
        self.in_flight = false;
        self.handle_result(&item, outcome);
        if let Some(next) = self.pending.take() {
            if !self.stopped {
                self.post(next);
            }
        }
    }

    fn handle_result(&mut self, item: &Item, outcome: PostOutcome) {
        let party_id = item.payload.party_id.clone();
        let superseded = item.sequence != self.sequence;
        let retryable = outcome.retryable();
        match outcome {
            PostOutcome::Ok(answer) => {
                self.retry_backoff.reset();
                tracing::info!(
                    party_id = %party_id,
                    members = item.payload.members.len(),
                    status = %answer.status,
                    member_count = answer.member_count,
                    created = answer.created,
                    roster_frozen = answer.roster_frozen,
                    recheck_in_ms = ?answer.recheck_in_ms,
                    ranks_needed = answer.ranks_needed.len(),
                    "lobby posted"
                );
                if answer.roster_frozen && self.frozen_logged.insert(party_id.clone()) {
                    tracing::info!(
                        party_id = %party_id,
                        status = %answer.status,
                        member_count = answer.member_count,
                        "lobby roster is frozen on the server; posts no longer change it"
                    );
                }
                if !superseded {
                    if let Some(ms) = answer.recheck_in_ms {
                        self.defer(item.clone(), Duration::from_millis(ms), DeferKind::Recheck);
                    }
                }
                self.signal(LobbySignal::RanksNeeded(answer.ranks_needed.clone()));
                self.last_response = Some(answer);
            }
            PostOutcome::Http { status: 403, error } => {
                self.blocked_party = Some(party_id.clone());
                tracing::warn!(
                    party_id = %party_id,
                    status = 403,
                    %error,
                    "api refused the lobby post: this companion is not in that lobby; not posting the party again until the next Create"
                );
            }
            failure if retryable && !superseded => {
                let delay = self.retry_backoff.next_delay();
                tracing::warn!(party_id = %party_id, delay_ms = delay.as_millis() as u64, reason = ?failure, "lobby post failed; retrying while it is still the newest");
                self.defer(item.clone(), delay, DeferKind::Retry);
            }
            failure => {
                let (reason, status) = match &failure {
                    PostOutcome::Http { status, .. } => ("http", Some(*status)),
                    PostOutcome::Network(_) => ("network", None),
                    PostOutcome::Unreadable(_) => ("schema", None),
                    PostOutcome::Ok(_) => ("ok", None),
                };
                tracing::warn!(party_id = %party_id, superseded, reason, ?status, "lobby post dropped");
            }
        }
    }

    fn defer(&mut self, item: Item, delay: Duration, kind: DeferKind) {
        self.cancel_deferred();
        if self.stopped {
            return;
        }
        self.next_token += 1;
        let token = self.next_token;
        let tx = self.tx.clone();
        let cancel = self.options.scheduler.schedule(
            delay,
            Box::new(move || {
                if tx.try_send(Msg::Deferred { token, item, kind }).is_err() {
                    tracing::warn!(?kind, "lobby watcher inbox full; deferred re-post dropped");
                }
            }),
        );
        self.deferred = Some((token, cancel));
    }

    fn cancel_deferred(&mut self) {
        if let Some((_, cancel)) = self.deferred.take() {
            cancel();
        }
    }

    fn on_deferred(&mut self, token: u64, item: Item, kind: DeferKind) {
        if self.deferred.as_ref().map(|(t, _)| *t) != Some(token) {
            return;
        }
        self.deferred = None;
        if item.sequence != self.sequence {
            tracing::debug!(party_id = %item.payload.party_id, ?kind, "lobby deferred post skipped: a newer payload landed");
            return;
        }
        tracing::debug!(party_id = %item.payload.party_id, ?kind, "lobby deferred post: re-posting the same payload");
        if self.in_flight {
            self.pending = Some(item);
        } else {
            self.post(item);
        }
    }

    fn schedule_lookups(&mut self, lobby: &Lobby) {
        for member in &lobby.members {
            if is_lobby_bot(member) || self.looked_up.contains(&member.puuid) {
                continue;
            }
            self.looked_up.insert(member.puuid.clone());
            self.lookup_queue.push_back(member.puuid.clone());
        }
        if !self.draining && !self.lookup_queue.is_empty() {
            self.draining = true;
            self.lookup_changed = false;
            self.next_lookup();
        }
    }

    /// Starts the next lookup in the queue, or ends the drain (re-posting once if a name arrived).
    fn next_lookup(&mut self) {
        if self.stopped {
            self.draining = false;
            return;
        }
        let Some(context) = self.context.clone() else {
            // Disconnected before these were asked: let the next connection ask.
            for puuid in self.lookup_queue.drain(..) {
                self.looked_up.remove(&puuid);
            }
            self.finish_drain();
            return;
        };
        let Some(puuid) = self.lookup_queue.pop_front() else {
            self.finish_drain();
            return;
        };
        let wait = self
            .last_lookup_at
            .map(|at| self.options.lookup_interval.saturating_sub(at.elapsed()))
            .unwrap_or_default();
        let tx = self.tx.clone();
        self.tasks.spawn(async move {
            tokio::time::sleep(wait).await;
            let result = match context.client.summoner_by_puuid(&puuid).await {
                Ok(ok) => Ok(name_from_summoner(&ok.value)),
                Err(failure) => Err(failure.describe()),
            };
            let _ = tx.send(Msg::LookupDone { puuid, result }).await;
        });
    }

    fn on_lookup_done(&mut self, puuid: String, result: Result<RiotIdName, String>) {
        self.last_lookup_at = Some(Instant::now());
        match result {
            Ok(name) => {
                self.names.insert(puuid.clone(), name);
                self.lookup_changed = true;
                tracing::debug!(%puuid, "summoner name resolved");
            }
            Err(reason) => {
                tracing::warn!(%puuid, %reason, "summoner lookup failed; the roster is posted without that name");
            }
        }
        self.next_lookup();
    }

    fn finish_drain(&mut self) {
        self.draining = false;
        if std::mem::take(&mut self.lookup_changed) {
            self.repost_with_names();
        }
    }

    /// One coalesced re-post with the names filled in, only when it changes what was last sent.
    fn repost_with_names(&mut self) {
        let Some(lobby) = self.current_lobby.clone() else {
            return;
        };
        let payload = map_lobby(&lobby, &self.names);
        if self
            .latest
            .as_ref()
            .is_some_and(|latest| latest.payload == payload)
        {
            return;
        }
        self.enqueue(payload, Source::Names);
    }
}
