"""Cuts the app's three webfonts into trimmed, split woff2 files (docs/05-design.md section 4.1, M19).

    pnpm --filter web font-subsets            # writes app/fonts/*.woff2, app/fonts/OFL.txt, app/fonts.ts
    pnpm --filter web font-subsets --check    # regenerates in memory; exit 1 on any byte difference

Run by hand, outputs committed; nothing here runs at build time. Needs Python 3 with fontTools and
brotli (`pip install fonttools brotli`, or a venv). `--check` is byte-exact only with the same fontTools
and brotli versions (woff2 is brotli output); the versions that wrote the committed files are pinned
below and a mismatch is reported before the comparison.

Inputs: the three variable TTFs from github.com/google/fonts at a pinned commit, downloaded once into
apps/web/node_modules/.cache/font-subsets/ and checked against their sha256.

For each face (text Atkinson Hyperlegible Next, mono Martian Mono, display Archivo):
  1. instance the variable font to the axis ranges the app draws (instancer clamps the default into the
     range; the default is deliberately not moved, see 4.1), and reload the result from bytes;
  2. subset it twice by code point: a small **core** file (printable ASCII and the app's punctuation,
     preloaded on every page) and a **rest** file (the rest of Google's latin + latin-ext coverage,
     fetched only when a glyph in its unicode-range is on screen).
The display face is upper case only, so its core leaves out a-z (the browser matches unicode-range after
text-transform), and its rest carries a-z.

app/fonts.ts is generated too: next/font/local only accepts literal arguments, so the unicode-range of
each file (read back from the file's own cmap) is written into it here.
"""

from __future__ import annotations

import hashlib
import io
import sys
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import brotli
import fontTools
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "app" / "fonts"
FONTS_TS = ROOT / "app" / "fonts.ts"
CACHE = ROOT / "node_modules" / ".cache" / "font-subsets"

GOOGLE_FONTS_COMMIT = "9710da1eacb3be272583c3224dcb70f9da6eadbb"  # google/fonts main, 2026-09-30
FONTTOOLS_VERSION = "4.60.2"
BROTLI_VERSION = "1.2.0"


@dataclass(frozen=True)
class Face:
    key: str  # text | mono | display: file prefix and CSS variable stem
    family: str
    path: str  # under google/fonts at the pinned commit
    sha256: str
    axes: dict[str, tuple[float, float]]
    weight: str  # next/font/local `weight`
    stretch: str | None  # `font-stretch` declaration, for faces with a width axis
    copyright: str


FACES = [
    Face(
        key="text",
        family="Atkinson Hyperlegible Next",
        path="ofl/atkinsonhyperlegiblenext/AtkinsonHyperlegibleNext[wght].ttf",
        sha256="5a455d1cfa099b601ab70751bb9673e8fe1854dc4500c80e1a220d0d75e31745",
        axes={"wght": (400, 700)},
        weight="400 700",
        stretch=None,
        copyright="Copyright 2020-2024 The Atkinson Hyperlegible Next Project Authors "
        "(https://github.com/googlefonts/atkinson-hyperlegible-next)",
    ),
    Face(
        key="mono",
        family="Martian Mono",
        path="ofl/martianmono/MartianMono[wdth,wght].ttf",
        sha256="c3467843ec1c2574b05fbcfd7147c7bfbcf63ddca8fc2bcb9d117f1bfb1b22e7",
        axes={"wght": (400, 700), "wdth": (75, 100)},
        weight="400 700",
        stretch="75% 100%",
        copyright="Copyright 2021 The Martian Mono Project Authors (https://github.com/evilmartians/mono)",
    ),
    Face(
        key="display",
        family="Archivo",
        path="ofl/archivo/Archivo[wdth,wght].ttf",
        sha256="0e094a7d3c7c4c25cf1310c4b30014f1dae9332220b1c2c88f4fa996f0b05053",
        axes={"wght": (800, 900), "wdth": (62, 70)},
        weight="800 900",
        stretch="62% 70%",
        copyright="Copyright 2020 The Archivo Project Authors (https://github.com/Omnibus-Type/Archivo)",
    ),
]
OFL_SOURCE = "ofl/archivo/OFL.txt"  # the license body; identical in all three families
OFL_SHA256 = "108b4e57c9c796d3d38d0428ca7ee39de47ad93187302718d9b2d8864b9b716b"


