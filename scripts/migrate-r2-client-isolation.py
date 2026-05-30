"""Migrate R2 from `<tool>/cloud/<project>/...` to `<tool>/<client>/<project>/...`.

Two-phase, idempotent. Defaults to a DRY RUN: nothing is mutated until you
pass `--no-dry-run` explicitly.

  Phase A (copy):
    Server-side CopyObject every key from the legacy prefix to the new
    client-scoped prefix. Skips keys that already exist at the destination
    (same ETag) so re-runs are cheap. NON-DESTRUCTIVE — the old prefix is
    left intact. Run this FIRST, then deploy the new code.

  Phase B (delete):
    After the operator has verified the new prefixes serve traffic, deletes
    the OLD `<tool>/cloud/<project>/...` keys in batches.

  Both:
    Run A immediately followed by B (only useful for fresh / disposable
    buckets — production should always do A, deploy, verify, then B).

Mapping source:
  --map <path>     JSON file: [{"project": "...", "client": "..."}, ...]
  (otherwise)      DATABASE_URL is read with `psycopg`. Falls back to
                   `unassigned` for any row where `client_key` is NULL.

Spines are NOT touched by default (they aren't project-keyed today).
`--include-spines` is reserved and requires a manual --map row mapping spine
bundle root to (client, project).

Exits non-zero on any failure. Logs every action.

Usage examples:
  # Dry-run Phase A from the DB.
  python scripts/migrate-r2-client-isolation.py --phase=copy

  # Real Phase A.
  python scripts/migrate-r2-client-isolation.py --phase=copy --no-dry-run

  # Real Phase B (after verifying the deploy).
  python scripts/migrate-r2-client-isolation.py --phase=delete --no-dry-run
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Iterable

import boto3


TOOL_PREFIXES = ("atlas_maker", "sheet_maker", "localization", "editor")
LEGACY_CLIENT = "cloud"
UNASSIGNED_CLIENT = "unassigned"


def _r2_client():
    return boto3.client(
        "s3",
        region_name="auto",
        endpoint_url=os.environ["R2_ENDPOINT"],
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
    )


def _bucket() -> str:
    return os.environ["R2_BUCKET"]


def load_mapping_from_file(path: str) -> list[dict]:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    out = []
    for row in data:
        proj = (row.get("project") or "").strip()
        client = (row.get("client") or "").strip() or UNASSIGNED_CLIENT
        if proj:
            out.append({"project": proj, "client": client})
    return out


def load_mapping_from_db() -> list[dict]:
    """Reads `projects` from DATABASE_URL. Tries psycopg, falls back to
    psycopg2. Either is fine; both are common deps in this repo."""
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError(
            "DATABASE_URL not set — pass --map <path> to migrate from a JSON file."
        )
    try:
        import psycopg  # type: ignore
        conn = psycopg.connect(url)
    except ImportError:
        import psycopg2  # type: ignore
        conn = psycopg2.connect(url)
    rows: list[dict] = []
    try:
        with conn.cursor() as cur:
            # Column names follow the Drizzle camelCase->snake_case convention
            # used elsewhere in this repo (clients.ts / projects.ts).
            cur.execute('SELECT key, client_key FROM projects')
            for proj, client in cur.fetchall():
                rows.append({
                    "project": str(proj),
                    "client": str(client) if client else UNASSIGNED_CLIENT,
                })
    finally:
        conn.close()
    return rows


def list_all_keys(s3, prefix: str) -> Iterable[dict]:
    token = None
    while True:
        kw = {"Bucket": _bucket(), "Prefix": prefix, "MaxKeys": 1000}
        if token:
            kw["ContinuationToken"] = token
        resp = s3.list_objects_v2(**kw)
        for obj in resp.get("Contents", []) or []:
            yield obj
        if resp.get("IsTruncated"):
            token = resp.get("NextContinuationToken")
        else:
            return


def head(s3, key: str) -> dict | None:
    try:
        return s3.head_object(Bucket=_bucket(), Key=key)
    except Exception:  # noqa: BLE001 — treat any miss as "not found"
        return None


def copy_phase(
    s3, mapping: list[dict], dry_run: bool, include_spines: bool
) -> tuple[int, int, int]:
    """Returns (copied, skipped, bytes_total)."""
    copied = skipped = total_bytes = 0
    for row in mapping:
        project = row["project"]
        client = row["client"]
        for tool in TOOL_PREFIXES:
            src_prefix = f"{tool}/{LEGACY_CLIENT}/{project}/"
            dst_prefix = f"{tool}/{client}/{project}/"
            print(f"\n[copy] {src_prefix}  ->  {dst_prefix}")
            n_copied = n_skipped = 0
            for obj in list_all_keys(s3, src_prefix):
                src_key = obj["Key"]
                rel = src_key[len(src_prefix):]
                dst_key = dst_prefix + rel
                size = int(obj.get("Size") or 0)
                existing = head(s3, dst_key)
                if existing and existing.get("ETag") == obj.get("ETag"):
                    n_skipped += 1
                    skipped += 1
                    continue
                print(f"  cp  {src_key}  ->  {dst_key}  ({size} B)")
                if not dry_run:
                    s3.copy_object(
                        Bucket=_bucket(),
                        Key=dst_key,
                        CopySource={"Bucket": _bucket(), "Key": src_key},
                        MetadataDirective="COPY",
                    )
                n_copied += 1
                copied += 1
                total_bytes += size
            print(f"  -> {n_copied} copied, {n_skipped} skipped")
    if include_spines:
        print("\n[spines] --include-spines is reserved — provide a manual --map "
              "row per bundle. Today's spine bundles are not project-keyed so "
              "the migration skips them by default.")
    return copied, skipped, total_bytes


def delete_phase(s3, mapping: list[dict], dry_run: bool) -> tuple[int, int]:
    """Returns (deleted, bytes_total)."""
    deleted = total_bytes = 0
    for row in mapping:
        project = row["project"]
        for tool in TOOL_PREFIXES:
            src_prefix = f"{tool}/{LEGACY_CLIENT}/{project}/"
            print(f"\n[delete] {src_prefix}")
            batch: list[dict] = []
            for obj in list_all_keys(s3, src_prefix):
                batch.append({"Key": obj["Key"]})
                total_bytes += int(obj.get("Size") or 0)
                if len(batch) >= 1000:
                    _flush_delete(s3, batch, dry_run)
                    deleted += len(batch)
                    batch = []
            if batch:
                _flush_delete(s3, batch, dry_run)
                deleted += len(batch)
    return deleted, total_bytes


def _flush_delete(s3, batch: list[dict], dry_run: bool) -> None:
    for o in batch:
        print(f"  rm  {o['Key']}")
    if dry_run:
        return
    s3.delete_objects(Bucket=_bucket(), Delete={"Objects": batch, "Quiet": True})


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--phase", choices=("copy", "delete", "both"), default="copy",
                    help="Migration phase. Default: copy (Phase A, non-destructive).")
    ap.add_argument("--dry-run", dest="dry_run", action="store_true", default=True,
                    help="Print actions, don't mutate. Default ON.")
    ap.add_argument("--no-dry-run", dest="dry_run", action="store_false",
                    help="Actually perform copy/delete operations.")
    ap.add_argument("--map", dest="map_path", default=None,
                    help="JSON mapping file (alternative to DATABASE_URL).")
    ap.add_argument("--include-spines", action="store_true",
                    help="Reserved. Spines stay untouched; pass with a manual --map.")
    args = ap.parse_args(argv)

    if args.map_path:
        mapping = load_mapping_from_file(args.map_path)
        print(f"[map] {len(mapping)} project(s) loaded from {args.map_path}")
    else:
        mapping = load_mapping_from_db()
        print(f"[map] {len(mapping)} project(s) loaded from DATABASE_URL")

    if not mapping:
        print("[map] empty mapping — nothing to do.", file=sys.stderr)
        return 1

    s3 = _r2_client()

    mode = "DRY RUN" if args.dry_run else "LIVE"
    print(f"[mode] {mode}  phase={args.phase}")

    try:
        if args.phase in ("copy", "both"):
            copied, skipped, nbytes = copy_phase(
                s3, mapping, args.dry_run, args.include_spines,
            )
            print(f"\n[copy summary] copied={copied} skipped={skipped} "
                  f"bytes={nbytes}")
        if args.phase in ("delete", "both"):
            if args.phase == "both" and args.dry_run is False:
                # Refuse silent combined runs against prod. Operator should
                # verify the deploy before purging legacy keys.
                print("[abort] --phase=both with --no-dry-run is intentionally "
                      "blocked. Run copy first, deploy, verify, then delete.",
                      file=sys.stderr)
                return 2
            deleted, nbytes = delete_phase(s3, mapping, args.dry_run)
            print(f"\n[delete summary] deleted={deleted} bytes={nbytes}")
    except Exception as e:  # noqa: BLE001 — stop on first error per spec
        print(f"[error] {type(e).__name__}: {e}", file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
