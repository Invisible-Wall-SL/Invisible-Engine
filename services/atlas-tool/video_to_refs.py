"""Animated WEBP → Atlas Maker REFERENCE IMAGES + an empty `pack` atlas.

Design: docs/design/invisible-flipbook-video.md (build-plan step 3, second export).

The sibling of `video_to_clip`, and its opposite. `video_to_clip` turns a render
into a finished, downscaled, alpha-trimmed, packed flipbook sheet — the animation
as it will ship. This one hands the SAME frames to the Atlas Maker as raw input:
one full-resolution PNG per selected frame under `input/refs/`, plus a manifest
whose regions each point at one of them through `style_ref`. The author then
regenerates those frames in the Atlas Maker (new style, new model, new prompt)
and builds the atlas there, with the Flipbook out of the loop.

Four rules hold this path together; each is a decision, not a default:

1. **NOTHING IS PACKED HERE.** No packer, no trim, no downscale, no
   `atlas.width/height`, no `x/y/w/h` on any region. The manifest is an EMPTY
   `pack` atlas (`_newatlas`'s shape) carrying only names and refs, and
   `auto_pack_layout` leaves a region with no committed image UNPLACED, so this
   export produces no page at all — by design. The page is built later, by
   Create Atlas, out of the GENERATED art at the generation size, so the
   full-resolution refs cannot inflate it: they are loose input files that never
   reach a page.

2. **`style_ref`, never `shape_ref`.** A `shape_ref` goes through
   `batch_atlas.normalize_shape_ref`, which grayscales the image
   (`convert("L")`), thresholds it to a silhouette and rebuilds it centred on a
   1024x1024 canvas — it would destroy the picture. These frames are pictures for
   a `LoadImage`, so they ride the style slot.

3. **No downscale, no trim, no `max_size`.** The absence of `max_size` IS the
   difference from `toclip`; a reference image that was shrunk to save atlas
   space is a worse reference, and it saves nothing here because nothing is
   packed (rule 1).

4. **The active manifest is NOT touched.** No `save_config`, no
   `cfg["manifest_path"]`. Like every other `/video/*` route this is stateless —
   the process-global active manifest is a known multi-user hazard, and a new
   surface does not enlist in it. The caller opens the new atlas in the Atlas
   Maker by name.

Ref paths are `refs/video/<slug>/<slug>_NNNN.png`, i.e. INPUT_DIR-relative with
a UNIQUE LEAF NAME. Nested resolves (`batch_atlas._locate_ref_in_staging` hits
`INPUT_DIR / relpath` directly, and on a cold container hydrates that exact key
into the same place), but the leaf must not be a generic `frame_0000.png`: two
of the resolver's fallbacks key on BASENAME ALONE — the `refs/` rglob rescue and
`_serverless_workflow_images`, which dedupes RunPod's `images[]` by basename and
rewrites every LoadImage to it. Same-named frames from two exports would
silently resolve to each other's picture.
"""
from __future__ import annotations

import io
import json
import re
from pathlib import Path

from PIL import Image, ImageSequence

import cloud_paths as project_paths
import storage
import video_to_clip

# Hard ceiling on exported frames. Every frame here costs far more than a packed
# tile: a full-resolution PNG written twice (staging + R2) AND a region someone
# has to regenerate, one GPU job each. Over budget RAISES — a silently truncated
# export would look exactly like a complete one, in a manifest whose whole job is
# to say which frames there are.
MAX_REF_FRAMES = 120

# Where the refs live under INPUT_DIR. A subfolder per export, because one
# session can drop 80+ files into a `refs/` the Atlas Maker's own picker opens.
REF_SUBDIR = "refs/video"


def _sanitize_region_name(raw: str) -> str:
    """Exactly `ui_server._sanitize_region_name` (which cannot be imported here —
    `ui_server` imports this module). A region name is used verbatim as a
    variant-file prefix and a manifest key, so: letters/digits/_/- only."""
    s = re.sub(r"[^A-Za-z0-9_-]+", "_", str(raw).strip())
    return s.strip("_-")


