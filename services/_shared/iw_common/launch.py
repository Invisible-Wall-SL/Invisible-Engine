"""Who is calling, and for which (client, project) — from a launcher-signed token.

The launcher is the only thing that decides who may open a tool and on which
project. After its own access check it mints a short-lived launch token

    v1.<base64url(json payload)>.<base64url(HMAC-SHA256(secret, "v1." + payload))>

with ``{v, typ:"launch", aud, sub, uid, name, role, client, project, caps, iat, exp}``
(``sub`` = the R2 slug of the user id, ``uid`` = the launcher's real ``users.id``)
(``apps/launcher-api/src/lib/server/toolLaunch.ts`` is the other half; both must
agree byte for byte). The browser arrives with ``?iw_launch=<token>`` (accepted
once); a server-to-server caller sends a ``typ:"api"`` token as the
``X-IW-Launch`` header instead, so a token seen in a URL is never valid there.

With neither secret set the tool is open for local dev — but never on Railway
(``RAILWAY_ENVIRONMENT`` set), where a missing secret must not open it.

    GATE = LaunchGate(aud="atlas", signing_env="ATLAS_TOOL_SIGNING_SECRET",
                      legacy_env="ATLAS_TOOL_SECRET", legacy_cookie="atlas_tool",
                      legacy_header="X-Atlas-Secret")
    res = GATE.authenticate(self.path, self.headers)

A valid launch token becomes a signed session cookie (same claims, longer
expiry — never the secret itself) and the browser is redirected to the same URL
without the token. Every later request is scoped from that cookie ONLY: a
``?client=`` / ``?project=`` in the URL is ignored. Switching project means
going back through the launcher, which mints a new token.

Transition: the old shared-secret handoff (``?k=`` + unsigned
``client``/``project``/``user``) is still accepted until
:data:`LEGACY_CUTOVER` (override with ``IW_LEGACY_TOOL_KEY_UNTIL=YYYY-MM-DD``,
or ``off`` to end it now). While a tool has no signing secret at all, the legacy
gate is the only gate and stays on. With neither secret set the tool is open
(local dev) and takes its scope from the query/cookie as before.

A session carries the role and capabilities of its launch for its whole life:
a change to either applies on the user's next launch. Rotating the signing
secret ends every session of that tool at once.
"""
from __future__ import annotations

import base64
import datetime as _dt
import hashlib
import hmac
import json
import os
import re
import threading
import time
import urllib.parse
from dataclasses import dataclass, field

from .context import valid_client, valid_project

TOKEN_VERSION = "v1"
LAUNCH_PARAM = "iw_launch"
LAUNCH_HEADER = "X-IW-Launch"
# A launch token only has to survive one redirect.
LAUNCH_TTL_MAX = 300
SESSION_TTL = 12 * 3600
CLOCK_SKEW = 60

LEGACY_ENV = "IW_LEGACY_TOOL_KEY_UNTIL"
# Last day (UTC, inclusive) a tool that HAS a signing secret still accepts ?k=.
LEGACY_CUTOVER = "2026-10-13"
# Query params the legacy handoff carried; stripped from the URL after a launch.
_HANDOFF_PARAMS = (LAUNCH_PARAM, "k", "client", "project", "user", "bp")

ADMIN_ROLE = "admin"
PUBLISH_CAP = "blueprintPublish"


