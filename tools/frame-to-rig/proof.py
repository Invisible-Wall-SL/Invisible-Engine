"""Frame to rig — the proof of the hard steps on one real frame (docs/design/frame-to-rig.md §8).

Not a gate and not app code: it measures the owner's frame, which is not in the repo. Every step
writes its numbers to <out>/report.json and its pictures to <out>/*.png.

    python proof.py pick    --track cap.json --out out/                 # score every frame of a clip
    python proof.py segment --frame f.png --track t.json --geometry g.json --out out/ [--models tiny,small]
    python proof.py holes   --out out/                                  # after segment
    python proof.py parts   --out out/                                  # parts on canvases + rig fit
    python proof.py compose --out out/ --posed posed.json               # draw the rig engine-rig posed

`--track` is a 🎥 Motion capture (rigger-motion `track()` output: pose 33 points with visibility and
world points, hands 21 points, face 478 points), normalised to the frame. `--geometry` is
`node tools/frame-to-rig/rig-pose.mjs --geometry` (the Half body template's setup pose).

Needs numpy, opencv-python-headless, pillow, torch (CPU) and transformers (SAM 2.1 from
`facebook/sam2.1-hiera-tiny` / `-small`, Apache-2.0).
"""

from __future__ import annotations

import argparse
import json
import math
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

# The template's `_l` is the PICTURE's left: the performer's right side (pose 12 / 14 / 16).
POSE = {
    "l": {"shoulder": 12, "elbow": 14, "wrist": 16, "hip": 24},
    "r": {"shoulder": 11, "elbow": 13, "wrist": 15, "hip": 23},
}
# Front to back: a pixel two parts claim goes to the one drawn in front (the template's draw order,
# where `_r`'s arm follows `_l`'s).
FRONT_TO_BACK = [
    "hand_r",
    "lower_arm_r",
    "upper_arm_r",
    "hand_l",
    "lower_arm_l",
    "upper_arm_l",
    "head",
    "neck",
    "torso",
]
PARENT = {
    "upper_arm_l": "torso",
    "lower_arm_l": "upper_arm_l",
    "hand_l": "lower_arm_l",
    "upper_arm_r": "torso",
    "lower_arm_r": "upper_arm_r",
    "hand_r": "lower_arm_r",
    "neck": "torso",
    "head": "neck",
}
COLOURS = {
    "torso": (240, 200, 40),
    "neck": (255, 120, 0),
    "head": (40, 200, 255),
    "upper_arm_l": (60, 220, 60),
    "lower_arm_l": (30, 120, 255),
    "hand_l": (255, 60, 200),
    "upper_arm_r": (140, 255, 120),
    "lower_arm_r": (120, 170, 255),
    "hand_r": (255, 140, 230),
}
FINGERS = [(1, 2, 3, 4), (5, 6, 7, 8), (9, 10, 11, 12), (13, 14, 15, 16), (17, 18, 19, 20)]
# The neck is optional in the template. Off by default: on a frame its skin is a sliver under the
# chin, often under a collar or a chain (NellyAnimTest: the prompt took the chain), so the visible
# neck stays in the head image and the head turns about the neck bone.
NECK = False


def load_json(p: Path):
    return json.loads(Path(p).read_text(encoding="utf8"))


def save_report(out: Path, key: str, value) -> None:
    out.mkdir(parents=True, exist_ok=True)
    path = out / "report.json"
    rep = load_json(path) if path.exists() else {}
    rep[key] = value
    path.write_text(json.dumps(rep, indent=1), encoding="utf8")


# --- joints -------------------------------------------------------------------------------------


def joints_of(frame: dict, w: int, h: int) -> dict:
    """The frame's joints in pixels, by template side, from one 🎥 Motion track frame."""
    P = [(x * w, y * h, v) for x, y, v in frame["pose"]["landmarks"]]
    world = frame["pose"].get("world")
    j: dict = {"pose": P, "world": world}
    for s, ids in POSE.items():
        for name, i in ids.items():
            j[f"{name}_{s}"] = np.array(P[i][:2])
    hands = {}
    for hand in frame.get("hands", []):
        pts = np.array([(x * w, y * h) for x, y in hand["landmarks"]])
        # Each hand goes to the side of the nearer pose wrist (as rigMotionHand does).
        side = min("lr", key=lambda s: np.linalg.norm(pts[0] - j[f"wrist_{s}"]))
        hands[side] = {"pts": pts, "world": np.array(hand["world"]) if hand.get("world") else None}
    j["hands"] = hands
    F = (
        np.array([(x * w, y * h) for x, y, *_ in frame["face"]["landmarks"]])
        if frame.get("face")
        else None
    )
    j["face"] = F
    return j


def limb_world_len(world, a: int, b: int) -> float:
    return float(np.linalg.norm(np.array(world[a]) - np.array(world[b])))


# --- pick: score every frame of a clip ------------------------------------------------------------


def cmd_pick(a) -> None:
    cap = load_json(a.track)
    frames = cap[0]["track"]["frames"] if isinstance(cap, list) else cap["frames"]
    rows = []
    for i, f in enumerate(frames):
        if not f.get("pose") or not f["pose"].get("world"):
            rows.append({"i": i, "score": None})
            continue
        P = f["pose"]["landmarks"]
        Wd = f["pose"]["world"]
        sh = np.linalg.norm(np.array(P[11][:2]) - np.array(P[12][:2]))
        shw = limb_world_len(Wd, 11, 12)
        px_per_m = sh / max(shw, 1e-6)
        fore = []
        for s in "lr":
            ids = POSE[s]
            for a_, b_ in (("shoulder", "elbow"), ("elbow", "wrist")):
                ia, ib = ids[a_], ids[b_]
                l2 = np.linalg.norm(np.array(P[ia][:2]) - np.array(P[ib][:2]))
                l3 = limb_world_len(Wd, ia, ib) * px_per_m
                fore.append(min(1.0, l2 / max(l3, 1e-6)))
        # A hand over the body or the face hides what is behind it: the share of the torso box and
        # the face box that the hands' boxes cover.
        hands = [np.array(hh["landmarks"]) for hh in f.get("hands", [])]
        tor = box_of(np.array([P[11][:2], P[12][:2], P[23][:2], P[24][:2]]))
        face = box_of(np.array(f["face"]["landmarks"])[:, :2]) if f.get("face") else None
        cover = 0.0
        for hd in hands:
            hb = box_of(hd[:, :2])
            cover += box_overlap(hb, tor) + (2 * box_overlap(hb, face) if face else 0)
        vis = min(P[i_][2] for i_ in (11, 12, 13, 14, 15, 16))
        found = (1 if f.get("face") else 0) + len(hands)
        score = float(np.mean(fore)) - 0.5 * cover - (0.5 if vis < 0.8 else 0) - 0.2 * (3 - found)
        rows.append(
            {
                "i": i,
                "score": round(score, 3),
                "foreshorten_min": round(float(min(fore)), 2),
                "foreshorten_mean": round(float(np.mean(fore)), 2),
                "hand_cover": round(cover, 3),
                "found": found,
            }
        )
    ok = [r for r in rows if r["score"] is not None]
    best = max(ok, key=lambda r: r["score"])
    print("frame 0:", rows[0])
    print("best   :", best)
    save_report(
        Path(a.out), "pick", {"frame0": rows[0], "best": best, "frames": len(rows), "rows": rows}
    )


