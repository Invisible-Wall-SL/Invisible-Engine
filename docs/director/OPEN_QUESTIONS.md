# OPEN QUESTIONS — for the owner

Each question has a suggested default. If a question is still open when its task starts, we go
with the default.

## Open

None right now. Task sessions add new ones through their PR descriptions.

## Answered

- **2026-10-04: Phase 1 card questions (#1035–#1037). Defaults adopted, per the rule at the top of this file.**
  - Global (project-less) games stay in `/api/pipeline/games`. The harness reports a game with no
    snapshot as "not rendered (no snapshot)" and a missing pointer as "skip: not published", each
    in its own row and never as a pass.
  - The harness uses `draw:'last'` on both sides, plus one faithful (`draw:'every'`) canary scenario
    per game type.
  - The determinism flag stays ungated in the player bundle.
  - `stalls > 0` or `errors > 0` fails that game's comparison.
  - The harness pins the browser to UTC / en-US.
  - The "new" tags come off in the PR that ships each tool's UI: Director in Phase 4, Pipeline
    Changes and `pipelineMerge` in Phase 5.
  - Pipeline Tester has `pipelineChanges` as a `ROLE_TOOLS` default, not a DB grant.
  - `pipelineMerge` can be set per role only. Per-user capability overrides are a separate launcher
    change if anyone wants them.
  - A session that can only push to its own designated branch uses it instead of the card's branch
    name.

- **2026-10-04: all Phase 0 defaults accepted by the owner ("alright, let's start").**
  - Q1 Template = a published project an admin marks as a "Director template".
  - Q2 "On main" = Game Maker's DB + R2 path, with no git.
  - Q3 Math lock = the adapters refuse Game Config writes, plus a QA ETag check.
  - Q4 Runtime = ADR-0001 as written.
  - Q5 Writes = attributed to the run's owner, stamped `tool: director` / `agent`.
  - Q6 Harness = every published game; desktop-built games get build + tests only.
  - Q8 CI secrets = the owner creates a read-only R2 token and a CI token as GitHub secrets.
  - Q9 Pipeline changes = GitHub branch + PR, squash merge, revert PR for rollback (ADR-0007
    before Phase 5).

- **(was Q7) Pixel tolerance.** Answered 2026-10-04: not a fixed 0.1 %. Tolerance is a tunable
  config (`scripts/current-games/tolerance.json`), changed as needed with the owner's approval.
  Agents should actively propose improvements, including visual ones, as pipeline changes with
  before/after screenshots. See ADR-0004.
- **(was Q10) Mockup gaps.** Answered 2026-10-04: the owner sent `02-director-new-game.html` and `04-director-live-run.png`, so the set is now complete.
