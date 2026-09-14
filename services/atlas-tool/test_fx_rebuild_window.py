"""Offline guard: a save made DURING an FX rebuild is not swallowed by it.

Run:  PYTHONPATH=".;../_shared" py test_fx_rebuild_window.py   (from services/atlas-tool)

THE WINDOW THIS CLOSES. `run_render`'s post-hook and `run_compose` both did:

    m = load_manifest()                 # a snapshot
    rebuilt = rebuild_fx_layers(m, ...) # SECONDS: PIL per layer + an R2 upload
    save_manifest(m)                    # writes that whole stale snapshot back

Everything the user saved in between -- a prompt, a seed, a lock, a variant pick
-- was inside the fields that snapshot carried, so the write put all of them
back the way they were. No error, no log line; the edit simply reappeared as it
had been. It stayed survivable only while saves were rare. Committing a variant
pick on click (2026-09-14) made it frequent, which is what turned a latent race
into a reported one.

The fix is not a bigger lock. Holding `_manifest_lock` across the rebuild would
freeze every save in the UI for as long as the GPU art takes to post-process,
which is its own outage. Instead the slow work still runs on a detached copy,
and only the fields the job OWNS (`output_override`, `mode`, `fx`, `shine`) are
re-applied -- under the lock, onto a manifest re-read at that moment.

The contract these assertions pin:
  * a concurrent save to ANY other field survives the rebuild;
  * the rebuild's own result still lands;
  * a region somebody re-tuned mid-rebuild keeps THEIR build, not the stale one;
  * only the four FX keys are ever written, so the re-apply can never carry a
    neighbouring field back with it;
  * the rebuild itself holds no lock (a save can actually land while it runs).

ASCII only in the labels: a non-Latin-1 glyph aborts the suite on this box's
cp1252 console.
"""
from __future__ import annotations

import json
import sys
import tempfile
import threading
from pathlib import Path

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
# Fixtures: a real manifest on disk, and a build that is SLOW on purpose.
# --------------------------------------------------------------------------
def _manifest() -> Path:
    """A base region with a prompt + pick, and an FX layer derived from it."""
    mp = Path(tempfile.mkdtemp()) / "atlas_manifest_fx.json"
    mp.write_text(json.dumps({
        "atlas": {"layout": "pack"},
        "style": {},
        "regions": [
            {"name": "H1", "prompt": "a cherry", "variant": "00002",
             "lock": False, "seed": 11},
            {"name": "H1_glow", "mode": "glow",
             "fx": {"glow": {"color": "#ff0000", "blur": 4}}},
        ],
    }), encoding="utf-8")
    # Patch the RESOLVER, not manifest_path() itself: manifest_path is what
    # honours the thread-local pin, and replacing it would quietly disable the
    # mechanism these tests exist to check.
    u.creative_manifest_path = lambda: mp                         # noqa: E731
    u._mirror = lambda p: None                                    # noqa: E731
    u.load_config = lambda: {}                                    # noqa: E731
    return mp


def _read(mp: Path) -> dict:
    return json.loads(mp.read_text(encoding="utf-8"))


def _region(mp: Path, name: str) -> dict:
    return next(r for r in _read(mp)["regions"] if r["name"] == name)


def _slow_build(mp: Path, during) -> None:
    """Stand in for build_fx_region: write the same four fields it writes, and
    run `during` while the 'build' is in flight -- that is the window."""
    def fake(m, name, mode=None, payload=None):
        during()
        r = next((x for b in ("regions", "rotated_regions")
                  for x in m.get(b, []) if x.get("name") == name), None)
        if r is None:
            r = {"name": name}
            m.setdefault("regions", []).append(r)
        mode = mode or r.get("mode") or "glow"
        r["output_override"] = f"refs/useroutput_{name}.png"
        r["mode"] = mode
        r.setdefault("fx", {})[mode] = {"color": "#00ff00", "blur": 9}
        r["shine"] = {"color": "#00ff00", "blur": 9}
        return (True, f"{name}: built {mode}")
    u.build_fx_region = fake


def _save_from_another_tab(mp: Path, **fields):
    """What a user pressing Save (or clicking a variant) does to H1 while the
    rebuild is running: a full read-modify-write of its own."""
    def go():
        with u._manifest_lock:
            m = _read(mp)
            for r in m["regions"]:
                if r["name"] == "H1":
                    r.update(fields)
            mp.write_text(json.dumps(m), encoding="utf-8")
    return go


