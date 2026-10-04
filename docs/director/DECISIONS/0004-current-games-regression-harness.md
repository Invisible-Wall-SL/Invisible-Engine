# ADR-0004 — Current-games regression harness

- **Status:** proposed
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
   - A screen counts as "same" when the differing pixels are ≤ 0.1 % of the screen and no 16×16
     block differs by more than a threshold (catches small but real changes).
   - Anti-aliasing tolerance is on.
   - Per-screen masks only for content that is time-based by design. Masks are listed in the JSON
     and reviewed like code.
7. **Game tests:** run the game's own gates for its type (`check:*`, paytable fixtures, and the
   headless playtest smoke from its `docs/playtest/<game>.md` where scriptable).
8. **Report:** a JSON + HTML artifact, with a commit status `current-games` and per-game rows
   (build / tests / looks the same). The Pipeline Changes UI renders it.

**Approving an intended difference.**
- The owner approves *that diff* (branch SHA + game + screen + diff hash) in Pipeline Changes.
- The approval is stored in `pipeline_approvals` and re-checked against the hash, so a new commit
  invalidates it.
- `regression-guardian` can never approve. The approve control needs `pipelineMerge`.

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

- The pixel tolerance and the masking policy.
- The two CI secrets.
- The fact that the harness compares against **published** snapshots, not unpublished drafts.
