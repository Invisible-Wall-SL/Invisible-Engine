"""One-time seed: upload the LOCAL Atlas Maker's manifests + refs + config into
R2 under the cloud project prefix, so the deployed cloud tool starts with the
same content you have locally.

Run on the machine that has the local tool, with R2 creds in the environment:

    set R2_ENDPOINT=...           (or export on bash)
    set R2_BUCKET=invisibleassets
    set R2_ACCESS_KEY_ID=...
    set R2_SECRET_ACCESS_KEY=...
    set ATLAS_PROJECT=cloud           (the cloud project key; default "cloud")
    py seed_r2.py

Source locations (override via env if different):
  TOOL_DIR    = the local "Invisible Atlas Maker" folder (manifests live here)
  LOCAL_INPUT = Shared/input/atlas_maker/<LOCAL_PROJECT>  (refs live here)
  LOCAL_PROJECT = the LOCAL project key (default "Borut_Hotfruits")

Uploads to R2:
  atlas_maker/cloud/<ATLAS_PROJECT>/manifests/<atlas_manifest_*.json | *.atlas>
  atlas_maker/cloud/<ATLAS_PROJECT>/input/<refs...>
  atlas_maker/cloud/<ATLAS_PROJECT>/atlas_config.json   (comfy_org_api_key stripped)
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import storage  # uses R2_* env

DEFAULT_TOOL_DIR = r"C:\Invisible Wall SL\Projects\Invisible_Pipeline\tools\Invisible Atlas Maker"
DEFAULT_SHARED = r"C:\Invisible Wall SL\ComfyUI\Shared"


def _safe(name: str) -> str:
    return "".join(c if c.isalnum() else "_" for c in (name or "default"))[:60]


def main() -> None:
    proj = _safe(os.environ.get("ATLAS_PROJECT", "cloud"))
    prefix = f"atlas_maker/cloud/{proj}"
    tool_dir = Path(os.environ.get("ATLAS_TOOL_DIR", DEFAULT_TOOL_DIR))
    shared = Path(os.environ.get("ATLAS_SHARED", DEFAULT_SHARED))
    local_proj = os.environ.get("ATLAS_LOCAL_PROJECT", "Borut_Hotfruits")
    local_input = Path(
        os.environ.get("ATLAS_LOCAL_INPUT", str(shared / "input" / "atlas_maker" / local_proj))
    )

    n_man = n_ref = 0

    # 1) Manifests (+ any .atlas geometry sitting next to them).
    for p in sorted(tool_dir.glob("atlas_manifest_*.json")):
        storage.put(f"{prefix}/manifests/{p.name}", p.read_bytes(), "application/json")
        n_man += 1
    for p in sorted(tool_dir.glob("*.atlas")):
        storage.put(f"{prefix}/manifests/{p.name}", p.read_bytes(), "text/plain")
        n_man += 1

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

    print(f"[seed] done → r2:{prefix}  (manifests/atlas={n_man}, refs={n_ref})")
    print(f"[seed] tool_dir={tool_dir}")
    print(f"[seed] local_input={local_input} (exists={local_input.exists()})")


if __name__ == "__main__":
    main()
