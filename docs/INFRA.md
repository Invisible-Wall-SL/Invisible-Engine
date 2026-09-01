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
| **atlas-backend** | `atlas-backend-production-0a70.up.railway.app` | FastAPI / Python | **repo root**, Dockerfile Path `services/atlas-backend/Dockerfile` |
| **sheet-tool** | `sheet-tool-production.up.railway.app` | Python (http.server) | **repo root**, Dockerfile Path `services/sheet-tool/Dockerfile` |
| **Postgres** | internal (`postgres.railway.internal`); public proxy on `*.proxy.rlwy.net` | Postgres | — |

All deploy from GitHub `Invisible-Wall-SL/Invisible-Engine`, branch `main`, **auto-deploy on push**.

**No service sets Watch Paths**, so *every* push to `main` rebuilds all four repo-root services — a docs-only or engine-only commit still rebuilds `atlas-backend`. That is what makes builder flakes visible here: on 2026-08-20 `atlas-backend` failed the build of `67799605` (an engine-only commit touching nothing in its image) with **no build logs at all** and Railway's own "Diagnosis failed for this deployment" — while `atlas-tool` built the same commit from the same repo-root context minutes later. **A failed build with an empty build log is Railway's builder, not our Dockerfile** (a bad `COPY`/`RUN` always prints); the fix is deployment ⋮ → **Redeploy**, and the last good deploy stays live meanwhile. Adding Watch Paths (`services/<svc>/**` + `services/_shared/**`) and/or the **Skipped Builds** feature flag would cut those pointless rebuilds.

**How to tell whether a push actually deployed, without the Railway dashboard.** Railway reports each build to GitHub's deployments API, so `gh` answers this from the terminal:

```bash
id=$(gh api "repos/Invisible-Wall-SL/Invisible-Engine/deployments?sha=$(git rev-parse HEAD)" --jq '.[0].id')
gh api "repos/Invisible-Wall-SL/Invisible-Engine/deployments/$id/statuses" --jq '[.[]|.state]|join(" ")'
```

**Read it by COUNTING `success`: a settled deploy of `main` shows FOUR OR MORE** (one per repo-root service; Railway sometimes posts extra rows — two deploys on 2026-09-01 ended at five). The statuses carry no service name, no description and no commit — only a project URL — so *which* service succeeded is not recoverable, and Railway leaves stale `in_progress` rows behind forever; they mean nothing. **Count only `success`.**

**A low count is NOT proof of a flake — deploys are wildly uneven, so wait before re-triggering.** Measured the same day: `234e4c69` went 4/4 in **6 minutes**, while `ec07abaa` three minutes later was still at **1/4 after 27 minutes** and only reached 3/4 at **+34**. Both were fine. Give a deploy **half an hour** before treating it as the builder flake documented above; re-pushing early just queues four more builds behind the ones already running, which is what makes the next one look stuck too.

**Then verify the RUNNING code, not the build:**
- **launcher** — `curl -s https://app.invisiblewall.org/_app/version.json` returns `{"version":"<ms epoch>"}`, SvelteKit's build stamp. Decode it (`new Date(Number(v))`); if it is minutes old, this deploy is live. This works for ANY launcher change, unlike probing a route for a 404 → 401 flip, which only proves a deploy when the change ADDS a route.
- **atlas-tool / sheet-tool** — there is **no unauthenticated signal at all**. `_gate()` is the first line of both `do_GET` and `do_POST`, so every path including `/` is 403 without `ATLAS_TOOL_SECRET`, and the response carries no commit or deployment header (`x-railway-request-id` is per-request). A 403 proves the service is up and running *our* code; it says nothing about *which commit*. The only real proof is exercising the change through the launcher, signed in.

**⚠️ atlas-tool + sheet-tool + atlas-backend build from the REPO ROOT (since 2026-05-31, fix #3).** Both Python tools now share `services/_shared/iw_common/` (storage, banner, ComfyUI client, thread-local context base — see each tool's `cloud_paths.py` thin layer). For the Dockerfile to `COPY services/_shared/iw_common`, the build **context must be the repo root**, so each service's Railway **Root Directory = repo root** and **Dockerfile Path = `services/<svc>/Dockerfile`** (Settings → Build). The Dockerfiles `COPY services/<svc>/requirements.txt`, `COPY services/_shared/iw_common ./iw_common`, then `COPY services/<svc>/ .` with `ENV PYTHONPATH=/app`. **This is a COUPLED change:** the new Dockerfiles only work once the Root Directory is flipped, and the old subdir setting only works with the old Dockerfiles — flip the setting and deploy the new commit together (Railway keeps the last good deploy live if a build fails, so there's no outage, just a failed build until both sides match).

**⚠️ Launcher build note (monorepo):** the launcher service's **Root Directory must be the repo root** (not `apps/launcher-api`) so Railpack sees `pnpm-lock.yaml` + `packageManager: pnpm@10.5.0` and uses pnpm; with a custom **Install Command** `pnpm install --frozen-lockfile`. If Root Directory is the subdir, Railpack falls back to `npm install` which chokes on `workspace:*`. The launcher's tool-URL env vars also have **code defaults** in `env.ts` pointing at the `*-production` domains, so the launcher works even if a Railway var doesn't apply.

### Shared Variables (define once per environment, reference with `${{shared.NAME}}`)
Set at project → Settings → Shared Variables (environment `production`), referenced by each service. Shared: `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `COMFY_URL`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`, `COMFY_ORG_API_KEY`, `ATLAS_TOOL_SECRET`, `SHEET_TOOL_SECRET`. Per-service (not shared): launcher URLs (`ATLAS_TOOL_URL`/`ATLAS_BACKEND_URL`/`SHEET_TOOL_URL`/`ORIGIN`/`DATABASE_URL`), `ATLAS_PROJECT`/`ATLAS_OUTPUT_PREFIX`/`ATLAS_STAGING`, `SHEET_PROJECT`/`SHEET_STAGING`, `DEFAULT_CKPT`. `PORT` is injected by Railway — never set it.

### Railway environments — history (resolved)
There were briefly **two environments** (`production` + a stray `atlas`), each with its OWN Postgres — this caused a prod outage on 2026-05-30 when a migration was applied to the wrong env's DB, then a wrong-environment confusion. The stray `atlas` environment was **deleted**; only `production` remains. **LESSON:** a Railway *environment* is a full separate copy incl. its own Postgres → always confirm you're on `production` before migrating, and apply schema migrations to the production DB **before** deploying schema-dependent code (else authed requests 500).

### Auto-migrate on boot (2026-06-13)
The launcher now applies pending Drizzle migrations **itself**, at server startup, before serving any request — via the SvelteKit `init` server hook (`src/hooks.server.ts` → `runMigrations()` in `src/lib/server/db/migrate.ts`, the `drizzle-orm/postgres-js` programmatic migrator pointed at the committed `drizzle/` folder). So pushing a schema migration + its schema-dependent code in ONE deploy is now safe — the new code's first boot brings the prod schema up to date itself; **no manual `db:migrate` step**. Properties: fail-soft (a missing `DATABASE_URL`, unlocatable folder, or migration error is logged + swallowed, never crashes boot — falls back to today's "500 until resolved"); idempotent + transactional (tracked in `__drizzle_migrations`). Manual `db:push` still works for out-of-band use. (Always-confirm-the-env lesson above still holds: the migrator targets whatever `DATABASE_URL` the service runs with.)

