//! The host for the window (M17.8 drives it through its `Host` trait; this handle covers all of it, so the
//! adapter is one `impl`). The behaviour is the window's interim `LocalHost` (`src-tauri/src/host.rs`),
//! with every watcher in the session:
//!
//! - **Boot.** `boot()` (config, the old-engine check, filing a 0.3.x token, `/me`). An old engine running:
//!   nothing runs until [`HostHandle::retry_boot`]. No group, an unreadable config, or a refused token: a
//!   session with **the connection machine only**, so the window still shows League's status and pairing can
//!   read who is signed in. A group: the full session.
//! - **A session** (parity row 5): the API client on the group's token, the game watcher (replays the queue
//!   at once), the lobby watcher, rank sync, the command runner, backfill, and the connection machine feeding
//!   all of them plus the client tracker (phase, custom flag, `LcuClient`, signed in). A switch stops the
//!   whole session before the next starts, so one game is never posted to two groups.
//! - **The guard** (M14.13): `busy` is the game watcher's busy, or an in-game phase, or a block in the queue.
//!   A switch while busy is held (`pending_group`) and runs at the first moment the guard is clear; choosing
//!   the current group again cancels it.
//! - **A token refused mid-run** (the API client's `on_refused`): `/me` is asked again; when it refuses too,
//!   the watchers stop and the boot state is `Refused(sentence)` (Link again).
//!
//! Pairing stays a call on the API client (`POST /api/companion/pair`), reading the signed-in player through
//! [`HostStatus::client`] / [`HostStatus::puuid`]; after it, [`HostHandle::adopt_linked_group`].

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime};

use tokio::sync::{mpsc, oneshot, watch};
use tokio::task::JoinHandle;

use crate::api::identity::{IdentityOutcome, check_identity};
use crate::api::transport::Transport;
use crate::api::{ApiClient, ApiClientOptions, OnRefused};
use crate::backoff::BackoffOptions;
use crate::config::startup::{BootDeps, BootState, boot};
use crate::config::state::{GroupView, LastPosted, host_groups, host_state_dir, host_state_dir_for};
use crate::config::{ProcessProbe, load_config, set_last_group};
use crate::lcu::discovery::{Discovery, DiscoveryInputs, FsReader, default_lockfile_candidates};
use crate::lcu::events::RoutedEvent;
use crate::lcu::process::{ProcessList, ProcessLister, SystemProcessLister};
use crate::lcu::tls::LcuCertVerifier;
use crate::lcu::{LcuClient, LcuDiscovery};
use crate::queue::{parse_queue_file, queue_dir};
use crate::watchers::backfill::{BackfillHandle, BackfillOptions, spawn_backfill};
use crate::watchers::commands::{CommandRunnerHandle, CommandRunnerOptions, spawn_command_runner};
use crate::watchers::connection::{
    Discover, LeagueStatus, MachineEvent, MachineHandle, MachineOptions, VerifierFactory, WATCHER_QUEUE,
    WatcherFeed, spawn_machine,
};
use crate::watchers::game::{GameWatcherHandle, GameWatcherOptions, spawn_game_watcher};
use crate::watchers::lobby::{LobbySignal, LobbyWatcherHandle, LobbyWatcherOptions, spawn_lobby_watcher};
use crate::watchers::rank::{RankSyncHandle, RankSyncOptions, spawn_rank_sync};

/// How often the queue directory (count, newest `queuedAt`) and a held switch are looked at.
pub const REFRESH_EVERY: Duration = Duration::from_secs(2);

/// A group as the window lists it (never its token).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostGroup {
    /// The server's id.
    pub id: String,
    /// The slug.
    pub slug: String,
    /// The name.
    pub name: String,
}

impl From<&GroupView> for HostGroup {
    fn from(view: &GroupView) -> Self {
        HostGroup {
            id: view.group_id.clone(),
            slug: view.slug.clone(),
            name: view.name.clone(),
        }
    }
}

/// Where the host's start ended up (`BootState`, plus a token refused mid-run).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum HostBoot {
    /// Boot is running.
    #[default]
    Starting,
    /// An old Kustom is running: nothing starts until [`HostHandle::retry_boot`].
    OldEngineRunning,
    /// No group with a token (or an unreadable config): Link.
    NeedsLink,
    /// The current group's token was refused: the server's sentence (Link again).
    Refused(String),
    /// Recording for the current group.
    Ready,
}

/// Everything the window reads, in one value.
#[derive(Debug, Clone)]
pub struct HostStatus {
    /// Boot.
    pub boot: HostBoot,
    /// The connection machine's League status (`NotRunning { searched }` drives "Can't find League").
    pub league: LeagueStatus,
    /// The gameflow phase while connected.
    pub phase: Option<String>,
    /// The current game is a custom (`None`: not known yet).
    pub custom: Option<bool>,
    /// HTTPS to the client while connected; pairing reads `current-summoner` through it.
    pub client: Option<LcuClient>,
    /// `current-summoner` answered at connect.
    pub signed_in: bool,
    /// The signed-in player's PUUID (from `current-summoner` at connect), for pairing.
    pub puuid: Option<String>,
    /// Groups this PC holds a host token for.
    pub groups: Vec<HostGroup>,
    /// The group the watchers run for (or whose token was refused).
    pub current_group: Option<String>,
    /// A switch held back by the guard.
    pub pending_group: Option<String>,
    /// The watchers are being swapped.
    pub switching: bool,
    /// `last-posted.json` of the current group (Home's Last game).
    pub last_posted: Option<LastPosted>,
    /// Blocks waiting in the current group's queue.
    pub queued: usize,
    /// The newest queued block's `queuedAt`.
    pub newest_queued_at: Option<String>,
    /// The M14.13 guard: a game in progress or a block unposted.
    pub busy: bool,
    /// The install folder the running client last reported (the League folder row).
    pub reported_install_dir: Option<PathBuf>,
    /// [`HostHandle::stop`] ran.
    pub stopped: bool,
}

