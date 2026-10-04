//! Prints the window's view model for every state in 05-design §9.9's screenshot list, as one JSON object
//! `{ "<name>": { "view": View, "tray": TrayModel? } }`. The static harness (`desktop/harness/`) paints each
//! one at 400 × 690 for the designer's sign-off. `cargo run -p kustom-companion --example screens`.
//!
//! Times: `at` values are the placeholders `@TODAY`, `@YESTERDAY`, `@OLDER`; the harness swaps them for
//! real times so the Intl formatting shows each case.

use std::collections::BTreeMap;
use std::path::PathBuf;

use engine::api::wire::Side;
use engine::config::state::LastPosted;
use kustom_companion_lib::link::LinkAnswer;
use kustom_companion_lib::model::{
    FolderAnswer, FolderOrigin, HostGroup, LastGame, LeagueLink, Model, OldEngine, TrayModel, UpdateState,
    tray, view,
};
use serde_json::{Value, json};

fn group(id: &str, name: &str) -> HostGroup {
    HostGroup {
        id: id.into(),
        slug: id.into(),
        name: name.into(),
    }
}

fn base() -> Model {
    let mut m = Model::new("1.0.0");
    m.autostart = true;
    m.api_base = "https://kustom.example".into();
    m
}

fn league_open(m: &mut Model, phase: Option<&str>) {
    m.league.link = LeagueLink::Connected;
    m.league.signed_in = true;
    m.league.phase = phase.map(str::to_owned);
}

fn home() -> Model {
    let mut m = base();
    m.groups = vec![group("g1", "Customs Night")];
    m.current = Some("g1".into());
    m.league.link = LeagueLink::NotRunning;
    m.league.folder = Some(PathBuf::from(r"C:\Riot Games\League of Legends"));
    m.last_game = LastGame::Posted(LastPosted {
        at: "@TODAY".into(),
        winning_side: Side::Red,
        duration_s: 1860,
    });
    m
}

fn two_groups() -> Model {
    let mut m = home();
    m.groups.push(group("g2", "Tuesday Crew"));
    m
}

fn cant_find() -> Model {
    let mut m = home();
    m.league.folder = None;
    m.last_game = LastGame::None;
    m
}

fn tray_json(t: &TrayModel) -> Value {
    json!({
        "line1": t.line1,
        "line2": t.line2,
        "groups": t.groups.as_ref().map(|g| g.iter().map(|g| json!({"label": g.label, "checked": g.checked})).collect::<Vec<_>>()),
        "autostart": t.autostart,
        "restart": t.restart,
        "tooltip": t.tooltip,
        "notRecording": t.not_recording,
    })
}

