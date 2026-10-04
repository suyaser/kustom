#!/usr/bin/env python3
"""Generates the static Direction C prototype pages from one set of components.
Started from direction-a/build.py; data and the answer line follow direction-b.

Run: python3 build.py  (writes balanced, ingame, filling, receipt, balanced-day, index .html)
Add ?shot to a URL to park the phone tab bar at the end of the page for full-page screenshots.
"""
from pathlib import Path

OUT = Path(__file__).parent

# ---------------------------------------------------------------- data (same people as A and B)
BLUE = [  # role, name, rating, champion, initials, settling
    ("top", "FoxHound", 1224, "Ornn", "OR", None),
    ("jungle", "XETA", 1378, "Vi", "VI", None),
    ("mid", "Ramzyinhović", 2638, "Ahri", "AH", None),
    ("adc", "SugarPapy", 1218, "Jinx", "JX", None),
    ("support", "Used2BeATahmMain", 1322, "Nautilus", "NA", None),
]
RED = [
    ("top", "H4RDC0R33", 1531, "Darius", "DA", None),
    ("jungle", "Syndrome Axes", 2291, "Lee Sin", "LS", None),
    ("mid", "knifiy", 1454, "Syndra", "SY", None),
    ("adc", "PRT Khokha", 1287, "Caitlyn", "CA", None),
    ("support", "TheSHADOWREAPER", 1262, "Thresh", "TH", "9/10"),
]
YOU = "TheSHADOWREAPER"
P_BLUE, P_RED = 49, 51
FILLING = [  # name, main role, joined
    ("Raafat", "top", "9:12"),
    ("7ambolyy", "mid", "9:13"),
    ("Chaos", "adc", "9:15"),
    ("knifiy", "mid", "9:18"),
    ("H4RDC0R33", "top", "9:20"),
    ("TheSHADOWREAPER", "adc", "9:21"),
]
BOARD = [("Ramzyinhović", 2638), ("Syndrome Axes", 2291), ("Raafat", 1915), ("7ambolyy", 1894), ("Chaos", 1718)]
TAPE = [  # game, winner, line, minutes, mvp
    (3, "red", "Blue was 53%. Red won.", 31, "Syndrome Axes"),
    (2, "blue", "Blue was 48%. Blue won.", 24, "Ramzyinhović"),
    (1, "blue", "Blue was 51%. Blue won.", 27, "Raafat"),
]
LAST = [
    (6, "red", "Red was 50%. Red won.", 29, "Chaos"),
    (5, "blue", "Blue was 52%. Blue won.", 34, "Raafat"),
    (4, "red", "Red was 47%. Red won. Upset!", 22, "7ambolyy"),
]

# ---------------------------------------------------------------- icons (A's role set)
ROLE_SVG = {
    "top": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 4h9v3H7v6H4z" fill="currentColor" stroke="none"/></svg>',
    "jungle": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M7 20c0-7 2-12 5-16 3 4 5 9 5 16"/><path d="M12 9v11M9 14l3 2 3-2"/></svg>',
    "mid": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M6.5 17.5l11-11" stroke-width="3"/></svg>',
    "adc": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M20 20h-9v-3h6v-6h3z" fill="currentColor" stroke="none"/></svg>',
    "support": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M12 8v8M8.5 12h7"/></svg>',
}
ROLE_WORD = {"top": "top", "jungle": "jungle", "mid": "mid", "adc": "bot", "support": "support"}
# design-system 3.3: blue = bottom-left triangle (its base on the map), red = top-right triangle
GLYPH = {
    "blue": '<svg class="glyph" viewBox="0 0 14 14" aria-hidden="true"><path d="M1 1V13H13z" fill="var(--team-blue)"/></svg>',
    "red": '<svg class="glyph" viewBox="0 0 14 14" aria-hidden="true"><path d="M1 1H13V13z" fill="var(--team-red)"/></svg>',
}
CHEVRON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>'
BENCH = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M6 20v-6h12v6M8 14V8h8v6M4 20h16"/></svg>'
TAB_SVG = {
    "Tonight": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3v3M5.6 5.6l2.1 2.1M18.4 5.6l-2.1 2.1"/><path d="M4 21h16M7 21l2-9h6l2 9"/></svg>',
    "Board": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 20V10h4v10M10 20V4h4v16M16 20v-7h4v7"/></svg>',
    "Games": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9h16M4 14h16M9 4v16"/></svg>',
    "More": '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5.5" cy="12.5" r="1.8"/><circle cx="12" cy="12.5" r="1.8"/><circle cx="18.5" cy="12.5" r="1.8"/></svg>',
}
NAV = ["Tonight", "Board", "Games", "More"]


