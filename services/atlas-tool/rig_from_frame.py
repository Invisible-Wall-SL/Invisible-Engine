"""Frame to rig, the cut: one Flipbook frame into a rig template's parts and props (phase F1).

docs/design/frame-to-rig.md §4.3 and §4.3a. The Rigger has tracked the frame (🎥 Motion's
MediaPipe pass) and the author has picked it and moved any joint the tracker missed; this cuts it:

1. **SAM 2.1 hiera small**, prompted from the joints one part at a time (points along the part's
   bone, points on its neighbours as negatives, a box round its joints), through onnxruntime — the
   service has no torch. The graphs are exported by `tools/frame-to-rig/export_models.py`.
2. **One partition**: a pixel inside the character goes to the front-most part (the template's draw
   order) whose mask claims it; an unclaimed one to the part whose capsule (joints alone) claims it
   most; a stray island to the neighbour it touches most. Every pixel ends in exactly one part.
   The **neck** is not prompted (SAM took the chain for it): it is the head's and the torso's skin
   below the jaw, above the shoulders and within the neck's width, cut off them by geometry, so the
   head turns on its own bone and the neck on the neck bone.
3. **Props**: MediaPipe's multiclass selfie segmenter (its accessories class, run as ONNX) finds
   worn things, each named by where it sits on the joints, grown by SAM and cut out of the parts
   under it, to ride a bone of its own. One on top of the head (hair or a hat) is never taken.

Output, authoring scratch (never baked, rule 8), under `<client>/<project>/rig-from-frame/<job>/`:
`frame.png` (the frame at full size, with alpha), `track.json` (the joints as cut), `labels.png`
(8-bit, each pixel the index of its part or prop in `cut.json`'s `names`, 255 = not the character),
`overlay.png` and `cut.json`. Filling what each part hides and packing the sheet is
`rig_frame_parts.py` (F2b); the rig is the launcher's.

The models are not in the image (it stays lean): they are fetched once from R2
`_shared/models/rig-from-frame/<sha12>/` into the staging disk and refused unless their SHA-256 is
the one pinned in MODELS. `RIG_FROM_FRAME_MODELS` names a local folder holding them instead.
"""
from __future__ import annotations

import hashlib
import io
import json
import math
import os
import re
import threading
import time
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

MODEL_PREFIX = "_shared/models/rig-from-frame"
MODELS = {
    "encoder": ("sam2.1-hiera-small.encoder.onnx",
                "a6b59b874ffd6cfad1d3c9db86ecf2323c180f3ca0383749993594ec7cee1473", 138000438),  # pragma: allowlist secret (a SHA-256)
    "decoder": ("sam2.1-hiera-small.decoder.onnx",
                "86b3767f90bdd151de8d272436907e94390ca00cddb2fa6796077a37cde8ee17", 20742756),  # pragma: allowlist secret (a SHA-256)
    "segmenter": ("selfie-multiclass-256.onnx",
                  "2dab8dcf1affb01208d3b0143b2d42f64ce80f365a2113ece51ea3e772c23c8e", 16433759),  # pragma: allowlist secret (a SHA-256)
}
SAM_SIZE = 1024
MEAN = np.array([0.485, 0.456, 0.406], np.float32)
STD = np.array([0.229, 0.224, 0.225], np.float32)

# The template's `_l` is the PICTURE's left: the performer's right side (pose 12 / 14 / 16).
POSE = {
    "l": {"shoulder": 12, "elbow": 14, "wrist": 16, "hip": 24},
    "r": {"shoulder": 11, "elbow": 13, "wrist": 15, "hip": 23},
}
# What the cut makes. A template names these as slots; front to back comes from its draw order.
CUT_PARTS = ("torso", "neck", "head", "upper_arm_l", "lower_arm_l", "hand_l",
             "upper_arm_r", "lower_arm_r", "hand_r")
