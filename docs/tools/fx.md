# Invisible FX

An online particle-effect authoring tool. You build an **effect** — a stack of
emitter **layers** — over a project's atlas art, tune each emitter live in a WebGL
preview, and save it. The saved artifact is an **EffectDoc** stored in the project's
cloud storage.

> **Status (as of 2026-10-13):** **All three particle tiers + the full author→ship→fire
> loop ship.** What you get: stack emitter layers (reorder, duplicate, copy/paste them —
> including between effects), draw their particle art from a project atlas, tune every
> emitter knob live — **direction & spread, spin, alpha, scale, speed, gravity, colour and
> a colour overlay, each with an optional per-particle Min / Max range**, plus stackable
> **forces** (gravity at any angle, wind, vortex, attractor, turbulence, drag) — **load a
> project Rig as a backdrop and pin a layer onto one of its bones**, emit **whole rig clips
> as the particles** (Tier C), author **when** a layer fires (ambient, or on a game event),
> and save/reopen the effect. A saved effect travels into a game through the export →
> `deploy/` → bake → pull → register chain, and a layer set to fire **on event** plays
> in-game when a matching event (e.g. a Flow Broadcast) crosses the runtime event bus. Since
> 2026-10-15 any value of an effect can also be made a named **exposed parameter** (⚡), with a
> live preview slider; nothing outside this tool sets those values yet. See the design doc for the
> roadmap and `docs/status/fx.md` for what is still owner-verified.

## What it is

A live particle-authoring surface. An **effect** is a small document (the EffectDoc)
that holds one or more **emitter layers**; each layer is a
`@barvynkoa/particle-emitter` configuration plus the **art** its particles draw from
(one or more regions of a project atlas). You pick atlas regions, tune the emitter
numbers, and watch the result spawn in real time.

- **A layer is one emitter.** Add as many as the effect needs (e.g. a "sparks" layer
  over a "glow" layer); each renders its own live emitter in the preview, stacked.
- **Particle art comes from your project's atlases.** A layer points at one of the
  project's atlases (the same manifests the Scene Editor and Rigger read) and you tick
  which **regions** become the particle frames. Pick more than one region and each
  particle is given one of them at random — weight the mix with the **per-image share**
  sliders, or flip on **Flipbook** to animate through all the frames instead. Particles are
  always atlas-region sprites — there are no built-in abstract shapes. Until you bind a
  region, the preview spawns soft **placeholder dots** so the emitter is still visible
  (see below).
- **A layer can be ambient or fire on a game event.** By default a layer emits
  continuously (ambient). You can instead set it to fire **on event** — choosing one of
  the project's broadcastable event types — so the effect plays in a shipped game when
  that event crosses the runtime event bus (the same vocabulary a Flow Broadcast emits).
- **The preview is the source of truth while you edit.** The center stage rebuilds the
  emitters from the in-memory effect on every change, so the numbers you type are the
  numbers you see.

- **Where it runs:** the launcher itself, at `/fx` — a real full-page tool inside the
  authed `(app)` area, **never an iframe**. The route gates on auth + the `fx` tool
  entitlement and resolves the active project, then renders the stage client-side (it
  mounts its own WebGL `PIXI.Application`, so the page is client-only).
- **Access:** the `admin`, `developer`, `artist` and `pipelineTester` roles get it by
  default (`ROLE_TOOLS` in `src/lib/roles.ts`); the `animator` role does not. Like any tool it
  is overridable per role/user in the admin panel. The save endpoint
  (`POST /api/fx/save`) is `fx`-gated and scoped to your session's active project.

## How to use it

### Open it and pick a project

Sign in to the launcher (`app.invisiblewall.org`) and open **Invisible FX** (the
top-bar switcher lists it as **FX**, next to Flow). Effects and the atlas list are
scoped to the project selected in the top bar — the same project selector the Scene
Editor and Flow use. Switching projects changes which atlases and saved effects you
see.

### Start a new effect or open a saved one

The sub-bar shows the **Invisible FX** label, an **Effect name** field, and the
following controls:

- **⤓ Save** — writes the current effect to cloud storage (see "Save", below).
- **⧉ Save As…** — prompts for a new name and writes a COPY under it, leaving the
  original effect untouched. Use this to branch a variant from an existing effect.
