# Invisible Playtester — automated play-test → detect → fix, per project

**Status:** design registered 2026-07-21. Phase 1 (agent brain) BUILT; Phases 2–3 (launcher card
+ agent-runner backend) unbuilt. Build plan below.
**Owner ask:** "an Agent to test the game, that I can instruct on how to play, that reports errors
and bugs and fixes them — ideally a card in the launcher I can click per project."

## Problem / shape

Two requirements pull in different directions:

- **"A card per project I can click"** → a launcher page, same pattern as `/editor`, `/fx`. Every
  launcher tool today is a `kind: 'online'` SvelteKit route (`apps/launcher-api/src/lib/roles.ts`)
  that reads/writes R2 + Postgres. Adding a card is routine.
- **"Fix + verify live"** (edit engine/game source, rebuild, runtime-release) → needs a **coding
  agent with repo access, git, and a browser** — i.e. Claude Code / the Agent SDK. The cloud
  launcher on Railway has **neither the game source checked out nor a coding-agent runner**. So
  the launcher cannot do the "fix" half by itself.

The two halves therefore live in different places, and the build is phased so the valuable half
(play → detect → fix → verify) ships first, decoupled from the launcher plumbing.

| Capability | Home | Phase |
|---|---|---|
| Play + detect (drive game, collect console/network/math/state/scene bugs) | Claude Code subagent now; launcher card later | 1 / 2 |
| Fix + verify live (edit source, rebuild, runtime-release) | Coding agent (Claude Code today; Agent-SDK worker later) | 1 / 3 |

## Phase 1 — the agent "brain" (BUILT)

A Claude Code subagent, `.claude/agents/game-playtester.md`, driven by a per-project **playbook**
in `docs/playtest/<game>.md` (`docs/playtest/README.md` documents the format; `docs/playtest/lines.md`
is the worked example). Invoked from a Claude Code session, it already has everything the launcher
lacks — repo, git, browser preview, build — so it delivers the **full play → detect → fix → verify
→ runtime-release loop today**, per project.

Detection is text-based and trustworthy (console/network errors, book-vs-render money math, XState
+ flow state, `app.stage` assertions). Visual-polish judgement is explicitly out of scope: WebGPU
screenshots time out and the preview ticker freezes when backgrounded, so those are reported as
**human-eyes**, never pass/fail. See the agent file for the full capability/limit list and the
trap list (baked-data masking, silent stale-baked fallback, frozen ticker).

This phase is the reusable engine. Phases 2–3 are just triggers that call the same playbook.

## Phase 2 — `/playtest` launcher card (report-only)

A per-project card at `/playtest`, in the launcher registry (`roles.ts`: `TOOLS` / `ROLE_TOOLS` /
`TOOL_BAR_ORDER` / `TOOL_DOC_SLUG`), with a `docs/tools/playtest.md` guide (rule 9). Scope: the
active client/project, same selector as the other tools.

What it does **without** a coding agent:
- Kicks off a **headless play-through** of the project's live game (the generic runtime at
  `/api/editor/runtime`, driven by a Playwright-style headless browser in a Railway worker or a
  serverless function), running the project's playbook scenarios.
- Collects the same text signals (console, network, book-vs-render, stage graph) and writes a
  **bug report** to R2 (`<client>/<project>/playtest/report-<ts>.json`).
- Renders the latest report in the card: pass/fail per scenario, evidence, and a **human-eyes**
  queue with sampled frames.

This is a normal tool: a route, an endpoint, an R2 doc, a scoped auth-gate. It reports; it does
not fix. Playbooks would move from `docs/playtest/` into R2 per project so a non-developer can
edit "how to play" in the card.

## Phase 3 — wire the card to the fix loop (the infra piece)

Make the card's button actually **fix**. The card enqueues a job; an **Agent-SDK worker** with a
repo checkout (or a per-run git worktree) runs the Phase-1 playbook, fixes on a branch, verifies
live, and opens a PR / prepares a runtime release. The card streams progress and links the PR.

This is the real project: a persistent worker (or a triggered cloud Claude Code run — cf. the
scheduled-agents/routines mechanism), repo + git write creds held server-side, branch/PR policy so
an automated fix never lands on `main` unreviewed, and a budget/authority setting per project
(report-only · fix-on-branch · fix+release). Engine-extensibility and no-hardcoding rules still
bind the fixer.

## Open questions (decide before Phase 3)

1. **Where does the worker run?** Railway service with the repo baked in vs. a triggered ephemeral
   Claude Code run per request. Trade-off: warm-repo latency vs. isolation/cost.
2. **Fix authority per project.** A stored setting (report-only / branch / release) rather than a
   global — mirrors the Game Maker "admin-only for now, widen later" caution.
3. **Playbook home.** `docs/playtest/*.md` (developer-owned, in-repo) vs. R2 per project
   (author-editable in the card). Likely both: repo template → seeded into R2 on project create.
4. **Headless render fidelity.** The runtime boots under WebGPU; confirm the headless browser
   renders it (or forces the WebGL fallback) before trusting scene-graph assertions in the cloud.

## Related
- `.claude/agents/game-playtester.md` (Phase 1), `docs/playtest/` (playbooks),
  `docs/status/playtester.md` (state).
- Foundations: `docs/design/invisible-game-maker.md` (the generic runtime the card would drive),
  `docs/design/invisible-debug-framework.md` (`__IE_DEBUG__` affordances the agent uses).
