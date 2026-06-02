"""Migrate R2 from the per-tool layout to the unified single-project repo.

    OLD:  <tool>/<client>/<project>/<subfolder>/...   (atlas_maker, sheet_maker,
                                                        localization, editor, spines)
    NEW:  <client>/<project>/<asset-type>/...          (one shared project repo)

See docs/design/unified-project-repo.md. Two phases, idempotent, dry-run by
default — NOTHING is written or deleted until you pass --apply / --phase-b.

Run on a box with R2 creds in the environment (same vars as the tools):
    R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY

    py scripts/migrate-r2-unified-repo.py                 # DRY RUN (Phase A plan)
    py scripts/migrate-r2-unified-repo.py --apply         # Phase A: server-side copy
    py scripts/migrate-r2-unified-repo.py --verify        # compare old vs new counts
    py scripts/migrate-r2-unified-repo.py --phase-b --i-verified-cutover   # delete old

Phase A is non-destructive (CopyObject only; old keys stay). Verify + smoke-test
the live tools, THEN run Phase B to retire the old prefixes.

Key remap (C/P slugged with the canonical r2_slug, so `book-of-borut` →
`book_of_borut` to match the tools + launcher):
  atlas_maker/<C>/<P>/manifests/X            -> <c>/<p>/manifests/X
  atlas_maker/<C>/<P>/input/X                -> <c>/<p>/input/X
  atlas_maker/<C>/<P>/output/<any>/atlas/X   -> <c>/<p>/atlas/X
  atlas_maker/<C>/<P>/output/<any>/batch/X   -> <c>/<p>/batch/X
  atlas_maker/<C>/<P>/deploy/X               -> <c>/<p>/deploy/X
  atlas_maker/<C>/<P>/atlas_config.json      -> <c>/<p>/atlas_config.json
  sheet_maker/<C>/<P>/input/<sheet>/X        -> <c>/<p>/sheet_src/<sheet>/X
  sheet_maker/<C>/<P>/output/<sheet>/atlas_manifest_*.json -> <c>/<p>/manifests/<that>.json
  sheet_maker/<C>/<P>/output/<sheet>/X       -> <c>/<p>/sheets/<sheet>/X
  sheet_maker/<C>/<P>/sheet_config.json      -> <c>/<p>/sheet_config.json
  localization/<C>/<P>/X                     -> <c>/<p>/localization/X
  editor/<C>/<P>/X                           -> <c>/<p>/editor/X
  spines/_shared/<bundle>/X                  -> _shared/spines/<bundle>/X
  spines/<C>/<P>/<bundle>/X                  -> <c>/<p>/spines/<bundle>/X

NOTE on legacy spines: a pre-client-isolation prefix like `spines/hotfruits/...`
(no <client>/<project>) can't be mapped automatically — it's logged as MANUAL and
skipped. Map it explicitly with --legacy-spine "spines/hotfruits=borut/hotfruits/symbols".
"""
from __future__ import annotations

import argparse
import os
import re
import sys

import boto3

OLD_TOOL_PREFIXES = ("atlas_maker/", "sheet_maker/", "localization/", "editor/", "spines/")


def r2_slug(name: str) -> str:
    """Canonical R2 slug — byte-identical to iw_common.context.r2_slug."""
    return re.sub(r"[^a-z0-9]", "_", (name or "default").lower())[:60] or "default"


def _client():
    return boto3.client(
        "s3",
        region_name="auto",
        endpoint_url=os.environ["R2_ENDPOINT"],
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
    )


def _list(cli, bucket: str, prefix: str) -> list[dict]:
    out, token = [], None
    while True:
        kw = {"Bucket": bucket, "Prefix": prefix}
        if token:
            kw["ContinuationToken"] = token
        resp = cli.list_objects_v2(**kw)
        for o in resp.get("Contents", []):
            out.append({"key": o["Key"], "size": o.get("Size", 0)})
        if resp.get("IsTruncated"):
            token = resp.get("NextContinuationToken")
        else:
            break
    return out


