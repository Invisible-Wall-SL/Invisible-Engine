"""Offline guard: a picked variant is the one that gets composed (no R2, no ComfyUI).

Run:  PYTHONPATH=".;../_shared" py test_variant_pick.py   (from services/atlas-tool)

Reported as "if I change my variation my changes do not get saved, and the atlas
is generated with the old variation". Three things had grown into one field:

  1. `selectVariant()` only set `dataset.variant` on the card and waited for the
     next `saveAll()` -- it never committed the pick itself.
  2. `Handler._save` then stored that id ONLY inside `if e["lock"] and (...)`.
     An unlocked pick -- the ordinary case, since nothing in the UI says you
     must lock to keep a pick -- was dropped on every save.
  3. So `_pick_variant_png` found no `variant` in the manifest and fell through
     to "the most recent file", while the CARD went on showing the pick. Create
     Atlas composed art the page was not displaying, with nothing to see why.

The knot: `variant` was doing double duty as the GPT lock key (gpt_image has no
embedded seed, so a stored pick was the only way to say "locked"). Untying it
needs an explicit `lock` flag, or every saved pick would read back as a lock and
silently stop its slot from ever rendering again.

The contract these assertions pin:
  * a pick survives a save whether or not the slot is locked, and compose uses
    exactly it;
  * a pick is NOT a lock -- an unlocked picked slot still re-renders;
  * a lock IS still a lock, including a seedless GPT slot pinned by its pick,
    and including legacy manifests written before the flag existed;
  * a render that produces new art supersedes an UNLOCKED pick (the card shows
    the new file, so the atlas must too) -- but a stopped or failed render, and
    a locked slot, lose nothing;
  * the card's output figure and its seed caption name the PICKED file.

Later, that last rule turned out to be pinned only where it was CHEAP to pin.
It was implemented as a post-render cleanup against an in-memory snapshot of
each slot's newest id, so "the card shows the fresh render" held only while the
post-hook ran to completion, the browser's poll loop reached its refresh, and no
blanket saveAll() posted the card's stale id back in between. Measured on the
owner's live bucket on 2026-09-17: three unlocked pins in the two atlases they
were working in still named art four generations old, so those cards -- and the
atlas Create Atlas composed from them -- showed a file the owner had re-rendered
past three times. The pick's generation is now STORED (`variant_at`), so the
same question is answered from the manifest alone:

  * a pick is spent by any file newer than the pile it was picked from, with no
    cleanup, no snapshot and no browser involved;
  * re-posting a spent pick (which every save does) does NOT revive it;
  * a legacy pin, written before the field existed, dates itself to its own id.

ASCII only in the labels: a non-Latin-1 glyph raises UnicodeEncodeError on this
box's cp1252 console and aborts the whole suite.
"""
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

from PIL import Image, PngImagePlugin

import batch_atlas as ba
import ui_server as u

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


# --------------------------------------------------------------------------
# Fixtures: a real manifest on disk and a real pile of seeded variant PNGs.
# --------------------------------------------------------------------------
def _variant_png(path: Path, seed: int | None) -> None:
    """A 1x1 PNG carrying the same ComfyUI `prompt` chunk a real render
    embeds, so seed_of / _seed_in_png read it exactly as they would in prod.
    seed=None writes no metadata at all -- a gpt_image output."""
    info = PngImagePlugin.PngInfo()
    if seed is not None:
        info.add_text("prompt", json.dumps(
            {"3": {"class_type": "KSampler", "inputs": {"seed": seed}}}))
    Image.new("RGBA", (1, 1)).save(path, pnginfo=info)