def ranges(spec: str) -> set[int]:
    """'0020-007E, 00A0' -> the code points."""
    out: set[int] = set()
    for part in spec.replace(" ", "").split(","):
        lo, _, hi = part.partition("-")
        out.update(range(int(lo, 16), int(hi or lo, 16) + 1))
    return out


# Printable ASCII plus nbsp, the middle-dot separator, multiplication sign, en/em dash, curly quotes,
# bullet, ellipsis, up/down arrows and the real minus (4.1, point 2), plus three the app's own copy
# draws on group pages: `±` (a zero rating delta, `±0`) and the single guillemets `‹ ›` (the mode
# card's "See what's open ›"). Without them an all-ASCII tonight page fetched text rest (18 KB).
CORE = ranges(
    "0020-007E, 00A0, 00B1, 00B7, 00D7, 2013, 2014, 2019, 201C, 201D, 2022, 2026, 2039, 203A, 2191, 2193,"
    "2212"
)
LOWER = ranges("0061-007A")

# Google Fonts' latin and latin-ext unicode-ranges, as served by fonts.googleapis.com.
GOOGLE_LATIN = ranges(
    "0000-00FF, 0131, 0152-0153, 02BB-02BC, 02C6, 02DA, 02DC, 0304, 0308, 0329, 2000-206F, 20AC, 2122,"
    "2191, 2193, 2212, 2215, FEFF, FFFD"
)
GOOGLE_LATIN_EXT = ranges(
    "0100-02BA, 02BD-02C5, 02C7-02CC, 02CE-02D7, 02DD-02FF, 0304, 0308, 0329, 1D00-1DBF, 1E00-1E9F,"
    "1EF2-1EFF, 2020, 20A0-20AB, 20AD-20C0, 2113, 2C60-2C7F, A720-A7FF"
)
# Never drawn as a glyph: C0/C1 controls. Left out so a stray control code cannot pull a rest file.
CONTROLS = ranges("0000-001F, 007F-009F")
COVERAGE = (GOOGLE_LATIN | GOOGLE_LATIN_EXT) - CONTROLS

# OpenType features kept: the ones browsers apply on their own (shaping, marks, kerning, ligatures,
# contextual alternates, variation substitutions), plus `tnum`, which the app turns on with
# `tabular-nums` on every numeric run (section 4). Not `*` (as 4.1 first wrote): the google/fonts repo
# files carry alternates (aalt, case, frac/numr/dnom, sups/subs, ordn, onum, zero, cv01/02) that no
# page asks for, and their closure cost 7.3 KB across the three cores (49.2 KB with `*`, over the
# 45 KB budget; 40.5 KB with this list). Add a tag here if the app starts using its CSS property.
LAYOUT_FEATURES = [
    "calt", "ccmp", "clig", "curs", "kern", "liga", "locl", "mark", "mkmk", "rclt", "rlig", "rvrn", "tnum",
]


def fetch(path: str, sha256: str) -> bytes:
    CACHE.mkdir(parents=True, exist_ok=True)
    local = CACHE / f"{GOOGLE_FONTS_COMMIT[:12]}-{Path(path).name}"
    if not local.exists():
        url = f"https://raw.githubusercontent.com/google/fonts/{GOOGLE_FONTS_COMMIT}/" + urllib.request.quote(path)
        print(f"download {url}", file=sys.stderr)
        with urllib.request.urlopen(url) as response:
            local.write_bytes(response.read())
    data = local.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if sha256 and digest != sha256:
        sys.exit(f"{local}: sha256 {digest}, expected {sha256}. Delete it and run again.")
    if not sha256:
        print(f"note: {path} sha256 {digest} (not pinned yet)", file=sys.stderr)
    return data


