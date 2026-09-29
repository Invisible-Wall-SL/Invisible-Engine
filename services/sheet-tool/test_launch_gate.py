"""Offline guard: the Sheet Maker's scope comes from a launcher-SIGNED token.

Run:  PYTHONPATH=../_shared py test_launch_gate.py   (from services/sheet-tool)

The token itself is covered in services/atlas-tool/test_launch_gate.py; this
checks the Sheet Maker's handler is wired to the same gate: `/healthz` open,
a launch becomes a session cookie, edited scope refused, URL scope ignored,
the legacy `?k=` handoff honoured only inside its window.

ASCII only in the labels (cp1252 console).
"""
from __future__ import annotations

import base64
import http.client
import json
import os
import threading
import time
from http.server import ThreadingHTTPServer

from iw_common import launch

SIGNING = "sheet-signing-secret-0123456789"
LEGACY = "legacy-sheet-gate-abc"

FAILED: list[str] = []


def check(label: str, got, want) -> None:
    ok = got == want
    print(f"{'ok  ' if ok else 'FAIL'} {label}")
    if not ok:
        print(f"       got  {got!r}\n       want {want!r}")
        FAILED.append(label)
    assert ok, label


def token(**over) -> str:
    now = int(time.time())
    c = {"v": 1, "typ": "launch", "aud": "sheet", "sub": "u_alice", "name": "Alice",
         "role": "artist", "client": "acme", "project": "slots_one", "caps": [],
         "iat": now, "exp": now + 120}
    c.update(over)
    return launch.sign(SIGNING, c)


def tamper(tok: str, **over) -> str:
    v, body, sig = tok.split(".")
    payload = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    payload.update(over)
    raw = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode())
    return f"{v}.{raw.rstrip(b'=').decode()}.{sig}"


def _req(port: int, path: str, headers: dict | None = None):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=30)
    c.request("GET", path, headers=headers or {})
    r = c.getresponse()
    body = r.read()
    out = (r.status, r.getheader("Location"), r.msg.get_all("Set-Cookie") or [], body)
    c.close()
    return out


def test_sheet_gate() -> None:
    keys = ("SHEET_TOOL_SIGNING_SECRET", "SHEET_TOOL_SECRET", launch.LEGACY_ENV)
    saved = {k: os.environ.get(k) for k in keys}
    os.environ["SHEET_TOOL_SIGNING_SECRET"] = SIGNING
    os.environ["SHEET_TOOL_SECRET"] = LEGACY
    os.environ[launch.LEGACY_ENV] = "2999-01-01"
    import sheet_server as s
    srv = ThreadingHTTPServer(("127.0.0.1", 0), s.Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    port = srv.server_address[1]
    try:
        st, _, _, body = _req(port, "/healthz")
        check("/healthz is 200 with no credential", (st, json.loads(body)["ok"]), (200, True))
        check("everything else is gated", _req(port, "/logo")[0], 403)

        st, loc, cookies, _ = _req(port, f"/?iw_launch={token()}&home=h")
        check("a launch redirects without the token", (st, loc), (303, "/?home=h"))
        sess = next((c.split(";", 1)[0] for c in cookies
                     if c.startswith("iw_sheet_session=")), "")
        check("...and sets a session cookie", bool(sess), True)
        check("the session opens the tool", _req(port, "/logo", {"Cookie": sess})[0], 200)
        ident = s.GATE.authenticate("/api/state?client=rival&project=their_game",
                                    {"Cookie": sess}).identity
        check("URL client/project are ignored", (ident.client, ident.project),
              ("acme", "slots_one"))
        check("an edited-client token is refused",
              _req(port, f"/?iw_launch={tamper(token(), client='rival')}")[0], 403)
        check("an atlas token is refused here",
              _req(port, f"/?iw_launch={token(aud='atlas')}")[0], 403)

        check("legacy ?k= works inside the window",
              _req(port, f"/logo?k={LEGACY}&client=acme&project=p1")[0], 200)
        os.environ[launch.LEGACY_ENV] = "off"
        check("...and not after it", _req(port, f"/logo?k={LEGACY}&client=acme&project=p1")[0],
              403)
    finally:
        srv.shutdown()
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


if __name__ == "__main__":
    try:
        test_sheet_gate()
    except AssertionError:
        pass
    print(f"\n{'FAILED: ' + str(len(FAILED)) if FAILED else 'all passed'}")
    raise SystemExit(1 if FAILED else 0)
