# Infrastructure

> Source of truth for the cloud setup. Keep this updated when services/URLs/envs change.
> **No secrets in this file** — only names of env vars and non-secret IDs.

## Overview

```
                 app.invisiblewall.org  (Cloudflare DNS, CNAME → Railway, DNS-only/grey)
                          │
                   ┌──────▼───────┐
                   │   LAUNCHER    │  SvelteKit (adapter-node) + Postgres
                   │  invisible-   │  auth (email+password, scrypt), roles, tool pages
                   │  engine       │  Railway project: "Invisible launcher"
                   └──┬────────┬───┘
            /atlas →  │        │  → /spine (full-page, no iframe; static view.html)
        redirect to   │        │
   ┌──────────────────▼─┐   (calls)
   │   ATLAS-TOOL        │      │
   │  Python ui_server   │      ▼
   │  (ported local tool)│   ┌─────────────────┐
   │  Railway: atlas-    │   │  ATLAS-BACKEND   │  FastAPI (services/atlas-backend)
   │  tools              │   │  Railway: atlas- │  SDXL workflow → ComfyUI, compose/slice
   └─────────┬───────────┘   │  backend         │
             │               └────────┬─────────┘
             │ both reach ComfyUI ─────┘
             ▼
   comfy.invisiblewall.org  (Cloudflare NAMED tunnel → local ComfyUI :8188, RTX 4070)
   protected by Cloudflare Access (service token)
             │
        ┌────▼─────┐
        │   R2     │  bucket "invisibleassets" — shared asset/manifest store
        └──────────┘
```

## Services (Railway)

**Consolidated structure (2026-05-30):** ALL services now live in **ONE Railway project**, environment **`production`**, so they can share variables. Service names + domains were cleaned up.

| Service | URL | Stack | Root dir |
|---|---|---|---|
| **launcher** (Invisible-Engine) | `app.invisiblewall.org` | SvelteKit / Node (pnpm monorepo) | repo root, build `pnpm --filter launcher-api build` |
| **atlas-tool** | `atlas-tool-production.up.railway.app` | Python (http.server) | **repo root**, Dockerfile Path `services/atlas-tool/Dockerfile` |
| **atlas-backend** | `atlas-backend-production-0a70.up.railway.app` | FastAPI / Python | `/services/atlas-backend` (Dockerfile) |
| **sheet-tool** | `sheet-tool-production.up.railway.app` | Python (http.server) | **repo root**, Dockerfile Path `services/sheet-tool/Dockerfile` |
| **Postgres** | internal (`postgres.railway.internal`); public proxy on `*.proxy.rlwy.net` | Postgres | — |

All deploy from GitHub `Invisible-Wall-SL/Invisible-Engine`, branch `main`, **auto-deploy on push**.

