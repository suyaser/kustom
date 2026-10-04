//! M17.6 acceptance over the config trees in `tests/fixtures/config/` (synthetic, written by the TypeScript
//! engine's own writers; the user's real redacted 0.3.x tree joins them as `real-0.3-*`): groups and the
//! selection preserved, a top-level token filed under its `/me` group, a queued 0.3.x block replayed with
//! its own group's token, unknown keys surviving a write, the old-engine check stopping everything.

#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::SystemTime;

use engine::api::identity::IdentityOutcome;
use engine::api::transport::HttpRequest;
use engine::api::{ApiClient, ApiClientOptions};
use engine::config::startup::{Boot, BootDeps, BootState, boot};
use engine::config::state::{LEGACY_GROUP_ID, host_groups, read_state_owner};
use engine::config::{
    CompanionToken, LoadOutcome, ProcessProbe, config_path, fingerprint_of, load_config, set_last_group,
};
use engine::queue::read_queue;
use engine::test_support::{FakeTransport, TempDir, copy_tree, respond};
use serde_json::Value;

const CUSTOMS: &str = "11111111-1111-4111-8111-111111111111";
const WEEKEND: &str = "22222222-2222-4222-8222-222222222222";
const TOP_LEVEL_02: &str = "SYNTHETIC_topLevel02_xxxxxxxxxxxxxxxxxxxxxx";
const TOP_LEVEL_03: &str = "SYNTHETIC_topLevel03_xxxxxxxxxxxxxxxxxxxxxx";
const CUSTOMS_04: &str = "SYNTHETIC_customs04_xxxxxxxxxxxxxxxxxxxxxxx";
const WEEKEND_04: &str = "SYNTHETIC_weekend04_xxxxxxxxxxxxxxxxxxxxxxx";
const GAME: &str = "4000969091";

struct NoOldEngine;
impl ProcessProbe for NoOldEngine {
    fn processes(&self) -> Option<Vec<(String, u32)>> {
        Some(vec![("explorer.exe".into(), 1)])
    }
}

struct OldEngineUp;
impl ProcessProbe for OldEngineUp {
    fn processes(&self) -> Option<Vec<(String, u32)>> {
        Some(vec![("kustom-engine-x86_64-pc-windows-msvc.exe".into(), 4242)])
    }
}

fn fixture(name: &str) -> (TempDir, PathBuf) {
    let temp = TempDir::new(name);
    let dir = temp.path().join("customs-night");
    let from = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/config")
        .join(name);
    copy_tree(&from, &dir).unwrap();
    (temp, dir)
}

fn bearer(request: &HttpRequest) -> String {
    request
        .header("authorization")
        .and_then(|h| h.strip_prefix("Bearer "))
        .unwrap_or_default()
        .to_owned()
}

