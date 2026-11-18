"""The 3D asset conventions as data, and the rules that check a scene against them.

Pure Python, no `bpy`: `ie_validate.py` collects plain *facts* from Blender and hands them to
`check_facts()`, so every rule here runs (and is tested) without Blender. The artist-facing page is
docs/conventions/blender-3d-assets.md; the plan is docs/design/3d-games.md (§3, §5, §7).
"""

from __future__ import annotations

import math
import re

REPORT_VERSION = 1
CLIP_FPS = 30

# Per class: name prefix, master LOD chain (tris per level), the largest master texture, the `full`
# tier's map size (a smaller master is upscaled by nothing, so it is only a warning), and how many
# materials one mesh should carry.
CLASSES: dict[str, dict] = {
    'hero': {
        'prefix': 'CH',
        'lods': {'LODU': 60000, 'LOD0': 20000, 'LOD1': 10000, 'LOD2': 5000, 'LOD3': 2500},
        'tex_max': 4096,
        'tex_full': 2048,
        'materials_max': 2,
        'skinned': True,
        'origin': 'bottom',
    },
    'weapon': {
        'prefix': 'WP',
        'lods': {'LOD0': 3000, 'LOD1': 1500, 'LOD2': 500},
        'tex_max': 1024,
        'tex_full': 1024,
        'materials_max': 1,
        'skinned': False,
        'origin': 'grip',
    },
    'prop': {
        'prefix': 'PR',
        'lods': {'LODU': 15000, 'LOD0': 6000, 'LOD1': 3000, 'LOD2': 1000, 'LOD3': 300},
        'tex_max': 2048,
        'tex_full': 2048,
        'materials_max': 1,
        'skinned': False,
        'origin': 'bottom',
    },
    'tile': {
        'prefix': 'TL',
        'lods': {'LOD0': 2000, 'LOD1': 500},
        'tex_max': 1024,
        'tex_full': 1024,
        'materials_max': 1,
        'skinned': False,
        'origin': 'top',
    },
    'fx': {
        'prefix': 'FX',
        'lods': {'LOD0': 500},
        'tex_max': 512,
        'tex_full': 512,
        'materials_max': 1,
        'skinned': False,
        'origin': 'any',
    },
}
PREFIX_CLASS = {spec['prefix']: cls for cls, spec in CLASSES.items()}

NAME_RE = re.compile(
    r'^(?P<prefix>CH|WP|PR|TL|FX)_(?P<name>[A-Za-z0-9]+(?:_[A-Za-z0-9]+)*?)'
    r'(?:_(?P<suffix>LOD\d|LODU|COL))?$'
)
SOCKET_RE = re.compile(r'^SK_[a-z0-9]+(?:_[a-z0-9]+)*$')
RIG_RE = re.compile(r'^RIG_[a-z0-9]+(?:_[a-z0-9]+)*$')
ACTION_RE = re.compile(r'^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$')
DUPLICATE_SUFFIX_RE = re.compile(r'\.\d{3}$')
TEXTURE_EXEMPT_RE = re.compile(r'(palette|ramp)', re.IGNORECASE)

# A hero's first-person viewmodel is a second hero asset `CH_<hero>_vm`: its arms on the same
# skeleton, posed by the `viewmodel.<clip>` set, drawn at the camera with `SK_eye` (on `head`) on
# the eye. Its geometry floats at arm height, so the floor-origin rule does not apply; the rig's
# origin is still at the feet.
VIEWMODEL_SUFFIX = '_vm'
VIEWMODEL_EYE = 'SK_eye'


def is_viewmodel(cls: str, aid: str) -> bool:
    return cls == 'hero' and aid.endswith(VIEWMODEL_SUFFIX)


MAX_DEFORM_BONES = 64
MAX_INFLUENCES = 4
WEIGHT_TOLERANCE = 1e-3
TRANSFORM_TOLERANCE = 1e-4
BONE_DIRECTION_TOLERANCE_DEG = 20.0

