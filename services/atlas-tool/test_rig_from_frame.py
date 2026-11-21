"""The frame-to-rig cut (`rig_from_frame.py`, phase F1) on its fixture, with SAM stood in.

Run:  py test_rig_from_frame.py   (from services/atlas-tool)

The fixture (`fixtures/rig_from_frame/`, made by `tools/frame-to-rig/make_fixture.py`) is a drawn
half-body character with fixed joints and torch SAM 2.1 small's mask for every prompt. Here SAM
answers those masks, so the job runs end to end without its models: the prompts are the ones the
reference was made with; the partition gives every visible pixel exactly one part, front to back,
the capsules taking what SAM left, the neck left off; the props are named by where they sit and the
hair cap on top of the head is not taken; a clip frame packed turned comes back upright; the job
refuses a sheet outside its project and a model that is not the pinned one, and writes its five
files under `rig-from-frame/<job>/`. ONNX against torch is `test_rig_from_frame_parity.py`.
"""
from __future__ import annotations

import io
import json
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

import rig_from_frame as R

FAILED: list[str] = []
FIX = Path(__file__).resolve().parent / "fixtures" / "rig_from_frame"


def check(label: str, cond: bool, detail: str = "") -> None:
    print(f"{'ok  ' if cond else 'FAIL'} {label}{'' if cond else '  ' + detail}")
    if not cond:
        FAILED.append(label)


rgba = np.array(Image.open(FIX / "frame.png").convert("RGBA"))
H, W = rgba.shape[:2]
track = json.loads((FIX / "track.json").read_text(encoding="utf8"))
slots = json.loads((FIX / "slots.json").read_text(encoding="utf8"))
stored = json.loads((FIX / "prompts.json").read_text(encoding="utf8"))
ref = json.loads((FIX / "reference.json").read_text(encoding="utf8"))
bits = np.array(Image.open(FIX / "reference.png")).astype(np.int64)
ref_labels = np.array(Image.open(FIX / "labels.png"))
drawn = np.array(Image.open(FIX / "accessories.png")) > 0
vis = rgba[..., 3] > 127


def key(pos, neg, box) -> tuple:
    return tuple(round(float(v), 3) for v in [*np.ravel(pos), -1, *np.ravel(neg), -2, *box])


MASK = {key(p["pos"], p["neg"], p["box"]): (bits >> k) & 1 for k, p in enumerate(stored)}


class StubSam:
    """SAM as the reference recorded it; any other prompt (the props step's) grows to the drawn
    prop it points into, inside its box."""

    def __init__(self):
        self.calls = []

    def embed(self, rgb):
        return R.Embedding(None, None, None, rgb.shape[:2])

    def logits(self, e, pos, neg, box):
        self.calls.append((pos, neg, box))
        m = MASK.get(key(pos, neg, box))
        if m is None:
            m = np.zeros((H, W), np.int64)
            x0, y0, x1, y1 = (int(v) for v in box)
            m[y0:y1 + 1, x0:x1 + 1] = drawn[y0:y1 + 1, x0:x1 + 1]
        return np.where(m > 0, 1.0, -1.0).astype(np.float32)


# --- the prompts the reference was made with ------------------------------------------------------

j = R.joints_of(track, W, H)
parts = [p for p in R.CUT_PARTS if p in slots and p != "neck"]
prm = R.prompts(j, (H, W), parts)
same = all(key(*prm[p["name"]]) == key(p["pos"], p["neg"], p["box"])
           for p in stored if not p["name"].startswith("prop:"))
check("the job's prompts are the ones the reference was made with", same,
      "prompts() changed: remake the fixture (tools/frame-to-rig/make_fixture.py)")
check("every part the template has is prompted, the neck is not",
      sorted(prm) == sorted(parts) and "neck" in slots and "neck" not in prm, str(sorted(prm)))
check("an arm is prompted along its bone and kept off its neighbours",
      len(prm["upper_arm_l"][0]) == 3 and len(prm["upper_arm_l"][1]) == 3
      and all(prm["upper_arm_l"][2][0] <= x <= prm["upper_arm_l"][2][2] for x, _ in prm["upper_arm_l"][0]))
check("front to back follows the template's draw order (the `_r` arm over the `_l`, the head over "
      "the torso)", R.front_to_back(slots, parts) == ref["names"], str(R.front_to_back(slots, parts)))

