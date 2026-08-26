"""Animated WEBP → packed sheet(s) → flipbook clip frames.

Design: docs/design/invisible-flipbook-video.md (build-plan step 3).

Takes one variation from a video session and turns its frames into real atlas
regions the Flipbook can author a clip from: extract → downscale → alpha-trim →
MaxRects-pack into one or more pages → write page PNG + TexturePacker JSON +
Invisible manifest. Returns the ordered frame refs; the CLIP itself is created by
the launcher through `/api/flipbook/save`, because clip storage (R2 layout, ETag
compare-and-swap, the edit lease) is the launcher's and must stay there.

No ffmpeg: Pillow reads animated WEBP through `ImageSequence`. That is the whole
reason the blueprint standardises on `SaveAnimatedWEBP` — see the design doc.

Four things here are load-bearing and easy to get wrong:

1. **Trim is recorded, never just applied.** A trimmed frame is a tight rect
   sitting inside a larger canvas at an offset. Emit `offX/offY/origW/origH` and
   every renderer re-places it correctly; omit them and each frame's tight rect
   gets scaled to fill its box independently, so the animation PULSES. This repo
   already paid for that once, on .plist imports.

2. **Trim by the ALPHA channel, not `Image.getbbox()`.** `getbbox()` measures
   non-zero pixels across ALL bands, so on a frame with no cutout (fully opaque)
   it happily crops black borders off the art. `getchannel("A").getbbox()` on a
   fully opaque frame returns the whole box — i.e. no trim — which is right.

3. **Paste WITHOUT a mask.** `canvas.paste(img, xy, img)` applies the mask to
   every band, landing a semi-transparent pixel as `src * a` — a premultiply the
   page must not carry. Onto a fresh transparent canvas, `paste(img, xy)` copies
   RGBA verbatim.

4. **Pages are capped at 2048.** A single AUTO-packed page of 81 frames is
   ~4200px tall — past what plenty of GPUs will take. Frames spill onto extra
   pages instead, which costs nothing: a clip has spanned sheets since
   2026-07-24, and every frame ref here is atlas-scoped anyway.
"""
from __future__ import annotations

import io
import json
import re
from pathlib import Path

from PIL import Image, ImageSequence

import atlas_writers
import cloud_paths as project_paths
import pack as packer
import storage
import video_runner

# Max page edge. 2048 is the same cap the from-scratch auto-pack atlas uses and
# is safe on every target device.
PAGE_MAX = 2048
# Gutter between packed frames, matching the from-scratch atlas.
PAGE_PADDING = 2
# Hard ceiling on frames per clip. A 10s 30fps generation is 301 frames; packing
# that is minutes of work and several pages nobody wants. The UI shows the count
# before committing, so this is a backstop, not the mechanism.
MAX_FRAMES = 240
DEFAULT_FPS = 16.0


def _slug(raw: str) -> str:
    """A region name is used verbatim as a manifest key and a frame ref, so keep
    it filesystem- and ref-safe. Mirrors `ui_server._sanitize_region_name`."""
    return re.sub(r"[^A-Za-z0-9_-]+", "_", str(raw).strip()).strip("_")


def _open_variation(session_id: str, name: str) -> Image.Image:
    blob = video_runner.read_variation(session_id, name)
    if not blob:
        raise ValueError(f"Variation '{name}' not found in session '{session_id}'.")
    try:
        return Image.open(io.BytesIO(blob))
    except Exception as e:  # noqa: BLE001 — a corrupt/partial webp is user-visible
        raise ValueError(f"Could not read '{name}' as an image: {e}") from e


def _frame_durations(im: Image.Image) -> list[int]:
    """Per-frame duration in ms.

    Pillow populates `info["duration"]` for a WEBP frame only after an explicit
    `seek()` **and** `load()`. Iterating with `ImageSequence.Iterator` and reading
    `frame.info` returns `None` for every frame — verified against Pillow 11.3 —
    and the failure is silent: the fps falls back to the default and the clip
    plays at the wrong speed with nothing to show for it.
    """
    out: list[int] = []
    total = int(getattr(im, "n_frames", 1) or 1)
    for i in range(total):
        try:
            im.seek(i)
            im.load()
        except EOFError:
            break
        d = im.info.get("duration")
        out.append(int(d) if d else 0)
    try:
        im.seek(0)
    except EOFError:
        pass
    return out


