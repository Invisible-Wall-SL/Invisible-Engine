# Invisible FX

An online particle-effect authoring tool. You build an **effect** — a stack of
emitter **layers** — over a project's atlas art, tune each emitter live in a WebGL
preview, and save it. The saved artifact is an **EffectDoc** stored in the project's
cloud storage.

> **Status (as of 2026-08-28):** **All three particle tiers + the full author→ship→fire
> loop ship.** What you get: stack emitter layers (reorder, duplicate, copy/paste them —
> including between effects), draw their particle art from a project atlas, tune every
> emitter knob live — **direction & spread, spin, alpha, scale, speed, gravity, colour and
> a colour overlay, each with an optional per-particle Min / Max range** — **load a project
> Spine rig as a backdrop and pin a layer onto one of its bones**, emit **whole Spine clips
> as the particles** (Tier C), author **when** a layer fires (ambient, or on a game event),
> and save/reopen the effect. A saved effect travels into a game through the export →
> `deploy/` → bake → pull → register chain, and a layer set to fire **on event** plays
> in-game when a matching event (e.g. a Flow Broadcast) crosses the runtime event bus. See
> the design doc for the roadmap and `docs/status/fx.md` for what is still owner-verified.

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
- **🗑 Delete** — deletes the open effect from cloud storage (after a confirm) and
  clears the editor. Disabled until an effect has actually been saved/opened.
- **▶ Play / ❚❚ Pause** — toggles the live emitters in the preview.
- **Reset view** — re-centres and re-fits the preview camera.

The right of the sub-bar shows a transient save status (a green confirmation or a red
error) and a live **layer count**.

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
re-fits.

**Placeholder dots (a layer with no art).** Particles in this tool are sprites cut from
your atlas — there is no abstract default shape. So a layer that has **no region bound
yet** would render nothing. To let you shape the emitter (rate, spread, motion, fades)
*before* committing to art, the preview substitutes soft white **placeholder dots** for
that layer; they spawn from the **centre of the canvas**. As soon as you tick a region in
the Inspector, the real texture replaces the dots. The dots are a preview stand-in only —
they are never written into the saved effect and are never used by a game.

### Load a Spine backdrop (attach to a rig)

Above the preview is a **Backdrop** bar. Pick one of the project's Spine rigs (the same
skeletons the Spine Viewer and Rigger list) to load it into the stage as a playing
backdrop; an **animation** dropdown then lets you choose the clip (it loops), and a
**skin** dropdown appears when the rig has more than one skin. Choose **— none —** to
remove the backdrop. The skeleton plays in step with **▶ Play / ❚❚ Pause**.

