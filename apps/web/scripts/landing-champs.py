"""Cuts the landing page's ten example-game champion squares (docs/05-design.md section 12.7).

    pnpm --filter web landing-champs            # writes components/landing/champions/<Id>.webp
    pnpm --filter web landing-champs --check    # re-encodes in memory; exit 1 on any byte difference

Run by hand, outputs committed; nothing here runs at build time and the page never requests Data
Dragon (12.7: no hotlink, no image optimizer). Needs Python 3 with Pillow (`pip install pillow`).
`--check` is byte-exact only with the same Pillow (and its bundled libwebp); the version that wrote the
committed files is pinned below and a mismatch is reported before the comparison.

Input: Data Dragon's square icon `cdn/<DDRAGON_VERSION>/img/champion/<Id>.png`, the pin read from
lib/champs/ddragonPin.ts, downloaded once into apps/web/node_modules/.cache/landing-champs/<version>/.
Output: the native size, WebP quality 80, no metadata. No resample, the art as delivered (12.7). 12.7
says 120 x 120; Data Dragon serves 128 x 128 at 16.19.1, so the native 128 is what is kept.

The ten ids are the ones lib/landing/exampleGame.ts names (12.2); lib/landing/exampleGame.test.ts
holds the two lists together. The files do not follow a pin bump: re-run this by hand if ever wanted.
"""

from __future__ import annotations

import io
import re
import sys
import urllib.request
from pathlib import Path

import PIL
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "components" / "landing" / "champions"
PIN = ROOT / "lib" / "champs" / "ddragonPin.ts"
CACHE = ROOT / "node_modules" / ".cache" / "landing-champs"

PILLOW_VERSION = "11.3.0"
SIZE = 128  # Data Dragon's square at 16.19.1 (12.7 assumed 120; native wins: no resample)
QUALITY = 80

# Lane order, blue then red (05-design 12.2).
CHAMPIONS = (
    "Garen",
    "Darius",
    "LeeSin",
    "Amumu",
    "Ahri",
    "Yasuo",
    "Jinx",
    "Ezreal",
    "Thresh",
    "Lux",
)


def ddragon_version() -> str:
    match = re.search(r"DDRAGON_VERSION = '([0-9.]+)'", PIN.read_text())
    if match is None:
        sys.exit(f"{PIN}: no DDRAGON_VERSION")
    return match.group(1)


def source_png(version: str, champ_id: str) -> bytes:
    local = CACHE / version / f"{champ_id}.png"
    if not local.exists():
        url = f"https://ddragon.leagueoflegends.com/cdn/{version}/img/champion/{champ_id}.png"
        local.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(url, timeout=30) as response:  # noqa: S310 (fixed https host)
            local.write_bytes(response.read())
    return local.read_bytes()


def to_webp(png: bytes, champ_id: str) -> bytes:
    image = Image.open(io.BytesIO(png))
    image.load()
    if image.size != (SIZE, SIZE):
        sys.exit(f"{champ_id}.png is {image.size[0]} x {image.size[1]}, expected {SIZE} x {SIZE}")
    # RGB: the squares are opaque, and dropping a constant alpha channel saves bytes.
    rgb = image.convert("RGB")
    out = io.BytesIO()
    # No exif, icc_profile or xmp is passed, so the file carries no metadata chunk.
    rgb.save(out, format="WEBP", quality=QUALITY, method=6)
    return out.getvalue()


def main() -> None:
    check = "--check" in sys.argv[1:]
    if PIL.__version__ != PILLOW_VERSION:
        print(f"warning: Pillow {PIL.__version__}, the committed files were written with {PILLOW_VERSION}")
    version = ddragon_version()
    OUT.mkdir(parents=True, exist_ok=True)
    stale: list[str] = []
    total = 0
    for champ_id in CHAMPIONS:
        data = to_webp(source_png(version, champ_id), champ_id)
        total += len(data)
        target = OUT / f"{champ_id}.webp"
        if check:
            if not target.exists() or target.read_bytes() != data:
                stale.append(target.name)
        else:
            target.write_bytes(data)
        print(f"{champ_id:<8} {len(data):>6} B")
    print(f"total    {total:>6} B  (ddragon {version}, Pillow {PIL.__version__})")
    if check:
        for name in stale:
            print(f"stale: {name}")
        sys.exit(1 if stale else 0)


if __name__ == "__main__":
    main()
