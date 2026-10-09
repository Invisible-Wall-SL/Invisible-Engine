# Bonus games — Hold and Win as a game of its own, the coin overlay as an option

> Status: the plan. Living state: **[docs/status/bonus-games.md](../status/bonus-games.md)** (the
> session hub). Builds on [hold-and-win.md](hold-and-win.md) (the respin game, game modes §4.5),
> [pots-overlay.md](pots-overlay.md) (the overlay, bonus import §5 A) and the precedent of
> [book-feature.md](book-feature.md) (a kind retired into a feature).

## Why this exists

Owner decision, 2026-10-08. Two different things are tangled in one `holdAndWin` config block today:

1. **The coin overlay: an option a base game switches on.** Classic, 3 Pots and Collector are
   styles of it. It decides what lands in the base game (coin symbols on the reels, tokens dropped
   on top, pots that fill, a collector that collects in the base game) and what counts as a trigger
   (6+ coins, a full pot, a pattern, a buy, Lucky Spin). It does not play the bonus. It starts one.
2. **The bonus stage: a game of its own.** The Hold and Win respin game (respin board, sticky
   coins, counter, specials, jackpots, board end, expansion, wheel) is one bonus game type. Free
   spins are another. A project can have **one or several** bonus modes, and the Flow editor
   presents each in its own tab.

The owner wants the Hold and Win respin game to be **a project in its own right** that can be
edited, duplicated and reskinned like any game. Any other project can then add it as one of its
bonus modes: red pot → this Hold and Win, gold coins → that Hold and Win, 3 scatters → free spins.

### What is wrong today (measured 2026-10-08 against `main` 72f7a0c)

- **One block, two halves.** `GameConfigDoc.holdAndWin` (`game-config/src/types.ts:526`) holds:
  - the trigger side: `trigger`, `meters`, base-game coin values, and each special's
    `landsInBaseGame` / `instantCollectInBaseGame`;
  - the respin side: `respins`, `stickiness`, `boardEnd`, `jackpots`, `specials`, `applyOrder`,
    `activeModifiers`, `wheel`, `expansion`.

  `holdAndWinBonusFrom` (`potsOverlayPresets.ts:80`) already splits the two halves by hand.

- **One Hold and Win per project, everywhere:**
  - config: one key, and `builtinGameModes` makes exactly one `holdAndWin` mode;
  - mock: `createHoldAndWinEngine` builds one engine, and the bonus id `'respin'` is hard-coded;
  - facade: one captured block per sid, and a binary `respins | reels` route;
  - events: `mode: 'holdAndWin'` is hard-coded in the facade, the mock and the engine-game types;
  - runtime: the singletons `stateRespinBoard` and `stateHoldAndWin`, the `paddingReels.respin`
    strip, and about ten `getActiveGameConfig().holdAndWin` reads;
  - tools: `kindCapabilities` is a boolean, Win Text replaces whole families, and the reference
    screens are tagged `modeId: 'holdAndWin'`;
  - import: brings in exactly one Hold and Win and REPLACES the host's.
- **A respin mode has no rules of its own.** `GameModesSection` can add a `respinBoard` mode, but
  nothing behind it says how it plays.
- **Import needs pots.** `importBonus` refuses a host without a pots overlay, because a full pot is
  the only thing that starts an imported bonus.

**What already works and is kept:** the mode stack and queue, per-mode Flow sections
(`FlowDoc.modes`), per-mode screens (`role: 'mode'` + `modeId`), `createRespinBoard` (a factory),
`modeEvents.ts` (already reads `event.mode`), and the import's provenance, rename map and re-sync.

## 0. The owner's model, revised 2026-10-09 (supersedes §1 and §6.4 where they disagree)

A game is four layers, each authored independently, in any combination:

1. **Base game kind:** lines, scatter, ways, cluster, or Hold and Win.
   - "Book of" is no longer a kind. It is an option on a lines game (book-feature project).
   - **Hold and Win stays a base kind.** It plays on its own: coins land on its reels and start its
     own respins, with no overlay and no bonus needed.
   - **It is the plain game:** no pots, no collector, and **jackpots optional**. Game Maker's "Hold
     and Win" template creates exactly this, with a Jackpots on/off choice (Phase 6b). Classic,
     3 Pots and Collector are coin-overlay styles, added only through "＋ Coin overlay…".
