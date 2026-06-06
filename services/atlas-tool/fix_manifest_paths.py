"""One-off repair: normalize ref paths in the R2 manifests.

The local tool ran on Windows, which silently strips a trailing dot from a
directory name — so a folder literally named `symbols.` was treated as
`symbols`. The manifests still reference `refs/atlasslices/symbols./<x>.png`,
but on R2 (and the Linux container) the real path is `…/symbols/<x>.png`, so
refs resolve to "no ref" in the cloud.

This rewrites every manifest's path-like fields, stripping trailing dots/spaces
from each path segment (filenames are unaffected — they don't end in a dot),
and re-uploads. Idempotent. Run with R2 creds in env:

    py fix_manifest_paths.py
"""
from __future__ import annotations

import json
import os

import storage

PATH_FIELDS = ("style_ref", "shape_ref", "output_override")


def _key(val: str, default: str) -> str:
    """Canonical R2 slug — byte-identical to `iw_common.context.r2_slug`,
    `seed_r2.py._key` and the launcher's `r2Slug`: lowercase, non-alphanumerics
    -> `_`, 60-char cap. So a hyphenated launcher key (`my-game`) maps to
    the same `my_game` everywhere."""
    import re
    return re.sub(r"[^a-z0-9]", "_", (val or default).lower())[:60] or "default"


def _norm(path: str) -> str:
    if not isinstance(path, str) or "/" not in path:
        return path
    return "/".join(seg.rstrip(". ") for seg in path.split("/"))


def main() -> None:
    # Target (client, project) under R2: <client>/<project>/manifests/ (unified
    # single-project repo — no `atlas_maker/` tool segment). IW_* (from the
    # launcher) overrides ATLAS_*; mirrors seed_r2.py's env handling.
    client = _key(os.environ.get("IW_CLIENT_NAME") or os.environ.get("ATLAS_CLIENT", "borut"), "borut")
    proj = _key(os.environ.get("IW_PROJECT_NAME") or os.environ.get("ATLAS_PROJECT", "hotfruits"), "hotfruits")
    prefix = f"{client}/{proj}/manifests/"
    fixed_files = 0
    fixed_fields = 0
    for entry in storage.list_keys(prefix):
        key = entry["key"]
        if not key.endswith(".json"):
            continue
        try:
            m = json.loads(storage.get(key))
        except Exception:  # noqa: BLE001
            continue
        changed = False
        for region in m.get("regions", []):
            for f in PATH_FIELDS:
                if f in region:
                    new = _norm(region[f])
                    if new != region[f]:
                        region[f] = new
                        fixed_fields += 1
                        changed = True
        if changed:
            storage.put(key, json.dumps(m, indent=2, ensure_ascii=False).encode("utf-8"),
                        "application/json")
            fixed_files += 1
            print(f"  fixed {key.split('/')[-1]}")
    print(f"[fix] done -> {fixed_files} manifests, {fixed_fields} path fields normalized")


if __name__ == "__main__":
    main()
