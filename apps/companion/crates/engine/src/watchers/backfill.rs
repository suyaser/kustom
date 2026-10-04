//! Backfill (parity row 18, port of `apps/companion/src/backfill.ts`, M5.1): walk the local player's match
//! history, find the customs the server has never heard of, fetch each one's detail and hand it to the game
//! watcher's queue as `source: "backfill"`. Background work, never on the path of a lobby post.
//!
//! - **When.** 60 s after the first connect, then every 6 h. A pass that stops with work left (the detail
//!   cap, the page cap, a pause, a failed scan) comes back in 10 min. Nothing runs unless the client is idle
//!   (`None` or `Lobby`); a timer that fires mid-game is put back 10 min, and a pass in flight stops where
//!   it stands when the phase changes or the client goes.
//! - **The walk.** `GET /lol-match-history/v1/products/lol/{puuid}/matches` in pages of 20 (inclusive
//!   windows, the overlap deduped), at most 5 pages per pass, never past position 200. A fresh install walks
//!   the whole window across passes (`resumeBegIndex`); after that a pass starts at 0 and stops at the first
//!   page whose customs are all known. A short page, or a 4xx past the first page, is the end.
//! - **The scan.** `POST /api/companion/backfill/scan`, 100 ids a call, 200 a pass. Every scan is answered
//!   (no approval step since 2026-10-03); a 403 means the token's player left its group: one sentence, and
//!   nothing until the next 6 h pass.
//! - **Details.** `GET /lol-match-history/v1/games/{gameId}` for the unknown ids, at most 20 a pass, one at
//!   a time, at least 2 s apart; mapped with [`map_match_detail`]; dropped with one line naming the id when
//!   not a completed `CUSTOM_GAME` with ten participants and a winner. A game captured live is posted again
//!   so the server can copy the bans.
//! - **The cache.** `<stateDir>/backfill.json` (version 2), tmp-file-and-rename, owner-only. It saves
//!   detail fetches and nothing else: delete it and the next pass re-walks and re-scans.
//!
//! Read-only against the client. Log fields are ids, indexes and counts; never a body.

use std::collections::{HashSet, VecDeque};
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::{mpsc, oneshot, watch};
use tokio::task::JoinSet;

use super::connection::{ConnectedContext, MachineEvent, WATCHER_QUEUE, WatcherFeed};
use super::game::{CUSTOM_GAME_TYPE, EnqueueOutcome, GameEnqueuer, Origin};
use super::lobby::{Cancel, Scheduler, TokioScheduler};
use crate::api::ApiFailure;
use crate::api::wire::BackfillScanRequest;
use crate::lcu::LcuFailure;
use crate::lcu::events::RoutedEvent;
use crate::lcu::mapper::{UnmappedTimelinePair, map_match_detail};
use crate::lcu::types::MatchGame;
use crate::log::Clock;

/// The cache file in the group's state dir.
pub const BACKFILL_CACHE_FILE: &str = "backfill.json";
/// The cache version; any other is an empty cache.
pub const BACKFILL_CACHE_VERSION: u32 = 2;
/// Ids remembered as handled. Over this the oldest are forgotten, which costs a scan, not a post.
pub const MAX_KNOWN_GAME_IDS: usize = 2000;
/// One list page.
pub const PAGE_SIZE: u32 = 20;
/// List pages a pass.
pub const MAX_PAGES_PER_PASS: u32 = 5;
/// The walk never asks for a position past this.
pub const MAX_WALK_DEPTH: u32 = 200;
/// Passes in a row stuck on the same page before the deep cursor is given up.
pub const MAX_WALK_STRIKES: u32 = 3;
/// Details a pass.
pub const MAX_DETAILS_PER_PASS: usize = 20;
/// Between two detail fetches.
pub const DETAIL_INTERVAL: Duration = Duration::from_secs(2);
/// Ids per scan call (`BACKFILL_SCAN_BATCH_SIZE`).
pub const SCAN_BATCH_SIZE: usize = 100;
/// Ids scanned a pass; the rest wait in the cache.
pub const MAX_SCANNED_PER_PASS: usize = 200;
/// After the first connect.
pub const FIRST_PASS_DELAY: Duration = Duration::from_secs(60);
/// After a finished pass.
pub const PASS_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
/// After a pass that left work.
pub const RETRY_INTERVAL: Duration = Duration::from_secs(10 * 60);
/// The phases in which backfill may talk to the client at all.
pub const IDLE_PHASES: [&str; 2] = ["None", "Lobby"];
/// `endOfGameResult` of a finished game.
pub const GAME_COMPLETE: &str = "GameComplete";
/// The one sentence for a scan the server refused (403).
pub const SCAN_REFUSED_MESSAGE: &str =
    "Backfill was refused: this token's player is no longer a member of its group. Nothing was sent.";

// --- seams ---------------------------------------------------------------------------------------------------

/// How a scan call went.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScanOutcome {
    /// The ids of the batch the server still wants a detail for.
    Unknown(Vec<u64>),
    /// 403: the token's player is no longer in its group.
    Refused,
    /// Anything else, briefly.
    Failed(String),
}