# The IE Humanoid: one shared skeleton for every humanoid hero, so one clip library plays on all of
# them (three.js binds tracks by bone name). T-pose, 1.8 m, facing Blender -Y (glTF +Z), left side
# on +X. Rolls are 0. A hero may move joints to fit its proportions but keeps every name, parent and
# direction: clips key rotations, which only transfer between rest poses that point the same way.
# (name, parent, head, tail, deform, required)
HUMANOID_SKELETON = 'ie_humanoid'
HUMANOID_BONES: list[tuple[str, str | None, tuple, tuple, bool, bool]] = [
    ('root', None, (0, 0, 0), (0, 0, 0.3), False, True),
    ('pelvis', 'root', (0, 0, 0.95), (0, 0, 1.05), True, True),
    ('spine_01', 'pelvis', (0, 0, 1.05), (0, 0, 1.18), True, True),
    ('spine_02', 'spine_01', (0, 0, 1.18), (0, 0, 1.31), True, True),
    ('spine_03', 'spine_02', (0, 0, 1.31), (0, 0, 1.45), True, True),
    ('neck_01', 'spine_03', (0, 0, 1.45), (0, 0, 1.55), True, True),
    ('head', 'neck_01', (0, 0, 1.55), (0, 0, 1.80), True, True),
    ('clavicle_l', 'spine_03', (0.02, 0, 1.42), (0.17, 0, 1.42), True, True),
    ('upperarm_l', 'clavicle_l', (0.17, 0, 1.42), (0.45, 0, 1.42), True, True),
    ('lowerarm_l', 'upperarm_l', (0.45, 0, 1.42), (0.70, 0, 1.42), True, True),
    ('hand_l', 'lowerarm_l', (0.70, 0, 1.42), (0.80, 0, 1.42), True, True),
    ('clavicle_r', 'spine_03', (-0.02, 0, 1.42), (-0.17, 0, 1.42), True, True),
    ('upperarm_r', 'clavicle_r', (-0.17, 0, 1.42), (-0.45, 0, 1.42), True, True),
    ('lowerarm_r', 'upperarm_r', (-0.45, 0, 1.42), (-0.70, 0, 1.42), True, True),
    ('hand_r', 'lowerarm_r', (-0.70, 0, 1.42), (-0.80, 0, 1.42), True, True),
    ('weapon_r', 'hand_r', (-0.78, 0, 1.42), (-0.78, -0.15, 1.42), False, False),
    ('thigh_l', 'pelvis', (0.10, 0, 0.95), (0.10, 0, 0.52), True, True),
    ('calf_l', 'thigh_l', (0.10, 0, 0.52), (0.10, 0, 0.10), True, True),
    ('foot_l', 'calf_l', (0.10, 0, 0.10), (0.10, -0.12, 0.02), True, True),
    ('ball_l', 'foot_l', (0.10, -0.12, 0.02), (0.10, -0.20, 0.02), True, True),
    ('thigh_r', 'pelvis', (-0.10, 0, 0.95), (-0.10, 0, 0.52), True, True),
    ('calf_r', 'thigh_r', (-0.10, 0, 0.52), (-0.10, 0, 0.10), True, True),
    ('foot_r', 'calf_r', (-0.10, 0, 0.10), (-0.10, -0.12, 0.02), True, True),
    ('ball_r', 'foot_r', (-0.10, -0.12, 0.02), (-0.10, -0.20, 0.02), True, True),
]
SKELETONS = {HUMANOID_SKELETON: {b[0]: b for b in HUMANOID_BONES}}
HIPS_BONE = 'pelvis'
ROOT_BONE = 'root'

# Toon parameters: a material custom property `toon` (a group), exported as glTF material
# `extras.toon`, which the runtime maps onto its toon material. Name -> accepted Python types.
TOON_KEYS: dict[str, tuple[type, ...]] = {
    'ramp': (str,),
    'outline': (int, float),
    'outline_color': (list, tuple),
    'rim': (int, float),
    'rim_color': (list, tuple),
}

