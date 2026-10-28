"""Offline guard: the bar's "Ask the AI" relay (iw_common/ask_ai.py).

Run:  PYTHONPATH=../_shared py test_ask_ai.py   (from services/atlas-tool)

What must hold:

  * the relay token matches the launcher byte for byte (a shared vector —
    `apps/launcher-api/scripts/check-tool-relay-token.ts` verifies the same one);
  * only a signed launcher identity is relayed: a legacy or open caller gets a
    403, and a tool without its signing secret a 503 — the launcher is never asked;
  * the launcher is asked with the relay token, for the identity's own user, and
    its answer streams back to the page as it arrives; its refusal reaches the
    page with the launcher's own wording (so the relay must ask for JSON: SvelteKit
    answers an `error()` as an HTML page otherwise);
  * the inlined page script carries the tool's config and cannot close its tag.

ASCII only in the labels (cp1252 console).
"""
from __future__ import annotations

import http.client
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from iw_common import ask_ai, launch

SIGNING = "test-signing-secret-0123456789"
VECTOR = ("v1.eyJ2IjoxLCJ0eXAiOiJyZWxheSIsImF1ZCI6ImxhdW5jaGVyIiwiaXNzIjoiYXRsYXMiLCJ1aWQiOiJ1"
          "LTEyMyIsImlhdCI6MTc5MDAwMDAwMCwiZXhwIjoxNzkwMDAwMDYwfQ.QKf4hgs9cveYGmgkxJIhRB9YL7NIjM"
          "-kH2THIKy6ysU")
SECRET_ENV = "IW_TEST_ASK_AI_SECRET"

FAILED: list[str] = []


def check(label: str, got, want) -> None:
    ok = got == want
    print(f"{'ok  ' if ok else 'FAIL'} {label}")
    if not ok:
        print(f"       got  {got!r}\n       want {want!r}")
        FAILED.append(label)


class FakeLauncher(BaseHTTPRequestHandler):
    """Records what it was asked; answers like /api/ask-ai."""
    seen: list[dict] = []
    status = 200

    def log_message(self, *a):
        pass

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0) or 0)
        FakeLauncher.seen.append({"path": self.path, "relay": self.headers.get(ask_ai.RELAY_HEADER),
                                  "accept": self.headers.get("Accept", ""),
                                  "body": json.loads(self.rfile.read(n) or b"{}")})
        if FakeLauncher.status != 200:
            body = json.dumps({"message": "Your role does not have access to it."}).encode()
            self.send_response(FakeLauncher.status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson")
        self.end_headers()
        for ev in ({"t": "text", "v": "Open the "}, {"t": "text", "v": "Regions panel."},
                   {"t": "done"}):
            self.wfile.write((json.dumps(ev) + "\n").encode())
            self.wfile.flush()


class Tool(BaseHTTPRequestHandler):
    """A tool server whose gate said `identity`."""
    identity = None

    def log_message(self, *a):
        pass

    def do_POST(self):
        ask_ai.relay(self, iss="atlas", secret_env=SECRET_ENV, identity=Tool.identity,
                     before_end=lambda: self.send_header("Set-Cookie", "iw_session=x"))


def serve(handler) -> ThreadingHTTPServer:
    srv = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def ask(port: int) -> tuple[int, dict, bytes]:
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    body = json.dumps({"tool": "atlasTool", "messages": [{"role": "user", "content": "How?"}]})
    conn.request("POST", "/ask-ai", body=body, headers={"Content-Type": "application/json"})
    res = conn.getresponse()
    return res.status, dict(res.getheaders()), res.read()


def test_vector() -> None:
    check("relay_token() reproduces the launcher's vector",
          ask_ai.relay_token(SIGNING, "atlas", "u-123", now=1790000000), VECTOR)
    got = launch.verify(SIGNING, VECTOR, typ="relay", aud="launcher", now=1790000010)
    check("...and lives 60 seconds", (got or {}).get("exp", 0) - (got or {}).get("iat", 0), 60)


def test_relay() -> None:
    launcher = serve(FakeLauncher)
    tool = serve(Tool)
    os.environ["LAUNCHER_URL"] = f"http://127.0.0.1:{launcher.server_address[1]}/"
    port = tool.server_address[1]
    signed = launch.Identity(via="token", sub="u_123", uid="u-123", role="artist")
    try:
        os.environ[SECRET_ENV] = SIGNING
        for label, ident in (("no identity", None),
                             ("a legacy caller", launch.Identity(via="legacy", sub="bob")),
                             ("an open (dev) caller", launch.Identity(via="open"))):
            Tool.identity = ident
            status, _, body = ask(port)
            check(f"{label} is refused (403)", status, 403)
        check("...and the launcher was never asked", FakeLauncher.seen, [])

        Tool.identity = signed
        os.environ[SECRET_ENV] = ""
        status, _, body = ask(port)
        check("no signing secret answers 503", status, 503)
        os.environ[SECRET_ENV] = SIGNING

        status, headers, body = ask(port)
        check("a signed user is answered", status, 200)
        text = "".join(json.loads(line).get("v", "") for line in body.decode().splitlines())
        check("...with the launcher's stream passed through", text, "Open the Regions panel.")
        check("...carrying the tool's session cookie", headers.get("Set-Cookie"), "iw_session=x")
        seen = FakeLauncher.seen[-1]
        check("the launcher was asked at /api/ask-ai", seen["path"], "/api/ask-ai")
        claims = launch.verify(SIGNING, seen["relay"], typ="relay", aud="launcher") or {}
        check("...with a relay token for this user", (claims.get("uid"), claims.get("iss")),
              ("u-123", "atlas"))
        check("...and the page's question untouched", seen["body"]["messages"][0]["content"], "How?")
        check("...asking for JSON first, so a refusal is worded, not an HTML page",
              seen["accept"].startswith("application/json"), True)

        FakeLauncher.status = 403
        status, _, body = ask(port)
        check("a launcher refusal keeps its status", status, 403)
        check("...and its wording", json.loads(body)["message"],
              "Your role does not have access to it.")
    finally:
        FakeLauncher.status = 200
        launcher.shutdown()
        tool.shutdown()
        os.environ.pop(SECRET_ENV, None)
        os.environ.pop("LAUNCHER_URL", None)


def test_script() -> None:
    js = ask_ai.script("atlasTool", "Invisible </script> Atlas")
    check("the page script mounts with the tool's id",
          '"tool": "atlasTool"' in js and js.rstrip().endswith(");"), True)
    check("...and a name cannot close the inline <script>", "</script>" in js, False)


if __name__ == "__main__":
    test_vector()
    test_relay()
    test_script()
    if FAILED:
        raise SystemExit(f"{len(FAILED)} check(s) failed")
    print("all ask-ai checks pass")
