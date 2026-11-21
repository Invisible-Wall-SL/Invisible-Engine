"""Track a still with MediaPipe's Python Tasks API and the Rigger's own models
(apps/launcher-api/static/rigger/vendor/mediapipe/*.task), written in the shape 🎥 Motion's
`track()` gives one frame (pose: [x, y, visibility] + world, hands: label + landmarks + world,
face: landmarks), normalised to the image. For a still the page never tracked — a re-posed edit —
and to check the page's track of a frame against this one.

    python track.py --image still.png --out track.json [--bg 255]

`--bg` keys a flat background colour to alpha (the edit models answer on white).
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks.python import BaseOptions, vision
from PIL import Image

MODELS = Path(__file__).resolve().parents[2] / "apps/launcher-api/static/rigger/vendor/mediapipe"


def key_background(rgb: np.ndarray, value: int, tol: int = 18) -> np.ndarray:
    """Alpha for a still on a flat background: the background reached from the border."""
    near = (np.abs(rgb.astype(np.int16) - value).max(axis=2) <= tol).astype(np.uint8)
    n, lab = cv2.connectedComponents(near, connectivity=4)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(border)) & (near > 0)
    alpha = np.where(bg, 0, 255).astype(np.uint8)
    return cv2.morphologyEx(alpha, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))


def track(rgb: np.ndarray) -> dict:
    img = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
    opts = dict(running_mode=vision.RunningMode.IMAGE)
    pose = vision.PoseLandmarker.create_from_options(
        vision.PoseLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(MODELS / "pose_landmarker_full.task")),
            **opts,
        )
    )
    hands = vision.HandLandmarker.create_from_options(
        vision.HandLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(MODELS / "hand_landmarker.task")),
            num_hands=2,
            **opts,
        )
    )
    face = vision.FaceLandmarker.create_from_options(
        vision.FaceLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(MODELS / "face_landmarker.task")), **opts
        )
    )
    frame: dict = {"t": 0}
    p = pose.detect(img)
    if p.pose_landmarks:
        frame["pose"] = {
            "landmarks": [
                [q.x, q.y, q.visibility if q.visibility is not None else 1]
                for q in p.pose_landmarks[0]
            ],
            "world": [[q.x, q.y, q.z] for q in p.pose_world_landmarks[0]],
        }
    h = hands.detect(img)
    frame["hands"] = [
        {
            "label": h.handedness[i][0].category_name,
            "landmarks": [[q.x, q.y] for q in h.hand_landmarks[i]],
            "world": [[q.x, q.y, q.z] for q in h.hand_world_landmarks[i]],
        }
        for i in range(len(h.hand_landmarks))
    ]
    f = face.detect(img)
    if f.face_landmarks:
        frame["face"] = {"landmarks": [[q.x, q.y] for q in f.face_landmarks[0]]}
    return frame


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--bg", type=int)
    ap.add_argument("--rgba-out")
    a = ap.parse_args()
    im = Image.open(a.image)
    if a.bg is not None:
        rgb = np.array(im.convert("RGB"))
        alpha = key_background(rgb, a.bg)
        rgba = np.dstack([rgb, alpha])
        if a.rgba_out:
            Image.fromarray(rgba).save(a.rgba_out)
    else:
        rgba = np.array(im.convert("RGBA"))
        al = rgba[..., 3:4] / 255.0
        rgb = (rgba[..., :3] * al + 128 * (1 - al)).astype(np.uint8)
    fr = track(rgb)
    Path(a.out).write_text(json.dumps(fr), encoding="utf8")
    print("pose", "pose" in fr, "hands", len(fr["hands"]), "face", "face" in fr)