# glTF exporter settings. One source for the scripts and the committed operator presets
# (presets/*.py; test_ie_conventions.py keeps them in sync). Compression is the launcher's job.
EXPORT_COMMON: dict[str, object] = {
    'export_format': 'GLB',
    'export_yup': True,
    'export_apply': True,
    'export_extras': True,
    'export_texcoords': True,
    'export_normals': True,
    'export_tangents': False,
    'export_cameras': False,
    'export_lights': False,
    'export_draco_mesh_compression_enable': False,
    'export_meshopt_compression_enable': False,
    'export_use_gltfpack': False,
    'use_selection': True,
}
ASSET_EXPORT_SETTINGS: dict[str, object] = {
    **EXPORT_COMMON,
    'export_materials': 'EXPORT',
    'export_image_format': 'AUTO',
    'export_skins': True,
    'export_influence_nb': MAX_INFLUENCES,
    'export_all_influences': False,
    'export_animations': False,
    'export_morph': True,
}
CLIP_EXPORT_SETTINGS: dict[str, object] = {
    **EXPORT_COMMON,
    'export_materials': 'NONE',
    'export_skins': True,
    'export_def_bones': False,
    'export_leaf_bone': False,
    'export_animations': True,
    'export_animation_mode': 'ACTIONS',
    'export_force_sampling': True,
    'export_frame_step': 1,
    'export_anim_slide_to_zero': True,
    'export_reset_pose_bones': True,
    'export_optimize_animation_size': True,
    'export_optimize_animation_keep_anim_armature': True,
    'export_bake_animation': False,
    'export_morph': False,
}

# Every issue the validator can raise, with its severity. A code is the stable contract the Model
# Viewer and the tests read; the message is for people.
ISSUES: dict[str, str] = {
    'UNIT_SCALE': 'error',
    'NAME_UNKNOWN': 'error',
    'NAME_DUPLICATE_SUFFIX': 'error',
    'LOD_LEVEL_INVALID': 'error',
    'LOD_DUPLICATE': 'error',
    'LOD_MISSING_BASE': 'error',
    'TRANSFORM_NOT_APPLIED': 'error',
    'ORIGIN': 'error',
    'TRIS_OVER_BUDGET': 'error',
    'NO_UV': 'error',
    'TEXTURE_NOT_POW2': 'error',
    'TEXTURE_NOT_DIV4': 'error',
    'TEXTURE_OVER_MAX': 'error',
    'HERO_NOT_SKINNED': 'error',
    'SKELETON_UNKNOWN_BONE': 'error',
    'SKELETON_MISSING_BONE': 'error',
    'SKELETON_WRONG_PARENT': 'error',
    'DEFORM_BONES_OVER': 'error',
    'INFLUENCES_OVER': 'error',
    'WEIGHTS_NOT_NORMALISED': 'error',
    'UNWEIGHTED_VERTICES': 'error',
    'ACTION_NAME': 'error',
    'CLIP_FPS': 'error',
    'BONE_SCALE_KEYS': 'error',
    'ROOT_MOTION': 'error',
    'CLIPS_HAVE_MESH': 'error',
    'SOCKET_NAME': 'error',
    'RIG_NAME': 'error',
    'TOON_PROPERTY': 'error',
    'NGONS': 'warning',
    'LOOSE_GEOMETRY': 'warning',
    'EXTRA_UV': 'warning',
    'MATERIALS_OVER': 'warning',
    'TEXTURE_BELOW_FULL': 'warning',
    'ORIGIN_TILE': 'warning',
    'OBJECT_OFFSET': 'warning',
    'LOD_GAP': 'warning',
    'BONE_DIRECTION': 'warning',
    'BONE_LOCATION_KEYS': 'warning',
    'VERTEX_GROUP_NO_BONE': 'warning',
    'SOCKET_UNPARENTED': 'warning',
    'VIEWMODEL_NO_EYE': 'error',
    'OBJECT_IGNORED': 'warning',
    'ACTIONS_IN_ASSET': 'warning',
    'OBJECT_ACTION_IN_CLIPS': 'warning',
    'TOON_UNKNOWN_KEY': 'warning',
}


def parse_name(name: str) -> dict | None:
    """`PR_crate_LOD1` -> {class: 'prop', id: 'PR_crate', suffix: 'LOD1'}; None if not an asset."""
    m = NAME_RE.match(name)
    if not m:
        return None
    return {
        'class': PREFIX_CLASS[m['prefix']],
        'id': f"{m['prefix']}_{m['name']}",
        'suffix': m['suffix'],
    }


