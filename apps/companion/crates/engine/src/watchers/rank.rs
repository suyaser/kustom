//! Rank and name sync (parity row 15, port of `apps/companion/src/rankSync.ts`). Two reads, one post, for
//! exactly the puuids the server asks about.
//!
//! - **Own rank** on the first connection and then every 6 hours (injected timer):
//!   `GET /lol-ranked/v1/current-ranked-stats`, mapped with `map_rank`, posted with the own Riot ID. A
//!   reconnect does not re-post; a timer that fired while disconnected posts on the next connect.
//! - **Everyone else:** only the lobby answer's `ranksNeeded` ([`RankSyncHandle::needed`]). For each puuid:
//!   `GET /lol-ranked/v1/ranked-stats/{puuid}`, then the summoner lookup unless the lobby watcher already
//!   knows the name, then one post. A puuid asked about within the hour is not asked again.
//! - A `/lol-ranked/v1/cached-ranked-stats/{puuid}` push replaces the GET for a puuid the server asked
//!   about; for anyone else it is dropped unread.
//! - Pacing: every client call (own and others, together) at least 200 ms apart. A failed read is one log
//!   line and is left for the next lobby answer; nothing here holds up a lobby post.
//!
//! The client's win/loss counters are never read for anyone; only tier, division and LP.

use std::collections::{HashMap, HashSet, VecDeque};
use std::future::Future;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime};

use tokio::sync::{Mutex as AsyncMutex, mpsc, watch};
use tokio::task::JoinSet;

use super::connection::{ConnectedContext, MachineEvent, WATCHER_QUEUE, WatcherFeed};
use super::lobby::{Cancel, Scheduler, TokioScheduler};
use crate::api::wire::RankPayload;
use crate::lcu::events::RoutedEvent;
use crate::lcu::mapper::{RiotIdName, map_rank, name_from_summoner};
use crate::lcu::types::RankedStats;
use crate::log::Clock;

/// Own rank every six hours.
pub const OWN_RANK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
/// A puuid asked about within this window is not asked again.
pub const ASKED_TTL: Duration = Duration::from_secs(60 * 60);
/// Five client calls a second, across ranks and names.
pub const CALL_INTERVAL: Duration = Duration::from_millis(200);

/// How a rank post went (the API client's two attempts).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RankPostOutcome {
    /// 2xx; `stored` false for a queue ratings are not seeded from.
    Ok {
        /// Whether the rank columns were written.
        stored: bool,
    },
    /// Anything else, briefly.
    Failed(String),
}

/// Posts a rank. M17.6's API client implements it; tests use a fake.
pub trait RankPoster: Send + Sync + 'static {
    /// `POST /api/companion/rank`.
    fn post_rank(&self, body: &RankPayload) -> impl Future<Output = RankPostOutcome> + Send;
}

impl RankPoster for crate::api::ApiClient {
    async fn post_rank(&self, body: &RankPayload) -> RankPostOutcome {
        match crate::api::ApiClient::post_rank(self, body).await {
            Ok(ok) => RankPostOutcome::Ok {
                stored: ok.data.stored,
            },
            Err(failure) => RankPostOutcome::Failed(format!("{failure:?}")),
        }
    }
}

/// Reads a name another part of the process already knows (the lobby watcher's cache).
pub type NameLookup = Arc<dyn Fn(&str) -> Option<RiotIdName> + Send + Sync>;

/// Settings.
#[derive(Clone)]
pub struct RankSyncOptions {
    /// The clock for the one-hour guard.
    pub clock: Clock,
    /// Timers (the six-hour own-rank timer).
    pub scheduler: Arc<dyn Scheduler>,
    /// Spacing between client calls. Default 200 ms.
    pub call_interval: Duration,
    /// Own-rank interval. Default 6 h.
    pub own_interval: Duration,
    /// The "asked recently" window. Default 1 h.
    pub asked_ttl: Duration,
    /// Names the lobby watcher already resolved (read, never written).
    pub names: Option<NameLookup>,
}

impl Default for RankSyncOptions {
    fn default() -> Self {
        Self {
            clock: crate::log::system_clock(),
            scheduler: Arc::new(TokioScheduler),
            call_interval: CALL_INTERVAL,
            own_interval: OWN_RANK_INTERVAL,
            asked_ttl: ASKED_TTL,
            names: None,
        }
    }
}

/// What the rank sync shows (tests).
#[derive(Debug, Clone, Default)]
pub struct RankSyncView {
    /// Nothing queued or in flight.
    pub idle: bool,
    /// Inputs handled.
    pub processed: u64,
    /// Background tasks alive.
    pub live_tasks: usize,
    /// Stopped.
    pub exited: bool,
}