/// `POST /api/companion/backfill/scan`. M17.6's API client implements it; tests use a fake.
pub trait BackfillScanner: Send + Sync + 'static {
    /// One batch of at most [`SCAN_BATCH_SIZE`] ids.
    fn scan(&self, game_ids: Vec<u64>) -> impl Future<Output = ScanOutcome> + Send;
}

impl BackfillScanner for crate::api::ApiClient {
    async fn scan(&self, game_ids: Vec<u64>) -> ScanOutcome {
        match self.backfill_scan(&BackfillScanRequest { game_ids }).await {
            Ok(ok) => ScanOutcome::Unknown(ok.data.unknown),
            Err(ApiFailure::Http { status: 403, .. }) => ScanOutcome::Refused,
            Err(failure) => ScanOutcome::Failed(failure.describe()),
        }
    }
}

/// Where a backfilled game goes: the game watcher's queue.
pub trait BackfillSink: Send + Sync + 'static {
    /// Queue it with origin backfill.
    fn enqueue(&self, payload: Value) -> impl Future<Output = EnqueueOutcome> + Send;
}

impl BackfillSink for GameEnqueuer {
    async fn enqueue(&self, payload: Value) -> EnqueueOutcome {
        GameEnqueuer::enqueue(self, payload, Origin::Backfill).await
    }
}

// --- the cache -----------------------------------------------------------------------------------------------

/// `<stateDir>/backfill.json` (`backfillCacheSchema`); key order as the TypeScript engine writes it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackfillCache {
    /// Always [`BACKFILL_CACHE_VERSION`].
    pub version: u32,
    /// ISO 8601.
    pub last_run_at: Option<String>,
    /// The deepest `begIndex` a list page was fetched at (M5.6 evidence).
    pub deepest_beg_index: u32,
    /// Handled: queued, known to the server, or dropped for good.
    pub known_game_ids: Vec<u64>,
    /// Scanned and unknown to the server, waiting for a detail.
    #[serde(default)]
    pub pending_game_ids: Vec<u64>,
    /// Where the first walk continues; `None` once it has seen the end.
    #[serde(default)]
    pub resume_beg_index: Option<u32>,
}

impl BackfillCache {
    /// A fresh install: the deep walk starts at 0.
    pub fn empty() -> Self {
        Self {
            version: BACKFILL_CACHE_VERSION,
            last_run_at: None,
            deepest_beg_index: 0,
            known_game_ids: Vec::new(),
            pending_game_ids: Vec::new(),
            resume_beg_index: Some(0),
        }
    }

    fn valid(&self) -> bool {
        self.version == BACKFILL_CACHE_VERSION
            && self
                .known_game_ids
                .iter()
                .chain(&self.pending_game_ids)
                .all(|id| *id > 0)
            && self
                .last_run_at
                .as_deref()
                .is_none_or(|at| crate::log::parse_iso_timestamp(at).is_some())
    }
}

/// The cache file. Never fails: a missing or unreadable file is an empty cache, a failed save a log line.
#[derive(Debug, Clone)]
pub struct BackfillStore {
    path: PathBuf,
}

impl BackfillStore {
    /// The store in `state_dir`.
    pub fn new(state_dir: &Path) -> Self {
        Self {
            path: state_dir.join(BACKFILL_CACHE_FILE),
        }
    }

    /// The file.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// The cache on disk, or an empty one.
    pub fn load(&self) -> BackfillCache {
        let text = match std::fs::read_to_string(&self.path) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return BackfillCache::empty(),
            Err(error) => {
                tracing::warn!(component = "backfill", error = %error.kind(), "backfill cache is unreadable; starting over (this costs fetches, nothing else)");
                return BackfillCache::empty();
            }
        };
        match serde_json::from_str::<BackfillCache>(&text) {
            Ok(cache) if cache.valid() => cache,
            _ => {
                tracing::warn!(
                    component = "backfill",
                    "backfill cache does not parse; starting over (this costs fetches, nothing else)"
                );
                BackfillCache::empty()
            }
        }
    }

    /// Writes it, trimmed to [`MAX_KNOWN_GAME_IDS`] (the newest known ids, the first pending ones).
    pub fn save(&self, cache: &BackfillCache) {
        let mut trimmed = cache.clone();
        if trimmed.known_game_ids.len() > MAX_KNOWN_GAME_IDS {
            let excess = trimmed.known_game_ids.len() - MAX_KNOWN_GAME_IDS;
            trimmed.known_game_ids.drain(..excess);
        }
        trimmed.pending_game_ids.truncate(MAX_KNOWN_GAME_IDS);
        let written = serde_json::to_string_pretty(&trimmed)
            .map_err(std::io::Error::other)
            .and_then(|body| super::write_private_file(&self.path, &format!("{body}\n")));
        if let Err(error) = written {
            tracing::warn!(component = "backfill", error = %error.kind(), "could not write the backfill cache");
        }
    }
}

// --- passes --------------------------------------------------------------------------------------------------