def lod_level(suffix: str | None) -> str | None:
    """The LOD level a mesh name stands for: no suffix is LOD0, `_COL` is not a level."""
    if suffix is None:
        return 'LOD0'
    return None if suffix == 'COL' else suffix


def is_pow2(n: int) -> bool:
    return n > 0 and (n & (n - 1)) == 0


def lod_targets(cls: str, lod0_tris: int) -> dict[str, int]:
    """Tris for each generated level below LOD0: the class's proportions, capped by its budget."""
    lods = CLASSES[cls]['lods']
    base = lods['LOD0']
    return {
        level: max(1, min(budget, round(lod0_tris * budget / base)))
        for level, budget in lods.items()
        if level.startswith('LOD') and level not in ('LODU', 'LOD0')
    }


class _Report:
    def __init__(self) -> None:
        self.issues: list[dict] = []

    def add(self, code: str, message: str, obj: str | None = None) -> None:
        self.issues.append({'severity': ISSUES[code], 'code': code, 'object': obj, 'message': message})


def _near(a: float, b: float, tol: float = TRANSFORM_TOLERANCE) -> bool:
    return abs(a - b) <= tol


def _check_transform(rep: _Report, o: dict) -> None:
    rot_ok = all(_near(v, 0.0) for v in o['rotation'])
    scale_ok = all(_near(v, 1.0) for v in o['scale'])
    if not (rot_ok and scale_ok):
        rep.add(
            'TRANSFORM_NOT_APPLIED',
            f"rotation {[round(math.degrees(v), 2) for v in o['rotation']]}° scale "
            f"{[round(v, 4) for v in o['scale']]}: apply them (Ctrl+A → All Transforms)",
            o['name'],
        )


def _check_origin(rep: _Report, o: dict, cls: str) -> None:
    mn, mx = o['mesh']['bbox_min'], o['mesh']['bbox_max']
    ext = [mx[i] - mn[i] for i in range(3)]
    centre = [(mx[i] + mn[i]) / 2 for i in range(2)]
    xy_tol = max(0.01, 0.05 * max(ext[0], ext[1]))
    z_tol = max(0.01, 0.02 * ext[2])
    rule = CLASSES[cls]['origin']
    centred = abs(centre[0]) <= xy_tol and abs(centre[1]) <= xy_tol
    if rule == 'bottom' and not (centred and abs(mn[2]) <= z_tol):
        rep.add(
            'ORIGIN',
            f'origin must be bottom centre: footprint centre at {[round(c, 3) for c in centre]}, '
            f'lowest point z={mn[2]:.3f}',
            o['name'],
        )
    elif rule == 'top' and not (centred and abs(mx[2]) <= z_tol):
        rep.add(
            'ORIGIN_TILE',
            f'tile origin should be the footprint centre at the walkable top (z=0): footprint '
            f'centre {[round(c, 3) for c in centre]}, top z={mx[2]:.3f}',
            o['name'],
        )


def _check_mesh(rep: _Report, o: dict, cls: str) -> None:
    mesh = o['mesh']
    if mesh['uv_layers'] == 0:
        rep.add('NO_UV', 'no UV map: unwrap it (UV0 only)', o['name'])
    elif mesh['uv_layers'] > 1:
        rep.add('EXTRA_UV', f"{mesh['uv_layers']} UV maps: only UV0 is used", o['name'])
    if mesh['ngons']:
        rep.add('NGONS', f"{mesh['ngons']} faces with more than 4 sides", o['name'])
    if mesh['loose_verts'] or mesh['loose_edges']:
        rep.add(
            'LOOSE_GEOMETRY',
            f"{mesh['loose_verts']} loose vertices, {mesh['loose_edges']} loose edges",
            o['name'],
        )
    if len(mesh['materials']) > CLASSES[cls]['materials_max']:
        rep.add(
            'MATERIALS_OVER',
            f"{len(mesh['materials'])} materials (a {cls} carries at most "
            f"{CLASSES[cls]['materials_max']})",
            o['name'],
        )


