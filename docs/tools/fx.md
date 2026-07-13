# Invisible FX

An online particle-effect authoring tool. You build an **effect** — a stack of
emitter **layers** — over a project's atlas art, tune each emitter live in a WebGL
preview, and save it. The saved artifact is an **EffectDoc** stored in the project's
cloud storage.

> **Status (as of 2026-06-25):** **Phases 1 + 2 + 4 — emitter-core authoring + Spine
> attach + the full author→ship→fire loop.** What ships now: add emitter layers, draw their
> particle art from a project atlas, tune the emitter live, **load a project Spine rig as a
> backdrop and pin a layer onto one of its bones** so the particles ride the animation,
> author **when** a layer fires (ambient, or on a game event), and save/reopen the effect.
> A saved effect **does** travel into a game — the export → `deploy/` → bake → pull →
> register chain is wired, and a layer set to fire **on event** plays in-game when a
> matching event (e.g. a Flow Broadcast) crosses the runtime event bus. The one remaining
> gap is the **spine-as-particle tier** (whole Spine clips *as* the particles), which is
> still gated behind a make-or-break spike. See "What it does not do yet" below, and the
> design doc for the full roadmap.

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
- **Access:** the `admin`, `developer` and `artist` roles get it by default
  (`ROLE_TOOLS` in `src/lib/roles.ts`); the `animator` role does not. Like any tool it
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
layer, click a row to select it (the right-hand Inspector then edits that layer), and
use the **✕** on a row to remove it. Each row shows the layer's key and how many art
frames it has. An effect always keeps at least one layer — the **✕** is disabled when
only one remains.

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
  gives a uniform mix.
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
- **Emitter** — the core emitter numbers: **Frequency (s)** (seconds between spawns),
  **Max particles**, **Lifetime min/max (s)**, and a **Spawn radius** (when the emitter
  uses a spawn-circle).
- **Alpha**, **Scale**, **Speed** — each has a **Start** and **End** endpoint, so a
  particle can fade, grow/shrink, and slow/accelerate over its lifetime.

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

- **No spine-as-particle tier.** Emitting whole Spine clips *as* the particles is an
  ambitious later tier gated behind a make-or-break spike (Phase 0 / Tier C in the design
  doc); this version emits sprite particles drawn from atlas regions. (A Spine rig can be
  a backdrop and a layer can ride a bone — but the *particles* are sprites.)
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
  is the authoring shell (sub-bar, Layers panel, Inspector with Layer / Art / Placement /
  Trigger / Emitter / Alpha / Scale / Speed sections, and the Backdrop bar above the
  canvas). `FxStage.svelte` is the WebGL stage (own `PIXI.Application` + pan/zoom/
  play-pause + a live `Emitter` per layer, the centre-spawned placeholder dots for an
  unbound layer, and the Tier-B Spine backdrop — loaded imperatively and ridden per-frame,
  replicating `SpineBone` for `bone`-placed layers). `fxModel.client.ts` is the pure,
  rune-free editing model + config/placement/**trigger** mutators (+ the bone-follow
  coordinate math, harness-covered in `tools/fx-spike`).
  `fxSpine.client.ts` loads a project skeleton via the shared `/spine/skeletons` +
  `/spine/file` endpoints (whose `requireSpineAccess` gate now also accepts the `fx`
  tool).
- **Save endpoint:** `POST /api/fx/save` (`fx`-gated via the shared `gate` helper,
  mirroring `/api/flow/save` and `/api/rigger/save`); R2 read/write in
  `src/lib/server/fxStorage.ts`, which writes the canonical `<id>.fx.json` and the
  editor-only `<id>.fx.meta.json` as two separate objects and runs `normalizeEffectDoc`
  as the gatekeeper so editor-only state never reaches the shipped doc.
- **The shared package:** `packages/engine-fx` — the EffectDoc schema (`types.ts`,
  re-exporting `EmitterConfigV3` verbatim from `@barvynkoa/particle-emitter`) and the
  serialize/deserialize contract (`normalize.ts`), shared so both the launcher and the
  engine-side player import the same types.
