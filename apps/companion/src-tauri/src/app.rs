//! The controller: owns the [`Model`], follows the [`Host`]'s status, runs the window's commands, and
//! hands every change to the [`Shell`] (the webview and the tray). The Tauri glue is in `lib.rs`; this file
//! has no Tauri types, so a fake shell and a fake host drive it in tests.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

use engine::api::transport::Transport;
use engine::lcu::discovery::default_lockfile_candidates;
use engine::log::logs_dir;
use engine::watchers::connection::LeagueStatus;

use crate::copy;
use crate::folder::{apply_pick, folder_in_use, picker_start, try_again_answer};
use crate::host_api::{BoxFuture, Host, HostBoot, HostStatus};
use crate::link::{LinkAnswer, PairStep, clean_code, code_for_request, pair, save_token};
use crate::model::{
    FolderOrigin, LastGame, LeagueLink, LeagueRow, Model, OldEngine, Screen, TrayModel, UpdateState, View,
    league_row, may_restart, screen, tray, view,
};

/// The platform side: the webview, the tray, the OS. `lib.rs` implements it with Tauri and its plugins.
pub trait Shell: Send + Sync + 'static {
    /// Paints the window.
    fn render(&self, view: &View);
    /// Rebuilds the tray menu, tooltip and icon.
    fn tray(&self, tray: &TrayModel);
    /// Opens a URL in the default browser.
    fn open_url(&self, url: &str);
    /// Opens a folder in Explorer.
    fn open_path(&self, path: &Path);
    /// The native folder picker (modal to the window); `None` when cancelled.
    fn pick_folder(&self, title: &str, start: PathBuf) -> BoxFuture<'static, Option<PathBuf>>;
    /// The real Start with Windows state, when the OS can say.
    fn autostart(&self) -> Option<bool>;
    /// Turns Start with Windows on or off; the state after, when the OS can say.
    fn set_autostart(&self, on: bool) -> Option<bool>;
    /// Ends the process.
    fn exit(&self);
}

/// The updater, as the window drives it. `updater::TauriUpdater` implements it with tauri-plugin-updater;
/// `updater::run` calls [`App::update_ready`] when a verified download is held, and a failed install calls
/// [`App::update_failed`].
pub trait Updater: Send + Sync + 'static {
    /// Installs the downloaded update and relaunches (the window comes back as it was).
    fn restart_to_update(&self);
}

/// An updater that does nothing (tests, and a build without the plugin).
pub struct NoUpdater;

impl Updater for NoUpdater {
    fn restart_to_update(&self) {
        tracing::info!(component = "update", "no updater in this build");
    }
}

