"""Offline guard: changing `atlas.layout` on an EXISTING atlas (no R2, no GPU,
no ComfyUI).

Run:  PYTHONIOENCODING=utf-8 PYTHONPATH=".;../_shared" py test_layout_switch.py
      (from services/atlas-tool)

THE DEAD END THIS OPENS. #712 added the `grid` layout, which READS
`atlas.width/height/cell_width/cell_height` instead of overwriting them -- but
`atlas.layout` was only ever WRITTEN at atlas-creation time (`{"layout":
"pack"}` in _newatlas) and by `auto_pack_layout` re-stamping its own name. No UI
touched it. So an atlas that already existed stayed `pack` forever: the owner
set 2048x2048, saved, hard-refreshed (the values persisted), pressed Create
Atlas and got 1028x25652 -- `auto_pack_layout`'s packed page, written straight
over the two fields they had just typed. Re-exporting would have produced a grid
atlas and thrown away every prompt, seed and ref already in the regions. Hence
an IN-PLACE switch.

THE THREE THINGS THAT MAKE IT SAFE, all pinned below.

1. THE GATE. The dropdown is withheld from an atlas BOUND to a `.atlas`
   (`batch_atlas.can_choose_layout`). That file is the authoritative region map
   and nothing in this tool re-derives it; handing one to the packer would
   re-measure the ART, re-pack it and OVERWRITE `atlas.width/height`, destroying
   geometry with no undo. This is THE load-bearing property -- `test_the_gate_*`
   below pins it at both layers (the render AND the save, so a stale tab or a
   hand-made POST cannot get through either).

   #717 gated on `is_from_scratch` instead, which conflated "no `layout`" with
   "bound" and so withheld the dropdown from the LEGACY / authored-geometry
   manifests too -- the atlases with no layout were the only ones that could
   never be given one. `test_authored_geometry_layout.py` owns that half, the
   third dropdown choice it needs, and the destructive-switch reply; what this
   file still pins is that a BOUND atlas is refused at both layers.

2. THE CLEAR. A `pack` rect describes a page the packer sized from the art; a
   `grid` rect describes a cell the author sized. Neither survives the move, so
   a surviving rect is the same class of fault `_strip_pack_geometry` already
   exists for. It matters MOST where the incoming layout writes nothing at all:
   `grid_layout` deliberately changes nothing when the regions overflow the
   page, and nothing when the cell size is missing -- which is EXACTLY the state
   a just-switched pack atlas is in, since a packer never writes a cell size.
   Without the clear the old pack rects would survive that refusal and deploy as
   if they were the grid.

3. NO BLANK OPTION ON AN ATLAS THAT ALREADY HAS A LAYOUT. A blank
   `_ATLAS_GEOM_KEYS` value is SKIPPED on save ("never wipe required atlas
   geometry"), so on a `pack`/`grid` atlas a blank choice would look changeable
   and silently do nothing -- the `atlas_pack_trim` precedent, followed exactly.
   (The authored-geometry atlas is the deliberate exception, for the opposite
   reason: there "does nothing" IS the meaning. See
   `test_authored_geometry_layout.py`.)

Sibling guards, do not break them: `test_grid_layout.py` owns the grid maths and
the refusals, `test_auto_pack_clear.py` / `test_stale_pack_rects.py` /
`test_pack_page_pointer.py` own the pack half, `test_pack_trim.py` owns the
trim dropdown this one copies.

ASCII only in the labels: a non-Latin-1 glyph aborts the suite on this box's
cp1252 console.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

# Sandbox staging BEFORE importing the tool: MANIFEST_DIR and friends resolve
# out of it, and nothing here may touch a real project.
_STAGING = tempfile.mkdtemp(prefix="layout-switch-")
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
# Manifest shapes.
# --------------------------------------------------------------------------
def _packed(n: int = 3, **atlas) -> dict:
    """A PACKED atlas as `auto_pack_layout` leaves it: a page the packer sized,
    NO cell size (nothing in the pack layout reads one), and a full packer rect
    plus its trim record on every region -- alongside creative data the switch
    must never touch."""
    a = {"layout": "pack", "width": 1028, "height": 25652}
    a.update(atlas)
    return {
        "atlas": a,
        "style": {"positive_prefix": "", "positive_suffix": "", "negative": ""},
        "regions": [{"name": f"frame_{i:02d}",
                     "x": 2 + i * 100, "y": 2, "w": 96, "h": 96,
                     "rotated": False,
                     "off_x": 4, "off_y": 5, "orig_w": 128, "orig_h": 128,
                     "fit_mode": "contain",
                     "prompt": f"a gold coin {i}", "seed": 1000 + i,
                     "style_ref": f"refs/coin_{i}.png"} for i in range(n)],
    }


def _bound(**atlas) -> dict:
    """The kind that must NEVER be offered the dropdown: BOUND to a Spine/libGDX
    `.atlas`, which is its authoritative region map. The binding is the
    `atlas_file` key -- not the absent `layout`, which it also has."""
    a = {"atlas_file": "symbols.atlas", "width": 2048, "height": 2048}
    a.update(atlas)
    return {
        "atlas": a,
        "style": {"positive_prefix": "", "positive_suffix": "", "negative": ""},
        "regions": [{"name": "H1", "x": 0, "y": 0, "w": 256, "h": 256,
                     "prompt": "a crown"}],
    }


def _keys(m: dict) -> list[str]:
    return [f[0] for f in u.atlas_geom_fields_for(m)]


def _snap(m: dict) -> str:
    return json.dumps(m, sort_keys=True)


# --------------------------------------------------------------------------
# 1. THE GATE, at the render layer. The safety property -- pinned hard.
# --------------------------------------------------------------------------
def test_the_gate_withholds_the_row_from_a_bound_atlas() -> None:
    check_true("a pack atlas is offered the Layout row",
               "atlas_layout" in _keys(_packed()))
    check_true("a grid atlas is offered it too",
               "atlas_layout" in _keys(_packed(layout="grid")))
    check_true("case and whitespace do not hide it",
               "atlas_layout" in _keys({"atlas": {"layout": " Grid "}}))

    # THE ONE THAT MATTERS. A BOUND atlas -- `atlas_file` set, however it is
    # spelled -- must not see the control, because `pack` would re-measure the
    # art and overwrite the page the .atlas describes.
    for label, man in (
        ("an .atlas-bound atlas", _bound()),
        ("...bound AND already pack (contradictory, still bound)",
         _bound(layout="pack")),
        ("...bound AND already grid", _bound(layout="grid")),
        ("...bound with a path", _bound(atlas_file="assets/symbols.atlas")),
        ("...bound with surrounding whitespace",
         _bound(atlas_file="  symbols.atlas  ")),
    ):
        check(f"{label} is NOT offered the Layout row",
              "atlas_layout" in _keys(man), False)

    # NOT bound: no `.atlas` to protect, so the row is there. This is the #717
    # regression -- these shapes used to be refused it, which meant the atlases
    # with no layout were the only ones that could never be given one. Their
    # behaviour once they have it is `test_authored_geometry_layout.py`'s.
    for label, man in (
        ("an atlas block with no layout key", {"atlas": {"width": 512}}),
        ("an empty atlas block", {"atlas": {}}),
        ("no atlas block at all", {}),
        ("a blank layout", {"atlas": {"layout": ""}}),
        ("a whitespace layout", {"atlas": {"layout": "   "}}),
        ("an unrecognised layout", {"atlas": {"layout": "freeform"}}),
        ("a null atlas block", {"atlas": None}),
        ("a blank atlas_file", {"atlas": {"atlas_file": ""}}),
        ("a whitespace atlas_file", {"atlas": {"atlas_file": "   "}}),
    ):
        check(f"{label} IS offered the Layout row",
              "atlas_layout" in _keys(man), True)


def test_the_gate_hides_nothing_else() -> None:
    """The filter must subtract exactly one row -- a geometry field that
    silently stopped rendering is its own outage."""
    everything = [f[0] for f in u.ATLAS_GEOM_FIELDS]
    check("a from-scratch atlas gets the full list", _keys(_packed()),
          everything)
    check("a bound atlas gets the full list minus Layout, in order",
          _keys(_bound()), [k for k in everything if k != "atlas_layout"])
    check("...and the rows keep their labels/types/manifest keys",
          u.atlas_geom_fields_for(_packed()), u.ATLAS_GEOM_FIELDS)


def test_the_panel_renders_through_the_filter_not_the_raw_list() -> None:
    """The gate is worth nothing if the panel loop still walks
    ATLAS_GEOM_FIELDS directly."""
    src = Path(u.__file__).read_text(encoding="utf-8")
    check("the settings panel iterates the filtered list",
          "for ui_key, label, typ, mk in atlas_geom_fields_for(m):" in src,
          True)
    check("...and nothing iterates the raw list",
          "in ATLAS_GEOM_FIELDS:" in src, False)


# --------------------------------------------------------------------------
# 2. The control itself -- the atlas_pack_trim precedent, followed exactly.
# --------------------------------------------------------------------------
def _ctl(value: str, key: str = "atlas_layout") -> str:
    return u._control_html(key, "text", value, {})


def test_the_choices_are_the_from_scratch_layouts() -> None:
    """Stated in ATLAS_LAYOUT_MODES, sourced from batch_atlas. A third
    from-scratch layout added there and not here would be unreachable from the
    UI -- exactly the dead end this whole file exists to close."""
    check("the dropdown offers every from-scratch layout, and only those",
          set(u.ATLAS_LAYOUT_MODES), set(batch_atlas.FROM_SCRATCH_LAYOUTS))
    check_true("every choice has a label that says who sizes the page",
               all(lbl.strip() for lbl in u.ATLAS_LAYOUT_MODES.values()))
    # The authored-geometry sentinel is NOT a layout -- it is the absence of
    # one, and it must never leak into the set the tool lays out.
    check("the authored-geometry choice is not a from-scratch layout",
          u.ATLAS_LAYOUT_AUTHORED in batch_atlas.FROM_SCRATCH_LAYOUTS, False)
    check("...nor a key of the modes table",
          u.ATLAS_LAYOUT_AUTHORED in u.ATLAS_LAYOUT_MODES, False)


def test_the_control_is_a_named_dropdown_with_no_blank() -> None:
    """On an atlas that ALREADY has a layout. The authored-geometry atlas is the
    deliberate exception -- see `test_authored_geometry_layout.py`."""
    for stored in ("pack", "grid"):
        h = _ctl(stored)
        check(f"{stored}: it is a <select>, not a free-text input",
              h.startswith("<select") and "<input" not in h, True)
        check(f"{stored}: it carries data-cfg so cfgData() posts it",
              'data-cfg="atlas_layout"' in h, True)
        check(f"{stored}: exactly one option per layout", h.count("<option"), 2)
        # THE PRECEDENT. A blank _ATLAS_GEOM_KEYS value is SKIPPED on save, so
        # here a blank option would look changeable and silently do nothing.
        check(f"{stored}: there is NO blank option", '<option value=""' in h,
              False)
        check_true(f"{stored}: the values are the manifest values, not the "
                   f"labels",
                   '<option value="pack"' in h and '<option value="grid"' in h)
        check_true(f"{stored}: the labels are the human sentences",
                   u.ATLAS_LAYOUT_MODES["grid"] in h)


def test_the_stored_value_is_the_selected_one() -> None:
    check_true("pack selects pack", '<option value="pack" selected' in _ctl("pack"))
    check_true("grid selects grid", '<option value="grid" selected' in _ctl("grid"))
    check_true("case and whitespace normalize",
               '<option value="grid" selected' in _ctl("  GRID "))
    # An unusable stored value is NOT `pack`. It used to fall back to one, which
    # opened the row on "Pack the art" for an atlas whose rects were authored
    # elsewhere; now it reads as what it is -- no layout -- and selects the
    # authored-geometry choice, which writes nothing.
    for junk in ("", "freeform", "None", "2048"):
        check(f"an unusable stored value {junk!r} never selects pack",
              '<option value="pack" selected' in _ctl(junk), False)
        check(f"...{junk!r} selects the authored-geometry choice instead",
              '<option value="" selected' in _ctl(junk), True)
        check(f"...and {junk!r} is never echoed back as a choice",
              _ctl(junk).count("<option"), 3)
        if junk:  # "" IS the authored-geometry value, so it is there by design
            check(f"...{junk!r} is not echoed into an option value",
                  f'value="{junk}"' in _ctl(junk), False)


def test_the_pack_trim_control_is_unaffected() -> None:
    """The dropdown this one was copied from. Its branch sits directly below the
    new one in `_control_html`, so an over-broad `key ==` there would eat it."""
    h = _ctl("alpha", key="atlas_pack_trim")
    check("still a two-choice select", h.count("<option"), 2)
    check("still no blank option", '<option value=""' in h, False)
    check_true("still its own choices, not the layout ones",
               '<option value="alpha" selected' in h and "keep" in h
               and "grid" not in h)
    check("an unknown trim still falls back to the trim default",
          f'<option value="{u.PACK_TRIM_DEFAULT}" selected'
          in _ctl("nonsense", key="atlas_pack_trim"), True)


def test_the_help_says_who_owns_the_size_fields() -> None:
    """Requirement: the tip must name the CONSEQUENCE of each choice, because
    the whole reported fault was typing a size into a field the layout ignored.
    Also: SETTING_HELP goes through `.format()`, so a stray brace would raise
    on every settings render."""
    tip = u.help_for("atlas_layout", {})
    check_true("it is rendered, not swallowed", len(tip) > 200)
    check_true("pack: the tool sizes the page from the art",
               "OVERWRITES Atlas" in tip)
    # Was "typing a size there does nothing", which described the panel BEFORE
    # the fields were made layout-aware. There is no longer a box to type into
    # under pack -- Atlas width/height render read-only and the cell size is
    # hidden -- so the tip has to promise that instead. See
    # test_layout_aware_panel.py for the panel itself.
    check_true("pack: so there is nothing there to type into",
               "show read-only" in tip
               and "Default cell width/height disappear" in tip)
    check_true("grid: your sizes are read and never overwritten",
               "READ and never overwritten" in tip)
    check_true("grid: it re-flows on every Create Atlas",
               "re-flows on every Create Atlas" in tip)
    check_true("the clear is announced before it happens",
               "CLEARS every region" in tip)
    check_true("and so is the gate",
               ".atlas" in tip and "Not shown at all" in tip)


# --------------------------------------------------------------------------
# 3. The switch itself.
# --------------------------------------------------------------------------
def test_pack_to_grid_switches_and_strips() -> None:
    m = _packed(3)
    changed, lost = u.switch_atlas_layout(m, "grid")
    check("it reports a change, so the caller saves", changed, True)
    check("every region that HAD a rect is reported as losing it", lost,
          ["frame_00", "frame_01", "frame_02"])
    check("the layout really moved", m["atlas"]["layout"], "grid")

    r = m["regions"][1]
    check("the rect is gone",
          [k for k in ("x", "y", "w", "h") if k in r], [])
    check("the rotation flag is gone", "rotated" in r, False)
    check("the packer's trim record is gone",
          [k for k in ("off_x", "off_y", "orig_w", "orig_h") if k in r], [])
    # The one AUTHORED field in the packer-owned set: the To Atlas Maker export
    # stamps the author's `fit` choice, and it means the same on both sides.
    # Dropping it puts every frame back on the alpha-crop-and-recentre default
    # -- the per-frame re-centring a flipbook must not have -- and grid_layout
    # would never put it back.
    check("the author's fit_mode SURVIVES", r.get("fit_mode"), "contain")
    check("the creative data survives", (r.get("prompt"), r.get("seed"),
                                         r.get("style_ref")),
          ("a gold coin 1", 1001, "refs/coin_1.png"))
    # The page the packer wrote is deliberately KEPT: it is the only size the
    # atlas has, and the author retypes it (or not). The cell size is what the
    # grid still needs -- see the landing test below.
    check("the packer's page is left for the author to edit",
          (m["atlas"]["width"], m["atlas"]["height"]), (1028, 25652))
    check("no cell size is invented",
          "cell_width" in m["atlas"], False)


def test_grid_to_pack_strips_too() -> None:
    """Symmetry is not cosmetic: a grid rect addresses a cell the AUTHOR sized,
    which means nothing on a page the packer is about to size."""
    m = _packed(2, layout="grid", cell_width=128, cell_height=128)
    changed, lost = u.switch_atlas_layout(m, "pack")
    check("it reports a change", changed, True)
    check("both regions lost their rect", lost, ["frame_00", "frame_01"])
    check("the layout moved", m["atlas"]["layout"], "pack")
    check("no rect survives",
          any(k in r for r in m["regions"] for k in ("x", "y", "w", "h")),
          False)
    check("the author's cell size is left alone -- it is theirs, not a rect",
          (m["atlas"]["cell_width"], m["atlas"]["cell_height"]), (128, 128))


def test_the_same_layout_again_is_not_a_move() -> None:
    """The settings panel posts EVERY field on EVERY save, so this is the
    ordinary case. If it counted as a move, pressing Save would silently cost
    every region the rect the last Create Atlas gave it."""
    m = _packed(3)
    before = _snap(m)
    changed, lost = u.switch_atlas_layout(m, "pack")
    check("no change is reported", changed, False)
    check("nothing is reported lost", lost, [])
    check("the manifest is byte-for-byte what it was", _snap(m), before)

    g = _packed(3, layout="grid")
    gbefore = _snap(g)
    check("...and the same for a grid atlas",
          u.switch_atlas_layout(g, "GRID  "), (False, []))
    check("...byte-for-byte too", _snap(g), gbefore)


def test_an_unusable_value_changes_nothing() -> None:
    """The dropdown can only post the two, but a stale tab, a replayed POST or
    a hand-written one can post anything. Anything outside FROM_SCRATCH_LAYOUTS
    written into `atlas.layout` would read as ".atlas-bound" and turn off every
    from-scratch gate in the tool at once."""
    for bad in ("", "   ", "freeform", "Pack the art", "None", "0", "[]"):
        m = _packed(2)
        before = _snap(m)
        changed, lost = u.switch_atlas_layout(m, bad)
        check(f"{bad!r} is refused", (changed, lost), (False, []))
        check(f"...and changes nothing for {bad!r}", _snap(m), before)
        check(f"...and never becomes the layout for {bad!r}",
              m["atlas"]["layout"], "pack")


def test_the_gate_holds_in_the_switch_itself() -> None:
    """Defence in depth: the render filter hides the row, and the helper
    refuses it anyway. Only the second one survives a stale tab. The refusal is
    keyed on the BINDING, so every spelling of a set `atlas_file` is refused --
    including the contradictory bound-and-already-from-scratch shapes, where the
    `.atlas` still outranks whatever `layout` says."""
    for label, man in (
        ("an .atlas-bound atlas", _bound()),
        ("bound and already pack", _bound(layout="pack")),
        ("bound and already grid", _bound(layout="grid")),
        ("bound with a path", _bound(atlas_file="assets/symbols.atlas")),
        ("bound with whitespace", _bound(atlas_file="  symbols.atlas  ")),
    ):
        before = _snap(man)
        check(f"{label} cannot be handed to the packer",
              u.switch_atlas_layout(man, "pack"), (False, []))
        check(f"...and {label} is untouched", _snap(man), before)
        check(f"...nor to the grid ({label})",
              u.switch_atlas_layout(man, "grid"), (False, []))
        check(f"...still untouched ({label})", _snap(man), before)


def test_both_region_buckets_are_cleared() -> None:
    """Every manifest walk in this file reads `regions` AND `rotated_regions`;
    a switch that cleared only the first would leave a rotated symbol pointing
    into the page it just left."""
    m = _packed(1)
    m["rotated_regions"] = [{"name": "rot", "x": 9, "y": 9, "w": 9, "h": 9,
                             "rotated": True, "prompt": "sideways"}]
    changed, lost = u.switch_atlas_layout(m, "grid")
    check("it reports both buckets", (changed, lost),
          (True, ["frame_00", "rot"]))
    r = m["rotated_regions"][0]
    check("the rotated rect is gone too",
          [k for k in ("x", "y", "w", "h", "rotated") if k in r], [])
    check("...with its creative data intact", r.get("prompt"), "sideways")


def test_a_never_placed_region_is_not_reported_lost() -> None:
    """`lost` is what the reply counts. A region that never had a rect is the
    ordinary 'added but not generated yet' case and saying it lost something
    reads as damage."""
    m = _packed(1)
    m["regions"].append({"name": "new_one", "prompt": "not generated yet"})
    m["regions"].append({"name": "half", "x": 1, "y": 2})   # incomplete rect
    changed, lost = u.switch_atlas_layout(m, "grid")
    check("only the complete rect is reported", (changed, lost),
          (True, ["frame_00"]))
    check("the half rect is still cleared, it just is not reported",
          "x" in m["regions"][2], False)


def test_a_superseded_texturepacker_descriptor_is_dropped() -> None:
    """Same pop both layout passes make. The launcher's
    `backfillMissingGeometry` treats the descriptor as AUTHORITATIVE and would
    hand every region the old rect straight back BY NAME -- undoing the clear
    one layer up, where nothing here can see it."""
    m = _packed(2, texturepacker_json="deploy/symbols.json")
    changed, _ = u.switch_atlas_layout(m, "grid")
    check("the descriptor is popped", "texturepacker_json" in m["atlas"],
          False)
    check("...and the switch still reports itself", changed, True)


def test_a_broken_region_list_never_escapes() -> None:
    m = _packed(1)
    m["regions"].append("not a dict")
    m["regions"].append({"no": "name"})
    m["rotated_regions"] = None
    changed, lost = u.switch_atlas_layout(m, "grid")
    check("the junk is skipped and the real region cleared",
          (changed, lost), (True, ["frame_00"]))


# --------------------------------------------------------------------------
# 4. THE LANDING: the first Create Atlas after a pack -> grid switch.
# --------------------------------------------------------------------------
def test_the_pack_to_grid_landing_reads_as_the_next_step() -> None:
    """A packed atlas has a page and has NEVER had a cell size, so the very
    first Create Atlas after switching hits grid_layout's missing-field branch.
    'Default cell width is missing' alone reads as a fault rather than as the
    one step left to take."""
    m = _packed(3)
    u.switch_atlas_layout(m, "grid")
    before = _snap(m)
    note, changed = u.grid_layout(m)

    check("nothing is laid out", changed, False)
    check("...and nothing is written", _snap(m), before)
    check("...so the cleared regions stay UNPLACED -- no stale pack rect "
          "survives to be deployed as if it were the grid",
          any(k in r for r in m["regions"] for k in ("x", "y", "w", "h")),
          False)

    check_true("the note names BOTH missing cell fields",
               "Default cell width" in note and "Default cell height" in note)
    check_true("...with the right verb", "are missing" in note)
    check_true("it says this is the expected landing, not a fault",
               "normal right after switching" in note)
    check_true("...and names the one action left",
               "Create Atlas again" in note)
    check_true("no cell size is guessed -- the cell IS the layout",
               "Nothing is guessed" in note)
    check("...and none was written either", "cell_width" in m["atlas"], False)


def test_a_missing_page_still_gets_the_plain_message() -> None:
    """The friendly landing is for the cell-only case. If the PAGE is missing
    too this is not a fresh pack->grid switch, and telling the author 'that is
    normal right after switching' would be a lie."""
    m = _packed(2, layout="grid", width=0, height=0)
    note, changed = u.grid_layout(m)
    check("still refuses", changed, False)
    check_true("the page is named", "Atlas width" in note
               and "Atlas height" in note)
    check("...and it does NOT claim to be the switch landing",
          "normal right after switching" in note, False)
    check_true("it still says what to do",
               "Set all four" in note and "Create Atlas again" in note)


