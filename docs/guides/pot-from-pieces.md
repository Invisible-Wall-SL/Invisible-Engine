# Build a pot from pieces (the firecracker pot)

A pot whose body is built from many copies of ONE piece — a firecracker — that light up one by one
from the bottom as the pot fills, until the coin head at the top lights at a full pot. When the pot
is consumed every lit piece fires, and you can hang more FX on that moment.

You author the piece once in the Component Editor. Each placement carries its own threshold, so the
same piece is reused for every slot of every pot. The pot itself is the Pot Meter you already have.

Every tool below is a full-page tool in the launcher. The project needs pots (a Hold and Win game, or
the [pots overlay](add-pots-overlay.md)).

## 1. The piece — one firecracker with three stages

**Do:** in `/editor` → **Components**, make a component `Firecracker`:

- **Art:** three nodes, one per stage: `Off`, `Lit`, `Fired`. Each can be a rig, a sprite or a
  flipbook.
- **Param:** add a number param **`lightAt`**, default `1`. This is the pot's fill share (0–1) at which
  this firecracker lights.
- **Inputs** (Properties → Inputs):
  - number `share`, **source** `meter.{meter}.share` — the pot's level over its maximum, 0..1. The
    `{meter}` is read from the pot the firecracker sits in, so the piece needs no meter of its own;
  - trigger `potActivate` — the pot is consumed by its bonus.
- **Timelines** (Animate): `Off`, `Lit`, `Fired`. Each shows its stage's node and hides the other two,
  and plays that node's animation. Make `Lit` loop; give `Fired` the length of its burst.

**Do:** Animate → **State machine**, one layer:

| From | To | Condition | Exit time |
|---|---|---|---|
| Entry | Off | — | — |
| Off | Lit | `share >= {lightAt}` | — |
| Lit | Fired | `potActivate ▸ fired` | — |
| Any | Off | `share < {lightAt}` | 1 |

For `{lightAt}`, pick **{lightAt}** in the condition's value dropdown instead of **value**: the
condition then compares against each placement's own param. The exit time of 1 lets **Fired** finish
before the drained pot turns the piece dark.

**Done when:** in the State machine's preview, setting `share` to 1 moves Off → Lit (preview reads
`lightAt` at its default), and firing `potActivate` moves Lit → Fired.

## 2. The coin head

The coin head is just another piece that lights last. Either make it its own component with the same
inputs, param and state machine (its art is the roof and coin), or place a `Firecracker` whose art you
swap. Its `lightAt` ends up at `1`, so it lights only when the pot is full.

## 3. The pot

**Do:** open the **Pot Meter** (fork it to the project if you have not), and place the firecrackers
and the coin head **inside its `Pot` part**. Anything inside the part replaces the coded bar, while
the pot keeps its level, its flights' landing point and its signals.

**Do:** select the `Pot` part (or any group holding the pieces) → **🔥 Light order: bottom → top**.
Each piece's `lightAt` is set from its height: with N heights the lowest lights at 1/N, the next at
2/N, … the highest (the coin head) at 1. Pieces at the same height light together. Edit any single
`lightAt` afterwards to tune it.

**Done when:** each placed piece shows its own `lightAt` in Properties.

## 4. More FX on the full pot

Three hooks, pick what fits:

- **The pot's signals.** `potFull` (the pot just filled) and `potActivate` (it is consumed) are scoped
  to the pot, so an FX layer `on: event` for one of them, placed inside the pot, plays only on that
  pot.
- **A cue in the piece's `Fired` timeline.** A cue `fx:<name>` broadcasts `<name>`, which any FX layer
  can listen for — a spark on every firecracker as it fires.
- **An event to Flow.** Give the `Fired` state an **on enter → raise event** to hand the moment to
  Invisible Flow.

## Why it works this way

- The fill share (`meter.<id>.share`) is a 0..1 number the game registers for every pot, so a
  threshold means the same thing whatever the pot's maximum.
- A number condition may name a **param** (`SmCondition.param`) instead of a value. One def, one state
  machine, a different threshold per placement.
- A `{key}` in an input's source reads the placed piece's own params first, then the pot's.
