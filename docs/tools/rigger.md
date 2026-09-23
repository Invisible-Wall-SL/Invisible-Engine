# Invisible Rigger

An online Spine skeleton editor — load a rig from the project's cloud storage,
inspect and edit its bones, slots, skins, meshes and weights, animate it, and
save it back as an `.irig` (byte-valid Spine 4.2 JSON the official runtime
reads). You can also build a rig from scratch and import images.

## What it is

A browser-based rigging tool, comparable in scope to the desktop Spine Editor,
that we own end-to-end — no Spine licence needed to rig or animate. Its native
file is a Spine **4.2 runtime export JSON** saved under our own `.irig`
extension, so rigs round-trip with the official runtime and the desktop Spine
Editor stays usable alongside it (it can _import_ the JSON, though not a lossless
`.spine` project round-trip).

It is built on the existing Invisible Spine Viewer — the WebGL renderer, pan/zoom,
animation scrubber and debug overlay are forked from it, and it reuses the
viewer's `/spine/skeletons` + `/spine/file` endpoints and the same vendored
`spine-webgl-4.2` runtime. The Rigger's added value is the structured **Inspector**
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

> **Status (as of 2026-08-18):** Phases 0–6, the from-scratch authoring workflow,
> localized text as rig art, and **Cinematic mode** have all landed. Shipping a rig
> into a game works end-to-end. The standing caveat is unchanged: much of this is
> **code + green builds, not browser-verified** on the live authed page — the
> vendored spine runtime is minified, so the headless test spikes (which use the
> un-mangled `spine-core`) can be false-green. Owner live-testing keeps turning up
> browser-only bugs (see Known limitations). Treat the feature list below as
> "built, verify live."

## How to use it

### Open it and pick a project

Sign in to the launcher (`app.invisiblewall.org`) and open **Invisible Rigger**.
The left sidebar has an **Active project** selector — the rig list and any new rig
you create are scoped to the project you have selected.

### Load an existing rig

1. Click **⤓ Load spine** in the sidebar to open the **Load a spine** modal,
   which lists the project's skeletons (`.json`, `.skel`, and saved `.irig`
   files; edited `.irig` rigs are tagged "irig · edited"). Use the **filter** box
   to narrow the list, or **rescan** to refresh it.
2. Click a skeleton to load it. It renders on the central WebGL stage and the
   left **Inspector** populates with the rig's structure under collapsible
   sections: **Bone hierarchy**, **Slots (draw order)**, **Skins**,
   **Animations**, and **Constraints**.

> **↻ Refresh from R2** (sidebar) re-reads the rig list — and reloads the rig
> currently on stage — fresh from cloud storage, bypassing the browser cache.
> Use it after creating/saving a rig (here or in another tool) if the list or the
> loaded rig looks stale. The rig list endpoint is served `no-store` and the
> client cache-busts every fetch, so this is belt-and-braces; unsaved edits to the
> open rig are guarded by a confirm.

Stage controls: **scroll = zoom**, **drag = pan**, **Reset view** re-fits. The
bottom bar toggles the **Bones** overlay (with a size slider), the **Mesh**
hull/triangle overlay, and the **Bounds** size frame, and has **❚❚ Pause / ▶
Play**, **↻ Loop**, an **Anim** picker, a **Skin** picker, a **scrub** bar with a
numeric time field, and a **Speed** control.

### Bounds (the rig's size frame)

Every rig carries a **natural size** — `skeleton.{x,y,width,height}` — which is
what sizes/anchors the spine in the editor and the game (so a placed spine has a
predictable size, not a guess). It is written automatically on every save: the
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
(clears the lock and re-measures). Use this when you want the spine to size to a
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

Authored events export in the `.irig` (Spine JSON) as
`animations.<name>.events` and travel with the rig, so the game replays them.

#### Bind an effect straight to the key

