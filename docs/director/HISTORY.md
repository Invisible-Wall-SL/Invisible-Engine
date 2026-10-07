# HISTORY — Invisible Director + Invisible Pipeline Changes

This log is append-only. Put the newest entry at the top, and never edit an older entry: correct it
with a new one. Use this format:

```
## YYYY-MM-DD · Phase N · <agent>
- Did: …
- Files: …
- Branch / PR: …
- Tests: …
- Decisions: …
- Next: …
```

---

## 2026-10-07 · Phase 5 · coordinator (merges #1082)
- **Did:** #1082 (Trusted current-games verdict, OPEN_QUESTIONS 5).
  - The PR's harness run no longer holds `statuses: write`, never posts `current-games`, and runs
    only for PRs into `main`.
  - New `current-games-verdict.yml` (`workflow_run`, main's code): verifies the run (harness file,
    open same-repo PR into `main`, head SHA), re-decides reach with main's `touched.mjs`, fails
    harness/workflow-editing PRs without reading their report, requires the report's base on
    `main`, fails a cancelled run unless a newer one will post, reads jobs and `report.json` as
    data only, and posts the status.
  - Launcher unchanged apart from comments and the no-report text; its approval is the second
    poster.
- **Files:** `.github/workflows/{current-games,current-games-verdict}.yml`,
  `scripts/current-games/{lib/verdict.mjs,verdict.fixture.mjs}`,
  `apps/launcher-api/src/lib/server/pipelineReport.ts`, `docs/INFRA.md`, `docs/status/engine.md`,
  `docs/playtest/current-games.md`.
- **Branch / PR:** `claude/clever-brahmagupta-c18bt9` → #1082 (squash ab5b4178). Merged after the
  owner posted `current-games` on its head by hand (the bootstrap route).
- **Tests:** `verdict.fixture.mjs` (every decision branch and rejection, including the
  other-branch shared-head attack, harness edits, unreadable diffs, base off `main` or missing,
  cancelled runs), `check:all` 395/395, launcher `check:pipeline-changes`; CI green. Reviewed
  three rounds; the first found a PR into another branch could turn `main`'s check green.
- **Decisions:** ADR-0004 amended (trusted verdict). OPEN_QUESTIONS 5 answered; new 19–21.
- **Next:** owner: limit the `current-games-verdict` environment to `main`, then add the App
  secrets, confirm the App posts, then pin the check. The first PR after this merge shows the
  verdict posting `pending` then its result.

## 2026-10-06 · Phases 3, 4, 5 follow-ups · coordinator (merges #1085)
- **Did:** #1085 (Director follow-ups batch).
  - A breakdown answer row is written with its bill, inside a savepoint: a failed answer write
    rolls back only itself, the bill always commits and the error is rethrown, so a re-ask is
    always billed and the cap sees it (OPEN_QUESTIONS 6).
  - Abandoned pending-key mockups are cleared when the uploader removes the last image, or by an
    Admin sweep (Settings › Invisible Director › Clear abandoned mockups) after
    `DIRECTOR_PENDING_MOCKUP_DAYS` (default 14) with no run (OPEN_QUESTIONS 7). Per R2 folder
    (`r2Slug`), under a per-folder advisory lock (`withProjectKeyLock`) that `createProject` and
    Director's run create also take; every in-lock query runs on the lock's transaction; the sweep
    pre-filters before locking; the doc is sealed by CAS before deletion.
  - Font gaps are dropped when the style note names a project or `_shared` font from
    `fonts.list`, unless the mention is hedged ("not X", "X-like", …).
  - agent-eval actions pinned to commit SHAs (OPEN_QUESTIONS 9); the secret scanner exempts
    `uses: owner/repo@<sha>` pins.
- **Files:** `services/director-worker/src/{driver,mockups/analyze,mockups/rules,eval/mockupSet}.ts`,
  `scripts/prove-breakdown.ts`; `apps/launcher-api/src/lib/server/{projectKeyLock,projects,appSettings}.ts`,
  `director/{mockupCleanup,mockups,runs,store}.ts`, Admin route, `scripts/check-director-{mockups,runs}.ts`;
  `.github/workflows/agent-eval.yml`, `scripts/check-secrets{,.test}.mjs`; `docs/status/launcher.md`,
  `docs/tools/{director,launcher}.md`.
- **Branch / PR:** `claude/lucid-allen-8x3dap` → #1085 (squash 9db117f1).
- **Tests:** prove:breakdown 79/79 (scenario 10: 3 calls, 3 billed, 2 stored), check:mockups
  105/105, check:director-mockups 144/144, check:director-runs 411, check:agent-eval 161/161; CI
  green. Reviewed twice; the first round's blocker (a rolled-back bill left a paid call
  unrecorded, so the cap could fail open) and the pool-deadlock risk were fixed.
