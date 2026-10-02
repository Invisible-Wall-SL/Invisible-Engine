# Playtest — lines (reference Book-of build)

Starter playbook for the canonical dev build. Expand it as scenarios are found; turn every fixed
bug into a permanent regression scenario here.

## Launch (do this exactly — a bare `preview_start` boots a broken $0 / RGS-404 game)

The `lines` dev server is just vite; it does NOT start the mock RGS, and the play4fun facade needs
`sessionID` + `rgs_url` query params or it posts to same-origin `/rgs/engine` (vite 404s → Balance
$0.00, no reel symbols, failed request). So:

1. **Start the mock RGS** (Bash, `run_in_background: true`) — book-of variant, port 7788,
   start balance $5000:
   ```
   PORT=7788 node scripts/mock-rgs-server-book.mjs
   ```
   Useful env levers (prepend to the command) — this is how you force outcomes deterministically:
   - `BIG_WIN=1` → the next base spin is a top-tier win (use for **S2** non-zero math).
   - `FORCE_TRIGGER=1` → every base play triggers the free-spin bonus (use for **S3/S4**).
   - `START_BALANCE=500000` (cents), `SEED=<anything>` for repeatability.
2. **`preview_start { name: 'lines' }`** (port 3001).
3. **`navigate`** to the game WITH the params:
   `http://localhost:3001/?sessionID=dev&rgs_url=localhost:7788&lang=en&currency=USD&device=desktop`
   → auth POST returns 200, Balance shows **$5,000.00**. Now the game is playable.

Build is dev / `__IE_DEBUG__` on — `SymbolDebugOverlay` + `d` hotkey + `registerDebugTool` tools
available.

## Driving the game (confirmed handles — use these, not canvas clicks)

- **Pixi app:** `window.__PIXI_APP__` (NOT `__PIXI_DEVTOOLS__`, unset here). Walk the stage graph to
  depth ≥ 12; pixi-svelte nodes are **unlabelled** (`_Container`) — locate the board/HUD by
  structure + `Text.text` (`Balance`, `Win`, `Bet`, `MENU`, `BUY BONUS`, …), not `.label`.
- **Spin / actions:** `read_page` + `computer` clicks do NOT work (the controls live inside the
  WebGPU canvas with no accessibility refs). Drive the state machine directly:
  `(await import('/src/game/actor.ts')).gameActor.send({ type: 'BET' })` → `idle → bet`, balance
  debits. Read the money math from the **bet POST response body** (the book: `bet.total`,
  `gameEnd.win`, `gameRoundOver.win`, `platform.balance`).
- **`requestEndRound` is a local no-op** (no second network call) — interim + final balance both
  come from the single Play4Fun round-trip; the two-step split can't be observed on a zero-win.
- **Animation completion / return-to-idle is NOT observable in the Browser pane** → there, treat it
  as **human-eyes**, never FAIL it. Reel-stop is a `svelte/motion` Tween on Svelte's rAF loop; the
  pane backgrounds the tab (`document.hidden`), freezing rAF, so the machine parks in `bet`.
  Pumping `app.ticker.update()` advances Pixi's ticker but not the Svelte rAF clock — and do NOT
  step Svelte's `raf.tasks` by hand to get past it: a stepped clock manufactured a count-up "stall"
  that a real clock never shows (2026-09-28, `docs/status/engine.md`). Claude in Chrome is `hidden`
  at 0 fps too unless the owner's Chrome window is in front.
