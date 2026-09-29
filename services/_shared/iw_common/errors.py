"""Error reporting (Sentry) for the stdlib-http cloud tools.

    init_error_tracking("atlas-tool")   # once, in main(), before serving
    capture_error(exc, route="/x")      # at a choke point that swallows an error

Off unless ``SENTRY_DSN`` is set: with no DSN nothing is imported from
``sentry_sdk`` and every call here is a no-op, so a local run or a test never
reports anything. A missing ``sentry_sdk`` package is the same no-op.

The tools' access gate takes its shared secret as ``?k=``, as an
``atlas_tool=`` / ``sheet_tool=`` cookie and as an ``X-*-Secret`` header, and the
R2 client signs URLs with it in the query. So ``_before_send`` drops request
cookies/headers outright and blanks secret-looking query params, ``name=value``
pairs and the literal values of the secret env vars from every string in the
event — URLs, messages, exception text and breadcrumbs alike.

Stdlib ``http.server`` never lets Sentry see a handler exception: socketserver
catches it and prints it via ``handle_error``. ``ReportingServerMixin`` puts the
capture there; the handlers' own catch-and-500 sites call ``capture_request_error``.
"""
from __future__ import annotations

import os
import re
import sys
import urllib.parse
from typing import Any

_enabled = False

FILTERED = "[Filtered]"

# Matched exactly (short names would false-positive as substrings).
_EXACT = {"k", "sid", "key", "pw", "pass", "atlas_tool", "sheet_tool"}
# Matched as a substring of the lower-cased name.
_PARTS = ("session", "token", "secret", "password", "passwd", "signature",
          "credential", "apikey", "api_key", "api-key", "auth", "cookie",
          "access_key", "access-key", "private")

_PAIR_RE = re.compile(r"(?P<name>[A-Za-z0-9_.\-]+)=(?P<value>[^&\s;,\"'<>]+)")

# Env vars whose VALUE must never appear anywhere in an event.
_SECRET_ENV_RE = re.compile(r"SECRET|TOKEN|PASSWORD|API_KEY|ACCESS_KEY|_KEY$|DSN", re.I)
_MIN_SECRET_LEN = 8


def is_sensitive(name: str) -> bool:
    n = (name or "").strip().lower()
    return n in _EXACT or any(p in n for p in _PARTS)


def _secret_values() -> list[str]:
    vals = {v for k, v in os.environ.items()
            if _SECRET_ENV_RE.search(k) and v and len(v) >= _MIN_SECRET_LEN}
    return sorted(vals, key=len, reverse=True)


def scrub_text(text: str, secrets: list[str] | None = None) -> str:
    """Blank secret-looking `name=value` pairs and known secret values."""
    if not text:
        return text
    for s in secrets if secrets is not None else _secret_values():
        if s in text:
            text = text.replace(s, FILTERED)
    return _PAIR_RE.sub(
        lambda m: f"{m.group('name')}={FILTERED}" if is_sensitive(m.group("name"))
        else m.group(0), text)


def scrub_url(url: str) -> str:
    """The path of a request URL with its sensitive query values blanked."""
    try:
        parts = urllib.parse.urlsplit(url or "")
    except ValueError:
        return scrub_text(url or "")
    if not parts.query:
        return scrub_text(url or "")
    q = [(k, FILTERED if is_sensitive(k) else v)
         for k, v in urllib.parse.parse_qsl(parts.query, keep_blank_values=True)]
    return scrub_text(urllib.parse.urlunsplit(
        parts._replace(query=urllib.parse.urlencode(q, safe="[]"))))


def _scrub(obj: Any, secrets: list[str]) -> Any:
    if isinstance(obj, str):
        return scrub_text(obj, secrets)
    if isinstance(obj, dict):
        return {k: (FILTERED if isinstance(k, str) and is_sensitive(k)
                    else _scrub(v, secrets)) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_scrub(v, secrets) for v in obj]
    if isinstance(obj, tuple):
        return tuple(_scrub(v, secrets) for v in obj)
    return obj


