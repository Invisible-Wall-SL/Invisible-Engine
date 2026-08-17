# Invisible Cinematic — design + build plan

> A **non-linear sequencer** layer above the Rigger's animator: place several rigs (and
> art, text, FX, sound) as **actors** on a shared timeline, drop existing animations on
> them as **strips** you can trim / loop / layer / blend, and edit any strip's underlying
> clip in the animator **without leaving the cinematic**.
> Owner direction 2026-08-17. Related: `invisible-rigger.md` (the animator this sits on),
> `invisible-flow-v2.md` (what plays a cinematic in-game), `invisible-editor.md` (the Scene
> that is the cinematic's set), `live-assets.md` (the ship chain every asset class travels).

## 1. Why this exists (the problem)

`/rigger` today edits **one skeleton, one clip, one playhead** — `animMode` poses
`curAnim` at `animTime` (`static/rigger/view.html` `poseAtTime`). A scene with several
characters, staged beats, holds and loops therefore has to be authored as one enormous
clip on one rig. That is how the Book of Borut cinematic was built, and it is why it was
"very difficult" (owner, 2026-08-17): no reuse, no layering, no way to retime a beat
without hand-moving hundreds of keys, and no way to loop a section.

Every animation package solves this with a layer above the dope sheet. We don't have one.

## 2. Prior art (what we're borrowing, and from where)

| Program | Their name | The idea worth stealing |
|---|---|---|
| **Blender** | NLA Editor | Actions become **strips** on stacked tracks — repeat, time-scale, blend-in/out, blend mode, extrapolation. **Tweak Mode** (`Tab` into a strip) edits the underlying action *in the dope sheet, in context*, while the rest of the stack keeps evaluating. |
| **Unity** | Timeline | Tracks **bound to scene objects**; clips carry ease-in/out, clip-in offset, speed, loop; Track Groups; **Override tracks** with masks; **Activation**, **Audio** and **Signal** tracks; a **Control track** nests another timeline. |
| **Unreal** | Sequencer | Master sequence → **shots** → subsequences; **spawnables** (actors that exist only for the sequence); a camera-cut track; an event track that fires into Blueprint. |
| **Maya / MotionBuilder** | Trax / Story | Clip **blending** and **retime**; additive layers over a base take. |
| **After Effects** | precomps | Nesting and time-remapping as first-class citizens. |

Blender's NLA + Tweak Mode is the closest match to the owner's description and the one
that maps best onto code we already have. Unity's "tracks bound to scene objects" is the
model for *what* a track drives (§4.1). Unreal's shots/subsequences are the Phase 7 tail.

**The one thing none of them have** and a slot cinematic needs: a **wait marker** — hold
the playhead until a named game signal fires ("loop the idle until the RGS answers").
Film sequencers assume time always advances. Ours can't.

## 3. Decisions (settled with the owner, 2026-08-17)

1. **The editor is a MODE inside `/rigger`**, not a new tool — next to Setup / Animate /
   Preview. It reuses the WebGL stage, the dopesheet widgets, event authoring, the rig +
   animation libraries, auth and R2 writes; and Tweak Mode (§4.4) only works if the
   animator is in the same page. New code lives in `static/rigger/cinematic.js`, **not**
   inline in `view.html` (already 9.5k lines).
2. **It plays live in-game** via a `<Cinematic>` engine component driven by a Flow-v2
   `playCinematic` node, shipped through the full rule-8 chain (§6). *Not* baked into a
   single flattened rig — actors come from different atlas sheets, and a bake cannot
   express loops or wait markers. (A flatten-to-`.irig` export stays a possible later
   escape hatch for single-atlas cases; it is not the ship path.)
3. **Actors are full scene content** — rigs *and* art, text, FX and sound. See §4.1 for
   how that is done without inventing a second scene vocabulary.

## 4. The model

### 4.1 The set is a Scene; the cinematic is a timeline OVER it

The engine already has a node vocabulary for exactly this content —
`packages/engine-layout/src/lib/types.ts`: `container | spine | sprite | text | effect`
— authored in the Scene Editor (placement, per-ratio overrides, coordinate boxes) and
rendered in-game by `LayoutScene`. **A cinematic does not get its own node model.**

```
Scene (the SET)            ← dressed in /editor: who/what is on stage, where
   └─ Cinematic (.icin)    ← authored in /rigger: what happens, when
```

A cinematic references a scene and binds **tracks to node ids**, exactly the way Unity
Timeline binds tracks to scene objects. Consequences that make this the right call:

- One vocabulary, one in-game renderer. The cinematic player drives properties over time;
  `LayoutScene` still does the drawing. Nothing is re-implemented game-side.
- It composes instead of competing with the Scene Editor and Flow (§7 risk 3).
- Set dressing (which is placement work, per-ratio) stays where placement tooling lives.

### 4.2 Document sketch (`.icin`)

```jsonc
{
  "schemaVersion": 1,
  "id": "bonus-intro",
  "name": "Bonus intro",
  "duration": 8.5,          // seconds (derived from content, overridable)
  "fps": 30,                // SNAP GRID ONLY — evaluation is continuous
  "stage": {
    "sceneId": "cinematic_bonus_intro",
    "cast": [               // timeline binding: actor id → scene node id
      { "actorId": "borut", "nodeId": "spine_borut" },
      { "actorId": "book",  "nodeId": "spine_book" }
    ]
  },
  "tracks": [
    { "id": "t1", "actorId": "borut", "kind": "animation", "layer": 0, "strips": [
      { "id": "s1", "clip": { "src": "rig", "name": "walk_in" },
        "start": 0, "length": 1.6, "clipIn": 0, "speed": 1,
        "loop": { "mode": "once" }, "blendOut": 0.2, "alpha": 1, "blend": "replace" },
      { "id": "s2", "clip": { "src": "library", "id": "idle_breathe" },
        "start": 1.4, "length": 4.0, "loop": { "mode": "fill" },
        "blendIn": 0.2, "blend": "replace" }
    ]},
    { "id": "t2", "actorId": "borut", "kind": "animation", "layer": 1, "strips": [
      { "clip": { "src": "library", "id": "breathe_add" }, "blend": "add",
        "mask": { "bones": ["chest", "head"] }, "loop": { "mode": "fill" } }
    ]},
    { "id": "t3", "actorId": "borut", "kind": "property",
      "channels": { "x": [], "y": [], "scale": [], "rotation": [], "alpha": [] } },
    { "id": "t4", "kind": "camera", "channels": { "x": [], "y": [], "zoom": [] } },
    { "id": "t5", "kind": "cue", "keys": [
      { "time": 2.1, "cue": "fx:book_burst" },
      { "time": 2.1, "cue": "sfx:whoosh" },
      { "time": 6.0, "cue": "signal:cinematicBeat" }
    ]}
  ],
  "markers": [
    { "time": 0.0, "kind": "label", "label": "shot 1" },
    { "time": 5.0, "kind": "wait", "until": "winResolved", "label": "hold for RGS" }
  ]
}
```

**Track kinds:** `animation` · `property` · `visibility` · `camera` · `cue` ·
`subCinematic` (Phase 7).

**Strip fields:** `start` / `length` on the cinematic timeline · `clipIn` trim · `speed`
· `loop.mode` (`once` | `count:N` | `fill` | `pingPong` | `hold`) · `blendIn` / `blendOut`
ramps · `alpha` · `blend` (`replace` | `add`) · `mask.bones` (a bone subtree — upper body
waves while the legs keep walking).

**Clip sources** — this is the owner's *template vs reference* distinction:

| `clip.src` | Meaning | Edits propagate? |
|---|---|---|
| `rig` | an animation inside the actor's own `.irig` | yes (it is the rig's clip) |
| `library` | an entry in the cross-project `_shared/animations` library | **yes — linked** |
| `local` | a copy embedded in the `.icin` ("make unique") | no — private to this cinematic |

