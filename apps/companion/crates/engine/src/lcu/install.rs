//! The League install folder a person picks when discovery cannot find the client (M17.5 scope addition;
//! the folder picker itself is M17.8's). [`validate_install_dir`] accepts the folder that holds the
//! `LeagueClient` executable or the lockfile, and quietly corrects the common near misses: the `Riot Games`
//! folder, the `Game` subfolder, the lockfile or executable itself, and on macOS the app bundle or
//! `/Applications`. [`save_install_dir`] validates and then persists it as `leagueInstallDir` in
//! `config.json`.
//!
//! Layouts (checked on this Mac's install, and the documented Windows default):
//! - Windows: `C:\Riot Games\League of Legends\` holds `LeagueClient.exe`, `LeagueClientUx.exe`, `Game\` and,
//!   while the client runs, `lockfile`.
//! - macOS: `/Applications/League of Legends.app/Contents/LoL/` holds `LeagueClient.app`, `Game/` and the
//!   lockfile.

use std::fmt;
use std::path::{Path, PathBuf};

use super::lockfile::LOCKFILE_NAME;

/// Files whose presence marks a folder as a League install.
const CLIENT_MARKERS: [&str; 3] = ["LeagueClient.exe", "LeagueClient.app", "LeagueClient"];

/// A folder that holds League, and where its lockfile appears while the client runs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidInstall {
    /// The install folder (the one the lockfile is written in).
    pub dir: PathBuf,
    /// `<dir>/lockfile`.
    pub lockfile: PathBuf,
    /// Set when the picked path was a near miss that was corrected.
    pub corrected: Option<Correction>,
}

/// The near misses [`validate_install_dir`] corrects.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Correction {
    /// The lockfile itself was picked.
    PickedLockfile,
    /// `LeagueClient.exe` (or `LeagueClientUx.exe`) was picked.
    PickedExecutable,
    /// The `Riot Games` folder was picked; League is inside it.
    PickedRiotGamesFolder,
    /// The `Game` subfolder was picked; the client is one level up.
    PickedGameFolder,
    /// macOS: `League of Legends.app` was picked; the install is `Contents/LoL` inside it.
    PickedAppBundle,
    /// macOS: `/Applications` (or wherever the app sits) was picked.
    PickedApplicationsFolder,
}

/// Why a picked path is not a League install. [`InvalidInstall::message`] is a sentence the window can show
/// as is (product may reword it in M17.8).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InvalidInstall {
    /// Nothing exists at the path.
    DoesNotExist(PathBuf),
    /// The path exists but neither it nor any near miss holds the League client.
    NoLeagueClient(PathBuf),
}

impl InvalidInstall {
    /// The sentence for the window.
    pub fn message(&self) -> &'static str {
        match self {
            InvalidInstall::DoesNotExist(_) => {
                "That folder doesn't exist. Pick the folder League is installed in."
            }
            InvalidInstall::NoLeagueClient(_) => {
                "League isn't in that folder. Pick the League of Legends folder (the one with LeagueClient in it)."
            }
        }
    }
}

impl fmt::Display for InvalidInstall {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.message())
    }
}

impl std::error::Error for InvalidInstall {}

fn holds_client(dir: &Path) -> bool {
    dir.is_dir() && (CLIENT_MARKERS.iter().any(|m| dir.join(m).exists()) || dir.join(LOCKFILE_NAME).is_file())
}

fn found(dir: PathBuf, corrected: Option<Correction>) -> ValidInstall {
    let lockfile = dir.join(LOCKFILE_NAME);
    ValidInstall {
        dir,
        lockfile,
        corrected,
    }
}

fn name_is(path: &Path, name: &str) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.eq_ignore_ascii_case(name))
}