> ⚠️ **The migrator compares by `created_at` THRESHOLD, not per-hash** (verified in `drizzle-orm` `pg-core/dialect.js` `migrate()`): it reads the newest `created_at` in `drizzle.__drizzle_migrations` and applies every journal entry whose `when` (folderMillis) is greater. So an **empty** migrations table makes it replay from `0000`. **This bit us on 2026-06-13:** prod's schema was originally created with `db:push` (which writes the tables but records NOTHING in `__drizzle_migrations`), so the first auto-migrate boot tried to replay `0000` → `relation "sessions" already exists` → aborted → `0010` (the `game_type` column) never applied → every authed route 500'd. **`db:migrate` would NOT have fixed it** — it replays from the same empty journal. The real fix is to **baseline** an already-provisioned DB: apply the pending migration's effect, then insert ONE row with `created_at` = the latest applied migration's `when`. We ran (2026-06-13): `ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "game_type" text;` + `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) SELECT 'baseline-0010', 1781337176046 WHERE NOT EXISTS (…)`. Prod is now baselined through `0010`, so future migrations apply cleanly on deploy.
>
> **SELF-HEALING GUARD (built 2026-06-13, `migrate.ts` `baselineIfPushProvisioned`):** `runMigrations()` now does this baseline AUTOMATICALLY at boot — if `__drizzle_migrations` is empty BUT a core table (`public.users`) already exists (the `db:push` signature), it records one baseline row at the latest journal timestamp before calling `migrate()`, so it never replays from `0000`. A truly empty DB (no app tables) is left alone → migrates from `0000` as normal; a migrate-managed DB (populated journal) is untouched. So a NEW `db:push`-provisioned Postgres (e.g. a fresh environment) no longer needs the manual baseline — but running the first `drizzle-kit migrate` against a truly empty DB is still the cleanest provisioning path.

> ⚠️ **Railway gotcha (cost us hours):** adding an env var only **stages** it; you must click the **"Apply changes / Deploy"** banner. A plain "Redeploy" does NOT apply staged vars. When a var "isn't working", verify what the *runtime* actually sees rather than re-checking the dashboard. For launcher tool URLs we now keep a **code default** (`env.ts`) so it works regardless.

## ComfyUI tunnel (the ONLY local piece)

