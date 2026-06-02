"""
Local (no-ComfyUI) image derivations for FX regions.

These are deterministic pixel ops, so the tool builds them on the CPU and
binds the result as the region's output_override (the "use my image — not
processed" path); Create Atlas then places it through the normal fit/compose
so it stays pixel-consistent with its source.

  shine    extract the bright/specular pixels of the source into an RGBA
           highlight layer (rest alpha 0, optional ghost floor) — meant to
           be additively composited on top of its base in-engine for an
           animated "glints catching the light" effect
  glow     base glyph + a blurred, tinted additive halo grown from its alpha
           silhouette (was previously named 'shine')
  shadow   a blurred, offsettable dark (or tinted) silhouette blob — no glyph
  colour   recolour the source: blend its RGB toward a chosen colour, alpha
           kept (amount 1 = solid tint silhouette; <1 = partial overlay)
"""

from __future__ import annotations

from PIL import Image, ImageChops, ImageFilter

# UI-facing defaults + safe ranges (min, max). The card builds inputs from
# this and stores the chosen values per region in manifest region["fx"][mode].
#
# SHINE = selective highlight extraction (new). Reads the source's RGB and
# keeps only the pixels above `threshold` luminance, with a soft falloff over
# `softness`. The output's RGB matches the source (optionally boosted on
# bright pixels); its alpha is the shine mask × source alpha. `base_alpha_floor`
# leaves a faint ghost of the silhouette so the layer composites cleanly even
# where there's no highlight.
SHINE_DEFAULTS = {
    "threshold": 180,        # luminance cutoff (0..255). below = transparent
    "softness": 50,          # rolloff width above threshold (1..128)
    "boost": 1.4,            # brightness multiplier on shine pixels (1..3)
    "overlay": 0.0,          # blend original base UNDER the shine (0..1).
                             # 0 = pure highlight extraction; 1 = base fully
                             # visible with shine brightening on top
    "base_alpha_floor": 0,   # min alpha inside silhouette ("ghost", 0..96)
    "blur": 1.0,             # edge smoothing on the mask (0..6 px @256ref)
}
SHINE_RANGES = {
    "threshold": (0, 255),
    "softness": (1, 128),
    "boost": (1.0, 3.0),
    "overlay": (0.0, 1.0),
    "base_alpha_floor": (0, 96),
    "blur": (0.0, 6.0),
}

# GLOW = the original "shine": base glyph + halo grown from alpha silhouette.
GLOW_DEFAULTS = {
    "color": "#ffaa28",   # glow tint (hex)
    "blur": 16.0,         # glow size / softness  (0.5 .. 60)
    "intensity": 1.9,     # glow amount / brightness (0.1 .. 6)
    "layers": 2,          # bloom build-up (1 .. 6)
}
GLOW_RANGES = {
    "blur": (0.5, 60.0),
    "intensity": (0.1, 6.0),
    "layers": (1, 6),
}

SHADOW_DEFAULTS = {
    "color": "#000000",   # shadow tint (hex)
    "blur": 14.0,         # softness (0 .. 60)
    "opacity": 0.55,      # 0 .. 1
    "offset_x": 0,        # px, +right (relative to a ~256px subject)
    "offset_y": 8,        # px, +down
}
SHADOW_RANGES = {
    "blur": (0.0, 60.0),
    "opacity": (0.0, 1.0),
    "offset_x": (-128, 128),
    "offset_y": (-128, 128),
}

# BLUR = soften the source. `kind` picks the shape: gaussian is the standard
# 2D blur; horizontal/vertical are 1D directional (smear along one axis);
# box is a uniform box-blur (harsher, retro look). `preserve_alpha` keeps the
# silhouette crisp and only smears RGB (so colours bleed but the shape stays
# sharp) — handy on alpha-cutout sprites.
BLUR_KINDS = ["gaussian", "horizontal", "vertical", "box"]
BLUR_DEFAULTS = {
    "kind": "gaussian",
    "radius": 6.0,         # px @256ref (0.5 .. 60)
    "preserve_alpha": 0,   # 0 = blur full RGBA; 1 = keep silhouette sharp
}
BLUR_RANGES = {
    "radius": (0.5, 60.0),
    "preserve_alpha": (0, 1),
}

