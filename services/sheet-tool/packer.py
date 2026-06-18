"""
Sprite-sheet bin packer (MaxRects, Best-Short-Side-Fit) + sheet compositor.

Pure stdlib + Pillow. Packs a list of loose images into one fixed-width sheet
whose height is cropped to what the layout actually uses. Optional inter-sprite
padding, 90 degree rotation, and power-of-two sheet dimensions.

Region dicts returned use the same normalized shape the Atlas Maker consumes:

    {name, x, y, w, h, rotated, off_x, off_y, orig_w, orig_h}

where (x,y) is the top-left on the sheet, (w,h) is the DISPLAY size (original,
untrimmed) and `rotated` means the pixels were stored rotated 90 degrees
clockwise (footprint on the sheet is hxw). off_x/off_y/orig_* are kept for
parity with the .atlas format; this packer does not trim, so off=0 and
orig=display size.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image


# ---------------------------------------------------------------------------
# MaxRects core
# ---------------------------------------------------------------------------

class _MaxRects:
    """Single-bin MaxRects with Best-Short-Side-Fit placement + free-rect
    splitting/pruning. Coordinates are integers."""

    def __init__(self, width: int, height: int, allow_rotation: bool):
        self.width = width
        self.height = height
        self.allow_rotation = allow_rotation
        self.free = [(0, 0, width, height)]  # (x, y, w, h)

    def insert(self, w: int, h: int):
        """Place a wxh rect. Returns (x, y, placed_w, placed_h, rotated) or None."""
        best = self._find(w, h)
        if best is None:
            return None
        x, y, pw, ph, rotated = best
        self._place((x, y, pw, ph))
        return x, y, pw, ph, rotated

    def occupy(self, x: int, y: int, w: int, h: int) -> None:
        """Carve out an already-placed (locked) rectangle so later inserts
        avoid it. Used to honour locked sprites before auto-arranging."""
        self._place((int(x), int(y), int(w), int(h)))

    def _find(self, w: int, h: int):
        best = None
        best_short = best_long = None
        for (fx, fy, fw, fh) in self.free:
            for cand_w, cand_h, rot in self._orientations(w, h):
                if cand_w <= fw and cand_h <= fh:
                    leftover_h = fw - cand_w
                    leftover_v = fh - cand_h
                    short = min(leftover_h, leftover_v)
                    long_ = max(leftover_h, leftover_v)
                    if best is None or short < best_short or (short == best_short and long_ < best_long):
                        best = (fx, fy, cand_w, cand_h, rot)
                        best_short, best_long = short, long_
        return best

    def _orientations(self, w: int, h: int):
        yield (w, h, False)
        if self.allow_rotation and w != h:
            yield (h, w, True)

    def _place(self, used: tuple[int, int, int, int]) -> None:
        new_free = []
        for fr in self.free:
            split = self._split(fr, used)
            if split is None:
                new_free.append(fr)
            else:
                new_free.extend(split)
        self.free = self._prune(new_free)

    @staticmethod
    def _intersects(a, b) -> bool:
        ax, ay, aw, ah = a
        bx, by, bw, bh = b
        return not (bx >= ax + aw or bx + bw <= ax or by >= ay + ah or by + bh <= ay)

    def _split(self, free, used):
        if not self._intersects(free, used):
            return None
        fx, fy, fw, fh = free
        ux, uy, uw, uh = used
        out = []
        # Left slab
        if ux > fx and ux < fx + fw:
            out.append((fx, fy, ux - fx, fh))
        # Right slab
        if ux + uw < fx + fw:
            out.append((ux + uw, fy, fx + fw - (ux + uw), fh))
        # Top slab
        if uy > fy and uy < fy + fh:
            out.append((fx, fy, fw, uy - fy))
        # Bottom slab
        if uy + uh < fy + fh:
            out.append((fx, uy + uh, fw, fy + fh - (uy + uh)))
        return out

    @staticmethod
    def _contained(a, b) -> bool:
        """True if rect a is fully inside rect b."""
        ax, ay, aw, ah = a
        bx, by, bw, bh = b
        return ax >= bx and ay >= by and ax + aw <= bx + bw and ay + ah <= by + bh

    def _prune(self, rects):
        out = []
        for i, a in enumerate(rects):
            if a[2] <= 0 or a[3] <= 0:
                continue
            if any(j != i and self._contained(a, b) for j, b in enumerate(rects)
                   if b[2] > 0 and b[3] > 0):
                continue
            out.append(a)
        return out


# ---------------------------------------------------------------------------
# Public packing API
# ---------------------------------------------------------------------------

def _next_pow2(n: int) -> int:
    p = 1
    while p < n:
        p <<= 1
    return p


def pack(items: list[dict], *, width: int = 2048, height: int = 0, padding: int = 2,
         allow_rotation: bool = False, power_of_two: bool = False) -> dict:
    """Pack items into a sheet.

    items: [{name, w, h, path?}, ...] — w/h are the source image pixel sizes.

    Sizing modes:
      * height <= 0  -> AUTO: `width` is the max width (grown only if a single
        sprite is wider); the sheet height is cropped to what the layout uses.
      * height  > 0  -> FIXED: the sheet is exactly `width` x `height`; sprites
        are packed into that bin and a ValueError is raised if they don't fit.

    Returns {width, height, regions:[...]} with normalized region dicts.
    """
    if not items:
        return {"width": 0, "height": 0, "regions": []}

    fixed = int(height) > 0
    widest = max(it["w"] for it in items)
    if fixed:
        sheet_w = int(width)
        if widest + 2 * padding > sheet_w:
            raise ValueError(f"Sprite is wider ({widest}px) than the fixed "
                             f"sheet width ({sheet_w}px). Increase the width.")
        bin_h = int(height)
    else:
        sheet_w = max(int(width), widest + 2 * padding)
        # Generous height bound; cropped afterwards.
        bin_h = sum(it["h"] + padding for it in items) + padding

    # Pack largest-area first for a tighter layout.
    order = sorted(range(len(items)), key=lambda i: items[i]["w"] * items[i]["h"], reverse=True)

    mr = _MaxRects(sheet_w, bin_h, allow_rotation)
    placed: dict[int, tuple] = {}
    for i in order:
        it = items[i]
        # Reserve padding on the right/bottom by inflating the request.
        res = mr.insert(it["w"] + padding, it["h"] + padding)
        if res is None:
            where = f"{sheet_w}x{height}" if fixed else f"{sheet_w}px-wide"
            raise ValueError(f"Could not place sprite {it['name']!r} "
                             f"({it['w']}x{it['h']}) on a {where} sheet. "
                             + ("Increase the size or enable rotation."
                                if fixed else "Try a wider sheet."))
        placed[i] = res

    if fixed:
        final_h = int(height)
    else:
        used_h = max(y + ph for (_x, y, _pw, ph, _r) in placed.values())
        final_h = used_h + padding

    if power_of_two:
        sheet_w = _next_pow2(sheet_w)
        final_h = _next_pow2(final_h)

    regions = []
    for i, it in enumerate(items):
        x, y, pw, ph, rot = placed[i]
        regions.append({
            "name": it["name"],
            "x": x, "y": y,
            "w": it["w"], "h": it["h"],   # display size (original)
            "rotated": bool(rot),
            "off_x": 0, "off_y": 0,
            "orig_w": it["w"], "orig_h": it["h"],
        })
    return {"width": sheet_w, "height": final_h, "regions": regions}


def arrange(canvas_w: int, canvas_h: int, items: list[dict], *,
            padding: int = 2, allow_rotation: bool = False) -> dict:
    """Free-canvas auto-arrange: keep LOCKED sprites where they are, pack the
    UNLOCKED ones into the remaining space of a fixed canvas_w x canvas_h sheet.

    items: [{name, w, h, locked, x, y, rotated?}, ...] — w/h are the CURRENT
    (possibly user-resized) display sizes. Locked items must carry x/y.

    Returns {regions:[{name,x,y,w,h,rotated,locked}], unplaced:[names]}.
    Locked items are returned unchanged; unplaced unlocked items keep their
    incoming x/y (or 0,0) and are flagged in `unplaced`."""
    mr = _MaxRects(int(canvas_w), int(canvas_h), allow_rotation)

    out: list[dict] = []
    locked = [it for it in items if it.get("locked")]
    unlocked = [it for it in items if not it.get("locked")]

    for it in locked:
        fw = it["h"] if it.get("rotated") else it["w"]
        fh = it["w"] if it.get("rotated") else it["h"]
        mr.occupy(it.get("x", 0), it.get("y", 0), fw + padding, fh + padding)
        out.append({"name": it["name"], "x": int(it.get("x", 0)), "y": int(it.get("y", 0)),
                    "w": int(it["w"]), "h": int(it["h"]),
                    "rotated": bool(it.get("rotated")), "locked": True})

    unplaced: list[str] = []
    # Largest-area first for a tighter pack.
    for it in sorted(unlocked, key=lambda i: i["w"] * i["h"], reverse=True):
        res = mr.insert(it["w"] + padding, it["h"] + padding)
        if res is None:
            unplaced.append(it["name"])
            out.append({"name": it["name"], "x": int(it.get("x", 0)), "y": int(it.get("y", 0)),
                        "w": int(it["w"]), "h": int(it["h"]),
                        "rotated": bool(it.get("rotated")), "locked": False})
            continue
        x, y, _pw, _ph, rot = res
        out.append({"name": it["name"], "x": x, "y": y,
                    "w": int(it["w"]), "h": int(it["h"]),
                    "rotated": bool(rot), "locked": False})

    by_name = {r["name"]: r for r in out}
    ordered = [by_name[it["name"]] for it in items if it["name"] in by_name]
    return {"regions": ordered, "unplaced": unplaced}


def compose(regions: list[dict], width: int, height: int,
            image_for: dict[str, Image.Image | str | Path]) -> Image.Image:
    """Paste each region's source image onto a transparent RGBA sheet.

    Each region's FOOTPRINT on the sheet is its (w,h) box. The source image is
    drawn at its own (iw,ih) image size (defaulting to the region size) and
    CENTRED inside that box, so a region can be larger than its art — the
    surrounding transparent margin is baked into the region's frame. The region
    is always kept at least as large as the image so the art is never cropped
    and never overflows its packed cell.

    image_for maps region name -> a PIL Image or a path. Rotated regions are
    stored rotated 90 degrees clockwise (Spine `rotate:90` convention)."""
    sheet = Image.new("RGBA", (max(1, int(width)), max(1, int(height))), (0, 0, 0, 0))
    for r in regions:
        src = image_for.get(r["name"])
        if src is None:
            continue
        opened = None if isinstance(src, Image.Image) else Image.open(src)
        img = src if opened is None else opened
        try:
            if img.mode != "RGBA":
                img = img.convert("RGBA")
            w, h = int(r["w"]), int(r["h"])               # region (footprint) box
            iw = int(r.get("iw") or w)                    # image draw size
            ih = int(r.get("ih") or h)
            # The region never shrinks below the image — guards against an
            # overflow that would spill into a neighbouring packed cell.
            rw, rh = max(w, iw), max(h, ih)
            if (img.width, img.height) != (iw, ih) and iw > 0 and ih > 0:
                img = img.resize((iw, ih), Image.LANCZOS)
            if (rw, rh) != (iw, ih):
                tile = Image.new("RGBA", (rw, rh), (0, 0, 0, 0))
                tile.alpha_composite(img, ((rw - iw) // 2, (rh - ih) // 2))
                img = tile
            if r.get("rotated"):
                img = img.rotate(-90, expand=True)  # clockwise
            sheet.alpha_composite(img, (int(r["x"]), int(r["y"])))
        finally:
            if opened is not None:
                opened.close()
    return sheet


def measure(path: str | Path) -> tuple[int, int]:
    """Return (width, height) of an image without keeping it open."""
    with Image.open(path) as im:
        return im.width, im.height