- **+ New** — starts a fresh, empty effect (reloads `/fx` with one default layer).
- **Open effect…** — a dropdown of every effect already saved in this project; pick one
  to open it (this loads the effect's layers and restores the last-selected layer). A
  just-saved effect appears here immediately, without a reload.
- **🗑 Delete** — deletes the open effect from cloud storage and clears the editor. The
  confirm asks you to type the effect's name first. Disabled until an effect has actually
  been saved/opened.
- **▶ Play / ❚❚ Pause** — toggles the live emitters in the preview.
- **Reset view** — re-centres and re-fits the preview camera.

The right of the sub-bar shows a transient save status (a green confirmation or a red
error) and a live **layer count**.

**+ New** and **Open effect…** ask before they throw away unsaved changes. So does leaving the
page with unsaved changes: switching tools from the tool bar or pressing Back asks in the app's own
dialog (**Cancel** / **Leave anyway**), and a reload or closing the tab gets the browser's "leave
page?" prompt.

### Build the layers

The left **Layers** panel lists the effect's emitter layers. Use **+ Add** to add a
layer, click a row to select it (the right-hand Inspector then edits that layer). Each
row shows the layer's key, how many art frames it has, and four buttons:

- **▲ / ▼** — move the layer in the stack. **List order is draw order**: the layer at the
  bottom of the list renders in front. The preview restacks immediately.
- **⧉** — duplicate the layer; the copy lands directly beneath the original with a fresh
  key (`sparks` → `sparks-2`) and is selected for you.
- **✕** — remove the layer. An effect always keeps at least one, so this is disabled when
  only one remains.

Below the list, **⧉ Copy** puts the selected layer on a clipboard and **📋 Paste** drops a
copy in after the selected layer. The clipboard survives navigation, so this is how you
**move a layer between effects**: copy it here, open another effect, paste.

### The preview

The center is a live WebGL stage. Each layer runs its own particle emitter; the picked
atlas page is drawn faintly behind them as a **placement reference** so you can see
where your particles sit relative to the art. **Drag** to pan, **scroll** to zoom, and
use **▶ Play / ❚❚ Pause** (sub-bar) to start/stop the simulation. **Reset view**
re-fits. The preview plays at normal speed; in a game, effects play twice as fast while **turbo**
is on — the same particles, in half the time.

**Placeholder dots (a layer with no art).** Particles in this tool are sprites cut from
your atlas — there is no abstract default shape. So a layer that has **no region bound
yet** would render nothing. To let you shape the emitter (rate, spread, motion, fades)
*before* committing to art, the preview substitutes soft white **placeholder dots** for
that layer; they spawn from the **centre of the canvas**. As soon as you tick a region in
the Inspector, the real texture replaces the dots. The dots are a preview stand-in only —
they are never written into the saved effect and are never used by a game.

### Load a rig backdrop (attach to a rig)

Above the preview is a **Backdrop** bar. Pick one of the project's rigs (the same
skeletons the Rig Viewer and Rigger list) to load it into the stage as a playing
backdrop; an **animation** dropdown then lets you choose the clip (it loops), and a
**skin** dropdown appears when the rig has more than one skin. Choose **— none —** to
remove the backdrop. The skeleton plays in step with **▶ Play / ❚❚ Pause**.

