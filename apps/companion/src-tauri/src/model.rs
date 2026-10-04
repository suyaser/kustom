//! The window's and the tray's state, and the pure functions that turn it into what they show
//! (05-design §9). No Tauri, no I/O: everything here is unit-tested outside the webview, and the webview
//! (`desktop/app.js`) only paints the [`View`] it is sent.

use std::path::PathBuf;

use engine::api::wire::Side;
use engine::config::state::LastPosted;
use serde::Serialize;

use crate::copy;
use crate::link::{FieldAction, LinkAnswer, SlotRole};

pub use engine::host::{HostGroup, SwitchDecision, SwitchState, in_game_phase};

// =========================================================================================================
// State
// =========================================================================================================

/// The connection machine's League side, as the window reads it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LeagueLink {
    /// The machine has not looked yet.
    Starting,
    /// Not running, or not where discovery looked.
    NotRunning,
    /// Found; HTTPS or the socket is being opened, or it was lost and is being looked for again.
    Reconnecting,
    /// Watching.
    Connected,
}

/// Everything the League row needs (9.5.3).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LeagueInput {
    /// The machine's side.
    pub link: LeagueLink,
    /// The gameflow phase, while connected.
    pub phase: Option<String>,
    /// The current game is a custom (`None`: not known yet, read as a custom).
    pub custom: Option<bool>,
    /// The local player is known (`current-summoner` answered): L2 is off.
    pub signed_in: bool,
    /// The folder the engine uses: saved, default, or the one the running client reported.
    pub folder: Option<PathBuf>,
}

impl Default for LeagueInput {
    fn default() -> Self {
        Self {
            link: LeagueLink::Starting,
            phase: None,
            custom: None,
            signed_in: false,
            folder: None,
        }
    }
}

/// What Home's Last game row reads (9.5.3), from `last-posted.json` and the queue.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum LastGame {
    /// Nothing recorded on this PC for this group yet (or the file is missing or malformed).
    #[default]
    None,
    /// The last game the site accepted.
    Posted(LastPosted),
    /// A block captured and waiting in the queue; `at` is its `queuedAt`.
    Queued {
        /// ISO 8601.
        at: String,
    },
}

/// Which button opened the folder picker (the answer goes in the slot under it, 9.5.6).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FolderOrigin {
    /// `Browse…` in the Can't find League block.
    Browse,
    /// `Change…` on the League folder row.
    Change,
    /// `Try again`.
    TryAgain,
}

/// The answer of a pick or a Try again.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FolderAnswer {
    /// Saved as `leagueInstallDir` (pick), or found (Try again).
    Found(PathBuf),
    /// Not a League folder; nothing saved.
    Miss,
    /// Try again found nothing.
    StillNotFound,
    /// A good folder, but `config.json` could not be written.
    SaveFailed,
}

/// The folder flow (9.5.6).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct FolderState {
    /// `Checking…` (a pick) or `Looking…` (Try again), and for which button.
    pub busy: Option<FolderOrigin>,
    /// The last answer and where it shows, kept until the window is hidden.
    pub answer: Option<(FolderOrigin, FolderAnswer)>,
    /// Try again found the client; the plain row shows until the machine catches up.
    pub found_by_try: bool,
}

/// The updater's side, as the window shows it (9.5.4). `updater.rs` drives it.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum UpdateState {
    /// Checking, downloading, failed, or nothing to do: the window shows nothing.
    #[default]
    None,
    /// Downloaded and ready.
    Ready {
        /// The new version.
        version: String,
    },
    /// `Restart now` was pressed while guarded: restarts at the first idle moment.
    Scheduled {
        /// The new version.
        version: String,
    },
    /// Restarting now.
    Restarting,
}

/// The old engine screen (9.6).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct OldEngine {
    /// Retry is running.
    pub checking: bool,
    /// Retry found it still running.
    pub still_running: bool,
}

/// The Link form (9.4).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct LinkForm {
    /// The cleaned code.
    pub code: String,
    /// L3: a request is running.
    pub busy: bool,
    /// The slot's answer, and a counter so the webview applies its field action once.
    pub answer: Option<(u64, LinkAnswer)>,
    /// L5 as typed.
    pub look_alike: bool,
}

/// One polite announcement (9.8); `id` changes for each new sentence.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Announcement {
    /// Increases with every announcement.
    pub id: u64,
    /// The sentence.
    pub text: String,
}

/// The whole app's state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Model {
    /// The app's version.
    pub version: String,
    /// Some: the old Kustom is still running (9.6), nothing else starts.
    pub old_engine: Option<OldEngine>,
    /// Groups this PC can host for.
    pub groups: Vec<HostGroup>,
    /// The group the watchers run for.
    pub current: Option<String>,
    /// The current group's token was refused on `/me`: the server's sentence (L9).
    pub refused: Option<String>,
    /// Link another group (L10) is open over Home.
    pub link_open: bool,
    /// The Link form.
    pub link: LinkForm,
    /// League.
    pub league: LeagueInput,
    /// Last game.
    pub last_game: LastGame,
    /// The switch.
    pub switch: SwitchState,
    /// The folder flow.
    pub folder: FolderState,
    /// The update.
    pub update: UpdateState,
    /// `Start with Windows`, as the OS says.
    pub autostart: bool,
    /// Show `Linked. ...` under the group name until the window is hidden.
    pub linked_line: bool,
    /// The latest announcement.
    pub announce: Option<Announcement>,
    /// The `apiBase` (for Open Tonight).
    pub api_base: String,
    /// The M14.13 guard (a game in progress or a block unposted), from the host.
    pub busy: bool,
}

impl Model {
    /// A fresh model.
    pub fn new(version: impl Into<String>) -> Self {
        Self {
            version: version.into(),
            old_engine: None,
            groups: Vec::new(),
            current: None,
            refused: None,
            link_open: false,
            link: LinkForm::default(),
            league: LeagueInput::default(),
            last_game: LastGame::None,
            switch: SwitchState::default(),
            folder: FolderState::default(),
            update: UpdateState::None,
            autostart: false,
            linked_line: false,
            announce: None,
            api_base: String::new(),
            busy: false,
        }
    }

    /// The current group.
    pub fn current_group(&self) -> Option<&HostGroup> {
        let id = self.current.as_deref()?;
        self.groups.iter().find(|g| g.id == id)
    }

