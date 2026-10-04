# Customs Night

Team balancer and stats tracker for a friends group that plays League of Legends custom 5v5s every night.
Zero-input by design: a desktop companion reads the League client, the server balances teams and keeps ratings,
Discord shows the result. Nobody checks in, nobody reports scores.

Read `docs/00-product.md` once. Then read the doc for the layer you are touching. `docs/02-milestones.md` is the
work queue and its status table is the source of truth for what is done.

## Repo map

```
apps/web         Next.js app: the API (route handlers), tonight page, leaderboard, admin. Deployed on Vercel.
apps/companion   Desktop app: Host mode (token, lobby/game watchers) and Overlay mode (champ-select panel, no token).
                 M17 rewrites it in Rust (Tauri 2, Windows only, auto-updates, no overlay); see docs/02-milestones.md.
                 Node engine + Tauri tray shell (`Kustom.exe`). Packaged as a Windows exe.
apps/overlay     Retired as a product (M12 folded into companion Host/Overlay). Source kept for reference; do not ship.
packages/core    Pure TypeScript: balancer, rating, role model. No I/O. 100% unit-tested.
packages/lcu     League client developer kit: smoke, record-ws, fixtures; the TS companion's bridge until M17.14.
                 The shipped bridge moves to the Rust companion (M17).
packages/db      Supabase migrations, generated types, zod schemas shared by API and clients.
docs/            Product, architecture, LCU reference, milestones, decisions.
```

Tooling: pnpm workspaces, TypeScript strict everywhere, vitest, Supabase CLI for migrations, Biome for lint/format.

## Team

Work is run by the `/lead` skill (`.claude/skills/lead/SKILL.md`) in the main session. It dispatches the
specialists in `.claude/agents/`: `product`, `designer`, `core-engineer`, `companion-engineer`,
`platform-engineer`, `web-engineer`, `reviewer`. Each owns the directories named in its file. If you are one of
those agents, stay inside what you own and route everything else through the lead.

## Commands

