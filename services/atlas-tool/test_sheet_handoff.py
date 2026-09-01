"""Offline fixtures for the Sheet Maker -> Atlas Maker handoff (no R2, no GPU).

Run:  py test_sheet_handoff.py   (from services/atlas-tool, PYTHONPATH=../_shared:.)

The handoff ("Open in Atlas Maker") re-reads a Sheet-Maker sheet, slices each
region's CURRENT art out of the packed page, and binds it as the region's
`output_override`. The very next "Create Atlas" then recomposes the page. That
recompose MUST be a no-op: the user opened the sheet, they did not ask for the
art to move.

It was not, and BOTH import routes broke it the same way — by losing the
`fit_mode:"contain"` placement contract that `sheet-tool/atlas_writers.py`
stamps on every cell, which is the only thing that routes a region to
`_packer_compose_tile` (a verbatim replay of `packer.compose`):

  * the editor/seed-manifest branch rebuilt each region as a CLOSED
    geometry-only dict, so `fit_mode` (and prompt/shape_ref/seed) never
    survived `_normalize_converted_region`;
  * it also SYNTHESIZED `orig_w`/`orig_h` (defaulting to w/h). Their mere
    PRESENCE is what `fit_to_region` reads as `spine_slot`, flipping the
    default from `contain` to `fill` — stretch to the rect exactly;
  * the raw-TexturePacker branch never had `fit_mode` at all, and the Sheet
    Maker's own `.json` declares `sourceSize` = the full cell, so
    `_tp_frame_to_region` hands every cell an `orig_w`/`orig_h` and lands on
    the same `fill`.

Symptom in the tool: the region rectangles stay exactly right while the art
inside them is stretched and rescaled, so it reads as a packing bug rather than
a placement one.

`repair_sheet_fit_mode` heals manifests already written by a pre-fix build,
sourcing the value from the Sheet-Maker manifest that authored the page — from
evidence, never inference, so a rig's `.atlas` keeps its deliberate `fill`.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

from PIL import Image

# Sandbox the staging tree BEFORE importing the tool: MANIFEST_DIR resolves out
# of it, and repair_sheet_fit_mode scans it for the authoring sheet manifest.
_STAGING = tempfile.mkdtemp(prefix="sheet-handoff-")
os.environ["ATLAS_STAGING"] = _STAGING

import batch_atlas  # noqa: E402
import ui_server  # noqa: E402

FAILED: list[str] = []


def check(label: str, got, want) -> None:
    ok = got == want
    print(f"{'ok  ' if ok else 'FAIL'} {label}")
    if not ok:
        print(f"       got  {got!r}\n       want {want!r}")
        FAILED.append(label)


# A Sheet-Maker cell: art at its NATURAL size, centred in a much larger padded
# cell. The gap between ink and rect is the whole point — a fit that rescales
# to the slot has nowhere to hide.
CELL_W, CELL_H = 493, 501
INK_W, INK_H = 360, 170
PAGE = "splashes.png"
NAME = "T_Splash_0007_8"


def make_cell() -> Image.Image:
    cell = Image.new("RGBA", (CELL_W, CELL_H), (0, 0, 0, 0))
    cell.alpha_composite(Image.new("RGBA", (INK_W, INK_H), (60, 160, 220, 255)),
                         ((CELL_W - INK_W) // 2, (CELL_H - INK_H) // 2))
    return cell


def ink_size(im: Image.Image) -> tuple[int, int]:
    bb = im.getchannel("A").getbbox()
    return (bb[2] - bb[0], bb[3] - bb[1]) if bb else (0, 0)


def sheet_maker_region() -> dict:
    """Exactly what sheet-tool/atlas_writers.build_manifest writes per cell —
    camelCase trim keys and the fit_mode contract included."""
    return {"name": NAME, "x": 495, "y": 148,
            "w": CELL_W, "h": CELL_H, "rotated": False,
            "prompt": "a water splash", "shape_ref": "c/p/sheet_src/s/a.png",
            "seed": 12345, "fit_mode": "contain",
            "offX": 0, "offY": 0, "origW": CELL_W, "origH": CELL_H}


def write_sheet_manifest() -> Path:
    """The Sheet Maker's manifest, as it lands in the SHARED manifests/ dir.
    `_comment` is the marker `_sheet_manifest_for` joins on."""
    doc = {
        "_comment": "Authored by the Invisible Sheet Maker. 'atlas' geometry is "
                    "the packed sheet; fill per-region 'prompt'/'shape_ref'/'seed'.",
        "atlas": {"source_image": PAGE, "width": 2048, "height": 1024,
                  "format": "RGBA"},
        "style": {}, "regions": [sheet_maker_region()],
        "deploy_basename": "splashes",
    }
    d = Path(str(ui_server.MANIFEST_DIR))
    d.mkdir(parents=True, exist_ok=True)
    p = d / "atlas_manifest_splashes.json"
    p.write_text(json.dumps(doc, indent=2), encoding="utf-8")
    return p


def sheet_texturepacker_frame() -> dict:
    """One frame of the `.json` sheet-tool/atlas_writers.to_texturepacker emits.
    `sourceSize` == the full cell: an UNTRIMMED frame, which is precisely why
    `_tp_frame_to_region` misreads it as a rig's authored slot."""
    return {"frame": {"x": 495, "y": 148, "w": CELL_W, "h": CELL_H},
            "rotated": False, "trimmed": False,
            "spriteSourceSize": {"x": 0, "y": 0, "w": CELL_W, "h": CELL_H},
            "sourceSize": {"w": CELL_W, "h": CELL_H}}