# --- the cut, end to end with SAM stood in -------------------------------------------------------

sam = StubSam()
res = R.cut(rgba, track, slots, sam=sam, seg=None)
lab = res["labels"]
check("the cut's parts are the reference's, in order", res["names"] == ref["names"], str(res["names"]))
check("the cut equals the partition of torch's masks", np.array_equal(lab, ref_labels),
      f"{int((lab != ref_labels).sum())} px differ")
check("every visible pixel is in exactly one part, nothing outside the character",
      bool(((lab != R.BACKGROUND) == vis).all()))
check("the capsules took what SAM left, the islands joined a neighbour",
      res["report"]["stats"] == ref["stats"], f"{res['report']['stats']} vs {ref['stats']}")
claimed = [((bits >> k) & 1).astype(bool) & vis for k in range(len(ref["names"]))]
pairs = [(f, b, claimed[f] & claimed[b]) for f in range(len(claimed)) for b in range(f + 1, len(claimed))]
pairs = [(f, b, m) for f, b, m in pairs if m.any()]
check("a pixel two parts claim goes to the front one (a hand over its forearm, a forearm over its "
      "upper arm)", len(pairs) >= 3 and all(bool((lab[m] == f).all()) for f, _, m in pairs),
      str([(ref["names"][f], ref["names"][b], int(m.sum())) for f, b, m in pairs]))
check("no part is left out", not res["report"]["not_cut"], str(res["report"]["not_cut"]))

# --- props --------------------------------------------------------------------------------------

real_accessories = R.accessories
R.accessories = lambda rgb, seg: drawn.astype(np.float32)
try:
    res_p = R.cut(rgba, track, slots, sam=StubSam(), seg=object())
finally:
    R.accessories = real_accessories
props = {p["name"]: p for p in res_p["report"]["props"]}
check("the glasses ride the face, drawn before the front hair",
      props.get("prop_glasses", {}).get("bone") == "face"
      and props["prop_glasses"].get("before") == "hair_front", str(props.get("prop_glasses")))
check("the chain rides the chest, drawn before the neck",
      props.get("prop_chain", {}).get("bone") == "chest" and props["prop_chain"].get("before") == "neck")
check("the watch rides its forearm, drawn after that arm's last finger",
      props.get("prop_wrist_r", {}).get("bone") == "lower_arm_r"
      and props["prop_wrist_r"].get("after") == "thumb_3_r", str(props.get("prop_wrist_r")))
check("the earring rides the head", props.get("prop_earring_l", {}).get("bone") == "head")
check("the hair cap on top of the head is not taken",
      any(r["why"] == "on top of the head" for r in res_p["report"]["rejected"])
      and all(n.startswith("prop_") for n in props), str(res_p["report"]["rejected"]))
lp = res_p["labels"]
gi = res_p["names"].index("prop_glasses")
lens = drawn[95:130, 210:310]
check("a prop is cut out of the part under it",
      props["prop_glasses"]["from"].get("head", 0) > 0 and bool((lp[95:130, 210:310][lens] == gi).all()))
check("each pixel is counted once: in a part or in the prop cut out of it",
      sum(p["px"] for p in res_p["report"]["parts"]) + sum(p["px"] for p in props.values())
      == int(vis.sum()))
check("props start ticked and riding their bone",
      all(p["take"] and p["motion"] == "rides" for p in props.values()))

# --- naming by joints on made-up pieces ----------------------------------------------------------


def blob(cx, cy, r) -> np.ndarray:
    yy, xx = np.mgrid[0:H, 0:W]
    return (xx - cx) ** 2 + (yy - cy) ** 2 <= r * r


F = j["face"]
check("a piece on the eyes is glasses", (R.classify(blob(*F[33], 6), j, slots) or {}).get("name") == "prop_glasses")
check("a big piece above the forehead is nobody's (hair or a hat)",
      R.classify(blob(F[10][0], F[10][1] - 30, 30), j, slots) is None)
waving = dict(j, hands={**j["hands"], "r": {"pts": j["hands"]["r"]["pts"] + (F[10] - [0, 60] - j["hands"]["r"]["pts"][0])}})
check("a big piece above the forehead by a hand raised over the head is still nobody's",
      R.classify(blob(F[10][0], F[10][1] - 60, 30), waving, slots) is None)
ring = j["hands"]["l"]["pts"][6]
check("a small piece on a finger is a ring on that hand",
      (R.classify(blob(*ring, 3), j, slots) or {}).get("name") == "prop_ring_l")
