"""Offline checks for the Sheet Maker's compare-and-swap saves (no R2, no network).

    PYTHONPATH=".;../_shared" py test_doc_conflicts.py     (from services/sheet-tool)

No framework, same as the other sheet-tool fixtures. What is under test cannot be
seen in the UI: a save that silently replaced somebody else's sheet looks exactly
like one that replaced nothing. So R2 is a dict with real ETags and real
preconditions (`If-Match` / `If-None-Match: *` raise the genuine
`storage.Conflict`), and every check asks what LANDED in it.

The sheet's version is its manifest's ETag (`manifests/atlas_manifest_<S>.json`);
a save states the version it replaces and lands only on that one.
"""
from __future__ import annotations

import http.client
import io
import json
import os
import plistlib
import sys
import tempfile
import threading
import time
from http.server import ThreadingHTTPServer
from pathlib import Path

_STAGING = tempfile.mkdtemp(prefix="sheet-cas-")
os.environ["SHEET_STAGING"] = _STAGING
os.environ["SHEET_CLIENT"] = "invisible_wall"
os.environ["SHEET_PROJECT"] = "testproj"
# Versioning is on only when a bucket is configured; every storage call is faked.
os.environ["R2_BUCKET"] = "fake-bucket"
for _k in ("SHEET_TOOL_SIGNING_SECRET", "SHEET_TOOL_SECRET"):
    os.environ.pop(_k, None)

from PIL import Image  # noqa: E402

import sheet_server  # noqa: E402
import storage  # noqa: E402
from iw_common import launch  # noqa: E402

FAILED: list[str] = []
PREFIX = "invisible_wall/testproj"
ROOT = Path(_STAGING) / "invisible_wall" / "testproj"


def check(label: str, got, want) -> None:
    ok = got == want
    print(f"{'ok  ' if ok else 'FAIL'} {label}")
    if not ok:
        print(f"       got  {got!r}\n       want {want!r}")
        FAILED.append(label)


class FakeR2:
    """An R2 whose objects live in a dict, with ETags and conditional puts."""

    def __init__(self) -> None:
        self.objs: dict[str, tuple[bytes, str]] = {}
        self.lock = threading.Lock()
        self.n = 0
        self.puts: list[tuple[str, str | None, str | None]] = []
        self.before_put = None          # hook(fake, key, if_match, if_none_match)
        self.read_delay = 0.0
        self.unreadable = False
        self.unlistable: tuple[str, ...] = ()

    def _next(self) -> str:
        self.n += 1
        return f'"etag{self.n}"'

    def set_doc(self, key: str, doc: dict) -> str:
        """An out-of-band writer (another container, the Atlas Maker)."""
        with self.lock:
            etag = self._next()
            self.objs[key] = (json.dumps(doc, indent=2).encode("utf-8"), etag)
            return etag

    def doc(self, key: str):
        o = self.objs.get(key)
        return json.loads(o[0]) if o else None

    def etag(self, key: str) -> str | None:
        o = self.objs.get(key)
        return o[1] if o else None

    def get_with_etag(self, key: str):
        if self.unreadable:
            raise storage.ObjectUnreadable(f"{key}: throttled")
        if self.read_delay:
            time.sleep(self.read_delay)
        with self.lock:
            o = self.objs.get(key)
        return None if o is None else (o[0], o[1])

    def put(self, key, body, content_type=None, *, if_match=None, if_none_match=None):
        hook = self.before_put
        if hook:
            hook(self, key, if_match, if_none_match)
        with self.lock:
            cur = self.objs.get(key)
            if if_match and (cur is None or cur[1] != if_match):
                raise storage.Conflict(key)
            if if_none_match == "*" and cur is not None:
                raise storage.Conflict(key)
            etag = self._next()
            self.objs[key] = (bytes(body), etag)
            self.puts.append((key, if_match, if_none_match))
            return etag

    def push_file(self, p, key) -> bool:
        if not Path(p).exists():
            return False
        self.put(key, Path(p).read_bytes())
        return True

    def get(self, key):
        o = self.objs.get(key)
        return o[0] if o else None

    def get_strict(self, key):
        return self.get(key)

    def head(self, key):
        o = self.objs.get(key)
        return {"size": len(o[0]), "etag": o[1].strip('"'), "mtime": 0.0} if o else None

    def exists(self, key) -> bool:
        return key in self.objs

    def delete(self, key) -> None:
        with self.lock:
            self.objs.pop(key, None)

    def list_keys(self, prefix, complete=True):
        if any(u in prefix for u in self.unlistable):
            raise storage.ObjectUnreadable(f"{prefix}: throttled")
        with self.lock:
            return [{"key": k, "size": len(v[0]), "mtime": 0.0}
                    for k, v in sorted(self.objs.items()) if k.startswith(prefix)]

    def list_prefixes(self, prefix, complete=True):
        return []

    def pull_prefix(self, *a, **kw) -> int:
        return 0