/// How a pass ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PassEnd {
    /// Nothing left until the next interval.
    Done,
    /// Work left; back in the retry interval.
    More,
    /// The client stopped being idle mid-pass.
    Paused,
    /// The server refused the token (403); back in the full interval.
    Refused,
    /// The scan call failed; back in the retry interval.
    ScanFailed,
    /// No client, not idle, or no local player.
    NoClient,
}

/// One pass, as logged.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PassSummary {
    /// ISO 8601.
    pub started_at: String,
    /// How it ended.
    pub end: PassEnd,
    /// List pages requested.
    pub pages: u32,
    /// The deepest `begIndex` ever fetched.
    pub deepest_beg_index: u32,
    /// The walk saw the end of history (or the depth cap).
    pub walk_ended: bool,
    /// Ids considered (pending plus fresh).
    pub candidates: usize,
    /// Ids scanned.
    pub scanned: usize,
    /// Details fetched.
    pub fetched: usize,
    /// Handed to the queue.
    pub queued: usize,
    /// Already in the queue.
    pub duplicates: usize,
    /// Dropped for good.
    pub dropped: usize,
    /// Left in the cache for the next pass.
    pub pending: usize,
}

impl PassSummary {
    fn empty(end: PassEnd, started_at: String) -> Self {
        Self {
            started_at,
            end,
            pages: 0,
            deepest_beg_index: 0,
            walk_ended: false,
            candidates: 0,
            scanned: 0,
            fetched: 0,
            queued: 0,
            duplicates: 0,
            dropped: 0,
            pending: 0,
        }
    }
}

/// Settings. Everything is injectable for tests.
#[derive(Clone)]
pub struct BackfillOptions {
    /// The group's state dir (`backfill.json` goes here).
    pub state_dir: PathBuf,
    /// For `startedAt`/`lastRunAt`.
    pub clock: Clock,
    /// Timers.
    pub scheduler: Arc<dyn Scheduler>,
    /// Default 60 s.
    pub first_delay: Duration,
    /// Default 6 h.
    pub interval: Duration,
    /// Default 10 min.
    pub retry_interval: Duration,
    /// Default 2 s.
    pub detail_interval: Duration,
    /// Default 20.
    pub page_size: u32,
    /// Default 5.
    pub max_pages_per_pass: u32,
    /// Default 200.
    pub max_depth: u32,
    /// Default 20.
    pub max_details_per_pass: usize,
}

impl BackfillOptions {
    /// The defaults for `state_dir`.
    pub fn new(state_dir: PathBuf) -> Self {
        Self {
            state_dir,
            clock: crate::log::system_clock(),
            scheduler: Arc::new(TokioScheduler),
            first_delay: FIRST_PASS_DELAY,
            interval: PASS_INTERVAL,
            retry_interval: RETRY_INTERVAL,
            detail_interval: DETAIL_INTERVAL,
            page_size: PAGE_SIZE,
            max_pages_per_pass: MAX_PAGES_PER_PASS,
            max_depth: MAX_WALK_DEPTH,
            max_details_per_pass: MAX_DETAILS_PER_PASS,
        }
    }
}

/// What backfill shows.
#[derive(Debug, Clone, Default)]
pub struct BackfillView {
    /// No pass running and every input handled.
    pub idle: bool,
    /// Machine events handled.
    pub processed: u64,
    /// Every pass this process ran, oldest first.
    pub passes: Vec<PassSummary>,
    /// The delay the pending timer was armed with.
    pub scheduled: Option<Duration>,
    /// Stopped.
    pub exited: bool,
}

#[derive(Clone, Default)]
struct Live {
    context: Option<Arc<ConnectedContext>>,
    phase: Option<String>,
    stopped: bool,
}

impl Live {
    fn idle_for(&self, context: &Arc<ConnectedContext>) -> bool {
        !self.stopped
            && self.context.as_ref().is_some_and(|c| Arc::ptr_eq(c, context))
            && self.phase.as_deref().is_some_and(|p| IDLE_PHASES.contains(&p))
    }
}

/// What the pass task shares with the actor across passes (in memory only).
#[derive(Default)]
struct Memory {
    walk_failures: Option<(u32, u32)>,
    logged_drops: HashSet<u64>,
    logged_pairs: HashSet<String>,
    no_player_logged: bool,
    last_detail_at: Option<Instant>,
}

enum Msg {
    Machine(MachineEvent),
    Timer { token: u64 },
    RunNow(oneshot::Sender<PassSummary>),
}

/// The running backfill. Dropping it stops it.
pub struct BackfillHandle {
    tx: mpsc::Sender<Msg>,
    machine: mpsc::Sender<MachineEvent>,
    stop: watch::Sender<bool>,
    sent: Arc<AtomicU64>,
    view: watch::Receiver<BackfillView>,
    store: BackfillStore,
}

impl BackfillHandle {
    /// The feed the connection machine delivers into.
    pub fn feed(&self) -> WatcherFeed {
        WatcherFeed::counted(self.machine.clone(), self.sent.clone())
    }

    /// Hands a machine event over without waiting (tests).
    pub fn send(&self, event: MachineEvent) {
        self.sent.fetch_add(1, Ordering::SeqCst);
        if self.machine.try_send(event).is_err() {
            self.sent.fetch_sub(1, Ordering::SeqCst);
        }
    }