def _atlas_slug(name: str, session_id: str, variation: int) -> str:
    """The atlas name, slugged the way the Atlas Maker's own ＋ New atlas slugs
    it (`project_paths.r2_slug`), so an atlas born here is addressable exactly
    like one created there rather than being a near-miss beside it."""
    raw = str(name or "").strip() or f"vid_{session_id}_{int(variation):03d}"
    slug = project_paths.r2_slug(raw)
    if not slug.strip("_-"):
        raise ValueError(
            "Couldn't derive an atlas name from that — use letters or numbers.")
    return slug


def _existing_manifest(manifest_dir: Path, fname: str) -> str | None:
    """The stored spelling of an existing manifest with this name, ignoring case.

    Case matters: manifests authored elsewhere keep their case, so on Linux a
    lowercase slug would sit beside `Atlas_Manifest_Foo.json` as a SECOND file
    describing the same atlas — the collision `_newatlas` already guards."""
    try:
        for p in manifest_dir.glob("atlas_manifest_*.json"):
            if p.name.lower() == fname.lower():
                return p.name
    except OSError:
        pass
    return None


def _pick_frames(im: Image.Image, start: int, end: int, stride: int) -> list[int]:
    """Source frame indices to export. Clamping is byte-identical to
    `video_to_clip._extract` so `start`/`end`/`stride` mean the same thing on
    both exports — the UI offers one set of controls for the two."""
    total = int(getattr(im, "n_frames", 1) or 1)
    start = max(0, min(int(start), total - 1))
    end = total if int(end) <= 0 else min(int(end), total)
    stride = max(1, int(stride))
    picked = list(range(start, end, stride))
    if not picked:
        raise ValueError("That range selects no frames.")
    if len(picked) > MAX_REF_FRAMES:
        raise ValueError(
            f"That selects {len(picked)} frames (max {MAX_REF_FRAMES} as "
            "reference images — each one is a full-size PNG and a region to "
            "regenerate). Raise the stride or narrow the range.")
    return picked


def _write_ref(input_dir: Path, r2: str, relpath: str, blob: bytes) -> None:
    """One ref image into staging AND R2 — the `video_to_clip._write_page`
    pattern. Staging is what this container's generation reads; R2 is what
    survives the container, and what a cold one hydrates the key back from."""
    dest = input_dir / relpath
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(blob)
    storage.put(f"{r2}/input/{relpath}", blob, "image/png")


def _build_manifest(slug: str, regions: list[dict], *, session_id: str,
                    variation: int, source: str, picked: list[int],
                    stride: int, fps: float, size: tuple[int, int]) -> dict:
    """An EMPTY `pack` atlas (`ui_server._newatlas`'s shape) plus one region per
    exported frame, each carrying only a name and a `style_ref`.

    No geometry of any kind: see rule 1 in the module docstring. The `_comment`
    carries the provenance a regenerated atlas otherwise loses — which render
    these frames came from, which frames, and at what RATE they were meant to
    play, the one fact a folder of stills cannot hold."""
    w, h = size
    return {
        "_comment": (
            f"Reference images exported from the Invisible Flipbook video mode: "
            f"session {session_id}, variation #{int(variation)} ({source}), "
            f"frames {picked[0]}-{picked[-1]} step {int(stride)} "
            f"({len(picked)} of them) at {w}x{h}, rendered at {fps} fps. "
            f"Full resolution, untrimmed, unscaled, and NOTHING is packed — "
            f"generate each region, then Create Atlas builds the page."),
        "atlas": {"layout": "pack"},
        "style": {"positive_prefix": "", "positive_suffix": "", "negative": ""},
        "regions": regions,
    }


