"""The "Ask the AI" chat on the Python tools' bar (Atlas Maker, Sheet Maker).

The chat itself is the launcher's (``POST /api/ask-ai``, ``$lib/server/askAi.ts``):
Claude answering as the tool's agent from the tool's guide. These tools live on
another site, so the launcher's session cookie never reaches a request their page
makes. The page therefore asks its OWN server (``POST /ask-ai``, ``ask_ai.js``
served inline through :func:`script`), and :func:`relay` forwards the question to
the launcher for the signed-in user with a short relay token in ``X-IW-Relay``:

    v1.<base64url({v:1, typ:"relay", aud:"launcher", iss, uid, iat, exp})>.<HMAC>

signed with the tool's launch secret (the same one the launcher signs its launch
tokens with; ``$lib/server/toolRelay.ts`` is the other half). The token only names
the user — the launcher reads their access from its own database — and the answer
stream is passed back to the page as it arrives.
"""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Callable

from . import launch

RELAY_HEADER = "X-IW-Relay"
RELAY_TTL = 60
# A whole conversation (40 turns of up to ~32k characters) fits well under this.
MAX_BODY = 1_000_000
# Claude can take a while to start answering a long guide; the stream then flows.
TIMEOUT = 120

_JS = (Path(__file__).resolve().parent / "ask_ai.js").read_text(encoding="utf-8")


def launcher_url() -> str:
    return (os.environ.get("LAUNCHER_URL") or "https://app.invisiblewall.org").rstrip("/")


def script(tool_id: str, tool_name: str) -> str:
    """The page half, ready to inline in a `<script>`: adds the Ask the AI button to
    the `.iw-toolbar` (before Report bug) and its chat window."""
    cfg = {"tool": tool_id, "toolName": tool_name, "endpoint": "/ask-ai",
           "launcher": launcher_url()}
    return _JS + "\niwAskAi.mount(" + json.dumps(cfg).replace("<", "\\u003c") + ");\n"


def relay_token(secret: str, iss: str, uid: str, now: float | None = None) -> str:
    iat = int(time.time() if now is None else now)
    return launch.sign(secret, {"v": 1, "typ": "relay", "aud": "launcher", "iss": iss,
                                "uid": uid, "iat": iat, "exp": iat + RELAY_TTL})


def _answer(handler, status: int, message: str, before_end: Callable[[], None]) -> None:
    body = json.dumps({"message": message}).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    before_end()
    handler.end_headers()
    handler.wfile.write(body)


def relay(handler, *, iss: str, secret_env: str, identity,
          before_end: Callable[[], None] = lambda: None) -> None:
    """Answer the page's `POST /ask-ai` by forwarding it to the launcher for
    `identity` and streaming the answer back. `before_end` adds the tool's own
    headers (its session Set-Cookie) before the headers end."""
    n = int(handler.headers.get("Content-Length", 0) or 0)
    if n > MAX_BODY:
        _answer(handler, 413, "That conversation is too long — start a new chat.", before_end)
        return
    body = handler.rfile.read(n) if n else b""
    uid = getattr(identity, "uid", "") if identity is not None else ""
    if getattr(identity, "via", "") != "token" or not uid:
        _answer(handler, 403, "Open this tool from the launcher to ask the AI.", before_end)
        return
    secret = (os.environ.get(secret_env) or "").strip()
    if not secret:
        _answer(handler, 503, "Ask the AI is not configured for this tool.", before_end)
        return

    req = urllib.request.Request(
        launcher_url() + "/api/ask-ai", data=body, method="POST",
        # JSON first: SvelteKit words a refusal as HTML to anything that doesn't ask for JSON.
        headers={"Content-Type": "application/json",
                 "Accept": "application/json, application/x-ndjson",
                 "User-Agent": f"Invisible-{iss}-tool/1.0",
                 RELAY_HEADER: relay_token(secret, iss, uid)})
    try:
        resp = urllib.request.urlopen(req, timeout=TIMEOUT)  # noqa: S310 — fixed https launcher
    except urllib.error.HTTPError as e:
        # The launcher's refusal is already worded for the person (`{message}`).
        try:
            message = json.loads(e.read() or b"{}").get("message") or ""
        except ValueError:
            message = ""
        _answer(handler, e.code, message or f"The AI could not answer ({e.code}).", before_end)
        return
    except (urllib.error.URLError, TimeoutError, OSError):
        _answer(handler, 502, "Could not reach the launcher. Try again in a moment.", before_end)
        return

    with resp:
        handler.send_response(200)
        handler.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
        handler.send_header("Cache-Control", "no-store")
        # No length: the answer streams until the launcher ends it.
        handler.send_header("Connection", "close")
        before_end()
        handler.end_headers()
        handler.close_connection = True
        try:
            while True:
                chunk = resp.read1(8192)
                if not chunk:
                    break
                handler.wfile.write(chunk)
                handler.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass  # the page closed the chat or stopped the answer
