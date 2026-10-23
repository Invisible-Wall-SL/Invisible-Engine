# Invisible Symbols State Machine — status

> Design: [docs/design/invisible-symbols-state-machine.md](../design/invisible-symbols-state-machine.md) · Guide: [docs/tools/symbols-state-machine.md](../tools/symbols-state-machine.md) · Agent: [`.claude/agents/invisible-symbols.md`](../../.claude/agents/invisible-symbols.md) · Detail: [symbols-history.md](symbols-history.md)

**One-line state:** Shipped — `/symbols` authors each symbol's per-state art (sprite / rig /
flipbook, plus blended layers) and the board's win-presentation globals, all travelling the full
ship chain, with conditional saves and version history. Open: the S5 end-to-end rebind proof, and
owner visual-verify of most globals on a real board.

## Current state

The **`/symbols` launcher tool** (registry "Invisible Symbols State Machine", bar name "Symbols SM")
— the editable twin of the in-game Symbol Debug grid, NOT the game's runtime state machine. It
authors a sparse override doc (`<client>/<project>/symbols/symbols.json`) that the engine merges over
each game's coded `SYMBOL_INFO_MAP`; an un-authored project renders byte-identically. The build
story of each feature is in [symbols-history.md](symbols-history.md) ("Build detail by feature").

- **The grid** — symbols × `Static` / `Spin` / `Land` / `Win` / `Post-win` / `Explosion`, plus
  `Intro` under the `emerge` swap style, `Clear reel` on a project that cascades or clears its
  board, the book states on a book game, and the eight Hold and Win states (`coinIdle`,
  `coinLand`, `coinStick`, `coinCollect`, `coinBoost`, `jackpotReveal`, `mysteryReveal`,
  `flyToMeter`) on a `holdAndWin` project (gates resolved server-side). One home for the state
  list: `engine-layout/symbolStates.ts`. An empty cell that the engine fills by inheritance
  (`intro → land`, `clearReel → explosion`, book states → `win`, `coinStick → land`,
  `coinCollect`/`coinBoost`/`jackpotReveal`/`flyToMeter → win`, `mysteryReveal → explosion`)
  draws the borrowed art with an `inherits` badge; `effectiveCell` and the engine's
  `resolveSymbolState` are pinned together by `check:symbol-state-parity`.
- **Rows offer only what they play** — the project's columns are narrowed per row by
  `engine-layout` `symbolStatesPlayed` over facts `symbolsPageConfig` reads off the config (`plays`:
  dealt, on the reels, token, roles, fills a meter). Three groups, each with its own column heads:
  the symbols (no Hold and Win state), a **Hold and Win** group of the role symbols (`holdAndWinRows`,
  drawn after the others; no `win` / `postWinStatic` / book state, the held beats, and each role's
  own beat) and the **Coins** (`static` + the token's three). A slot a row does not play is an empty
  dashed box. Authored art or Element FX on a state the row never plays, and no played state
  borrows, is listed on the row head (**Never played … Clear**) with a **Clear all** note above the
  grid. Without a config every row offers every column. Pinned by `check:symbols-kind-gating` §5.
- **Kind gating** — only through `kindCapabilities()`: `bookSymbolVfx`, `tumblePattern`,
  `symbolTransition` (true for every kind but `holdAndWin`) and `stackedPictures` hide the Book
  symbol VFX / Explosion pattern / Transition / Stacked pictures sections for Hold and Win, each
  kept while the doc still authors it. A `coinSymbols` kind shows each row's Hold and Win role
  chips from the live Game Config. Pinned by `check:symbols-kind-gating`.
- **The cell editor** — Sprite / rig / Flipbook (`SYMBOL_CELL_TYPES`), a **Loop** toggle (absent
  means loop, except `explosion` / `clearReel`, which are one-shot by default via
  `symbolStateLoopsByDefault()`), a flipbook walk block (fps / direction / mirror, folded by
  `foldFlipbookPlayback`), and **Layers** — up to 8 extra pictures per cell, each with a blend mode
  (not on rig layers: a Pixi blend cannot reach skeleton geometry), **behind**, and **Dim with
  symbol**. Layers are drawn at the one choke point (`Symbol.svelte`), never report beat
  completion, and are not composited in any preview. Row heads carry display names
  (`names`, used by Invisible Win Text as `{symbolName}`).
- **Element FX per state** — the panel's **Element FX** block (under Layers) authors the doc's
  `symbolFx` (symbol → state → `ElementFxEntry[]`): `enter` (each time the symbol enters the state)
  or `always` (loops while in it); a shake on Land, a glow on Win, a melt on Explosion. Edited on
  the doc directly like `symbolSounds` (no Apply; Reset to default leaves it), ≤ 12 per state,
  entries stored verbatim, no inheritance across states. ▶ plays the real runtime on a still of
  the panel's Preview (sprite thumbnail, flipbook first frame, or a same-frame `snapshot()` of the
  rig preview); a gold ✦ badge marks each grid cell that carries effects. The prune is
  `$lib/symbolFx`; the game reads `bakedSymbolFx()` (`Symbol.svelte`, status [fx](fx.md)). Pinned by
  `check:symbol-fx`.
- **Save** — ETag-conditional; a colleague's newer save raises **Someone else saved these
  symbols** / **Overwrite theirs**. **History…** restores any of the 20 newest backups
  (`$lib/DocHistoryModal.svelte`). `/api/editor/symbols` refuses a project the caller cannot
  access. **↻ Reload from R2** drops the rig and region caches (unsaved edits kept).
