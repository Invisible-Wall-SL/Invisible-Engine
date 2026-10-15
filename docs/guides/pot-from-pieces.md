# Build a pot from pieces (the firecracker pot)

A pot whose body is built from many copies of ONE piece — a firecracker — that light up one by one
from the bottom as the pot fills, until the coin head at the top lights at a full pot. When the pot
is consumed every lit piece fires, and you can hang more FX on that moment.

You author the piece once in the Component Editor. Each placement carries its own threshold, so the
same piece is reused for every slot of every pot. The pot itself is the Pot Meter you already have.

Every tool below is a full-page tool in the launcher. The project needs pots (a Hold and Win game, or
the [pots overlay](add-pots-overlay.md)).

## 1. The piece — one firecracker with three stages

Your firecracker rig has three animations, say `off`, `lit` and `fired`. One rig node plays them:
each state of the piece's state machine plays a timeline, and each timeline plays one of the rig's
animations.

**Do:** in `/editor` → **Components**, make a component `Firecracker`.

1. **One rig node** on your firecracker rig, at 0,0. Give it a **Name** (Properties), say `Cracker`,
   because timelines find nodes by name. Leave its default animation alone: the timelines decide what
   it plays.
2. **One param** (a param, not an input): Properties → Component variables → **+ Add variable** →
   **Custom input**, name `lightAt`, kind **number**, **Add**; default `1`. It is the pot's fill share
   (0–1) at which this firecracker lights, and each placement keeps its own. An input of the same
   name will not do: a condition's **{param}** choice lists number params only.
3. **Two inputs** (Properties → Component variables → Inputs):
   - a number `share`, **from** `meter.{meter}.share` — type it. It is the pot's level over its
     maximum, 0..1. `{meter}` is read from the pot the firecracker sits in, so the piece needs no meter
     of its own;
   - a trigger `potActivate` (**+ Add trigger**) — the pot is consumed by its bonus.
4. **Three timelines** (Animate → ＋ New): `Off`, `Lit`, `Fired`. In each, put the playhead at 0,
   select `Cracker` on the canvas, and pick the animation in the **animation** row of the Timeline
   panel (**＋ play from 0.00s…**): `off`, `lit` and `fired` respectively. A strip appears on the
   rig's row and the timeline grows to the animation's length. Scrub to check it on the canvas.
   Leave **Plays on** empty: the state machine plays them.

**Do:** Animate → **State machine**. **＋ State** for each timeline (tick **loop** on `Lit`, and
**Random start** so firecrackers that light together do not move in step), then
wire one layer:

| From | To | Condition | Exit time |
|---|---|---|---|
| Entry | Off | — | — |
| Off | Lit | `share >= {lightAt}` | — |
| Lit | Fired | `potActivate ▸ fired` | — |
| Any | Off | `share < {lightAt}` | 1 |

For `{lightAt}`, pick **{lightAt}** in the condition's value dropdown instead of **value**: the
condition then compares against each placement's own param. The exit time of 1 lets **Fired** finish
before the drained pot turns the piece dark.

**Done when:** in the State machine's preview, setting `share` to 1 moves Off → Lit (the preview
reads `lightAt` at its default), and firing `potActivate` moves Lit → Fired.

## 2. The coin head

The coin head is just another piece that lights last. Make it a second component, `CoinHead`, exactly
as in step 1 (the same param, inputs, timelines and state machine) with the roof-and-coin rig on its
rig node. Its `lightAt` ends up at `1`, so it lights only when the pot is full.

## 3. The pot

**Do:** make the project's own pot: **＋ New component…** of type **Pot Meter (Hold and Win)** (never
edit the built-in Pot Meter itself). Click **Edit inside Pot ›** in the editor bar: the canvas now
edits the part's own nodes. Anything inside the part replaces the coded bar, while the pot keeps its
level, its flights' landing point and its signals.

**Do:** Library → **Components**, drag `Firecracker` onto the canvas once per firecracker, and
`CoinHead` once at the top. Arrange them like the art. (The list leaves out any component that holds
this one, so a placement can never loop.)

**Do:** click **🔥 Light order: bottom → top** in the editor bar (it appears once two pieces are
placed; selecting a container that holds pieces shows it in Properties too). Each piece's `lightAt`
is set from its height: with N heights the lowest lights at 1/N, the next at 2/N, … the highest (the
coin head) at 1. Pieces at the same height light together. Edit any single `lightAt` afterwards to
tune it. **Save**.

**Do:** in the Scene Editor, on the **Pots** screen, select each pot and switch its **component** to
yours. It keeps its position and its **meter**.

**Done when:** each placed piece shows its own `lightAt` in Properties.

## 4. More FX on the full pot

Two hooks, pick what fits:

- **The pot's signals.** `potFull` (the pot just filled) and `potActivate` (it is consumed) are scoped
  to the pot. Make the effect in `/fx` with its layer's **Trigger** set to **On event** and **Event**
  `potFull` or `potActivate`, then place it inside the Pot Meter's `Pot` part: it takes the pot's
  scope and plays only on that pot.
- **An event to Flow.** Give the `Fired` state an **on enter → raise event** to hand the moment to
  Invisible Flow.

## Why it works this way

- The fill share (`meter.<id>.share`) is a 0..1 number the game registers for every pot, so a
  threshold means the same thing whatever the pot's maximum.
- A number condition may name a **param** (`SmCondition.param`) instead of a value. One def, one state
  machine, a different threshold per placement.
- A `{key}` in an input's source reads the placed piece's own params first, then the pot's.