def build_ref_set(session_id: str, variation: int, *, name: str = "",
                  start: int = 0, end: int = 0, stride: int = 1) -> dict:
    """Export one variation's frames as Atlas Maker reference images.

    Writes `<input_dir>/refs/video/<slug>/<slug>_NNNN.png` (mirrored to
    `<r2>/input/…`) and `atlas_manifest_<slug>.json` into both `manifest_dir`
    and `<r2>/manifests/`. Raises `ValueError` with a user-readable message on
    anything the caller can fix; the route renders it verbatim."""
    fname_src = video_to_clip._variation_file(session_id, variation)
    slug = _atlas_slug(name, session_id, variation)

    pp = project_paths.resolve()
    r2 = pp["r2_project_prefix"]
    input_dir = Path(pp["input_dir"])
    man_dir = Path(pp["manifest_dir"])
    man_name = f"atlas_manifest_{slug}.json"

    # Refuse rather than overwrite. An existing atlas of this name holds prompts
    # and style somebody wrote; re-running this export would replace them with
    # blanks and say nothing. Naming the export differently costs one field.
    clash = _existing_manifest(man_dir, man_name)
    if clash:
        shown = clash[len("atlas_manifest_"):-len(".json")]
        raise ValueError(
            f"An atlas '{shown}' already exists — give this export a different "
            "name, so an atlas you have already written prompts into is not "
            "replaced by blank regions.")

    im = video_to_clip._open_variation(session_id, fname_src)
    picked = _pick_frames(im, start, end, stride)
    width, height = im.width, im.height

    # Pillow fills a WEBP frame's `info["duration"]` only after an explicit
    # seek()+load(); reading it off `ImageSequence.Iterator` yields None and the
    # rate silently falls back to a default. `_frame_durations` is the one place
    # that dance lives — call it BEFORE iterating, as `frame_zip` does.
    durations = [d for d in video_to_clip._frame_durations(im) if d > 0]
    ms = sorted(durations)[len(durations) // 2] if durations else 0
    fps = round(1000.0 / ms, 3) if ms else video_to_clip.DEFAULT_FPS

    wanted = set(picked)
    regions: list[dict] = []
    for i, frame in enumerate(ImageSequence.Iterator(im)):
        if i not in wanted:
            continue
        # Named by SOURCE frame index, so a stride stays traceable in the region
        # names instead of silently renumbering — same rule as video_to_clip.
        region = _sanitize_region_name(f"{slug}_{i:04d}")
        relpath = f"{REF_SUBDIR}/{slug}/{region}.png"
        buf = io.BytesIO()
        # Verbatim: no resize, no crop, no trim. RGBA so a cutout's alpha
        # survives into the ref the way it left the render.
        frame.convert("RGBA").save(buf, format="PNG")
        _write_ref(input_dir, r2, relpath, buf.getvalue())
        regions.append({"name": region, "style_ref": relpath})

    if len(regions) != len(picked):
        # The WEBP's header promised `n_frames` the decoder could not deliver
        # (a truncated or partially-written render). Say so: the manifest's whole
        # job is to state which frames there are, and a short one reads as a
        # complete export of a shorter animation.
        raise ValueError(
            f"That render decoded only {len(regions)} of the {len(picked)} "
            "frames its header promised — it looks truncated. Re-run the "
            "variation, then export again.")

    manifest = _build_manifest(
        slug, regions, session_id=session_id, variation=int(variation),
        source=fname_src, picked=picked, stride=max(1, int(stride)), fps=fps,
        size=(width, height))
    blob = json.dumps(manifest, indent=2, ensure_ascii=False).encode("utf-8")
    man_dir.mkdir(parents=True, exist_ok=True)
    (man_dir / man_name).write_bytes(blob)
    storage.put(f"{r2}/manifests/{man_name}", blob, "application/json")

    # `regions` and `frames` are the same number by construction — one region per
    # exported frame — and are both reported because the caller describes two
    # things with them: what the manifest holds and what was extracted.
    return {
        "atlas_name": slug,
        "manifest": man_name,
        "regions": len(regions),
        "frames": len(regions),
        "width": int(width),
        "height": int(height),
    }
