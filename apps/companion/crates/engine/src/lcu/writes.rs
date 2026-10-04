//! The three lobby writes' rules (port of `packages/lcu/src/writes.ts`): the verification gate, and how a
//! create body finds its ids in the client's own Create Custom dialog data. The writes themselves are in
//! [`super::endpoints`] behind the allow-list. **Never automate gameplay:** lobby only; nothing here or
//! anywhere in the bridge touches champion select, matchmaking or a game.

use std::collections::HashMap;

use super::types::{CustomGameMutator, CustomGameQueues, CustomGameSubcategory, GameQueue};

/// The three lobby writes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum LobbyWriteKind {
    /// `POST /lol-lobby/v2/lobby`.
    CreateLobby,
    /// `POST /lol-lobby/v2/lobby/invitations`.
    Invite,
    /// `POST /lol-lobby/v2/lobby/team/TEAM1|TEAM2`.
    SwitchSide,
}

impl LobbyWriteKind {
    /// The command kind the server names it by, or `None` for any other kind.
    pub fn parse(kind: &str) -> Option<Self> {
        match kind {
            "create_lobby" => Some(Self::CreateLobby),
            "invite" => Some(Self::Invite),
            "switch_side" => Some(Self::SwitchSide),
            _ => None,
        }
    }

    /// The server's name for it.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::CreateLobby => "create_lobby",
            Self::Invite => "invite",
            Self::SwitchSide => "switch_side",
        }
    }

    /// The docs/03 row that verifies it (named in the `endpoint_unverified` nack).
    pub fn reference_row(self) -> &'static str {
        match self {
            Self::CreateLobby => "Create custom lobby (POST /lol-lobby/v2/lobby)",
            Self::Invite => "Invite (POST /lol-lobby/v2/lobby/invitations)",
            Self::SwitchSide => "Switch side (POST /lol-lobby/v2/lobby/team/{team})",
        }
    }
}

/// `LOBBY_WRITE_VERIFICATION`: whether a write's docs/03 row is `verified`. All three were verified on 16.18
/// (2026-09-12, a Windows `--verify-commands` run). Setting one back to `false` makes the runner refuse that
/// kind with `endpoint_unverified` and no client call.
pub fn is_lobby_write_verified(kind: LobbyWriteKind) -> bool {
    match kind {
        LobbyWriteKind::CreateLobby | LobbyWriteKind::Invite | LobbyWriteKind::SwitchSide => true,
    }
}

/// The pick mode a `create_lobby` opens (decision row 2026-09-09: the group plays draft).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CustomLobbyMode {
    /// Blind pick.
    Blind,
    /// Draft pick.
    Draft,
    /// Tournament draft.
    TournamentDraft,
    /// All random.
    AllRandom,
}

fn matches_mode(mode: CustomLobbyMode, text: &str) -> bool {
    match mode {
        CustomLobbyMode::Blind => text.contains("BLIND") || text.contains("SIMUL"),
        CustomLobbyMode::Draft => text.contains("DRAFT") && !text.contains("TOURNAMENT"),
        CustomLobbyMode::TournamentDraft => text.contains("TOURNAMENT"),
        CustomLobbyMode::AllRandom => text.contains("RANDOM"),
    }
}

/// Summoner's Rift classic: the subcategory the group's lobby is created in.
pub fn summoners_rift_subcategory(config: &CustomGameQueues) -> Option<&CustomGameSubcategory> {
    config
        .subcategories
        .iter()
        .find(|entry| entry.map_id == 11 && entry.game_mode == "CLASSIC")
}

fn mutator_text(mutator: &CustomGameMutator) -> String {
    format!(
        "{} {} {}",
        mutator.name.as_deref().unwrap_or_default(),
        mutator.pick_mode.as_deref().unwrap_or_default(),
        mutator.ban_mode.as_deref().unwrap_or_default()
    )
    .to_uppercase()
}

fn queue_text(queues: &HashMap<i64, &GameQueue>, id: i64) -> String {
    let Some(queue) = queues.get(&id) else {
        return String::new();
    };
    let config = queue.game_type_config.as_ref();
    format!(
        "{} {} {} {}",
        queue.name.as_deref().unwrap_or_default(),
        config.and_then(|c| c.name.as_deref()).unwrap_or_default(),
        config.and_then(|c| c.pick_mode.as_deref()).unwrap_or_default(),
        config.and_then(|c| c.ban_mode.as_deref()).unwrap_or_default()
    )
    .to_uppercase()
}

/// The dialog entry id for `mode`: the subcategory's entries named by their own words or by the queue
/// list's name for the same id (16.18's entries carry no words). Blind also accepts the known ids 19/3100.
pub fn custom_lobby_id_for(
    config: &CustomGameQueues,
    mode: CustomLobbyMode,
    queues: &[GameQueue],
) -> Option<i64> {
    let subcategory = summoners_rift_subcategory(config)?;
    let by_id: HashMap<i64, &GameQueue> = queues.iter().map(|queue| (queue.id, queue)).collect();
    let by_words = subcategory.mutators.iter().find(|mutator| {
        let text = format!("{} {}", mutator_text(mutator), queue_text(&by_id, mutator.id));
        matches_mode(mode, text.trim())
    });
    if let Some(mutator) = by_words {
        return Some(mutator.id);
    }
    if mode == CustomLobbyMode::Blind {
        return subcategory
            .mutators
            .iter()
            .find(|m| m.id == 19 || m.id == 3100)
            .map(|m| m.id);
    }
    None
}

/// `id name pick=... ban=...` per entry, for a nack line.
pub fn describe_mutators(subcategory: &CustomGameSubcategory) -> String {
    subcategory
        .mutators
        .iter()
        .map(|m| {
            let mut out = m.id.to_string();
            if let Some(name) = m.name.as_deref().filter(|n| !n.is_empty()) {
                out.push(' ');
                out.push_str(name);
            }
            if let Some(pick) = m.pick_mode.as_deref().filter(|p| !p.is_empty()) {
                out.push_str(&format!(" pick={pick}"));
            }
            if let Some(ban) = m.ban_mode.as_deref().filter(|b| !b.is_empty()) {
                out.push_str(&format!(" ban={ban}"));
            }
            out
        })
        .collect::<Vec<_>>()
        .join(", ")
}
