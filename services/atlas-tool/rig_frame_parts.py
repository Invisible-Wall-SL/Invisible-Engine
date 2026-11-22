"""Frame to rig, the parts and their sheet (phase F2b): a cut made whole, filled and packed.

docs/design/frame-to-rig.md §4.4 and §4.5. The cut (`rig_from_frame.py`, F1) left every visible
pixel of the frame in one part or prop of its label map; the launcher has fitted the template to the
cut's joints and says where each part's image sits when the rig is posed as the frame (the
attachment's matrix, rig units, y up). Per part this makes:

1. **Whole, occluded, overlap** (§4.4). The whole part is its visible pixels plus the shape it
   continues in behind what covers it, inside the character, with the pixels of the props worn on
   it. A limb or the neck goes on hidden as its own outline does (`profile`: its drawn edges
   carried on from where they show, mirrored, or its twin limb's width), with round ends (the
   overlap a joint bends over); the torso as its hull through the shoulders and hips held to the
   mirror of the side that shows; a hand with its wrist's round end; the head as its hull with the
   face. Nothing is made outside that outline. Of what is hidden, the
   pixels under a part drawn IN FRONT are *occluded*: revealed when that part moves, so they are
   made. The ones over a part drawn behind are the *overlap*: the part is drawn on top there, so the
   frame's own pixels are right. The soft edge of the outline (alpha 1–127, in no part) joins the
   part beside it.
2. **A canvas centred on its bone, turned to rest** (§4.5): image-up is the bone's up at setup and
   1 px is 1 rig unit, warped from the frame through the inverse of the attachment's matrix — so the
   rig posed as the frame draws the frame again. Untrimmed: the template places every image centred
   on its bone, and the canvas already ends where the part does on its far side.
3. **The CPU fill**: along a limb's or the neck's made outline its drawn edge goes on (the colour at
   the same place across it, carried along it: `extrude`); inside, and on the torso, head and
   hands, the occluded pixels are painted from the part's own by OpenCV's Telea — right for a
   seam's few pixels, a smear across an interior. A made outline is anti-aliased; the part's own
   pixels are never touched. Marked `cpu` in the report; the GPU fill (phase F3, Qwen-Image-Edit on
   RunPod) is the other entry `FILLS` waits for.
4. **One sheet named by part**, the props among them, packed and written to the project as any
   sheet is (page, TexturePacker JSON and manifest: `video_to_clip.write_page`), so ＋ New rig
   attaches each image to the template part of its name.

A part the author took from another frame (per-part frames) is made the same way from that
frame's kept cut, placed there by its own matrix, scale and origin (`from_other_cut`), and
reported with the frame it came from. The report goes to `parts.json` in the job's folder and back
to the launcher.
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
# The outline (frame-to-rig §4.4): a part drawn along an axis is measured every BIN px along it; a
# made edge stays within OUTLINE_MAX of its half width from the axis; a part showing fewer than
# MIN_PROFILE_PX is drawn by its capsule. Its fill is read straightened, U_STEPS across.
BIN = 3
OUTLINE_MAX = 1.6
MIN_PROFILE_PX = 60
U_STEPS = 24
RIM = 4
COMMENT = ("Made by the Invisible Rigger's frame to rig from one Flipbook frame: each part of "
           "the cut made whole, turned to its bone's rest and named as the rig template names it. "
           "Derived artifact: creating the rig from the cut again replaces it.")


def _finite(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _scale_origin(o: dict, what: str) -> tuple[float, list[float]]:
    k = o.get("scale")
    if not _finite(k) or k <= 0:
        raise ValueError(f"The {what} scale is not readable.")
    origin = o.get("origin")
    if not (isinstance(origin, list) and len(origin) == 2 and all(_finite(v) for v in origin)):
        raise ValueError(f"The {what} origin is not readable.")
    return float(k), [float(v) for v in origin]


def validate(payload: dict) -> dict:
    """`{job, sheet, scale, origin, parts: [{name, matrix, source?}], order, fill?}` checked. A part
    with `source: {job, scale, origin}` is cut from that job's frame (per-part frames), placed there
    by its matrix at that frame's scale and origin."""
    job = str(payload.get("job") or "")
    if not R.JOB.match(job):
        raise ValueError("Bad job id.")
    sheet = str(payload.get("sheet") or "")
    if not SHEET.match(sheet):
        raise ValueError("Bad sheet name.")
    k, origin = _scale_origin(payload, "fit's")
    parts = payload.get("parts")
    if not isinstance(parts, list) or not parts:
        raise ValueError("No parts were placed.")
    matrices: dict[str, list[float]] = {}
    sources: dict[str, dict] = {}
    for p in parts:
        name = str((p or {}).get("name") or "")
        m = (p or {}).get("matrix")
        if not (isinstance(m, list) and len(m) == 6 and all(_finite(v) for v in m)):
            raise ValueError(f"The part {name or '?'} has no readable place.")
        if abs(m[0] * m[3] - m[1] * m[2]) < 1e-6:
            raise ValueError(f"The part {name} is drawn with no area.")
        matrices[name] = [float(v) for v in m]
        src = (p or {}).get("source")
        if src is not None:
            sjob = str((src or {}).get("job") or "") if isinstance(src, dict) else ""
            if not R.JOB.match(sjob) or sjob == job:
                raise ValueError(f"The part {name} is taken from no other cut.")
            sk, so = _scale_origin(src, f"{name}'s frame")
            sources[name] = {"job": sjob, "scale": sk, "origin": so}
    order = payload.get("order")
    if not (isinstance(order, list) and all(isinstance(n, str) for n in order)
            and set(matrices) <= set(order)):
        raise ValueError("The draw order does not name every part.")
    fill = payload.get("fill") or "cpu"
    if fill not in FILLS:
        raise ValueError("Only the CPU fill runs for now: the GPU fill (🎨 Fill) waits on RunPod.")
    return {"job": job, "sheet": sheet, "scale": k, "origin": origin, "matrices": matrices,
            "order": list(order), "fill": fill, "sources": sources}


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


