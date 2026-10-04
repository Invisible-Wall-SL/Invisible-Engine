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
