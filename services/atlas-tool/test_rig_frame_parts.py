"""Frame to rig's parts and sheet (`rig_frame_parts.py`, phase F2b) on the cut fixture.

Run:  py test_rig_frame_parts.py   (from services/atlas-tool, PYTHONPATH=../_shared:.)

The fixture (`fixtures/rig_from_frame/`) is the F1 gate's drawn half-body character; `parts/` holds
its cut with props (F1's job, SAM answering the recorded masks), the request the launcher makes for
that cut (`parts/request.json`, written by `tools/rigger-spike/frame-rig.mjs --write` from the shipped
fit) and the sheet this job makes from it (`parts/sheet.png` + `sheet.json`), which the rigger spike
poses through engine-rig for the F2 gate. Asserted here:

- the committed cut is F1's cut of the fixture now (else remake: `--write-cut`, then the spike's
  `--write`, then `--write`), and the committed sheet is this job's from the committed request;
- every pixel of the character, its soft edge too, is in exactly one part's image;
- a part's hidden pixels under a part drawn in front are made (occluded), the ones over a part drawn
  behind keep the frame's own (overlap), and a prop's host is whole under it;
- the occluded pixels are painted from the part's own colours on the CPU and marked `cpu`;
- each canvas is turned to its bone's rest (an arm hangs straight down from its centre) and, drawn
  back through its matrix in the draw order, redraws the frame (alpha IoU ≥ 0.99);
- a prop left ✗ is drawn into its host; a limb out of the picture is reported cut off;
- the sheet is written as a project sheet, untrimmed and named by part, stamped as this cut's: the
  same cut may make it again, another sheet of that name is never overwritten; `parts.json` keeps
  the report; a bad request is refused, the GPU fill too (F3);
- a mutant planted per guard turns it red.
"""
from __future__ import annotations

import copy
import io
import json
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

import rig_frame_parts as P
import rig_from_frame as R

FAILED: list[str] = []
FIX = Path(__file__).resolve().parent / "fixtures" / "rig_from_frame"
PARTS = FIX / "parts"
WRITE_CUT = "--write-cut" in sys.argv
WRITE = "--write" in sys.argv
QUIET = [False]


def check(label: str, cond: bool, detail: str = "") -> bool:
    if not QUIET[0]:
        print(f"{'ok  ' if cond else 'FAIL'} {label}{'' if cond else '  ' + detail}")
        if not cond:
            FAILED.append(label)
    return bool(cond)


rgba = np.array(Image.open(FIX / "frame.png").convert("RGBA"))
H, W = rgba.shape[:2]
alpha = rgba[..., 3]
track = json.loads((FIX / "track.json").read_text(encoding="utf8"))

# --- the cut: F1's job on the fixture, SAM answering the recorded masks --------------------------


def fixture_cut() -> tuple[dict, np.ndarray]:
    slots = json.loads((FIX / "slots.json").read_text(encoding="utf8"))
    stored = json.loads((FIX / "prompts.json").read_text(encoding="utf8"))
    bits = np.array(Image.open(FIX / "reference.png")).astype(np.int64)
    drawn = np.array(Image.open(FIX / "accessories.png")) > 0

    def key(pos, neg, box) -> tuple:
        return tuple(round(float(v), 3) for v in [*np.ravel(pos), -1, *np.ravel(neg), -2, *box])

    masks = {key(p["pos"], p["neg"], p["box"]): (bits >> k) & 1 for k, p in enumerate(stored)}

    class StubSam:
        def embed(self, rgb):
            return R.Embedding(None, None, None, rgb.shape[:2])

        def logits(self, e, pos, neg, box):
            m = masks.get(key(pos, neg, box))
            if m is None:
                m = np.zeros((H, W), np.int64)
                x0, y0, x1, y1 = (int(v) for v in box)
                m[y0:y1 + 1, x0:x1 + 1] = drawn[y0:y1 + 1, x0:x1 + 1]
            return np.where(m > 0, 1.0, -1.0).astype(np.float32)

    real = R.accessories
    R.accessories = lambda rgb, seg: drawn.astype(np.float32)
    try:
        res = R.cut(rgba, track, slots, sam=StubSam(), seg=object())
    finally:
        R.accessories = real
    report = {k: v for k, v in res["report"].items() if k != "timings"}
    doc = {"version": 1, "job": "f2r-fixture-0001", "template": "half-body", "size": [W, H],
           "names": res["names"], "background": R.BACKGROUND, "neck": False, **report}
    return doc, res["labels"]


