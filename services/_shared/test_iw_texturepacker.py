"""Offline guard: one TexturePacker writer, two dialects, both outputs unchanged.

Run:  PYTHONPATH=. py test_iw_texturepacker.py     (from services/_shared)

The Atlas Maker and the Sheet Maker each had their own writer, differing in ONE
field: a rotated frame's `frame.w/h`. Each output is read as it is — the Atlas
Maker's (UPRIGHT) by the game's PixiJS `Spritesheet`, the Sheet Maker's
(FOOTPRINT) by the launcher's `backfillMissingGeometry` — so the merge must not
move a byte of either. The two writers as they were are kept below as the
reference, and each tool's `atlas_writers` is loaded from its own folder to prove
it still selects its own dialect.
"""
from __future__ import annotations

import importlib.util
import json
import tempfile
from pathlib import Path

from iw_common import texturepacker
from iw_common.testkit import Suite

t = Suite()
SERVICES = Path(__file__).resolve().parent.parent

REGIONS = [
    {"name": "a", "x": 0, "y": 0, "w": 10, "h": 20, "rotated": False},
    {"name": "b.png", "x": 10, "y": 0, "w": 30, "h": 12, "rotated": True,
     "off_x": 2, "off_y": 3, "orig_w": 40, "orig_h": 18},
    {"name": "c.webp", "x": "5", "y": 7.0, "w": 8.9, "h": "4", "rotated": 1},
    {"name": "ñame", "x": 1, "y": 2, "w": 3, "h": 4},
]


def _reference(path: Path, image_name: str, width: int, height: int, regions: list[dict],
               *, swap: bool, app: str) -> None:
    """Both tools' writers before the merge (identical but for `swap` and `app`)."""
    frames: dict[str, dict] = {}
    for r in regions:
        dw, dh = int(r["w"]), int(r["h"])
        rotated = bool(r.get("rotated"))
        fw, fh = (dh, dw) if (rotated and swap) else (dw, dh)
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


def test_each_tool_writes_exactly_what_it_did() -> None:
    out = Path(tempfile.mkdtemp(prefix="iw-tp-"))
    for service, swap, app in (("atlas-tool", False, "Invisible Atlas Maker"),
                               ("sheet-tool", True, "Invisible Sheet Maker")):
        _reference(out / f"{service}.ref.json", "page.webp", 64, 32, REGIONS, swap=swap, app=app)
        _tool_writer(service)(out / f"{service}.json", "page.webp", 64, 32, REGIONS)
        t.check(f"{service}: byte-identical to its writer before the merge",
                (out / f"{service}.json").read_bytes(), (out / f"{service}.ref.json").read_bytes())


def test_the_dialects() -> None:
    rot = [{"name": "r", "x": 4, "y": 5, "w": 30, "h": 12, "rotated": True}]
    up = texturepacker.texturepacker_doc("p.png", 64, 64, rot, app="A",
                                         dialect=texturepacker.UPRIGHT)["frames"]["r.png"]
    fp = texturepacker.texturepacker_doc("p.png", 64, 64, rot, app="A",
                                         dialect=texturepacker.FOOTPRINT)["frames"]["r.png"]
    t.check("UPRIGHT: a rotated frame keeps its display size (TexturePacker / PixiJS)",
            (up["frame"]["w"], up["frame"]["h"]), (30, 12))
    t.check("FOOTPRINT: a rotated frame is the on-page h x w",
            (fp["frame"]["w"], fp["frame"]["h"]), (12, 30))
    t.check("...and nothing else differs", {**up, "frame": None}, {**fp, "frame": None})
    flat = [{**rot[0], "rotated": False}]
    t.check("an unrotated frame is the same in both",
            texturepacker.texturepacker_doc("p.png", 64, 64, flat, app="A", dialect="upright"),
            texturepacker.texturepacker_doc("p.png", 64, 64, flat, app="A", dialect="footprint"))
    try:
        texturepacker.texturepacker_doc("p.png", 1, 1, [], app="A", dialect="swapped")
        refused = False
    except ValueError:
        refused = True
    t.check("an unknown dialect is refused, not guessed", refused, True)


if __name__ == "__main__":
    t.run(test_each_tool_writes_exactly_what_it_did, test_the_dialects)
    t.exit("iw_common.texturepacker")
