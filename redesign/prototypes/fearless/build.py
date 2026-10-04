"""Fearless (2.0) static prototype. Not app code. Run: python3 build.py

Builds three pages from champions.json (the repo's names.ts + lanes.ts tables, joined to the
Data Dragon 16.19.1 champion.json sprite coordinates) and the Direction C shell in
../direction-c/balanced.html:

  tonight-balanced.html  the balanced Tonight page with the fearless block (viewer: RED, support)
  page.html              /g/customs/fearless, every lane
  states.html            the other Tonight states and the edge cases, one card each
"""

import html
import json
import re
from pathlib import Path

HERE = Path(__file__).parent
DD = "https://ddragon.leagueoflegends.com/cdn/16.19.1/img/sprite"
LANES = ["top", "jungle", "mid", "adc", "support"]

ROLE_SVG = {
    "top": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 4h9v3H7v6H4z" fill="currentColor" stroke="none"/></svg>',
    "jungle": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M7 20c0-7 2-12 5-16 3 4 5 9 5 16"/><path d="M12 9v11M9 14l3 2 3-2"/></svg>',
    "mid": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M6.5 17.5l11-11" stroke-width="3"/></svg>',
    "adc": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M20 20h-9v-3h6v-6h3z" fill="currentColor" stroke="none"/></svg>',
    "support": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M12 8v8M8.5 12h7"/></svg>',
}
CHEVRON = '<svg class="chev" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>'

CHAMPS = {c["name"]: c for c in json.load(open(HERE / "champions.json"))}

# The last game (game 4): blue then red, top to support. Banned next game.
LAST_GAME = [
    ("Aatrox", "top"), ("Lee Sin", "jungle"), ("Ahri", "mid"), ("Jinx", "adc"), ("Thresh", "support"),
    ("Gnar", "top"), ("Vi", "jungle"), ("Syndra", "mid"), ("Kai'Sa", "adc"), ("Nautilus", "support"),
]
# Games 1 to 3. The lane is the role of the seat that first locked it (Sylas jungle, Lux support).
EARLIER = [
    ("Darius", "top"), ("Garen", "top"), ("Jax", "top"), ("Camille", "top"), ("Fiora", "top"),
    ("Kha'Zix", "jungle"), ("Graves", "jungle"), ("Viego", "jungle"), ("Sylas", "jungle"),
    ("Yasuo", "mid"), ("Zed", "mid"), ("Orianna", "mid"), ("Akali", "mid"), ("Viktor", "mid"),
    ("Ezreal", "adc"), ("Caitlyn", "adc"), ("Miss Fortune", "adc"), ("Vayne", "adc"),
    ("Lulu", "support"), ("Leona", "support"), ("Pyke", "support"), ("Lux", "support"),
    ("Morgana", "support"), ("Blitzcrank", "support"),
]
BANNED = {n: lane for n, lane in EARLIER + LAST_GAME}
TOTAL = len(CHAMPS)


def key(n):
    return n.lower()


def open_in(lane):
    return sorted([c for c in CHAMPS.values() if c["lane"] == lane and c["name"] not in BANNED], key=lambda c: key(c["name"]))


def banned_in(lane):
    return sorted([CHAMPS[n] for n, l in BANNED.items() if l == lane], key=lambda c: key(c["name"]))


def ico(c):
    return (f'<i class="ico s{c["sprite"]}" style="background-position:-{c["x"] // 2}px -{c["y"] // 2}px" '
            f'aria-hidden="true"></i>')


def chip(c, cls="chip-open", hit=False):
    h = " is-hit" if hit else ""
    return f'<li class="{cls}{h}" data-name="{html.escape(key(c["name"]))}">{ico(c)}<span>{html.escape(c["name"])}</span></li>'


