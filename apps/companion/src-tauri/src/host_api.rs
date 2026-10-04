//! The seam between the window and the engine's host (`engine::host`, M17.9's follow-up). The window only
//! drives a [`Host`]; production is [`engine::host::HostHandle`] behind the thin adapter below, and tests
//! can drive a fake. `HostStatus`, `HostBoot` and `HostGroup` are the engine's own.
//!
//! Pairing does not go through here: it is a direct `ApiClient` call (`link.rs`); only its result (a new
//! token on disk) is handed over with [`Host::adopt_linked_group`].

use std::future::Future;
use std::pin::Pin;

use engine::host::HostHandle;
pub use engine::host::{HostBoot, HostGroup, HostStatus};
use engine::lcu::LcuDiscovery;
use tokio::sync::watch;

/// A boxed future (the trait is object-safe).
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// The host, as the window drives it.
pub trait Host: Send + Sync + 'static {
    /// The status, live.
    fn status(&self) -> watch::Receiver<HostStatus>;
    /// Switches the watchers to `group_id`, guarded (held while a game is in progress or a block is
    /// unposted; choosing the current group again cancels a held switch).
    fn switch_group(&self, group_id: String) -> BoxFuture<'_, ()>;
    /// One discovery pass now (Try again).
    fn retry_discovery(&self) -> BoxFuture<'_, LcuDiscovery>;
    /// Runs boot again (the old engine's Retry).
    fn retry_boot(&self) -> BoxFuture<'_, ()>;
    /// A pairing saved a token for `group_id`: re-read the groups and make it the current group.
    fn adopt_linked_group(&self, group_id: String) -> BoxFuture<'_, ()>;
    /// Stops everything and waits (Quit, an update restart).
    fn stop(&self) -> BoxFuture<'_, ()>;
}

impl Host for HostHandle {
    fn status(&self) -> watch::Receiver<HostStatus> {
        HostHandle::status(self)
    }

    fn switch_group(&self, group_id: String) -> BoxFuture<'_, ()> {
        Box::pin(async move {
            let outcome = HostHandle::switch_group(self, &group_id).await;
            tracing::debug!(component = "app", ?outcome, "group switch");
        })
    }

    fn retry_discovery(&self) -> BoxFuture<'_, LcuDiscovery> {
        Box::pin(HostHandle::retry_discovery(self))
    }

    fn retry_boot(&self) -> BoxFuture<'_, ()> {
        Box::pin(HostHandle::retry_boot(self))
    }

    fn adopt_linked_group(&self, group_id: String) -> BoxFuture<'_, ()> {
        Box::pin(async move { HostHandle::adopt_linked_group(self, &group_id).await })
    }

    fn stop(&self) -> BoxFuture<'_, ()> {
        Box::pin(HostHandle::stop(self))
    }
}
