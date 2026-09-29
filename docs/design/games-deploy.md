# Repo strategy & games deployment

> Decided 2026-06-03. Answers a recurring question: "we used to have separate
> repos (engine / launcher / pipeline / games) — should we split again, and how
> do shipped game frontends deploy?"

## The two things that look like one problem

1. **A messy, hard-to-track history** on a single `main`. This is a *hygiene*
   problem, not an architecture problem — see "History hygiene" below.
2. **Where shipped game frontends live and deploy.** This *is* an architecture
   question, and the answer is: games get their own repos.

Don't solve #1 by splitting the engine/tools/launcher back apart — that
re-introduces real pain (below) to fix a cosmetic one.

## Why engine + tools + launcher stay in ONE repo

The engine (`packages/*`), the games used for engine dev (`apps/{lines,…}`), the
launcher (`apps/launcher-api`), and the pipeline tools (`services/*`) all share
code through **`workspace:*`** dependencies. The launcher and editor import the
same engine packages the games do.

Splitting these into separate repos means every engine change becomes: publish a
version → bump it in the launcher repo → bump it in each tool repo → reconcile
lockfiles. That version-coordination tax is exactly what a monorepo exists to
remove, and it's why the old engine/launcher/pipeline split was retired. We are
**not** un-doing that.

## Games ARE the legitimate split

A shipped game is different from engine-dev code:

- it ships to a client and deploys on **its own cadence**;
- it can pin a **specific engine commit** for a hand-over, so a delivered build is
  reproducible;
- it has its own deploy target.

So each standalone game lives in **its own repo**, with this engine vendored as a
**git submodule**.

```
book-of-foo/                   ← the game's own repo + own deploy
├── engine/                     ← git submodule → Invisible-Engine (branch main)
├── static/                     ← boot assets; pull:assets mirrors R2 over them
├── pnpm-workspace.yaml         ← packages: ["engine/packages/*", "."]
├── package.json                ← engine packages via workspace:*
├── svelte.config.js            ← extends engine's config-svelte
└── vite.config.js              ← extends config-vite; fs.allow opened to engine/
```

**There is no `src/`, and that is the design.** The game layer is compiled from
`engine/apps/lines/src` — `config-svelte` points SvelteKit's `kit.files` there
(`packages/config-svelte/appSrc.js`) — which is the *same source*
`runtime-release.yml` builds the shared online bundle from. A game repo owns its
identity, its `static/` and its lockfile; the game itself is authored online
(scenes, flow, symbols, sounds, config) and baked in at build time.

Repos used to carry a scaffold-time COPY of `apps/lines/src`, and it went stale
immediately — the desktop launcher advances the submodule to `origin/main` before
every build, so `packages/*` were current while the game layer was frozen at
scaffold day, and 53 of the last 60 engine commits touch `apps/lines/src`. See
the 2026-09-17 entry in [status/engine](../status/engine.md). A leftover `src/` in
an older repo is ignored, with a build-log notice naming `git rm -r src`.

| Repo | Contains | Deploys as |
|---|---|---|
| `Invisible-Engine` (this one) | engine + packages + launcher + pipeline tools; `apps/{lines,…}` as **dev/reference** games | launcher-api on Railway; tools on Railway |
| each shipped game | one game's identity + assets, engine as submodule (no `src/`) | its own frontend deploy |

**The `apps/{lines,cluster,…}` here are reference/template games for engine
development — not the shipped artifacts.** Shipped games are separate repos.

### Spin up a new game

```bash
node scripts/new-game.mjs --name "Book of Foo" --port 3003
```

This bootstraps the repo + engine submodule + the engine-consumption wiring
(workspace, configs, Vite `fs.allow`) and seeds `static/`, then prints the
push/deploy steps. It writes no application source — there is none to write.

### Which engine a build gets

A **desktop-launcher publish** advances the submodule to `origin/main` first, so a
published build is always on the latest engine. That is the normal path and needs
no action.

