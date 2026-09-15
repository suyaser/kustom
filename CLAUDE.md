# Customs Night

Team balancer and stats tracker for a friends group that plays League of Legends custom 5v5s every night.
Zero-input by design: a desktop companion reads the League client, the server balances teams and keeps ratings,
Discord shows the result. Nobody checks in, nobody reports scores.

Read `docs/00-product.md` once. Then read the doc for the layer you are touching. `docs/02-milestones.md` is the
work queue and its status table is the source of truth for what is done.

## Repo map

```
apps/web         Next.js app: the API (route handlers), tonight page, leaderboard, admin. Deployed on Vercel.
apps/companion   Node CLI that talks to the local League client and pushes to the API. Packaged as a Windows exe.
apps/discord     discord.js bot. Only job: voice channel split and presence. Not needed until M4.
packages/core    Pure TypeScript: balancer, rating, role model. No I/O. 100% unit-tested.
packages/lcu     League client bridge: lockfile discovery, HTTPS client, WebSocket events, typed endpoints.
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
pnpm --filter web mint-token <puuid> [label]
                             # mints a companion token for a PUUID and prints it once.
                             # Reads apps/web/.env.local. Replaced by /admin in M1.6.
pnpm --filter web rebuild-ratings [--dry-run] [--force] [--prune] 
                             # folds every rated-eligible game of a season in started_at order,
                             # from seeds, and writes once at the end (M5.2). Run it after a
                             # backfill batch: backfilled games are stored unrated until it does.
                             # Idempotent. Refuses while a lobby is live OR a game landed in the
                             # last 15 minutes -- which is exactly the case right after a backfill
                             # batch, so pass --force (or wait 15 minutes) then.
                             # Exit 2 means games landed mid-run, so run it again.
pnpm --filter web copy-raw-stats [--dry-run] [--game <games.id>]
                             # M7.7 one-off: copies vision score and damage self-mitigated out of
                             # games.raw onto game_players rows written before migration 0014.
                             # Only ever fills a null, never overwrites, safe to run twice, and
                             # reports rows filled plus rows that still have a null in either
                             # column -- read that second number to know whether M7.8 can trust
                             # the history. A blob that never carried the numbers, or carried
                             # one no integer column can hold, leaves them null on purpose
                             # (null is not zero) and never aborts the run.
pnpm --filter web m7-13-battle-test <path-to-rows.json> [--detail] [--quoted]
                             # M7.13: compares the retired flat M7.8 formula against the current
                             # rating/performance.ts export over a set of real games, game by
                             # game, MVP and ACE. Takes no credentials and writes nothing -- the
                             # input is a JSON array of per-player rows the lead extracts by hand
                             # (SQL pasted from the Supabase editor) and saves to a file first.
                             # --detail prints every game's full ten; --quoted prefixes every
                             # line with "    > " so the output drops straight under a milestones.md
                             # brief. Re-run for M7.14's jungle-only addendum once that lands.
pnpm --filter companion dev  # needs the League client running on this machine (M2.1)
pnpm --filter companion build:win   # bundle + Node SEA -> apps/companion/dist/Kustom.exe + Kustom.exe.sha256 (from any host; build:exe is an alias)
pnpm --filter companion build:host  # the same pipeline for this machine's platform, to check the exe before a Windows run
pnpm --filter companion publish:gh  # GitHub release v<version> on suyaser/kustom-releases via the gh CLI (gh auth login first)
pnpm --filter companion release     # build:win + publish:gh
pnpm --filter @customs/lcu smoke      # hit every LCU endpoint we use, save fixtures; --diff after a patch. Needs the client.
pnpm --filter @customs/lcu record-ws  # append every LCU WebSocket event to fixtures/<patch>/ws-events.ndjson until Ctrl-C
pnpm --filter @customs/lcu timeline-roles  # M5.18: print the match-history timeline.lane/role confusion table from the fixtures; no client needed; exit 1 on a contradicted mapped pair
pnpm --filter companion verify-commands  # M4.1: probe the three lobby writes against the live client, one prompt each, report + fixtures to paste back. Needs the client and a friend; no API, no token.
pnpm db:start                # supabase start: local stack, needs Docker (see packages/db/README.md)
pnpm db:stop                 # supabase stop
pnpm db:reset                # supabase db reset: replay every migration locally
pnpm db:migrate              # supabase db push to the linked hosted project
pnpm db:types                # regenerate packages/db/src/types.ts from the local stack
# CI (.github/workflows/ci.yml) runs install --frozen-lockfile, `pnpm -r typecheck`, `pnpm lint`, `pnpm -r test` and `pnpm --filter web build` on every pull request and every push to main, on Node .nvmrc with no local stack (the *.integration.test.ts files skip) and no secrets -- run those five before you open one.
```