**⚠️ atlas-tool + sheet-tool build from the REPO ROOT (since 2026-05-31, fix #3).** Both Python tools now share `services/_shared/iw_common/` (storage, banner, ComfyUI client, thread-local context base — see each tool's `cloud_paths.py` thin layer). For the Dockerfile to `COPY services/_shared/iw_common`, the build **context must be the repo root**, so each service's Railway **Root Directory = repo root** and **Dockerfile Path = `services/<svc>/Dockerfile`** (Settings → Build). The Dockerfiles `COPY services/<svc>/requirements.txt`, `COPY services/_shared/iw_common ./iw_common`, then `COPY services/<svc>/ .` with `ENV PYTHONPATH=/app`. **This is a COUPLED change:** the new Dockerfiles only work once the Root Directory is flipped, and the old subdir setting only works with the old Dockerfiles — flip the setting and deploy the new commit together (Railway keeps the last good deploy live if a build fails, so there's no outage, just a failed build until both sides match).

**⚠️ Launcher build note (monorepo):** the launcher service's **Root Directory must be the repo root** (not `apps/launcher-api`) so Railpack sees `pnpm-lock.yaml` + `packageManager: pnpm@10.5.0` and uses pnpm; with a custom **Install Command** `pnpm install --frozen-lockfile`. If Root Directory is the subdir, Railpack falls back to `npm install` which chokes on `workspace:*`. The launcher's tool-URL env vars also have **code defaults** in `env.ts` pointing at the `*-production` domains, so the launcher works even if a Railway var doesn't apply.

### Shared Variables (define once per environment, reference with `${{shared.NAME}}`)
Set at project → Settings → Shared Variables (environment `production`), referenced by each service. Shared: `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `COMFY_URL`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`, `COMFY_ORG_API_KEY`, `ATLAS_TOOL_SECRET`, `SHEET_TOOL_SECRET`. Per-service (not shared): launcher URLs (`ATLAS_TOOL_URL`/`ATLAS_BACKEND_URL`/`SHEET_TOOL_URL`/`ORIGIN`/`DATABASE_URL`), `ATLAS_PROJECT`/`ATLAS_OUTPUT_PREFIX`/`ATLAS_STAGING`, `SHEET_PROJECT`/`SHEET_STAGING`, `DEFAULT_CKPT`. `PORT` is injected by Railway — never set it.

### Railway environments — history (resolved)
There were briefly **two environments** (`production` + a stray `atlas`), each with its OWN Postgres — this caused a prod outage on 2026-05-30 when a migration was applied to the wrong env's DB, then a wrong-environment confusion. The stray `atlas` environment was **deleted**; only `production` remains. **LESSON:** a Railway *environment* is a full separate copy incl. its own Postgres → always confirm you're on `production` before migrating, and apply schema migrations to the production DB **before** deploying schema-dependent code (else authed requests 500).

> ⚠️ **Railway gotcha (cost us hours):** adding an env var only **stages** it; you must click the **"Apply changes / Deploy"** banner. A plain "Redeploy" does NOT apply staged vars. When a var "isn't working", verify what the *runtime* actually sees rather than re-checking the dashboard. For launcher tool URLs we now keep a **code default** (`env.ts`) so it works regardless.

## ComfyUI tunnel (the ONLY local piece)

- **Local:** ComfyUI on `localhost:8188` (RTX 4070, 8GB) + `cloudflared` connector. Nothing else runs locally.
- **Tunnel:** Cloudflare **named tunnel** `comfy-gualtiero` (id `1e0057ee-6787-4bbc-a1af-936d7fe7603a`), config at `C:\Users\gualt\.cloudflared\config.yml`, ingress `comfy.invisiblewall.org → http://localhost:8188`.
- **Auth:** Cloudflare **Access** (Service Auth) in front. Backends send `CF-Access-Client-Id` / `CF-Access-Client-Secret` headers. Client ID (non-secret): `bb044437409520caf86021625f8553e5.access`.
- **⚠️ User-Agent gotcha (cost us hours):** Cloudflare blocks the default `Python-urllib/x` UA with **403**. All ComfyUI calls must send a custom UA (`InvisibleAtlas/1.0`). Already handled in `atlas-backend/comfy.py` and `atlas-tool/cloud_paths.py`.
- TODO: install cloudflared as a Windows service (`cloudflared service install`) so the tunnel survives reboots.

## R2 (Cloudflare object storage)

- Bucket: `invisibleassets`. Endpoint: `https://175d2ae4501d5de0a1ca970f2bb31448.r2.cloudflarestorage.com`.
- Key layout:
  - `atlas/manifests/loader.json` — Svelte-era manifest (legacy path)
  - `spines/hotfruits/…` — spine assets
  - `atlas_maker/cloud/<project>/{manifests,input,output,deploy}/…` — the ported tool's store

## Environment variables (names only)

**Launcher:** `DATABASE_URL`, `ORIGIN`, `REMEMBER_TTL_DAYS`, `SESSION_TTL_HOURS`, `RESEND_API_KEY`, `R2_*`, `ATLAS_BACKEND_URL`, `ATLAS_TOOL_URL` (has code default), `ATLAS_TOOL_SECRET` (optional gate), `ATLAS_MANIFEST_KEY`, `ATLAS_STYLE_REF_KEY`.

**atlas-backend & atlas-tool:** `COMFY_URL`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`, `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `COMFY_ORG_API_KEY` (optional, gpt_image). **atlas-tool also:** `ATLAS_PROJECT`, `ATLAS_OUTPUT_PREFIX`, `ATLAS_TOOL_SECRET` (optional), `ATLAS_STAGING`.

## DNS (Cloudflare)

- Zone `invisiblewall.org` on Cloudflare. `www`/`app` = CNAME → Railway, **DNS-only (grey cloud)** — proxying breaks Railway TLS.
- `comfy` = the named tunnel (proxied/orange, behind Access).

## Security / secret rotation

All values below were exposed (committed and/or pasted in chat during setup) and **must be rotated**. Rotation is the real fix — it invalidates the leaked value. (History-scrubbing is optional and the user's call; do NOT force-push as part of this.) Never paste the new values into any doc or commit.

### B9.1 — `comfy_org_api_key` (DONE in working tree, ROTATION still owed)
- **What was changed (2026-05-29):** in the separate `Invisible_Pipeline` repo, `tools/Invisible Atlas Maker/atlas_config.json` had the live key value (a `comfyui-…` token, now removed). The value was replaced with `""` plus a `_comfy_org_api_key_note` pointing to the `COMFY_ORG_API_KEY` env var. Code already reads env-first (`batch_atlas.py:comfy_org_api_key()` → `os.environ.get("COMFY_ORG_API_KEY") or config`), so the empty value is safe. Added `.gitignore` entries (`atlas_config.local.json`, `*.secret.json`, `.env*`) in that repo for future local secret files. The scrubbed `atlas_config.json` stays tracked (it holds non-secret config) but now carries no secret.
- **User must:** (a) **Rotate** at `platform.comfy.org` → API Keys → revoke the leaked key, create a new one. (b) Set the new key as `COMFY_ORG_API_KEY` env var wherever gpt_image runs: locally for the desktop Atlas Maker, and on Railway **atlas-backend** + **atlas-tool** services (Variables → add → Apply changes/Deploy). (c) Commit the scrubbed `atlas_config.json` + `.gitignore` in the `Invisible_Pipeline` repo. (d) Optional: history-scrub the old value (`git filter-repo`/BFG) — only the user should decide this.

### B9.2 — Rotation checklist for setup-time secrets

| Secret | Lives in | How to rotate | Redeploy after |
|---|---|---|---|
| **R2 access token** (Access Key ID + Secret; one ID started `a6f88a7d…`) | Cloudflare R2 → **Manage R2 API Tokens**. Used as `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` on Railway **launcher**, **atlas-backend**, **atlas-tool**. | Cloudflare dashboard → R2 → API Tokens → create a NEW token (scoped to bucket `invisibleassets`, read+write) → delete the old token. | Update `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` on all three Railway services → click **Apply changes / Deploy** on each (a plain redeploy does NOT apply staged vars). |
| **Postgres password** | Inside `DATABASE_URL` on the Railway **launcher** service (Postgres lives in the `Invisible launcher` project). | Easiest: Railway Postgres service → **Variables** → rotate `PGPASSWORD`/regenerate credentials (or via `psql`: `ALTER USER … WITH PASSWORD …`). Railway exposes a reference `DATABASE_URL`; if you set it manually, update it. | Redeploy the **launcher** so it reconnects with the new `DATABASE_URL` → **Apply changes / Deploy**. Re-run `scripts/seed.mjs` only if needed (data unaffected). |
| **CF Access service-token secret** (`CF-Access-Client-Secret`; Client ID `bb044437409520caf86021625f8553e5.access` is non-secret) | Cloudflare **Zero Trust → Access → Service Auth** (the token in front of `comfy.invisiblewall.org`). Used as `CF_ACCESS_CLIENT_SECRET` on Railway **atlas-backend** + **atlas-tool**. | Zero Trust → Access → Service Auth → **Rotate/Regenerate** the service token (or create a new one and update the Access policy to allow it, then delete the old). | Update `CF_ACCESS_CLIENT_ID` (if it changed) + `CF_ACCESS_CLIENT_SECRET` on **atlas-backend** and **atlas-tool** → **Apply changes / Deploy** on each. Verify with `curl -H "CF-Access-Client-Id: …" -H "CF-Access-Client-Secret: …" https://comfy.invisiblewall.org/system_stats`. |

> After every rotation, **verify the runtime** (not just the dashboard): probe the live URL / a no-secret diagnostic to confirm the new value took, then remove the diagnostic.