def instance(face: Face, source: bytes) -> bytes:
    font = TTFont(io.BytesIO(source), recalcTimestamp=False)
    # (min, max) per axis: the instancer keeps the face's default if it is inside, else clamps it.
    trimmed = instancer.instantiateVariableFont(font, dict(face.axes), updateFontNames=False)
    buffer = io.BytesIO()
    trimmed.save(buffer)
    return buffer.getvalue()


def cut(instanced: bytes, unicodes: set[int]) -> tuple[bytes, list[int]]:
    """Subset the instanced font to `unicodes` (missing ones skipped), as woff2. Returns bytes + cmap."""
    # Reload from bytes: subsetting the in-memory instance throws on lazily loaded glyphs (4.1).
    font = TTFont(io.BytesIO(instanced), recalcTimestamp=False)
    options = subset.Options()
    options.layout_features = LAYOUT_FEATURES
    options.hinting = False
    options.notdef_outline = True
    options.flavor = "woff2"
    options.ignore_missing_unicodes = True
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=sorted(unicodes))
    subsetter.subset(font)
    buffer = io.BytesIO()
    font.flavor = "woff2"
    font.save(buffer)
    data = buffer.getvalue()
    mapped = sorted(TTFont(io.BytesIO(data)).getBestCmap().keys())
    return data, mapped


def unicode_range(points: list[int]) -> str:
    """[0x20, 0x21, ..., 0x7E, 0xA0] -> 'U+0020-007E, U+00A0'."""
    spans: list[tuple[int, int]] = []
    for p in points:
        if spans and spans[-1][1] == p - 1:
            spans[-1] = (spans[-1][0], p)
        else:
            spans.append((p, p))
    return ", ".join(f"U+{a:04X}" if a == b else f"U+{a:04X}-{b:04X}" for a, b in spans)


def ofl(body: str) -> str:
    # The license proper starts at its banner; each family's file carries its own copyright line above.
    start = body.index("-----------------------------------------------------------")
    header = [
        "The app's webfonts (docs/05-design.md section 4.1, M19), cut by apps/web/scripts/font-subsets.py from",
        f"the google/fonts variable files at commit {GOOGLE_FONTS_COMMIT}:",
        "text-{core,rest}.woff2 (Atkinson Hyperlegible Next, wght 400-700),",
        "mono-{core,rest}.woff2 (Martian Mono, wght 400-700, wdth 75-100),",
        "display-{core,rest}.woff2 (Archivo, wght 800-900, wdth 62-70).",
        "Instanced to those axis ranges and subset by code point; outlines otherwise unmodified.",
        "",
        *sorted(f.copyright for f in FACES),
        "",
        "This Font Software is licensed under the SIL Open Font License, Version 1.1.",
        "This license is copied below, and is also available with a FAQ at:",
        "http://scripts.sil.org/OFL",
        "",
        "",
    ]
    return "\n".join(header) + body[start:].replace("\r\n", "\n")


FONTS_TS_HEAD = """\
// Generated by apps/web/scripts/font-subsets.py (`pnpm --filter web font-subsets`). Do not edit by hand:
// the unicode-ranges below are read from the files' own cmaps.
import localFont from 'next/font/local';

/**
 * Every webfont the app loads, as CSS variables on <html> (the root layout). `docs/05-design.md`
 * section 4 and 4.1: Atkinson Hyperlegible Next for text, Martian Mono for numbers and role words, and
 * Archivo (its condensed `wdth` end) for the display face, each self-hosted, trimmed to the axis ranges
 * the app draws, and split by `unicode-range` into two files:
 *
 * - **core** (printable ASCII and the app's punctuation; display: upper case only), preloaded on every
 *   page: about 40 KB for all three, the only font bytes before LCP;
 * - **rest** (the rest of Google's latin + latin-ext: `Menaçe`, `Ramzyinhović`), never preloaded and
 *   fetched only when a glyph in its range is on screen.
 *
 * Each call is its own family, so `globals.css` lists core then rest in each stack, then a hand-measured
 * fallback face (`adjustFontFallback: false` here: next/font measures a face at its default instance,
 * not at the condensed widths the app draws). `display: 'swap'` everywhere: a friend opening the
 * WhatsApp link reads the teams in the fallback face rather than wait for a webfont.
 */
"""