impl Default for HostStatus {
    fn default() -> Self {
        Self {
            boot: HostBoot::Starting,
            league: LeagueStatus::Starting,
            phase: None,
            custom: None,
            client: None,
            signed_in: false,
            puuid: None,
            groups: Vec::new(),
            current_group: None,
            pending_group: None,
            switching: false,
            last_posted: None,
            queued: 0,
            newest_queued_at: None,
            busy: false,
            reported_install_dir: None,
            stopped: false,
        }
    }
}

/// The client is in a game or just past one (the guard's half the phase tells, M14.13).
pub fn in_game_phase(phase: Option<&str>) -> bool {
    matches!(
        phase,
        Some("GameStart" | "InProgress" | "Reconnect" | "WaitingForStats" | "PreEndOfGame" | "EndOfGame")
    )
}

/// What [`HostHandle::switch_group`] did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SwitchOutcome {
    /// Switched (the new session is running when this returns).
    Switched,
    /// Held: a game is in progress or a block is unposted; it runs by itself when the guard clears.
    AfterThisGame,
    /// The current group was chosen again: the held switch is cancelled.
    Cancelled,
    /// Nothing: the current group, a swap already running, no such group, or stopped.
    Nothing,
}

/// The group switch (9.5.2, parity row 5): the window's `SwitchState`.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SwitchState {
    /// A switch held back by the guard, to this group id.
    pub pending: Option<String>,
    /// The watchers are being swapped now.
    pub switching: bool,
}

/// What a choice does.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SwitchDecision {
    /// Nothing (the current group, already switching, or not a group this PC holds a token for).
    Nothing,
    /// The pending switch was cancelled (the current group was chosen again).
    Cancelled,
    /// Swap now, to this group.
    Now(String),
    /// Busy: wait.
    Deferred(String),
}

impl SwitchState {
    /// The person chose `target`; `busy` is the guard.
    pub fn choose(
        &mut self,
        groups: &[HostGroup],
        current: Option<&str>,
        target: &str,
        busy: bool,
    ) -> SwitchDecision {
        if !groups.iter().any(|g| g.id == target) {
            return SwitchDecision::Nothing;
        }
        if current == Some(target) {
            return if self.pending.take().is_some() {
                SwitchDecision::Cancelled
            } else {
                SwitchDecision::Nothing
            };
        }
        if self.switching {
            return SwitchDecision::Nothing;
        }
        if busy {
            self.pending = Some(target.to_owned());
            return SwitchDecision::Deferred(target.to_owned());
        }
        self.pending = None;
        self.switching = true;
        SwitchDecision::Now(target.to_owned())
    }

    /// The guard was looked at again: the held switch, if it may run now.
    pub fn release(&mut self, busy: bool) -> Option<String> {
        if busy || self.switching {
            return None;
        }
        let target = self.pending.take()?;
        self.switching = true;
        Some(target)
    }

    /// The swap finished (or failed).
    pub fn done(&mut self) {
        self.switching = false;
    }
}

/// How [`start`] is set up. [`HostOptions::new`] is production; tests change the League side.
pub struct HostOptions {
    /// The config directory.
    pub config_dir: PathBuf,
    /// The API transport.
    pub transport: Arc<dyn Transport>,
    /// The process list for the old-engine check.
    pub probe: Arc<dyn ProcessProbe>,
    /// The app's version (`User-Agent`, `/me`).
    pub version: String,
    /// The connection machine's timings.
    pub machine: MachineOptions,
    /// The pinned certificate check (Riot's root).
    pub verifier: VerifierFactory,
    /// Look for League in the process list (step 1 of discovery). Off in tests.
    pub process_list: bool,
    /// The platform's default lockfile paths (step 3).
    pub default_lockfiles: Vec<PathBuf>,
    /// The game queue's outer backoff (default 30 s to 15 min).
    pub queue_backoff: Option<BackoffOptions>,
    /// The lobby watcher's settings.
    pub lobby: LobbyWatcherOptions,
    /// How often the queue directory and a held switch are looked at. Default [`REFRESH_EVERY`].
    pub refresh_every: Duration,
}

impl HostOptions {
    /// Production settings.
    pub fn new(
        config_dir: PathBuf,
        transport: Arc<dyn Transport>,
        probe: Arc<dyn ProcessProbe>,
        version: String,
    ) -> Self {
        Self {
            config_dir,
            transport,
            probe,
            version,
            machine: MachineOptions::default(),
            verifier: Arc::new(LcuCertVerifier::riot),
            process_list: true,
            default_lockfiles: default_lockfile_candidates(),
            queue_backoff: None,
            lobby: LobbyWatcherOptions::default(),
            refresh_every: REFRESH_EVERY,
        }
    }
}

/// The discovery the host uses: the process list (or none), then `leagueInstallDir` / `lockfilePath` read
/// fresh from `config.json` on every pass (a folder picked in the window is used at once), then the defaults.
struct HostDiscovery {
    config_dir: PathBuf,
    defaults: Vec<PathBuf>,
    inner: HostLister,
}

enum HostLister {
    System(Discovery<SystemProcessLister, FsReader>),
    None(Discovery<NoProcesses, FsReader>),
}

struct NoProcesses;

impl ProcessLister for NoProcesses {
    async fn list(&self) -> ProcessList {
        ProcessList::Listed(Vec::new())
    }
}

impl HostDiscovery {
    fn new(options: &HostOptions) -> Self {
        let inner = if options.process_list {
            HostLister::System(Discovery::new(SystemProcessLister, FsReader))
        } else {
            HostLister::None(Discovery::new(NoProcesses, FsReader))
        };
        Self {
            config_dir: options.config_dir.clone(),
            defaults: options.default_lockfiles.clone(),
            inner,
        }
    }
}