Matching cue names is the advanced path. Normally you just **pick the effect on
the keyframe** — the event editor's **Play effect** dropdown lists the project's
Invisible FX effects, and the moment you choose one it plays on the stage so you
can see it. (Sprite-particle effects only for now.) **— none (cue only) —** goes
back to a plain broadcast.

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
  rotate-ring + move-centre gizmo on the bone origin; a **parent** dropdown to
  reparent (cycles are prevented); **rename**; **🗑 Delete bone** (root can't be
  deleted). Add a bone with **＋ Add bone** in the Bone hierarchy section.
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
  to click again after adding sprites. This is the Rigger end of the Sheet Maker →
  Atlas Maker FX pipeline (same `_shine`/`_glow`/… naming convention).
- **Skins:** the **Skins** section lists skins; click one to make it the **active**
  skin (what determines which images/meshes/weights you see and paint). Rename
  (✎), delete (🗑, the last skin can't be removed), and **＋ Add skin**.
- **Meshes:** select a slot whose attachment is a mesh to edit its geometry — drag
  vertices, **＋ Add vertex** (click inside the mesh), **－ Remove vertex** (click
  an interior vertex — hull vertices can't be removed until you drop them to
  interior with **⬡ Hull** first), and numeric UV editing on a selected vertex.
  **⟁ Re-triangulate** re-weaves the whole mesh through every point (Delaunay over
  the hull + interior points, honouring your constraint edges) — drop interior
  points, then re-triangulate so the triangles pass through them. Turn a region
  into an editable quad mesh with **▸ Convert to mesh**, or **✎ Draw mesh** to
  trace a mesh outline by clicking boundary points (Finish to commit, Esc to
  cancel, Backspace removes the last point).
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
  Delaunay pass didn't include it) and **saves with the mesh** (as the Spine
  `edges` field), so it round-trips into the desktop Spine editor too. Constraint
  edges draw **amber** on both the main canvas and the UV map panel, and the
  first-picked (armed) vertex is highlighted amber. **Hull boundary edges** are
  always kept and can't be toggled — the tool tells you so if you try.
- **UV map panel:** with a mesh slot selected, a square **UV map** panel appears in
  the inspector below the mesh tools. It draws the mesh's **region art upright** with
  the **mesh wireframe** (triangles + vertex dots) overlaid on it, so you can see
  exactly which part of the texture each vertex samples. **Drag a vertex over the
  art** to re-map its UV — this is the visual complement to the numeric **u / v**
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
- **Weights:** on an unweighted mesh, **Bind to slot bone** makes it weighted
  (every vertex 100% to the slot bone). Selecting a weighted-mesh vertex lists its
  bone influences with auto-normalising weight inputs, an ✕ to remove an
  influence, and a dropdown to add a bone. The **🖊 Weight brush** paints weight
  toward a chosen target bone (radius / strength / subtract-to-erase), with a
  blue→red heatmap on the vertices showing the current weight map.

#### Pivot — the point an image hangs from (**✥ Set pivot**)

Select a slot with an image in Setup mode and, under its placement fields (x / y / rotation /
scaleX / scaleY, above **▸ Convert to mesh** / **✎ Draw mesh**), a **pivot** section offers a
**✥ Set pivot** button, a 3×3 snap grid and a readout like `50% × 100%`.

**The pivot belongs to the image, not to the skeleton.** Setting it creates, moves and deletes
nothing in the bone hierarchy — a bone stays a separate thing you add deliberately. The pivot is
stored on the attachment itself as `pivot: [u, v]`: across and down, 0..1 of the image, absent
meaning centred.