def box_of(pts) -> tuple:
    return (
        float(pts[:, 0].min()),
        float(pts[:, 1].min()),
        float(pts[:, 0].max()),
        float(pts[:, 1].max()),
    )


def box_overlap(a, b) -> float:
    """The share of box b that box a covers."""
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    area = max(1e-9, (b[2] - b[0]) * (b[3] - b[1]))
    return ix * iy / area


# --- segment: SAM 2.1 prompted by the joints, against a geometry-only cut --------------------------


def prompts(j: dict, shape) -> dict:
    """Per part: positive points, negative points and a box, from the joints alone."""
    h, w = shape
    sh_w = float(np.linalg.norm(j["shoulder_l"] - j["shoulder_r"]))
    F = j["face"]
    chin, top = F[152], F[10]
    head_top = top + (top - chin) * 0.35
    sh_mid = (j["shoulder_l"] + j["shoulder_r"]) / 2
    hip_mid = (j["hip_l"] + j["hip_r"]) / 2
    hip_mid[1] = min(hip_mid[1], h - 2)
    torso_c = sh_mid + (hip_mid - sh_mid) * 0.45
    hand_c = {s: hd["pts"][[0, 5, 9, 13, 17]].mean(axis=0) for s, hd in j["hands"].items()}
    out = {}
    pad = 0.12 * sh_w
    for s in "lr":
        S, E, Wr = j[f"shoulder_{s}"], j[f"elbow_{s}"], j[f"wrist_{s}"]
        if s in j["hands"]:
            Wr = j["hands"][s]["pts"][0]
        hc = hand_c.get(s, Wr)
        ua = [S + (E - S) * t for t in (0.3, 0.55, 0.8)]
        la = [E + (Wr - E) * t for t in (0.25, 0.5, 0.75)]
        out[f"upper_arm_{s}"] = (ua, [la[1], hc, torso_c], expand(np.array([S, E]), pad, w, h))
        out[f"lower_arm_{s}"] = (la, [ua[1], hc, torso_c], expand(np.array([E, Wr]), pad, w, h))
        if s in j["hands"]:
            pts = j["hands"][s]["pts"]
            pos = [hc, pts[6], pts[10], pts[14], pts[3]]
            out[f"hand_{s}"] = (pos, [la[1], torso_c], expand(pts, 0.25 * sh_w * 0.4, w, h))
    out["head"] = (
        [F[1], F[168], F[10], head_top, F[152] + (F[1] - F[152]) * 0.2],
        [sh_mid + (hip_mid - sh_mid) * 0.15, *hand_c.values()],
        expand(np.vstack([F, head_top[None]]), 0.15 * sh_w, w, h),
    )
    if NECK:
        neck_c = sh_mid + (chin - sh_mid) * 0.45
        out["neck"] = (
            [neck_c],
            [F[1], torso_c],
            expand(np.array([chin, sh_mid]), 0.15 * sh_w, w, h),
        )
    out["torso"] = (
        [torso_c, sh_mid + (hip_mid - sh_mid) * 0.75, sh_mid + (hip_mid - sh_mid) * 0.2],
        [F[1], *hand_c.values(), *(j[f"elbow_{s}"] for s in "lr")],
        expand(
            np.array([j["shoulder_l"], j["shoulder_r"], j["hip_l"], j["hip_r"]]), 0.1 * sh_w, w, h
        ),
    )
    return out


def expand(pts, pad: float, w: int, h: int):
    x0, y0 = pts.min(axis=0) - pad
    x1, y1 = pts.max(axis=0) + pad
    return [max(0, x0), max(0, y0), min(w - 1, x1), min(h - 1, y1)]


def sam_logits(model_id: str, rgb: Image.Image, prm: dict) -> tuple[dict, float]:
    import torch
    from transformers import Sam2Model, Sam2Processor

    proc = Sam2Processor.from_pretrained(model_id)
    model = Sam2Model.from_pretrained(model_id).eval()
    t0 = time.time()
    inputs = proc(images=rgb, return_tensors="pt")
    with torch.no_grad():
        emb = model.get_image_embeddings(inputs["pixel_values"])
    logits = {}
    for part, (pos, neg, box) in prm.items():
        pts = [[float(x), float(y)] for x, y in [*pos, *neg]]
        labels = [1] * len(pos) + [0] * len(neg)
        q = proc(
            images=rgb,
            input_points=[[pts]],
            input_labels=[[labels]],
            input_boxes=[[box]],
            return_tensors="pt",
        )
        with torch.no_grad():
            o = model(
                image_embeddings=emb,
                input_points=q["input_points"],
                input_labels=q["input_labels"],
                input_boxes=q["input_boxes"],
                multimask_output=False,
            )
        m = proc.post_process_masks(o.pred_masks.cpu(), q["original_sizes"], binarize=False)[0]
        logits[part] = m[0, 0].numpy().astype(np.float32)
    return logits, time.time() - t0


def geometry_logits(j: dict, shape) -> dict:
    """A cut from the joints alone: each part is a soft capsule (or the face's hull) around its points."""
    h, w = shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    sh_w = float(np.linalg.norm(j["shoulder_l"] - j["shoulder_r"]))
    out = {}

    def capsule(a, b, r):
        ab = b - a
        t = np.clip(((xx - a[0]) * ab[0] + (yy - a[1]) * ab[1]) / max(1e-6, ab @ ab), 0, 1)
        d = np.hypot(xx - (a[0] + t * ab[0]), yy - (a[1] + t * ab[1]))
        return (r - d) / r

    for s in "lr":
        S, E, Wr = j[f"shoulder_{s}"], j[f"elbow_{s}"], j[f"wrist_{s}"]
        if s in j["hands"]:
            Wr = j["hands"][s]["pts"][0]
        out[f"upper_arm_{s}"] = capsule(S, E, 0.13 * sh_w)
        out[f"lower_arm_{s}"] = capsule(E, Wr, 0.1 * sh_w)
        if s in j["hands"]:
            pts = j["hands"][s]["pts"]
            best = None
            for f in FINGERS:
                for a_, b_ in zip((0, *f[:-1]), f):
                    c = capsule(pts[a_], pts[b_], 0.035 * sh_w)
                    best = c if best is None else np.maximum(best, c)
            out[f"hand_{s}"] = best
    F = j["face"]
    hull = cv2.convexHull(F.astype(np.float32)).reshape(-1, 2)
    face_mask = np.zeros((h, w), np.uint8)
    cv2.fillPoly(face_mask, [hull.astype(np.int32)], 1)
    dist = cv2.distanceTransform(1 - face_mask, cv2.DIST_L2, 5)
    out["head"] = (0.12 * sh_w - dist) / (0.12 * sh_w)
    sh_mid = (j["shoulder_l"] + j["shoulder_r"]) / 2
    if NECK:
        out["neck"] = capsule(F[152], sh_mid, 0.12 * sh_w)
    poly = np.array([j["shoulder_l"], j["shoulder_r"], j["hip_r"], j["hip_l"]], np.float32)
    tm = np.zeros((h, w), np.uint8)
    cv2.fillPoly(tm, [poly.astype(np.int32)], 1)
    dist = cv2.distanceTransform(1 - tm, cv2.DIST_L2, 5)
    out["torso"] = (0.15 * sh_w - dist) / (0.15 * sh_w)
    return out