def axis_of(part: str, j: dict):
    """The line a part is drawn along, from its base: a limb's joints, the neck from the shoulders'
    middle to the jaw's, the torso from the hips' middle to the shoulders'. None for a hand, the head
    and a prop."""
    if part in LIMBS:
        return tuple(np.asarray(_joint(j, n), float) for n in LIMBS[part])
    if part == "neck":
        top, base, _ = R.neck_axis(j)
        return np.asarray(base, float), np.asarray(top, float)
    if part == "torso":
        return ((np.asarray(j["hip_l"], float) + j["hip_r"]) / 2,
                (np.asarray(j["shoulder_l"], float) + j["shoulder_r"]) / 2)
    return None


def profile(v: np.ndarray, a, b, alpha: np.ndarray, r0: float, mirror: bool,
            twin: dict | None = None) -> dict:
    """The part's outline along its axis a → b (frame-to-rig §4.4, the silhouette kept): per BIN
    across the axis, the visible pixels' two edges. An edge with the background beyond it is the
    drawn silhouette (known); one against another part is where the part goes on hidden (unknown).
    An unknown edge is drawn on from the same side's known edges on both sides of it, else from the
    other edge (the axis a symmetry line when `mirror`, the part's own width otherwise, or its twin
    limb's when the other side shows it), else the nearest known edge of the same side, else r0."""
    h, w = v.shape
    ab = np.asarray(b, float) - np.asarray(a, float)
    L = max(1e-6, float(np.hypot(*ab)))
    u = ab / L
    n = np.array([-u[1], u[0]])
    ys, xs = np.nonzero(v)
    px = np.stack([xs + 0.5, ys + 0.5], 1) - a
    t, d = px @ u, px @ n
    t0 = min(0.0, float(t.min()) if t.size else 0.0)
    t1 = max(L, float(t.max()) if t.size else L)
    nb = max(1, int(math.ceil((t1 - t0) / BIN)))
    idx = np.clip(((t - t0) / BIN).astype(int), 0, nb - 1)
    hi = np.full(nb, np.nan)
    lo = np.full(nb, np.nan)
    np.fmax.at(hi, idx, d)
    np.fmin.at(lo, idx, d)

    def outside(tt, dd) -> bool:
        p = a + u * tt + n * dd
        x, y = int(math.floor(p[0])), int(math.floor(p[1]))
        return not (0 <= x < w and 0 <= y < h) or alpha[y, x] <= 127

    tc = t0 + (np.arange(nb) + 0.5) * BIN
    known_hi = np.array([not np.isnan(hi[i]) and outside(tc[i], hi[i] + 2) for i in range(nb)])
    known_lo = np.array([not np.isnan(lo[i]) and outside(tc[i], lo[i] - 2) for i in range(nb)])
    both = known_hi & known_lo
    width = float(np.median(hi[both] - lo[both])) if both.sum() >= 3 else 2 * r0
    # The twin limb's width at the same share of its length: a performer's two arms are one size.
    twin_w = (np.interp(np.clip(tc / L, 0, 1) * twin["L"], twin["tc"], twin["width"])
              if twin is not None else None)
    est_hi, est_lo = hi.copy(), lo.copy()
    for side, val, known, other, other_known, sign in (
            ("hi", est_hi, known_hi, lo, known_lo, 1), ("lo", est_lo, known_lo, hi, known_hi, -1)):
        ks = np.nonzero(known)[0]
        for i in range(nb):
            if known[i]:
                continue
            seen = val[i]
            if ks.size and ks[0] < i < ks[-1]:
                guess = float(np.interp(i, ks, val[ks]))
            elif other_known[i]:
                wd = twin_w[i] if twin_w is not None else width
                guess = -other[i] if mirror else other[i] + sign * wd
            elif ks.size:
                guess = float(val[ks[np.argmin(np.abs(ks - i))]])
            else:
                guess = sign * r0
            guess = float(np.clip(guess, -OUTLINE_MAX * r0, OUTLINE_MAX * r0))
            # A hidden edge never draws the part narrower than what of it shows.
            val[i] = max(guess, seen) if sign > 0 and not np.isnan(seen) else (
                min(guess, seen) if sign < 0 and not np.isnan(seen) else guess)
    return {"a": np.asarray(a, float), "u": u, "n": n, "L": L, "t0": t0, "nb": nb, "tc": tc,
            "hi": est_hi, "lo": est_lo, "known": known_hi & known_lo, "width": est_hi - est_lo}


