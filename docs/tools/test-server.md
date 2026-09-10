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
   existing mock logic (`scripts/mock-rgs-server.mjs` for `lines`-style games,
   `scripts/mock-rgs-server-book.mjs` for `book`-of games), refactored into a
   `createMockRgs()` factory.

   **The mock follows the project's config, live.** The board it deals — grid,
   paylines, in-play symbols, win model, tumbling — is not owned by the manifest
   below. The server re-reads it from the project's [Invisible Game Config](/docs/game-config)
   (`GET <launcher>/api/game-config/mock`, at most once every ~10s per game) and
   rebuilds that game's mock as soon as the answer changes, carrying player balances
   across. So resizing a board in `/config` takes a save and a reload — not a
   republish. The manifest's `grid`/`cascade` are only the fallback for a launcher
   that can't be reached, or an entry published before this existed.

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

### Publishing a game — one-click from the desktop launcher (preferred)

The desktop **Invisible Launcher** has a **☁ Build & publish** button on the Projects
toolbar. Select a project whose `game.publish` block is filled in (cloud key, display
name, protocol `lines`/`book`, build cwd/cmd/out, build env), click it, and it:

1. **builds** the game (`pnpm …`, with the play4fun env),
2. **uploads** the `build/` bundle to R2 `test_server/<key>/` + merges the manifest,
3. **refreshes** the test server (`POST /refresh`),
4. **registers** the game in the portal's `/admin → Games` (via
   `POST /api/launcher/register-game`, owner login) — so it appears in the portal with
   no manual step.
5. **shares the project SETUP** to the portal (`POST /api/launcher/projects`): the
   machine-independent profile — `repo.url`/`branch` (captured from the build folder's
   git remote) + the `game.publish` block. Every OTHER launcher then gets it on **↻ Sync
   from cloud**, which `git clone --recurse-submodules` the repo into
   `Projects/<client>/<key>` and can Build & publish with no typing. This is why building
   from a real checkout matters — a freshly-synced _empty_ folder has no remote to
   capture, which is the failure mode that left a project un-clonable (build then runs
   `pnpm` in an empty dir → `ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND`). One-time bootstrap for
   such a project: `apps/launcher-api/scripts/seed-project-profile.mjs` (or Build & publish
   it once from its real checkout). Added in launcher **v1.0.8**.

> The build step needs Node + pnpm + the game's repo on that machine, so it's an
> owner/dev action. Artist boxes that only sync ComfyUI won't build.

### Publishing a game — CLI (equivalent)

Build the game with the Play4Fun transport, then run the publish script (R2
write creds in env). This does steps 1–2 above; add the `/admin` row by hand
(or use the launcher button, which also does steps 3–4):

Each game is its **own standalone repo** (with the engine as a submodule under
`engine/`), built with `pnpm build` → `build/`. (The engine's `apps/lines` is a
**stale copy** — don't build from there.) First build per repo needs the engine's
`pixi-svelte` dist once: `pnpm --filter pixi-svelte build`.

```bash
# Hot Fruits — from C:\…\Projects\iGaming\Borut\HotFruits:
PUBLIC_RGS_TRANSPORT=play4fun pnpm build
node <engine>/apps/launcher-api/scripts/publish-game-bundle.mjs hotfruits <HotFruits>/build \
  --protocol lines --name "Hot Fruits"

# Book of Borut — from C:\…\Projects\iGaming\Borut\Book of Borut:
PUBLIC_RGS_TRANSPORT=play4fun PUBLIC_RGS_GAME=book pnpm build
node <engine>/apps/launcher-api/scripts/publish-game-bundle.mjs bookofborut <repo>/build \
  --protocol book --name "Book of Borut"
```

**Pass `--project` for any game authored in the Studio** — with `--launcher` and
`--read-token`, all three together (see "The project pin" below). Without them the mock
ignores the project's Game Config entirely and deals its default 5×3 lines board:

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
| `* /api/<gameKey>/rgs/engine` | mock RGS for that game                                |
| `POST /refresh[?secret=]`     | re-hydrate bundles from R2                            |

## Manifest contract (`test_server/games.json`)

Canonical shape — **producers must MERGE (read-modify-write)** so publishing one game
never drops the others:

```json
{ "games": { "<gameKey>": {
    "protocol": "lines" | "book" | "ways" | "cluster" | "scatter",
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

These three are **the pointer** the server uses to re-read the project's live Game Config
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

All of it is guarded by `node scripts/verify-test-server-project-pin.mjs`.

## Local dev

Run the server against a local directory instead of R2 (no creds needed):

```bash
# layout mirrors R2: <dir>/games.json + <dir>/<gameKey>/index.html
TEST_SERVER_LOCAL=/path/to/local-games PORT=8080 node services/test-server/server.mjs
```

## Security note (MVP)

The service is **public** and the mock RGS is **unauthenticated** — acceptable
because it's mock money on a faithful-but-fake RGS, no R2 writes, no real spend.
A shared `sessionID=demo` means users share one mock balance (resets on
restart). Add a secret/random session later if needed.