def _check_skin(rep: _Report, o: dict, bones_by_rig: dict[str, dict]) -> None:
    mesh = o['mesh']
    rig = mesh.get('armature')
    if not rig:
        rep.add('HERO_NOT_SKINNED', 'a hero mesh must be skinned to the IE Humanoid armature', o['name'])
        return
    bones = bones_by_rig.get(rig, {})
    strays = [g for g in mesh['vertex_groups'] if g not in bones]
    if strays:
        rep.add('VERTEX_GROUP_NO_BONE', f'vertex groups with no bone: {strays[:8]}', o['name'])
    if mesh['max_influences'] > MAX_INFLUENCES:
        rep.add(
            'INFLUENCES_OVER',
            f"{mesh['over_influence_verts']} vertices have more than {MAX_INFLUENCES} bone "
            f"influences (max {mesh['max_influences']}): Weights → Limit Total",
            o['name'],
        )
    if mesh['unnormalised_verts']:
        rep.add(
            'WEIGHTS_NOT_NORMALISED',
            f"{mesh['unnormalised_verts']} vertices whose weights do not sum to 1: "
            'Weights → Normalize All',
            o['name'],
        )
    if mesh['unweighted_verts']:
        rep.add(
            'UNWEIGHTED_VERTICES',
            f"{mesh['unweighted_verts']} vertices have no bone weight",
            o['name'],
        )


def _check_textures(rep: _Report, images: list[dict], cls: str, owner: str) -> list[dict]:
    spec = CLASSES[cls]
    out = []
    for img in images:
        w, h, name = img['w'], img['h'], img['name']
        out.append({'name': name, 'w': w, 'h': h})
        if not (is_pow2(w) and is_pow2(h)):
            rep.add('TEXTURE_NOT_POW2', f'{name} is {w}×{h}: sizes must be powers of two', owner)
        if w % 4 or h % 4:
            rep.add('TEXTURE_NOT_DIV4', f'{name} is {w}×{h}: KTX2 needs both sides ÷4', owner)
        if max(w, h) > spec['tex_max']:
            rep.add(
                'TEXTURE_OVER_MAX',
                f"{name} is {w}×{h}: a {cls} master map is at most {spec['tex_max']}²",
                owner,
            )
        elif max(w, h) < spec['tex_full'] and not TEXTURE_EXEMPT_RE.search(name):
            rep.add(
                'TEXTURE_BELOW_FULL',
                f"{name} is {w}×{h}, below the `full` tier's {spec['tex_full']}²; fine for a "
                'palette or ramp (put that in its name), otherwise the master is too small',
                owner,
            )
    return out


def _check_toon(rep: _Report, mat: dict) -> None:
    toon = mat.get('custom', {}).get('toon')
    if toon is None:
        return
    if not isinstance(toon, dict):
        rep.add('TOON_PROPERTY', '`toon` must be a group of properties', mat['name'])
        return
    for key, value in toon.items():
        if key not in TOON_KEYS:
            rep.add('TOON_UNKNOWN_KEY', f'unknown toon key `{key}`', mat['name'])
        elif not isinstance(value, TOON_KEYS[key]) or isinstance(value, bool):
            rep.add('TOON_PROPERTY', f'toon `{key}` has the wrong type ({type(value).__name__})', mat['name'])
        elif key.endswith('_color') and len(value) not in (3, 4):
            rep.add('TOON_PROPERTY', f'toon `{key}` needs 3 or 4 numbers', mat['name'])


