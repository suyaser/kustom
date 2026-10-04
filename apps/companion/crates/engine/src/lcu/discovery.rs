//! Where the League client is, in this order (M17.5, the user's scope addition on top of parity row 9):
//!
//! 1. **The running client** ([`DiscoveryStep::RunningClient`]): the process list's `LeagueClientUx`, read
//!    as the lockfile beside its executable (Windows), then the lockfile in its `--install-directory`, then
//!    its own `--app-port`/`--remoting-auth-token`. Finds a custom install with zero setup whenever League
//!    is open. At most one process listing per 15 s ([`PROCESS_LIST_MIN_INTERVAL`]); the last answer is
//!    reused in between.
//! 2. **The saved folder** ([`DiscoveryStep::SavedInstallDir`]): `leagueInstallDir` from `config.json`,
//!    then the 0.2.x/0.3.x `lockfilePath` ([`DiscoveryStep::SavedLockfilePath`]).
//! 3. **The default locations** ([`DiscoveryStep::DefaultLocation`]): `C:\Riot Games\League of Legends`
//!    on Windows, `/Applications/League of Legends.app/Contents/LoL` on macOS.
//! 4. **Not found**: [`LcuDiscovery::NotFound`] with every path searched, so the window can say "Can't find
//!    League" with a Browse button (M17.8).
//!
//! Differs from the TypeScript order (configured path, defaults, process list last) on purpose: the user
//! asked for the running client first so nobody edits `config.json` by hand. A present-but-malformed
//! lockfile (half-written, stale) is skipped, never fatal. Nothing here panics or logs a password.

use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use super::lockfile::{Credentials, LOCKFILE_NAME, parse_lockfile};
use super::process::{
    LeagueProcess, ProcessList, ProcessLister, lockfile_path_from_executable, parse_ux_command_line,
};

/// Default lockfile on Windows (the shipped build).
pub const WINDOWS_LOCKFILE_PATH: &str = r"C:\Riot Games\League of Legends\lockfile";
/// Default lockfile on macOS (development on this Mac).
pub const MACOS_LOCKFILE_PATH: &str = "/Applications/League of Legends.app/Contents/LoL/lockfile";
/// The least time between two process listings.
pub const PROCESS_LIST_MIN_INTERVAL: Duration = Duration::from_secs(15);

/// Which step found the client.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiscoveryStep {
    /// Step 1: the running client process.
    RunningClient,
    /// Step 2: `leagueInstallDir` from config.
    SavedInstallDir,
    /// Step 2: the 0.2.x/0.3.x `lockfilePath` from config.
    SavedLockfilePath,
    /// Step 3: the platform default.
    DefaultLocation,
}

impl DiscoveryStep {
    /// A short label for logs and the probe.
    pub fn label(self) -> &'static str {
        match self {
            DiscoveryStep::RunningClient => "running client (process list)",
            DiscoveryStep::SavedInstallDir => "saved install folder (leagueInstallDir)",
            DiscoveryStep::SavedLockfilePath => "saved lockfile path (lockfilePath)",
            DiscoveryStep::DefaultLocation => "default install location",
        }
    }
}

/// Where the credentials were read from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CredentialSource {
    /// A lockfile at this path.
    Lockfile(PathBuf),
    /// The client UI's command line (no lockfile could be read).
    CommandLine,
}

/// The outcome.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LcuDiscovery {
    /// The client is running and reachable with these credentials.
    Found {
        /// Port, pid and password.
        credentials: Credentials,
        /// Which step found it.
        step: DiscoveryStep,
        /// The lockfile path, or the command line.
        source: CredentialSource,
        /// The install folder, when known (worth offering to save when step 1 found a custom install).
        install_dir: Option<PathBuf>,
    },
    /// Not found anywhere.
    NotFound {
        /// Every lockfile path that was tried, in order.
        searched: Vec<PathBuf>,
    },
}

/// What discovery reads besides the process list. Taken fresh from config on every call.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DiscoveryInputs {
    /// `leagueInstallDir`.
    pub saved_install_dir: Option<PathBuf>,
    /// `lockfilePath`.
    pub saved_lockfile_path: Option<PathBuf>,
    /// The platform defaults ([`default_lockfile_candidates`] in production).
    pub defaults: Vec<PathBuf>,
}