If a command above does not exist yet, the milestone that creates it is in `docs/02-milestones.md`. Add it there and here when you create it.

## Hard rules

- **Players are keyed by PUUID.** Never by Riot ID, summoner name, or Discord ID. Names get renamed; PUUIDs do not.
- **`packages/core` is pure.** No network, no database, no Date.now() without injection. Everything in it has tests.
- **All League client calls live in `packages/lcu`.** Nothing else imports `https` or talks to `127.0.0.1`. The client API is unofficial and breaks on patches; keeping it in one place keeps a break a one-hour fix.
- **Validate every boundary with zod.** API request bodies, LCU responses, Discord payloads. Log and drop malformed data; never crash a watcher on a bad payload.
- **Never automate gameplay.** The companion may create lobbies, invite, switch sides, and read stats. It never touches champion select actions or in-game state. This is the line Riot draws.
- **No Riot public API.** Ranks and match history come from the local client. There is no API key in this project.
- **Idempotent ingest.** Games dedupe on `lcu_game_id`, lobbies on `lcu_party_id`. A second companion in the same game must be a no-op.
- **Secrets stay out of the repo.** `.env.local` for web, `%APPDATA%/customs-night/config.json` for the companion. `.env.example` lists every variable.
- **Verify before you claim.** An endpoint marked `unverified` in `docs/03-lcu-reference.md` must be exercised against a real client before code depends on it. Update its status when you do.

## Conventions

- Discriminated unions over booleans for state. `LobbyStatus = 'open' | 'balanced' | 'in_game' | 'dropped' | 'finished' | 'abandoned'` (`dropped` is an `in_game` lobby nobody posted about for two hours; a late end-of-game block still finishes it).
- Side is `100` (blue) or `200` (red), matching the client. Roles are `'top' | 'jungle' | 'mid' | 'adc' | 'support'`.
- Ratings are OpenSkill `{ mu, sigma }`. Balance on `mu`. Rank leaderboards on `ordinal = mu - 2 * sigma`. Display rating is `round(mu * 60)`.
- API routes under `apps/web/app/api/`. Companion routes use a bearer companion token; admin routes use the Supabase session and `players.is_admin`.
- Migrations are numbered SQL files in `packages/db/supabase/migrations/`. Never edit a migration that has been applied; add a new one.
- Commit messages: `area: what changed` (`core: add repeat-split penalty`). One milestone task per commit where practical.

## Definition of done for any task

1. `pnpm -r typecheck` and `pnpm -r test` pass.
2. New behavior in `packages/core` has a test. New API route has a request/response zod schema.
3. The milestone status table in `docs/02-milestones.md` is updated.
4. If you learned something about the League client, `docs/03-lcu-reference.md` is updated.
5. If you made a decision the docs did not already make, add a row to `docs/04-decisions.md`.

## When something is unclear

Prefer the docs' explicit decision over your own default. If the docs are silent, make the smallest choice that keeps `packages/core` pure and the LCU surface small, record it in `docs/04-decisions.md`, and continue. Do not stop to ask unless the choice would change the schema or the companion's install story.