FAKE = FakeR2()
_SHIM_MISSING: list[str] = []
for _name in ("get_with_etag", "put", "push_file", "get", "get_strict", "head", "exists",
              "delete", "list_keys", "list_prefixes", "pull_prefix"):
    # Only fake what the shim really exports — faking a missing name would hide
    # an AttributeError the server hits in production.
    if not hasattr(storage, _name):
        _SHIM_MISSING.append(_name)
    setattr(storage, _name, getattr(FAKE, _name))

COMPOSES = [0]
_real_compose = sheet_server.packer.compose


def _counting_compose(*a, **kw):
    COMPOSES[0] += 1
    return _real_compose(*a, **kw)


sheet_server.packer.compose = _counting_compose


def man_key(s: str) -> str:
    return f"{PREFIX}/manifests/atlas_manifest_{s}.json"


def page_key(s: str) -> str:
    return f"{PREFIX}/sheets/{s}/{s}.png"


def as_user(name: str) -> None:
    sheet_server.set_request_identity(
        launch.Identity(via="token", sub=f"u_{name.lower()}", name=name))


def seed(sheet: str) -> None:
    d = ROOT / "sheet_src" / sheet
    d.mkdir(parents=True, exist_ok=True)
    Image.new("RGBA", (16, 16), (255, 0, 0, 255)).save(d / "a.png")


def export(sheet: str, base, who: str, x: int = 0) -> dict:
    as_user(who)
    return sheet_server.api_export({
        "sheet": sheet, "canvas_w": 64, "canvas_h": 64, "formats": {"manifest": True},
        "regions": [{"src": "a.png", "name": "a", "x": x, "y": 0, "w": 16, "h": 16}],
        "base_etag": base,
    })


def region_x(sheet: str):
    doc = FAKE.doc(man_key(sheet)) or {}
    regs = doc.get("regions") or []
    return regs[0].get("x") if regs else None


def page_pushes(sheet: str) -> int:
    return sum(1 for k, _, _ in FAKE.puts if k == page_key(sheet))


def norm(e) -> str:
    return str(e or "").strip('"')


def test_create_and_load() -> None:
    seed("S1")
    res = export("S1", "", "Alice")
    check("a new sheet saves", "etag" in res and not res.get("conflict"), True)
    check("...as a create-only write (If-None-Match: *)",
          [p for p in FAKE.puts if p[0] == man_key("S1")][-1][1:], (None, "*"))
    check("...returning the new version", res.get("etag"), norm(FAKE.etag(man_key("S1"))))
    check("...stamped with who saved it",
          ((res.get("saved_by") or {}).get("name"), (res.get("saved_by") or {}).get("tool")),
          ("Alice", "sheet"))
    check("...and the stamp is IN the stored manifest",
          (FAKE.doc(man_key("S1")) or {}).get("saved_by", {}).get("name"), "Alice")

    got = sheet_server.api_load_sheet({"sheet": "S1"})
    check("load returns the version it loaded", got.get("etag"), norm(FAKE.etag(man_key("S1"))))
    check("...and who saved it", (got.get("saved_by") or {}).get("name"), "Alice")

    # An out-of-band save (the Atlas Maker) is picked up by the next load: the
    # staged copy is rewritten from R2 so coords and version describe one object.
    doc = FAKE.doc(man_key("S1"))
    doc["saved_by"] = {"name": "Carol", "tool": "atlas", "rev": "r1"}
    doc["regions"][0]["x"] = 7
    FAKE.set_doc(man_key("S1"), doc)
    got = sheet_server.api_load_sheet({"sheet": "S1"})
    staged = (ROOT / "manifests" / "atlas_manifest_S1.json").read_bytes()
    check("a load re-syncs a stale staged manifest", staged, FAKE.objs[man_key("S1")][0])
    check("...reports the NEW version", got.get("etag"), norm(FAKE.etag(man_key("S1"))))
    check("...and the coords it returns are from those bytes", got["regions"][0]["x"], 7)

    got = sheet_server.api_load({"sheet": "work",
                                 "path": str(ROOT / "manifests" / "atlas_manifest_S1.json")})
    check("the manifest browser load reports the version too",
          (got.get("etag"), (got.get("saved_by") or {}).get("name")),
          (norm(FAKE.etag(man_key("S1"))), "Carol"))

    FAKE.unreadable = True
    try:
        got = sheet_server.api_load_sheet({"sheet": "S1"})
    finally:
        FAKE.unreadable = False
    check("R2 unreadable at load -> version unknown, etag empty",
          (got.get("etag"), got.get("version_unknown"), "error" in got), ("", True, False))
    res = export("S1", got.get("etag"), "Alice")
    check("...so its save is a create, refused on the existing sheet",
          (res.get("conflict"), res.get("reason")), (True, "exists"))