- **Decisions:** OPEN_QUESTIONS 6, 7, 9 answered (see there). New: 17 (pending keys aliasing a real
  project's folder), 18 (sweep scope).
- **Next:** a small follow-up for OPEN_QUESTIONS 17.

## 2026-10-06 · Phase 8 · coordinator (merges #1081)
- **Did:** #1081 (card 8B, Atlas Maker safety changes for the Director). atlas-tool only; nothing
  changes on a person's atlas.
  - `/saveconfig` `atlas_pipeline` → `manifest.settings.pipeline` (Director only, per-atlas keys
    only, never writes `atlas_config.json`); the page follows that atlas's pipeline.
  - On such an atlas, `bpParams` follow each region's effective pipeline
    (`batch_atlas.region_bp_params`); person atlases render byte-identically, proven by fixtures
    and by a side-by-side render against main.
  - `/render` refuses a Director token on the `http` transport, re-checked in the worker.
  - A Director `/setoutput` writes a create-only `refs/useroutput/<region>_<run>_<sha12>.png` (own
    folder, so no collision with a person's `useroutput_<name>.png`); ✕ revert keeps the file.
  - No Director call moves the active atlas (`/newatlas`, `/duplicateatlas`, `/?atlas=`);
    `hold_selection` writes down a blank or stale `manifest_path` before a Director create.
  - Refused for a Director token: POSTs to atlas routes without `?manifest=` (400),
    `/uploadblueprint`, and manifest writes R2 did not take (503). `bpParams` ids stored lowercase.
- **Files:** `services/atlas-tool/{batch_atlas.py,ui_server.py,test_director_safety.py,
  test_director_calls.py,test_atlas_style_gate.py}`, `docs/status/atlas-maker.md`,
  `docs/tools/atlas-maker.md`.
- **Branch / PR:** `claude/clever-galileo-0fcc93` → #1081 (squash 4c26341c).
- **Tests:** `scripts/check-python.py` atlas-tool 40/40, sheet-tool 6/6; CI green. Reviewed twice
  by code-reviewer; the first round's blocker (bpParams by effective pipeline changed human
  renders) fixed by limiting the rule to Director-configured atlases.
- **Decisions:** ADR-0008 §Context and §5 amended: an override region renders with the ACTIVE
  pipeline's saved params matched by key (not baked defaults); effective-pipeline keying applies
  only on a Director-configured atlas.
- **Next:** 8D. It must expect the tile at `refs/useroutput/…`; add server-side `is_director`
  refusals on `/card/save`, `/deleteblueprint`, `/taxonomy/save` as a second line behind
  `refusals.ts`; owed a live Director-token pass. Open nits: `applyPipe`'s first loop still shows
  per-atlas fields from the global pipeline on a Director atlas; `hold_selection` can race a
  person's atlas switch (tiny window).

## 2026-10-06 · Phases 5, 4, 8 · coordinator (merges #1074, #1076, #1078)
- **Did:**
  - **#1074 (card 5C, Phase 5: merge & history & rollback):** pipelineMerge endpoint pins a SHA and
    fetches the GitHub App token (server re-reads; scoped title via shared scripts/commit-scope.mjs,
    only revert exempt; explicit commit message; never bypasses protection; serialized; requestId;
    `pipeline_merges` migration 0028 with the approvals snapshot; settled only by the App's own
    bot). The History tab shows past merges with rollback as a 3-way file-level revert PR onto
    main's tip (recorded by revert_pr). Agent-eval verdict on agent-definition PRs gates their
    merge.
  - **#1076 (card 4C, Phase 4: live run screen):** the Live run screen shows steps rail, actionable
    banner (pause/resume/stop with refused approvals), galleries, review panels, activity feed and
    message box. Plan names matched by normalised spelling; scratch-atlas regions kept out of counts
    (the ADR-0008 hook). Two owner-scoped image routes with sniffing, nosniff and CSP. Test:
    check:director-live.
  - **#1078 (card 8A, Phase 8: blueprint cards):** card schema, validation, CAS storage and history;
    editor UI with seeded drafts (unreviewed by default). Review needs a fresh (≤30 min) signed
    browser launch with pipelineMerge. Resets on re-publish, rescan and bundled sync. R2 digests
    recorded. `GET /blueprints` serves agents reviewed and problem-free cards only; `/card` is 403
    for agents. Inert (no agent consumes them yet).
- **Files:**
  - #1074: `apps/launcher-api/src/lib/server/director/{merge,pipelineMerge,history}.ts`,
    `src/routes/api/director/{merge,history}/*`, `db/drizzle/0028_pipeline_merges.sql`,
    `agents/coordinator.md` (verdict check added).
  - #1076: `apps/launcher-api/src/lib/{director/liveRun,components/activity-feed,components/review-panel}.svelte`,
    `src/lib/server/director/liveRun.ts`, `scripts/check-director-live.ts`,
    `docs/tools/director.md`.
  - #1078: `services/atlas-tool/blueprints/{card,edit,save,history}*.py`, `apps/launcher-api/src/routes/api/blueprints/*`,
    `src/lib/server/director/blueprintCards.ts`, `docs/director/blueprints/catalogue-draft.json`.
- **Tests:**
  - #1074: check:director-merge 142/142, agent-eval report fixture.
  - #1076: check:director-live 38/38, launcher gates, svelte-check.
  - #1078: check:director-adapters (blueprint routes), check:python atlas-tool 41/41.
- **Decisions:**
  - #1074: pipeline merges are API-driven; History is per-merge; rollback is a revert PR; agent
    verdicts gate agent-definition merges.
  - #1076: Phase 4 requires normalised plan name matching; CSP restricts live image sources.
  - #1078: blueprint cards inert; review right lasts ≤30 min after a signed launch (default:
    accepted); agents use reviewed cards only.
- **Next:** Phase 4 backend complete (4A, 4.1–4.3); Phase 5 backend complete (5.1–5.4, 5.3 now
  done); Phase 8 on roadmap with 8A done, 8B–8F to follow. Open questions 11 (answered 2026-10-06)
  and two new items added to OPEN_QUESTIONS.
