"""Shared request-local (client, project) context base for the cloud tools.

Both the Atlas Maker and the Sheet Maker run as a ``ThreadingHTTPServer`` (one
thread per request) and hold the active ``(client, project)`` in a
``threading.local()`` so it is effectively *request-local*: ``set_context`` /
``switch_context`` mutate only the calling thread, and ``resolve()`` reads the
calling thread's state (falling back to env defaults if unset). Two concurrent
requests for different projects each see their own context; reads are lock-free.

**Never reintroduce module-global path state** — that was the original
cross-tenant write race. Each tool instantiates ONE :class:`ToolContext`; the
thread-local store, the ``_HYDRATED`` set and its lock all live PER INSTANCE.

The pieces that differ per tool (env-var names + defaults, the R2 namespace,
the staging base, and the tool-specific ``resolve()`` / ``hydrate()`` shapes)
are supplied by the owning ``cloud_paths.py``; everything generic lives here.
"""
from __future__ import annotations

import os
import re
import threading

# Reserved client key for legacy / NULL clientKey rows.
UNASSIGNED_CLIENT = "unassigned"

# Shared contract with the launcher: a project/client key is a slug.
PROJECT_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


def valid_project(key: str | None) -> str | None:
    """Return the key if it matches the shared slug contract, else None."""
    if key and PROJECT_SLUG_RE.match(key):
        return key
    return None


def valid_client(key: str | None) -> str | None:
    """Same slug rule as projects; kept as a separate alias so calling code
    reads clearly at the call site."""
    if key and PROJECT_SLUG_RE.match(key):
        return key
    return None


def safe_proj_name(name: str) -> str:
    """Filesystem-safe staging key for a client/project name."""
    return "".join(c if c.isalnum() else "_" for c in (name or "default"))[:60]


def r2_slug(name: str | None) -> str:
    """Canonical R2 slug for a client/project key. Byte-identical to the
    launcher's slug rule so both halves build the SAME `<C>/<P>` prefix — this
    also resolves the hyphen/underscore divergence (e.g. `my-game` ->
    `my_game`)."""
    s = re.sub(r"[^a-z0-9]", "_", (name or "default").lower())[:60]
    return s or "default"


def project_prefix(client: str, project: str) -> str:
    """Root of one project's R2 repo (`<client>/<project>`). All tools read and
    write under this shared, asset-typed tree. Replaces prefix_for_tool()."""
    return f"{client}/{project}"


def prefix_for_tool(tool: str, client: str, project: str) -> str:
    """DEPRECATED shim — the per-tool `<tool>/` segment is retired (the unified
    project repo keys are `<client>/<project>/...`). Kept only so nothing breaks
    mid-refactor; do NOT use it to build live keys."""
    return f"{tool}/{client}/{project}"


class ToolContext:
    """Per-tool, thread-local (client, project) context.

    Holds the env-var names + defaults for one tool plus its own
    ``threading.local`` store, ``_HYDRATED`` set and lock. The owning
    ``cloud_paths.py`` constructs one instance and delegates its public
    ``project_name`` / ``client_name`` / ``set_context`` / ``switch_context``
    helpers to it, so each service keeps a 100%-intact public API while the
    generic logic lives in one place.
    """

    def __init__(
        self,
        *,
        tool_namespace: str,
        project_env_var: str,
        client_env_var: str,
        project_default: str = "cloud",
        client_default: str = UNASSIGNED_CLIENT,
    ) -> None:
        self.tool_namespace = tool_namespace
        self.project_env_var = project_env_var
        self.client_env_var = client_env_var
        self.project_default = project_default
        self.client_default = client_default
        # Request-local context (thread-local == request-local under the
        # ThreadingHTTPServer). A thread that has not set a context falls back
        # to the env defaults (see ctx_get()).
        self._ctx = threading.local()
        # (client, project) pairs already hydrated this process. Shared across
        # threads, so a tiny lock guards the set; the actual pull is best-effort.
        self.hydrated: set[tuple[str, str]] = set()
        self.hydrate_lock = threading.Lock()

    # --- env defaults --------------------------------------------------------

    def env_project(self) -> str:
        """The default project from env (used until set_context() overrides)."""
        return (os.environ.get("IW_PROJECT_NAME") or "").strip() or os.environ.get(
            self.project_env_var, self.project_default
        )

    def env_client(self) -> str:
        """The default client from env. Order: IW_CLIENT_NAME (launcher-pinned)
        -> the tool's client env var -> the client default."""
        return (os.environ.get("IW_CLIENT_NAME") or "").strip() or os.environ.get(
            self.client_env_var, self.client_default
        )

    # --- thread-local read/write --------------------------------------------

    def ctx_get(self) -> tuple[str, str]:
        """The calling thread's (client, project), env defaults if unset."""
        client = getattr(self._ctx, "client", None)
        project = getattr(self._ctx, "project", None)
        if client is None or project is None:
            client = self.env_client()
            project = self.env_project()
            self._ctx.client = client
            self._ctx.project = project
        return client, project

    def project_name(self) -> str:
        return self.ctx_get()[1]

    def client_name(self) -> str:
        return self.ctx_get()[0]

    def set_context(self, client: str | None, project: str | None) -> bool:
        """Switch THIS thread's active (client, project). Idempotent if
        unchanged. Validates both keys against the slug contract; invalid/empty
        falls back to the env default for that key. Returns True if EITHER
        actually changed for this thread — the caller should then re-resolve
        paths and re-hydrate staging."""
        cur_client, cur_project = self.ctx_get()
        new_client = valid_client((client or "").strip()) or self.env_client()
        new_project = valid_project((project or "").strip()) or self.env_project()
        if new_client == cur_client and new_project == cur_project:
            return False
        self._ctx.client = new_client
        self._ctx.project = new_project
        return True

    # --- R2 prefix helpers ---------------------------------------------------

    def r2_project_prefix(self, client_key: str, proj_key: str) -> str:
        # Unified project repo: the `<tool>/` segment is dropped. `tool_namespace`
        # still names the staging dir + banner but no longer prefixes R2 keys.
        return project_prefix(client_key, proj_key)