enum Input {
    Machine(MachineEvent),
    Needed(Vec<String>),
}

enum Msg {
    OwnTimer { token: u64 },
    OwnDone,
    SyncDone { puuid: String, name: Option<RiotIdName> },
}

/// The running rank sync. Dropping it stops it.
pub struct RankSyncHandle {
    input: mpsc::Sender<Input>,
    stop: watch::Sender<bool>,
    sent: Arc<AtomicU64>,
    view: watch::Receiver<RankSyncView>,
    machine_feed: mpsc::Sender<MachineEvent>,
}

impl RankSyncHandle {
    /// The feed the connection machine delivers into.
    pub fn feed(&self) -> WatcherFeed {
        WatcherFeed::counted(self.machine_feed.clone(), self.sent.clone())
    }

    /// Hands a machine event over without waiting (tests).
    pub fn send(&self, event: MachineEvent) {
        self.sent.fetch_add(1, Ordering::SeqCst);
        if self.input.try_send(Input::Machine(event)).is_err() {
            self.sent.fetch_sub(1, Ordering::SeqCst);
        }
    }

    /// The server's list from the last lobby answer: the only puuids besides our own this fetches for.
    pub fn needed(&self, puuids: Vec<String>) {
        self.sent.fetch_add(1, Ordering::SeqCst);
        if self.input.try_send(Input::Needed(puuids)).is_err() {
            self.sent.fetch_sub(1, Ordering::SeqCst);
            tracing::warn!(
                component = "rank",
                "rank sync inbox full; ranksNeeded dropped (the next lobby answer repeats it)"
            );
        }
    }

    /// The view.
    pub fn view(&self) -> watch::Receiver<RankSyncView> {
        self.view.clone()
    }

    /// Waits until every input is handled and nothing is in flight.
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

    /// Stops it; tasks are aborted.
    pub fn stop(&self) {
        let _ = self.stop.send(true);
    }

    /// Waits until stopped.
    pub async fn stopped(&self) {
        let mut view = self.view.clone();
        let _ = view.wait_for(|v| v.exited).await.map(|_| ());
    }
}

impl Drop for RankSyncHandle {
    fn drop(&mut self) {
        let _ = self.stop.send(true);
    }
}

/// Starts the rank sync.
pub fn spawn_rank_sync<P: RankPoster>(poster: Arc<P>, options: RankSyncOptions) -> RankSyncHandle {
    let (input_tx, input_rx) = mpsc::channel(WATCHER_QUEUE);
    let (machine_tx, mut machine_rx) = mpsc::channel::<MachineEvent>(WATCHER_QUEUE);
    let (tx, rx) = mpsc::channel(256);
    let (stop_tx, stop_rx) = watch::channel(false);
    let (view_tx, view_rx) = watch::channel(RankSyncView {
        idle: true,
        ..Default::default()
    });
    // The machine's feed and the direct inputs are one ordered inbox.
    let forward = input_tx.clone();
    let mut forward_stop = stop_rx.clone();
    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = super::connection::until_stopped(&mut forward_stop) => return,
                event = machine_rx.recv() => match event {
                    Some(event) => if forward.send(Input::Machine(event)).await.is_err() { return },
                    None => return,
                },
            }
        }
    });
    let actor = Actor {
        poster,
        options,
        tx,
        view: view_tx,
        processed: 0,
        context: None,
        own_puuid: None,
        own_name: None,
        own_started: false,
        own_due: false,
        own_in_flight: false,
        own_timer: None,
        next_token: 0,
        asked: HashMap::new(),
        wanted: HashSet::new(),
        cached: HashMap::new(),
        own_names: HashMap::new(),
        queue: VecDeque::new(),
        draining: false,
        pacer: Arc::new(AsyncMutex::new(None)),
        tasks: JoinSet::new(),
    };
    tokio::spawn(actor.run(input_rx, rx, stop_rx));
    RankSyncHandle {
        input: input_tx,
        stop: stop_tx,
        sent: Arc::new(AtomicU64::new(0)),
        view: view_rx,
        machine_feed: machine_tx,
    }
}

