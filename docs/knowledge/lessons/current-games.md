# Current games — lessons

What has bitten current-games work before, newest first. Format and rules: [README](../README.md).
Current state lives in [status/engine.md](../../status/engine.md); this file only keeps the traps.
It covers the regression harness ([playtest/current-games.md](../../playtest/current-games.md)),
play-QA ([status/playtester.md](../../status/playtester.md)) and runtime traps that hit every game.
Traps of one game type live in its family file, e.g. [lines](../families/lines.md).

### The loading bar froze while the GPU warm-up ran, and the splash hitched as it appeared
- **Symptom:** an Android `?perf=1` boot logged 50–100 ms `first use` frames under the bar
  (15–44 MB, up to 12 compiles each) and a 67 ms frame as the engine splash appeared.
- **Cause:** `gpuWarmup.ts` budgeted only main-thread time, which a GPU upload or link barely uses,
  and gave up on each frame after 50 ms, so slow frames took more; `LoaderRig` built its context,
  program and page on the splash's first visible frames.
- **Fix:** `warmupSchedule.ts`: per frame 8 ms, 8 MB or one program; the bar fills its last 15%
  during the warm-up; the splash prepares under the bar (`play`).
- **Guard:** `warmupSchedule.fixture.ts` (19 planted mutations caught).
- **PR:** not recorded (2026-11-12) · source: `docs/status/engine.md`

### Spreading boot work over more frames changed every seeded capture
- **Symptom:** a change that touched only the loading bar's frames changed 3 of 4 captures.
- **Cause:** determinism mode's clock moves only between frames, so the warm-up always ran in one
  frame; new byte and program budgets moved `loaded` 41 frames later, and every animation and
  seeded `Math.random` draw after it.
- **Fix:** determinism mode lifts the warm-up budget (`setWarmupFrameBudget`): 0 changed.
- **Guard:** the current-games harness; keep boot work's frame count out of the stepped clock.
- **PR:** not recorded (2026-11-12) · source: `docs/status/engine.md`

### One Space on the start screen continued and bet a spin
- **Symptom:** one Space on `bookofborutremake`'s start screen dismissed it and bet a spin.
- **Cause:** hold-to-spin's `continueFromIdle` (`EnableSpaceHold`) read any non-idle moment after
  the press, here `ResumeBet`'s check, as a round the press started; a blocked page let its 400 ms
  timer beat the key-up. Not the guessed subscriber order.
- **Fix:** `EnableHotkey` keeps a record per key press (`components-shared/src/hotkeyPress.ts`);
  hold-to-spin continues from idle only for a press a `bet` went out under.
- **Guard:** `onePress.fixture.mjs`; trace a key bug in a browser before trusting a guess.
- **PR:** not recorded (2026-11-12) · source: `docs/status/engine.md`

### Svelte work cost 25–40× more in WebKit than in Chromium
- **Symptom:** in WebKitGTK a reel board `{#each}` run took ~4 ms (0.15 in Chromium), a `Symbol`
  teardown ~12–18 ms, a `Container` destroy ~0.3 ms.
- **Cause:** every Svelte anchor of the Pixi tree sat in one run of ~5–11k siblings beside the
  canvas, and WebKit walks a parent's children to the nearest element on each DOM insert, remove
  or move. Detaching the host does not help; an element every ~100 nodes does.
- **Fix:** `pixi-svelte`'s `Container` keeps its children's anchors in a hidden `<div>` of its own.
- **Guard:** `containerAnchors.fixture.mjs`; measure DOM costs in WebKit, never only in Chromium.
- **PR:** not recorded (2026-11-12) · source: `docs/status/engine.md`

### Every desktop downloaded the phones' KTX2 transcoder
- **Symptom:** the runtime page was ~1.3 MB gz, 520 KB of it a transcoder only phones run.
- **Cause:** `config-vite`'s `assetsInlineLimit: Infinity` inlined `libktx.{js,wasm}` as base64.
  Emitted instead, the inline (`iife`) build resolved them to `<page>/assets/`, a 404 only a phone
  hits, and Pixi has no fallback (a missing wasm hangs every `.ktx2` load).
- **Fix:** libktx kept out of inlining, its URL anchored on the bundle (now `import.meta.url`);
  `pixi-svelte/ktx2Transcoder.ts` checks the files (30 s timeout, one retry); `Asset.fallback`.
- **Guard:** `pnpm check:ktx2-transcoder` (runtime, inline delivery, embed; transcoder broken).
- **PR:** not recorded (2026-11-03) · source: `docs/status/engine.md`

