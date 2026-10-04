# Runbook: release Kustom (the Rust companion, M17.12)

Written 2026-10-04 by `platform-engineer` for M17.12 part 1 (the pipeline). **Who runs it: the user, every step.**
No agent generates the key, holds it, adds a secret, pushes a release tag or publishes a release.

What exists after M17.12 part 1:

- `.github/workflows/companion-release.yml`: on a `companion-v<version>` tag, on `windows-latest`: `cargo test`,
  `tauri build` (NSIS), updater signing, the size gate, `latest.json`, and a **draft** release on
  `suyaser/kustom-releases` with every asset. Never runs on a pull request or a branch push. **Run workflow**
  (Actions tab, `workflow_dispatch`) is a dry run of the same build that uploads the assets as a workflow
  artifact and never creates a release.
- `apps/companion/src-tauri/tauri.conf.json` `plugins.updater`: the endpoint
  `https://github.com/suyaser/kustom-releases/releases/latest/download/latest.json` and a **placeholder** public key.
- `apps/companion/scripts/release/`: every rule the workflow enforces, unit-tested (`pnpm --filter companion test`).

**Wired in M17.12 part 2:** the app checks for updates 20 seconds after start and then every 6 hours (an hour
after a failed check), downloads in the background and verifies the installer's signature against
`plugins.updater.pubkey`, then shows the **Update ready** card. It restarts by itself only when League is closed
or idle in `None`, no game is in progress and no block is queued; **Restart now** while that is false restarts
the moment it clears (`apps/companion/src-tauri/src/updater.rs`, `app.rs`). A failed check (offline, no
`latest.json`, a signature that does not verify) is one `update check failed` line in the log
(`%APPDATA%\customs-night\logs`) and nothing on screen.

**Where your public key goes:** only `plugins.updater.pubkey` in `apps/companion/src-tauri/tauri.conf.json`
(step 3 below). It stays the placeholder until you do that; the workflow's **Publish guard** refuses to publish
a release while it is, and an app built with the placeholder fails every update check as `kind=signature`
(harmless, and it says so in the log). Nothing else in the code or the workflow holds a key.

A tag stops at the workflow's **Publish guard** step until the pubkey is real. A dry run works today.

## What gets published

One release per version on `suyaser/kustom-releases`, tag `v<version>` (the same convention as 0.x), title
`Kustom <version>`, notes = the friend part of `apps/companion/README.md`. Assets:

| Asset | What |
|---|---|
| `Kustom-setup.exe` | The NSIS installer. The stable name from 1.0.0 on (decision row 2026-10-04). |
| `Kustom-setup.exe.sig` | The updater signature of that installer. |
| `Kustom-setup.exe.sha256` | `<sha256>  Kustom-setup.exe`, for `certutil -hashfile`. |
| `Kustom.exe` | The same installer under the 0.3.x name, until M17.14, so the link pasted in every group chat still downloads something that works. |
| `Kustom.exe.sha256` | Its checksum line. |
| `latest.json` | The updater manifest. Its URL points at this version's `Kustom-setup.exe` (`releases/download/v<version>/...`, never `latest`). |
| `README.txt` | The friend part of `apps/companion/README.md`. |

**The size gate** (decision row 2026-10-04): the installer is 15 MB or less and the installed exe 20 MB or less,
in decimal MB (15,000,000 and 20,000,000 bytes; the stricter reading). The workflow installs the build silently
on the runner, measures the exe that landed, prints both numbers in the **Size gate** step and the run summary,
and fails above either.

## The three secrets

Repository secrets on **`suyaser/kustom`** (this repo: the workflow runs here and publishes to the other one).

| Secret | What it holds |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | The **content** of the private key file `tauri signer generate` writes (one line of base64). Not a path. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | The password you gave that key. |
| `KUSTOM_RELEASES_TOKEN` | A fine-grained personal access token: resource owner `suyaser`, **Only select repositories: `suyaser/kustom-releases`**, permission **Contents: Read and write** (Metadata: Read is added by itself). Nothing else. |

## One-time setup (the user)

Do these once, in this order, any time before the first tag. Steps 1 to 3 can be done today; nothing breaks if
the key exists before M17.8.

### 1. Generate the updater key, outside the repo

On this Mac, from the repo:

```sh
mkdir -p ~/.tauri
cd /Users/suyaser/lol/apps/companion
pnpm tauri signer generate -w ~/.tauri/kustom.key
```

It asks for a password; use a long one. It writes `~/.tauri/kustom.key` (private) and `~/.tauri/kustom.key.pub`
(public). Then:

- Put the private key file's content **and** the password in your password manager, as one entry.
- Never copy `~/.tauri/kustom.key` into the repo, a chat, an issue or an agent conversation.

**If the private key or its password is lost, every installed Kustom can never update again**: each friend must
download and install the next version by hand, and that version must carry a new public key. There is no recovery
and no rotation for apps already installed. Keep the password-manager copy.

