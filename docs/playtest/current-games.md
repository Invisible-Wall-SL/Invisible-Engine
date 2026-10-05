# Current-games regression harness

The rule is *never break a current game*. Every pipeline change must show that every live game
still builds, passes its tests and looks the same as on `main`. This harness is that proof. Spec:
[ADR-0004](../director/DECISIONS/0004-current-games-regression-harness.md). Code:
`scripts/current-games/`. CI: `.github/workflows/current-games.yml`, which posts the commit status
`current-games`.

## What it does

For every live game (`GET /api/pipeline/games`, bearer `PIPELINE_CI_TOKEN`):

1. **Build.** It builds the branch's `apps/lines` runtime and `main`'s runtime the way
   `runtime-release.yml` does: workspace packages first, then the app with
   `PUBLIC_RGS_TRANSPORT=play4fun` and `PUBLIC_DELIVERY_PROFILES='*'`. Main's runtime is cached by
   SHA under `.cache/current-games/runtimes/<sha>/`.
2. **Plan.** It reads each game's published pointer from R2, read-only, once per run, and pins
   that snapshot id for every render of the run, so a republish mid-run cannot hand two renders two
   different snapshots. It pins the game's mock contract from `test_server/games.json` the same
   way, by hash: the plan is a public artifact, so it never carries the contract itself, and each
   render reads the contract, drops `docBase` and `readToken`, and refuses to render one whose hash
   changed. The plan lists the render **units**: one side (main's runtime or the branch's) of one
   scenario of one game. A snapshot is immutable by id, so its download (`<id>/runtime.json` +
   `<id>/deploy/**`) is cached.
3. **Serve.** It serves what a player boots, twice, once per runtime:
   - a local stand-in for the launcher's `/api/editor/runtime` that answers the frozen
     `runtime.json`, with `assetBase` pointing at the frozen `deploy/` files;
   - the real Invisible Test Server (`services/test-server/server.mjs`) in local mode. It serves the
     runtime at `/<key>/` and the game's mock RGS, dealt from its manifest entry. The launcher link
     (`docBase`/`readToken`) is dropped, so the mock never follows live data mid-run. The game is
     booted through the mock's **authoring** channel, the one that takes forced beats.
4. **Play.** It boots with `?ie_determinism=<seed>` (see "Determinism mode" in
   [status/engine.md](../status/engine.md)) at 1280×720, DPR 1, UTC, en-US, with WebGL, and plays
   the game type's screen script. Each unit gets a fresh test server and browser, so the seeded deal
   starts over, and the two sides of a comparison need not share a machine. A page that rendered
   with Pixi's Canvas renderer instead of WebGL is that unit's error: players render with WebGL.
   A snapshot the runtime refuses to boot (its own `[runtime] boot stopped —` error screen) is
   known after 10 frames, not after a 2-minute wait.
5. **Compare.** It compares each screen with pixelmatch under `tolerance.json`.
6. **Test.** It runs the game type's `check:*` gates (`scripts/current-games/lib/gates.mjs`). The
   screen script is the scriptable smoke: a scenario that does not reach a screen, or whose page
   reports `errors > 0` or `stalls > 0` on either side, fails the game's **tests**.

## Screen scripts

`scripts/current-games/screens/<gameType>.json` holds one file per game type: `lines`, `ways`,
`cluster`, `scatter`, `bookOf` and `holdAndWin`. A custom kind uses its mock protocol's script,
which is `lines`. Each file has 12–14 screens in scenarios. A scenario is data: the mock env it
starts with (`SEED`, `FORCE_TRIGGER`, `WIN_X`) and a list of steps. The ops are listed at the top of
`scripts/current-games/lib/play.mjs`:

| Op | What it does |
|---|---|
| `waitFor` | Waits for a state the page reports: `screen`, `inSet`, `idle`, `loaded`, `playerIn` or `winLevel`. |
| `until` | The same, checked by the harness, with `winAbove`, `winLevelIn` and `anyOf` as well. |
| `step` | Runs N frames. |
| `space` | Taps Space for two frames. |
| `tapToStart` | Taps Space only while a tap-to-start screen covers the board. |
| `force` | Holds a forced beat for the next round. `{path}` is filled from the game's own contract, for example `pot:{grid.potsOverlay.pots.0.id}`. |
| `settle` | Steps until idle, tapping past any hold. |
| `spinUntilWin` | Spins until a spin shows a win. |
| `capture` | Takes a screenshot. |