With a backdrop loaded you can **pin a layer onto a bone** (see Inspector → Placement),
so its emitter rides that bone every frame — a flame welded to a moving torch tip, a
sparkle off a wand. The backdrop is an **authoring aid only**: it is not part of the
saved effect (only the layer's chosen bone name + offset are).

### Tune a layer (Inspector)

With a layer selected, the right **Inspector** edits it. Most rows end in a **⚡** button — see
[Exposed parameters](#exposed-parameters) below.

- **Layer → Name** — rename the layer (its key, shown in the Layers panel).
- **Particle → Kind** — **Sprite (atlas art)** (the default; the **Art** section below
  picks the frames) or **rig clip**, where every particle is a small rig instance
  playing a clip. For a rig clip, pick a **Skeleton** from the project's rig bundles,
  then an **Animation**, and tick **Loop each particle's clip** if it should repeat. Keep
  **Max particles** low for this kind (tens, not hundreds) — a rig particle is far
  heavier than a sprite. The option is disabled when the project has no rig bundles yet.
- **Art → Atlas** — a dropdown of the project's atlases. Pick one and a checkbox list of
  its **regions** appears below; tick the regions you want as the particle frames. (If
  the project has no usable atlases yet, the panel tells you to make one in the Atlas or
  Sheet Maker first.) While the layer has **no region bound**, the panel shows a hint
  reminding you the preview is showing placeholder dots and to pick an atlas + tick a
  region for the real particle. When a layer has **more than one** frame, a **Flipbook
  (animate frames per particle)** toggle appears — on, each particle animates through all
  the frames; off (the default), each particle is given **one** of the frames at random.
  With Flipbook off, a **Mix — per-image share** control appears with a slider per frame:
  drag them to weight how often each image is picked (a `%` readout shows the resulting
  share). This is how you make, say, a 70/30 coins-to-gems burst. Leaving the sliders even
  gives a uniform mix. With Flipbook **on**, you also get its playback:
  **Match particle lifetime** (the default — the frames are stretched across each
  particle's life so the sequence plays through exactly once, however long the particle
  lives), or untick it for an explicit **Speed (fps)** plus a **Loop while the particle
  lives** toggle (off = the animation holds on its last frame once it has played).
- **Sprite** (sprite layers only) — how the art sits on each particle. **Rotation (°)**
  (−180..180) turns the art by a fixed amount without changing where the particle flies; it
  adds to any spin or **Locked angle**, so e.g. art drawn pointing up can be turned 90° to
  face along its travel. **Pivot** is a 3×3 grid (corners, edges, centre) picking which point
  of the art sits on the spawn position and that the art turns around — **Top** hangs the art
  below the spawn point, **Bottom** stands it on top, and so on; **Pivot X / Y** (0..1) set
  any point in between. The defaults (0°, centre) are the library's own, and a layer left at
  them stores nothing extra. **Apply preset…** keeps the layer's Sprite settings.
- **Placement** — where the layer's emitter sits. **Mode** is **Free (scene)** (spawns
  at the scene origin) or **Bone (rig)** (follows a bone of the loaded rig backdrop —
  enabled only when a backdrop is loaded). In **Bone** mode a **Bone** dropdown lists the
  rig's bones; **Offset X/Y** nudges the spawn point relative to the scene origin (Free)
  or the followed bone (Bone).
- **Trigger** — *when* the layer fires. **Mode** is **Always (ambient)** (the layer
  emits continuously, the default) or **On event**. In **On event** mode more
  controls appear:
  - **Event** — the bus event/cue name the layer fires on. It's a **combobox**: pick a
    suggested name or type any custom cue. The suggestions are the project's real firing
    names, unioned from two sources — the game's exported **emitter vocabulary** (the same
    names a Flow **Broadcast** node offers) and every **cue** the project's **Flow v2**
    graph actually broadcasts (its `fireCue` nodes). Whatever you enter must **match the
    name Flow emits** exactly — the layer fires when a broadcast of that name crosses the
    runtime event bus. Typing a custom cue is fine (e.g. a Flow v2 cue not yet in the
    exported vocabulary). An empty event means the layer is set to fire on an event but has
    none bound — it stays dormant (the fail-safe) until you enter one.
  - **Stop event** — *optional* second cue that **stops** the layer: fire on **Event**,
    keep emitting, then stop when a Flow Broadcast / `fireCue` of this name is emitted.
    This is for a **continuous** effect that Flow switches on and off with two cues.
    Leave it blank to stop by **Duration** / `emitterLifetime` instead (a burst). A stop
    cue equal to the fire cue is ignored (a cue can't both start and stop).
  - **Scope** — *optional*: fire only on events about one part of a repeated feature, such
    as a pot's meter id (`red`, or `meter:red`), a jackpot tier (`grand`) or a reel. It is
    matched against the event's `scope`. The game sets that on its pot, jackpot and letter
    events (`meter:red`, `tier:grand`, `reel:2`), and a Flow **Fire Cue** sets it with its
    scope pin. An event with no scope still fires the layer, and `*` fires on every part.
    Leave it **blank** in the usual case:
    - Placed inside a scoped component (a Pot Meter, a jackpot tile, or your own component
      **scoped by** a param), the effect takes that component's scope. It skips the other
      parts of that kind, so one "pot full" effect authored into the Pot fires only on the
      pot that filled. Events about another kind of part still fire it.
    - Placed anywhere else, a blank scope fires on every event.
  - **Duration (ms)** — how long the burst emits after the event arrives, then stops.
    Leave it **blank** to let the emitter's own lifetime (`emitterLifetime` in the
    config) — or the **Stop event** — govern how long it runs instead.

  This is what makes "fire effect X on game event Y" authorable end-to-end: the layer
  carries the event binding, and the runtime (after the effect is shipped — see Save)
  plays it when that event crosses the bus.