def fmt(n):
    return f"{n:,}"


# ---------------------------------------------------------------- chrome
def header():
    nav = "".join(f'<a class="navlink" href="#"{" aria-current=page" if n == "Tonight" else ""}>{n}</a>' for n in NAV)
    return f"""
<header class="topbar">
  <div class="topbar-in">
    <a class="wordmark" href="#" aria-label="Kustom home"><i></i>Kustom</a>
    <a class="group-switch" href="#" aria-label="Group: Customs Night. Switch group">Customs Night {CHEVRON}</a>
    <nav class="mainnav" aria-label="Main">{nav}</nav>
    <a class="avatar" href="#" aria-label="Your account, TheSHADOWREAPER">TS</a>
  </div>
</header>"""


def tabbar():
    tabs = "".join(
        f'<a class="tab" href="#"{" aria-current=page" if n == "Tonight" else ""}>{TAB_SVG[n]}{n}'
        f'{"<span class=livedot></span><span class=sr-only>, live</span>" if n == "Tonight" else ""}</a>'
        for n in NAV
    )
    return f'<nav class="tabbar" aria-label="Main, phone">{tabs}</nav>'


def you_sticker():
    return '<span class="sticker sticker--you">YOU</span>'


def sidepill(side):
    return f'<span class="sidepill sidepill--{side}">{GLYPH[side]}{side.upper()}</span>'


def strip(meta, headline, sub, answer, extra=""):
    return f"""
<section class="card strip" aria-labelledby="h1">
  <div class="strip-top"><span class="live"><span class="dot"></span>Live</span><span class="meta">{meta}</span></div>
  <div class="strip-body">
    <h1 id="h1" class="headline">{headline}</h1>
    <p class="strip-sub">{sub}</p>{extra}
  </div>
  <div class="answer">{answer}</div>
</section>"""


ANSWER = f'{you_sticker()}<span>on</span><span style="display:inline-flex;align-items:center">{sidepill("red")}<span>,</span></span><span>playing support</span>'


# ---------------------------------------------------------------- team card
def seat(side, row, champs):
    role, name, rating, champ, initials, settling = row
    you = name == YOU
    tags = (you_sticker() + '<span class="sr-only">(you)</span>' if you else "")
    if settling:
        tags += f'<span class="settling">settling · {settling}</span>'
    left = (
        f'<div class="champ" aria-hidden="true">{initials}</div>'
        if champs
        else f'<div class="role">{ROLE_SVG[role]}<span>{ROLE_WORD[role]}</span></div>'
    )
    meta = f'<div class="pmeta">{champ}, {ROLE_WORD[role]}</div>' if champs else ""
    return f"""
    <li class="seat{' seat--you' if you else ''}"{' id="seat-you"' if you else ''}>
      {left}
      <div class="who"><div class="pname">{name}</div>{meta}<div class="ptags">{tags}</div></div>
      <div class="rating"><span class="sr-only">rating </span>{rating}</div>
    </li>"""


def team(side, rows, champs=False):
    word = side.upper()
    mine = any(r[1] == YOU for r in rows)
    seats = "".join(seat(side, r, champs) for r in rows)
    return f"""
<section class="team team--{side}" aria-labelledby="t-{side}">
  <div class="thead">
    <span class="tblock">{GLYPH[side]}</span>
    <h2 id="t-{side}" class="tname">{word}<span class="sr-only"> team</span></h2>
    {'<span class="yourside">Your side</span>' if mine else ''}
  </div>
  <ol>{seats}</ol>
</section>"""


