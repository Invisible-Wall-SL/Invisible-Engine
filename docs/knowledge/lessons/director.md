# Director — lessons

What has bitten Director work before, newest first. Format and rules: [README](../README.md).
Current state lives in [director/PLAN.md](../../director/PLAN.md) and
[director/HISTORY.md](../../director/HISTORY.md); this file only keeps the traps. It covers
Invisible Director, Pipeline Changes and `services/director-worker`. The current-games harness has
its own file: [current-games](current-games.md).

### A migration renumbered after another was skipped
- **Symptom:** risk: drizzle silently skips a migration whose `when` is earlier than the last one
  applied, so a column drop could never run.
- **Cause:** 8F's drop was numbered 0030 before 8E's own 0030 merged.
- **Fix:** regenerated as `drizzle/0031_director_drop_preset_json.sql`, so its `when` is later. A
  dropped column is never code-reverted; re-add it with a new migration.
- **Guard:** `check:idle --strict` run against production before and after the deploy.
- **PR:** #1101 (2026-10-07) · source: `docs/director/HISTORY.md`

### The launcher and the worker deployed in the wrong order
- **Symptom:** risk: a worker deployed before the launcher's migration hits a missing column.
- **Cause:** `settleJob` read a column that migration 0030 adds (SQLSTATE 42703).
- **Fix:** a 42703 fallback inside a savepoint (`services/director-worker/src/recipes.ts`), so
  either order works; boot re-arm isolates each row, staggered 2 s apart.
- **Guard:** `prove:art-plan`.
- **PR:** #1116 (2026-10-07) · source: `docs/director/HISTORY.md`

### A recipe revision re-opened steps that had already rendered
- **Symptom:** a revised Art plan could re-render paid steps and keep the old approval.
- **Cause:** a revision reset step status instead of keeping unchanged steps' status.
- **Fix:** a revision keeps unchanged steps; re-rendering a rendered step always needs the owner;
  a rendering step cannot be revised; only the owner's approval resets the failure count.
- **Guard:** `prove:art-plan` (scenario 6: a resend never re-queues a rendered step),
  `check:recipes`.
- **PR:** #1091, #1093 (2026-10-07) · source: `docs/director/HISTORY.md`

### A new key could alias another project's R2 folder
- **Symptom:** `sunken_temple` beside `sunken-temple` would share one R2 folder.
- **Cause:** R2 paths use `r2Slug(client)/r2Slug(key)`; creates checked the key, not the folder.
- **Fix:** `createProject` / `assignProjectToClient` check under `withProjectKeyLock` and throw
  `ProjectFolderTakenError`; Director's run create refuses `key_folder_taken`.
- **Guard:** `check:project-create` (race + lock-off control); `list:project-folder-aliases`.
- **PR:** #1090 (2026-10-07) · source: `docs/director/HISTORY.md`

### A PR could post its own green current-games status
- **Symptom:** risk: a PR's harness run held `statuses: write`; a PR into another branch sharing
  the head SHA could turn `main`'s required check green.
- **Cause:** the status was posted by the PR's own tree.
- **Fix:** `current-games-verdict.yml` (`workflow_run`, main's code) verifies and posts; a PR that
  edits the harness or workflows fails outright and needs the owner.
- **Guard:** `scripts/current-games/verdict.fixture.mjs`.
- **PR:** #1082 (2026-10-07) · source: `docs/director/HISTORY.md`

### A Director safety change altered person atlases
- **Symptom:** review: `bpParams` by effective pipeline changed atlases no Director touched.
- **Cause:** the rule applied to every atlas, not only Director-configured ones.
- **Fix:** limited to atlases whose manifest carries a Director pipeline (`batch_atlas.py`).
- **Guard:** atlas-tool `test_director_safety.py`; a side-by-side render against main.
- **PR:** #1081 (2026-10-06) · source: `docs/director/HISTORY.md`

### A failed write left a paid model call unbilled
- **Symptom:** risk: the spend cap could fail open.
- **Cause:** the bill and the answer row shared a transaction; a failed answer write rolled back
  the bill too (#1067 had the mirror double-bill risk).
- **Fix:** the answer row is written in a savepoint: the bill always commits, the error rethrows.
- **Guard:** `prove:breakdown` scenario 10 (3 calls, 3 billed, 2 stored).
- **PR:** #1085 (2026-10-06) · source: `docs/director/HISTORY.md`

### A merged PR ran no push workflow
- **Symptom:** after the #1061 squash, nothing ran on `main`.
- **Cause:** the PR description contained the skip-CI token, and the squash message copies it.
- **Fix:** the coordinator writes each squash commit's message itself.
- **Guard:** none.
- **PR:** #1061 (2026-10-06) · source: `docs/director/HISTORY.md`

### A required gate merged PRs it had never checked
- **Symptom:** #1042 and #1043 merged while `current-games` was red on every PR.
- **Cause:** its secrets were missing, so it was red for a setup reason, and red stopped meaning.
- **Fix:** the harness skips with success when the runtime is untouched (`lib/touched.mjs`); the
  first run on `main` covered the merged PRs.
- **Guard:** `touched.fixture.mjs`; an undecidable diff renders everything.
- **PR:** not recorded (2026-10-05) · source: `docs/director/HISTORY.md`

### The Director brief assumed a platform that does not exist
- **Symptom:** plans built on git-backed games, template projects and a math lock.
- **Cause:** Game Maker writes no git (a project is a DB row plus an R2 tree), "templates" are
  ordinary sample projects, and the platform had no math-lock concept.
- **Fix:** recorded as OPEN_QUESTIONS Q1–Q3; ADRs follow the code, not the brief.
- **Guard:** rule: read ARCHITECTURE §1 before trusting `KICKOFF_PROMPT.md`.
- **PR:** not recorded (2026-10-04) · source: `docs/director/HISTORY.md`
