//! The lobby write's rules (port of `packages/lcu/src/writes.ts`): the verification gate. The write itself is
//! in [`super::endpoints`] behind the allow-list. **Never automate gameplay:** lobby only; nothing here or
//! anywhere in the bridge touches champion select, matchmaking or a game.
//!
//! Create lobby and invite were removed with Start a lobby (M22.11 follow-up): the server queues only
//! `switch_side`, and any other kind is answered `malformed_payload` by the command runner.

/// The one lobby write.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum LobbyWriteKind {
    /// `POST /lol-lobby/v2/lobby/team/TEAM1|TEAM2`.
    SwitchSide,
}

impl LobbyWriteKind {
    /// The command kind the server names it by, or `None` for any other kind.
    pub fn parse(kind: &str) -> Option<Self> {
        match kind {
            "switch_side" => Some(Self::SwitchSide),
            _ => None,
        }
    }

    /// The server's name for it.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::SwitchSide => "switch_side",
        }
    }

    /// The docs/03 row that verifies it (named in the `endpoint_unverified` nack).
    pub fn reference_row(self) -> &'static str {
        match self {
            Self::SwitchSide => "Switch side (POST /lol-lobby/v2/lobby/team/{team})",
        }
    }
}

/// `LOBBY_WRITE_VERIFICATION`: whether a write's docs/03 row is `verified` (switch side: 16.18, 2026-09-12).
/// Setting it back to `false` makes the runner refuse the kind with `endpoint_unverified` and no client call.
pub fn is_lobby_write_verified(kind: LobbyWriteKind) -> bool {
    match kind {
        LobbyWriteKind::SwitchSide => true,
    }
}