    /// The group named `id`, by name.
    pub fn group_name(&self, id: &str) -> Option<&str> {
        self.groups.iter().find(|g| g.id == id).map(|g| g.name.as_str())
    }

    /// Queues one announcement.
    pub fn announce(&mut self, text: impl Into<String>) {
        let id = self.announce.as_ref().map_or(1, |a| a.id + 1);
        self.announce = Some(Announcement {
            id,
            text: text.into(),
        });
    }

    /// Sets the Link slot's answer (bumping its counter).
    pub fn set_link_answer(&mut self, answer: Option<LinkAnswer>) {
        let next = self.link.answer.as_ref().map_or(1, |(n, _)| n + 1);
        self.link.answer = answer.map(|a| (next, a));
    }

    /// The window was hidden: lines kept "until the window is next hidden" go.
    pub fn window_hidden(&mut self) {
        self.linked_line = false;
        if self.folder.busy.is_none() {
            self.folder.answer = None;
        }
    }

    /// Kustom is recording: a usable token, not refused, no old engine (the tray icon's normal state).
    pub fn recording(&self) -> bool {
        self.old_engine.is_none() && self.current.is_some() && self.refused.is_none()
    }
}

// =========================================================================================================
// League phases
// =========================================================================================================

/// What the League row says (9.5.3).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LeagueRow {
    /// Hollow ring: not open (or reconnecting).
    NotOpen,
    /// The Can't find League block replaces the row.
    CantFind,
    /// Solid: connected and idle.
    Open,
    /// Solid.
    Lobby,
    /// Solid.
    ChampSelect,
    /// Solid.
    CustomGame,
    /// Solid.
    OtherGame,
    /// Solid.
    GameOver,
}

impl LeagueRow {
    /// The row's words.
    pub fn text(self) -> &'static str {
        match self {
            LeagueRow::NotOpen => copy::LEAGUE_NOT_OPEN,
            LeagueRow::CantFind => copy::CANT_FIND_TITLE,
            LeagueRow::Open => copy::LEAGUE_OPEN,
            LeagueRow::Lobby => copy::LEAGUE_IN_LOBBY,
            LeagueRow::ChampSelect => copy::LEAGUE_IN_CHAMP_SELECT,
            LeagueRow::CustomGame => copy::LEAGUE_IN_CUSTOM,
            LeagueRow::OtherGame => copy::LEAGUE_IN_OTHER_GAME,
            LeagueRow::GameOver => copy::LEAGUE_GAME_OVER,
        }
    }

    /// The tray's line 2 (9.7).
    pub fn tray_text(self) -> &'static str {
        match self {
            LeagueRow::NotOpen => "League: isn't open",
            LeagueRow::CantFind => "League: can't find it",
            LeagueRow::Open => "League: open",
            LeagueRow::Lobby => "League: in a lobby",
            LeagueRow::ChampSelect => "League: in champ select",
            LeagueRow::CustomGame => "League: in a custom game",
            LeagueRow::OtherGame => "League: in a game (not a custom)",
            LeagueRow::GameOver => "League: game over",
        }
    }

    /// The solid dot (connected) or the hollow ring.
    pub fn solid(self) -> bool {
        !matches!(self, LeagueRow::NotOpen | LeagueRow::CantFind)
    }
}

/// The League row for a state (9.5.3's table, top to bottom).
pub fn league_row(league: &LeagueInput, found_by_try: bool) -> LeagueRow {
    match league.link {
        LeagueLink::NotRunning if league.folder.is_none() && !found_by_try => LeagueRow::CantFind,
        LeagueLink::Starting | LeagueLink::NotRunning | LeagueLink::Reconnecting => LeagueRow::NotOpen,
        LeagueLink::Connected => match league.phase.as_deref() {
            Some("Lobby" | "Matchmaking" | "ReadyCheck") => LeagueRow::Lobby,
            Some("ChampSelect") => LeagueRow::ChampSelect,
            Some("GameStart" | "InProgress" | "Reconnect" | "WaitingForStats") => {
                if league.custom == Some(false) {
                    LeagueRow::OtherGame
                } else {
                    LeagueRow::CustomGame
                }
            }
            Some("PreEndOfGame" | "EndOfGame") => LeagueRow::GameOver,
            _ => LeagueRow::Open,
        },
    }
}

/// May the updater restart Kustom now (M17.1's rule): League closed or idle in `None`, no game, nothing
/// queued.
pub fn may_restart(league: &LeagueInput, busy: bool) -> bool {
    if busy {
        return false;
    }
    match league.link {
        LeagueLink::Connected => matches!(league.phase.as_deref(), None | Some("None" | "")),
        _ => true,
    }
}

// =========================================================================================================
// View
// =========================================================================================================

/// Which screen (9.3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Screen {
    /// 9.4.
    Link,
    /// 9.5.
    Home,
    /// 9.6.
    OldEngine,
    /// 9.5.4's restarting.
    Restarting,
}

/// Picks the screen, in the order Kustom decides (9.3).
pub fn screen(model: &Model) -> Screen {
    if model.update == UpdateState::Restarting {
        return Screen::Restarting;
    }
    if model.old_engine.is_some() {
        return Screen::OldEngine;
    }
    if model.current_group().is_none() || model.refused.is_some() || model.link_open {
        return Screen::Link;
    }
    Screen::Home
}

/// A slot under a control: its lines and how it is announced.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Slot {
    /// One or two sentences.
    pub lines: Vec<String>,
    /// `status`, `alert` or plain.
    pub role: SlotRole,
}

impl Slot {
    fn one(text: impl Into<String>, role: SlotRole) -> Self {
        Self {
            lines: vec![text.into()],
            role,
        }
    }
}

/// Link's variants (L1, L9, L10).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LinkVariant {
    /// L1.
    First,
    /// L9.
    Again,
    /// L10.
    Another,
}

/// The Link screen.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkView {
    /// Which heading.
    pub variant: LinkVariant,
    /// L10's Back.
    pub back: Option<String>,
    /// The h1.
    pub heading: String,
    /// The two steps.
    pub steps: [String; 2],
    /// `Code`.
    pub label: String,
    /// The field's value.
    pub code: String,
    /// The field is read-only (L3).
    pub read_only: bool,
    /// The button's words.
    pub button: String,
    /// `aria-disabled` (L2, L3).
    pub button_disabled: bool,
    /// The slot.
    pub slot: Slot,
    /// Applied once per `answer_id`.
    pub field_action: FieldAction,
    /// Changes with each answer.
    pub answer_id: u64,
}

