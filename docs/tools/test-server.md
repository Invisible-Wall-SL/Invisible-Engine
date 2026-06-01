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

> The build step needs Node + pnpm + the game's repo on that machine, so it's an
> owner/dev action. Artist boxes that only sync ComfyUI won't build.

### Publishing a game — CLI (equivalent)

Build the game with the Play4Fun transport, then run the publish script (R2
write creds in env). This does steps 1–2 above; add the `/admin` row by hand
(or use the launcher button, which also does steps 3–4):

```bash
# Hot Fruits (in-repo `lines` game), from the engine repo root:
PUBLIC_RGS_TRANSPORT=play4fun PUBLIC_RGS_GAME=lines pnpm --filter lines build
node apps/launcher-api/scripts/publish-game-bundle.mjs hotfruits apps/lines/build \
  --protocol lines --name "Hot Fruits"

# Book of Borut (built in its OWN repo — engine is a submodule there):
PUBLIC_RGS_TRANSPORT=play4fun PUBLIC_RGS_GAME=book pnpm build      # in the Book-of-Borut repo
node <engine>/apps/launcher-api/scripts/publish-game-bundle.mjs book_of_borut <repo>/build \
  --protocol book --name "Book of Borut"
```

Then restart the service (or `POST /refresh`) so it picks up the new bundle.

## Registering in the launcher

Add a row in `/admin → Games` (managed via `apps/launcher-api`, `games` table):

| field | Hot Fruits | Book of Borut |
|---|---|---|
| key | `hotfruits` | `book_of_borut` |
| name | Hot Fruits | Book of Borut |
| url | `https://games.invisiblewall.org/hotfruits/?sessionID=demo&rgs_url=games.invisiblewall.org/api/hotfruits&lang=en&currency=USD&device=desktop` | `https://games.invisiblewall.org/book_of_borut/?sessionID=demo&rgs_url=games.invisiblewall.org/api/book_of_borut&lang=en&currency=USD&device=desktop` |

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

| route | purpose |
|---|---|
| `GET /healthz` | `{ ok, games: [...] }` |
| `GET /` | simple index listing hosted games |
| `GET /<gameKey>/[path]` | serve the game bundle (path defaults to `index.html`) |
| `* /api/<gameKey>/rgs/engine` | mock RGS for that game |
| `POST /refresh[?secret=]` | re-hydrate bundles from R2 |

## Manifest contract (`test_server/games.json`)

Canonical shape — **producers must MERGE (read-modify-write)** so publishing one game
never drops the others:

```json
{ "games": { "<gameKey>": { "protocol": "lines" | "book", "name": "Display Name", "updatedAt": "<iso>" } } }
```

Three places share this shape; keep them in lockstep:
- **producer** — `apps/launcher-api/scripts/publish-game-bundle.mjs` (CLI)
- **producer** — the desktop launcher's `publish_game()` (`Invisible_Launcher.py`)
- **consumer** — `services/test-server/server.mjs` (`protocol` → which mock; `name` → index page)

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