# ZOOM = radial / zoom blur. Stacks `steps` copies of the source, each
# slightly more zoomed toward (cx, cy), and averages them — the classic
# "lens-zoom during exposure" burst. Centre is normalized (0..1); preserve_alpha
# keeps the original silhouette sharp while the colours radiate.
ZOOM_DEFAULTS = {
    "amount": 0.08,        # max zoom fraction at the outer step (0..0.5)
    "steps": 12,           # number of blended frames (2..32)
    "cx": 0.5,             # zoom centre, normalised X (0..1)
    "cy": 0.5,             # zoom centre, normalised Y (0..1)
    "preserve_alpha": 0,
}
ZOOM_RANGES = {
    "amount": (0.0, 0.5),
    "steps": (2, 32),
    "cx": (0.0, 1.0),
    "cy": (0.0, 1.0),
    "preserve_alpha": (0, 1),
}

# Photoshop-style blend modes for the colour overlay. "overlay" keeps the
# source's shading/texture (its luminance & contrast) while pushing it toward
# the target colour — the classic look. "tint" is the old flat behaviour.
COLOUR_BLENDS = ["overlay", "soft_light", "hard_light",
                 "multiply", "screen", "tint"]
COLOUR_DEFAULTS = {
    "color": "#ff5050",      # overlay colour (hex)
    "blend": "overlay",      # blend mode (see COLOUR_BLENDS)
    "amount": 1.0,           # overlay-layer opacity: 0 = original, 1 = full
}
COLOUR_RANGES = {
    "amount": (0.0, 1.0),
}

# mode -> (defaults, ranges) so the UI/server can drive every local FX mode
# from one table.
FX_PRESETS = {
    "shine": (SHINE_DEFAULTS, SHINE_RANGES),
    "glow": (GLOW_DEFAULTS, GLOW_RANGES),
    "shadow": (SHADOW_DEFAULTS, SHADOW_RANGES),
    "colour": (COLOUR_DEFAULTS, COLOUR_RANGES),
    "blur": (BLUR_DEFAULTS, BLUR_RANGES),
    "zoom": (ZOOM_DEFAULTS, ZOOM_RANGES),
}

# Canonical FX-naming convention: a region named `<base><suffix>` is an FX
# layer DERIVED LOCALLY from its base region (not AI-generated). This map is
# exactly the suffix set ui_server._fx_source already loops over — keep the two
# in sync (TODO: have _fx_source iterate FX_SUFFIX_MODE instead of its own
# hard-coded tuple).
FX_SUFFIX_MODE = {
    "_shine": "shine",
    "_glow": "glow",
    "_shadow": "shadow",
    "_blur": "blur",
    "_zoom": "zoom",
}


def fx_layer_info(name: str) -> "dict | None":
    """Canonical FX-naming classifier.

    If ``name`` ends in one of the FX suffixes (see FX_SUFFIX_MODE), return
    ``{"suffix": <suffix>, "base": <name minus suffix>, "mode": <fx mode>}``;
    otherwise ``None``. The suffixes don't overlap, so longest-match isn't a
    concern — we iterate deterministically over the map.

    This is the single source of truth for "is this region an FX layer of a
    base element?", reused by the diagnostics today and intended for future
    automated-FX features (e.g. auto-rebuilding FX layers when their base is
    regenerated). Pure string ops; no PIL / IO.
    """
    for suffix, mode in FX_SUFFIX_MODE.items():
        if name.endswith(suffix):
            return {"suffix": suffix, "base": name[: -len(suffix)], "mode": mode}
    return None


def hex_to_rgb(s: str) -> tuple[int, int, int]:
    s = str(s).strip().lstrip("#")
    if len(s) == 3:
        s = "".join(c * 2 for c in s)
    try:
        return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16))
    except (ValueError, IndexError):
        return (255, 170, 40)


