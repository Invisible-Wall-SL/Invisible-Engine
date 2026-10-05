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

## 2026-10-05 · Phase 1 · regression-guardian (current-games secret redaction)
- **Did:** The `current-games` status description published a secret's raw value on #1046 (`Failed to parse URL from <value>`: a token sat in `PIPELINE_GAMES_URL`, and undici quotes a bad URL). GitHub masks logs only, so every status/step-summary/report text now goes through `scripts/current-games/lib/redact.mjs` (secret values → `***`, plus a hex/base64 backstop), and `listGames` rejects a non-https `PIPELINE_GAMES_URL` with a fixed message.
- **Files:** `scripts/current-games/{run.mjs,redact.fixture.mjs,lib/{redact,report,games}.mjs}`, `.github/workflows/current-games.yml`, `docs/playtest/current-games.md`
- **Branch / PR:** `claude/current-games-redact-secrets`.
- **Tests:** `redact.fixture.mjs` (auto-run by `check:all`); two mutants (no report redaction, no URL check) both fail it.
- **Next:** owner — rotate the exposed value (most likely `PIPELINE_CI_TOKEN`: launcher env + GitHub secret) and set `PIPELINE_GAMES_URL` to the launcher's `/api/pipeline/games` URL.

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