/// One option in the select.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupOption {
    /// The id.
    pub id: String,
    /// The name.
    pub name: String,
    /// Selected (the current one, or the pending choice).
    pub selected: bool,
}

/// `Switch group`, only with two or more groups.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitcherView {
    /// `Switch group`.
    pub label: String,
    /// The groups.
    pub options: Vec<GroupOption>,
    /// `aria-disabled` while switching.
    pub disabled: bool,
    /// `Switching…` or `Switches to X after this game.` (`role="status"`).
    pub line: Option<String>,
}

/// The Can't find League block.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CantFindView {
    /// `Can't find League`.
    pub title: String,
    /// The line.
    pub line: String,
    /// `Browse…`.
    pub browse: String,
    /// `Try again` or `Looking…`.
    pub try_again: String,
    /// `aria-disabled` on both buttons.
    pub busy: bool,
    /// The hint.
    pub hint: String,
}

/// The League row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LeagueView {
    /// `League`.
    pub label: String,
    /// The solid dot.
    pub solid: bool,
    /// The row's words (or the block's title).
    pub text: String,
    /// Set when the block replaces the row.
    pub cant_find: Option<CantFindView>,
    /// The answer slot under the block (Browse, Try again).
    pub slot: Option<Slot>,
}

/// The Last game row; the webview formats the time with `Intl.DateTimeFormat` in the PC's locale.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum LastGameView {
    /// `No game recorded yet`.
    None {
        /// The words.
        text: String,
    },
    /// `21:42 · ◥ Red won · 31 min`.
    Posted {
        /// ISO 8601.
        at: String,
        /// `blue` or `red`.
        side: &'static str,
        /// `Blue won` / `Red won`.
        winner: String,
        /// Whole minutes.
        minutes: u64,
        /// `min`.
        unit: String,
        /// `Yesterday`.
        yesterday: String,
    },
    /// `21:42 · saved, posts when the site answers`.
    Queued {
        /// ISO 8601.
        at: String,
        /// The words after the time.
        text: String,
        /// `Yesterday`.
        yesterday: String,
    },
}

/// The update card.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCard {
    /// `Update ready: Kustom 1.0.3.`
    pub text: String,
    /// `Restart now`.
    pub button: String,
    /// `Kustom restarts after this game.` while guarded.
    pub line: Option<String>,
}

/// The League folder row (Home's footer).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderRowView {
    /// `League folder`.
    pub label: String,
    /// The path in full, or `Not set`.
    pub value: String,
    /// `Change…`.
    pub change: String,
    /// `Change League folder`.
    pub change_label: String,
    /// `aria-disabled` while a pick is checked.
    pub busy: bool,
    /// The one-line answer slot.
    pub slot: Option<Slot>,
}

/// Home.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeView {
    /// Only when an update is ready.
    pub update: Option<UpdateCard>,
    /// `Recording for`.
    pub recording_for: String,
    /// The group's name.
    pub group_name: String,
    /// `Linked. ...` after a link.
    pub linked_line: Option<String>,
    /// The select.
    pub switcher: Option<SwitcherView>,
    /// `Link another group`.
    pub link_another: String,
    /// League.
    pub league: LeagueView,
    /// `Last game`.
    pub last_game_label: String,
    /// Last game.
    pub last_game: LastGameView,
    /// `Open Tonight`.
    pub open_tonight: String,
    /// Primary unless the update card shows.
    pub open_tonight_primary: bool,
    /// The League folder row.
    pub folder_row: FolderRowView,
    /// The closing note.
    pub closing_note: String,
}

/// The old engine screen.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OldEngineView {
    /// The h1.
    pub heading: String,
    /// The line.
    pub line: String,
    /// The help.
    pub help: String,
    /// `Retry` or `Checking…`.
    pub button: String,
    /// `aria-disabled` while checking.
    pub busy: bool,
    /// `It's still running.` (`role="alert"`).
    pub slot: Option<Slot>,
}

/// The footer, every screen.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FooterView {
    /// `Start with Windows`.
    pub autostart_label: String,
    /// Checked.
    pub autostart: bool,
    /// `Open logs`.
    pub open_logs: String,
    /// Riot's notice.
    pub riot_notice: String,
}

/// What the webview paints.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    /// The screen.
    pub screen: Screen,
    /// `1.0.0`.
    pub version: String,
    /// `Version 1.0.0`.
    pub version_label: String,
    /// The lockup's name.
    pub lockup_label: String,
    /// On Link.
    pub link: Option<LinkView>,
    /// On Home.
    pub home: Option<HomeView>,
    /// On Old engine.
    pub old_engine: Option<OldEngineView>,
    /// While restarting.
    pub restarting: Option<String>,
    /// Every screen but Restarting.
    pub footer: FooterView,
    /// The polite announcer.
    pub announce: Option<Announcement>,
}

fn link_view(model: &Model) -> LinkView {
    let variant = if model.link_open && model.refused.is_none() {
        LinkVariant::Another
    } else if model.refused.is_some() {
        LinkVariant::Again
    } else {
        LinkVariant::First
    };
    let heading = match variant {
        LinkVariant::First => copy::LINK_TITLE,
        LinkVariant::Again => copy::LINK_TITLE_AGAIN,
        LinkVariant::Another => copy::LINK_TITLE_ANOTHER,
    };
    let league_ready = model.league.link == LeagueLink::Connected && model.league.signed_in;
    let (answer_id, answer) = match &model.link.answer {
        Some((id, answer)) => (*id, Some(answer)),
        None => (0, None),
    };
    let slot = if model.link.look_alike {
        Slot::one(copy::LINK_BAD_CHARACTER, SlotRole::Status)
    } else if let Some(answer) = answer {
        Slot {
            lines: answer.lines(),
            role: answer.role(),
        }
    } else if let Some(sentence) = &model.refused {
        Slot::one(sentence.clone(), SlotRole::Alert)
    } else if !league_ready {
        Slot::one(copy::LINK_OPEN_LEAGUE, SlotRole::Status)
    } else {
        Slot::one(copy::LINK_HELP, SlotRole::None)
    };
    LinkView {
        variant,
        back: (variant == LinkVariant::Another).then(|| copy::LINK_BACK.to_owned()),
        heading: heading.to_owned(),
        steps: [copy::LINK_STEP_1.to_owned(), copy::LINK_STEP_2.to_owned()],
        label: copy::LINK_CODE_LABEL.to_owned(),
        code: model.link.code.clone(),
        read_only: model.link.busy,
        button: if model.link.busy {
            copy::LINK_BUTTON_BUSY
        } else {
            copy::LINK_BUTTON
        }
        .to_owned(),
        button_disabled: model.link.busy || !league_ready,
        slot,
        field_action: answer.map_or(FieldAction::None, LinkAnswer::field_action),
        answer_id,
    }
}

