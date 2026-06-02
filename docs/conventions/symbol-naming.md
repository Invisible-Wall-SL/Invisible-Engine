# Symbol naming convention

The **name of a symbol encodes its pay-class.** A symbol called `H1` is *always*
a high-pay symbol; `S` is *always* the scatter. Both the engine (which keys
behaviour and paytable math off the name) and the authoring tools (Sheet Maker,
Atlas Maker, the Invisible Editor) rely on this — so the name is a contract, not
just a label. Name a region wrong and the engine will treat it as the wrong kind
of symbol.

> **Source of truth = code, not this page.** The authoritative list of kinds is
> `SymbolKindSchema` in `packages/game-spec/src/schema.ts`. This page mirrors it
> for humans. If they disagree, the code wins — fix this page.

## The tiers

| Kind | Name prefix | Pays on | Notes |
|---|---|---|---|
| `high` | `H1`, `H2`, … | bet-per-line (`totalBet / numLines`) | High-value line symbols. |
| `low` | `L1`, `L2`, … | bet-per-line | Low-value line symbols. |
| `scatter` | `S` | the whole total bet, on every line | Pays anywhere; usually triggers a feature. |
| `wildScatter` | `S` | the whole total bet | The special symbol as **both** wild and scatter (e.g. the Book in a Book-of game). |
| `wild` | `W` | — | Substitutes for line symbols. |
| `bonus` | reserved | — | Feature/bonus trigger symbol. Prefix set when first used. |
| `multiplier` | reserved | — | Value-modifier symbol (e.g. ×2). Today `M` appears only as an *asset filename*, not a symbol id; an `M{n}` symbol prefix is not yet established. |

The prefix fixes the kind for `H`/`L`/`W`, but `S` is intentionally **not 1:1** —
the special symbol is either a plain `scatter` or a Book-style `wildScatter`. So
the convention is enforced as *compatibility*, not equality: `H1` must be
`high`, but `S` may be `scatter` **or** `wildScatter`. Confirmed in use today:
`H1`–`H5`, `L1`–`L5`, `S`, `W` (lines uses `S`=scatter; Book-of uses `S`=wildScatter).
`bonus`/`multiplier` exist in the schema but have no established id prefix yet —
give them one here the first time a game uses one.

**No `mid` tier yet** (intentional, owner 2026-06-02). We run high/low only; a
mid tier (`'mid'` kind + `M{n}` prefix) will be added *when a game needs it*, at
which point the prefix table above gets the new row.

## Two things that are NOT this convention

- **Asset key ≠ symbol id.** The symbol `id` (`L5`) is the contract name; its
  `asset.key` (`'M'`, `'l5.webp'`) is just the loaded texture and can differ.
  The convention governs the **id**.
- **RGS / protocol vocabulary is a separate space.** Math exports use their own
  names (`PIC1`, `SCAT` — see `packages/utils-shared/paytable.ts`). Those are
  translated into engine names at the RGS adapter / facade boundary. The engine,
  the editor, and templates only ever speak the engine names above; adapters own
  the mapping. Don't leak `PIC*`/`SCAT` past the facade.

## Where this is (will be) enforced

- `game-spec` — `classifySymbol(id)` (unambiguous prefixes) and
  `isKindConsistentWithId(id, kind)` (the compatibility check, allowing
  `S`=scatter|wildScatter) in `packages/game-spec/src/symbols.ts`. The editor /
  spec validation calls these to keep the name authoritative. (A hard schema
  refinement on `SymbolSpec` is deferred — the compatibility helper is the
  contract for now; see `docs/design/invisible-editor.md` §7.6.)
- **Engine** — derives high/scatter/wild handling from the project's
  `SymbolSpec[]` instead of hardcoding (`HIGH_SYMBOLS` in
  `apps/lines/src/game/constants.ts` is the current hardcoded version).
- **Editor** — groups the asset library by kind and validates mount slots
  ("`reelGrid` needs a scatter") against these names.
