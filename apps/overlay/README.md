# Kustom Overlay — retired as a product

**Do not ship `KustomOverlay.exe`.** As of 2026-09-23 (decision in `docs/04-decisions.md`), Overlay is a
**mode of `Kustom.exe`** in `apps/companion`: Host (token) and Overlay (no token). The panel code lives under
`apps/companion/src/panel` and `apps/companion/desktop/overlay`.

This package is kept only as a reference for the earlier M12 SEA experiment. Prefer:

```bash
pnpm --filter companion dev -- --mode overlay
pnpm --filter companion tauri:dev
```

`GET /api/overlay?puuid=` on the web app remains the public API both modes call.
