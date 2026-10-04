"""Mode card + mode panel static prototype. Not app code. Run: python3 build.py

Reuses ../fearless/build.py (roster, sprites, lane block, find + lane JS) and the Direction C shell in
../direction-c/balanced.html. tags.json is Data Dragon 16.19.1 champion.json `tags`, keyed by numeric key.

  cards.html                   the card in its states (member and admin)
  tonight-fearless-panel.html  balanced Tonight with the Fearless panel open (?lane=all for every lane)
  tonight-class-panel.html     balanced Tonight with the Class wars (Tanks only) panel open
  mode-page.html               /g/customs/mode opened directly: the same panel body as a page in the shell
"""

import html
import importlib.util
import json
import re
from pathlib import Path

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location("fl", HERE.parent / "fearless" / "build.py")
fl = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fl)

TAGS = {int(k): v for k, v in json.load(open(HERE / "tags.json")).items()}
LANES = fl.LANES
SVG = fl.ROLE_SVG
CHEV_R = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>'
CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'
O, B = fl.TOTAL - len(fl.BANNED), len(fl.BANNED)
TANKS = sorted([c for c in fl.CHAMPS.values() if "Tank" in TAGS.get(c["id"], [])], key=lambda c: c["name"].lower())


def css_links(src):
    return src.replace('<link rel="stylesheet" href="c.css">',
                       '<link rel="preconnect" href="https://ddragon.leagueoflegends.com">\n'
                       '<link rel="stylesheet" href="../direction-c/c.css">\n'
                       '<link rel="stylesheet" href="../fearless/fearless.css">\n<link rel="stylesheet" href="mode.css">')


def ratechip(rated):
    return '<span class="ratechip">Rated</span>' if rated else '<span class="ratechip ratechip--off">Not rated</span>'


def fearless_status():
    return (f'<p class="mc-status"><span><b class="num">{O}</b>open</span>'
            f'<span class="st-ban"><b class="num">{B}</b>banned</span></p>')


def card(title, rated, status, href, go="See what&rsquo;s open", extra="", below="", admin="", dashed=False, cid="mode"):
    return f'''<section class="card mc{" mc--dashed" if dashed else ""}" id="{cid}" aria-labelledby="{cid}-t">
  <a class="mc-link" href="{href}">
    <span class="mc-main">
      <span class="mc-top"><h2 class="card-title" id="{cid}-t">{title}</h2>{ratechip(rated)}</span>
      {status}{extra}
    </span>
    <span class="mc-go"><span>{go}</span>{CHEV_R}</span>
  </a>{below}{admin}
</section>'''


def you_row(lane, n, word="open"):
    return f'<span class="mc-you">{SVG[lane]}<span>Your lane <span class="lw">{lane}</span> &middot; <b class="num">{n}</b> {word}</span></span>'


def admin_ctl(current, rated, *, dirty=None, reset=True, note=""):
    opts = [("normal", "Normal"), ("fearless", "Fearless")]
    groups = {"Class wars": [("class-tank", "Tanks only"), ("class-marksman", "Marksmen only"), ("class-mage", "Mages only"),
                             ("class-assassin", "Assassins only"), ("class-support", "Supports only")],
              "Region wars": [("region", "Region wars (sides drawn at roll)")]}
    sel = dirty or current
    o = "".join(f'<option value="{v}"{" selected" if v == sel else ""}>{t}</option>' for v, t in opts)
    for g, items in groups.items():
        o += f'<optgroup label="{g}">' + "".join(
            f'<option value="{v}"{" selected" if v == sel else ""}>{t}</option>' for v, t in items) + "</optgroup>"
    apply_btn = '<button type="submit" class="btn btn-primary">Set mode</button>' if dirty else ""
    reset_btn = '<button type="button" class="btn btn-secondary">Reset fearless</button>' if reset else ""
    sent = "Ratings move after this game." if rated else "This game is recorded, not rated."
    return f'''
  <form class="mc-ctl" method="post" aria-label="Mode settings">
    <p class="ctl-who">Admins and the owner</p>
    <div class="ctl-row"><label class="fld"><span class="fld-l">Mode</span><select class="sel" name="mode">{o}</select></label>{apply_btn}</div>
    {f'<p class="ctl-note">{note}</p>' if note else ""}
    <button type="button" class="sw" role="switch" aria-checked="{"true" if rated else "false"}"><span class="sw-track"></span>
      <span class="sw-t"><span class="sw-l">Rated</span><span class="sw-s">{sent}</span></span></button>
    {f'<div>{reset_btn}</div>' if reset_btn else ""}
  </form>'''