REQUIRED_PARTS = ("torso", "head", "upper_arm_l", "lower_arm_l", "upper_arm_r", "lower_arm_r")
FINGERS = [(1, 2, 3, 4), (5, 6, 7, 8), (9, 10, 11, 12), (13, 14, 15, 16), (17, 18, 19, 20)]
# The neck is cut by geometry, not prompted: on a frame its skin is a sliver under the chin, often
# under a collar or a chain (the proof's neck prompt took the chain). Its half width is NECK_WIDTH
# of the jaw's corners (172, 397) apart, or NECK_SHOULDERS of the shoulders' when the head is
# turned and the jaw drawn short; a smaller piece than MIN_NECK_PX is left in the head.
NECK_WIDTH = 0.42
NECK_SHOULDERS = 0.2
MIN_NECK_PX = 40
# MediaPipe's multiclass selfie segmenter: background, hair, body-skin, face-skin, clothes, others
# (accessories). Apache-2.0.
ACCESSORY = 5
SEGMENTER_SIZE = 256
ACCESSORY_THRESHOLD = 0.3
MIN_PROP_PX = 60
BACKGROUND = 255
# A frame this much opaque has its background painted in: every pixel would be cut into a part.
OPAQUE_SHARE = 0.98
MAX_SIDE = 4096
JOB = re.compile(r"^[a-z0-9][a-z0-9-]{5,63}$")
COLOURS = {
    "torso": (240, 200, 40), "neck": (255, 120, 0), "head": (40, 200, 255),
    "upper_arm_l": (60, 220, 60), "lower_arm_l": (30, 120, 255), "hand_l": (255, 60, 200),
    "upper_arm_r": (140, 255, 120), "lower_arm_r": (120, 170, 255), "hand_r": (255, 140, 230),
}
PROP_COLOUR = (255, 255, 255)


# --- models -----------------------------------------------------------------------------------


def models_dir() -> Path:
    env = os.environ.get("RIG_FROM_FRAME_MODELS")
    if env:
        return Path(env)
    return Path(os.environ.get("ATLAS_STAGING", "/tmp/atlas-tool")) / "_models" / "rig-from-frame"


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def model_file(kind: str, *, fetch=None) -> Path:
    """The local copy of one model, fetched from R2 the first time and checked against its pin."""
    name, sha, size = MODELS[kind]
    if not sha:
        raise RuntimeError(f"The {kind} model is not pinned yet (MODELS in rig_from_frame.py).")
    root = models_dir()
    local = root / name if os.environ.get("RIG_FROM_FRAME_MODELS") else root / sha[:12] / name
    if not (local.is_file() and local.stat().st_size == size):
        local.parent.mkdir(parents=True, exist_ok=True)
        key = f"{MODEL_PREFIX}/{sha[:12]}/{name}"
        if fetch is None:
            import storage

            if not storage.configured():
                raise RuntimeError(f"The {kind} model is not on this machine and R2 is not configured.")
            body = storage.get(key)
        else:
            body = fetch(key)
        if body is None:
            raise RuntimeError(f"The {kind} model is not on R2 ({key}).")
        tmp = local.with_suffix(".part")
        tmp.write_bytes(body)
        tmp.replace(local)
    got = sha256_file(local)
    if got != sha:
        local.unlink(missing_ok=True)
        raise RuntimeError(f"The {kind} model on disk is not the pinned one ({got[:12]} ≠ {sha[:12]}).")
    return local


_SESSIONS: dict[str, object] = {}
_SESSIONS_LOCK = threading.Lock()
# The sessions hold ~300 MB while loaded: dropped after this long with no cut, loaded again
# (~2.5 s) by the next one. A re-cut after a joint drag comes well inside it.
IDLE_RELEASE_S = 600
_IDLE: threading.Timer | None = None
# One cut at a time per process: each takes ~0.9 GB at its peak (the encoder at 1024²).
_RUN = threading.BoundedSemaphore(1)
RUN_WAIT_S = 90


def session(kind: str):
    """One onnxruntime session per model per process (a load reads ~175 MB; a cut takes seconds)."""
    with _SESSIONS_LOCK:
        if kind not in _SESSIONS:
            import onnxruntime as ort

            opts = ort.SessionOptions()
            # With its arena, onnxruntime peaks at ~1.8 GB and keeps ~1.7 GB after a cut; without,
            # ~0.9 GB and ~300 MB, at the same speed (measured on the cut of a 720² frame).
            opts.enable_cpu_mem_arena = False
            threads = int(os.environ.get("RIG_FROM_FRAME_THREADS") or 0)
            if threads > 0:
                opts.intra_op_num_threads = threads
            _SESSIONS[kind] = ort.InferenceSession(
                str(model_file(kind)), sess_options=opts, providers=["CPUExecutionProvider"])
        return _SESSIONS[kind]


def release_when_idle() -> None:
    """(Re)start the countdown that drops the sessions and the cached embedding."""
    global _IDLE

    def drop() -> None:
        with _SESSIONS_LOCK:
            _SESSIONS.clear()
            _EMBEDDING.clear()

    if _IDLE is not None:
        _IDLE.cancel()
    _IDLE = threading.Timer(IDLE_RELEASE_S, drop)
    _IDLE.daemon = True
    _IDLE.start()


_EMBEDDING: dict = {}


@dataclass
class Embedding:
    feat0: np.ndarray
    feat1: np.ndarray
    embed: np.ndarray
    size: tuple[int, int]


