# Kustom desktop fonts

Self-hosted WOFF2 subsets, the same files `next/font` serves on the web (05-design §4 and §9.2). No network
font: the window's CSP is `default-src 'self'`, so an offline PC still renders.

| File | Face | Subset | Licence |
|---|---|---|---|
| `atkinson-hyperlegible-next-latin.woff2` | Atkinson Hyperlegible Next, variable 200–800 | latin | SIL OFL 1.1, `OFL-Atkinson.txt` |
| `atkinson-hyperlegible-next-latin-ext.woff2` | Atkinson Hyperlegible Next, variable 200–800 | latin-ext | SIL OFL 1.1, `OFL-Atkinson.txt` |
| `martian-mono-latin.woff2` | Martian Mono, variable 100–800, wdth 75–112.5 | latin | SIL OFL 1.1, `OFL-MartianMono.txt` |

Archivo is not shipped: the `▍KUSTOM` lockup is an inline SVG with outlined letters (Archivo 900 at wdth 62).
