"""One-time seed: upload the built-in reference blueprints into R2 under the
global, cross-project `_shared/blueprints/` prefix, so the deployed cloud Atlas
Maker can list/drive them (and users can copy them as templates for new ones).

Source is the tracked `blueprints_src/<id>/` tree in this service (each dir = one
blueprint: `blueprint.json` + `workflow.json`). This is a straight dir->prefix
mirror — adding a 4th built-in is just another `blueprints_src/<id>/` folder.

Run with R2 creds in the environment (same as seed_r2.py):

    set R2_ENDPOINT=...
    set R2_BUCKET=invisibleassets
    set R2_ACCESS_KEY_ID=...
    set R2_SECRET_ACCESS_KEY=...
    py seed_blueprints.py

NOTE: the staging mirror hydrates from R2 only at container START, so after
seeding, RESTART the atlas-tool service for the new blueprints to appear.
"""
from __future__ import annotations

import os
from pathlib import Path

import storage  # uses R2_* env

from blueprints import SHARED_BLUEPRINTS_PREFIX

SRC = Path(os.environ.get("BLUEPRINTS_SRC", str(Path(__file__).resolve().parent / "blueprints_src")))


def main() -> None:
    if not SRC.is_dir():
        print(f"[seed-bp] source dir not found: {SRC}")
        return
    n_files = n_bp = 0
    for d in sorted(p for p in SRC.iterdir() if p.is_dir()):
        man = d / "blueprint.json"
        wf = d / "workflow.json"
        if not man.is_file() or not wf.is_file():
            print(f"[seed-bp]   ! skipped '{d.name}': "
                  "missing blueprint.json or workflow.json")
            continue
        # Upload only what the runner reads (blueprint.json + workflow.json) and
        # an optional thumb.png. The `workflow.ui.json` authoring sources (the
        # ComfyUI editor exports) stay repo-local — they're for humans, not the
        # /prompt API.
        for name in ("blueprint.json", "workflow.json", "thumb.png"):
            p = d / name
            if not p.is_file():
                continue
            key = f"{SHARED_BLUEPRINTS_PREFIX}/{d.name}/{name}"
            storage.put(key, p.read_bytes())
            n_files += 1
            print(f"[seed-bp]   + {key} ({p.stat().st_size} bytes)")
        n_bp += 1

    print(f"[seed-bp] done -> r2:{SHARED_BLUEPRINTS_PREFIX}/  "
          f"(blueprints={n_bp}, files={n_files})")
    print("[seed-bp] RESTART the atlas-tool service to hydrate the new blueprints.")


if __name__ == "__main__":
    main()
