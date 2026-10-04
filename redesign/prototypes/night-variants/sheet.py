"""Contact sheets: one per width, rows = screens, columns = current C / V1 / V2.
Each cell is the top of the full-page shot (the part the lamps light), scaled to a fixed width.
Run: python3 sheet.py [screen ...]  (with screens -> a quick preview sheet in the scratchpad)"""
import sys
from PIL import Image, ImageDraw, ImageFont

D = '/Users/suyaser/lol/.claude/worktrees/agent-a0b69a62e2c7f8503/redesign/screens/m14/'
SCREENS = [
    ('tonight-real', 'Tonight, real /g/customs (finished)'),
    ('tonight-balanced', 'Tonight, kit balanced'),
    ('tonight-finished', 'Tonight, kit finished'),
    ('board', 'Board'),
    ('game', 'Game page'),
    ('landing', 'Landing /'),
    ('mode', 'Mode panel'),
]
COLS = [('current', 'Current: C "Floodlit Slate"'), ('v1', 'V1 "1.0 night"'), ('v2', 'V2 "between"')]
# (cell width px, css px of page height to show, device scale of the source)
CFG = {375: (375, 1100, 2), 1440: (720, 1100, 1)}
BG = (12, 14, 18)
FG = (244, 246, 250)
DIM = (170, 180, 195)


def font(sz, bold=False):
    for p in (['/System/Library/Fonts/Supplemental/Arial Bold.ttf'] if bold else []) + [
            '/System/Library/Fonts/Supplemental/Arial.ttf', '/System/Library/Fonts/Helvetica.ttc']:
        try:
            return ImageFont.truetype(p, sz)
        except OSError:
            pass
    return ImageFont.load_default()


def build(w, screens, out):
    cw, css_h, dsf = CFG[w]
    scale = cw / w
    ch = round(css_h * scale)
    gap, head, rowhead = 24, 64, 40
    W = gap + len(COLS) * (cw + gap)
    H = head + len(screens) * (rowhead + ch + gap)
    sheet = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(sheet)
    fh, fr = font(26, True), font(18)
    for i, (_, label) in enumerate(COLS):
        d.text((gap + i * (cw + gap), 20), label, fill=FG, font=fh)
    y = head
    for key, label in screens:
        d.text((gap, y + 10), f'{label}  ({w}px, top {css_h}px)', fill=DIM, font=fr)
        y += rowhead
        for i, (v, _) in enumerate(COLS):
            im = Image.open(f'{D}night-{v}-{key}-{w}.png').convert('RGB')
            im = im.crop((0, 0, im.width, min(im.height, css_h * dsf)))
            im = im.resize((cw, round(im.height * cw / im.width)), Image.LANCZOS)
            sheet.paste(im, (gap + i * (cw + gap), y))
        y += ch + gap
    sheet.save(out, optimize=True)
    print(out, sheet.size)


if __name__ == '__main__':
    pick = sys.argv[1:]
    if pick:
        sc = [s for s in SCREENS if s[0] in pick]
        for w in (375, 1440):
            build(w, sc, f'/private/tmp/claude-501/-Users-suyaser-lol/33c2c4d5-3271-4fd2-a336-2cee3f00cc73/scratchpad/night/preview-{w}.png')
    else:
        for w in (375, 1440):
            build(w, SCREENS, f'{D}night-compare-{w}.png')