def partition(logits: dict, alpha: np.ndarray, fallback: dict | None = None) -> tuple[dict, dict]:
    """Every visible pixel to exactly one part: the front-most part that claims it (logit > 0), else
    the part claiming it most (or the fallback's). Each part keeps its connected pieces that touch
    its biggest one; the rest go to the neighbour they touch most."""
    vis = alpha > 127
    names = [n for n in FRONT_TO_BACK if n in logits]
    label = np.full(alpha.shape, -1, np.int16)
    for i in range(len(names) - 1, -1, -1):
        label[(logits[names[i]] > 0) & vis] = i
    stack = np.stack([logits[n] for n in names])
    rest = vis & (label < 0)
    if fallback is not None:
        fstack = np.stack([fallback[n] for n in names])
        label[rest] = np.argmax(fstack, axis=0)[rest]
    else:
        label[rest] = np.argmax(stack, axis=0)[rest]
    stats = {"unclaimed_px": int(rest.sum()), "visible_px": int(vis.sum())}
    moved = 0
    for i, n in enumerate(names):
        m = (label == i).astype(np.uint8)
        k, comp, st, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
        if k <= 2:
            continue
        keep = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
        for c in range(1, k):
            if c == keep:
                continue
            piece = comp == c
            ring = (
                cv2.dilate(piece.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool) & ~piece
            )
            nb = label[ring]
            nb = nb[(nb >= 0) & (nb != i)]
            if nb.size:
                label[piece] = np.bincount(nb).argmax()
                moved += int(piece.sum())
    stats["reassigned_px"] = moved
    return {n: label == i for i, n in enumerate(names)}, stats


def overlay(rgb: np.ndarray, masks: dict, j: dict, path: Path, title: str) -> None:
    base = (rgb.astype(np.float32) * 0.35).astype(np.uint8)
    out = base.copy()
    for n, m in masks.items():
        c = np.array(COLOURS.get(n, (255, 255, 255)), np.float32)
        out[m] = (0.45 * rgb[m] + 0.55 * c).astype(np.uint8)
        edge = m.astype(np.uint8) - cv2.erode(m.astype(np.uint8), np.ones((3, 3), np.uint8))
        out[edge.astype(bool)] = (255, 255, 255)
    im = Image.fromarray(out)
    d = ImageDraw.Draw(im)
    draw_skeleton(d, j)
    d.text((8, 8), title, fill=(255, 255, 255))
    im.save(path)


def draw_skeleton(d: ImageDraw.ImageDraw, j: dict, colour=(255, 255, 0)) -> None:
    for s in "lr":
        pts = [tuple(j[f"{n}_{s}"]) for n in ("shoulder", "elbow", "wrist")]
        d.line(pts, fill=colour, width=2)
        for p in pts:
            d.ellipse([p[0] - 4, p[1] - 4, p[0] + 4, p[1] + 4], outline=colour, width=2)
        if s in j["hands"]:
            hp = j["hands"][s]["pts"]
            for f in FINGERS:
                d.line([tuple(hp[0])] + [tuple(hp[i]) for i in f], fill=(0, 255, 255), width=1)
    d.line([tuple(j["shoulder_l"]), tuple(j["shoulder_r"])], fill=colour, width=2)
    F = j["face"]
    for i in (33, 263, 1, 61, 291, 152, 10):
        p = F[i]
        d.ellipse([p[0] - 2, p[1] - 2, p[0] + 2, p[1] + 2], fill=(255, 80, 80))


def iou(a, b) -> float:
    u = (a | b).sum()
    return float((a & b).sum() / u) if u else 1.0


def cmd_segment(a) -> None:
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    frame = Image.open(a.frame).convert("RGBA")
    rgba = np.array(frame)
    alpha = rgba[..., 3]
    # The page tracks on grey; SAM sees the same picture.
    rgb = (
        rgba[..., :3] * (alpha[..., None] / 255.0) + 128 * (1 - alpha[..., None] / 255.0)
    ).astype(np.uint8)
    track = load_json(a.track)
    tf = track["frames"][0] if "frames" in track else track
    j = joints_of(tf, frame.width, frame.height)
    prm = prompts(j, alpha.shape)
    geo = geometry_logits(j, alpha.shape)
    np.savez_compressed(out / "geometry_logits.npz", **geo)
    results = {}
    masks_by = {}
    gm, gstats = partition(geo, alpha)
    masks_by["geometry"] = gm
    results["geometry"] = {"stats": gstats}
    overlay(rgb, gm, j, out / "cut-geometry.png", "joints only (capsules + face hull)")
    for name in a.models.split(","):
        mid = f"facebook/sam2.1-hiera-{name}"
        lg, secs = sam_logits(mid, Image.fromarray(rgb), prm)
        np.savez_compressed(out / f"sam_{name}_logits.npz", **lg)
        m, st = partition(lg, alpha, fallback=geo)
        masks_by[name] = m
        results[name] = {"model": mid, "cpu_seconds": round(secs, 1), "stats": st}
        overlay(
            rgb,
            m,
            j,
            out / f"cut-sam-{name}.png",
            f"SAM 2.1 {name}, joint-prompted ({secs:.1f}s CPU)",
        )
    names = list(gm)
    per = {}
    for n in names:
        row = {}
        for k, m in masks_by.items():
            row[f"{k}_px"] = int(m[n].sum())
        ks = list(masks_by)
        for x in range(len(ks)):
            for y in range(x + 1, len(ks)):
                row[f"iou_{ks[x]}_{ks[y]}"] = round(iou(masks_by[ks[x]][n], masks_by[ks[y]][n]), 3)
        per[n] = row
    results["parts"] = per
    best = a.models.split(",")[-1]
    np.savez_compressed(out / "masks.npz", **{n: masks_by[best][n] for n in names})
    Image.fromarray(rgba).save(out / "frame.png")
    (out / "joints.json").write_text(json.dumps(to_jsonable(j)), encoding="utf8")
    save_report(out, "segment", results)
    print(json.dumps(results, indent=1))


# --- props: the chain, the glasses, the jewellery, each its own part -----------------------------

# MediaPipe's multiclass selfie segmenter: background, hair, body-skin, face-skin, clothes, others
# (accessories). Apache-2.0.
ACCESSORY = 5


def accessories(rgb: np.ndarray, model: str) -> np.ndarray:
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions, vision

    seg = vision.ImageSegmenter.create_from_options(
        vision.ImageSegmenterOptions(
            base_options=BaseOptions(model_asset_path=model),
            running_mode=vision.RunningMode.IMAGE,
            output_confidence_masks=True,
        )
    )
    r = seg.segment(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb)))
    # A copy: the view points into the result, which is freed with it.
    return r.confidence_masks[ACCESSORY].numpy_view().squeeze().copy()


def arm_tail(slots: list, s: str) -> str:
    """The last slot of side `s`'s arm (its last finger segment): a prop on that arm is drawn after it."""
    names = [x["name"] for x in slots]
    start = names.index("hair_front")
    return [n for n in names[start:] if n.endswith(f"_{s}")][-1]