**Why it needs storing at all.** Spine has no pivot field. A region attachment always places and
rotates its quad about its own image centre and only then offsets by x/y — which is why a fresh
image hangs from, and turns about, its middle. The key we add is non-standard but inert: the
official Spine 4.2 loader ignores it and the rendered geometry is byte-identical, so the `.irig`
still opens in Spine, with no sidecar.

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
- **The fractions are of the _untrimmed_ image** (Spine's `width` / `height`), not of the packed
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
locale whose translation is **reviewed** in `/localization` — packed onto a page inside the
rig's own atlas, and placed as a slot on its **own bone**, with one region attachment per
locale named `<id>@<locale>`. The source locale is the setup attachment.

From then on it is an **ordinary region**: convert it to a mesh, bind and paint weights, deform
it, key it, show and hide it, and cast the rig in a cinematic. Converting the source locale to a
mesh automatically **relinks the other locales as linked meshes**, so the mesh, the weights and
the deform you author once drive every language.

In game, the slot is switched to the player's language automatically; a language with no baked
variant falls back to the source art.

- **✎** re-bakes an element (after you change the font, size, colour, or after a translation is
  reviewed). A re-bake reloads the rig's atlas, so the tool **saves the rig first** — it asks.
  Existing attachments keep their authored placement, mesh and weights; only newly-reviewed
  locales are added.
- **✕** removes the element, its slot, its attachments and its atlas regions.

Three things to know before you use it:

- **The text is ART.** Changing a string is a pipeline step (re-bake, re-save), not a runtime
  one. Use it for `FREE SPINS`-style display copy; anything dynamic (a win amount, a counter)
  stays a live text node in the Scene Editor.
- **A mesh is authored against ONE locale's rendering.** A longer translation (German is the
  usual offender) is stretched onto the same mesh. Keep the mesh simple if the lengths differ a
  lot.
- **Unreviewed translations are not baked.** Review them in `/localization` first, then re-bake.

### Animate (Animate mode)

- Create/manage animations in the **Animations** section: **＋ New animation**,
  ✎ rename, ⧉ duplicate, 🗑 delete. A rig can hold many animations.
- With an animation selected, the bone/slot Properties show the **pose at the
  playhead**. Editing a field — or dragging a bone on the canvas — keys that
  channel. The bone Properties also give per-channel **Key** buttons (one beside
  `rotation`, one beside `x`/`y`, one beside `scaleX`/`scaleY`) that key only that
  channel, plus a **◆ Key all transforms** button that keys all three at once for
  the selected bone. Bottom-bar tools: **◆ Key** (keys rotate+translate+scale of the
  selected bone, or attachment+colour of the selected slot), **◆ Key all** (keys
  _every_ bone's pose plus _every_ slot's attachment + colour at the playhead),
  **|◀ / ▶|** prev/next key, **✕ Key** deletes the key at the playhead. The
  rotate/move gizmo also keys on release.
- A **dopesheet timeline** docks below the stage: a time ruler, one track per
  keyed bone/slot with key dots, and a draggable playhead. Drag a key dot to
  retime it, double-click to delete it, and use the per-key easing buttons
  (Linear / Stepped / Ease In / Out / In-Out) for interpolation. **Multi-select
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
- A separate **Graph** view (Dopesheet ⇄ Graph switch) plots value-over-time
  curves with draggable keyframe and bezier-tangent handles. Multi-select works
  the same way — Shift-click points, marquee-drag the background, or **click a
  curve line** to select all of its keys (Shift adds another curve); a selection
  of ≥2 points shows a bounding box whose edges scale the timing/values, and
  Delete removes the selected keys. **Alt-drag** duplicates the selection — a
  ghost previews the drop and the originals stay put. Right-click a key for the
  easing menu.