def test_the_landing_survives_over_capacity() -> None:
    """The case the clear exists for. With a cell set but the page too small,
    grid_layout changes NOTHING -- so anything the switch left behind would be
    deployed as the grid."""
    m = _packed(5)
    u.switch_atlas_layout(m, "grid")
    m["atlas"].update(width=200, height=200, cell_width=100, cell_height=100)
    note, changed = u.grid_layout(m)
    check("over capacity still refuses", changed, False)
    check_true("...and says so", "would not fit" in note)
    check("and there is no stale pack rect left to ship",
          any(k in r for r in m["regions"] for k in ("x", "y", "w", "h")),
          False)


def test_the_switch_then_a_cell_size_lays_the_grid_out() -> None:
    """The happy path end to end: switch, type a cell, Create Atlas."""
    m = _packed(4)
    u.switch_atlas_layout(m, "grid")
    m["atlas"].update(width=400, height=400, cell_width=200, cell_height=200)
    note, changed = u.grid_layout(m)
    check("it lays out", changed, True)
    check("a 2x2 grid in manifest order",
          [(r["x"], r["y"], r["w"], r["h"]) for r in m["regions"]],
          [(0, 0, 200, 200), (200, 0, 200, 200),
           (0, 200, 200, 200), (200, 200, 200, 200)])
    check("the author's page is not overwritten",
          (m["atlas"]["width"], m["atlas"]["height"]), (400, 400))
    check("the creative data came through the whole trip",
          m["regions"][3]["prompt"], "a gold coin 3")
    check_true("the note describes the grid the author asked for",
               "2x2 grid of 200" in note.replace("×", "x"))


