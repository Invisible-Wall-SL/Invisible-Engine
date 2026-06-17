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
Editor stays usable alongside it (it can *import* the JSON, though not a lossless
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

> **Status (as of 2026-06-14):** Phases 0–5 plus the from-scratch authoring
> workflow have landed as **code, build GREEN, but mostly not yet browser-verified**
> on the live authed page. Owner live-testing is ongoing and has already turned up
> and fixed several browser-only bugs (see Known limitations). Treat the
> feature list below as "built, verify live."

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

Stage controls: **scroll = zoom**, **drag = pan**, **Reset view** re-fits. The
bottom bar toggles the **Bones** overlay (with a size slider) and the **Mesh**
hull/triangle overlay, and has **❚❚ Pause / ▶ Play**, **↻ Loop**, an **Anim**
picker, a **Skin** picker, a **scrub** bar with a numeric time field, and a
**Speed** control.

### The three modes

A floating segmented toggle at the top of the stage switches the workflow:

- **▶ Preview** — full animation playback (honours bezier curves + mixing),
  read-only.
- **✎ Setup** — edit the **rest (setup) pose**: bones, meshes, weights,
  attachments. This is the rig-editing mode.
- **◆ Animate** — author one animation at a time by posing bones (and slots) at a
  playhead into keyframes.

(Setup and Animate stay disabled until an editable rig is loaded.)

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
  **＋ Add slot** adds one.
- **Skins:** the **Skins** section lists skins; click one to make it the **active**
  skin (what determines which images/meshes/weights you see and paint). Rename
  (✎), delete (🗑, the last skin can't be removed), and **＋ Add skin**.
- **Meshes:** select a slot whose attachment is a mesh to edit its geometry — drag
  vertices, **＋ Add vertex** (click inside the mesh), **－ Remove vertex** (click
  an interior vertex), and numeric UV editing on a selected vertex. Turn a region
  into an editable quad mesh with **▸ Convert to mesh**, or **✎ Draw mesh** to
  trace a mesh outline by clicking boundary points (Finish to commit, Esc to
  cancel, Backspace removes the last point).
- **Weights:** on an unweighted mesh, **Bind to slot bone** makes it weighted
  (every vertex 100% to the slot bone). Selecting a weighted-mesh vertex lists its
  bone influences with auto-normalising weight inputs, an ✕ to remove an
  influence, and a dropdown to add a bone. The **🖊 Weight brush** paints weight
  toward a chosen target bone (radius / strength / subtract-to-erase), with a
  blue→red heatmap on the vertices showing the current weight map.

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
  *every* bone's pose plus *every* slot's attachment + colour at the playhead),
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
  whole selection) to **duplicate** it — copies land where you release, leaving
  the originals in place, and the new keys stay selected. A plain drag on a track
  scrubs the playhead (as does the ruler).
- A separate **Graph** view (Dopesheet ⇄ Graph switch) plots value-over-time
  curves with draggable keyframe and bezier-tangent handles. Multi-select works
  the same way — Shift-click points, marquee-drag the background, or **click a
  curve line** to select all of its keys (Shift adds another curve); a selection
  of ≥2 points shows a bounding box whose edges scale the timing/values, and
  Delete removes the selected keys. **Alt-drag** duplicates the selection
  (copies drop where you release). Right-click a key for the easing menu.
- Slot animation is supported too: key a slot's **attachment** (which image shows)
  and its **colour/alpha** at the playhead.

### Create a rig from scratch

1. Click **＋ New rig** in the sidebar, name it, and either:
   - pick an existing project **Atlas (images)** from the dropdown — the server
     assembles a self-contained spine bundle (a synthesised `.atlas` + the packed
     page image + a blank `.irig`) from that atlas's manifest; **or**
   - use **or upload images** to select PNG/WebP/JPEG files — the browser packs
     them onto one page and uploads it as a new bundle (region names come from the
     filenames).
2. The new rig opens in Setup mode. Add bones / slots / skins, **attach** images
   from the loaded atlas to slots (then place or convert them to meshes), paint
   weights, and animate.

### Save / export

- **💾 Save** writes the current rig to the project in R2 as a re-openable
  `.irig` (non-destructive — an artist's source `.json` is left untouched; the
  edit is a sibling `.irig` listed in the rig list). Per-row **🗑** in the rig
  list deletes a rig.
- **⤓ .irig** downloads the skeleton locally as Spine 4.2 JSON under the `.irig`
  extension.

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
- **No lossless desktop-Spine project round-trip.** `.irig` is the Spine *runtime
  export* format; the desktop editor's proprietary `.spine` project file can't be
  authored. Desktop Spine can *import* our JSON, but that's an import, not a
  pristine project round-trip — an Esoteric limitation, not ours.
- **JSON only for editing.** Editing writes/exports JSON `.irig`; binary `.skel`
  is view-only.
- **Deferred:** a visual texture-panel UV editor (drag vertices over the region
  image) and hull/edge editing (Phase 3.6); the remaining non-bone animation
  channels (draw-order timeline, events, mesh deform).
- **A baked bezier uses absolute control points** — re-apply easing after a large
  retime or re-pose of a curved key (noted in-UI).
- **Shipping a rig is a separate step.** "It renders in `/rigger`" does **not**
  mean it ships in a game — the editor reads R2 directly. Per the asset-pipeline
  rule, a rig only ships once it travels export → `deploy/` → bake → pull →
  register; that full Rigger→game wiring (Phase 7) is not done yet.
- **Bundle-name collisions are case-sensitive in R2.** New-rig / upload now 409 on
  a name that matches an existing bundle case-insensitively (this was added after
  two same-name rigs got stuck); use distinct names.
