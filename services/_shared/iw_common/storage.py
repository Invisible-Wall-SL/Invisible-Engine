"""R2 object storage + local-staging sync (shared by the cloud Invisible tools).

The ported tools keep doing ordinary pathlib/PIL I/O against a local *staging*
directory (see each service's cloud_paths.py). This module is the bridge that:
  - hydrates the staging dir from R2 on startup / on demand (pull),
  - mirrors staging writes back to R2 after each mutation (push),
  - lists/reads/writes/deletes individual R2 objects.

R2 keys mirror the staging layout exactly under a single project prefix, e.g.
    <client>/<project>/input/...
    <client>/<project>/atlas/...
    <client>/<project>/manifests/...
so push/pull is a straight prefix<->dir mapping. (Unified single-project repo —
the old `<tool>/` segment is retired; see docs/design/unified-project-repo.md.)
"""
from __future__ import annotations

import mimetypes
import os
import threading
from pathlib import Path

import boto3

_CLIENT = None
_CLIENT_LOCK = threading.Lock()


def _client():
    """Lazily-created, shared boto3 client (built once, reused).

    boto3 clients are thread-safe for method calls, so a single instance is
    correct under the ThreadingHTTPServer and avoids rebuilding the client on
    every storage op. Lazy + double-checked lock so import never touches env."""
    global _CLIENT
    if _CLIENT is None:
        with _CLIENT_LOCK:
            if _CLIENT is None:
                _CLIENT = boto3.client(
                    "s3",
                    region_name="auto",
                    endpoint_url=os.environ["R2_ENDPOINT"],
                    aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
                    aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
                )
    return _CLIENT


def _bucket() -> str:
    return os.environ["R2_BUCKET"]


def _ctype(key: str) -> str:
    return mimetypes.guess_type(key)[0] or "application/octet-stream"


# --- single-object ops -------------------------------------------------------

def put(key: str, body: bytes, content_type: str | None = None) -> None:
    _client().put_object(
        Bucket=_bucket(), Key=key, Body=body, ContentType=content_type or _ctype(key)
    )


def presign_put(key: str, expires: int = 3600) -> str:
    """A URL that can PUT one object, and nothing else, for `expires` seconds.

    Exists so a RunPod Serverless worker can hand a big render straight to R2
    instead of returning it through RunPod's API, whose payload cap (10 MB on
    `/run`, 20 MB on `/runsync`, and base64 inflating a file by a third on the way)
    is fixed — RunPod's own guidance for a large result is object storage, not a
    bigger response.

    Presigned rather than shipping credentials to the worker: the URL is scoped to
    ONE key, expires, and grants no read and no listing, so a worker image (which is
    public on GHCR) never carries anything worth stealing.

    NOTE no `ContentType` is signed in. If it were, the caller would have to send a
    byte-identical header or S3 rejects the request — a needless way for an upload to
    fail. The final object is written by the tool afterwards with a correct type.
    """
    return _client().generate_presigned_url(
        "put_object", Params={"Bucket": _bucket(), "Key": key},
        ExpiresIn=int(expires))


def get(key: str) -> bytes | None:
    try:
        return _client().get_object(Bucket=_bucket(), Key=key)["Body"].read()
    except Exception:  # noqa: BLE001 — treat any miss as "not found"
        return None


def exists(key: str) -> bool:
    try:
        _client().head_object(Bucket=_bucket(), Key=key)
        return True
    except Exception:  # noqa: BLE001
        return False


def delete(key: str) -> None:
    try:
        _client().delete_object(Bucket=_bucket(), Key=key)
    except Exception:  # noqa: BLE001
        pass


def list_keys(prefix: str) -> list[dict]:
    """List objects under a prefix → [{key, size, mtime(epoch)}]."""
    out: list[dict] = []
    token: str | None = None
    cli = _client()
    while True:
        kw = {"Bucket": _bucket(), "Prefix": prefix}
        if token:
            kw["ContinuationToken"] = token
        resp = cli.list_objects_v2(**kw)
        for o in resp.get("Contents", []):
            out.append(
                {
                    "key": o["Key"],
                    "size": o.get("Size", 0),
                    "mtime": o["LastModified"].timestamp() if o.get("LastModified") else 0,
                }
            )
        if resp.get("IsTruncated"):
            token = resp.get("NextContinuationToken")
        else:
            break
    return out


