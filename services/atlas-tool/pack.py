"""
Bin packer (MaxRects, Best-Short-Side-Fit) for auto-laid-out atlases.

Pure stdlib. Packs a list of measured items {name, w, h} into one sheet whose
height auto-crops to what the layout uses (or a fixed bin). Used by the Atlas
Maker's "from-scratch" flow: generate loose AI art per region, measure each
trimmed footprint, then pack them into a page and stamp the geometry back onto
the manifest so compose + deploy (which already read region x/y/w/h + off/orig)
produce the game's page + TexturePacker descriptor.

This is a PORT of `services/sheet-tool/packer.py`'s `_MaxRects` + `pack()` (the
Sheet Maker owns the canonical layout algorithm). Kept as a separate copy — the
two services deploy independently. The `_MaxRects` core is identical; `pack()`
has ONE intentional divergence: in AUTO mode (`height <= 0`) this copy crops the
sheet WIDTH to the layout's used bounding box, whereas the Sheet Maker keeps the
full requested `width` (its cells are laid out against a fixed sheet width the
user sees). The from-scratch atlas has no such fixed width, so a page with a
little art should be snug, not a full 2048-wide sheet of empty space. Only the
layout/geometry differs — this does NOT touch compose parity, which lives in
`batch_atlas._packer_compose_tile` ↔ `packer.compose` (keep THOSE in lockstep).

Region dicts returned use the normalized shape the Atlas Maker consumes:

    {name, x, y, w, h, rotated, off_x, off_y, orig_w, orig_h}

where (x, y) is the top-left on the sheet, (w, h) is the DISPLAY size and
`rotated` means the pixels are stored rotated 90 degrees clockwise (footprint
h x w). This packer does not trim, so off=0 and orig=display size — the CALLER
supplies already-trimmed sizes.
"""

from __future__ import annotations


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
        avoid it."""
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
                    if best is None or short < best_short or (
                            short == best_short and long_ < best_long):
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


def _next_pow2(n: int) -> int:
    p = 1
    while p < n:
        p <<= 1
    return p


def pack(items: list[dict], *, width: int = 2048, height: int = 0, padding: int = 2,
         allow_rotation: bool = False, power_of_two: bool = False) -> dict:
    """Pack items into a sheet.

    items: [{name, w, h}, ...] — w/h are the (already-trimmed) pixel sizes.

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
    order = sorted(range(len(items)),
                   key=lambda i: items[i]["w"] * items[i]["h"], reverse=True)

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
        final_w = sheet_w
        final_h = int(height)
    else:
        # AUTO: crop BOTH axes to the bounding box the layout actually used, so
        # a page with a little art isn't a full `width`-wide sheet of empty
        # space. `pw`/`ph` already include the per-sprite padding inflation, so
        # `x + pw` / `y + ph` is the padded right/bottom edge; a final trailing
        # `padding` mirrors the leading gutter. Every placement fits inside the
        # original sheet_w, so cropping never clips a sprite.
        used_w = max(x + pw for (x, _y, pw, _ph, _r) in placed.values())
        used_h = max(y + ph for (_x, y, _pw, ph, _r) in placed.values())
        final_w = min(sheet_w, used_w + padding)
        final_h = used_h + padding

    if power_of_two:
        final_w = _next_pow2(final_w)
        final_h = _next_pow2(final_h)

    regions = []
    for i, it in enumerate(items):
        x, y, pw, ph, rot = placed[i]
        regions.append({
            "name": it["name"],
            "x": x, "y": y,
            "w": it["w"], "h": it["h"],   # display size (trimmed)
            "rotated": bool(rot),
            "off_x": 0, "off_y": 0,
            "orig_w": it["w"], "orig_h": it["h"],
        })
    return {"width": final_w, "height": final_h, "regions": regions}