struct Actor<P> {
    poster: Arc<P>,
    options: RankSyncOptions,
    tx: mpsc::Sender<Msg>,
    view: watch::Sender<RankSyncView>,
    processed: u64,
    context: Option<Arc<ConnectedContext>>,
    own_puuid: Option<String>,
    own_name: Option<RiotIdName>,
    own_started: bool,
    own_due: bool,
    own_in_flight: bool,
    own_timer: Option<(u64, Cancel)>,
    next_token: u64,
    asked: HashMap<String, SystemTime>,
    wanted: HashSet<String>,
    cached: HashMap<String, RankedStats>,
    own_names: HashMap<String, RiotIdName>,
    queue: VecDeque<String>,
    draining: bool,
    /// One gate for every client call, own and others: the time of the last call.
    pacer: Arc<AsyncMutex<Option<Instant>>>,
    tasks: JoinSet<()>,
}

/// Waits until `interval` has passed since the last call through `pacer`, then records this one.
async fn pace(pacer: &AsyncMutex<Option<Instant>>, interval: Duration) {
    let mut last = pacer.lock().await;
    if let Some(at) = *last {
        let elapsed = at.elapsed();
        if elapsed < interval {
            tokio::time::sleep(interval - elapsed).await;
        }
    }
    *last = Some(Instant::now());
}

impl<P: RankPoster> Actor<P> {
    async fn run(
        mut self,
        mut input: mpsc::Receiver<Input>,
        mut rx: mpsc::Receiver<Msg>,
        mut stop: watch::Receiver<bool>,
    ) {
        loop {
            tokio::select! {
                biased;
                _ = stop.wait_for(|s| *s) => break,
                message = input.recv() => match message {
                    Some(Input::Machine(event)) => { self.on_machine(event); self.processed += 1; }
                    Some(Input::Needed(puuids)) => { self.needed(puuids); self.processed += 1; }
                    None => break,
                },
                message = rx.recv() => if let Some(message) = message { self.on_message(message) },
            }
            while self.tasks.try_join_next().is_some() {}
            self.publish();
        }
        if let Some((_, cancel)) = self.own_timer.take() {
            cancel();
        }
        self.tasks.shutdown().await;
        self.draining = false;
        self.own_in_flight = false;
        self.publish();
        self.view.send_modify(|v| v.exited = true);
    }

    fn publish(&self) {
        let idle = !self.draining && !self.own_in_flight && self.queue.is_empty();
        self.view.send_modify(|v| {
            v.idle = idle;
            v.processed = self.processed;
            v.live_tasks = self.tasks.len();
        });
    }

    fn on_machine(&mut self, event: MachineEvent) {
        match event {
            MachineEvent::Connected(context) => {
                if let Some(summoner) = &context.summoner {
                    self.own_puuid = Some(summoner.puuid.clone());
                    self.own_name = Some(name_from_summoner(summoner));
                }
                self.context = Some(context);
                if !self.own_started {
                    self.own_started = true;
                    self.post_own();
                    self.schedule_own();
                } else if self.own_due {
                    self.own_due = false;
                    self.post_own();
                }
                if !self.queue.is_empty() {
                    self.drain();
                }
            }
            MachineEvent::Disconnected(_) => self.context = None,
            MachineEvent::Event(routed) => {
                if let RoutedEvent::RankedStats { puuid, stats } = routed.as_ref() {
                    if self.wanted.contains(puuid) {
                        tracing::debug!(component = "rank", %puuid, "ranked stats arrived over the socket for a requested puuid");
                        self.cached.insert(puuid.clone(), (**stats).clone());
                    }
                }
            }
        }
    }

    fn needed(&mut self, puuids: Vec<String>) {
        let others: Vec<String> = puuids
            .into_iter()
            .filter(|p| Some(p) != self.own_puuid.as_ref())
            .collect();
        self.wanted = others.iter().cloned().collect();
        let now = (self.options.clock)();
        let mut added = 0;
        for puuid in others {
            let recent = self
                .asked
                .get(&puuid)
                .is_some_and(|at| now.duration_since(*at).unwrap_or_default() < self.options.asked_ttl);
            if recent || self.queue.contains(&puuid) {
                continue;
            }
            self.asked.insert(puuid.clone(), now);
            self.queue.push_back(puuid);
            added += 1;
        }
        if added > 0 {
            tracing::debug!(
                component = "rank",
                queued = added,
                "ranks requested by the server"
            );
            self.drain();
        }
    }

    fn schedule_own(&mut self) {
        if let Some((_, cancel)) = self.own_timer.take() {
            cancel();
        }
        self.next_token += 1;
        let token = self.next_token;
        let tx = self.tx.clone();
        let cancel = self.options.scheduler.schedule(
            self.options.own_interval,
            Box::new(move || {
                let _ = tx.try_send(Msg::OwnTimer { token });
            }),
        );
        self.own_timer = Some((token, cancel));
    }

