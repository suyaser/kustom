#!/usr/bin/env python3
"""Builds the navigation prototype pages. Not app code.

Option A: five tabs (Tonight, Board, Games, Stats, You), no More.
Option B: four tabs plus a Menu tab that opens a routed sheet (/g/<slug>/menu).
Run: python3 build.py, then serve redesign/ and open nav/prototype/*.html.
"""
from pathlib import Path

HERE = Path(__file__).parent

HEAD = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#1A1F29">
<title>{title} | Kustom</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&family=Atkinson+Hyperlegible+Next:wght@400..800&family=Martian+Mono:wdth,wght@75..112.5,400..700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../../prototypes/direction-c/c.css">
<link rel="stylesheet" href="nav.css">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
"""

ICON = {
    "tonight": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3v3M5.6 5.6l2.1 2.1M18.4 5.6l-2.1 2.1"/><path d="M4 21h16M7 21l2-9h6l2 9"/></svg>',
    "board": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 20V10h4v10M10 20V4h4v16M16 20v-7h4v7"/></svg>',
    "games": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9h16M4 14h16M9 4v16"/></svg>',
    "stats": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 20h8"/></svg>',
    "you": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.4-4 4.4-6 8-6s6.6 2 8 6"/></svg>',
    "menu": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
}
CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>'
DOWN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>'
X = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>'

A_TABS = [("tonight", "Tonight"), ("board", "Board"), ("games", "Games"), ("stats", "Stats"), ("you", "You")]
B_TABS = [("tonight", "Tonight"), ("board", "Board"), ("games", "Games"), ("menu", "More")]


def cur(flag):
    return ' aria-current="page"' if flag else ""


def topbar_a(current, signed_in=True):
    links = "".join(
        f'<a class="navlink" href="#"{cur(k == current)}>{label}</a>' for k, label in A_TABS if k != "you"
    )
    right = (
        f'<a class="tb-link" href="#">Admin</a><a class="tb-you" href="#"{cur(current == "you")}>{ICON["you"]}You</a>'
        if signed_in
        else f'<a class="tb-you" href="#"{cur(current == "you")}>{ICON["you"]}You</a><a class="btn btn--primary" href="#">Sign in</a>'
    )
    return f"""<header class="topbar"><div class="topbar-in">
<a class="wordmark" href="#" aria-label="Kustom, Customs Night tonight"><i></i>Kustom</a><span class="group-name">Customs Night</span>
<nav class="mainnav" aria-label="Main">{links}</nav>
<div class="tb-right">{right}</div>
</div></header>
"""


def tabbar_a(current, live=False):
    out = []
    for k, label in A_TABS:
        dot = '<span class="livedot"></span><span class="sr-only">, live</span>' if (live and k == "tonight") else ""
        out.append(f'<a class="tab" href="#"{cur(k == current)}>{ICON[k]}{label}{dot}</a>')
    return f'<nav class="tabbar tabbar--5" aria-label="Main">{"".join(out)}</nav>\n'


def menu_body():
    def row(label, sub=""):
        s = f"<small>{sub}</small>" if sub else ""
        return f'<a class="rowlink" href="#"><span>{label}{s}</span>{CHEV}</a>'

    return f"""
<div class="menu-sec"><h2 class="eyebrow">Numbers</h2>
{row("Stats", "Records, champions, 1v1")}
</div>
<div class="menu-sec"><h2 class="eyebrow">Play</h2>
{row("Daily", "Guess the Award #41, not guessed yet")}
{row("Mode", "Fearless, 138 open")}
</div>
<div class="menu-sec"><h2 class="eyebrow">You</h2>
{row("Your page", "TheSHADOWREAPER, 1342")}
{row("Admin", "Customs Night")}
<div class="setrow"><span>Theme</span><span class="toggle"><span>Day</span><span class="on">Night</span></span></div>
{row("Sign out")}
</div>
<div class="menu-sec"><h2 class="eyebrow">Kustom</h2>
{row("How the bot decides")}
{row("Get Kustom", "Windows, one PC is enough")}
</div>"""


def topbar_b(open_menu):
    more = f'<a class="navlink navmore" href="#" aria-expanded="{"true" if open_menu else "false"}"{" aria-current=page" if open_menu else ""}>More {DOWN}</a>'
    desk_menu = f'<div class="menu menu--desk" role="dialog" aria-label="More">{menu_body()}</div>' if open_menu else ""
    return f"""<header class="topbar"><div class="topbar-in">