/// The platform's default lockfile paths.
pub fn default_lockfile_candidates() -> Vec<PathBuf> {
    if cfg!(windows) {
        vec![PathBuf::from(WINDOWS_LOCKFILE_PATH)]
    } else if cfg!(target_os = "macos") {
        vec![PathBuf::from(MACOS_LOCKFILE_PATH)]
    } else {
        Vec::new()
    }
}

/// Reads a lockfile. `std::fs` in production; a map in tests.
pub trait LockfileReader {
    /// The file's text.
    fn read(&self, path: &Path) -> io::Result<String>;
}

/// The real filesystem.
#[derive(Debug, Clone, Copy, Default)]
pub struct FsReader;

impl LockfileReader for FsReader {
    fn read(&self, path: &Path) -> io::Result<String> {
        std::fs::read_to_string(path)
    }
}

fn read_credentials(reader: &impl LockfileReader, path: &Path) -> Option<Credentials> {
    match reader.read(path) {
        Ok(text) => match parse_lockfile(&text) {
            Ok(credentials) => Some(credentials),
            Err(reason) => {
                tracing::debug!(path = %path.display(), %reason, "lockfile present but malformed; skipped");
                None
            }
        },
        Err(_) => None,
    }
}

/// Step 1 on one listing: for each client process, the lockfile beside a Windows executable, then the lockfile
/// in `--install-directory`, then the command line itself. Pure apart from `reader`.
pub fn from_processes(
    processes: &[LeagueProcess],
    reader: &impl LockfileReader,
    searched: &mut Vec<PathBuf>,
) -> Option<LcuDiscovery> {
    for process in processes {
        let args = process.command_line.as_deref().and_then(parse_ux_command_line);
        let install_dir = args.as_ref().and_then(|a| a.install_directory.clone());
        let mut lockfiles = Vec::new();
        if let Some(exe) = process
            .executable_path
            .as_deref()
            .filter(|e| e.to_ascii_lowercase().ends_with(".exe"))
        {
            lockfiles.extend(lockfile_path_from_executable(exe));
        }
        if let Some(dir) = &install_dir {
            lockfiles.push(dir.join(LOCKFILE_NAME));
        }
        for path in lockfiles {
            if let Some(credentials) = read_credentials(reader, &path) {
                let install_dir = install_dir
                    .clone()
                    .or_else(|| path.parent().map(Path::to_path_buf));
                return Some(LcuDiscovery::Found {
                    credentials,
                    step: DiscoveryStep::RunningClient,
                    source: CredentialSource::Lockfile(path),
                    install_dir,
                });
            }
            searched.push(path);
        }
        if let Some(credentials) = args.as_ref().and_then(|a| a.credentials(process.pid)) {
            return Some(LcuDiscovery::Found {
                credentials,
                step: DiscoveryStep::RunningClient,
                source: CredentialSource::CommandLine,
                install_dir,
            });
        }
    }
    None
}

/// Steps 2 to 4, given what step 1 already searched.
pub fn from_paths(
    inputs: &DiscoveryInputs,
    reader: &impl LockfileReader,
    mut searched: Vec<PathBuf>,
) -> LcuDiscovery {
    let mut candidates: Vec<(DiscoveryStep, PathBuf)> = Vec::new();
    if let Some(dir) = &inputs.saved_install_dir {
        candidates.push((DiscoveryStep::SavedInstallDir, dir.join(LOCKFILE_NAME)));
    }
    if let Some(path) = &inputs.saved_lockfile_path {
        candidates.push((DiscoveryStep::SavedLockfilePath, path.clone()));
    }
    candidates.extend(
        inputs
            .defaults
            .iter()
            .map(|p| (DiscoveryStep::DefaultLocation, p.clone())),
    );
    for (step, path) in candidates {
        if searched.contains(&path) {
            continue;
        }
        if let Some(credentials) = read_credentials(reader, &path) {
            let install_dir = path.parent().map(Path::to_path_buf);
            return LcuDiscovery::Found {
                credentials,
                step,
                source: CredentialSource::Lockfile(path),
                install_dir,
            };
        }
        searched.push(path);
    }
    LcuDiscovery::NotFound { searched }
}

/// A discovery for a long-running caller: remembers the last process listing and lists at most once per
/// `min_interval`. `now` is injected so tests run without waiting.
pub struct Discovery<L, R> {
    lister: L,
    reader: R,
    min_interval: Duration,
    last: Option<(Instant, Vec<LeagueProcess>)>,
    warned_unavailable: bool,
}

