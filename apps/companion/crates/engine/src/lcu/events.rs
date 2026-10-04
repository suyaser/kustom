//! The client's event frames and their routing (ports of `parseFrame` in `packages/lcu/src/socket.ts` and
//! `ConnectionMachine.dispatch` in `apps/companion/src/connection.ts`).
//!
//! Protocol (WAMP v1 style, docs/03 "WebSocket"): send `[5, "OnJsonApiEvent"]` to subscribe to everything;
//! receive `[8, "OnJsonApiEvent", { data, eventType: "Create"|"Update"|"Delete", uri }]`. The client sends one
//! empty frame right after a subscribe. A frame that is not that shape, or an event whose `data` does not fit
//! its URI's type, is dropped with one log line naming the URI, never the payload.

use serde::Deserialize;
use serde_json::Value;

use super::endpoints::{EOG_BLOCK_URI, GAMEFLOW_PHASE_URI, LOBBY_URI, RANKED_STATS_URI_PREFIX};
use super::types::{EogStatsBlock, Lobby, RankedStats};

/// Subscribes to every JSON API event.
pub const ALL_EVENTS_TOPIC: &str = "OnJsonApiEvent";

/// `[5, topic]`.
pub fn subscribe_message(topic: &str) -> String {
    serde_json::json!([5, topic]).to_string()
}

/// `[6, topic]`.
pub fn unsubscribe_message(topic: &str) -> String {
    serde_json::json!([6, topic]).to_string()
}

/// `/lol-lobby/v2/lobby` -> `OnJsonApiEvent_lol-lobby_v2_lobby`.
pub fn topic_for_uri(uri: &str) -> String {
    format!(
        "{ALL_EVENTS_TOPIC}_{}",
        uri.trim_start_matches('/').replace('/', "_")
    )
}

/// `Create`, `Update`, `Delete`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum LcuEventType {
    /// A resource appeared.
    Create,
    /// It changed.
    Update,
    /// It went away (`data` is `null`).
    Delete,
}

/// One event. `Debug` never prints `data` (a lobby carries chat credentials).
#[derive(Clone, PartialEq)]
pub struct LcuEvent {
    /// `OnJsonApiEvent`.
    pub topic: String,
    /// The resource URI.
    pub uri: String,
    /// What happened.
    pub event_type: LcuEventType,
    /// The resource, untyped until routed.
    pub data: Value,
}

impl std::fmt::Debug for LcuEvent {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LcuEvent")
            .field("topic", &self.topic)
            .field("uri", &self.uri)
            .field("event_type", &self.event_type)
            .field("data", &"[redacted]")
            .finish()
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Payload {
    #[serde(default)]
    data: Value,
    event_type: LcuEventType,
    uri: String,
}

/// What one frame was.
#[derive(Debug, Clone, PartialEq)]
pub enum Frame {
    /// An event.
    Event(LcuEvent),
    /// The empty frame after a subscribe.
    Empty,
    /// Not an event frame. `reason` never quotes the frame.
    Malformed(String),
}

/// Parses one text frame.
pub fn parse_frame(text: &str) -> Frame {
    if text.trim().is_empty() {
        return Frame::Empty;
    }
    let value: Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(e) => return Frame::Malformed(format!("invalid JSON at column {}", e.column())),
    };
    let Value::Array(items) = value else {
        return Frame::Malformed("not an array".into());
    };
    let [opcode, topic, payload] = items.as_slice() else {
        return Frame::Malformed(format!("expected 3 elements, got {}", items.len()));
    };
    if opcode.as_u64() != Some(8) {
        return Frame::Malformed("opcode is not 8".into());
    }
    let Some(topic) = topic.as_str() else {
        return Frame::Malformed("topic is not a string".into());
    };
    match Payload::deserialize(payload) {
        Ok(p) => Frame::Event(LcuEvent {
            topic: topic.to_string(),
            uri: p.uri,
            event_type: p.event_type,
            data: p.data,
        }),
        Err(_) => Frame::Malformed("payload is not { data, eventType, uri }".into()),
    }
}