- **Layer → Preset** — drop in a ready-made effect (Fountain, Fire, Smoke, Sparks,
  Explosion-burst, Rain, Snow, Confetti, Magic glow) and tune it. The preset replaces the
  layer's emitter numbers; its art, placement and trigger are kept.
- **Emitter** — the core emitter numbers: **Frequency (s)** (seconds between spawns),
  **Max particles**, **Lifetime min/max (s)**.
- **Spawn** — where particles are born: **Point**, **Circle** (radius), **Ring**
  (outer + inner radius), **Rectangle** (width/height), or **Burst (ring)** — an even fan,
  one particle every *Spacing°* from a *Start angle*, spawned *Distance* px out. Burst
  owns the launch direction, so the Direction controls step aside while it's selected.
- **Direction & rotation** — **Direction (°)** and **Spread (±°)** set the launch arc
  (0° = right, 90° = down, 180° = left, 270° = up — screen y grows downward; spread 180° =
  every direction, and each particle picks an angle inside Direction ± Spread). **Spin
  min/max (°/s)** and **Spin accel** turn the particle as it flies — each particle picks a
  rate between min and max.
  **On** adds or removes the whole direction control, so a layer that has none can grow
  one. **Lock the particle's angle** pins the sprite to a fixed **Locked angle** —
  particles still travel along the direction, they just don't rotate to face it, which is
  what flat art (confetti, snowflakes, a flipbook) usually wants.
- **Alpha**, **Scale** — each has **On** (add/remove the curve entirely) and a **Start**
  and **End** value, so a particle can fade and grow/shrink over its lifetime.
