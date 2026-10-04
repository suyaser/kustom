//! Signed auto-updates (M17.12 part 2).
//!
//! Two halves. [`check_once`] and [`run`] are the schedule: check shortly after start, then every
//! [`CHECK_EVERY`], download in the background, and hand a ready update to [`App::update_ready`] (which shows
//! the card and applies M17.1's restart rule). They know nothing about Tauri: they drive an
//! [`UpdateSource`], so tests use a fake. [`TauriUpdater`] is the real source and the real
//! [`Updater`]: `tauri-plugin-updater` reads `latest.json`, downloads the installer and verifies its
//! minisign signature against `plugins.updater.pubkey`; installing and relaunching happens only when the
//! app asks, and the app asks only when `may_restart` says so.
//!
//! A failed check (no network, no `latest.json`, a bad signature, anything) is one `warn` line and nothing
//! else: no card, no dialog, no state change; the next attempt is [`RETRY_AFTER_FAILURE`] later.

use std::fmt;
use std::sync::{Arc, Mutex, MutexGuard, Weak};
use std::time::Duration;

use tauri::{AppHandle, Runtime};
use tauri_plugin_updater::{Error as PluginError, Update, UpdaterBuilder, UpdaterExt as _};

use crate::app::{App, Updater};
use crate::host_api::{BoxFuture, Host};

/// The first check, after start. Boot and the League connection do not wait on the network.
pub const FIRST_CHECK_DELAY: Duration = Duration::from_secs(20);
/// Between checks while nothing is pending: a PC left on for a week hears about a release within 6 hours.
/// Modest on purpose (one tiny GET of `latest.json`), and the same cadence as the rank sync.
pub const CHECK_EVERY: Duration = Duration::from_secs(6 * 60 * 60);
/// After a failed check (the PC just woke and has no network yet, say): sooner than the normal cadence.
pub const RETRY_AFTER_FAILURE: Duration = Duration::from_secs(60 * 60);

/// The schedule, so a test can use short times.
#[derive(Debug, Clone, Copy)]
pub struct Schedule {
    /// Before the first check.
    pub first: Duration,
    /// After a check that found nothing, or while an update is pending.
    pub every: Duration,
    /// After a failed check.
    pub retry: Duration,
}

impl Default for Schedule {
    fn default() -> Self {
        Self {
            first: FIRST_CHECK_DELAY,
            every: CHECK_EVERY,
            retry: RETRY_AFTER_FAILURE,
        }
    }
}

/// What went wrong, for the log line only (nothing in the window depends on it).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FailureKind {
    /// No answer: offline, DNS, TLS, a refused connection, a failed download.
    Network,
    /// `latest.json` is not there (a 404) or has no entry for this platform.
    NotFound,
    /// The installer's signature does not verify against our public key (or the key or signature is not
    /// valid minisign at all, which is what the placeholder public key does).
    Signature,
    /// Anything else (a malformed manifest, a disk error).
    Other,
}

impl fmt::Display for FailureKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Network => "network",
            Self::NotFound => "not-found",
            Self::Signature => "signature",
            Self::Other => "other",
        })
    }
}

/// A failed check or install.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Failure {
    /// The class.
    pub kind: FailureKind,
    /// The plugin's own words.
    pub detail: String,
}

/// Maps the plugin's error to a [`Failure`].
pub fn classify(error: &PluginError) -> Failure {
    let kind = match error {
        PluginError::Reqwest(_) | PluginError::Network(_) => FailureKind::Network,
        PluginError::ReleaseNotFound | PluginError::TargetNotFound(_) | PluginError::TargetsNotFound(_) => {
            FailureKind::NotFound
        }
        PluginError::Minisign(_) | PluginError::Base64(_) | PluginError::SignatureUtf8(_) => {
            FailureKind::Signature
        }
        _ => FailureKind::Other,
    };
    Failure {
        kind,
        detail: error.to_string(),
    }
}

/// Where updates come from.
pub trait UpdateSource: Send + Sync + 'static {
    /// Checks for a newer version and, when there is one, downloads and verifies it. `Ok(Some(version))`
    /// means a verified installer is held and ready; `Ok(None)` means up to date.
    fn check_and_download(&self) -> BoxFuture<'_, Result<Option<String>, Failure>>;
}

/// One pass of the schedule: returns how long to wait before the next. A failure is one log line.
pub async fn check_once(app: &App, source: &dyn UpdateSource, schedule: &Schedule) -> Duration {
    if app.update_pending() {
        return schedule.every;
    }
    match source.check_and_download().await {
        Ok(Some(version)) => {
            tracing::info!(component = "update", %version, "update downloaded and verified");
            app.update_ready(version);
            schedule.every
        }
        Ok(None) => {
            tracing::debug!(component = "update", "up to date");
            schedule.every
        }
        Err(failure) => {
            tracing::warn!(
                component = "update",
                kind = %failure.kind,
                error = %failure.detail,
                "update check failed"
            );
            schedule.retry
        }
    }
}

