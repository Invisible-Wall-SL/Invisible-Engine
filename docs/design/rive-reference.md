# Rive editor reference: what we copy, map, or skip

> Decision #7 of [rive-style-editor.md §12](rive-style-editor.md#12-open-decisions-owner), the Rive
> references. The owner supplied the screenshots on 2026-10-16. Rive's behaviour comes from the
> official docs (rive.app/docs; source `github.com/rive-app/rive-docs`, read 2026-10-16). Our side
> comes from `/editor` on `main` (91478f5). This doc is a reference and a gap map. The build plan
> stays in the design doc's §10, and Phase 9's split is in §5 below.

## 1. The screenshots

| File | Shows |
|---|---|
| [01-state-machine-avatar](rive-reference/01-state-machine-avatar.webp) | Animate mode, State Machine 1. Bottom row: Animations list, then **Inputs** (Fire Color), then Listeners, then the graph with layer tabs (Layer 2 … Layer 8), then Console. Graph: Entry, Any State → Red / Green flame, Exit. Inspector: **Data Bind** (Bind view model), Artboard layout, Fills and Strokes, **Selected Colors** |
| [02-timeline-bones-skate](rive-reference/02-timeline-bones-skate.png) | Animate timeline: keys per object row, collapsed keys grey and selected keys blue. Bones and IK controls on the stage. Inspector: Transform with a key button per field, then Layer, Clip, Constraints, Draw Order. **Interpolation** panel on the right |
| [03-design-mode-hierarchy](rive-reference/03-design-mode-hierarchy.png) | Design mode: **Hierarchy / Assets / Data** tabs, lock icons on rows, the active artboard tagged **Active**. Inspector with nothing selected: Design and Animate backgrounds, **Tags**, **Default Interpolation** with a curve and values `0, 0, 1, 1` |
| [04-state-machine-transition](rive-reference/04-state-machine-transition.png) | A transition selected (`has_blog → has_blog`). Inspector: **Duration**, **Exit Time**, **Pause source when exiting**, **Allow exit during transition**, **Events**, **Interpolation**. Condition row under the graph: `if has_blog = false` |
| [05-timeline-graph-editor](rive-reference/05-timeline-graph-editor.webp) | Timeline expanded per property (Scale X/Y, Opacity, each with a key button). The Interpolation panel holds a cubic curve with handles and the value field `.76, 0, .18, 1` |

## 2. The shape of the Rive editor

- **Top toolbar**, from left: Editor menu, tool groups, Publish, the Data-binding preview toggle,
  and the **Design | Animate** toggle (`Tab`).
- **Left sidebar** of dockable panels: **Hierarchy** ⌘1, **Data** ⌘2, **Assets** ⌘3, **Animations** ⌘4,
  Agent ⌘5.
- **Stage** in the centre, with an infinite canvas of artboards.
- **Inspector** on the right. It is context-sensitive: file, artboard, shape, text, component instance,
  then key, state, transition or listener when one of those is selected.
- **Animate mode** adds the bottom area: the Animations list, then either the **Timeline** with the
  **Interpolation** panel and the Graph Editor (⇧F3), or the **State Machine graph** with Layers,
  Inputs, Listeners and a Console.
- Mode is always visible: each mode can have its own stage background colour.
  In Animate, with a timeline selected, editing a property on the stage or in the Inspector keys it.