def classify(comp: np.ndarray, j: dict, slots: list) -> dict | None:
    """What a found accessory is, from where it sits on the joints: its name, the bone it rides, the
    slot it is drawn before or after, and the part it hides. None = not a prop (the author confirms)."""
    F = j["face"]
    sw = float(np.linalg.norm(j["shoulder_l"] - j["shoulder_r"]))
    ys, xs = np.nonzero(comp)
    c = np.array([xs.mean(), ys.mean()])

    def on(p, r=4):
        x, y = int(round(p[0])), int(round(p[1]))
        return comp[max(0, y - r) : y + r + 1, max(0, x - r) : x + r + 1].any()

    if any(on(F[i]) for i in (33, 133, 159, 145, 263, 362, 386, 374)):
        return {"name": "prop_glasses", "bone": "face", "before": "hair_front", "host": "head"}
    if ys.mean() < F[10][1] and comp.sum() > 2000:
        return None  # on top of the head: hair or a hat, which the author says
    for s in "lr":
        ear = np.array(j["pose"][7 if s == "r" else 8][:2])
        if np.linalg.norm(c - ear) < 0.2 * sw and comp.sum() < 1500:  # it hangs below the lobe
            return {"name": f"prop_earring_{s}", "bone": "head", "before": "hair_front", "host": "head"}
    sm = (j["shoulder_l"] + j["shoulder_r"]) / 2
    chin = F[152]
    if chin[1] - 0.05 * sw < c[1] < sm[1] + 0.4 * sw and abs(c[0] - (chin[0] + sm[0]) / 2) < 0.5 * sw:
        return {"name": "prop_chain", "bone": "chest", "before": "neck", "host": "torso"}
    for s in "lr":
        if np.linalg.norm(c - wrist(j, s)) < 0.15 * sw:
            return {"name": f"prop_wrist_{s}", "bone": f"lower_arm_{s}", "after": arm_tail(slots, s),
                    "host": f"lower_arm_{s}"}
    for s, hd in j["hands"].items():
        if np.min(np.linalg.norm(hd["pts"] - c, axis=1)) < 0.06 * sw:
            return {"name": f"prop_ring_{s}", "bone": f"hand_{s}", "after": arm_tail(slots, s),
                    "host": f"hand_{s}"}
    return None


