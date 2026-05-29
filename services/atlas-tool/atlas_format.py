"""
Spine / libGDX `.atlas` adapter.

A `.atlas` file is an external-tool-generated region map (Spine, TexturePacker,
libGDX). It is the authoritative geometry for an atlas: per-region packed
rectangle, trim offsets and rotation. This module parses it into the same
region shape `batch_atlas.py` already consumes, and can write one back out
(for "make an .atlas if needed" when a project only has a cutting grid).

Two on-disk dialects are tolerated:

  modern (Spine 4.x, what HotFruits ships):
      page.webp
      size:1969,1222
      filter:Linear,Linear
      scale:0.3
      10x
      bounds:1899,1042,81,68          # x, y, w, h  (packed rect on page)
      offsets:23,17,120,98            # offX, offY, origW, origH  (trim)
      rotate:90                       # present => stored rotated 90 deg

  legacy (libGDX <=4.0 / TexturePacker default):
      page.png
      size: 1024,1024
      filter: Linear,Linear
      regionname
        rotate: false
        xy: 1, 1
        size: 100, 50
        orig: 110, 60
        offset: 5, 5
        index: -1

Normalized region dict (matches the tool's existing convention — `w`/`h` are
the display size, `rotated` lets `fit_to_region` swap+rotate when placing):

    {name, x, y, w, h, rotated, off_x, off_y, orig_w, orig_h}
"""

from __future__ import annotations

from pathlib import Path

_HEADER_KEYS = {"size", "filter", "format", "repeat", "scale", "pma"}
_REGION_KEYS = {
    "bounds", "offsets", "rotate", "xy", "size", "orig", "offset", "index", "split", "pad",
}


def _nums(val: str) -> list[int]:
    out = []
    for part in val.split(","):
        part = part.strip()
        try:
            out.append(int(round(float(part))))
        except ValueError:
            pass
    return out


def parse_atlas(path: str | Path) -> dict:
    """Parse a `.atlas` file. Returns:

        {
          "page": {"image": str, "width": int, "height": int, "scale": float},
          "regions": [ {name,x,y,w,h,rotated,off_x,off_y,orig_w,orig_h}, ... ],
        }

    Only the first page is read (the tool composes one image per atlas).
    """
    path = Path(path)
    lines = path.read_text(encoding="utf-8").splitlines()

    page = {"image": "", "width": 0, "height": 0, "scale": 1.0}
    regions: list[dict] = []
    cur: dict | None = None
    seen_region = False
    i = 0

    # Leading blank lines, then first non-empty line is the page image name.
    while i < len(lines) and not lines[i].strip():
        i += 1
    if i < len(lines):
        page["image"] = lines[i].strip()
        i += 1

    def flush(r: dict | None) -> None:
        if r is None:
            return
        # modern: bounds:x,y,w,h  offsets:offX,offY,origW,origH
        if "bounds" in r:
            bx, by, bw, bh = (r["bounds"] + [0, 0, 0, 0])[:4]
            x, y, w, h = bx, by, bw, bh
            if "offsets" in r:
                ox, oy, ow, oh = (r["offsets"] + [0, 0, 0, 0])[:4]
            else:
                ox, oy, ow, oh = 0, 0, bw, bh
        else:
            # legacy: xy:x,y  size:w,h  orig:ow,oh  offset:ox,oy
            x, y = (r.get("xy", [0, 0]) + [0, 0])[:2]
            w, h = (r.get("size", [0, 0]) + [0, 0])[:2]
            ow, oh = (r.get("orig", [w, h]) + [w, h])[:2]
            ox, oy = (r.get("offset", [0, 0]) + [0, 0])[:2]
        rot_raw = r.get("rotate")
        rotated = bool(rot_raw) and str(rot_raw[0] if isinstance(rot_raw, list) else rot_raw).lower() not in ("0", "false")
        regions.append({
            "name": r["name"],
            "x": int(x), "y": int(y), "w": int(w), "h": int(h),
            "rotated": rotated,
            "off_x": int(ox), "off_y": int(oy),
            "orig_w": int(ow), "orig_h": int(oh),
        })

    while i < len(lines):
        raw = lines[i]
        i += 1
        line = raw.strip()
        if not line:
            continue  # blank line precedes a new page; we keep only page 1
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
                    cur["rotate"] = cur.get("rotate")
                    cur[key] = _nums(val)
                continue
            # Unknown colon line inside a region body — ignore.
            continue
        # No colon => region name (or another page image, which we stop at).
        if seen_region or cur is not None:
            # If we already have regions and hit a bare line after a blank,
            # it could be a second page image; safest is to treat any bare
            # line as a new region name (multi-page atlases are rare here).
            pass
        flush(cur)
        cur = {"name": line}
        seen_region = True

    flush(cur)
    return {"page": page, "regions": regions}


def is_atlas_file(path: str | Path) -> bool:
    return str(path).lower().endswith(".atlas")


def write_atlas(path: str | Path, page: dict, regions: list[dict]) -> None:
    """Emit a modern (Spine 4.x) `.atlas`. Used to synthesize a geometry file
    for a project that only has a cutting grid ("make an .atlas if needed").

    `regions` items use the normalized shape returned by parse_atlas.
    """
    path = Path(path)
    out: list[str] = []
    out.append(page.get("image", path.with_suffix(".webp").name))
    out.append(f"size:{int(page.get('width', 0))},{int(page.get('height', 0))}")
    out.append(f"filter:{page.get('filter', 'Linear,Linear')}")
    scale = page.get("scale", 1.0)
    if scale and scale != 1.0:
        out.append(f"scale:{scale}")
    for r in regions:
        out.append(r["name"])
        out.append(f"bounds:{int(r['x'])},{int(r['y'])},{int(r['w'])},{int(r['h'])}")
        ow = int(r.get("orig_w", r["w"]))
        oh = int(r.get("orig_h", r["h"]))
        ox = int(r.get("off_x", 0))
        oy = int(r.get("off_y", 0))
        if (ox, oy, ow, oh) != (0, 0, int(r["w"]), int(r["h"])):
            out.append(f"offsets:{ox},{oy},{ow},{oh}")
        if r.get("rotated"):
            out.append("rotate:90")
    path.write_text("\n".join(out) + "\n", encoding="utf-8")


if __name__ == "__main__":
    import json
    import sys

    data = parse_atlas(sys.argv[1])
    print(f"page: {data['page']}")
    print(f"regions: {len(data['regions'])}")
    print(json.dumps(data["regions"][:5], indent=2))