Scenario rules:

- **The canary.** Exactly one scenario per type has `"canary": true` and runs with
  `draw: 'every'`, so every frame is drawn. Every other scenario runs with `draw: 'last'`: the
  frames update without drawing, and one draw happens at each capture. That is about 100× faster
  under software GL. Both sides of a comparison always use the same mode.
- **`requires`.** A scenario with `requires` (contract paths, for example
  `grid.holdAndWin.block.meters.0`) runs only for a game that has that feature. Other games get a
  note on their row.
- **Big-win tiers.** `WIN_X=10,20,40,70,120` makes the lines and book mocks deal the n-th base spin
  so that it pays at least that multiple of the stake. These multiples are the coded ladder's
  big/superwin/mega/epic/max thresholds (`boardPayingAtLeast` in `scripts/mock-rgs-server.mjs`,
  gated by `pnpm check:win-x`). Each banner is captured when the count-up reaches its tier. If a
  project's ladder has no tier of that name, the capture happens at a fixed frame instead. The
  report records the tier that was on show. Hold and Win reaches its tiers through feature totals
  (`trigger`, top `jackpot`).
- **Free spins.** The probe's screen list does not change for free spins, so the free-spin screens
  are taken at fixed frame counts after the trigger spin. Those counts are the same frames on both
  sides.

A screen list is a pipeline-change artifact. Changing one is reviewed like code.

## Tolerance

`scripts/current-games/tolerance.json` holds a `default`, then `gameTypes.<type>`, then
`screens["<type>/<screen>"]`. Each later level overrides the one before it. A screen passes when
both of these hold:

- `differing pixels / all pixels ≤ maxDiffRatio`;
- no `blockSize`×`blockSize` block has more than `blockThreshold` of its pixels differing.

`threshold` is pixelmatch's colour distance. `antiAliasing: "count"` counts pixels that look like
anti-aliasing; `"ignore"` skips them. `masks` are `{x, y, w, h}` rectangles, used only for content
that is time-based by design. Changing the tolerance is a pipeline change the owner approves. The
report shows the tolerance each screen ran with.

**Values and why.** Determinism mode makes main vs main byte-identical on every screen of every
live game (measured below), so there is no noise to sit above. The values are as tight as the 1 px
proof needs: any differing pixel in any 16×16 block fails (`blockThreshold: 0`), and pixelmatch's
colour threshold is 0.1. `maxDiffRatio` stays at the ADR's 0.1 %, but the block rule is what catches
a 1 px change. There are no masks and no per-type or per-screen overrides: every difference the
calibration found had a root cause, fixed below. If a game ever shows real noise, loosen that game
type or screen alone, with the measured number in the PR.

## Running it locally

```bash
pnpm install
# Stand-in games (no R2, no launcher): one per game type, from the reference layouts.
node --experimental-strip-types --import ./scripts/ts-loader.mjs scripts/current-games/fixtures.mjs
# Branch vs main: builds main's runtime in a throwaway worktree (cached by SHA) and the working tree.
node scripts/current-games/run.mjs --games-file .cache/current-games/fixtures/games.json
# Faster loops: reuse builds, one game, one scenario, every screen kept, every step logged.
node scripts/current-games/run.mjs --base-build <dir> --head-build apps/lines/build \
  --games-file .cache/current-games/fixtures/games.json --only cg-lines --scenario big-wins \
  --no-gates --keep-screens --trace
# CI's split, by hand: plan once, render shards (anywhere), compare their units.
node scripts/current-games/run.mjs --phase plan --games-file <json> --out plan
node scripts/current-games/run.mjs --phase render --plan plan/plan.json --shard 1/2 \
  --base-build <dir> --head-build <dir> --out part-1
node scripts/current-games/run.mjs --phase compare --plan plan/plan.json --units part-1,part-2 \
  --no-gates --out report
```