def outline_mask(shape, pr: dict, ends: bool) -> np.ndarray:
    """The profile drawn as a polygon, with round ends at its joints (the overlap a joint bends
    over) when `ends`."""
    a, u, n, tc = pr["a"], pr["u"], pr["n"], pr["tc"]
    keep = ~(np.isnan(pr["hi"]) | np.isnan(pr["lo"]))
    if ends:
        keep &= (tc >= 0) & (tc <= pr["L"])
    m = np.zeros(shape, np.uint8)
    if keep.sum() < 2:
        return m.astype(bool)
    top = [a + u * t + n * e for t, e in zip(tc[keep], pr["hi"][keep])]
    bot = [a + u * t + n * e for t, e in zip(tc[keep][::-1], pr["lo"][keep][::-1])]
    cv2.fillPoly(m, [np.round(np.array(top + bot)).astype(np.int32)], 1)
    if ends:
        for t_end, k in ((0.0, int(np.argmax(keep))), (pr["L"], len(keep) - 1 - int(np.argmax(keep[::-1])))):
            r = (pr["hi"][k] - pr["lo"][k]) / 2
            c = a + u * t_end + n * (pr["hi"][k] + pr["lo"][k]) / 2
            cv2.circle(m, _pt(c), max(1, int(r)), 1, -1)
    return m.astype(bool)


def extrude(rgb: np.ndarray, v: np.ndarray, todo: np.ndarray, pr: dict):
    """Colours for the `todo` pixels carried along the axis from the visible ones at the same place
    across the part (its outline, its highlight): a limb's shading runs along it. The part is read
    straightened, BIN along by U_STEPS across; an empty cell takes the nearest filled one along."""
    a, u, n, t0, nb = pr["a"], pr["u"], pr["n"], pr["t0"], pr["nb"]

    def cells(mask):
        ys, xs = np.nonzero(mask)
        p = np.stack([xs + 0.5, ys + 0.5], 1) - a
        i = np.clip(((p @ u - t0) / BIN).astype(int), 0, nb - 1)
        span = np.maximum(pr["width"][i], 1e-6)
        k = np.clip(((p @ n - pr["lo"][i]) / span * U_STEPS).astype(int), 0, U_STEPS - 1)
        return ys, xs, i, k

    ys, xs, i, k = cells(v)
    acc = np.zeros((nb, U_STEPS, 3))
    cnt = np.zeros((nb, U_STEPS))
    np.add.at(acc, (i, k), rgb[ys, xs].astype(np.float64))
    np.add.at(cnt, (i, k), 1)
    grid = np.full((nb, U_STEPS, 3), np.nan)
    have = cnt > 0
    grid[have] = acc[have] / cnt[have][:, None]
    bins = np.arange(nb)
    for c in range(U_STEPS):
        ok = have[:, c]
        if ok.any():
            for ch in range(3):
                grid[:, c, ch] = np.interp(bins, bins[ok], grid[ok, c, ch])
    ty, tx, ti, tk = cells(todo)
    out = np.zeros_like(rgb)
    got = np.zeros(todo.shape, bool)
    col = grid[ti, tk]
    fine = ~np.isnan(col).any(1)
    out[ty[fine], tx[fine]] = np.clip(np.rint(col[fine]), 0, 255).astype(np.uint8)
    got[ty[fine], tx[fine]] = True
    return out, got


