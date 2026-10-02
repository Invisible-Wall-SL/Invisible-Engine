# Pots overlay — the 3 Pots mechanic on any game, and a pot-cued bonus

> Status: living state in **[docs/status/pots-overlay.md](../status/pots-overlay.md)** — that file
> is also the **hub** the phase sessions report into. This file is the plan, not the progress.
> Builds on [hold-and-win.md](hold-and-win.md): its pots (§1.3, §4.3), flights (§4.4), game modes
> (§4.5) and authorable feature parts (§8). Related: [game-type-templates.md](game-type-templates.md),
> [invisible-game-config.md](invisible-game-config.md), [invisible-flow-v2.md](invisible-flow-v2.md),
> [live-assets.md](live-assets.md), [hold-and-win-wire](../reference/hold-and-win-wire.md).

## Why this exists

Owner request, 2026-10-02: make the 3 Pots mechanic an **option that can be laid over any game**
already made, e.g. Book of Borut.

- Coins appear at random **on top of** the game's own symbols, then fly to the pots.
- A full pot starts a bonus. The bonus can be a classic Hold and Win, or another game the owner has
  already made.
- It is authored through the Flow editor, Game Config and the Scene Editor, and travels the normal
  pipeline.
- Every part of it is optional.

Today that is impossible. A pot exists only inside the `holdAndWin` block of a `holdAndWin`-kind
project, and it is filled by a reel symbol. A full pot can only enter the respin feature. The book
mock deals no pots, and the tools hide every pot part from a `bookOf` project.

## 1. What the player sees

1. **The base game is the host game, unchanged.** Book of Borut keeps its lines, its book symbol and
   its free spins.
2. **Tokens drop.** On some spins one or more **tokens** land on random cells, drawn ON TOP of the
   symbol in that cell. The symbol underneath still pays its lines and still triggers its book.
   Each token belongs to a pot (red / blue / green in the 3 Pots look).
3. **Tokens fly to their pot.** Each flight leaves its cell, lands in its pot, and the pot fills a
   level. Size stages step up as levels rise.
4. **A full pot starts that pot's bonus.** The bonus is one of:
   - the classic **Hold and Win** respins, optionally with a modifier active (3 Pots style);
   - the host's **own free spins**, e.g. Borut's book free spins;
   - any other **mode** the project has, including (Phase 7) a bonus **imported from another
     project**.
5. **Optional value coins.** A drop can also be a coin that carries a cash value or a jackpot label.
   N or more value coins on one spin start the classic Hold and Win with those coins held, as
   6+ coins do in a classic game.
6. **Pot levels persist per player** between rounds. They are server state, as in 3 Pots: the
   client never computes a level.

## 2. The model — a kind plus optional add-ons

**A project keeps its kind; an overlay is an add-on.** The add-on is a Game Config block
(`potsOverlay`). A project without the block plays, authors and publishes exactly as today, and that
parity is the gate on every phase. The kind still decides what the BASE game is (lines, book, ways…);
the add-on decides what is layered on it.

**Reuse, don't fork.** The overlay is mostly parts that already exist, re-keyed from "the kind is
Hold and Win" to "the config has the block":

