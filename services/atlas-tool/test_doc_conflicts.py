"""Offline guard: an Atlas Maker save never silently overwrites somebody else's.
No R2, no ComfyUI — `doc_sync.storage` is a dict-backed bucket with real ETag
preconditions, and the page's fetch wrapper runs under node.

Run:  PYTHONPATH=".;../_shared" py test_doc_conflicts.py   (needs node on PATH)

WHAT IS PINNED (docs/design/multi-user-concurrency.md Phase 3):

  * A two-writer race on one atlas manifest — sequential AND on two real threads
    — lands exactly one write; the other is refused with a conflict that names
    who saved, and nothing it wrote reaches R2 or staging.
  * "Overwrite with mine" is If-Match on the version the conflict showed: it
    lands on that version and is refused again if that one moved too.
  * The render pipeline's own writes (`_write_manifest_at`) are CAS but never
    trip an author: they move the ETag, not `saved_by.rev`, and the author's
    next edit merges on top of them.
  * Staging older than R2 (another container, the Sheet Maker) is re-read before
    a write — the edit lands on R2's version, and a user save that raced it is
    refused naming the other tool.
  * Creates are create-only claims; replace is If-Match on what is there.
  * The dispatcher answers a conflict 409 JSON and every response carries the
    versions the page must adopt; the "X is editing" presence names the holder.
  * doc-guard.js re-sends the SAME request on the conflict's version, adopts
    returned versions only for docs it shows, and never offers overwrite for a
    doc the page is not showing.

ASCII only in the labels (cp1252 consoles).
"""
from __future__ import annotations

import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
from pathlib import Path
from types import SimpleNamespace

os.environ["ATLAS_STAGING"] = tempfile.mkdtemp(prefix="doc-conflicts-")
for _k in ("ATLAS_TOOL_SECRET", "ATLAS_TOOL_SIGNING_SECRET"):
    os.environ.pop(_k, None)

import storage  # noqa: E402
import doc_sync  # noqa: E402
import ui_server as u  # noqa: E402
from iw_common import docsave, launch, lease  # noqa: E402

FAILED: list[str] = []
PASSED: list[str] = []


def _say(text: str) -> None:
    enc = sys.stdout.encoding or "utf-8"
    print(text.encode(enc, errors="replace").decode(enc, errors="replace"))


def check(label: str, got, want) -> None:
    ok = got == want
    _say(f"{'ok  ' if ok else 'FAIL'} {label}" + ("" if ok else f"\n     got  {got!r}\n     want {want!r}"))
    (PASSED if ok else FAILED).append(label)


class FakeR2:
    """Just enough of iw_common.storage, with R2's precondition semantics. `put`
    is atomic (one lock), exactly like the real adjudication."""
    Conflict = storage.Conflict
    ObjectUnreadable = storage.ObjectUnreadable

    def __init__(self) -> None:
        self.objects: dict[str, tuple[bytes, str]] = {}
        self.n = 0
        self.lock = threading.Lock()
        self.puts: list[tuple[str, dict]] = []
        # Called once, inside the next put, before it is adjudicated: another
        # writer landing between our read and our write.
        self.before_put = None
        self.fail_puts = 0
        self.fail_with: Exception = RuntimeError("R2 hiccup")

    def get_with_etag(self, key):
        with self.lock:
            return self.objects.get(key)

    def put(self, key, body, content_type=None, *, if_match=None, if_none_match=None):
        hook, self.before_put = self.before_put, None
        if hook:
            hook(key)
        if self.fail_puts:
            self.fail_puts -= 1
            raise self.fail_with
        with self.lock:
            have = self.objects.get(key)
            if if_none_match == "*" and have is not None:
                raise storage.Conflict(key)
            if if_match and (have is None or have[1] != if_match):
                raise storage.Conflict(key)
            self.n += 1
            etag = f'"e{self.n}"'
            self.objects[key] = (bytes(body), etag)
            self.puts.append((key, {"if_match": if_match, "if_none_match": if_none_match}))
            return etag

    def delete(self, key):
        with self.lock:
            self.objects.pop(key, None)

    def raw_put(self, key, doc: dict) -> str:
        with self.lock:
            self.n += 1
            etag = f'"e{self.n}"'
            self.objects[key] = (json.dumps(doc, indent=2).encode("utf-8"), etag)
            return etag


R2 = FakeR2()
doc_sync.storage = R2

ALICE = launch.Identity(via="token", sub="alice", uid="u-alice", name="Alice")
BOB = launch.Identity(via="token", sub="bob", uid="u-bob", name="Bob")

PREFIX = str(u.R2_PREFIX)
MAN = "atlas_manifest_race.json"
DOC = f"manifests/{MAN}"
KEY = f"{PREFIX}/{DOC}"
MP = Path(u.MANIFEST_DIR) / MAN
u.creative_manifest_path = lambda: MP  # noqa: E731 — pin the active manifest


def _base_doc(prompt: str = "a cherry") -> dict:
    return {"atlas": {"layout": "pack"}, "style": {},
            "regions": [{"name": "H1", "prompt": prompt}]}


def reset(doc: dict | None = None, staged: dict | None = None) -> None:
    doc_sync.reset_for_tests()
    R2.objects.clear()
    R2.puts.clear()
    R2.before_put = None
    R2.fail_puts = 0
    MP.parent.mkdir(parents=True, exist_ok=True)
    MP.unlink(missing_ok=True)
    if doc is not None:
        R2.raw_put(KEY, doc)
    if staged is not None:
        MP.write_text(json.dumps(staged), encoding="utf-8")