impl<L: ProcessLister, R: LockfileReader> Discovery<L, R> {
    /// A discovery with the default 15 s listing interval.
    pub fn new(lister: L, reader: R) -> Self {
        Self::with_interval(lister, reader, PROCESS_LIST_MIN_INTERVAL)
    }

    /// A discovery with its own listing interval.
    pub fn with_interval(lister: L, reader: R, min_interval: Duration) -> Self {
        Self {
            lister,
            reader,
            min_interval,
            last: None,
            warned_unavailable: false,
        }
    }

    /// One discovery pass at `now`.
    pub async fn discover_at(&mut self, inputs: &DiscoveryInputs, now: Instant) -> LcuDiscovery {
        let fresh = self
            .last
            .as_ref()
            .is_some_and(|(at, _)| now.saturating_duration_since(*at) < self.min_interval);
        if !fresh {
            let processes = match self.lister.list().await {
                ProcessList::Listed(processes) => {
                    self.warned_unavailable = false;
                    processes
                }
                ProcessList::Unavailable(reason) => {
                    if !self.warned_unavailable {
                        self.warned_unavailable = true;
                        tracing::warn!(%reason, "process list unavailable; checking the lockfile paths only");
                    }
                    Vec::new()
                }
            };
            self.last = Some((now, processes));
        }
        let mut searched = Vec::new();
        if let Some((_, processes)) = &self.last {
            if let Some(found) = from_processes(processes, &self.reader, &mut searched) {
                return found;
            }
        }
        from_paths(inputs, &self.reader, searched)
    }

    /// Forgets the last process listing: the next pass lists again whatever the interval says.
    pub fn forget_listing(&mut self) {
        self.last = None;
    }

