"""Offline guard: an atlas whose GEOMETRY WAS AUTHORED ELSEWHERE can be given a
layout, and knows what that costs (no R2, no GPU, no ComfyUI).

Run:  PYTHONIOENCODING=utf-8 PYTHONPATH="../_shared;." py test_authored_geometry_layout.py
      (from services/atlas-tool)

THE CATCH-22 THIS OPENS. #717 gated the Layout dropdown on
`batch_atlas.is_from_scratch` -- "the manifest already says `pack` or `grid`".
The reasoning was to protect a `.atlas`-BOUND atlas, whose authored rects the
packer would re-measure and overwrite with no undo. That conflated two
different things: "no `layout` key" does NOT mean "bound". Read off the owner's
own bucket (`invisible_wall/test6/manifests/`), the manifests fall into three
kinds, not two:

  BOUND              `atlas.atlas_file` set. S_CaughtSymbols, S_UI,
                     S_New_Whaler_Idle, S_New_Whaler_Spin. Refusing these is
                     correct and stays.
  AUTHORED GEOMETRY  no `layout` AND no `atlas_file`, but real rects
                     (x/y/w/h + offX/offY/origW/origH) and a
                     `texturepacker_json`. S_New_Boot_Sink (1934x968, 13
                     regions), S_New_Boot, S_New_Lobster_Idle. These got no
                     Layout row and could therefore NEVER reach the grid --
                     the dropdown that assigns a layout was withheld from
                     exactly the atlases that had no layout.
  FROM SCRATCH       `pack` or `grid`. Already worked; must keep working
                     byte-for-byte (section 5 pins it against a real capture
                     of origin/main).

THE THREE THINGS THAT MAKE THE FIX SAFE.

1. THE GATE MOVES TO THE BINDING, not to the missing layout:
   `batch_atlas.can_choose_layout(m)` = "not bound to a `.atlas`". Section 1
   pins the refusal of a bound atlas at BOTH layers (render and save), which is
   the safety property the whole switch rests on, and section 2 pins that an
   authored-geometry manifest now gets the row.

2. A THIRD OPTION, SELECTED, THAT MEANS "LEAVE IT ALONE". An authored-geometry
   manifest is neither `pack` nor `grid`, and `_control_html` used to normalise
   an unrecognised/absent value to `pack`. Had the row simply appeared it would
   have opened saying "Pack the art" for an atlas whose geometry came from
   somewhere else, and one Save would have handed 13 real rects to the packer --
   a worse bug than the one being fixed. So the dropdown offers
   `ATLAS_LAYOUT_AUTHORED` ("Authored geometry (leave as is)"), selected, whose
   value is BLANK -- and a blank `_ATLAS_GEOM_KEYS` value is SKIPPED on save, so
   choosing it is a genuine no-op rather than a write. That deliberately
   reverses #717's "no blank option" rule FOR THIS CASE ONLY AND FOR THE
   OPPOSITE REASON: there, blank would have looked changeable while doing
   nothing; here, "does nothing" is precisely the honest meaning. Section 3.

3. MOVING OFF IT IS DESTRUCTIVE AND SAYS SO. `pack`/`grid` re-derive every rect,
   so the authored layout (13 regions' worth, with their trim) is discarded and
   this tool has no copy. The existing switch already clears and counts; the
   reply now names what is being given up, in the house voice. No modal -- the
   reply plus the existing 5s status hold is the channel. Section 4.

Sibling guards, do not break them: `test_layout_switch.py` owns the pack<->grid
switch and the bound refusal, `test_layout_aware_panel.py` owns the
hide/readonly behaviour of the OTHER geometry rows, `test_grid_layout.py` owns
the grid maths.

ASCII only in the labels: a non-Latin-1 glyph aborts the suite on this box's
cp1252 console.
"""
from __future__ import annotations

import json
import os
import re
import sys
import tempfile
from pathlib import Path

# Sandbox staging BEFORE importing the tool: MANIFEST_DIR and friends resolve
# out of it, and nothing here may touch a real project.
_STAGING = tempfile.mkdtemp(prefix="authored-geom-")
os.environ["ATLAS_STAGING"] = _STAGING

import batch_atlas  # noqa: E402
import storage  # noqa: E402
import ui_server as u  # noqa: E402

FAILED: list[str] = []
PASSED: list[str] = []


