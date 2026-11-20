"""Cut a Bust-with-face character into the parts the Rigger's `bust-face` template expects.

Rig templates T6 (docs/design/rig-templates.md §6). Input: one NEUTRAL bust on a plain
background and Qwen-Image-Edit VARIANTS of it, each changing one feature (a mouth shape, both
eyes half/closed, both brows up/angry). Output: one PNG per template part, named as the template
names it, so the folder uploads through Rigger ＋ New rig → Bust with face and attaches itself.

How a part is cut. A variant differs from the neutral only around its feature, so the changed
area IS the feature: align the variant to the neutral, diff them, keep the connected changes
where that feature lives (the mouth below the eyes, an eye or a brow per side). Every variant of
one feature shares ONE footprint, the union of all their changes, so any shape fully covers any
other when the Rigger swaps them; the neutral cut through that footprint is the rest shape
(`mouth_rest`, `brow_*_neutral`). A part is a PATCH: the feature plus the skin around it, which
covers what the head image shows beneath. The base split is cruder: `head` is everything above
the neck's narrowest row and `body` everything below; ears, hair, nose, eye whites and pupils stay
painted into the head (all optional in the template, so the rig reports them missing).

Where a part lands. The template places each image CENTRED on its slot's bone, with no offset
(`templateRig`), so each part is written on a canvas centred on its bone's position mapped into
the picture: the art then draws exactly where the neutral has it, wherever the bones are. The
picture is scaled so the eyes sit on the template's eye bones (`fit`), which keeps the template's
motion (jaw, gaze, brow travel) in proportion. The bone positions come from
`rig_templates/bust-face.json`, generated from the TypeScript template by
`tools/rigger-spike/template-art.mjs --write`, which also fails when the two drift.

Drawings by angle (docs/design/rig-2p5d.md §4.7, 2.5D P5). A 2.5D rig shows the drawing made for
the way a part faces as it turns: one more edit pass per TURN of the whole character (`turn_3q_r`,
`turn_side_r`, … and on a full turnaround `turn_3q_back_r`, `turn_back`, …) is cut at its own neck,
as the neutral is, into `head_<turn>` and `body_<turn>`, placed on the same bones at the same scale.
`_r` is made for the character facing the PICTURE's right (its own left). With `--mirror`, a turn
given for one side alone stands for the other too, flipped about its bone.

Pillow only (the service has no numpy): analysis runs on a downscaled copy, the cut at full size.

    py rig_parts.py --neutral bust.png --variant mouth_A=a.png --variant eyes_closed=c.png --out parts/
    py rig_parts.py --neutral bust.png --variant turn_3q_r=t.png --variant turn_side_r=s.png --mirror --out parts/
"""
from __future__ import annotations

import argparse
import json
import math
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

TEMPLATE_PATH = Path(__file__).resolve().parent / "rig_templates" / "bust-face.json"

KEEP = (
    " Keep everything else exactly the same: the same character, pose, framing, line work, "
    "colours and plain background. Change only that feature."
)

MOUTHS = {
    "A": "Open the mouth wide as if saying 'ah', showing the teeth and tongue.",
    "E": "Make the mouth say 'ee': lips stretched wide, teeth showing, only slightly open.",
    "O": "Make the mouth a round open 'oh' shape.",
    "U": "Make the mouth a small round pursed 'oo' shape, lips pushed forward.",
    "MBP": "Close the lips firmly pressed together, as when saying 'm'.",
    "FV": "Make the mouth say 'f': upper teeth resting on the lower lip.",
    "smile": "Make the mouth a closed happy smile.",
    "wide": "Make the mouth a wide open grin showing the teeth.",
}

# One Qwen-Image-Edit pass per variant: (feature group, edit instruction). Both eyes (and both
# brows) change in one pass and are split per side here, which is far more reliable than asking
# the model to touch one side only.
VARIANTS: dict[str, tuple[str, str]] = {
    **{f"mouth_{m}": ("mouth", text + KEEP) for m, text in MOUTHS.items()},
    "eyes_half": ("eyes", "Make both eyes half closed, the upper eyelids lowered halfway." + KEEP),
    "eyes_closed": ("eyes", "Close both eyes completely, gently, as in a blink." + KEEP),
    "brows_up": ("brows", "Raise both eyebrows high, surprised." + KEEP),
    "brows_angry": ("brows", "Lower both eyebrows and angle them down toward the nose, angry." + KEEP),
}

