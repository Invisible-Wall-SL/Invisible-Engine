# Invisible Symbols State Machine

The editable twin of the in-game **Symbol Debug** grid: for each symbol, in each
animation state, rebind the cell to a sprite frame, a spine animation, or an Invisible
Flipbook clip that already lives in R2 — then ship those bindings to the game through the
standard deploy chain.

## What it is

A grid editor for a game's `symbol × state → asset` map. Every game hardcodes a
`SYMBOL_INFO_MAP` — a binding for each symbol (e.g. `H1…H5`, `L1…L5`, `W`, `S`) in each
of six animation **states** (`Static`, `Spin`, `Land`, `Win`, `Post-win`, `Explosion`) —
plus `Clear reel` on a game that cascades or clears its board, `Intro` on one whose
swap style is **Emerge**, and eight coin states on a **Hold and Win** game (see
[Hold and Win projects](#hold-and-win-projects)).
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
   (`Book reveal`, `Book idle`); a game that **cascades or clears its board** adds
   `Clear reel` (see [Two explosions](#two-explosions) below); a game whose
   `/config` → Reel behaviour → swap style is **Emerge** adds `Intro` (see
   [The Intro state](#the-intro-state) below); a **Hold and Win** game adds eight coin states (see
   [Hold and Win projects](#hold-and-win-projects)). Stacked-picture tall art is **not** a grid column — it is
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
   `Book reveal` / `Book idle` borrow `Win`; `Intro` borrows `Land`; the Hold and Win states borrow
   `Land`, `Win` or `Explosion` (see [Hold and Win projects](#hold-and-win-projects)). Binding the cell yourself
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

   - **Layers** — see [Layers: a symbol made of more than one picture](#layers-a-symbol-made-of-more-than-one-picture)
     below. Extra art drawn together with this state's own, each piece able to carry its own
     blend mode.

5. **Apply.** **Apply** writes the draft into the working doc as an override (it requires
   an asset to be chosen — and, if you added any layers, art for every one of them). The
   cell updates immediately and is marked **edited**. The panel also has a **Reset to
   default** action for an overridden cell.
6. **Save.** The header **Save** button is enabled whenever the doc differs from what's
   on disk (dirty tracking). Saving `PUT`s the doc to R2 (`PUT /api/editor/symbols`),
   stamps it, and shows **Saved**. Save errors surface inline next to the button.
   If someone else saved this project's symbols since you opened the page, Save does not
   replace their work silently: a **Someone else saved these symbols** dialog asks first.
   **Overwrite theirs** saves your version over theirs (theirs is kept in **History…**);
   cancelling keeps your edits on screen, unsaved, and the next Save asks again.
   Leaving the page with unsaved edits asks first: a tool-bar switch or Back raises the app's
   own dialog (**Cancel** / **Leave anyway**), a reload or closing the tab the browser's prompt.
7. **Reload from R2.** The header **↻ Reload from R2** button re-fetches the spine bundles
   and their previews from R2. Use it after you re-export or replace a spine bundle (e.g.
   re-rigging in the Invisible Rigger) — otherwise the grid + pickers keep showing the
   _cached_ skeleton, because spine art is loaded once per bundle and the skeleton/page
   files are HTTP-cached. Reloading drops those caches (previews refresh with the new art +
   animation names) and re-reads the project's bundle list (a brand-new bundle appears in
   the spine pickers). Your unsaved cell edits are preserved.
8. **History….** The header **History…** button lists earlier saved versions of this
   project's symbols, newest first. Every save keeps a copy of the version it replaces (at
   most one every five minutes while you work; the newest 20 are kept), so a bad edit or an
   **Overwrite** of someone else's save can be walked back. Pick a version and **Restore**:
   the restore is saved like any other save — if someone else saved since you opened the
   page it is refused and you are asked to reload — and it keeps a copy of what it replaces,
   so a restore can itself be undone from the same list. The page reloads afterwards.
   Restore is disabled while another author holds the project (take over first).

### Layers: a symbol made of more than one picture

A symbol state does not have to be one picture. The cell editor's **Layers** section adds
extra art drawn _together with_ the cell's own — a glow sheet over a sprite symbol, a dust
flipbook under it, a sparks effect on top of a spine — and each layer can carry its own
**blend mode**.

**Add layer** appends a row. Each row is a collapsed chip (its thumbnail, its binding, and
badges for `behind`, `no dim` and its blend mode); click it to open its editor:

- **Type** — Sprite / Spine / Flipbook / FX, the same four kinds and the same pickers the
  Book-symbol VFX slots use. Retyping clears the fields the new kind does not use.
- **Draw → Behind the symbol** — off (the default) draws the layer _over_ the cell's art;
  on draws it _under_.
- **Win dim → Dim with symbol** — **ticked by default**. With
  [Darken the non-winning symbols](#winning-symbols-after-the-spin) on, a cell that is not part of
  the paying line is drawn darkened; a ticked layer darkens with it. Untick it and _this_ layer
  keeps full brightness while the rest of the symbol goes dark — for a glow or a rim light that
  should stay lit. It changes nothing when that switch is off, and it is **not previewed here**:
  the dim only happens during a win.
- **Blend** — how the layer's pixels combine with what is already drawn beneath it:
  Normal, Add, Multiply, Screen, Lighten, Overlay.
- **Size × cell** and **Offset × cell** — the same fit hints a Book-VFX layer carries.
  Absent means "fit the cell". For an **FX** layer, Size is a _scale multiplier_ on the
  effect's authored size (1 = as authored), not a cell fit.
- **↑ / ↓ / ✕** — reorder and remove.

**Order in the list IS draw order.** Top of the list is drawn first (furthest back), bottom
last (closest to the front). `Behind` layers go under the symbol's own art in their listed
order; everything else goes over it, also in order. The win frame and the multiplier stamp
stay above all of them — they are readouts of the round, not art you are composing.

A cell may carry up to **8** layers.

Things worth knowing before you author:

- **A layer decorates a bound cell; it never replaces one.** The cell still needs its own
  art. A cell with nothing bound draws nothing at all — layers included.
- **A Spine layer cannot blend**, and the Blend control is replaced by a note saying so. A
  Pixi blend never reaches skeleton geometry, so the mode would be stored and then ignored.
  Spine art blends **per slot**, authored in the [Invisible Rigger](./rigger.md).
  Use a Sprite, Flipbook or FX layer for a blend, or a rig whose own slots carry it.
- **Layers never end a beat.** The round waits for the _cell's own_ art to finish its Win /
  Land / Explosion animation; a layer loops alongside and is never asked. So put the timing
  in the base binding, not in a layer.
- **The masked/unmasked decision is the base cell's.** A cell is drawn on one board layer,
  chosen by the base binding's type. A **spine layer authored bigger than its cell** on a
  sprite- or flipbook-based cell is therefore clipped at the board window, where the same
  rig bound as the cell's own art would not be.
- **Apply is disabled while any layer is unbound**, with a note saying how many need art.
  That is deliberate: dropping a half-finished layer silently would lose your work, and
  sending it would 400 the save and lose the whole doc's edits.

**What the preview does and does not show.** The grid shows each cell's **base binding
only** and adds a **+N layers** badge (hover it for the list) — it cannot composite, because
every spine cell in the grid shares one WebGL canvas. In the panel, each layer previews **on
its own**. Nothing in the tool stacks the layers over the symbol, and **blend modes are not
previewed anywhere** — the composition is only real in the game. The panel says so under the
list rather than showing you something that isn't true.

Layers ship like any other binding: a layer's spine bundle / sheet travels the
export → bake → pull chain under the same key, and an FX layer's effect is kept out of the
orphan sweep on both bundle paths. See
[Saving is not the last step](#saving-is-not-the-last-step--shipping-a-rebind).

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

### Symbol size comes from the art

There is no symbol-size number — not in this tool, and not on the reel either (the Scene
Editor's old "Symbol size (× cell)" control has been removed). Every symbol fits its reel cell
by its own art, keeping its proportions:

- A **sprite** fits by its picture — or by its
  [Art bounds](./invisible-editor.md#symbol-size-on-the-reel) box, when the Scene Editor sets one
  for that region; a **flipbook** by its clip's
  [bounds box](./flipbook.md#the-bounds-box--declaring-the-size-a-clip-is-drawn-at) when it has
  one.
- A **spine** fits by the rig's **declared box**, centred on the cell — the
  [Bounds frame](./rigger.md#bounds-the-rigs-size-frame) in the Invisible Rigger, or the skeleton
  size the Spine Editor wrote on export. Not by the pixels the rig happens to show.

So to make one symbol bigger or smaller, change its art: crop the sprite or set its Art bounds,
box the clip, or resize the rig's Bounds frame. A per-cell `sizeRatios` left in an old doc is
still read but no longer changes the size.

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
for `All at once` or for the default gap, so an untouched project is byte-identical.

### Transition (explosion → intro)

Shown for a project whose `/config` → Reel behaviour → swap style is **Emerge** — the one
style with an `Intro` to bridge — and for one that still has a transition saved from when it
was, or still has [Let the next spin start as soon as the symbols are
back](#let-the-next-spin-start-as-soon-as-the-symbols-are-back) below switched on, so nothing
that ships is ever hidden. Under it every seat does the same thing on a board clear and on
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
effect.

#### Let the next spin start as soon as the symbols are back

A switch at the foot of the Transition section, **off by default**. It sits here because this is
where you come when the seam between two boards feels slow — but it is **not part of the
transition**, and it is deliberately **not** gated on one being bound. The transition is
fire-and-forget and never holds the round; the thing that holds the round is the **arrival**, and
that is awaited whether or not a transition exists. So the switch is offered to any Emerge project,
with or without a transition.

Under **Emerge** ([Invisible Game Config](game-config.md) → Reel behaviour) the round is held until
the **last** symbol has finished its [Intro](#the-intro-state). Turn this on and the round is
released the moment every symbol is back on screen instead. On any other swap style the new symbols
drop, slide or are simply replaced, there is no arrival beat to release the round from, and the
switch changes nothing — the tool says so under it, and keeps it reachable so an authored switch can
be turned back off after a style change.

**It shortens nothing.** Every intro still plays in full, at its authored length, and every symbol
still settles into its resting art at the end — including one whose art can never report finishing,
which is still put right by the engine's own cap. The only thing that changes is what the round
_waits for_: the presentation stops being a gate and becomes something that finishes while the game
carries on. This is what makes it different from [Longest win beat
(ms)](#longest-win-beat-ms), which does the opposite — it cuts an animation short and keeps waiting
for it.

**The trade is yours to accept:** the next spin can begin over an intro still rising. Watch a fast
round once before shipping it. Where it is worth it is the measurement that produced the switch, on
the live `test6`: the board's own clips were finished 2.1 s into a spin and the round released at
3.4 s. The 1.3 s tail was the arrival beat running out its two-second cap, paid on **every** spin,
win or not — and paid again per cascade step, which is why the pause between two wins of one spin
felt the same length as the one after it.

Three things it does NOT touch, all of which look like this at a glance:

- **The transition above it** — that animation is already fire-and-forget; it never gated the round,
  so this switch neither speeds it up nor cuts it short.
- **The cascade's own pacing** — the gap between explosion waves ([Explosion
  pattern](#explosion-pattern)) and the step timing are authored elsewhere and are unchanged.
- **The win celebration** — a paying spin still narrates every win in full. If that is the wait you
  are trying to shorten, the control is [Longest win beat (ms)](#longest-win-beat-ms).

Stored sparsely as `arrivalRelease: { enabled: true }` — only the ON state persists, so a project
that never touches this switch ships nothing and is released exactly as it always was. It travels
verbatim to `bundle.symbols.arrivalRelease`, and is independent of the `transition` field beside it.

### Stacked pictures

A **Stacked pictures** section (above Win lines) with a master on/off toggle, **off by default**.
Turn it on to make a symbol into a single **tall picture** that fills several cells for the
stacked-picture reel mode — a tall picture is the **only** thing a stacked symbol shows. All of
the stacked config lives here (there is no per-cell `Stacked picture` grid column any more):

- A **multi-select** of your symbols (click a chip to make it stacked; click again to un-stack).
- A **Win beat (ms)** number — how long a winning stack stays lit, which is also how long its win
  picture (below) plays for. The cells under a tall picture have no per-symbol win animation for the
  game to wait on, so it holds this fixed time instead. Leave it blank for the built-in 650 ms.
- **Show the tall picture only at full height** (off by default) — on, a landed stack shorter
  than the symbol's height shows the normal single symbols; off, it shows the top of the picture.
- **Cut-off tall pictures at the board edges** (off by default) — on, a stack touching the top
  or bottom edge draws the visible slice of a picture scrolled partly off-screen, whatever its
  length and whatever the switch above says. Stacks away from the edges still follow the switch
  above.
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

Under the style fields sits a **Count up** group — how the amount ARRIVES, rather than what it
looks like. All five controls default **off/unset**, so a project that never opens the group is
byte-identical to before it existed.

- **Count the amount up** (default **Off**) and **Count-up length** (0.1–3s, default 0.6s,
  disabled unless the toggle is on). Off, the amount appears at its full value the moment the
  line lands. On, it runs up from zero over that length — and the win narration **waits for it**:
  the symbols only start celebrating once the number has landed, so the count is read rather than
  talked over. Every counting frame is rendered through the same Invisible Win Text
  `amountFormat` and the same currency as the final value. A slammed spin skips the count
  entirely and stamps the final amount.
- **Count up to cue the big win** (default **Off**, disabled unless Count the amount up is on).
  Turns that count into the big win's run-up, and **only on a round that actually reaches a
  big-win tier** — every other spin keeps the ordinary per-line amounts. On such a round the stamp
  shows the **round total** (not one payline's payout), centred on the reels whatever **Position**
  says, counting from zero up to the smallest big-win threshold from the Invisible Game Config; at
  that number it hides and the big-win overlay comes up and carries the count the rest of the way
  to the total. A project with no big-win tiers configured has no such moment, so nothing changes.
- **Fade the amount in** (default **Off**) and **Fade length** (0.05–1.5s, default 0.3s, disabled
  unless the toggle is on). Brings the stamp up from transparent, **while the count is already
  running** — the number is moving as it arrives, not after. Independent of the count: a stamp
  that appears whole can fade in too.

A **Reset text style** button clears the font/size/colour/position back to the coded
defaults, leaving this section's on/off alone.

Every field of both sections is optional and **sparse**: only an on/off that differs from
its default and the fields you actually change are written, under
`winLine: { enabled?, line?, text? }` on the doc — `enabled` is the LINE's switch,
`text.enabled` the amount's (absent ⇒ it follows the line's), and `text.placement` the
position (absent ⇒ at the line). The Count-up group writes `text.countUp` /
`text.countUpDuration` / `text.cueBigWin` / `text.fadeIn` / `text.fadeInDuration`, each
default-OFF: turning a switch back off drops it AND the field that only makes sense with it
(the count's length and the big-win cue go with `countUp`, the fade length with `fadeIn`).

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

### Coin value label

Shown only on a **Hold and Win** project (a kind with coin symbols), or anywhere a label is
already authored so it can be seen and reset. It styles the value a coin prints on itself — a
cash coin's amount, a collector's total, a payer's `+$4.00`, a multiplier's `×3` and a jackpot
coin's tier. There is no on/off switch: every field you leave alone keeps the game's coded label
(`gold`, 0.3 × the symbol, centred, no pops), and **Reset coin label** puts all of it back.

- **Style** — **Font** (the engine builtins plus the project's Font Maker bitmap fonts, the same
  list as Win amount text), **Size** (× the symbol) and **Colour** (a tint over the bitmap font).
  Used for every label that is not a jackpot.
- **Cash format** — **Show cash as** _Money_ (the player's currency, the default) or _× bet_
  (`1.5×`); **Decimals** — the fewest printed (a non-zero digit is never cut, so a label can never
  read as a different amount); **Trim trailing zeros** (`$3.00` → `$3`, `$1.50` → `$1.5`).
- **Jackpots** — one row per jackpot tier in the project's Game Config (MINI / MINOR / MAJOR /
  GRAND when it declares none): the **text** the tier prints instead of its name (a multiplied
  jackpot keeps its `×2`), and its own font / size / colour (blank ⇒ the cash style).
- **Placement** — **Offset X / Y** from the cell centre (in symbol sizes, Y down), **Scale**, and
  **Max width** — a label wider than that shrinks to fit (coded 0.9).
- **Animation** — **Pop as the coin sticks** (the label pops when the coin lands and sticks on the
  respin board), **Pop when a count lands** (each time a payer, a multiplier or a collect finishes
  counting a label up), each with a pop scale and length; **Count-up length** (ms) replaces the
  coded 600 ms payer / multiplier count, and each collect step scales with it (350/600 of it, the
  coded proportion). Both pops are off by default.

Assetless: it travels to the game as `bundle.symbols.coinLabel`, and a Font Maker font it names
ships with the project's font catalog.

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

**Hold the spin button to keep spinning** (**off** by default). Turn it on and pressing and
holding the spin button plays like holding Space. After a moment (400 ms) the button spins, or
stops a spin already rolling, then rounds keep coming in turbo until the player lets go, and the
player's own turbo setting comes back on release. A quick press stays an ordinary spin. Off, the
button only takes a click. Holding Space works either way, and neither is offered where the
jurisdiction forbids autoplay. It covers the authored HUD's spin button and the coded one. Stored as
`winCycle.spinButtonHold` (only the on-state persists); the hold itself is
`packages/utils-shared/spinHold.ts`.

**Darken the non-winning symbols** (**off** by default) darkens every cell that is _not_ part of
the round's paying lines, from the win celebration until the next spin, so the winning line stands
out. It is a property of the whole board rather than of the replay, so it applies even with the
replay above turned off; a losing spin's board is never dimmed. Individual **layers** of a symbol
can step out of it — see **Win dim → Dim with symbol** under
[Layers](#layers-a-symbol-made-of-more-than-one-picture) — so a glow layer can stay lit while the
art it sits on darkens.

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

**A symbol with no Explosion bound simply leaves, with no pause.** There is nothing to play for it —
an unbound Explosion falls back to the symbol's resting art, which is already on screen — so the cell
is taken off the board without waiting on an animation that would never arrive. Binding an Explosion
for every symbol is therefore a purely VISUAL choice: one that has none costs the round nothing
either way. (Before 2026-09-15 it cost the opposite: such a cell waited out the engine's full
four-second runaway guard, and because the whole pop plays as one beat, ONE unbound winner held up
every paying spin it appeared in. On the live `test6` that was the **scatter** — eight of its nine
in-play symbols bound an Explosion and the scatter did not, so a scatter win cost four seconds of
nothing against half a second for an ordinary line win, which is why the delay looked unrelated to
the animation. The scatter is the likely shape of this in general: it pays "anywhere" rather than on
a line, so it is the symbol most easily left unbound.)

> **Only symbols that are IN PLAY matter here.** "In play" is what the game's reel strips actually
> deal (Game Config → `paddingReels`), not everything listed in this tool. A leftover row for a
> symbol the game no longer deals — `test6` carries two, `L4` and `L5`, the latter still pointing at
> a placeholder mock-up — can never land, never win, and so can never affect a spin either way. Worth
> deleting for tidiness, but it is not costing you anything.

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

Above the tier columns are three global controls, one for the whole mode rather than per tier:

- **Overlay spine** — swaps _which_ skeleton drives the per-reel overlay. The default is the game's
  built-in `anticipation` spine; a swapped bundle must expose the chosen set's intro / loop / out
  animations (`anticipation_intro / _loop / _out` by default), since the game still owns the
  intro → loop → out chaining (same contract as the board glow). Only R2 spine bundles already available to the project are offered — no new asset class.
  The tease's two cues — the activation **sting** and the sustained **loop** — are chosen in
  [Invisible Sound](sound.md) → **Reel anticipation**. Their per-tier **volumes** stay here: those are
  part of the intensity ramp below, not a choice of sound.
- **Overlay animation** — which animation _set_ the overlay plays, for a spine that carries
  several (e.g. differently sized anticipations). It is a base name: the game appends `_intro`,
  `_loop` and `_out`, so `anticipation3` plays `anticipation3_intro` and so on. The unnumbered
  `anticipation` is the default.
- **Overlay size (cells)** — the box the overlay animation is scaled to fit, in cells (1 = one
  symbol). Blank keeps the coded narrow beam, `0.56 × 1.6`; for a full-column animation set
  Height to the reel's row count and Width to about `1`.

Every field falls through to the game's coded value when left at its default, so the doc stays
sparse: an untouched project ships **no `anticipation` key** and the mode is byte-identical to
before this panel existed. **Reset to default** (shown once anything is overridden) clears the whole
section.

Stored as `anticipation: { spineKey?, animationSet?, overlayWidthCells?, overlayHeightCells?,
activationSound?, loopSound?, tiers?: Record<tierAlias, TierFx> }`
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

### Flights (Hold and Win)

Shown for a **Hold and Win** project (and for any project that already authored flights, so they can
be cleared). In Hold and Win things fly across the screen: a coin into the total win at the end of the
feature, coins into a collector, a special into its meter (a pot), an add-respins' respins into the
respin counter, an upgrade's beam at each coin it raises, an unlock symbol into the row it opens.
This section decides how each of those looks and moves. Leave everything alone and the game flies its built-in gold glow.

On the left is the list of **flight kinds**:

- **Into the total win** (`toTotal`) — the feature-end tally and the Grand column sweep.
- **Into a collector** (`toCollector`) — coins into a collector (the Hotfire streak, the collect
  step), and the base game's instant win: each coin flies into its nearest special (Grand's BOOST
  star, Hotfire's COLLECT diamond). Those flights are styled by this row too.
- **Into a meter (every meter)** (`toMeter`) — specials into their pots.
- **Boost beam** (`boostBeam`) — a multiplier (Grand's BOOST star) firing at each coin it boosts,
  during a respin. The coin's value starts counting up when its beam lands.
- **Into the respin counter** (`toCounter`) — an add-respins special's "+N" flying into the respin
  counter (the counter's `respinCounter` anchor; without one it lands at the bottom centre of the
  board).
- **Upgrade beam** (`upgradeBeam`) — an upgrade special firing at each coin it raises, or at the
  jackpot coin it steps up a tier, like the boost beam.
- **Unlock into its row** (`unlockRow`) — on an expanding board, an unlock symbol flying into the
  middle of the locked row it opens, before the row's locked cells fade away.
- One row **per meter** your Game Config declares (`toMeter:<id>`). A single meter uses its own row
  for whatever you set there and falls back to **every meter** for the rest, field by field — so you
  can give the gold pot its own head and keep the shared timing. A meter you authored that the Game
  Config no longer has is still listed, marked _not in Game Config_, so you can reset it.

A row marked **set** has something authored. Pick a row to edit it on the right:

- **Head** — what travels. **Built-in** (or **Inherit** for a single meter) is the gold glow; **Glow**
  re-tints and re-sizes it; **Sprite**, **Spine** and **Flipbook** fly your own art (a spine plays the
  chosen animation on a loop while it flies); **None** flies only the trail. **Size** is × the glow
  for a glow and × one cell for art; **Tint** colours it. A sprite / spine / flipbook head applies once
  its frame, bundle + animation, or clip is picked.
- **Trail** — an Invisible FX effect left behind the head, or **No trail**. The effect is emitted from
  the moving head, so its particles stay where they were born and form a streak; once the head lands
  the trail stops spawning and dies out on its own. Author trails in Invisible FX as continuous,
  free-placed effects (a bone-placed layer does not follow the head).
- **On arrival** — an Invisible FX effect played once where the head lands.
- **Arc** — curves the route even when nothing is in the way, as a share of the straight distance
  (−1…1): positive bows it up on screen, negative down, blank or 0 flies straight. It shapes the
  preferred route only; a win cell in its way still gets the detour below.
- **Avoid win cells** / **Over-route** / **Max detour** / **Padding** — the route. The game picks a
  curve that bends around the cells showing a win; **Max detour** is the strongest bend it may try
  (0 = never bend; blank = the built-in ladder). It only bends a route that would cross a win cell:
  with nothing in the way (the feature-end volley) every flight flies straight. **Over-route** lets it climb over the obstacles when
  no bend is clean, **Padding** grows each win cell (in cells), and **Avoid win cells: Off** flies
  straight through them.
- **Speed** (cells per second), **Min ms** / **Max ms** (the flight time is the distance over the
  speed, kept between the two), **Stagger ms** (the gap between two flights that leave together) and
  **Ease**.

Blank fields show what they will use in grey. **↺ Reset** clears the selected kind.

**The flight preview** under the editor is a mock 5 × 3 board. Drag **A** (where the coin starts)
and **B** (the target), and click a cell to mark or unmark it as showing a win (red). The dashed line
is the route the game would take — planned by the same code the game flies with — and the head flies
it over and over with your timing, head and trail. The line under the board names the route
(straight, a bend, or over) and the flight time. The arrival effect is shown by its thumbnail in the
editor rather than on the board, and the built-in gold trail is drawn as an approximation.

Stored as `flights: Record<kind, { head?, trail?, arrival?, path?, speed?, minMs?, maxMs?, ease?,
stagger? }>`; ships to the game like every other section (a head's art and the trail / arrival
effects ship with it). The plan is in
[the Hold and Win design §4.4](../design/hold-and-win.md#44-flights--things-that-travel-from-a-cell-to-a-target).

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
  `{ enabled: false }`). Symbol size is not in this doc — symbols are sized by their art.
- **Pull** — `pull-project-assets.mjs` mirrors `deploy/editor-symbols/` into the game's
  `static/assets/` (build order: `bake:doc` runs **before** `pull:assets`).
- **Register** — the engine's `bakedSymbolMap()` merges your overrides over the coded
  `SYMBOL_INFO_MAP`, and `bakedSymbolAssets()` registers any new sprite sheet / image /
  spine bundle the overrides introduce. Un-baked repos render byte-identical to today.

How a saved rebind reaches players depends on the game:

- **An online game** (made in [Invisible Game Maker](./game-maker.md)) needs no build: its
  **Publish** runs the export itself and freezes the result as the version players boot. Edit →
  **Save** → **Publish** in Game Maker. Until you publish, players keep the previous version.
- **A desktop-built game** (its own repo) takes the chain above: edit → **Save** → a tokened game
  build (export → bake → pull → register) → republish.

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

Whether the round **waits** for this animation is a separate, project-wide switch —
[Let the next spin start as soon as the symbols are back](#let-the-next-spin-start-as-soon-as-the-symbols-are-back).

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

### Hold and Win projects

A project whose kind is **Hold and Win** sees the grid and the page a little differently.

**Ten more columns** — the respin feature's beats. Each one, left empty, plays what the game
played for that moment before the column existed, so a project that binds none of them looks
exactly as it did:

| Column             | When it plays                                                                                        | Empty ⇒   |
| ------------------ | ---------------------------------------------------------------------------------------------------- | --------- |
| **Coin idle**      | a held coin (or jackpot, or special) at rest on the respin board                                     | Static    |
| **Coin land**      | a respin cell's reel stops on the symbol, before anything sticks                                     | Static    |
| **Coin stick**     | a landed coin sticks — also a mystery, multiplier, add-respins or upgrade landing                    | Land      |
| **Coin collect**   | a coin pulses as a collector takes it, a lit column's coins, or an instant collect on the base board | Win       |
| **Coin boost**     | a special raising other coins — a payer paying, a multiplier boosting                                | Win       |
| **Respins add**    | an add-respins special applying — its "+N" leaving for the respin counter                            | Win       |
| **Coin upgrade**   | an upgrade special applying — raising every coin, the coins around it, or a jackpot coin a tier      | Win       |
| **Jackpot reveal** | a jackpot coin lit for its jackpot, or every held cell on a full board; a coin an upgrade stepped up | Win       |
| **Mystery reveal** | a mystery opening before it becomes what it revealed (plays once)                                    | Explosion |
| **Fly to meter**   | a special lit on the base board while it flies into its pot                                          | Win       |

Coin land and Coin idle borrow `Static`, which is the game's last resort rather than an advertised
inheritance, so those two read `unset` when empty (the tooltip says what plays). The win frame
draws on Coin collect, Coin boost, Respins add, Coin upgrade, Jackpot reveal and Fly to meter, as it
did when they played `Win`. A rolling respin cell plays the symbol's own `Spin`.

**Role chips** — each row head shows the symbol's Hold and Win role(s) as small gold chips
(`coin`, `jackpot`, `payer`, `collector`, `coinMultiplier`, `mystery`, `addRespins`, `upgrade`,
`meterSpecial`, `blank`),
read live from the project's [Invisible Game Config](game-config.md) dictionary.

**Sections that don't apply are hidden** — **Book symbol VFX**, **Stacked pictures**,
**Explosion pattern** and **Transition** have nothing to act on in a Hold and Win game. Each one
stays visible while the project already authors it, so you can always switch it back off.

**Defaults** — an un-published Hold and Win project starts from its own set: the sample line
symbols plus `W`, `BONUS`, `JACKPOT`, `BOOST`, `COLLECT`, `MULTI`, `MYSTERY` and `BLANK` (the
3 Pots preset's names), bound to placeholder art that ships with the engine. `BLANK` has no art —
an empty respin cell draws nothing.

## Traps

- **The wild never explodes.** The dynamite blast _is_ the wild's `Win` animation
  (`engine-symbol-w` → `wild_dynamite`) — there is no separate explosion mechanic. Bind `Win` to a
  still (such as the shared `w.png`) and the win beat still runs, showing a picture that never
  changes, with no error anywhere. Bind `Win` to a spine. The blast _sound_ is fired by an event
  named `wildExplode` on that animation's timeline, so a custom wild rig needs that event too, or it
  explodes in silence.
- **One spine symbol draws far smaller (or bigger) than the others.** A spine fits its cell by the
  rig's declared box, not by what it visibly shows (see
  [Symbol size comes from the art](#symbol-size-comes-from-the-art)), so a box that covers more
  than the resting art shrinks the symbol and a tighter one lets it overflow. Fix the box, not a
  number — see the Traps of the [Invisible Rigger](./rigger.md#traps) (for a Rigger rig) or the
  [Spine Editor](./spine-editor.md#traps) (for a Spine export) — then **↻ Reload from R2** here.
- **A custom anticipation overlay shows nothing while the reels tease.** The game plays exactly
  `<set>_intro`, then `<set>_loop`, then `<set>_out`, where `<set>` is the **Overlay animation**
  (default `anticipation`). If the rig has no `<set>_intro`, the loop never starts. Rename the rig's
  animations to those three names and re-upload it.
- **The anticipation animation looks squeezed into a thin beam.** The overlay is drawn into a fixed
  box — `0.56 × 1.6` cells unless you set **Overlay size (cells)** — and whatever animation you
  pick is scaled to fit it, so picking another animation changes the look, never the size. Set the
  box size.
- **Tall stacked pictures show on some spins and single icons on others.** The two stacked
  switches are independent: **Show the tall picture only at full height** turns short stacks into
  single icons, and **Cut-off tall pictures at the board edges** is what makes an edge stack draw
  a cut-off picture. For "whole stacks tall, edge stacks cut off, the rest single icons", turn both
  on.
- **A sprite symbol shows another sheet's picture in the game.** A cell picked before frame picks
  were tied to their sheet stores only the frame name, so when two sheets pack a frame of that name
  the game can draw the wrong one (the bake warns about the collision). Re-pick the frame in the
  cell editor — a new pick records its sheet — and save.
- **A symbol plays a different symbol's flipbook animation.** The clip itself holds the other
  sheet's frames; fix it in Invisible Flipbook — see [its Traps](./flipbook.md#traps).

## Known limitations / TODOs

- **S5 (prove end-to-end) is still pending.** S1–S4 (engine contract, doc schema +
  endpoints, the tool page, and the export/bake/pull chain) have landed, but the full
  round-trip has not yet been proven on a shipped game. That requires (1) keeping its symbol
  frame names unique across bound sheets (the bake step warns on collisions), (2) verifying
  the shared-spine fallback, and (3) actually rebinding a symbol online, rebuilding,
  republishing, and confirming the new asset/animation appears in-game.
- **Preview endpoints are still `editor`-gated.** The sprite/spine preview endpoints
  (`/api/editor/regions`, `/api/editor/spine`) are gated on the `editor` tool, so a user
  who holds **only** the `symbols` tool will get a 403 on previews. The default roles
  (`admin`, `developer`, `artist`, `pipelineTester`) hold both, so this only bites a
  narrowly-scoped role.
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
  predates this tool needs one tokened build (or a manual `publish:symbols` run) before the
  grid shows its real symbols;
  otherwise it falls back to the coded `lines` set. New games get this from the scaffolder
  automatically.
