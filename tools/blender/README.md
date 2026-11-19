# Blender toolchain (3D assets)

Scripts Claude and the artists run on every 3D asset, headless (`blender -b … -P`) or inside a
running Blender through the Blender MCP. The rules they enforce are on
[docs/conventions/blender-3d-assets.md](../../docs/conventions/blender-3d-assets.md); the plan is
[docs/design/3d-games.md](../../docs/design/3d-games.md). Nothing here reaches a game bundle: the
GLBs go to the launcher, which compresses them and derives the tiers.

| File | Needs | Does |
|---|---|---|
| `ie_conventions.py` | plain Python | Every name, budget, bone, issue code and exporter setting; `check_facts()` runs every rule on plain data |
| `ie_validate.py` | Blender | Collects facts from the open scene → JSON report ([`report.schema.json`](report.schema.json)); exit 1 on errors |
| `ie_export.py` | Blender | Applies transforms, optionally generates missing LODs (Decimate), exports `<id>.glb` per asset with `extras` |
| `ie_humanoid.py` | Blender | Creates `RIG_ie_humanoid`; exports clip libraries (`anim/<skeleton>/<set>.glb`) |
| `ie_camera_move.py` | Blender | Exports an arena's camera moves (`anim/cameras/<arena>.glb`, one NLA track per move); `--sample` builds the placeholder arena's fixture |
| `fbx_to_glb.py` | Blender | FBX migration: import, fix rotation/scale, decimate, origin, rename, resize maps, validate, export |
| `ie_glb.py` | plain Python | Reads/rewrites a GLB's JSON chunk (strips scale channels, describes contents) |
| `presets/*.py` | — | The same exporter settings as File → Export presets (generated: `python ie_conventions.py`) |
| `selftest.py` | Blender | Builds fixtures (clean prop, hero, clip library, one of every mistake) and proves the scripts end to end |
| `test_ie_conventions.py` | plain Python | The CI half: every rule on synthetic facts, schema, presets in sync, GLB rewrite, scripts compile |

## Run it

```bash
BLENDER="C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"
"$BLENDER" -b my_prop.blend -P tools/blender/ie_validate.py -- --out report.json
"$BLENDER" -b my_prop.blend -P tools/blender/ie_export.py -- --out out/ --lods
"$BLENDER" -b --factory-startup -P tools/blender/ie_humanoid.py -- --save hero_base.blend
"$BLENDER" -b locomotion.blend -P tools/blender/ie_humanoid.py -- --export-clips out/anim/ie_humanoid/locomotion.glb
"$BLENDER" -b --factory-startup -P tools/blender/fbx_to_glb.py -- sword.fbx --class weapon --name sword --out out/ --lods
"$BLENDER" -b arena_cameras.blend -P tools/blender/ie_camera_move.py -- --out out/anim/cameras/<arena>.glb
"$BLENDER" -b --factory-startup -P tools/blender/ie_camera_move.py -- --sample --out packages/engine-3d/fixtures/cameras/sample.glb
"$BLENDER" -b --factory-startup -P tools/blender/selftest.py -- --out <scratch dir>
python tools/blender/test_ie_conventions.py
```

The export never saves your `.blend`: it changes the scene in memory, then exports.

## Through the Blender MCP

Live (Blender running with the MCP add-on on `localhost:9876`), with `execute_blender_code`:

```python
import sys; sys.path.insert(0, r'C:\Invisible Wall SL\Engine\Invisible Engine\tools\blender')
import ie_validate, ie_export, ie_humanoid
report = ie_validate.validate()                 # look, then propose fixes; ask before destructive ones
ie_export.export_all(r'C:\…\out', generate=True)
```

Headless twins (`execute_blender_code_for_cli`) open a `.blend` in `blender --background` and need
`BLENDER_PATH` set to `blender.exe`. A module edited during a live session must be reloaded
(`importlib.reload`) before Blender sees the change.

## CI

`scripts/check-python.py` discovers `tools/blender/test_*.py` (the `python tests` job) and ruff
can check this folder locally with the services' rules (`ruff check tools/blender/`; CI lints `services/` only). CI has no Blender, so `selftest.py` runs locally:
run it after changing any script here.
