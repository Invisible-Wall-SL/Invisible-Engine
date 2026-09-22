# Invisible Sheet Maker — status

> Design: [docs/design/atlas-per-user-session.md](../design/atlas-per-user-session.md) · Guide: [docs/tools/sheet-maker.md](../tools/sheet-maker.md) · Agent: `.claude/agents/atlas-python-tools.md`

**One-line state:** Live on Railway (`sheet-tool`, R2-backed, CPU-only). Project-file workflow + FX picker + atlas round-trip shipped; some flows still owner-live-verify owed.

## Current state
Works today on `main` / live:
- Pack loose sprite PNGs into one packed sheet, name each region, edit per-region **AI fields**, and export **libGDX/Spine `.atlas`**, **TexturePacker JSON**, and the **Invisible AI manifest** — the manifest is handed to the Atlas Maker over R2 (needs an Atlas Maker restart to appear). Pure Pillow/CPU; no ComfyUI.
- **Project-file workflow (B19)** — Sheets rail with Load / Refresh / Reset, plus **Save / Save As** and blank/duplicate-name guards.
- **New sheet names itself first** — `New sheet…` opens a name dialog before clearing anything; a name already in the rail is flagged live and confirmed on Create, and **Save As** asks before replacing an existing sheet of the same name (the server writes whatever name it is given).
- **Region + sheet rename** — renaming a sheet moves **all** its R2 objects (`sheets/`, `sheet_src/`, `manifests/`) and rewrites the manifest's internal back-refs + every region `shape_ref`, then deletes the old keys; refuses to overwrite an existing target.
- **Delete-verifies-R2** — delete re-lists R2 and fails loud rather than trusting local staging. It
  clears and verifies **every tree the sheet owns alone** — `sheets/`, `sheet_src/`, and the Atlas
  Maker's slice mirror `input/refs/atlasslices/<sheet>/` — plus both manifest spellings, asks with
  the strict `storage.head` (never `exists`, which reads a throttle as absence), and refuses when
  the check cannot be COMPLETED: unverifiable is not verified-clean. `input/refs/useroutput_<region>.png`
  is deliberately left alone — it is keyed by REGION name and shared across the project, so deleting
  it would blank a surviving sheet. `deploy/` is a build artifact and self-heals on the next Export
  Symbols; the delete note says so when a deployed copy is still standing.
- **FX-layer picker** — per-sprite checkboxes (`shine`/`glow`/`shadow`/`blur`/`zoom`/`colour`) spawn same-size sibling cells named for the Atlas Maker's FX convention, slaved to the base (cascade rename/resize/delete); export propagates each cell's `mode` so the Atlas Maker opens it in the matching local-FX mode.
- **Verbatim `.plist` import** — `POST /api/import-plist` (Import tab) takes a cocos2d
  format-3 `.plist` + its page and reuses the atlas **as is**: the page is written **byte-for-byte**
  and never re-packed OR re-encoded, so every rect stays exactly where it was and a shipped game
  bound to those coordinates can't break — rotated frames included. cocos2d packs a rotated frame
  the SAME way PIXI un-rotates it (the TexturePacker convention), which is also the way the Sheet
  Maker's own packer stores one, so the game renders it correctly from the untouched page and every
  preview un-rotates it the one matching way (CCW — see the 2026-08-24 entry below).
  _(An earlier version flipped each rotated block 180° to satisfy the preview
  — that FIXED the preview and BROKE the game, which showed rotated frames upside down; reverted.)_
  Writes the page, a TexturePacker JSON and the AI manifest (all
  mirrored to R2); the manifest gains `locked` / `import` / `sequences`. Refuses format 0–2
  and any atlas whose rects fail `plist_import.validate` (out-of-bounds / overlap = misread
  geometry). Detected numeric runs are recorded in `sequences` as the hint the /flipbook tool
  reads. `editable=1` is the opt-in lossy path (re-slices to loose sprites, **drops per-frame
  trim offsets**, doesn't lock).
- **Whole-sheet downscale** — `Canvas size → Downscale sheet ⤓` scales the canvas, every
  region rect and this sheet's sprite copies by one factor (½ / ¼ / ⅛ presets or a target
  width), behind a numbers-first dialog + a confirm. `POST /api/rescale-sheet` does the
  art half (LANCZOS, lossless WebP, refuses a locked sheet or a factor outside 0–1).