class Sam:
    """SAM 2.1 as `transformers`' Sam2Processor + Sam2Model call it, on onnxruntime: the picture
    resized to 1024² (Pillow bilinear, ImageNet-normalised), prompts scaled into it, one mask
    (`multimask_output=False`) whose 256² logits are resized back bilinearly."""

    def __init__(self, encoder, decoder):
        self.encoder, self.decoder = encoder, decoder

    def embed(self, rgb: np.ndarray) -> Embedding:
        """The picture's features; the last picture's are kept, so a re-cut of the same frame (a
        joint dragged) runs the prompts alone."""
        key = (id(self.encoder), rgb.shape, hashlib.sha1(rgb.tobytes()).hexdigest())
        if _EMBEDDING.get("key") == key:
            return _EMBEDDING["value"]
        h, w = rgb.shape[:2]
        x = np.asarray(Image.fromarray(rgb).resize((SAM_SIZE, SAM_SIZE), Image.BILINEAR), np.float32)
        x = ((x / 255.0 - MEAN) / STD).transpose(2, 0, 1)[None].astype(np.float32)
        f0, f1, emb = self.encoder.run(None, {"pixel_values": x})
        e = Embedding(f0, f1, emb, (h, w))
        _EMBEDDING.update(key=key, value=e)
        return e

    def logits(self, e: Embedding, pos, neg, box) -> np.ndarray:
        h, w = e.size
        k = np.array([SAM_SIZE / w, SAM_SIZE / h], np.float32)
        pts = np.array([[float(p[0]), float(p[1])] for p in [*pos, *neg]], np.float32) * k
        labels = np.array([1] * len(pos) + [0] * len(neg), np.int64)
        b = np.array(box, np.float32).reshape(2, 2) * k
        masks, _ = self.decoder.run(None, {
            "feat0": e.feat0, "feat1": e.feat1, "embed": e.embed,
            "points": pts[None, None], "labels": labels[None, None],
            "boxes": b.reshape(1, 1, 4),
        })
        return cv2.resize(masks[0, 0, 0].astype(np.float32), (w, h), interpolation=cv2.INTER_LINEAR)


def default_sam() -> Sam:
    return Sam(session("encoder"), session("decoder"))


def accessories(rgb: np.ndarray, seg) -> np.ndarray:
    """The segmenter's accessories confidence at the frame's size, as MediaPipe's ImageSegmenter
    makes it: the picture sampled onto 256² by an affine warp (no half-pixel shift, edges
    replicated), in [-1, 1]; the class logits soft-maxed, then resized up bilinearly."""
    h, w = rgb.shape[:2]
    m = np.array([[SEGMENTER_SIZE / w, 0, 0], [0, SEGMENTER_SIZE / h, 0]], np.float32)
    x = cv2.warpAffine(rgb.astype(np.float32), m, (SEGMENTER_SIZE, SEGMENTER_SIZE),
                       flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE) / 127.5 - 1
    (out,) = seg.run(None, {seg.get_inputs()[0].name: x[None].astype(np.float32)})
    z = out[0] - out[0].max(axis=-1, keepdims=True)
    p = np.exp(z) / np.exp(z).sum(axis=-1, keepdims=True)
    return cv2.resize(p[..., ACCESSORY].astype(np.float32), (w, h), interpolation=cv2.INTER_LINEAR)


# --- joints -----------------------------------------------------------------------------------


# How far outside the frame a tracked landmark may sit, in frame widths/heights: the tracker reports
# a joint past the edge a little, but one far past it would size every part's outline to it.
LANDMARK_REACH = (-1.0, 2.0)
# The pose landmarks the cut reads: face, arms, hands and hips (MediaPipe 0–24). The legs (25–32)
# are guessed far below a half-body picture on every frame, so they are neither read nor checked.
POSE_USED = 25


def _in_reach(*xy) -> bool:
    lo, hi = LANDMARK_REACH
    return all(isinstance(c, (int, float)) and math.isfinite(c) and lo <= c <= hi for c in xy)