/// Checks forever (spawn it once). Never returns and never panics on a bad answer.
pub async fn run(app: Arc<App>, source: Arc<dyn UpdateSource>, schedule: Schedule) {
    tokio::time::sleep(schedule.first).await;
    loop {
        let wait = check_once(&app, source.as_ref(), &schedule).await;
        tokio::time::sleep(wait).await;
    }
}

/// A verified installer waiting for the restart rule.
struct Pending {
    update: Update,
    bytes: Vec<u8>,
}

type Configure = Box<dyn Fn(UpdaterBuilder) -> UpdaterBuilder + Send + Sync>;

struct Inner<R: Runtime> {
    handle: AppHandle<R>,
    host: Arc<dyn Host>,
    app: Mutex<Weak<App>>,
    pending: Mutex<Option<Pending>>,
    /// Tests point the plugin at a local server and a throwaway key.
    configure: Option<Configure>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// The real updater: `tauri-plugin-updater` behind [`UpdateSource`] and [`Updater`].
pub struct TauriUpdater<R: Runtime> {
    inner: Arc<Inner<R>>,
}

impl<R: Runtime> TauriUpdater<R> {
    /// The updater for `handle` (the updater plugin must be installed on it).
    pub fn new(handle: AppHandle<R>, host: Arc<dyn Host>) -> Self {
        Self::build(handle, host, None)
    }

    /// As [`Self::new`], with the plugin's builder adjusted (tests only).
    pub fn with_configure(
        handle: AppHandle<R>,
        host: Arc<dyn Host>,
        configure: impl Fn(UpdaterBuilder) -> UpdaterBuilder + Send + Sync + 'static,
    ) -> Self {
        Self::build(handle, host, Some(Box::new(configure)))
    }

    fn build(handle: AppHandle<R>, host: Arc<dyn Host>, configure: Option<Configure>) -> Self {
        Self {
            inner: Arc::new(Inner {
                handle,
                host,
                app: Mutex::new(Weak::new()),
                pending: Mutex::new(None),
                configure,
            }),
        }
    }

    /// Tells the updater which app to report a failed install to (the app owns the updater, so this is
    /// weak).
    pub fn bind(&self, app: &Arc<App>) {
        *lock(&self.inner.app) = Arc::downgrade(app);
    }
}

impl<R: Runtime> Inner<R> {
    async fn check_and_download(&self) -> Result<Option<String>, Failure> {
        let mut builder = self.handle.updater_builder();
        if let Some(configure) = &self.configure {
            builder = configure(builder);
        }
        let updater = builder.build().map_err(|e| classify(&e))?;
        let Some(update) = updater.check().await.map_err(|e| classify(&e))? else {
            return Ok(None);
        };
        let version = update.version.clone();
        // Verified inside `download`: a bad signature is an error here and nothing is kept.
        let bytes = update
            .download(|_, _| {}, || {})
            .await
            .map_err(|e| classify(&e))?;
        *lock(&self.pending) = Some(Pending { update, bytes });
        Ok(Some(version))
    }

    async fn install_and_restart(&self) {
        let pending = lock(&self.pending).take();
        let Some(Pending { update, bytes }) = pending else {
            tracing::warn!(component = "update", "restart asked with nothing downloaded");
            self.failed();
            return;
        };
        tracing::info!(component = "update", version = %update.version, "installing the update");
        // On Windows `install` starts the NSIS installer (passive: a progress bar, no questions) and
        // exits this process itself; the installer relaunches Kustom. The restart rule guarantees nothing
        // is in flight, and anything queued is on disk. Elsewhere (the dev Mac) it returns and we relaunch.
        if let Err(error) = update.install(&bytes) {
            let failure = classify(&error);
            tracing::warn!(
                component = "update",
                kind = %failure.kind,
                error = %failure.detail,
                "update install failed"
            );
            self.failed();
            return;
        }
        self.host.stop().await;
        self.handle.restart();
    }

    fn failed(&self) {
        if let Some(app) = lock(&self.app).upgrade() {
            app.update_failed();
        }
    }
}

impl<R: Runtime> UpdateSource for TauriUpdater<R> {
    fn check_and_download(&self) -> BoxFuture<'_, Result<Option<String>, Failure>> {
        Box::pin(self.inner.check_and_download())
    }
}

impl<R: Runtime> Updater for TauriUpdater<R> {
    fn restart_to_update(&self) {
        let inner = self.inner.clone();
        tauri::async_runtime::spawn(async move { inner.install_and_restart().await });
    }
}
