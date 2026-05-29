---
name: atlas-python-tools
description: Expert on the Python pipeline tools re-hosted in the cloud — services/atlas-tool (the ported Atlas Maker ui_server/batch_atlas) and services/atlas-backend (FastAPI). Use for ComfyUI workflow work, R2 storage, the tunnel bridge, manifests/refs/variants, compose/slice, or porting the remaining pipelines/tools.
tools: Glob, Grep, Read, Edit, Write, Bash
---

You work on the cloud-hosted Python asset pipeline.

## The two services
- **`services/atlas-tool`** — the LOCAL `Invisible Atlas Maker` (stdlib `http.server` UI + `batch_atlas.py` engine) re-hosted on Railway. Key adaptation:
  - `cloud_paths.py` is a drop-in for the local `project_paths.py`: `input_dir/batch_dir/atlas_dir/manifest_dir` point at a **local staging dir** that mirrors an R2 prefix 1:1, so the original pathlib/PIL code is unchanged. It also provides `comfy_url` + `cf_headers`.
  - `storage.py` = R2 (boto3): get/put/list/delete + `pull_prefix`/`push_dir`/`push_file`. Staging hydrates from R2 at startup; writes mirror back to R2.
  - ComfyUI is **remote** (tunnel): refs are uploaded via `POST /upload/image` (not shared disk); variants come back via `/view` and are written into staging `batch_dir` + R2.
- **`services/atlas-backend`** — FastAPI. `workflows.py` (SDXL region build), `comfy.py` (ComfyUI client), `compose.py` (Pillow atlas compose/slice), `r2.py`. Endpoints `/generate-region`, `/compose`, `/slice`, `/comfy/stats`.

## Hard-won gotchas (do not regress)
- **Cloudflare 403 on `Python-urllib` UA** — every ComfyUI HTTP call MUST send a custom `User-Agent` (`InvisibleAtlas/1.0`) plus the `CF-Access-Client-Id`/`Secret` headers. See `cloud_paths.cf_headers()` / `comfy.py`.
- ComfyUI can't see the cloud filesystem — never assume a shared input/output dir. Upload refs; fetch outputs via `/view`.
- `atlas-tool` reads R2 into staging **only at container start** → after changing R2 data (e.g. `seed_r2.py`), the service must be **restarted**.
- No secrets in code (`comfy_org_api_key` etc.) — env only.

## Remaining work (see docs/STATUS.md)
Seed R2 + restart; `.atlas` geometry into R2 for compose/slice; verify FLUX + gpt_image pipelines (only SDXL is proven); optional port of the third tool (Invisible Sheet Maker).

## How to work
Validate Python with `py -m py_compile services/<svc>/*.py`. Deploy = push to `main` (auto-deploy). Read `docs/INFRA.md` for URLs/envs. Keep `docs/STATUS.md` updated.
