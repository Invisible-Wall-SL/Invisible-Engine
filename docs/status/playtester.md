# Invisible Playtester — status

> Design: [docs/design/invisible-playtester.md](../design/invisible-playtester.md) · Playbooks: [docs/playtest/](../playtest/README.md) · Agent: [.claude/agents/game-playtester.md](../../.claude/agents/game-playtester.md)

**One-line state:** Phase 1 shipped — the `game-playtester` subagent + playbooks for `lines`,
`borut-remake` and `ways`, invoked from a Claude Code session. Since 2026-09-28 a headless
real-clock drive (GPU headless shell, 60 fps) runs live games unattended, so the
frozen-rAF limit no longer blocks spins. Phases 2–3 (a `/playtest` launcher card + an Agent-SDK
fix-worker) are designed, not built.

## Current state

- **Agent brain (Phase 1)** — `.claude/agents/game-playtester.md`. Drives a game via the browser
  preview (`preview_start` on a [.claude/launch.json](../../.claude/launch.json) config), detects
  bugs from text signals (console/network errors, book-vs-render money math, XState + flow state,
  `app.stage` assertions), and with fix authority fixes on a branch, re-verifies live, and ships
  engine changes via the runtime release. Granted the browser-preview MCP
  tools plus Glob/Grep/Read/Edit/Write/Bash.
- **Playbooks** — `docs/playtest/README.md` (format) + `lines.md` (the reference Book-of build:
  boot-clean, spin math, free-spin trigger + run, bet/affordance, symbol-state grid, S7 resume of
  an open round), `borut-remake.md` (the live online remake: Claude-in-Chrome and headless
  real-clock drive paths, owner-triaged dispositions) and `ways.md` (a ways server + client, with
  the `WIN_MODEL=ways` mock). One file per game; add a launch config for games outside this repo.
- **Three drive paths** — the Browser preview pane (boot + static render + source-import actor on
  a dev build; its tab is hidden, so rAF is frozen), Claude-in-Chrome (foreground, needs a visible
  tab) and the headless real clock (Playwright's headless shell over a CDP pipe with GPU flags,
  one launch shared by `scripts/playtest/*`; worked script
  `scripts/playtest/win-countup-repro.mjs`, exits 1 on a count-up stall). It runs in a Claude Code
  cloud container too, in software; setup and caveats are in
  [the headless real clock](../playtest/README.md#the-headless-real-clock). A stall seen only
  under a hand-stepped clock is unconfirmed until it reproduces on the real clock.
- **Honest limits are encoded** — no visual-polish pass/fail; those are reported as
  **human-eyes**. Trap list (baked-data masking, silent stale-baked fallback, frozen ticker) is in
  the agent file.

## Open items / next
1. **Phase 2 — `/playtest` launcher card (report-only).** Registry entry + route + headless
   play-through worker + R2 bug-report doc + `docs/tools/playtest.md` guide. Playbooks move to R2
   per project so non-developers can edit "how to play".
2. **Phase 3 — wire the card to the fix loop.** Agent-SDK worker with repo/git creds runs the
   playbook, fixes on a branch, opens a PR / preps a runtime release. Needs the open questions in
   the design doc decided (worker home, per-project fix authority, headless render fidelity).
3. **Grow the `lines` and `borut-remake` playbooks** as scenarios surface; convert each fixed bug
   into a permanent regression scenario.

## 2026-07-21 — full live checklist run of the Borut remake (via Claude-in-Chrome)
Tiled-windows side-by-side kept the tab `visible` for a continuous ~20-min run covering the whole
checklist. **PASS:** balance re-sync on first live spin (stale-client vs restarted-mock theory
confirmed), payline win amounts = paytable×betPerLine, full free-spin flow + credit, win-count-up
skippability (tap fast-forwards), boot/look coherence, and Spin/Bet±/Auto/BuyFeature buttons.
**Findings + owner triage:** retrigger "+10 fs" overlay absent = **by design** (residual: a
`freeSpinRetrigger` console error still fires — optional no-op handler to silence); mid-round
refresh crash (`undefined.balance`) = **test-env artifact, deprioritized**; Menu button inert =
**known, submenu not built**; buy-feature copy off-theme = open content task; `paylines: ? declared`
= cosmetic. All dispositions recorded in `docs/playtest/borut-remake.md` so the agent won't re-flag
the by-design/known items. Couldn't verify: rigorous paylineId-vs-drawn-line (game fetch un-hookable
without a source-map build), loading-bar fill, turbo effect, fullscreen — human-eyes/blocked.

