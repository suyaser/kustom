//! Every word the window and the tray say (`docs/05-design.md` §9, with product's five signed edits folded
//! in). One place, so a copy change is one diff and the tests can check the screens against §9.
//!
//! Sentences the server writes (pairing refusals, `hostRefusal`, the `/me` 401) are never here: they are
//! shown verbatim from the answer.

/// The window's name (title bar and screen readers).
pub const WINDOW_TITLE: &str = "Kustom";

// --- Header -----------------------------------------------------------------------------------------------

/// The lockup's accessible name.
pub const LOCKUP_LABEL: &str = "Kustom";

/// `Version 1.0.0` (the header's version, read aloud).
pub fn version_label(version: &str) -> String {
    format!("Version {version}")
}

// --- Link (9.4) -------------------------------------------------------------------------------------------

/// L1's heading.
pub const LINK_TITLE: &str = "Link this PC";
/// L9's heading (the current group's token was refused on `/me`).
pub const LINK_TITLE_AGAIN: &str = "Link this PC again";
/// L10's heading (from Home).
pub const LINK_TITLE_ANOTHER: &str = "Link another group";
/// L10's way back.
pub const LINK_BACK: &str = "Back";
/// Step 1 (product's edit 1; M17.18 wording).
pub const LINK_STEP_1: &str = "Get a code on the site: admins from Set up your PC as host on the admin home, everyone else from their invite link.";
/// Step 2.
pub const LINK_STEP_2: &str = "Keep League open and signed in, then type the code here.";
/// The field's label.
pub const LINK_CODE_LABEL: &str = "Code";
/// The button.
pub const LINK_BUTTON: &str = "Link";
/// L3: the button while the request runs.
pub const LINK_BUTTON_BUSY: &str = "Linking…";
/// L1: the slot's help.
pub const LINK_HELP: &str = "Six letters and numbers, from the site.";
/// L2: League is not open or not signed in.
pub const LINK_OPEN_LEAGUE: &str = "Open League and sign in. Kustom reads your League account from it.";
/// L4: fewer than six characters.
pub const LINK_TOO_SHORT: &str = "Type all six characters.";
/// L5: a character the code alphabet leaves out.
pub const LINK_BAD_CHARACTER: &str = "Codes never use O, 0, I or 1. Check the site.";
/// L7's second line, after the server's `hostRefusal` (product's edit 2; M17.19 wording).
pub const LINK_MEMBER_AFTER: &str = "You don't need Kustom to play: the host's Kustom records your games. It won't start with Windows any more, and you can uninstall it.";
/// L8: no answer from the site.
pub const LINK_NETWORK: &str = "Couldn't reach the Kustom site. Check your internet, then press Link again.";
/// L8: a 5xx, or an answer Kustom could not read.
pub const LINK_SERVER: &str = "Couldn't link just now. Press Link again in a minute.";
/// L8b: League stopped answering while the PUUID was read.
pub const LINK_LEAGUE_GONE: &str =
    "Couldn't read your League account. Check you're signed in, then press Link again.";
/// Success: Home's line under the group name until the window is next hidden.
pub const LINKED_LINE: &str = "Linked. Kustom records this group's customs from now on.";
/// L8c: the site linked, but the token could not be written to disk (the code is spent).
pub const LINK_SAVE_FAILED: &str =
    "Kustom couldn't save the link on this PC. Get a new code from the site, then type it here.";

// --- Home (9.5) -------------------------------------------------------------------------------------------

/// The group card's label.
pub const RECORDING_FOR: &str = "Recording for";
/// The select's label.
pub const SWITCH_GROUP: &str = "Switch group";
/// The link-button that opens L10.
pub const LINK_ANOTHER_GROUP: &str = "Link another group";
/// During a switch.
pub const SWITCHING: &str = "Switching…";

/// The guarded switch's line.
pub fn switches_after_game(name: &str) -> String {
    format!("Switches to {name} after this game.")
}

/// The announcer, when a switch happened.
pub fn switched_to(name: &str) -> String {
    format!("Switched to {name}.")
}

/// The button that opens the group's Tonight page.
pub const OPEN_TONIGHT: &str = "Open Tonight";
/// The status card's first row label.
pub const LEAGUE_LABEL: &str = "League";
/// The status card's second row label.
pub const LAST_GAME_LABEL: &str = "Last game";
/// Last game, none (product's edit 3).
pub const LAST_GAME_NONE: &str = "No game recorded yet";
/// Last game, captured but not yet accepted by the site (after the time).
pub const LAST_GAME_QUEUED: &str = "saved, posts when the site answers";
/// Last game, yesterday (before the time).
pub const YESTERDAY: &str = "Yesterday";
/// The winner, blue.
pub const BLUE_WON: &str = "Blue won";
/// The winner, red.
pub const RED_WON: &str = "Red won";
/// After the minutes.
pub const MINUTES_UNIT: &str = "min";

/// The announcer when a game is recorded (product's edit 4).
pub fn game_recorded(winner: &str) -> String {
    format!("Game recorded. {winner}.")
}

