"""iw_common — shared Python package for the Invisible Wall cloud tools.

Single source of truth for code that the `atlas-tool` and `sheet-tool` Railway
services would otherwise copy-paste:

  - ``iw_common.storage``  — R2/boto3 object storage + staging sync.
  - ``iw_common.banner``   — the console startup banner.
  - ``iw_common.comfy``    — the ComfyUI client headers (the Cloudflare 403 UA fix).
  - ``iw_common.context``  — the thread-local (client, project) context base.
  - ``iw_common.imgcache`` — disk-backed thumbnail cache + HTTP ETag/304 helpers
    (kills the many-thumbnail 502 storm; shared by every HTTP image route).

Each service keeps a thin tool-specific ``cloud_paths.py`` (its own
``resolve()`` / ``hydrate()`` + env names) and 1-line re-export shims for
``storage.py`` / ``iw_banner.py``. No logic is duplicated.

The repo-root Docker build context COPYs ``services/_shared/iw_common`` into the
image (e.g. ``/app/iw_common``) so ``import iw_common.storage`` resolves at
runtime; ``PYTHONPATH=/app`` makes it importable.
"""
