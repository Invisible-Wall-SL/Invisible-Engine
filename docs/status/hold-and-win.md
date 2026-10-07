# Hold and Win (game kind) — status + session hub

> Design: [docs/design/hold-and-win.md](../design/hold-and-win.md) · Guide: _none yet (per-tool
> guides get a Hold and Win section as each phase ships)_ · Agents: per phase — see the design's
> build plan.

**One-line state:** Phase 4 (engine runtime) build COMPLETE, all merged and live (2026-10-01,
`lines@e4bca6077db0`) — the shared runtime plays a whole Hold and Win feature with coded default
presentations for all three presets: coin value labels; a per-cell respin board with sticky coins and
a resetting counter; payer / multiplier (+ becomes-coin) / collector / mystery (+ unlock); persistent
pots seeded from boot that specials fly into; Lucky Spin; full-board and banked jackpots; the
feature-end count-up into the Total Win bar by coin flights; Grand's column letters and sweeps; a
base-game instant collect; Hotfire's collector streak and pre-feature wheel; and a resume that
rebuilds the board mid-feature. Phases 5–8 author on top of it (flow vocab, Scene Editor template,
Symbols SM, Win Text). Production is blocked on the partner's Hold and Win wire format; authoring is
not (mock-first).

## How sessions use this file (the hub)

This work spans many sessions. **This file is the shared memory. It is committed, so every session
and every teammate sees it.** The coordinating ("hub") session is the Claude Code desktop session
titled **"Hold and win game pipeline"**.

- **Starting a phase:** read the design doc's §6 build plan and this file. Take the next unclaimed
  phase and put your session title next to it in the Phase board below.
- **Finishing (or stopping):** update the Phase board row and add a dated entry to "Recent changes":
  what landed, the PR, what is left, and any surprise. If you are a Claude session, also send the
  hub session a short message so it can re-plan. Use `SendMessage` to the session titled "Hold and
  win game pipeline", or `list_sessions` to find it.
- **Found something that changes the plan** (a contract change, a blocker, a partner answer)? Add it
  to "Decisions & findings" and tell the hub.
- **The committed file wins over any message.** If they disagree, fix the file.

## Phase board

| # | Phase | State | Owner session | PR |
|---|---|---|---|---|
| 0 | Hub + plan | merged | Hold and win game pipeline | #900 |
| 1 | Kind plumbing + `kindCapabilities()` | merged | Hold and Win Phase 1: register the kind everywhere | #917 |
| 2 | Game Config `holdAndWin` block (full option space, 3 presets) | merged | Hold and Win Phase 2 — Game Config block | #919 |
| 3 | Mock RGS `holdAndWin` protocol + wire contract (swap seam) | merged | Hold and Win Phase 3 — mock RGS + wire | #924 |
| 4 | Engine runtime (RespinBoard, coin labels, events, facade, resume) | merged — build complete (follow-ups in Open items) | Hold and Win Phase 4 — engine runtime | 4a #928 · 4b #931 · 4c #934 · resume #938 · 4d #939 · flights #942 · 4e #943 · 4f #945 |
| 4P | Phase 4 polish (counter timing, respin hitch, cell crop, end board, tally order, random metre, undrawn Win Text, stepped/perspective, flight arc, label tint) | merged — all 10 items (live check owed: an authored arc, see Open items) | Hold and Win Phase 4 — polish | 1–5: #973 · 8+10: #974 · 6–7: #976 · 9: #977 |
| 4P2 | Polish 2 (respin spin profile, banked-jackpot beat, boost beam, feature-entry idle frame) | items 1–3 shipped by #979 (session "Hold and Win Phase 4 — polish", built in parallel); this session: the `/symbols` Boost beam row, a Classic-mock check of #979, and the item 4 finding (Open items) | H&W polish 2 — spin profile, jackpot beat, boost beam | #980 |
| 4M | Game modes: registry, mode stack + queue, per-mode flow graphs, resume | merged | Hold and Win Phase 4M — Game modes | #930, #933 |
| 5 | Flow vocabulary + driven seed | merged, live (`lines@ef2ca06bed2a`) | Hold and Win Phase 5 — flow vocabulary + driven seed | #960 |
| 6 | Scene Editor template + components | merged | Hold and Win Phase 6 — Scene Editor template | #951 |
| 7 | Symbols SM (coin roles/states, value label, kind gating) | merged, live (`lines@bf0e5932ac30`) | Hold and Win Phase 7 — Symbols SM | 7a: #950 · 7b: #955 · 7c: #957 · forward-compat: #961 · label fill: #963 |
| 8 | Win Text (jackpot + respin copy, gating) | merged | Hold and Win Phase 8 — Win Text | part 1: #946 · part 2: #954 |
| 9 | Game Maker presets + docs + playtest, sample games (3 Pots first) | in progress — 9a preset picker + config seed + guides + playbooks merged; 9b symbols seed at scaffold merged + launcher deployed; owed (owner login): create, publish and play the Classic + Collector samples — see **Owner checklist** | H&W Phase 9 — Game Maker presets, 3 samples, docs · 9b: H&W Phase 9b — symbols seed + samples | 9a: #968 · 9b: #969 |
| 10 | Partner wire (facade + mock brought in line) | blocked on partner | — | — |
| 11a | Extra specials: add-respins + upgrade (design §7) | merged — whole pipeline (config → mock → facade → beats → flow → Symbols → Win Text → docs); live-checked on the `pots-extra` test fixture | H&W Phase 11a — add-respins + upgrade specials | #995 |
| 11b | Board expansion — rows unlock (design §7; after 11a) | merged, live (`lines@8fe81dbefddc`); follow-ups (reserve rows at scaffold / in the editor, end-state doc) in a follow-up PR | H&W Phase 11b — board expansion | #1002 |
| 11c | Progressive + operator platform jackpots (design §7) | merged, live (`lines@2342c815d074`) — owed: the live Borut round and the partner's platform-jackpot confirmation (Owner checklist 10–11) | Hold and Win Phase 11c — progressive + platform jackpots | part 1: #991 · part 2: #999 |
| 12a | Signals: free names, engine signals reach components, scoped per instance (design §8) | merged (`97652ca9`; the runtime release passed) — owed: a live check on `hw-3pots-sample` (Open items) | Hold and Win Phase 12a | #1003 |
| 12b | Value bindings: numbers → transform / fill / frame / animation / bone (design §8) | merged — whole pipeline (engine → sources → Scene + Component Editor → guides); owed: the live check (Open items) | Hold and Win Phase 12b value bindings | #1005 |
| 12c | Skinnable feature parts — Pot first (design §8; after 12a + 12b) | in progress — built on #1006: the Pot (art params, nodes inside, `standsFor`, fill on 12b's `fillMaskRect`), the Respin Counter and the Jackpot Tile (their panels inside a coded part), a Jackpot Bar copy, a **component** swap on instances, the Total Win Bar (its part can catch the coins), the Letters Strip (each letter a Letter Tile instance), the Wheel (art params, nodes on its turning face), and the respin cells (each a Cell Tile instance). The done-when passes on the real game locally (all three pots); owed: the live run on `hw-3pots-sample` after merge (Owner checklist 13) | Hold and Win Phase 12c skinnable parts | #1006 |

## Current state

- **The research is recorded in the design doc.** §1 covers the mechanics and the three reference games, §2 what we carry, and §3 the partner protocol.
- **The upstream `apps/price` `superspin` sample is the only existing respin code.** It has sticky prize coins, a reset counter and a collect event. It is the reference for Phase 4, to be rebuilt on engine-game primitives rather than forked.

## What each kind resolves to (Phase 1, pinned by `check:flow-publish-gate` §4)

| Kind | Starter flow (`freshDrivenSeedDoc`) | Flow vocabulary (`templateVocabulary`) | Mock protocol → mock that deals it | `/flow` emitter vocab |
|---|---|---|---|---|
| `lines` | bookOf seed (`DRIVEN_SEED_FALLBACKS`) | bookOf (`VOCABULARY_FALLBACKS`) | `lines` → lines | lines |
| `ways` | ways seed | ways | `ways` → lines mock, ways evaluator | lines |
| `cluster` | cluster seed (since 2026-10-01; a project scaffolded before keeps its stored `bookOf` flow) | cluster | `cluster` | default |
| `scatter` | scatter seed (since 2026-10-01; same caveat) | scatter | `scatter` | default |
| `bookOf` | bookOf seed | bookOf | `book` | lines |
| `holdAndWin` | holdAndWin seed (Phase 5; a project scaffolded before keeps its stored `bookOf` flow) | holdAndWin | `holdAndWin` → **Hold and Win mock** (Phase 3); the lines mock, with a logged warning, only when the contract carries no `holdAndWin` block | lines |
| custom kind / absent | bookOf seed (`UNREGISTERED_TEMPLATE_FALLBACK`) | bookOf | `lines` | default |

Existing kinds resolve exactly as before Phase 1. `holdAndWin` followed `lines` by alias until Phase
5 registered its own vocab + seed.

## Decisions & findings

