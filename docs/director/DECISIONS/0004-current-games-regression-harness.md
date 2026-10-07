# ADR-0004 — Current-games regression harness

- **Status:** approved (2026-10-04, owner)
- **Date:** 2026-10-04

## Context

The rule: *never break a current game*. Every pipeline change must prove that every game in Game
Maker still builds, passes its tests and looks the same as on main. Every later merge depends on
this, so it is built first (PLAN Phase 1).

What exists:
- **Game list:**
  - `games` rows (`listGames()`)
  - `projects`
  - `test_server/games.json`
- **One shared runtime:** built from `apps/lines` by `runtime-release.yml` on push to main.
- **Build path:** published games boot `_runtime/lines@<v>` plus their R2 snapshot.
  `buildRuntimeBundle` assembles a project's deploy tree in about 20–26 s.
- **Determinism:**
  - `scripts/mock-rgs-server.mjs` (`SEED`, `FORCE_TRIGGER`, `BIG_WIN`, …)
  - the authoring force channel
- **Headless browser:** `scripts/playtest/headless-shell.mjs` (Playwright over CDP).
- **Game tests:** per-game playbooks in `docs/playtest/*.md` and many `check:*` gates.
- **No screenshot-diff tooling** exists.
- CI runs on GitHub Actions. Chromium is available to Playwright.

## Options

1. **Re-publish every game from the branch into a staging namespace and diff live URLs.**
   - Touches production storage. No.
2. **A CI job per branch that builds the branch's runtime and renders every game locally.**
   - Each game's **published snapshot** comes read-only from R2.
   - It renders the snapshot against the branch runtime and against main's runtime, with the same
     forced books, and diffs the screenshots.
   - Recommended.
3. **Diff only the engine bundle (bytes).** It can't see a visual change. No.

## Recommendation

A GitHub Actions workflow `current-games.yml`, triggered on every pipeline branch / PR. It is owned by
`regression-guardian`.

1. **Build:**
   - the branch's `apps/lines` runtime
   - main's `apps/lines` runtime, cached by main SHA
2. **List** every live game.
   - Source: the `games` table, read through a read-only launcher endpoint
     `/api/pipeline/games` gated by a CI token. The `test_server/games.json` copy is the fallback.
3. **For each game:**
   - Fetch its published snapshot.
     - Use a read-only R2 token scoped to `*/published/**` and `test_server/games.json`.
   - Serve it twice with a static server: once with the branch runtime and once with main's.
4. **Determinism:**
   - Use `mock-rgs-server.mjs` with a fixed `SEED`.
   - Run a per-game-type **script of forced books**:
     - base spin, no win
     - line win
     - trigger and each feature screen (Hold and Win, free spins, pots)
     - big-win tiers
   - Freeze time:
     - Playwright `clock` with a fixed `Date.now`
     - GSAP ticker stepped manually
     - spine/particles seeded
   - Wait on a `ready` signal per screen, not on sleeps.
5. **Key screens:** capture 12–14 per game at a fixed 1280×720 viewport and DPR 1.
   - The list per game type lives in `scripts/current-games/screens/<type>.json` (a pipeline-change
     artifact).
6. **Compare** with pixelmatch.
   - **The tolerance is a tunable setting, not a fixed rule.** It lives in
     `scripts/current-games/tolerance.json`, with a default plus per-game-type and per-screen
     overrides: max differing-pixel ratio, block size, block threshold and anti-aliasing.
   - Starting values: at most 0.1 % of pixels differ, plus no 16×16 block over the threshold.
     These are tuned from real runs: Phase 1 measures how much main-vs-main noise each screen has
     and sets thresholds just above it.
   - Tuning happens as needed. Changing the tolerance is a pipeline change the owner approves, and
     the report shows which tolerance each screen ran with.
   - Per-screen masks are only for content that is time-based by design. Masks are listed in the
     JSON and reviewed like code.
7. **Game tests:** run the game's own gates for its type (`check:*`, paytable fixtures, and the
   headless playtest smoke from its `docs/playtest/<game>.md` where scriptable).
8. **Report:** a JSON + HTML artifact, with a commit status `current-games` and per-game rows
   (build / tests / looks the same). The Pipeline Changes UI renders it.

**Approving an intended difference.**
- A visible difference is not automatically bad. Some changes are deliberate improvements. The
  harness blocks the merge and shows before / after / diff for every changed screen, and the owner
  decides.
- The owner approves *that diff* (branch SHA + game + screen + diff hash) in Pipeline Changes.
- The approval is stored in `pipeline_approvals` and re-checked against the hash, so a new commit
  invalidates it.
- `regression-guardian` can never approve. The approve control needs `pipelineMerge`.

