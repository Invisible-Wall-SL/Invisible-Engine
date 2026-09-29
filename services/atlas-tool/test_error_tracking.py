"""Error reporting (iw_common.errors) is inert without a DSN, leaks no secret,
and actually sees the exceptions stdlib http.server would only print.

Run:  py test_error_tracking.py   (from services/atlas-tool, PYTHONPATH=../_shared)
      (also collects under pytest; needs `sentry-sdk` for the end-to-end check)

The three ways this goes wrong are all silent:

  * a local run / a test reporting into the production project, or crashing
    on a box without the package — so no DSN must mean no import at all;
  * the tool's shared secret riding out in an event: the gate accepts it as
    `?k=`, as an `atlas_tool=` cookie and as an `X-Atlas-Secret` header;
  * nothing ever arriving: socketserver catches a handler's exception and
    prints it, and both tools turn most failures into a 500 by hand.
"""
from __future__ import annotations

import os
import subprocess
import sys
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from iw_common import errors

HERE = Path(__file__).resolve().parent
SHARED = HERE.parent / "_shared"
SECRET = "s3cr3t-gate-value-xyz"

FAILED: list[str] = []


def check(label: str, got, want) -> None:
    ok = got == want
    print(f"{'ok  ' if ok else 'FAIL'} {label}")
    if not ok:
        print(f"       got  {got!r}\n       want {want!r}")
        FAILED.append(label)
    assert ok, label


def _run_py(code: str, **env: str) -> str:
    e = {k: v for k, v in os.environ.items() if k != "SENTRY_DSN"}
    e.update(env)
    e["PYTHONPATH"] = os.pathsep.join([str(SHARED), str(HERE)])
    out = subprocess.run([sys.executable, "-c", code], env=e, capture_output=True,
                         text=True, timeout=60)
    return out.stdout.strip() or out.stderr.strip()


def test_no_dsn_is_a_noop() -> None:
    got = _run_py("import sys\n"
                  "from iw_common import errors\n"
                  "r = errors.init_error_tracking('atlas-tool')\n"
                  "errors.capture_error(RuntimeError('x'), route='/')\n"
                  "print(r, errors.enabled(), 'sentry_sdk' in sys.modules)")
    check("no SENTRY_DSN: not started, sentry_sdk never imported",
          got, "False False False")
    got = _run_py("import sys\n"
                  "sys.modules['sentry_sdk'] = None\n"
                  "from iw_common import errors\n"
                  "r = errors.init_error_tracking('atlas-tool')\n"
                  "print(r, errors.enabled())",
                  SENTRY_DSN="https://pub@o0.ingest.sentry.io/0")
    check("a DSN without the package installed is a no-op, not a crash",
          got.splitlines()[-1], "False False")


def test_scrubber() -> None:
    url = errors.scrub_url(f"/atlas?k={SECRET}&client=iw&sid=abc123&project=p")
    check("?k= and sid= are blanked in a URL",
          (SECRET in url, "abc123" in url), (False, False))
    check("...the harmless params survive", ("client=iw" in url, "project=p" in url),
          (True, True))
    os.environ["ATLAS_TOOL_SECRET"] = SECRET
    try:
        event = {
            "message": f"gate cookie atlas_tool={SECRET}; token=t0k3nvalue",
            "request": {"url": f"https://x/y?k={SECRET}",
                        "cookies": {"atlas_tool": SECRET},
                        "headers": {"X-Atlas-Secret": SECRET, "Cookie": "a=b"},
                        "query_string": f"k={SECRET}&a=1"},
            "exception": {"values": [{"type": "RuntimeError",
                                      "value": f"compare failed for {SECRET}"}]},
            "breadcrumbs": {"values": [{
                "category": "httplib",
                "data": {"url": "https://r2/obj?X-Amz-Signature=deadbeef&x=1",
                         "http.query": f"k={SECRET}"}}]},
            "extra": {"password": "hunter22", "ok": "fine"},
        }
        out = errors._before_send(event, {})
    finally:
        os.environ.pop("ATLAS_TOOL_SECRET", None)
    flat = repr(out)
    check("the secret value appears nowhere in the event", SECRET in flat, False)
    check("request cookies + headers are dropped entirely",
          ("cookies" in out["request"], "headers" in out["request"]), (False, False))
    check("a signed-URL signature in a breadcrumb is blanked", "deadbeef" in flat, False)
    check("token= in a message is blanked", "t0k3nvalue" in flat, False)
    check("a sensitive dict key is blanked", out["extra"],
          {"password": errors.FILTERED, "ok": "fine"})


def _record(monkey: list) -> None:
    errors._enabled = True
    errors.capture_error = lambda exc, **tags: monkey.append((exc, tags))  # type: ignore


