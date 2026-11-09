"""Offline guard: one request's manifest banners never show on another's page.

Run:  PYTHONPATH=".;../_shared" py test_page_warnings.py   (from services/atlas-tool)

`load_manifest` ("manifest X is not there") and `all_regions` ("N regions
missing from the .atlas") used to record their banners in MODULE globals,
which `_index` read back to draw the page. ThreadingHTTPServer answers every
request on its own thread, each with its own (client, project) context — so
the globals were shared by every user and project in the process: project A's
"manifest not found" could appear on project B's page if A's request landed
between B's load and B's render. They are now per-request state
(`_request_local`, reset by `_dispatch`).

The interleaving is forced with events, not left to timing. No R2, no GPU.
ASCII only in the labels (cp1252 console).
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
from pathlib import Path

_STAGING = Path(tempfile.mkdtemp(prefix="page-warnings-"))
os.environ["ATLAS_STAGING"] = str(_STAGING)

import ui_server as u  # noqa: E402

FAILED: list[str] = []
PASSED: list[str] = []

ATLAS = """page.png
size: 64,64
format: RGBA8888
filter: Linear,Linear
repeat: none
A
  rotate: false
  xy: 0, 0
  size: 32, 32
  orig: 32, 32
  offset: 0, 0
  index: -1
"""


def check(label: str, got, want) -> None:
    ok = got == want
    print(f"{'ok  ' if ok else 'FAIL'} {label}")
    (PASSED if ok else FAILED).append(label)
    if not ok:
        print(f"       got  {got!r}\n       want {want!r}")


def _fixture() -> dict[str, Path]:
    d = _STAGING / "fixtures"
    d.mkdir(parents=True, exist_ok=True)
    atlas = d / "page.atlas"
    atlas.write_text(ATLAS, encoding="utf-8")
    clean = d / "atlas_manifest_clean.json"
    clean.write_text(json.dumps({"atlas": {}, "regions": [{"name": "A"}]}), encoding="utf-8")
    stale = d / "atlas_manifest_stale.json"
    stale.write_text(json.dumps({"atlas": {"atlas_file": str(atlas)},
                                 "regions": [{"name": "A"}, {"name": "Ghost"}]}),
                     encoding="utf-8")
    return {"clean": clean, "stale": stale, "missing": d / "atlas_manifest_gone.json"}


def _request(project: str, manifest: Path, go: threading.Event | None,
             done: threading.Event, out: dict, read_after: threading.Event | None = None):
    """One request thread: its own context and pinned manifest, as `_dispatch`
    sets them up, loading the page's manifest + regions."""
    def run():
        u.project_paths.set_context("acme", project)
        u._reset_request_local()
        with u.pinned_manifest(manifest):
            if go:
                go.wait(10)
            u.all_regions(u.load_manifest())
            done.set()
            if read_after:
                read_after.wait(10)
            out["load"], out["geom"] = u.load_warning(), u.geom_warning()
    t = threading.Thread(target=run)
    t.start()
    return t


def test_a_banner_stays_on_the_request_that_raised_it() -> None:
    m = _fixture()
    b_loaded, a_loaded, c_loaded = threading.Event(), threading.Event(), threading.Event()
    a, b, c = {}, {}, {}
    # B (a healthy project) loads first, then A (missing manifest) and C (stale
    # geometry) raise their banners, and only THEN does B draw its page.
    tb = _request("proj_b", m["clean"], None, b_loaded, b,
                  read_after=c_loaded)
    ta = _request("proj_a", m["missing"], b_loaded, a_loaded, a)
    tc = _request("proj_c", m["stale"], a_loaded, c_loaded, c)
    for t in (ta, tb, tc):
        t.join(20)
    check("A sees its own missing-manifest banner",
          "atlas_manifest_gone.json" in a.get("load", ""), True)
    check("C sees its own stale-geometry banner",
          "missing from page.atlas" in c.get("geom", ""), True)
    check("B, drawn after both, shows neither", (b.get("load"), b.get("geom")), ("", ""))
    check("A's banner is not C's", a.get("geom"), "")
    check("C's banner is not A's", c.get("load"), "")


def test_a_reused_thread_starts_each_request_clean() -> None:
    """A keep-alive connection serves its next request on the same thread;
    `_dispatch` resets the per-request state first."""
    m = _fixture()
    with u.pinned_manifest(m["missing"]):
        u._reset_request_local()
        u.load_manifest()
    check("the first request raised its banner", bool(u.load_warning()), True)
    u._reset_request_local()
    check("the next request on that thread does not inherit it", u.load_warning(), "")


if __name__ == "__main__":
    for fn in (test_a_banner_stays_on_the_request_that_raised_it,
               test_a_reused_thread_starts_each_request_clean):
        print(f"\n-- {fn.__name__}")
        fn()
    print(f"\n{len(PASSED)} passed, {len(FAILED)} failed")
    sys.exit(1 if FAILED else 0)
