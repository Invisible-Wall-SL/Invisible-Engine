"""R2 object storage + local-staging sync for the cloud Atlas Maker.

The ported tool keeps doing ordinary pathlib/PIL I/O against a local *staging*
directory (see cloud_paths.py). This module is the bridge that:
  - hydrates the staging dir from R2 on startup / on demand (pull),
  - mirrors staging writes back to R2 after each mutation (push),
  - lists/reads/writes/deletes individual R2 objects.

R2 keys mirror the staging layout exactly under a single project prefix, e.g.
    atlas_maker/cloud/<project>/input/refs/userref_foo.png
    atlas_maker/cloud/<project>/output/<prefix>/batch/foo_00001_.png
    atlas_maker/cloud/<project>/manifests/atlas_manifest_symbols.json
so push/pull is a straight prefix<->dir mapping.
"""
from __future__ import annotations

import mimetypes
import os
from pathlib import Path

import boto3


def _client():
    return boto3.client(
        "s3",
        region_name="auto",
        endpoint_url=os.environ["R2_ENDPOINT"],
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
    )


def _bucket() -> str:
    return os.environ["R2_BUCKET"]


def _ctype(key: str) -> str:
    return mimetypes.guess_type(key)[0] or "application/octet-stream"


# --- single-object ops -------------------------------------------------------

def put(key: str, body: bytes, content_type: str | None = None) -> None:
    _client().put_object(
        Bucket=_bucket(), Key=key, Body=body, ContentType=content_type or _ctype(key)
    )


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
    """Download every object under `prefix` into `dest_root`, recreating the
    relative path below `key_root`. Returns the number of files pulled."""
    n = 0
    cli = _client()
    for entry in list_keys(prefix):
        key = entry["key"]
        if key.endswith("/"):
            continue
        rel = key[len(key_root):].lstrip("/") if key.startswith(key_root) else key
        dest = dest_root / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        try:
            cli.download_file(_bucket(), key, str(dest))
            n += 1
        except Exception:  # noqa: BLE001
            pass
    return n


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
