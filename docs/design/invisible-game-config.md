# Invisible Game Config — the game's math contract, authored online

> Status: living state in **[docs/status/game-config.md](../status/game-config.md)** — read that for
> how far this plan got. Related: [invisible-game-maker.md](invisible-game-maker.md),
> [invisible-symbols-state-machine.md](invisible-symbols-state-machine.md),
> [live-assets.md](live-assets.md).

## Why this exists

Every online Game Maker project runs the **shared** `_runtime/lines` bundle. That bundle has
`apps/lines/src/game/config.ts` compiled into it, and the runtime bundle carries **no config at
all** — `assembleRuntimeBundle` ships `doc`, `components`, `editorArt`, `fonts`, `localization`,
`symbols`, `effects`, `flipbooks`, `flow`, `winText`, `rigFx`. Nothing else.

So **every project shares one sample config**: the same symbol dictionary, the same 20 paylines,
the same reel strips. Nothing a project authors can change them.

That is not a theoretical gap. It is what produced the reported bug:

> "I can still see the dynamite (W) when the reel is rolling, but it never actually lands."

`W` is a wild in the upstream Stake sample config. Neither RGS the engine talks to emits one
(`mock-rgs-server.mjs` → `PIC1..PIC7 + SCAT`; `mock-rgs-server-book.mjs` → `PIC1..PIC4`,
`ACE/KING/QUEEN/JACK/TEN`, `SCAT`, with `wildSymbols: ['SCAT']`). So `W` could only ever flash
past during the roll, sit in the paytable advertising a payout nobody could win, and occupy a row
in `/symbols`. Three surfaces, one cause: **the project cannot state what it plays.**

`959b85a` and `9b00e87` removed `W` from the shipped template and gated the paytable + the tool
grid on the reel strips. That is a correct fix for the template, but it is still ONE template for
everyone. The next project whose math differs hits the same wall.

## Goal

Each project owns a **config document** — the frontend's view of the game's math contract —
authored online in a new tool, shipped through the existing live-asset chain, and read by the
runtime in place of the compiled template config.

A template ships its **Stake-Engine default config** as the starting point (that is the format the
math team already produces), and the owner edits it online from there.

## What the config is — and is not

The config is the **frontend's contract with the math**, not the math itself. The RGS remains the
authority on outcomes; this document tells the client what to draw and what to expect.

In scope (the fields `apps/lines/src/game/config.ts` already has, because they are already read):

| Field | Read by | Why it must be per-project |
|---|---|---|
| `symbols` | `types.ts` (`SymbolName`), `paytable.ts` | The symbol dictionary + payouts differ per game |
| `paddingReels` | the spinning reel (`createReelForSpinning`), `paytable.ts`, `publish-symbol-defaults.mjs` | **The in-play set** — what can reach the board |
| `paylines` | `paytable.ts` (`NUM_LINES`), the info page | 20 sample lines is not every game |
| `numReels` / `numRows` | board dimensions | A 5×3 default is not every game |
| `betModes` | bet selector, buy-bonus | Cost/RTP/max-win per mode |
| `providerName` / `gameName` / `gameID` / `rtp` | info page, RGS handshake | Per title |

Explicitly OUT of scope — do not put these in the tool:

- **Real reel strips / weights / RTP simulation.** The math team owns these. `paddingReels` is a
  *cosmetic* strip (the blur filler) that happens to be the only client-side statement of the
  in-play symbol set — see "the strips are the gate" below.
- **Anything the Scene Editor, Symbols SM, Flow or Win Text already owns.** One fact, one home.

## The strips are the gate (keep this invariant)

`config.symbols` is a **dictionary** — art, properties, payouts. It legitimately describes symbols
a given game does not deal. `config.paddingReels` is the **in-play set**. Every consumer that asks
"does this game have symbol X?" must ask the strips, not the dictionary. Already applied in
`paytable.ts` and `publish-symbol-defaults.mjs`; the tool must preserve it, and the tool's own
symbol picker should read the strips too.

