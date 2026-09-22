"""Offline guard: the 🧩 Atlas settings panel offers only the geometry fields
the chosen Layout actually READS. No R2, no GPU, no ComfyUI.

Run:  PYTHONIOENCODING=utf-8 PYTHONPATH=".;../_shared" py test_layout_aware_panel.py
      (from services/atlas-tool; needs node on PATH for the JS layers)

THE FAULT THIS CLOSES. #712/#717 gave the panel a Layout dropdown, but left all
nine geometry rows on screen under both layouts -- and under each layout half of
them are read by NOTHING. The owner typed 2048x2048 into Atlas width/height on a
`pack` atlas, saved (it persisted, and survived a hard refresh), pressed Create
Atlas, and got the packer's 1028x25652 written straight over it. Three rounds
were spent on that. A field that does nothing must not look like a field that
does something.

THE SPLIT, measured against the shipping code rather than guessed:

  atlas_cell_width/height  pack: DEAD. `auto_pack_layout` stamps an explicit
                           w/h onto every region it places, so `region_box`'s
                           cell fallback never fires.
                           grid: it IS the layout (`grid_layout` reads it).
  atlas_pack_trim          BOTH. It is the measurement the packer takes AND
                           the one compose places with: `fit_to_region` crops
                           the art to its alpha unless this says otherwise, on
                           `grid` as much as on `pack`. #719 called it DEAD
                           under grid because `pack_trim_mode` is called at
                           exactly one place, inside `auto_pack_layout` -- true,
                           and not the question. Hiding it took the owner's only
                           say over cropping away while the cropping went on
                           happening one function along. It is back, and it is
                           back because it WORKS there: `test_pack_trim.py` §5
                           composes a grid atlas both ways and compares pixels.
  atlas_width/height       pack: OUTPUT. `auto_pack_layout` writes them.
                           grid: INPUT. `grid_layout` reads, never writes.
`test_the_split_is_still_true_of_the_code` pins the rest by reading
ui_server.py and batch_atlas.py, so the table cannot drift away from the source
it describes.

THE THREE PROPERTIES, all pinned below.

1. HIDDEN, NOT OMITTED. Rows ship in the DOM with `display:none`, because
   `cfgData()` walks `[data-cfg]` and reads `.value` -- which a hidden (and a
   readonly) control still has. So a hidden field keeps round-tripping its
   stored value and pack->grid->pack cannot lose a cell size. Omitting the
   markup would also make the live toggle impossible: choosing Grid has to
   REVEAL the cell fields you then need to fill.
2. READONLY, NOT DISABLED, for the two the packer owns. A disabled input posts
   nothing, which is the one way a locked field could still be wiped.
3. THE BOUND ATLAS IS UNTOUCHED. A `.atlas`-bound / legacy cell-grid manifest
   has no Layout row (`atlas_geom_fields_for`) and its cell size is LIVE --
   `region_box` really does fall back to it. Its rows are pinned byte-for-byte
   against what origin/main rendered, tooltips aside.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

# Sandbox staging BEFORE importing the tool: MANIFEST_DIR and friends resolve
# out of it, and nothing here may touch a real project.
_STAGING = tempfile.mkdtemp(prefix="layout-aware-panel-")
os.environ["ATLAS_STAGING"] = _STAGING

import batch_atlas  # noqa: E402
import storage  # noqa: E402
import ui_server as u  # noqa: E402
import test_page_js as pjs  # noqa: E402  — render_page/node_check/scripts_of

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
# Manifest shapes + a tiny reader for the rendered rows.
# --------------------------------------------------------------------------
def _scratch(layout: str = "pack", **atlas) -> dict:
    """A from-scratch atlas carrying a value in EVERY geometry field, so a row
    that quietly stops round-tripping shows up as a lost value and not as a
    coincidentally-blank one."""
    a = {"layout": layout, "width": 1028, "height": 25652,
         "cell_width": 256, "cell_height": 256, "format": "RGBA8888",
         "source_image": "page.png", "pack_trim": "keep"}
    a.update(atlas)
    return {"atlas": a,
            "regions": [{"name": "frame_00", "x": 2, "y": 2, "w": 96, "h": 96,
                         "prompt": "a gold coin"}]}


def _bound(**atlas) -> dict:
    """The `.atlas`-bound kind, in the exact shape the golden below was
    rendered from on origin/main."""
    a = {"atlas_file": "symbols.atlas", "width": 2048, "height": 2048,
         "cell_width": 256, "cell_height": 256, "format": "RGBA8888",
         "source_image": "symbols.png", "pack_trim": "keep"}
    a.update(atlas)
    return {"atlas": a,
            "regions": [{"name": "H1", "x": 0, "y": 0, "w": 256, "h": 256}]}


def rows(m: dict) -> list[str]:
    return u.atlas_geom_rows_html(m, {}, {})


_CTRL = re.compile(r'<(input|select)\b[^>]*?data-cfg="([a-z_]+)"[^>]*?>')
_SELECTED = re.compile(r'<option value="([^"]*)"[^>]*\bselected')
_FIRST_OPT = re.compile(r'<option value="([^"]*)"')


def key_of(row: str) -> str:
    m = _CTRL.search(row)
    return m.group(2) if m else ""


def row_for(m: dict, ui_key: str) -> str:
    for r in rows(m):
        if key_of(r) == ui_key:
            return r
    return ""


def is_hidden(row: str) -> bool:
    """Only the <label> opening tag counts -- the read-only note inside a row
    carries a display:none of its own."""
    return 'style="display:none"' in row.split(">", 1)[0]


def is_readonly(row: str) -> bool:
    m = _CTRL.search(row)
    return bool(m) and re.search(r"\sreadonly(?=[\s>])", m.group(0)) is not None


def group_of(row: str) -> str:
    m = re.search(r'data-layout="([a-z]+)"', row.split(">", 1)[0])
    return m.group(1) if m else ""


def visible_keys(m: dict) -> list[str]:
    return [key_of(r) for r in rows(m) if not is_hidden(r)]


def hidden_keys(m: dict) -> list[str]:
    return [key_of(r) for r in rows(m) if is_hidden(r)]


def cfg_data(m: dict) -> dict:
    """What the page's `cfgData()` would POST from this panel: it walks every
    `[data-cfg]` and reads `.value`, with no regard for display or readonly.
    Reproduced here so the save fixtures post what the DOM posts, not what a
    hand-written dict guesses."""
    out: dict[str, str] = {}
    for row in rows(m):
        m_ctrl = _CTRL.search(row)
        if not m_ctrl:
            continue
        tag, key = m_ctrl.group(1), m_ctrl.group(2)
        if tag == "input":
            val = re.search(r'\bvalue="([^"]*)"', m_ctrl.group(0))
            out[key] = val.group(1) if val else ""
        else:
            body = row[m_ctrl.end():]
            sel = _SELECTED.search(body) or _FIRST_OPT.search(body)
            out[key] = sel.group(1) if sel else ""
    return out


# --------------------------------------------------------------------------
# 1. The split, and that it still describes the code.
# --------------------------------------------------------------------------
def test_the_table_is_the_measured_one() -> None:
    check("only the two measured rows are layout-specific",
          u.ATLAS_GEOM_LAYOUT_GROUP,
          {"atlas_cell_width": "grid", "atlas_cell_height": "grid"})
    check("Frame trim is not one of them -- it is live under both",
          u.ATLAS_GEOM_LAYOUT_GROUP.get("atlas_pack_trim",
                                        u.ATLAS_GEOM_LAYOUT_BOTH),
          u.ATLAS_GEOM_LAYOUT_BOTH)
    check("only the two the packer writes are locked",
          u.ATLAS_GEOM_READONLY_IN,
          {"atlas_width": "pack", "atlas_height": "pack"})
    known = {f[0] for f in u.ATLAS_GEOM_FIELDS}
    keyed = set(u.ATLAS_GEOM_LAYOUT_GROUP) | set(u.ATLAS_GEOM_READONLY_IN)
    check("every keyed row is a real geometry field", sorted(keyed - known), [])
    named = (set(u.ATLAS_GEOM_LAYOUT_GROUP.values())
             | set(u.ATLAS_GEOM_READONLY_IN.values()))
    check("every group names a layout this tool can actually lay out",
          sorted(named - batch_atlas.FROM_SCRATCH_LAYOUTS
                 - {u.ATLAS_GEOM_LAYOUT_BOTH}), [])
    # The Layout dropdown itself can never hide: it is the only way back.
    check("the Layout row is never layout-specific",
          "atlas_layout" in u.ATLAS_GEOM_LAYOUT_GROUP, False)


def test_the_split_is_still_true_of_the_code() -> None:
    """The table above is a claim ABOUT ui_server.py. Read the file and hold it
    to that claim, so a later edit that starts reading `pack_trim` from the grid
    pass (or a cell size from the packer) fails here instead of silently making
    a hidden field load-bearing."""
    src = Path(u.__file__).read_text(encoding="utf-8").split("\n")

    def body(fn: str) -> str:
        at = next(i for i, ln in enumerate(src) if ln.startswith(f"def {fn}("))
        end = next((i for i in range(at + 1, len(src))
                    if src[i].startswith("def ")), len(src))
        return "\n".join(src[at:end])

    pack, grid = body("auto_pack_layout"), body("grid_layout")
    check("the packer reads the trim mode", "pack_trim_mode(m)" in pack, True)
    check("the grid pass does not -- it has no art to measure",
          "pack_trim_mode" in grid, False)
    check("the grid pass reads the cell size", 'cell_width' in grid, True)
    check("the packer reads no cell size", "cell_width" in pack, False)
    check("the packer WRITES the page size",
          'atlas["width"]' in pack and 'atlas["height"]' in pack, True)
    check("the grid pass never writes the page size",
          'atlas["width"]' in grid or 'atlas["height"]' in grid, False)
    whole = "\n".join(src)
    check("the LAYOUT passes read the trim mode at exactly one place",
          whole.count("pack_trim_mode(m)"), 1)
    # ...and the SECOND reader, which is why the row is no longer grid-hidden:
    # compose places every from-scratch region through `fit_to_region`, and it
    # asks the same question there, under either layout.
    ba = Path(batch_atlas.__file__).read_text(encoding="utf-8")
    fit = ba.split("def fit_to_region(")[1].split("\ndef ")[0]
    check("compose reads it too", "keep_full_frame(" in fit, True)
    check("...and that gate is what makes the alpha crop conditional",
          "if not keep_full:" in fit, True)
    check("...as is the sheet-parity short-circuit",
          "if not keep_full and (" in fit, True)
    check("the normalizer lives in ONE module, and the panel borrows it",
          (u.pack_trim_mode is batch_atlas.pack_trim_mode,
           "def pack_trim_mode(" in whole), (True, False))


# --------------------------------------------------------------------------
# 2. What each layout shows. THE ASK, stated twice.
# --------------------------------------------------------------------------
def test_frame_trim_is_offered_under_every_layout() -> None:
    """The owner's ask in one place, over every shape the panel takes: "the old
    drop down, where I could select if the image was full or cropped to the
    alpha is now gone and I need it back asap". Rendered, visible, editable,
    both choices, under pack AND grid -- and tagged `both`, so the browser's
    `applyAtlasLayout` keeps it visible on every switch rather than only on the
    first paint."""
    for layout in ("pack", "grid"):
        row = row_for(_scratch(layout), "atlas_pack_trim")
        check(f"{layout}: the Frame trim row is rendered", bool(row), True)
        if not row:
            continue
        check(f"{layout}: ...and visible", is_hidden(row), False)
        check(f"{layout}: ...offering both choices",
              re.findall(r'<option value="([a-z]+)"', row), ["alpha", "keep"])
        check(f"{layout}: ...and editable", is_readonly(row), False)
        check(f"{layout}: ...tagged live under both layouts",
              group_of(row), u.ATLAS_GEOM_LAYOUT_BOTH)
        check(f"{layout}: ...so the browser keeps it on screen too",
              u.layout_row_visible(group_of(row), layout), True)
    check("an unset atlas opens on the new default, not cropped",
          f'<option value="{u.PACK_TRIM_DEFAULT}" selected'
          in row_for(_scratch("grid", pack_trim=""), "atlas_pack_trim"), True)
    check("...which is 'keep the whole frame'", u.PACK_TRIM_DEFAULT, "keep")
    check("and a bound atlas still gets the row it always had",
          bool(row_for(_bound(), "atlas_pack_trim")), True)


def test_pack_hides_the_cell_size_and_locks_the_page_size() -> None:
    m = _scratch("pack")
    check("the cell fields are gone from the visible panel",
          [k for k in visible_keys(m) if k.startswith("atlas_cell")], [])
    check("...and they are the ONLY rows hidden",
          hidden_keys(m), ["atlas_cell_width", "atlas_cell_height"])
    check_true("Frame trim is on screen -- pack is what measures with it",
               "atlas_pack_trim" in visible_keys(m))
    for k in ("atlas_width", "atlas_height"):
        check(f"{k} is still on screen (the page size is worth reading)",
              k in visible_keys(m), True)
        check(f"...but {k} is read-only -- the packer writes it",
              is_readonly(row_for(m, k)), True)
        check(f"...and {k} says so, inline, next to the box",
              u.ATLAS_GEOM_READONLY_NOTE in row_for(m, k), True)
        check(f"...with the note actually shown ({k})",
              'class="rohint" style="display:none"' in row_for(m, k), False)
    check("the Layout dropdown is there to switch back with",
          "atlas_layout" in visible_keys(m), True)


def test_grid_shows_the_trim_and_hands_the_page_size_back() -> None:
    """THE REGRESSION, stated as the ask: "the old drop down, where I could
    select if the image was full or cropped to the alpha is now gone and I need
    it back asap". It is on screen under grid, and it is on screen because it
    WORKS there -- `test_pack_trim.py` §5 composes the pixels both ways."""
    m = _scratch("grid")
    check("Frame trim is on the visible panel",
          "atlas_pack_trim" in visible_keys(m), True)
    check("...and nothing at all is hidden under grid", hidden_keys(m), [])
    for k in ("atlas_cell_width", "atlas_cell_height"):
        check(f"{k} is on screen -- under grid it IS the layout",
              k in visible_keys(m), True)
        check(f"...and editable ({k})", is_readonly(row_for(m, k)), False)
    for k in ("atlas_width", "atlas_height"):
        check(f"{k} is editable again -- grid reads it, never writes it",
              is_readonly(row_for(m, k)), False)
        check(f"...and the packer note is hidden with it ({k})",
              'class="rohint" style="display:none"' in row_for(m, k), True)


def test_the_rows_and_the_dropdown_read_the_same_stored_value() -> None:
    """The dropdown normalizes case/whitespace (`_control_html`) and so does
    the row filter (`batch_atlas.atlas_layout`). If they ever disagreed, the
    page would paint one layout's rows next to the other layout's selection and
    then jump the moment `applyAtlasLayout` ran on load."""
    for stored, want_hidden in ((" GRID ", []),
                                ("Pack", ["atlas_cell_width",
                                          "atlas_cell_height"]),
                                ("grid", [])):
        m = _scratch(stored)
        sel = re.search(r'<option value="([a-z]+)" selected',
                        row_for(m, "atlas_layout"))
        check(f"{stored!r}: the dropdown shows the normalized layout",
              sel.group(1) if sel else None, stored.strip().lower())
        check(f"{stored!r}: and the hidden rows are that layout's dead ones",
              hidden_keys(m), want_hidden)


def test_no_row_is_ever_dropped_from_the_markup() -> None:
    """Hidden, never omitted -- property 1. Both layouts must still render all
    nine rows, or `cfgData()` stops posting the hidden ones."""
    everything = [f[0] for f in u.ATLAS_GEOM_FIELDS]
    for layout in ("pack", "grid"):
        m = _scratch(layout)
        check(f"{layout}: every geometry row is in the DOM",
              [key_of(r) for r in rows(m)], everything)
        check(f"{layout}: every row still carries data-cfg",
              all(key_of(r) for r in rows(m)), True)
        check(f"{layout}: every row is tagged with its layout group",
              all(group_of(r) for r in rows(m)), True)


def test_a_hidden_row_still_carries_its_stored_value() -> None:
    """The DOM-level half of the round-trip: the value is IN the hidden markup,
    which is the only reason `cfgData()` can post it."""
    pack = _scratch("pack", cell_width=333, cell_height=444)
    check_true("the hidden cell width still holds 333",
               'value="333"' in row_for(pack, "atlas_cell_width"))
    check_true("the hidden cell height still holds 444",
               'value="444"' in row_for(pack, "atlas_cell_height"))
    grid = _scratch("grid", pack_trim="keep")
    check_true("the Frame trim row shows the stored 'keep' under grid too",
               '<option value="keep" selected' in row_for(grid, "atlas_pack_trim"))
    check("a read-only box still carries its value, so it still posts",
          cfg_data(_scratch("pack"))["atlas_width"], "1028")


def test_locked_means_readonly_and_never_disabled() -> None:
    """Property 2. `disabled` would drop the field from the POST entirely --
    the one way locking a field could still wipe it."""
    for layout in ("pack", "grid"):
        joined = "".join(rows(_scratch(layout)))
        check(f"{layout}: nothing in the panel is disabled",
              "disabled" in joined, False)
    # `.get` on purpose: a row DROPPED from the markup is the failure this
    # test exists to report, not a KeyError that stops the suite.
    posted = cfg_data(_scratch("pack"))
    check("a pack panel still posts every geometry key",
          sorted(posted), sorted(f[0] for f in u.ATLAS_GEOM_FIELDS))
    check("...including the hidden cell size, at its stored value",
          (posted.get("atlas_cell_width"), posted.get("atlas_cell_height")),
          ("256", "256"))
    check("...and the read-only page size, unchanged",
          (posted.get("atlas_width"), posted.get("atlas_height")),
          ("1028", "25652"))


# --------------------------------------------------------------------------
# 3. THE BOUND ATLAS. Pinned against what origin/main actually rendered.
# --------------------------------------------------------------------------
# Captured by running e1627058's `atlas_geom_fields_for` loop over `_bound()`
# above, then replacing every `title="…"` with `title=TIP`. The tooltips are
# excluded ON PURPOSE -- SETTING_HELP was rewritten in this change and shows in
# the bound panel too -- so what this pins is the row STRUCTURE: no data-layout,
# no data-ro-layout, no readonly, no display:none, no note, same order, same
# controls, same values.
_BOUND_ROWS_ON_MAIN = (
    '<label><span class="lblrow">Source .atlas (geometry) <span style="color:#888;font-size:10px">· this atlas</span><span class="qm" title=TIP>&#9432;</span></span><span class="filefld"><input data-cfg="atlas_file" title=TIP type="text" value="symbols.atlas" placeholder=""><button type="button" class="fbtn" title=TIP onclick="openFs(\'atlas_file\')">📁</button></span></label>',
    '<label><span class="lblrow">Atlas width <span style="color:#888;font-size:10px">· this atlas</span><span class="qm" title=TIP>&#9432;</span></span><input data-cfg="atlas_width" title=TIP type="number" value="2048" placeholder="" step=any></label>',
    '<label><span class="lblrow">Atlas height <span style="color:#888;font-size:10px">· this atlas</span><span class="qm" title=TIP>&#9432;</span></span><input data-cfg="atlas_height" title=TIP type="number" value="2048" placeholder="" step=any></label>',
    '<label><span class="lblrow">Default cell width <span style="color:#888;font-size:10px">· this atlas</span><span class="qm" title=TIP>&#9432;</span></span><input data-cfg="atlas_cell_width" title=TIP type="number" value="256" placeholder="" step=any></label>',
    '<label><span class="lblrow">Default cell height <span style="color:#888;font-size:10px">· this atlas</span><span class="qm" title=TIP>&#9432;</span></span><input data-cfg="atlas_cell_height" title=TIP type="number" value="256" placeholder="" step=any></label>',
    '<label><span class="lblrow">Atlas format <span style="color:#888;font-size:10px">· this atlas</span><span class="qm" title=TIP>&#9432;</span></span><select data-cfg="atlas_format" title=TIP><option value="">(blank — none)</option><option value="RGBA8888" selected>RGBA8888</option><option value="RGBA4444">RGBA4444</option><option value="RGB888">RGB888</option><option value="RGB565">RGB565</option></select></label>',
    '<label><span class="lblrow">Atlas source image <span style="color:#888;font-size:10px">· this atlas</span><span class="qm" title=TIP>&#9432;</span></span><span class="filefld"><input data-cfg="atlas_source_image" title=TIP type="text" value="symbols.png" placeholder=""><button type="button" class="fbtn" title=TIP onclick="openFs(\'atlas_source_image\')">📁</button></span></label>',
    # The one row whose LABELS this change rewrote (the old ones said
    # "(from-scratch layout)" and promised a smallest page / a common centre --
    # claims about `pack` alone). STRUCTURE is what this golden is for, and the
    # structure is still main's: same position, same control, same two values,
    # same `selected`, no data-layout, no readonly, no display:none.
    '<label><span class="lblrow">Frame trim <span style="color:#888;font-size:10px">· this atlas</span><span class="qm" title=TIP>&#9432;</span></span><select data-cfg="atlas_pack_trim" title=TIP><option value="alpha">Crop each frame to its visible pixels</option><option value="keep" selected>Keep the whole frame, transparent edges included</option></select></label>',
)


def _skeleton(row: str) -> str:
    return re.sub(r'title="[^"]*"', "title=TIP", row)


def test_the_bound_panel_is_the_one_main_rendered() -> None:
    got = [_skeleton(r) for r in rows(_bound())]
    check("the bound panel still has main's eight rows", len(got), 8)
    for i, want in enumerate(_BOUND_ROWS_ON_MAIN):
        check(f"bound row {i} ({key_of(want) or 'atlas_file'}) is unchanged",
              got[i] if i < len(got) else None, want)
    joined = "".join(rows(_bound()))
    for attr in ("data-layout", "data-ro-layout", "readonly", "rohint",
                 "display:none"):
        check(f"a bound atlas carries no {attr}", attr in joined, False)
    check("...and its tooltips are still filled in",
          all('title="' in r for r in rows(_bound())), True)


def test_the_bound_panel_is_blind_to_a_layout_that_is_not_its_own() -> None:
    """A bound manifest with a stray `layout` string is still bound (it is not
    in FROM_SCRATCH_LAYOUTS), so nothing about it may become layout-aware."""
    for junk in ("", "   ", "freeform", "Grid of cells"):
        joined = "".join(rows(_bound(layout=junk)))
        check(f"{junk!r}: no row is hidden",
              "display:none" in joined, False)
        check(f"{junk!r}: no row is locked", "readonly" in joined, False)
        check(f"{junk!r}: and there is still no Layout dropdown",
              'data-cfg="atlas_layout"' in joined, False)


# --------------------------------------------------------------------------
# 4. THE SAVE PATH. pack -> grid -> pack keeps what was set in between.
# --------------------------------------------------------------------------
class FakeHandler:
    """Just enough of the request object for `_saveconfig`, which reads
    module-level config/manifest helpers rather than request state. Same
    harness as test_layout_switch.py."""

    def _saveconfig(self, edits: dict) -> str:
        return u.Handler._saveconfig(self, edits)

    def _seed_refs_into_outputs(self, m, only_empty=True):
        raise AssertionError("not expected: this save never switches manifest")


def _install(man: dict, name: str = "atlas_manifest_aware.json") -> Path:
    p = Path(str(u.MANIFEST_DIR))
    p.mkdir(parents=True, exist_ok=True)
    dest = p / name
    dest.write_text(json.dumps(man, indent=2), encoding="utf-8")
    u.save_config({**u.load_config(), "manifest_path": name})
    return dest


def _saved(dest: Path) -> dict:
    return json.loads(dest.read_text(encoding="utf-8"))


def test_pack_to_grid_to_pack_keeps_the_cell_size() -> None:
    """THE round-trip, driven end to end by what the RENDERED panel would post
    at each step -- never by a hand-written payload, which would prove nothing
    about the markup that ships."""
    m = _scratch("pack")
    m["atlas"].pop("cell_width")
    m["atlas"].pop("cell_height")
    dest = _install(m)

    # Step 1: the author picks Grid and fills the cell size the toggle just
    # revealed (the page size is editable again, so they set that too).
    post = cfg_data(_saved(dest))
    post.update(atlas_layout="grid", atlas_width="1024", atlas_height="1024",
                atlas_cell_width="256", atlas_cell_height="256")
    FakeHandler()._saveconfig(post)
    a = _saved(dest)["atlas"]
    check("grid, with the page and cell the author typed",
          (a["layout"], a["width"], a["height"], a["cell_width"],
           a["cell_height"]), ("grid", 1024, 1024, 256, 256))

    # Step 2: they change their mind and go back to Pack. The cell rows are
    # about to be hidden -- the panel still posts them.
    post = cfg_data(_saved(dest))
    check("the panel would post the cell size it is showing",
          (post.get("atlas_cell_width"), post.get("atlas_cell_height")),
          ("256", "256"))
    post["atlas_layout"] = "pack"
    FakeHandler()._saveconfig(post)
    a = _saved(dest)["atlas"]
    check("back on pack", a["layout"], "pack")
    check("...and the cell size the author set is STILL on disk",
          (a.get("cell_width"), a.get("cell_height")), (256, 256))
    check("...and so is the trim choice", a.get("pack_trim"), "keep")

    # Step 3: an ordinary Save from the pack panel, where both cell rows are
    # hidden. This is the save that used to be able to wipe them.
    check("the cell rows really are hidden now",
          hidden_keys(_saved(dest)), ["atlas_cell_width", "atlas_cell_height"])
    FakeHandler()._saveconfig(cfg_data(_saved(dest)))
    a = _saved(dest)["atlas"]
    check("saving a pack panel does not wipe the hidden cell size",
          (a.get("cell_width"), a.get("cell_height")), (256, 256))
    check("...nor the hidden trim choice", a.get("pack_trim"), "keep")
    check("...nor the page size it shows read-only",
          (a["width"], a["height"]), (1024, 1024))

    # And back to Grid one more time: the value is there to be edited again.
    post = cfg_data(_saved(dest))
    post["atlas_layout"] = "grid"
    FakeHandler()._saveconfig(post)
    check("the cell size survived the whole round trip",
          (_saved(dest)["atlas"].get("cell_width"),
           _saved(dest)["atlas"].get("cell_height")), (256, 256))


def test_a_hidden_row_that_was_never_set_stays_unset() -> None:
    """The other half of the safety net: `_ATLAS_GEOM_KEYS` SKIPS a blank value
    ('never wipe required atlas geometry'). A pack atlas that never had a cell
    size posts "" for those two hidden rows -- which must write nothing, not a
    zero."""
    m = _scratch("pack")
    m["atlas"].pop("cell_width")
    m["atlas"].pop("cell_height")
    dest = _install(m, name="atlas_manifest_aware_blank.json")
    post = cfg_data(_saved(dest))
    check("the hidden rows post a blank, having nothing to post",
          (post.get("atlas_cell_width"), post.get("atlas_cell_height")),
          ("", ""))
    FakeHandler()._saveconfig(post)
    a = _saved(dest)["atlas"]
    check("no cell_width was invented", "cell_width" in a, False)
    check("no cell_height was invented", "cell_height" in a, False)
    check("and the page size is untouched", (a["width"], a["height"]),
          (1028, 25652))


def test_the_read_only_page_size_still_reaches_the_manifest() -> None:
    """Readonly, not disabled: the value posts, so a pack save re-writes the
    same numbers rather than dropping them and hitting the blank-skip."""
    dest = _install(_scratch("pack"), name="atlas_manifest_aware_ro.json")
    FakeHandler()._saveconfig(cfg_data(_saved(dest)))
    a = _saved(dest)["atlas"]
    check("the page size round-trips through a read-only box",
          (a["width"], a["height"]), (1028, 25652))


# --------------------------------------------------------------------------
# 5. THE WIRING. The markup and the script have to be talking about each other.
# --------------------------------------------------------------------------
def _page_js() -> str:
    return "\n".join(pjs.scripts_of(pjs.render_page()))


def run_node(js: str) -> str | None:
    """Run a snippet and return its stdout, or None if node rejected it."""
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False,
                                     encoding="utf-8") as fh:
        fh.write(js)
        tmp = fh.name
    try:
        r = subprocess.run([pjs.NODE or "node", tmp], capture_output=True,
                           text=True)
        if r.returncode != 0:
            _say("       " + r.stderr.strip()[:400])
            return None
        return r.stdout.strip()
    finally:
        Path(tmp).unlink(missing_ok=True)


def test_the_layout_select_drives_the_rows() -> None:
    js = _page_js()
    check("the toggle exists", "function applyAtlasLayout(" in js, True)
    check("it is bound to the Layout dropdown's change event",
          "al.addEventListener('change',applyAtlasLayout)" in js, True)
    check("...reading the same control the panel renders",
          "document.querySelector('[data-cfg=\"atlas_layout\"]')" in js, True)
    check("...and it runs once on load, so the first paint is right too",
          "applyAtlasLayout();" in js, True)
    # Selector <-> attribute. Either half alone is a no-op that still "passes".
    check("the script queries the row attribute",
          "'.cfggrid [data-layout]'" in js, True)
    check("...and the panel emits it",
          'data-layout="grid"' in "".join(rows(_scratch("pack"))), True)
    check("the script queries the lock attribute",
          "'.cfggrid [data-ro-layout]'" in js, True)
    check("...and the panel emits it",
          'data-ro-layout="pack"' in "".join(rows(_scratch("grid"))), True)
    check("the script toggles the inline note",
          ".rohint" in js, True)
    check("...and the panel emits that too",
          'class="rohint"' in "".join(rows(_scratch("pack"))), True)
    # The rows have to land inside the container the selector is rooted at.
    check("the atlas rows are rendered inside a .cfggrid",
          '<div class="cfggrid">{atlas_fields}</div>' in u.PAGE, True)
    check("it flips readOnly, never disabled", "i.readOnly=ro" in js, True)
    body = js.split("function applyAtlasLayout(")[1].split("\n}")[0]
    check("...and the toggle never touches .disabled (which drops the POST)",
          ".disabled" in body, False)


def test_the_panel_renders_through_the_shared_helper() -> None:
    """The gate + the layout-awareness both live in `atlas_geom_rows_html`; a
    handler that went back to building rows inline would bypass them."""
    src = Path(u.__file__).read_text(encoding="utf-8")
    check("the handler calls the helper",
          "atlas_fields.extend(atlas_geom_rows_html(m, cfg, model_cache))"
          in src, True)
    check("...and the helper still walks the FILTERED field list",
          "for ui_key, label, typ, mk in atlas_geom_fields_for(m):" in src,
          True)
    check("...and nothing walks the raw list", "in ATLAS_GEOM_FIELDS:" in src,
          False)


def test_the_server_and_the_browser_agree_on_what_shows() -> None:
    """The server paints the first state and the browser repaints every state
    after it. If `layout_row_visible` and `layoutVisible` disagree, the panel
    changes shape the moment JS runs -- silently, and only in a browser."""
    js = _page_js()
    fn = [ln for ln in js.split("\n")
          if ln.startswith("function layoutVisible(")]
    check("the browser rule is the one-liner this reads", len(fn), 1)
    if not fn:
        return
    cases = [(g, L) for g in ("", "both", "pack", "grid")
             for L in ("pack", "grid")]
    driver = (fn[0] + "\nconst out=" + json.dumps(cases)
              + ".map(c=>layoutVisible(c[0],c[1]));"
              + "console.log(JSON.stringify(out));")
    got = run_node(driver)
    check("the browser rule evaluates", got is not None, True)
    if got is not None:
        check("every (group, layout) pair agrees with the server",
              json.loads(got),
              [u.layout_row_visible(g, L) for g, L in cases])


# The smallest DOM `applyAtlasLayout` can run against: one object per rendered
# row, each answering only the three calls the toggle makes. Everything it is
# fed comes from the real markup — see the test below.
_SHIM = """
const rows=R.map(r=>{
 const inp=(r.readonly===null)?null:{readOnly:r.readonly};
 const hint=(r.hint===null)?null:{style:{display:r.hint}};
 return {k:r.key, inp:inp, hint:hint, style:{display:r.display},
  getAttribute(n){ return n==='data-layout'?(r.group||null)
                        :n==='data-ro-layout'?(r.ro||null):null; },
  querySelectorAll(s){ return (s==='input'&&inp)?[inp]:[]; },
  querySelector(s){ return (s==='.rohint')?hint:null; }};
});
globalThis.document={
 querySelector(s){ return s==='[data-cfg="atlas_layout"]'?{value:WANT}:null; },
 querySelectorAll(s){
  if(s==='.cfggrid [data-layout]')
   return rows.filter(x=>x.getAttribute('data-layout'));
  if(s==='.cfggrid [data-ro-layout]')
   return rows.filter(x=>x.getAttribute('data-ro-layout'));
  return [];
 }};
