# Invisible Rigger

An online rig skeleton editor — load a rig from the project's cloud storage,
inspect and edit its bones, slots, skins, meshes and weights, animate it, and
save it back as an `.irig` (byte-valid 4.2-format JSON the official runtime
reads). You can also build a rig from scratch and import images.

> Part of a game character? [Where each part of a character is made](invisible-characters.md#where-each-part-of-a-character-is-made) lists every tool that makes one.

## What it is

A browser-based rigging tool, comparable in scope to an external rig editor,
that we own end-to-end — no third-party licence needed to rig or animate. Its native
file is a rig **4.2 runtime export JSON** saved under our own `.irig`
extension, so rigs play in our own runtime (`engine-rig`, no third-party licence
needed there either), the reference runtime reads them unchanged, and an external rig editor stays usable alongside it (it can _import_ the JSON, though not as a lossless
project round-trip).

It is built on the existing Invisible Rig Viewer — the WebGL renderer, pan/zoom,
animation scrubber and debug overlay are forked from it, and it reuses the
viewer's `/rig-viewer/skeletons` + `/rig-viewer/file` endpoints and the same vendored
runtime (`invisible-rig.js`, built from `packages/engine-rig`). The Rigger's added value is the structured **Inspector**
(bone hierarchy, slots, skins, animations, constraints), bone/slot/mesh
**selection + editing**, mesh + weight authoring, and animation keyframing.

- **Where it runs:** the launcher itself, at `/rigger` — a real full-page tool
  inside the authed `(app)` area, **never an iframe**. The `/rigger` route gates
  on auth + the `rigger` tool entitlement, then `throw redirect(303, …)` to the
  static WebGL app at `/rigger/view.html`, same-origin (so the shared tool bar's
  switcher links are all launcher URLs).
- **Access:** the `admin`, `developer` and `animator` roles get it by default
  (`ROLE_TOOLS` in `src/lib/roles.ts`). Like any tool it is overridable per
  role/user in the admin panel. Every server endpoint it calls is `rigger`-gated.
- **Ask the AI:** the top bar's **Ask the AI** (left of Report bug) opens a movable chat that answers
  how to do things here from this guide ([launcher guide § Ask the AI](launcher.md#ask-the-ai)).

> **Status (as of 2026-08-18):** Phases 0–6, the from-scratch authoring workflow,
> localized text as rig art, and **Cinematic mode** have all landed. Shipping a rig
> into a game works end-to-end. The standing caveat is unchanged: much of this is
> **code + green builds, not browser-verified** on the live authed page — the
> vendored rig runtime is minified, so the headless test spikes (which use the
> un-mangled reference core runtime) can be false-green. Owner live-testing keeps turning up
> browser-only bugs (see Known limitations). Treat the feature list below as
> "built, verify live."

## How to use it

### Open it and pick a project

Sign in to the launcher (`app.invisiblewall.org`) and open **Invisible Rigger**.
The left sidebar has an **Active project** selector — the rig list and any new rig
you create are scoped to the project you have selected.

### Open on a rig from another tool

A link of the form `/rigger?rig=<bundle name>` (and `&project=<key>`) opens the Rigger with that
rig on stage: the bundle name is the rig's folder, the name a rig node and a character sheet
store. A name the project has not opens the rig list with a note saying so. **Invisible
Characters** links here from a character sheet's rig
([Animation source](invisible-characters.md#animation-source)). A rig a crowd of characters
wears is drawn once per character, so keep it to one blend mode and no dark tint: every change
of blend mode between two slots, and every slot with a dark tint, is one more draw call per
character, and Characters shows the count beside the rig.

### Load an existing rig

1. Click **⤓ Load rig** in the sidebar to open the **Load a rig** modal,
   which lists the project's skeletons (`.json`, `.skel`, and saved `.irig`
   files; edited `.irig` rigs are tagged "irig · edited"). Use the **filter** box
   to narrow the list, or **rescan** to refresh it.
2. Click a skeleton to load it. It renders on the central WebGL stage and the
   left **Inspector** populates with the rig's structure under collapsible
   sections: **Bone hierarchy**, **Slots (draw order)**, **Skins**,
   **Animations**, and **Constraints**. If the rig already open has unsaved
   changes, you are asked first — opening another rig discards them.

> **A rig that fails to load** (the red bar says why, e.g. "Parent mesh not found")
> leaves **no rig open**: the stage is empty, the Inspector names the rig as not
> open, and **⤓ .irig**, **💾 Save** and **📦 Save rig to library** are disabled, so
> nothing can be saved under its name. **🕘** stays available for it — restoring an
> earlier save is how a rig saved in a broken state is repaired — as do
> **⟳ Re-sync atlas** and **source…** for an atlas problem. Open another rig to carry on.

> **Meshes an earlier Rigger mapped wrong.** Before 2026-09-30, ▸ Convert to mesh and ✎ Draw
> mesh squeezed a **trimmed** image's whole canvas into its ink (the mesh showed the art too
> small, with bits of neighbouring atlas images), and ＋ Linked mesh onto a **sequence** mesh
> left the linked mesh without the frames (placeholder art). When a rig opens, the amber banner
> lists the ones it can recognise, each with **🩹 Repair** (and **🩹 Repair all** when there are
> several): a click re-maps that mesh to draw exactly what its image drew, then **💾 Save**.
> Recognising one is a judgement from its shape, so check the result — and if a listed mesh is
> right as it is, **keep as is** stops offering it while the rig is open. It lists a mesh the
> old ▸ Convert to mesh made, or an old ✎ Draw mesh whose points reach past the ink, not
> reshaped since (unweighted, or bound only to its slot's bone); and a linked mesh that shows
> its sequence source's image without its frames. It leaves alone what it cannot tell from a
> mesh traced that way on purpose: an image scaled unevenly, and one trimmed evenly all round
> (its ink keeps the image's proportions, as a glow's often does) unless it is unscaled.
> **Anything else, redo by hand:** note the slot's image, delete the mesh, **＋ add image…** that
> image again (for a sequence, then **▩ Make this a sequence**), and **▸ Convert to mesh** or
> **✎ Draw mesh** again — then re-bind weights and re-key deforms, which belonged to the old
> vertices. A mesh made before the fix from a **sequence** image lost its frames too:
> **▩ Make this a sequence** on its slot restores the declaration (the setup frame starts at 1),
> but its mapping still wants the redo above.

> **Constraints that never run.** The game runs one constraint per solve order (`order`), so two
> sharing one, or one numbered past the last, leave a constraint that never runs — in the Rigger or
> in the game. ＋ Add IK and ＋ Add transform made such rigs before 2026-11-20. When a rig opens
> with one, the amber banner names it and why ("path "shake" shares order 0 with ik "ik1", which
> runs instead"), the Constraints list tags it **⚠ never runs**, and **🩹 Repair** re-numbers the
> solve order so every constraint runs. That changes how the rig plays, so nothing changes until
> you click it; then **💾 Save** (or **↶** to take it back). A save never adds a new clash: it is
> refused with the constraint and the reason.

> **↻ Refresh from R2** (sidebar) re-reads the rig list — and reloads the rig
> currently on stage — fresh from cloud storage, bypassing the browser cache.
> Use it after creating/saving a rig (here or in another tool) if the list or the
> loaded rig looks stale. The rig list endpoint is served `no-store` and the
> client cache-busts every fetch, so this is belt-and-braces; unsaved edits to the
> open rig are guarded by a confirm.

Stage controls: **scroll = zoom**, **drag = pan**, **Reset view** re-fits. The
bottom bar toggles the **Bones** overlay (with a size slider), the **Mesh**
hull/triangle overlay, and the **Bounds** size frame, has **⊕ Centre origin**
([below](#the-origin-where-a-placed-rig-sits)), and has **❚❚ Pause / ▶ Play**,
**↻ Loop**, an **Anim** picker, a **Skin** picker, a **scrub** bar with a numeric
time field, and a **Speed** control.

### Bounds (the rig's size frame)

Every rig carries a **natural size** — `skeleton.{x,y,width,height}` — which is
what sizes the rig in the editor and the game, and what the Scene Editor's
selection box frames (so a placed rig has a predictable size, not a guess). It is written automatically on every save: the
**resting (setup) pose** is measured first, falling back to a union across all
animations only when the setup pose is empty (art shown solely via animation
keys). Preferring the setup pose means the natural size matches the rig's calm
look, not its widest animation frame.

**What the frame means downstream:** for a symbol rig, the frame is the rectangle that
fills the reel cell, **centred on the cell** — in `/symbols`, in the Scene Editor's reel
preview and on the board alike. Where the skeleton origin sits inside the frame does
not matter; only the frame does. To make a symbol read smaller on the board, enlarge the
frame around the art; to shift the art within its cell, move the frame the other way.

The **Bounds** toolbar button shows that frame as a teal rectangle on the canvas.
Drag its **edge / corner** handles to resize it or the **centre** handle to move
it — this sets a **custom** frame and _locks_ it, so the auto-fit on save won't
overwrite your choice. **Shift-click** the Bounds button to re-fit automatically
(clears the lock and re-measures). Use this when you want the rig to size to a
deliberate frame (e.g. just the body) rather than the measured art extent.

**A rig with no art of its own** — a *carrier* rig, whose slots exist only to host
Invisible FX and Invisible Flipbook bindings — has nothing for the measure to
find: a binding is a timeline **event**, not an attachment. Two things cover it:

- Bound **Flipbook clips** are measured instead, using the box each clip declares
  in `/flipbook` (its **Fit** button sets one), placed at the bone that hosts it
  and scaled by the binding's **Size**. Give a clip a box there and its rig sizes
  itself with no further work.
- If nothing at all is measurable — an FX-only rig, or clips with no box — the
  Bounds button hands you a **placeholder frame** to drag, and says so. Effects
  are not measured: particles go where the simulation sends them, so there is no
  honest size to read off one.

This matters beyond the canvas: a rig with no natural size cannot be fitted, so
it draws at its raw authored size wherever it ships — far too big in a symbol
cell, in `/symbols` and in the game alike.

### The origin (where a placed rig sits)

A rig **placed on a screen** — in the Scene Editor, or as a part of a component — is
positioned by its **origin**, not by its Bounds frame: the origin lands on the node's
x/y, and the game rotates and scales the rig about it. (A symbol is the other case: it
is *fitted into* its cell, so its frame is what counts, as above.)

With **Bones** or **Bounds** showing, the origin is the **amber ⊕** on the canvas.
**Reset view** frames the art, not the origin, so a rig built away from its origin
can look right here and still draw far from where it is placed; if the ⊕ is not
where you expect, or not in view at all, that is why.

**⊕ Centre origin** moves the whole rig so the **centre of its Bounds frame** is the
origin. First an auto-fitted frame is re-fitted to the art, as a save would do, so
the origin is still centred after you save. Then only the setup position of the
root bone (and of any bone you detached to the root level) changes: every other
bone, slot, mesh and animation key moves with it, so the art keeps its shape in
every pose. The Bounds frame moves with the art and stays locked if you locked
it. It is one undo step, and the rig is unsaved until you **💾 Save**. Afterwards:

- Copies **already placed on a screen** draw centred on their position, so check
  where they land in the Scene Editor.
- An FX or Flipbook binding with **no bone and no slot** is bound to the root bone
  by name. The Rigger always drew such a binding at the root bone while the game drew
  it at the bare origin; naming the root keeps it exactly where it showed here, in
  both. From then on it also follows any animation keyed on the root.
- A **cinematic** that casts this rig places it by its origin too, so the actor's art
  moves within its shot.

### The four modes

A floating segmented toggle at the top of the stage switches the workflow:

- **▶ Preview** — full animation playback (honours bezier curves + mixing),
  read-only.
- **✎ Setup** — edit the **rest (setup) pose**: bones, meshes, weights,
  attachments. This is the rig-editing mode.
- **◆ Animate** — author one animation at a time by posing bones (and slots) at a
  playhead into keyframes.
- **🎬 Cinematic** — stage *several* rigs together as a scene and sequence them.
  See [Cinematic mode](#cinematic-mode) below.

(Setup and Animate stay disabled until an editable rig is loaded. Cinematic does
**not** need one — it opens with no rig loaded and boots its own renderer, because
it casts rigs from the project rather than editing the one on the stage.)

### Undo / redo (rig edits)

**↶ / ↷** sit beside the mode toggle whenever a rig is open.

| Keys | Does |
|---|---|
| **Ctrl+Z** (⌘Z) | undo the last rig edit |
| **Ctrl+Shift+Z** (⌘⇧Z) or **Ctrl+Y** | redo |

- It works the same in Preview, Setup (bones, meshes, weights, slots, skins) and
  Animate, and while **tweaking or posing** inside Cinematic — those key the rig.
  On the plain Cinematic stage the keys and buttons belong to the cinematic's own
  history (see [Undo, saving, and getting it into a game](#undo-saving-and-getting-it-into-a-game)).
- With the cursor in a text or number field, Ctrl+Z is the field's own text undo.
- **One step = one thing you did.** A drag (on the canvas, in the dopesheet) is one
  step; so is typing in one field, a colour scrub or a slider stepped with the
  arrow keys, as long as you don't pause for more than ~0.8 s. A delete with all
  it takes along, ▸ Convert to mesh, ② Auto-weight, 🩹 Repair, a mesh's ⟲ / ▭ (back to
  its original shape) and importing a rig from the library are one step each.
- An undo brings back the selection, the skin on stage and the open animation
  that went with that step.
- Undo stays in this tab and **never saves**: after an undo the rig is unsaved, and
  the next 💾 Save stores whatever is on screen (with the usual "someone saved
  since" check). Opening another rig — or reopening this one (⟳ Refresh, 🕘
  Restore, a text bake, ⟳ Re-sync atlas) — starts an empty history.
- The last 100 steps are kept, fewer on a very large rig (the history holds up to
  64 MB: about 59 steps of a 1 MB rig).

### Timeline events (fire an effect or a flipbook on the beat)

An animation can carry **events** on its timeline — the purple ⚡ keys on the
top row of the dopesheet. An event is a **named cue** that, at runtime, crosses
the game's event bus the moment the animation reaches it. Give a placed rig an
event named the same as an **Invisible FX** effect's **Trigger → On event**
name, and that effect fires exactly on that frame (and, if the effect is
attached to one of the rig's bones, rides it).

- **Add** an event at the playhead with the **＋** button on the events row — a
  key appears and its editor opens.
- **Click** an event key to open its editor: **Name** (the cue name — must match
  the effect's Trigger event name), **Time**, and an optional **int / float /
  string** payload (leave blank to omit). If several events share one beat, a
  picker lets you choose which to edit.
- **Drag** to retime, **Alt-drag** to duplicate, **double-click** to delete —
  the same gestures as any other key.

Authored events export in the `.irig` (rig JSON) as
`animations.<name>.events` and travel with the rig, so the game replays them.

#### Bind an effect straight to the key

Matching cue names is the advanced path. Normally you just **pick the effect on
the keyframe** — the event editor's **Play effect** dropdown lists the project's
Invisible FX effects, and the moment you choose one it plays on the stage so you
can see it. (Sprite-particle effects only for now.) A layer with a
[material](fx.md#material) draws through it on the stage, as in the game; if the project's Shader
Graph effects cannot be read, or the material's graph is gone, that layer draws plain sprites.
**— none (cue only) —** goes back to a plain broadcast.

With an effect bound, the rest of the panel appears:

- **On bone** — which bone the burst rides. Default is the rig origin.
- **Draw at slot** — *where in the rig it draws*. Default is on top of everything.
  Pick a slot and the burst renders at that slot's place in the draw order, so it
  can sit behind the head and in front of the body. The list is in draw order,
  back to front. With **On bone** left at its default, the slot's own bone hosts
  the burst; set a bone and the bone decides position while the slot still decides
  depth.
- **Continuous** — off by default, which means the effect replays from the start on **every**
  beat. On a looping animation that is once per lap: right for an impact, a visible stutter for
  anything ambient like smoke or a glow. Tick it and the first beat starts the effect and later
  beats are ignored, so it runs unbroken. It keeps running until the rig goes away (or until
  **Duration** below stops it) — including across a change of animation, because a binding
  belongs to the rig, not to one clip.
- **Opacity**, **Size**, **Delay**, **Duration**, **Speed** — per-binding
  overrides. They adjust *this* use of the effect without touching its definition
  in `/fx`, so two rigs can fire the same effect dimmer, slower or deeper without
  forking it. **Leave a box blank and nothing is overridden** — blank is not the
  same as `1`.
  **Duration** is the one worth knowing: it is how long the effect *emits*
  (particles already in flight still finish). Leave it blank and a continuous
  effect never stops on its own once fired.

> **What the preview can and cannot show.** The stage draws every rig into one WebGL
> canvas and FX into a separate canvas, so it has two positions: behind the whole rig,
> or in front of it. If **nothing is drawn behind** your chosen slot — the usual case, a
> dedicated FX slot parked at the back — then “behind the whole rig” *is* its real depth,
> and the preview shows it exactly. The note under the picker turns green to say so. If
> there is art behind that slot, the burst is genuinely sandwiched and the stage cannot
> draw it there; it previews in front, the note turns amber, and the game still honours
> the real depth.

> **One name, one set of settings.** The game keys these bindings by the event
> **name**, so if two keys share a name and bind the same effect at the same
> place but with different numbers, only the first survives — while the preview
> here plays each as authored. The editor warns you when that happens; rename one
> of the events to keep both.

#### Bind a flipbook clip to the key

Below **Play effect** is **Play flipbook**, which does the same thing for an
**Invisible Flipbook** clip: pick one and that frame animation plays on the rig at
that beat, on the bone you choose. The list is the project's clips — the same ones
`/symbols` and the Scene Editor use — so author them in `/flipbook` first. It plays
on the stage the moment you pick it, like an effect does.

The two are **separate sections, not a choice**: one key can fire an effect *and* a
clip, which is how a hit throws sparks and a frame-animated flash on the same beat.

**On bone**, **Draw at slot**, **Continuous**, **Opacity**, **Size**, **Delay** and
**Duration** mean exactly what they do for an effect, including the blank-is-not-`1`
rule and the preview note about depth. Two differences worth knowing:

- **Duration** is how long the clip stays *on screen*, not how long it emits. A
  one-shot clip already ends itself after one pass, so this is for bounding a
  **looping** clip — or for cutting a long one short.
- **Speed** is in **fps**, not a multiplier, because that is the same number
  `/flipbook`, `/symbols` and the Scene Editor show. Blank means the clip's own rate.

And a row the effect binding has no equivalent for — **how this use walks the clip**:

- **Loop**, **Mirror X**, **Mirror Y** — three-state: *as authored* inherits the
  clip's own setting, and **no** is a real answer. So one binding can play a looping
  clip once, or un-mirror a clip authored mirrored, without forking it in `/flipbook`.
- **Direction** — *forward*, *reverse* or *ping-pong* over the authored frames.
  Ping-pong walks back through the interior frames, so a cycle is roughly twice as
  long as the frame list.

There is deliberately **no x/y nudge**. Where the art sits relative to its origin is
the clip's own **bounds box**, set once in `/flipbook`; a second offset here would be
a rival answer to the same question. Move the box, or bind a different bone.

> **If the clip is deleted in `/flipbook`**, the binding stays but renders nothing —
> here and in the game. The editor says so in red under the picker, and the build
> warns as well.

### Edit the rig (Setup mode)

- **Select** a bone, slot, mesh vertex by clicking it in the Inspector tree or
  directly on the canvas; the **Properties** panel on the right shows its
  editors.
- **Bones:** numeric editors for x / y / rotation / scaleX / scaleY / length;
  drag on the canvas to move the selected bone (Shift+drag still pans); a
  gizmo on the bone origin — the yellow disc moves freely, the red and green arrows move along x or
  y only, the blue ring rotates — with **Local | View** in the bottom bar choosing whether the
  arrows follow the bone's own axes or the stage's; a **parent** dropdown to
  reparent (cycles are prevented); **rename**; **🗑 Delete bone** (root can't be
  deleted — see **What a delete takes with it** below). Add a bone with
  **＋ Add bone** in the Bone hierarchy section.
- **Slots:** reorder draw order with ↑/↓; place a region attachment
  (x/y/rotation/scale); pick a **shows / image** attachment; rename; delete.
  **＋ Add slot** adds one. **⧉ Duplicate slot** copies a slot — its image(s) and
  every animation timeline that drives it — onto the same bone, then you swap the
  copy's image to a variant (the **replace image (keep mesh)** dropdown repoints
  the region while keeping the mesh/UVs/weights/deform).
- **✨ Auto FX slots** (top of the Slots list) automates that duplicate-and-swap
  for the whole rig: for every `<base>_shine` / `_glow` / `_shadow` / `_blur` /
  `_zoom` / `_colour` region in the rig's atlas whose base image is on a slot, it
  duplicates the base slot (reusing its mesh **and** all animation) and repoints
  the copy to the FX region. Shadows are placed behind the base, other FX in
  front. It's idempotent — FX slots that already exist are skipped — so it's safe
  to click again after adding sprites. A slot that shows an **image sequence** is
  skipped, and the report says why: one FX image can't stand in for a flipbook's
  frames, and per-frame FX layers (`<frame>_glow`) can't play as a sequence.
  This is the Rigger end of the Sheet Maker → Atlas Maker FX pipeline (same `_shine`/`_glow`/… naming convention).
- **Skins:** the **Skins** section lists skins; click one to make it the **active**
  skin (what determines which images/meshes/weights you see and paint) — or pick it
  in the bottom bar's **Skin** picker, which always lists the rig's current skins. A
  new image, point, path, box, clip or linked mesh goes into the active skin, which
  stays on stage as you edit (a rename included) until the rig is reloaded. An edit to
  the image a slot shows — its x / y / rotation / scale, its pivot, **replace image
  (keep mesh)**, **▸ Convert to mesh**, **✎ Draw mesh** — changes the image you see:
  the active skin's own, or, when that skin only inherits it, default's, which every
  skin without its own image there shows too. **＋ add image…** in `default` adds a new
  image that the slot then shows (in every skin without its own). In any other skin the
  image belongs to that skin only: it becomes that skin's own image under the name the
  slot already shows, so `default` and every other skin look exactly as before (see
  **Traps**). Rename (✎), delete (🗑), and **＋ Add skin** (a new skin starts empty;
  click it to work in it). The skin named `default` can't be renamed or deleted, and the
  last skin can't be deleted: a game draws `default` whenever no skin is chosen, and
  falls back to it for any slot another skin leaves empty.
- **Deleting a bone** moves its child bones, its slots and the vertices weighted to
  it onto its parent, and they **stay where they are in the setup pose**: the
  deleted bone's position, rotation, scale and shear are folded into each of them
  (as the stage draws the pose, constraints included). One exception: an image on
  a bone whose transform would shear it (a non-uniform scale or shear) can't take
  that shear, so it keeps its centre, direction and size instead; and a bone at
  scale 0 (which flattens everything under it) can't be undone, so its children
  and slots move over with their own values unchanged. The bone's own
  animation keys are deleted with it, so in an animation its children and slots
  no longer follow its motion, and a child's own translate keys now move it along
  the parent's axes.
- **What a delete takes with it:** deleting a bone, slot, attachment or skin also
  removes every IK / transform / path / physics constraint that can no longer work
  without it (an IK or transform constraint whose target bone went, one left with
  no bones, a path constraint whose target slot went or no longer holds a path),
  together with that constraint's animation keys, and a notice names each one.
  A linked mesh whose parent mesh (or the skin holding it) is deleted becomes a
  plain mesh with a copy of that geometry and its deform keys, so it looks and
  moves as before; animated draw orders keep their order minus the deleted slot.
  One **↶ Undo** (Ctrl+Z) puts the whole delete back.
- **Constraints:** **＋ Add constraint ▾** makes one on the selected bone from a preset, and puts it
  last in the solve order, after every one already there. Each preset writes one constraint the game
  already plays:
  - **Two-bone IK** — the bone and its parent reach a target, bent the way the arm is bent now;
    **Aim / look at** — the bone points at a target (a 1-bone IK); **Spline IK** — a chain of 3 or
    more bones (each with one child) lies along a curve that 2–4 new controls bend.
  - **Orient** (turn with a target), **Copy location**, **Copy scale**, **Child of** (follow a target
    as if parented to it, from where the bone is now) and **Look (eyes)** (a pupil follows 0.15 of a
    look control's move).
  - **Jiggle** (physics on the rotation), and the plain **Path**, **IK** and **Transform**.

  A preset that reaches a target asks for it (🎯 in the Constraints section and the hint): click the
  target bone on the stage or in the bone tree, or **＋ New control** to make a new bone placed so
  nothing moves yet; **Esc** or ✕ cancels. A target inside the chain is refused. A preset the
  selected bone cannot take is greyed out in the menu, with the reason.
  The list is the **solve order**: each constraint runs after the ones above it, numbered from 1. In
  Setup mode drag a row to another place (one ↶ Undo puts it back). Click one to edit it below; its
  header has ✎ rename and 🗑 delete. An IK on two bones (the selected bone and its parent) shows mix,
  softness, **bend +** and **stretch**; on one bone, mix, **compress** and **stretch** — the fields
  its solve reads. **uniform** also scales the bone's height when it stretches or compresses.
  **On the stage** (with **Bones** on) a constraint's bones take its colour — IK amber, transform
  violet, path teal, physics pink — with a dashed line to what it follows and a diamond on the
  target; a path constraint also draws its curve. A constraint at mix 0 is faint, the selected one
  bright with its bones ringed, one that never runs red. Grabbing a bone whose rotation or position
  a constraint solves says so in the hint (the key or setup edit lands, but the solve draws over
  it). A Spline IK's path is bound to its controls: move them to reshape it.
- **Controls (the control layer).** Any bone can be a **control**: a shape drawn over the art that a
  click selects, like a professional rig's. Open the bone's **Control** card (under its fields in
  Properties) and give it a **shape** — circle, ring, square, diamond, arrow (one, two or four
  ways), cross, box (a face-board slider whose frame stays put while the bone moves inside it) or
  a polyline of your own points — and its **colour** (left bones blue, right red, centre yellow
  until you pick one), **size** (screen pixels, or rig units so a ring hugs an arm), line width,
  fill, offset and turn. **role** says what the bone is: *deform* (art hangs on it; with a shape it
  is an FK control), *control*, or *helper* (rig plumbing, hidden unless shown). **keys** lights
  the channels the gizmo and ◆ Key may key in Animate (Move / Rotate / Scale; a ring is Rotate only
  by default); **limit …** holds a drag inside [min, max]. **hidden** and **locked** take a bone
  off the stage or stop it being picked there (the tree still selects it; the 👁 / 🔒 on a bone row
  do the same); **layer** puts it in a layer. ＋ Two-bone IK, Aim, Look, Spline IK and the follow
  presets make their new controls controls already. A click lands on a control's shape before the
  bones; Shift-click (or Ctrl-click in the tree) adds a bone to the selection.
  The **Control layer** section lists the **layers** (👁 hides one on the stage, 🔒 stops its bones
  being picked, ⇥ moves the selection into it, click a layer to select its bones) and the
  **selection sets** (＋ saves the selection; click one to select its bones). Its 👁 **Show hidden**
  draws hidden bones faint so they can be picked. **🎛 Controls** in the bottom bar is the
  **animator view**: only the controls are drawn and picked. All of it is kept in `controls.json`
  beside the rig's `.irig` and saved with it; none of it reaches the game, and ↶ Undo covers it.
  A control's **display** says where it shows: on the stage and as a Picker button (the default),
  on the stage only, or in the Picker only (a switch with no place on the body).
- **Mirror — left and right.** The Control layer's **Mirror** block pairs left and right bones by
  their names (`…_l` / `…_r`, `L_` / `R_`, `left` / `right`, any case; `hand_ik_l_chest` pairs with
  `hand_ik_r_chest`). For names the rule cannot pair, select the left bone, then Shift-click the
  right one and press **＋** on the Mirror header (one bone alone pairs with itself: a centre bone
  a swap flips); 🗑 forgets an added pair. A side bone with no other side is named under the block.
  The **line** menu sets the mirror line: the root's x = 0 by default, or a bone — along its
  length, or up its y axis for a bone with no length — drawn dashed on the stage while the section
  is open. A body that turns mirrors best across its spine or chest. In Setup, **⧉ R from L** builds
  the right side the rig is missing from the left (**⧉ L from R** the other way): every left bone
  with no right one gets one, at the mirror of its setup, with the slots on those bones (the same
  images, flipped), the constraints acting on them (an IK's bend, a transform's offsets, mirrored)
  and their controls (limits and shape placement mirrored), limbs, sets and Picker buttons. New bones
  go at the end of the list and a new slot draws just above the one it mirrors — in every clip's draw
  order too, so an arm a clip puts behind the body has its pair beside it. A rig it cannot mirror is
  left as it was, with the reason. One ↶ takes it all back.
- **The Picker** (its own section under the Control layer) lays the controls out as buttons where
  they sit at setup, scaled to fit, with each limb's switch under its control and the selection sets
  at the foot. Click a button to select its bone, Shift-click to add one, drag across the board to
  select every button in the box; a set's button selects the set. **✥** moves buttons (drag one;
  ✕ takes one off the board) and from then on the layout is kept in `controls.json`; **＋** adds the
  selected bones, a set or a limb; **⟲** goes back to the automatic layout. A rig made from a
  template with Controls also gets a **face board** under the buttons (see Animate).
- **A rig made from a built-in template starts with its control layer.** ＋ New rig writes it to the
  rig's `controls.json`: a **ring** on each FK bone (spine, chest, neck, head, shoulders, arms,
  hands, and on Full body the legs and feet) and a **square** on the hip; layers **Body FK**, **Face**,
  **Fingers**, **Body IK** (the hand and foot controls and the elbow and knee poles) and **Helpers**,
  hidden (the image hinges and space bones); selection sets (each arm and leg, both arms, the torso,
  each hand's fingers); the mirror line on the spine (the chest on Bust with face); and a Picker
  layout of the rings, the hip, the sets and the limbs' FK / IK switches. Everything stays editable.
- **A rig made from Half body or Full body starts with IK limbs** — Half body's arms, Full body's
  arms and legs, each a **3D limb** (see *IK in 3D* below): the arm reaches its hand control
  (`hand_ik_l`) bending toward its elbow pole, the hand control in **chest** space (it follows the
  chest) with **world** space beside it; a leg reaches its foot control in **world** space (so a
  crouch keeps the feet planted), bending toward its knee pole. Every IK is **off** until a clip
  switches it on, so every starter clip, face clip and motion import plays as before. The IK is
  solved in 3D, so it works once the rig is **🧊 Make 3D** and in a 3D clip; until then the
  Picker's switches read **3D** and a click says so.
- **Meshes:** select a slot whose attachment is a mesh to edit its geometry — drag
  vertices, **＋ Add vertex** (click inside the mesh), **－ Remove vertex** (click
  an interior vertex — hull vertices can't be removed until you drop them to
  interior with **⬡ Hull** first), and numeric UV editing on a selected vertex.
  **⟁ Re-triangulate** re-weaves the whole mesh through every point (Delaunay over
  the hull + interior points, honouring your constraint edges) — drop interior
  points, then re-triangulate so the triangles pass through them. Turn a region
  into an editable quad mesh with **▸ Convert to mesh**, or **✎ Draw mesh** to
  trace a mesh outline by clicking boundary points (Finish to commit, Esc to
  cancel, Backspace removes the last point). Either one replaces the image you
  see (**Skins** above says which skin's that is) and draws exactly the pixels it
  drew — also when the atlas trimmed the image's empty edges or packed it rotated:
  the mesh's UVs are in rig's own space (a fraction of the whole, untrimmed
  image), laid where the image's ink sits in it. On an **image sequence** the mesh
  keeps the frames (its ▩ declaration, setup frame and sequence keys). If the
  atlas trimmed the frames differently, you are asked first: a mesh has one set of
  UVs for every frame, so it covers the ink of all of them and a frame with less
  ink shows whatever the atlas packs beside it — pack the frames without whitespace
  stripping for a clean mesh.
- **Outline / hull (⬡ Hull):** in the mesh tools row, **⬡ Hull** turns on
  outline editing — it changes which vertices sit on the mesh **outline (hull)**
  rather than floating inside it. Click an **interior** vertex to **promote** it
  onto the boundary (it's inserted at the nearest edge that keeps the outline from
  crossing itself, so the silhouette grows to include it); click a **hull** vertex
  to **demote** it back to interior (the silhouette pulls in past that point). An
  outline needs at least **3 hull vertices**. While ⬡ Hull is on, the current
  outline loop and its hull vertices are highlighted **bright green** (and slightly
  enlarged) so you can see exactly which vertices are on the boundary. This is also
  how you free a former-hull vertex for **－ Remove vertex**: demote it to interior
  first, then remove it.
- **Constraint edges (✎ Edge):** in the mesh tools row, **✎ Edge** turns on
  constraint-edge editing. Click **two vertices** to toggle an edge the
  triangulation must keep — draw one along a limb, say, so the mesh bends there.
  Clicking the same first vertex again cancels the pick; clicking the two ends of
  an existing constraint again **lifts** it. A constraint **survives ⟁
  Re-triangulate** (it's fed into the triangulation and force-inserted if the
  Delaunay pass didn't include it) and **saves with the mesh** (as the rig
  `edges` field), so it round-trips into an external rig editor too. Constraint
  edges draw **amber** on both the main canvas and the UV map panel, and the
  first-picked (armed) vertex is highlighted amber. **Hull boundary edges** are
  always kept and can't be toggled — the tool tells you so if you try.
- **UV map panel:** with a mesh slot selected, a square **UV map** panel appears in
  the inspector below the mesh tools. It draws the mesh's **whole image upright** (the
  atlas's trimmed ink in its place on the untrimmed image, which is what UVs span) with
  the **mesh wireframe** (triangles + vertex dots) overlaid on it, so you can see
  exactly which part of the texture each vertex samples. **Drag a vertex over the
  art** to re-map its UV (it stops at the image's ink: past it is the atlas's next image) —
  this is the visual complement to the numeric **u / v**
  fields and to the isolate-mode (⛶) world-space reshaping. Selection is shared: a
  vertex picked in the panel highlights on the main canvas and fills the numeric
  u / v fields, and vice-versa. Any **✎ Edge** constraint edges show **amber** here
  too, so you can read them against the texture. The panel only shows when the
  mesh's region art is resolved (not for a missing-art/placeholder mesh).
- **Isolate a mesh to edit it (without distorting the art):** with a mesh selected,
  **⛶ Isolate mesh** hides every other slot, holds the setup pose, and frames the
  mesh so you can reshape the wireframe unobstructed. Crucially, dragging a vertex in
  this mode **does not distort the sprite** — the vertex's texture mapping (UV)
  re-pins as it moves, so moving an interior vertex changes only the triangulation
  and moving a hull vertex re-cuts the outline; the picture stays put. (Normal
  vertex dragging outside isolate still warps the image, for posing-style edits.) A
  **🖼 Texture** button cycles the mesh image **full → dim → off** (off = wireframe
  only). The image stays bound the whole time — toggle **⛶** off to drop back into the
  full rig with your edits live. All the mesh tools above work the same inside it.
- **Back to the original shape (⟲ ▭):** the two icons at the right of **⛶ Isolate mesh** take
  the mesh back in one step — **↶** brings the edited mesh back. A tooltip says what else goes
  with it; anything thrown away (weights, deform keys) is asked first, by name and count. Each is
  off, saying why, when there is nothing to go back to.
  - **⟲ Back to the saved shape** — the mesh as the rig was last opened or **💾 saved**: its
    vertices, UVs, triangles, outline, ✎ edges and weights. Weights are matched to bones by name,
    so bones added or reordered since don't scramble them. Deform keys stay when the vertices are
    the same ones (only moved, and ⛶ re-pinned *or* ⟁ re-triangulated, not both); otherwise every
    animation's deform keys on it — and on each linked mesh keyed on its own — go back to the saved
    ones, and keys made since go. Off when the mesh already has that shape; was not a mesh of its
    own when saved (↶ the convert, or ▭); was added or renamed since; is weighted to a bone renamed
    or deleted since; or, unweighted, its slot is on another bone now (🗑 a bone moves its slots to
    the parent) — then use ↶ or ▭.
  - **▭ Back to the image** — the 4-corner mesh **▸ Convert to mesh** makes: over the image's
    ink (every frame's, for a sequence), unweighted, no ✎ edges, where the image sits. Converted
    since the last save, that is where the image was — as long as three of the mesh's points
    still sit where that image put them (not if the image was moved or scaled before converting).
    Otherwise the points vote: where most of them, now and as saved, put the image. A point you
    dragged outside ⛶ doesn't count, and nor does a point you ＋ added into a triangle after
    dragging one of its corners — it follows the drag. One corner of a plain 4-corner mesh dragged
    along an edge and saved that way fits two places equally: ▭ takes the image unstretched
    (square corners, the same scale both ways), so check it. Off when fewer than a majority agree
    — a mesh shaped by hand (most Spine-made meshes are) has no image placement to go back to; use
    ⟲. It drops the mesh's weights and every deform key on it and its linked meshes; linked meshes
    take the quad, and a sequence keeps its frames and keys. It stays a **mesh** (its linked
    meshes and sequence need one): for a plain image again, ↶ the convert, or delete the mesh and
    add the image anew.
- **Linked meshes:** **＋ Linked mesh** (offered on a slot that already has a mesh) adds,
  to the active skin, a mesh that borrows the slot's first mesh — its vertices, UVs,
  weights and image — and follows it when you edit that mesh. Pick another in its
  **source** dropdown, which lists every mesh on the same slot, in any skin (a linked mesh
  can only borrow from its own slot); **inherit deform (timelines)** makes it follow the
  source's deform keys too. A linked mesh of an **image sequence** mesh shows the same frames
  and follows the source's sequence keys; switching its source to a mesh that is not a
  sequence takes the frames, and any sequence keys of its own, away.
- **Weights:** on an unweighted mesh, **Bind to slot bone** makes it weighted
  (every vertex 100% to the slot bone). Selecting a weighted-mesh vertex lists its
  bone influences with auto-normalising weight inputs, an ✕ to remove an
  influence, and a dropdown to add a bone. The **🖊 Weight brush** paints weight
  toward a chosen target bone (radius / strength / subtract-to-erase), with a
  blue→red heatmap on the vertices showing the current weight map.
- **Auto-weight to chain:** select the chain's ROOT bone in the inspector, then
  **② Auto-weight to chain** (or **↻ Auto-weight to chain** on an already-weighted
  mesh) smooth-skins the mesh across that bone and all its children. Each vertex is
  weighted to its nearest bones (up to four) by distance to the bone segments;
  zero-length bones are skipped. It replaces the mesh's current weights. It is a
  starting point — refine the result with the brush.

#### Pivot — the point an image hangs from (**✥ Set pivot**)

Select a slot with an image in Setup mode and, under its placement fields (x / y / rotation /
scaleX / scaleY, above **▸ Convert to mesh** / **✎ Draw mesh**), a **pivot** section offers a
**✥ Set pivot** button, a 3×3 snap grid and a readout like `50% × 100%`.

**The pivot belongs to the image, not to the skeleton.** Setting it creates, moves and deletes
nothing in the bone hierarchy — a bone stays a separate thing you add deliberately. The pivot is
stored on the attachment itself as `pivot: [u, v]`: across and down, 0..1 of the image, absent
meaning centred.

**Why it needs storing at all.** Rig has no pivot field. A region attachment always places and
rotates its quad about its own image centre and only then offsets by x/y — which is why a fresh
image hangs from, and turns about, its middle. The key we add is non-standard but inert: the
official 4.2-format loader ignores it and the rendered geometry is byte-identical, so the `.irig`
still opens in rig, with no sidecar.

**What it does.** The pivot is the image's **anchor** — the point of the picture that sits at the
slot's position. Choosing a new one **moves the image** so that point takes the pivot's place; the
pivot itself stays where it is. Pick bottom-centre and the picture jumps up until its bottom edge
rests on the pivot. (This is the sprite-editor behaviour you expect.) The **rotation / scaleX /
scaleY** fields just above then turn and scale the image _around the pivot_, adjusting x/y so the
pivot point is the one point of the image that stays put. An image whose pivot is still centred
behaves exactly as it always did — centred is the default, and setting it back to centre is a
complete no-op.

- **✥ Set pivot**, then click or drag on the image on the canvas to pick the point it hangs from.
  The crosshair follows the cursor and the image re-hangs when you release. The mode stays on so
  you can keep nudging; **Esc** leaves it.
- **Or click one of the 3×3 cells** for the image's corners, edge midpoints or centre — bottom
  centre in one click.
- The **✥** marks the cell the pivot is on, and the readout (e.g. `50% × 100%`) is where it sits
  inside the image — across × down. While the mode is on, the canvas draws an orange crosshair at
  the pivot over a faint outline of the image.
- **The fractions are of the _untrimmed_ image** (rig's `width` / `height`), not of the packed
  atlas rect — so on a region the packer cropped, the rendered art's edge sits a pixel or two
  inside the pivot box: clicking the visible top-left corner of a region trimmed by 1px reads
  `1% × 1%`, not `0% × 0%`. That is deliberate — re-packing an atlas must never move anybody's
  pivot.

**It applies to images (region attachments).** A mesh's shape lives in its vertices, so there is no
rotation/scale placement to pivot around — the panel says so instead of offering the control. Same
if the slot has no image yet.

**Migrating an older rig.** An earlier version of this tool implemented the pivot by adding a bone
named `<slot>-pivot`. If a rig still has one, the pivot panel detects it and offers **✕ Remove "…"
and fold it back** — the exact inverse of what was written, so the art stays exactly where it is.
(It is offered only while that bone is still safe to remove: nothing else parented to it, no other
slot on it, no constraint or animation touching it.) Where that earlier version moved a slot's
_own_ existing bone instead of adding one, there is nothing to detect and the bone stays where it
was put.

### Localized text (Setup mode → **Text (localized art)**)

Put a **translated string into the rig as art**, then rig it like anything else. The section
sits in the outline under Skins.

1. Select the bone the text should ride (or nothing, for the root) and press **＋ Add text…**.
2. Pick a **localization key** — the string always comes from `/localization`, never typed
   here — and a **font** from the project's font catalog. Set the size, colour and letter
   spacing; the panel previews the source language live.
3. Give it an **element id** (it becomes the slot + attachment name) and press
   **Bake + place**.

What that does: the string is rasterised **once per locale** — the source language plus every
locale that has a translation in `/localization` — packed onto a page inside the
rig's own atlas, and placed as a slot on its **own bone**, with one region attachment per
locale named `<id>@<locale>`. The source locale is the setup attachment.

From then on it is an **ordinary region**: convert it to a mesh, bind and paint weights, deform
it, key it, show and hide it, and cast the rig in a cinematic. Converting the source locale to a
mesh automatically **relinks the other locales as linked meshes**, so the mesh, the weights and
the deform you author once drive every language.

In game, the slot is switched to the player's language automatically; a language with no baked
variant falls back to the source art.

- **Opening a rig keeps its text current.** If `/localization` gained a language or a string
  changed since the last bake, the rig re-bakes and saves itself on open (it won't while you
  have unsaved edits). A translation wider than the source language is re-rasterised at a
  smaller font size so it fits the same width; one that cannot fit at the smallest size ships
  wide and the panel warns.
- **✎** re-bakes an element by hand (after you change the font, size or colour). A re-bake
  reloads the rig's atlas, so the tool **saves the rig first** — it asks. Existing attachments
  keep their authored placement, mesh and weights.
- **✕** removes the element, its slot, its attachments and its atlas regions.

Three things to know before you use it:

- **The text is ART.** Changing a string is a pipeline step (re-bake, re-save), not a runtime
  one. Use it for `FREE SPINS`-style display copy; anything dynamic (a win amount, a counter)
  stays a live text node in the Scene Editor.
- **A mesh is authored against ONE locale's rendering.** Other locales share its vertices as
  linked meshes, so a longer translation (German is the usual offender) is stretched onto the
  same mesh and the width fit above cannot apply. Keep text as a plain region unless it really
  needs to deform.
- **Translations are baked whether or not they are reviewed.** The panel shows how many are
  unreviewed; fix a string in `/localization` and re-open the rig to reship the art.

### Animate (Animate mode)

- Create/manage animations in the **Animations** section: **＋ New animation**,
  ✎ rename, ⧉ duplicate, 🗑 delete. A rig can hold many animations.
- With an animation selected, the bone/slot Properties show the **pose at the
  playhead**. Editing a field — or dragging a bone on the canvas — keys that
  channel. The bone Properties also give per-channel **Key** buttons (one beside
  `rotation`, one beside `x`/`y`, one beside `scaleX`/`scaleY`) that key only that
  channel, plus a **◆ Key all transforms** button that keys all three at once for
  the selected bone. Bottom-bar tools: **◆ Key** (keys rotate+translate+scale of the
  selected bone, or attachment+colour — and the mesh shape — of the selected slot),
  **◆ Key all** (keys _every_ bone's pose plus _every_ slot's attachment + colour at
  the playhead, and the shape of every mesh the clip already shapes), **|◀ / ▶|**
  prev/next key, **✕ Key** deletes the selected bone's key at the playhead, or the
  selected slot's (its image, colour and shape keys there). The rotate/move gizmo
  also keys on release.
- **Controls in Animate.** A control keys only the channels its **keys** allow: the gizmo shows only
  those parts (a ring control has just its ring), the other fields are greyed, and ◆ Key / ◆ Key
  all skip them. A drag is held inside the control's limits, and the bone's panel warns when the
  pose at the playhead is outside one. **◆ Key** keys every selected bone. In the **Control layer**
  section, **⟲** keys the rest (setup) pose of the selection at the playhead and **⌫** clears its
  keys there — select a set or a layer first to reset a whole group. An IK target's Control card has
  **⌖ To the tip of …**, which puts the target on the end of its chain as drawn now, so turning the
  IK on does not jump.
- **Mirror pose.** In the Control layer's **Mirror** block, **L→R** keys the right side at the
  playhead with the left side's pose, reflected across the mirror line; **R→L** the other way; **⇄**
  swaps the two and flips the centre bones under the line (a head turned left turns right). Each
  bone keeps however far its own setup is from its pair's exact mirror, so the rest pose mirrors to
  the rest pose on a rig drawn not quite symmetric. A paired constraint takes its pair's mix (an
  IK's bend is the one that puts the elbow on the mirrored side), and a control that follows a space
  is keyed through its space bone. It writes ordinary keys (one ↶), respects each control's locked
  channels and limits, and a key inside an eased stretch keeps the curve's shape. The hint names any bone it
  could not put on the mirror — a locked channel, a limit, or a constraint with no pair.
- **The Picker in Animate.** A limb's button shows its state at the playhead (FK, IK or the blend)
  and a click switches it, as ⇄ To IK / To FK do; **▾** on it picks the space its control follows;
  **⤳** matches IK to FK over the whole clip — the control (and the pole) keyed where the FK arm is
  at every key, IK from the start — so a clip (a motion import, say) plays as before, now on its
  control, ready to fix a contact or put a hand on a prop. It matches at the clip's keys: between
  two far-apart keys the control moves in a line where the FK arm swung an arc.
  The **face board** shows the template's Controls as sliders and boxes — a gaze pair as one box
  whose dot you drag in both directions, at the places the template gives (else in a grid) — and a
  drag keys them at the playhead, the same keys as the Controls section's sliders. The built-ins
  place theirs: Bust with face and Half body show the face (brows, blinks, the gaze and head-turn
  boxes, cheeks, mouth, jaw, tilt and nod); Full body, which has no face, the body controls no ring
  reaches (hop, move, turn, breath, nearer, the hand poses and arm depth). The board grows as tall
  as its controls need.
- **A ring on a bone a template control moves keys that control.** Turning Full body's spine ring
  keys **Lean** — the chest turns half as much, as Lean always does — and the Lean slider reads it
  back; an arm's ring keys its Raise control, held to that control's range. A ring on a bone no
  control moves (a hand on Full body) keys the bone itself.
- A **constraint's** panel in Animate mode shows its values **at the playhead** in the open clip
  (the setup's until the clip's first key for it), and editing a value keys it there — the setup,
  which every clip that does not key the constraint plays, is edited in Setup mode only. **◆ Key**
  keys the values as shown (all five for an IK, so a bend − stays bend −). Fields no key can change
  (a target, offsets, modes, a physics bone) are greyed in Animate mode.
- **Limbs — switch an arm between FK and IK, and say what its hand follows.** A 1- or 2-bone IK's
  panel has a **Limb** card (also under the Control card of the limb's control, pole, FK and space
  bones). **＋ Make limb** makes the IK a limb: its chain is the FK side, its target the control.
  Give it a **pole** (any bone outside the limb, such as an elbow diamond on the chest): dragging the
  pole across the shoulder → hand line keys the other bend there (◆ keys it at the playhead). In
  Animate, **⇄ To IK** keys the control on the FK wrist and the bend the arm has, and turns the IK on
  at the playhead; **⇄ To FK** keys the FK bones where the IK put them and turns it off — neither
  jumps. Type a time in **to (s)** (or **⇥** for the clip's end) to also match every key up to
  there, so a clip cleaned up in IK hands back as FK; **⤳ Match clip** matches IK to FK over the
  whole clip (as the Picker's ⤳). On a leg solved in 3D, **👣 Plant** plants that foot over the clip
  as the import's **👣 Plant feet** does (its contacts found with the other feet as the ground); it
  is refused once the leg is switched to IK in the clip. **Spaces**: **＋** adds one the control can
  follow — the chain's parent (the chest), the world, a prop, or a space bone the rig already
  carries — as a hidden space bone and a transform constraint, off until a clip switches to it and
  solved before the IK. **⇄** on a space (or on **own keys**) switches at the playhead and keeps the
  hand where it is; while it follows a space, dragging the control's gizmo keys that space bone. In
  the dopesheet the space bones, the IK mix and the spaces' mixes sit **↳ under the control's row**.
  Everything a limb writes is ordinary keys and constraints the game plays; the limb itself is in
  `controls.json`. A 3D clip's bake owns the bones of a 2D IK, so on a 2.5D rig make the limb with
  **Two-bone IK in 3D** instead (below, *Turn the view and pose in 3D*).
- A **dopesheet timeline** docks below the stage: a time ruler, one track per
  keyed bone/slot with key dots, and a draggable playhead. Drag a key dot to
  retime it, double-click to delete it, and use the per-key easing buttons
  (Linear / Stepped / Ease In / Out / In-Out) for interpolation. Re-keying a bone
  on a key (a drag, ◆ Key, ⟲ Rest, a Controls slider) keeps its easing, and the
  easing into it, fitted to the new value. **Multi-select
  keys** to move them together: click a dot to select it, **Shift/Ctrl-click**
  to add/remove, or **Shift/Ctrl-drag a box** across the rows to marquee-select
  (adds to the existing selection) — then drag any selected key to retime the
  whole group, or press **Delete** to remove them. **Select a whole line** (all
  its keys) by **Shift/Ctrl-clicking the track's name** in the gutter; do it on
  several lines to build up a multi-line selection. **Alt-drag** any key (or a
  whole selection) to **duplicate** it — a faded **ghost** previews where the
  copies will land while you drag; on release the copies drop there, the
  originals stay in place, and the new keys stay selected. A plain drag on a
  track scrubs the playhead (as does the ruler).
- **Stretch the timing of a selection** — select **two or more keys** and a green
  **range bar** appears on the ruler spanning them, with a **⟺ grip at each end**
  and a yellow **pin** marking the **anchor**: the one time that will not move.
  Drag either grip and every selected key's distance from the anchor scales by
  the same amount — pull out and they spread, push in and they close up. Easing
  scales with them, so the animation keeps its feel, just slower or faster.
  - The anchor starts on the selection's **earliest** key, so dragging the right
    grip stretches the whole selection to the right. **Click any selected key** to
    move the anchor onto it (the pin follows). Anchor a key in the **middle** and
    both sides spread out from it at once.
  - The grip that sits *on* the anchor is greyed out — there is nothing to pull
    from a point that by definition stays put.
  - Only the **selected** keys move; everything else stays where it is. As with an
    ordinary drag, a selected key landing exactly on an unselected one replaces it.
  - If a selected key sits at **0s** and the anchor is to its right, you can only
    squash, not spread: spreading would push that key before the start of the
    animation. The status line says so when you grab the grip.
  - If the stretch would land a selected key **on top of an unselected one**, that
    key is destroyed (the same as dragging a key onto another). So you are never
    surprised by it, the bar turns **red** while it would happen and the status line
    counts them — `⚠ would OVERWRITE 2 unselected key(s)` — then reports what it
    actually overwrote on release.
- **Image-sequence rows** — a slot animated with a rig **sequence** (a flipbook of
  numbered images baked into the atlas) gets its own `▩ <slot> · sequence` row, with
  **square** keys in the legend's `sequence` colour. Hover a key to read what it does:
  its play **mode** (`hold` / `once` / `loop` / `pingpong` and the reverse variants),
  which **image** it starts on, and how long each image is held — marked *(inherited)*
  when the key takes that hold time from the key before it, as the format allows.
  These keys retime, duplicate, delete and stretch exactly like any other, and a
  stretch scales the hold time with them so the flipbook still fills its new span
  rather than finishing early.
- **Making an image a sequence** — in **Setup** mode, a selected slot's Properties
  gain an **▩ image sequence** section. If the atlas holds a numbered run for that
  image (`expl_01`, `expl_02`, …) it offers **▩ Make this a sequence** and reads the
  frame count, first number and zero-padding straight off the atlas. Picking any
  single frame of a flipbook is enough — it strips the number and offers the whole
  run. Once declared, four fields are editable:

  - **frames** — how many images the flipbook has.
  - **first number** — the number on the *first* region. Rig defaults this to **1**,
    not 0, and real rigs use both.
  - **digits** — zero-padding width; 2 makes frame 1 read as `01`.
  - **setup frame** — which image (0-based) the setup pose shows.

  Underneath, the panel names the regions the declaration resolves to and whether
  each one is there — `✓ all 13 frames resolve: symbexpl_01 … symbexpl_13`. This is
  not decoration. **Rig refuses to load a sequence with a missing frame**, so a
  wrong count, first number or padding produces a rig that will not open at all.
  The editor therefore checks every frame against the atlas and **will not write a
  declaration that does not fully resolve**, telling you which region was missing.
  (`setup frame` is exempt: the runtime clamps it, so it cannot break anything.)
  **✕ Not a sequence** turns it back into an ordinary image, re-pointing the slot at
  whichever frame the setup pose was showing. If the image is keyed as a sequence
  anywhere, it asks first and removes those keys too — a sequence timeline left on
  an image that is no longer a sequence stops the rig loading.
- **Keying a sequence** — with the slot selected in **Animate** mode its `▩ sequence`
  row appears even before it has any keys. **◆** on that row keys it at the playhead,
  continuing from the key before it rather than restarting at image 0. Click any
  sequence key to open its inspector in Properties:

  - **Plays** — `hold` stays on one image; `once` runs to the end and stops; `loop`
    restarts; `pingpong` bounces. The `Reverse` variants run backwards.
  - **Starts on image** — 0-based, clamped to the declared frame count.
  - **Hold each image (ms)** — how long one image shows, with the resulting
    images/second underneath. Leave it **empty** to inherit from the key before it;
    that is a different thing from **0**, which holds on a single image, and the field
    never turns one into the other.
- A separate **Graph** view (Dopesheet ⇄ Graph switch) plots value-over-time
  curves with draggable keyframe and bezier-tangent handles. Multi-select works
  the same way — Shift-click points, marquee-drag the background, or **click a
  curve line** to select all of its keys (Shift adds another curve); a selection
  of ≥2 points shows a bounding box whose edges scale the timing/values, and
  Delete removes the selected keys. **Alt-drag** duplicates the selection — a
  ghost previews the drop and the originals stay put. Right-click a key for the
  easing menu. Pick a **constraint** (its row in the Constraints section, or the menu at the
  left of the graph's legend, which lists the selected bone and the constraints on it) and the
  graph shows its curves instead: an IK's mix and softness, a transform's six mixes, a path's
  position, spacing and mixes, a physics constraint's values. Shape a blended FK / IK switch or
  a space blend there like any curve; a mix is held between 0 and 1. Picking another bone goes
  back to its channels.
- Slot animation is supported too. With a slot (object) selected in Animate mode
  its Properties give three keyable channels at the playhead:

  - **shows** — which **attachment** (image/mesh) is visible (stepped swap).
  - **colour** — the slot's **tint** (RGB only; opacity is preserved).
  - **opacity** — a dedicated 0–100% slider plus a **◆ Key opacity** button to
    animate the object fading in / out. Key it at two playhead positions to make a
    fade. When a colour/opacity key sits at the playhead, **easing** buttons
    (Linear / Stepped / Ease In / Out / In-Out) shape the interpolation out of it.

  Colour and opacity share one `rgba` timeline under the hood (byte-valid rig
  4.2), so editing one never clobbers the other.
- **Mesh shapes (deform keys).** Select a mesh's slot (in the tree) and its vertices
  show as handles: **drag a vertex** to key the mesh's shape at the playhead. Scrub
  elsewhere and drag again for a second shape; the mesh eases from one to the next.
  The slot's Properties get a **mesh shape** row — **◆** keys the shape as it shows
  now, **✕** deletes the shape key at the playhead, and a key at the playhead gets the
  easing buttons. The dopesheet has a `◈ <slot> · deform` row whose keys look, select,
  drag, duplicate, stretch and delete like any other channel's, with its own **◆**.
  - Every mesh the clip shapes plays while you scrub, selected or not, and Setup mode
    always shows the setup shape. Before a mesh's first shape key it shows its setup
    shape, as the game does.
  - A weighted mesh keeps one offset per bone **influence**, each in that bone's space,
    so a shape follows the bones it is weighted to.
  - A **linked mesh** that inherits deform is keyed on its source mesh (it plays the
    source's keys in the game); one with **inherit deform** off is keyed on itself.
  - With another skin active, a mesh only the default skin has is keyed under default —
    the skin is not given a copy of the mesh.

#### 3D clips (2.5D rigs)

A rig can turn its bones in 3D — an arm reaching toward you, a head turning round — while the game
still plays ordinary 2D keys: each 3D clip is **baked** into them, and the bake is what plays.

- **🧊 (Animations tools)** — on a 2D rig it reads **🧊 2D rig**; pick **🧊 Make 3D — side** (front,
  ¾ and side drawings) or **full** (and back drawings). A rig made from a 2.5D template offers side,
  and full too when its art has back drawings (`torso_back`, `head_3q_back_l`, …), with the
  template's parts at depth and the drawings by angle its art has; a slot whose bone carries more (a
  hand with its fingers) moves onto an image bone of its own, drawn exactly where it was. How far the
  rig turns is fixed once you save.
  On a 3D rig the box beside it is the bake's **tolerance** in rig units (empty = 0.45; hover it),
  and **🧊 Turn 3D off** keeps every 3D clip as baked, as a plain 2D clip (undo brings it back).
  Making a rig 3D changes no clip: they stay 2D until you make one 3D.
- **The clip's settings** (Animate) — **🧊 3D from this clip** makes the open clip 3D: it keeps its
  keys (it plays exactly as before) and its bones can now turn in 3D. A 3D clip shows **🧊 3D clip ·
  N bones baked**, and how many short runs missed the tolerance (hover for the bones and times —
  they sit around a card turning edge-on). **⇲ Detach** makes it a plain 2D clip of its bake.
- **The bone panel** on a 3D clip — **rotation**, **tilt** (the bone's length toward you, +),
  **twist** (about its length) and **depth** (toward you, from its parent's card), then **x / y**
  and **scale**. A field keys when you press Enter or leave it. A bone lying flat in its parent's
  card (a finger on the hand) keeps its 2D keys; a tilt, twist or depth makes it a 3D bone, and its
  2D turns become 3D ones. Dragging a bone on the canvas turns it about the view axis and keeps its
  tilt. In **Setup**, a 3D rig's bone has a **depth** field too.
- **The dopesheet** lists each bone's keys as you made them — not the bake's — with **3D turn** and
  **depth** rows under **sel**; drag, Alt-drag, delete and easing work as on any key. The draw order
  and a drawing slot's image keys are the bake's, so they are not listed (and keying them is
  refused with a hint).
- **The Graph view** draws a 3D bone's turn as three curves — **rotation 3D**, **tilt** and
  **twist** — and its **depth** (the legend lists them only for a bone that has them). Drag a point
  up or down to change that angle at its key (the others stay as drawn), sideways to move the key;
  select a key's tilt and twist together to move both; Alt-drag copies the whole key. Between keys
  the curves show the 3D turn itself, so they bend where two angles change at once. Right-click a
  turn's point for its easing (it eases the whole turn, as in the dopesheet); depth has tangent
  handles like any value. Each drag bakes the clip once, when you let go.
- **Each edit bakes the clip again — in the background.** Selecting, scrubbing, opening panels or
  turning the view bakes nothing; a key does, a moment after you stop editing, while you keep working:
  the 🧊 bar shows a small **baking** mark, the stage shows the 3D pose meanwhile, and another edit
  starts the bake over. Undo puts back the clip with its bake. 💾 Save waits for a bake under way
  (**Baking “clip” in 3D before saving…**), then sends the 3D data, and the server bakes it the same way.
- Renaming a 3D clip carries its 3D keys; deleting it removes them; **⧉** duplicates its bake as a
  2D clip.
- **⇄ Transitions** — a card in the Animations section of a 2.5D rig (one with 3D clips;
  hover its header for what it does). A transition is a clip named `<from>_to_<to>` in which
  every bone turns in 3D from one clip's pose to the next clip's start, for a game to play
  between the two instead of a 2D crossfade (which can jump when a card is near edge-on). Pick
  the two clips, when it leaves the first (blank = at its end) and how long it takes, then
  **＋**: it is baked at once, and listed with its start, length and **🗑**. Change a start or
  length to bake it again; a value it cannot take (a length of 0, a start before 0 or after the
  first clip ends) is refused with the reason. It is baked again whenever you open it after
  changing one of its clips, and 💾 Save sends it. Undo works on all of it. Its tracks are baked:
  a 2D edit of them is refused, as on a 3D clip.

#### Reuse animations across rigs

You can move an animation from one rig (or project) onto another. Animations are
self-contained clips, so this is just a copy of the clip's keyframe data.

- **📋 Copy / 📥 Paste (this session)** — the per-row **📋** button copies an
  animation into an in-memory clipboard. Load a different rig, then click **📥 Paste
  animation** at the top of the Animations section to drop it in. The clipboard lives
  only in the open tab (nothing is saved), so this is the quick "rig A → rig B in one
  sitting" path.
- **📤 Save to library** — the per-row **📤** button saves the animation to a
  **shared, cross-project** library in R2. It's reusable from any client/project, on
  any rig. The library is shared by every project, so if the name is already taken the
  tool tells you which project saved it and when, and only replaces it if you confirm (if
  someone else saves it in the meantime, nothing is replaced and you are asked again).
- **🗂 Animation library** — opens a modal listing every saved clip (name, duration,
  source project, bone count) with a filter box. **Load** imports a clip onto the
  current rig; **🗑** deletes it from the library. Empty state tells you to use 📤.

**Compatibility report (important).** Rig animations reference bones, slots,
attachments and events **by name**. A pasted/loaded clip only fully drives a rig that
has matching bone/slot names; channels that reference names the target rig lacks are
imported harmlessly but **drive nothing** (silently). So before importing, if any
referenced bone/slot is missing on the current rig, a report shows **matched vs
missing** names and asks **Import anyway / Cancel**. A fully compatible clip imports
straight away. In this version the clip is always imported **as-is** — no channel
stripping and no name remapping (that's a later iteration); rename bones/slots to
match first if you need the missing channels to drive.

### Turn the view and pose in 3D (a 2.5D rig)

On a 3D rig (🧊 in the Animations tools) the stage itself works in 3D:

- **Turn the view** — the **🧊** slider in the bottom bar (Setup and Animate, only on a 3D rig; hover
  it) turns the camera about the vertical, −90° … 90°: the stage draws the pose at the playhead as
  that camera sees it, baked as a game plays it. **0°** goes back to the front, **◧** is the side view
  (depth runs across the stage). Only the view turns: nothing is keyed or changed.
- **The gizmo on a 3D clip** has three arrows (X, Y and depth) and three rings (rotate, tilt and
  twist). With **Local** in the bar they follow the bone: X along its length, the rotate ring turns
  it in its own plane, the tilt ring brings its tip toward you, the twist ring turns it about its
  length. With **View** they follow the stage: X across, Y up, and the depth arrow, which shows once
  the view is turned. Arrows and rings are drawn as the turned camera sees them — an arrow pointing
  at you is too short to grab and is hidden; a ring seen side-on is drawn as a thin ellipse you can
  still grab. Drag one: the stage shows the turn as you drag, and on release it is keyed at the
  playhead (a tilt or twist makes the bone a 3D bone) and the clip is baked again.
- **In Setup, with the view turned,** the arrows set the bone's setup x, y and **depth**.
- **Controls** can lock and limit **Tilt**, **Twist** and **Depth** too (the Control card's **keys**
  and **limit** rows, on a 3D rig): a locked one has no ring or arrow and its bone-panel field is
  greyed; a limit holds what a drag keys.
- **IK in 3D — an arm or a leg reaching a control in depth.** Select the forearm (or shin) and pick
  **＋ Add constraint → Two-bone IK in 3D** (offered on a 3D rig only), then click the control it
  reaches — the template's `hand_ik_l` — or **＋ New control** for one at the wrist, at the wrist's
  depth. It makes a **3D limb**: the bone and its parent reach the control, their end the child at
  the forearm's tip (the hand, on a template's arm). Its **Limb** card works as a 2D limb's: pick the
  **pole** (the template's `elbow_pole_l`, set behind the elbow) and the elbow bends toward it;
  **⇄ To IK** / **⇄ To FK** switch at the playhead with no jump (or matched up to **to (s)**), and
  **Spaces** let the control follow the chest, the world or a prop. Its **solve** row sets
  **softness** (near full reach the hand eases toward the control instead of locking straight) and
  **stretch** (past full reach the arm grows until the hand lands on it). With the view turned, drag
  the control's or the pole's arrows: the arm follows as you drag, and on release the control is
  keyed in 3D (or, while it follows a space, the space bone carrying it). A control another limb
  already reaches — a template's `hand_ik_l` — is not offered: switch that limb instead. The IK is off until a clip switches it on, so every clip plays as before; the bake
  solves it and keys the arm's bones, so the game plays ordinary keys. **🗑** on the card forgets the
  limb and its 3D IK (the clips that switched it on play their FK keys there).

### Drawings by angle (a 2.5D rig's slots)

A flat image turning in 3D narrows like paper. A **drawing by angle** is the image drawn for one way
the part faces — front, ¾, side, and on a full turnaround ¾-back and back — and in a 3D clip the
slot shows the one that faces you best, turned back to face you square.

- **🧊 Drawings by angle** — a card at the foot of a slot's panel in **Setup** on a 3D rig (hover its
  header for what it does). One row per angle of the rig's turnaround: pick the attachment drawn for
  it, and its turn in degrees if it was drawn at another (− faces the picture's right). Leave a row
  blank and the next drawing toward the front shows there (the row says which). **margin** is how
  much better another drawing must face you before it swaps in, **hold** the shortest time one stays.
  A back drawing on a side turnaround, or a full turnaround with no back drawing, is flagged: the
  rig's clips will not bake until it is fixed. Undo works on all of it.
- **See it** with the **🧊** view slider: turn the view and each slot shows its drawing for that
  angle.
- **An image bone of its own.** A drawing is turned to face you by turning its bone, so the slot
  must be the only thing on it. When its bone carries more (bones, or other slots), the card says so;
  pick where the image bone hangs and press **＋**: **under** the bone (it moves in every clip, 2D ones
  too) or **hung from** a steadier bone above, following the slot's bone in 3D (the bake needs far
  fewer keys when that bone turns edge-on, but the image then moves only in 3D clips — in a 2D clip it
  stays where the setup has it). Either way it is drawn exactly where it was.
- **Template rigs** name their angle drawings `<part>_3q_r`, `_side_r`, `_3q_l`, `_side_l`, and for
  a full turnaround `_3q_back_r`, `_3q_back_l`, `_back` — for the head, the torso (a bust's body) and
  the hands; art made to those names is picked up when the rig is made 3D. The Bust-with-face art
  blueprint asks for them (`rig_parts.py --prompts`, with `--turnaround full` for the back views).
- In a 3D clip a drawing slot's image keys are the bake's, so a hand's pose control (open / fist /
  point) works in 2D clips only on a hand with drawings by angle.

### Reuse a whole rig (rig library)

Where the animation library reuses a single clip, the **rig library** reuses an
**entire rig** — bones + slots + skins + constraints **and** all its animations. It's
the transfer medium for "copy a rig (with animation) from one object to another":
apply a saved rig to a new object, then attach that object's art, build a mesh, and
weight it to the imported bones with the existing mesh/weight tools. Like the animation
library it's **shared and cross-project** (stored under `_shared/rigs/` in R2).

- **📦 Save rig to library** (sidebar, enabled once a rig is loaded) — prompts for a
  name (defaulting to the current rig's stem) and saves the whole open skeleton to the
  library. The library is shared by every project, so if the name is already taken the
  tool tells you which project saved it and when, and only replaces it if you confirm.
  Like 💾 Save, it refuses a rig that would not open again and says why (before asking
  for a name): a broken library rig would break every rig it is imported into.
- **🗂 Rig library** (sidebar) — opens a modal listing every saved rig with its stats
  (e.g. "12 bones · 3 anims") and a filter box. Each row offers:
  - **Use in new rig** — closes the modal and opens the **＋ New rig** panel with this
    rig pre-selected in the **Apply saved rig** dropdown; you then pick the art source
    and **Create** (see below).
  - **Import into open rig** — merges this rig into the rig currently on stage
    (enabled only when a rig is loaded; see the namespaced merge below).
  - **🗑** — deletes the rig from the library.
  - A saved rig that would not load (the library save now refuses one, but an older
    entry can still be broken) is refused with the reason instead of breaking your work:
    creating a rig from it (**Use in new rig** / **Apply saved rig**) makes nothing, and
    **Import into open rig** leaves the open rig as it was.

**Apply at creation.** The **＋ New rig** panel has an **Apply saved rig (optional)**
dropdown (first option "— none (blank skeleton) —"). With a rig selected, the new rig
is created **carrying that rig's bones + animations + constraints** instead of a blank
skeleton — for **both** art sources (project atlas and uploaded images). This is the
"move the rig onto a new object" path: create against the new object's art, then attach

- mesh + weight to the imported bones.

**Import into the open rig (namespaced merge).** _Import into open rig_ merges a saved
rig into the live rig **without touching anything that's already there**. Every imported
name (bones, slots, skins, constraints, events — so its FX / flipbook bindings come along —
**and** animations) is given a unique prefix —
`<rigname>_…`, bumped with a counter if needed — so nothing can collide; the imported
root bone is dropped and its top-level children re-parent onto your selected bone (or
the current root); imported bones are appended and the bone list is re-topo-sorted so
every parent still precedes its children. The imported animations show up in the
**Animations** list (under their prefixed names) and play. The merge is lossless and
**reversible by ↻ Refresh from R2** (reload discards the in-tab merge); it deletes
nothing from the current rig.

**The by-name / re-skin caveat (important).** A saved rig's attachments reference atlas
**regions by name**. When you apply or import a rig onto a _different_ object, those
region names **won't resolve against the new object's atlas**. The rig still **opens** —
the Rigger loads any unresolved image as an invisible placeholder rather than failing —
and an amber **"N images not in this atlas"** banner lists what's missing. The bones and
animations come over intact; the imported art stays blank until you **re-attach the new
object's art** to the imported slots (each slot's **image** dropdown), build/convert a
mesh, and **weight it to the imported bones**. That's by design: the rig library moves the
_rig_ (skeleton + motion); you re-skin it to the new mesh with the normal Setup/weight
tools. Re-pointing a slot to an image that _is_ in the atlas clears it from the banner.

### Create a rig from scratch

1. Click **＋ New rig** in the sidebar, name it, optionally pick an **Apply saved
   rig** from the dropdown (see the rig library above — leave it on "— none —" for a
   blank skeleton), and either (the new rig opens in place of the open one, so unsaved
   changes to that one are asked about first):
   - pick an existing project **Atlas (images)** from the dropdown — the server
     assembles a self-contained rig bundle (a synthesised `.atlas` + the packed
     page image + the chosen `.irig` body, blank or the applied rig) from that
     atlas's manifest; **or**
   - choose **— no atlas (attach images later) —** — the rig is created with a 1×1
     placeholder page and **no images attached**. Use this to import a saved rig
     without binding it to any atlas yet (its bones + animations come over; the
     "images not in this atlas" banner reminds you to wire art). Attach an atlas
     afterwards with **source…** (it rewrites the bundle's atlas with that atlas's
     regions), then re-point each slot from its **image** dropdown; **or**
   - use **or upload images** to select PNG/WebP/JPEG files — the browser packs
     them onto one page and uploads it as a new bundle (region names come from the
     filenames); **or**
   - use **or import an exported rig** to bring in a rig made elsewhere: pick its
     skeleton (`.json` from 3.8 or later — or an `.irig` downloaded with ⤓ .irig), its
     `.atlas` (`.atlas.txt` works too) and every page image the atlas names, all in
     one go. The rig is named from the name box, or from the skeleton's file name
     when that is empty, and is saved as `.irig` with the atlas and pages beside it.
     A 3.8 export is upgraded to the 4.2 format on the way in; its animations play as
     they did in 3.8. It is checked before anything uploads: a binary `.skel`, an
     export older than 3.8, a missing page or a skeleton that would not load is
     refused with the reason. A status line says when the rig was upgraded from 3.8,
     when it was kept as 4.2 (converting it would have changed a value) and how many
     images the skeleton names that the atlas lacks.
2. The new rig opens in Setup mode. Add bones / slots / skins, **attach** images
   from the loaded atlas to slots (then place or convert them to meshes), paint
   weights, and animate. (If you applied a saved rig, the bones + animations are
   already present — re-attach this object's art and weight it to those bones.)

### Create a character from a template

A **template** is a fixed skeleton that expects its images by name. Pick it in **＋ New rig →
Apply saved rig or template** (the **Templates** group), then choose the art: a project atlas or
**upload images**. Every image whose name matches a part attaches itself to its slot at its real
size; hover the template in the list to see every part name (`*` = needed). Uploaded files are
named from their file names, so `mouth_A.png` becomes the part `mouth_A`. Three templates come
built in (below); any rig can become one more with **📐 Save as template** (see **Make your own
template** below), listed as `<name> (template v<n>)`.

- **Bust with face** (`bust-face`): `body`*, `head`*, `neck`, `hair_back`, `hair_front`,
  `ear_l` / `ear_r`, `cheek_l` / `_r`, `eye_white_l` / `_r`, `pupil_l` / `_r`, `lid_upper_l` /
  `lid_lower_l` (and `_r`: an upper lid that comes down over the eye and a lower lid that pushes up),
  `eyelid_l_half` / `_closed`* (and `_r`), `brow_l_neutral`* / `_up` / `_angry` (and `_r`),
  `nose`, `mouth_rest`*, `mouth_A`*, `mouth_O`*, `mouth_E`, `mouth_U`, `mouth_MBP`, `mouth_FV`,
  `mouth_smile`, `mouth_wide`. The eyelids start empty (eyes open); swap them in with an image key.
  The brows and every mouth image are made as **bending meshes**: a brow bends between its inner and
  outer end, a mouth on its two corners and both lips, whichever mouth image is showing. Only the
  latest version of each built-in template is kept: a rig made from an earlier one opens without
  the Controls section (its animations still play, they are ordinary keys); make a ＋ New rig for
  the controls.
- **Full body** (`full-body`), drawn facing you or facing right: `torso`*, `head`*, `pelvis`,
  `neck`, per side `upper_arm_l`* / `lower_arm_l`* / `hand_l_open`* / `hand_l_fist` /
  `hand_l_point` and `thigh_l`* / `shin_l`* / `foot_l`* (and `_r`). The face is part of `head`.
- **Half body** (`half-body`), drawn facing you, cut at the waist: `torso`*, `head`*, `pelvis`,
  `neck`, per side `shoulder_l`, `upper_arm_l`* / `lower_arm_l`* / `hand_l`*, one image per finger
  segment (`thumb_1_l` … `thumb_3_l`, `index_1_l` … `index_3_l`, then `middle`, `ring` and
  `pinky` the same way, `_1` at the knuckle) and the drawn poses `hand_l_open`, `hand_l_fist`,
  `hand_l_point`, `hand_l_thumbs_up` (and `_r`). Draw the hands hanging, back of the hand toward
  you; `hand_l` is the palm the finger images sit on. Art with no finger images works too: then
  `hand_l` is the whole hand and the poses swap it. The head takes `hair_back`, `hair_front`,
  `ear_l` / `ear_r` and the **same face as Bust with face** (every face part above, with the same
  names, sizes and needs), so face art made for one fits the other. The face draws under both arms:
  a hand raised in front of it covers it.
- **A missing part is left out, never named.** The game cannot load a rig naming an image its
  atlas lacks, so after **Create** a popup lists the needed and optional parts the art did not
  have. Add them to the art, **⟳ Re-sync atlas**, then pick each in its slot's **image** list.
- A template can't be combined with a saved rig: both are a whole skeleton.
- The rig remembers its template in a `template.json` beside it in the bundle.

#### Make a rig from a Flipbook frame (🎞 From a Flipbook frame)

A character that already exists as a Flipbook clip can be split into the template's parts and made
into a rig, instead of drawn part by part. Pick **Half body** (or a template saved from it) in
**＋ New rig → Apply saved rig or template**, then click **🎞 From a Flipbook frame…** at the bottom
of the panel. What each step does is the tooltip on the dialog's title.

1. **Pick the clip.** Its frames are tracked in this browser (face, body and hands, as 🎥 Motion
   does), and the strip shows every frame with a score: 1 means every arm segment lies flat in the
   picture, nothing covers the body and everything was found. The best frame (★) is picked; hover a
   frame for why it scores lower — `right forearm at 0.27 of its length` (pointing at the camera, so
   the part would be cut short), `right upper arm, right forearm out of the picture` (a joint past
   the frame's edge: that part is not in the frame to cut), `a hand over the body (8%)`, `a hand over
   the face`, `an arm joint hard to see`, `no face found`, `one hand not found`. Click another frame
   to use it instead. If the clip has **a kept cut** (✂ on its frame in the strip), the newest opens at
   once, before the tracking ends, and goes straight to **🦴 Create rig**; picking a frame with a kept
   cut opens it.
2. **Check the joints.** The frame shows what the tracker found: yellow dots on the shoulders,
   elbows, wrists and hips, a cyan dot per hand (drags the whole hand) and a red dot on the face
   (drags the whole face). Drag any it got wrong before cutting.
3. **✂ Cut.** The frame is split into the template's parts, each in its own colour with a white
   edge, listed with its size. The **neck** is its own part (the skin below the jaw and above the
   shoulders), so the head turns on the head bone and the neck on the neck bone; a cut kept from
   before has none and says so under the lists — **✂ Re-cut** gives it one. The first cut after the
   service has been idle loads its models (up to a minute); after dragging a joint, **✂ Re-cut** takes
   seconds.
4. **Props.** Worn things the cut found — glasses, a chain, a watch, a bracelet, a ring, an earring —
   are cut out of the part under them, each named for where it sits (`prop_glasses` on the head,
   `prop_chain` on the chest, drawn over the neck, `prop_wrist_l` on that forearm, `prop_ring_l`
   on that hand, `prop_earring_l` on the head). Per prop: ✓ keeps it on a bone and a slot of its own
   (the bone hangs from the bone its part is drawn on, at the prop's middle — or its top, for one that
   swings — and a ring hangs from the finger it sits on), ✗ draws it into the part
   under it; and whether it **rides its bone**, **swings** or **comes off** (for the last two, what it
   covers is made in the next step). A piece on top of the head is never taken (hair or a hat?); the
   pieces not taken are counted under the lists. The props are yours to edit, apart from the cut
   (nothing is cut again):
   - **＋** (on the Props header) adds one: type its name (`watch` becomes `prop_watch`), then paint
     it with the brush or draw round it with the lasso. It is drawn just over the part you painted it
     on (after the arm's last finger on an arm) and hangs from that part's bone.
   - The **bone** list on a prop's row picks the bone it hangs from (any bone of the template but the
     controls); left at "on …", it hangs from the bone its part is drawn on.
   - **🗑** removes one: each of its pixels goes back to the part it lies nearest.
5. **Touch up with the brush or the lasso.** Tick **🖌 Brush**, pick the part (or prop) to paint as
   and the radius, and paint on the frame: the pixels under the brush move to that part. Or tick
   **◌ Lasso** and draw a loop: every pixel inside it moves. Both only move pixels between parts,
   never past the character's outline, and work on **▣ This frame** (step 6). With both off, the
   joints drag again.
6. **Each part from its best frame.** Every part is scored on every frame of the clip too: whole
   (not pointing at the camera), not covered by a hand or the other arm, facing the camera, its
   joints sure. The **Parts** list is that table: each part, the frame it is cut from, its score
   there and why it scores lower (hover a row for every reason), and at the row's end a **chip** with
   that frame's picture and number. A part this frame shows under 0.97 is planned from another frame
   that shows it clearly better — 0.15 more, or three quarters of what this frame lacks (a head turned
   23°, 0.92, moves for a face to the camera) — the nearest frame of those within 0.01 of its best.
   **✂ Cut** cuts this frame, then takes each such part from its frame (its kept cut, or a cut made
   for it now), so the quick way is: pick the clip, ✂ Cut, 🦴 Create rig. The neck goes with the
   head; a hand stays on this frame unless you pick otherwise (its finger bones are this frame's).
   - **Where each part comes from shows everywhere.** Each frame a part is cut from gets a colour:
     the chip on that part's row is outlined in it, the frame in the strip is framed in it with the
     parts' own colours in its corner, and the stage shows the cut **◧ Assembled** — every part
     drawn from its own frame, at its own length, turned as this frame draws it, outlined in its
     frame's colour and tagged with its number; hatched where this frame drew a part another frame
     now gives (the fill makes what is behind it). **▣ This frame** shows the picked frame alone
     with the cut's colours over it; the joints, the brush and the lasso work there (ticking either
     switches to it). Before the cut the stage tags each planned part with its frame.
   - **Pick a part's frame yourself** (before or after the cut): click its chip (or its row). The
     row lights, a status line above the strip names the part, and each frame in the strip shows
     **that part's** score, the ones near its best lit, the rest dimmed; click one to cut the part
     from it, this frame to take it back, or Esc (✕ on the status line) to stop. ✕ on a row takes it
     back too.
   - **A kept cut** made before the plan opens with every part on its own frame: once the clip is
     tracked, **★ N** on a row takes that part from frame N, the plan's, and ★ on the Parts header
     takes every such part.
   - 🦴 Create rig makes that part from its frame and takes an arm segment's length from it; the rig
     still poses as this frame.
7. **💾 Keep touch-ups** saves the brush and lasso strokes, the props (added, removed, ✓ / ✗,
   motion, bone) and each part's frame with the cut. Re-cutting replaces the brush strokes, and
   picking another frame drops them; both ask first.
8. **🦴 Create rig.** Name the rig (the New-rig name, or the clip's name with `_rig`) and click
   **🦴 Create rig**; unsaved touch-ups are kept first. Each part is made whole inside its own
   outline — a limb or the neck goes on behind what covers it as its drawn edges do (carried on from
   where they show, mirrored, or as wide as its other arm), with a round end at each joint; the torso
   behind the arms, held to the mirror of the side that shows; the head behind the glasses — and
   what it hides is **filled on the CPU**: the drawn edge carried along the made outline, inside it a
   smear (right for a seam's few pixels, a smear across a big hole behind a hand over the chest).
   Nothing is filled outside the outline and the part's own pixels are never touched. The GPU fill
   that redraws those is not built yet. Each part is turned to its bone's rest (arms hanging down)
   on the project sheet `<name>_parts`, named as the template names it, the props among them, and
   never stretched to the template's length. Each **hand** is one mesh over its finger bones, which
   sit on the frame's fingers, so the hand's curl, spread and thumb controls bend the drawn fingers.
   The **head** turns on the top of the drawn neck (the jaw's middle, under the face), and the neck
   runs up the drawn neck to it, so the head turns and nods where a real one does and stays on its
   neck in every clip. **Every part is a skinned mesh**, weighted across each joint to the bone
   beside it: the torso to the spine (its waist), the neck, each clavicle (its shoulder line) and
   each upper arm (its armpit); the neck to the torso and the head; the head to the neck; each upper
   arm to its shoulder and elbow; each forearm to its elbow and wrist; each hand to its wrist. So a
   shrug lifts the torso's shoulder line, a raised arm pulls its armpit, an elbow or a head turn
   bends the skin across the joint, and two parts meeting at a joint move their shared pixels
   together (no crack). The meshes are bound in the frame's pose, so the `frame` clip draws the
   frame exactly as cut. The rig is the template with the character's own limb lengths and the frame's pose as its clip
   **frame**, so every control and starter clip plays from the template's rest; it opens when made.
   The report lists what was filled on the CPU, any part the frame's edge cut off, any arm segment the
   frame draws short (pointing at the camera: it stays short; take it from a frame showing it
   side-on), the parts taken from other frames, and the template parts no frame makes (the face block's shapes, hand poses, angles), as a
   template create does. **⤢ Fit rig to the capture** later stretches a limb's art at most ×1.5 and
   says which limb it held.

The line under the lists counts the template parts a frame cannot make (hover it for the list): the
face shapes, the fingers and the angle drawings, which other tools make. Each cut is kept in the
project as authoring scratch (`rig-from-frame/<job>/`: the frame, its joints, the parts map,
`cut.json` and, once a rig is made, `parts.json`); it is never shipped. The sheet and the rig are
ordinary ones and ship as any rig does. A sheet named like another of the project's is never
overwritten: pick another rig name. Only templates with the Half body parts can be cut for, and the
clip's frames must be drawn on transparency.

#### Animate with the Controls section

A rig made from a template gets a **Controls** section in the outline (the face of **Bust with
face**, the body of **Full body**, the face, body, arms, hands and fingers of **Half body**, the
controls its author gave a template saved in the Rigger).
In **Animate** mode each
control keys the current animation at the playhead (it starts one if there is none); outside
Animate it only says to switch. Everything it writes is ordinary keys — bone moves and image swaps —
so you can edit, move or delete them in the dopesheet afterwards, and ↶ undoes them.

- **Mouth** — one button per mouth image the rig has; it keys that shape and opens the jaw to
  match (A wide, MBP shut…). The lit button is the shape at the playhead.
- **Sliders** — jaw open and sideways, mouth corners per side (**Smile** up / frown down,
  **Stretch** out / pucker in), upper and lower lip, nose sneer, cheeks per side and cheeks puff,
  blink left / right (the upper lid comes down: half, then closed; below 0 opens the eye wide),
  squint per side (the lower lid up), brows (angry ↔ raised, with the brow image swapped at the
  ends) and each brow's inner and outer end, look left/right and up/down (both pupils; the upper
  lids follow a little), head tilt, nod and turn, breath. Hover a name for what it moves. A slider shows the value at the
  playhead.
- **A mouth button also sets the corners and lips** its shape needs (smile lifts the corners, O and
  U pucker them, MBP presses the lips), and puts them back to rest on a shape that does not use them;
  talk, lip-sync and the starter clips do the same.
- **👁 Blink** — one blink (both eyes, 0.2 s) from the playhead.
- **👁 Idle blinks** — a natural blink rhythm across the whole clip (6 s when it is empty), ending
  open at the clip's end so it loops.
- **💬 Talk 2 s** — 2 s of mouth shapes from the playhead, jaw following, ending on the rest shape.
- **🎤 Lip-sync** — opens a row to key the mouth from a voice line. Pick a line already in the
  project, or **＋ Upload audio…** (mp3, ogg, m4a, wav or webm, up to 60 s). Optionally type the
  words (English gets more accurate) and pick **English** or **Other language**, then
  **🎤 Key at playhead**: after a few seconds the mouth shapes and jaw are keyed from the playhead to
  the end of the line, replacing the mouth and jaw keys already under it, as one undo step.
  **🔊 Play with voice** plays the clip from there with the audio, to check the sync. The audio
  stays in the Rigger: to hear it in the game, add the same file in Invisible Sound and play it with
  the clip.
- **🎬 Starter animations** — adds the template's ready-made clips: `idle` (4 s: breathing, a
  small sway, a glance, two blinks), `blink`, `talk` (2 s loop), `happy`, `surprised`, `sad`,
  `angry`, `win_small` and `win_big`. Every clip starts and ends with the face at rest, so it loops or hands
  over cleanly, and the same clip plays on every Bust-with-face character. A clip name the rig
  already uses is kept as it is, never overwritten; works in any mode. A mouth shape the art lacks
  becomes the nearest one it has (by how far it opens the jaw).
- **🎥 Motion** — opens a row to key the face (Bust with face), the body (Full body) or the face,
  body and hands together (Half body) from a performance. Pick a **Flipbook clip** of the project
  (read at its own frame rate) or **＋ Video file…** from your computer (read at 12, 24 or 30 fps,
  up to 30 s from **From**, the seconds into the video the performance starts; empty = its start).
  The video is read in this browser and never uploaded.
  - **🧊 3D / 2D** (Bust with face, Full body and Half body; hover it) — **3D**, the default: each
    bone turns in 3D as the performer's does (toward and away from the camera, the body's turn, the
    head's turn with its face at depth), and the clip is **baked** from that into ordinary keys the
    game plays. Limbs shorten, hands pass in front of or behind the body and the head, the head turns
    round, the torso shows its ¾ and side drawings — all from one projection, so the depth
    choices below are not offered. The clip becomes a **3D clip** (see **3D clips** above): its
    arms, body and head are the bake's, edited as 3D keys (the face's controls still key as before).
    The fingers follow the hand's own shape: each segment is keyed as a turn and a stretch on the
    hand, so a hand seen side-on bends its fingers across the picture and one facing the camera folds
    them toward it (the curl controls aren't keyed by a 3D import; the keys edit as any bone's). The
    head's 3D turn is the whole head's, so on Half body the import clears the neck's own turn (**Head
    nod**) under it: imported onto a clip that turns the neck (a frame rig's `frame` clip), the head
    stays on the neck. A 30 s import takes a few seconds to bake.
    **2D**: the controls, with the depth tricks below — a clip every control can edit.
  - **📍 Follow positions / Angles only** (3D only; hover it) — **Follow positions**, the default,
    puts the rig **on** the performer in the reference: the whole character moves with them (across,
    up and down), each arm reaches the wrist the tracker found (Full body: each leg the ankle too),
    and the head goes onto their face (its eyes and mouth), on top of every bone turning as theirs
    does. It is keyed as plain translate keys on the root and the neck and the arms' turns, so the
    keys edit as any others. A rig built unlike the performer bends to get there: a shorter arm
    reaching the same wrist bends less than theirs, so its forearm points elsewhere than theirs; a wrist
    further than the arm reaches turns the arm as tracked there, and the head moves at most a third of
    the shoulders' width (both said under the import). **Angles only** turns each bone as the
    performer's from where the rig stands: the bends are theirs, but the body, head and hands drift off
    the reference as the performer moves. The import places the picture where the **Reference** is lined
    up (or lines it up first), so line it up or nudge it before importing if you want it elsewhere.
  - **👣 Plant feet / Feet as tracked** (3D, on a rig whose legs are 3D limbs — Full body; hover it) —
    **Plant feet**, the default, finds where each ankle is still and lowest (a **contact**: the foot
    on the ground) and holds that foot's control where it landed for the contact, with the leg's IK
    on, so a stance foot no longer slides while the leg bends to keep it there. Where the foot lands
    the switch to IK is matched (no jump); as it lifts the IK lets go over 0.15 s while the control
    moves back onto the tracked ankle. Outside the contacts the legs play as tracked. The output is
    the foot controls', knee poles' and IK mix keys (in the dopesheet **↳ under each foot control**),
    so ⇄ To FK on the leg's **Limb** card takes any part of it back; the report under the import says
    how many contacts each foot got and how far the tracked feet slid in them. **Feet as tracked**
    keeps the legs' FK turns only. Importing again over a planted range plants it afresh.
  - **⤢ Fit rig to the capture** (3D templates; hover it) — when the rig's arms (or legs) are shorter
    or longer than the performer's, so Follow positions bends the elbows to the wrong places: each
    upper arm and forearm (Full body: thigh and shin too) takes the performer's length, measured
    across the whole clip as Follow positions reaches it (the picture where the Reference is lined up,
    with the tracker's depth). Both sides take one length. Each limb keeps its direction, so every
    clip and control keeps working; **the art stretches with the limb**, so nothing opens at a joint —
    by at most ×1.5 either way: a part drawn that short (a frame made rig's limb cut pointing at the
    camera) would smear, so it is held there and the report says a gap may show at its joint;
    the hand controls and elbow poles stay on their joints. One undo step. Underneath, each length
    old → new, how many frames and how much it varied (a wide spread, or one side read far off the
    other, is said). It uses the clip picked in the row (after an import, without tracking it again).
    Then **🎥 Key at playhead** again: clips imported before keep their keys. Once you **💾 Save**, the
    Controls drive the new lengths in every tab (they are read from the saved rig).
  For a face, two things set how it reads:
  - **Neutral at** (seconds into the performance) — a moment the performer's face is at rest.
    Every expression is read against it, so heavy lids or raised brows at rest still read as rest.
    Empty = the first second, so start a take with a resting face, or type the moment it has one.
  - **Mouth / Eyes / Brows / Gaze / Head ×** — how strongly each part reads, ½× to 3×. A drawn
    face scores its blinks and mouths weaker than a filmed one: try **Eyes 2×** and **Mouth 2×**.
    **Head** also sets the head's turn and nod.
  - **Shorten / Behind / Turn / Nearer** (2D only) — the depth the performance has, each shown when the
    template takes it (hover one for what it does): **Shorten** a limb pointing toward or away from
    the camera (off, ½×, 1×, 1½×), **Behind** a hand passing behind the body or the head (on or
    off), **Turn** the body turning toward or away from the camera, **Nearer** the performer coming
    nearer or going back. Off leaves those controls' keys as they are.
  - **Auto-range** (folded; hover its header) — when a performer moves further than a control
    reaches, their spread is scaled into the control's range instead of flattening at the edge, so
    the motion keeps its shape (off, ½, full per group). Mouth, eyes, brows, gaze, head and hands
    are full by default; **Body** is off, because its readings are directions in the picture and
    scaling them would turn every frame. A blink still shuts and a fist still closes all the way.
  Then **🎥 Key at playhead**: the frames are tracked (a few seconds for a short clip), and the
  controls the template maps are keyed from the playhead, replacing their keys under the
  performance, as one undo step. Keys are thinned so the dopesheet stays editable. Underneath, a
  list says which moment the face was read against, what did not carry over: frames with no face
  or body in them (the controls hold through them), controls that went past their range (held at
  the edge), the controls auto-range scaled (how far they reached, and by how much), frames where
  the tracker named the arms the other way round (a mirrored video or a turned back: they are read
  by where they are in the picture), and what the template can't take at all. The face drives every control above but the
  nod and breath: mouth shape, jaw, corners, lips, cheeks, lids, blinks, squints, brows and their
  ends, gaze, head tilt, and the head's turn and nod (read from the face's 3D pose:
  the nose slides further than the face and the back hair the other way, so the head reads round)
  and, on the bust, how near the face is. The tracker barely scores a cheek puff or a nose sneer,
  so those read from the squint, the smile and the upper lip. The body drives lean, head tilt,
  arms, elbows, legs, knees, and the whole character's hop and sideways move (**Move sideways**
  control); not hand poses or breathing. **Depth**:
  a limb pointing at the camera **shortens** toward its joint (down to 0.3 of its length; the
  rotation still follows the picture); a hand behind the back draws its arm **behind the body**,
  one behind the head behind the head (keyed as the animation's draw order); the body **turns** —
  the shoulders and hips come in and the torso swaps to `torso_3q_l/r` and `torso_side_l/r` when
  the art has them — and comes **nearer or goes back** (the whole character scales, up to 15%). A
  limb, a turn or a distance past what the template can show is held at its edge and said under
  the import. An elbow bends either way in the picture (to 168°): a hanging arm bringing the hand in
  front of the body bends it inward, a raised arm waving bends it outward. What 2D still can't show:
  a full turnaround (the back needs its own drawing), a hand crossing the other arm, the near hand
  drawn larger, the upper arm's roll and the forearm's twist (rig templates §5.6). A knee bending
  forward is held straight. A face side-on (in profile) is not found. On Half body
  the hands are tracked in the same pass: each finger's curl, the thumb and the spread, read in the
  hand's own 3D shape, so a finger curling toward the camera counts in full. Each hand goes to the
  side of the body's nearer wrist; a hand far from both of the performer's wrists is someone
  else's and is left out. A hand out of sight, behind the other or holding something keeps its last
  pose; the drawn hand poses are not picked from video (the fingers are keyed instead).
  - **Reference** (under the report, for an animation with an import; hover its header) — the video
    or Flipbook clip the import came from, drawn **behind the rig** in Animate mode at the frame under
    the playhead, so you can see which movements carried over and where they got lost. **👁** shows
    it, the slider sets its opacity, **⦿** draws the tracked points over it (the body's lines, the
    hands, the face and its eye line), **✥** shows handles to move it (the middle) and scale it (the
    corner), and **⤢** lines it up with the rig again (by the shoulders, or the eyes). It is
    remembered per animation for the session; after a reload a video is picked again
    (**🎞 Pick … again**: it was never uploaded). An import that followed positions placed the rig
    where the reference sat then: moving the reference after it leaves the rig where it was.
- **Full body** controls: lean, hop, move sideways, per side raise arm (below 0 swings it back),
  bend elbow, hand (open → fist → point), step leg (forward + / back −, facing right) and bend knee,
  then head tilt, nod and breath. For depth: per side **Shorten** upper arm, forearm,
  hand, thigh and shin (pointing at the camera), **Arm depth** (0 in front, 1 behind the head, 2
  behind the body), and **Body turn** (¾ and side torso images), **Body side-on** (shoulders and
  hips in, the torso narrower) and **Nearer / further**. Each limb's image sits on a bone of its own
  at its joint (`upper_arm_l_image`…), so shortening it leaves the limbs below their shape. Its **🎬 Starter animations** are `idle` (4 s), `celebrate` (arms
  up, fists, two hops), `win_small` (a fist pump), `win_big` (3 s: arms up, hops, a point) and
  `walk` (a 1 s loop). There are no blink, talk or lip-sync buttons, and no IK: a constraint you
  add over the legs overrides the leg keys.
- **Half body** controls: every face control of Bust with face (the mouth buttons, 👁 Blink, 💬 Talk
  and 🎤 Lip-sync included, head tilt and turn among them), lean, twist (the chest against the
  waist), breath and head nod, then per side shrug, raise arm (below 0 swings it in across the
  body), reach (the arm toward the camera: it sets the upper arm, forearm and hand **Shorten**
  controls, each its own control too), bend elbow, wrist, **hand pose** (0 the
  finger rig, then open, fist, point, thumbs up; a drawn pose hides that hand's finger images, and
  one the art lacks keeps the finger rig), **curl hand** (every finger and the thumb at once), thumb
  (1 folds it across the palm, below 0 sticks it out), curl index / middle / ring / pinky, and
  spread. A curl folds each finger segment toward the palm, which reads as the hand closing whether
  it faces you or away. It also has **Head up / down**, **Arm depth** per side, **Body turn**,
  **Body side-on** and **Nearer / further**, as Full body's. Its **🎬 Starter animations** are `idle` (4 s), `wave`, `point`, `thumbs_up`, `fist_pump`,
  `celebrate` (both arms up, fingers spread, a shake), `win_small` and `win_big` (3 s: fists up,
  then jazz hands), each with the face to match (a smile, raised brows, a shout, a wink, blinks).
  Each clip keys the drawn pose and the fingers together, so it reads on art with either. No IK.
- A step whose image the rig lacks is skipped (no half-closed eyelid → the eye stays open until
  it closes; no `mouth_U` → talk leaves it out), never keyed, so the game can always load the rig.

### Make your own template — 📐 Save as template

Use it when one rig (a creature, a prop, a character style) should be the starting skeleton for
more art: save it once, and **＋ New rig** offers it to every project like **Bust with face**, with
its own Controls and starter animations. Anyone who can open the Rigger can save and delete templates. The plan is in
[rig-templates.md](../design/rig-templates.md) §7.

1. Open the rig and click **📐 Save as template** (left rail, under the rig-library buttons).
2. **Name** it. If the open rig was made from a template, the window starts from that template's
   name, needed parts, controls and starter clips.
3. **Parts** — every image of the rig's default skin, by slot. Tick the ones new art **needs**
   (at least one); the rest are optional and simply left out when the art lacks them.
4. **Controls** — the sliders the Controls section will show. A rig with no template gets a
   suggested image-swap control for every slot with several images. **＋ Control** adds one that
   moves bones (x, y, rotate or scale Y, by value × per unit) and can swap a slot's image at value
   steps; **＋ Mouth shapes** adds a mouth picker that opens a jaw control. Fold a control open
   (▸) to edit it, 🗑 to remove it. Drag a control's slider to see it on the stage — nothing is
   keyed, and closing the window puts the pose back.
5. **Starter animations** — tick the rig's animations that **🎬 Starter animations** should add.
6. **📐 Save**.

- **A taken name** asks whether to save this rig as its next version. Rigs made from an earlier
  version keep theirs; **＋ New rig** uses the newest.
- **What is carried:** bones, slots and the default skin's images, at their size and place. A mesh
  becomes a plain image part (convert it to a mesh again on the new art); clipping, path, point and
  bounding-box attachments are left out. The rig's **constraints** (IK, transform, path, physics)
  and its **control layer** (`controls.json`: shapes, layers, sets, limbs, mirror pairs, the Picker
  layout) are carried, so a ＋ New rig from the template starts with them; a control naming a bone
  the rig no longer has is left out. Other skins and events are not carried. After a save, a popup
  lists everything this rig had that the template does not.
- **A limb with a live IK becomes an FK / IK control.** The window suggests a control `ik_<limb>`
  (0 FK … 1 IK) for each limb of the rig whose IK is a constraint (not one solved in 3D), and
  **＋ IK mix** under any control's bone moves blends an IK of the rig by value × per unit; on a rig
  made from the template the slider blends the arm between FK and IK. A limb solved in 3D is not
  carried (a saved template has no 3D data), and the popup says so.
- **Starter clips are the rig's own animations, kept as they are** (not turned into control keys),
  so eases and bones no control moves still play, and so do the keys of the rig's own constraints.
  A clip with mesh deforms or events is refused. On a new rig, an image key for a part its art lacks shows nothing.
- **🎤 Lip-sync** works on rigs from your template only when it has a mouth-shapes control with
  **🎤 lip-sync** ticked and each of the nine letters mapped to an image.
- **🎥 Motion** works only when the rig you save was made from a template with motion tracking:
  leave **keep 🎥 motion tracking** ticked and it keeps working for every control you kept under
  the same id. A new tracking map can't be made here.
- **Every save is checked on the server first** — a rig made from the template must load and pose
  at every control's ends and through every starter clip, and no control shape may fight a slider:
  a shape keys the bone properties of one template control or of none (a square moving an arm whose
  Raise control turns it and whose width control moves it is refused, naming both). A refusal shows its reason above the
  sections and nothing is saved.
- **Shared templates** lists the templates made in the Rigger. **🗑** deletes one for every
  project, after asking; rigs made from it keep their bones, images and animations and only lose
  their Controls section.

### Save / export

- **💾 Save** writes the current rig to the project in R2 as a re-openable
  `.irig` (non-destructive — an artist's source `.json` is left untouched; the
  edit is a sibling `.irig` listed in the rig list). Per-row **🗑** in the rig
  list deletes a rig.
  - If someone else saved the same rig since you opened it, Save asks whether to
    **overwrite with your version** instead of silently replacing theirs (theirs is
    kept in History). If your active project changed in another tab, Save refuses —
    reload first.
  - If you opened the artist's source `.json` and a saved `.irig` of it already
    exists, the first Save asks before replacing that `.irig`.
  - Save refuses a rig that would not open again (e.g. a slot on a deleted bone) and
    says why; the stored rig is left as it was.
- **🕘** (next to 💾 Save) lists the last 20 saved-over versions of the open rig — or
  of a rig that failed to load. **Restore** puts one back and reopens the rig (your
  unsaved edits in the tab are discarded; the version it replaces is kept in History
  too, so a restore can be undone).
- Closing or reloading the tab with unsaved rig or cinematic changes asks first —
  an undo counts as a change.
- **⤓ .irig** downloads the skeleton locally as 4.2-format JSON under the `.irig`
  extension.

### Re-sync a rig's atlas (after editing the source atlas)

Each rig is a self-contained rig bundle (`spines/<rig>/`) that holds its OWN
**copy** of the atlas page image, snapshotted when the rig was created. If that atlas
is recoloured or re-packed afterwards, the copy is refreshed automatically the next
time the Symbols State Machine, the Scene Editor or a game export reads the rig — as
long as the rig remembers its source atlas (below). The Rigger itself opens the copy
as it stands, so here a rig can keep showing the OLD image until you re-sync it.

- **⟳ Re-sync atlas** (sidebar, enabled once a rig is loaded) re-pulls the latest
  page image from the SOURCE atlas and re-synthesises the rig's `.atlas`, then
  reloads the rig so the new look shows. It does **not** touch your `.irig` (bones,
  animations, attachments) — only the picture and the atlas geometry.
- It's **one click** because the rig remembers which atlas it was created from (a
  `source.json` sidecar written at New-rig time). For **older rigs** created before
  that — or rigs made from uploaded images — it asks you to **pick the atlas once**;
  after that the choice is remembered and it's one click thereafter.
- **source…** (the button next to ⟳ Re-sync atlas) re-syncs from a **different**
  atlas — it always opens the atlas picker, even when a source is already remembered,
  and the atlas you choose is written back as the new remembered source. Use it when
  the rig is **pinned to the wrong / an older atlas** so a plain re-sync keeps missing
  a new image — e.g. you created the rig, then later added a sprite to the sheet: the
  rig still points at the pre-sprite snapshot, so pick the current atlas here once and
  the new sprite becomes attachable.
- **Region names must still match.** A colour change keeps them, so re-sync just
  works. If the atlas was re-packed with renamed/removed regions, a re-synced rig's
  attachments may no longer resolve and you'd re-attach by hand.
- If you have unsaved skeleton edits, re-sync asks to confirm first (it reloads the
  rig from R2, discarding those edits).

## Cinematic mode

A rig animation is one character. A **cinematic** is a *scene*: several rigs on a
stage, each running its own clips, moving and fading and appearing on a shared
timeline, with a camera over the top and named cues the game reacts to. It is a
fourth mode of this tool rather than a separate tool because it is the same
renderer, the same rigs and the same timeline you already know.

Open it with **🎬 Cinematic** in the mode toggle — with or without a rig loaded.

### Cast and place your actors

Add a rig from the project as an **actor**. The same rig can be cast twice and the
two instances are independent. Per actor you set **x / y / scale / rotation /
flip**, its **draw order**, whether it's visible, and which **clip** it plays.
Scrub or play the whole stage to see them together.

> Actors are identified by the rig's **folder**, not by its position in the rig
> list — so adding or deleting rigs later never silently re-points a saved
> cinematic at a different character.

### Sequence it

The timeline is an NLE-style sequencer sharing the panel the dopesheet uses:

- One row per **track**, with **layers** per actor (**⧉** adds one; layers blend
  bottom-up).
- **Strips** are clips placed in time — drag to move, drag either edge to trim,
  **Alt** to ignore the fps grid, **Ctrl+wheel** to zoom, **Del** to delete,
  **Ctrl+D** to duplicate. Trimming the *left* edge moves the clip's start and its
  in-point together, so the art under your cursor stays put instead of sliding.
- The **strip inspector** exposes everything the player reads: clip, start,
  length, clip-in, speed, loop mode (once / fill / count N / ping-pong), blend
  in/out, alpha, and replace-vs-additive. Blend ramps are drawn inside the strip
  and additive strips are tinted, so the stack reads at a glance.

### Animate an override — pose it straight on the stage

The short version: **press ✎ on the actor, scrub to the moment, drag a bone.** That is
the whole thing. Worked example — a **walk looping for 15s**, and at **8s** the
character **missteps for two seconds** as if it clipped a rock:

1. **✎** on the actor's row in the cast panel. Its bones appear on the stage and the
   animate toolbar (◆ Key) turns on. You have not left the cinematic: the timeline,
   the cast panel and the playhead are all still there.
2. Scrub to **8s**. The actor is posed by its walk, and keeps walking as you scrub.
3. **Drag a bone.** That first key builds the whole override for you — a layer above
   the walk, a 2-second strip starting at the playhead, and a clip on the rig to hold
   it. The strip appears on the timeline, selected, ready to trim.
4. Keep posing and keying. Everything you don't touch keeps walking.
5. **💾 Save rig**, then **✎** again to stop.

> **The override eases in and out by default**, and that is not decoration: a strip
> holds its last frame forever, so an override with no blend-out would leave your
> character limping for the rest of the shot. The auto-created strip gets short ramps
> at both ends. Set them to 0 in the strip inspector for a hard cut.

**The clip lives on the RIG.** ✎ opens that actor's rig in the editor (asking first if
another rig had unsaved changes), so the override is a rig animation like any other —
save it with **💾 Save**, and it is reusable anywhere.

**replace or additive?** The strip inspector's **mode** decides how your keys meet the
walk. **replace** (the default) means your keys *are* the pose for the bones you keyed.
**additive** means they are an *offset added to the walk*, so the legs keep striding
and get displaced — usually what you want for a stumble or a recoil.

### The longer route: author a clip in the animator

The same override can be built strip-first, which is worth knowing when you want the
dopesheet, curves or the graph editor rather than posing on the stage:

1. **⧉** on the actor's track row adds a **layer** above it. Layers blend bottom-up.
2. **＋** on the new layer's row adds a **strip** at the playhead.
3. Select the strip → **＋ New clip**. That creates an empty animation *on the actor's
   rig*, points the strip at it, and drops you straight into the animator with the
   rest of the stage posed around you.
4. Pose bones and **◆ Key** them, exactly as in ◆ Animate. Scrub with the transport —
   the playhead is cinematic time, mapped through the strip.
5. **💾 Save rig** in the tweak bar, then **✔ Done**.

For the misstep that means: the walk strip on layer 0 with **loop to fill** across the
whole 15s; a 2-second strip on layer 1 starting at 8s; **blend in / blend out** of
about 0.3s on it so the stumble eases into the walk and back out; then key the legs
inside it.

> **You author it against the walk, not against a T-pose.** While you tweak a strip,
> the layers *below* it keep playing underneath — scrub and the character walks under
> your hands, so you can key the misstep onto the stride it actually interrupts.

**replace or additive?** The strip inspector's **mode** decides how your keys meet the
walk:

- **replace** — your keys *are* the pose for the bones you keyed. Use it when the
  misstep is a specific leg position you want exactly.
- **additive** — your keys are an *offset added to the walk*, so the legs keep
  striding and get displaced. Use it for a nudge, a stumble, a recoil. The animator
  previews it the same way the game plays it: walk + your offset.

Bones you never key are untouched either way, so the rest of the body keeps walking
with no mask needed.

> **The clip lives on the RIG, not on the cinematic.** That is why the tweak bar has
> its own **💾 Save rig** and shows **unsaved** — saving the *cinematic* does not save
> the animation you just authored.

**You usually do not need a mask for this.** A clip only affects the bones it actually
keys, so an override you authored yourself already leaves everything else to the layer
below. Masks are for the other case: using only *part* of a clip that already exists.

### Use only part of a clip (strip masks)

A **mask** narrows a strip to part of the skeleton — take an existing full-body wave
and let it drive only the arms while a walk keeps the legs.

With a strip selected, the inspector's **mask** section lists the bones the strip is
restricted to:

- **＋ add a bone…** picks a bone; the list is indented by hierarchy so you can find
  a subtree root quickly. Add as many roots as you need.
- **include children** (on by default) extends each root to everything beneath it —
  that is what makes "from `spine` up" a single pick.
- The header counts what the mask really covers (**"9 of 73 bones"**), expanded the
  same way the player expands it, so you can see at a glance whether it's doing what
  you meant. **clear** removes it, and a masked strip is marked **◑** on the timeline.

While you are **tweaking** a strip the same controls sit in the tweak bar, where the
bones are actually visible and clickable:

- **◑ ＋ \<bone\>** adds the bone you have selected on the canvas (with its children).
- **◑ keyed** masks the strip to exactly the bones you have keyed in this clip — the
  one-click end of the override recipe above.
- The readout shows the live count, and masked bones are drawn **blue** in the bone
  overlay while everything else dims, so a mask is something you can see.

Bones *outside* the mask keep whatever the layers below posed. Two things to know:

- **A mask needs something underneath.** On an actor's only layer there is nothing to
  show through, so the un-masked bones hold their **setup pose** — which looks like
  half the rig went limp. Add a layer with **⧉** and put the masked strip above a base
  clip. The inspector says so when it applies.
- **Masks cover bone transforms only.** Slot colour, attachment swaps and mesh deform
  are not masked — a documented v1 limit, not a bug.

### Tweak a clip in context (edit the animation without leaving the shot)

A strip plays a clip; **tweaking** is how you edit that clip *while the rest of the
scene keeps playing around it*.

**Double-click a strip** — or select it and press **✎ Tweak clip** in the strip
inspector — and the ordinary animator opens on that strip's clip: the dopesheet,
the graph editor, ◆ Key / ◆ Key all, curves, the bone outline and the transform
gizmo, all exactly as in **◆ Animate**. What is different is the context:

- Every **other actor stays on stage**, posed at the cinematic playhead, so you
  animate against the shot rather than against an empty canvas.
- The rig you are editing is posed **where it stands** — its stage x / y / scale /
  flip / rotation are applied, so what you key is what the scene shows.
- There is **one playhead**. The transport still shows *cinematic* time; the
  dopesheet shows *clip* time; moving either moves the other, through the strip's
  trim, speed and loop. The tweak bar shows both (`cine 2.00s · clip 0.67s`).

Leave with **✔ Done** or **Esc** (the first Esc clears a key selection, if you
have one). On the way out the rig is re-parsed, so the strips immediately play
what you just authored.

> **Save the rig.** A tweak edits the *rig*, not the cinematic — the tweak bar
> says **unsaved** and carries a **💾 Save rig** button. Until you press it (or
> ⤓ .irig), the edit lives only in this tab. Saving the *cinematic* does not save it.

Two consequences worth knowing:

- **Only the part of the clip the strip shows is reachable.** The playhead is
  mapped through the strip, so a strip trimmed to half a clip can only key that
  half. Lengthen or re-trim the strip, or leave tweak and use plain ◆ Animate, to
  reach the rest. (Raising the clip's **working length** in the Animations panel
  extends how far past the last key you can go, as usual.)
- **Tweaking opens that rig in the editor**, replacing whichever rig was open —
  you are asked first if it had unsaved changes. A rig that needs a different rig
  runtime line is refused with a message rather than reloading the page under you.

### Animate properties, the camera, and visibility

Press **◆** next to a field to key it at the playhead. Actor **x / y / scale /
rotation / alpha** are all animatable; keys appear as colour-coded diamonds on
their own rows (drag to retime, Del to delete), and a key inspector sets time,
value and **outgoing interpolation** (linear / ease in-out / hold).

The **camera** is keyed from wherever the stage camera is — frame the shot by
panning and zooming, then press ◆. A **🎥 live toggle** stops the track seizing
the view while you navigate.

**Visibility** is keyed with the ◆ beside an actor's eye. Its keys carry their
state in their *shape* — filled = on screen from here, hollow = hidden from here —
so the row needs no legend. Being a boolean it is stepped: the value is the last
key at or before the playhead.

Two rules that will otherwise look like bugs:

- A channel with keys **owns** that property for the whole cinematic, holding its
  first/last value outside the keyed range — so an actor never jumps at the first key.
- Consequently, once a channel is animated, **typing in its numeric field keys at
  the playhead** rather than editing the static placement. (Editing the static
  value would appear to do nothing, since the channel overrides it on the next frame.)

### Cues — telling the game when, not what

The global **⚡ cues** row marks named moments. **＋ Cue at playhead**, then name
it and drag the marker to retime. A cinematic never implements the effect; it only
says *when*. Namespaces, colour-coded on the marker:

| Prefix | Means |
|---|---|
| `fx:` | an **Invisible FX** effect |
| `sfx:` / `music:` | a game sound cue |
| `signal:` | broadcast on the game event bus |

The name is free text with a datalist of prefixes rather than a dropdown, because
the ids live in three different systems — any dropdown would be wrong in at least
one of them. In the editor an `fx:` cue drives the stage FX overlay; the other
namespaces name things that only exist inside a game, so they report in the status
line instead of silently doing nothing. (The Scene Editor's timeline does offer name
dropdowns and a ▶ audition for sounds; here you type the name.)

**Sound options.** Select an `sfx:` / `music:` cue and the inspector adds a **🔊 Sound**
(or **🎵 Music**) section: **do** ▶ play or ⏹ stop; for SFX, volume, ± volume, rate,
± rate, pan, fade in, start offset, loop, overlap and alternates picked at random; for
music, volume, crossfade and a loop override; a stop cue takes a fade out. Empty fields
store nothing, so a plain cue plays as before. The marker shows a hint such as
`🔊 coin 60% 🔁`. The game applies them exactly as on Scene Editor timelines — see
[Report events](/docs/invisible-editor#report-events-visibility-and-text) for what each
option does.

**Nothing fires on a seek.** A backward step or a jump bigger than a frame is
silent, which is what makes scrubbing usable rather than a machine-gun of effects.

**Putting an effect in front of a rig.** Depth belongs to a *layer*, not to the
individual cue. The moment a cinematic has one `fx:` cue, a **⚡ fx** row appears in
the timeline among the rig rows — move it with **▲ / ▼** and every `fx:` cue draws at
that depth. Bind a Scene and the same row becomes **🎬 set**, carrying the scene's
sprites and text along with the effects.

> **The preview can only show bands.** Every rig is drawn into one WebGL canvas and FX
> into another, so the stage can put effects above or below the *whole* cast — never
> sandwiched between two rigs. At an in-between depth the row says so; the game honours
> the real per-actor depth either way.

### Undo, saving, and getting it into a game

**↶ / ↷** plus Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y, with the action's name on the
button; rapid edits to one field coalesce into a single step. This history covers
the **cinematic document only**. While you tweak or pose a clip, the keys undo the
**rig** edits instead (the rig has its own history — see
[Undo / redo (rig edits)](#undo--redo-rig-edits)); the two never undo each other's
document.

Save with **Open / Save / ＋ New / 🗑** or Ctrl+S; cinematics are stored per
project. If someone else saved over your copy you are **asked** before overwriting,
never silently clobbered, and switching project in another tab can't make a save
land in the wrong project. `localStorage` holds only a crash/reload draft.

To play one in a game, wire the Flow node **`playCinematic`** in `/flow-v2`: pick
the cinematic from its list (listed as **Cinematic · <name>**, after the Scene Editor's screen
timelines), set `speed`, and choose **`loop`** *or* **`awaitComplete`**.
Those two are mutually exclusive — together they hang the round forever with no
error, so the inspector clears one when you set the other and the graph refuses to
validate with both. The rigs a cinematic casts ship with it automatically, even if
they appear in no scene.

> **Status:** built 2026-08-17 (tweak mode 2026-08-18), all phases complete. The
> **editor** half is the verified half — the in-game player and the Flow node are
> proven by contract tests but have **not yet run in a real game**. Check a
> cinematic in a live game before depending on it.

## Traps

- **A mesh warps after its art was redrawn in the source atlas.** A mesh is authored against the
  exact pixels of its region. ⟳ Re-sync atlas (and the automatic refresh) follows a region that was
  merely re-packed or recoloured, but never touches your meshes — so if the art inside a
  region changed _shape_, the old mesh no longer fits it. Re-shape the mesh and re-check its
  weights; no atlas refresh can fix this.
- **A rig with a hidden effect in its resting pose makes a tiny symbol.** The auto-fit on save
  measures every attachment in the setup pose, including ones you can't see — a burst scaled up at
  zero opacity still counts — and the symbol is then fitted by that oversized frame. Drag the
  **Bounds** frame round the art that should fill the cell (a custom frame is locked against the
  auto-fit), or keep the effect's attachment empty in the setup pose and key it on in the
  animation.
- **＋ add image… in a skin other than `default` names the image after the slot, not the art.**
  Rig picks a slot's image by NAME, then looks it up in the skin on stage, else in `default`. So
  to show new art in one skin only, the image is stored in that skin under the name the slot
  already shows (e.g. `radial1`), drawing the art you chose (e.g. `dust1`); the slot list shows it
  under that name. Adding again in the same skin replaces that skin's image, keeping where it sat;
  if that skin's image there is a mesh or an image sequence, the add is refused (use **replace
  image (keep mesh)…**). A slot that shows nothing gets the art's own name, or `name2`, `name3`…
  when another skin already holds that name there, so `default` still shows nothing on it.

## Known limitations / TODOs

- **Live verification is the main gap.** Most of the editing/authoring/animation
  surface is "code landed, build GREEN, not browser-verified" — the headless test
  spikes (`tools/rigger-spike/`) run `engine-rig` in node, not the page, so they
  can be false-green. Several browser-only bugs have already been found and fixed
  during owner live-testing (e.g. attachment type checks via `constructor.name`
  failing under a minified runtime, and a double-flipped Y in canvas placement). Verify each action in the
  browser before relying on it.
- **Auto-weights is proximity-only.** **Auto-weight to chain** weights by distance to
  the bones, which does not know about the mesh's shape (an arm vertex near the torso
  bone picks up torso weight). A shape-aware algorithm, checked against a real
  character mesh, is future work; the brush is the way to fix up the result.
- **No lossless desktop-editor project round-trip.** `.irig` is the rig _runtime
  export_ format; the desktop editor's proprietary project file can't be
  authored. The desktop editor can _import_ our JSON, but that's an import, not a
  pristine project round-trip — the desktop editor's limitation, not ours.
- **JSON only for editing.** Editing writes/exports JSON `.irig`; binary `.skel`
  is view-only.
- **Deferred:** hull-loop **reordering** (dragging to change the boundary order,
  Phase 3.6d) is the only remaining 3.6 sub-item. The visual texture-panel UV
  editor (drag vertices over the region art) shipped as Phase 3.6a,
  constraint-edge editing (✎ Edge, Phase 3.6b) ships, and hull **promote/demote**
  (⬡ Hull, Phase 3.6c) ships. The non-bone animation channels once listed here —
  **draw-order, events and mesh deform** — have all since shipped.
- **Localized text needs fonts + translations to exist first.** With no font in the
  project's catalog, or no keys in `/localization`, the Add-text panel has nothing to offer.
  Every translation is baked, reviewed or not; the panel counts the unreviewed ones, and a string
  corrected in `/localization` reaches the art the next time the rig is opened. Per-locale art
  also multiplies atlas space by the locale count for each text element.
- **A baked bezier uses absolute control points** — re-apply easing after a large
  retime or re-pose of a curved key (noted in-UI).
- **Bundle-name collisions are case-sensitive in R2.** New-rig / upload now 409 on
  a name that matches an existing bundle case-insensitively (this was added after
  two same-name rigs got stuck), even when two people create `Hero` and `hero` at the
  same moment — then at least one of them is refused; use distinct names. A New rig that
  failed half-way (it never shows in the list) frees its name after 10 minutes: creating
  that name again then succeeds (recreated with the same capitalisation, the half-made rig
  shows in the new rig's 🕘 History).
