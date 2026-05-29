# Project status & roadmap

> Where things stand and what's left. Update this at the end of meaningful work.
> Last updated: 2026-05-29.

There are two tracks in this repo:
1. **Engine & games** — the Stake-Engine fork (pixi-svelte, Svelte 5, PixiJS 8) + the games.
2. **Studio / pipeline tools** — the launcher portal + the cloud-hosted asset tools (atlas) + ComfyUI pipeline.

---

## Track 1 — Engine & games

- **RGS translator (Play4Fun):** ✅ done. `packages/rgs-translator-eagaming` maps the Stake internal request shape to the Play4Fun `/rgs/engine` protocol (verified from real Hot Fruits captures). Stake-shaped facade lets `apps/lines` run unmodified against a local mock via `PUBLIC_RGS_TRANSPORT=play4fun`. See root `CLAUDE.md` for protocol details.
- **Games:** `apps/{lines,cluster,scatter,ways,number-picker,price}`. New game **Book of Borut** (evolution of Hot Fruits, Book-of slot type) lives in its own repo with the engine as a submodule (port 3002).
- **Rule:** engine changes go on `main` — never per-game engine branches. Don't dismantle the Turborepo/pnpm-workspace structure.

## Track 2 — Studio / pipeline tools

### Done
- **Launcher** (`apps/launcher-api`) live at `app.invisiblewall.org`: invite-only email+password auth (scrypt), sessions in Postgres, roles + per-role tool manifest (`src/lib/roles.ts`), full-page tool pages.
- **`/spine`** — Spine Viewer, full-page (redirect to static `view.html`).
- **`/atlas`** — full-page **redirect** to the cloud Atlas tool (NO iframe — see hard rules).
- **atlas-backend** (`services/atlas-backend`, FastAPI) — Railway → Cloudflare tunnel → local ComfyUI → R2, **verified end-to-end**: `/generate-test`, `/generate-region` (SDXL + LoRA + IPAdapter + ControlNet + RMBG), `/compose`, `/slice`.
- **atlas-tool** (`services/atlas-tool`) — the **local Python Atlas Maker re-hosted on Railway**. Drop-in `cloud_paths.py` (local staging mirrors an R2 prefix 1:1) + `storage.py` (R2). ComfyUI reached via tunnel; refs uploaded via `/upload/image`; variants fetched via `/view` → staging + R2. Config/manifests in R2 with write-through. Live and serving the UI.

### ⚠️ Remaining work (the pipeline is NOT finished)

**atlas-tool (immediate):**
1. ✅ **Seed R2 — done (2026-05-29).** `seed_r2.py` uploaded 1158 objects to `atlas_maker/cloud/cloud/` (10 manifests, 1147 refs, config). Tool redeployed and hydrated — UI lists all manifests. Hydrate now pulls manifests/config synchronously + refs in a background thread (fast boot). ⚠️ The R2 creds used were pasted in chat → **rotate them** (security debt below). Open item: the loaded manifests reference `.atlas` geometry via local Windows paths (won't resolve in cloud) — fine for generate, needed for compose/slice (item 3).
2. **Access gate** — `ATLAS_TOOL_SECRET` is currently unset (tool is open on its URL). When set, the launcher appends `?k=<secret>`; verify the cookie flow.
3. **`.atlas` geometry for compose/slice** — manifest `atlas.atlas_file` still points at a local Windows path; compose/slice need the `.atlas` + source page uploaded to R2.
4. **FLUX + gpt_image pipelines** — only SDXL is verified; FLUX and gpt_image (comfy.org API node) workflows in `batch_atlas.py` are ported but untested in the cloud.
5. **Third tool — Invisible Sheet Maker** — not yet explored/ported (same pattern as atlas-tool if wanted online).

**Infra / cleanup:**
6. **Security** — rotate the secrets pasted during setup (R2 token, Postgres pw, CF Access service-token secret) and scrub the committed `comfy_org_api_key` in the `Invisible_Pipeline` repo. See docs/INFRA.md.
7. **cloudflared as a service** — install it so the tunnel survives reboots.
8. **Local launcher cleanup** — `Invisible_Launcher.py` should manage only ComfyUI + cloudflared (tool UIs are online now).

### Key lessons from the 2026-05-29 session (don't repeat)
- **Always `git push`** after committing — a Railway service can't deploy commits that are only local. (We lost time because 5 commits were committed but not pushed.)
- **Railway staged vars** — adding a var only stages it; click "Apply changes / Deploy". A plain redeploy doesn't apply it. Prefer a **code default** for non-secret config (e.g. `ATLAS_TOOL_URL`) so deploys don't depend on the dashboard.
- **Cloudflare blocks `Python-urllib` UA with 403** — always send a custom User-Agent to ComfyUI.
- **Windows trailing-dot folders** — Windows silently strips a trailing `.` from directory names, so a folder named `symbols.` behaves as `symbols` locally but NOT on Linux/R2. Manifest ref paths like `refs/atlasslices/symbols./x.png` resolved locally but broke in the cloud ("no ref"). Fixed by normalizing path segments in the R2 manifests (`services/atlas-tool/fix_manifest_paths.py`). Watch for this on any Windows-sourced data.
- When something "isn't working" on a deployed service, **verify what the runtime actually sees** (a throwaway diagnostic) instead of guessing or re-checking config.