# --- staging <-> R2 sync -----------------------------------------------------

def pull_prefix(prefix: str, dest_root: Path, key_root: str) -> int:
    """Download objects under `prefix` into `dest_root`, recreating the
    relative path below `key_root`. Concurrent (boto3 clients are thread-safe
    for calls) so large trees pull in seconds, not minutes.

    Incremental hydrate: a key is SKIPPED only when the local destination
    exists, matches in size, AND is at least as new as the R2 object. Size
    alone is not enough — an edited sprite that re-compresses to the same byte
    count (e.g. a recolour at identical dimensions) would otherwise be skipped
    forever, leaving stale pixels in staging and a stale ETag (the
    "sheet editor shows old images after coming back" bug). Comparing R2's
    LastModified against the local mtime catches that: a re-uploaded object has
    a newer LastModified than the file we last downloaded, so it re-downloads.
    A 0 / missing size never skips (downloads to be safe). Returns the number
    of files ACTUALLY downloaded (skips don't count). Best-effort: any per-file
    error counts as not-downloaded, never raises."""
    from concurrent.futures import ThreadPoolExecutor

    cli = _client()
    bucket = _bucket()

    def _one(item) -> int:
        key, size, mtime = item
        if key.endswith("/"):
            return 0
        rel = key[len(key_root):].lstrip("/") if key.startswith(key_root) else key
        dest = dest_root / rel
        try:
            if size and dest.exists() and dest.stat().st_size == size:
                # Same size — only trust the skip if our local copy is not older
                # than the R2 object. download_file stamps the local mtime at
                # fetch time, so an unchanged object stays skipped while a
                # re-uploaded one (newer LastModified) re-downloads.
                if not mtime or dest.stat().st_mtime >= mtime:
                    return 0
            dest.parent.mkdir(parents=True, exist_ok=True)
            cli.download_file(bucket, key, str(dest))
            return 1
        except Exception:  # noqa: BLE001
            return 0

    entries = [(e["key"], e.get("size"), e.get("mtime")) for e in list_keys(prefix)]
    if not entries:
        return 0
    with ThreadPoolExecutor(max_workers=16) as pool:
        return sum(pool.map(_one, entries))


def push_dir(src_root: Path, key_root: str) -> int:
    """Upload every file under `src_root` to R2 at `key_root/<relpath>`.
    Returns the number of files pushed. Best-effort, no deletes."""
    n = 0
    if not src_root.exists():
        return 0
    for p in src_root.rglob("*"):
        if not p.is_file():
            continue
        rel = p.relative_to(src_root).as_posix()
        key = f"{key_root.rstrip('/')}/{rel}"
        try:
            put(key, p.read_bytes())
            n += 1
        except Exception:  # noqa: BLE001
            pass
    return n


def push_file(local_path: Path, key: str) -> None:
    """Mirror one local file to R2 (used as write-through after a mutation)."""
    try:
        if local_path.exists():
            put(key, local_path.read_bytes())
    except Exception:  # noqa: BLE001
        pass


# --- local-disk helpers (shared by the cache-pruning endpoints) --------------

def dir_size(root: Path) -> int:
    """Total bytes of every file under `root` (du-style). 0 if root is absent."""
    total = 0
    root = Path(root)
    if not root.exists():
        return 0
    for p in root.rglob("*"):
        try:
            if p.is_file():
                total += p.stat().st_size
        except OSError:
            pass
    return total


def human_bytes(n: int) -> str:
    """Human-readable byte size (e.g. 1536 -> '1.5 KB'). Caps at TB."""
    f = float(n)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if f < 1024 or unit == "TB":
            return f"{f:.0f} {unit}" if unit == "B" else f"{f:.1f} {unit}"
        f /= 1024
