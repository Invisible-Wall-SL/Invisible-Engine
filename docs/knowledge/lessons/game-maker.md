# Game Maker — lessons

What has bitten Game Maker work before, newest first. Format and rules: [README](../README.md).
Current state lives in [status/game-maker.md](../../status/game-maker.md); this file only keeps the
traps. How the runtime ships: [status/engine.md](../../status/engine.md) ("How the runtime ships")
and [design/games-deploy.md](../../design/games-deploy.md).

### Every game repo build fails to resolve a new package
- **Symptom:** after an engine merge, each desktop build stops with `Rollup failed to resolve
  import "<package>"`.
- **Cause:** a third-party dependency was declared in `apps/lines`; the launcher backfills only
  engine workspace packages into a game repo, never third-party ones.
- **Fix:** the dependency lives in a workspace package (`packages/engine-rooms`), imported from it.
- **Guard:** `check:game-app-deps` (Lint). Also [arcade](../families/arcade.md#known-failure-modes).
- **PR:** #1397 (2026-10-27) · source: `docs/design/games-deploy.md`

### A kind change shipped the old kind's flow
- **Symptom:** `salmons`, switched Book-of → `arcade` and re-scaffolded, ran the Book-of flow.
- **Cause:** scaffold seeds are create-only, so Rescaffold kept a doc another kind wrote; the flow
  validated clean against its own `templateId` (`flowV2Validation.ts`).
- **Fix:** `replaceOtherKindDocs` (`projectScaffold.ts`) replaces a doc provably of another
  FAMILY's kind (backed up, CAS'd); Publish refuses `flow-wrong-kind` (`flowTemplateMismatch`).
- **Guard:** `check:project-scaffold`, `check:flow-publish-gate` §15, `check:build-provenance`.
- **PR:** #1369 (2026-10-26) · source: `docs/status/game-maker.md`, `docs/status/flow.md`

### Desktop publish fails with a bare 409
- **Symptom:** ☁ Publish stops on "the portal returned HTTP 409" and gives no reason.
- **Cause:** the desktop build used the key the online Game Maker had published; each side refuses
  the other's card (`hasOwnBuiltBundle`, `assertNotOnlinePublished`).
- **Fix:** a derived desktop profile publishes under `<project>build` (`desktopBuildKey`,
  `launcherProfile.ts`); the reason now reaches the launcher ([launcher lessons](launcher.md)).
- **Guard:** `verify-launcher-profile.mts`, `check:game-bundle-relay`.
- **PR:** not recorded (2026-10-21; first guard 2026-07-22) · source: `docs/status/launcher.md`

### Rolled-back runtime draws rigs distorted or shaders blank
- **Symptom:** after a Runtime rollback, rotated rig regions draw distorted, or a shader effect
  draws nothing, in every game at once.
