# Playtest — lines (reference Book-of build)

Starter playbook for the canonical dev build. Expand it as scenarios are found; turn every fixed
bug into a permanent regression scenario here.

- **Launch:** `preview_start { name: 'lines' }` (port 3001, `PUBLIC_RGS_TRANSPORT=play4fun`,
  `PUBLIC_RGS_GAME=book`)
- **RGS:** mock test-server (`services/test-server`, book source `mock-rgs-server-book.mjs`).
  Force outcomes by selecting/editing the mock book or via `setBoardOverride`
  (see `reference_pixi_engine_verification` for the handle).
- **Build:** dev / `__IE_DEBUG__` on — `SymbolDebugOverlay` + `d` hotkey + `registerDebugTool`
  tools available. Pixi app inspectable via the stage-graph handles.

## Scenarios

### S1 — Boot clean
- **Do:** start the dev server, load the page, wait for the game to reach idle.
- **Expect:** no `error` console lines; no failed/CORS/502 network requests; the reels + HUD are
  present in the stage graph; the game is in the idle XState state.

### S2 — Single base-game spin (money math)
- **Do:** set a known bet, press Spin, let the round resolve.
- **Expect:** `requestBet` then `requestEndRound` both 200; the rendered win and the final balance
  equal what the returned **book** dictates (interim balance on `requestBet`, final on
  `requestEndRound`); the round returns to idle. No uncaught exceptions.
- **Force:** a mock book with a known non-zero line win.

### S3 — Book / scatter triggers free spins
- **Do:** force a book with 3+ book symbols on the board.
- **Expect:** free-spin trigger fires; the free-spin counter appears with the correct count; the
  special/expanding symbol is drawn (`stateGame.specialSymbol` set, `specialBookReveal` observed).
- **Force:** a mock free-spin-trigger book.

### S4 — Free-spin round runs to completion
- **Do:** play through the forced free-spin round.
- **Expect:** the counter decrements each spin; the expanding symbol expands + pays scatter-style
  when it lands; on the last spin the **outro fires** and the game returns to base game;
  `stateGame.specialSymbol` is cleared on `freeSpinEnd`. (Regression guard: the outro renders
  nothing without the count-up cue — assert the outro visual, not just the state flag.)
- **Force:** a mock free-spin book sequence with at least one expanding-symbol hit.

### S5 — Bet change + affordability
- **Do:** cycle bet levels; attempt a spin at each.
- **Expect:** balance/stake update coherently; no NaN in the HUD readouts; disabled state when a
  bet exceeds balance. **human-eyes:** HUD number formatting/currency polish.

### S6 — Symbol states (debug grid)
- **Do:** open `SymbolDebugOverlay` (`d`); step each symbol through Static/Spin/Land/Win/Post-win.
- **Expect:** every symbol×state resolves to a sprite/spine (no missing-glyph black screen, no
  placeholder dots); win states inherit the effective win binding. **human-eyes:** per-state art.
