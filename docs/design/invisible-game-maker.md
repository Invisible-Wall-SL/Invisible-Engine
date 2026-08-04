# Invisible Game Maker — author a full game deploy online

> Status: **DRAFT / scoping** (2026-06-16). Not built. This doc answers a concrete
> gap the owner hit: *"I created a project and a game from the templates online —
> now how do I publish and play it?"* Today the answer is "drop to the CLI
> (`new-game.mjs`), stand up a standalone GitHub repo, and click Build & publish
> in the desktop launcher." That breaks the project's core rule — **author
> everything online; the desktop launcher is only for publishing**
> ([[feedback_author_online_publish_via_launcher]]). This doc scopes the online
> tool that closes the gap.

> Build status: see [docs/status/game-maker.md](../status/game-maker.md); detailed done-log in [docs/history.md](../history.md).

## The missing rung

Every authoring step is online except the one that makes a game *exist as a
playable frontend*:

| Stage | Where it happens today |
|---|---|
| Create client + project + R2 scaffold | ✅ online (`/admin`) |
| Author layout from a game-type template | ✅ online (editor) |
| Author atlases / sheets / fonts / symbols / strings | ✅ online tools |
| **Turn that into a runnable, published game** | ❌ CLI `new-game.mjs` → standalone GitHub repo → desktop **Build & publish** |

