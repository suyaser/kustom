#!/usr/bin/env python3
"""Generates the static Direction A prototype pages from one set of components.

Run: python3 build.py   (writes balanced.html, ingame.html, filling.html, receipt.html, index.html)
"""
from pathlib import Path

OUT = Path(__file__).parent

# ---------------------------------------------------------------- data
BLUE = [  # role, name, rating, champion, champ initials
    ("top", "1sec Reloading", 1497, "Renekton", "RE"),
    ("jungle", "7ambolyy", 1894, "Lee Sin", "LS"),
    ("mid", "knifiy", 1454, "Ahri", "AH"),
    ("adc", "Used2BeATahmMain", 1322, "Jinx", "JX"),
    ("support", "FoxHound", 1224, "Thresh", "TH"),
]
RED = [
    ("top", "TheSHADOWREAPER", 1262, "Darius", "DA"),
    ("jungle", "XETA", 1378, "Vi", "VI"),
    ("mid", "Syndrome Axes", 2291, "Syndra", "SY"),
    ("adc", "SugarPapy", 1218, "Caitlyn", "CA"),
    ("support", "PRT Khokha", 1287, "Nautilus", "NA"),
]
YOU = "Used2BeATahmMain"
FILLING = [  # name, main role, joined
    ("Syndrome Axes", "mid", "21:02"),
    ("1sec Reloading", "top", "21:04"),
    ("Used2BeATahmMain", "adc", "21:05"),
    ("knifiy", "mid", "21:07"),
    ("TheSHADOWREAPER", "top", "21:09"),
    ("SugarPapy", "adc", "21:11"),
]
BOARD = [("Ramzyinhović", 2638), ("Syndrome Axes", 2291), ("Raafat", 1915), ("7ambolyy", 1894), ("Chaos", 1718)]
TAPE = [  # game, winner, favoured side, favoured pct, minutes
    (2, "red", "red", 46, 31),
    (1, "blue", "blue", 53, 27),
]

# ---------------------------------------------------------------- icons
ROLE_SVG = {
    "top": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="4" y="4" width="16" height="16"/><path d="M4 4h9v3H7v6H4z" fill="currentColor" stroke="none"/></svg>',
    "jungle": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" aria-hidden="true"><path d="M7 20c0-7 2-12 5-16 3 4 5 9 5 16"/><path d="M12 9v11M9 14l3 2 3-2"/></svg>',
    "mid": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="4" y="4" width="16" height="16"/><path d="M6.5 17.5l11-11" stroke-width="3"/></svg>',
    "adc": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="4" y="4" width="16" height="16"/><path d="M20 20h-9v-3h6v-6h3z" fill="currentColor" stroke="none"/></svg>',
    "support": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="miter" aria-hidden="true"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M12 8v8M8.5 12h7"/></svg>',
}
ROLE_WORD = {"top": "Top", "jungle": "Jungle", "mid": "Mid", "adc": "Bot", "support": "Support"}
# Shape markers: BLUE is a circle, RED is a diamond. Both always sit beside the word.
GLYPH = {
    "blue": '<svg class="glyph" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="6" fill="var(--blue)"/></svg>',
    "red": '<svg class="glyph" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 0.5L13.5 7 7 13.5 0.5 7z" fill="var(--red)"/></svg>',
}
CHEVRON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>'
LOCK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="5" y="11" width="14" height="10"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>'
TAB_SVG = {
    "Tonight": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3v3M5.6 5.6l2.1 2.1M18.4 5.6l-2.1 2.1"/><path d="M4 21h16M7 21l2-9h6l2 9"/></svg>',
    "Board": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 20V10h4v10M10 20V4h4v16M16 20v-7h4v7"/></svg>',
    "Games": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="4" y="4" width="16" height="16"/><path d="M4 9h16M4 14h16M9 4v16"/></svg>',
    "More": '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="4" y="11" width="3" height="3"/><rect x="10.5" y="11" width="3" height="3"/><rect x="17" y="11" width="3" height="3"/></svg>',
}

# ---------------------------------------------------------------- components
def fmt(n):
    return f"{n:,}"


def header():
    nav = "".join(
        f'<a class="navlink" href="#"{" aria-current=page" if n == "Tonight" else ""}>{n}</a>'
        for n in ["Tonight", "Board", "Games", "Stats", "1v1", "Daily"]
    )
    return f"""
<header class="topbar">
  <div class="mx-auto flex max-w-[1320px] items-center gap-2 px-4 lg:px-8 h-14">
    <a class="wordmark" href="#"><i></i>Kustom</a>
    <a class="group-switch ml-2" href="#" aria-label="Group: Customs Night. Switch group">Customs Night {CHEVRON}</a>
    <nav class="ml-6 hidden lg:flex" aria-label="Main">{nav}</nav>
    <div class="ml-auto flex items-center gap-2">
      <span class="num hidden text-[13px] text-[var(--muted-foreground)] sm:inline">Sat 3 Oct</span>
      <a class="btn hidden lg:inline-flex" href="#">Sign in</a>
    </div>
  </div>
</header>"""


