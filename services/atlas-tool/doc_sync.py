"""Compare-and-swap for the Atlas Maker's authored docs (an atlas manifest,
`atlas_config.json`) — `docs/design/multi-user-concurrency.md` Phase 3.

The tool edits a STAGING copy and used to mirror it to R2 with a blind PUT, so a
container whose staging was older than R2 (another container mid-deploy, the Sheet
Maker re-exporting the same manifest, a render's write on another replica) pushed
a doc derived from stale state straight over the newer one. The pieces here:

  * `sync()` — a read that means to WRITE first re-reads R2 and brings staging up
    to date, recording the ETag it saw for this thread (`loaded`). So every
    load→mutate→save in the tool mutates R2's current version, not a stale copy.
  * `commit()` — the save. It PUTs with `If-Match` on exactly the ETag this
    thread loaded (`If-None-Match: *` when it loaded nothing), so a writer that
    got in between is refused rather than overwritten; and for a PAGE edit it
    first checks the version the page itself loaded (`docsave.check`), so an
    author working from a stale screen is asked instead of silently reverting
    whoever saved since.
  * `create()` — a new doc under a name: a create-only claim; replacing a taken
    name needs the page to have been SHOWN that version (the 409 round trip).

The render pipeline's own writes (post-hook FX rebuild, auto-pack rects, the pack
page pointer, fit-mode repair …) go through `commit(user=False)`: CAS on what they
read, never checked against a page and never stamped, so they do not move
`saved_by.rev` and never trip an author (see `iw_common/docsave.py` for why a
matching `rev` is a merge). A machine write that loses a race is REBASED — its
own changes re-applied onto the version that beat it — not dropped.

A page only ever learns versions this request WROTE (`versions`). Handing it a
version it merely read — or, worse, the version that just refused it — would move
its base to something it never displayed, and its next save would pass.

Local dev (no R2 prefix) keeps the old behaviour: staging only, no checks.
"""
from __future__ import annotations

import copy
import hashlib
import json
import os
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

import storage
from iw_common import docsave

TOOL = "atlas"

# R2 could not be asked. Re-exported so a caller catches THIS module's notion of
# it — tests swap the caller's own `storage` binding for a fake.
Unreadable = storage.ObjectUnreadable

_MACHINE_ATTEMPTS = 4   # a machine write rebased through this many lost races
_TRANSIENT_ATTEMPTS = 3  # R2's 409 ConditionalRequestConflict, retried


@dataclass
class _Ctx:
    identity: object | None = None
    # The page's loaded versions (`X-IW-Doc-Bases`), or None when this request did
    # not come from a page that sends them (a GET, a pre-deploy tab, a job).
    bases: dict | None = None
    # Whether a plain load re-reads R2 first. On for the page render and every
    # POST; off for the polling GETs, which only read and would otherwise cost one
    # R2 GET per open tab per second.
    sync: bool = False
    request: bool = False
    # r2 key -> (verbatim etag or None for absent, the doc as read)
    loaded: dict = field(default_factory=dict)
    # doc id -> {etag, rev} as this request LOADED it (what a rendered page shows)
    seen: dict = field(default_factory=dict)
    # doc id -> {etag, rev} for what this request WROTE (what a page adopts)
    versions: dict = field(default_factory=dict)


_tl = threading.local()

# r2 key -> (verbatim etag, sha1 of the R2 bytes staging was last brought to).
# Lets a later sync tell "staging was edited locally since" (keep it: a sliced
# manifest, a write R2 did not take) from "R2 moved on" (take R2's).
_synced: dict[str, tuple[str, str]] = {}
_synced_lock = threading.Lock()


def begin(*, identity=None, bases: dict | None = None, sync: bool = True) -> None:
    _tl.ctx = _Ctx(identity=identity, bases=bases, sync=sync, request=True)


def end() -> None:
    _tl.ctx = None


def ctx() -> _Ctx:
    c = getattr(_tl, "ctx", None)
    if c is None:
        c = _tl.ctx = _Ctx()
    return c


def versions() -> dict:
    """What this request WROTE — the only versions a page may adopt."""
    return dict(ctx().versions)


def seen(doc_id: str) -> dict | None:
    """The version this request loaded — what the page being rendered shows."""
    return ctx().seen.get(doc_id)


def _sha(b: bytes | None) -> str:
    return hashlib.sha1(b).hexdigest() if b is not None else ""