def shape_of(part: str, vis: dict, j: dict, inside: np.ndarray, alpha: np.ndarray) -> dict:
    """Where the whole part would be (docs/design/frame-to-rig.md §4.4): its visible pixels plus the
    shape it continues in behind what covers it, inside the character's outline; and the profile it
    was drawn from (None for a part drawn by its capsule or its hull)."""
    v = vis[part]
    shape = inside.shape
    ax = axis_of(part, j)
    if ax is not None and part != "torso" and v.sum() >= MIN_PROFILE_PX:
        a, b = ax
        r0 = _half_width(v, a, b)
        twin = None
        if part in LIMBS:
            other = part[:-1] + ("r" if part[-1] == "l" else "l")
            ov = vis.get(other)
            if ov is not None and ov.sum() >= MIN_PROFILE_PX:
                oa, ob = axis_of(other, j)
                tp = profile(ov, oa, ob, alpha, _half_width(ov, oa, ob), False)
                if tp["known"].sum() >= 3:
                    twin = {"L": tp["L"], "tc": tp["tc"][tp["known"]], "width": tp["width"][tp["known"]]}
        pr = profile(v, a, b, alpha, r0, part == "neck", twin)
        out = outline_mask(shape, pr, True)
        cap = _capsule(shape, a, b, OUTLINE_MAX * r0)
        return {"whole": v | (out & cap & inside), "profile": pr}
    if part in LIMBS:
        a, b = (_joint(j, n) for n in LIMBS[part])
        cap = _capsule(shape, a, b, _half_width(v, a, b))
        return {"whole": v | (cap & inside), "profile": None}
    return {"whole": _hull_whole(part, vis, j, inside, alpha), "profile": None}


