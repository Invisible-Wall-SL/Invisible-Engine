# Invisible Scene Editor — status

> Design: [docs/design/invisible-editor.md](../design/invisible-editor.md) · Guide: [docs/tools/invisible-editor.md](../tools/invisible-editor.md) · Agent: [`.claude/agents/invisible-components.md`](../../.claude/agents/invisible-components.md) (component system + both editors)
>
> Companion tool: [Component Editor status](./component-editor.md) — since Rive plan Phase 4a (2026-10-13) component authoring is this editor's **Components side**; that file owns the authoring story, this one the navigation between screens and components.

**One-line state:** Built and in daily use — the full build plan + Templates/Import are on `main`,
and an authored screen (new, reordered, HUD or menu) mounts in the shipped game in Screens-list
order. ⏳ Many render paths are code-verified only; the auth-gated canvas is owner-verified live.

## Current state

- **↗ Show in Flow** (Rive plan Phase 7b, 2026-10-13): a named placed component jumps to its Invisible Flow node (Properties → *Component instance*, or a right-click menu on the stage), project pinned; Flow's *Edit component* comes back in place; a Flow Preview run can drive the State Machine panel's stage (`$lib/flowStageBridge.ts`). Detail in [flow.md](flow.md) Recent changes (7b).

Launcher-native, full-page WebGL/canvas layout editor at `/editor` (auth + `editor`-tool gated; SSR off, `load` runs server-side). Project-centric: loads the active project's `scenes.json`, asset library (atlases/spines/sheets/effects/clips), components (+ the project's component defaults), and its game-type template. Layout is written to R2 at `editor/<client>/<project>/scenes.json` on a debounced, ETag-conditional autosave; the engine fetches it at boot (`GET /api/editor/doc`) and renders it via `<LayoutScene>`, falling back to the checked-in `editor-scenes.ts` fixture.

Shipped capabilities on `main`:

- **Screens** — game + HUD lists (reorder, rename, hide, duplicate, delete); per-screen **space** (`game` / `standard` with left/right/top/bottom alignment / `canvas` / `background` cover-fit); **Always on top**, **Behind the reels** and **Zoom with anticipation** ticks; roles (incl. `betMenu` / `autoSpin`, one `SCENE_ROLE_LABELS` list in `engine-layout/sceneRole.ts`); scaffold from a **game kind** (`lines`, `ways` filled; `bookOf`; `cluster`/`scatter` skeleton-only by decision), **import composed reference**, add-missing-screens, "Save as new game kind", bet menu / auto spin screens. Everything that adds a screen sits in one **＋ Add screen ▾** menu under the list, and the rest in **⋯**.
- **Every authored screen ships.** `extraMountScenes` / `fullReplaceHudScenes` (`engine-layout/genericMountScenes.ts`) mount author screens the game doesn't reserve, and `sceneLayerZIndex` gives every mount path the Screens-list z; under a screen-driving v2 flow every screen mounts through `<FlowV2Mount>`. Flow owns visibility (no "Shows during" gates).
- **Canvas** — real-texture rendering (live rig skeletons, live FX particles, playing flipbook clips, rig/sprite/flipbook board symbols through one `reelGridGeometry`), zoom/pan/Fit, multi-select, transform handles, snap guides, undo/redo, copy/cut/paste/duplicate, **⌖ Any screen** click-to-select across every drawn screen (⏳ not browser-verified). Instances preview through the project's component-defaults sidecar, and a placement pinned to an older component version draws that version, so the canvas draws what the game draws; a rig that is not playing holds its resting pose (the animation the game rests it on), not its setup pose. Every rig, text and FX overlay (both sides, HUD included) draws through TWO shared WebGL contexts and copies into a 2D canvas of its own (`sharedGl.client.ts`); nothing else in the editor route may open a context (`check:editor-gl-contexts`).
- **Library placement** — Text / Rect / Reel, atlas pages + regions (per-region drag thumbnails), rigs (project + `_shared/spines/`, upload), sheet regions, **Invisible FX** effects, **Invisible Flipbook** clips, components.
- **Properties** — transform / tint / **blend** (`normal`/`add`/`multiply`/`screen`/`overlay`/`lighten`, not on rig nodes) / text box (width/height, align, auto-fit) / rig anim + slot fill / **Plays on signal** cues on rig and flipbook nodes (free-text signal here, declared signals on the Components side) / **background cover** (fit cover·contain·width·height, cover scale, align) / **Art bounds** for sprite regions / reel-grid overflow, perspective and ground tiles / node actions. Symbol size is not authored anywhere: symbols contain-fit their cell by their own art.
- **Device layouts** — per-layoutType overrides of transform, blend, visibility, cover fit/scale, text style and component params; per-layoutType **Canvas Size** (the MAIN box the runtime adopts). The bucket set is an authorable **layout profile** (Game Settings → Layout; pipeline default in Admin → Settings); `DEFAULT_LAYOUT_PROFILE` reproduces the legacy four exactly.
- **Animate mode — the Timeline** (Rive plan Phase 3, 2026-10-13 — ⏳ not yet browser-verified).
  A **Design | Animate** toggle in the editor bar. Animate opens `EditorTimelinePanel.svelte` under
  the canvas: the active screen's timelines (cinematics with `host: {kind:'screen', sceneId}`),
  listed / created / renamed / deleted over `/api/cinematics/*`, edited in the shared Timeline
  module (`$lib/timeline/timeline.js`, `destroy()`ed on unmount). After the first visit the panel
  stays mounted, hidden and inactive in Design (no keys, no preview), so unsaved timeline edits
  survive the toggle; a screen switch saves, then closes; `beforeunload` guards a dirty timeline. The selected node becomes a node
  actor by **name** (`nodeActorTarget` refuses unnamed or shared names); x / y / scale / rotation /
  alpha / tint key through the module's `keyProperty`. The canvas previews through the
  value-binding seam (`setTimelinePreview` in `valuePreview.client.svelte.ts`) with the game's own
  `withNodeActorOutputs` + `foldBoundTransform`. The canvas is select-only in Animate (`animate`
  prop: no drag, handles, drop, delete or item toolbar); the Timeline owns Ctrl+Z/Shift+Z/Y, Ctrl+S,
  Ctrl+D and Delete, and the page's undo/clipboard handler stands down. Design mode is unchanged.
  Pure helpers: `$lib/timeline/screenTimeline.ts`. Detail: [cinematic status](cinematic.md).
  Since Phase 9b (2026-10-20, in review) keying lives in **Properties** (key buttons) and on the
  stage (drag keys), and the canvas is no longer select-only in Animate — see Recent changes.
  Since Phase 4b (2026-10-13, in review) the same panel takes an optional `component` host and the
  Components side mounts its own copy, so both can be mounted; each claims the canvas preview with
  its own owner token (`setTimelinePreview(drives, owner)`). Component authoring: [component-editor
  status](component-editor.md).
