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
- Play→detect loop **exercised** on `lines` (2026-07-21 smoke run): `window.__PIXI_APP__` handle,
  `gameActor.send` spin path, and book-vs-render money math all confirmed; harness gaps found +
  folded into `docs/playtest/lines.md` (mock-RGS wiring, deterministic `BIG_WIN`/`FORCE_TRIGGER`
  levers, human-eyes for animation/idle-return).
- **Not yet exercised:** a full fix run (agent finds a real bug → fixes on a branch → re-verifies
  live → runtime-release). The frozen-rAF limit means animation/return-to-idle assertions still
  need a solution or stay human-eyes.

## Harness notes (from smoke runs — bake these into the playbook)
- **Browser handle:** `window.__PIXI_APP__` works directly (`__PIXI_DEVTOOLS__.app` is unset in
  the dev `lines` build). Walk the full graph (depth ≥ 12) — pixi-svelte nodes are unlabelled
  (`_Container`), so locate the board/HUD by structure + `Text.text`, not `.label`.
- **The `lines` launch config does NOT wire the mock RGS.** `preview_start {name:'lines'}` boots
  the game but the play4fun facade posts same-origin `/rgs/engine` (vite 404s), so it comes up with
  Balance $0.00, no reel symbols, and a failed request. To play, start the mock manually
  (`PORT=7788 node scripts/mock-rgs-server-book.mjs`, default balance $5000) and load the game with
  `?sessionID=dev&rgs_url=localhost:7788&lang=en&currency=USD&device=desktop`. Then auth 200s,
  Balance shows $5,000.00. **Playbook should either add a `mock-rgs` launch entry or document these
  query params up front.**
- **Drive Spin without canvas clicks:** `import('/src/game/actor.ts').gameActor.send({type:'BET'})`
  (state `idle → bet`, balance debits). Read the money math from the bet POST body (the book:
  `gameEnd.win`, `gameRoundOver.win`, `platform.balance`). The facade's `requestEndRound` is a
  local no-op (no second network call) — both interim + final balance come from the single
  Play4Fun round-trip; can't observe the two-step split on a zero-win.
- **Return-to-idle is NOT observable under automation.** Reel-stop is a `svelte/motion` `Tween`
  (`utils-slots/createReelForSpinning`) on Svelte's own rAF loop; the Browser pane backgrounds the
  tab (`document.hidden`), freezing rAF, so the Tween never completes and the machine parks in
  `bet`. Pumping `app.ticker.update()` advances Pixi's ticker but NOT the Svelte/GSAP rAF clock.
  Money math + book-vs-render are verifiable; the idle-return / animation assertions need a way to
  drive Svelte's rAF (unsolved) or human eyes.

## Structural limit — the Browser pane can't drive spins on a FLOW-DRIVEN game
The preview pane backgrounds the tab (`document.hidden`), freezing rAF. On the local `lines` dev
build we bypassed that with `gameActor.send({type:'BET'})` (source import). On a **built, flow-driven
online game** (the Borut remake) there is NO source import and the spin-ready state is rAF-gated, so
**no spin can be fired in the Browser pane** — only the boot (`__IE_FLOW_V2__.dispatch('tapToStart')`)
and static render are testable. **To exercise spins / free spins / count-up / return-to-idle on such
games, drive them in a FOREGROUND real browser via the Claude-in-Chrome MCP (rAF runs there), or add
a headless-render path.** This is the top harness gap for online-game coverage.

## Recent changes
- 2026-07-21 — Phase 1 built: `game-playtester` subagent + `docs/playtest/` playbook format +
  `lines` starter playbook; design doc + this status registered.
- 2026-07-21 — Smoke run of `lines` S1/S2 (dry run, no fixes): validated the play→detect loop and
  `window.__PIXI_APP__` handle; surfaced the mock-RGS-not-wired harness gap and the frozen-rAF
  return-to-idle limit (see Harness notes). Boot + money-math verified; RGS 404 with default config.
- 2026-07-21 — LIVE detect run of `bookofborutremake` (online generic runtime). **Game healthy + on
  LIVE data** (`__IE_RUNTIME_STALE__` null, runtime 200, "live bundle ready", correct config/balance);
  static board renders real symbols (no placeholders). S1 + static-render PASS; **S2/S3 BLOCKED** by
  the frozen-rAF limit above. Confirmed boot handle `__IE_FLOW_V2__.dispatch('tapToStart')`. Flagged:
  ~15s `/api/editor/runtime` assemble (inside the 502/stale-fallback danger window — cf. game-maker
  status open item 6) and minor boot warnings (duplicate texture/bitmap-font registration;
  `[stake-facade] paylines: ? declared`). No edits/commits/ship (detect-only).
