# Kustom

Kustom is a small Windows app for the friend who hosts your group's customs. It sits next to the League client,
tells the site who is in the lobby and who won, and opens the custom and sends the invites when someone taps
**Start a lobby** on the site. Nobody has to pick teams or report scores. It never plays for you: it stays out
of champ select and out of the game.

Only one PC per lobby needs it, and it has to be an admin's. Everyone else just plays and installs nothing.

## 1. Install it

Download `Kustom-setup.exe` from the Kustom site (your group's admin page has a **Download Kustom** link) and
double-click it. It installs just for you, so it never asks for an administrator password, and it opens Kustom
when it is done. You do not need a GitHub account.

Windows may warn you because Kustom isn't signed yet. Click **More info**, then **Run anyway**.

## 2. Link it to your group

Kustom asks for a code the first time. Get a code on the site: admins from **Set up your PC as
host** on the admin home, everyone else from their invite link. Open League and sign in with your own account, then type the six letters and
numbers into Kustom and press **Link**.

When it works, Kustom shows **Recording for** and your group's name. That is all the setup there is.

If you are in more than one group, link each one the same way (**Link another group** in Kustom) and pick
the one you are hosting with **Switch group**.

## 3. Leave it running

That is the whole job. Kustom lives in the tray, next to the clock, and starts with Windows. Play League as
usual. When you are in a custom lobby with the others, the site shows who is in. Once everyone is there, an
admin taps **Roll teams** and the teams show up on the site and in Discord. The result lands on its own when
the game ends, and Kustom shows it under **Last game**.

Closing the window just tucks Kustom into the tray. To stop it, right-click the tray icon and choose **Quit
Kustom**. If it is not running when a game ends, Kustom usually finds that game later in League's match
history, so it turns up late instead of never.

## Updates

Kustom updates itself. It downloads the update in the background and restarts on its own at a quiet moment.
It never restarts while you are in a lobby, in champ select or in a game, or while a finished game is still
waiting to be sent, so an update can't cost you a game. If you open Kustom while an update is waiting, it shows
**Update ready** with a **Restart now** button. Press it at a bad moment and Kustom restarts right after the
game instead.

## If something looks wrong

If Kustom says **Can't find League**, open League, or press **Browse…** and pick your League of Legends folder.

If Kustom says the old Kustom is still running, close the old one (look in the tray by the clock, or for its
own window), then press **Retry**.

Kustom writes down everything it did, and none of it is secret. In Kustom, press **Open logs**, or press
Windows+R, type `%APPDATA%\customs-night\logs` and press Enter. Send the newest file to whoever set up your
group.

Kustom isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.

---

## Building it (for us)

Everything above the rule is the friend-facing copy: `scripts/release` ships it beside the installer as
`README.txt` and as the release notes. Change it here only. What follows is for whoever builds and publishes.

### The Rust app (M17, 1.0.0 on)

```
src-tauri/src/lib.rs      Tauri glue: plugins, the window's events, the tray, the webview's commands
src-tauri/src/app.rs      the controller: model, host status, Restart now; no Tauri types, so tests fake the shell
src-tauri/src/model.rs    every screen as data (docs/05-design.md section 9)
src-tauri/src/updater.rs  the update schedule and the real updater (below)
crates/engine/            the host engine as a library: lockfile discovery, LCU, watchers, API client, queue
```

```
cargo test --workspace                                   # from apps/companion
cargo clippy --workspace --all-targets -- -D warnings
pnpm --filter companion tauri:dev                        # CUSTOMS_NIGHT_CONFIG_DIR=<dir> for a scratch config
pnpm --filter companion tauri:build                      # the NSIS installer
```

Releases are built by CI on a `companion-v<version>` tag and drafted on `suyaser/kustom-releases`; the steps,
the signing key and the secrets are in `docs/runbooks/companion-release.md`.

**Updates (M17.12).** `tauri-plugin-updater` reads `latest.json` from
`https://github.com/suyaser/kustom-releases/releases/latest/download/latest.json`, downloads the installer
and checks its minisign signature against `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`. The first
check is 20 s after start, then every 6 hours (an hour after a failed check). A failed check is one `warn`
line in the log (`update check failed`, with `kind` of `network`, `not-found`, `signature` or `other`) and
nothing in the window. A verified download makes the update card; installing and relaunching happens only
when `may_restart` (`model.rs`) allows it: League closed or idle in `None`, no game in progress, nothing
queued. `Restart now` while that is false schedules the restart for the moment it clears. On Windows the
installer runs passive (a progress bar, no questions) and relaunches Kustom.

The public key in `tauri.conf.json` is a **placeholder** until the user generates the real one (runbook steps
1 and 3). With the placeholder every check that finds a newer release fails as `signature` in the log, which is
the safe failure; the release workflow refuses to publish while it is a placeholder.

The updater tests (`src-tauri/tests/updater.rs`) run the real plugin on Tauri's mock runtime against a local
HTTP server, with an installer signed by a throwaway minisign key made in memory.

### The TypeScript engine (0.3.x; retired by M17.14)

Kept until the Windows night (M17.13) has passed. Everything below this line describes it, not the Rust app.

```
src/main.ts          startup, flags (--version, --help), signals
src/config.ts        %APPDATA%\customs-night\config.json, the first-run prompt, DEFAULT_API_BASE
src/connection.ts    the state machine: disconnected -> connected -> watching, reconnect forever
src/lobbyWatcher.ts  POST /api/companion/lobby on every roster change (M2.2)
src/gameWatcher.ts   end-of-game capture, disk queue, POST /api/companion/game (M2.3)
src/rankSync.ts      own rank every 6 h, other ranks when the server asks (M2.4)
src/backfill.ts      past customs from match history, 60 s after connect then every 6 h, via the queue (M5.1)
src/commandRunner.ts GET /api/companion/commands every 5 s while the client is up; create lobby / invite /
                     switch side through packages/lcu; ack or nack. Each kind gated on its docs/03 row (M4.1)
src/executed.ts      commands-done.json: the execute-once record a lost ack is re-sent from (M4.1)
src/verifyCommands.ts  --verify-commands: the human-run live probe of the three writes; report + fixtures (M4.1)
src/log.ts           daily JSON log file (debug) plus the console (info)
build/               the release build (M2.6): bundle, exe, publish
```

### The token prompt (M2.19)

The first Windows run of 0.1.0 saved a corrupted token: Windows Terminal wraps a paste in bracketed-paste
markers (`ESC[200~` ... `ESC[201~`), the raw-mode reader dropped the `ESC` and kept `[200~`, and the API said
401 to `[200~<token>[201~`. Since 0.1.1 the hidden prompt (`HiddenLineReader` in `src/config.ts`) swallows
whole escape sequences even across chunk boundaries, and every path the token comes in by — the hidden prompt,
a piped stdin, `--show-token`, and `config.json` itself — goes through `cleanTokenInput`, which strips escape
sequences, control characters, surrounding whitespace and quotes.

A token from the admin page is 32 random bytes as base64url: exactly 43 characters from `A-Z a-z 0-9 - _`
(`apps/web/lib/companionAuth.ts` `mintCompanionToken`; the shape is pinned in `src/config.ts` and
`config.test.ts` checks it against the same `randomBytes(32).toString('base64url')`). A paste of any other
shape gets one sentence — `That does not look like a token from the admin page (expected 43 characters,
letters, digits, - and _). Try pasting it again.` — and another go, three in all, then the companion says so
and exits. A saved `config.json` whose token has the wrong shape is treated as "no token": the prompt runs
again with `the saved token does not look like one from the admin page`, and `apiBase` is kept. That is what
fixes the PC that ran 0.1.0: start 0.1.1, paste again.

```
Kustom.exe --show-token                # echo the token as it is typed (console only; never the log)
set CUSTOMS_NIGHT_SHOW_TOKEN=1 && Kustom.exe   # the same, for a shortcut that cannot pass flags
```

`--show-token` exists for a terminal that cannot paste into a hidden prompt (some remote-desktop and
older-console setups). It changes only what the console shows while typing; the token is still never written
to the log, which knows it only as a secret to redact.

### Verifying the lobby writes (M4.1)

```
pnpm --filter companion verify-commands       # from the repo: fixtures land in packages/lcu/fixtures/<patch>/
Kustom.exe --verify-commands            # packaged: fixtures land in %APPDATA%\customs-night\fixtures\<patch>\
set CUSTOMS_NIGHT_VERIFY_COMMANDS=1 && Kustom.exe   # the same, for a shortcut that cannot pass flags
```

The three lobby writes (create, invite, switch side) are `unverified` in `docs/03-lcu-reference.md`, so the
command runner refuses each kind (`endpoint_unverified`) until a person has run this mode against a live client
and pasted the report back. It needs the client in `None` or `Lobby`, one friend online, no token and no API.
The first run (16.17, 2026-09-09) showed the community create body is refused (`500 INVALID_LOBBY`), so the
second edition sends what the client's own lobby UI sends: it reads the Create Custom dialog data
(`/lol-game-queues/v1/custom`, `/queues`), prints the Summoner's Rift entries and asks which id to use (Enter
takes the default), then POSTs a ranked list of create bodies in order, stopping at the first the client
accepts; then one invite POST, then one `POST /lol-lobby/v2/lobby/team/TEAM1|TEAM2` for the side you are not
on (the draft and full-side repeats are opt-in). It asks before every write step, prints request, status and
body shape, and writes `%APPDATA%\customs-night\verify-commands-<patch>-<date>.txt` plus one fixture per
attempt and per dialog read. It never closes the lobby it makes: close it from the client afterwards. Paste the
report and the fixtures back; the engineer writes the reference rows and flips `LOBBY_WRITE_VERIFICATION` in
`packages/lcu/src/writes.ts`. Nothing in this mode flips anything itself.