def open_page(ident=None) -> dict:
    """What the page render does: re-read the docs, hand the page their versions."""
    doc_sync.begin(identity=ident, sync=True)
    u.load_manifest()
    v = doc_sync.seen(DOC)
    doc_sync.end()
    return {DOC: v}


def as_page(ident, bases: dict | None) -> None:
    doc_sync.begin(identity=ident, sync=True,
                   bases=None if bases is None else docsave.parse_bases(json.dumps(bases)))


def edit_prompt(text: str) -> None:
    """The shape of every Atlas Maker edit handler: load, change, save."""
    m = u.load_manifest()
    m["regions"][0]["prompt"] = text
    u.save_manifest(m)


def r2doc() -> dict:
    return json.loads(R2.objects[KEY][0])


def staged() -> dict:
    return json.loads(MP.read_text(encoding="utf-8"))


def conflict_of(fn) -> docsave.DocConflict | None:
    try:
        fn()
    except docsave.DocConflict as e:
        return e
    finally:
        doc_sync.end()
    return None


# --------------------------------------------------------------------------
# docsave.check — the rule itself
# --------------------------------------------------------------------------
def test_the_precondition_rule() -> None:
    cur = {"saved_by": {"rev": "r1", "name": "Alice"}}
    ok = lambda base, merge=True: conflict_of(  # noqa: E731
        lambda: docsave.check("d", base, '"e2"', cur, allow_rev_merge=merge)) is None
    check("same etag passes", ok(docsave.Base("e2", "r0")), True)
    check("etag moved, same rev = only machine writes since: passes", ok(docsave.Base("e1", "r1")), True)
    check("...but not where rev-merge is off (a wholesale rewrite)",
          ok(docsave.Base("e1", "r1"), merge=False), False)
    e = conflict_of(lambda: docsave.check("d", docsave.Base("e1", "r0"), '"e2"', cur,
                                          allow_rev_merge=True))
    check("etag moved and rev moved: STALE naming the saver",
          (e.reason, e.saved_by["name"], e.etag), ("stale", "Alice", "e2"))
    e = conflict_of(lambda: docsave.check("d", None, '"e2"', cur, allow_rev_merge=True))
    check("no base for a doc that exists: UNSEEN, not overwritable",
          (e.reason, e.payload()["overwritable"]), ("unseen", False))
    e = conflict_of(lambda: docsave.check("d", docsave.Base(""), '"e2"', cur, allow_rev_merge=True))
    check("page believed it absent, it exists: EXISTS", e.reason, "exists")
    e = conflict_of(lambda: docsave.check("d", docsave.Base("e1"), None, None, allow_rev_merge=True))
    check("page loaded it, it is gone: DELETED", e.reason, "deleted")
    check("absent + no base = a create", conflict_of(
        lambda: docsave.check("d", None, None, None, allow_rev_merge=True)) is None, True)
    check("a malformed header is 'no bases', not a crash", docsave.parse_bases("{nope"), {})
    check("quotes never matter", docsave.parse_bases('{"d":{"etag":"\\"x\\""}}')["d"].etag, "x")


# --------------------------------------------------------------------------
# The two-writer race
# --------------------------------------------------------------------------
def test_stale_staging_is_reread_before_the_page_sees_it() -> None:
    reset(_base_doc("fresh in R2"), staged=_base_doc("old staging"))
    open_page()
    check("the page render brought staging up to R2", staged()["regions"][0]["prompt"],
          "fresh in R2")


def test_two_writers_one_lands_the_other_is_asked() -> None:
    reset(_base_doc())
    page_a, page_b = open_page(ALICE), open_page(BOB)

    as_page(ALICE, page_a)
    check("A's save lands", conflict_of(lambda: edit_prompt("from Alice")), None)
    check("R2 holds A's edit", r2doc()["regions"][0]["prompt"], "from Alice")
    check("stamped with who saved it", r2doc()["saved_by"]["name"], "Alice")

    as_page(BOB, page_b)
    e = conflict_of(lambda: edit_prompt("from Bob"))
    check("B's save from the stale page is refused", e is not None and e.reason, "stale")
    check("...naming Alice", e and e.saved_by["name"], "Alice")
    check("B's bytes did not reach R2", r2doc()["regions"][0]["prompt"], "from Alice")
    check("...nor staging", staged()["regions"][0]["prompt"], "from Alice")

    # "Overwrite with mine": the same edit, on the version the dialog showed.
    as_page(BOB, {DOC: {"etag": e.etag, "rev": e.rev}})
    check("B's overwrite lands", conflict_of(lambda: edit_prompt("from Bob")), None)
    check("R2 now holds B's edit", r2doc()["regions"][0]["prompt"], "from Bob")
    check("...as Bob", r2doc()["saved_by"]["name"], "Bob")
    check("...via If-Match on the version shown, never blind",
          R2.puts[-1][1]["if_match"] is not None, True)

    as_page(ALICE, page_a)
    e = conflict_of(lambda: edit_prompt("Alice again, stale"))
    check("A's stale tab is now refused in turn, naming Bob", e and e.saved_by["name"], "Bob")


def test_an_overwrite_on_a_version_that_moved_again_is_refused() -> None:
    reset(_base_doc())
    page_b = open_page(BOB)
    as_page(ALICE, open_page(ALICE))
    edit_prompt("Alice 1")
    doc_sync.end()
    as_page(BOB, page_b)
    first = conflict_of(lambda: edit_prompt("Bob"))
    as_page(ALICE, {DOC: docsave.version(R2.objects[KEY][1], r2doc())})
    edit_prompt("Alice 2")
    doc_sync.end()
    as_page(BOB, {DOC: {"etag": first.etag, "rev": first.rev}})
    e = conflict_of(lambda: edit_prompt("Bob overwrite"))
    check("the overwrite is conditional too: refused when it moved again",
          e and (e.reason, e.saved_by["name"]), ("stale", "Alice"))
    check("Alice's second edit stands", r2doc()["regions"][0]["prompt"], "Alice 2")


