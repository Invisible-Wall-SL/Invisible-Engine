# Game Config — lessons

What has bitten game-config work before, newest first. Format and rules: [README](../README.md).
Current state lives in [status/game-config.md](../../status/game-config.md); this file only keeps
the traps.

Math that belongs to one game type stays in its family file, not here: the buy cost and bet shape
([lines](../families/lines.md#known-failure-modes), [scatter](../families/scatter.md),
[ways](../families/ways.md)), a ways grid that never reached the mock and the desktop build read
under its game key ([ways](../families/ways.md)), Hold and Win role symbols
([hold-and-win](../families/hold-and-win.md)).

### Free spins never ended
- **Symptom:** a Book-of feature with an authored trigger count could retrigger forever.
- **Cause:** a retrigger could add more spins on average than it used, and neither mock capped a
  round (`scripts/mock-rgs-server.mjs`, `scripts/mock-rgs-server-book.mjs`).
- **Fix:** `MAX_ROUND_FREE_SPINS = 200` in both mocks; the validator refuses a trigger count below
  3 and an award above `MAX_FREE_SPINS_PER_ROUND`, held equal to the mocks'.
- **Guard:** `pnpm check:freespins`.
- **PR:** review of #1114 (2026-10-07) · source: `docs/status/game-config.md`

### A symbol marked unused still landed
- **Symptom:** a symbol `/config` badges unused still landed on a Book-of board, could become the
  expanding special, and was declared in the boot `config`.
- **Cause:** the book mock owned its ten symbols; the stacked test deal always used a WILD.
- **Fix:** the contract passes `grid.symbols` to `createBookMock`; the deal uses WILD only when one
  is dealt. Hold and Win side: [hold-and-win](../families/hold-and-win.md).
- **Guard:** `check:unused-symbols-in-game`.
- **PR:** not recorded (2026-10-07) · source: `docs/status/game-config.md`

### Players got the new board in the old client
- **Symptom:** after an unpublished grid or paylines change, players' games broke on the next spin.
- **Cause:** players boot the config frozen at Publish (#841) but `/api/game-config/mock` served
  the LIVE config to everyone.
- **Fix:** `source=published|live` (default published); the test server runs an authoring twin
  mock at `/api/<key>/authoring` that follows live.
- **Guard:** `check:mock-contract` (in the Lint workflow).
- **PR:** not recorded (2026-09-29) · source: `docs/status/game-config.md`

### The RGS dealt a different board than the game drew
- **Symptom:** `test4` "stopped working" at 6×6; `test3` drew 8×4 while the RGS dealt 5×3.
- **Cause:** the client read `/config` live while the mock read a grid frozen into
  `test_server/games.json` at publish; an entry with no grid fell back to the `apps/lines` 5×3.
- **Fix:** the boot error in `packages/engine-game/src/game/gameConfig.ts`; the test server now
  pulls the contract live. Ask `GET /api/game-config/mock?project=` before a network probe.
- **Guard:** the boot error; `check:mock-contract`.
- **PR:** #432 (ways half) (2026-08-20, 2026-08-21) · source: `docs/status/game-config.md`

### The template advertised a payout nobody could win
- **Symptom:** `W` sat in the paytable and flashed past during the roll, but never landed.
- **Cause:** the dictionary is not the in-play set; only the reel strips are. The lines template
  gave `W` a paytable and no strip.
- **Fix:** `paytable: null` in `apps/lines/src/game/config.ts`; every reader asks the strip gate
  (`packages/game-config/src/inPlay.ts`). Putting `W` on a strip would be a math change.
- **Guard:** `validateGameConfigDoc` warns; `tools/game-config-spike` (`doc`) asserts the case.
- **PR:** not recorded (2026-08-20) · source: `docs/status/game-config.md`

### Regenerating defaults dropped every win tier
- **Symptom:** the lines default lost all 10 win tiers and still validated clean.
- **Cause:** the generator read `winLevelMap.ts` as a sibling of `config.ts`; it had moved into
  `engine-game`, and a `try/catch` could not tell "no tiers" from "file moved".
- **Fix:** tries sibling then `engine-game`, and warns loudly when neither is found.
- **Guard:** `check:game-config-defaults` (`generate-game-config-defaults.ts --check`).
- **PR:** not recorded (2026-08-19) · source: `docs/status/game-config.md`

### Online reels stopped rolling
- **Symptom:** on online projects the result settled but the reels never spun.
- **Cause:** `rebuildBoard()` reassigned `stateGame.board`, orphaning the array `enhancedBoard`
  closes over at module init (`packages/engine-game/src/game/gameState.svelte.ts`).
- **Fix:** rebuild in place with `splice`, keeping the array's identity.
- **Guard:** none; the comment on `rebuildBoard`.
- **PR:** not recorded (2026-07-27) · source: `docs/status/game-config.md`

### Publishing symbols broke after a config refactor
- **Symptom:** `publish-symbol-defaults.mjs` failed once `constants.ts` read the resolved config.
- **Cause:** that script imports `constants.ts` standalone under Node; pulling in `gameConfig`
  dragged `editor-scenes` and the baked bundle with it.
- **Fix:** the `paddingReels()` accessor moved to `gameConfig.ts`; consumers import it there.
- **Guard:** none; keep `constants.ts` free of bundle imports. Related: [symbols
  lessons](symbols.md#publish-symbol-defaults-failed-silently-twice).
- **PR:** not recorded (2026-07-24) · source: `docs/status/game-config.md`

### An online game ran the sample config
- **Symptom:** every online project showed the same symbols, 20 paylines, strips and buy menu.
- **Cause:** all online games boot ONE shared runtime (`_runtime/lines`) with
  `apps/lines/src/game/config.ts` compiled in; anything read at import time freezes to it.
- **Fix:** `runtime → baked → compiled` in `packages/engine-game/src/game/gameConfig.ts`, reset
  in `Game.svelte`. A never-saved project still runs the template: editing it changes them all.
- **Guard:** none; read config through the resolver, never at module scope.
- **PR:** not recorded (Phase 3) · source: `docs/design/invisible-game-config.md`

### A data contract looked fine until the browser
- **Symptom:** a field saved in the UI never reached the doc, or a config dropped a key on its way
  to the game; found by hand in an auth-gated page.
- **Cause:** a contract (client body, normalizer, export, bake) checked by eye, not by running.
- **Fix:** prove the round-trip in a Node fixture over the REAL modules first: `pnpm --filter
  game-config-spike doc`, `packages/game-config/*.fixture.ts`, launcher `check:*` gates.
- **Guard:** the rule, in the agent files of Game Config, Symbols and FX.
- **PR:** not recorded · source: `docs/status/game-config.md`, `docs/status/symbols-history.md`

### A green gate that could not fail
- **Symptom:** a fixture printed ✓ on code that was broken.
- **Cause:** a synchronous `check()` over async assertions passed unconditionally; an unscoped
  mutation `replace(…, 1)` hit a sibling function, not the one under test.
- **Fix:** make one check fail on purpose before trusting a run; scope mutations to the function.
- **Guard:** none; `scripts/verify-test-server-project-pin.mjs` shows the pattern.
- **PR:** not recorded (2026-09-10) · source: `docs/status/game-config.md`

### The launcher build passed with a type error
- **Symptom:** a missing key in a typed list shipped green.
- **Cause:** `pnpm --filter launcher-api build` is a bare `vite build`; it strips types unchecked.
- **Fix:** derive lists from ONE exported value; run `pnpm check:svelte` and the Node fixtures.
- **Guard:** `check:undefined-names` and the `check:svelte` ratchet catch part of it, not all.
- **PR:** not recorded (2026-07-17) · source: `apps/launcher-api/CLAUDE.md`
