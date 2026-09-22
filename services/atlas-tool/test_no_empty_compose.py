"""Offline guard: Create Atlas never composes an EMPTY page over a good one
(no R2, no GPU, no ComfyUI).

Run:  PYTHONPATH="../_shared;." py test_no_empty_compose.py   (from services/atlas-tool)

WHAT HAPPENED. "my atlas is always empty now". `atlas_manifest_s_sailortestidle`
is `layout: "grid"` with NO `cell_width`/`cell_height` and 25 regions carrying no
rect at all. The chain, every link of it working as designed:

  1. `grid_layout` refuses -- it will not invent a cell size, because the cell IS
     the layout -- and returns its note with `changed=False`;
  2. that note was appended to `pre_note`, a LOG PREAMBLE;
  3. compose ran anyway;
  4. `batch_atlas`'s compose skips every region with no rect on a from-scratch
     atlas, so ZERO regions were drawn;
  5. the result is a blank `atlas.width` x `atlas.height` page, and
     `publish_pack_page` then repoints `atlas.source_image_path` at it.

A correct refusal upstream destroyed the page downstream. Same hole on `pack`:
"nothing generated yet" is also a refusal, and compose still blanked the page.

THE RULE UNDER TEST. A FROM-SCRATCH atlas (`pack`/`grid`) with not one complete
rect does not compose at all -- no subprocess, no post-hook, no page pointer
moved -- and the layout note is reported as the RESULT of the run. It fires on
ZERO, never on "some": a half-laid-out atlas is the normal working state. And it
never fires on a `.atlas`-bound / authored-geometry manifest, where a missing
rect is a placement (region_box's full-page fallback), not an absence.

ASCII only in the labels: a non-Latin-1 glyph aborts the suite on this box's
cp1252 console.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import sys
import tempfile
from pathlib import Path

from PIL import Image

# Sandbox staging BEFORE importing the tool: ATLAS_DIR / BATCH_DIR / MANIFEST_DIR
# all resolve out of it at import time.
_STAGING = tempfile.mkdtemp(prefix="no-empty-compose-")
os.environ["ATLAS_STAGING"] = _STAGING

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


class FakeR2:
    """Every write the tool makes lands here keyed exactly as R2 would key it."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def push_file(self, local_path, key) -> bool:
        self.objects[str(key)] = Path(local_path).read_bytes()
        return True

    def put(self, key, body, content_type=None, **kw) -> None:
        self.objects[str(key)] = body

    def delete(self, key) -> None:
        self.objects.pop(str(key), None)

    def push_dir(self, src_root, key_root) -> int:
        return 0

    def get(self, key):
        return self.objects.get(str(key))

    def list_keys(self, prefix):
        return [{"key": k} for k in self.objects if k.startswith(str(prefix))]


# --------------------------------------------------------------------------
# Fixtures
# --------------------------------------------------------------------------
def _clear_staging() -> None:
    """One staging tree for the whole suite: a variant or a composed page left
    by an earlier case would answer a later case's question for it."""
    for sub in ("batch", "atlas"):
        d = Path(_STAGING) / "unassigned" / "cloud" / sub
        if d.exists():
            for p in d.iterdir():
                if p.is_file():
                    p.unlink()


def _write(stem: str, atlas: dict, regions: list[dict]) -> Path:
    man_dir = Path(u.MANIFEST_DIR)
    man_dir.mkdir(parents=True, exist_ok=True)
    Path(u.BATCH_DIR).mkdir(parents=True, exist_ok=True)
    Path(u.ATLAS_DIR).mkdir(parents=True, exist_ok=True)
    mp = man_dir / f"atlas_manifest_{stem}.json"
    mp.write_text(json.dumps({"atlas": atlas, "style": {}, "regions": regions},
                             indent=2), encoding="utf-8")
    return mp


def _generate(name: str, w: int = 64, h: int = 64) -> None:
    """Commit a variant for `name` -- what "this region has been generated"
    means to `auto_pack_layout` (it measures the alpha-trimmed art)."""
    im = Image.new("RGBA", (w + 20, h + 20), (0, 0, 0, 0))
    im.paste(Image.new("RGBA", (w, h), (200, 30, 30, 255)), (10, 10))
    im.save(Path(u.BATCH_DIR) / f"{name}_00001_.png")


