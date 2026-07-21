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
- **Animation completion / return-to-idle is NOT observable under automation** → treat as
  **human-eyes**, never FAIL it. Reel-stop is a `svelte/motion` Tween on Svelte's rAF loop; the
  Browser pane backgrounds the tab (`document.hidden`), freezing rAF, so the machine parks in
  `bet`. Pumping `app.ticker.update()` advances Pixi's ticker but not the Svelte rAF clock.

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
