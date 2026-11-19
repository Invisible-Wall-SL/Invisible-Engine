# Devil v2 — the rigged model, built by script

Everything in `docs/design/3d/boty/devil-v2/` comes out of these scripts: Blender 5.2 as a Python
module (`pip install bpy==5.2.*`), Cycles on the CPU, nothing downloaded and no image service.

```bash
python build.py --out <dir> --renders        # CH_devil.blend, CH_devil.glb, reports, all sheets
python build.py --out <dir> --renders --draft --size 1024   # the same in about a minute
python shots.py --out <dir> --shot look --draft             # look sheets only, procedural skin
```

## How the model is made

| File | What it does |
|---|---|
| `spec.py` | The numbers measured off the owner's turnaround: trunk rings, joints, tail and nose splines. |
| `meshkit.py` | A small quad-cage kit: rings, tubes, grid caps, grabs, domes, seams, creases. |
| `cage.py` | The body as one closed all-quad cage: trunk and head rings, limbs, digits, ears, eye sockets, mouth, crest, then the sculpt passes. Every vertex is tagged with its part, chain and place along it. |
| `skin.py` | Skin weights worked out from those tags (no painting), plus the masks the material and the face keys use. |
| `extras.py` | Separate closed shells at final density: claws, eyeballs, stitched teeth, tongue, brows, tuft. |
| `wings.py` | The wings: arm, three fingers, membrane with a scalloped edge, thumb claw. |
| `assemble.py` | Cage → one subdivision level → extras and wings joined into one skinned mesh; weights limited to 4. |
| `rig.py` | `RIG_ie_devil`: 64 deform bones under a root that never moves. |
| `controls.py` | The animator's layer on non-deform bones: root, COG, IK arms and legs with poles and an IK/FK switch, foot roll, FK spine, tail, wings, fingers, eye target; custom shapes and colours. |
| `actions.py` | Stored clips: `devil.rest`, `devil.action_pose`, `devil.fly_flap` (loop), `devil.idle` (loop). |
| `shapekeys.py` | Face keys on the full-detail mesh: `blink`, `open`, `snarl`. |
| `uv.py` | Seams chosen on the cage, unwrap, texel-density bias for head and hands, pack, layout report. |
| `material.py` | The procedural skin (mottle, lighter belly, darker extremities, eyes, teeth, claws) and its bake to base colour, roughness and normal; the game material that reads the baked maps. |
| `build.py` | Runs all of it, makes `CH_devil_LODU` (all quads) and the decimated `CH_devil_LOD0`, adds the sockets, runs `ie_validate`, saves the `.blend`, exports the GLB. |
| `shots.py` | The studio and every render sheet. |
| `preview.py` | Quick clay views of the bare cage, with an outline overlay on the reference. |

## What is in the `.blend`

- `CH_devil_LODU`: the full-detail mesh, all quads, shape keys, baked material `MAT_devil`.
- `CH_devil_LOD0`: the game mesh inside the hero budget (20k triangles), decimated from it.
- `RIG_ie_devil` with the control bones; sockets `SK_hand_l`, `SK_hand_r`, `SK_carry`, `SK_head`.
- The four actions (fake user), the three baked images packed, and `MAT_devil_procedural` kept so
  the textures can be baked again.

To change the shape, edit `spec.py` or `cage.py` and run `build.py` again: weights, UVs, textures,
keys and clips all follow.