def _install(bucket: FakeR2, mp: Path, *, compose=None):
    """Point the tool at `mp` + the fake bucket and STAND IN FOR THE COMPOSE
    SUBPROCESS, so every case can assert on whether it was launched at all."""
    u.storage = bucket
    u.creative_manifest_path = lambda: mp                         # noqa: E731
    u.project_paths.ensure_lazy = lambda sub: None                # noqa: E731
    u.rebuild_fx_layers_at = lambda p, base_names=None: ([], [])  # noqa: E731

    def fake_run_cmd(cmd, total, post_hook=None, pre_note=None, **kw):
        fake_run_cmd.launches.append(list(cmd))
        fake_run_cmd.pre_note = pre_note
        stem = Path(cmd[cmd.index("--manifest") + 1]).stem.replace(
            "atlas_manifest_", "")
        if compose is not None:
            compose(mp, stem)
        # The real _run_cmd runs the hook after the subprocess exits.
        fake_run_cmd.note = post_hook() if post_hook else None

    fake_run_cmd.launches = []
    fake_run_cmd.note = None
    fake_run_cmd.pre_note = None
    u._run_cmd = fake_run_cmd
    # The panel reads the run's result out of _render_state; start each case
    # from a clean one so a stale log can never answer for this run.
    with u._render_lock:
        u._render_state.update(running=False, done=False, log="", cur=0,
                               total=0, diagnostics=[])
    return fake_run_cmd


def _compose_the_declared_page(mp: Path, stem: str) -> None:
    """What `batch_atlas --compose-only` does, reduced to what matters here: a
    page exactly the size the manifest declares, with every rect inked."""
    m = json.loads(mp.read_text(encoding="utf-8"))
    w, h = int(m["atlas"]["width"]), int(m["atlas"]["height"])
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    for r in m.get("regions") or []:
        if all(r.get(k) is not None for k in ("x", "y", "w", "h")):
            canvas.paste(Image.new("RGBA", (int(r["w"]), int(r["h"])),
                                   (200, 30, 30, 255)),
                         (int(r["x"]), int(r["y"])))
    out = Path(u.ATLAS_DIR)
    out.mkdir(parents=True, exist_ok=True)
    canvas.save(out / f"{stem}_new.png")
    canvas.save(out / f"{stem}_new.webp", "WEBP", quality=95)


def _read(mp: Path) -> dict:
    return json.loads(mp.read_text(encoding="utf-8"))


def _log() -> str:
    with u._render_lock:
        return str(u._render_state["log"])


def _rects(m: dict) -> int:
    return sum(1 for r in m.get("regions") or []
               if all(r.get(k) is not None for k in ("x", "y", "w", "h")))


def _digest(blob: bytes) -> str:
    return hashlib.sha256(blob).hexdigest()[:12]


def _page(blob: bytes) -> tuple:
    """A page, described in the two terms this whole change is about: how big it
    is, and whether there is anything ON it. Printed instead of the bytes when a
    check fails -- "(2000, 2000), ink=False" is the bug in one line."""
    with Image.open(io.BytesIO(blob)) as im:
        rgba = im.convert("RGBA")
        return rgba.size, rgba.getchannel("A").getbbox() is not None, _digest(blob)


# The owner's atlas, to the field: grid, no cell size, 25 un-rected regions,
# already pointing at a page it composed on a previous (working) run.
_OWNER_PAGE = "unassigned/cloud/atlas/s_sailortestidle_new.webp"


def _owners_manifest(bucket: FakeR2, **atlas_extra) -> Path:
    atlas = {"layout": "grid", "width": 2000, "height": 2000,
             "source_image": "s_sailortestidle_new.webp",
             "source_image_path": _OWNER_PAGE}
    atlas.update(atlas_extra)
    mp = _write("s_sailortestidle", atlas,
                [{"name": f"clip_{i:04d}"} for i in range(25)])
    # The good page that is already in the bucket -- the thing that was being
    # destroyed. Recognisable bytes, so "untouched" is measurable.
    good = Image.new("RGBA", (2000, 2000), (12, 200, 90, 255))
    tmp = Path(u.ATLAS_DIR) / "_owner_good_page.webp"
    tmp.parent.mkdir(parents=True, exist_ok=True)
    good.save(tmp, "WEBP", quality=95)
    bucket.objects[_OWNER_PAGE] = tmp.read_bytes()
    tmp.unlink()
    return mp