If a later phase introduces a first-class `symbolsInPlay` field, it replaces the strips as the gate
in ONE place and every consumer follows — do not add a second answer.

## Build plan (phased)

Each phase is shippable on its own and leaves the tree green.

**Phase 1 — the schema + storage.** `packages/game-config` (dependency-free, Node-resolvable, so
contracts are fixture-verifiable — mirrors `engine-flipbook`): a Zod `GameConfigDoc` matching the
Stake config shape, `normalizeGameConfigDoc`, and a `configDocKey` under
`<client>/<project>/config/config.json`. Server storage in `apps/launcher-api/src/lib/server/
gameConfigStorage.ts` with the standard ETag compare-and-swap
(`docs/design/multi-user-concurrency.md` Phase 1). Offline fixture in `tools/game-config-spike`.
Nothing reads it yet.

**Phase 2 — seed from the template.** A project with no config doc inherits its template's
default. Committed per-template defaults (`$lib/data/gameConfig/<template>.json`, generated from
the template's own `config.ts` so the two cannot drift — same producer pattern as
`publish-symbol-defaults.mjs`). "Reset to template default" is a first-class action in the tool.

**Phase 3 — the runtime carries it.** Add `config` to `assembleRuntimeBundle` + the baked bundle,
and `bakedGameConfig()` in `apps/lines/src/editor-scenes.ts` beside `bakedSymbolMap()`. The game
resolves `runtime → baked → compiled template` so an un-authored project is byte-identical
(dev parity, the rule every other doc in this pipeline follows).

**This is the risky phase**: `config` is imported at module scope by `constants.ts`, `types.ts`
and `paytable.ts`, and `SymbolName` is `keyof typeof config.symbols` — a COMPILE-TIME type. The
authored set is only known at runtime, so `SymbolName` must widen to `string` at the boundary and
the compile-time guarantee is replaced by a runtime validation + a loud boot warning for a symbol
with no art. Budget the phase for that, and do it behind `getActiveGameConfig()` (memoised, reset
on runtime-bundle apply) exactly like `getActiveSymbolInfoMap()` / `resetSymbolMapCache()`.

**Phase 4 — the tool.** Route `/config`, registered in `roles.ts` (`TOOLS`, `ROLE_TOOLS`,
`TOOL_BAR_ORDER`, `TOOL_DOC_SLUG`) with `docs/tools/game-config.md` written in the SAME change
(repo rule 9), plus its row in `docs/tools/README.md`. Shared `ToolTopBar`, full-page, no iframe.
Panels: **Identity** (provider/game/id/RTP) · **Grid** (reels/rows) · **Bet modes** ·
**Symbols** (the dictionary + paytable rows, with an in-play badge driven by the strips) ·
**Paylines** (visual 5×3 grid editor, not raw JSON) · **Reel strips** (per game type, per reel,
with a symbol-frequency readout). A raw-JSON escape hatch with schema validation for paste-in from
the math team — that is how a Stake config actually arrives.

**Phase 5 — retire the duplication.** Once the game reads the authored config, delete the
per-consumer workarounds it replaces and point `publish-symbol-defaults.mjs`'s filter at the
authored doc rather than the compiled module.

**Phase 6 — bet modes become authorable + localizable (the buy-features/bonus surface).**

The problem this closes: the buy-bonus / ante menu the player sees (`ModalBuyBonus` → `BonusCards`)
reads `stateMeta.betModeMeta`, and that is only ever the hardcoded `DEFAULT_BET_MODE_META` in
`packages/state-shared/src/constants.ts` — placeholder titles (`SAMURAI SPIN`, `SUPER BONUS`),
`test-fart-cdn` S3 URLs, `example banner text`. **Nothing per-project ever reassigns it** (verified:
the only write is the initializer). So every project ships the same placeholder buy menu — the exact
"one hardcoded blob for everyone" disease this whole tool exists to cure (the `W`-never-lands bug,
in the bet-mode surface).