# ---------------------------------------------------------------- fairness receipt (STRATEGY 4 final spec)
def winbar(b=P_BLUE, r=P_RED):
    return f"""
    <div class="wbar" aria-hidden="true">
      <div class="seg seg--b" style="flex:{b}">{GLYPH['blue']}<span>BLUE</span><span class="num">{b}%</span></div>
      <div class="seg seg--r" style="flex:{r}"><span class="num">{r}%</span><span>RED</span>{GLYPH['red']}</div>
      <i class="tick"></i>
    </div>
    <p class="sr-only">Blue {b} percent, Red {r} percent.</p>"""


VERDICT = "Basically a coin flip."
REASON = ("Next best: swap the bot lane players, <b>SugarPapy</b> and <b>PRT Khokha</b>. "
          'That&rsquo;s Blue <span class="num">52%</span>, with a bigger rating gap '
          '(<span class="num">93</span> vs <span class="num">45</span> pts).')
CHIPS = """
    <div class="chips">
      <span class="chip">Rating gap <b>45 pts</b></span>
      <span class="chip">Main roles <b>10/10</b></span>
      <span class="chip">Bot&rsquo;s pick <b>#1 of 3</b></span>
    </div>"""


def splits_panel():
    cards = [
        (1, True, "Red 51%", 49, 51, "45", "0", "These teams.", None),
        (2, False, "Blue 52%", 52, 48, "93", "0", "Swap the bot lane players, SugarPapy and PRT Khokha.",
         "Ranked lower: a bigger rating gap (93 vs 45 pts)."),
        (3, False, "Even 50%", 50, 50, "31", "2", "Swap XETA (jungle) and knifiy (mid).",
         "Closer odds, but ranked lower: 2 more people off their main role."),
    ]
    out = []
    for no, picked, odds, b, r, gap, off, change, why in cards:
        out.append(f"""
      <li class="split{' split--picked' if picked else ''}">
        <div class="split-head"><span class="split-no">#{no}</span>{'<span class="sticker sticker--you" style="transform:none">In play</span>' if picked else f'<span class="split-odds">{odds}</span>'}</div>
        {f'<div class="split-odds" style="margin-top:6px">{odds}</div>' if picked else ''}
        <div class="mini" aria-hidden="true"><span class="b" style="flex:{b}"></span><span class="r" style="flex:{r}"></span><i class="t"></i></div>
        <div class="kvs">
          <div class="kv">Rating gap<b>{gap} pts</b></div>
          <div class="kv">Off main role<b>{off}</b></div>
        </div>
        <p class="pmeta" style="margin-top:8px;color:var(--foreground)">{change}</p>
        {f'<p class="why">{why}</p>' if why else ''}
      </li>""")
    return f"""
  <div class="how-body">
    <p>The bot tried all <span class="num">126</span> ways to split these ten into two teams of five. For each one it put everyone in their best lane and scored it: the rating gap between the teams, plus a cost for every player off their main role (bigger if they were filled last game), plus a nudge against repeating last game&rsquo;s teams. Lowest score wins. Here are its top three:</p>
    <ol class="splits">{''.join(out)}</ol>
    <p class="note"><b>Why win chance and rating gap can disagree</b>Win chance also counts how sure the bot is about each player, so a team of new faces is harder to call. The rating gap is what the bot balances on, with a cut for anyone off their main role.</p>
    <p class="note"><b>Nobody picked these teams</b>Admins can tap Roll teams and Reroll (which moves to the next pick on this list), and nothing else. Nobody can hand-edit a rating; ratings only move when a game ends.</p>
    <p class="botnote">The bot&rsquo;s note: Red favored 51%. Everyone on a main role. Gap 45. Next best: swap SugarPapy and PRT Khokha, gap 93.</p>
    <div class="calib">
      <p style="font-weight:700">The side the bot favored won <span class="num">58</span> of <span class="num">103</span> games (<span class="num">56%</span>). It expected about <span class="num">55%</span>.</p>
      <div class="calib-bars" aria-hidden="true">
        <span>Won</span><span class="track"><span class="fill" style="width:56%"></span></span><span class="num">56%</span>
        <span>Expected</span><span class="track"><span class="fill fill--exp" style="width:55%"></span></span><span class="num">55%</span>
      </div>
      <p class="pmeta">The odds are honest when those two numbers are close.</p>
    </div>
    <a class="link" href="#">More on how it works</a>
  </div>"""