    /// Runs a pass now instead of waiting for the timer (re-armed from the outcome); joins a running one.
    /// Still needs an idle client. `None` once stopped.
    pub async fn run_now(&self) -> Option<PassSummary> {
        let (reply, answer) = oneshot::channel();
        self.tx.send(Msg::RunNow(reply)).await.ok()?;
        answer.await.ok()
    }

    /// The cache as it is on disk.
    pub fn cache(&self) -> BackfillCache {
        self.store.load()
    }

    /// The view.
    pub fn view(&self) -> watch::Receiver<BackfillView> {
        self.view.clone()
    }

    /// Waits until every event is handled and no pass runs.
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

    /// Stops it: the timer is cancelled and a pass in flight is aborted (the cache is saved as it goes).
    pub fn stop(&self) {
        let _ = self.stop.send(true);
    }

    /// Waits until stopped.
    pub async fn stopped(&self) {
        let mut view = self.view.clone();
        let _ = view.wait_for(|v| v.exited).await.map(|_| ());
    }
}

impl Drop for BackfillHandle {
    fn drop(&mut self) {
        let _ = self.stop.send(true);
    }
}

/// Starts backfill.
pub fn spawn_backfill<S: BackfillScanner, K: BackfillSink>(
    scanner: Arc<S>,
    sink: Arc<K>,
    options: BackfillOptions,
) -> BackfillHandle {
    let (tx, rx) = mpsc::channel(WATCHER_QUEUE);
    let (machine_tx, mut machine_rx) = mpsc::channel::<MachineEvent>(WATCHER_QUEUE);
    let (stop_tx, stop_rx) = watch::channel(false);
    let (view_tx, view_rx) = watch::channel(BackfillView {
        idle: true,
        ..Default::default()
    });
    let (live_tx, live_rx) = watch::channel(Live::default());
    let forward = tx.clone();
    let mut forward_stop = stop_rx.clone();
    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = super::connection::until_stopped(&mut forward_stop) => return,
                event = machine_rx.recv() => match event {
                    Some(event) => if forward.send(Msg::Machine(event)).await.is_err() { return },
                    None => return,
                },
            }
        }
    });
    let store = BackfillStore::new(&options.state_dir);
    let pass = Arc::new(Pass {
        scanner,
        sink,
        store: store.clone(),
        options: options.clone(),
        live: live_rx,
        memory: Mutex::new(Memory::default()),
    });
    let actor = Actor {
        pass,
        options,
        tx: tx.clone(),
        live: live_tx,
        view: view_tx,
        processed: 0,
        started: false,
        timer: None,
        next_token: 0,
        waiting: Vec::new(),
        tasks: JoinSet::new(),
        passes: Vec::new(),
    };
    tokio::spawn(actor.run(rx, stop_rx));
    BackfillHandle {
        tx,
        machine: machine_tx,
        stop: stop_tx,
        sent: Arc::new(AtomicU64::new(0)),
        view: view_rx,
        store,
    }
}

struct Actor<S, K> {
    pass: Arc<Pass<S, K>>,
    options: BackfillOptions,
    tx: mpsc::Sender<Msg>,
    live: watch::Sender<Live>,
    view: watch::Sender<BackfillView>,
    processed: u64,
    started: bool,
    timer: Option<(u64, Duration, Cancel)>,
    next_token: u64,
    waiting: Vec<oneshot::Sender<PassSummary>>,
    tasks: JoinSet<PassSummary>,
    passes: Vec<PassSummary>,
}

impl<S: BackfillScanner, K: BackfillSink> Actor<S, K> {
    async fn run(mut self, mut rx: mpsc::Receiver<Msg>, mut stop: watch::Receiver<bool>) {
        loop {
            tokio::select! {
                biased;
                _ = stop.wait_for(|s| *s) => break,
                joined = self.tasks.join_next(), if !self.tasks.is_empty() => {
                    let summary = match joined {
                        Some(Ok(summary)) => summary,
                        _ => {
                            tracing::error!(component = "backfill", "backfill pass failed unexpectedly; trying again later");
                            PassSummary::empty(PassEnd::More, self.now_iso())
                        }
                    };
                    self.finished(summary);
                }
                message = rx.recv() => match message {
                    Some(Msg::Machine(event)) => { self.on_machine(event); self.processed += 1; }
                    Some(Msg::Timer { token }) => {
                        if self.timer.as_ref().is_some_and(|(t, _, _)| *t == token) {
                            self.timer = None;
                            self.tick();
                        }
                    }
                    Some(Msg::RunNow(reply)) => {
                        self.waiting.push(reply);
                        if self.tasks.is_empty() {
                            self.disarm();
                            self.tick();
                        }
                    }
                    None => break,
                },
            }
            self.publish();
        }
        self.live.send_modify(|live| live.stopped = true);
        self.disarm();
        self.tasks.shutdown().await;
        self.waiting.clear();
        self.publish();
        self.view.send_modify(|v| v.exited = true);
    }

