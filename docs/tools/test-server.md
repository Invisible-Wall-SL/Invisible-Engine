# Invisible Test Server

Lets the engine games be **launched and played from any machine** via the
launcher portal's **Games** section. Lives at `services/test-server/`.

> Was previously only a `roles.ts` stub with no implementation. This is the real
> service.

## What it does

One small Node service that does two jobs:

1. **Serves each game's built bundle.** The games build with `adapter-static`;
   small assets are inlined as data URLs and the rest live under `_app/` +
   `assets/`. SvelteKit emits **relative** asset paths (runtime base =
   `new URL('.')`), so a bundle works served from a **subpath** (`/<gameKey>/`)
   with no rebuild. The publish step uploads the whole `build/` tree and the
   server serves every file under `GET /<gameKey>/<path>` (default `index.html`).
2. **Hosts a mock Play4Fun RGS** per game at `/api/<gameKey>/rgs/engine`, so the
   game has a backend to spin against. Fake money, no real spend. Reuses the
   existing mock logic (`scripts/mock-rgs-server.mjs`, which deals every lines-family game — a
   Book-of game included, with its expanding symbol — and `scripts/mock-rgs-server-holdandwin.mjs`
   for Hold and Win), refactored into a `createMockRgs()` factory. The book mock
   (`scripts/mock-rgs-server-book.mjs`) is no longer served: it stays a test fixture of the
   partner's Book wire.

   **The mock follows the config its game draws.** The board it deals — grid,
   paylines, in-play symbols, win model, tumbling — is not owned by the manifest
   below. The server re-reads it from the project's [Invisible Game Config](/docs/game-config)
   (`GET <launcher>/api/game-config/mock?source=…`, at most once every ~10s per game)
   and rebuilds that game's mock as soon as the answer changes, carrying player
   balances across. Which config depends on who is playing:

   - **Players** of an online (Game Maker) game boot its **published** snapshot, so
     the game's mock follows `source=published`: a change reaches it on **Publish**
     (or a rollback), never from an unpublished save.
   - **Authoring boots** (launcher links carrying `ie_authoring=1`) boot the **saved**
     config, so they are dealt by that game's separate *authoring mock* at
     `/api/<gameKey>/authoring/…`, which follows `source=live` — resize a board in
     `/config`, save, reload Live ↗. The launcher points `rgs_url` there itself.
   - **Desktop-launcher builds** have one mock that follows `source=live`, since
     their config was baked from the saved data when they were built.

   The manifest's `grid`/`cascade` are only the fallback for a launcher that can't be
   reached, or an entry published before this existed.

```
launcher portal  → opens →  https://games.invisiblewall.org/<gameKey>/?…&rgs_url=games.invisiblewall.org/api/<gameKey>
                                   │                                              │
                            serves the bundle                              the game spins against
                                                                           the mock RGS (same origin)
```

## How bundles get there (R2)

Bundles live in R2 under `test_server/<gameKey>/...`, with a manifest
`test_server/games.json` mapping each game to its mock protocol + name:

```json
{ "games": { "hotfruits": { "protocol": "lines", "name": "Hot Fruits" } } }
```

The service hydrates the manifest + every game's files from R2 **on boot** (and
on `POST /refresh`, secret-gated when `TEST_SERVER_SECRET` is set).
`GET /healthz` lists the games it serves and whether its last R2 read succeeded
(`lastHydrate`); it answers 503 when it serves nothing because that read failed at boot.

### Publishing a game — one-click from the desktop launcher (preferred)

The desktop **Invisible Launcher** has a **☁ Publish** button on each project card. Sign in with
an account that holds **Build & publish games** (`gamePublish`), then press it on a project whose
cloud-publish settings are filled in (cloud key, display name, protocol, build cwd/cmd/out, build
env — derived from the project's game kind for projects created online). It:

1. **builds** the game — after hard-resetting the repo to `origin/main` and advancing the engine
   submodule to the engine's `origin/main`, so the build is always on the latest engine,
2. **uploads** the `build/` bundle **through the portal** (`api/launcher/game-upload`), which
   writes R2 `test_server/<key>/`, verifies every file arrived and merges the manifest — no R2
   credentials on your machine (from launcher v1.0.56),
3. **refreshes** the test server (`POST /refresh`) and waits until it serves the new build,
4. **registers** the game in the portal's `/admin → Games` (via
   `POST /api/launcher/register-game`) — so it appears in the portal with no manual step,
