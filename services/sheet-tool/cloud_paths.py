"""Cloud drop-in replacement for project_paths.py (Invisible Sheet Maker).

Same `resolve()` dict shape the tool already consumes, but:
  - input_dir / output_root point at a local *staging* directory (ephemeral
    container disk) so all existing pathlib/PIL code is unchanged;
  - the staging tree mirrors an R2 prefix 1:1 (see storage.py) so state
    survives container restarts.

The Sheet Maker is pure Pillow/CPU — it does NOT drive ComfyUI. It packs loose
sprite PNGs into a sheet and writes a `.atlas` / TexturePacker JSON / the
Invisible AI manifest. The authored manifest lands in the SHARED `manifests/`
folder both tools read/write — no cross-tool copy needed.

Extra keys added to resolve(): `r2_project_prefix`, `staging_root`,
`manifest_dir`, `client`,
`client_key`, `project_key`. `atlas_maker_dir` is None in the cloud (no sibling
folder); the shared `manifests/` tree replaces the old handoff.

**Unified project repo:** R2 layout is `<client>/<project>/...`, organized by
asset type and SHARED by all tools (the old `<tool>/` segment is retired). The
Sheet Maker's subfolders are `manifests/` (shared with the Atlas Maker),
`sheet_src/<sheet>/` (uploaded loose sprites), `sheets/<sheet>/` (packed
output). Client/project isolation is preserved — still `<C>/<P>` at the root.

**Concurrency (request-local context):** the server is a ThreadingHTTPServer
(one thread per request), so the active (client, project) is held in a
`threading.local()` — thread-local == request-local. `set_context` /
`switch_context` write the CALLING thread's local; `resolve()` reads the calling
thread's state (env defaults if unset). Two concurrent requests for different
projects each see their own context; reads are lock-free. The staging tree is
keyed by (client, project) so their local-disk trees never collide.

This module is now a THIN tool-specific layer: the thread-local context base,
R2 storage and slug validation all live in `iw_common`. The full public API
(every name the tool imports) is preserved here as wrappers.
"""
from __future__ import annotations

import contextlib
import os
import shutil
import threading
from pathlib import Path

import storage

from iw_common.context import (
    PROJECT_SLUG_RE,
    UNASSIGNED_CLIENT,
    ToolContext,
    prefix_for_tool,
    project_prefix,
    r2_slug,
    safe_proj_name as _safe_proj_name,
    valid_client,
    valid_project,
)

STAGING_BASE = Path(os.environ.get("SHEET_STAGING", "/tmp/sheet-tool"))
TOOL_NAMESPACE = "sheet_maker"

# One per-tool thread-local context (env names + defaults supplied here).
_CTX = ToolContext(
    tool_namespace=TOOL_NAMESPACE,
    project_env_var="SHEET_PROJECT",
    client_env_var="SHEET_CLIENT",
    project_default="cloud",
    client_default=UNASSIGNED_CLIENT,
)


# --- env defaults (public API; delegate to the shared context) ---------------

def env_project() -> str:
    """The default project from env (used until set_context() overrides it)."""
    return _CTX.env_project()


def env_client() -> str:
    """The default client from env (used until set_context() overrides it)."""
    return _CTX.env_client()


# --- request-local context (public API; delegate to the shared context) ------

def _ctx_get() -> tuple[str, str]:
    """The calling thread's (client, project), env defaults if unset."""
    return _CTX.ctx_get()


def project_name() -> str:
    return _CTX.project_name()


def client_name() -> str:
    return _CTX.client_name()


def set_context(client: str | None, project: str | None) -> bool:
    """Switch THIS thread's active (client, project). Idempotent if unchanged.

    Validates both keys against the slug contract; invalid/empty falls back to
    the env default for that key. Returns True if EITHER actually changed for
    this thread."""
    return _CTX.set_context(client, project)


# Back-compat alias.
def set_project(key: str) -> bool:
    return set_context(client_name(), key)


def r2_project_prefix(client_key: str, proj_key: str) -> str:
    return _CTX.r2_project_prefix(client_key, proj_key)


# (client, project) pairs already hydrated this process. Aliased to the shared
# context's set/lock so the race-fix invariant (per-instance state) is intact.
_HYDRATED: set[tuple[str, str]] = _CTX.hydrated
_HYDRATE_LOCK: threading.Lock = _CTX.hydrate_lock

