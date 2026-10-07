# OPEN QUESTIONS — for the owner

Each question has a suggested default. If a question is still open when its task starts, we go
with the default.

## Open

1. **Typekit kit files in our R2.** Adobe Fonts' terms generally forbid self-hosting kit files.
   - *Suggested default:* no mirror. CI loads fonts from Adobe like players do; the CI retry covers
     short outages. The mirror code (#1062) stays off unless the owner confirms the licence allows it.

2. **Republish the live games once.** Every live snapshot carries built-in component copies from
   an older engine (e29a993), so its next publish picks up every built-in change since.
   - *Suggested default:* republish them once after the next built-in change lands, so the
     as-republished check (#1063) covers all of them from then on.

3. **`cloud` is broken for players.** Its snapshot has no `basegame` scene and the runtime refuses
   it. *Suggested default:* the owner republishes it, or unpublishes it if it's a test project.

4. **RunPod rates.** `pricing.json`'s RunPod $/s and `seedSecondsPerRender` are placeholders.
   *Suggested default:* the owner sends real rates; until then the cap uses the placeholders.

10. **Agent-eval as a GitHub required check.** Should `agent-eval` block a merge if it fails?
    *Suggested default:* no; the launcher's merge gate reads the evaluation report but does not
    require a passing status, so `pipelineMerge` users can merge anyway. Make it required only if
    policy changes.

12. **Card review right duration.** A blueprint card review is locked for editing once approved
    by `pipelineMerge`. How long does an approval last before re-review is needed?
    *Suggested default:* 30 minutes after the signed browser launch; approval persists if a
    republish, rescan or bundled sync does not change the card's contents.

13. **Owner action: review blueprint cards.** Blueprint cards ship inert (agents cannot yet request
    them). When agents are ready to request cards, reviewed and problem-free cards become available.
    *Suggested default:* the owner reviews each card in Atlas Maker (✎ Card) before agents use it.

14. **Clearing an atlas's own pipeline (from #1081).** A person cannot clear the pipeline a
    Director run set on an atlas, and ⧉ Duplicate atlas copies it. *Suggested default:* add a "use
    the global Pipeline again" action in Atlas Maker as a small follow-up.

15. **Person tile tools over a Director tile (from #1081).** FX builds, "use the ref as the tile"
    and Use my image still write the fixed `useroutput_<region>.png` and replace a Director tile
    as the region's tile (the versioned file stays; ⟲ AI gen leaves it). *Suggested default:*
    accept: a person's explicit action wins, and the Director's file stays recoverable.

16. **`hold_selection` writes `manifest_path` for a Director create (from #1081).** It writes the
    atlas people were already seeing, only when the selection is blank or stale. *Suggested
    default:* accept as the one exception to "a Director never writes the config".

18. **Abandoned-mockup sweep scope (from #1085).** Mockups under a deleted client are never swept,
    the sweep has no dry run, and a generic catalogue font name (e.g. "Serif") drops any unhedged
    gap naming it. *Suggested default:* accept all three (the safe side / owner's own catalogue).

19. **Which App to pin `current-games` to (from #1082).** A dedicated statuses-only App, plus a
    second entry for the launcher's App if the ruleset accepts the same context twice; otherwise
    the launcher's App for both. *Suggested default:* try the dedicated App first. Order matters:
    limit the `current-games-verdict` environment to `main` before adding any secret, and pin the
    check only after the App is seen posting (docs/INFRA.md).

20. **What the verdict still trusts (from #1082).** Harness and workflow edits now fail outright;
    install/build code a PR changes (`postinstall`, vite/turbo config) still runs in its own
    harness run and could shape the report. *Suggested default:* accept; review guards it.

21. **Harness and workflow PRs always need the owner (from #1082).** Every PR that edits
    `.github/workflows/**` or `scripts/current-games/**` gets `failure` and merges only after the
    owner posts `current-games` by hand (bypass once pinned). An approval made in the seconds
    before the verdict posts can be overwritten ("Post approval again" recovers). *Suggested
    default:* accept both.

22. **Re-homing leftovers (from #1090).** `deleteClient` (FK `ON DELETE SET NULL`) moves every
    project of the deleted client to `unassigned`, where it can land beside a same-slug project;
    and a pending `my_game` doc followed by a Game Maker `my-game` folds the doc into the new
    project's `director/` tree (existing behaviour). *Suggested default:* leave both; refuse a
    client delete that would alias if it ever happens.

23. **Existing folder aliases in production (from #1090).** `pnpm --filter launcher-api
    list:project-folder-aliases` (read-only) lists projects already sharing an R2 folder; it has
    not been run against production. *Suggested default:* the owner runs it once; any pair found
    is resolved by hand (rename or delete one), never by code.

24. **Per-job GPU pricing (from #1093).** No Director run can start until atlas-tool's GPU is
    priced: `RUNPOD_ENDPOINT_GPU` is unset. The owner keeps all six RunPod GPUs enabled and chose
    to price each job at the GPU that ran it, not one fixed GPU. *Suggested default:* the per-job
    GPU pricing card (the handler reports its GPU; atlas-tool records it per job; `pricing.json`
    maps the owner's GPUs at their rates; an unknown GPU bills at the dearest enabled one).

25. **Coordinator agent definition inputs (ADR-0007).** The coordinator's `inputs` line still
    names the preset, which 8C removed (harmless: the brief carries none). *Suggested default:* a
    one-file agent-definition PR with the line: "inputs: The run record (project, template,
    starting point, checkpoints), the owner's messages, task reports from the other agents, spend
    so far and the budget cap."

26. **`queue_variants` outside `style_pack`/`regions` (from #1093).** A render can be queued in
    later run steps (e.g. build); a step there that fails three times renders nothing more in the
    run, and the owner is told. No money depends on it. *Suggested default:* leave it for the
    pilot; refuse queueing outside those steps if the pilot shows renders there are unwanted.

## Answered

- **2026-10-07: card 8F's deploy window (#1101).** For the seconds between the launcher's boot
  migration and the traffic swap, the previous build's Director routes return 500. The owner
  accepted it: 8F merged with both deploys on 8C, `check:idle --strict` quiet and Director unused.

- **2026-10-07: pending keys aliasing a project folder (#1090).** #17 closed as suggested: new
  keys (create, client re-assign, Director pending keys and run create) can't take a folder
  another project holds under the same client folder; existing aliases untouched (see 22, 23).

- **2026-10-07: required check source (#1082).** #5 closed: only main's verdict workflow (and the
  launcher's approval) posts `current-games`; pinning the source to an App is the owner's
  follow-up (19).

- **2026-10-06: follow-ups batch (#1085).**
  - #6 double bill: a re-ask after a failed answer write is unavoidable; it is now always billed
    (answer row in a savepoint beside the spend row, so the cap sees every paid call).
  - #7 pending mockups: built as cleanup of abandoned pending keys (uploader empties the key, or
    the Admin sweep after `DIRECTOR_PENDING_MOCKUP_DAYS`, default 14), not "on project deletion".
  - #9 agent-eval actions pinned to commit SHAs; Dependabot's github-actions entry keeps them
    current.

- **2026-10-06: Phase 8 card 8A merge (#1078). Owner decision.**
  - Image-cache eviction in the Changes tab: fixed in #1074 (image artifact artifacts now
    properly keyed and cached; old reports with different names are correctly versioned).

- **2026-10-06: Phases 2–5 merges (#1070, #1072, #1073, #1075). Owner decisions.**
  - GitHub App permissions: already in place. `Contents` and `Pull requests` write for 5.3 (merge),
    5.4 (edit agent defs). The environment move to GitHub secret is optional (recorded 2026-10-06).
  - ANTHROPIC_API_KEY: stays a GitHub Actions repository secret, not an environment variable
    (2026-10-06). Environment move optional.
  - Agent-definition label: exists (added in #1073).
  - ADR-0008 (blueprint-driven art) decisions: all suggested defaults approved. Blueprint card
    review needs `pipelineMerge` (counts as approval); `atlas_pipeline` is a dedicated per-atlas
    key; technician on Sonnet 5.5; pre-run budget cap; credit-billed cards excluded until ADR-0006
    gains a `credits` kind; third-party API use (mockup crops to OpenAI) needs owner consent per
    run; licences listed before publish; `wanloopingvideo__3_` re-publish (shape_ref unbound +
    rescan); `bluprinttest` and `characterdesignertest3` permanent draft; deploy only when no run
    non-terminal.

- **2026-10-06: harness and merges (#1056–#1065). Owner decisions.**
  - The harness is calibrated; `current-games` gates every merge and is to be made a required
    check on `main` (ruleset source **any**). Docs-only and untouched changes pass without
    rendering.
  - The `refused` row kind is accepted (ADR-0004 amended).
  - Artifacts: option (b). The repo is public, so per-shard screenshots are deleted after the
    compare and the report keeps changed screens only, for 3 days.
  - Built-in component changes are checked "as republished" (card 1G, #1063).
  - CI keeps `--enable-unsafe-swiftshader` and re-runs jobs GitHub never started, once.
  - The launcher has **no** Watch Paths (it had been given one by mistake; fixed).
  - The worker's `/healthz` is liveness (#1065): a missing secret reads `driving: false`.

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