def ts_call(face: Face, part: str, file_range: str) -> str:
    name = f"{face.key}{part.capitalize()}"
    # Laid out the way Biome formats it (line width 110), so `pnpm lint` passes on the generated file.
    value = f"      value: '{file_range}',"
    if len(value) > 110:
        value = f"      value:\n        '{file_range}',"
    declarations = ["{\n      prop: 'unicode-range',\n" + value + "\n    }"]
    if face.stretch:
        declarations.insert(0, f"{{ prop: 'font-stretch', value: '{face.stretch}' }}")
    lines = [
        f"const {name} = localFont({{",
        f"  src: './fonts/{face.key}-{part}.woff2',",
        f"  weight: '{face.weight}',",
        "  display: 'swap',",
        f"  preload: {'true' if part == 'core' else 'false'},",
        "  adjustFontFallback: false,",
        "  declarations: [",
        *[f"    {d}," for d in declarations],
        "  ],",
        f"  variable: '--font-{face.key}-{part}',",
        "});",
    ]
    return "\n".join(lines)


def generate() -> dict[Path, bytes]:
    files: dict[Path, bytes] = {}
    calls: list[str] = []
    for face in FACES:
        instanced = instance(face, fetch(face.path, face.sha256))
        core_set = CORE - LOWER if face.key == "display" else CORE
        rest_set = COVERAGE - core_set
        core, core_map = cut(instanced, core_set)
        rest, rest_map = cut(instanced, rest_set)
        # A rest file must never claim a core code point, or an ASCII page would fetch it.
        assert not set(rest_map) & core_set, face.key
        # .notdef and the cmap's own housekeeping aside, the core must be complete for ASCII.
        missing = sorted(ranges("0020-007E") - (LOWER if face.key == "display" else set()) - set(core_map))
        assert not missing, f"{face.key} core lacks {unicode_range(missing)}"
        files[OUT / f"{face.key}-core.woff2"] = core
        files[OUT / f"{face.key}-rest.woff2"] = rest
        calls.append(ts_call(face, "core", unicode_range(core_map)))
        calls.append(ts_call(face, "rest", unicode_range(rest_map)))
        print(
            f"{face.key:8} core {len(core) / 1024:5.1f} KB ({len(core_map)} cp)   "
            f"rest {len(rest) / 1024:5.1f} KB ({len(rest_map)} cp)",
            file=sys.stderr,
        )
    names = [f"{f.key}{p}" for f in FACES for p in ("Core", "Rest")]
    tail = [
        "",
        "/** The class list for <html>: defines the six variables and nothing else. */",
        f"export const fontVariables = [{', '.join(names)}]",
        "  .map((font) => font.variable)",
        "  .join(' ');",
        "",
    ]
    files[FONTS_TS] = (FONTS_TS_HEAD + "\n\n".join(calls) + "\n" + "\n".join(tail)).encode()
    files[OUT / "OFL.txt"] = ofl(fetch(OFL_SOURCE, OFL_SHA256).decode("utf-8")).encode()
    return files


def main() -> None:
    check = "--check" in sys.argv[1:]
    versions = (fontTools.version, brotli.version if hasattr(brotli, "version") else brotli.__version__)
    if versions != (FONTTOOLS_VERSION, BROTLI_VERSION):
        print(
            f"warning: fontTools {versions[0]} / brotli {versions[1]}; the committed files were written with "
            f"{FONTTOOLS_VERSION} / {BROTLI_VERSION}, so woff2 bytes may differ",
            file=sys.stderr,
        )
    files = generate()
    if check:
        stale = [p for p, data in files.items() if not p.exists() or p.read_bytes() != data]
        for p in stale:
            print(f"differs: {p.relative_to(ROOT)}", file=sys.stderr)
        sys.exit(1 if stale else 0)
    OUT.mkdir(parents=True, exist_ok=True)
    for p, data in files.items():
        p.write_bytes(data)
        print(f"wrote {p.relative_to(ROOT)}", file=sys.stderr)


if __name__ == "__main__":
    main()