- 2026-10-02 — **Phase 12c: how a coded part is skinned** (session "Hold and Win Phase 12c
  skinnable parts", #1006). Pinned by `packages/engine-layout/scripts/test-pot-skin.mjs`.
  - **Authored children reach the part, not the scene.** A `bind` container's children are handed
    to its coded component as a `skin` snippet (`<LayoutNodeView>`; the prop is absent when there
    are no children, so every existing part is byte-identical). The PART decides where they draw.
    A part that ignores `skin` draws exactly as before, which is also today's behaviour, since a
    `bind` never rendered its children.
  - **The Pot draws the skin inside its own scaled container**, under its `meter:<id>` anchor.
    The children grow at each size stage and pulse with the pot. The anchor centres on whatever
    is drawn, so flights land on the author's art. Measured in Storybook: the anchor sits at the
    centre of the frog pot's nodes. `PotMeter` still counts itself in as `potMeter:<id>`. Children
    replace the coded bar AND both labels. Art params still draw under them.
  - **Art params, not def nodes.** The Pot's art lives in per-instance `image` params
    (`POT_SKIN_PARAMS`): `backgroundImage`, `fillImage` + `fillDirection`, `frameImage`,
    `stageImage1..3`, `artWidth` / `artHeight`. A label group (`showLevel`, `showActivates`,
    `labelFontFamily`, `labelFill`, `labelScale`) and a motion group (`stageGrowth`, `pulseScale`)
    complete it. The coded part draws them. They are not sprite nodes in the def, so a Pot Meter saved
    before 12c gains them through `mergeBuiltinCodedParams`. A def node would never reach a saved
    copy. Any pot image swaps the whole coded bar. Unset, the pot draws the coded bar exactly. The
    art ships through the existing image-param export.
  - **The fill reveal is 12b's `fillMaskRect`**, anchored at the art's centre. One edge rule
    serves the Pot's fill image and a value binding's `fill`. The editor previews the fill at
    `POT_PREVIEW_FILL_SHARE` (0.6).
  - **A skinnable part is declared in the bound catalog** (`BOUND_COMPONENT_DEFAULTS.PotMeter.skin`:
    its layer params, box params). The editor canvas draws a skinned part's art and children instead
    of its stand-in chip. The Component Editor's bar offers **Edit inside ‹part› ›**, which points
    the canvas, outline and spawns at the part's children (`/components` `insidePartId`).
  - **A game skins its pots through a project copy, not the built-in.** Saving the built-in Pot
    Meter writes the SHARED library. The create type **Pot Meter (Hold and Win)** clones it for the
    project, the way the Free-Spin Counter does. Per-instance art params need no copy.
  - **A component that IS a coded part says so: `ComponentDef.standsFor`** (the Pot Meter's
    `'PotMeter'`). This is the deleted-part trap. Today, an author who deletes the `Pot` part to
    draw the pot entirely with their own nodes leaves no part to count the meter in, so the coded
    pot draws and the flights fly to it.
    - **The fix:** an instance whose def stands for a part its tree no longer binds (`partStandIn`)
      mounts that part with `standIn`. The stand-in draws nothing, counts in as `potMeter:<id>`,
      and registers `meter:<id>` on the instance. The flights land on the centre of the author's
      nodes. The behaviour stays the game's coded part's, so engine-layout never learns pot keys.
    - **Not the 12a scope:** an earlier plan (Open items) keyed this on 12a's meter scope. Any
      meter-scoped decoration placed beside the default pot would then hide it and take its
      flights, and 12a's own live check places exactly that.
    - **Storage:** `componentStorage` keeps `standsFor`. `mergeBuiltinCodedParams` restores it by id
      for a Pot Meter override saved without it. The create-type copy carries it.
    - **What a deleted part loses:** the coded growth and pulse. The author's nodes follow the level
      only through 12b bindings.
  - **The Respin Counter gets a coded part, the Pot's pattern.** The authored counter was the plain
    `holdAndWinPanel` (frame, caption, value). Only the game's coded default pulsed, carried the
    "+N" anchor and showed the modifiers. An instance-level anchor keyed on the def id `respinCounter`
    stood in for the anchor, so a renamed copy lost it, and the coded default kept drawing beside it.
    - **The shape:** `RESPIN_COUNTER_DEF` wraps the panel's three nodes, ids unchanged, in a `Counter`
      part (`RespinCounterPart`) and `standsFor` it.
    - **What the part does:** it draws them as its `skin`, scaled by the pulse on every reset and
      "+N". It registers `respinCounter` and counts in under that name, so the coded default steps
      aside for any copy, whatever its id.
    - **Nothing inside the part:** it draws the coded counter (`RespinCounterArt`, shared with the
      coded default, which renders identically).
    - **Parity:** `pulseScale` defaults to 1 (still), because the authored counter never pulsed. The
      coded counter's own pulse is 1.35.
    - **Old copies:** a counter saved before the part (nodes at the root) gets `standsFor` and
      `pulseScale` back by id. The stand-in registers the anchor and the count, which is today's
      behaviour without the id special case. `<ComponentInstance>`'s `flightAnchor` is gone.
    - **Not on an authored counter:** the active-modifiers line (`PAYER · MULTIPLIER`). It is drawn
      only by the coded look, because no source an authored text could bind carries it.
  - **The Jackpot Tile follows the counter; the Jackpot Bar is a composition.** No coded jackpot
    bar exists in the game. Nothing flies to a tile, and no coded default steps aside for one.
    - **The tile:** its frame, caption and value (ids unchanged) sit inside a `Tile` part
      (`JackpotTilePart`), built with the counter's `panelInPart`. The part pulses them when the
      tile's OWN tier is won (`winPulseScale`, default 1, because tiles never pulsed). A
      `jackpot.<tier>` source pulses on `respinJackpotWin`, a `platformJackpot.<tier>` one on
      `platformJackpotCelebration`; the tier compares by `scopeKey` (case-free, as the operator
      writes `Grand`). It registers nothing, so it stands for no part: a tile saved before the part
      draws as saved, unpulsed. Its 12a tier scope is unchanged.
    - **An unregistered part falls back:** a `bind` container whose component is not registered
      renders its children as a plain container. So a runtime without `JackpotTilePart` or
      `RespinCounterPart` still draws the panel.
    - **The bar:** four tile instances. A game skins it through a **Jackpot Bar (Hold and Win)**
      copy: its own frame around the tiles, each tile restyled on its placement. Each tile can
      also point at the game's **Jackpot Tile (Hold and Win)** copy.
    - **Component swap:** pointing a tile at a copy needed a control that didn't exist. Properties
      now has a **component** select on any instance, in the Scene and Component Editors. It
      switches `componentId`, keeps the placement and params, and drops the version pin. The same
      control swaps a Pot Meter for a game's Pot copy, keeping its `meter`.
  - **The Total Win Bar can catch the coins, but only when asked to.** Every `toTotal` head flew to
    `'total'`, which resolved to the HUD's win meter (`hud-win`). No coded total bar exists, and the
    authored bar never caught anything.
    - **The shape:** `TOTAL_WIN_BAR_DEF`'s frame, caption and value (ids unchanged) sit inside a
      `Bar` part (`TotalWinBarPart`), built with `panelInPart`.
    - **The catch:** with `catchesCoins` on, the part registers the `flights:totalWinBar` anchor
      (`TOTAL_WIN_BAR_ANCHOR`). It is prefixed because every layout node anchors its own id, and a
      node named `totalWinBar` would otherwise take the coins whatever `catchesCoins` says.
      `'total'` then resolves to that anchor first, then to `hud-win`
      (`totalTargetPoint()` in `flights.svelte.ts`). That covers the feature-end volley, a swept
      Grand column, and a flow that flies to the total.
    - **The pulse:** `landPulseScale` pulses the bar on every head that lands in the total. It does
      so whether or not the bar catches, because the figure steps either way.
    - **Parity:** both are off by default, since moving the landing point of every existing game
      would be a visible change.
    - **When the bar is hidden:** its anchor is not shown while the bar is hidden
      (`respinCounterShow`), so the coins fall back to the win meter instead of flying at nothing.
    - **Stand-in:** the bar `standsFor` its part, so a bar drawn without it still catches through a
      stand-in. A bar saved before the part gets both params back by id, off. The stand-in catches
      but never pulses, because the def's own nodes are not inside it, so `landPulseScale` does
      nothing there (the counter's stand-in is the same).
  - **The Letters Strip draws each letter as a Letter Tile instance.** The strip was a pure coded
    part (`LettersStrip`, one coded letter per reel). The coded row stepped aside only for an
    instance whose id was `lettersStrip`, so a renamed copy drew beside it.
    - **Why an instance per letter, not nodes inside the strip:** a template inside the strip's part,
      drawn per letter, would be one component instance. Cues are wired per instance and keyed by
      node id, so a **Letter lit** cue would play on every letter. The Jackpot Bar already holds
      separate tile instances, and 12a's `reel` scope needs the same.
    - **The tile:** `LETTER_TILE_DEF` (`letterTile`) puts its dim and lit art (`tileImage`,
      `litTileImage`) and its dim and lit letter inside a `Letter` part (`LetterTilePart`). Each
      node shows in one state through a 12b `visible` binding on `letter.{reel}.lit`. The letters
      copy the coded letter's font, colours, stroke and alpha. The tile is scoped by `reel`, and the
      part pulses it when its letter lights (`pulseScale`, 1.6 like the coded letter). With nothing
      inside, it draws the coded letter, which pulses on its own (`pulseScale` does not apply). It
      registers nothing, so it stands for no part.
    - **The strip:** a new `tile` param, kind `component`, names the component each letter draws
      as, fed `reel` and `letter`. Blank (the default) draws the coded letters (parity). So does a
      tile `<ComponentInstance>` would refuse: not registered, nested past `MAX_COMPONENT_DEPTH`
      (a strip placed inside another component), or a cycle (a tile naming the strip). The strip is
      therefore never empty while the coded row steps aside. The part counts in under
      `LETTERS_STRIP_MOUNT`, so the coded row steps aside for any copy, whatever its id. The def
      `standsFor` its part.
    - **The tile ships.** A tile a param names is in no node, so the bake would miss it, and the
      strip would fall back to the coded letters in the published game. `resolveComponentClosure`
      (`collectComponentIds.ts`) is now the one walk the doc bake, the runtime bundle and the art
      export share. It also follows `component`-kind params: the def default, every placed
      instance's value and per-ratio override, and the project's defaults (read only for a def with
      such a param). The tile's art then ships through its own image-param defaults.
    - **New pieces:**
      - The `component` param kind. Properties and **This game's defaults** list the project's
        components that declare every `fedParams` key (the tile's `reel` and `letter`), minus the
        instance's own.
      - The game's `letter.<reel>.lit` VALUE source (1 or 0). It sits beside the visibility source
        of the same name, because a 12b binding reads values.
    - **Limits:**
      - A component placed inside a Letter Tile is skipped, since the tile is already a
        second-level instance. The Jackpot Bar has the same limit.
      - A tile's nodes render without the screen's `space`, because a bound part is not handed it.
        So `screenAnchor` / cover fit on a node inside a tile does nothing.
  - **The Wheel follows the Pot: art params, and nodes inside its part.** The wheel was a pure coded
    part (`HoldAndWinWheelPart` → `HoldAndWinWheelArt`). The coded wheel stepped aside only for an
    instance whose id was `wheel`.
    - **Art params** (`WHEEL_SKIN_PARAMS`, `wheelSkin.ts`):
      - `faceImage` turns with the spin and replaces the coded segments, rim stroke and hub.
      - `rimImage` stays put over the face.
      - Both draw at `artSize`, else the wheel's diameter, so the labels and the landed outline
        stay aligned.
      - `pointerImage` stays put at its own size, its bottom edge at the coded pointer's tip.
    - **Nodes inside the `Wheel` part** turn with the face, in place of the coded segments: over the
      face art, under the rim, which frames everything.
    - **Labels and outline stay coded:** the prize labels and the landed outline come from the Game
      Config and the server's segment, which no authored node can know. So `showLabels` /
      `showLanded` switch them, with a label font, colour and size. Unlike the Pot's labels, nodes
      inside do not hide them. The labels draw through `CatalogText`, so a Font Maker font picked
      for them renders, a bitmap one included.
    - **Fixed decoration** (lights, a stand) goes beside the part in the component root. It shows
      with the wheel screen, which a Flow holds around the beat. A cue on **Wheel — spin** /
      **Wheel — land** can drive it.
    - **Paint order:** every layer has an always-mounted slot, the Pot's fix.
    - **Parity:** unset, the drawing is the coded wheel's.
    - **Step-aside:** the part counts in under `WHEEL_MOUNT`, so the coded wheel steps aside for a
      copy of any id. The def `standsFor` the part, and a stand-in draws nothing and counts in.
    - **Editor:**
      - **Layers:** the canvas previews the face, then the nodes inside, then the rim (an `overNodes`
        layer), as the game draws them.
      - **Size:** `PartSkinBinding.radiusParam` sizes the face and rim at twice `radius` when
        `artSize` is blank, the box the game uses.
      - **Not previewed:** the pointer sits off centre at the rim, so only the game draws it. With
        only a rim picked, the canvas shows just the rim, while the game still draws the coded
        segments under it.
  - **The respin cell tiles follow the Letters Strip: each cell draws on a Cell Tile instance.**
    The Respin Cell Tiles (`respinCells`) already took art params (`tileImage`, `tileTint`, `gap`),
    which the board stamps under every cell.
    - **The tile:** `CELL_TILE_DEF` (`cellTile`) puts a tile node (`tileImage`, `tileTint`) and a
      held overlay (`heldImage`) inside a `Cell` part (`CellTilePart`).
      - **Held:** the overlay shows through a 12b `visible` binding on the `held` param. The board
        feeds `held` per cell (1 while a coin holds it) through `<ComponentInstance engineValues>`,
        so no value source has to exist for every cell.
      - **Pulse:** the part pulses the tile when a coin lands on its own cell (`landPulseScale`,
        default 1, still like the coded tiles).
      - **Box:** it is authored on one cell's box (120 square, centred), and the board scales it to
        each cell's window, shrunk by the gap.
      - It registers nothing, so it stands for no part.
    - **The tiles' new `tile` param** (kind `component`, fed `reel`, `row` and `held`) names the
      component each cell draws on, instead of stamping `tileImage`.
      - **Mounting:** `RespinCellTile` mounts it per open cell, on the same seat and box math as the
        coded sprite.
      - **Fallback:** blank (the default), a component that is not registered, or one naming the
        tiles themselves keeps `tileImage` (parity). The gap still insets the rolling windows.
      - **Nesting:** a Respin Cell Tiles mounted inside a cell's tile, at any depth, publishes no
        look (`insideRespinCellTile`). Its look would replace the one that mounted it, unmounting
        the very tiles it sits in, so every tile vanished. The per-cell instances mount outside
        the placed one, so the component nest guard cannot see that loop.
      - **Box:** the board divides by `CELL_TILE_SIZE`, the constant the def is authored on.
    - **Not scoped:** the coin signals stay unscoped. The "Coins land" event lists several cells, so
      firing it per cell would replay an unscoped listener's cue once per cell. A cue on **Coins
      land** inside a Cell Tile therefore plays on every tile; per-cell state is `held`.
    - **Shipping:** the tile ships through `resolveComponentClosure` (the `component` param), like
      the Letter Tile.

- 2026-10-02 — **Owner: the pots as an overlay on any kind** (session "3 pots overlay mechanic").
  Its own plan and hub: [design/pots-overlay](../design/pots-overlay.md),
  [status/pots-overlay](pots-overlay.md). It reuses this kind's pots, flights, respin feature and game
  modes. Its Phases 2–4 touch the Hold and Win mock (the feature generator becomes reusable), the facade
  (per-bonus routing, only under a captured `potsOverlay` block) and the runtime. This file's parity
  digests are their gate.
- 2026-10-02 — **Phase 12b contract (value bindings)** (session "Hold and Win Phase 12b value
  bindings"). Pinned by `packages/engine-layout/scripts/test-value-bindings.mjs`.
  - **Schema:** `BaseNode.valueBindings: ValueBinding[]`, a field of its own beside `paramBindings`
    (which stays `field → param key` — several walkers read it as strings, so none changes).
  - **Input:** `param` (a component param; wins) or `source` (an engine value source). `{key}` in a
    source reads the owning instance's param — `meter.{meter}.level` on the red pot is
    `meter.red.level` — and an unresolved placeholder leaves the binding inert. `of` divides first
    (a param by that key, else a source); a zero or missing divisor reads 0.
  - **Mapping:** `inMin..inMax` (default 0..1) → `outMin..outMax` (a default per target), clamped
    unless `clamp: false`, along `ease` (linear, easeIn/Out/InOut, backOut, steps); `smooth` seconds
    glides to each new output (the first value snaps). A node draws as authored until its source
    reports, and where the source is not registered.
  - **Targets:** the transform ones are RELATIVE to the authored node, so a per-ratio override still
    places it — `x`/`y` add px, `rotation` adds degrees clockwise, `scale`/`scaleX`/`scaleY` and
    `alpha` multiply — folded once onto the resolved transform in `<LayoutNodeView>`. `visible`:
    shown while the value is ≥ `threshold` (default 1; `below` inverts); hidden means unmounted,
    like every layout visibility, so a spine shown again restarts and a component fires `enter`.
    `fill`: a mask revealing a sprite / flipbook / rect from one edge (not on a cover node; a
    mirrored clip's mask mirrors with it). `frame`: holds a flipbook frame, counted on the clip as
    authored (a frame-bound clip walks forward). `animTime` and `bone` pose through
    `pixi-svelte`'s `<SpinePose>` on the spine's world-transform hooks, after the animation state:
    each scrub applies its animation at the held share of its length (`Animation.apply`, its
    events dropped, so it fires none), then each bone offset is added / multiplied on top and undone
    after the world transform, last first, so an unkeyed channel never compounds
    (`pixi-svelte/spineBoneOffset`, shared with the editor preview).
  - **New sources** (`Game.svelte`): `meter.<id>.stage` and `meter.<id>.full` (1/0; also a visibility
    source), `respinsStart` (the counter's current cap), `cellsHeld` / `cellsTotal`, and `rowsOpen` /
    `rowsMax` on an expanding board. The editor's picker reads `VALUE_BINDING_SOURCE_CATALOG`
    (`needsParam` gates the pot entries to a component with a `meter` param; `of` pre-fills the
    divisor).
  - **Ship chain:** a binding is a node field, so it travels the existing def / doc bake. There is no
    new R2 asset class, and bones and animations already ship in the spine bundle. Node fields pass
    `normalizeNode` / `normalizeComponent` untouched.
  - **With 12a** (#1003, landed first): both phases use the one `meterStage(meter, level)` rule —
    12a's stage-up cue and 12b's `meter.<id>.stage` source count stages the same way the coded pot
    grows. A scoped component (12a) can carry value bindings (12b): its `{meter}` placeholder and its
    signal scope read the same `meter` param.
- 2026-10-02 — **Phase 12a: how a signal is scoped** (session "Hold and Win Phase 12a"). One rule
  serves component cues, reveal gates, FX layers and Flow cues: `scopeKey` / `eventScope` /
  `scopeMatches` in `utils-event-emitter`.
  - **The fire.** A scoped beat carries a TYPED `scope` on its emitter event — `meter:red`,
    `tier:grand`, `reel:2`, the shape of the `meter:<id>` flight anchor — as a string or a list.
  - **The listener.** A component def names the param its scope comes from and the kind of part
    it names (`ComponentDef.signalScope` + `signalScopeKind`): the Pot Meter `meter` as a meter,
    the Jackpot Tile `source` as a tier. A source key scopes by its id (`jackpot.grand` ⇒ `grand`,
    `meter.red.level` ⇒ `red`).
  - **Matching.** A listener filters only fires of its own kind, so the red pot skips the blue
    pot's fill but still hears a GRAND jackpot win. A bare key (a Flow scope pin as typed, an
    FX filter) matches by key alone, and `*` hears every part. Keys compare lower-cased, because
    the operator platform names its tiers `Grand`.
  - **Inheritance.** A nested instance with no scope of its own inherits its parent's, and so does
    an effect node inside it.
  - **Who hears what.** An unscoped listener hears every fire, and an unscoped fire reaches every
    listener, so nothing authored before 12a changes.
  - **Per kind.** The Hold and Win signal family is registered only in a game whose config has a
    `holdAndWin` block, and the Flow cue harvest excludes it only for a Hold and Win kind. A
    registered name always beats the open bus, so registering `featureEnter` or `coinLand` in a
    lines game would take the name from an author's own Flow cue.
  - **Flow.** The Fire Cue's scope pin is generic (every cue has it), not a per-cue payload field.
    The flow spike's cue ↔ emitter field comparison therefore skips `scope`.
  - **Signal names.** The respin and coin signals use new names (`respinReset`, `respinLast`,
    `coinLand`, `coinCollect`, `coinBoost`, `coinUpgrade`, `featureEnter`, `featureExit`) rather
    than the emitter cue names, because a cue like `respinCounterUpdate` means two moments (reset,
    last). `wheelSpin` / `wheelLand` keep the cue names, as `specialBookReveal` does.
- 2026-10-02 — **Phase 11b contract (board expansion)** (session "H&W Phase 11b — board expansion").
  - **Config:** `holdAndWin.expansion {startRows, maxRows, rule, thresholds?, unlockReels?,
    resetsRespins, rowJackpots?}`, rule `fullRow` | `unlockSymbol` | `coinCount`. `startRows` must
    equal the grid's rows (the base game plays them); rows unlock BELOW the base grid, so a held
    cell's row index never changes. Only the chosen rule's own field is stored. `resetsRespins`
    defaults on. A row jackpot pays once when that many rows are open (banked).
  - **Refused combinations:** column letters + expansion (a letter needs a fixed column height);
    `fullRow` under `collectorsOnly` (a row can never fill). `coinCount` needs one ascending
    threshold per unlockable row, each reachable on the rows open before it. An `unlock` symbol
    cannot be a buy guarantee.
  - **Events:** `rowsUnlocked {from, rows, cause, unlockers}` (unlockers = the unlock symbols, then a
    `cellsCleared {reason: 'applied'}` — the same reason 11a's non-sticky add-respins uses); the
    counter reset is the respin's own `respinUpdate`; a row jackpot is `jackpotWin {source: 'row',
    banked: true}`. The entry payload gains `expansion {rows, maxRows}` and the snapshot `rows`, both
    absent on a board that never grows (parity). A full board = every cell of `maxRows`.
  - **Fixtures:** `HOLD_AND_WIN_TEST_FIXTURES['pots-expansion-fullrow' | 'pots-expansion-unlock' |
    'pots-expansion-count']`; no preset gains the option.
- 2026-10-02 — **Owner: Phase 12, authorable feature parts.** The Pot Meter is a hard-coded shape: no bitmap art, no per-pot signals into components (catalog-only cue names; the engine's pot broadcasts never reach spine cues; FX can't filter per pot), and numbers drive only text (no bone, fill, frame or animation binding). Plan, design §8: 12a scoped signals ∥ 12b value bindings → 12c skinnable parts, Pot first. Generic across kinds.
- 2026-10-02 — **Phase 11a: the rules add-respins and upgrade settled** (session "H&W Phase 11a —
  add-respins + upgrade specials"). Each is one fact the mock, the facade, `applyHoldAndWinEvent`
  and the beats share, pinned by `check:holdandwin`:
  - **The counter after a respin is `reset ? max(start, left) : left − 1`.** A reset never throws
    added respins away; without add-respins `left ≤ start` always, so every existing game counts
    exactly as before. `start` is now the feature's CURRENT cap: it starts at `respins.start`, an
    add-respins with `raisesCap` raises it, and `respinUpdate.start` and the snapshot carry it (a
    resume restores a raised cap). `respins.cap` (the most respins one feature plays) is a different
    limit and is never raised — so a "+N" that lands on the respin that ENDS the feature still flies
    to the counter, which then reads 0. Accepted, not a bug.
  - **Add-respins applies at its turn in `applyOrder`:** `respinsAdded {cell, added, left, total}`
    (`left` after adding, `total` = the cap after), then — when not sticky — its own
    `cellsCleared {reason: 'applied'}` (the reason 11b's unlock symbols share). A sticky one stays,
    worth 0, holding its cell.
  - **Upgrade draws its rule per landing** from a weighted `targets` table: `all` (every held CASH
    coin + step), `adjacent` (the cash coins in the 8 cells around it + step) or `jackpotTier` (the
    lowest-tier jackpot coin below the top of the ladder — ties: lowest reel, then row — one tier up,
    its factor kept; none eligible ⇒ an empty `cells`). A step never touches a jackpot coin. The
    ladder is the config's tiers sorted by multiplier (`jackpotLadder`). The upgrade stays on the
    board after, worth 0, like a payer.
  - **`coinUpgrade.cells` are a union** — `{kind: 'value', from, to}` (× total bet) or
    `{kind: 'jackpot', from, to}` (tier names). The flow vocabulary has no union type, so its
    `HoldAndWinUpgradeChange.from/to` pins are typed string; a cash change carries numbers there.
  - **The test fixture is `HOLD_AND_WIN_TEST_FIXTURES['pots-extra']`** (3 Pots + `ADD` add-respins
    1/2 non-sticky, `UPG` upgrade all/adjacent/jackpotTier with steps 0.5/1/2; both active at entry,
    after the payer and before the multiplier — so a multiplier multiplies upgraded values; the
    mystery reveals both). No preset gains either special; the mock CLI takes `PRESET=pots-extra`.
  - **Parity is pinned, not just claimed:** `check:holdandwin` hashes 400 seeded rounds per preset
    plus every forced beat and compares against digests taken from `main`'s mock, so a stray `rand()`
    on an existing path fails the gate (a planted one did).

- 2026-10-02 — **Phase 11c: a progressive pool is a multiple of the total bet, per player** (session
  "Hold and Win Phase 11c — progressive + platform jackpots"). A pool is in × total bet like a fixed
  tier's `multiplier`, so the bar follows the bet selector without a server round trip. Each bet adds
  `contribution` × bet units, whatever its stake, and the server sends the multiplier (`value`), not
  money. Wins pay `value × the round's stake`. The real partner progressive is owed as a Phase 10
  question: per-player or shared, multiplier or money (wire doc "Open questions").

- 2026-10-02 — **Owner: start Phase 11 now** (Phase 10 waits on the partner). Split into 11a extra specials (add-respins, upgrade), 11b board expansion (after 11a) and 11c progressive + operator platform jackpots (parallel with 11a); each slice ships through the whole pipeline, unconfigured games byte-identical. Plan: design §7.
- 2026-10-01 — **Phase 4 polish: three decisions** (session "Hold and Win Phase 4 — polish").
  - **Stepped grids are REFUSED for Hold and Win** (item 8). `validateHoldAndWin` errors at
    `holdAndWin.grid` when the reels' row counts differ, so `/config` will not save one and Publish
    flags it. The respin board is one one-cell reel per row of a rectangle, and no reference game is
    stepped. Supporting it later means per-reel row counts in `respinSpins` / `respinSeedBoard` /
    `createRespinBoard` (the end board already uses `rowsForReel`). **Perspective boards are
    supported as the reel board is:** a resting cell sits exactly on its perspective seat, and a
    rolling strip moves at the flat row pitch — the same rule `ReelSymbol` uses — so nothing to
    refuse.
  - **Coin label colour stays a MULTIPLY; no new tint mode** (item 10). A neutral font already
    ships: the builtin **`silver`** (near-white, with its shading), offered in `/symbols` beside
    `gold`. Over it an authored cyan reads cyan. A "replace" tint would need a colour filter per label
    (one per held coin) to keep the shading, which is not worth it when the neutral font exists. The
    `/symbols` hint now names `silver`; a white Font Maker font still works.
  - **Flight arc (item 9) — the field:** `flights.<kind>.path.arc`, a signed curvature as a fraction
    of the straight distance (−1…1). Positive bows the route UP on screen, negative bows it down;
    absent or 0 keeps today's straight-first routes. It shapes the PREFERRED route only: avoidance
    still detours around win cells (`bend`, "Max detour") when the arc would cross one. Owner of
    the Phase 7 `flights` block: this is additive (an older launcher drops the unknown field, #961).

- 2026-10-01 — **Phase 7 (Symbols SM): things a later phase must know.**
  - **The holdAndWin symbol defaults are TOOL-SIDE only.** `symbolDefaults/holdAndWin.json` feeds the
    `/symbols`, `/editor` and `/win-text` previews; no publish, bake or runtime path reads it. The game's
    symbol map is the coded lines `SYMBOL_INFO_MAP` with the project's symbols doc merged over it, so a
    `holdAndWin` project draws NO art for its coins/specials (and boots with `[game-config] … no entry in
    the symbol map`) until its symbols doc binds them. **Phase 9 must seed the doc at scaffold** (done, 9b): copy the
    Hold and Win symbols' cells from `holdAndWin.json` into `<client>/<project>/symbols/symbols.json`
    (type / assetKey / animationName only; they bind coded game assets, which the exporter leaves alone
    and the game registers itself). `hw-3pots-sample` was seeded that way on 2026-10-01 (BONUS = scatter
    art, JACKPOT = wild, BOOST/COLLECT/MULTI = the M multiplier spine, MYSTERY = exploded wild —
    placeholders). A `blank`-tagged symbol is no longer reported missing (#963): it draws nothing by
    design.
  - **The new states and what plays them** (fallback when unbound in brackets): a respin cell stopping →
    `coinLand` (static); a held coin at rest → `coinIdle` (static); a coin sticking, a special becoming a
    coin, a mystery landing as what it became → `coinStick` (land); payer / multiplier booster →
    `coinBoost` (win); the per-coin collect step, Grand's column-letter coins, an instant collect →
    `coinCollect` (win); a coin jackpot, a full board, a jackpot factor step → `jackpotReveal` (win); a
    mystery opening → `mysteryReveal` (explosion, one-shot); a base-board special flying to its pot →
    `flyToMeter` (win). Streak / column clears stay `clearReel`; the wheel plays no symbol state. The win
    frame draws on every `WIN_HIGHLIGHT_SYMBOL_STATES` state.
  - **Coin label colour is a MULTIPLY over the font.** Over the gold builtin an authored cyan reads
    green and pink reads orange; an exact colour needs a white Font Maker font (the `/symbols` hint says
    so). `countMs` drives the payer/boost count; the collect step scales with it (350/600).
  - **A flight's "bend" is the largest DETOUR around win cells, not a curve.** With avoidance off or
    nothing to avoid (the feature-end volley) every route flies straight — measured live: an authored
    0.5 left the volley < 1 px off the chord. The field is now labelled "Max detour". A real "arc" knob
    (a preferred curve even with nothing in the way) would be a `planFlight` change — not built.
  - **Flight heads are additive glows**, so the authored tint shows as the halo around a white core;
    a strongly coloured head needs a sprite/spine/flipbook head. No `/fx` trail was authored on the
    sample (it has no effects), so an authored trail is proven only by the fixtures and the `/symbols`
    preview (`FxStage` `ownerPos`), not live.
  - **pixi-svelte `<BitmapText>` trap (any caller):** pixi's `BitmapText` defaults `fill` to white
    only in its constructor. A `style` re-assigned without `fill` (every re-render of an inline
    `style={{…}}`) draws a fill-as-tint bitmap font BLACK. That blackened every held coin label on the
    respin board (coded and authored alike) until #963 passed `fill: 0xffffff`. Other `BitmapText`
    callers that re-render a fill-less style are exposed the same way.
  - **Forward compatibility of the symbols doc (#961):** the new blocks strip unknown fields and the
    state-keyed maps drop a state the launcher does not know, so a rolled-back or older launcher loses
    that one key instead of reading the whole doc as never authored. Unknown head kinds / eases / cash
    formats and wrong types still 400. Launchers older than #961 still reject a doc holding a Phase 7a
    state key whole — do not roll the launcher back past #950 once a project binds one.
  - **Players boot the PUBLISHED snapshot.** `hw-3pots-sample`'s authored coin label, flights and
    seeded symbols show with `authoring=1` / `ie_authoring=1`; a plain player URL shows them only after a
    Re-publish from Game Maker (owner).
  - **Parallel playtests: never share a mock port.** A seeded local book mock on the default 7788 was
    hit by another session's game mid-run, which consumed its seeded RNG and diverged the outcomes. Give
    every run its own port.
- 2026-10-01 — **A new `holdAndWin` project is scaffolded WITH its Game Config; other kinds are not**
  (#956). The scaffold seed was chosen over a publish/mock fallback to the kind default: a fallback
  would make the mock deal Pots while `/config` and the runtime bundle still had no config (the bundle
  bakes only an AUTHORED config, so the client would boot the compiled lines template against a Hold
  and Win server). Seeding is limited to kinds whose defaults are presets (`gameConfigSeedFor`, keyed
  on the same `KIND_DEFAULT_KEY` map as `gameConfigDefaultFor`), so lines/ways/scatter/cluster/bookOf
  stay un-authored and play byte-identically. Older projects: Publish flags a missing block
  (`holdAndWinConfigMissing`, card note "dealt plain lines"); `/admin` Re-scaffold backfills it.
- 2026-10-01 — **Wire: a second mode in one round is announced with `modeEnter` / `modeExit`**
  (#956, [hold-and-win-wire.md](../reference/hold-and-win-wire.md) "Modes"). `modeEnter {mode,
  cause, policy?, payload?}` (`policy` `nest` default | `queue`, the engine's `ModePolicy`) and
  `modeExit {mode, total?}` with `total` in CREDITS. The Hold and Win feature itself keeps
  `holdAndWinTrigger`/`End` (never doubled as `modeEnter`/`Exit`); the wheel is part of its entry. No
  preset produces a second mode, so the mock sends the pair only on the forced `queuedMode[:<id>]`
  beat: `modeEnter {mode: "queuedFixture", cause: "forced", policy: "queue"}` right after
  `holdAndWinTrigger`, `modeExit {mode, total: 0}` right after `holdAndWinEnd`, before `gameEnd`. The
  facade drops both today (its `default` branch); the "Hold and Win engine runtime" session maps them.
- 2026-10-01 — **Mock quirk fixed** (#956): the respin that ends the feature (full board, last
  letter, cap) now sends `respinUpdate {left: 0, reset: false}`, matching its closing snapshot.
  `check:holdandwin` re-derives it on every round and plants the old shape to prove it is caught.

- 2026-10-01 — **Phase 8 (Win Text): what the presentation must call.** The copy lives in
  `bakedWinText()` (`resolveWinText`); render with `formatWinText(template, vars)` and NEVER build the
  string first. Map of today's literals → templates (for these the defaults are byte-equal, so the swap is
  invisible; the six fields under "Authored but not drawn yet" are NEW copy):
  - `<tier> JACKPOT` → `jackpots.award` with `{ jackpot: jackpotCaption(r, tier) }`; its detail
    `amount` → `jackpots.awardDetail`, `FULL BOARD  ${amount}` → `jackpots.fullBoardDetail`; the coin
    banner title `tier` → `jackpots.coin`.
  - `RESPINS ${left}` (RespinCounter) → `respins.counter` `{ count }`; the modifiers line under it →
    `specialDisplayName` per kind (it uppercases ids today — same output for the four known kinds).
  - `LUCKY SPIN` → `feature.luckySpin`; 4f's `INSTANT WIN` → `feature.instantCollect`.
  - `<names> ACTIVE` → `feature.modifiersActive`, `UNLOCKED: <names>` →
    `feature.modifiersUnlocked`, with `{ modifiers: kinds.map((k) => specialDisplayName(r, k)).join(', ') }`
    (replaces `SPECIAL_NAMES` in `holdAndWinPresentation.ts`).
  - ~~Authored but not drawn yet~~ `respins.award` / `reset` / `last`, `feature.total` / `intro` /
    `outro` / `meterFull` — drawn since Phase 4 polish part 2 (see Recent changes).
  - 4f's wheel / collector-level / pot labels have NO template yet (full list: "Win Text literals
    for Phase 8") — part 2 adds fields for them. Coin labels belong to Phase 7 (`bakedCoinLabel`).
  - **Jackpot tiers are the config's** (`holdAndWin.jackpots[].name`); the page lists one caption box
    per tier, and Localization lists each tier's caption (defaulting to the name) for a Hold and Win
    project only.
- 2026-10-01 — **Phase 5 ↔ Phase 6: what the Hold and Win starter flow shows** (hub decisions).
  - **Containers:** at start the seed shows `jackpotBar` + `pots` beside the base game and HUD; the
    `holdAndWin` Mode trigger (enter) shows `respinBackground`, `respinBoard`, `respinCounter`,
    `totalWinBar`, `letters`, and (exit) hides them — exit fires after `holdAndWinEnd` has presented,
    so the tally still lands in `totalWinBar`. Wired after #951 merged; the publish gate validates
    the seed against the template's scenes.
  - **Step-aside, not an API:** a coded part steps aside while an AUTHORED screen for it is mounted
    (in `activeScreenIds`), the rule the counter and pots already follow. Phase 6 adds it for
    `HoldAndWinBanner` (`luckySpin`, `jackpotWin`) and for the coded wheel (`wheel`). Until then the
    seed shows none of the three, so nothing draws twice; adding them is a small follow-up (Phase 9 if
    Phase 5 has merged). **Superseded the same day:** #951 shipped the step-asides, so the seed now
    shows `luckySpin`, `wheel` and `jackpotWin` for the length of their beat.
  - **No `featureIntro` / `featureOutro` in the zero-authoring default** — the coded feature has no
    tap at its start or end (parity). Authors wire them; Phase 9's sample games add them where the
    references have popups.
  - **Names and units:** the HUD source `featureTotal` is the Total Win bar (the win meter, counting
    up); the flow value is `featureWorth` (`stateHoldAndWin.total`, the server's worth of the open
    feature — final from the trigger's chain on, what a branch should test). `jackpot.<tier>` is the
    prize in CURRENCY at the current bet as a HUD source, and in book-event units (like `win`) as a
    flow value.

- 2026-10-01 — **Step 10: Grand + Hotfire.** Things a later phase must know:
  - **A swept column reaches the Total Win bar DURING the feature.** `presentColumnComplete` counts
    the column's `amount` into the bar as its coins land (shares by worth, `cellWorth` + `countSteps`,
    the last landing exact) and remembers it (`featureCountedIntoBar`); the end's tally takes it off
    `banked` and `total`, so the bar still ends on start + total once. A flow that owns
    `columnComplete` without the `lightLetter` effect leaves it at 0 and the end adds the whole
    banked part, as before.
  - **The letters row and the collector level are display copies**, like the held layer: the play
    seam has recorded a lit column and a raised collector before their beat. Letters copy
    `lettersLit` at the trigger and every snapshot and light on their own beat; the wheel pins the
    old collector level (`stateHoldAndWinShown`) until it has landed, or the counter would read
    "DOUBLE COLLECTOR" before the wheel spun (seen in the first Storybook run).
  - **Instant collect flies to the SPECIAL, not to the bar.** The bar belongs to the round's own
    `setWin` / `setTotalWin`, which follow and count the instant amount with the line wins; flying
    into the bar would count it twice. Each coin goes to its nearest special; the banner shows the
    multiplier and `times` when above 1.
  - **The wheel follows the free-spin intro's slam rule but is not unskippable:** re-armed before it
    (`startsCelebration`), a press while it turns lands it at once on the very rotation the spin was
    easing onto, and the landed segment and the prize banner each hold at least 700 ms on a bare
    timer. Its segments are the config's prizes when the config's prize at `segment` matches the
    server's; otherwise a one-segment wheel of the server's prize (it never lands on something not
    awarded). A jackpot prize gets no banner: the `jackpotWin {source: 'wheel'}` that follows
    celebrates.
  - **Contract fix: the wheel's prize position is `segment`, not `index`.** A book event's `index` is
    its ordinal in the book, and the facade builds every event as `{index: ordinal, ...fields}`, so a
    payload field named `index` overwrote it (4a's contract named it so). Renamed in the contract,
    the facade, the presentation and the recorded books, and in the `wheelSpin` / `wheelLand` cues
    (which carry the segment DRAWN). The facade fixture checks every event keeps its ordinal.
  - **New flight kind `toCollector`** (streak collect and instant collect); Phase 7's `flights` block
    should author it beside `toTotal` / `toMeter:<id>`.
  - **Value sources:** `collectorLevel`, `lettersLit` (value) and `letter.<reel>.lit` (visibility),
    the last two only for a `columnLetters` config.

- 2026-10-01 — **Steps 6–8: pots, Lucky Spin, full board + feature end.** Things a later phase must
  know:
  - **Boot meter levels travel through a facade global** (`__IE_HOLD_AND_WIN_METERS__`, written at
    `config` capture only for a wire-1 Hold and Win server that declares meters) and are seeded once
    as a `meterLevels` through the reducer, so `stateHoldAndWin` keeps one writer. Seeding stands
    down once any book event recorded meters (a resume's `meterLevels` wins).
  - **The reducer now empties the meters a `meter` trigger names** (`payload.meters`, "now 0" on the
    wire): the server's word, applied at the trigger instead of waiting for the play's
    `meterLevels`, so the pots read empty while the feature runs.
  - **A pot's drawn level is a display override**, like a coin label's: the play seam has recorded
    the server's level before the beat starts, so `meterUpdate` pins the pot at `level − from.length`
    and ticks it per `flightArrive`, then lets go on the server's level. A forced full meter
    (`forced: true`, the level set one short first) therefore jumps to `max − n` before ticking.
  - **`'meter:<id>'` is the pot's anchor, `'toMeter:<id>'` its flight kind**; Phase 6's authored pots
    must anchor the same names (a pot node with that id does it through `LayoutNodeView`), and bind
    `meter.<id>.level` / `meter.<id>.max`. Without an anchor the flight lands on the board's bottom
    centre and the level still ticks.
  - **The meter beat lights each special on the BASE board** (`win`, padded row = visible row + 1)
    while it flies; flight seats themselves take the visible row (`getSymbolSeat`'s lattice row).
    No avoidance: `meterUpdate` comes right after the reveal, before any win is shown.
  - **Lucky Spin = an explicit one-shot, not faked scatters.** The intro beat arms it; every
    `presentReveal` takes it; the dispatch seam reads it to run that reveal unskippable. The reels
    hold on every reel after the first at level 1 (the lowest big tier's alias); the anticipation
    OVERLAYS (spine stack, grey-out, camera) still need the project's `anticipationMode`, so a project
    without it sees long holds only. In the sample config each armed reel holds ~2 s, so a Lucky Spin
    reveal takes ~8 s — tune `reelPaddingMultiplierAnticipated` if that reads long.
  - **Celebrations without a screen.** `holdAndWinEnd` and a banked `jackpotWin` re-arm the slam
    (`startsCelebration`) and run inside the unskippable window, which is what locks the button for a
    coded celebration that mounts no `bigWin`/intro/outro screen. When Phase 6 authors them as
    screens, the screen lock takes over and the unskippable window stays harmless (no tap holds).
  - **The Total Win bar count-up starts from what the bar read** (the trigger spin's line wins, if
    any): it lands the coins' share exactly on `start + total − banked`, adds the banked part after a
    350 ms beat, and ends on `start + total` — the same figure `setTotalWin` then assigns, so nothing
    jumps. Coins land in flight order, not list order, so each arrival adds ITS amount
    (`tallyCountUp`, fixture-pinned for out-of-order arrivals and rounded per-coin amounts).
  - **The coded banner** (Lucky Spin, jackpots) is one at a time, English literals until Phase 8,
    centred on the board in the flights band above the flight layer.
  - **Storybook does mount the board** — the reference flow parks on its loading screen; completing
    it (`completeActiveScreen()` from `/src/game/flowInterpreterHolder.ts`) shows the reels, so the
    4c/4d "no board in Storybook" note was the loading screen, not a missing mount.

- 2026-10-01 — **Flights are built (step 9).** Things a later phase must know:
  - **A trail needs a STILL emitter parent plus `ownerPos`.** Moving the container (what every other
    mount does) carries the particles rigidly. Any `/fx` flight preview or authored trail must go
    through `<ParticleEmitter ownerPos>` / `<EffectPlayer ownerPos>` (free layers only).
  - **There was no "scene node registry".** A layout node's on-screen position is now resolved through
    `pixi-svelte` named anchors registered by the node mounts (id = the node id). Ids are per scene, so
    two mounted scenes with the same id resolve to the most recently mounted one that is visible.
  - **`'total'` = the `hud-win` anchor** (the reference win meter id, also registered by every win
    readout whatever its id). A game whose win meter is something else names its node id instead.
  - **The flight layer sits ABOVE the HUD** (8500) so a head lands on the meter; it would also draw
    over an un-pinned celebration overlay in the list band. Celebrations follow the volley today, so
    nothing overlaps; revisit if a beat flies during a celebration.
  - **The feature-end volley uses no avoidance**: every coin leaves at once, so there is nothing to
    bend around. The specials beats (pots, collectors) pass the win cells as `avoid`.
  - **Not built**: Phase 7's `flights` authoring block (head art, `/fx` trail, arrival effect, path
    style per kind), beams, a re-aimed target that moves mid-flight (the route is fixed at launch).
- 2026-10-01 — **Phase 4d: the specials and mystery beats.** Decisions a later phase must know:
  - **A count-up is a display override, never a write.** The play seam has already recorded the
    final value when a `coinPay` / `coinBoost` / `coinCollect` beat starts, so the beat pins each
    changed label at its OLD value (`stateRespinBoard.heldDisplay[key]`, a `Tween` per cell, set in
    the same tick as the held layer syncs) and lets go when the count ends; the label then reads the
    recorded value. `Symbol.svelte` takes the override as `labelOverride` and applies it to the label
    only, so a ticking label never re-resolves the art. The reducer stays the source of truth.
  - **The collect's per-coin moment is one function, `presentCollectStep`** (coin pulses, collector
    label rises by that coin's share). When `flyTo` ships (Phase 4 step 9) it replaces that
    function's body: the head flies coin → collector and the rise lands on `flightArrive`. The legs
    come from `countSteps` (engine-game `respinCount.ts`): proportional to each coin's `amount`, last
    leg exactly on the server's `value`.
  - **Terminal states hold.** `explosion` (a mystery opening) and `clearReel` (a streak's coin
    leaving) are not settled back to `static` on completion — that showed the old symbol for a
    frame — the sync that follows replaces or removes the cell.
  - **Symbol states used by the coded defaults:** `win` (payer, multiplier, collected coin, jackpot
    coin; held at least 400 ms so a sprite is seen), `land` (a multiplier becoming a coin, a revealed
    mystery), `explosion` (mystery opening), `clearReel` (streak clear). Phase 7 authors them.
  - **Toasts are English literals for now** ("UNLOCKED: PAYER", "MINI JACKPOT €15.00"), through
    `showMessage` like the free-spin award. Phase 8 (Win Text) owns their copy and localization.
  - **A `jackpotWin` with `banked: false` gets no toast**, only the coin highlight when
    `source: 'coin'` — its money is already in a tally cell or a collector.
- 2026-10-01 — **4c live check (#934, merged as `lines@28b09d57cd88`).** Borut parity held (14 base
  spins, a natural and a bought feature, every balance = the RGS, 0 exceptions). On
  `hw-3pots-sample` the respin board covers exactly the reel seats, held coins stay, only free cells
  roll, the counter reads the server's `left` after every `respinUpdate`, a slam compresses a 13-respin
  chain from ~20 s to 5.6 s with every coin landing, and every balance matches. Follow-ups (not
  regressions): the "RESPINS 3" counter shows ~0.7 s before the board swaps; a ~100–130 ms frame
  hitch at the start of every respin (probably the per-cell strip mount — profile); the base reels
  come back showing the trigger board and the big win plays over it.
- 2026-10-01 — **Resume did NOT reach the snapshot path, and why.** The Play4Fun facade plays the
  whole round (every respin + collect) within ~1.6 s of the bet, before anything is presented, so a
  plain reload finds the round closed. A round left OPEN (requests failed mid-feature) resumed by full
  replay (`round.event = '0'`), so the trigger played again and `holdAndWinState`'s rebuild was never
  used. Fixed in the facade: a mid-feature Hold and Win round now resumes at the end of what the
  server had stored (`holdAndWinResumePoint`), so the engine folds the trigger and the last snapshot
  into `createBonusSnapshot` and presents only the respins still to come. Other kinds keep `0`.
  What a snapshot resume does NOT carry, on purpose: the trigger spin's `reveal`/`winInfo` are
  folded away, so after the feature the reels come back on the boot board and that spin's line wins
  are not drawn (the money is right — `gameEnd`'s `setTotalWin` carries the full total); a
  `meterUpdate` from the trigger spin is not replayed (meter beats would re-present), but the server
  restates every meter in `meterLevels` after each `play`, and the snapshot keeps the last one. A
  feature that had already ended before the break resumes at 0 (the whole book plays again).
- 2026-10-01 — **Pre-existing, every flow-driven game: a resumed book starts playing BEHIND the
  loading screen.** `ResumeBet` broadcasts `resumeBet` on mount, and a flow-driven game mounts it
  under the flow's loading/tap-to-start screen, so a resumed feature runs (and can finish, big win
  included) before the player taps in. Seen on `hw-3pots-sample`; Borut's resume goes through the
  same path. **FIXED (2026-10-01):** `ResumeBet` waits for `ready` — the base game in the active
  set with no loading screen up (`Game.svelte` `isPlayerIn`). Verified on both games on the local
  mocks, A/B against the ungated version; detail in `docs/status/engine.md`.
  **Base-background layer left at alpha 1 under the feature background on a resume (#953 live
  check) — gone with this fix, by timing.** The race: the coded `<Background>`'s base
  `FadeContainer` mounts with `show` true and its `onMount` (`await set(0)`; `set(1)`) overrides the
  effect's `set(0)` when `gameType` flips in the same tick, which the old resume-at-mount did.
  The resume now flips it after the tap, long after mount. Measured on `hw-3pots-sample`, resumed
  mid-feature, three samples over 7.5 s after the tap in `respin`: only the feature layers (z −1, idle
  + dust) are mounted, alpha 1; the base layers (z −2) have faded out and unmounted. The remake has
  no coded background layers at all (its authored background scene replaces `<Background>`), so
  it can't show this. `FadeContainer`'s mount race itself is still latent for any other
  same-tick flip.

- 2026-10-01 — **Flights: a moving /fx owner does NOT leave a trail today** (read-only measure for
  step 9; design §4.4 corrected). Every renderer — `/fx` preview, `SpineBoneAttach`, `RiggedEffect`,
  the symbol `fx` layer, launcher overlays — moves the emitter's container, so particles move
  rigidly. The library trails via `emitter.updateOwnerPos` on a still parent, which no game path
  calls. `flyTo` therefore adds an `ownerPos` getter to `pixi-svelte` `ParticleEmitter.svelte` (and
  fixes its leaked ticker callback); the coded default can use the unused
  `constants-shared/particleConfig/trail.ts` plus a generated glow texture. Any future `/fx` "flight"
  preview must use the same `updateOwnerPos` path, or it becomes a fourth hand-synced renderer.
  Stale comments describing the old behaviour: `apps/launcher-api/src/routes/(app)/fx/fxModel.client.ts`
  (:385, :408).

- 2026-10-01 — **Phase 4c: the respin board.** `engine-game` builds it: `respinBoard.ts` is pure and
  pinned by `fixtures/respinBoard.fixture.ts` (which cells spin and onto what, which cells a new
  picture releases, what each cell shows at mount); `respinBoard.svelte.ts` makes `reels × rows`
  one-cell `createReelForSpinning` reels, columns stopping left to right. `apps/lines` wires and draws
  it (`stateRespinBoard.svelte.ts`, `RespinBoard`/`RespinCell`/`RespinHeldSymbol`/`RespinCounter`).
  Decisions a later phase must know:
  - **One function per beat** (`holdAndWinPresentation.ts`), called by the coded handler AND by the
    flow effect of the same beat (`showRespinBoard`, `spinRespin`, `stickCoins`, `setRespinCounter`,
    `restoreRespinBoard`, `hideRespinBoard`). The cues (`respinBoardShow`/`Hide`/`Spin`,
    `respinCoinsLand`, `respinCounterUpdate`) are NOTIFICATIONS for authored sound/FX — broadcasting
    one does not move the board. Phase 5 wires the effects, not the cues.
  - **No beat records its event.** Since 4M (#933) the play seam (`createPlayBook`'s
    `recordBookEvent`) folds every Hold and Win event into `stateHoldAndWin` before any path presents
    it, so a flow-owned event reads the same picture and nothing is applied twice (the wheel's
    `extraCollect`, a banked `jackpotWin` and a cleared `columnComplete` are NOT idempotent). The
    unpresented events' handler is `syncHoldAndWin`: it only re-syncs the held layer.
  - **The held layer is a copy of the picture**, re-synced on every Hold and Win event while the board
    is up and kept through the end, so the final board stays on screen until the swap back. A cell
    that leaves it (a streak clear, a column sweep, a snapshot correcting the client) has its reel
    settled to the blank first.
  - **`respinReveal` re-arms the slam**, as `updateFreeSpin` does per free spin
    (`SPIN_REARM_BOOK_EVENTS`): a press lands the rolling respin, the next one rolls at full pace.
  - **A base `reveal` always takes the respin board down** (`presentReveal`), so a feature whose end
    never arrived (a respin refused mid-feature) cannot leave the next round's reels rolling unseen.
  - **Respin strips:** the config's `respin` strips, else the base game's. Blank = the symbol tagged
    `blank`, else `BLANK`; with no art bound it draws nothing.
  - **Coded counter** "RESPINS n" above the board; `respinsLeft` (value) and `respinCounterShow`
    (visibility) are registered so Phase 6's authored counter binds the same state.
  - **Not covered:** stepped grids (the board assumes every column has the board's row count);
    perspective boards seat the resting cell exactly but roll on the flat pitch.

- 2026-10-01 — **First published Hold and Win project: `hw-3pots-sample`** (Invisible_Wall, Pots
  preset; playbook [docs/playtest/hw-3pots-sample.md](../playtest/hw-3pots-sample.md)). **Trap:** a
  freshly scaffolded `holdAndWin` project has NO authored Game Config, so its mock contract carries
  no `holdAndWin` block and the test server deals it plain LINES (5 paylines, `PIC*`) even though the
  Game Maker card shows the Pots defaults. Saving the config once in `/config` (then Re-publish)
  fixed it; both mocks then report `protocol: "holdAndWin"`. Phase 9's config seeding should close
  this for good. **Fixed 2026-10-01 (#956): the scaffold seeds the Pots config.**

- 2026-10-01 — **Phase 4b: the facade maps the Hold and Win wire** (`packages/rgs-translator-eagaming/src/holdAndWin.ts`,
  the swap seam; gated on the boot config's `holdAndWin.wire === 1`, any other wire is refused with
  a console error and the feature is not shown). A Hold and Win server maps symbols by IDENTITY
  (`pickMappingForConfig`). Its feature is NOT free spins any more: `enterBonus` /
  `playedBonusSpin` become `holdAndWinState` (the facade computes `total` from the roles and the
  jackpot table, and takes `stickiness` from the config), each respin's `playedSpin` becomes
  `respinReveal` (every cell, visible coordinates), and `gameEnd` closes on `setWin` (big-win tier)
  + `setTotalWin` as in the base game. **Consequence until the RespinBoard ships (4c):** the respins
  play with nothing on screen moving — the base board stays, the state is recorded, and the round
  pays the right total at the end. No Hold and Win project is published, so no player sees it.
- 2026-10-01 — **Mock quirk (wire, not facade):** when a full board or the last letter ends the
  feature, that respin's `respinUpdate` reports a reset (`left` back to the start) while its closing
  `playedBonusSpin` snapshot says `left: 0`. The engine takes the snapshot. **Fixed 2026-10-01
  (#956).**

- 2026-10-01 — **Phase 4a: the engine's Hold and Win event contract is code, not a table.** One home:
  `HoldAndWinEventFields` in `packages/engine-game/src/game/holdAndWin.ts`; `apps/lines`
  `typesBookEvent.ts` spells each arm out from it. Where it differs from the design's §4.3 sketch
  (the design table now points here): **positions are VISIBLE 0-based** (no padding row — the respin
  board has none; a base-board consumer adds it); a coin's value / jackpot label / factor ride on the
  cell's `RawSymbol` (`value`, `jackpot`, `factor`), so every event carries cells as
  `{reel, row, symbol}`; `holdAndWinTrigger` is `{mode: 'holdAndWin', cause, payload: {cells,
  respins, stickiness, activeModifiers, meters?}}` and `holdAndWinEnd` is `{mode: 'holdAndWin',
  total, payload: {cells, banked}}` — the §4.5 `modeEnter`/`modeExit` shape, so Phase 4M aliases
  them without a payload change; `cause` is `count|pattern|meter|luckySpin|randomMetre|buy` with the
  meter ids in `payload.meters`. Added beyond §4.3, because the wire carries them and the client
  must show them: `meterLevels` (the server restating every meter after each `play`),
  `randomMetreTrigger`, `cellsCleared`, and `holdAndWinState` (the server's whole picture of an open
  feature after every respin — the resume snapshot).
- 2026-10-01 — **Phase 4a: resume = the last `holdAndWinState` + the last `meterLevels`.** Kept by
  name in the engine's resume snapshot (`HOLD_AND_WIN_SNAPSHOT_EVENTS`, with `holdAndWinEnd`) and
  replayed by `createBonusSnapshot`, so a reload rebuilds the board from the server's picture without
  replaying the trigger's intro — unless a `holdAndWinEnd` follows that snapshot, when the feature
  stays closed. Meters are NOT part of a feature snapshot: they have their own events and survive it.
  The facade emits `holdAndWinState` from the wire's bonus snapshots (4b), computing `total` and
  taking `stickiness` from the boot config (the wire snapshot carries neither).
- 2026-10-01 — **Phase 4a: the client's picture is a pure reducer** (`applyHoldAndWinEvent`,
  pinned by `packages/engine-game/fixtures/holdAndWinState.fixture.ts` in `check:engine-game`), held
  in `apps/lines` `stateHoldAndWin`. Every Hold and Win handler records into it and presents nothing
  until its beat ships; the server's `holdAndWinState` replaces it wholesale after each respin, so a
  misread step self-corrects. `total` is never summed client-side.
- 2026-10-01 — **`flightArrive` is an emitter cue, not a book event** (`EmitterEventFlight` in
  `engine-game/src/game/flight.ts`, `{flight, target, index}`), in the `/flow` palette under
  "Flights". Nothing broadcasts it until `flyTo` ships.

- 2026-09-30 — **Phase 3: the wire is ours and documented as the swap seam**
  ([hold-and-win-wire.md](../reference/hold-and-win-wire.md)). The respin scaffolding is the
  partner's own model (`spinTrigger bonus: "respin"`, `enterBonus`, one context-less `play` per
  respin, `playedBonusSpin {played, left}`, `gameEnd`, `collect`); only the Hold and Win events are
  invented. Consequence worth knowing for Phase 4: the CURRENT facade already drives a whole round and
  settles the balance, so the engine work is presentation, not round plumbing.
- 2026-09-30 — **Phase 3: symbols travel in the project's OWN names** (`BONUS`, `BOOST`, …), not the
  lines `PIC*` vocabulary, and a value rides on its cell (`BONUS:1.5`, `JACKPOT:MINI*2`). Phase 4's
  facade needs an identity mapping for this protocol and a `parseCell` that reads a jackpot label.
- 2026-09-30 — **Phase 3 rules the design left open**, now fixed in the mock (change them in the wire
  doc + mock together): triggering specials do not stick (they activate their kind when
  `fromTriggeringSpecials`); payers/multipliers stay on the board inert after applying (they count
  for a full board and for column letters); a sticky-coins collector collects the cash coins once when
  it lands and keeps that value; a streak collector takes coins AND jackpot coins every respin; a
  mystery that reveals a coin counts as a new coin for the reset; the wheel's coin boost applies to the
  held coins and every later coin; all letters lit ends the feature; meters fill in the base game only.
- 2026-09-30 — **Phase 3: `jackpotWin` never adds money.** Banked jackpots (wheel, letters, full
  board) are in `holdAndWinEnd.banked`; every other `jackpotWin` is presentation of an amount already
  inside a tally cell, a collector, a column or an instant collect.
- 2026-09-30 — **Phase 3: a forced full meter says `forced: true`** on its `meterUpdate` — the force
  sets the level one short first, so the level is not the last one plus `from`.
- 2026-09-30 — **Phase 3: a `bet` over an open round opens a new round** (the partner's behaviour);
  the mock plays the abandoned feature out and credits it. Every batch is atomic (a refusal stores
  and charges nothing), fresh actions must go to the next free `seq`, and a played round's
  `play`/`collect` must carry its `gid` — found in review, pinned by the gate.
- 2026-09-30 — **Phase 3: forcing is an authoring tool.** On the test server a runtime game's PLAYER
  mock refuses forces; its authoring twin (`/api/<key>/authoring/force?…`) allows them. A playtest
  must boot through an authoring link to force a beat.
- 2026-09-30 — **Phase 3 pacing:** an empty respin cell lands something 6% of the time. At 10%, Grand
  (letters that sweep their column, so the board never fills) ran 25+ respin features.
- 2026-09-30 — **Owner: a bonus is a different game mode, and modes must queue.** A bonus-game signal can switch to a completely different mode, and two modes can be queued up to play one after another. Measured: nothing like this exists today. There is only `gameType` = `basegame | freegame`, a flat FlowDoc, strictly ordered book events, no feature queue, and a free-spin-only resume. Planned as design §4.5 / **Phase 4M**: a mode registry, a mode stack with a nest-or-queue policy, `modeEnter`/`modeExit` with the free-spin events as aliases, per-mode flow graphs shown as tabs, a scene role `mode`, and a mode-aware resume. It is a shared-runtime change, so parity is the gate.
- 2026-09-30 — **Flights (things that travel from a cell to a target, e.g. coins/specials into pots): one `flyTo` primitive, planned in design §4.4.** It computes a Bézier route at runtime that bends around the cells showing a win. The trail is an `/fx` emitter following the moving head (the moving-owner mechanism already exists for Rigger bones). A cue fires on arrival. Authoring is a `flights` block in the Symbols doc. Phase 4 builds the primitive, Phase 7 the authoring, Phase 5 the flow action.
- 2026-09-30 — **Phase 2: the config shape Phase 3 generates from** is `doc.holdAndWin`
  (`packages/game-config/src/holdAndWin.ts`; detail in [game-config.md](game-config.md)). Roles are
  `special_properties` values: `coin`, `jackpot`, `collector`, **`coinMultiplier`** (not
  `multiplier` — the lines mock contract already deals multiplier cells for that tag), `payer`,
  `mystery`, `meterSpecial`, `blank`. Specials never name their symbol; meters do. A cash coin
  draws as the `coin` symbol, a jackpot coin as the `jackpot` symbol (or the coin symbol if there is
  none). A buy tier's price is its bet mode's `cost`. Reel indices are 0-based. Every preset has a
  `respin` padding strip set (coins/specials/blank) beside `basegame`.
- 2026-09-30 — **Preset numbers the design doesn't give are placeholders**: line pays, every draw
  weight, the payer's and leave-behind coin's steps (2–10 as 2,3,…,10), the mystery table, Pots'
  `fromTriggeringSpecials: true`, and Hotfire's wheel coin boost (×2).
- 2026-09-30 — **Normalization drops half-typed entries on save** (a jackpot with no name, a meter
  with no symbol, letters with no word, a buy with no mode), consistent with the rest of the config.
  A reference to a dropped jackpot then shows as a validator error. Revisit if authors trip on it.

- 2026-09-30 — **Owner: one template makes all three reference games.** Grand, Super Hotfire Diamonds and 3 Pots of Egypt are presets of the same kind. Every option any of them uses is core scope (design §6).
- 2026-09-30 — **Owner: 3 Pots of Egypt is the first real game.** It sets the Phase 4 build order.
- 2026-09-30 — **Owner: build against our own mock now.** The partner delivers their wire later. The mock's wire is a documented **swap seam**, to be rewritten when their format arrives (Phase 10). Nothing above the facade may depend on it.
- 2026-09-30 — **Third reference, 3 Pots of Egypt** (user-supplied). It adds these to the design's option space: persistent per-player pot meters (server state), a feature entered with specific modifiers active, specials counting toward the trigger, a payer, a multiplier that becomes a coin, a mystery that unlocks modifiers, per-special value tables, apply order, a server-announced Lucky Spin, and decimal coin values. Game Maker gets a third preset, **Pots**.
- 2026-09-30 — **`holdAndWin` is a kind + a mechanic. It is not a new `winModel`.** The base game pays by `lines`.
- 2026-09-30 — **The feature runs on a dedicated per-cell `RespinBoard`.** The shared column-strip reel board is left untouched: rewriting it would put every live game at risk.
- 2026-09-30 — **Mock-first contract.** We define the engine book events (design §4.3) and the mock speaks an invented wire for them. The facade maps them. Only the facade changes when the partner confirms their format.
- 2026-09-30 — **The partner core has a generic respin but no Hold and Win data.** It has one `play` per respin and the `playedBonusSpin` counters. It has no coin values, sticky cells or collector. Its Mini/Minor/Major/Grand jackpot is the operator **platform** jackpot (`platform.jackpots[]`), not our fixed coin jackpots. That is out of scope for the first build.
- 2026-09-30 — **"Hide options per kind" needs one capability source (`kindCapabilities`).** Today only `/symbols` state columns, scene sets, the flow vocab and config-by-winModel gate at all.
- 2026-09-30 — **Trap to fix in Phase 1:** flow vocab and driven seed fall back to **bookOf** silently. Lines, cluster, scatter and custom kinds are all scaffolded with `templateId: 'bookOf'`.
- 2026-09-30 — **Phase 1: the kind list lives in `constants-shared/gameKinds.ts`**, not engine-layout or game-spec. That package is dependency-free and already imported by the launcher, engine-layout and engine-flow-v2, so nothing gains a package→app import. game-spec gained the dependency. `gen-flow-vocabulary.mjs` now imports it and runs under `node --experimental-strip-types`, which CI's Lint job now passes.
- 2026-09-30 — **Phase 1: cluster/scatter projects never reach their own flow vocabularies.** Their starter flow is the bookOf seed, whose `templateId` is `bookOf`, so `CLUSTER_VOCAB`/`SCATTER_VOCAB` are registered but unused by any scaffolded project. Parity kept on purpose; it is a separate fix, outside this initiative.
- 2026-09-30 — **Phase 1: `kindCapabilities()` is wired only where it is a drop-in.** That means `/symbols` `visibleStatesFor` (book + cascade columns) and the `gameProfile` detectors (cascade, multiplier collect, expanding book, and the new "Hold and Win respins" chip). For every existing kind `freeSpins` and `stackedPictures` are `true`, the flags nothing gated before. `holdAndWin` has them `false`, but no tool reads them yet: Phases 6–8 do.
- 2026-09-30 — **Desktop builds are unverified for `holdAndWin`.** A desktop build of a `holdAndWin` project is stamped `protocol: 'holdAndWin'`. `resolveActiveMapping()` maps an unknown `PUBLIC_RGS_GAME` to the lines mapping, so that is safe. The desktop launcher's own (Python) handling of an unknown protocol was not checked.

## Touch list (every place a new kind must be registered — from the 2026-09-30 inventory)

- `apps/launcher-api/src/lib/roles.ts:47-55` (`GameKind`/`GAME_KINDS`)
- `apps/launcher-api/src/routes/(app)/editor/+page.svelte:~2119` (`GAME_TYPES`)
- `packages/game-spec/src/schema.ts:25` (`GameTypeSchema`) and `:28` (`SymbolKindSchema`), `scaffold.ts:52`
- `apps/launcher-api/scripts/check-flow-publish-gate.ts:32`
- `scripts/gen-flow-vocabulary.mjs:70` → regenerates `lib/emitterVocabularies.ts` (`/fx` suggestions)
- `apps/launcher-api/src/lib/server/mockProtocol.ts` `protocolFor()`; `testServerManifest.ts:217` + `services/test-server/server.mjs:483` `MOCK_PROTOCOLS`; `server.mjs` `makeMock` / `hydrateOnce`
- `packages/engine-layout/src/lib/referenceLayouts/index.ts` `FULL_SCENE_SOURCES`; `templates/index.ts` `TEMPLATES`; `sceneRole.ts` `SCENE_ROLE_LABELS` + `types.ts` role union
- `packages/engine-flow-v2/src/reference/registry.ts` `TEMPLATE_VOCABULARIES`; `drivenSeed.ts` `DRIVEN_SEEDS`
- `apps/launcher-api/src/lib/server/gameProfile.ts` `FEATURE_DETECTORS`
- `apps/launcher-api/src/lib/server/gameConfigDefaults.ts` + `scripts/generate-game-config-defaults.ts`
- `apps/launcher-api/src/lib/server/symbolDefaults.ts` (only `lines.json` exists)
- `apps/launcher-api/src/routes/(app)/symbols/symbols.client.ts` `visibleStatesFor`
- runtime: `apps/lines/src/game/{typesBookEvent,bookEventHandlerMap,flowEffects}.ts`, `engine-game/src/game/{types,bookEvents}.ts`
- facade: `packages/rgs-translator-eagaming/src/{engineFacade,gameMappings,sessionState}.ts`

## Win Text literals for Phase 8

**Moved onto Win Text by Phase 8 part 2** (`holdAndWinText.ts`) — every row below except the coin
labels (Phase 7) and the letters row (config, not a literal). Kept as the map of where each line is drawn.

Every player-facing string the Phase 4 coded defaults print, for Phase 8 to move onto `formatWinText`
(through `apps/lines/src/game/holdAndWinText.ts`). All are English literals today; nothing else in the
Hold and Win beats prints copy.

| Literal (as printed) | Where | Beat |
|---|---|---|
| `RESPINS {left}` | `components/RespinCounter.svelte` | the respin counter |
| modifier line `MYSTERY · COLLECTOR · PAYER` (special names joined by ` · `) | `RespinCounter.svelte` | active modifiers |
| `SINGLE` / `DOUBLE` / `TRIPLE` `COLLECTOR` (counter line) | `engine-game` `holdAndWinWheel.ts` `collectorLevelName` + `RespinCounter.svelte` | collector level |
| special names `COLLECTOR`, `MULTIPLIER`, `PAYER`, `MYSTERY` | `game/holdAndWinPresentation.ts` `specialName` | toasts below |
| `{SPECIALS} ACTIVE` (toast) | `holdAndWinPresentation.ts` `presentMeterConsume` | a full pot enters the feature |
| `UNLOCKED: {SPECIALS}` (toast) | `holdAndWinPresentation.ts` `presentMysteryReveal` | a mystery unlocks a modifier |
| `LUCKY SPIN` (banner) | `holdAndWinPresentation.ts` `presentLuckySpin` | Lucky Spin intro |
| `{TIER} JACKPOT` + detail `{amount}` or `FULL BOARD  {amount}` (banner) | `holdAndWinPresentation.ts` `presentJackpotWin` | banked jackpot |
| `{TIER}` + `{amount}` (small banner) | `holdAndWinPresentation.ts` `presentJackpotWin` | coin jackpot in the tally |
| `INSTANT WIN` + `×{factor}` … `{amount}` (banner) | `holdAndWinPresentation.ts` `presentInstantCollect` | base-game instant collect |
| wheel segment labels `COIN BOOST ×{n}`, `+{n} COLLECT`, `{TIER}` | `engine-game` `holdAndWinWheel.ts` `wheelPrizeLabel` | the wheel |
| wheel prize detail `EVERY COIN ×{n}`, `{LEVEL} COLLECT`, `JACKPOT` | `holdAndWinPresentation.ts` `wheelPrizeDetail` | the wheel's prize banner |
| pot labels `{METER ID} {level}/{max}` and the `activates` name | `components/HoldAndWinPot.svelte` | the pots |
| letters row (the config's `boardEnd.letters`, not a literal) | `components/HoldAndWinLetters.svelte` | Grand letters |
| coin labels `MINI`, `MINI ×{n}`, `×{n}`, `+{money}` (tier names come from the config) | `engine-game` `coinLabel.ts` | every coin |

## Open items / next

- **Phase 12c next (part 1 is #1006):**
  - **12a is merged in** (the coded pot uses its `meterStage`). The create type keeps the Pot
    Meter's `signalScope` / `signalScopeKind` and is offered only to a Hold and Win project. The
    story's two frog pots show that a node inside the part hears only its own pot's
    **Pot — activate**.
  - **12b is merged in.** The Pot's fill reveal is its `fillMaskRect`; the coded `potFillRect` is
    gone.
  - **The done-when passes locally on the real game (2026-10-03, Recent changes).** A project Pot
    copy on all three pots, each forced full in turn: only that pot's frog celebrates and fires its
    FX, and each frog's bone follows its own pot's level, with no Flow at all. It found and fixed an
    FX bug (an effect inside a component also burst at the stage origin).
    - **Owed: the live run on `hw-3pots-sample`** (Owner checklist 13). This session could not
      reach the launcher, the games host or R2, so nothing was authored on the project.
  - **The respin counter is done** (Decisions). Open on it: the active-modifiers line has no source
    an authored text can bind.
  - **The total win bar is done** (Decisions). Open on it, for the owner: whether a new project's
    reference bar should catch the coins (`catchesCoins` on in `holdAndWinReferenceLayout`). It is
    off today, so every game keeps flying them to the win meter.
  - **The letters strip is done** (Decisions). Open on it: the editor shows the strip as its grey
    part box, not the letters or tiles, because the editor does not know the config's letters.
  - **The wheel is done** (Decisions). Open on it: nodes inside the part draw static in the editor;
    only the game turns them.
  - **The respin cell tiles are done** (Decisions). That closes the 12c list of parts. Open on
    them: the coin signals are not scoped per cell (Decisions).
  - **A Platform Jackpot Bar copy** has no create type. Its tiles already get the part, and the
    component swap works on any bar copy.
  - **Editor limits:**
    - Inside a part, positions are the part's own. That is fine while the part sits at the
      component's origin, as the Pot does.
    - Inside a part, the canvas shows only the part's nodes. The art picked in this game's
      defaults is not drawn behind them.
    - The canvas does not preview the coded labels, the size-stage images or the pot's `scale`
      param.
    - Selecting a Respin Cell Tiles previews its `tileImage` at every cell even when its `tile`
      names a Cell Tile. The Cell Tile shows in the Component Editor and in the game.
  - **Not verified in a browser:** the editor side (the launcher is auth-gated). It type-checks and
    builds. The runtime was verified in Storybook (`MODE_HOLD_AND_WIN/skinned pot (12c)`).
- **Phase 12b follow-ups** (none blocks 12c):
  - **Live check owed.** A binding authored in the Component Editor has not been seen on a live
    project: the editor UI type-checks and bundles, and the runtime was screenshot in Storybook
    (`ENGINE-LAYOUT/Value bindings`). The done-when's bone on `meter.{meter}.level` passes on the
    real game locally (12c Recent changes, 2026-10-03); the live run is Owner checklist 13.
  - **The Scene Editor cannot scrub a node inside a placed instance** — those nodes are not
    selectable there. Scrub it in the Component Editor.
  - **Fill covers sprite, flipbook and rect only.** A container or spine fill (mask a whole group)
    is not built.

- **Phase 12a owed:**
  - **A live check on `hw-3pots-sample`.** Author a component scoped by `meter` with a spine cue on
    **Pot — activate** (or an FX on `potFull`), place it on each pot, and confirm only the pot that
    activates plays. Everything up to that point is gate-covered (`check:signal-scope`), but the
    instance filter itself is Svelte and runs only in a browser. The 12c done-when rehearsal ran it
    in the real game on the local mock (a spine cue and an FX, three pots): only the activated pot
    played. The live run is Owner checklist 13.
  - **Coins are not scoped.** A coin signal has no part a placed component stands for. 12c's Cell
    Tile is a per-cell instance now, but "Coins land" lists several cells, so a per-cell scope would
    need a fire per cell, which would replay an unscoped listener's cue. A Cell Tile reads its cell's
    state from `held` instead.
- **Phase 11b follow-ups** — both ruled by the hub (2026-10-02) and closed:
  - **Reserving an expanding board's area** — the scaffold and "Add missing screens" build the
    template with the stored config's `maxRows`, and the Scene Editor offers **⇕ Reserve rows for
    board expansion** when the config expands but the reel grid has no room (it sets the grid's cell
    size and board nudge; the node does not move; `reserveExpandingBoard` / `expandingBoardReserved`).
  - **Coins in unlocked rows after the feature** — decided: the base board has `startRows`, so they
    leave with the feature (they are paid in the tally). Documented in the playbook (S9 end state).

- **Phase 11a follow-ups** (none blocks authoring):
  - **The active-modifiers line overflows** on the reference layout's wide arrangement once five
    specials are active ("MYSTERY · ADD RESPINS · UPGRADE · PAYER · COLLECTOR" runs off the left
    edge under the authored counter). Every `pots-extra` feature hits it; needs a wrap or a
    shrink-to-fit on that line.
  - **An upgrade cell shows its cash step ("+$1.00") even when it then applies `jackpotTier`**
    (the rule is drawn when it applies, per the rules). If that reads wrong, draw the rule when the
    cell is DEALT instead and print the tier rule as "UP" — a wire change (the cell would carry it).
  - Not verified live: the sticky add-respins variant (gate-covered only), any project art for
    `ADD` / `UPG` (labels only), an authored `toCounter` / `upgradeBeam` flight.

- **Phase 6 owed (owner actions):** `hw-3pots-sample` lacks the message host — in `/editor` run
  **＋ Add missing screens** and place an **Info Bar** on its base game (the Phase 6 session could not
  write the live doc), then confirm the "UNLOCKED"/"ACTIVE" toasts on the mock; scaffold a fresh
  `holdAndWin` project, open `/editor`, screenshot the template; check the jackpot bar's portrait fit
  (≈22 px each side at 0.75 scale). **Portrait finding (Phase 4 polish):** on `hw-3pots-sample`'s
  layout the board's top sits at the canvas edge, so the coded counter placed above it was off
  screen. Fixed for the CODED counter (it is pulled down onto the top row when there is no room
  above, measured through the board's transform); an authored `respinCounter` is the author's to
  place — check it in portrait with the jackpot bar.

1. **Phase 7 follow-ups** (none blocks authoring):
   - **Owner: Re-publish `hw-3pots-sample`** so players (not just `authoring=1`) see the authored coin
     label, flights and seeded symbol art — and replace the seeded placeholder art with real 3 Pots art
     in `/symbols`.
   - Prove an authored `/fx` trail and arrival effect live (author one in the sample); measure
     `countMs` live; author an `arc` on a flight (the knob shipped in #977; nothing authors one yet); author a
     `boostBeam` (the coded multiplier beat flies one since Phase 4 polish — a coded glow until then;
     its `/symbols` row is listed since #980).
2. **Phase 4 follow-ups** (the build is complete; none blocks authoring):
   - **Grand and Hotfire are verified in Storybook only** (facade-recorded books, every bar = the
     feature total). Create a Classic and a Collector sample project with the Game Maker preset
     picker (Phase 9a seeds their config; no `/config` save needed), publish, and play their
     letters, instant collect, streak flights and wheel live through their playbooks.
   - **From the live checks (not regressions):** a ~170 ms idle (non-JS) frame at the feature's
     entry, before the board shows, on `hw-3pots-sample`. (Counter timing, the per-respin hitch, the
     cropped rolling cells, the end board, the tally/hide order and the hidden banked-jackpot beat
     were fixed by Phase 4 polish — Recent changes.) **Not reproduced off the sample's art**
     (Polish 2, 2026-10-02): on the engine's fallback layout with the Pots and Classic presets
     (60 fps GPU headless shell, local mocks, three features in a row) no entry frame went over
     40 ms. The one first-use cost found is a ~58 ms WebGL program link (`getProgramParameter`) on a
     session's FIRST spin, not at entry. So the sample's frame is most likely its own art's first
     upload as the respin layers mount. Next: trace it on the sample itself (`?runtime=1` with its
     read token, which the polish-2 session could not read), then pre-warm
     (`renderer.prepare`) only what that trace names.
   - ~~Authorable respin cell tile / frame + cell gap~~ — built 2026-10-02 (Recent changes). A
     project scaffolded before then adds the **Respin Cell Tiles** component to its Respin board
     screen from the palette.
   - **Accepted on purpose:** `holdAndWinEnd` and banked jackpots run inside the unskippable window,
     so the end volley plays at full length even under turbo/autoplay.
   - **Grids:** stepped grids are refused by `/config`; perspective follows the reel board
     (Decisions, Phase 4 polish).
   - **`hw-3pots-sample` draws no toasts** ("UNLOCKED", "PAYER ACTIVE", "Good luck" are set, never
     drawn): its layout has no message host — Phase 6's template should carry one.
3. **Ask the partner** for a Hold and Win sample round or their handler subclass (design §3.2).
4. **Phase 9 owed** — see the Owner checklist below (steps 1–4), then a session plays the samples.

## Owner checklist (every owner-owed Hold and Win item, in one place)

Each of these needs a launcher login or a decision only the owner has. A session cannot sign in, so
Phase 9b stopped here (2026-10-01). Tick them off here when done.

1. **Create `hw-classic-sample`** — app.invisiblewall.org → **Game Maker** → Create a game: Name
   `hw-classic-sample`, Client **Invisible_Wall**, Game type **Hold and Win**, Preset **Classic sticky
   (Grand)** → **Create project**. Since #969 the scaffold also writes its symbols doc (BONUS /
   JACKPOT / BOOST bound to placeholder art).
2. **Create `hw-collector-sample`** — same, Preset **Collector streak (Super Hotfire Diamonds)**
   (BONUS / JACKPOT / COLLECT bound).
3. **Publish both** from their Game Maker cards; then open
   `https://games.invisiblewall.org/api/<key>/healthz` for each and confirm `protocol: "holdAndWin"`.
4. **Hand back to a session** (no login needed from here): play both end to end with forced beats on
   a FREE local mock port (never 7788), per [classic](../playtest/hw-classic-sample.md) (boost incl.
   jackpots, base-game instant collect, column letters + sweep → GRAND, buy / super buy) and
   [collector](../playtest/hw-collector-sample.md) (pattern trigger, the wheel — every prize, its copy
   never verified live — collector streak with coin flights, GRAND as a coin); check balances vs the
   server, Win Text, toasts, 0 console errors, Borut parity. Then rerun `hw-3pots-sample` S1–S7 on the
   current runtime.
5. **`hw-3pots-sample` layout** — `/editor`: **＋ Add missing screens**, place an **Info Bar** on its
   base game (its toasts "UNLOCKED" / "PAYER ACTIVE" / "Good luck" have no message host today).
   Since the In-game view change (editor status, 2026-10-01) this adds every Hold and Win screen
   (Jackpot bar, Pots, the feature screens) at its place in the list. It offers them only once the
   editor follows the project's kind rather than the layout's stored `gameType` (editor status,
   2026-10-02): this layout came from the lines reference, so before that fix neither the screens
   nor the Pot Meter component were offered. The project's flow is the
   Book-of seed, so the game draws the added Pots / Jackpot bar only after `/flow-v2` shows them at
   load (or the project is re-seeded with the Hold and Win starter flow). Until then the coded pots
   keep drawing.
6. **Re-publish `hw-3pots-sample`** so plain player URLs (not just `authoring=1`) get the authored coin
   label, flights and seeded symbol art.
7. **Real art** — replace the seeded placeholder symbol art (scatter / wild / M spine / exploded
   wild) in `/symbols` for all three samples.
8. **Older Hold and Win projects** with no symbols doc: `/admin` → **Rescaffold** writes the bindings
   (it never touches an existing symbols doc; bind by hand in `/symbols` if one exists).
9. **Ask the partner** for a Hold and Win sample round or their handler subclass (design §3.2) —
   unblocks Phase 10.
10. **Borut parity round on live data (11c)** — the session's attempt to read bookofborutremake's
    read token from R2 was refused by auto mode (as on 2026-10-02 before). It ran the proxy instead:
    apps/lines as a book game on the local book mock, a full free-spin round, balance exact, 0
    errors. Play the remake on its live data per `reference_parity_free_spin_round_local`, or grant
    the read, to close it. **Evidence from 11b (2026-10-02):** the 11b session's read of the token
    was allowed and it ran the remake on live data, real clock: `main@59d12ae6` (11c part 1) vs
    `cf41a3c9` + 11b (11c parts 1 and 2) had identical flow-trace vocabulary and emitter-event sets,
    holds = releases, 0 exceptions — the hub may close this item on that.
11. **Try the platform jackpot on a test game (11c part 2)** — add `"mockPlatformJackpot": true` to a game's
    `hostSettings` in `test_server/games.json` (a republish keeps it). Its mock then runs the
    platform jackpot. Force a hit from an authoring link with
    `/api/<key>/authoring/platformJackpot?sid=<sid>&hit=Grand` (`&when=feature` for a free spin or a
    respin). And ask the partner for a heartbeat answer from a brand that runs one
    (`play4fun-protocol.md` "Checks owed", item 5).
12. **Bind art for an unlock symbol (11b)** — a project that turns on the unlock-symbol expansion rule
    binds its `unlock`-tagged symbol in `/symbols` (the tool defaults use the scatter art, seeded only
    when the symbol exists at scaffold time). Without art the beat still plays (state, flight, fade,
    banner).
13. **The 12c done-when, live on `hw-3pots-sample`** — after #1006 merges and its runtime release
    passes. Needs item 5 first (the project has no Pots screen, and its Book-of flow must show the
    Pots screen at load). Then, as the author, per the playbook's
    [S10](../playtest/hw-3pots-sample.md): create a **Pot Meter (Hold and Win)** copy, put the frog
    spine and an FX inside its `Pot` part, give the spine a cue on **Pot — activate** and a **Bind to
    value** on its belly bone, pick the fill and frame art, switch the three placed pots to the copy,
    and publish. Hand the forced rounds back to a session, or play them: each `meter:<id>` must play
    only that pot's frog and FX, with no Flow branch. A cloud session needs `games.invisiblewall.org`
    allowed in its environment's network access to play it.

## Blocked (owner / external)

- **Partner Hold and Win wire format.** This blocks production RGS play only. Authoring and mock play are not blocked.

## Recent changes

- 2026-10-07 — **A role symbol on no strip is never dealt.** `holdAndWinMockInputs` passed every
  symbol with a Hold and Win role, so the mock dealt a coin, special, meter or unlock symbol that
  `/config` badges unused. It now passes only role symbols a strip deals: a special or meter whose
  symbol is unused never lands, and a forced meter (`force:meter:<id>`, `force:trigger:meter:<id>`)
  whose symbol is unused is refused like a forced special the game lacks. A coin symbol is the one
  role the feature cannot do without, so `/config` now refuses to save a config with no coin or
  jackpot symbol on a strip, or with cash coins and no coin symbol on one (the mock would deal them
  as the jackpot symbol, which the game values at nothing; this also covers a dictionary that tags
  no coin at all). The client's respin board draws an empty cell with the blank symbol only while a
  strip deals it, else the wire's `BLANK`, matching the mock. Every preset deals all its role
  symbols, so nothing changes for them (`check:holdandwin` unchanged). Gate:
  `check:unused-symbols-in-game`.

- 2026-10-03 — **Phase 12c: the done-when rehearsed on the real game, locally** (#1006). All three
  pots pass. The live run on `hw-3pots-sample` is owed (Owner checklist 13).
  - **Why local:** this session's egress blocks `games.invisiblewall.org` and
    `app.invisiblewall.org`, and it has no R2 keys. So nothing was authored on the project.
  - **The setup** (recipe in the playbook's S10): the `lines` runtime from this branch with
    `?runtime=1`, a local `/api/editor/runtime` stub and the Pots mock (`PRESET=pots`, a free port).
    The stub serves the Pots preset and the Hold and Win reference layout, with the three placed
    pots switched to a project Pot copy and no Flow.
  - **The Pot copy, authored as the done-when asks:**
    - The fill and frame are bitmaps through the art params (the game's progress-bar sprites).
    - The "frog" is the H1 rig inside the `Pot` part, with a cue on **Pot — activate** playing
      `h1` (its celebrate).
    - A 12b `bone` binding scales its `beard` bone (the belly) by `meter.{meter}.level` over
      `meter.{meter}.max`, from 1× to 2.5×.
    - An FX node inside the part, its layer triggered on `potsConsume` with no scope of its own.
  - **Result:** each `meter:<id>` forced in turn, Playwright reading the Pixi scene:
    - Only that pot's frog plays `h1`, and only its FX emits (24 particles within 70 px of the pot
      at the probe's sample; 47 at the burst's peak); the other two rest.
    - Its bone reaches 2.49× as the pot fills to 12 of 12, and falls back as the feature takes
      the pot. The other frogs hold their own levels (1.125× at 1 of 12).
    - 0 particles away from the pots, 0 console errors, no Flow in the bundle.
  - **Found and fixed:** the FX also burst at the stage origin, unscoped, on every pot's cue.
    `placedEffectIds()` walked only the scenes, so `Effects.svelte` auto-mounted the Pot's effect a
    second time. One shared walk now, `collectPlacedEffectIds`, with `test-placed-effects.mjs`.
    Detail: [fx](fx.md).
  - **Checks:** `check:all` (363), svelte-check at baseline for lines, engine-layout and the
    launcher, the `lines` and `launcher-api` builds.
- 2026-10-03 — **Phase 12c: the respin cell tiles skinned** (#1006). That closes the 12c list of
  parts. Contract: Decisions, "The respin cell tiles follow the Letters Strip".
  - **Engine:**
    - `CELL_TILE_DEF` (`cellTile`): the tile and a held overlay inside its `Cell` part.
    - `RESPIN_CELLS_DEF` gains `tile` (kind `component`, fed `reel`, `row`, `held`).
    - The `CellTilePart` catalog entry (no art layers).
  - **Game:**
    - `CellTilePart` draws the skin and pulses it when a coin lands on its own cell.
    - `RespinCellTiles` hands the board the `tile`, refusing an unregistered or self-naming one.
    - `RespinBoard` → `RespinCellTile` mounts it per open cell, scaled to the cell's window and fed
      its `held` through `engineValues`.
  - **Editors:** **Respin Cell Tiles** and **Cell Tile (Hold and Win)** create types.
  - **Verified:**
    - `test-cell-tile.mjs` (23 assertions): the tile's shape and box, the held overlay's binding,
      the defaults (still, a sample cell), no stand-in, the `tile` param and the picker filter (a
      Letter Tile is not offered), the parity default, an old copy's upgrade, and shipping through
      the closure.
    - Every engine-layout fixture, `check:holdandwin` and the launcher's `check:*` gates pass.
    - Storybook `MODE_HOLD_AND_WIN/skinned cell tiles (12c)`, a placed Respin Cell Tiles over a 3×3
      grid of cells:
      - **On a Cell Tile copy:** all 9 tiles draw at the cell's box (0.94, the gap's inset). Holding
        two cells shows two "H" overlays, and releasing one leaves one.
      - **A coin landing on cell 1:1** pulses that tile alone (1.16 at 60 ms), back to 0.94 by
        860 ms.
      - **A missing tile, or one naming the cell tiles:** refused; no tile draws.
      - **A copy nesting a Respin Cell Tiles:** all 9 tiles stay, and the look holds over 90
        frames. Before the fix, the same story settled with no tiles at all.
    - A whole feature does not render a board in the sandbox (its art loads from the network), so
      the story mounts the cells directly.
    - The `lines` build passes.
  - **Review round (code-reviewer):**
    - **Fixed:** a Respin Cell Tiles nested in a Cell Tile replaced the look that mounted it,
      emptying the board (Decisions, "Nesting").
    - **Fixed:** the board fitted the tile by `SYMBOL_SIZE`, 120 like `CELL_TILE_SIZE` only by
      coincidence. It divides by the exported `CELL_TILE_SIZE` now.
    - **Fixed:** a typo in the def's JSDoc.
    - **Noted:** each open cell mounts a whole `ComponentInstance` when a tile is set. That is fine
      at 5×3. On an expanding board on a low-end phone, watch the mount cost as the board shows.
- 2026-10-02 — **Phase 12c: the Wheel skinned** (#1006). Contract: Decisions, "The Wheel follows
  the Pot".
  - **Engine:**
    - `wheelSkin.ts` (`WHEEL_SKIN_PARAMS`, `readWheelSkin`).
    - `WHEEL_DEF` carries them, `standsFor` its part, and adds `WHEEL_MOUNT`.
    - The `HoldAndWinWheelPart` catalog entry (face under rim).
    - `PartSkinBinding.radiusParam`.
  - **Game:**
    - `HoldAndWinWheelArt` draws the art params and the skin in always-mounted layer slots.
    - `HoldAndWinWheelPart` reads the skin, counts in under `WHEEL_MOUNT` and stands in.
    - `HoldAndWinWheel` steps aside on the mount key.
  - **Editors:**
    - The canvas previews the face and rim at twice `radius`.
    - A **Wheel (Hold and Win)** create type.
  - **Verified:**
    - `test-wheel-skin.mjs` (21 assertions): the params beside an unchanged `radius`, the
      parity read, fallbacks for cleared or bad values, `standsFor`, the mount key, the editor box,
      and an old wheel's upgrade.
    - Every engine-layout fixture plus the launcher's `check:*` gates pass.
    - Storybook `MODE_HOLD_AND_WIN/skinned wheel (12c)`, seven prizes, spun onto segment 3:
      - **As shipped:** the built-in draws the coded wheel. The segments are 380 px across, and the
        pointer tip sits at y = 157.
      - **Art params on a renamed copy:**
        - The face and rim draw 371 px square (the wheel's diameter), and the labels are off.
        - The pointer image's bottom-centre sits at (506, 154), the coded tip.
        - The copy counts in as the wheel.
      - **A "★" node inside the part:** it turns with the face, from (506, 200) to (451, 440), 127 px
        from the centre on both sides of a 205.7° turn.
  - **Review round (code-reviewer):**
    - **Fixed, blocking:** the labels used a plain `<Text>`, so a Font Maker font picked as the
      label font drew in the browser's default face. They use `CatalogText` now, as the Pot's
      labels do.
    - **Fixed:** the editor drew the rim under the nodes inside the part, while the game draws it
      over them. Layers now carry `overNodes`.
    - **Fixed:** the create-type hint named the wrong category (copies are listed under UI).
    - **Fixed:** the fixture checks the font picker through `fontParamKeysOf` (21 assertions now).
    - **Noted:** the rim-only preview (Decisions).
    - **Found in passing, older:** `collectArtRefs` also misses image params set in a per-ratio
      override (`node.overrides[layoutType].params`). Queued as its own task, beside the one for
      art picked in **This game's defaults**.
- 2026-10-02 — **Phase 12c: the Letters Strip skinned** (#1006). Contract: Decisions, "The Letters
  Strip draws each letter as a Letter Tile instance".
  - **Engine:**
    - `LETTER_TILE_DEF` with its `Letter` part.
    - The strip's `tile` param, `standsFor` and `LETTERS_STRIP_MOUNT`.
    - The `component` param kind.
    - The `letter.{reel}.lit` binding source.
    - The `LetterTilePart` catalog entry.
  - **Game:**
    - `LettersStrip` draws the coded letters or one tile instance per letter, counts in under
      `LETTERS_STRIP_MOUNT`, and stands in.
    - `LetterTilePart`: skin, pulse, coded fallback.
    - `HoldAndWinLetters` steps aside on the mount key.
    - The `letter.<reel>.lit` value sources.
  - **Editors:**
    - The Properties `component` select.
    - **Letters Strip** / **Letter Tile (Hold and Win)** create types.
  - **Verified:**
    - `test-letters-strip-part.mjs` (32 assertions): the tile's shape, state bindings, the coded
      look, scope, pulse and source; the strip's param, parity default, `standsFor`, mount key, and
      an old strip's upgrade.
    - `test-component-closure.mjs` (11 assertions): a tile named on the placed strip, a per-ratio
      override, the project's defaults, a strip copy's default or a nested strip ships; a missing
      one is skipped; a doc naming none loads in the plain walk's order.
    - `test-hold-and-win-template.mjs` now lists `letterTile` as gated.
    - Every engine-layout fixture plus the launcher's `check:*` gates, `check:undefined-names`,
      `check:path-imports` and `verify-pot-meter-mount` pass.
    - Storybook `MODE_HOLD_AND_WIN/skinned letters strip (12c)`, on the classic preset's GRAND,
      lighting reel 2:
      - The built-in strip draws the coded letters.
      - A renamed copy drawing the Letter Tile matches the coded letters' positions and colours,
        and pulses the same.
      - A tile with a node gated on **Letter lit** shows it over A only.
      - A missing tile, or a tile naming the strip itself, falls back to the coded letters.
      - Every copy counts in as the letters row.
  - **Review round (code-reviewer):**
    - **Fixed, blocking:** a project's Letter Tile named by `tile` never shipped. The bake, the runtime
      bundle and the art export only followed instance nodes, so the published strip fell back to
      the coded letters. All three now share `resolveComponentClosure`, which follows
      `component`-kind params.
    - **Fixed:** the strip drew nothing, not the coded letters, when the tile `<ComponentInstance>`
      would refuse (too deep, or a cycle).
    - **Fixed:** **This game's defaults** and **Variables in use** were free text for a `component`
      param; they are selects now. The picker lists only components declaring every `fedParams` key,
      and same-named entries show their id.
    - **Fixed:** the tile reads `reel` once (a Svelte `state_referenced_locally` warning).
    - **Fixed:** doc wording.
    - **Left:** a tile's nodes get no screen `space` (Decisions, Limits).
    - **Found in passing, queued as its own task:** art picked only in **This game's defaults**
      never reaches `deploy/editor-art/`, for any component. `collectArtRefs` never reads the
      project's defaults. The guide sends a tile's art to its own param defaults instead.
- 2026-10-02 — **Phase 12c: the Total Win Bar skinned** (#1006). Contract: Decisions, "The Total
  Win Bar can catch the coins".
  - **Engine:**
    - `TOTAL_WIN_BAR_DEF` sits inside a `Bar` part and `standsFor` it, with `catchesCoins` and
      `landPulseScale`.
    - `TOTAL_WIN_BAR_ANCHOR` (`flightStyle.ts`).
    - The `TotalWinBarPart` catalog entry.
  - **Game:**
    - `TotalWinBarPart` (skin, pulse on each head landing in the total, the catch anchor,
      stand-in), registered in `Game.svelte`.
    - `'total'` resolves through `totalTargetPoint()`: the bar first, then the win meter.
  - **Editor:** a **Total Win Bar (Hold and Win)** create type.
  - **Verified:**
    - `test-total-win-bar-part.mjs` (15 assertions): the shape, ids, binding, both parity defaults,
      `standsFor`, and the flat copy's upgrade (stand-in, both params back, catching off).
    - `test-respin-counter-part.mjs` drops its check that the total win bar had no part.
    - Every engine-layout fixture plus `verify-pot-meter-mount`, `check:signal-scope`,
      `check:symbols-kind-gating`, `check:scene-cues` and `gen:scenes --check` pass.
    - Storybook `MODE_HOLD_AND_WIN/skinned total win bar (12c)`, with a stand-in win meter at
      (150, 600):
      - As it ships, the next head lands on the win meter and the bar registers no anchor.
      - With `catchesCoins`, it lands on the bar's centre. One landing at `landPulseScale` 1.3
        widens the bar 304 → 347 px, sampled 60 ms in (on its way back from the 1.3 peak), and it
        settles back to 304 px.
      - A bar saved before the part catches through the stand-in, on the same point.
- 2026-10-02 — **Phase 12c: the Jackpot Tile and Bar** (#1006). Contract: Decisions, "The
  Jackpot Tile follows the counter".
  - **Engine:**
    - `panelInPart` (shared with the counter).
    - `JACKPOT_TILE_DEF` inside a `Tile` part, with `winPulseScale`.
    - The `JackpotTilePart` catalog entry.
  - **Game:** `JackpotTilePart` (skin, pulse on its tier's Hold and Win or platform win), registered
    in `Game.svelte`.
  - **Editors:**
    - A **component** swap on any instance (Properties, both editors).
    - `/components` passes its defs to it, minus the open one.
    - **Jackpot Tile** / **Jackpot Bar (Hold and Win)** create types (a `COPY_TYPES` table now).
  - **Verified:**
    - `test-jackpot-tile-part.mjs` (15 assertions): the shape, ids, bindings, scope, no stand-in, the
      parity default, the flat copy's upgrade, and that both bars place four tiles by id.
    - Every engine-layout fixture plus `check:signal-scope`, `check:symbols-kind-gating`,
      `check:scene-cues` and `gen:scenes --check` pass.
    - Storybook `MODE_HOLD_AND_WIN/skinned jackpot tiles (12c)`, widths measured per tile:
      - A MAJOR win pulses only MAJOR (162 → 211 px).
      - On the platform bar, a Hold and Win GRAND win pulses nothing, and the platform's `Grand`
        pulses only GRAND.
- 2026-10-02 — **Phase 12c: the Respin Counter skinned** (#1006). Contract: Decisions, "The
  Respin Counter gets a coded part".
  - **Engine:** `RESPIN_COUNTER_DEF` wraps its panel in the `Counter` part and `standsFor` it, with a
    new `pulseScale` param. The `RespinCounterPart` catalog entry is `skin` with no layers.
    `<ComponentInstance>`'s def-id `flightAnchor` is gone.
  - **Game:** `RespinCounterPart` (skin, pulse, anchor, count, stand-in, coded fallback) and
    `RespinCounterArt` (the coded look, now shared by `RespinCounter`), registered in `Game.svelte`.
  - **Editor:** `/components` offers **Edit inside Counter ›** and a **Respin Counter (Hold and
    Win)** create type.
  - **Verified:**
    - `test-respin-counter-part.mjs` (14 assertions): the shape, ids, the parity default, the flat
      override's upgrade, and that the other panels are untouched.
    - Every engine-layout fixture, `check:signal-scope` and `gen:scenes --check` pass.
    - Storybook `MODE_HOLD_AND_WIN/skinned respin counter (12c)`: built-in, stand-in and empty part
      each register `respinCounter` and count in. Measured pulse on a reset: 1.35 → 1 for the
      built-in and the coded fallback, none for the stand-in.
- 2026-10-02 — **Phase 12c: one fill rule** (#1006). The Pot's fill image is revealed by 12b's
  `fillMaskRect` (game and editor preview). The coded `potFillRect` and `PotFillDirection` are
  deleted; `POT_FILL_DIRECTIONS` is typed as 12b's `ValueBindingFillDirection`. The fixture pins
  the pot's centred use (50 assertions).
- 2026-10-02 — **Phase 12c: the deleted-part trap** (session "Hold and Win Phase 12c skinnable
  parts", #1006, on top of 12a and 12b, both merged in). Contract: Decisions, `standsFor`.
  - **Engine:**
    - `ComponentDef.standsFor` and `partStandIn` (engine-layout).
    - `<ComponentInstance>` mounts the stand-in.
    - `PotMeter` `standIn`: an anchor and the count, no pot.
    - The Pot Meter stands for `PotMeter`.
  - **Storage:** `componentStorage` keeps the field. `mergeBuiltinCodedParams` restores it by id.
    The create-type copy keeps it.
  - **Verified:**
    - `test-pot-skin.mjs` (50 assertions) covers the stand-in rule. A skinned or nested part is no
      stand-in, a meter-scoped decoration never stands in, and an old override gets the field back.
    - `verify-pot-meter-mount.mjs` mounts a stand-in for real: counted in once, `meter:red`
      registered, no pot drawn, counted out on unmount.
    - Storybook: a gold pot whose def has no `Pot` part counts as gold's pot, and `meter:gold` sits
      at the centre of its nodes. The same def without `standsFor` reproduces the trap: not
      counted, no anchor.
- 2026-10-02 — **Phase 12c part 1: a skinnable Pot** (session "Hold and Win Phase 12c skinnable
  parts", #1006). Design §8; contract in Decisions above. Built before 12a/12b merged, as the
  brief allows: the art params and the coded-part plumbing.
  - **Engine (`engine-layout`):**
    - `potSkin.ts` holds the params, `readPotSkin`, the stage body, the fill share and rect.
    - The Pot Meter gains `POT_SKIN_PARAMS`.
    - `<LayoutNodeView>` hands a `bind` container's children to its part as `skin`.
    - The bound catalog's `skin` declaration and `boundComponentSkin`.
  - **Game (`apps/lines`):** `HoldAndWinPot` draws the art (body per stage, the masked fill, the
    frame). It also draws the label style, the motion knobs and the `skin`. `PotMeter` reads the
    skin off its params. Labels go through `CatalogText`, so a bitmap font works.
  - **Editors:**
    - The canvas draws a skinned part's art (fill part-full) and the nodes inside it.
    - `/components` offers **Edit inside ‹part› ›** and **↩ Back**.
    - New create type **Pot Meter (Hold and Win)**.
  - **Guides:** [Component Editor → Skin a coded part](../tools/component-editor.md#skin-a-coded-part)
    and the Scene Editor's Pots paragraph.
  - **Verified:**
    - `test-pot-skin.mjs` passes (43 assertions).
    - Storybook `MODE_HOLD_AND_WIN/skinned pot (12c)`, screenshot through Playwright:
      - The coded red pot is unchanged.
      - The blue pot draws the progress-bar art as its body, fill and frame. The fill tracks the
        level (6/12, then 11/12), the labels are gold, and it grows with its stages.
      - The green frog pot draws only the author's glass, rig and caption, and pulses full.
      - `resolveAnchorPoint('meter:<id>')` lands on each pot's centre.
    - `check:svelte` stays at baseline for engine-layout, lines and the launcher. Lint is clean. The
      launcher builds.
  - **Then 12a merged into the branch:**
    - `meterStage` is shared.
    - The **Pot Meter (Hold and Win)** copy keeps the def's signal scope and is kind-gated.
    - Two frog pots in the story: `__activatePot('green')` reveals only green's
      `hiddenUntilSignal: 'potActivate'` badge.
  - **Review fixes** (code-reviewer):
    - Each art layer sits in an always-mounted slot. pixi-svelte appends a child when it mounts, so
      a fill that first appears at level 1 drew over the frame and the author's nodes.
    - `stageGrowth` is clamped to ≥ 0.
    - Part mode resets on inspect / back to latest.
  - **CI fix:** `scripts/verify-pot-meter-mount.mjs` stubs `PotMeter`'s imports. It now hands it
    the real `readPotSkin` from `potSkin.ts`. Before, the package index loaded the build-generated
    `builtinSpineMeta` and failed on a clean checkout.
  - **Left:** the 12c items in Open items.
- 2026-10-02 — **Phase 12b: value bindings, through the whole pipeline** (#1005; session "Hold and Win Phase 12b value bindings"; contract in
  Decisions above). Generic: any node in any kind. An unbound node renders byte-identically.
  - **Engine (`engine-layout`):** `ValueBinding` on every node; the pure `valueBindings.ts`
    (inputs, mapping, folding, fill rect, frame, scrub, bone) and its fixture
    `test-value-bindings.mjs` (81 assertions); `boundValues.svelte.ts` subscribes the sources and
    glides; `<LayoutNodeView>` folds the transform once and adds the fill mask, the held frame and
    `<SpinePose>`, each branch fixed for the node's life so a value arriving never remounts art.
  - **`pixi-svelte`:** `<SpinePose>` (scrubs + bone offsets on the spine's world-transform hooks,
    chained, unlinked on unmount); the `spineBoneOffset` leaf; `AnimatedSprite` / `Flipbook` hold a
    `frame`.
  - **Sources (`apps/lines`):** `meter.<id>.stage` / `.full`, `respinsStart`, `cellsHeld` /
    `cellsTotal`, `rowsOpen` / `rowsMax`; the coded pot grows by the shared `meterStage`.
  - **Editors:** a **Bind to value** section in Properties (Scene + Component Editor): target, source
    picker (the component's params, the per-instance pot, Hold and Win, game values, custom), divide
    by, in → out, curve, glide, clamp, the per-target fields, and a **test value** previewed on the
    canvas and the text / spine / effect overlays. Draw paths only, so a preview is never written
    into the doc.
  - **Guides:** [Component Editor §3b](../tools/component-editor.md#3b-drive-a-node-from-a-number-bind-to-value)
    and the Scene Editor's *Bind to value*.
  - **Verified:** the fixture; a Storybook story with one pot def placed twice (`red` at 0 → 6,
    `blue` at 3 → 12), screenshot through Playwright: each liquid fills by its own meter, the marker
    rises, the full badge shows on the full pot only, the H1 rig grows by its `global` bone and
    scrubs `h1`, and holds a steady size over many frames (no compounding). A code review then moved
    the scrub off a track entry (a new entry per change replayed the animation's events onto the game
    bus) onto `<SpinePose>`, mirrored the fill mask for flipped clips, and fixed the editor preview
    (a scrub no longer leaks onto the shared rig, the effect overlay repaints, a test value clears
    on deselect). `check:svelte` at baseline for engine-layout / pixi-svelte / lines / launcher, lint clean, `check:path-imports` and
    `check:undefined-names` green, the launcher builds. Not verified: the editor section in a browser
    (it needs the auth-gated launcher).
  - **Left:** the follow-ups in Open items; 12c consumes this (the Pot's fill art through a `fill`
    binding, a frog's bone through `bone`).

- 2026-10-02 — **Phase 12a merged** (#1003, squash `97652ca9`). CI was green on the final head,
  and the Runtime release workflow passed on the merge commit. Not yet checked: the served bundle,
  and the `hw-3pots-sample` live check (Open items).
- 2026-10-02 — **Phase 12a: scoped signals into components** (session "Hold and Win Phase 12a",
  #1003). Design §8.
  - **Engine.** `featureSignals.ts` registers 19 component signals off the beats' existing cues
    (the Hold and Win ones in a Hold and Win game only):
    - **Pots:** `potFill`, `potLand` (a `toMeter:<id>` flight's arrival), `potLevelUp`,
      `potStageUp`, `potFull`, `potActivate` (`potsConsume`).
    - **Respins and coins:** `respinReset`, `respinLast`, `coinLand`, `coinCollect`, `coinBoost`,
      `coinUpgrade`.
    - **Jackpots, letters, wheel, feature:** `jackpotWin`, `platformJackpotWin` (any kind),
      `letterLit` (newly lit only), `wheelSpin`, `wheelLand`, `featureEnter`, `featureExit`.

    `potLevelUp {meter, level, max}` and `potStageUp {meter, stage, level}` are new cues. They come
    from `presentMeterUpdate`, one per landing, and a stage-up whenever a rise crosses a size stage
    (`meterStage`, shared with the coded pot). These beats stamp a typed `scope`: the pot cues
    (`meter:<id>`), the meter flight's `flightArrive`, `respinJackpotWin` / `jackpotCelebration`
    and `platformJackpotCelebration` (`tier:<tier>`), and `respinColumnComplete` (`reel:<n>`).
    `<ComponentInstance>` filters every cue and gate fire by its scope and hands the scope down
    (`componentSignalScopeContext`). `<LayoutNodeView>` passes it to effect players.
  - **Catalog.** `ENGINE_SIGNAL_CATALOG` entries gain `group` / `scope` / `capability`, and
    `engineSignalsForKind` filters them. The Hold and Win families are offered to a Hold and Win
    project only. The builtin Pot Meter is scoped by `meter` as a meter, the Jackpot Tile by
    `source` as a tier.
  - **Component Editor.**
    - The signal picker is grouped by family and kind-filtered, and takes any Flow cue name.
    - Cue signals, **hidden until signal** and the per-placement **Driven by signal** overrides
      are free text with suggestions.
    - A new **scoped by … as a …** picker (param and kind). `/components` now loads the project's
      kind.
    - `componentStorage` keeps `signalScope` / `signalScopeKind` while the param exists.
  - **FX.** `EmitterTrigger.scope`, kept by the normalizer and the plan, with a **Scope** field in
    `/fx` (`*` = every part). A layer with no scope takes its component's scope.
  - **Flow.**
    - Every Fire Cue has an optional `scope` pin. A set pin rides the payload; an unset one leaves
      the payload byte-identical.
    - The game forwards the scope to the open component bus.
    - The Hold and Win vocabulary has the two new cues.
    - The cue harvest walks placed component defs and per-placement overrides, so a cue named
      inside a component is in the Cues palette and passes validation, at publish too. Its
      game-driven exclusion follows the project's kind.
  - **Gates.** New `check:signal-scope`. It covers:
    - the typed rule: cross-kind, `*`, normalising;
    - catalog ↔ registry parity, and the kind-gated registry;
    - each signal's beat and scope;
    - the builtins;
    - the Flow pin, including a cleared literal;
    - both normalizers.

    `check:scene-cues` gained the component harvest and its kind. All 58 flow spikes pass.
  - **Review pass** (code-reviewer on the first push). Fixed:
    - untyped scopes filtered across kinds — a pot never heard a jackpot win;
    - `meter.red.level` scoped as `level`;
    - the family was registered for every kind;
    - a missing `precheck`;
    - an empty scope pin leaked `scope: ''`;
    - cue names were stored untrimmed.
- 2026-10-02 — **Phase 11b follow-ups (ruled by the hub)** (session "H&W Phase 11b — board
  expansion"). Reserving an expanding board's area is one helper in `engine-layout`
  (`reserveExpandingBoard`: the reel grid's cells shrink to fit `maxRows` in the shortest layout
  box, and its board nudge lifts the whole board by half the extra rows — the node never moves; absolute,
  so applying it twice changes nothing). The template uses it; the scaffold and the editor's "Add
  missing screens" pass the stored config's `maxRows`; the editor offers **⇕ Reserve rows for
  board expansion** when the config expands but the reel grid has no room. The coins of unlocked
  rows leaving with the feature is the decided end state (playbook S9). Unlock-symbol art is an
  owner checklist item.
- 2026-10-02 — **Phase 11b merged and live** (#1002, `lines@8fe81dbefddc`, served by
  `hw-3pots-sample` and `bookofborutremake`).

- 2026-10-02 — **Phase 11b: board expansion (rows unlock), through the whole pipeline** (branch
  `claude/hw-11b-board-expansion`; session "H&W Phase 11b — board expansion"; contract in
  Decisions above). A runtime release on merge; nothing new runs unless a config has `expansion`
  (no preset does).
  - **Game Config:** `holdAndWin.expansion` + validator + the `/config` Board expansion panel; role
    `unlock`; fixtures `pots-expansion-fullrow` (MAJOR at 5 rows), `-unlock` (`UNLOCK` symbol),
    `-count` (thresholds 8/12/16, no reset); `respinBoardMaxRows()`.
  - **Mock + wire + facade:** the board grows below the grid per rule (fullRow / unlock symbols /
    held count), `rowsUnlocked` then the unlock symbols' `applied` clear, banked row jackpots, an
    unlock resets the counter (`max(start, left)`) when `resetsRespins`, a full board needs every row
    of `maxRows`, `playedSpin` boards as tall as the open rows, `rows` on the snapshot and
    `expansion {rows, maxRows}` on the trigger and the boot config. Forced beats `unlock:<n>`
    (numeric; `unlock:<special>` is unchanged) and `expandFull`. `check:holdandwin` re-derives every
    expanded round (rows, rule, thresholds, row jackpots, reset) and the preset digests are unchanged.
    The facade clamps a respin board to `maxRows` instead of the grid.
  - **Engine:** `RespinBoard` builds every cell of `maxRows` and spins only the open rows; locked
    cells draw `RespinLockedCell` (coded dark LOCKED panel, or the authored `lockedRow` art);
    `presentRowsUnlocked` — the unlock symbol plays `rowUnlock`, flies into its row (`unlockRow`),
    the locked cells fade under "ROW UNLOCKED · {rows} ROWS", the rows open; a resume's
    `holdAndWinState` reopens the server's rows. **Flow:** event `rowsUnlocked`, action `unlockRows`,
    cue `respinRowsUnlocked`, the seed owns it in the Hold and Win tab. **Symbols:** state
    `rowUnlock` (fallback `win`), flight `unlockRow`. **Win Text:** `feature.rowUnlocked`,
    `feature.rows` — two more strings in every Hold and Win project's /localization (play
    unchanged). **Scene Editor:** kind-gated `lockedRow` component (+ selected preview); the template
    takes `{ maxRows }` and reserves the grown area in every layout. **Game Maker:** "Rows 3→6" chip.
    Storybook `MODE_HOLD_AND_WIN/board expansion` (books generated from the real mock + facade);
    playbook S9.
  - **Verified live, real clock (60 fps, headless shell), desktop + portrait, all three fixtures:**
    80/80 — the board opens 6 rows tall with 15 locked cells, grows by the right rule, never shows
    more rows than the server opened, coins land in the new rows, `expandFull` pays the 6-row GRAND,
    the shown win equals the server's `gameEnd.win`, and a reload with respin 3's answer lost
    reopens the server's 5 rows with 5 cells locked.
  - **Parity:** Borut (`bookofborutremake` live data, local book mock, real clock) — `main` vs this
    branch rebased on `59d12ae6`: identical flow-trace vocabulary and emitter-event set, holds =
    releases, 0 exceptions, 0 errors on both. `hw-3pots-sample` (live data, local Pots mock): 13/13 —
    3 rows, nothing locked, no expansion on the wire, the shown win equals the server's (trigger,
    full board, payer), no page errors. `check:holdandwin`'s preset digests are unchanged.
  - **Code review** (code-reviewer): no blocker; fixed — a non-expanding board keeps the reconciled
    grid's rows, rows open before a streak's clear (an unlock symbol leaves as `applied`), `rows`
    is set on every trigger and cleared at the end, `unlock:<n>` past the unlockable rows is refused.
    Noted, not changed: under `respins.reset: anySpecial` a landed unlock symbol resets like any
    special even with `resetsRespins: false`.
- 2026-10-02 — **Phase 11c part 2: the operator platform jackpot** (session "Hold and Win Phase 11c —
  progressive + platform jackpots"). Kind-independent: any game carries it. The contract was read
  off the partner's client and recorded in `play4fun-protocol.md` § "The operator platform jackpot",
  marked as owing a live confirmation (Checks owed, item 5).
  - **Facade** — reads `platform.jackpots` on every answer (heartbeat included) and publishes
    `__IE_PLATFORM_JACKPOTS__` / `ie:platformJackpots`. A hit
    (`platform.gameRound.jackpot {winJackpotId, win}`) becomes `platformJackpotWin {tier, amount}`,
    placed after the round's own wins (after free spins or the respin feature, before `finalWin`).
    The win is held out of the interim balance and every heartbeat (`lockedPoint`) until
    `__IE_PLATFORM_JACKPOT_RELEASE__`. A new bet drops anything held. A hit is taken only from a
    `play` answer and once per round (an echoed `gameRound.jackpot` is ignored).
  - **Engine** — `platformJackpot.svelte.ts`. The coded celebration is the large jackpot banner (the
    same `jackpotWin` screen step-aside), then the held money is released into the balance. It counts
    as a celebration (re-armed slam, unskippable). The cue is `platformJackpotCelebration`.
    `platformJackpot.<tier>` is a value source and a `$engine` key (money, like `balance`).
    `platformJackpotShow` gates it. A server whose platform runs a jackpot is heartbeated every 30 s
    for the values only (progressive pools are not polled); the balance moves only on an
    operator-declared interval (parity). A flow that owns `platformJackpotWin` gets the held win
    released at the round's `finalWin`.
  - **Scene Editor** — a new **Platform Jackpot Bar** offered to every kind (pinned in
    `test-hold-and-win-template.mjs` as a deliberate new library entry), and the platform sources in
    the jackpot tile's lists.
  - **Win Text** — a `platformJackpot` family (captions per platform tier, banner title, amount),
    stored, pruned and harvested only when authored.
  - **Flow** — the event and cue in the standard vocabulary.
  - **Mock** — `scripts/mock-platform-jackpot.mjs` wraps any mock: a pool per tier per session that
    bets grow and time drifts, and forced hits (`force:platformJackpot:<tier>`, or held by
    `…/platformJackpot?sid=&hit=&when=feature`). It is on with `PLATFORM_JACKPOT=1` (CLI) or a
    project's `hostSettings.mockPlatformJackpot: true` (test server).
  - **Gates** — `check-platform-jackpot.mjs` (byte parity with the bare mock, replays pay once,
    refusals keep the ledger, forcing keeps the round's close) and `platformJackpot.fixture.ts` (25
    checks: book base, book free spins, Hold and Win respin, parity, hold and release, an echoed hit
    taken once; mutants without the hold or the echo guard fail).
  - **Not copied:** their brand gating, the "fake spin" teaser and the take-win button.
  - **Verified live (local):** on the book game the heartbeat moved Grand $5,000 → $5,003. A Grand
    hit held for a free spin was celebrated after the free spins: banner "GRAND JACKPOT $5,010.21",
    balance held at $4,999 through it, then $11,053.21, exactly the server's. Hold and Win (pots):
    a base-game Major hit showed $502.76, then $601.88, exactly the server's.
  - **The Pots effect loop seen while verifying was a real `main` bug,** not the harness. Svelte
    `effect_update_depth_exceeded` at a Pots boot reproduced on `main` too; #998 (a parallel
    session) fixed it — `PotMeter` counting itself in from a tracked effect.

- 2026-10-02 — **Phase 11a follow-up 3 closed: an authored pot no longer loops at boot** (session
  "PotMeter effect loop fix"; a runtime release on merge). `PotMeter.svelte` counted its pot in
  (`trackComponentMount`) from a tracked `$effect`; counting in reads the mount count it writes, so
  every Pots project on the template's `pots` scene raised `effect_update_depth_exceeded` at boot
  and crawled. The call now runs under `untrack`, as `ComponentInstance` and `LayoutScene` do; the
  meter id stays tracked, so a changed `meter` param re-counts. Audited the other authored parts
  (LettersStrip, the wheel part, RespinCellTiles, the `respinCounter` / `jackpotTile` /
  `jackpotBar` builtins) and the coded pots, letters, banner and held cells: none reads state it
  writes. **Guard:** `scripts/verify-pot-meter-mount.mjs` (in `check:all`) compiles the real
  component, mounts it through Svelte's client scheduler on a DOM shim and asserts one count-in,
  re-counts on a meter change (including one at the same index), count-out when the config drops
  the meter or on unmount, and no loop; the old line fails it 6 ways. **Live** (local runtime stub:
  the reference layout + Pots preset config, no project data; Pots mock on a free port; headless
  shell, software GL): before the fix the no-flow boot raised the error and the flow boot crawled
  after tap-to-start; after it, 0 errors either way, and a forced `meter:red` pinned the authored red
  pot, filled it toward the server's 12 (sampled at 12/12 under the flow) and emptied it as the
  feature took it (other pots matched the server). Borut-style parity on the local book mock: a
  spin after a forced big win plays, balances match, 0 exceptions.

- 2026-10-02 — **Phase 11a: add-respins + upgrade specials, through the whole pipeline** (#995;
  session "H&W Phase 11a — add-respins + upgrade specials"; rules in Decisions above). A runtime
  release on merge.
  - **Game Config:** roles + specials `addRespins` / `upgrade` (`AddRespinsSpecial`: whole-respin
    values, `raisesCap`, `sticky`, reels, `landsInBaseGame`; `UpgradeSpecial`: weighted `targets`,
    cash step values, reels, `landsInBaseGame`), the mystery may reveal both, validator errors for
    fractional respins, empty tables, no target rule, a tier rule with under two tiers. `/config`
    editors for both (`HoldAndWinSection.svelte`), the roles in every role picker.
  - **Mock + wire + facade:** both dealt and applied per the rules; forced beats
    `special:addRespins`, `special:upgrade[:all|adjacent|jackpotTier]` (the tier rule also lands a
    MINI; the cash rules land next to a cash coin), `mystery:`/`unlock:addRespins|upgrade`; wire
    events `respinsAdded`, `coinUpgrade`, `cellsCleared` reason `applied`
    ([wire doc](../reference/hold-and-win-wire.md)); the facade maps them to the contract.
  - **Engine** (`holdAndWinPresentation.ts`): `presentRespinsAdded` — the special plays `respinsAdd`,
    its "+N" head flies to the counter (`flyTo` kind `toCounter`, target the new `respinCounter`
    anchor that the coded counter and the Scene Editor builtin both register), the counter steps on
    arrival, a "+N RESPINS" toast; `presentCoinUpgrade` — the upgrader plays `coinUpgrade`, an
    `upgradeBeam` flies to each target, then the labels count to `to` (or a jackpot label switches
    tier under a "{jackpot} UPGRADE" banner, playing `jackpotReveal`). Labels hold their old value /
    tier until the beams land. Coin labels: an add-respins reads `+N`, an upgrade its step.
  - **Flow:** events `respinsAdded` / `coinUpgrade`, actions `addRespins` / `upgradeCoins`, cues
    `respinAddRespins` / `respinCoinUpgrade` (and `respinCellsCleared` now carries `reason`); the
    starter flow wires both beats in the Hold and Win tab. **Symbols:** states `respinsAdd` and
    `coinUpgrade` (fallback `win`), Flights rows `toCounter` / `upgradeBeam` (they ship through
    `bakeFlights`, now asserted for every flight kind by `check:flights`). **Win Text:**
    `respins.added` "+{count} RESPINS", `feature.upgrade` "UPGRADE", `jackpots.upgrade`
    "{jackpot} UPGRADE", and `feature.specialNames` gains "ADD RESPINS" / "UPGRADE" — so every Hold
    and Win project now lists these four strings in /localization (play unchanged). **Game Maker:**
    profile chips "Add respins" / "Coin upgrade". Storybook: `MODE_HOLD_AND_WIN/extra specials`.
  - **Live check** (real clock, GPU headless shell, local stub + `pots-extra` mock; both the coded
    counter on the fallback layout and the authored `respinCounter` + starter flow on the reference
    layout): all six forced beats, 120/120 checks — every `toCounter` head lands on the counter
    anchor (0 px), the counter steps on arrival through the server's exact sequence, beams land on
    each coin then labels count to the server's `to` / MINI → MINOR; the client's picture equalled
    the server's `holdAndWinState` on all 53 respins before the snapshot applied; every win and
    balance matched the mock. **Resume** after each beat (connection cut mid-feature, then reload;
    a plain reload cannot land mid-feature because the facade pre-fetches the round): 13 rounds,
    235/235, a `raisesCap` cap of 6 restored and filled back to. **Parity:** plain Pots
    (trigger, natural, Lucky Spin; coded and flow) byte-identical books, emitter, flow trace and
    balances vs base; **Borut** (`bookofborutremake` live data, local book mock, two free-spin
    rounds a side) identical traces, holds, game-type moments, balances, 0 exceptions.

- 2026-10-02 — **Phase 11c part 1: progressive game jackpots** (session "Hold and Win Phase 11c —
  progressive + platform jackpots"). A `fixed: false` tier is now real instead of paid as fixed with
  a warning. Through the pipeline:
  - **Config** — `jackpots[].progressive {seed, contribution, cap?}` (× total bet). A bare
    `fixed: false` tier normalizes to `{seed: multiplier, contribution: 0}`, which pays exactly what
    it paid before. The validator errors on a cap under the seed and warns on a zero contribution.
    `/config` gets Pool seed / + per bet / Cap columns. No preset gains it: the dev/test fixture
    `HOLD_AND_WIN_TEST_FIXTURES['pots-progressive']` (MINOR/MAJOR/GRAND progressive) exercises it.
  - **Mock** — a pool per tier per session that grows with every bet, caps, pays when won and resets
    to its seed after the play. It is reported in the boot config (`progressive: true, value`), after
    every play and in the heartbeat (`jackpotLevels`), and survives a contract swap.
    `check:holdandwin` §3b pins all of it, plus parity (no pools without a progressive tier).
  - **Facade / engine** — `jackpotLevels` → engine event, recorded into `stateHoldAndWin.jackpots`.
    The boot pools are published (`__IE_HOLD_AND_WIN_JACKPOTS__`), a heartbeat republishes them
    (`ie:holdAndWinJackpots`), and a held jackpot coin is worth the live pool. `jackpot.<tier>` (the
    HUD value source and `$engine` key) reads the live pool via `holdAndWinJackpots.svelte.ts`.
  - **Flow** — `jackpotLevels` is in the vocabulary (no beat).
  - **Docs** — wire doc, guides (Game Config, Flow, Win Text, Invisible Editor).
  - **Verified live** on `pots-progressive` (local runtime stub + mock): the bar moved
    $31 / $100.20 / $2,001 after one bet, a heartbeat refresh moved it, and a forced GRAND paid
    **$2,002.00** (the grown pool, banner `coinJackpot`). After the round the bar read $2,000 and
    the balance matched the server.

- 2026-10-02 — **An undeclared mode plays on the base game type** (session "Hold and Win Phase 4 —
  engine runtime"; follow-up from #965's parity run). While a mode the Game Config does not declare
  was on top of the stack (e.g. the mock's forced `queuedFixture`), `stateGame.gameType` read the mode
  ID — not a game type, so every game-type-keyed screen matched nothing. `stateModes` now resolves
  through `engine-game` `createModeGameTypeResolver`: a declared mode keeps its own game type, an
  undeclared one plays on `basegame` and is warned about once (`[modes] mode "<id>" is not declared
  in the Game Config …`). `basegame` is a built-in mode, so returning to base never warns. Pinned in
  `modeStack.fixture.ts` (a mutant that returns the id fails 2 checks).

- 2026-10-02 — **The facade maps `modeEnter` / `modeExit`** (#965; session "Hold and Win Phase 4 —
  engine runtime") — the last Phase 4 item. A Hold and Win server's `modeEnter {mode, cause,
  policy?, payload?}` / `modeExit {mode, total?}` (wire doc "Modes") pass through to the engine's 4M
  pair; `total` converts from credits to book units, `policy` passes only as `nest`/`queue`, an event
  with no `mode` is dropped. The facade fixture plays the forced `queuedMode` beat: the queued mode
  enters right after `holdAndWinTrigger` and exits right after `holdAndWinEnd`, and the feature is
  never doubled as a mode event (a mutant dropping the mapping fails 5 checks).
- 2026-10-02 — **Authorable respin cell tiles + gap** (session "Hold and Win Phase 4 — polish";
  the hub's item 3 follow-up). New built-in component **`respinCells`** ("Respin Cell Tiles",
  `capability: 'holdAndWin'`): params `tileImage` (image), `tileTint`, `gap` (0–0.45 of a cell). Its
  coded part `RespinCellTiles` draws nothing where it is placed; it hands the params to the respin
  board (`respinCellLook`), which stamps the tile under every respin cell at the cell's seat (row
  scale included), shrunk by the gap, and insets each ROLLING window by the gap (a resting cell
  still draws whole); a gap with no tile image parts the windows over the background. Not placed ⇒
  the coded look. Several instances stack (the newest draws; removing it hands back to the one
  before). The art
  ships through the existing component image-param export (`editorArtExport` collects every
  `image` param of a referenced def — CLAUDE.md rule 8). The Hold and Win template places one on
  the `respinBoard` scene; `test-hold-and-win-template` counts it as a placed, kind-gated piece.
  `resolveFrameArt` (engine-layout) is the shared frame-ref → texture-key resolver (the reel grid's
  tile uses it too). Verified on a real clock with looks claimed in the page (tiles under every
  cell incl. held coins, tint, gap, inset rolling windows; two claims handing over on release, none
  left after both; 0 exceptions); a project-authored
  instance is not yet seen live (no project places one).

- 2026-10-02 — **Polish 2** (session "H&W polish 2 — spin profile, jackpot beat, boost beam"; #980,
  launcher + docs, not a runtime release). Items 1–3 of its handoff had already shipped as #979
  (built in parallel). What this session added:
  - **`/symbols` lists the Boost beam row.** It was hidden until authored because nothing flew it.
  - **#979 confirmed on a CLASSIC mock**, real clock (GPU headless shell, 60 fps, local mocks, the
    engine's fallback layout plus a preset config from a local runtime stub — no project data).
    `trigger,special:multiplier`: two BOOSTs fired 3 and then 4 `boostBeam` flights, each landing with
    its `flightArrive`. An authored slow spin profile (speed 1, padding 2) made each respin roll
    take 3.79–3.80 s, against 1.10 s before #979, when only the base spin slowed. Pots
    `trigger,fullBoard`: the banked GRAND was written 856 ms after the last coin (the bar's 500 ms
    count plus the 350 ms beat).
  - **Item 4 (the feature-entry idle frame): not reproduced** off the sample's art — finding in
    Open items.

- 2026-10-02 — **Phase 4 polish, hub extras (a)–(c)** (session "Hold and Win Phase 4 — polish"):
  (a) the respin cells merge the editor's authored reel spin feel (`resolveReelSpinProfile`, now one
  accessor `stateGameDerived.reelSpinProfile` that the base reels use too) over the coded options —
  unauthored = the coded constants, as before; (b) the banked jackpots' 350 ms beat in the feature
  end now starts after the last coin's 500 ms bar count has landed, so it is seen; (c) a multiplier
  (`coinBoost` with a booster) fires a `boostBeam` flight to each coin it boosts — the coded glow
  unless `/symbols` authors one — and the counts start once the beams land (seen live on
  `hw-3pots-sample`, `special:multiplier`).

- 2026-10-02 — **Phase 4 polish, hub follow-ups on item 3** (session "Hold and Win Phase 4 —
  polish"): a RESTING respin cell's mask opens to three cells, so landed art draws whole like the
  reel board's (only the window's symbol exists at rest); while it rolls the mask stays the cell.
  The coded counter stays on screen in portrait (pulled onto the top row when the board's top is at
  the canvas edge — seen on `hw-3pots-sample`). The tile/frame + gap is a recorded follow-up (Open
  items). Rolling cells already play an authored `spin` state.

- 2026-10-01 — **Phase 4 polish, item 9: a flight ARC knob** (session "Hold and Win Phase 4 —
  polish"). `flights.<kind>.path.arc` (field recorded in Decisions, Phase 4 polish): `planFlight`'s
  preferred route bows by it with nothing in the way — so the feature-end volley can arc — and
  avoidance still detours around a win cell on it. Absent ⇒ every route as before (fixture-pinned).
  Authored in `/symbols` → Flights ("Arc", beside "Max detour"); detail in [symbols](symbols.md).
  **Not yet seen live:** no project authors an arc; set one on `hw-3pots-sample` once the launcher
  is deployed (its strict `path` schema refuses the field until then).

- 2026-10-01 — **Phase 4 polish, part 2: the random metre beat and the undrawn Win Text lines**
  (session "Hold and Win Phase 4 — polish").
  - **Random metre** (`randomMetreTrigger`, Grand's Diamond Metre / Hotfire's Extra Bonus Game) has
    a coded beat, `presentRandomMetreTrigger`: a small banner with the config's metre name over the
    base board while the coins it ADDED play `coinStick`, 1.6 s, then the trigger. Flow effect
    `fireRandomMetre` (base graph, `HOLD_AND_WIN_BASE_CHOREO`), cue `randomMetreFire {name, cells}`.
    `meterLevels` is now the only event left on a sync-only handler.
  - **Win Text draw sites:** the respin counter reads `respins.award` as the feature opens (until
    the first respin rolls), `respins.reset` while a reset pulses and `respins.last` at 1 left (an
    empty one falls back to `respins.counter`); the coded banner shows `feature.total` over the
    board once the Total Win bar has landed, `feature.meterFull` as a base-game pot fills, and
    `feature.intro` / `feature.outro` only when authored non-empty (their defaults are empty — the
    references show nothing there). `{count}` = respins for `award`/`reset`/`last`/`intro`;
    `{amount}` = the feature total for `total`/`outro`; `{meter}` = what the pot activates.
    New banner kinds `randomMetre`, `meterFull`, `featureIntro`, `featureTotal`, `featureOutro`;
    `HOLD_AND_WIN_BANNER_SCREENS` steps the coded banner aside for an authored `featureIntro` /
    `featureOutro` screen.
  - **Slam-proof:** the base-game and entry banners (random metre, pot full, intro) hold for the
    slam's message hold when slammed (`holdBanner`), as the instant-collect banner does; the end's
    total / outro run inside the celebration window, so an authored outro adds 1.6 s to the locked
    end.
  - Verified on a real clock against the local mocks: Pots `meter:red` drew "Payer ACTIVATED",
    "3 RESPINS", "LAST RESPIN", "RESPINS RESET" and "BONUS WIN $52.00" at their beats, in the
    sample's authored copy where it has one; Classic `trigger:randomMetre` drew the "Diamond Metre"
    banner, then the feature; 0 exceptions. `check:all` covers it in `flow-spike:v2holdandwin`
    (a forced Classic random metre now runs through the seed).

- 2026-10-01 — **Phase 4 polish, part 1: the respin board's timing, hitch, strips and end state**
  (session "Hold and Win Phase 4 — polish"; branch `engine/hw-phase4-polish`). Measured on a real
  clock (headless GPU shell, 61 fps, local Hold and Win mock, `hw-3pots-sample`), before → after:
  - **Counter with the board.** The counter and the board already flipped in the same frame, but the
    board was SEEDED from the trigger board, so it only looked swapped when the first respin rolled
    (+516 ms `TRIGGER_HOLD_MS` + the first-roll hitch ≈ 0.6–0.7 s). The board now mounts blank under
    the held coins (`respinSeedBoard` lost its `seed`/`held`), so coins-on-empty shows with the
    counter.
  - **Per-respin hitch.** CPU profile: every hitch frame was Svelte creating an `{#each}` block per
    symbol of every cell's ~20-long strip (`RespinCell`). Only the symbols near the window are
    mounted now. Before: 83 ms on the first respin, 50 ms on the next two (every respin start);
    after: no JS hitch — the 0–2 frames > 40 ms left per feature profile as main-thread IDLE (GPU-side
    first uploads / compositor), not script.
  - **Cropped rolling cells.** The cell geometry was right (each rests on its window centre); the
    cells rolled the RGS's GENERATED in-play strip — every base picture once — sliced by the one-row
    window at every row edge. They now roll the config's authored `respin` strips (blanks, coins,
    specials), as the design intended. Decision: no tile frames / cell gaps / blur in the coded
    default; a coin rolling past still shows partly, as in the references.
  - **End board.** The feature-end beat settles the (hidden) reel board on the feature's final board
    — each held coin on its seat, blanks elsewhere (`settleReelsOnHeldCells`, a `boardSettle`) — and
    clears AND forgets the trigger spin's wins before the swap back (a `winPresentationForget`
    emitter event handled by `EnableGameActor` — importing the win cycle from the beats closes an
    import cycle that threw a TDZ error at boot), so the big win plays over the board the feature
    ended on, after a snapshot resume too, and the resting cycle cannot replay the trigger's lines.
    Per-reel row counts (`rowsForReel`).
  - **Tally, then hide.** The bar counts 500 ms to each value it is handed (`HudReadout`), and the
    board hid 500 ms after the last write. It now waits `TALLY_LAND_MS` 500 + `TALLY_HOLD_MS` 700:
    the bar read $20.00 ≈ 600 ms before the board hid (screencast).
  - Parity: `bookofborutremake` free-spin round on the local book mock, branch vs `main`, real clock:
    same screen order, holds and gameType moments, 0 exceptions / errors on both. A runtime release.

- 2026-10-01 — **Phase 5 merged (#960), live as `lines@ef2ca06bed2a`.** Rebased onto `main` after
  #959/#963/#966–#968 and re-verified before the merge: `v2holdandwin` 160, `check:all` 336/336,
  `check:flow-publish-gate`, svelte-check `apps/lines` at baseline, lint; a Borut parity round (local
  book mock, SPIN after big wins) and a `hw-3pots-sample` seeded-flow smoke (own mock port, four forced
  beats) both clean. The `Runtime release` run succeeded; `bookofborutremake` and `hw-3pots-sample`
  both serve `X-Runtime-Release: lines@ef2ca06bed2a` with the released bundle, no game pinned.
  A live round against the production test server was not run from the merging session.

- 2026-10-01 — **Phase 9b part 1: a `holdAndWin` project's symbols are seeded at scaffold** (#969,
  launcher deployed; session "H&W Phase 9b — symbols seed + samples"). Part 2 (create, publish and
  play the Classic + Collector samples) stopped: the session cannot sign in to the launcher — see the
  Owner checklist. `scaffoldProject` now writes
  `<client>/<project>/symbols/symbols.json` for a `holdAndWin` project with no symbols doc:
  `holdAndWinSymbolsSeed()` takes every symbol of the STORED Game Config that carries a Hold and
  Win role (not `blank`) and copies its `symbolDefaults/holdAndWin.json` cells, type / assetKey /
  animationName only (Pots: BONUS JACKPOT BOOST COLLECT MULTI MYSTERY; Classic: BONUS JACKPOT
  BOOST; Collector: BONUS JACKPOT COLLECT). Create-only (`If-None-Match: *`, a concurrent save
  wins); other kinds write nothing new. Reading the stored config makes `/admin` **Rescaffold**
  the backfill for an older project (seeded from whatever config it has authored). **Reset to
  preset** in Game Config does not re-seed. `check:project-scaffold` 4 → 9 cases (each preset binds
  every role symbol cell-for-cell; a lines project — even one whose config carries coin roles —
  gets none; Rescaffold backfills; an existing / concurrently-created doc is never overwritten),
  5 mutants planted, all killed. Guide: [game-maker](../tools/game-maker.md) (Create step + trap).
- 2026-10-01 — **Phase 9a: Game Maker preset picker + Classic/Collector playbooks.** **Create a
  game** shows a **Preset** dropdown for Hold and Win (Pots / Classic sticky / Collector streak);
  `scaffoldProject(…, { holdAndWinPreset })` → `gameConfigSeedFor(gameType, preset)` seeds that
  preset through #956's create-only seed instead of the default Pots. Win Text is not seeded (its
  empty doc means the engine defaults). **Correction (9b):** 9a also left Symbols unseeded on the
  claim that they "resolve by kind" — wrong: `symbolDefaultsFor` feeds only the `/editor`,
  `/symbols` and `/win-text` pages, so such a project drew no coin art; 9b seeds them. Guides:
  [game-maker](../tools/game-maker.md) (Create step + trap), [game-config](../tools/game-config.md).
  Playbooks: [hw-classic-sample](../playtest/hw-classic-sample.md),
  [hw-collector-sample](../playtest/hw-collector-sample.md) — both projects **not created yet**
  (the session had no launcher login). Verified offline: each preset's seed passes
  `prepareGameConfigDoc` with 0 warnings and carries its `holdAndWin` block.
- 2026-10-01 — **Phase 7 merged: Symbols SM for Hold and Win** (session "Hold and Win Phase 7 —
  Symbols SM"; #950, #955, #957, #961, #963 — each a runtime release; live as `lines@bf0e5932ac30`,
  launcher deployed). What landed (detail in [status/symbols](symbols.md)):
  - **7a #950** — eight Hold and Win symbol states with fallbacks that replay Phase 4's coded beats;
    the respin board and every beat (incl. 4f's) request them; grid columns, Book VFX / Stacked /
    Explosion pattern / Transition sections and the Scene Editor state pickers gated through new
    `kindCapabilities` flags (`bookSymbolVfx`, `tumblePattern`, `symbolTransition`) and
    `symbolStatesForKind`; role chips from `special_properties`; `symbolDefaults/holdAndWin.json`;
    `check:symbols-kind-gating`.
  - **7b #955** — the `coinLabel` doc block (style, cash format, per-tier jackpot text/style,
    placement, land/boost pops, count-up length) through export → both bake paths →
    `bakedCoinLabel()` → `CoinLabel.svelte`; `check:coin-label`.
  - **7c #957** — the `flights` doc block per flight kind (`toTotal`, `toCollector`, `toMeter`,
    `toMeter:<id>`, `boostBeam`): head, `/fx` trail as a moving emitter, arrival effect, path, timing;
    every `flyTo` call resolves `bakedFlights()` field by field; head art and effects ship; a flight
    preview in `/symbols`; `flightPath.ts` moved to `engine-layout`; `check:flights`.
  - **#961** — forward-compatible symbols doc (finding above). **#963** — held coin labels no longer
    draw black; a `blank` is not reported missing; two `/symbols` hints corrected.
  - **Verified:** every PR's gates (`check-all` 332/332, svelte-check at baseline, eslint) and a code
    review per part. `bookofborutremake` parity on a real clock, seeded local mocks, branch vs main,
    twice (Phase 7 combined, then #963): flow trace (32 base + 243 free-spin lines), RGS exchanges,
    holds, gameType moments, win frames and balances identical, 0 errors. Live on `hw-3pots-sample`
    (authoring path, real clock): the authored label renders (size 0.36, +0.18 offset, ×1.1, the 1.5×
    land pop, "MINI!" in its tier tint); toMeter heads pink ×1.4 and ~1.6× slower, toTotal heads ×1.6,
    stagger 146–167 ms (coded 70), durations matching speed 0.6 / max 1600 to within 25 ms; toCollector
    heads green; balances = the mock. Re-checked on the served `lines@bf0e5932ac30`: every held label's
    glyph fill white in all 66 samples of a `trigger,jackpot:MINI` feature (rolls, sticks, the count-up),
    the seeded symbol art under the labels on both boards, no `[game-config]` error (only a
    `[symbols]` warning that BLANK has no art, by design), 0 exceptions, balances = the mock. The
    placeholder scatter art has "SCATTER" baked in and sits under the coin value — real art is the
    owner's.
- 2026-10-01 — **Scaffold config seed, mock end-of-feature counter, `modeEnter`/`modeExit` on the
  wire** (#956). (1) `scaffoldProject` seeds a `holdAndWin` project with `gameConfigSeedFor` = the
  Pots preset (other kinds untouched); Publish warns on a Hold and Win project without the block;
  `pnpm --filter launcher-api check:project-scaffold` (4 cases, mutant-tested). (2) The mock's
  feature-ending respin says `left: 0, reset: false`; `check:holdandwin` checks it on every round, on
  the `fullBoard`/`letters` beats, and with a planted old-shape round. (3) Forced `queuedMode[:<id>]`
  beat emits the generic mode pair; wire doc "Modes" section.

- 2026-10-01 — **Hold and Win writes `gameType: 'respin'`** (session "Hold and Win Phase 4 — engine
  runtime"). `HOLD_AND_WIN_KEEPS_GAME_TYPE` is gone (`engine-game` `modeEvents.ts`): the mode layer
  writes the Hold and Win mode's declared game type, `respin`, when the feature enters (before the
  trigger beat) and the one underneath when it exits (after the end beat), like any non-alias mode.
  What reads it during the feature: `Background.svelte` shows the feature background (#951), the
  `baseGameShow` / `freeGameShow` bool sources both read false, and the flow's `gameType` value reads
  `respin`; the free-spin paths (`'freegame'` checks) and the base reveal (whose `gameType` comes from
  the book) are unchanged, and the respin board already rolls `paddingReels.respin`. Pinned by
  `modeStack.fixture.ts` (fails against the old flag). Known edge, same as free spins: `playBet`'s
  stack reset is silent, so a round that throws mid-feature leaves `respin` until the next reveal.
- 2026-10-01 — **Phase 8 merged (#946 + #954).** Live: `lines@6755b46c233e`, launcher deployed; prod
  `/api/editor/runtime` now carries `hw-3pots-sample`'s authored `winText` (before #954 the strict schema dropped
  it). Checked live on the sample (authored strings + a defaults control) and Borut parity, both on the final HEAD.
  Left for others: the 7 undrawn templates (respins award/reset/last, feature total/meterFull,
  intro/outro) want a Phase 6 source or a beat; the wheel copy is unverified live (no sample has a
  wheel); `hw-3pots-sample`'s symbol map lacks its Hold and Win symbols (Phase 7 data); players see
  the copy after a Re-publish.

- 2026-10-01 — **Phase 8 part 2: the presentation reads Win Text** (#954, live as
  `lines@6755b46c233e`). Every row of "Win Text literals for Phase 8" but the coin labels
  renders through `apps/lines/src/game/holdAndWinText.ts`; new templates for the 4f lines (raised
  collector, pot label, wheel) and name maps (collector levels, pots). Defaults = the old literals.
  `hw-3pots-sample` has an authored `win-text.json` for the live check. Details: [win-text](win-text.md).

- 2026-10-01 — **Phase 6: Scene Editor template + components** (#951, runtime `lines@4f9c68b8a1f2`,
  launcher deploy green). One `holdAndWin` scene set (`referenceLayouts/holdAndWin.ts`) + template for
  Grand, Hotfire 3×3 and 3 Pots; no free-spin / `specialBook` screens.
  - **Screens:** `jackpotBar`, `pots` always shown; `basegame` carries the `infoBar` **message host**
    (it stays mounted under the respin board, so it serves the feature too). Mode screens (`mode` /
    `holdAndWin`): `respinBackground`, `respinBoard`, `respinCounter` (+ modifiers), `totalWinBar`,
    `letters`, `wheel`, `featureIntro`, `jackpotWin`, `featureOutro`; `luckySpin` is base game.
    The five beat screens (intro, outro, wheel, Lucky Spin, jackpot win) are RESERVED in
    `Game.svelte`: only a flow shows them. `jackpotBar` is deliberately NOT mode-tagged — every
    reference shows it in the base game.
  - **Components** (`capability: 'holdAndWin'`, palette-only gate `componentOfferedForKind`):
    respinCounter, jackpotTile, jackpotBar, totalWinBar, potMeter, lettersStrip, wheel. Coded parts
    `PotMeter` (reuses `HoldAndWinPot`), `LettersStrip` (reuses `HoldAndWinLetter`),
    `HoldAndWinWheelPart` (shares `HoldAndWinWheelArt` with 4f's wheel, spin included).
  - **Sources:** `featureTotal` (the HUD win meter; Phase 5's flow value is `featureWorth`),
    `jackpot.<name>` (× bet), `holdAndWinBanner(+Detail)`; visibility `luckySpinShow` /
    `jackpotWinShow` (banner `kind`).
  - **Step-aside is MOUNT-driven** (`engine-layout` `isComponentMounted`, `sceneMountKey`): the coded
    counter, pots (per meter), letters and wheel yield while an authored twin component is mounted; the
    coded banner yields per beat while the authored `luckySpin` / `jackpotWin` SCREEN is mounted
    (`HOLD_AND_WIN_BANNER_SCREENS`). Unmounted ⇒ coded defaults exactly as before — which is the
    state today, until Phase 5's seed shows these screens.
  - **Background:** `respin` shows the feature backdrop (inert until the flag flips).
  - **Parity:** `packages/engine-layout/scripts/test-hold-and-win-template.mjs` hash-pins every other
    kind's scene set, template and pre-existing builtin def; bookofborutremake played full free-spin
    rounds locally on the branch (0 errors).

- 2026-10-01 — **Phase 8 part 1: Win Text families + gating** (branch `claude/hw-phase8-win-text`).
  `WinTextDoc` gains `jackpots` / `respins` / `feature`, with defaults equal to the presentation's
  literals where it draws one (six fields are new copy with no draw site yet); `/win-text` shows them only for `holdAndWin` and hides `toast.expanded` without
  `bookReveal` (Free spins without `freeSpins`); win-level rows come from the config's big tiers;
  Localization harvests the families for Hold and Win projects only. Both bundle paths ship the
  normalized doc, so the new keys reach the game (fixture-pinned). Every real `win-text.json` in R2
  normalizes and harvests byte-identically. PR #946. Left: part 2 (the presentation reads the
  templates) — the call-site map is in Decisions & findings. Details: [win-text](win-text.md).

- 2026-10-01 — **Phase 4 (engine runtime) build complete** (session "Hold and Win Phase 4 — engine
  runtime"). Merged in order, each a runtime release verified by `X-Runtime-Release`: 4a contract
  #928 · 4b facade + coin labels #931 · 4c respin board #934 · resume through the snapshot #938 · 4d
  specials + mystery #939 · flights #942 · 4e pots, Lucky Spin, feature end #943 · 4f Grand + Hotfire
  #945 (live `lines@e4bca6077db0`). Every PR had a code review and a real-clock live check: Borut
  parity (balances = RGS, spin button live, no new console errors) plus forced beats on
  `hw-3pots-sample`; #943 was merged on the owner's order before its live check finished, and the
  check then passed on the merged code. Coordination: the Win Text literals are listed above for
  Phase 8; Phase 7 owns the coin-label and flights authoring on top of the coded defaults (kind keys
  `toTotal`, `toCollector`, `toMeter:<id>`).
- 2026-10-01 — **Phase 5: the Hold and Win flow vocabulary + driven seed** (session "Hold and Win
  Phase 5 — flow vocabulary + driven seed", branch `flow/hold-win-5-vocabulary`, stacked on #945 —
  merge after it). `engine-flow-v2` `HOLD_AND_WIN_VOCAB` (standard minus free spins and stacked
  pictures; the 20 events field-for-field, 18 backed beats + `flyTo`, 27 cues, the `$engine` values
  `respinsLeft` / `respinTotal` / `featureWorth` / `activeModifiers` / `jackpot.<tier>`) and
  `HOLD_AND_WIN_DRIVEN_SEED_DOC`: the base game, Lucky Spin, pots, instant collect and base jackpots
  in the global graph; every respin-board beat (trigger, wheel, respins, specials, mystery, letters,
  jackpots, end) in `modes.holdAndWin`; Mode trigger (enter) starts the feature music and On all
  modes finished brings the base music back. `holdAndWin` is no longer an alias of `lines`.
  - **Proof:** flow-spike `v2holdandwin` (142 checks: payloads read off `HoldAndWinEventFields` by
    the TS checker, every registered vocabulary backed by the game's effects / emitter / engine keys,
    the seed played from the real mock through the facade across every preset's forced beats),
    `check:flow-publish-gate`, existing vocabularies and seeds byte-identical to `main`.
  - **Live play** (headless real clock, `apps/lines` of this branch on the local pots mock, the
    project's published data, the seed injected as `__IE_FLOW_V2_DOC__`): 11 forced rounds —
    `trigger`, `trigger,special:payer`, `special:multiplier`, `special:collector`,
    `mystery:jackpot:MINI`, `unlock:payer`, `meter:red`, `lucky`, `fullBoard`, `chain`,
    `jackpot:MINI` — all ran every Hold and Win beat through the flow (mode enter / exit / all
    finished each round), ended idle, 0 exceptions, every balance = before − stake + win. The only
    waits are the big-win count-up's taps, identical under the project's published flow.
  - **Existing projects keep their stored flow.** `hw-3pots-sample` was scaffolded on the Book-of
    seed (`templateId: 'bookOf'`), which owns only `reveal` / `setWin` / `setTotalWin`, so its Hold
    and Win events stay on the coded path (same presentation). Only a project scaffolded from now on
    gets the Hold and Win seed; re-seed the sample to author it in `/flow-v2`.
  - **The Phase 6 screens** (after #951): `jackpotBar` + `pots` from boot, the five mode screens
    from the Mode trigger (enter → exit), and `luckySpin` / `wheel` / `jackpotWin` framing their beat
    — pinned by `v2holdandwin` (156 checks) and the publish gate against the template. Live on
    `hw-3pots-sample` (4 more forced rounds): the trace shows exactly that sequence, 0 exceptions,
    balances right. That project predates the template (no such scenes), so its coded banners still
    draw — the step-aside only fires when an authored screen actually mounts. Not seen as pixels: a
    project scaffolded on the template (none exists yet).
  - **Borut parity** (`bookofborutremake`'s published data and flow, local book mock forcing free
    spins, headless real clock, this branch vs its base = #945's head, same driver): three features
    each, every one basegame → freegame → basegame and back to idle; the same 18 flow actions used;
    every intro / outro / big-win hold released; 0 exceptions; every balance = before − stake + win
    on both. RNG differs per run, so the comparison is structural.

- 2026-10-01 — **Phase 4, step 10: Grand + Hotfire** (branch `engine/hold-win-4f-grand-hotfire`, on
  `engine/hold-win-4e-pots-lucky-end` / #943; no PR yet). One function per beat in
  `holdAndWinPresentation.ts`, each with a coded handler, a flow effect and cues:
  - **Column letters** (`lightLetter`, `columnComplete`): a coded "G R A N D" row above the respin
    board from `boardEnd.letters` (`HoldAndWinLetters`/`HoldAndWinLetter`, mounted only while the
    board is up on a `columnLetters` config). The letter lights and pulses with its column; a cleared
    column's coins fly to the Total Win bar, which counts up by the column's amount, and the cells play
    `clearReel` and go. Cues `respinColumnComplete`, `respinColumnStep`.
  - **Instant collect** (`instantCollect`, `coinInstantCollect`, base game): specials and coins
    light on the base board (padded row = visible + 1), each coin flies into its nearest special
    (`toCollector`), then "INSTANT WIN ×3 $12.00"; the round's own win presentation follows. Cue
    `instantCollectWin`.
  - **Streak collect by flight:** `presentCollectStep` flies each coin into its collector
    (`flyTo(cell, collector, 'toCollector')`); the collector's label rises on each arrival.
  - **Jackpot factor step:** a jackpot coin a boost multiplies steps `MINI` → `MINI ×2` on its turn
    and lights, instead of waiting among the counting coins.
  - **Wheel** (`spinWheel`, `holdAndWinWheel`): a Graphics wheel of the config's prizes
    (`HoldAndWinWheel.svelte`, flights band, zIndex between the flights and the banner, which moved
    to 2), 4 turns in 3.2 s with a quartic ease onto the server's `index` (`engine-game`
    `holdAndWinWheel.ts`), then "COIN BOOST ×2 / EVERY COIN ×2" or "+1 COLLECT / DOUBLE COLLECT";
    the counter's line reads "DOUBLE COLLECTOR". Cues `wheelShow`, `wheelSpin`, `wheelLand`.
  - **Verified:** `check:engine-game` 9/9 (new `holdAndWinWheel` fixture: every index of 1–12
    segments lands centred under the pointer, turn bounds, wrap, labels, `cellWorth`, a column's
    split; two planted mutants fail it), `check:holdandwin` (820 facade checks), `gen:flow-vocab:check`
    (86 events, 60 effects), `pnpm lint`, svelte-check at baseline and completed (apps/lines 165,
    engine-game 38), `check-all` 324/324. Storybook from `C:\IW-4f2` on a real clock (GPU headless
    shell): `MODE_HOLD_AND_WIN/grand` (classic mock: `letter`, `letters`, `special:multiplier` with a
    MINI, `instant`) and `MODE_HOLD_AND_WIN/hotfire` (collector mock on a 3×3 window: `trigger`,
    `chain`, `wheel:extraCollect`, `wheel:coinBoost`, `wheel:jackpot:GRAND`), books in
    `stories/data/hold_and_win_grand_hotfire_books.ts`. Every story's bar ended on its feature total
    (3400, 103900, 6200, 1200, 4600, 8800, 2000, 2000, 101000), 0 exceptions. `letters`: G-R-A-N-D
    lit in turn, the bar stepped 800 → 1300 → 2100 → 3000 → 3900 as 15 coins landed, the GRAND
    banner with the button locked, the GRAND joined at the end → 103900. `chain`: 12 coins flew into
    the double collector, 11 clears. Wheel: landed on index 0 / 1 / 6 at exactly 4 turns; slammed
    mid-spin (`roundSkip.skip()` at 2.2 s) it landed on the same rotation within one frame, then held
    the segment and the banner about 700 ms each.

- 2026-10-01 — **Phase 4, steps 6–8: pots, Lucky Spin, full board + feature end** (branch
  `engine/hold-win-4e-pots-lucky-end`, off `engine/hold-win-flights`). Coded default presentations,
  each beat one function in `holdAndWinPresentation.ts` shared by its coded handler and a flow effect:
  - **Pots** (`fillMeter`, `meterUpdate`): boot levels from the facade, seeded at game start; coded
    pots above the board (`HoldAndWinPots`/`HoldAndWinPot`: one bar per config meter, "RED 10/12",
    what it activates, a size step per `sizeStages`, a pulse when full or consumed). Each special in
    `from` lights on the base board and flies into its pot; the pot ticks a level per arrival and
    pulses when the update filled it. Cues `potFill`, `potFull`; value sources `meter.<id>.level` /
    `meter.<id>.max`.
  - **Entry with modifiers** (inside `showRespinBoard`, `holdAndWinTrigger` `cause: 'meter'`): the
    consumed pots drain to empty, "PAYER ACTIVE" toasts, then the board swaps; the respin counter
    shows the active modifiers under it ("MYSTERY · COLLECTOR · PAYER", following mystery unlocks).
    Cue `potsConsume`; value source `activeModifiers`.
  - **Lucky Spin** (`playLuckySpinIntro`, `luckySpin`): a "LUCKY SPIN" banner holds 1.6 s,
    unskippable; the reveal it arms anticipates on every reel and runs unskippable. Cue
    `luckySpinIntro`.
  - **Jackpots** (`showJackpotWin`): a banked jackpot (full board, letters, wheel) is a held
    celebration banner "GRAND JACKPOT / FULL BOARD $2,000.00" (a full board also lights every held
    cell), slam re-armed and button inert; a coin jackpot named in the tally lights with a small
    "MINI $15.00" banner, slammable. Cue `jackpotCelebration`.
  - **Feature end** (`hideRespinBoard`): the coins fly to the Total Win bar and the bar counts up per
    arrival by that coin's amount, the banked part last, landing exactly on the feature total; then
    the round's `setWin` / `setTotalWin` as before. A celebration (re-armed, button inert). Cue
    `respinTallyStep {index, amount, total}`.
  - **Verified:** `check:engine-game` 8/8 (new: the meter-cause reducer case; `tallyCountUp` lands
    exactly for in-order, out-of-order, short and over-rounded amounts), the facade fixture (boot
    meters published for pots, absent for classic/collector; a planted no-publish mutant fails 10
    checks), `check:holdandwin`, `gen:flow-vocab:check` (80 events, 57 effects), eslint, svelte-check
    at baseline (apps/lines 166, engine-game 38, completed), `check-all` 322/322. Storybook
    `MODE_HOLD_AND_WIN/pots` from `C:\IW-4e` on a real clock (headless shell, GPU): four books
    recorded from the pots mock through the real facade (`meter:red`, `lucky`, `fullBoard`,
    `jackpot:MINI`). `meter:red`: two heads fly into RED, 10 → 12 and a pulse, three into BLUE 0 → 3,
    RED drains 12 → 0, the counter shows "MYSTERY · COLLECTOR · PAYER", the tally steps the bar 150 →
    250 → 450 = the total. `lucky`: banner up with the button locked, the reveal holds reels 1–4 in
    turn (`01000` → `01111`) with the button still locked; 85 of 129 spammed presses refused (intro,
    reveal, end), the respins in between slammed, and the tally still landed on 1700. `fullBoard`: the
    GRAND banner with every cell lit, button inert; 15 coins step the bar to 4000, then the GRAND
    joins 366 ms later at 204000 = the total. `jackpot:MINI`: the MINI coin lit with its small banner,
    button live; the bar lands on 4350. A free-spin bonus story plays with no pots, no banner and no
    lock.

- 2026-10-01 — **Phase 4, step 9: flights** (branch `engine/hold-win-flights`, off
  `engine/hold-win-4c-respin-board`). A head that travels from a cell to a target, leaves a trail and
  fires `flightArrive {flight, target, index}` on impact (design §4.4).
  - **Route** (`engine-game` `flightPath.ts`, pure): one cubic Bézier; candidates are straight, bend
    left/right at 0.2/0.35/0.55 of the distance, then an over-route whose apex clears the highest
    obstacle. The FIRST candidate whose 48 samples miss every padded obstacle wins (the order is the
    order of growing detour); none clean ⇒ fewest hit samples, then shorter, then earlier. An
    obstacle around the source or the target is ignored. `flightDuration` (distance / speed, clamped),
    `flightStagger`, `flightEase`. Pinned by `fixtures/flightPath.fixture.ts` (14 checks).
  - **Runtime** (`apps/lines` `flights.svelte.ts`): `flyTo(from, to, flight, {avoid, index, stagger,
    padding})` → a Promise resolved when the HEAD lands, after the cue. Ends: a global point, a cell
    `{reel,row}` (the board's seats), a layout node id, or `'total'` (the win meter, falling back to the
    board's bottom centre). Routes are planned in the flight layer's local space; speed is in BOARD
    units (1.1/ms, 350–900 ms), stagger 70 ms. A slam runs the flight clock 4× (stagger included) and
    never skips an arrival; an unskippable presentation keeps the pace. No layer mounted / no board ⇒
    the flight lands at once and still fires its cue.
  - **Layer**: `FlightLayer.svelte`, one unconditional container at `LAYER_BAND_FLIGHTS` (8500, new in
    `engine-layout` `layerOrder.ts`) — above the board, the HUD and the win line (a head lands ON the
    meter), below the pinned celebrations. Idle it holds two transform-only containers (the board's
    space, so a cell resolves while the reel board is hidden) and draws nothing.
  - **Look** (`engine-game` `flightGlow.ts` + `FlightView.svelte`): a radial-gradient glow generated
    once on a canvas (head, gold tint, additive) and the shared `constants-shared` `trail` config in
    gold as the trail, cell-sized from the board's scale. On arrival the head goes, `emit` turns off,
    and the flight unmounts after the trail's max particle lifetime (`emitterSecondsToWallMs`).
  - **Trail mechanism**: `pixi-svelte` `ParticleEmitter` gained an `ownerPos` getter (details in
    [status/engine](engine.md)); `EffectPlayer`/`EffectLayer` forward it to FREE layers for Phase 7's
    authored trails.
  - **Targets**: new `pixi-svelte` named anchors (`<Anchor name>` / `resolveAnchor` /
    `resolveAnchorPoint`). `LayoutNodeView` anchors every bind / container / componentInstance node by
    its id, the coded HUD's `LayoutEditable` anchors its component instances, and the win readouts
    (`LabelWin`, `HudValue`/`HudReadout` with source `win`) anchor `hud-win` — what `'total'` resolves.
  - **Uses**: the feature end (`holdAndWinFlights.ts` `flyCoinsToTotal`, called from
    `presentHoldAndWinEnd` after the final-board hold and before the swap back): every tallied coin, in
    column order, staggered, awaited. A flow effect `flyTo` (`cells` or `reel`+`row`, `target`
    default `'total'`, `flight` default `toTotal`, `avoid`, `stagger`, `await` default true);
    vocabulary regenerated (48 effects).
  - **Verified**: `check:engine-game` 7/7, `gen:flow-vocab:check`, `pnpm lint`, `check-all` 319/319,
    svelte-check at baseline and completed (apps/lines 166, engine-game 38, pixi-svelte 14,
    engine-layout 296, components-ui-pixi 23). Storybook from `C:\IW-4f`
    (`MODE_HOLD_AND_WIN/flights`: a 5×3 volley into the win meter, avoidance, over-route, with the
    obstacles and routes drawn): heads land on the Win meter above the HUD, routes miss every red
    cell, the layer goes back to its 4 idle nodes after each volley, no console errors. The recorded
    `MODE_HOLD_AND_WIN/book` trigger round, probed through the real bus: 5 `flightArrive` (indices
    0–4, target `total`, flight `toTotal`), the board swaps back 2 ms after the last; slammed at the
    last counter update, the same 5 cues fire and counter-zero → last landing drops from 1834 ms to
    201 ms.

- 2026-10-01 — **Phase 4d: specials and mystery beats** (session "Hold and Win Phase 4 — engine
  runtime", branch `engine/hold-win-4d-specials`, stacked on 4c). Each beat is one function in
  `holdAndWinPresentation.ts`, called by its coded handler and by a new flow effect:
  `payCoins` (`coinPay`: payer `win`, then every coin counts up `from` → `to`, staggered),
  `boostCoins` (`coinBoost`: booster `win` when `source: 'special'`, then the counts; a jackpot's
  factor steps `MINI` → `MINI ×2`), `turnSpecialIntoCoin` (`specialBecomesCoin`: lands as a coin),
  `collectCoins` (`coinCollect`: each coin pulses via `presentCollectStep`, the collector's label
  climbs to its new value), `revealMystery` (`mysteryReveal`: `explosion`, becomes what it revealed,
  `land`; an unlock shows "UNLOCKED: <KIND>"), `clearRespinCells` (`cellsCleared`: `clearReel`, then
  gone), `showJackpotWin` (`jackpotWin`: a jackpot coin lights; a banked jackpot gets a toast). New
  cues (notifications): `respinCoinPay`, `respinCoinBoost`, `respinSpecialBecomesCoin`,
  `respinCoinCollect`, `respinCollectStep` (once per collected coin), `respinMysteryReveal`,
  `respinModifierUnlock`, `respinCellsCleared`, `respinJackpotWin`; flow vocabulary regenerated. A
  slam compresses every wait and count and skips no state change; every symbol beat is capped
  (650 ms). Other games: one optional `Symbol.svelte` prop nobody else passes. Storybook
  `MODE_HOLD_AND_WIN/book` gained five rounds recorded from the pots mock through the real facade
  (`trigger,special:payer`, `special:multiplier`, `special:collector`, `mystery:jackpot:MINI`,
  `unlock:payer`; specials on H1–H4, role-tagged in the story). Verified: svelte-check at baseline
  (apps/lines 166, engine-game 38, completed), eslint, `gen:flow-vocab:check`, `check:engine-game`
  (new `respinCount` fixture), `check:holdandwin`, `check-all` 319/319. All five stories played in
  Storybook from a short path, with the respin board's state probed every 250 ms off the live
  modules: each label is pinned at `from` while the picture already holds `to`, counts up staggered
  and lets go on the final value; the collector climbs 0 → 8.5 as its five coins pulse in turn; a
  mystery goes `explosion` → becomes `W MINI` / the payer → `land`; a slam in the payer's beat
  ended every count on its final value within 0.1 s and the next respin rolled at full pace.
  **Not seen as pixels:** this Storybook mounts no board for ANY story (`MODE_BASE/book` too — the
  stage has no reel or respin subtree; `Game.svelte` gates the reel stack on
  `!isFlowDriven || isBasegameActive`), so the 4c visual check on a live published project still
  covers 4d's beats too.

- 2026-10-01 — **4c merged (#934): the respin board** — live as `lines@28b09d57cd88` (findings
  above). **Then: Hold and Win resume through the snapshot** — the facade hands the engine the
  resume point of a mid-feature round (`holdAndWinResumePoint`, `engineFacade.ts`), pinned by the
  facade fixture's resume case (starts at the next `respinReveal`, the snapshot before it is the board
  held at the break, the trigger is not presented again; a mutant that resumes at 0 fails 4 checks).
- 2026-10-01 — **Phase 4c: respin board, sticky coins, respin counter** (session "Hold and Win
  Phase 4 — engine runtime", branch `engine/hold-win-4c-respin-board`). `holdAndWinTrigger` swaps
  the reel board for the respin board over the same seats, triggering coins held; `respinReveal`
  spins the free cells onto the revealed symbols; `coinsLand` sticks them (a `land` beat);
  `respinUpdate` moves the counter and a reset pulses it; `holdAndWinState` rebuilds the whole board
  with no intro (resume); `holdAndWinEnd` holds the final board, then swaps back. Six flow effects and
  five cues; flow vocabulary regenerated. Other games: one empty container in the board stack and one
  `stopButtonClick` subscription — the reels are built on the first feature only. Verified:
  `check:engine-game` (new respin-board fixture; 4 planted mutants caught), the facade fixture,
  `gen:flow-vocab:check`, eslint, svelte-check (engine-game 38 = baseline; apps/lines 169 on this
  branch and on its base alike — the 3 over baseline are a Windows long-path `svelte(style)` artefact
  of the checkout). NOT rendered locally: the checkout's path is past Windows `MAX_PATH`, which breaks
  Vite; the Storybook story `MODE_HOLD_AND_WIN/book` (two rounds recorded from the pots mock through
  the real facade, symbols renamed onto the sample art) is there to run from a short path.

- 2026-10-01 — **Phase 4b: facade mapping + coin labels** (session "Hold and Win Phase 4 — engine
  runtime"). The facade translates every wire Hold and Win event into the 4a contract (cell values,
  jackpot labels and factors parsed off `BONUS:1.5` / `JACKPOT:MINI*2`; credits → book units),
  pinned by `packages/rgs-translator-eagaming/holdAndWin.fixture.ts` (in `check:holdandwin`): the real
  facade against the real mock, 18 forced beats over the three presets, every book folded through
  the engine reducer and compared with the server's snapshot after every respin. Symbols print their
  value (`coinLabelText` in engine-game, drawn by `Symbol.svelte` over the art): money for a coin or
  collector (decimals, the operator's currency), `MINI ×2` for a jackpot, `×3` for a multiplier,
  `+$4.00` for a payer — the coded default until Phase 7 authors it.
- 2026-10-01 — **Phase 4M: game modes** (session "Hold and Win Phase 4M — Game modes"; PRs #930
  registry, #933 engine + flow).
  - **Registry** (`packages/game-config/src/modes.ts`): sparse `doc.modes`; built-ins `basegame`,
    `freeSpins` (game type `freegame`), `holdAndWin` (respin board, game type `respin`, only with a
    `holdAndWin` block). `/config` Game modes section; Scene Editor role **game mode** + `modeId`.
  - **Engine stack + queue** (`engine-game` `modeStack.ts` / `modeEvents.ts` /
    `modeController.svelte.ts`, `apps/lines` `stateModes.svelte.ts`): nest / queue / same-mode merge,
    the queue drains only at base, `allFinished` only when both are empty. `modeEnter`/`modeExit` book
    events; `freeSpinTrigger`/`freeSpinEnd` and 4a's `holdAndWinTrigger`/`holdAndWinEnd` are aliases
    (4a's `{mode, cause, payload}` shape is read as is). `GameType` widened to any mode game type.
  - **Flow:** `FlowDoc.modes: {[id]: {graph}}`, active-mode-first dispatch, nodes Mode trigger
    (enter/exit/resume), On all modes finished, Enter mode (nest/queue), Exit mode; validator codes
    `mode-unset` / `mode-entry-scope`, ids unique across sections; `check:flow-publish-gate` §6;
    `/flow-v2` mode tabs. `$engine.activeMode` / `modeDepth` / `queuedModes`.
  - **Resume:** stack + queue rebuilt silently from the snapshot; Hold and Win's own state comes back
    through 4a's `holdAndWinState` replay.
  - **Hold and Win state is recorded at the play seam** (taken over from Phase 5 at the hub's request):
    `createPlayBook`'s new `recordBookEvent` runs `recordHoldAndWinEvent` for every Hold and Win
    event BEFORE any path presents it (`isHoldAndWinEvent`, `engine-game` `holdAndWin.ts`), so a flow
    that owns one no longer leaves `stateHoldAndWin` stale. The coded handlers present nothing.
  - **Parity:** a real-clock free-spin round of `bookofborutremake`'s live authored data on the local
    book mock, `main` vs branch: same 10 spins' structure, same intro/outro holds, same
    `setFreeGameType` → `enterFreeSpinOutro` → `exitFreeSpinOutro` order and game-type moments, no
    exceptions; the stack goes `freeSpins` at the trigger and back to base after `freeSpinEnd`.
  - **Hold and Win keeps `gameType` unchanged for now** — SUPERSEDED 2026-10-01: once Phase 6 (#951)
    gave `Background.svelte` a `respin` branch, the flag was removed and the mode layer writes
    `gameType: 'respin'` for the feature (see Recent changes).
  - **Known gaps (code review, not parity):** (1) `playBet` resets the stack silently — a mode a FLOW
    entered must be exited within its round (book-driven modes always are). (2) Two ownership probes
    run once and see only the global graph + base: `Game.svelte` `flowOwnsSetWin` (boot) and
    `flowEffects.ts` `showWinInfoMessage`'s `ownsEvent('freeSpinTrigger')` (during the base reveal) — a
    mode tab that alone owns `setWin` / `freeSpinTrigger` is not seen there. (3) `freeSpinEnd` for a
    SUSPENDED free-spins mode (Hold and Win nested on top) lets the coded handler write `basegame` under
    Hold and Win; an unusual book order. (4) `/flow-v2`'s "Fix duplicate ids" repairs only the open
    graph; the editor and collapse mint ids unique across sections, so only a hand-edited doc collides.
  - **Left for Phase 5/6:** the Hold and Win mode's graph and its respin screens (tag them `mode` +
    `holdAndWin`); the facade/mock emit no `modeEnter` yet (nothing needs a queued mode until a game
    announces one).

- 2026-10-01 — **Phase 4a merged (#928, runtime release `lines@f6b3207671a9`): the Hold and Win book-event contract** (session "Hold and Win Phase 4 —
  engine runtime"). The §4.3 events as typed arms of the shared runtime's union (payloads in
  `engine-game` `holdAndWin.ts`), `RawSymbol` `value`/`jackpot`/`factor`, the `HoldAndWinSnapshot`
  resume shape, state-only default handlers into `stateHoldAndWin`, `flightArrive` cue, regenerated
  flow vocabulary (20 book events + `flightArrive`; the codegen now resolves a `.ts` re-export from a
  package). No game changes: no RGS sends these events yet — the facade still passes the wire's
  Hold and Win events through as `_name` until 4b maps them. A runtime release on merge.

- 2026-09-30 — **Phase 3 merged (#924): mock RGS `holdAndWin` protocol + wire contract** (session "Hold and Win
  Phase 3 — mock RGS + wire").

  - `scripts/mock-rgs-server-holdandwin.mjs`: deals from `doc.holdAndWin` + symbols + paylines only
    (base game through the lines evaluator), all three presets — count / pattern / meter / Lucky Spin /
    random metre / buy triggers, `allCoins` and `collectorsOnly`, both reset rules and the cap, full
    board, column letters with clear, payer / multiplier (+ leave-behind, + jackpots) / collector /
    mystery (+ unlock) in `applyOrder`, active modifiers, the wheel, base-game instant collect,
    persistent meters per session (at boot, on every `play`, across a contract swap), resume + replay.
  - Forced outcomes for every beat: `play.context = "force:<spec>"`, the test server's
    `/api/<key>/force?sid=&beat=`, or `FORCE=`.
  - Test server: `holdAndWin` gets its own mock from the contract (`MOCK_FALLBACKS` removed); the
    launcher's mock contract carries `holdAndWinMockInputs(doc)` (new in game-config) for both the
    published and the authoring mock (`check:mock-contract` pins the split).
  - `pnpm check:holdandwin` (in `check:rgs` and `check:all`): 240 rounds per preset rebuilt cell by cell
    from the events and compared with the server's snapshot after every respin — counter, stickiness,
    special order, payout sums, meters, `seq`/`gid` — plus every forced beat, meters, resume/replay and
    close rules. Eight planted mock bugs each fail it.
  - game-spec's `SymbolKindSchema` now imports the Hold and Win roles from game-config (`jackpot`,
    `coinMultiplier`), closing the Phase 1/2 naming mismatch.
- 2026-09-30 — **Phase 2 merged (#919)** (session "Hold and Win Phase 2 — Game Config block").
  - `packages/game-config`: the `holdAndWin` block, its normalizer and validator, and the three presets
    `pots` / `classic` / `collector` (numbers per design §1.2).
  - Committed defaults: `data/gameConfig/holdAndWin.<preset>.json`. `holdAndWin` defaults to `pots`.
  - `/config`: a Hold and Win section and "Reset to preset", gated on `kindCapabilities().holdAndWin`.
  - Game Maker: ten profile detectors.
  - Left for later phases: nothing reads the block at runtime yet (Phase 4), the mock doesn't generate
    from it (Phase 3), and the roles aren't offered in `/symbols` (Phase 7).
  - **Role-name mismatch with Phase 1:** game-spec's `SymbolKindSchema` (#917) says `jackpotCoin` and
    reuses `multiplier`, while the config's `special_properties` roles are `jackpot` and
    `coinMultiplier`. Phase 7 (Symbols) should align game-spec to the config names.
- 2026-09-30 — **Phase 1: kind plumbing + `kindCapabilities()`** — merged as #917, a runtime release (session "Hold and Win Phase 1: register the kind everywhere").
  - **One kind list.** `GAME_KINDS` lives in `packages/constants-shared/gameKinds.ts`. These now derive from it: roles.ts (its copy removed), `kindStorage`, `projects.ts`, the editor template picker, game-spec `GameTypeSchema`, the publish gate, `verify-launcher-profile` and `gen-flow-vocabulary.mjs`, which gives lines' emitter vocab to every kind except cluster/scatter.
  - **`kindCapabilities(gameType, config?)`** is in `engine-layout`.
  - **game-spec symbol roles:** `coin`, `jackpotCoin`, `collector`, `payer`, `mystery`, `meterSpecial` and `blank` (`multiplier` already existed).
  - **Mock protocol:** `protocolFor('holdAndWin') = 'holdAndWin'`. It is in `MOCK_PROTOCOLS` (launcher, test server, the two publish scripts). The test server deals it with the lines mock through the named `MOCK_FALLBACKS`, and `mockContract` requires paylines for it as for lines.
  - **Flow fallbacks** are explicit and named (table above).
  - **Scene set:** a 5×3 engine-skeleton `holdAndWin` set ("Hold and Win") is in `FULL_SCENE_SOURCES`, so the Game Maker/admin picker offers it and the kind chip reads "Hold and Win".
  - **Left for later phases:** `TEMPLATES`, `SCENE_ROLE_LABELS`, `DRIVEN_SEEDS`/`TEMPLATE_VOCABULARIES` entries, config/symbol defaults and the runtime/facade.

- 2026-09-30 — **Owner decisions recorded** (one template / three presets, 3 Pots first, mock-first with a swap seam). Build plan re-cut: Phase 10 is now the partner wire and Phase 11 covers what goes beyond the three references.

- 2026-09-30 — **Plan and hub created** (session "Hold and win game pipeline").
  - Researched 3 Oaks *Grand*, *Super Hotfire Diamonds* and *3 Pots of Egypt* from their server config and rules strings.
  - Read the partner core's respin and jackpot handling.
  - Inventoried the engine: found the `apps/price` superspin loop.
  - Inventoried every tool's kind plumbing.
  - Wrote the design doc and this hub.