```
pnpm install
pnpm -r typecheck            # every package
pnpm -r test                 # vitest, run mode; packages run one at a time (pnpm-workspace.yaml) because they share the local stack
pnpm lint                    # biome check .
pnpm format                  # biome format --write .
pnpm --filter web dev        # http://localhost:3000
pnpm --filter web build      # next build (also typechecks the app)
pnpm --filter web mint-token <puuid> [label] [--group <slug>]
                             # mints a companion token for a PUUID and prints it once.
                             # Reads apps/web/.env.local. Replaced by /admin in M1.6.
                             # --group (M13.3, default customs): the group the token posts to;
                             # adds a member row there if there is none.
                             # Runs node with --conditions=react-server (M14.44): companionAuth.ts
                             # imports 'server-only'. Any new script importing a server-only module
                             # needs the same flag.
pnpm --filter web set-premium <slug> on|off [--cap <usd>] [--hosted]  # M16.2: the only writer of groups.premium / ai_monthly_cap_usd (service role, .env.local); prints URL + before/after, idempotent; refuses a non-local URL without --hosted
pnpm --filter web ddragon-fixture [--from <champion.json>]  # M15.4: regenerates the pinned Data Dragon fixture and lib/champs/tags.ts (deterministic)
pnpm --filter web seed-regions [--meraki <champions.json>] [--check-universe]  # M15.9: reseeds lib/champs/regions.ts from Meraki lolstaticdata, offline, by hand; never fetched at runtime
# ANTHROPIC_API_KEY (M16.3, server only, Vercel Production only): Kustom Premium's AI lines; unset = AI silently off. Kill switch, no deploy: update public.ai_settings set calls_enabled = false;
ANTHROPIC_API_KEY=... KUSTOM_AI_LIVE=1 pnpm --filter web exec vitest run lib/ai/live.test.ts  # M16.3: one real model call (< $0.01); never in CI
pnpm --filter web ai-eval [--source scenarios|local|all] [--model haiku|sonnet] [--weeks] [--dry] [--only <words>] [--budget <usd>] [--repeat N] [--ledger <file>] [--json <file>]  # M16.8: AI line eval through the production client and checker; local stack only, no database writes, never in CI
pnpm --filter web ai-eval-month --kinds week,player,game [--week-reps N] [--game-every N] [--budget <usd>] [--json <file>] [--ledger <file>] [--no-extras]  # M16.13: the M16.7 fixture month (150 games, 4 weeks, 20 players) through the production generators and checker; memory store, capped at --budget; no database; dev-only, never in CI
pnpm --filter web rebuild-ratings [--dry-run] [--force] [--prune] [--group <slug>] [--hosted]
                             # M14.63: day to day, backfilled games are rated by the daily /api/cron/rebuild
                             # (04:15 UTC); the command stays for repairs.
                             # M14.27: first output line is `target  <host> (local|hosted)` (host only,
                             # never a key); any non-local NEXT_PUBLIC_SUPABASE_URL is refused unless
                             # --hosted is passed (dry runs too), before a client is created.
                             # folds every rated-eligible game of a group in started_at order,
                             # from seeds, and writes once at the end (M5.2). Run it after a
                             # backfill batch: backfilled games are stored unrated until it does.
                             # Idempotent. Refuses while a lobby is live OR a game landed in the
                             # last 15 minutes -- which is exactly the case right after a backfill
                             # batch, so pass --force (or wait 15 minutes) then.
                             # Exit 2 means games landed mid-run, so run it again.
                             # M14.58: also fills game_players' fold breakdown (fold_p, base_mu_after,
                             # award, rated_games_before) and reports `breakdowns  N rows filled`.
                             # M13.3: every group by default, each folded on its own (own games,
                             # own ratings, own live-lobby / 15-minute guard); --group for one.
                             # M14.18: folds only games with started_at >= groups.ratings_since
                             # (the owner's Reset ratings epoch; null = every game).
pnpm --filter web perf-tonight [--delay 40] [--runs 3] [--also <slug>] [--playwright <path>] [--keep] [--delete perf-<hex>]  # M19.1: Tonight bench on the local stack only (needs `pnpm --filter web build`); scratch group, prints queries/rounds/TTFB per screen
pnpm --filter web copy-raw-stats [--dry-run] [--game <games.id>]
                             # M7.7 one-off, extended by M7.14: copies vision score, damage
                             # self-mitigated and damage to objectives out of games.raw onto
                             # game_players rows written before migrations 0014 and 0015.
                             # Only ever fills a null, never overwrites, safe to run twice, and
                             # reports rows filled plus rows still short -- three numbers now,
                             # one per column, beside the combined count. Read the per-column
                             # ones: the history is only trustworthy for a column at zero, and
                             # M7.14's core half may not merge until damage to objectives is
                             # zero. A blob that never carried the numbers, or carried one no
                             # integer column can hold, leaves them null on purpose
                             # (null is not zero) and never aborts the run.
pnpm --filter web m7-13-battle-test <path-to-rows.json> [--detail] [--quoted] [--addendum]
                             # M7.13: compares the retired flat M7.8 formula against the current
                             # rating/performance.ts export over a set of real games, game by
                             # game, MVP and ACE. Takes no credentials and writes nothing -- the
                             # input is a JSON array of per-player rows the lead extracts by hand
                             # (SQL pasted from the Supabase editor) and saves to a file first.
                             # --detail prints every game's full ten; --quoted prefixes every
                             # line with "    > " so the output drops straight under a milestones.md
                             # brief. --addendum prints M7.14's jungle-only comparison instead --
                             # the retired six-component bucket weights against the current
                             # seven-component export, every jungler's score before and after, and
                             # a check that no carry or support seat moved (exit 1 if one did).
pnpm --filter companion dev         # needs the League client (M2.1); Host by default, `--mode overlay` for panel-only
pnpm --filter companion build:win   # bundle + Node SEA -> apps/companion/dist/Kustom.exe + Kustom.exe.sha256 (from any host; build:exe is an alias)
pnpm --filter companion build:host  # the same pipeline for this machine's platform, to check the exe before a Windows run
pnpm --filter companion publish:gh  # GitHub release v<version> on suyaser/kustom-releases via the gh CLI (gh auth login first)
pnpm --filter companion release     # build:win + publish:gh
git tag companion-v<version> && git push origin companion-v<version>  # M17.12: Windows release build (Rust companion), draft on suyaser/kustom-releases (docs/runbooks/companion-release.md); Actions "Run workflow" is a dry run
pnpm --filter companion tauri:dev   # M17.8: the Rust app (engine in-process, no sidecar); CUSTOMS_NIGHT_CONFIG_DIR=<dir> for a scratch config
pnpm --filter companion tauri:build # NSIS installer for the Tauri shell
pnpm --filter @customs/lcu smoke      # hit every LCU endpoint we use, save fixtures; --diff after a patch. Needs the client.pnpm --filter @customs/lcu record-ws  # append every LCU WebSocket event to fixtures/<patch>/ws-events.ndjson until Ctrl-C
pnpm --filter @customs/lcu timeline-roles  # M5.18: print the match-history timeline.lane/role confusion table from the fixtures; no client needed; exit 1 on a contradicted mapped pair
pnpm --filter companion verify-commands  # M4.1: probe the three lobby writes against the live client, one prompt each, report + fixtures to paste back. Needs the client and a friend; no API, no token.
pnpm --filter companion make-goldens [--check]  # M17.4: run the TS engine over every recorded fixture and write its exact requests to apps/companion/crates/engine/tests/goldens/ (the Rust port's contract); --check diffs instead of writing. No client, no API.
pnpm --filter companion make-config-fixtures [--check]  # M17.6: rewrites the synthetic config trees in crates/engine/tests/fixtures/config/ with the TS engine's writers
pnpm db:start                # supabase start: local stack, needs Docker (see packages/db/README.md)
pnpm db:stop                 # supabase stop
pnpm db:reset                # supabase db reset: replay every migration locally
pnpm db:migrate              # supabase db push to the linked hosted project
pnpm db:types                # regenerate packages/db/src/types.ts from the local stack
pnpm --filter @customs/db export-schemas [--check]  # M17.3: companion zod schemas -> packages/db/json-schema/ (commit it with any schema change); --check writes nothing, exits 1 on drift, and runs in CI
packages/db/scripts/m14-14-throwaway-check.sh [0026 path]  # M14.14: checks 0026 on a throwaway restore of local; reads the shared stack only via pg_dump; needs Docker + pnpm db:start
packages/db/scripts/m14-58-throwaway-check.sh [0034 path]  # M14.58: checks 0034 on a throwaway restore of local (pg_dump read only); needs Docker
packages/db/scripts/session-player-throwaway-check.sh [0038 path]  # verified session lookup: checks 0038 (grants, definer settings, revoked/banned/deleted/unlinked cases) on a throwaway restore of local (pg_dump read only); needs Docker
packages/db/scripts/m19-9-throwaway-check.sh [0037 path]   # M19.9: checks 0037 (group_live) on a throwaway restore of local, then replays every migration on a fresh throwaway; pg_dump read only; needs Docker
# SUPER_ADMIN_USER_IDS (M14.19, server only): comma-separated Supabase auth.users ids; read-only access to every group's admin reads and /ops, never a write. Set it on Vercel Production too.
# CI (.github/workflows/ci.yml) runs install --frozen-lockfile, `pnpm -r typecheck`, `pnpm lint`, `pnpm -r test` and `pnpm --filter web build` on every pull request and every push to main, on Node .nvmrc with no local stack (the *.integration.test.ts files skip) and no secrets -- run those five before you open one.
```