/// An event the watchers act on, already typed. `Debug` names the variant and ids only.
#[derive(Clone, PartialEq)]
pub enum RoutedEvent {
    /// `/lol-lobby/v2/lobby`; `lobby` is `None` on `Delete` (the game started).
    Lobby {
        /// The event type.
        event_type: LcuEventType,
        /// The lobby.
        lobby: Option<Box<Lobby>>,
    },
    /// `/lol-gameflow/v1/gameflow-phase`.
    GameflowPhase(String),
    /// `/lol-end-of-game/v1/eog-stats-block`; `block` is `None` on `Delete`. `raw` is the event's `data`, the
    /// whole block the game post carries as `raw` (scrubbed by the mapper).
    EogBlock {
        /// The event type.
        event_type: LcuEventType,
        /// The block.
        block: Option<Box<EogStatsBlock>>,
        /// The block as JSON.
        raw: Value,
    },
    /// `/lol-ranked/v1/cached-ranked-stats/{puuid}`.
    RankedStats {
        /// From the URI (the body carries none).
        puuid: String,
        /// The stats.
        stats: Box<RankedStats>,
    },
    /// Any other URI: not read.
    Ignored,
}

impl std::fmt::Debug for RoutedEvent {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RoutedEvent::Lobby { event_type, lobby } => f
                .debug_struct("Lobby")
                .field("event_type", event_type)
                .field("party_id", &lobby.as_ref().map(|l| l.party_id.as_str()))
                .finish(),
            RoutedEvent::GameflowPhase(phase) => f.debug_tuple("GameflowPhase").field(phase).finish(),
            RoutedEvent::EogBlock {
                event_type, block, ..
            } => f
                .debug_struct("EogBlock")
                .field("event_type", event_type)
                .field("game_id", &block.as_ref().map(|b| b.game_id))
                .finish(),
            RoutedEvent::RankedStats { puuid, .. } => {
                f.debug_struct("RankedStats").field("puuid", puuid).finish()
            }
            RoutedEvent::Ignored => f.write_str("Ignored"),
        }
    }
}

/// An event on a routed URI whose payload did not fit its type.
#[derive(Clone, PartialEq)]
pub struct DroppedEvent {
    /// The URI.
    pub uri: String,
    /// serde's reason (field and expected type). It can quote a value: never logged or printed as is; use
    /// [`DroppedEvent::safe_reason`].
    pub reason: String,
}

impl DroppedEvent {
    /// `reason` with every quoted value replaced, safe for a log line or the probe.
    pub fn safe_reason(&self) -> String {
        redact_quoted(&self.reason)
    }
}

impl std::fmt::Debug for DroppedEvent {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DroppedEvent")
            .field("uri", &self.uri)
            .field("reason", &self.safe_reason())
            .finish()
    }
}

/// Replaces every `"..."` and `` `...` `` in a serde message with `"[redacted]"`, keeping the rest
/// (`invalid type: string "hunter2", expected i64 at line 1` -> `invalid type: string "[redacted]", ...`).
pub fn redact_quoted(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars();
    while let Some(c) = chars.next() {
        if c == '"' || c == '`' {
            out.push(c);
            out.push_str("[redacted]");
            for inner in chars.by_ref() {
                if inner == c {
                    break;
                }
            }
            out.push(c);
        } else {
            out.push(c);
        }
    }
    out
}

fn typed<T: serde::de::DeserializeOwned>(event: &LcuEvent) -> Result<T, DroppedEvent> {
    T::deserialize(&event.data).map_err(|e| DroppedEvent {
        uri: event.uri.clone(),
        reason: e.to_string(),
    })
}

/// Routes one event exactly as `ConnectionMachine.dispatch` does. A dropped event is logged here (URI and
/// category, never the payload) and returned as `Err` so callers can count it.
pub fn route(event: &LcuEvent) -> Result<RoutedEvent, DroppedEvent> {
    let result = route_inner(event);
    if let Err(dropped) = &result {
        tracing::warn!(uri = %dropped.uri, "lcu event did not match its type; dropped");
    }
    result
}