def _pile(seeds: list[int | None], name: str = "H1") -> Path:
    batch = Path(tempfile.mkdtemp()) / "batch"
    batch.mkdir(parents=True)
    for i, s in enumerate(seeds, start=1):
        _variant_png(batch / f"{name}_{i:05d}_.png", s)
    # ui_server reads the pile through variant_files(). Point it here as part
    # of BUILDING the pile: a save stamps the pick's generation from what the
    # server can see, so a fixture whose server sees an empty dir would date
    # every pick to itself and prove nothing.
    u.variant_files = lambda n, _b=batch: sorted(_b.glob(f"{n}_*.png"))  # noqa: E731
    return batch


def _manifest(region: dict) -> tuple[Path, dict]:
    """A staged manifest `_save` can round-trip, with ui_server pointed at it."""
    mp = Path(tempfile.mkdtemp()) / "atlas_manifest_test.json"
    m = {"atlas": {"layout": "pack"}, "style": {}, "regions": [dict(region)]}
    mp.write_text(json.dumps(m), encoding="utf-8")
    u.manifest_path = lambda: mp                                  # noqa: E731
    u._mirror = lambda p: None                                    # noqa: E731
    return mp, m


def _card(**over) -> dict:
    """One card as saveAll()/collect() posts it."""
    e = {"name": "H1", "selected": True, "prompt": "a cherry", "gpt_prompt": "",
         "lock": False, "seed": "", "variant": "",
         "negative": "", "negative_replace": False, "positive_replace": False}
    e.update(over)
    return e


def _saved(card: dict, region: dict | None = None) -> dict:
    mp, _ = _manifest(region or {"name": "H1", "prompt": "a cherry"})
    u.apply_region_edits([card])
    return json.loads(mp.read_text(encoding="utf-8"))["regions"][0]


# --------------------------------------------------------------------------
# 1. The outage: a pick that was never saved, and the atlas that ignored it
# --------------------------------------------------------------------------
def test_an_unlocked_pick_survives_the_save() -> None:
    _pile([11, 22, 33, 44])
    r = _saved(_card(variant="00003"))
    check("the picked file id is persisted", r.get("variant"), "00003")
    check("without inventing a lock", r.get("lock"), False)
    check("stamped with the generation it was picked out of",
          r.get("variant_at"), "00004")


def test_compose_uses_the_picked_file_not_the_newest() -> None:
    batch = _pile([11, 22, 33, 44])
    r = _saved(_card(variant="00003"))
    picked = ba._pick_variant_png(batch, r)
    check("compose takes the pick", picked.name, "H1_00003_.png")
    # The regression it replaces: with no pick, the newest still wins.
    check("with no pick it still falls back to the newest",
          ba._pick_variant_png(batch, _saved(_card())).name, "H1_00004_.png")


def test_a_locked_pick_is_saved_exactly_as_before() -> None:
    r = _saved(_card(variant="00002", lock=True, seed="777"))
    check("the pick is kept", r.get("variant"), "00002")
    check("the locked seed is kept", r.get("seed"), 777)
    check("and the slot reads as locked", ba.region_locked(r), True)


def test_clearing_the_pick_clears_the_field() -> None:
    r = _saved(_card(variant=""),
               region={"name": "H1", "variant": "00009", "variant_at": "00009"})
    check("an empty pick drops the key", "variant" in r, False)
    check("and the generation stamp with it", "variant_at" in r, False)


