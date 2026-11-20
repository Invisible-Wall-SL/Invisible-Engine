# Rigger 2.5D — lessons

What has bitten 2.5D rig work (the 3D bake, `rig3d.json`, 🎥 Motion in 3D), newest first.
Format and rules: [README](../README.md). Current state lives in [status/rigger.md](../../status/rigger.md). Rigger lessons are split across three files: [rigger.md](rigger.md) (newest and general), [rigger-2p5d.md](rigger-2p5d.md) (2.5D rigs and 3D motion import), [rigger-older.md](rigger-older.md) (older traps, kept whole).

### A 60° tilt on a 2.5D arm left it at full length

- **Symptom:** tilt typed on a template's arm foreshortened nothing.
- **Cause:** template bones keep x at 0° and hang their child below (−y), so a tilt about the bone's y axis turned the arm about its own length.
- **Fix:** tilt and twist are read about the bone's length (`orientAlong` / `anglesAlong`): its x axis, else the direction to its first child.
- **Guard:** `check:rig3d` "a bone whose length runs along −y tilts its length toward the viewer"; the browser gate's foreshortening check.
- **PR:** #1834 (2026-11-20)

### Per-tab 3D state beside the undo history sent the wrong save

- **Symptom:** (caught before shipping) after undoing ⇲ Detach, a save sent the 3D clip without `resolve: rebake`; deleting a bone's last 3D key would take the last bake's keys.
- **Cause:** the "re-keyed" set and the owned bones lived beside the history, not in it.
- **Fix:** derive them: the save asks for every 3D clip; owned bones are re-read from the restored state on undo (`bake3dReset`).
- **Guard:** the browser gate's detach-undo-edit and save checks (mutants "undo keeps the cache", "the save asks for no re-bake").
- **PR:** #1834 (2026-11-20)

### A 3D clip's fingers drew off their pose though the bake met its tolerance

- **Symptom:** fingers or face parts keyed in 2D under a turned bone were 0.80 off against 0.45 allowed.
- **Cause:** the bake widens a baked bone's error card over its flat descendants' motion read from `clip.bones`, but `clipOf` only put the 2D keys of the bones the baked ones hang from, so flat leaves were measured at setup.
- **Fix:** `clipOf` also carries the flat bones' rotate / translate / scale keys (`flatBonesOf`), refuses their other timelines, never owns them.
- **Guard:** `check:rig3d` §7 (a curling finger under a turned hand), `check:rigger-writes`.
- **PR:** #1836 (2026-11-20)

### Hands of a 3D import floated off the forearms in the Rigger only

- **Symptom:** "the hands seem completely discarded": finger clusters 30–685 units off the forearms; the game was right. Also the hands pointed 9–37° off the tracked hand.
- **Cause:** `poseAtTime` (`view.html`) skipped one-axis timelines, but the bake keys `sheary` on every bone it owns; and `rigMotion3d` used Pose Landmarker's coarse hand points.
- **Fix:** `poseAtTime` plays `BONE_AXIS_TIMELINES`; `Bone3dPoints.hand` reads the hand's picture direction from the hand found on its wrist, depth from the pose.
- **Guard:** `motion-3d.mjs` (page pose = engine-rig; hand to the tracked hand), `keydefaults.mjs` (split channels).
- **PR:** #1837 (2026-11-20)

### The first 3D motion import pointed the arms 2–5° off the video

- **Symptom:** arms off the video by 2–5° median, where the 2D import followed at 0.4°.
- **Cause:** MediaPipe's world points are a separate 3D estimate; their x and y do not project onto its picture points.
- **Fix:** read x, y from the picture (at the frame's pixels per metre) and only depth from the world points (`rigMotion3d.ts`).
- **Guard:** `motion-3d.mjs` (3D points skewed 8° from the picture).
- **PR:** #1829 (2026-11-20)

### A 3D import baked 81 bones and took 7 s for 4 s of footage

- **Symptom:** fingers and face parts with no motion of their own took 70–100 keys each.
- **Cause:** the bake keyed every bone under a 3D-turned one, re-keying a flat child to correct its parent's interpolation error (`rig2p5d.ts`).
- **Fix:** a bone flat in its parent's card keeps its 2D keys; the baked parent sizes its error floor over the flat art (`flat`, `reachOf`).
- **Guard:** `motion-3d.mjs` (flat bones not owned); `rig-2p5d.mjs` `[hinged]`.
- **PR:** #1829 (2026-11-20)

### On real footage a hinged arm and a shoulder-turned chest baked 66,070 keys

- **Symptom:** 30 s of the bridge shot: 66,070 keys, 7,608 runs past tolerance.
- **Cause:** a hanging arm's bend plane and a side-on chest go edge-on several times a second; every non-flat bone under an edge-on card pays 1/σ keys and a step (`rigTemplates.ts` 3D maps).
- **Fix:** limbs and hands roll to face the viewer; the body's bones face the viewer and only the torso image takes the turn (13,047 keys, 238 past).
- **Guard:** none (measured, not gated); re-measure on the T10/T11 captures when a template's 3D map changes.
- **PR:** #1829 (2026-11-20)

### A camera cut drew the upper body below the hips for a second

- **Symptom:** a 3D import of the bridge shot drew the whole upper body below the hips.
- **Cause:** across a cut the tracker found a body with hips above shoulders; a 3D turn has no channel range to clamp it as the 2D controls did.
- **Fix:** a `bone3d` entry's `reach`; a reading past it is a gap, held and reported (spine / hips 60°, chest 30° more).
- **Guard:** `motion-3d.mjs` (a body upside down for six frames holds upright and is reported).
- **PR:** #1829 (2026-11-20)