The math half is *already* here: `betModes[mode] = { cost, feature, buyBonus, rtp, max_win }`. What is
missing is (a) the presentation — which modes are a **buy** vs a persistent **ante**, their display
order, and their **text** — and (b) routing that text through localization.

Split by *one fact, one home*:

| Piece | Home |
|---|---|
| Which modes exist (the count), `cost`, `rtp`, `max_win`, `feature`/`buyBonus` | **config** `betModes` (already) |
| `kind` (base/ante/buy), display `order`, **source** `text` (title/description/button/dialog) | **config** — new `betModePresentation` |
| Translations of that text | **localization** (auto-collected; source read-only, config owns it) |
| Icon / dialog image / volatility art | **deferred** — an asset class, referenced by key via the live-asset pipeline, NOT literal URLs |

**Decision (was open #-none; made here):** the presentation is a NEW OPTIONAL top-level field, NOT
extra keys on each `BetMode`. `betModes` is byte-compatible with the Stake math export on purpose, so
its entries must round-trip a paste-in untouched. This mirrors the `paylineColors` precedent exactly —
an Invisible-Engine extension a paste-in simply omits:

```ts
betModePresentation?: Record<string, {         // keyed by the SAME mode key as betModes
	kind?: 'base' | 'ante' | 'buy';            // default DERIVED: buyBonus→'buy', else feature→'base';
	order?: number;                            //   'ante' (persistent toggle) is explicit-only —
	text?: {                                   //   the two booleans can't express it
		title?: string;                        // SOURCE strings (base language). The runtime renders
		description?: string;                  //   them through translate(), so localization picks
		button?: string;                       //   them up — the "key IS the source text" model,
		dialog?: string;                       //   identical to how scene text localizes.
	};
}>;
```

Sub-phases, each shippable green:

- **6a — schema + resolver (game-config, dependency-free, offline-verified).** Add the field +
  `normalizeBetModePresentation` (sparse, drops entries for a mode that doesn't exist, mirrors
  `normalizePaylineColors`). Add `resolveBetModes(doc)` — the ONE place that folds `betModes` (math)
  + `betModePresentation` (display) into the ordered presentation list the UI needs, owning the
  boolean→`kind` derivation and the default title (the mode key). Validator: an `ante` with no
  authored title warns (it would render its raw key). Extend `game-config-spike`. Nothing consumes it.
- **6b — runtime assembly.** `betModeMeta()` in `game/gameConfig.ts` builds `BetModeMeta` from
  `resolveBetModes(getActiveGameConfig())`, text passed through `translate()`; `Game.svelte` seeds
  `stateMeta.betModeMeta` from it (reset on runtime-bundle apply, like the symbol map). Delete the
  placeholder `DEFAULT_BET_MODE_META`; the un-authored fallback is *derived from the template config's
  own `betModes`* (a `buyBonus` mode → a buy card titled from its key), so an un-authored game still
  has a working menu — just without the fake Samurai copy. Verify in the running game.
- **6c — the tool.** The `/config` Bet modes panel gains, per mode: a `kind` select, an `order`, and
  the text fields (title/description/button/dialog). Numbers (`cost`/`max_win`) already there.
- **6d — localization auto-collect.** `/localization` grows a **Bet modes** section that collects the
  config's `betModePresentation` source strings (read-only source, config owns), same pattern as its
  per-screen scene sections — so bet-mode copy translates like everything else.

## Phase 7 — server-authoritative paylines & reel strips (colour-only in the tool)

The problem this closes: paylines and the in-play symbol set are **the RGS's to declare**, not the
client's to author. The server already ships them on its boot `config` event (`availablePayLines`,
`symbols`, `window`, `wildSymbols`) — the facade even captures it (`captureConfig`) — but the game's
DERIVED display data (info-page line count, per-line pay division, the in-play GATE, the reel-tease
reach) still read the compiled/authored doc. So a project could author 20 lines while the RGS deals
10, and the client would divide the bet by the wrong number and draw the wrong info page. This phase
makes the server the authority for those two panels, and locks them to **colour-only** in the tool.

