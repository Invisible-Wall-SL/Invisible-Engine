# Invisible Symbols State Machine — status

> Design: [docs/design/invisible-symbols-state-machine.md](../design/invisible-symbols-state-machine.md) · Guide: [docs/tools/symbols-state-machine.md](../tools/symbols-state-machine.md) · Agent: _none yet — no `.claude/agents/symbols.md`; closest is `book-of-game` / `engine-pixi-svelte`_

**One-line state:** _(2026-09-17)_ Shipped — S1–S4 (engine contract, doc schema + endpoints, `/symbols` tool page, export→bake→pull chain) are on `main`; S5 (prove the full round-trip end-to-end on Book of Borut) is still the open piece. Newest: **a layer can opt OUT of the win dim** — `dimWithSymbol` (default ticked ⇒ byte-parity), which cost moving the dim's tint off the `SymbolWrap` container and onto each drawn piece inside `Symbol.svelte`, because Pixi's colour cascade only ever multiplies (branch `symbols/layer-dim-opt-out`, not yet on `main`). Before it, **cell LAYERS** — a symbol can be made of MORE THAN ONE picture, each layer with its own **blend mode** (`lighten`/`overlay` included) and an optional `behind`, array order = draw order; it reuses the EXISTING layer object (`bookVfxLayerSchema`), mounts at the ONE choke point (`Symbol.svelte`), never reports a beat, and hides the blend control on a `spine` layer because a Pixi blend cannot reach skeleton geometry (branch `symbols/cell-layers`, not yet on `main`). Before it, **`arrivalRelease`** — default-OFF, the emerge arrival stops GATING the round (the intro still plays in full and still settles its cell; it is simply no longer awaited), which is the 1.3 s tail measured on every `test6` spin, win or not (branch `engine/arrival-release`, not yet on `main`). Beside it, **`winBeat.maxMs`** — an authored CEILING (ms) on how long ONE winning symbol may hold the round, sparse and absent by default (the art keeps setting the pace), which is the SHAPER the runaway guard `WIN_BEAT_CAP_MS` deliberately is not (branch `engine/win-beat-pace`, not yet on `main`). Before it, the default-OFF global **`winExplode`** means **“explode and be gone”** — a winning symbol’s explosion IS its removal, which ends the Win → Explosion → **Clear reel** double pop a board that clears itself was reading — and it now fires **once per paying SPIN, on the board that paid** (immediately before the `reveal`/`tumbleBoard` that replaces it, on both dispatch branches), where the first cut fired once per BOOK and so missed 2225 of 7480 base and 227 of 250 bonus paying spins; a detached slammed win beat no longer writes over it either, which had frozen every slammed paying spin for ~4s (branch `symbols/win-explode-removes`, not yet on `main`). Beside it, the `tumbleExplosion` state is now **`clearReel` / “Clear reel”** (pure rename, legacy docs folded on read) — all built and offline-verified. Before them, an authorable **Explosion pattern** — the cascade comes apart in waves (by column, by row, out from the middle, …) instead of in one frame, with the Transition riding its own seat's pop. Newest of all: the **Win amount text** section gained a **Count up** group — the stamp can count up (the narration waits for it), fade in while it counts, and on a big-win round become the **big win's run-up**, counting the round total to the tier threshold before handing over to the overlay; all default OFF and verified LIVE in dev (book mock, `BIG_WIN=1`). ⏳ owner visual-verify + a runtime release / Borut `engine` submodule bump.

## Current state

This is the **`/symbols` launcher tool** (registry "Invisible Symbols State Machine", bar
name "Symbols SM") — the online, editable twin of the in-game Symbol Debug grid. It is
**NOT** the in-game state machine itself; it authors a sparse `symbol × state → asset`
override doc (`<client>/<project>/symbols/symbols.json`) that the engine merges over each
game's coded `SYMBOL_INFO_MAP`. Un-baked repos render byte-identical to today.

Working on `main`:

- **The tool page** (`/symbols`, `(app)` route, `ssr = false`, auth + role gate;
  `admin`/`developer`/`artist` by default). Grid = symbols × the six states (`Static`,
  `Spin`, `Land`, `Win`, `Post-win`, `Explosion`), plus `Clear reel` on a project that
  cascades or clears its board and the two book states on a book game. Each cell shows its effective binding
  (override or coded default): sprite frame thumbnail, a live spine animation on the
  shared canvas, or a flipbook clip's first frame. Cell editor toggles
  **Sprite / Spine / Flipbook**, uses the editor's `RegionPicker` / spine-bundle picker /
  clip picker; edits are sparse overrides with per-cell reset (↺) + edited badge.
- **Save** — `PUT /api/editor/symbols` to R2 with dirty tracking.
- **↻ Reload from R2** — re-fetches spine bundles + previews and re-reads the project's
  bundle list, dropping the per-bundle skeleton/page HTTP cache so a re-rigged (Invisible
  Rigger) or replaced bundle shows its new art + animation names; unsaved edits preserved.
  Now **also clears the module-level region cache** (`clearRegionCache()`) so the SPRITE
  path's rects/page keys re-resolve too — previously a re-authored sheet stayed stale on
  sprite cells (and the Scene Editor, which shares that cache) until a hard page reload.