    fn post_own(&mut self) {
        let Some(context) = self.context.clone() else {
            self.own_due = true;
            return;
        };
        let Some(puuid) = self.own_puuid.clone() else {
            tracing::warn!(
                component = "rank",
                "own rank skipped: the local player is unknown (current-summoner did not answer)"
            );
            return;
        };
        self.own_in_flight = true;
        let name = self.own_name.clone();
        let poster = self.poster.clone();
        let pacer = self.pacer.clone();
        let interval = self.options.call_interval;
        let tx = self.tx.clone();
        self.tasks.spawn(async move {
            pace(&pacer, interval).await;
            match context.client.current_ranked_stats().await {
                Ok(ok) => post(&*poster, map_rank(&ok.value, &puuid, name.as_ref()), "own").await,
                Err(failure) => tracing::warn!(component = "rank", reason = %failure.describe(), "could not read own ranked stats; trying again on the next timer"),
            }
            let _ = tx.send(Msg::OwnDone).await;
        });
    }

    fn drain(&mut self) {
        if self.draining {
            return;
        }
        self.next_in_queue();
    }

    fn next_in_queue(&mut self) {
        let Some(context) = self.context.clone() else {
            // Disconnected before these were asked: forget the guard so the next lobby answer re-lists them.
            for puuid in self.queue.drain(..) {
                self.asked.remove(&puuid);
            }
            self.draining = false;
            return;
        };
        let Some(puuid) = self.queue.pop_front() else {
            self.draining = false;
            return;
        };
        self.draining = true;
        let cached = self.cached.remove(&puuid);
        let shared = self.options.names.as_ref().and_then(|names| names(&puuid));
        let known = shared.or_else(|| self.own_names.get(&puuid).cloned());
        let poster = self.poster.clone();
        let pacer = self.pacer.clone();
        let interval = self.options.call_interval;
        let tx = self.tx.clone();
        self.tasks.spawn(async move {
            let (stats, source) = match cached {
                Some(stats) => (Some(stats), "socket"),
                None => {
                    pace(&pacer, interval).await;
                    match context.client.ranked_stats(&puuid).await {
                        Ok(ok) => (Some(ok.value), "get"),
                        Err(failure) => {
                            tracing::warn!(component = "rank", %puuid, reason = %failure.describe(), "rank lookup failed; left for the next lobby response");
                            (None, "get")
                        }
                    }
                }
            };
            let mut fetched = None;
            if let Some(stats) = stats {
                let name = match known {
                    Some(name) => Some(name),
                    None => {
                        pace(&pacer, interval).await;
                        match context.client.summoner_by_puuid(&puuid).await {
                            Ok(ok) => {
                                let name = name_from_summoner(&ok.value);
                                fetched = Some(name.clone());
                                Some(name)
                            }
                            Err(failure) => {
                                tracing::warn!(component = "rank", %puuid, reason = %failure.describe(), "name lookup failed; the rank is posted without a name");
                                None
                            }
                        }
                    }
                };
                post(&*poster, map_rank(&stats, &puuid, name.as_ref()), source).await;
            }
            let _ = tx.send(Msg::SyncDone { puuid, name: fetched }).await;
        });
    }

    fn on_message(&mut self, message: Msg) {
        match message {
            Msg::OwnTimer { token } => {
                if self.own_timer.as_ref().map(|(t, _)| *t) == Some(token) {
                    self.own_timer = None;
                    if self.context.is_some() {
                        self.post_own();
                    } else {
                        self.own_due = true;
                    }
                    self.schedule_own();
                }
            }
            Msg::OwnDone => self.own_in_flight = false,
            Msg::SyncDone { puuid, name } => {
                if let Some(name) = name {
                    self.own_names.insert(puuid.clone(), name);
                }
                self.wanted.remove(&puuid);
                self.next_in_queue();
            }
        }
    }
}

async fn post<P: RankPoster + ?Sized>(poster: &P, payload: RankPayload, source: &str) {
    match poster.post_rank(&payload).await {
        RankPostOutcome::Ok { stored } => tracing::info!(
            component = "rank",
            puuid = %payload.puuid,
            tier = ?payload.tier.as_deref().filter(|t| !t.is_empty()),
            lp = ?payload.lp,
            named = payload.game_name.is_some(),
            stored,
            source,
            "rank posted"
        ),
        RankPostOutcome::Failed(reason) => {
            tracing::warn!(component = "rank", puuid = %payload.puuid, source, %reason, "rank post failed; left for the next lobby response");
        }
    }
}
