"""Disk-backed thumbnail cache + HTTP cache-header helpers (shared by the
cloud Invisible tools).

Why this exists
---------------
The ported tools run as a stdlib ``ThreadingHTTPServer`` (one thread per
request). The original local code re-decoded + re-resized every full-size image
with PIL on *every* HTTP hit, and the responses were marked uncacheable while
the client appended ``?t=Date.now()`` cache-busters. So one manifest page with
many thumbnails fired a burst of full-resolution PIL decodes at once, saturated
the single Python process, and Railway's proxy 502'd whichever requests lost the
race. This module fixes that for ALL the tools at once:

  - ``cached_thumb(src, box)`` — a disk-backed thumbnail cache keyed on
    (absolute source path, source mtime, box). On hit it reads cheap JPEG bytes;
    on miss it generates once (under a bounded-concurrency semaphore) and writes
    atomically, so concurrent requests for the same key can't corrupt the file.
  - ``etag_for_path`` / ``etag_for_bytes`` + ``cache_headers`` /
    ``not_modified`` — an ETag-based revalidation contract so a browser that
    already has the image gets a cheap ``304`` instead of a full re-send.

Invalidation is structural: the cache key embeds the source file's mtime, so a
re-rendered / re-seeded / re-uploaded image (which rewrites the file and bumps
its mtime) produces a DIFFERENT cache key + a different ETag automatically — the
user sees the new picture with no manual cache-busting and no stale read.

Dependency-light on purpose: stdlib + PIL (already a hard dep of every tool).

Thread-safety: safe under ThreadingHTTPServer. Atomic writes (temp + os.replace)
mean a half-written cache file is never observed; a small per-key lock collapses
a thundering herd of identical requests into one generation; the concurrency
semaphore caps how many PIL decodes run at once so a burst can't thrash CPU/RAM.

This module holds NO path state of its own (per the tools' request-thread-local
contract): the caller passes the staging/cache dir in (``set_cache_dir`` /
``cached_thumb(..., cache_dir=...)``), so the cache always lives under the
active request's staging area.
"""
from __future__ import annotations

import hashlib
import io
import os
import tempfile
import threading
from pathlib import Path

from PIL import Image

__all__ = [
    "DEFAULT_BOX",
    "DEFAULT_MAX_AGE",
    "set_cache_dir",
    "thumb_token",
    "cached_thumb",
    "etag_for_path",
    "etag_for_bytes",
    "cache_headers",
    "not_modified",
]

DEFAULT_BOX = 240
# Browsers may hold a thumbnail this long without revalidating. The ETag still
# guards correctness on the next conditional request; the key/ETag both embed
# mtime, so a changed source is a different URL token + ETag anyway.
DEFAULT_MAX_AGE = 86400  # 1 day

# Bound how many PIL decode/resize ops run at once. A many-thumbnail page would
# otherwise fire N concurrent full-resolution decodes and saturate the single
# Python process (the original 502 cause). Cap to CPU count, clamped to a small
# range so a tiny container still parallelises a little and a big one doesn't
# stampede.
_CPU = os.cpu_count() or 4
_DECODE_SEM = threading.Semaphore(max(2, min(_CPU, 4)))

# Per-cache-key locks so a thundering herd of identical thumbnail requests
# generates the bytes ONCE instead of N times. The map itself is guarded by a
# tiny lock; an entry is dropped once its thumbnail is written (future requests
# hit the fast-path disk read first), so re-rendering an image — which mints a
# new mtime-keyed entry each time — can't leak a Lock per generation.
_KEY_LOCKS: dict[str, threading.Lock] = {}
_KEY_LOCKS_GUARD = threading.Lock()

# Optional process-default cache dir (a tool may call set_cache_dir once at
# startup pointing at its staging base). Per-call `cache_dir=` always wins so a
# request can target its own (client, project) staging tree.
_DEFAULT_CACHE_DIR: Path | None = None


def set_cache_dir(path: Path | str) -> None:
    """Set the process-default thumbnail cache directory. Per-call `cache_dir=`
    overrides it, so a request can still target its own staging tree."""
    global _DEFAULT_CACHE_DIR
    _DEFAULT_CACHE_DIR = Path(path)


def _key_lock(key: str) -> threading.Lock:
    with _KEY_LOCKS_GUARD:
        lock = _KEY_LOCKS.get(key)
        if lock is None:
            lock = threading.Lock()
            _KEY_LOCKS[key] = lock
        return lock


def _src_stat(src: Path) -> tuple[int, int]:
    """(mtime_ns, size) of the source. Raises if the source is missing — the
    caller already guards `p.exists()` before serving, so a raise here is a real
    error, not the empty-state path."""
    st = src.stat()
    return st.st_mtime_ns, st.st_size


def _cache_key(src: Path, box: int, mtime_ns: int, size: int) -> str:
    """Stable hash of (abs path, mtime, size, box). mtime+size invalidate on any
    change to the source; box separates differently-sized thumbs of one image."""
    h = hashlib.sha1()
    h.update(str(src.resolve()).encode("utf-8", "replace"))
    h.update(b"\0")
    h.update(f"{mtime_ns}:{size}:{box}".encode("ascii"))
    return h.hexdigest()