# --------------------------------------------------------------------------
# 1. The outage: the concurrent save came back undone
# --------------------------------------------------------------------------
def test_a_save_during_the_rebuild_survives() -> None:
    mp = _manifest()
    _slow_build(mp, _save_from_another_tab(
        mp, prompt="a plum", variant="00007", seed=99, lock=True))
    rebuilt, skipped = u.rebuild_fx_layers_at(mp, base_names={"H1"})

    check("the FX layer rebuilt", rebuilt, ["H1_glow"])
    check("nothing was skipped", skipped, [])
    h1 = _region(mp, "H1")
    check("the prompt saved mid-rebuild stands", h1.get("prompt"), "a plum")
    check("...and the variant pick", h1.get("variant"), "00007")
    check("...and the seed", h1.get("seed"), 99)
    check("...and the lock", h1.get("lock"), True)


def test_the_rebuilds_own_result_still_lands() -> None:
    mp = _manifest()
    _slow_build(mp, _save_from_another_tab(mp, prompt="a plum"))
    u.rebuild_fx_layers_at(mp, base_names={"H1"})
    glow = _region(mp, "H1_glow")
    check("the built image is bound", glow.get("output_override"),
          "refs/useroutput_H1_glow.png")
    check("with the params it built from", glow["fx"]["glow"],
          {"color": "#00ff00", "blur": 9})


def test_only_the_fx_keys_are_written() -> None:
    """The re-apply must not carry a neighbouring field back with it -- that is
    exactly what the whole-snapshot write did.

    Two things are load-bearing in the setup, and the test is vacuous without
    either. The non-FX field must (a) already EXIST on the rebuilt region, so
    the detached copy carries an OLD value that a whole-region write would put
    back, and (b) be CHANGED during the build. Verified by sabotage: lifting
    every key instead of the four fails this and only this test."""
    mp = _manifest()
    m = _read(mp)
    for r in m["regions"]:
        if r["name"] == "H1_glow":
            r["negative"] = "the value the rebuild starts from"
    mp.write_text(json.dumps(m), encoding="utf-8")

    def edit_the_fx_layer_itself():
        with u._manifest_lock:
            m = _read(mp)
            for r in m["regions"]:
                if r["name"] == "H1_glow":
                    r["negative"] = "typed during the rebuild"
            mp.write_text(json.dumps(m), encoding="utf-8")

    _slow_build(mp, edit_the_fx_layer_itself)
    rebuilt, skipped = u.rebuild_fx_layers_at(mp, base_names={"H1"})
    check("the FX result still lands", rebuilt, ["H1_glow"])
    check("nothing was skipped -- the FX fields themselves did not change",
          skipped, [])
    check("a non-FX field saved mid-build, on the REBUILT region, survives",
          _region(mp, "H1_glow").get("negative"), "typed during the rebuild")
    check("and the build's own output is bound",
          _region(mp, "H1_glow").get("output_override"),
          "refs/useroutput_H1_glow.png")


# --------------------------------------------------------------------------
# 2. Whoever re-tuned the layer wins -- the stale result is dropped, loudly
# --------------------------------------------------------------------------
def test_a_layer_retuned_mid_rebuild_keeps_the_newer_build() -> None:
    mp = _manifest()

    def retune():
        with u._manifest_lock:
            m = _read(mp)
            for r in m["regions"]:
                if r["name"] == "H1_glow":
                    r["fx"] = {"glow": {"color": "#0000ff", "blur": 1}}
                    r["output_override"] = "refs/useroutput_H1_glow.png"
            mp.write_text(json.dumps(m), encoding="utf-8")

    _slow_build(mp, retune)
    rebuilt, skipped = u.rebuild_fx_layers_at(mp, base_names={"H1"})
    check("the stale result is not written", rebuilt, [])
    check("and it is reported, not silently dropped", skipped, ["H1_glow"])
    check("the re-tuned params stand", _region(mp, "H1_glow")["fx"]["glow"],
          {"color": "#0000ff", "blur": 1})


# --------------------------------------------------------------------------
# 3. The rebuild must NOT hold the lock -- a frozen UI is its own outage
# --------------------------------------------------------------------------
def test_the_slow_build_holds_no_lock() -> None:
    """If the rebuild held _manifest_lock, a save on another thread could not
    even start until it finished -- which is the 'fix' this one avoids."""
    mp = _manifest()
    got_in = threading.Event()

    def from_another_thread():
        t = threading.Thread(target=lambda: (
            u._manifest_lock.acquire(timeout=5) and
            (got_in.set(), u._manifest_lock.release())))
        t.start()
        t.join(5)

    _slow_build(mp, from_another_thread)
    u.rebuild_fx_layers_at(mp, base_names={"H1"})
    check("another thread can take the manifest lock mid-build",
          got_in.is_set(), True)


