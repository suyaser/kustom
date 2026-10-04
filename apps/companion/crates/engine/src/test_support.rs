//! Helpers for the engine's own tests (unit and `tests/`). Not part of the engine's API.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use crate::api::transport::{BoxFuture, HttpRequest, HttpResponse, Transport};

static NEXT: AtomicU64 = AtomicU64::new(0);

/// A fresh directory under the system temp dir, deleted on drop.
pub struct TempDir(PathBuf);

impl TempDir {
    /// Creates `<tmp>/kustom-engine-<label>-<pid>-<n>`.
    pub fn new(label: &str) -> Self {
        let n = NEXT.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!("kustom-engine-{label}-{}-{n}", std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        if let Err(error) = std::fs::create_dir_all(&path) {
            panic!("temp dir {}: {error}", path.display());
        }
        TempDir(path)
    }

    /// The directory.
    pub fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

type Handler = Box<dyn Fn(&HttpRequest) -> Result<HttpResponse, String> + Send + Sync>;

/// A scripted [`Transport`]: answers each request with its handler and records it.
pub struct FakeTransport {
    handler: Handler,
    requests: Mutex<Vec<HttpRequest>>,
}

impl FakeTransport {
    /// A fake answering with `handler`.
    pub fn new(
        handler: impl Fn(&HttpRequest) -> Result<HttpResponse, String> + Send + Sync + 'static,
    ) -> Arc<Self> {
        Arc::new(FakeTransport {
            handler: Box::new(handler),
            requests: Mutex::new(Vec::new()),
        })
    }

    /// Every request so far.
    pub fn requests(&self) -> Vec<HttpRequest> {
        match self.requests.lock() {
            Ok(guard) => guard.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        }
    }
}

impl Transport for FakeTransport {
    fn send(&self, request: HttpRequest) -> BoxFuture<'_, Result<HttpResponse, String>> {
        let answer = (self.handler)(&request);
        match self.requests.lock() {
            Ok(mut guard) => guard.push(request),
            Err(poisoned) => poisoned.into_inner().push(request),
        }
        Box::pin(async move { answer })
    }
}

/// `Ok({ status, body })`.
pub fn respond(status: u16, body: &str) -> Result<HttpResponse, String> {
    Ok(HttpResponse {
        status,
        body: body.to_owned(),
    })
}

/// Copies a directory tree.
pub fn copy_tree(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}