# --------------------------------------------------------------------------
# 1. The owner's atlas: grid, no cell size, nothing placed.
# --------------------------------------------------------------------------
def test_the_owners_grid_atlas_does_not_compose_and_keeps_its_page() -> None:
    _clear_staging()
    bucket = FakeR2()
    mp = _owners_manifest(bucket)
    before_bytes = mp.read_bytes()
    before_page = bucket.objects[_OWNER_PAGE]
    run = _install(bucket, mp, compose=_compose_the_declared_page)

    m0 = _read(mp)
    check("the fixture is the owner's shape: grid, no cell size",
          (m0["atlas"]["layout"], "cell_width" in m0["atlas"],
           "cell_height" in m0["atlas"]), ("grid", False, False))
    check("...with 0 of its 25 regions carrying a rect",
          (_rects(m0), len(m0["regions"])), (0, 25))

    u.run_compose()

    check("THE COMPOSE SUBPROCESS IS NEVER LAUNCHED", run.launches, [])
    check("...so the post-hook never ran either", run.note, None)
    check("the page pointer is untouched",
          _read(mp)["atlas"]["source_image_path"], _OWNER_PAGE)
    check("...and so is source_image", _read(mp)["atlas"]["source_image"],
          "s_sailortestidle_new.webp")
    check("the good page in the bucket is still the good page -- size, ink "
          "and all (this is the byte that was being destroyed)",
          _page(bucket.objects[_OWNER_PAGE]), _page(before_page))
    check("no blank page was pushed under atlas/ at all",
          sorted(k for k in bucket.objects if "/atlas/" in k), [_OWNER_PAGE])
    check("the manifest file itself is untouched (a refusal saves nothing new)",
          _digest(mp.read_bytes()), _digest(before_bytes))

    log = _log()
    check("the run REPORTS the refusal (not a blank page under a preamble)",
          log.startswith("✖ Create Atlas composed NOTHING"), True)
    check("it says the page you have is still the page you have",
          "still shows the page it showed before" in log, True)
    check("it names the two fields to fill in",
          "Default cell width" in log and "Default cell height" in log, True)
    check("it names where they live", "Atlas settings" in log, True)
    check("it ENDS with the action, so the last thing read is what to do",
          log.rstrip().endswith("because the cell size IS the layout."), True)
    check("the note is grid_layout's own wording, not a third copy of it",
          "Grid layout: nothing was laid out" in log, True)
    check("the panel's poll loop can finish on it",
          (u._render_state["running"], u._render_state["done"]), (False, True))


# --------------------------------------------------------------------------
# 2. The same hole on `pack`: nothing generated yet.
# --------------------------------------------------------------------------
def test_a_pack_atlas_with_nothing_generated_does_not_compose() -> None:
    _clear_staging()
    bucket = FakeR2()
    page = "unassigned/cloud/atlas/Squid_new.webp"
    mp = _write("Squid", {"layout": "pack", "width": 512, "height": 512,
                          "source_image": "Squid_new.webp",
                          "source_image_path": page},
                [{"name": "H1"}, {"name": "L1"}])
    bucket.objects[page] = b"the page that was there"
    run = _install(bucket, mp, compose=_compose_the_declared_page)

    u.run_compose()

    check("no compose subprocess", run.launches, [])
    check("the page pointer is untouched",
          _read(mp)["atlas"]["source_image_path"], page)
    check("the page in the bucket is untouched",
          bucket.objects[page], b"the page that was there")
    log = _log()
    check("the run reports the refusal",
          log.startswith("✖ Create Atlas composed NOTHING"), True)
    check("...in auto_pack_layout's own wording",
          "Auto-pack: nothing generated yet" in log, True)
    check("and it ends with the action",
          log.rstrip().endswith("generate at least one region before Create "
                                "Atlas."), True)


