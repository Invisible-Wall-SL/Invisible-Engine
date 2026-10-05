# OPEN QUESTIONS — for the owner

Each question has a suggested default. If a question is still open when its task starts, we go
with the default.

## Open

1. **Merging before the harness has run.** #1042 and #1043 merged while `current-games` was red only
   because its secrets are missing.
   - *Suggested default:* from now on, nothing merges until `current-games` is green on the live
     games, except docs-only PRs (the workflow already passes those). Once it has run green once,
     make `current-games` a required check on `main`, with ruleset source **any**.

## Answered

- **2026-10-04: card questions from #1040–#1044. Defaults adopted.**
  - **Pricing:**
    - RunPod $/s stays a placeholder until the owner confirms the real rates.
    - The worker uses the 5-minute cache TTL.
    - The budget setting is bounded to $1–$500.
    - 3.7 adds a nullable unique `requestId` to `director_spend`.
    - The cost code moves into a shared workspace package when the worker first needs it.
  - **Harness:**
    - Rows that weren't rendered never pass and never fail the run.
    - Desktop-built games get build + tests only (ADR-0004's wording is amended in its Amendments
      section).
    - `current-games` becomes required after its first green live run.
    - The cluster/scatter free-spin counter gets moved onto the shared ComponentDef in a separate
      engine change (a candidate card).
    - Hold and Win big-win tiers come from feature totals for now.
    - The harness runs 6 shards; if a run goes over 15 minutes, add shards before shortening the
      canary.
  - **Adapters:**
    - The `worker` identity stays; the worker sets `agent` from the definition it runs, never from
      model output.
    - Region counts are per atlas, plus an atlas → group map on the template when the New Game panel
      is built.
    - QA fails a run whose `templateConfigEtag` is null.
    - The `saved_by` stamp goes into the docs that 2.4/2.6 write.
  - **atlas-tool:**
    - A restart doesn't resume regions that were never submitted.
    - `ATLAS_CALLBACK_SECRET` is shared between the launcher and atlas-tool only.
    - Callbacks are not retried within a container's life; the watcher's `/progress` backoff covers
      that.
  - **Worker (#1044):**
    - Keep the `owner_request` and `run_status` event kinds (ADR-0003 is amended).
    - Checkpoint ids are `breakdown` / `region_batch` / `before_publish`.
    - Pause is only allowed from `running`.
    - The turn loop offers only ops the launcher actually serves.
    - `NOTIFY` comes from an `AFTER INSERT` trigger in 3.5.
    - `prove:lease` gets a Postgres CI job.
    - No FK from `director_spend.run_id`.

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
