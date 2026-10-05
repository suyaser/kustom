//! Test kit for the watchers: a recording lobby poster with a script, a manual scheduler whose timers the
//! test fires, a log capture for "the log never carries X" assertions, and small polling helpers.

#![allow(dead_code, clippy::unwrap_used, clippy::expect_used, missing_docs)]

use std::io::Write;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use engine::api::wire::{LobbyLeavePayload, LobbyPayload};
use engine::watchers::lobby::{Cancel, LobbyAnswer, LobbyPoster, PostOutcome, Scheduler};

/// Records every body; answers from a script where the last entry repeats (like the TS fake API).
pub struct ScriptedPoster {
    pub bodies: Mutex<Vec<LobbyPayload>>,
    leaves: Mutex<Vec<String>>,
    script: Mutex<(Vec<(PostOutcome, Duration)>, usize)>,
}

pub fn ok_answer() -> PostOutcome {
    PostOutcome::Ok(LobbyAnswer {
        status: "open".into(),
        created: true,
        member_count: 1,
        ..Default::default()
    })
}

impl ScriptedPoster {
    pub fn new(script: Vec<(PostOutcome, Duration)>) -> Arc<Self> {
        Arc::new(Self {
            bodies: Mutex::new(Vec::new()),
            leaves: Mutex::new(Vec::new()),
            script: Mutex::new((script, 0)),
        })
    }

    pub fn ok() -> Arc<Self> {
        Self::new(vec![(ok_answer(), Duration::ZERO)])
    }

    pub fn posted(&self) -> Vec<LobbyPayload> {
        self.bodies.lock().unwrap().clone()
    }

    pub fn posted_json(&self) -> Vec<serde_json::Value> {
        self.posted()
            .iter()
            .map(|b| serde_json::to_value(b).unwrap())
            .collect()
    }
}

impl LobbyPoster for ScriptedPoster {
    async fn post_lobby(&self, body: &LobbyPayload) -> PostOutcome {
        self.bodies.lock().unwrap().push(body.clone());
        let (outcome, delay) = {
            let mut guard = self.script.lock().unwrap();
            let (script, cursor) = &mut *guard;
            let entry = script[(*cursor).min(script.len() - 1)].clone();
            *cursor += 1;
            entry
        };
        if !delay.is_zero() {
            tokio::time::sleep(delay).await;
        }
        outcome
    }

    async fn post_leave(&self, body: &LobbyLeavePayload) -> Result<bool, String> {
        self.leaves.lock().unwrap().push(body.party_id.clone());
        Ok(true)
    }
}

impl ScriptedPoster {
    /// The `partyId` of every leave posted, in order.
    pub fn left(&self) -> Vec<String> {
        self.leaves.lock().unwrap().clone()
    }
}

pub struct Scheduled {
    pub delay: Duration,
    pub cancelled: Arc<std::sync::atomic::AtomicBool>,
    fire: Mutex<Option<Box<dyn FnOnce() + Send>>>,
}

impl Scheduled {
    pub fn fire(&self) {
        if self.cancelled.load(std::sync::atomic::Ordering::SeqCst) {
            return;
        }
        if let Some(fire) = self.fire.lock().unwrap().take() {
            fire();
        }
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(std::sync::atomic::Ordering::SeqCst)
    }
}

/// Timers that only fire when the test says so.
#[derive(Default)]
pub struct ManualScheduler {
    pub entries: Mutex<Vec<Arc<Scheduled>>>,
}

impl ManualScheduler {
    pub fn get(&self, index: usize) -> Arc<Scheduled> {
        self.entries.lock().unwrap()[index].clone()
    }

    pub fn len(&self) -> usize {
        self.entries.lock().unwrap().len()
    }
}