fn folder_slot(answer: &FolderAnswer) -> Slot {
    match answer {
        FolderAnswer::Found(path) => Slot::one(
            copy::found_league_in(&path.display().to_string()),
            SlotRole::Status,
        ),
        FolderAnswer::Miss => Slot::one(copy::FOLDER_MISS, SlotRole::Alert),
        FolderAnswer::StillNotFound => Slot::one(copy::STILL_CANT_FIND, SlotRole::Alert),
        FolderAnswer::SaveFailed => Slot::one(copy::FOLDER_SAVE_FAILED, SlotRole::Alert),
    }
}

fn league_view(model: &Model) -> LeagueView {
    let row = league_row(&model.league, model.folder.found_by_try);
    let busy_here = matches!(
        model.folder.busy,
        Some(FolderOrigin::Browse | FolderOrigin::TryAgain)
    );
    let slot = match &model.folder.busy {
        Some(FolderOrigin::Browse) => Some(Slot::one(copy::CHECKING, SlotRole::Status)),
        _ => match &model.folder.answer {
            Some((FolderOrigin::Browse | FolderOrigin::TryAgain, answer)) => Some(folder_slot(answer)),
            _ => None,
        },
    };
    let cant_find = (row == LeagueRow::CantFind).then(|| CantFindView {
        title: copy::CANT_FIND_TITLE.to_owned(),
        line: copy::CANT_FIND_LINE.to_owned(),
        browse: copy::BROWSE.to_owned(),
        try_again: if model.folder.busy == Some(FolderOrigin::TryAgain) {
            copy::LOOKING
        } else {
            copy::TRY_AGAIN
        }
        .to_owned(),
        busy: busy_here,
        hint: copy::CANT_FIND_HINT.to_owned(),
    });
    LeagueView {
        label: copy::LEAGUE_LABEL.to_owned(),
        solid: row.solid(),
        text: row.text().to_owned(),
        cant_find,
        slot,
    }
}

fn last_game_view(last: &LastGame) -> LastGameView {
    match last {
        LastGame::None => LastGameView::None {
            text: copy::LAST_GAME_NONE.to_owned(),
        },
        LastGame::Posted(posted) => {
            let (side, winner) = match posted.winning_side {
                Side::Blue => ("blue", copy::BLUE_WON),
                Side::Red => ("red", copy::RED_WON),
            };
            LastGameView::Posted {
                at: posted.at.clone(),
                side,
                winner: winner.to_owned(),
                minutes: (posted.duration_s + 30) / 60,
                unit: copy::MINUTES_UNIT.to_owned(),
                yesterday: copy::YESTERDAY.to_owned(),
            }
        }
        LastGame::Queued { at } => LastGameView::Queued {
            at: at.clone(),
            text: copy::LAST_GAME_QUEUED.to_owned(),
            yesterday: copy::YESTERDAY.to_owned(),
        },
    }
}

fn home_view(model: &Model, group: &HostGroup) -> HomeView {
    let update = match &model.update {
        UpdateState::Ready { version } => Some(UpdateCard {
            text: copy::update_ready(version),
            button: copy::RESTART_NOW.to_owned(),
            line: None,
        }),
        UpdateState::Scheduled { version } => Some(UpdateCard {
            text: copy::update_ready(version),
            button: copy::RESTART_NOW.to_owned(),
            line: Some(copy::RESTARTS_AFTER_GAME.to_owned()),
        }),
        UpdateState::None | UpdateState::Restarting => None,
    };
    let switcher = (model.groups.len() >= 2).then(|| {
        let shown = model.switch.pending.as_deref().unwrap_or(&group.id);
        let line = if model.switch.switching {
            Some(copy::SWITCHING.to_owned())
        } else {
            model
                .switch
                .pending
                .as_deref()
                .and_then(|id| model.group_name(id))
                .map(copy::switches_after_game)
        };
        SwitcherView {
            label: copy::SWITCH_GROUP.to_owned(),
            options: model
                .groups
                .iter()
                .map(|g| GroupOption {
                    id: g.id.clone(),
                    name: g.name.clone(),
                    selected: g.id == shown,
                })
                .collect(),
            disabled: model.switch.switching,
            line,
        }
    });
    let folder_slot = match &model.folder.busy {
        Some(FolderOrigin::Change) => Some(Slot::one(copy::CHECKING, SlotRole::Status)),
        _ => match &model.folder.answer {
            Some((FolderOrigin::Change, answer)) => Some(folder_slot(answer)),
            _ => None,
        },
    };
    HomeView {
        open_tonight_primary: update.is_none(),
        update,
        recording_for: copy::RECORDING_FOR.to_owned(),
        group_name: group.name.clone(),
        linked_line: model.linked_line.then(|| copy::LINKED_LINE.to_owned()),
        switcher,
        link_another: copy::LINK_ANOTHER_GROUP.to_owned(),
        league: league_view(model),
        last_game_label: copy::LAST_GAME_LABEL.to_owned(),
        last_game: last_game_view(&model.last_game),
        open_tonight: copy::OPEN_TONIGHT.to_owned(),
        folder_row: FolderRowView {
            label: copy::LEAGUE_FOLDER.to_owned(),
            value: model
                .league
                .folder
                .as_ref()
                .map_or_else(|| copy::NOT_SET.to_owned(), |p| p.display().to_string()),
            change: copy::CHANGE.to_owned(),
            change_label: copy::CHANGE_LABEL.to_owned(),
            busy: model.folder.busy == Some(FolderOrigin::Change),
            slot: folder_slot,
        },
        closing_note: copy::CLOSING_NOTE.to_owned(),
    }
}

