"""The Bust-with-face part cutter (`rig_parts.py`, rig templates T6) on a drawn test face.

Run:  py test_rig_parts.py   (from services/atlas-tool)

A face is drawn the way Qwen draws one for this pipeline — bold outlines on a plain background —
and its variants change one feature each, the way an edit pass does, with the whole picture nudged
a few pixels, as Qwen-Image-Edit sometimes does. Checked: every part lands under its template
name and the required ones are all there; `_l` is the picture's left; each feature's patch covers
its change and stays off the others; pasting a variant's patches onto the neutral rebuilds that
variant; the canvas puts each part's art on its bone at the eye-fit scale; a drifted edit warns.

The real-output spike is in docs/status/rigger.md (open item 19); the rig side of the contract
(parts centred on their bones, `rig_templates/bust-face.json` in step with the TypeScript template)
is `tools/rigger-spike/template-art.mjs`.
"""
from __future__ import annotations

import sys

from PIL import Image, ImageChops, ImageDraw, ImageStat

import rig_parts

FAILED: list[str] = []
SKIN, LINE, WHITE = (250, 214, 180), (20, 20, 20), (255, 255, 255)
EYES = ((196, 230), (316, 230))  # picture-left eye first


def check(label: str, cond: bool, detail: str = "") -> None:
    print(f"{'ok  ' if cond else 'FAIL'} {label}{'' if cond else '  ' + detail}")
    if not cond:
        FAILED.append(label)


def face(mouth="rest", eyes="open", brows="neutral", shift=(0, 0), hair=(120, 60, 20)):
    img = Image.new("RGB", (512, 512), WHITE)
    d = ImageDraw.Draw(img)
    d.polygon([(96, 512), (150, 420), (362, 420), (416, 512)], fill=(60, 90, 200), outline=LINE)
    d.rectangle((226, 360, 286, 430), fill=SKIN, outline=LINE, width=3)
    d.ellipse((136, 110, 376, 380), fill=SKIN, outline=LINE, width=4)
    d.chord((136, 90, 376, 250), 180, 360, fill=hair, outline=LINE, width=4)
    for cx, cy in EYES:
        if eyes == "open":
            d.ellipse((cx - 26, cy - 18, cx + 26, cy + 18), fill=WHITE, outline=LINE, width=3)
            d.ellipse((cx - 9, cy - 9, cx + 9, cy + 9), fill=LINE)
        elif eyes == "closed":
            d.arc((cx - 26, cy - 14, cx + 26, cy + 14), 0, 180, fill=LINE, width=4)
        lift = {"neutral": 0, "up": -14}[brows]
        d.line((cx - 28, cy - 38 + lift, cx + 28, cy - 38 + lift), fill=LINE, width=7)
    if mouth == "rest":
        d.line((226, 320, 286, 320), fill=LINE, width=5)
    elif mouth == "A":
        d.ellipse((222, 300, 290, 350), fill=(140, 20, 30), outline=LINE, width=4)
    elif mouth == "O":
        d.ellipse((238, 302, 274, 346), fill=(140, 20, 30), outline=LINE, width=4)
    if shift != (0, 0):
        img = rig_parts.shifted(img, shift[0], shift[1], WHITE)
    return img


neutral = face()
variants = {
    "mouth_A": face(mouth="A", shift=(3, -2)),
    "mouth_O": face(mouth="O"),
    "eyes_closed": face(eyes="closed", shift=(-2, 1)),
    "brows_up": face(brows="up"),
    "mouth_wide": face(mouth="A", hair=(20, 140, 200)),  # an edit that also recoloured the hair
    "nose_big": face(),
}
parts, report, previews = rig_parts.cut(neutral, variants)

# Names: every required part, under its template name.
required = {"body", "head", "mouth_rest", "mouth_A", "mouth_O", "eyelid_l_closed",
            "eyelid_r_closed", "brow_l_neutral", "brow_r_neutral"}
check("every required part is cut", required <= set(parts), str(sorted(required - set(parts))))
check("no required part reported missing", report.missing_required == [], str(report.missing_required))
template_names = {p["name"] for p in rig_parts.load_template()["parts"]}
check("every cut part is a template name", set(parts) <= template_names,
      str(sorted(set(parts) - template_names)))
check("parts a variant was not given are reported missing",
      {"mouth_E", "eyelid_l_half", "brow_l_angry"} <= set(report.missing))
check("an unknown variant is ignored with a warning",
      any(w.startswith("nose_big") for w in report.warnings), str(report.warnings))