# --------------------------------------------------------------------------
# 5. THE SAVE PATH, end to end through the real /saveconfig.
# --------------------------------------------------------------------------
class FakeHandler:
    """Just enough of the request object for `_saveconfig`, which reads
    module-level config/manifest helpers rather than request state. Same
    harness as test_blueprint_publish.py."""

    def _saveconfig(self, edits: dict) -> str:
        return u.Handler._saveconfig(self, edits)

    def _seed_refs_into_outputs(self, m, only_empty=True):  # session switch only
        raise AssertionError("not expected: this save never switches manifest")


def _install(man: dict, name: str = "atlas_manifest_switch.json") -> Path:
    p = Path(str(u.MANIFEST_DIR))
    p.mkdir(parents=True, exist_ok=True)
    dest = p / name
    dest.write_text(json.dumps(man, indent=2), encoding="utf-8")
    u.save_config({**u.load_config(), "manifest_path": name})
    return dest


def _panel(**over) -> dict:
    """What the 🧩 Atlas settings panel actually POSTs: every geometry field,
    every time, in ATLAS_GEOM_FIELDS order (cfgData walks the DOM)."""
    posted = {"atlas_file": "", "atlas_layout": "pack", "atlas_width": "1028",
              "atlas_height": "25652", "atlas_cell_width": "",
              "atlas_cell_height": "", "atlas_format": "RGBA",
              "atlas_source_image": "", "atlas_pack_trim": "alpha"}
    posted.update(over)
    return posted