def receipt(variant="full", open_=False):
    compact = variant == "compact"
    title = "Odds at kickoff" if compact else "Win chance"
    body = (
        f'<p class="verdict">{VERDICT}</p>{CHIPS}'
        if compact
        else f'<p class="verdict">{VERDICT}</p><p class="reason">{REASON}</p>{CHIPS}'
    )
    cap = "" if compact else '<div class="bar-cap">The center line marks 50/50</div>'
    return f"""
<section class="card receipt{' receipt--compact' if compact else ''}" aria-labelledby="fr">
  <div class="receipt-in">
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px">
      <h2 id="fr" class="card-title">{title}</h2><span class="meta">Game <span class="num">4</span></span>
    </div>
    {winbar()}
    {cap}
    {body}
  </div>
  <details class="how"{' open' if open_ else ''}><summary>How the bot decided {CHEVRON}</summary>{splits_panel()}</details>
</section>"""


SITTING = f"""
<section class="card sitout" aria-label="Sitting out">{BENCH}
  <p><b>Chaos</b> sits this one out. Whoever has played least tonight sits out, so Chaos is first in line for game <span class="num">5</span>.</p>
</section>"""


# ---------------------------------------------------------------- rail
def rail(title="Tonight&rsquo;s tape", tape=TAPE, count="3 played"):
    tiles = "".join(
        f"""
      <li><a class="tile" href="#">
        <span class="tside tside--{w}">{GLYPH[w]}{w.upper()}</span>
        <span style="min-width:0">
          <span class="tile-top"><b>Game <span class="num">{g}</span></b><span class="meta num" style="font-size:14px">{m} min</span></span>
          <p>{line.replace('%', '%')}</p>
          <span class="mvp"><span class="sticker sticker--mvp">MVP</span>{mvp}</span>
        </span>
      </a></li>"""
        for g, w, line, m, mvp in tape
    )
    board = "".join(
        f'<a class="board-row" href="#"><span class="n num">{i}</span><span class="nm">{n}</span><span class="rating" style="padding:0">{r}</span></a>'
        for i, (n, r) in enumerate(BOARD, 1)
    )
    return f"""
<aside class="rail" aria-label="Tonight so far">
  <section class="card">
    <div class="card-head"><h2 class="card-title">{title}</h2><span class="meta">{count}</span></div>
    <ol class="tape">{tiles}</ol>
  </section>
  <section class="card">
    <div class="card-head" style="align-items:center;padding-bottom:4px"><h2 class="card-title">Top of the board</h2><a class="link" href="#" style="font-size:15px">Full board</a></div>
    {board}
  </section>
</aside>"""


# ---------------------------------------------------------------- pages
def page(title, main, desc, theme="night"):
    return f"""<!doctype html>
<html lang="en"{' data-theme="day"' if theme == "day" else ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="{'#E9EDF2' if theme == 'day' else '#1A1F29'}">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&family=Atkinson+Hyperlegible+Next:wght@400..800&family=Martian+Mono:wdth,wght@75..112.5,400..700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="c.css">
<script>if(location.search.includes("shot"))document.documentElement.classList.add("shot")</script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
{header()}
{tabbar()}
<main id="main" class="wrap">
{main}
</main>
<p class="sr-only" role="status" aria-live="polite" aria-atomic="true"></p>
</body>
</html>
"""