def joints_of(frame: dict, w: int, h: int) -> dict:
    """The frame's joints in pixels, by template side, from one 🎥 Motion track frame."""
    pose = (frame.get("pose") or {}).get("landmarks") or []
    if len(pose) != 33 or any(p is None for p in pose):
        raise ValueError("The frame has no body tracked: pick another frame.")
    pose = pose[:POSE_USED]
    if not all(_in_reach(p[0], p[1]) for p in pose):
        raise ValueError("The frame's body is tracked far outside the picture: pick another frame.")
    P = [(float(x) * w, float(y) * h, float(v)) for x, y, v in pose]
    j: dict = {"pose": P}
    for s, ids in POSE.items():
        for name, i in ids.items():
            j[f"{name}_{s}"] = np.array(P[i][:2])
    hands = {}
    for hand in frame.get("hands") or []:
        lm = hand["landmarks"]
        if len(lm) != 21 or not all(_in_reach(x, y) for x, y in lm):
            continue
        pts = np.array([(float(x) * w, float(y) * h) for x, y in lm])
        # Each hand goes to the side of the nearer pose wrist (as rigMotionHand does).
        side = min("lr", key=lambda s: np.linalg.norm(pts[0] - j[f"wrist_{s}"]))
        if side not in hands:
            hands[side] = {"pts": pts}
    j["hands"] = hands
    face = (frame.get("face") or {}).get("landmarks") or []
    if len(face) < 468 or any(p is None for p in face):
        raise ValueError("The frame has no face tracked: pick another frame.")
    if not all(_in_reach(p[0], p[1]) for p in face):
        raise ValueError("The frame's face is tracked far outside the picture: pick another frame.")
    j["face"] = np.array([(float(p[0]) * w, float(p[1]) * h) for p in face])
    return j


def expand(pts, pad: float, w: int, h: int):
    x0, y0 = pts.min(axis=0) - pad
    x1, y1 = pts.max(axis=0) + pad
    return [max(0.0, float(x0)), max(0.0, float(y0)), min(w - 1.0, float(x1)), min(h - 1.0, float(y1))]


def wrist(j: dict, s: str):
    return j["hands"][s]["pts"][0] if s in j["hands"] else j[f"wrist_{s}"]


def prompts(j: dict, shape, parts) -> dict:
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
        S, E, Wr = j[f"shoulder_{s}"], j[f"elbow_{s}"], wrist(j, s)
        hc = hand_c.get(s, Wr)
        ua = [S + (E - S) * t for t in (0.3, 0.55, 0.8)]
        la = [E + (Wr - E) * t for t in (0.25, 0.5, 0.75)]
        out[f"upper_arm_{s}"] = (ua, [la[1], hc, torso_c], expand(np.array([S, E]), pad, w, h))
        out[f"lower_arm_{s}"] = (la, [ua[1], hc, torso_c], expand(np.array([E, Wr]), pad, w, h))
        if s in j["hands"]:
            pts = j["hands"][s]["pts"]
            pos = [hc, pts[6], pts[10], pts[14], pts[3]]
            out[f"hand_{s}"] = (pos, [la[1], torso_c], expand(pts, 0.1 * sh_w, w, h))
    out["head"] = (
        [F[1], F[168], F[10], head_top, F[152] + (F[1] - F[152]) * 0.2],
        [sh_mid + (hip_mid - sh_mid) * 0.15, *hand_c.values()],
        expand(np.vstack([F, head_top[None]]), 0.15 * sh_w, w, h),
    )
    out["torso"] = (
        [torso_c, sh_mid + (hip_mid - sh_mid) * 0.75, sh_mid + (hip_mid - sh_mid) * 0.2],
        [F[1], *hand_c.values(), *(j[f"elbow_{s}"] for s in "lr")],
        expand(np.array([j["shoulder_l"], j["shoulder_r"], j["hip_l"], j["hip_r"]]), 0.1 * sh_w, w, h),
    )
    return {k: v for k, v in out.items() if k in parts}


def geometry_logits(j: dict, shape, parts) -> dict:
    """A cut from the joints alone: each part a soft capsule (or the face's hull) round its points."""
    h, w = shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    sh_w = float(np.linalg.norm(j["shoulder_l"] - j["shoulder_r"]))
    out = {}

    def capsule(a, b, r):
        ab = b - a
        t = np.clip(((xx - a[0]) * ab[0] + (yy - a[1]) * ab[1]) / max(1e-6, float(ab @ ab)), 0, 1)
        d = np.hypot(xx - (a[0] + t * ab[0]), yy - (a[1] + t * ab[1]))
        return (r - d) / r

    for s in "lr":
        S, E, Wr = j[f"shoulder_{s}"], j[f"elbow_{s}"], wrist(j, s)
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
    hull = cv2.convexHull(j["face"].astype(np.float32)).reshape(-1, 2)
    face_mask = np.zeros((h, w), np.uint8)
    cv2.fillPoly(face_mask, [hull.astype(np.int32)], 1)
    dist = cv2.distanceTransform(1 - face_mask, cv2.DIST_L2, 5)
    out["head"] = (0.12 * sh_w - dist) / (0.12 * sh_w)
    poly = np.array([j["shoulder_l"], j["shoulder_r"], j["hip_r"], j["hip_l"]], np.float32)
    tm = np.zeros((h, w), np.uint8)
    cv2.fillPoly(tm, [poly.astype(np.int32)], 1)
    dist = cv2.distanceTransform(1 - tm, cv2.DIST_L2, 5)
    out["torso"] = (0.15 * sh_w - dist) / (0.15 * sh_w)
    return {k: v for k, v in out.items() if k in parts}


