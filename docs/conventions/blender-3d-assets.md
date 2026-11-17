# 3D assets in Blender — conventions

Every 3D model, skeleton and animation clip that goes into a game is made in **Blender 5.2** to the
rules on this page. Follow them and `ie_validate.py` passes, the export is one command, and the
launcher can turn your one file into every quality tier (`ultra` / `full` / `half` / `quarter`).
Break them and the validator says which rule and where.

The rules are code, not only prose: `tools/blender/ie_conventions.py` holds every name, budget and
bone, and the validator reads it. If this page and that file ever disagree, **the file wins**; fix
this page. The why behind each rule is in the plan, [`design/3d-games.md`](../design/3d-games.md)
(§3 assets, §5 tiers, §7 where the evaluations disagreed). How to run the scripts:
[`tools/blender/README.md`](../../tools/blender/README.md).

## Units, axes, origins

| Rule | Value |
|---|---|
| Units | Metric, unit scale **1.0** (1 Blender unit = 1 m). A hero is about 1.8 m tall |
| Up / front | Blender is Z-up. **Characters and props face −Y** (Blender's Front view). The exporter's "+Y Up" turns that into glTF +Z forward |
| Transforms | **Applied**: rotation 0, scale 1 on every mesh and armature (Ctrl+A → All Transforms). A 90° rotation left on an object is the classic FBX bug |
| Origin | Heroes and props: **bottom centre** (between the feet, on the floor). Tiles: the **centre of the footprint at the walkable top** (z = 0 is the floor surface). Weapons: the **grip** (where it sits in `SK_hand_r`). FX meshes: free |
| Placement | Put the asset at the world origin; a mesh placed elsewhere exports offset |

## Names

| What | Pattern | Example |
|---|---|---|
| Hero mesh | `CH_<name>` | `CH_brawler_LOD0` |
| Weapon | `WP_<name>` | `WP_sword_LOD1` |
| Prop | `PR_<name>` | `PR_well_walls_LOD0` |
| Tile | `TL_<name>` | `TL_floor_stone_LOD0` |
| FX mesh | `FX_<name>` | `FX_shockwave` |
| LOD level | suffix `_LOD0`, `_LOD1`, … (no suffix = `LOD0`) | `PR_crate_LOD2` |
| Ultra-only top level | suffix `_LODU` (heroes and props only, always authored) | `CH_brawler_LODU` |
| Collision | suffix `_COL` (not exported as a mesh; its box goes into the GLB's data) | `PR_crate_COL` |
| Socket | an **Empty** `SK_<name>`, lower snake case, parented to a bone or the asset mesh | `SK_hand_r`, `SK_muzzle`, `SK_head_top` |
| Armature | `RIG_<skeleton>` | `RIG_ie_humanoid` |
| Clip (action) | `<set>.<clip>`, lower snake case | `locomotion.run_fwd`, `combat.sword_slash_1` |

The `<name>` part is letters, digits and underscores. Never leave Blender's `.001` duplicate suffix
on anything. Objects that are not meshes, armatures or `SK_` empties (cameras, lights, helper
empties) are ignored by the export, and the validator warns about them.

## Budgets: one master per asset

You author **one master**: the full LOD chain and power-of-two textures at the largest size any
tier needs. The launcher derives every tier from it; never make a tier by hand.

| Class | LOD chain (max tris per level) | Largest map (per map) | `full`-tier map | Materials |
|---|---|---|---|---|
| Hero (skinned) | `LODU` ≤ 60k · `LOD0` 20k · `LOD1` 10k · `LOD2` 5k · `LOD3` 2.5k | 4096² | 2048² | ≤ 2 |
| Weapon | `LOD0` 3k · `LOD1` 1.5k · `LOD2` 0.5k | 1024² | 1024² | 1 |
| Prop | `LODU` ≤ 15k · `LOD0` 6k · `LOD1` 3k · `LOD2` 1k · `LOD3` 0.3k | 2048² | 2048² | 1 |
| Tile | `LOD0` 2k · `LOD1` 0.5k | 1024² | 1024² | 1 |
| FX mesh | `LOD0` 0.5k (one level) | 512² | 512² | 1 |

- Only `LOD0` is required. Missing lower levels are **generated**: by the launcher at export, or by
  `ie_export.py --lods` when you want to see them in Blender first (marked
  `ie_lod_source = "generated"`). An authored `_LOD<n>` always beats a generated one. Expect to
  author hero `LOD0`–`LOD1` (face and silhouette) and anything whose generated level looks wrong.
- Every map is a **power of two** and **÷4** on both sides (KTX2 needs it; an unaligned page
  decodes to black). A map below the `full` size is only right for a **palette** or **ramp**:
  put that word in the image name.
- UV0 only, non-overlapping where it is baked, about 4 px padding at 1024. Quads and triangles
  only (n-gons are a warning: the exporter triangulates them however it likes).
- Normal maps are optional under the toon look, and the `quarter` tier always drops them.

### The tier rule

`ultra` = the master's own maps and the authored `_LODU` (desktop, opt-in) · `full` = `LOD0`–`LOD2`
with maps capped at the `full` size (desktop game, and the fallback for everything) · `half` = one
level and one mip down (web desktop) · `quarter` = two down, no normal/ORM maps (web mobile). The
exact tables are in [plan §5](../design/3d-games.md#5-quality-tiers-web-and-desktop-from-one-master).
You never touch them: a bigger master only buys the `ultra` copy.

## The IE Humanoid skeleton

**One skeleton for every humanoid hero**, so one clip library plays on all of them (three.js binds
tracks by bone name). Create it with `ie_humanoid.py` (or `ie_humanoid.create_armature()` over the
MCP); never build it by hand.

```
root                              (at the feet, never deforms, never moves)
└─ pelvis                         (hips: the only bone whose translation a clip keys)
   ├─ spine_01 ─ spine_02 ─ spine_03
   │                         ├─ neck_01 ─ head
   │                         ├─ clavicle_l ─ upperarm_l ─ lowerarm_l ─ hand_l
   │                         └─ clavicle_r ─ upperarm_r ─ lowerarm_r ─ hand_r ─ weapon_r (optional, no deform)
   ├─ thigh_l ─ calf_l ─ foot_l ─ ball_l
   └─ thigh_r ─ calf_r ─ foot_r ─ ball_r
```

- 24 bones, 22 deform. T-pose, facing −Y, the character's left on +X, every roll 0.
- **Fit a hero by moving joints along their bones**, never by re-aiming or re-rolling them: clips key
  rotations, which only transfer between rest poses that point the same way (the validator warns
  when a bone points more than 20° off the template).
- Skinning: **≤ 64 deform bones, ≤ 4 influences per vertex, weights normalised, every vertex
  weighted** (Weights → Limit Total, then Normalize All). Every LOD binds the same armature.
- A non-humanoid hero gets its own skeleton and its own clip libraries.

## Clips

| Rule | Value |
|---|---|
| Files | `anim/<skeleton>/<set>.glb`: the armature only, no mesh. Sets: `locomotion`, `combat`, `carry`, `reactions`, `emotes`; a hero's own moves go in `anim/<skeleton>/<hero>.glb` |
| Names | The action name is the clip name, `<set>.<clip>`. Renaming one breaks every game that uses it |
| Frame rate | **30 fps** (scene setting) |
| In place | **`root` never moves.** Gameplay moves the body and the clip follows. A lunge is gameplay displacement with a clip timed to it. Only camera moves and cinematics have root motion |
| Keys | Rotations on any bone, translation on `pelvis` only, **never scale** |
| Loops | First and last frames match; the loop flag lives in the animation doc, not the name |
| Saving | Give every action a **fake user** (the shield icon), or Blender drops unassigned clips on save |
| Events | Footsteps, sounds and FX cues are authored in the animation doc as `{clip, at, cue}`, not as markers (glTF has no events) |

Export with `ie_humanoid.export_clip_library()` or the **IE clip library** preset (below); it
samples every action and strips scale channels.

## Toon parameters

The look is toon-first: a base colour (often a shared palette) and a ramp. Set the toon parameters
as a **custom property group `toon` on the material** (Material Properties → Custom Properties);
they travel as glTF material `extras.toon`, which the runtime maps onto its toon material.

| Key | Type | Meaning |
|---|---|---|
| `ramp` | text | the ramp image's name |
| `outline` | number | outline width in metres, 0 = none |
| `outline_color` | 3–4 numbers | outline colour |
| `rim` | number 0–1 | rim-light strength |
| `rim_color` | 3–4 numbers | rim colour |

Node trees do not survive glTF (only Principled BSDF inputs do), so nothing else in the shader
reaches the game. Any other custom property on an object or material also travels as `extras`.

## Export presets

`tools/blender/presets/` holds the exporter settings the scripts use, as Blender operator presets.
Copy them into `%APPDATA%\Blender Foundation\Blender\5.2\scripts\presets\operator\export_scene.gltf\`
and pick **ie_asset** or **ie_clip_library** in File → Export → glTF 2.0. GLB, +Y up, applied
modifiers, extras on, selection only, **no Draco or meshopt** (the launcher compresses).

## Bringing in an FBX

`fbx_to_glb.py` imports, joins, applies the rotation and scale, decimates to the class's `LOD0`
budget, sets the origin, renames, downsizes the maps, validates and exports. The output is a
**reference** to retexture, not something to ship: BattleOTtheYear's FBX files are image-to-3D
output whose provenance is unconfirmed (plan §8).