def lane_block(lane, hit=None, open_banned=False):
    op, bn = open_in(lane), banned_in(lane)
    opens = "".join(chip(c, hit=(c["name"] == hit)) for c in op)
    bans = "".join(chip(c, "chip-ban", hit=(c["name"] == hit)) for c in bn)
    count = (f'<span class="lane-count"><b class="num">{len(op)}</b> open</span>' if op
             else '<span class="lane-count">none open</span>')
    ban = (f'<details class="bans"{" open" if open_banned else ""}><summary><span>Banned</span>'
           f'<b class="num">{len(bn)}</b>{CHEVRON}</summary><ul class="banlist">{bans}</ul></details>') if bn else ""
    return (f'<section class="lane" data-lane="{lane}" aria-labelledby="ln-{lane}">'
            f'<h3 class="lane-h" id="ln-{lane}">{ROLE_SVG[lane]}<span class="lane-word">{lane}</span>{count}</h3>'
            f'<ul class="openlist">{opens}</ul>{ban}</section>')


def filt(active):
    btns = ['<button type="button" class="seg-btn" aria-pressed="{}" data-lane="all">All</button>'.format(
        "true" if active == "all" else "false")]
    for l in LANES:
        btns.append(f'<button type="button" class="seg-btn" aria-pressed="{"true" if l == active else "false"}" '
                    f'data-lane="{l}">{ROLE_SVG[l]}<span>{l}</span></button>')
    return f'<div class="segctl" role="group" aria-label="Lane">{"".join(btns)}</div>'


def counts(big=True):
    o, b = TOTAL - len(BANNED), len(BANNED)
    return (f'<p class="counts"><span class="c-open"><b class="num">{o}</b> open</span>'
            f'<span class="c-ban"><b class="num">{b}</b> banned</span></p>')


def pool(active, *, query="", hit_line="", hit=None, page=False, viewer_lane=None):
    shown = LANES if active == "all" or query else [active]
    you = (f'<p class="youlane"><span>Your lane this game: <b>{viewer_lane}</b>.</span> '
           f'<button type="button" class="linkbtn" data-lane="all">Show every lane</button></p>'
           if viewer_lane and active == viewer_lane and not query else "")
    body = "".join(lane_block(l, hit=hit, open_banned=bool(query)).replace(
        '<section class="lane"', '<section class="lane"' + ("" if l in shown else " hidden"), 1) for l in LANES)
    status = f'<p class="hitline" role="status">{hit_line}</p>' if hit_line else '<p class="hitline" role="status"></p>'
    title = "" if page else (
        '<div class="fl-head"><h2 class="card-title" id="fl-t">Fearless</h2>'
        '<a class="link" href="page.html">Open the full pool</a></div>')
    grid = " board" if page and active == "all" and not query else ""
    return f'''<section class="card fearless" id="fearless" aria-labelledby="{"h1" if page else "fl-t"}">
  {title}
  {counts()}
  <p class="fl-sub">Still open, by lane. Played champions are banned next game.</p>
  <div class="tools">
    <label class="find"><span class="find-l">Find a champion</span>
      <input type="search" value="{html.escape(query)}" placeholder="Ahri, Lee Sin, Wukong…" autocomplete="off" spellcheck="false"></label>
    {filt("all" if query else active)}
  </div>
  {you}{status}
  <div class="lanes{grid}">{body}</div>
</section>'''


JS = """<script>
// Prototype behaviour only: lane filter + find. Typing ignores the filter and opens every fold.
document.querySelectorAll('.fearless').forEach(card=>{
  const input=card.querySelector('input'),line=card.querySelector('.hitline'),lanesEl=card.querySelector('.lanes');
  let lane=card.querySelector('.seg-btn[aria-pressed=true]')?.dataset.lane||'all';
  const norm=s=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
  function render(){
    const q=norm(input.value);
    card.querySelectorAll('.seg-btn').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.lane===lane&&!q)));
    lanesEl.classList.toggle('board',lane==='all'&&!q&&lanesEl.dataset.board==='1');lanesEl.classList.toggle('searching',!!q);
    let hit=null;
    card.querySelectorAll('.lane').forEach(sec=>{
      let any=false;
      sec.querySelectorAll('li').forEach(li=>{const m=!q||li.dataset.name.replace(/[^a-z0-9]/g,'').includes(q);li.hidden=!m;any=any||m;
        const ex=q&&norm(li.dataset.name)===q;li.classList.toggle('is-hit',ex);if(ex)hit=li;});
      sec.hidden=q?!any:(lane!=='all'&&sec.dataset.lane!==lane);
      const d=sec.querySelector('details');if(d)d.open=!!q;
    });
    const you=card.querySelector('.youlane');if(you)you.hidden=lane==='all'||!!q;
    line.textContent=hit?(hit.classList.contains('chip-ban')?hit.textContent+' is on the ban list.':hit.textContent+' is still available.'):(q&&!card.querySelector('li:not([hidden])')?'No champion matches.':'');
    line.dataset.kind=hit?(hit.classList.contains('chip-ban')?'ban':'open'):'';
  }
  if(lanesEl.classList.contains('board'))lanesEl.dataset.board='1';
  if(card.closest('[data-page]'))lanesEl.dataset.board='1';
  // render every lane so the filter can bring them back
  card.querySelectorAll('[data-lane]').forEach(b=>b.tagName==='BUTTON'&&b.addEventListener('click',()=>{lane=b.dataset.lane;input.value='';render();}));
  input.addEventListener('input',render);
});
</script>"""