def map_key(key: str, legacy_spines: dict[str, str]) -> str | None:
    """Old key -> new key, or None when it can't be mapped (logged MANUAL)."""
    parts = key.split("/")
    if key.endswith("/"):
        return None  # folder placeholder
    tool = parts[0]

    if tool in ("atlas_maker", "sheet_maker"):
        if len(parts) < 4:
            return None
        c, p, rest = r2_slug(parts[1]), r2_slug(parts[2]), parts[3:]
        base = f"{c}/{p}"
        if tool == "atlas_maker":
            if rest[0] == "output":
                # output/<any>/atlas/... | output/<any>/batch/...
                if len(rest) >= 4 and rest[2] in ("atlas", "batch"):
                    return f"{base}/{rest[2]}/" + "/".join(rest[3:])
                # any other output/* — drop the redundant output/<mid> nesting
                return f"{base}/" + "/".join(rest[2:]) if len(rest) > 2 else None
            # manifests/, input/, deploy/, atlas_config.json, anything else
            return f"{base}/" + "/".join(rest)
        # sheet_maker
        if rest[0] == "input":
            return f"{base}/sheet_src/" + "/".join(rest[1:])
        if rest[0] == "output":
            fname = rest[-1]
            if fname.startswith("atlas_manifest_") and fname.endswith(".json"):
                return f"{base}/manifests/{fname}"
            return f"{base}/sheets/" + "/".join(rest[1:])
        return f"{base}/" + "/".join(rest)  # sheet_config.json, etc.

    if tool in ("localization", "editor"):
        if len(parts) < 4:
            return None
        c, p = r2_slug(parts[1]), r2_slug(parts[2])
        return f"{c}/{p}/{tool}/" + "/".join(parts[3:])

    if tool == "spines":
        if len(parts) >= 3 and parts[1] == "_shared":
            return "_shared/spines/" + "/".join(parts[2:])
        # Everything else (legacy client-less `spines/<game>/...`) is ambiguous —
        # `spines/<C>/<P>/<bundle>` and `spines/<game>/<bundle>/<sub>` are
        # structurally indistinguishable — so require an EXPLICIT mapping rather
        # than guess. Match the longest old prefix from --legacy-spine.
        best = None
        for old_pre in legacy_spines:
            op = old_pre.rstrip("/") + "/"
            if key.startswith(op) and (best is None or len(op) > len(best)):
                best = op
        if best is not None:
            return legacy_spines[best.rstrip("/")].rstrip("/") + "/" + key[len(best):]
        return None  # unmapped legacy spine — surfaced as MANUAL

    return None


