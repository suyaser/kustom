//! Exponential backoff with "equal jitter" (`backoff.ts`): the delay for attempt `n` is drawn uniformly from
//! `[base / 2, base]` where `base = min(max, min * factor^n)`, never below `min` nor above `max`.
//!
//! The API client uses it between attempts (1 s to 30 s); the connection machine (M17.7) loops on it
//! forever (1 s to 60 s). Nothing here sleeps: the caller sleeps on tokio's clock, which tests pause.

use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

/// A source of numbers in `[0, 1)`. Injected in tests.
pub type Random = Arc<dyn Fn() -> f64 + Send + Sync>;

/// A non-cryptographic `[0, 1)` source: `RandomState`'s per-process keys over a counter. Jitter only.
pub fn default_random() -> Random {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let state = RandomState::new();
    Arc::new(move || {
        let mut hasher = state.build_hasher();
        hasher.write_u64(COUNTER.fetch_add(1, Ordering::Relaxed));
        (hasher.finish() >> 11) as f64 / (1_u64 << 53) as f64
    })
}

/// Backoff settings.
#[derive(Clone)]
pub struct BackoffOptions {
    /// First delay.
    pub min: Duration,
    /// Ceiling.
    pub max: Duration,
    /// Growth per attempt.
    pub factor: f64,
    /// Jitter source.
    pub random: Random,
}

impl BackoffOptions {
    /// `min` to `max`, factor 2, real jitter.
    pub fn new(min: Duration, max: Duration) -> Self {
        BackoffOptions {
            min,
            max,
            factor: 2.0,
            random: default_random(),
        }
    }
}

/// 1 s to 60 s, factor 2: the connection machine's numbers (`backoff.ts`'s defaults).
impl Default for BackoffOptions {
    fn default() -> Self {
        BackoffOptions::new(Duration::from_secs(1), Duration::from_secs(60))
    }
}

impl std::fmt::Debug for BackoffOptions {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("BackoffOptions")
            .field("min", &self.min)
            .field("max", &self.max)
            .field("factor", &self.factor)
            .finish()
    }
}

/// One backoff sequence.
pub struct Backoff {
    options: BackoffOptions,
    attempt: u32,
}

impl Backoff {
    /// A fresh sequence.
    pub fn new(options: BackoffOptions) -> Self {
        Backoff { options, attempt: 0 }
    }

    /// Delays handed out since the last reset.
    pub fn attempts(&self) -> u32 {
        self.attempt
    }

    /// The next delay; advances the sequence.
    pub fn next_delay(&mut self) -> Duration {
        let min = self.options.min.as_secs_f64() * 1_000.0;
        let max = self.options.max.as_secs_f64() * 1_000.0;
        let base = (min * self.options.factor.powi(self.attempt.min(64) as i32)).min(max);
        self.attempt = self.attempt.saturating_add(1);
        let jittered = base / 2.0 + (self.options.random)().clamp(0.0, 1.0) * (base / 2.0);
        Duration::from_millis(jittered.max(min).min(max).round() as u64)
    }

    /// Back to the first delay.
    pub fn reset(&mut self) {
        self.attempt = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixed(value: f64) -> BackoffOptions {
        BackoffOptions {
            min: Duration::from_secs(1),
            max: Duration::from_secs(30),
            factor: 2.0,
            random: Arc::new(move || value),
        }
    }

    #[test]
    fn grows_with_equal_jitter_and_caps() {
        let mut top = Backoff::new(fixed(1.0));
        let delays: Vec<u64> = (0..7).map(|_| top.next_delay().as_millis() as u64).collect();
        assert_eq!(delays, [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
        let mut bottom = Backoff::new(fixed(0.0));
        let delays: Vec<u64> = (0..3).map(|_| bottom.next_delay().as_millis() as u64).collect();
        // base/2, but never below min.
        assert_eq!(delays, [1_000, 1_000, 2_000]);
        bottom.reset();
        assert_eq!(bottom.attempts(), 0);
    }

    #[test]
    fn the_default_random_stays_in_range() {
        let random = default_random();
        for _ in 0..1_000 {
            let x = random();
            assert!((0.0..1.0).contains(&x));
        }
    }
}