- Slot animation is supported too. With a slot (object) selected in Animate mode
  its Properties give three keyable channels at the playhead:

  - **shows** — which **attachment** (image/mesh) is visible (stepped swap).
  - **colour** — the slot's **tint** (RGB only; opacity is preserved).
  - **opacity** — a dedicated 0–100% slider plus a **◆ Key opacity** button to
    animate the object fading in / out. Key it at two playhead positions to make a
    fade. When a colour/opacity key sits at the playhead, **easing** buttons
    (Linear / Stepped / Ease In / Out / In-Out) shape the interpolation out of it.

  Colour and opacity share one `rgba` timeline under the hood (byte-valid Spine
  4.2), so editing one never clobbers the other.

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
  any rig. Re-saving a name overwrites the library copy (you're asked to confirm).
- **🗂 Animation library** — opens a modal listing every saved clip (name, duration,
  source project, bone count) with a filter box. **Load** imports a clip onto the
  current rig; **🗑** deletes it from the library. Empty state tells you to use 📤.

**Compatibility report (important).** Spine animations reference bones, slots,
attachments and events **by name**. A pasted/loaded clip only fully drives a rig that
has matching bone/slot names; channels that reference names the target rig lacks are
imported harmlessly but **drive nothing** (silently). So before importing, if any
referenced bone/slot is missing on the current rig, a report shows **matched vs
missing** names and asks **Import anyway / Cancel**. A fully compatible clip imports
straight away. In this version the clip is always imported **as-is** — no channel
stripping and no name remapping (that's a later iteration); rename bones/slots to
match first if you need the missing channels to drive.

### Reuse a whole rig (rig library)

Where the animation library reuses a single clip, the **rig library** reuses an
**entire rig** — bones + slots + skins + constraints **and** all its animations. It's
the transfer medium for "copy a rig (with animation) from one object to another":
apply a saved rig to a new object, then attach that object's art, build a mesh, and
weight it to the imported bones with the existing mesh/weight tools. Like the animation
library it's **shared and cross-project** (stored under `_shared/rigs/` in R2).

- **📦 Save rig to library** (sidebar, enabled once a rig is loaded) — prompts for a
  name (defaulting to the current rig's stem) and saves the whole open skeleton to the
  library. Re-saving a name overwrites that library entry.
- **🗂 Rig library** (sidebar) — opens a modal listing every saved rig with its stats
  (e.g. "12 bones · 3 anims") and a filter box. Each row offers:
  - **Use in new rig** — closes the modal and opens the **＋ New rig** panel with this
    rig pre-selected in the **Apply saved rig** dropdown; you then pick the art source
    and **Create** (see below).
  - **Import into open rig** — merges this rig into the rig currently on stage
    (enabled only when a rig is loaded; see the namespaced merge below).
  - **🗑** — deletes the rig from the library.

**Apply at creation.** The **＋ New rig** panel has an **Apply saved rig (optional)**
dropdown (first option "— none (blank skeleton) —"). With a rig selected, the new rig
is created **carrying that rig's bones + animations + constraints** instead of a blank
skeleton — for **both** art sources (project atlas and uploaded images). This is the
"move the rig onto a new object" path: create against the new object's art, then attach

- mesh + weight to the imported bones.

**Import into the open rig (namespaced merge).** _Import into open rig_ merges a saved
rig into the live rig **without touching anything that's already there**. Every imported
name (bones, slots, skins, constraints, **and** animations) is given a unique prefix —
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
   blank skeleton), and either:
   - pick an existing project **Atlas (images)** from the dropdown — the server
     assembles a self-contained spine bundle (a synthesised `.atlas` + the packed
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
     filenames).
2. The new rig opens in Setup mode. Add bones / slots / skins, **attach** images
   from the loaded atlas to slots (then place or convert them to meshes), paint
   weights, and animate. (If you applied a saved rig, the bones + animations are
   already present — re-attach this object's art and weight it to those bones.)

### Save / export

- **💾 Save** writes the current rig to the project in R2 as a re-openable
  `.irig` (non-destructive — an artist's source `.json` is left untouched; the
  edit is a sibling `.irig` listed in the rig list). Per-row **🗑** in the rig
  list deletes a rig.
- **⤓ .irig** downloads the skeleton locally as Spine 4.2 JSON under the `.irig`
  extension.

### Re-sync a rig's atlas (after editing the source atlas)

Each rig is a self-contained spine bundle (`spines/<rig>/`) that holds its OWN
**copy** of the atlas page image, snapshotted when the rig was created. So if you
recolour or otherwise edit that atlas in the **Atlas Maker** afterwards, the rig
keeps showing the OLD image — its copy is never auto-updated.

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
  you are asked first if it had unsaved changes. A rig that needs a different Spine
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
line instead of silently doing nothing.

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
button; rapid edits to one field coalesce into a single step. This is `/rigger`'s
first undo stack and it covers the **cinematic document only** — rig editing still
has no undo.

Save with **Open / Save / ＋ New / 🗑** or Ctrl+S; cinematics are stored per
project. If someone else saved over your copy you are **asked** before overwriting,
never silently clobbered, and switching project in another tab can't make a save
land in the wrong project. `localStorage` holds only a crash/reload draft.

To play one in a game, wire the Flow node **`playCinematic`** in `/flow-v2`: pick
the cinematic by id, set `speed`, and choose **`loop`** *or* **`awaitComplete`**.
Those two are mutually exclusive — together they hang the round forever with no
error, so the inspector clears one when you set the other and the graph refuses to
validate with both. The rigs a cinematic casts ship with it automatically, even if
they appear in no scene.

> **Status:** built 2026-08-17 (tweak mode 2026-08-18), all phases complete. The
> **editor** half is the verified half — the in-game player and the Flow node are
> proven by contract tests but have **not yet run in a real game**. Check a
> cinematic in a live game before depending on it.

## Known limitations / TODOs

- **Live verification is the main gap.** Most of the editing/authoring/animation
  surface is "code landed, build GREEN, not browser-verified" — the headless test
  spikes (`tools/rigger-spike/`) use the un-mangled `spine-core` loader, not the
  minified vendored `spine-webgl` runtime, so they can be false-green. Several
  browser-only bugs have already been found and fixed during owner live-testing
  (e.g. attachment type checks via `constructor.name` failing under the minified
  runtime, and a double-flipped Y in canvas placement). Verify each action in the
  browser before relying on it.
- **Auto-weights is not built.** Weight painting is manual only — bind, per-vertex
  numeric edits, and the visual brush. Spike 2 (auto-weights quality) is still
  **OPEN**: a cheap proximity algorithm scored poorly against artist ground truth,
  and the available corpus is the wrong test data (no representative character
  mesh). A proper auto-weights algorithm is future work; the manual brush is the
  guaranteed path meanwhile.
- **No lossless desktop-Spine project round-trip.** `.irig` is the Spine _runtime
  export_ format; the desktop editor's proprietary `.spine` project file can't be
  authored. Desktop Spine can _import_ our JSON, but that's an import, not a
  pristine project round-trip — an Esoteric limitation, not ours.
- **JSON only for editing.** Editing writes/exports JSON `.irig`; binary `.skel`
  is view-only.
- **Deferred:** hull-loop **reordering** (dragging to change the boundary order,
  Phase 3.6d) is the only remaining 3.6 sub-item. The visual texture-panel UV
  editor (drag vertices over the region art) shipped as Phase 3.6a,
  constraint-edge editing (✎ Edge, Phase 3.6b) ships, and hull **promote/demote**
  (⬡ Hull, Phase 3.6c) ships. The non-bone animation channels once listed here —
  **draw-order, events and mesh deform** — have all since shipped.
- **Undo covers cinematics only.** Rig editing (Setup / Animate) still has no undo
  stack; the one added for Cinematic mode is scoped to the cinematic document.
- **Localized text needs fonts + reviewed translations to exist first.** With no font in the
  project's catalog, or no keys in `/localization`, the Add-text panel has nothing to offer.
  Only **reviewed** translations become locale variants — deliberately, because a string baked
  into art cannot be corrected at runtime. Per-locale art also multiplies atlas space by the
  locale count for each text element.
- **A baked bezier uses absolute control points** — re-apply easing after a large
  retime or re-pose of a curved key (noted in-UI).
- ~~**Shipping a rig is a separate step.**~~ **Resolved 2026-08-04:** a rig now
  travels the full export → `deploy/` → bake → pull → register chain, so "it
  renders in `/rigger`" *does* now mean it ships. (Publishing the game is still
  its own action, as for every asset class.)
- **Bundle-name collisions are case-sensitive in R2.** New-rig / upload now 409 on
  a name that matches an existing bundle case-insensitively (this was added after
  two same-name rigs got stuck); use distinct names.