### 2. Add the three secrets

On `https://github.com/suyaser/kustom/settings/secrets/actions`, **New repository secret**, three times, or with
the `gh` CLI (logged in as you):

```sh
gh secret set TAURI_SIGNING_PRIVATE_KEY --repo suyaser/kustom < ~/.tauri/kustom.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo suyaser/kustom   # prompts; paste the password
gh secret set KUSTOM_RELEASES_TOKEN --repo suyaser/kustom                # prompts; paste the token
```

For the token: `https://github.com/settings/personal-access-tokens/new`, settings as in the table above. Give it
an expiry you will notice (a year) and put the date in your calendar; an expired token fails only the last step
(**Draft release on kustom-releases**), with a 401 in its log.

### 3. Put the public key in the config

Replace `REPLACE_WITH_THE_PUBLIC_KEY_FROM_TAURI_SIGNER_GENERATE` in
`apps/companion/src-tauri/tauri.conf.json` (`plugins.updater.pubkey`) with the one line in
`~/.tauri/kustom.key.pub`, and commit it (`companion: updater public key (M17.12)`). The public key is safe to
commit; it is how every installed app checks an update came from you. Then check:

```sh
cd /Users/suyaser/lol/apps/companion
pnpm exec tsx scripts/release/cli.ts pubkey-state     # prints: set
```

A dry run (**Actions → Companion release → Run workflow**) after steps 2 and 3 signs with your real key, so its
`latest.json` is the real thing; before them it signs with a throwaway key and says so in a warning.

### Trying the updater without your key (what the tests do)

`cargo test -p kustom-companion --test updater` (from `apps/companion`) runs the real updater plugin against a
local HTTP server, with an installer signed by a **throwaway** key generated in memory for each test. It needs
no secret and writes no key to disk. For a hand check, `pnpm exec tauri signer generate --ci -p "" -w
<a temp dir>/k.key` makes a throwaway pair the same way; never put one in the repo, and never use it in
`tauri.conf.json`.

## Every release

### 4. Bump the version and push a tag

The version lives in two files, and the workflow refuses a tag that disagrees with either:

- `apps/companion/src-tauri/tauri.conf.json` `"version"` (the one the updater compares), and
- `apps/companion/src-tauri/Cargo.toml` `[package] version`.

Set both (the first Rust release is `1.0.0`), then refresh the lockfile, which records the crate's version
(the workflow builds with `--locked`):

```sh
cd /Users/suyaser/lol/apps/companion
cargo check -p kustom-companion        # updates Cargo.lock's kustom-companion entry
git commit -am "companion: 1.0.0 (M17.12)"
```

Merge that to `main` with everything it should ship, then tag the merged commit and push the tag:

```sh
git tag companion-v1.0.0
git push origin companion-v1.0.0
```

### 5. Check the draft

The run is at **Actions → Companion release** (about 15 to 20 minutes cold). Then on
`https://github.com/suyaser/kustom-releases/releases`, the draft `v1.0.0`:

- [ ] Seven assets, as in the table above.
- [ ] The run's summary shows two `PASS` lines from the size gate, with the byte counts.
- [ ] `latest.json`: `version` is the tag's, both `platforms` URLs end in `/v1.0.0/Kustom-setup.exe`, the
      `signature` is a long base64 string.
- [ ] Download `Kustom-setup.exe` from the draft on the Windows PC and run Windows round-trip 1 below on it.

A failed run that never reached the last step left nothing on `kustom-releases`. A rerun of the same tag
replaces the assets on an existing **draft**; a version already **published** is never touched (bump the version
and push a new tag).

### 6. Publish

**Ship together (the user, 2026-10-04):** 2.0 and 1.0 release together, so publish 1.0.0 as the latest release
right after round-trip 1 passes and at the 2.0 deploy, not after M17.13. Publishing moves `releases/latest` (so `/download`, the nav's Get Kustom and every
`latest/download/...` link) to the new release at once.

On the draft: **Edit**, tick **Set as the latest release**, **Publish release**. If you need friends to test it
before then without moving `latest`, publish it as a **pre-release** instead: its assets download from the
release page and `latest` stays where it is (the updater also ignores it, because it reads `latest`).

**The web flip has already landed on `redesign-2.0` (2026-10-04)**, so it deploys with 2.0. For the record, it was: `RELEASE_ASSET` in
`apps/web/lib/release.ts` becomes `Kustom-setup.exe` (one line; `nav.test.ts` and `landing.test.tsx` change with
it) and `/download`'s 0.3.x copy (Host and Overlay modes, "Grab ... there") moves to the Rust app's.

**An emergency 0.3.x re-publish** (`pnpm --filter companion publish:gh`, kept until M17.14) after a Rust release
is out would make the old version `latest` and point every updater at nothing newer. Untick **Set as the latest
release** on it, or don't do it.

