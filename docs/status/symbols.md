# Invisible Symbols State Machine — status

> Design: [docs/design/invisible-symbols-state-machine.md](../design/invisible-symbols-state-machine.md) · Guide: [docs/tools/symbols-state-machine.md](../tools/symbols-state-machine.md) · Agent: [`.claude/agents/invisible-symbols.md`](../../.claude/agents/invisible-symbols.md) · Detail: [symbols-history.md](symbols-history.md)

**One-line state:** Shipped — `/symbols` authors each symbol's per-state art (sprite / spine /
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
- **Kind gating** — only through `kindCapabilities()`: `bookSymbolVfx`, `tumblePattern`,
  `symbolTransition` (true for every kind but `holdAndWin`) and `stackedPictures` hide the Book
  symbol VFX / Explosion pattern / Transition / Stacked pictures sections for Hold and Win, each
  kept while the doc still authors it. A `coinSymbols` kind shows each row's Hold and Win role
  chips from the live Game Config. Pinned by `check:symbols-kind-gating`.
- **The cell editor** — Sprite / Spine / Flipbook (`SYMBOL_CELL_TYPES`), a **Loop** toggle (absent
  means loop, except `explosion` / `clearReel`, which are one-shot by default via
  `symbolStateLoopsByDefault()`), a flipbook walk block (fps / direction / mirror, folded by
  `foldFlipbookPlayback`), and **Layers** — up to 8 extra pictures per cell, each with a blend mode
  (not on spine layers: a Pixi blend cannot reach skeleton geometry), **behind**, and **Dim with
  symbol**. Layers are drawn at the one choke point (`Symbol.svelte`), never report beat
  completion, and are not composited in any preview. Row heads carry display names
  (`names`, used by Invisible Win Text as `{symbolName}`).
- **Save** — ETag-conditional; a colleague's newer save raises **Someone else saved these
  symbols** / **Overwrite theirs**. **History…** restores any of the 20 newest backups
  (`$lib/DocHistoryModal.svelte`). `/api/editor/symbols` refuses a project the caller cannot
  access. **↻ Reload from R2** drops the spine and region caches (unsaved edits kept).
- **Rows follow Invisible Game Config** — the grid lists exactly the symbols `/config` does not
  badge **unused**: on a reel strip, or a pots overlay's token (`game-config` `symbolUses` /
  `symbolsUsed`, composed by `symbolGrid` in `symbolDefaults.ts`). It reads the config `/config`
  opens with (`resolveGameConfig`: the project's own, else its kind's template), so a project that
  never saved its config follows the template like that page does. A used symbol with no default
  gets blank cells; a hidden symbol keeps its authored states (stacked-picture entry included) and
  its row returns with them. Every kind × setup is pinned by `check:symbols-follow-config`.
- **Defaults** — the cells' default art: each game publishes its coded map at build
  (`publish-symbol-defaults.mjs`), filtered to the in-play symbols; un-published projects fall back
  to the committed `lines.json` (`holdAndWin.json` for a Hold and Win project: the lines set plus `W`
  and the 3 Pots specials on placeholder art, `BLANK` unbound). They no longer decide the rows.
- **Previews** — one shared WebGL stage, one spine runtime (4.2, `check:builtin-spines`), rigs
  fitted to their authored box (`measureSpineBounds` / `authoredSpineBox`), stage geometry from the
  canvas's own box (`symbolStageGeometry.ts`, `check:symbol-stage-geometry`), rig FX and clips on the
  shared `fxOverlay` (with `autoDensity`), coded built-ins vendored under `static/builtin/spines/`,
  and rig bundles re-derived from their source sheet when it drifts (`ensureBundleAtlasFresh`).