def lane_tiles():
    return '<div class="lanecounts" aria-label="Open champions per lane">' + "".join(
        f'<a class="lanecount" href="tonight-fearless-panel.html?lane={l}">{SVG[l]}<span class="lc-w">{l}</span>'
        f'<b class="num">{len(fl.open_in(l))}</b></a>' for l in LANES) + "</div>"


def banned_next():
    by_lane = {l: [n for n, ln in fl.LAST_GAME if ln == l] for l in LANES}
    rows = "".join(f'<li class="nb-row"><span class="nb-lane">{SVG[l]}<span>{l}</span></span>'
                   f'<ul class="nb-chips">{fl.mini_chips(by_lane[l])}</ul></li>' for l in LANES)
    return f'<h3 class="sr-only">Banned next game</h3><ul class="nb" aria-label="Banned next game, from game 4">{rows}</ul>'


# ---------- cards ----------
def cards():
    head = css_links(fl.shell_head("Mode card states").replace('href="../direction-c/c.css">\n<link rel="stylesheet" href="fearless.css">',
                                                                'href="../direction-c/c.css">\n<link rel="stylesheet" href="../fearless/fearless.css">\n<link rel="stylesheet" href="mode.css">'))
    st = []
    st.append(("Idle, member. Fearless, rated: one row, the whole row opens the panel",
               card("Fearless", True, fearless_status(), "tonight-fearless-panel.html?lane=all", cid="m1")))
    st.append(("Balanced, member seated on support: opens on their lane",
               card("Fearless", True, fearless_status(), "tonight-fearless-panel.html",
                    extra=you_row("support", len(fl.open_in("support"))), cid="m2")))
    st.append(("Filling, admin: lane tiles open the panel on a lane; the controls sit at the foot",
               card("Fearless", True, fearless_status(), "tonight-fearless-panel.html?lane=all", below=lane_tiles(),
                    admin=admin_ctl("fearless", True), cid="m3")))
    st.append(("Balanced, member. Class wars, not rated",
               card("Class wars", False, '<p class="mc-rule">Tanks only</p>', "tonight-class-panel.html", go="See the tanks",
                    extra=you_row("support", len([c for c in TANKS if c["lane"] == "support"]), "tanks"), cid="m4")))
    st.append(("Idle, admin. Normal, picking Class wars: Set mode appears once the choice differs",
               card("Normal", True, '<p class="mc-sent">Standard draft, nothing narrowed. Only admins see this card.</p>',
                    "mode-page.html", go="All modes", admin=admin_ctl("normal", True, dirty="class-tank", reset=False), cid="m5")))
    st.append(("Finished, member. Fearless: the ten that just joined lead the card",
               card("Fearless", True, '<p class="mc-sent"><b style="color:var(--foreground)">Banned next game</b> &middot; from game <span class="num">4</span></p>',
                    "tonight-fearless-panel.html?lane=all", below=banned_next() + f'<div class="fl-foot">{fl.counts()}</div>', cid="m6")))
    st.append(("In game, admin: the choice applies from the next game",
               card("Fearless", True, fearless_status(), "tonight-fearless-panel.html?lane=all",
                    extra='<span class="mc-sent">This game&rsquo;s ten join the ban list when it ends.</span>',
                    admin=admin_ctl("fearless", True, note="Changes apply from the next game."), cid="m7")))
    body = '<main id="main" class="wrap"><div class="sheet">' + "".join(
        f'<div><p class="state-tag">{t}</p>{c}</div>' for t, c in st) + "</div></main></body></html>"
    (HERE / "cards.html").write_text(head + body)


# ---------- panels ----------
def fearless_panel_body(page=False):
    hd = "h1" if page else "h2"
    pool = fl.pool("support", viewer_lane="support", page=True).replace('aria-labelledby="h1"', 'aria-labelledby="mp-t"')
    return f'''<div class="mp-head">
    <div class="mc-top"><{hd} class="h1" id="mp-t">Fearless</{hd}>{ratechip(True)}</div>
    <p class="mp-since">Pool since Thu 1 Oct, <span class="num">4</span> games. Every champion locked since then is banned.</p>
  </div>
  {pool}
  <p class="mp-admin">To change the mode or reset, use the Mode card on <a href="#">Tonight</a>.</p>'''