check("an arm's tail is its last finger slot", R.arm_tail(slots, "l") == "thumb_3_l")

# --- the frame from its sheet ------------------------------------------------------------------

frame_im = Image.fromarray(rgba)
bbox = frame_im.getbbox()
trimmed = frame_im.crop(bbox)
page = Image.new("RGBA", (700, 700), (9, 9, 9, 255))
page.paste(trimmed.transpose(Image.Transpose.ROTATE_270), (40, 30))
region = {"x": 40, "y": 30, "w": trimmed.width, "h": trimmed.height, "rotated": True,
          "offX": bbox[0], "offY": bbox[1]}
back = R.frame_from_page(page, region, (W, H))
check("a frame packed turned comes back upright, at its untrimmed place", np.array_equal(back, rgba))
page2 = Image.new("RGBA", (700, 700), (9, 9, 9, 255))
page2.paste(trimmed, (5, 7))
back2 = R.frame_from_page(page2, {"x": 5, "y": 7, "w": trimmed.width, "h": trimmed.height,
                                  "offX": bbox[0], "offY": bbox[1]}, (W, H))
check("a frame packed upright comes back at its untrimmed place", np.array_equal(back2, rgba))

# --- the job's input ---------------------------------------------------------------------------

PREFIX = "acme/game1"
good = {"job": "f2r-test-01", "frame": {"pageKey": f"{PREFIX}/sheets/x/x.png", "region": region,
                                        "canvas": [W, H]},
        "track": track, "template": {"id": "half-body", "slots": slots}}


def refused(p: dict) -> bool:
    try:
        R.validate(p, PREFIX)
    except ValueError:
        return True
    return False


check("a well-formed request is taken", not refused(good))
check("a sheet outside the project is refused",
      refused({**good, "frame": {**good["frame"], "pageKey": "other/game/sheets/x.png"}})
      and refused({**good, "frame": {**good["frame"], "pageKey": f"{PREFIX}/../x/sheets/x.png"}}))
check("a bad job id is refused", refused({**good, "job": "../x"}) and refused({**good, "job": "A"}))
check("a canvas past 4096 is refused", refused({**good, "frame": {**good["frame"], "canvas": [5000, 10]}}))
try:
    R.cut(rgba, {**track, "face": None}, slots, sam=StubSam())
    check("a frame with no face tracked is refused, saying so", False)
except ValueError as e:
    check("a frame with no face tracked is refused, saying so", "face" in str(e))
try:
    R.cut(rgba, track, [s for s in slots if not s.startswith("upper_arm")], sam=StubSam())
    check("a template without the Half body parts is refused", False)
except ValueError as e:
    check("a template without the Half body parts is refused", "upper_arm" in str(e))
opaque = rgba.copy()
opaque[..., 3] = 255
try:
    R.cut(opaque, track, slots, sam=StubSam())
    check("a frame with its background painted in is refused, saying so", False)
except ValueError as e:
    check("a frame with its background painted in is refused, saying so", "transparen" in str(e))

# --- the models ----------------------------------------------------------------------------------

check("every model is pinned by SHA-256 and size",
      all(len(sha) == 64 and size > 0 for _, sha, size in R.MODELS.values()))
with tempfile.TemporaryDirectory() as tmp:
    import os

    os.environ.pop("RIG_FROM_FRAME_MODELS", None)
    os.environ["ATLAS_STAGING"] = tmp
    real = dict(R.MODELS)
    body = b"not the model"
    import hashlib

    R.MODELS["decoder"] = ("d.onnx", hashlib.sha256(body).hexdigest(), len(body))
    asked = []
    got = R.model_file("decoder", fetch=lambda k: asked.append(k) or body)
    check("a model is fetched once from R2 under its hash and kept",
          got.read_bytes() == body and asked == [f"{R.MODEL_PREFIX}/{R.MODELS['decoder'][1][:12]}/d.onnx"]
          and R.model_file("decoder", fetch=lambda k: asked.append(k)) == got and len(asked) == 1)
    R.MODELS["decoder"] = ("e.onnx", "0" * 64, len(body))
    try:
        R.model_file("decoder", fetch=lambda k: body)
        check("a model that is not the pinned one is refused and dropped", False)
    except RuntimeError:
        check("a model that is not the pinned one is refused and dropped",
              not any(Path(tmp).rglob("e.onnx")))
    R.MODELS.clear()
    R.MODELS.update(real)

