# Tauri shell (M12 / M6)

Borderless always-on-top window config for when the build machine has a Rust toolchain.
Until then, `pnpm --filter overlay build:win` ships the Node SEA + Edge app-mode panel, which
is the same UI and the same LCU/API logic.

To build the native shell later:

```
# install Rust, then:
cd apps/overlay
pnpm exec tauri build
```

The TypeScript watcher in `src/` remains the source of truth for phase detection and API fetches;
the Tauri window would load `src/ui` the way Edge does today.