## ⏳ Live-verify
- Play→detect loop **exercised** on `lines` (2026-07-21 smoke run): `window.__PIXI_APP__` handle,
  `gameActor.send` spin path, and book-vs-render money math all confirmed; harness gaps found +
  folded into `docs/playtest/lines.md` (mock-RGS wiring, deterministic `BIG_WIN`/`FORCE_TRIGGER`
  levers, human-eyes for animation/idle-return).
- **Not yet exercised:** a full fix run (agent finds a real bug → fixes on a branch → re-verifies
  live → runtime-release). Animation timing and return-to-idle are now observable on the headless
  real clock; visual polish stays human-eyes.

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

## Driving spins on a FLOW-DRIVEN online game — use Claude-in-Chrome (SOLVED 2026-07-21)
The Browser preview pane backgrounds its tab (`document.hidden`), freezing rAF; a built online game
has no source-import actor and its spin-ready state is rAF-gated, so **spins can't be fired in the
Browser pane** (only boot + static render). **Fix: drive the game in the FOREGROUND real browser via
the Claude-in-Chrome MCP** — the `game-playtester` agent now has those tools + the escalation rule.
Confirmed working on the Borut remake: tap-to-start, base spins, BUY FEATURE, full free-spin round.
**Caveat:** Chrome throttles rAF on a hidden tab, so the game **pauses whenever its tab loses
visibility** — the user must keep the game tab visible (side-by-side) for the whole run, and a
"stuck" round is usually just `document.visibilityState==='hidden'`, not a bug. The unattended
gap is closed by the headless real-clock path (2026-09-28, see Current state).

