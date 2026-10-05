//! Every League client call the engine makes, typed: exactly the list under "Client endpoints the Rust
//! bridge uses" in the M17 section of `docs/02-milestones.md`, all `verified` in docs/03 for the TypeScript
//! bridge. The Rust bridge is unverified until the M17.5 probe runs against a live client.
//!
//! **Never automate gameplay:** nothing here reads or writes `/lol-champ-select/*`, matchmaking, ready check
//! or in-game state, and the only write is switch side, behind [`LOBBY_WRITE_PATHS`].

use serde::Deserialize;
use serde_json::Value;

use super::client::{LcuClient, LcuFailure, LcuResponse};
use super::types::{
    CustomGameQueues, EogStatsBlock, GameQueue, GameflowSession, Lobby, MatchDetail, MatchHistoryList,
    RankedStats, Summoner, TeamId,
};

/// One read endpoint: id (the fixture name in `packages/lcu/fixtures/<patch>/`) and path template.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReadEndpoint {
    /// The fixture id.
    pub id: &'static str,
    /// The path, with `{puuid}` / `{gameId}` / `{begIndex}` / `{endIndex}` placeholders.
    pub path: &'static str,
}

/// Every GET the engine makes.
pub const READ_ENDPOINTS: [ReadEndpoint; 13] = [
    ReadEndpoint {
        id: "game-version",
        path: "/lol-patch/v1/game-version",
    },
    ReadEndpoint {
        id: "current-summoner",
        path: "/lol-summoner/v1/current-summoner",
    },
    ReadEndpoint {
        id: "summoner-by-puuid",
        path: "/lol-summoner/v2/summoners/puuid/{puuid}",
    },
    ReadEndpoint {
        id: "current-ranked-stats",
        path: "/lol-ranked/v1/current-ranked-stats",
    },
    ReadEndpoint {
        id: "ranked-stats-by-puuid",
        path: "/lol-ranked/v1/ranked-stats/{puuid}",
    },
    ReadEndpoint {
        id: "gameflow-phase",
        path: "/lol-gameflow/v1/gameflow-phase",
    },
    ReadEndpoint {
        id: "gameflow-session",
        path: "/lol-gameflow/v1/session",
    },
    ReadEndpoint {
        id: "lobby",
        path: "/lol-lobby/v2/lobby",
    },
    ReadEndpoint {
        id: "custom-game-queues",
        path: "/lol-game-queues/v1/custom",
    },
    ReadEndpoint {
        id: "game-queues",
        path: "/lol-game-queues/v1/queues",
    },
    ReadEndpoint {
        id: "eog-stats-block",
        path: "/lol-end-of-game/v1/eog-stats-block",
    },
    ReadEndpoint {
        id: "match-history",
        path: "/lol-match-history/v1/products/lol/{puuid}/matches?begIndex={begIndex}&endIndex={endIndex}",
    },
    ReadEndpoint {
        id: "match-detail",
        path: "/lol-match-history/v1/games/{gameId}",
    },
];

/// The only paths a write may go to: switch side.
pub const LOBBY_WRITE_PATHS: [&str; 2] = ["/lol-lobby/v2/lobby/team/TEAM1", "/lol-lobby/v2/lobby/team/TEAM2"];

/// The WebSocket URIs the watchers read (the subscription is to every event; these are routed, the rest
/// ignored).
pub const LOBBY_URI: &str = "/lol-lobby/v2/lobby";
/// The gameflow phase event.
pub const GAMEFLOW_PHASE_URI: &str = "/lol-gameflow/v1/gameflow-phase";
/// The end-of-game block event.
pub const EOG_BLOCK_URI: &str = "/lol-end-of-game/v1/eog-stats-block";
/// The cached ranked stats event, `{puuid}` appended.
pub const RANKED_STATS_URI_PREFIX: &str = "/lol-ranked/v1/cached-ranked-stats/";

/// Percent-encodes a path segment (`encodeURIComponent`'s unreserved set).
pub fn encode_segment(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// `/lol-match-history/v1/products/lol/{puuid}/matches?begIndex=&endIndex=` (inclusive window).
pub fn match_history_path(puuid: &str, beg_index: u32, end_index: u32) -> String {
    format!(
        "/lol-match-history/v1/products/lol/{}/matches?begIndex={beg_index}&endIndex={end_index}",
        encode_segment(puuid)
    )
}

/// `/lol-lobby/v2/lobby/team/TEAM1` for 100, `TEAM2` for 200: the target side is in the path, not a toggle.
pub fn switch_side_path(side: TeamId) -> &'static str {
    match side {
        TeamId::Blue => LOBBY_WRITE_PATHS[0],
        TeamId::Red => LOBBY_WRITE_PATHS[1],
    }
}

/// A write answer: a 2xx whose body is JSON (or empty); its content is never depended on. A 2xx whose body
/// is not JSON is a `Malformed` failure, as the TypeScript runner treats it (`response.ok` is false there).
#[derive(Debug, Clone, PartialEq)]
pub struct WriteAnswer {
    /// The status.
    pub status: u16,
}

