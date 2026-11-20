#!/usr/bin/env python3
"""Draw the grey block-figure guide images for a character's five drawn facings.

    python3 scripts/salmons/facing-guides.py out_dir/

Writes `guide_<body>_<facing>.png` (1024 x 1024) for each body (quadruped, biped, chibi_bear,
chibi_fisherman) and each facing (n, ne, e, se, s). A guide is the second reference image of an
image-edit render: it fixes which way the character faces
(`docs/design/character-facings-network.md`, section 8, "Second pass"). It does not fix the
figure's size or foot line: `normalise-facing-stills.py` does that afterwards.

One fixed orthographic camera (2:1 isometric: 30 degrees above the horizon), one scale and one
ground anchor per body, so the five facings differ only by the model's turn about the vertical
axis. A body is a list of boxes; add one to BODIES for a new build of character. Z-buffered.

Needs Pillow and numpy.
"""
import math, sys
import numpy as np
from PIL import Image, ImageDraw

SIZE = 1024          # canvas, square
FILL = 0.60          # the largest facing's extent, as a share of the canvas
ANCHOR = (512, 840)  # where the centre of the footprint on the ground is drawn
PITCH = math.radians(30)
BG = (225, 225, 225)
SS = 3               # supersampling
LIGHT = (-0.35, -0.55, 0.76)  # world: x right, y away from the viewer, z up
# heading of the model's forward (+x) axis, degrees anticlockwise from screen-right on the ground
FACINGS = {'e': 0, 'ne': 45, 'n': 90, 's': -90, 'se': -45}

# Boxes: (x0, x1, y0, y1, z0, z1, tone). Model space: +x forward, +y the character's left, z up.
QUADRUPED = [
    (-1.00, 1.00, -0.45, 0.45, 0.60, 1.30, 1.00),   # body
    (1.00, 1.55, -0.32, 0.32, 0.80, 1.35, 1.00),    # head
    (1.55, 1.85, -0.16, 0.16, 0.85, 1.08, 0.80),    # muzzle
    (1.05, 1.20, -0.32, -0.18, 1.35, 1.50, 0.80),   # ears
    (1.05, 1.20, 0.18, 0.32, 1.35, 1.50, 0.80),
    (0.55, 0.90, -0.45, -0.15, 0.0, 0.60, 0.90),    # front legs
    (0.55, 0.90, 0.15, 0.45, 0.0, 0.60, 0.90),
    (-0.90, -0.55, -0.45, -0.15, 0.0, 0.60, 0.90),  # hind legs
    (-0.90, -0.55, 0.15, 0.45, 0.0, 0.60, 0.90),
]
BIPED = [
    (-0.14, 0.14, -0.30, -0.04, 0.0, 0.95, 0.90),   # legs
    (-0.14, 0.14, 0.04, 0.30, 0.0, 0.95, 0.90),
    (-0.14, 0.26, -0.30, -0.04, 0.0, 0.10, 0.80),   # boots, toes forward
    (-0.14, 0.26, 0.04, 0.30, 0.0, 0.10, 0.80),
    (-0.17, 0.17, -0.32, 0.32, 0.95, 1.65, 1.00),   # torso
    (-0.10, 0.10, -0.46, -0.32, 1.00, 1.62, 0.92),  # arms
    (-0.10, 0.10, 0.32, 0.46, 1.00, 1.62, 0.92),
    (-0.15, 0.15, -0.15, 0.15, 1.65, 1.95, 1.00),   # head
    (0.15, 0.22, -0.05, 0.05, 1.74, 1.84, 0.75),    # nose, marks the front
    (-0.34, 0.34, -0.34, 0.34, 1.95, 1.99, 0.85),   # hat brim
    (-0.17, 0.17, -0.17, 0.17, 1.99, 2.15, 0.85),   # hat crown
    (0.10, 0.14, -0.41, -0.37, 0.90, 2.60, 0.70),   # rod, a vertical stick in the right hand
]
# Chibi bipeds (big head, short legs), for the cartoon Salmons characters.
CHIBI_BEAR = [
    (-0.22, 0.22, -0.42, -0.08, 0.0, 0.40, 0.90),   # legs
    (-0.22, 0.22, 0.08, 0.42, 0.0, 0.40, 0.90),
    (-0.22, 0.34, -0.42, -0.08, 0.0, 0.12, 0.80),   # feet, toes forward
    (-0.22, 0.34, 0.08, 0.42, 0.0, 0.12, 0.80),
    (-0.36, 0.36, -0.50, 0.50, 0.40, 1.05, 1.00),   # body
    (-0.10, 0.42, -0.78, -0.50, 0.55, 0.95, 0.92),  # arms, raised forward
    (-0.10, 0.42, 0.50, 0.78, 0.55, 0.95, 0.92),
    (-0.45, 0.45, -0.60, 0.60, 1.05, 1.95, 1.00),   # head
    (0.45, 0.62, -0.25, 0.25, 1.15, 1.50, 0.80),    # muzzle, marks the front
    (-0.12, 0.12, -0.70, -0.40, 1.95, 2.20, 0.85),  # ears
    (-0.12, 0.12, 0.40, 0.70, 1.95, 2.20, 0.85),
]
CHIBI_FISHERMAN = [
    (-0.16, 0.16, -0.32, -0.05, 0.0, 0.45, 0.90),   # legs
    (-0.16, 0.16, 0.05, 0.32, 0.0, 0.45, 0.90),
    (-0.16, 0.30, -0.32, -0.05, 0.0, 0.14, 0.80),   # boots, toes forward
    (-0.16, 0.30, 0.05, 0.32, 0.0, 0.14, 0.80),
    (-0.26, 0.26, -0.40, 0.40, 0.45, 1.05, 1.00),   # coat
    (-0.10, 0.30, -0.56, -0.40, 0.60, 0.98, 0.92),  # arms, hands forward
    (-0.10, 0.30, 0.40, 0.56, 0.60, 0.98, 0.92),
    (-0.34, 0.34, -0.42, 0.42, 1.05, 1.70, 1.00),   # head
    (0.34, 0.42, -0.07, 0.07, 1.25, 1.40, 0.75),    # nose, marks the front
    (-0.38, 0.38, -0.46, 0.46, 1.70, 1.98, 0.85),   # beanie
    (0.28, 0.33, -0.50, -0.45, 0.55, 2.45, 0.70),   # rod, a vertical stick in the right hand
]
BODIES = {'quadruped': QUADRUPED, 'biped': BIPED, 'chibi_bear': CHIBI_BEAR,
    'chibi_fisherman': CHIBI_FISHERMAN}