def test_an_atlas_with_no_regions_at_all_does_not_compose() -> None:
    """A brand-new from-scratch atlas. Nothing to draw, nothing to compose --
    and the message must not read as "0 region(s)"."""
    _clear_staging()
    bucket = FakeR2()
    mp = _write("Fresh", {"layout": "pack", "width": 256, "height": 256}, [])
    run = _install(bucket, mp, compose=_compose_the_declared_page)

    u.run_compose()

    check("no compose subprocess", run.launches, [])
    check("the message says it plainly",
          "has no regions at all" in _log(), True)


# --------------------------------------------------------------------------
# 3. THE REGRESSION RISK: a PARTIALLY laid-out atlas must still compose.
#    Regions are generated a few at a time -- some rects and some blanks is the
#    normal working state, and the guard fires on ZERO, never on "some".
# --------------------------------------------------------------------------
def test_a_half_generated_pack_atlas_still_composes() -> None:
    _clear_staging()
    bucket = FakeR2()
    mp = _write("Half", {"layout": "pack",
                         "source_image_path": "unassigned/cloud/sheets/H/H.png"},
                [{"name": "DONE"}, {"name": "TODO"}])
    _generate("DONE", 120, 90)          # one generated, one not: mid-session
    run = _install(bucket, mp, compose=_compose_the_declared_page)

    u.run_compose()

    check("THE COMPOSE SUBPROCESS RUNS", len(run.launches), 1)
    check("...on the manifest the layout step prepared",
          [str(mp) in c for c in run.launches], [True])
    m = _read(mp)
    check("the generated region is placed", _rects(m), 1)
    check("...and the ungenerated one is not",
          [r["name"] for r in m["regions"] if r.get("x") is None], ["TODO"])
    check("the page pointer moved to the page this compose wrote",
          m["atlas"]["source_image_path"], "unassigned/cloud/atlas/Half_new.webp")
    check("...and that key is in the bucket",
          "unassigned/cloud/atlas/Half_new.webp" in bucket.objects, True)
    check("the layout note is still a log preamble on a run that DID compose",
          "Auto-packed 1 region(s)" in str(run.pre_note), True)
    check("nothing was reported as a refusal",
          "composed NOTHING" in _log(), False)


def test_a_grid_atlas_that_refuses_but_keeps_its_rects_still_composes() -> None:
    """A refusal is not the trigger -- an EMPTY page is. This grid overflows its
    page, so `grid_layout` changes nothing and warns; the rects from the last
    good layout are still on the regions, so there is still a page to draw."""
    _clear_staging()
    bucket = FakeR2()
    mp = _write("Overflow", {"layout": "grid", "width": 100, "height": 100,
                             "cell_width": 100, "cell_height": 100,
                             "source_image_path": "unassigned/cloud/atlas/o.webp"},
                [{"name": "A", "x": 0, "y": 0, "w": 100, "h": 100},
                 {"name": "B", "x": 0, "y": 0, "w": 100, "h": 100}])
    run = _install(bucket, mp, compose=_compose_the_declared_page)

    u.run_compose()

    check("the layout DID refuse", "would not fit" in str(run.pre_note), True)
    check("...and compose ran anyway, because there is art to place",
          len(run.launches), 1)
    check("the rects it refused to re-flow are still there", _rects(_read(mp)), 2)


# --------------------------------------------------------------------------
# 4. A manifest this tool does NOT lay out is untouched by the guard. There a
#    missing rect is a PLACEMENT (region_box falls back to the cell, then to the
#    whole page), not an absence -- one full-page image is authored that way.
# --------------------------------------------------------------------------
def test_an_atlas_bound_manifest_with_no_rects_still_composes() -> None:
    _clear_staging()
    bucket = FakeR2()
    original = {"atlas_file": "rig.atlas", "width": 512, "height": 512,
                "source_image": "rig.png",
                "source_image_path": "unassigned/cloud/refs/atlas/rig.png"}
    mp = _write("Rig", dict(original), [{"name": "head"}, {"name": "torso"}])
    run = _install(bucket, mp)

    check("the predicate leaves a bound manifest alone",
          u.nothing_is_placed(_read(mp)), False)
    u.run_compose()
    check("it composes exactly as before", len(run.launches), 1)
    check("and its atlas block is byte-for-byte what it was",
          _read(mp)["atlas"], original)