2. **Coin overlay (optional):** classic, 3 Pots or Collector, over ANY base kind (Hold and Win
   included). Each of its triggers can start an overlay bonus.
3. **Overlay bonus (0..n):** a bonus mode of ANY game type.
   - A **Hold and Win** bonus plays its respin rules (Phases 1–6).
   - A **lines / scatter / ways / cluster** bonus plays **N spins of that game** on its own reels,
     paytable and screens, adds up the wins, then returns to the base game (Phase 8).
4. **Normal bonus:** free spins, started by scatters or bought, as today.

The test-server mock only has to WORK for authoring: approximate math is fine for new combinations,
because production math comes from the real servers. Every current game still deals exactly as before
(ground rule 3).

## 1. The model

```
Project (a whole game)
├── base game            reels, paytable, lines — unchanged
├── coin overlay  (opt.) style classic | pots | collector: what lands, base-game coin values,
│                        pots, base-game collects, the TRIGGERS — each trigger names a bonus mode
└── bonus modes   (0..n) each: id, board, label, and its own rules
      ├── holdAndWin      board respinBoard, rules = a HoldAndWinGame (respin side only)
      ├── holdAndWin_2    another respin game, e.g. imported from another project
      └── freeSpins       board reels — the existing free spins (trigger = scatters, as today)
```

- **A Hold and Win project** is an ordinary project: a lines base game, a coin overlay, and one
  `holdAndWin` bonus mode. Game Maker's "Hold and Win" template creates exactly this (the three
  presets fill both halves), so it plays, publishes and playtests on its own as today.
- **Using it as a bonus elsewhere:** Game Maker → **Add a bonus mode… → from another project**
  copies that project's bonus MODE (its rules, symbols, screens, Flow tab, Win Text, `/symbols`
  bindings) into the host as a **new** mode. It never replaces an existing mode: a clash takes the
  `_2` suffix. The host's coin overlay (or a scatter trigger, or a buy tier) routes to it.
- **Copy + Re-sync, not a live link** (unchanged from pots-overlay §5): one project still gives one
  bundle, one bake and one delivery. Editing the source changes nothing until **Re-sync**.
- **Duplicate and reskin** a bonus project with the existing **Duplicate…**, `/symbols`, the Scene
  Editor and the 12c skinnable parts. Nothing new is needed.

## 2. The contract

### 2.1 Game Config

- **`GameModeDecl` carries its rules.** Each respin mode gets `holdAndWin?: HoldAndWinGame` (the
  respin half: `respins`, `stickiness`, `boardEnd`, `coins` (respin landings), `jackpots`,
  `specials` without base-game flags, `applyOrder`, `activeModifiers`, `wheel`, `expansion`, plus
  its own `blank` symbol and respin strip key `paddingReels[<gameType>]`). `builtinGameModes` stops
  inventing the `holdAndWin` mode; a respin mode exists because it is declared.
- **The coin overlay owns the trigger half.** It extends the existing `potsOverlay` block (renamed
  `coinOverlay`, §6) with:
  - `style: 'classic' | 'pots' | 'collector'`;
  - coins as reel symbols (classic) as well as dropped tokens;
  - base-game coin values;
  - the base-game special flags;
  - `trigger` (count / pattern / buy / luckySpin / randomMetre).

  **Every trigger names a mode**: `PotBonus.mode` already does, and `count` / `pattern` /
  `luckySpin` / `randomMetre` and the symbol-filled meters gain `mode`. A legacy `BuyTier.mode` is
  the BET mode (the `betModes` key), so a buy route in the overlay is `{ betMode, mode, … }`.