def imported_manifest(regions: list[dict]) -> dict:
    """The shape import_sheet_to_manifest persists — note the page ref is
    rewritten to `refs/atlas/<name>`, which is why the join is on BASENAME."""
    return {"atlas": {"source_image": f"refs/atlas/{PAGE}",
                      "source_image_path": f"refs/atlas/{PAGE}",
                      "width": 2048, "height": 1024, "format": "RGBA8888"},
            "regions": regions, "rotated_regions": []}


def main() -> int:
    # Pin the padding so the fixture reads the same whatever the project config
    # happens to be; the bug reproduces at every value, including 0.
    batch_atlas.PADDING_PCT = 0.0
    batch_atlas.ATLAS_META.update({"width": 2048, "height": 1024})
    cell = make_cell()

    # ---------------------------------------------------------------- handoff
    src = sheet_maker_region()
    norm = ui_server._normalize_converted_region(src)

    check("fit_mode survives the handoff", norm.get("fit_mode"), "contain")
    check("prompt/shape_ref/seed survive too",
          (norm.get("prompt"), norm.get("shape_ref"), norm.get("seed")),
          (src["prompt"], src["shape_ref"], src["seed"]))
    check("empty creative fields are omitted, not carried",
          "prompt" in ui_server._normalize_converted_region(
              {"name": "t", "x": 0, "y": 0, "w": 8, "h": 8, "prompt": ""}),
          False)

    trimmed = ui_server._normalize_converted_region(
        {"name": "t", "x": 0, "y": 0, "w": 100, "h": 50,
         "offX": 7, "offY": 9, "origW": 120, "origH": 80})
    check("camelCase trim -> snake_case",
          (trimmed.get("off_x"), trimmed.get("off_y"),
           trimmed.get("orig_w"), trimmed.get("orig_h")),
          (7, 9, 120, 80))

    # A region with NO trim must not acquire one: orig_* presence is what
    # fit_to_region reads as `spine_slot`, so inventing it selects `fill`.
    untrimmed = ui_server._normalize_converted_region(
        {"name": "t", "x": 0, "y": 0, "w": 100, "h": 50})
    check("no trim in -> no orig_* out",
          ("orig_w" in untrimmed, "orig_h" in untrimmed), (False, False))
    check("an untrimmed cell is not a spine slot",
          ui_server._placement_mode(untrimmed)["key"], "contain")

    # The whole point: Create Atlas over an untouched handoff is a NO-OP.
    check("sheet cell takes the parity path",
          ui_server._placement_mode(norm)["key"], "parity")
    composed = batch_atlas.fit_to_region(cell.copy(), norm)
    check("recompose keeps the tile size", composed.size, (CELL_W, CELL_H))
    check("recompose keeps the art at natural size",
          ink_size(composed), (INK_W, INK_H))
    check("recompose is byte-identical to the sheet",
          composed.tobytes(), cell.tobytes())

    # Guard the failure mode itself, so the checks above cannot pass for the
    # wrong reason if a default ever changes.
    broken = {k: v for k, v in norm.items() if k != "fit_mode"}
    broken["orig_w"], broken["orig_h"] = CELL_W, CELL_H
    check("without fit_mode a cell reads as a spine slot",
          ui_server._placement_mode(broken)["key"], "fill")
    check("...and `fill` stretches the art to the rect",
          ink_size(batch_atlas.fit_to_region(cell.copy(), broken)),
          (CELL_W, CELL_H))

    # ----------------------------------------------------------------- repair
    write_sheet_manifest()

    # Damage route 1: the editor/seed-manifest branch stripped fit_mode.
    m1 = imported_manifest([dict(broken)])
    check("damaged manifest composes through `fill`",
          ui_server._placement_mode(m1["regions"][0])["key"], "fill")
    check("repair reports the region it healed",
          ui_server.repair_sheet_fit_mode(m1), [NAME])
    check("repair writes through to the manifest's own dict",
          m1["regions"][0].get("fit_mode"), "contain")
    check("repaired region is back on the parity path",
          ui_server._placement_mode(m1["regions"][0])["key"], "parity")
    check("repaired recompose is byte-identical to the sheet",
          batch_atlas.fit_to_region(cell.copy(), m1["regions"][0]).tobytes(),
          cell.tobytes())

    # Damage route 2: the raw-TexturePacker branch never had fit_mode, and the
    # Sheet Maker's own .json declares an untrimmed sourceSize.
    tp = ui_server._tp_frame_to_region(NAME, sheet_texturepacker_frame())
    check("a sheet's own .json imports as a spine slot",
          (("orig_w" in tp), ui_server._placement_mode(tp)["key"]),
          (True, "fill"))
    m2 = imported_manifest([tp])
    check("repair heals the TexturePacker route too",
          ui_server.repair_sheet_fit_mode(m2), [NAME])
    check("...back to parity", ui_server._placement_mode(tp)["key"], "parity")

    # Idempotent: a second pass has nothing left to do.
    check("repair is idempotent", ui_server.repair_sheet_fit_mode(m2), [])

    # `tp` was repaired in place above, so every fixture below builds a FRESH
    # region — reusing it would smuggle the healed fit_mode into a case meant
    # to test the untouched default.
    def fresh_tp() -> dict:
        return ui_server._tp_frame_to_region(NAME, sheet_texturepacker_frame())

    # Safety 1: an explicit choice is never overruled.
    m3 = imported_manifest([dict(fresh_tp(), fit_mode="cover")])
    check("an explicit fit_mode is left alone",
          (ui_server.repair_sheet_fit_mode(m3), m3["regions"][0]["fit_mode"]),
          ([], "cover"))

    # Safety 2: no authoring sheet manifest for this page (a rig's `.atlas`, a
    # from-scratch atlas) -> nothing is touched, so `fill` stays the default
    # where a slot really IS a rig's footprint.
    m4 = {"atlas": {"source_image": "refs/atlas/some_rig.png"},
          "regions": [fresh_tp()], "rotated_regions": []}
    check("a page with no authoring sheet is not touched",
          (ui_server.repair_sheet_fit_mode(m4),
           "fit_mode" in m4["regions"][0]),
          ([], False))
    check("...and keeps the spine-slot `fill` default",
          ui_server._placement_mode(m4["regions"][0])["key"], "fill")

    # Safety 3: rotated_regions are repaired as well — they are a separate
    # bucket in the manifest and easy to miss.
    m5 = imported_manifest([])
    m5["rotated_regions"] = [dict(broken)]
    check("rotated_regions are repaired too",
          ui_server.repair_sheet_fit_mode(m5), [NAME])

    print()
    if FAILED:
        print(f"{len(FAILED)} FAILED: " + ", ".join(FAILED))
        return 1
    print("all sheet-handoff fixtures pass")
    return 0


if __name__ == "__main__":
    sys.exit(main())