- **A real frame clock under automation:** `node scripts/playtest/win-countup-repro.mjs` drives
  Playwright's headless shell over a CDP pipe with the GPU on — `visible`, focused, **60 fps**
  (setup, software frame rates and running as root:
  [the headless real clock](README.md#the-headless-real-clock)) — with trusted clicks, and watches
  every `setWin` count-up read-only; it exits 1 on a stall. `--mode recon` just boots and reports
  fps; `--accel` puts the count-up on its accelerated path, `--tap` (implies `--accel`) adds a
  hold + taps inside each big win. Its header has the servers it needs and the options; use it as
  the template for any other real-clock check (the spin button `BET` is at (749, 755) in its
  1456×814 viewport).

## Scenarios

### S1 — Boot clean
- **Do:** run the Launch sequence above; wait for idle.
- **Expect:** auth POST to `localhost:7788/rgs/engine` 200; **Balance $5,000.00**; no `error`
  console lines (a `/favicon.ico` 404 + a `<svelte:self>` deprecation warning are benign); reels +
  HUD nodes present in the stage graph.

### S2 — Single base-game spin (money math)
- **Force:** start the mock with `BIG_WIN=1` for a known non-zero win.
- **Do:** `gameActor.send({ type: 'BET' })`; capture the bet POST response.
- **Expect:** state `idle → bet`, balance debited by the stake; rendered **Balance / Win / Bet**
  equal what the returned **book** dictates (`platform.balance`, `gameEnd.win`/`gameRoundOver.win`,
  `bet.total`). Math must match the book exactly. No uncaught exceptions.
- **human-eyes:** the count-up animation and return-to-idle.

### S3 — Book / scatter triggers free spins
- **Force:** start the mock with `FORCE_TRIGGER=1`.
- **Do:** fire a base spin.
- **Expect:** the trigger response stays OPEN (no `gameRoundOver`) and carries `spinTrigger` +
  `enterBonus` + the special expanding symbol (`pickRandomly`); `stateGame.specialSymbol` set;
  the free-spin counter appears with the correct count.

### S4 — Free-spin round runs to completion
- **Do:** with `FORCE_TRIGGER=1`, play through the free-spin round (subsequent `play` requests →
  `playedBonusSpin`; `collect` closes it → `gameRoundOver`).
- **Expect:** the counter decrements each spin; the accumulated win credits on `collect`;
  `stateGame.specialSymbol` clears on end; the game returns to base game. (Regression guard: the
  outro renders nothing without the count-up cue — assert the outro state, and flag the visual as
  human-eyes.)

### S5 — Bet change + affordability
- **Do:** change bet levels; attempt a spin at each.
- **Expect:** balance/stake update coherently; no NaN in the HUD readouts; disabled/blocked spin
  when a bet exceeds balance. **human-eyes:** HUD number formatting/currency polish.

### S6 — Symbol states (debug grid)
- **Do:** open `SymbolDebugOverlay` (`d`); step each symbol through Static/Spin/Land/Win/Post-win.
- **Expect:** every symbol×state resolves to a sprite/spine (no missing-glyph black screen, no
  placeholder dots); win states inherit the effective win binding. **human-eyes:** per-state art.

### S7 — A round left open is finished on the next boot (resume)
- **Force:** start the mock in the partner's no-auto-collect mode with a known win —
  `AUTO_COLLECT=0 BIG_WIN=1 PORT=7788 node scripts/mock-rgs-server-book.mjs` — and leave a round
  open on it with raw POSTs (the game itself collects too fast to interrupt):
  - base win: `[]` then `[{"action":"bet","context":[0,10]},{"action":"play","context":""}]` at
    `?sid=resume-base&seq=0`;
  - feature cut off (a buy is bet option 1): `[{"action":"bet","context":[1,10]},{"action":"play","context":""}]` at
    `?sid=resume-feat&seq=0`, then `[{"action":"play"}]` at `seq=2` and `seq=3` with `&gid=` set to
    the returned `platform.gameRound.id`.
- **Do:** boot the game with `sessionID=resume-base` (then `resume-feat`); tap through the gates.
- **Expect:** the mock log shows the stored actions re-posted under the round's `gid` at the
  positions they were stored at (`0:bet+play`, then `2`, `3`), the rest of the round continuing from
  the next free position, and one `collect`. The game presents the round (state `resumeBet`), starts
  on the INTERIM balance (stake debited, win not shown) and ends `idle` on exactly the mock's
  `/state?sid=…` balance. The next spin is a fresh $1 round at `seq=0` with no `gid` — not a re-buy.
- **Offline gate:** `pnpm check:resume`.