Open decision #3 above (validate against the RGS) is a superset of this; Phase 7 takes the concrete
first step — not "warn on mismatch" but "there is no mismatch, because the client follows the server".

**The bridge (facade → engine).** The facade is a drop-in for `rgs-requests` and cannot import the
app, so — exactly like `publishWinLevelsToFacade` in reverse (engine→facade) — `captureConfig`
publishes `{ availablePayLines, symbols, window }` to `globalThis.__IE_SERVER_CONFIG__` (`symbols`
mapped into client space first — the engine runs in `H1/L1/S`, not the server's `PIC1/ACE/SCAT`).
Never written when no `config` event arrives ⇒ the global stays `undefined` ⇒ parity.

**The overlay (engine).** `game/gameConfig.ts` gains a `serverConfig()` reader (a live read of the
global, NOT folded into the memoised `getActiveGameConfig()` doc — the config event lands async, after
the memo resets, and the accessors run per-render/per-spin, so a fresh read picks it up with no cache
to invalidate). When present it is authoritative:

- `getPaylines()` / `getNumLines()` → the server's `availablePayLines` (numLines is the bet-per-line
  divisor, so this also corrects displayed per-line pay values).
- `getSymbolsInPlay()` → the server's `symbols` set becomes the in-play GATE — the design's own note
  ("a first-class `symbolsInPlay` replaces the strips as the gate in ONE place and every consumer
  follows"), now realised from the server rather than a doc field.
- `paddingReels()` / `getPaddingReels()` → **auto-generate** cosmetic strips from the in-play set (a
  per-reel rotated repeat, long enough for `initialBoard()` + the roll). It is only the spinning blur;
  no real weights exist to mirror.
- `paylineColor(lineIndex)` → keeps the AUTHORED colours, mapped by the server payline index (a win's
  `meta.lineIndex` = the server paylineId; authored `paylines`/`paylineColors` describe the same lines
  in the same order, so the ordinal maps cleanly to the authored id at that position). Unchanged code,
  since colours read the authored doc directly — that is what keeps it colour-only.

Absent server config ⇒ every accessor falls through to the authored/compiled doc, **byte-identical**.

**The tool (`/config`).** The Paylines panel is READ-ONLY except the per-line colour swatch (which
still saves via the sparse `paylineColors` path); the cell grid, add-line and remove-line are disabled
with a banner saying the server owns the lines. The Reel-strips panel is READ-ONLY / auto with a banner
saying the in-play set + strips come from the server now. The other panels (Identity / Grid / Bet modes
/ Symbols / Win tiers) and the raw-JSON escape hatch are untouched.

**Reaching online games.** The reading code ships in the shared `_runtime/lines` bundle, so an online
game needs a **Runtime release + republish** to pick this up; a `main` merge alone does not reach a
live game.

## Open decisions

1. **Does the config gate the Symbols SM grid directly?** Phase 4 makes the grid derivable from
   the authored config instead of `symbolDefaults/*.json`. Cleaner, but it couples two tools —
   decide when Phase 3 lands and the data is actually there.
2. **Per bet-mode strips.** `paddingReels` is keyed by game type (`basegame`/`freegame`). A buy-
   bonus mode with its own strips would need a third axis. Not needed today; do not pre-build it.
3. **Validation against the RGS.** The client could compare its symbol set to the first `reveal`
   it receives and warn on a mismatch — that would have caught the W bug on the first spin. Cheap;
   worth a phase of its own once the config is authored.

## Key file anchors

- `apps/lines/src/game/config.ts` — the template config being replaced as the source of truth
- `apps/lines/src/game/{types,constants,paytable}.ts` — the three module-scope consumers
- `apps/launcher-api/src/lib/server/runtimeBundle.ts` — where `config` must join the bundle
- `apps/lines/src/editor-scenes.ts` — `bakedGameConfig()` goes beside `bakedSymbolMap()`
- `apps/launcher-api/scripts/publish-symbol-defaults.mjs` — already gates on the strips
- `packages/utils-slots/src/createReelForSpinning.svelte.ts` — consumes the strips while spinning