def tabbar():
    tabs = "".join(
        f'<a class="tab" href="#"{" aria-current=page" if n == "Tonight" else ""}>{TAB_SVG[n]}{n}</a>'
        for n in ["Tonight", "Board", "Games", "More"]
    )
    return f'<nav class="tabbar lg:hidden" aria-label="Main">{tabs}</nav>'


def strip(tag, headline, sub):
    return f"""
<section class="strip" aria-label="Lobby status">
  <div class="strip-tag"><span class="dot"></span>{tag}</div>
  <div class="strip-body">
    <h1 class="headline">{headline}</h1>
    <p class="strip-sub">{sub}</p>
  </div>
</section>"""


def seat(side, role, name, rating, champ=None, initials=None):
    you = name == YOU
    tag = '<span class="you">YOU</span>' if you else ""
    sr = '<span class="sr-only"> (you)</span>' if you else ""
    left = (
        f'<div class="champ" title="{champ}">{initials}</div>'
        if champ
        else f'<div class="role">{ROLE_SVG[role]}<span>{ROLE_WORD[role]}</span></div>'
    )
    meta = (
        f'<div class="pmeta">{champ} <span aria-hidden="true">/</span> {ROLE_WORD[role]}</div>' if champ else ""
    )
    return f"""
    <li class="seat{' seat--you' if you else ''}">
      {left}
      <div class="who"><div class="pname">{name}{sr}{tag}</div>{meta}</div>
      <div class="rating" aria-label="rating {rating}">{rating}</div>
    </li>"""


def team(side, rows, champs=False):
    total = sum(r[2] for r in rows)
    word = side.upper()
    seats = "".join(
        seat(side, r[0], r[1], r[2], r[3] if champs else None, r[4] if champs else None) for r in rows
    )
    return f"""
<section class="team team--{side}" aria-label="{word} team">
  <div class="team-head">
    <span class="team-rail"></span>
    <h2 class="team-name">{GLYPH[side]}{word}</h2>
    <div class="team-sum"><b>{fmt(total)}</b><span>team rating</span></div>
  </div>
  <ol class="m-0 list-none p-0">{seats}</ol>
</section>"""


def bug(blue=49, red=51, big=True):
    return f"""
  <div class="bug" role="img" aria-label="Win chance: Blue {blue} percent, Red {red} percent">
    <div class="bug-side bug-side--blue"><span class="lbl">{GLYPH['blue']}Blue</span><span class="pct">{blue}<small>%</small></span></div>
    <div>
      <div class="bar"><span class="b" style="flex:{blue}"></span><span class="r" style="flex:{red}"></span><span class="mid"></span></div>
      <div class="bar-cap">win chance{'' if big else ''}</div>
    </div>
    <div class="bug-side bug-side--red"><span class="lbl">Red{GLYPH['red']}</span><span class="pct">{red}<small>%</small></span></div>
  </div>"""


CHIPS = """
  <div class="chips">
    <span class="chip">Win chance <b>49/51</b></span>
    <span class="chip">Rating gap <b>45</b></span>
    <span class="chip">Off-role <b>0</b></span>
  </div>"""

SENTENCE = "Ratings are 45 points apart out of about 7,400, and everyone&rsquo;s on a main role."