| Reused as is | From |
|---|---|
| Pots: the coded pot, the `meter:<id>` flight anchor, the `meter.<id>.*` value sources, the `potFill` / `potLevelUp` / `potStageUp` / `potFull` / `potActivate` / `potsConsume` signals, the Pot Meter component with 12a scoped signals, 12b value bindings and (when built) 12c skins | Hold and Win Phases 4, 6, 12 |
| Flights: `flyTo(cell → 'meter:<id>')`, route planner, trails, the `toMeter:<id>` flight style in `/symbols` | H&W §4.4 (a flight starts from a cell's SEAT, not its symbol, so a token works with no change) |
| The respin feature: the whole `holdAndWin` block, `RespinBoard`, every special, jackpots, the feature-end tally | H&W Phases 2–4, 11 |
| Game modes: the stack and queue, `role: 'mode'` screens, the Flow `modes` tabs, mode-aware resume | H&W Phase 4M |
| Pots drawing from config at boot | runtime already keys on the config block, not the kind (`Game.svelte` `configuredMeters()`, `HoldAndWinPots.svelte`) |

**What is new** (each gap measured 2026-10-02 against `main` e5f94b1; file references in the status
file):

1. **A token on a cell, independent of its symbol.** `RawSymbol` carries `value`/`jackpot` on the
   symbol itself. Nothing attaches a thing to a cell, and a coin's art is its symbol's own.
2. **A pot that names a bonus.** `HoldAndWinMeter.activates` can only name a Hold and Win special.
   The trigger cause is a fixed `'meter'`.
3. **Respins and free spins in one game.** Once the facade has captured a `holdAndWin` block, it
   turns EVERY `enterBonus` into respins and every `playedBonusSpin` into `holdAndWinState`. A book
   game with that block would lose its free spins.
4. **A composed mock.** One protocol per game (`protocolFor(kind)`), and protocols never compose.
   The book mock knows no pots, and the Hold and Win mock deals no free spins.
5. **Tools gate on the kind.** `kindCapabilities()` sets `holdAndWin` / `coinSymbols` from the kind
   only, so a `bookOf` project gets none of the following:
   - the pot or respin components in the palette;
   - the pot signals in the pickers;
   - the Hold and Win flow vocabulary (and the publish gate refuses its refs);
   - the Symbols coin states and role chips;
   - the Win Text jackpot lines.

   `/config` is the only exception: it shows the section once a block exists, but there is no button
   to add one. "Add missing screens" and the presets REPLACE whole docs rather than add to them.
6. **Adding to a project that already has authored docs.** Borut has a hand-authored layout and Flow
   v2 graph. The overlay must be added without reseeding or overwriting either.
7. **A bonus from another project.** One project per page load, one config per project, and no
   import between projects (the Game Maker can only duplicate a whole project onto a new key).

## 3. The contract

### 3.1 Game Config — the `potsOverlay` block

Sparse and optional, like every Invisible-Engine block. Its presence is what makes a project an
overlay host.

```ts
type PotsOverlay = {
	pots: OverlayPot[]; // 1..N; 3 Pots has three
	drops: OverlayDrops;
};

type OverlayPot = {
	id: string; // 'red' — also its flight anchor `meter:<id>` and value sources `meter.<id>.*`
	token: string; // the symbol drawn as this pot's token (tagged `meterSpecial`); never on the reel strips
	maxLevel: number;
	sizeStages: number[]; // ascending levels where the pot art steps up a size
	bonus: PotBonus; // what a full pot starts
	label?: string;
};

type PotBonus = {
	mode: string; // 'holdAndWin' | 'freeSpins' | any mode resolveGameModes(doc) lists
	activates?: HoldAndWinSpecial; // holdAndWin only: the special the feature starts with active
	spins?: number; // a reels mode only (free spins): the mock's spin count; the RGS decides for real
};

type OverlayDrops = {
	chance: number; // (0, 1]: the share of spins in a dropping mode that drop anything
	maxPerSpin: number; // ≥ 1
	table: OverlayDropEntry[]; // weighted: what each token is
	reels?: number[]; // reels a token may land on (0-based); absent ⇒ every reel
	modes?: string[]; // `reels`-board modes whose spins drop; absent ⇒ ['basegame']
};

type OverlayDropEntry =
	| { pot: string; weight: number } // a token for that pot
	| { coin: true; weight: number }; // a value coin, its value drawn from holdAndWin.coins
```

Rules:

- **Values are mock math.** As in the `holdAndWin` block, the weights drive the mock and the tool's
  readouts. The RGS is the authority on every outcome.
- **One meter list.** `resolveMeters(doc)` returns `holdAndWin.meters` (symbol-filled) and
  `potsOverlay.pots` (token-filled) as one list, and the runtime and tools read meters only through
  it. Pot ids must be unique across both lists, because each id names one anchor and one set of
  sources.
- **Bonus routes are checked against the mode registry.**
  - `mode: 'holdAndWin'` needs a `holdAndWin` block (its respin rules, coins, jackpots).
  - Any other mode must be listed by `resolveGameModes(doc)`.
  - `activates` is valid only with `holdAndWin`.
  - A `{coin}` drop entry needs a `holdAndWin` block. Its `trigger.count` is then the classic "N+
    coins" trigger, counted over the dropped coins.
- **Is the `holdAndWin` block the bonus or the base game?** The data decides, in one helper,
  `holdAndWinIsOverlayBonus(doc)`, shared by the validator, the mock, the facade and the runtime. The
  block is the overlay's BONUS when an overlay is present and the base game's strips deal no Hold
  and Win symbol. That covers a Book-of or lines host.
  - **As a bonus:** the lines-only rule (`winModel` must be `lines`) does not apply, because the
    host's own mock deals the base game. The base-board-only options (`pattern`, `luckySpin`,
    `randomMetre`, `buy`, instant collect, symbol-filled `meters`) are refused until a phase builds
    them for an overlay.
  - **A Hold and Win game that adds an overlay** keeps its block as the base game, with every rule,
    and a pot routed to `holdAndWin` is one more trigger.