The **committed pin** is what a plain `git clone` + `pnpm build` gets, and it is
what a hand-over should be cut from. Move it deliberately — the pin and the
lockfile must travel together, or the launcher's frozen install fails with
`ERR_PNPM_OUTDATED_LOCKFILE`:

```bash
node engine/scripts/bump-game-engine.mjs      # advances engine + lockfile, one commit
```

## Runtime releases (the online games' engine)

Online games (Game Maker publishes, `runtime: "lines"` in `test_server/games.json`) run no build of
their own: they all run ONE shared engine bundle, and a merge to `main` that touches
`apps/lines/**` or `packages/**` releases a new one (`.github/workflows/runtime-release.yml`).
Desktop-launcher builds are untouched by all of this: they compile the engine submodule into their
own `test_server/<key>/` bundle and have no `runtime` field.

**Layout** (`apps/launcher-api/scripts/lib/runtime-releases.mjs` owns it):

| R2 key under `test_server/_runtime/` | What | Mutable? |
|---|---|---|
| `lines@<version>/**` | one release: the whole `apps/lines/build` | never, once a pointer can name it |
| `lines/current.json` | **the pointer**: `{ version, commit, marker, promotedAt, via, previous }` | one write per release/rollback |
| `lines/releases.json` | history, newest first: `{ version, commit, builtAt, marker, files, bytes, runUrl }` | per release/prune |
| `lines/release.json` | the launcher's status stamp (`building` / `released`, `lastFailure`) | advisory |
| `lines/**` (anything else) | the pre-pointer flat bundle — read only while no pointer exists | legacy |

`<version>` is the first 12 characters of the commit; a second release of the same commit gets a
`-<time>` suffix, so a re-run never writes into a release that may be serving.

**A release** uploads the build to its own prefix, checks every file is listed, adds it to
`releases.json`, then writes `current.json` — **the single write that makes it live**. The test server
(`services/test-server/server.mjs`) resolves the pointer on every hydrate (boot, `POST /refresh`), so
a hydrate sees the old release or the new one whole, never a mix. It keeps a release it already holds
in memory instead of re-downloading it (a release is immutable), and every other bundle's unchanged
objects by ETag, so a refresh takes seconds, and it keeps the previous release's
`_app/immutable/*` chunks for one generation so a player still on the old `index.html` does not 404.
Every runtime response carries `X-Runtime-Release: lines@<version>`, and `/healthz` lists the pointer
version per runtime plus the pinned games. The release job then proves the new release is SERVED
(`verify-runtime-live.mjs`: the served `bundle.<hash>.js` and the header, on a game that follows the
pointer) and goes red otherwise.

**Rollback** is a pointer flip, no rebuild: **Actions → Runtime rollback → Run workflow**
(`.github/workflows/runtime-rollback.yml`), or
`gh workflow run runtime-rollback.yml -f action=rollback`. Its actions:

| action | version | does |
|---|---|---|
| `rollback` | empty = the next older release that was ever live (never an unpromoted canary); or a version / commit | points every unpinned game at it |
| `promote` | empty = the newest release (roll forward); or a version | same, the other direction |
| `pin` | required, + `game` | puts ONE game on that release (a canary) |
| `unpin` | + `game` | puts that game back on the pointer |
| `list` | — | prints the history, the pointer and the pins |

Before a flip it checks the target's files are all still in R2. Each flip then POSTs `/refresh` and
runs the same served-bundle check as a release, so the run is green only once a game serves the
chosen release. `main` still holds the bad commit afterwards — revert it, or the next engine merge
releases it again.

