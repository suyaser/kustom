//! The lockfile: `<install dir>/lockfile`, written by the client while it runs and removed on exit, holding
//! `LeagueClient:<pid>:<port>:<password>:https` (docs/03 "Connecting"). Port of `packages/lcu/src/lockfile.ts`
//! `parseLockfile`: surrounding whitespace is tolerated, nothing else.

use std::fmt;

/// The lockfile's name inside the install directory.
pub const LOCKFILE_NAME: &str = "lockfile";

/// How to reach a running client. The password is the client's basic-auth secret: never logged, and
/// `Debug` prints it redacted.
#[derive(Clone, PartialEq, Eq)]
pub struct Credentials {
    /// Always `LeagueClient` for the League client; kept so a mismatch is visible.
    pub name: String,
    /// The `LeagueClient` process id.
    pub pid: u32,
    /// The HTTPS and WebSocket port on `127.0.0.1`.
    pub port: u16,
    /// The basic-auth password (`riot:<password>`).
    pub password: String,
}

impl fmt::Debug for Credentials {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Credentials")
            .field("name", &self.name)
            .field("pid", &self.pid)
            .field("port", &self.port)
            .field("password", &"[redacted]")
            .finish()
    }
}

/// Why a lockfile's text was refused. Never carries the text itself (it holds the password).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LockfileError {
    /// Empty or whitespace only (the client is still writing it, or it is stale).
    Empty,
    /// Not five colon-separated fields.
    FieldCount(usize),
    /// A field did not parse (`pid`, `port`, an empty name or password, a protocol other than `https`).
    BadField(&'static str),
}

impl fmt::Display for LockfileError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            LockfileError::Empty => write!(f, "empty file"),
            LockfileError::FieldCount(n) => write!(f, "expected 5 colon-separated fields, got {n}"),
            LockfileError::BadField(field) => write!(f, "{field}: invalid"),
        }
    }
}

/// Registers a client password as a log secret, in both forms it can travel in: the plain password and the
/// base64 `riot:<password>` of the Basic header (the log sink only scrubs JSON-shaped strings, so the
/// header form must be known by value). Called wherever a password is parsed: here and from the command line.
pub fn register_password(password: &str) {
    crate::log::add_secret(password);
    crate::log::add_secret(&super::client::basic_auth_credential(password));
}

/// Parses the lockfile text. A parsed password is registered as a log secret before it is returned.
pub fn parse_lockfile(text: &str) -> Result<Credentials, LockfileError> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err(LockfileError::Empty);
    }
    let parts: Vec<&str> = trimmed.split(':').collect();
    let [name, pid, port, password, protocol] = parts.as_slice() else {
        return Err(LockfileError::FieldCount(parts.len()));
    };
    if name.is_empty() {
        return Err(LockfileError::BadField("name"));
    }
    let pid: u32 = pid
        .parse()
        .ok()
        .filter(|p| *p > 0)
        .ok_or(LockfileError::BadField("pid"))?;
    let port: u16 = port
        .parse()
        .ok()
        .filter(|p| *p > 0)
        .ok_or(LockfileError::BadField("port"))?;
    if password.is_empty() {
        return Err(LockfileError::BadField("password"));
    }
    if *protocol != "https" {
        return Err(LockfileError::BadField("protocol"));
    }
    register_password(password);
    Ok(Credentials {
        name: (*name).to_string(),
        pid,
        port,
        password: (*password).to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_documented_shape_with_whitespace() {
        let c = parse_lockfile("  LeagueClient:86388:50844:s3cr3t-Pa_ss:https\r\n").unwrap();
        assert_eq!(c.name, "LeagueClient");
        assert_eq!(c.pid, 86388);
        assert_eq!(c.port, 50844);
        assert_eq!(c.password, "s3cr3t-Pa_ss");
        assert!(
            !format!("{c:?}").contains("s3cr3t"),
            "Debug must not print the password"
        );
    }

    #[test]
    fn refuses_every_bad_shape() {
        assert_eq!(parse_lockfile(""), Err(LockfileError::Empty));
        assert_eq!(parse_lockfile("  \n"), Err(LockfileError::Empty));
        assert_eq!(
            parse_lockfile("LeagueClient:1:2:pw"),
            Err(LockfileError::FieldCount(4))
        );
        assert_eq!(
            parse_lockfile("LeagueClient:1:2:p:w:https"),
            Err(LockfileError::FieldCount(6))
        );
        assert_eq!(
            parse_lockfile(":1:2:pw:https"),
            Err(LockfileError::BadField("name"))
        );
        assert_eq!(
            parse_lockfile("LeagueClient:x:2:pw:https"),
            Err(LockfileError::BadField("pid"))
        );
        assert_eq!(
            parse_lockfile("LeagueClient:0:2:pw:https"),
            Err(LockfileError::BadField("pid"))
        );
        assert_eq!(
            parse_lockfile("LeagueClient:1:70000:pw:https"),
            Err(LockfileError::BadField("port"))
        );
        assert_eq!(
            parse_lockfile("LeagueClient:1:0:pw:https"),
            Err(LockfileError::BadField("port"))
        );
        assert_eq!(
            parse_lockfile("LeagueClient:1:2::https"),
            Err(LockfileError::BadField("password"))
        );
        assert_eq!(
            parse_lockfile("LeagueClient:1:2:pw:http"),
            Err(LockfileError::BadField("protocol"))
        );
    }
}
