"""The request-handler base the Atlas Maker and the Sheet Maker share.

Both tools are stdlib ``http.server`` apps behind the same launcher gate
(``iw_common.launch``), so the plumbing every request goes through was two
parallel copies: answering with the gate's cookies, authenticating, and
applying the caller's (client, project) to the request thread. It lives here
once; each tool's ``Handler`` subclasses ``ToolHandler`` and names what differs:

  - ``gate`` / ``tool_title`` — its ``LaunchGate`` and the name its refusal
    tells the caller to open from the launcher;
  - ``_switch_context(client, project)`` — its own ``cloud_paths``;
  - anything it adds to a response (the Atlas Maker overrides ``_send`` to
    record that it answered and to attach the doc versions the request saw).
"""
from __future__ import annotations

from collections.abc import Mapping
from http.server import BaseHTTPRequestHandler
from typing import ClassVar

from iw_common import launch


class ToolHandler(BaseHTTPRequestHandler):
    """Gate, scope and response plumbing for one tool's requests."""

    gate: ClassVar[launch.LaunchGate]
    #: "Atlas Maker" → "Forbidden — open the Atlas Maker from the launcher."
    tool_title: ClassVar[str] = ""

    _identity: launch.Identity
    _extra_cookies: list[str]

    def log_message(self, *a):  # quieter console
        pass

    def _send_gate_cookies(self) -> None:
        """The gate's Set-Cookie headers (session, or the legacy scope cookies) —
        one header each, which a headers dict cannot hold."""
        for c in getattr(self, "_extra_cookies", None) or ():
            self.send_header("Set-Cookie", c)

    def _send(self, code: int, ctype: str, body: bytes,
              extra_headers: Mapping[str, str] | None = None, *,
              no_store: bool = True) -> None:
        """Answer the request: status, type, length, `extra_headers`, the gate's
        cookies, then `body`.

        `Cache-Control: no-store` is the default (HTML/JSON are dynamic); a
        caller that wants a cacheable answer passes its own Cache-Control (image
        routes, via `imgcache.cache_headers`), which then wins instead of being
        sent beside an uncacheable one. `no_store=False` sends neither."""
        headers = extra_headers or {}
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        if no_store and "Cache-Control" not in headers:
            self.send_header("Cache-Control", "no-store")
        for k, v in headers.items():
            self.send_header(k, v)
        self._send_gate_cookies()
        self.end_headers()
        self.wfile.write(body)

    def _authenticate(self) -> bool:
        """Who is calling and for which (client, project) — see
        iw_common/launch.py. Answers the request itself and returns False on a
        refusal, and on a launch (the redirect that takes the token out of the
        URL once the session cookie is set)."""
        res = self.gate.authenticate(self.path, self.headers)
        self._identity = res.identity
        self._extra_cookies = list(res.cookies)
        if not res.ok:
            self._send(403, "text/plain; charset=utf-8",
                       f"Forbidden — open the {self.tool_title} from the launcher."
                       .encode("utf-8"))
            return False
        if res.redirect and self.command == "GET":
            self._send(303, "text/plain", b"", {"Location": res.redirect})
            return False
        return True

    def _switch_context(self, client: str, project: str) -> None:
        """Make (client, project) this request thread's scope — the tool's own
        `cloud_paths.switch_context`."""
        raise NotImplementedError

    def _resolve_context(self) -> None:
        """Apply the caller's (client, project) to THIS request thread.

        With a signed launch the scope comes from the token/session ONLY — a
        `?client=` / `?project=` in the URL is ignored, and switching project
        goes back through the launcher. The legacy/open modes keep the old
        query-then-cookie resolution (done in the gate). Missing keys fall back
        to the tool's env default.

        Thread-local: a concurrent request for a different project is fully
        isolated; everything that resolves a path reads this thread's context."""
        self._switch_context(self._identity.client, self._identity.project)
