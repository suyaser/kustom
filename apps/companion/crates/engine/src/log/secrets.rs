//! The process-wide set of strings that must never reach a log line (`log.ts` `addSecret`).
//!
//! Process-wide on purpose: a token enters the process in exactly two places (the config file and a
//! pairing answer), and both build a [`crate::config::CompanionToken`], whose constructor registers it
//! here before anything can log it. So redaction does not depend on every call site remembering a logger
//! method. The lockfile password is registered the same way by the League bridge (`add_secret`).
//!
//! Strings shorter than [`MIN_SECRET_LEN`] are ignored: they would redact ordinary words, and a real
//! token (43 characters) or lockfile password (22) is far longer.

use std::sync::{LazyLock, RwLock};

use serde_json::{Map, Value};

use super::scrub::REDACTED;

/// The shortest string worth redacting.
pub const MIN_SECRET_LEN: usize = 6;

static SECRETS: LazyLock<RwLock<Vec<String>>> = LazyLock::new(|| RwLock::new(Vec::new()));

/// Registers a string that must never appear in a log line. Idempotent; never panics.
pub fn add_secret(value: &str) {
    if value.len() < MIN_SECRET_LEN {
        return;
    }
    let mut secrets = match SECRETS.write() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    if !secrets.iter().any(|known| known == value) {
        secrets.push(value.to_owned());
        // Longest first, so a secret that contains another is replaced whole.
        secrets.sort_by_key(|secret| std::cmp::Reverse(secret.len()));
    }
}

/// `text` with every registered secret replaced by `[redacted]`.
pub fn redact_text(text: &str) -> String {
    let secrets = match SECRETS.read() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    let mut out = text.to_owned();
    for secret in secrets.iter() {
        if out.contains(secret.as_str()) {
            out = out.replace(secret.as_str(), REDACTED);
        }
    }
    out
}

/// A deep copy of `value` with every registered secret replaced in every string, keys included.
pub fn redact_value(value: &Value) -> Value {
    match value {
        Value::String(text) => Value::String(redact_text(text)),
        Value::Array(items) => Value::Array(items.iter().map(redact_value).collect()),
        Value::Object(map) => {
            let mut out = Map::with_capacity(map.len());
            for (key, inner) in map {
                out.insert(redact_text(key), redact_value(inner));
            }
            Value::Object(out)
        }
        other => other.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn registered_secrets_are_replaced_everywhere() {
        add_secret("s3cret-value-for-secrets-test");
        add_secret("short");
        assert_eq!(
            redact_text("a s3cret-value-for-secrets-test b short"),
            "a [redacted] b short"
        );
        assert_eq!(
            redact_value(&json!({ "s3cret-value-for-secrets-test": ["x s3cret-value-for-secrets-test"] })),
            json!({ "[redacted]": ["x [redacted]"] })
        );
    }
}