    fn now_iso(&self) -> String {
        crate::log::iso_timestamp((self.options.clock)())
    }

    fn publish(&self) {
        let idle = self.tasks.is_empty();
        let processed = self.processed;
        let scheduled = self.timer.as_ref().map(|(_, delay, _)| *delay);
        let passes = self.passes.clone();
        self.view.send_modify(|v| {
            v.idle = idle;
            v.processed = processed;
            v.scheduled = scheduled;
            v.passes = passes;
        });
    }

    fn on_machine(&mut self, event: MachineEvent) {
        match event {
            MachineEvent::Connected(context) => {
                let phase = context.phase.clone();
                self.live.send_modify(|live| {
                    live.context = Some(context);
                    live.phase = phase;
                });
                if !self.started {
                    self.started = true;
                    self.arm(self.options.first_delay);
                }
            }
            MachineEvent::Disconnected(_) => self.live.send_modify(|live| {
                live.context = None;
                live.phase = None;
            }),
            MachineEvent::Event(routed) => {
                if let RoutedEvent::GameflowPhase(phase) = routed.as_ref() {
                    let phase = phase.clone();
                    self.live.send_modify(|live| live.phase = Some(phase));
                }
            }
        }
    }

    fn disarm(&mut self) {
        if let Some((_, _, cancel)) = self.timer.take() {
            cancel();
        }
    }

    fn arm(&mut self, delay: Duration) {
        self.disarm();
        self.next_token += 1;
        let token = self.next_token;
        let tx = self.tx.clone();
        let cancel = self.options.scheduler.schedule(
            delay,
            Box::new(move || {
                let _ = tx.try_send(Msg::Timer { token });
            }),
        );
        self.timer = Some((token, delay, cancel));
    }

    fn tick(&mut self) {
        if !self.tasks.is_empty() {
            return;
        }
        let pass = self.pass.clone();
        self.tasks.spawn(async move { pass.run().await });
    }

    fn finished(&mut self, summary: PassSummary) {
        let next = match summary.end {
            PassEnd::Done | PassEnd::Refused => self.options.interval,
            _ => self.options.retry_interval,
        };
        self.arm(next);
        for reply in self.waiting.drain(..) {
            let _ = reply.send(summary.clone());
        }
        self.passes.push(summary);
    }
}

// --- one pass ------------------------------------------------------------------------------------------------

struct Pass<S, K> {
    scanner: Arc<S>,
    sink: Arc<K>,
    store: BackfillStore,
    options: BackfillOptions,
    live: watch::Receiver<Live>,
    memory: Mutex<Memory>,
}

struct Walk {
    fresh: Vec<u64>,
    pages: u32,
    deepest: u32,
    resume: Option<u32>,
    ended: bool,
    paused: bool,
    error: bool,
}

#[derive(Default)]
struct Fetched {
    fetched: usize,
    queued: usize,
    duplicates: usize,
    dropped: usize,
    leftover: Vec<u64>,
    paused: bool,
}

enum Scanned {
    Ok { unknown: Vec<u64>, scanned: usize },
    Refused { scanned: usize },
    Failed { scanned: usize },
}

enum Handled {
    Queued,
    Duplicate,
    Dropped,
    Refused,
}

fn is_complete(result: Option<&str>) -> bool {
    result.is_none_or(|r| r == GAME_COMPLETE)
}

fn dedupe(ids: impl IntoIterator<Item = u64>) -> Vec<u64> {
    let mut seen = HashSet::new();
    ids.into_iter().filter(|id| seen.insert(*id)).collect()
}

impl<S: BackfillScanner, K: BackfillSink> Pass<S, K> {
    fn memory(&self) -> std::sync::MutexGuard<'_, Memory> {
        self.memory
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn idle(&self, context: &Arc<ConnectedContext>) -> bool {
        self.live.borrow().idle_for(context)
    }

    fn phase(&self) -> Option<String> {
        self.live.borrow().phase.clone()
    }

    fn now_iso(&self) -> String {
        crate::log::iso_timestamp((self.options.clock)())
    }

