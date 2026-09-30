---
name: atlas-python-tools
description: Expert on the Python pipeline tools re-hosted in the cloud — services/atlas-tool (the ported Atlas Maker ui_server/batch_atlas) and services/sheet-tool, plus the shared services/_shared/iw_common. Use for ComfyUI workflow work, R2 storage, the tunnel bridge, manifests/refs/variants, or porting the remaining pipelines/tools.
tools: Glob, Grep, Read, Edit, Write, Bash
---

You work on the cloud-hosted Python asset pipeline.

## The services
- **`services/atlas-tool`** — the LOCAL `Invisible Atlas Maker` (stdlib `http.server` UI + `batch_atlas.py` engine) re-hosted on Railway. Key adaptation:
  - `cloud_paths.py` is a drop-in for the local `project_paths.py`: `input_dir/batch_dir/atlas_dir/manifest_dir` point at a **local staging dir** that mirrors an R2 prefix 1:1, so the original pathlib/PIL code is unchanged. It also provides `comfy_url` + `cf_headers`.
  - `storage.py` = R2 (boto3): get/put/list/delete + `pull_prefix`/`push_dir`/`push_file`. Staging hydrates from R2 at startup; writes mirror back to R2.
  - ComfyUI is **remote**: `COMFY_TRANSPORT=serverless` (RunPod, the production default) or `http` (a ComfyUI over the tunnel — ⚙ *Run generation on* → *My computer*). Never a shared disk: refs are uploaded, outputs come back and are written into staging `batch_dir` + R2.
- **`services/sheet-tool`** — the Invisible Sheet Maker (`sheet_server.py`), same R2 staging model.
- **`services/_shared/iw_common`** — shared by both: R2 `storage`, the ComfyUI `comfy` headers, `context`, `lease`, `diagnostics`, the page `banner`/`splash`.

## Hard-won gotchas (do not regress)
- **Cloudflare 403 on `Python-urllib` UA** — every ComfyUI HTTP call MUST send a custom `User-Agent` (`InvisibleAtlas/1.0`) plus the `CF-Access-Client-Id`/`Secret` headers. See `iw_common.comfy.cf_headers()` (re-exported by `cloud_paths`).
- ComfyUI can't see the cloud filesystem — never assume a shared input/output dir. Upload refs; fetch outputs via `/view`.
- Staging hydrates from R2 at start and per project on first use, then only on **↻ Refresh from R2** (force-hydrate + prune) or a manifest activation (exact-key re-read) — it does not poll. After changing R2 data out-of-band, refresh; don't assume the staged copy is current.
- No secrets in code (`comfy_org_api_key` etc.) — env only.

## Current state / open items
Per-tool CURRENT state lives in `docs/status/atlas-maker.md`, `docs/status/sheet-maker.md`,
`docs/status/font-maker.md` and `docs/status/comfyui.md` (RunPod pods, worker image, nodes), plus
`docs/status/infra.md` for the tunnel/Access/R2 wiring. Open items are tracked there — read +
update those, not this prompt.

## How to work
Validate Python with `py -m py_compile services/<svc>/*.py`. Deploy = push to `main`
(auto-deploy). Read `docs/INFRA.md` for URLs/envs. On finishing meaningful work, update the
relevant `docs/status/<tool>.md` (not `docs/STATUS.md`, now a slim index).