**Races.** Rollback is deliberately NOT in the release's concurrency group: GitHub cancels a
*pending* run when a newer one joins the group, so a rollback queued behind a bad release's 15-minute
served check could be silently replaced by the next merge's release. Instead every pointer write is
a compare-and-swap against the pointer read before the upload/flip. A release that tries to promote
after a rollback moved the pointer fails red ("pointer moved") and leaves the rollback standing. A
release already in its served check stops with the same message once it sees the pointer move. Locally, with the R2 env vars:
`node apps/launcher-api/scripts/runtime-pointer.mjs lines list|rollback|promote|pin|unpin …`.

**Retention:** the newest 10 releases (`RUNTIME_KEEP_RELEASES`) plus, whatever their age, the current
one, its predecessor and every pinned one. Pruning rewrites `releases.json` before deleting files,
so a rollback never picks a half-deleted release. A release is ~60 MB / ~165 files.

**Canary — one game takes a release first:**

1. Runtime release → Run workflow with **promote unticked**: builds, uploads and records the release,
   serves it to nobody (and skips the "Releasing engine…" stamp).
2. Runtime rollback → `pin`, `game` = a test game (e.g. `test1`), `version` = the new release: that
   game alone switches; the run proves it is served.
3. Play the test game. Then `promote` (empty version = newest) moves everyone; `unpin` the test game
   so it follows the pointer again. To abandon the release, just `unpin`.

A pin is a games.json field (`runtimeVersion`), written only by that tooling; the launcher's publish
carries it across a republish onto the same runtime (`upsertTestServerGame`), so a canary does not
silently lose its pin. A pinned release is never pruned, and a forgotten pin keeps that game on an
old engine indefinitely — `list` and `/healthz` show every pin; unpin when done. Only the chunks of
the release the POINTER moved away from are kept for mid-session players, not a canary's. An
auto-release on merge always promotes — a canary is a deliberate manual path.

**Failures the test server absorbs:** a pointer read is retried; if it still fails, the last good
pointer stands, and at boot (none yet) the hydrate fails and retries every few seconds rather than
guess the flat layout. A pointer naming a release with no `index.html` leaves the games on the
release they were serving. **Failures the launcher shows:** a release that fails after its `building`
stamp puts the stamp back to the live release with `lastFailure` (`before-promote`, or `unverified`
when the pointer moved but the served check failed), and the pill reads "last release failed" or
"rolled back" instead of "Release pending".

**Migration** was zero-downtime by construction: with no `current.json` the test server serves the
flat `_runtime/lines/` exactly as before, and the first versioned release creates the pointer. The
flat files stay behind as that fallback. A release dispatched from a ref older than this change runs
the old workflow and writes only the flat layout, which a server with a pointer ignores — its verify
step then goes red. Use Runtime rollback to go back instead. The first versioned release has no
rollback target (the flat bundle is not in the history), so it is cut deliberately from known-good
`main`. **Reverting `server.mjs` past this change is a silent engine downgrade:** the old server only
reads the flat prefix, which stops being updated at the migration.

## History hygiene (fixes the "messy commits" feeling without splitting)

The single `main` is kept *filterable per area* by three things:

1. **Scoped commit subjects** — every commit starts with an area scope
   (`engine:`, `launcher:`, `editor:`, `atlas-tool:`, `docs:`, …). Enforced by
   the `commit-msg` hook (`scripts/check-commit-scope.mjs`; allowed scopes
   listed there). Then `git log --grep '^launcher:'` shows just that area.
2. **Squash-merge PRs** — each PR lands as **one** commit on `main` (the PR
   title, which must carry a scope), not 3–4 WIP commits + a merge commit. The
   repo is configured squash-only with auto-delete of the merged branch.
3. **CODEOWNERS** (`.github/CODEOWNERS`) — the canonical path→area map; also
   auto-requests review. Keep its area names in sync with the commit scopes.

### Enable the hooks (once per clone)

```bash
git config core.hooksPath scripts/git-hooks
```

This activates both the secret scanner (`pre-commit`) and the scope check
(`commit-msg`). Genuine one-off bypass: `git commit --no-verify`.