The animation library already stores exactly what a linked strip needs — the clip plus
`refs.bones/slots/events` and `duration` (`/api/rigger/animations/save`), and the rig
library already produces a **matched-vs-missing compatibility report**. That report is the
retarget check when a library clip is dropped on an actor it wasn't authored for.

**Cue namespaces:** `fx:<effectId>` (Invisible FX) · `sfx:` / `music:` (a named cue in the
game's existing audiosprite config) · `signal:<name>` (broadcast on the game event bus, so
Flow can listen). Reusing the Rigger's existing ⚡ timeline-event → event-bus → FX path.

### 4.3 Evaluation (the technical core)

```
evaluateCinematic(doc, t) →
  for each actor, in z order:
    skeleton.setToSetupPose()
    for each animation track, bottom layer → top:
      for each strip active at t:
        local = clipLocalTime(strip, t)                 // clipIn / speed / loop / pingPong / hold
        a     = strip.alpha * blendEnvelope(strip, t)   // blendIn / blendOut ramps
        clip.apply(skeleton, lastLocal, local, loop, events, a, blendMode, MixDirection.mixIn)
    applyPropertyTracks(actorNode, t)                   // x / y / scale / rotation / alpha
    skeleton.updateWorldTransform()
  applyCameraTrack(t); fireCuesCrossed(lastT, t)
```

