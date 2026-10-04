"""Kustom's tray icons (05-design §9.7): the mark on the V1 card tile, normal (solid amber bar) and not
recording (the bar drawn hollow). Writes the two ICO files the app loads (16, 20, 24, 32 px frames) and the
taskbar previews made from those same frames.

    python3 apps/companion/scripts/tray-icons.py [<previews dir>]

Needs Pillow only. The K is Archivo 900 at wdth 62, outlined once into the path below (the same outline as
the window's SVG lockup), so no font file is needed.

- 16 and 20 px are drawn pixel by pixel: no anti-aliasing on the bar, no halo. 16: bar at columns 2-5, rows
  3-12; hollow = a 1 px amber stroke on columns 2 and 5 and rows 3 and 12, interior the tile colour.
  20: bar at columns 2-6, rows 3-16; hollow stroke on columns 2 and 6 and rows 3 and 16, interior 3-5.
- 24 and 32 px are drawn 8x and downsampled.
"""
import io
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
ICONS = HERE.parent / "src-tauri" / "icons"
PREVIEWS = Path(sys.argv[1]) if len(sys.argv) > 1 else None

TILE = (0x0C, 0x12, 0x1A, 255)  # --p-slate-1, the V1 card
AMBER = (0xFF, 0xCF, 0x66, 255)  # --p-amber-400, --primary-fill
LETTER = (0xF4, 0xF7, 0xFC, 255)  # --p-slate-9

# Archivo 900 wdth 62 "K", from the lockup outline (font size 24, cap height 16.46, y down).
K_PATH = [
    (0.96, 16.46), (0.96, -0.05), (5.35, -0.05), (5.35, 6.6), (7.7, -0.05), (12.24, -0.05),
    (9.34, 7.22), (12.36, 16.46), (7.56, 16.46), (6.36, 11.21), (5.35, 12.53), (5.35, 16.46),
]
K_LEFT, K_TOP, K_HEIGHT = 0.96, -0.05, 16.51

# Per size: (bar left col, bar right col, top row, bottom row, K left col). Inclusive pixel columns/rows.
PIXEL_FRAMES = {16: (2, 5, 3, 12, 7), 20: (2, 6, 3, 16, 8)}
SS = 8


def tile(size: int) -> Image.Image:
    big = Image.new("RGBA", (size * SS, size * SS), (0, 0, 0, 0))
    ImageDraw.Draw(big).rounded_rectangle(
        [0, 0, size * SS - 1, size * SS - 1], radius=int(size * SS * 0.18), fill=TILE
    )
    return big


def draw_k(big: Image.Image, left_px: float, top_px: float, height_px: float) -> None:
    scale = height_px * SS / K_HEIGHT
    pts = [((x - K_LEFT) * scale + left_px * SS, (y - K_TOP) * scale + top_px * SS) for x, y in K_PATH]
    ImageDraw.Draw(big).polygon(pts, fill=LETTER)


def pixel_frame(size: int, hollow: bool) -> Image.Image:
    left, right, top, bottom, k_left = PIXEL_FRAMES[size]
    big = tile(size)
    draw_k(big, k_left, top, bottom - top + 1)
    img = big.resize((size, size), Image.BOX)
    px = img.load()
    for x in range(left, right + 1):
        for y in range(top, bottom + 1):
            edge = x in (left, right) or y in (top, bottom)
            px[x, y] = AMBER if (edge or not hollow) else TILE
    return img


def smooth_frame(size: int, hollow: bool) -> Image.Image:
    big = tile(size)
    w = size * SS
    bw, bh, bx = w * 0.19, w * 0.66, w * 0.13
    by = (w - bh) / 2
    d = ImageDraw.Draw(big)
    box = [bx, by, bx + bw, by + bh]
    if hollow:
        d.rounded_rectangle(box, radius=int(w * 0.03), outline=AMBER, width=int(max(w * 0.065, SS)))
    else:
        d.rounded_rectangle(box, radius=int(w * 0.03), fill=AMBER)
    k_height = bh / SS
    draw_k(big, (bx + bw) / SS + size * 0.09, by / SS, k_height)
    return big.resize((size, size), Image.BOX)


def frame(size: int, hollow: bool) -> Image.Image:
    return pixel_frame(size, hollow) if size in PIXEL_FRAMES else smooth_frame(size, hollow)


SIZES = (16, 20, 24, 32)

for hollow, name in ((False, "tray"), (True, "tray-not-recording")):
    frames = [frame(n, hollow) for n in SIZES]
    frames[-1].save(ICONS / f"{name}.ico", format="ICO", sizes=[(n, n) for n in SIZES], append_images=frames[:-1])
    # Previews from the frames the app loads: decode the ICO just written.
    if PREVIEWS is not None:
        written = Image.open(ICONS / f"{name}.ico")
        for bg, tag in (((0x20, 0x20, 0x20, 255), "dark"), ((0xF3, 0xF3, 0xF3, 255), "light")):
            strip = Image.new("RGBA", (16 + 16 + 20 + 16, 36), bg)
            x = 8
            for n in (16, 20):
                written.size = (n, n)
                im = written.copy().convert("RGBA")
                written = Image.open(ICONS / f"{name}.ico")
                assert im.size == (n, n), im.size
                strip.alpha_composite(im, (x, (36 - n) // 2))
                x += n + 16
            # Shown at 4x, nearest neighbour, so each pixel is visible.
            strip = strip.resize((strip.width * 4, strip.height * 4), Image.NEAREST)
            label = "tray-icon" + ("-not-recording" if hollow else "")
            strip.save(PREVIEWS / f"m178-{label}-{tag}.png")
print("wrote", ICONS / "tray.ico", ICONS / "tray-not-recording.ico")