With a backdrop loaded you can **pin a layer onto a bone** (see Inspector → Placement),
so its emitter rides that bone every frame — a flame welded to a moving torch tip, a
sparkle off a wand. The backdrop is an **authoring aid only**: it is not part of the
saved effect (only the layer's chosen bone name + offset are).

### Tune a layer (Inspector)

With a layer selected, the right **Inspector** edits it:

- **Layer → Name** — rename the layer (its key, shown in the Layers panel).
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
- **Placement** — where the layer's emitter sits. **Mode** is **Free (scene)** (spawns
  at the scene origin) or **Bone (rig)** (follows a bone of the loaded Spine backdrop —
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
  (0° = right, 90° = up, 180° = left, 270° = down; spread 180° = every direction, and each
  particle picks an angle inside Direction ± Spread). **Spin min/max (°/s)** and **Spin
  accel** turn the particle as it flies — each particle picks a rate between min and max.
  **On** adds or removes the whole direction control, so a layer that has none can grow
  one. **Lock the particle's angle** pins the sprite to a fixed **Locked angle** —
  particles still travel along the direction, they just don't rotate to face it, which is
  what flat art (confetti, snowflakes, a flipbook) usually wants.
- **Alpha**, **Scale** — each has **On** (add/remove the curve entirely) and a **Start**
  and **End** value, so a particle can fade and grow/shrink over its lifetime.
- **Movement** — **Eased speed** (a **Speed start**/**end** curve along the launch
  direction) or **Gravity (acceleration)** (**Start speed min/max**, **Gravity X/Y**, a
  **Max speed** cap, and *Rotate particle to its travel direction*). Up-direction +
  downward gravity = a fountain.
- **Min / Max (vary per particle)** — Alpha, Scale and the eased Speed each carry this
  toggle. Off, every particle follows the same curve. On, Start and End each split into a
  **min** and a **max** and each particle is randomised inside that band. One caveat worth
  knowing: a particle draws **one** random multiplier and keeps it for its whole life, so
  the min ÷ max **ratio is shared** between Start and End (a particle that spawns small
  stays proportionally small). Editing a **min** sets that ratio; editing a **max** moves
  the authored curve and the floor rides along. The percentage is shown under the sliders.
- **Colour** — **Tint particles over life** interpolates a **Start** and **End** colour
  across each particle's life (identically for every particle). **Colour overlay
  (per-particle intensity)** is the varying one: pick an **Overlay** colour and an
  **Intensity min/max**, and every particle draws its own strength in that band — 0 leaves
  the art untouched, 1 replaces it with the overlay colour. It lays on **top** of the
  over-life tint, so a spread here breaks up a flat-coloured burst.
- **Blend mode** — Normal / **Add (glow)** / Screen / Multiply. Add and screen give the
  additive glow fire, sparks and magic want.

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

### Getting a saved effect into a game

Saving stores the effect; it does **not** by itself update a running game — a game picks
up effects the next time it is **published/baked**. When the project is built, the effect
travels the standard chain (export → `deploy/effects/` → bake → pull → register), the same
path the editor art and Flow document take. After that, a layer set to fire **on event**
plays in-game whenever a matching event crosses the runtime event bus (for example a Flow
**Broadcast** of the layer's event type). So "author the effect here, fire it on a game
event" works end-to-end — it just requires a publish/bake to reach the live game, not a
mere save.

## What it does not do yet

- **It authors the effect and its trigger binding, not the broader flow.** Invisible FX
  owns the effect (its emitters, art, placement) and the event it fires on. The wider
  presentation flow — what *broadcasts* that event, and when — is authored in Invisible
  Flow; FX and Flow meet at the shared event vocabulary.

## Known limitations / TODOs

- **Live in-game firing needs an owner pixel-verify.** The full author→ship→fire loop is
  wired and headless-tested, but firing a baked effect on an event in a real game (in
  particular the Spine bone-attach coordinate frame) has not yet been owner-verified on
  live WebGL pixels.
- **One atlas per layer.** A layer's frames come from a single atlas; mixing regions
  from different atlases in one layer is not supported — add another layer instead.
- **Min / Max shares one ratio across a curve's ends.** See the Inspector note above:
  that's the particle library's own model (one multiplier per particle, for life), not a
  shortcut — independent start and end bands are not expressible.
- **Not everything can vary per particle.** Frequency and Max particles are emitter-wide,
  and gravity's acceleration is a constant field — none of them are per-particle values,
  so they have no Min / Max. Lifetime, the launch arc, spin and the gravity start speed
  are already authored as ranges.

## For developers

- **Design + build plan:** [`../design/invisible-fx.md`](../design/invisible-fx.md) is
  the source of truth (the EffectDoc schema, the three particle tiers, the Phase-0 gate
  for the spine-as-particle tier, the phased plan, and the deploy→bake→pull→register
  chain the effect must travel to ship).
- **The tool page:** `apps/launcher-api/src/routes/(app)/fx/` — `+page.server.ts`
  (SSR off; auth + `fx`-scope gate; streams the project's atlas list via the shared
  `loadRegionSet`, the saved-effect index, the optionally-opened EffectDoc + its sidecar
  on `?effect=<id>`, and the project's emitter **vocabulary** `eventTypes` — resolved by
  the LayoutDoc `gameType` via `resolveEmitterVocabulary`, the same source `/flow` uses, so
  the Trigger picker offers exactly the events a Flow Broadcast can emit). `+page.svelte`
  is the authoring shell (sub-bar, Layers panel with the stack ops, Inspector with Layer /
  Particle / Art / Placement / Trigger / Emitter / Spawn / Direction &amp; rotation / Alpha /
  Scale / Movement / Colour / Blend sections, and the Backdrop bar above the canvas).
  `FxStage.svelte` is the WebGL stage (own `PIXI.Application` + pan/zoom/
  play-pause + a live `Emitter` per layer, the centre-spawned placeholder dots for an
  unbound layer, and the Tier-B Spine backdrop — loaded imperatively and ridden per-frame,
  replicating `SpineBone` for `bone`-placed layers; it also re-appends the emitter
  containers in doc order each rebuild so a layer reorder restacks the preview).
  `fxModel.client.ts` is the pure, rune-free editing model + config/placement/**trigger**
  mutators, the min/max `curveRange`/`setCurveBound` seam, the colour-overlay + rotation-lock
  + flipbook-playback setters, and the layer stack ops (+ the bone-follow coordinate math),
  all harness-covered in `tools/fx-spike` (`variation.ts` for everything min/max-related).
  `fxSpine.client.ts` loads a project skeleton via the shared `/spine/skeletons` +
  `/spine/file` endpoints (whose `requireSpineAccess` gate now also accepts the `fx`
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
  `behaviors.ts` — the two CUSTOM particle behaviors the stock library has no equivalent
  for: `fxAlpha` (the alpha curve plus a per-particle `minMult`, mirroring the library's
  own `ScaleBehavior`) and `fxColorOverlay` (a colour laid over each particle at a random
  intensity). They are plain, import-free classes, so `registerFxBehaviors(Emitter)` takes
  the `Emitter` class as an argument and the package stays PixiJS-free. **Every renderer
  must have called it** — the runtime does so in `<ParticleEmitter>`, and all three
  launcher-side stages inherit it from `$lib/fx/effectEmitter.client.ts`, which every one
  of them imports. A config only carries these types while the author has that knob on, so
  an effect that doesn't use them stays 100% stock library config.