def _check_armature(rep: _Report, arm: dict) -> dict:
    name = arm['object']
    skeleton = arm.get('skeleton') or HUMANOID_SKELETON
    if not RIG_RE.match(name):
        rep.add('RIG_NAME', 'name the armature object `RIG_<skeleton>`, e.g. RIG_ie_humanoid', name)
    bones = {b['name']: b for b in arm['bones']}
    deform = [b for b in arm['bones'] if b['deform']]
    if len(deform) > MAX_DEFORM_BONES:
        rep.add('DEFORM_BONES_OVER', f'{len(deform)} deform bones (max {MAX_DEFORM_BONES})', name)
    template = SKELETONS.get(skeleton)
    if template is not None:
        unknown = sorted(set(bones) - set(template))
        missing = sorted(b for b, t in template.items() if t[5] and b not in bones)
        if unknown:
            rep.add('SKELETON_UNKNOWN_BONE', f'bones not in {skeleton}: {unknown}', name)
        if missing:
            rep.add('SKELETON_MISSING_BONE', f'{skeleton} bones missing: {missing}', name)
        for bname, b in bones.items():
            t = template.get(bname)
            if t is None:
                continue
            if b['parent'] != t[1]:
                rep.add(
                    'SKELETON_WRONG_PARENT',
                    f'{bname} is parented to {b["parent"]}, the skeleton says {t[1]}',
                    name,
                )
            angle = _angle_deg(_sub(b['tail'], b['head']), _sub(t[3], t[2]))
            if angle is not None and angle > BONE_DIRECTION_TOLERANCE_DEG:
                rep.add(
                    'BONE_DIRECTION',
                    f'{bname} points {angle:.0f}° away from the template: clips key rotations, '
                    'so a bone must keep its direction (move joints along the bone, never re-aim)',
                    name,
                )
    return {
        'name': name,
        'skeleton': skeleton,
        'bones': len(bones),
        'deformBones': len(deform),
    }


def _sub(a, b) -> list[float]:
    return [a[i] - b[i] for i in range(3)]


def _angle_deg(a, b) -> float | None:
    la = math.sqrt(sum(v * v for v in a))
    lb = math.sqrt(sum(v * v for v in b))
    if la < 1e-9 or lb < 1e-9:
        return None
    dot = max(-1.0, min(1.0, sum(a[i] * b[i] for i in range(3)) / (la * lb)))
    return math.degrees(math.acos(dot))


def _check_action(rep: _Report, act: dict) -> dict:
    name = act['name']
    if not ACTION_RE.match(name):
        rep.add(
            'ACTION_NAME',
            'name clips `<set>.<clip>` in lower snake case, e.g. locomotion.run_fwd',
            name,
        )
    scale_bones = sorted({c['bone'] for c in act['channels'] if c['bone'] and c['prop'] == 'scale'})
    if scale_bones:
        rep.add('BONE_SCALE_KEYS', f'scale keyed on {scale_bones}: clips never key bone scale', name)
    root_moves = [
        c for c in act['channels']
        if c['bone'] == ROOT_BONE and c['prop'] != 'scale' and (c['varies'] or not c['at_rest'])
    ]
    if root_moves:
        rep.add('ROOT_MOTION', '`root` is keyed away from rest: clips are in place, root never moves', name)
    moved = sorted({
        c['bone'] for c in act['channels']
        if c['bone'] not in (None, ROOT_BONE, HIPS_BONE) and c['prop'] == 'location' and c['varies']
    })
    if moved:
        rep.add(
            'BONE_LOCATION_KEYS',
            f'location keyed on {moved}: key rotations only (plus {HIPS_BONE} translation), '
            'or the clip will not fit other heroes',
            name,
        )
    return {'name': name, 'frames': act['frame_range']}