def make_glow(
    base: Image.Image,
    *,
    color: tuple[int, int, int] = (255, 170, 40),
    blur: float = 16.0,
    intensity: float = 1.9,
    layers: int = 2,
) -> Image.Image:
    """Return base + a colored halo grown from its alpha silhouette.

    The output is EXACTLY the same dimensions as the base, with the glyph in
    the same position — so the glow and its base register/scale identically
    through Create Atlas (no resize, no smaller-than-base). The halo blooms
    into the base image's existing transparent margin (SDXL/atlas-slice art
    has ample); it's intentionally clipped at the canvas edge rather than
    enlarging the image.

    color     glow tint (default warm gold/orange)
    blur      Gaussian radius of the glow (relative to a ~256px subject)
    intensity glow opacity multiplier (clamped at 255)
    layers    stack the blurred glow N times for a brighter bloom
    """
    base = base.convert("RGBA")
    alpha = base.split()[-1]
    radius = max(1.0, blur * (max(base.size) / 256.0))
    glow_mask = alpha.filter(ImageFilter.GaussianBlur(radius))
    glow_mask = glow_mask.point(lambda p: min(255, int(p * intensity)))

    out = Image.new("RGBA", base.size, (0, 0, 0, 0))
    solid = Image.new("RGBA", base.size, (*color, 0))
    for _ in range(max(1, layers)):
        layer = solid.copy()
        layer.putalpha(glow_mask)
        out = Image.alpha_composite(out, layer)

    out = Image.alpha_composite(out, base)  # crisp base on top of its glow
    return out


def make_shine(
    base: Image.Image,
    *,
    threshold: int = 180,
    softness: int = 50,
    boost: float = 1.4,
    overlay: float = 0.0,
    base_alpha_floor: int = 0,
    blur: float = 1.0,
) -> Image.Image:
    """Return an RGBA highlight layer extracted from the base's bright pixels.

    Same dimensions and registration as the base. The source's RGB is kept;
    alpha is built from per-pixel luminance — pixels at or below `threshold`
    fall to (near-)zero alpha, pixels above ramp up over `softness` to fully
    opaque. The result is meant to be additively composited on top of the
    base in-engine, so only the glints / metal / gem highlights "shine"
    while the silhouette underneath remains the original.

    threshold         luminance cutoff (0..255). Pixels at/below ≈ transparent.
    softness          width of the rolloff above threshold (1..128). Larger
                      = softer transition between dark and bright.
    boost             brightness multiplier applied to shine pixels (1..3).
                      1 leaves RGB untouched; >1 pushes highlights brighter.
    overlay           keep the original base visible UNDER the shine (0..1).
                      0 = pure highlight extraction (default); 1 = the base
                      is fully composited beneath, so the result is the
                      original symbol with the highlight bump on top —
                      useful when the engine swaps frames rather than
                      blending an extra layer.
    base_alpha_floor  minimum alpha inside the source's silhouette (0..96).
                      Leaves a faint "ghost" mid-tone; 0 = no ghost. Stacks
                      with `overlay` (the higher of the two wins per pixel).
    blur              gaussian smoothing of the mask in px @256ref (0..6).
                      Cleans up speckle from noisy AI renders.
    """
    base = base.convert("RGBA")
    r, g, b, src_alpha = base.split()
    # Luminance (Rec. 601 weights — what PIL's "L" conversion uses).
    lum = Image.merge("RGB", (r, g, b)).convert("L")

    thr = max(0, min(255, int(threshold)))
    soft = max(1, int(softness))
    # Ramp: 0 at threshold, 255 at threshold+softness, clamped.
    shine_mask = lum.point(
        lambda p: 0 if p <= thr else min(255, int((p - thr) * 255 / soft)))

    if blur and blur > 0:
        radius = float(blur) * (max(base.size) / 256.0)
        shine_mask = shine_mask.filter(ImageFilter.GaussianBlur(radius))

    # Multiply by the source's own alpha so we never invent pixels outside
    # the original silhouette (e.g. fully-transparent border stays transparent).
    shine_mask = ImageChops.multiply(shine_mask, src_alpha)

    # Optional ghost: a low-alpha copy of the silhouette underneath, so the
    # layer carries a faint mid-tone wash on top of the pure highlight.
    floor = max(0, min(255, int(base_alpha_floor)))
    if floor > 0:
        ghost = src_alpha.point(lambda p: min(floor, p))
        out_alpha = ImageChops.lighter(shine_mask, ghost)
    else:
        out_alpha = shine_mask

    # Optionally boost the RGB of the bright pixels (driven by the mask, so
    # the boost falls off where shine_mask falls off — no edge artifacts).
    if boost and boost > 1.0:
        amt = float(boost) - 1.0  # extra fraction beyond original
        def _boost(channel: Image.Image) -> Image.Image:
            # new = ch + (255 - ch) * amt * (mask/255)
            head = ImageChops.subtract(Image.new("L", base.size, 255), channel)
            head = ImageChops.multiply(
                head, shine_mask.point(lambda p: int(p * amt)))
            return ImageChops.add(channel, head)
        r, g, b = _boost(r), _boost(g), _boost(b)

    shine_layer = Image.merge("RGBA", (r, g, b, out_alpha))

    # Optional base overlay: composite the original base UNDER the shine,
    # scaling base alpha by `overlay`. At 0 we return the pure shine layer;
    # at 1 the base shows through fully and the shine just brightens it.
    ov = max(0.0, min(1.0, float(overlay)))
    if ov <= 0:
        return shine_layer
    base_under = base.copy()
    if ov < 1:
        scaled = src_alpha.point(lambda p: int(p * ov))
        base_under.putalpha(scaled)
    return Image.alpha_composite(base_under, shine_layer)


