//! "Can't find League" and the League folder row (05-design §9.5.6, decision row 2026-10-04): what a
//! folder pick or a Try again turns into. The picker itself is the dialog plugin's (`lib.rs`); everything
//! after it is here and tested.

use std::path::{Path, PathBuf};

use engine::config::read_league_install_dir;
use engine::lcu::install::{SaveInstallError, ValidInstall, validate_install_dir};
use engine::lcu::{LcuDiscovery, save_install_dir};

use crate::model::FolderAnswer;

/// Where the picker opens: `C:\Riot Games` if it exists, else `C:\` (Windows). On the development Mac,
/// `/Applications`.
pub fn picker_start(exists: impl Fn(&Path) -> bool) -> PathBuf {
    if cfg!(windows) {
        let riot = PathBuf::from(r"C:\Riot Games");
        if exists(&riot) {
            riot
        } else {
            PathBuf::from(r"C:\")
        }
    } else {
        PathBuf::from("/Applications")
    }
}

/// What a pick turns into. `None` is a cancelled picker: nothing changes, no message.
pub fn pick_answer(
    picked: Option<PathBuf>,
    save: impl FnOnce(&Path) -> Result<ValidInstall, SaveInstallError>,
) -> Option<FolderAnswer> {
    let picked = picked?;
    Some(match save(&picked) {
        Ok(valid) => {
            tracing::info!(component = "folder", corrected = ?valid.corrected, "League folder saved");
            FolderAnswer::Found(valid.dir)
        }
        Err(SaveInstallError::Invalid(why)) => {
            tracing::info!(component = "folder", reason = ?why, "the picked folder is not League");
            FolderAnswer::Miss
        }
        Err(SaveInstallError::Config(error)) => {
            tracing::warn!(component = "folder", error = %error, "the League folder could not be saved");
            FolderAnswer::SaveFailed
        }
    })
}

/// A pick, saved for real into `<config_dir>/config.json`.
pub fn apply_pick(config_dir: &Path, picked: Option<PathBuf>) -> Option<FolderAnswer> {
    pick_answer(picked, |path| save_install_dir(config_dir, path))
}

/// What Try again turns into: `None` when it found the client (the plain League row, no line), else
/// `Still can't find League.`
pub fn try_again_answer(found: &LcuDiscovery) -> Option<FolderAnswer> {
    match found {
        LcuDiscovery::Found { .. } => None,
        LcuDiscovery::NotFound { .. } => Some(FolderAnswer::StillNotFound),
    }
}

/// The folder the engine uses when League is not running (the row's value, and whether "Can't find
/// League" shows): the folder the running client last reported, else the saved `leagueInstallDir`, else
/// the folder of the saved 0.3.x `lockfilePath`, else the platform default, each only if it still holds
/// League.
pub fn folder_in_use(config_dir: &Path, reported: Option<&Path>, defaults: &[PathBuf]) -> Option<PathBuf> {
    let valid = |dir: &Path| validate_install_dir(dir).ok().map(|v| v.dir);
    if let Some(dir) = reported.and_then(valid) {
        return Some(dir);
    }
    if let Some(dir) = read_league_install_dir(config_dir).as_deref().and_then(valid) {
        return Some(dir);
    }
    if let Some(dir) = engine::config::read_lockfile_path(config_dir)
        .as_deref()
        .and_then(Path::parent)
        .and_then(valid)
    {
        return Some(dir);
    }
    defaults
        .iter()
        .filter_map(|lockfile| lockfile.parent())
        .find_map(valid)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn install(root: &Path) -> PathBuf {
        let lol = root.join("Riot Games").join("League of Legends");
        fs::create_dir_all(lol.join("Game")).unwrap();
        fs::write(lol.join("LeagueClient.exe"), b"").unwrap();
        lol
    }

    #[test]
    fn a_cancelled_picker_changes_nothing() {
        let config = tempfile::tempdir().unwrap();
        assert_eq!(apply_pick(config.path(), None), None);
        assert!(!config.path().join("config.json").exists());
    }

    #[test]
    fn a_good_pick_is_saved_and_near_misses_are_corrected() {
        let root = tempfile::tempdir().unwrap();
        let lol = install(root.path());
        let config = tempfile::tempdir().unwrap();
        // The Riot Games folder is a success, not a miss.
        let answer = apply_pick(config.path(), Some(root.path().join("Riot Games")));
        assert_eq!(answer, Some(FolderAnswer::Found(lol.clone())));
        assert_eq!(read_league_install_dir(config.path()), Some(lol.clone()));
        // So is the Game subfolder.
        assert_eq!(
            apply_pick(config.path(), Some(lol.join("Game"))),
            Some(FolderAnswer::Found(lol))
        );
    }

    #[test]
    fn a_real_miss_saves_nothing() {
        let root = tempfile::tempdir().unwrap();
        let config = tempfile::tempdir().unwrap();
        fs::create_dir_all(root.path().join("Photos")).unwrap();
        assert_eq!(
            apply_pick(config.path(), Some(root.path().join("Photos"))),
            Some(FolderAnswer::Miss)
        );
        assert_eq!(read_league_install_dir(config.path()), None);
        assert_eq!(
            apply_pick(config.path(), Some(root.path().join("nope"))),
            Some(FolderAnswer::Miss),
            "a folder that is gone is a miss too"
        );
    }

    #[test]
    fn a_config_that_cannot_be_written_is_its_own_answer() {
        let root = tempfile::tempdir().unwrap();
        let lol = install(root.path());
        let answer = pick_answer(Some(lol), |_| {
            Err(SaveInstallError::Config(
                engine::config::ConfigWriteError::Invalid("x"),
            ))
        });
        assert_eq!(answer, Some(FolderAnswer::SaveFailed));
    }

    #[test]
    fn try_again() {
        let not_found = LcuDiscovery::NotFound { searched: vec![] };
        assert_eq!(try_again_answer(&not_found), Some(FolderAnswer::StillNotFound));
        let found = LcuDiscovery::Found {
            credentials: engine::lcu::Credentials {
                name: "LeagueClient".into(),
                pid: 1,
                port: 2,
                password: "pw".into(),
            },
            step: engine::lcu::DiscoveryStep::RunningClient,
            source: engine::lcu::CredentialSource::CommandLine,
            install_dir: None,
        };
        assert_eq!(try_again_answer(&found), None, "found: the plain row, no line");
    }

    #[test]
    fn the_folder_in_use_order() {
        let root = tempfile::tempdir().unwrap();
        let lol = install(root.path());
        let other = install(&root.path().join("D"));
        let config = tempfile::tempdir().unwrap();
        assert_eq!(folder_in_use(config.path(), None, &[]), None, "nothing known");
        let default_lockfile = lol.join("lockfile");
        assert_eq!(
            folder_in_use(config.path(), None, std::slice::from_ref(&default_lockfile)),
            Some(lol.clone()),
            "the default, when it holds League"
        );
        assert_eq!(
            folder_in_use(
                config.path(),
                None,
                &[root.path().join("missing").join("lockfile")]
            ),
            None,
            "a default that is not there"
        );
        save_install_dir(config.path(), &other).unwrap();
        assert_eq!(
            folder_in_use(config.path(), None, std::slice::from_ref(&default_lockfile)),
            Some(other.clone()),
            "saved beats default"
        );
        assert_eq!(
            folder_in_use(config.path(), Some(&lol), &[]),
            Some(lol),
            "the running client's report beats saved"
        );
    }

    #[test]
    fn the_picker_starts_somewhere_sensible() {
        let start = picker_start(|_| false);
        if cfg!(windows) {
            assert_eq!(start, PathBuf::from(r"C:\"));
            assert_eq!(picker_start(|_| true), PathBuf::from(r"C:\Riot Games"));
        } else {
            assert_eq!(start, PathBuf::from("/Applications"));
        }
    }
}
