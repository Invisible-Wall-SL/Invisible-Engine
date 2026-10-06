"""Offline guard: an Invisible Director agent's call (docs/director/DECISIONS/
0002-tool-adapters.md) is told apart from a person's, and a person's is unchanged.

Run:  PYTHONPATH=".;../_shared" py test_director_calls.py   (from services/atlas-tool)
      (also collects under pytest)

What must hold:

  * an api token's signed `act: {tool, agent, run}` claim reaches the Identity;
    the same claim on a launch token, or a malformed one, refuses the TOKEN (it
    never degrades into a plain user's identity), and a session cookie never
    carries it;
  * a save stamped under an acting identity names "director", the agent and the
    run; any other save is stamped exactly as before;
  * an acting caller's `?manifest=` pins the manifest for that request only (GET,
    POST, and the render/compose worker threads it starts) without touching
    atlas_config.json; a bad name is 400, an unknown one 404; a plain caller's
    `manifest` param changes nothing;
  * `/createatlas` with `Accept: application/json` says whether it started, and
    names who holds the slot when it did not.

ASCII only in the labels (cp1252 console).
"""
from __future__ import annotations

import http.client
import json
import os
import sys
import tempfile
import threading
import time
from http.server import ThreadingHTTPServer

os.environ["ATLAS_STAGING"] = tempfile.mkdtemp(prefix="director-calls-")

import cloud_paths as project_paths  # noqa: E402
import ui_server as u  # noqa: E402
from iw_common import docsave, launch  # noqa: E402

SIGNING = "test-signing-secret-0123456789"
ACT = {"tool": "director", "agent": "atlas-painter", "run": "run_01:abc-9"}

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
    c = {"v": 1, "typ": "api", "aud": "atlas", "sub": "u_alice", "uid": "u-1",
         "name": "Alice", "role": "artist", "client": "acme", "project": "slots_one",
         "caps": [], "iat": now, "exp": now + 120}
    c.update(over)
    return c


def _gate() -> launch.LaunchGate:
    return launch.LaunchGate(aud="atlas", signing_env="X_DIRECTOR_SIGN", legacy_env="-",
                             legacy_cookie="-", legacy_header="-")


# --- the act claim ------------------------------------------------------------

def test_act_claim_on_api_token() -> None:
    os.environ["X_DIRECTOR_SIGN"] = SIGNING
    try:
        gate = _gate()
        res = gate.authenticate("/progress", {launch.LAUNCH_HEADER: launch.sign(
            SIGNING, claims(act=ACT))})
        ident = res.identity
        check("an api token with act is accepted", res.ok, True)
        check("...and the identity carries it",
              (ident.act_tool, ident.act_agent, ident.act_run, ident.sub),
              ("director", "atlas-painter", "run_01:abc-9", "u_alice"))
        plain = gate.authenticate("/progress", {launch.LAUNCH_HEADER: launch.sign(
            SIGNING, claims())}).identity
        check("an api token without act acts for nobody",
              (plain.act_tool, plain.act_agent, plain.act_run), ("", "", ""))

        st = gate.authenticate("/?iw_launch=" + launch.sign(
            SIGNING, claims(typ="launch", act=ACT)), {})
        check("act on a launch token refuses the token", (st.ok, st.identity), (False, None))
        for label, bad in (
                ("wrong tool", dict(ACT, tool="sheet")),
                ("agent with capitals", dict(ACT, agent="Atlas")),
                ("agent starting with a digit", dict(ACT, agent="1atlas")),
                ("agent too long", dict(ACT, agent="a" * 41)),
                ("agent not a string", dict(ACT, agent=7)),
                ("run with a slash", dict(ACT, run="run/1")),
                ("run empty", dict(ACT, run="")),
                ("run too long", dict(ACT, run="r" * 65)),
                ("run with a newline", dict(ACT, run="run\n")),
                ("act not an object", "director"),
                ("act null", None)):
            got = gate.authenticate("/progress", {launch.LAUNCH_HEADER: launch.sign(
                SIGNING, claims(act=bad))})
            check(f"refused: malformed act ({label})", (got.ok, got.identity), (False, None))
        check("a direct claims check refuses act on a session token",
              gate._claims_identity(claims(typ="session", act=ACT)), None)

        cookie = gate.mint_session(claims(act=ACT))
        payload = launch.verify(SIGNING, cookie, typ="session", aud="atlas") or {}
        check("a session minted from acting claims carries no act", "act" in payload, False)
        check("...and is still a session for the user", payload.get("sub"), "u_alice")
    finally:
        os.environ.pop("X_DIRECTOR_SIGN", None)


