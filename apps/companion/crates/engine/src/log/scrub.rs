//! Credential scrubbing for log fields: a port of `packages/lcu/src/scrub.ts` (`scrubValue`, `scrubText`),
//! the rules every 0.x log line already went through.
//!
//! - A key that smells like a credential (`token`, `password`, `secret`, `cookie`, `authorization`, ...,
//!   case-insensitive, anywhere in the key) has its value replaced by `[redacted]`, at any depth.
//! - A string that looks like JSON is scrubbed as JSON and re-serialised (the client nests whole payloads
//!   as strings); one that starts like JSON but does not parse gets the free-text scrub over its whole
//!   length.
//! - The free-text scrub replaces the value of every `key: value` / `"key": "value"` / `key=value` pair
//!   whose key smells like a credential.
//!
//! This is the key-based half. The other half is [`super::secrets`]: every registered secret string (the
//! companion token, the lockfile password) is replaced wherever it appears, key or value or message.

use serde_json::{Map, Value};

/// What a scrubbed value becomes.
pub const REDACTED: &str = "[redacted]";

/// `SENSITIVE_KEY` in `scrub.ts`, as lower-case substrings.
const SENSITIVE_WORDS: &[&str] = &[
    "token",
    "password",
    "secret",
    "cookie",
    "authorization",
    "credential",
    "jwt",
    "bearer",
    "encryptionkey",
    "spectatorkey",
    "observerencryptionkey",
    "packetcop",
];

/// Whether a key's value must never be written.
pub fn is_sensitive_key(key: &str) -> bool {
    let lower = key.to_ascii_lowercase();
    SENSITIVE_WORDS.iter().any(|word| lower.contains(word))
}

/// A deep copy of `value` with every sensitive key's value replaced, looking inside JSON strings too.
pub fn scrub_value(value: &Value) -> Value {
    match value {
        Value::String(text) => Value::String(scrub_string(text)),
        Value::Array(items) => Value::Array(items.iter().map(scrub_value).collect()),
        Value::Object(map) => {
            let mut out = Map::with_capacity(map.len());
            for (key, inner) in map {
                let scrubbed = if is_sensitive_key(key) {
                    Value::String(REDACTED.to_owned())
                } else {
                    scrub_value(inner)
                };
                out.insert(key.clone(), scrubbed);
            }
            Value::Object(out)
        }
        other => other.clone(),
    }
}

fn scrub_string(text: &str) -> String {
    let head = text.trim_start();
    if !(head.starts_with('{') || head.starts_with('[')) {
        return text.to_owned();
    }
    match serde_json::from_str::<Value>(text) {
        Ok(parsed) => serde_json::to_string(&scrub_value(&parsed)).unwrap_or_else(|_| REDACTED.to_owned()),
        Err(_) => scrub_text(text, usize::MAX),
    }
}

fn is_word(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ch == '_' || ch == '-'
}

/// A bounded prefix of `text` (at most `max_chars` characters) with the value of every credential-looking
/// `key: value` pair replaced by `"[redacted]"` (`scrub.ts` `scrubText`, `SENSITIVE_TEXT_PAIR`).
pub fn scrub_text(text: &str, max_chars: usize) -> String {
    let chars: Vec<char> = text.chars().take(max_chars).collect();
    let mut out = String::with_capacity(chars.len());
    let mut i = 0;
    while i < chars.len() {
        if !is_word(chars[i]) {
            out.push(chars[i]);
            i += 1;
            continue;
        }
        // A maximal run of word characters: the candidate key.
        let start = i;
        while i < chars.len() && is_word(chars[i]) {
            i += 1;
        }
        let key: String = chars[start..i].iter().collect();
        out.push_str(&key);
        if !is_sensitive_key(&key) {
            continue;
        }
        // Optional closing quote, whitespace, `:` or `=`, whitespace.
        let mut j = i;
        if j < chars.len() && chars[j] == '"' {
            j += 1;
        }
        while j < chars.len() && chars[j].is_whitespace() {
            j += 1;
        }
        if j >= chars.len() || (chars[j] != ':' && chars[j] != '=') {
            continue;
        }
        j += 1;
        while j < chars.len() && chars[j].is_whitespace() {
            j += 1;
        }
        let value_start = j;
        if j < chars.len() && chars[j] == '"' {
            j += 1;
            while j < chars.len() && chars[j] != '"' {
                j += if chars[j] == '\\' { 2 } else { 1 };
            }
            j = (j + 1).min(chars.len());
        } else {
            while j < chars.len() && !matches!(chars[j], ',' | ';' | '}' | ']') && !chars[j].is_whitespace() {
                j += 1;
            }
            if j == value_start {
                continue;
            }
        }
        out.extend(chars[i..value_start].iter());
        out.push('"');
        out.push_str(REDACTED);
        out.push('"');
        i = j;
    }
    out
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn sensitive_keys_are_replaced_at_any_depth() {
        let value = json!({
            "gameId": 1,
            "companionToken": "abc",
            "nested": { "Authorization": "Bearer x", "ok": [ { "riotPassword": "p" } ] },
        });
        assert_eq!(
            scrub_value(&value),
            json!({
                "gameId": 1,
                "companionToken": REDACTED,
                "nested": { "Authorization": REDACTED, "ok": [ { "riotPassword": REDACTED } ] },
            })
        );
    }

    #[test]
    fn json_inside_a_string_is_scrubbed_as_json() {
        let value = json!({ "payload": "{\"playerCredentials\":{\"encryptionKey\":\"k\"}}" });
        let scrubbed = scrub_value(&value);
        let inner: Value = serde_json::from_str(scrubbed["payload"].as_str().unwrap()).unwrap();
        assert_eq!(inner, json!({ "playerCredentials": REDACTED }));
    }

    #[test]
    fn free_text_pairs_are_scrubbed() {
        assert_eq!(
            scrub_text("{\"x\":1,\"authToken\": \"abc\\\"def\", \"y\":2", usize::MAX),
            "{\"x\":1,\"authToken\": \"[redacted]\", \"y\":2"
        );
        assert_eq!(
            scrub_text("password=hunter22; next", usize::MAX),
            "password=\"[redacted]\"; next"
        );
        assert_eq!(
            scrub_text("tokens are fine here", usize::MAX),
            "tokens are fine here"
        );
        assert_eq!(scrub_text("abcdef", 3), "abc");
    }

    #[test]
    fn a_broken_json_string_gets_the_text_scrub() {
        let value = json!("{\"remoting-auth-token\": \"s3cr3t\", oops");
        assert_eq!(
            scrub_value(&value),
            json!("{\"remoting-auth-token\": \"[redacted]\", oops")
        );
    }
}