# Drawings by angle: one edit pass per turn of the whole character, cut at the neck into
# `head_<turn>` and `body_<turn>`. The back views are a full turnaround's (`--turnaround full`).
TURN_KEEP = (
    " Keep the same character, outfit, colours, line work, size and plain background, and keep the"
    " neck where it is in the picture: only the pose turns."
)


def _turn(view: str, side: str) -> str:
    own = {"right": "left", "left": "right"}[side]
    if view == "3q":
        return (f"Turn the character to a three-quarter view facing the {side} side of the picture"
                f" (turning toward their own {own}), head and shoulders together.")
    if view == "side":
        return (f"Turn the character to a full side profile facing the {side} side of the picture"
                f" (turned toward their own {own}), head and shoulders together.")
    return (f"Turn the character away from the viewer, three-quarters toward the {side} side of the"
            " picture: we see the back of the head and the shoulders, the face hidden.")


TURNS: dict[str, str] = {
    **{f"turn_{v}_{s[0]}": _turn(v, s) + TURN_KEEP
       for v in ("3q", "side") for s in ("right", "left")},
    **{f"turn_3q_back_{s[0]}": _turn("back", s) + TURN_KEEP for s in ("right", "left")},
    "turn_back": "Turn the character around to show its back: the back of the head and the"
                 " shoulders, facing away from the viewer." + TURN_KEEP,
}
BACK_TURNS = ("turn_3q_back_r", "turn_3q_back_l", "turn_back")
# A turn and the one it mirrors (`--mirror`).
MIRRORS = {a: b for x, y in (("turn_3q_r", "turn_3q_l"), ("turn_side_r", "turn_side_l"),
                             ("turn_3q_back_r", "turn_3q_back_l")) for a, b in ((x, y), (y, x))}
TURN_PARTS = ("head", "body")

# Which part each (variant, feature) becomes. `None` is the neutral image.
PART_OF: dict[tuple[str | None, str], str] = {
    **{(f"mouth_{m}", "mouth"): f"mouth_{m}" for m in MOUTHS},
    (None, "mouth"): "mouth_rest",
    **{(f"eyes_{v}", f"eye_{s}"): f"eyelid_{s}_{v}" for v in ("half", "closed") for s in "lr"},
    **{(f"brows_{v}", f"brow_{s}"): f"brow_{s}_{v}" for v in ("up", "angry") for s in "lr"},
    **{(None, f"brow_{s}"): f"brow_{s}_neutral" for s in "lr"},
}

FEATURES_OF = {"mouth": ["mouth"], "eyes": ["eye_l", "eye_r"], "brows": ["brow_l", "brow_r"]}


@dataclass
class Settings:
    analysis: int = 256  # long side of the analysis copy
    bg_tolerance: int = 24  # max channel distance from the border colour that is background
    diff_threshold: int = 36  # max channel difference that counts as a change
    min_area: float = 0.0004  # smallest kept change, as a fraction of the analysis image
    max_shift: int = 6  # alignment search radius, in analysis pixels
    pad: float = 0.012  # patch margin around a change, fraction of the long side
    feather: float = 0.006  # soft edge, fraction of the long side
    neck_overlap: float = 0.02  # head/body overlap at the neck, fraction of the height
    fit: str = "eyes"  # "eyes" (eyes on the eye bones) or "none" (1 px = 1 unit)
    mirror: bool = False  # a turn given for one side alone stands for the other, flipped
    neck_drift: float = 0.1  # how far a turn's neck may move, as a fraction of the height


@dataclass
class Comp:
    pixels: list[tuple[int, int]]
    box: tuple[int, int, int, int]  # x0, y0, x1, y1 (exclusive) in analysis pixels

    @property
    def area(self) -> int:
        return len(self.pixels)

    @property
    def cx(self) -> float:
        return (self.box[0] + self.box[2]) / 2

    @property
    def cy(self) -> float:
        return (self.box[1] + self.box[3]) / 2