def _say(text: str) -> None:
    enc = sys.stdout.encoding or "utf-8"
    print(text.encode(enc, errors="replace").decode(enc, errors="replace"))


def check(label: str, got, want) -> None:
    ok = got == want
    _say(f"{'ok  ' if ok else 'FAIL'} {label}")
    (PASSED if ok else FAILED).append(label)
    if not ok:
        _say(f"       got  {got!r}\n       want {want!r}")


def check_true(label: str, got) -> None:
    check(label, bool(got), True)


# --------------------------------------------------------------------------
# The REAL manifest shapes, modelled on invisible_wall/test6/manifests/.
# --------------------------------------------------------------------------
def _authored(n: int = 13, **atlas) -> dict:
    """S_New_Boot_Sink, as it actually sits in the bucket: a page size nothing
    here produced, NO `layout`, NO `atlas_file`, a `texturepacker_json`, and a
    full rect plus a camelCase trim record on every one of its 13 regions."""
    a = {"width": 1934, "height": 968,
         "texturepacker_json": "deploy/S_New_Boot_Sink.json"}
    a.update(atlas)
    return {
        "atlas": a,
        "style": {"positive_prefix": "", "positive_suffix": "", "negative": ""},
        "regions": [{"name": f"S_New_Boot_Sink_{i:02d}",
                     "x": (i % 5) * 386, "y": (i // 5) * 322,
                     "w": 380, "h": 316,
                     "offX": 12, "offY": 9, "origW": 512, "origH": 512,
                     "fit_mode": "contain",
                     "prompt": f"a sinking boot {i}", "seed": 500 + i}
                    for i in range(n)],
    }


def _bound(**atlas) -> dict:
    """S_CaughtSymbols / S_UI / S_New_Whaler_*: BOUND. `atlas_file` is the
    binding, and it is the ONLY thing that separates this from `_authored`
    above -- which is the distinction #717 missed."""
    a = {"atlas_file": "S_CaughtSymbols.atlas", "width": 2048, "height": 2048,
         "texturepacker_json": "deploy/S_CaughtSymbols.json"}
    a.update(atlas)
    return {
        "atlas": a,
        "style": {"positive_prefix": "", "positive_suffix": "", "negative": ""},
        "regions": [{"name": "S_Caught_01", "x": 0, "y": 0, "w": 256, "h": 256,
                     "offX": 4, "offY": 4, "origW": 264, "origH": 264,
                     "prompt": "a caught symbol"}],
    }


def _scratch(layout: str = "pack", n: int = 3, **atlas) -> dict:
    """The kind that already worked. Section 5 holds it to origin/main."""
    a = {"layout": layout, "width": 1028, "height": 25652}
    a.update(atlas)
    return {
        "atlas": a,
        "regions": [{"name": f"frame_{i:02d}", "x": 2 + i * 100, "y": 2,
                     "w": 96, "h": 96, "off_x": 4, "off_y": 5,
                     "orig_w": 128, "orig_h": 128, "fit_mode": "contain",
                     "prompt": f"a gold coin {i}"} for i in range(n)],
    }


_RECT_KEYS = ("x", "y", "w", "h")
_TRIM_KEYS = ("offX", "offY", "origW", "origH")


def _keys(m: dict) -> list[str]:
    return [f[0] for f in u.atlas_geom_fields_for(m)]


def _snap(m: dict) -> str:
    return json.dumps(m, sort_keys=True)


def _ctl(value: str) -> str:
    return u._control_html("atlas_layout", "text", value, {})


def _row(m: dict) -> str:
    """The rendered Layout row for this manifest, '' when it has none."""
    for r in u.atlas_geom_rows_html(m, {}, {}):
        if 'data-cfg="atlas_layout"' in r:
            return r
    return ""


def _selected(html_: str) -> str | None:
    hit = re.search(r'<option value="([^"]*)"[^>]*\bselected', html_)
    return hit.group(1) if hit else None


def _option_values(html_: str) -> list[str]:
    return re.findall(r'<option value="([^"]*)"', html_)


def _rects(m: dict) -> list[tuple]:
    return [tuple(r.get(k) for k in _RECT_KEYS) for r in m["regions"]]


def _trims(m: dict) -> list[tuple]:
    return [tuple(r.get(k) for k in _TRIM_KEYS) for r in m["regions"]]


# --------------------------------------------------------------------------
# 1. THE SAFETY PROPERTY, UNCHANGED: a BOUND atlas is refused. Pinned hard.
# --------------------------------------------------------------------------
def test_a_bound_atlas_still_gets_no_layout_row() -> None:
    """The one property this change must not touch. The `.atlas` is the
    authoritative region map; the packer would re-measure the art, re-pack it
    and overwrite `atlas.width/height`, and nothing here could put it back."""
    for label, man in (
        ("S_CaughtSymbols as it is in the bucket", _bound()),
        ("S_UI", _bound(atlas_file="S_UI.atlas")),
        ("S_New_Whaler_Idle", _bound(atlas_file="S_New_Whaler_Idle.atlas")),
        ("a bound atlas with a path", _bound(atlas_file="atlas/S_UI.atlas")),
        ("a bound atlas with stray whitespace",
         _bound(atlas_file="  S_UI.atlas  ")),
        # Contradictory but still bound: the `.atlas` outranks any `layout`.
        ("bound AND stamped pack", _bound(layout="pack")),
        ("bound AND stamped grid", _bound(layout="grid")),
    ):
        check(f"{label}: no Layout row", "atlas_layout" in _keys(man), False)
        check(f"{label}: nothing renders the control either",
              'data-cfg="atlas_layout"' in "".join(
                  u.atlas_geom_rows_html(man, {}, {})), False)
    check("...and the predicate says why",
          (batch_atlas.is_atlas_bound(_bound()),
           batch_atlas.can_choose_layout(_bound())), (True, False))
    check("the bound atlas keeps every OTHER geometry row",
          _keys(_bound()),
          [f[0] for f in u.ATLAS_GEOM_FIELDS if f[0] != "atlas_layout"])


def test_a_bound_atlas_is_refused_at_the_save_layer_too() -> None:
    """Defence in depth -- the render filter hides the row, and both
    `switch_atlas_layout` and the real `_saveconfig` refuse it anyway. Only
    these survive a stale tab or a hand-made POST."""
    for want in ("pack", "grid"):
        man = _bound()
        before = _snap(man)
        check(f"switch_atlas_layout refuses {want!r}",
              u.switch_atlas_layout(man, want), (False, []))
        check(f"...and the manifest is byte-for-byte unchanged ({want})",
              _snap(man), before)

    dest = _install(_bound(), name="atlas_manifest_bound_geom.json")
    for want in ("pack", "grid"):
        msg = FakeHandler()._saveconfig(_post(_bound(),
                                              atlas_layout=want))
        out = _saved(dest)
        check(f"the save path writes no layout for {want!r}",
              "layout" in out["atlas"], False)
        check(f"...the authored rect survives {want!r}",
              (out["regions"][0]["x"], out["regions"][0]["w"]), (0, 256))
        check(f"...and its trim survives {want!r}",
              tuple(out["regions"][0][k] for k in _TRIM_KEYS), (4, 4, 264, 264))
        check(f"...the .atlas binding is intact ({want})",
              out["atlas"]["atlas_file"], "S_CaughtSymbols.atlas")
        check(f"...and the reply is the ordinary one ({want})",
              msg, "Settings saved (per-atlas overrides + globals)")


# --------------------------------------------------------------------------
# 2. THE FIX: an authored-geometry atlas DOES get the row.
# --------------------------------------------------------------------------
def test_an_authored_geometry_atlas_is_offered_the_row() -> None:
    """The owner's complaint, stated as a fixture. On origin/main every one of
    these was refused the dropdown -- so the only atlases that could not be
    given a layout were the ones that did not have one."""
    for label, man in (
        ("S_New_Boot_Sink (1934x968, 13 regions)", _authored()),
        ("S_New_Boot", _authored(6)),
        ("S_New_Lobster_Idle", _authored(8)),
        ("...even with a blank atlas_file", _authored(atlas_file="")),
        ("...even with a whitespace atlas_file", _authored(atlas_file="   ")),
        ("...even with a junk layout string", _authored(layout="freeform")),
        ("an atlas block with nothing in it", {"atlas": {}}),
        ("no atlas block at all", {}),
    ):
        check(f"{label} IS offered the Layout row",
              "atlas_layout" in _keys(man), True)
    check("the row lands in the full list, in ATLAS_GEOM_FIELDS order",
          _keys(_authored()), [f[0] for f in u.ATLAS_GEOM_FIELDS])
    check("...and the predicate says why",
          (batch_atlas.is_atlas_bound(_authored()),
           batch_atlas.can_choose_layout(_authored())), (False, True))


def test_the_gate_is_the_binding_and_not_the_missing_layout() -> None:
    """The distinction, stated once as executable code. Same manifest, one key
    apart: the binding decides, the layout does not."""
    check("no layout + no binding -> offered",
          batch_atlas.can_choose_layout(_authored()), True)
    check("no layout + a binding -> refused",
          batch_atlas.can_choose_layout(_authored(atlas_file="x.atlas")),
          False)
    check("a layout + no binding -> offered",
          batch_atlas.can_choose_layout(_scratch("pack")), True)
    check("a layout + a binding -> still refused",
          batch_atlas.can_choose_layout(
              _scratch("pack", atlas_file="x.atlas")), False)
    # `is_from_scratch` keeps its OWN meaning: compose, slice, the page pointer
    # and the deploy all read it and must not change behaviour here.
    check("is_from_scratch is untouched by any of this",
          [batch_atlas.is_from_scratch(x) for x in
           (_authored(), _bound(), _scratch("pack"), _scratch("grid"),
            _authored(layout="freeform"))],
          [False, False, True, True, False])


# --------------------------------------------------------------------------
# 3. THE THIRD OPTION. Selected here, absent everywhere else, and a no-op.
# --------------------------------------------------------------------------
def test_the_third_option_is_selected_for_authored_geometry() -> None:
    row = _row(_authored())
    check_true("the row renders at all", bool(row))
    check("it offers three choices, authored first",
          _option_values(row), ["", "pack", "grid"])
    check("the authored choice is the SELECTED one -- not 'Pack the art'",
          _selected(row), u.ATLAS_LAYOUT_AUTHORED)
    check("its value is blank, which is what makes it a no-op on save",
          u.ATLAS_LAYOUT_AUTHORED, "")
    check_true("its label says it leaves the geometry alone",
               "Authored geometry" in row and "leave as is" in row)
    check_true("...and that label is the one the module states",
               u.ATLAS_LAYOUT_AUTHORED_LABEL in row)
    # The regression it exists to prevent, named.
    check("pack is NOT preselected for an atlas that never chose it",
          '<option value="pack" selected' in row, False)


def test_the_third_option_is_never_offered_to_pack_or_grid() -> None:
    """An atlas that already has a layout gets exactly the two real choices --
    the #717 rule, still right there: a blank would look changeable and do
    nothing."""
    for layout in ("pack", "grid"):
        row = _row(_scratch(layout))
        check(f"{layout}: exactly two choices",
              _option_values(row), ["pack", "grid"])
        check(f"{layout}: no blank option", '<option value=""' in row, False)
        check(f"{layout}: the stored layout is the selected one",
              _selected(row), layout)
        # On the OPTIONS only: the label also appears inside the row's tooltip,
        # where it belongs -- the help text explains all three choices.
        check(f"{layout}: the authored choice is not among the options",
              f">{u.ATLAS_LAYOUT_AUTHORED_LABEL}</option>" in row, False)
    check("case and whitespace still normalize into the two-choice form",
          (_option_values(_ctl("  GRID ")), _selected(_ctl("  GRID "))),
          (["pack", "grid"], "grid"))


def test_choosing_it_stores_nothing_and_clears_nothing() -> None:
    """A TRUE no-op, end to end through the real `_saveconfig`. The authored
    rects, their trim and the descriptor must all be exactly where they were --
    this is the choice the panel opens on, so it is what an author gets for
    pressing Save without touching the dropdown at all."""
    m = _authored()
    dest = _install(m, name="atlas_manifest_authored_noop.json")
    before = _saved(dest)

    post = _post(before)
    check("the panel really would post a blank for the layout",
          post["atlas_layout"], "")
    msg = FakeHandler()._saveconfig(post)
    out = _saved(dest)

    check("no layout key was invented", "layout" in out["atlas"], False)
    check("all 13 rects survive, unmoved", _rects(out), _rects(before))
    check("...and every trim record with them", _trims(out), _trims(before))
    check("the texturepacker descriptor survives",
          out["atlas"].get("texturepacker_json"),
          "deploy/S_New_Boot_Sink.json")
    check("the page the exporter wrote is untouched",
          (out["atlas"]["width"], out["atlas"]["height"]), (1934, 968))
    check("every key the atlas already had is unchanged",
          {k: out["atlas"][k] for k in before["atlas"]}, before["atlas"])
    # The ONE addition, and it is not this change's: the Frame trim row
    # normalises an absent value to PACK_TRIM_DEFAULT and posts it, so any save
    # of this panel writes that default in (`keep` since 2026-09-17 -- inert
    # here either way, since `keep_full_frame` is gated on `is_from_scratch`
    # and an authored-geometry atlas is not). Verified against a real run of
    # origin/main (13879105), which produces the identical atlas block -- and it
    # is inert here, since only `auto_pack_layout` ever reads it.
    check("...and the only key gained is main's pre-existing trim default",
          sorted(set(out["atlas"]) - set(before["atlas"])), ["pack_trim"])
    check("...at that default", out["atlas"]["pack_trim"], u.PACK_TRIM_DEFAULT)
    check("the reply is the ordinary one -- nothing to announce",
          msg, "Settings saved (per-atlas overrides + globals)")
    check("...and switch_atlas_layout would refuse the blank anyway",
          u.switch_atlas_layout(_authored(), ""), (False, []))


def test_the_blank_is_skipped_before_the_switch_is_ever_reached() -> None:
    """WHY it is a no-op, pinned at the source rather than inferred from the
    result: `_ATLAS_GEOM_KEYS` drops a blank value wholesale ('never wipe
    required atlas geometry'), above the `atlas_layout` branch. If that order
    ever inverted, the blank would reach `switch_atlas_layout` and the comment
    promising a no-op would be the only thing left saying so."""
    src = Path(u.__file__).read_text(encoding="utf-8")
    body = src.split("elif k in _ATLAS_GEOM_KEYS:")[1].split("\n            elif")[0]
    skip = body.find('if sv == "":')
    branch = body.find('if k == "atlas_layout":')
    check("the blank-skip is present", skip >= 0, True)
    check("...and it comes FIRST", skip >= 0 and branch > skip, True)
    check("the reversal is written down where the next reader will be",
          "ATLAS_LAYOUT_AUTHORED" in body, True)


# --------------------------------------------------------------------------
# 4. LEAVING IT IS DESTRUCTIVE, AND THE REPLY SAYS WHAT WAS GIVEN UP.
# --------------------------------------------------------------------------
def test_switching_to_grid_clears_the_authored_geometry() -> None:
    m = _authored()
    changed, lost = u.switch_atlas_layout(m, "grid")
    check("it reports a change, so the caller saves", changed, True)
    check("all 13 regions are reported as losing their rect", len(lost), 13)
    check("...by name", lost[:2],
          ["S_New_Boot_Sink_00", "S_New_Boot_Sink_01"])
    # `.get` on purpose: a REFUSED switch is the failure this test exists to
    # report, not a KeyError that stops the rest of the suite from running.
    check("the layout really landed", m["atlas"].get("layout"), "grid")
    check("no rect survives",
          any(k in r for r in m["regions"] for k in _RECT_KEYS), False)
    check("no camelCase trim record survives either",
          any(k in r for r in m["regions"] for k in _TRIM_KEYS), False)
    check("the superseded texturepacker descriptor is dropped",
          "texturepacker_json" in m["atlas"], False)
    check("the author's fit_mode SURVIVES -- it means the same either side",
          m["regions"][0].get("fit_mode"), "contain")
    check("and so does the creative data",
          (m["regions"][3].get("prompt"), m["regions"][3].get("seed")),
          ("a sinking boot 3", 503))
    check("pack does the same thing", u.switch_atlas_layout(_authored(6),
                                                            "pack")[0], True)


def test_the_reply_names_what_was_given_up() -> None:
    """The channel. No modal: the reply plus the existing 5s status hold
    (`test_layout_switch.test_a_long_save_reply_is_given_time_to_be_read`) is
    all there is, so it has to say that these rects came from somewhere else
    and are not coming back."""
    dest = _install(_authored(), name="atlas_manifest_authored_grid.json")
    msg = FakeHandler()._saveconfig(_post(_saved(dest), atlas_layout="grid"))
    out = _saved(dest)

    check("the switch persisted", out["atlas"]["layout"], "grid")
    check("...and the rects are off disk",
          any(k in r for r in out["regions"] for k in _RECT_KEYS), False)
    check_true("the reply names the new layout", "'grid'" in msg)
    check_true("it says the geometry came from outside this tool",
               "authored outside this tool" in msg)
    check_true("...and that leaving it is what gave it up",
               "gave up" in msg)
    check_true("...how much: the count, with the trim named",
               "13 region(s) lost" in msg and "trim" in msg)
    check_true("...and that this tool cannot put it back",
               "nothing here can put those back" in msg)
    check_true("it still names the one action left",
               "Create Atlas" in msg and "Default cell width/height" in msg)
    check("the reply is long enough to get the 5s hold, so it can be read",
          len(msg) > 90, True)


def test_the_pack_to_grid_reply_is_unchanged_by_all_this() -> None:
    """The other route must keep its own, milder wording: between the
    from-scratch layouts only derived output is dropped, and claiming an
    authored layout was lost would be a lie."""
    dest = _install(_scratch("pack"), name="atlas_manifest_scratch_grid.json")
    msg = FakeHandler()._saveconfig(_post(_saved(dest), atlas_layout="grid"))
    check("the from-scratch wording is the one main shipped",
          msg,
          "Settings saved — layout is now 'grid'. 3 region(s) lost the rect "
          "the previous layout gave them. Set Default cell width/height first. "
          "Press 🧩 Create Atlas to lay the regions out again.")
    check("...and it does NOT borrow the authored-geometry warning",
          "authored outside this tool" in msg, False)


def test_an_authored_atlas_with_no_rects_does_not_claim_damage() -> None:
    """Honesty in the other direction: a region that never had a rect is the
    ordinary 'added but not generated yet' case."""
    m = _authored(0)
    m["regions"] = [{"name": "fresh", "prompt": "nothing generated yet"}]
    dest = _install(m, name="atlas_manifest_authored_empty.json")
    msg = FakeHandler()._saveconfig(_post(_saved(dest), atlas_layout="pack"))
    check("the switch still happened", _saved(dest)["atlas"]["layout"], "pack")
    check_true("...it still says the geometry was authored elsewhere",
               "authored outside this tool" in msg)
    check_true("...but not that anything was lost",
               "nothing was given up" in msg)
    check("...and it never invents a count", "region(s) lost" in msg, False)


def test_the_landing_after_leaving_authored_geometry() -> None:
    """Same landing as pack->grid: every region is UNPLACED until the next
    Create Atlas, and the grid pass refuses until a cell size exists. What
    matters here is that nothing authored survives that refusal to be deployed
    as if it were the grid."""
    m = _authored()
    u.switch_atlas_layout(m, "grid")
    before = _snap(m)
    note, changed = u.grid_layout(m)
    check("nothing is laid out yet", changed, False)
    check("...and nothing is written", _snap(m), before)
    check("no authored rect survived to be shipped as a grid frame",
          any(k in r for r in m["regions"] for k in _RECT_KEYS), False)
    check_true("the note names the one step left",
               "Default cell width" in note and "Create Atlas again" in note)

    m["atlas"].update(width=1950, height=1000, cell_width=390, cell_height=325)
    note, changed = u.grid_layout(m)
    check("with a cell size it lays out", changed, True)
    check("...as a 5-wide grid in manifest order",
          [(r["x"], r["y"]) for r in m["regions"][:6]],
          [(0, 0), (390, 0), (780, 0), (1170, 0), (1560, 0), (0, 325)])
    check("...and the creative data came through the whole trip",
          m["regions"][12]["prompt"], "a sinking boot 12")


# --------------------------------------------------------------------------
# 5. THE ATLASES THAT ALREADY WORKED, held to a REAL capture of origin/main.
# --------------------------------------------------------------------------
# Produced by running 13879105's `_control_html("atlas_layout", "text", v, {})`
# against that commit's ui_server.py. Not retyped from the template -- the point
# is that a `pack`/`grid` atlas's control is byte-for-byte what main sent.
_CONTROL_ON_MAIN = {
    "pack": '<select data-cfg="atlas_layout" title=""><option value="pack" selected>Pack the art (the tool sizes the page)</option><option value="grid">Grid of cells (your atlas + cell size are used as they are)</option></select>',
    "grid": '<select data-cfg="atlas_layout" title=""><option value="pack">Pack the art (the tool sizes the page)</option><option value="grid" selected>Grid of cells (your atlas + cell size are used as they are)</option></select>',
    "  GRID ": '<select data-cfg="atlas_layout" title=""><option value="pack">Pack the art (the tool sizes the page)</option><option value="grid" selected>Grid of cells (your atlas + cell size are used as they are)</option></select>',
}
# From the same capture: main's field list for each of the three kinds. The
# authored row is the regression -- main gave it the SAME list as a bound atlas,
# which is exactly the conflation being fixed, so it is the one entry this file
# must NOT reproduce.
_FIELDS_ON_MAIN = {
    "pack": ["atlas_file", "atlas_layout", "atlas_width", "atlas_height",
             "atlas_cell_width", "atlas_cell_height", "atlas_format",
             "atlas_source_image", "atlas_pack_trim"],
    "bound": ["atlas_file", "atlas_width", "atlas_height", "atlas_cell_width",
              "atlas_cell_height", "atlas_format", "atlas_source_image",
              "atlas_pack_trim"],
}


def test_a_pack_or_grid_atlas_renders_exactly_what_main_rendered() -> None:
    for stored, want in _CONTROL_ON_MAIN.items():
        check(f"{stored!r}: the control is byte-for-byte main's",
              _ctl(stored), want)
    check("a pack atlas's field list is main's", _keys(_scratch("pack")),
          _FIELDS_ON_MAIN["pack"])
    check("a grid atlas's field list is main's", _keys(_scratch("grid")),
          _FIELDS_ON_MAIN["pack"])
    check("a bound atlas's field list is main's", _keys(_bound()),
          _FIELDS_ON_MAIN["bound"])
    check("and the authored atlas is the ONE that changed -- main gave it the "
          "bound list, with no way to ever choose a layout",
          _keys(_authored()) == _FIELDS_ON_MAIN["bound"], False)


def test_a_pack_or_grid_atlas_still_switches_the_way_it_did() -> None:
    m = _scratch("pack", 3)
    check("pack -> grid still reports the same move",
          u.switch_atlas_layout(m, "grid"),
          (True, ["frame_00", "frame_01", "frame_02"]))
    check("...and lands on grid", m["atlas"]["layout"], "grid")
    check("grid -> pack still works too",
          u.switch_atlas_layout(_scratch("grid", 2), "pack"),
          (True, ["frame_00", "frame_01"]))
    check("the same layout again is still not a move",
          u.switch_atlas_layout(_scratch("pack"), "  PACK  "), (False, []))
    for bad in ("", "   ", "freeform", "Pack the art", "None"):
        g = _scratch("pack")
        before = _snap(g)
        check(f"{bad!r} is still refused", u.switch_atlas_layout(g, bad),
              (False, []))
        check(f"...and still changes nothing ({bad!r})", _snap(g), before)


# --------------------------------------------------------------------------
# 6. The layout-awareness of the OTHER rows, on an authored atlas.
# --------------------------------------------------------------------------
def test_the_other_rows_stay_plain_until_a_layout_exists() -> None:
    """An authored atlas has no layout to be AWARE of -- `is_from_scratch` is
    still False for it -- and its cell size is live (`region_box` really does
    fall back to it). So every other row renders plain, exactly as on main:
    nothing hidden, nothing locked. The awareness arrives on the reload after
    a layout is actually saved."""
    joined = "".join(u.atlas_geom_rows_html(_authored(), {}, {}))
    for attr in ("data-layout", "data-ro-layout", "readonly", "rohint",
                 "display:none", "disabled"):
        check(f"an authored atlas carries no {attr}", attr in joined, False)
    check("...but it DOES carry the Layout dropdown now",
          'data-cfg="atlas_layout"' in joined, True)

    # And after the switch, the same manifest renders aware.
    m = _authored()
    u.switch_atlas_layout(m, "pack")
    aware = "".join(u.atlas_geom_rows_html(m, {}, {}))
    check("once it is pack, the cell rows are hidden",
          'data-layout="grid"' in aware and "display:none" in aware, True)
    check("...and the page size is locked, the packer owning it",
          'data-ro-layout="pack"' in aware and "readonly" in aware, True)
    check("...still readonly, never disabled", "disabled" in aware, False)


def test_every_geometry_row_still_round_trips_on_an_authored_atlas() -> None:
    """Hidden-not-omitted's other half: nothing may be DROPPED from the POST.
    An authored atlas posts all nine keys, the Layout one blank."""
    posted = _post(_authored(width=1934, height=968))
    check("every geometry key is posted", sorted(posted),
          sorted(f[0] for f in u.ATLAS_GEOM_FIELDS))
    check("the page size posts as stored",
          (posted["atlas_width"], posted["atlas_height"]), ("1934", "968"))
    check("the layout posts blank -- the authored choice",
          posted["atlas_layout"], "")


# --------------------------------------------------------------------------
# Harness for the real save path.
# --------------------------------------------------------------------------
class FakeHandler:
    """Just enough of the request object for `_saveconfig`, which reads
    module-level config/manifest helpers rather than request state. Same harness
    as test_layout_switch.py / test_layout_aware_panel.py."""

    def _saveconfig(self, edits: dict) -> str:
        return u.Handler._saveconfig(self, edits)

    def _seed_refs_into_outputs(self, m, only_empty=True):
        raise AssertionError("not expected: this save never switches manifest")


def _install(man: dict, name: str = "atlas_manifest_authored.json") -> Path:
    p = Path(str(u.MANIFEST_DIR))
    p.mkdir(parents=True, exist_ok=True)
    dest = p / name
    dest.write_text(json.dumps(man, indent=2), encoding="utf-8")
    u.save_config({**u.load_config(), "manifest_path": name})
    return dest


def _saved(dest: Path) -> dict:
    return json.loads(dest.read_text(encoding="utf-8"))


_CTRL = re.compile(r'<(input|select)\b[^>]*?data-cfg="([a-z_]+)"[^>]*?>')


def _post(m: dict, **over) -> dict:
    """What the 🧩 Atlas settings panel actually POSTs for THIS manifest --
    read off the rendered rows, never hand-written, so a payload can never claim
    a field the panel does not really send (or miss one it does)."""
    out: dict[str, str] = {}
    for row in u.atlas_geom_rows_html(m, {}, {}):
        hit = _CTRL.search(row)
        if not hit:
            continue
        tag, key = hit.group(1), hit.group(2)
        if tag == "input":
            val = re.search(r'\bvalue="([^"]*)"', hit.group(0))
            out[key] = val.group(1) if val else ""
        else:
            body = row[hit.end():]
            sel = (re.search(r'<option value="([^"]*)"[^>]*\bselected', body)
                   or re.search(r'<option value="([^"]*)"', body))
            out[key] = sel.group(1) if sel else ""
    out.update(over)
    return out


if __name__ == "__main__":
    # R2 is not reachable offline and every save mirrors write-through; stand in
    # for the bucket so nothing here waits on a socket. Staging is a real temp
    # tree, which is what the fixtures read back.
    storage.push_file = lambda p, key, **kw: None       # type: ignore[assignment]
    storage.put = lambda key, data, **kw: None          # type: ignore[assignment]

    for fn in (test_a_bound_atlas_still_gets_no_layout_row,
               test_a_bound_atlas_is_refused_at_the_save_layer_too,
               test_an_authored_geometry_atlas_is_offered_the_row,
               test_the_gate_is_the_binding_and_not_the_missing_layout,
               test_the_third_option_is_selected_for_authored_geometry,
               test_the_third_option_is_never_offered_to_pack_or_grid,
               test_choosing_it_stores_nothing_and_clears_nothing,
               test_the_blank_is_skipped_before_the_switch_is_ever_reached,
               test_switching_to_grid_clears_the_authored_geometry,
               test_the_reply_names_what_was_given_up,
               test_the_pack_to_grid_reply_is_unchanged_by_all_this,
               test_an_authored_atlas_with_no_rects_does_not_claim_damage,
               test_the_landing_after_leaving_authored_geometry,
               test_a_pack_or_grid_atlas_renders_exactly_what_main_rendered,
               test_a_pack_or_grid_atlas_still_switches_the_way_it_did,
               test_the_other_rows_stay_plain_until_a_layout_exists,
               test_every_geometry_row_still_round_trips_on_an_authored_atlas):
        _say(f"\n-- {fn.__name__}")
        fn()
    print()
    if FAILED:
        _say(f"{len(FAILED)} FAILED of {len(FAILED) + len(PASSED)}: "
             + ", ".join(FAILED))
        sys.exit(1)
    _say(f"all {len(PASSED)} authored-geometry fixtures pass")