def partition(logits: dict, alpha: np.ndarray, order: list[str], fallback: dict | None = None):
    """Every visible pixel to exactly one part: the front-most (`order` is front to back) that
    claims it (logit > 0), else the part claiming it most (or the fallback's). Each part keeps its
    connected pieces that touch its biggest one; the rest go to the neighbour they touch most."""
    vis = alpha > 127
    names = [n for n in order if n in logits]
    label = np.full(alpha.shape, -1, np.int16)
    for i in range(len(names) - 1, -1, -1):
        label[(logits[names[i]] > 0) & vis] = i
    rest = vis & (label < 0)
    src = fallback if fallback is not None else logits
    label[rest] = np.argmax(np.stack([src[n] for n in names]), axis=0)[rest]
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
            ring = cv2.dilate(piece.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool) & ~piece
            nb = label[ring]
            nb = nb[(nb >= 0) & (nb != i)]
            if nb.size:
                label[piece] = np.bincount(nb).argmax()
                moved += int(piece.sum())
    stats["reassigned_px"] = moved
    return {n: label == i for i, n in enumerate(names)}, stats


def neck_axis(j: dict) -> tuple[np.ndarray, np.ndarray, float]:
    """The neck's axis, from the jaw's middle (its corners and the chin) down to the shoulders'
    middle, and its half width."""
    F = j["face"]
    top = (F[172] + F[397] + F[152]) / 3
    base = (j["shoulder_l"] + j["shoulder_r"]) / 2
    sh_w = float(np.linalg.norm(j["shoulder_l"] - j["shoulder_r"]))
    return top, base, max(NECK_WIDTH * float(np.linalg.norm(F[172] - F[397])), NECK_SHOULDERS * sh_w)


def split_neck(masks: dict, j: dict) -> np.ndarray:
    """The neck's visible pixels, taken from the head and the torso: below the jaw's lower edge (out
    of the face's hull, which the jaw closes), down to the shoulder line, within the neck's width of
    its axis. Its biggest piece only; none when smaller than MIN_NECK_PX."""
    shape = next(iter(masks.values())).shape
    F = j["face"]
    top, base, r = neck_axis(j)
    yy, xx = np.mgrid[0:shape[0], 0:shape[1]].astype(np.float32)
    ab = base - top
    L2 = max(1e-6, float(ab @ ab))
    t = ((xx - top[0]) * ab[0] + (yy - top[1]) * ab[1]) / L2
    d = np.abs((xx - top[0]) * ab[1] - (yy - top[1]) * ab[0]) / np.sqrt(L2)
    face = np.zeros(shape, np.uint8)
    cv2.fillPoly(face, [cv2.convexHull(F.astype(np.float32)).astype(np.int32)], 1)
    face = cv2.dilate(face, np.ones((3, 3), np.uint8)).astype(bool)
    near = (t >= -0.25) & (t <= 1.0) & (d <= r) & ~face
    m = near & (masks.get("head", False) | masks.get("torso", False))
    k, comp, st, _ = cv2.connectedComponentsWithStats(m.astype(np.uint8), connectivity=8)
    if k <= 1:
        return np.zeros(shape, bool)
    big = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
    out = comp == big
    return out if out.sum() >= MIN_NECK_PX else np.zeros(shape, bool)


# --- props ------------------------------------------------------------------------------------


def arm_tail(slots: list[str], s: str) -> str:
    """The last slot of side `s`'s arm (its last finger segment): a prop on it is drawn after it."""
    start = slots.index("hair_front") if "hair_front" in slots else 0
    side = [n for n in slots[start:] if n.endswith(f"_{s}")]
    return side[-1] if side else f"hand_{s}"