- **Presets** (`potsOverlayPreset(id)`, built on call so game bundles never carry them; merged into
  the doc, never a whole-doc reset. `holdAndWinBonus(id, host)` gives the paired Hold and Win block,
  its symbols and its respin strips cycled to the host's reel count):
  - **3 Pots**: red → Hold and Win + payer, blue → + collector, green → + multiplier (the 3 Pots of
    Egypt pots, as overlays).
  - **Pots to free spins**: one pot → `freeSpins`.

### 3.2 Engine book events

The contract the mock, the facade and the flow share. Like Hold and Win §4.3, it lands as code
before the rendering.

| Event | Payload | Meaning |
|---|---|---|
| `overlayDrop` (new) | `cells: [{reel, row, token, pot?, value?, jackpot?}]` | Tokens appear on these cells, over whatever symbol is there. Comes after the board's `reveal`, before its wins. |
| `meterUpdate` (existing) | `meter, level, max, full, from: [cell]` | A pot fills. `from` is the token cells, so the flights start there. One per pot that moved. |
| `meterLevels` (existing) | `meters: [{id, level, max}]` | Every pot's level, after every play and at boot. |
| any mode entry (`holdAndWinTrigger` existing; `freeSpinTrigger`, `modeEnter` gain the fields) | `cause: 'meter'`, `meters: [id]` | A full pot starts this mode. The coded drain beat (`presentMeterConsume`) plays before the mode's own intro, for EVERY mode, not only Hold and Win. |
| `holdAndWinTrigger` (existing) | `coins: [cell]` = the dropped value coins | The respin board starts with those coins held. |

**Order on one base spin.** `reveal` → `overlayDrop` → the host's wins and features (lines, the book
reveal) → `meterUpdate`s (flights, then level-ups) → `meterLevels` → the bonuses, in book order.

**When the host's own feature and a pot bonus trigger on the same spin:** both play in one round,
the host's feature first and the pot's bonus after it (the mock's default; the server's book order
always rules). A full pot shows `potFull` on the spin it fills and drains when its bonus starts.

### 3.3 The wire (ours — a swap seam)

The wire is invented, like the Hold and Win wire, and documented in the same reference
(`docs/reference/hold-and-win-wire.md`, a new "Pots overlay" section, written in Phase 2). It is
rewritten when the partner delivers theirs. Its shape:

- the boot `config` carries `potsOverlay {wire, pots: [{id, token, level, max, sizeStages, bonus}],
  bonuses: {<spinTrigger.bonus key>: <mode id>}}`;
- `overlayDrop` follows `playedSpin`, with `meterUpdate` / `meterLevels` as today;
- the bonus a round enters is named by `spinTrigger.bonus` (the partner's own field), and a pot's
  bonus carries `cause: "meter", meters` there;
- a second bonus in one round arrives as its `spinTrigger` + `enterBonus` where `gameEnd` would
  have closed the first.

The facade routes `enterBonus` / `playedBonusSpin` by that bonus key **when a `potsOverlay` block was
captured**. Without the block it keeps today's rule (a captured `holdAndWin` block means every bonus
is respins), so every existing game stays byte-identical. That keeps the Hold and Win parity digests
untouched.