def probe(session_id: str, name: str) -> dict:
    """Describe a variation without packing anything — the numbers the trim UI
    needs to show a cost before the author commits."""
    im = _open_variation(session_id, name)
    total = int(getattr(im, "n_frames", 1) or 1)
    durations = [d for d in _frame_durations(im) if d > 0]
    # The WEBP's own frame duration IS the generation rate, because the blueprint
    # wires the save node's fps to the generation fps node rather than copying it.
    ms = (sorted(durations)[len(durations) // 2] if durations else 0)
    fps = round(1000.0 / ms, 3) if ms else DEFAULT_FPS
    alpha = False
    for frame in ImageSequence.Iterator(im):
        rgba = frame.convert("RGBA")
        if rgba.getchannel("A").getextrema()[0] < 255:
            alpha = True
            break
    return {
        "frames": total,
        "width": im.width,
        "height": im.height,
        "fps": fps,
        "duration_ms": ms,
        # Surfaced so the tool can WARN rather than silently packing opaque
        # rectangles as symbol art — the open question from step 0.
        "has_alpha": alpha,
    }


def _variation_file(session_id: str, variation: int) -> str:
    """Resolve a variation INDEX to its stored filename, so callers address a
    variation the way the UI does (`#3`) rather than by file name."""
    session = video_runner.get_session(session_id)
    if not session:
        raise ValueError("No such video session.")
    var = next((v for v in session.get("variations", [])
                if int(v.get("index", 0)) == int(variation)), None)
    if not var:
        raise ValueError(f"Session has no variation #{variation}.")
    if var.get("status") != "done" or not var.get("file"):
        raise ValueError("That variation has not finished rendering.")
    return str(var["file"])


def probe_variation(session_id: str, variation: int) -> dict:
    return probe(session_id, _variation_file(session_id, variation))


def _extract(
    im: Image.Image, start: int, end: int, stride: int, max_size: int
) -> list[tuple[int, Image.Image, tuple[int, int, int, int], tuple[int, int]]]:
    """Select, downscale and alpha-trim frames.

    Returns `(source_index, trimmed_image, (off_x, off_y, orig_w, orig_h), (w, h))`.
    """
    total = int(getattr(im, "n_frames", 1) or 1)
    start = max(0, min(int(start), total - 1))
    end = total if int(end) <= 0 else min(int(end), total)
    stride = max(1, int(stride))
    picked = list(range(start, end, stride))
    if not picked:
        raise ValueError("That range selects no frames.")
    if len(picked) > MAX_FRAMES:
        raise ValueError(
            f"That selects {len(picked)} frames (max {MAX_FRAMES}). "
            "Raise the stride or narrow the range.")

    out = []
    wanted = set(picked)
    for i, frame in enumerate(ImageSequence.Iterator(im)):
        if i not in wanted:
            continue
        rgba = frame.convert("RGBA")
        if max_size and max(rgba.width, rgba.height) > max_size:
            scale = max_size / float(max(rgba.width, rgba.height))
            rgba = rgba.resize(
                (max(1, round(rgba.width * scale)), max(1, round(rgba.height * scale))),
                Image.LANCZOS)
        orig_w, orig_h = rgba.width, rgba.height
        # ALPHA-only bbox — see module docstring #2.
        box = rgba.getchannel("A").getbbox()
        if box is None:
            # A fully transparent frame is a real beat in an animation, but a
            # zero-area rect cannot be packed. Keep a 1x1 placeholder centred in
            # the original canvas so the timing survives and nothing draws.
            tile = Image.new("RGBA", (1, 1), (0, 0, 0, 0))
            trim = (orig_w // 2, orig_h // 2, orig_w, orig_h)
        else:
            tile = rgba.crop(box)
            trim = (box[0], box[1], orig_w, orig_h)
        out.append((i, tile, trim, (tile.width, tile.height)))
    return out


def _pack_pages(items: list[dict]) -> list[dict]:
    """Split `items` across pages no larger than PAGE_MAX, packing each snugly.

    Largest-fitting-prefix by binary search: ~log(n) packs per page rather than
    the n decrements a linear walk would cost.
    """
    pages: list[dict] = []
    rest = list(items)
    while rest:
        lo, hi, best = 1, len(rest), None
        while lo <= hi:
            mid = (lo + hi) // 2
            try:
                res = packer.pack(rest[:mid], width=PAGE_MAX, height=0,
                                  padding=PAGE_PADDING, allow_rotation=False)
            except ValueError:
                res = None
            if res and res["height"] <= PAGE_MAX and res["width"] <= PAGE_MAX:
                best = (mid, res)
                lo = mid + 1
            else:
                hi = mid - 1
        if best is None:
            # One frame alone exceeds a full page even after the caller's
            # downscale — say which, rather than looping forever.
            raise ValueError(
                f"Frame '{rest[0]['name']}' is {rest[0]['w']}x{rest[0]['h']}, too "
                f"large for a {PAGE_MAX}x{PAGE_MAX} page. Lower the output size.")
        n, res = best
        pages.append(res)
        rest = rest[n:]
    return pages


def _write_page(
    page_index: int,
    sheet: str,
    packed: dict,
    tiles: dict[str, Image.Image],
    trims: dict[str, tuple[int, int, int, int]],
) -> dict:
    """Compose one page and write its PNG + TexturePacker JSON + manifest to
    staging and R2. Returns `{manifest_key, page_key, width, height, regions}`."""
    pp = project_paths.resolve()
    r2 = pp["r2_project_prefix"]
    staging = Path(pp["staging_root"])

    name = sheet if page_index == 0 else f"{sheet}_p{page_index}"
    canvas = Image.new("RGBA", (packed["width"], packed["height"]), (0, 0, 0, 0))
    regions = []
    for r in packed["regions"]:
        tile = tiles[r["name"]]
        # NO mask — see module docstring #3.
        canvas.paste(tile, (int(r["x"]), int(r["y"])))
        off_x, off_y, orig_w, orig_h = trims[r["name"]]
        regions.append({**r, "off_x": off_x, "off_y": off_y,
                        "orig_w": orig_w, "orig_h": orig_h})

    sheet_dir = staging / "sheets" / name
    sheet_dir.mkdir(parents=True, exist_ok=True)
    page_path = sheet_dir / f"{name}.png"
    buf = io.BytesIO()
    canvas.save(buf, format="PNG")
    page_bytes = buf.getvalue()
    page_path.write_bytes(page_bytes)

    tp_path = sheet_dir / f"{name}.json"
    atlas_writers.write_texturepacker_json(
        tp_path, f"{name}.png", packed["width"], packed["height"], regions)

    export_prefix = f"{r2}/sheets/{name}"
    page_key = f"{export_prefix}/{name}.png"
    tp_key = f"{export_prefix}/{name}.json"
    manifest_key = f"{r2}/manifests/atlas_manifest_{name}.json"

    manifest = _build_manifest(name, packed, regions, page_key, tp_key, export_prefix)
    man_dir = Path(pp["manifest_dir"])
    man_dir.mkdir(parents=True, exist_ok=True)
    (man_dir / f"atlas_manifest_{name}.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")

    storage.put(page_key, page_bytes, "image/png")
    storage.put(tp_key, tp_path.read_bytes(), "application/json")
    storage.put(manifest_key,
                json.dumps(manifest, indent=2, ensure_ascii=False).encode("utf-8"),
                "application/json")

    return {
        "manifest_key": manifest_key,
        "page_key": page_key,
        "width": packed["width"],
        "height": packed["height"],
        "regions": [r["name"] for r in packed["regions"]],
    }


def _build_manifest(name: str, packed: dict, regions: list[dict],
                    page_key: str, tp_key: str, export_prefix: str) -> dict:
    """The Invisible manifest shape the launcher's `loadRegionSet` parses.

    Deliberately narrower than the Sheet Maker's `build_manifest`: this sheet is
    a DERIVED artifact, so it carries no AI authoring fields (prompt / seed /
    shape_ref) that nothing will ever fill. What it must carry exactly:

      * `atlas.source_image_path` — a resolvable R2 key, so `resolvePageKey`
        takes its `direct` branch and never has to guess by basename stem.
      * per-region `offX/offY/origW/origH` — CAMEL case. `parseRegions` reads
        only camelCase; the snake_case the packer and the composers speak would
        be silently dropped, and the animation would pulse (docstring #1).
      * `fit_mode: "contain"` — an `.atlas`-bound region is otherwise treated as
        a Spine slot and `fill`ed (stretched) by the Atlas Maker's composer.
    """
    return {
        "_comment": (
            "Authored by the Invisible Flipbook video mode from a generated "
            "animation. Derived artifact: re-running the video session replaces "
            "it. Region geometry is packed frames; there is no AI recipe here."),
        "atlas": {
            "source_image": f"{name}.png",
            "source_image_path": page_key,
            "texturepacker_json": tp_key,
            "width": int(packed["width"]),
            "height": int(packed["height"]),
            "format": "RGBA",
            "layout": "pack",
        },
        "export_prefix": export_prefix,
        "deploy_basename": name,
        "regions": [
            {
                "name": r["name"],
                "x": int(r["x"]), "y": int(r["y"]),
                "w": int(r["w"]), "h": int(r["h"]),
                "rotated": bool(r.get("rotated")),
                "fit_mode": "contain",
                "offX": int(r["off_x"]), "offY": int(r["off_y"]),
                "origW": int(r["orig_w"]), "origH": int(r["orig_h"]),
            }
            for r in regions
        ],
    }


def build_clip_sheet(session_id: str, variation: int, *, name: str = "",
                     start: int = 0, end: int = 0, stride: int = 1,
                     max_size: int = 0) -> dict:
    """Turn one variation into packed sheet(s) + the ordered frame refs a clip
    needs. Raises ValueError with a user-readable message on anything fixable."""
    fname = _variation_file(session_id, variation)
    sheet = _slug(name) or _slug(f"vid_{session_id}_{variation:03d}")
    im = _open_variation(session_id, fname)
    info = probe(session_id, fname)
    picked = _extract(im, start, end, stride, max_size)

    tiles: dict[str, Image.Image] = {}
    trims: dict[str, tuple[int, int, int, int]] = {}
    items: list[dict] = []
    order: list[str] = []
    for src_index, tile, trim, (w, h) in picked:
        # Named by SOURCE frame index, so a stride is traceable in the region
        # names rather than silently renumbering.
        region = f"{sheet}_{src_index:04d}"
        tiles[region] = tile
        trims[region] = trim
        items.append({"name": region, "w": w, "h": h})
        order.append(region)

    pages = [_write_page(i, sheet, packed, tiles, trims)
             for i, packed in enumerate(_pack_pages(items))]

    # Which page each region landed on — the packer reorders by area, and frames
    # spill across pages, so the clip's ORDER has to be re-derived from `order`.
    home: dict[str, str] = {}
    for p in pages:
        for region in p["regions"]:
            home[region] = p["manifest_key"]

    # ALWAYS atlas-scoped, even on a single page. A bare name resolves against
    # the flat cache where every sheet's frames collide — the exact bug that made
    # one symbol play another's animation (flipbook status, 2026-07-24).
    frames = [f"{home[r]}::{r}" for r in order]
    fps = info["fps"] / max(1, int(stride))
    return {
        "name": sheet,
        "assetKey": pages[0]["manifest_key"],
        "frames": frames,
        "fps": round(fps, 3),
        "pages": [{k: p[k] for k in ("manifest_key", "page_key", "width", "height")}
                  | {"regions": len(p["regions"])} for p in pages],
        "source_frames": info["frames"],
        "used_frames": len(frames),
        "has_alpha": info["has_alpha"],
    }
