# Invisible FX

An online particle-effect authoring tool. You build an **effect** — a stack of
emitter **layers** — over a project's atlas art, tune each emitter live in a WebGL
preview, and save it. The saved artifact is an **EffectDoc** stored in the project's
cloud storage.

> **Status (as of 2026-06-24):** this is **Phase 1 — emitter-core authoring**. What
> ships now is the *sprite-particle* tier: add emitter layers, draw their particle art
> from a project atlas, tune the emitter live, and save/reopen the effect. It is an
> **authoring surface only** — saving writes the EffectDoc to cloud storage but does
> **not yet make any game play the effect**. Attaching an effect to a Spine rig (so
> particles follow a bone), the spine-as-particle tier, and wiring the saved effect
> through the build so a shipped game fires it are **later phases**. See "What it does
> not do yet" below, and the design doc for the full roadmap.

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
  which **regions** become the particle frames. Pick more than one region and you can
  turn the layer into a **flipbook** that animates through the frames.
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
- **+ New** — starts a fresh, empty effect (reloads `/fx` with one default layer).
- **Open effect…** — a dropdown of every effect already saved in this project; pick one
  to open it (this loads the effect's layers and restores the last-selected layer).
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

### Tune a layer (Inspector)

With a layer selected, the right **Inspector** edits it:

- **Layer → Name** — rename the layer (its key, shown in the Layers panel).
- **Art → Atlas** — a dropdown of the project's atlases. Pick one and a checkbox list of
  its **regions** appears below; tick the regions you want as the particle frames. (If
  the project has no usable atlases yet, the panel tells you to make one in the Atlas or
  Sheet Maker first.) When a layer has **more than one** frame, a **Flipbook (animate
  frames)** toggle appears — on, the particle cycles through the frames; off, it's a
  multi-frame still.
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
and layer count, and the id is slugged from the name so a later save or **Open effect…**
round-trips to the same files. Reopening an effect restores its layers, the Inspector,
and the layer you last had selected.

## What it does not do yet

- **Saving does not yet make a game play the effect.** Wiring the EffectDoc through
  export → `deploy/` → bake → pull → `register` so a shipped game can fire it is a later
  phase (Phase 4 in the design doc). Until then the effect is a saveable, reopenable
  authoring artifact only — it does not reach any running game.
- **No Spine attach yet.** Pinning a layer onto a **playing Spine rig** so particles
  follow a bone (e.g. a flame on a torch, a sparkle off a wand tip) is a later phase.
  This phase authors effects in free space over the atlas reference only — there is no
  spine backdrop or bone picker yet.
- **No spine-as-particle tier.** Emitting whole Spine clips *as* the particles is an
  ambitious later tier gated behind a make-or-break spike (Phase 0 in the design doc);
  this version emits sprite particles drawn from atlas regions.
- **It is not a trigger editor.** *When* an effect fires in a game is owned by Invisible
  Flow (a Broadcast event plays an effect); Invisible FX authors the effect itself, not
  the triggering.

## Known limitations / TODOs

- **The page is built and the launcher build is green; the WebGL preview pixels and the
  save/open round-trip have not yet been owner-verified** on the live deployed page (the
  schema + save contract are covered by headless harnesses in `tools/fx-spike/`, but the
  in-browser stage is not yet live-verified).
- **One atlas per layer.** A layer's frames come from a single atlas; mixing regions
  from different atlases in one layer is not supported — add another layer instead.

## For developers

- **Design + build plan:** [`../design/invisible-fx.md`](../design/invisible-fx.md) is
  the source of truth (the EffectDoc schema, the three particle tiers, the Phase-0 gate
  for the spine-as-particle tier, the phased plan, and the deploy→bake→pull→register
  chain the effect must travel to ship).
- **The tool page:** `apps/launcher-api/src/routes/(app)/fx/` — `+page.server.ts`
  (SSR off; auth + `fx`-scope gate; streams the project's atlas list via the shared
  `loadRegionSet`, the saved-effect index, and — on `?effect=<id>` — the opened
  EffectDoc + its sidecar). `+page.svelte` is the authoring shell (sub-bar, Layers
  panel, Inspector). `FxStage.svelte` is the WebGL stage (own `PIXI.Application` +
  pan/zoom/play-pause + a live `Emitter` per layer). `fxModel.client.ts` is the pure,
  rune-free editing model + config mutators.
- **Save endpoint:** `POST /api/fx/save` (`fx`-gated via the shared `gate` helper,
  mirroring `/api/flow/save` and `/api/rigger/save`); R2 read/write in
  `src/lib/server/fxStorage.ts`, which writes the canonical `<id>.fx.json` and the
  editor-only `<id>.fx.meta.json` as two separate objects and runs `normalizeEffectDoc`
  as the gatekeeper so editor-only state never reaches the shipped doc.
- **The shared package:** `packages/engine-fx` — the EffectDoc schema (`types.ts`,
  re-exporting `EmitterConfigV3` verbatim from `@barvynkoa/particle-emitter`) and the
  serialize/deserialize contract (`normalize.ts`), shared so both the launcher and the
  engine-side player import the same types.
