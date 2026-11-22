"""Frame to rig, the parts and their sheet (phase F2b): a cut made whole, filled and packed.

docs/design/frame-to-rig.md §4.4 and §4.5. The cut (`rig_from_frame.py`, F1) left every visible
pixel of the frame in one part or prop of its label map; the launcher has fitted the template to the
cut's joints and says where each part's image sits when the rig is posed as the frame (the
attachment's matrix, rig units, y up). Per part this makes:

1. **Whole, occluded, overlap** (§4.4). The whole part is its visible pixels plus the shape it
   continues in behind what covers it — a limb's capsule with round ends (the overlap a joint bends
   over), a hand's wrist end, the torso's hull through the shoulders and hips, the head's hull with
   the face — inside the character, with the pixels of the props worn on it. Of what is hidden, the
   pixels under a part drawn IN FRONT are *occluded*: revealed when that part moves, so they are
   made. The ones over a part drawn behind are the *overlap*: the part is drawn on top there, so the
   frame's own pixels are right. The soft edge of the outline (alpha 1–127, in no part) joins the
   part beside it.
2. **A canvas centred on its bone, turned to rest** (§4.5): image-up is the bone's up at setup and
   1 px is 1 rig unit, warped from the frame through the inverse of the attachment's matrix — so the
   rig posed as the frame draws the frame again. Untrimmed: the template places every image centred
   on its bone, and the canvas already ends where the part does on its far side.
3. **The CPU seam fill**: the occluded pixels painted from the part's own pixels by OpenCV's Telea —
   right for a seam's few pixels, a smear across an interior. Marked `cpu` in the report; the GPU
   fill (phase F3, Qwen-Image-Edit on RunPod) is the other entry `FILLS` waits for.
4. **One sheet named by part**, the props among them, packed and written to the project as any
   sheet is (page, TexturePacker JSON and manifest: `video_to_clip.write_page`), so ＋ New rig
   attaches each image to the template part of its name.

The report goes to `parts.json` in the job's folder and back to the launcher.
"""
from __future__ import annotations

import io
import json
import math
import re
import time

import cv2
import numpy as np
from PIL import Image

import pack as packer
import rig_from_frame as R

FILLS = ("cpu",)
# A hidden pixel this near the part's own is a seam, which the CPU fill paints well.
BAND = 8
TELEA_RADIUS = 6
# The fill reads the part this many canvas pixels in from its edge, when that leaves enough of it.
FILL_INSET = 3
MIN_FILL_SOURCE = 200
SHEET = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
MAX_CANVAS = 2048
PAGE_MAX = 2048
PADDING = 2
# Below this many rig units per frame pixel the frame is averaged down before the warp, so a large
# frame is not sampled sparsely.
AREA_BELOW = 0.75
LIMBS = {
    "upper_arm_l": ("shoulder_l", "elbow_l"),
    "lower_arm_l": ("elbow_l", "wrist_l"),
    "upper_arm_r": ("shoulder_r", "elbow_r"),
    "lower_arm_r": ("elbow_r", "wrist_r"),
}
# A part whose joints lie this much outside the frame is reported cut off by its edge.
CROPPED = 0.5
COMMENT = ("Made by the Invisible Rigger's frame to rig from one Flipbook frame: each part of "
           "the cut made whole, turned to its bone's rest and named as the rig template names it. "
           "Derived artifact: creating the rig from the cut again replaces it.")