def main() -> int:
    ap = argparse.ArgumentParser(description="Migrate R2 to the unified project repo.")
    ap.add_argument("--apply", action="store_true", help="Phase A: perform the copies.")
    ap.add_argument("--verify", action="store_true", help="Compare old vs new key counts.")
    ap.add_argument("--phase-b", action="store_true", help="Delete the OLD prefixes.")
    ap.add_argument("--i-verified-cutover", action="store_true",
                    help="Required safety flag for --phase-b.")
    ap.add_argument("--legacy-spine", action="append", default=[],
                    metavar="OLD=NEW", help="Map a legacy spine prefix, e.g. "
                    "spines/hotfruits=borut/hotfruits/symbols. Repeatable.")
    ap.add_argument("--exclude", action="append", default=[], metavar="C/P",
                    help="Skip an old (client/project) entirely — neither copied "
                    "nor (in Phase B) deleted. E.g. borut/book_of_borut. Repeatable.")
    args = ap.parse_args()

    excludes = {e.strip().strip("/") for e in args.exclude}

    def _excluded(key: str) -> bool:
        parts = key.split("/")
        # old keys are <tool>/<client>/<project>/...; match on raw client/project
        return len(parts) >= 3 and f"{parts[1]}/{parts[2]}" in excludes

    legacy_spines: dict[str, str] = {}
    for pair in args.legacy_spine:
        if "=" not in pair:
            print(f"! bad --legacy-spine (need OLD=NEW): {pair}")
            return 2
        old, new = pair.split("=", 1)
        legacy_spines[old.strip()] = new.strip()

    cli = _client()
    bucket = os.environ["R2_BUCKET"]

    # Gather every old-layout object.
    olds: list[dict] = []
    for pre in OLD_TOOL_PREFIXES:
        olds.extend(_list(cli, bucket, pre))
    print(f"[migrate] found {len(olds)} object(s) under old prefixes.")

    planned: list[tuple[str, str, int]] = []  # (src, dst, size)
    manual: list[str] = []
    excluded_keys: list[str] = []  # skipped from copy; purged in Phase B
    for o in olds:
        if _excluded(o["key"]):
            excluded_keys.append(o["key"])
            continue
        dst = map_key(o["key"], legacy_spines)
        if dst is None:
            manual.append(o["key"])
        else:
            planned.append((o["key"], dst, o["size"]))
    if excludes:
        print(f"[migrate] excluded {len(excluded_keys)} object(s) under: "
              f"{', '.join(sorted(excludes))} (NOT copied; purged in Phase B)")

    if args.phase_b:
        if not args.i_verified_cutover:
            print("! Phase B refused: pass --i-verified-cutover once you've verified "
                  "the cutover (Phase A copied + live tools smoke-tested).")
            return 2
        n = 0
        for src, _dst, _sz in planned:
            cli.delete_object(Bucket=bucket, Key=src)
            n += 1
        for src in excluded_keys:  # the stale dupe / strays — "one should go"
            cli.delete_object(Bucket=bucket, Key=src)
            n += 1
        print(f"[migrate] Phase B: deleted {n} old object(s) "
              f"({len(planned)} migrated + {len(excluded_keys)} excluded). "
              f"({len(manual)} MANUAL keys left untouched.)")
        return 0

    if args.verify:
        bad = 0
        for src, dst, sz in planned:
            try:
                h = cli.head_object(Bucket=bucket, Key=dst)
                if h.get("ContentLength", -1) != sz:
                    print(f"  size mismatch: {dst} ({h.get('ContentLength')} != {sz})")
                    bad += 1
            except Exception:  # noqa: BLE001
                print(f"  MISSING at dest: {dst}")
                bad += 1
        print(f"[migrate] verify: {len(planned)} expected, {bad} missing/mismatched.")
        return 1 if bad else 0

    # Phase A (plan or apply).
    copied = skipped = 0
    for src, dst, sz in planned:
        if args.apply:
            try:
                head = cli.head_object(Bucket=bucket, Key=dst)
                if head.get("ContentLength", -1) == sz:
                    skipped += 1
                    continue
            except Exception:  # noqa: BLE001 — dst missing → copy
                pass
            cli.copy_object(Bucket=bucket, Key=dst,
                            CopySource={"Bucket": bucket, "Key": src})
            copied += 1
            print(f"  copy {src}  ->  {dst}  ({sz} B)")
        else:
            print(f"  WOULD copy {src}  ->  {dst}  ({sz} B)")

    if manual:
        print(f"\n[migrate] {len(manual)} key(s) need a MANUAL mapping "
              f"(e.g. legacy spines) — use --legacy-spine:")
        for k in manual[:50]:
            print(f"    MANUAL  {k}")
        if len(manual) > 50:
            print(f"    … +{len(manual) - 50} more")

    if args.apply:
        print(f"\n[migrate] Phase A done: {copied} copied, {skipped} already present. "
              f"Next: --verify, smoke-test the tools, then --phase-b --i-verified-cutover.")
    else:
        print(f"\n[migrate] DRY RUN: {len(planned)} object(s) would copy, "
              f"{len(manual)} need manual mapping. Re-run with --apply to execute.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