/// The controller.
pub struct App {
    model: Mutex<Model>,
    host: Arc<dyn Host>,
    shell: Arc<dyn Shell>,
    updater: Arc<dyn Updater>,
    transport: Arc<dyn Transport>,
    config_dir: PathBuf,
    last_tray: Mutex<Option<TrayModel>>,
    folder_key: Mutex<Option<(Option<PathBuf>, bool)>>,
    status: Mutex<HostStatus>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// The restart/switch guard: the engine's `busy`, an in-game phase, or any queued block (the engine's `busy`
/// already includes the queue; this keeps the rule true if that ever changes).
fn status_busy(status: &HostStatus) -> bool {
    status.busy || status.queued > 0 || crate::model::in_game_phase(status.phase.as_deref())
}

fn league_link(status: &LeagueStatus) -> LeagueLink {
    match status {
        LeagueStatus::Starting | LeagueStatus::Stopped => LeagueLink::Starting,
        LeagueStatus::NotRunning { .. } => LeagueLink::NotRunning,
        LeagueStatus::Connecting { .. } | LeagueStatus::Lost { .. } => LeagueLink::Reconnecting,
        LeagueStatus::Connected { .. } => LeagueLink::Connected,
    }
}

/// Folds the host's status into the model (pure apart from the folder, which is passed in).
pub fn apply_status(model: &mut Model, status: &HostStatus, folder: Option<PathBuf>) {
    let before_screen = screen(model);
    let before_row = league_row(&model.league, model.folder.found_by_try);
    let before_current = model.current.clone();
    // A post is news when it replaces a queued block or an older post; the file read at start is not.
    let before_posted = match &model.last_game {
        LastGame::Posted(p) => Some(p.at.clone()),
        LastGame::Queued { .. } => Some(String::new()),
        LastGame::None => None,
    };
    let settled = status.boot != HostBoot::Starting;

    model.old_engine = match status.boot {
        HostBoot::OldEngineRunning => Some(model.old_engine.clone().unwrap_or_default()),
        _ => None,
    };
    model.groups = status.groups.clone();
    model.current = status.current_group.clone();
    model.refused = match &status.boot {
        HostBoot::Refused(sentence) => Some(sentence.clone()),
        _ => None,
    };
    model.busy = status_busy(status);
    model.switch.pending = status.pending_group.clone();
    model.switch.switching = status.switching;
    model.league.link = league_link(&status.league);
    model.league.phase = status.phase.clone();
    model.league.custom = status.custom;
    model.league.signed_in = status.signed_in;
    model.league.folder = folder;
    if model.league.link != LeagueLink::NotRunning {
        model.folder.found_by_try = false;
    }
    model.last_game = if status.queued > 0 {
        LastGame::Queued {
            at: status.newest_queued_at.clone().unwrap_or_default(),
        }
    } else {
        status
            .last_posted
            .clone()
            .map_or(LastGame::None, LastGame::Posted)
    };

    if !settled || before_screen != Screen::Home || screen(model) != Screen::Home {
        return;
    }
    if model.current != before_current {
        if let (Some(_), Some(name)) = (&before_current, model.current_group().map(|g| g.name.clone())) {
            model.announce(copy::switched_to(&name));
        }
        return;
    }
    let row = league_row(&model.league, model.folder.found_by_try);
    if row != before_row {
        if before_row == LeagueRow::CantFind {
            model.announce(copy::FOUND_LEAGUE_ANNOUNCE);
        } else if row != LeagueRow::CantFind {
            model.announce(format!("{}.", row.text()));
        }
    }
    if let LastGame::Posted(posted) = &model.last_game
        && before_posted.as_deref() != Some(posted.at.as_str())
        && before_posted.is_some()
    {
        let winner = match posted.winning_side {
            engine::api::wire::Side::Blue => copy::BLUE_WON,
            engine::api::wire::Side::Red => copy::RED_WON,
        };
        model.announce(copy::game_recorded(winner));
    }
}

impl App {
    /// A controller over `host`.
    pub fn new(
        version: &str,
        config_dir: PathBuf,
        host: Arc<dyn Host>,
        shell: Arc<dyn Shell>,
        updater: Arc<dyn Updater>,
        transport: Arc<dyn Transport>,
        api_base: String,
    ) -> Arc<Self> {
        let mut model = Model::new(version);
        model.api_base = api_base;
        model.autostart = shell.autostart().unwrap_or(false);
        Arc::new(Self {
            model: Mutex::new(model),
            host,
            shell,
            updater,
            transport,
            config_dir,
            last_tray: Mutex::new(None),
            folder_key: Mutex::new(None),
            status: Mutex::new(HostStatus::default()),
        })
    }

    /// Follows the host's status until it ends (spawn it once).
    pub async fn follow(self: Arc<Self>) {
        let mut rx = self.host.status();
        loop {
            let status = rx.borrow_and_update().clone();
            self.on_status(status).await;
            if rx.changed().await.is_err() {
                return;
            }
        }
    }

    async fn on_status(self: &Arc<Self>, status: HostStatus) {
        let folder = self.folder_for(&status).await;
        {
            let mut model = lock(&self.model);
            apply_status(&mut model, &status, folder);
        }
        *lock(&self.status) = status;
        self.maybe_restart();
        self.publish();
    }

    /// The folder in use, recomputed only when what it depends on changed.
    async fn folder_for(&self, status: &HostStatus) -> Option<PathBuf> {
        let key = (
            status.reported_install_dir.clone(),
            matches!(status.league, LeagueStatus::NotRunning { .. }),
        );
        let cached = lock(&self.folder_key).clone();
        if cached.as_ref() == Some(&key) {
            return lock(&self.model).league.folder.clone();
        }
        let folder = self.compute_folder(status.reported_install_dir.clone()).await;
        *lock(&self.folder_key) = Some(key);
        folder
    }

    async fn compute_folder(&self, reported: Option<PathBuf>) -> Option<PathBuf> {
        let dir = self.config_dir.clone();
        tokio::task::spawn_blocking(move || {
            folder_in_use(&dir, reported.as_deref(), &default_lockfile_candidates())
        })
        .await
        .ok()
        .flatten()
    }