**Blending goes through the vendored runtime's `Animation.apply(...)`** — the same
primitive `AnimationState` uses internally. It gives deterministic scrubbing, real
`alpha`, and `MixBlend.replace | add` for free, handles curves / deform / draw-order
correctly, and is **byte-identical code in the editor and in the game**. We do not write a
second blend implementation — see [[gotcha_three_fx_renderers_symbols_vs_game]]: we
already have three hand-synced FX renderers and they drift.

The Rigger's existing raw-doc poser (`poseAtTime`, which writes absolute values with no
alpha concept) stays a **live-edit convenience for Tweak Mode only**; on exiting a tweak
the edited clip is re-parsed into the runtime `SkeletonData` so it evaluates identically.

**Bone masks** are not a parameter of `Animation.apply`. They are implemented by
snapshot-and-restore of the bones outside the mask around each strip application. Cheap at
our scale (tens of bones); named here so nobody looks for a runtime flag that doesn't exist.

**Determinism contract:** same `t` ⇒ same pose. The only history-dependent parts are cue
firing (edge-triggered on forward playback only — scrubbing must never re-fire a cue; the
standard trap) and physics constraints (which already only advance while "running", see
`frame()` in `view.html`).

### 4.4 Tweak Mode — the feature the owner actually asked for

Double-click a strip → the existing animator (dopesheet, graph editor, ◆ Key / ◆ Key all,
curves) opens on **that clip**, with:

- the playhead still expressed in **cinematic time** (mapped through the strip's
  `clipIn` / `speed` / loop),
- **every other actor still posed around it**, so you animate in context,
- `Esc` / Exit returns to the sequencer and re-parses the clip.

Mechanically this is mostly plumbing what exists: set `curAnim` to the strip's clip, drive
`animTime = clipLocalTime(strip, cinematicTime)`, and keep evaluating the other actors.
Blender calls it Tweak Mode; Unreal edits a subsequence in place.

## 5. What has to change in `/rigger`

| Today | Needed |
|---|---|
| Module-level `skeleton` / `animState` / `curAnim` singletons | an **actor array**, each with its own skeleton, `AssetManager` and atlas page |
| One `AssetManager` per page load | one per rig — actors come from **different atlas sheets** (this is why a flatten-to-one-rig bake was rejected) |
| `frame()` draws one skeleton | draws N actors in z order, plus sprite / FX / text preview layers |
| Modes: setup / animate / preview | plus **cinematic**, behind the same `#modeSeg` switch |
| **No undo/redo anywhere** (`view.html` has no command stack) | a sequencer without undo is not usable — see §7 risk 2 |

## 6. Ship chain (rule 8 — non-negotiable)

A cinematic that only plays in `/rigger` is a stranded asset. `.icin` is a new asset class
and travels the full chain from Phase 3, deliberately early:

**author → `<client>/<project>/deploy/` → bake (index in the bundle) → pull (mirror into
`static/assets/`) → runtime register → played by a Flow-v2 node.**

Mirror `editorArtExport.ts` / `fontExport.ts` / `flowV2Export.ts`. Game-side:

- `<Cinematic>` — mounts the referenced Scene through `LayoutScene` and drives it with the
  shared evaluator (§4.3). Its integration contract with `spine-pixi-v8` (`autoUpdate = false`,
  `state.clearTracks()`, pose in `beforeUpdateWorldTransforms`, `spine.update(dt)` per frame) is
  proved by Phase 0 gate 3 — `tools/rigger-spike/cinematic-pixi.mjs`.
- **Flow-v2 `playCinematic` node** — `play` exec in, `complete` exec out (so a screen can
  await it), plus the `signal:` cues surfacing as pins and the **wait markers** resolving
  against flow signals.

Watch the two known traps: `bake:doc` must run before `pull:assets`, and the build-env
token trap that silently serves stale assets ([[gotcha_game_build_stale_engine_dist]],
[[project_component_art_to_game]]).

**Audio caveat:** there is no R2 audio *authoring* class today — audio reaches a game as
build-pipeline audiosprites (Howler). So a `sfx:` / `music:` cue references an **existing
named cue** in the game's sound config. Uploading arbitrary audio from the cinematic tool
is a separate asset-class build, out of scope here.