impl Discover for HostDiscovery {
    async fn discover(&mut self) -> LcuDiscovery {
        let inputs = DiscoveryInputs {
            saved_install_dir: crate::config::read_league_install_dir(&self.config_dir),
            saved_lockfile_path: crate::config::read_lockfile_path(&self.config_dir),
            defaults: self.defaults.clone(),
        };
        match &mut self.inner {
            HostLister::System(d) => d.discover(&inputs).await,
            HostLister::None(d) => d.discover(&inputs).await,
        }
    }

    fn refresh(&mut self) {
        match &mut self.inner {
            HostLister::System(d) => d.forget_listing(),
            HostLister::None(d) => d.forget_listing(),
        }
    }
}

/// What [`save_seen_install_dir`] did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SeenInstallSave {
    /// `leagueInstallDir` was absent and is now the reported folder.
    Saved,
    /// `config.json` already names a folder (the person's pick): kept, nothing written.
    Kept,
    /// The folder did not validate, or the config could not be written: tried again on the next connect.
    Failed,
}

/// The `update_config` closure body: inserts `leagueInstallDir` only when it is absent or not a non-empty
/// string. Runs under the config lock, so a Browse save that lands first is never overwritten. Returns
/// whether it inserted.
pub fn insert_install_dir_if_absent(
    raw: &mut serde_json::Map<String, serde_json::Value>,
    dir: &Path,
) -> bool {
    let key = crate::config::LEAGUE_INSTALL_DIR_KEY;
    let present = raw
        .get(key)
        .and_then(serde_json::Value::as_str)
        .is_some_and(|value| !value.trim().is_empty());
    if present {
        return false;
    }
    raw.insert(
        key.to_owned(),
        serde_json::Value::String(dir.to_string_lossy().into_owned()),
    );
    true
}

/// Saves the install folder a connected client reported as `leagueInstallDir`, only when `config.json` has
/// none (a folder the person picked is never replaced). The folder is validated first; the absent-check and
/// the write happen together under the config lock. Never panics; a failure is one log line.
pub fn save_seen_install_dir(config_dir: &Path, reported: &Path) -> SeenInstallSave {
    let valid = match crate::lcu::install::validate_install_dir(reported) {
        Ok(valid) => valid,
        Err(error) => {
            tracing::warn!(component = "host", dir = %reported.display(), %error, "the League folder the client reported was not saved");
            return SeenInstallSave::Failed;
        }
    };
    let mut inserted = false;
    let written = crate::config::update_config(config_dir, |raw| {
        inserted = insert_install_dir_if_absent(raw, &valid.dir);
        Ok(())
    });
    match written {
        Ok(()) if inserted => {
            tracing::info!(component = "host", dir = %valid.dir.display(), "saved the League folder the client reported");
            SeenInstallSave::Saved
        }
        Ok(()) => SeenInstallSave::Kept,
        Err(error) => {
            tracing::warn!(component = "host", %error, "the League folder the client reported was not saved");
            SeenInstallSave::Failed
        }
    }
}

/// Blocks waiting in a group's queue (names only, never a parse, so the queue's writer is never raced).
pub fn count_queued(state_dir: &Path) -> usize {
    std::fs::read_dir(queue_dir(state_dir)).map_or(0, |entries| {
        entries
            .filter_map(Result::ok)
            .filter(|entry| {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                name.strip_suffix(".json")
                    .is_some_and(|stem| !stem.is_empty() && stem.bytes().all(|b| b.is_ascii_digit()))
            })
            .count()
    })
}

/// The newest queued block's `queuedAt`, for Home's "saved, posts when the site answers".
pub fn newest_queued_at(state_dir: &Path) -> Option<String> {
    let entries = std::fs::read_dir(queue_dir(state_dir)).ok()?;
    entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let game_id = name.strip_suffix(".json")?.to_owned();
            let text = std::fs::read_to_string(entry.path()).ok()?;
            parse_queue_file(&game_id, &text).ok().map(|f| f.queued_at)
        })
        .max()
}

// --- the handle ----------------------------------------------------------------------------------------------

enum Command {
    Switch(String, oneshot::Sender<SwitchOutcome>),
    RetryDiscovery(oneshot::Sender<LcuDiscovery>),
    RetryBoot(oneshot::Sender<()>),
    Adopt(String, oneshot::Sender<()>),
    /// The API refused the token mid-run.
    TokenRefused,
    /// The guard may have cleared: run a held switch.
    Release,
}

/// The running host.
pub struct HostHandle {
    status: watch::Receiver<HostStatus>,
    commands: mpsc::Sender<Command>,
    stop: watch::Sender<bool>,
    join: std::sync::Mutex<Option<JoinHandle<()>>>,
}

impl HostHandle {
    /// The status, live.
    pub fn status(&self) -> watch::Receiver<HostStatus> {
        self.status.clone()
    }

    /// Switches the watchers to `group_id`, guarded: held while a game is in progress or a block is
    /// unposted (`pending_group`), and run by itself when the guard clears. Choosing the current group
    /// again cancels a held switch.
    pub async fn switch_group(&self, group_id: &str) -> SwitchOutcome {
        let (reply, answer) = oneshot::channel();
        if self
            .commands
            .send(Command::Switch(group_id.to_owned(), reply))
            .await
            .is_err()
        {
            return SwitchOutcome::Nothing;
        }
        answer.await.unwrap_or(SwitchOutcome::Nothing)
    }