## Recent changes
- 2026-10-02 — **The headless real clock runs in a Claude Code cloud container.** The scripts
  looked only for `chrome-headless-shell`. The cloud image ships `headless_shell` and runs as root,
  where Chromium needs `--no-sandbox`. Sessions there reported "the game never reaches idle",
  which was the harness, not the engine (found by pots-overlay Phase 4).
  `scripts/playtest/headless-shell.mjs` is now the one launch for `win-countup-repro.mjs` and
  `host-settings-probe.mjs`: either name, the sandbox flag only as root, and the shell's stderr on
  an early exit. The GPU flags are unchanged; on Windows the play run still reaches idle at 60 fps.
  Verified in a cloud container (uid 0, `chromium_headless_shell-1194/chrome-linux/headless_shell`):
  `win-countup-repro.mjs` booted to idle in 9–18 s at 4–6 fps and played a big-win count-up back to
  idle with no stall, exit 0. The same shell started without `--no-sandbox` refuses to run as root.
  The caveat lives in [the headless real clock](../playtest/README.md#the-headless-real-clock).
- 2026-09-28 — **Live check of #807/#810 on the headless real clock** (#836): `bookofborutremake`
  passes (intro holds and releases on tap, book reveal, two-stage outro tap, idle with credit).
  `test2`–`test6` lost their free-spin intro/outro because they still bind the retired composers;
  affected projects + the migration are in [flow.md](flow.md). `borut-remake.md` gained the
  headless drive path.
- 2026-09-28 — **Real-clock repro tooling** (#808, #809): the reported free-spin big-win count-up
  stall does not reproduce at 60 fps (20/20 count-ups completed) — it was an artefact of
  hand-stepping Svelte's rAF. `scripts/playtest/win-countup-repro.mjs` is the reusable driver;
  `lines.md` documents the real-clock setup and warns against stepping `raf.tasks`.
- 2026-09-28 — `lines.md` S7: a round left open is finished on the next boot (#801, offline gate
  `pnpm check:resume`).
- 2026-09-21 — `ways.md` playbook + `WIN_MODEL=ways` on the standalone mock (#746), so a ways
  round can be scripted locally.
- **2026-07-30 — lines slam-never-skips-a-celebration (verify-only)** — verified the 2026-07-30
  change in `apps/lines/src/game/unskippablePresentation.ts` (`startsCelebration` + `opensCelebration`
  re-arm) and `apps/lines/src/game/utils.ts` (`playBookEvent` passes `startsCelebration(bookEvent)`).
  Boot clean on the flow-v1 path (default local; `getFlowV2()` undefined). Exercised the real
  `roundSkip` singleton in the running build: `startsCelebration` classifies freeSpinEnd / freeSpinRetrigger /
  setWin(big≥6) = true and setWin(small/medium) / reveal / OOB-winLevel = false; `runBookEventPresentation`
  re-arms (un-trips) the token before a big-win/outro/retrigger/updateFreeSpin dispatch and LEAVES it
  tripped for ordinary setWin + reveal; unskippable-depth opens/closes balanced. No defects; the animated
  play-in-full + tap-gate is human-eyes (frozen rAF in the Browser pane — needs foreground Claude-in-Chrome).
- **2026-07-30 — follow-up: slam skips free-spin INTRO during scatter-match (verify-only, PASS)** —
  verified the two-part window-lock fix. `startsCelebration` now returns true for `freeSpinTrigger`
  (re-arm clears an upstream reel-roll slam); `runBookEventPresentation` mirrors unskippable-`depth`
  into `stateUi.unskippablePresentationActive` on the 0↔1 edges (`enterUnskippable`/`exitUnskippable`),
  and `isCelebrationLocked()` ORs `hasUnskippablePresentation()` so the button is `stop_disabled` for the
  WHOLE window (scatter match + intro + book reveal) — before any celebration screen mounts. Live
  cross-module identity proof (spinStop reads the same `state-shared` barrel the game writes): flag TRUE
  during `freeSpinTrigger` + `setExpandingSymbol` dispatch, FALSE before/after, nesting (resume-path
  replay) doesn't clear early; while true `runSpinOrSlamStop({isIdle:false})` early-returns (token NOT
  tripped, no `stopButtonClick`) vs control (flag false → tripped + broadcast); an upstream slam is
  re-armed at `freeSpinTrigger` (token false at dispatch); ordinary `setWin(small)` leaves flag false +
  token tripped; `playBet` finally force-clears the flag (utils.ts:125). Console clean. NOTE: earlier a
  raw `/@fs/.../src/stateUi.svelte.ts` import read a DUPLICATE module instance (all-false) — always read
  `state-shared` state via the BARREL `packages/state-shared/index.ts` to match the game's singleton.
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
  `[engine-facade] paylines: ? declared`). No edits/commits/ship (detect-only).
- 2026-07-21 — **FULL live playtest of `bookofborutremake` via Claude-in-Chrome** (S2/S3 unblocked).
  Verified end-to-end with real clicks + screenshots: tap-to-start → base game; base spin debits the
  exact bet ($52,904.50→$52,903.50, Win $0, RGS `bet` 200); BUY FEATURE debits exactly 100× ($100);
  free-spin round with the expanding special symbol (sheriff), free-spin counter, **retrigger 10→20**,
  win accumulating to ~$36,129 (~36,000×, near max-win), symbol-explosion FX — all rendering correctly.
  **Everything works.** Content bug found: the BUY FEATURE menu tiles show off-theme placeholder copy
  ("SAMURAI SPIN", "mothership Land values") — recorded as a regression guard in the remake playbook.
  Wired the Claude-in-Chrome tools + escalation rule into the agent so it does this automatically next
  time. Round pause at 18/20 was the tab going hidden (visibility throttle), not a bug.
