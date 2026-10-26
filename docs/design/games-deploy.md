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
- every build records the **engine commit it actually compiled** (`build-info.json`, also
  baked into the game as `__IE_BUILD__`), so a delivered build is traceable;
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
the 2026-09-17 entry in [status/engine-history](../status/engine-history.md). A leftover `src/` in
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

**The latest `main`, always.** Both desktop-launcher builds — ☁ Publish and 📦 Deliver —
hard-reset the game repo to `origin/main` and advance the `engine/` submodule to the engine's
`origin/main` before building, and they fill in any engine package the repo's `package.json`
predates. That advance is deliberately **not committed**: it is redone on every build, so there is
no engine version to choose and no way for a build to fall behind.

**Never bump a game repo's engine submodule by hand**, and never mirror engine code into a game
repo. The committed pin is only what a bare `git clone` + `pnpm build` would get; build through the
launcher instead. What makes a build traceable is not the pin but its provenance record —
`build-info.json` beside the bundle (engine commit compiled, game commit, lockfile hash, launcher
version), also baked into the game as `__IE_BUILD__`. See
[tools/invisible-launcher](../tools/invisible-launcher.md).

### Game repo dependency pins must match the engine

The submodule advances on every build, but the game repo's root `package.json` does not: it is
written once by `new-game.mjs`. Its `svelte` / `@sveltejs/kit` pins and the `pnpm.overrides` for
Svelte's parser (`esrap`, `acorn`, `@sveltejs/acorn-typescript`) must still equal the engine's,
or pnpm installs two Svelte copies. The bundle then pairs the engine's compiler with the root's
older runtime and boots to a black screen (Book of Borut Remake: 5.35.1 against 5.57.1,
`e.exclude.includes is not a function`).

`config-vite` refuses such a build before compiling (`packages/config-vite/svelteVersions.js`).
The error lists every difference and the exact values to set. To fix:

1. In the game repo's root `package.json`, set `svelte` and `@sveltejs/kit` to what
   `engine/apps/lines/package.json` pins.
2. Set `pnpm.overrides` for the three parser packages to what the error names. These come from the
   engine's `pnpm-lock.yaml` snapshot for that Svelte.
3. `pnpm install`, build again, and commit `package.json` + `pnpm-lock.yaml` in the game repo.

The desktop launcher applies steps 1–2 itself before every synced ☁ Publish / 📦 Deliver
(`align_svelte_pins`, invisible-launcher#16, from the release after v1.0.56). It reads the values
from `svelteVersions.js` and writes them into that build's `package.json` only, the way it
backfills missing workspace packages, so a repo that was never updated still builds. Committing
them (step 3) is still what fixes a repo at rest, and what a local `pnpm build` needs.

`IE_ALLOW_SVELTE_MISMATCH=1` turns the error into a warning, for investigating only: the bundle is
still broken.

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

**A rollback has a floor: the first release with #1241.** Since the rig export ships a rig on its
sheet's own page (`exportRigBundle`, 2026-10-16), every game published or re-assembled after that
reads its rotated rig regions as `rotate:270`. A runtime from before #1241 does not know 270 and draws
every such region distorted, in every game at once. So never `rollback` or `pin` below the first
release whose commit includes #1241 (`list` shows each release's commit); to undo a newer release,
roll back to one at or above it.

**A second floor: the first release with Invisible Shader Graph step 6 (#1333).** Publish compiles a
project's shader graphs into the game's bundle, and the runtime links the GLSL library functions
they call from its own copy. Step 6 added library functions for its new nodes, so a graph that
uses one calls functions a runtime from before it does not have, and that effect draws nothing (a
shader that fails to compile) where it plays. Graphs saved before step 6 compile as they did. Never `rollback` or `pin`
below that release. A game published in the minutes between the launcher's deploy and the
release's promote is in the same state until the promote lands; it needs no re-publish. Runtimes
from step 6 on refuse such an effect outright (`readCustomElementFx` drops an effect calling a
library function it lacks), so the next addition fails safe: the effect plays nothing rather than
drawing a broken shader.

**A soft floor: the first release with Invisible Shader Graph step 8a.** A graph with a motion
graph ships its motion as a program (`motion.program`) that the runtime runs each frame. A runtime
from before 8a ignores it: such an effect plays its pixels, passes and curves, but not the graph's
motion or its growing room (its room is the doc's fixed padding). Rolling back below that release
silently drops that motion in every game that uses it; nothing breaks, so this floor is soft. Graphs
without a motion graph compile byte-identically and are unaffected. Runtimes from 8a on drop a
program they cannot run (one using an op added later) and play the curves, so the next op added
degrades the same way.

**A soft floor: the first release with Invisible Shader Graph step 8b.** A graph with a Break
Output ships its break as `break` beside its pass. A runtime from before 8b ignores it: an exit
effect then plays its graph, passes and motion over the whole play and fades the element out on
the fade its compiled alpha curve (or its motion program, when that drives alpha) carries for this,
so it still leaves the screen, unbroken; an assemble simply shows the element and plays its graph.
Rolling back below that release silently drops the breaks in every game that uses them; nothing
breaks, so this floor is soft. Graphs without a Break Output compile byte-identically. Runtimes
from 8b on drop a break they cannot play (a kind or param added later, a phase mismatch) and play
the effect as an older runtime does.

**A floor for Custom GLSL: the first release with Invisible Shader Graph step 8c.** An effect
holding a Custom GLSL node ships functions (`efxGlsl_<n>`) that runtimes from step 6 to 8b take for
library calls they lack, so they drop the effect: it plays nothing on its element (which stays as it
is). Rolling back below 8c silently removes every such effect; graphs without Custom GLSL are
unaffected. From 8c on, the runtime also asks the driver whether each Element FX program linked and
draws the element unchanged when one did not, so a shader a phone rejects never blanks the element.

**A soft floor for particle materials: the first release with Invisible Shader Graph step 8d.3.**
An Invisible FX layer may name a material (`EmitterLayer.material`, `custom:<id>`), and its
particles then draw through that compiled effect. A runtime from before 8d.3 reads named fields
only, so it ignores `material` and draws those particles as the plain sprites they were; their
`material.*` parameter drives fail to parse and do nothing. Rolling back below that release
silently drops every material in every game that uses one; nothing breaks or goes invisible, so
this floor is soft. Effects with no material are unaffected. From 8d.3 on, a material whose kind
the runtime has not registered (its graph deleted, not compiled, or calling something this runtime
lacks), a ninth material layer drawing at once, or a program the phone will not link also draws the
plain sprites, so the next addition degrades the same way.

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

**Rolling the runtime back past bonus-games Phase 7b is unsafe for pots-overlay games.** A pre-7b
engine reads `potsOverlay` off the config in `Game.svelte` (the pot signals) and `flowEffects.ts` (the
per-reel token timing), and a config baked by the 7b launcher no longer carries it. Republishing does
not help: roll forward or unpin instead. Details: `docs/guides/release-and-rollback.md` §4.

**Rolling the runtime back past the premultiplied-KTX2 change darkens phone art** for every game
re-exported since: a pre-fix engine reads the `.pm.ktx2` twins as straight. Roll forward or unpin.
Details: `docs/guides/release-and-rollback.md` §4.

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