### Bet-mode icons were blank on phones
- **Symptom:** a bet-mode / buy menu icon drew nothing on the compressed tier only.
- **Cause:** `betModeMeta.ts` `artUrl` handed an `<img>` the entry's `src`, which on that tier is
  the `.ktx2` twin; a browser cannot decode KTX2 in an `<img>`.
- **Fix:** use the entry's `fallback` (the WebP/PNG it was encoded from) when there is one.
- **Guard:** none; load `?quality=low` when checking any non-Pixi use of an asset URL.
- **PR:** not recorded (2026-11-03) · source: `docs/status/engine.md`

### A rolling symbol popped in once its centre entered the window
- **Symptom:** spinning reels show a gap at the top and bottom; symbols snap in and out.
- **Cause:** `SymbolWrap` culled on the seat's centre, so a cell drew only when half inside, and the
  mask had nothing left to clip.
- **Fix:** while the cell's reel rolls, draw it on the masked layer once any part of its row
  overlaps the window, but hold its art on frame 0 until the centre crosses: an animation clock
  starts at mount, so drawing early without the hold shifts every rig's pose at rest.
- **Guard:** the current-games harness for rest; watch a spin for the roll itself.
- **PR:** not recorded (2026-10-28) · source: `docs/status/engine.md`

### Shipped is not the same as running
- **Symptom:** a fix "done" on a green build, a merge or a push, while players still ran old code.
- **Cause:** each hop can silently not happen: an unpushed commit, a Railway watch path or missed
  webhook skipping a deploy, a skip-CI token in a squash message, a runtime release not re-pointed.
- **Fix:** rule: re-observe the bug gone at the real entry point (the live game's
  `X-Runtime-Release` header, then the failing scenario; for concurrency, two real users).
- **Guard:** `scripts/deploy-drift.mjs` (Deploy drift workflow); the `/deploy` skill.
- **PR:** not recorded (2026-10-27, rebuilt) · source: `docs/INFRA.md`, `docs/director/HISTORY.md`

### Driving the game from a script: handles, clocks, forced outcomes
- **Symptom:** a frozen animation, a round that never ends, a feature that needs RNG luck.
- **Cause:** a hidden tab freezes rAF; `__PIXI_APP__.ticker.update()` moves Pixi, not Svelte's
  raf; `setBoardOverride` is a board LAYOUT override, not an outcome pin.
- **Fix:** walk `window.__PIXI_APP__` (depth 12+); `?ie_determinism=<seed>` + `__IE_DETERMINISM__`
  steps every clock; pin outcomes on the mock (`FORCE_TRIGGER=1`, `BIG_WIN=1`, `…/force?beat=`).
- **Guard:** none; recipes in `apps/lines/src/game/determinism.ts` and `scripts/playtest/`.
- **PR:** not recorded (2026-10-27, rebuilt) · source: `docs/status/playtester.md`

### A new game kind was played with the slot script
- **Symptom:** every PR read `12 pass · 2 fail`: `testarcade` and `match3test` failed both sides.
- **Cause:** `scriptFor()` (`scripts/current-games/lib/plan.mjs`) falls back to `lines` for a kind
  with no screen script; the match-3 snapshot carried a non-match-3 flow, so main stalls too.