    /// One discovery pass now.
    pub async fn discover(&mut self, inputs: &DiscoveryInputs) -> LcuDiscovery {
        self.discover_at(inputs, Instant::now()).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[derive(Default)]
    struct Files(Mutex<HashMap<PathBuf, String>>);

    impl Files {
        fn with(entries: &[(&str, &str)]) -> Self {
            Files(Mutex::new(
                entries
                    .iter()
                    .map(|(p, t)| (PathBuf::from(p), (*t).to_string()))
                    .collect(),
            ))
        }
    }

    impl LockfileReader for Files {
        fn read(&self, path: &Path) -> io::Result<String> {
            self.0
                .lock()
                .unwrap()
                .get(path)
                .cloned()
                .ok_or_else(|| io::Error::from(io::ErrorKind::NotFound))
        }
    }

    struct Lister(Vec<LeagueProcess>, AtomicUsize);

    impl ProcessLister for Lister {
        async fn list(&self) -> ProcessList {
            self.1.fetch_add(1, Ordering::SeqCst);
            ProcessList::Listed(self.0.clone())
        }
    }

    fn ux(exe: Option<&str>, cmd: &str) -> LeagueProcess {
        LeagueProcess {
            pid: Some(4321),
            executable_path: exe.map(String::from),
            command_line: Some(cmd.to_string()),
        }
    }

    const CMD: &str = r#""--remoting-auth-token=tok" "--app-port=61234" "--install-directory=E:\Custom\LoL" "--app-pid=1234""#;

    fn found_step(d: &LcuDiscovery) -> Option<(DiscoveryStep, CredentialSource, u16)> {
        match d {
            LcuDiscovery::Found {
                step,
                source,
                credentials,
                ..
            } => Some((*step, source.clone(), credentials.port)),
            LcuDiscovery::NotFound { .. } => None,
        }
    }

    #[tokio::test]
    async fn step_1_lockfile_beside_the_executable() {
        let files = Files::with(&[(r"E:\Custom\LoL\lockfile", "LeagueClient:1234:61234:pw:https")]);
        let mut d = Discovery::new(
            Lister(vec![ux(Some(r"E:\Custom\LoL\LeagueClientUx.exe"), CMD)], 0.into()),
            files,
        );
        let r = d.discover(&DiscoveryInputs::default()).await;
        assert_eq!(
            found_step(&r),
            Some((
                DiscoveryStep::RunningClient,
                CredentialSource::Lockfile(PathBuf::from(r"E:\Custom\LoL\lockfile")),
                61234
            ))
        );
        let LcuDiscovery::Found { install_dir, .. } = r else {
            panic!()
        };
        assert_eq!(install_dir, Some(PathBuf::from(r"E:\Custom\LoL")));
    }

    #[tokio::test]
    async fn step_1_install_directory_then_command_line() {
        // macOS-style: no .exe path; the lockfile is found through --install-directory.
        // Joined the host's way, as discovery joins it.
        let key = PathBuf::from(r"E:\Custom\LoL").join("lockfile");
        let files = Files(Mutex::new(HashMap::from([(
            key,
            "LeagueClient:1234:61234:pw:https".to_string(),
        )])));
        let mut d = Discovery::new(Lister(vec![ux(Some("/x/LeagueClientUx"), CMD)], 0.into()), files);
        let r = d.discover(&DiscoveryInputs::default()).await;
        assert!(matches!(
            found_step(&r),
            Some((DiscoveryStep::RunningClient, CredentialSource::Lockfile(_), _))
        ));
        // No lockfile readable at all: the command line's own port and token.
        let mut d = Discovery::new(Lister(vec![ux(None, CMD)], 0.into()), Files::default());
        let r = d.discover(&DiscoveryInputs::default()).await;
        assert_eq!(
            found_step(&r),
            Some((DiscoveryStep::RunningClient, CredentialSource::CommandLine, 61234))
        );
        let LcuDiscovery::Found { credentials, .. } = r else {
            panic!()
        };
        assert_eq!((credentials.pid, credentials.password.as_str()), (1234, "tok"));
    }

    #[tokio::test]
    async fn step_2_then_3_then_not_found() {
        let inputs = DiscoveryInputs {
            saved_install_dir: Some(PathBuf::from("/saved")),
            saved_lockfile_path: Some(PathBuf::from("/legacy/lockfile")),
            defaults: vec![PathBuf::from("/default/lockfile")],
        };
        let lockfile = "LeagueClient:9:7000:pw:https";
        for (present, step) in [
            ("/saved/lockfile", DiscoveryStep::SavedInstallDir),
            ("/legacy/lockfile", DiscoveryStep::SavedLockfilePath),
            ("/default/lockfile", DiscoveryStep::DefaultLocation),
        ] {
            let mut d = Discovery::new(Lister(vec![], 0.into()), Files::with(&[(present, lockfile)]));
            let r = d.discover(&inputs).await;
            assert_eq!(found_step(&r).map(|f| f.0), Some(step), "{present}");
        }
        let mut d = Discovery::new(
            Lister(vec![], 0.into()),
            Files::with(&[("/default/lockfile", "garbage")]),
        );
        assert_eq!(
            d.discover(&inputs).await,
            LcuDiscovery::NotFound {
                searched: vec![
                    "/saved/lockfile".into(),
                    "/legacy/lockfile".into(),
                    "/default/lockfile".into()
                ]
            }
        );
    }

    #[tokio::test]
    async fn the_running_client_wins_over_a_stale_saved_folder() {
        let files = Files::with(&[
            ("/saved/lockfile", "LeagueClient:1:1111:old:https"),
            (r"E:\Custom\LoL\lockfile", "LeagueClient:1234:61234:pw:https"),
        ]);
        let inputs = DiscoveryInputs {
            saved_install_dir: Some("/saved".into()),
            ..Default::default()
        };
        let mut d = Discovery::new(
            Lister(vec![ux(Some(r"E:\Custom\LoL\LeagueClientUx.exe"), CMD)], 0.into()),
            files,
        );
        assert_eq!(found_step(&d.discover(&inputs).await).map(|f| f.2), Some(61234));
    }

    #[tokio::test]
    async fn lists_processes_at_most_once_per_interval() {
        let lister = Lister(vec![], 0.into());
        let mut d = Discovery::new(lister, Files::default());
        let t0 = Instant::now();
        let inputs = DiscoveryInputs::default();
        d.discover_at(&inputs, t0).await;
        d.discover_at(&inputs, t0 + Duration::from_secs(5)).await;
        d.discover_at(&inputs, t0 + Duration::from_secs(14)).await;
        assert_eq!(d.lister.1.load(Ordering::SeqCst), 1);
        d.discover_at(&inputs, t0 + Duration::from_secs(15)).await;
        assert_eq!(d.lister.1.load(Ordering::SeqCst), 2);
    }
}