    /// Try again: one discovery pass now (its answer, for the window), and the running machine looks again
    /// at once.
    pub async fn retry_discovery(&self) -> LcuDiscovery {
        let (reply, answer) = oneshot::channel();
        if self.commands.send(Command::RetryDiscovery(reply)).await.is_err() {
            return LcuDiscovery::NotFound { searched: Vec::new() };
        }
        answer
            .await
            .unwrap_or(LcuDiscovery::NotFound { searched: Vec::new() })
    }

    /// Runs boot again (the old engine's Retry, or Link after the config changed by hand).
    pub async fn retry_boot(&self) {
        let (reply, answer) = oneshot::channel();
        if self.commands.send(Command::RetryBoot(reply)).await.is_ok() {
            let _ = answer.await;
        }
    }

    /// A pairing saved a token for `group_id`: re-read the groups and make it the current group (through the
    /// guard; at once when nothing is recording).
    pub async fn adopt_linked_group(&self, group_id: &str) {
        let (reply, answer) = oneshot::channel();
        if self
            .commands
            .send(Command::Adopt(group_id.to_owned(), reply))
            .await
            .is_ok()
        {
            let _ = answer.await;
        }
    }

    /// Quit: stops every part and waits for it. A queued block stays on disk for the next start.
    pub async fn stop(&self) {
        let _ = self.stop.send(true);
        let join = self.join.lock().ok().and_then(|mut j| j.take());
        if let Some(join) = join {
            let _ = join.await;
        }
    }
}

impl Drop for HostHandle {
    fn drop(&mut self) {
        let _ = self.stop.send(true);
    }
}

/// Starts the host: boot runs at once in the background (call inside the tokio runtime).
pub fn start(options: HostOptions) -> HostHandle {
    let (status_tx, status_rx) = watch::channel(HostStatus::default());
    let (commands_tx, commands_rx) = mpsc::channel(64);
    let (stop_tx, stop_rx) = watch::channel(false);
    let host = Host {
        options,
        status: status_tx,
        commands: commands_tx.clone(),
        session: None,
        views: Vec::new(),
        api_base: String::new(),
        switch: SwitchState::default(),
    };
    let join = tokio::spawn(host.run(commands_rx, stop_rx));
    HostHandle {
        status: status_rx,
        commands: commands_tx,
        stop: stop_tx,
        join: std::sync::Mutex::new(Some(join)),
    }
}

// --- the session ---------------------------------------------------------------------------------------------

struct GroupParts {
    api: Arc<ApiClient>,
    lobby: LobbyWatcherHandle,
    game: GameWatcherHandle,
    rank: Arc<RankSyncHandle>,
    runner: CommandRunnerHandle,
    backfill: BackfillHandle,
}

struct Session {
    group_id: Option<String>,
    machine: MachineHandle,
    parts: Option<GroupParts>,
    tasks: Vec<JoinHandle<()>>,
}

impl Session {
    async fn stop(self) {
        for task in &self.tasks {
            task.abort();
        }
        // No new events, then the watchers (tasks aborted, files kept), then the API calls. A captured block
        // is already in the queue (written before its first POST): the next start replays it.
        self.machine.stop().await;
        if let Some(parts) = self.parts {
            parts.api.stop();
            parts.lobby.stop();
            parts.game.stop();
            parts.rank.stop();
            parts.runner.stop();
            parts.backfill.stop();
            let all = async {
                parts.lobby.stopped().await;
                parts.game.stopped().await;
                parts.rank.stopped().await;
                parts.runner.stopped().await;
                parts.backfill.stopped().await;
            };
            if tokio::time::timeout(Duration::from_secs(10), all).await.is_err() {
                tracing::warn!(component = "host", "a watcher took over 10 s to stop; going on");
            }
        }
        tracing::info!(component = "host", groupId = ?self.group_id, "session stopped");
    }
}

/// The client as the window sees it (from the machine's events, beyond `ConnectionStatus`).
#[derive(Debug, Clone, Default)]
struct ClientView {
    client: Option<LcuClient>,
    signed_in: bool,
    puuid: Option<String>,
    phase: Option<String>,
    custom: Option<bool>,
}

async fn track(mut rx: mpsc::Receiver<MachineEvent>, tx: watch::Sender<ClientView>) {
    while let Some(event) = rx.recv().await {
        match event {
            MachineEvent::Connected(context) => {
                tx.send_replace(ClientView {
                    client: Some(context.client.clone()),
                    signed_in: context.summoner.is_some(),
                    puuid: context.summoner.as_ref().map(|s| s.puuid.clone()),
                    phase: context.phase.clone(),
                    custom: None,
                });
                if in_game_phase(context.phase.as_deref()) {
                    read_custom(&context.client, &tx).await;
                }
            }
            MachineEvent::Event(routed) => match routed.as_ref() {
                RoutedEvent::GameflowPhase(phase) => {
                    let entering = in_game_phase(Some(phase)) && !in_game_phase(tx.borrow().phase.as_deref());
                    tx.send_modify(|view| {
                        view.phase = Some(phase.clone());
                        if !in_game_phase(Some(phase)) {
                            view.custom = None;
                        }
                    });
                    if entering && tx.borrow().custom.is_none() {
                        let client = tx.borrow().client.clone();
                        if let Some(client) = client {
                            read_custom(&client, &tx).await;
                        }
                    }
                }
                RoutedEvent::Lobby {
                    lobby: Some(lobby), ..
                } => {
                    // The lobby that starts a game says whether it is a custom before the session read.
                    let custom = lobby.game_config.is_custom;
                    tx.send_modify(|view| {
                        if !in_game_phase(view.phase.as_deref()) {
                            view.custom = Some(custom);
                        }
                    });
                }
                _ => {}
            },
            MachineEvent::Disconnected(_) => {
                tx.send_replace(ClientView::default());
            }
        }
    }
}