def test_two_threads_racing_the_same_version() -> None:
    reset(_base_doc())
    bases = open_page()
    gate = threading.Barrier(2)
    outcome: dict[str, object] = {}

    def writer(ident, text):
        as_page(ident, bases)
        try:
            m = u.load_manifest()          # both read the SAME version…
            gate.wait(timeout=5)           # …and only then both write
            m["regions"][0]["prompt"] = text
            u.save_manifest(m)
            outcome[ident.name] = "landed"
        except docsave.DocConflict as e:
            outcome[ident.name] = e
        finally:
            doc_sync.end()

    ts = [threading.Thread(target=writer, args=(i, f"from {i.name}")) for i in (ALICE, BOB)]
    for t in ts:
        t.start()
    for t in ts:
        t.join(10)
    landed = [k for k, v in outcome.items() if v == "landed"]
    lost = [v for v in outcome.values() if isinstance(v, docsave.DocConflict)]
    check("exactly one of two concurrent writers lands", len(landed), 1)
    check("the other gets a conflict, not a silent loss", len(lost), 1)
    check("R2 holds the winner's edit", r2doc()["regions"][0]["prompt"],
          f"from {landed[0]}" if landed else None)
    check("...and the loser is told who won", lost and lost[0].saved_by["name"],
          landed[0] if landed else None)


# --------------------------------------------------------------------------
# The pipeline's own writes
# --------------------------------------------------------------------------
def _machine_write(field: str, value) -> bool:
    """A render post-hook: its own thread, no page, fresh read under the lock."""
    out: dict = {}

    def run():
        with u._manifest_lock:
            m = u._read_manifest_at(MP)
            m["regions"][0][field] = value
            out["ok"] = u._write_manifest_at(MP, m)

    t = threading.Thread(target=run)
    t.start()
    t.join(10)
    return bool(out.get("ok"))


def test_a_render_write_does_not_trip_the_author() -> None:
    reset(_base_doc())
    page = open_page(ALICE)
    as_page(ALICE, page)
    edit_prompt("Alice")
    doc_sync.end()
    rev = r2doc()["saved_by"]["rev"]
    page = {DOC: docsave.version(R2.objects[KEY][1], r2doc())}
    etag_before = R2.objects[KEY][1]

    check("the post-hook write lands", _machine_write("variant", "00007"), True)
    check("it moved the ETag", R2.objects[KEY][1] != etag_before, True)
    check("...but not the author stamp", r2doc()["saved_by"]["rev"], rev)

    as_page(ALICE, page)
    check("the author's next edit from the same page is NOT refused",
          conflict_of(lambda: edit_prompt("Alice, after the render")), None)
    check("it merged: the render's variant survived", r2doc()["regions"][0].get("variant"), "00007")
    check("...and the edit landed", r2doc()["regions"][0]["prompt"], "Alice, after the render")


def test_a_machine_write_inside_a_page_request_is_still_a_machine_write() -> None:
    """/fxbuild, a manifest switch's seeding: a machine write on a REQUEST thread,
    whose page bases may well be stale. It must neither ask that page nor stamp."""
    reset(_base_doc())
    as_page(ALICE, open_page(ALICE))
    edit_prompt("Alice")
    doc_sync.end()
    rev = r2doc()["saved_by"]["rev"]
    as_page(BOB, {DOC: {"etag": "long-gone", "rev": "long-gone"}})
    try:
        with u._manifest_lock:
            m = u._read_manifest_at(MP)
            m["regions"][0]["variant"] = "00042"
            landed = u._write_manifest_at(MP, m)
    finally:
        doc_sync.end()
    check("it lands although the page's base is stale", landed, True)
    check("...and is not stamped as that page's author", r2doc()["saved_by"]["rev"], rev)


def test_another_tool_saving_is_a_real_conflict() -> None:
    reset(_base_doc())
    page = open_page(ALICE)
    theirs = _base_doc("re-exported by the Sheet Maker")
    theirs["saved_by"] = {"name": "Carol", "tool": "sheet", "rev": "carol1", "uid": "u-carol"}
    R2.raw_put(KEY, theirs)                      # another container / tool
    as_page(ALICE, page)
    e = conflict_of(lambda: edit_prompt("Alice"))
    check("the stale page is refused, naming the other tool's author",
          e and (e.saved_by["name"], e.saved_by["tool"]), ("Carol", "sheet"))
    check("their export stands", r2doc()["regions"][0]["prompt"], "re-exported by the Sheet Maker")


def test_a_machine_write_merges_onto_what_another_container_saved() -> None:
    reset(_base_doc(), staged=_base_doc())
    open_page()
    other = _base_doc("saved on another container")
    R2.raw_put(KEY, other)                       # staging here is now stale
    check("the render write lands", _machine_write("variant", "00009"), True)
    check("...onto R2's version, not this container's stale copy",
          (r2doc()["regions"][0]["prompt"], r2doc()["regions"][0]["variant"]),
          ("saved on another container", "00009"))