def classify(comp: np.ndarray, j: dict, slots: list[str]) -> dict | None:
    """What a found accessory is, from where it sits on the joints: its name, the bone it rides, the
    slot it is drawn before or after, the part it hides. None = not taken (the author places it)."""
    F = j["face"]
    sw = float(np.linalg.norm(j["shoulder_l"] - j["shoulder_r"]))
    ys, xs = np.nonzero(comp)
    c = np.array([xs.mean(), ys.mean()])

    def on(p, r=4):
        x, y = int(round(p[0])), int(round(p[1]))
        return comp[max(0, y - r): y + r + 1, max(0, x - r): x + r + 1].any()

    if any(on(F[i]) for i in (33, 133, 159, 145, 263, 362, 386, 374)):
        return {"name": "prop_glasses", "bone": "head", "before": "hair_front", "host": "head"}
    if ys.mean() < F[10][1] and comp.sum() > 2000:
        return None  # on top of the head: hair or a hat, which the author says
    for s in "lr":
        ear = np.array(j["pose"][7 if s == "r" else 8][:2])
        if np.linalg.norm(c - ear) < 0.2 * sw and comp.sum() < 1500:
            return {"name": f"prop_earring_{s}", "bone": "head", "before": "hair_front", "host": "head"}
    sm = (j["shoulder_l"] + j["shoulder_r"]) / 2
    chin = F[152]
    if chin[1] - 0.05 * sw < c[1] < sm[1] + 0.4 * sw and abs(c[0] - (chin[0] + sm[0]) / 2) < 0.5 * sw:
        return {"name": "prop_chain", "bone": "chest", "after": "neck", "host": "torso"}
    for s in "lr":
        if np.linalg.norm(c - wrist(j, s)) < 0.15 * sw:
            return {"name": f"prop_wrist_{s}", "bone": f"lower_arm_{s}", "after": arm_tail(slots, s),
                    "host": f"lower_arm_{s}"}
    for s, hd in j["hands"].items():
        if np.min(np.linalg.norm(hd["pts"] - c, axis=1)) < 0.06 * sw:
            return {"name": f"prop_ring_{s}", "bone": f"hand_{s}", "after": arm_tail(slots, s),
                    "host": f"hand_{s}"}
    return None