def test_a_promptless_atlas_bound_region_keeps_its_pick() -> None:
    """The same loss, one level up. An `.atlas`-bound manifest holds only
    creative data, so a region driven by the global prefix/suffix alone has NO
    entry -- yet it still gets a card from the geometry file. The stub gate
    listed prompt / seed+lock / negatives / unselected but not the PICK, so
    clicking a variant on such a region created no entry, saved nothing, and
    said "Saved (0 prompt change(s))"."""
    mp = Path(tempfile.mkdtemp()) / "atlas_manifest_bound.json"
    mp.write_text(json.dumps({"atlas": {"atlas_file": "sheet.atlas"},
                              "style": {}, "regions": []}), encoding="utf-8")
    u.manifest_path = lambda: mp                                  # noqa: E731
    u._mirror = lambda p: None                                    # noqa: E731
    # Stand in for the `.atlas` geometry file the region comes from.
    u.batch_atlas.atlas_file_path = lambda m, path: Path("sheet.atlas")  # noqa: E731
    real_exists = Path.exists
    Path.exists = lambda self: True if self.name == "sheet.atlas" else real_exists(self)
    u.atlas_format.parse_atlas = lambda p: {"regions": [{"name": "H1"}]}  # noqa: E731
    try:
        msg = u.apply_region_edits([_card(prompt="", variant="00003")])
    finally:
        Path.exists = real_exists
    regions = json.loads(mp.read_text(encoding="utf-8"))["regions"]
    check("a stub is created for the pick alone", len(regions), 1)
    check("carrying the pick", regions[0].get("variant"), "00003")
    check("and the message says so, not '0 prompt change(s)'",
          msg, "Saved (0 prompt change(s), 1 variant pick(s))")


def test_a_lock_with_nothing_to_pin_is_not_stored() -> None:
    """Ticking `lock` with an empty seed box and no pick pins nothing. Storing
    it would tick the box on reload right next to the 'lock this pick' button
    updateLock draws, and claim a slot is locked that re-renders every time."""
    r = _saved(_card(lock=True, seed="", variant=""))
    check("an empty lock is not a lock", r.get("lock"), False)
    check("so the card comes back unticked", ba.region_locked(r), False)
    # ...but a lock with something to pin still is one.
    check("a lock on a seed stands",
          ba.region_locked(_saved(_card(lock=True, seed="777"))), True)
    check("a lock on a bare pick stands too (the GPT case)",
          ba.region_locked(_saved(_card(lock=True, variant="00002"))), True)


def test_the_save_says_it_saved_the_pick() -> None:
    """'Saved (0 prompt change(s))' after clicking a variant read as 'nothing
    happened' -- which is what used to happen to it."""
    _manifest({"name": "H1", "prompt": "a cherry"})
    check("a pick is reported",
          u.apply_region_edits([_card(variant="00003")]),
          "Saved (0 prompt change(s), 1 variant pick(s))")
    _manifest({"name": "H1", "prompt": "a cherry", "variant": "00003"})
    check("re-saving the same pick claims nothing",
          u.apply_region_edits([_card(variant="00003")]),
          "Saved (0 prompt change(s))")


def test_deleting_the_picked_file_drops_the_pin() -> None:
    """Variant ids are 'highest existing + 1', so deleting the newest frees its
    id for the next render -- a dangling pin would snap onto unrelated art."""
    batch = _pile([11, 22, 33])
    mp, _ = _manifest({"name": "H1", "variant": "00003", "variant_at": "00003"})
    (batch / "H1_00003_.png").unlink()
    check("the pin is cleared once its file is gone",
          u._drop_dangling_pick("H1"), True)
    r = json.loads(mp.read_text(encoding="utf-8"))["regions"][0]
    check("so the region is back to its latest", "variant" in r, False)
    check("with no orphan generation stamp left behind",
          "variant_at" in r, False)
    check("a pick whose file still exists is left alone",
          u._drop_dangling_pick("H1"), False)


# --------------------------------------------------------------------------
# 2. A pick is not a lock -- the trap the untangling had to avoid
# --------------------------------------------------------------------------
def test_an_unlocked_picked_slot_still_renders() -> None:
    batch = _pile([11, 22, 33])
    r = _saved(_card(variant="00002"))
    check("sdxl: a bare pick does not skip generation",
          ba.already_generated(batch, r), None)
    gpt = _saved(_card(variant="00002"), region={"name": "H1",
                                                 "pipeline": "gpt_image"})
    check("gpt_image: a bare pick does not skip generation either",
          ba.already_generated(batch, gpt), None)


