"""Offline guard: an R2 write that did not land is reported, not swallowed.

Run:  PYTHONPATH=".;../_shared" py test_r2_push_failures.py   (from services/atlas-tool)

After every ref-mutating POST (`_REF_MUTATING_ROUTES`: a ref upload, "use my
image", an FX build, a variant delete, ...) the server re-pushes the staging
`input/` tree to R2, the source of truth. That push ran AFTER the 200 was on the
wire, and every failure was swallowed three times over: per file in
`iw_common.storage.push_dir`, around the call in the request handler, and in
`_unmirror` (whose `storage.delete` swallowed too). A read-only token or an R2
outage therefore answered "Reference set" for a change that lived only on this
container's disk — gone on the next deploy.

Now the push runs BEFORE the answer, and a failure turns the answer into the
page's error card (`✖` + detail + `→ Fix:`, what `flashDiag` renders) plus an
`X-IW-R2-Failed` header. No R2 credentials at all is a local run, not a loss:
nothing is attempted and nothing reported.

No R2 and no GPU: `put` / `delete` are replaced with fakes.
ASCII only in the labels (cp1252 console).
"""
from __future__ import annotations

import http.client
import os
import sys
import tempfile
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path

os.environ["ATLAS_STAGING"] = tempfile.mkdtemp(prefix="r2-push-failures-")
for _k in ("ATLAS_TOOL_SIGNING_SECRET", "ATLAS_TOOL_SECRET"):
    os.environ.pop(_k, None)

from iw_common import storage as shared_storage  # noqa: E402

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


def check_in(label: str, needle: str, haystack: str) -> None:
    ok = needle in haystack
    _say(f"{'ok  ' if ok else 'FAIL'} {label}")
    (PASSED if ok else FAILED).append(label)
    if not ok:
        _say(f"       {needle!r} not found in:\n       {haystack!r}")


# --------------------------------------------------------------------------
# 1. iw_common.storage reports what it could not write
# --------------------------------------------------------------------------
def test_push_dir_collects_its_failures() -> None:
    root = Path(tempfile.mkdtemp(prefix="push-dir-"))
    (root / "refs").mkdir()
    (root / "refs" / "good.png").write_bytes(b"g")
    (root / "refs" / "bad.png").write_bytes(b"b")
    written: list[str] = []

    def fake_put(key, body, content_type=None, **kw):
        if key.endswith("bad.png"):
            raise PermissionError("AccessDenied")
        written.append(key)

    real_put = shared_storage.put
    shared_storage.put = fake_put
    try:
        failures: list[str] = []
        n = shared_storage.push_dir(root, "acme/p/input", failures=failures)
        check("the good file is pushed", (n, written), (1, ["acme/p/input/refs/good.png"]))
        check("the failed one is reported, with its key and why",
              failures, ["acme/p/input/refs/bad.png: PermissionError: AccessDenied"])
        written.clear()
        check("a caller that passes no list still never raises",
              shared_storage.push_dir(root, "acme/p/input"), 1)
    finally:
        shared_storage.put = real_put


def test_delete_says_whether_it_landed() -> None:
    class Cli:
        def __init__(self, fail): self.fail = fail

        def delete_object(self, **kw):
            if self.fail:
                raise ConnectionError("R2 down")

    real_client, real_bucket = shared_storage._client, shared_storage._bucket
    shared_storage._bucket = lambda: "b"
    try:
        shared_storage._client = lambda: Cli(False)
        check("an accepted delete is True", shared_storage.delete("k"), True)
        shared_storage._client = lambda: Cli(True)
        check("a refused delete is False, still without raising",
              shared_storage.delete("k"), False)
    finally:
        shared_storage._client, shared_storage._bucket = real_client, real_bucket


def test_configured_needs_every_credential() -> None:
    keys = ("R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET")
    saved = {k: os.environ.get(k) for k in keys}
    try:
        for k in keys:
            os.environ[k] = "x"
        check("all four set: configured", shared_storage.configured(), True)
        os.environ.pop("R2_BUCKET")
        check("one missing: not configured", shared_storage.configured(), False)
    finally:
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


# --------------------------------------------------------------------------
# 2. ui_server: the push result reaches the answer
# --------------------------------------------------------------------------
class _FakeR2:
    """Swap the storage seams ui_server uses; `fail` = keys to refuse."""

    def __init__(self, configured: bool = True, fail_push: bool = False,
                 fail_delete: bool = False):
        self.configured, self.fail_push, self.fail_delete = configured, fail_push, fail_delete
        self.pushes = 0

    def __enter__(self):
        self._saved = (storage.configured, storage.push_dir, storage.delete)
        storage.configured = lambda: self.configured

        def push_dir(src_root, key_root, failures=None):
            self.pushes += 1
            if self.fail_push and failures is not None:
                failures.append(f"{key_root}/refs/x.png: ClientError: AccessDenied")
            return 0

        storage.push_dir = push_dir
        storage.delete = lambda key: not self.fail_delete
        return self

    def __exit__(self, *exc):
        storage.configured, storage.push_dir, storage.delete = self._saved


