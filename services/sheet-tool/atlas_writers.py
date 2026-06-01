"""
Coordinate-file emitters for the Invisible Sheet Maker.

Three outputs, any combination selectable per export:

  * libGDX / Spine 4.x `.atlas`   — text region map (game engines / Spine)
  * TexturePacker JSON (hash)      — PixiJS / Phaser native loader format
  * Invisible AI manifest          — atlas_manifest_<name>.json, the enriched
                                     map the Invisible Atlas Maker consumes
                                     (regions carry prompt / shape_ref / seed /
                                     per-region AI overrides)

Region dicts use the normalized shape from packer.py:
    {name, x, y, w, h, rotated, off_x, off_y, orig_w, orig_h}
"""

from __future__ import annotations

import json
from pathlib import Path


# ---------------------------------------------------------------------------
# libGDX / Spine 4.x .atlas
# ---------------------------------------------------------------------------

def write_libgdx_atlas(path: str | Path, image_name: str,
                       width: int, height: int, regions: list[dict],
                       filter_: str = "Linear,Linear") -> None:
    """Emit a modern (Spine 4.x) `.atlas`. Mirrors the Atlas Maker's
    atlas_format.write_atlas so a round-trip parses cleanly."""
    out: list[str] = [image_name, f"size:{int(width)},{int(height)}", f"filter:{filter_}"]
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
    Path(path).write_text("\n".join(out) + "\n", encoding="utf-8")


# ---------------------------------------------------------------------------
# TexturePacker JSON (hash) — PixiJS / Phaser
# ---------------------------------------------------------------------------

def write_texturepacker_json(path: str | Path, image_name: str,
                             width: int, height: int, regions: list[dict]) -> None:
    """Emit a TexturePacker JSON-hash file. When a region is rotated the
    `frame` w/h are swapped (the on-sheet footprint) while sourceSize keeps
    the display size — the convention PixiJS / Phaser expect."""
    frames: dict[str, dict] = {}
    for r in regions:
        dw, dh = int(r["w"]), int(r["h"])
        rotated = bool(r.get("rotated"))
        fw, fh = (dh, dw) if rotated else (dw, dh)
        key = r["name"] if "." in r["name"] else f"{r['name']}.png"
        frames[key] = {
            "frame": {"x": int(r["x"]), "y": int(r["y"]), "w": fw, "h": fh},
            "rotated": rotated,
            "trimmed": False,
            "spriteSourceSize": {"x": int(r.get("off_x", 0)), "y": int(r.get("off_y", 0)),
                                 "w": dw, "h": dh},
            "sourceSize": {"w": int(r.get("orig_w", dw)), "h": int(r.get("orig_h", dh))},
        }
    doc = {
        "frames": frames,
        "meta": {
            "app": "Invisible Sheet Maker",
            "version": "1.0",
            "image": image_name,
            "format": "RGBA8888",
            "size": {"w": int(width), "h": int(height)},
            "scale": "1",
        },
    }
    Path(path).write_text(json.dumps(doc, indent=2), encoding="utf-8")


# ---------------------------------------------------------------------------
# Invisible AI manifest — atlas_manifest_<name>.json
# ---------------------------------------------------------------------------

def build_manifest(sheet_image: str, width: int, height: int,
                   regions: list[dict], *,
                   deploy_basename: str = "",
                   deploy_path: str = "",
                   style: dict | None = None,
                   export_prefix: str = "",
                   source_image_path: str = "",
                   atlas_file: str = "",
                   texturepacker_json: str = "",
                   region_shape_keys: dict[str, str] | None = None) -> dict:
    """Build the enriched manifest the Atlas Maker consumes.

    Regions are emitted FLAT in `regions` (the Atlas Maker includes
    `rotated_regions` only with --include-rotated, so a split would silently
    drop rotated sprites by default). Each region gets blank AI fields ready
    to fill in (prompt / shape_ref / seed).

    B14 — self-contained manifest. So loading this into the Atlas Maker
    doesn't force the user to re-pick the sheet PNG / `.atlas` / shape refs,
    we back-reference every sibling the export just emitted as R2 keys:

      * `export_prefix`            — the R2 prefix this export landed under
                                     (e.g. `sheet_maker/<c>/<p>/output/<sheet>`).
      * `atlas.source_image_path`  — R2 key of the packed sheet PNG.
      * `atlas.atlas_file`         — R2 key of the sibling `.atlas`, if emitted.
      * `atlas.texturepacker_json` — R2 key of the TexturePacker JSON, if emitted.
      * each region's `shape_ref`  — defaults to that region's per-region trim
                                     image R2 key (the loose sprite that was
                                     packed), unless one was set by hand.

    The legacy `atlas.source_image` is kept (basename only — never a local path)
    for back-compat; the new `*_path` / `atlas_file` keys are the resolvable
    R2 ones."""
    style = style or {"positive_prefix": "", "positive_suffix": "", "negative": ""}
    shape_keys = region_shape_keys or {}
    man_regions = []
    for r in regions:
        # Default shape_ref to the region's own trim (loose sprite) R2 key so
        # the Atlas Maker can ingest the silhouette without a manual re-pick.
        shape_ref = r.get("shape_ref") or shape_keys.get(r["name"], "")
        man_regions.append({
            "name": r["name"],
            "x": int(r["x"]), "y": int(r["y"]),
            "w": int(r["w"]), "h": int(r["h"]),
            "rotated": bool(r.get("rotated")),
            "prompt": r.get("prompt", ""),
            "shape_ref": shape_ref,
            "seed": r.get("seed", ""),
        })
    atlas: dict = {
        # Bare name only — NEVER a local OS/Windows staging path. The resolvable
        # location is `source_image_path` (an R2 key); a local absolute path here
        # would resolve to a non-existent file in the cloud ("Atlas geometry not
        # found in R2"). The Atlas Maker resolves this basename under refs/atlas/.
        "source_image": Path(str(sheet_image).replace("\\", "/")).name,
        "width": int(width),
        "height": int(height),
        "format": "RGBA",
    }
    if source_image_path:
        atlas["source_image_path"] = source_image_path
    if atlas_file:
        atlas["atlas_file"] = atlas_file
    if texturepacker_json:
        atlas["texturepacker_json"] = texturepacker_json
    man = {
        "_comment": "Authored by the Invisible Sheet Maker. 'atlas' geometry is "
                    "the packed sheet; fill per-region 'prompt'/'shape_ref'/'seed' "
                    "then regenerate in the Invisible Atlas Maker.",
        "atlas": atlas,
        "style": style,
        "regions": man_regions,
        "deploy_path": deploy_path,
        "deploy_basename": deploy_basename,
    }
    if export_prefix:
        man["export_prefix"] = export_prefix
    return man


def write_manifest(path: str | Path, manifest: dict) -> None:
    Path(path).write_text(json.dumps(manifest, indent=2, ensure_ascii=False),
                          encoding="utf-8")