fn route_inner(event: &LcuEvent) -> Result<RoutedEvent, DroppedEvent> {
    if let Some(puuid) = event.uri.strip_prefix(RANKED_STATS_URI_PREFIX) {
        if event.event_type == LcuEventType::Delete || event.data.is_null() || puuid.is_empty() {
            return Ok(RoutedEvent::Ignored);
        }
        return Ok(RoutedEvent::RankedStats {
            puuid: puuid.to_string(),
            stats: Box::new(typed(event)?),
        });
    }
    let withdrawn = event.event_type == LcuEventType::Delete || event.data.is_null();
    match event.uri.as_str() {
        LOBBY_URI => Ok(RoutedEvent::Lobby {
            event_type: event.event_type,
            lobby: if withdrawn {
                None
            } else {
                Some(Box::new(typed(event)?))
            },
        }),
        GAMEFLOW_PHASE_URI => Ok(RoutedEvent::GameflowPhase(typed(event)?)),
        EOG_BLOCK_URI => Ok(RoutedEvent::EogBlock {
            event_type: event.event_type,
            block: if withdrawn {
                None
            } else {
                Some(Box::new(typed(event)?))
            },
            raw: if withdrawn {
                Value::Null
            } else {
                event.data.clone()
            },
        }),
        _ => Ok(RoutedEvent::Ignored),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames() {
        assert_eq!(parse_frame(""), Frame::Empty);
        assert_eq!(subscribe_message(ALL_EVENTS_TOPIC), r#"[5,"OnJsonApiEvent"]"#);
        assert_eq!(unsubscribe_message("x"), r#"[6,"x"]"#);
        assert_eq!(
            topic_for_uri("/lol-lobby/v2/lobby"),
            "OnJsonApiEvent_lol-lobby_v2_lobby"
        );
        let Frame::Event(e) = parse_frame(
            r#"[8,"OnJsonApiEvent",{"data":"Lobby","eventType":"Update","uri":"/lol-gameflow/v1/gameflow-phase"}]"#,
        ) else {
            panic!()
        };
        assert_eq!(route(&e).unwrap(), RoutedEvent::GameflowPhase("Lobby".into()));
        for bad in [
            "{",
            "{}",
            "[8,\"t\"]",
            "[7,\"t\",{}]",
            "[8,1,{}]",
            "[8,\"t\",{\"eventType\":\"Poke\",\"uri\":\"/x\"}]",
        ] {
            assert!(matches!(parse_frame(bad), Frame::Malformed(_)), "{bad}");
        }
        let Frame::Malformed(reason) = parse_frame(r#"{"password":"hunter2""#) else {
            panic!()
        };
        assert!(!reason.contains("hunter2"));
    }

    #[test]
    fn debug_never_shows_payloads_or_quoted_values() {
        let event = LcuEvent {
            topic: "OnJsonApiEvent".into(),
            uri: LOBBY_URI.into(),
            event_type: LcuEventType::Update,
            data: serde_json::json!({ "partyId": 5, "multiUserChatPassword": "SECRET-PW" }),
        };
        assert!(!format!("{event:?}").contains("SECRET"));
        let dropped = DroppedEvent {
            uri: LOBBY_URI.into(),
            reason: r#"invalid type: string "SECRET-PW", expected i64"#.into(),
        };
        assert!(!format!("{dropped:?}").contains("SECRET"));
        assert_eq!(
            dropped.safe_reason(),
            r#"invalid type: string "[redacted]", expected i64"#
        );
    }

    #[test]
    fn deletes_and_unrouted_uris() {
        let event = |uri: &str, event_type, data| LcuEvent {
            topic: "t".into(),
            uri: uri.into(),
            event_type,
            data,
        };
        assert_eq!(
            route(&event(LOBBY_URI, LcuEventType::Delete, Value::Null)).unwrap(),
            RoutedEvent::Lobby {
                event_type: LcuEventType::Delete,
                lobby: None
            }
        );
        assert!(matches!(
            route(&event(EOG_BLOCK_URI, LcuEventType::Delete, Value::Null)).unwrap(),
            RoutedEvent::EogBlock { block: None, .. }
        ));
        assert_eq!(
            route(&event("/lol-chat/v1/me", LcuEventType::Update, Value::Null)).unwrap(),
            RoutedEvent::Ignored
        );
        assert_eq!(
            route(&event(
                "/lol-ranked/v1/cached-ranked-stats/",
                LcuEventType::Update,
                serde_json::json!({})
            ))
            .unwrap(),
            RoutedEvent::Ignored
        );
        let dropped = route(&event(
            LOBBY_URI,
            LcuEventType::Update,
            serde_json::json!({"partyId": 5}),
        ))
        .unwrap_err();
        assert_eq!(dropped.uri, LOBBY_URI);
    }
}