def cmd_props(a) -> None:
    """Find the accessories (MediaPipe's segmenter), name each by where it sits, refine it with SAM
    and cut it out of the part under it: a prop is its own image on its own slot."""
    out = Path(a.out)
    rgba = np.array(Image.open(out / "frame.png").convert("RGBA"))
    alpha = rgba[..., 3]
    rgb = (rgba[..., :3] * (alpha[..., None] / 255.0) + 128 * (1 - alpha[..., None] / 255.0)).astype(np.uint8)
    j = from_jsonable(load_json(out / "joints.json"))
    slots = load_json(a.geometry)["slots"]
    masks = {k: v for k, v in np.load(out / "masks.npz").items() if not k.startswith("prop_")}
    t0 = time.time()
    acc = accessories(rgb, a.segmenter)
    t_seg = time.time() - t0
    # torch after MediaPipe: loaded first, it makes MediaPipe's TFLite segmenter crash (Windows).
    import torch
    from transformers import Sam2Model, Sam2Processor

    n, lab, st, _ = cv2.connectedComponentsWithStats(((acc > 0.3) & (alpha > 127)).astype(np.uint8), 8)
    mid = "facebook/sam2.1-hiera-small"
    proc = Sam2Processor.from_pretrained(mid)
    model = Sam2Model.from_pretrained(mid).eval()
    inputs = proc(images=Image.fromarray(rgb), return_tensors="pt")
    with torch.no_grad():
        emb = model.get_image_embeddings(inputs["pixel_values"])
    found, rejected, props, meta = [], [], {}, {}
    h, w = alpha.shape
    for i in range(1, n):
        if st[i, cv2.CC_STAT_AREA] < a.min_prop:
            continue
        comp = lab == i
        kind = classify(comp, j, slots)
        x, y, bw, bh = (int(v) for v in st[i, :4])
        if kind is None:
            rejected.append({"box": [x, y, bw, bh], "px": int(comp.sum())})
            continue
        # SAM from the found pixels: a box around them (a chain's reaches down for its pendant) and
        # points deep inside them.
        down = 0.8 * bh if kind["name"] == "prop_chain" else 0.15 * bh
        box = [max(0, x - 0.15 * bw), max(0, y - 0.15 * bh), min(w - 1, x + 1.15 * bw), min(h - 1, y + bh + down)]
        dist = cv2.distanceTransform(comp.astype(np.uint8), cv2.DIST_L2, 3)
        order = np.argsort(dist.ravel())[::-1][:400]
        pts = [[float(k % w), float(k // w)] for k in order[:: max(1, len(order) // 5)]][:5]
        q = proc(images=Image.fromarray(rgb), input_points=[[pts]], input_labels=[[[1] * len(pts)]],
                 input_boxes=[[box]], return_tensors="pt")
        with torch.no_grad():
            o = model(image_embeddings=emb, input_points=q["input_points"], input_labels=q["input_labels"],
                      input_boxes=q["input_boxes"], multimask_output=False)
        sam = proc.post_process_masks(o.pred_masks.cpu(), q["original_sizes"])[0][0, 0].numpy().astype(bool)
        inbox = np.zeros_like(comp)
        inbox[int(box[1]) : int(box[3]) + 1, int(box[0]) : int(box[2]) + 1] = True
        m = ((sam & inbox) | comp) & (alpha > 127)
        name = kind["name"]
        props[name] = props.get(name, np.zeros_like(m)) | m
        meta[name] = kind
        found.append({"name": name, "segmenter_px": int(comp.sum()), "with_sam_px": int(m.sum())})
    taken = np.zeros(alpha.shape, bool)
    for name in props:
        props[name] &= ~taken
        taken |= props[name]
    under = {}
    for part in list(masks):
        under[part] = int((masks[part] & taken).sum())
        masks[part] = masks[part] & ~taken
    np.savez_compressed(out / "masks.npz", **masks, **props)
    (out / "props.json").write_text(json.dumps(meta, indent=1), encoding="utf8")
    overlay(rgb, {**masks, **props}, j, out / "props.png", "props cut out of their parts (white)")
    rep = {"segmenter_seconds": round(t_seg, 2), "found": found, "rejected": rejected, "taken_from": under}
    save_report(out, "props", rep)
    print(json.dumps(rep, indent=1))


def to_jsonable(j: dict) -> dict:
    o = {}
    for k, v in j.items():
        if k == "hands":
            o[k] = {
                s: {
                    "pts": hd["pts"].tolist(),
                    "world": None if hd["world"] is None else hd["world"].tolist(),
                }
                for s, hd in v.items()
            }
        elif isinstance(v, np.ndarray):
            o[k] = v.tolist()
        else:
            o[k] = v
    return o


def from_jsonable(o: dict) -> dict:
    j = dict(o)
    for k, v in o.items():
        if k == "hands":
            j[k] = {
                s: {
                    "pts": np.array(hd["pts"]),
                    "world": None if hd["world"] is None else np.array(hd["world"]),
                }
                for s, hd in v.items()
            }
        elif k in ("pose", "world"):
            j[k] = v
        elif isinstance(v, list):
            j[k] = np.array(v)
    return j


# --- holes: what each part needs filled ------------------------------------------------------------

LIMBS = {
    "upper_arm_l": ("shoulder_l", "elbow_l"),
    "lower_arm_l": ("elbow_l", "wrist_l"),
    "upper_arm_r": ("shoulder_r", "elbow_r"),
    "lower_arm_r": ("elbow_r", "wrist_r"),
}
BAND = 8  # px: a hidden pixel this near the part's visible pixels is a seam a CPU fill can take


def wrist(j: dict, s: str):
    return j["hands"][s]["pts"][0] if s in j["hands"] else j[f"wrist_{s}"]


def joint(j: dict, name: str):
    return wrist(j, name[-1]) if name.startswith("wrist") else j[name]


def capsule_mask(shape, a, b, r) -> np.ndarray:
    m = np.zeros(shape, np.uint8)
    cv2.line(m, tuple(int(v) for v in a), tuple(int(v) for v in b), 1, thickness=max(1, int(2 * r)))
    cv2.circle(m, tuple(int(v) for v in a), int(r), 1, -1)
    cv2.circle(m, tuple(int(v) for v in b), int(r), 1, -1)
    return m.astype(bool)


def half_width(vis: np.ndarray, a, b) -> float:
    ys, xs = np.nonzero(vis)
    ab = b - a
    L2 = max(1e-6, float(ab @ ab))
    t = ((xs - a[0]) * ab[0] + (ys - a[1]) * ab[1]) / L2
    d = np.abs((xs - a[0]) * ab[1] - (ys - a[1]) * ab[0]) / math.sqrt(L2)
    mid = (t > 0.2) & (t < 0.8)
    return float(np.percentile(d[mid], 90)) if mid.sum() > 20 else 12.0


def amodal(part: str, masks: dict, j: dict, alpha: np.ndarray) -> np.ndarray:
    """Where the whole part would be: its visible pixels plus the shape it continues in behind what
    covers it (a limb's capsule with round ends — the overlap a joint needs to bend without a gap —,
    a hand's wrist end, the torso's hull through the shoulders and hips), inside the character's
    outline."""
    vis = masks[part]
    inside = alpha > 127
    shape = alpha.shape
    if part in LIMBS:
        a, b = (joint(j, n) for n in LIMBS[part])
        cap = capsule_mask(shape, a, b, half_width(vis, a, b))
        return vis | (cap & inside)
    if part.startswith("hand_"):
        s = part[-1]
        if s not in j["hands"]:
            return vis
        # The hand as cut plus its wrist's round end. A hull fills the gaps of a spread hand, and
        # capsules on the tracked fingers (a cartoon's are drawn off a person's) reach into the
        # torso: either way the hand then carries tank-top patches wherever it moves.
        pts = j["hands"][s]["pts"].astype(np.float32)
        m = np.zeros(shape, np.uint8)
        r = (
            half_width(masks[f"lower_arm_{s}"], j[f"elbow_{s}"], wrist(j, s))
            if masks[f"lower_arm_{s}"].any()
            else 12
        )
        cv2.circle(m, tuple(int(v) for v in pts[0]), int(r), 1, -1)
        return vis | (m.astype(bool) & inside)
    if part == "neck":
        sh_mid = (j["shoulder_l"] + j["shoulder_r"]) / 2
        chin = j["face"][152]
        r = (
            half_width(vis, sh_mid, chin)
            if vis.sum() > 50
            else 0.1 * np.linalg.norm(j["shoulder_l"] - j["shoulder_r"])
        )
        return vis | (capsule_mask(shape, sh_mid, chin + (chin - sh_mid) * 0.15, r) & inside)
    if part == "torso":
        pts = np.argwhere(vis)[:, ::-1].astype(np.float32)
        extra = np.array([j["shoulder_l"], j["shoulder_r"], j["hip_l"], j["hip_r"]], np.float32)
        extra[:, 1] = np.minimum(extra[:, 1], shape[0] - 1)
        m = np.zeros(shape, np.uint8)
        cv2.fillPoly(m, [cv2.convexHull(np.vstack([pts, extra])).astype(np.int32)], 1)
        return vis | (m.astype(bool) & inside & ~masks["head"])
    if part == "head":
        pts = np.vstack([np.argwhere(vis)[:, ::-1], j["face"]]).astype(np.float32)
        m = np.zeros(shape, np.uint8)
        cv2.fillPoly(m, [cv2.convexHull(pts).astype(np.int32)], 1)
        return vis | (m.astype(bool) & inside)
    return vis


def cmd_holes(a) -> None:
    out = Path(a.out)
    rgba = np.array(Image.open(out / "frame.png").convert("RGBA"))
    alpha = rgba[..., 3]
    masks = dict(np.load(out / "masks.npz"))
    j = from_jsonable(load_json(out / "joints.json"))
    props = load_json(out / "props.json") if (out / "props.json").exists() else {}
    rank = draw_rank(load_json(a.geometry)["slots"], props)
    rows = {}
    full = {}
    tiles = []
    for name in props:
        full[name] = masks[name]
        full[f"{name}__occluded"] = np.zeros_like(masks[name])
    for part in FRONT_TO_BACK:
        if part not in masks:
            continue
        vis = masks[part]
        am = amodal(part, masks, j, alpha)
        hidden = am & ~vis
        # Under a part drawn IN FRONT: occluded, revealed when that part moves — it must be made.
        # Over a part drawn BEHIND (a joint's round end, or pixels the cut gave the neighbour): the
        # part is drawn on top there, so the frame's own pixels are the right content.
        front = np.zeros_like(vis)
        under_props = np.zeros_like(vis)
        for other in masks:
            if other in rank and rank[other] > rank[part]:
                front |= masks[other]
                if other.startswith("prop_"):
                    under_props |= masks[other]
        occluded = hidden & front
        overlap = hidden & ~front
        full[part] = am
        full[f"{part}__occluded"] = occluded
        dist = cv2.distanceTransform((~(vis | overlap)).astype(np.uint8), cv2.DIST_L2, 5)
        band = occluded & (dist <= BAND)
        cover = {}
        for other in masks:
            if other != part:
                n = int((hidden & masks[other]).sum())
                if n:
                    cover[other] = n
        rows[part] = {
            "visible_px": int(vis.sum()),
            "whole_px": int(am.sum()),
            "overlap_copied_px": int(overlap.sum()),
            "occluded_px": int(occluded.sum()),
            "under_props_px": int((occluded & under_props).sum()),
            "occluded_share": round(float(occluded.sum() / max(1, am.sum())), 3),
            "seam_band_px": int(band.sum()),
            "interior_px": int((occluded & ~band).sum()),
            "deepest_px": round(float(dist[occluded].max()) if occluded.any() else 0.0, 1),
            "covered_by": cover,
        }
        tiles.append((part, rgba, vis | overlap, occluded))
    np.savez_compressed(out / "whole.npz", **full)
    save_report(out, "holes", rows)
    print(json.dumps(rows, indent=1))
    hole_sheet(tiles, out / "holes.png")


def draw_rank(slots: list, props: dict) -> dict:
    """Each part's place in the template's draw order (higher = drawn later, in front), with each
    prop inserted before or after the slot it names."""
    order = [x["name"] for x in slots]
    for name, meta in props.items():
        if "before" in meta:
            order.insert(order.index(meta["before"]), name)
        else:
            order.insert(order.index(meta["after"]) + 1, name)
    return {n: i for i, n in enumerate(order)}


def crop_box(m: np.ndarray, pad: int = 10):
    ys, xs = np.nonzero(m)
    h, w = m.shape
    return (
        max(0, xs.min() - pad),
        max(0, ys.min() - pad),
        min(w, xs.max() + pad),
        min(h, ys.max() + pad),
    )


def hole_sheet(tiles, path: Path) -> None:
    """Per part: what is visible, and in magenta what must be filled (the seam band lighter)."""
    cells = []
    for part, rgba, vis, hidden in tiles:
        x0, y0, x1, y1 = crop_box(vis | hidden)
        img = np.zeros((y1 - y0, x1 - x0, 3), np.uint8) + 40
        sub = rgba[y0:y1, x0:x1]
        v = vis[y0:y1, x0:x1]
        hd = hidden[y0:y1, x0:x1]
        img[v] = sub[..., :3][v]
        img[hd] = (255, 0, 200)
        cell = Image.fromarray(img)
        cell.thumbnail((240, 240))
        canvas = Image.new("RGB", (250, 270), (24, 24, 24))
        canvas.paste(cell, (5, 22))
        ImageDraw.Draw(canvas).text(
            (5, 4), f"{part}  hidden {int(hd.sum())} px", fill=(255, 255, 255)
        )
        cells.append(canvas)
    cols = 3
    rows = (len(cells) + cols - 1) // cols
    sheet = Image.new("RGB", (250 * cols, 270 * rows), (24, 24, 24))
    for i, c in enumerate(cells):
        sheet.paste(c, ((i % cols) * 250, (i // cols) * 270))
    sheet.save(path)


# --- parts: the fitted skeleton, the frame's pose, each part on a canvas centred on its bone ---------

SLOT_BONE = {  # the bone each part's image hangs on (Half body 3: torso, head and arms on image bones)
    "torso": "torso_image",
    "neck": "neck",
    "head": "head_image",
    "upper_arm_l": "upper_arm_l_image",
    "lower_arm_l": "lower_arm_l_image",
    "hand_l": "hand_l",
    "upper_arm_r": "upper_arm_r_image",
    "lower_arm_r": "lower_arm_r_image",
    "hand_r": "hand_r",
}


def rot(deg: float, v):
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return np.array([c * v[0] - s * v[1], s * v[0] + c * v[1]])


def ang(v) -> float:
    return math.degrees(math.atan2(v[1], v[0]))


def wrap(d: float) -> float:
    return d - 360 * round(d / 360)


def fit(j: dict, geometry: dict) -> dict:
    """The skeleton fitted to the frame (setup offsets, template directions) and the frame's pose
    (rotations keyed against that setup). Rig units: the template's shoulder width over the frame's."""
    sw = float(np.linalg.norm(j["shoulder_l"] - j["shoulder_r"]))
    k = 280.0 / sw
    hip_mid = (j["hip_l"] + j["hip_r"]) / 2
    O = hip_mid.copy()

    def R(p):
        return np.array([k * (p[0] - O[0]), -k * (p[1] - O[1])])

    S = {s: R(j[f"shoulder_{s}"]) for s in "lr"}
    E = {s: R(j[f"elbow_{s}"]) for s in "lr"}
    Wr = {s: R(wrist(j, s)) for s in "lr"}
    sm = (S["l"] + S["r"]) / 2
    tc = ang(S["r"] - S["l"])  # the chest's world turn: its shoulder line
    C = sm - rot(tc, [0, 110])
    spine_at = np.array([0.0, 70.0])
    phi = ang(C - spine_at) - 90
    Lc = float(np.linalg.norm(C - spine_at))
    N = C + rot(tc, [0, 130])
    F = j["face"]
    eye_l, eye_r = R(F[33]), R(F[263])
    tau = ang(eye_r - eye_l)
    Em = (eye_l + eye_r) / 2
    Hd = Em - rot(tau, [0, 110])
    psi = ang(Hd - N) - 90
    Lh = float(np.linalg.norm(Hd - N))
    bones = {"chest": {"x": 0, "y": Lc}, "head": {"x": 0, "y": Lh}}
    pose = {
        "spine": {"rotate": wrap(phi)},
        "chest": {"rotate": wrap(tc - phi)},
        "neck": {"rotate": wrap(psi - tc)},
        "head": {"rotate": wrap(tau - psi)},
    }
    lengths = {}
    for s in "lr":
        a_ua = ang(E[s] - S[s]) + 90
        a_la = ang(Wr[s] - E[s]) + 90
        Lua = float(np.linalg.norm(E[s] - S[s]))
        Lla = float(np.linalg.norm(Wr[s] - E[s]))
        bones[f"lower_arm_{s}"] = {"x": 0, "y": -Lua}
        bones[f"hand_{s}"] = {"x": 0, "y": -Lla}
        pose[f"upper_arm_{s}"] = {"rotate": wrap(a_ua - tc)}
        pose[f"lower_arm_{s}"] = {"rotate": wrap(a_la - a_ua)}
        a_h = a_la
        if s in j["hands"]:
            a_h = ang(R(j["hands"][s]["pts"][9]) - Wr[s]) + 90
        pose[f"hand_{s}"] = {"rotate": wrap(a_h - a_la)}
        lengths[s] = {"upper_arm": Lua, "lower_arm": Lla}
    world = {  # each image bone's world turn and place in the frame's pose, for the canvases
        "torso_image": (tc, C),
        "chest": (tc, C),
        "head": (tau, Hd),
        "face": (tau, Hd + rot(tau, [0, 90])),
        "neck": (psi, N),
        "head_image": (tau, Hd),
    }
    for s in "lr":
        a_ua = ang(E[s] - S[s]) + 90
        a_la = ang(Wr[s] - E[s]) + 90
        a_h = (
            tc
            + pose[f"upper_arm_{s}"]["rotate"]
            + pose[f"lower_arm_{s}"]["rotate"]
            + pose[f"hand_{s}"]["rotate"]
        )
        world[f"upper_arm_{s}_image"] = (a_ua, S[s])
        world[f"lower_arm_{s}_image"] = (a_la, E[s])
        world[f"lower_arm_{s}"] = (a_la, E[s])
        world[f"hand_{s}"] = (a_h, Wr[s])
    tb = {b["name"]: b for b in geometry["bonesTemplate"]}
    return {
        "k": k,
        "origin_px": O.tolist(),
        "bones": bones,
        "pose": pose,
        "world": {n: (t, p.tolist()) for n, (t, p) in world.items()},
        "template_lengths": {
            "upper_arm": -tb["lower_arm_l"]["y"],
            "lower_arm": -tb["hand_l"]["y"],
            "chest": tb["chest"]["y"],
            "head": tb["head"]["y"],
        },
        "fitted_lengths": {**lengths, "chest": Lc, "head": Lh},
        "eye_spacing": {"frame": float(np.linalg.norm(eye_r - eye_l)), "template": 90.0},
    }


def foreshortening(j: dict) -> dict:
    """Each limb's drawn length over its length in MediaPipe's 3D world points (shoulders as the
    scale): 1 lies in the picture, under 1 points at or away from the camera."""
    W = j["world"]
    P = j["pose"]
    sh = np.linalg.norm(np.array(P[11][:2]) - np.array(P[12][:2]))
    pxm = sh / limb_world_len(W, 11, 12)
    out = {}
    for s, ids in POSE.items():
        for a_, b_, n in (("shoulder", "elbow", "upper_arm"), ("elbow", "wrist", "lower_arm")):
            ia, ib = ids[a_], ids[b_]
            l2 = np.linalg.norm(np.array(P[ia][:2]) - np.array(P[ib][:2]))
            out[f"{n}_{s}"] = round(float(l2 / (limb_world_len(W, ia, ib) * pxm)), 2)
    return out


def canvas_for(
    rgba: np.ndarray, mask: np.ndarray, k: float, O, turn: float, at
) -> tuple[np.ndarray, int, int]:
    """The part's pixels in its bone's frame: a canvas centred on the bone, 1 px = 1 rig unit,
    image-up = the bone's up at setup (the template's convention: centred, no offset)."""
    ys, xs = np.nonzero(mask)
    pts = np.stack([k * (xs - O[0]), -k * (ys - O[1])], axis=1) - np.array(at)
    c, s = math.cos(math.radians(-turn)), math.sin(math.radians(-turn))
    loc = pts @ np.array([[c, s], [-s, c]])
    half_w = int(np.abs(loc[:, 0]).max()) + 4
    half_h = int(np.abs(loc[:, 1]).max()) + 4
    Wc, Hc = 2 * half_w, 2 * half_h
    # canvas (u, v) → local (u − W/2, H/2 − v) → rig at + R(turn)·local → frame px.
    ct, st = math.cos(math.radians(turn)), math.sin(math.radians(turn))
    turn_m = np.array([[ct, -st], [st, ct]])
    ax = turn_m @ np.array([[1, 0], [0, -1]])
    off = turn_m @ np.array([-Wc / 2, Hc / 2]) + np.array(at)
    M = np.array(
        [
            [ax[0, 0] / k, ax[0, 1] / k, off[0] / k + O[0]],
            [-ax[1, 0] / k, -ax[1, 1] / k, -off[1] / k + O[1]],
        ],
        np.float32,
    )
    src = rgba.copy()
    src[..., 3] = np.where(mask, rgba[..., 3], 0)
    img = cv2.warpAffine(
        src,
        M,
        (Wc, Hc),
        flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(0, 0, 0, 0),
    )
    return img, Wc, Hc


def cmd_parts(a) -> None:
    out = Path(a.out)
    rgba = np.array(Image.open(out / "frame.png").convert("RGBA"))
    masks = dict(np.load(out / "masks.npz"))
    whole = dict(np.load(out / "whole.npz"))
    j = from_jsonable(load_json(out / "joints.json"))
    geometry = load_json(a.geometry)
    f = fit(j, geometry)
    k, O = f["k"], np.array(f["origin_px"])
    variants = {"visible": {}, "cpufill": {}}
    made = {}
    for m in sorted(out.glob("made.*.npz")):
        variants[f"made-{m.stem.split('.')[1]}"] = {}
        made[f"made-{m.stem.split('.')[1]}"] = dict(np.load(m))
    props = load_json(out / "props.json") if (out / "props.json").exists() else {}
    for part, bone in {**SLOT_BONE, **{n: m["bone"] for n, m in props.items()}}.items():
        if part not in masks or not masks[part].any():
            continue
        turn, at = f["world"][bone]
        vis = masks[part]
        img, _, _ = canvas_for(rgba, vis, k, O, turn, at)
        variants["visible"][part] = img
        occluded = whole[f"{part}__occluded"]
        img2, _, _ = canvas_for(
            cpu_fill(rgba, whole[part] & ~occluded, whole[part]), whole[part], k, O, turn, at
        )
        variants["cpufill"][part] = img2
        for name, m in made.items():
            if part in m:
                variants[name][part], _, _ = canvas_for(m[part], whole[part], k, O, turn, at)
            else:
                variants[name][part] = img2 if occluded.any() else img
    for name, parts in variants.items():
        d = out / f"parts-{name}"
        d.mkdir(exist_ok=True)
        for part, img in parts.items():
            Image.fromarray(img).save(d / f"{part}.png")
        pack_sheet(parts, out / f"sheet-{name}.png", out / f"sheet-{name}.json")
    regions = [
        {"name": p, "w": int(img.shape[1]), "h": int(img.shape[0])}
        for p, img in variants["visible"].items()
    ]
    test = bend(f["pose"])
    fit_json = {
        "regions": regions,
        "props": [{"name": n, **{k_: v for k_, v in m.items() if k_ != "host"}} for n, m in props.items()],
        "bones": f["bones"],
        "poses": {"frame": f["pose"], "bend": test},
    }
    (out / "fit.json").write_text(json.dumps(fit_json, indent=1), encoding="utf8")
    report = {k_: v for k_, v in f.items() if k_ not in ("world",)}
    report["foreshortening"] = foreshortening(j)
    save_report(out, "fit", report)
    print(json.dumps(report, indent=1))


def cpu_fill(rgba: np.ndarray, vis: np.ndarray, whole: np.ndarray) -> np.ndarray:
    """The part's hidden pixels filled from its own visible ones by OpenCV's Telea (BSD, no model):
    right for a seam's few pixels, a smear across an interior."""
    x0, y0, x1, y1 = crop_box(whole, 12)
    sub = cv2.cvtColor(np.ascontiguousarray(rgba[y0:y1, x0:x1, :3]), cv2.COLOR_RGB2BGR)
    mask = (~vis[y0:y1, x0:x1]).astype(np.uint8)
    filled = rgba.copy()
    filled[y0:y1, x0:x1, :3] = cv2.cvtColor(
        cv2.inpaint(sub, mask, 6, cv2.INPAINT_TELEA), cv2.COLOR_BGR2RGB
    )
    filled[..., 3] = 255
    return filled


def bend(pose: dict) -> dict:
    """The frame's pose moved at every joint, to show what a cut part reveals when it moves."""
    b = json.loads(json.dumps(pose))
    for s, sign in (("l", 1), ("r", -1)):
        b[f"upper_arm_{s}"]["rotate"] += 25 * sign
        b[f"lower_arm_{s}"]["rotate"] += 35 * sign
        b[f"hand_{s}"]["rotate"] += 25 * sign
    b["head"]["rotate"] += 12
    b["chest"]["rotate"] -= 6
    return b


def pack_sheet(parts: dict, png: Path, js: Path) -> None:
    """A shelf pack of the named parts (the real pipeline packs with the Atlas Maker)."""
    items = sorted(parts.items(), key=lambda kv: -kv[1].shape[0])
    width = 1024
    x = y = shelf = 0
    place = {}
    for name, img in items:
        h, w = img.shape[:2]
        if x + w > width:
            x, y, shelf = 0, y + shelf + 2, 0
        place[name] = (x, y, w, h)
        x += w + 2
        shelf = max(shelf, h)
    sheet = np.zeros((y + shelf, width, 4), np.uint8)
    for name, (x, y, w, h) in place.items():
        sheet[y : y + h, x : x + w] = parts[name]
    Image.fromarray(sheet).save(png)
    js.write_text(
        json.dumps(
            {
                "frames": {
                    n: {"frame": {"x": x, "y": y, "w": w, "h": h}}
                    for n, (x, y, w, h) in place.items()
                },
                "meta": {"size": {"w": width, "h": y + shelf}},
            },
            indent=1,
        ),
        encoding="utf8",
    )


# --- compose: draw the rig as engine-rig poses it, and measure it against the frame -----------------


def draw_rig(state: dict, parts_dir: Path, k: float, O, size, props: bool = True) -> np.ndarray:
    canvas = np.zeros((size[1], size[0], 4), np.float32)
    for q in state["quads"]:
        if not props and q["slot"].startswith("prop_"):
            continue
        p = parts_dir / f"{q['part']}.png"
        if not p.exists():
            continue
        img = np.array(Image.open(p).convert("RGBA")).astype(np.float32)
        h, w = img.shape[:2]
        v = np.array(q["v"]).reshape(4, 2)
        px = np.stack([v[:, 0] / k + O[0], -v[:, 1] / k + O[1]], axis=1).astype(np.float32)
        # Region vertices: bottom-left, top-left, top-right, bottom-right of the image.
        M = cv2.getAffineTransform(np.float32([[0, h], [0, 0], [w, 0]]), px[:3])
        warped = cv2.warpAffine(
            img,
            M,
            size,
            flags=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_CONSTANT,
            borderValue=(0, 0, 0, 0),
        )
        al = warped[..., 3:4] / 255.0
        canvas[..., :3] = warped[..., :3] * al + canvas[..., :3] * (1 - al)
        canvas[..., 3:4] = 255 * (al + canvas[..., 3:4] / 255.0 * (1 - al))
    return canvas


def cmd_compose(a) -> None:
    out = Path(a.out)
    rep = load_json(out / "report.json")
    k, O = rep["fit"]["k"], np.array(rep["fit"]["origin_px"])
    posed = load_json(a.posed)
    rgba = np.array(Image.open(out / "frame.png").convert("RGBA")).astype(np.float32)
    j = from_jsonable(load_json(out / "joints.json"))
    size = (rgba.shape[1], rgba.shape[0])
    res = {"missing_required": posed["missingRequired"]}
    fa = rgba[..., 3] > 127
    shots = []
    variants = ["visible", "cpufill"] + sorted(p.name[6:] for p in out.glob("parts-made-*"))
    for variant in variants:
        pd = out / f"parts-{variant}"
        for name in ("frame", "bend"):
            r = draw_rig(posed["poses"][name], pd, k, O, size)
            ra = r[..., 3] > 127
            shots.append((f"{variant} · {name}", r))
            closed = cv2.morphologyEx(
                ra.astype(np.uint8),
                cv2.MORPH_CLOSE,
                cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)),
            ).astype(bool)
            row = {"cracks_px": int((closed & ~ra).sum())}
            if name == "frame":
                both = fa & ra
                row["alpha_iou"] = round(iou(fa, ra), 4)
                row["mean_abs_rgb_diff"] = round(
                    float(np.abs(r[..., :3] - rgba[..., :3])[both].mean()), 2
                )
            res[f"{variant}_{name}"] = row
        r = draw_rig(posed["setup"], pd, k, O, size)
        shots.append((f"{variant} · setup", r))
        if variant == "visible" and any(q["slot"].startswith("prop_") for q in posed["setup"]["quads"]):
            r = draw_rig(posed["poses"]["frame"], pd, k, O, size, props=False)
            shots.append(("visible · frame, props hidden", r))
    bones = posed["poses"]["frame"]["bones"]

    def px(b):
        return np.array([bones[b]["x"] / k + O[0], -bones[b]["y"] / k + O[1]])

    err = {}
    for s in "lr":
        err[f"shoulder_{s}"] = np.linalg.norm(px(f"upper_arm_{s}") - j[f"shoulder_{s}"])
        err[f"elbow_{s}"] = np.linalg.norm(px(f"lower_arm_{s}") - j[f"elbow_{s}"])
        err[f"wrist_{s}"] = np.linalg.norm(px(f"hand_{s}") - wrist(j, s))
    F = j["face"]
    err["eyes_middle"] = np.linalg.norm((px("eye_l") + px("eye_r")) / 2 - (F[33] + F[263]) / 2)
    err["eye_l"] = np.linalg.norm(px("eye_l") - F[33])
    err["eye_r"] = np.linalg.norm(px("eye_r") - F[263])
    res["joint_error_px"] = {k_: round(float(v), 2) for k_, v in err.items()}
    save_report(out, "compose", res)
    print(json.dumps(res, indent=1))
    contact(rgba, shots, j, out / "rig-overlay.png", k, O, bones)


def contact(frame, shots, j, path: Path, k, O, bones) -> None:
    grey = np.zeros_like(frame) + np.array([60, 60, 60, 255], np.float32)

    def over(img):
        al = img[..., 3:4] / 255.0
        return (img[..., :3] * al + grey[..., :3] * (1 - al)).astype(np.uint8)

    cells = [("the frame", over(frame))]
    for title, img in shots:
        cells.append((title, over(img)))
    # The posed rig's joints (engine-rig) on the frame's joints (MediaPipe).
    pr = Image.fromarray(over(frame))
    d = ImageDraw.Draw(pr)
    draw_skeleton(d, j, colour=(255, 255, 0))
    for b in bones:
        if b.split("_")[0] in (
            "upper",
            "lower",
            "hand",
            "head",
            "neck",
            "chest",
            "eye",
            "clavicle",
        ):
            x, y = bones[b]["x"] / k + O[0], -bones[b]["y"] / k + O[1]
            d.ellipse([x - 3, y - 3, x + 3, y + 3], outline=(255, 0, 255), width=2)
    cells.insert(1, ("engine-rig joints (magenta) on MediaPipe (yellow)", np.array(pr)))
    tw = 360
    cols = 3
    rows = (len(cells) + cols - 1) // cols
    sheet = Image.new("RGB", (tw * cols, (tw + 20) * rows), (20, 20, 20))
    for i, (title, img) in enumerate(cells):
        im = Image.fromarray(img).resize((tw, tw))
        x, y = (i % cols) * tw, (i // cols) * (tw + 20)
        sheet.paste(im, (x, y + 20))
        ImageDraw.Draw(sheet).text((x + 4, y + 4), title, fill=(255, 255, 255))
    sheet.save(path)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd")
    ap.add_argument("--frame")
    ap.add_argument("--track")
    ap.add_argument("--geometry")
    ap.add_argument("--out", required=True)
    ap.add_argument("--models", default="tiny,small")
    ap.add_argument("--posed")
    ap.add_argument("--segmenter", help="selfie_multiclass_256x256.tflite (MediaPipe)")
    ap.add_argument("--min-prop", dest="min_prop", type=int, default=60)
    args = ap.parse_args()
    {
        "pick": cmd_pick,
        "segment": cmd_segment,
        "holes": cmd_holes,
        "parts": cmd_parts,
        "compose": cmd_compose,
        "props": cmd_props,
    }[args.cmd](args)