def test_two_writer_race() -> None:
    e0 = sheet_server.api_load_sheet({"sheet": "S1"})["etag"]
    b0 = sheet_server.api_load_sheet({"sheet": "S1"})["etag"]
    check("both writers load the same version", e0, b0)
    a = export("S1", e0, "Alice", x=0)
    check("A's in-place save lands", a.get("conflict"), None)
    check("...with a new version", a.get("etag") not in ("", e0), True)
    check("...stamped Alice", (a.get("saved_by") or {}).get("name"), "Alice")

    pushes, composes = page_pushes("S1"), COMPOSES[0]
    page_before = (ROOT / "sheets" / "S1" / "S1.png").read_bytes()
    b = export("S1", b0, "Bob", x=30)
    check("B's save on the overtaken version is a conflict",
          (b.get("conflict"), b.get("reason"), b.get("overwritable")), (True, "stale", True))
    check("...that names A", (b.get("saved_by") or {}).get("name"), "Alice")
    check("...and offers A's version to overwrite ON", b.get("etag"), a.get("etag"))
    check("...answered as HTTP 409", sheet_server.status_for(b), 409)
    check("...B's coords did NOT land", region_x("S1"), 0)
    check("...the page was not re-composed", COMPOSES[0], composes)
    check("...nor re-pushed", page_pushes("S1"), pushes)
    check("...nor rewritten in staging",
          (ROOT / "sheets" / "S1" / "S1.png").read_bytes() == page_before, True)

    b2 = export("S1", b["etag"], "Bob", x=30)
    check("B's 'Overwrite with mine' (on the version shown) lands", b2.get("conflict"), None)
    check("...B's coords are in R2 now", region_x("S1"), 30)
    check("...stamped Bob", (FAKE.doc(man_key("S1")) or {}).get("saved_by", {}).get("name"),
          "Bob")


def test_save_as() -> None:
    before = len(FAKE.puts)
    res = export("S1", "", "Carol", x=40)
    check("Save As onto a taken name is an EXISTS conflict",
          (res.get("conflict"), res.get("reason")), (True, "exists"))
    check("...naming who holds it", (res.get("saved_by") or {}).get("name"), "Bob")
    check("...with nothing written", len(FAKE.puts), before)
    res = export("S1", res.get("etag"), "Carol", x=40)
    check("'Replace' with the shown version lands", (res.get("conflict"), region_x("S1")),
          (None, 40))

    seed("S2")
    res = export("S2", "", "Carol")
    check("Save As onto a free name creates it",
          (res.get("conflict"), [p for p in FAKE.puts if p[0] == man_key("S2")][-1][2]),
          (None, "*"))

    seed("S9")
    gone = export("S9", "", "Carol")
    FAKE.delete(man_key("S9"))
    res = export("S9", gone.get("etag"), "Carol")
    check("saving a sheet deleted since it was opened is a DELETED conflict",
          (res.get("conflict"), res.get("reason")), (True, "deleted"))
    res = export("S9", "", "Carol")
    check("...'Save it again' (a create) lands", res.get("conflict"), None)