applyAtlasLayout();
console.log(JSON.stringify(rows.map(x=>({key:x.k, display:x.style.display,
 readonly:x.inp?x.inp.readOnly:null, hint:x.hint?x.hint.style.display:null}))));
"""


def row_state(row: str) -> dict:
    """The three things the toggle is allowed to change, read off a row."""
    hint = re.search(r'<span class="rohint"([^>]*)>', row)
    return {
        "key": key_of(row),
        "display": "none" if is_hidden(row) else "",
        "readonly": is_readonly(row) if "<input" in row else None,
        "hint": (None if not hint
                 else ("none" if "display:none" in hint.group(1) else "")),
    }


def test_choosing_a_layout_repaints_the_panel_without_a_save() -> None:
    """THE ask, executed. Take the panel the server renders for a `pack` atlas,
    run the page's OWN applyAtlasLayout over it with the dropdown set to `grid`,
    and require the result to be exactly the panel the server would have
    rendered for a `grid` atlas. That is what 'reacts to the dropdown
    immediately, client-side, before any save' means, and nothing short of
    running the script proves it.

    The DOM here is a shim, but everything it is fed is real: the three
    functions come verbatim out of the rendered page, and every row's starting
    state is read off the markup `atlas_geom_rows_html` actually emits."""
    js = _page_js()
    start = js.find("function layoutVisible(")
    at = js.find("function applyAtlasLayout(", start)
    check("the toggle and its rule are both in the page", start >= 0 and at > 0,
          True)
    if start < 0 or at < 0:
        return
    shipped = js[start:js.index("\n}", at) + 2]

    for frm, to in (("pack", "grid"), ("grid", "pack")):
        before = []
        for r in rows(_scratch(frm)):
            ro = re.search(r'data-ro-layout="([a-z]+)"', r)
            before.append({**row_state(r), "group": group_of(r),
                           "ro": ro.group(1) if ro else ""})
        want = [row_state(r) for r in rows(_scratch(to))]
        driver = (shipped + f'\nconst WANT="{to}";\nconst R='
                  + json.dumps(before) + ";\n" + _SHIM)
        got = run_node(driver)
        check(f"{frm} -> {to}: the toggle runs", got is not None, True)
        if got is None:
            continue
        check(f"{frm} -> {to}: the panel becomes the one the server would send",
              json.loads(got), want)
        check(f"{frm} -> {to}: and no row was removed on the way",
              [r["key"] for r in json.loads(got)],
              [f[0] for f in u.ATLAS_GEOM_FIELDS])


def test_the_page_script_still_parses() -> None:
    """`node --check` on the real rendered page -- the template was edited."""
    blocks = pjs.scripts_of(pjs.render_page())
    check("the page has inline script to check", bool(blocks), True)
    for i, body in enumerate(blocks):
        ok, err = pjs.node_check(body)
        if not ok:
            _say("       " + "\n       ".join(err.split("\n")[:10]))
        check(f"PAGE <script> {i} parses ({len(body)} chars)", ok, True)


# --------------------------------------------------------------------------
# 6. The help text has to describe the field the author can now actually see.
# --------------------------------------------------------------------------
def test_the_help_matches_what_each_field_now_does() -> None:
    w = u.help_for("atlas_width", {})
    check_true("Atlas width says grid reads it as-is",
               "never overwritten" in w)
    check_true("...and that pack shows it read-only", "read-only" in w)
    check_true("...and that the packer is what writes it",
               "Create Atlas measures your art" in w)
    cw = u.help_for("atlas_cell_width", {})
    check_true("Default cell width says it IS the grid",
               "the grid IS this size" in cw)
    check_true("...and that pack hides it because nothing reads it",
               "Hidden under Layout = Pack the art" in cw and
               "nothing reads it" in cw)
    check_true("...and still covers the legacy cell-grid fallback",
               "legacy cell-grid manifest" in cw)
    tr = u.help_for("atlas_pack_trim", {})
    check_true("Frame trim says what it does",
               "cuts the transparent edges" in tr)
    check_true("...and that it applies to both layouts",
               "Works under BOTH layouts" in tr)
    check_true("...and which way round the default is",
               "Keep the whole frame (the default)" in tr)
    check_true("...and what each choice costs, under each layout",
               "smallest page" in tr and "jumps between frames" in tr)
    check("...and it no longer claims grid ignores it",
          "hidden under Grid of cells" in tr, False)
    lay0 = u.help_for("atlas_layout", {})
    check("Layout no longer says Frame trim disappears",
          "Frame trim disappears" in lay0, False)
    check_true("...it says the opposite", "Frame trim stays on screen" in lay0)
    lay = u.help_for("atlas_layout", {})
    check_true("Layout promises the panel follows the dropdown",
               "hidden or locked" in lay)
    check_true("...immediately", "the moment you change it" in lay)
    check_true("...so no box can take a number and discard it",
               "quietly discard it" in lay)
    for k in ("atlas_width", "atlas_height", "atlas_cell_width",
              "atlas_cell_height", "atlas_pack_trim", "atlas_layout"):
        # SETTING_HELP goes through `.format()`; a stray brace would raise on
        # every settings render.
        check(f"{k}: the tip renders at all", bool(u.help_for(k, {})), True)


if __name__ == "__main__":
    # R2 is not reachable offline and every save mirrors write-through; stand in
    # for the bucket so nothing here waits on a socket. Staging is a real temp
    # tree, which is what the fixtures read back.
    storage.push_file = lambda p, key, **kw: True       # type: ignore[assignment]
    storage.put = lambda key, data, **kw: None          # type: ignore[assignment]

    tests = [test_the_table_is_the_measured_one,
             test_the_split_is_still_true_of_the_code,
             test_frame_trim_is_offered_under_every_layout,
             test_pack_hides_the_cell_size_and_locks_the_page_size,
             test_grid_shows_the_trim_and_hands_the_page_size_back,
             test_the_rows_and_the_dropdown_read_the_same_stored_value,
             test_no_row_is_ever_dropped_from_the_markup,
             test_a_hidden_row_still_carries_its_stored_value,
             test_locked_means_readonly_and_never_disabled,
             test_the_bound_panel_is_the_one_main_rendered,
             test_the_bound_panel_is_blind_to_a_layout_that_is_not_its_own,
             test_pack_to_grid_to_pack_keeps_the_cell_size,
             test_a_hidden_row_that_was_never_set_stays_unset,
             test_the_read_only_page_size_still_reaches_the_manifest,
             test_the_panel_renders_through_the_shared_helper,
             test_the_help_matches_what_each_field_now_does]
    if pjs.NODE:
        tests += [test_the_layout_select_drives_the_rows,
                  test_the_server_and_the_browser_agree_on_what_shows,
                  test_choosing_a_layout_repaints_the_panel_without_a_save,
                  test_the_page_script_still_parses]
    else:
        # Loud, not quiet -- same rule as test_page_js.py: the wiring between
        # the dropdown and the rows lives in JavaScript, and a suite that
        # reports success without ever parsing it has checked half the change.
        FAILED.append("node missing (the JS wiring checks could NOT run)")

    for fn in tests:
        print(f"\n-- {fn.__name__}")
        fn()

    if not pjs.NODE:
        _say("\nFAIL node is not on PATH -- the JS wiring checks did NOT run")
    print(f"\n{len(PASSED)} passed, {len(FAILED)} failed")
    sys.exit(1 if FAILED else 0)