def layout(col, rail_html):
    return f'<div class="layout"><div class="stack" style="min-width:0">{col}</div>{rail_html}</div>'


def balanced(open_=False):
    top = strip('Sat 3 Oct, game <span class="num">4</span> tonight', "Teams are set",
                "Join your side in the lobby. The host&rsquo;s client moves everyone over.", ANSWER)
    col = (top + receipt("full", open_) + f'<div class="teams">{team("blue", BLUE)}{team("red", RED)}</div>'
           + '<p class="footnote">If the client doesn&rsquo;t move you, switch to your side yourself.</p>' + SITTING)
    return layout(col, rail())


def ingame():
    top = strip('Game <span class="num">4</span>, started <span class="num">9:47</span> pm',
                'In game <span class="num">14:32</span>', "Ratings move when it ends. Nobody needs to report anything.", ANSWER)
    col = top + receipt("compact") + f'<div class="teams">{team("blue", BLUE, True)}{team("red", RED, True)}</div>' + SITTING
    return layout(col, rail())


def filling():
    rows = "".join(
        f"""
    <li class="pool-row{' seat--you' if n == YOU else ''}">
      <div style="min-width:0"><div class="pname">{n}</div>
        <div class="ptags">{you_sticker() + '<span class="sr-only">(you)</span>' if n == YOU else ''}</div>
        <div class="pmeta">joined <span class="num">{t}</span> pm</div></div>
      <span class="pool-role">{ROLE_SVG[r]}<span><span class="sr-only">main role </span>{ROLE_WORD[r]}</span></span>
    </li>"""
        for n, r, t in FILLING
    )
    meter = '<div class="meter" aria-hidden="true">' + '<i></i>' * 6 + '<i class="off"></i>' * 4 + '</div>'
    top = strip('Sat 3 Oct, first game', '<span class="num">6</span> of <span class="num">10</span> in',
                "Four more and the bot rolls teams. Nobody needs to do anything.",
                f'{you_sticker()}<span>in the lobby, main role bot</span>', meter)
    pool = f"""
<section class="card" aria-labelledby="pool">
  <div class="card-head"><h2 id="pool" class="card-title">In the lobby</h2><span class="meta num">6/10</span></div>
  <ol class="pool">{rows}</ol>
  <div class="needed"><span>Still needed:</span>
    <span class="needchip">{ROLE_SVG['jungle']}jungle</span><span class="needchip">{ROLE_SVG['support']}support</span></div>
  <p class="openline"><span class="num">4</span> open seats. They fill as people join the League lobby.</p>
</section>
<p class="footnote">The odds and the bot&rsquo;s three splits show up here the moment teams roll.</p>"""
    return layout(top + pool, rail("Last night, Fri 2 Oct", LAST, "6 played"))


PAGES = {
    "balanced.html": ("Teams are set", balanced, "Direction C: balanced teams with the fairness receipt.", "night"),
    "ingame.html": ("In game", ingame, "Direction C: game in progress, champions, compact receipt.", "night"),
    "filling.html": ("Lobby filling", filling, "Direction C: six of ten in the lobby.", "night"),
    "receipt.html": ("How the bot decided", lambda: balanced(True), "Direction C: receipt expanded with all three splits.", "night"),
    "balanced-day.html": ("Teams are set", balanced, "Direction C, Day theme: balanced teams.", "day"),
}

if __name__ == "__main__":
    for fn, (t, fn_main, d, theme) in PAGES.items():
        (OUT / fn).write_text(page(f"{t} | Kustom", fn_main(), d, theme), encoding="utf-8")
    links = "".join(f'<li><a class="link" href="{fn}">{fn}</a></li>' for fn in PAGES)
    (OUT / "index.html").write_text(
        page("Floodlit Slate", f'<h1 class="headline" style="margin-bottom:16px">Direction C</h1><ul>{links}</ul>', "Index"),
        encoding="utf-8",
    )
    print("wrote", ", ".join(PAGES))