/// The whole window for a model.
pub fn view(model: &Model) -> View {
    let screen = screen(model);
    let mut view = View {
        screen,
        version: model.version.clone(),
        version_label: copy::version_label(&model.version),
        lockup_label: copy::LOCKUP_LABEL.to_owned(),
        link: None,
        home: None,
        old_engine: None,
        restarting: None,
        footer: FooterView {
            autostart_label: copy::START_WITH_WINDOWS.to_owned(),
            autostart: model.autostart,
            open_logs: copy::OPEN_LOGS.to_owned(),
            riot_notice: copy::RIOT_NOTICE.to_owned(),
        },
        announce: model.announce.clone(),
    };
    match screen {
        Screen::Link => view.link = Some(link_view(model)),
        Screen::Home => {
            if let Some(group) = model.current_group() {
                view.home = Some(home_view(model, group));
            }
        }
        Screen::OldEngine => {
            let old = model.old_engine.clone().unwrap_or_default();
            view.old_engine = Some(OldEngineView {
                heading: copy::OLD_ENGINE_TITLE.to_owned(),
                line: copy::OLD_ENGINE_LINE.to_owned(),
                help: copy::OLD_ENGINE_HELP.to_owned(),
                button: if old.checking { copy::CHECKING } else { copy::RETRY }.to_owned(),
                busy: old.checking,
                slot: (old.still_running && !old.checking)
                    .then(|| Slot::one(copy::STILL_RUNNING, SlotRole::Alert)),
            });
        }
        Screen::Restarting => view.restarting = Some(copy::RESTARTING.to_owned()),
    }
    view
}

// =========================================================================================================
// Tray
// =========================================================================================================

/// One radio item in Switch group.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrayGroup {
    /// The id.
    pub id: String,
    /// The name, or `X (after this game)`.
    pub label: String,
    /// The current group.
    pub checked: bool,
}

/// The tray (9.7): rebuilt whenever this changes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrayModel {
    /// Disabled line 1.
    pub line1: String,
    /// Disabled line 2 (hidden when not linked or old engine).
    pub line2: Option<String>,
    /// Switch group, only with two or more groups.
    pub groups: Option<Vec<TrayGroup>>,
    /// `Start with Windows`.
    pub autostart: bool,
    /// `Restart to update`, only when ready.
    pub restart: Option<String>,
    /// The tooltip.
    pub tooltip: String,
    /// The hollow-bar icon.
    pub not_recording: bool,
}

/// Windows caps a tray tooltip at 127 characters.
pub const TOOLTIP_MAX: usize = 127;

fn cap_tooltip(text: String) -> String {
    if text.chars().count() <= TOOLTIP_MAX {
        return text;
    }
    let mut out: String = text.chars().take(TOOLTIP_MAX - 1).collect();
    out.push('…');
    out
}

