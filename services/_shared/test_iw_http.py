"""Offline guard for the request-handler base both tools share (iw_common/http.py).

Run:  PYTHONPATH=. py test_iw_http.py     (from services/_shared)

The Atlas Maker's and the Sheet Maker's `Handler` both subclass `ToolHandler`,
so the plumbing every one of their requests goes through is pinned here once,
over a real socket:

  * a refused caller gets the tool's own 403 sentence, with the gate's cookies;
  * a launch GET is answered with the redirect (the token leaves the URL) — a
    POST carrying one is not;
  * an accepted caller's (client, project) reaches the tool's `_switch_context`;
  * `no-store` is the default, a caller's own Cache-Control wins, and
    `no_store=False` sends neither; every gate cookie is its own header.

Plus `storage.mirror_staged`, the write-through skeleton both tools' `_mirror`
share: the R2 key, the claim hook, and that it never raises.
"""
from __future__ import annotations

import http.client
import tempfile
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path

from iw_common import http as iw_http
from iw_common import launch, storage
from iw_common.testkit import Suite

t = Suite()


class FakeGate:
    """`LaunchGate.authenticate`, decided by the path."""

    def authenticate(self, path: str, headers) -> launch.GateResult:
        ident = launch.Identity(via="token", sub="u1", client="acme", project="slots")
        cookies = ["iw_session=abc; Path=/", "iw_client=acme; Path=/"]
        if path.startswith("/refuse"):
            return launch.GateResult(ok=False, identity=None, cookies=["iw_session=; Max-Age=0"])
        if path.startswith("/launch"):
            return launch.GateResult(ok=True, identity=ident, cookies=cookies, redirect="/home")
        return launch.GateResult(ok=True, identity=ident, cookies=cookies)


class Tool(iw_http.ToolHandler):
    gate = FakeGate()
    tool_title = "Test Maker"
    switched: list[tuple] = []

    def _switch_context(self, client, project):
        self.switched.append((client, project))

    def _route(self) -> None:
        if not self._authenticate():
            return
        self._resolve_context()
        if self.path.startswith("/image"):
            self._send(200, "image/png", b"PNG", {"Cache-Control": "max-age=60", "ETag": '"e"'})
        elif self.path.startswith("/json"):
            self._send(200, "application/json", b"{}", no_store=False)
        else:
            self._send(200, "text/plain", b"hello", {"X-Extra": "1"})

    do_GET = do_POST = _route


def _call(port: int, method: str, path: str):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=30)
    c.request(method, path, body=b"" if method == "POST" else None)
    r = c.getresponse()
    out = (r.status, r.getheaders(), r.read())
    c.close()
    return out


def _names(headers) -> list[str]:
    return [k for k, _ in headers if k not in ("Server", "Date")]


def test_the_handler_base_over_http() -> None:
    srv = ThreadingHTTPServer(("127.0.0.1", 0), Tool)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    port = srv.server_address[1]
    try:
        st, hdrs, body = _call(port, "GET", "/refuse")
        t.check("a refusal is a 403 naming the tool to open from the launcher",
                (st, body.decode("utf-8")),
                (403, "Forbidden — open the Test Maker from the launcher."))
        t.check("...carrying the gate's cookie", dict(hdrs).get("Set-Cookie"),
                "iw_session=; Max-Age=0")
        t.check("...and no scope was applied", Tool.switched, [])

        st, hdrs, body = _call(port, "GET", "/launch?iw_launch=tok")
        t.check("a launch GET is answered with the redirect",
                (st, dict(hdrs).get("Location"), body), (303, "/home", b""))
        t.check("...every gate cookie as its own header",
                [v for k, v in hdrs if k == "Set-Cookie"],
                ["iw_session=abc; Path=/", "iw_client=acme; Path=/"])
        st, _, body = _call(port, "POST", "/launch?iw_launch=tok")
        t.check("a POST carrying a launch is served, not redirected", (st, body), (200, b"hello"))

        Tool.switched.clear()
        st, hdrs, body = _call(port, "GET", "/page")
        t.check("an accepted caller is served", (st, body), (200, b"hello"))
        t.check("...in the identity's (client, project)", Tool.switched, [("acme", "slots")])
        t.check("headers in order: type, length, no-store, extras, cookies",
                _names(hdrs), ["Content-Type", "Content-Length", "Cache-Control", "X-Extra",
                               "Set-Cookie", "Set-Cookie"])
        t.check("...no-store by default", dict(hdrs).get("Cache-Control"), "no-store")

        _, hdrs, _ = _call(port, "GET", "/image")
        t.check("a caller's own Cache-Control wins, alone",
                [v for k, v in hdrs if k == "Cache-Control"], ["max-age=60"])
        _, hdrs, _ = _call(port, "GET", "/json")
        t.check("no_store=False sends no Cache-Control at all", "Cache-Control" in dict(hdrs),
                False)
        t.check("...and still the gate's cookies", dict(hdrs).get("Set-Cookie") is not None, True)
    finally:
        srv.shutdown()

    base = iw_http.ToolHandler.__new__(iw_http.ToolHandler)
    try:
        base._switch_context("a", "b")
        raised = False
    except NotImplementedError:
        raised = True
    t.check("a tool must say how it switches context", raised, True)


def test_mirror_staged() -> None:
    staging = Path(tempfile.mkdtemp(prefix="iw-mirror-"))
    f = staging / "manifests" / "m.json"
    f.parent.mkdir(parents=True)
    f.write_text("{}")
    pushed: list[tuple[str, str]] = []

    def push(p: Path, key: str) -> bool:
        pushed.append((p.name, key))
        return True

    storage.mirror_staged(f, staging, "acme/slots", push=push)
    t.check("the key is <prefix>/<path under staging>", pushed, [("m.json", "acme/slots/manifests/m.json")])

    pushed.clear()
    storage.mirror_staged(f, staging, "", push=push)
    storage.mirror_staged(f, "", "acme/slots", push=push)
    storage.mirror_staged(Path(tempfile.gettempdir()) / "elsewhere.png", staging, "acme/slots",
                          push=push)
    t.check("no prefix, no staging, or a path outside staging: nothing is pushed", pushed, [])

    claimed: list[str] = []

    def claim(rel: str, push_once) -> bool:
        claimed.append(rel)
        if rel.startswith("manifests/"):
            return push_once() and True
        return False

    storage.mirror_staged(f, staging, "acme/slots", push=push, claim=claim)
    t.check("a key the claim handles is pushed by it, once",
            (claimed, pushed), (["manifests/m.json"], [("m.json", "acme/slots/manifests/m.json")]))
    pushed.clear()
    loose = staging / "loose.png"
    loose.write_bytes(b"x")
    storage.mirror_staged(loose, staging, "acme/slots", push=push, claim=claim)
    t.check("a key it declines is pushed plainly", pushed, [("loose.png", "acme/slots/loose.png")])

    def boom(p, key):
        raise RuntimeError("R2 down")

    try:
        storage.mirror_staged(f, staging, "acme/slots", push=boom)
        storage.mirror_staged(f, staging, "acme/slots", push=push,
                              claim=lambda rel, once: (_ for _ in ()).throw(OSError("x")))
        quiet = True
    except Exception:  # noqa: BLE001 — what is under test is that nothing escapes
        quiet = False
    t.check("best-effort: a failing push or claim never raises", quiet, True)


if __name__ == "__main__":
    t.run(test_the_handler_base_over_http, test_mirror_staged)
    t.exit("iw_common.http")