cut, labels = fixture_cut()
if WRITE_CUT:
    PARTS.mkdir(exist_ok=True)
    (PARTS / "cut.json").write_text(json.dumps(cut, indent=1) + "\n", encoding="utf8")
    Image.fromarray(labels).save(PARTS / "labels.png")
    print("wrote parts/cut.json and parts/labels.png; now: node tools/rigger-spike/frame-rig.mjs --write")
    sys.exit(0)

check("the committed cut is F1's cut of the fixture",
      json.loads((PARTS / "cut.json").read_text(encoding="utf8")) == cut
      and np.array_equal(np.array(Image.open(PARTS / "labels.png")), labels),
      "remake: --write-cut, node tools/rigger-spike/frame-rig.mjs --write, --write")
request = json.loads((PARTS / "request.json").read_text(encoding="utf8"))
v = P.validate(request)
rank = {n: i for i, n in enumerate(v["order"])}


def make() -> dict:
    return P.make_parts(rgba, labels, cut, track, v)


def frame_pose(images: dict) -> np.ndarray:
    """Each image drawn back into the frame as the rig poses it, in the draw order (premultiplied):
    a canvas pixel's centre is its attachment's local point, the matrix takes it to the rig's world
    (rig units, y up) and the scale and origin to the frame's pixels."""
    out = np.zeros((H, W, 4), np.float32)
    k, (ox, oy) = v["scale"], v["origin"]
    for n in v["order"]:
        if n not in images:
            continue
        im = images[n].astype(np.float32) / 255.0
        a, b, c, d, tx, ty = v["matrices"][n]
        h_, w_ = im.shape[:2]
        corners = []
        for i, jj in ((0, 0), (1, 0), (0, 1)):
            lu, lv = i * w_ - w_ / 2, h_ / 2 - jj * h_
            wx, wy = a * lu + b * lv + tx, c * lu + d * lv + ty
            corners.append([wx / k + ox - 0.5, -wy / k + oy - 0.5])
        A = cv2.getAffineTransform(np.float32([[-0.5, -0.5], [w_ - 0.5, -0.5], [-0.5, h_ - 0.5]]),
                                   np.float32(corners))
        pre = np.dstack([im[..., :3] * im[..., 3:4], im[..., 3:4]])
        got = cv2.warpAffine(pre, A.astype(np.float32), (W, H), flags=cv2.INTER_LINEAR,
                             borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
        a = got[..., 3:4]
        out = got + out * (1 - a)
    return out


# --- guards: each returns whether it holds ---------------------------------------------------------


def g_partition() -> bool:
    # The fixture is drawn with a hard outline: give it a soft one, two pixels of alpha 40 and 90.
    soft = alpha.copy()
    k = np.ones((3, 3), np.uint8)
    one = cv2.dilate((alpha > 0).astype(np.uint8), k).astype(bool) & (alpha == 0)
    two = cv2.dilate((alpha > 0).astype(np.uint8), k, iterations=2).astype(bool) & (alpha == 0) & ~one
    soft[one], soft[two] = 90, 40
    edged = P.with_edges(labels, soft)
    return check("every pixel of the character, its soft edge too, is in exactly one part",
                 bool(((edged != R.BACKGROUND) == (soft > 0)).all())
                 and bool((edged[alpha > 127] == labels[alpha > 127]).all()) and two.any(),
                 f"{int(((edged != R.BACKGROUND) != (soft > 0)).sum())} px off")


def g_hidden() -> bool:
    j = R.joints_of(track, W, H)
    masks, hosts = P.part_masks(labels, cut)
    lay = P.layers(masks, hosts, v["order"], j, alpha)
    ok_front = True
    for n, layer in lay.items():
        front = np.zeros((H, W), bool)
        for o in lay:
            if rank[o] > rank[n]:
                front |= lay[o]["vis"]
        ok_front &= bool((layer["occluded"] <= front).all()) and not (layer["overlap"] & front).any()
        ok_front &= bool((layer["whole"] <= (alpha > 127)).all())
    rep = make()["report"]
    worn = all(bool((lay[p]["vis"] <= lay[h]["whole"]).all()) for p, h in hosts.items())
    return (check("what a part hides under a part in front is made, over a part behind it keeps the "
                  "frame's own", ok_front)
            & check("the forearm under its hand is made, the hand's wrist end over the forearm and an "
                    "arm's shoulder end over the torso keep the frame's own",
                    rep["lower_arm_l"]["occluded_px"] > 0 and rep["hand_l"]["overlap_px"] > 0
                    and rep["upper_arm_l"]["overlap_px"] > 0,
                    str((rep["lower_arm_l"], rep["hand_l"], rep["upper_arm_l"])))
            & check("the torso behind the arm folded over it is made",
                    rep["torso"]["occluded_px"] > 2000, str(rep["torso"]))
            & check("a prop's host is whole under it", worn and rep["head"]["under_props_px"] > 0,
                    str(rep["head"])))


def g_fill() -> bool:
    made = make()
    rep, images = made["report"], made["images"]
    marked = all((r["filled"] == "cpu") == (r["occluded_px"] > 0) for r in rep.values())
    # The torso's made pixels, read back in the frame: painted from the torso, not left black.
    j = R.joints_of(track, W, H)
    masks, hosts = P.part_masks(labels, cut)
    lay = P.layers(masks, hosts, v["order"], j, alpha)
    torso = frame_pose({"torso": images["torso"]})
    occ = lay["torso"]["occluded"] & (torso[..., 3] > 0.99)
    ring = cv2.dilate(occ.astype(np.uint8), np.ones((25, 25), np.uint8)).astype(bool) & lay["torso"]["vis"]
    made_c = (torso[..., :3][occ] / torso[..., 3:4][occ]) * 255
    own_c = rgba[..., :3][ring].astype(np.float32)
    near = float(np.linalg.norm(np.median(made_c, 0) - np.median(own_c, 0)))
    return (check("what a part hides is filled on the CPU, and marked so", marked,
                  str({n: (r["filled"], r["occluded_px"]) for n, r in rep.items()}))
            & check("the made pixels are painted from the part's own colours around them (Telea)",
                    occ.sum() > 1000 and near < 25, f"{int(occ.sum())} px, {near:.1f} off"))


def g_rest() -> bool:
    images = make()["images"]
    hang = True
    detail = []
    for n in ("upper_arm_l", "lower_arm_l", "upper_arm_r", "lower_arm_r"):
        a = images[n][..., 3].astype(np.float32)
        ys, xs = np.nonzero(a > 127)
        cx, cy = xs.mean() + 0.5, ys.mean() + 0.5
        h_, w_ = a.shape
        hang &= abs(cx - w_ / 2) < 4 and cy > h_ / 2 + 10
        detail.append(f"{n} ({cx - w_ / 2:.1f}, {cy - h_ / 2:.1f})")
    return check("each limb's canvas is turned to its bone's rest: it hangs straight down from its "
                 "centre", hang, ", ".join(detail))


def g_redraw() -> bool:
    got = frame_pose(make()["images"])
    fa, ga = alpha > 127, got[..., 3] > 0.5
    iou = float((fa & ga).sum() / (fa | ga).sum())
    both = fa & ga
    err = float(np.abs(got[..., :3][both] / got[..., 3:4][both] * 255 - rgba[..., :3][both]).mean())
    print(f"     the canvases drawn back in the frame's pose: alpha IoU {iou:.4f}, colour off {err:.2f}")
    return (check("the canvases drawn back through their matrices redraw the frame (IoU ≥ 0.99)",
                  iou >= 0.99, f"{iou:.4f}")
            & check("in its colours (≤ 6/255 on average)", err <= 6, f"{err:.2f}"))


def g_untaken() -> bool:
    off = copy.deepcopy(cut)
    chain = next(p for p in off["props"] if p["name"] == "prop_chain")
    chain["take"] = False
    vv = dict(v, matrices={k: m for k, m in v["matrices"].items() if k != "prop_chain"},
              order=[n for n in v["order"] if n != "prop_chain"])
    rep = P.make_parts(rgba, labels, off, track, vv)["report"]
    base = make()["report"]
    return check("a prop left ✗ is drawn into its host",
                 "prop_chain" not in rep and rep["torso"]["visible_px"]
                 == base["torso"]["visible_px"] + base["prop_chain"]["visible_px"],
                 f"{rep.get('torso', {}).get('visible_px')} vs {base['torso']['visible_px']}"
                 f" + {base['prop_chain']['visible_px']}")


def g_cut_off() -> bool:
    j = R.joints_of(track, W, H)
    out = dict(j, **{"elbow_r": np.array([W + 120.0, j["elbow_r"][1]])},
               hands={**j["hands"], "r": {"pts": j["hands"]["r"]["pts"] + [W + 60.0 - j["hands"]["r"]["pts"][0][0], 0]}})
    rep = make()["report"]
    return check("a limb out of the picture is reported cut off, none in it is",
                 all(r["cut_off"] == 0 for r in rep.values())
                 and P.cut_off("lower_arm_r", out, W, H) >= P.CROPPED,
                 str({n: r["cut_off"] for n, r in rep.items()}))


class Store:
    """R2 as a dict, conditional like the real one."""

    def __init__(self, objects: dict):
        self.objects = objects
        self.Conflict = type("Conflict", (Exception,), {})

    def put(self, k, b, ct=None, if_match=None, if_none_match=None):
        if if_none_match == "*" and k in self.objects:
            raise self.Conflict(k)
        if if_match and self.objects.get(k, (None,))[0] is None:
            raise self.Conflict(k)
        self.objects[k] = b

    def get_with_etag(self, k):
        return (self.objects[k], "e") if k in self.objects else None


PREFIX = "acme/game1"
ROOT = f"{PREFIX}/rig-from-frame/{cut['job']}"


def job_files() -> dict:
    def png(a) -> bytes:
        buf = io.BytesIO()
        Image.fromarray(a).save(buf, "PNG")
        return buf.getvalue()

    return {f"{ROOT}/cut.json": json.dumps(cut).encode(), f"{ROOT}/frame.png": png(rgba),
            f"{ROOT}/labels.png": png(labels), f"{ROOT}/track.json": json.dumps(track).encode()}


def run_real(objects: dict, payload: dict) -> dict:
    """The job with the real sheet writer, R2 and the staging disk stood in."""
    import video_to_clip

    store = Store(objects)
    real = (video_to_clip.storage.put, video_to_clip.storage.get_with_etag,
            video_to_clip.storage.Conflict, video_to_clip.project_paths.resolve)
    tmp = Path(tempfile.mkdtemp(prefix="iw-f2b-"))
    video_to_clip.storage.put, video_to_clip.storage.get_with_etag = store.put, store.get_with_etag
    video_to_clip.storage.Conflict = store.Conflict
    video_to_clip.project_paths.resolve = lambda: {
        "r2_project_prefix": PREFIX, "staging_root": tmp, "manifest_dir": tmp / "manifests"}
    try:
        return P.run(payload, project_prefix=PREFIX, get=objects.get,
                     put=lambda k, b, ct=None: objects.__setitem__(k, b))
    finally:
        (video_to_clip.storage.put, video_to_clip.storage.get_with_etag,
         video_to_clip.storage.Conflict, video_to_clip.project_paths.resolve) = real


def g_sheet() -> bool:
    objects = job_files()
    doc = run_real(objects, request)
    man_key = f"{PREFIX}/manifests/atlas_manifest_Fixture_parts.json"
    man = json.loads(objects[man_key])
    regions = {r["name"]: r for r in man["regions"]}
    placed = set(v["matrices"])
    named = set(regions) == placed and doc["manifestKey"] == man_key
    untrimmed = all(r["offX"] == 0 and r["offY"] == 0 and r["origW"] == r["w"] and r["origH"] == r["h"]
                    and not r["rotated"] for r in regions.values())
    stamped = man.get("rig_from_frame", {}).get("job") == cut["job"] and "frame to rig" in man["_comment"]
    kept = json.loads(objects[f"{ROOT}/parts.json"])["parts"].keys() == doc["parts"].keys()
    again = run_real(objects, request)["manifestKey"] == man_key
    objects[man_key] = json.dumps({"_comment": "an artist's own sheet", "regions": []}).encode()
    try:
        run_real(objects, request)
        foreign = False
    except ValueError as e:
        foreign = "already exists" in str(e)
    if WRITE:
        page = objects[man["atlas"]["source_image_path"]]
        (PARTS / "sheet.png").write_bytes(page)
        (PARTS / "sheet.json").write_text(json.dumps(
            {"width": man["atlas"]["width"], "height": man["atlas"]["height"],
             "regions": man["regions"], "parts": doc["parts"]}, indent=1) + "\n", encoding="utf8")
        print("     wrote parts/sheet.png and parts/sheet.json")
    same = True
    if not WRITE:
        want = json.loads((PARTS / "sheet.json").read_text(encoding="utf8"))
        a = np.array(Image.open(io.BytesIO(objects[man["atlas"]["source_image_path"]])).convert("RGBA")).astype(np.int16)
        b = np.array(Image.open(PARTS / "sheet.png").convert("RGBA")).astype(np.int16)
        same = (want["regions"] == man["regions"] and a.shape == b.shape
                and float(np.abs(a - b).mean()) < 0.5 and int(np.abs(a - b).max()) <= 64)
    return (check("the sheet is a project sheet named by part, the props among them", named,
                  f"{sorted(regions)} vs {sorted(placed)}")
            & check("untrimmed: each image keeps its centre on its bone", untrimmed)
            & check("stamped as this cut's, and the report kept as parts.json", stamped and kept)
            & check("the same cut makes it again; another sheet of that name is never overwritten",
                    again and foreign)
            & check("the committed sheet is this job's from the committed request", same,
                    "remake: py test_rig_frame_parts.py --write"))


def g_refused() -> bool:
    def refused(p: dict, needle: str = "") -> bool:
        try:
            P.validate(p)
        except ValueError as e:
            return needle.lower() in str(e).lower()
        return False

    m0 = request["parts"][0]
    bad_m = dict(m0, matrix=[float("nan"), *m0["matrix"][1:]])
    flat = dict(m0, matrix=[1, 2, 2, 4, 0, 0])
    unknown = dict(v, matrices={**v["matrices"], "tail": v["matrices"]["torso"]},
                   order=[*v["order"], "tail"])
    missing = dict(v, matrices={k: m for k, m in v["matrices"].items() if k != "torso"})
    try:
        P.make_parts(rgba, labels, cut, track, unknown)
        no_part = False
    except ValueError as e:
        no_part = "no tail" in str(e)
    try:
        P.make_parts(rgba, labels, cut, track, missing)
        unplaced = False
    except ValueError as e:
        unplaced = "torso" in str(e)
    return check("a bad request is refused, saying why: the job, the sheet name, a part's place, "
                 "the order, a part the cut has not or one left unplaced, the GPU fill",
                 refused({**request, "job": "../x"}, "job") and refused({**request, "sheet": "a/b"}, "sheet")
                 and refused({**request, "scale": 0}, "scale")
                 and refused({**request, "parts": [bad_m, *request["parts"][1:]]}, "place")
                 and refused({**request, "parts": [flat, *request["parts"][1:]]}, "no area")
                 and refused({**request, "order": request["order"][1:]}, "order")
                 and refused({**request, "fill": "gpu"}, "cpu") and no_part and unplaced)


GUARDS = {"partition": g_partition, "hidden": g_hidden, "fill": g_fill, "rest": g_rest,
          "redraw": g_redraw, "untaken": g_untaken, "cut_off": g_cut_off, "sheet": g_sheet,
          "refused": g_refused}
for g in GUARDS.values():
    g()

if WRITE:
    print("\n(--write: the sheet was remade; run again without it to check)")
    sys.exit(1 if FAILED else 0)

# --- mutants: each must turn its guard red -------------------------------------------------------


def patched(obj, name, value):
    real = getattr(obj, name)
    setattr(obj, name, value)
    return lambda: setattr(obj, name, real)


real_layers, real_part_masks, real_canvas_map = P.layers, P.part_masks, P.canvas_map


def every_hidden_made(masks, hosts, order, j, a):
    out = real_layers(masks, hosts, order, j, a)
    for layer in out.values():
        layer["occluded"] = layer["occluded"] | layer["overlap"]
        layer["overlap"] = np.zeros_like(layer["overlap"])
    return out


def untaken_dropped(lab, c):
    masks, hosts = real_part_masks(lab, c)
    for p in c.get("props") or []:
        if not p.get("take", True):
            masks[p["host"]] = lab == c["names"].index(p["host"])
    return masks, hosts


def unturned(m, k, origin, size):
    s = float(np.hypot(m[0], m[2]))
    return real_canvas_map([s, 0.0, 0.0, s, m[4], m[5]], k, origin, size)


def unmarked_fill(*a, **kw):
    made = real_make_parts(*a, **kw)
    for r in made["report"].values():
        if "filled" in r:
            r["filled"] = None
    return made


real_make_parts = P.make_parts
MUTANTS = [
    ("partition", "the soft edge left out", lambda: patched(P, "with_edges", lambda lab, a: lab)),
    ("hidden", "every hidden pixel made, the overlap too", lambda: patched(P, "layers", every_hidden_made)),
    ("fill", "the hidden pixels left unfilled", lambda: patched(P, "FILL", {"cpu": lambda rgb, known: rgb})),
    ("fill", "the fill not marked", lambda: patched(P, "make_parts", unmarked_fill)),
    ("rest", "a canvas not turned to its bone", lambda: patched(P, "canvas_map", unturned)),
    ("redraw", "the frame read two pixels off",
     lambda: patched(P, "canvas_map", lambda m, k, o, s: real_canvas_map(m, k, [o[0] + 2, o[1]], s))),
    ("untaken", "a prop left ✗ dropped from its host", lambda: patched(P, "part_masks", untaken_dropped)),
    ("cut_off", "nothing ever cut off", lambda: patched(P, "cut_off", lambda *a: 0.0)),
    ("sheet", "another sheet of the name overwritten", lambda: _no_veto()),
    ("refused", "the GPU fill taken", lambda: patched(P, "FILLS", ("cpu", "gpu"))),
]


def _no_veto():
    import video_to_clip

    real = video_to_clip.write_page

    def write(*a, may_replace=None, **kw):
        return real(*a, may_replace=None, **kw)

    return patched(video_to_clip, "write_page", write)


print("\nmutants of the job: each must turn its guard red")
for guard, what, plant in MUTANTS:
    undo = plant()
    QUIET[0] = True
    try:
        red = not GUARDS[guard]()
    except Exception:  # noqa: BLE001 — a mutant that breaks the job is caught too
        red = True
    finally:
        QUIET[0] = False
        undo()
    check(f"mutant caught by {guard}: {what}", red)

if FAILED:
    print(f"\n{len(FAILED)} failed")
    sys.exit(1)
print("\nall passed")