def shell_head(title):
    src = (HERE.parent / "direction-c" / "balanced.html").read_text()
    head = src.split("<main", 1)[0]
    head = head.replace("<title>Teams are set | Kustom</title>", f"<title>{title} | Kustom</title>")
    head = head.replace('<link rel="stylesheet" href="c.css">',
                        '<link rel="preconnect" href="https://ddragon.leagueoflegends.com">\n'
                        '<link rel="stylesheet" href="../direction-c/c.css">\n<link rel="stylesheet" href="fearless.css">')
    return head


def tonight_balanced():
    src = (HERE.parent / "direction-c" / "balanced.html").read_text()
    src = src.replace('<link rel="stylesheet" href="c.css">',
                      '<link rel="preconnect" href="https://ddragon.leagueoflegends.com">\n'
                      '<link rel="stylesheet" href="../direction-c/c.css">\n<link rel="stylesheet" href="fearless.css">')
    # The answer band gains a jump link to the viewer's lane.
    src = re.sub(r'(<span>playing support</span>)(</div>)',
                 r'\1<a href="#fearless">What&rsquo;s open for support</a>\2', src, count=1)
    block = pool("support", viewer_lane="support")
    marker = '</section></div>\n<aside class="rail"'
    assert marker in src
    src = src.replace(marker, f'</section>\n{block}</div>\n<aside class="rail"', 1)
    src = src.replace("</body>", JS + "</body>")
    (HERE / "tonight-balanced.html").write_text(src)


def page():
    head = shell_head("Fearless")
    head = head.replace('<a class="navlink" href="#" aria-current=page>Tonight</a>', '<a class="navlink" href="#">Tonight</a>')
    head = head.replace('<a class="navlink" href="#">More</a>', '<a class="navlink" href="#" aria-current=page>More</a>')
    block = pool("all", page=True)
    body = f'''<main id="main" class="wrap fl-page" data-page>
  <div class="pagehead">
    <p class="crumb"><a href="#">Customs Night</a></p>
    <h1 id="h1" class="h1">Fearless</h1>
    <p class="since">Pool since Thu 1 Oct, <span class="num">4</span> games. Every champion locked since then is banned.</p>
  </div>
  {block}
  <section class="card admin-reset" aria-labelledby="ar">
    <h2 id="ar" class="card-title">Start a fresh pool</h2>
    <p class="fl-sub">Clears all <span class="num">{len(BANNED)}</span> bans, so everything is open again. Discord gets told. Admins only.</p>
    <button type="button" class="btn-secondary">Reset fearless</button>
  </section>
</main>
{JS}
</body></html>'''
    (HERE / "page.html").write_text(head + body)


def mini_chips(names, ban=False):
    cls = "chip-ban" if ban else "chip-open"
    return "".join(chip(CHAMPS[n], cls) for n in names)