- **Doc-level globals** — each sparse (absent ⇒ byte-parity), each with a `gameProfile` chip:
  - `highlight` — the win-frame spine over every winning symbol of any art kind, with a `fixed` or
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
    `engine-layout/tumblePattern.ts`) and `transition` (a spine / flipbook / FX bridging each
    seat's explosion to its intro, fire-and-forget).
  - `stackedPictures` — symbols drawn as one tall picture (`art` + `winArt`, height, `winHoldMs`).
  - `anticipation` — overlay spine + animation set, activation / loop sounds, per-big-tier FX.
  - `bookVfx` (layers behind / in front of the book symbol during free spins), `symbolSounds` (the
    cue one symbol plays entering `land` / `clearReel`), `names`.
  - `coinLabel` (Hold and Win, gated on `kindCapabilities().coinSymbols`) — the value a coin prints:
    style, cash format, per-tier jackpot text + style, placement, land / count pops, count length.
    Shape, defaults and prune live once in `engine-layout/coinLabel.ts`; the bake's rebuild is
    `scripts/lib/bakeCoinLabel.mjs`.
  - `flights` (Hold and Win only, or once authored) — per flight kind (`toTotal`, `toCollector`,
    `boostBeam`, `toMeter`, `toMeter:<id>` for each Game Config meter): the head (built-in glow,
    re-tinted glow, sprite / spine / flipbook, none), the trail (an Invisible FX effect played as a
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
  KTX2 twins, and the game picks the compressed tier like editor art. A bound spine that resolves
  to nothing is reported (`spinesMissing`) at bake, publish, boot and delivery.
- **Symbol size is not authored anywhere** — each symbol contain-fits its reel cell by its own art;
  the box is set by Art bounds (sprite) or the Rigger's Bounds (spine).

**Adding a doc global means touching every hand-written list** — the `.strict` Zod schema + sparse
rebuild in `normalizeSymbolsDoc`, the client type / setter / **`docSignature`** (else Save never
enables), the `/api/editor/export-symbols` response, and the **`bake-editor-doc.mjs` whitelist**
(else only the runtime-bundle path carries it). `check:win-cycle` derives its field list from the
schema; the other globals are pinned by `check:clear-reel`, `check:symbol-layers`,
`check:symbol-transition`, `check:tumble-pattern`, `check:sound-bindings` and `check:coin-label`.
`check:symbol-transition`, `check:tumble-pattern`, `check:sound-bindings` and `check:flights`
(which also RUNS the bake's `scripts/lib/bakeFlights.mjs` rather than grepping for it). A global
that names an Invisible FX effect must also join the reachable-effects set in `runtimeBundle.ts`
AND `bake-editor-doc.mjs`, or the effect is pruned as an orphan.

## Open items / next

1. **S5 — prove end-to-end.** Keep symbol frame names unique across bound sheets, verify the
   shared-spine fallback, then rebind a symbol online → tokened rebuild → republish → confirm the
   new asset/animation in-game.
2. **Compressed symbol textures on a failing device** — the black-box symbols on an S24 / iPhone 18
   are attributed to raw symbol pages (107 MB vs 66 MB of compressed editor art, measured); the fix
   is built, and a re-bake + runtime release + a look on those devices is owed.
3. **Preview endpoints are still `editor`-gated** (`/api/editor/regions`, `/api/editor/spine`,
   `/api/editor/asset`) — a user holding only `symbols` gets a 403 on previews. Every default role
   holds both.
4. **Default-art cells render as placeholder chips until project assets are seeded into R2**; spine
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
10. **Flights: the preview does not play the arrival effect** (shown as a thumbnail in the editor)
    and draws the CODED trail as a canvas approximation, not the `constants-shared` trail config the
    game emits (the launcher does not depend on `constants-shared`/`engine-game`). An authored trail
    and every route are the real thing (a bone-placed trail layer is mounted FREE by `FlightView`,
    as the preview draws it). `boostBeam` is listed and flown since Hold and Win Polish 2
    (booster → each coin it multiplies).
11. **Flights are not yet verified on a real board** — the authored head / trail / arrival in a
    running Hold and Win round (Storybook `MODE_HOLD_AND_WIN/flights` with a baked block) is owed.

## Blocked (owner / external)

- Owner visual-verify on a real board for the globals marked ⏳ in the history (win-line drawing,
  tints, the win dim, layers' blend, the pop, the arrival release, the transition, book VFX).

## Recent changes

- 2026-10-07 — **`/config` decides the rows, for every kind and setup.** The grid already hid a
  symbol `/config` badges unused, but only when the project had SAVED its config: a project still
  on its kind's template filtered nothing, so a never-saved scatter project listed `L4` (unused in
  its template) and missed `M` (in play), a ways one missed `H5`, and a project whose published
  defaults predate the in-play filter listed `W` and `H5`. The other contradiction was a pots
  overlay's tokens: `/config` badged them unused while this page listed them (they need art). Now
  both pages read one rule, `game-config`'s new `symbolUses` (`inPlay` / `token` / `unused`):
  `/config` badges a token **token** (no longer offering to put it on the reels, a validator error),
  and this page lists exactly the non-unused symbols (`symbolGrid`), read from `resolveGameConfig` —
  the config `/config` opens with — instead of the authored-only loader. The columns and sections
  that read the config (Clear reel, Intro, the add-ons, the Hold and Win roles and jackpot tiers)
  follow the same config, so a never-saved scatter project now gets `Clear reel` as its template's
  cascade says; the big tiers reuse it instead of a second read. Stacked pictures list only shown
  symbols. Nothing is deleted from the doc. Gate: `check:symbols-follow-config` (every built-in
  kind and a custom one × never saved / saved / a symbol off or on the reels / dictionary-only /
  each overlay and Hold and Win preset / an imported bonus × committed, wider and narrower
  published defaults; 1,642 checks), red on either old behaviour.

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
  `tintMode`, `placement`, non-spine `highlight`/`boardGlow` or `version: 2` failed the parse, so
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
  changes. Ship chain: sprite / spine heads through `collectSymbolRefs` (`bakedFlightAssets()`),
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
- 2026-09-28 — A bound spine that resolves to nothing is reported, not shipped silently
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
- 2026-09-03 — **Explosion → intro Transition**; spine cells no longer blank on a cold load (one
  runtime).
- 2026-09-02 / 09-01 — Rigs fit their authored box; bound FX / clips no longer drawn mirrored.
- 2026-08-28 — A flipbook cell can walk its clip differently per state.
- 2026-08-27 — Every state has an authorable Loop; the stage is sized from the canvas's own box
  (FX had drifted by a scrollbar); `Intro` column; the parity gate derives its expectations.
- 2026-08-25 — Symbol sounds; stacked `winArt` (and `edgeCutoffs` now survive the bake).
- 2026-08-24 — Line and amount text split, amount can sit mid-board; all win lines at once; engine
  symbol rigs' canvases retightened (the lows had shipped ~38% undersized).
- 2026-08-21 — `_shared/spines/` carries the engine's 29 Spine bundles (one per skeleton);
  `loadSkeletonIndexWithShared()` on both the read and export paths; the no-animation banner speaks
  only for 0 or 2+ animations; `Tumble explosion` split from `Explosion`.
- 2026-08-10 — Stacked pictures: over-height runs tile, spine tall art anchored at 0.
- 2026-07-28 → 07-16 — Scatter gets the highlight; book-symbol VFX; full payline / replay text;
  `winCycle` was never saved (the PUT body is now a spread) and was missing from the bake;
  display names; flipbook binding kind; coded defaults preview; board glow swappable.
- Before 2026-07-16 — resting win replay, shared win-line renderer, rig FX preview with the full bone
  transform, all-atlas frame scan ([history](../history.md)).