- **Components side** (Rive plan Phase 4a, 2026-10-13 — ⏳ not yet browser-verified). The old
  `/components` page is `ComponentWorkspace.svelte`, mounted inside `/editor` on first visit and
  then kept; the side not shown is only hidden, so neither loses its canvas or unsaved state. Entry
  points: the left pane's **Components** section under Screens (row = edit, ＋ = place on the active
  screen, **＋ New component…** = the components home); double-click a placed instance
  (`EditorCanvas` `onEditInstance`, off in Animate); Properties' **◇ Edit component in place** and
  **◇ Edit as component** (creates, then opens in place); the Library panel's **◇ Open components**.
  A breadcrumb (`Screens › Components › X`, or `‹screen› › X › Y`) with Esc up one level (part →
  nested def → home / origin screen; Esc first clears a selection; capture phase, skipped while
  typing or a dialog is open); nested defs open in place up to `MAX_COMPONENT_DEPTH`
  (`canEnterNested`); a **Browse** left tab. URLs: `/editor?view=components`,
  `/editor?component=<id>`, kept current with a shallow `replaceState` and read on first load;
  `/components` 307-redirects (`$lib/componentLinks.ts`). A link to `/editor` followed from inside
  `/editor` never runs as a navigation (the page holds one project's state and is not remounted):
  `beforeNavigate` applies the same project in place and does a full load for any other or for none
  (`editorSelfNavigation`); every tool bar link carries the shown `?project=` (`$lib/toolLinks.ts`,
  shared with the launcher home). Every project-scoped write the editor makes names the project the
  page was LOADED for (`loadedProjectKey`): the layout save's action URL (`editorActionUrl`),
  leases, the component / defaults saves (explicit `project` target), and the session-bound
  endpoints — timeline list/get/save/delete, backup list and restore, rig upload + reindex, art
  bounds (read and save), flipbook clips, reference import — which send `projectKey` and refuse a
  mismatch with a 409 (`$lib/server/scopeGuard.ts` `scopeMismatch`, one helper for all of them). The
  routes only the editor calls (backups, rig upload + reindex, art bounds, import) also refuse a
  request naming no project (400 `project-required`). Client helpers pin through
  `editorProject.client.ts`, and their caches are per project; an art-bounds `scope-mismatch` is
  reported, never treated as a conflict. Not project-scoped, so not pinned: game kinds, templates,
  promote-to-shared. `check:component-links` enumerates every write `fetch(` in the editor route and
  in the `$lib` client modules it imports (a pin in a comment does not count; a prebuilt
  `RequestInit` is still a write; `sendBeacon`, `XMLHttpRequest` and `new Request` are refused
  outright) and fails on a new one without the pin. `check:editor-write-scope`, `check-doc-backups`
  and `check-rigger-writes` prove the refusals behaviourally. A bare `/editor` (a bookmark) gets
  `?project=` pinned into the address bar on first load. Should the data drift to another project,
  every save and restore is blocked (both sides' `blockWhen`, the remaining writes early-return), a
  banner says so, and the page reloads. Component ETags arrive with their defs (the focus refresh
  uses the `?etags=1` listing); a def opened without one has it read and adopted only if the stored
  def is still the one opened (else a clean draft reseeds from theirs and a dirty one gets the
  ordinary conflict — `etagAdoption`). Esc stands down while a popover marked `data-esc-owner` is
  open in this side (a frame list, which also closes on Escape) or portalled onto the page (a colour
  picker). Gate: `check:component-links`.
  **Known cost:** the hidden Screens canvas keeps running while the Components side is shown — its
  redraw loop only ticks when a visible screen plays a flipbook, effect or rig, but it is not
  paused.
- **Game Settings** — per-project boot splash (`bootLoader`), layout profile, and **Authored overlays (pilot)** → *Transition* (Rive plan Phase 8a), *Win* (8b), 2026-10-14, *Free spins* (8c) and *Buttons* (8d), 2026-10-15; all four unlocked (owner browser check passed 2026-10-17), each switched by a holder of the component-publish capability and off by default for every project — the whole story in [engine status](engine.md).
- **Version history** — each save backs up the `scenes.json` it replaces (throttled, newest 20 kept; reference load, Overwrite-with-mine and restore always back up). **History…** opens the shared `$lib/DocHistoryModal.svelte` over `/api/editor/backups`; a restore is ETag-conditional and itself undoable.
- **Concurrency** — conditional autosave (stale ETag ⇒ 409 ⇒ **Reload theirs / Overwrite with mine**, autosave paused); custom kinds and templates are create-only / ETag-guarded.
- **Templates** — template-authoring mode (tag `slotId`s, save `editor/templates/<gameType>.json`) + slot/asset-issue warnings on save.
- **Pipeline** — layout-doc bake + **editor-art export** (`deploy/editor-art/`) travel export→deploy→bake→pull→register; Art bounds ship as TexturePacker trim, component `spine`-param bundles and `_shared/` rigs export like placed ones, and art picked only in a per-layoutType param override ships too.

- **Animate's second tab — the State Machine** (Rive plan Phase 5b, 2026-10-13, in review, ⏳
  not browser-verified). On the Components side only: the panel under the stage has **Timeline**
  and **State machine** tabs; screens keep the Timeline alone (plan §12 #1: screens get no state
  machine). Everything about the panel is in [component-editor status](component-editor.md).

## Open items / next

0. **⏳ Browser-verify Animate mode** (the list is in [cinematic status](cinematic.md) item 0).
   Phase 9b's list (2026-10-20): the Properties key buttons (grey / blue outline / blue) and typing
   a value on x / y / scale / rotation / alpha / tint / ⚡; stage drag, corner and rotate keying on
   a screen and on a component, including a multi-select drag and a game-space (main-scaled) node;
   the Interpolation panel (both handles, the typed field, Set as default, the default with nothing
   selected); box select, Shift/Ctrl-click, multi-drag, Ctrl+C / Ctrl+V, Delete; `,` / `.` / Space
   (and that none fire while typing); loop type in ▶ playback; summary rows (fold, drag a summary
   key, drag the lane) and Only selected; the onion skin on both sides. Component timelines (Phase 4b) are built, in review; their browser-verify
   list is in [component-editor status](component-editor.md) Blocked.
0c. **⏳ Browser-verify Phase 9c** (Animations list, state machine options, Console), both sides:
   - **Animations list:** in Animate the left column lists the screen's (or component's)
     timelines; click opens one; ＋, ⧉ Duplicate, ✎ Rename and 🗑 Delete each work; an unsaved
     timeline asks before another row opens; the Timeline header has no picker any more and
     names the open timeline.
   - **Component side:** the **State machine** row switches the tab and a timeline row switches
     back; drag a timeline row onto the graph and the card lands under the pointer (and onto the
     empty graph it makes the first layer).
   - **Inputs dock:** add a bool and a number (triggers come from Properties); fire, tick and type to drive ▶ Run; ✎ and ×
     ask as in Properties; none of it while Inspecting.
   - **Transition:** with a Blend, Linear / Cubic (drag both handles, type the 4 values); untick
     *Pause source* and see the left state keep moving under the blend; untick *Allow exit* and a
     transition out (a trigger fired mid-blend included) waits for the blend; **Disable** greys and dashes the arrow and it never fires.
   - **State:** On exit raises (Console shows it before the next On enter).
   - **Layers:** ⧉ duplicate, ◀ ▶ reorder (the later layer wins a shared node), ⏻ Disable (struck
     tab, the layer's nodes stop moving), Enable.
   - **Console:** states, transitions and events appear while running; **Problems** lists the ⚠
     and a click opens the layer and selects the card / arrow, or outlines the input; the bar's
     ⚠ count opens Problems.
   - **Save, reload:** every option is still there. A placed instance in game behaves the same.
0d. **⏳ Browser-verify Phase 9d** (shared library, Data, Library search, rows), on a screen and on
   a component:
   - **Rows.** ⚡ Report event drops a `signal:` cue at the playhead and selects it (type its name
     in the inspector; pick an effect for `fx:`); drag it. 👁 Show / Hide key a node and the
     ↳ visible row draws filled / hollow markers; the stage hides and shows it while scrubbing;
     drag and double-click-delete a marker. On a text node: Count up keys a number and the canvas
     counts; Switch offers the node's strings and the canvas switches; switching mode asks, then
     clears the other kind; the ↳ text row's labels, drag and double-click delete. Ctrl+Z undoes
     each. None of these fire while typing.
   - **Shared.** 📚 Shared lists the starters (✦) and promoted timelines; Place asks for the node
     ("Target" for a starter) and opens a 🔗 link that previews on the stage; dragging a key on a
     link, typing in Properties or a stage drag is refused with the message; Plays on / Also on /
     Rename still save. Promote to shared (an admin): a new name, then the same name again (the
     "already in the library" confirm, v2); the placed link then shows *Update available (v2)*;
     Update re-opens on v2; Detach turns it into an editable timeline. A non-admin sees no Promote.
     A link opened in `/rigger` and saved there is refused ("detach it first"). Publish a project
     with a placed starter and see it play in the game.
   - **Badge.** A placed shared component pinned below its latest shows **↑ vN** on its Outline row.
   - **Data tab** (Components side): inputs, signals, events, params and bound values match the
     component; clicking a bound value selects its node.
   - **Library.** The search narrows every section (an open atlas also by region name); the type
     picker shows one section; Fonts and Audio are listed and not draggable; Audio without
     Invisible Sound access says so.
0a. **⏳ Browser-verify Phase 9a** (hierarchy and stage basics): hover Lock / Isolate / Hide on
   both sides (hidden rigs, text and FX vanish too; other screens hide while isolating); fold;
   drag a row before / after / into a container and out again; the row menu; `Esc` / `Enter` /
   `X` / `F` / `⌘0` / `+` / `-` / arrows / `Tab` / `Shift+/`, and none of them while typing in
   Properties; the Animate tint; reload keeps Lock but drops Hide / Isolate; Tab / Enter on a
   focused Library tile; Esc with the row menu open on the Components side; drag in Firefox.
0b. **⏳ Browser-verify the Components side** (Phase 4a): the checklist is in
   [component-editor status](component-editor.md) Blocked. Editor-side extras: the left-pane ＋
   places on the active screen; double-click does nothing in Animate; Design/Animate state and the
   screens' unsaved edits survive a trip to Components and back.

1. **HUD parity gap** — the corner logo/game-name containers still ignore `scale` in-game, so scaling those two corner texts in the editor won't ship.
2. **Animated / book-event content stays coded** — symbols, win-line draws and count-ups mount via the engine `mount`/`bind` escape hatch; the editor only places their anchor and has no book-event playback.
3. **HUD Readout background size** — a width/height override moves the draw but not the instance's selection frame (`nodeBox` doesn't read instance params).
4. **`LayoutDoc.version` is typed `1`** while `editorStorage.ts` writes `DOC_VERSION = 2`; the launcher build doesn't type-check, so this ships green. Widen the type.

## Blocked (owner / external)

- **Rotate `EDITOR_DOC_SECRET`** — it is set on the launcher; rotation is on the owner's security-rotation list ([launcher status](launcher.md)).
- **Live-verify** — interactive feel (undo/redo, copy/paste, multi-select) and the render paths marked ⏳ below build clean; the owner confirms them in the running editor.