def _finite(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def validate(payload: dict) -> dict:
    """`{job, sheet, scale, origin, parts: [{name, matrix}], order, fill?}` checked."""
    job = str(payload.get("job") or "")
    if not R.JOB.match(job):
        raise ValueError("Bad job id.")
    sheet = str(payload.get("sheet") or "")
    if not SHEET.match(sheet):
        raise ValueError("Bad sheet name.")
    k = payload.get("scale")
    if not _finite(k) or k <= 0:
        raise ValueError("The fit's scale is not readable.")
    origin = payload.get("origin")
    if not (isinstance(origin, list) and len(origin) == 2 and all(_finite(v) for v in origin)):
        raise ValueError("The fit's origin is not readable.")
    parts = payload.get("parts")
    if not isinstance(parts, list) or not parts:
        raise ValueError("No parts were placed.")
    matrices: dict[str, list[float]] = {}
    for p in parts:
        name = str((p or {}).get("name") or "")
        m = (p or {}).get("matrix")
        if not (isinstance(m, list) and len(m) == 6 and all(_finite(v) for v in m)):
            raise ValueError(f"The part {name or '?'} has no readable place.")
        if abs(m[0] * m[3] - m[1] * m[2]) < 1e-6:
            raise ValueError(f"The part {name} is drawn with no area.")
        matrices[name] = [float(v) for v in m]
    order = payload.get("order")
    if not (isinstance(order, list) and all(isinstance(n, str) for n in order)
            and set(matrices) <= set(order)):
        raise ValueError("The draw order does not name every part.")
    fill = payload.get("fill") or "cpu"
    if fill not in FILLS:
        raise ValueError("Only the CPU fill runs for now: the GPU fill (🎨 Fill) waits on RunPod.")
    return {"job": job, "sheet": sheet, "scale": float(k), "origin": [float(v) for v in origin],
            "matrices": matrices, "order": list(order), "fill": fill}


# --- which pixels are whose -----------------------------------------------------------------------


def with_edges(labels: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """The label map with the outline's soft edge (0 < alpha ≤ 127, in no part) given to the part
    beside it, so a part keeps its anti-aliased outline."""
    lab = labels.astype(np.uint16) + 1
    lab[labels == R.BACKGROUND] = 0
    edge = (alpha > 0) & (lab == 0)
    k = np.ones((3, 3), np.uint8)
    for _ in range(4):
        if not edge.any():
            break
        grown = cv2.dilate(lab, k)
        take = edge & (grown > 0)
        lab[take] = grown[take]
        edge &= ~take
    out = (lab.astype(np.int32) - 1).clip(0, 254).astype(np.uint8)
    out[lab == 0] = R.BACKGROUND
    return out


def part_masks(labels: np.ndarray, cut: dict) -> tuple[dict, dict]:
    """Each part's and taken prop's pixels; a prop left ✗ is drawn into its host. Also each taken
    prop's host."""
    props = {p["name"]: p for p in cut.get("props") or []}
    masks: dict[str, np.ndarray] = {}
    for i, n in enumerate(cut["names"]):
        if n not in props:
            masks[n] = labels == i
    hosts = {}
    for i, n in enumerate(cut["names"]):
        p = props.get(n)
        if p is None:
            continue
        if p.get("take", True):
            masks[n] = labels == i
            hosts[n] = p["host"]
        else:
            masks[p["host"]] = masks.get(p["host"], np.zeros(labels.shape, bool)) | (labels == i)
    return masks, hosts


def amodal(part: str, vis: dict, j: dict, inside: np.ndarray) -> np.ndarray:
    """Where the whole part would be (docs/design/frame-to-rig.md §4.4): its visible pixels plus the
    shape it continues in behind what covers it, inside the character's outline."""
    v = vis[part]
    shape = inside.shape
    if part in LIMBS:
        a, b = (_joint(j, n) for n in LIMBS[part])
        cap = _capsule(shape, a, b, _half_width(v, a, b))
        return v | (cap & inside)
    if part.startswith("hand_"):
        s = part[-1]
        if s not in j["hands"]:
            return v
        # The hand as cut plus its wrist's round end. A hull over a spread hand, or capsules on the
        # tracked fingers, would carry patches of the body wherever the hand moves.
        fore = vis.get(f"lower_arm_{s}")
        r = _half_width(fore, j[f"elbow_{s}"], R.wrist(j, s)) if fore is not None and fore.any() else 12
        m = np.zeros(shape, np.uint8)
        cv2.circle(m, _pt(j["hands"][s]["pts"][0]), int(r), 1, -1)
        return v | (m.astype(bool) & inside)
    if part == "torso":
        pts = np.argwhere(v)[:, ::-1].astype(np.float32)
        extra = np.array([j["shoulder_l"], j["shoulder_r"], j["hip_l"], j["hip_r"]], np.float32)
        extra[:, 1] = np.minimum(extra[:, 1], shape[0] - 1)
        m = np.zeros(shape, np.uint8)
        cv2.fillPoly(m, [cv2.convexHull(np.vstack([pts, extra])).astype(np.int32)], 1)
        head = vis.get("head", np.zeros(shape, bool))
        return v | (m.astype(bool) & inside & ~head)
    if part == "head":
        pts = np.vstack([np.argwhere(v)[:, ::-1], j["face"]]).astype(np.float32)
        m = np.zeros(shape, np.uint8)
        cv2.fillPoly(m, [cv2.convexHull(pts).astype(np.int32)], 1)
        return v | (m.astype(bool) & inside)
    return v


def _pt(p) -> tuple[int, int]:
    return int(round(float(p[0]))), int(round(float(p[1])))


def _joint(j: dict, name: str):
    return R.wrist(j, name[-1]) if name.startswith("wrist") else j[name]


def _capsule(shape, a, b, r: float) -> np.ndarray:
    m = np.zeros(shape, np.uint8)
    cv2.line(m, _pt(a), _pt(b), 1, thickness=max(1, int(2 * r)))
    cv2.circle(m, _pt(a), int(r), 1, -1)
    cv2.circle(m, _pt(b), int(r), 1, -1)
    return m.astype(bool)


def _half_width(v: np.ndarray, a, b) -> float:
    """A limb's half width: the 90th percentile of its pixels' distance from its bone, along the
    middle of the bone."""
    ys, xs = np.nonzero(v)
    ab = np.asarray(b, float) - np.asarray(a, float)
    L2 = max(1e-6, float(ab @ ab))
    t = ((xs - a[0]) * ab[0] + (ys - a[1]) * ab[1]) / L2
    d = np.abs((xs - a[0]) * ab[1] - (ys - a[1]) * ab[0]) / math.sqrt(L2)
    mid = (t > 0.2) & (t < 0.8)
    return float(np.percentile(d[mid], 90)) if mid.sum() > 20 else 12.0


def cut_off(part: str, j: dict, w: int, h: int) -> float:
    """How much of what places the part (its bone's segment, its hand's or face's points) lies
    outside the frame: a limb out of the picture is not in its cut."""
    if part in LIMBS:
        a, b = (np.asarray(_joint(j, n), float) for n in LIMBS[part])
        pts = a + (b - a) * np.linspace(0, 1, 21)[:, None]
    elif part.startswith("hand_") and part[-1] in j["hands"]:
        pts = j["hands"][part[-1]]["pts"]
    elif part == "head":
        pts = j["face"]
    else:
        return 0.0
    pts = np.asarray(pts, float)
    out = (pts[:, 0] < 0) | (pts[:, 0] > w) | (pts[:, 1] < 0) | (pts[:, 1] > h)
    return float(out.mean())


def layers(masks: dict, hosts: dict, order: list[str], j: dict, alpha: np.ndarray) -> dict:
    """Per part and taken prop: its visible pixels, the whole shape, what in it is occluded (under a
    part drawn in front: made) and what is overlap (over a part drawn behind: the frame's own)."""
    inside = alpha > 127
    rank = {n: i for i, n in enumerate(order)}
    vis = {n: m & inside for n, m in masks.items()}
    worn = np.zeros(alpha.shape, bool)
    for prop in hosts:
        worn |= vis[prop]
    out = {}
    for n in masks:
        v = vis[n]
        if n in hosts:
            whole = v.copy()
        else:
            whole = amodal(n, vis, j, inside)
            for prop, host in hosts.items():
                if host == n:
                    whole |= vis[prop]
        front = np.zeros_like(v)
        for o in masks:
            if rank[o] > rank[n]:
                front |= vis[o]
        hidden = whole & ~v
        out[n] = {"vis": v, "whole": whole, "occluded": hidden & front, "overlap": hidden & ~front,
                  "under_props": hidden & front & worn}
    return out


# --- the canvases ---------------------------------------------------------------------------------


def canvas_size(whole: np.ndarray, m: list[float], k: float, origin) -> tuple[int, int]:
    """A canvas centred on the attachment, as large as the whole part's farthest pixel each way."""
    ys, xs = np.nonzero(whole)
    a, b, c, d, tx, ty = m
    wx = k * (xs + 0.5 - origin[0]) - tx
    wy = -k * (ys + 0.5 - origin[1]) - ty
    det = a * d - b * c
    lu = (d * wx - b * wy) / det
    lv = (-c * wx + a * wy) / det
    w = 2 * int(math.ceil(float(np.abs(lu).max()) + 2))
    h = 2 * int(math.ceil(float(np.abs(lv).max()) + 2))
    if max(w, h) > MAX_CANVAS:
        raise ValueError(f"A part's image would be {w}×{h} px, past {MAX_CANVAS}: the frame is drawn "
                         "far larger than the template.")
    return w, h


def canvas_map(m: list[float], k: float, origin, size: tuple[int, int]) -> np.ndarray:
    """The affine from a canvas pixel to the frame pixel it shows (OpenCV's pixel centres): canvas
    pixel (i, j) is the attachment's local point (i + ½ − W/2, H/2 − j − ½), the matrix takes it to
    the rig's world, and the fit's scale and origin to the frame."""
    a, b, c, d, tx, ty = m
    cu, cv = 0.5 - size[0] / 2, size[1] / 2 - 0.5
    return np.array([
        [a / k, -b / k, (a * cu + b * cv + tx) / k + origin[0] - 0.5],
        [-c / k, d / k, -(c * cu + d * cv + ty) / k + origin[1] - 0.5],
    ], np.float64)


def cpu_fill(rgb: np.ndarray, known: np.ndarray) -> np.ndarray:
    """The pixels not `known` painted from the known ones by OpenCV's Telea (no model)."""
    bgr = cv2.cvtColor(np.ascontiguousarray(rgb), cv2.COLOR_RGB2BGR)
    out = cv2.inpaint(bgr, (~known).astype(np.uint8), TELEA_RADIUS, cv2.INPAINT_TELEA)
    return cv2.cvtColor(out, cv2.COLOR_BGR2RGB)


FILL = {"cpu": cpu_fill}


def part_canvas(rgba: np.ndarray, layer: dict, m: list[float], k: float, origin, fill: str):
    """The part's image: its own pixels and overlap from the frame, its occluded pixels filled, on a
    canvas centred on its attachment and turned to rest. Warped premultiplied, so a soft edge keeps
    its colour."""
    own = layer["vis"] | layer["edge"] | layer["overlap"]
    a_src = np.where(own, rgba[..., 3], 0).astype(np.float32) / 255.0
    whole_a = np.where(layer["occluded"], 255, a_src * 255).astype(np.float32) / 255.0
    pre = rgba[..., :3].astype(np.float32) * a_src[..., None]
    size = canvas_size(layer["whole"] | layer["edge"], m, k, origin)
    A = canvas_map(m, k, origin, size)
    src_a, src_b = np.dstack([pre, a_src]), np.dstack([own.astype(np.float32), whole_a])
    if k < AREA_BELOW:
        h, w = rgba.shape[:2]
        nw, nh = max(1, round(w * k)), max(1, round(h * k))
        fx, fy = nw / w, nh / h
        src_a = cv2.resize(src_a, (nw, nh), interpolation=cv2.INTER_AREA)
        src_b = cv2.resize(src_b, (nw, nh), interpolation=cv2.INTER_AREA)
        A = np.array([[fx * A[0, 0], fx * A[0, 1], fx * (A[0, 2] + 0.5) - 0.5],
                      [fy * A[1, 0], fy * A[1, 1], fy * (A[1, 2] + 0.5) - 0.5]])

    def warp(x):
        return cv2.warpAffine(x, A.astype(np.float32), size,
                              flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP,
                              borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))

    wa, wb = warp(src_a), warp(src_b)
    a_c = wa[..., 3]
    col = np.where(a_c[..., None] > 1e-4, wa[..., :3] / np.maximum(a_c[..., None], 1e-4), 0)
    col = np.clip(np.rint(col), 0, 255).astype(np.uint8)
    known = wb[..., 0] > 0.5
    alpha = np.clip(np.rint(wb[..., 1] * 255), 0, 255).astype(np.uint8)
    rgb = col
    if layer["occluded"].any() and known.any():
        # Filled from the part's pixels a few in from its edge: the edge against the part that
        # covers it is often that part's drawn outline, which would streak across the fill. The
        # part's own pixels are put back over the fill, so nothing visible changes.
        inner = cv2.erode(known.astype(np.uint8), np.ones((3, 3), np.uint8),
                          iterations=FILL_INSET).astype(bool)
        made = FILL[fill](col, inner if inner.sum() >= MIN_FILL_SOURCE else known)
        rgb = np.where(known[..., None], col, made)
    rgb[alpha == 0] = 0
    return np.dstack([rgb, alpha]), size


# --- the job --------------------------------------------------------------------------------------


def _png(arr) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, "PNG", optimize=True)
    return buf.getvalue()