def test_an_authored_geometry_manifest_with_no_rects_still_composes() -> None:
    """No `layout`, no `.atlas`, no rects: the legacy cell grid. region_box
    answers (0, 0, cell) for these on purpose."""
    _clear_staging()
    bucket = FakeR2()
    original = {"width": 1024, "height": 1024, "cell_width": 256,
                "cell_height": 256, "source_image": "S_Lotus.png",
                "source_image_path": "unassigned/cloud/sheets/S_Lotus/S_Lotus.png"}
    mp = _write("S_Lotus", dict(original), [{"name": "H1"}, {"name": "L1"}])
    run = _install(bucket, mp)

    check("the predicate leaves an authored-geometry manifest alone",
          u.nothing_is_placed(_read(mp)), False)
    u.run_compose()
    check("it composes exactly as before", len(run.launches), 1)
    check("nothing was pushed under atlas/ (its page is not ours to move)",
          [k for k in bucket.objects if "/atlas/" in k], [])
    check("and its atlas block is byte-for-byte what it was",
          _read(mp)["atlas"], original)


# --------------------------------------------------------------------------
# 5. The guard is about COMPOSE, not about the manifest write.
# --------------------------------------------------------------------------
def test_a_layout_pass_that_cleared_and_saved_still_saved() -> None:
    """Clearing geometry the new layout does not own is deliberate (see
    `_strip_pack_geometry`), and the save that records it belongs to the layout
    step. The guard runs AFTER that save and only decides whether to compose --
    so a cleared manifest stays cleared, and the page it would have blanked
    stays put. Driven through a stand-in layout pass, because no shipped one
    both clears every rect and reports `changed`."""
    _clear_staging()
    bucket = FakeR2()
    page = "unassigned/cloud/atlas/Cleared_new.webp"
    mp = _write("Cleared", {"layout": "grid", "width": 500, "height": 500,
                            "source_image": "Cleared_new.webp",
                            "source_image_path": page},
                [{"name": "A", "x": 0, "y": 0, "w": 100, "h": 100}])
    bucket.objects[page] = b"the page that was there"
    run = _install(bucket, mp, compose=_compose_the_declared_page)
    real = u.grid_layout

    def clears_every_rect_and_says_so(m: dict):
        for r in m["regions"]:
            for k in ("x", "y", "w", "h"):
                r.pop(k, None)
        return "Grid layout: cleared the rects of the layout you left.", True

    u.grid_layout = clears_every_rect_and_says_so
    try:
        u.run_compose()
    finally:
        u.grid_layout = real

    check("the clear reached the manifest on disk", _rects(_read(mp)), 0)
    check("...and the compose was refused all the same", run.launches, [])
    check("...with the page pointer, and the page, untouched",
          (_read(mp)["atlas"]["source_image_path"], bucket.objects[page]),
          (page, b"the page that was there"))
    check("the layout pass's own note is what the run reports",
          "cleared the rects of the layout you left" in _log(), True)


def test_the_refusal_cannot_be_missed_by_a_poll_that_arrives_early() -> None:
    """The panel's poll loop ends the moment /progress says `running: false`,
    and a refusal's only trace is that log. So the run must be flagged running
    BEFORE the slow steps (hydrate, FX rebuild, layout) rather than when the
    subprocess starts -- otherwise the first poll reads the PREVIOUS run's log
    and stops, and the owner sees nothing at all."""
    _clear_staging()
    bucket = FakeR2()
    mp = _owners_manifest(bucket)
    _install(bucket, mp, compose=_compose_the_declared_page)
    seen: dict = {}

    def poll_from_the_browser(p, base_names=None):
        """A /progress hit landing deep in the prepare phase."""
        with u._render_lock:
            seen["running"] = u._render_state["running"]
        return ([], [])

    u.rebuild_fx_layers_at = poll_from_the_browser
    u.run_compose()

    check("a poll mid-prepare is told the run is still going",
          seen.get("running"), True)
    check("...and when it comes back the refusal is there to read",
          "composed NOTHING" in _log(), True)
    check("...on a run that has finished, so the loop can stop",
          (u._render_state["running"], u._render_state["done"]), (False, True))