# --- SAM's plumbing ----------------------------------------------------------------------------


class Rec:
    def __init__(self, outs):
        self.outs, self.fed = outs, None

    def run(self, _names, feed):
        self.fed = feed
        return self.outs

    def get_inputs(self):
        return [type("I", (), {"name": "input_29"})()]


enc = Rec([np.zeros(1), np.zeros(1), np.zeros(1)])
low = np.full((256, 256), -5.0, np.float32)
low[:128] = 5.0
dec = Rec([low[None, None, None], np.zeros((1, 1, 1))])
s = R.Sam(enc, dec)
img = np.zeros((300, 600, 3), np.uint8)
img[:, :, 0] = 255
e = s.embed(img)
px = enc.fed["pixel_values"]
check("the encoder sees the picture at 1024², ImageNet-normalised, channels first",
      px.shape == (1, 3, 1024, 1024) and abs(float(px[0, 0, 5, 5]) - (1 - 0.485) / 0.229) < 1e-4
      and abs(float(px[0, 1, 5, 5]) - (0 - 0.456) / 0.224) < 1e-4)
out = s.logits(e, [[300, 150]], [[60, 30]], [0, 0, 599, 299])
fed = dec.fed
check("prompts are scaled into the 1024 picture, labels 1 in / 0 out, the box as two corners",
      np.allclose(fed["points"][0, 0], [[512, 512], [102.4, 102.4]])
      and fed["labels"].dtype == np.int64 and fed["labels"].tolist() == [[[1, 0]]]
      and np.allclose(fed["boxes"][0, 0], [0, 0, 599 * 1024 / 600, 299 * 1024 / 300]))
check("the mask's logits come back at the picture's size",
      out.shape == (300, 600) and out[10, 10] > 0 and out[290, 10] < 0)
z = np.zeros((1, 256, 256, 6), np.float32)
z[..., R.ACCESSORY] = 8.0
seg = Rec([z])
conf = R.accessories(img, seg)
x = seg.fed["input_29"]
check("the segmenter sees 256², in [-1, 1], and its logits are soft-maxed",
      x.shape == (1, 256, 256, 3) and abs(float(x[0, 3, 3, 0]) - 1.0) < 1e-5
      and abs(float(x[0, 3, 3, 1]) + 1.0) < 1e-5 and conf.shape == (300, 600)
      and abs(float(conf.mean()) - np.exp(8) / (np.exp(8) + 5)) < 1e-4)

# --- the job writes its five files --------------------------------------------------------------

store: dict[str, bytes] = {}
buf = io.BytesIO()
page.save(buf, "PNG")
R.accessories = lambda rgb, seg: drawn.astype(np.float32)
try:
    doc = R.run(good, project_prefix=PREFIX,
                get=lambda k: buf.getvalue() if k == good["frame"]["pageKey"] else None,
                put=lambda k, b, ct=None: store.__setitem__(k, b), sam=StubSam(), seg=object())
finally:
    R.accessories = real_accessories
root = f"{PREFIX}/rig-from-frame/f2r-test-01"
check("the job writes frame, joints, labels, overlay and cut.json under rig-from-frame/<job>/",
      sorted(store) == sorted(f"{root}/{n}" for n in
                              ("frame.png", "track.json", "labels.png", "overlay.png", "cut.json")))
saved = json.loads(store[f"{root}/cut.json"])
lab_saved = np.array(Image.open(io.BytesIO(store[f"{root}/labels.png"])))
check("labels.png indexes cut.json's names, background 255",
      saved["names"][: len(ref["names"])] == ref["names"] and saved["background"] == 255
      and int(lab_saved.max(initial=0)) == 255 and set(np.unique(lab_saved)) <= set(range(len(saved["names"]))) | {255})
check("cut.json says where the frame came from and that the neck is off",
      saved["source"]["pageKey"] == good["frame"]["pageKey"] and saved["neck"] is False
      and saved["size"] == [W, H] and saved["template"] == "half-body")
check("the frame is stored with its alpha",
      np.array_equal(np.array(Image.open(io.BytesIO(store[f"{root}/frame.png"])).convert("RGBA")), rgba))

if FAILED:
    print(f"\n{len(FAILED)} failed")
    sys.exit(1)
print("\nall passed")