- **Movement** — **Eased speed** (a **Speed start**/**end** curve along the launch
  direction) or **Acceleration (launch + constant pull)** (**Start speed min/max**,
  **Acceleration X/Y** — positive Y pulls down — a **Max speed** cap, and *Rotate particle to
  its travel direction*). Up-direction (270°) + a downward pull = a fountain. Effects saved
  before this label change are unchanged: it is the same setting.
- **Forces** — a stack of forces that act on the particles **on top of** the Movement above,
  in either model. Pick one from **Add a force…**; each entry has an **On** switch (off keeps
  its numbers but stops it pushing) and **✕** to remove it. Add as many as you like, of any
  kind — they add together. Strengths are in px/s²; angles use the Direction convention
  (0° = right, 90° = down, 180° = left, 270° = up); a **Centre X/Y** is an offset from the
  emitter, so it moves with an emitter pinned to a bone.
  - **Gravity** — **Strength** and **Angle (°)**. 90° is ordinary downward gravity; any
    other angle pulls that way instead.
  - **Wind** — **Strength**, **Angle (°)**, **Gust** (0 = steady, 1 = each particle's push
    swings between none and double) and **Gusts / s**.
  - **Vortex** — **Centre X/Y**, **Direction** (Clockwise / Counter-clockwise), **Swirl**
    (how hard it spins particles around the centre), **Radial** (above 0 flings them
    **out** — centrifugal; below 0 pulls them **in** — centripetal; balance the two for an
    orbit), **Radius** (0 = reaches everywhere) and **Falloff** (0 = full strength out to the
    radius, 1 = fades linearly to nothing at it, higher = fades faster).
  - **Attractor / repulsor** — **Centre X/Y**, **Strength** (positive pulls in, negative
    pushes away), **Radius**, **Falloff**, and **Absorb radius**: particles that reach it
    disappear (0 = never) — a sink.
  - **Turbulence** — **Strength**, **Cell size** (small = jittery, large = lazy swirls) and
    **Evolve / s** (how fast the swirls change). The field swirls particles around without
    bunching them into clumps.
  - **Drag** — **Amount**: air resistance. Gravity plus drag settles at a steady falling
    speed instead of speeding up forever. Drag slows the forced motion, and in the
    Acceleration model the launch too; with Eased speed the speed curve keeps owning the
    launch (lower its End to slow it).

  A layer with no forces is saved exactly as before; removing the last force removes the
  whole thing from the effect.
- **Min / Max (vary per particle)** — Alpha, Scale and the eased Speed each carry this
  toggle. Off, every particle follows the same curve. On, Start and End each split into a
  **min** and a **max**, and every particle spawns somewhere in the Start band and ends
  somewhere in the End band. **All four bounds are independent** — moving one never drags
  another. All four sliders share one axis, so dragging a `max` moves only that thumb and its
  `min` keeps the exact number you set. Setting a min equal to its max simply means "that end
  doesn't vary"; it does not switch the mode off — only the toggle does that. The one case
  where a max *does* move its min is dragging the max **below** it, which takes the min down
  with it.
- **Colour** — **Tint particles over life** interpolates a **Start** and **End** colour
  across each particle's life (identically for every particle). **Colour overlay
  (per-particle intensity)** is the varying one: pick an **Overlay** colour and an
  **Intensity min/max**, and every particle draws its own strength in that band — 0 leaves
  the art untouched, 1 replaces it with the overlay colour. It lays on **top** of the
  over-life tint, so a spread here breaks up a flat-coloured burst.
- **Blend mode** — Normal / **Add (glow)** / Screen / Multiply. Add and screen give the
  additive glow fire, sparks and magic want.

### Exposed parameters

An **exposed parameter** is a named value (`intensity`, `heat`) the game — later a binding, a
timeline or Flow — sets on a placed effect, and that changes one or more of the effect's values.
Any value can be exposed, not just a fixed list.

- **⚡ on a row** opens a small menu: **New parameter…** asks for its name and makes a parameter
  that drives what the row writes, starting at the row's current value (so nothing changes on
  screen); **Drive with "…"** adds the row to an existing parameter instead. The ⚡ sits on the
  sliders, the number boxes (Offset X / Y), the colour fields (Start, End, Overlay) and the
  switches that set a value (a force's **On**, **Rotate particle to its travel direction**).
  Switches that add or remove a section, the art, the trigger and the flipbook settings cannot be
  driven — their ⚡ says so.
  - A row that writes more than one value is exposed whole: **Direction** drives both ends of the
    launch arc, a rectangle's **Width** its width and its centring.
  - **Lifetime min** drives only the minimum. It drags the maximum along only when it passes it,
    and a parameter does not do that.
  - A value typed outside the slider's range (an **Offset X** of 640 on a −500..500 row) widens
    the new parameter's range to include it, so exposing never changes the look.
  - Some values exist only once the row is off its default, e.g. **Spin** at 0, or **Rotation** at
    0° with a centred pivot. The menu then says to move the row first.
- **All parameters** (bottom of the Inspector, collapsed) lists every value in the layer a
  parameter can drive — emitter fields, every behaviour's numbers, colours and on/off values,
  the offset — each with its own ⚡, for the ones with no row.
- **A driven row** shows the parameter's name under it, ⚡ highlighted (click it to jump to the
  parameter). If the row writes the parameter **as is** (Frequency, an alpha end, a colour), editing
  the row edits the parameter's **default**. If the parameter is **mapped** onto it (Direction, or a
  0–1 intensity driving Frequency), the row is **read-only**: change it through the parameter.
- **The Exposed parameters panel** (left column, under the layers) holds one card per parameter:
  - its **name** (the id a binding or Flow sets) and **kind** — Number, Colour or On / off; the
    kind is locked while the parameter drives something;
  - a Number's **Min / Max / Default**, a Colour's or On / off's **Default**, and an optional
    **Note**;
  - its **drives**: which layer and value each one writes, and **from → to** (the value at the
    parameter's min or off, and at its max or on) as editable boxes, or *written as is*. **✕**
    removes a drive. A drive whose behaviour has been switched off (or, in an older effect, whose
    layer is gone) shows a red **⚠** and does nothing until the section is back on or the drive is
    removed. Two drives that write the same
    value show an amber **⚠**: whichever parameter changes last wins;
  - a **Preview** slider (a colour field or a tick box for the other kinds) that moves the effect
    in the stage **live, with no reset** — particles already in flight carry on. The preview is
    **not saved**; **↺** puts it back to the default.
- **What is saved.** The parameters are saved with the effect, and the effect's stored settings
  are always its look **at the defaults** — so the game, the Scene Editor and the Rigger draw the
  default look even where nothing sets a value. A driven value stays at its parameter's default
  even when a preset or a section switch rewrites the layer. Renaming a layer keeps its drives;
  deleting one removes the drives on it (the parameter stays); a duplicated or pasted copy starts
  undriven.

### Save

Click **⤓ Save** to write the effect to the project's cloud storage. The save splits
into two objects: the pure **EffectDoc** at `<client>/<project>/<id>.fx.json` and an
editor-only sidecar at `<id>.fx.meta.json` (your preview camera and last-selected
layer) — the sidecar is kept out of the shipped doc on purpose, so editor state can
never leak into the artifact. The save status in the sub-bar confirms the effect name
and layer count. A brand-new effect takes its filename from its **name** (slugged), so
two effects with different names save to different files — give each effect a distinct
name (or use **⧉ Save As…**) to keep them separate. Once saved (or opened), the id is
stable, so renaming an effect and saving again updates the same file in place rather than
spawning a duplicate. Reopening an effect restores its layers, the Inspector, and the
layer you last had selected.

**Two people on one effect.** Only one person edits an effect at a time. If someone else
(or another tab of yours) has it open, a banner reads "*name* is editing this — read-only"
and Save, Save As and Delete are disabled; **Take over** moves editing to you, and the
other tab turns read-only. If someone saved the effect after you opened it, **⤓ Save**
stops and asks **Overwrite their effect with yours?** Effects have **no version history**,
so overwriting permanently replaces their version — cancel and use **⧉ Save As…** to keep
both.

### Getting a saved effect into a game

Saving stores the effect; it does **not** by itself update a running game — a game picks
up effects the next time it is **published/baked**. When the project is built, the effect
travels the standard chain (export → `deploy/effects/` → bake → pull → register), the same
path the editor art and Flow document take. After that, a layer set to fire **on event**
plays in-game whenever a matching event crosses the runtime event bus (for example a Flow
**Broadcast** of the layer's event type). So "author the effect here, fire it on a game
event" works end-to-end — it just requires a publish/bake to reach the live game, not a
mere save.

## Traps

- **An effect opens with only the faint backdrop and no particles.** Particles spawn around the
  centre of the preview; with a narrow window (or DevTools docked beside it) the canvas between the
  two side panels shrinks to a strip and they fall off its sides. Widen the window, then **Reset
  view** or scroll out. Nothing is lost.
- **An always-on effect never appears in the game.** A game ships only effects something reaches:
  placed in the Scene Editor or inside a component, bound to a rig event in the Rigger, used by a
  symbol in Invisible Symbols, or set to fire **On event**. An **Always (ambient)** effect that is none of these is
  left out. Place it in the Scene Editor (Library → **Effects**) where it should play.
- **An On event effect bursts in the top-left corner of the game.** A **Free (scene)** effect that
  isn't placed plays at the game's origin — the top-left corner — plus its **Offset**. Place it in
  the Scene Editor, or inside a component, at the spot it belongs; it still fires on its event
  there. A placed effect plays only where it is mounted: one inside a component plays on each
  placed copy that is on screen when its event fires.

## What it does not do yet

- **It authors the effect and its trigger binding, not the broader flow.** Invisible FX
  owns the effect (its emitters, art, placement) and the event it fires on. The wider
  presentation flow — what *broadcasts* that event, and when — is authored in Invisible
  Flow; FX and Flow meet at the shared event vocabulary.

## Known limitations / TODOs

- **Exposed parameters are set only by this tool's preview so far.** The game draws each effect
  at its defaults. Setting a value from a component, a timeline, a state machine or the game clock
  is the next part of the plan.
- **Whole-effect opacity, size, tint and speed can't be exposed here yet.** The game supports them
  (an effect-level size then scales free layers only — a layer pinned to a bone keeps its bone's
  size), but no row in this tool writes them.
- **A driven Emitter lifetime applies the next time the layer starts emitting**, not to a burst
  already running.

- **Live in-game firing needs an owner pixel-verify.** The full author→ship→fire loop is
  wired and headless-tested, but firing a baked effect on an event in a real game (in
  particular the rig bone-attach coordinate frame) has not yet been owner-verified on
  live WebGL pixels.
- **One atlas per layer.** A layer's frames come from a single atlas; mixing regions
  from different atlases in one layer is not supported — add another layer instead.
- **Forces don't vary per particle**, apart from each particle's own gust and turbulence
  phase. A force's centre is a fixed offset from the emitter; it can't be keyed or follow a
  different bone than the emitter's.
- **Not everything can vary per particle.** Frequency and Max particles are emitter-wide,
  and the Acceleration model's pull is a constant field — none of them are per-particle values,
  so they have no Min / Max. Lifetime, the launch arc, spin and the gravity start speed
  are already authored as ranges.

## For developers

- **Design + build plan:** [`../design/invisible-fx.md`](../design/invisible-fx.md) is
  the source of truth (the EffectDoc schema, the three particle tiers, the Phase-0 gate
  for the rig-as-particle tier, the phased plan, and the deploy→bake→pull→register
  chain the effect must travel to ship).
- **The tool page:** `apps/launcher-api/src/routes/(app)/fx/` — `+page.server.ts`
  (SSR off; auth + `fx`-scope gate; streams the project's atlas list via the shared
  `loadRegionSet`, the saved-effect index, the optionally-opened EffectDoc + its sidecar
  on `?effect=<id>`, and the project's emitter **vocabulary** `eventTypes` — resolved by
  the LayoutDoc `gameType` via `resolveEmitterVocabulary`, the same source `/flow` uses, so
  the Trigger picker offers exactly the events a Flow Broadcast can emit). `+page.svelte`
  is the authoring shell (sub-bar, Layers panel with the stack ops, Inspector with Layer /
  Particle / Art / Sprite / Placement / Trigger / Emitter / Spawn / Direction &amp; rotation / Alpha /
  Scale / Movement / Forces / Colour / Blend sections, and the Backdrop bar above the canvas).
  `FxStage.svelte` is the WebGL stage (own `PIXI.Application` + pan/zoom/
  play-pause + a live `Emitter` per layer, the centre-spawned placeholder dots for an
  unbound layer, and the Tier-B rig backdrop — loaded imperatively and ridden per-frame,
  replicating `RigBone` for `bone`-placed layers; it also re-appends the emitter
  containers in doc order each rebuild so a layer reorder restacks the preview).
  `fxModel.client.ts` is the pure, rune-free editing model + config/placement/**trigger**
  mutators, the min/max `curveRange`/`setCurveBound` seam, the colour-overlay + rotation-lock
  + flipbook-playback setters, and the layer stack ops (+ the bone-follow coordinate math),
  all harness-covered in `tools/fx-spike` (`variation.ts` for everything min/max-related).
  `fxRig.client.ts` loads a project skeleton via the shared `/rig-viewer/skeletons` +
  `/rig-viewer/file` endpoints (whose `requireRigAccess` gate now also accepts the `fx`
  tool).
- **Save endpoint:** `POST /api/fx/save` (`fx`-gated via the shared `gate` helper,
  mirroring `/api/flow/save` and `/api/rigger/save`); R2 read/write in
  `src/lib/server/fxStorage.ts`, which writes the canonical `<id>.fx.json` and the
  editor-only `<id>.fx.meta.json` as two separate objects and runs `normalizeEffectDoc`
  as the gatekeeper so editor-only state never reaches the shipped doc.
- **The shared package:** `packages/engine-fx` — the EffectDoc schema (`types.ts`,
  re-exporting `EmitterConfigV3` verbatim from `@barvynkoa/particle-emitter`), the
  serialize/deserialize contract (`normalize.ts`), the art→config seam (`bindArt.ts`,
  which also folds the layer's flipbook `framerate`/`loop` into `animatedSingle`), and
  `behaviors.ts` — the four CUSTOM particle behaviors, needed because the library expresses
  per-particle variation as a single whole-curve `minMult`, which locks a curve's two ends to
  one ratio. `fxAlpha` / `fxScale` / `fxSpeed` each mirror their stock twin but carry
  `startMult` + `endMult` — two INDEPENDENT floors, drawn per particle and interpolated across
  its life, so the four authored bounds really are four degrees of freedom. (A legacy `minMult`
  on a stock behavior is read as both floors, so presets and older effects render unchanged.)
  `fxColorOverlay` is the fourth: a colour laid over each particle at a random intensity.
  They are plain, import-free classes, so `registerFxBehaviors(Emitter)` takes the `Emitter`
  class as an argument and the package stays PixiJS-free. **Every renderer must have called
  it** — the runtime does so in `<ParticleEmitter>`, and all three launcher-side stages inherit
  it from `$lib/fx/effectEmitter.client.ts`, which every one of them imports. A config only
  carries these types while the author has that toggle on, so an effect that doesn't use them
  stays 100% stock library config.
- **Forces:** `packages/engine-fx/src/forces.ts` — one more custom behavior, `fxForces`, whose
  config is the force stack (`{ forces: FxForce[] }`). `readFxForces` is the single clamp the
  behavior and the inspector (`forcesOf` / `addForce` / `removeForce` / `setForceField` in
  `fxModel.client.ts`) both read through. It is registered by the same `registerFxBehaviors`,
  so the preview and the game cannot diverge. With `moveAcceleration` / `moveSpeedStatic` on the
  layer it adds into their `config.velocity`; otherwise it integrates its own velocity on top of
  the movement. Gate: `pnpm check:fx-forces` (`tools/fx-spike/forces.ts`, run by the Lint
  workflow).
- **Exposed parameters:** `packages/engine-fx/src/params.ts` — the `EffectDoc.params` path
  grammar (`parseEffectParamPath`), the mapping (`effectParamDriveValue`), the defaults-in-config
  writer `normalizeEffectDoc` runs (`applyEffectParamDefaults`), validation, the leaf listing, and
  the live applier (`createEffectParamApplier` — rebuilds only the driven behaviour and swaps it
  into the emitter's behaviour arrays, never `init`; `bindEffectParams` is what a renderer calls
  after creating or re-initialising an emitter; `createEffectLevelApplier` for `effect.*`). Every
  renderer binds a config through `stepCollapsedValueLists` (in `bindArt.ts`), which makes a curve
  with equal ends render as the constant it is instead of throwing inside the library.
  Runtime: `<EffectPlayer params>` (a getter read on the ticker) → `<EffectLayer>` →
  `<ParticleEmitter fxParams>`, plus `EffectParamGroup.svelte` for `effect.*`. The same applier
  runs in `FxStage.svelte`, the Scene Editor's `EditorEffectLayer.svelte` and `$lib/fx/fxOverlay.client.ts`
  (rebuild `rigger-fx.js` after editing it). The ⚡ model is `fxParams.client.ts` (`rowExposure`
  diffs a row's own setter run on a scratch copy). Gate: `pnpm check:fx-params`
  (`tools/fx-spike/exposedParams.ts`).
- **Sprite transform:** `packages/engine-fx/src/sprite.ts` — the `fxSprite` behavior
  (`{ rotation, anchorX, anchorY }`, read through the `readFxSprite` clamp). The pivot is the
  particle's `anchor`; the rotation offset is carried on `skew = (−θ, θ)`, which PIXI composes
  into a pure rotation by `rotation + θ`, so `particle.rotation` (the launch direction and the
  target of spin / `noRotation` / rotate-to-travel) is never touched. `recycleParticle` restores
  the centred, unskewed default because pooled particles keep both fields across `emitter.init`.
  Inspector: `spriteTransform` / `setSpriteTransform` in `fxModel.client.ts` (back at the
  defaults ⇒ the behavior is removed). Gate: `pnpm check:fx-sprite` (`tools/fx-spike/sprite.ts`).