# Listing state written locally that is NOT KNOWN to be in R2, as
# (client, project, kind, name) where kind is "manifests" (name = filename) or
# "sheets" (name = sheet). `prune_listing_ghosts` refuses to delete these.
#
# The claim means "unpushed", NOT "this tool wrote it once". An add-only set
# would exempt every sheet the container has ever saved — i.e. exactly the ones
# another replica goes on to delete — so the ghost would survive the prune built
# to remove it. `_mirror` claims BEFORE the push and releases on a CONFIRMED
# one, leaving only genuinely-unpushed work protected. The Atlas Maker solves
# the same problem with a plain set, which is enough there because nothing holds
# a claim across several writes; here a handler does, hence the count and the
# separate failure flag below.
# A COUNT, not a flag. Two holders overlap constantly: the handler claims the
# sheet for the whole operation, while `_mirror` claims-and-releases around each
# individual push. With a set, `_mirror` releasing after the FIRST confirmed push
# dropped the handler's protection with three writes still to come — the export
# then wrote `.atlas`/`.json`/the manifest into a directory a concurrent prune
# had already removed. A refcount makes the releases independent: protection
# lasts until every holder has let go.
_AUTHORED: dict[tuple[str, str, str, str], int] = {}
# Keys whose LAST push failed. Separate from the counts on purpose: a count is
# balanced (every holder releases), so recording a failure as a permanent extra
# unit would leak monotonically — one transient R2 error and that sheet is never
# prunable again on this container, with the held-claims line printing for ever.
# That is the ghost symptom returning by another door. A flag self-heals: the
# next confirmed push of the same key clears it.
_UNPUSHED: set[tuple[str, str, str, str]] = set()
_AUTHORED_LOCK = threading.Lock()


def note_authored(client_key: str, proj_key: str, kind: str, name: str) -> None:
    """Take a claim on `<kind>/<name>` — written here, not known to be in R2.

    Keys are explicit so a worker that forgot `set_context` cannot silently
    record under the env defaults and quietly make its own work prunable."""
    key = (client_key, proj_key, kind, name)
    with _AUTHORED_LOCK:
        _AUTHORED[key] = _AUTHORED.get(key, 0) + 1


def clear_authored(client_key: str, proj_key: str, kind: str, name: str) -> None:
    """Drop ONE claim. The state is protected until the count reaches zero."""
    key = (client_key, proj_key, kind, name)
    with _AUTHORED_LOCK:
        n = _AUTHORED.get(key, 0) - 1
        if n > 0:
            _AUTHORED[key] = n
        else:
            _AUTHORED.pop(key, None)


def mark_pushed(client_key: str, proj_key: str, kind: str, name: str,
                landed: bool) -> None:
    """Record whether this key's last push reached R2.

    `landed=False` protects it until a push succeeds; `landed=True` clears that
    protection. Call it around EVERY push of listing state — the balanced
    claim/release pair only covers the write window, not a push that failed."""
    key = (client_key, proj_key, kind, name)
    with _AUTHORED_LOCK:
        if landed:
            _UNPUSHED.discard(key)
        else:
            _UNPUSHED.add(key)


@contextlib.contextmanager
def authored_scope(client_key: str, proj_key: str, kind: str, name: str):
    """Hold a claim for the WHOLE of an operation, released on every exit path.

    This is what a handler that writes several files into one directory must
    use: the protection has to outlive the first push, and it has to survive an
    early `return` or an exception."""
    note_authored(client_key, proj_key, kind, name)
    try:
        yield
    finally:
        clear_authored(client_key, proj_key, kind, name)


def forget(client_key: str, proj_key: str, kind: str, name: str) -> None:
    """Forget everything about a key whose files are GONE for good.

    Rename and delete remove a name from R2 AND from staging, so nothing will
    ever push under it again. A failure flag left behind would then be
    permanent: the stuck-work diagnostic would print on every state load for
    ever, and if a later pull re-created the name locally it would be immortal."""
    key = (client_key, proj_key, kind, name)
    with _AUTHORED_LOCK:
        _AUTHORED.pop(key, None)
        _UNPUSHED.discard(key)


def unpushed_count(client_key: str, proj_key: str) -> int:
    """How many of this project's keys have a FAILED push outstanding.

    The diagnostic the prune's caller logs. Deliberately NOT unioned with the
    in-flight claims: those come and go with every ordinary export, so a union
    makes the line fire constantly and it stops meaning "something is stuck" —
    which is the only reason it exists ("the deleted sheet is still there", with
    nothing to look at)."""
    with _AUTHORED_LOCK:
        return sum(1 for k in _UNPUSHED if k[:2] == (client_key, proj_key))