/// One `GET /lol-gameflow/v1/session` per game for the custom flag; a failure keeps the lobby's answer.
async fn read_custom(client: &LcuClient, tx: &watch::Sender<ClientView>) {
    if let Ok(session) = client.gameflow_session().await {
        let custom = session.value.game_data.is_custom_game;
        tx.send_modify(|view| view.custom = Some(custom));
    }
}

// --- the host actor ------------------------------------------------------------------------------------------

struct Host {
    options: HostOptions,
    status: watch::Sender<HostStatus>,
    commands: mpsc::Sender<Command>,
    session: Option<Session>,
    views: Vec<GroupView>,
    api_base: String,
    switch: SwitchState,
}

impl Host {
    async fn run(mut self, mut commands: mpsc::Receiver<Command>, mut stop: watch::Receiver<bool>) {
        tokio::select! {
            () = self.boot() => {}
            () = crate::watchers::connection::until_stopped(&mut stop) => {}
        }
        loop {
            tokio::select! {
                biased;
                () = crate::watchers::connection::until_stopped(&mut stop) => break,
                command = commands.recv() => match command {
                    None => break,
                    Some(command) => self.on_command(command).await,
                },
            }
        }
        self.halt().await;
        self.status.send_modify(|s| {
            s.stopped = true;
            s.busy = false;
            s.client = None;
        });
    }

    async fn on_command(&mut self, command: Command) {
        match command {
            Command::Switch(id, reply) => {
                let outcome = self.choose(id).await;
                let _ = reply.send(outcome);
            }
            Command::RetryDiscovery(reply) => {
                if let Some(session) = &self.session {
                    session.machine.retry_now();
                }
                let mut discovery = HostDiscovery::new(&self.options);
                tokio::spawn(async move {
                    let _ = reply.send(discovery.discover().await);
                });
            }
            Command::RetryBoot(reply) => {
                self.boot().await;
                let _ = reply.send(());
            }
            Command::Adopt(id, reply) => {
                self.adopt(id).await;
                let _ = reply.send(());
            }
            Command::TokenRefused => self.recheck_identity().await,
            Command::Release => self.release_held_switch().await,
        }
    }

    fn busy_now(&self) -> bool {
        let status = self.status.borrow();
        status.busy || in_game_phase(status.phase.as_deref())
    }

    async fn boot(&mut self) {
        let deps = BootDeps {
            transport: self.options.transport.clone(),
            probe: self.options.probe.clone(),
            now: SystemTime::now(),
            version: self.options.version.clone(),
        };
        self.status.send_modify(|s| s.boot = HostBoot::Starting);
        let booted = boot(&self.options.config_dir, &deps).await;
        self.views = booted.groups.clone();
        self.api_base = booted.config.api_base.clone();
        let groups: Vec<HostGroup> = self.views.iter().map(HostGroup::from).collect();
        self.status.send_modify(|s| s.groups = groups);
        match booted.state {
            BootState::OldEngineRunning { .. } => {
                self.halt().await;
                self.status.send_modify(|s| s.boot = HostBoot::OldEngineRunning);
            }
            BootState::ConfigUnreadable { reason } => {
                tracing::warn!(component = "host", %reason, "config.json can't be used; opening on Link");
                self.run_session(None).await;
                self.status.send_modify(|s| s.boot = HostBoot::NeedsLink);
            }
            BootState::NeedsLink => {
                self.run_session(None).await;
                self.status.send_modify(|s| s.boot = HostBoot::NeedsLink);
            }
            BootState::Ready {
                group,
                state_dir,
                identity,
            } => {
                let id = group.group_id.clone();
                if let IdentityOutcome::Refused { error, .. } = identity {
                    self.run_session(None).await;
                    self.status.send_modify(|s| {
                        s.boot = HostBoot::Refused(error);
                        s.current_group = Some(id);
                    });
                } else {
                    self.run_session(Some((group, state_dir))).await;
                    self.status.send_modify(|s| s.boot = HostBoot::Ready);
                }
            }
        }
    }

    async fn halt(&mut self) {
        if let Some(session) = self.session.take() {
            session.stop().await;
        }
    }