def _hull_whole(part: str, vis: dict, j: dict, inside: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    v = vis[part]
    shape = inside.shape
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
        # Its hull through the shoulders and hips, held to the mirror of the side that shows where
        # an arm hides the other: a hull alone runs straight from shoulder to hip under the arm.
        pts = np.argwhere(v)[:, ::-1].astype(np.float32)
        extra = np.array([j["shoulder_l"], j["shoulder_r"], j["hip_l"], j["hip_r"]], np.float32)
        extra[:, 1] = np.minimum(extra[:, 1], shape[0] - 1)
        m = np.zeros(shape, np.uint8)
        cv2.fillPoly(m, [cv2.convexHull(np.vstack([pts, extra])).astype(np.int32)], 1)
        hull = m.astype(bool)
        if v.sum() >= MIN_PROFILE_PX:
            a, b = axis_of("torso", j)
            pr = profile(v, a, b, alpha, _half_width(v, a, b), True)
            near = cv2.dilate(outline_mask(shape, pr, False).astype(np.uint8), np.ones((5, 5), np.uint8))
            hull &= near.astype(bool)
        others = vis.get("head", np.zeros(shape, bool)) | vis.get("neck", np.zeros(shape, bool))
        return v | (hull & inside & ~others)
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
        pr = None
        if n in hosts:
            whole = v.copy()
        else:
            got = shape_of(n, vis, j, inside, alpha)
            whole, pr = got["whole"], got["profile"]
            for prop, host in hosts.items():
                if host == n:
                    whole |= vis[prop]
        front = np.zeros_like(v)
        for o in masks:
            if rank[o] > rank[n]:
                front |= vis[o]
        hidden = whole & ~v
        out[n] = {"vis": v, "whole": whole, "occluded": hidden & front, "overlap": hidden & ~front,
                  "under_props": hidden & front & worn, "profile": pr}
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


def cpu_fill(rgb: np.ndarray, known: np.ndarray, guide: np.ndarray | None = None,
             guided: np.ndarray | None = None) -> np.ndarray:
    """The pixels not `known` painted on the CPU (no model): where `guided`, the guide's colours (a
    limb's own shading carried along it, `extrude`), elsewhere from the known pixels by OpenCV's
    Telea."""
    bgr = cv2.cvtColor(np.ascontiguousarray(rgb), cv2.COLOR_RGB2BGR)
    out = cv2.cvtColor(cv2.inpaint(bgr, (~known).astype(np.uint8), TELEA_RADIUS, cv2.INPAINT_TELEA),
                       cv2.COLOR_BGR2RGB)
    if guide is not None and guided is not None:
        out = np.where(guided[..., None], guide, out)
    return out


FILL = {"cpu": cpu_fill}


def part_canvas(rgba: np.ndarray, layer: dict, m: list[float], k: float, origin, fill: str):
    """The part's image: its own pixels and overlap from the frame, its occluded pixels filled, on a
    canvas centred on its attachment and turned to rest. Warped premultiplied, so a soft edge keeps
    its colour."""
    own = layer["vis"] | layer["edge"] | layer["overlap"]
    occ = layer["occluded"]
    a_src = np.where(own, rgba[..., 3], 0).astype(np.float32) / 255.0
    whole_a = np.where(occ, 1.0, a_src).astype(np.float32)
    # A made stretch of the outline is anti-aliased as a drawn one is: half covered on its rim.
    rim = occ & ~cv2.erode((layer["whole"] | layer["edge"]).astype(np.uint8),
                           np.ones((3, 3), np.uint8)).astype(bool)
    whole_a[rim] = 0.5
    pre = rgba[..., :3].astype(np.float32) * a_src[..., None]
    guide = np.zeros(rgba.shape[:2] + (4,), np.float32)
    pr = layer.get("profile")
    if pr is not None and occ.any():
        # The drawn edge carried along the made outline, RIM px deep; the inside is Telea's (carried
        # all the way in, a limb's shading streaks).
        inner = cv2.distanceTransform((layer["whole"] | layer["edge"]).astype(np.uint8), cv2.DIST_L2, 3)
        ex, got = extrude(rgba[..., :3], layer["vis"], occ & (inner <= RIM), pr)
        guide = np.dstack([ex.astype(np.float32) * got[..., None], got.astype(np.float32)])
    size = canvas_size(layer["whole"] | layer["edge"], m, k, origin)
    A = canvas_map(m, k, origin, size)
    src_a, src_b = np.dstack([pre, a_src]), np.dstack([own.astype(np.float32), whole_a])
    if k < AREA_BELOW:
        h, w = rgba.shape[:2]
        nw, nh = max(1, round(w * k)), max(1, round(h * k))
        fx, fy = nw / w, nh / h
        src_a = cv2.resize(src_a, (nw, nh), interpolation=cv2.INTER_AREA)
        src_b = cv2.resize(src_b, (nw, nh), interpolation=cv2.INTER_AREA)
        guide = cv2.resize(guide, (nw, nh), interpolation=cv2.INTER_AREA)
        A = np.array([[fx * A[0, 0], fx * A[0, 1], fx * (A[0, 2] + 0.5) - 0.5],
                      [fy * A[1, 0], fy * A[1, 1], fy * (A[1, 2] + 0.5) - 0.5]])

    def warp(x):
        return cv2.warpAffine(x, A.astype(np.float32), size,
                              flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP,
                              borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))

    wa, wb, wg = warp(src_a), warp(src_b), warp(guide)
    a_c = wa[..., 3]
    col = np.where(a_c[..., None] > 1e-4, wa[..., :3] / np.maximum(a_c[..., None], 1e-4), 0)
    col = np.clip(np.rint(col), 0, 255).astype(np.uint8)
    known = wb[..., 0] > 0.5
    alpha = np.clip(np.rint(wb[..., 1] * 255), 0, 255).astype(np.uint8)
    guided = wg[..., 3] > 0.5
    carried = np.clip(np.rint(wg[..., :3] / np.maximum(wg[..., 3:4], 1e-4)), 0, 255).astype(np.uint8)
    rgb = col
    if occ.any() and known.any():
        # Filled from the part's pixels a few in from its edge: the edge against the part that
        # covers it is often that part's drawn outline, which would streak across the fill. The
        # part's own pixels are put back over the fill, so nothing visible changes.
        inner = cv2.erode(known.astype(np.uint8), np.ones((3, 3), np.uint8),
                          iterations=FILL_INSET).astype(bool)
        made = FILL[fill](col, inner if inner.sum() >= MIN_FILL_SOURCE else known, carried,
                          guided & ~known)
        rgb = np.where(known[..., None], col, made)
    rgb[alpha == 0] = 0
    return np.dstack([rgb, alpha]), size