def test_no_r2_is_a_local_run_not_a_failure() -> None:
    with _FakeR2(configured=False, fail_push=True) as r2:
        check("nothing is reported", u.push_input_refs(), [])
        check("and nothing is attempted", r2.pushes, 0)
    check("a message with no failures is left exactly as it was",
          u.with_r2_failures("Reference set for H1", []), "Reference set for H1")


def test_failures_become_the_error_card() -> None:
    with _FakeR2(fail_push=True):
        failed = u.push_input_refs()
    check("the push failure comes back", len(failed), 1)
    msg = u.with_r2_failures("Reference set for H1", failed)
    check("it leads with the error glyph flashDiag turns into a card", msg[:1], "✖")
    check_in("keeps the route's own answer", "Reference set for H1", msg)
    check_in("names the file", "refs/x.png", msg)
    check_in("and carries a Fix line", "→ Fix:", msg)
    many = u.with_r2_failures("ok", [f"k{i}: E" for i in range(9)])
    check_in("a long list is capped and counted", "and 4 more", many)


def _serve():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), u.Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def _post(port: int, path: str):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=30)
    c.request("POST", path, body=b'{"name":"H1"}', headers={"Content-Type": "application/json"})
    r = c.getresponse()
    out = (r.status, r.getheader("X-IW-R2-Failed"), r.read().decode("utf-8"))
    c.close()
    return out


def test_every_ref_route_answers_after_its_push() -> None:
    """Every route in the table, through the real server: success is answered
    verbatim, a failed push is in the answer. The handlers are stubbed — this is
    about the dispatch, which used to answer first and push after."""
    saved = {route: getattr(u.Handler, meth) for route, meth in u._REF_MUTATING_ROUTES.items()}
    for route, meth in u._REF_MUTATING_ROUTES.items():
        setattr(u.Handler, meth, lambda self, payload, _r=route: f"done {_r}")
    srv = _serve()
    port = srv.server_address[1]
    try:
        with _FakeR2() as r2:
            for route in sorted(u._REF_MUTATING_ROUTES):
                check(f"{route}: a landed push answers plain success",
                      _post(port, route), (200, None, f"done {route}"))
            check("each of them pushed", r2.pushes, len(u._REF_MUTATING_ROUTES))
        with _FakeR2(fail_push=True):
            for route in sorted(u._REF_MUTATING_ROUTES):
                status, header, body = _post(port, route)
                check(f"{route}: a failed push is an error answer",
                      (status, header, body[:1]), (200, "1", "✖"))
                check_in(f"{route}: still saying what it did", f"done {route}", body)
    finally:
        srv.shutdown()
        for route, fn in saved.items():
            setattr(u.Handler, u._REF_MUTATING_ROUTES[route], fn)


def test_a_refused_r2_delete_is_in_the_answer() -> None:
    """`/clearoutput` deletes the old "my image" from R2 via `_unmirror`; a
    refused delete leaves it to come back on the next hydrate."""
    real = u.Handler._clearoutput

    def clearoutput(self, payload):
        u._unmirror(u.INPUT_DIR / "refs" / "useroutput_H1.png")
        return "Reverted H1"

    u.Handler._clearoutput = clearoutput
    srv = _serve()
    try:
        with _FakeR2(fail_delete=True):
            status, header, body = _post(srv.server_address[1], "/clearoutput")
        check("the refused delete makes it an error answer", (header, body[:1]), ("1", "✖"))
        check_in("naming the R2 key", "refs/useroutput_H1.png: delete refused", body)
        with _FakeR2():
            check("an accepted delete is plain success",
                  _post(srv.server_address[1], "/clearoutput"), (200, None, "Reverted H1"))
    finally:
        srv.shutdown()
        u.Handler._clearoutput = real


def test_a_failure_does_not_leak_into_the_next_request() -> None:
    u._reset_request_local()
    u._note_r2_failure("acme/p/input/a.png: delete refused")
    check("noted for this request", len(u._r2_failures()), 1)
    seen: list = []
    t = threading.Thread(target=lambda: seen.append(u._r2_failures()))
    t.start()
    t.join()
    check("another request thread does not see it", seen, [[]])
    u._reset_request_local()
    check("and the next request on this thread starts clean", u._r2_failures(), [])


if __name__ == "__main__":
    for fn in (test_push_dir_collects_its_failures,
               test_delete_says_whether_it_landed,
               test_configured_needs_every_credential,
               test_no_r2_is_a_local_run_not_a_failure,
               test_failures_become_the_error_card,
               test_every_ref_route_answers_after_its_push,
               test_a_refused_r2_delete_is_in_the_answer,
               test_a_failure_does_not_leak_into_the_next_request):
        print(f"\n-- {fn.__name__}")
        fn()
    print(f"\n{len(PASSED)} passed, {len(FAILED)} failed")
    sys.exit(1 if FAILED else 0)