def _saved(dest: Path) -> dict:
    return json.loads(dest.read_text(encoding="utf-8"))


def test_saving_grid_onto_a_pack_atlas_persists_and_strips() -> None:
    dest = _install(_packed(3))
    msg = FakeHandler()._saveconfig(_panel(atlas_layout="grid"))
    out = _saved(dest)

    check("the layout is on disk", out["atlas"]["layout"], "grid")
    check("every pack rect is off disk",
          any(k in r for r in out["regions"] for k in ("x", "y", "w", "h")),
          False)
    check("the author's fit_mode is still on disk",
          out["regions"][0].get("fit_mode"), "contain")
    check("the creative data is still on disk",
          [r.get("prompt") for r in out["regions"]],
          ["a gold coin 0", "a gold coin 1", "a gold coin 2"])
    check_true("the reply names the new layout", "'grid'" in msg)
    check_true("...and how many regions it cost", "3 region(s) lost" in msg)
    check_true("...and the one thing to do next",
               "Default cell width/height" in msg and "Create Atlas" in msg)


def test_a_size_typed_in_the_same_save_survives_the_switch() -> None:
    """The real interaction: the author picks grid AND types the page/cell in
    one go, and the panel posts all of them together. The switch must not
    stomp the fields posted alongside it, in either order."""
    dest = _install(_packed(2))
    FakeHandler()._saveconfig(_panel(atlas_layout="grid", atlas_width="2048",
                                     atlas_height="2048",
                                     atlas_cell_width="256",
                                     atlas_cell_height="256"))
    a = _saved(dest)["atlas"]
    check("layout, page and cell all landed",
          (a["layout"], a["width"], a["height"], a["cell_width"],
           a["cell_height"]), ("grid", 2048, 2048, 256, 256))