**Asking for improvements.**
- Agents are expected to propose improvements, not only to avoid change. Examples: a sharper
  render, a fix for a visual bug the harness exposes, or a tolerance that is too loose or too
  strict.
- A proposal is opened as a pipeline change with before/after screenshots and a one-line reason.
  It is listed in `OPEN_QUESTIONS.md` and surfaced to the owner, never applied silently.

**Scale.**
- 14 games × ~14 screens, sharded 4 ways, is roughly 10 minutes per run with software rendering.
  To be measured in Phase 1.
- Games built by desktop builds (`hasOwnBuiltBundle`) are rendered with their own bundle on both
  sides. Only their build and tests are checked against the branch, and that is flagged in the
  report.

## Consequences

- New dev dependencies: `pixelmatch` and `pngjs`. Playwright is already used.
- Two new scoped secrets for CI: a read-only R2 token and a CI token for `/api/pipeline/games`. Both
  are added by the owner, never committed.
- Determinism work in the runtime (a clock / seed hook behind a test-only query flag) is itself a
  pipeline change. It must prove it renders identically when the flag is off.

## Needs owner approval

- Tolerance as a tunable config (starting values above, tuned from real runs) and the masking policy.
- The two CI secrets.
- The fact that the harness compares against **published** snapshots, not unpublished drafts.

## Amendments

- **2026-10-04, owner defaults (#1041):** desktop-built games (`hasOwnBuiltBundle`) are not
  rendered. Their row reports build + tests only, because comparing their own bundle with itself
  proves nothing. Rows that weren't rendered (no snapshot, not published, desktop-built) never count
  as a pass and never fail the run.
- **2026-10-05, approved (#1057):** a change that touches none of the runtime's inputs is not built or
  rendered; `current-games` posts success from the diff alone. The inputs are computed from the
  workspace graph (`apps/lines` and every package it reaches), plus the root build files, what the
  gates read and the harness itself (`scripts/current-games/lib/touched.mjs`). A diff that cannot
  be decided renders everything.
- **2026-10-06, approved (card 1G, #1063):** a published snapshot carries its own copies of the built-in
  component defs it uses, so a change to them reaches a game only at its next publish and the
  as-published render cannot see it. When a change touches what the publish bake reads from the repo
  (the built-in defs and what they import) and the two runtimes' built-ins differ, the harness also
  renders each affected game **as republished** — its snapshot with the baked copies of built-ins
  replaced by each side's built-ins, the closure re-resolved as the bake does — as a row of its own,
  compared the same way and failing the run the same way. A baked def is a copy of a built-in when
  it equals, by content, the built-in of the engine the game was published with (the commit its
  pointer records; a game whose engine is unknown fails closed); the rest is the author's and is
  loaded as the bake loads it, with each side's coded params merged in under a built-in's id. A
  change that cannot alter what a publish bakes never pays for it.
- **2026-10-06, approved (card 1F, #1061):** a game whose published snapshot main's runtime
  refuses, on both sides and for the same reason in every scenario, is its own row:
  `not rendered (main's runtime refuses the snapshot)`. It never passes and doesn't blame the branch.
  A branch that *fixes* a refusal still fails that row; this is deliberately cautious.
- **2026-10-06, approved (#1061, #1062):** the repo is public, so artifacts are public. Per-shard
  screenshots are deleted once compared; the report keeps changed screens only, for 3 days. CI
  loads Typekit from Adobe (a mirror exists but stays off until the licence is confirmed); jobs
  GitHub never starts are re-run once, never a job that ran and failed.
- **2026-10-07, approved (trusted verdict, #1082):** the harness (`current-games.yml`) holds no
  `statuses` permission, posts nothing and runs only for PRs into `main`; it renders and uploads.
  The `current-games` status is posted by `current-games-verdict.yml`, which `workflow_run` runs
  from `main`. Before posting it verifies the run is the harness file, for an open same-repo PR
  into `main`, at the head it posts to. Main's `touched.mjs` decides whether the change can reach
  a game. A PR that edits `.github/workflows/**` or `scripts/current-games/**` fails without its
  report being read (it wrote that report), as does a PR whose diff cannot be read; the owner
  merges such PRs after review by posting `current-games` by hand (or, once the check is pinned to
  an App, through the ruleset bypass). Otherwise jobs and `report.json` are read as data and
  decided as before; a report whose base is not on `main`, or that names none, fails. A cancelled
  run fails unless a newer run on its head will post. Push runs post no status; manual runs post
  `current-games/self-compare` / `current-games/manual` only. The other poster is the launcher's
  approval (ADR-0007). After the owner sets up an App through an environment limited to `main`,
  the required check is pinned to it (docs/INFRA.md). Residual: install/build code a PR changes
  still runs in its own harness run.
