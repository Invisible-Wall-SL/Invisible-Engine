# Infra — status

> **Reference (source of truth for URLs / env vars / secrets / the tunnel):** [docs/INFRA.md](../INFRA.md) · Agent: `.claude/agents/infra-railway.md`
>
> This file is a THIN status layer — current operational state + open items only. For any URL, env-var name, R2 key layout, tunnel id, or rotation procedure, go to **docs/INFRA.md**; do not duplicate its tables here.

**One-line state:** Healthy and serving — all cloud services live on one Railway project; the only owed work is owner-side security hardening (secret rotation + tool-gate secrets) and a couple of unverified/blocked items.

## Current state
The topology is **cloud-stateless Railway services + a shared R2 system-of-record, with only ComfyUI running locally** (reached over the Cloudflare named tunnel). See docs/INFRA.md for the diagram and the service/env tables.

- **Railway (one project, env `production`):** launcher (`app.invisiblewall.org`), `atlas-tool`, `sheet-tool`, `atlas-backend` (parked/dormant — nothing calls it), + Postgres. All auto-deploy from GitHub `main` on push. atlas-tool + sheet-tool build from the **repo root** (Dockerfile Path `services/<svc>/Dockerfile`) to share `services/_shared/iw_common`; launcher Root Directory is also repo root (so Railpack uses pnpm).
- **DB migrations self-apply on boot** (SvelteKit `init` hook → Drizzle programmatic migrator, fail-soft/idempotent). Prod was baselined through `0010`/`0012` after the `db:push`-provisioned-DB incident; a self-healing guard now reconciles a push-provisioned DB automatically. **Rule: do NOT run `db:push` on prod — use `pnpm db:generate` + the on-boot migrator.**
- **Cloudflare:** DNS zone `invisiblewall.org`; `www`/`app` = CNAME → Railway, **DNS-only/grey** (proxying breaks Railway TLS); `comfy` = the named tunnel (proxied, behind Access service token). Edge cache auto-purge on game republish works when `CF_API_TOKEN`/`CF_ZONE_ID` are set (silent no-op if unset).
- **ComfyUI tunnel healthy:** named tunnel → local `localhost:8188` (RTX 4070). Fresh-machine setup automated by the desktop launcher (auto-installs `cloudflared`, provisions the credentials bundle from R2). ComfyUI models mirror to R2 and pull via the launcher's Sync-models button.
- **R2 bucket `invisibleassets`** is the unified single-project repo: `<client>/<project>/{input,manifests,atlas,batch,sheets,sheet_src,deploy,spines,localization,editor,…}`, shared by all tools. Old per-tool namespaces fully retired/deleted.

## Open items / next
1. **cloudflared as a Windows service** — install so the tunnel survives reboots (`cloudflared service install`). Today it's launcher Start/Stop buttons only, not a persistent service.
2. **Pin a Railway `/data` persistent volume** on atlas-tool + sheet-tool — the incremental-hydrate skip only persists across deploys with a real volume; on ephemeral disk the first hydrate per boot re-pulls everything (R2 egress). Disk growth is now bounded (lazy hydrate + "Clear local cache"), but **no `railway.json` confirms `/data` is persistent — verify whether already done.**
3. **prod DB migrations `0011`/`0012` applied?** — unverified from here (no `DATABASE_URL`). Auto-migrate-on-boot should have applied them, but confirm against the live schema. (`0009 app_settings` + a baseline-0012 row were reconciled 2026-06-20; verify `0011`/`0012` landed cleanly.)
4. **Launcher OOM-on-bake (Railway RAM):** the editor bake/export path has 502'd mid-bake from the launcher running out of memory (bake retries 5xx as a soft cover). Durable fix = more RAM on the launcher service / stream exports rather than buffering. See `gotcha_bake_export_502_launcher_oom`.

## Blocked (owner / external)
- **⚠️ HIGHEST PRIORITY — live anonymous-access exposure + secret rotation (owner-side, Railway/CF dashboards, ~30 min):** set `ATLAS_TOOL_SECRET` + `SHEET_TOOL_SECRET` (unset → the tool gate returns "allowed", so the public Railway URLs are an unauthed path to R2 read/write/delete + GPU/comfy.org spend), and **rotate the setup-time secrets that were exposed**: the R2 token (read+write whole bucket, shared by ~4 services), the Postgres password, and the CF Access service-token secret. Also rotate `COMFY_ORG_API_KEY` and `EDITOR_DOC_SECRET`. Procedure + rotation checklist in docs/INFRA.md "Security / secret rotation". After each rotation, **verify the runtime, not just the dashboard.**
- **gpt_image generation blocked** — needs the `Images to RGB` ComfyUI node installed locally + `COMFY_ORG_API_KEY` (+ comfy.org credits). Code is ready; only SDXL ControlNets are installed. FLUX txt2img is proven live; the FLUX ref/ControlNet path is unproven for the same reason.
- **ComfyUI-Manager prerequisite** for Blueprints model auto-install — must be installed locally at security level "middle" or below (else 403). See docs/INFRA.md.

## Recent changes
- 2026-06-20 — prod `app_settings` (`0009`) created + migrate baseline reconciled through `0012`; hardened `reconcilePushProvisioned` ([detail in history](../history.md)).
- 2026-06-15 — thumbnail/asset random 502s fixed (shared disk thumb cache + bounded PIL concurrency + ETag/304) ([detail in history](../history.md)).
- 2026-06-13 — auto-migrate on boot shipped + prod baselined through `0010` after the `db:push` replay-from-0000 incident ([detail in history](../history.md)).
- 2026-06-02 — R2 unified single-project repo cutover complete; old per-tool namespaces deleted ([detail in history](../history.md)).