/// Any JSON at all (write answers).
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(transparent)]
struct AnyJson(#[allow(dead_code)] Value);

impl LcuClient {
    /// `GET /lol-patch/v1/game-version`: the long build string (`16.17.8104348+branch...`).
    pub async fn game_version(&self) -> LcuResponse<String> {
        self.get("/lol-patch/v1/game-version").await
    }

    /// `GET /lol-summoner/v1/current-summoner`.
    pub async fn current_summoner(&self) -> LcuResponse<Summoner> {
        self.get("/lol-summoner/v1/current-summoner").await
    }

    /// `GET /lol-summoner/v2/summoners/puuid/{puuid}`.
    pub async fn summoner_by_puuid(&self, puuid: &str) -> LcuResponse<Summoner> {
        self.get(&format!(
            "/lol-summoner/v2/summoners/puuid/{}",
            encode_segment(puuid)
        ))
        .await
    }

    /// `GET /lol-ranked/v1/current-ranked-stats`.
    pub async fn current_ranked_stats(&self) -> LcuResponse<RankedStats> {
        self.get("/lol-ranked/v1/current-ranked-stats").await
    }

    /// `GET /lol-ranked/v1/ranked-stats/{puuid}`.
    pub async fn ranked_stats(&self, puuid: &str) -> LcuResponse<RankedStats> {
        self.get(&format!("/lol-ranked/v1/ranked-stats/{}", encode_segment(puuid)))
            .await
    }

    /// `GET /lol-gameflow/v1/gameflow-phase`: a bare string.
    pub async fn gameflow_phase(&self) -> LcuResponse<String> {
        self.get("/lol-gameflow/v1/gameflow-phase").await
    }

    /// `GET /lol-gameflow/v1/session`.
    pub async fn gameflow_session(&self) -> LcuResponse<GameflowSession> {
        self.get("/lol-gameflow/v1/session").await
    }

    /// `GET /lol-lobby/v2/lobby` (404 when there is none).
    pub async fn lobby(&self) -> LcuResponse<Lobby> {
        self.get(LOBBY_URI).await
    }

    /// `GET /lol-game-queues/v1/custom`: the Create Custom dialog's entries.
    pub async fn custom_game_queues(&self) -> LcuResponse<CustomGameQueues> {
        self.get("/lol-game-queues/v1/custom").await
    }

    /// `GET /lol-game-queues/v1/queues`: names the dialog's entries.
    pub async fn game_queues(&self) -> LcuResponse<Vec<GameQueue>> {
        self.get("/lol-game-queues/v1/queues").await
    }

    /// `GET /lol-end-of-game/v1/eog-stats-block`: only at connect on the end-of-game screen; the block
    /// otherwise comes from the WebSocket (the GET 404s once someone clicks past).
    pub async fn eog_stats_block(&self) -> LcuResponse<EogStatsBlock> {
        self.get(EOG_BLOCK_URI).await
    }

    /// `GET /lol-match-history/v1/products/lol/{puuid}/matches?begIndex=&endIndex=`.
    pub async fn match_history(
        &self,
        puuid: &str,
        beg_index: u32,
        end_index: u32,
    ) -> LcuResponse<MatchHistoryList> {
        self.get(&match_history_path(puuid, beg_index, end_index)).await
    }

    /// `GET /lol-match-history/v1/games/{gameId}`.
    pub async fn match_detail(&self, game_id: i64) -> LcuResponse<MatchDetail> {
        self.get(&format!("/lol-match-history/v1/games/{game_id}")).await
    }

    async fn write<B: serde::Serialize + ?Sized>(
        &self,
        path: &str,
        body: Option<&B>,
    ) -> Result<WriteAnswer, LcuFailure> {
        // `post` itself refuses anything outside `LOBBY_WRITE_PATHS`.
        self.post::<B, AnyJson>(path, body)
            .await
            .map(|ok| WriteAnswer { status: ok.status })
    }

    /// `POST /lol-lobby/v2/lobby/team/TEAM1|TEAM2`, no body.
    pub async fn switch_side(&self, side: TeamId) -> Result<WriteAnswer, LcuFailure> {
        self.write::<()>(switch_side_path(side), None).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_are_encoded_and_reads_never_touch_champ_select() {
        assert_eq!(encode_segment("a b/ä"), "a%20b%2F%C3%A4");
        assert_eq!(
            match_history_path("34151cbd-d9f8-5dad-9dc8-c6a8e253c0de", 0, 20),
            "/lol-match-history/v1/products/lol/34151cbd-d9f8-5dad-9dc8-c6a8e253c0de/matches?begIndex=0&endIndex=20"
        );
        for endpoint in READ_ENDPOINTS {
            assert!(endpoint.path.starts_with('/'));
            assert!(!endpoint.path.contains("champ-select") && !endpoint.path.contains("matchmaking"));
        }
        assert_eq!(switch_side_path(TeamId::Red), "/lol-lobby/v2/lobby/team/TEAM2");
    }

    #[tokio::test]
    async fn post_refuses_every_path_outside_the_lobby_list_before_any_request() {
        // Port 9 on loopback: nothing listens, so a request that went out would fail as a network error
        // without the word "refused".
        let credentials = crate::lcu::lockfile::Credentials {
            name: "LeagueClient".into(),
            pid: 1,
            port: 9,
            password: "not-a-real-password".into(),
        };
        let client = LcuClient::new(&credentials).unwrap();
        for path in [
            "/lol-champ-select/v1/session/actions/1",
            "/lol-matchmaking/v1/ready-check/accept",
            "/lol-lobby/v2/lobby/matchmaking/search",
            "/lol-lobby/v2/lobby/team/TEAM3",
        ] {
            match client.post::<(), AnyJson>(path, None).await {
                Err(LcuFailure::Network { message, .. }) => {
                    assert!(message.starts_with("refused:"), "{path}: {message}")
                }
                other => panic!("{path}: {:?}", other.map(|ok| ok.status)),
            }
        }
    }
}