<a class="wordmark" href="#"><i></i>Kustom</a><span class="group-name">Customs Night</span>
<nav class="mainnav" aria-label="Main"><a class="navlink" href="#"{"" if open_menu else " aria-current=page"}>Tonight</a><a class="navlink" href="#">Board</a><a class="navlink" href="#">Games</a><span style="position:relative;display:inline-flex">{more}{desk_menu}</span></nav>
<div class="tb-right"><a class="tb-you" href="#">{ICON["you"]}TheSHADOWREAPER</a></div>
</div></header>
"""


def tabbar_b(open_menu):
    out = []
    for k, label in B_TABS:
        c = cur(k == "menu") if open_menu else cur(k == "tonight")
        out.append(f'<a class="tab" href="#"{c}>{ICON[k]}{label}</a>')
    return f'<nav class="tabbar" aria-label="Main">{"".join(out)}</nav>\n'


FOOT = '<footer class="footer"><a href="#">How the bot decides</a><a href="#">Get Kustom</a></footer>\n'

TONIGHT_MAIN = """<main id="main" class="wrap"><div class="layout"><div class="stack" style="min-width:0">
<section class="card strip" aria-labelledby="h1">
  <div class="strip-top"><span class="meta">Sat 3 Oct, game <span class="num">4</span> tonight</span></div>
  <div class="strip-body"><h1 id="h1" class="headline">Game over</h1><p class="strip-sub">Ratings are updated. Next lobby when someone opens one.</p></div>
</section>
<section class="card result" aria-label="Result">
  <p class="eyebrow">30:34</p><p class="big">Red wins</p>
  <p class="reason">Red was <b class="num">51%</b>. Red won. MVP <b>Smolder Boulder</b>.</p>
</section>
<section class="card" aria-labelledby="yn"><div class="yn">
  <h2 id="yn" class="card-title">Your night</h2>
  <p class="line">3-1, <span class="num">+38</span>. Your Kai'Sa game was the cleanest thing anyone did all night.</p>
  <a class="link" href="#">Your page</a></div>
</section>
<a class="card modeline" href="#"><span><span class="eyebrow">Mode</span><br><b>Fearless</b> <span class="meta"><span class="num">138</span> open · <span class="num">34</span> banned</span></span>""" + CHEV.replace("<svg", '<svg width="20" height="20"') + """</a>
<section class="card daily" aria-labelledby="dl">
  <div><h2 id="dl" class="card-title">Daily: Guess the Award #41</h2><p>Most damage to objectives yesterday. Who was it?</p></div>
  <a class="btn btn--primary" href="#">Guess</a>
</section>
</div>
<aside class="rail"><section class="card"><div class="card-head"><h2 class="card-title">Top of the board</h2><span class="meta">This week</span></div>
<a class="board-row" href="#"><span class="n num">1</span><span class="nm">Smolder Boulder</span><span class="num">1342</span></a>
<a class="board-row" href="#"><span class="n num">2</span><span class="nm">Baron Nashor Lover</span><span class="num">1314</span></a>
<a class="board-row" href="#"><span class="n num">3</span><span class="nm">Lux Aeterna</span><span class="num">1314</span></a>
</section></aside></div></main>
"""

STATS_MAIN = """<main id="main" class="wrap"><div class="stack narrow">
<div><h1 class="ptitle">Stats</h1><p class="psub">Records, champions and who has whose number. Summoner's Rift customs.</p></div>
<nav class="seg-links" aria-label="Stats sections"><a href="#" aria-current="page">Records</a><a href="#">Champions</a><a href="#">1v1</a></nav>
<nav class="win-links" aria-label="Window"><a href="#" aria-current="page">This week</a><a href="#">This month</a><a href="#">All time</a></nav>
<div class="two">
<section class="card" aria-labelledby="r1"><div class="card-head"><h2 id="r1" class="card-title">One game</h2><span class="meta">best single game</span></div>
<div class="rec"><span class="what">Most damage</span><span></span><span class="who">Baron Nashor Lover</span><span class="val">41.2k</span><span class="ctx">Kai'Sa, Thu 1 Oct</span></div>
<div class="rec"><span class="what">Most vision</span><span></span><span class="who">Garen Teed</span><span class="val">88</span><span class="ctx">Thresh, Fri 2 Oct</span></div>
<div class="rec"><span class="what">Highest CS</span><span></span><span class="who">Kha Zixty</span><span class="val">312</span><span class="ctx">Kha'Zix, Sat 3 Oct</span></div>
</section>
<section class="card" aria-labelledby="r2"><div class="card-head"><h2 id="r2" class="card-title">Museums</h2><span class="meta">this week</span></div>
<a class="rowlink" href="#"><span>Pentakill Museum<small>1 piece: Teemo Tactics, Jinx</small></span>""" + CHEV + """</a>
<a class="rowlink" href="#"><span>First Blood Museum<small>Jinxed Lad, 4 of 9 games</small></span>""" + CHEV + """</a>
<a class="rowlink" href="#"><span>Death Hall of Fame<small>Mid or Feed, 14 deaths</small></span>""" + CHEV + """</a>
<a class="rowlink" href="#"><span>Won against the odds<small>Red at 38%, Thu 1 Oct</small></span>""" + CHEV + """</a>
</section>
</div></div></main>
"""

YOU_MAIN = """<main id="main" class="wrap"><div class="stack narrow">
<a class="adminbar" href="#"><span><b>Admin</b><small>You run Customs Night: members, Discord, hosts</small></span>""" + CHEV.replace("<svg", '<svg width="22" height="22"') + """</a>
<section class="card" aria-labelledby="h1"><div class="me">
  <p class="eyebrow">You in Customs Night</p>
  <div class="me-top"><h1 id="h1" class="me-name">TheSHADOWREAPER</h1><span class="sticker sticker--you">YOU</span></div>
  <div class="statline"><div class="stat"><b>1342</b><span>Rating, #1</span></div><div class="stat"><b>47-36</b><span>83 games</span></div><div class="stat"><b>+38</b><span>tonight</span></div></div>
  <a class="link" href="#">Your full page: trend, games, roles</a>