def in_flight_count(client_key: str, proj_key: str) -> int:
    """How many claims this project holds right now (writes in progress).

    A test seam — production logs `unpushed_count`, which is the one that means
    "something is stuck". Kept because the claim's LIFETIME is the part of this
    machinery that has been got wrong most often, and it is not observable from
    the outside any other way."""
    with _AUTHORED_LOCK:
        return sum(1 for k in _AUTHORED if k[:2] == (client_key, proj_key))


def is_protected(client_key: str, proj_key: str, kind: str, name: str) -> bool:
    """Whether the prune must leave `<kind>/<name>` alone — either a write is in
    flight or its last push did not land.

    A test seam, for the same reason as `in_flight_count`: the fixture asserts
    this holds at the exact instant `_mirror` releases its count, which is where
    an ordering bug once left a window for the prune."""
    key = (client_key, proj_key, kind, name)
    with _AUTHORED_LOCK:
        return key in _AUTHORED or key in _UNPUSHED


def prune_listing_ghosts(client_key: str, proj_key: str,
                         staging_root: Path) -> tuple[int, int]:
    """Drop staged sheets/manifests R2 no longer has. Returns (sheets, manifests).

    The mirror image of the Atlas Maker's `prune_manifests`, and needed for the
    same reason: `pull_prefix` only ever DOWNLOADS, so anything deleted at the
    SOURCE — by another replica, by the Atlas Maker writing to the shared
    `manifests/` prefix, or straight in the bucket — lives on in this container's
    staging. The rail lists local `sheets/` directories, so a deleted sheet keeps
    appearing there; `_refresh_listing_subtrees` re-pulls on EVERY state load and
    still could not make one go away.

    Three rails:
      - prune ONLY off listings that SUCCEEDED. `list_keys` raises on a throttle,
        and reading that as "the bucket is empty" would wipe the whole rail —
        far worse than the ghost. Unreadable is not empty.
      - never prune work this container has not confirmed into R2 (`_AUTHORED`).
      - never prune an EMPTY local sheet directory. `output_dir()` mkdirs
        `sheets/<sheet>/` as soon as a sheet is named, so an empty one is a sheet
        being authored right now, not a leftover — it has no R2 objects yet for
        exactly the same reason a ghost has none, and only the local files tell
        them apart. The cost of that rail: an empty directory is protected
        FOREVER, so a sheet deleted elsewhere still shows on the rail of any
        container that merely NAMED it. `api_clearcache` is the escape.

    `sheet_src/<sheet>/` is deliberately NOT reconciled here. It is a lazy
    subtree that may simply not be hydrated, so "no local files" carries no
    information about R2, and a half-pulled pile must never read as a ghost.
    The consequence is real and worth knowing: a pruned sheet leaves its sprite
    pile behind, and a sheet later re-created under the same name inherits it
    through `uploads_dir()`."""
    root = Path(staging_root)
    base = r2_project_prefix(client_key, proj_key)
    try:
        # A DELIMITED one-level listing: the question is only "which sheet names
        # does R2 still have", and this runs on every state load, so paging every
        # page/.atlas/.json object of every sheet to take the first path segment
        # is the wrong shape. `list_prefixes` exists for exactly this.
        spre = base + "/sheets/"
        live_sheets = {p[len(spre):].strip("/") for p in storage.list_prefixes(spre)}
        prefix = base + "/manifests/"
        live_mans = {k["key"][len(prefix):] for k in storage.list_keys(prefix)
                     if "/" not in k["key"][len(prefix):]}
    except Exception:  # noqa: BLE001 — unreadable R2 is NOT an empty R2
        return (0, 0)

    sheets = mans = 0
    out_root, man_dir = root / "sheets", root / "manifests"
    # The claim check and the deletes are ONE critical section. A snapshot is not
    # enough: an export claiming itself between the snapshot and the rmtree would
    # have its directory deleted out from under the writes still to come, and
    # since this prune now runs on EVERY state load, that race is live traffic
    # rather than a theoretical one.
    with _AUTHORED_LOCK:
        claimed = {(k, n) for (c, p, k, n) in (*_AUTHORED, *_UNPUSHED)
                   if (c, p) == (client_key, proj_key)}
        if out_root.is_dir():
            for d in out_root.iterdir():
                if (not d.is_dir() or d.name in live_sheets
                        or ("sheets", d.name) in claimed
                        or not any(f.is_file() for f in d.rglob("*"))):
                    continue
                try:
                    shutil.rmtree(d)
                    sheets += 1
                except OSError as e:
                    print(f"[sheet] could not prune stale sheet {d.name}: {e}",
                          flush=True)
        if man_dir.is_dir():
            for f in man_dir.iterdir():
                if (not f.is_file() or f.name in live_mans
                        or ("manifests", f.name) in claimed):
                    continue
                try:
                    f.unlink()
                    mans += 1
                except OSError as e:
                    print(f"[sheet] could not prune stale manifest {f.name}: "
                          f"{e}", flush=True)
    return (sheets, mans)


