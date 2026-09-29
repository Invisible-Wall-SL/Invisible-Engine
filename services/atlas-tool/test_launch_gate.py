"""Offline guard: the Atlas Maker's scope comes from a launcher-SIGNED token.

Run:  PYTHONPATH=../_shared py test_launch_gate.py   (from services/atlas-tool)
      (also collects under pytest)

What must hold (iw_common/launch.py):

  * the token format matches the launcher byte for byte (a shared vector —
    `apps/launcher-api/scripts/check-tool-launch-token.ts` asserts the same one);
  * an edited client/project, a wrong secret, the other tool's token, an expired
    or replayed launch, or a doctored session cookie are all refused;
  * after a launch, `?client=` / `?project=` in the URL change nothing;
  * the old `?k=` handoff works during the transition window and not after;
  * `/healthz` answers without any credential;
  * a render can be stopped only by whoever started it, or an admin, and a
    render for another project shows its holder but not its log.

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

SIGNING = "test-signing-secret-0123456789"
LEGACY = "legacy-gate-value-abc"
VECTOR = ("v1.eyJ2IjoxLCJ0eXAiOiJsYXVuY2giLCJhdWQiOiJhdGxhcyIsInN1YiI6InVfMTIzIiwidWlkIjoid"
          "S0xMjMiLCJuYW1lIjoiVGVzdCBVc2VyIiwicm9sZSI6ImFydGlzdCIsImNsaWVudCI6ImFjbWUiLCJwc"
          "m9qZWN0Ijoic2xvdHNfb25lIiwiY2FwcyI6WyJibHVlcHJpbnRQdWJsaXNoIl0sImlhdCI6MTc5MDAwM"
          "DAwMCwiZXhwIjoxNzkwMDAwMTIwfQ.0CSIb51eucrRLmsjC7Hnu62y1QKY7u3r5-nUWzeWCq4")

FAILED: list[str] = []


def check(label: str, got, want) -> None:
    ok = got == want
    print(f"{'ok  ' if ok else 'FAIL'} {label}")
    if not ok:
        print(f"       got  {got!r}\n       want {want!r}")
        FAILED.append(label)
    assert ok, label


def claims(**over) -> dict:
    now = int(time.time())
    c = {"v": 1, "typ": "launch", "aud": "atlas", "sub": "u_alice", "name": "Alice",
         "role": "artist", "client": "acme", "project": "slots_one", "caps": [],
         "iat": now, "exp": now + 120}
    c.update(over)
    return c


def tamper(token: str, **over) -> str:
    """Edit the payload, keep the original signature."""
    v, body, sig = token.split(".")
    payload = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    payload.update(over)
    raw = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode())
    return f"{v}.{raw.rstrip(b'=').decode()}.{sig}"


# --- the token itself ---------------------------------------------------------

def test_vector_matches_launcher() -> None:
    payload = {"v": 1, "typ": "launch", "aud": "atlas", "sub": "u_123", "uid": "u-123",
               "name": "Test User",
               "role": "artist", "client": "acme", "project": "slots_one",
               "caps": ["blueprintPublish"], "iat": 1790000000, "exp": 1790000120}
    check("sign() reproduces the launcher's vector", launch.sign(SIGNING, payload), VECTOR)
    got = launch.verify(SIGNING, VECTOR, typ="launch", aud="atlas", now=1790000010)
    check("the vector verifies inside its lifetime", (got or {}).get("client"), "acme")
    ident = launch.LaunchGate(aud="atlas", signing_env="-", legacy_env="-", legacy_cookie="-",
                              legacy_header="-")._claims_identity(got or {})
    check("...and carries the real user id", ident.uid if ident else None, "u-123")
    check("...and not after exp",
          launch.verify(SIGNING, VECTOR, typ="launch", aud="atlas", now=1790000121), None)


def test_tampering_refused() -> None:
    tok = launch.sign(SIGNING, claims())
    ok = launch.verify(SIGNING, tok, typ="launch", aud="atlas")
    check("an untouched token verifies", (ok or {}).get("project"), "slots_one")
    for label, bad in (
            ("edited client", tamper(tok, client="rival")),
            ("edited project", tamper(tok, project="their_game")),
            ("edited role", tamper(tok, role="admin")),
            ("edited expiry", tamper(tok, exp=int(time.time()) + 99999)),
            ("wrong secret", launch.sign("another-secret-entirely", claims())),
            ("other tool's audience", launch.sign(SIGNING, claims(aud="sheet"))),
            ("launch lifetime over the cap", launch.sign(SIGNING, claims(
                exp=int(time.time()) + launch.LAUNCH_TTL_MAX + 60))),
            ("issued in the future", launch.sign(SIGNING, claims(
                iat=int(time.time()) + 3600, exp=int(time.time()) + 3700))),
            ("not a token", "v1.garbage"),
            ("unicode junk", "v1.é.é")):
        check(f"refused: {label}", launch.verify(SIGNING, bad, typ="launch", aud="atlas"),
              None)
    check("a launch token is not a session",
          launch.verify(SIGNING, tok, typ="session", aud="atlas"), None)


def test_may_control() -> None:
    alice = launch.Identity(via="token", sub="u_alice", role="artist")
    bob = launch.Identity(via="token", sub="u_bob", role="artist")
    admin = launch.Identity(via="token", sub="u_admin", role="admin")
    owner = {"id": "u_alice", "name": "Alice"}
    check("owner may stop", launch.may_control(alice, owner), True)
    check("another user may not", launch.may_control(bob, owner), False)
    check("an admin may", launch.may_control(admin, owner), True)
    check("an unowned job is anyone's", launch.may_control(bob, None), True)
    check("an anonymous legacy caller may not stop an owned job",
          launch.may_control(launch.Identity(via="legacy"), owner), False)
    check("a legacy caller naming the owner's id may not stop a signed job",
          launch.may_control(launch.Identity(via="legacy", sub="u_alice"), owner), False)
    check("...but may stop a job its own legacy launch started",
          launch.may_control(launch.Identity(via="legacy", sub="u_alice"),
                             {"id": "u_alice", "via": "legacy"}), True)


def test_no_secret_on_railway_is_closed() -> None:
    keys = ("RAILWAY_ENVIRONMENT", "X_SIGN", "X_LEGACY")
    saved = {k: os.environ.pop(k, None) for k in keys}
    gate = launch.LaunchGate(aud="atlas", signing_env="X_SIGN", legacy_env="X_LEGACY",
                             legacy_cookie="x", legacy_header="X-X")
    try:
        check("no secrets locally: open", gate.authenticate("/?project=p1", {}).ok, True)
        os.environ["RAILWAY_ENVIRONMENT"] = "production"
        check("no secrets on Railway: closed", (gate.mode(), gate.authenticate("/", {}).ok),
              ("closed", False))
    finally:
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


def test_redirect_stays_local() -> None:
    import urllib.parse
    check("a // path cannot become a scheme-relative redirect",
          launch._strip_handoff(urllib.parse.urlparse("//evil.example/x?iw_launch=t&a=1")),
          "/x?a=1")


def test_legacy_window_flag() -> None:
    saved = os.environ.get(launch.LEGACY_ENV)
    try:
        os.environ[launch.LEGACY_ENV] = "off"
        check("off ends the window", launch.legacy_until(), False)
        os.environ[launch.LEGACY_ENV] = "2000-01-01"
        check("a past date ends the window", launch.legacy_until(), False)
        os.environ[launch.LEGACY_ENV] = "2999-01-01"
        check("a future date keeps it", launch.legacy_until(), True)
        os.environ[launch.LEGACY_ENV] = "not-a-date"
        check("an unreadable value fails closed", launch.legacy_until(), False)
        os.environ.pop(launch.LEGACY_ENV)
        import datetime as dt
        check("the default is the documented cut-over",
              launch.legacy_until(dt.date.fromisoformat(launch.LEGACY_CUTOVER)), True)
        check("...and ends the day after",
              launch.legacy_until(dt.date.fromisoformat(launch.LEGACY_CUTOVER)
                                  + dt.timedelta(days=1)), False)
    finally:
        if saved is None:
            os.environ.pop(launch.LEGACY_ENV, None)
        else:
            os.environ[launch.LEGACY_ENV] = saved


# --- end to end through the tool's own handler ----------------------------------

class FakeProc:
    def poll(self):
        return None


def _serve():
    import ui_server as u
    srv = ThreadingHTTPServer(("127.0.0.1", 0), u.Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return u, srv


def _req(port: int, method: str, path: str, headers: dict | None = None,
         body: bytes | None = None):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=30)
    c.request(method, path, body=body, headers=headers or {})
    r = c.getresponse()
    data = r.read()
    out = (r.status, r.getheader("Location"), r.msg.get_all("Set-Cookie") or [], data)
    c.close()
    return out


def _session(set_cookies: list[str]) -> str:
    for c in set_cookies:
        if c.startswith("iw_atlas_session="):
            return c.split(";", 1)[0]
    return ""


def test_http_end_to_end() -> None:
    env_keys = ("ATLAS_TOOL_SIGNING_SECRET", "ATLAS_TOOL_SECRET", launch.LEGACY_ENV)
    saved = {k: os.environ.get(k) for k in env_keys}
    os.environ["ATLAS_TOOL_SIGNING_SECRET"] = SIGNING
    os.environ["ATLAS_TOOL_SECRET"] = LEGACY
    os.environ[launch.LEGACY_ENV] = "2999-01-01"
    u, srv = _serve()
    port = srv.server_address[1]
    real_stop = u.stop_render
    stopped: list[bool] = []
    u.stop_render = lambda: stopped.append(True) or "Stopping... render stopped"
    try:
        st, _, _, body = _req(port, "GET", "/healthz")
        check("/healthz is 200 with no credential", st, 200)
        check("/healthz says ok", json.loads(body)["ok"], True)
        check("everything else is gated", _req(port, "GET", "/progress")[0], 403)

        tok = launch.sign(SIGNING, claims())
        st, loc, cookies, _ = _req(port, "GET", f"/?iw_launch={tok}&home=https%3A%2F%2Fl")
        check("a launch redirects", st, 303)
        check("...to the same URL without the token", loc, "/?home=https%3A%2F%2Fl")
        alice = _session(cookies)
        check("...setting a session cookie", bool(alice), True)
        check("the cookie is not the secret", SIGNING in alice or LEGACY in alice, False)
        check("the cookie is HttpOnly",
              any("HttpOnly" in c for c in cookies if c.startswith("iw_atlas_session")), True)
        check("a replayed launch token is refused",
              _req(port, "GET", f"/?iw_launch={tok}")[0], 403)
        check("an edited-client token is refused",
              _req(port, "GET", f"/?iw_launch={tamper(launch.sign(SIGNING, claims()), client='rival')}")[0],
              403)
        check("an edited-project token is refused",
              _req(port, "GET", f"/?iw_launch={tamper(launch.sign(SIGNING, claims()), project='x_y')}")[0],
              403)
        check("a sheet token is refused here",
              _req(port, "GET", f"/?iw_launch={launch.sign(SIGNING, claims(aud='sheet'))}")[0], 403)
        doctored = alice.split("=", 1)[0] + "=" + tamper(alice.split("=", 1)[1], client="rival")
        check("a doctored session cookie is refused",
              _req(port, "GET", "/progress", {"Cookie": doctored})[0], 403)

        # Scope comes from the session ONLY.
        ident = u.GATE.authenticate("/progress?client=rival&project=their_game",
                                    {"Cookie": alice}).identity
        check("URL client/project are ignored with a session",
              (ident.client, ident.project), ("acme", "slots_one"))
        hdr = u.GATE.authenticate("/video/status", {launch.LAUNCH_HEADER: launch.sign(
            SIGNING, claims(sub="u_x", typ="api"))})
        check("a server-to-server api token is accepted without a cookie",
              (hdr.ok, hdr.cookies, hdr.identity.sub), (True, [], "u_x"))
        check("a URL launch token is refused as a header",
              _req(port, "GET", "/progress", {launch.LAUNCH_HEADER: tok})[0], 403)
        check("an api token is refused in a URL",
              _req(port, "GET", "/?iw_launch=" + launch.sign(SIGNING, claims(typ="api")))[0], 403)

        # The transition window.
        st, _, cookies, _ = _req(port, "GET", f"/progress?k={LEGACY}&client=acme&project=p1")
        check("legacy ?k= still works inside the window", st, 200)
        os.environ[launch.LEGACY_ENV] = "off"
        check("...and is refused once the window is closed",
              _req(port, "GET", f"/progress?k={LEGACY}&client=acme&project=p1")[0], 403)
        check("a session is unaffected by the window",
              _req(port, "GET", "/progress", {"Cookie": alice})[0], 200)
        os.environ[launch.LEGACY_ENV] = "2999-01-01"

        # Render ownership.
        bob = _session(_req(port, "GET", "/?iw_launch=" + launch.sign(
            SIGNING, claims(sub="u_bob", name="Bob")))[2])
        carol = _session(_req(port, "GET", "/?iw_launch=" + launch.sign(
            SIGNING, claims(sub="u_carol", name="Carol", role="admin")))[2])
        rival = _session(_req(port, "GET", "/?iw_launch=" + launch.sign(
            SIGNING, claims(sub="u_dan", name="Dan", client="rival", project="their_game")))[2])
        with u._render_lock:
            u._render_state.update(running=True, log="secret-prompt text", cur=1, total=4,
                                   owner={"id": "u_alice", "name": "Alice", "role": "artist",
                                          "client": "acme", "project": "slots_one"})
        u._render_proc = FakeProc()

        view = json.loads(_req(port, "GET", "/progress", {"Cookie": bob})[3])
        check("another user sees who is rendering", view["owner"]["name"], "Alice")
        check("...but gets no Stop", view["canStop"], False)
        check("same project: the log is shown", view["log"], "secret-prompt text")
        view = json.loads(_req(port, "GET", "/progress", {"Cookie": rival})[3])
        check("another client's user does not see the log", view["log"], "")
        check("...and is told it is another project", view.get("otherProject"), True)
        check("the owner gets Stop",
              json.loads(_req(port, "GET", "/progress", {"Cookie": alice})[3])["canStop"], True)

        body = _req(port, "POST", "/stop", {"Cookie": bob}, b"{}")[3].decode()
        check("another user's Stop is refused", (stopped, "Alice" in body), ([], True))
        legacy = _req(port, "POST", f"/stop?k={LEGACY}&client=acme&project=slots_one&user=u_alice",
                      {}, b"{}")[3].decode()
        check("a legacy caller claiming the owner's id is refused", (stopped, "Alice" in legacy),
              ([], True))
        body = _req(port, "POST", "/render", {"Cookie": bob},
                    b'{"names":["a"],"variants":1}')[3].decode()
        check("a second render names the holder", "Alice is rendering" in body, True)
        _req(port, "POST", "/stop", {"Cookie": carol}, b"{}")
        check("an admin's Stop goes through", stopped, [True])
        _req(port, "POST", "/stop", {"Cookie": alice}, b"{}")
        check("the owner's Stop goes through", stopped, [True, True])
        with u._render_lock:
            u._render_state.update(running=False)
        body = _req(port, "POST", "/stop", {"Cookie": bob}, b"{}")[3].decode()
        check("with nothing running a user's Stop touches nothing",
              (stopped, body), ([True, True], "Nothing is running."))
    finally:
        u.stop_render = real_stop
        u._render_proc = None
        with u._render_lock:
            u._render_state.update(running=False, owner=None, log="")
        srv.shutdown()
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
            except AssertionError:
                pass
    print(f"\n{'FAILED: ' + str(len(FAILED)) if FAILED else 'all passed'}")
    raise SystemExit(1 if FAILED else 0)