That is the same skeleton as our [§4 target](rive-style-editor.md#4-target-experience). Ours already
has the Design | Animate toggle, the per-component Timeline and State machine tabs, and the
right-hand Properties panel. The gaps are mostly *inside* each surface.

## 3. Surface by surface: Rive, ours, gap

Legend: **P9** goes in the Phase 9 UX pass (§5). **Later** is worth having, but after Phase 9. **Map**
means we cover it with a different mechanism, so don't copy it. **Skip** means out of scope (§4).

### 3.1 Toolbar

| Rive | Ours today | Gap / call |
|---|---|---|
| Mode toggle, also on `Tab` | Design \| Animate (`+page.svelte`, `ComponentWorkspace.svelte`) | **P9**: `Tab` hotkey. Each mode gets its own stage tint (§5, 9a) |
| Transform tools V / Q / W / E | Select only; handles do scale and rotate | Skip: the handles cover it |
| Pen, shapes, Shape Builder, brush | Elements palette: Text, Rect | Skip (art comes from atlases; §4) |
| Bones / Weight tools | In `/rigger` | Map: rigs are authored in the Rigger and placed here |
| Component tool `N` | ＋ place from the Components list | Fine |
| Zoom % with presets | None (fit only on mount) | **P9**: zoom readout, `F` fit, ⌘0 for 100% |
| Revision history, create a revision | History… (layout backups); component versions | Fine |
| Publish / Export | Game Maker publish; deploy → bake | Map |

### 3.2 Left sidebar: Hierarchy, Data, Assets, Animations

| Rive | Ours today | Gap / call |
|---|---|---|
| **Hierarchy** tree: expand/collapse, drag to re-parent, drag for draw order | `EditorOutline.svelte`: indented rows, multi-select, rename | **P9**: per-node expand/collapse, drag to reorder (z-order) and drag to re-parent |
| Hover controls **Lock / Isolate / Hide** on each row; ⌘-click and ⌥-click modifiers on the eye | Lock only in the floating item toolbar; `visible` only in Properties; no isolate | **P9**: Lock, Isolate, Hide on every row. Rive's word is **Isolate**; our plan said "solo", and we use Rive's term. Editor-only, never exported (same rule as Rive) |
| Context menu: copy/paste styles, wrap in…, create component, export name, **Show dependencies** | Right-click on the stage instance only | **P9**: an outline context menu with copy/paste/delete, lock/hide/isolate, *Create component* and *Show in Flow* |
| Tags (filter, collapse, select) | None | Later |
| `Esc` selects the parent, `Enter` the first child, `X` scrolls to the selection | `Esc` deselects | **P9**: `Esc`/`Enter` walk the tree; `X` reveals the selection |
| **Data** panel: view models, instances, properties (number, string, bool, color, trigger, enum, image, list …) | Component Inputs, Events, params, *Bind to value* (engine sources), Flow values | **Map**: our component interface (§6) plus Flow already fill the view-model role. A read-only **Data** tab listing a component's inputs, events and bound values in one place is **P9**. Full view models are Later and need a design of their own |
| **Assets** panel: images, fonts, audio, scripts, components; filter/sort; export behaviour per asset | Library tab: Atlases, Rigs, Sheets, Effects, Flipbooks | **P9**: a search box and a type filter. Fonts and audio are listed read-only (they ship through their own chains) |
| **Animations** panel: every timeline and state machine, ＋ to add, PageUp/Down | One `<select>` per screen/component in the Timeline panel | **P9**: a list (Rive's left column in shots 01, 02 and 05) with ＋, duplicate, rename and delete, and the state machine as its own row |

### 3.3 Stage

| Rive | Ours today | Gap / call |
|---|---|---|
| Animate keys on direct manipulation (drag/rotate/scale with a timeline selected) | Animate stage is select-only | **P9**: drag on the stage in Animate keys x/y, scale and rotation at the playhead (already Open item 0 in `docs/status/editor.md`) |
| Different background per mode | None | **P9** |
| Rulers and guides (`;`, lock guides), pixel snapping | Auto snap guides | Later |
| Marquee zoom `Z`, `F` / `Shift+F` fit, `+`/`-` | Scroll zoom, pan | **P9**: `F`, `+`/`-`, ⌘0 |
| Arrow nudge (Shift ×10) | None | **P9** |
| Onion skin | None (and none in Rive: not documented) | **P9**, as planned: ghost frames ±N around the playhead, editor-only. We'd be ahead of Rive here |
| Edit vertices, meshes, N-slice, Dependency Graph `D` | Rigger owns meshes; no 9-slice | Skip here. N-slice for buttons is Later (8d's button frame could use it) |

### 3.4 Inspector

| Rive | Ours today | Gap / call |
|---|---|---|
| **Key button** next to every animatable field: grey = not animated, blue stroke = animated, blue fill = key at the playhead (shots 02, 05) | Properties edits the Design pose; keys only in the Timeline channel list | **P9, the top item.** In Animate, Properties shows key buttons on the keyable fields (x, y, scale, rotation, alpha, tint, ⚡ effect params). A click keys the current value at the playhead, and typing a value keys it. Keys stay relative to the Design pose, so the display shows the animated value |
| Nothing selected → file settings: mode backgrounds, Tags, **Default Interpolation** (shot 03) | Screen panels: Layout, Canvas Size, Game Settings | **P9**: a *Default interpolation* per timeline doc |
| Right-click a field → **Data Bind**; bound fields turn green, broken ones yellow | Separate *Bind to value* / *Bind to param* sections | **P9**: a green marker on a bound field and yellow on a broken one, plus a right-click *Bind…* that opens the existing binding UI |
| Fills and strokes, gradients, trim paths, feather, effect groups | Rect fill; Fill/Background sections | Skip (art is raster; §4) |
| Constraints (IK, follow path …), Draw Order rules | Rigger owns IK; zIndex field | Map |
| Layout (row/column/grid, hug/fill) on artboards and groups | Device layouts with per-layout overrides | Map (ours suits slot screens) |
| Text: runs, styles, modifiers, overflow modes | Text section: box, stroke, drop shadow, localization | Later (text modifiers); per-character animation stays in the Rigger |

### 3.5 Timeline, keys, interpolation (Animate)

| Rive | Ours today (`EditorTimelinePanel.svelte`, `$lib/timeline/timeline.js`) | Gap / call |
|---|---|---|
| Rows per object, expandable to per-property rows; grey summary keys move everything (shots 02, 05) | Channel rows for the selected node only | **P9**: rows for every keyed node, with a collapsible per-object summary row whose drag moves all of that object's keys. Plus *Show only selected* |
| **Interpolation panel**: Linear, **Cubic** (two handles plus a typed `x1, y1, x2, y2`), Hold, Elastic; *Set as default* (shot 05) | Ease select: linear, ease in-out, hold | **P9**: the panel to the right of the keys, with Linear / Cubic / Hold, a curve editor with two handles, and the typed 4-value field. Format change: a per-key `ease: [x1, y1, x2, y2]`, read by both the evaluator and the `/rigger` sequencer. Elastic is Later |
| Graph Editor ⇧F3, *Cubic Value* overshoot | None | Later |
| Multi-select keys, box-select, copy/paste, Alt-drag to scale a selection, ⌘⌥ to stagger | One key at a time | **P9**: box-select, multi-drag, copy/paste. Scale and stagger are Later |
| Loop type per timeline: **One-Shot / Loop / Ping-Pong**, **Work Area**, fps, speed | Duration only; loop lives on the SM state | **P9**: loop type and fps in the panel header. Work area is Later |
| `,` / `.` step frames (Shift ×10), ⌘`,`/`.` jump to key, `Space` play | None | **P9** |
| Report Event at the playhead | Cues exist in the engine, not in this panel | **P9**: a *Cue* row (the engine already supports cues; Open item in `docs/status/editor.md`). Text and visibility tracks come with it |

### 3.6 State machine (Animate, components)

| Rive | Ours today (`EditorStateMachinePanel.svelte`) | Gap / call |
|---|---|---|
| Entry / Any State / Exit; drag timelines from the Animations list onto the graph | Entry / Any / Exit; ＋ State picks a timeline | **P9**: drag from the new Animations list onto the graph |
| Layer tabs (shot 01), ＋, reorder, duplicate, disable ⌘M | Layer tabs, ＋, rename, delete | **P9**: duplicate and disable. Reorder only if the runtime defines a winner by order (Rive: the lower layer wins) |
| Transition: **Duration**, **Exit Time** (time or %), **Pause source when exiting**, **Allow exit during transition**, **Interpolation**, conditions (AND), disable (shot 04) | Conditions (AND), Exit time 0–1, Blend ms | **P9**: *Interpolation* on the blend (reusing the cubic field), *Pause source*, *Allow exit during transition*, and *Disable*. Duration stays ms |
| State: Single, **1D Blend**, **Additive Blend**; Randomize Exit; Actions at Start/End | Single; Speed, Loop, Start offset, Random start, On enter → raise event | Later: blend states need runtime work. *On exit* actions are **P9** (a mirror of On enter) |
| Inputs list beside the graph (shot 01) | Inputs live in Properties | **P9**: the Inputs list docked beside the graph in the SM tab, as in Rive |
| Listeners: Pointer Enter/Exit/Move/Down/Up/**Drag**/Click, Keyboard, Gamepad, Focus …; actions: set value, report event, **Align Target** | down / up / hover in / hover out / click → trigger / set / toggle / raise event | Later: pointer move/drag and align target (needed for sliders and drag games, i.e. Phase 10) |
| **Console**: the State Machine Console (entered states and taken transitions) and a Problems list | Events log; ⚠ issue pills | **P9**: a Console strip that logs entered states and taken transitions as well as events, and a Problems list that gathers the ⚠ issues with click-to-jump |

### 3.7 File browser, libraries, shortcuts

| Rive | Ours today | Gap / call |
|---|---|---|
| File browser: projects, folders, recent files | The launcher's project picker; Components home | Map (the launcher is our file browser) |
| **Libraries**: publish components / view models, import into other files, update badge, detach | *Promote to shared* (`_shared/editor-components`); built-ins | **P9** (already planned): shared and starter **timelines** (`_shared/cinematics/`), with an "update available" badge on a placed shared component or timeline. Detach = copy to project |
| Shortcut sheet on `Shift+/` | None | **P9**: a cheat-sheet overlay plus the set in §5 |

## 4. Deliberately not copied

- **Vector authoring.** Pen, shapes, shape builder, gradients, trim paths, feathering, booleans. Our
  art pipeline is raster atlases from ComfyUI and Atlas Maker, and the runtime draws sprites and rigs.
- **Bones, meshes and constraints in the editor.** They stay in `/rigger`, which already does this, and
  rigs are placed here. Splitting it would mean two rig editors.
- **Scripting (Luau) and the AI agent.** Flow v2 is our logic layer, and Director is our agent.
- **Full view-model data binding.** Our component interface (inputs, events, values) and Flow already
  play this role, and the §6 contract was designed around them. A **Data** tab that *shows* the
  interface is P9. Real view models would be a separate design and can wait for Phase 10, where
  non-slot games need game variables.
- **Runtime export formats (.riv).** We ship through export → deploy → bake → pull.

## 5. Phase 9, re-scoped (proposal)

The §10 Phase 9 row ("shared library + UX pass") was sized M. With the gaps above it is better
cut into four shippable parts. Each is editor-only, except 9b's per-key `ease`, which is additive to
the timeline format and needs a parity gate. None of them changes a game unless its doc is re-saved.

| Part | Delivers | Gate |
|---|---|---|
| **9a: Hierarchy and stage basics** | Outline rows with Lock / Isolate / Hide, expand/collapse, drag to reorder and re-parent, a context menu; `Esc`/`Enter`/`X` navigation; zoom readout, `F`, ⌘0, `+`/`-`; arrow nudge; per-mode stage tint; `Tab` toggles the mode; shortcut sheet on `Shift+/` | editor fixtures; current-games 0 changed (editor-only) |
| **9b: Keying and easing** | Key buttons in Properties in Animate (grey / blue stroke / blue fill), stage-drag keying, the Interpolation panel (Linear / Cubic with a 2-handle curve and the typed 4-value field / Hold; default interpolation), multi-key box-select / drag / copy / paste, frame stepping and `Space`, loop type and fps in the header, an all-nodes row view with summary keys, onion skin (±N ghost frames) | an evaluator fixture: cubic `ease` matches a reference bezier; existing timelines byte-identical; the `/rigger` gates |
| **9c: Animations list, state machine and console** | The Animations list (timelines and the SM as rows; drag onto the graph); Inputs docked in the SM tab; transition Interpolation / Pause source / Allow exit / Disable; *On exit* actions; layer duplicate and disable; the Console (states, transitions, events) and the Problems list | `check:component-state-machine(-editor)` extended; parity untouched (flags off) |
| **9d: Shared library** | `_shared/cinematics/` promotion, starter timelines, "update available" badge, detach; the read-only Data tab; Library search and type filter; the cue / text / visibility rows in the Timeline | the ship chain (rule 8): a shared timeline bakes and plays in a test project |

**Later** (after Phase 9, not scheduled): the Graph Editor and Elastic, blend states, pointer
move/drag listeners and Align Target, rulers and guides, tags, N-slice, text modifiers, view models.
Several of these are prerequisites for Phase 10's non-slot games, so they are best re-scoped
then.