def _read(p: Path) -> bytes | None:
    try:
        return p.read_bytes()
    except OSError:
        return None


def _write_atomic(p: Path, body: bytes) -> None:
    """A render subprocess may be reading this file; never let it see half of one."""
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(f".{p.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    tmp.write_bytes(body)
    for attempt in range(5):
        try:
            os.replace(tmp, p)
            return
        except PermissionError:
            # Windows (local dev) refuses to replace a file another thread has
            # open for reading; Linux never does. Brief, bounded, then honest.
            if attempt == 4:
                raise
            time.sleep(0.02 * (attempt + 1))


def _loaded(c: _Ctx, key: str, doc_id: str, etag: str | None, doc) -> None:
    c.loaded[key] = (etag, doc)
    c.seen[doc_id] = docsave.version(etag, doc)


def sync(key: str, doc_id: str, local: Path, *, force: bool = False) -> None:
    """Bring staging's copy of `key` up to R2 and record what this thread read.

    `force` re-reads even if this request already did (the pipeline's "fresh read
    under the lock"). A plain load does it once per request, and only in a request
    that asked for syncing.

    Staging is kept over R2 in exactly one case: this process synced the doc,
    R2 has not moved since, and the staged bytes changed — a local edit made on top
    of R2's version (the slice subprocess binds geometry into the file directly; a
    write R2 did not take). With no record of what staging was synced to — after a
    restart, or a doc never read here — R2 wins: a staged copy of unknown origin is
    never pushed over a live doc.

    Raises `storage.ObjectUnreadable` when R2 could not be asked; the caller keeps
    working from staging and the eventual commit falls back to the last version
    this process synced (or refuses, for a page edit)."""
    c = ctx()
    if not force and (not c.sync or key in c.loaded):
        return
    got = storage.get_with_etag(key)
    local_bytes = _read(local)
    if got is None:
        # Absent in R2. A staged copy is either unpushed work or a doc deleted at
        # the source; deciding which is `_refresh_manifest_from_r2`'s job (on
        # activation). Here it only means a save is a CREATE.
        with _synced_lock:
            _synced.pop(key, None)
        _loaded(c, key, doc_id, None, docsave.parse_doc(local_bytes))
        return
    body, etag = got
    if local_bytes != body:
        with _synced_lock:
            rec = _synced.get(key)
        edited_here = (rec is not None and local_bytes is not None
                       and _sha(local_bytes) != rec[1])
        moved = rec is None or docsave.norm_etag(rec[0]) != docsave.norm_etag(etag)
        if not edited_here or moved:
            if edited_here:
                print(f"[atlas] {doc_id}: staging had local edits AND R2 moved on "
                      f"— taking R2's version", flush=True)
            _write_atomic(local, body)
    with _synced_lock:
        _synced[key] = (etag, _sha(body))
    _loaded(c, key, doc_id, etag, docsave.parse_doc(body))


def _current(key: str) -> tuple[str | None, dict | None]:
    got = storage.get_with_etag(key)
    if got is None:
        return None, None
    return got[1], docsave.parse_doc(got[0])


def _expected(c: _Ctx, key: str, doc_id: str) -> tuple[str | None, dict | None]:
    """The version this write is derived from: what this thread read, else what
    staging was last synced to. With neither, the doc was never read here, so a
    write is a create — and a doc that exists is refused as taken."""
    if key in c.loaded:
        return c.loaded[key]
    with _synced_lock:
        rec = _synced.get(key)
    if rec is not None:
        return rec[0], None
    etag, doc = _current(key)
    if etag is not None:
        raise docsave.DocConflict(doc_id, docsave.EXISTS, etag=etag, doc=doc)
    return None, None


def _dump(doc: dict) -> bytes:
    return json.dumps(doc, indent=2, ensure_ascii=False).encode("utf-8")


def _is_transient(e: Exception) -> bool:
    """R2's 409 `ConditionalRequestConflict`: two conditional writes raced — try
    again. Not an answer about the doc, unlike the 412 `storage.Conflict`."""
    resp = getattr(e, "response", None)
    if not isinstance(resp, dict):
        return False
    return (resp.get("ResponseMetadata", {}).get("HTTPStatusCode") == 409
            or str(resp.get("Error", {}).get("Code") or "")
            == "ConditionalRequestConflict")


def _raw_put(key: str, body: bytes, expected: str | None) -> str | None:
    for attempt in range(_TRANSIENT_ATTEMPTS):
        try:
            if expected:
                return storage.put(key, body, "application/json", if_match=expected)
            return storage.put(key, body, "application/json", if_none_match="*")
        except storage.Conflict:
            raise
        except Exception as e:  # noqa: BLE001 — classified below
            if _is_transient(e) and attempt < _TRANSIENT_ATTEMPTS - 1:
                time.sleep(0.1 * (attempt + 1))
                continue
            raise
    return None


def _adopt_r2(key: str, local: Path) -> tuple[str | None, dict | None]:
    """Leave staging as R2 has it after a refusal; return R2's (etag, doc)."""
    got = storage.get_with_etag(key)
    if got is None:
        return None, None
    _write_atomic(local, got[0])
    with _synced_lock:
        _synced[key] = (got[1], _sha(got[0]))
    return got[1], docsave.parse_doc(got[0])


def _landed(c: _Ctx, key: str, doc_id: str, local: Path, doc: dict, body: bytes,
            new: str | None) -> str | None:
    _write_atomic(local, body)
    with _synced_lock:
        _synced[key] = (new or "", _sha(body))
    # A copy: the caller may keep mutating `doc`, and this is the BASE a later
    # rebase diffs against.
    _loaded(c, key, doc_id, new, copy.deepcopy(doc))
    ver = docsave.version(new, doc)
    c.versions[doc_id] = ver
    if c.bases is not None:
        # A second save of the same doc in this request builds on the first.
        c.bases[doc_id] = docsave.Base(ver["etag"], ver["rev"])
    return new


def _local_only(local: Path, doc_id: str, doc: dict) -> None:
    """R2 unreachable and nobody's page to ask: the pre-CAS best effort — staging
    only, the caller's authored claim stays up, and the next sync keeps this copy
    (`edited_here`) until a commit can push it."""
    print(f"[atlas] {doc_id}: R2 unreachable — kept in staging only", flush=True)
    _write_atomic(local, _dump(doc))
    return None


def precheck(key: str | None, doc_id: str) -> None:
    """For a handler with a side effect BEFORE its save (an image written to a
    shared key): refuse now, while nothing has been touched, if the page's version
    is stale. The save's own check still runs."""
    c = ctx()
    if not key or c.bases is None:
        return
    expected, loaded_doc = _expected(c, key, doc_id)
    docsave.check(doc_id, c.bases.get(doc_id), expected, loaded_doc,
                  allow_rev_merge=True, missing_base=docsave.UNSEEN)


def commit(key: str | None, doc_id: str, local: Path, doc: dict, *,
           user: bool) -> str | None:
    """Save `doc`. `user` = an author's edit (checked against the page's loaded
    version, stamped `saved_by`); otherwise a machine write (CAS only, stamp
    carried through untouched, rebased onto a version that beat it). `key` None =
    no R2 (local dev). Returns the new ETag, or None when R2 was not written."""
    c = ctx()
    page_edit = user and c.bases is not None
    # A write the caller must not be told landed when only staging holds it: a
    # page's edit, and any Director write (its next read of R2 would lose it).
    strict = page_edit or getattr(c.identity, "act_tool", "") == "director"
    if user and c.request:
        docsave.stamp(doc, c.identity, TOOL)
    if not key:
        _write_atomic(local, _dump(doc))
        return None
    try:
        expected, loaded_doc = _expected(c, key, doc_id)
    except storage.ObjectUnreadable:
        if strict:
            raise  # a page edit is refused (503) rather than written unchecked
        return _local_only(local, doc_id, doc)
    if page_edit:
        # `rev` of what was LOADED, not of `doc` — the stamp above already
        # replaced the one in `doc`.
        docsave.check(doc_id, c.bases.get(doc_id), expected, loaded_doc,
                      allow_rev_merge=True, missing_base=docsave.UNSEEN)
    for _ in range(1 if user else _MACHINE_ATTEMPTS):
        body = _dump(doc)
        try:
            new = _raw_put(key, body, expected)
        except storage.Conflict:
            cur_etag, cur_doc = _adopt_r2(key, local)
            if user or cur_etag is None or loaded_doc is None:
                raise docsave.DocConflict(
                    doc_id, docsave.EXISTS if not expected else docsave.STALE,
                    etag=cur_etag, doc=cur_doc) from None
            # A machine write lost a race. Its changes are a function of the
            # version it read; re-apply exactly those onto the one that won.
            doc = rebase(loaded_doc, doc, cur_doc)
            loaded_doc, expected = copy.deepcopy(cur_doc), cur_etag
            continue
        except Exception as e:  # noqa: BLE001 — R2 did not answer
            if strict:
                # Answering 200 for an edit that lives only in staging would be a
                # silent loss the moment anyone else writes: refuse, say so.
                raise storage.ObjectUnreadable(f"{doc_id}: write failed: {e}") from e
            return _local_only(local, doc_id, doc)
        return _landed(c, key, doc_id, local, doc, body, new)
    raise docsave.DocConflict(doc_id, docsave.STALE, etag=expected, doc=loaded_doc)


def create(key: str | None, doc_id: str, local: Path, doc: dict, *,
           user: bool = True) -> str | None:
    """Write a NEW doc under a name — a create-only claim. A name somebody already
    holds is refused (`DocConflict` EXISTS, naming them) unless the page was SHOWN
    that version — the "Replace it" answer to that refusal re-sends the request
    with it as the base — and then the replace is `If-Match` on exactly it.

    R2 unreadable RAISES: a create that cannot learn whether the name is taken is
    not safe to write, not even to staging."""
    c = ctx()
    docsave.strip_stamp(doc)
    if user and c.request:
        docsave.stamp(doc, c.identity, TOOL)
    if not key:
        _write_atomic(local, _dump(doc))
        return None
    cur_etag, cur_doc = _current(key)
    if cur_etag is not None:
        base = (c.bases or {}).get(doc_id)
        if not (base is not None and base.etag
                and base.etag == docsave.norm_etag(cur_etag)):
            raise docsave.DocConflict(doc_id, docsave.EXISTS, etag=cur_etag,
                                      doc=cur_doc)
    body = _dump(doc)
    try:
        new = _raw_put(key, body, cur_etag)
    except storage.Conflict:
        cur_etag, cur_doc = _adopt_r2(key, local)
        raise docsave.DocConflict(doc_id, docsave.EXISTS, etag=cur_etag,
                                  doc=cur_doc) from None
    except Exception as e:  # noqa: BLE001
        raise storage.ObjectUnreadable(f"{doc_id}: write failed: {e}") from e
    return _landed(c, key, doc_id, local, doc, body, new)


# --------------------------------------------------------------------------- rebase

_REGION_LISTS = ("regions", "rotated_regions")
_MISSING = object()


def _by_name(items) -> dict:
    return {r.get("name"): r for r in items or [] if isinstance(r, dict)}


def _merge_dict(base: dict, mine: dict, out: dict) -> None:
    """Apply the key-level difference base→mine onto `out` (one level deep for
    nested dicts, so two writers touching different keys of `atlas` both land)."""
    for k in set(base) | set(mine):
        b, m = base.get(k, _MISSING), mine.get(k, _MISSING)
        if b == m:
            continue
        if m is _MISSING:
            out.pop(k, None)
        elif isinstance(b, dict) and isinstance(m, dict) and isinstance(out.get(k), dict):
            _merge_dict(b, m, out[k])
        else:
            out[k] = copy.deepcopy(m)


def rebase(base: dict, mine: dict, theirs: dict) -> dict:
    """`theirs` plus exactly what `mine` changed relative to `base` — a machine
    write re-applied onto the version that beat it. Regions are matched by NAME
    (their identity), fields merged per region; a region `mine` added is appended,
    one it removed is removed. Where both changed one field, `mine` wins: this is
    the machine write's own output (a rect it just packed, a pick it just spent)."""
    out = copy.deepcopy(theirs)
    top_b = {k: v for k, v in base.items() if k not in _REGION_LISTS}
    top_m = {k: v for k, v in mine.items() if k not in _REGION_LISTS}
    _merge_dict(top_b, top_m, out)
    for lst in _REGION_LISTS:
        b, m = _by_name(base.get(lst)), _by_name(mine.get(lst))
        if b == m:
            continue
        rows = out.setdefault(lst, [])
        cur = _by_name(rows)
        for name, reg in m.items():
            if name not in b:
                if name not in cur:
                    rows.append(copy.deepcopy(reg))
            elif name in cur and reg != b[name]:
                _merge_dict(b[name], reg, cur[name])
        gone = set(b) - set(m)
        if gone:
            out[lst] = [r for r in rows if not (isinstance(r, dict) and r.get("name") in gone)]
    return out


def reset_for_tests() -> None:
    with _synced_lock:
        _synced.clear()
    _tl.ctx = None