### Finding a League that is not in `C:\Riot Games` (M2.19)

Discovery is `@customs/lcu` `createLockfileDiscovery`, and runs in this order: `lockfilePath` from
`config.json`, then the path it last found through the process list, then the platform default, then — on
Windows only, and only when none of those exist — the process list: PowerShell `Get-CimInstance Win32_Process`
for `LeagueClientUx.exe` (`wmic` if PowerShell cannot start), the lockfile beside its `ExecutablePath`, and
failing that `--app-port=` / `--remoting-auth-token=` off its `CommandLine`. The shell-out runs at most once
per 15 s and never throws; if it fails, the companion keeps polling the paths. `waiting for the League client`
prints what was tried plus `If League is installed somewhere else, add lockfilePath to config.json` whenever
no `lockfilePath` is configured:

```json
{ "apiBase": "https://playkustom.com", "companionToken": "...", "lockfilePath": "D:\\Games\\Riot Games\\League of Legends\\lockfile" }
```

The manual path always wins and is the way out if the process list is not available to a non-admin user (a
client started elevated hides its `ExecutablePath` and `CommandLine`). Status of the fallback is
`observed on Windows: pending` in `docs/03-lcu-reference.md` until a Windows run with a custom install shows
`League client found at a non-default install` in the log.

### Running from source