def test_a_writer_landing_between_read_and_write() -> None:
    reset(_base_doc())
    page = open_page(ALICE)
    dave = _base_doc("Dave, mid-flight")
    dave["saved_by"] = {"name": "Dave", "rev": "d1"}
    R2.before_put = lambda key: R2.raw_put(KEY, dave)
    as_page(ALICE, page)
    e = conflict_of(lambda: edit_prompt("Alice"))
    check("a write that raced the precheck is refused by R2 itself",
          e and (e.reason, e.saved_by["name"]), ("stale", "Dave"))
    check("Dave's write stands", r2doc()["regions"][0]["prompt"], "Dave, mid-flight")
    check("staging was left as R2 has it", staged()["regions"][0]["prompt"], "Dave, mid-flight")

    R2.before_put = lambda key: R2.raw_put(KEY, _base_doc("Erin, mid-flight"))
    check("a machine write that raced is rebased onto the winner, never forced over it",
          _machine_write("variant", "00001"), True)
    check("...Erin's write stands, with the machine's field on top",
          (r2doc()["regions"][0]["prompt"], r2doc()["regions"][0].get("variant")),
          ("Erin, mid-flight", "00001"))


def test_a_page_showing_another_atlas_is_not_offered_overwrite() -> None:
    reset(_base_doc())
    open_page()
    as_page(ALICE, {"manifests/atlas_manifest_other.json": {"etag": "x", "rev": ""}})
    e = conflict_of(lambda: edit_prompt("into the wrong atlas"))
    check("UNSEEN when the page never loaded the doc it would write",
          e and (e.reason, e.payload()["overwritable"]), ("unseen", False))


def test_deleted_since_the_page_loaded() -> None:
    reset(_base_doc())
    page = open_page(ALICE)
    R2.delete(KEY)
    as_page(ALICE, page)
    e = conflict_of(lambda: edit_prompt("Alice"))
    check("DELETED", e and e.reason, "deleted")
    check("nothing recreated it", KEY in R2.objects, False)
    as_page(ALICE, {DOC: {"etag": "", "rev": ""}})
    check("'Save it again' recreates it create-only",
          (conflict_of(lambda: edit_prompt("Alice")), R2.puts[-1][1]["if_none_match"]),
          (None, "*"))


def test_a_pre_deploy_tab_is_still_compare_and_swapped() -> None:
    reset(_base_doc())
    open_page()
    as_page(ALICE, None)                         # no X-IW-Doc-Bases header
    check("a request with no bases still saves", conflict_of(lambda: edit_prompt("old tab")), None)
    check("...conditionally", R2.puts[-1][1]["if_match"] is not None, True)


# --------------------------------------------------------------------------
# Creates
# --------------------------------------------------------------------------
def test_a_create_is_a_create_only_claim() -> None:
    reset()
    taken = Path(u.MANIFEST_DIR) / "atlas_manifest_taken.json"
    tkey = f"{PREFIX}/manifests/{taken.name}"
    holder = _base_doc("theirs")
    holder["saved_by"] = {"name": "Frank", "rev": "f1"}
    R2.raw_put(tkey, holder)
    taken.unlink(missing_ok=True)               # not in THIS container's staging
    as_page(ALICE, open_page(ALICE))
    e = conflict_of(lambda: u._store_doc(taken, _base_doc("mine"), user=True, create=True))
    check("a name taken in R2 is refused though staging never saw it",
          e and (e.reason, e.saved_by["name"]), ("exists", "Frank"))
    check("theirs stands", json.loads(R2.objects[tkey][0])["regions"][0]["prompt"], "theirs")
    as_page(ALICE, {f"manifests/{taken.name}": {"etag": e.etag, "rev": e.rev}})
    check("'Replace it' — the same create, based on the version shown — lands",
          conflict_of(lambda: u._store_doc(taken, _base_doc("mine"), user=True, create=True)),
          None)
    check("...If-Match on what it replaced", R2.puts[-1][1]["if_match"] is not None, True)
    fresh = Path(u.MANIFEST_DIR) / "atlas_manifest_fresh.json"
    fresh.unlink(missing_ok=True)
    as_page(ALICE, {})
    u._store_doc(fresh, {**_base_doc(), "saved_by": {"name": "copied"}}, user=True, create=True)
    doc_sync.end()
    got = json.loads(R2.objects[f"{PREFIX}/manifests/{fresh.name}"][0])
    check("a new name is claimed If-None-Match", R2.puts[-1][1]["if_none_match"], "*")
    check("a copy never carries its source's author", got["saved_by"]["name"], "Alice")


# --------------------------------------------------------------------------
# The config: settings are an edit, switching atlases is a selection
# --------------------------------------------------------------------------
def test_switching_atlases_never_reads_as_a_settings_conflict() -> None:
    reset(_base_doc())
    ckey = f"{PREFIX}/atlas_config.json"
    # A config some author has already saved (stamped). An UNSTAMPED one is
    # never merged on rev — see test_an_unstamped_doc_is_never_merged_on_rev.
    R2.raw_put(ckey, {"manifest_path": MAN, "gen_width": 1024,
                      "saved_by": {"name": "Hal", "rev": "h1"}})
    Path(u.CONFIG_PATH).unlink(missing_ok=True)
    doc_sync.begin(sync=True)
    u.load_config()
    page_a = {"atlas_config.json": doc_sync.seen("atlas_config.json")}
    doc_sync.end()
    as_page(BOB, {})
    cfg = u.load_config()
    cfg["manifest_path"] = "atlas_manifest_other.json"
    u.save_config(cfg)                           # a selection
    doc_sync.end()
    as_page(ALICE, page_a)
    cfg = u.load_config()
    cfg["gen_width"] = 768
    check("A's settings save after B only SWITCHED atlases is not refused",
          conflict_of(lambda: u.save_config(cfg, user=True)), None)
    as_page(BOB, {"atlas_config.json": page_a["atlas_config.json"]})
    cfg = u.load_config()
    cfg["gen_width"] = 512
    e = conflict_of(lambda: u.save_config(cfg, user=True))
    check("but B's settings save over A's settings edit is refused, naming A",
          e and e.saved_by["name"], "Alice")