The shipping step assumes the **games-as-submodule-repos** model from
[games-deploy.md](games-deploy.md). That model is correct for *bespoke, shipped*
games that pin an engine version and deploy on their own cadence. It is the wrong
model for **"I want to author a game entirely in the cloud and test it"** — which
is the owner's stated workflow for the pipeline. Game Maker serves that workflow;
the submodule-repo path stays available for games that outgrow it (see
[§ When to graduate to a repo](#when-to-graduate-to-a-repo)).

## Goal

One launcher tool — **Invisible Game Maker** (name TBD; fits the
Atlas/Sheet/Font **Maker** family) — where the owner can, in the browser:

1. pick a client + game-type (`lines`, `ways`, `cluster`, `scatter`, `bookOf`, or
   a custom kind),
2. name the game → it creates the project + R2 scaffold (already exists),
3. author it with the existing online tools (editor, atlas, fonts, symbols…),
4. click **Publish** → the game is immediately playable at
   `https://games.invisiblewall.org/<key>/`, spinning against the mock RGS,
5. with **no standalone repo and no local build**.

## The key architectural decision: generic runtime + live authoring fetch (no build)

A game does **not** need to be rebuilt to change its art, layout, fonts, strings,
symbols, or math — all of that is already authoring data in R2. The only reason
publishing rebuilds a bundle today is that each game is its own compiled app. So
the decision is:

> **Ship ONE pre-built generic engine bundle per game-type, served from the test
> server, that boots a *specific* game by fetching that project's authoring data
> from R2 at load time. "Publish" becomes a data + manifest operation, not a
> build.**

This is viable because the engine **already** supports it: the checked-in baked
placeholder uses `doc: null`, which makes the game **fetch its layout live** from
`GET /api/editor/doc` at boot (`scripts/bake-editor-doc.mjs:21-24`,
`apps/lines/src/editor-scenes.ts:288-313`). The generic runtime is just that path
made first-class.

### Considered and rejected: a cloud build farm

The alternative — a server-side build worker that runs `pnpm build` per publish
(feeding it the project's R2 data via the existing token-driven
`bake-editor-doc.mjs` + `pull-project-assets.mjs`) — produces a *real* per-game
bundle and supports arbitrary per-game code. But Railway's launcher is a
SvelteKit app, not a build farm; this needs a separate build service/job runner,
per-publish build latency, and toolchain maintenance. **Defer it.** It only earns
its keep once games need bespoke compiled code that the generic runtime can't
express — at which point those games should arguably be submodule repos anyway.
Game Maker targets the data-driven majority first.

## What already exists (the green)

Both halves of the pipeline are further along than expected.

### Launcher / pipeline side — everything but the build

- **Project + scaffold:** `createProject` (`projects.ts:225-234`) + `scaffoldProject`
  (`projectScaffold.ts:27-93`) already seed `editor/scenes.json` (the engine-owned
  projection of the kind), `atlas_config.json`, `manifests/`, `input/refs/`,
  `sheet_config.json`, `localization/strings.json`. Wired in the `/admin`
  `createProject` action (`admin/+page.server.ts:344-391`).
- **Authoring doc + live fetch:** `GET /api/editor/doc?project=&components=1&k=<token>`
  returns the doc + component defs, rewriting spine keys for the runtime
  (`api/editor/doc/+server.ts:89-127`).
- **Asset export (server-side functions exist):** `exportEditorArt`
  (`editorArtExport.ts:239-401`) + `POST /api/editor/export-art`, plus export-fonts
  / export-symbols / strings, all write into R2 `<client>/<project>/deploy/`.
  `GET /api/deploy` serves that tree (`api/deploy/+server.ts`).
- **Game registry:** `POST /api/launcher/register-game`
  (`register-game/+server.ts:38-122`) upserts the `games` table
  (`schema.ts:52-69`) → the portal Games section. Launch URL already supports
  arbitrary query params.
- **Test server:** `services/test-server/server.mjs` serves `GET /<gameKey>/<path>`
  from R2 `test_server/<key>/`, mounts the right mock RGS by `protocol`, and
  re-hydrates on `POST /refresh` (202 + background, `:271-298`). Manifest
  `test_server/games.json` = `{ key → { protocol, name } }`
  ([test-server.md](../tools/test-server.md):126-138).

### Engine side — visuals + assets are already data-driven

- **Doc → Pixi render** is shipping and load-bearing:
  `LayoutNodeView.svelte` walks the node tree and emits real pixi-svelte
  primitives — `sprite`, `spine` (with signal-driven `cues`), `text`
  (system/bitmap/localized/numeric-readout), `container`, `componentInstance`
  prefab expansion, background cover/contain fitting, and a `bind` escape hatch
  for coded components.
- **Board placement from the doc:** `setBoardOverride(findReelGridNode(doc))` +
  `stateGame.svelte.ts` read the reel grid's position, cell size, gaps, padding,
  and spin feel from the doc.
- **Asset registration from R2:** the `bakedEditorArtAssets()` /
  `bakedSymbolAssets()` / `bakedFontCatalog()` chain registers exported
  atlases/spines/fonts/symbol bindings into `createApp({assets})` with no manual
  `assets.ts` edits — the export→deploy→bake→pull→register chain
  ([[feedback_r2_assets_must_ship]], [live-assets.md](live-assets.md)).

**Net:** background, scenery, HUD, free-spin intro/counter/outro, loading splash,
board position/shape/spin-feel, fonts, localized text, and per-instance prefab art
are **already** driven by the online doc + R2 assets today.

## The gaps (the honest part)

### Engine gap 1 — game-type is a folder, not a runtime switch

`apps/{lines,cluster,…}` are separate apps. `PUBLIC_RGS_GAME=book` only switches
**RGS symbol/amount translation** (`rgs-translator-eagaming/src/gameMappings.ts:90-115`),
not which components mount or how book events animate. The doc's `gameType` field
(`engine-layout/.../types.ts:416`) is currently an **editor hint only** — no
runtime reads it to select behavior.

**Needed:** promote one canonical runtime **per game-type** (one `lines` runtime,
one `bookOf` runtime) selected at boot by the doc's `gameType`. This is "generic
*per type*," not one universal bundle — the realistic first target.

### Engine gap 2 — config is compiled, not loaded — ✅ CLOSED (Invisible Game Config)

> **Resolved.** `game/config.ts`'s data (reelstrips/paylines/paytable/betModes/
> symbols/grid + win-tiers) is now authored in the `/config` tool and loaded from
> R2 (`<client>/<project>/config/config.json`, `GameConfigDoc`), resolved at boot
> by `apps/lines/src/game/gameConfig.ts` (`runtime → baked → compiled`). It rides
> `assembleRuntimeBundle` + the desktop bake. See
> [invisible-game-config.md](invisible-game-config.md) (authoritative) and
> [../status/game-config.md](../status/game-config.md). Residual still-compiled:
> a few `constants.ts` feel knobs (`SYMBOL_SIZE`, `REEL_PADDING`, spin timing,
> `zIndexes`) — board dimensions are config-driven; these rarely need per-game
> overrides. Original description kept below for history.

`game/config.ts` (~6,500 lines of reelstrips/paylines/paytable/betModes),
`constants.ts` (`SYMBOL_INFO_MAP`, geometry), `winLevelMap`, `paytable`,
`infoManifest` are **data stored as `.ts`**, compiled per app.

**Needed:** move them to R2 JSON with a loader, mirroring the proven doc/asset
chain. Mechanically straightforward; unlocks per-game math without a rebuild.

### Engine gap 3 — behavior is per-game TypeScript (the long pole)

`game/bookEventHandlerMap.ts` is the animation **timeline**: each book event
(`reveal`, `winInfo`, `freeSpinTrigger`, `tumbleBoard`…) maps to an imperative
async function broadcasting a hand-ordered sequence of emitter events with awaits
between them. The win/transition/free-spin overlay **components** (`Win.svelte`,
`Transition.svelte`, `GlobalMultiplier.svelte`, the `Symbol*` tree, `Board.svelte`)
are coded Svelte — the doc positions them, but their behavior is TS.

The engine authors already flagged this as the missing layer: `types.ts:500`
reserves `tracks?: BehaviorTrack[]` — *"v2 authored-behavior timeline … NOT in
v1."*

**Needed for truly novel games:** a declarative book-event → behavior-track format
+ interpreter, a versioned engine-owned signal/action vocabulary, and
doc-composable generic overlay components. This is a multi-quarter engine project,
not a config flag. **It is NOT required for reskin/template games** (see phasing).

### Launcher gap — a server-side Publish action

Publishing is entirely desktop-launcher-driven today; there is no server endpoint
that orchestrates it. Needed:

1. A **Publish** server action that, server-side: runs export-art/fonts/symbols
   (functions already exist), ensures the project's generic runtime is registered
   on the test server, writes/merges the `games.json` manifest, and upserts the
   `games` row (reuse `register-game` internals). The upload+manifest-merge logic
   currently lives only in the standalone `publish-game-bundle.mjs` — extract it
   into `$lib/server`.
2. A **`runtime` field** in the test-server manifest so many game keys can share
   one prebuilt generic bundle dir (`server.mjs` resolves the bundle by `runtime`
   instead of 1:1 by key), OR — simpler v1 — publish a copy of the generic bundle
   per key (cheap, zero manifest change).
3. A **project-scoped, read-only token** for the runtime's live
   `/api/editor/doc` + `/api/deploy` fetches. A browser-served live-fetch runtime
   would otherwise expose the shared deploy token client-side
   (`editor/doc/+server.ts:76-82`). Issue a per-project read token instead.
4. **Tool registration + docs** per house rule #9: add to `roles.ts`
   (`TOOLS`/`ROLE_TOOLS`/`TOOL_BAR_ORDER`/`TOOL_DOC_SLUG`) and ship
   `docs/tools/<slug>.md` in the same change (use the `docs-keeper` subagent).

## Build plan (phased)

Each phase is independently shippable and leaves the pipeline working.

### Phase 0 — Generic runtime spike (gate)
Prove one game-type (`lines`) can boot as a **single prebuilt bundle** that
renders a real project purely from a live fetch — no per-game `src/`.

### Phase 1 — Server-side Publish for reskin games
- Extract publish/upload/manifest logic into `$lib/server/publishGame.ts`.
- Add the **Publish** server action + a minimal Game Maker page (client/gameType
  picker → create project (existing) → Publish button).
- Add the manifest `runtime` field (or per-key bundle copy) + project read token.
- Wire export-art/fonts/symbols to run at publish.
- Register the tool + write its doc.
- **Outcome:** the owner authors a `lines` reskin online and clicks Publish →
  playable. Closes the exact gap that prompted this doc.

### Phase 2 — Config from R2 — ✅ DONE (Invisible Game Config)
Delivered as a standalone initiative, not inside Game Maker: the `/config` tool +
`packages/game-config` author `GameConfigDoc` (symbols/paytable/paylines/bet-modes/
reelstrips/grid + win-tiers) into R2, resolved at boot by `gameConfig.ts`
(`runtime → baked → compiled`) and carried by `assembleRuntimeBundle` + the bake.
So per-game math/symbols/geometry change without a rebuild. See
[invisible-game-config.md](invisible-game-config.md) +
[../status/game-config.md](../status/game-config.md). Residual: a few `constants.ts`
feel constants remain compiled (see gap 2). To make an authored config LIVE on an
online game: author it in `/config`, then Runtime release (`runtime:lines`) +
republish (the reader ships in `_runtime/lines`).

### Phase 3 — More game-types
Generalize Phase 0/1 to `bookOf`, then `ways`/`cluster`/`scatter` runtimes.
Each is one prebuilt bundle + the `gameType` runtime switch (engine gap 1).

### Phase 4 — Behavior tracks (the real engine project)
Design + build the `BehaviorTrack` timeline format (`types.ts:500`), its
interpreter, the versioned signal/action vocabulary, and generic doc-composable
overlay components. This is what unlocks **novel** games fully online. Scope it in
its own design doc when Phases 1–3 are proven; it is the largest piece and should
not block the reskin workflow.

## When to graduate to a repo

Game Maker and the submodule-repo model coexist:

- **Game Maker (this doc):** data-driven games — reskins and games composed from
  the engine's catalog of behaviors/prefabs. Authored + published entirely online,
  no repo, no build, instant test-server deploy.
- **Submodule repo ([games-deploy.md](games-deploy.md)):** games that need bespoke
  compiled code (a unique bonus mechanic the behavior catalog can't express), pin
  a specific engine version, and ship to a client on their own cadence.

A game can start in Game Maker and graduate: `new-game.mjs` scaffolds a repo, and
the project's existing R2 authoring data carries over via the same bake/pull chain.

## Open decisions

1. **Tool name.** "Invisible Game Maker" (Maker family) vs "Game Factory" /
   "Foundry". Could also live as a mode of the existing editor rather than a
   separate tool — but a distinct create-and-publish surface reads cleaner.
2. **Manifest: shared `runtime` bundle vs per-key bundle copy.** Per-key copy is
   simpler for v1 (no `server.mjs` change); shared `runtime` saves storage and
   makes "republish the runtime" one operation. Recommend per-key copy for Phase 1,
   shared `runtime` when game count grows.
3. **Math authoring.** Does Game Maker own a math/paytable editor (Phase 2), or do
   games ship with per-game-type default math until a dedicated tool exists?
4. **Token model.** Confirm a per-project read-only token (issuance, rotation,
   scope) for the public live-fetch runtime — don't expose the shared deploy token.
5. **Where create-project lives.** Game Maker should likely absorb the
   create-project + gameType pick that's in `/admin` today, so the whole flow is
   one tool.

## Key file anchors

- Engine render path: `packages/engine-layout/src/lib/LayoutNodeView.svelte`,
  `apps/lines/src/components/Game.svelte`, `apps/lines/src/editor-scenes.ts`,
  `apps/lines/src/game/stateGame.svelte.ts`
- Behavior gap: `apps/lines/src/game/bookEventHandlerMap.ts`;
  reserved track format `packages/engine-layout/src/lib/types.ts:500`; `gameType`
  hint `:416`
- Game-type switch (today symbol-only): `packages/rgs-translator-eagaming/src/gameMappings.ts:90-115`
- Project + scaffold: `apps/launcher-api/src/lib/server/projects.ts:225-234`,
  `projectScaffold.ts:27-93`, `admin/+page.server.ts:344-391`,
  `projectPaths.ts:22-99,153-155`
- Authoring doc + export + deploy: `api/editor/doc/+server.ts:89-127`,
  `editorArtExport.ts:239-401`, `scripts/bake-editor-doc.mjs:21-24,120-332`,
  `scripts/pull-project-assets.mjs:118-202`, `api/deploy/+server.ts`
- Publish + registry + test server: `apps/launcher-api/scripts/publish-game-bundle.mjs:108-152`,
  `register-game/+server.ts:38-122`, `schema.ts:52-69`,
  `services/test-server/server.mjs:185-212,271-338`,
  [test-server.md](../tools/test-server.md):126-138