- **Sheet lock** — a `"locked": true` manifest makes `api_arrange`, `api_export` and
  `api_fx_sync` refuse (each re-packs the page); `POST /api/unlock-sheet` clears it. `Save As`
  under a new name is still allowed. The rail marks locked sheets 🔒 (`api_state.locked_sheets`,
  `api_load_sheet.locked`) and offers Unlock.
- **Atlas round-trip hardened** — `relinkFx` enforces one child per `(base, mode)` (a second claimant is demoted, not dropped) and collapses duplicates, fixing the "duplicate region names" / wrong-`_glow` art after a bounce through the Atlas Maker; `_serve_sprite` cache set to `max-age=0` for the stale-recolour fix.

## Open items / next
1. **Browser live-verify owed** — the project-file workflow (B19: rename / Save / Save As + name guards), the FX-layer picker and now the `.plist` import + lock UI landed with local/headless verification; a full live browser pass on Railway is still owed. For the import specifically: a REAL shipped `.plist` (not the synthetic fixture) and confirmation that the imported page/JSON/manifest land in R2.
2. **Per-user session parity (Phase 4) — planned, unbuilt** (design `atlas-per-user-session.md`): thread the launcher `user` id and scope any server-remembered view state / canvas defaults per user. Minimal — the tool is largely stateless server-side (compose is synchronous, geometry rides in the request).