# --------------------------------------------------------------------------
# HTTP: 409 + the versions header, and presence
# --------------------------------------------------------------------------
class FakeHandler(u.Handler):
    """The real `_post` + `_dispatch` + `_send`, over captured bytes."""

    def __init__(self, path: str, body: dict, bases: dict | None, ident) -> None:
        raw = json.dumps(body).encode("utf-8")
        self.path = path
        self.headers = {"Content-Length": str(len(raw))}
        if bases is not None:
            self.headers["X-IW-Doc-Bases"] = json.dumps(bases)
        self.rfile = io.BytesIO(raw)
        self.wfile = io.BytesIO()
        self._identity = ident
        self.sent_headers: dict = {}
        self.code = None

    def _authenticate(self):
        return True

    def _resolve_context(self):
        pass

    def _resolve_publish(self):
        self.can_publish = False

    def send_response(self, code, message=None):
        self.code = code

    def send_header(self, k, v):
        self.sent_headers[k] = v

    def end_headers(self):
        pass


def _post(path, body, bases, ident) -> FakeHandler:
    h = FakeHandler(path, body, bases, ident)
    h.do_POST()
    return h


def test_the_dispatcher_answers_409_and_hands_back_versions() -> None:
    reset(_base_doc())
    page_a, page_b = open_page(ALICE), open_page(BOB)
    card = {"name": "H1", "selected": True, "prompt": "via http", "gpt_prompt": "",
            "lock": False, "seed": "", "variant": "", "negative": "",
            "negative_replace": False, "positive_replace": False}
    ok = _post("/save", [card], page_a, ALICE)
    check("a fresh save answers 200", ok.code, 200)
    vers = json.loads(ok.sent_headers.get("X-IW-Doc-Versions") or "{}")
    check("...and hands back the version the page must now hold",
          vers.get(DOC, {}).get("etag"), docsave.norm_etag(R2.objects[KEY][1]))
    stale = _post("/save", [{**card, "prompt": "stale"}], page_b, BOB)
    body = json.loads(stale.wfile.getvalue() or b"{}")
    check("a stale save answers 409", stale.code, 409)
    check("...with JSON the page can ask from",
          (body.get("conflict"), body.get("reason"), (body.get("saved_by") or {}).get("name")),
          (True, "stale", "Alice"))
    check("R2 kept Alice's edit", r2doc()["regions"][0]["prompt"], "via http")


class _LeaseBucket:
    def __init__(self):
        self.o: dict = {}
        self.n = 0

    def get_with_etag(self, k):
        return self.o.get(k)

    def put(self, k, b, c=None, *, if_match=None, if_none_match=None):
        if if_none_match == "*" and k in self.o:
            raise storage.Conflict(k)
        if if_match and if_match != "*" and (k not in self.o or self.o[k][1] != if_match):
            raise storage.Conflict(k)
        self.n += 1
        self.o[k] = (b, f'"l{self.n}"')
        return self.o[k][1]

    def delete(self, k):
        self.o.pop(k, None)


def test_presence_names_who_is_editing() -> None:
    bucket = _LeaseBucket()
    real = (lease.storage.get_with_etag, lease.storage.put, lease.storage.delete)
    lease.storage.get_with_etag, lease.storage.put, lease.storage.delete = (
        bucket.get_with_etag, bucket.put, bucket.delete)
    try:
        def beat(ident, tab, **kw):
            return u.Handler._presence(SimpleNamespace(_identity=ident),
                                       {"doc": DOC, "tab": tab, **kw})["holder"]
        check("the first tab holds it: no banner", beat(ALICE, "t1"), None)
        h = beat(BOB, "t2")
        check("a second person sees who is editing", h and (h["name"], h["same_user"]),
              ("Alice", False))
        h = beat(ALICE, "t3")
        check("the same person's other tab is told it is them", h and h["same_user"], True)
        check("the holder's heartbeat keeps it", beat(ALICE, "t1"), None)
        beat(ALICE, "t1", release=True)
        check("released: the next person takes it", beat(BOB, "t2"), None)
        check("a doc that is not a manifest is ignored",
              u.Handler._presence(SimpleNamespace(_identity=BOB),
                                  {"doc": "atlas_config.json", "tab": "t9"})["holder"], None)
    finally:
        lease.storage.get_with_etag, lease.storage.put, lease.storage.delete = real


# --------------------------------------------------------------------------
# Review fixes (2026-09-30): each one a way the guard could be walked around
# --------------------------------------------------------------------------
def test_a_page_never_learns_a_version_it_only_read() -> None:
    reset(_base_doc())
    as_page(ALICE, open_page(ALICE))
    u.load_manifest()
    check("a request that only LOADED hands back no version", doc_sync.versions(), {})
    doc_sync.end()
    page_a, page_b = open_page(ALICE), open_page(BOB)
    as_page(ALICE, page_a)
    edit_prompt("Alice")
    doc_sync.end()
    card = {"name": "H1", "selected": True, "prompt": "Bob", "gpt_prompt": "",
            "lock": False, "seed": "", "variant": "", "negative": "",
            "negative_replace": False, "positive_replace": False}
    stale = _post("/save", [card], page_b, BOB)
    check("the 409 does NOT carry the version that refused it (the page would adopt it)",
          DOC in json.loads(stale.sent_headers.get("X-IW-Doc-Versions") or "{}"), False)
    again = _post("/save", [card], page_b, BOB)
    check("so the stale page's NEXT save is refused too, not waved through", again.code, 409)
    check("Alice's edit stands", r2doc()["regions"][0]["prompt"], "Alice")


