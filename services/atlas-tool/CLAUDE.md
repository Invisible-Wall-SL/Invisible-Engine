# atlas-tool — Claude guide

The LOCAL `Invisible Atlas Maker` Python tool, **re-hosted on Railway** (project `atlas-tools`, `invisible-engine-production-0060.up.railway.app`). The owner explicitly wanted the existing tool online — this is a re-host, NOT a rewrite. Do not turn it into a SvelteKit app.

## How the port works
- **`cloud_paths.py`** — drop-in for the original `project_paths.py`. Same `resolve()` dict shape, but `input_dir/batch_dir/atlas_dir/manifest_dir` point at a **local staging dir** (`ATLAS_STAGING`, default `/data/atlas-tool`) that mirrors an R2 prefix `atlas_maker/<client>/<project>` 1:1 (Option B client isolation; `unassigned` is the reserved default client). So the original `ui_server.py`/`batch_atlas.py` pathlib+PIL code runs unchanged. Adds `comfy_url`, `cf_headers`, `r2_project_prefix`. The output sub-prefix is ALWAYS `<project>` (the legacy `ATLAS_OUTPUT_PREFIX` env is gone). Active (client, project) is **request-local**: held in a `threading.local()` so each request thread (ThreadingHTTPServer = one thread per request) has its own context — `set_context` / `switch_context` mutate only the calling thread. This is what makes concurrent different-project requests safe (no cross-tenant write). In `ui_server.py`/`batch_atlas.py` the path names (`INPUT_DIR`, `BATCH_DIR`, `R2_PREFIX`, …) are thin proxy objects that re-resolve per access, so the ~130 call sites stay unchanged but become thread-local. **Never reintroduce module-global path state** (the old race). Env defaults: `ATLAS_CLIENT` (default `unassigned`) + `ATLAS_PROJECT` (default `cloud`), each overridden by `IW_CLIENT_NAME` / `IW_PROJECT_NAME` from the launcher.
- **`storage.py`** — R2 via boto3: `get/put/exists/delete/list_keys` + `pull_prefix`/`push_dir`/`push_file`. Staging hydrates from R2 at startup (`hydrate()`); writes mirror back (`_mirror()` in ui_server, `_persist_variant()` in batch_atlas).
- **`batch_atlas.py`** — generation engine. ComfyUI is remote (tunnel): `COMFY_BASE`+`CF_HEADERS` on every call; `comfy_upload_image()` + `_upload_workflow_refs()` upload each `LoadImage` ref via `/upload/image`; results fetched via `/view` and persisted to staging+R2.
- **`ui_server.py`** — the web UI (one big embedded HTML string, stdlib `http.server`). Config + manifests live in staging (R2-backed). Shared-secret gate `_gate()` (`ATLAS_TOOL_SECRET`, unset = open). `/fsbrowse` lists R2 manifests; `/deployatlas` copies to R2.

## Don't regress
- **Cloudflare blocks `Python-urllib` UA → 403.** Every ComfyUI call needs `User-Agent: InvisibleAtlas/1.0` + the CF Access headers (already in `cloud_paths.cf_headers()`).
- ComfyUI can't see our filesystem — upload refs, fetch outputs via `/view`. Never assume shared disk.
- Staging hydrates from R2 **only at startup** → after seeding/changing R2, **restart the service**.
- No secrets in code (`atlas_config.json` with the comfy.org key is gitignored / not copied). Env only.

## Validate / ship
- `py -m py_compile *.py` before committing.
- Deploy = push to `main` (auto-deploy). Use the `/deploy` skill.
- Seed R2 with local data: `py seed_r2.py` (R2 creds in env), then restart the service.

See `docs/INFRA.md` (envs/URLs) and `docs/STATUS.md` (remaining: `.atlas` geometry in R2, FLUX/gpt_image pipelines, access gate).