def test_put_time_conflict() -> None:
    seed("S3")
    e = export("S3", "", "Alice")["etag"]
    composes = COMPOSES[0]

    def other_container(fake, key, if_match, if_none_match):
        if key == man_key("S3") and if_match:
            fake.before_put = None
            doc = fake.doc(key)
            doc["saved_by"] = {"name": "Dan", "tool": "atlas", "rev": "d1"}
            fake.set_doc(key, doc)

    page_before = FAKE.objs[page_key("S3")]
    pushes = page_pushes("S3")
    FAKE.before_put = other_container
    res = export("S3", e, "Alice", x=12)
    FAKE.before_put = None
    check("a write R2 refuses after the pre-check passed reports STALE",
          (res.get("conflict"), res.get("reason")), (True, "stale"))
    check("...naming the writer that got there (re-read)",
          ((res.get("saved_by") or {}).get("name"), (res.get("saved_by") or {}).get("tool")),
          ("Dan", "atlas"))
    check("...whose manifest survives", (FAKE.doc(man_key("S3")) or {}).get(
        "saved_by", {}).get("name"), "Dan")
    check("...the page was composed locally before the refusal", COMPOSES[0], composes + 1)
    check("...but R2's page is untouched (pushed only after the manifest lands)",
          (FAKE.objs[page_key("S3")] == page_before, page_pushes("S3")), (True, pushes))
    check("...and staging is restored to R2's page",
          (ROOT / "sheets" / "S3" / "S3.png").read_bytes(), page_before[0])

    order = [k for k, _, _ in FAKE.puts if k in (man_key("S3"), page_key("S3"))]
    ok = export("S3", res.get("etag"), "Alice", x=12)
    after = [k for k, _, _ in FAKE.puts if k in (man_key("S3"), page_key("S3"))][len(order):]
    check("a landing save writes the manifest BEFORE pushing the page",
          (ok.get("conflict"), after), (None, [man_key("S3"), page_key("S3")]))


def test_rename() -> None:
    FAKE.set_doc(man_key("T"), {"regions": [], "saved_by": {"name": "Zed", "tool": "sheet"}})
    before = {k for k in FAKE.objs if "/S1" in k}
    res = sheet_server.api_rename_sheet({"from": "S1", "to": "T"})
    check("rename onto a name held in R2 (not in staging) is refused",
          "already exists" in (res.get("error") or ""), True)
    check("...naming who holds it", "Zed" in (res.get("error") or ""), True)
    check("...nothing copied", [k for k in FAKE.objs if "/sheets/T/" in k], [])
    check("...nothing deleted", {k for k in FAKE.objs if "/S1" in k} >= before, True)
    check("...the target is untouched", (FAKE.doc(man_key("T")) or {}).get(
        "saved_by", {}).get("name"), "Zed")

    res = sheet_server.api_rename_sheet({"from": "S1", "to": "U", "base_etag": "stale"})
    check("rename with an overtaken base is a STALE conflict",
          (res.get("conflict"), res.get("reason"), bool(res.get("error"))),
          (True, "stale", True))
    check("...answered as 409", sheet_server.status_for(res), 409)
    check("...nothing created", FAKE.etag(man_key("U")), None)

    cur = norm(FAKE.etag(man_key("S1")))
    as_user("Erin")
    res = sheet_server.api_rename_sheet({"from": "S1", "to": "U", "base_etag": cur})
    check("rename with the current base succeeds", res.get("ok"), True)
    check("...the new manifest is claimed and stamped",
          (FAKE.doc(man_key("U")) or {}).get("saved_by", {}).get("name"), "Erin")
    check("...returning its version", res.get("etag"), norm(FAKE.etag(man_key("U"))))
    check("...the page moved", page_key("U") in FAKE.objs, True)
    check("...the old name is gone", ([k for k in FAKE.objs if "/S1" in k],
                                       FAKE.etag(man_key("S1"))), ([], None))

    def saved_during_rename(fake, key, if_match, if_none_match):
        if key == man_key("V") and if_none_match:
            fake.before_put = None
            doc = fake.doc(man_key("S2"))
            doc["saved_by"] = {"name": "Finn", "tool": "sheet", "rev": "f1"}
            fake.set_doc(man_key("S2"), doc)

    FAKE.before_put = saved_during_rename
    res = sheet_server.api_rename_sheet({"from": "S2", "to": "V"})
    FAKE.before_put = None
    check("an old name saved WHILE the rename ran is kept",
          (res.get("ok"), res.get("kept_old")), (True, True))
    check("...its newest manifest survives", (FAKE.doc(man_key("S2")) or {}).get(
        "saved_by", {}).get("name"), "Finn")
    check("...and its page", page_key("S2") in FAKE.objs, True)
    check("...the copy exists too", FAKE.etag(man_key("V")) is not None, True)


