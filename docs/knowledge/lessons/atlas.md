# Atlas — lessons

What has bitten atlas work before, newest first. Format and rules: [README](../README.md).
Current state lives in [status/atlas-maker.md](../../status/atlas-maker.md) and
[status/sheet-maker.md](../../status/sheet-maker.md); this file only keeps the traps. Covers the
Atlas Maker (`services/atlas-tool`), the Sheet Maker (`services/sheet-tool`), manifests and their
regions. Generation traps (ComfyUI, RunPod) live in [comfyui.md](comfyui.md), rig-side rotation
in [rigger.md](rigger.md), and `editorArtExport` (art shown in the editor, missing in the game;
region-name collisions) in [editor.md](editor.md#art-picked-in-the-editor-is-blank-in-the-game).

### Two people saved the same atlas and one edit vanished
- **Symptom:** two users on one atlas or sheet overwrote each other with no warning.
- **Cause:** saves were plain writes; a container whose staging was older than R2 (rolling deploy,
  a Sheet Maker re-export) also wrote its stale copy over the newer object.
- **Fix:** every save is compare-and-swapped (`services/atlas-tool/doc_sync.py`,
  `iw_common/docsave.py`); a conflict names who saved and offers "Overwrite with mine".
- **Guard:** `test_doc_conflicts.py` (both tools). A two-browser live run is still owed.
- **PR:** not recorded (2026-09-30) · source: `docs/status/atlas-maker.md`

### A deleted sheet kept showing and came back
- **Symptom:** a sheet deleted in the Sheet Maker stayed in the Atlas Maker picker; opening it
  wrote the dead manifest back into R2.
- **Cause:** `iw_common.storage.pull_prefix` only downloads, so a staged copy outlives its source
  and `_mirror` pushes it back. Earlier, delete trusted local staging and a swallow-all helper.
- **Fix:** `cloud_paths.prune_manifests` reconciles deletes; `api_delete_sheet` re-lists R2.
- **Guard:** `test_manifest_prune.py`, `sheet-tool/test_delete_sheet.py`, `test_listing_prune.py`.
- **PR:** not recorded (2026-09-22; `61c5b5b`) · source: `docs/status/sheet-maker.md`

### Duplicate atlas published over the original sheet
- **Symptom:** risk found in review: a ⧉ Duplicate copied verbatim deploys onto the original.
- **Cause:** `deploy_path`/`deploy_basename` and the variant/seed/lock fields name the ORIGINAL's
  files; the composed page name differs but the deploy destination does not.
- **Fix:** the duplicate drops result keys, clears deploy, renames regions, remaps `layer_of`.
- **Guard:** `test_duplicate_atlas.py`.
- **PR:** not recorded (2026-09-20) · source: `docs/status/atlas-maker.md`

### Re-generated frames shipped offset and some vanished
- **Symptom:** after a re-generate, deployed frames were off-centre and 7 of 25 were missing.
- **Cause:** hydration pulls `atlas/` in a background thread and `pull_prefix` re-downloaded any
  object whose size differed, newer local file or not, so the old page replaced the fresh one.
- **Fix:** hydration never overwrites newer local work; `publish_pack_page` and `_deployatlas`
  measure the real page and refuse one whose size contradicts the manifest.
- **Guard:** `test_pack_page_pointer.py`.
- **PR:** not recorded (2026-09-16, follow-up to #682) · source: `docs/status/atlas-maker.md`

### A re-pack silently restored the old packing
- **Symptom:** a `pack` atlas showed the previous layout on top of the newly composed page.
- **Cause:** the manifest kept `atlas.texturepacker_json` for the superseded page, and the
  launcher's `backfillMissingGeometry` (`editorRegions.ts`) treats that JSON as authoritative.
- **Fix:** `auto_pack_layout` drops the descriptor; `publish_pack_page` repoints
  `atlas.source_image` only after the new page is in R2.
- **Guard:** `test_pack_page_pointer.py`.
- **PR:** #682 (2026-09-16) · source: `docs/status/atlas-maker.md`

### Re-packed atlas deployed frames for art it no longer holds
- **Symptom:** a symbol drew arbitrary pixels of the new page after a region lost its art.
- **Cause:** a region the packer did not place kept its old rect; the deploy fallback emits a
  frame for any complete rect, and the old `continue` skipped incomplete ones silently.
- **Fix:** re-pack strips unplaced rects and names them; deploy refuses rects off the measured page.
- **Guard:** `test_stale_pack_rects.py` (shipped `_rect_on_page` / `_rect_has_ink` predicates).
- **PR:** #684, #686 (2026-09-16) · source: `docs/status/atlas-maker.md`

### Two green fixes merged into one broken clear
- **Symptom:** none at first; review found unplaced regions keeping half their trim.
- **Cause:** #683 and #684 both edited `auto_pack_layout` the same day; git merged them cleanly but
  split one key list in two (camelCase on one path only). Every branch was green.
- **Fix:** one list, `_PACK_GEOM_KEYS` built from `_REPACK_CLEARED_KEYS` (`ui_server.py`).
- **Guard:** `test_stale_pack_rects.py` (superset assertion). Re-read after a same-day merge.
- **PR:** #686 (2026-09-16) · source: `docs/status/atlas-maker.md`

### Flipbook frames wobble after a re-compose
- **Symptom:** an animation's character "moves up and down, left and right" after re-composing.
- **Cause:** the re-pack discarded each frame's trim (`off_*`/`orig_*`, and the camelCase
  `offX/origW` spelling `video_to_clip` writes), so each frame declared its own tight crop.
- **Fix:** a re-pack moves a frame but keeps its canvas; `video_to_clip` stopped declaring `pack`.
- **Guard:** `test_pack_trim.py`.
- **PR:** #683 (2026-09-16) · source: `docs/status/atlas-maker.md`

### The whole Atlas Maker page went dead after a tooltip edit
- **Symptom:** buttons stopped working; every page function (e.g. `renderSel`) was undefined.
- **Cause:** the page JS lives in Python string templates in `ui_server.py`; a backslash Python
  consumed (or a real newline) left a JS string unterminated. `py_compile` still passes.
- **Fix:** the escapes were corrected (#620) and the guard below added.
- **Guard:** `test_page_js.py` (source scan for odd backslash runs + `node --check` on renders).
- **PR:** #620 (2026-09-08; guard 2026-09-15) · source: `docs/status/atlas-maker.md`

### A save made during an FX rebuild came back undone
- **Symptom:** a prompt, seed or variant pick silently reverted a few seconds after saving.
- **Cause:** render post-hook and compose did load → `rebuild_fx_layers` (seconds) → save of the
  WHOLE manifest, writing back the pre-rebuild copy.
- **Fix:** slow work runs on a detached copy; `persist_region_fields()` re-applies only the
  job's fields to a manifest re-read inside the lock. Not a bigger lock (that freezes saves).
- **Guard:** `test_fx_rebuild_window.py`.
- **PR:** not recorded (2026-09-14) · source: `docs/status/atlas-maker.md`

### A picked variant was ignored by Create Atlas
- **Symptom:** "if I change my variation … the atlas is generated with the old variation".
- **Cause:** `_save` stored the pick only inside `if e["lock"]`; `variant` doubled as the lock key.
- **Fix:** an explicit `lock` flag, `batch_atlas.region_locked()` as the one answer, and one
  `output_view()` for both the page and `/cardsdata`.
- **Guard:** `test_variant_pick.py`.
- **PR:** not recorded (2026-09-14) · source: `docs/status/atlas-maker.md`

### Thumbnails failed at random on a big atlas
- **Symptom:** random 502s or blank tiles on art that was really there; different ones each load.
- **Cause:** a page fired ~120 image requests at the stdlib `ThreadingHTTPServer` at once, each
  a full-size PIL decode; Railway 502'd the losers and nothing retried a failed `<img>`.
- **Fix:** `iw_common/imgcache.py` (disk cache, bounded decodes, ETag) and a retrying loader.
- **Guard:** none in CI; the loader was proved against a 503-twice harness.
- **PR:** not recorded (2026-06-15; 2026-09-09) · source: `docs/status/atlas-maker.md`

### A blueprint fed the artwork in as a black silhouette
- **Symptom:** "I published a background-removal blueprint and my image came back regenerated".
- **Cause:** on a single-`LoadImage` graph the modal bound both `style_ref` and `shape_ref`;
  `shape_ref` applies second and sends a grayscale silhouette instead of the art.
- **Fix:** `buildBpBindings` refuses to prefill one (node, field) for two roles.
- **Guard:** `test_blueprint_publish.py`.
- **PR:** not recorded (2026-09-09) · source: `docs/status/atlas-maker.md`

### One Save with a blank setting killed every FLUX render
- **Symptom:** `could not convert string to float: ''`, then `vae_name: '' not in [...]`.
- **Cause:** `ui_server.load_config` reads the config raw, so a key it predates showed blank; the
  global save stored the blank and `batch_atlas.load_config` let `""` shadow the default.
- **Fix:** blanks fall back to defaults; a blank required model name is never stored or sent.
- **Guard:** `test_config_defaults.py`.
- **PR:** #574, #576 (2026-09-03) · source: `docs/status/atlas-maker.md`

### New sheet overwrote the sheet that was open
- **Symptom:** "New / clear canvas" then Save replaced the previous sheet's files in R2.
- **Cause:** the button emptied the canvas but kept the loaded sheet's name; `api_export` writes
  whatever name it gets.
- **Fix:** `New sheet…` asks for a fresh name; the old clear came back only behind a gate.
- **Guard:** none.
- **PR:** not recorded (2026-09-02) · source: `docs/status/sheet-maker.md`

### Atlas regions loaded flipped or upside down
- **Symptom:** rotated frames drew 180° out in thumbnails or after a `.plist` import.
- **Cause:** every producer stores rotated regions 90° CW, but `RegionThumb` un-rotated the
  wrong way, and the plist import re-saved with `allow_rotation: True`, re-rotating its art.
- **Fix:** un-rotation is always CCW; packers default `allow_rotation=False`. Rig side:
  [rigger.md](rigger.md#an-image-packed-at-180-degrees-draws-upside-down).
- **Guard:** `services/sheet-tool/rot_convention_check.py`, `test_plist_import.py`.
- **PR:** not recorded (2026-08-20; 2026-08-24) · source: `docs/status/sheet-maker.md`

### The picked blueprint was ignored and SDXL ran instead
- **Symptom:** global settings (above all the pipeline selector) never applied in the cloud.
- **Cause:** `batch_atlas.load_config` read `atlas_config.json` next to the script, which the
  cloud image does not ship; `ui_server` writes it under the R2-backed staging root.
- **Fix:** the subprocess prefers the staging copy; a `Pipeline: …` log line and a loud
  no-silent-SDXL guard were added.
- **Guard:** #305 guard and #306 log line.
- **PR:** #305, #306 (2026-08-11) · source: `docs/status/atlas-maker.md`

### A manifest region with no rect vanished downstream
- **Symptom:** a region listed in the manifest was missing in the editor, Rigger or FX art.
- **Cause:** `parseRegions` (`launcher-api/src/lib/server/editorRegions.ts`) skips a region
  without full `x/y/w/h`; name-only manifests keep it in `atlas.texturepacker_json`. Tool side,
  `all_regions` drops a region with no `.atlas` counterpart on an `.atlas`-bound manifest.
- **Fix:** `backfillMissingGeometry` adds the missing rects from `atlas.texturepacker_json`.
- **Guard:** none dedicated; an FX `art.assetKey` is validated at bake for the same reason.
- **PR:** not recorded · source: `docs/status/rigger-history.md`, `docs/status/atlas-maker.md`

### A Sheet Maker re-export never reached the Atlas Maker
- **Symptom:** a sprite added in the Sheet Maker was missing; then the re-export got overwritten.
- **Cause:** the dropdown loaded once-per-process staged copies; activation mirrored the STALE
  staged manifest back to R2 over the fresh export.
- **Fix:** `_refresh_manifest_from_r2()` re-pulls on every real switch; saves only when dirty;
  `all_regions` banners regions missing from the `.atlas`. ↻ Refresh after out-of-band R2 edits.
- **Guard:** none dedicated.
- **PR:** not recorded (2026-06-11, `091711f`) · source: `docs/history.md`

### Manifests from Windows broke in the cloud
- **Symptom:** "Atlas geometry not found" / "no ref" for manifests authored on a desktop.
- **Cause:** fields held Windows paths (`C:\…\symbols.atlas`), which `Path.is_absolute()` is false
  for on Linux; Windows also strips a trailing `.` from folder names, R2 does not.
- **Fix:** `batch_atlas.atlas_file_path()` / `source_image_candidates()` normalise and probe R2;
  `fix_manifest_paths.py` cleaned trailing-dot segments.
- **Guard:** none; watch any Windows-sourced data.
- **PR:** not recorded (2026-05-31, `f04fb26`) · source: `docs/history.md`