    /// The current view (the webview asks once on load).
    pub fn view(&self) -> View {
        view(&lock(&self.model))
    }

    /// A copy of the model (tests, screens).
    pub fn model(&self) -> Model {
        lock(&self.model).clone()
    }

    /// Repaints the window and, when it changed, the tray.
    pub fn publish(&self) {
        let (view, tray) = {
            let model = lock(&self.model);
            (view(&model), tray(&model))
        };
        self.shell.render(&view);
        let mut last = lock(&self.last_tray);
        if last.as_ref() != Some(&tray) {
            self.shell.tray(&tray);
            *last = Some(tray);
        }
    }

    fn update(&self, change: impl FnOnce(&mut Model)) {
        change(&mut lock(&self.model));
        self.publish();
    }

    fn busy(&self) -> bool {
        status_busy(&lock(&self.status))
    }

    // --- Link ---------------------------------------------------------------------------------------------

    /// The field changed: returns the cleaned code (the webview writes it back) and shows L5 as typed.
    pub fn link_input(&self, raw: &str) -> String {
        let clean = clean_code(raw);
        let code = clean.code.clone();
        self.update(|m| {
            m.link.code = clean.code;
            m.link.look_alike = clean.look_alike;
            if m.link.answer.is_some() {
                m.set_link_answer(None);
            }
        });
        code
    }

    /// Link (or Enter).
    pub async fn link_submit(self: &Arc<Self>, raw: String) {
        let ready = {
            let model = lock(&self.model);
            if model.link.busy {
                return;
            }
            model.league.link == LeagueLink::Connected && model.league.signed_in
        };
        if !ready {
            // `aria-disabled`: the press does nothing; L2 already says why.
            return;
        }
        let code = match code_for_request(&raw) {
            Ok(code) => code,
            Err(answer) => {
                self.update(|m| {
                    m.link.look_alike = false;
                    m.set_link_answer(Some(answer));
                });
                return;
            }
        };
        self.update(|m| {
            m.link.code = code.clone();
            m.link.busy = true;
            m.link.look_alike = false;
            m.set_link_answer(None);
        });
        let client = lock(&self.status).client.clone();
        let puuid = match client {
            Some(client) => client.current_summoner().await.ok().map(|s| s.value.puuid),
            None => None,
        };
        let Some(puuid) = puuid.filter(|p| !p.is_empty()) else {
            self.update(|m| {
                m.link.busy = false;
                m.set_link_answer(Some(LinkAnswer::LeagueGone));
            });
            return;
        };
        let (api_base, version) = {
            let model = lock(&self.model);
            (model.api_base.clone(), model.version.clone())
        };
        match pair(&api_base, self.transport.clone(), &version, &code, &puuid).await {
            PairStep::Token { group, token } => {
                let dir = self.config_dir.clone();
                let base = api_base.clone();
                let saved_group = group.clone();
                let saved =
                    tokio::task::spawn_blocking(move || save_token(&dir, &base, &saved_group, &token))
                        .await
                        .unwrap_or(false);
                if !saved {
                    self.update(|m| {
                        m.link.busy = false;
                        m.link.code.clear();
                        m.set_link_answer(Some(LinkAnswer::SaveFailed));
                    });
                    return;
                }
                self.update(|m| {
                    m.link = Default::default();
                    m.link_open = false;
                    m.linked_line = true;
                });
                self.host.adopt_linked_group(group.id).await;
            }
            PairStep::Answer(answer) => self.show_pair_answer(answer),
        }
    }

    /// Puts a non-token pairing answer in the slot. A `hostRefusal` (L7, M17.19) also turns Start with
    /// Windows off: a member has no use for a host app, so it must not come back at every boot.
    fn show_pair_answer(&self, answer: LinkAnswer) {
        let member = matches!(answer, LinkAnswer::Member(_));
        if member {
            self.set_autostart(false);
        }
        self.update(|m| {
            m.link.busy = false;
            if member {
                m.link.code.clear();
            }
            m.set_link_answer(Some(answer));
        });
    }

    /// `Link another group` (L10).
    pub fn link_open(&self) {
        self.update(|m| {
            m.link_open = true;
            m.link = Default::default();
        });
    }

    /// L10's `Back`: Home, nothing changes.
    pub fn link_back(&self) {
        self.update(|m| {
            m.link_open = false;
            m.link = Default::default();
        });
    }

    // --- Home ---------------------------------------------------------------------------------------------