def discard_all_authored() -> int:
    """Drop EVERY project's claims. `api_clearcache` rmtrees every (client,
    project) tree, so anything scoped to the active one alone would leave other
    projects' claims outliving their files — and the prune's documented escape
    hatch would only work for whichever project you happened to be in."""
    with _AUTHORED_LOCK:
        n = len({*_AUTHORED, *_UNPUSHED})
        _AUTHORED.clear()
        _UNPUSHED.clear()
        return n


# Heavy subtree pulled LAZILY (on first access) rather than eagerly at project
# open — the uploaded sprite pile grows without bound and a cold project never
# needs it. `ensure_lazy` hydrates it on first use.
_LAZY_SUBTREES = ("sheet_src/",)
_LAZY_DONE: set[tuple[str, str, str]] = set()
# Reentrant: clearcache holds it across a force-`hydrate()` call, which itself
# re-takes this lock to discard the force-cleared guards.
_LAZY_LOCK = threading.RLock()


def lazy_lock():
    """The (reentrant) lock guarding the lazy-hydrate guard set. Exposed so clearcache can
    serialize its rmtree against any in-flight `ensure_lazy` pull. Holding it
    across the rmtree closes the window where a half-pulled sheet_src/ could be
    left behind a still-set guard."""
    return _LAZY_LOCK


def discard_active_lazy_guards() -> None:
    """Drop the active (client, project)'s lazy guards so the next access
    re-pulls. MUST be called while holding `lazy_lock()` (clearcache does)."""
    client_key = r2_slug(client_name())
    proj_key = r2_slug(project_name())
    for sub in _LAZY_SUBTREES:
        _LAZY_DONE.discard((client_key, proj_key, sub))


def hydrate(client_key: str, proj_key: str, staging_root: Path, force: bool = False) -> None:
    """Pull this (client, project)'s R2 subtree into staging once per process.

    Manifests/config/packed sheets (small, needed for the sheet + project lists)
    pull synchronously; uploaded sprites (potentially many PNGs) pull in a
    background thread so the server starts listening straight away instead of
    blocking boot (which would trip Railway's healthcheck). manifests/ is SHARED
    with the Atlas Maker — pulling it lets the project browser list BOTH tools'
    manifests."""
    key = (client_key, proj_key)
    with _CTX.hydrate_lock:
        if key in _CTX.hydrated and not force:
            return
        _CTX.hydrated.add(key)
    if force:
        with _LAZY_LOCK:
            for sub in _LAZY_SUBTREES:
                _LAZY_DONE.discard((client_key, proj_key, sub))
    base = r2_project_prefix(client_key, proj_key)
    kr = base + "/"

    # Synchronous: shared manifests + config + packed sheets (small, needed for
    # the project/sheet lists in the unified asset-typed layout). The uploaded
    # sprite pile (sheet_src/) is NOT pulled — it grows without bound and is only
    # needed once a sheet is actively edited, so it hydrates lazily on first
    # access (see ensure_lazy) instead of for every cold project.
    for sub in ("manifests/", "sheet_config.json", "sheet_session.json", "sheets/"):
        try:
            storage.pull_prefix(base + "/" + sub, staging_root, kr)
        except Exception:  # noqa: BLE001 — first run / empty bucket is fine
            pass


def ensure_lazy(subtree: str) -> None:
    """Pull a lazy subtree (e.g. "sheet_src/") for THIS thread's active (client,
    project) on first access, once per process. Idempotent and incremental:
    `pull_prefix` skips files already on disk by size, so repeat calls are cheap
    no-ops. A file added to R2 after the first pull won't appear until the next
    process / explicit Refresh — the same contract as hydrate(). Best-effort:
    any R2 error leaves the local dir as-is and clears the guard so a later
    access retries, rather than raising into a request.

    The whole pull runs UNDER `_LAZY_LOCK` (not just the guard flip) so clearcache
    — which takes the same lock — can never rmtree a tree mid-pull and leave a
    half-populated sheet_src/ behind its still-set guard. Lazy pulls are once-per-
    subtree-per-process and idempotent, so serializing them is effectively free."""
    sub = subtree if subtree.endswith("/") else subtree + "/"
    client_key = r2_slug(client_name())
    proj_key = r2_slug(project_name())
    key = (client_key, proj_key, sub)
    base = r2_project_prefix(client_key, proj_key)
    staging_root = STAGING_BASE / client_key / proj_key
    with _LAZY_LOCK:
        if key in _LAZY_DONE:
            return
        _LAZY_DONE.add(key)
        try:
            storage.pull_prefix(base + "/" + sub, staging_root, base + "/")
        except Exception:  # noqa: BLE001 — first run / empty bucket / transient
            _LAZY_DONE.discard(key)