def test_a_page_edit_r2_did_not_take_is_refused_not_answered_ok() -> None:
    reset(_base_doc())
    page = open_page(ALICE)
    R2.fail_puts = 1
    as_page(ALICE, page)
    try:
        edit_prompt("lost?")
        refused = False
    except storage.ObjectUnreadable:
        refused = True
    finally:
        doc_sync.end()
    check("a non-412 R2 failure on a page edit raises (-> 503), never a quiet 200", refused, True)
    check("R2 unchanged", r2doc()["regions"][0]["prompt"], "a cherry")
    check("staging unchanged too", staged()["regions"][0]["prompt"], "a cherry")


class _Transient(Exception):
    response = {"ResponseMetadata": {"HTTPStatusCode": 409},
                "Error": {"Code": "ConditionalRequestConflict"}}


def test_r2s_transient_409_is_retried() -> None:
    reset(_base_doc())
    page = open_page(ALICE)
    R2.fail_puts, R2.fail_with = 1, _Transient()
    as_page(ALICE, page)
    check("a ConditionalRequestConflict is retried, then lands",
          conflict_of(lambda: edit_prompt("after a blip")), None)
    check("...in R2", r2doc()["regions"][0]["prompt"], "after a blip")
    R2.fail_with = RuntimeError("R2 hiccup")


def test_a_staged_copy_of_unknown_origin_never_beats_r2() -> None:
    reset(_base_doc("the real atlas"), staged={"atlas": {}, "style": {}, "regions": []})
    u.project_paths.note_authored(*u._authored_slugs(), MAN)   # a claim left up
    try:
        page = open_page(ALICE)                                # a fresh process
        check("R2 wins over an empty stub kept under a claim",
              staged()["regions"][0]["prompt"], "the real atlas")
        as_page(ALICE, page)
        edit_prompt("edited")
        doc_sync.end()
        check("the first edit lands on the real atlas, not the stub",
              [r["name"] for r in r2doc()["regions"]], ["H1"])
    finally:
        u.project_paths.clear_authored(*u._authored_slugs(), MAN)


def test_a_machine_write_that_loses_a_race_is_rebased_not_dropped() -> None:
    reset(_base_doc())
    open_page()
    theirs = _base_doc("saved mid-render on another container")
    theirs["regions"].append({"name": "L1", "prompt": "new region"})
    R2.before_put = lambda key: R2.raw_put(KEY, theirs)
    check("the render write still lands", _machine_write("variant", "00011"), True)
    got = {r["name"]: r for r in r2doc()["regions"]}
    check("...rebased onto theirs: their prompt AND region survive",
          (got["H1"]["prompt"], "L1" in got), ("saved mid-render on another container", True))
    check("...with its own change applied", got["H1"].get("variant"), "00011")


def test_rebase_rules() -> None:
    base = {"atlas": {"w": 1, "h": 1}, "regions": [{"name": "A", "x": 0}, {"name": "B"}]}
    mine = {"atlas": {"w": 2, "h": 1}, "regions": [{"name": "A", "x": 5}, {"name": "C"}]}
    theirs = {"atlas": {"w": 1, "h": 9}, "style": {"s": 1},
              "regions": [{"name": "A", "x": 0, "p": "t"}, {"name": "B"}, {"name": "D"}]}
    out = doc_sync.rebase(base, mine, theirs)
    check("nested keys from both sides", out["atlas"], {"w": 2, "h": 9})
    check("their new top-level key kept", out.get("style"), {"s": 1})
    check("regions matched by name, fields merged",
          next(r for r in out["regions"] if r["name"] == "A"), {"name": "A", "x": 5, "p": "t"})
    check("mine removed B, added C; theirs added D",
          sorted(r["name"] for r in out["regions"]), ["A", "C", "D"])


def test_side_effects_wait_for_the_precheck() -> None:
    import base64

    from PIL import Image
    reset(_base_doc())
    page_b = open_page(BOB)
    as_page(ALICE, open_page(ALICE))
    edit_prompt("Alice")
    doc_sync.end()
    tile = Path(u.INPUT_DIR) / "refs" / "useroutput_H1.png"
    tile.unlink(missing_ok=True)
    buf = io.BytesIO()
    Image.new("RGBA", (4, 4), (255, 0, 0, 255)).save(buf, "PNG")
    as_page(BOB, page_b)
    e = conflict_of(lambda: u.Handler._setoutput(
        SimpleNamespace(_ensure_region=lambda m, n: m["regions"][0]),
        {"name": "H1", "data": base64.b64encode(buf.getvalue()).decode()}))
    check("a stale 'use my image' is refused", e and e.reason, "stale")
    check("...before the committed tile was replaced", tile.exists(), False)


def test_two_saves_in_one_request_do_not_conflict_with_each_other() -> None:
    reset(_base_doc())
    as_page(ALICE, open_page(ALICE))

    def twice():
        edit_prompt("one")
        edit_prompt("two")
    check("the same request saving twice is not its own conflict", conflict_of(twice), None)
    check("both landed, in order", r2doc()["regions"][0]["prompt"], "two")