def test_dispatch_500_reaches_capture() -> None:
    import ui_server

    seen: list = []
    orig, orig_enabled = errors.capture_error, errors._enabled
    _record(seen)
    try:
        class H(ui_server.Handler):
            def __init__(self) -> None:
                self.command, self.path = "GET", f"/thumb?k={SECRET}&n=1"
                self.sent: list[int] = []

            def _send(self, code, ctype, body, extra_headers=None):
                self._responded = True
                self.sent.append(code)

        def boom():
            raise RuntimeError("decode blew up")

        h = H()
        h._dispatch(boom)
    finally:
        errors.capture_error, errors._enabled = orig, orig_enabled
    check("the handler still answers 500", h.sent, [500])
    check("...and the exception is captured once", len(seen), 1)
    exc, tags = seen[0]
    check("...with method + path tags", (tags["method"], tags["path"]), ("GET", "/thumb"))
    check("...and the url tag carries no secret", SECRET in tags["url"], False)


def test_socketserver_handle_error_reaches_capture() -> None:
    class Raising(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            raise ValueError("unhandled in a handler")

    class Quiet(ThreadingHTTPServer):
        def handle_error(self, request, client_address):
            pass  # the stdlib's traceback print, silenced for the test output

    class Srv(errors.ReportingServerMixin, Quiet):
        pass

    seen: list = []
    orig, orig_enabled = errors.capture_error, errors._enabled
    _record(seen)
    srv = Srv(("127.0.0.1", 0), Raising)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    try:
        try:
            urllib.request.urlopen(
                f"http://127.0.0.1:{srv.server_address[1]}/api/x?k={SECRET}", timeout=10)
        except (urllib.error.URLError, ConnectionError, OSError):
            pass  # the stdlib closes the socket having written nothing
    finally:
        srv.shutdown()
        srv.server_close()
        errors.capture_error, errors._enabled = orig, orig_enabled
    check("an exception socketserver swallows is captured", len(seen), 1)
    exc, tags = seen[0]
    check("...as the handler's own exception", type(exc).__name__, "ValueError")
    check("...tagged with method + path", (tags["method"], tags["path"]), ("GET", "/api/x"))
    check("...and no secret", SECRET in tags["url"], False)


def test_mixin_is_what_both_servers_run() -> None:
    import ui_server
    check("atlas-tool's server carries the reporting mixin",
          issubclass(ui_server._Server, errors.ReportingServerMixin), True)
    src = (HERE.parent / "sheet-tool" / "sheet_server.py").read_text(encoding="utf-8")
    check("sheet-tool serves through a mixin server",
          ("class _Server(errors.ReportingServerMixin, ThreadingHTTPServer)" in src,
           "srv = _Server((HOST, PORT), Handler)" in src), (True, True))
    check("both init reporting in main()",
          ('errors.init_error_tracking("sheet-tool")' in src,
           'errors.init_error_tracking("atlas-tool")'
           in (HERE / "ui_server.py").read_text(encoding="utf-8")), (True, True))


def test_end_to_end_event_is_scrubbed() -> None:
    try:
        import sentry_sdk  # noqa: F401
    except ImportError:
        print("skip end-to-end: sentry-sdk not installed")
        return
    code = (
        "import sys, sentry_sdk\n"
        "from sentry_sdk.transport import Transport\n"
        "sent = []\n"
        "class T(Transport):\n"
        "    def capture_envelope(self, env):\n"
        "        for it in env.items:\n"
        "            if it.type == 'event': sent.append(it.payload.json)\n"
        "orig = sentry_sdk.init\n"
        "sentry_sdk.init = lambda **kw: orig(transport=T, **kw)\n"
        "from iw_common import errors\n"
        "print('init', errors.init_error_tracking('atlas-tool'))\n"
        f"errors.capture_error(RuntimeError('bad ?k={SECRET}'), url='/p?k={SECRET}')\n"
        "sentry_sdk.flush()\n"
        "e = sent[0]\n"
        "print('service', e['tags']['service'], 'env', e['environment'])\n"
        "print('release', e.get('release'))\n"
        f"print('leak', {SECRET!r} in repr(e))\n"
    )
    got = _run_py(code, SENTRY_DSN="https://pub@o0.ingest.sentry.io/0",
                  ATLAS_TOOL_SECRET=SECRET, RAILWAY_GIT_COMMIT_SHA="abc123")
    check("a real client initialises with a DSN, tags service/env/release, leaks nothing",
          got.splitlines()[-4:],
          ["init True", "service atlas-tool env production", "release abc123",
           "leak False"])


def main() -> int:
    for fn in (test_no_dsn_is_a_noop, test_scrubber, test_dispatch_500_reaches_capture,
               test_socketserver_handle_error_reaches_capture,
               test_mixin_is_what_both_servers_run, test_end_to_end_event_is_scrubbed):
        try:
            fn()
        except AssertionError:
            pass
    print()
    if FAILED:
        print(f"{len(FAILED)} FAILED: " + ", ".join(FAILED))
        return 1
    print("all error-tracking fixtures pass")
    return 0


if __name__ == "__main__":
    sys.exit(main())
