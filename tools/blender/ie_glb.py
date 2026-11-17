"""Read, inspect and rewrite a GLB's JSON chunk. Pure Python (no bpy), so CI tests it."""

from __future__ import annotations

import json
import struct

GLB_MAGIC = 0x46546C67
CHUNK_JSON = 0x4E4F534A
CHUNK_BIN = 0x004E4942


def read_glb(path: str) -> tuple[dict, bytes]:
    with open(path, 'rb') as fh:
        data = fh.read()
    magic, version, _length = struct.unpack_from('<III', data, 0)
    if magic != GLB_MAGIC or version != 2:
        raise ValueError(f'{path} is not a glTF 2.0 binary')
    gltf, binary, offset = None, b'', 12
    while offset < len(data):
        size, kind = struct.unpack_from('<II', data, offset)
        chunk = data[offset + 8:offset + 8 + size]
        if kind == CHUNK_JSON:
            gltf = json.loads(chunk.decode('utf-8'))
        elif kind == CHUNK_BIN:
            binary = chunk
        offset += 8 + size
    if gltf is None:
        raise ValueError(f'{path} has no JSON chunk')
    return gltf, binary


def write_glb(path: str, gltf: dict, binary: bytes) -> None:
    text = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    text += b' ' * (-len(text) % 4)
    binary += b'\0' * (-len(binary) % 4)
    chunks = struct.pack('<II', len(text), CHUNK_JSON) + text
    if binary:
        chunks += struct.pack('<II', len(binary), CHUNK_BIN) + binary
    with open(path, 'wb') as fh:
        fh.write(struct.pack('<III', GLB_MAGIC, 2, 12 + len(chunks)) + chunks)


def strip_scale_channels(gltf: dict) -> int:
    """Drop every `scale` animation channel (clips never key bone scale) and the samplers only
    they used. The orphaned accessors stay until the launcher's optimiser prunes them."""
    removed = 0
    for anim in gltf.get('animations', []):
        keep = [c for c in anim['channels'] if c['target'].get('path') != 'scale']
        removed += len(anim['channels']) - len(keep)
        used = sorted({c['sampler'] for c in keep})
        remap = {old: new for new, old in enumerate(used)}
        anim['samplers'] = [anim['samplers'][i] for i in used]
        for c in keep:
            c['sampler'] = remap[c['sampler']]
        anim['channels'] = keep
    return removed


def triangles(gltf: dict, mesh_index: int) -> int:
    total = 0
    for prim in gltf['meshes'][mesh_index]['primitives']:
        mode = prim.get('mode', 4)
        if 'indices' in prim:
            count = gltf['accessors'][prim['indices']]['count']
        else:
            count = gltf['accessors'][prim['attributes']['POSITION']]['count']
        total += count // 3 if mode == 4 else max(0, count - 2)
    return total


def describe(path: str) -> dict:
    """What a GLB holds, for reports and tests: nodes with tris and extras, animations, images."""
    gltf, binary = read_glb(path)
    nodes = []
    for node in gltf.get('nodes', []):
        entry = {'name': node.get('name')}
        if 'mesh' in node:
            entry['tris'] = triangles(gltf, node['mesh'])
        if 'skin' in node:
            entry['skinned'] = True
        if node.get('extras'):
            entry['extras'] = node['extras']
        nodes.append(entry)
    scene = gltf.get('scenes', [{}])[gltf.get('scene', 0)] if gltf.get('scenes') else {}
    return {
        'nodes': nodes,
        'sceneExtras': scene.get('extras'),
        'materials': [{'name': m.get('name'), 'extras': m.get('extras')} for m in gltf.get('materials', [])],
        'images': [i.get('name') or i.get('uri') for i in gltf.get('images', [])],
        'skins': [{'joints': len(s['joints'])} for s in gltf.get('skins', [])],
        'animations': [
            {
                'name': a.get('name'),
                'channels': len(a['channels']),
                'paths': sorted({c['target'].get('path') for c in a['channels']}),
            }
            for a in gltf.get('animations', [])
        ],
        'extensionsUsed': gltf.get('extensionsUsed', []),
        'binBytes': len(binary),
    }