def class_panel_body(page=False):
    hd = "h1" if page else "h2"
    lanes = ""
    for l in LANES:
        cs = [c for c in TANKS if c["lane"] == l]
        grid = (f'<ul class="openlist">{"".join(fl.chip(c) for c in cs)}</ul>' if cs else
                f'<p class="lane-empty">No tank is usually played here. Any tank on this list may go {l}.</p>')
        lanes += (f'<section class="lane" data-lane="{l}" aria-labelledby="cl-{l}"{"" if l == "support" else " hidden"}>'
                  f'<h3 class="lane-h" id="cl-{l}">{SVG[l]}<span class="lane-word">{l}</span>'
                  f'<span class="lane-count"><b class="num">{len(cs)}</b> tanks</span></h3>{grid}</section>')
    return f'''<div class="mp-head">
    <div class="mc-top"><{hd} class="h1" id="mp-t">Class wars</{hd}>{ratechip(False)}</div>
    <p class="mp-rule">Tanks only</p>
    <p class="mp-since">Every pick this game is a champion Riot tags Tank. Nobody is stopped in champ select; the result post says which side kept the rule. Not rated: ratings don&rsquo;t move.</p>
  </div>
  <section class="card fearless" aria-labelledby="mp-t">
    <p class="counts"><span class="c-open"><b class="num">{len(TANKS)}</b> tanks</span><span class="c-ban">of <b class="num">{fl.TOTAL}</b> champions</span></p>
    <div class="tools">
      <label class="find"><span class="find-l">Find a champion</span>
        <input type="search" placeholder="Ornn, Sion, Rell&hellip;" autocomplete="off" spellcheck="false"></label>
      {fl.filt("support")}
    </div>
    <p class="youlane"><span>Your lane this game: <b>support</b>.</span> <button type="button" class="linkbtn" data-lane="all">Show every lane</button></p>
    <p class="hitline" role="status"></p>
    <div class="lanes">{lanes}</div>
  </section>
  <p class="mp-admin">To change the mode, use the Mode card on <a href="#">Tonight</a>.</p>'''


PANEL_JS = """<script>
// prototype: ?lane= presses that lane once
const q=new URLSearchParams(location.search).get('lane');
if(q)document.querySelector('.mp .seg-btn[data-lane="'+q+'"]')?.click();
</script>"""


def tonight_with(card_html, panel_title, panel_body, answer_link, out):
    src = css_links((HERE.parent / "direction-c" / "balanced.html").read_text())
    src = re.sub(r'(<span>playing support</span>)(</div>)', rf'\1<a href="#">{answer_link}</a>\2', src, count=1)
    marker = '</section></div>\n<aside class="rail"'
    assert marker in src
    src = src.replace(marker, f'</section>\n{card_html}</div>\n<aside class="rail"', 1)
    for tag in ('<header class="topbar"', '<nav class="tabbar"', '<main id="main"'):
        src = src.replace(tag, tag + " inert", 1)
    src = src.replace("<title>Teams are set | Kustom</title>", f"<title>{panel_title} | Kustom</title>")
    panel = f'''<div class="mp-scrim" aria-hidden="true"></div>
<div class="mp" role="dialog" aria-modal="true" aria-labelledby="mp-t" data-page>
  <div class="mp-bar"><p class="mp-crumb">Tonight &middot; <b>Mode</b></p><a class="mp-close" href="#">{CLOSE}Close</a></div>
  <div class="mp-body">{panel_body}</div>
</div>'''
    src = src.replace("</body>", panel + fl.JS + PANEL_JS + "</body>")
    (HERE / out).write_text(src)


def mode_page():
    head = css_links(fl.shell_head("Fearless").replace('href="../direction-c/c.css">\n<link rel="stylesheet" href="fearless.css">',
                                                        'href="../direction-c/c.css">\n<link rel="stylesheet" href="../fearless/fearless.css">\n<link rel="stylesheet" href="mode.css">'))
    body = f'''<main id="main" class="wrap mode-page" data-page><div class="mp" style="position:static;transform:none;width:auto;max-height:none;border:0;box-shadow:none;background:none">
  <p class="crumb"><a href="#">Customs Night</a> &middot; Tonight</p>
  <div class="mp-body">{fearless_panel_body(page=True)}</div></div></main>{fl.JS}{PANEL_JS}</body></html>'''
    (HERE / "mode-page.html").write_text(head + body)


if __name__ == "__main__":
    cards()
    sup = len(fl.open_in("support"))
    tonight_with(card("Fearless", True, fearless_status(), "#", extra=you_row("support", sup)),
                 "Fearless", fearless_panel_body(), "What&rsquo;s open for support", "tonight-fearless-panel.html")
    tonight_with(card("Class wars", False, '<p class="mc-rule">Tanks only</p>', "#", go="See the tanks",
                      extra=you_row("support", len([c for c in TANKS if c["lane"] == "support"]), "tanks")),
                 "Class wars", class_panel_body(), "Tanks for support", "tonight-class-panel.html")
    mode_page()
    print("tanks", len(TANKS), {l: len([c for c in TANKS if c["lane"] == l]) for l in LANES})