## 7. Risks, named honestly

1. **Preview ≠ in-game fidelity.** `/rigger` is a vanilla static HTML page on a raw
   `spine-webgl` stage; the game renders scenes through Svelte/Pixi `LayoutScene`. Spine,
   sprite and FX actors are within the rigger stage's reach (it already vendors
   `rigger-fx.js`), **text and coded components are not** and will be approximated in
   preview. The in-game player is authoritative. This is a bounded, named cost of
   decision 1 + 3; the alternative was a new Svelte route, which loses Tweak Mode.
2. **No undo.** The Rigger has no command stack at all (design §9 flagged it "decide
   before Phase 2"; it never landed). Dragging strips around without undo is worse than
   editing keys without undo. A scoped undo stack for the cinematic document is a
   **prerequisite of Phase 2**, not a nice-to-have.
3. **Two timelines.** Flow-v2's open **Phase 7 is "behaviour/timeline layer"**. If both get
   built we own two sequencers with two doc formats. **Decision to make explicit:** this
   cinematic sequencer *is* that layer — Flow **plays** cinematics, it does not grow its
   own timeline.
4. **Cue double-fire on scrub** — edge-trigger on forward playback only (§4.3).
5. **Concurrency.** `.icin` saves go through the established conditional-write / lease
   pattern (`multi-user-concurrency.md`), never a naked read-modify-write. The Rigger's
   `_shared/{rigs,animations}/index.json` race already cost us "my rig vanished".
6. **Retarget quality.** Dropping a library clip on an actor it wasn't authored for is
   name-matching; the compatibility report tells the truth but cannot fix a mismatch.

## 8. Build plan (phased — each ships something usable)

| Phase | Delivers | Risk |
|---|---|---|
| **0 — Gates (headless spikes)** | see below | **make-or-break — do first** |
| **1 — Set + cast** | cinematic mode shell: pick a Scene as the set, list its nodes as cast, multi-actor stage renders spine + sprite + FX; scrub poses everything | medium |
| **2 — Sequencer core** | track list, strips (drag / trim / snap-to-fps), loop modes, blend ramps, alpha, layers, property + camera tracks, play / loop region — **+ the undo stack** | high |
| **3 — Ship chain (rule 8)** | `.icin` export → deploy → bake → pull → register; `<Cinematic>` component; Flow-v2 `playCinematic` node with `complete` | medium |
| **4 — Tweak Mode** | edit a strip's clip in the animator, in cinematic context | medium |
| **5 — Cues, audio, waits** | cue track (`fx:` / `sfx:` / `signal:`), wait markers, Flow signal binding | medium |
| **6 — Layering polish** | bone masks, additive blend, retime, ping-pong, visibility track | medium |
| **7 — Long tail** | sub-cinematics (nest an `.icin`), shots / sections, a cinematic template library | low |

**Phase 0 is a gate, not a formality** — three spikes, headless, in `tools/rigger-spike/`
(the pattern the Rigger has proven repeatedly):

1. **Layered evaluator determinism** — 2 actors × 2 layers with additive blend, masks and
   a looping strip: prove `scrub(t) === play-to(t)` for every `t` on a grid, against
   `spine-core`. If evaluation isn't deterministic, scrubbing is a lie.
2. **Multi-rig stage** — two skeletons from **different atlases** in one WebGL stage:
   two `AssetManager`s, correct z-order, correct premultiply. This is where the
   single-`skeleton` globals must become an actor array.
3. **In-game player** — drive a `LayoutScene`'s spine nodes from the same evaluator under
   `spine-pixi-v8` with its own `AnimationState` bypassed. **If this fails, decision 2 is
   wrong** and the fallback is per-actor `AnimationState` scheduling — better learnt in
   week one than in month three.

## 9. Open questions

- **Scope of a cinematic doc** — project-scoped (like a scene) with a shared cross-project
  **template library** (like rigs / animations)? Assumed yes; confirm.
- **Per-ratio.** Scenes carry per-layout-ratio placement overrides; the timeline itself is
  ratio-agnostic. Assumed the Scene absorbs all ratio differences and one `.icin` serves
  every ratio — confirm against a real portrait/landscape cinematic.
- **Does the set have to be a saved Scene**, or can a cinematic own an inline scene for
  throwaway sets? (Inline is convenient; a reference keeps one source of truth.)
- **Flatten-to-`.irig` export** — worth building later as an escape hatch for single-atlas
  cinematics that a third party wants as a plain spine animation?

## 12. Non-rig content: FX, sound and TEXT (owner direction 2026-08-17)

Prompted by live use: *"how do I add VFX SFX Text etc?"* and *"this should work at animation
level as well — I should be able to place text and FX on my animations."*

### 12.1 What already exists (do not rebuild)

| Want | Today |
|---|---|
| An effect/sound at a MOMENT in a cinematic | ⚡ **cue track** — `fx:` / `sfx:` / `music:` / `signal:` |
| An effect on a RIG ANIMATION | **Already built**: a timeline event key carrying `fx.effectId` + `fx.bone`, previewed live on the stage and shipped via `bakedRigFx()` |
| Text, anywhere | **Only** as a Scene Editor `text` node |

So FX-on-animation is a discoverability problem, not a build. Text is the real gap.

### 12.2 The trap: three text systems

The game has exactly ONE text stack — Scene `text` nodes → the Text Box model → the font
catalog → keys harvested into `/localization`. Growing separate text in the cinematic AND in
the rig would give three, two of which localize nothing and ignore project fonts. The failure
shows up in a translation pass months later, which is the worst time to find it.

**Rule: a rig or cinematic never embeds text. It embeds a REFERENCE the existing stack renders.**
Rig FX already proves the pattern — the rig stores an effect id + a bone; the game resolves and
draws it. Text copies that shape rather than inventing one.

### 12.3 Cinematic: Scene binding + quick-add (owner decision)

Both halves, because either alone is wrong for how the tool is actually used:

- **Scene binding** (§4.1) — a **set picker** in the cinematic panel chooses a Scene; its nodes
  (`sprite` / `text` / `effect`) become castable actors beside the rigs, and tracks bind to node
  ids. Full per-ratio placement, localization and fonts, and the in-game player keeps drawing
  through `LayoutScene`. One vocabulary, nothing duplicated.
- **Quick-add** — `＋ Text` / `＋ FX` in the cinematic creates the node in the bound set for you,
  so a one-off label costs no trip to `/editor`. It is a shortcut INTO the Scene model, never a
  parallel one: the node it makes is an ordinary Scene node that `/editor` can then refine.

A cinematic with no set keeps working exactly as now (rigs cast directly, `nodeId` null).

### 12.4 Rig-level text: a REAL slot, without breaking the format

The owner asked for text that is *"a real text slot on the rig"* — keyable, parentable,
transformable like any attachment — having been told that putting non-Spine data in the `.irig`
would break the byte-valid Spine 4.2 round-trip §2.1 rests on. **Both are achievable**, because
Spine already has the right primitive:

> A rig text element is a **`point` attachment** (legal Spine 4.2 — a locator with position +
> rotation in a slot, parented to a bone; the Rigger already authors these, see §18.9) PLUS an
> entry in the **sidecar** (`model.irig.meta.json`, §2.2) mapping that point name → its
> localization key, font and size.

What this buys:

- **It is a real slot.** The point lives in a slot, rides a bone, and keys like anything else —
  slot visibility, draw order, and the bone full transform all animate it for free, using the
  dopesheet that already exists. Nothing new in the animation model.
- **The `.irig` stays byte-valid Spine.** A `point` attachment is standard; the text CONTENT
  lives in the sidecar, which §2.2 already designates for exactly this (keep extras out-of-band).
  Desktop Spine still imports the skeleton; it simply sees a locator with no text, which is the
  honest degradation.
- **Localization and fonts come free.** The sidecar stores a KEY, so `/localization` harvests it
  and `<CatalogText>` resolves the font — the §12.2 rule, satisfied.
- **The runtime seam exists.** `SpineBoneAttach` already mounts content at a bone/point world
  transform; rig FX already computes exactly this transform per frame.

The one real limit to state plainly: **the text does not round-trip to desktop Spine**, because
Spine has no text attachment to round-trip it INTO. That is a property of the format, not of
this design — and it is strictly better than the alternative, where the whole skeleton stops
being loadable by a stock runtime.

### 12.5 Build order

1. Set picker + Scene-node actors in the cinematic (the §12.3 first half) — unlocks text, FX and
   sprites in a cinematic using content that already ships.
2. `＋ Text` / `＋ FX` quick-add writing into the bound set.
3. Rig-level text: point attachment + sidecar entry + the game-side resolver.

Text previews **approximately** in `/rigger` (a raw WebGL stage with no HTML text layer); the
in-game render is authoritative. Named here so it is a known cost, not a surprise (§7 risk 1).

> Build status: see [docs/status/cinematic.md](../status/cinematic.md).