    async fn run(&self) -> PassSummary {
        let started_at = self.now_iso();
        let context = self.live.borrow().context.clone();
        let Some(context) = context.filter(|c| self.idle(c)) else {
            tracing::debug!(component = "backfill", phase = ?self.phase(), "backfill pass skipped: the client is not idle");
            return PassSummary::empty(PassEnd::NoClient, started_at);
        };
        let Some(puuid) = context.summoner.as_ref().map(|s| s.puuid.clone()) else {
            let mut memory = self.memory();
            if !memory.no_player_logged {
                memory.no_player_logged = true;
                tracing::warn!(
                    component = "backfill",
                    "backfill skipped: the local player is unknown (current-summoner did not answer)"
                );
            }
            return PassSummary::empty(PassEnd::NoClient, started_at);
        };

        let mut cache = self.store.load();
        // `known` keeps insertion order (the file keeps the newest at the end).
        let mut known = Known::from(cache.known_game_ids.clone());
        let pending: Vec<u64> = cache
            .pending_game_ids
            .iter()
            .copied()
            .filter(|id| !known.has(*id))
            .collect();

        // 1. The walk.
        let walk = self.walk(&context, &puuid, &cache, &mut known, &pending).await;
        cache.deepest_beg_index = walk.deepest;
        cache.resume_beg_index = walk.resume;
        let candidates = dedupe(pending.iter().copied().chain(walk.fresh.iter().copied()));

        let mut summary = PassSummary::empty(PassEnd::Done, started_at);
        let mut leftover: Vec<u64> = candidates.clone();
        let end = if candidates.is_empty() {
            if walk.paused {
                PassEnd::Paused
            } else if walk.error || cache.resume_beg_index.is_some() {
                PassEnd::More
            } else {
                PassEnd::Done
            }
        } else {
            // 2. The scan.
            let cut = candidates.len().min(MAX_SCANNED_PER_PASS);
            let (to_scan, unscanned) = candidates.split_at(cut);
            match self.scan(to_scan, &mut known).await {
                Scanned::Refused { scanned } => {
                    summary.scanned = scanned;
                    tracing::warn!(component = "backfill", "{SCAN_REFUSED_MESSAGE}");
                    PassEnd::Refused
                }
                Scanned::Failed { scanned } => {
                    summary.scanned = scanned;
                    PassEnd::ScanFailed
                }
                Scanned::Ok { unknown, scanned } => {
                    summary.scanned = scanned;
                    // 3. The details.
                    let cut = unknown.len().min(self.options.max_details_per_pass);
                    let (fetch_now, later) = unknown.split_at(cut);
                    let fetched = self
                        .fetch_details(&context, fetch_now, &mut known, &mut cache)
                        .await;
                    summary.fetched = fetched.fetched;
                    summary.queued = fetched.queued;
                    summary.duplicates = fetched.duplicates;
                    summary.dropped = fetched.dropped;
                    leftover = fetched
                        .leftover
                        .iter()
                        .chain(later)
                        .chain(unscanned)
                        .copied()
                        .collect();
                    if fetched.paused || walk.paused {
                        PassEnd::Paused
                    } else if !leftover.is_empty() || walk.error || cache.resume_beg_index.is_some() {
                        PassEnd::More
                    } else {
                        PassEnd::Done
                    }
                }
            }
        };

        cache.known_game_ids = known.ids();
        cache.pending_game_ids = dedupe(leftover)
            .into_iter()
            .filter(|id| !known.has(*id))
            .collect();
        cache.last_run_at = Some(self.now_iso());
        self.store.save(&cache);

        summary.end = end;
        summary.pages = walk.pages;
        summary.deepest_beg_index = cache.deepest_beg_index;
        summary.walk_ended = walk.ended;
        summary.candidates = candidates.len();
        summary.pending = cache.pending_game_ids.len();
        tracing::info!(
            component = "backfill",
            end = ?summary.end,
            pages = summary.pages,
            deepestBegIndex = summary.deepest_beg_index,
            walkEnded = summary.walk_ended,
            candidates = summary.candidates,
            scanned = summary.scanned,
            fetched = summary.fetched,
            queued = summary.queued,
            duplicates = summary.duplicates,
            dropped = summary.dropped,
            pending = summary.pending,
            resumeBegIndex = ?cache.resume_beg_index,
            known = cache.known_game_ids.len(),
            "backfill pass finished"
        );
        summary
    }

    // --- the walk ---

