# Current-games regression harness

The rule is *never break a current game*. Every pipeline change must show that every live game
still builds, passes its tests and looks the same as on `main`. This harness is that proof. Spec:
[ADR-0004](../director/DECISIONS/0004-current-games-regression-harness.md). Code:
`scripts/current-games/`. CI: `.github/workflows/current-games.yml` renders and uploads the report;
`.github/workflows/current-games-verdict.yml` posts the commit status `current-games` from it
(see "Who posts the status").

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

## As republished

A published snapshot carries its own copy of every component def its doc uses: the publish bake
(`runtimeBundle.ts`) resolves each referenced id project ◁ shared ◁ built-in and writes the def it
found, and the runtime registers those over its own built-ins (`registerBakedComponents`). So a
change to `packages/engine-layout/src/lib/builtinComponents.ts` reaches a published game only at
its next publish, and the as-published render, correctly, shows nothing (measured below, card 1F).
Since card 1G the harness also renders each **affected** game **as republished**: the same snapshot
with its baked copies of built-in defs replaced by each side's built-ins, exactly as a republish of
the game on that commit would bake it. Code: `scripts/current-games/lib/builtins.mjs` (plain node)
and `lib/republish.mjs` (the TypeScript half, run under the TS loader).

- **Each runtime build carries its built-ins.** `runtimes.mjs` writes `builtins.json` beside every
  build (`BUILTIN_COMPONENTS` of that checkout, keyed by id), so main's built-ins come from main's
  cached build and the branch's from its own. The CI cache key is `current-games-runtime-v2-<sha>`:
  a build from before this file is rebuilt.
