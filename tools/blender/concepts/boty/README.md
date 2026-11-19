# Battle of the Year: concept renders

The scenes behind `docs/design/3d/boty/concepts/`. Everything is procedural: models, materials and
the painted face and screen textures are made by these scripts, with no downloaded assets. The
Devil follows the owner's concept (`docs/design/3d/boty/devil-concept.webp`).

These are concept images for the deck, not game assets: nothing here follows the export rules in
`docs/conventions/blender-3d-assets.md`, and no script here writes a GLB.

## Run

Blender 5.2 as a Python module, Cycles on the CPU (no GPU, no cloud):

```bash
python3 -m venv bv && bv/bin/pip install "bpy==5.2.4" pillow numpy
bv/bin/python shot_key_art.py --out <dir> --draft     # small and noisy, to check a composition
bv/bin/python shot_key_art.py --out <dir>             # the final
```

Each shot writes `<name>_raw.png` (the render) and `<name>.jpg` (after `post.py`: bloom, a little
contrast and saturation, a vignette). `--scale` and `--samples` override the size and the quality.
A final takes 5–15 minutes on four cores.

| Script | Writes |
|---|---|
| `shot_key_art.py` | `key_art.jpg` |
| `shot_devil.py` | `devil_3d.png`; with `--name devil_turnaround`, `devil_turnaround.jpg` |
| `shot_defenders.py` | `defender_concepts.jpg` |
| `shot_stage_library.py` · `shot_stage_club.py` · `shot_stage_casino.py` | `stage_<name>.jpg` |
| `shot_fpv.py` | `fpv_defender.jpg` |
| `shot_weapons.py` | `weapons_lineup.jpg` |
| `shot_storyboard.py --name storyboard_<1-3>` | `storyboard_<n>.jpg` |

## Modules

| File | Holds |
|---|---|
| `common.py` | Scene and render setup (AgX Punchy), materials, mesh and light helpers, light linking |
| `post.py` | The camera-image pass (plain Pillow and numpy) |
| `devil.py` | The Devil: `build_devil(pose=…)`, its poses, the painted face card |
| `defender.py` | The three Defender proposals and the first-person arms |
| `gate.py` | The Hell Gate: `Outline`, `floor_with_hole`, `build_gate` |
| `stage_club.py` · `stage_library.py` · `stage_casino.py` | The three stages and their props |
| `weapons.py` | The six stage weapons |

## What a new shot should know

- **The pit is open by construction.** Build the stage floor with `gate.floor_with_hole` and never
  lay a slab across the hole.
- **Keep emission low.** AgX turns an over-bright saturated colour pale: LED floor about 0.5–1,
  screens about 1.5, lava about 3–5.
- **Character lights use light linking** (`common.light_only`), so a key or rim light on a Devil
  leaves no bright reflection on a glossy floor.
- `import bpy` comes before `import bmesh` and `mathutils`.