def make_shadow(
    base: Image.Image,
    *,
    color: tuple[int, int, int] = (0, 0, 0),
    blur: float = 14.0,
    opacity: float = 0.55,
    offset_x: int = 0,
    offset_y: int = 8,
) -> Image.Image:
    """Return ONLY a soft shadow blob of the base's alpha silhouette.

    Same canvas size & registration as the base (so it composes into the slot
    exactly like its source). The silhouette is filled with `color`, blurred,
    scaled to `opacity`, and shifted by (offset_x, offset_y) — both the blur
    radius and the offset scale with the subject so they look consistent
    regardless of source resolution. No glyph is drawn (it's a drop shadow
    layer, used on its own FX region).
    """
    base = base.convert("RGBA")
    alpha = base.split()[-1]
    scale = max(base.size) / 256.0
    radius = max(0.0, blur * scale)
    mask = alpha.filter(ImageFilter.GaussianBlur(radius)) if radius > 0 else alpha
    op = max(0.0, min(1.0, opacity))
    mask = mask.point(lambda p: int(p * op))

    out = Image.new("RGBA", base.size, (0, 0, 0, 0))
    solid = Image.new("RGBA", base.size, (*color, 0))
    solid.putalpha(mask)
    dx, dy = int(round(offset_x * scale)), int(round(offset_y * scale))
    out.paste(solid, (dx, dy), solid)
    return out


def make_recolour(
    base: Image.Image,
    *,
    color: tuple[int, int, int] = (255, 80, 80),
    amount: float = 1.0,
    blend: str = "overlay",
) -> Image.Image:
    """Composite a solid `color` layer over the base with a Photoshop-style
    blend mode, keeping the base's alpha unchanged.

    `blend`:
      overlay/soft_light/hard_light  — keep the source's shading & texture
        (its luminance/contrast) while pushing the hue toward `color`. This
        is the classic "colour overlay" look (texture preserved).
      multiply  — darken toward the colour;  screen — lighten toward it.
      tint      — the old flat behaviour (fade to a solid colour; at
        amount 1 it's a single-colour silhouette, texture lost).
    `amount` is the overlay-layer opacity: 0 = original, 1 = full effect.
    Anti-aliased edges are preserved (alpha is never touched).
    """
    base = base.convert("RGBA")
    a = max(0.0, min(1.0, float(amount)))
    r, g, b, alpha = base.split()
    if a <= 0:
        return base
    rgb = Image.merge("RGB", (r, g, b))
    solid = Image.new("RGB", base.size, tuple(color))
    m = str(blend).strip().lower()
    if m == "tint":
        blended = solid
    elif m == "multiply":
        blended = ImageChops.multiply(rgb, solid)
    elif m == "screen":
        blended = ImageChops.screen(rgb, solid)
    elif m == "soft_light":
        blended = ImageChops.soft_light(rgb, solid)
    elif m == "hard_light":
        blended = ImageChops.hard_light(rgb, solid)
    else:  # overlay (default)
        blended = ImageChops.overlay(rgb, solid)
    out = Image.blend(rgb, blended, a) if a < 1 else blended
    nr, ng, nb = out.split()
    return Image.merge("RGBA", (nr, ng, nb, alpha))


