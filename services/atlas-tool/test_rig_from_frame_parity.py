"""The frame-to-rig cut's SAM 2.1 on onnxruntime against SAM 2.1 through transformers on torch.

# check: requires transformers — the torch reference (SAM 2.1 small, as the proof ran it)
# check: requires mediapipe — MediaPipe's own segmenter, the props step's reference

Run:  RIG_FROM_FRAME_MODELS=<folder> py test_rig_from_frame_parity.py   (from services/atlas-tool)

`<folder>` holds the three pinned models (`tools/frame-to-rig/export_models.py sam` and
`segmenter`, or R2 `_shared/models/rig-from-frame/<sha12>/`) and MediaPipe's
`selfie_multiclass_256x256.tflite`; unset, they are read from the staging cache, as the service
reads them. CI has neither transformers nor the models, so it lists this as
skipped; run it in the venv the export uses whenever the export, the pins or `Sam` change.

On the fixture (`fixtures/rig_from_frame/`, a drawn character with fixed joints): every prompt's
mask from the job's `Sam` (the shipped graphs, Pillow resize, scaled prompts, bilinear logits) is
checked against `Sam2Processor` + `Sam2Model` live — IoU ≥ 0.95 per prompt (the design's gate) and
logits within 0.05 — and against the committed torch reference, so the fixture stays torch's
truth; the job's partition of the ONNX masks gives every part IoU ≥ 0.95 against torch's. The
segmenter's accessories confidence (the ONNX graph, the resize, the scaling, the softmax) is checked
against MediaPipe's ImageSegmenter on the same frame, everywhere within 0.001.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

import rig_from_frame as R

FAILED: list[str] = []
FIX = Path(__file__).resolve().parent / "fixtures" / "rig_from_frame"
IOU_MIN = 0.95
LOGIT_TOL = 0.05


def check(label: str, cond: bool, detail: str = "") -> None:
    print(f"{'ok  ' if cond else 'FAIL'} {label}{'' if cond else '  ' + detail}")
    if not cond:
        FAILED.append(label)


def iou(a: np.ndarray, b: np.ndarray) -> float:
    u = (a | b).sum()
    return float((a & b).sum() / u) if u else 1.0


rgba = np.array(Image.open(FIX / "frame.png").convert("RGBA"))
H, W = rgba.shape[:2]
rgb = R.composite_grey(rgba)
vis = rgba[..., 3] > 127
prm = json.loads((FIX / "prompts.json").read_text(encoding="utf8"))
ref = json.loads((FIX / "reference.json").read_text(encoding="utf8"))
bits = np.array(Image.open(FIX / "reference.png")).astype(np.int64)
track = json.loads((FIX / "track.json").read_text(encoding="utf8"))
slots = json.loads((FIX / "slots.json").read_text(encoding="utf8"))

try:
    sam = R.default_sam()
except RuntimeError as e:
    print(f"FAIL the pinned models are not here: {e}\n"
          "Set RIG_FROM_FRAME_MODELS to a folder holding them (tools/frame-to-rig/export_models.py).")
    sys.exit(1)
t0 = time.perf_counter()
emb = sam.embed(rgb)
onnx_l = [sam.logits(emb, p["pos"], p["neg"], p["box"]) for p in prm]
t_onnx = time.perf_counter() - t0

import torch  # noqa: E402  (after onnxruntime and MediaPipe-free work: the order the proof found safe)
from transformers import Sam2Model, Sam2Processor  # noqa: E402

proc = Sam2Processor.from_pretrained("facebook/sam2.1-hiera-small")
model = Sam2Model.from_pretrained("facebook/sam2.1-hiera-small").eval()
im = Image.fromarray(rgb)
t0 = time.perf_counter()
with torch.no_grad():
    temb = model.get_image_embeddings(proc(images=im, return_tensors="pt")["pixel_values"])
torch_l = []
for p in prm:
    pts = [[float(a), float(b)] for a, b in [*p["pos"], *p["neg"]]]
    labels = [1] * len(p["pos"]) + [0] * len(p["neg"])
    q = proc(images=im, input_points=[[pts]], input_labels=[[labels]], input_boxes=[[p["box"]]],
             return_tensors="pt")
    with torch.no_grad():
        o = model(image_embeddings=temb, input_points=q["input_points"], input_labels=q["input_labels"],
                  input_boxes=q["input_boxes"], multimask_output=False)
    torch_l.append(proc.post_process_masks(o.pred_masks.cpu(), q["original_sizes"], binarize=False)[0][0, 0]
                   .numpy().astype(np.float32))
t_torch = time.perf_counter() - t0
print(f"onnx {t_onnx:.1f} s, torch {t_torch:.1f} s for the picture and {len(prm)} prompts")

rows = {}
for k, p in enumerate(prm):
    a, b = onnx_l[k] > 0, torch_l[k] > 0
    stored = ((bits >> k) & 1).astype(bool)
    rows[p["name"]] = (iou(a, b), float(np.abs(onnx_l[k] - torch_l[k]).max()), iou(b, stored))
    check(f"{p['name']}: ONNX mask against torch's, IoU ≥ {IOU_MIN}", rows[p["name"]][0] >= IOU_MIN,
          f"{rows[p['name']][0]:.4f}")
    check(f"{p['name']}: logits within {LOGIT_TOL}", rows[p["name"]][1] <= LOGIT_TOL, f"{rows[p['name']][1]:.4f}")
    check(f"{p['name']}: the committed reference is still torch's", rows[p["name"]][2] >= 0.99,
          f"{rows[p['name']][2]:.4f} — remake the fixture (tools/frame-to-rig/make_fixture.py)")

j = R.joints_of(track, W, H)
parts = list(ref["names"])
geo = R.geometry_logits(j, (H, W), parts)
by = {p["name"]: k for k, p in enumerate(prm)}
mo, _ = R.partition({n: onnx_l[by[n]] for n in parts}, rgba[..., 3], parts, fallback=geo)
mt, _ = R.partition({n: torch_l[by[n]] for n in parts}, rgba[..., 3], parts, fallback=geo)
for n in parts:
    check(f"{n}: the cut from ONNX against the cut from torch, IoU ≥ {IOU_MIN}", iou(mo[n], mt[n]) >= IOU_MIN,
          f"{iou(mo[n], mt[n]):.4f}")
print(json.dumps({n: {"iou": round(r[0], 4), "max_logit_diff": round(r[1], 5)} for n, r in rows.items()},
                 indent=1))

import mediapipe as mp  # noqa: E402
from mediapipe.tasks.python import BaseOptions, vision  # noqa: E402

src = R.models_dir() / "selfie_multiclass_256x256.tflite"
if not src.is_file():
    check("MediaPipe's segmenter is beside the models (selfie_multiclass_256x256.tflite)", False, str(src))
else:
    seg = vision.ImageSegmenter.create_from_options(vision.ImageSegmenterOptions(
        base_options=BaseOptions(model_asset_path=str(src)), running_mode=vision.RunningMode.IMAGE,
        output_confidence_masks=True))
    res = seg.segment(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb)))
    want = res.confidence_masks[R.ACCESSORY].numpy_view().squeeze().copy()
    got = R.accessories(rgb, R.session("segmenter"))
    a, b = got > R.ACCESSORY_THRESHOLD, want > R.ACCESSORY_THRESHOLD
    # A drawn frame has little the segmenter (trained on photos) calls an accessory, so the whole
    # confidence map is compared: the resize, the scaling and the softmax all show in it.
    check("the accessories confidence against MediaPipe's, everywhere within 0.001",
          float(np.abs(got - want).max()) <= 0.001, f"{float(np.abs(got - want).max()):.5f}")
    check(f"the accessories found against MediaPipe's, IoU ≥ {IOU_MIN}", iou(a & vis, b & vis) >= IOU_MIN,
          f"{iou(a & vis, b & vis):.4f}")

if FAILED:
    print(f"\n{len(FAILED)} failed")
    sys.exit(1)
print("\nall passed")