- **Routing is config, not Flow.** Which mode a trigger starts is math the server deals, so it lives
  in Game Config and the mock/RGS reads it. The Flow editor PRESENTS each mode in its own tab
  (enter, the mode's events, exit), as Phase 4M built.
- **Symbol roles stay on the dictionary.** Two respin modes stay apart because an imported mode's
  symbols are renamed (`coin` → `coin_2`), and each mode's rules name the symbols they deal.
- **Migration is lossless and automatic.** `normalize` reads a legacy `holdAndWin` block and splits
  it:
  - the trigger half goes to the overlay;
  - the respin half goes to a declared `holdAndWin` mode;
  - an existing import record is kept.

  A legacy doc and its split form must give the same mock inputs. That is the gate on Phase 1.

- **Transition (Phases 1–7a, done).** Until every reader had moved to per-mode reads, a normalized
  doc stored the split form (canonical) AND the legacy `holdAndWin` / `potsOverlay` keys as a
  **compat mirror** derived from it. Phase 7b dropped the mirror (2026-10-09).
  - **The mirror showed one respin mode, the PRIMARY:** the respin mode `holdAndWin` when it has
    rules, else the first respin mode with rules. Its `holdAndWin` was that mode's rules joined with
    the overlay's routes to it and the base-game flags; its `potsOverlay` the overlay's pots, drops
    and timing, present only when something drops. Those shapes live on as views of the split form,
    `primaryHoldAndWin(doc)` and `potsOverlayOf(doc)`, which the Hold and Win validator, mock and
    runtime read.
  - **Precedence (kept by the legacy reader).** When `normalize`'s input carries a legacy key, the
    legacy pair is applied over the split form for everything the mirror showed; everything else
    of the split form is kept (other modes, routes to them, the style, the base-game coins, flags
    for specials the primary does not configure). When the input carries neither key, the split
    form stands. Only `normalize` (and `migrateLegacyBonus`, its whole-doc form for `/config`'s
    unnormalized live doc) reads the legacy keys; `check:bonus-migration` fails on any other reader.
  - **Writers edit the split form.** The game-config writers (`addOns`, `imports`, `bonusModes`,
    `spinsModes`) edit `coinOverlay` and the modes directly, a preset's Hold and Win installed whole
    through `setPrimaryHoldAndWin`. Hold and Win is removed through `removeHoldAndWin(doc)` (the
    primary respin mode and the routes to it). A Hold and Win mode always plays on the respin
    board: an override's `reels` or `none` board beside a legacy block is overruled, so the block is
    never lost.
  - **Old baked bundles** still boot: the runtime normalizes the baked config
    (`getActiveGameConfig`), so a bundle baked with the mirror, or before the split, plays the
    split form.

### 2.2 Wire, mock and facade

- **Boot `config` carries one respin config per mode**: `bonusModes: [{mode, gameType, …HoldAndWinWireConfig}]`.
  A legacy single `holdAndWin` is read as mode `holdAndWin`.
- **Every event carries the real mode id**: `holdAndWinTrigger`, `respinReveal`, `holdAndWinState`
  and `holdAndWinEnd` carry `mode`. The facade routes `enterBonus` / `playedBonusSpin` by the wire's
  mode to that mode's captured rules. It no longer uses a binary `respins | reels`.
- **The mock builds one Hold and Win engine per respin mode.** The overlay's triggers name the mode
  they start, and the composed mock (`withPotsOverlay`) also wraps the lines mock for a classic
  overlay, so a Hold and Win project runs on the lines mock plus the overlay. `protocolFor('holdAndWin')`
  goes away, as `bookOf` did in book-feature.
- **Emit rule (Phase 2; kept by Phase 7b, which changed the doc, not the wire):** `bonusModes` and the per-context `mode` are
  sent only when the project's respin set is not the lone default (one `holdAndWin` mode on the
  `respin` strip), which the mock reads from `holdAndWinMockInputs(doc).modes` being present, so
  every existing game's answer stays byte-identical.
- **Parity:** `check:holdandwin`'s `MAIN_DIGESTS` (pots, classic, collector) and
  `check:pots-overlay`'s must not move for the migrated samples.

### 2.3 Engine runtime

- **One respin mode plays at a time.** Nesting a respin mode inside another respin mode is refused
  in config, because the board is one screen. The board, `stateHoldAndWin`, letters, jackpots,
  the wheel and the expansion read **the rules of the respin mode on top of the stack**, not
  `config.holdAndWin`. The `RespinBoard` is rebuilt on entry from that mode's rules and strip.