def _write_session(name: str, etag: str) -> None:
    (ROOT / "sheet_session.json").write_text(json.dumps({
        "version": 1, "sheet": name, "active_sheet": name, "regions": [],
        "loaded": {"name": name, "etag": etag, "is_project": True}}), encoding="utf-8")


def _session_loaded() -> dict:
    return json.loads((ROOT / "sheet_session.json").read_text(encoding="utf-8"))["loaded"]


def _png(rgb: tuple[int, int, int]) -> bytes:
    buf = io.BytesIO()
    Image.new("RGBA", (64, 64), (*rgb, 255)).save(buf, format="PNG")
    return buf.getvalue()


def test_rename_follows_r2() -> None:
    # The session is shared per project: its canvas may be from ANY version.
    seed("R1")
    e = export("R1", "", "Ivy")["etag"]
    _write_session("R1", e)
    res = sheet_server.api_rename_sheet({"from": "R1", "to": "R1b"})
    check("a session on the MOVED version inherits the new key's version",
          (_session_loaded().get("name"), _session_loaded().get("etag")), ("R1b", res.get("etag")))

    seed("R2")
    export("R2", "", "Ivy")
    _write_session("R2", "some-older-version")
    res = sheet_server.api_rename_sheet({"from": "R2", "to": "R2b"})
    check("a session on an OLDER version gets no version (its next save is a create)",
          (res.get("ok"), _session_loaded().get("name"), _session_loaded().get("etag")),
          (True, "R2b", ""))

    # Another writer exported R3 after this container hydrated: R2's manifest
    # and page are newer than staging's. The copy must carry R2's page, not the
    # stale staged one, beside R2's coords.
    seed("R3")
    export("R3", "", "Ivy")
    fresh = _png((0, 255, 0))
    FAKE.put(page_key("R3"), fresh)
    doc = FAKE.doc(man_key("R3"))
    doc["regions"][0]["x"] = 5
    FAKE.set_doc(man_key("R3"), doc)
    (ROOT / "sheets" / "R3" / "gone.atlas").write_text("stale", encoding="utf-8")
    res = sheet_server.api_rename_sheet({"from": "R3", "to": "R3b"})
    check("rename after an out-of-band save succeeds", res.get("ok"), True)
    check("...copying R2's page, not the stale staged one",
          ((ROOT / "sheets" / "R3b" / "R3b.png").read_bytes() == fresh,
           FAKE.get(page_key("R3b")) == fresh), (True, True))
    check("...beside R2's coords", region_x("R3b"), 5)
    check("...and nothing R2 had dropped", FAKE.get(f"{PREFIX}/sheets/R3b/gone.atlas"), None)

    seed("R4")
    export("R4", "", "Ivy")
    FAKE.set_doc(man_key("R4"), dict(FAKE.doc(man_key("R4")), note="newer"))
    FAKE.unlistable = ("/sheets/R4/",)
    try:
        res = sheet_server.api_rename_sheet({"from": "R4", "to": "R4b"})
    finally:
        FAKE.unlistable = ()
    check("a stale sheet whose files cannot be re-read is refused",
          "could not be re-read" in (res.get("error") or ""), True)
    check("...before anything was claimed or copied",
          (FAKE.etag(man_key("R4b")), (ROOT / "sheets" / "R4b").exists()), (None, False))
    check("...and the old sheet is intact", FAKE.etag(man_key("R4")) is not None, True)