    /// Replaces the session (the old one fully stopped first). `None`: the machine alone.
    async fn run_session(&mut self, group: Option<(GroupView, PathBuf)>) {
        self.halt().await;
        let current = group.as_ref().map(|(g, _)| g.group_id.clone());
        let (track_tx, track_rx) = mpsc::channel(WATCHER_QUEUE);
        let (client_tx, mut client_rx) = watch::channel(ClientView::default());
        let mut tasks = vec![tokio::spawn(track(track_rx, client_tx))];
        let mut feeds = vec![WatcherFeed::new(track_tx)];
        let game_busy = Arc::new(AtomicBool::new(false));
        let mut parts = None;
        let mut state_dir_of_group = None;

        if let Some((group, state_dir)) = group {
            let parts_now = self.start_parts(&group, &state_dir, &mut feeds, &mut tasks, &game_busy);
            parts = Some(parts_now);
            state_dir_of_group = Some(state_dir);
            tracing::info!(component = "host", groupId = %group.group_id, slug = %group.slug, "watchers started for a group");
        } else {
            tracing::info!(component = "host", "no group linked: watching League only");
        }

        let machine = spawn_machine(
            HostDiscovery::new(&self.options),
            self.options.verifier.clone(),
            self.options.machine.clone(),
            feeds,
        );
        self.status.send_modify(|s| {
            if current.is_some() {
                s.current_group = current.clone();
            }
            s.last_posted = parts
                .as_ref()
                .and_then(|p: &GroupParts| p.game.view().borrow().last_posted.clone());
            s.queued = 0;
            s.newest_queued_at = None;
            s.busy = false;
        });

        // The machine's League status. The first install folder a connected client reports is saved as
        // `leagueInstallDir` when config has none (decision 2026-10-04), so "Can't find League" stays rare.
        let mut league = machine.status();
        let status = self.status.clone();
        let config_dir = self.options.config_dir.clone();
        tasks.push(tokio::spawn(async move {
            // Done once saved or kept; a failed save is tried once per connection.
            let mut seen_done = false;
            let mut tried_this_connection = false;
            loop {
                let now = league.borrow_and_update().league.clone();
                match &now {
                    LeagueStatus::Connected {
                        install_dir: Some(dir),
                        ..
                    } if !seen_done && !tried_this_connection => {
                        tried_this_connection = true;
                        let (config_dir, dir) = (config_dir.clone(), dir.clone());
                        let saved =
                            tokio::task::spawn_blocking(move || save_seen_install_dir(&config_dir, &dir))
                                .await;
                        seen_done = matches!(saved, Ok(SeenInstallSave::Saved | SeenInstallSave::Kept));
                    }
                    LeagueStatus::Connected {
                        install_dir: None, ..
                    } if !tried_this_connection => {
                        tried_this_connection = true;
                        tracing::debug!(
                            component = "host",
                            "connected, but discovery reported no install folder; nothing to save"
                        );
                    }
                    LeagueStatus::Connected { .. } => {}
                    _ => tried_this_connection = false,
                }
                status.send_modify(|s| {
                    if let LeagueStatus::Connecting {
                        install_dir: Some(dir),
                        ..
                    }
                    | LeagueStatus::Connected {
                        install_dir: Some(dir),
                        ..
                    } = &now
                    {
                        s.reported_install_dir = Some(dir.clone());
                    }
                    s.league = now;
                });
                if league.changed().await.is_err() {
                    return;
                }
            }
        }));

        // The client tracker: phase, custom, client, signed in.
        let status = self.status.clone();
        let busy_flag = game_busy.clone();
        let commands = self.commands.clone();
        tasks.push(tokio::spawn(async move {
            loop {
                let view = client_rx.borrow_and_update().clone();
                status.send_modify(|s| {
                    s.busy = busy_flag.load(Ordering::SeqCst)
                        || in_game_phase(view.phase.as_deref())
                        || s.queued > 0;
                    s.phase = view.phase;
                    s.custom = view.custom;
                    s.client = view.client;
                    s.signed_in = view.signed_in;
                    s.puuid = view.puuid;
                });
                let _ = commands.try_send(Command::Release);
                if client_rx.changed().await.is_err() {
                    return;
                }
            }
        }));

        // The queue directory and the held switch, every `refresh_every`.
        if let Some(dir) = state_dir_of_group {
            let status = self.status.clone();
            let busy_flag = game_busy.clone();
            let commands = self.commands.clone();
            let every = self.options.refresh_every;
            tasks.push(tokio::spawn(async move {
                loop {
                    let read_dir = dir.clone();
                    let read = tokio::task::spawn_blocking(move || {
                        let queued = count_queued(&read_dir);
                        let newest = if queued > 0 {
                            newest_queued_at(&read_dir)
                        } else {
                            None
                        };
                        (queued, newest)
                    })
                    .await;
                    if let Ok((queued, newest)) = read {
                        status.send_modify(|s| {
                            s.queued = queued;
                            s.newest_queued_at = newest;
                            s.busy = busy_flag.load(Ordering::SeqCst)
                                || in_game_phase(s.phase.as_deref())
                                || queued > 0;
                        });
                    }
                    let _ = commands.try_send(Command::Release);
                    tokio::time::sleep(every).await;
                }
            }));
        }

        self.session = Some(Session {
            group_id: current,
            machine,
            parts,
            tasks,
        });
    }

    fn start_parts(
        &self,
        group: &GroupView,
        state_dir: &Path,
        feeds: &mut Vec<WatcherFeed>,
        tasks: &mut Vec<JoinHandle<()>>,
        game_busy: &Arc<AtomicBool>,
    ) -> GroupParts {
        let mut api_options = ApiClientOptions::new(
            self.api_base.clone(),
            Some(group.token.clone()),
            self.options.transport.clone(),
        );
        api_options.version = self.options.version.clone();
        let refused_tx = self.commands.clone();
        let on_refused: OnRefused = Arc::new(move |status| {
            tracing::warn!(component = "host", status, "the API refused this group's token");
            let _ = refused_tx.try_send(Command::TokenRefused);
        });
        api_options.on_refused = Some(on_refused);
        let api = Arc::new(ApiClient::new(api_options));

        // The game watcher first: it replays the queue before League is even looked for.
        let mut game_options = GameWatcherOptions::new(state_dir.to_path_buf());
        if let Some(backoff) = &self.options.queue_backoff {
            game_options.backoff = backoff.clone();
        }
        let game = spawn_game_watcher(api.clone(), game_options);
        let runner = spawn_command_runner(api.clone(), CommandRunnerOptions::new(state_dir.to_path_buf()));
        let backfill = spawn_backfill(
            api.clone(),
            Arc::new(game.enqueuer()),
            BackfillOptions::new(state_dir.to_path_buf()),
        );
        let mut lobby_options = self.options.lobby.clone();
        lobby_options.password_for = Some(runner.password_for());
        let (lobby, mut signals) = spawn_lobby_watcher(api.clone(), lobby_options);
        // Rank sync reuses the names the lobby watcher already resolved.
        let lobby_view = lobby.view();
        let rank = Arc::new(spawn_rank_sync(
            api.clone(),
            RankSyncOptions {
                names: Some(Arc::new(move |puuid: &str| {
                    lobby_view.borrow().known_names.get(puuid).cloned()
                })),
                ..Default::default()
            },
        ));
        feeds.extend([
            lobby.feed(),
            game.feed(),
            rank.feed(),
            runner.feed(),
            backfill.feed(),
        ]);

        // The lobby answer's ranksNeeded to rank sync.
        let needs = rank.clone();
        tasks.push(tokio::spawn(async move {
            while let Some(signal) = signals.recv().await {
                if let LobbySignal::RanksNeeded(puuids) = signal {
                    needs.needed(puuids);
                }
            }
        }));

        // The game watcher's view: Last game, the queue count, busy.
        let mut games = game.view();
        let status = self.status.clone();
        let busy_flag = game_busy.clone();
        let commands = self.commands.clone();
        tasks.push(tokio::spawn(async move {
            loop {
                let view = games.borrow_and_update().clone();
                busy_flag.store(view.busy, Ordering::SeqCst);
                status.send_modify(|s| {
                    s.last_posted = view.last_posted.clone();
                    s.queued = view.queued_files;
                    s.busy = view.busy || in_game_phase(s.phase.as_deref()) || s.queued > 0;
                });
                let _ = commands.try_send(Command::Release);
                if games.changed().await.is_err() {
                    return;
                }
            }
        }));

        GroupParts {
            api,
            lobby,
            game,
            rank,
            runner,
            backfill,
        }
    }