- **Cause:** published data needs a newer runtime: `rotate:270` regions (#1241) and shader library
  functions (#1333). Never `rollback` or `pin` below those floor releases.
- **Fix:** newer runtimes drop an effect that calls a library function they lack.
- **Guard:** none (rule; `action=list` shows each release's commit).
- **PR:** #1241 (2026-10-16), #1333 · source: `docs/design/games-deploy.md`

### Desktop build black-screens or stops at the Svelte guard
- **Symptom:** a desktop build boots black (`e.exclude.includes is not a function`).
- **Cause:** a game repo pins svelte, kit and the parser overrides at scaffold time; the advancing
  engine needs newer ones, so pnpm installs two Svelte copies.
- **Fix:** `packages/config-vite/svelteVersions.js` refuses and names the pins; the desktop
  launcher aligns them per build (`align_svelte_pins`). Fix a repo at rest per the design doc.
- **Guard:** `check:svelte-pins`. Also [lines.md](../families/lines.md#known-failure-modes).
- **PR:** #1175 (2026-10-13) · source: `docs/status/engine.md`

### Desktop publish refused at the portal's per-file limit
- **Symptom:** ☁ Publish refused a 34 MB `S_Background.webp` that no code loads.
- **Cause:** `pull-project-assets.mjs` mirrored all of `deploy/`, and the repo had committed a
  377 MB `static/assets/` snapshot, so unloaded Atlas Maker Deploy output shipped.
- **Fix:** a non-generated deploy folder is pulled only if game code names it; `pruneDecision`
  deletes unloaded files in a standalone game repo, committed or not.
- **Guard:** `check-pull-reachability.mjs`.
- **PR:** not recorded (2026-10-13) · source: `docs/status/launcher.md`

### A new key shares another project's files
- **Symptom:** `my_game` beside `my-game` read and wrote one R2 tree; tools' paths diverged.
- **Cause:** keys accept `-`, but R2 folders are `r2Slug` (`[^a-z0-9]` → `_`, `projectPaths.ts`;
  `r2_slug` in `services/_shared/iw_common/context.py`). Key R2 work on the slug, not the raw key.
- **Fix:** one slug rule for both halves; `createProject` / `assignProjectToClient` check under
  `withProjectKeyLock` and throw `ProjectFolderTakenError`; Director refuses `key_folder_taken`.
- **Guard:** `check:project-create`; `list:project-folder-aliases` lists old aliases.
- **PR:** #1090 (2026-10-07; noted 2026-06-01) · source: `docs/status/launcher.md`

### Duplicate plays the source game's art or snapshot
- **Symptom:** a duplicate draws the source's assets or serves the source's published version.
- **Cause:** a byte copy keeps the source's prefixes in every JSON; `full` copied `published/`;
  `deploy/` landed before `manifests/`, and write time decides which atlas page wins.
- **Fix:** `projectDuplicate.ts` re-bases JSON by field name, copies `editor/<projectKey>/` too,
  skips `published/` and backups, and copies `deploy/` last.
- **Guard:** `check:project-duplicate`.
- **PR:** not recorded (2026-10-03) · source: `docs/status/game-maker.md`

### Engine change breaks games published before it
- **Symptom:** after an engine merge that changed the bundle contract, older games misbehave.
- **Cause:** a published snapshot freezes DATA, not the engine; `_runtime/lines` still re-points
  every game on each merge. Engine pinning is recorded (`SnapshotMeta.engine`), not enforced.
- **Fix:** the engine keeps reading older bundles (fields omit-when-empty); follow such a PR with
  **Republish all**.
- **Guard:** the "Engine update available" badge (`engineStaleness.ts`).
- **PR:** #841, #849 (2026-09-29) · source: `docs/status/game-maker.md`

### Launcher runs out of memory during exports
- **Symptom:** publish or bake failed with `HTTP 502 — upstream error`; the launcher OOM'd.
- **Cause:** the exporters are the launcher's most memory-hungry path, and parallel assembles
  (bake, publishes, live boots) stacked up.
- **Fix:** exports copy server-side in R2; every `deploy/` writer runs under `withDeployWrite`
  (per-project mutex, at most 2 assembles); bulk republish runs one game at a time.
- **Guard:** `check:published-runtime`.
- **PR:** #841 (2026-09-29; earlier 2026-06-22, 2026-08-24) · source: `docs/status/game-maker.md`

### Merging an engine change re-points every online game
- **Symptom:** a half-verified engine fix reached every online game minutes after the merge.
- **Cause:** a push to `main` touching `apps/lines/**` or `packages/**` runs `Runtime release`
  (`.github/workflows/runtime-release.yml`): gates, build, `_runtime/lines@<version>`, pointer flip.
- **Fix:** verify BEFORE merging; then check the live `X-Runtime-Release` header. Undo with the
  `Runtime rollback` workflow, then revert on `main`. Never probe a bare `bundle.<hash>.js` URL.
- **Guard:** the release's gates and `verify-runtime-live.mjs`.
- **PR:** not recorded (2026-09-28, 2026-09-29) · source: `docs/status/engine.md`

### Online game falls back to stale baked data in silence
- **Symptom:** an authored change is missing in the online game; the browser may blame CORS.
- **Cause:** `/api/editor/runtime` timed out, 502'd during a launcher redeploy, or 401'd, and boot
  fell back to baked data (or the empty shared bundle's sample game) without saying so.
- **Fix:** single-flight + a retry ladder (`fetchRuntimeWithRetry` in
  `apps/lines/src/editor-scenes.ts`) and the `markRuntimeStale` overlay. Check transport first.
- **Guard:** `window.__IE_RUNTIME_STALE__`, the `ie_authoring=1` banner, `X-IE-Runtime-Source`.
- **PR:** not recorded (2026-09-18; earlier 2026-07-17) · source: `docs/status/engine-history.md`

### Two publishes at once drop a game from the test server
- **Symptom:** a game published at the same moment as another vanished from the test server.
- **Cause:** `test_server/games.json` is one global key, read-modify-written unguarded by three
  writers (portal, `scripts/publish-game-bundle.mjs`, the desktop launcher).
- **Fix:** each writer reads with an ETag and PUTs under `If-Match` with a retry
  (`upsertTestServerGame` in `testServerManifest.ts`).
- **Guard:** offline CAS fixture over the real `precondition` module; no named CI gate.
- **PR:** not recorded (2026-08-04, 2026-09-08) · source: `docs/status/game-maker.md`

### Hub chips say a game lacks a mechanic it has
- **Symptom:** the hub said "no wild" for the reference `lines`, or a payline trace on `ways`.
- **Cause:** a detector gated on the strips only (that wild is paytable-only), and a sub-option's
  gate ignored its parent's (`gameProfile.ts`).
- **Fix:** special properties count "on the strips OR in the paytable"; sub-options share the
  parent's `winLineActive`. A new optional mechanic ships with its `FEATURE_DETECTORS` row.
- **Guard:** none beyond the convention.
- **PR:** not recorded (2026-08-20, 2026-08-21) · source: `docs/status/game-maker.md`

### Engine fix does not show in an online game
- **Symptom:** "my fix isn't showing" after republishing the game, or after a per-game bump.
- **Cause:** online games run the SHARED `_runtime/lines` bundle; Publish only points a game at it
  and never rebuilds. A game repo has no engine to bump.
- **Fix:** the change ships by the runtime release (a merge to `main`); Republish refreshes data.
- **Guard:** the per-project "Engine update available" badge (`runtimeBundleReleasedAt`).
- **PR:** not recorded (2026-07-27 badge) · source: `docs/status/game-maker.md`

### Scaffolded game repo could not build
- **Symptom:** a fresh `scripts/new-game.mjs` repo failed on its first module, then on invalid
  compiled JS (`Expected ',', got '?'`).
- **Cause:** a tsconfig `extends` to a missing file, and Svelte's parser deps floating in a
  lockfile-less repo (esrap 2.3.0 printed a TS `?` into JS).
- **Fix:** `extends: config-ts/base.json`; parser overrides read from the engine lockfile.
- **Guard:** `scripts/verify-scaffold-template.mjs`.
- **PR:** not recorded (2026-07-24) · source: `docs/status/engine-history.md`

### Online game URL typed by hand loads stale data
- **Symptom:** a game opened from a retyped URL shows stale assets with no error.
- **Cause:** the per-project read token in `?k=` could hold look-alike glyphs (`l`/`I`, `0`/`O`);
  a misread one 401s the live fetch and the game drops to baked data in silence.
- **Fix:** `mintReadToken` (`apps/launcher-api/src/lib/server/projects.ts`) uses an alphabet with
  no ambiguous glyphs. Tokens are never re-minted, so copy a URL, never retype it.
- **Guard:** the alphabet; the stale-fallback signals above.
- **PR:** not recorded · source: `apps/launcher-api/src/lib/server/projects.ts`

### Game deploy fails with ERR_PNPM_OUTDATED_LOCKFILE
- **Symptom:** a game's frozen install fails though its committed lockfile is correct.
- **Cause:** the machine's `engine/` submodule drifted off the pin: tracked build outputs (baked
  bundle, pulled assets) refused the ff-pull, and the submodule update was skipped.
- **Fix:** served build commands start with `git submodule update --init --recursive`
  (`SUBMODULE_PIN`, `launcherProfile.ts`); the desktop launcher re-pins on every Sync.
- **Guard:** `verify-launcher-profile.mts`.
- **PR:** not recorded (commit `077af80`) · source: `docs/history.md`

### Published game looks wrong while the dev game looks right
- **Symptom:** the published game drew symbols ~1.5× oversized; `apps/lines` dev was fine.
- **Cause:** baked per-cell `sizeRatios` were checked before the reel control in
  `resolveSymbolSizeRatios`; `apps/lines` dev has no baked doc, so it never took that path.
- **Fix:** precedence reel > baked per-cell > coded
  (`packages/engine-game/src/game/symbolMap.ts`). Verify against the live no-store bundle.
- **Guard:** none (rule: test with a baked doc, not only dev).
- **PR:** not recorded (2026-06-18) · source: `docs/history.md`

### Engine source change never reaches a standalone build
- **Symptom:** an engine fix is on `main`, but the built game still runs the old code.
- **Cause:** games consume `pixi-svelte`/`engine-layout` through a prebuilt `dist/`, and a bare
  `vite build` never rebuilds it.
- **Fix:** a game's `build` runs `build:engine` (`pnpm --filter "<slug>^..." run build`) first; the
  runtime release builds `lines^...` before the app.
- **Guard:** the `build:engine` step in `scripts/new-game.mjs` and `runtime-release.yml`.
- **PR:** not recorded (2026-06-04) · source: `docs/history.md`