def test_an_ordinary_re_save_costs_no_region_its_rect() -> None:
    """THE regression this must never have. The panel posts `atlas_layout` on
    every save; pressing Save after a successful Create Atlas must not be read
    as a move and wipe the grid that was just laid out."""
    m = _packed(4)
    u.switch_atlas_layout(m, "grid")
    m["atlas"].update(width=400, height=400, cell_width=200, cell_height=200)
    u.grid_layout(m)
    dest = _install(m)
    placed = [(r["x"], r["y"], r["w"], r["h"]) for r in _saved(dest)["regions"]]

    msg = FakeHandler()._saveconfig(_panel(atlas_layout="grid",
                                           atlas_width="400",
                                           atlas_height="400",
                                           atlas_cell_width="200",
                                           atlas_cell_height="200"))
    out = _saved(dest)
    check("the reply is the ordinary one, so no strip ran",
          msg, "Settings saved (per-atlas overrides + globals)")
    check("every rect is exactly where Create Atlas put it",
          [(r["x"], r["y"], r["w"], r["h"]) for r in out["regions"]], placed)
    check("the layout is untouched", out["atlas"]["layout"], "grid")


def test_the_save_path_refuses_an_atlas_bound_manifest() -> None:
    """The stale-tab / hand-made-POST route past the render filter. A bound
    atlas's rects came from its `.atlas` and nothing here re-derives them."""
    dest = _install(_bound(), name="atlas_manifest_bound.json")
    before = dest.read_text(encoding="utf-8")
    for want in ("pack", "grid"):
        # The panel for a BOUND atlas posts that atlas's own geometry, so
        # `atlas_layout` is the only intruder in the payload -- any difference
        # afterwards is the switch's doing and nothing else's.
        msg = FakeHandler()._saveconfig(_panel(atlas_layout=want,
                                               atlas_file="symbols.atlas",
                                               atlas_width="2048",
                                               atlas_height="2048",
                                               atlas_format="",
                                               atlas_pack_trim=""))
        out = _saved(dest)
        check(f"posting {want!r} does not create a layout",
              "layout" in out["atlas"], False)
        check(f"...the authored rect survives {want!r}",
              (out["regions"][0]["x"], out["regions"][0]["w"]), (0, 256))
        check(f"...and the reply is the ordinary one for {want!r}",
              msg, "Settings saved (per-atlas overrides + globals)")
    check("the .atlas binding is intact", _saved(dest)["atlas"]["atlas_file"],
          "symbols.atlas")
    check("nothing about the manifest changed at all",
          json.loads(before)["atlas"], _saved(dest)["atlas"])