    async fn walk(
        &self,
        context: &Arc<ConnectedContext>,
        puuid: &str,
        cache: &BackfillCache,
        known: &mut Known,
        pending: &[u64],
    ) -> Walk {
        let deep = cache.resume_beg_index.is_some();
        let mut beg = cache.resume_beg_index.unwrap_or(0);
        let mut walk = Walk {
            fresh: Vec::new(),
            pages: 0,
            deepest: cache.deepest_beg_index,
            resume: None,
            ended: false,
            paused: false,
            error: false,
        };
        let mut give_up = false;
        let mut seen = HashSet::new();
        let pending: HashSet<u64> = pending.iter().copied().collect();
        let size = self.options.page_size;

        while walk.pages < self.options.max_pages_per_pass {
            if beg >= self.options.max_depth {
                walk.ended = true;
                tracing::info!(
                    component = "backfill",
                    begIndex = beg,
                    cap = self.options.max_depth,
                    "match history walk reached its depth cap"
                );
                break;
            }
            if !self.idle(context) {
                walk.paused = true;
                break;
            }
            let end = beg + size;
            let result = context.client.match_history(puuid, beg, end).await;
            walk.pages += 1;
            let list = match result {
                Ok(ok) => ok.value,
                Err(failure) => {
                    let status = failure.status();
                    let refused =
                        matches!(failure, LcuFailure::Http { status, .. } if (400..500).contains(&status));
                    if refused && beg > 0 {
                        walk.ended = true;
                        self.memory().walk_failures = None;
                        tracing::info!(component = "backfill", begIndex = beg, endIndex = end, status = ?status, "match history ends here (M5.6: the client refused a page past the window)");
                        break;
                    }
                    let strikes = self.note_walk_failure(beg);
                    tracing::warn!(component = "backfill", begIndex = beg, endIndex = end, reason = %failure.describe(), strikes, "match history page failed; the walk stops here and tries again later");
                    if deep && strikes >= MAX_WALK_STRIKES {
                        give_up = true;
                        self.memory().walk_failures = None;
                        tracing::warn!(
                            component = "backfill",
                            begIndex = beg,
                            strikes,
                            "match history walk gave up on this page; continuing from the newest games"
                        );
                    }
                    walk.error = true;
                    break;
                }
            };
            self.memory().walk_failures = None;
            walk.deepest = walk.deepest.max(beg);
            let games = &list.games;
            tracing::debug!(
                component = "backfill",
                begIndex = beg,
                endIndex = end,
                games = games.games.len(),
                gameCount = games.game_count,
                "match history page"
            );

            let mut customs = 0;
            let mut unknown_on_page = 0;
            for game in &games.games {
                let Ok(id) = u64::try_from(game.game_id) else {
                    continue;
                };
                if !seen.insert(id) {
                    continue;
                }
                if game.game_type != CUSTOM_GAME_TYPE {
                    self.drop_game(id, &format!("not a custom game ({})", game.game_type), false);
                    continue;
                }
                customs += 1;
                if known.has(id) {
                    continue;
                }
                if !is_complete(game.end_of_game_result.as_deref()) {
                    self.drop_game(
                        id,
                        &format!(
                            "not a completed game ({})",
                            game.end_of_game_result.as_deref().unwrap_or("no endOfGameResult")
                        ),
                        true,
                    );
                    known.add(id);
                    continue;
                }
                unknown_on_page += 1;
                if !pending.contains(&id) {
                    walk.fresh.push(id);
                }
            }

            if games.games.len() < size as usize {
                walk.ended = true;
                tracing::info!(
                    component = "backfill",
                    begIndex = beg,
                    endIndex = end,
                    games = games.games.len(),
                    gameCount = games.game_count,
                    "match history ends here (M5.6: the deepest page reached)"
                );
                break;
            }
            beg += size;
            if beg >= self.options.max_depth {
                walk.ended = true;
                tracing::info!(
                    component = "backfill",
                    begIndex = beg,
                    cap = self.options.max_depth,
                    "match history walk reached its depth cap"
                );
                break;
            }
            if !deep && customs > 0 && unknown_on_page == 0 {
                break;
            }
        }
        walk.resume = if deep && !(walk.ended || give_up) {
            Some(beg)
        } else {
            None
        };
        walk
    }

    fn note_walk_failure(&self, beg: u32) -> u32 {
        let mut memory = self.memory();
        let count = match memory.walk_failures {
            Some((at, count)) if at == beg => count + 1,
            _ => 1,
        };
        memory.walk_failures = Some((beg, count));
        count
    }

    // --- the scan ---

    async fn scan(&self, ids: &[u64], known: &mut Known) -> Scanned {
        let mut unknown = Vec::new();
        let mut scanned = 0;
        for batch in ids.chunks(SCAN_BATCH_SIZE) {
            if self.live.borrow().stopped {
                return Scanned::Failed { scanned };
            }
            match self.scanner.scan(batch.to_vec()).await {
                ScanOutcome::Refused => return Scanned::Refused { scanned },
                ScanOutcome::Failed(reason) => {
                    tracing::warn!(component = "backfill", gameIds = batch.len(), %reason, "backfill scan failed; trying again later");
                    return Scanned::Failed { scanned };
                }
                ScanOutcome::Unknown(answer) => {
                    scanned += batch.len();
                    let answer: HashSet<u64> = answer.into_iter().collect();
                    for id in batch {
                        if answer.contains(id) {
                            unknown.push(*id);
                        } else {
                            known.add(*id);
                        }
                    }
                }
            }
        }
        Scanned::Ok { unknown, scanned }
    }

    // --- the details ---

    async fn fetch_details(
        &self,
        context: &Arc<ConnectedContext>,
        ids: &[u64],
        known: &mut Known,
        cache: &mut BackfillCache,
    ) -> Fetched {
        let mut out = Fetched::default();
        for (index, &game_id) in ids.iter().enumerate() {
            if !self.idle(context) {
                out.paused = true;
                out.leftover.extend_from_slice(&ids[index..]);
                tracing::info!(component = "backfill", phase = ?self.phase(), left = ids.len() - index, "backfill paused: the client is busy; the rest waits for the next pass");
                break;
            }
            self.throttle().await;
            if !self.idle(context) {
                out.paused = true;
                out.leftover.extend_from_slice(&ids[index..]);
                break;
            }
            let result = context
                .client
                .match_detail(i64::try_from(game_id).unwrap_or(i64::MAX))
                .await;
            out.fetched += 1;
            match result {
                Err(failure) => {
                    let schema = matches!(failure, LcuFailure::Schema { .. });
                    if schema || failure.status() == Some(404) && matches!(failure, LcuFailure::Http { .. }) {
                        let reason = if schema {
                            "detail does not match the schema"
                        } else {
                            "detail is 404"
                        };
                        self.drop_game(game_id, reason, true);
                        known.add(game_id);
                        out.dropped += 1;
                    } else {
                        tracing::warn!(component = "backfill", gameId = game_id, reason = %failure.describe(), "match detail fetch failed; left for the next pass");
                        out.leftover.push(game_id);
                    }
                    continue;
                }
                Ok(ok) => match self.handle_detail(game_id, &ok.value, &ok.raw).await {
                    Handled::Refused => out.leftover.push(game_id),
                    handled => {
                        known.add(game_id);
                        match handled {
                            Handled::Queued => out.queued += 1,
                            Handled::Duplicate => out.duplicates += 1,
                            _ => out.dropped += 1,
                        }
                    }
                },
            }
            // Saved as we go: a pass cut short by a lid closing keeps what it fetched.
            cache.known_game_ids = known.ids();
            cache.pending_game_ids = out
                .leftover
                .iter()
                .chain(&ids[index + 1..])
                .chain(&cache.pending_game_ids)
                .copied()
                .filter(|id| !known.has(*id))
                .collect();
            self.store.save(cache);
        }
        out
    }