- **Resume** keeps the mode id with the held board and rebuilds into the right mode.
- **Value sources** (`respinsLeft`, `cellsHeld`, jackpot values) read the active mode.
- **How a respin mode plays** is part of its rules: `holdAndWin.play?: 'auto' | 'manual'` (owner
  request 2026-10-08). `auto`, or absent, is how every Hold and Win game has always played: the respins
  follow each other with no input, the intro and the outro advance on their own, and a tap only slams.
  `manual` parks before each respin on SPIN (the free-spin hold), except under autoplay or space-hold;
  its intro and outro stay timed too.

### 2.4 Tools

- **`kindCapabilities`** answers from the doc, not the kind:
  - Hold and Win parts appear when a declared mode has `board: 'respinBoard'` and Hold and Win rules
    (a rule-less respin mode is inert);
  - coin roles appear when there is a respin mode. A pots-only overlay's tokens carry no cash
    value, so they add none (widen this when an overlay deals valued coins without a respin mode);
  - the overlay's own parts (the Pots screen) appear when the coin overlay drops tokens: the
    predicate `potsOverlayOf` uses, read from the split form.
- **`/config`:**
  - a **Bonus modes** section lists the modes. Each respin mode opens its own Hold and Win editor
    (today's `HoldAndWinSection`, pointed at that mode);
  - the **Coin overlay** section edits the style, the coins, the pots and the triggers, each
    trigger with a "starts → mode" picker.
- **Flow v2:** the Hold and Win vocabulary attaches to every mode tab whose board is `respinBoard`
  (keyed on board, not on the id `holdAndWin`). Its actions target the active respin board.
- **Scene Editor:** "Add missing screens" seeds the reference respin screens for any respin mode id.
- **`/symbols`:** the jackpot tiers come from the mode being edited.
- **Win Text:** jackpot, respin and wheel lines are per mode. An import adds a mode's lines and
  replaces no family.
- **Game Maker:**
  - the "Hold and Win" template builds lines + overlay + mode;
  - **Add a bonus mode…** is on every project card (no overlay needed): pick a source project and
    one of its modes, then a trigger route;
  - **Re-sync** is kept;
  - the "＋ Pots overlay…" action becomes "＋ Coin overlay…" with the three styles.

## 3. Build plan (phases — each a PR, each updates the status file)

Every phase keeps every current game building, playing and looking the same (CLAUDE.md Director
ground rule 3). Engine phases mean a runtime release on merge. Each phase runs `check:all`, and a
phase touching the runtime boots the three Hold and Win samples and `borut-pots-sample` on the
mock unchanged.

0. **Plan + hub.** This doc and the status file. ✔ when merged.
1. **Contract: config split + migration** (`invisible-game-config`). `HoldAndWinGame` on
   `GameModeDecl`; the overlay's trigger half with a mode per trigger; `normalize` splits a legacy
   block; validators (one respin mode at a time, every route names a declared mode, each respin
   mode has rules + strip); `resolveBonusModes`; capability inputs from modes. Pure package plus a
   fixture proving legacy ≡ split for every preset and sample shape. **No consumer changes yet**:
   the old readers keep working through a compat accessor.
2. **Mock: per-mode engines** (`engine-pixi-svelte`, scripts). One engine per respin mode, real
   mode ids, the classic overlay over the lines mock, `protocolFor` drops `holdAndWin`, mock contract.
   Digests unchanged. Needs 1.
3. **Facade + wire + event types** (`engine-pixi-svelte`). Per-mode capture, route by mode, events
   carry the mode, legacy boot read. Fixture beside `holdAndWin.fixture.ts`. Needs 1; parallel with 2.
4. **Engine runtime** (`engine-pixi-svelte`). Active-mode rules everywhere the runtime reads
   `config.holdAndWin`; the board rebuilt per mode; resume per mode. Needs 3.
5. **Tools**, in parallel once 1 is merged (5c/5d also need 4 to play-check):
   - 5a `/config` Bonus modes + Coin overlay sections (`invisible-game-config`);
   - 5b Scene Editor + `kindCapabilities` + `/symbols` (`invisible-components`, `invisible-symbols`);
   - 5c Flow v2 vocabulary by board, editor + publish gate + runtime (`invisible-flow`);
   - 5d Win Text + Localization per mode.
6. **Game Maker: template + Add a bonus mode…** (`invisible-game-maker`). The template builds the
   split form. The import generalises to any mode of any same-client project, as a new mode, with
   any host and re-sync. Guides (`docs-keeper`, rule 9). Needs 2–5.
7. **Compose and prove**, split in three (revised 2026-10-09, §0):
   - **7a, mock composition.** The base engine comes from the base kind: the lines-family mock with
     its win model, or the Hold and Win engine. The coin overlay composes over ANY base engine, the
     Hold and Win engine included. Every overlay route (pot, coin count, pattern, Lucky Spin, random
     metre, buy) starts its named bonus mode, and a Hold and Win base can enter other bonus modes.
     This lifts Phase 6's route guard. It also adds per-mode progressive pools and wires
     `coinOverlay.coins` into the mock. Approximate math is fine; current games are byte-identical.
   - **7b, drop the legacy mirror** (done). The `holdAndWin` / `potsOverlay` keys and their readers
     went; `normalize` still reads them, as the legacy reader.
     The `holdAndWin` kind stays as a base kind.
   - **7c, migrate and prove** (`game-playtester`). Every stored project normalises to the split
     form on its next save, and the samples play end to end. This needs R2 and a browser.
8. **Overlay bonus of any game type** (after 7a). A bonus mode can be a lines, scatter, ways or
   cluster game: N spins on its own reels, paytable and screens, then back to the base game. It
   covers Game Config, the mock, the runtime, the Scene Editor, Flow, Win Text and Game Maker's "Add
   a bonus mode…" from any project.

**Done when:**

- `hw-classic-sample` is a lines game with a classic coin overlay and one Hold and Win mode, and it
  plays as today;
- a duplicate of it, reskinned, is added to `borut-pots-sample` as a second Hold and Win bonus beside
  the first;
- red pot → Hold and Win A and gold pot → Hold and Win B each play with their own rules, art,
  screens, Flow tab and Win Text;
- a re-sync picks up an edit made in the source;
- every current game is unchanged.

## 4. Order and parallelism

`0 → 1 → (2 ∥ 3 ∥ 5a ∥ 5b) → 4 → (5c ∥ 5d) → 6 → 6b → 7a → 8a → (8b ∥ 8c) → 7b → 7c`.

Phase 8 is split: 8a is the contract, mock and runtime; 8b is `/config`, Game Maker and the
self-contained overlay presets; 8c is the Scene Editor, Flow v2, Win Text, `/symbols` and the info
page. 7b (dropping the legacy mirror, about 80 readers) waits for 8b and 8c so it doesn't fight them.

Concurrent work to coordinate with:

- **book-feature** (retiring `bookOf`) touches `protocolFor`, the lines mock and `kindCapabilities`.
  Phases 2 and 5b rebase on it.
- The free-spins configuration work touches `freeSpins.ts`.

## 5. Out of scope

- **A live link to another project's bundle** (pots-overlay §5 B).
- **A respin mode nested inside another respin mode.**
- **Wheel and pick as bonus games of their own.** The `wheel` stays inside Hold and Win rules as
  today.
- **Partner wire.** The new shape is ours (mock-first), and the partner's confirmation is still
  owed (Hold and Win Phase 10).

## 6. Owner decisions (2026-10-08 — 4, 5 and 6 confirmed by the owner; the rest are defaults)

1. **Routing lives in Game Config;** Flow only presents each mode. (Math has to be server-dealt.)
2. **Copy + Re-sync, not a live link.**
3. **An added bonus mode never replaces one:** an id clash takes `_2`.
4. ~~The `holdAndWin` KIND retires as an engine switch~~ **Reversed 2026-10-09:** Hold and Win stays a
   base kind that plays alone, and a coin overlay and bonus modes can be layered on it (§0).
5. **Name (confirmed):** `potsOverlay` is renamed `coinOverlay` (UI: "Coin overlay"), with a compat
   read of the old key.
6. **Triggers in scope (confirmed):** the coin overlay's own (coin count, pots, collector, pattern,
   Lucky Spin, random metre) and buy tiers. Scatters keep starting free spins only: a scatter →
   Hold and Win route is out of scope.