def states():
    head = shell_head("Fearless states")
    o, b = TOTAL - len(BANNED), len(BANNED)
    o_prev, b_prev = TOTAL - len(EARLIER), len(EARLIER)
    by_lane = {l: [n for n, ln in LAST_GAME if ln == l] for l in LANES}
    lane_counts = "".join(
        f'<a class="lanecount" href="page.html?lane={l}">{ROLE_SVG[l]}<span class="lc-w">{l}</span>'
        f'<b class="num">{len(open_in(l))}</b></a>' for l in LANES)
    next_rows = "".join(
        f'<li class="nb-row"><span class="nb-lane">{ROLE_SVG[l]}<span>{l}</span></span>'
        f'<ul class="nb-chips">{mini_chips(by_lane[l])}</ul></li>' for l in LANES)
    body = f'''<main id="main" class="wrap fl-states">
<div class="statelist">

<p class="state-tag">Idle (no lobby tonight): one line, links to the page</p>
<a class="card fl-line" href="page.html">
  <span class="fl-line-t">Fearless</span>
  <span class="fl-line-c"><b class="num">{o}</b> open <span class="dotsep">·</span> <b class="num">{b}</b> banned</span>
  <span class="fl-line-a">See what&rsquo;s open</span>
</a>

<p class="state-tag">Filling / more than ten: compact card, find box live, lane counts link into the page</p>
<section class="card fearless fl-compact" aria-labelledby="fc-t">
  <div class="fl-head"><h2 class="card-title" id="fc-t">Fearless</h2><a class="link" href="page.html">Open the full pool</a></div>
  {counts()}
  <label class="find"><span class="find-l">Find a champion</span><input type="search" value="Lee Sin" autocomplete="off" spellcheck="false"></label>
  <p class="hitline" role="status" data-kind="ban">Lee Sin is on the ban list.</p>
  <div class="lanecounts" aria-label="Open champions per lane">{lane_counts}</div>
</section>

<p class="state-tag">In game: one line, the mechanic said once</p>
<a class="card fl-line" href="page.html">
  <span class="fl-line-t">Fearless</span>
  <span class="fl-line-c"><b class="num">{o_prev}</b> open <span class="dotsep">·</span> <b class="num">{b_prev}</b> banned</span>
  <span class="fl-line-s">This game&rsquo;s ten join the ban list when it ends.</span>
  <span class="fl-line-a">See what&rsquo;s open</span>
</a>

<p class="state-tag">Finished: under the result poster, the ten that just joined</p>
<section class="card fearless fl-next" aria-labelledby="fn-t">
  <div class="fl-head"><h2 class="card-title" id="fn-t">Banned next game</h2><span class="meta">from game <span class="num">4</span></span></div>
  <ul class="nb">{next_rows}</ul>
  <div class="fl-foot">{counts()}<a class="link" href="page.html">See what&rsquo;s open</a></div>
</section>

<p class="state-tag">Balanced, empty pool (first game since a reset)</p>
<section class="card fearless fl-empty" aria-labelledby="fe-t">
  <div class="fl-head"><h2 class="card-title" id="fe-t">Fearless</h2></div>
  <p class="counts"><span class="c-open"><b class="num">{TOTAL}</b> open</span><span class="c-ban"><b class="num">0</b> banned</span></p>
  <p class="empty-l">Nothing banned yet, so every champion is open. The ten you lock this game are banned next game.</p>
</section>

<p class="state-tag">The reset moment (live, after an admin resets)</p>
<section class="card fearless fl-reset" aria-labelledby="fr-t">
  <div class="fl-head"><h2 class="card-title" id="fr-t">Fearless</h2><span class="meta">reset <span class="num">21:40</span></span></div>
  <p class="empty-l"><b>Fresh pool.</b> Raafat reset fearless, so every champion is open again.</p>
</section>

<p class="state-tag">Find hit, open champion (any state with the box)</p>
<section class="card fearless fl-compact" aria-labelledby="fh-t">
  <div class="fl-head"><h2 class="card-title" id="fh-t">Fearless</h2></div>
  <label class="find"><span class="find-l">Find a champion</span><input type="search" value="wukong" autocomplete="off" spellcheck="false"></label>
  <p class="hitline" role="status" data-kind="open">Wukong is still available.</p>
  <ul class="openlist">{chip(CHAMPS["Wukong"], hit=True)}</ul>
</section>

</div>
</main>
</body></html>'''
    (HERE / "states.html").write_text(head + body)


if __name__ == "__main__":
    tonight_balanced()
    page()
    states()
    print("built", TOTAL, "champions,", len(BANNED), "banned,", TOTAL - len(BANNED), "open")