# --- the job --------------------------------------------------------------------------------------


def _png(arr) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, "PNG", optimize=True)
    return buf.getvalue()


def make_parts(rgba: np.ndarray, labels: np.ndarray, cut: dict, track: dict, v: dict,
               elsewhere=frozenset()) -> dict:
    """Every placed part's image and the report, from the frame, its cut and the request. The
    parts `elsewhere` are made from another frame: placed or not here, none is made."""
    h, w = labels.shape
    alpha = rgba[..., 3]
    j = R.joints_of(track, w, h)
    edged = with_edges(labels, alpha)
    masks, hosts = part_masks(labels, cut)
    edge_masks, _ = part_masks(edged, cut)
    placed = {n: m for n, m in v["matrices"].items() if n not in elsewhere}
    unplaced = sorted(n for n in masks if masks[n].any() and n not in placed and n not in elsewhere)
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
            "outline": ("profile" if layer["profile"] is not None else "capsule" if n in LIMBS
                        else "mirror" if n == "torso" else "hull" if n not in hosts else "prop"),
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


def _cut_files(root: str, get) -> tuple[dict, np.ndarray, np.ndarray, dict]:
    files = {n: get(f"{root}/{n}") for n in ("cut.json", "frame.png", "labels.png", "track.json")}
    if any(b is None for b in files.values()):
        raise ValueError("That cut is gone: cut the frame again.")
    rgba = np.array(Image.open(io.BytesIO(files["frame.png"])).convert("RGBA"))
    labels = np.array(Image.open(io.BytesIO(files["labels.png"])))
    if labels.ndim == 3:
        labels = labels[..., 0]
    if labels.shape != rgba.shape[:2]:
        raise ValueError("The cut's label map is not the frame's size.")
    return json.loads(files["cut.json"]), rgba, labels, json.loads(files["track.json"])


def from_other_cut(job: str, names: list[str], v: dict, project_prefix: str, get) -> dict:
    """Parts `names` made from another frame's kept cut (per-part frames): read off that frame by
    their matrices at its scale and origin, made whole among that cut's own parts. Its props are
    drawn into their hosts (the rig's props are the main cut's)."""
    try:
        cut, rgba, labels, track = _cut_files(f"{project_prefix}/rig-from-frame/{job}", get)
    except ValueError:
        raise ValueError(f"The cut {', '.join(names)} is taken from is gone: pick its frame again.")
    missing = [n for n in names if n not in cut["names"]]
    if missing:
        raise ValueError(f"The frame {', '.join(missing)} is taken from has no such part.")
    cut = dict(cut, props=[dict(p, take=False) for p in cut.get("props") or []])
    src = v["sources"][names[0]]
    vv = dict(v, matrices={n: v["matrices"][n] for n in names}, scale=src["scale"],
              origin=src["origin"])
    others = frozenset(n for n in cut["names"] if n not in names)
    made = make_parts(rgba, labels, cut, track, vv, elsewhere=others)
    frame = (cut.get("clip") or {}).get("frame")
    for n in made["report"]:
        made["report"][n]["from"] = {"job": job, "frame": frame}
    return made


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
    cut, rgba, labels, track = _cut_files(root, get)
    sourced = v["sources"]
    made = make_parts(rgba, labels, cut, track, v, elsewhere=frozenset(sourced))
    for sjob in sorted({s["job"] for s in sourced.values()}):
        theirs = from_other_cut(sjob, [n for n, s in sourced.items() if s["job"] == sjob], v,
                                project_prefix, get)
        made["images"].update(theirs["images"])
        made["report"].update(theirs["report"])
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
