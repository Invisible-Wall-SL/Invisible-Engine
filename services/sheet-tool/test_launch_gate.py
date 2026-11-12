"""Offline guard: the Sheet Maker's scope comes from a launcher-SIGNED token.

Run:  PYTHONPATH=../_shared py test_launch_gate.py   (from services/sheet-tool)

The token itself is covered in services/atlas-tool/test_launch_gate.py; this
checks the Sheet Maker's handler is wired to the same gate: `/healthz` open,
a launch becomes a session cookie, edited scope refused, URL scope ignored,
the retired shared secret (`?k=`, `X-Sheet-Secret`, the `sheet_tool` cookie)
refused even while `SHEET_TOOL_SECRET` is still set.

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
from iw_common.testkit import Suite

SIGNING = "sheet-signing-secret-0123456789"
# The retired shared secret, still set on Railway until the owner deletes it.
OLD_SECRET = "retired-sheet-gate-abc"

# Each check builds on the last (a session from the launch, ...), so the first
# failure ends the run.
t = Suite(stop_on_failure=True)


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
    keys = ("SHEET_TOOL_SIGNING_SECRET", "SHEET_TOOL_SECRET", "RAILWAY_ENVIRONMENT")
    saved = {k: os.environ.get(k) for k in keys}
    os.environ["SHEET_TOOL_SIGNING_SECRET"] = SIGNING
    os.environ["SHEET_TOOL_SECRET"] = OLD_SECRET
    import sheet_server as s
    srv = ThreadingHTTPServer(("127.0.0.1", 0), s.Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    port = srv.server_address[1]
    try:
        st, _, _, body = _req(port, "/healthz")
        t.check("/healthz is 200 with no credential", (st, json.loads(body)["ok"]), (200, True))
        t.check("everything else is gated", _req(port, "/logo")[0], 403)

        st, loc, cookies, _ = _req(port, f"/?iw_launch={token()}&home=h")
        t.check("a launch redirects without the token", (st, loc), (303, "/?home=h"))
        sess = next((c.split(";", 1)[0] for c in cookies
                     if c.startswith("iw_sheet_session=")), "")
        t.check("...and sets a session cookie", bool(sess), True)
        t.check("the session opens the tool", _req(port, "/logo", {"Cookie": sess})[0], 200)
        ident = s.GATE.authenticate("/api/state?client=rival&project=their_game",
                                    {"Cookie": sess}).identity
        t.check("URL client/project are ignored", (ident.client, ident.project),
                ("acme", "slots_one"))
        t.check("an edited-client token is refused",
                _req(port, f"/?iw_launch={tamper(token(), client='rival')}")[0], 403)
        t.check("an atlas token is refused here",
                _req(port, f"/?iw_launch={token(aud='atlas')}")[0], 403)

        t.check("?k=<old secret> is refused",
                _req(port, f"/logo?k={OLD_SECRET}&client=acme&project=p1")[0], 403)
        t.check("an X-Sheet-Secret header is refused",
                _req(port, "/logo", {"X-Sheet-Secret": OLD_SECRET})[0], 403)
        t.check("a sheet_tool cookie is refused",
                _req(port, "/logo", {"Cookie": f"sheet_tool={OLD_SECRET}"})[0], 403)

        os.environ.pop("SHEET_TOOL_SIGNING_SECRET")
        os.environ["RAILWAY_ENVIRONMENT"] = "production"
        t.check("only the retired secret on Railway: closed",
                (s.GATE.mode(), _req(port, f"/logo?k={OLD_SECRET}")[0],
                 _req(port, "/healthz")[0]), ("closed", 403, 200))
    finally:
        srv.shutdown()
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


if __name__ == "__main__":
    t.run(test_sheet_gate)
    t.exit()
