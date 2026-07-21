# Invisible Playtester — status

> Design: [docs/design/invisible-playtester.md](../design/invisible-playtester.md) · Playbooks: [docs/playtest/](../playtest/README.md) · Agent: [.claude/agents/game-playtester.md](../../.claude/agents/game-playtester.md)

**One-line state:** Phase 1 shipped — the `game-playtester` Claude Code subagent + per-project
playbook format deliver the full play → detect → fix → verify → runtime-release loop today,
invoked from a Claude Code session. Phases 2–3 (a `/playtest` launcher card + an Agent-SDK
fix-worker) are designed, not built.

## Current state

- **Agent brain (Phase 1)** — `.claude/agents/game-playtester.md`. Drives a game via the browser
  preview (`preview_start` on a [.claude/launch.json](../../.claude/launch.json) config), detects
  bugs from text signals (console/network errors, book-vs-render money math, XState + flow state,
  `app.stage` assertions), and with fix authority fixes on a branch, re-verifies live, and ships
  engine changes via the runtime release + game-submodule bump. Granted the browser-preview MCP
  tools plus Glob/Grep/Read/Edit/Write/Bash.
- **Playbooks** — `docs/playtest/README.md` (format) + `docs/playtest/lines.md` (worked example
  for the reference Book-of build: boot-clean, spin math, free-spin trigger + run, bet/affordance,
  symbol-state grid). One file per game; add a launch config for games outside this repo.
- **Honest limits are encoded** — no visual-polish pass/fail (WebGPU screenshot timeout + frozen
  preview ticker); those are reported as **human-eyes**. Trap list (baked-data masking, silent
  stale-baked fallback, frozen ticker) is in the agent file.

## Open items / next
1. **Phase 2 — `/playtest` launcher card (report-only).** Registry entry + route + headless
   play-through worker + R2 bug-report doc + `docs/tools/playtest.md` guide. Playbooks move to R2
   per project so non-developers can edit "how to play".
2. **Phase 3 — wire the card to the fix loop.** Agent-SDK worker with repo/git creds runs the
   playbook, fixes on a branch, opens a PR / preps a runtime release. Needs the open questions in
   the design doc decided (worker home, per-project fix authority, headless render fidelity).
3. **Grow the `lines` playbook** and add `borut.md` as scenarios surface; convert each fixed bug
   into a permanent regression scenario.

## ⏳ Live-verify
- End-to-end Phase-1 run (agent drives `lines`, finds a seeded bug, fixes + re-verifies) not yet
  exercised — owner to trigger the agent on a real target to shake out the browser-driving handles.

## Recent changes
- 2026-07-21 — Phase 1 built: `game-playtester` subagent + `docs/playtest/` playbook format +
  `lines` starter playbook; design doc + this status registered.
