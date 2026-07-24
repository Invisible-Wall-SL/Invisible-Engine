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