    /// A held switch runs at the first moment the guard is clear.
    async fn release_held_switch(&mut self) {
        if self.status.borrow().pending_group.is_none() {
            return;
        }
        let busy = self.busy_now();
        if let Some(target) = self.switch.release(busy) {
            self.switch_now(target).await;
        }
    }

    /// Swaps the watchers to `target` (the switch state is already `switching`).
    async fn switch_now(&mut self, target: String) {
        self.status.send_modify(|s| {
            s.switching = true;
            s.pending_group = None;
        });
        let Some(view) = self.views.iter().find(|v| v.group_id == target).cloned() else {
            self.switch.done();
            self.status.send_modify(|s| s.switching = false);
            return;
        };
        let dir = self.options.config_dir.clone();
        let chosen = view.clone();
        let state_dir = tokio::task::spawn_blocking(move || {
            if let Err(error) = set_last_group(&dir, &chosen.group_id) {
                tracing::warn!(component = "host", %error, "could not remember the group");
            }
            host_state_dir_for(&dir, &chosen)
        })
        .await
        .unwrap_or_else(|_| host_state_dir(&self.options.config_dir, &view.group_id));
        tracing::info!(component = "host", groupId = %view.group_id, "switching group");
        self.run_session(Some((view, state_dir))).await;
        self.switch.done();
        self.status.send_modify(|s| {
            s.switching = false;
            s.boot = HostBoot::Ready;
        });
    }

    async fn choose(&mut self, target: String) -> SwitchOutcome {
        let busy = self.busy_now();
        let groups: Vec<HostGroup> = self.views.iter().map(HostGroup::from).collect();
        let (current, recording) = {
            let s = self.status.borrow();
            (s.current_group.clone(), s.boot == HostBoot::Ready)
        };
        let current = current.filter(|_| recording);
        match self.switch.choose(&groups, current.as_deref(), &target, busy) {
            SwitchDecision::Now(target) => {
                self.switch_now(target).await;
                SwitchOutcome::Switched
            }
            SwitchDecision::Deferred(target) => {
                tracing::info!(component = "host", groupId = %target, "group switch waits for the current game");
                self.status.send_modify(|s| s.pending_group = Some(target));
                SwitchOutcome::AfterThisGame
            }
            SwitchDecision::Cancelled => {
                self.status.send_modify(|s| s.pending_group = None);
                SwitchOutcome::Cancelled
            }
            SwitchDecision::Nothing => SwitchOutcome::Nothing,
        }
    }

    async fn adopt(&mut self, group_id: String) {
        let dir = self.options.config_dir.clone();
        let config = tokio::task::spawn_blocking(move || load_config(&dir).config())
            .await
            .ok()
            .flatten();
        let Some(config) = config else { return };
        self.views = host_groups(&config);
        self.api_base = config.api_base.clone();
        let groups: Vec<HostGroup> = self.views.iter().map(HostGroup::from).collect();
        self.status.send_modify(|s| s.groups = groups);
        let (boot, current) = {
            let s = self.status.borrow();
            (s.boot.clone(), s.current_group.clone())
        };
        let same = current.as_deref() == Some(group_id.as_str());
        // Nothing recording (first link, or the refused group linked again), or a new token for the running
        // group: start on it now, unless that group is mid-game.
        if boot != HostBoot::Ready || current.is_none() || same {
            if same && boot == HostBoot::Ready && self.busy_now() {
                tracing::info!(
                    component = "host",
                    "a new token for the running group; it applies on the next start"
                );
                return;
            }
            if self.switch.switching {
                return;
            }
            self.switch.pending = None;
            self.switch.switching = true;
            self.switch_now(group_id).await;
            return;
        }
        self.choose(group_id).await;
    }