    /// A group chosen in the select or the tray.
    pub async fn choose_group(&self, group_id: String) {
        self.host.switch_group(group_id).await;
    }

    /// `Open Tonight`.
    pub fn open_tonight(&self) {
        let url = {
            let model = lock(&self.model);
            let base = model.api_base.trim_end_matches('/').to_owned();
            match model.current_group() {
                Some(group) if !group.slug.is_empty() => format!("{base}/g/{}", group.slug),
                _ => base,
            }
        };
        self.shell.open_url(&url);
    }

    /// `Browse…` or `Change…`: the picker, then the check, then the answer.
    pub async fn pick_folder(self: &Arc<Self>, origin: FolderOrigin) {
        if lock(&self.model).folder.busy.is_some() {
            return;
        }
        let start = picker_start(Path::exists);
        let picked = self.shell.pick_folder(copy::PICKER_TITLE, start).await;
        if picked.is_none() {
            return;
        }
        self.update(|m| {
            m.folder.busy = Some(origin);
            m.folder.answer = None;
        });
        let dir = self.config_dir.clone();
        let answer = tokio::task::spawn_blocking(move || apply_pick(&dir, picked))
            .await
            .ok()
            .flatten();
        let reported = lock(&self.status).reported_install_dir.clone();
        let folder = self.compute_folder(reported).await;
        self.update(|m| {
            m.folder.busy = None;
            m.folder.answer = answer.map(|a| (origin, a));
            m.league.folder = folder;
        });
    }

    /// `Try again`.
    pub async fn try_again(self: &Arc<Self>) {
        if lock(&self.model).folder.busy.is_some() {
            return;
        }
        self.update(|m| {
            m.folder.busy = Some(FolderOrigin::TryAgain);
            m.folder.answer = None;
        });
        let found = self.host.retry_discovery().await;
        let answer = try_again_answer(&found);
        self.update(|m| {
            m.folder.busy = None;
            m.folder.found_by_try = answer.is_none();
            m.folder.answer = answer.map(|a| (FolderOrigin::TryAgain, a));
        });
    }

    /// The old engine's `Retry`.
    pub async fn retry_old_engine(self: &Arc<Self>) {
        self.update(|m| {
            m.old_engine = Some(OldEngine {
                checking: true,
                still_running: false,
            })
        });
        self.host.retry_boot().await;
        let still = lock(&self.status).boot == HostBoot::OldEngineRunning;
        self.update(|m| {
            if still {
                m.old_engine = Some(OldEngine {
                    checking: false,
                    still_running: true,
                });
            }
        });
    }

    // --- Footer and window --------------------------------------------------------------------------------

    /// `Open logs`.
    pub fn open_logs(&self) {
        let dir = logs_dir(&self.config_dir);
        let _ = std::fs::create_dir_all(&dir);
        self.shell.open_path(&dir);
    }

    /// The checkbox or the tray item.
    pub fn set_autostart(&self, on: bool) {
        let now = self.shell.set_autostart(on);
        self.update(|m| m.autostart = now.unwrap_or(m.autostart));
    }

    /// The window was shown: re-read the real autostart state (a change in Task Manager shows here).
    pub fn window_shown(&self) {
        let now = self.shell.autostart();
        self.update(|m| {
            if let Some(on) = now {
                m.autostart = on;
            }
        });
    }

    /// The window was hidden.
    pub fn window_hidden(&self) {
        self.update(Model::window_hidden);
    }

    /// Quit Kustom (tray only, no confirmation): every watcher stops, then the process ends.
    pub async fn quit(&self) {
        tracing::info!(component = "app", "quit from the tray");
        self.host.stop().await;
        self.shell.exit();
    }

    // --- Update (`updater.rs` drives these) ---------------------------------------------------------------

    /// Is an update ready, scheduled or restarting? (No new check while one is.)
    pub fn update_pending(&self) -> bool {
        lock(&self.model).update != UpdateState::None
    }

    /// The install failed after a restart was decided: the card goes away (the next check downloads again).
    pub fn update_failed(&self) {
        self.update(|m| m.update = UpdateState::None);
    }

    /// A downloaded update is ready.
    pub fn update_ready(&self, version: String) {
        self.update(|m| {
            m.update = UpdateState::Ready { version };
            m.announce(copy::UPDATE_READY_ANNOUNCE);
        });
        self.maybe_restart();
    }