def test_a_locked_slot_still_skips_generation() -> None:
    batch = _pile([11, 22, 33])
    seeded = _saved(_card(lock=True, seed="22"))
    hit = ba.already_generated(batch, seeded)
    check("sdxl: a locked seed pins its file",
          hit.name if hit else None, "H1_00002_.png")
    # gpt_image carries no embedded seed, so the pick IS the lock key.
    gpt_pile = _pile([None, None, None])
    gpt = _saved(_card(lock=True, variant="00002"),
                 region={"name": "H1", "pipeline": "gpt_image"})
    hit = ba.already_generated(gpt_pile, gpt)
    check("gpt_image: a locked pick pins its file -- no second paid call",
          hit.name if hit else None, "H1_00002_.png")


def test_unticking_the_lock_keeps_the_pick() -> None:
    r = _saved(_card(variant="00002", lock=False, seed="777"))
    check("the pick outlives the lock", r.get("variant"), "00002")
    check("but the seed does not", "seed" in r, False)
    check("and the slot renders again", ba.region_locked(r), False)


def test_a_legacy_manifest_still_reads_as_locked() -> None:
    """Written before the flag existed, where a stored seed -- or, for a
    seedless GPT slot, a stored pick -- could ONLY have meant locked."""
    check("legacy seed means locked", ba.region_locked({"name": "H1", "seed": 5}), True)
    check("legacy gpt pick means locked",
          ba.region_locked({"name": "H1", "variant": "00002"}), True)
    check("legacy plain region means unlocked",
          ba.region_locked({"name": "H1"}), False)
    check("an explicit flag always wins over the fallback",
          ba.region_locked({"name": "H1", "seed": 5, "variant": "2", "lock": False}),
          False)


# --------------------------------------------------------------------------
# 3. A re-render supersedes an unlocked pick -- but only a real one
# --------------------------------------------------------------------------
def _render_onto(pile: list[int | None], rendered: list[int | None],
                 name: str = "H1") -> Path:
    """A slot with `pile` already generated, which then renders `rendered`
    more files onto it -- the ids continue, the way ComfyUI's counter does."""
    batch = _pile(pile, name)
    for i, s in enumerate(rendered, start=len(pile) + 1):
        _variant_png(batch / f"{name}_{i:05d}_.png", s)
    return batch


def _after_render(region: dict, pile: list[int | None],
                  rendered: list[int | None]) -> dict:
    """Let the pile grow (or not), then run the cleanup and re-read the pin."""
    _render_onto(pile, rendered)
    m = {"regions": [dict(region)]}
    u._drop_superseded_picks(m)
    return m["regions"][0]


def test_a_fresh_render_supersedes_an_unlocked_pick() -> None:
    r = _after_render({"name": "H1", "variant": "00002", "variant_at": "00002",
                       "lock": False}, [11, 22], [99])
    check("the stale pin is dropped so card and atlas agree",
          "variant" in r, False)
    check("and its generation stamp goes with it", "variant_at" in r, False)


def test_a_fresh_render_leaves_a_locked_pick_alone() -> None:
    r = _after_render({"name": "H1", "variant": "00002", "variant_at": "00002",
                       "lock": True}, [11, 22], [99])
    check("a locked pick is exactly what must survive", r.get("variant"), "00002")


def test_a_render_that_produced_nothing_keeps_the_pick() -> None:
    """Stopped, failed, or skipped: no new file, so nobody loses a pick."""
    r = _after_render({"name": "H1", "variant": "00002", "variant_at": "00002",
                       "lock": False}, [11, 22], [])
    check("the pick survives a render that wrote nothing",
          r.get("variant"), "00002")


def test_a_pick_out_of_several_is_not_its_own_supersession() -> None:
    """Curating is the ordinary case: render 5, keep #3. The two newer files
    were there when it was picked, so they do not supersede anything -- the
    generation stamp, not the id alone, is what says a render has happened."""
    r = _after_render({"name": "H1", "variant": "00003", "variant_at": "00005",
                       "lock": False}, [11, 22, 33, 44, 55], [])
    check("picking the middle of a batch keeps that pick",
          r.get("variant"), "00003")