def make_parts(rgba: np.ndarray, labels: np.ndarray, cut: dict, track: dict, v: dict) -> dict:
    """Every placed part's image and the report, from the frame, its cut and the request."""
    h, w = labels.shape
    alpha = rgba[..., 3]
    j = R.joints_of(track, w, h)
    edged = with_edges(labels, alpha)
    masks, hosts = part_masks(labels, cut)
    edge_masks, _ = part_masks(edged, cut)
    placed = v["matrices"]
    unplaced = sorted(n for n in masks if masks[n].any() and n not in placed)
    if unplaced:
        raise ValueError("The request places no image for " + ", ".join(unplaced) + ".")
    unknown = sorted(n for n in placed if n not in masks)
    if unknown:
        raise ValueError("The cut has no " + ", ".join(unknown) + ".")
    lay = layers(masks, hosts, v["order"], j, alpha)
    images, report = {}, {}
    for n in [x for x in v["order"] if x in placed]:
        layer = lay[n]
        layer["edge"] = edge_masks[n] & ~layer["vis"] & ~(alpha > 127)
        if not layer["vis"].any():
            report[n] = {"visible_px": 0, "skipped": "not in the frame"}
            continue
        img, size = part_canvas(rgba, layer, placed[n], v["scale"], v["origin"], v["fill"])
        images[n] = img
        own = layer["vis"] | layer["overlap"]
        dist = cv2.distanceTransform((~own).astype(np.uint8), cv2.DIST_L2, 5)
        occ = layer["occluded"]
        band = occ & (dist <= BAND)
        report[n] = {
            "visible_px": int(layer["vis"].sum()),
            "whole_px": int(layer["whole"].sum()),
            "overlap_px": int(layer["overlap"].sum()),
            "occluded_px": int(occ.sum()),
            "under_props_px": int(layer["under_props"].sum()),
            "seam_band_px": int(band.sum()),
            "interior_px": int((occ & ~band).sum()),
            "deepest_px": round(float(dist[occ].max()) if occ.any() else 0.0, 1),
            "filled": v["fill"] if occ.any() else None,
            "size": list(size),
            "cut_off": round(cut_off(n, j, w, h), 2),
            **({"prop": True, "host": hosts[n]} if n in hosts else {}),
        }
    return {"images": images, "report": report}