- **Owner approval:** All three PRs merged with owner approval (recorded 2026-10-06).

## 2026-10-06 · Phases 5, 4, 2 · coordinator (merges #1070, #1072, #1073, #1075)
- **Did:**
  - **#1070 (card 5.2, Phase 5: changes list/detail & checks):** the `/pipeline Changes` tab shows
    branches + PRs with files, diffs, CI gates grouped, a report streamed from a new endpoint as a
    ZIP archive (path whitelist; server-chosen artifact per section; size cap; ZIP64 refused), and
    diff approval. Two screen passes (mockup 05 detail both checks); GitHub-only links; nosniff +
    sandbox CSP on report artifacts.
  - **#1072 (card 4.1 & 4.2, Phase 4: new game & mockup breakdown screens):** Director → New game
    (form, estimate, ownership check) and Mockup breakdown (read-only analysis display). Shared
    `$lib/projectKey.ts` editor. Pending-project mockups writable by uploader only; enforcement
    in the gate and CAS write (empty doc frees the key); confirm needs images. Mockup tab shows
    all pending mockups.
  - **#1073 (card 5.4, Phase 5: agents tab):** edit an agent definition as a PR on a branch,
    labelled `agent-definition` (label exists). `agent-eval.yml` evaluates before/after on
    `pull_request_target` (main only, main's code) with a $20 spend cap from real usage. The
    launcher fails closed on an unverified report.
  - **#1075 (ADR-0008: blueprint-driven art, approved):** blueprint catalogue draft (7 library + 3
    built-in cards). Card schema, storage, history, editor. `GET /blueprints` (blueprint read
    adapter op). Bundled and seeded cards. Everything inert (no agent consumes it yet). All defaults
    approved by owner.
- **Files:**
  - #1070: `apps/launcher-api/src/lib/server/{pipeline,pipelineReport,pipelineChanges}/*.ts`,
    `src/routes/api/pipeline/{changes,report}/*.ts`, `docs/tools/pipeline-changes.md`.
  - #1072: `apps/launcher-api/src/lib/{projectKey,director/newGame,director/mockupBreakdown}.svelte`,
    `src/lib/server/director/mockups.ts`, `docs/tools/director.md`.
  - #1073: `.github/workflows/agent-eval.yml`, `apps/launcher-api/src/routes/api/director/eval`,
    `agents/{coordinator,atlas-artist,atlas-technician}.md` (agent label added).
  - #1075: `services/atlas-tool/blueprints/{card,edit,sync}*.py`, `apps/launcher-api/src/lib/server/director/blueprints.ts`,
    `docs/director/blueprints/catalogue-draft.json`, `docs/director/DECISIONS/0008-blueprint-driven-art.md`.
- **Tests:**
  - #1070: launcher gates, svelte-check.
  - #1072: check:director-mockups, check:director-runs, launcher gates.
  - #1073: agent-eval, code-reviewer pass.
  - #1075: card schema validation, blueprints module, check:director-adapters, code-reviewer pass.
- **Decisions:**
  - #1070, #1072: implement ADR-0007 (PIPELINE) and Phase 4 tasks.
  - #1073: agent definitions are PRs with labels; evaluation is GitHub Actions with $ cap from real usage.
  - #1075: ADR-0008 approved with all suggested defaults (owner decision 2026-10-06; catalogue
    draft has 7 library + 3 built-in cards).
- **Next:** Phase 8 on the roadmap (blueprint-driven art build: cards 8A–8F); 4.1 and 4.2 done;
  5.1 and 5.2 done; 5.3 merge and rollback; 5.4 agents tab done. Open question items answered
  (GitHub App permissions, ANTHROPIC_API_KEY, agent-eval label).
- **Owner approval:** All four PRs merged with owner approval (recorded 2026-10-06).

