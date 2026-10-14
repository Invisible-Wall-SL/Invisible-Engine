"""Offline fixtures for the auto-arrange border (no R2, no network).

    py test_arrange_border.py    (from services/sheet-tool, PYTHONPATH=../_shared:.)

The Canvas card's Border X / Y keeps every packed region that far from the
canvas edges. The bin starts at (border_x, border_y) and may run `padding` into
the far border, because each insert reserves its trailing gap: that strip is
gap, never art.
"""
from __future__ import annotations

import sys

import packer

FAILED: list[str] = []


def check(label: str, got, want) -> None:
    ok = got == want
    print(("ok   " if ok else "FAIL ") + label + ("" if ok else f"  got {got!r}, want {want!r}"))
    if not ok:
        FAILED.append(label)


def placed(res: dict) -> list[dict]:
    return [r for r in res["regions"] if r["name"] not in res["unplaced"]]


def inside(res: dict, cw: int, ch: int, bx: int, by: int) -> bool:
    return all(r["x"] >= bx and r["y"] >= by
               and r["x"] + (r["h"] if r["rotated"] else r["w"]) <= cw - bx
               and r["y"] + (r["w"] if r["rotated"] else r["h"]) <= ch - by
               for r in placed(res))


def main() -> int:
    nine = [{"name": f"s{i}", "w": 100, "h": 100} for i in range(9)]
    res = packer.arrange(400, 400, nine, padding=2, border_x=40, border_y=30)
    check("every sprite fits inside a 40 x 30 border", res["unplaced"], [])
    check("...and none crosses it", inside(res, 400, 400, 40, 30), True)

    tight = [{"name": f"t{i}", "w": 98, "h": 98} for i in range(9)]
    res = packer.arrange(310, 310, tight, padding=2, border_x=5, border_y=5)
    check("an exact fit still fits (trailing padding may sit in the border)", res["unplaced"], [])
    check("...with the art inside the border", inside(res, 310, 310, 5, 5), True)

    res = packer.arrange(300, 300, nine, padding=2, border_x=40, border_y=40)
    check("what no longer fits is reported unplaced, not pushed over the border",
          len(res["unplaced"]), 5)
    check("...and the placed ones stay inside", inside(res, 300, 300, 40, 40), True)

    locked = [{"name": "L", "w": 50, "h": 50, "locked": True, "x": 0, "y": 0}]
    res = packer.arrange(200, 200, locked + nine[:1], padding=0, border_x=20, border_y=20)
    check("a locked sprite in the border is left where it is",
          (res["regions"][0]["x"], res["regions"][0]["y"]), (0, 0))
    check("...and the packed one avoids it and the border",
          (res["regions"][1]["x"] >= 50 or res["regions"][1]["y"] >= 50)
          and inside({"regions": res["regions"][1:], "unplaced": []}, 200, 200, 20, 20), True)

    res = packer.arrange(256, 256, nine[:4], padding=2)
    check("no border is the old behaviour (packs from 0,0)",
          min((r["x"], r["y"]) for r in res["regions"]), (0, 0))

    if FAILED:
        print(f"{len(FAILED)} FAILED: " + ", ".join(FAILED))
        return 1
    print("all arrange-border fixtures pass")
    return 0


if __name__ == "__main__":
    sys.exit(main())