- **Regenerated-sheet self-heal (2026-07-21).** Spine cells read geometry through the rig
  bundle's FROZEN `.atlas`, so a re-packed sheet used to show old rects until the rig was
  manually `⟳ Re-sync`ed. `resolveEditorSpine` now calls `ensureBundleAtlasFresh`
  (`$lib/server/spineBundleSync.ts`), which re-derives the bundle `.atlas` + page from the
  live manifest when a **revision** (geometry hash + page ETag in the bundle's `source.json`)
  drifts — geometry (Sheet-Maker re-pack) AND art (Atlas-Maker recolour) now propagate to
  the grid with no manual step. The same helper runs at bake so the shipped game matches.
  See [docs/status/rigger.md](rigger.md).
- **Per-project defaults auto-publish** — each game publishes its coded `SYMBOL_INFO_MAP`
  to R2 at build (`publish-symbol-defaults.mjs`, chained into `build` by `new-game.mjs`);
  the tool reads it, **filtered to the in-play set** from `src/game/config.ts` (drops dead
  rows like an unused `H5`). Un-published projects / `apps/lines` dev fall back to the
  committed `lines.json`.
- **Symbol export scans ALL atlases for bound frames** (2026-07-06 fix, `7c94f4f`) —
  `exportEditorSymbols` breaks only once every bound frame name is actually covered, not on
  a running region-count compare, so a frame that lives only in a later atlas
  (`S_Game_Reel`) no longer ships blank.
- **Live rig-timeline FX preview matching the game** — `SymbolSpineStage` fires an
  fx-bound symbol's particle effect on the beat of its animation, riding the bound bone via
  the shared `fxOverlay.client.ts` factory (same core as the Rigger overlay; binding from
  `/api/editor/rig-fx`). The overlay applies the **full bone transform** (position +
  rotation + per-axis scale via `setFromMatrix` / `FxTransform`), so `/symbols`, `/rigger`,
  and the running game agree on rotated/scaled bones. ⏳ owner visual-verify.
- **Highlight tint** (2026-07-27, default = no tint). The `highlight` cell gained two sparse
  fields on its dedicated schema — `tintMode: 'fixed' | 'winLine'` and `tintColor` (`#rrggbb`,
  `fixed` only) — a MULTIPLY tint the win-frame overlay applies to the winning symbols.
  `fixed` uses the authored swatch; `winLine` picks up each paying line's colour from the game
  config's `paylineColors` (resolved at win time, so no bake dependency). The `/symbols`
  highlight editor gained a "Tint" mode select + a colour picker (shown for `fixed`). Runtime:
  a new `tint?: number` prop on pixi-svelte `BaseSpineProvider`/`SpineProvider` applies it via
  the spine `skeleton.color` (multiply, NOT sprite `.tint`); `SymbolWinFrame.svelte` resolves the
  number from `tintMode`. The per-win line colour is threaded to the frame through
  `animateSymbols({color})` → `boardWithAnimateSymbols.winLineColor` → the reel cell
  (`utils-slots` `winLineColor`) → `ReelSymbol`/`Symbol` → `SymbolWinFrame` (coded `winInfo`, the
  post-win replay, and the flow-v2 `animateWinSymbols` leaf all pass it). Threaded the full
  chain per rule 8: Zod (`.strict`) + client type/`setHighlight`/`docSignature`/PUT body →
  `SymbolExportHighlight` → `bake-editor-doc.mjs` whitelist → `BakedBundle.symbols.highlight`
  → `bakedHighlight()`. Verified offline against the schema (accept+preserve both modes,
  `.strict` rejects unknown keys, bad hex/mode rejected) + the bake whitelist; `pixi-svelte`,
  `lines`, and `launcher-api` all build clean. ⏳ owner visual-verify a tinted win frame + a
  `winLine`-tinted frame on a multi-colour-payline config. **Engine change — needs a Borut
  submodule bump + runtime release to reach the remake.**
- **Doc-level globals** (design §S6): `highlight` (win-frame spine, sparse, drawn over EVERY
  winning symbol whatever its art is bound to, default = built-in `payframe`) and `winLine` (payline overlay + line/text style, sparse
  config, no asset — TWO switches since 2026-08-24: `enabled` is the line's, `text.enabled`
  the stamped amount's, the latter defaulting to the former). Both travel verbatim through `symbolExport.ts` →
  `bake-editor-doc.mjs` → `bundle.symbols.*`. The `winLine` renderer was ported into the
  **shared engine** (`apps/lines/components/WinLine.svelte` + `bakedWinLineConfig()`,
  `806d6cf`), so every `runtime:lines` game draws it (default-on) — Book of Borut _remake_
  now included. ⏳ owner confirm the drawn line on a real win.
- **Show full payline** (2026-07-27, default OFF). `winLine.line.fullPayline` +
  `line.fullPaylineColor` (coded default `#4a90d9`): when on, the line is traced across the
  WHOLE payline (all reels) as a static underlay beneath the winning segment, in the chosen
  colour; off ⇒ winning segment only (byte-identical). Rides `winLine.line` verbatim through
  export/bake; the renderer gets the full path as `winLineShow.fullPoints`
  (`flowEffects#winLineFullPointsFor`, gated on the flag), fed by BOTH the coded `winInfo`
  handler and the post-win replay. ⏳ owner visual-verify.
- **Show all win lines at once** (2026-08-24, default OFF). `winLine.line.allAtOnce` +
  `line.allAtOnceDelay` (seconds, coded default `0.12`): every paying line of a spin is drawn
  TOGETHER — each appearing one beat after the last, in its own payline colour — and they all STAY
  on screen until the next spin, instead of the default draw → light symbols → clear → next
  narration. The symbols still celebrate one win at a time underneath them. Off (absent) ⇒ the
  one-at-a-time narration, byte-identical. Sparse: only the ON override persists, and the delay
  drops with it. Verified live on `apps/lines` + the mock (three lines up together, 121ms apart,
  surviving the celebration and restored by the resting replay).
- **Use payline colour from config** (2026-08-07, default ON). `winLine.line.useConfigColor`
  (sparse; absent ⇒ ON, only the OFF override persists — proven byte-parity offline over the
  real `setWinLineLine`). ON keeps today's `coreColor = winColor ?? line.color` in
  `WinLine.svelte` (config payline colour wins, swatch is fallback); OFF makes the Symbol-SM
  swatch authoritative and ignores the config colour (`coreColor = line.color`, halo too).
  The tool greys out the **Colour** swatch while the toggle is on. Rides `winLine.line`
  verbatim through export/bake (`bake-editor-doc.mjs` embeds `line` whole);
  `bakedWinLineConfig()` defaults it `true`. The published `stateGame.winLineColor` (for other
  assets to tint themselves) is deliberately LEFT ungated — the toggle is about this line's own
  drawn colour only. Engine change — needs a Borut submodule bump to reach the shipped remake.
  ⏳ owner visual-verify.
- **Winning SYMBOLS keep animating until the next spin** (2026-07-24, default ON). Doc-level
  `winCycle: { enabled?, delay?, showLine? }` (seconds, default `0.4`) authors the engine's
  `winSymbolCycle`: once a round's book is fully presented the game re-lights that spin's
  winning cells via the same `animateSymbols` leaf the round used, until the next bet stops
  it — **stepping through the paying lines one at a time** in book order and looping back to
  the first (`delay` is the gap between lines). The wins are ACCUMULATED across a spin's
  `winInfo` events, deduped: the reference books put every win in one event, but the
  Play4Fun facade the shipped games run on flushes one event per win, and assigning kept
  only the last line there. **The line rides along by default** — `showLine` (tool switch
  "Replay the win line too", default ON) draws each win's line + stamped amount on its pass,
  cleared between passes and on stop; off ⇒ symbols only, and the cycle then emits no line cues
  at all. `winLineEnabledForWin` is the shared gate, so the Win-lines / Win-amount-text toggles
  still have the final say and a scatter win lights symbols with no line. Its OWN section in the tool ("Winning
  symbols after the spin"), NOT a `winLine` field, so switching the overlay off can never stop
  the symbols. **`showText` (2026-07-27, default ON, tool switch "Replay the win text too")
  decouples the stamped amount from the line:** with `showLine` on, `showText` off keeps the
  line replaying but drops the win-amount text (the cycle sends empty strings, so `WinLine`
  draws the line with no stamp). Independent switches; unset ⇒ both on (prior behaviour).
  **`showMessage` (2026-07-27, default OFF, tool switch "Replay the win message too")** re-shows
  that win's info toast ("You win $X with N Bananas", `messageKind: 'win'`) on each replay pass —
  the toast riding along with the symbols, just as the line/amount do. UNLIKE its siblings it
  defaults OFF and persists sparsely on the ON state (the toast never replayed before this switch,
  so an unset project stays byte-identical — the message shows once at the round's first
  presentation). Independent of `showLine` (it is the toast, not the line). Consumed in
  `winSymbolCycle.ts` via `showWinInfoMessage`; travels the full chain (client setter/accessor,
  `.strict` schema, sparse sanitize, `bake-editor-doc.mjs` whitelist all inverted for default-OFF).
- **Wait for a spin press after a big win (free spins)** (2026-08-17, default OFF, tool switch of
  that name in the "Winning symbols after the spin" section). `winCycle.holdAfterBigWin`: a bonus
  book is ONE round, so dismissing a big win mid-feature handed straight over to the next free
  spin's `reveal` and the reels rolled on their own over a board the player had not read (owner
  report). On, the book is HELD at that seam — the resting replay narrates the spin's paying lines
  and the next free spin only starts on a spin press. Engine: `apps/lines/src/game/freeSpinHold.ts`,
  awaited at the `playBookEvents` seam in `game/utils.ts` on BOTH dispatch branches (coded + flow),
  so it behaves the same whether the overlay was the coded handler, a v1 flow or a v2 `bigWin`
  container. Gated on "a later `reveal` exists in this book" rather than `gameType`, which scopes it
  to free spins by construction (a base round has one reveal), survives a retrigger, and skips the
  LAST free spin (the outro follows and already gates on a press); skipped under
  `isContinuousBet()` (autoplay / space-hold), the same guard the replay uses. The press is the
  SPIN BUTTON, re-purposed rather than a second tap surface: `stateUi.spinHoldActive` +
  `armSpinHold`/`releaseSpinHold` (state-shared) make `utils-shared/spinStop` read the button as a
  live `spin_default` whose press releases the hold — no bet (the book is paid for), no slam — and
  the Space hotkey / flow `spin` action / invoked intent inherit it. `isSpinButtonSpinning` moved
  into `spinStop` (it was derived twice, in `ButtonBetProvider` and Game.svelte's parametric `spin`)
  so the rolling frame parks during the hold on both. Full chain: client setter/accessor, `.strict`
  schema, sparse sanitize (ON-state only), verbatim through `symbolExport.ts`, **plus the
  `bake-editor-doc.mjs` winCycle whitelist** — the runtime path forwards the whole export result, so
  omitting the bake line is the recurring "reach BOTH bundle paths" bug. **Verified** in the dev
  bundle from the page: held only in the mid-feature big-win case (last-spin / small-win /
  base-game / autoplay all pass straight through), button `spin_default` + not greyed + not
  spinning + bet press-sound while held, the press emitting NEITHER `bet` NOR `stopButtonClick`,
  and the cue log showing `winLineShow` → `boardWithAnimateSymbols` during the hold then
  `winLineHide` on release.
  The switch was nonetheless UNSAVEABLE until 2026-09-08 — the one link in that chain it missed
  was the page's dirty signature. Now guarded per-field by `check:win-cycle` (below).
- **Darken the non-winning symbols** (2026-07-27, default OFF, tool switch "Darken the
  non-winning symbols" in the "Winning symbols after the spin" section). `winCycle.dimNonWinning`:
  from the win celebration until the next spin, every symbol that is NOT part of a paying line is
  drawn darkened (Pixi v8 `Container.tint = 0x666666` on `SymbolWrap`, cascading to the sprite /
  spine / flipbook child), so the winning line stands out. Driven from
  `winSymbolCycle.recordWinCycleWins`: a `winInfo` refreshes the lit set to the round's paying
  cells (`refreshWinDim` → `stateGame.winDim`), a `reveal` (the next spin) clears it, so a losing
  spin's board is full-bright. Read by `ReelSymbol` (`stateGame.winDim.active && !cells[reel:row]`).
  **Independent of `enabled`** — the dim is a property of the whole board, not the replay, so its
  tool toggle sits outside the replay's `enabled` gate and applies even with the replay off.
  Persists sparsely on the ON state like `showMessage` (default-OFF ⇒ byte-parity: `SYMBOL_DIM_TINT`
  const, `.strict` schema field, sparse sanitize, verbatim through `symbolExport.ts`). Tint cascade
  verified live in the dev bundle (`_Container.tint` → child `_Spine.groupColor`); ⏳ owner
  visual-verify on a real winning spin.
- **Book-symbol VFX** (2026-07-28, default OFF). Doc-level global `bookVfx: { background?, foreground? }`
  — two authored layers drawn behind / in front of the game-selected book symbol
  (`stateGame.specialSymbol`) **during free spins only**. Each layer is a `BookVfxLayer`
  (`kind: 'sprite' | 'spine' | 'flipbook' | 'fx'` + `assetKey`/`animationName`/`clipId`/`effectId`
  - optional `sizeRatios`/`offset` × cell). Authored in the tool's **"Book symbol VFX"** panel
    (between Free-spin board glow and Win lines) — kind toggle + the existing RegionPicker (sprite) /
    spine bundle+animation / clip select (flipbook) / a new effect `<select>` (fx). Sparse, modelled on
    `boardGlow`: absent ⇒ byte-identical. Full chain — `.strict` schema + `.refine` (per-kind required
    field) in `symbolsStorage.ts`, client type/setters/`docSignature`, `symbolExport.ts` (routes each
    layer's asset into the shared `refs`; fx rides `bakedEffects()`), `export-symbols` response (both
    runtime + bake destructure), `bake-editor-doc.mjs` (`bundle.symbols.bookVfx`). Engine side
    (`apps/lines`): `bakedBookVfx()` + `bakedBookVfxAssets()` in `editor-scenes.ts`, `BookVfx.svelte`
    mounted in `Board.svelte` (bg zIndex −1 / fg +1 around each matching cell), each kind rendered by
    its proven component (Sprite / SpineProvider+SpineTrack / Flipbook / EffectPlayer). **Effect-pruning
    gotcha closed:** a bookVfx `fx` effect is a fourth reachability source in BOTH bundle paths — the bake
    path (`bake-editor-doc.mjs` keep-set) AND the runtime path (`pruneUnreachableEffects` gained an
    `extraReachable` param, fed the bookVfx fx effectIds at the `runtimeBundle.ts` call site) — else an
    otherwise-unreachable book effect would ship in the tool but get stripped from the live bundle.
    Offline fixtures: 13/13 over the real `normalizeSymbolsDoc` (4-kind round-trip, sparse pruning,
    `.strict`/`.refine` rejections) + 3/3 over the real `pruneUnreachableEffects` (keep-set rescues the
    exact id only). ⏳ **Owner visual-verify** (auth-gated tool + needs a book into free spins with the
    special symbol on the board). **Book of Borut needs an `engine` submodule bump** to receive it.
- **`clearReel` — the state that was `tumbleExplosion`** (2026-09-10, pure rename, behaviour
  UNCHANGED). Key `tumbleExplosion` → `clearReel`, label “Tumble explosion” → **“Clear reel”**,
  everywhere: `engine-layout/symbolStates` (`SYMBOL_STATES`, `CASCADE_SYMBOL_STATES`,
  `SYMBOL_STATE_LABELS`), the Zod schema, the client `STATE_HINTS`/`INHERITS_FROM`, `gameProfile`,
  the `apps/lines` engine (`symbolCell`, `TumbleBoard`, `TumbleSymbol`, `flowEffects`, `symbolBeat`,
  `soundBindings`, `editor-scenes`), the per-symbol SOUND state list (`/sound`), and the offline
  gates. It still plays on BOTH the cascade’s win-removal and `clearOutgoingSymbols`, still gated on
  `cascade || reelBehaviour.clears`, still inherits `explosion`. **Migration folds the legacy key at
  the load boundary** (`symbolsStorage#migrateLegacySymbolStates`), across `symbols[name]` AND
  `symbolSounds[name]`, and is reused by `symbolDefaults` on read and on WRITE (a submodule-pinned
  game publishes the names its own commit knows). It has to precede the Zod parse: the state records
  are keyed by `z.enum(SYMBOL_STATES)`, which REJECTS an unlisted key, and `loadSymbolsDocWithEtag`
  answers a parse failure with `emptySymbolsDoc()` — so an un-folded legacy doc would have read as a
  never-authored project and lost every binding silently. NOT renamed, deliberately: the
  `tumbleBoard*` cues + `stateTumble` internals (the tumble OVERLAY), `tumbleExplosionDelays` + the
  `TUMBLE_PATTERNS` family (a lone `clearReelDelays` in `tumblePattern.ts` reads worse than the churn
  saves), and the game-wide `tumbleExplosion` SOUND SLOT in `game-config/sounds.ts` (a `/config` key,
  not a symbol state).
- **Winning symbols explode** (2026-09-10, default OFF ⇒ byte-parity). Doc-global
  `winExplode: { enabled?: boolean }` — once a spin has narrated **every** one of its wins, the
  cells that paid **all play `explosion` together, once, and are then GONE**: the pop IS the removal
  (“explode and be gone”), so a symbol goes out with a pop on a board that does NOT cascade and
  nothing pops it a second time. Bounded like the win beat (`awaitSymbolBeat` + `WIN_BEAT_CAP_MS`)
  but with NO floor (`WIN_BEAT_MIN_MS` was already spent on the win); concurrent, so the whole pop is
  ONE beat however many cells paid; a capped pop still removes. **Deferred to the END of a SPIN,
  not the end of each win** — a spin narrates its wins one after another over the same board and
  overlapping paylines share cells (26% of the reference books’ `winInfo` events pay a cell twice), so
  a per-win pop took a cell off that a later win still had to light. Each win’s own narration is
  byte-identical to the switch being off. **Once per paying SPIN, not once per book** — it fires at
  three seams: `playBookEvents` runs it on BOTH dispatch branches immediately before the `reveal` /
  `tumbleBoard` that replaces the board (`explodeWinnersBeforeBoardChange`, keyed to the same
  `REPLACES_THE_BOARD` set `recordWinCycleWins` clears `wins` on, so every clear is preceded by a pop),
  while `playBet`’s `finally` and the between-spins hold cover the book’s last spin. **A beat settles
  only the state IT set** (`win` / `explosion`) — a slam leaves the win beat running detached and its
  revert used to land inside the pop. Symbols that did NOT pay are untouched — taking those off
  stays the cascade’s / the clear step’s job. The removal is a flag on the reel CELL
  (`ReelSymbol.removed`), published by position as `boardRemoved()`, and it is self-clearing: every
  board replacement builds fresh cells. **An explicit switch, not an inference from “is `explosion`
  authored”** — every game binds `explosion` for the Book-of morph, so the inference is true
  everywhere and would re-time every paying spin in every shipped game. Three decided edges: the
  RESTING replay has nothing left to replay (`cycleEntries` drops removed cells and the pop is
  awaited immediately before `startWinCycle` — so the pop is a choice against the replay); a
  STACKED-COVERED cell is skipped (it mounts no `<Symbol>`, so it could neither draw the pop, report
  it, nor be taken off); and a CASCADE owns only the seats the BOOK names (a seat the pop emptied is
  born UNDRAWN but ORDINARY on the survivor layer, and the step MARKS it only when its own exploding
  set covers it). Full chain: `.strict` Zod + sparse prune → client
  type/accessor/setter/`docSignature` → spread PUT → `symbolExport` verbatim →
  `/api/editor/export-symbols` → **bake whitelist** + runtime bundle → `bakedWinExplodeEnabled()` →
  `winSymbolCycle.explodeSpinWinners()` → `boardExplodeWinSymbols` → `Board.svelte`, plus a
  `gameProfile` chip. ⏳ owner visual-verify.
- **Longest win beat** (2026-09-15, absent by default ⇒ byte-parity). Doc-level global
  `winBeat: { maxMs? }` — the authored CEILING, in milliseconds, on how long ONE winning symbol holds
  the round: its `win` animation, and the `explosion` the pop adds after it. Absent ⇒ each beat runs
  for exactly as long as its art does; set ⇒ anything longer is cut short. It only ever SHORTENS, so
  a symbol already quicker than the ceiling is untouched. **A SHAPER, explicitly not the runaway
  guard** — `WIN_BEAT_CAP_MS` (4 s, `apps/lines/src/game/symbolBeat.ts`) exists for art that can never
  report `oncomplete` and is sized above anything a project plausibly authors, because (that file's
  own words) a cap a real animation can hit stops being a guard and starts being the timing; exposing
  it would have made every project's guard its pace. The case that asked for it: on the live `test6`
  every symbol's `win` is a 2.00 s `Pull` and its `explosion` a 0.50 s `Take`, and that project
  cascades — a three-tumble winning round pays ~7.5 s of symbol beats on top of the spin and the
  cascade steps. Range **50–10000 ms, integers only**, enforced by Zod at SAVE (a value the engine
  could not honour is a typo, and a typo must fail loudly rather than be ignored at play); the tool's
  setter rounds + clamps into the same range so a mistyped number cannot come back as a 400 that
  loses the whole doc. Sparse exactly like `winExplode`: an untouched doc persists no key and clearing
  the box deletes it. Authored in the **Winning symbols explode** section (a "Longest win beat (ms)"
  number input directly under the switch, empty = unset), because the ceiling covers the pop's beat
  too — but it applies with the pop off. Full chain: `.strict` Zod + sparse rebuild in
  `symbolsStorage.ts` → client type/`winBeatMaxMs`/`setWinBeatMaxMs`/`docSignature` → spread PUT →
  `symbolExport.ts` verbatim → `/api/editor/export-symbols` → **bake whitelist** + runtime bundle →
  `bundle.symbols.winBeat`, plus a `gameProfile` chip. Engine half on the same branch
  (`resolveWinBeatBudget(bakedWinBeatMaxMs())` in `symbolBeat.ts`, read by BOTH the win beat and the
  pop in `Board.svelte`, so a ceiling bounds what a paying cell costs in total). Offline gate:
  `pnpm --filter launcher-api check:clear-reel` (74 → **95** checks — new part 9: sparsity, the
  round-trip, both ends of the range, the five rejections, the client setter's clamp + dirty
  signature, and both bundle paths). ⏳ owner visual-verify.
- **Release the round on arrival** (2026-09-15, default OFF ⇒ byte-parity). Doc-level global
  `arrivalRelease: { enabled? }` — under the `emerge` swap style the round stops WAITING for the
  arrival intro. It shortens nothing: the intro still plays in full and still settles its cell to the
  resting art on both exits of its own bounded race (`INTRO_BEAT_CAP_MS`, 2 s, in
  `TumbleBoard.svelte`'s `tumbleBoardAppear`) — it is simply detached rather than awaited, so the
  board is released the moment every cell has been seated with its new art. The measurement behind
  it, on the live `test6` in a real browser at 136–204 fps: `reveal` took **3.0–3.4 s on every spin,
  win or not**, and inside a 3401 ms one the board's own clips were finished at **t+2088** while the
  round released at **t+3401** — the tail being that cap, which the project pays because it authors
  an `intro`; a cascade step (~2.14 s) pays it again, which is why the pause between two wins of one
  spin feels like the pause after it. Deliberately a SWITCH and not a new default: the trade is that
  the next spin may begin over an intro still playing, and that is a presentation call the project
  owns. Not gated on the swap style at SAVE (the doc and the config are independently edited, and a
  flag silently dropped because `/config` said so comes back as a switch that will not stay on) —
  only the tool's section is hidden on a non-emerge project, and stays visible while authored.
  Authored in its own section under **Winning symbols explode**. Full chain: `.strict` Zod + sparse
  rebuild in `symbolsStorage.ts` → client
  type/`arrivalReleaseEnabled`/`setArrivalReleaseEnabled`/`docSignature` → spread PUT →
  `symbolExport.ts` verbatim → `/api/editor/export-symbols` → **bake whitelist** + runtime bundle →
  `bundle.symbols.arrivalRelease`, plus a `gameProfile` chip. Engine half on the same branch
  (`bakedArrivalReleaseEnabled()` in `apps/lines/src/editor-scenes.ts`, read at dispatch time by
  `tumbleBoardAppear`). Offline gate: `pnpm --filter launcher-api check:clear-reel` (95 → **111**
  checks — new part 10: sparsity, the ON round-trip, the `.strict`/non-boolean rejections, that a
  non-emerge project still keeps the flag it saved, the client setter + dirty signature, and both
  bundle paths). ⏳ owner visual-verify.
- **Cell LAYERS — a symbol made of more than one picture** (2026-09-17, absent by default ⇒
  byte-parity; branch `symbols/cell-layers`, not yet on `main`). A symbol CELL gained
  `layers?: SymbolLayer[]`: extra art drawn together with that state's own, **array order IS draw
  order**, each layer carrying its own **`blendMode`** and an optional **`behind`** (draw under the
  cell's art; absent ⇒ over it). The owner's art is sprite/flipbook and the ask was specifically
  `lighten` + `overlay`, both of which already exist as Pixi ADVANCED blend modes registered by
  `<InitialiseApplication>`. ⚠️ Those two did not actually draw in ANY game until 2026-09-18 — the
  renderer was skipping the blend filter for want of a back buffer, so a layered symbol authored
  before that release blended only in the tool. Cause + fix + the measurement:
  `docs/status/editor.md`, 2026-09-18.
  **Reuses the EXISTING layer object rather than inventing one** — `bookVfxLayerSchema` (the four
  kinds `sprite`/`spine`/`flipbook`/`fx` + `assetKey`/`animationName`/`clipId`/`effectId` +
  `sizeRatios`/`offset`) moved above `symbolCellSchema` and gained `blendMode`/`behind`, so ONE
  shape means one renderer (`SymbolLayer.svelte`), one export rule (`addLayerRefs`) and one effect
  keep-set. The book VFX and the explosion transition therefore get a blend mode for free (data +
  schema; **no UI for those two yet** — see open items). The engine type is
  `engine-game`'s new `SymbolLayerSpec`, which `editor-scenes`' `BookVfxLayer` now ALIASES.
  **Mounted at the ONE choke point** — `Symbol.svelte` — so the board, cascade, stacked mode, debug
  grid, Book expand/reveal riders and the inline message symbol all inherit it. Draw order is
  MARKUP order (behind-layers before the base arm, the rest after), not `zIndex`: the parent
  container varies by mount site, so nothing may depend on `sortableChildren`. The win frame and the
  multiplier stamp deliberately stay last.
  **Four constraints held, each measured or reasoned rather than assumed:**
  (1) **A spine layer CANNOT blend** — `SpinePipe.addRenderable` batches every slot with the SLOT's
  own blend and never reads `groupBlendMode`, so `multiply` on a spine is pixel-identical to
  `normal`. `engine-layout` gained `canBlendLayerKind()` (the symbol-doc `fx` ⇄ editor `effect`
  translation over `BLENDABLE_KINDS`) as the ONE definition the tool's control and the renderer both
  read; the tool replaces the Blend select with a note pointing at the Rigger's per-slot blend, and
  the renderer ignores a stored mode. (2) **Layers NEVER report beat completion** — no `once`, no
  `oncomplete`, so the base cell alone owns the round (the transition's rule). (3) **A layer
  decorates a bound cell** — `assetKey` stays required, so there is no layers-only cell for
  `isUsableCell` to resolve to `static` underneath; a cell with no art draws nothing, layers
  included (`Symbol.svelte`'s `hasArt`, the win-frame rule). (4) **The masked vs unmasked layer is
  still the BASE cell's `type`** — letting a layer vote would re-create every symbol on a layer
  edit, the one-cell-merge bug; consequence documented in `ReelSymbol.svelte` (an overflowing spine
  LAYER clips against the board mask).
  **Ships the full chain (rule 8):** `.strict` Zod + shared `.refine` + `max(8)` + an
  empty-array prune in `normalizeSymbolsDoc` → client `SymbolCell.layers`/`SYMBOL_LAYER_MAX` →
  `applyDraft`'s whitelist (`reduceLayer`, now shared with `applyBookVfx`) → the spread PUT →
  `collectSymbolRefs` walks cell layers **before** the flipbook `continue` (a layer on a flipbook
  cell would otherwise never ship) → the map rides both bundle paths verbatim →
  the fx REACHABILITY keep-set in **both** `runtimeBundle.ts` and `bake-editor-doc.mjs`.
  `bakedSymbolAssets()` already registers the whole index, so no new `baked*Assets` function.
  `canonicalizeSymbolsDocForExport` now repairs a sprite LAYER's scoped `<prefix>::<region>` key on
  the same terms as a cell's — a layer's frame resolves in-game through the identical flat key, so
  a layer authored off a Sheet-Maker output prefix would otherwise miss `loadedAssets` and render
  blank for exactly the reason the cell path was repaired.
  The page's dirty signature needed no new field: cells go into `docSignature` WHOLE (now commented
  as load-bearing) — asserted rather than assumed.
  **Preview is deliberately scoped and the tool SAYS so:** the grid draws the base binding only and
  adds a `+N layers` badge (hover = the list); the panel previews each layer ON ITS OWN. Nothing
  composites layers over the symbol and **no blend mode is previewed anywhere** — one shared WebGL
  canvas serves every spine cell, so a faithful composite is not available, and a lie would be worse
  than the note under the list. Offline gate: `pnpm --filter launcher-api check:symbol-layers`
  (46 checks — parity/sparsity, draw order + the `behind` split, the spine-blend ignore + version
  skew, 10 rejections, shipping through `collectSymbolRefs`, the dirty signature on add/reorder/
  re-blend, the fx keep-set on both bundle paths over the real `pruneUnreachableEffects`, and the
  scoped-ref repair's layer walk). The repair's ACTUAL rewrite needs an R2 listing, so like the cell
  path before it, it is asserted structurally rather than executed.
  ⏳ **Owner visual-verify** — nothing about the blend result is provable offline. **Book of Borut
  needs an `engine` submodule bump** + a runtime release to receive it.
- **A LAYER can opt out of the win dim** (2026-09-17, default = dims ⇒ byte-parity; branch
  `symbols/layer-dim-opt-out`, not yet on `main`). The shared layer object gained
  `dimWithSymbol?: boolean` — absent/`true` ⇒ the layer darkens with its symbol under "Darken the
  non-winning symbols" (`winCycle.dimNonWinning`), exactly as every layer did; `false` ⇒ it is drawn
  at full brightness while the rest of the cell darkens (a glow that must stay lit). Sparse: ONLY the
  opt-out is written, so a doc authored before this ships byte-identical.
  **The constraint that shaped it, measured rather than assumed:** the dim is a Pixi tint and Pixi v8
  computes `groupColor = localColor × parent.groupColor` (`updateRenderGroupTransforms`), so a child
  under a dimmed container can only darken FURTHER — there is no tint that brightens back. Run against
  the real colour pass: a child of a `0x666666` container set to `0xffffff` still resolves to
  `0x666666`. An exempt layer therefore has to be OUTSIDE every tinted node; a per-layer prop on top
  of the existing wrapper tint could not have worked.
  **So the tint MOVED DOWN, one level, and that is the whole engine change.** `SymbolWrap` no longer
  tints its container; `ReelSymbol` hands the same `dimmed ? SYMBOL_DIM_TINT : 0xffffff` to
  `<Symbol>`, which applies it per drawn PIECE: two unconditional `<Container tint>`s (one around the
  cell's art, one around the win frame + the multiplier stamp) and, for a layer, the existing wrapper
  `SymbolLayer` already had — so a layer costs no new node and an exempt one simply gets `0xffffff`.
  **Parity is by construction, not by inspection:** the cascade MULTIPLIES, so moving the same factor
  from an ancestor onto every one of its descendants leaves each leaf's `groupColor` identical —
  proven over the real pass — and every piece the wrapper used to reach is still under exactly one
  tinted node. Three decisions behind that shape: the containers are UNCONDITIONAL (wrapping only
  while dimmed would remount the art each time the celebration started or ended, restarting a spine
  mid-win); the frame and the stamp share the second container because they are contiguous, since the
  over-layers between them may not be re-ordered (array order IS draw order); and the renderers' own
  tint props are deliberately NOT used — a spine is tinted through `skeleton.color`, a different
  mechanism from the container cascade, and parity here is worth more than a saved node.
  Every non-board mount site (cascade, stacked, debug grid, Book expand/reveal riders, message
  symbol) passes NO tint at all, which `propsSyncEffect` skips ⇒ no container property is ever
  assigned ⇒ byte-identical. The board path always passes a NUMBER, never `undefined`, because a prop
  going number → undefined would be skipped and leave the last tint stuck on.
  Full chain: `.strict` Zod on the shared `bookVfxLayerSchema` → client `BookVfxLayer` →
  `reduceLayer`'s whitelist (opt-out only) + `setLayerKind` carry-over → the spread PUT → the symbol
  map rides both bundle paths verbatim → `SymbolLayerSpec` in `engine-game`. The page's dirty
  signature needed nothing new (cells go into `docSignature` WHOLE) — asserted, not assumed. The
  field is on the SHARED layer object, so the book VFX and the transition carry it in data and ignore
  it in render (neither is drawn inside a dimmable symbol) and neither gets a control, exactly as
  `behind` does.
  Tool: a **"Dim with symbol"** checkbox, ticked by default, in the cell editor's Layers section
  between **Draw** and **Blend**, plus a `no dim` chip on the collapsed row. The panel says the dim
  is **not previewed** — it only happens during a win.
  Offline gate: `pnpm --filter launcher-api check:symbol-layers` (46 → **78** checks — new part 7:
  parity/sparsity, the default dims and the opt-out does not, the rejection, the dirty signature, and
  SOURCE assertions pinning where the dim is applied — that `SymbolWrap` no longer tints, that both
  `SymbolLayer` mounts get `layerTint(layer)`, that the base art, the win frame and the multiplier
  stamp are all still inside a tinted container, and that the containers are unconditional). Each of
  those was proven NON-VACUOUS by breaking the source and watching the guard fail (7/7 caught).
  ⏳ **Owner visual-verify** — nothing about how the dim LOOKS is provable offline. **Book of Borut
  needs an `engine` submodule bump** + a runtime release to receive it.
- **Explosion pattern** (2026-09-08, default `all` ⇒ byte-parity). Doc-level global
  `tumblePattern: { pattern, stepMs? }` — the ORDER the winning seats pop in and the gap between two
  waves. Twelve patterns (`all`, four column sweeps, two row sweeps, two diagonals, `radial`,
  `random`, `sequential`), gap 0–500 ms, default 80. Like the Transition below it, it covers BOTH
  moments that reach `tumbleBoardExplode`: every cascade step and the swap-in-place board CLEAR.
  The order lives in ONE place both halves import — `engine-layout/tumblePattern`'s
  `tumbleExplosionDelays(seats, config, bounds)` — so the tool's live preview and the game cannot
  disagree; the tool asks for it with `stepMs: 1` so the returned delay IS the wave number.
  DENSE RANKING over the exploding seats, not the board: a win on three reels pops in three waves
  rather than waiting through the empty ones, which is what keeps a pattern reading the same on a
  small win. The exception is deliberate — `radial` / `columnsOut` / `columnsIn` take their centre
  from the BOARD (the live `stateTumble.base` extents), so an off-centre win reads as off-centre.
  Engine: `TumbleBoard.svelte` computes the delays once per step and each seat `waitForTimeout`s its
  own before setting `tumbleExplosion`; the step's `Promise.all` contract is untouched, so it still
  ends on the LAST beat and simply lasts `(waves - 1) × stepMs` longer. A seat whose symbol has left
  `stateTumble.base[reel]` by the time its wave fires is DROPPED (identity check, not index) —
  a slam, `tumbleBoardReset` or a refill splicing the column would otherwise leave the beat waiting
  on a symbol with no renderer to report `oncomplete`, stalling behind `TRANSIT_BEAT_CAP_MS`.
  TWO CEILINGS: `stepMs` caps one gap at 500 ms, and `TUMBLE_SPREAD_MS_MAX` (2 s) caps the WHOLE
  spread by scaling the step down while every seat keeps its wave — because a per-seat pattern's
  wave count grows with the win (`sequential` × 15 seats × 500 ms = 7 s) and a swap-in-place board
  with "clear the board" explodes every seat on every spin, on a step nothing races against the
  round-skip token. An UNKNOWN pattern name answers all-zero rather than throwing: Zod stops one at
  save, but the launcher deploys from `main` while a shipped game pins the engine submodule, so a
  newly added pattern can reach an older engine — and a throw there would take `broadcastAsync`, the
  `tumbleBoard` book event and the round with it. TRANSITION INTERACTION: none — the bridge rides
  its OWN seat's pop (`delayMs` after that seat's explosion) and a pattern therefore sweeps the
  bridges across the board with the waves. It briefly did not: a `catchUpMs` pulled every bridge onto
  the last wave so they would land on the board-wide intro together, and a wave-0 seat's cover then
  arrived a whole spread after its symbol had finished popping. Removed 2026-09-09 — see the design
  doc's "Explosion pattern" for why the pop is the end that wins. A SPENT SEAT IS UNDRAWN: a symbol
  stops being rendered the moment its own pop reports (`TumbleSymbol.exploded`), rather than at the
  board-wide `tumbleBoardRemoveExploded` that a pattern pushes seconds later — otherwise it kept
  animating in between, and since a cell's `loop` is absent-means-loop it re-played its explosion two
  or three times. Undrawn, not removed: removal would shift every index below it. Sound: the step-wide
  `playTumbleExplosionSound` still fires ONCE with the first wave; `playSymbolTumbleExplosionSound`
  moved behind the delay so a symbol's own cue lands with its own pop. Both defaults are pruned on
  save (`all`, and a step equal to the default) on the SERVER and in the client setter — they have to
  agree or the page would be permanently dirty. Ships the full chain (schema → client → export →
  `/api/editor/export-symbols` → bake whitelist + runtime bundle → `bakedTumblePattern()`), plus a
  `gameProfile` row. Verified offline: `node scripts/verify-tumble-pattern.mjs` (40 checks) and
  `pnpm --filter launcher-api check:tumble-pattern` (34).
- **Explosion → intro Transition** (2026-09-03, default OFF ⇒ byte-parity). Doc-level global
  `transition: { kind: 'spine' | 'flipbook' | 'fx', assetKey?, animationName?, clipId?, effectId?,
delayMs? }` — ONE project-wide animation the cascade overlay mounts at every seat whose outgoing
  symbol starts `tumbleExplosion`, `delayMs` after the pop fires, so under `swapStyle: 'emerge'` the
  explosion's end and the intro's start overlap at the same seat instead of hard-cutting. Covers BOTH
  places that seam occurs: the reveal's clear step (`clearOutgoingSymbols`) and every cascade step —
  both reach `TumbleBoard.svelte`'s `tumbleBoardExplode` handler, which is where it is scheduled.
  FIRE-AND-FORGET: never awaited, never gates the explosion beat, never delays the intro or extends the
  round; the intro starts exactly when it did. Gated on `boardSwapsInPlace() && boardSwapStyle() ===
'emerge'` (the check `bookEventHandlerMap` uses) — a sliding refill has no intro to bridge. Engine:
  `TumbleBoard.svelte` owns a keyed per-seat overlay list on the ANIMATING layer (`zIndex` 1, seat
  x/scale from `getSymbolSeat`, y = the symbol's resting `symbolY`); delay 0 mounts in the same flush
  as the explosion state, > 0 via a timer; an entry is removed on its own completion (spine non-loop
  `complete`; flipbook = one walked cycle, the `SymbolFlipbook` rule; FX = `forceEmit` + `emitFor`
  sized off the effect's longest `trigger.duration` / `emitterLifetime` — one transit beat when
  unbounded — plus its longest particle lifetime), with a 4 s leak cap (`WIN_BEAT_CAP_MS`-sized) for an
  entry that never reports. `tumbleBoardReset` clears pending timers AND the list; `tumbleBoardHide`
  unmounts the overlay, so a transition longer than the step is CUT there by design. Renderer: the
  four-kind switch moved out of `BookVfx.svelte` into a shared `SymbolLayer.svelte` (BookVfx renders
  through it, looping, with every behaviour prop `undefined` ⇒ byte-identical), which the transition
  drives with `once`. NO sprite kind (a transition has a duration) and no size/offset hints: the box is
  the plain cell × the row's perspective scale. Full chain per rule 8: `.strict` Zod + shared
  `layerHasKindField` `.refine()` + `pruneTransition` (a `delayMs` of 0 is dropped) in
  `symbolsStorage.ts` → client `TRANSITION_KINDS` (`satisfies` the book-VFX kinds) /
  `SymbolTransition` / `setTransition` / `clearTransition` / `docSignature` → spread-PUT →
  `symbolExport.ts` (`addLayerRefs`, generalised from the book-VFX helper, files a transition spine
  into `refs.spineKeys` ⇒ `index.spines`; `collectSymbolRefs` exported for the check) →
  `export-symbols` response → `bake-editor-doc.mjs` (`bundle.symbols.transition` + the effect keep-set,
  now `symbolDocBound`) and `runtimeBundle.ts` (`symbolDocEffectIds` → `pruneUnreachableEffects`
  `extraReachable`) → `BakedBundle.symbols.transition` → `bakedSymbolTransition()` +
  `bakedSymbolTransitionAssets()` (spread in `stateApp.ts`). `gameProfile` gains an "Explosion
  transition" chip. Tool: a **Transition** section between Free-spin board glow and Book symbol VFX,
  shown for a project that emerges (`data.reelBehaviour.emerge`, resolved server-side like the
  `Intro` column) or that still carries a saved transition: Spine / Flipbook / FX toggle on the Book-VFX pickers, **Delay (ms)**, `set` badge,
  ↺ Clear, off-state copy "Off — the intro cuts in the moment the explosion ends"; the Book-VFX thumb
  snippet became the top-level `layerThumb` both use. Offline: `pnpm --filter launcher-api
check:symbol-transition` — parity (no key when absent, verbatim round-trip, delay-0 pruned, fixed
  point), rejection (half-authored, `sprite`, bad delay, unknown key), shipping (a spine bound ONLY as
  the transition lands in `refs.spineKeys`), and the client dirty signature — all over the REAL
  functions. ⏳ **Owner visual-verify** on an emerging project (auth-gated tool + a cascading/clearing
  board). **Book of Borut needs an `engine` submodule bump** + a runtime release to receive it.
- **Selectable anticipation animation SET** (2026-08-10, default unset ⇒ byte-parity). Adds an
  **Overlay animation** control to the `/symbols` Reel anticipation panel (between Overlay spine and
  Activation sound): a dropdown of the resolved overlay spine's COMPLETE sets (a base whose
  `_intro`/`_loop`/`_out` all exist — e.g. `anticipation1..4`; the unnumbered `anticipation` base is
  the "Default" option), enumerated via a compact `SymbolSpinePreview` `onAnimations` (same mechanism
  as highlight/glow); a free-text base input is the fallback when the spine can't be enumerated. Full
  chain: client `symbols.client.ts` (`AnticipationConfig.animationSet` + `pruneAnticipation`
  config-level allowlist + `setAnticipationAnimationSet` + `docSignature`) → `.strict` Zod
  (`anticipationSchema.animationSet` + server `pruneAnticipation` allowlist) → export passes
  `anticipation` VERBATIM (no field enumeration touched) → `editor-scenes` baked shape
  (`anticipation.animationSet?`) → engine resolver `resolveAnticipationAnimationBase()` (authored ??
  coded `anticipation`, `DEFAULT_ANTICIPATION_ANIMATION_BASE`). `Anticipation.svelte` now tracks a
  `phase` (`intro`→`loop`→`out`) and derives the played name `${base}_${phase}` instead of the
  hardcoded `anticipation_*` triple — un-authored ⇒ base `anticipation`, byte-identical. The dropdown
  options come from `builtinSpineMeta(spineKey)?.animations` (a pure static read — NO WebGL context: a
  first attempt used an always-mounted `SymbolSpinePreview` for `onAnimations`, but it lost the browser's
  ~16-context cap to the page's other previews and rendered "no spine" ⇒ empty list ⇒ text fallback; the
  static meta has none of that fragility). A swapped R2 `spineKey` isn't in the builtin meta ⇒ `[]` ⇒
  free-text base input. **Verified live** in `/symbols` (test2, local dev): dropdown lists
  Default + `anticipation1..4`, selecting `anticipation3` writes `doc.anticipation.animationSet`, flips
  Save dirty + shows the "overridden" badge. Both engine (`lines`) build + launcher client compile green.
  ⏳ Runtime play in-game needs an **engine runtime release** (shared `_runtime/lines`) + the online
  project republished; **Book of Borut needs an `engine` submodule bump** to receive it.
- **Reel-anticipation FX** (2026-08-05, reel-anticipation Phase 5, default OFF ⇒ byte-parity).
  Sparse doc-global `anticipation: { spineKey?, tiers?: Record<tierAlias, TierFx> }` — the editable
  twin of the engine's coded FX ramp. Each tier is a sparse
  `{ zoom?, overlayScale?, overlayAlpha?, overlayTint? (#rrggbb), soundVolume? }`; `spineKey`
  optionally swaps the per-reel overlay spine (a full R2 bundle prefix, shipped via `index.spines`
  like `boardGlow` — no new asset class; the engine still owns intro→loop→out). Authored in a
  game-level **Reel anticipation** panel between the win-symbol replay and the grid. Full chain per
  rule 8: `.strict` Zod (`anticipationSchema` + `pruneAnticipation`) → client
  type/setters/`docSignature`/spread-PUT → `SymbolExportResult.anticipation` + `spineKey` added to
  export refs → `export-symbols` response → `bake-editor-doc.mjs` whitelist →
  `BakedBundle.symbols.anticipation` → `bakedAnticipation()`.
  Engine consumes it at ONE choke point: `anticipationPresentation.ts`' `resolveTierFx` /
  `resolveAnticipationSpineKey` (authored ?? coded, per-field fall-through), and the three components
  (`Anticipation`, `Anticipations`, `AnticipationCamera`) read through them. Un-authored ⇒
  `bakedAnticipation()` undefined ⇒ resolvers return the coded ramp verbatim.
- **Authorable anticipation SOUNDS + escalating volume ramp** (2026-08-06, default OFF ⇒ loop
  byte-parity). Adds three controls to the `/symbols` Reel anticipation panel: two GLOBAL dropdowns
  **Activation sound** / **Loop sound** (`anticipation.activationSound` / `loopSound`, options from
  `engine-flow-v2`'s shared `SOUND_EFFECT_NAMES` — the same list Flow/Editor use), and a per-tier
  **Sting volume** slider (`TierFx.stingVolume`) beside the existing **Loop volume**. Full chain:
  client `symbols.client.ts` (type + `pruneAnticipation` config-level allowlist for the two names;
  `stingVolume` rides the generic per-tier filter; `codedTierFx`/`anticipationFieldValue`/`docSignature`
  - two setters) → `.strict` Zod (`anticipationSchema.activationSound/loopSound`,
    `anticipationTierFxSchema.stingVolume`, `pruneAnticipation`) → export passes `anticipation` VERBATIM
    (no field enumeration touched) → `editor-scenes` baked shape (`activationSound?/loopSound?` typed
    `SoundEffectName`, `AnticipationTierFxOverride.stingVolume?`) → engine resolvers
    `resolveActivationSound()` / `resolveLoopSound()` (authored ?? coded `sfx_anticipation_start` /
    `sfx_anticipation`) + `resolveTierFx().stingVolume`. `Anticipations.svelte` now fires the activation
    STING (`soundOnce`, per-play volume = tier `stingVolume`) alongside the loop, both via the resolvers
    instead of hardcoded names. **New per-play volume on the once-player:** `soundOnce` broadcast gained
    optional `volume` threaded `Sound.svelte` → `createPlayOnce` (multiplies with master SFX via
    `initSoundVolume`); a `soundOnce` without `volume` is byte-identical. ⚠️ **Behaviour note:** on this
    branch the sting (`sfx_anticipation_start`) was in the audiosprite but NEVER broadcast — only the loop
    played — so wiring it is a deliberate feature ADD; the LOOP stays byte-identical, the STING now plays
    the coded name/ramp for un-authored projects. Offline round-trip: 14/14 over the REAL
    `normalizeSymbolsDoc` + client setters/`codedTierFx` (esbuild-bundled) — authored `{X,Y,stingVolume,
soundVolume}` survives client+server; empty doc ⇒ no `anticipation`. Both `launcher-api` + `lines`
    builds green. **Book of Borut needs an `engine` submodule bump** to receive it.
- **Dynamic anticipation tiers = config big-win tiers** (2026-08-05, branch
  `engine/anticipation-dynamic-tiers`, default OFF ⇒ byte-parity). Replaced the HARDCODED
  big/mega/massive triple (engine `AnticipationTier` union, `tierForLevel`, `ANTICIPATION_TIER_FX`,
  `TIER_RANK`, and the panel's three fixed columns) with a GENERIC model mirroring the config's
  big-win tiers ("no hardcoding" rule). New engine contract: `gameConfig.activeBigTiers()` (the
  `winLevels` `type==='big'` tiers ascending, `{alias,name,threshold}`; `activeBigTierThresholds`
  derives from it); `utils-slots` `AnticipationTier`/`ReelAnticipationArming.tier` widened to an
  opaque `string` alias; `anticipation.ts` stamps the reached tier's ALIAS (`activeBigTiers()[level-1]`)
  instead of a clamped label; `anticipationPresentation.ts` `codedTierFx(rank, count)` is a coded RAMP
  (zoom 1.1→1.32, scale 1→1.24, alpha 0.85→1, vol 0.7→1, tint white→#ff5a3c) interpolated across the
  configured big tiers — the ONE fallback; `resolveTierFx(alias)` looks the alias' rank up in
  `activeBigTiers()` and merges the authored `tiers[alias]` over the ramp; `activeMaxTier()` returns
  the alias of the highest-level active reel (`string|null`). Baked/schema `anticipation.tiers` →
  alias-keyed `Record<string, TierFx>` (engine `editor-scenes`, launcher `symbolsStorage`
  `z.record(z.string(), …)`, `bake-editor-doc.mjs` dynamic-record parse, client `symbols.client.ts`).
  Panel: `/symbols` `+page.server.ts` calls new `gameConfigDefaults.resolveBigTiers()` (resolves the
  same authored→template config the game uses, filters `type==='big'`) → `data.bigTiers`; the panel
  renders ONE column per big tier (header = tier NAME, default sliders from the ramp at that rank/count)
  and shows a "add big-win tiers in /config first" note when there are none. Verified:
  `pnpm --filter lines build` + `pnpm --filter launcher-api build` green; alias-keyed schema+bake
  round-trip fixture passes (dynamic aliases superwin/epic/max, empty-tier pruning, `.strict` reject,
  bake==prune). ⏳ **Owner visual-verify** (auth-gated tool + tease armed from Flow on a reachable big
  win). **Book of Borut needs an `engine` submodule bump** to receive it. Engine Phase 6 = ship
  (runtime release + refresh + submodule bump).
- **Stacked pictures — one config block, baked** (2026-08-06, branch
  `engine/stacked-config-symbols-tool`, default OFF ⇒ byte-parity). Redesign of the earlier
  tool-only toggle: ALL stacked config now lives in ONE **"Stacked pictures"** section (above Win
  lines), and the tall picture is the ONLY thing a stacked symbol shows. The old `stacked` GRID
  COLUMN is **removed** — `visibleStatesFor(gameType)` never renders it (the `stacked` member stays
  in engine-layout as an engine fallback; only the tool stopped drawing the column). The block: a
  **multi-select** of symbol names (chips), and per selected symbol a **height** (cells tall, ≥ 1)
  - an **art picker** (the same side-panel sprite/spine/flipbook picker the grid cells use, reused
    via the shared `draft` machinery — Apply writes the stacked art instead of a grid override) with a
    live preview. Schema `stackedPictures` extended to `{ enabled?, symbols?: [{ name, height, art }] }`
    (`art` = the existing per-cell `symbolCellSchema`); sparse — a disabled/un-authored project
    persists nothing. **Now BAKED** (unlike the old toggle): gated on the master toggle + ≥1 symbol,
    the exporter ships each tall `art` asset via the SAME `refs` as a per-cell binding (spine →
    `index.spines`, sprite → `index.sheets`) and emits
    `bundle.symbols.stacked = { symbols: [{ name, height, art }] }` (art reduced to
    `type/assetKey/animationName?/clipId?`, no `sizeRatios`); `bake-editor-doc.mjs` rebuilds it on a
    defensive whitelist; the runtime bundle passes it verbatim. Files:
    `symbolsStorage.ts` (`stackedSymbolSchema`/`pruneStackedPictures`), `symbols.client.ts`
    (`StackedSymbol` type + `addStackedSymbol`/`removeStackedSymbol`/`setStackedSymbolHeight`/
    `setStackedSymbolArt`/`docSignature`), `symbolExport.ts` (`addCellRefs` + `stacked` emit),
    `bake-editor-doc.mjs`, `+page.svelte`. Verified offline: Node fixture over the real zod schema
    proving the schema→normalize→export→bake round-trip + the contract shape (spine + sprite +
    flipbook art, sizeRatios stripped, blank-art rejected/pruned, height int≥1, `.strict` reject) and
    a Svelte-5 compile of the page (0 warnings). **Engine still owns the runtime** — this track only
    produces the baked contract; the engine team builds `bundle.symbols.stacked` (a **Book of Borut
    submodule bump** delivers it once both tracks land). Old sparse doc-global
    `{ enabled?: boolean }` superseded (the toggle now also gates the bake).
- **Full deploy chain** (export → `deploy/editor-symbols/` → bake → pull → register):
  spine-aware `symbolExport.ts`, `POST /api/editor/export-symbols`, `bake-editor-doc.mjs`
  wiring, `pull-project-assets.mjs` prune entry, `bakedSymbolMap()` / `bakedSymbolAssets()`.
- **Symbol size is NOT authored here** — it moved to `reelGrid.symbolSizeRatios` on the
  reel, edited in the Scene Editor; a baked per-cell `sizeRatios` is honoured for back-compat
  reads only.

## Open items / next

1. **S5 — prove end-to-end on Book of Borut.** Mirror the S1 engine contract
   (`symbolMap.ts` / `getSymbolInfo`) into Book of Borut's own `src/game/*`, keep symbol
   frame names unique across bound sheets, verify the shared-spine fallback, then actually
   rebind a symbol online → tokened rebuild → republish → confirm the new asset/animation
   in-game.
2. **Preview endpoints are still `editor`-gated** (`/api/editor/regions`, `/api/editor/spine`)
   — a user holding **only** the `symbols` tool gets a 403 on previews. Default roles hold
   both, so it only bites a narrowly-scoped role.
3. **Default-art cells render as placeholder chips until project assets are seeded into R2**
   (sprites under `sheets/`/`manifests/`, spines under `spines/`). Spine _default_ cells stay
   chips regardless — only a rebind stores a full bundle prefix that previews.
4. **No dedicated `symbols` agent file** — `.claude/agents/symbols.md` does not exist
   (see the four-surfaces model in `docs/status/README.md`).
5. **`bookVfx` + `transition` can carry a `blendMode` but no control offers one.** Cell layers
   put the field on the SHARED layer schema (deliberately — one shape, one renderer), so the two
   older layer consumers accept, persist, sign and render a mode today; only their panels never ask
   for one. Adding two `<select>`s gated on `canBlendLayerKind` is the whole job.
6. **Cell layers are not composited in any preview.** The grid says `+N layers`; the panel previews
   each layer alone; no blend result is shown anywhere. The blocker is the grid's ONE shared WebGL
   canvas (a context-count limit) — a faithful composite of a spine base with a blended sprite over
   it is not available there. A panel-only DOM composite (sprite/flipbook layers over a sprite base,
   CSS `mix-blend-mode`) IS achievable and is the obvious next increment; it would still not cover a
   spine base.
7. **A stacked picture's `art`/`winArt` reuses `symbolCellSchema`, so it now ACCEPTS `layers`** —
   but nothing authors them there and `stackedArt()` strips them at export, so they would not ship.
   Either wire them through or narrow that schema; today it is a silent no-op, not a bug.

## Blocked (owner / external)

- Several items above are ⏳ owner visual-verify (FX full-transform parity across
  `/symbols` / `/rigger` / game; the win-line drawing on a real win).

## Recent changes

- 2026-09-17 — **A layer's blend rides the RENDERABLE, not the wrapping container.** Review change
  on top of the `layers[]` build. `SymbolLayer` originally set `blendMode` on the one `<Container>`
  wrapping every arm. That is equivalent for Pixi's GPU-native modes, which inherit down the subtree
  via `groupBlendMode` — measured: a container at `multiply` visibly darkens its child. It is NOT
  known to be equivalent for the ADVANCED modes (`overlay`, `lighten`), which are backdrop-reading
  filters; a renderable carrying one is the path verified to draw in a running game, a container
  carrying one is not. Since `overlay`/`lighten` are the two modes the feature exists for, the prop
  moved to `<Sprite>` and `<Flipbook>`. The `fx` arm keeps container-level blending because an
  `<EffectPlayer>` owns its own particle containers and has no single renderable to carry it — the
  same shape `<LayoutNodeView>`'s placed-effect branch already ships, and the same open question
  rides with it. Pinned by 5 new assertions in `check:symbol-layers` (51 total), proven non-vacuous
  by hoisting the prop back and watching the guard fail.

- 2026-09-16 — **A parked win now releases on the MOUSE, not just Space.** Owner report: with
  `waitForPress` on, the space bar skipped the win but the left mouse button did nothing — "these 2
  should always be paired". A defect in the park, one line deep.

  - **Why the two inputs disagreed.** Every `PressToContinue` owns its OWN Space hotkey and fires it
    directly, so Space runs EVERY live press surface. The POINTER does not: `<ContinuePressMask>`
    routes a click to the TOP registered press alone. A project whose scene carries an authored
    `tapToContinue` armed on `winCountUpComplete` therefore has two surfaces up at once, and a click
    reaches only theirs.
  - `releaseWinDismissHold()` already exists precisely for that collision — the authored tap calls it
    so the gate's hold is releasable by EITHER surface. The park added a SECOND latch
    (`dismissPressed`) and never wired it in, so that release was only half a release: it cleared
    `escalationOutroComplete` and left the park waiting for a press that had already happened.
  - Fix: `releaseWinDismissHold()` sets both latches. Pinned by a new assertion in
    `pnpm check:big-win-cue` (18 now, mutation-tested).
  - Verified live: `parked, holding…` → `releaseWinDismissHold called, armed = true` → `park
released; pressed = true`, overlay closed, round settled.
  - Still asymmetric by design elsewhere: Space fires every live surface, the pointer only the top.
    That predates the park and is untouched here.

- 2026-09-16 — **A win screen can PARK on the player.** Owner report: the big win "disappears without
  a tap". Not a regression — their flow owns `setWin` (so the engine mounts the headless driver and
  the coded press-anywhere is suppressed by design), authors no win container with a tap-to-continue,
  and leaves the `winUpdate` node's two interaction toggles unticked. Result: no tap surface anywhere,
  and the celebration plays to nobody and closes itself.

  - New optional **`waitForPress`** on the `winUpdate` action node, beside `holdToSpeedUp` /
    `tapToSkip` — it is the same KIND of thing (a per-instance count-up interaction authored on that
    node), not a global. Unset ⇒ OFF ⇒ byte-identical.
  - The hold it arms ALREADY existed (`winState.awaitingDismiss` + the gate's dismiss
    `PressToContinue`); it could only be armed BY a tap, so a game with no tap surface could never
    reach it. This arms it from the AUTHOR's intent instead. Two guards: a slam skips the park (the
    player asked to move on) and `flowHoldsPresentation` skips it (an authored container already owns
    the beat — arming would put a second tap surface under its own).
  - Held in `concludePresentation` AFTER the escalation outro, so an escalating win still walks its
    chain and plays its outro first: the park is the beat after the celebration, not instead of it.
  - The press is LATCHED (`winState.dismissPressed`) like `countUpComplete`, because an instant
    count-up can finish in the tick it mounts and a promise that missed the press would hold the round
    for the whole cap.
  - Bounded by a new `PARK_HOLD_CAP_MS` (5 min) — NOT the 10s `DISMISS_HOLD_CAP_MS`, which bounds an
    accident (tapped to land, then put the phone down) where this bounds an intention. Still capped
    because the spin button is locked during the celebration, so a slam is not always reachable and an
    abandoned autoplay run would otherwise block the round forever.
  - Verified live: parked at t=0, still on screen 45s later, `released … pressed = true` on the press,
    round settled. Guard: `pnpm check:big-win-cue` now 17 assertions (8 new, mutation-tested) pinning
    every link of the /flow → payload → effect → event → gate chain, since a break anywhere is silent.

- 2026-09-16 — **The big-win run-up was dead on the only path that matters, and the overlay restarted
  the count.** Owner report: "I get the Big win overlay right away starting to count from 0." Two
  distinct bugs in yesterday's cue.

  - **PLACEMENT.** The cue was invoked from the coded `setWin` handler and the v2 `winShow` EFFECT.
    A v2 flow that OWNS `setWin` never reaches the coded handler, and the authored choreography is
    `seq(broadcast('winShow'), effect('winShow', …), …)` — so by the time the effect ran the overlay
    was already on screen, and it wires no `amount`, so the cue self-gated to a no-op. It now runs at
    `dispatchBookEvent` (`game/utils.ts`), the ONE seam every dispatch path crosses — the same seam
    `showAllWinLines` and `recordWinCycleWins` live on, for exactly the same reason. One call site.
  - **THE HANDOFF.** The overlay's count-up restarted at 0 instead of continuing from where the run-up
    stopped, so the number the player was reading jumped backwards. The cue now publishes
    `winState.cueHandoffAmount`, `WinCountUpProvider` takes an opt-in `startFrom` (default 0 ⇒
    byte-identical for the free-spin outro and every un-cued win), and `WinGate` seeds the count from
    it. Cleared on `winHide` and deliberately NOT on `winShow` — the cue runs BEFORE the overlay
    shows, so clearing there would throw away the very number the win was handed.
  - `amount` now only CAPS the target instead of gating it: on a big win the cap cannot bind (the win
    reached a big tier, so it is at least the smallest big threshold), so an unknown amount no longer
    silently disables the cue.
  - **Guard:** `pnpm check:big-win-cue` (`scripts/check-big-win-cue.mjs`) — 9 source assertions
    pinning the placement and the handoff, mutation-tested. Nothing else would notice this regression:
    a silent no-op looks exactly like "the author didn't turn it on".
  - Verified live (book mock, `BIG_WIN=1`, a 120× round): `cue reached {amount: 12000, type: big}` →
    `cue landed, handoff = 1000` → `count-up provider seeded at 1000 → 12000`. The overlay now picks
    the number up at $10.00 (the first big tier) and carries it to $120.00.

- 2026-09-15 — **The win amount can COUNT, and the count can be what announces the big win.** Owner
  request; three controls in **/symbols → Win amount text**, in a new **Count up** group under the
  style fields. All default OFF, which is the whole parity argument: the stamp is on the beat every
  paying spin runs, in every game on the shared `runtime:lines` bundle.

  - **`text.countUp`** + **`text.countUpDuration`** (seconds, coded default `0.6`): the stamp runs
    from zero to the win instead of appearing whole, and the narration AWAITS it — the symbols
    celebrate after the number lands, not over it. Every counting FRAME is re-rendered through the
    same authored `amountFormat` + currency formatter as the value that lands: `winLineTextFor` now
    also returns `amountValue` (the raw book target) and `amountAt(value)`, and every `winLineShow`
    dispatch site already spreads `...winLineTextFor({…})`, so they inherit it with no call-site
    edit — parity by construction.
  - **`text.fadeIn`** + **`text.fadeInDuration`** (coded default `0.3`) is deliberately NOT awaited:
    it runs WHILE the count does, so the number is already moving as the stamp arrives. Independent
    of the count — a stamp that appears whole can fade in too.
  - **`text.cueBigWin`** is the one the owner actually asked for. On a round that reaches a big
    tier the amount text becomes the big win's RUN-UP: the **round TOTAL** (not one payline's
    payout) is stamped centred — whatever `placement` says, because a total did not land on a line
    — and counted `0 → the smallest big-win threshold`, capped at the round's own total. At that
    number it HIDES and the overlay comes up and carries the count the rest of the way. One number,
    two renderers; the cue stops exactly where the overlay starts.
  - **The cue is a no-op on every axis that could make it wrong**: switch off, `text.enabled` off,
    not a `big` win level, a slammed round, no big tier in the Game Config, or a non-positive
    target. Shared by BOTH dispatch paths — `bookEventHandlerMap.setWin` and the flow-v2 `winShow`
    effect both await `cueBigWinCountUp` immediately before the overlay flags — for the same reason
    `winLineTextFor` is: two hand-kept copies drift. The v2 path passes
    `numberOrUndefined(payload.amount) ?? 0`, because an authored `winShow` node need not wire
    `amount` and the `target <= 0` gate then returns rather than counting to NaN.
  - **Two new emitter cues** (`winAmountCue` / `winAmountCueHide`) and a separate `$state` cue stamp
    in `WinLine.svelte`, held apart from `lines`: it belongs to the ROUND, so it has no points to
    trace and no key to merge on. `awaitPresentation` → `broadcastAsync` resolves on
    `Promise.all([])` when `WinLine` is unmounted, so an unmounted host degrades to a no-op instead
    of hanging the round.
  - **Watch the flow-vocabulary codegen.** `scripts/gen-flow-vocabulary.mjs` walks the emitter union
    counting `{ < ( [` against `} > ) ]` and stops at the first `;` at depth 0, so an inline
    `(value: number) => string` field type reads as an unbalanced `>` and silently drops the WHOLE
    union from the `/flow` palette (hence the named `WinAmountFormatter` alias), and a `;` inside a
    doc comment truncates it. A doc comment in front of `type:` also loses that member, since the
    discriminant is read from the member's first field — so the new member's comment sits outside
    its braces. Regenerate with `node scripts/gen-flow-vocabulary.mjs`; `--check` is green.
  - **Verified LIVE** (dev, `scripts/mock-rgs-server-book.mjs` with `BIG_WIN=1`, the switches forced
    on): each paying line stamped a counted + faded amount (`$0.00` → `$100.00`), and a 120× round
    broadcast the cue at target `1000` book units — the smallest big tier (10×) on a $1 bet — which
    landed, hid, and handed over to the big-win overlay. Offline contract check:
    `pnpm --filter launcher-api exec tsx --tsconfig tsconfig.scripts.json
scripts/check-win-amount-count-up.ts` (32 assertions over the REAL `setWinLineText` +
    `normalizeSymbolsDoc`, so the client and server prunes cannot drift). Runtime release + Borut
    `engine` submodule bump owed.

- 2026-09-15 — **The round can be released when the symbols are back, instead of when their intros finish.** Owner report: a delay on EVERY spin, win or not, plus an identical-feeling pause between two wins of one cascading spin. Measured on the live `test6` in a real browser at **136–204 fps** (not a throttled tab): `reveal` took **3.0–3.4 s per spin** and a cascade step ~2.14 s; inside one 3401 ms `reveal` the board's own clips were finished at **t+2088** and the round released at **t+3401**. The 1.3 s tail is not animation, it is the round WAITING on the emerge arrival beat, which takes the long `INTRO_BEAT_CAP_MS` (2 s) branch because the project authors an `intro`. No authored value is touched by the fix — not the tumble pattern's `stepMs`, not a clip's frame rate, not `clearBoard` — so the switch is a new doc-global, `arrivalRelease: { enabled? }`, default OFF.

  - **What ON means, precisely.** Nothing is shortened. The intro still plays in full, and still settles its cell to the resting art on BOTH exits of its own bounded race, so a cell whose art can never report is still put right rather than frozen mid-rise. The beat is DETACHED, not skipped: only the awaiting stops, and the board is released the moment every cell has been seated with its new art. The accepted trade is that the next spin may begin over an intro still playing — which is why it is a switch and not a new default. Only meaningful under the `emerge` swap style, the only board with an arrival to wait on.
  - **Launcher side (this task).** `.strict` Zod beside `winExplodeSchema` + the sparse rebuild in `normalizeSymbolsDoc` (only ON persists); the `SymbolExportResult` field + verbatim pass-through in `symbolExport.ts`; the `/api/editor/export-symbols` destructure **and** response; the client type, `arrivalReleaseEnabled`, `setArrivalReleaseEnabled` and the **dirty signature** line (missing it means the switch flips, the page never goes dirty, and Save stays disabled); the bake whitelist's rebuild + its line in the baked `symbols` block; a new section under "Winning symbols explode", shown when the project is on `emerge` OR the flag is already authored (so it can always be turned off); and a `gameProfile` chip.
  - **One decision worth keeping.** The SAVE does not consult the project's reel behaviour. The symbols doc and the config doc are edited independently, and a flag silently dropped because `/config` currently says `emerge` is off would come back as a switch that will not stay on — the class of bug the sparse-write contract exists to avoid. Only the tool's SECTION is gated on the swap style, and it stays visible while the flag is set (with a note saying it changes nothing as things stand).
  - **Gate.** `check-clear-reel-and-win-explode.ts` grew a part 10 (95 → **111 checks**) over the REAL `normalizeSymbolsDoc` + the REAL client setters: an untouched doc persists nothing and reads OFF; explicit OFF still persists nothing; ON round-trips; an unknown key and a non-boolean are `ZodError`s; a non-emerge project still keeps the flag it saved; the setter turns it on and deletes it again; turning it on moves the dirty signature and the saved doc signs the same as the draft; and the exporter, the endpoint and the bake whitelist all carry it. Mutation-verified both ways: deleting the `docSignature` line fails "turning it on marks the page DIRTY", deleting the bake bundle line fails "…and puts it on the bundle"; restoring each goes back to 111/111.
  - **Engine change — needs a runtime release to reach the online games and a Borut `engine` submodule bump for the remake.** ⏳ owner visual-verify: switch it on for a cascading emerge project, save, rebuild, and watch a fast round for an intro the next spin starts over.

- 2026-09-15 — **`check:tumble-pattern` was red on every Windows clone, and the trap is the one `check:clear-reel` hit five days earlier.** It reported `1 of 34 FAILED` on any checkout with `core.autocrlf=true` while nothing was wrong: its `read()` handed raw file text to `/\n\t\t\t\ttumblePattern,\n/`, and the whitelist line in `bake-editor-doc.mjs` — present and correct — ends `tumblePattern,\r\n`, so the pattern's TRAILING newline never matched. Exactly 1 of 34 and not more because the sibling assertion on the export endpoint (`/\n\t\t\ttumblePattern,/`) has no trailing `\n` and matched all along: **a LEADING `\n` survives CRLF, a trailing one does not** — which is why this fails in ones and twos rather than obviously, and reads like a real contract breach. Fixed by normalizing in `read()`, copying the helper and its comment verbatim from `check-clear-reel-and-win-explode.ts`, which was given exactly this fix on 2026-09-10 (see that entry below); this file predates it and never picked it up.

  - **The convention, for the next guard that greps source.** Fourteen of this repo's offline guards already normalize (`readFileSync(…).replace(/\r\n/g, '\n')`; seventeen files in all, counting fixtures and the sync scripts). A new one asserting on a pattern that names a line break MUST too, or it is red on Windows for a reason that has nothing to do with its claim — and the danger is not the red, it is the repair: a guard that cries wolf gets ignored, or "fixed" by weakening the assertion, which is how a bundle-path check stops checking. Both incidents were found by someone hitting the failure locally, never by CI, because CI runs on LF.
  - **Audited the rest of them, nothing else is latent.** The four other guards that read source without normalizing — `verify-boot-splash`, `verify-clip-reachability`, `verify-scaffold-template`, `verify-win-beat-budget` — all PASS on a CRLF checkout: their newline patterns are `split('\n')` / leading-`\n` shapes, not the trailing-`\n` shape CRLF breaks. They are fine today by luck of shape, not by design, so the rule above still applies if one grows an assertion.
  - **Harness only** — `bake-editor-doc.mjs` and everything it emits untouched, count unchanged at **34**. Mutation-verified that the assertion is still live: deleting the whitelist line from the bake script fails exactly that check, restoring it goes green.

- 2026-09-15 — **An authored ceiling on the win beat, because the only bound on it was a guard that was never meant to be the timing.** Owner report: on `test6` the wait before the next spin is released is long. Measured there — every symbol's `win` is the spine animation `Pull` at **2.00 s** and its `explosion` is `Take` at **0.50 s**, and the project cascades, so a three-tumble winning round narrates three wins and pays ~2.5 s of symbol beats per win on top of the reel spin and the cascade steps. The only thing bounding those beats was `WIN_BEAT_CAP_MS` (4 s), which is explicitly a **runaway guard** for art that can never report `oncomplete` — so the fix is a separate, explicit **shaper**, not an exposed guard: `winBeat.maxMs`, absent by default (today's behaviour byte-for-byte) and, when set, the longest any single win/explosion beat may run.

  - **Launcher side (this task).** `.strict` Zod (`z.number().int().min(50).max(10000)`) + the sparse rebuild in `normalizeSymbolsDoc`; the `SymbolExportResult` field + verbatim pass-through in `symbolExport.ts`; the `/api/editor/export-symbols` destructure **and** response (the bake reads that response, so omitting either half is the recurring "reach BOTH bundle paths" bug); the client type, `winBeatMaxMs`, `setWinBeatMaxMs` and the **dirty signature** (the link `holdAfterBigWin` once missed, which made a saved switch unsaveable); the bake whitelist's rebuild + its line in the baked `symbols` block; a **Longest win beat (ms)** number input in the "Winning symbols explode" section; and a `gameProfile` chip.
  - **Two decisions worth keeping.** The range is enforced at SAVE rather than clamped at play — a value the engine could not honour is a typo, and a typo that is silently ignored looks exactly like one that was applied to art nobody is watching at build time. And the CLIENT setter rounds + clamps into that same range, because the input hands back whatever was typed and a doc the schema refuses fails the WHOLE save, not just this field (the publish/cell-schema 400 trap). It is committed on `change`, not `input`, so the clamp cannot rewrite "5" to "50" under the cursor on the way to 500.
  - **Gate.** `check-clear-reel-and-win-explode.ts` grew a part 9 (74 → **95 checks**) over the REAL `normalizeSymbolsDoc` + the REAL client setters: an untouched doc persists nothing and reads as `null`; a value round-trips; both ends of the range survive; under/over/fractional/string/unknown-key are all rejected as `ZodError`; the setter clamps, and the clamped draft then survives the server; clearing signs identical to never having typed one; and the exporter, the endpoint and the bake whitelist all carry it. In the same pass, part 8's `…bounded by the win-beat cap` was re-aimed: it grepped the literal `WIN_BEAT_CAP_MS` in the pop, which now reads its cap from `resolveWinBeatBudget(bakedWinBeatMaxMs())`, so it asserts instead that BOTH beats resolve the same budget — which is what makes "cap each win at N" bound a paying cell's total cost rather than half of it. (The file keeps its name; renaming it means chasing whatever invokes it, and its header now lists what it covers.)
  - **Engine change — needs a runtime release to reach the online games and a Borut `engine` submodule bump for the remake.** ⏳ owner visual-verify: type a ceiling on a cascading project, save, rebuild, and watch a three-tumble round.

- 2026-09-11 — **The pop is once per paying SPIN, on the board that paid — and a slammed spin no longer freezes for four seconds.** Adversarial review of `860ba8d3` + `e614dddf` confirmed two blockers, each reproduced empirically. Both fixed on `symbols/win-explode-removes`.

  - **BLOCKER 1 — a slammed paying spin froze ~4s, and the test that “proved” slam works was vacuous.** A slam trips `roundSkip` at `winInfo`, so `awaitCue` returns `slamHold(200)` and DROPS the subscriber promise: `Board.svelte`'s `boardWithAnimateSymbols` keeps running DETACHED inside `Promise.all([awaitSymbolBeat(win, 4000), waitForTimeout(WIN_BEAT_MIN_MS = 650)])`. The handler therefore finished early and `playBet`'s `finally` reached the pop at t≈600, which set `symbolState = 'explosion'` and re-armed `oncomplete` — and then at t=650 the detached beat's floor elapsed and unconditionally wrote `postWinStatic` over it. `ReelSymbol` forwards `oncomplete` only while the state that armed the beat is still on the cell, so the explosion's completion was discarded and the pop settled on `WIN_BEAT_CAP_MS`: **pop `@600` → done `@4600`** (vs `@650`/`@850` unslammed), spin button locked the whole time (`playGame` is a promise actor). **Structural, not a knife-edge**: the last win's beat settles at `(W-1)·H + 650` while the pop starts at `W·H`, and the per-win slam hold `H` is 200 ms (600 with a message) — always under the floor, so it lands 50 ms inside the pop for ANY number of wins (the two-win case measured 5200).
    - **Fix: a beat settles only the state IT set.** The win beat's revert is guarded on `symbolState === 'win'` and the pop's on `=== 'explosion'`; the pop's REMOVAL stays unconditional, because “explode and be gone” has to hold on both exits of the race. A state check rather than an ownership token, deliberately — a cell a second win of the same spin re-lit still reads `win` and is still reverted, which is exactly what the pop being OFF does, so ON and OFF stay identical. `winLineColor` rides the same guard (it is only read in the `win` state, `Symbol.svelte`'s `showWinFrame`). After: **pop `@600` → done `@800`**; two wins 1200 → 1400.
    - **The harness was lying, twice.** `makeCell` fired `oncomplete()` from a timer regardless of the cell's current state, so it did not model `ReelSymbol`'s forward gate at all — it now fires only if the armed state is still on the cell, and the REAL gate is sliced out of `ReelSymbol.svelte` and evaluated over the truth table beside it, with the fixture asserted to agree. And the “slammed round” run was **vacuous**: `playBet` calls `roundSkip.reset()` before the first book event, so a world built pre-tripped was byte-identical to an unslammed one; the press now lands where a player presses (as the win narrates), and the `showWinInfoMessage` stub answers `true` so the 400 ms message hold is real.
  - **BLOCKER 2 — the pop fired once per BOOK, not once per SPIN, so most paying spins still double-popped.** `playBet` runs once per BOOK (`playBookEvents(bet.state)` — a bonus book carries ~10 spins inside that one call) while `recordWinCycleWins` resets `wins` on EVERY `reveal`/`tumbleBoard`, and `roundWinningPositions()` reads that same list. So the `finally` pop only ever saw the wins recorded after the FINAL board change. Measured against this repo's own reference books: **`base_books.ts` 5255 of 7480 paying spins popped — 2225 lost across 977 books; `bonus_books.ts` 23 of 250 — 227 lost across 96 of the 100 books.** A mid-book winner never marked `removed` is then swept by the next board's clear playing `clearReel` — **the exact double pop the feature exists to prevent**, on the majority of paying spins.
    - **Fix: the pop fires where the record is CLEARED.** `REPLACES_THE_BOARD` (`reveal`, `tumbleBoard`) is declared once in `winSymbolCycle.ts` and read by both `recordWinCycleWins` and the new `explodeWinnersBeforeBoardChange(bookEvent)`, which `playBookEvents` awaits at the top of BOTH dispatch branches — so **every clear is preceded by a pop**, on the LIVE board, before the event that replaces it. `playBet`'s `finally` (renamed `explodeSpinWinners`) and `freeSpinHold.holdAfterBigWin` still cover the book's last spin, which no board change follows; they cannot double-pop because the set drops anything already gone. `playBet` also drops the previous round's recorded wins up front (`forgetWinCycleWins`), so a new round can never open by popping the last one's set — the leak a stacked-COVERED seat makes real, since the pop cannot remove one.
    - **Free-spin transitions were checked and deliberately left out.** `freeSpinTrigger` / `freeSpinEnd` cover the board with a screen but do not REPLACE it: the wins are still on that board when the next real boundary arrives (the feature's first `reveal`, or the round's `finally`), so adding them would buy a second no-op pop rather than coverage.
    - After: **7480/7480 and 250/250 paying spins pop, no book left short, never more pops than the book paid.**
  - **Gates.** `scripts/verify-win-explode-pop.mjs` 98 → **168 checks**, with two new parts driven on the virtual clock: part 10 times a slammed spin through the REAL `playBet` (and asserts the press is real — without it the run reports the unslammed numbers), part 11 drives multi-spin books (free spins and a cascade) through the REAL `playBookEvents` with the board REBUILT at every board change exactly as `createReelSymbols` does, then replays the whole reference corpus A/B through the REAL `recordWinCycleWins` + `explodeSpinWinners` with and without the per-spin seam. `check:clear-reel` 65 → **74** (the three seams, both guards, and that the removal stays unconditional). **Sixteen mutations tried, sixteen caught** — including three that only the new coverage catches and two that make the harness itself lie. `verify-swap-in-place-mode.mjs` (644), `verify-tumble-pattern.mjs` (97), `check:symbol-state-parity` (132), `check:sound-bindings`, `check:sounds-doc`, `symbolCell.fixture.ts` and full `pnpm build` all green.
  - **Noted, not fixed (pre-existing, on `main`):** the no-flow branch of `playBookEvents` calls `coded.playBookEvent` DIRECTLY, bypassing `dispatchBookEvent` — so on a game with no FlowDoc, `recordWinCycleWins`, `advanceWinMeter`, `trackCascadeStep`, the all-at-once win lines and `runBookEventPresentation`'s unskippable carve-out never run. The pop is placed at the `playBookEvents` seam (which BOTH branches cross) so it is already wired for whenever that is fixed, but with no wins recorded it stays inert on a coded-only game — exactly as it is today.
  - **Engine change — needs a runtime release to reach the online games and a Borut `engine` submodule bump for the remake.** ⏳ owner visual-verify.

- 2026-09-10 — **The pop is DEFERRED to the end of the round, because a cell two paylines pay on cannot be blown up after the first of them.** Adversarial review of the “explode and be gone” change below: `Board.svelte`'s win handler set `reelSymbol.removed = true` at the end of each win, `ReelSymbol`'s `{#if !covered && !removed}` unmounted the subtree, and that cell's `oncomplete` could then never fire again. But a round presents its wins ONE AFTER ANOTHER over the same board (`bookEventHandlerMap.winInfo` → `await sequence(bookEvent.wins, …)` → `animateSymbols` per win) and **overlapping paylines share cells** — `config.ts` line 1 `[0,0,0,0,0]`, line 6 `[0,0,1,2,2]` and line 18 `[0,0,2,0,0]` all pay on reels 0-1 of row 0. Scanned through the real `winningPositionsOf`, **1970 of the 7480 `winInfo` events in `base_books.ts` (26%) have at least one cell paid by two wins.** So win A popped and removed a cell, win B re-lit it, `awaitSymbolBeat` settled only on `WIN_BEAT_CAP_MS` (4000ms), and the pop then armed a second unfirable `oncomplete` for another 4000ms: **~8s of frozen presentation per shared cell on about a quarter of paying spins**, spin button disabled, win line tracing empty seats, with nothing below the cap to bound it (`awaitCue` races only the slam token).
  - **The fix is not a guard, it is the sequencing.** A `removed` guard in the win beat would have stopped the stall and left the later paylines tracing through empty seats — a win lighting a partial set of its own symbols, which is visibly broken. Instead the explosion happens **ONCE, after every win in the round has narrated**: each win lights and narrates unchanged (byte-identical to the switch being OFF, asserted as an identical transition log at identical virtual times), and then the round's accumulated winning cells all play `explosion` together and vanish. Concurrent, so the whole pop is ONE bounded beat however many cells paid.
  - **The seam is the one the resting replay already uses** — `playBet`'s `finally` (which every dispatch path crosses: coded handler map, v1 flow, v2 flow, a slammed round, a round whose book threw) and the between-spins hold (`freeSpinHold.holdAfterBigWin`). `winSymbolCycle` was already ACCUMULATING the spin's winning positions across `winInfo` events and de-duplicating them (it had to: the Play4Fun facade the shipped games run on flushes one event per win), so the set was already being built — `explodeRoundWinners()` de-dupes it once more BY SEAT, drops anything already gone, and broadcasts one new `boardExplodeWinSymbols` cue. Awaited BEFORE `startWinCycle`, which is what makes “the board simply rests” a fact rather than a race. A round that paid nothing broadcasts nothing; the switch off broadcasts nothing.
  - **The MAJOR, re-derived and still real.** `createTumbleSymbol` birthed a win-removed cell `clearReel`, and `tumbleBoardRemoveExploded` filters `base` by `symbolState !== 'clearReel'` without consulting the step's exploding set — so a cascade step could lose a seat the BOOK never named while `adding` was sized to `bookEvent.explodingSymbols`, `tumbleBoardCombined()` would come up short, be broadcast as `boardSettle`, and `combineTumbleReel`'s “baseReel[0] is the top pad” assumption would start pointing at a real symbol. The deferred pop makes that unreachable on an ordinary book (nothing is removed until after the last cascade step) but NOT on the big-win hold, and the invariant was incidental either way. Fixed structurally: a removed seat is now born **UNDRAWN (`exploded`) but ORDINARY (`static`)**, and the explode step MARKS an already-gone seat `clearReel` before returning — so the board CLEAR (which names every visible seat) still sweeps it with the rest, while a cascade leaves a seat it never named exactly where it is. `visibleColumnPositions` accordingly stopped filtering the removal set out of the clear's exploding set: the `exploded` early return already costs nothing, and keeping the set equal to the seats the step OWNS is what the removal after it is keyed on.
  - **The review also judged the previous tests weaker than claimed, and all five gaps are closed.** New `scripts/verify-win-explode-pop.mjs` (**98 checks**) drives the REAL coded `winInfo` handler → REAL `animateSymbols` → REAL `Board.svelte` handlers on a virtual clock: the corpus scan; a two-win shared-cell event asserting every paying cell of every win is lit and the round costs two ordinary win beats rather than a cap (anchored by a run where the art never reports, which costs 8000); the pop's deduped set, its single explosion per cell and its removal on BOTH exits; the REAL `playBet`/`playBookEvents` evaluated down all four paths plus a throwing round; the REAL `holdAfterBigWin`; the REAL `ReelSymbol` `{#if}` and its `removed` derivation evaluated over the truth table (was a regex on the `{#if}` line); `boardRaw()`/`boardRemoved()` index-alignment over a RAGGED board (was untested); and `cycleEntries` evaluated for exact entries under partial removal (was a source grep). `check:clear-reel` part 8 is now containment (“the win beat's body removes nothing”) rather than ordering, and 52 → **65 checks**. `verify-swap-in-place-mode.mjs` 590 → **644**: part 11 drives BOTH arms of the clear over their own arguments (was a call-site count), and a new part 12 drives the REAL cascade step over the REAL survivor-layer factory — which is what proves the MAJOR behaviourally, a column settling short. `verify-tumble-pattern.mjs` 90 → **97** (a step marks only the seats it named). **Eighteen mutations tried, eighteen caught.**
  - Also removed: the now-dead `replay` flag on `boardWithAnimateSymbols` (its only consumer was the per-win pop gate). **Engine change — needs a runtime release to reach the online games, and a Borut `engine` submodule bump for the remake.** ⏳ owner visual-verify.
- 2026-09-10 — **“Explode and be gone”: the win explosion IS the removal, so the second pop is over.** Owner report on `test6` (swap-in-place, **not** cascading, “Clear the board before the new symbols fall in” ticked, “Winning symbols explode” on): a winning spin read **Win → Explosion → Clear reel**. The third beat was the NEXT spin's board clear — `dropInRevealBoard` calls `clearOutgoingSymbols()` at the top of every reveal and it popped EVERY visible cell, the winners that had already exploded included. Owner call: the win explosion is the removal, full stop.
  - **What changed.** A winning cell that plays its `explosion` under the pop is taken OFF the board at the end of that beat instead of reverting to `postWinStatic` — on BOTH exits of the bounded race, so a cell whose art can never report `oncomplete` is just as gone. Symbols that did not pay are untouched: they sit until the next reveal and clear-reel exactly as before.
  - **A flag on the CELL, not a `reel:row` set** (`ReelSymbol.removed`, `utils-slots`) — which is what answers “where is the set cleared”: nowhere, because every board replacement builds fresh cells (`createReelSymbols`, reached by `prepareToSpin` / `preSpinPadding` / `setSymbolsWithRawSymbols`). A key set would have been the next bug: the pre-spin doubles the strip under the same row indices, so a stale key punches a moving hole through the roll. The flag also gives the transition the right picture for free — the removed cells stay removed while the OLD strip rolls away, and the new one arrives whole.
  - **Four readers, each with its own invisible failure** _(three after the deferred-pop entry above)_. `ReelSymbol` stops drawing the cell (`{#if !covered && !removed}`, the shape stacked coverage already uses). `visibleColumnPositions` dropped it from the board clear's exploding set — _(reverted the same day: the overlay’s explode step recognises an already-gone seat and returns before it waits, so the filter bought nothing and made the clear’s removal and its exploding set two different lists — see the deferred-pop entry above.)_ The cascade overlay seeds its survivor layer from it (`createTumbleSymbol({ removed })` → born `exploded` + `clearReel`, so the board-wide removal still sweeps it), or the winners would come BACK for the length of the clear — that layer is built from the resting board and the reel board is hidden throughout — and its explode step skips a seat that is already gone, because a CASCADE explodes what the book names and cannot filter at the source. Published by position as `boardRemoved()`, a sibling of `boardRaw()`.
  - **The resting replay stands down.** `cycleEntries` drops removed cells, so with the pop on every entry drops and `startWinCycle` finds nothing: the board simply rests. The alternative was a cycle re-lighting seats that draw nothing and paying a beat cap per pass for each. **Turning the pop on is therefore a choice against “Winning symbols after the spin”** — said in the guide beside both switches.
  - **Scoped to the win beat.** The Book-of column morph (`expandBookColumns`) uses the same `explosion` state and must not start vanishing — it explodes and then SWAPS to the special symbol — so nothing there removes, and `check:clear-reel` pins that.
  - **Gates.** `check:clear-reel` 33 → **52 checks** (new part 8, including the REAL `visibleColumnPositions` evaluated in Node), `verify-swap-in-place-mode.mjs` 553 → **590** (new part 11 drives a clear over a board with three removed cells: which seats pop, which per-symbol cues fire, what the survivor layer draws, and that the removal sweeps the removed seats with the popped ones), `verify-tumble-pattern.mjs` 84 → **90** (new part 6: a pre-exploded seat is skipped and the step still ends on an ordinary beat rather than the runaway cap). Ten mutations tried, ten caught. Fixed in passing: two `check:clear-reel` bundle-path regexes matched `\n` and so failed on any CRLF working copy (it was 2-of-33 red on Windows before this change) — every source read there now normalizes line endings. **Engine change — needs a runtime release to reach the online games, and a Borut submodule bump for the remake.** ⏳ owner visual-verify.
- 2026-09-10 — **One of the two explosions is not an explosion — it is the board taking a symbol away, so it is called `Clear reel` now.** Owner call. `explosion` and `tumbleExplosion` read as a matched pair and were not one: `explosion` is a symbol popping WHERE IT STANDS while the reel keeps it (the Book-of column morph), while the other is a symbol being TAKEN OFF — fired as much by the swap-in-place board CLEAR, which a swapping lines game runs every single round, as by a cascade. “Tumble” named the one caller that happened to come first.
  - **A pure rename.** `tumbleExplosion` → `clearReel`, “Tumble explosion” → “Clear reel”. Same gate (`cascade || clears`), same `explosion` inheritance, same two callers, same bytes on the wire for a project that has authored the state.
  - **The migration is the part that could have gone silently wrong.** Saved R2 docs hold the old key in TWO state-keyed maps (`symbols[name]` and `symbolSounds[name]`), and a game’s PUBLISHED `defaults.json` can hold it too — a shipped game pins the engine as a submodule and publishes the state names its own commit knows. Both are folded before validation, at one boundary, because those records are keyed by `z.enum(SYMBOL_STATES)`: Zod **rejects** an unlisted key rather than stripping it, and `loadSymbolsDocWithEtag` answers a parse failure with `emptySymbolsDoc()`. Un-folded, a fully authored project would have loaded as a never-authored one — every binding and every per-symbol cue gone, with no error anywhere. The fold also runs on the defaults WRITE, so an un-bumped game’s `publish:symbols` cannot 400 into the `--optional` swallow.
  - **Three things were deliberately left alone**, each a different namespace: the `tumbleBoard*` emitter cues and `stateTumble` internals (the tumble OVERLAY, a separate concept); `tumbleExplosionDelays` and the `TUMBLE_PATTERNS` family in `engine-layout/tumblePattern.ts` (renaming one function inside a module of `TUMBLE_*` siblings reads worse than the churn saves); and the game-wide `tumbleExplosion` SOUND SLOT in `packages/game-config/src/sounds.ts`, which is a `/config` → Sounds key in the sounds doc, not a symbol state.
- 2026-09-10 — **A winning symbol can now go out with a pop.** New default-OFF doc-global `winExplode: { enabled? }` and a **/symbols → “Winning symbols explode”** section beside the resting replay: on, a winning cell plays its `explosion` state after its `win` beat and before settling into `postWinStatic`. This is what gives `explosion` a meaning on a board that does NOT cascade — until now the state existed only for the Book-of column morph.

  - **The symbol is NOT removed.** The cell still ends at `postWinStatic`; taking a symbol off the board stays the job of the cascade and of “Clear the board”, which play `clearReel`. _(Superseded the same day — see the “explode and be gone” entry above: leaving the winner standing is exactly what made the next spin’s clear pop it a second time.)_
  - **An explicit switch, and that is the whole design.** Inferring it from “is `explosion` authored” was the obvious alternative and would have fired on every existing project — every game binds `explosion` for the morph — re-timing the one beat every paying spin runs, in every shipped game, through the shared `_runtime/lines` bundle.
  - **Two edges decided rather than left to fall out.** (1) The pop fires on the round’s own presentation ONLY. `boardWithAnimateSymbols` is also driven by `winSymbolCycle`, which re-lights that spin’s winners every pass until the next bet; popping on each pass would be a board whose symbols blow up on a loop, and would add a second bounded beat to a cycle nothing races against a skip token. The cycle now marks its passes (`animateSymbols({ replay: true })` → an optional `replay` on the cue) and the pop is gated on its absence. (2) A stacked-covered cell is skipped: it mounts no `<Symbol>`, so there is nothing to draw the pop with and nothing that could ever report it — the beat would be a second dead hold that also ended the tall picture’s win art early, for no picture.
  - **Bounded, but with no floor.** `awaitSymbolBeat` + `WIN_BEAT_CAP_MS`, so an explosion bound to art that can never report cannot hang the round; no `WIN_BEAT_MIN_MS`, because the readable minimum is already spent on the win and a second one would be added to every paying spin.
  - Full chain shipped (`.strict` Zod + sparse prune → client type/accessor/setter/dirty signature → spread PUT → `symbolExport` verbatim → `/api/editor/export-symbols` → **bake whitelist** + runtime bundle → `bakedWinExplodeEnabled()` → `Board.svelte`), plus a `gameProfile` chip. New gate **`pnpm --filter launcher-api check:clear-reel`** (33 checks) covers BOTH changes over the REAL functions — the legacy fold on both maps, “the newer key wins”, that the raw schema still REJECTS an unlisted state (which pins the fold’s stakes), sparse OFF-parity, the `.strict` rejections, the client/server signature agreement, and that `winExplode` reaches both bundle paths. Mutation-verified: deleting the migration call and deleting the bake line each fail it. **Engine change — needs a runtime release to reach the online games**, and a Borut submodule bump for the remake. ⏳ owner visual-verify.
  - **`symbolSounds` now reaches both bundle paths (fixed in the same change).** It was in `SymbolExportResult` but missing from BOTH the `/api/editor/export-symbols` response destructure and the `bake-editor-doc.mjs` whitelist. The consequence was narrower than it first reads: the per-symbol cues' PRIMARY carrier is the sound export, which folds them into `catalog.bindings.symbols` (`soundExport.ts`), and `bakedSymbolSounds()` consults that first — so no cue was actually being dropped. What was broken is the FALLBACK underneath it (`editor-scenes.ts`, `symbols.symbolSounds`), which the runtime path carried and the bake path never wrote: two bundles built by the two routes answered differently the moment a project shipped no `bindings` block. Both hand-written lists now carry it, and `check:clear-reel` asserts the whole chain (mutation-tested: dropping it from either list fails the script).

- 2026-09-09 — **The explosion pattern did nothing on the board CLEAR — the one beat most players actually watch.** Owner report: picked a pattern on `test6`, raised the gap to 220 ms, saw no change. Everything shipped correctly — R2 doc, runtime bundle and served engine bundle all verified carrying `{"pattern":"columnsLeft","stepMs":220}` — and a live probe on the running game confirmed the CASCADE was staggering exactly as authored (waves at 220/440/660/880 ms). The clear was not.
  - **Why.** `clearOutgoingSymbols(reelIndex)` fans the swap-in-place clear out ONE COLUMN PER CALL, driven concurrently by `emergeRevealBoard` / `columnCascadeRevealBoard`. `tumbleExplosionDelays` dense-ranks the seats it is handed — the right rule for a cascade, where the whole winning set arrives at once — so one column's seats shared a column key, every column answered "wave 0", and with `columnStaggerMs` unset (it defaults to 0 under `emerge`) all six columns popped in the same frame. The pattern was inert on exactly the beat a swap-in-place player sees on EVERY spin, while working on the far rarer cascade.
  - **Only the four COLUMN patterns were affected.** Row, diagonal and radial keys vary within a column, so those already staggered the clear.
  - **Fix:** a second ordering scope. `TumbleBoardBounds` gains `rankAgainstBoard`, and the explode cue gains `patternScope?: 'board'`, set by the per-column clear and by nothing else — the column is then ranked among all the board's columns instead of among itself. Dense ranking stays the default (and the cascade's contract). The spread ceiling is measured over the ranked set, so six columns share one 2 s budget rather than each claiming it; a board-ranked `random` keys every board seat once so the six independent calls agree on one shuffle.
  - Verified: `node scripts/verify-tumble-pattern.mjs` now 70 checks (was 57) — the new ones assert the collapse WAS the bug, that board ranking sweeps 0/220/440/660/880/1100 across six columns, that row patterns still sweep within a column, and drive the real handler for both scopes. `verify-swap-in-place-mode.mjs` still 553.
- 2026-09-08 — **The cascade explodes in WAVES, if you ask it to.** Owner report: clicking spin blew the whole board up in one frame, with no way to say otherwise per game. New optional doc-global `tumblePattern: { pattern, stepMs? }` and a **/symbols → Explosion pattern** panel (shown for a project that cascades OR clears its board, the same gate as the `Tumble explosion` column). Twelve patterns — `all` (the default, unchanged), columns L→R / R→L / centre-out / edges-in, rows top-down / bottom-up, two diagonals, radial, random and reading-order — with a 0–500 ms gap (default 80) and a live 5×3 preview numbering each seat's wave.
  - **The waves are dense over the WINNING seats, not over the board.** A win on reels 2–4 pops on waves 0,1,2 rather than 2,3,4 with two waves of dead air first, so a pattern reads the same on a three-symbol line as on a full board. The three centre-relative patterns are the deliberate exception: they measure from the board's middle, so an off-centre win looks off-centre.
  - **One home for the order:** `packages/engine-layout/src/lib/tumblePattern.ts` (`TUMBLE_PATTERNS` + `tumbleExplosionDelays`), read by the game's `TumbleBoard` and by the tool's preview — the same reason `symbolStates` lives there. Sparse and byte-identical when absent (`all` and a 0 gap both resolve to the single frame before any sort runs).
  - **A pending wave is dropped when the board is swept** (slam / skipped round / `tumbleBoardReset`) or when a refill splices its column: a symbol off its column can never report `oncomplete`, so popping it would stall the beat behind its cap.
  - **Two guards found in review and closed:** the whole SPREAD is capped at 2 s (the per-wave 500 ms cap bounds nothing for a pattern whose wave count grows with the win, and a board-clear board explodes every seat every spin), and an unknown pattern name degrades to one frame instead of throwing inside the explode step — which matters because the launcher can ship a pattern a submodule-pinned game's engine does not know.
  - **A symbol's own explosion cue now lands with its own pop** rather than with the step; the step-wide `tumble_win_*` cue still fires once, with the first wave.
  - Full chain shipped (schema + prune → client setters + dirty signature → `symbolExport` → `/api/editor/export-symbols` → **bake whitelist** → runtime bundle → `bakedTumblePattern()`), plus a `gameProfile` row. Offline-verified: `node scripts/verify-tumble-pattern.mjs` (57 checks — every pattern's wave grid, the spread ceiling and the unknown-name degradation, and the REAL `tumbleBoardExplode` driven on a virtual clock incl. the sweep/splice guards and the transition's per-seat timing) and `pnpm --filter launcher-api check:tumble-pattern` (34 checks — prune, rejection, both bundle paths, the client half). **Engine change — needs a runtime release to reach the online games**, and a Borut submodule bump for the remake. ⏳ owner visual-verify.
- 2026-09-09 — **An early column re-played its explosion two or three times while the later ones were still popping.** Owner report on Waves/test6 (`columnsLeft` @ 500 ms), found immediately after the Transition fix above. Removal is board-wide by necessity — `TumbleBoardBase` seats a symbol by its index within its column, so removing one mid-step would shift everything below it and jump the survivors — but a pattern pulls "its animation finished" and "the board removes it" up to a spread apart, and the symbol left in between went on animating. A cell's `loop` is ABSENT by default and absent means loop (the tool encodes "loop on" as the field being missing, so the default could NOT simply be flipped for explosion states without making a looping explosion unauthorable and desyncing the tool's own checkbox). A spent seat is now UNDRAWN — `TumbleSymbol.exploded`, set on report, gating the cell in `TumbleSymbol.svelte` — which moves no index, so the board comes apart in waves instead of coming apart and then sitting there half-dead. The flag is set inside the ARMED callback, never after the `await`: the beat races `TRANSIT_BEAT_CAP_MS` (650 ms), so settling after the await would fire on the cap too and truncate any pop authored longer than that. `verify-tumble-pattern.mjs` grew part 5 (84 checks total) and its clock now keeps draining past settlement, because the late report is the whole point. Mutation-verified three ways: settling after the await fails 2 checks (the long pop and the never-reporting symbol), and deleting the render gate fails the markup check that exists precisely because nothing here renders Svelte.
- 2026-09-09 — **After a tumble win the authored Transition no longer covered the pop it was bridging.** Owner report on Waves/test6: the board CLEAR looked right, a cascade did not, off the same authored transition. The pattern work had given `scheduleTransition` a `catchUpMs` (`lastDelay − thisDelay`) so every seat's bridge waited out the remaining waves and they all landed together, `delayMs` after the LAST wave — the reasoning being that the intro they bridge (`tumbleBoardAppear`) is one board-wide beat. On the board that put a wave-0 seat's cover a whole spread (up to `TUMBLE_SPREAD_MS_MAX`, 2 s) after its symbol had finished popping. The clear was unaffected and that was the tell: it is fanned out one column per call, so under a column pattern every seat in a call shares a wave and the catch-up was always zero there. The bridge rides its OWN seat's pop again — which is also the contract the tool states ("Delay = ms after the explosion fires"), so an authored delay means what it says on both beats. `verify-tumble-pattern.mjs` now asserts the OFFSET from each seat's own pop (71 checks) and its `scheduleTransition` stub deliberately still applies a fourth argument if one is passed, because the regression lived at the call site — mutation-verified: restoring the catch-up fails 2 of 71.
- 2026-09-08 — **The "wait for a spin press after a big win" switch could not be saved** on any project that had already authored some OTHER win-cycle setting. `docSignature()` in `symbols.client.ts` — the page's dirty tracker — hand-lists the fields it watches, and `winCycle.holdAfterBigWin` was never added: the toggle moved, the signature did not, `dirty` stayed false and Save stayed disabled. It hid itself for three weeks because on a project with NO `winCycle` at all the whole block flips from `null` to an object, so the toggle looks like it works — it only dies once a delay/replay setting is already authored. The field was correct everywhere else (schema, sparse sanitize, `symbolExport.ts`, the bake whitelist, `bakedWinCycleConfig()`), which is why the earlier chain checks passed it.
  **This is the FOURTH hand-copied-allowlist rot on `winCycle` alone** (the PUT body 2026-07-24, the export response and the bake whitelist 2026-07-27) and nothing type-checks it: `docSignature` reads `doc.winCycle.x`, and a field it simply never mentions is an error nowhere — least of all in a bare `vite build`. So the guard follows `launcher-api/CLAUDE.md`'s rule and DERIVES its field list from `symbolsDocSchema` instead of re-typing it: new `scripts/check-win-cycle.ts` (`pnpm --filter launcher-api check:win-cycle`, 80 checks) asserts the signature's `winCycle` block holds exactly the schema's fields, that each one dirties a doc that ALREADY carries a `winCycle` (in BOTH boolean states — a `|| null` for `?? null` would eat the `false` the default-ON flags persist), that each control round-trips dirty→clean sparsely, that the stored doc signs the same as the draft, and that each default matches the game's. Mutation-verified twice: removing the fix fails 5 of 80, and adding a hypothetical new schema field fails until it is both registered and named — so the next field cannot repeat this.
- 2026-09-07 — **The Highlight (win frame) only drew on SPINE symbols.** Reported on a live project whose Win cells are flipbook clips: the authored highlight framed its spine-bound symbols and skipped the flipbook ones, so the feature read as half-broken rather than un-authored. The frame was mounted INSIDE `apps/lines/components/SymbolSpine.svelte`, the spine arm of `Symbol.svelte`'s renderer switch, so the sprite and flipbook arms could never draw it. It now lives in its own `SymbolWinFrame.svelte` that `Symbol.svelte` mounts AFTER the switch, over whichever arm won (`SymbolSpine` was left a pure pass-through to `SymbolSpineMain` and is deleted; the tint/`winLineColor` resolution moved verbatim). A symbol with no art bound still draws nothing, frame included. Verified in the running game via the Symbol-overlay debug grid: with a Win cell temporarily bound to a sprite/flipbook the frame was ABSENT before and PRESENT after, spine cells unchanged. **Engine change — needs a runtime release to reach the online games** (and a Borut submodule bump for the remake).
- 2026-09-03 — **Explosion → intro Transition.** New optional doc-global `transition` (spine / flipbook / fx + `delayMs`). Under the `emerge` swap style the pop and the intro hard-cut at every seat; now an authored animation mounts at the seat `delayMs` after the explosion fires, fire-and-forget (never joins a beat, never extends the round; cut if it outlives the step). Sparse and byte-identical when absent. Ships the full chain (schema → client → export refs → bake + runtime bundle incl. the effect keep-sets → `bakedSymbolTransition()`), `/symbols` gains a **Transition** section shown only for an emerging project, and `BookVfx.svelte`'s four-kind switch moved into the shared `SymbolLayer.svelte`. Plan note in [perspective-board-mode.md](../design/perspective-board-mode.md) §"The mode switch". Offline-verified (`check:symbol-transition`); ⏳ owner visual-verify; Borut submodule bump owed. Details in the Current-state bullet.
- 2026-09-03 — **Spine cells no longer come up blank on a cold load.** Reported after the Bounds-box fix deployed: the grid drew every spine cell as its label chip, with `physics is undefined` thrown from `drawCell` every frame; a reload fixed it. The editor's spine loader (`spineRuntime.client.ts`) injected one vendored runtime PER LINE and let "the first to finish" own `window.spine` — a cold /symbols load requests 4.1 (the built-in Highlight/reelhouse previews) and 4.2 (a Rigger rig) at once, both scripts injected, and whichever finished last won, so 4.2 skeletons were posed with the 4.1 runtime's missing `Physics` token and drawn by its `SceneRenderer`. Now ONE runtime (4.2, the line the game runs) loaded once and captured at load; the 4.1 built-ins parse and pose under it (`pnpm --filter launcher-api run check:builtin-spines`). Details in [editor status](editor.md).
- 2026-09-02 — **The grid and the cell preview fit a rig's box where its header puts it.** `measureSpineBounds` now returns the authored `skeleton.x/y` corner instead of assuming `-w/2, -h/2`, so a Rigger rig whose Bounds frame is not centred on its origin draws AT the frame — the same rule the game now applies via `<SpineProvider centreBox>`, so grid == board again for those rigs. Spine-editor rigs are unchanged. See [rigger status](rigger.md).
- 2026-09-01 — **this stage's bound FX/clips were drawn MIRRORED, and an unsized rig drew at a
  different size here than in the game.** Both are fixed in the shared code this stage reuses, not
  here: `fxBoneTransform` hands the overlay a projected basis whose determinant is negative (the
  camera mirrors x, `drawCell` sets `scaleX/scaleY = -s`), and the overlay used to apply it whole;
  and `measureSpineBounds`'s last-resort box now agrees with the runtime's. Full story, including
  why a particle burst hid it for a year and a Flipbook clip did not, in
  [status/rigger](rigger.md) (2026-09-01).
- 2026-08-28 — **a flipbook cell can WALK its clip differently per state** (owner report: reversing an
  animation in the game meant authoring a second clip). The clip was already the right place for the
  frames and the wrong place for the walk — a placed `FlipbookNode` had carried
  `fps`/`loop`/`direction`/`flipX`/`flipY` overrides since #515, and a symbol cell had only `loop`. It
  now carries the same block, so one authored clip serves Land forwards and Explosion backwards.
  - **The cost of the workaround was not file size, and saying so matters for the next call like
    this.** A second clip is a few hundred bytes of JSON over the SAME sheet — nothing is duplicated
    in the bundle. What a copy really forks is the clip's referential integrity: a renamed region
    then has to be repaired in both, and the two drift silently the moment the art is re-packed.
  - **The whole chain was already pass-through**, so the change is narrow: `symbolExport` ships
    `map: doc.symbols` verbatim, `mergeSymbolMap` spreads whole cells, and `getSymbolInfo` spreads
    `...cell`. Only the four TYPE declarations, the render fold and the UI needed work.
  - **One fold, two consumers.** `foldFlipbookPlayback` in `registerFlipbooks.ts` is now the single
    definition of "binding's override, else the clip's" — `LayoutNodeView` and `SymbolFlipbook` both
    call it. It lives there and not in `engine-flipbook` for the reason stated beside
    `flipbookPlaybackFrameCount`: `engine-layout` must not gain that dependency, and every consumer
    already depends on `engine-layout`.
  - **The fold has to be one object, not props passed beside the clip.** `direction` decides the
    texture ARRAY, so two answers in flight means the frames walk one way while the duration is
    computed for another — which is exactly how a ping-ponged state reverts at its own turnaround.
    `SymbolFlipbook`'s `cycleMs` reads the folded clip for that reason. `loop` is the deliberate
    exception: it stays a prop so `<Flipbook>`'s `props.loop ?? clip.loop ?? true` chain keeps
    driving the Book expand/reveal riders.
  - **`undefined` means inherit; `false` does not.** The mirror ticks start on the clip's own value
    and write an explicit `false` only when they differ from it, so a state can un-mirror a clip
    that IS authored mirrored — which a write-true-or-nothing checkbox could never express.
  - **The editor canvas honours it too**, or the tool would author a reverse the board preview
    played forwards. `flipbookMirror` was generalised from "a node" to "a binding" so both callers
    share one precedence.
  - Fixtures: `pnpm --filter flipbook-spike run fold` (16 checks on the fold, incl. identity-when-
    empty and false-is-not-inherit) and `apps/launcher-api/symbolClipPlayback.fixture.ts` (10 checks
    that the block survives the REAL `.strict()` Zod schema — the `applyDraft` whitelist and the
    schema are two hand-written lists that nothing else forces to agree, and disagreement is either
    a 400 on a valid save or a field silently dropped, with `vite build` green either way).
  - **Bonus, and a warning:** widening the client `SymbolCell` cut `svelte-check` on
    `symbols/+page.svelte` from 16 errors to 9 — `draft.loop` had been in use against a type that
    never declared it. `pnpm build` was green throughout. See
    [[gotcha_launcher_build_is_not_a_typecheck]].
- 2026-08-27 — **The symbol-state parity gate failed on a clean `main` and could not catch anything;
  its expectation was the stale side, not the resolver.** `check:symbol-state-parity` asserted that
  `intro` reads `unset` in the grid while the engine draws `land`.
  - **Both real sides already agreed.** #499 gave `intro` its `land` fallback in the engine
    (`resolveSymbolState`) _and_ in the tool (`INHERITS_FROM`), and the `Intro` column hint
    advertises it to the author (_"Leave a cell empty to fall back to this symbol's Land binding"_) —
    which is the tool's own stated test for which arms the grid owes a picture. The gate kept a
    THIRD, hand-maintained copy of the inheritance table (`TOOL_INHERITS`) that #499 did not touch,
    so it read a deliberate arm as the engine's `static` last resort and demanded a blank cell.
  - **Fixed by deleting that copy, not by extending it.** The expectation is now DERIVED from what
    the engine answers: its own state ⇒ the cell's own binding; `static` or nothing ⇒ `unset` (the
    one deliberate divergence, still pinned); **any other named state ⇒ the grid must draw it and
    name the donor.** A new inheritance arm on either side is now checked the day it lands instead of
    rotting until someone re-copies the table.
  - **`FULL` was also silently incomplete** — it never bound `intro`, so "every state bound" had
    quietly become an inheritance case. It is `Record<SymbolState, SymbolCell>` now, plus a RUNTIME
    exhaustiveness assertion, because `tsx` strips the annotation without checking it.
  - **Mutation-tested six ways, all caught:** drop `intro → land` from the engine; drop it from the
    tool; drop `tumbleExplosion → explosion` from the tool (the original regression); add a
    `SYMBOL_STATE` with no binding in `FULL`; make the tool mirror the `static` last resort; make
    `effectiveCell` consult the donor before the state's own binding. **132 checks, green.**
  - Also: the header's `Run:` line said `npx tsx …`, which picks up a global tsx that cannot resolve
    `engine-layout` — it is the working `pnpm --filter launcher-api …` form now.
  - The other five launcher checks in this set pass too — four of them only after a `svelte-kit
sync` hook that a fresh worktree was missing (see `docs/status/launcher.md`). The sixth,
    `check:game-config-defaults`, still fails — untouched here, already recorded in
    `docs/status/game-config.md`, and **not** a stale-file refresh: regenerating strips the authored
    `winLevels` block from `lines/ways/scatter.json`. Do not blind-regenerate.
- 2026-08-27 — **A spine symbol state played once and froze; now every state has an authorable
  Loop, and looping is the default.** Reported as _"the idle spine I place in the symbol state
  machine only plays 2 times, and then it stops."_
  - **Why twice, exactly.** `ReelSymbol` mounted `<Symbol>` with no `loop`, so it reached
    `SpineTrack` as `undefined` and every spine state was a one-shot that froze on its last frame
    (confirmed live in the running game: `loop: false`, `trackTime` 9.35 on a 2s clip). The symbol
    lands as `land` → plays `Idle` once on the board's UNMASKED animate layer; `oncomplete` flips it
    to `static`, which flips `animating`, and `SymbolWrap` shows a symbol only where
    `boardContext.animate === animating` — so it re-mounts on the MASKED layer and plays `Idle` a
    second time. Then it holds. Two plays, one animation, because both states point at `Idle`.
  - **The real gap:** looping was not authorable anywhere for spine, and for FLIPBOOK it lived on the
    CLIP (`clip.loop ?? true`), so one clip used by two states could not repeat in one and hold in the
    other. Sprite cells are a single frame and have nothing to repeat.
  - **Now:** `SymbolCellInfo.loop` (schema, doc, runtime), a **Loop** toggle in the cell editor for
    spine + flipbook, rendered from ONE snippet so the two editors cannot drift. **ABSENT MEANS
    LOOP** — the doc stays sparse because only a deliberate one-shot is written, and that matches what
    flipbooks have always done. An explicit `loop` prop still wins for the callers that own the
    decision (the Book expand/reveal riders, which loop only `bookIdle`).
  - **This CHANGES existing games** (owner's call, asked and answered): every spine symbol state that
    used to freeze will now repeat until an author ticks Loop off. Verified safe for the states the
    game AWAITS — spine-core queues `complete` _"if completed a loop iteration or the animation"_, so
    `land`/`win`/`explosion` still advance on their first cycle; they just keep animating while they
    wait. A looping `win` now fires `oncomplete` once per cycle rather than once, which the board's
    state set absorbs.
  - Side effect worth knowing: a rig-FX cue keyed at t=0 of a now-looping idle re-fires every loop,
    which is what an author expects from a repeating ambient effect.
  - Verified: schema round-trip over the real Zod (`loop:false` kept through parse + normalize,
    absent stays absent, a non-boolean rejected, flipbook cells too); launcher, lines, pixi-svelte and
    engine-layout all build.
  - ⚠️ **Pre-existing and NOT from this change:** `pnpm --filter launcher-api run
check:symbol-state-parity` failed 4 assertions on a clean `origin/main` checkout (`intro → unset
in the grid (engine draws land)`). Confirmed by stashing. **Fixed 2026-08-27** — see the entry at
    the top of this section; the gate’s own copy of the inheritance table was the stale side.
- 2026-08-27 — **The stage was sized from the wrong box, so every rig was painted ~1.7% too far
  right and its bound FX was not — the reported "I can see the FX in the state machine but it's
  offset".** `container` is `.grid-scroll` (`overflow:auto`); the WebGL canvas and the FX layer are
  its SIBLINGS, all three `inset:0` inside `.grid-area`. So the canvas spans the full width while
  the container's `clientWidth` is short by a scrollbar — **measured live: 885 against a 900px
  canvas**. The backing store was `floor(885 × dpr)` but displayed across 900 CSS px, so the browser
  stretched everything drawn by ×1.01695, growing with x: a cell at x=885 landed at 900. The FX
  overlay is its own correctly-sized Pixi canvas, so it put each burst where the code _thought_ the
  bone was — **15px adrift at the right of the grid**, and worse the further right the symbol sat.
  Fixed by reading the canvas's OWN box (`canvas.clientWidth/Height`), which fixes both halves at
  once: the backing store matches what it is painted across (no stretch), the mirror axis matches
  the cell rects — already measured against `canvas.getBoundingClientRect()` — and the FX host,
  being the same box, agrees by construction instead of by coincidence.
  **Note this also moved the RIGS**, which were quietly mis-drawn by up to a scrollbar's width the
  whole time; the FX only made it visible by not sharing the error.
  The projection is now a module, `symbolStageGeometry.ts` (`stageGeometry` / `mirrorX` /
  `boneScreenX` / `drawnScreenX` / `cellSkeletonX`) — it survived this long because it lived inline
  in a `requestAnimationFrame` callback where nothing could assert it. New gate
  **`pnpm --filter launcher-api run check:symbol-stage-geometry`** holds "where we tell the overlay
  the bone is" against "where the browser paints it" across 3 scrollbar widths × 6 device pixel
  ratios, **mutation-verified**: shortening the backing width reproduces a 14.2px worst case and
  drifting the mirror axis a 15.0px one; both fail the gate, the fix passes. `drawnScreenX` models
  the BROWSER, and its premise was measured in a live DOM repro before the model was written.
  Ironically `EditorSpineLayer` — the file this stage's header says it mirrors — always used
  `canvas.clientWidth`; only this copy drifted.

- 2026-08-27 — **A new `Intro` column — the animation a symbol plays when it APPEARS on its seat — and the `Tumble explosion` gate was wrong.** `Intro` is the authored half of the new `emerge` swap style (`/config` → Reel behaviour): under it nothing falls or slides, so this animation IS the arrival. It could not be folded into `Land`, which is the beat AFTER a movement — the reels fire it at the end of a roll and a cascade at the end of a fall — so a game that authored "rise out of the water" there would also play the rise on every reel stop and every cascade refill. Unauthored it inherits `Land` (`resolveSymbolState`), so a project that switches the style on before binding art gets a board that appears and plays its ordinary landing rather than nothing; the grid mirrors that inheritance and badges the cell, the same contract `Tumble explosion` has with `Explosion`. **The gating fix is the part worth recording:** `Tumble explosion` was shown only for a project that CASCADES, but the state is played by two things, not one — a tumble removing a symbol, and the swap-in-place CLEAR step (`clearOutgoingSymbols`), which a swapping lines game runs on every single round. Such a project was offered no column for the very state it fires and had to reach the binding through `Explosion`'s silent inheritance with nothing saying so. Both gates are resolved server-side now (`resolveCascade` / `resolveReelBehaviour`) and `visibleStatesFor` takes them as a named options object rather than a growing positional tail — the same correction is applied to the per-symbol SOUND states, which live in Invisible Sound since the move (see [sound.md](sound.md)). **Ship chain: nothing owed.** `symbolsStorage` validates states with `z.enum(SYMBOL_STATES)` and `symbolExport` passes the map through verbatim, so adding the member to `engine-layout`'s list carried `intro` the whole way (export → deploy → bake → pull → register) with no pipeline change — checked rather than assumed, per rule 8.

- 2026-08-25 — **New "Symbol sounds" section — the cue ONE symbol plays entering ONE state.** The
  per-symbol half of the sound-binding work (the game-wide half is `/config` → Sounds; see
  `docs/status/engine.md` for the whole story). New `symbolSounds` on the doc: `symbol → state →
audiosprite key`, sparse at both levels, assetless (the name addresses a region of the game's own
  audiosprite), travelling export → bake → `bakedSymbolSounds()`.

  - **A SEPARATE section, not a `sound` field on the state cell** — and that is load-bearing. The doc
    is merged over the coded map cell-by-cell (`mergeSymbolMap` spreads per STATE), so an override
    cell carrying only a sound would replace the whole binding and take the state's ART with it. The
    two are also independently interesting: "the bell dings when it lands" is a thing to say about a
    symbol whose art nobody has touched.
  - **Only the states the engine actually fires a per-symbol cue on are offered** — `land` (which
    REPLACES the game-wide landing cue for that symbol) and, for a cascading project only,
    `tumbleExplosion` (heard ALONGSIDE the cascade's own pop, since the pop is the beat and this is
    the symbol's voice in it). The schema accepts every state so bindings round-trip, but the UI
    refuses to offer one nothing plays: a dropdown that saves a cue no code path reads is exactly how
    `tumble_win_1…5` came to sit in the audiosprite for years looking bound.
  - **The save-path whitelist and the dirty signature both had to learn the field**, the two traps
    this file already carries warnings about: `normalizeSymbolsDoc` rebuilds explicitly (an unlisted
    field is dropped silently on save) and `docSignature` drives the dirty flag (an unlisted field
    means Save stays disabled while the author edits). Both pinned by
    `pnpm --filter launcher-api check:sound-bindings`, which round-trips through the REAL
    `normalizeSymbolsDoc` rather than only the Zod parse.

- 2026-08-25 — **A stacked symbol authors TWO pictures: the resting one and the winning one**
  (owner request). The "Stacked pictures" section had a single `art` per symbol, so a stack that was
  paying looked exactly like a stack that was idling. Each stacked entry now carries an optional
  `winArt` beside `art`: `art` is the default/resting picture (usually the still), `winArt` what the
  stack becomes **while it is part of a paying line** (the spine/flipbook it pays out with). Both are
  ordinary `SymbolCell` bindings authored with the same picker, so `winArt` ships through the
  identical export→bake→pull→register chain (`bundle.symbols.stacked[].winArt`) and introduces no new
  asset class. The runtime signal is the covered cells' own `symbolState`: `Board.svelte` already sets
  `win` on every paying cell (and reverts it after the beat), so `StackedPicture` reads them and swaps
  — any one lit covered cell lights the whole picture, since half a picture cannot pay. A new
  `winHoldMs` sizes that beat (the fixed wait a covered cell holds _because_ it has no per-icon
  `oncomplete` to await), which is also how long an authored win animation plays; blank ⇒ the coded
  650 ms. Sparse throughout: no `winArt` ⇒ the run carries none, `StackedPicture` never reads the
  board, and the render path is byte-identical to before. Also fixed in passing: `bake-editor-doc.mjs`
  silently DROPPED `edgeCutoffs` while the exporter emitted it, so a baked bundle lost the edge
  cut-offs its project had authored. See [docs/design/stacked-picture-mode.md](../design/stacked-picture-mode.md).
- 2026-08-24 — **The win LINE and the win AMOUNT TEXT are two sections, and the amount can sit in
  the middle of the reels** (owner request). The tool's one "Win lines" toggle governed both halves
  of the overlay, so there was no way to announce an amount without drawing a line under it. Split:
  `winLine.enabled` now means the LINE, the new `winLine.text.enabled` means the AMOUNT, and the
  text's switch **defaults to the line's** — which is exactly what the single toggle meant, so every
  existing doc (including `{ enabled: false }`) reads unchanged and stays sparse. `bakedWinLineEnabled()`
  became the OR of the two (the overlay is broadcast when either half draws), and `WinLine.svelte`
  now decides per half: no `<Graphics>` pass with the line off, no stamp with the text off, and an
  animated draw is forced instant when there is no line to reveal (the stamp must not wait on a tween
  that reveals nothing). `setWinLineEnabled` PINS the text's effective value before flipping the line,
  so toggling the line can never silently drag the text with it; both prunes drop a pin that agrees
  with its default. Each section now resets only its own style.
  New `winLine.text.placement`: `'boardCenter'` stamps the amount in the middle of the reel
  window (`windowWidth/2`, `(windowHeight - height)/2` — the same live geometry the in-window
  clamp uses, so an authored reel-grid override is tracked) instead of at the line's end. In that
  mode only the LAST-shown line stamps: with "show all win lines at once" on, every amount would
  otherwise land on the identical spot and render as one unreadable pile.
  Verified offline against the real client helpers + `normalizeSymbolsDoc`: 18 round-trip
  assertions (legacy doc → both off; line off + text on → `{enabled:false,text:{enabled:true}}`;
  toggling the line back on leaves the text on and the doc sparse; placement persists only when
  non-default; each reset keeps the other section) — client and server prune agree exactly, so a
  save can't come back dirty.

- 2026-08-24 — **A game can now show ALL of a spin's win lines at the same time** (owner request).
  New sparse `winLine.line.allAtOnce` (+ `allAtOnceDelay`, default 0.12s) in the Symbols tool's
  **Win line** group. The renderer was the real work: `WinLine.svelte` held ONE line
  (`points`/`amount`/`progress` singletons) and now holds a keyed LIST — each entry with its own
  points, colour, shape, stamp and draw `Tween` — so the default mode is simply "the list never
  grows past one" (parity). A line is keyed by the cells it traces, so re-showing one replaces it
  rather than stacking a copy; all strokes render before all stamps, so a later line can't be drawn
  over an earlier line's amount. `winLineHide` grew an `all` flag: in this mode a PER-WIN hide is
  ignored (the lines staying up IS the mode) and only the round-level clears (next spin,
  `clearWinPresentation`, cycle stop) wipe the set.
  The draw itself is fired from `dispatchBookEvent` (`showAllWinLines`) — the ONE seam all three
  dispatch paths cross, the same reason `recordWinCycleWins` lives there — because a flow-owned
  `winInfo` never reaches the coded handler map, so a flow-driven game (the shipped remake) had to
  behave identically. It looks AHEAD through the book (`winsOnThisBoard`) for every `winInfo`
  belonging to the current board: how many `winInfo` events a spin emits is a property of the
  SOURCE BOOK, not the game — the reference books put every win in one event while the Play4Fun
  facade flushes one PER win — so without the look-ahead the shipped games would have landed their
  lines a whole symbol-celebration apart instead of a beat. The coded handler and the `showWinLine`
  effect stand down in this mode; the resting win cycle re-broadcasts the whole set once and then
  cycles only the symbols underneath it. **Engine change — needs a Borut submodule bump + runtime
  release to reach the remake.**

- 2026-08-21 — **The no-animation banner was crying wolf, and the grid disagreed with the game
  about an empty `Tumble explosion` cell.** Three fixes, one report ("why do I get all these
  warnings? I do not see anything wrong").

  - **The warning's claim was two months stale.** It fired on any spine cell left on
    `(first animation)` and said the cell "renders blank in-game". That stopped being true when
    `pixi-svelte`'s `SpineTrack` gained its fallback to `skeletonData.animations[0]` — so a rig
    carrying ONE animation (`_shared/spines/engine-explosion`, most symbol rigs) plays exactly
    what picking it by hand would. Leaving it unpicked is a supported choice: this tool's own
    dropdown offers it and `SymbolSpinePreview` honours it. The banner now resolves each
    candidate bundle's animation COUNT from `/api/editor/spine/meta` and only speaks when the
    skeleton does not make the choice for you — **0** (setup pose ⇒ genuinely blank) or **2+**
    (plays whichever the export listed first — the `R_spinbutton`-bound-to-`W` trap the check
    was written for, which is silently WRONG, not blank). A count of 1, and an unresolved one,
    are dropped: a banner that fires on "don't know" is what teaches an author to ignore it.
  - **`effectiveCell` now mirrors the engine's `resolveSymbolState`.** It never modelled
    `tumbleExplosion` → `explosion`, so an unbound Tumble-explosion cell read "unset" in the grid
    while the game played the symbol's Explosion binding — a blank column that silently works is
    exactly what gets re-authored by hand. It also jumped straight to `win` for the book states
    without checking the state's OWN binding first, so a published default `bookIntro` showed the
    win art here and the bookIntro art in-game. Inherited cells now render the borrowed art with
    an `inherits <state>` badge + dashed border, and every cell's tooltip names where its binding
    comes from. Deliberately NOT mirrored: that rule's `static` last resort — it is a crash-guard,
    and painting every unbound cell with resting art would destroy the grid's only signal for
    "nothing is bound here" (the `unset` chip's tooltip says it instead).
  - **The two rules are now pinned together offline.** `pnpm --filter launcher-api
check:symbol-state-parity` (`scripts/check-symbol-state-parity.ts`, tsx) runs a symbol's state
    map through BOTH `resolveSymbolState` and `effectiveCell` for every state, from an authored
    override AND from a published default, and asserts they agree — including the one divergence
    that is deliberate (`static` last resort), so it stays a decision rather than becoming drift
    again. It fails 13 assertions against the pre-fix `effectiveCell`.
  - **A `_shared/` spine could not preview in any real project.** `resolveEditorSpine` read
    `loadSkeletonIndex`, which consults the shared index only when the project has NONE of its own
    — and all 5 real projects own one. So a bundle bound from `_shared/spines/` found no entry and
    returned `null`, even though `resolveBundlePrefix` resolves its FILES project-then-shared.
    Switched to `loadSkeletonIndexWithShared`, the same reasoning `symbolExport` /
    `editorArtExport` already apply to the export path (2026-08-21, below); the READ path was left
    behind, which is what made the freshly seeded `engine-explosion` unpreviewable. Also widened
    `/api/editor/spine/meta`'s `altTools` to include `symbols`, so the animation-count lookup is
    reachable for a symbols-only role.

- 2026-08-24 — **The grid's spine cells read smaller than their sprite neighbours: an `0.86` pad the board doesn't have, over four low rigs whose canvas was ~1.6× their art.** Two independent causes, found by measuring every symbol rig headlessly with `@esotericsoftware/spine-core` (setup pose, slots with setup alpha 0 dropped, origin-centred extent — the same method as the 2026-08-21 S/M entry).
  - **The pad.** `SymbolSpineStage`/`SymbolSpinePreview` fitted the declared canvas × `0.86`; `RegionThumb` (the sprite cell) has no such inset, and neither does the board. It looks like the grid should instead mirror the game's `SYMBOL_SPINE_FILL` (0.5) — it must NOT. `parser.scale` scales skeleton GEOMETRY but `SkeletonJson` copies `data.width/height` through **unscaled** (`SkeletonJson.js` L70–71), so `spineSizeScale` divides by the raw canvas and the baked `SYMBOL_SPINE_LOAD_SCALE` (2) × `SYMBOL_SPINE_FILL` (0.5) nets out to exactly one cell — the "tuned pair" `spineLoadScale.ts` documents. The preview loads at `EDITOR_SPINE_LOAD_SCALE` (1) and fits the same raw canvas, so **the pad was the only divergence between the grid and the board.** Removed from both. Known consequence, previously masked: a win animation peaks at 1.4–1.8× the resting canvas (h1–h5) and the stage has no per-cell clip, so a pop can bleed over neighbouring cells — the same overflow the board has.
  - **The rigs.** Measured art ÷ declared canvas: `h1` 0.998 (the convention), `h2` 0.913, `h3` 0.939, `h4`/`h5` 0.83, `M` 0.84 — but **`l1`–`l4` only 0.61–0.68**, all four declaring 1200×1023 around ~650×640 of art. Because the load-scale pair nets to a full cell, that fraction IS the symbol's on-board size, so the four lows shipped ~38% undersized on the board, not just in the grid. Retightened to the origin-centred resting extent (l1 708×676, l2 660×652, l3 696×738, l4 552×640; `x`/`y` = −w/2, −h/2, rounded up to even so the art can never clip), which lands them at 0.985–0.997. The method is validated by recomputing `h1`: it reproduces its shipped header to within 0.15%. Art untouched — only the four `"skeleton"` header numbers, in all five byte-identical `apps/*` copies.
  - **R2:** the tools resolve `<client>/<project>/spines/symbols/` and `_shared/spines/engine-symbol-l*`, so those 12 authoring copies were rewritten in place (each verified byte-identical to the old engine default first — nothing customized was touched). **Deliberately NOT patched:** `test_server/**` published bundles, `_shared/storybook/**`, and `input/originals/**` — build outputs and source archives, which must come from a republish / Runtime release, not a hand-patch.
  - **Reaching the live games needed NO manual step for most of them** (an earlier revision of this entry claimed it did — wrong). `runtime-release.yml` auto-fires on any push to `main` touching `apps/lines/**` or `packages/**`, so both commits rebuilt and republished `_runtime/lines` within minutes, and every game whose manifest entry has `runtime: "lines"` — including `bookofborutremake` — picked the new canvases up automatically. Verified live: `https://games.invisiblewall.org/bookofborutremake/assets/spines/symbols/h4.json` serves `892x932`. Note this is NOT what the Game Maker **Publish** button does: `publishGame()` is "a DATA + MANIFEST operation … never rebuilds", so it re-exports authored art/docs and re-points the manifest but can never move an asset compiled into the shared bundle.
  - **Still on the old canvases:** the games with their OWN built bundle, which by definition don't use the shared runtime — `bookofborut`, `hotfruits`, `bookofborutremakebuild`, `test1build` (all still 1080×1080 / 1200×1023). Each is built from its own repo with the engine as a submodule, so they need a submodule bump + rebuild + `publish-game-bundle.mjs`. The Publish button refuses them too (`hasOwnBuiltBundle` → `PublishBlockedError`), precisely so it can't clobber a real built game.
- 2026-08-24 (follow-up) — **Finished the retighten: h2–h5 and W.** Retightening only l1–l4 left the highs visibly short in the grid (reported as "still slightly smaller"), because h4/h5 declare 1080² around ~891 of art. Same method, same convention. Perceived size in a square cell (= biggest art dim ÷ biggest canvas dim, what contain-fit actually yields) before → after: h2 0.913→0.940, h3 0.939→0.949, h4 0.829→0.962, h5 0.834→0.968, W 0.507→0.962; l2 also nudged 660→662 (the exact extent rounds just over 660). Every h/l rig now sits in a 0.94–1.00 band against h1’s 0.984.
  - The residual few percent is inherent, not a miss: the canvas must stay **origin-centred** (the skeleton origin is what gets placed at the cell centre), so art that sits off-centre forces headroom on the opposite side. Closing it would mean moving the art, not the header.
  - **W is safe despite its spine never resting on the board** (its static/spin states are the `w.png` sprite): the rig carries an explicit `wild_dynamite_static` animation measuring 913×913, identical to its setup pose, so the resting extent is not a guess.
  - **Still deliberately untouched.** `M` — every setup-pose slot is fully transparent, so it has no measurable resting art at all; its 666×672 came from posing `low_multiplier_static` in the 2026-08-21 pass and is already correct. `S` — measures 1.196 (art wider than its canvas) BY DESIGN after that same pass; the origin-centred formula would hand it 830×1736 and shrink it to 0.752, so the formula must never be applied blindly to a canvas that was already hand-tuned around an animated spread.
- 2026-08-21 — **Two engine rigs drew at the wrong size, because a spine symbol is sized by
  its DECLARED canvas, not by the pixels it shows.** `spineSizeScale` contain-fits
  `skeleton.data.width/height`; the Scene Editor's `measureSpineBounds` reads the same rect.
  Upstream's scatter (`symbols2/S`) declared 4078×3307 around a 805×984 resting gem — its
  `rays1..3` bones are scaled ×4 and fully transparent in the setup pose (`color: …00`), yet
  the artist's canvas covers them at full animated spread — so the fit drew the gem at ~30% of
  an H symbol. The multiplier (`symbols2/M`) had the mirror bug: a 400×400 canvas around
  540×567 of `low_multiplier_static`, overflowing its cell by ~40%. Both canvases retightened
  to the origin-centred extent of their RESTING art (S 828×1092, M 666×672), measured with
  `@esotericsoftware/spine-core` over the visible (alpha > 0) attachments — the convention
  `h1` already follows. The art is untouched: only the four `"skeleton"` header numbers moved,
  in all five byte-identical `apps/*` copies. Fill ratios now land in the family's band —
  scatter 0.90 of the fitted box (was 0.30), multiplier 0.84 (was 1.42), against h1 0.98 /
  h5 0.83. Note the scatter's `scatter_win` burst measures 2109×2099, so at the corrected size
  it deliberately spills ~2 cells wide — check it against `BoardMask` clipping.
  ⚠️ **Not live yet:** `_shared/spines/engine-symbol-{s,m}` in R2 still carry the old canvas
  until `node scripts/seed-shared-engine-spines.mjs --only engine-symbol-s` (then `-m`) is
  re-run with R2 credentials, and any project that already exported those bundles needs a
  re-export.
- 2026-08-21 — **The Symbols grid preview fitted the wrong rect.** `SymbolSpinePreview`
  measured live setup-pose `getBounds()` and fell back to the authored canvas only when the
  export omitted it — the exact inverse of `measureSpineBounds`, the shared helper whose own
  docstring already claims the Symbols grid as a caller. So any rig whose canvas and resting
  art disagree previewed at a size the board would never show. It now calls
  `measureSpineBounds`, once per loaded instance (the rect is pose-independent, and
  re-measuring each frame would `setToSetupPose()` over the applied animation).
- 2026-08-21 — **The cascade's explosion is its own binding: `Tumble explosion`.**
  Upstream played ONE `explosion` state at two different moments — the cascade removing a winning
  symbol, and something morphing a symbol in place on a resting reel (the Book-of column expand) —
  because each Stake sample game shipped a single `symbols3/explosion` skeleton. The engine's own
  Spine set carries more than one (`engine-explosion`, `engine-win-meter-explosion`), and the two
  beats read differently: one pops under a falling board, the other on a board standing still.
  Split them. New state `tumbleExplosion` in the ONE home (`engine-layout/symbolStates`), so the
  Symbols grid, the Scene Editor's `symbolState` dropdown, the Symbol Debug overlay and the doc
  schema all pick it up from the same list. The cascade (`tumbleBoardExplode` + both
  `tumbleBoardRemoveExploded` filters, which is also what `/config`'s "clear the board" style
  runs through) now plays `tumbleExplosion`; `expandBookColumns` keeps `explosion`.
  **Nothing changes for a project that binds one explosion:** `resolveSymbolState` makes
  `tumbleExplosion` INHERIT `explosion` before the `static` last resort, asserted in
  `apps/lines/src/game/symbolCell.fixture.ts`. The column is gated on `resolveCascade` (server
  `load` → `visibleStatesFor(gameType, cascade)`) rather than the game kind, so a lines project
  that switched the cascade on in `/config` gets the column and a cluster project gets it without
  authoring anything. Header carries a tooltip saying an empty cell reuses `Explosion`, because a
  blank column that silently works is what gets re-authored by hand.
  ⏳ owner verify: on a cascading project bind `engine-win-meter-explosion` to `Tumble explosion`
  for one symbol, rebuild, and confirm the tumble pops with it while the Book-of expand still uses
  `Explosion`.

- 2026-08-21 — **`_shared/spines/` now carries the engine's whole Spine set (29 bundles), not just the boot mark.**
  Follow-on to the explosion below, same cause: the shared library seeded sprite SHEETS only, so a
  new project could bind no animation at all. Seeded every skeleton `apps/lines` ships — chrome
  (`engine-loader`, `engine-transition`, `engine-bigwin`, `engine-anticipation`,
  `engine-reelhouse-glow`, `engine-foreground[-feature]`, `engine-buy-button`, `engine-fs-*`,
  `engine-global-multiplier`, `engine-cluster-pay`, `engine-tumble-*`, `engine-win-meter-explosion`)
  and symbols (`engine-symbol-h1`…`l4`, `-m`, `-s`, `-w`). ~16.4MB in R2.
  **Split ONE BUNDLE PER SKELETON, deliberately.** Upstream packs many skeletons behind one shared
  atlas (`symbols/` holds nine), but a spine cell/node stores a bundle PREFIX plus an animation name
  — there is no skeleton selector, and `resolveEditorSpine` / `exportSpineBundle` both take the
  folder's FIRST `skeletons.json` entry. Shipping `symbols/` whole would have published nine
  skeletons of which only `h1` could resolve, and binding `h3` would preview wrong AND ship wrong —
  the same silent class of bug as the index gap below. **Known cost, not a surprise:** a split family
  re-copies its atlas page per skeleton, and `symbolExport` does NOT use the content-addressed
  `PageStore` that `editorArtExport` does (its `_pages/` store lives under a different deploy
  subtree), so binding all nine picture spines ships ~6.6MB where a packed sheet ships ~0.75MB.
  Documented in the guide; giving `symbolExport` a page store is a separate job.
  Seeder: `apps/launcher-api/scripts/seed-shared-engine-spines.mjs` (idempotent, `--dry-run`,
  `--only <bundle>`; merges into `skeletons.json` so the boot-mark entry survives). Verified against
  R2 after seeding: 30 prefixes, 30 index entries, exactly one entry per folder, every skeleton +
  atlas + page present and each atlas' page line resolving, boot mark intact, no orphans.
  ⏳ owner verify in the picker.

- 2026-08-21 — **The Explosion state finally has a default to bind: `_shared/spines/engine-explosion`.**
  `Explosion` was the only state the shared library offered nothing for — `_shared/sheets/` seeds
  sprite sheets only, and `_shared/spines/` held just the engine boot mark. Since only the cascade
  asks for `explosion` and an unauthored state falls back to `static`, a tumble showed symbols
  sitting still as they were removed. Seeded the Stake engine's own explosion (13-frame Spine
  `sequence` attachment over two slots, the second `additive` — NOT a Flipbook clip, whose single
  ordered frame list cannot carry the second layer) as a shared bundle via
  `apps/launcher-api/scripts/seed-shared-engine-explosion.mjs`, which insert-or-replaces one entry
  in `_shared/spines/skeletons.json` rather than rewriting it (`r2-sync-spines.mjs` would have
  deleted the boot-mark entry).
  **Fixed the trap it exposed on the way:** `loadSkeletonIndex` reads the shared index only when the
  project has NONE of its own, but `exportSpineBundle` returns `null` on a missing entry — so for any
  project that owns a `spines/skeletons.json` (every project that has used the Rigger) a bundle bound
  from `_shared/spines/` previewed in the tool and shipped **nothing, in silence**. `symbolExport.ts`
  and `editorArtExport.ts` now resolve through the new `loadSkeletonIndexWithShared()` (project-first
  concat, matching what `bootSplashExport` already hand-rolled and the tie-break
  `resolveBundlePrefix` applies to the files). ⏳ owner verify: bind `engine-explosion` on a cascade
  game's Explosion column, rebuild, confirm it plays in the shipped build.

- 2026-07-28 — **Scatter now gets the win-highlight frame when it pays.** The `highlight` win frame
  (`bakedHighlight()`) is drawn on any symbol reaching `state === 'win'`, but `Symbol.svelte` was
  gating it behind `!['S', 'M']` — so the scatter (`S`), which reaches `'win'` via
  `animateSymbols` → `Board.svelte` like every paying cell, never got a border even when it
  participated in a win (owner request: "the scatter should also get a border since it participates
  in the win"). Dropped `'S'` from the exclusion (`props.rawSymbol.name !== 'M'`); the scatter now
  shows the same frame as the other winning symbols. One-line coded gate in `apps/lines`, no
  doc/schema/bake change. Verified the game boots clean with the change (dev bundle, mock RGS);
  ⏳ owner visual-verify on a real scatter win.

- 2026-07-28 — **Book-symbol VFX (background + foreground) during free spins.** New sparse doc-global
  `bookVfx: { background?, foreground? }` on the symbols doc; each layer is sprite/spine/flipbook/fx,
  authored in a new "Book symbol VFX" panel and drawn behind / in front of the game-selected book
  symbol (`stateGame.specialSymbol`) on the resting board during free spins only. Full chain end to
  end (tool → export → bake + runtime bundle → engine `BookVfx.svelte`), modelled on `boardGlow`;
  default-OFF ⇒ byte-parity. Closed an effect-pruning gap on the way: a bookVfx `fx` layer's effect is
  now a keep-source in both the bake path and the runtime-bundle `pruneUnreachableEffects`. See the
  "Book-symbol VFX" bullet under Current state. ⏳ owner visual-verify; **Book of Borut needs an engine
  submodule bump.**

- 2026-07-27 — **Two owner-requested win-line options, wired end-to-end.** (A) **"Show full
  payline"** in the Win lines section — `winLine.line.fullPayline` (bool, default OFF) +
  `line.fullPaylineColor` (coded default `#4a90d9`): draws the WHOLE payline across all reels as
  a static underlay beneath the winning segment. Rides `winLine.line` verbatim through
  export/bake; both the coded `winInfo` handler and the post-win replay pass the full path as
  `winLineShow.fullPoints` via `flowEffects#winLineFullPointsFor` (gated on the flag), and
  `WinLine.svelte` strokes it complete under the animated winning line. (B) **"Replay the win
  text too"** in the "Winning symbols after the spin" section — `winCycle.showText` (bool,
  default ON) decouples the stamped amount from the line so the author can keep the line
  replaying without the number; `winSymbolCycle.ts` sends empty strings when off (`WinLine`'s
  label is now gated on non-empty text). **Two latent bake-path bugs fixed on the way past:**
  (1) `POST /api/editor/export-symbols` was dropping `winCycle` AND `names` from its response
  destructure, so the win-symbol replay settings and symbol display names never reached the
  BAKE path (only the live runtime path, which uses the full `SymbolExportResult`, carried
  them) — both now forwarded; (2) `bake-editor-doc.mjs`'s winCycle whitelist tested
  `showLine === true`, inverted for the default-ON/sparse-off semantics, so a project that
  switched the line replay OFF re-enabled it through a bake — now `=== false` (and `showText`
  matches). Verified: `pnpm --filter launcher-api build` + `pnpm --filter lines build` green;
  14/14 offline checks over the REAL `normalizeSymbolsDoc` (fullPayline/fullPaylineColor +
  showText round-trip, sparse-default pruning, `.strict` rejects unknown keys). ⏳ **Owner
  visual-verify** (auth-gated tool + the drawn line on a real win). **Book of Borut (separate
  repo) needs an engine-submodule bump** to pick up the shared-engine renderer changes.

- 2026-07-24 — **`/symbols` never SAVED any `winCycle` setting** (found when an author flipped "Replay the win line too" on and Save put it back): `saveSymbolsDoc` in `symbols.client.ts` built the PUT body from a hand-copied field list (`version`/`symbols`/`highlight`/`boardGlow`/`winLine`), so the whole `winCycle` object — replay on/off, gap AND `showLine` — never left the browser; the server echoed a doc without it and the UI reset. The three older fields only survived because they predate the list. Fixed by spreading the doc (`{...doc, version: 1, …envelope}`) instead of enumerating it — the server re-validates and rebuilds from its own whitelist (`normalizeSymbolsDoc`, schema `.strip()`), so extra keys are harmless and a future doc-level field can't rot the same way. This is the third instance of the hand-copied-allowlist trap in this app (see `launcher-api/CLAUDE.md`); the guard is a Node fixture that stubs `fetch`, calls the REAL `saveSymbolsDoc` and feeds the captured body to the REAL `normalizeSymbolsDoc` — the earlier fixture only tested the server half, which is why this slipped through. `showLine` also flipped to **default ON** (owner request), so sparse persistence now keeps only the OFF.

- 2026-07-24 — **Symbols carry a DISPLAY NAME** (`names: { H1: { singular, plural } }`), authored
  in two boxes under each row's id. This tool already owns what a symbol _is_, so it now also owns
  what the game **calls** it: Invisible Win Text prints it as `{symbolName}`, which is what let win
  messages stop saying "3 of a kind" (a symbol id is unspeakable, so the match count was the only
  thing the text could state). Rename here → every win sentence follows, no template edit. Both
  forms are authored, never derived (`+s` gives "Cherrys" and means nothing translated); unset
  plural reuses the singular; an unnamed symbol falls back to its id. Shared resolution lives in
  `engine-layout/symbolNames.ts` (game + `/symbols` + `/win-text` — one answer). Assetless, sparse,
  full chain per rule 8: Zod + `normalizeSymbolsDoc` (blank-form pruning) → client type/setter/
  `docSignature` → `SymbolExportResult.names` → `bake-editor-doc.mjs` → `BakedBundle.symbols.names`
  → `bakedSymbolNames()` → `flowEffects`. **Found on the way past: `winCycle` was missing from the
  bake whitelist entirely** — the runtime-bundle path carried it, the bake path didn't, so a
  project that switched the win-symbol replay off shipped it ON through a bake. Both now carried.
  Also declared `winCycle` on the client `SymbolsDoc` type, which the helpers had been using
  without it (a type error the launcher build never checks). 26 offline checks:
  `node packages/engine-layout/scripts/test-win-text-symbol-names.mjs`. ⏳ **Owner visual-verify** —
  auth-gated, so the row-head boxes weren't browser-driven.

- 2026-07-20 — **Flipbook is a third binding kind in `/symbols`.** A `sprite` cell is ONE frozen frame, so Spine was previously the only way to animate a Spin/Land/Win state; an Invisible Flipbook clip (ordered, timed atlas frames) is far cheaper and is the fallback for the Tier-C spine-particle perf ceiling in `docs/status/fx.md`. The schema/engine side (`symbolCellSchema.type` widened to `'sprite'|'spine'|'flipbook'` + optional `clipId` + a `.refine()` rejecting a clip-less flipbook cell; `SymbolCellInfo`; `SymbolFlipbook.svelte` + the `Symbol.svelte` dispatch; `collectSymbolRefs` skipping flipbook cells) landed separately — this change is the **authoring UI** against it. `+page.server.ts` now also loads `listClips(clientKey, projectKey)` and returns it as `data.clips`. The cell panel's type toggle is generated from ONE exported runtime value (`SYMBOL_CELL_TYPES` in `symbols.client.ts`) rather than a hand-written pair of buttons — the `COMPONENT_PARAM_KINDS` precedent, because the launcher build transpiles TS without checking it. Picking a clip sets `type`/`clipId`/`assetKey` (the clip's PRIMARY sheet) together, so a flipbook cell is never assetless and every consumer reading `assetKey` keeps working. **Switching kind clears the fields that no longer apply** (`animationName` leaving Spine, `clipId` leaving Flipbook) and `applyDraft` rebuilds the cell field-by-field as a whitelist, so `.strict()` + `.refine()` cannot reject a save the author thinks is valid. With no clips in the project the Flipbook button is disabled with a `/flipbook` pointer instead of an empty select. Previews are STILL first frames, not players — grid cells caption the clip name + frame count (a deleted clip reads `<clipId> (missing)`), and the panel shows a 120px still; N per-cell tickers would cost far more than the one shared spine canvas, and scrub playback belongs to `/flipbook`. ONE storage change: `FlipbookClipRow` gained `assetKey` + `firstFrame`, both read from the JSON `listClips` already parses. Verified: `svelte/compiler` on the page reports **0 warnings** (3 pre-existing dead-CSS selectors removed to get there), `tsc --noEmit` on `launcher-api` is **0 errors**, `pnpm --filter launcher-api build` green, all five `flipbook-spike` fixtures pass, and an offline Node fixture over the REAL `normalizeSymbolsDoc` confirms the flipbook cell round-trips, a clip-less flipbook cell is refused, and `previewKey` is still refused by `.strict()`. ⏳ **Owner visual-verify** — the page is auth-gated so the picker/preview was not browser-driven.

- 2026-07-20 — **The coded defaults now preview instead of showing a "can't be previewed" placeholder.** Both built-in defaults — the free-spin board glow (`reelhouse`) and the highlight win frame (`anticipation`/`payframe`) — ship as LOCAL game assets, so `/api/editor/spine` (R2-only) could never resolve them and the panels rendered a dashed placeholder unless the project happened to carry a same-named R2 bundle. The launcher now vendors both spines under `apps/launcher-api/static/builtin/spines/` (~965 KB: skeleton `.json` + `.atlas` + `.webp`), and `editorSpine.client.ts` resolves a `builtin:<id>` key by synthesizing the descriptor `/api/editor/spine` would have returned — page names parsed from the atlas's own un-indented image lines, `pma` from the same `^pma: true$` header rule the server index uses, so a built-in renders byte-identically to the R2 path (no premultiply/halo divergence). One shared `resolveBuiltinBundle()` drives BOTH panels and still **prefers a real R2 bundle** when one matches, so a project carrying its own copy is unaffected. The placeholder branch is kept as a defensive fallback (its copy now says the coded default still ships and renders in-game). Verified live via the real loader on the dev launcher: `loadSpineInstance('builtin:reelhouse')` → the three `reelhouse_glow_*` animations + `reelhouse_glow.webp` page; `builtin:anticipation` → 16 animations incl. `payframe`; an unknown builtin id returns `null` (no crash). Note this is a launcher-only asset copy — it does NOT change what a game ships. ⏳ **Owner visual-verify** of the rendered panel (auth-gated, so the WebGL canvas itself wasn't browser-driven).

- 2026-07-16 — **Free-spin board glow is swappable in `/symbols`** (owner-requested: "a session in the symbol state machine where I can change the art/irig used"). New optional doc field `boardGlow: { type:'spine', assetKey, animations?: {start,idle,exit}, sizeRatios? }`, modelled on `highlight` (the existing non-per-symbol global). A **Free-spin board glow** panel sits between Highlight and Win lines, reusing the highlight's bundle `<select>` + `SymbolSpinePreview` (no new picker). `BoardFrame.svelte`'s five hard-coded literals (`key="reelhouse"`, the three `reelhouse_glow_*` names, `SPINE_SCALE`) became sparse reads off a new `bakedBoardGlow()` — each unset field falls through to its coded constant, so an un-authored game is byte-identical. The engine still OWNS the start→idle→exit chaining and the timing (the author swaps WHAT plays, not the sequence). **`.irig` rigs work here for free** — the bundle rides `refs.spineKeys` → `exportSpineBundle`, which already renames a Rigger `.irig` skeleton to `.json` (the PIXI parse-by-extension crash). Threaded the full chain per rule 8: Zod + `normalizeSymbolsDoc` copy → client type/setters/`docSignature`/`saveSymbolsDoc` body → `collectSymbolRefs` + `SymbolExportResult` → `export-symbols` endpoint → `bake-editor-doc.mjs` (defaults + response parse) → `BakedBundle.symbols` → `bakedBoardGlow()` → `BoardFrame`. `pull` needed nothing (reuses `editor-symbols`). Verified offline against the REAL schema + normalizer (10/10: full + art-only-sparse round-trip, parity emits no key, `.strict()` rejects unknown key / non-spine / missing / empty assetKey), **mutation-tested** — dropping the `normalizeSymbolsDoc` copy makes it fail, which is the silent-drop trap this repo has hit before. Both apps build clean. ⏳ **Live-verify pending** — the panel is auth-gated so it wasn't browser-driven; needs a real rig picked + saved + baked + a runtime release.

- 2026-07-24 — Winning **symbols** now **keep animating on the resting board until the next spin**, stepping through a multi-line spin's paying lines one at a time (`winSymbolCycle`, authored via the doc-level `winCycle`; default on; the line/amount are NOT replayed) ([detail in history](../history.md)).
- 2026-07-14 — Win-line renderer ported into the **shared engine** so `runtime:lines` games (incl. Book of Borut remake) draw it ([detail in history](../history.md)).
- 2026-07-14 — Rig FX in `/symbols` + Rigger overlay upgraded to the **full bone transform** to match the game ([detail in history](../history.md)).
- 2026-07-13 — `/symbols` stage gained **live rig-timeline FX preview** (parity with the Rigger) ([detail in history](../history.md)).
- 2026-07-06 — Symbol export now **scans all atlases for bound frames** (fixes new icons rendering blank, `7c94f4f`) ([detail in history](../history.md)).