## Release notes for the record

- **1.0.1**: default API origin fix. 1.0.0's installer defaulted to `http://localhost:3000` (the build never set
  `CUSTOMS_NIGHT_API_BASE`), so a fresh install could not pair. 1.0.1 bakes in `https://playkustom.com` (the owner's domain, 2026-10-04); `kustom-delta.vercel.app` stays served for older configs.
  A saved `apiBase` of `https://kustom-delta.vercel.app` (now a 308 redirect, which the transport never follows) is replaced by `https://playkustom.com` on load and rewritten once in `config.json` (`LEGACY_API_BASES` in `config/mod.rs`); other origins are untouched.
  A 1.0.0 install updates to it through the updater endpoint in `tauri.conf.json` (kustom-releases
  `latest.json`), which is independent of the API origin. Stuck-on-1.0.0 workaround: create
  `%APPDATA%\customs-night\config.json` containing `{"apiBase":"https://kustom-delta.vercel.app"}`, restart.

## Windows round-trip 1 (M17.12 acceptance)

On the Windows PC that plays League, with the draft's `Kustom-setup.exe` (or the dry run's artifact zip, before
the secrets exist). Waits for M17.8: before it, the installed app is the M6 shell and the steps below do not
apply. Write the results up under M17.12 in `docs/02-milestones.md` (or paste them to the lead): each box, the two
sizes, the Kustom version, the League patch, and the log lines named below.

- [ ] **Checksum.** `certutil -hashfile Kustom-setup.exe SHA256` matches `Kustom-setup.exe.sha256`.
- [ ] **Installer size.** Right-click → Properties: **Size** in bytes is 15,000,000 or less and matches the
      workflow log's installer line.
- [ ] **Install.** Double-click. SmartScreen may say it doesn't recognise the app: **More info**, **Run anyway**
      (the /download note says the same). The installer finishes without asking for an admin password (it
      installs for this Windows user only).
- [ ] **Installed exe size.** `%LOCALAPPDATA%\Kustom\` (paste in Explorer's address bar): the app exe's
      Properties **Size** is 20,000,000 bytes or less and matches the workflow log's installed-exe line.
- [ ] **Discovery, default install.** League installed in `C:\Riot Games\League of Legends`, client open and
      signed in, no `lockfilePath` in `%APPDATA%\customs-night\config.json`: Kustom says League is connected within
      a few seconds. The newest `%APPDATA%\customs-night\logs\companion-<date>.log` shows the lockfile found at the
      default path.
- [ ] **Discovery, non-default install (process list).** With League installed somewhere else (another drive or
      folder, for example `D:\Games\League of Legends`), still no `lockfilePath`: Kustom connects within about 15
      seconds, and the log shows discovery through the Windows process list (PowerShell `Get-CimInstance`, or
      `wmic`). If you have only one install, a second install is the test; moving the folder is not, the client
      repairs it. The lead updates docs/03's "Process args fallback" row from this.
- [ ] **Pair.** On production `https://kustom-delta.vercel.app/g/customs/admin`, **Set up this PC as host** →
      **Get a code**; type the six characters into Kustom's Link screen. Kustom shows the group `customs` and the
      admin page's checklist moves; the Hosts page lists the new `Kustom (paired)` token. No token is shown
      anywhere, and the log has a redaction marker wherever a token would have been.
- [ ] **A lobby on production.** Create a custom lobby in League (or press `Start a lobby` on
      `/g/customs` and let Kustom create it). Within a few seconds `/g/customs` shows the lobby with the people
      in it. The log shows the lobby POST answered 2xx.
- [ ] **Leave it installed.** Round-trip 2 (M17.13, the Windows night) runs on this install.

## When something fails

| Step that failed | Why, usually | Fix |
|---|---|---|
| Publish guard | Pubkey placeholder, or the app is still the M6 shell | Step 3; **Run workflow** meanwhile |
| Version | Tag, `tauri.conf.json` and `Cargo.toml` disagree | Step 4, then delete and re-push the tag: `git push --delete origin companion-v1.0.0`, `git tag -d companion-v1.0.0` |
| cargo test | A real test failure, or `Cargo.lock` not refreshed after the version bump (`--locked`) | `cargo check -p kustom-companion`, commit, re-tag |
| Build the NSIS installer | `TAURI_SIGNING_PRIVATE_KEY` missing, wrong, or its password wrong ("failed to decode" / "Wrong password") | Step 2: the secret is the file's content, not its path |
| Install it silently | The installer did not install on a clean Windows runner | A real bug in the installer: hand the log to the lead |
| Size gate | The installer or the exe grew past 15 MB / 20 MB | Not a setting to raise: hand the two numbers to the lead (the limits are a decision row) |
| Draft release on kustom-releases | `KUSTOM_RELEASES_TOKEN` missing, expired, or without Contents write on `kustom-releases`; or that version is already published | Step 2's token; or bump the version |