## Recent changes
- 2026-10-23 — **Keys paste onto another node; a screen timeline's `signal:` cue plays _On cue_
  Element FX** (branch `editor/keys-paste-other-node-screen-cues`, ⏳ not browser-verified).
  Reported on `commonoverlayproject` (Base game, timeline `Reel_Intro`):
  - **Paste onto another node.** "I want the reel background to do exactly the same animation."
    Ctrl+V only wrote back onto the copied track. Now, with keys of ONE node copied and another
    node selected on the stage, the Timeline asks its host (`host.pasteTarget`, new and optional)
    and the keys land on that node's same fields, timed from the playhead, in the ratio being
    edited (`ensurePropertyTrack` under `propertyLayout`). Fields it cannot key are skipped
    (`keyableChannels`), and the node becomes an actor only once something pastes. The copied node
    still selected, nothing selected, keys from two nodes, or no hook (`/rigger`) paste as before,
    byte-identical. The editor's hook is `pasteTarget` in `EditorTimelinePanel.svelte`; the optional
    right-click *Copy animation to…* was not built. A group is NOT a workaround for the reel grid:
    the game reads it only as a top-level node (`findReelGridNode`), and the guide now says so.
  - **Cues → Element FX.** A screen timeline's cue never reached an _On cue_ Element FX, whatever
    its name. `FlowV2Cinematics.routeCue` only broadcast on the game event bus, and `ElementFxPlayer`
    listens on the component-signal bus, which only a Flow `fireCue` and a component's own timeline
    fed. The editor's Animate ▶ fired no cues at all. Now, for a **screen-hosted** timeline only,
    a `signal:NAME` cue also fires `NAME` on that bus (`screenCueSignal` in `engine-layout`'s
    `componentEvents.ts`, routed as `routeComponentCue` routes a component timeline's cue), after
    the unchanged broadcast. A bare, `fx:`, `sfx:` or `music:` cue and every Rigger cinematic
    behave as before. In the editor, ▶ plays the _On cue_ entries a crossed cue reaches on the
    screen and its nodes (`screenCueFx`) through the Element FX ▶ preview, one at a time.
    `playbackCuesCrossed` steps as `<Cinematic>` does, on `cuesCrossed` / `pingPongCuesCrossed`.
    The cue inspector lists the screen's _On cue_ names as `signal:` cues under **Element FX (On
    cue)** and adds a note (`host.cueSuggestions`, new and optional; without it the markup is
    unchanged, so the Rigger golden passes 106/106).
  - Gates (both fail on `main`): `check:timeline-node-paste` (fields, times, eases, the ratio, a
    skipped field, same-node paste byte-identical, the panel's hook) and `check:screen-cue-fx`
    (the owner's timeline at 30 fps fires the Element FX's subscription once at 1.0 s; bare / `fx:`
    / `sfx:` fire none; screen hosts only; the editor's `screenCueFx` and one-shot / loop /
    ping-pong stepping; the inspector's suggestions, and the Rigger markup unchanged). The stub
    harnesses `check:screen-timeline-mounts` and `cinematic-screen-timeline.mjs` learned the two
    new `engine-layout` exports. `static/shared/timeline.mjs` was regenerated.
- 2026-10-23 — **A rig on a HUD (`standard`) screen draws by the box's own fit** (in review, ⏳ not
  browser-verified). Follow-up to the 2026-10-21 canvas fix below. The reviewer had flagged that a
  top-level rig on a `standard` screen kept its raw x/y while its box went through `standardToWorld`.
  That reproduced in code but **not on screen**: `/editor` renders every screen, the HUD active or
  behind a game screen, against one frame that the standard box sizes (`standardBox={frameSize}`,
  `frameWidth={frameSize.width}`). So the fit is the identity there, and art and box already agreed.
  The game matches the box: `LayoutScene` wraps a standard screen in `<MainContainer standard>`.
  `standardToWorld` is now one shared helper (`editorCanvas.helpers.ts`). The canvas's box and
  `placedRigTransform` both call it; the rig layer gets the `standardBox` and the scene's `align`.
  Art and box now share one mapping even if the frame stops being the standard box. A drag on a
  `standard` node still writes raw deltas, though (`isGameSpaceNode` is false for it), so that case
  would need the inverse too. The helper's `align.vertical: 'top'` now hugs the top edge like
  `MainContainer`'s `getY`; it used to centre. That only shows when the standard box doesn't fill
  the frame, which never happens in `/editor` today. No game code changed. Gate: `check:rig-origin-box` rule 8 checks the box and the rig against an independent
  model of `<MainContainer standard>`, with the HUD active, behind a game screen, and in six
  letterboxed, scaled or aligned fits. The old raw x/y fails 15 checks, 3 in each of the 5 fits
  that move or scale the rig.
- 2026-10-22 — **A placed component draws the version it pins, and a still rig its resting pose**
  (branch `claude/sweet-planck-qanrdj`, ⏳ not browser-verified). Reported on `commonoverlayproject`:
  its Jackpots bar places one jackpot frame rig (`R_Widget`) per tier, each on its own animation
  (Mini, Minor, Major, Grand). In the editor the four frames looked alike and sat round their
  values. In the game each frame had its tier's colours and parts, and sat about 15 px lower,
  under the value. Two causes, both in the editor (the game was right):
  - **Pinned versions.** The screen's placement pinned the component at v1 (rigs at y 19.5) until
    21:50 that day, after v3 had moved them up to y 4 to follow the rig's centred origin. The game
    draws the version a placement pins (`resolveComponent`; the publish bake ships it). Every
    editor renderer resolved the instance by its bare id, so it drew the latest def. The page now
    reads each older version its screens pin, once (`componentPins.client.ts`, over
    `GET /api/editor/component?version=`), and keeps it in the component map under
    `pinnedDefKey`. The canvas, the rig, text and effect layers, the selection box and the depth
    split all resolve a placement through `instanceDef` (`editorCanvas.helpers.ts`), the game's
    rule: the pinned version when held, else the latest. A pin that no version is stored for draws
    the latest, as the game does. As a result, a component edited since a placement keeps its old
    look on that screen until the placement is updated. The Outline's **↑ vN** badge now flags an
    outdated placement of a project component too (`componentUpdateAvailable`), not only of a
    shared one.
  - **Resting pose.** The rig layer drew a rig that was not playing on its setup pose. The game
    plays the rig's resting animation, and the tier animations key the frame's colours and which
    parts show. The layer now poses a still rig on that animation (`applyRestingPose`): the first
    frame of a loop, the last of a one-shot. The animation, loop and skin follow the game's
    precedence (`restingRigPose`): the placement's `spineRestOverrides`, then a param-bound
    `defaultAnimation` / `loop`, then the node. The layer ignored the first two before, so a pot's
    per-placement Red / Blue / Green showed as the def's own animation even while playing.

  No game code changed. Measured on the 22:02 publish of `commonoverlayproject`, rendered
  headlessly with `main`'s runtime: each tile's value sits inside its frame, and the rig origins
  and texts land on the doc's positions. Gate: `check:editor-instance-parity`. The old
  resolution and the old setup pose fail 5 of its 35 checks.
- 2026-10-22 — **Visible markers select and delete like key diamonds; double-click deletes a
  visible or text marker; a drag carries a visible marker the whole way** (branch
  `claude/blissful-bohr-4r7uny`). Reported on `commonoverlayproject`: a stray Hide key on a node's
  `↳ visible` row could not be removed, and the owner expected it to work like a diamond. Three
  bugs in the shared Timeline module:
  - a visible marker could not be selected, so Delete had nothing to remove. It now selects on
    click (`selVis`, yellow outline, cleared by any other press in the Timeline and by
    `clearSelection`), Delete removes it ahead of key diamonds, and a click on one clears the
    diamond selection (a selected strip stays, as a diamond click leaves it);
  - double-click deleted nothing: the pointerup ending the first click re-rendered the Timeline,
    so the second click landed on a new marker and the browser sent the dblclick to neither (the
    trap `wireTimeline` documents for strips). A click that moves nothing now leaves the rows
    alone; a text key's click still seeks, moving only the playhead (`positionPlayhead`);
  - a drag moved a visible marker one frame at most: each move looked the key up by the time the
    drag began (the bug Phase 9b fixed for diamonds). The drag now holds the key itself.

  `/rigger` shares the module (`static/shared/timeline.mjs` re-synced, the selected style added to
  `view.html`). Its golden is re-recorded for exactly these changes: the markers' tooltip, the
  "drag a visibility key" step now moving its full 30 px (2.0 → 2.233 s, where it stopped at
  2.1 s), and the dragged marker staying selected; the undo history, panels and inspector match
  the old run at every step. Gate: `tools/rigger-spike/timeline-markers.mjs` drives Chrome's own
  input (`Input.dispatchMouseEvent` / `dispatchKeyEvent`; `chrome.mjs` gains a raw `send`):
  select + Delete, deselect on another click, diamond then marker, a 60 px drag, double-click on
  both marker kinds, and the text-key seek. It fails on the old module. Guide: [Report events,
  visibility and text](../tools/invisible-editor.md#report-events-visibility-and-text).
- 2026-10-22 — **A placed component selects at the art it draws, however deep** (branch
  `claude/awesome-albattani-iltv2z`, ⏳ not browser-verified). The owner's pots on the Hold and Win
  "Pots" screen are Pot Meters whose coded `Pot` part holds the author's own component (a rig and
  its effects). The canvas drew the whole pot, but its selection box stayed a small rect in the
  middle. The box walked an instance's def one level only. A container got its stand-in chip (a
  bound part) or a fixed 160×100 (a group), never what it draws. `nodeBox`
  (`editorCanvas.helpers.ts`) now unions, through one walk (`contentBox`), what each node draws:
  - an instance: its def's content;
  - a group: its children;
  - a skinned coded part: its picked layers, centred (`partSkinArtSize`, the largest), and the
    nodes inside it.

  The runtime's `componentDesignSize` already measured a container this way. A bare coded part
  keeps its chip and an empty group its box. The built-in Jackpot Tile, Respin Counter and Total
  Win Bar select exactly as before. A component that contains itself now stops at the placeholder
  the canvas draws, where `nodeBox` used to restart its depth guard. `isPartSkinned`,
  `partSkinImage` and `partSkinSize` moved from `EditorCanvas` into the helpers, so the canvas
  draws and measures a skin through the same code.

  **Side effect:** a `background`-space instance whose def holds a group or a skinned part covers
  by the corrected box. Its baked `coverBox` re-measures on the next save from the base ratio.
  Gate: `check:component-content-box`. The old walk fails 13 of its 18 checks.