def _plist_files(name: str) -> list[dict]:
    frame = {"aliases": [], "spriteOffset": "{0,0}", "spriteSize": "{16,16}",
             "spriteSourceSize": "{16,16}", "textureRect": "{{0,0},{16,16}}",
             "textureRotated": False}
    meta = {"format": 3, "pixelFormat": "RGBA8888", "premultiplyAlpha": False,
            "realTextureFileName": f"{name}.png", "size": "{64,64}",
            "textureFileName": f"{name}.png"}
    buf = io.BytesIO()
    plistlib.dump({"frames": {"f_00.png": frame}, "metadata": meta}, buf)
    png = io.BytesIO()
    Image.new("RGBA", (64, 64), (0, 0, 255, 255)).save(png, format="PNG")
    return [{"field": "plist", "filename": f"{name}.plist", "data": buf.getvalue()},
            {"field": "page", "filename": f"{name}.png", "data": png.getvalue()}]


def test_import() -> None:
    as_user("Gia")
    before = len(FAKE.puts)
    res = sheet_server.api_import_plist({"sheet": "U"}, _plist_files("U"))
    check("an import onto an existing sheet is an EXISTS conflict",
          (res.get("conflict"), res.get("reason")), (True, "exists"))
    check("...nothing written", len(FAKE.puts), before)
    res = sheet_server.api_import_plist({"sheet": "U", "base_etag": res.get("etag")},
                                        _plist_files("U"))
    check("...confirmed with the shown version, it lands",
          (res.get("conflict"), "error" in res), (None, False))
    check("...stamped", (FAKE.doc(man_key("U")) or {}).get("saved_by", {}).get("name"), "Gia")
    res = sheet_server.api_import_plist({"sheet": "W"}, _plist_files("W"))
    check("an import onto a free name creates it",
          (res.get("etag"), [p for p in FAKE.puts if p[0] == man_key("W")][-1][2]),
          (norm(FAKE.etag(man_key("W"))), "*"))


def test_unlock() -> None:
    check("W imported locked", (FAKE.doc(man_key("W")) or {}).get("locked"), True)
    attempts = []

    def concurrent(fake, key, if_match, if_none_match):
        if key == man_key("W"):
            attempts.append(if_match)
            if len(attempts) == 1:
                doc = fake.doc(key)
                doc["note"] = "someone else"
                fake.set_doc(key, doc)

    FAKE.before_put = concurrent
    as_user("Hal")
    res = sheet_server.api_unlock_sheet({"sheet": "W"})
    FAKE.before_put = None
    check("unlock retries through a concurrent write", (res.get("locked"), "error" in res),
          (False, False))
    check("...took two attempts", len(attempts), 2)
    doc = FAKE.doc(man_key("W")) or {}
    check("...kept the other write AND unlocked",
          (doc.get("note"), doc.get("locked"), doc.get("saved_by", {}).get("name")),
          ("someone else", False, "Hal"))
    check("...but offers no version to adopt (the page sent none)", "etag" in res, False)

    # The page's version is what an adoptable etag hinges on. Alice has L open at
    # E1; Bob saves E2; Alice unlocks. The unlock lands on E2 — but if Alice's
    # page took the post-unlock version, her next Save (a canvas from E1) would
    # silently replace Bob's work.
    lock_doc = dict(doc, locked=True)
    e1 = norm(FAKE.set_doc(man_key("L"), lock_doc))
    bob = dict(lock_doc, saved_by={"name": "Bob", "tool": "sheet", "rev": "b2"})
    FAKE.set_doc(man_key("L"), bob)
    as_user("Alice")
    res = sheet_server.api_unlock_sheet({"sheet": "L", "base_etag": e1})
    check("unlock on a version the page never saw still unlocks",
          ((FAKE.doc(man_key("L")) or {}).get("locked"), "error" in res), (False, False))
    check("...but returns NO etag to adopt", "etag" in res, False)
    check("...so the page's next Save (still based on E1) conflicts",
          sheet_server._check_base("L", e1)[1].get("reason"), "stale")

    cur = norm(FAKE.set_doc(man_key("L"), lock_doc))
    res = sheet_server.api_unlock_sheet({"sheet": "L", "base_etag": cur})
    check("unlock on exactly the page's version returns the version it wrote",
          res.get("etag"), norm(FAKE.etag(man_key("L"))))

    res = sheet_server.api_unlock_sheet({"sheet": "L", "base_etag": e1})
    check("'was not locked' with a stale base returns no etag either",
          (res.get("locked"), "etag" in res), (False, False))
    cur = norm(FAKE.etag(man_key("L")))
    res = sheet_server.api_unlock_sheet({"sheet": "L", "base_etag": cur})
    check("...and with the current base returns it", res.get("etag"), cur)