A local run renders one unit at a time (`--jobs 1`): SwiftShader already uses every core, and two
at a time halved each unit's speed on a 4-vCPU runner.
`CURRENT_GAMES_LOG_IMAGES=1` writes `crops.txt` beside the report: a 256×128 before / after / diff
crop of each changed screen, around its densest difference, as base64 PNG lines.

To run against the real live games, set `PIPELINE_GAMES_URL` and `PIPELINE_CI_TOKEN` (or pass
`--games-file`) and the read-only `CURRENT_GAMES_R2_*` key ([INFRA](../INFRA.md)). The run never
writes to R2. It needs the Playwright headless shell (see "The headless real clock" in
[README.md](README.md)). The report goes to `.cache/current-games/report/` (`--out`).

## Reading the report

`index.html` (and `report.json`) has one row per game:

| Column | Meaning |
|---|---|
| **Build** | Whether the branch runtime built. |
| **Tests** | The type's gates plus the smoke. On a failure it names the failing gate, or the scenario and side that did not reach a screen or reported errors or stalls. |
| **Looks the same** | `looks the same (N screens)`, or `k of N screens changed`. |

Rows that are visible but never count as a pass:

- `not rendered (no snapshot)`: a global game with no published snapshot.
- `skip: not published`: its pointer does not exist yet.
- `own bundle — build + tests only`: a desktop-built game (`hasOwnBuiltBundle`). It serves its own
  bundle, the same one on both sides, so it is not rendered: its screens would compare that bundle
  with itself. Its row still fails when its type's gates fail.
- `not rendered (main's runtime refuses the snapshot)`: main's runtime refuses to boot the
  published snapshot in every scenario and shows its error screen, and the branch's refuses it in
  every scenario for the same reasons. Players get that error screen today; republishing the game
  fixes it. There is nothing to compare, so the branch is not blamed. Anything else fails as
  before: a branch that boots a snapshot main refuses, a branch crash in any scenario, a different
  refusal, a missing render. `assemble.fixture.mjs` (run by `check:all`) holds these rules.

A game whose **main** render fails (a scenario main cannot finish, or main's page reports errors or
stalls) is an `error` row that names main's failure. The branch is not blamed for it, but the
comparison proves nothing until main is fixed.

Each changed screen shows before (main), after (branch) and diff images. It also shows the
measured differing-pixel ratio and worst block, the tolerance it ran with, and its **stable id**:
`<branch sha>:<game key>:<screen>:<diff hash>`. The branch sha is the PR head, not its merge
commit. The diff hash covers both images' pixels, so a new commit that changes the picture gets a
new id. A screen only one side captured has no diff image; its hash covers the one capture and the
side that took it. Phase 5 approvals will name that id.

"Every screen's measured difference" at the bottom is the noise record for every screen, including
the ones that passed.

The overall verdict is **pass** only when every rendered game passes and at least one game was
rendered. A run that cannot start (a missing secret, a failed build) fails and names the reason.

## CI

`current-games.yml` runs on every PR and on pushes to non-main branches. It has five jobs:

1. **`prepare`** posts `pending`, checks the six secrets (a missing one fails the status, named),
   and picks the base commit. On a PR that is the merge commit's first parent. On a push it is the
   merge-base with main. A push to a branch with an open PR stands down, so the PR's run owns the
   status and the two never race. A PR from a fork does not run: it gets no secrets.
2. **`build`** builds both runtimes and makes the **plan** (`--phase plan`):
   the game list, each game's pinned snapshot, and the render units. A plan that cannot be made (a
   missing secret, an unreachable list) carries the reason to the report.
3. **`gates`** runs every game type's `check:*` gates once, beside the build: they test the
   branch's source, not its runtime, so they do not hold up the renders.
4. **`render`** is 20 shards. Each renders its share of the units (`--phase render`), one at a
   time; the plan balances them by each unit's measured seconds (`scripts/current-games/costs.json`,
   refreshed from the `costs:` line a run prints). It first lifts the runner's AppArmor limit on
   unprivileged user namespaces: Playwright's headless shell has no AppArmor profile, so on Ubuntu
   24.04 its sandbox cannot start and it exits at launch. A unit that fails still writes its result,
   so the report names it; a unit with no result at all is its game's error.