def find_props(acc: np.ndarray, alpha: np.ndarray, j: dict, slots: list[str], sam: Sam,
               emb: Embedding) -> tuple[dict, dict, list]:
    """Each accessory piece named and grown by SAM: a box round it (a chain's reaches down for its
    pendant) and points deep inside it; the prop is SAM's mask in the box plus the piece."""
    h, w = alpha.shape
    n, lab, st, _ = cv2.connectedComponentsWithStats(
        ((acc > ACCESSORY_THRESHOLD) & (alpha > 127)).astype(np.uint8), 8)
    props, meta, rejected = {}, {}, []
    for i in range(1, n):
        if st[i, cv2.CC_STAT_AREA] < MIN_PROP_PX:
            continue
        comp = lab == i
        kind = classify(comp, j, slots)
        x, y, bw, bh = (int(v) for v in st[i, :4])
        if kind is None:
            rejected.append({"box": [x, y, bw, bh], "px": int(comp.sum()),
                             "why": "on top of the head" if comp.nonzero()[0].mean() < j["face"][10][1]
                             else "not by a joint"})
            continue
        down = 0.8 * bh if kind["name"] == "prop_chain" else 0.15 * bh
        box = [max(0.0, x - 0.15 * bw), max(0.0, y - 0.15 * bh),
               min(w - 1.0, x + 1.15 * bw), min(h - 1.0, y + bh + down)]
        dist = cv2.distanceTransform(comp.astype(np.uint8), cv2.DIST_L2, 3)
        order = np.argsort(dist.ravel(), kind="stable")[::-1][:400]
        pts = [[float(k % w), float(k // w)] for k in order[:: max(1, len(order) // 5)]][:5]
        grown = sam.logits(emb, pts, [], box) > 0
        inbox = np.zeros_like(comp)
        inbox[int(box[1]): int(box[3]) + 1, int(box[0]): int(box[2]) + 1] = True
        m = ((grown & inbox) | comp) & (alpha > 127)
        name = kind["name"]
        props[name] = props.get(name, np.zeros_like(m)) | m
        meta[name] = {**kind, "segmenter_px": int(comp.sum()) + meta.get(name, {}).get("segmenter_px", 0)}
    return props, meta, rejected


# --- the cut ----------------------------------------------------------------------------------


def front_to_back(slots: list[str], parts: list[str]) -> list[str]:
    return [s for s in reversed(slots) if s in parts]


def composite_grey(rgba: np.ndarray) -> np.ndarray:
    """The frame on grey, as the page tracks it and SAM sees it."""
    a = rgba[..., 3:4] / 255.0
    return (rgba[..., :3] * a + 128 * (1 - a)).astype(np.uint8)


def cut(rgba: np.ndarray, frame: dict, slots: list[str], *, sam: Sam, seg=None) -> dict:
    """The parts and props of one frame. Returns the label map, the names it indexes and the report."""
    alpha = rgba[..., 3]
    if (alpha > 127).sum() < 500:
        raise ValueError("The frame is empty (no character on it).")
    if (alpha > 127).mean() > OPAQUE_SHARE:
        raise ValueError("The frame has no transparent background: the cut needs the character "
                         "drawn on transparency.")
    h, w = alpha.shape
    rgb = composite_grey(rgba)
    parts = [p for p in CUT_PARTS if p in slots]
    missing = [p for p in REQUIRED_PARTS if p not in parts]
    if missing:
        raise ValueError("This template has no " + ", ".join(missing) + ": the cut makes Half body parts.")
    j = joints_of(frame, w, h)
    order = front_to_back(slots, parts)
    t: dict = {}
    t0 = time.perf_counter()
    emb = sam.embed(rgb)
    t["embed_s"] = time.perf_counter() - t0
    t0 = time.perf_counter()
    prm = prompts(j, (h, w), parts)
    logits = {n: sam.logits(emb, *prm[n]) for n in order if n in prm}
    t["prompts_s"] = time.perf_counter() - t0
    geo = geometry_logits(j, (h, w), parts)
    geo = {n: geo[n] for n in logits}
    masks, stats = partition(logits, alpha, order, fallback=geo)
    props, meta, rejected = {}, {}, []
    if seg is not None:
        t0 = time.perf_counter()
        acc = accessories(rgb, seg)
        t["segmenter_s"] = time.perf_counter() - t0
        t0 = time.perf_counter()
        props, meta, rejected = find_props(acc, alpha, j, slots, sam, emb)
        t["props_s"] = time.perf_counter() - t0
    taken = np.zeros(alpha.shape, bool)
    taken_from = {}
    for name in props:
        props[name] &= ~taken
        taken |= props[name]
        taken_from[name] = {p: int((m & props[name]).sum()) for p, m in masks.items()
                            if (m & props[name]).any()}
    for part in masks:
        masks[part] &= ~taken
    if "neck" in parts:
        neck = split_neck(masks, j)
        if neck.any():
            for part in ("head", "torso"):
                if part in masks:
                    masks[part] &= ~neck
            masks["neck"] = neck
            masks = {n: masks[n] for n in order if n in masks}
    names = [*masks, *props]
    labels = np.full(alpha.shape, BACKGROUND, np.uint8)
    for i, n in enumerate(names):
        labels[masks[n] if n in masks else props[n]] = i
    report = {
        "parts": [{"name": n, "px": int(masks[n].sum())} for n in masks],
        "props": [{**meta[n], "px": int(props[n].sum()), "take": True, "motion": "rides",
                   "from": taken_from[n]} for n in props],
        "rejected": rejected,
        "not_cut": [p for p in parts if p not in masks],
        "stats": stats,
        "timings": {k: round(v, 2) for k, v in t.items()},
    }
    return {"labels": labels, "names": names, "report": report, "joints": j}


def overlay(rgb: np.ndarray, labels: np.ndarray, names: list[str], j: dict) -> Image.Image:
    base = (rgb.astype(np.float32) * 0.35).astype(np.uint8)
    out = base.copy()
    for i, n in enumerate(names):
        m = labels == i
        c = np.array(COLOURS.get(n, PROP_COLOUR), np.float32)
        out[m] = (0.45 * rgb[m] + 0.55 * c).astype(np.uint8)
        edge = m.astype(np.uint8) - cv2.erode(m.astype(np.uint8), np.ones((3, 3), np.uint8))
        out[edge.astype(bool)] = (255, 255, 255)
    im = Image.fromarray(out)
    d = ImageDraw.Draw(im)
    for s in "lr":
        pts = [tuple(j[f"shoulder_{s}"]), tuple(j[f"elbow_{s}"]), tuple(wrist(j, s))]
        d.line(pts, fill=(255, 255, 0), width=2)
        for p in pts:
            d.ellipse([p[0] - 4, p[1] - 4, p[0] + 4, p[1] + 4], outline=(255, 255, 0), width=2)
    return im


# --- the job ----------------------------------------------------------------------------------


def frame_from_page(page: Image.Image, region: dict, canvas: tuple[int, int]) -> np.ndarray:
    """A clip frame at its untrimmed size and place on the clip's canvas, as `clipFrames` draws it
    (rigger-motion: a region packed turned 90° clockwise holds an h × w box)."""
    x, y, w, h = (int(region[k]) for k in ("x", "y", "w", "h"))
    if region.get("rotated"):
        img = page.crop((x, y, x + h, y + w)).transpose(Image.Transpose.ROTATE_90)
    else:
        img = page.crop((x, y, x + w, y + h))
    out = Image.new("RGBA", canvas, (0, 0, 0, 0))
    out.paste(img.convert("RGBA"), (int(region.get("offX") or 0), int(region.get("offY") or 0)))
    return np.array(out)


def png(arr_or_im) -> bytes:
    im = arr_or_im if isinstance(arr_or_im, Image.Image) else Image.fromarray(arr_or_im)
    buf = io.BytesIO()
    im.save(buf, "PNG", optimize=True)
    return buf.getvalue()


def validate(payload: dict, project_prefix: str) -> dict:
    job = str(payload.get("job") or "")
    if not JOB.match(job):
        raise ValueError("Bad job id.")
    frame = payload.get("frame")
    if not isinstance(frame, dict):
        raise ValueError("No frame was named.")
    page_key = str(frame.get("pageKey") or "")
    if not page_key.startswith(project_prefix + "/") or ".." in page_key:
        raise ValueError("The frame's sheet is not in this project.")
    region = frame.get("region")
    if not isinstance(region, dict) or not all(
            isinstance(region.get(k), (int, float)) and region[k] >= 0 for k in ("x", "y", "w", "h")):
        raise ValueError("The frame's region is not readable.")
    canvas = frame.get("canvas")
    if (not isinstance(canvas, list) or len(canvas) != 2
            or not all(isinstance(v, int) and 0 < v <= MAX_SIDE for v in canvas)):
        raise ValueError("The frame's size is not readable.")
    track = payload.get("track")
    if not isinstance(track, dict):
        raise ValueError("No joints were sent.")
    template = payload.get("template")
    if not isinstance(template, dict) or not isinstance(template.get("slots"), list):
        raise ValueError("No template was named.")
    clip = payload.get("clip")
    if clip is not None and not (isinstance(clip, dict) and isinstance(clip.get("id"), str)
                                 and 0 < len(clip["id"]) <= 200 and isinstance(clip.get("frame"), int)
                                 and not isinstance(clip.get("frame"), bool) and clip["frame"] >= 0):
        raise ValueError("The clip frame is not readable.")
    return {"job": job, "pageKey": page_key, "region": region, "canvas": (canvas[0], canvas[1]),
            "track": track, "slots": [str(s) for s in template["slots"]],
            "templateId": str(template.get("id") or ""),
            "clip": {"id": clip["id"], "frame": clip["frame"]} if clip else None}


def run(payload: dict, *, project_prefix: str, get=None, put=None, sam: Sam | None = None,
        seg=None) -> dict:
    """`{job, frame: {pageKey, region, canvas}, track, template: {id, slots}}` → the cut, written to
    `<project>/rig-from-frame/<job>/`. ValueError for anything the author can fix."""
    v = validate(payload, project_prefix)
    if not _RUN.acquire(timeout=RUN_WAIT_S):
        raise ValueError("Another cut is running on the service; try again in a moment.")
    try:
        return _run(v, project_prefix, get, put, sam, seg)
    finally:
        _RUN.release()
        release_when_idle()


def _run(v: dict, project_prefix: str, get, put, sam: Sam | None, seg) -> dict:
    if get is None or put is None:
        import storage

        get = get or storage.get
        put = put or storage.put
    started = time.perf_counter()
    body = get(v["pageKey"])
    if body is None:
        raise ValueError("The frame's sheet image is gone.")
    page = Image.open(io.BytesIO(body))
    rgba = frame_from_page(page, v["region"], v["canvas"])
    if sam is None:
        sam = default_sam()
        seg = session("segmenter")
    res = cut(rgba, v["track"], v["slots"], sam=sam, seg=seg)
    root = f"{project_prefix}/rig-from-frame/{v['job']}"
    doc = {
        "version": 1,
        "job": v["job"],
        "template": v["templateId"],
        "size": [int(rgba.shape[1]), int(rgba.shape[0])],
        "source": {"pageKey": v["pageKey"], "region": v["region"], "canvas": list(v["canvas"])},
        **({"clip": v["clip"]} if v["clip"] else {}),
        "names": res["names"],
        "background": BACKGROUND,
        "neck": "neck" in res["names"],
        **res["report"],
    }
    rgb = composite_grey(rgba)
    put(f"{root}/frame.png", png(rgba), "image/png")
    put(f"{root}/track.json", json.dumps(v["track"]).encode(), "application/json")
    put(f"{root}/labels.png", png(res["labels"]), "image/png")
    put(f"{root}/overlay.png", png(overlay(rgb, res["labels"], res["names"], res["joints"])), "image/png")
    doc["timings"]["total_s"] = round(time.perf_counter() - started, 2)
    put(f"{root}/cut.json", json.dumps(doc, indent=1).encode(), "application/json")
    return {**doc, "root": root}