    async fn recheck_identity(&mut self) {
        let current = self.status.borrow().current_group.clone();
        let Some(view) = current.and_then(|id| self.views.iter().find(|v| v.group_id == id).cloned()) else {
            return;
        };
        let mut options = ApiClientOptions::new(
            self.api_base.clone(),
            Some(view.token.clone()),
            self.options.transport.clone(),
        );
        options.version = self.options.version.clone();
        let outcome = check_identity(&ApiClient::new(options)).await;
        if let IdentityOutcome::Refused { error, .. } = outcome {
            tracing::warn!(
                component = "host",
                "the token was refused on /me; watchers stop, Link again"
            );
            self.run_session(None).await;
            self.status.send_modify(|s| {
                s.boot = HostBoot::Refused(error);
                s.current_group = Some(view.group_id.clone());
                s.pending_group = None;
            });
            self.switch = SwitchState::default();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn group(id: &str) -> HostGroup {
        HostGroup {
            id: id.into(),
            slug: id.into(),
            name: id.into(),
        }
    }

    #[test]
    fn the_switch_guard_waits_for_the_game() {
        let groups = vec![group("g1"), group("g2")];
        let mut s = SwitchState::default();
        assert_eq!(
            s.choose(&groups, Some("g1"), "nope", false),
            SwitchDecision::Nothing
        );
        assert_eq!(
            s.choose(&groups, Some("g1"), "g1", false),
            SwitchDecision::Nothing
        );
        assert_eq!(
            s.choose(&groups, Some("g1"), "g2", true),
            SwitchDecision::Deferred("g2".into())
        );
        assert_eq!(s.release(true), None, "still in the game");
        assert_eq!(s.release(false), Some("g2".into()));
        assert!(s.switching && s.pending.is_none());
        assert_eq!(
            s.choose(&groups, Some("g1"), "g2", false),
            SwitchDecision::Nothing,
            "one at a time"
        );
        s.done();
        assert_eq!(
            s.choose(&groups, Some("g1"), "g2", true),
            SwitchDecision::Deferred("g2".into())
        );
        assert_eq!(
            s.choose(&groups, Some("g1"), "g1", true),
            SwitchDecision::Cancelled
        );
        assert_eq!(s.release(false), None);
        assert_eq!(
            s.choose(&groups, Some("g1"), "g2", false),
            SwitchDecision::Now("g2".into())
        );
        s.done();
        assert_eq!(
            s.choose(&groups, None, "g1", false),
            SwitchDecision::Now("g1".into())
        );
    }

    #[test]
    fn the_queue_guard_counts_game_files_only() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(count_queued(dir.path()), 0, "no queue dir");
        let queue = queue_dir(dir.path());
        std::fs::create_dir_all(queue.join("quarantine")).unwrap();
        std::fs::write(queue.join("quarantine").join("9.json"), "{}").unwrap();
        std::fs::write(queue.join("notes.txt"), "").unwrap();
        assert_eq!(
            count_queued(dir.path()),
            0,
            "quarantine and strays do not hold a switch"
        );
        std::fs::write(
            queue.join("123.json"),
            r#"{"version":1,"queuedAt":"2026-10-04T21:42:00.000Z","payload":{"gameId":123}}"#,
        )
        .unwrap();
        assert_eq!(count_queued(dir.path()), 1);
        assert_eq!(
            newest_queued_at(dir.path()).as_deref(),
            Some("2026-10-04T21:42:00.000Z")
        );
    }

    #[test]
    fn a_seen_install_folder_is_saved_only_when_config_has_none() {
        let dir = tempfile::tempdir().unwrap();
        let config_dir = dir.path().join("cfg");
        std::fs::create_dir_all(&config_dir).unwrap();
        std::fs::write(
            config_dir.join("config.json"),
            r#"{"apiBase":"https://kustom.invalid","keep":1}"#,
        )
        .unwrap();
        let league = dir.path().join("League of Legends");
        std::fs::create_dir_all(&league).unwrap();
        std::fs::write(league.join("lockfile"), "LeagueClient:1:2:pw:https").unwrap();
        // Not a League folder: nothing written.
        assert_eq!(
            save_seen_install_dir(&config_dir, &dir.path().join("nowhere")),
            SeenInstallSave::Failed
        );
        assert_eq!(crate::config::read_league_install_dir(&config_dir), None);
        // None saved yet: the reported folder is saved, other keys kept.
        assert_eq!(
            save_seen_install_dir(&config_dir, &league),
            SeenInstallSave::Saved
        );
        assert_eq!(
            crate::config::read_league_install_dir(&config_dir),
            Some(league.clone())
        );
        let raw: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(config_dir.join("config.json")).unwrap()).unwrap();
        assert_eq!(raw["keep"], 1);
        // One already there (picked by the person): never replaced.
        let other = dir.path().join("Other");
        std::fs::create_dir_all(&other).unwrap();
        std::fs::write(other.join("lockfile"), "x").unwrap();
        assert_eq!(save_seen_install_dir(&config_dir, &other), SeenInstallSave::Kept);
        assert_eq!(crate::config::read_league_install_dir(&config_dir), Some(league));
    }

    #[test]
    fn the_locked_closure_keeps_a_folder_already_present() {
        let mut raw = serde_json::Map::new();
        raw.insert(
            "leagueInstallDir".into(),
            serde_json::json!("D:\\Games\\League of Legends"),
        );
        raw.insert("keep".into(), serde_json::json!(1));
        assert!(!insert_install_dir_if_absent(
            &mut raw,
            Path::new("C:\\Riot Games\\League of Legends")
        ));
        assert_eq!(raw["leagueInstallDir"], "D:\\Games\\League of Legends");
        assert_eq!(raw["keep"], 1);
        // Absent, empty or not a string: inserted.
        for before in [
            None,
            Some(serde_json::json!("  ")),
            Some(serde_json::json!(null)),
            Some(serde_json::json!(7)),
        ] {
            let mut raw = serde_json::Map::new();
            if let Some(value) = before {
                raw.insert("leagueInstallDir".into(), value);
            }
            assert!(insert_install_dir_if_absent(&mut raw, Path::new("/League")));
            assert_eq!(raw["leagueInstallDir"], "/League");
        }
    }

    #[test]
    fn in_game_phases() {
        for phase in [
            "GameStart",
            "InProgress",
            "Reconnect",
            "WaitingForStats",
            "PreEndOfGame",
            "EndOfGame",
        ] {
            assert!(in_game_phase(Some(phase)));
        }
        for phase in ["None", "Lobby", "ChampSelect", "Matchmaking"] {
            assert!(!in_game_phase(Some(phase)));
        }
        assert!(!in_game_phase(None));
    }
}