5. **`report`** pairs every shard's units (`--phase compare`), compares, uploads the
   `current-games-report` artifact, prints the **digest** to the log and posts the final status.

**The digest** is every non-pass row's cause, written for a reader who cannot download the artifact:
the browser's render paths (`chrome://gpu`: WebGL, 2D canvas, compositing), failing gates, each
failing unit's error and last console lines, and per changed screen the reason, the bounding box,
both frames, both screen sets and a 64×24 map of where the pixels differ. A run that cannot finish
(no plan, no gate results) still writes a report naming why, and the status says so.

**Noise calibration.** A manual run (`workflow_dispatch`, `self_compare: true`) renders a ref
against itself: main's runtime built twice and rendered on separate runners, which is the
main-vs-main measurement. It posts the separate status context `current-games/self-compare` (a
manual run without `self_compare` posts `current-games/manual`), so it never stands in for a
branch's comparison. `log_images: true` prints each changed screen's crops into the log, with each
side's web-font states, every stage text's font string, measured size and texture hash, and the
external requests each render made.

**The repository is public**, so every artifact is downloadable by anyone. The plan carries contract
hashes, never contracts; the per-shard parts (every capture of every game) and the plan and gate
results are kept 1 day, only long enough for the report job; the report (changed screens only) is
kept 14 days.

A docs-only change posts success without rendering.

**Secrets never leave the log.** GitHub masks secrets in job logs only: the status description, the
step summary and the report artifact publish their text as given. Every message bound for one of
them goes through `lib/redact.mjs`, which replaces each secret env's value with `***` and, as a
backstop where the values are not known, any 32+ hex or token-shaped base64 run. A
malformed `PIPELINE_GAMES_URL` fails up front with a fixed message that never quotes it.
`redact.fixture.mjs` (run by `check:all`) proves each secret stays out of all three.

## Calibration on the live games (2026-10-05, Director card 1F)