- **Fix:** `screens/arcade.json` + a `hold` op; a stall main shares is a note (`assemble.mjs`).
- **Guard:** `assemble.fixture.mjs`, `play.fixture.mjs`. A new kind needs its own screen script.
- **PR:** #1374 (2026-10-26) · source: `docs/status/engine.md` ·
  [arcade.md](../families/arcade.md#known-failure-modes)

### A glow was missing on one phone and fine on another
- **Symptom:** a pink additive glow drew on a Samsung, not on a Pixel; translucent art drew dimmer.
- **Cause:** first blamed colour space, screen mode, GPU. Really the `.ktx2` twins: Pixi took them
  as straight alpha, so blends applied alpha twice. The Samsung, in Desktop-site mode (no "Android"
  in the UA), got PNGs (`preferCompressedTextures`, `apps/lines/src/editor-scenes.ts`).
- **Fix:** twins are encoded premultiplied as `.pm.ktx2` and marked so by `ktx2AlphaMode`.
- **Guard:** `check:ktx2-premultiplied`. Test phones with `?quality=high` and `?quality=low`.
- **PR:** #1224 (2026-10-20) · session 011svEdfvReDK3TEG33psQHq

### A render failed because a game was republished mid-run
- **Symptom:** "mock contract changed during the run" on both sides of a game.
- **Cause:** the plan pinned each contract by hash, but every shard re-read the live
  `test_server/games.json`, which each launcher publish rewrites.
- **Fix:** the plan freezes the contracts in a sealed `contracts.json`; renders deal from it.
- **Guard:** `scripts/current-games/contracts.fixture.mjs` (in `check:all`); the hash check stays.
- **PR:** not recorded (2026-10-08) · source: `docs/director/HISTORY.md`

### The harness posted a secret in a commit status
- **Symptom:** a `current-games` status read `Failed to parse URL from <token value>`.
- **Cause:** a token sat in `PIPELINE_GAMES_URL` and undici quotes a bad URL; GitHub masks logs
  only, not statuses, step summaries or reports.
- **Fix:** all status/report text goes through `scripts/current-games/lib/redact.mjs`; a non-https
  `PIPELINE_GAMES_URL` is refused with a fixed message. The owner rotated the token.
- **Guard:** `scripts/current-games/redact.fixture.mjs` (in `check:all`).
- **PR:** found on #1055 (2026-10-05) · source: `docs/director/HISTORY.md`

### Two renders of one build differed by a font weight or frames
- **Symptom:** same build, a logo text bold on one run, or boots 119–121 frames apart.
- **Cause:** Typekit script/stylesheet loads, baked `FontFace.load()` and first-use font loads ran
  on real time; Pixi caches `CanvasTextMetrics` on first measure, so the first face wins.
- **Fix:** determinism mode counts scripts, stylesheets and font loads as I/O and holds the app's
  start until every declared face loads (`determinismInit`, `apps/lines/src/hooks.client.ts`).
- **Guard:** main-vs-main self-compare, 161 of 161 screens byte-identical.
- **PR:** #1061 (2026-10-05) · source: `docs/playtest/current-games.md`

### HUD text drawn bolder on one side only
- **Symptom:** on `lines` games the HUD texts were slightly bolder on one side, same frame.
- **Cause:** Pixi blends its back buffer onto a transparent canvas without clearing it; stepping
  faster than the browser shows frames drew a text twice (`1 − (1 − a)²` edges).
- **Fix:** determinism mode clears the canvas before each draw (`clearCanvasBeforeDraws`).
- **Guard:** self-compare runs; flag-off runtime unchanged.
- **PR:** #1061 (2026-10-05) · source: `docs/playtest/current-games.md`

### Book games crashed only in CI with a zero-size canvas
- **Symptom:** `drawImage … canvas element with a width or height of 0`, every scenario.
- **Cause:** the CI headless shell had no WebGL (newer Chrome no longer falls back to SwiftShader),
  so Pixi silently used its Canvas renderer, which no player takes.
- **Fix:** `--enable-unsafe-swiftshader` (`scripts/playtest/headless-shell.mjs`).
- **Guard:** a unit whose page did not render with WebGL is that unit's error.
- **PR:** #1061 (2026-10-05) · source: `docs/playtest/current-games.md`

### A built-in component change showed no difference on live games
- **Symptom:** a 1 px change to a built-in def changed none of the published games.
- **Cause:** a publish bakes each def it uses into the snapshot (`runtimeBundle.ts`), and the
  runtime registers those over its built-ins; the change lands only at the next publish.
- **Fix:** the "as republished" row (`lib/builtins.mjs`, `lib/republish.mjs`); a game whose
  published engine commit is unknown fails closed.
- **Guard:** `scripts/current-games/republish.fixture.mjs`.
- **PR:** #1063 (2026-10-05) · source: `docs/playtest/current-games.md`

### A game timed out at frame 7200 on both sides
- **Symptom:** `cloud`: every scenario ran to the frame limit on main and on the branch.
- **Cause:** its snapshot has no `basegame` scene, so the runtime shows `boot stopped — runtime
  bundle shape invalid`. Players see the same.
- **Fix:** a refused snapshot is its own row, "not rendered (main's runtime refuses the
  snapshot)", decided after 10 frames. The game needs republishing (owner).
- **Guard:** the refused-row rule in `scripts/current-games/lib/render.mjs` and `report.mjs`.
- **PR:** #1061 (2026-10-05) · source: `docs/playtest/current-games.md`

### Headless runs never reached idle in a cloud container
- **Symptom:** "the game never reaches idle" in Claude Code cloud sessions.
- **Cause:** the scripts looked only for `chrome-headless-shell`; the image ships `headless_shell`
  and runs as root, where Chromium needs `--no-sandbox`. The harness, not the engine.
- **Fix:** one launcher, `scripts/playtest/headless-shell.mjs`: both names, sandbox flag only as
  root, the shell's stderr on an early exit.
- **Guard:** none.
- **PR:** not recorded (2026-10-02) · source: `docs/status/playtester.md`

### check-balance-flow went red one run in ten
- **Symptom:** `check:all` failed now and then on balance flow; it never reproduced alone.
- **Cause:** the check read a round's FIRST `setTotalWin`, but a free-spin round sends a running
  total per spin; the private mock was unseeded, so only some runs dealt a feature.
