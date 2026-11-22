"""The gate fixture of the frame-to-rig cut (services/atlas-tool/fixtures/rig_from_frame/).

A half-body character drawn here, so the frame carries no licence question: a shirt, a sleeved
arm hanging on the picture's left and a bare arm folded back across the body on its right (its
hand over the torso), a face with glasses, an earring, a chain with a pendant, a watch and a
hair cap. Its joints are the drawing's own construction points in 🎥 Motion's track shape, so
they are fixed; its reference is SAM 2.1 small through transformers on torch, the proof's path.

    python make_fixture.py --out services/atlas-tool/fixtures/rig_from_frame [--geometry g.json]

Writes `frame.png`, `track.json`, `slots.json` (the Half body template's slot names in draw
order), `prompts.json` (each SAM prompt: the parts' from the job's `prompts()`, and three prop
prompts as the props step makes them), `reference.png` (16-bit: bit k = torch's mask for prompt k,
logit > 0), `labels.png` + `reference.json` (the job's partition of torch's masks) and
`accessories.png` (the drawn props and the hair cap: what a perfect segmenter would answer).
Needs numpy, opencv-python-headless, pillow, torch, transformers.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from itertools import pairwise
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "atlas-tool"))
import rig_from_frame as R

W = H = 512
LINE = (30, 24, 28, 255)
SKIN = (226, 170, 132, 255)
SHIRT = (52, 96, 178, 255)
SLEEVE = (168, 44, 52, 255)
HAIR = (70, 40, 26, 255)
GOLD = (236, 196, 64, 255)
LENS = (24, 30, 40, 255)
WATCH = (40, 40, 44, 255)

FACE_C, FACE_R = (256.0, 122.0), (50.0, 62.0)
SH = {"l": (172.0, 222.0), "r": (340.0, 222.0)}
EL = {"l": (132.0, 326.0), "r": (414.0, 304.0)}
WR = {"l": (118.0, 424.0), "r": (334.0, 352.0)}
HIP = {"l": (198.0, 500.0), "r": (314.0, 500.0)}
EARS = {"l": (204.0, 128.0), "r": (308.0, 128.0)}  # the picture's left / right


def capsule(d: ImageDraw.ImageDraw, a, b, r: float, fill) -> None:
    d.line([a, b], fill=LINE, width=int(2 * r + 4))
    for p in (a, b):
        d.ellipse([p[0] - r - 2, p[1] - r - 2, p[0] + r + 2, p[1] + r + 2], fill=LINE)
    d.line([a, b], fill=fill, width=int(2 * r))
    for p in (a, b):
        d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=fill)


def hand_points(wrist, toward, size: float, thumb_side: float) -> np.ndarray:
    """21 MediaPipe hand points: the wrist, then thumb, index, middle, ring and pinky, each from
    its knuckle out, laid along `toward` with the thumb on `thumb_side` (+1 / −1)."""
    w = np.array(wrist)
    d = np.array(toward) / np.linalg.norm(toward)
    p = np.array([-d[1], d[0]]) * thumb_side
    pts = [w]
    base = w + p * 0.32 * size + d * 0.18 * size
    for k in range(4):
        pts.append(base + (p * 0.55 + d * 0.8) * 0.22 * size * (k + 1) / 1.2)
    for spread in (0.27, 0.09, -0.09, -0.27):
        knuckle = w + d * 0.62 * size + p * spread * size
        for k in range(4):
            pts.append(knuckle + d * 0.17 * size * k + p * spread * 0.15 * size * k)
    return np.array(pts)


def draw_hand(d: ImageDraw.ImageDraw, pts: np.ndarray, r: float) -> None:
    palm = [tuple(pts[i]) for i in (0, 1, 5, 9, 13, 17)]
    d.polygon(palm, fill=SKIN, outline=LINE)
    for f in R.FINGERS:
        chain = [pts[0 if f[0] == 1 else f[0]], *(pts[i] for i in f)]
        for a, b in pairwise(chain):
            capsule(d, tuple(a), tuple(b), r, SKIN)
    d.polygon(palm, fill=SKIN)


def face_points() -> np.ndarray:
    """478 points over the face's oval, the ones the cut reads placed on the drawn features."""
    cx, cy = FACE_C
    rx, ry = FACE_R
    pts = []
    rings = [(1.0, 120), (0.8, 110), (0.6, 100), (0.4, 80), (0.2, 50), (0.0, 18)]
    for k, n in rings:
        for i in range(n):
            a = 2 * math.pi * i / n
            pts.append((cx + max(k, 0.05) * rx * math.cos(a), cy + max(k, 0.05) * ry * math.sin(a)))
    pts = np.array(pts[:478])
    eyes = {"r": (234.0, 112.0), "l": (278.0, 112.0)}  # the performer's right eye is on the left
    marks = {
        1: (256, 134), 168: (256, 104), 10: (256, 92), 152: (256, 182),
        33: (eyes["r"][0] - 12, eyes["r"][1]), 133: (eyes["r"][0] + 10, eyes["r"][1]),
        159: (eyes["r"][0], eyes["r"][1] - 6), 145: (eyes["r"][0], eyes["r"][1] + 6),
        263: (eyes["l"][0] + 12, eyes["l"][1]), 362: (eyes["l"][0] - 10, eyes["l"][1]),
        386: (eyes["l"][0], eyes["l"][1] - 6), 374: (eyes["l"][0], eyes["l"][1] + 6),
        61: (240, 156), 291: (272, 156),
    }
    for i, p in marks.items():
        pts[i] = p
    return pts