def _before_send(event: dict, hint: dict | None = None) -> dict:
    req = event.get("request")
    if isinstance(req, dict):
        for k in ("cookies", "headers", "env", "data"):
            req.pop(k, None)
        if "url" in req:
            req["url"] = scrub_url(str(req["url"]))
        if "query_string" in req:
            req["query_string"] = urllib.parse.urlsplit(
                scrub_url("?" + str(req["query_string"]))).query
    return _scrub(event, _secret_values())


def _before_breadcrumb(crumb: dict, hint: dict | None = None) -> dict:
    return _scrub(crumb, _secret_values())


def init_error_tracking(service: str) -> bool:
    """Start Sentry for `service` when SENTRY_DSN is set. True iff it started."""
    global _enabled
    dsn = (os.environ.get("SENTRY_DSN") or "").strip()
    if not dsn:
        return False
    try:
        import sentry_sdk
        from sentry_sdk.integrations.logging import LoggingIntegration
    except ImportError:
        print("[errors] SENTRY_DSN is set but sentry-sdk is not installed", flush=True)
        return False
    try:
        rate = float(os.environ.get("SENTRY_SAMPLE_RATE") or 1.0)
    except ValueError:
        rate = 1.0
    sentry_sdk.init(
        dsn=dsn,
        environment=(os.environ.get("SENTRY_ENVIRONMENT") or "production").strip(),
        release=(os.environ.get("RAILWAY_GIT_COMMIT_SHA") or "").strip() or None,
        sample_rate=rate,
        traces_sample_rate=None,
        # No sentry-trace/baggage headers on outbound calls (ComfyUI through
        # Cloudflare Access, signed R2 requests): errors only, no tracing.
        trace_propagation_targets=[],
        send_default_pii=False,
        # Frame locals hold the gate's cookie/secret comparisons verbatim.
        include_local_variables=False,
        before_send=_before_send,
        before_breadcrumb=_before_breadcrumb,
        # Log lines stay breadcrumbs: the capture points below are the events,
        # so a logged-and-captured failure is reported once.
        integrations=[LoggingIntegration(event_level=None)],
    )
    sentry_sdk.set_tag("service", service)
    _enabled = True
    print(f"[errors] Sentry error reporting on for {service}", flush=True)
    return True


def enabled() -> bool:
    return _enabled


def capture_error(exc: BaseException, **tags: Any) -> None:
    """Report `exc` with extra tags. No-op when reporting is off."""
    if not _enabled:
        return
    try:
        import sentry_sdk
        clean = {k: scrub_text(str(v))[:200] for k, v in tags.items() if v is not None}
        sentry_sdk.capture_exception(exc, tags=clean)
    except Exception:  # noqa: BLE001 — reporting must never break the caller
        pass


def capture_request_error(handler: Any, exc: BaseException) -> None:
    """Report an exception raised while `handler` served a request.

    Called from inside except blocks that still have a response to write, so it
    must never raise itself — a client-controlled path (`//[x`) makes `urlsplit`
    throw, which would drop the 500 the caller was about to send."""
    if not _enabled:
        return
    try:
        raw = str(getattr(handler, "path", "") or "")
        capture_error(exc, method=getattr(handler, "command", "") or "",
                      path=urllib.parse.urlsplit(raw).path, url=scrub_url(raw))
    except Exception:
        pass


def _handler_in_traceback(tb: Any) -> Any:
    from http.server import BaseHTTPRequestHandler
    found = None
    while tb is not None:
        cand = tb.tb_frame.f_locals.get("self")
        if isinstance(cand, BaseHTTPRequestHandler):
            found = cand
        tb = tb.tb_next
    return found


class ReportingServerMixin:
    """Mix in BEFORE the socketserver class: reports what `handle_error` prints.

    socketserver calls `handle_error` from inside the except block, so the
    exception is still `sys.exc_info()`. The handler instance is not passed in;
    it is recovered from the traceback's frames for the method + path tags."""

    def handle_error(self, request, client_address):  # noqa: ANN001
        exc = sys.exc_info()[1]
        if _enabled and exc is not None and not isinstance(exc, (ConnectionError, TimeoutError)):
            try:
                handler = _handler_in_traceback(exc.__traceback__)
                if handler is not None:
                    capture_request_error(handler, exc)
                else:
                    capture_error(exc)
            except Exception:
                pass
        super().handle_error(request, client_address)  # type: ignore[misc]