def test_a_render_of_another_slot_keeps_this_ones_pick() -> None:
    _pile([11, 22])
    m = {"regions": [{"name": "H1", "variant": "00002", "variant_at": "00002",
                      "lock": False}]}
    u._drop_superseded_picks(m)
    check("a slot whose newest has not moved keeps its pick",
          m["regions"][0].get("variant"), "00002")


def test_deleting_the_newest_does_not_spend_a_pick() -> None:
    """Ids are freed by deletion, so the newest can go DOWN. Only art that is
    strictly newer than the pick's generation supersedes it -- a plain `!=`
    would read a deleted file as a fresh render and throw the pick away."""
    batch = _pile([11, 22, 33])
    (batch / "H1_00003_.png").unlink()
    m = {"regions": [{"name": "H1", "variant": "00002", "variant_at": "00003",
                      "lock": False}]}
    u._drop_superseded_picks(m)
    check("losing the newest file leaves the pick alone",
          m["regions"][0].get("variant"), "00002")


# --------------------------------------------------------------------------
# 3b. The rule holds with NO cleanup run at all -- that is the whole point
# --------------------------------------------------------------------------
def test_a_spent_pick_is_ignored_even_if_no_cleanup_ever_runs() -> None:
    """The measured outage. `_drop_superseded_picks` is housekeeping now: the
    card and Create Atlas ask the manifest directly, so a post-render hook that
    crashed, was stopped, or never got to run cannot strand a slot on old art."""
    batch = _render_onto([11, 22], [99])
    region = {"name": "H1", "variant": "00002", "variant_at": "00002",
              "lock": False}                      # untouched by any cleanup
    check("compose moves to the fresh render",
          ba._pick_variant_png(batch, region).name, "H1_00003_.png")
    thumb, _f, _c, us, picked = u.output_view("H1", region)
    check("and so does the card", thumb.startswith("/thumb/H1?t="), True)
    check("captioned with the fresh seed", us, 99)
    check("and it stops advertising the spent pick", picked, "")


def test_a_blanket_save_cannot_revive_a_spent_pick() -> None:
    """saveAll() posts every card's current pick on every save -- a render, a
    Create Atlas, a lock toggle. Re-stamping the generation there would undo
    the supersession each time, which is how a stale pin outlived three
    renders on the owner's live atlas."""
    _render_onto([11, 22], [99])
    r = _saved(_card(variant="00002"),
               region={"name": "H1", "variant": "00002", "variant_at": "00002"})
    check("the unchanged pick is not re-dated", r.get("variant_at"), "00002")
    check("so it stays spent", ba.effective_variant(r, "00003"), "")
    # ...while picking it AGAIN, deliberately, is a new choice and does count.
    r = _saved(_card(variant="00002"),
               region={"name": "H1", "variant": "00001", "variant_at": "00001"})
    check("re-picking it re-dates it", r.get("variant_at"), "00003")
    check("and it is honoured again", ba.effective_variant(r, "00003"), "00002")


def test_a_legacy_pin_dates_itself_to_its_own_id() -> None:
    """Pins written before `variant_at` existed. The newest file we can prove
    was there when it was picked is the picked one, so anything newer is a
    render it has not seen -- which is what repairs the owner's stuck cards."""
    check("a legacy pin with newer art is spent",
          ba.effective_variant({"name": "H1", "variant": "00002",
                                "lock": False}, "00005"), "")
    check("a legacy pin that IS the newest still stands",
          ba.effective_variant({"name": "H1", "variant": "00005",
                                "lock": False}, "00005"), "00005")
    check("a legacy pin with no files at all stands",
          ba.effective_variant({"name": "H1", "variant": "00002",
                                "lock": False}, ""), "00002")