check("a drifted edit warns", any(w.startswith("mouth_wide") for w in report.warnings),
      str(report.warnings))
check("the shifts were found", report.variants["mouth_A"]["shift"] == [-3, 2]
      and report.variants["eyes_closed"]["shift"] == [2, -1], str(report.variants))

# Where each patch was cut from, in the picture.
frm = {n: tuple(p["from"]) for n, p in report.parts.items()}


def inside(box, x, y) -> bool:
    return box[0] <= x < box[2] and box[1] <= y < box[3]


def overlaps(a, b) -> bool:
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


check("_l is the picture's left eye", inside(frm["eyelid_l_closed"], *EYES[0]))
check("_r is the picture's right eye", inside(frm["eyelid_r_closed"], *EYES[1]))
check("the brows sit above the eyes", frm["brow_l_up"][3] <= EYES[0][1] + 5, str(frm["brow_l_up"]))
check("the mouth patch covers the open mouth",
      frm["mouth_A"][0] <= 222 and frm["mouth_A"][2] >= 290 and frm["mouth_A"][3] >= 350,
      str(frm["mouth_A"]))
check("one footprint for every mouth shape",
      frm["mouth_A"] == frm["mouth_O"] == frm["mouth_rest"])
check("brow neutral and up share a footprint", frm["brow_l_neutral"] == frm["brow_l_up"])
check("mouth patch stays off the eyes", not overlaps(frm["mouth_A"], frm["eyelid_l_closed"])
      and not overlaps(frm["mouth_A"], frm["eyelid_r_closed"]))
check("head ends at the neck, body starts there",
      frm["head"][3] < 430 and frm["body"][1] > 340 and frm["body"][3] == 512,
      f"{frm['head']} {frm['body']}")

# Pasting a variant's patches onto the neutral rebuilds the (aligned) variant.
for name in ("mouth_A", "mouth_O", "eyes_closed", "brows_up"):
    sx, sy = report.variants[name]["shift"]
    want = rig_parts.shifted(variants[name], sx, sy, WHITE)
    err = ImageStat.Stat(ImageChops.difference(previews[name], want).convert("L")).mean[0]
    check(f"{name}: neutral + patches rebuilds the variant (mean diff {err:.2f})", err < 1.0)

# Placement: the eyes fit the template's eye bones, and each canvas centres on its bone.
tpl = rig_parts.load_template()
bones = tpl["bones"]
eye_span = bones["eye_r"][0] - bones["eye_l"][0]
want_scale = eye_span / (EYES[1][0] - EYES[0][0])
check(f"eye-fit scale ({report.scale} ~ {want_scale:.4f})", abs(report.scale - want_scale) < 0.02)
lx0, ly0, lx1, ly1 = frm["eyelid_l_closed"]
rx0, ry0, rx1, ry1 = frm["eyelid_r_closed"]
anchor = ((lx0 + lx1 + rx0 + rx1) / 4, (ly0 + ly1 + ry0 + ry1) / 4)
anchor_w = ((bones["eye_l"][0] + bones["eye_r"][0]) / 2, (bones["eye_l"][1] + bones["eye_r"][1]) / 2)
for name in ("mouth_A", "eyelid_l_closed", "brow_r_up", "head", "body"):
    info = report.parts[name]
    bx, by = bones[info["bone"]]
    u = anchor[0] + (bx - anchor_w[0]) / report.scale
    v = anchor[1] - (by - anchor_w[1]) / report.scale
    img = parts[name]
    content = img.getchannel("A").getbbox()
    want_x = (info["from"][0] - u) * report.scale + img.width / 2
    want_y = (info["from"][1] - v) * report.scale + img.height / 2
    check(f"{name}: art sits on bone {info['bone']} ({content[0]},{content[1]} vs "
          f"{want_x:.1f},{want_y:.1f})",
          abs(content[0] - want_x) <= 2.5 and abs(content[1] - want_y) <= 2.5)
    check(f"{name}: canvas is even-sized (centre on a pixel edge)",
          img.width % 2 == 0 and img.height % 2 == 0)

# The edit prompts: one per variant, each naming only its feature.
check("a prompt per variant", set(rig_parts.VARIANTS) == {
    *(f"mouth_{m}" for m in rig_parts.MOUTHS), "eyes_half", "eyes_closed", "brows_up",
    "brows_angry"})
check("every variant's parts are template names",
      set(rig_parts.PART_OF.values()) <= template_names)

if FAILED:
    print(f"\n{len(FAILED)} failed")
    sys.exit(1)
print("\nall passed")