def test_the_re_apply_itself_is_locked() -> None:
    """The write half MUST be exclusive, or two finishing jobs interleave."""
    mp = _manifest()
    held = []

    real = u._manifest_lock

    class Probe:
        """Wraps the REAL lock (captured above, not looked up again -- reading
        u._manifest_lock in here would find this probe and recurse)."""

        def __enter__(self):
            held.append("enter")
            return real.__enter__()

        def __exit__(self, *a):
            held.append("exit")
            return real.__exit__(*a)

    u._manifest_lock = Probe()
    try:
        u.persist_region_fields(mp, {"H1_glow": {"mode": "glow"}},
                                {"H1_glow": u._region_fingerprint(
                                    _read(mp), "H1_glow", u._FX_RESULT_KEYS)},
                                u._FX_RESULT_KEYS)
    finally:
        u._manifest_lock = real
    check("persist_region_fields takes the lock", held, ["enter", "exit"])


# --------------------------------------------------------------------------
# 4. The neighbours: the other two cycles in run_compose
# --------------------------------------------------------------------------
def test_auto_pack_layout_no_longer_saves_itself() -> None:
    """It used to call save_manifest() from inside, which meant its own
    read->measure->write cycle could not be closed by the caller's lock."""
    src = Path(u.__file__).read_text(encoding="utf-8")
    body = src.split("def auto_pack_layout(")[1].split("\ndef ")[0]
    check("auto_pack_layout does not write the manifest",
          "save_manifest(" in body, False)
    check("...and says the caller owns the save", "CALLER saves" in body, True)


def test_run_compose_survives_the_dropdown_moving_under_it() -> None:
    """Behavioural, not a grep: switch the ACTIVE manifest mid-compose and the
    subprocess must still be handed the one the compose started on.

    Region names (H1, L1, ...) collide across atlases, so a step that
    re-resolved `manifest_path()` would merge or stamp the wrong atlas with
    nothing looking wrong until the art shipped."""
    mp = _manifest()
    other = mp.parent / "atlas_manifest_OTHER.json"
    other.write_text(json.dumps({"atlas": {}, "style": {}, "regions": []}),
                     encoding="utf-8")
    seen: dict = {}

    def fake_run_cmd(cmd, total, **kw):
        seen["argv"] = list(cmd)
        # What every helper underneath (all_regions' `.atlas` lookup above all)
        # would resolve to at THIS moment, deep in the job.
        seen["resolved_mid_job"] = u.manifest_path()

    def switch_the_dropdown(m, base_names=None):
        """The first slow step -- and the moment another tab switches atlas."""
        u.creative_manifest_path = lambda: other                  # noqa: E731
        return []

    u._run_cmd = fake_run_cmd
    u.rebuild_fx_layers = switch_the_dropdown
    u.repair_sheet_fit_mode = lambda m: []                        # noqa: E731
    u.auto_pack_layout = lambda m: None                           # noqa: E731
    u.project_paths.ensure_lazy = lambda p: None                  # noqa: E731

    u.run_compose()
    check("the subprocess is handed the manifest the compose STARTED on",
          str(mp) in seen.get("argv", []), True)
    check("...not the one the dropdown moved to",
          str(other) in seen.get("argv", []), False)
    check("every helper underneath resolved to the pinned manifest too",
          seen.get("resolved_mid_job"), mp)
    check("and the pin is released when the job ends, so the UI follows the "
          "dropdown again", u.manifest_path(), other)


if __name__ == "__main__":
    for fn in (test_a_save_during_the_rebuild_survives,
               test_the_rebuilds_own_result_still_lands,
               test_only_the_fx_keys_are_written,
               test_a_layer_retuned_mid_rebuild_keeps_the_newer_build,
               test_the_slow_build_holds_no_lock,
               test_the_re_apply_itself_is_locked,
               test_auto_pack_layout_no_longer_saves_itself,
               test_run_compose_survives_the_dropdown_moving_under_it):
        print(f"\n-- {fn.__name__}")
        fn()
    print(f"\n{len(PASSED)} passed, {len(FAILED)} failed")
    sys.exit(1 if FAILED else 0)