def test_stamp_names_the_agent() -> None:
    acting = launch.Identity(via="token", sub="u_alice", uid="u-1", name="Alice",
                             act_tool="director", act_agent="atlas-painter",
                             act_run="run_01:abc-9")
    by = docsave.stamp({}, acting, "atlas")
    check("an acting save is stamped as the director",
          (by["tool"], by["agent"], by["runId"], by["uid"], by["name"]),
          ("director", "atlas-painter", "run_01:abc-9", "u-1", "Alice"))
    by = docsave.stamp({}, launch.Identity(via="token", sub="u_alice", name="Alice"), "atlas")
    check("a person's save keeps the tool and has no agent",
          (by["tool"], "agent" in by, "runId" in by), ("atlas", False, False))
    by = docsave.stamp({}, None, "sheet")
    check("an anonymous save is unchanged", (by["tool"], "agent" in by), ("sheet", False))


# --- through the tool's own handler ---------------------------------------------

def _req(port: int, method: str, path: str, headers: dict | None = None,
         body: bytes | None = None):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=30)
    c.request(method, path, body=body, headers=headers or {})
    r = c.getresponse()
    out = (r.status, r.getheader("Content-Type"), r.read())
    c.close()
    return out


def _wait(cond, timeout: float = 5.0) -> bool:
    end = time.time() + timeout
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.02)
    return cond()


def _seed() -> None:
    """Project acme/slots_one with two manifests, `main` selected."""
    project_paths.set_context("acme", "slots_one")
    u.MANIFEST_DIR.mkdir(parents=True, exist_ok=True)
    for name in ("atlas_manifest_main.json", "atlas_manifest_symbols.json"):
        (u.MANIFEST_DIR / name).write_text(json.dumps({"regions": []}), encoding="utf-8")
    u.CONFIG_PATH.write_text(json.dumps({"manifest_path": "atlas_manifest_main.json"}),
                             encoding="utf-8")