### 3.4 Runtime presentation (coded defaults)

- **The overlay layer.** A board-level layer at a fixed zIndex seat, above the symbols and below the
  win frames and the flight layer. It draws each token at its cell's seat, using the board's own seat
  maths, so stepped and perspective boards follow.
  - It never changes the cell's `RawSymbol`. Win frames, the book's expansion and anticipation never
    see a token.
  - A token draws its symbol's art and states from `/symbols`. Coin-like states are reused: land,
    then idle, then the `flyToMeter` head. A value coin draws the existing coin value label.
- **Timing.** Authorable: either each reel's tokens appear as that reel lands, or every token pops in
  after the last reel stops. The default is after the stop.
- **Lift-off.** A token leaves its cell as its flight starts: the token art becomes the flight head.
  Tokens that do not fly (value coins below the trigger count) clear on the next spin.
- **Bonus entry.** Any mode entry with `cause: 'meter'` drains the named pots first (the existing
  drain, toast and banner), then the mode's own intro.
- **Hold and Win from an overlay host.** The base board hands over to the `RespinBoard` as in a
  Hold and Win game. The held coins are the dropped value coins; with none, the feature starts on
  an empty board. When it ends, the base board returns with the host's symbols.
- **Unauthored, it plays.** Every overlay beat has a coded default. A flow that does not handle an
  overlay event falls back to it, as Hold and Win events already do. So adding the overlay to Borut
  needs **no flow edit**. Authoring is for taste.

### 3.5 The mock — a composed protocol

- **The wrapper.** `withPotsOverlay(mock, inputs)` wraps the host's own mock (book first, then lines
  and ways). It post-processes each base play: deals the drops, moves the per-session pots, and
  emits the events above.
- **On a full pot it routes the bonus:**
  - `holdAndWin` → the Hold and Win mock's feature generator, refactored into a reusable engine with
    the held value coins and the activated special;
  - `freeSpins` → a hook the host mock exposes to start its own free spins without scatters
    (`cause: 'meter'`);
  - any other mode → `modeEnter` / `modeExit` around that mode's generator (Phase 7).
- **Selection.** `protocolFor(kind)` is unchanged. The launcher's mock contract adds the overlay
  inputs whenever the config carries the block, and the test server's `makeMock` wraps.
- **Forced beats** (authoring mock): `overlay:drop`, `overlay:coins:<n>`, `pot:<id>` (fill it to full
  on the next spin), `pot:<id>:<level>`.
- **Gate.** A fixture gate, `check:pots-overlay`, pins the wire and the routes. The existing
  `check:holdandwin` / `check:freespins` digests must not move.

## 4. Tool by tool

**Cross-cutting first: capabilities become additive.** `kindCapabilities(kind, config)` takes two
new config inputs, `holdAndWin` (the block is present) and `potsOverlay` (the block is present):

- `holdAndWin` and `coinSymbols` become "kind OR block";
- a new `pots` capability is `holdAndWin` OR the overlay block. The pot parts (the Pot Meter, the
  pot signals, the `toMeter:<id>` flights) move to it, so an overlay that routes its pots only to free
  spins still gets them;
- a new `potsOverlay` capability follows the overlay block, for the overlay-only parts;
- `freeSpins`, `bookReveal`, `stackedPictures` and the rest stay on the kind, so Borut keeps
  everything it has.

Every consumer passes the config: the ten direct callers, plus `symbolStatesForKind`,
`engineSignalsForKind` and `componentOfferedForKind`. That one change lights most of the tools up.