/// The tray for a model.
pub fn tray(model: &Model) -> TrayModel {
    let row = league_row(&model.league, model.folder.found_by_try);
    let ready = matches!(
        model.update,
        UpdateState::Ready { .. } | UpdateState::Scheduled { .. }
    );
    // Guarded (a lobby, champ select, a game, a queued block): the item says so and still schedules.
    let guarded = !may_restart(&model.league, model.busy);
    let restart = match &model.update {
        UpdateState::Ready { .. } if !guarded => Some(copy::TRAY_RESTART.to_owned()),
        UpdateState::Ready { .. } | UpdateState::Scheduled { .. } => {
            Some(copy::TRAY_RESTART_GUARDED.to_owned())
        }
        _ => None,
    };
    let base = TrayModel {
        line1: String::new(),
        line2: None,
        groups: None,
        autostart: model.autostart,
        restart,
        tooltip: String::new(),
        not_recording: !model.recording(),
    };
    if model.old_engine.is_some() {
        return TrayModel {
            line1: copy::TRAY_OLD_ENGINE.to_owned(),
            tooltip: copy::TOOLTIP_OLD_ENGINE.to_owned(),
            ..base
        };
    }
    let Some(group) = model.current_group() else {
        return TrayModel {
            line1: copy::TRAY_NOT_LINKED.to_owned(),
            tooltip: copy::TOOLTIP_NOT_LINKED.to_owned(),
            ..base
        };
    };
    let league = row.tray_text();
    let groups = (model.groups.len() >= 2).then(|| {
        model
            .groups
            .iter()
            .map(|g| TrayGroup {
                id: g.id.clone(),
                label: if model.switch.pending.as_deref() == Some(g.id.as_str()) {
                    copy::tray_after_game(&g.name)
                } else {
                    g.name.clone()
                },
                checked: g.id == group.id,
            })
            .collect()
    });
    let mut tooltip = format!("Kustom {} · {} · {}", model.version, group.name, league);
    if ready {
        tooltip.push_str(" · update ready");
    }
    TrayModel {
        line1: group.name.clone(),
        line2: Some(league.to_owned()),
        groups,
        tooltip: cap_tooltip(tooltip),
        ..base
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn group(id: &str, name: &str) -> HostGroup {
        HostGroup {
            id: id.into(),
            slug: id.into(),
            name: name.into(),
        }
    }

    fn home_model() -> Model {
        let mut m = Model::new("1.0.0");
        m.groups = vec![group("g1", "Customs Night")];
        m.current = Some("g1".into());
        m.league.folder = Some(PathBuf::from(r"C:\Riot Games\League of Legends"));
        m
    }

    fn connected(m: &mut Model, phase: Option<&str>) {
        m.league.link = LeagueLink::Connected;
        m.league.signed_in = true;
        m.league.phase = phase.map(str::to_owned);
    }

    #[test]
    fn the_screen_follows_9_3() {
        let mut m = Model::new("1.0.0");
        assert_eq!(screen(&m), Screen::Link, "no token: Link");
        m = home_model();
        assert_eq!(screen(&m), Screen::Home);
        m.refused = Some("This token no longer works.".into());
        assert_eq!(screen(&m), Screen::Link, "token refused: Link again");
        assert_eq!(view(&m).link.unwrap().variant, LinkVariant::Again);
        m.refused = None;
        m.link_open = true;
        let v = view(&m).link.unwrap();
        assert_eq!(v.variant, LinkVariant::Another);
        assert_eq!(v.back.as_deref(), Some("Back"));
        assert_eq!(v.heading, "Link another group");
        m.old_engine = Some(OldEngine::default());
        assert_eq!(
            screen(&m),
            Screen::OldEngine,
            "the old engine wins over everything but restarting"
        );
        m.update = UpdateState::Restarting;
        assert_eq!(screen(&m), Screen::Restarting);
        assert_eq!(view(&m).restarting.as_deref(), Some("Restarting to update…"));
    }

    #[test]
    fn a_current_group_that_is_not_in_the_list_is_link() {
        let mut m = home_model();
        m.current = Some("gone".into());
        assert_eq!(screen(&m), Screen::Link);
    }

    #[test]
    fn link_l1_l2_l3() {
        let mut m = Model::new("1.0.0");
        let v = view(&m).link.unwrap();
        assert_eq!(v.heading, "Link this PC");
        assert_eq!(v.steps[0], copy::LINK_STEP_1);
        assert!(v.button_disabled, "L2: League not open");
        assert_eq!(v.slot.lines, vec![copy::LINK_OPEN_LEAGUE]);
        connected(&mut m, Some("None"));
        let v = view(&m).link.unwrap();
        assert!(!v.button_disabled, "re-enabled live when League connects");
        assert_eq!(v.slot.lines, vec!["Six letters and numbers, from the site."]);
        assert_eq!(v.slot.role, SlotRole::None);
        m.link.busy = true;
        let v = view(&m).link.unwrap();
        assert_eq!(v.button, "Linking…");
        assert!(v.read_only && v.button_disabled);
        // Connected but current-summoner did not answer: still L2.
        m.link.busy = false;
        m.league.signed_in = false;
        assert!(view(&m).link.unwrap().button_disabled);
    }

    #[test]
    fn link_answers_and_l9_sentence() {
        let mut m = Model::new("1.0.0");
        connected(&mut m, None);
        m.set_link_answer(Some(LinkAnswer::Refused(
            "That code ran out. Get a new one where you got this one.".into(),
        )));
        let v = view(&m).link.unwrap();
        assert_eq!(v.slot.role, SlotRole::Alert);
        assert_eq!(v.field_action, FieldAction::Select);
        assert_eq!(v.answer_id, 1);
        m.set_link_answer(Some(LinkAnswer::TooShort));
        let v = view(&m).link.unwrap();
        assert_eq!(v.answer_id, 2);
        assert_eq!(v.slot.lines, vec!["Type all six characters."]);
        m.link.look_alike = true;
        assert_eq!(
            view(&m).link.unwrap().slot.lines,
            vec!["Codes never use O, 0, I or 1. Check the site."]
        );
        let mut again = home_model();
        connected(&mut again, None);
        again.refused = Some("This Kustom isn't linked any more.".into());
        let v = view(&again).link.unwrap();
        assert_eq!(v.heading, "Link this PC again");
        assert_eq!(v.slot.lines, vec!["This Kustom isn't linked any more."]);
        assert_eq!(v.slot.role, SlotRole::Alert);
    }

    #[test]
    fn every_league_state_has_its_row() {
        let mut m = home_model();
        let row = |m: &Model| league_row(&m.league, m.folder.found_by_try);
        assert_eq!(row(&m), LeagueRow::NotOpen, "starting");
        m.league.link = LeagueLink::NotRunning;
        assert_eq!(row(&m), LeagueRow::NotOpen, "not running, folder known");
        m.league.folder = None;
        assert_eq!(row(&m), LeagueRow::CantFind, "not running, no folder");
        m.folder.found_by_try = true;
        assert_eq!(row(&m), LeagueRow::NotOpen, "Try again found it");
        m.folder.found_by_try = false;
        m.league.link = LeagueLink::Reconnecting;
        assert_eq!(row(&m), LeagueRow::NotOpen, "reconnecting is never Can't find");
        for (phase, want) in [
            (None, LeagueRow::Open),
            (Some("None"), LeagueRow::Open),
            (Some("Lobby"), LeagueRow::Lobby),
            (Some("Matchmaking"), LeagueRow::Lobby),
            (Some("ReadyCheck"), LeagueRow::Lobby),
            (Some("ChampSelect"), LeagueRow::ChampSelect),
            (Some("GameStart"), LeagueRow::CustomGame),
            (Some("InProgress"), LeagueRow::CustomGame),
            (Some("Reconnect"), LeagueRow::CustomGame),
            (Some("WaitingForStats"), LeagueRow::CustomGame),
            (Some("PreEndOfGame"), LeagueRow::GameOver),
            (Some("EndOfGame"), LeagueRow::GameOver),
            (Some("TerminatedInError"), LeagueRow::Open),
        ] {
            connected(&mut m, phase);
            assert_eq!(row(&m), want, "{phase:?}");
        }
        connected(&mut m, Some("InProgress"));
        m.league.custom = Some(false);
        assert_eq!(row(&m), LeagueRow::OtherGame);
        assert_eq!(
            LeagueRow::OtherGame.text(),
            "In a game (not a custom, not recorded)"
        );
        assert_eq!(
            LeagueRow::OtherGame.tray_text(),
            "League: in a game (not a custom)"
        );
        assert!(!LeagueRow::NotOpen.solid() && LeagueRow::Lobby.solid());
    }

    #[test]
    fn cant_find_block_and_browse_answers() {
        let mut m = home_model();
        m.league.link = LeagueLink::NotRunning;
        m.league.folder = None;
        let league = view(&m).home.unwrap().league;
        let block = league.cant_find.unwrap();
        assert_eq!(block.title, "Can't find League");
        assert_eq!(block.try_again, "Try again");
        assert!(!block.busy);
        assert!(league.slot.is_none());
        assert_eq!(view(&m).home.unwrap().folder_row.value, "Not set");

        m.folder.busy = Some(FolderOrigin::Browse);
        let league = view(&m).home.unwrap().league;
        assert!(league.cant_find.unwrap().busy);
        assert_eq!(league.slot.unwrap().lines, vec!["Checking…"]);

        m.folder.busy = None;
        m.folder.answer = Some((FolderOrigin::Browse, FolderAnswer::Miss));
        let slot = view(&m).home.unwrap().league.slot.unwrap();
        assert_eq!(slot.lines, vec![copy::FOLDER_MISS]);
        assert_eq!(slot.role, SlotRole::Alert);

        m.folder.busy = Some(FolderOrigin::TryAgain);
        assert_eq!(
            view(&m).home.unwrap().league.cant_find.unwrap().try_again,
            "Looking…"
        );
        m.folder.busy = None;
        m.folder.answer = Some((FolderOrigin::TryAgain, FolderAnswer::StillNotFound));
        assert_eq!(
            view(&m).home.unwrap().league.slot.unwrap().lines,
            vec!["Still can't find League."]
        );

        // Found: the block goes back to the plain row, the line stays until the window is hidden.
        let found = PathBuf::from(r"D:\Games\Riot Games\League of Legends");
        m.league.folder = Some(found.clone());
        m.folder.answer = Some((FolderOrigin::Browse, FolderAnswer::Found(found)));
        let home = view(&m).home.unwrap();
        assert!(home.league.cant_find.is_none());
        assert_eq!(home.league.text, "League isn't open");
        let slot = home.league.slot.unwrap();
        assert_eq!(
            slot.lines,
            vec![r"Found League in D:\Games\Riot Games\League of Legends"]
        );
        assert_eq!(slot.role, SlotRole::Status);
        assert_eq!(home.folder_row.value, r"D:\Games\Riot Games\League of Legends");
        m.window_hidden();
        assert!(view(&m).home.unwrap().league.slot.is_none());
    }

    #[test]
    fn change_answers_go_under_the_folder_row() {
        let mut m = home_model();
        m.folder.answer = Some((FolderOrigin::Change, FolderAnswer::Miss));
        let home = view(&m).home.unwrap();
        assert!(home.league.slot.is_none());
        assert_eq!(home.folder_row.slot.unwrap().lines, vec![copy::FOLDER_MISS]);
        assert_eq!(
            home.folder_row.value, r"C:\Riot Games\League of Legends",
            "a miss keeps the old folder"
        );
        assert_eq!(home.folder_row.change_label, "Change League folder");
    }

    #[test]
    fn last_game_cases() {
        let mut m = home_model();
        assert_eq!(
            view(&m).home.unwrap().last_game,
            LastGameView::None {
                text: "No game recorded yet".into()
            }
        );
        m.last_game = LastGame::Posted(LastPosted {
            at: "2026-10-04T21:42:00.000Z".into(),
            winning_side: Side::Red,
            duration_s: 1860,
        });
        let LastGameView::Posted {
            side,
            winner,
            minutes,
            unit,
            ..
        } = view(&m).home.unwrap().last_game
        else {
            panic!()
        };
        assert_eq!(
            (side, winner.as_str(), minutes, unit.as_str()),
            ("red", "Red won", 31, "min")
        );
        m.last_game = LastGame::Queued {
            at: "2026-10-04T21:42:00.000Z".into(),
        };
        let LastGameView::Queued { text, .. } = view(&m).home.unwrap().last_game else {
            panic!()
        };
        assert_eq!(text, "saved, posts when the site answers");
    }

    #[test]
    fn last_posted_after_a_restart_and_a_bad_file() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            engine::config::state::read_last_posted(dir.path()),
            None,
            "missing"
        );
        std::fs::write(dir.path().join("last-posted.json"), "{not json").unwrap();
        assert_eq!(
            engine::config::state::read_last_posted(dir.path()),
            None,
            "malformed, never a crash"
        );
        let posted = LastPosted {
            at: "2026-10-04T21:42:00.000Z".into(),
            winning_side: Side::Blue,
            duration_s: 1680,
        };
        assert!(engine::config::state::write_last_posted(dir.path(), &posted));
        let read = engine::config::state::read_last_posted(dir.path()).unwrap();
        let mut m = home_model();
        m.last_game = LastGame::Posted(read);
        let LastGameView::Posted { winner, minutes, .. } = view(&m).home.unwrap().last_game else {
            panic!()
        };
        assert_eq!((winner.as_str(), minutes), ("Blue won", 28));
    }

    #[test]
    fn the_switch_guard_waits_for_the_game() {
        let groups = vec![group("g1", "Customs Night"), group("g2", "Tuesday Crew")];
        let mut s = SwitchState::default();
        assert_eq!(
            s.choose(&groups, Some("g1"), "nope", false),
            SwitchDecision::Nothing
        );
        assert_eq!(
            s.choose(&groups, Some("g1"), "g1", false),
            SwitchDecision::Nothing
        );
        // A game in progress: held.
        assert_eq!(
            s.choose(&groups, Some("g1"), "g2", true),
            SwitchDecision::Deferred("g2".into())
        );
        assert_eq!(s.pending.as_deref(), Some("g2"));
        assert_eq!(s.release(true), None, "still in the game");
        assert_eq!(s.release(false), Some("g2".into()), "the game ended: it runs");
        assert!(s.switching && s.pending.is_none());
        assert_eq!(
            s.choose(&groups, Some("g1"), "g2", false),
            SwitchDecision::Nothing,
            "one at a time"
        );
        s.done();
        // Choosing the current group again cancels a held switch.
        assert_eq!(
            s.choose(&groups, Some("g1"), "g2", true),
            SwitchDecision::Deferred("g2".into())
        );
        assert_eq!(
            s.choose(&groups, Some("g1"), "g1", true),
            SwitchDecision::Cancelled
        );
        assert_eq!(s.release(false), None);
        // Idle: now.
        assert_eq!(
            s.choose(&groups, Some("g1"), "g2", false),
            SwitchDecision::Now("g2".into())
        );
        s.done();
        // No group running yet (first link): never busy-held by a previous group.
        assert_eq!(
            s.choose(&groups, None, "g1", false),
            SwitchDecision::Now("g1".into())
        );
    }

    #[test]
    fn the_select_shows_the_pending_choice_and_its_line() {
        let mut m = home_model();
        assert!(view(&m).home.unwrap().switcher.is_none(), "one group: no select");
        m.groups.push(group("g2", "Tuesday Crew"));
        let sw = view(&m).home.unwrap().switcher.unwrap();
        assert_eq!(sw.label, "Switch group");
        assert!(sw.options[0].selected && !sw.options[1].selected);
        assert_eq!(sw.line, None);
        m.switch.pending = Some("g2".into());
        let sw = view(&m).home.unwrap().switcher.unwrap();
        assert!(sw.options[1].selected, "the select shows the choice");
        assert_eq!(
            sw.line.as_deref(),
            Some("Switches to Tuesday Crew after this game.")
        );
        m.switch.pending = None;
        m.switch.switching = true;
        let sw = view(&m).home.unwrap().switcher.unwrap();
        assert!(sw.disabled);
        assert_eq!(sw.line.as_deref(), Some("Switching…"));
    }

    #[test]
    fn update_card_and_one_primary() {
        let mut m = home_model();
        assert!(view(&m).home.unwrap().open_tonight_primary);
        m.update = UpdateState::Ready {
            version: "1.0.3".into(),
        };
        let home = view(&m).home.unwrap();
        assert!(!home.open_tonight_primary, "one primary per screen");
        let card = home.update.unwrap();
        assert_eq!(card.text, "Update ready: Kustom\u{a0}1.0.3.");
        assert_eq!(card.button, "Restart now");
        m.update = UpdateState::Scheduled {
            version: "1.0.3".into(),
        };
        assert_eq!(
            view(&m).home.unwrap().update.unwrap().line.as_deref(),
            Some("Kustom restarts after this game.")
        );
    }

    #[test]
    fn the_restart_rule() {
        let mut league = LeagueInput::default();
        assert!(may_restart(&league, false), "League closed");
        assert!(!may_restart(&league, true), "a queued block");
        league.link = LeagueLink::Connected;
        for (phase, ok) in [
            (None, true),
            (Some("None"), true),
            (Some("Lobby"), false),
            (Some("ChampSelect"), false),
            (Some("InProgress"), false),
            (Some("EndOfGame"), false),
        ] {
            league.phase = phase.map(str::to_owned);
            assert_eq!(may_restart(&league, false), ok, "{phase:?}");
        }
    }

    #[test]
    fn old_engine_screen_and_retry() {
        let mut m = Model::new("1.0.0");
        m.old_engine = Some(OldEngine::default());
        let v = view(&m).old_engine.unwrap();
        assert_eq!(v.heading, "The old Kustom is still running.");
        assert_eq!(v.line, "Close it, then press Retry.");
        assert_eq!(
            format!("{} {}", v.heading, v.line),
            engine::config::OLD_ENGINE_SENTENCE
        );
        assert_eq!(v.button, "Retry");
        m.old_engine = Some(OldEngine {
            checking: true,
            still_running: false,
        });
        assert_eq!(view(&m).old_engine.unwrap().button, "Checking…");
        m.old_engine = Some(OldEngine {
            checking: false,
            still_running: true,
        });
        let slot = view(&m).old_engine.unwrap().slot.unwrap();
        assert_eq!(
            (slot.lines[0].as_str(), slot.role),
            ("It's still running.", SlotRole::Alert)
        );
    }

    #[test]
    fn the_tray_menu_and_tooltip() {
        let mut m = Model::new("1.0.0");
        let t = tray(&m);
        assert_eq!((t.line1.as_str(), t.line2.clone()), ("Not linked", None));
        assert_eq!(t.tooltip, "Kustom · not linked");
        assert!(t.not_recording);
        m = home_model();
        m.groups.push(group("g2", "Tuesday Crew"));
        connected(&mut m, Some("Lobby"));
        let t = tray(&m);
        assert_eq!(t.line1, "Customs Night");
        assert_eq!(t.line2.as_deref(), Some("League: in a lobby"));
        assert_eq!(t.tooltip, "Kustom 1.0.0 · Customs Night · League: in a lobby");
        assert!(!t.not_recording);
        let groups = t.groups.unwrap();
        assert!(groups[0].checked && !groups[1].checked);
        m.switch.pending = Some("g2".into());
        m.update = UpdateState::Ready {
            version: "1.0.3".into(),
        };
        let t = tray(&m);
        assert_eq!(t.groups.unwrap()[1].label, "Tuesday Crew (after this game)");
        assert_eq!(
            t.restart.as_deref(),
            Some("Restart to update (after this game)"),
            "ready, but in a lobby: guarded"
        );
        connected(&mut m, Some("None"));
        assert_eq!(tray(&m).restart.as_deref(), Some("Restart to update"), "idle");
        m.busy = true;
        assert_eq!(
            tray(&m).restart.as_deref(),
            Some("Restart to update (after this game)"),
            "a queued block"
        );
        m.busy = false;
        let t = tray(&m);
        assert!(t.tooltip.ends_with(" · update ready"));
        m.update = UpdateState::Scheduled {
            version: "1.0.3".into(),
        };
        assert_eq!(
            tray(&m).restart.as_deref(),
            Some("Restart to update (after this game)")
        );
        m.league.link = LeagueLink::NotRunning;
        m.league.folder = None;
        assert_eq!(tray(&m).line2.as_deref(), Some("League: can't find it"));
        assert!(
            !tray(&m).not_recording,
            "League closed is normal, not 'not recording'"
        );
        m.refused = Some("x".into());
        assert!(tray(&m).not_recording);
        m.old_engine = Some(OldEngine::default());
        let t = tray(&m);
        assert_eq!(t.line1, "Not recording: the old Kustom is running");
        assert_eq!(t.line2, None);
        assert_eq!(t.tooltip, "Kustom · not recording, the old Kustom is running");
    }

    #[test]
    fn a_long_name_keeps_the_tooltip_under_windows_cap() {
        let mut m = home_model();
        m.groups[0].name = "N".repeat(200);
        let t = tray(&m);
        assert_eq!(t.tooltip.chars().count(), TOOLTIP_MAX);
    }

    #[test]
    fn hiding_the_window_clears_the_kept_lines() {
        let mut m = home_model();
        m.linked_line = true;
        assert_eq!(
            view(&m).home.unwrap().linked_line.as_deref(),
            Some(copy::LINKED_LINE)
        );
        m.window_hidden();
        assert!(view(&m).home.unwrap().linked_line.is_none());
    }

    #[test]
    fn the_view_serialises_for_the_webview() {
        let m = home_model();
        let json = serde_json::to_value(view(&m)).unwrap();
        assert_eq!(json["screen"], "home");
        assert_eq!(json["home"]["groupName"], "Customs Night");
        assert_eq!(json["home"]["lastGame"]["kind"], "none");
        assert_eq!(json["footer"]["autostartLabel"], "Start with Windows");
        assert_eq!(json["versionLabel"], "Version 1.0.0");
    }
}