def test_an_unstamped_doc_is_never_merged_on_rev() -> None:
    reset(_base_doc())                       # no saved_by: rev "" on every version
    page = open_page(ALICE)
    R2.raw_put(KEY, _base_doc("written by something that does not stamp"))
    as_page(ALICE, page)
    e = conflict_of(lambda: edit_prompt("Alice"))
    check("an empty rev proves nothing: a moved ETag is STALE", e and e.reason, "stale")


def test_new_atlas_replace_needs_the_version_shown() -> None:
    reset()
    taken = Path(u.MANIFEST_DIR) / "atlas_manifest_popular.json"
    tkey, tdoc = f"{PREFIX}/manifests/{taken.name}", f"manifests/{taken.name}"
    held = _base_doc("Gina's atlas")
    held["saved_by"] = {"name": "Gina", "rev": "g1"}
    R2.raw_put(tkey, held)
    taken.unlink(missing_ok=True)
    as_page(ALICE, {})
    e = conflict_of(lambda: u.Handler._newatlas(SimpleNamespace(),
                                                {"name": "popular", "overwrite": True}))
    check("a confirmed New-atlas overwrite still asks, naming who it replaces",
          e and (e.reason, e.saved_by["name"]), ("exists", "Gina"))
    check("Gina's atlas stands", json.loads(R2.objects[tkey][0])["regions"][0]["prompt"],
          "Gina's atlas")
    as_page(ALICE, {tdoc: {"etag": e.etag, "rev": e.rev}})
    try:
        u.Handler._newatlas(SimpleNamespace(), {"name": "popular", "overwrite": True})
    finally:
        doc_sync.end()
    check("'Replace it' on the version shown replaces it",
          json.loads(R2.objects[tkey][0])["regions"], [])


# --------------------------------------------------------------------------
# doc-guard.js — the page half, under node
# --------------------------------------------------------------------------
HARNESS = r"""
const results = {};
const calls = [];
const queue = JSON.parse(process.env.QUEUE).map(r =>
  new Response(r.body, {status: r.status, headers: r.headers || {}}));
global.window = global;
let markReloaded;
const reloadedP = new Promise(res => { markReloaded = res; });
global.location = {href: 'http://tool.test/', origin: 'http://tool.test',
  reload() { results.reloaded = true; markReloaded(); }};
// doc-guard leaves a 15s queue-bound timer per POST; exit once the answer is out.
const report = () => process.stdout.write(JSON.stringify(results) + '\n', () => process.exit(0));
global.fetch = async (input, init) => {
  const h = init && init.headers ? new Headers(init.headers) : new Headers();
  calls.push({url: String(input), bases: h.get('X-IW-Doc-Bases'), body: init && init.body});
  return queue.shift();
};
function mk(tag) {
  return {tag, style: {}, dataset: {}, children: [], _t: '',
    appendChild(c) { this.children.push(c); return c; }, setAttribute() {},
    remove() {}, focus() {},
    set textContent(v) { this._t = v; }, get textContent() { return this._t; }};
}
const walk = n => [n, ...(n.children || []).flatMap(walk)];
global.document = {readyState: 'complete', createElement: mk,
  addEventListener() {}, removeEventListener() {}, getElementById() { return null; },
  body: {firstChild: null, insertBefore() {}, appendChild(shade) {
    const all = walk(shade);
    results.shown = all.map(n => n._t).filter(Boolean).join(' | ');
    results.offered = all.filter(n => n.dataset && n.dataset.choice).map(n => n.dataset.choice);
    const btn = all.find(n => n.dataset && n.dataset.choice === process.env.CHOICE);
    setTimeout(() => btn.onclick(), 0);
  }}};
global.navigator = {};
global.sessionStorage = {getItem() { return null; }, setItem() {}};
__SCRIPT__
(async () => {
  const get = await fetch('/cardsdata', {method: 'GET'});
  results.getBases = calls[0].bases;
  if (process.env.SCENARIO === 'overlap') {
    const both = await Promise.all([
      fetch('/save', {method: 'POST', body: 'first'}),
      fetch('/save', {method: 'POST', body: 'second'})]);
    results.status = both.map(r => r.status);
    results.sent = calls.slice(1).map(c => ({bases: JSON.parse(c.bases), body: c.body}));
    results.docs = window.IW_DOCS;
    report();
    return;
  }
  // Wait on the outcome, not the clock: the caller's answer, or the page reloading. A reload
  // must leave the caller pending, so once it fires, let the event loop drain a few turns and
  // report whatever the save settled to; null means it is still pending.
  const save = fetch('/save', {method: 'POST', body: '{"edit":1}'});
  const outcome = {settled: false};
  save.then(r => Object.assign(outcome, {settled: true, status: r.status}),
            e => Object.assign(outcome, {settled: true, status: 'rejected: ' + e}));
  const r = await Promise.race([save, reloadedP.then(() => null)]);
  if (r) results.status = r.status;
  else {
    for (let i = 0; i < 20; i++) await new Promise(res => setImmediate(res));
    results.status = outcome.settled ? outcome.status : null;
  }
  results.sent = calls.slice(1).map(c => ({bases: JSON.parse(c.bases), body: c.body}));
  results.docs = window.IW_DOCS;
  report();
})();
"""


