"""
Slice the atlas source image into per-region reference crops.

Uses the bound `.atlas` geometry to cut the original page image into one
PNG per region, written into the ComfyUI input dir so they can be fed back
as per-region IPAdapter style refs (or Canny shape refs). Each regenerated
element then has the *original* element as its reference — far better than a
single shared mockup image.

The crop is the on-page packed rectangle; rotated regions are un-rotated
(inverse of the rotate(-90) that compose applies) so the saved ref is upright.

Source image resolution order:
  1. manifest atlas.source_image  (absolute, or relative to ComfyUI input dir)
  2. the bound .atlas's page image, next to the .atlas file
  3. <input>/<page>            4. <input>/refs/<page>

USAGE
    py slice_atlas.py                         # default manifest, -> style_ref
    py slice_atlas.py --as shape_ref
    py slice_atlas.py --only A,C,scatter_gem
    py slice_atlas.py --no-manifest           # only write crops, don't bind
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image

# The embedded ComfyUI Python does not reliably put this script's directory on
# sys.path (safe-path / -P), so sibling imports fail when launched as a
# subprocess. Prepend it explicitly, like batch_atlas.py / ui_server.py do.
sys.path.insert(0, str(Path(__file__).resolve().parent))

import atlas_format  # noqa: E402
import batch_atlas as B  # noqa: E402

SELF = B.SELF
INPUT_DIR = B.INPUT_DIR


def resolve_source_image(manifest: dict, atlas_path: Path, page_image: str) -> Path | None:
    si = (manifest.get("atlas") or {}).get("source_image")
    cands: list[Path] = []
    if si:
        p = Path(si)
        cands.append(p if p.is_absolute() else INPUT_DIR / si)
    if page_image:
        cands.append(atlas_path.parent / page_image)
        cands.append(INPUT_DIR / page_image)
        cands.append(INPUT_DIR / "refs" / page_image)
    for c in cands:
        if c.exists():
            return c
    return None


def slice_regions(src: Image.Image, regions: list[dict], out_dir: Path) -> dict[str, str]:
    """Write one PNG per region; return {region_name: relpath-from-input}."""
    out_dir.mkdir(parents=True, exist_ok=True)
    src = src.convert("RGBA")
    sw, sh = src.size
    written: dict[str, str] = {}
    for r in regions:
        # Geometry via region_box so the legacy no-atlas path works: an
        # explicit region x/y/w/h still wins; a region that omits w/h falls
        # back to the settings cell size (ATLAS_META.cell_*), then the full
        # image — same resolution the generate/compose engine uses.
        x, y, w, h = B.region_box(r)
        rotated = bool(r.get("rotated"))
        # w/h in the .atlas are the UNROTATED region size. When rotate:90 the
        # rectangle actually occupies (h x w) on the page, so the crop box
        # must use swapped dimensions — otherwise we slice the wrong area
        # (and rotated regions near the right/bottom edge overflow the page).
        pw, ph = (h, w) if rotated else (w, h)
        box = (max(0, x), max(0, y), min(sw, x + pw), min(sh, y + ph))
        if box[2] <= box[0] or box[3] <= box[1]:
            print(f"  skip {r['name']}: region outside source bounds")
            continue
        crop = src.crop(box)
        if rotated:
            # the on-page pixels are rotated; restore upright (this also turns
            # the (h x w) crop back into the region's (w x h) orientation).
            crop = crop.rotate(-90, expand=True)
        out_path = out_dir / f"{r['name']}.png"
        crop.save(out_path)
        rel = out_path.relative_to(INPUT_DIR).as_posix()
        written[r["name"]] = rel
    return written


def bind_into_manifest(manifest_path: Path, manifest: dict,
                       written: dict[str, str], ref_field: str) -> int:
    """Set ref_field on each region's creative entry (creating a name-only
    stub when none exists). Never writes geometry — geometry stays in the
    .atlas. Existing prompts/seeds are preserved."""
    regions = manifest.setdefault("regions", [])
    by_name = {r.get("name"): r for r in regions if r.get("name")}
    n = 0
    for name, rel in written.items():
        r = by_name.get(name)
        if r is None:
            r = {"name": name}
            regions.append(r)
            by_name[name] = r
        r[ref_field] = rel
        n += 1
    manifest_path.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    return n


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", default=B.CFG["manifest_path"])
    ap.add_argument("--as", dest="ref_field", default="style_ref",
                    choices=["style_ref", "shape_ref"],
                    help="Which per-region ref the crops become (default style_ref / IPAdapter).")
    ap.add_argument("--only", default=None, help="Comma-separated region names.")
    ap.add_argument("--no-manifest", action="store_true",
                    help="Only write crop PNGs; do not bind them in the manifest.")
    args = ap.parse_args()

    manifest_path = SELF / Path(args.manifest).name
    if manifest_path.suffix.lower() == ".atlas":
        manifest = {"atlas": {"atlas_file": manifest_path.name},
                    "style": {}, "regions": []}
        manifest_path = SELF / f"atlas_manifest_{manifest_path.stem}.json"
        if manifest_path.exists():
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    else:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    atlas_path = B.atlas_file_path(manifest, manifest_path)
    atlas_bound = atlas_path is not None and atlas_path.exists()

    B.apply_manifest_settings(manifest)
    if atlas_bound:
        data = atlas_format.parse_atlas(atlas_path)
        regions = B.merge_atlas_regions(manifest, data)
        page_image = data["page"]["image"]
    else:
        # Legacy cell-grid fallback: no .atlas, so slice the source image by
        # the manifest's own regions. Geometry resolves via region_box —
        # explicit region x/y/w/h, else the settings cell size, else the full
        # image — the same path the generate/compose engine uses.
        atlas_meta = dict(manifest.get("atlas") or {})
        atlas_meta.setdefault("cell_width", B.GEN_WIDTH)
        atlas_meta.setdefault("cell_height", B.GEN_HEIGHT)
        B.ATLAS_META.clear()
        B.ATLAS_META.update(atlas_meta)
        regions = list(manifest.get("regions") or [])
        page_image = ""

    if args.only:
        wanted = {s.strip() for s in args.only.split(",")}
        regions = [r for r in regions if r["name"] in wanted]
    if not regions:
        print("No regions selected.")
        return

    src_path = resolve_source_image(manifest, atlas_path, page_image)
    if not src_path:
        print("Could not find the atlas source image. Set 'Atlas source "
              f"image' (manifest atlas.source_image) — looked for page "
              f"'{data['page']['image']}' next to {atlas_path.name}, and in "
              f"{INPUT_DIR} and {INPUT_DIR / 'refs'}.")
        raise SystemExit(2)

    out_dir = INPUT_DIR / "refs" / "atlasslices" / manifest_path.stem.replace(
        "atlas_manifest_", "")
    print(f"Source: {src_path}")
    print(f"Slicing {len(regions)} regions -> {out_dir}")
    src = Image.open(src_path)
    written = slice_regions(src, regions, out_dir)
    print(f"Wrote {len(written)} crops")

    if args.no_manifest:
        return
    n = bind_into_manifest(manifest_path, manifest, written, args.ref_field)
    print(f"Bound {n} regions' {args.ref_field} in {manifest_path.name}")


if __name__ == "__main__":
    main()