| Tool | The overlay gets | Notes |
|---|---|---|
| **Game Config** | A kind-independent **"Add-ons"** section with **＋ Pots overlay**: pots (id, token symbol, max level, size stages, bonus route with a mode picker fed by `resolveGameModes`), the drop table, the dropping modes, the reels. **＋ Hold and Win bonus** inserts a `holdAndWin` block from a preset (Classic or 3 Pots). Neither ever resets the doc. | The section never locks a host's win model. Validator messages per §3.1. |
| **Scene Editor** | **＋ Add overlay screens**: merges ONLY the Pots screen (pot ids from the config, not the hard-coded red/blue/green), plus, with a Hold and Win bonus, the Jackpot bar and the `holdAndWin` mode screens (respin board, counter, total bar). It never replaces the layout. The Pot Meter and respin parts appear in the palette through the additive capability. | An overlay-layer placement (z seat, token scale) is a board setting, authored on the reel board node. |
| **Component Editor** | Nothing new. The Pot Meter (12a/12b/12c) is already the authorable pot. Its pot signals show in the pickers through the capability. | — |
| **Flow editor** | **Vocabulary composition:** `withAddOns(kindVocab, config)` adds the overlay fragment (events `overlayDrop`, `meterUpdate`, `potFull`…; actions to show, lift and fly tokens; values `meter.<id>.*`). A Hold and Win bonus also adds the Hold and Win fragment. It is applied at the editor, the publish gate and the runtime, so a Borut flow can reference it and still publish. **Graft (optional):** "＋ Add overlay steps" inserts the overlay chain into the base section and a `modes.holdAndWin` section from the Hold and Win seed. It never touches an authored node. | Unauthored, the coded defaults play (§3.4). |
| **Symbols SM** | The token and coin roles, their states (land, idle, `flyToMeter`), the value label and the `flights` rows (`toMeter:<id>` from `resolveMeters`) for any kind with the add-on. | Token symbols never appear on the strips. |
| **Win Text** | The pot / jackpot / respin lines when the add-on (or its Hold and Win bonus) is present; Localization harvests them. | — |
| **Game Maker** | **Add-ons on an existing project**: a project card action **＋ Pots overlay**. It seeds, create-only: the config blocks, the token / coin / blank symbols in the dictionary (off the strips), their `/symbols` bindings to placeholder art, the overlay screens and the Win Text lines. The same add-on is offered as a checkbox when creating a new game. | It never reseeds a flow or a layout the project already has. |
| **Mock / test server** | The composed mock (§3.5), selected by the block. | — |
| **Playtester** | A playbook for the sample (`docs/playtest/borut-pots-sample.md`). | — |

## 5. A bonus from another project ("cue other games I already did")

Two ways to do it. **Recommended: import, don't link.**

**(A) Import (recommended).** "Import a bonus from another project…" (Game Maker, same client) picks
a source project and one of its features (its Hold and Win block, its free spins, or an authored
mode). It copies that feature into this project as a mode:

- the config: the `holdAndWin` block, or the mode declaration with its `paddingReels`;
- the symbols the feature needs: merged into this dictionary, with a rename map when an id clashes;
- the `/symbols` bindings for those symbols;
- the feature's `role: 'mode'` screens from its layout;
- its Flow `modes[id]` section;
- its Win Text lines.

Each import keeps provenance (`importedFrom {project, mode, at}`). **Re-sync from source**
overwrites only the imported pieces. A pot's bonus route then names the imported mode.

It rides every existing chain: one project, one bundle, one bake, and the delivery build is
unchanged. Its limits:

- The bonus shares the host's grid and symbol dictionary. A `reels` bonus plays on the host's reel
  grid. A respin board, wheel or `none` bonus is free.
- Art must be exportable from the host. Same-client atlases already are. Spines under another
  project's prefix export nothing, so the import promotes them to `_shared/spines`.

**(B) Live link (not planned).** Playing another project's bundle as-is inside this one needs all
of the following:

- a second `RuntimeBundle` in the runtime (today a singleton), with namespaced spines;
- a per-mode config (grid, dictionary, win model);
- a bake and a delivery that carry two projects;
- a mixed-protocol round in the RGS.

That is a multi-phase engine and RGS project. Raise it again only if (A) proves too limiting.

**Math, either way:** the server must deal the imported bonus's outcomes inside this game. The mock
reuses the source feature's generator through the bonus route. In production this is the partner's.

## 6. Build plan (phases — each a PR, each updates the status file)

