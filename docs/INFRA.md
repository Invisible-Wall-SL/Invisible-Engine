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

| Service | Railway project | URL | Stack | Root dir |
|---|---|---|---|---|
| **Launcher** | `Invisible launcher` | `app.invisiblewall.org` (also `invisible-engine-production…` / `invisible-engine-atlas-tool…`) | SvelteKit / Node | repo root (`apps/launcher-api` build) |
| **atlas-backend** | `atlas-backend` | `invisible-engine-production-50e8.up.railway.app` | FastAPI / Python | `/services/atlas-backend` |
| **atlas-tool** | `atlas-tools` | `invisible-engine-production-0060.up.railway.app` | Python (http.server) | `/services/atlas-tool` |
| Postgres | `Invisible launcher` | internal | Postgres | — |

All deploy from GitHub `Invisible-Wall-SL/Invisible-Engine`, branch `main`, **auto-deploy on push**.

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

## Security debts (rotate / clean — see docs/STATUS.md)

- `comfy_org_api_key` is committed in the `Invisible_Pipeline` repo's `atlas_config.json` → **scrub + rotate**.
- R2 token, Postgres password, and the CF Access service-token secret were pasted in chat during setup → **rotate**.