fn main() {
    let mut out: BTreeMap<String, Value> = BTreeMap::new();
    let mut put = |name: &str, m: &Model| {
        out.insert(
            name.to_owned(),
            json!({ "view": view(m), "tray": tray_json(&tray(m)) }),
        );
    };

    // Link (9.4)
    let mut m = base();
    league_open(&mut m, Some("None"));
    put("l1-idle", &m);
    put("l2-league-closed", &base());
    let mut l3 = m.clone();
    l3.link.code = "K7MQ2X".into();
    l3.link.busy = true;
    put("l3-linking", &l3);
    let mut l4 = m.clone();
    l4.link.code = "K7M".into();
    l4.set_link_answer(Some(LinkAnswer::TooShort));
    put("l4-too-short", &l4);
    let mut l5 = m.clone();
    l5.link.code = "K7".into();
    l5.link.look_alike = true;
    put("l5-look-alike", &l5);
    let mut l6 = m.clone();
    l6.link.code = "K7MQ2X".into();
    l6.set_link_answer(Some(LinkAnswer::Refused(
        "That code ran out. Get a new one where you got this one.".into(),
    )));
    put("l6-refused", &l6);
    let mut l7 = m.clone();
    l7.autostart = false; // M17.19: a hostRefusal turns Start with Windows off
    l7.set_link_answer(Some(LinkAnswer::Member(
        "You're in. Only admins can host. Ask an admin to host, or to make you one.".into(),
    )));
    put("l7-member", &l7);
    let mut l8 = m.clone();
    l8.link.code = "K7MQ2X".into();
    l8.set_link_answer(Some(LinkAnswer::Network));
    put("l8-network", &l8);
    let mut l8s = l8.clone();
    l8s.set_link_answer(Some(LinkAnswer::Server));
    put("l8-server", &l8s);
    let mut l8b = l8.clone();
    l8b.set_link_answer(Some(LinkAnswer::LeagueGone));
    put("l8b-league-gone", &l8b);
    let mut l8c = m.clone();
    l8c.set_link_answer(Some(LinkAnswer::SaveFailed));
    put("l8c-save-failed", &l8c);
    let mut l9 = home();
    league_open(&mut l9, Some("None"));
    l9.refused = Some("This Kustom isn't linked any more. Link it again with a new code.".into());
    put("l9-again", &l9);
    let mut l10 = two_groups();
    league_open(&mut l10, Some("None"));
    l10.link_open = true;
    put("l10-another", &l10);

    // Home (9.5)
    let mut h = home();
    league_open(&mut h, Some("None"));
    put("home-one-group", &h);
    let mut h2 = two_groups();
    league_open(&mut h2, Some("Lobby"));
    put("home-two-groups", &h2);
    let mut pending = two_groups();
    league_open(&mut pending, Some("InProgress"));
    pending.switch.pending = Some("g2".into());
    put("home-pending-switch", &pending);
    let mut switching = two_groups();
    league_open(&mut switching, Some("None"));
    switching.switch.switching = true;
    put("home-switching", &switching);
    let mut linked = home();
    league_open(&mut linked, Some("None"));
    linked.linked_line = true;
    linked.last_game = LastGame::None;
    put("home-just-linked", &linked);

    put("league-not-open", &home());
    for (name, phase, custom) in [
        ("league-open", Some("None"), None),
        ("league-lobby", Some("Lobby"), None),
        ("league-champ-select", Some("ChampSelect"), None),
        ("league-custom-game", Some("InProgress"), Some(true)),
        ("league-other-game", Some("InProgress"), Some(false)),
        ("league-game-over", Some("EndOfGame"), Some(true)),
    ] {
        let mut m = home();
        league_open(&mut m, phase);
        m.league.custom = custom;
        put(name, &m);
    }

    // Can't find League (9.5.6)
    put("cantfind-idle", &cant_find());
    let mut looking = cant_find();
    looking.folder.busy = Some(FolderOrigin::TryAgain);
    put("cantfind-looking", &looking);
    let mut checking = cant_find();
    checking.folder.busy = Some(FolderOrigin::Browse);
    put("cantfind-checking", &checking);
    let mut still = cant_find();
    still.folder.answer = Some((FolderOrigin::TryAgain, FolderAnswer::StillNotFound));
    put("cantfind-still-not-found", &still);
    let mut miss = cant_find();
    miss.folder.answer = Some((FolderOrigin::Browse, FolderAnswer::Miss));
    put("cantfind-miss", &miss);
    let mut two = cant_find();
    two.groups.push(group("g2", "Tuesday Crew"));
    put("cantfind-idle-two-groups", &two);
    let mut two_miss = two.clone();
    two_miss.folder.answer = Some((FolderOrigin::Browse, FolderAnswer::Miss));
    put("cantfind-miss-two-groups", &two_miss);
    let mut two_save = two.clone();
    two_save.folder.answer = Some((FolderOrigin::Browse, FolderAnswer::SaveFailed));
    put("cantfind-save-failed", &two_save);
    let mut found = cant_find();
    let path = PathBuf::from(r"D:\Games\Riot Games\League of Legends");
    found.league.folder = Some(path.clone());
    found.folder.answer = Some((FolderOrigin::Browse, FolderAnswer::Found(path)));
    put("cantfind-found", &found);
    let mut change_miss = home();
    change_miss.folder.answer = Some((FolderOrigin::Change, FolderAnswer::Miss));
    put("folder-row-change-miss", &change_miss);
    put("folder-row-path", &home());
    put("folder-row-not-set", &cant_find());

    // Last game (9.5.3)
    for (name, last) in [
        (
            "last-today",
            LastGame::Posted(LastPosted {
                at: "@TODAY".into(),
                winning_side: Side::Red,
                duration_s: 1860,
            }),
        ),
        (
            "last-yesterday",
            LastGame::Posted(LastPosted {
                at: "@YESTERDAY".into(),
                winning_side: Side::Blue,
                duration_s: 1680,
            }),
        ),
        (
            "last-older",
            LastGame::Posted(LastPosted {
                at: "@OLDER".into(),
                winning_side: Side::Blue,
                duration_s: 2040,
            }),
        ),
        ("last-queued", LastGame::Queued { at: "@TODAY".into() }),
        ("last-none", LastGame::None),
    ] {
        let mut m = home();
        league_open(&mut m, Some("None"));
        m.last_game = last;
        put(name, &m);
    }

    // Update (9.5.4)
    let mut up = two_groups();
    league_open(&mut up, Some("None"));
    up.update = UpdateState::Ready {
        version: "1.0.3".into(),
    };
    put("update-ready", &up);
    let mut up_one = home();
    league_open(&mut up_one, Some("None"));
    up_one.update = UpdateState::Ready {
        version: "1.0.3".into(),
    };
    put("update-ready-one-group", &up_one);
    let mut guarded = up.clone();
    league_open(&mut guarded, Some("InProgress"));
    guarded.update = UpdateState::Scheduled {
        version: "1.0.3".into(),
    };
    put("update-guarded", &guarded);
    let mut tallest = up.clone();
    tallest.groups[0].name = "The Thursday Night Customs Crew of Menaçe".into();
    put("home-tallest", &tallest);
    let mut restarting = up.clone();
    restarting.update = UpdateState::Restarting;
    put("restarting", &restarting);

    // Old engine (9.6)
    let mut old = base();
    old.old_engine = Some(OldEngine::default());
    put("old-engine", &old);
    old.old_engine = Some(OldEngine {
        checking: false,
        still_running: true,
    });
    put("old-engine-still-running", &old);

    // Tray (9.7)
    let mut tray_two = two_groups();
    league_open(&mut tray_two, Some("InProgress"));
    tray_two.league.custom = Some(true);
    put("tray-two-groups", &tray_two);
    let mut tray_update = tray_two.clone();
    tray_update.update = UpdateState::Ready {
        version: "1.0.3".into(),
    };
    tray_update.switch.pending = Some("g2".into());
    put("tray-update", &tray_update);

    println!("{}", serde_json::to_string_pretty(&out).unwrap_or_default());
}
