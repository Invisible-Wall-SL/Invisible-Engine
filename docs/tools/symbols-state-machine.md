# Invisible Symbols State Machine

The editable twin of the in-game **Symbol Debug** grid: for each symbol, in each
animation state, rebind the cell to a sprite frame, a spine animation, or an Invisible
Flipbook clip that already lives in R2 — then ship those bindings to the game through the
standard deploy chain.

## What it is

A grid editor for a game's `symbol × state → asset` map. Every game hardcodes a
`SYMBOL_INFO_MAP` — a binding for each symbol (e.g. `H1…H5`, `L1…L5`, `W`, `S`) in each
of six animation **states** (`Static`, `Spin`, `Land`, `Win`, `Post-win`, `Explosion`) —
plus `Clear reel` on a game that cascades or clears its board, and `Intro` on one whose
swap style is **Emerge**.
This tool turns that map into an editable surface: each cell is a **sprite** (a sheet
frame), a **spine** (a bundle + animation name), or a **flipbook** (an Invisible Flipbook
clip — an ordered, timed run of atlas frames). Edits are stored as a **sparse override
doc** in R2 — only the cells you change are recorded; everything else falls through to the
game's coded default.

A `sprite` cell is ONE frozen frame, so Spine used to be the only way to animate a
Spin/Land/Win state. A flipbook clip is far cheaper than a skeleton, and is the fallback
for the Tier-C spine-particle perf ceiling tracked in `docs/status/fx.md`.

It mirrors the live in-game Symbol Debug overlay (`SymbolDebugOverlay.svelte`, gated on
`localStorage.IE_DEBUG=1` + the `d` hotkey), which renders this exact grid read-only.

- **Where it runs:** the launcher itself, at `/symbols` — a real full-page route inside
  `(app)`, behind the auth + role gate. It is not a redirect and never an iframe. The
  grid is client-rendered (the route sets `ssr = false`) because each cell draws a canvas
  thumbnail and the focused cell mounts a live WebGL spine preview.
- **Access:** the `symbols` tool (registry name "Invisible Symbols State Machine", bar
  name "Symbols SM"). Granted to `admin`, `developer`, `artist` and `pipelineTester` roles by default;
  overridable per role/user from the admin panel like any other tool.

The grid is scaffolded from the **active project's** symbol set. The launcher is cloud
and can't import a game's source, so each game publishes its coded `SYMBOL_INFO_MAP` to
R2 at build time and the tool reads it. A project that has built once with a deploy token
shows its own symbols; an un-published project (or `apps/lines` dev) falls back to the
committed `lines` set.

The published set is **filtered to the symbols the game actually uses** — the publish step
reads the game config (`src/game/config.ts` → its `symbols` map, the authoritative in-play
set) and drops any symbol present in `SYMBOL_INFO_MAP` but not in the config (e.g. an unused
`H5`), so the grid mirrors the built game rather than every symbol the engine _can_ render.
A project that published before this filter existed keeps its old full set until it
**republishes** (any tokened build re-runs `publish:symbols`).

On top of that, the grid renders **only the symbols that are IN PLAY right now** — the ones on a
reel strip in [Invisible Game Config](game-config.md), read live. A symbol marked **UNUSED** there
does not appear here at all, because it can never be dealt and art authored for it can never
render. Nothing is deleted: its authored states stay in the doc untouched, and the row comes back
with its art intact the moment you put the symbol back on a strip. (A project with no Game Config
to compare against shows everything.)

## How to use it

You always work in the context of the **active client/project** (shown top-left, with the
tool top bar). Switch projects from the launcher before opening the tool.