def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64d(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _sig(secret: str, payload_b64: str) -> str:
    mac = hmac.new(secret.encode("utf-8"),
                   f"{TOKEN_VERSION}.{payload_b64}".encode("ascii"), hashlib.sha256)
    return _b64e(mac.digest())


def sign(secret: str, payload: dict) -> str:
    payload_b64 = _b64e(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    return f"{TOKEN_VERSION}.{payload_b64}.{_sig(secret, payload_b64)}"


def verify(secret: str, token: str | None, *, typ: str, aud: str,
           now: float | None = None) -> dict | None:
    """The payload of a genuine, unexpired token of this type and audience;
    None for anything else (bad signature, edited payload, wrong tool, expired,
    malformed). Never raises."""
    if not secret or not token:
        return None
    parts = token.strip().split(".")
    if len(parts) != 3 or parts[0] != TOKEN_VERSION or not parts[1].isascii():
        return None
    if not _eq(_sig(secret, parts[1]), parts[2]):
        return None
    try:
        payload = json.loads(_b64d(parts[1]))
    except (ValueError, UnicodeDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    if payload.get("v") != 1 or payload.get("typ") != typ or payload.get("aud") != aud:
        return None
    t = time.time() if now is None else now
    iat, exp = payload.get("iat"), payload.get("exp")
    if not isinstance(iat, (int, float)) or not isinstance(exp, (int, float)):
        return None
    if iat > t + CLOCK_SKEW or exp <= t:
        return None
    if typ in ("launch", "api") and exp - iat > LAUNCH_TTL_MAX:
        return None
    return payload


@dataclass(frozen=True)
class Identity:
    """The caller. ``via`` is ``token`` (signed), ``legacy`` (shared secret —
    client/project are whatever the URL said) or ``open`` (no gate configured)."""
    via: str
    sub: str = ""
    uid: str = ""
    name: str = ""
    role: str = ""
    client: str | None = None
    project: str | None = None
    caps: tuple[str, ...] = ()

    @property
    def is_admin(self) -> bool:
        return self.via == "open" or self.role == ADMIN_ROLE

    def can(self, cap: str) -> bool:
        return cap in self.caps


def may_control(requester: Identity | None, owner: dict | None) -> bool:
    """May `requester` stop/replace something `owner` started? The owner and an
    admin may; nobody is locked out of a job that recorded no owner. A job
    started under a signed identity only matches a signed caller — a legacy
    caller names itself in the URL, so its id proves nothing."""
    if not owner or not owner.get("id"):
        return True
    if requester is None:
        return False
    if requester.is_admin:
        return True
    if owner.get("via", "token") == "token" and requester.via != "token":
        return False
    return bool(requester.sub) and requester.sub == owner["id"]


@dataclass
class GateResult:
    ok: bool
    identity: Identity | None = None
    cookies: list[str] = field(default_factory=list)
    # Where to send the browser instead of serving (the URL minus the token).
    redirect: str | None = None


def _cookie(header: str, name: str) -> str:
    m = re.search(r"(?:^|;)\s*" + re.escape(name) + r"=([^;]*)", header or "")
    return m.group(1).strip() if m else ""


def _eq(a: str, b: str) -> bool:
    return hmac.compare_digest((a or "").encode("utf-8"), (b or "").encode("utf-8"))


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "_", (value or "").lower())[:60]


def legacy_until(today: _dt.date | None = None) -> bool:
    """Is the legacy ?k= handoff still inside its window (for a tool that has a
    signing secret)?"""
    raw = (os.environ.get(LEGACY_ENV) or LEGACY_CUTOVER).strip().lower()
    if raw in ("off", "0", "false", "no"):
        return False
    try:
        until = _dt.date.fromisoformat(raw)
    except ValueError:
        return False
    return (today or _dt.datetime.now(_dt.timezone.utc).date()) <= until


class LaunchGate:
    def __init__(self, *, aud: str, signing_env: str, legacy_env: str,
                 legacy_cookie: str, legacy_header: str) -> None:
        self.aud = aud
        self.signing_env = signing_env
        self.legacy_env = legacy_env
        self.legacy_cookie = legacy_cookie
        self.legacy_header = legacy_header
        self.session_cookie = f"iw_{aud}_session"
        # Launch tokens already exchanged for a cookie (signature -> exp), so a
        # token copied out of a URL cannot start a second session.
        self._used: dict[str, float] = {}
        self._used_lock = threading.Lock()

    # Read per call so an env change (tests, a redeploy) needs no restart logic.
    @property
    def signing_secret(self) -> str:
        return os.environ.get(self.signing_env, "").strip()

    @property
    def legacy_secret(self) -> str:
        return os.environ.get(self.legacy_env, "").strip()

    def mode(self) -> str:
        """``signed``, ``legacy`` (old gate only), ``open`` (local dev) or
        ``closed`` (no secret on Railway — refuse everything)."""
        if self.signing_secret:
            return "signed"
        if self.legacy_secret:
            return "legacy"
        on_railway = any(os.environ.get(k) for k in
                         ("RAILWAY_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME", "RAILWAY_PROJECT_ID"))
        return "closed" if on_railway else "open"

    def describe(self) -> str:
        """One startup log line: which gate is live, and until when ?k= is."""
        mode = self.mode()
        if mode == "signed":
            tail = (f"legacy ?k= accepted until {os.environ.get(LEGACY_ENV) or LEGACY_CUTOVER}"
                    if self.legacy_accepted() else "legacy ?k= refused")
            return f"[gate] signed launch tokens ({self.signing_env}); {tail}"
        if mode == "legacy":
            return (f"[gate] WARNING: {self.signing_env} unset - only the legacy shared-secret "
                    "handoff is active")
        if mode == "closed":
            return (f"[gate] ERROR: neither {self.signing_env} nor {self.legacy_env} is set "
                    "on Railway - refusing every request except /healthz")
        return "[gate] open (no secrets set - local dev)"

    def legacy_accepted(self) -> bool:
        if not self.legacy_secret:
            return False
        return not self.signing_secret or legacy_until()

    def mint_session(self, claims: dict, now: float | None = None) -> str:
        t = int(time.time() if now is None else now)
        payload = {"v": 1, "typ": "session", "aud": self.aud}
        payload.update({k: claims.get(k) for k in
                        ("sub", "uid", "name", "role", "client", "project", "caps")})
        payload.update(iat=t, exp=t + SESSION_TTL)
        return sign(self.signing_secret, payload)

    def _claims_identity(self, claims: dict) -> Identity | None:
        client = valid_client(str(claims.get("client") or ""))
        project = valid_project(str(claims.get("project") or ""))
        if not client or not project:
            return None
        caps = claims.get("caps")
        return Identity(
            via="token", sub=_slug(str(claims.get("sub") or "")),
            uid=str(claims.get("uid") or "")[:64],
            name=str(claims.get("name") or "")[:120], role=str(claims.get("role") or ""),
            client=client, project=project,
            caps=tuple(c for c in caps if isinstance(c, str)) if isinstance(caps, list) else ())

    def _first_use(self, token: str, exp: float) -> bool:
        key = token.rsplit(".", 1)[-1]
        now = time.time()
        with self._used_lock:
            for k in [k for k, e in self._used.items() if e <= now]:
                del self._used[k]
            if key in self._used:
                return False
            self._used[key] = exp
            return True

    def authenticate(self, raw_path: str, headers) -> GateResult:
        parsed = urllib.parse.urlparse(raw_path)
        q = urllib.parse.parse_qs(parsed.query)
        cookie_header = headers.get("Cookie", "") or ""
        secret = self.signing_secret

        if secret:
            launch = (q.get(LAUNCH_PARAM, [""])[0] or "").strip()
            if launch:
                claims = verify(secret, launch, typ="launch", aud=self.aud)
                ident = self._claims_identity(claims) if claims else None
                if ident and self._first_use(launch, claims["exp"]):
                    return GateResult(
                        ok=True, identity=ident,
                        cookies=[f"{self.session_cookie}={self.mint_session(claims)}; "
                                 f"Path=/; Max-Age={SESSION_TTL}; HttpOnly; Secure; "
                                 "SameSite=Lax"],
                        redirect=_strip_handoff(parsed))
            header_token = (headers.get(LAUNCH_HEADER, "") or "").strip()
            if header_token:
                claims = verify(secret, header_token, typ="api", aud=self.aud)
                ident = self._claims_identity(claims) if claims else None
                return GateResult(ok=ident is not None, identity=ident)
            claims = verify(secret, _cookie(cookie_header, self.session_cookie),
                            typ="session", aud=self.aud)
            ident = self._claims_identity(claims) if claims else None
            if ident:
                return GateResult(ok=True, identity=ident)

        if self.legacy_accepted():
            ok, cookies = self._legacy_gate(q, cookie_header, headers)
            if not ok:
                return GateResult(ok=False)
            ident, scope_cookies = self._legacy_scope("legacy", q, cookie_header)
            return GateResult(ok=True, identity=ident, cookies=cookies + scope_cookies)

        if self.mode() == "open":
            ident, scope_cookies = self._legacy_scope("open", q, cookie_header)
            return GateResult(ok=True, identity=ident, cookies=scope_cookies)
        return GateResult(ok=False)

    # --- the pre-token handoff (removed after LEGACY_CUTOVER) ---------------

    def _legacy_gate(self, q, cookie_header: str, headers) -> tuple[bool, list[str]]:
        secret = self.legacy_secret
        if _eq(_cookie(cookie_header, self.legacy_cookie), secret):
            return True, []
        if _eq(headers.get(self.legacy_header, "") or "", secret):
            return True, []
        if _eq(q.get("k", [""])[0] or "", secret):
            return True, [f"{self.legacy_cookie}={secret}; Path=/; HttpOnly; "
                          "SameSite=None; Secure"]
        return False, []

    def _legacy_scope(self, via: str, q, cookie_header: str) -> tuple[Identity, list[str]]:
        """Scope as the tools always took it: ?client/?project/?user, stuck into
        cookies so in-tool navigation keeps it."""
        cookies: list[str] = []
        picked: dict[str, str | None] = {}
        for key, check in (("client", valid_client), ("project", valid_project),
                           ("user", lambda v: _slug(v) or None)):
            param = (q.get(key, [""])[0] or "").strip()
            value = check(param) or check(_cookie(cookie_header, f"iw_{key}"))
            if param and value:
                cookies.append(f"iw_{key}={value}; Path=/; SameSite=None; Secure")
            picked[key] = value
        return Identity(via=via, sub=picked["user"] or "", client=picked["client"],
                        project=picked["project"]), cookies


def healthz_body(service: str, build: str) -> bytes:
    """The gate-exempt `/healthz` answer: liveness plus which code is running."""
    commit = (os.environ.get("RAILWAY_GIT_COMMIT_SHA") or "")[:12]
    return json.dumps({"ok": True, "service": service, "build": build,
                       "commit": commit}).encode("utf-8")


def _strip_handoff(parsed: urllib.parse.ParseResult) -> str:
    kept = [(k, v) for k, v in urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
            if k not in _HANDOFF_PARAMS]
    # Always a local path: never a scheme-relative `//host` redirect.
    path = "/" + (parsed.path or "").lstrip("/")
    return path + (f"?{urllib.parse.urlencode(kept)}" if kept else "")