def splits_panel():
    cards = [
        ("Picked", True, 49, 51, "45", "0", "These teams."),
        ("Option 2", False, 47, 53, "112", "0", "knifiy and XETA swap sides."),
        ("Option 3", False, 50, 50, "18", "2", "Closer, but 7ambolyy and PRT Khokha leave their mains."),
    ]
    out = []
    for tag, picked, b, r, gap, off, note in cards:
        offcls = ' class="bad"' if off != "0" else ""
        out.append(f"""
      <div class="split{' split--picked' if picked else ''}">
        <div class="split-tag">{'&#10003; ' if picked else ''}{tag}</div>
        <div class="minibar" aria-hidden="true"><span class="b" style="flex:{b}"></span><span class="r" style="flex:{r}"></span></div>
        <div class="kv"><span>Win</span><b>{b}/{r}</b></div>
        <div class="kv"><span>Gap</span><b>{gap}</b></div>
        <div class="kv"><span>Off-role</span><b{offcls}>{off}</b></div>
        <p class="m-0 text-[13px] leading-snug text-[var(--muted-foreground)]">{note}</p>
      </div>""")
    return f"""
    <div class="space-y-4 px-4 pb-4 pt-1">
      <p class="m-0 text-[15px] text-[var(--muted-foreground)]">The bot made three splits from the ten players in the lobby and kept the closest one where nobody plays off their main role.</p>
      <div class="grid grid-cols-3 gap-2">{''.join(out)}</div>
      <div class="flex items-start gap-3 border border-[var(--border)] bg-[var(--background)] p-3">
        <span class="mt-0.5 text-[var(--primary)]">{LOCK}</span>
        <p class="m-0 text-[15px] font-semibold leading-snug">Nobody picked these teams. Admins can&rsquo;t edit ratings.<span class="block font-normal text-[var(--muted-foreground)]">Ratings only move when a game ends, read straight from the League client.</span></p>
      </div>
      <div class="border border-[var(--border)] bg-[var(--background)] p-3">
        <div class="flex items-baseline justify-between gap-3">
          <p class="m-0 text-[15px] font-semibold">The favoured side won <span class="num">54%</span> of <span class="num">103</span> games.</p>
        </div>
        <div class="mt-2 flex h-2 gap-px" aria-hidden="true"><span class="bg-[var(--foreground)]" style="flex:54"></span><span class="bg-[var(--border-strong)]" style="flex:46"></span></div>
        <p class="m-0 mt-2 text-[13px] leading-snug text-[var(--muted-foreground)]">Close to a coin flip, which is the goal. If the teams were stacked, the favoured side would win far more often.</p>
      </div>
    </div>"""


def receipt(variant="full", open_=False):
    if variant == "compact":
        return f"""
<section class="receipt" aria-labelledby="fr">
  <div class="space-y-3 p-4">
    <h2 id="fr" class="card-title">Fairness</h2>
    {bug()}
    <p class="m-0 text-[14px] text-[var(--muted-foreground)]"><b class="num text-[var(--foreground)]">45</b> points apart out of about 7,400. Nobody off&#8209;role.</p>
  </div>
  <details class="how"><summary>How the bot decided {CHEVRON}</summary>{splits_panel()}</details>
</section>"""
    return f"""
<section class="receipt" aria-labelledby="fr">
  <div class="space-y-4 p-[14px] lg:p-5">
    <div class="flex items-baseline justify-between gap-3">
      <h2 id="fr" class="card-title">Fairness receipt</h2>
      <span class="num whitespace-nowrap text-[12px] text-[var(--muted-foreground)]">Game 3</span>
    </div>
    {bug()}
    <p class="sentence">{SENTENCE}</p>
    {CHIPS}
  </div>
  <details class="how"{' open' if open_ else ''}><summary>How the bot decided {CHEVRON}</summary>{splits_panel()}</details>
</section>"""


SITTING = """
<section class="card flex items-start gap-3 p-4" aria-label="Sitting out">
  <svg class="mt-1 flex-none text-[var(--muted-foreground)]" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M6 20v-6h12v6M8 14V8h8v6M4 20h16"/></svg>
  <p class="m-0 text-[15px] leading-snug"><b>Ramzyinhović</b> sits this one out. Whoever has played least tonight sits out, so they&rsquo;re first in line for game 4.</p>
</section>"""


def rail():
    tape = "".join(
        f"""
    <a class="tape-row no-underline" href="#">
      <span class="tape-no">G{g}</span>
      <span class="min-w-0"><span class="winner" style="color:var(--{w})">{GLYPH[w]}{w.upper()} won</span>
        <span class="block text-[13px] text-[var(--muted-foreground)]">{fav.capitalize()} was {pct}% to win.</span></span>
      <span class="num text-[13px] text-[var(--muted-foreground)]">{mins} min</span>
    </a>"""
        for g, w, fav, pct, mins in TAPE
    )
    board = "".join(
        f"""
    <a class="board-row" href="#"><span class="num text-[13px] text-[var(--muted-foreground)]">{i}</span><span class="font-bold [overflow-wrap:anywhere]">{n}</span><span class="rating">{r}</span></a>"""
        for i, (n, r) in enumerate(BOARD, 1)
    )
    return f"""
<aside class="space-y-4" aria-label="Tonight so far">
  <section class="card">
    <div class="flex items-center justify-between px-4 pb-3 pt-4"><h2 class="card-title">Tonight&rsquo;s tape</h2><span class="num text-[12px] text-[var(--muted-foreground)]">2 played</span></div>
    {tape}
  </section>
  <section class="card">
    <div class="flex items-center justify-between px-4 pb-3 pt-4"><h2 class="card-title">Top of the board</h2><a class="link text-[14px] min-h-0" href="#">Full board</a></div>
    {board}
  </section>
</aside>"""