## Blocked (owner / external)
- None outstanding. (The service is deployed and auto-deploys from `main`; the guide's "Railway service still needs creating" note is stale.)

## Recent changes
- 2026-09-22 — **A deleted sheet stayed openable in the Atlas Maker — and came BACK.** Reported as
  "I deleted a locked sheet, it left the list, but I can still open its manifest in the Atlas Maker".
  Probing R2 directly settled what was actually true, and it was not what either half of the report
  suggested.
  - **The delete worked.** `sheets/S_AutomationTest/` and `sheet_src/S_AutomationTest/` were both
    empty at the source, and there is no database row to leak — sheets live only in R2 (the
    launcher's Drizzle schema has no sheets table), so the rail dropping the sheet was real
    evidence. What survived was ONE object: the manifest, re-stamped with this tool's
    `output_override`/`fit_mode` and dated **after** the delete. The Atlas Maker had put it back.
  - **Root cause is one-way mirroring, not the delete.** `pull_prefix` only ever DOWNLOADS, so a
    manifest deleted at the source lives on in the Atlas Maker's staging forever; its picker keeps
    offering the sheet, and opening it re-saves and re-mirrors the stale copy into R2. Fixed on that
    side (`cloud_paths.prune_manifests`) — see the Atlas Maker's status file.
  - **Two real holes in the delete's verification, both closed.** It re-listed `sheets/` and the
    manifests but **not** `sheet_src/`, so a silent failure there passed — the bucket sweep found
    exactly that orphan sitting in `unassigned/cloud/sheet_src/S_UI_StaticElements/` (17 sprites,
    ~2.4 MB, no page and no manifest left to reach them by). And it asked with `storage.exists`,
    which folds EVERY error into "not there" — a throttled HEAD read as a successful delete, which
    is the precise false-pass the re-list was added to prevent. Now: `sheet_src/` and
    `input/refs/atlasslices/<sheet>/` are deleted and verified too, `storage.head` replaces
    `exists`, and a check that cannot be completed (or a delete-phase listing that raises) returns
    an actionable refusal instead of a 500 or a lie.
  - **Sheet-name namespacing is NOT ownership.** The Atlas Maker's slice mirror
    `input/refs/atlasslices/<sheet>/` looks sheet-owned, but `⧉ Duplicate atlas` copies
    `shape_ref`/`style_ref` VERBATIM (`_DUPLICATE_DROP` does not clear them), so a derived atlas
    keeps pointing at the tree of the sheet it was copied from. Not theoretical — a bucket scan
    found `s_new_boot_idle_water` → `atlasslices/S_New_Boot` (25 refs),
    `s_new_gallion_idle_water` → `atlasslices/S_New_Gallion_Idle` (25), and
    `mmBG` → `atlasslices/SingleImage` (176). Deleting the tree with the sheet would have blanked
    every one of those. It is now removed only when `_slice_tree_users` finds no other manifest
    referencing it, and a scan that cannot be completed keeps it; the note says which case applied.
  - **The two refusals say which state you are in**, because they are not the same state: a
    delete-phase listing that breaks leaves R2 *half*-emptied ("stopped part-way"), while a
    verify-phase failure means the deletes almost certainly all landed and only the confirming read
    failed. Both are idempotent — running the delete again finishes or settles it.
  - `test_delete_sheet.py` covers all of it with a fake R2 that injects per-prefix and Nth-call
    failures. The unguarded delete-phase `list_keys` was found BY that test, not before it.
  - **The mirror image is closed too (same day).** `cloud_paths.prune_listing_ghosts` reconciles
    this tool's own staging, called from `_refresh_listing_subtrees` — i.e. on EVERY state load, not
    just at boot, because that function already re-pulls `sheets/` + `manifests/` there. It was only
    ever half a mirror: re-pulling could show something NEW but never make a DELETED thing go away,
    so a sheet removed at the source (another replica, the Atlas Maker writing to the shared
    `manifests/` prefix, an edit straight in the bucket) kept appearing on the rail.
    **Three rails**, the third specific to this tool: prune only off listings that SUCCEEDED;
    never prune work not yet confirmed into R2 (`_AUTHORED`); and **never prune an EMPTY local
    sheet directory** — `output_dir()` mkdirs `sheets/<sheet>/` the moment a sheet is NAMED, so an
    empty one is a sheet being authored right now. It has no R2 objects for exactly the same reason
    a ghost has none, and only the local files tell them apart.
    The claim is **scoped to the whole handler**, not to a single write, by every path that
    creates a sheet directory — export, `.plist` import and rename — each claiming its sheet AND
    its manifest (`_claim_scope`, keyed on the TOP-LEVEL segment under `sheets/`, since a
    redirected export can nest). It is a **refcount, not a flag**: the handler holds one for the
    operation while `_mirror` takes and drops its own around each push, and with a flag `_mirror`
    releasing after the FIRST confirmed push dropped the handler's protection with the `.atlas`,
    the `.json` and the manifest still to write — a concurrent state load could then rmtree the
    directory mid-export. Rename scopes BOTH names: it deletes the original in step 5, so a prune
    inside that window would destroy the sheet outright, and a bare claim there could never be
    released afterwards.
    **A failed push is tracked separately** (`_UNPUSHED` + `mark_pushed`), because it is not a
    balanced thing: as an extra unit of the refcount it leaked monotonically — one transient R2
    error and that sheet was never prunable again on this container, which is the ghost symptom
    returning by another door. A flag self-heals on the next confirmed push, and the flag goes ON
    before the count comes OFF so there is no instant where a key is neither counted nor flagged.
    Rename and delete call `forget()` for the name they remove for good, or its failure flag would
    outlive the sheet. `api_clearcache` calls `discard_all_authored` — every project, matching the
    rmtree's own scope.
    Because the prune runs on every state load, the claim check and the deletes are ONE critical
    section; a snapshot loses exactly the race it exists to win.
    **Two costs, stated so the next "I deleted it and it's still there" is not re-investigated:**
    an empty sheet directory is protected forever, so a sheet deleted elsewhere still shows on any
    container that merely NAMED it (`api_clearcache` is the escape); and `sheet_src/<sheet>/` is
    NOT reconciled — it is a lazy subtree, so "no local files" says nothing about R2 — which means
    a pruned sheet leaves its sprite pile behind for a same-named successor to inherit.
    `test_listing_prune.py` defeats all three rails deliberately and pins `_mirror`'s key
    derivation.
- 2026-09-22 — **Whole-sheet downscale (4K → 1K).** New `Downscale sheet ⤓` in the Canvas-size
  card + `POST /api/rescale-sheet`. It resamples the **art**, not just the rects, and that is the
  whole point: `packer.compose` draws each sprite at `min(cell/native, 1)` and never upscales, so
  scaling only the geometry would leave 4k art under a 1k cell — where it stops being padded and
  **fills** the cell. Every region deliberately padded to a uniform cell (the documented trick for
  giving differently-sized icons one frame size) would silently lose its margin, and the game would
  read the symbols as resized. Shrinking `sheet_src/<sheet>/` by the same factor keeps
  `cell > native`, so every margin scales with it — verified both ways locally (a 1200px sprite in a
  2048 cell: geometry-only → art fills the 150px cell; with the source rescaled → 100px art in a
  150px cell, the original 2/3 exactly). Rects scale by their **edges** (`round((x+w)*f) - round(x*f)`),
  not position-and-size apart, so flush-packed neighbours stay flush; rotated regions scale their
  swapped footprint. The server rounds half-UP (`int(v+0.5)`), not Python's banker's `round()`, to
  stay in step with the browser's `Math.round`.
  **It is one-way** — the pile is overwritten and the full-res pixels are gone (re-upload to undo),
  hence the gate: a dialog showing `4096 × 4096 → 1024 × 1024 (25%)`, the sprite count, the smallest
  resulting sprite and a 1px-floor warning, then a `confirm()` naming the sheet and the loss.
  When the open sheet is a loaded project sheet it also **re-saves in place** afterwards — without
  that, `api_load_sheet` prefers the loose sprites over re-slicing the page, so reloading the still-4k
  saved sheet would come back as small art marooned in huge cells. Locked (verbatim-import) sheets are
  refused client- and server-side. Verified locally R2-less in the browser (seeded 4096² sheet, one
  padded region, two flush neighbours): every guard (blank / ≥ canvas / < 16px / empty / locked),
  cancel-changes-nothing, ¼ run → exact ×0.25 on canvas + all three rects with adjacency preserved,
  files on disk resampled, session persisted at the new scale, in-place re-save wrote a 512² page,
  and a full reload round-tripped identical geometry with the padding intact.
  **Live verify owed** (Railway + the R2 mirror of the rescaled pile).
- 2026-09-02 — **"New / clear canvas" kept overwriting the open sheet.** The button only emptied the canvas; the loaded sheet's name stayed in the name box, `Save` on a new sheet routes to `doSaveAs`, and `api_export` writes whatever name it is given — so forgetting to retype the name replaced the previous sheet's PNG / `.atlas` / JSON / manifest on R2, with the button's own tooltip promising "never overwrites". Now `New sheet…` opens a dialog (Enter = Create, Esc / backdrop = Cancel; blank = nothing happens) that sanitises the name the way `safe_name` will store it, warns live when it matches a rail entry, and asks for confirmation on Create; `doSaveAs` asks the same question when the name collides (and only when there is something to save). A freshly created, still-empty sheet is persisted to the session with its name, and `init` now restores a regions-less session that carries a `display_name`, so a refresh no longer falls back to `newsheet`. Verified locally (R2-less boot, two seeded rail entries): warning + confirm + cancel paths, sanitising (`My Sheet!` → `My_Sheet`), refresh keeps the name, Save As asks on a collision and not on a new name, in-place Save still asks. The Save As check keys on `sheetName` (the payload's `sheet`, which `api_export` writes under — `basename` is ignored), not the name box. **Known, pre-existing drift left alone:** `restoreSession` sets `sheetName` from the session's pile key but the box from `display_name`, so after typing a new name over a loaded sheet and refreshing, the box and the write target differ — the guard follows the write target. **Verified live on Railway** (2026-09-02, project `test6`, signed in via the launcher): the dialog opens, flags an existing rail name, and Cancel leaves the open sheet untouched.
- 2026-08-24 — **Region thumbnails un-rotated a rotated frame the WRONG way for every sheet that wasn't a `.plist` import — the Symbols grid drew H3/H4/H5/L1/L3/L4/S 180° out.** `RegionThumb` branched the un-rotation on `loadRegionSet`'s `tpRotated` flag: CCW for a verbatim cocos2d import, CW for everything else, on the stated belief that "the Sheet Maker's own packer goes the other way". It does not — `rot_convention_check.py` pins `compose` to `rotate(-90)` (**CW**), the Atlas Maker's `fit_to_region` matches, and a native TexturePacker atlas is CW by definition. **Every producer stores CW, so the un-rotation is always CCW** — exactly what `EditorCanvas.drawRegion` has always done (its comment already said "verified empirically … MATCH THE GAME"). The two renderers had silently disagreed for every non-plist sheet with rotated frames. It bit hardest on the engine's own `symbolsStatic`, a real TexturePacker export whose rotated frames are precisely `h3 h4 h5 l1 l3 l4 s` (+ `explodedW`): the /symbols grid drew those symbols upside-down in their sprite states while the spine `win` state beside them (official runtime, always correct) looked right — which reads as "the spine is flipped". **Ground truth that settled the direction:** the same hammer art also lives UN-rotated in the spine atlas as `t3_hammer`; cropping the TexturePacker block and rotating it CCW reproduces it exactly, CW gives the 180°. Fix = drop the branch, always CCW; `tpRotated` had no other consumer and is deleted end-to-end (`EditorRegionSet`, the client type, `/api/editor/regions`). **Preview-only** — the game reads the TexturePacker JSON through Pixi's `Spritesheet` (`rotate: 2`, frame `(x,y,h,w)`), which was always correct, and `symbolExport.toTexturePackerJson` re-emits upright `w/h` + `rotated` unchanged. Sheets with no rotated frames are byte-identical. Affects every `RegionThumb` caller: /symbols, /flipbook, the editor asset library.
  - ⚠️ **Adjacent, deliberately NOT touched:** `uprightWH` (`editorRegions.ts`) swaps a rotated TP frame's `w/h` "back to upright" on the `reconcileWithTexturePacker` path — but TexturePacker's `frame.w/h` are ALREADY upright. Pixi reads the footprint as `(h×w)`, and `symbolsStatic`'s `l1` (`frame.w` 200 at `x` 203 on a 386-wide page) only fits if the footprint is the swapped 175. So that helper looks inverted. It runs only for manifests referencing an `atlas.texturepacker_json` whose cached geometry drifted, it is off this bug's path, and the 2026-08-10 rigger entry records it fixing a real symptom — it needs its own repro, not a drive-by flip.
- 2026-08-20 — **The editable `.plist` import stopped re-rotating art it had just un-rotated — the root cause of the "atlas regions load flipped" reports.** A rotated region is the ONE place PixiJS and Spine disagree, and it cannot be reconciled in the `.atlas`: our packers store it 90° **CW** (TexturePacker/Pixi, what Pixi's `Spritesheet` un-rotates at render time) while Spine's parser wants **CCW**, and spine-webgl only honours `degrees` 0/90 — 270 falls through. So a CW region renders 180° upside-down in a rig until the launcher reorients its page pixels (`reorientRotatedRegionsForSpine`). **The two runtimes cannot be made to agree** — third-party, opposite conventions hardcoded — so the only way to end the class of bug is to have nothing rotated to disagree about. **We already don't rotate:** `packer.pack` / `packer.arrange` default `allow_rotation=False`, and Atlas Maker's auto-pack passes `False` explicitly. Rotation was re-entering through ONE door: the editable plist import calls `api_load_sheet`, which **un-rotates** every frame into an upright loose sprite, then wrote a session with `allow_rotation: True` — immediately re-rotating the art it had just normalised. Now `False`. The UI checkbox stays (an artist may want the density and accept the reorient round-trip); what's gone is it being switched on behind their back. **The VERBATIM plist import is deliberately untouched** — it stores the page byte-for-byte and promises "reuse the atlas exactly as is"; a previous attempt to re-encode rotated blocks there broke the game, as the comment at the write site records. Un-rotating there would mean a full re-pack, which is what the `editable` path already is. Also fixed `packer.py`'s docstring, which claimed CW was "the Spine `rotate:90` convention" — the exact inverse of what the code does, and the misconception that keeps reintroducing this. New `services/sheet-tool/rot_convention_check.py` (11 assertions) pins it: rotation off by default, `arrange` leaves a tall sprite upright, `compose` stores a rotated region as `rotate(-90)` of upright (asymmetric 4-corner test image so any flip/mirror is detectable), and no path hard-codes `allow_rotation: True`. **Both halves mutation-verified** — flipping `compose` to CCW fails 3 assertions, re-arming the import fails the 4th. It replaces `_rot_roundtrip_check.py`, which both packers' comments cite but which was **never committed**, so there was nothing to run. **Not retroactive:** bundles already carrying rotated regions keep them (the launcher's reorient still handles them); re-import or ⟳ Re-sync to normalise. Deploys with the `sheet-tool` Railway service (repo-root build).
- 2026-07-20 — verbatim cocos2d `.plist` import wired into the UI + API (`/api/import-plist`,
  `/api/unlock-sheet`, Import-tab controls, 🔒 rail marker). Engine = `plist_import.py`
  (covered by `test_plist_import.py`, 22 checks). Verified offline against a synthetic
  6-frame/1-rotated atlas: byte-identical page, manifest shape, sequence detection, every
  refusal path, lock→unlock round-trip and the editable path. **Not yet verified live:** the
  R2 mirror of the imported objects and a real shipped `.plist` in the browser.
- 2026-07-20 — uploaded sprites now order **naturally** (`explosion_2` before `explosion_10`), on the saved batch, the accumulated pile, and loose-sprite recovery. Step 3 of [invisible-flipbook](../design/invisible-flipbook.md) — upload order drives region order drives manifest order, which the clip editor reads (`d7107f4`).
- 2026-07-08 — fixed duplicate FX-child names + stale glow/shine after an Atlas-Maker round-trip (`d13a7c7`) ([detail in history](../history.md)).
- 2026-07-06 — per-sprite FX-layer picker (auto-spawns same-size FX sibling cells) ([detail in history](../history.md)).