The first live run (#1055, run 37286687249) reported 6 pass · 7 fail · 8 not rendered · 10 changed
screens on a CI-only change. Every fail and every changed screen came from the harness or from a
determinism gap, none from the engine. What each one was:

| Symptom | Root cause | Fix |
|---|---|---|
| Book games: `drawImage … canvas element with a width or height of 0` on both sides, every scenario | The CI runner's headless shell had **no WebGL**: newer Chrome builds no longer fall back to SwiftShader on their own, so Pixi fell back to its **Canvas** renderer, which throws on a 0-size texture. No player's browser takes that path. | `--enable-unsafe-swiftshader` on non-Windows (`scripts/playtest/headless-shell.mjs`), and a unit whose page did not render with WebGL is now that unit's error. |
| Changed screens with the two sides 119–121 frames apart (a 2 s boot difference) | The Typekit kit (`preloadFont`) is an injected `<script>` and stylesheet; determinism mode did not wait for either, and WebFontLoader's 3 s give-up timer runs on the virtual clock. Whether the kit loaded before the timer depended on the network. | Determinism mode waits for external scripts and stylesheets (engine change). |
| Same frame, ~0.16 % of the screen, a logo text in two weights or with thicker edges | A web font loads when first used, and Pixi rasterizes a text once and caches its measurement and font metrics on first use (`CanvasTextMetrics`). Three paths raced: a face first used by a canvas draw or a DOM layout (real time); the game's own baked web font, which `registerBakedWebFonts` loads *before* adding it to `document.fonts`, invisible to the font wait; and the boot itself, which measures text outside any frame while the `app.html` kit stylesheet's five faces arrive in network order (the run's diagnostics showed every Typekit request 200 on both sides, finishing in a different order). | Determinism mode loads every declared face up front, counts `FontFace.load()` as I/O, and holds the app's start (SvelteKit's client `init`) until every declared face has loaded (engine change). |
| Still, on the `lines` games only: the HUD texts (logo, game name, balance and bet labels) a little bolder on one side, same frame, everywhere else equal | One side drew each HUD text **twice**: its edge pixels followed `1 − (1 − a)²` of the other side's. The two sides' scene trees were identical in order, and so were every text's texture (read back from the GPU), fresh raster, alpha, tint and transform, the canvas and the DOM; the capture was stable 300 ms later. A re-draw from a fresh instruction build changed the frame on the affected side, and the two sides' fresh builds were byte-identical: Pixi's incrementally updated instructions (an object's batch slot kept from the last build) had drifted from the scene. | Determinism mode draws every frame from a fresh instruction build (engine change). The drift itself can reach players and is left as an open question. |
| `cloud`: every scenario timed out at frame 7200 on both sides | Its published snapshot has no `basegame` scene: main's runtime shows its `boot stopped — runtime bundle shape invalid` error screen. Players see that today. | Its own visible row, `not rendered (main's runtime refuses the snapshot)`, decided after 10 frames. **The game needs republishing** (owner). |
| `hw-classic-sample` / book games ran in seconds | Same Canvas-renderer crash, earlier in each scenario. | As the first row. |
| Not rendered (8) | `bookofborut`, `bookofborutremakebuild`, `hotfruits`, `test1build`, `waysofwavesbuild`: desktop builds (own bundle). `salmons`, `test4`, `test5`: no published pointer. `cloud` joined as above. | Correct as reported; the report says which. |
| A run past 30 minutes once WebGL was real | Rendering per game (5–15 minutes with WebGL) did not fit whole-game shards. | Plan once, render per-side units on 20 single-lane shards balanced by measured cost (`costs.json`), run the gates beside the build, compare in the report job. |

Harness fixes found on the way: the digest stopped after three games (`process.exit` cut a long
piped write; it is a file now); `code-changed` made a full checkout shallow when it fetched
`before` with `--depth=1`, which broke the base-commit step; and a new branch's first push now diffs
against its merge-base with main instead of counting as "change set unknown".

## Measured (2026-10-04, Claude Code cloud container, 4 vCPU, software GL)

There were no R2 or launcher credentials in that session, so these runs used the stand-in fixtures
(`fixtures.mjs`, eight games covering every type plus the pots variants: 108 screens). The first CI
run with the secrets measures the live games the same way.

- **Noise, main vs main, twice.** Both runs gave 108 of 108 screens **byte-identical**, with every
  gate passing. Each comparison pairs two independent renders: a fresh test server and a fresh
  browser on each side.
- **Separate builds.** `main` (`902d04c`) and a commit whose engine source is identical (the
  revert below) gave 108 of 108 byte-identical screens. The two bundles are *not* byte-identical:
  `version.json` holds a timestamp, and the Svelte CSS scope hashes come from the build's file
  paths, so a build in another worktree gets other class names. The pixels are the same, and the
  pixels are what is compared.
- **The 1 px proof.** The throwaway commit `3c46443` moved the shared `freeSpinCounter`
  ComponentDef frame from `x: 0` to `x: 1`. The harness flagged exactly six screens:
  - `fs-board` and `fs-spin` on lines and on ways;
  - `fs-spin` on bookOf and on bookOf + pots.

  Each diff measured 1,185–1,318 px, with a worst block of 28.5–29.3 %. All six sit in the same box
  (x 93–324, y 223–395), the counter panel. Every other screen was byte-identical, including the
  cluster and scatter free-spin screens: those layouts (`engineSkeleton`) draw the *coded*
  `FreeSpinCounter.svelte`, not the ComponentDef, so they really did not change. The revert
  (`6b44b38`) was green, 108 of 108 identical. Evidence:
  [`current-games/proof-1px.png`](current-games/proof-1px.png) shows before | after | diff for each
  flagged screen, cropped to the panel.
- **Time.** A game takes 2–5 minutes for both sides, about 4 on average uncontended. The
  `draw: 'every'` canary is the largest share: lines' canary took 51 s per side, against 5–30 s for
  each other scenario. A runtime build takes 70–80 s on top of `pnpm install`. At six shards and
  about 14 games, that is 2–3 games per shard, roughly 8–12 minutes of rendering after a
  3–5 minute build job. The first real CI run will give the exact figure.