# --------------------------------------------------------------------------
# 6. The way out: the fix the message names actually works.
# --------------------------------------------------------------------------
def test_the_owners_atlas_lays_out_and_composes_once_the_cell_size_is_set() -> None:
    _clear_staging()
    bucket = FakeR2()
    # 2000x2000 page, 400x400 cells => a 5x5 grid: exactly the 25 frames.
    mp = _owners_manifest(bucket, cell_width=400, cell_height=400)
    run = _install(bucket, mp, compose=_compose_the_declared_page)

    u.run_compose()

    m = _read(mp)
    check("all 25 regions are laid out", _rects(m), 25)
    check("...in manifest order, through the cells the author typed",
          [(r["x"], r["y"]) for r in m["regions"][:6]],
          [(0, 0), (400, 0), (800, 0), (1200, 0), (1600, 0), (0, 400)])
    check("THE COMPOSE SUBPROCESS RUNS", len(run.launches), 1)
    check("the page pointer names the page this compose wrote",
          m["atlas"]["source_image_path"], _OWNER_PAGE)
    check("...and the bucket has it", _OWNER_PAGE in bucket.objects, True)
    check("nothing was reported as a refusal",
          "composed NOTHING" in _log(), False)

    size, ink, _ = _page(bucket.objects[_OWNER_PAGE])
    check("the published page is the size this atlas laid out",
          size, (m["atlas"]["width"], m["atlas"]["height"]))
    check("...and it is NOT blank (the whole point)", ink, True)


# --------------------------------------------------------------------------
# 6. The predicate, directly.
# --------------------------------------------------------------------------
def test_the_predicate_asks_exactly_the_question_compose_answers() -> None:
    for layout in ("pack", "grid"):
        check(f"{layout}: no rects at all -> nothing is placed",
              u.nothing_is_placed({"atlas": {"layout": layout},
                                   "regions": [{"name": "A"}]}), True)
        check(f"{layout}: one complete rect -> something is placed",
              u.nothing_is_placed({"atlas": {"layout": layout}, "regions": [
                  {"name": "A", "x": 0, "y": 0, "w": 4, "h": 4},
                  {"name": "B"}]}), False)
        check(f"{layout}: a HALF rect is not a rect",
              u.nothing_is_placed({"atlas": {"layout": layout}, "regions": [
                  {"name": "A", "x": 0, "y": 0, "w": 4}]}), True)
        check(f"{layout}: x/y = 0 is a real placement, not a missing one",
              u.nothing_is_placed({"atlas": {"layout": layout}, "regions": [
                  {"name": "A", "x": 0, "y": 0, "w": 1, "h": 1}]}), False)
        check(f"{layout}: rotated_regions count too",
              u.nothing_is_placed({"atlas": {"layout": layout}, "regions": [],
                                   "rotated_regions": [
                  {"name": "A", "x": 1, "y": 1, "w": 4, "h": 4}]}), False)
    check("no layout declared -> never ours to refuse",
          u.nothing_is_placed({"atlas": {}, "regions": [{"name": "A"}]}), False)
    check("a bound .atlas -> never ours to refuse",
          u.nothing_is_placed({"atlas": {"atlas_file": "r.atlas"},
                               "regions": [{"name": "A"}]}), False)


if __name__ == "__main__":
    for fn in (test_the_owners_grid_atlas_does_not_compose_and_keeps_its_page,
               test_a_pack_atlas_with_nothing_generated_does_not_compose,
               test_an_atlas_with_no_regions_at_all_does_not_compose,
               test_a_half_generated_pack_atlas_still_composes,
               test_a_grid_atlas_that_refuses_but_keeps_its_rects_still_composes,
               test_an_atlas_bound_manifest_with_no_rects_still_composes,
               test_an_authored_geometry_manifest_with_no_rects_still_composes,
               test_a_layout_pass_that_cleared_and_saved_still_saved,
               test_the_refusal_cannot_be_missed_by_a_poll_that_arrives_early,
               test_the_owners_atlas_lays_out_and_composes_once_the_cell_size_is_set,
               test_the_predicate_asks_exactly_the_question_compose_answers):
        _say(f"\n-- {fn.__name__}")
        fn()
    _say(f"\n{len(PASSED)} passed, {len(FAILED)} failed")
    if FAILED:
        for f in FAILED:
            _say(f"  FAILED: {f}")
    sys.exit(1 if FAILED else 0)