def resolve() -> dict:
    proj = project_name()
    client = client_name()
    proj_key = r2_slug(proj)
    client_key = r2_slug(client)

    # Staging subdir names match the unified R2 asset-typed layout 1:1 so the
    # staging tree mirrors `<C>/<P>/<subfolder>` directly:
    #   input_dir    -> sheet_src/<sheet>     (uploaded loose PNGs, per sheet)
    #   output_root  -> sheets/<sheet>        (packed sheet PNG + coords)
    #   manifest_dir -> manifests/            (SHARED with the Atlas Maker)
    staging_root = STAGING_BASE / client_key / proj_key
    input_dir = staging_root / "sheet_src"
    output_root = staging_root / "sheets"
    manifest_dir = staging_root / "manifests"

    # Pull existing state from R2 before the tool reads it.
    hydrate(client_key, proj_key, staging_root)

    for d in (input_dir, output_root, manifest_dir):
        try:
            d.mkdir(parents=True, exist_ok=True)
        except OSError:
            pass

    return {
        "project": proj,
        "client": client,
        "project_key": proj_key,
        # The slug pair, so a caller that needs BOTH (e.g. prune_listing_ghosts)
        # takes them from the same resolve() that produced the prefix and the
        # staging root, instead of re-deriving and risking a mismatch.
        "client_key": client_key,
        "project_root": None,
        "input_dir": input_dir,
        "output_root": output_root,
        # Shared project manifest folder (both tools read/write it).
        "manifest_dir": manifest_dir,
        # No sibling folder in the cloud; manifests now land in the shared tree.
        "atlas_maker_dir": None,
        "r2_project_prefix": r2_project_prefix(client_key, proj_key),
        "staging_root": staging_root,
    }


def switch_context(client: str | None, project: str | None) -> dict | None:
    """Set THIS thread's active (client, project) and, if it changed, re-resolve
    its staging paths. Returns the fresh resolve() dict on a real switch, else
    None. Thread-local context means no global lock is needed around the switch.

    resolve() already hydrates this (client, project) ONCE per process (guarded
    by the _HYDRATED dedup set). We deliberately do NOT force a re-pull here:
    under the ThreadingHTTPServer every request runs on a FRESH thread whose
    thread-local context starts empty, so set_context() reports a "change" on
    essentially every request — forcing a re-hydrate here spawned a full
    sheet_src/+sheets/ R2 pull per request, exhausting threads/memory (RuntimeError:
    can't start new thread). On-demand refresh is the explicit "Refresh from R2"
    button, which force-hydrates when asked."""
    if not set_context(client, project):
        return None
    return resolve()  # rebuilds paths/prefix + hydrates once per (c,p)


# Back-compat: old single-key entrypoint maps onto the current client.
def switch_project(key: str) -> dict | None:
    return switch_context(client_name(), key)


# Compatibility no-ops for callers that import these from project_paths.
def list_projects() -> list[str]:
    return [project_name()]


def project_root() -> Path | None:
    return None


def atlas_maker_dir() -> Path | None:
    return None


__all__ = [
    "STAGING_BASE",
    "TOOL_NAMESPACE",
    "UNASSIGNED_CLIENT",
    "PROJECT_SLUG_RE",
    "valid_project",
    "valid_client",
    "project_prefix",
    "r2_slug",
    "_safe_proj_name",
    "env_project",
    "env_client",
    "_ctx_get",
    "project_name",
    "client_name",
    "set_context",
    "set_project",
    "prefix_for_tool",
    "r2_project_prefix",
    "_HYDRATED",
    "_HYDRATE_LOCK",
    "hydrate",
    "note_authored",
    "clear_authored",
    "authored_scope",
    "mark_pushed",
    "discard_all_authored",
    "unpushed_count",
    "in_flight_count",
    "is_protected",
    "forget",
    "prune_listing_ghosts",
    "ensure_lazy",
    "lazy_lock",
    "discard_active_lazy_guards",
    "resolve",
    "switch_context",
    "switch_project",
    "list_projects",
    "project_root",
    "atlas_maker_dir",
]