If a command above does not exist yet, the milestone that creates it is in `docs/02-milestones.md`. Add it there and here when you create it.

## Hard rules

- **Players are keyed by PUUID.** Never by Riot ID, summoner name, or Discord ID. Names get renamed; PUUIDs do not.
- **`packages/core` is pure.** No network, no database, no Date.now() without injection. Everything in it has tests.
- **All League client calls in shipped code live in the companion's `lcu` module** (`apps/companion/crates/engine/src/lcu/`, M17; until M17.14 retires it, the TypeScript companion's calls stay in `packages/lcu`). Nothing else in shipped code reads the lockfile or opens a connection to `127.0.0.1`. `packages/lcu` is the developer kit (smoke, record-ws, timeline-roles, verify-commands, and the recorded fixtures the Rust tests read); it may call the client from a developer's machine, and nothing that ships imports it. The client API is unofficial and breaks on patches; keeping it in one module keeps a break a one-hour fix.
- **Validate every boundary with zod.** API request bodies, LCU responses, Discord payloads. In the Rust companion (M17) the same rule holds with typed serde structs: every LCU response and every API body is deserialised into a struct, and the request bodies are checked against the server's zod schemas by the goldens. Log and drop malformed data; never crash a watcher on a bad payload.
- **Never automate gameplay.** The companion may create lobbies, invite, switch sides, and read stats. It never touches champion select actions or in-game state. This is the line Riot draws.
- **No Riot public API.** Ranks and match history come from the local client. There is no API key in this project.
- **Idempotent ingest.** Games dedupe on `lcu_game_id`, lobbies on `lcu_party_id`. A second companion in the same game must be a no-op.
- **Secrets stay out of the repo.** `.env.local` for web, `%APPDATA%/customs-night/config.json` for the companion. `.env.example` lists every variable. The companion updater's signing key (M17.12) is the user's, kept outside the repo and given to CI only as a secret.
- **Verify before you claim.** An endpoint marked `unverified` in `docs/03-lcu-reference.md` must be exercised against a real client before code depends on it. Update its status when you do.