Same rule as Hold and Win Phase 11: **each slice is whole through the pipeline it touches, and a
project without the block is byte-identical.** Engine changes mean a runtime release on merge, so
run svelte-check and boot Borut on the book mock unchanged first.

0. **Plan + hub** — this doc and the status file. ✔ when merged.
1. **Contract: config + capabilities.** The `potsOverlay` block (types, normalizer, validator incl.
   routes and unique meter ids, the overlay-host relaxation of the Hold and Win rules),
   `resolveMeters`, the two presets, a `potsOverlay.fixture.ts` gate, and the additive
   `kindCapabilities` inputs (no consumer changed yet). Agents: `invisible-game-config` +
   `invisible-components`.
2. **Mock — the composed protocol** (§3.5). The `withPotsOverlay` wrapper over the book mock first,
   the Hold and Win feature generator made reusable, the free-spin hook, forced beats, the wire doc
   section, `check:pots-overlay`, and the launcher mock contract. Needs 1.
3. **Facade + event contract.** `overlayDrop` and the mode-entry `cause` / `meters` fields in
   `engine-game`, the facade's per-bonus routing under a captured `potsOverlay`, and pots seeded at
   boot for any kind. A fixture next to `holdAndWin.fixture.ts`. Needs 1; runs in parallel with 2.
4. **Engine runtime** (§3.4). The overlay layer, the timing option, token lift-off into flights,
   the drain on any mode entry, Hold and Win from an overlay host (held coins from drops), host
   feature then pot bonus in one round, and resume (tokens on the board, pots, the stack). Agent:
   `engine-pixi-svelte`. Needs 3.
5. **Tools**, four PRs in parallel once 1 is merged:
   - 5a `/config` Add-ons section (`invisible-game-config`);
   - 5b Scene Editor overlay screens + the palette and pickers through the capability
     (`invisible-components`);
   - 5c Flow vocabulary composition at the editor, the gate and the runtime, plus the graft
     (`invisible-flow`);
   - 5d `/symbols` + `/win-text` + Localization through the capability (`invisible-symbols`).
6. **Add-on in the Game Maker + the sample.** The project-card action and the new-game checkbox
   (`invisible-game-maker`), guides (`docs-keeper`, rule 9), and a playbook. The owner duplicates
   Book of Borut as `borut-pots-sample` and adds the overlay; a session plays it end to end on the
   mock (`game-playtester`). Needs 2–5.
7. **Bonus import from another project** (§5 A) — the import, provenance, re-sync, a pot routed to
   an imported mode, and the mock route. Needs 6.
8. **Partner wire** — when the partner deals overlays. Blocked, as Hold and Win Phase 10 is.

Phases 2 and 3 run in parallel after 1; 5a–5d run in parallel after 1; 4 needs 3.

**Done when (Phases 1–6), on `borut-pots-sample`:**

- a base spin plays Borut exactly, with tokens dropped on top of its symbols;
- the tokens fly into three authored pots;
- a full red pot starts the classic Hold and Win with the payer active;
- a full green pot starts Borut's own free spins;
- six or more value coins start the respins with those coins held;
- all of it is authored in `/config`, `/editor`, `/symbols` and `/flow-v2` without code;
- Book of Borut itself (no block) plays byte-identically.

**Phase 7 done when:** a pot starts a bonus imported from `hw-classic-sample`, and a re-sync picks up
an edit made in the source project.

## 7. Owner decisions (defaults taken — change any of them in the status file)

1. **Tokens vs value coins:** both. A pot token fills its pot and pays nothing. A value coin counts
   toward the classic trigger and is paid only by the feature.
2. **A pot per token:** each token belongs to exactly one pot. Weights decide the mix.
3. **Drops in free spins:** off by default (`drops.modes` = base game only); one setting turns
   them on.
4. **Host feature and pot bonus on one spin:** one round, the host's feature first.
5. **"Other games as a bonus":** import with re-sync (§5 A), not a live link.
6. **Production:** mock first. The partner's RGS must deal drops, per-player pots and the bonus
   routing before a real-money release (Phase 8).
7. **Never test on live Borut:** the sample is a duplicate (`borut-pots-sample`), so the live remake
   is never touched.