## 2026-10-06 · Phases 3, 5, 4 · coordinator (merges #1067, #1068, #1069)
- **Did:**
  - **#1067 (card 3.9, PLAN 3.6 follow-up):** the breakdown step moves entirely to the worker.
    `analyzeMockups` + `submitBreakdown` run before any agent turn; the checkpoint opens once per
    attempt. One vision call per image carries the analyst's model and prompt, is preceded by
    owner pause/stop check and cap check, and is billed before anything else. Every answer stored
    per image as `breakdown_image` activity rows, keyed by attempt, image-bytes hash and
    system+prompt hash; a stopped pass re-asks only missing images. A refusal, unusable answer
    or permanent API error pauses at once. Conflict handling has three verdicts on LockedItem.facts
    (clash → left_out; cleared → model claim dismissed, element matched; unjudged → claim capped
    at needs_you), tried only for rules ABOUT the element. A model-named locked item is capped at
    needs_you. Regions is a list; uncoveredRegions computed by code. Owner revise re-runs as
    next attempt with notes in the image prompt. run.submit_breakdown and coordinator's
    step_done/assign_task in breakdown are retired. Test: prove:breakdown 73/73.
    Owner approved the merge on 2026-10-06.
  - **#1068 (card 5A, Phase 5: changes & approvals):** GitHub App client in `githubApp.ts`,
    api.github.com only; artifact redirect is followed without the token. Changes list/detail view.
    `pipeline_approvals` table (migration 0027), unique per diff+approver. Approval endpoint
    behind `pipelineMerge` capability, posting `success` to `current-games` status once every diff
    is approved by users still in standing and the harness attempt's jobs agree (refuse forks,
    harness-editing via .github/workflows/**, scripts/current-games/**, renames and truncated
    file lists). `current-games.yml` uploads `report.json` as a second artifact. Owner approved
    the merge on 2026-10-06.
  - **#1069 (card 4A, Phase 4: owner API):** create action (`duplicateProject` scope; needs
    Director + Game Maker; fresh create never adopts existing project). start/pause/resume/
    approve/stop as `owner_request` events with `requestId` idempotency answered from
    `director_ops` first; stale pending reclaimed after `STALE_CLAIM_MS`. A resent create during
    the copy answers `in_progress`. Estimate returns `budgetCapUsd`. Font requests listed one
    level deep by R2 key. Budget cap copied by worker at start per ADR-0006. Test: check:director-runs.
    Owner approved the merge on 2026-10-06.
- **Files:**
  - #1067: `services/director-worker/src/{driver,store,tools,workerTools,budget,main}.ts`,
    `src/mockups/{analyze,checkpoint,rules,vision}.ts`, `scripts/prove-breakdown.ts`,
    `agents/{mockup-analyst,coordinator}.md`, `.github/workflows/director-worker.yml`,
    `docs/INFRA.md`, `docs/director/eval/mockups/expected-breakdown.json`.
  - #1068: `apps/launcher-api/src/lib/server/{githubApp,zip,pipelineReport,pipelineChanges,
    pipelineApprovals,pipelineAccess,env}.ts`, `db/schema.ts`, `drizzle/0027_pipeline_approvals.sql`,
    `src/routes/api/pipeline/changes/**`, `scripts/check-pipeline-changes.ts`,
    `.github/workflows/current-games.yml`, `docs/INFRA.md`, `docs/guides/rotate-a-secret.md`,
    `docs/status/launcher.md`, `docs/tools/pipeline-changes.md`, `docs/playtest/current-games.md`.
  - #1069: `apps/launcher-api/src/lib/server/director/{runs,ownerActions,store,access,fontRequests}.ts`,
    `director/ops/{fonts,gamemaker}.ts`, `src/routes/api/director/**`,
    `scripts/check-director-runs.ts`, `packages/director-costs/src`, `docs/tools/director.md`.
- **Tests:**
  - #1067: prove:breakdown 73/73, prove:turns 120/120, check:mockups 85/85, check:run-state 1112.
  - #1068: check:pipeline-changes 767 (under check:all), launcher gates, svelte-check at baseline.
  - #1069: check:director-runs 353/353, check:director-mockups, check:launcher-gates 350/350.
  - Each PR had a code-reviewer pass and two or three coordinator review rounds before merge.
- **Decisions:**
  - #1067 amends ADR-0005: breakdown is worker-driven, vision answers stored per image keyed by
    attempt+hashes, three verdicts (clash/cleared/unjudged) on facts only for element-touching
    rules, model-named items capped at needs_you, regions is a list/uncoveredRegions computed,
    owner revise re-runs as next attempt.
  - #1068, #1069 implement ADRs approved 2026-10-05.
- **Next:** Phase 4 backend-done (4A via #1069); Phase 5 backend-done (5.2 via #1068); now 5.1
  (changes list/detail screens) and 4.1–4.3 (UI for estimate, breakdown, live run).
- **Open items from merges (Answered, 2026-10-06):**
  - GitHub App set up: done by the owner; `current-games` as a required check: source is "any"
    (default: accept for now; follow-up card for a trusted workflow_run verdict pinning source).
  - #1067's double-bill risk on `breakdown_image` DB failure: a small follow-up to make spend +
    row atomic.
  - Pending-project mockups can be written under a free key and are never cleaned up: a cleanup
    follow-up.
  - App permissions: Contents and Pull requests write needed for 5.3/5.4; owner raises when 5.3
    lands.

## 2026-10-06 · Phases 1–3 · coordinator
- **Did:** recorded the merges below. Each card's own HISTORY entry is in its PR description.
  - **#1061 (1F):** the current-games harness is calibrated on the live games. Main vs main gives
    0 changed screens on 161 of 161 screens, twice; a seeded 1 px win-line shift is caught on 21
    screens. Root causes: no WebGL in CI, Typekit and web-font races, and HUD text drawn twice per
    frame. The fixes apply only in the harness's test mode.
  - **#1062 (1H):** re-runs `current-games` jobs GitHub never started, once. A Typekit mirror exists
    but stays off (licensing).
  - **#1063 (1G):** built-in component changes are also rendered "as republished"; an unknown
    published engine fails closed.
  - **#1056 (2D, PLAN 2.6):** 14 adapter ops for Symbols, Scene, Win Text, Localization, Fonts,
    Rigger and Flipbook, all through the tools' storage modules with `baseEtag`.
  - **#1058 (3B, PLAN 3.4/3.5/3.7):** the worker drives runs: turn loop, resume by `opId`,
    LISTEN/NOTIFY wake, checkpoints, spend ledger and budget cap.
  - **#1064 (2.7):** RunPod GPU time is billed and the cap fails closed.
  - **#1065:** the worker's `/healthz` is liveness.
- **Found:**
  - The launcher had a Watch Path set, so it skipped three deploys. The owner removed it.
  - #1061's PR description contained the skip-CI token, so no push workflow ran on its squash. Since
    then the coordinator writes each squash commit's message itself.
  - `cloud` is broken for players (see OPEN_QUESTIONS 3).
- **Decisions:** ADR-0001 amended (manual turn loop); ADR-0004 amended (refused row, artifacts,
  Typekit, retry; untouched and republished renders approved); ADR-0006 amended (GPU billing, cap
  fails closed). See OPEN_QUESTIONS "Answered, 2026-10-06".
- **Next:** #1059 (3C: mockups + event stream) after it brings in main; then Phase 4 (4A run API,
  then 4B/4C screens).

## 2026-10-05 · Phase 5 · coordinator
- **Did:** the owner approved ADR-0007 (pipeline-change mechanics), changing the eval cap to $20.
- **Decisions:**
  - GitHub is the record; merge is a SHA-pinned squash through the API; rollback is a revert PR.
  - A GitHub App holds the credentials.
  - "Green or approved" is the single required status `current-games`: the launcher posts
    `success` to that same context once every diff on the head is approved.
  - The `agent-eval.yml` cap is $20 per run.
- **Files:** `DECISIONS/0007-pipeline-change-mechanics.md`, `README.md`, `PLAN.md`.
- **Next:** Phase 5 starts once the harness is calibrated (1F). The owner creates the GitHub App then.

## 2026-10-05 · Phase 1 · regression-guardian (skip renders when the runtime is untouched)
- **Did:** `current-games` no longer builds two runtimes and renders every live game for a change
  that cannot reach one. `prepare` reads the diff against the harness's own base and classifies it
  with `scripts/current-games/lib/touched.mjs`: the inputs are `apps/lines` and every workspace
  package it reaches (computed from the package graph, not listed), the root build files, what the
  gates read (`scripts/`, `services/test-server/`, the launcher's game-config defaults) and the
  workflow itself; docs are never inputs. No input changed ⇒ success from `prepare` alone, before
  the secrets check, so a launcher, atlas-tool or director-worker PR is not held by the missing
  secrets or by harness noise. An undecidable diff renders everything. The docs-only step is folded
  into the same classification, and on a push it now diffs against the merge-base rather than
  `event.before`, so a docs commit pushed onto an engine branch still renders.
- **Files:** `scripts/current-games/{lib/touched.mjs,touched.fixture.mjs,lib/gates.mjs}`,
  `.github/workflows/current-games.yml`, `docs/playtest/current-games.md`, `docs/status/engine.md`,
  ADR-0004 (amendment, proposed), `docs/director/{PLAN,OPEN_QUESTIONS}.md`.
- **Branch / PR:** `claude/amazing-cori-an3axf`.
- **Tests:** `touched.fixture.mjs` (auto-run by `check:all`): the closure equals pnpm's graph, every
  gate's command names only inputs, one verdict per kind of path, and the CLI's outputs. Replayed on
  merged PRs: #1046 and #1043 skip; #1044 (lockfile) and #1055 (harness) render.
- **Decisions:** "untouched" is decided by inputs, never by output hashes: a build to prove a bundle
  identical costs the build the skip is meant to save. The rule only ever skips, never widens.
- **Next:** 1F calibration still needs the secrets and a live run; this change makes the gate green
  meanwhile for the cards that cannot affect it.

## 2026-10-05 · Phase 1 · coordinator
- **Did:**
  - Recorded #1044 (3A, `director-worker`; the service is deployed and healthy), #1046 (2C, Atlas
    Maker adapters), #1054 (a harness fix) and #1055 (secret redaction in the harness).
  - The owner rotated `PIPELINE_CI_TOKEN` after #1055 found a secret value in a commit status.
    **Closed.**
- **Found:** the first harness run on the live games gave 6 pass · 7 fail · 8 not rendered · 10
  changed screens, on a CI-only change. This is harness noise, to be calibrated in card 1F.
- **Branch / PR:** `claude/upbeat-feynman-pwgx6a`, Invisible-Wall-SL/Invisible-Engine#1045.
- **Next:**
  - 1F: calibrate the harness on the live games, then make `current-games` required.
  - 2D, 3B and 3C.

## 2026-10-05 · Phase 1 · regression-guardian (current-games secret redaction)
- **Did:** The `current-games` status description published a secret's raw value on #1046 (`Failed to parse URL from <value>`: a token sat in `PIPELINE_GAMES_URL`, and undici quotes a bad URL). GitHub masks logs only, so every status/step-summary/report text now goes through `scripts/current-games/lib/redact.mjs` (secret values → `***`, plus a hex/base64 backstop), and `listGames` rejects a non-https `PIPELINE_GAMES_URL` with a fixed message.
- **Files:** `scripts/current-games/{run.mjs,redact.fixture.mjs,lib/{redact,report,games}.mjs}`, `.github/workflows/current-games.yml`, `docs/playtest/current-games.md`
- **Branch / PR:** `claude/current-games-redact-secrets`.
- **Tests:** `redact.fixture.mjs` (auto-run by `check:all`); two mutants (no report redaction, no URL check) both fail it.
- **Next:** owner — rotate the exposed value (most likely `PIPELINE_CI_TOKEN`: launcher env + GitHub secret) and set `PIPELINE_GAMES_URL` to the launcher's `/api/pipeline/games` URL.

## 2026-10-04 · Phase 1–3 · coordinator (recording #1040–#1043, #1044 in review)
- **Did:**
  - Recorded the merges of card D (#1040), card E (#1041), card 2A (#1042) and card 2B (#1043).
  - Card 3A (#1044) is in review.
  - Adopted the defaults the cards proposed (OPEN_QUESTIONS).
  - Drafted ADR-0007 (pipeline-change mechanics) as proposed.
- **Found:** the `current-games` harness has **never run on the live games**. Its 5 secrets are
  missing, so every PR shows `current-games` red for that reason only.
  - #1042 and #1043 merged before the gate could run.
  - Neither touches the runtime or a published game: #1042 is launcher adapters plus a projects
    column, #1043 is atlas-tool. The risk is low, but it is not proven.
  - Once the secrets exist, the first run on `main` covers them.
- **Files:**
  - `docs/director/{HISTORY,PLAN,OPEN_QUESTIONS}.md`
  - `docs/director/DECISIONS/0007-pipeline-change-mechanics.md`
  - `docs/director/README.md` (ADR index)
- **Branch / PR:** `claude/upbeat-feynman-pwgx6a`.
- **Tests:** none; docs only.
- **Decisions:** ADR-0007 proposed.
- **Next:**
  - The owner adds the 5 harness secrets and sets the Railway env vars.
  - Run the harness on `main`, then make `current-games` a required check.
  - Cards 2C/2D now; 3B–3D after #1044 merges.

## 2026-10-04 · Phase 2 · atlas-python-tools (Card 2B, #1043)
- **Did:**
  - Still renders are now queued and resumable, like `video_runner`: R2 job records under
    `<C>/<P>/_jobs/still/<jobRef>/`, a lease per render, boot adoption, and a lost job re-queued
    once.
  - `/render` returns a `jobRef`, and `/progress?jobRef=` reports it.
  - An optional HMAC completion callback (`ATLAS_CALLBACK_SECRET`) is redelivered at boot.
  - The Atlas Maker page is unchanged.
- **Files:**
  - `services/atlas-tool/{still_jobs.py,test_still_jobs.py,batch_atlas.py,ui_server.py}`
  - `docs/status/atlas-maker.md`
  - `docs/INFRA.md`
- **Branch / PR:** `claude/determined-dijkstra-ightsd`, Invisible-Wall-SL/Invisible-Engine#1043.
- **Tests:** test_still_jobs 22 fixtures; check:python atlas-tool 37/37.
- **Decisions:**
  - Regions that were never submitted are not resumed at boot. The render closes `failed` with a
    count, and the Director watcher re-queues those regions.
  - The callback is delivered at least once; the receiver de-duplicates on `jobRef`.
- **Next:** set `ATLAS_CALLBACK_SECRET` on atlas-tool and the launcher. The 2C adapter mints
  callback tokens and verifies signatures.

## 2026-10-04 · Phase 2 · director-backend (Card 2A, #1042)
- **Did:**
  - Added the adapter gate `POST /api/director/adapter/<tool>/<op>`:
    - `DIRECTOR_SERVICE_TOKEN`
    - the run owner's identity
    - `requireProjectScope`
    - a per-agent allow-list
    - `director_ops` idempotency
    - a 409 surfaced as `conflict`
  - Hard refusals by name and by target key.
  - Game Maker adapters: `list_templates`, `get_template`, `create_from_template` (Game Maker's
    duplicate path, scope `full`, config ETags recorded on the run) and `get_project`.
  - An Admin › Projects "Director template" flag, for published projects only.
- **Files:**
  - `apps/launcher-api/src/lib/server/director/*`
  - `duplicateProject.ts`, `tokensMatch.ts`
  - migration 0021
  - `routes/api/director/adapter/[tool]/[op]`
  - `scripts/check-director-adapters.ts`
  - docs
- **Branch / PR:** `claude/lucid-wright-1w7bb8`, Invisible-Wall-SL/Invisible-Engine#1042.
- **Tests:** check:director-adapters 146/146, mutation-tested; launcher gates 336.
- **Decisions:**
  - `director_runs` was a stub, since extended by 3A.
  - A `worker` identity covers ops that run outside any model turn.
  - Region counts are per atlas.
- **Next:** 2.4 Atlas Maker adapters and 2.6 other adapters on this registry.

## 2026-10-04 · Phase 1 · regression-guardian (Card E, #1041)
- **Did:** Built the current-games harness:
  - screen scripts for six game types (12–14 screens each, one `draw:'every'` canary per type)
  - a runner that builds both runtimes, reads snapshots read-only from R2, serves them through the
    real test server's local mode, compares with pixelmatch under `tolerance.json`, and writes a
    JSON + HTML report with stable diff ids
  - `current-games.yml` (6 shards, a `current-games` status)
  - a `WIN_X` mock force for big-win tiers (`check:win-x`)
- **Files:**
  - `scripts/current-games/**`
  - `.github/workflows/current-games.yml`
  - the mock RGS scripts
  - `docs/playtest/current-games.md`
  - `docs/INFRA.md`
- **Branch / PR:** `claude/peaceful-brahmagupta-ftqbok`, Invisible-Wall-SL/Invisible-Engine#1041.
- **Tests:**
  - Stand-in fixtures: main vs main gave 108/108 byte-identical screens, twice.
  - The 1 px proof flagged exactly the 6 affected screens, and its revert was green.
  - **Not yet run on the live games:** the secrets are missing.
- **Decisions:**
  - The tolerance starts at zero measured noise.
  - Rows that weren't rendered never count as a pass and don't fail the run.
  - Desktop-built games get build + tests only.
- **Next:** the owner adds the secrets; the first live run; then make the check required.

## 2026-10-04 · Phase 1 · platform-integrator (Card D, #1040)
- **Did:**
  - Added `pricing.json` (with RunPod placeholders) and an `app_settings` override.
  - Added the pure `costOfUsage`.
  - Added the `director_spend` ledger (migration 0020).
  - Added the `anthropicAgents` provider: card and monthly column, with `INCLUDED_IN` so spend
    isn't counted twice.
  - Added `DIRECTOR_RUN_BUDGET_USD` (default 25, $1–$500) with a Settings card.
- **Files:**
  - `services/director-worker/pricing.json`
  - `apps/launcher-api/src/lib/server/costs/*`
  - `appSettings.ts`
  - schema + 0020
  - the admin page
  - `check-director-costs.ts`
  - docs
- **Branch / PR:** `launcher/director-costs-budget`, Invisible-Wall-SL/Invisible-Engine#1040.
- **Tests:** check:director-costs 10/10; lint; svelte-check at baseline; migrations applied on a
  fresh PG16.
- **Decisions:** each call is priced when it is written; the agents card counts `claude` rows only.
- **Next:** 3.7 writes ledger rows from the worker.

## 2026-10-04 · Phase 1 · coordinator (recording #1035–#1038)
- **Did:** Recorded the merges of cards A, B and C, plus #1038, a follow-up fixing two problems that card C found. Adopted the default answers to the cards' open questions; see OPEN_QUESTIONS.
- **Files:** `docs/director/{HISTORY,PLAN,OPEN_QUESTIONS}.md`
- **Branch / PR:** `claude/upbeat-feynman-pwgx6a` (restarted from main).
- **Tests:** none; docs only.
- **Decisions:** card E uses `draw:'last'`. A stall or error fails the game. Games run pinned to UTC/en-US. A game with no snapshot reports "not rendered", never a silent pass.
- **Next:** card E (harness). Phase 2/3 cards in parallel; they merge only once the harness exists.

## 2026-10-04 · Phase 1 · platform-integrator (Card C, #1037)
- **Did:**
  - Registered `director` in Create and `pipelineChanges` in a new Pipeline stage (#f778ba), with icons in `TOOL_ICONS` and all 4 toolbar twins.
  - Added a `ToolDef.isNew` "new" tag.
  - Added the `pipelineMerge` capability (Admin only). Pipeline Tester gets `pipelineChanges` by default.
  - Added early-access `/director` and `/pipeline` pages (full width, ToolTopBar, 403 gate).
  - Wrote both tool guides.
- **Files:**
  - `apps/launcher-api/src/lib/roles.ts`
  - `(app)/+page.svelte`, `(app)/admin/*`, `(app)/director/*`, `(app)/pipeline/*`
  - `scripts/check-director-access.ts`
  - the toolbar twins
  - `docs/tools/{director,pipeline-changes,README,launcher}.md`
  - `docs/status/launcher.md`
- **Branch / PR:** `launcher/director-registry`, Invisible-Wall-SL/Invisible-Engine#1037. Follow-up: Invisible-Wall-SL/Invisible-Engine#1038 fixes `vite dev` for `engine-fx` and formats three launcher files.
- **Tests:**
  - check:director-access 29/29
  - check:toolbar-icons, check:launcher-gates 332: pass
  - lint clean; check:svelte at baseline 53; build OK
- **Decisions:** The page gate uses the parent-manifest 403 (the comfyui pattern), because neither page is project-scoped. "new" is a manual flag.
- **Next:** card D; the pages get filled in Phases 4 and 5.

## 2026-10-04 · Phase 1 · regression-guardian (Card B, #1036)
- **Did:** Added a test-only determinism mode, `?ie_determinism=<seed>`, to the shared runtime:
  - a virtual clock driving rAF, timers, `performance.now`, `Date` and CSS/Web Animations
  - a seeded `Math.random`
  - a per-frame I/O gate
  - `window.__IE_DETERMINISM__`, with `step`, `waitFor`, `state` and the `draw:'last'` fast mode
  - With the flag off, nothing changes.
- **Files:**
  - `apps/lines/src/game/determinism.ts`
  - `apps/lines/src/hooks.client.ts`
  - `apps/lines/src/components/Game.svelte`
  - `packages/config-svelte/index.js`
  - `scripts/playtest/determinism-proof.mjs`
  - `docs/status/engine.md`
- **Branch / PR:** `engine/determinism-hook`, Invisible-Wall-SL/Invisible-Engine#1036.
- **Tests:**
  - 2 runs × 4 scenarios (base spin, line win, big win, Hold and Win Classic): 20/20 captures byte-identical in both draw modes.
  - check:all 331/331; lint and svelte-check at baseline.
- **Decisions:** The hook lives in the page, because CDP virtual time showed 0.5–24.6 % noise between two runs of main. The flag ships ungated in the player bundle.
- **Next:** card E builds on `__IE_DETERMINISM__` and `determinism-proof.mjs`. A runtime release is needed after this merge.

## 2026-10-04 · Phase 1 · platform-integrator (Card A, #1035)
- **Did:** Added `GET /api/pipeline/games`.
  - It is gated by a bearer `PIPELINE_CI_TOKEN` compared in constant time: 401 for a wrong or missing token, 503 when the token is unset, no session fallback.
  - It is read-only. It returns `listGames()` joined to live projects, with `publishedPointerKey` and `hasOwnBuiltBundle`, and never a `readToken`.
  - `publishedPointerKey` moved into `projectPaths.ts`.
- **Files:**
  - `apps/launcher-api/src/routes/api/pipeline/games/+server.ts`
  - `src/lib/server/pipelineGames.ts`
  - `scripts/check-pipeline-games.ts`
  - `docs/INFRA.md`
- **Branch / PR:** `claude/compassionate-maxwell-z5h9ba`, Invisible-Wall-SL/Invisible-Engine#1035.
- **Tests:** check:pipeline-games 35/35; check:launcher-gates 330/330; check:published-runtime 37/37; svelte-check at baseline.
- **Decisions:** Global (project-less) games stay in the list with null project fields. The pointer key is computed, not probed.
- **Next:** card E consumes this. The owner sets `PIPELINE_CI_TOKEN` on the launcher and as a GitHub secret.

## 2026-10-04 · Phase 0 → 1 · coordinator
- **Did:**
  - The owner approved Phase 0 ("alright, let's start").
  - ADR-0001…0006 are now `approved` and all open-question defaults are accepted.
  - New working model: each task runs in its own session, started from a task card. This
    coordinator session reviews and records.
  - Issued the Phase 1 task cards.
- **Files:**
  - `docs/director/{README,ARCHITECTURE,OPEN_QUESTIONS,PLAN}.md`
  - `docs/director/DECISIONS/*`
  - `.claude/agents/*` (reporting goes through the PR description)
  - `docs/STATUS.md` (map row)
- **Branch / PR:** `claude/upbeat-feynman-pwgx6a`, Invisible-Wall-SL/Invisible-Engine#1034.
- **Tests:** none; docs only.
- **Decisions:** ADR-0001…0006 approved.
- **Next:** merge #1034 so task sessions start from `main`, then run the Phase 1 cards.

## 2026-10-04 · Phase 0 · coordinator
- **Did:** Applied the owner's feedback on "looks the same".
  - Tolerance is now a tunable config, not a fixed 0.1 %.
  - Intended visual differences can be approved, with before/after shown for each one.
  - Agents are told to propose improvements and not hold back.
- **Files:**
  - `docs/director/DECISIONS/0004-current-games-regression-harness.md`
  - `docs/director/OPEN_QUESTIONS.md` (Q7 moved to Answered)
  - `.claude/agents/regression-guardian.md`
- **Branch / PR:** `claude/upbeat-feynman-pwgx6a`, Invisible-Wall-SL/Invisible-Engine#1034.
- **Tests:** none; docs only.
- **Decisions:** ADR-0004 revised. It is still proposed.
- **Next:** owner approval of the remaining ADRs and defaults.

## 2026-10-04 · Phase 0 · coordinator
- **Did:** Added `02-director-new-game.html` from the owner. All six screens now have both a PNG and an HTML file. Closed the mockup-gaps question.
- **Files:**
  - `docs/director/mockups/02-director-new-game.html`
  - `docs/director/README.md`
  - `docs/director/OPEN_QUESTIONS.md`
- **Branch / PR:** `claude/upbeat-feynman-pwgx6a`, Invisible-Wall-SL/Invisible-Engine#1034.
- **Tests:** none; docs only.
- **Decisions:** none.
- **Next:** owner approval of ADR-0001…0006 and the open-question defaults, then Phase 1.

## 2026-10-04 · Phase 0 · coordinator
- **Did:** The owner re-sent the mockups. I added the Live run screenshot, which was the missing PNG. The other four were identical to the committed files.
- **Files:**
  - `docs/director/mockups/04-director-live-run.png`
  - `docs/director/README.md` (mockup table)
  - `docs/director/OPEN_QUESTIONS.md` (Q10)
- **Branch / PR:** `claude/upbeat-feynman-pwgx6a`, Invisible-Wall-SL/Invisible-Engine#1034.
- **Tests:** none; docs only.
- **Decisions:** none.
- **Next:** owner review of Phase 0. Only `02-director-new-game.html` is still missing.

## 2026-10-04 · Phase 0 · coordinator
- **Did:**
  - Explored the platform. The findings and their file paths are in ARCHITECTURE §1.
  - Created the project docs, the six build agents and the seven runtime-agent drafts.
  - Added a project section to the root CLAUDE.md.
  - Proposed ADR-0001…0006.
- **Found:** three ways the brief differs from the code (OPEN_QUESTIONS Q1–Q3):
  - Game Maker writes no git: a project is a DB row plus an R2 tree.
  - The "templates" are ordinary sample projects.
  - The platform has no math-lock concept.
- **Files:**
  - `docs/director/{README,SPEC,ARCHITECTURE,PLAN,HISTORY,OPEN_QUESTIONS}.md`
  - `docs/director/DECISIONS/0001…0006`
  - `docs/director/mockups/*`: the owner's files, added as provided. `02` has no HTML and `04` has no PNG.
  - `docs/director/KICKOFF_PROMPT.md`
  - `.claude/agents/{director-architect,platform-integrator,director-backend,director-frontend,regression-guardian,historian}.md`
  - `services/director-worker/agents/*.md`
  - `CLAUDE.md`, with a section appended.
- **Branch / PR:** `claude/upbeat-feynman-pwgx6a`, draft PR.
- **Tests:** docs and agent definitions only. No code changed, so there are no tests to run.
- **Decisions:** ADR-0001 to ADR-0006, all proposed.
- **Next:** owner review. Then Phase 1, starting with branch `pipeline/current-games-harness`.