def test_a_blank_or_unknown_post_cannot_wipe_the_field() -> None:
    """Two separate guards: a blank `_ATLAS_GEOM_KEYS` value is skipped
    wholesale ('never wipe required atlas geometry'), and an unrecognised one
    must not fall through to the generic `atlas[mk] = sv` write -- where
    anything outside FROM_SCRATCH_LAYOUTS reads as '.atlas-bound' and turns off
    every from-scratch gate at once."""
    for bad in ("", "   ", "freeform", "Grid of cells", "None"):
        dest = _install(_packed(2))
        msg = FakeHandler()._saveconfig(_panel(atlas_layout=bad))
        out = _saved(dest)
        check(f"{bad!r} leaves the layout as it was",
              out["atlas"]["layout"], "pack")
        check(f"...and costs no region its rect ({bad!r})",
              [(r["x"], r["y"]) for r in out["regions"]],
              [(2, 2), (102, 2)])
        check(f"...and reports nothing special ({bad!r})",
              msg, "Settings saved (per-atlas overrides + globals)")


def test_the_reply_is_honest_when_nothing_had_a_rect() -> None:
    m = _packed(0)
    m["regions"] = [{"name": "fresh", "prompt": "nothing generated yet"}]
    dest = _install(m)
    msg = FakeHandler()._saveconfig(_panel(atlas_layout="grid"))
    check("the switch still happened", _saved(dest)["atlas"]["layout"], "grid")
    check_true("...but it does not claim damage it did not do",
               "No region had a rect" in msg)
    check("...and never says a count", "region(s) lost" in msg, False)