impl Scheduler for ManualScheduler {
    fn schedule(&self, delay: Duration, fire: Box<dyn FnOnce() + Send>) -> Cancel {
        let entry = Arc::new(Scheduled {
            delay,
            cancelled: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            fire: Mutex::new(Some(fire)),
        });
        self.entries.lock().unwrap().push(entry.clone());
        let cancelled = entry.cancelled.clone();
        Box::new(move || cancelled.store(true, std::sync::atomic::Ordering::SeqCst))
    }
}

/// Everything the engine logged while the guard lives (current-thread runtime only).
#[derive(Clone, Default)]
pub struct LogCapture(Arc<Mutex<Vec<u8>>>);

impl LogCapture {
    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.0.lock().unwrap()).into_owned()
    }

    pub fn count(&self, needle: &str) -> usize {
        self.text().matches(needle).count()
    }
}

impl Write for LogCapture {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

pub fn capture_logs() -> (LogCapture, tracing::subscriber::DefaultGuard) {
    let capture = LogCapture::default();
    let writer = capture.clone();
    let subscriber = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::DEBUG)
        .with_ansi(false)
        .with_writer(move || writer.clone())
        .finish();
    let guard = tracing::subscriber::set_default(subscriber);
    (capture, guard)
}

pub async fn until(mut check: impl FnMut() -> bool, what: &str) {
    for _ in 0..1000 {
        if check() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    panic!("timed out waiting for: {what}");
}

pub async fn pause(ms: u64) {
    tokio::time::sleep(Duration::from_millis(ms)).await;
}

/// Records every game body (in_progress and queued, in order) and answers from a script per call; the last
/// entry repeats. `hold()` makes every post wait (a process killed mid-post never sees an answer).
pub struct ScriptedGamePoster {
    pub bodies: Mutex<Vec<serde_json::Value>>,
    script: Mutex<(Vec<engine::watchers::game::GamePostOutcome>, usize)>,
    gate: Mutex<Option<Arc<tokio::sync::Notify>>>,
}

pub fn game_ok(created: bool) -> engine::watchers::game::GamePostOutcome {
    engine::watchers::game::GamePostOutcome::Ok {
        created,
        participants: 6,
        lobby_id: None,
    }
}

pub fn game_http(status: u16) -> engine::watchers::game::GamePostOutcome {
    engine::watchers::game::GamePostOutcome::Http {
        status,
        error: format!("HTTP {status}"),
    }
}

impl ScriptedGamePoster {
    pub fn new(script: Vec<engine::watchers::game::GamePostOutcome>) -> Arc<Self> {
        Arc::new(Self {
            bodies: Mutex::new(Vec::new()),
            script: Mutex::new((script, 0)),
            gate: Mutex::new(None),
        })
    }

    pub fn hold(&self) -> Arc<tokio::sync::Notify> {
        let notify = Arc::new(tokio::sync::Notify::new());
        *self.gate.lock().unwrap() = Some(notify.clone());
        notify
    }

    pub fn posted(&self) -> Vec<serde_json::Value> {
        self.bodies.lock().unwrap().clone()
    }

    async fn answer(&self, body: serde_json::Value) -> engine::watchers::game::GamePostOutcome {
        self.bodies.lock().unwrap().push(body);
        let gate = self.gate.lock().unwrap().clone();
        if let Some(gate) = gate {
            gate.notified().await;
        }
        let mut guard = self.script.lock().unwrap();
        let (script, cursor) = &mut *guard;
        let outcome = script[(*cursor).min(script.len() - 1)].clone();
        *cursor += 1;
        outcome
    }
}

impl engine::watchers::game::GamePoster for ScriptedGamePoster {
    async fn post_in_progress(
        &self,
        body: &engine::api::wire::GamePayload,
    ) -> engine::watchers::game::GamePostOutcome {
        self.answer(serde_json::to_value(body).unwrap()).await
    }

    async fn post_queued(&self, body: &serde_json::Value) -> engine::watchers::game::GamePostOutcome {
        self.answer(body.clone()).await
    }
}