- **Local:** ComfyUI on `localhost:8188` (RTX 4070, 8GB) + `cloudflared` connector. Nothing else runs locally.
- **Tunnel:** Cloudflare **named tunnel** `comfy-gualtiero` (id `1e0057ee-6787-4bbc-a1af-936d7fe7603a`), config at `C:\Users\gualt\.cloudflared\config.yml`, ingress `comfy.invisiblewall.org → http://localhost:8188`.
- **Auth:** Cloudflare **Access** (Service Auth) in front. Backends send `CF-Access-Client-Id` / `CF-Access-Client-Secret` headers. Client ID (non-secret): `bb044437409520caf86021625f8553e5.access`.
- **⚠️ User-Agent gotcha (cost us hours):** Cloudflare blocks the default `Python-urllib/x` UA with **403**. All ComfyUI calls must send a custom UA (`InvisibleAtlas/1.0`). Already handled in `atlas-backend/comfy.py` and `atlas-tool/cloud_paths.py`.
- **ComfyUI models are mirrored to R2 (B36):** model files live at R2 `comfyui-models/<subfolder>/<file>` (subfolders match ComfyUI's `Shared\Models` layout: `checkpoints/`, `loras/`, `vae/`, `controlnet/`, …). Seed/refresh with `py scripts/seed-comfyui-models.py` (owner, `R2_*` env). The launcher pulls them via `GET /api/launcher/models-manifest` (admin-only; returns each model with a 6-h presigned R2 URL) → **Sync models** button → downloads R2→client directly (not through Railway) → restart ComfyUI.
- **Fresh-machine setup is automated (B35):** the desktop Invisible Launcher auto-installs `cloudflared.exe` (official standalone, into `_tools/`, no admin) and provisions `~/.cloudflared/{config.yml,<id>.json,cert.pem}` by fetching the credentials bundle from the portal after owner login (`POST /api/launcher/login` → short-lived token → `GET /api/launcher/tunnel-bundle`, role `admin` only). The bundle lives in R2 at `tools/invisible-launcher/cloudflared-bundle.json` — (re)seed it with `node apps/launcher-api/scripts/seed-tunnel-bundle.mjs` (owner, `R2_*` env). On write the launcher repoints the `credentials-file:` line to the new machine's path.
- **⚠️ ComfyUI-Manager is REQUIRED for Blueprints model auto-install (B43 phases 1+4):** the local ComfyUI must have **[ComfyUI-Manager](https://github.com/Comfy-Org/ComfyUI-Manager)** installed, at **security level "middle" or below** (`security_level = middle` — or lower — in ComfyUI's `user/default/ComfyUI-Manager/config.ini`; `high`/`strong` returns **403** on the install/reboot calls). The Atlas Maker's blueprint "prepare" step drives Manager's queue API over this same tunnel (`POST /manager/queue/install_model` → `/queue/start` → poll `/queue/status` → `POST /manager/reboot`) to download a blueprint's declared `models[]` before generating. **Two boundaries to know:** (a) Manager only auto-installs models whose *(`save_path`, `base`, `filename`)* triple is in its curated `model-list.json` catalog — custom Civitai/gated-HF URLs that aren't catalogued fall to a manual-download checklist by design; (b) if Manager is absent (`404` on `/manager/*`), unreachable, or a model stays missing after reboot, the step degrades to a readable checklist and never crashes. Kill-switch: `BLUEPRINT_AUTO_INSTALL_MODELS` env on atlas-tool (default **enabled**; set falsy to emit the checklist only, since reboot interrupts in-flight ComfyUI work). See `docs/design/invisible-blueprints.md` §4.
- TODO: install cloudflared as a Windows service (`cloudflared service install`) so the tunnel survives reboots.

## ComfyUI R&D pod (RunPod)

On-demand RunPod GPU **pods** running the **interactive ComfyUI web UI** for artist R&D — the surface where an artist builds/tunes a workflow that later becomes an Atlas Maker blueprint. It is **distinct from `services/atlas-serverless`** (the headless serverless worker that runs baked blueprints, `COMFYUI_REF=v0.33.1`) and from the local RTX-4070 tunnel above. Only these pods expose an interactive UI. Each is reached at the RunPod proxy URL `https://<podId>-8188.proxy.runpod.net` — no Cloudflare Access in front (RunPod's own proxy auth). See `docs/design/runpod-comfyui-backend.md` and `docs/design/comfyui-serverless.md`; current state in `docs/status/comfyui.md`.

- **This is now a FLEET, not one pod.** The launcher keeps several pods on **different GPU cards** and the artist starts whichever has a free GPU. Two operational cautions: **(1) run only ONE pod at a time when they share a Network Volume** — concurrent pods writing the same volume (models + custom nodes) risk write conflicts; **(2) a stopped pod does NOT reserve its GPU**, so a Start can fail ("not enough free GPUs") on scarce cards (e.g. Blackwell) — which is exactly why we keep more than one card.
- **The fleet is admin-managed in the DB, not env** — `app_settings` key **`runpodPods`** = JSON `[{id,label}, …]`, edited under the launcher's **Admin → Settings → "ComfyUI R&D pod fleet"** (add/remove pods, each = pod id + label like "RTX 4090"). Each pod's ComfyUI URL is **derived from its id** (`https://<id>-8188.proxy.runpod.net`); no per-pod URL is stored. `RUNPOD_POD_ID`/`COMFY_RND_URL` are now only the **legacy single-pod fallback** (synthesized as a "Default" pod when `runpodPods` is empty).
- **Current pods (examples):** all attached to Network Volume **`Invisible_RunPod_Storage`** (persists ComfyUI + models + custom nodes across stop/start):
  - RTX PRO 4000 — id `m3ppwxc7ttkrfq`
  - RTX 4090 — id `avpq09jo5c9uyt`
  - RTX PRO 4500 Blackwell (32 GB) — id `a1tqn0tzbqtvr1` (name `ComfyUI_RD`)

### "Access to <podId>-8188.proxy.runpod.net was denied" — clicking through from a tool
**Symptom:** the pod link 403s (Chrome: *"You don't have authorisation to view this page"*) when you click it **from a page** — the launcher's `/comfyui` card, the Atlas Maker, anywhere — but pasting the SAME url into a fresh tab works. Nothing is wrong with the pod.

**Cause:** RunPod's proxy rejects any browser request that arrives with **`Sec-Fetch-Site: cross-site`**. The browser stamps that header from the *initiator* origin, so a click from `app.invisiblewall.org` gets it and an address-bar navigation (`Sec-Fetch-Site: none`) does not. Measured against a live pod:

| request | result |
|---|---|
| top-level nav, `Sec-Fetch-Site: cross-site` | **403** |
| iframe, `cross-site` | **403** |
| iframe, `same-origin` | 200 |
| top-level nav, `Sec-Fetch-Site: same-site` | 200 |
| WebSocket upgrade, cross-origin `Origin:` | 101 |
| no `Sec-Fetch-Site` (address bar / fresh tab) | 200 |
| server-side: curl / undici / node / no UA | 200 |
| server-side: `User-Agent: Python-urllib/*` | **403** |

Only `cross-site` fails — `none`, `same-origin` and `same-site` all pass, and a **WebSocket upgrade passes cross-origin** because browsers send no `Sec-Fetch-*` on a WS handshake (so ComfyUI's progress socket was never affected by this rule, only page loads were). The `same-site` row is what makes a hostname under `invisiblewall.org` a possible fleet-wide alternative to per-pod TCP; it would need a Cloudflare host-header rewrite per pod and would break when pod ids change, which is why TCP won.

**It is NOT an iframe problem** — the destination is irrelevant (a `same-origin` iframe returns 200); only the initiator origin matters. `/comfyui` is correctly full-page and needs no change. Don't "fix" this by reworking framing.

The 403 is a bare `Content-Length: 0` from `Server: cloudflare` with **no block page and no `cf-mitigated` header**, i.e. RunPod's own edge anti-hotlink rule, not a Cloudflare WAF challenge — so no User-Agent or Referer tweak gets past it.

**Server-side calls are unaffected, so generation does not break** — only clicking through from a page does. But note the last row: the pod proxy is Cloudflare-fronted like the old tunnel was, so the original **`Python-urllib` UA → 403** trap applies here too. Every Python call site already sends `InvisibleAtlas/1.0` via `iw_common.comfy.cf_headers()`; never add a ComfyUI call that skips it.

**What to do — expose 8188 as a TCP port** (RunPod → Edit Pod, alongside the HTTP one). That yields a direct `http://<ip>:<publicPort>` which is not behind the proxy, so the cross-site rule never applies **and** the `/ws` drop above stops too. The `/comfyui` card picks it up automatically: `podProbe` reads `runtime.ports` on each poll and `directUrlFromPorts` (`$lib/server/runpod.ts`) turns a TCP-typed, public, `privatePort: 8188` entry into the link. RunPod assigns that external port **at each resume and it changes every start**, so it is read live and never cached — unlike the proxy URL, it cannot be derived from the pod id.

**Configure every pod as `HTTP 8189` + `TCP 8188`.** RunPod will not give one container port both, and both are needed — TCP for the clickable direct link, HTTP for the proxy hostname the launcher probes and a human pastes. The pod image forwards `8189 → 8188` (`services/atlas-comfy-pod/tools/port-forward.py`, started by `start.sh`) so ComfyUI answers on both. **Never put 8188 in the HTTP box**: exposing it as TCP removes its HTTP proxy (that hostname answers 404), and a pod set to `HTTP 8188 + TCP 8188` — or TCP-only — is unreachable by every route at once while ComfyUI runs fine. The launcher probes 8189 then 8188 and falls back to the direct endpoint, so an older pod still works.

**TCP 8188 is therefore REQUIRED pod config, not a nicety** — a pod without it cannot be opened from the launcher at all. The card marks such a pod **⚠ not reachable** and states the one-time fix, rather than degrading into a copy-the-url chore that would read as normal UX. Note the direct endpoint is plain `http://` (no TLS) — acceptable for internal R&D, but it is unencrypted.

A launcher **same-origin proxy** would also work (the `same-origin` row above proves it, and it is rule 3's sanctioned "same-origin serve"), but proxying ComfyUI including its `/ws` socket is real work — don't start there.

> Unconfirmed: whether this is **new** RunPod behaviour or something we simply had not hit. It could not be compared against an older pod (`a1tqn0tzbqtvr1` was stopped, returning 404). Starting an old pod and clicking through from the launcher would settle it.

### Debugging "ComfyUI disconnected" on a pod
ComfyUI reports execution errors **over the `/ws` progress socket**, so when that socket drops the failing node never turns red and you get a generic disconnect instead of the error — even though the server recorded it. `/history` keeps it, and there are now two ways to read it back.

**In the browser, automatically** — the baked image ships **`ComfyUI-Invisible-ErrorRecall`** (`services/atlas-comfy-pod/custom_nodes/`), a frontend-only extension that re-checks `/history` on **reconnect** (modal) and on **page load** (toast only), then highlights the failing node and centres the canvas on it. It never mutates the graph — highlighting goes through `app.lastNodeErrors`, the transient channel ComfyUI uses for `/prompt` validation errors — and every frontend API it touches is feature-detected. An error you already saw live is not replayed. **A pod only gets it after the image rebuilds AND that pod is redeployed**; to try it on a pod that's already up, copy the folder to **`/workspace/ComfyUI/custom_nodes/`** and restart ComfyUI — the volume test lane, so it survives a container recreate (`/ComfyUI/custom_nodes/` does not). See the pod README.

**From a terminal** — for when the browser can't reach the pod at all. **`node scripts/comfy-last-error.mjs https://<podId>-8188.proxy.runpod.net`** reads it back: the failing node's id + class + **canvas title**, the exception, that node's inputs and what feeds it, and the traceback. Its three outcomes each diagnose a different layer — a failing node (real graph error) / "last run did NOT fail" (transport only, the render probably finished) / "No history" (ComfyUI **restarted**, i.e. the process died — go to `tail -200 /workspace/comfyui.log` for `torch.OutOfMemoryError` or `Killed`). Same `/history` read the Atlas Maker uses (`batch_atlas.py`).

Three causes worth ruling out in order, before suspecting the graph:
1. **Is the pod Spot/Interruptible?** RunPod reclaims those the instant someone outbids — mid-render, silently, nothing in any log. Use **On-Demand** for R&D.
2. **The RunPod proxy drops idle WebSockets.** `<podId>-8188.proxy.runpod.net` is an HTTP proxy and ComfyUI's `/ws` goes quiet during a long checkpoint load or VAE decode. The render keeps going server-side; only the feed is lost. Expose **TCP 8188** and connect direct to bypass it.
3. **VRAM exhaustion** — `comfyui_controlnet_aux`'s DepthAnything loads outside ComfyUI's memory manager so `/free` can't release it (the reason the serverless worker restarts ComfyUI between jobs; an interactive pod has no such reset).

The launcher's idle auto-stop was a fourth cause until 2026-08-19 — fixed in PR #334, see `docs/status/comfyui.md`.

### ✅ Recommended: deploy the pod FROM the baked image
Deploy each R&D pod from the **baked GHCR image** `ghcr.io/invisible-wall-sl/atlas-comfy-pod:latest` (built by `services/atlas-comfy-pod/` — see its [README](../services/atlas-comfy-pod/README.md)). Everything Python — ComfyUI `v0.33.1`, **cu128 torch (Blackwell, pinned)**, all custom nodes (IPAdapter_plus, RMBG, controlnet_aux, PuLID_ComfyUI, the vendored PuLID-Flux, PuLID-Flux2, ComfyUI-Manager) and the face stack — is **already in the image**, so:
- **It survives RunPod recreating the container on resume.** Hand-installed deps do NOT: a resume changes the container id and wipes site-packages (`tqdm`/`torch` gone → ComfyUI crash-loops). Models are safe (on the volume); only container packages are lost. The baked image is the permanent fix — the manual runbook below is only a fallback for a pod that predates the image.
- **No "Container Start Command" is needed** — the image auto-starts ComfyUI on 8188 and keeps the container alive (`sleep infinity`), so a ComfyUI crash never locks you out of the terminal.
- Deploy: RunPod → Pods → Deploy → custom image `ghcr.io/invisible-wall-sl/atlas-comfy-pod:latest`, a Blackwell GPU, **attach `Invisible_RunPod_Storage` at `/workspace`**, expose HTTP **8188**. Models stay on the volume at `/workspace/ComfyUI/models` (baked `extra_model_paths.yaml` points there). Adding a model = drop it on the volume; only a new custom **node** needs an image rebuild (push under `services/atlas-comfy-pod/**` → CI rebuilds + pushes). Startup log: `tail -f /workspace/comfyui.log`.

### Launcher integration (the `/comfyui` card)
The launcher's `/comfyui` card lists the fleet and can **start/stop** each pod (RunPod GraphQL `podResume` / `podStop`). The only env var required is the shared API key; pods themselves live in `app_settings.runpodPods` (above). Set on the **launcher-api** Railway service → **Apply changes / Deploy**:

| Var | Purpose |
|---|---|
| `RUNPOD_API_KEY` | RunPod API key used to start/stop every pod (secret; shared across the fleet). |
| `RUNPOD_POD_ID` | **Legacy fallback only** — a single pod id, synthesized as a "Default" pod when `runpodPods` is empty. Prefer the admin fleet editor. |
| `COMFY_RND_URL` | **Legacy fallback only** — overrides the derived URL for the single `RUNPOD_POD_ID` pod. Not used once a fleet is configured. |
| `GITHUB_ACTIONS_TOKEN` | **Optional.** A GitHub token with **`actions: write`** on `GITHUB_ENGINE_REPO`. Powers **Rebuild image** on `/comfyui` (a `workflow_dispatch` of `atlas-comfy-pod.yml`) and reading that workflow's runs. Deliberately NOT the read-only `GITHUB_ENGINE_READ_TOKEN` — dispatching is a write and deserves its own blast radius. **Falls back to `GIT_CLONE_TOKEN`**, which may or may not work: cloning is GitHub's `contents` permission while dispatching is `actions`, so a CLASSIC PAT (`repo` covers both) dispatches, while a FINE-GRAINED one needs "Actions: Read and write" ticked for this repo. It is tried rather than assumed — a 403 says so in the panel, naming the permission. Unset entirely → the button is replaced by a line saying so. |
| `RUNPOD_DATA_CENTER_ID` | **Optional** (e.g. `EU-RO-1`). Scopes the per-card **GPU availability** badge to one region. Stock is reported per GPU *type*, but a stopped pod can only resume where its disk already is, so an unfiltered figure answers a different question. The launcher tries to read each pod's own data centre first and falls back to this; unset, the badge asks globally and says so in its tooltip. The whole fleet shares one region anyway — the Network Volume pins it. |
| `COMFY_VOLUME_POD_ID` | **Optional.** Pod id of an **always-on volume pod** used ONLY to read what's installed for the card's "What's installed" panel (models on the Network Volume + loaded node packs). Point it at a cheap **CPU pod** that mounts the same volume and runs ComfyUI in CPU mode — it never generates, it only answers HTTP — and the panel keeps working with the whole GPU fleet stopped. Unset → the panel falls back to any running GPU pod. |
| `COMFY_VOLUME_URL` | **Optional.** Explicit base URL for that reader, overriding the id-derived one. |

- **Idle auto-stop is NOT env** — it's **admin-configured** and stored in the `app_settings` table (`runpodIdleEnabled`, `runpodIdleMinutes`, default **20**). An admin toggles it + sets the minutes from the launcher admin UI; the launcher stops an idle pod after that many minutes (a non-empty ComfyUI render queue counts as activity, so a running render is never interrupted).

### ⚠️ Legacy/manual fallback — REQUIRED pod config for a NON-baked pod
> **Prefer the baked image above.** The rest of this section is the **legacy hand-install runbook** for a pod that was created before the baked image (ComfyUI installed by hand on the volume). A pod deployed from `atlas-comfy-pod` needs none of it — no Start Command, no manual pip.

The launcher can **resume** the pod via API but **cannot SSH in** to launch ComfyUI. So a **non-baked** pod's container **Start Command** (Docker container start command, set in the RunPod pod config → **Edit Pod** → *Container Start Command*, or when creating the pod) must run:
```
bash /workspace/start-comfyui.sh
```
(`start-comfyui.sh` lives on the Network Volume, mounted at `/workspace`, and `cd`s into `/workspace/ComfyUI` then launches `python main.py --listen 0.0.0.0 --port 8188`.) **Without this**, pressing **Start** from the `/comfyui` card boots the pod but ComfyUI never comes up — the proxy URL just hangs/502s. This is the single most important pod-config step.

### FLUX.2 / Qwen-Image on an R&D pod
Both are **native in ComfyUI core** from the `v0.33.1` pin (`comfy/ldm/flux` + the built-in `Flux.2 …` blueprints) — no custom node, so nothing to rebuild. Only the weights are missing, and they come from Hugging Face straight onto the Network Volume (not via R2 — no reason to pay two transfers for a public set):

```
python /fetch-models.py --list
python /fetch-models.py --set flux2-klein
```

The script is **baked into the pod image** at `/fetch-models.py` (a pod older than that
image won't have it — rebuild + redeploy, or paste it in). `--dest` defaults to the
volume.

**Wan 2.2 (video) is core-native too** (`comfy/ldm/wan` + the built-in `Text to Video (Wan 2.2)` / `Image to Video (Wan 2.2)` blueprints) — `wan22-t2v`, `wan22-i2v`, `wan22-turbo`, `wan22-ti2v-5b`. Pull `wan22-turbo` alongside a Wan set or the built-in blueprints open with a missing LoRA.

**`pulid-flux2` is the exception to "no custom node".** The FLUX.2 identity adapter needs `ComfyUI-PuLID-Flux2`, which is baked into the image — so unlike every set above, weights alone are not enough and a pod on an older image cannot load them. It is also **R&D-only**: node and weights are MIT, but it depends on InsightFace **antelopev2**, which is non-commercial research only, so attaching a face pulls otherwise-Apache `flux2-klein` into non-commercial. Anything that must ship in a game stays on `qwen-image`.

- **`flux2-klein`** (12.5 GB, **apache-2.0**) — start here. The only FLUX.2 variant that is both licence-clean enough to ever ship in a game (unlike FLUX.1-dev/PuLID, which stay R&D-only) and small enough to run without CPU offload on the fleet's cards.
- **`flux2-dev`** (53.8 GB, **non-commercial**) — quality comparison only. Its ~35 GB of diffusion weights exceed the biggest card we have (32 GB RTX PRO 4500), so ComfyUI falls back to CPU offload and it is slow. **Check the volume has ~54 GB spare first** — it was sized for SDXL/FLUX.1.
- The shared `flux2-vae` file is served from the `Comfy-Org/flux2-dev` repo (licensed `other`, not apache-2.0), so confirm its terms before anything from klein ships commercially.

- **`qwen-image`** (30.1 GB, **apache-2.0**) — the base the cartoon-character pipeline sits on (ComfyUI's built-in "Text to Image (Qwen-Image 2512)" blueprint). ~30 GB on disk but the encoder and diffusion model load in sequence, so peak VRAM is ~20 GB, inside a 24 GB card.
- **`qwen-toon`** (0.6 GB, **apache-2.0**) — renderartist's Toon-Tacular style LoRA for Qwen-Image.

**A LoRA binds to ONE base architecture.** `qwen-toon` declares `base_model: Qwen/Qwen-Image-2512`, so it loads onto `qwen-image` and **not** onto FLUX.2 or FLUX.1; `flux2-dev-turbo` is likewise FLUX.2-only. Pairing a LoRA with the wrong base either errors on load or produces noise. Qwen-Image + its LoRA are the only **fully** apache-2.0 image path we have — everything is licence-clean end to end, unlike FLUX.1-dev/PuLID.

The script is idempotent and resumes a partial download over HTTP Range — which matters, because a pod web terminal will drop before a 35 GB file finishes. Re-running a set the volume already has is a no-op.

**FLUX 3 is NOT available to fetch.** BFL announced it 2026-07-23 (multimodal: image/video/audio/action-prediction) but it is playground + API only — there is no `black-forest-labs/FLUX.3*` repo on Hugging Face and no `flux3` support in ComfyUI core. An open-weight **FLUX 3 [dev]** is confirmed in their launch plan with no date, no licence, and no parameter count published. Until weights land there is nothing for a pod to load; when they do, adding a set is a single `MODEL_SETS` entry in `fetch-models.py`.

### Pod software setup (LEGACY manual runbook — persists on the Network Volume)
> **Legacy only.** These steps are already baked into `atlas-comfy-pod`. Use them only to repair a pre-baked-image pod, or to understand what the image encodes. On a baked-image pod they are unnecessary (and re-running `pip install torch` by hand won't survive a container recreate — that's the whole reason for the baked image).

These were needed to get the artist's FLUX/PuLID blueprint running on a hand-built pod. Run from the pod's web terminal / SSH; everything under `/workspace` survives stop/start.

1. **Pin ComfyUI to `v0.33.1`** (in `/workspace/ComfyUI`):
   ```
   git fetch --depth 1 origin refs/tags/v0.33.1:refs/tags/v0.33.1 && git checkout v0.33.1
   ```
   Pin to a **tag**, never master: an unpinned core changes generation behaviour with no commit, and lets the pod and the serverless worker drift apart. The ref **must match the serverless worker** (`services/atlas-serverless/Dockerfile` `COMFYUI_REF`) so R&D and production stay in lockstep — bump both in ONE PR. **Still do NOT use ComfyUI-Manager's "Update ComfyUI"**: it patches the ephemeral container layer, so on a baked-image pod it silently reverts on the next container recreate. Bump the `ARG` and rebuild instead.
   > Superseded history: we held `v0.3.66` from 2025-10-21 to 2026-08-19 because `comfy/quant_ops.py` pulled in the `comfy_kitchen` backend, whose na3d op annotated a param as `list[int]` and was rejected by torch's `infer_schema` (crash on import). Fixed upstream — `quant_ops.py` no longer registers a `torch.library` op and `comfy_kitchen` is a version-pinned wheel in ComfyUI's own `requirements.txt`.
2. **Blackwell GPU needs cu128 torch.** The base image's `torch 2.4.1+cu124` has **no Blackwell (`sm_120`) kernels** → `CUDA error: no kernel image is available`. Fix:
   ```
   pip install --upgrade torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
   ```
   Upgrade **torchaudio too** (leaving it on the old build makes its native lib fail to load).
3. **Custom nodes** — clone into `/workspace/ComfyUI/custom_nodes`:
   - `Fannovel16/comfyui_controlnet_aux`
   - `cubiq/PuLID_ComfyUI`
   - the artist's **modified** `ComfyUI-PuLID-Flux` — vendored in-repo at `services/atlas-serverless/custom_nodes/ComfyUI-PuLID-Flux/`. The stock `balazik/ComfyUI-PuLID-Flux` node lacks the `attn_mask` fix and errors `forward_orig() got an unexpected keyword argument 'attn_mask'`; use the vendored copy, not the upstream one.
   Then the face stack: `pip install insightface onnxruntime-gpu facexlib`.
4. **ComfyUI-Manager "outdated" alert:** while the core sat on `v0.3.66`, Manager reported *"Security Alert: ComfyUI outdated. Installations blocked"* and greyed out its install buttons even at security level **"middle"**. The `v0.33.1` bump clears it. If it ever comes back, it means the pin has gone stale again — **re-check whether the pin still has a reason** rather than clicking "Update ComfyUI" (which cannot persist; see step 1). Installing custom nodes from the terminal (step 3) is the workaround, but the real fix on a baked-image pod is to add the node under `services/atlas-comfy-pod/custom_nodes/` and let CI rebuild.

### Cost model
- **GPU is billed per-second only while the pod is Running.** Closing the browser does **NOT** stop it — only **Stop** (the card's Stop button, or idle auto-stop) halts GPU billing.
- **Network Volume is a flat ~$12–18/mo, always** (charged whether or not the pod runs) — it's what makes models/nodes persist.
- **Cold start ~1–3 min** (models already on the volume). Idle auto-stop + the card's Stop button are the cost controls; leave idle auto-stop on.

## R2 (Cloudflare object storage)

- Bucket: `invisibleassets`. Endpoint: `https://175d2ae4501d5de0a1ca970f2bb31448.r2.cloudflarestorage.com`.
- Key layout:
  - `atlas/manifests/loader.json` — Svelte-era manifest (legacy path)
  - `spines/hotfruits/…` — spine assets
  - `atlas_maker/cloud/<project>/{manifests,input,output,deploy}/…` — the ported tool's store

## Environment variables (names only)

**Launcher:** `DATABASE_URL`, `ORIGIN`, `REMEMBER_TTL_DAYS`, `SESSION_TTL_HOURS`, `RESEND_API_KEY`, `R2_*`, `ATLAS_BACKEND_URL`, `ATLAS_TOOL_URL` (has code default), `ATLAS_TOOL_SECRET` (optional gate), `ATLAS_MANIFEST_KEY`, `ATLAS_STYLE_REF_KEY`, `ADDRESS_HEADER`, `XFF_DEPTH`, `CF_API_TOKEN`, `CF_ZONE_ID`, `GAMES_BASE_URL` (has code default), `GIT_CLONE_TOKEN`, `GIT_CLONE_USERNAME` (has code default), `GITHUB_ENGINE_READ_TOKEN` (optional), `GITHUB_ENGINE_REPO` (has code default), `RAILWAY_API_TOKEN`, `RAILWAY_PROJECT_ID`, `CF_ACCOUNT_ID`, `CF_ANALYTICS_TOKEN`, `ANTHROPIC_ADMIN_API_KEY`, `OPENAI_ADMIN_API_KEY` (all optional, Admin → Costs).

> **Admin → Costs (running-cost dashboard):** `/admin` → **Costs** reads each paid provider's own API and shows balance / spend / breakdown per provider. Every credential is **optional and read-only**; an unset provider renders a "not configured" card naming the vars it wants, so the page is useful with none of them set. Set on the **launcher-api** service → **Apply changes / Deploy**.
> - **RunPod** — reuses the existing `RUNPOD_API_KEY`. **No new secret**; this is the only provider that publishes a real prepaid balance.
> - **Railway** — `RAILWAY_API_TOKEN` (Account Settings → Tokens; must be an **account or workspace** token, since a *project* token authenticates with `Project-Access-Token` rather than `Authorization: Bearer`) + `RAILWAY_PROJECT_ID` (the id in the project URL). Railway does not document the usage side of its GraphQL schema, so the collector surfaces Railway's own error text verbatim if a field is renamed — verify at `https://railway.com/graphiql`.
> - **Cloudflare R2** — `CF_ACCOUNT_ID` + `CF_ANALYTICS_TOKEN` with **Account → Account Analytics: Read**. ⚠️ Deliberately NOT `CF_API_TOKEN`, which is **zone**-scoped for cache purge and cannot read account analytics. R2 has no billing API, so the dollar figure is stored bytes + class A/B operation counts × the published rates (`RATES` in `costs/r2.ts` — a price list in code, so re-check it against Cloudflare's pricing page when it moves).
> - **OpenAI / Anthropic (whichever Localization actually uses)** — `translate.ts` dispatches to an **OpenAI-compatible** endpoint when `LOCALIZATION_LLM_BASE_URL` + `LOCALIZATION_LLM_API_KEY` are set, and only falls back to Anthropic otherwise. The page mirrors that: it shows the card for the **active** provider (or either one that holds a key), so the dormant one isn't a permanent "not configured" card for a bill nobody gets.
>   - **OpenAI** — `OPENAI_ADMIN_API_KEY`, an **admin** key (`sk-admin-…`) from platform.openai.com → Settings → Organization → Admin keys; only an org **Owner** can mint one, and a project key (`sk-proj-…`) gets 401. `GET /v1/organization/costs`, `Authorization: Bearer`, `start_time` in **Unix seconds**, and `amount.value` in **dollars**.
>   - **Anthropic** — `ANTHROPIC_ADMIN_API_KEY` (`sk-ant-admin…`) from Console → Settings → Admin keys. A **different credential** from `ANTHROPIC_API_KEY`. `x-api-key` auth, RFC-3339 `starting_at`, and `amount` in **cents as a decimal string**.
>   - ⚠️ The two differ on units, time format *and* auth header — don't copy one collector's parsing onto the other. Neither exposes a credit-balance endpoint, so remaining prepaid credit is derived from the admin-entered top-up ledger (`cost_top_ups`, migration `0015_loud_triton.sql`), never measured.

> **Engine "release pending" pill (C2):** the launcher home pill can also flag when engine `main` has un-released ENGINE changes (`apps/lines/`, `packages/`) ahead of the live runtime bundle's stamped commit. To activate, set on the **launcher-api** Railway service: `GITHUB_ENGINE_READ_TOKEN` = a **fine-grained PAT** with **read-only "Contents"** on `Invisible-Wall-SL/Invisible-Engine` (optionally `GITHUB_ENGINE_REPO` = `owner/repo` to override the default). The launcher calls the GitHub compare API (`{deployed}...main`) best-effort, cached ~60s. **If `GITHUB_ENGINE_READ_TOKEN` is unset (or any GitHub error/timeout), the pill simply never shows "release pending"** — it behaves exactly as before (green/deployed). `GIT_CLONE_TOKEN` is used only as a best-effort fallback and is scoped to game repos, so a dedicated read token is preferred. After setting → **Apply changes / Deploy**.

> **Cloudflare cache auto-purge (game republish):** after the desktop launcher uploads a bundle to R2 `test_server/<key>/` and calls `POST /api/launcher/register-game`, the launcher purges the edge cache for that game (game filenames are stable, so the edge otherwise serves stale files). Set on the **launcher-api** Railway service: `CF_API_TOKEN` (a Cloudflare API token scoped to **Zone → Cache Purge** on the `invisiblewall.org` zone) and `CF_ZONE_ID` (the `invisiblewall.org` zone id). `GAMES_BASE_URL` is the public game origin (`https://games.invisiblewall.org`, code default). **If `CF_API_TOKEN` or `CF_ZONE_ID` is unset, the purge is a silent no-op** — publishing still works, but the edge keeps serving stale files. After setting → **Apply changes / Deploy**.

> ⚠️ **`ADDRESS_HEADER=x-forwarded-for` + `XFF_DEPTH=1` are required for the login brute-force throttle (B38) to see real client IPs.** These are read by `adapter-node` itself (not `env.ts`) so `getClientAddress()` parses Railway's `X-Forwarded-For` instead of returning the proxy's address. `XFF_DEPTH=1` = one trusted proxy hop (Railway's edge); raise only if you add more proxies in front. **If unset, every request looks like one shared IP** — the per-IP bucket collapses to a single global counter (the per-email bucket is unaffected), which both weakens the IP throttle and risks collateral lockout. Set on the launcher service → **Apply changes / Deploy**.

**atlas-backend & atlas-tool:** `COMFY_URL`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`, `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `COMFY_ORG_API_KEY` (optional, gpt_image). **atlas-tool also:** `ATLAS_PROJECT`, `ATLAS_OUTPUT_PREFIX`, `ATLAS_TOOL_SECRET` (optional), `ATLAS_STAGING`.

> **`COMFY_TRANSPORT` picks which ComfyUI the atlas-tool generates on — production is `serverless`.**
> `serverless` submits the api-prompt graph to a **RunPod Serverless endpoint** (`RUNPOD_ENDPOINT_ID` + `RUNPOD_API_KEY`); unset or `http` uses the **local ComfyUI over the tunnel** (`COMFY_URL` + the two `CF_ACCESS_*` vars). Live `atlas-tool` is on `serverless` (2026-08-18), so `COMFY_URL`/`CF_ACCESS_*` are **not** on the generation path there even though they're still set — a generation failure in production is a RunPod/worker-image issue, not a local-tunnel one. Changing this var silently changes which machine's installed nodes/models a pipeline needs, which is exactly how gpt_image and the FLUX ControlNet path were blocked for months. `RUNPOD_API_KEY` is shared with the `/comfyui` R&D pod fleet; `RUNPOD_ENDPOINT_ID` is the serverless endpoint only.

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