def test_lock_serialises_one_sheet() -> None:
    seed("S5")
    e0 = export("S5", "", "Alice")["etag"]

    def race() -> tuple[list[dict], int]:
        start = COMPOSES[0]
        out: list[dict] = []
        gate = threading.Barrier(2)

        def run(who: str, x: int) -> None:
            gate.wait()
            out.append(export("S5", e0, who, x))

        FAKE.read_delay = 0.2
        ts = [threading.Thread(target=run, args=(w, x)) for w, x in (("Ann", 0), ("Ben", 30))]
        for t in ts:
            t.start()
        for t in ts:
            t.join()
        FAKE.read_delay = 0.0
        return out, COMPOSES[0] - start

    out, composed = race()
    landed = [r for r in out if not r.get("conflict")]
    lost = [r for r in out if r.get("conflict")]
    check("two threads, one version: exactly one save lands", (len(landed), len(lost)), (1, 1))
    check("...the other is a STALE conflict naming the winner",
          (lost[0].get("reason") if lost else None,
           (lost[0].get("saved_by") or {}).get("name") if lost else None),
          ("stale", (landed[0].get("saved_by") or {}).get("name") if landed else "?"))
    check("...and the loser never composed (the lock held it at the pre-check)", composed, 1)

    # Mutant: without the per-sheet lock both threads pass the pre-check and both
    # compose — R2's precondition still refuses one manifest, but only after its
    # page was written. Proves the check above can see the lock.
    real_guard = sheet_server._sheet_guard
    import contextlib
    sheet_server._sheet_guard = lambda *s: contextlib.nullcontext()
    try:
        e0 = norm(FAKE.etag(man_key("S5")))
        out, composed = race()
    finally:
        sheet_server._sheet_guard = real_guard
    check("(mutant) without the lock both compose", composed, 2)


def _post(port: int, path: str, body: dict):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=30)
    c.request("POST", path, body=json.dumps(body), headers={"Content-Type": "application/json"})
    r = c.getresponse()
    out = (r.status, json.loads(r.read() or b"{}"))
    c.close()
    return out


def test_http_status() -> None:
    check("status_for: a conflict is 409", sheet_server.status_for({"conflict": True}), 409)
    check("status_for: an error stays 200", sheet_server.status_for({"error": "x"}), 200)
    srv = ThreadingHTTPServer(("127.0.0.1", 0), sheet_server.Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    port = srv.server_address[1]
    try:
        payload = {"sheet": "S5", "canvas_w": 64, "canvas_h": 64, "formats": {},
                   "regions": [{"src": "a.png", "name": "a", "x": 0, "y": 0, "w": 16, "h": 16}],
                   "base_etag": "not-the-version"}
        st, body = _post(port, "/api/export", payload)
        check("HTTP: a stale save answers 409", (st, body.get("conflict"), body.get("reason")),
              (409, True, "stale"))
        payload["base_etag"] = body.get("etag")
        st, body = _post(port, "/api/export", payload)
        check("HTTP: a save on the current version answers 200", (st, "etag" in body),
              (200, True))
        st, body = _post(port, "/api/unlock-sheet", {"sheet": "nope"})
        check("HTTP: an ordinary error stays 200", (st, "error" in body), (200, True))
    finally:
        srv.shutdown()


def main() -> int:
    check("the storage shim exports every function the server calls", _SHIM_MISSING, [])
    test_create_and_load()
    test_two_writer_race()
    test_save_as()
    test_put_time_conflict()
    test_rename()
    test_rename_follows_r2()
    test_import()
    test_unlock()
    test_lock_serialises_one_sheet()
    test_http_status()
    print()
    if FAILED:
        print(f"{len(FAILED)} FAILED: " + ", ".join(FAILED))
        return 1
    print("all doc-conflict fixtures pass")
    return 0


if __name__ == "__main__":
    sys.exit(main())