    /// `Restart now` (window or tray).
    pub fn restart_now(&self) {
        let ok = {
            let model = lock(&self.model);
            may_restart(&model.league, self.busy())
        };
        let mut restart = false;
        self.update(|m| match &m.update {
            UpdateState::Ready { version } | UpdateState::Scheduled { version } => {
                if ok {
                    m.update = UpdateState::Restarting;
                    restart = true;
                } else {
                    m.update = UpdateState::Scheduled {
                        version: version.clone(),
                    };
                }
            }
            _ => {}
        });
        if restart {
            self.updater.restart_to_update();
        }
    }

    /// The first idle moment after an update is ready restarts by itself (M17.1's rule).
    fn maybe_restart(&self) {
        let go = {
            let model = lock(&self.model);
            matches!(
                model.update,
                UpdateState::Ready { .. } | UpdateState::Scheduled { .. }
            ) && may_restart(&model.league, self.busy())
        };
        if go {
            lock(&self.model).update = UpdateState::Restarting;
            self.publish();
            self.updater.restart_to_update();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::HostGroup;
    use tokio::sync::watch;

    fn group(id: &str, name: &str) -> HostGroup {
        HostGroup {
            id: id.into(),
            slug: id.into(),
            name: name.into(),
        }
    }

    fn ready(groups: Vec<HostGroup>, current: &str) -> HostStatus {
        HostStatus {
            boot: HostBoot::Ready,
            groups,
            current_group: Some(current.into()),
            league: LeagueStatus::NotRunning { searched: vec![] },
            ..HostStatus::default()
        }
    }

    struct NoHost(watch::Sender<HostStatus>);

    impl Host for NoHost {
        fn status(&self) -> watch::Receiver<HostStatus> {
            self.0.subscribe()
        }
        fn switch_group(&self, _: String) -> BoxFuture<'_, ()> {
            Box::pin(async {})
        }
        fn retry_discovery(&self) -> BoxFuture<'_, engine::lcu::LcuDiscovery> {
            unreachable!("not used")
        }
        fn retry_boot(&self) -> BoxFuture<'_, ()> {
            Box::pin(async {})
        }
        fn adopt_linked_group(&self, _: String) -> BoxFuture<'_, ()> {
            Box::pin(async {})
        }
        fn stop(&self) -> BoxFuture<'_, ()> {
            Box::pin(async {})
        }
    }

    struct NoTransport;

    impl Transport for NoTransport {
        fn send(
            &self,
            _: engine::api::transport::HttpRequest,
        ) -> BoxFuture<'_, Result<engine::api::transport::HttpResponse, String>> {
            Box::pin(async { Err("no network in this test".to_owned()) })
        }
    }

    /// A shell that only remembers Start with Windows.
    struct AutostartShell(Mutex<bool>);

    impl Shell for AutostartShell {
        fn render(&self, _: &View) {}
        fn tray(&self, _: &TrayModel) {}
        fn open_url(&self, _: &str) {}
        fn open_path(&self, _: &Path) {}
        fn pick_folder(&self, _: &str, _: PathBuf) -> BoxFuture<'static, Option<PathBuf>> {
            Box::pin(async { None })
        }
        fn autostart(&self) -> Option<bool> {
            Some(*lock(&self.0))
        }
        fn set_autostart(&self, on: bool) -> Option<bool> {
            *lock(&self.0) = on;
            Some(on)
        }
        fn exit(&self) {}
    }

    fn app_with_autostart(on: bool) -> (Arc<App>, Arc<AutostartShell>) {
        let shell = Arc::new(AutostartShell(Mutex::new(on)));
        let (tx, _rx) = watch::channel(HostStatus::default());
        let app = App::new(
            "1.0.0",
            PathBuf::from("C:/x"),
            Arc::new(NoHost(tx)),
            shell.clone(),
            Arc::new(NoUpdater),
            Arc::new(NoTransport),
            "http://kustom.test".to_owned(),
        );
        (app, shell)
    }

    #[test]
    fn a_host_refusal_turns_autostart_off() {
        let (app, shell) = app_with_autostart(true);
        app.show_pair_answer(LinkAnswer::Member("You're in. Only admins can host.".into()));
        assert_eq!(shell.autostart(), Some(false), "L7 turns Start with Windows off");
        assert!(!app.model().autostart, "the checkbox follows");
    }

    #[test]
    fn other_pairing_answers_leave_autostart_alone() {
        let (app, shell) = app_with_autostart(true);
        app.show_pair_answer(LinkAnswer::Refused("That code ran out.".into()));
        app.show_pair_answer(LinkAnswer::Network);
        assert_eq!(shell.autostart(), Some(true));
    }

    #[test]
    fn the_host_status_picks_the_screen() {
        let mut m = Model::new("1.0.0");
        apply_status(&mut m, &HostStatus::default(), None);
        assert_eq!(screen(&m), Screen::Link, "starting with no group: Link");
        let status = HostStatus {
            boot: HostBoot::OldEngineRunning,
            ..HostStatus::default()
        };
        apply_status(&mut m, &status, None);
        assert_eq!(screen(&m), Screen::OldEngine);
        let status = ready(vec![group("g1", "Customs Night")], "g1");
        apply_status(&mut m, &status, None);
        assert_eq!(screen(&m), Screen::Home);
        let status = HostStatus {
            boot: HostBoot::Refused("This Kustom isn't linked any more.".into()),
            ..ready(vec![group("g1", "Customs Night")], "g1")
        };
        apply_status(&mut m, &status, None);
        assert_eq!(screen(&m), Screen::Link);
        assert_eq!(m.refused.as_deref(), Some("This Kustom isn't linked any more."));
    }

    #[test]
    fn not_found_with_no_folder_is_cant_find_and_league_opening_announces() {
        let mut m = Model::new("1.0.0");
        let status = ready(vec![group("g1", "Customs Night")], "g1");
        apply_status(&mut m, &status, None);
        assert_eq!(league_row(&m.league, false), LeagueRow::CantFind);
        let mut connected = status.clone();
        connected.league = LeagueStatus::Connected {
            port: 1,
            step: engine::lcu::DiscoveryStep::RunningClient,
            patch: None,
            install_dir: Some(PathBuf::from(r"D:\Games\League of Legends")),
        };
        apply_status(
            &mut m,
            &connected,
            Some(PathBuf::from(r"D:\Games\League of Legends")),
        );
        assert_eq!(m.announce.as_ref().unwrap().text, "Found League.");
        let mut lobby = connected.clone();
        lobby.phase = Some("Lobby".into());
        apply_status(&mut m, &lobby, Some(PathBuf::from(r"D:\Games\League of Legends")));
        assert_eq!(m.announce.as_ref().unwrap().text, "In a lobby.");
    }

    #[test]
    fn a_pending_switch_and_the_switch_announcement() {
        let mut m = Model::new("1.0.0");
        let groups = vec![group("g1", "Customs Night"), group("g2", "Tuesday Crew")];
        let mut status = ready(groups, "g1");
        status.phase = Some("InProgress".into());
        status.pending_group = Some("g2".into());
        apply_status(&mut m, &status, Some(PathBuf::from("C:/x")));
        let sw = view(&m).home.unwrap().switcher.unwrap();
        assert_eq!(
            sw.line.as_deref(),
            Some("Switches to Tuesday Crew after this game.")
        );
        status.pending_group = None;
        status.phase = None;
        status.current_group = Some("g2".into());
        apply_status(&mut m, &status, Some(PathBuf::from("C:/x")));
        assert_eq!(m.announce.as_ref().unwrap().text, "Switched to Tuesday Crew.");
    }

    #[test]
    fn queued_beats_posted_and_a_new_post_is_announced() {
        let mut m = Model::new("1.0.0");
        let mut status = ready(vec![group("g1", "Customs Night")], "g1");
        let first = engine::config::state::LastPosted {
            at: "2026-10-03T20:00:00.000Z".into(),
            winning_side: engine::api::wire::Side::Blue,
            duration_s: 1500,
        };
        status.last_posted = Some(first);
        apply_status(&mut m, &status, Some(PathBuf::from("C:/x")));
        assert!(m.announce.is_none(), "the file read at start is not news");
        status.queued = 1;
        status.newest_queued_at = Some("2026-10-04T21:42:00.000Z".into());
        apply_status(&mut m, &status, Some(PathBuf::from("C:/x")));
        assert!(matches!(m.last_game, LastGame::Queued { .. }));
        status.queued = 0;
        status.last_posted = Some(engine::config::state::LastPosted {
            at: "2026-10-04T21:42:00.000Z".into(),
            winning_side: engine::api::wire::Side::Red,
            duration_s: 1860,
        });
        apply_status(&mut m, &status, Some(PathBuf::from("C:/x")));
        assert_eq!(m.announce.as_ref().unwrap().text, "Game recorded. Red won.");
    }
}
