"""Make the ONNX models atlas-tool's `rig-from-frame` cut runs (docs/design/frame-to-rig.md §5).

Dev-time only: needs torch (CPU) and transformers ≥ 4.56 for SAM 2.1, and TensorFlow + tf2onnx for
the segmenter (a venv of its own: they do not share well); atlas-tool itself runs the files with
onnxruntime and nothing else.

    python export_models.py sam --out models/                 # SAM 2.1 hiera small → encoder + decoder
    python export_models.py segmenter --tflite selfie_multiclass_256x256.tflite --out models/
    python export_models.py push --out models/                # to R2 _shared/models/ (needs R2 env)

`sam` writes two graphs from `facebook/sam2.1-hiera-small` (Apache-2.0) at a pinned revision:

- `sam2.1-hiera-small.encoder.onnx`: pixel_values [1,3,1024,1024] (ImageNet-normalised RGB) → the
  three feature maps the decoder reads (the no-memory embedding already added, as
  `Sam2Model.get_image_embeddings` does);
- `sam2.1-hiera-small.decoder.onnx`: those maps + points [1,1,N,2] and labels [1,1,N] (1 in, 0 out)
  and a box [1,1,4], all in the 1024 picture → one mask's logits [1,1,1,256,256] and its score,
  `multimask_output=False` with SAM 2.1's stability fallback, as `proof.py` calls it.

Each run prints the files' SHA-256 and size; `rig_from_frame.py` pins them (MODELS), so a file that
changes on R2 is refused, not run.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path

SAM_ID = "facebook/sam2.1-hiera-small"
# The revision the parity gate's reference was made with (test_rig_from_frame_parity.py).
SAM_REVISION = "main"
R2_PREFIX = "_shared/models/rig-from-frame"
# https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite
SEGMENTER_TFLITE_SHA256 = "c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0"  # pragma: allowlist secret (a SHA-256)


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def cmd_sam(a) -> None:
    import torch
    from transformers import Sam2Model

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    model = Sam2Model.from_pretrained(SAM_ID, revision=SAM_REVISION).eval()

    class Encoder(torch.nn.Module):
        def __init__(self, m):
            super().__init__()
            self.m = m

        def forward(self, pixel_values):
            e = self.m.get_image_embeddings(pixel_values)
            return e[0], e[1], e[2]

    class Decoder(torch.nn.Module):
        def __init__(self, m):
            super().__init__()
            self.m = m
            self.register_buffer("pe", m.get_image_wide_positional_embeddings())

        def forward(self, feat0, feat1, embed, points, labels, boxes):
            sparse, dense = self.m.prompt_encoder(
                input_points=points, input_labels=labels, input_boxes=boxes, input_masks=None
            )
            masks, iou, _, _ = self.m.mask_decoder(
                image_embeddings=embed,
                image_positional_embeddings=self.pe,
                sparse_prompt_embeddings=sparse,
                dense_prompt_embeddings=dense,
                multimask_output=False,
                high_resolution_features=[feat0, feat1],
            )
            return masks, iou

    enc, dec = Encoder(model).eval(), Decoder(model).eval()
    px = torch.zeros(1, 3, 1024, 1024)
    with torch.no_grad():
        f0, f1, emb = enc(px)
    pts = torch.tensor([[[[300.0, 400.0], [500.0, 600.0], [700.0, 200.0]]]])
    lab = torch.tensor([[[1, 1, 0]]], dtype=torch.int64)
    box = torch.tensor([[[100.0, 100.0, 800.0, 900.0]]])
    enc_path = out / "sam2.1-hiera-small.encoder.onnx"
    dec_path = out / "sam2.1-hiera-small.decoder.onnx"
    torch.onnx.export(
        enc, (px,), str(enc_path), input_names=["pixel_values"],
        output_names=["feat0", "feat1", "embed"], opset_version=17, dynamo=False,
    )
    torch.onnx.export(
        dec, (f0, f1, emb, pts, lab, box), str(dec_path),
        input_names=["feat0", "feat1", "embed", "points", "labels", "boxes"],
        output_names=["masks", "iou"],
        dynamic_axes={"points": {2: "n"}, "labels": {2: "n"}},
        opset_version=17, dynamo=False,
    )
    report(out, [enc_path, dec_path])


def cmd_segmenter(a) -> None:
    """MediaPipe's `selfie_multiclass_256x256` (float32, Apache-2.0; sha256 c6748b12…e0e0) through
    tf2onnx, which needs TensorFlow (`pip install tensorflow-cpu tf2onnx`). The graph keeps the
    TFLite model's NHWC input and answers class logits; `rig_from_frame.accessories` does the
    ImageSegmenter's own resize, [-1, 1] scaling and softmax.

    tf2onnx names the constants it makes with counters that differ from run to run, and lists them
    in no fixed order; renamed by first use in node order, the same model makes the same bytes."""
    import onnx
    from tf2onnx.convert import from_tflite

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    if sha256(Path(a.tflite)) != SEGMENTER_TFLITE_SHA256:
        raise SystemExit("that is not the pinned selfie_multiclass_256x256 float32 model")
    dst = out / "selfie-multiclass-256.onnx"
    from_tflite(str(a.tflite), opset=17, output_path=str(dst))
    m = onnx.load(str(dst))
    consts = {t.name: t for t in m.graph.initializer}
    rename: dict[str, str] = {}
    for node in m.graph.node:
        for k, name in enumerate(node.input):
            if name in consts:
                rename.setdefault(name, f"const_{len(rename)}")
                node.input[k] = rename[name]
    for old, new in rename.items():
        consts[old].name = new
    del m.graph.initializer[:]
    m.graph.initializer.extend(sorted(consts.values(), key=lambda t: int(t.name.split("_")[1])))
    for vi in m.graph.value_info:
        vi.name = rename.get(vi.name, vi.name)
    onnx.checker.check_model(m)
    onnx.save(m, str(dst))
    report(out, [dst])


def report(out: Path, paths: list[Path]) -> None:
    rows = {p.name: {"sha256": sha256(p), "bytes": p.stat().st_size} for p in paths}
    meta = out / "models.json"
    doc = json.loads(meta.read_text(encoding="utf8")) if meta.exists() else {}
    doc.update(rows)
    meta.write_text(json.dumps(doc, indent=1), encoding="utf8")
    print(json.dumps(rows, indent=1))


def cmd_push(a) -> None:
    import boto3

    out = Path(a.out)
    doc = json.loads((out / "models.json").read_text(encoding="utf8"))
    s3 = boto3.client(
        "s3",
        endpoint_url=os.environ["R2_ENDPOINT"],
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )
    bucket = os.environ["R2_BUCKET"]
    for name, row in doc.items():
        p = out / name
        if sha256(p) != row["sha256"]:
            raise SystemExit(f"{name} changed since it was made")
        key = f"{R2_PREFIX}/{row['sha256'][:12]}/{name}"
        s3.upload_file(str(p), bucket, key, ExtraArgs={"ContentType": "application/octet-stream"})
        print("pushed", key)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["sam", "segmenter", "push"])
    ap.add_argument("--out", required=True)
    ap.add_argument("--tflite")
    a = ap.parse_args()
    {"sam": cmd_sam, "segmenter": cmd_segmenter, "push": cmd_push}[a.cmd](a)