def draw() -> tuple[Image.Image, dict, dict]:
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    hands = {
        "l": hand_points(WR["l"], np.subtract(WR["l"], EL["l"]), 62, -1),
        "r": hand_points(WR["r"], np.subtract(WR["r"], EL["r"]), 60, 1),
    }
    # The arm behind: picture-left, sleeved, hanging.
    capsule(d, SH["l"], EL["l"], 25, SLEEVE)
    capsule(d, EL["l"], WR["l"], 19, SKIN)
    draw_hand(d, hands["l"], 7)
    # Torso and neck.
    body = [(SH["l"][0] - 6, SH["l"][1] - 10), (SH["r"][0] + 6, SH["r"][1] - 10),
            (HIP["r"][0] + 10, H), (HIP["l"][0] - 10, H)]
    d.polygon(body, fill=SHIRT, outline=LINE)
    for k in range(4):  # folds
        y = 300 + 45 * k
        d.line([(214 + 6 * k, y), (300 - 4 * k, y + 14)], fill=(40, 78, 150, 255), width=3)
    d.rectangle([236, 172, 276, 214], fill=SKIN, outline=LINE, width=2)
    d.polygon([(214, 212), (298, 212), (256, 262)], fill=(36, 70, 140, 255), outline=LINE)
    # Head: face, ears, hair cap, eyes behind glasses, nose, mouth.
    for x, y in EARS.values():
        d.ellipse([x - 9, y - 15, x + 9, y + 15], fill=SKIN, outline=LINE, width=2)
    cx, cy = FACE_C
    rx, ry = FACE_R
    d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=SKIN, outline=LINE, width=3)
    d.chord([cx - rx - 4, cy - ry - 14, cx + rx + 4, cy + 10], 180, 360, fill=HAIR, outline=LINE, width=3)
    d.line([(250, 120), (246, 136), (258, 138)], fill=LINE, width=2)
    d.arc([238, 146, 274, 166], 20, 160, fill=LINE, width=3)
    props = {}
    pd = {}

    def prop(name):
        m = Image.new("L", (W, H), 0)
        pd[name] = ImageDraw.Draw(m)
        props[name] = m
        return pd[name]

    g = prop("glasses")
    for ex in (234, 278):
        for dd, col in ((d, LENS), (g, 255)):
            dd.rounded_rectangle([ex - 19, 101, ex + 19, 123], radius=7, fill=col)
    for dd, col in ((d, LENS), (g, 255)):
        dd.line([(253, 110), (259, 110)], fill=col, width=4)
        dd.line([(215, 108), (206, 116)], fill=col, width=3)
        dd.line([(297, 108), (306, 116)], fill=col, width=3)
    e = prop("earring")
    for dd, col in ((d, GOLD), (e, 255)):
        dd.ellipse([196, 142, 210, 156], fill=col)
    c = prop("chain")
    for dd, col in ((d, GOLD), (c, 255)):
        dd.arc([222, 168, 290, 252], 10, 170, fill=col, width=4)
        dd.ellipse([248, 246, 264, 264], fill=col)
    # The arm in front: picture-right, bare, folded back across the body; its watch and hand.
    capsule(d, SH["r"], EL["r"], 23, SKIN)
    capsule(d, EL["r"], WR["r"], 18, SKIN)
    wv = np.subtract(EL["r"], WR["r"])
    wv = wv / np.linalg.norm(wv)
    band = [tuple(np.array(WR["r"]) + wv * 14 + q) for q in (np.array([-wv[1], wv[0]]) * 20,
                                                             np.array([wv[1], -wv[0]]) * 20)]
    x = prop("watch")
    for dd, col in ((d, WATCH), (x, 255)):
        dd.line(band, fill=col, width=12)
    draw_hand(d, hands["r"], 7)
    hair = Image.new("L", (W, H), 0)
    ImageDraw.Draw(hair).chord([cx - rx - 4, cy - ry - 14, cx + rx + 4, cy + 10], 180, 360, fill=255)
    props["hair"] = hair
    return img, hands, props