    async fn handle_detail(&self, game_id: u64, detail: &MatchGame, raw: &Value) -> Handled {
        if detail.game_type != CUSTOM_GAME_TYPE {
            self.drop_game(
                game_id,
                &format!("not a custom game ({})", detail.game_type),
                true,
            );
            return Handled::Dropped;
        }
        if !is_complete(detail.end_of_game_result.as_deref()) {
            self.drop_game(
                game_id,
                &format!(
                    "not a completed game ({})",
                    detail.end_of_game_result.as_deref().unwrap_or_default()
                ),
                true,
            );
            return Handled::Dropped;
        }
        let mut unmapped = Vec::new();
        let payload = map_match_detail(detail, raw, |pair| unmapped.push(pair));
        for pair in unmapped {
            self.note_unmapped_role(game_id, pair);
        }
        if payload.participants.len() != 10 {
            self.drop_game(
                game_id,
                &format!("{} participants, not ten", payload.participants.len()),
                true,
            );
            return Handled::Dropped;
        }
        let Some(winning_side) = payload.winning_side else {
            self.drop_game(game_id, "no winning team", true);
            return Handled::Dropped;
        };
        let (started_at, duration_s) = (payload.started_at.clone(), payload.duration_s);
        let Ok(body) = serde_json::to_value(crate::api::wire::GamePayload::Eog(payload)) else {
            return Handled::Refused;
        };
        match self.sink.enqueue(body).await {
            EnqueueOutcome::Queued => {
                tracing::info!(component = "backfill", gameId = game_id, startedAt = %started_at, durationS = duration_s, winningSide = ?winning_side, "backfilled game queued");
                Handled::Queued
            }
            EnqueueOutcome::Duplicate => {
                tracing::debug!(
                    component = "backfill",
                    gameId = game_id,
                    "backfilled game already in the queue"
                );
                Handled::Duplicate
            }
            // The queue said why; the id is tried again next pass.
            EnqueueOutcome::Refused => Handled::Refused,
        }
    }

    fn note_unmapped_role(&self, game_id: u64, pair: UnmappedTimelinePair) {
        if !self.memory().logged_pairs.insert(pair.key.clone()) {
            return;
        }
        tracing::info!(component = "backfill", gameId = game_id, lane = ?pair.lane, role = ?pair.role, "backfill: timeline pair has no verified role; stored as null");
    }

    fn drop_game(&self, game_id: u64, reason: &str, info: bool) {
        if !self.memory().logged_drops.insert(game_id) {
            return;
        }
        if info {
            tracing::info!(
                component = "backfill",
                gameId = game_id,
                reason,
                "backfill: game dropped"
            );
        } else {
            tracing::debug!(
                component = "backfill",
                gameId = game_id,
                reason,
                "backfill: game dropped"
            );
        }
    }

    /// At least `detail_interval` between two detail fetches.
    async fn throttle(&self) {
        let wait = {
            let memory = self.memory();
            memory
                .last_detail_at
                .map(|at| self.options.detail_interval.saturating_sub(at.elapsed()))
                .unwrap_or_default()
        };
        if !wait.is_zero() {
            tokio::time::sleep(wait).await;
        }
        self.memory().last_detail_at = Some(Instant::now());
    }
}

/// The known ids: a set for lookups and the insertion order for the file.
struct Known {
    order: VecDeque<u64>,
    set: HashSet<u64>,
}

impl From<Vec<u64>> for Known {
    fn from(ids: Vec<u64>) -> Self {
        let mut known = Known {
            order: VecDeque::new(),
            set: HashSet::new(),
        };
        for id in ids {
            known.add(id);
        }
        known
    }
}

impl Known {
    fn has(&self, id: u64) -> bool {
        self.set.contains(&id)
    }

    fn add(&mut self, id: u64) {
        if self.set.insert(id) {
            self.order.push_back(id);
        }
    }

    fn ids(&self) -> Vec<u64> {
        self.order.iter().copied().collect()
    }
}