def thumb_token(src: Path) -> str:
    """A short, change-driven cache-bust token for a source image — derived from
    its mtime+size, NOT a per-request timestamp.

    The client appends this to a thumbnail <img> URL so the URL only changes when
    the underlying file actually changes (re-render / re-upload bumps mtime).
    That keeps a plain page load fully cacheable while still refreshing an image
    in place after it's regenerated. Returns "0" when the source is missing OR
    `None` (a region with no ref) — the empty-state placeholder is served then
    anyway."""
    try:
        mtime_ns, size = _src_stat(Path(src))
    except (OSError, TypeError):
        return "0"
    return hashlib.sha1(f"{mtime_ns}:{size}".encode("ascii")).hexdigest()[:12]


def _generate_thumb(src: Path, box: int) -> bytes:
    """The actual PIL decode/resize, run under the concurrency semaphore. Mirrors
    the tools' original thumb logic: fit within box, flatten onto the dark card
    background, encode JPEG q85."""
    with _DECODE_SEM:
        img = Image.open(src).convert("RGBA")
        img.thumbnail((box, box), Image.LANCZOS)
        bg = Image.new("RGBA", img.size, (32, 32, 36, 255))
        bg.alpha_composite(img)
        buf = io.BytesIO()
        bg.convert("RGB").save(buf, "JPEG", quality=85)
        return buf.getvalue()


def _atomic_write(dest: Path, data: bytes) -> None:
    """Write `data` to `dest` atomically (temp in the same dir + os.replace) so a
    concurrent reader never sees a half-written cache file."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(dest.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.replace(tmp, dest)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def cached_thumb(
    src: Path | str,
    box: int = DEFAULT_BOX,
    *,
    cache_dir: Path | str | None = None,
) -> bytes:
    """Return JPEG thumbnail bytes for `src`, generating + caching on first use.

    Keyed on (absolute path, mtime, size, box). On hit, reads the cached JPEG
    (cheap). On miss, generates once under a per-key lock + the concurrency
    semaphore, then writes atomically. A changed source (new mtime/size) is a new
    key, so the cache self-invalidates — no manual purge needed.

    `cache_dir` (or the process default from `set_cache_dir`) is where cache
    files live; pass the active request's staging base so the cache stays inside
    that (client, project) tree. Falls back to the OS temp dir if neither is set.
    """
    src = Path(src)
    mtime_ns, size = _src_stat(src)
    key = _cache_key(src, box, mtime_ns, size)

    base = Path(cache_dir) if cache_dir is not None else _DEFAULT_CACHE_DIR
    if base is None:
        base = Path(tempfile.gettempdir())
    # Shard by the first 2 hex chars to avoid one huge flat dir.
    cache_path = base / "_thumbcache" / key[:2] / f"{key}.jpg"

    try:
        return cache_path.read_bytes()
    except OSError:
        pass  # miss / unreadable → (re)generate below

    lock = _key_lock(key)
    with lock:
        # Re-check: another thread may have written it while we waited.
        try:
            return cache_path.read_bytes()
        except OSError:
            pass
        data = _generate_thumb(src, box)
        try:
            _atomic_write(cache_path, data)
            # The bytes are on disk now: drop the per-key lock so the map doesn't
            # accumulate one Lock per (path, mtime, box) as images are re-rendered.
            # A concurrent waiter already holds this same lock object and will
            # re-check the read; a later caller mints a fresh lock but finds the
            # file and never regenerates.
            with _KEY_LOCKS_GUARD:
                _KEY_LOCKS.pop(key, None)
        except OSError:
            # Disk full / read-only cache dir: still return the bytes we built so
            # the request succeeds; we just don't get the cache hit next time.
            pass
        return data


# --- HTTP cache-header contract ---------------------------------------------

def etag_for_path(src: Path | str) -> str:
    """A weak-ish strong ETag for a file, from its mtime+size — cheap (a stat,
    no read) and changes whenever the file is rewritten. Quoted per RFC. Returns
    "" if the file is missing (caller should then skip ETag headers)."""
    try:
        mtime_ns, size = _src_stat(Path(src))
    except OSError:
        return ""
    return f'"{mtime_ns:x}-{size:x}"'


def etag_for_bytes(data: bytes) -> str:
    """A content-hash ETag for an in-memory body (used when there's no stable
    source file, e.g. a generated thumbnail served from cache bytes)."""
    return f'"{hashlib.sha1(data).hexdigest()}"'


def cache_headers(etag: str, max_age: int = DEFAULT_MAX_AGE) -> dict[str, str]:
    """Headers for a cacheable, revalidatable image response. `private` (these
    are per-user tool assets behind the launcher's auth, not shared-cacheable);
    `must-revalidate` so a stale entry is rechecked via the ETag. Pass an empty
    `etag` to omit it (still sets Cache-Control)."""
    h = {"Cache-Control": f"private, max-age={max_age}, must-revalidate"}
    if etag:
        h["ETag"] = etag
    return h


def not_modified(if_none_match: str | None, etag: str) -> bool:
    """True when the client's `If-None-Match` matches `etag` → respond 304.
    Tolerates a weak-validator `W/` prefix and a comma-separated list."""
    if not if_none_match or not etag:
        return False
    candidates = [c.strip() for c in if_none_match.split(",")]
    for c in candidates:
        if c == "*":
            return True
        if c.startswith("W/"):
            c = c[2:].strip()
        if c == etag:
            return True
    return False