def _run_guard(queue: list, choice: str, scenario: str = "", docs: dict | None = None
               ) -> dict | None:
    node = shutil.which("node")
    if not node:
        check("node is on PATH (doc-guard.js cannot be exercised without it)", False, True)
        return None
    script = u.doc_guard_js(docs or {DOC: {"etag": "e1", "rev": "r1"}},
                            {"uid": "u-bob", "sub": "bob", "name": "Bob"}, "")
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as f:
        f.write(HARNESS.replace("__SCRIPT__", script))
    try:
        out = subprocess.run([node, f.name], capture_output=True, text=True, timeout=30,
                             env={**os.environ, "QUEUE": json.dumps(queue), "CHOICE": choice,
                                  "SCENARIO": scenario},
                             encoding="utf-8")
    finally:
        os.unlink(f.name)
    if out.returncode != 0:
        check("doc-guard harness ran", out.stderr.strip()[-400:], "")
        return None
    if not out.stdout.strip():
        check("doc-guard harness answered (the save neither settled nor reloaded the page)",
              out.stdout, "<a JSON result>")
        return None
    return json.loads(out.stdout.strip().splitlines()[-1])


def _conflict(reason="stale", overwritable=True) -> dict:
    return {"status": 409, "headers": {"Content-Type": "application/json"},
            "body": json.dumps({
                "conflict": True, "doc": DOC, "reason": reason, "etag": "e2", "rev": "r2",
                "overwritable": overwritable,
                "saved_by": {"name": "Alice", "uid": "u-alice", "tool": "atlas",
                             "at": "2026-09-30T10:00:00Z"}})}


def test_the_page_wrapper() -> None:
    get = {"status": 200, "body": "{}"}
    done = {"status": 200, "body": "saved",
            "headers": {"X-IW-Doc-Versions": json.dumps({
                DOC: {"etag": "e3", "rev": "r3"},
                "manifests/atlas_manifest_other.json": {"etag": "zz", "rev": ""}})}}
    res = _run_guard([get, _conflict(), done], "overwrite")
    if res is None:
        return
    check("a GET carries no bases", res["getBases"], None)
    check("the first POST carries the version the page loaded",
          res["sent"][0]["bases"][DOC]["etag"], "e1")
    check("the conflict names who saved", "Alice" in res["shown"], True)
    check("stale offers reload / overwrite / cancel", res["offered"],
          ["reload", "overwrite", "cancel"])
    check("overwrite re-sends the SAME request...", res["sent"][1]["body"], '{"edit":1}')
    check("...on the version the dialog showed", res["sent"][1]["bases"][DOC],
          {"etag": "e2", "rev": "r2"})
    check("the caller sees the final answer", res["status"], 200)
    check("the page adopts the new version of the doc it shows", res["docs"][DOC]["etag"], "e3")
    check("...and never one for a doc it does not show",
          "manifests/atlas_manifest_other.json" in res["docs"], False)

    res = _run_guard([get, _conflict()], "reload")
    if res:
        check("reload theirs reloads the page", res.get("reloaded"), True)
        check("...and the caller is left pending, not handed an error", res["status"], None)

    first = {"status": 200, "body": "ok", "headers": {
        "X-IW-Doc-Versions": json.dumps({DOC: {"etag": "e5", "rev": "r5"}})}}
    res = _run_guard([get, first, {"status": 200, "body": "ok"}], "cancel", "overlap")
    if res:
        check("two overlapping POSTs are sent one after the other",
              [x["body"] for x in res["sent"]], ["first", "second"])
        check("...the second based on the version the first just wrote",
              res["sent"][1]["bases"][DOC]["etag"], "e5")
        check("...and neither is refused", res["status"], [200, 200])

    odd = "manifests/atlas_manifest_café.json"
    res = _run_guard([get, {"status": 200, "body": "ok"}], "cancel",
                     docs={json.loads(f'"{odd}"'): {"etag": "e1", "rev": ""}})
    if res:
        check("a non-ASCII doc id does not break the header (escaped, not thrown)",
              res["status"], 200)

    res = _run_guard([get, _conflict("unseen", overwritable=False)], "cancel")
    if res:
        check("a doc the page is not showing is never offered overwrite",
              "overwrite" in res["offered"], False)
        check("cancel hands the caller a non-OK answer", res["status"], 409)


def main() -> int:
    for fn in (
        test_the_precondition_rule,
        test_stale_staging_is_reread_before_the_page_sees_it,
        test_two_writers_one_lands_the_other_is_asked,
        test_an_overwrite_on_a_version_that_moved_again_is_refused,
        test_two_threads_racing_the_same_version,
        test_a_render_write_does_not_trip_the_author,
        test_a_machine_write_inside_a_page_request_is_still_a_machine_write,
        test_another_tool_saving_is_a_real_conflict,
        test_a_machine_write_merges_onto_what_another_container_saved,
        test_a_writer_landing_between_read_and_write,
        test_a_page_showing_another_atlas_is_not_offered_overwrite,
        test_deleted_since_the_page_loaded,
        test_a_pre_deploy_tab_is_still_compare_and_swapped,
        test_a_create_is_a_create_only_claim,
        test_switching_atlases_never_reads_as_a_settings_conflict,
        test_the_dispatcher_answers_409_and_hands_back_versions,
        test_presence_names_who_is_editing,
        test_a_page_never_learns_a_version_it_only_read,
        test_a_page_edit_r2_did_not_take_is_refused_not_answered_ok,
        test_r2s_transient_409_is_retried,
        test_a_staged_copy_of_unknown_origin_never_beats_r2,
        test_a_machine_write_that_loses_a_race_is_rebased_not_dropped,
        test_rebase_rules,
        test_side_effects_wait_for_the_precheck,
        test_two_saves_in_one_request_do_not_conflict_with_each_other,
        test_an_unstamped_doc_is_never_merged_on_rev,
        test_new_atlas_replace_needs_the_version_shown,
        test_the_page_wrapper,
    ):
        _say(f"\n-- {fn.__name__}")
        fn()
    _say(f"\n{len(PASSED)} passed, {len(FAILED)} failed")
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