def _directional_blur(img: Image.Image, radius: float, axis: str) -> Image.Image:
    """1D blur in PIL — there's no native directional gaussian, so we squash
    the image along the blur axis (so the BILINEAR resize acts as a wide box
    filter only in that axis), blur lightly to smooth the box edges, and
    stretch back. The squash factor scales with `radius` so user intent is
    respected (bigger radius → squash harder → wider smear)."""
    W, H = img.size
    # BILINEAR resize ≈ box blur of half the down-factor along the squashed
    # axis. We want the effective smear ≈ radius, so factor ≈ 2*radius.
    factor = max(2, int(round(radius * 2)))
    if axis == "horizontal":
        sw, sh = max(1, W // factor), H
    else:  # vertical
        sw, sh = W, max(1, H // factor)
    small = img.resize((sw, sh), Image.BILINEAR)
    # Light extra gaussian to soften resampling boxiness — keep it sub-px on
    # the small image so it doesn't dominate over the squash-driven smear.
    blurred = small.filter(ImageFilter.GaussianBlur(0.6))
    return blurred.resize((W, H), Image.BILINEAR)


def make_blur(
    base: Image.Image,
    *,
    kind: str = "gaussian",
    radius: float = 6.0,
    preserve_alpha: int = 0,
) -> Image.Image:
    """Soften the source with one of several blur kinds.

    Output keeps the source's canvas size and registration.

    kind            'gaussian' (2D symmetric), 'horizontal' / 'vertical'
                    (1D directional smear), or 'box' (uniform box blur —
                    harsher edges, retro look).
    radius          blur radius in px scaled to a 256px reference (0.5..60).
    preserve_alpha  if non-zero, blur RGB only and keep the original alpha
                    so the silhouette stays crisp — colours smear inside
                    the shape without feathering the outline.
    """
    base = base.convert("RGBA")
    r_px = max(0.1, float(radius) * (max(base.size) / 256.0))
    k = str(kind).strip().lower()

    if k == "horizontal":
        blurred = _directional_blur(base, r_px, "horizontal")
    elif k == "vertical":
        blurred = _directional_blur(base, r_px, "vertical")
    elif k == "box":
        blurred = base.filter(ImageFilter.BoxBlur(r_px))
    else:  # gaussian (default)
        blurred = base.filter(ImageFilter.GaussianBlur(r_px))

    if int(preserve_alpha or 0):
        r, g, b, _ = blurred.split()
        alpha = base.split()[-1]
        blurred = Image.merge("RGBA", (r, g, b, alpha))
    return blurred


def make_zoom(
    base: Image.Image,
    *,
    amount: float = 0.08,
    steps: int = 12,
    cx: float = 0.5,
    cy: float = 0.5,
    preserve_alpha: int = 0,
) -> Image.Image:
    """Radial zoom blur — average of N copies of the source, each progressively
    more zoomed toward (cx, cy). Simulates a camera lens zooming during
    exposure (the burst look).

    amount          max zoom fraction at the outer step (0..0.5). 0.08 ≈ 8%.
    steps           number of frames to blend (2..32). More = smoother but
                    slower; defaults to 12.
    cx, cy          zoom centre as a fraction of the canvas (0..1). 0.5/0.5
                    is the middle. Use e.g. 0.2/0.2 for an off-centre burst.
    preserve_alpha  if non-zero, keep the original alpha so the silhouette
                    stays crisp while the colours streak outward.
    """
    base = base.convert("RGBA")
    W, H = base.size
    n = max(2, int(steps))
    amt = max(0.0, float(amount))
    if amt <= 0:
        return base

    cxp = float(cx) * W   # zoom centre in original-pixel coords
    cyp = float(cy) * H

    acc = None
    for i in range(n):
        s = 1.0 + amt * (i / (n - 1))  # 1.0 .. 1+amt across steps
        new_w = max(1, int(round(W * s)))
        new_h = max(1, int(round(H * s)))
        scaled = base.resize((new_w, new_h), Image.BILINEAR)
        # Window so the original (cxp, cyp) pixel ends up at (cxp, cyp).
        left = int(round(cxp * (s - 1)))
        top = int(round(cyp * (s - 1)))
        cropped = scaled.crop((left, top, left + W, top + H))
        # Equal-weight running average via Image.blend: blending fi at weight
        # 1/(i+1) on top of the running mean of the first i frames gives the
        # mean of all i+1 frames (by induction).
        if acc is None:
            acc = cropped
        else:
            acc = Image.blend(acc, cropped, 1.0 / (i + 1))

    out = acc if acc is not None else base
    if int(preserve_alpha or 0):
        r, g, b, _ = out.split()
        alpha = base.split()[-1]
        out = Image.merge("RGBA", (r, g, b, alpha))
    return out


if __name__ == "__main__":
    import sys

    src, dst = sys.argv[1], sys.argv[2]
    make_shine(Image.open(src)).save(dst)
    print(f"shine -> {dst}")