/// Checks a picked path and corrects the common near misses. Touches the filesystem read-only.
pub fn validate_install_dir(path: &Path) -> Result<ValidInstall, InvalidInstall> {
    if !path.exists() {
        return Err(InvalidInstall::DoesNotExist(path.to_path_buf()));
    }
    if path.is_file() {
        let parent = path.parent().map(Path::to_path_buf).unwrap_or_default();
        let correction = if name_is(path, LOCKFILE_NAME) {
            Some(Correction::PickedLockfile)
        } else if name_is(path, "LeagueClient.exe") || name_is(path, "LeagueClientUx.exe") {
            Some(Correction::PickedExecutable)
        } else {
            None
        };
        return match correction {
            Some(c) if holds_client(&parent) => Ok(found(parent, Some(c))),
            _ => Err(InvalidInstall::NoLeagueClient(path.to_path_buf())),
        };
    }
    if name_is(path, "LeagueClient.app") {
        if let Some(parent) = path.parent().filter(|p| holds_client(p)) {
            return Ok(found(parent.to_path_buf(), Some(Correction::PickedExecutable)));
        }
    }
    if holds_client(path) {
        return Ok(found(path.to_path_buf(), None));
    }
    let near_misses: [(PathBuf, Correction); 4] = [
        (path.join("League of Legends"), Correction::PickedRiotGamesFolder),
        (path.join("Contents").join("LoL"), Correction::PickedAppBundle),
        (
            path.join("League of Legends.app").join("Contents").join("LoL"),
            Correction::PickedApplicationsFolder,
        ),
        (
            path.parent().map(Path::to_path_buf).unwrap_or_default(),
            Correction::PickedGameFolder,
        ),
    ];
    for (candidate, correction) in near_misses {
        if correction == Correction::PickedGameFolder && !name_is(path, "Game") {
            continue;
        }
        if holds_client(&candidate) {
            return Ok(found(candidate, Some(correction)));
        }
    }
    Err(InvalidInstall::NoLeagueClient(path.to_path_buf()))
}

/// Why [`save_install_dir`] did not save.
#[derive(Debug)]
pub enum SaveInstallError {
    /// The path is not a League install; nothing was written.
    Invalid(InvalidInstall),
    /// `config.json` could not be read or written.
    Config(crate::config::ConfigWriteError),
}