def track(hands: dict) -> dict:
    pose = [[FACE_C[0] / W, FACE_C[1] / H, 0.99] for _ in range(33)]
    put = {0: (256, 134), 7: EARS["r"], 8: EARS["l"], 11: SH["r"], 12: SH["l"], 13: EL["r"],
           14: EL["l"], 15: WR["r"], 16: WR["l"], 23: HIP["r"], 24: HIP["l"],
           25: (HIP["r"][0], 640), 26: (HIP["l"][0], 640)}
    for i, (x, y) in put.items():
        pose[i] = [x / W, y / H, 0.99 if y <= H else 0.3]
    return {
        "t": 0,
        "pose": {"landmarks": pose},
        "hands": [{"label": "Left" if s == "l" else "Right",
                   "landmarks": [[float(x) / W, float(y) / H] for x, y in hands[s]]} for s in "rl"],
        "face": {"landmarks": [[float(x) / W, float(y) / H] for x, y in face_points()], "blend": {}},
    }


def prop_prompts(props: dict) -> list:
    """The props step's prompts for three drawn props, made the way `find_props` makes them."""
    import cv2

    out = []
    for name in ("glasses", "chain", "watch"):
        comp = np.array(props[name]) > 0
        ys, xs = np.nonzero(comp)
        x, y, bw, bh = int(xs.min()), int(ys.min()), int(np.ptp(xs) + 1), int(np.ptp(ys) + 1)
        down = 0.8 * bh if name == "chain" else 0.15 * bh
        box = [max(0.0, x - 0.15 * bw), max(0.0, y - 0.15 * bh),
               min(W - 1.0, x + 1.15 * bw), min(H - 1.0, y + bh + down)]
        dist = cv2.distanceTransform(comp.astype(np.uint8), cv2.DIST_L2, 3)
        order = np.argsort(dist.ravel(), kind="stable")[::-1][:400]
        pts = [[float(k % W), float(k // W)] for k in order[:: max(1, len(order) // 5)]][:5]
        out.append({"name": f"prop:{name}", "pos": pts, "neg": [], "box": box})
    return out


def torch_masks(rgb: np.ndarray, prm: list) -> np.ndarray:
    import torch
    from transformers import Sam2Model, Sam2Processor

    proc = Sam2Processor.from_pretrained(R_SAM_ID)
    model = Sam2Model.from_pretrained(R_SAM_ID).eval()
    im = Image.fromarray(rgb)
    inputs = proc(images=im, return_tensors="pt")
    with torch.no_grad():
        emb = model.get_image_embeddings(inputs["pixel_values"])
    out = []
    for p in prm:
        pts = [[float(a), float(b)] for a, b in [*p["pos"], *p["neg"]]]
        labels = [1] * len(p["pos"]) + [0] * len(p["neg"])
        q = proc(images=im, input_points=[[pts]], input_labels=[[labels]], input_boxes=[[p["box"]]],
                 return_tensors="pt")
        with torch.no_grad():
            o = model(image_embeddings=emb, input_points=q["input_points"],
                      input_labels=q["input_labels"], input_boxes=q["input_boxes"],
                      multimask_output=False)
        m = proc.post_process_masks(o.pred_masks.cpu(), q["original_sizes"], binarize=False)[0]
        out.append(m[0, 0].numpy().astype(np.float32))
    return np.stack(out)


R_SAM_ID = "facebook/sam2.1-hiera-small"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--geometry", help="rig-pose.mjs --geometry output (the Half body slots)")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    img, hands, props = draw()
    rgba = np.array(img)
    tr = track(hands)
    if a.geometry:
        slots = [s["name"] for s in json.loads(Path(a.geometry).read_text(encoding="utf8"))["slots"]]
    else:
        slots = json.loads((out / "slots.json").read_text(encoding="utf8"))
    rgb = R.composite_grey(rgba)
    j = R.joints_of(tr, W, H)
    parts = [p for p in R.CUT_PARTS if p in slots and p != "neck"]
    order = R.front_to_back(slots, parts)
    pp = R.prompts(j, (H, W), parts)
    prm = [{"name": n, "pos": [[float(v) for v in q] for q in pp[n][0]],
            "neg": [[float(v) for v in q] for q in pp[n][1]], "box": [float(v) for v in pp[n][2]]}
           for n in order] + prop_prompts(props)
    logits = torch_masks(rgb, prm)
    bits = np.zeros((H, W), np.uint16)
    for k in range(len(prm)):
        bits |= ((logits[k] > 0).astype(np.uint16) << k)
    geo = R.geometry_logits(j, (H, W), parts)
    masks, stats = R.partition({p["name"]: logits[k] for k, p in enumerate(prm) if p["name"] in pp},
                               rgba[..., 3], order, fallback={n: geo[n] for n in order})
    labels = np.full((H, W), R.BACKGROUND, np.uint8)
    for i, n in enumerate(masks):
        labels[masks[n]] = i
    acc = np.zeros((H, W), np.uint8)
    for m in props.values():
        acc |= np.array(m)
    img.save(out / "frame.png", optimize=True)
    Image.fromarray(bits.astype(np.uint16)).save(out / "reference.png")
    Image.fromarray(labels).save(out / "labels.png", optimize=True)
    Image.fromarray(acc).save(out / "accessories.png", optimize=True)
    (out / "track.json").write_text(json.dumps(tr), encoding="utf8")
    (out / "slots.json").write_text(json.dumps(slots), encoding="utf8")
    (out / "prompts.json").write_text(json.dumps(prm, indent=1), encoding="utf8")
    (out / "reference.json").write_text(json.dumps({
        "model": R_SAM_ID, "names": list(masks), "stats": stats,
        "px": {n: int(masks[n].sum()) for n in masks},
    }, indent=1), encoding="utf8")
    print(json.dumps({"names": list(masks), "stats": stats}, indent=1))


if __name__ == "__main__":
    main()