```
pnpm --filter companion dev            # tsx src/main.ts; API origin defaults to http://localhost:3000
CUSTOMS_NIGHT_CONFIG_DIR=/tmp/cn pnpm --filter companion dev   # a throwaway config directory
CUSTOMS_NIGHT_LOG_LEVEL=debug pnpm --filter companion dev      # everything the file gets, on the console too
```

### Building the exe

One file, `dist/Kustom.exe`, no installer, no sidecar. The version is `package.json` `version`.

The product is Kustom and the exe, the console banner (`Kustom companion <version> starting`), `--help`, the
first-run prompt and the release title all say so (M2.20, 0.1.3). `Customs Night` stays the repo's codename:
the package name, the `CUSTOMS_NIGHT_*` environment variables and esbuild defines, the `User-Agent`
(`customs-night-companion/<version>`), the API's `service: customs-night` health literal, and the
`%APPDATA%\customs-night` config directory, which is a path an existing install already has its token in.

```
pnpm --filter companion bundle       # esbuild: src/main.ts + workspace deps -> dist/kustom.cjs
pnpm --filter companion build:win    # bundle, then Node SEA -> dist/Kustom.exe + Kustom.exe.sha256
pnpm --filter companion build:host   # the same, for this machine (macOS/Linux): a runnable check of the pipeline
pnpm --filter companion publish:gh   # GitHub release v<version> with the exe, its hash and README.txt
pnpm --filter companion release      # build:win, then publish:gh
```

How it works (`build/sea.ts`): the bundle is a single CommonJS file with the API origin, the version and
Riot's root certificate baked in as esbuild `define`s. `node --experimental-sea-config` turns it into a
single-executable blob, and `postject` injects the blob into a stock `node.exe` (its Authenticode signature
is stripped first). The Node release is pinned in `build/config.ts` (`NODE_RELEASE`), and the build downloads
that exact release from nodejs.org, once, into `build/cache/` (gitignored), verified against
`SHASUMS256.txt`: a host copy to make the blob (Node requires the blob and the binary to be the same
version) and the `win-x64/node.exe` to inject into. On a Windows build host the one `node.exe` serves both.

Built on this Mac (2026-09-08), cross-target from macOS: `build:host` produced a macOS binary of the same
bundle that reached `watching` against the live client here, and the Windows exe's PE header, stripped
signature, fuse and blob were checked by hand. The first run on the Windows PC is the M2.6 acceptance and is
written up in `docs/02-milestones.md` when it happens. The exe is not code-signed: SmartScreen's "More info,
Run anyway" is a README sentence.

The API origin defaults to the deployed Vercel URL (`RELEASE_API_BASE`); `CUSTOMS_NIGHT_API_BASE` overrides it
for a build against another deployment. A `config.json` with its own `apiBase` always wins over the baked one.

### Publishing

Releases are GitHub release assets on the public repo `suyaser/kustom-releases` (the app repo stays
private; the Supabase bucket could not take a 90 MB object on the Free plan). One release per version, tag
`v<version>`, assets `Kustom.exe`, `Kustom.exe.sha256` and `README.txt`. The link for the group
chat never changes:

```
https://github.com/suyaser/kustom-releases/releases/latest/download/Kustom.exe
```

`pnpm --filter companion publish:gh` runs `gh release create` (the script is `publish:gh` because pnpm intercepts a script named `publish`) with the `gh` CLI's own login (`gh auth login`
once; no token variable). If `gh` is not logged in it prints the exact command and exits 1. Bump `version`
in `package.json` before a release: a tag that already exists is refused by GitHub, which is the point.

### Tests

`pnpm --filter companion test` runs against the in-process fake client and fake API (no League, no network).
`build/bundle.test.ts` bundles to a temp file and runs it under plain `node` with `--version` and `--help`,
so the packaging path is checked on every machine; the exe itself only runs on Windows.
