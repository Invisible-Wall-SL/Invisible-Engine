"""Atlas composition (ported from the Atlas Maker's atlas_format.parse_atlas +
batch_atlas.fit_to_region + compose-only assembly). Pure Pillow + stdlib — no
ComfyUI. Pastes each region's image into the page canvas at the .atlas geometry."""
from __future__ import annotations

import io

from PIL import Image

_HEADER_KEYS = {"size", "filter", "format", "repeat", "scale", "pma"}
_REGION_KEYS = {"bounds", "offsets", "rotate", "xy", "size", "orig", "offset", "index", "split", "pad"}


def _nums(val: str) -> list[int]:
    out: list[int] = []
    for part in val.split(","):
        part = part.strip()
        try:
            out.append(int(round(float(part))))
        except ValueError:
            pass
    return out


def parse_atlas_text(text: str) -> dict:
    """Parse a libGDX/Spine `.atlas` (modern + legacy dialects). Returns
    {page:{image,width,height,scale}, regions:[{name,x,y,w,h,rotated,
    off_x,off_y,orig_w,orig_h}]}. First page only."""
    lines = text.splitlines()
    page = {"image": "", "width": 0, "height": 0, "scale": 1.0}
    regions: list[dict] = []
    cur: dict | None = None
    seen_region = False
    i = 0

    while i < len(lines) and not lines[i].strip():
        i += 1
    if i < len(lines):
        page["image"] = lines[i].strip()
        i += 1

    def flush(r: dict | None) -> None:
        if r is None:
            return
        if "bounds" in r:
            bx, by, bw, bh = (r["bounds"] + [0, 0, 0, 0])[:4]
            x, y, w, h = bx, by, bw, bh
            if "offsets" in r:
                ox, oy, ow, oh = (r["offsets"] + [0, 0, 0, 0])[:4]
            else:
                ox, oy, ow, oh = 0, 0, bw, bh
        else:
            x, y = (r.get("xy", [0, 0]) + [0, 0])[:2]
            w, h = (r.get("size", [0, 0]) + [0, 0])[:2]
            ow, oh = (r.get("orig", [w, h]) + [w, h])[:2]
            ox, oy = (r.get("offset", [0, 0]) + [0, 0])[:2]
        rot_raw = r.get("rotate")
        rotated = bool(rot_raw) and str(
            rot_raw[0] if isinstance(rot_raw, list) else rot_raw
        ).lower() not in ("0", "false")
        regions.append({
            "name": r["name"],
            "x": int(x), "y": int(y), "w": int(w), "h": int(h),
            "rotated": rotated,
            "off_x": int(ox), "off_y": int(oy),
            "orig_w": int(ow), "orig_h": int(oh),
        })

    while i < len(lines):
        line = lines[i].strip()
        i += 1
        if not line:
            continue
        if ":" in line:
            key, _, val = line.partition(":")
            key = key.strip().lower()
            val = val.strip()
            if not seen_region and key in _HEADER_KEYS:
                if key == "size":
                    n = _nums(val)
                    if len(n) >= 2:
                        page["width"], page["height"] = n[0], n[1]
                elif key == "scale":
                    try:
                        page["scale"] = float(val.split(",")[0])
                    except ValueError:
                        pass
                continue
            if cur is not None and key in _REGION_KEYS:
                if key == "rotate":
                    cur["rotate"] = [val]
                else:
                    cur[key] = _nums(val)
                continue
            continue
        flush(cur)
        cur = {"name": line}
        seen_region = True

    flush(cur)
    return {"page": page, "regions": regions}


def fit_to_region(img: Image.Image, region: dict, padding_pct: float = 0.12) -> Image.Image:
    """Place a region image into its packed slot (port of batch_atlas.fit_to_region):
    crop to alpha content, pad, scale (fill/contain/cover), rotate if rotated."""
    target_w, target_h = int(region["w"]), int(region["h"])
    spine_slot = "orig_w" in region and "orig_h" in region

    if img.mode != "RGBA":
        img = img.convert("RGBA")

    alpha_bbox = img.getchannel("A").getbbox()
    if alpha_bbox:
        img = img.crop(alpha_bbox)

    pad_w = max(0, int(round(img.width * padding_pct)))
    pad_h = max(0, int(round(img.height * padding_pct)))
    if pad_w or pad_h:
        padded = Image.new("RGBA", (img.width + 2 * pad_w, img.height + 2 * pad_h), (0, 0, 0, 0))
        padded.paste(img, (pad_w, pad_h), img)
        img = padded

    mode = str(region.get("fit_mode", "")).strip().lower() or ("fill" if spine_slot else "contain")
    cw, ch = img.size
    if mode == "fill":
        img = img.resize((target_w, target_h), Image.LANCZOS)
    elif mode == "cover":
        s = max(target_w / cw, target_h / ch)
        rw, rh = max(1, round(cw * s)), max(1, round(ch * s))
        img = img.resize((rw, rh), Image.LANCZOS)
        left, top = (rw - target_w) // 2, (rh - target_h) // 2
        img = img.crop((left, top, left + target_w, top + target_h))
    else:  # contain
        s = min(target_w / cw, target_h / ch)
        rw, rh = max(1, round(cw * s)), max(1, round(ch * s))
        scaled = img.resize((rw, rh), Image.LANCZOS)
        img = Image.new("RGBA", (target_w, target_h), (0, 0, 0, 0))
        img.paste(scaled, ((target_w - rw) // 2, (target_h - rh) // 2), scaled)

    if region.get("rotated"):
        img = img.rotate(90 if spine_slot else -90, expand=True)

    return img


def slice_atlas(atlas_text: str, source: Image.Image) -> dict[str, Image.Image]:
    """Cut the source page image into per-region crops (port of
    slice_atlas.slice_regions): on-page packed rect (swap w/h for rotated
    regions), then un-rotate so the saved crop is upright. Returns
    {region_name: cropped RGBA image}."""
    data = parse_atlas_text(atlas_text)
    src = source.convert("RGBA")
    sw, sh = src.size
    out: dict[str, Image.Image] = {}
    for r in data["regions"]:
        x, y, w, h = int(r["x"]), int(r["y"]), int(r["w"]), int(r["h"])
        rotated = bool(r["rotated"])
        pw, ph = (h, w) if rotated else (w, h)
        box = (max(0, x), max(0, y), min(sw, x + pw), min(sh, y + ph))
        if box[2] <= box[0] or box[3] <= box[1]:
            continue
        crop = src.crop(box)
        if rotated:
            crop = crop.rotate(-90, expand=True)
        out[r["name"]] = crop
    return out


def compose(atlas_text: str, images: dict[str, Image.Image], padding_pct: float = 0.12):
    """Assemble the atlas: a transparent page-sized canvas with each provided
    region image fit + pasted at its .atlas (x, y). Returns (png_bytes,
    webp_bytes, placed_count)."""
    data = parse_atlas_text(atlas_text)
    page = data["page"]
    canvas = Image.new("RGBA", (page["width"], page["height"]), (0, 0, 0, 0))
    placed = 0
    for region in data["regions"]:
        img = images.get(region["name"])
        if img is None:
            continue
        fitted = fit_to_region(img, region, padding_pct)
        canvas.paste(fitted, (int(region["x"]), int(region["y"])), fitted)
        placed += 1

    png = io.BytesIO()
    canvas.save(png, "PNG")
    webp = io.BytesIO()
    canvas.save(webp, "WEBP", quality=95)
    return png.getvalue(), webp.getvalue(), placed