def pack_sheet(images: dict) -> dict:
    items = [{"name": n, "w": int(im.shape[1]), "h": int(im.shape[0])} for n, im in images.items()]
    packed = packer.pack(items, width=PAGE_MAX, height=0, padding=PADDING, allow_rotation=False)
    if packed["width"] > PAGE_MAX or packed["height"] > PAGE_MAX:
        raise ValueError(f"The parts do not fit one {PAGE_MAX}-px page.")
    return packed


def run(payload: dict, *, project_prefix: str, get=None, put=None, write_page=None) -> dict:
    """The parts of a cut made whole, filled, turned to rest and packed into the project's sheet
    `<sheet>`; `parts.json` written beside the cut. ValueError for anything the author can fix."""
    v = validate(payload)
    if get is None or put is None:
        import storage

        get = get or storage.get
        put = put or storage.put
    if write_page is None:
        import video_to_clip

        write_page = video_to_clip.write_page
    started = time.perf_counter()
    root = f"{project_prefix}/rig-from-frame/{v['job']}"
    files = {n: get(f"{root}/{n}") for n in ("cut.json", "frame.png", "labels.png", "track.json")}
    if any(b is None for b in files.values()):
        raise ValueError("That cut is gone: cut the frame again.")
    cut = json.loads(files["cut.json"])
    rgba = np.array(Image.open(io.BytesIO(files["frame.png"])).convert("RGBA"))
    labels = np.array(Image.open(io.BytesIO(files["labels.png"])))
    if labels.ndim == 3:
        labels = labels[..., 0]
    if labels.shape != rgba.shape[:2]:
        raise ValueError("The cut's label map is not the frame's size.")
    track = json.loads(files["track.json"])
    made = make_parts(rgba, labels, cut, track, v)
    if not made["images"]:
        raise ValueError("No part of the cut is in the frame.")
    packed = pack_sheet(made["images"])
    tiles = {n: Image.fromarray(im) for n, im in made["images"].items()}
    trims = {n: (0, 0, int(im.shape[1]), int(im.shape[0])) for n, im in made["images"].items()}
    stamp = {"rig_from_frame": {"job": v["job"], "template": cut.get("template"),
                                "fill": v["fill"]}}

    def ours(body: bytes) -> bool:
        try:
            return (json.loads(body).get("rig_from_frame") or {}).get("job") == v["job"]
        except ValueError:
            return False

    page = write_page(0, v["sheet"], packed, tiles, trims, comment=COMMENT, tool="rigger",
                      extra=stamp, may_replace=ours)
    doc = {
        "version": 1,
        "job": v["job"],
        "sheet": v["sheet"],
        "manifestKey": page["manifest_key"],
        "pageKey": page["page_key"],
        "fill": v["fill"],
        "scale": v["scale"],
        "parts": made["report"],
        "seconds": round(time.perf_counter() - started, 2),
    }
    put(f"{root}/parts.json", json.dumps(doc, indent=1).encode(), "application/json")
    return doc
