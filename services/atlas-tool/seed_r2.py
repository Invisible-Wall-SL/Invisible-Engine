"""One-time seed: upload the LOCAL Atlas Maker's manifests + refs + config into
R2 under the cloud project prefix, so the deployed cloud tool starts with the
same content you have locally.

Run on the machine that has the local tool, with R2 creds in the environment:

    set R2_ENDPOINT=...           (or export on bash)
    set R2_BUCKET=invisibleassets
    set R2_ACCESS_KEY_ID=...
    set R2_SECRET_ACCESS_KEY=...
    set ATLAS_CLIENT=borut            (the launcher client key; default "borut")
    set ATLAS_PROJECT=hotfruits       (the launcher project key; default "hotfruits")
    py seed_r2.py

Source locations (override via env if different):
  ATLAS_TOOL_DIR      = the local "Invisible Atlas Maker" folder (manifests live here)
  ATLAS_LOCAL_PROJECT = the LOCAL input project key (default "Borut_Hotfruits")
  ATLAS_LOCAL_INPUT   = Shared/input/atlas_maker/<ATLAS_LOCAL_PROJECT> (refs live here;
                        overrides the whole path if set)

Uploads to R2 (unified single-project-repo layout — no `<tool>/` segment):
  <CLIENT>/<PROJECT>/manifests/<atlas_manifest_*.json | *.atlas>
  <CLIENT>/<PROJECT>/input/<refs...>
  <CLIENT>/<PROJECT>/atlas_config.json   (comfy_org_api_key stripped)

NOTE: client/project keys pass through `r2_slug` (lowercase, non-alphanumerics
-> `_`, 60-char cap) — byte-identical to the tools + launcher — so a hyphenated
launcher key like `my-game` maps to the same `my_game` everywhere.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import storage  # uses R2_* env

DEFAULT_TOOL_DIR = r"C:\Invisible Wall SL\Projects\Invisible_Pipeline\tools\Invisible Atlas Maker"
DEFAULT_SHARED = r"C:\Invisible Wall SL\ComfyUI\Shared"


def _key(val: str, default: str) -> str:
    """Canonical R2 slug — byte-identical to `iw_common.context.r2_slug` and the
    launcher's `r2Slug`: lowercase, non-alphanumerics -> `_`, 60-char cap. So a
    hyphenated launcher key (`my-game`) maps to the same `my_game`
    the tools read."""
    import re
    return re.sub(r"[^a-z0-9]", "_", (val or default).lower())[:60] or "default"


def _is_abs_local(v: str) -> bool:
    """True for a Windows drive path, UNC, backslash path or POSIX-absolute path
    — i.e. NOT already an INPUT_DIR-relative key like `refs/atlas/x.atlas`."""
    import re
    if not v:
        return False
    return bool(re.match(r"^[A-Za-z]:[\\/]", v)) or v.startswith(("\\", "/")) or "\\" in v


def _atlas_page_image(atlas_path: Path) -> str:
    """The first non-empty line of a `.atlas` is its page image filename."""
    try:
        for line in atlas_path.read_text(encoding="utf-8", errors="replace").splitlines():
            if line.strip():
                return line.strip()
    except OSError:
        pass
    return ""


def _localize_atlas_refs(m: dict, extra_refs: dict[str, bytes]) -> None:
    """An atlas-bound manifest authored locally carries Windows paths in
    `atlas.atlas_file` / `atlas.source_image`. Copy the referenced `.atlas` +
    its page image into `input/refs/atlas/` (recorded in `extra_refs`) and
    rewrite those fields to the `refs/atlas/<name>` key the cloud resolver
    expects, so compose/slice resolve in the cloud. Mutates `m` in place."""
    atlas = m.get("atlas")
    if not isinstance(atlas, dict):
        return

    # (a) geometry .atlas
    af = str(atlas.get("atlas_file") or "")
    atlas_disk: Path | None = None
    if af and _is_abs_local(af):
        ap = Path(af)
        if ap.exists():
            atlas_disk = ap
            extra_refs[f"refs/atlas/{ap.name}"] = ap.read_bytes()
            atlas["atlas_file"] = f"refs/atlas/{ap.name}"
        else:
            print(f"[seed]   ! atlas_file missing on disk: {af}")

    # (b) page image: prefer the manifest's explicit source_image, else the page
    #     the .atlas itself references (found next to the .atlas on disk).
    si = str(atlas.get("source_image") or "")
    page_disk: Path | None = None
    if si and _is_abs_local(si) and Path(si).exists():
        page_disk = Path(si)
    elif atlas_disk is not None:
        pg = _atlas_page_image(atlas_disk)
        if pg and (atlas_disk.parent / pg).exists():
            page_disk = atlas_disk.parent / pg
    if page_disk is not None:
        extra_refs[f"refs/atlas/{page_disk.name}"] = page_disk.read_bytes()
        atlas["source_image"] = f"refs/atlas/{page_disk.name}"
    elif si and _is_abs_local(si):
        print(f"[seed]   ! source_image missing on disk: {si}")


def main() -> None:
    # Target (client, project) under R2: <client>/<project>/... (unified repo).
    # Defaults to the Borut/HotFruits launcher project; override via env.
    client = _key(os.environ.get("ATLAS_CLIENT", "borut"), "borut")
    proj = _key(os.environ.get("ATLAS_PROJECT", "hotfruits"), "hotfruits")
    prefix = f"{client}/{proj}"
    tool_dir = Path(os.environ.get("ATLAS_TOOL_DIR", DEFAULT_TOOL_DIR))
    shared = Path(os.environ.get("ATLAS_SHARED", DEFAULT_SHARED))
    local_proj = os.environ.get("ATLAS_LOCAL_PROJECT", "Borut_Hotfruits")
    local_input = Path(
        os.environ.get("ATLAS_LOCAL_INPUT", str(shared / "input" / "atlas_maker" / local_proj))
    )

    n_man = n_ref = n_geo = 0

    # 1) Manifests. An atlas-bound manifest authored offline points
    #    atlas_file/source_image at a local Windows path; we copy that .atlas +
    #    page image into refs/atlas/ and rewrite the manifest to the relative
    #    key the cloud resolver expects (else "Atlas geometry not found in R2").
    for p in sorted(tool_dir.glob("atlas_manifest_*.json")):
        try:
            m = json.loads(p.read_text(encoding="utf-8"))
        except (ValueError, OSError) as e:
            print(f"[seed]   ! skipped unreadable manifest {p.name}: {e}")
            continue
        extra_refs: dict[str, bytes] = {}
        _localize_atlas_refs(m, extra_refs)
        for rel, blob in extra_refs.items():
            storage.put(f"{prefix}/input/{rel}", blob)
            n_geo += 1
            print(f"[seed]   + {p.name}: {rel} ({len(blob)} bytes)")
        storage.put(
            f"{prefix}/manifests/{p.name}",
            json.dumps(m, indent=2).encode("utf-8"),
            "application/json",
        )
        n_man += 1
    for p in sorted(tool_dir.glob("*.atlas")):
        blob = p.read_bytes()
        # Keep the legacy manifests/ copy, AND place geometry under
        # input/refs/atlas/ where batch_atlas resolves a relative `atlas_file`
        # (e.g. symbols2/3/transition reference a bare `symbols2.atlas`). Without
        # this they'd hit the same "Atlas geometry not found in R2" error.
        storage.put(f"{prefix}/manifests/{p.name}", blob, "text/plain")
        storage.put(f"{prefix}/input/refs/atlas/{p.name}", blob, "text/plain")
        n_man += 1
        n_geo += 1

    # 2) Refs (everything under the local input dir → <prefix>/input/...).
    if local_input.exists():
        for p in local_input.rglob("*"):
            if p.is_file():
                rel = p.relative_to(local_input).as_posix()
                storage.put(f"{prefix}/input/{rel}", p.read_bytes())
                n_ref += 1

    # 3) Config (strip the comfy.org key — it belongs in env, never in R2).
    cfg_path = tool_dir / "atlas_config.json"
    if cfg_path.exists():
        try:
            cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
            cfg.pop("comfy_org_api_key", None)
            storage.put(
                f"{prefix}/atlas_config.json",
                json.dumps(cfg, indent=2).encode("utf-8"),
                "application/json",
            )
        except (ValueError, OSError) as e:
            print(f"[seed] config skipped: {e}")

    print(f"[seed] done -> r2:{prefix}  (manifests/atlas={n_man}, "
          f"refs={n_ref}, geometry={n_geo})")
    print(f"[seed] tool_dir={tool_dir}")
    print(f"[seed] local_input={local_input} (exists={local_input.exists()})")


if __name__ == "__main__":
    main()