// League row (9.5.3).
/// Not running, or reconnecting.
pub const LEAGUE_NOT_OPEN: &str = "League isn't open";
/// Connected and idle.
pub const LEAGUE_OPEN: &str = "League is open";
/// `Lobby`, `Matchmaking`, `ReadyCheck`.
pub const LEAGUE_IN_LOBBY: &str = "In a lobby";
/// `ChampSelect`.
pub const LEAGUE_IN_CHAMP_SELECT: &str = "In champ select";
/// A custom game.
pub const LEAGUE_IN_CUSTOM: &str = "In a custom game";
/// Any other game.
pub const LEAGUE_IN_OTHER_GAME: &str = "In a game (not a custom, not recorded)";
/// `PreEndOfGame`, `EndOfGame`.
pub const LEAGUE_GAME_OVER: &str = "Game over";

// Can't find League (9.5.6).
/// The block's title.
pub const CANT_FIND_TITLE: &str = "Can't find League";
/// The block's line.
pub const CANT_FIND_LINE: &str = "League isn't running, and Kustom couldn't find where it's installed.";
/// Opens the folder picker.
pub const BROWSE: &str = "Browse…";
/// Runs discovery again.
pub const TRY_AGAIN: &str = "Try again";
/// Try again, running.
pub const LOOKING: &str = "Looking…";
/// The hint.
pub const CANT_FIND_HINT: &str = "Opening League also fixes this.";
/// The folder picker's title.
pub const PICKER_TITLE: &str = "Choose your League of Legends folder";
/// While a pick is checked.
pub const CHECKING: &str = "Checking…";
/// A real miss.
pub const FOLDER_MISS: &str = "That folder doesn't look like League. Pick the League of Legends folder, the one with LeagueClient.exe in it.";
/// Try again found nothing.
pub const STILL_CANT_FIND: &str = "Still can't find League.";
/// The announcer, when League turns up by itself.
pub const FOUND_LEAGUE_ANNOUNCE: &str = "Found League.";
/// A good folder that `config.json` could not store (9.5.6).
pub const FOLDER_SAVE_FAILED: &str = "Kustom couldn't save that folder. Pick it again in a moment.";

/// A found folder.
pub fn found_league_in(path: &str) -> String {
    format!("Found League in {path}")
}

// League folder row.
/// The row's label.
pub const LEAGUE_FOLDER: &str = "League folder";
/// No folder known.
pub const NOT_SET: &str = "Not set";
/// The row's link-button.
pub const CHANGE: &str = "Change…";
/// Its accessible name.
pub const CHANGE_LABEL: &str = "Change League folder";

// Update (9.5.4).
/// The card.
/// `Kustom 1.0.3.` never breaks inside (a no-break space, 9.5.4).
pub fn update_ready(version: &str) -> String {
    format!("Update ready: Kustom\u{a0}{version}.")
}
/// The card's button.
pub const RESTART_NOW: &str = "Restart now";
/// `Restart now` while guarded.
pub const RESTARTS_AFTER_GAME: &str = "Kustom restarts after this game.";
/// The whole window while restarting.
pub const RESTARTING: &str = "Restarting to update…";
/// The announcer.
pub const UPDATE_READY_ANNOUNCE: &str = "Update ready.";

// Footer (9.5.5).
/// The checkbox.
pub const START_WITH_WINDOWS: &str = "Start with Windows";
/// The link-button.
pub const OPEN_LOGS: &str = "Open logs";
/// Home only.
pub const CLOSING_NOTE: &str = "Closing this window keeps Kustom running. Quit from the tray icon.";
/// Riot's notice, verbatim as on the web (M14.8, `apps/web/lib/shellCopy.ts`).
pub const RIOT_NOTICE: &str = "Kustom isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.";

// --- Old engine (9.6) -------------------------------------------------------------------------------------

/// The h1 (the brief's sentence, first half).
pub const OLD_ENGINE_TITLE: &str = "The old Kustom is still running.";
/// The first line (second half).
pub const OLD_ENGINE_LINE: &str = "Close it, then press Retry.";
/// The help.
pub const OLD_ENGINE_HELP: &str = "Look for it in the tray by the clock, or in its own window.";
/// The button.
pub const RETRY: &str = "Retry";
/// Still running after Retry.
pub const STILL_RUNNING: &str = "It's still running.";

// --- Tray (9.7) -------------------------------------------------------------------------------------------

/// Line 1 with no token.
pub const TRAY_NOT_LINKED: &str = "Not linked";
/// Line 1 with an old engine running.
pub const TRAY_OLD_ENGINE: &str = "Not recording: the old Kustom is running";
/// The default item.
pub const TRAY_OPEN: &str = "Open Kustom";
/// Restart to update.
pub const TRAY_RESTART: &str = "Restart to update";
/// Restart to update while guarded.
pub const TRAY_RESTART_GUARDED: &str = "Restart to update (after this game)";
/// Quit.
pub const TRAY_QUIT: &str = "Quit Kustom";
/// Tooltip, not linked.
pub const TOOLTIP_NOT_LINKED: &str = "Kustom · not linked";
/// Tooltip, old engine.
pub const TOOLTIP_OLD_ENGINE: &str = "Kustom · not recording, the old Kustom is running";

/// A pending switch's radio item.
pub fn tray_after_game(name: &str) -> String {
    format!("{name} (after this game)")
}