# --------------------------------------------------------------------------
# 6. The reply has to be readable: saveCfg reloads the page and wipes it.
# --------------------------------------------------------------------------
def test_a_long_save_reply_is_given_time_to_be_read() -> None:
    """`saveCfg` writes the server's reply into a status span and reloads 900ms
    later -- fine for 'Settings saved', not for the switch reply, which is the
    only warning that the region cards are about to come back unplaced ON
    PURPOSE. The reload is also what brings those cards back, so it cannot
    simply be dropped."""
    src = Path(u.__file__).read_text(encoding="utf-8")
    js = src.split("async function saveCfg(btn)")[1].split("\n}}")[0]
    check("the reply is captured before it is used",
          "let txt=await r.text();" in js, True)
    check("a long reply outlives the 900ms default",
          "setTimeout(()=>location.reload(),txt.length>90?5000:900);" in js,
          True)
    # Cheap staleness guard: if the wording shrinks below the threshold the
    # delay silently stops applying to the message it was added for.
    reply = ("Settings saved - layout is now 'grid'. 3 region(s) lost the rect "
             "the previous layout gave them. Set Default cell width/height "
             "first. Press Create Atlas to lay the regions out again.")
    check("the switch reply is over that threshold", len(reply) > 90, True)


if __name__ == "__main__":
    # R2 is not reachable offline and every save mirrors write-through; stand in
    # for the bucket so nothing here waits on a socket. Staging is a real temp
    # tree, which is what the fixtures read back.
    storage.push_file = lambda p, key, **kw: True       # type: ignore[assignment]
    storage.put = lambda key, data, **kw: None          # type: ignore[assignment]

    for fn in (test_the_gate_withholds_the_row_from_a_bound_atlas,
               test_the_gate_hides_nothing_else,
               test_the_panel_renders_through_the_filter_not_the_raw_list,
               test_the_choices_are_the_from_scratch_layouts,
               test_the_control_is_a_named_dropdown_with_no_blank,
               test_the_stored_value_is_the_selected_one,
               test_the_pack_trim_control_is_unaffected,
               test_the_help_says_who_owns_the_size_fields,
               test_pack_to_grid_switches_and_strips,
               test_grid_to_pack_strips_too,
               test_the_same_layout_again_is_not_a_move,
               test_an_unusable_value_changes_nothing,
               test_the_gate_holds_in_the_switch_itself,
               test_both_region_buckets_are_cleared,
               test_a_never_placed_region_is_not_reported_lost,
               test_a_superseded_texturepacker_descriptor_is_dropped,
               test_a_broken_region_list_never_escapes,
               test_the_pack_to_grid_landing_reads_as_the_next_step,
               test_a_missing_page_still_gets_the_plain_message,
               test_the_landing_survives_over_capacity,
               test_the_switch_then_a_cell_size_lays_the_grid_out,
               test_saving_grid_onto_a_pack_atlas_persists_and_strips,
               test_a_size_typed_in_the_same_save_survives_the_switch,
               test_an_ordinary_re_save_costs_no_region_its_rect,
               test_the_save_path_refuses_an_atlas_bound_manifest,
               test_a_blank_or_unknown_post_cannot_wipe_the_field,
               test_the_reply_is_honest_when_nothing_had_a_rect,
               test_a_long_save_reply_is_given_time_to_be_read):
        _say(f"\n-- {fn.__name__}")
        fn()
    print()
    if FAILED:
        _say(f"{len(FAILED)} FAILED of {len(FAILED) + len(PASSED)}: "
             + ", ".join(FAILED))
        sys.exit(1)
    _say(f"all {len(PASSED)} layout-switch fixtures pass")
