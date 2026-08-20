"""Pin the rotation convention so it stops being re-litigated.

Run: `py services/sheet-tool/rot_convention_check.py`

WHY THIS FILE EXISTS. A rotated atlas region is the ONE place PixiJS and Spine
disagree, and the disagreement is unfixable in the `.atlas`:

  * our packers store a rotated region 90 degrees CLOCKWISE -- the TexturePacker /
    PixiJS convention, which Pixi's Spritesheet parser un-rotates at render time;
  * Spine's atlas parser wants the OPPOSITE (counter-clockwise), and spine-webgl
    only honours `degrees` 0 and 90 -- 270 falls through to the unrotated branch.

So a CW-packed region renders 180 degrees UPSIDE DOWN in a rig until the launcher
reorients its page pixels (`reorientRotatedRegionsForSpine`). Both packers already
agree on CW; what kept going wrong was people believing otherwise. `packer.py`'s
docstring asserted the Spine convention -- the exact inverse of what the code does --
for long enough to cause a shipped bug, and the round-trip check that both packers'
comments cite (`_rot_roundtrip_check.py`) was never actually committed, so there was
nothing to run and nothing to fail.

These assertions are the missing artifact. They fail loudly if someone "fixes" the
direction, and they fail if an import re-arms rotation on art we just normalised.
"""

import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))

import packer  # noqa: E402


FAILS = []


def check(name: str, ok: bool) -> None:
    if not ok:
        FAILS.append(name)
        print("FAIL:", name)


def asymmetric_image(w: int, h: int) -> Image.Image:
    """A w x h image whose every corner is a different colour, so ANY rotation or
    mirror is detectable -- a symmetric test image would pass under a wrong flip."""
    img = Image.new("RGBA", (w, h), (0, 0, 0, 255))
    img.putpixel((0, 0), (255, 0, 0, 255))  # top-left     red
    img.putpixel((w - 1, 0), (0, 255, 0, 255))  # top-right    green
    img.putpixel((0, h - 1), (0, 0, 255, 255))  # bottom-left  blue
    img.putpixel((w - 1, h - 1), (255, 255, 0, 255))  # bottom-right yellow
    return img


# --- 1. Rotation is OFF by default, everywhere we pack ------------------------
# The whole class of bug only exists for rotated regions, so the default matters
# more than any downstream compensation.
check(
    "packer.pack defaults to allow_rotation=False",
    packer.pack.__kwdefaults__.get("allow_rotation") is False,
)
check(
    "packer.arrange defaults to allow_rotation=False",
    packer.arrange.__kwdefaults__.get("allow_rotation") is False,
)


# --- 2. `arrange` must not rotate when rotation is off ------------------------
# A tall sprite into a wide canvas is exactly the case a rotating packer would turn
# sideways to save space.
items = [{"name": "tall", "w": 16, "h": 64, "locked": False, "x": 0, "y": 0}]
res = packer.arrange(256, 128, items, padding=2, allow_rotation=False)
placed = res["regions"][0]
check("arrange(allow_rotation=False) leaves the region unrotated", placed["rotated"] is False)
check("arrange(allow_rotation=False) keeps w/h upright", (placed["w"], placed["h"]) == (16, 64))


# --- 3. A rotated region is stored CLOCKWISE ---------------------------------
# The load-bearing assertion. `compose` bakes a rotated region into the page; the
# stored pixels must equal PIL rotate(-90) of the upright art (CW), i.e. rotating the
# stored block back by +90 (CCW) recovers the original. If someone flips the packer
# to satisfy Spine directly, this fails -- and it SHOULD, because the fix belongs in
# the launcher's page reorientation, not here (Pixi consumers would regress).
W, H = 8, 4
upright = asymmetric_image(W, H)
regions = [
    {
        "name": "r",
        "x": 0,
        "y": 0,
        "w": W,
        "h": H,
        "rotated": True,
        "off_x": 0,
        "off_y": 0,
        "orig_w": W,
        "orig_h": H,
    }
]
# `w`/`h` are the UPRIGHT footprint the art is fitted into; `compose` rotates the whole
# cell at the end, so a rotated region lands as an (h x w) block. Page sized to match.
page = packer.compose(regions, H, W, {"r": upright})
stored = page.crop((0, 0, H, W))
check("a rotated region occupies an (h x w) footprint", stored.size == (H, W))
check(
    "rotated pixels are stored CLOCKWISE (rotate(-90) of upright)",
    list(stored.getdata()) == list(upright.rotate(-90, expand=True).getdata()),
)
check(
    "rotating the stored block back CCW recovers the original",
    list(stored.rotate(90, expand=True).getdata()) == list(upright.getdata()),
)
# Guard the inverse explicitly: CCW storage is what Spine wants and what we must NOT do.
check(
    "stored pixels are NOT the counter-clockwise (Spine) direction",
    list(stored.getdata()) != list(upright.rotate(90, expand=True).getdata()),
)


# --- 4. No code path arms rotation behind the artist's back -------------------
# Source-level on purpose: importing `sheet_server` drags in the whole web app, and the
# thing worth guarding is the literal that caused the regression. The editable `.plist`
# import un-rotates every frame into an upright loose sprite and then used to write a
# session with `allow_rotation: True`, immediately re-rotating art it had just
# normalised. The UI checkbox is still there for an artist who wants it -- what must
# never come back is a DEFAULT that turns it on for them.
server_src = (Path(__file__).resolve().parent / "sheet_server.py").read_text(encoding="utf-8")
armed = [
    line.strip()
    for line in server_src.splitlines()
    if '"allow_rotation": True' in line or "'allow_rotation': True" in line
]
check("no path hard-codes allow_rotation=True (found: %s)" % (armed or "none"), not armed)


print(f"{4 + 2 + 4 + 1 - len(FAILS)} passed, {len(FAILS)} failed")
sys.exit(1 if FAILS else 0)