- **Rows follow Invisible Game Config** — the grid lists exactly the symbols `/config` badges
  **in play** (on a reel strip), then, under a **Coins** heading, a pots overlay's coins (its
  tokens: `/config`'s unbadged **Coins** section) in pot order (`game-config` `symbolUses` /
  `symbolsUsed`, laid over the defaults by `symbolGrid` in `symbolDefaults.ts`). The
  page reads the config `/config` opens with (`resolveGameConfig`: the project's own, else its
  kind's template), and `$lib/server/symbolsPageConfig.ts` derives the rows and every config-driven
  gate (columns, add-ons, roles, jackpot and big tiers, meters) from that one doc, so a project that
  never saved its config follows the template like that page does. A used symbol with no default
  gets blank cells; a hidden symbol keeps its authored states (stacked-picture entry included) and
  its row returns with them. Every kind × setup is pinned by `check:symbols-follow-config`.
- **Defaults** — the cells' default art: each game publishes its coded map at build
  (`publish-symbol-defaults.mjs`), filtered to the in-play symbols; un-published projects fall back
  to the committed `lines.json` (`holdAndWin.json` for a Hold and Win project: the lines set plus `W`
  and the 3 Pots specials on placeholder art, `BLANK` unbound). They no longer decide the rows.
- **Previews** — one shared WebGL stage, one rig runtime (4.2, `check:builtin-rigs`), rigs
  fitted to their authored box (`measureRigBounds` / `authoredRigBox`), stage geometry from the
  canvas's own box (`symbolStageGeometry.ts`, `check:symbol-stage-geometry`), rig FX and clips on the
  shared `fxOverlay` (with `autoDensity`), coded built-ins vendored under `static/builtin/spines/`,
  and rig bundles re-derived from their source sheet when it drifts (`ensureBundleAtlasFresh`).
- **Doc-level globals** — each sparse (absent ⇒ byte-parity), each with a `gameProfile` chip:
  - `highlight` — the win-frame rig over every winning symbol of any art kind, with a `fixed` or
    `winLine` multiply tint; `boardGlow` — the free-spin reel-house glow.
  - `winLine` — the LINE (`enabled`, `useConfigColor`, `fullPayline`, `allAtOnce` + delay) and the
    AMOUNT TEXT (`text.enabled` defaulting to the line's, `placement: 'boardCenter'`, `countUp`,
    `fadeIn`, and `cueBigWin` — the amount counts up to the first big-win threshold and hands over
    to the overlay).
  - `winCycle` — the resting replay after a spin (`enabled`, `delay`, `showLine`, `showText`,
    `showMessage`), `holdAfterBigWin` (free spins wait for a spin press), and `dimNonWinning`.
  - `winExplode` (the winners explode and are gone, once per paying spin, just before the board is
    replaced), `winBeat.maxMs` (a ceiling on one winning symbol's beat — a shaper, distinct from
    the `WIN_BEAT_CAP_MS` runaway guard), `arrivalRelease` (the round stops awaiting the `emerge`
    intro; authored in the Transition section, deliberately not gated on a bound transition).
  - `tumblePattern` (the order and gap of the explosion waves, one definition in
    `engine-layout/tumblePattern.ts`) and `transition` (a rig / flipbook / FX bridging each
    seat's explosion to its intro, fire-and-forget).
  - `stackedPictures` — symbols drawn as one tall picture (`art` + `winArt`, height, `winHoldMs`).
  - `anticipation` — overlay rig + animation set, activation / loop sounds, per-big-tier FX.
  - `bookVfx` (layers behind / in front of the book symbol during free spins), `symbolSounds` (the
    cue one symbol plays entering `land` / `clearReel`), `names`.
  - `coinLabel` (Hold and Win, gated on `kindCapabilities().coinSymbols`) — the value a coin prints:
    style, cash format, per-tier jackpot text + style, placement, land / count pops, count length.
    Shape, defaults and prune live once in `engine-layout/coinLabel.ts`; the bake's rebuild is
    `scripts/lib/bakeCoinLabel.mjs`.
  - `respinLandOnStop` (Hold and Win, or once authored) — **Play Land as each cell stops**: a coin
    plays `land` (and its landing cue) as its own respin cell stops, and an unbound `coinStick` no
    longer replays it. Rule: `engine-game` `respinStopState` / `respinHeldDrawState`.
  - `flights` (Hold and Win only, or once authored) — per flight kind (`toTotal`, `toCollector`,
    `boostBeam`, `toMeter`, `toMeter:<id>` for each Game Config meter): the head (built-in glow,
    re-tinted glow, sprite / rig / flipbook, none), the trail (an Invisible FX effect played as a
    moving emitter, or off), the arrival effect, the route (max bend, over-route, avoid win cells,
    padding) and the timing (speed, min / max ms, ease, stagger). One definition for the tool, the
    server and the game: `engine-layout/flightStyle.ts` (`normalizeFlights`, `resolveFlightStyle`:
    exact kind → `toMeter` family → coded, field by field) and `flightPath.ts`
    (`flightPlanOptions`, `flightEaseOf`). The section's **flight preview** plans the route with the
    game's `planFlight` over a mock 5×3 board with draggable ends and clickable win cells; an
    authored trail plays on `FxStage` through its `ownerPos` hook (still container, moving owner —
    the game's mechanism); the coded trail is a canvas approximation.
- **Ship chain** — `symbolExport.ts` → `deploy/editor-symbols/` → bake → pull →
  `bakedSymbolMap()` / `bakedSymbolAssets()`. Symbol sheets go through the shared `PageStore` with
  KTX2 twins, and the game picks the compressed tier like editor art. A bound rig that resolves
  to nothing is reported (`spinesMissing`) at bake, publish, boot and delivery.
- **Symbol size is not authored anywhere** — each symbol contain-fits its reel cell by its own art;
  the box is set by Art bounds (sprite) or the Rigger's Bounds (rig).

**Adding a doc global means touching every hand-written list** — the `.strict` Zod schema + sparse
rebuild in `normalizeSymbolsDoc`, the client type / setter / **`docSignature`** (else Save never
enables), the `symbolExport.ts` result, the `/api/editor/export-symbols` response, and the
**`bake-editor-doc.mjs` whitelist** (else only the runtime-bundle path carries it). A PER-SYMBOL
section (`symbols`, `names`, `symbolSounds`, `symbolFx`) also joins `SYMBOL_BLOCKS` in
`projectBonusImport.ts`, or a bonus import leaves it behind. `check:win-cycle` derives its field
list from the schema; the other globals are pinned by `check:clear-reel`, `check:symbol-layers`,
`check:symbol-transition`, `check:tumble-pattern`, `check:sound-bindings`, `check:coin-label`,
`check:respin-land`, `check:flights` (which also RUNS the bake's `scripts/lib/bakeFlights.mjs`
rather than grepping for it) and `check:symbol-fx` (which runs the real save, exporter, export
endpoint, bake rebuild and Director op over an in-memory R2). A global that names an Invisible FX
effect must also join the reachable-effects set in `runtimeBundle.ts` AND `bake-editor-doc.mjs`,
or the effect is pruned as an orphan.

## Open items / next

1. **S5 — prove end-to-end.** Keep symbol frame names unique across bound sheets, verify the
   shared-rig fallback, then rebind a symbol online → tokened rebuild → republish → confirm the
   new asset/animation in-game.
2. **Compressed symbol textures on a failing device** — the black-box symbols on an S24 / iPhone 18
   are attributed to raw symbol pages (107 MB vs 66 MB of compressed editor art, measured); the fix
   is built, and a re-bake + runtime release + a look on those devices is owed.
3. **Preview endpoints are still `editor`-gated** (`/api/editor/regions`, `/api/editor/rig`,
   `/api/editor/asset`) — a user holding only `symbols` gets a 403 on previews. Every default role
   holds both.
4. **Default-art cells render as placeholder chips until project assets are seeded into R2**; rig
   _default_ cells stay chips regardless — only a rebind stores a full bundle prefix that previews.
5. **`bookVfx` + `transition` can carry a `blendMode` / `dimWithSymbol` but no control offers one**
   (they share the layer schema). Adding the two selects is the whole job.
6. **Cell layers are not composited in any preview** — the grid's one WebGL canvas cannot; a
   panel-only DOM composite for sprite/flipbook layers over a sprite base is the next increment.
7. **A stacked picture's `art`/`winArt` accepts `layers`** but nothing authors them and export strips
   them — wire them through or narrow that schema.
8. **"Explode and be gone" leaves a winning board nearly empty until the next spin** — as designed;
   whether the resting board should show the winners instead is an open product call.
9. **The no-flow branch of `playBookEvents` bypasses `dispatchBookEvent`**, so on a game with no
   FlowDoc the win-cycle record (and therefore `winExplode`) stays inert.
10. **Flights: the preview draws the CODED trail as a canvas approximation**, not the
    `constants-shared` trail config the game emits (the launcher does not depend on `constants-shared`/`engine-game`). An authored trail
    and every route are the real thing (a bone-placed trail layer is mounted FREE by `FlightView`,
    as the preview draws it). `boostBeam` is listed and flown since Hold and Win Polish 2
    (booster → each coin it multiplies).
11. **Flights are not yet verified on a real board** — the authored head (its turn and 3D depth
    included) / trail / arrival in a running Hold and Win round (Storybook
    `MODE_HOLD_AND_WIN/flights` with a baked block) is owed.
12. **Flights: 3D depth scales the head only** — the trail's particles keep their size and the route
    on screen is the planned 2D one (it is not pulled toward a vanishing point). Growing the trail
    with the head needs a per-spawn scale on the emitter, which `@barvynkoa/particle-emitter` has no
    hook for (`ownerRotation` exists, an owner scale does not).

## Blocked (owner / external)

- Owner visual-verify on a real board for the globals marked ⏳ in the history (win-line drawing,
  tints, the win dim, layers' blend, the pop, the arrival release, the transition, book VFX).

## Recent changes

- 2026-10-23 — **Each row offers only the states the game plays for it.** Owner: the Hold and Win
  and pots overlay rows showed every state (17 columns on a Hold and Win + 3 Pots project), most of
  them never played for that symbol (a token's Spin / Land / Win / Post-win / Explosion; a coin's
  Win / Post-win; a plain coin's Coin boost / Respins add / Mystery reveal …), so art could be set
  that ships but never shows. Traced each beat to its subject in the game (`Board.svelte` lights
  only paying cells, and role symbols carry no paytable; `holdAndWinPresentation.ts`'s
  `playHeldBeat` / `lightBaseCell` subjects; `RespinCell`'s `spin` / `coinLand`; `OverlayToken` /
  the reel rider / `FlightLayer` for tokens) into `symbolStatesPlayed(columns, facts, { bookReveal })`
  in `engine-layout/symbolStates.ts`. `symbolsPageConfig` adds `plays` (per row: `dealt`,
  `onReels` — a non-respin strip deals it and the project is not a coin board — `token`,
  `holdAndWinRoles`, `fillsMeter` — a symbol-filled meter's symbol) and `holdAndWinRows`, and orders
  `symbols` with that group last so `/win-text` lists rows in the order `/symbols` draws them. Page:
  per-group `stateHeads` + `<colgroup>` sized to the widest group (cells size by it too), an empty
  `cell-off` slot for a state the row does not play, `unplayed` (authored cells no played state
  borrows, and Element FX on a state not played — FX never borrow) on each row head with **Clear**,
  and a **Clear all** note. Render-only: the doc, the export and the game are unchanged, so a
  project looks exactly as before until someone clears what is listed. The rig-animation warning
  now scans only the cells a row offers. Gates: `check:symbols-kind-gating` §5 (every kind × setup:
  no bonus ⇒ every column as before; tokens their four; no Hold and Win state on a role-less row
  except a meter filler's flight; no `win` / `postWinStatic` / book state on a role row; each role
  beat only on its role; the held set; the classic preset's coin, blank and line rows exactly; the
  page wiring) — 3374 checks; a mutation of the rule fails 22. `check:symbols-follow-config`,
  `check:symbol-state-parity`, `check:symbol-fx`, the svelte-check ratchet and lint unchanged.
  Not verified in a live browser (no launcher DB / R2 in the session).
- 2026-10-21 — **Element FX per symbol state** (authoring + ship; the game side is in
  [status/fx](fx.md)). Owner ask: "when a symbol lands it shakes, when it wins it glows, when it
  explodes it melts". New doc section `symbolFx` (symbol → state → `ElementFxEntry[]`), beside
  `symbolSounds` and for the same reason (an override cell replaces the whole binding). Server: a loose schema (`z.record(z.enum(SYMBOL_STATES), z.unknown())`, both
  levels `.catch`) so an unknown state is stripped with a warning and nothing in the section can
  fail the doc, then `$lib/symbolFx` `pruneSymbolFx` (a non-blank symbol, `SYMBOL_STATES` keys,
  arrays of plain objects, ≤ `SYMBOL_FX_MAX` = 12, empties pruned at both levels), entries VERBATIM
  so a kind from a newer build survives a save; `SymbolsDoc.symbolFx` is typed off that prune, the
  strict cell schema untouched. Client: `symbolFxOf` / `setSymbolFx` (the same prune) and
  `docSignature` (pruned, symbols sorted, states in `SYMBOL_STATES` order, entry keys sorted). Ship:
  `symbolExport.ts` → `symbolFx` (absent when empty) → `/api/editor/export-symbols` →
  `bake-editor-doc.mjs` (`scripts/lib/bakeSymbolFx.mjs`, a shape rebuild) and the runtime bundle,
  both as `bundle.symbols.symbolFx`; `projectBonusImport` `SYMBOL_BLOCKS` carries it with an
  imported symbol; Director `symbols.set_state` keeps it (it spreads the doc); a `gameProfile` chip
  "Symbol Element FX (N symbols)". UI: the panel's **Element FX** block under Layers, the Scene
  Editor's `EditorElementFx` with `triggers` `enter` / `always` ("When it enters this state" /
  "While in this state (loops)"), no stop cue, not keyable, edited on the doc directly (no Apply);
  a `✦ on <symbol>:` row of the states that carry effects (click to open one); a gold **✦** badge
  (✦ N for several, tooltip lists them) in each grid cell's foot; a **Preview** field for sprite
  cells (rig and flipbook had one). ▶: `symbolFxPreview.client.ts` copies the panel preview's
  canvas into a still and plays it through the Scene Editor's `playOnStill` in an overlay mounted
  in the preview box, reaching 0.6× the preview's side past it; the canvas hides while it plays;
  Escape, a press on the preview, a change of art, or play-out ends it. The rig preview's context
  does not preserve its drawing buffer, so `SymbolRigPreview` gained `isReady()` / `snapshot()`,
  copied at the end of its own frame. Gates: new `check:symbol-fx` (39 checks; real
  `saveSymbolsDoc` / `exportEditorSymbols` / export endpoint / bake rebuild / Director op over an
  in-memory R2; mutation-tested on the normalizer, signature, exporter, endpoint, bake, bonus import
  and cap), `check:doc-readers-unknown-fields` (an unknown `symbolFx` state warns),
  `check:bonus-import` (the coin's FX come along). Headless Chromium (a scratch harness over the
  real `symbolFxPreview.client.ts` + `playOnStill`): the still lands on the symbol, the canvas hides
  and returns, glow / shake / melt / stale all end and clean up, and a WebGL canvas copied in its
  own frame reads back while one copied a task later is blank. ⏳ Owner check in the real page and
  on a board.

- 2026-10-20 — **Hold and Win: a coin can play Land as its own cell stops.** Reported as "the land
  animation I set only plays after all the reels have landed". That was the respin board's design,
  not a fault: a stopping respin cell draws `coinLand` (unbound ⇒ `static`), and `land` reached the
  coin only through `coinStick`, in the `coinsLand` beat, which runs after `spinRespinCells` resolves
  on the LAST cell. (The base reels already play `land` per reel, after that reel's bounce.) New
  sparse doc global `respinLandOnStop: { enabled: true }`, the switch **Play Land as each cell
  stops** in a new **Coins landing on the respin board** section (Hold and Win projects, or once
  on). On: the stop draws `land` unless `coinLand` is bound (`respinStopState`), the landing cue
  plays at the stop, the `coinsLand` beat waits for the stops' bound `land` to finish (capped at
  `INTRO_BEAT_CAP_MS`, slammable) so the held layer does not cut the last coin short, skips the cue
  it already played, and an unbound `coinStick` on those cells draws `coinIdle` instead of replaying
  `land` (`respinHeldDrawState`; the beat state is still `coinStick`, so the label's stick pop
  fires) and is held with `capMs: 0`, so a looping idle adds no wait. A stick with no stop before it
  (mystery reveal, special becoming a coin) borrows `land` as before. The blank never lands at its
  stop (`respinCellStopState`), whatever it binds. A coin board's base spin runs on the same board,
  so the switch applies there too (no `coinsLand` follows it; `landed` clears at the next spin).
  With `coinLand` bound, the stop draws it and an unbound stick draws the rest, so `land` itself
  never plays with the switch on — by the "a bound cell wins at its own moment" rule. New
  `createRespinBoard` dep `onCellLand(reel, row, symbol)`, called as each cell's spin resolves. Off
  ⇒ byte-parity (no new await, no new write). Gates: the rules in
  `engine-game/fixtures/respinBoard.fixture.ts`; the chain (schema, setter, `docSignature`, export,
  endpoint, bake whitelist, reader, the three game call sites) in `check:respin-land`
  (mutation-tested). Real clock (headless shell, 4 fps): `createRespinBoard` fired `onCellLand` per
  cell at 2.9 / 3.2 / 3.5 / 4.2 / 4.5 s with the window symbol already in `land`, and the respin
  resolved only after the last. ⏳ Owner check on a real Hold and Win board (the switch is not
  reachable in a container dev build). Runtime release on merge.

- 2026-10-16 — **Flights: a flying pots token no longer shows the win frame.** The token flies as
  `<Symbol state="flyToMeter">`, and `flyToMeter` is a `WIN_HIGHLIGHT_SYMBOL_STATES` member (it
  frames the cell a Hold and Win special leaves from), so the authored Highlight drew around the
  head in the air. `Symbol.svelte`'s `labelHidden` became `inFlight`, which turns off the win frame
  as well as the coin label; `FlightLayer` mounts the carried symbol with it. The board cell's
  `flyToMeter` frame (a special flying into its meter) is unchanged, and the overlay's tokens on the
  board never reach a framed state.

- 2026-10-16 — **Flights: a fast-slow-fast ease with a Slowdown.** `flights.<kind>.ease` takes
  `easeOutIn` (label "Fast-slow-fast"), and `flights.<kind>.slowdown` (0…1, resolved exact →
  `toMeter` family → 0.6) sets how much it slows: the curve is `(1 − s)·t + s·cubicOutIn(t)`, so
  its speed is `1 − s` of the average at mid-flight and `1 + 2s` as it leaves and lands (1 = the
  full cubic, a stop at mid-flight; 0 = linear). Other eases ignore it. `flightEaseOf` now takes
  `{ ease, slowdown }` (the resolved style, or the game's `ActiveFlight`, which carries both). The
  Slowdown input sits beside Ease in `/symbols` → Flights, shown while the kind flies
  Fast-slow-fast or once authored. Made for 3D depth: the head's pose runs on the eased t, so it
  lingers where the depth peaks. An older runtime drops the unknown ease on read and flies the coded
  one (`check:doc-readers-unknown-fields`). `flightStyle` fixture (the curve's speeds, clamp,
  family fallback) and `check:flights` (round-trips both). Runtime release on merge.

- 2026-10-16 — **Flights: the head-turn fields show for every head, and a pots token turns too.**
  "Head follows the curve" and "Head rotation" were shown only for a sprite / rig / flipbook head no
  pots token replaced, so an author on the built-in glow or a pots meter saw "3D depth" alone and
  no way to turn anything. Both now show for every head, like "3D depth", with a hint under them
  when a set turn cannot show (`flightTurnNote`: the round glow, a `none` head). A carried pots
  token now takes the whole pose like an art head: `FlightLayer` turns the `Symbol` with its label
  switched off (`labelHidden`, now `inFlight`) and draws the value itself, upright over it
  at the perspective scale, so the number never turns or mirrors. The `/symbols` preview turns the
  token art the same way.

- 2026-10-15 — **Flights: the head can follow the curve, and fly with 3D depth.**
  `flights.<kind>.headAlign` (`off` / `follow` / `upright`), `headRotation` (degrees, −180…180) and
  `depth` (−1…1), resolved exact → `toMeter` family → off / 0 / 0. One pure rule, `engine-layout`
  `flightHeadPose(style, heading, t)`, gives the head's pose at each eased t: turned to the heading
  when it follows (an `upright` head is mirrored instead of turned upside down while it heads left),
  the art turned by `headRotation` first, and the perspective of a rise out of the screen and back
  (`1 / (1 − depth·½·sin πt)`: 2× at mid-flight for 1, ⅔ for −1, 1 at both ends), with a following
  head foreshortened along its travel by the rise's slope (camera as far away as the route is long,
  so the lean does not depend on the route's length). The game keeps the pose on each flight
  (`flights.svelte.ts`, updated in place) and `FlightLayer` draws the art head through it (outer
  container: heading + scale × stretch / flip; inner: the art's turn); the glow, the "+N" label and
  a carried pots token take only the perspective scale (a token's value text must not turn or
  mirror). The `/symbols` preview applies the same pose to its art head (a CSS transform), token,
  glow and label. Fields under Head in `/symbols` → Flights ("Head follows the curve" and "Head
  rotation" show for an art head no token replaces, or once authored; "3D depth" always). Schema, normalize, resolve, `check:flights`, `check:doc-readers-unknown-fields`
  (a newer `headAlign` value is dropped on read) and the `flightStyle` fixture (+ the pose).

- 2026-10-14 — **Flights: the trail can follow the arc and be rotated.** `flights.<kind>.trailAlign`
  (boolean) and `trailRotation` (degrees, −180…180), resolved exact → `toMeter` family → off / 0.
  The game tracks each flight's heading (`engine-layout` `headingOnCurve`, the curve's tangent at
  the eased t) and feeds `(aligned ? heading : 0) + rotation` to the trail emitter through a new
  `ownerRotation` getter on `ParticleEmitter` / `EffectLayer` / `EffectPlayer` (→ `emitter.rotate`,
  which turns each NEW particle's art, launch direction and spawn offset; the ones already out keep
  theirs). The `/symbols` preview's `FxStage` takes the same getter. Fields under Trail in
  `/symbols` → Flights; schema, normalize, resolve and fixtures (`flightStyle`, + heading). A
  `noRotation` (rotation-locked) FX layer still pins its art; the coded glow trail is round, so
  only authored trails show it.

- 2026-10-14 — **Flights: a Size for the built-in head, and a preview that shows the picked head.**
  `flights.<kind>.size` (0.05–5, resolved exact → `toMeter` family → 1 like the timing fields)
  multiplies everything `FlightLayer` draws at the head: the coded glow, a pots overlay's token, the
  "+N" label, and an authored head on top of its own `head.scale`. The `/symbols` Size (×) field
  shows for every head, Built-in included; an authored head's own field is now "Head size". The
  flight preview applies the size, draws the pots token (its `flyToMeter` art, falling back to
  `static`) as the head of a meter an overlay fills — as the game does, whatever head is picked —
  draws the "+2" of `toCounter`, and plays the arrival effect at B on landing (a second `FxStage`,
  re-armed each loop). Schema, normalize, resolve and fixtures (`flightStyle`).

- 2026-10-07 — **`/config` decides the rows, for every kind and setup.** The grid already hid a
  symbol `/config` badges unused, but only when the project had SAVED its config: a project still on
  its kind's template filtered nothing, so a never-saved scatter project listed `L4` (unused in its
  template) and missed `M` (in play), a ways one missed `H5`, and a project whose published defaults
  predate the in-play filter listed `W` and `H5`. The other contradiction was a pots overlay's
  tokens: `/config` badged them unused while this page listed them (they need art). Now both pages
  read one rule, `game-config`'s new `symbolUses` (`inPlay` / `token` / `unused`): `/config` lists
  the tokens apart as **Coins**, unbadged (the overlay decides whether a coin is used; nothing
  offers to put one on the reels, a validator error), and this page lists exactly the non-unused
  symbols, the coins grouped under a **Coins** heading after the rest (`coins` from
  `symbolsPageConfig`, one `gridRow` snippet for both groups), read from `resolveGameConfig` — the
  config `/config` opens with — instead of the authored-only loader. Everything the page takes from
  the config now comes from that one doc through `symbolsPageConfig`, so a never-saved scatter
  project also gets `Clear reel`, as its template's cascade says, and the big tiers no longer cost a
  second read (`resolveBigTiers` is gone; `bigTiersOf`). A never-saved project's live game still
  runs the compiled template until `/config` is saved, so for ways and scatter the rows show the
  template it will adopt, not the board it deals today. Stacked pictures list only shown symbols.
  Nothing is deleted from the doc. Gate: `check:symbols-follow-config` runs the page's own
  composition over `resolveGameConfig`'s precedence (`resolvedGameConfigFrom`) for every built-in
  kind and a custom one × never saved / unreadable / saved / a symbol off or on the reels /
  dictionary-only / each overlay and Hold and Win preset / an imported bonus × committed, wider and
  narrower published defaults (2,569 checks); red on either old behaviour, on a page that reads the
  saved doc only, on token rows out of pot order, on a badge in `/config`'s Coins section or a coin
  in its Symbols table, and on coins left out of this page's Coins group.

- 2026-10-05 — **Invisible Director can drive this tool.** Invisible Director's adapters (PLAN 2.6,
  `apps/launcher-api/src/lib/server/director/ops/`) now read and write this tool's doc
  (`symbols.get_map` / `symbols.set_state`: one symbol × state cell at a time, keeping its layers)
  through its own storage module, under `If-Match`, stamping `saved_by` (`tool: 'director'`, the
  agent, the run). A save without a stamp drops a carried one (`savedBy.ts`), so `saved_by` always
  names the last save. The page is unchanged.
- 2026-10-02 — **The page reads the Game Config add-on blocks** (Pots overlay Phase 5d). The kind's
  capabilities now take the config's add-ons (`$lib/addOns.ts`: `projectAddOns` for the
  `holdAndWin` / `potsOverlay` presence flags and the meter ids, `overlayTokenPots` for each overlay
  token → its pots, both read through `resolveMeters`). A project with a `potsOverlay` block, any
  kind: its token symbols join the grid even though no strip deals them, each with a
  `token → <pot id>` chip; the columns gain only Coin land / Coin idle / Fly to meter
  (`POTS_TOKEN_SYMBOL_STATES`, with token tooltips) unless a `holdAndWin` block is also present;
  Flights shows (on `caps.pots`) `toMeter` plus one `toMeter:<id>` row per meter — Hold and Win's
  first, then the overlay's — and hides the other flight kinds unless already authored. A
  `holdAndWin` block on any kind (e.g. Book-of with a Hold and Win bonus) gets the full coin
  columns, role chips, coin value label and flights. No block ⇒ unchanged. Gate:
  `check:symbols-kind-gating`. Guide: [Pots overlay projects](../tools/symbols-state-machine.md#pots-overlay-projects).

- 2026-10-02 — **Hold and Win: states `respinsAdd` / `coinUpgrade` (fallback Win) and Flights rows `toCounter` / `upgradeBeam`** (Phase 11a, #995). The bake keeps both flight keys; `check:flights` now asserts every `FLIGHT_KINDS` entry survives the bake. Detail: [status/hold-and-win](hold-and-win.md).

- 2026-10-02 — **Hold the spin button to keep spinning — a per-project switch, off by default**
  (`winCycle.spinButtonHold`, in the "Winning symbols after the spin" section beside **Wait for a
  spin press after a big win**). It gates the hold-to-spin added to the spin button in #975, which
  had shipped always on. Wired like `holdAfterBigWin` everywhere: the `.strict` schema plus sparse
  rebuild in `symbolsStorage`, the client getter/setter and the dirty signature (`check:win-cycle`
  covers it: 91 checks), the bake whitelist in `bake-editor-doc.mjs`, and a `gameProfile` chip. The
  runtime path forwards `winCycle` whole. The game reads it through `bakedWinCycleConfig()` and
  hands it to `utils-shared/spinHold` (`setSpinButtonHoldSource`), read at each press. Space-hold
  is unaffected.

- 2026-10-01 — **Flights: an Arc knob** (Hold and Win Phase 4 polish, item 9). `flights.<kind>.path.arc`
  (−1…1, a share of the straight distance; + bows up on screen, − down; absent/0 = straight, so every
  existing route is unchanged) shapes the PREFERRED route in `planFlight`; avoidance still detours
  around a win cell on the arc. One mapping (`flightPlanOptions`) feeds the game's `flyTo` and the
  `/symbols` preview. Field in `/symbols` → Flights beside "Max detour"; schema, normalize (clamped,
  0 dropped), resolve (toMeter family) and fixtures (`flightPath` / `flightStyle`).

Detail for every entry is in [symbols-history.md](symbols-history.md).

- 2026-10-01 — **A save keeps the top-level blocks this build does not know.** Before an
  `If-Match` save, `saveSymbolsDoc` reads the stored doc. If its ETag is the save's `baseEtag`, it
  copies every top-level key `symbolsDocSchema` does not declare onto the PUT
  (`storedUnknownBlocks`). An author saving from an older launcher after a rollback no longer
  deletes a block a newer one wrote. A create, a forced overwrite or a stale ETag copies nothing.
  Nested unknown keys are still dropped and are recoverable from backups. A backup restore keeps
  the restored bytes' unknown blocks instead (`{ unknownFrom: 'doc' }`). A known-only doc saves
  byte-identically. Gate: `check:save-keeps-unknown-blocks`. Rule: `docs/conventions/doc-readers.md`
  "Round-tripping".

- 2026-10-01 — **An unknown enum VALUE costs one entry, not the whole doc.** A newer launcher's
  cell `type`, layer `kind`, blend mode, tumble pattern, flight head kind or ease, cash format,
  `tintMode`, `placement`, non-rig `highlight`/`boardGlow` or `version: 2` failed the parse, so
  `loadSymbolsDocWithEtag` fell back to the empty doc and the export pruned `deploy/editor-symbols/`
  to match. Now a READ drops the optional field (its default applies) or the smallest entry that
  cannot stand without it (the cell, the layer, the stacked symbol, the block), with one server
  warning naming both. The SAVE (`PUT /api/editor/symbols`) still answers 400, as the typo guard. A
  backup restore and the published-defaults publish drop instead of refusing. Known-only docs read
  byte-identically. Proof is in section 15 of `check:doc-readers-unknown-fields`. The per-field
  table and the save trade-off are in `docs/conventions/doc-readers.md` §"Unknown enum values".
  What an older launcher drops is gone from R2 on its next save, so the backups have to hold it:
  `putDocWithBackup`'s 5-minute `'auto'` window now coalesces only over bytes the same process
  wrote. A doc another instance or build wrote is copied even inside the window
  (`check:doc-backups`). This applies to every doc with backups.

- 2026-10-01 — **An unknown field or symbol state no longer wipes the whole symbols doc.** Every
  nested block was `.strict()` and the state records are keyed by `z.enum(SYMBOL_STATES)`, so one
  field or state a newer launcher wrote failed the parse and `loadSymbolsDocWithEtag` fell back to
  the empty doc — the tool, the export/bake and the runtime bundle all lost every binding (and the
  next save overwrote the real one). `normalizeSymbolsDoc` and the published-defaults parse
  (`parseSymbolDefaults`) now strip unknown keys first (`stripUnknownKeys`, a server warning names
  each path); malformed KNOWN fields still 400. The six gates that asserted "an unknown key is
  refused" now assert "ignored, with a warning". This supersedes #961's silent fix (`coinLabel`/`flights`
  turned `.strip()`, unknown states deleted in `migrateLegacySymbolStates`): those blocks are
  `.strict()` again and the strip pass drops the same keys, now with the warning. Real R2 docs normalize unchanged. Rule:
  `docs/conventions/doc-readers.md`.

- 2026-10-01 — **Live proof + two fixes (Hold and Win Phase 7).** On `hw-3pots-sample` (authoring
  path, real clock) the authored coin label and every flight kind render as authored (numbers in
  [status/hold-and-win](hold-and-win.md)). #963: held coin labels drew BLACK on the respin board —
  pixi `BitmapText` defaults `fill` to white only in its constructor and `CoinLabel` re-assigns a
  fill-less style every render; it now passes `fill: 0xffffff`. The tint hint says a tint multiplies
  the font (gold turns cyan green); "Max bend" is now "Max detour" (it never arcs a route with
  nothing in the way). #961: `coinLabel` / `flights` strip unknown fields and the state-keyed maps
  drop an unknown state, so an older launcher loses one key, not the doc (`check:clear-reel` now
  pins "dropped, siblings kept").
- 2026-10-01 — **Hold and Win Phase 7a — states, roles, kind gating, defaults.** Eight H&W symbol
  states with inheritance that replays Phase 4's coded beats (an unauthored project is
  unchanged); `mysteryReveal` is terminal; the win frame draws on every `WIN_HIGHLIGHT_SYMBOL_STATES`
  state. The respin board requests `coinLand` on a stopping cell (it plays the reel's `spin` while
  rolling) and rests held cells on `coinIdle`; the presentation beats request `coinStick` (sticks,
  specialBecomesCoin, a mystery landing as what it became), `coinBoost` (payer, multiplier booster),
  `coinCollect` (the per-coin collect step beside its flight, Grand's column-letter coins, and both
  sides of a base-game instant collect), `jackpotReveal` (coin jackpot, full board, a jackpot coin's
  factor step under a boost), `mysteryReveal` (mystery opening) and `flyToMeter` (a base-board
  special flying to its pot). A streak's or a column's coins still leave on `clearReel`; the wheel
  plays no symbol state. Grid columns gated on
  `kindCapabilities().holdAndWin`; three new capability flags hide four sections for Hold and Win;
  role chips on row heads; `symbolDefaultsFor('holdAndWin')`. New gate `check:symbols-kind-gating`.
  The Scene Editor's two symbol-state pickers offer the eight Hold and Win states only to a
  `holdAndWin` project (`symbolStatesForKind`, pinned in the same gate).
- 2026-10-01 — **Coin value label** (Hold and Win Phase 7b): a new `coinLabel` doc global and a
  "Coin value label" section, shown for a coin-symbol kind. It styles the label a coin prints
  (font / size / tint, per jackpot tier too), its cash format (money or × bet, fewest decimals,
  trimmed zeros), each tier's text (the ` ×N` suffix kept), its placement, and two pops (as the
  coin sticks; as a count lands) plus the count-up length. One home for the shape, defaults and
  prune (`engine-layout/coinLabel.ts`), shared by the page, `normalizeSymbolsDoc` and the game, so a
  draft signs exactly like the saved doc. Full chain: export → endpoint → bake
  (`scripts/lib/bakeCoinLabel.mjs`, run by the fixture) → `bakedCoinLabel()` → `coinLabelFor` /
  `components/CoinLabel.svelte` / `RespinHeldSymbol` pops. Fonts need no new wiring: the font
  export ships the whole catalog. Absent ⇒ the coded label byte-for-byte (`coinLabelText` with no
  format, the same `bookEventAmountToCurrencyString`). Pinned by `check:coin-label` (39) and the
  engine-game `coinLabel` fixture. ⏳ owner visual-verify on a Hold and Win board.
- 2026-10-01 — **Flights** (Hold and Win Phase 7c): the `flights` doc global and its section. The
  block is strict in shape and forgiving in value — junk keys and invalid values are dropped and
  numbers clamped by `engine-layout`'s `normalizeFlights`, which the page's `setFlightStyle`, the
  server's `normalizeSymbolsDoc` and `docSignature` all run, so the page never signs a doc the save
  changes. Ship chain: sprite / rig heads through `collectSymbolRefs` (`bakedFlightAssets()`),
  flipbook heads through the clip walk, trail / arrival effects added to BOTH reachable-effects
  sets (`flightEffectIds` / `bakedFlightEffectIds`), the block through the exporter, the export
  endpoint, the bake (`scripts/lib/bakeFlights.mjs`) and `bakedFlights()`. The game's `flyTo`
  resolves each flight's style (speed, min / max, stagger, ease, padding, bend, over-route,
  avoidance) and `FlightLayer` draws an art head through `SymbolLayer`, an authored trail through
  `FlightView`'s `<EffectPlayer ownerPos>` and the arrival once at the target; an absent block
  resolves to exactly the coded flight (pinned by `engine-game/fixtures/flightStyle.fixture.ts`).
  `flightPath.ts` moved from `engine-game` to `engine-layout` so the tool and the game plan with
  one copy (engine-game re-exports it). `FxStage` gained `ownerPos` / `emitting` /
  `showReference`; `SymbolFxPreview`'s doc + art reads moved to `fxPreview.client.ts`.

- 2026-09-30 — **Leaving with unsaved edits asks first**: the page tracked `dirty` but registered no leave guard, so a tool-bar switch, Back, a reload or a tab close discarded edits silently. It now calls the shared `guardUnsavedWork` (app confirm in-app, browser prompt on unload). A History… restore marks the doc settled before its reload, so the author is not asked a second time over a restore already applied. (No history entry — see the launcher status of the same date.)
- 2026-09-29 — **Docs caught up**: the guide covers the Save conflict prompt and no longer points at the removed reel symbol-size control. Status detail split into [symbols-history.md](symbols-history.md).
- 2026-09-29 — **Version history** — each save backs up the `symbols.json` it replaces
  (`symbols/backups/`, newest 20); **History…** restores through the normal save path (#847).
- 2026-09-28 — A bound rig that resolves to nothing is reported, not shipped silently
  (`spinesMissing`); a manual Save asks before overwriting a newer save again (#821 — the click
  event had been arriving as `force`; guarded by `check:event-bound-flags`); `/api/editor/symbols`
  refuses an inaccessible project.
- 2026-09-22 — **Symbols ship GPU-compressed**: `bakedSymbolAssets()` never selected the KTX2 twins
  the exporter built; symbol sheets now go through `PageStore` (including from the bake endpoint,
  which had passed no store), and `runtimeBundle`'s `prune:pages` is the only `_pages/` pruner.
- 2026-09-18 — The FX preview was offset at 150% browser zoom — `resolution` from
  `devicePixelRatio` without `autoDensity`; fixed in the overlay shared with the Rigger.
- 2026-09-17 — **Cell layers** (blend, behind, draw order), with the blend on the renderable rather
  than the wrapper, and **Dim with symbol** — the dim tint moved from `SymbolWrap` onto each drawn
  piece, because a Pixi tint can only darken further down the tree.
- 2026-09-16 — A win screen can **park** on the player (`waitForPress` on the Flow `winUpdate`
  node), released by mouse as well as Space; the big-win run-up moved to `dispatchBookEvent` and
  hands its number to the overlay (`check:big-win-cue`); the arrival release moved into the
  Transition section.
- 2026-09-15 — Win amount **count-up / fade-in / big-win cue**; **arrival release**; **longest win
  beat**; terminal states (`explosion`, `clearReel`) are one-shot by default (a looping pop had
  spent the whole beat cap every paying spin). Guards read source through
  `scripts/lib/read-lf.mjs` so they hold on CRLF checkouts.
- 2026-09-10 → 09-11 — **Winning symbols explode** and are gone, once per paying spin at the seam
  that replaces the board (a per-book pop missed most spins; a per-win pop broke shared paylines);
  a beat settles only the state it set (a slam had frozen the pop for 4 s); `tumbleExplosion`
  renamed **Clear reel**, legacy keys folded before the Zod parse (an unlisted key would have read
  the whole doc as empty); `symbolSounds` reaches both bundle paths.
- 2026-09-08 → 09-09 — **Explosion pattern** (waves, board-ranked for the per-column clear, spread
  capped at 2 s, unknown names degrade to one frame); spent seats are undrawn; the transition rides
  its own seat's pop; `holdAfterBigWin` was unsaveable (missing from `docSignature`) — now
  `check:win-cycle`.
- 2026-09-07 — The Highlight draws on sprite and flipbook symbols too (`SymbolWinFrame.svelte`).
- 2026-09-03 — **Explosion → intro Transition**; rig cells no longer blank on a cold load (one
  runtime).
- 2026-09-02 / 09-01 — Rigs fit their authored box; bound FX / clips no longer drawn mirrored.
- 2026-08-28 — A flipbook cell can walk its clip differently per state.
- 2026-08-27 — Every state has an authorable Loop; the stage is sized from the canvas's own box
  (FX had drifted by a scrollbar); `Intro` column; the parity gate derives its expectations.
- 2026-08-25 — Symbol sounds; stacked `winArt` (and `edgeCutoffs` now survive the bake).
- 2026-08-24 — Line and amount text split, amount can sit mid-board; all win lines at once; engine
  symbol rigs' canvases retightened (the lows had shipped ~38% undersized).
- 2026-08-21 — `_shared/spines/` carries the engine's 29 rig bundles (one per skeleton);
  `loadSkeletonIndexWithShared()` on both the read and export paths; the no-animation banner speaks
  only for 0 or 2+ animations; `Tumble explosion` split from `Explosion`.
- 2026-08-10 — Stacked pictures: over-height runs tile, rig tall art anchored at 0.
- 2026-07-28 → 07-16 — Scatter gets the highlight; book-symbol VFX; full payline / replay text;
  `winCycle` was never saved (the PUT body is now a spread) and was missing from the bake;
  display names; flipbook binding kind; coded defaults preview; board glow swappable.
- Before 2026-07-16 — resting win replay, shared win-line renderer, rig FX preview with the full bone
  transform, all-atlas frame scan ([history](../history.md)).