</div></section>
<div class="two">
<section class="card" aria-labelledby="vs"><div class="card-head"><h2 id="vs" class="card-title">You vs them</h2><span class="meta">all time</span></div>
<div class="vs-head"><span>Friend</span><span>With</span><span>Against</span></div>
<a class="vs" href="#"><span class="nm">Baron Nashor Lover</span><span class="rec2 num">9-3</span><span class="rec2 num">2-6</span><span class="ln">Owns you top: 1-4 in lane.</span></a>
<a class="vs" href="#"><span class="nm">Lux Aeterna</span><span class="rec2 num">12-3</span><span class="rec2 num">5-5</span><span class="ln">Your best duo.</span></a>
<a class="vs" href="#"><span class="nm">Mid or Feed</span><span class="rec2 num">4-6</span><span class="rec2 num">7-1</span><span class="ln">You have his number.</span></a>
<a class="rowlink" href="#"><span>Everyone (14)</span>""" + CHEV + """</a>
</section>
<div class="stack" style="margin:0">
<section class="card daily" aria-labelledby="dl"><div><h2 id="dl" class="card-title">Daily</h2><p>Guess the Award #41. Not guessed yet.</p></div><a class="btn btn--primary" href="#">Guess</a></section>
<section class="card" aria-labelledby="acct"><div class="card-head"><h2 id="acct" class="card-title">Account</h2></div>
<div class="setrow"><span>Signed in<small>Discord: yasser, linked to this League account</small></span></div>
<div class="setrow"><span>Theme</span><span class="toggle"><span>Day</span><span class="on">Night</span></span></div>
<a class="rowlink" href="#"><span>Sign out</span>""" + CHEV + """</a>
</section></div>
</div></div></main>
"""

YOU_ANON_MAIN = """<main id="main" class="wrap"><div class="stack narrow">
<section class="card" aria-labelledby="h1"><div class="me">
  <p class="eyebrow">You in Customs Night</p>
  <h1 id="h1" class="me-name">Sign in to see yourself</h1>
  <p class="psub">Everything here is public. Signing in shows it from where you stand.</p>
</div>
<ul class="unlocks">
<li>Your 83 games with this group, in one place</li>
<li>Your record with and against every friend</li>
<li>Start a lobby, see the password, pick your role for tonight</li>
</ul>
<div style="padding:0 16px 16px"><a class="btn btn--primary" href="#" style="width:100%">Sign in with Discord</a></div>
</section>
<section class="card" aria-labelledby="acct"><div class="card-head"><h2 id="acct" class="card-title">This device</h2></div>
<div class="setrow"><span>Theme</span><span class="toggle"><span>Day</span><span class="on">Night</span></span></div>
</section>
</div></main>
"""


def page_a(name, title, current, main, signed_in=True, live=False):
    html = HEAD.format(title=title) + topbar_a(current, signed_in) + tabbar_a(current, live) + main + FOOT + "</body></html>\n"
    (HERE / name).write_text(html)


def page_b(name, open_menu):
    phone_menu = (
        f"""<div class="menu-scrim"></div>
<div class="menu menu--phone" role="dialog" aria-modal="true" aria-labelledby="mt">
<div class="menu-bar"><b id="mt">Customs Night</b><a class="menu-close" href="#">{X}Close</a></div>
{menu_body()}
</div>
"""
        if open_menu
        else ""
    )
    html = (
        HEAD.format(title="More" if open_menu else "Tonight")
        + topbar_b(open_menu)
        + tabbar_b(open_menu)
        + TONIGHT_MAIN
        + FOOT
        + phone_menu
        + "<style>@media (min-width:1024px){.menu--phone,.menu-scrim{display:none}} @media (max-width:1023px){.menu--desk{display:none}} .menu--desk{position:absolute;top:100%;left:0}</style>"
        + "</body></html>\n"
    )
    (HERE / name).write_text(html)


page_a("a-tonight.html", "Tonight", "tonight", TONIGHT_MAIN, live=False)
page_a("a-stats.html", "Stats", "stats", STATS_MAIN)
page_a("a-you.html", "You", "you", YOU_MAIN)
page_a("a-you-signed-out.html", "You", "you", YOU_ANON_MAIN, signed_in=False)
page_b("b-closed.html", False)
page_b("b-open.html", True)
print("built")
