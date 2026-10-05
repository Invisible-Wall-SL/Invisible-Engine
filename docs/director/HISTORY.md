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