@dataclass
class Report:
    template: str
    version: int
    scale: float
    parts: dict = field(default_factory=dict)
    missing: list[str] = field(default_factory=list)
    missing_required: list[str] = field(default_factory=list)
    variants: dict = field(default_factory=dict)
    turns: dict = field(default_factory=dict)
    mirrored: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def load_template(path: Path = TEMPLATE_PATH) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def flatten(img: Image.Image) -> Image.Image:
    """RGB over white: a transparent background reads as the plain background it stands for."""
    if img.mode in ("RGBA", "LA", "P"):
        rgba = img.convert("RGBA")
        base = Image.new("RGB", rgba.size, (255, 255, 255))
        base.paste(rgba, mask=rgba.getchannel("A"))
        return base
    return img.convert("RGB")


def channel_max_diff(a: Image.Image, b: Image.Image) -> Image.Image:
    """Per pixel, the largest of the three channel differences (L)."""
    r, g, bl = ImageChops.difference(a, b).split()
    return ImageChops.lighter(ImageChops.lighter(r, g), bl)


def foreground(img: Image.Image, tol: int) -> Image.Image:
    """255 on the character, 0 on the background reachable from the border (L)."""
    w, h = img.size
    px = img.load()
    border = [px[x, 0] for x in range(w)] + [px[x, h - 1] for x in range(w)]
    border += [px[0, y] for y in range(h)] + [px[w - 1, y] for y in range(h)]
    bg = tuple(sorted(c[i] for c in border)[len(border) // 2] for i in range(3))
    near = channel_max_diff(img, Image.new("RGB", img.size, bg)).point(
        lambda v: 255 if v <= tol else 0)
    seen = near.load()
    queue = deque()
    for x in range(w):
        for y in (0, h - 1):
            if seen[x, y] == 255:
                seen[x, y] = 128
                queue.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if seen[x, y] == 255:
                seen[x, y] = 128
                queue.append((x, y))
    while queue:
        x, y = queue.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and seen[nx, ny] == 255:
                seen[nx, ny] = 128
                queue.append((nx, ny))
    return near.point(lambda v: 0 if v == 128 else 255)


def shifted(img: Image.Image, dx: int, dy: int, fill) -> Image.Image:
    out = Image.new(img.mode, img.size, fill)
    out.paste(img, (dx, dy))
    return out


def best_shift(ref: Image.Image, img: Image.Image, radius: int,
               around: tuple[int, int] = (0, 0)) -> tuple[int, int]:
    """The integer translation of `img` that best matches `ref` (mean channel difference)."""
    ref_l, img_l = ref.convert("L"), img.convert("L")
    best, best_err = around, math.inf
    for dy in range(around[1] - radius, around[1] + radius + 1):
        for dx in range(around[0] - radius, around[0] + radius + 1):
            d = ImageChops.difference(ref_l, shifted(img_l, dx, dy, 255))
            err = sum(i * n for i, n in enumerate(d.histogram()))
            if err < best_err:
                best, best_err = (dx, dy), err
    return best


def components(mask: Image.Image, min_area: int) -> list[Comp]:
    """4-connected components of the 255 pixels, largest first."""
    w, h = mask.size
    src = mask.load()
    seen = bytearray(w * h)
    out: list[Comp] = []
    for y0 in range(h):
        for x0 in range(w):
            if src[x0, y0] != 255 or seen[y0 * w + x0]:
                continue
            seen[y0 * w + x0] = 1
            queue, pixels = deque([(x0, y0)]), []
            while queue:
                x, y = queue.popleft()
                pixels.append((x, y))
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < w and 0 <= ny < h and src[nx, ny] == 255 \
                            and not seen[ny * w + nx]:
                        seen[ny * w + nx] = 1
                        queue.append((nx, ny))
            if len(pixels) >= min_area:
                xs, ys = [p[0] for p in pixels], [p[1] for p in pixels]
                out.append(Comp(pixels, (min(xs), min(ys), max(xs) + 1, max(ys) + 1)))
    out.sort(key=lambda c: -c.area)
    return out


def pick(group: str, comps: list[Comp], eyes: dict[str, Comp]) -> dict[str, Comp]:
    """The change(s) that are this variant's feature; empty when it cannot tell."""
    if group == "mouth":
        if eyes:
            line = max(c.box[3] for c in eyes.values())
            left = min(c.box[0] for c in eyes.values())
            right = max(c.box[2] for c in eyes.values())
            comps = [c for c in comps if c.cy > line and left <= c.cx <= right]
        return {"mouth": comps[0]} if comps else {}
    if group == "brows" and eyes:
        top = min(c.box[1] for c in eyes.values())
        comps = [c for c in comps if c.cy < top]
    pair = comps[:2]
    if len(pair) < 2:
        return {}
    a, b = sorted(pair, key=lambda c: c.cx)
    if a.box[2] > b.box[0]:  # overlapping in x: one change across the face, not two sides
        return {}
    names = FEATURES_OF[group]
    return {names[0]: a, names[1]: b}


def neck_cut(img: Image.Image, s: Settings, k: float, aw: int, ah: int, start: int
             ) -> tuple[Image.Image, Image.Image, int, bool]:
    """Head above the neck's narrowest row (searched from analysis row `start` down) and body below,
    each a feathered alpha over the character at full size; that row, and whether the character
    reaches it."""
    W, H = img.size
    fg_small = foreground(img.resize((aw, ah), Image.BILINEAR), s.bg_tolerance)
    fg_full = fg_small.resize((W, H), Image.BILINEAR).filter(ImageFilter.GaussianBlur(1))
    fg_full = fg_full.point(lambda v: 255 if v >= 128 else 0).filter(ImageFilter.GaussianBlur(1))
    rows = [sum(1 for x in range(aw) if fg_small.getpixel((x, y))) for y in range(ah)]
    stop = max(start + 1, ah - ah // 20)
    neck_row = min(range(start, stop), key=lambda y: (rows[y] if rows[y] else aw + 1, y))
    neck_y = round(neck_row * k)
    overlap = max(2, round(s.neck_overlap * H))
    head_mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(head_mask).rectangle((0, 0, W, neck_y + overlap), fill=255)
    head_mask = head_mask.filter(ImageFilter.GaussianBlur(overlap / 2))
    body_mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(body_mask).rectangle((0, neck_y - overlap, W, H), fill=255)
    return (ImageChops.multiply(fg_full, head_mask), ImageChops.multiply(fg_full, body_mask),
            neck_row, bool(rows[neck_row]))


def scaled_box(box, k: float, w: int, h: int, pad: int) -> tuple[int, int, int, int]:
    return (max(0, int(box[0] * k) - pad), max(0, int(box[1] * k) - pad),
            min(w, math.ceil(box[2] * k) + pad), min(h, math.ceil(box[3] * k) + pad))


def cut(neutral_img: Image.Image, variant_imgs: dict[str, Image.Image],
        settings: Settings | None = None, template: dict | None = None
        ) -> tuple[dict[str, Image.Image], Report, dict[str, Image.Image]]:
    """Cut the parts. Returns (part name → canvas image, report, variant → reconstruction).

    `variant_imgs` holds feature edits (`VARIANTS`) and turns (`TURNS`)."""
    s = settings or Settings()
    tpl = template or load_template()
    neutral = flatten(neutral_img)
    W, H = neutral.size
    k = max(W, H) / s.analysis  # analysis → full size
    aw, ah = max(1, round(W / k)), max(1, round(H / k))
    small_n = neutral.resize((aw, ah), Image.BILINEAR)
    fg_small = foreground(small_n, s.bg_tolerance)
    fg_zone = fg_small.filter(ImageFilter.MaxFilter(5))
    min_area = max(4, int(s.min_area * aw * ah))
    report = Report(tpl["template"], tpl["version"], 1.0)

    aligned: dict[str, Image.Image] = {}
    picked: dict[str, dict[str, Comp]] = {}
    masks: dict[str, Image.Image] = {}
    turns = {n: img for n, img in variant_imgs.items() if n in TURNS}
    order = sorted((v for v in variant_imgs if v not in turns),
                   key=lambda v: VARIANTS.get(v, ("", ""))[0] != "eyes")
    eyes: dict[str, Comp] = {}
    for name in order:
        if name not in VARIANTS:
            report.warnings.append(f"{name}: not a variant this template uses — ignored")
            continue
        group = VARIANTS[name][0]
        img = flatten(variant_imgs[name])
        if img.size != neutral.size:
            img = img.resize(neutral.size, Image.LANCZOS)
        small_v = img.resize((aw, ah), Image.BILINEAR)
        dx, dy = best_shift(small_n, small_v, s.max_shift)
        fdx, fdy = round(dx * k), round(dy * k)
        if k > 1:  # refine at full size, on the middle of the picture to keep it cheap
            mid = (W // 4, H // 4, W - W // 4, H - H // 4)
            fdx, fdy = best_shift(neutral.crop(mid), img.crop(mid), math.ceil(k), (fdx, fdy))
        img = shifted(img, fdx, fdy, (255, 255, 255))
        small_v = img.resize((aw, ah), Image.BILINEAR)
        diff = channel_max_diff(small_n.filter(ImageFilter.GaussianBlur(1)),
                                small_v.filter(ImageFilter.GaussianBlur(1)))
        changed = ImageChops.multiply(
            diff.point(lambda v: 255 if v > s.diff_threshold else 0), fg_zone)
        changed = changed.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))
        comps = components(changed, min_area)
        chosen = pick(group, comps, eyes)
        total = sum(changed.histogram()[1:])
        kept = sum(c.area for c in chosen.values())
        fg_area = max(1, sum(fg_small.histogram()[1:]))
        report.variants[name] = {
            "shift": [fdx, fdy],
            "changed": round(total / fg_area, 4),
            "outside_feature": round((total - kept) / fg_area, 4),
            "found": sorted(chosen),
        }
        if not chosen:
            report.warnings.append(f"{name}: could not find the {group} change — no part cut")
            continue
        if report.variants[name]["outside_feature"] > 0.05:
            report.warnings.append(
                f"{name}: {report.variants[name]['outside_feature']:.0%} of the character "
                "changed away from the feature — the edit drifted; check it by eye")
        if group == "eyes" and not eyes:
            eyes = chosen
        aligned[name] = img
        picked[name] = chosen
        masks[name] = changed

    # One footprint per feature: the union of that feature's changes over all its variants.
    foot_small: dict[str, Image.Image] = {}
    for name, chosen in picked.items():
        for feature, comp in chosen.items():
            m = foot_small.setdefault(feature, Image.new("L", (aw, ah), 0))
            draw = m.load()
            for x, y in comp.pixels:
                draw[x, y] = 255
    pad_px = max(2, round(s.pad * max(W, H)))
    feather_px = max(1, round(s.feather * max(W, H)))
    footprints: dict[str, tuple[Image.Image, tuple[int, int, int, int]]] = {}
    for feature, m in foot_small.items():
        full = m.resize((W, H), Image.NEAREST)
        full = full.filter(ImageFilter.MaxFilter(2 * (pad_px // 2) + 1))
        full = full.filter(ImageFilter.GaussianBlur(feather_px))
        box = full.getbbox()
        if box:
            footprints[feature] = (full, box)

    # Base split: head above the neck's narrowest row, body below.
    face_bottom = 0
    if "mouth" in footprints:
        face_bottom = math.ceil(footprints["mouth"][1][3] / k)
    elif eyes:
        face_bottom = max(c.box[3] for c in eyes.values()) + ah // 8
    start = min(ah - 2, max(face_bottom, ah // 3))
    head_alpha, body_alpha, neck_row, found = neck_cut(neutral, s, k, aw, ah, start)
    if not found:
        report.warnings.append("no character found below the face — body not split")

    cuts: dict[str, tuple[Image.Image, Image.Image]] = {
        "head": (neutral, head_alpha),
        "body": (neutral, body_alpha),
    }
    # Drawings by angle: each turn cut at its own neck, searched from where the neutral's face ends.
    turn_previews: dict[str, Image.Image] = {}
    for name, turned in turns.items():
        img = flatten(turned)
        if img.size != neutral.size:
            img = img.resize(neutral.size, Image.LANCZOS)
        head_a, body_a, row, reached = neck_cut(img, s, k, aw, ah, start)
        suffix = name[len("turn_"):]
        cuts[f"head_{suffix}"] = (img, head_a)
        cuts[f"body_{suffix}"] = (img, body_a)
        report.turns[name] = {"neck": round(row * k), "neutral_neck": round(neck_row * k)}
        if not reached:
            report.warnings.append(f"{name}: no character found below the face — body not split")
        elif abs(row - neck_row) > s.neck_drift * ah:
            report.warnings.append(
                f"{name}: its neck is {abs(row - neck_row) * k:.0f} px from the neutral's — the turn"
                " moved the character; check it by eye")
        turn_previews[name] = Image.composite(img, Image.new("RGB", img.size, (40, 40, 40)),
                                              ImageChops.lighter(head_a, body_a))
    for (variant, feature), part in PART_OF.items():
        if feature not in footprints:
            continue
        if variant is None:
            src = neutral
        elif variant in picked and feature in picked[variant]:
            src = aligned[variant]
        else:
            continue
        cuts[part] = (src, footprints[feature][0])

    # Placement: scale so the eyes sit on the eye bones, anchored at the eyes' midpoint.
    bones = tpl["bones"]
    scale, anchor_img, anchor_world = 1.0, (W / 2, H), (0.0, 0.0)
    if s.fit == "eyes" and "eye_l" in footprints and "eye_r" in footprints:
        (lx0, ly0, lx1, ly1), (rx0, ry0, rx1, ry1) = (footprints["eye_l"][1],
                                                     footprints["eye_r"][1])
        lcx, rcx = (lx0 + lx1) / 2, (rx0 + rx1) / 2
        span = bones["eye_r"][0] - bones["eye_l"][0]
        if rcx - lcx > 1 and span > 0:
            scale = span / (rcx - lcx)
            anchor_img = ((lcx + rcx) / 2, (ly0 + ly1 + ry0 + ry1) / 4)
            anchor_world = ((bones["eye_l"][0] + bones["eye_r"][0]) / 2,
                            (bones["eye_l"][1] + bones["eye_r"][1]) / 2)
    elif s.fit == "eyes":
        report.warnings.append("no eyes found — placed at 1 px = 1 unit, bottom-centre on root")
    report.scale = round(scale, 6)

    slot_bone = {p["slot"]: p["bone"] for p in tpl["parts"]}
    out: dict[str, Image.Image] = {}
    for part in tpl["parts"]:
        name = part["name"]
        if name not in cuts:
            report.missing.append(name)
            if part["required"]:
                report.missing_required.append(name)
            continue
        src, alpha = cuts[name]
        box = alpha.getbbox()
        if not box:
            report.missing.append(name)
            if part["required"]:
                report.missing_required.append(name)
            continue
        rgba = src.convert("RGBA").crop(box)
        rgba.putalpha(alpha.crop(box))
        bx, by = bones[slot_bone[part["slot"]]]
        # The bone, in picture pixels (picture y runs down, the rig's runs up).
        u = anchor_img[0] + (bx - anchor_world[0]) / scale
        v = anchor_img[1] - (by - anchor_world[1]) / scale
        x0, y0 = (box[0] - u) * scale, (box[1] - v) * scale
        x1, y1 = (box[2] - u) * scale, (box[3] - v) * scale
        hw = math.ceil(max(-x0, x1, 1))
        hh = math.ceil(max(-y0, y1, 1))
        sw, sh = max(1, round((box[2] - box[0]) * scale)), max(1, round((box[3] - box[1]) * scale))
        if (sw, sh) != rgba.size:
            rgba = rgba.resize((sw, sh), Image.LANCZOS)
        canvas = Image.new("RGBA", (2 * hw, 2 * hh), (0, 0, 0, 0))
        canvas.paste(rgba, (round(x0 + hw), round(y0 + hh)))
        out[name] = canvas
        report.parts[name] = {
            "slot": part["slot"],
            "bone": slot_bone[part["slot"]],
            "from": [box[0], box[1], box[2], box[3]],
            "canvas": [2 * hw, 2 * hh],
        }

    # A turn given for one side alone stands for the other, flipped about its bone (the canvas is
    # centred on it).
    if s.mirror:
        for name, other in MIRRORS.items():
            if name not in turns or other in turns:
                continue
            for base in TURN_PARTS:
                src, dst = f"{base}_{name[len('turn_'):]}", f"{base}_{other[len('turn_'):]}"
                if src in out and dst not in out and dst in report.missing:
                    out[dst] = out[src].transpose(Image.FLIP_LEFT_RIGHT)
                    report.parts[dst] = {**report.parts[src], "mirrored_from": src}
                    report.missing.remove(dst)
                    report.mirrored.append(dst)

    previews: dict[str, Image.Image] = dict(turn_previews)
    for name in picked:
        recon = neutral.copy()
        for (variant, feature), part in PART_OF.items():
            if variant == name and part in cuts:
                src, alpha = cuts[part]
                recon.paste(src, (0, 0), alpha)
        previews[name] = recon
    return out, report, previews


def contact_sheet(neutral: Image.Image, variants: dict[str, Image.Image],
                  previews: dict[str, Image.Image], cell: int = 256) -> Image.Image:
    """Per variant: what the model drew, then the neutral with only the cut patches pasted in."""
    names = [n for n in variants if n in previews]
    sheet = Image.new("RGB", (cell * 2, cell * (len(names) + 1)), (40, 40, 40))
    draw = ImageDraw.Draw(sheet)

    def put(img: Image.Image, x: int, y: int, label: str) -> None:
        t = flatten(img).copy()
        t.thumbnail((cell, cell))
        sheet.paste(t, (x, y))
        draw.text((x + 4, y + 4), label, fill=(255, 0, 128))

    put(neutral, 0, 0, "neutral")
    for i, n in enumerate(names, start=1):
        put(variants[n], 0, i * cell, f"{n} (model)")
        put(previews[n], cell, i * cell, f"{n} ({'cut' if n in TURNS else 'neutral + cut'})")
    return sheet


def write(out_dir: Path, parts: dict[str, Image.Image], report: Report) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, img in parts.items():
        img.save(out_dir / f"{name}.png")
    (out_dir / "parts.json").write_text(json.dumps(report.__dict__, indent=2), encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--neutral", type=Path, help="required, except with --prompts")
    ap.add_argument("--variant", action="append", default=[], metavar="NAME=PATH",
                    help=f"one of: {', '.join([*VARIANTS, *TURNS])}")
    ap.add_argument("--out", type=Path, help="required, except with --prompts")
    ap.add_argument("--fit", choices=("eyes", "none"), default="eyes")
    ap.add_argument("--threshold", type=int, default=Settings.diff_threshold)
    ap.add_argument("--sheet", action="store_true", help="also write sheet.png (model vs cut)")
    ap.add_argument("--mirror", action="store_true",
                    help="a turn given for one side alone stands for the other, flipped")
    ap.add_argument("--prompts", action="store_true", help="print the edit prompts and exit")
    ap.add_argument("--turnaround", choices=("side", "full"), default="side",
                    help="with --prompts: a full turnaround adds the back views")
    args = ap.parse_args(argv)
    if args.prompts:
        turns = {k: v for k, v in TURNS.items() if args.turnaround == "full" or k not in BACK_TURNS}
        print(json.dumps({**{k: v[1] for k, v in VARIANTS.items()}, **turns}, indent=2))
        return 0
    if args.neutral is None or args.out is None:
        ap.error("--neutral and --out are required")
    variants = {}
    for spec in args.variant:
        name, _, path = spec.partition("=")
        variants[name] = Image.open(path)
    neutral = Image.open(args.neutral)
    parts, report, previews = cut(neutral, variants,
                                  Settings(fit=args.fit, diff_threshold=args.threshold,
                                           mirror=args.mirror))
    write(args.out, parts, report)
    if args.sheet:
        contact_sheet(neutral, variants, previews).save(args.out / "sheet.png")
    print(f"{len(parts)} parts -> {args.out}  (scale {report.scale})")
    for w in report.warnings:
        print(f"  ! {w}")
    if report.missing_required:
        print(f"  missing required: {', '.join(report.missing_required)}")
    return 1 if report.missing_required else 0


if __name__ == "__main__":
    raise SystemExit(main())