def page(title, main, desc):
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&family=Martian+Mono:wght@400..700&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
<link rel="stylesheet" href="broadcast.css">
<script>if(location.search.includes("shot"))document.documentElement.classList.add("shot")</script>
</head>
<body class="lg:pb-12">
<a class="sr-only" href="#main">Skip to content</a>
{header()}
<main id="main" class="mx-auto max-w-[1320px] px-4 pt-4 lg:px-8 lg:pt-8">
{main}
</main>
{tabbar()}
</body>
</html>
"""


def layout(top, receipt_html, teams_html, after="", rail_html=None):
    rail_html = rail() if rail_html is None else rail_html
    return f"""
<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-8">
  <div class="min-w-0 space-y-4 lg:space-y-5">
    {top}
    {receipt_html}
    <div class="grid gap-4 md:grid-cols-2">{teams_html}</div>
    {after}
  </div>
  <div class="lg:pt-0">{rail_html}</div>
</div>"""


def balanced(open_=False):
    top = strip("Live", "Teams are set", "Join your side in the lobby. Game 3 of the night.")
    return layout(top, receipt("full", open_), team("blue", BLUE) + team("red", RED), SITTING)


def ingame():
    top = strip("Live", 'In game <span class="num">14:32</span>', "Started 21:48. Ratings move when it ends.")
    return layout(top, receipt("compact"), team("blue", BLUE, True) + team("red", RED, True), SITTING)


def filling():
    rows = "".join(
        f"""
    <li class="pool-row">
      <div class="min-w-0"><div class="pname">{n}{'<span class="sr-only"> (you)</span><span class="you">YOU</span>' if n == YOU else ''}</div><div class="pmeta">in at <span class="num">{t}</span></div></div>
      <div class="role flex-row !gap-1.5">{ROLE_SVG[r]}<span class="!text-[13px]">{ROLE_WORD[r]}</span></div>
      <span class="sr-only">main role</span>
    </li>"""
        for n, r, t in FILLING
    )
    top = strip("Live", '<span class="num">6</span> of <span class="num">10</span> in', "Teams roll when ten are in. Nobody needs to do anything.")
    pool = f"""
<section class="card" aria-labelledby="pool">
  <div class="space-y-3 p-4">
    <div class="flex items-baseline justify-between"><h2 id="pool" class="card-title">In the lobby</h2><span class="num text-[13px] text-[var(--muted-foreground)]">6/10</span></div>
    <div class="seatdots" aria-hidden="true">{'<i class="on"></i>' * 6}{'<i></i>' * 4}</div>
  </div>
  <ol class="m-0 grid list-none border-t border-[var(--border)] p-0 md:grid-cols-2 md:gap-x-px md:bg-[var(--border)]">{rows}</ol>
  <div class="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-dashed border-[var(--border-strong)] px-4 py-3 text-[15px]">
    <span class="text-[var(--muted-foreground)]"><span class="num">4</span> seats open</span>
    <span class="needed">Still needed: jungle, support</span>
  </div>
</section>
<p class="m-0 text-[15px] text-[var(--muted-foreground)]">The fairness receipt shows up here the moment teams roll: win chance, rating gap and the three splits the bot weighed.</p>"""
    return f"""
<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-8">
  <div class="min-w-0 space-y-4 lg:space-y-5">{top}{pool}</div>
  <div>{rail()}</div>
</div>"""


PAGES = {
    "balanced.html": ("Teams are set", balanced(), "Direction A, Broadcast: balanced teams with the fairness receipt."),
    "ingame.html": ("In game", ingame(), "Direction A, Broadcast: game in progress with timer, champions and compact receipt."),
    "filling.html": ("Lobby filling", filling(), "Direction A, Broadcast: six of ten in the lobby."),
    "receipt.html": ("How the bot decided", balanced(open_=True), "Direction A, Broadcast: fairness receipt expanded with the three candidate splits."),
}

if __name__ == "__main__":
    for fn, (t, main, d) in PAGES.items():
        (OUT / fn).write_text(page(f"{t} · Kustom", main, d), encoding="utf-8")
    links = "".join(f'<li><a class="link" href="{fn}">{t}</a></li>' for fn, (t, _, _) in PAGES.items())
    (OUT / "index.html").write_text(
        page("Broadcast prototype", f'<h1 class="headline mb-4">Direction A: Broadcast</h1><ul class="list-none p-0">{links}</ul>', "Index"),
        encoding="utf-8",
    )
    print("wrote", ", ".join(PAGES))