1. **Read the grid.** Rows are the game's symbols; the six columns are the states
   (`Static`, `Spin`, `Land`, `Win`, `Post-win`, `Explosion`). Book games add two more
   (`Book intro`, `Book idle`); a game that **cascades or clears its board** adds
   `Clear reel` (see [Two explosions](#two-explosions) below); a game whose
   `/config` → Reel behaviour → swap style is **Emerge** adds `Intro` (see
   [The Intro state](#the-intro-state) below). Stacked-picture tall art is **not** a grid column — it is
   authored in the **Stacked pictures** section (below). Each cell shows its
   **effective binding** — your override if you've made one, otherwise the game's coded
   default. Sprite cells render a frame thumbnail; spine cells render a live animation
   on the shared spine canvas (a chip labels the bundle + animation); flipbook cells render
   the clip's **first frame** as a still, captioned with the clip name + frame count. A cell
   with no binding shows `unset` — and the game falls back to that symbol's `Static` art
   rather than drawing nothing.

   Two states borrow another's binding when they have none of their own, and a cell showing
   borrowed art says so: dashed border, an **inherits &lt;state&gt;** badge, and a tooltip naming
   the donor. `Clear reel` borrows `Explosion` (see [Two explosions](#two-explosions));
   `Book intro` / `Book idle` borrow `Win`; `Intro` borrows `Land`. Binding the cell yourself
   replaces the borrowed art — leaving it alone is a legitimate answer, not an unfinished one.

   Flipbook cells are deliberately _not_ animated in the grid: N per-cell tickers would cost
   far more than the one shared spine canvas, and the question the grid answers is "which
   clip is bound here", which the first frame plus the clip name answers. If a clip is
   deleted in `/flipbook` after being bound here, the cell's caption reads
   `<clipId> (missing)` rather than going quietly blank.

2. **Spot your edits.** A cell you've overridden gets a blue border and an **edited**
   badge. A small **↺** button in its corner **resets that cell to the coded default**
   (removing the override). The whole grid scrolls vertically; cells resize with the
   window.
3. **Open the cell editor.** Click any cell to open the side panel for that
   `symbol · state`. The panel loads a draft of the cell's current binding.
4. **Choose the type.** Toggle between **Sprite**, **Spine**, and **Flipbook**. Switching
   type clears the asset binding _and_ every field that no longer applies (the animation
   name when you leave Spine, the clip when you leave Flipbook), since a frame name is not
   a spine bundle is not a clip.

   - **Sprite:** use the **Frame** picker (the same `RegionPicker` the editor uses) to
     choose a frame from any of the project's atlases/sheets — plus the **shared art
     library** (see below).
   - **Spine:** pick a **Spine bundle** from the project's (and shared) bundles, then pick
     an **Animation**. Once the bundle loads, the animation list is populated from the
     skeleton; if it hasn't loaded yet you can type the animation name. Leaving it on
     **(first animation)** plays the skeleton's first — a fine answer for a rig that carries
     exactly one (most symbol rigs, and `engine-explosion`). A live **Preview** plays the
     chosen animation.

     A banner above the grid lists the cells where that fallback is not safe, and only those:
     a rig with **no** animations (the cell draws its setup pose — a blank symbol in-game),
     or one with **several**, where you get whichever the export happened to list first. The
     banner names the rig and its animation count. It stays quiet for a one-animation rig,
     because there the choice is already made for you.

   - **Playback (Loop)** — on spine and flipbook cells. **Loop is on by default**: the state’s
     animation repeats for as long as the symbol is in that state. Untick it and the animation
     plays once and holds on its last frame.

     Loop off is what you want for a state that is a one-shot BEAT — a Land thump, an
     Explosion. Leave it on for anything resting: a Static idle that holds on its final frame
     reads as a frozen symbol, and if Land and Static point at the same animation you see it
     play twice (once as it lands, once as it settles onto the resting layer) and then stop.

     For a flipbook this OVERRIDES the clip’s own loop setting for this state only, so one clip
     can repeat in one state and hold in another. Sprite cells are a single frame, so they have
     no Playback control.

   - **Flipbook:** pick a **Clip** from the project's Invisible Flipbook clips (each
     listed with its frame count). Picking a clip sets the cell's `clipId` _and_ its
     `assetKey` to the clip's primary sheet, so the cell is never assetless. The panel
     shows the clip's **first frame** as a still — it is not a player; scrub playback
     lives in [Invisible Flipbook](/docs/flipbook), which owns the clip.
     If the project has **no clips yet**, the Flipbook button is disabled with a pointer
     at `/flipbook` rather than an empty dropdown.

     A flipbook cell also carries three **per-state playback overrides**. Each names what
     it is inheriting and takes effect for this one state, so **one clip can serve several
     states** instead of being copied:

     - **Walk** — **Clip's own**, Forward, **Reverse**, or **Ping-pong**. This is the one
       that saves you a whole clip: a symbol that assembles on Land and comes apart on
       Explosion is ONE animation, played forwards and then backwards. Ping-pong runs to
       the end and back, so a cycle is nearly twice the frame count — and the state waits
       for the whole bounce before it reverts.
     - **Mirror (Flip X / Flip Y)** — flips the drawn frames about the cell's centre. A
       render transform, so it needs no second set of art. The tick starts on the clip's own
       value, and un-ticking a clip that IS authored mirrored writes a real "off" for this
       state rather than falling back to the clip.
     - **Speed** — frames per second for this state only. Empty follows the clip.

     Leave them alone and the clip decides — which is what keeps a clip re-authored in
     `/flipbook` moving every state that never overrode it. **Reversing does not need a
     second clip**, and should not use one: a copied clip forks the frame list, so a region
     renamed later has to be repaired in both, and the two drift the moment the art is
     re-packed.

5. **Apply.** **Apply** writes the draft into the working doc as an override (it requires
   an asset to be chosen). The cell updates immediately and is marked **edited**. The
   panel also has a **Reset to default** action for an overridden cell.
6. **Save.** The header **Save** button is enabled whenever the doc differs from what's
   on disk (dirty tracking). Saving `PUT`s the doc to R2 (`PUT /api/editor/symbols`),
   stamps it, and shows **Saved**. Save errors surface inline next to the button.
7. **Reload from R2.** The header **↻ Reload from R2** button re-fetches the spine bundles
   and their previews from R2. Use it after you re-export or replace a spine bundle (e.g.
   re-rigging in the Invisible Rigger) — otherwise the grid + pickers keep showing the
   _cached_ skeleton, because spine art is loaded once per bundle and the skeleton/page
   files are HTTP-cached. Reloading drops those caches (previews refresh with the new art +
   animation names) and re-reads the project's bundle list (a brand-new bundle appears in
   the spine pickers). Your unsaved cell edits are preserved.

### Naming a symbol (what the game calls it out loud)

Each row's left-hand label carries two boxes under the symbol id: **Name** and **Plural**.
This is the word the game _says_ for that symbol — `H1` → "Banana" / "Bananas". The id never
changes; bindings, book events and every other tool keep referring to `H1`.

[Invisible Win Text](./win-text.md) prints it as `{symbolName}`, so with `H1` named a win
reads **"You win $4.00 with 4 Bananas"** instead of naming an id nobody can read. Rename a
symbol here and every win message follows — there is nothing to edit in the other tool.

- **Plural** is used whenever the count isn't 1. Leave it blank for names that don't inflect
  ("Wild", "Bonus", "7") and it reuses the Name.
- A symbol with no name falls back to its id, so an unnamed project still says something
  sensible ("4 H1") — it just isn't a word.
- Names are **text only** — no asset, no export step. They ship with the next
  build/publish like the rest of this doc.
- Names are translatable: they go through the same text resolver as every other authored
  string, so a translated build can say "4 Plátanos".

### Symbol size lives on the reel, not here

This tool no longer sets symbol size — size is a _layout_ concern. To change how big the
symbol art renders inside each reel cell, open the **Invisible Scene Editor** (`/editor`),
select the reel, and use the **"Symbol size (× cell)"** Width/Height control on the reel's
properties (see [the Scene Editor guide](./invisible-editor.md#symbol-size-on-the-reel)).
That value (`reelGrid.symbolSizeRatios`, `1` = the art fills one cell) applies to every
symbol on the board; absent ⇒ the game's built-in per-symbol sizes.

A baked per-cell `sizeRatios` from before this change is still honoured by the engine (it
wins over the reel value), but the tool no longer authors size at any level.

### Highlight (win frame)

Above the grid is a dedicated **Highlight (win frame)** section. The highlight is a
single, **global** spine (not per-symbol, not per-state) that loops over the winning
symbols during a win — the win-frame animation. Every game ships a built-in default:
the local `payframe` animation (spine key `anticipation`), which lives in the game's own
repo, NOT in R2. The launcher vendors its own copy (`static/builtin/spines/`), so the
default still **previews live** and is labelled **Default (payframe)**. A project that
carries its own matching R2 bundle previews that one instead.

- **Change** opens an inline editor: pick a **Spine bundle** from the project's (and
  shared) R2 bundles — the same library the grid's spine cells use — then pick an
  **Animation** (or type the name; blank plays the bundle's first animation). A live
  **Preview** plays the chosen animation.
- **Tint** (below Preview) multiplies a colour over the winning symbols the frame loops
  over. Three modes:
  - **No tint** (default) — the frame renders untinted, byte-identical to before.
  - **Fixed colour** — reveals a colour swatch; the frame tints every win in that one
    colour.
  - **Win-line colour** — the frame tints each win in that paying line's colour, taken from
    the game config's per-payline colours (Invisible Game Config → `paylineColors`). A line
    with no configured colour falls through to no tint.
- **Apply highlight** records the override; the section then shows the override preview,
  an **overridden** badge, and the tint choice (a swatch for fixed, or "win-line colour").
- **Reset to default** removes the override, returning to the built-in `payframe`.

The override is a single optional top-level field on the doc:
`highlight: { type: 'spine', assetKey: <full R2 bundle prefix>, animationName, tintMode?,
tintColor? }`. `tintMode` is `'fixed'` or `'winLine'`; `tintColor` (a `#rrggbb` hex) rides
only the `fixed` mode. When no override is set, nothing is written and the game keeps its
built-in `payframe` — so a project that never touches this section is byte-identical to
before. On export/bake the chosen spine bundle travels the same chain as a per-symbol spine
cell (its bundle is copied into `deploy/editor-symbols/` and registered), and the bundle
records the highlight pointer + tint so the game loads the authored win frame by `assetKey`
and multiplies the tint via the spine's skeleton colour. The **win-line colour** is resolved
in-game per win, so it needs no bake step — it reads the live game config at win time.

### Free-spin board glow

Below the highlight is the **Free-spin board glow** section. The board glow is the
single, **global** spine that lights up _behind the reels_ for the duration of a
free-spin session — the pink "reelhouse" backdrop in a stock game. Like the highlight, the
built-in default (spine key `reelhouse`) lives in the game's own repo, NOT in R2 — and like
the highlight it **previews live** from the launcher's vendored copy
(`static/builtin/spines/`), labelled **Default (reelhouse)**. A project carrying its own
matching R2 bundle previews that one instead.

- **Change** opens an inline editor: pick a **Spine bundle** from the project's (and
  shared) R2 bundles — **including a rig exported from the Invisible Rigger**, which ships
  correctly here because the exporter renames a `.irig` skeleton to `.json` on the way out.
- The glow plays a three-step chain — **Start animation → Idle (loop) → Exit animation**.
  Each is optional: leave one blank and it keeps its coded `reelhouse_glow_*` name, so a rig
  that only renames its loop needs one field. The **Preview** plays the idle animation.
- **Apply board glow** records the override; **Reset to default** removes it.

The override is one optional top-level field:
`boardGlow: { type: 'spine', assetKey, animations?: { start?, idle?, exit? }, sizeRatios? }`.
Nothing is written unless you set it, so an untouched project is byte-identical. The chosen
bundle travels the same export/bake chain as a per-symbol spine cell.

**What this section does and doesn't control.** It owns the glow's **art** — the engine
still owns the _sequence_ (start → idle → exit) and the _timing_. Timing is authored in
**Invisible Flow** (`/flow-v2`): the coded free-spin handlers fire the glow on
`freeSpinTrigger` / `freeSpinEnd`, and a flow that OWNS those events drives it with the
`boardFrameGlowShow` / `boardFrameGlowHide` **Fire Cue** nodes. If you want to replace the
glow _entirely_ — your own layered art, not one spine — use the **Board glow (free spins)**
screen in the Scene Editor instead; real content there suppresses the coded glow (and with
it this section's override).

### Explosion pattern

Shown for a project that has an explosion step to order — one that **cascades**, or one whose
swap-in-place board **clears** itself before the new symbols arrive. Both run through the same beat,
so both are ordered by this one pick. (Same gate as the `Clear reel` grid column.)

On a **board clear** the sweep is measured across the whole board, so `Columns · left to right` empties
it column by column even though the game clears each column on its own beat. Note this is separate
from `/config` → Reel behaviour → **column stagger**, which also spaces the columns out; if you set
both, they add up.

By default the whole board explodes in the **same frame**. Pick a pattern and it comes apart in
**waves** instead, with a gap between each:

| Pattern                         | What it looks like                                                       |
| ------------------------------- | ------------------------------------------------------------------------ |
| `All at once`                   | Every winning symbol in one frame — the default, and what it always did. |
| `Columns · left to right`       | The leftmost winning column pops first, sweeping rightwards.             |
| `Columns · right to left`       | The same sweep pointed the other way.                                    |
| `Columns · centre outwards`     | The middle column first, the wave spreading to both edges together.      |
| `Columns · edges inwards`       | Both outer columns first, closing in on the middle.                      |
| `Rows · top to bottom`          | The top winning row first, then each row below it.                       |
| `Rows · bottom to top`          | Bottom up.                                                               |
| `Diagonal · from the top-left`  | A diagonal wave off the top-left corner.                                 |
| `Diagonal · from the top-right` | The same off the top-right.                                              |
| `Radial · centre outwards`      | Rings spreading out from the middle of the board.                        |
| `Random · one at a time`        | A shuffled order, re-rolled every step — never the same twice.           |
| `One at a time · reading order` | Left to right, top to bottom, one symbol per wave.                       |

- **Gap between waves** — milliseconds between one wave and the next (0–500, default **80**). Only
  shown once a pattern is picked; `All at once` has nothing to space out.
- The panel plays the pattern **live** on a 5×3 board, each cell numbered with the wave it pops on,
  so you can compare shapes without spinning.

**The waves are counted over the symbols that actually won**, not over the board. A win on three
reels pops in three waves — it never waits through two empty ones first — so a pattern reads the
same on a small win as on a full board. The exception is deliberate: `Radial`, `Columns · centre
outwards` and `Columns · edges inwards` measure from the middle of the **board**, so an off-centre
win is seen to be off-centre.

**It costs time.** The gap is added to a step the player waits through on every cascading spin: the
step grows by the gap times one less than the number of waves, so a 5-column sweep at 80 ms costs
320 ms. The two **one-at-a-time** patterns scale with the size of the win rather than the board — a
15-symbol cluster at 80 ms adds over a second — so keep their gap short. There is a hard ceiling of
**2 s on the whole spread**: past that the gap is tightened to fit rather than the round being held
up, so a one-at-a-time pattern at a large gap will play faster than the slider says on a big win.
Everything a pattern plausibly wants is under the ceiling and plays exactly as set.

It is purely how it looks: the same symbols explode, pay the same, and are replaced the same way,
and the step still ends when the last symbol's animation does. Each symbol **goes as its own
explosion finishes**, so the board empties in the same waves it pops in instead of holding the
already-exploded columns on screen — and looping explosion art does not sit there re-playing itself
while the columns to its right catch up. If you also use a **Transition**
(below), it keeps working and it keeps its meaning: each seat's bridge plays the authored delay
after **that seat's** explosion, so the bridges sweep across the board with the waves. The step's
explosion **sound** fires
once with the first wave, as it always has; a symbol's own per-symbol cue (Invisible Sound →
Per-symbol cues) now lands with **that symbol's** pop rather than with the step.

Stored as one optional top-level field, `tumblePattern: { pattern, stepMs? }`. Nothing is written
for `All at once` or for the default gap, so an untouched project is byte-identical. Reaches a
standalone game (Book of Borut) only with an `engine` submodule bump.

### Transition (explosion → intro)

Shown for a project whose `/config` → Reel behaviour → swap style is **Emerge** — the one
style with an `Intro` to bridge — and for one that still has a transition saved from when it
was, so a binding that ships is never hidden. Under it every seat does the same thing on a board clear and on
every cascade step: the outgoing symbol plays its `Clear reel`, is removed, and the incoming
one appears and plays its `Intro`. That seam is a hard cut. The **Transition** is one project-wide
animation the game mounts **at each exploding seat**, a set number of milliseconds after the
explosion fires, so it plays over the explosion's end and the intro's start.

- **Add** opens an inline editor: pick **Spine** (bundle + animation), **Flipbook** (a clip), or
  **FX** (an Invisible FX effect) — the same pickers the Book symbol VFX use. There is no Sprite
  option: a transition has a duration, and a frame has none.
- **Delay (ms)** — how long after the explosion fires the transition starts. `0` (the default)
  starts it with the pop. Leave it blank for `0`; it is not written. It is measured from **that
  seat's own** explosion, so it means the same thing on a board clear, on a cascade, and under an
  Explosion pattern that pops the seats in waves.
- **Apply transition** records it; **↺ Clear** removes it. Unset reads _Off — the intro cuts in the
  moment the explosion ends._

What it does and does not do. It is **fire-and-forget**: the game never waits for it, so it cannot
delay the intro, stretch a cascade step, or hang a round — the intro starts exactly when it does
with the transition off. It plays **once** and unmounts itself when it finishes (a spine on its
animation's end, a clip after one pass, an effect after its emit plus its particles' lifetime). A
transition longer than the step is cut when the cascade overlay comes down — author it to the length
of the seam, not the round. It draws **above the symbols**, centred on the seat and sized to the cell
(and to the row's perspective scale); there is no size or offset knob.

The binding is one optional top-level field, `transition: { kind, …, delayMs? }`; nothing is written
unless you set it, so an untouched project is byte-identical. A spine or clip bound here travels the
same export/bake chain as a per-symbol cell; an FX effect is kept reachable at bake like a Book-VFX
effect. Reaches a standalone game (Book of Borut) only with an `engine` submodule bump.

### Stacked pictures

A **Stacked pictures** section (above Win lines) with a master on/off toggle, **off by default**.
Turn it on to make a symbol into a single **tall picture** that fills several cells for the
stacked-picture reel mode — a tall picture is the **only** thing a stacked symbol shows. All of
the stacked config lives here (there is no per-cell `Stacked picture` grid column any more):

- A **multi-select** of your symbols (click a chip to make it stacked; click again to un-stack).
- A **Win beat (ms)** number — how long a winning stack stays lit, which is also how long its win
  picture (below) plays for. The cells under a tall picture have no per-symbol win animation for the
  game to wait on, so it holds this fixed time instead. Leave it blank for the built-in 650 ms.
- For each stacked symbol, a **Height (cells tall)** number (≥ 1) — how many cells the picture spans
  — and **two picture slots**, each with its own preview and its own **Sprite / Spine / Flipbook**
  picker (the same one the grid cells use):

  - **Edit picture** — the _resting_ picture, what the stack shows by default. Usually the still.
  - **Add / Edit win picture** — the _winning_ picture, shown only while that stack is part of a
    paying line: the spine or flipbook it pays out with. **Optional** — leave it unset (or **Clear**
    it) and the stack simply keeps showing its resting picture through the win, exactly as before
    this slot existed.

  Each slot is seeded from the symbol's own art when you first open it — the resting slot from its
  `Static` binding, the win slot from its `Win` binding — so the picker opens on the real symbol;
  swap it for your tall picture.

Unlike the earlier version, this config **is shipped**: with the toggle on and at least one symbol
authored it bakes as `bundle.symbols.stacked = { symbols: [{ name, height, art, winArt? }] }`, and
each tall picture's asset travels the normal symbol export/bake chain (spine bundle / sprite sheet)
exactly like a per-cell binding — so the picture that shows in the tool is the one the game loads.
Everything is sparse: turn the toggle off (or author nothing) and the project bakes **no** `stacked`
field and is byte-identical to before. (Whether the stacked-picture reel mode is armed in-game is
still gated by the `enableStackedPictures` Flow effect.)

### Win lines

Below the board glow is the **Win lines** section: the in-game winning-payline overlay's
**line** — the stroke traced across each winning payline — with its own **global** on/off
toggle. The stamped win amount is the **separate** section right below it (see [Win amount
text](#win-amount-text)), so the two are authored independently: turn Win lines off and Win
amount text on to announce the amount with no line drawn under it, or the reverse. Both are
pure config (no asset, no preview). The toggle is **On by default**; when it's on the line
controls appear:

**Use payline colour from config** on/off (default **On**); **Colour**;
**Thickness** (a fraction of the symbol size); **Glow** on/off and its **Glow colour**;
**Animated draw** on/off (the line draws from the first paying tile to the last, _then_ the
amount appears) and its **Speed** (a draw-speed multiplier; disabled unless Animated is on);
**Show full payline** on/off and its **Full payline colour**. Off (default) the line traces
only the winning symbols, up to where the amount is stamped; on, the WHOLE payline is drawn
across all reels in the chosen colour, with the winning segment on top (the colour is that
underlay's only style option; disabled unless the toggle is on). **Use payline colour from
config** on (default) draws each winning line in that payline's colour from the Invisible
Game Config, falling back to the **Colour** swatch when the config has none — so the swatch
is greyed out (overridden). Turn it off to make the swatch authoritative and ignore the
config colour. **Show all win lines at once** on/off (default **Off**) and its **Delay
between lines** (seconds; disabled unless the toggle is on) change how a multi-line win is
told: off, the spin narrates one line at a time — draw it, light its symbols, clear it, next.
On, every paying line of the spin appears together, each one a short beat after the last, each
in its own payline colour, and they all stay on screen until the next spin; the symbols still
celebrate one win at a time underneath them. Set the delay to 0s to have every line appear in
the same frame.

A **Reset line style** button clears the line style back to the game's coded defaults while
leaving every on/off state — and the amount text — alone.

### Win amount text

Its own section, with its own on/off toggle: the win amount stamped for each paying line,
with the authored win message (Invisible Win Text) above it. The toggle **follows the Win
lines toggle until you touch it** — which is exactly what the single toggle these two
replaced used to mean, so an existing project reads unchanged. Once set it stands alone, so
you can stamp the amount with no line under it, or draw the line and say nothing.

- **Font** (chosen from the project's bitmap fonts — the engine builtins
  `gold`/`goldblur`/`silver`/`purple` plus any Font-Maker fonts); **Size** (a fraction of
  the symbol size); **Colour**. Because the amount is bitmap text, the colour _tints_ it —
  clean on a light font, but tinting an already-coloured font (e.g. gold) just darkens it, so
  to recolour cleanly pick a differently-coloured font.
- **Position** — **At the winning line** (default) stamps the amount just past the last
  paying symbol, flipping above the line when there is no room below it and clamped to stay
  inside the reel window. **Centre of the reels** ignores where the win landed and puts the
  amount in the middle of the reel window instead. In centre mode only **one** amount is on
  screen at a time — the win just announced — so with **Show all win lines at once** on you
  read the wins being narrated rather than every amount piled on the same spot.

A **Reset text style** button clears the font/size/colour/position back to the coded
defaults, leaving this section's on/off alone.

Every field of both sections is optional and **sparse**: only an on/off that differs from
its default and the fields you actually change are written, under
`winLine: { enabled?, line?, text? }` on the doc — `enabled` is the LINE's switch,
`text.enabled` the amount's (absent ⇒ it follows the line's), and `text.placement` the
position (absent ⇒ at the line).

Colours are CSS hex strings; `width`/`size` are multiples of the symbol size; `speed`
scales the animated-draw duration; `line.fullPayline`/`line.fullPaylineColor` carry the full
payline option; `line.useConfigColor` carries the config-colour toggle (default ON, so only
the OFF override persists). The game applies its coded defaults for every field the
bundle omits, so a project that never opens this section is byte-identical to before and
the overlay stays on with its default gold line. On export/bake the config is passed
straight through to `bundle.symbols.winLine` (omitted when untouched) — there is no asset
work; the chosen text font travels via the normal font pipeline.

The win-line renderer lives in the **shared engine** (ported 2026-07-14), so every
`runtime:lines` game — including the `apps/lines` reference — draws it from this config via
`bakedWinLineConfig()`. (Historically the renderer was per-game in Book of Borut only; that
is no longer the case.)

### Winning symbols after the spin

A separate section with its own on/off toggle (**on by default**) plus a **Gap between
lines** slider, a **Replay the win line too** switch and a **Replay the win text too**
switch. With it on, once the round's whole
book has been presented the game keeps the winning symbols animating on the resting board —
re-playing their Win state over and over — and stops the instant the next bet starts. Without
it the symbols freeze on their post-win frame the moment the round ends.

**Several paying lines step through one at a time**, in the order the round paid them, then
the rotation starts over: line 1's symbols, gap, line 2's symbols, gap, … so each winning
combination is legible on its own rather than the whole board lighting at once. The slider
is that gap. A one-line win is just the same rotation with a single entry.

**The line rides along by default.** Each pass draws that win's line and stamps its amount in
the same beat order the spin played (the line traces and the amount appears, then the symbols
light), clearing it again before the next line's turn — so the rotation reads as the round's
own per-win narration on repeat. Turn **Replay the win line too** off and the replay
re-animates the winning symbols only, leaving the board's line exactly as the spin left it.

**Replay the win text too** (on by default) gates just the stamped win **amount**,
independently of the line: keep **Replay the win line too** on but turn this off and each pass
still draws the line — just without the number under it. (It's disabled when the line replay is
off, since there's no line for the amount to sit under.) Stored as `winCycle.showText` (only
the off-state persists).

That switch only asks the replay to _reuse_ the line; the **Win lines** and **Win amount
text** sections above still own whether a line and an amount exist at all. With both off
nothing is drawn either way, and a scatter win — which pays "anywhere", not on a line — never
draws one but still lights its symbols. This is also why the replay is its own section rather
than a win-line setting: switching the overlay off must not stop the symbols.

A free-spin feature replays its **last** spin's wins. The replay is skipped while autoplay or
space-hold is running, since the next spin is already on its way.

**Wait for a spin press after a big win (free spins)** (**off** by default) turns the replay
into a between-spins pause. Free spins normally run one after another on their own, so closing
a big win in the middle of a feature hands straight over to the next spin and the reels start
rolling before the player has read the board. With this on, the feature rests on the winning
board instead — the replay above narrating its paying lines — and the next free spin only
starts when the player presses spin. The button stays live and reads **SPIN** for as long as
the game waits; that press neither re-bets (the bonus is already paid for) nor slams the rest
of the feature. The **last** free spin's big win is not held, since the free-spin outro follows
it and already waits for a press, and autoplay/space-hold skips the wait. Independent of the
replay toggle: with the replay off it still holds, on a static board. Stored as
`winCycle.holdAfterBigWin` (only the on-state persists); the hold itself is
`apps/lines/src/game/freeSpinHold.ts`.

Stored sparsely as
`winCycle: { enabled?, delay?, showLine?, showText?, showMessage?, dimNonWinning?, holdAfterBigWin? }`
— each switch persists only its NON-default state (so `enabled`/`showLine`/`showText` write an
OFF, and `showMessage`/`dimNonWinning`/`holdAfterBigWin` write an ON), plus an authored `delay`
in seconds — passed straight through to `bundle.symbols.winCycle` at export/bake and resolved
by the engine's `bakedWinCycleConfig()` (defaults: on, 0.4s, line drawn, text drawn, no toast,
no dim, no hold). The replay itself is `apps/lines/src/game/winSymbolCycle.ts`, so every
`runtime:lines` game has it.

> There is nothing to replay when [Winning symbols explode](#winning-symbols-explode) is on: those
> symbols are off the board by the time the round's last spin ends. Pick one of the two.

### Winning symbols explode

Its own section, directly under the replay above, and **off by default**.

Turn it on and, once a spin has finished narrating **every** one of its wins, all the symbols that
paid blow up **together** — each playing its **Explosion** animation — **and are then gone**. The
explosion IS the removal: those cells are taken off the board and their seats stay empty until the
next board arrives. It is the difference between a win that stops and a win that goes out with a pop.

**The order is worth being precise about.** Each paying line still narrates on its own, exactly as it
does with this switch off: its line draws, its symbols light, its amount stamps. The explosion is not
part of that — it is one extra beat at the very end, after the last line has had its turn, and every
winning cell of every line plays it at the same moment. That is also why it is not per-line:
overlapping paylines share cells, so a symbol taken off after line 1 would not be there for line 3
to light.

**Every paying spin, not just the last one of a round.** A free-spin feature is one round made of
ten or more spins, and a cascade is one spin made of several boards; each of those that pays gets its
own pop, fired the instant before the board carrying those winners is taken away — so what explodes
is always what you are looking at. (Until 2026-09-11 only the last spin of a book popped, which on
the reference books meant 2225 of 7480 paying base spins and 227 of 250 bonus ones never popped at
all, and their winners were swept by the next board's `Clear reel` instead.)

That end-of-spin timing is what keeps the pop the LAST thing you see of a winning symbol. On a
project that also asks its board to empty first (`/config` → Reel behaviour → **Clear the board
before the new symbols fall in**), the same symbols used to blow up twice — Win → Explosion, then a
`Clear reel` on the next spin for a symbol the player had already watched explode. The winners now
leave on their own beat and the board clear only pops what is still standing.

**It survives a slam.** Pressing SPIN to fast-forward a paying spin shortens the win narration but
not the pop, which still plays its explosion in full and takes the symbols off. (Until 2026-09-11 a
slammed paying spin froze for about four seconds with the button locked, because the fast-forwarded
win beat kept running behind the pop and reset the cell out from under it.)

The rest of the board is untouched: symbols that did not pay sit there until the next spin and then
play `Clear reel` (or drain, or are simply replaced) exactly as they always did.

The art is whatever the grid's **Explosion** column holds for that symbol. Nothing new to bind: a
symbol with no explosion of its own falls back the way it always does (`Explosion` → `Static`), and
the engine ships `engine-explosion` for exactly this if you have not commissioned one — see
[The shared spine library](#the-shared-spine-library).

Four things it deliberately does NOT do:

- **It does not change how a win is narrated.** With the pop on, each line plays exactly what it
  plays with the pop off — same beats, same length. The explosion is additive, at the end.
- **It does not fire on the resting replay.** The pop happens once per paying spin, at the end of
  it; popping on every pass of a loop would read as a glitch rather than a narration.
- **It leaves nothing for "Winning symbols after the spin" to replay.** The winners are gone, so
  there is nothing to re-light and the board simply rests until the next bet. Turning the pop on is
  therefore a choice against the resting replay — you get one of the two, not both.
- **It skips a symbol hidden under a stacked picture.** Such a cell draws nothing of its own (the
  tall picture is what is on screen there), so it has no pop to play, nothing that could report one
  finishing, and nothing to take off the board.

The beat is capped the same way the win beat is — an explosion bound to art that can never report
completion cannot hang the round. Because every winner pops at once, the whole thing costs ONE beat
whether two symbols paid or twelve. It carries no minimum, though: the readable pause was already
spent on the win itself. A capped pop still removes the symbol, so a cell can never be left standing
because its art said nothing.

Stored sparsely as `winExplode: { enabled: true }` — only the ON state persists, so a project that
never opens this section ships nothing and plays exactly as it did before the switch existed. It
travels verbatim to `bundle.symbols.winExplode` and is read by the engine's
`bakedWinExplodeEnabled()`; the spin's winning set and the three seams it fires at are in
`apps/lines/src/game/winSymbolCycle.ts` (`explodeSpinWinners` /
`explodeWinnersBeforeBoardChange`), and the beat itself is in
`apps/lines/src/components/Board.svelte`.

#### Longest win beat (ms)

The one control in this section that is **not** about the pop, and the only place the tool asks you
how LONG a symbol may celebrate. It sits directly under the section's On/Off switch and applies
whether the pop is on or off.

Leave the box **empty** — the default, and what every project shipped before this existed — and
there is no ceiling: each winning symbol holds the round for exactly as long as its **Win**
animation runs, and then, if the pop is on, for as long as its **Explosion** runs. The authored art
is the pace.

Type a number and no single beat may run longer than that many milliseconds; anything longer is cut
short there. It only ever **shortens**. A symbol whose win animation is already quicker is untouched,
so this is a ceiling on the slow ones rather than a timing applied to all of them. The accepted
range is **50–10000 ms**, and a number outside it is refused rather than quietly ignored — the tool
pulls what you type back into range as you leave the box.

**When you want it.** A cascading game pays this per tumble. Measured on `test6`: every symbol's win
is a 2.00 s spine and its explosion a further 0.50 s, so a three-step winning round spends about
7.5 s on symbol beats alone — on top of the reel spin and the cascade steps — before the next spin is
released. Setting the ceiling to, say, 700 ms takes that to about 2 s without re-exporting a single
animation.

**It is not the engine's runaway guard, and does not move it.** The game already refuses to wait
forever on a beat (`WIN_BEAT_CAP_MS`, 4 s, in `apps/lines/src/game/symbolBeat.ts`) — but that is a
_guard_: it exists for art that can never report finishing (a state with nothing bound, an
animation name the skeleton doesn't have — a LOOPING animation does report, at the end of each
cycle), and it is deliberately sized above anything a project plausibly authors, because a cap a
real animation can hit stops being a guard and becomes the timing. This box is the timing, asked for
explicitly, and it leaves the guard exactly where it is as the backstop underneath.

Stored sparsely as `winBeat: { maxMs }` — clearing the box deletes the key, so a project that never
opens this control ships nothing and keeps its authored pacing byte-for-byte. It travels verbatim to
`bundle.symbols.winBeat`.

### Symbol sounds

**Moved to [Invisible Sound](sound.md) → Per-symbol cues.** The cue one symbol plays entering one
state — a crown that chimes as it lands, a bomb whose cascade pop is its own bang — is chosen there,
beside the game-wide moment it overrides and the library it comes from.

### Reel anticipation

Below the symbol sounds is the **Reel anticipation** section — the presentation FX for the
client-computed _tease_ mode (the reels slowing/escalating while a big win is still reachable on
the reels yet to stop). It is a **game-level** panel, not per-symbol, mirroring Highlight and Win
lines. The **mode itself is armed and disarmed from Flow** (enable / disable anticipation); this
section only _styles_ it.

There is **one tier column per configured big-win tier** — the panel reads the project's big-win
tiers from **Invisible Game Config** (`/config` → "Big win tiers") and shows a column per tier, in
ascending order, headed by the tier's player-facing **name** (e.g. `SUPER WIN`). So the columns grow
and shrink with the config rather than a fixed Big/Mega/Massive triple; each column authors the FX
for its tier, keyed by the tier's **alias**. If the project has **no** big-win tiers yet, the panel
shows a note asking you to add them in `/config` first. Each column has the same controls:

- **Zoom** — how far the camera pushes in toward the armed reels.
- **Overlay scale** / **Overlay opacity** — the per-reel anticipation spine's size and alpha.
- **Overlay tint** — a MULTIPLY tint over the overlay spine (a colour picker). White (`#ffffff`)
  keeps the spine's own colours; a hotter tint tints them — the coded defaults ramp
  white → hot orange as the tiers climb.
- **Loop volume** — the sustained anticipation SFX **loop**'s target volume for that tier.
- **Sting volume** — the one-shot activation **sting**'s per-play volume for that tier. Both volumes
  escalate independently per tier (the "louder after each arm" ramp), and both are relative to the
  player's master SFX volume.

The default values shown in each column come from a coded FX **ramp** interpolated across however
many big tiers there are (the first tier gets the low end, the last the high end), so an escalation
is sensible no matter how many tiers the config defines.

Above the tier columns are three global pickers (one sting + one loop for the whole mode, not
per-tier):

- **Overlay spine** — swaps _which_ skeleton drives the per-reel overlay. The default is the game's
  built-in `anticipation` spine; a swapped bundle must expose the `anticipation_intro / _loop / _out`
  animations, since the game still owns the intro → loop → out chaining (same contract as the board
  glow). Only R2 spine bundles already available to the project are offered — no new asset class.
  The tease's two cues — the activation **sting** and the sustained **loop** — are chosen in
  [Invisible Sound](sound.md) → **Reel anticipation**. Their per-tier **volumes** stay here: those are
  part of the intensity ramp below, not a choice of sound.

Every field falls through to the game's coded value when left at its default, so the doc stays
sparse: an untouched project ships **no `anticipation` key** and the mode is byte-identical to
before this panel existed. **Reset to default** (shown once anything is overridden) clears the whole
section.

Stored as `anticipation: { spineKey?, activationSound?, loopSound?, tiers?: Record<tierAlias, TierFx> }`
— `activationSound` / `loopSound` are no longer authored here (a project that set them before the
move is still read, one rank below the sound doc), and the `tiers` record is keyed by the config
big-win tier **alias** (dynamic, sparse: only overridden tiers appear), each value a sparse
`{ zoom?, overlayScale?, overlayAlpha?, overlayTint?, soundVolume?, stingVolume? }` (tint is a
`#rrggbb` hex). Passed through verbatim to `bundle.symbols.anticipation` at export/bake; the engine
resolves it in `apps/lines/src/game/anticipationPresentation.ts` (`resolveTierFx` /
`resolveAnticipationSpineKey` / `resolveActivationSound` / `resolveLoopSound`), merging each authored
field over the coded `codedTierFx` ramp for that tier's rank among the config big tiers
(`activeBigTiers`). The two cue names resolve sound doc → this doc → the coded
`sfx_anticipation_start` / `sfx_anticipation`.

### Saving is not the last step — shipping a rebind

Save only persists the override doc to R2. For a rebind to actually reach the running
game it must travel the standard live-assets chain, exactly like editor art and fonts:

- **Export** — the bound assets are mirrored into the project's `deploy/editor-symbols/`
  subtree: sprite cells export the frame's sheet (TexturePacker JSON + page); spine cells
  copy the bundle's atlas + skeleton(s) + page(s) verbatim so the relative names still
  resolve. **Flipbook cells are skipped here on purpose** — a clip's art ships through the
  Invisible Flipbook export path, which owns the clip's full ordered frame list; this
  exporter only sees the cell's primary-sheet `assetKey`. An `index.json` records what was
  exported. Triggered by
  `POST /api/editor/export-symbols` (deploy-token gated), which `bake-editor-doc.mjs`
  calls alongside the other exports.
- **Bake** — the baked bundle gains a `symbols: { map, index }` field (the authored
  overrides + the asset index), plus the optional globals `symbols.highlight` and
  `symbols.winLine` (each omitted when unset — `winLine` is written only as
  `{ enabled: false }`). Symbol size is not in this doc; it travels on the layout doc as
  `reelGrid.symbolSizeRatios` (Scene Editor).
- **Pull** — `pull-project-assets.mjs` mirrors `deploy/editor-symbols/` into the game's
  `static/assets/` (build order: `bake:doc` runs **before** `pull:assets`).
- **Register** — the engine's `bakedSymbolMap()` merges your overrides over the coded
  `SYMBOL_INFO_MAP`, and `bakedSymbolAssets()` registers any new sprite sheet / image /
  spine bundle the overrides introduce. Un-baked repos render byte-identical to today.

So a complete rebind is: edit in the tool → **Save** → a tokened game build (export →
bake → pull → register) → republish.

## The shared art library

Sheets listed with a **shared** flag come from `_shared/sheets/` — a cross-project
library any project can bind art from without owning it. It is seeded with the
engine's own symbol set, so a project has something to draw before it has
commissioned anything of its own.

It behaves exactly like a sheet the project owns:

- bind a frame from it in any cell, the same way;
- it travels the export → deploy → bake → pull chain, so art bound from the library
  really ships (it is addressed by the full key of its manifest, which every consumer
  reads verbatim);
- **a project sheet of the same name shadows the shared one** — the library is a
  fallback and can never override work a project owns.

It is **read-only** from the tools: nothing in the launcher writes to `_shared/sheets/`,
so the library is curated out-of-band. To make art your own, export it into the
project's own sheets with the Sheet Maker and rebind.

### The shared spine library

The spine-bundle picker has the same two tiers. A bundle badged **shared** comes from
`_shared/spines/`, resolves project-first (a project bundle of the same name shadows it),
and ships through the same export chain. The full library — chrome and symbols alike — is
listed in [the Scene Editor guide](invisible-editor.md#the-shared-spine-library); the
bundles that matter here are:

| Bundle                                           | Animations                                                      | Bind it to                                         |
| ------------------------------------------------ | --------------------------------------------------------------- | -------------------------------------------------- |
| `engine-symbol-h1`…`h5`, `engine-symbol-l1`…`l4` | `<id>`, `<id>_static`                                           | that symbol's Win / Static                         |
| `engine-symbol-m`                                | `2x`…`10x` × `_land` `_static`, `low`/`mid`/`high_multiplier_*` | the multiplier                                     |
| `engine-symbol-s`                                | `scatter_static` `_spin` `_land` `_win`                         | the scatter, state for state                       |
| `engine-symbol-w`                                | `wild_dynamite` `_static` `_land` `_exploded_static`            | the wild                                           |
| `engine-explosion`                               | `explosion`                                                     | **Explosion**, on any symbol                       |
| `engine-win-meter-explosion`                     | `explosion`                                                     | **Clear reel** — the engine's second, larger burst |

`engine-explosion` exists because `Explosion` was the one state with nothing to bind. Only
the cascade asks for it, so almost nobody authors it, and an unauthored state falls back to
`static` — a symbol that sits still while the board tumbles it away. Bind this and a
cascade reads correctly before you have commissioned an explosion of your own.

### The Intro state

`Intro` is the animation a symbol plays when it **appears on its seat** — the whole of the
**Emerge** swap style ([Invisible Game Config](./game-config.md) → Reel behaviour). Under that
style nothing falls, slides or drains: the symbol simply is there, and this animation is the
arrival.

It could not be folded into `Land`, and that is worth stating because the two look adjacent.
`Land` is the beat **after a movement** — the reels fire it at the end of a roll and a cascade
fires it at the end of a fall — so a game that authored _"rise out of the water"_ there would
also play the rise on every reel stop and every cascade refill.

**Leaving an `Intro` cell empty is not a gap** — it falls through to that symbol's `Land`
binding, so a project that switches the style on before binding any art gets a board that
appears and plays its ordinary landing. The grid draws the borrowed art and badges the cell
**inherits Land**.

The column only appears for a project whose swap style is **Emerge**, but a binding you make is
stored for every game and survives switching the style away and back. A per-symbol _sound_ for
the same moment is picked in [Invisible Sound](./sound.md) → Per-symbol cues.

### Two explosions

A symbol can blow up for two different reasons, and they are **two separate columns**:

- **`Explosion`** — the symbol is destroyed IN PLACE on a resting reel. The Book-of column
  expand is the one that does this: the old symbol pops and the book takes its seat.
- **`Clear reel`** — the symbol is **taken off the board**: the cascade removing it on the
  tumble overlay with the board about to fall, or the board CLEARING before the next spin
  (`/config` → Reel behaviour → **Clear the board**). Either reason earns the column.

**Leaving a `Clear reel` cell empty is not a gap** — it falls through to that
symbol's `Explosion` binding, which is exactly what the engine did before the two were
split. The grid draws that borrowed art and badges the cell **inherits Explosion**, so an
empty column is visibly working rather than silently working. Bind it only when the
cascade should look different from the in-place pop; the engine ships two explosion
skeletons for precisely that (`engine-explosion` is the tight symbol burst,
`engine-win-meter-explosion` the larger one).

It is a **Spine**, not a Flipbook clip, even though the animation is 13 frames: the frames
are a Spine `sequence` attachment played on two slots, the second `additive`, and a clip's
single ordered frame list cannot carry that second layer. (There is also no shared clip
library — clips are per-project only.) Bind it like any other spine cell: pick
`engine-explosion`, animation `explosion`.

**One thing to watch on weight.** The symbol bundles were split out of one shared atlas, so
each carries its own copy of that ~0.75MB page. The Scene Editor's export dedups identical
pages; **the symbols export does not** — it copies a page per bound bundle. Binding all
nine `engine-symbol-*` picture spines therefore ships ~6.6MB where one packed sheet would
ship ~0.75MB. Fine for getting a game readable; pack your own sheet before you ship.

What is in it today:

| Sheet               | Frames                                     |
| ------------------- | ------------------------------------------ |
| `engine-symbols`    | the engine sample set — H1–H5, L1–L5, W, S |
| `engine-multiplier` | `m` — a **placeholder** multiplier symbol  |
| `engine-coin`       | coin frames                                |
| `engine-free-spins` | free-spin frames                           |
| `engine-win-small`  | small-win frames                           |

`engine-multiplier` is a stand-in, not artwork: a plain gold letter M, generated by
`scripts/make-placeholder-symbol.mjs`. It exists because the engine sample set has no
multiplier symbol at all, so a scatter game that declares one had nothing to bind and
rendered a blank cell. Bind it to get a multiplier that reads, then replace it with your
own art — it is sized 200x200 to match the sample set, so a replacement drops in at the
same scale.

One thing to expect: a multiplier cell also draws its **value** (`5X`) over the top as
bitmap text. Gold text over a gold M is low contrast, so if the number is hard to read,
that is the art to change rather than the text.

## Known limitations / TODOs

- **S5 (prove end-to-end) is still pending.** S1–S4 (engine contract, doc schema +
  endpoints, the tool page, and the export/bake/pull chain) have landed, but the full
  round-trip has not yet been proven on Book of Borut. That requires (1) mirroring the S1
  engine contract (`symbolMap.ts` / `getSymbolInfo`) into Book of Borut's own `src/game/*`,
  (2) keeping its symbol frame names unique across bound sheets (the bake step warns on
  collisions), (3) verifying the shared-spine fallback, and (4) actually rebinding a symbol
  online, rebuilding, republishing, and confirming the new asset/animation appears in-game.
- **Preview endpoints are still `editor`-gated.** The sprite/spine preview endpoints
  (`/api/editor/regions`, `/api/editor/spine`) are gated on the `editor` tool, so a user
  who holds **only** the `symbols` tool will get a 403 on previews. The default roles
  (`admin`, `developer`, `artist`) hold both, so this only bites a narrowly-scoped role.
- **Default-art cells render as placeholder chips until project assets are seeded.** The
  tool previews **only** from R2 (sprites under the project's `sheets/`/`manifests/`,
  spines under `spines/`). A game's base symbol art lives in its repo, not those prefixes,
  so until the art is synced into R2 a sprite default shows a labelled placeholder instead
  of a thumbnail. Spine **default** cells also stay chips, because the coded map's short
  keys (e.g. `H1`) aren't real R2 bundle prefixes — only a **rebind** (which stores the
  full bundle prefix) gets a live spine preview.
- **Bindings only.** v1 edits asset bindings within the fixed symbol set and six states.
  Payline geometry, adding/removing symbols or states, and creating/editing spine
  animations are all out of scope (the tool only references existing animations).
- **Existing standalone games must build once to publish their symbols.** A game that
  predates this tool needs the S1 contract mirrored into its own source plus one tokened
  build (or a manual `publish:symbols` run) before the grid shows its real symbols;
  otherwise it falls back to the coded `lines` set. New games get this from the scaffolder
  automatically.