def check_facts(facts: dict, kind: str = 'auto') -> dict:
    """Every rule over the facts `ie_validate.collect_facts()` gathered. Returns the report."""
    rep = _Report()
    if facts['unit']['system'] != 'METRIC' or not _near(facts['unit']['scale'], 1.0):
        rep.add('UNIT_SCALE', f"scene units are {facts['unit']}: use Metric, unit scale 1.0")

    objects = facts['objects']
    meshes = [o for o in objects if o['type'] == 'MESH']
    if kind == 'auto':
        kind = 'clips' if not meshes and facts['actions'] else 'asset'

    bones_by_rig = {a['object']: {b['name'] for b in a['bones']} for a in facts['armatures']}
    armatures = [_check_armature(rep, a) for a in facts['armatures']]

    assets: dict[str, dict] = {}
    levels_seen: dict[str, dict[str, str]] = {}
    for o in objects:
        name = o['name']
        if DUPLICATE_SUFFIX_RE.search(name):
            rep.add('NAME_DUPLICATE_SUFFIX', 'a Blender duplicate suffix (.001): rename it', name)
        if o['type'] == 'ARMATURE':
            _check_transform(rep, o)
            continue
        if o['type'] == 'EMPTY':
            if name.startswith('SK_'):
                if not SOCKET_RE.match(name):
                    rep.add('SOCKET_NAME', 'sockets are `SK_<name>` in lower snake case', name)
                if not o['parent']:
                    rep.add('SOCKET_UNPARENTED', 'parent the socket to a bone or the asset mesh', name)
                if not all(_near(v, 1.0) for v in o['scale']):
                    rep.add('TRANSFORM_NOT_APPLIED', 'a socket keeps scale 1', name)
            else:
                rep.add('OBJECT_IGNORED', 'an empty that is not an `SK_` socket is not exported', name)
            continue
        if o['type'] != 'MESH':
            rep.add('OBJECT_IGNORED', f"a {o['type'].lower()} is not part of an asset", name)
            continue
        if kind == 'clips':
            rep.add('CLIPS_HAVE_MESH', 'a clip library holds the armature only', name)
            continue
        parsed = parse_name(name)
        if parsed is None:
            rep.add(
                'NAME_UNKNOWN',
                'a mesh is named `CH_|WP_|PR_|TL_|FX_<name>` with an optional '
                '`_LOD<n>`, `_LODU` or `_COL`',
                name,
            )
            continue
        cls, aid = parsed['class'], parsed['id']
        asset = assets.setdefault(
            aid, {'id': aid, 'class': cls, 'lods': [], 'collision': [], 'sockets': [], 'textures': []}
        )
        _check_transform(rep, o)
        if o['parent'] is None and any(not _near(v, 0.0, 1e-3) for v in o['location']):
            rep.add('OBJECT_OFFSET', f"placed at {[round(v, 3) for v in o['location']]}, not the world origin", name)
        if parsed['suffix'] == 'COL':
            asset['collision'].append(name)
            continue
        level = lod_level(parsed['suffix'])
        budgets = CLASSES[cls]['lods']
        if level not in budgets:
            rep.add('LOD_LEVEL_INVALID', f'a {cls} has levels {list(budgets)}', name)
            continue
        seen = levels_seen.setdefault(aid, {})
        if level in seen:
            rep.add('LOD_DUPLICATE', f'{level} is already {seen[level]}', name)
            continue
        seen[level] = name
        tris = o['mesh']['tris']
        asset['lods'].append({'level': level, 'object': name, 'tris': tris, 'budget': budgets[level]})
        if tris > budgets[level]:
            rep.add('TRIS_OVER_BUDGET', f'{tris} tris, the {cls} {level} budget is {budgets[level]}', name)
        _check_mesh(rep, o, cls)
        if level in ('LOD0', 'LODU') and not is_viewmodel(cls, aid):
            _check_origin(rep, o, cls)
        if CLASSES[cls]['skinned']:
            _check_skin(rep, o, bones_by_rig)

    materials = {m['name']: m for m in facts['materials']}
    images = {i['name']: i for i in facts['images']}
    for aid, asset in assets.items():
        seen = levels_seen.get(aid, {})
        if seen and 'LOD0' not in seen:
            rep.add('LOD_MISSING_BASE', 'an asset needs a LOD0 (or an unsuffixed) mesh', aid)
        order = [lv for lv in CLASSES[asset['class']]['lods'] if lv != 'LODU']
        present = [i for i, lv in enumerate(order) if lv in seen]
        if present and present != list(range(present[0], present[-1] + 1)):
            rep.add('LOD_GAP', f'authored levels skip one: {sorted(seen)}', aid)
        asset['lods'].sort(key=lambda lv: (lv['level'] != 'LODU', lv['level']))
        asset_mats = sorted({
            m for o in meshes if (parse_name(o['name']) or {}).get('id') == aid
            for m in o['mesh']['materials']
        })
        asset_imgs = sorted({i for m in asset_mats for i in materials.get(m, {}).get('images', [])})
        asset['textures'] = _check_textures(
            rep, [images[i] for i in asset_imgs if i in images], asset['class'], aid
        )
        asset['sockets'] = sorted(
            o['name'] for o in objects
            if o['type'] == 'EMPTY' and o['name'].startswith('SK_')
            and (o['parent'] in seen.values() or o['parent'] in bones_by_rig)
        )
        if is_viewmodel(asset['class'], aid) and VIEWMODEL_EYE not in asset['sockets']:
            rep.add('VIEWMODEL_NO_EYE', f'a viewmodel needs an `{VIEWMODEL_EYE}` socket on the head', aid)
    for m in facts['materials']:
        _check_toon(rep, m)

    actions = []
    if facts['actions']:
        if facts['fps'] != CLIP_FPS:
            rep.add('CLIP_FPS', f"scene runs at {facts['fps']} fps: clips are authored at {CLIP_FPS}")
        if kind == 'asset' and assets:
            rep.add(
                'ACTIONS_IN_ASSET',
                'clips belong in a clip library (anim/<skeleton>/<set>.glb); the asset export '
                'leaves them out',
            )
        for act in facts['actions']:
            actions.append(_check_action(rep, act))
            if kind == 'clips' and any(c['bone'] is None for c in act['channels']):
                rep.add('OBJECT_ACTION_IN_CLIPS', 'keys an object, not bones: it is not exported', act['name'])

    errors = sum(1 for i in rep.issues if i['severity'] == 'error')
    return {
        'tool': 'ie_validate',
        'version': REPORT_VERSION,
        'blender': facts['blender'],
        'file': facts['file'],
        'kind': kind,
        'ok': errors == 0,
        'errors': errors,
        'warnings': len(rep.issues) - errors,
        'assets': sorted(assets.values(), key=lambda a: a['id']),
        'armatures': armatures,
        'actions': actions,
        'issues': rep.issues,
    }


