"""Offline fixtures for Region border packing and the layout round-trip (no R2, no network).

    py test_region_layout.py    (from services/sheet-tool, PYTHONPATH=../_shared:.)

Region border = the space a cell keeps clear around itself. packer.arrange
inflates every cell by its own border on all sides, so two neighbours sit
border A + border B apart and a cell sits its border away from the canvas edge.
Region padding (art to cell edge) is the editor's: it only sets the cell size.
"""
from __future__ import annotations

import os
import sys
import tempfile

os.environ["SHEET_STAGING"] = tempfile.mkdtemp(prefix="sheet-layout-")

import atlas_writers  # noqa: E402
import packer  # noqa: E402
import sheet_server  # noqa: E402

FAILED: list[str] = []


def check(label: str, got, want) -> None:
    ok = got == want
    print(("ok   " if ok else "FAIL ") + label + ("" if ok else f"  got {got!r}, want {want!r}"))
    if not ok:
        FAILED.append(label)


def fp(r: dict) -> tuple[int, int]:
    return (r["h"], r["w"]) if r["rotated"] else (r["w"], r["h"])


def min_gap(res: dict, a: str, b: str) -> int:
    """Larger of the X / Y gaps between two cells (the one that separates them)."""
    ra = next(r for r in res["regions"] if r["name"] == a)
    rb = next(r for r in res["regions"] if r["name"] == b)
    (aw, ah), (bw, bh) = fp(ra), fp(rb)
    gx = max(rb["x"] - (ra["x"] + aw), ra["x"] - (rb["x"] + bw))
    gy = max(rb["y"] - (ra["y"] + ah), ra["y"] - (rb["y"] + bh))
    return max(gx, gy)


def main() -> int:
    two = [{"name": "a", "w": 100, "h": 100, "border_x": 3, "border_y": 3},
           {"name": "b", "w": 100, "h": 100, "border_x": 3, "border_y": 3}]
    res = packer.arrange(400, 120, two)
    check("two cells with border 3 sit 3 + 3 = 6 apart", min_gap(res, "a", "b"), 6)
    check("...and each keeps its border from the canvas edge",
          min(min(r["x"], r["y"]) for r in res["regions"]), 3)

    mixed = [{"name": "a", "w": 100, "h": 100, "border_x": 4, "border_y": 4},
             {"name": "b", "w": 100, "h": 100, "border_x": 10, "border_y": 10}]
    res = packer.arrange(400, 130, mixed)
    check("a 4 px and a 10 px border sit 14 apart", min_gap(res, "a", "b"), 14)

    nob = [{"name": f"s{i}", "w": 50, "h": 50} for i in range(4)]
    res = packer.arrange(100, 100, nob)
    check("no border packs flush, edge to edge", res["unplaced"], [])

    res = packer.arrange(100, 100, [dict(it, border_x=1, border_y=1) for it in nob])
    check("what no longer fits with its border is reported unplaced", len(res["unplaced"]), 3)

    locked = [{"name": "L", "w": 50, "h": 50, "locked": True, "x": 0, "y": 0,
               "border_x": 5, "border_y": 5},
              {"name": "n", "w": 50, "h": 50, "border_x": 5, "border_y": 5}]
    res = packer.arrange(200, 60, locked)
    check("a locked cell stays put", (res["regions"][0]["x"], res["regions"][0]["y"]), (0, 0))
    check("...and the packed one keeps both borders from it", min_gap(res, "L", "n"), 10)

    tall = [{"name": "t", "w": 20, "h": 100, "border_x": 2, "border_y": 8}]
    res = packer.arrange(130, 40, tall, allow_rotation=True)
    t = res["regions"][0]
    check("a rotated cell keeps its X border on X and Y border on Y",
          (res["unplaced"], t["rotated"], t["x"], t["y"]), ([], True, 2, 8))

    man = atlas_writers.build_manifest(
        "p.png", 64, 64,
        [{"name": "a", "x": 0, "y": 0, "w": 8, "h": 8, "border_x": 6},
         {"name": "b", "x": 9, "y": 0, "w": 8, "h": 8}],
        layout={"region_pad_x": 4, "region_pad_y": 4, "region_border_x": 2, "region_border_y": 2})
    parsed = sheet_server._parse_manifest(man)
    check("a cell's border override survives save -> load",
          {k: parsed["regions"][0].get(k) for k in ("border_x", "border_y")},
          {"border_x": 6, "border_y": None})
    check("...a cell without one stays without", "border_x" in parsed["regions"][1], False)
    check("...and the sheet's layout comes back", parsed.get("layout"),
          {"region_pad_x": 4, "region_pad_y": 4, "region_border_x": 2, "region_border_y": 2})
    man = atlas_writers.build_manifest(
        "p.png", 64, 64,
        [{"name": "own", "x": 0, "y": 0, "w": 8, "h": 8,
          **sheet_server._cell_layout({"pad_x": "-1.5", "pad_y": 3})},
         {"name": "global", "x": 9, "y": 0, "w": 8, "h": 8,
          **sheet_server._cell_layout({"pad_x": None, "pad_y": "x"})}])
    regs = sheet_server._parse_manifest(man)["regions"]
    check("a cell with Own padding keeps it through save -> load (half and negative px too)",
          (regs[0].get("pad_x"), regs[0].get("pad_y")), (-1.5, 3.0))
    check("...a cell without it stores none, so it follows the sheet",
          ("pad_x" in regs[1], "pad_y" in regs[1]), (False, False))
    check("an old manifest without a layout loads none", "layout" in sheet_server._parse_manifest(
        atlas_writers.build_manifest("p.png", 8, 8, [])), False)

    if FAILED:
        print(f"{len(FAILED)} FAILED: " + ", ".join(FAILED))
        return 1
    print("all region-layout fixtures pass")
    return 0


if __name__ == "__main__":
    sys.exit(main())
