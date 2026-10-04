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
2. **Fetch.** It reads the game's published snapshot from R2, read-only:
   `publishedPointerKey` → `<id>/runtime.json` + `<id>/deploy/**`. It also reads the game's mock
   contract from `test_server/games.json`. A snapshot is immutable by id, so it is cached.
3. **Serve.** It serves what a player boots, twice, once per runtime:
   - a local stand-in for the launcher's `/api/editor/runtime` that answers the frozen
     `runtime.json`, with `assetBase` pointing at the frozen `deploy/` files;
   - the real Invisible Test Server (`services/test-server/server.mjs`) in local mode. It serves the
     runtime at `/<key>/` and the game's mock RGS, dealt from its manifest entry. The launcher link
     (`docBase`/`readToken`) is dropped, so the mock never follows live data mid-run. The game is
     booted through the mock's **authoring** channel, the one that takes forced beats.
4. **Play.** It boots with `?ie_determinism=<seed>` (see "Determinism mode" in
   [status/engine.md](../status/engine.md)) at 1280×720, DPR 1, UTC, en-US, and plays the game
   type's screen script. Each scenario gets a fresh test server and browser, so the seeded deal
   starts over.
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

**Starting values and why.** Determinism mode makes main vs main byte-identical on every screen
(measured below), so there is no noise to sit above. The values are set as tight as the 1 px proof
needs: any differing pixel in any 16×16 block fails (`blockThreshold: 0`), and pixelmatch's colour
threshold is 0.1. `maxDiffRatio` stays at the ADR's 0.1 %, but the block rule is what catches a
1 px change. If a real game ever shows noise, loosen that game type or screen alone, with the
measured number in the PR.

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
```

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

`current-games.yml` runs on every PR and on pushes to non-main branches. It has four jobs:

1. **`prepare`** posts `pending`, checks the six secrets (a missing one fails the status, named),
   and picks the base commit. On a PR that is the merge commit's first parent. On a push it is the
   merge-base with main. A push to a branch with an open PR stands down, so the PR's run owns the
   status and the two never race. A PR from a fork does not run: it gets no secrets.
2. **`build`** builds both runtimes and runs the gates once.
3. **`render`** is six shards, split by game key.
4. **`report`** merges the parts, uploads the `current-games-report` artifact and posts the final
   status.

A docs-only change posts success without rendering.

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
