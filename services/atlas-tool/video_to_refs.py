"""Animated WEBP → Atlas Maker REFERENCE IMAGES + an empty `grid` atlas.

Design: docs/design/invisible-flipbook-video.md (build-plan step 3, second export).

The sibling of `video_to_clip`, and its opposite. `video_to_clip` turns a render
into a finished, downscaled, alpha-trimmed, packed flipbook sheet — the animation
as it will ship. This one hands the SAME frames to the Atlas Maker as raw input:
one full-resolution PNG per selected frame under `input/refs/`, plus a manifest
whose regions each point at one of them through `style_ref`. The author then
regenerates those frames in the Atlas Maker (new style, new model, new prompt)
and builds the atlas there, with the Flipbook out of the loop.

Four rules hold this path together; each is a decision, not a default:

1. **NOTHING IS PACKED HERE — the page is DECLARED, not built.** No packer, no
   trim, no downscale, and no `x/y/w/h` on any region: the rects are stamped by
   `ui_server.grid_layout` on every Create Atlas, out of the GENERATED art at
   the generation size, so the full-resolution refs never reach a page.

   What this DOES write is the four geometry fields that layout reads —
   `atlas.width`, `atlas.height`, `atlas.cell_width`, `atlas.cell_height` — plus
   `layout: "grid"`. They are a STARTING POINT, sized to hold the frames at
   their native size where a loadable page can, and they are meant to be
   retyped: the author opens ⚙ Settings, changes the cell, presses Create Atlas,
   and the grid re-flows. Because the seed has no lasting authority, it is never
   a reason to refuse an export: frames that need more than MAX_PAGE_SIDE get
   the largest usable page and a `note` naming the shortfall.

   `layout: "grid"` and not `"pack"`, and that is the whole point of this shape.
   `auto_pack_layout` packs at a hardcoded 2048 page width and then OVERWRITES
   `atlas.width/height` with the packer's own result, deriving every rect from
   the art it measured — so on a `pack` atlas the four Settings fields are
   output, and an author who sets them watches the packer discard them. That is
   exactly what happened to the first version of this export. A flipbook also
   wants the opposite of what a packer gives: identical cells in frame order, so
   every frame shares one centre, not a tight crop per frame.

   Region ORDER is therefore load-bearing here: `grid_layout` flows regions in
   MANIFEST ORDER, and this writes them in FRAME order, so the manifest's list
   IS the animation. Nothing downstream may sort it.

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

import batch_atlas
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

# How each generated frame maps into its grid cell (`batch_atlas.fit_to_region`).
# `contain` is the default because it is the only one of the three that keeps a
# flipbook a flipbook: every frame uniformly scaled and centred in an identical
# cell, never distorted, never cropped — so the animation does not wobble.
# `cover` fills the cell and crops the overflow; `fill` stretches to it.
FIT_MODES = ("contain", "cover", "fill")
DEFAULT_FIT = "contain"

# A SEED CEILING, NOT A GATE. 4096 is the side every target this art ships to
# can sample, so it is the largest page worth GUESSING at — but this export
# composes no page (rule 1): it writes loose full-resolution refs, and the four
# geometry fields are a starting point the author retypes. Nothing here is too
# big for anything yet, so frames that need more than this are seeded at the
# largest usable page (or, for a single cell past the ceiling, at that one cell)
# and SAID OUT LOUD in the response `note` — never refused. The texture limit is
# real, but it binds at Create Atlas, on the page the author ends up with.
MAX_PAGE_SIDE = 4096


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


def _normalize_fit(fit: str) -> str:
    """The `fit` argument, validated. Rejected rather than coerced: a typo'd
    `"containe"` silently falling back to the default would place every frame
    the caller did NOT ask for, and the placement is invisible until the atlas
    is composed."""
    v = str(fit or DEFAULT_FIT).strip().lower()
    if v not in FIT_MODES:
        raise ValueError(
            f"Unknown fit '{fit}' — use one of {', '.join(FIT_MODES)}.")
    return v


def _grid_page(count: int, cell_w: int, cell_h: int) -> tuple[int, int]:
    """A page to SEED `atlas.width/height` with, for `count` cells of
    `cell_w` x `cell_h`. NEVER RAISES — it always returns a seed.

    When they all fit: the smallest page by AREA, tie-broken on the shorter long
    side then the fewer columns, so the seed is a compact near-square rather than
    one long strip — an 8-frame export becomes 4x2, not 8x1. Exact multiples of
    the cell (no power-of-two rounding): `grid_layout` divides the page by the
    cell, so any slack is page area that can never hold a whole cell.

    When they do NOT all fit under MAX_PAGE_SIDE: the LARGEST USABLE page, i.e.
    the most whole cells the ceiling allows. And when a single cell is already
    past the ceiling: that one cell, ceiling or not. Both are guesses nobody
    keeps — the author retypes all four fields before Create Atlas — and this
    used to refuse on them, which withheld the full-resolution reference images
    the whole export exists to deliver over a number that has not been read yet.
    The caller states the shortfall in `note` instead."""
    cell_w, cell_h = max(1, int(cell_w)), max(1, int(cell_h))
    max_cols = MAX_PAGE_SIDE // cell_w
    max_rows = MAX_PAGE_SIDE // cell_h
    if max_cols < 1 or max_rows < 1:
        return cell_w, cell_h
    best: tuple[tuple[int, int, int], tuple[int, int]] | None = None
    # More columns than frames can only ever waste area (rows is already 1), so
    # the search stops there.
    for cols in range(1, min(max_cols, count) + 1):
        rows = -(-count // cols)
        if rows > max_rows:
            continue
        w, h = cols * cell_w, rows * cell_h
        key = (w * h, max(w, h), cols)
        if best is None or key < best[0]:
            best = (key, (w, h))
    if best is None:
        return max_cols * cell_w, max_rows * cell_h
    return best[1]


def _seed_note(count: int, cell: tuple[int, int],
               page: tuple[int, int]) -> str:
    """What the seeded page CANNOT do — or "" when it can do everything.

    Set when the seed does not hold every exported frame, or when it is past
    MAX_PAGE_SIDE (a cell bigger than the ceiling). The export succeeds either
    way and every frame is written, so this string is the only warning the
    author gets before `grid_layout` refuses to lay the atlas out — which makes
    naming the arithmetic AND the two fields that fix it the whole job."""
    # Clamped exactly as `_grid_page` clamps, so the arithmetic quoted here is
    # the arithmetic that produced the page — and so neither can divide by zero.
    cell_w, cell_h = max(1, int(cell[0])), max(1, int(cell[1]))
    page_w, page_h = page
    cols, rows = max(1, page_w // cell_w), max(1, page_h // cell_h)
    capacity = cols * rows
    bits: list[str] = []
    if capacity < count:
        bits.append(f"{count - capacity} of them would not fit")
    if max(page_w, page_h) > MAX_PAGE_SIDE:
        bits.append(f"a single cell is already past the {MAX_PAGE_SIDE}px side "
                    f"most targets can load")
    if not bits:
        return ""
    return (f"⚠ Every frame was exported ({count} of them), but the "
            f"{page_w}×{page_h} page seeded here holds {cols}×{rows} = "
            f"{capacity} cell(s) of {cell_w}×{cell_h} — "
            f"{' and '.join(bits)}. Raise Atlas width/height or lower Default "
            f"cell width/height in 🧩 Atlas settings before you press Create "
            f"Atlas; nothing is packed yet, so every reference image is already "
            f"in the Atlas Maker either way.")


def _gen_settings() -> dict:
    """`gen_width`/`gen_height` resolved from THIS project's effective
    `atlas_config.json`, to be written into the manifest's own `settings` block.

    Those two keys are `PER_ATLAS_KEYS`: a manifest that omits them inherits the
    project-wide default at render time, so a fresh export's generation size is
    whatever the global happens to be on the day it is generated — which is not
    the same number as on the day it was exported. Stating it makes the manifest
    self-describing, and it stays editable (blanking the field in ⚙ Settings
    puts the region back on the global)."""
    cfg = batch_atlas.load_config()
    out: dict = {}
    for key in ("gen_width", "gen_height"):
        try:
            v = int(float(cfg.get(key) or 0))
        except (TypeError, ValueError):
            v = 0
        if v > 0:
            out[key] = v
    return out


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
                    stride: int, fps: float, size: tuple[int, int],
                    page: tuple[int, int], settings: dict) -> dict:
    """An EMPTY `grid` atlas plus one region per exported frame, each carrying a
    name, a `style_ref` and a `fit_mode`.

    No per-region geometry: the cells are stamped by `grid_layout` on every
    Create Atlas, from the four `atlas` fields seeded here. See rule 1 in the
    module docstring for why `grid` and not `pack`.

    The `_comment` carries the provenance a regenerated atlas otherwise loses —
    which render these frames came from, which frames, and at what RATE they
    were meant to play, the one fact a folder of stills cannot hold."""
    w, h = size
    page_w, page_h = page
    m = {
        "_comment": (
            f"Reference images exported from the Invisible Flipbook video mode: "
            f"session {session_id}, variation #{int(variation)} ({source}), "
            f"frames {picked[0]}-{picked[-1]} step {int(stride)} "
            f"({len(picked)} of them) at {w}x{h}, rendered at {fps} fps. "
            f"Full resolution, untrimmed, unscaled, and NOTHING is packed. The "
            f"{page_w}x{page_h} page and {w}x{h} cell below are a STARTING "
            f"POINT: change Atlas width/height and Default cell width/height in "
            f"Settings and press Create Atlas, and the grid re-flows. Region "
            f"order is frame order — do not sort it."),
        "atlas": {"layout": "grid", "width": page_w, "height": page_h,
                  "cell_width": w, "cell_height": h},
        "style": {"positive_prefix": "", "positive_suffix": "", "negative": ""},
        "regions": regions,
    }
    if settings:
        m["settings"] = settings
    return m


def build_ref_set(session_id: str, variation: int, *, name: str = "",
                  start: int = 0, end: int = 0, stride: int = 1,
                  fit: str = DEFAULT_FIT) -> dict:
    """Export one variation's frames as Atlas Maker reference images.

    Writes `<input_dir>/refs/video/<slug>/<slug>_NNNN.png` (mirrored to
    `<r2>/input/…`) and `atlas_manifest_<slug>.json` into both `manifest_dir`
    and `<r2>/manifests/`. Raises `ValueError` with a user-readable message on
    anything the caller can fix; the route renders it verbatim.

    On success: `{atlas_name, manifest, regions, frames, width, height}`, plus a
    `note` ONLY when the seeded page cannot hold every frame — a caveat, not a
    failure. Every frame is exported in that case too.

    `fit` is how each REGENERATED frame will sit in its grid cell — see
    FIT_MODES. It is stamped on every region and is editable afterwards."""
    fname_src = video_to_clip._variation_file(session_id, variation)
    slug = _atlas_slug(name, session_id, variation)
    fit = _normalize_fit(fit)

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
    # A SEED, never a verdict. The refusals above are about data loss — an atlas
    # overwritten, a manifest short of frames. This is not one of them: no page
    # is packed or composed here, so a seed that cannot hold every frame costs
    # the author one edit in 🧩 Atlas settings, and refusing on it would withhold
    # the images that are the entire point of the export. `note` says so.
    page = _grid_page(len(picked), width, height)
    note = _seed_note(len(picked), (width, height), page)

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
        # `fit_mode` is the ONE placement field this export writes, and it is
        # authored input, not derived geometry: `grid_layout` re-stamps x/y/w/h
        # on every Create Atlas but deliberately leaves this alone.
        regions.append({"name": region, "style_ref": relpath, "fit_mode": fit})

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
        size=(width, height), page=page, settings=_gen_settings())
    blob = json.dumps(manifest, indent=2, ensure_ascii=False).encode("utf-8")
    man_dir.mkdir(parents=True, exist_ok=True)
    (man_dir / man_name).write_bytes(blob)
    storage.put(f"{r2}/manifests/{man_name}", blob, "application/json")

    # `regions` and `frames` are the same number by construction — one region per
    # exported frame — and are both reported because the caller describes two
    # things with them: what the manifest holds and what was extracted.
    out = {
        "atlas_name": slug,
        "manifest": man_name,
        "regions": len(regions),
        "frames": len(regions),
        "width": int(width),
        "height": int(height),
    }
    # ABSENT when everything fits, rather than an empty string: the caller
    # renders whatever `note` it is given, and "" is a caveat-shaped nothing.
    if note:
        out["note"] = note
    return out