_JSON_TYPES = {
    'object': dict, 'array': list, 'string': str, 'boolean': bool, 'null': type(None),
    'integer': int, 'number': (int, float),
}


def schema_errors(value, schema: dict, path: str = '$') -> list[str]:
    """The subset of JSON Schema report.schema.json uses (type, const, enum, pattern, minimum,
    required, properties, additionalProperties, items), with no dependency, so CI and Blender's
    Python both run it."""
    errs: list[str] = []
    if 'type' in schema:
        types = schema['type'] if isinstance(schema['type'], list) else [schema['type']]
        ok = any(
            isinstance(value, _JSON_TYPES[t]) and not (t in ('integer', 'number') and isinstance(value, bool))
            for t in types
        )
        if not ok:
            return [f'{path}: expected {types}, got {type(value).__name__}']
    if 'const' in schema and value != schema['const']:
        errs.append(f"{path}: expected {schema['const']!r}")
    if 'enum' in schema and value not in schema['enum']:
        errs.append(f'{path}: {value!r} not in {schema["enum"]}')
    if 'pattern' in schema and isinstance(value, str) and not re.search(schema['pattern'], value):
        errs.append(f'{path}: {value!r} does not match {schema["pattern"]}')
    if 'minimum' in schema and isinstance(value, (int, float)) and value < schema['minimum']:
        errs.append(f'{path}: {value} < {schema["minimum"]}')
    if isinstance(value, dict):
        props = schema.get('properties', {})
        errs += [f'{path}: missing {k}' for k in schema.get('required', []) if k not in value]
        for k, v in value.items():
            if k in props:
                errs += schema_errors(v, props[k], f'{path}.{k}')
            elif schema.get('additionalProperties') is False:
                errs.append(f'{path}: unexpected {k}')
    if isinstance(value, list) and 'items' in schema:
        for i, v in enumerate(value):
            errs += schema_errors(v, schema['items'], f'{path}[{i}]')
    return errs


def operator_preset(settings: dict[str, object]) -> str:
    """A Blender operator preset file for the glTF exporter (File → Export → glTF → presets)."""
    lines = ['import bpy', 'op = bpy.context.active_operator', '']
    lines += [f'op.{k} = {v!r}' for k, v in settings.items()]
    return '\n'.join(lines) + '\n'


PRESETS = {'ie_asset.py': ASSET_EXPORT_SETTINGS, 'ie_clip_library.py': CLIP_EXPORT_SETTINGS}

if __name__ == '__main__':
    import os

    here = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'presets')
    for name, settings in PRESETS.items():
        with open(os.path.join(here, name), 'w', encoding='utf-8', newline='\n') as fh:
            fh.write(operator_preset(settings))
        print(f'wrote presets/{name}')