- **Which baked defs are copies.** A snapshot carries no provenance, so a baked def equal by content
  to the built-in of the same id **as it was when the game was published** is a copy of the
  built-in; every other def is the author's and is loaded as the bake loads it (next bullet). The
  bake leaves a built-in's copy
  byte-equal (its spine keys and atlas refs are bare names, which the post-resolve fixups skip),
  while a saved def goes through `normalizeComponent` (which drops a built-in's `capability` and
  `defaultInstanceParams` and reorders fields) and an edit changes its content. The published
  engine's built-ins come from the engine commit the game's pointer records at publish
  (`SnapshotMeta.engine.shortCommit`): the plan checks that commit out into a bare worktree and
  reads its defs (no install needed, 0.4 s), keeps them beside the plan (`builtins/<sha>.json`, so
  the shards classify alike), and the row says so. When the pointer records no engine, or the
  commit is not in the checkout (this repository's history begins on 2026-10-02), the game **fails
  closed**: its as-republished row is an error row naming the cause, and the run fails, because
  against any other built-ins a copy main has changed since the publish would read as the author's
  and pass quietly. Republishing the game records an engine the checkout has. One set decides on
  both sides, so the two variants replace the same ids.
- **What a republish does next.** The bake loads an authored def that sits under a built-in's id
  through `mergeBuiltinCodedParams` (`componentStorage.ts#loadComponent`): the built-in of the
  moment lends it the coded params, node `paramBindings` and `standsFor` the author's frozen copy
  lacks. The same merge runs here against each side's built-ins (`mergeCodedParams`), so a PR that
  adds a coded param or a binding to `freeSpinCounter` changes what a republish bakes for every
  game that ships an edited copy of it, and the row sees it (the as-republished note lists the
  authored defs the merge altered). The bake then re-resolves the component closure (the instances
  the doc places, the defs those nest, the components `component`-kind params name), so a built-in
  that newly nests another def ships it. The same `resolveComponentClosure` runs here, loading an
  authored id from the snapshot and any other from the side's built-ins, seeded with every id the
  snapshot shipped. Pins follow the bake's `resolveReferencedDefs`: a pin the resolved def's version
  satisfies ships nothing; any other ships the exact pinned def, the snapshot's authored one at
  that version (merged like a latest load) or else the side's built-in, which `loadComponent`
  returns for a built-in at any version. Per-project param defaults stay as baked: they are project
  data the harness does not read.
- **Who pays.** Nothing, unless the change can have altered what a publish bakes. `touched.mjs`'s
  `republish` verdict says whether the diff touches the bake's repo inputs — `builtinComponents.ts`
  and every module it takes a value from, followed import by import (`bakeInputs`) — and when it
  does, the plan reads both builds' `builtins.json`; only when they differ does it read each
  rendered game's `runtime.json` (one R2 read per game) and make both variants. A game is
  **affected** when the two variants disagree on a def: one of its baked copies changed, a changed
  built-in now ships a def it did not, or the sides' coded params merge into one of its authored
  defs differently. Only affected games render a second time; the others get a note saying a
  republish would not change them. A comment-only edit to the defs file plans nothing.
- **Two rows, kept apart.** An affected game has an **as published** row and an **as republished**
  row. The republished row's screens, files and ids carry `<game key>@republished`
  (`<sha>:bookofborut@republished:fs-board:<hash>`), so a Phase 5 approval of one row never covers
  the other, and the summary line ends `· N row(s) as republished`. Both rows count: a changed
  republished screen fails the run like any other.
- **Blind spots that remain.** The classification is by content, since a snapshot carries no
  provenance (recording it at publish is an open question for the owner), so two saves read as
  copies though a republish would keep them, and are replaced: a shared-library save of an
  unchanged built-in, and a project save of an unchanged built-in that has no `capability` and no
  `defaultInstanceParams` (the two fields `normalizeComponent` drops; with either present the save
  differs from the built-in and reads as the author's). Both are false differences the owner can
  see as such, never a missed one. The variants are made from the snapshot and the two sides'
  built-ins alone, with no R2 read: a project or shared def that a head built-in **newly** nests
  cannot be resolved here, so the republished variant ships without it where a republish would
  ship it (the built-in itself still changed, so the game is affected and the row shows the rest).
  The copies are replaced as the built-ins are in code, with no `rewriteSpineKeys` or
  `repairComponentDefsAtlasRefs` pass: this assumes a built-in's spine keys and atlas refs are
  bare names those passes leave alone, as every built-in's are today (a built-in that referenced
  project art by a scoped key would bake differently from how it is replaced here). Against main's
  built-ins alone the live games showed why the published engine's are required (measured below):
  their baked copies of `loadingBar`, `button` and the rest are the published engine's, not main's.
  Their pointers record the engine they were published with (`e29a993`), which is in the checkout,
  so with that engine's built-ins each copy classifies as the copy it is, and each authored def
  (every live `freeSpinCounter`, for one) as the author's.

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
# Web fonts: stand-in games load them from Adobe (`--typekit network`, the default without R2); the
# live games render through the R2 mirror (`mirror`, the default with R2); a local mirror dir
# (`node scripts/current-games/typekit-mirror.mjs refresh --dry-run --out <dir>`, on a machine
# that reaches Adobe) stands in for R2.
node scripts/current-games/run.mjs --games-file <json> --typekit <dir>
# The republish proof: snapshots baked from MAIN's built-ins (a publish from before the change), then a
# branch whose built-in def changed renders the affected games as republished too.
node --experimental-strip-types --import ./scripts/ts-loader.mjs scripts/current-games/fixtures.mjs \
  --builtins .cache/current-games/runtimes/<main sha>/builtins.json
node scripts/current-games/run.mjs --base-build .cache/current-games/runtimes/<main sha> \
  --head-build .cache/current-games/runtimes/working-tree \
  --games-file .cache/current-games/fixtures/games.json --no-gates
```

The stand-in fixtures bake the component defs their docs reference, like a publish, so a built-in
change reaches a fixture only as republished (before card 1G they carried no defs, and the
2026-10-04 proof below caught the change on the as-published rows).

A local run renders one unit at a time (`--jobs 1`): SwiftShader already uses every core, and two
at a time halved each unit's speed on a 4-vCPU runner.
`CURRENT_GAMES_LOG_IMAGES=1` writes `crops.txt` beside the report: a 256×128 before / after / diff
crop of each changed screen, around its densest difference, as base64 PNG lines.

To run against the real live games, set `PIPELINE_GAMES_URL` and `PIPELINE_CI_TOKEN` (or pass
`--games-file`) and the read-only `CURRENT_GAMES_R2_*` key ([INFRA](../INFRA.md)); the Typekit
mirror must exist in R2 (below). The run never writes to R2. It needs the Playwright headless shell (see "The headless real clock" in
[README.md](README.md)). The report goes to `.cache/current-games/report/` (`--out`).

## Reading the report

`index.html` (and `report.json`) has one row per game, and a second row, **as republished**, for a
game rendered that way too (above):

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
  published snapshot in every scenario and shows its error screen, and in each scenario the
  branch's refuses it for the same reason with no more errors or stalls. Players get that error
  screen today; republishing the game fixes it. There is nothing to compare, so the branch is not
  blamed. Anything else fails as before: a branch that boots a snapshot main refuses, a branch
  crash in any scenario (refusing or not), a different refusal, a missing render.
  `assemble.fixture.mjs` (run by `check:all`) holds these rules.

A game whose **main** render fails (a scenario main cannot finish, or main's page reports errors or
stalls) is an `error` row that names main's failure. The branch is not blamed for it, but the
comparison proves nothing until main is fixed.

Each changed screen shows before (main), after (branch) and diff images. It also shows the
measured differing-pixel ratio and worst block, the tolerance it ran with, and its **stable id**:
`<branch sha>:<game key>:<screen>:<diff hash>`, with `<game key>@republished` on the as-republished
row. The branch sha is the PR head, not its merge commit. The diff hash covers both images' pixels, so a new commit that changes the picture gets a
new id. A screen only one side captured has no diff image; its hash covers the one capture and the
side that took it. Phase 5 approvals will name that id.

"Every screen's measured difference" at the bottom is the noise record for every screen, including
the ones that passed.

The overall verdict is **pass** only when every rendered game passes and at least one game was
rendered. A run that cannot start (a missing secret, a failed build) fails and names the reason.

## CI

`current-games.yml` runs on every PR into `main` and on pushes to non-main branches. It has five jobs and posts
no status (next section):

1. **`prepare`** picks the base commit, decides whether the change can reach a
   game (below) and whether it can alter what a publish bakes (`republish`, see "As republished")
   and, when it can reach a game, checks the six secrets (a missing one fails the job and is named in
   the status the verdict posts: `prepare` uploads the names as `current-games-prepare`).
   The base is, on a PR, the merge commit's first parent; on a push, the merge-base with main. A
   push to a branch with an open PR stands down, so the PR's run owns the status and the two never
   race. A PR from a fork does not run: it gets no secrets.
2. **`build`** builds both runtimes and makes the **plan** (`--phase plan`, after the builds, which
   it is given as `--base-build`/`--head-build`): the game list, each game's pinned snapshot, the
   render units and, when the two builds' built-in defs differ, the republished units of each
   affected game. A plan that cannot be made (a missing secret, an unreachable list) carries the
   reason to the report.
3. **`gates`** runs every game type's `check:*` gates once, beside the build: they test the
   branch's source, not its runtime, so they do not hold up the renders.
4. **`render`** is 20 shards. Each renders its share of the units (`--phase render`), one at a
   time; the plan balances them by each unit's measured seconds (`scripts/current-games/costs.json`,
   refreshed from the `costs:` line a run prints). It first lifts the runner's AppArmor limit on
   unprivileged user namespaces: Playwright's headless shell has no AppArmor profile, so on Ubuntu
   24.04 its sandbox cannot start and it exits at launch. A unit that fails still writes its result,
   so the report names it; a unit with no result at all is its game's error.
5. **`report`** pairs every shard's units (`--phase compare`), compares, uploads the
   `current-games-report` artifact (and `report.json` alone as `current-games-report-json`, what
   Invisible Pipeline Changes reads), prints the **digest** to the log, and ends with a `Verdict`
   step that fails the job exactly when the status will be a failure.

**Who posts the status.** The harness runs the pull request's own tree, so nothing it writes can be
trusted as the answer: it holds no `statuses` permission and calls no statuses API. The required
status `current-games` is posted by `.github/workflows/current-games-verdict.yml`, a `workflow_run`
workflow GitHub runs from **main's** copy in the base repository's context, so a PR cannot change what
decides or what posts. It runs on `requested` (posts `pending`, unless the run already completed) and
`completed` of a "Current games" run and, before posting anything, checks that the run is
`current-games.yml` of this repository; for a PR, that it is **into `main`**, open, from this
repository and still at the run's head commit (a newer commit's run posts its own; a fork gets no
status; a status belongs to the head commit, so a PR into another branch with the same head must
never answer for the one into main). A cancelled run fails ("re-run it") unless a newer run on its
head will post. Whether the change can reach a game is decided again by main's
`touched.mjs` over commit objects fetched from the PR (nothing is checked out): a run that rendered
nothing for a change that can reach a game fails ("the run rendered nothing"), and so does a PR whose
diff edits `.github/workflows/**` or `scripts/current-games/**` ("Edits the harness …: merge after
review") — it wrote the report it would be judged by, so the report is not read — or whose diff
cannot be read. Otherwise the status
is `lib/verdict.mjs`'s `decide` over the jobs of that attempt (the API's, not the PR's), the
`current-games-report-json` artifact and, after a missing secret, `current-games-prepare`. Both are
parsed as JSON only; nothing from the PR or an artifact is ever installed, imported or executed (the
workflow has no `pnpm install` and no `ref:`). The description is the report's summary line cut to
139 characters and the target is the harness run, as the launcher expects. A PR's report whose base
commit is not on `main`, or that names none, fails. A push run posts nothing;
a manual run posts `current-games/self-compare` or `current-games/manual` (its run title says which),
never `current-games`. The harness's `Verdict` step calls the same `decide`, so the two cannot drift.

**Identity.** With the `CURRENT_GAMES_VERDICT_APP_ID` / `_PRIVATE_KEY` environment secrets the status
is posted as that GitHub App, which only this workflow holds, so a ruleset can require
`current-games` from the App. Without them it is posted as GitHub Actions, which any workflow can post
as: the run says so in a warning. The owner's steps (App, secrets, the `current-games-verdict`
environment limited to `main`, the ruleset) are in [INFRA](../INFRA.md).

**Dry run.** `current-games-verdict.yml` has a manual trigger (`run_id`, `apply` off by default) that
prints the decision for any past run and posts nothing. The same from a shell, with
`GITHUB_REPOSITORY=owner/repo` and `GITHUB_TOKEN` (optional for public reads):
`node scripts/current-games/lib/verdict.mjs --run <run id> --event completed [--attempt <n>]`; add
`--post` with `STATUS_TOKEN` to post. `verdict.fixture.mjs` (run by `check:all`) proves every branch:
the run checks, both phases, each job failure, the report for another commit, the description cut and
that the two workflows hold what is said above.

**The digest** is every non-pass row's cause, written for a reader who cannot download the artifact:
the browser's render paths (`chrome://gpu`: WebGL, 2D canvas, compositing), failing gates, each
failing unit's error and last console lines, and per changed screen the reason, the bounding box,
both frames, both screen sets and a 64×24 map of where the pixels differ. Its `noise:` line counts
the screens both sides captured that came back byte-identical, and names any that passed within its
tolerance without being byte-identical, with what was measured. A run that cannot finish (no plan,
no gate results) still writes a report naming why, and the status says so.

**Noise calibration.** A manual run (`workflow_dispatch`, `self_compare: true`, the default) renders
the dispatched ref against itself: its runtime built twice and rendered on separate runners, which
on main is the main-vs-main measurement. It always renders (there is no change for `touched.mjs` to
read) and posts the separate status context `current-games/self-compare`, so it never stands in for
a branch's comparison (the verdict reads the context from the run's title, `Current games:
self-compare`). A manual run with `self_compare: false` posts `current-games/manual` and can
name a `base` commit to compare against instead of main's merge-base: the seeded proof renders a
deliberate 1 px change against the commit before it (`base` is ignored on a self-compare). A
self-compare and a seeded proof on one commit, or two proofs with different bases, do not cancel
each other. `log_images: true` prints each changed screen's before / after / diff crops into the
log, with each side's web-font states, whether the capture was the same 300 ms later, and the
external requests each render made. It only reads the page and waits; it draws nothing, so the
captures are the same as without it (18 `cg-lines` captures came back byte-identical with and
without it).

**The repository is public, so every artifact and every log line is public.** The plan carries
contract hashes, never contracts. The per-shard parts hold every capture of every live game: the
compare needs both sides of each screen and the two sides render on different shards, so the
captures must travel, but the report job deletes the parts once every shard's units are compared. A
run with a shard missing keeps them for GitHub's 1-day minimum, so "Re-run failed jobs" can finish
the compare. The plan and gate results are kept 1 day; the report, which holds the changed screens
only, is kept 3 days; `log_images` prints changed screens' crops into the log.

**Jobs GitHub fails to start are re-run once.** `.github/workflows/current-games-retry.yml` runs
after every completed `Current games` run (from `main`'s copy of the file, as `workflow_run`
always does, so a branch cannot change what is retried) with `actions: write` and nothing else. Its
decision is `scripts/current-games/lib/retry.mjs`: a failed first attempt is re-run ("re-run failed
jobs": the failed jobs and their dependents) only when every failed job either **never got to run**
— the hosted runner was never acquired (the job is `cancelled` after ~15 min with no runner and no
steps: "The job was not acquired by Runner of type hosted even after multiple attempts"), or the
runner was lost before the job's body step (its steps end `in_progress` or `cancelled`, none
`failure`) — or is downstream of one that did not (the report job fails whenever a shard is
missing). Everything else is a result and blocks the retry: a body step that **started** — a build,
the gates, a `Render shard`, the `Compare` — whatever its conclusion, and a set-up step that
concluded `failure` (a stale lockfile at `pnpm install`, a bad `base`, a missing secret, a broken
headless-shell install). `prepare` has no body, so only a lost runner retries it. A run is retried
at most once: attempt 2 completes without a decision, as does any run that did not conclude
`failure` (a cancelled run stays cancelled). `retry.fixture.mjs` (run on every PR by the Checks
workflow's `check-all`, which discovers it) holds these cases on the job shapes GitHub's API gave
on 2026-10-05, and proves the job table (`needs`, body step names) matches `current-games.yml`, so
a renamed step cannot quietly become retryable. A manual run of the workflow decides on any run id
and prints the decision (`apply` makes it act); the step summary shows what it decided.

**Web fonts come from the mirror, once it exists.** Every render answers `use.typekit.net` from the
Typekit mirror in R2 and `p.typekit.net` (the kit's beacons) locally, so an Adobe outage cannot
stall a frame and a kit republish cannot change a comparison. Until the mirror's first upload the
renders load from Adobe as players do, and the plan says so in a warning and the report. Below,
"Typekit mirror".

**A change that cannot reach a game is not rendered.** `prepare` diffs the branch against the same
base the renders would compare with and classifies it with `scripts/current-games/lib/touched.mjs`.
The runtime's inputs are computed, not listed: `apps/lines` plus every workspace package reachable
from it through its dependencies (the set `pnpm --filter 'lines...'` selects), the root build
files (`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json`, `.npmrc`,
`tsconfig.base.json`), everything the gates can read (`scripts/`, `services/test-server/`, the
launcher's `src/lib/data/gameConfig/` defaults) and the workflow itself. Docs (`docs/**`,
`.claude/**`, `*.md`) are never inputs. When no changed file is an input, the status is posted
(by the verdict, from main's own diff read) as success at once (`Runtime untouched: no game can differ (N changed files …)`, or `Docs-only change`
when nothing else changed) with no build, no secrets check and no render: a launcher, atlas-tool or
director-worker PR passes in seconds. A diff git cannot decide renders everything.
The diff is read with rename detection off, so a file moved out of the inputs still counts as a
change to them. `check:undefined-names` scans every app, package and service, so a launcher or
service change can fail it; that is accepted, because Lint runs the same gate on every PR.
`touched.fixture.mjs` (run by `check:all`) proves the closure equals pnpm's graph, that every gate's
command line names only inputs, the verdict for each kind of path, and the rename case.

**Secrets never leave the log.** GitHub masks secrets in job logs only: the status description, the
step summary and the report artifact publish their text as given. Every message bound for one of
them goes through `lib/redact.mjs`, which replaces each secret env's value with `***` and, as a
backstop where the values are not known, any 32+ hex or token-shaped base64 run. A
malformed `PIPELINE_GAMES_URL` fails up front with a fixed message that never quotes it.
`redact.fixture.mjs` (run by `check:all`) proves each secret stays out of all three.

## Typekit mirror

The runtime loads its web fonts from Adobe twice over: the app template's kit stylesheet
(`apps/lines/src/app.html`, `use.typekit.net/aba0ebl.css`) and WebFontLoader's typekit module
(`pixi-svelte`'s `preloadFont`, `use.typekit.net/aba0ebl.js`). Each render then fetches the kit's
five faces from `use.typekit.net/af/…` and pings `p.typekit.net` twice (`p.css`, `p.gif`). That
is what players do, and it stays so: **nothing here changes what a player loads.** Determinism
mode waits for stylesheets, scripts and `FontFace.load()`, so in CI an Adobe outage stalls every
frame (a 30 s stall per load, then a `stall` that fails the game), and a kit republish mid-run
could hand the two sides two fonts.

So, once the mirror exists, the harness's browser never asks Adobe (`scripts/current-games/lib/typekit.mjs`,
`lib/browser.mjs`): CDP's `Fetch` domain pauses every request to the two Typekit hosts;
`use.typekit.net` is answered from a **mirror** of the kit (its stylesheet, its script and every
file the stylesheet names, by exact URL), `p.typekit.net` with an empty stylesheet or a 1×1 gif
(nothing waits on a beacon, and nothing should reach Adobe). The mirror lives in R2 under
`_ci/typekit-mirror/`: `current.json` (kits, every URL with its sha256, content type and size,
and a `hash` over the lot) and `blobs/<sha256>` (immutable by name). The **plan pins the hash**
the way it pins a snapshot; a shard downloads the pinned mirror once (cached by hash) and a
manifest that changed mid-run fails the units it would have changed. The report and the digest
say which mirror a run used (`typekit: mirror <hash> (N files, kits …, fetched …)`), and the
diagnostics (`log_images`) list each render's external requests as `mirror <url>`.

**What fails, and what to do:**

| The plan or a render says | Why | Fix |
|---|---|---|
| `typekit: network — … the Typekit mirror is missing from R2` (a warning and the report's line; the run goes on) | Nothing was ever uploaded, so the renders loaded from Adobe as players do. | Run the **Typekit mirror** workflow once (Actions → Typekit mirror → Run workflow, on `main`) to remove the dependency. |
| `the Typekit mirror (kits …) lacks kit(s) the runtime loads` (the plan fails) | A kit id changed in `app.html` or `pixi-svelte` (`kitIds()` harvests both, and `typekit.fixture.mjs` proves they agree). | Run the workflow from `main` with `extra_kits` naming the new id (it only runs on `main`); run it again plain once the branch has merged. |
| `the Typekit mirror has no entry for <url>` | The page asked for a kit URL the mirror does not hold: a face was added, or the kit's script asks for something new. | Run the workflow; if the URL is not in the kit's stylesheet or script, extend `crawlKit`. |
| `the Typekit mirror changed during the run` | A refresh landed between the plan and this render. | Re-run the failed jobs. |
| `Typekit mirror unavailable: …` on every unit of a shard (`the Typekit mirror is gone from R2`, or a blob that does not match its name) | The pinned mirror could not be downloaded whole on that runner. | Re-run the failed jobs; if it repeats, `typekit-mirror.mjs show` and refresh. |

**Refreshing it.** `.github/workflows/typekit-mirror.yml` (`workflow_dispatch`, on `main` only;
`dry_run` fetches and reports only) runs `scripts/current-games/typekit-mirror.mjs refresh`: it
harvests the kit ids, fetches each kit from Adobe (a GitHub runner reaches it; the Claude Code
container does not), uploads the blobs it does not have yet and then `current.json`, in one write,
last. It is the only harness-side thing that writes to R2 and it uses the release's read-write
`R2_*` secrets, which is why it runs `main`'s code only; the harness keeps its read-only key. There is no schedule: a render never reaches Adobe, so the
mirror cannot go stale on its own — Adobe republishing the kit changes what players get, not
what the harness compares, since both sides render the same mirrored faces. Refresh when the
table above says so. `typekit-mirror.mjs show` prints what R2 holds.

**Why R2 and not the repo.** Adobe Fonts are licensed for serving by Adobe; the repository is
public. The mirror is a private copy for CI's own renders, in the bucket the harness already
reads, never committed. Whether Adobe's terms allow even that copy is the owner's call (an open
question of card 1H): until it is made, nothing is uploaded and the harness renders from Adobe
with the warning above.

`typekit.fixture.mjs` (run by `check:all`) proves the crawl, the manifest and its hash, the pin,
and — against a fake kit on 127.0.0.1 with the real headless shell — that the browser loads both
faces from the mirror, that neither host is asked over the network, that a URL the mirror lacks
is refused and named, and that the beacons are answered locally.

## Calibration on the live games (2026-10-05, Director card 1F)

The first live run (#1055, run 37286687249) reported 6 pass · 7 fail · 8 not rendered · 10 changed
screens on a CI-only change. Every fail and every changed screen came from the harness or from a
determinism gap, none from the engine. What each one was:

| Symptom | Root cause | Fix |
|---|---|---|
| Book games: `drawImage … canvas element with a width or height of 0` on both sides, every scenario | The CI runner's headless shell had **no WebGL**: newer Chrome builds no longer fall back to SwiftShader on their own, so Pixi fell back to its **Canvas** renderer, which throws on a 0-size texture. No player's browser takes that path. | `--enable-unsafe-swiftshader` on non-Windows (`scripts/playtest/headless-shell.mjs`), and a unit whose page did not render with WebGL is now that unit's error. |
| Changed screens with the two sides 119–121 frames apart (a 2 s boot difference) | The Typekit kit (`preloadFont`) is an injected `<script>` and stylesheet; determinism mode did not wait for either, and WebFontLoader's 3 s give-up timer runs on the virtual clock. Whether the kit loaded before the timer depended on the network. | Determinism mode waits for external scripts and stylesheets (engine change). |
| Same frame, ~0.16 % of the screen, a logo text in two weights or with thicker edges | A web font loads when first used, and Pixi rasterizes a text once and caches its measurement and font metrics on first use (`CanvasTextMetrics`). Three paths raced: a face first used by a canvas draw or a DOM layout (real time); the game's own baked web font, which `registerBakedWebFonts` loads *before* adding it to `document.fonts`, invisible to the font wait; and the boot itself, which measures text outside any frame while the `app.html` kit stylesheet's five faces arrive in network order (the run's diagnostics showed every Typekit request 200 on both sides, finishing in a different order). | Determinism mode loads every declared face up front, counts `FontFace.load()` as I/O, and holds the app's start (SvelteKit's client `init`) until every declared face has loaded (engine change). |
| Still, on the `lines` games only: the HUD texts (logo, game name, balance and bet labels) a little bolder on one side, same frame, everywhere else equal | One side drew each HUD text twice or more (its edge pixels followed `1 − (1 − a)²` of the other side's): Pixi blends its back buffer onto the transparent canvas without clearing it, and the harness stepped faster than the browser shows frames. Evidence and repro: the 2026-10-05 entry in [`docs/status/engine.md`](../status/engine.md). | Determinism mode clears the canvas before each draw to the screen (engine change). |
| `cloud`: every scenario timed out at frame 7200 on both sides | Its published snapshot has no `basegame` scene: main's runtime shows its `boot stopped — runtime bundle shape invalid` error screen. Players see that today. | Its own visible row, `not rendered (main's runtime refuses the snapshot)`, decided after 10 frames. **The game needs republishing** (owner). |
| `hw-classic-sample` / book games ran in seconds | Same Canvas-renderer crash, earlier in each scenario. | As the first row. |
| Not rendered (8) | `bookofborut`, `bookofborutremakebuild`, `hotfruits`, `test1build`, `waysofwavesbuild`: desktop builds (own bundle). `salmons`, `test4`, `test5`: no published pointer. `cloud` joined as above. | Correct as reported; the report says which. |
| A run past 30 minutes once WebGL was real | Rendering per game (5–15 minutes with WebGL) did not fit whole-game shards. | Plan once, render per-side units on 20 single-lane shards balanced by measured cost (`costs.json`), run the gates beside the build, compare in the report job. |

Harness fixes found on the way: the digest stopped after three games (`process.exit` cut a long
piped write; it is a file now); `code-changed` made a full checkout shallow when it fetched
`before` with `--depth=1`, which broke the base-commit step; and a new branch's first push now diffs
against its merge-base with main instead of counting as "change set unknown".

## What the harness cannot see

- **Text measured before its font arrives.** Determinism mode loads every declared web font before
  the app starts and makes frames wait for font loads, so no capture ever has a text that was
  measured or drawn in a fallback face. Players can: on a slow network a text first laid out
  before its face arrives keeps that measurement (Pixi caches `CanvasTextMetrics`), so it can sit
  wrong until it changes. That is a real bug class, and this harness cannot catch it.
- **A change to a built-in component definition reaches a published game only when it is
  republished.** The as-republished row (above) shows what that republish would change, with the
  blind spots listed there: a shared or project save of an unchanged built-in is replaced though a
  republish would keep it; a project or shared def a head built-in newly nests is not resolved; the
  replacement assumes built-ins use bare asset names; and a game whose published engine is unknown
  fails closed rather than being classified against main's built-ins.

## Measured on the live games (CI, 2026-10-05)

- **Noise, main vs main, twice in a row.** Self-compare runs
  [37376834557](https://github.com/Invisible-Wall-SL/Invisible-Engine/actions/runs/37376834557) and
  [37378492596](https://github.com/Invisible-Wall-SL/Invisible-Engine/actions/runs/37378492596), both
  on `1ef36e2` (card 1F's final engine and harness), each reported 12 pass · 0 fail · 9 not rendered ·
  0 changed screens, with **161 of 161 compared screens byte-identical** on each: 12 games × 11–14
  screens, every gate passing. The 9 not rendered are the five desktop builds, the three unpublished
  games and `cloud`'s refused snapshot.
- **Time.** 14 min 10 s and 11 min 44 s from dispatch to status: `prepare` ~20 s, the runtime
  builds and the plan ~1.5–2 min with the gates beside them, the 20 shards 9.5–11 min, the compare
  ~35 s. A game's two sides take 3–20 minutes of rendering in all (`test2` the longest), spread over
  shards by `costs.json`.
- **Runner shortages.** On the same evening GitHub's hosted pool repeatedly could not supply
  `ubuntu-latest` machines: a job not acquired within ~15 minutes is cancelled ("The job was not
  acquired by Runner of type hosted even after multiple attempts"), and one shard lost its machine
  mid-run. A run with a missing shard reports those games as errors, never as passes; **Re-run
  failed jobs** re-renders only the missing shards and keeps the rest.
- **The 1 px proof on the live games.** Throwaway commit `9a9cfcf` wrapped the runtime's
  `<WinLine />` mount in a container 1 px to the right, which moves the win line and the amount it
  draws and nothing else. Against `1ef36e2`
  ([run 37379922702](https://github.com/Invisible-Wall-SL/Invisible-Engine/actions/runs/37379922702))
  the harness flagged 21 screens on 10 games and left the other 140 of 161 byte-identical. Every
  flagged screen is a win presentation: `line-win` on all ten games, and the settled, free-spin,
  trigger, pot and big-win screens where a line or amount stays up. Both sides were on the same
  frame, and the difference is boxed where the line and amount are drawn. `hw-classic-sample` and
  `test3` changed on no screen (not inspected: their captures may draw no line from this
  component). The revert (`24436f4`) has the same tree as `1ef36e2`, which both self-compares above
  ran on. The same change on the stand-in fixtures flagged 17 of 70 screens, all win presentations.
- **A built-in component change does not reach a published game.** The fixture proof's change
  (the built-in `freeSpinCounter` frame moved 1 px) changed none of the seven live games that
  rendered fully (run 37366774720). Publishing bakes the component definitions a game uses into
  its snapshot (`runtimeBundle.ts`: each referenced id resolves project ◁ shared ◁ built-in), and
  the runtime registers them over its own built-ins (`registerBakedComponents`). The harness renders
  published snapshots, so it correctly shows nothing; such a change reaches a game at its next
  publish without passing this harness. Answered by card 1G: the as-republished row (above).

## As republished, on the stand-in fixtures (2026-10-05, card 1G, Claude Code cloud container, 4 vCPU, software GL)

The fixtures were baked from main's built-ins (`fixtures.mjs --builtins`), as snapshots published
before the change, and rendered with main's runtime (`89407ba`) against the working tree.

- **The 1 px proof.** The built-in `freeSpinCounter` frame moved from `x: 0` to `x: 1` on the
  branch. The plan read both builds' `builtins.json`, found them different, and made both variants
  of every fixture: the four whose docs place the counter (`cg-lines`, `cg-ways`, `cg-bookof`,
  `cg-bookof-pots`) were affected and rendered as republished too; the other four got the "a
  republish would not change it" note. The eight **as-published** rows: `looks the same`, 0 changed
  screens (the snapshots carry main's copy of the def, so the change cannot reach them: the 1F
  finding, reproduced). The four **as-republished** rows: 6 changed screens, `fs-spin` on bookOf and
  on bookOf + pots, `fs-board` and `fs-spin` on lines and on ways, each 1,185–1,318 px in the same
  box (x 93–324, y 223–395, the counter panel), both sides on the same frame, worst block
  28.5–29.3 %. These are the six screens the 2026-10-04 proof flagged on the as-published rows,
  when the fixtures carried no baked defs. 156 of 162 compared screens were byte-identical, and the
  status line read `8 pass · 4 fail · 0 not rendered · 6 changed screen(s) · 4 row(s) as
  republished`. Evidence:
  [`current-games/proof-1px-republished.png`](current-games/proof-1px-republished.png) (before |
  after | diff, cropped to the panel). The repo's own gate caught the seed too:
  `packages/engine-layout/scripts/test-hold-and-win-template.mjs` failed on the seeded commit
  (`components.freeSpinCounter changed`), as it should for an unintended built-in change.
- **The same seed on the live games** (PR runs
  [37391326347](https://github.com/Invisible-Wall-SL/Invisible-Engine/actions/runs/37391326347) and
  [37391385875](https://github.com/Invisible-Wall-SL/Invisible-Engine/actions/runs/37391385875), on
  the seeded heads of #1063, before the published-engine classification existed): the plan found
  the two builds' built-ins differ and classified every live snapshot, and **no live game was
  affected**: 12 pass · 0 fail · 9 not rendered · 0 changed, 161 of 161 compared screens
  byte-identical, no republished row. Every live snapshot's baked `freeSpinCounter` differs from
  main's built-in (the def has changed since the games were published), so against main's built-ins
  it read as the author's and was kept. With the classification against the engine each pointer
  records, the second seed's run
  ([37395802976](https://github.com/Invisible-Wall-SL/Invisible-Engine/actions/runs/37395802976))
  resolved every live pointer's engine commit (all record `e29a993`) and then failed every game's
  variant on a path the plan handed to the variant maker relative to the wrong folder (13 error
  rows, fixed in the next commit). The third seed's run
  ([37397853432](https://github.com/Invisible-Wall-SL/Invisible-Engine/actions/runs/37397853432))
  classified each live snapshot against `e29a993`'s built-ins: every rendered game ships copies
  (`loadingBar` on all 12; `tapToContinue`, `textBox`, `button`, `confirmDialog` and the Hold and
  Win parts on the games that place them), but **`freeSpinCounter` is the author's in every live
  game that has one** (bookofborutpartner, bookofborutremake, borut-pots-sample, lines, test1,
  test6 each carry an edited copy, beside their own `c_…` components), so a republish would not
  change it and no republished row was planned: `12 pass · 0 fail · 9 not rendered · 0 changed`,
  161 of 161 byte-identical, each passing row saying so. The live proof therefore seeds a def the
  live games do ship as a copy (below).
- **The live proof: the built-in `button` moved 1 px** (the fourth seed, `45be9a1`, run
  [37399652334](https://github.com/Invisible-Wall-SL/Invisible-Engine/actions/runs/37399652334); one
  render shard lost its runner and was re-run once). `button` is a copy in seven of the twelve
  rendered live games, so the plan rendered those seven twice and the other five once, each row
  saying why: `12 pass · 7 fail · 9 not rendered · 72 changed screen(s) · 7 row(s) as republished`,
  182 of 254 compared screens byte-identical. The twelve **as-published** rows: `looks the same`, 0
  changed (bookofborutpartner, bookofborutremake, borut-pots-sample, lines and test1 ship copies of
  `loadingBar`, `tapToContinue`, `textBox` and the Hold and Win parts but not of `button`, so they
  got the "a republish would not change it" note and no second row). The seven **as-republished**
  rows all changed: hw-3pots-sample 11 of 14 screens, hw-classic-sample 9 of 12, hw-collector-sample
  8 of 11, test2, test2build, test3 and test6 11 of 14 each, 1,855–2,462 px (0.20–0.27 %) inside the
  HUD bar's box (x 158–1152, y 611–708) on six of them and a 16×16 block 22–25 % different in
  test6's HUD corner (x 33–214, y 20–87), both sides on the same frame every time. On every one of
  the seven the three screens that did not change are `loaded`, `idle` and `spin`; every screen from
  the settled board on did. The as-published rows of the same games were byte-identical: today's
  published games cannot see the change, a republish would, and the harness now shows both.
  Rendering cost 10,572 s across the shards, 4,136 s of it the seven republished units.
- **The revert, which is also main vs main.** With the frame back at `x: 0` the working tree's
  engine source equals main's, so its runtime (built again from the restored source) against main's
  cached build is two independent builds and renders of one engine. The plan found the two builds'
  built-ins the same and planned no republished render; the eight rows: `8 pass · 0 fail · 0 not
  rendered · 0 changed screen(s)`, 108 of 108 compared screens byte-identical, every gate of every
  type passing (14 gates). On the live games the reverted head `629607d`
  ([run 37391483948](https://github.com/Invisible-Wall-SL/Invisible-Engine/actions/runs/37391483948))
  gave `12 pass · 0 fail · 9 not rendered · 0 changed screen(s)`, 161 of 161 byte-identical.
- **Time.** The seeded run rendered 162 screens in 2,503 s of rendering (106 units, one at a time:
  the as-published units plus the four affected games' republished ones, which cost the same as
  their twins), the revert run 108 screens in 1,650 s plus the gates.

## Measured on the stand-in fixtures (2026-10-04, Claude Code cloud container, 4 vCPU, software GL)

There were no R2 or launcher credentials in that session, so these runs used the stand-in fixtures
(`fixtures.mjs`, eight games covering every type plus the pots variants: 108 screens). The live
games are measured in CI: see the next section.

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
- **Time.** A fixture game took 2–5 minutes for both sides, about 4 on average uncontended. The
  `draw: 'every'` canary is the largest share: lines' canary took 51 s per side, against 5–30 s for
  each other scenario. A runtime build takes 70–80 s on top of `pnpm install`. The live games are
  heavier (5–15 minutes a game on CI's runners); their timings are in the next section.
