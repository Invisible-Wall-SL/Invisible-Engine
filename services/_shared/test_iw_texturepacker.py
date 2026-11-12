"""Offline guard: one TexturePacker writer, one dialect — a rotated frame is UPRIGHT.

Run:  PYTHONPATH=. py test_iw_texturepacker.py                  (from services/_shared)
      PYTHONPATH=. py test_iw_texturepacker.py --write-fixture  (after a deliberate change)

The Atlas Maker and the Sheet Maker share `iw_common.texturepacker`. Until 2026-11-10 the
Sheet Maker swapped a rotated frame's `frame.w/h` to the on-page footprint, which PixiJS's
`Spritesheet` and the launcher's direct reader both misread. Now both tools write the
Atlas Maker's form, byte for byte (the writer as it stood before the shared module is kept
below as the reference), and differ only in `meta.app`.

`fixtures/texturepacker-rotated.json` is the Sheet Maker writer's output for FIXTURE_REGIONS.
The launcher's `check-texturepacker-rotation.ts` reads that same file through the real
`loadRegionSet` and a real PixiJS `Spritesheet`, so the two checks together are the round
trip writer -> launcher reader -> Pixi frame.
"""
from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
from pathlib import Path

from iw_common import texturepacker
from iw_common.testkit import Suite

t = Suite()
HERE = Path(__file__).resolve().parent
SERVICES = HERE.parent
FIXTURE = HERE / "fixtures" / "texturepacker-rotated.json"

REGIONS = [
    {"name": "a", "x": 0, "y": 0, "w": 10, "h": 20, "rotated": False},
    {"name": "b.png", "x": 10, "y": 0, "w": 30, "h": 12, "rotated": True,
     "off_x": 2, "off_y": 3, "orig_w": 40, "orig_h": 18},
    {"name": "c.webp", "x": "5", "y": 7.0, "w": 8.9, "h": "4", "rotated": 1},
    {"name": "ñame", "x": 1, "y": 2, "w": 3, "h": 4},
]

# A 64x64 page: an upright cell and two rotated ones, one wide and one tall
# (30x12 upright -> a 12x30 footprint at (10,0); 8x20 -> 20x8 at (24,0)).
FIXTURE_REGIONS = [
    {"name": "flat", "x": 0, "y": 0, "w": 10, "h": 20, "rotated": False},
    {"name": "wide", "x": 10, "y": 0, "w": 30, "h": 12, "rotated": True},
    {"name": "tall", "x": 24, "y": 0, "w": 8, "h": 20, "rotated": True},
]


def _reference(path: Path, image_name: str, width: int, height: int, regions: list[dict],
               *, app: str) -> None:
    """The Atlas Maker's writer before `iw_common.texturepacker` existed."""
    frames: dict[str, dict] = {}
    for r in regions:
        dw, dh = int(r["w"]), int(r["h"])
        key = r["name"] if "." in r["name"] else f"{r['name']}.png"
        frames[key] = {
            "frame": {"x": int(r["x"]), "y": int(r["y"]), "w": dw, "h": dh},
            "rotated": bool(r.get("rotated")),
            "trimmed": False,
            "spriteSourceSize": {"x": int(r.get("off_x", 0)), "y": int(r.get("off_y", 0)),
                                 "w": dw, "h": dh},
            "sourceSize": {"w": int(r.get("orig_w", dw)), "h": int(r.get("orig_h", dh))},
        }
    doc = {
        "frames": frames,
        "meta": {"app": app, "version": "1.0", "image": image_name, "format": "RGBA8888",
                 "size": {"w": int(width), "h": int(height)}, "scale": "1"},
    }
    path.write_text(json.dumps(doc, indent=2), encoding="utf-8")


def _tool_writer(service: str):
    spec = importlib.util.spec_from_file_location(
        f"atlas_writers_{service.replace('-', '_')}", SERVICES / service / "atlas_writers.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.write_texturepacker_json


def _sheet_maker_fixture(path: Path) -> None:
    _tool_writer("sheet-tool")(path, "page.png", 64, 64, FIXTURE_REGIONS)


def test_both_tools_write_the_upright_form() -> None:
    out = Path(tempfile.mkdtemp(prefix="iw-tp-"))
    for service, app in (("atlas-tool", "Invisible Atlas Maker"),
                         ("sheet-tool", "Invisible Sheet Maker")):
        _reference(out / f"{service}.ref.json", "page.webp", 64, 32, REGIONS, app=app)
        _tool_writer(service)(out / f"{service}.json", "page.webp", 64, 32, REGIONS)
        t.check(f"{service}: byte-identical to the Atlas Maker's original writer",
                (out / f"{service}.json").read_bytes(), (out / f"{service}.ref.json").read_bytes())


def test_a_rotated_frame_keeps_its_upright_size() -> None:
    rot = [{"name": "r", "x": 4, "y": 5, "w": 30, "h": 12, "rotated": True}]
    f = texturepacker.texturepacker_doc("p.png", 64, 64, rot, app="A")["frames"]["r.png"]
    t.check("frame.w/h is the display size (TexturePacker / PixiJS)",
            (f["frame"]["w"], f["frame"]["h"]), (30, 12))
    t.check("...the same as spriteSourceSize, which is how a reader tells it from the legacy "
            "swapped form", (f["spriteSourceSize"]["w"], f["spriteSourceSize"]["h"]), (30, 12))
    t.check("...and marked rotated", f["rotated"], True)


def test_the_launcher_fixture_is_this_writers_output() -> None:
    out = Path(tempfile.mkdtemp(prefix="iw-tp-fixture-")) / "fixture.json"
    _sheet_maker_fixture(out)
    t.check(f"{FIXTURE.relative_to(SERVICES.parent).as_posix()} matches the Sheet Maker writer "
            "(re-run with --write-fixture after a deliberate change)",
            json.loads(FIXTURE.read_text(encoding="utf-8")),
            json.loads(out.read_text(encoding="utf-8")))


if __name__ == "__main__":
    if "--write-fixture" in sys.argv:
        FIXTURE.parent.mkdir(parents=True, exist_ok=True)
        _sheet_maker_fixture(FIXTURE)
        print(f"wrote {FIXTURE}")
        sys.exit(0)
    t.run(test_both_tools_write_the_upright_form, test_a_rotated_frame_keeps_its_upright_size,
          test_the_launcher_fixture_is_this_writers_output)
    t.exit("iw_common.texturepacker")