5. **shares the project SETUP** to the portal (`POST /api/launcher/projects`): the
   machine-independent profile — `repo.url`/`branch` (captured from the build folder's git remote)
   + the publish block. Every OTHER launcher gets it on **↻ Sync**, which clones the repo (with its
   submodule) into `Projects/<client>/<key>` and can publish with no typing. A freshly-synced
   _empty_ folder has no remote to capture; bootstrap such a project once with
   `apps/launcher-api/scripts/seed-project-profile.mjs`, or 🏗 Scaffold it if it only exists online.

> The build step needs Node + pnpm + the game's repo on that machine. Detail, including what each
> build refusal means: [tools/invisible-launcher](invisible-launcher.md) and the
> [publisher runbook](../guides/publisher-runbook.md).

### Publishing a game — CLI (equivalent)

Build the game with the Play4Fun transport, then run one of the two publish scripts. Both upload
the bundle and merge the manifest:

- `apps/launcher-api/scripts/publish-game-via-portal.mjs` — through the portal with your portal
  sign-in; needs no R2 credentials, works on a line that cannot reach R2 directly, and registers
  the portal card itself (`--no-register` to skip).
- `apps/launcher-api/scripts/publish-game-bundle.mjs` — straight to R2 with the owner's `R2_*`
  write credentials in the env; add the `/admin` row by hand afterwards.

A game is its **own repo** (the engine as a submodule under `engine/`), built with `pnpm build` →
`build/`. A hand build uses the engine commit the repo has pinned — the desktop launcher's publish
is what advances it to the latest engine, so prefer that. First build per repo needs the engine's
`pixi-svelte` dist once: `pnpm --filter pixi-svelte build`.

```bash
# from the game repo:
PUBLIC_RGS_TRANSPORT=play4fun pnpm build
node <engine>/apps/launcher-api/scripts/publish-game-via-portal.mjs <gameKey> <repo>/build \
  --protocol lines --name "Display Name" --project <projectKey>
```

The portal script requires `--project` and stamps the project pin itself. With
`publish-game-bundle.mjs`, **pass `--project` for any game authored in the Studio** — with
`--launcher` and `--read-token`, all three together (see "The project pin" below). Without them
the mock ignores the project's Game Config entirely and deals its default 5×3 lines board:

```bash
node <engine>/apps/launcher-api/scripts/publish-game-bundle.mjs waysofwavesbuild <repo>/build \
  --protocol ways --name "Ways on Waves" \
  --project test6 --launcher https://app.invisiblewall.org --read-token <k>
```

`--read-token` is the project's public read token — the `k=` in the game's own URL.
With the pin in place the mock follows the config live, so `--protocol` is only the
fallback and a board resize needs no republish at all.

Then restart the service (or `POST /refresh`) so it picks up the new bundle.

## Registering in the launcher

Add a row in `/admin → Games` (managed via `apps/launcher-api`, `games` table):

| field | Hot Fruits                                                                                                                                    | Book of Borut                                                                                                                                     |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| key   | `hotfruits`                                                                                                                                   | `bookofborut`                                                                                                                                     |
| name  | Hot Fruits                                                                                                                                    | Book of Borut                                                                                                                                     |
| url   | `https://games.invisiblewall.org/hotfruits/?sessionID=demo&rgs_url=games.invisiblewall.org/api/hotfruits&lang=en&currency=USD&device=desktop` | `https://games.invisiblewall.org/bookofborut/?sessionID=demo&rgs_url=games.invisiblewall.org/api/bookofborut&lang=en&currency=USD&device=desktop` |

The launcher home appends `&project=<activeProject>`; the game ignores unknown
params. After that, every logged-in user can launch from any machine.

## Deploy (Railway)

- New Railway service, **Root Directory = repo root**, **Dockerfile Path =
  `services/test-server/Dockerfile`** (the Dockerfile copies `scripts/mock-*`
  which `server.mjs` imports via `../../scripts/`).
- Env: `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
  (read-only is enough), `PORT` (Railway sets it), optional `TEST_SERVER_SECRET`.
- DNS: `games.invisiblewall.org` CNAME → the Railway service domain (Cloudflare).

## Endpoints

| route                         | purpose                                               |
| ----------------------------- | ----------------------------------------------------- |
| `GET /healthz`                | `{ ok, games: [...] }`                                |
| `GET /`                       | simple index listing hosted games                     |
| `GET /<gameKey>/[path]`       | serve the game bundle (path defaults to `index.html`) |
| `* /api/<gameKey>/rgs/engine` | mock RGS for that game (players)                      |
| `* /api/<gameKey>/authoring/rgs/engine` | an online game's authoring mock (live config) |
| `POST /refresh[?secret=]`     | re-hydrate bundles from R2                            |

## Manifest contract (`test_server/games.json`)

Canonical shape — **producers must MERGE (read-modify-write)** so publishing one game
never drops the others:

```json
{ "games": { "<gameKey>": {
    "protocol": "lines" | "ways" | "cluster" | "scatter" | "holdAndWin",
    "name": "Display Name",
    "updatedAt": "<iso>",
    "projectKey": "<launcher project>", "docBase": "<launcher origin>", "readToken": "<k>"
} } }
```

Three places share this shape; keep them in lockstep:

- **producer** — `apps/launcher-api/scripts/publish-game-bundle.mjs` (CLI)
- **producer** — the desktop launcher's `publish_game()` (`Invisible_Launcher.py`) — writes
  `{protocol, name, updatedAt}` only, and REPLACES the entry; the pin it drops is put back by
  `/api/launcher/register-game` (see below)
- **repairer** — `apps/launcher-api/src/routes/api/launcher/register-game/+server.ts` — patches the
  project pin onto an existing entry; never creates one
- **consumer** — `services/test-server/server.mjs` (`protocol` → which mock; `name` → index page)

### The project pin — `projectKey` + `docBase` + `readToken`

These three are **the pointer** the server uses to re-read the project's Game Config
(above) instead of the frozen `grid` snapshot. **A game without them is not playing its own
math.** It still runs — it deals the mock's built-in **5×3 Hot Fruits default** (7 line
symbols + scatter, 5 paylines, `lines` scoring) while the client draws whatever `/config`
authored, and nothing in the game says so.

`projectKey` is the **launcher project**, which is only *incidentally* the game key. The
online publish (`publishGame.ts`) names a game after its project, so `project=<gameKey>`
worked there and looked general; every desktop-launcher title names its own key. `waysofwavesbuild`
(project `test6`) therefore asked for a project called `waysofwavesbuild`, got a 401, and fell
back to the default board — surfacing as two bugs that looked nothing like a manifest problem:
an out-of-dictionary symbol landing with placeholder art (`PIC7`→`L5`), and a bottom row that
never exploded, because the client's 4th visible row was really the facade's bottom **padding**
row and every "the last strip entry is off-screen buffer" guard correctly skipped it.

The CLI producer takes them as flags (below) — it can't *mint* a token, but it can be handed
one. A game with no pointer logs a one-line warning on its first spin naming the cause.

**The desktop launcher needs no flags, and no change of its own.** Its `publish_game()` writes
this manifest with no pointer *and* replaces the whole entry, which would wipe a pin every
publish. So `POST /api/launcher/register-game` — which that same launcher calls moments later,
and which already requires a validated `project` — **re-stamps the pin on every publish**
(`pinTestServerGameToProject`). It patches the existing entry only: it never creates one (a
manifest entry with no uploaded bundle would have the server serve zero files), never touches
`grid`/`cascade`/`runtime`/`updatedAt`, and writes nothing at all when the pin is already
correct. The step is entirely **non-fatal** — a failure is reported as `pin` in the response,
never as a failed registration — and it pokes `/refresh` only when something changed. Because
`/refresh` coalesces, a pin written while a refresh is already in flight takes effect on the
server's *next* hydrate; it is durable in R2 either way.

All of it — and which `source` each mock asks for — is guarded by
`node scripts/verify-test-server-project-pin.mjs`; the launcher's side of the contract by
`pnpm --filter launcher-api check:mock-contract`.

## Local dev

Run the server against a local directory instead of R2 (no creds needed):

```bash
# layout mirrors R2: <dir>/games.json + <dir>/<gameKey>/index.html
TEST_SERVER_LOCAL=/path/to/local-games PORT=8080 node services/test-server/server.mjs
```

## Traps

- **A game opened from this server's own page shows the engine's sample game.** — The list at
  `games.invisiblewall.org` links each game with no launch parameters, so an online (Game Maker)
  game cannot find its project and runs the engine's sample instead, with nothing on screen saying
  so. Open games from the launcher: Game Maker's **Play ↗** / **Live ↗** or the portal's
  **Games** section.
- **Your balance jumped back to the starting amount.** — Every publish of _any_ game refreshes the
  server, and a refresh resets every test wallet; a server restart does too. It is fake money —
  carry on. Each browser tab also has its own wallet, so two tabs show different balances.
- **A round stopped or a bet was refused after someone saved the game's math.** — When the board
  changes the server drops rounds dealt on the old one, and after a restart a game with a fixed
  bet table refuses a stale tab's bet rather than guess its price. Reload the game tab.

## Security note (MVP)

The service is **public** and the mock RGS is **unauthenticated** — acceptable
because it's mock money on a faithful-but-fake RGS, no R2 writes, no real spend.
The launch URL's `sessionID=demo` is a placeholder: the game swaps it for a
minted id per browser TAB, so each tab has its own mock balance (resets on a
restart or a publish) and a reload keeps it.