def test_manifest_pin_end_to_end() -> None:
    env_keys = ("ATLAS_TOOL_SIGNING_SECRET", "ATLAS_TOOL_SECRET", "COMFY_TRANSPORT")
    saved = {k: os.environ.get(k) for k in env_keys}
    os.environ["ATLAS_TOOL_SIGNING_SECRET"] = SIGNING
    os.environ.pop("ATLAS_TOOL_SECRET", None)
    # Production renders on RunPod; the Director is refused anything else
    # (test_director_safety.py).
    os.environ["COMFY_TRANSPORT"] = "serverless"

    _seed()
    config_before = u.CONFIG_PATH.read_bytes()

    refreshed: list[str] = []
    started: dict[str, tuple] = {}
    real = {k: getattr(u, k) for k in ("_refresh_manifest_from_r2", "run_render", "run_compose")}
    real_h = {k: getattr(u.Handler, k) for k in ("_cardsdata", "_save")}
    u._refresh_manifest_from_r2 = refreshed.append
    u.run_render = lambda *a: started.__setitem__("render", a)
    u.run_compose = lambda *a: started.__setitem__("compose", a)
    u.Handler._cardsdata = lambda self: json.dumps({"m": u.manifest_path().name}).encode()
    u.Handler._save = lambda self, data: u.manifest_path().name

    srv = ThreadingHTTPServer(("127.0.0.1", 0), u.Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    port = srv.server_address[1]
    agent = {launch.LAUNCH_HEADER: launch.sign(SIGNING, claims(act=ACT))}
    person = {launch.LAUNCH_HEADER: launch.sign(SIGNING, claims())}
    try:
        st, _, body = _req(port, "GET", "/cardsdata", agent)
        check("an agent without ?manifest= sees the selected one",
              (st, json.loads(body)["m"]), (200, "atlas_manifest_main.json"))
        st, _, body = _req(port, "GET", "/cardsdata?manifest=atlas_manifest_symbols.json",
                           agent)
        check("an agent's GET sees the pinned manifest",
              (st, json.loads(body)["m"]), (200, "atlas_manifest_symbols.json"))
        check("...without re-pulling a manifest already staged", refreshed, [])
        st, _, body = _req(port, "POST", "/save?manifest=atlas_manifest_symbols.json",
                           agent, b"{}")
        check("an agent's POST sees the pinned manifest",
              (st, body.decode()), (200, "atlas_manifest_symbols.json"))
        st, _, body = _req(port, "GET", "/cardsdata?manifest=atlas_manifest_symbols.json",
                           person)
        check("a person's manifest param is ignored",
              (st, json.loads(body)["m"]), (200, "atlas_manifest_main.json"))
        check("...and refreshes nothing", refreshed, [])
        check("the selection is untouched",
              (u.CONFIG_PATH.read_bytes() == config_before, u.manifest_path().name),
              (True, "atlas_manifest_main.json"))

        for label, name in (("a path", "../atlas_manifest_x.json"),
                            ("another prefix", "manifest_x.json"),
                            ("not json", "atlas_manifest_x.atlas")):
            st, ctype, body = _req(port, "GET", f"/cardsdata?manifest={name}", agent)
            check(f"bad manifest name refused: {label}",
                  (st, ctype, json.loads(body)), (400, "application/json",
                                                  {"error": "bad manifest"}))
        st, ctype, body = _req(port, "POST", "/save?manifest=atlas_manifest_nope.json",
                               agent, b"{}")
        check("an unknown manifest is 404",
              (st, ctype, json.loads(body)), (404, "application/json",
                                              {"error": "unknown manifest"}))
        check("...after an exact-key refresh from R2 found nothing", refreshed,
              ["atlas_manifest_nope.json"])

        st, _, body = _req(port, "POST", "/render?manifest=atlas_manifest_symbols.json",
                           dict(agent, Accept="application/json"),
                           b'{"names":["H1"],"variants":1}')
        check("an agent's render starts", json.loads(body)["started"], True)
        _wait(lambda: "render" in started)
        check("...carrying the pin to its worker",
              str(started.get("render", ())[-1]),
              str(u.MANIFEST_DIR / "atlas_manifest_symbols.json"))
        with u._render_lock:
            u._render_state.update(running=False, owner=None)
        _req(port, "POST", "/render", dict(person, Accept="application/json"),
             b'{"names":["H1"],"variants":1}')
        _wait(lambda: started["render"][-1] is None)
        check("a person's render carries no pin", started["render"][-1], None)

        class _Live:
            def poll(self):
                return None
        real_proc = u._render_proc
        u._render_proc = _Live()
        with u._render_lock:
            u._render_state.update(running=True, owner={"id": "u_bob", "name": "Bob"},
                                   cur=1, total=4)
        started.pop("compose", None)
        st, ctype, body = _req(port, "POST",
                               "/createatlas?manifest=atlas_manifest_symbols.json",
                               dict(agent, Accept="application/json"), b"{}")
        ans = json.loads(body)
        check("/createatlas JSON says not started while the slot is busy",
              (st, ctype, ans["started"], "Bob" in ans["message"]),
              (200, "application/json", False, True))
        check("...and starts nothing", "compose" in started, False)
        check("/createatlas without JSON is unchanged while busy",
              _req(port, "POST", "/createatlas", person, b"{}")[1:],
              ("text/plain", b"composing"))
        u._render_proc = real_proc
        with u._render_lock:
            u._render_state.update(running=False, owner=None)
        st, ctype, body = _req(port, "POST",
                               "/createatlas?manifest=atlas_manifest_symbols.json",
                               dict(agent, Accept="application/json"), b"{}")
        check("/createatlas JSON says started when the slot is free",
              (st, json.loads(body)["started"]), (200, True))
        check("...having claimed the slot before answering",
              u._render_state["running"], True)
        _wait(lambda: "compose" in started)
        check("...carrying the pin to its worker", str(started.get("compose", ())[-1]),
              str(u.MANIFEST_DIR / "atlas_manifest_symbols.json"))
        check("/createatlas without JSON is unchanged",
              _req(port, "POST", "/createatlas", person, b"{}")[1:],
              ("text/plain", b"composing"))
    finally:
        srv.shutdown()
        for k, v in real.items():
            setattr(u, k, v)
        for k, v in real_h.items():
            setattr(u.Handler, k, v)
        with u._render_lock:
            u._render_state.update(running=False, owner=None)
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


def test_workers_honour_the_pin() -> None:
    _seed()
    pinned = u.MANIFEST_DIR / "atlas_manifest_symbols.json"
    seen: dict[str, str] = {}
    real_job, real_compose = u._render_job, u._run_compose_pinned
    u._render_job = lambda *a: seen.__setitem__("render", u.manifest_path().name)
    u._run_compose_pinned = lambda mp: seen.__setitem__(
        "compose", f"{mp.name}|{u.manifest_path().name}")
    try:
        t = threading.Thread(target=u.run_render, args=(["H1"], 1, ("acme", "slots_one")),
                             kwargs={"pin": pinned})
        t.start()
        t.join()
        check("a pinned render worker renders the pinned manifest", seen.get("render"),
              "atlas_manifest_symbols.json")
        t = threading.Thread(target=u.run_render, args=(["H1"], 1, ("acme", "slots_one")))
        t.start()
        t.join()
        check("an unpinned one renders the selected manifest", seen.get("render"),
              "atlas_manifest_main.json")
        t = threading.Thread(target=u.run_compose, args=(("acme", "slots_one"), None, pinned))
        t.start()
        t.join()
        check("a pinned compose worker composes the pinned manifest", seen.get("compose"),
              "atlas_manifest_symbols.json|atlas_manifest_symbols.json")
        t = threading.Thread(target=u.run_compose, args=(("acme", "slots_one"),))
        t.start()
        t.join()
        check("an unpinned one composes the selected manifest", seen.get("compose"),
              "atlas_manifest_main.json|atlas_manifest_main.json")
    finally:
        u._render_job, u._run_compose_pinned = real_job, real_compose
        with u._render_lock:
            u._render_state.update(running=False, owner=None)


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
            except AssertionError:
                pass
    print(f"\n{'FAILED: ' + str(len(FAILED)) if FAILED else 'all passed'}")
    sys.exit(1 if FAILED else 0)
