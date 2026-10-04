//! The companion token: 43 base64url characters (`apps/web/lib/companionAuth.ts` mints 32 random bytes),
//! checked with `config.ts`'s `cleanTokenInput` + `looksLikeCompanionToken` semantics (parity row 2).
//!
//! **It cannot be logged by accident.** [`CompanionToken`] has no `Display`, its `Debug` prints
//! `CompanionToken([redacted])`, and building one registers the string with the log's secret list
//! ([`crate::log::add_secret`]) before the value is handed to anyone, so even a token that reaches a log
//! line some other way (a JSON body, an error message) is replaced. [`CompanionToken::expose`] is the only
//! way to the string, for the `Authorization` header and the config file.

use std::fmt;

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use sha2::{Digest, Sha256};

/// A token's length.
pub const COMPANION_TOKEN_LENGTH: usize = 43;

const ESC: char = '\u{1b}';

fn is_control(ch: char) -> bool {
    matches!(ch, '\u{0}'..='\u{1f}' | '\u{7f}' | '\u{feff}')
}

fn is_quote(ch: char) -> bool {
    matches!(
        ch,
        '"' | '\'' | '`' | '\u{201c}' | '\u{201d}' | '\u{2018}' | '\u{2019}'
    )
}

/// A pasted or stored token as a person meant it (`cleanTokenInput`): terminal escape sequences gone
/// (`ESC [ params intermediates final`, `ESC O x`, or `ESC` plus one character), control characters gone,
/// whitespace and quotes around it gone.
pub fn clean_token_input(raw: &str) -> String {
    let chars: Vec<char> = raw.chars().collect();
    let mut kept = String::with_capacity(raw.len());
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == ESC {
            // A lone ESC at the end is a control character and goes.
            if i + 1 >= chars.len() {
                i += 1;
                continue;
            }
            match chars[i + 1] {
                '[' => {
                    let mut j = i + 2;
                    while j < chars.len() && ('0'..='?').contains(&chars[j]) {
                        j += 1;
                    }
                    while j < chars.len() && (' '..='/').contains(&chars[j]) {
                        j += 1;
                    }
                    if j < chars.len() && ('@'..='~').contains(&chars[j]) {
                        i = j + 1;
                    } else {
                        // Not a whole CSI: the regex falls back to ESC plus one character.
                        i += 2;
                    }
                }
                'O' if i + 2 < chars.len() && ('@'..='~').contains(&chars[i + 2]) => i += 3,
                _ => i += 2,
            }
            continue;
        }
        if !is_control(chars[i]) {
            kept.push(chars[i]);
        }
        i += 1;
    }
    let trimmed = kept.trim();
    let unquoted = trimmed.trim_start_matches(is_quote).trim_end_matches(is_quote);
    unquoted.trim().to_owned()
}

/// Whether a (cleaned) string has a token's shape.
pub fn looks_like_companion_token(value: &str) -> bool {
    value.len() == COMPANION_TOKEN_LENGTH
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// A short, one-way tag of a token (`tokenFingerprint`): sha256, first 16 hex digits. Enough to tell two
/// tokens apart, nothing that could be used as one.
pub fn fingerprint_of(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    digest.iter().take(8).map(|b| format!("{b:02x}")).collect()
}

/// A companion token that passed the shape check.
#[derive(Clone, PartialEq, Eq, Hash)]
pub struct CompanionToken(String);

impl CompanionToken {
    /// Cleans `raw` and checks its shape. `None` means "no token" (the window shows Link).
    pub fn parse(raw: &str) -> Option<Self> {
        let cleaned = clean_token_input(raw);
        if !looks_like_companion_token(&cleaned) {
            return None;
        }
        crate::log::add_secret(&cleaned);
        Some(CompanionToken(cleaned))
    }

    /// The string, for the `Authorization` header and the config file. Never for a log line.
    pub fn expose(&self) -> &str {
        &self.0
    }

    /// [`fingerprint_of`] this token.
    pub fn fingerprint(&self) -> String {
        fingerprint_of(&self.0)
    }
}

impl fmt::Debug for CompanionToken {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("CompanionToken([redacted])")
    }
}

impl Serialize for CompanionToken {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for CompanionToken {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        // The error never quotes the value.
        CompanionToken::parse(&raw)
            .ok_or_else(|| serde::de::Error::custom("a companion token is 43 base64url characters"))
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    const TOKEN: &str = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcd";

    #[test]
    fn the_test_token_has_the_shape() {
        assert_eq!(TOKEN.len(), 42);
        let token = format!("{TOKEN}e");
        assert!(looks_like_companion_token(&token));
    }

    #[test]
    fn cleans_like_clean_token_input() {
        let token = format!("{TOKEN}e");
        for raw in [
            format!("\u{1b}[200~{token}\u{1b}[201~"),
            format!("  \"{token}\"\r\n"),
            format!("\u{201c}{token}\u{201d}"),
            format!("\u{feff}{token}"),
            format!("{token}\u{1b}OA"),
        ] {
            assert_eq!(clean_token_input(&raw), token, "{raw:?}");
            assert_eq!(CompanionToken::parse(&raw).unwrap().expose(), token);
        }
        // 0.1.0's corrupted paste: the ESC dropped, `[200~` kept. Not a token.
        assert!(CompanionToken::parse(&format!("[200~{token}")).is_none());
        assert!(CompanionToken::parse("short").is_none());
        assert!(CompanionToken::parse(&format!("{token}!")).is_none());
    }

    #[test]
    fn debug_and_errors_never_show_it() {
        let token = CompanionToken::parse(&format!("{TOKEN}f")).unwrap();
        assert_eq!(format!("{token:?}"), "CompanionToken([redacted])");
        let error = serde_json::from_str::<CompanionToken>("\"not-a-token-but-secretish\"").unwrap_err();
        assert!(!error.to_string().contains("secretish"));
    }

    #[test]
    fn fingerprint_matches_the_typescript_one() {
        // node -e "console.log(require('crypto').createHash('sha256').update('abc').digest('hex').slice(0,16))"
        assert_eq!(fingerprint_of("abc"), "ba7816bf8f01cfea");
    }
}