FACES = [  # corner indices of each box face, with its outward normal in model space
    ((0, 1, 3, 2), (0, 0, -1)), ((4, 6, 7, 5), (0, 0, 1)),
    ((0, 4, 5, 1), (0, -1, 0)), ((2, 3, 7, 6), (0, 1, 0)),
    ((0, 2, 6, 4), (-1, 0, 0)), ((1, 5, 7, 3), (1, 0, 0)),
]


def turn(p, deg):
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return (p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2])


def project(p):
    """World point -> (screen x, screen up, depth from the camera), in model units."""
    x, y, z = p
    return (x, z * math.cos(PITCH) + y * math.sin(PITCH), y * math.cos(PITCH) - z * math.sin(PITCH))


def polygons(body, deg):
    out = []
    view = (0, -math.cos(PITCH), math.sin(PITCH))  # from the surface towards the camera
    for x0, x1, y0, y1, z0, z1, tone in body:
        corners = [turn((x, y, z), deg) for z in (z0, z1) for y in (y0, y1) for x in (x0, x1)]
        for idx, normal in FACES:
            n = turn(normal, deg)
            if sum(a * b for a, b in zip(n, view)) <= 0:
                continue
            lit = max(0.0, sum(a * b for a, b in zip(n, LIGHT)))
            pts = [project(corners[i]) for i in idx]
            grey = int(150 * tone * (0.55 + 0.45 * lit))
            out.append((sum(p[2] for p in pts) / 4, [(p[0], p[1]) for p in pts], grey, [p[2] for p in pts]))
    return sorted(out, key=lambda f: -f[0])


def scale_for(body):
    """One scale for every facing: the largest extent of any facing fills FILL of the canvas."""
    extent = 0.0
    for deg in FACINGS.values():
        pts = [p for _, poly, _, _ in polygons(body, deg) for p in poly]
        extent = max(extent, max(p[0] for p in pts) - min(p[0] for p in pts),
            max(p[1] for p in pts) - min(p[1] for p in pts))
    return FILL * SIZE / extent


def render(body, deg, scale):
    """Z-buffered, so overlapping boxes hide each other correctly at every turn."""
    n = SIZE * SS
    depth = np.full((n, n), np.inf)
    grey = np.full((n, n), BG[0], dtype=np.uint8)
    face = np.zeros((n, n), dtype=np.int32)
    ys, xs = np.mgrid[0:n, 0:n]
    for i, (_, poly, tone, depths) in enumerate(polygons(body, deg), start=1):
        xy = [((ANCHOR[0] + x * scale) * SS, (ANCHOR[1] - y * scale) * SS) for x, y in poly]
        mask = Image.new('1', (n, n), 0)
        ImageDraw.Draw(mask).polygon(xy, fill=1)
        (x0, y0), (x1, y1), (x2, y2) = xy[0], xy[1], xy[2]
        det = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
        if abs(det) < 1e-9:
            continue
        ga = ((depths[1] - depths[0]) * (y2 - y0) - (depths[2] - depths[0]) * (y1 - y0)) / det
        gb = ((depths[2] - depths[0]) * (x1 - x0) - (depths[1] - depths[0]) * (x2 - x0)) / det
        z = depths[0] + ga * (xs - x0) + gb * (ys - y0)
        hit = np.asarray(mask, dtype=bool) & (z < depth)
        depth[hit], grey[hit], face[hit] = z[hit], tone, i
    edge = np.zeros((n, n), dtype=bool)
    edge[:, 1:] |= face[:, 1:] != face[:, :-1]
    edge[1:, :] |= face[1:, :] != face[:-1, :]
    grey[edge] = 60
    return Image.fromarray(grey).convert('RGB').resize((SIZE, SIZE), Image.LANCZOS)


if __name__ == '__main__':
    out = sys.argv[1]
    for name, body in BODIES.items():
        scale = scale_for(body)
        for facing, deg in FACINGS.items():
            render(body, deg, scale).save(f'{out}/guide_{name}_{facing}.png')
        print(name, 'scale', round(scale, 1), 'px per unit')