- 2026-10-21 — **Element FX in Properties, the Screen block and Animate** (⏳ not browser-verified):
  state and detail in [FX status](fx.md) 2026-10-21; guide:
  [Element FX](../tools/invisible-editor.md#element-fx--effects-that-play-on-an-element).
- 2026-10-21 — **Animate: keys per screen ratio** (branch `claude/quirky-clarke-jmc9b3`, ⏳ not
  browser-verified). On a ratio other than the base one, a screen timeline's header shows
  **Default keys** + **Key <ratio> separately** (copies the default keys to the ratio:
  `ratioKeyTracks`), or **<ratio> keys** + **Use default keys** (asks, then `withoutRatioKeys`). The
  Timeline module takes `propertyLayout` (rows and new keys follow the ratio's tracks; absent, as in
  `/rigger`, only the default ones), and Properties' value, the key buttons, a stage drag, the
  preview and the onion skin read the keys that ratio plays (`keysLayout`, the game's own choice).
  Switching ratio re-renders the rows and clears the key selection, and a paste of keys copied in
  another ratio lands on the shown ratio's track. A base ratio that somehow has keys of its own
  shows them, as the game plays them. Component timelines show nothing new. Format and game side:
  [cinematic status](cinematic.md) 2026-10-21. Gate: `check:timeline-ratio-keys`. Guide: [Keys per
  screen ratio](../tools/invisible-editor.md#animate-mode--the-timeline).
- 2026-10-21 — **A rig on an anchored canvas screen draws where its box is** (in review, ⏳ not
  browser-verified). The reported `R_Widget` (Hold and Win "Feature intro", canvas space, screen
  anchor 0.5/0.5, x 0, y −15) still drew half a window up-left of its selection box after the
  owner centred its origin in the Rigger. The rig was never the cause. The rig layer placed a rig
  node on a `canvas` screen at its raw x/y, measured from the window's top-left. The selection box,
  the ⊕ and the game (`LayoutNodeView`) fold the screen anchor in through `anchoredPosition`, so they
  measure from the window centre. On a 1920×1080 window that is about 960 px left and 540 px up,
  roughly the "~950 / ~580" the entry below put down to the rig's origin. The layer now places a rig
  node through `placedRigTransform` (`editorCanvas.helpers.ts`): `anchoredPosition` in a `canvas` or
  `standard` screen, the main-box mapping in a `game` one. A `standard` or `game` rig draws where it
  did. No game code changed: the game already drew such a rig at the anchored point. Gate: `check:rig-origin-box`
  rule 7 (the R_Widget node, plus every space). The old raw x/y fails 4 of its checks.
- 2026-10-21 — **Screens panel actions collapse into `＋ Add screen ▾` and `⋯`** (in review). The
  stack of up to ten full-width buttons under the screen list became one row. **＋ Add screen ▾**
  has two groups. **New:** Empty, Background, HUD layer (no-HUD case only), HUD, Bet menu and Auto
  spin screens. **From template:** Add missing screens, Add overlay screens and a **Banner
  screen ▸** submenu, which replaces the `<select>` from #1281. A badge counts the missing and
  overlay screens. **⋯** holds ↻ Reset HUD to default (its confirm unchanged), ⇕ Reserve rows for
  board expansion and ⧉ Save as new game kind…. Every entry keeps its old show/hide condition and
  calls the same handler: this is a UI regroup only, with no data or storage change. The menu is a
  new shared `$lib/MenuButton.svelte`, recorded in `docs/ui-inventory.md` §19. It is keyboard
  driven, `role="menu"`, and portalled with fixed positioning. It was browser-verified (a
  headless harness route over the component: keyboard, submenu, Esc, click-outside and focus
  return); the full `/editor` page was not rendered.
- 2026-10-20 — **A placed rig selects where it draws** (in review, ⏳ not browser-verified). The
  game (`LayoutNodeView` → `<RigProvider>` with no anchor) and the rig overlay put a rig's skeleton
  ORIGIN on its node's x/y, but `nodeBox` centred the rig's Bounds SIZE on that point. A Rigger rig
  built away from its origin (the reported `R_Widget`: art ~950 px left of and ~580 px above it)
  therefore drew in one place and selected in another. Now `EditorRigLayer` reports where the origin
  sits in the rig's box with its natural size (`rigOriginAnchor`, `constants-shared/rig`, from
  `measureRigBounds`), and `nodeBox` frames a placed rig node, and a nested rig bind, around the
  origin by it; the node's anchor no longer moves the box (the game never read it), so Properties and
  the item toolbar drop the anchor field and presets for a rig, and the loading placeholder is
  centred like the unmeasured box; one authored dimension keeps the art's aspect, as `rigSizeScale`
  does; a selected rig draws its origin ⊕. A resize drag or the toolbar's −/+ measures a rig from
  its box centre (`resizePivot`) and moves the origin to hold that centre (`resizeOriginShift`):
  measured from the origin, a handle on an edge the origin sits on did nothing and one past it
  shrank or mirrored the rig. No change to game code, and placed rigs draw where they did; but a
  background component holding an off-centre rig re-bakes its `coverBox` (read by the game) to the
  real extent on the next open, so that cover changes in game once saved. Fix the rig itself with
  the Rigger's new **⊕ Centre origin** ([rigger status](rigger.md)). Gate: `check:rig-origin-box`
  (the old box and the old resize both fail it).
- 2026-10-20 — **Rive plan Phase 9d: shared library, Data tab, Library search, cue / text /
  visibility rows** (branch `claude/rive-p9d-shared-library`, in review, ⏳ not browser-verified;
  the checklist is Open item 0d). Plan: [rive-reference.md](../design/rive-reference.md) §3.2,
  §3.5, §3.7 and §5. UI: [the guide](../tools/invisible-editor.md#shared-timelines-and-starters).
  - **Shared timelines** (`$lib/timeline/sharedTimelines.ts`, `$lib/server/sharedCinematics.ts`,
    `/api/cinematics/shared{,/get,/promote}`). A bar above the Timeline's tracks has **📚 Shared**
    (the library and the starters; **Place** saves a LINK on this screen or component, asking which
    node each shared actor drives), and on an open timeline **Promote to shared** (with
    `componentPublish`; a name already in the library confirms adding the next version), or for a
    link **🔗 name vN**, **Update available (vN)** + **Update**, and **Detach**. A link is
    read-only: a commit that changes its content is put back (`keepLinkedContent`, history
    restarts), and Properties / stage keying is off; its placement (name, Plays on, Also on) stays
    editable. Storage, format and the ship chain: [cinematic status](cinematic.md) Current state.
  - **"Update available" on placed shared components**: an Outline row shows **↑ vN** when a
    shared component instance pins an older version (`componentUpdateAvailable`; Properties'
    existing *Update to latest* does the update). `EditorOutline` gained a `componentMap` prop.
  - **Rows** in the Timeline's track area: **⚡ Report event** (a `signal:` cue at the playhead),
    **👁 Show / Hide** keys (the module's `keyVisibility`), and **text** keys on a text node (Count
    up / Switch, `$lib/timeline/timelineRows.ts`), drawn by the module's new opt-in `textRows`.
    The canvas previews text keys (`previewText` in `valuePreview.client.svelte.ts`, read by
    `EditorTextLayer`; `timelineDrives` now carries a text-only drive).
  - **Data tab** (Components side, `EditorDataPanel.svelte` over `$lib/editor/componentData.ts`):
    read-only inputs (+ the signals not declared as inputs, as triggers), events, params and bound
    values; a bound row selects its node.
  - **Library** (`EditorAssetLibrary.svelte`, `$lib/editor/librarySearch.ts`): a search box (all
    words, case-insensitive; an atlas or sheet also by a loaded region name, whose grid narrows
    too) and a type filter; **Fonts** (`fetchFontCatalog`) and **Audio** (`/api/sounds`, needs the
    `sound` tool) listed read-only.
  - Shared-file hunks (Phase 9c ran in parallel and merged first): `EditorTimelinePanel.svelte` — the row bar
    above the tracks (`.tl-track` / `.tl-rowbar`), the left column's keying block, the save /
    open / close / `changed` hook and new functions; the header's picker is untouched.
    `ComponentWorkspace.svelte` — one Data tab button + its body, `{componentMap}` on the Outline.
    `+page.svelte` — `{componentMap}` on the Outline. `EditorCanvas.svelte` — untouched.
  - Gates: `check:shared-timeline-ship` (42), `check:timeline-rows` (27),
    `check:editor-data-library` (16); `check:component-links` lists the promote as an unpinned
    global write. All in `check:all`.
- 2026-10-20 — **The Timeline panel's picker and ＋ New / Rename / 🗑 are back** (branch
  `claude/timeline-header-picker`). Reported on `commonoverlayproject` right after 9c: the owner
  could not find how to open or create a screen timeline once 9c moved those actions to the
  Animations list at the top of the left column (the list works; it was not where they looked). The
  panel header carries the controls again beside the list, both calling the same panel functions,
  so the panel itself always offers them.
- 2026-10-20 — **Rive plan Phase 9c: Animations list, state machine options, Console** (branch
  `claude/rive-p9c-animations-sm`, in review, ⏳ not browser-verified; checklist in Open item 0c).
  Plan: [rive-reference.md](../design/rive-reference.md) §3.2, §3.6 and §5. UI:
  [the guide](../tools/invisible-editor.md#animate-mode--the-timeline).
  - **Animations list** (`EditorAnimationsList.svelte`, in the left column in Animate on both
    sides). It replaces the Timeline panel's `<select>`. The panel publishes its host's rows and its
    open / create / duplicate / rename / delete through `animationsList.client.svelte.ts`
    (`setAnimationsPanel`, owner-scoped like `setKeyingPanel`), while `listed` (on a component:
    Animate, either tab). Rename and Delete open the row first, so the unsaved-edit guard runs.
    Duplicate copies any row of the host (`duplicateTimeline` in `$lib/timeline/screenTimeline.ts`)
    and saves it create-only. On a component the list ends with a **State machine** row, and timeline
    rows drag (`TIMELINE_DRAG_TYPE`) onto the graph, where the state lands at the drop point
    (`SmFlowProjection.svelte` hands the panel xyflow's `screenToFlowPosition`).
  - The state machine side (format, runtime, panel, Console) is in
    [component-editor status](component-editor.md) Recent changes.
  - Shared files: `+page.svelte` got one import and one `{#if animating}` Animations section above
    Screens. `ComponentWorkspace.svelte` got one import, one Animations section above the left tab
    bar, `listed` on the Timeline panel, and the input handlers on the State machine panel.
    `EditorCanvas.svelte` is untouched.
- 2026-10-20 — **Animate: Rive-style keying (Rive plan Phase 9b, branch `claude/rive-p9b-keying`,
  in review, ⏳ not browser-verified).** Plan: [rive-reference.md](../design/rive-reference.md)
  §3.4–3.5 and §5. UI: [the guide](../tools/invisible-editor.md#animate-mode--the-timeline).
  - **Properties keys.** In Animate the active Timeline panel publishes what the selected node can
    key (`animateKeying.client.svelte.ts`: fields, `key`, `keyStage`), and Properties renders an
    **Animate** section above Transform: each field shows the ANIMATED value (`shownChannelValue`:
    the Design pose with the relative channel folded on; scale stays the multiplier) with a key
    button whose state is `channelKeyState` (none / animated / a key within half a frame of the
    playhead). A typed value keys `relativeChannelValue` of it. The panel's own field column is
    gone (it keeps the rig animation picker). Transform still edits the Design pose.
  - **Stage-drag keying** (`EditorCanvas`, only the drag path and the HUD overlay pass were touched
    — none of 9a's keyboard / zoom / tint code). In Animate with an open timeline
    (`onAnimateTransform`), a drag, corner or rotate runs on the Design pose exactly as in Design so
    the stage follows the pointer; on release every dragged node's gesture fields are put back from
    a snapshot and the change (design px, the scale ratio, degrees) is keyed through
    `stageDragKeys` on top of the current offset, sampled at the snapped key time, one undo step
    per drag. Only fields the gesture changed are put back. While a drag is in flight
    (`setAnimateDragging`) the page holds its autosave and its undo baseline, so neither captures
    the mid-drag pose; an unmount mid-drag puts the pose back and keys nothing. Hit-testing and the
    handles read the drawn (animated) pose in Animate; snapping is off there; a scale drag is
    uniform (one `scale` key); a text node's or Text Box's resize handles do nothing.
  - **Panel.** The module mounts with `interpolation` and `summaryRows`; the header gains the loop
    type, fps, **Onion** (±N, 1–10) and **Only selected**; ▶ plays through `playbackTime`, so it
    loops or ping-pongs like the game; Space toggles it. The Timeline's keys are listed in 9a's
    **Shift+/** sheet (a *Timeline (Animate)* group in `stageShortcuts.ts`) but handled by the
    shared module, which `/rigger` mounts too.
  - **Onion skin.** `onionFrames` (±N frames, nearest first, clipped to the timeline) through
    `setOnionPreview` in `valuePreview.client.svelte.ts`; the canvas outlines each driven top-level
    node per ghost (red before, green after, fading) in `drawOnion`. Editor-only, never saved.
  - Gates: `check:cinematic-ease`, `check:timeline-keying` (in `check:all`); the `/rigger` golden
    re-recorded for its one key-drag step (a fixed bug, [cinematic status](cinematic.md)).
- 2026-10-20 — **Rive plan Phase 9a: hierarchy and stage basics** (in review, ⏳ not yet
  browser-verified). Outline rows have hover **Lock / Isolate / Hide** (Rive's word "Isolate", not
  "solo"), a ▸/▾ fold per container, **drag to reorder and re-parent**, and a right-click menu
  (Copy / Paste / Delete, Lock / Hide / Isolate, *Create component*, *Show in Flow*, all reusing the
  page's own actions). Lock is the node's existing `locked`, and now the stage clicks through it
  (it still selects from the Outline); Lock applies to children. Hide and Isolate are editor view
  state: the host turns them into the ids the stage skips (`effectiveHiddenIds` in
  `$lib/editor/hierarchy.ts`) and hands them to the draw seam (`setViewHidden` in
  `valuePreview.client.svelte.ts`, read by `previewResolveTransform`, so the 2D canvas and the rig,
  text and FX overlays all skip them). Nothing is written into a node, so a saved doc, the bake and
  every game are unchanged. Stage keys (`$lib/editor/stageShortcuts.ts`, one table for the keys and
  the **Shift+/** sheet): `Esc` parent, `Enter` first child, `X` reveal, `F` fit, `⌘0` 100%, `+`/`-`,
  arrow nudge (Shift ×10, Design, top-level nodes), `Tab` Design/Animate. None fire while
  typing, `Enter`/`Tab` only from the page body or the stage (`ownsFocusKeys`, so a focused tile
  or button keeps them), and only the canvas on screen answers (both sides' canvases listen on
  `window`). A drag never moves a locked node, drops into a locked container, or takes a slot /
  bound node off the top level; the open row menu owns Esc (`data-esc-owner`). The canvas bar gained − / zoom % / + / Fit and **?**; Animate tints the stage blue.
  `EditorCanvas.svelte` changes: the canvas bar, `onKeyDown` (+ `applyStageAction`,
  `nudgeSelection`, `zoomAround`, `zoomTo100`), the stage tint, the cheat-sheet overlay, and two
  pick rules (`hitTestNode` skips locked nodes, `visibleSceneNodes` skips view-hidden ones).
  Gates: `check:editor-hierarchy` (walk, reorder/re-parent and refusals, Hide/Isolate ids, the draw
  seam hides while the authored transform stays visible, a source scan that the view state never
  reaches a node) and `check:editor-shortcuts` (the map, the typing guard, the sheet covering the
  map), both in the Lint workflow. Limits: a re-parented node keeps its local x/y; nudge and the
  stage handles reach top-level nodes only, as before.
- 2026-10-17 — **Game Settings → Authored overlays → Free spins and Buttons are switchable.** The
  owner's browser check passed, so both rows are enabled for publishers like Transition and Win,
  and no save path refuses switching them on (the locks are removed). Detail in
  [engine status](engine.md) 2026-10-17.
- 2026-10-16 — **The canvas no longer turns white.** Each rig, text and FX overlay opened its own
  WebGL context, and the editor mounts one per screen, per depth segment and per blend group on
  both sides. The depth split (#1229) multiplied that: a screen whose nested component has an FX
  ahead of other art mounts a full set per segment, so an ordinary project passed the browser's 16
  live contexts. Chrome then drops the OLDEST context and paints its canvas
  opaque white, so the earliest screens (Background, Base game) vanished under a white sheet while
  later ones drew on top. Reproduced with the real layer components in Chromium: 24 screens gave 33
  "Too many active WebGL contexts" warnings and a fully white canvas. Now every rig overlay draws
  through ONE shared raw WebGL context and every text / FX overlay through ONE shared multi-view
  Pixi renderer, each copying its frame into a 2D canvas of its own, which keeps its place in the
  stack and its `mix-blend-mode` (`sharedGl.client.ts`). 72 overlays (24 rig + 24 text + 24 FX)
  drew with no warning, and 6 screens rendered pixel-identical to the old code, before and after a
  pan and with a larger overlay growing the shared canvas. Side effects: text overlays draw on
  demand instead of every frame, FX overlays only while particles play, rig overlays on the hidden
  side pause (no draw, no animation advance, no bone-rider update) until it is shown again, and a
  rig overlay whose shared context is lost reloads its rigs onto a fresh one. Gate: `check:editor-gl-contexts` fails on any other editor file that opens a WebGL context
  or Pixi renderer. ⏳ Owner to confirm in the live editor on the project that went white.
- 2026-10-16 — **Game Settings → Authored overlays → Win is switchable.** The owner accepted the
  Win's two fade-out residues, so the row is enabled for publishers like Transition's and the save
  no longer refuses switching it on (`AUTHORED_WIN_LOCKED` deleted; a non-publisher's flip is
  still `forbidden`). Detail in [engine status](engine.md) 2026-10-16.
- 2026-10-15 — **Authored Win parity follow-up, launcher side** (#1194 follow-up). The status
  rule now also holds a project back when a spins mode's tier caption carries a token, and the
  launcher's tier builder reports each mode's own caption (`authoredWinTiers.ts`); the Win row's
  hint says so. **The Win row stays locked** (`AUTHORED_WIN_LOCKED`): two escalating fade-outs
  still differ in `check:win-parity` — see [engine status](engine.md) 2026-10-15.
- 2026-10-15 — **Game Settings → Authored overlays (pilot) → Free spins** (Rive plan Phase 8c,
  branch `claude/rive-p8c-freespin`): the third checkbox, same capability gate, writing
  `settings.authoredOverlays.freeSpins: true` only when on. Locked off like Win
  (`AUTHORED_FREE_SPINS_LOCKED`: disabled unless already on, "pilot pending"; the save action
  refuses switching it on for everyone with `locked-free-spins`, after the ETag check). The whole
  story in [engine status](engine.md); guide:
  [Game Settings → Authored overlays](../tools/invisible-editor.md#game-settings--authored-overlays-pilot).
- 2026-10-15 — **A placed effect's exposed parameters can be driven** (Invisible FX Step 2): **Bind
  to value** offers **⚡ <parameter>** on an effect node, Animate lists a **⚡** row per parameter,
  and the stage previews both live. Detail in [FX status](fx.md), 2026-10-15 "Step 2".
- 2026-10-14 — **A rig flipped with `scale.x = -1` inside a group or component previews mirrored,
  not upside down** (shared rig layer). Detail in [component editor status](component-editor.md),
  2026-10-14.
- 2026-10-14 — **Game Settings → Authored overlays (pilot) → Win** (Rive plan Phase 8b, branch
  `claude/rive-p8b-win-design`): the second checkbox beside Transition, same capability gate,
  writing `settings.authoredOverlays.win: true` only when on (`normalizeGameSettings` keeps each
  ON row, drops OFF ones; `buildGameSettings()` returns `undefined` only with both off). The save
  action's guard now covers both rows and runs AFTER the ETag check
  (`authoredOverlayGuard.ts` `authoredOverlaySaveDecision`: stale ⇒ 409 whoever saves, fresh +
  flip ⇒ 403 for a non-publisher, else write; one read for a non-publisher, none for a publisher).
  Game Maker chips: *Authored Win (pilot)* and the three held-back warnings, from
  `authoredWinStatus({ doc, tiers })` with the tiers built server-side (`authoredWinTiers.ts`: the
  config's ladder or the coded one, the placed `win` instance's params, the Win Text captions —
  one more R2 read per project with the flag on). `launcher-api` now depends on `engine-game`
  (deep imports of its pure `winPresentation` / `winLevelMap` modules; the index exports Svelte).
  Gates: new `check:authored-win` (119), `check:authored-transition` 85 (two assertions updated to
  the two-row contract), `check:doc-readers-unknown-fields` (the `win` row). Not wired into CI's
  Lint job: `check:authored-transition`, `check:component-timelines` and `check:authored-win` are
  package scripts only — the workflow list is a follow-up. Guide:
  [Game Settings → Authored overlays](../tools/invisible-editor.md#game-settings--authored-overlays-pilot);
  the engine side: [engine status](engine.md). **Locked off until the Win parity follow-up merges**
  (#1194 review): the row is disabled unless already on (_pilot pending — parity follow-up_), and
  the save refuses switching it on for everyone, publishers included (`AUTHORED_WIN_LOCKED`,
  decision `locked`, 403; a publisher's save reads the store only when it submits Win on).
- 2026-10-14 — **The way back from a component to its screen is visible.** After a double-click on
  a placed instance, the only exit that looked like a button was **← All components**, which lands
  on the components home, not on the screen. The breadcrumb's first crumb (the screen's name) did
  go back, but it was drawn as plain grey text. It is now a **← ‹screen›** button
  (`ComponentWorkspace.svelte`, `button.crumb.back`); its behaviour (`exitToScreens`) is unchanged.
- 2026-10-14 — **⌖ Any screen: select an item on another screen by clicking it.** The canvas drew
  every non-hidden screen but hit-tested only the edited one, so a click on another screen's item
  did nothing (or cleared the selection). New canvas-toolbar toggle (off by default, kept per
  project in the editor's UI localStorage): while on, a plain click takes the topmost node under
  the pointer across the drawn screens, stacked as the canvas draws them (HUD screens over game
  screens, later in the list over earlier — the canvas ignores Always on top / Behind the reels,
  so this is the canvas's stacking, not the game's), and a node on another screen switches the
  edited screen and selects it through `onPickInScene` (the page's `pickInScene`); the same press
  drags it. Hover outlines the would-be pick in purple, tagged `Screen › item`. Shift-click stays
  on the edited screen (selections never span screens); the selected node's handles still win
  over anything drawn above it. Off in Animate (a screen switch there saves and closes the
  timeline) and on the Components side (no `onPickInScene`). `EditorCanvas`: `screensTopDown`,
  `hitTestAnyScreen`, `pickAcrossScreens`; `hitTestNode` / `visibleSceneNodes` take a scene. ⏳
  Not browser-verified.
- 2026-10-14 — **`/editor` crashed on every load** (#1190 → fixed in #1195): the lease take-over
  re-arm block read `lease` in an initializer ~1500 lines above `const lease`, so the component
  script threw `Cannot access … before initialization` (the component editor is the same page). The
  block now follows `saveState`. `vite build`, `svelte-check` and `check:undefined-names` all pass
  such a file; the new `pnpm check:svelte-init-order` gate fails it (what it models:
  `docs/status/infra.md`, 2026-10-14).
- 2026-10-14 — **Game Settings → Authored overlays (pilot) → Transition** (Rive plan Phase 8a, branch
  `claude/rive-p8a-transition-overlay`): one checkbox, enabled for `canPublishShared` holders (the
  component-publish capability, admin by default) and shown read-only to others while on — the save
  action refuses a flip from anyone else (`authoredOverlayGuard.ts`) — writing
  `settings.authoredOverlays.transition: true` only when on (`buildGameSettings()` still returns
  `undefined` at the defaults). Guide: [Game Settings → Authored overlays](../tools/invisible-editor.md#game-settings--authored-overlays-pilot);
  the flag's normalizer, chips and runtime: [engine status](engine.md).
- 2026-10-13 — **Listeners + events in the editor (Rive plan Phase 6b, in review).** Components
  side only: Properties gains **Listeners** (per node) and **Component variables → Events**; the
  State machine tab gains **On enter → raise event** and an **Events** log; in Animate the stage
  answers the pointer for the preview (`EditorCanvas` `onStagePointer`, a deep hit-test into
  containers). See [component-editor status](component-editor.md).
- 2026-10-13 — **State Machine tab in Animate (Rive plan Phase 5b, in review).** Components side
  only; see [component-editor status](component-editor.md).
- 2026-10-13 — **Component timelines (Rive plan Phase 4b, in review).** `EditorTimelinePanel.svelte`
  generalised from "the active screen" to a host: a screen, or an open component (`component`
  prop: timelines listed by `componentTimelinesOf`, ids from `componentTimelineId`, Plays on / Also
  on / issues pill). The Components side gets its own Design | Animate toggle; screen-side
  behaviour is unchanged. Authoring: [component-editor status](component-editor.md); runtime and
  access: [cinematic status](cinematic.md).
- 2026-10-13 — **Project-scope hardening (Rive plan Phase 4c).** Session-scoped reads that copy
  content into the project (reference import, flipbook clips, art bounds, the backup list) are
  pinned and guarded; the editor-only routes require `projectKey`; the art-bounds client tells a
  scope mismatch from a conflict and keeps a per-project cache; `check:component-links` enumerates
  `$lib` writes too and no longer trusts comments or misses prebuilt `RequestInit`s;
  `check:launcher-gates` sees `body?.projectKey` / `(body as …).projectKey`; new behavioural gate
  `check:editor-write-scope`.
- 2026-10-13 — **Components side (Rive plan Phase 4a).** `/components` folded into `/editor`:
  `ComponentWorkspace.svelte` (moved from `components/+page.svelte`) mounts beside the Screens
  side; a left-pane Components section; double-click / **◇ Edit component in place** / **◇ Edit as
  component** open a def in place with a breadcrumb and Esc-up navigation, capped at the game's
  nesting depth; URLs `/editor?view=components` and `?component=<id>`; `/components` is a 307
  redirect; the `componentEditor` card now opens `/editor?view=components`. Animate mode stays
  screens-only (component timelines = Phase 4b). New gate `check:component-links` (68 checks).
  Review fix: same-route `/editor` links keep their project (tool bar links carry `?project=`,
  `beforeNavigate` applies the same project in place and reloads for any other), so a card click
  after another tab switched project can no longer save one project's layout into another; every
  write is pinned to the loaded project (also from a bookmarked bare `/editor`), drift blocks saves,
  and created / refreshed components keep their ETag.
  Authoring detail: [component-editor status](component-editor.md).
- 2026-10-13 — **Animate mode (Rive plan Phase 3).** Design | Animate toggle; the Timeline panel
  animates the active screen's nodes; the canvas previews with the game's maths; Flow's
  `playCinematic` plays the result. Editor-only users can reach screen timelines (server-gated).
  Design mode is untouched: every change is behind `animate` / the preview map, both off outside
  Animate. See [cinematic status](cinematic.md) for the gates.
- 2026-10-13 — **Owner decisions for the Rive-style editor (Phase 0, docs only).** `/components` merges
  into `/editor` (Phase 4); the shared timeline is called **Timeline** in the UI; the Phase 3 proof is a
  screen intro played by Flow's `playCinematic`. Plan: [rive-style-editor](../design/rive-style-editor.md) §12.
- 2026-10-08 — **A HUD Readout's selection box follows its background image.** The selection
  outline, resize handles and hit-test still used the coded 326:73 tile box after the draw switched
  to `aspectBox`, so a custom background of another ratio sat outside its outline. `nodeBox` now takes
  the enclosing instance's resolved params (per-ratio overrides included, as the draw resolves them;
  the Component Editor's open-def params for a top-level part) and sizes any bind part with a
  catalog `tileImage` binding by `aspectBox` over the picked frame's natural size and the instance's
  width/height, the same box the draw uses. No image picked, or a frame still loading with no
  override, keeps the coded tile box (parity). Nested Text Box `paramBindings` in the instance box now
  also read the per-ratio params the draw uses. The `hudReadout` def is unchanged. Not
  browser-verified.
- 2026-10-08 — **A sprite can keep its image ratio; dead part params are hidden.** Reported after
  #1142: a project HUD Readout whose Background part was replaced by a sprite (`UI_0005_WidgetBig`,
  frame exposed per instance) stretched every picked frame to the sprite's fixed box, and its
  **Background → image** did nothing. New sprite field `keepAspect` (**Keep image ratio** in the
  Sprite section): the frame fits inside width × height (pixi-svelte `<Sprite contain>` in the
  game, `keepAspectTransform` in the editor). Unset ⇒ stretch, so every existing game is
  unchanged. New `engine-layout` `unusedPartParamKeys(root)`: params only a coded part the def no
  longer contains would read are left out of the instance panel and the Component Editor's game
  defaults. Not browser-verified.
- 2026-10-08 — **A HUD Readout's background image keeps its own shape.** Reported: a custom
  background with a different ratio was stretched to the coded 326:73 ticker box on the instance.
  The editor preview always fell back to that box. New `engine-layout` `aspectBox`, used by the
  editor preview and the game's `HudTicker`: both size fields blank ⇒ the image's own size, one
  set ⇒ the other follows the image's ratio, both set ⇒ that exact box. The coded tile with no
  image keeps its coded box (parity). The `hudReadout` def is unchanged (no republish). Not
  browser-verified.
- 2026-10-08 — **The Book-of set loads into a lines project as lines** ([book-feature.md](../design/book-feature.md)
  Phase 5c). `engine-layout`'s `referenceLoadsAs(setKind, projectKind)`: a set that is a reference
  for the project's kind (`bookOf` declares `referenceFor: ['lines']`) loads as the project's own
  layout, so **＋ Load scenes…** → New Book of / Import composed reference → Book of in a lines project
  is no longer a cross-type preview (it autosaves, and keeps the lines `gameType`). A Book-of project
  importing it, or anything else, behaves as before. Gate: `check:project-scaffold`. Not
  browser-verified.
- 2026-10-07 — **In-game view shows a game mode the way it shows the base game.** Reported: Hold
  and Win screens appeared only while one of them was selected, then vanished on clicking a base
  screen (the base game, Jackpot bar, Pots, HUD), so the feature could not be laid out against the
  rest of the screen. The view keyed the mode off the SELECTED screen; it now takes the mode on
  screen. A **mode menu** beside 🎮 In-game view (Base game / each mode the doc has screens for,
  named from Game Config, `resolveGameModes`) keeps that mode's non-beat screens on the canvas
  whichever screen is edited. Selecting a mode screen switches the menu to its mode; a pick holds
  until then and is kept with the UI layout (`viewMode`). Beat screens (intro, outro, wheel,
  jackpot win) still draw only while edited. `engine-layout` `inGameViewSceneIds(scenes, active,
  mode)` + `viewableModeIds`; `test-resting-scenes.mjs` pins it (the old code fails "editing
  basegame: respinBoard shows"). ⏳ Type-checked and unit-tested, not browser-verified (no
  launcher login in the session).
- 2026-10-05 — **Invisible Director can drive this tool.** Invisible Director's `scene.get_layout` /
  `scene.update_nodes` (`apps/launcher-api/src/lib/server/director/ops/scene.ts`) save through
  `editorStorage.saveDoc`, under `If-Match`, stamping `saved_by` (`tool: 'director'`, the agent, the
  run). It moves and re-skins existing nodes only (a project with no layout, an unknown screen or
  node is refused), and refuses any node locked in the editor or bound to the math: the reel grid, a
  repeater, a bet/buy/feature binding on the node (per-layout override params included), a parent, a
  child or its component def (read at the version the node pins), and anything on the bet-menu,
  buy-feature, buy-confirm or mode screens, found by role or by their legacy id as the runtime finds
  them. A def it cannot read is refused, not trusted. A save without a stamp drops a carried one
  (`savedBy.ts`). The page is unchanged.
- 2026-10-02 — **A param can name a component** (Hold and Win 12c, #1006). A `component`-kind param
  (the Letters Strip's `tile`) is a select of the project's components in Properties, minus the
  instance's own. Detail: [hold-and-win](hold-and-win.md).
- 2026-10-02 — **Swap a placed instance's component** (Hold and Win 12c, #1006). A **component**
  select in an instance's Properties switches the def it draws. It keeps the placement and params,
  and drops the version pin. Example: a Pot Meter to the game's Pot copy. Detail:
  [hold-and-win](hold-and-win.md).

- 2026-10-03 — **rig param dropdowns follow the active ratio.** With the canvas on a ratio whose
  override swaps a placed component's rig, a `spineAnimation` / `spineSlot` / `spineBone` param
  field still listed the BASE rig's names (`primaryRigBundle` / `effectiveRigBundle` read
  `node.params` only), though its value saves into that ratio's override. They now read
  `instanceParamValue`, the ratio-aware value the param fields already show. The "rig (this
  placement)" fields deliberately stay on the base rig (`instanceRigBoundName`): what they write
  (`spineRestOverrides` / `stateAnimationOverrides`) is per-node and plays in every ratio.
  `scripts/verify-editor-ratio-rig-params.mjs` runs the real resolvers sliced from
  `EditorProperties.svelte`.
- 2026-10-03 — **Art picked in a per-ratio instance override ships** (rule 8). `collectArtRefs`
  (`editorArtExport.ts`) classified only an instance's base `params` by param kind, never
  `overrides[layoutType].params`, which the runtime applies per ratio
  (`resolveLayoutInstanceParams`). A portrait-only `image` pick (the HUD Readout's
  `backgroundImage`; the Hold and Win Phase 12c skins add more) looked right in the editor and
  rendered blank in the portrait game unless another node used the same sheet; a `spine` pick
  shipped no bundle. The export and the ship-path atlas-ref repair (`atlasRefRepair.ts`, which had
  the same blind spot and left a legacy ref in an override unpinned) now walk
  `instanceParamMaps(node)` (`engine-layout/componentParams.ts`), so the Scene Editor's art scope
  sees it too. A pinned instance's params are now classified by its pinned def's kinds, not
  latest's. `check:art-scope` part 6 runs the real `exportEditorArt` and `isProjectArtAllowed`
  over an in-memory R2 and proves all of it.
- 2026-10-02 — **Bind to value** (Hold and Win Phase 12b): the shared Properties panel gains a
  *Bind to value* section (a number drives a node's transform, visibility, fill, clip frame, rig
  scrub or bone), and a test-value scrub previews it on the canvas and the text / rig / effect
  overlays. `nodeTransform` / `childLocalTransform` take an optional resolver; only the draw paths
  pass the preview's, so drags, hit-tests and selection keep the authored transform. Detail:
  [hold-and-win](hold-and-win.md).
- 2026-10-02 — **Measured: no project is broken by an old shared-def pin.** No live doc or
  published snapshot pins `featurecard` (the card arrives at latest). `c_kzdbwen7@11` is pinned by
  `test2`, `test6` and `bookofborutremake`, and its node does still carry Borut's full rig prefix,
  but the node binds `assetKey` to the `rspinbuttonnewRig` param (non-empty default), so the static
  prefix is unreachable (`staticRigKeyIsReachable`), and every instance sets that param to the
  project's own rig (`R_spinbutton` in test2, `R_Plus`/`R_Minus`/… in test6), which their
  published snapshots ship with no stranded-rig warning. The open item that said otherwise is
  withdrawn.

- 2026-10-02 — **The shared `featureCard` and spin button draw their rig + font in every
  project.** The open item "cross-project rig/font/flipbook the editor cannot preview" was
  mis-framed: unlike an atlas (which the export copies in), the EXPORT does not ship another
  project's rig, font or clip either, so a preview allowance would have shown art that never ships
  (rule 8). Measured on R2: no shared def names a flipbook clip; the latest `featurecard` names rig
  `R_BuyBonus` + bitmap font `Tungsten-Bold`, and `c_kzdbwen7` (spin button) names
  `R_SpinButtonNew` — all owned only by `bookofborutremake`, so every other project drew them
  missing in the editor AND the game. Fix = put the art in the shared library, which both chains
  already fall back to: the two bundles promoted to `_shared/spines/` and the font to
  `_shared/fonts/` (+ the library's first `fonts.json`). Two code changes make that land:
  **fonts** — a project's renderable fonts are now its catalog MERGED with the library
  (`loadRenderableFonts`, project wins by id/folder) in the editor, Symbols and the export; before,
  the library was read only by a project with NO catalog, the rig bug `loadSkeletonIndexWithShared`
  fixed. The Font Maker keeps its project-else-library catalog (where its writes/deletes land).
  **promote** — `/admin` → promote rig no longer copies `source.json`, which re-linked the
  "snapshot" to the authoring project's sheet (a re-pack there would rewrite the shared copy).
  Fixtures: `check:renderable-fonts`, `check:shared-rig-promote` (mutant-checked). A project picks
  the art up on its next export / publish.

- 2026-10-02 — **A manifest's own fields read R2 only inside its own project (#990 review
  follow-up).** `loadRegionSet` drove R2 reads off author-writable manifest fields with no scope:
  `resolvePageKey` existence-probed `source_image_path` / `export_prefix` candidates and the
  stale-deploy guard HEADed `source_image_path` (a planted manifest could learn whether ANY key
  exists), and `backfillMissingGeometry` read `texturepacker_json` verbatim. Every such read is now
  held to the manifest key's own `<client>/<project>/` (`manifestHome` / `ownedByManifest` in
  `editorRegions.ts`; `_shared/sheets/` for a library sheet, which has no `deploy/`). The page is
  also resolved in the MANIFEST's project, not the caller's: a legacy atlas borrowed from a sibling
  project lost its page, or showed the caller's same-stem deployed page under the other project's
  rects. `loadRegionSet(sheet)` therefore no longer takes the caller's client/project. Nit:
  `candidateAtlases` refuses `_`-rooted keys, so a client slugging to `_shared` can't claim the
  library. `check:art-scope` now runs the real `loadRegionSet` over an in-memory R2 that records
  every key touched (a mutant with the guard off fails 8 cases).

- 2026-10-02 — **Art scope hotfix (#987 follow-up, security).** An atlas PAGE is built from the
  manifest's own fields (`resolvePageKey`), which anyone who can write that project can set: an
  author could plant `<own project>/manifests/atlas_manifest_x.json` whose page named ANY file of
  another project in the client (e.g. its `editor/scenes.json`) and stream it through
  `/api/editor/asset`. A page is now trusted only inside its manifest's own project and only as an
  image (`pageAllowed`), and a manifest only at the producer path
  `<client>/<project>/manifests/atlas_manifest_*.json`. A failed scope rebuild keeps the last good
  scope instead of emptying it. Fixture cases for the planted page.

- 2026-10-02 — **The editor draws art a shared component def brings from another project.** The
  shared `hudReadout` def's frame lives in `invisible_wall/test6`'s `S_UI` atlas and `featureCard`'s
  in `bookofborutremake`'s `S_Game_UI2`, so every project placing them — new or old — drew grey
  "UI_0005_WidgetBig" placeholders: `/api/editor/regions` and `/api/editor/asset` read only the
  project's own prefix + the shared library and 403'd those sheets (the game was fine — the export
  copies them into the project). Both gates now also allow the ATLASES the project's doc and its
  resolved component defs reference (`projectArtScope.ts`, built on the export's own walk,
  `referencedArtRefs`) — only keys shaped like `…/manifests/atlas_manifest_*.json` that load as a
  region set, plus that atlas's page; never an arbitrary `.json`, image or folder a doc names. Held
  to the project's own client, and off for the shared `unassigned` pseudo-client and the default
  project. A scope that cannot be built refuses (403) and is remembered; cached 60 s, re-checked
  at most every 10 s before a refusal so freshly bound art is not refused for long.
  `check:art-scope`. Verified against R2 for `hw-3pots-sample`: `test6`'s `S_UI` + its page and
  `S_Game_UI2` allowed; an unreferenced atlas and another project's `editor/scenes.json` refused.
- 2026-10-02 — **Respin Cell Tiles preview:** selecting a `respinCells` instance draws every reel
  cell as an empty respin cell with the tile (tint, gap) over it (`drawRespinCellTilesPreview`), since
  the respin board exists only in the game.

Lessons that recur in this tool, each paid for at least once below: **a new doc field must be added
to its server whitelist** (`normalizeScene`, `normalizeAlign`, `normalizeGameSettings`,
`componentStorage`'s `PARAM_KINDS`, the node-kind set — an unlisted field renders locally and is
silently dropped on save); **the launcher `vite build` is not a type-check** (run `svelte-check`);
**"shows in the editor" ≠ "ships"** (check the export walks the new reference).

- 2026-10-02 — **The editor follows the PROJECT's game kind, not the layout's.** Reported on
  `hw-3pots-sample` after #972: no Pots screen offered, no Pot Meter in the Components list. Its
  layout was loaded from the lines reference, so `doc.gameType` is `lines`. The client took
  `projectGameType` from `doc.gameType` first, so the kind-gated surfaces (Components palette
  `componentOfferedForKind`, **Add missing screens** `getFullSceneSet`, the Properties symbol
  states, the cross-type load warning) all behaved as lines on a Hold and Win project. Every
  other tool (`/config`, `/symbols`, `/win-text`, the mock, publish) already follows the stored
  project kind. The load now returns `projectKind` (`storedProjectGameType`, `null` for a legacy row
  with none) and the client prefers it. A legacy project with no stored kind keeps the old order
  (doc, then template). Server-side template, slot and config resolution still read `doc.gameType`
  first (unchanged). ⏳ Not browser-verified.
- 2026-10-01 — **In-game view: the canvas draws what the idle game shows.** Reported on
  `hw-3pots-sample`: every screen drew at once (buy cards, confirm dialog, bet menu over the
  board), with labelled "Panel" / "rig: Rig" / "Button ribbon" boxes for Feature Card parts
  that have no art picked. A canvas-toolbar toggle **🎮 In-game view** (on by default, kept per
  project in the editor's UI localStorage) now draws only the screens at rest
  (`engine-layout` `isShownAtRest` / `inGameViewSceneIds`): it drops the transient ids `Game.svelte`
  mounts only for a moment (loading, win visual, free-spin intro/outro/counter, special book,
  Hold and Win beat screens, buy feature/confirm, round confirm, bet menu, auto spin), the
  transient roles (incl. every `mode` screen) and `visibleSource`-gated screens. The edited screen
  is always added. For a mode screen, its mode's non-beat screens are added too. The Screens list
  italicises what it leaves off. In the same view, a NESTED sprite/rig with no art bound
  (empty region and key, or an empty bound rig key) draws nothing instead of its placeholder,
  as in the game. The Component Editor does not pass the prop, so it keeps its placeholders.
  `test-resting-scenes.mjs` pins the at-rest set per kind.
  - **Add missing screens** also fixed: it matched by ROLE, and every Hold and Win feature screen
    shares `role: 'mode'`. So once any mode screen existed, the rest counted as present and were
    never offered. `mode` now matches by id only. Added screens are inserted after their
    predecessor in the kind's own set, not appended (appending put Pots above the HUD).
  - ⏳ Not browser-verified (no launcher login in the session). The placeholders on the HUD
    readouts (`UI_0005_WidgetBig`) and the buy button (the `R_BuyBonus` rig) are a different thing:
    those are real art references the canvas failed to load. They are not diagnosed — the doc and
    R2 were not readable from the session.
- 2026-10-01 — **Hold and Win kind** (#951): "New game from kind → holdAndWin" now scaffolds the real Hold and Win screen set (jackpot bar, pots, the `holdAndWin` mode screens, the base-game message host — see [hold-and-win status](hold-and-win.md)), and the Library's **Components** list is filtered by the project's kind (`componentOfferedForKind`): the seven Hold and Win components appear only in a Hold and Win project. Palette only — a placed instance always renders. Other kinds' scene sets are hash-pinned unchanged (`test-hold-and-win-template.mjs`).
- 2026-09-29 — **Docs caught up with the code**: new screens have mounted in the game in list order since the generic-mount work (the old open item said otherwise); `reelGrid.symbolSizeRatios` is long gone (symbols are sized by their art); the guide's pane layout matches the 2026-08-11 shell. `EDITOR_DOC_SECRET` is set; rotation is the owner item.
- 2026-09-29 — **History… uses the shared version-history modal** (#859, live `4f32e773`). The
  backup list moved off the `askText` prompt onto `$lib/DocHistoryModal.svelte`, the picker
  `/flow-v2`, `/symbols`, `/config` and `/components` use (#847/#857). Same `/api/editor/backups`
  API; restore sends this tab's ETag (stale ⇒ 409 in the modal), cancels the pending autosave,
  is refused while a save is in flight, and re-arms autosave if it fails.
- 2026-09-23 — **The bet menu and the auto-spin menu are screens you build here.** Two Screens
  buttons seed the engine defaults (`hudMenuScenes.ts`) tagged with the new `betMenu` / `autoSpin`
  roles (a second press selects the existing one). The role list was hand-copied into three places
  (dropdown, `setSceneRole`, `normalizeScene`'s whitelist) and now derives from one
  `SCENE_ROLE_LABELS`, typed `Record<SceneRole, string>` so a new role is a compile error until
  listed. A repeater's data source is a dropdown (`REPEATER_SOURCE_CATALOG`, custom sources kept);
  a new built-in `optionCard` ("Option Tile") is what a repeater stamps; new Action keys `betMenu`
  / `autoSpinStart` / `close` and four auto-spin readout sources. Engine half in [flow.md](flow.md).
  ⏳ Editor half not browser-verified.
- 2026-09-17 — **The canvas previews instances through the project's component DEFAULTS sidecar.**
  No editor call site supplied `resolveComponentParams`' third layer, so a shared def previewed
  with its own values while the game rendered the project's. `/editor` now loads
  `listComponentDefaults` and threads it into every instance resolve (rig readiness, drawing,
  repeaters, selection box, text/rig layers). No sidecar ⇒ `{}` ⇒ parity.
- 2026-09-17 — **A `standard` screen can be pinned to the TOP of the window.** `top` had never been
  written for the v-axis. Five surfaces learned it; the trap is `normalizeAlign` in
  `editorStorage.ts`, without which `top` renders locally and is dropped on save. `MainContainer`'s
  `getY()` keeps its exact `bottom`/centred expressions (75/75 offline parity assertions). Runtime
  released (`faa176ed`). ⏳ Save round-trip not browser-verified.
- 2026-09-16 → 09-18 — **Blend modes on placed art, and the four traps that took three releases.**
  `BaseNode.blendMode` + per-layoutType override, one definition in `engine-layout/blendMode.ts`
  with a reader per surface (Pixi / Canvas2D / CSS). The editor blends on the ELEMENT: one canvas
  per consecutive blend run carrying CSS `mix-blend-mode`, `.wrap` isolated, scene groups without
  `z-index` (blending inside a transparent surface, or across a stacking context, is a no-op).
  Traps, each now guarded by `check:symbol-layers`:
  (1) **rig can't blend** — `RigPipe` batches slots with their own blend, so the control is
  withheld via `BLENDABLE_KINDS`/`canBlendKind()` (per-slot blend lives in the Rigger);
  (2) **`overlay`/`lighten` are backdrop-reading filters** — they need our registration AND
  `useBackBuffer: true` in `app.init()`, or `FilterSystem` skips them silently (Pixi logs a warning);
  (3) **Pixi's stock advanced filters treat premultiplied colour as straight**, so partial alpha
  blended much weaker than the editor — we register corrected filters
  (`pixi-svelte/src/lib/advancedBlendModes.ts`) before the `Application` is built, and every
  advanced mode the editor offers must have one;
  (4) **filter vs backdrop resolution** — on a 150%-scaled display the power-of-two roundings
  diverged and the blend covered 75% of the node with a hard seam; fixed by `resolution: 'inherit'`.
  Method: read back a PIXEL against the `normal` baseline, and sweep `resolution`; a filter being
  assigned proves nothing. Owner-confirmed live in `/editor` 2026-09-17.
- 2026-09-16 — **A correctly deployed atlas was served as the OLD art in `/editor`, `/symbols` and
  `/flipbook`.** The 2026-07-14 guard rejected a deployed page whenever the manifest was newer, and
  fell back to an older source page of a different size. A manifest mtime is not evidence the
  geometry changed. `deployedPage.ts isDeployedPageStale` now rejects the deploy only when the
  SOURCE page is also newer than it (`check:deployed-page`, 16 assertions, mutation-verified; the
  reasoning is in the doc comment). Deployed `ed7bf11a`.
- 2026-09-14 — **Background cover: per-axis fit, alignment, per-layout overrides.** `fit` gained
  `width`/`height`; the anchor now slides the fitted art within the overflow (CSS `object-position`
  semantics, one formula in `coverTransform`); `NodeOverride` carries `fit` + `coverScale`, which
  also fixed `backgroundCoverStretch` ignoring a per-ratio stretch. The componentInstance cover is
  threaded inside `coverBoxTransform` so the editor-baked `coverBox` path aligns identically;
  `tools/bg-scene-spike/coverBox.ts` guards the pair. Released `6e59e0fe` (#659), measured parity.
- 2026-09-14 — **Flipbook nodes get "Plays on signal" (a cue picks a clip), rebindable per
  placement** via a **Flipbook (this placement)** panel. The cue's loop is a tri-state select
  (inherit / loop / once) — a checkbox would make "inherit" unreachable. No "fire on complete":
  `<Flipbook>` has no completion hook. ⏳ Not browser-verified.
- 2026-09-09 — **"Plays on signal" renders in the Scene Editor.** The cue block was gated on
  `componentSignals.length > 0`, which `/editor` never passes, so it was dead here. Gate widened
  by `componentMode`: free-text signal in `/editor` (matched on the open component-signal bus, the
  same name a Flow **Fire Cue** broadcasts), declared-signal dropdown in `/components`.
- 2026-09-08 — **Symbol overflow X/Y on the reel grid.** Grows the board's clip only (no cell or
  seat moves); spent whenever nothing is travelling, so Land/Win/Explosion/Intro may spill while
  the roll and a cascade's fall stay clipped. Stepped boards grow at outer edges only. Pinned by
  `scripts/verify-symbol-overflow.mjs`. Engine detail in [engine.md](engine.md).
- 2026-09-08 — **A background screen frames the same overlay in game as in the editor.** The two
  surfaces measured a background `componentInstance`'s cover box differently (the runtime skipped
  rig/text/clip children). The editor now bakes the union it previewed into `node.coverBox`
  (per instance, base bucket only), read first by `LayoutNodeView`. A non-cover node on a
  background screen now uses the shared `anchoredPosition`. By design, cover targets the live
  window in game and the bucket in the editor. Guarded by `tools/bg-scene-spike/coverBox.ts`.
- 2026-09-03 — **The rig preview loader uses ONE runtime (4.2), loaded once**, captured at load.
  Per-line loading let two runtimes race for `window.invisibleRig` (`physics is undefined`, blank cells).
  The 4.1 built-ins pose under 4.2 (`scripts/check-builtin-rigs.mjs`).
- 2026-09-02 — **Reel-cell rig previews fit the rig's box where its header puts it**
  (`measureRigBounds` via `authoredRigBox`), matching `<RigProvider centreBox>`.
- 2026-09-02 — **The instance-param panel shows the value the game RUNS**, including a def's
  `defaultInstanceParams` seed (`instanceParamEffective`). The raw read drew "On loaded" unchecked
  while the game ran it.
- 2026-09-01 — **A HUD Readout's background is per-instance art** — a Background param group
  (image/tint/width/height) drawn by `HudTicker` from the same param context; the editor reads it
  through a data-driven `TileImageBinding` catalog entry. The stand-in chip uses the real
  `HUD_TILE_WIDTH`/`HEIGHT`.
- 2026-08-28 — **Art bounds for sprite regions** — a per-`<assetKey>::<region>` box stored in its
  own doc (`editor/art-bounds.json`, not the manifest: a packer rewrites manifests, and changing a
  region's trim there re-bases every frozen `.irig` mesh). Ships as trim folded into the exported
  TexturePacker JSON, so no new asset class. One box implementation (`applyClipBounds`) and one
  fit helper (`$lib/boundsFit.ts`); the overlay must share an exactly-sized wrapper with the
  thumbnail or its drag drifts by the stage border.
- 2026-08-27 — **Flipbook-bound symbols draw on the board** (they fell to the amber marker: the
  cell's `assetKey` is the clip's sheet, not a frame). A symbol-kind union widened in
  `symbolsStorage` has to be walked to every surface that switches on it.
- 2026-08-25 — **The Library gained a Flipbooks section.** The doc normalizer's node-kind set now
  derives from `engine-layout`'s `LAYOUT_NODE_KINDS`; a kind missing from it is drawn, then erased
  on save (`pnpm --filter flipbook-spike run scene-node`).
- 2026-08-21 — **A `_shared/spines/` bundle previewed and shipped nothing.** `editorArtExport` read
  the shared skeleton index only for projects with no index of their own; it now uses
  `loadSkeletonIndexWithShared()`. The shared tier carries the engine's 29 rig bundles, one per
  skeleton ([guide](../tools/invisible-editor.md#the-shared-rig-library)).
- 2026-08-21 — **Perspective board.** "Perspective (advanced)" is SHAPE only (`farScale`,
  `vanishX`); roll-vs-swap behaviour moved to Game Config → Reel behaviour because a `reelGrid` is
  authored per layoutType. `reelGridGeometry()` is the one definition both canvas layers read,
  asserted seat-for-seat against the game (`scripts/verify-reel-grid-geometry.mjs`).
- 2026-08-20 — **`ways` is a first-class kind** — `standardTemplate(gameType)` backs `lines`/`ways`
  and `defaultLayout('ways')` is a filled reference (the two games ship byte-identical frame art;
  ways drops `specialBook`). Lines parity: `pnpm --filter bg-scene-spike run waysreference`.
- 2026-08-20 — **Per-project boot splash** (`GameSettings.bootLoader`); `normalizeGameSettings` is a
  strict whitelist. Detail in [engine.md](engine.md).
- 2026-08-18 — **Board rig symbols draw on the canvas** through the WebGL layer, contain-fit to
  the seat; `measureRigBounds` moved to `editorRig.client.ts`. Verified live.
- 2026-08-17 — **Auto-fit works on a width-only box**, and the text-box params
  (`TEXT_BOX_LAYOUT_*`) are shared by Text Box and Info Bar; `mergeBuiltinCodedParams` retrofits
  saved defs. `isTextBoxInstance` requires a text-only def. Released `4a17ed6a` (#329).
- 2026-08-11 — **Shell re-layout**: left = Screens tree with inline outline, right = tabbed
  Properties | Library | Template, action row under the top bar; the canvas top row
  (`.canvas-top`, `z-index:2000`) holds the device bar and actions and wraps instead of overlapping.
- 2026-08-10 — **Per-ratio TEXT STYLE and COMPONENT PARAMS** — `NodeOverride.style` / `.params`,
  merged by `resolveOverrideTextStyle` / `resolveLayoutInstanceParams` on both surfaces;
  structural params stay base-only. Needs a runtime publish to render.
- 2026-07-31 — **Text box model** (`engine-layout/textBoxLayout.ts`): a `width` makes text wrap and
  align inside a box, resize handles change the box (never `scale`), `autoFit` shrinks the font; a
  Text Box component instance's drag writes `boxWidth`/`boxHeight`. `mergeBuiltinCodedParams` also
  unions `paramBindings`, or a frozen saved def shows new params wired to nothing.
- 2026-07-28 — **Coded builtin rigs get animation/slot/bone dropdowns** from the generated
  `builtinRigMeta.generated.ts` (`scripts/gen-builtin-rigs.mjs`, pre-commit `--check`).
- 2026-07-23 — **A rig referenced by a component `spine`-kind PARAM ships** (`collectArtRefs`
  walked only placed rig nodes) and its animation dropdowns populate
  (`instancePreviewRigBundle`).
- 2026-07-20 — **Built-in UI regions resolve everywhere** via `engine-layout/builtinRegions.ts` and
  the launcher's vendored `static/builtin/sheets/`; the dangling-region export warning no longer
  flags engine-shipped art.
- 2026-07-17 — **`screenAnchor` is canvas-space only** — one shared `anchoredPosition` for runtime
  and both editor surfaces (there were three copies, which is how they drifted). Also:
  `freeSpinsRemaining`/`freeSpinsCurrent` readouts (count down or up), an unset boolean param shows
  its default, and `COMPONENT_PARAM_KINDS` / `SYMBOL_STATES` each have one home.
- 2026-07-16 — **Layering** — `Scene.behindReels` (band -500, under the board), `Scene.alwaysOnTop`
  (pinned band), and one resolver `sceneLayerZIndex` for every mount path. `LayoutDoc` v1→v2 with
  an idempotent backfill that pins the splash / legacy celebration screens. Band map low→high:
  authored bg (-1000) → coded bg (-900) → behind-reels (-500+i) → board (0) → list (100+i) →
  pinned (9000+i) → engine gates (10000). Also: authorable `boardGlow` scene.
- 2026-07-16 — **Autosave no longer clobbers a concurrent author** (Phase 1 of
  [multi-user-concurrency](../design/multi-user-concurrency.md)) — verified live with two tabs.
- 2026-07-15 — HUD Readout per-text style and align params; `markDirty()` bumps
  `canvasRedrawNonce` because the redraw effects track a field whitelist + the nonce only.
- Before 2026-07-15 — see [history](../history.md) (FX preview, reel-grid knobs, cover-fit, the
  removal of "Shows during").