## Conventions

- Discriminated unions over booleans for state. `LobbyStatus = 'open' | 'balanced' | 'in_game' | 'dropped' | 'finished' | 'abandoned'` (`dropped` is an `in_game` lobby nobody posted about for two hours; a late end-of-game block still finishes it).
- Side is `100` (blue) or `200` (red), matching the client. Roles are `'top' | 'jungle' | 'mid' | 'adc' | 'support'`.
- Ratings are OpenSkill `{ mu, sigma }`. Balance on `mu`. Rank boards on Rating (`round(mu * 60)`), with players under 10 rated games in a settling section; ordinal (`mu - 2 * sigma`) stays a core value and is never printed.
- API routes under `apps/web/app/api/`. Companion routes use a bearer companion token; admin routes use the Supabase session and an admin-or-owner membership (`group_memberships.role in ('owner','admin')`) in the request's `groupId`. Exactly one `owner` per group; owner-only writes (removing or demoting an admin, handing over ownership) are checked again inside their `security definer` function.
- Migrations are numbered SQL files in `packages/db/supabase/migrations/`. Never edit a migration that has been applied; add a new one.
- Commit messages: `area: what changed` (`core: add repeat-split penalty`). One milestone task per commit where practical.

## Definition of done for any task

1. `pnpm -r typecheck` and `pnpm -r test` pass; for Rust changes (M17), `cargo test` and `cargo clippy -- -D warnings` pass in the companion workspace.
2. New behavior in `packages/core` has a test. New API route has a request/response zod schema.
3. The milestone status table in `docs/02-milestones.md` is updated.
4. If you learned something about the League client, `docs/03-lcu-reference.md` is updated.
5. If you made a decision the docs did not already make, add a row to `docs/04-decisions.md`.

## When something is unclear

Prefer the docs' explicit decision over your own default. If the docs are silent, make the smallest choice that keeps `packages/core` pure and the LCU surface small, record it in `docs/04-decisions.md`, and continue. Do not stop to ask unless the choice would change the schema or the companion's install story.
