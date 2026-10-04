# OPEN QUESTIONS — for the owner

Each question has a suggested default. If a question is still open when its task starts, we go
with the default.

## Open

None right now. Task sessions add new ones through their PR descriptions.

## Answered

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