- **Fix:** read the LAST `setTotalWin`, anchor the interim, run a forced feature round every time;
  `check:all` seeds each private mock with the check's id (`startMockRgs`).
- **Guard:** `scripts/check-balance-flow.mjs` (300 seeds, 0 fails).
- **PR:** not recorded (2026-09-30) · source: `docs/status/engine.md`

### My art and config never load, intermittently
- **Symptom:** an online game sometimes boots on stale or sample content, blamed on the tool.
- **Cause:** the live assemble (`/api/editor/runtime`) took 83–97 s against a 60 s attempt cap,
  so only a cached run loaded; a failed fetch fell back silently to baked or sample data.
- **Fix:** longer caps for authoring boots; a `?runtime=1` boot whose bundle fails stops on the
  error screen (`haltBoot`, `apps/lines/src/editor-scenes.ts`) and sets `__IE_RUNTIME_STALE__`.
- **Guard:** check `window.__IE_RUNTIME_STALE__` and the transport before blaming the tool.
- **PR:** not recorded (2026-09-29) · source: `docs/status/engine.md`

### Game dev servers showed ERR_MODULE_NOT_FOUND
- **Symptom:** `pnpm --dir apps/lines dev` served a module-not-found overlay after #852.
- **Cause:** Vite dev SSR externalised `error-tracking`, whose extensionless re-exports Node could
  not resolve. Production builds were never affected.
- **Fix:** `ssr.noExternal: ['error-tracking']` in `packages/config-vite/index.js` (all six apps).
- **Guard:** none; a dev-only break, so boot a dev server after adding a non-Svelte package.
- **PR:** #860 (2026-09-29) · source: `docs/status/engine.md`

### A fixture stayed red on main after a refactor
- **Symptom:** `winTapLand.fixture.ts` red on `main` for weeks; read as a regression.
- **Cause:** it grepped `Game.svelte` for a source line that #692 moved into
  `apps/lines/src/game/celebrationLock.ts`; the behaviour was unchanged.
- **Fix:** the marker points at the new module.
- **Guard:** `check:engine-game` runs every fixture in CI. Prefer behaviour over source greps.
- **PR:** #692 caused it (2026-09-28) · source: `docs/status/engine.md`

### An animation stalls only under automation
- **Symptom:** a big-win count-up at its target that never completes; a paying spin that waits
  ~4 s per beat; a round "stuck" mid-free-spins.
- **Cause:** a hidden tab (Browser pane, background Chrome) freezes rAF, the desktop pane renders
  ~1 fps even when `visible`, and hand-stepping Svelte's `raf.tasks` never reaps the tween.
- **Fix:** re-run on the headless real clock (`scripts/playtest/win-countup-repro.mjs`).
- **Guard:** rule: a stall seen only under a stepped clock is unconfirmed until it reproduces there.
- **PR:** #808, #809 (2026-09-28) · source: `docs/status/playtester.md`

### Measured download size disagreed with DevTools
- **Symptom:** DevTools showed 70 MB while `performance.getEntriesByType('resource')` showed ~5.
- **Cause:** `runtime=1` art is fetched inside a Web Worker (invisible to the main frame's entries)
  and cross-origin without `Timing-Allow-Origin` (`transferSize: 0`).
- **Fix:** measure by resolving each sheet's pages against the deploy and fetching them.
- **Guard:** none; measure before theorising (the first theory, KTX2 twins, was wrong).
- **PR:** not recorded (2026-09-23) · source: `docs/status/engine.md`

### The Buy Feature button was missing only on phones
- **Symptom:** no Buy Feature on phones since #179; desktop fine.
- **Cause:** `?quality=low` (the iPhone tier) loads KTX2 atlases; a small page earned no `.ktx2`
  twin and kept a name `PageStore` had moved to `_pages/`, so one 404 failed the whole rig bundle.
- **Fix:** every page is rewritten to its stored path (`apps/launcher-api/src/lib/server/rig.ts`).
- **Guard:** `pnpm check:page-store` claim 8. Load `?quality=low` when checking a game.
- **PR:** #778 (2026-09-23) · source: `docs/status/engine.md`

### Page state read from a source import disagreed with the game
- **Symptom:** a probe read every `state-shared` flag as false while the game behaved otherwise.
- **Cause:** a raw `/@fs/…/stateUi.svelte.ts` import loads a DUPLICATE module instance.
- **Fix:** read shared state through the barrel `packages/state-shared/index.ts`.
- **Guard:** none; recorded in the playtester harness notes.
- **PR:** not recorded (2026-07-30) · source: `docs/status/playtester.md`