def test_a_non_numeric_id_falls_back_to_plain_inequality() -> None:
    """variant_id() returns the file stem when it carries no counter, so the
    comparison must not explode on one."""
    check("a different non-numeric newest supersedes",
          ba.effective_variant({"name": "H1", "variant": "mine",
                                "lock": False}, "theirs"), "")
    check("the same one does not",
          ba.effective_variant({"name": "H1", "variant": "mine",
                                "lock": False}, "mine"), "mine")


# --------------------------------------------------------------------------
# 4. The card shows the file it composes, and captions the right seed
# --------------------------------------------------------------------------
def test_the_card_shows_the_picked_file() -> None:
    batch = _pile([11, 22, 33])
    thumb, full, cap, us, picked = u.output_view(
        "H1", {"name": "H1", "variant": "00002", "variant_at": "00003"})
    check("the thumb points at the pick", thumb.startswith("/vthumb/H1?id=00002"), True)
    check("so does the full-size link", full.startswith("/vfull/H1?id=00002"), True)
    check("and the caption names the PICKED file's seed, not the newest",
          cap, "output · seed 22")
    check("the seed handed to 'lock this pick' is the pick's own", us, 22)
    check("and the card is told which pick it is showing", picked, "00002")


def test_with_no_pick_the_card_shows_the_newest() -> None:
    batch = _pile([11, 22, 33])
    thumb, _full, _cap, us, _pick = u.output_view("H1", {"name": "H1"})
    check("the thumb is the plain latest-output route",
          thumb.startswith("/thumb/H1?t="), True)
    check("captioned with the newest seed", us, 33)


def test_a_committed_user_image_still_beats_the_pick() -> None:
    """Same priority order as _pick_variant_png: the user's own image wins."""
    batch = _pile([11, 22])
    own = batch / "mine.png"
    _variant_png(own, None)
    thumb, _f, cap, us, _pick = u.output_view(
        "H1", {"name": "H1", "variant": "00002", "output_override": str(own)})
    check("the user image is what is shown",
          thumb.startswith("/outthumb/H1?t="), True)
    check("and it is labelled as unprocessed",
          cap, "★ your image · NOT processed")
    check("with no seed to report", us, None)


if __name__ == "__main__":
    for fn in (test_an_unlocked_pick_survives_the_save,
               test_compose_uses_the_picked_file_not_the_newest,
               test_a_locked_pick_is_saved_exactly_as_before,
               test_clearing_the_pick_clears_the_field,
               test_a_promptless_atlas_bound_region_keeps_its_pick,
               test_a_lock_with_nothing_to_pin_is_not_stored,
               test_the_save_says_it_saved_the_pick,
               test_deleting_the_picked_file_drops_the_pin,
               test_an_unlocked_picked_slot_still_renders,
               test_a_locked_slot_still_skips_generation,
               test_unticking_the_lock_keeps_the_pick,
               test_a_legacy_manifest_still_reads_as_locked,
               test_a_fresh_render_supersedes_an_unlocked_pick,
               test_a_fresh_render_leaves_a_locked_pick_alone,
               test_a_render_that_produced_nothing_keeps_the_pick,
               test_a_pick_out_of_several_is_not_its_own_supersession,
               test_a_render_of_another_slot_keeps_this_ones_pick,
               test_deleting_the_newest_does_not_spend_a_pick,
               test_a_spent_pick_is_ignored_even_if_no_cleanup_ever_runs,
               test_a_blanket_save_cannot_revive_a_spent_pick,
               test_a_legacy_pin_dates_itself_to_its_own_id,
               test_a_non_numeric_id_falls_back_to_plain_inequality,
               test_the_card_shows_the_picked_file,
               test_with_no_pick_the_card_shows_the_newest,
               test_a_committed_user_image_still_beats_the_pick):
        print(f"\n-- {fn.__name__}")
        fn()
    print(f"\n{len(PASSED)} passed, {len(FAILED)} failed")
    sys.exit(1 if FAILED else 0)