/// `/me` answers the group each token belongs to; any other route answers a game 2xx.
fn api_fake() -> Arc<FakeTransport> {
    FakeTransport::new(|request| {
        if request.url.ends_with("/api/companion/me") {
            let group = match bearer(request).as_str() {
                TOP_LEVEL_02 | TOP_LEVEL_03 | CUSTOMS_04 => (CUSTOMS, "customs", "Customs"),
                WEEKEND_04 => (WEEKEND, "weekend-crew", "Weekend Crew"),
                _ => return respond(401, r#"{"ok":false,"error":"Unknown companion token"}"#),
            };
            respond(
                200,
                &format!(
                    r#"{{"ok":true,"puuid":"34151cbd-d9f8-5dad-9dc8-c6a8e253c0de","playerId":"0b9f9a9e-1c1a-4d55-9f1e-6a3b1f0c2d11","displayName":"Host","group":{{"id":"{}","slug":"{}","name":"{}"}}}}"#,
                    group.0, group.1, group.2
                ),
            )
        } else {
            respond(
                200,
                r#"{"ok":true,"phase":"eog","created":true,"gameId":"5e0a2f8c-37a2-4a7e-9d0a-0c6c7e5b3f21","lobbyId":null,"participants":10}"#,
            )
        }
    })
}

fn deps(transport: Arc<FakeTransport>, probe: Arc<dyn ProcessProbe>) -> BootDeps {
    BootDeps {
        transport,
        probe,
        now: SystemTime::now(),
        version: "1.0.0".into(),
    }
}

fn raw(dir: &Path) -> Value {
    serde_json::from_str(&fs::read_to_string(config_path(dir)).unwrap()).unwrap()
}

fn ready(boot: &Boot) -> (&str, &Path, &IdentityOutcome) {
    match &boot.state {
        BootState::Ready {
            group,
            state_dir,
            identity,
        } => (group.group_id.as_str(), state_dir.as_path(), identity),
        other => panic!("not ready: {other:?}"),
    }
}

/// Replays every queued block in `state_dir` with `token`, as the queue (M17.9) will: the file parses as
/// the 0.3.x/0.4.0 format and its payload is re-sent exactly as written.
async fn replay(
    api_base: &str,
    state_dir: &Path,
    token: &CompanionToken,
    transport: Arc<FakeTransport>,
) -> Vec<Value> {
    let api = ApiClient::new(ApiClientOptions::new(api_base, Some(token.clone()), transport));
    let mut sent = Vec::new();
    let queued = read_queue(state_dir);
    assert!(!queued.is_empty(), "nothing queued in {}", state_dir.display());
    for game in queued {
        assert_eq!(game.file.version, 1);
        api.post_queued_game(&game.file.payload).await.unwrap();
        sent.push(game.file.payload);
    }
    sent
}

#[tokio::test]
async fn a_0_3_top_level_token_is_filed_under_its_me_group_and_its_queue_replays_with_that_token() {
    let (_temp, dir) = fixture("synthetic-0.3-host-tokenless-groups");
    let before = raw(&dir);
    let fake = api_fake();
    let boot = boot(&dir, &deps(fake.clone(), Arc::new(NoOldEngine))).await;

    // Filed under the group /me named; the root state moved with it.
    assert_eq!(boot.filed.as_ref().map(|g| g.id.as_str()), Some(CUSTOMS));
    let after = raw(&dir);
    assert!(after.get("companionToken").is_none());
    assert_eq!(after["groups"][0]["groupId"], CUSTOMS);
    assert_eq!(after["groups"][0]["companionToken"], TOP_LEVEL_03);
    assert!(
        after["groups"][1].get("companionToken").is_none(),
        "the overlay pairing stays tokenless"
    );
    // Everything else as it was: the selection, the unknown key, mode, lockfilePath, apiBase, key order.
    for key in ["lastGroupId", "someLaterKey", "mode", "lockfilePath", "apiBase"] {
        assert_eq!(after[key], before[key], "{key}");
    }
    let keys = |v: &Value| v.as_object().unwrap().keys().cloned().collect::<Vec<_>>();
    let mut expected = keys(&before);
    expected.retain(|k| k != "companionToken");
    assert_eq!(keys(&after), expected);
    assert!(
        dir.join("groups")
            .join(CUSTOMS)
            .join("queue")
            .join(format!("{GAME}.json"))
            .exists()
    );
    assert!(dir.join("groups").join(CUSTOMS).join("backfill.json").exists());
    assert!(!dir.join("queue").exists());

    // lastGroupId is the tokenless weekend group: the session runs on the one group with a token.
    let (group_id, state_dir, identity) = ready(&boot);
    assert_eq!(group_id, CUSTOMS);
    assert_eq!(state_dir, dir.join("groups").join(CUSTOMS));
    assert!(matches!(identity, IdentityOutcome::Ok { display_name: Some(name), .. } if name == "Host"));
    // One /me for the filing, reused for the session (same token).
    assert_eq!(fake.requests().len(), 1);

    // The queued 0.3.x block posts with its own group's token, byte for byte as queued.
    let token = CompanionToken::parse(TOP_LEVEL_03).unwrap();
    let sent = replay(&boot.config.api_base, state_dir, &token, fake.clone()).await;
    let post = fake.requests().last().cloned().unwrap();
    assert_eq!(bearer(&post), TOP_LEVEL_03);
    assert_eq!(post.url, "https://customs-night.vercel.app/api/companion/game");
    assert_eq!(
        serde_json::from_slice::<Value>(post.body.as_deref().unwrap()).unwrap(),
        sent[0]
    );
}

#[tokio::test]
async fn a_0_3_block_with_an_extra_key_is_replayed_verbatim_not_dropped() {
    let (_temp, dir) = fixture("synthetic-0.3-host-tokenless-groups");
    let path = dir.join("queue").join(format!("{GAME}.json"));
    let mut file: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    file["payload"]["keyOnlyAnOlderEngineSent"] = serde_json::json!({ "kept": true });
    file["payload"]["participants"][0]["perParticipantExtra"] = Value::from(7);
    file["writtenBy"] = Value::from("0.3.9");
    fs::write(&path, serde_json::to_string_pretty(&file).unwrap()).unwrap();

    let fake = api_fake();
    let boot = boot(&dir, &deps(fake.clone(), Arc::new(NoOldEngine))).await;
    let (_, state_dir, _) = ready(&boot);
    let token = CompanionToken::parse(TOP_LEVEL_03).unwrap();
    let sent = replay(&boot.config.api_base, state_dir, &token, fake.clone()).await;
    assert_eq!(sent, [file["payload"].clone()]);
    let post = fake.requests().last().cloned().unwrap();
    assert_eq!(
        serde_json::from_slice::<Value>(post.body.as_deref().unwrap()).unwrap(),
        file["payload"],
        "posted exactly as queued, extra keys and all"
    );
    assert!(!state_dir.join("queue").join("quarantine").exists());
}

#[tokio::test]
async fn a_0_2_install_files_its_token_and_moves_every_root_file() {
    let (_temp, dir) = fixture("synthetic-0.2-top-level");
    let boot = boot(&dir, &deps(api_fake(), Arc::new(NoOldEngine))).await;
    assert_eq!(boot.filed.as_ref().map(|g| g.id.as_str()), Some(CUSTOMS));
    let group_dir = dir.join("groups").join(CUSTOMS);
    for name in ["queue", "backfill.json", "commands-done.json"] {
        assert!(group_dir.join(name).exists(), "{name}");
        assert!(!dir.join(name).exists(), "{name}");
    }
    let after = raw(&dir);
    assert_eq!(after["mode"], "host");
    assert_eq!(after["lastGroupId"], CUSTOMS);
    let (group_id, state_dir, _) = ready(&boot);
    assert_eq!((group_id, state_dir), (CUSTOMS, group_dir.as_path()));
}

#[tokio::test]
async fn offline_the_top_level_token_keeps_posting_from_the_root() {
    let (_temp, dir) = fixture("synthetic-0.2-top-level");
    let before = fs::read_to_string(config_path(&dir)).unwrap();
    let offline = FakeTransport::new(|_| Err("connect failed: Connection refused".into()));
    let boot = boot(&dir, &deps(offline.clone(), Arc::new(NoOldEngine))).await;
    assert_eq!(boot.filed, None);
    assert_eq!(
        fs::read_to_string(config_path(&dir)).unwrap(),
        before,
        "nothing written"
    );
    let (group_id, state_dir, identity) = ready(&boot);
    assert_eq!(group_id, LEGACY_GROUP_ID);
    assert_eq!(state_dir, dir.as_path());
    assert!(matches!(identity, IdentityOutcome::Unavailable { .. }));
    // The root is now on record as this token's, so no later token can claim its queue.
    assert_eq!(read_state_owner(&dir), Some(fingerprint_of(TOP_LEVEL_02)));
    assert_eq!(offline.requests().len(), 1);
}

#[tokio::test]
async fn an_overlay_install_opens_on_link_and_writes_nothing() {
    let (_temp, dir) = fixture("synthetic-0.3-overlay");
    let before = fs::read_to_string(config_path(&dir)).unwrap();
    let fake = api_fake();
    let boot = boot(&dir, &deps(fake.clone(), Arc::new(NoOldEngine))).await;
    assert_eq!(boot.state, BootState::NeedsLink);
    assert_eq!(boot.config.legacy_mode.as_deref(), Some("overlay"));
    assert_eq!(boot.config.groups.len(), 1, "the overlay group is read");
    assert!(boot.groups.is_empty(), "and not shown: it cannot host");
    assert!(fake.requests().is_empty());
    assert_eq!(fs::read_to_string(config_path(&dir)).unwrap(), before);
}

#[tokio::test]
async fn a_0_4_install_keeps_its_groups_and_selection_and_each_queue_its_own_token() {
    let (_temp, dir) = fixture("synthetic-0.4-groups");
    let before = fs::read_to_string(config_path(&dir)).unwrap();
    let fake = api_fake();
    let boot = boot(&dir, &deps(fake.clone(), Arc::new(NoOldEngine))).await;
    assert_eq!(
        fs::read_to_string(config_path(&dir)).unwrap(),
        before,
        "nothing to migrate, nothing written"
    );
    let ids: Vec<&str> = boot.groups.iter().map(|g| g.group_id.as_str()).collect();
    assert_eq!(ids, [CUSTOMS, WEEKEND]);
    let (group_id, state_dir, identity) = ready(&boot);
    assert_eq!(group_id, WEEKEND, "lastGroupId");
    assert_eq!(state_dir, dir.join("groups").join(WEEKEND));
    assert!(matches!(identity, IdentityOutcome::Ok { group: Some(g), .. } if g.id == WEEKEND));
    assert_eq!(bearer(&fake.requests()[0]), WEEKEND_04);

    // The block queued for Customs goes out with Customs' token, never Weekend's.
    let customs = boot.groups.iter().find(|g| g.group_id == CUSTOMS).unwrap();
    replay(
        &boot.config.api_base,
        &dir.join("groups").join(CUSTOMS),
        &customs.token,
        fake.clone(),
    )
    .await;
    assert_eq!(bearer(fake.requests().last().unwrap()), CUSTOMS_04);
}

#[tokio::test]
async fn unknown_keys_survive_a_write_on_every_shape() {
    for name in [
        "synthetic-0.2-top-level",
        "synthetic-0.3-host-tokenless-groups",
        "synthetic-0.3-overlay",
        "synthetic-0.4-groups",
    ] {
        let (_temp, dir) = fixture(name);
        let mut before = raw(&dir);
        before
            .as_object_mut()
            .unwrap()
            .insert("aKeyFromTheFuture".into(), serde_json::json!({ "x": [1] }));
        fs::write(config_path(&dir), serde_json::to_string_pretty(&before).unwrap()).unwrap();
        set_last_group(&dir, CUSTOMS).unwrap();
        let mut after = raw(&dir);
        assert_eq!(after["lastGroupId"], CUSTOMS, "{name}");
        after.as_object_mut().unwrap().shift_remove("lastGroupId");
        before.as_object_mut().unwrap().shift_remove("lastGroupId");
        assert_eq!(after, before, "{name}");
        // And it still reads the same groups.
        let LoadOutcome::Loaded(config) = load_config(&dir) else {
            panic!("{name}")
        };
        assert_eq!(
            host_groups(&config).len(),
            match name {
                "synthetic-0.3-overlay" => 0,
                "synthetic-0.4-groups" => 2,
                _ => 1,
            }
        );
    }
}

#[tokio::test]
async fn an_old_engine_still_running_stops_everything() {
    let (_temp, dir) = fixture("synthetic-0.3-host-tokenless-groups");
    let before = fs::read_to_string(config_path(&dir)).unwrap();
    let fake = api_fake();
    let boot = boot(&dir, &deps(fake.clone(), Arc::new(OldEngineUp))).await;
    assert!(matches!(boot.state, BootState::OldEngineRunning { .. }));
    assert!(fake.requests().is_empty(), "no /me");
    assert_eq!(fs::read_to_string(config_path(&dir)).unwrap(), before, "no write");
    assert!(
        dir.join("queue").join(format!("{GAME}.json")).exists(),
        "the root queue is untouched"
    );

    // Retry after the old one is closed: the start goes ahead.
    let boot = boot_again(&dir, fake).await;
    assert_eq!(ready(&boot).0, CUSTOMS);
}

async fn boot_again(dir: &Path, fake: Arc<FakeTransport>) -> Boot {
    boot(dir, &deps(fake, Arc::new(NoOldEngine))).await
}

#[tokio::test]
async fn an_unreadable_config_is_left_alone() {
    let temp = TempDir::new("boot-unreadable");
    fs::write(config_path(temp.path()), "{ \"companionToken\": ").unwrap();
    let fake = api_fake();
    let boot = boot(temp.path(), &deps(fake.clone(), Arc::new(NoOldEngine))).await;
    assert!(matches!(boot.state, BootState::ConfigUnreadable { .. }));
    assert_eq!(
        fs::read_to_string(config_path(temp.path())).unwrap(),
        "{ \"companionToken\": "
    );
    assert!(fake.requests().is_empty());
}

#[tokio::test]
async fn a_fresh_install_opens_on_link() {
    let temp = TempDir::new("boot-fresh");
    let boot = boot(temp.path(), &deps(api_fake(), Arc::new(NoOldEngine))).await;
    assert_eq!(boot.state, BootState::NeedsLink);
    assert!(!config_path(temp.path()).exists());
}