impl fmt::Display for SaveInstallError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SaveInstallError::Invalid(invalid) => invalid.fmt(f),
            SaveInstallError::Config(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for SaveInstallError {}

/// Validates `path` and, when it is a League install, stores the corrected folder as `leagueInstallDir` in
/// `<config_dir>/config.json` (every other key kept). Returns what was saved.
pub fn save_install_dir(config_dir: &Path, path: &Path) -> Result<ValidInstall, SaveInstallError> {
    let valid = validate_install_dir(path).map_err(SaveInstallError::Invalid)?;
    crate::config::write_league_install_dir(config_dir, &valid.dir).map_err(SaveInstallError::Config)?;
    Ok(valid)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn windows_like() -> (tempfile::TempDir, PathBuf) {
        let root = tempfile::tempdir().unwrap();
        let riot = root.path().join("Riot Games");
        let lol = riot.join("League of Legends");
        fs::create_dir_all(lol.join("Game")).unwrap();
        fs::create_dir_all(riot.join("Riot Client")).unwrap();
        fs::write(lol.join("LeagueClient.exe"), b"").unwrap();
        fs::write(lol.join("LeagueClientUx.exe"), b"").unwrap();
        fs::write(lol.join("Game").join("League of Legends.exe"), b"").unwrap();
        (root, lol)
    }

    fn macos_like() -> (tempfile::TempDir, PathBuf) {
        let root = tempfile::tempdir().unwrap();
        let apps = root.path().join("Applications");
        let lol = apps.join("League of Legends.app").join("Contents").join("LoL");
        fs::create_dir_all(lol.join("LeagueClient.app")).unwrap();
        fs::create_dir_all(lol.join("Game")).unwrap();
        (root, lol)
    }

    #[test]
    fn the_install_folder_itself() {
        let (_root, lol) = windows_like();
        let valid = validate_install_dir(&lol).unwrap();
        assert_eq!(valid.dir, lol);
        assert_eq!(valid.lockfile, lol.join("lockfile"));
        assert_eq!(valid.corrected, None);
    }

    #[test]
    fn the_riot_games_folder() {
        let (_root, lol) = windows_like();
        let valid = validate_install_dir(lol.parent().unwrap()).unwrap();
        assert_eq!(
            (valid.dir, valid.corrected),
            (lol, Some(Correction::PickedRiotGamesFolder))
        );
    }

    #[test]
    fn the_game_subfolder() {
        let (_root, lol) = windows_like();
        let valid = validate_install_dir(&lol.join("Game")).unwrap();
        assert_eq!(
            (valid.dir, valid.corrected),
            (lol, Some(Correction::PickedGameFolder))
        );
    }

    #[test]
    fn the_executable_or_the_lockfile() {
        let (_root, lol) = windows_like();
        let valid = validate_install_dir(&lol.join("LeagueClient.exe")).unwrap();
        assert_eq!(
            (valid.dir.clone(), valid.corrected),
            (lol.clone(), Some(Correction::PickedExecutable))
        );
        fs::write(lol.join("lockfile"), b"LeagueClient:1:2:pw:https").unwrap();
        let valid = validate_install_dir(&lol.join("lockfile")).unwrap();
        assert_eq!(
            (valid.dir, valid.corrected),
            (lol, Some(Correction::PickedLockfile))
        );
    }

    #[test]
    fn a_folder_with_only_a_lockfile_counts() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("lockfile"), b"x").unwrap();
        assert_eq!(validate_install_dir(root.path()).unwrap().dir, root.path());
    }

    #[test]
    fn macos_bundle_and_applications_folder() {
        let (_root, lol) = macos_like();
        let bundle = lol.parent().unwrap().parent().unwrap();
        let valid = validate_install_dir(bundle).unwrap();
        assert_eq!(
            (valid.dir.clone(), valid.corrected),
            (lol.clone(), Some(Correction::PickedAppBundle))
        );
        let valid = validate_install_dir(bundle.parent().unwrap()).unwrap();
        assert_eq!(
            (valid.dir.clone(), valid.corrected),
            (lol.clone(), Some(Correction::PickedApplicationsFolder))
        );
        let valid = validate_install_dir(&lol).unwrap();
        assert_eq!(valid.corrected, None);
        let valid = validate_install_dir(&lol.join("LeagueClient.app")).unwrap();
        assert_eq!(
            (valid.dir, valid.corrected),
            (lol.clone(), Some(Correction::PickedExecutable))
        );
        let valid = validate_install_dir(&lol.join("Game")).unwrap();
        assert_eq!(valid.corrected, Some(Correction::PickedGameFolder));
    }

    #[test]
    fn wrong_folders_say_why() {
        let (root, lol) = windows_like();
        let missing = root.path().join("nope");
        assert_eq!(
            validate_install_dir(&missing),
            Err(InvalidInstall::DoesNotExist(missing.clone()))
        );
        let riot_client = lol.parent().unwrap().join("Riot Client");
        let err = validate_install_dir(&riot_client).unwrap_err();
        assert_eq!(err, InvalidInstall::NoLeagueClient(riot_client));
        assert!(err.message().contains("League of Legends folder"));
        let stray = root.path().join("notes.txt");
        fs::write(&stray, b"").unwrap();
        assert!(matches!(
            validate_install_dir(&stray),
            Err(InvalidInstall::NoLeagueClient(_))
        ));
        // A "Game" folder that is not inside an install is not corrected into one.
        let lone_game = root.path().join("Game");
        fs::create_dir_all(&lone_game).unwrap();
        assert!(validate_install_dir(&lone_game).is_err());
    }

    #[test]
    fn save_validates_first_and_keeps_other_keys() {
        let (_root, lol) = windows_like();
        let config = tempfile::tempdir().unwrap();
        fs::write(
            config.path().join("config.json"),
            "{\n  \"apiBase\": \"https://x.invalid\",\n  \"zFuture\": {\"a\": 1},\n  \"lockfilePath\": \"D:\\\\old\\\\lockfile\"\n}\n",
        )
        .unwrap();
        assert!(matches!(
            save_install_dir(config.path(), &lol.join("nope")),
            Err(SaveInstallError::Invalid(_))
        ));
        let saved = save_install_dir(config.path(), lol.parent().unwrap()).unwrap();
        assert_eq!(saved.dir, lol);
        let text = fs::read_to_string(config.path().join("config.json")).unwrap();
        let value: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(value["leagueInstallDir"], lol.to_string_lossy().as_ref());
        assert_eq!(value["zFuture"]["a"], 1);
        assert_eq!(value["apiBase"], "https://x.invalid");
        let keys: Vec<&String> = value.as_object().unwrap().keys().collect();
        assert_eq!(
            keys,
            ["apiBase", "zFuture", "lockfilePath", "leagueInstallDir"],
            "order kept, key appended"
        );
        assert!(text.ends_with("}\n"));
        assert_eq!(crate::config::read_league_install_dir(config.path()), Some(lol));
    }
}
