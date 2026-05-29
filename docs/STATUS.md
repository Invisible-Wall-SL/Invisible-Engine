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
- **B10 — atlas region cards "pick from R2" + `.atlas`/source upload** ✅ (2026-05-30). Region-card `style_ref`/`shape_ref` fields get a "Pick from R2" button reusing the existing `/fsbrowse` browser (writes INPUT_DIR-relative paths, the form `batch_atlas` resolves). New `/uploadatlas` POST writes an uploaded `.atlas` (+ optional source page) into `INPUT_DIR/refs/atlas/` (filenames stripped via `Path().name`), repoints `manifest.atlas.atlas_file`/`source_image` to staging-relative paths, `save_manifest` → R2. `atlas_file_path()` now resolves relative atlas files against staging. Code-complete + py_compile clean; **not browser-tested** (the FileReader→base64 upload + two-step picker untested live).
- **B11 — FLUX + gpt_image cloud pipelines reviewed** ✅ code, ⏳ live (2026-05-30). FLUX (`build_workflow_flux`) wiring is correct, no code change. gpt_image had a real defect: defaulted to `gpt-image-2` + a `Custom` size the shipped `OpenAIGPTImage1` node rejects (HTTP 400) → fixed to `gpt-image-1` with `_gpt_preset_for_ref()` picking a real preset by aspect (Custom path kept opt-in for a future gpt-image-2). API key env-first (no hardcode). **Live verify still owed by user** — see Remaining work item 4.
- **B1 — Invisible Sheet Maker ported to cloud** ✅ code (2026-05-30), Railway service not yet created. New `services/sheet-tool/` mirrors atlas-tool: `cloud_paths.py` (R2 prefix `sheet_maker/cloud/<proj>`), `storage.py`, R2 write-through, Dockerfile/requirements/.env. Pure Pillow (no ComfyUI). Exports handed off to the Atlas Maker's R2 `manifests/` prefix (needs an atlas-tool restart to appear, since hydrate runs at boot). py_compile clean; not run live (no local R2 creds). Env vars: `R2_*`, optional `SHEET_PROJECT`/`SHEET_STAGING`/`SHEET_TOOL_SECRET`/`PORT`.
- **B2 — local launcher trimmed to ComfyUI + cloudflared** ✅ (2026-05-30, file outside repo). `C:\Invisible Wall SL\ComfyUI\Invisible_Launcher.py` (`.bak` saved): removed the "Tools" tab so it no longer opens the local tool web UIs; added full Cloudflare Tunnel start/stop/status (tunnel `comfy-gualtiero`); ComfyUI/project management kept. User should run it once to confirm.

### 📋 Backlog — assigned to agents (added 2026-05-29)
Pick these up in fresh sessions via the named subagent. Owner = the agent that should do it.

| # | Task | Owner agent |
|---|------|-------------|
| B3 | **Cloud launcher/Postgres dedup** — confirm a single launcher behind `app.invisiblewall.org`; retire any duplicate service/DB so users/sessions aren't split. | `infra-railway` |
| B4 | **Add the new CLIs** — the Studio game-spec CLI (validate/generate) + any pipeline CLIs: author/wire them, document usage. | `engine-pixi-svelte` |
| B5 | **Tool download links + per-user install paths** — DB schema to persist each user's local-tool install path; download URLs for local tools (ComfyUI, Spine Editor, Test Server, Sheet Maker); surface in launcher so we always know the path. | `launcher-studio` |
| B6 | **Full onboarding session in the launcher** — expand `/onboarding` into a complete guided walkthrough per role: each tool explained, install steps for local tools, download links (B5), links to docs. (Current `/onboarding` is a basic first version.) | `launcher-studio` |
| B7 | **Per-tool docs** — create/update a doc for EVERY tool (Atlas Maker, Spine Viewer, Sheet Maker, Test Server, ComfyUI usage, the launcher itself) under `docs/tools/`; create the ones that don't exist yet. | each tool's owner agent; `code-reviewer` checks |
| B8 | **Naming sweep** — ensure every one of OUR tools/pages reads "Invisible …" everywhere (cards, page titles, tool headers). (Spine viewer header fixed 2026-05-29.) | `launcher-studio` |
| B9 | **Security cleanup** — rotate the secrets pasted during setup (R2 token incl. `a6f88a7d…`, Postgres pw, CF Access service-token secret) + scrub the committed `comfy_org_api_key` in the Invisible_Pipeline repo. | `infra-railway` |

> When you complete a backlog item, move it out of this table into the "Done" list with a date + commit.

### ⚠️ Remaining work (the pipeline is NOT finished)

**atlas-tool (immediate):**
1. ✅ **Seed R2 — done (2026-05-29).** `seed_r2.py` uploaded 1158 objects to `atlas_maker/cloud/cloud/` (10 manifests, 1147 refs, config). Tool redeployed and hydrated — UI lists all manifests. Hydrate now pulls manifests/config synchronously + refs in a background thread (fast boot). ⚠️ The R2 creds used were pasted in chat → **rotate them** (security debt below). Open item: the loaded manifests reference `.atlas` geometry via local Windows paths (won't resolve in cloud) — fine for generate, needed for compose/slice (item 3).
2. **Access gate** — `ATLAS_TOOL_SECRET` is currently unset (tool is open on its URL). When set, the launcher appends `?k=<secret>`; verify the cookie flow.
3. **`.atlas` geometry + source image for compose/slice** — manifest `atlas.atlas_file` and `atlas.source_image` still point at local Windows paths (e.g. `apps/lines/static/assets/spines/symbols/symbols.png`); they need uploading to R2 and the manifest repointed to R2-relative paths. Needed for "Slice source → refs" and compose.
   - **File pickers now browse R2 (done):** `/fsbrowse` browses the project's R2 asset repo via the staging mirror and returns R2-relative paths, so the SETTINGS file pickers (atlas source image, .atlas geometry) pick from R2 instead of the local disk.
   - ✅ **Card "pick from R2" + `.atlas`/source upload done (B10, 2026-05-30)** — cards now have a "Pick from R2" button (reuses `/fsbrowse`) for `style_ref`/`shape_ref`, and `/uploadatlas` uploads a `.atlas` (+ source page) and repoints the manifest to staging-relative paths. Local upload (uploadRef/useMyImage) still works. Needs a live browser smoke-test.
   - **Outputs/variants intentionally NOT seeded.** The seed uploaded `input/` (refs + the 248 curated `useroutput_*` overrides) but NOT `output/` (the 577 raw batch variants — heavy, re-downloaded every boot, and regeneratable). The card prefers the override for display, so curated finals show once hydrate completes (verified 7/8 override regions render). Pure-prompt regions with no saved final correctly show "no output yet" until (re)generated. If raw prior variants are ever wanted in-cloud, seed `Shared/output/atlas_maker/<proj>/` → R2 `…/output/` (and ensure ATLAS_OUTPUT_PREFIX matches the local prefix dir, e.g. `HotFruits`).
4. **FLUX + gpt_image pipelines — code reviewed (B11), LIVE VERIFY still owed.** FLUX code correct; gpt_image default fixed to `gpt-image-1`. To verify, the user must: start local ComfyUI; for FLUX install the models the config names (`flux1-dev` + `t5xxl` + `clip_l` + `ae`, or an FP8 all-in-one) + Redux (`flux1-redux-dev` + `sigclip_vision`) — on the 8GB RTX 4070 use fp8/GGUF to avoid OOM; for gpt_image set `COMFY_ORG_API_KEY` (comfy.org credit) and confirm the `OpenAIGPTImage1` + `Images to RGB` nodes exist (`GET {comfy}/object_info`).
5. ✅ **Third tool — Invisible Sheet Maker ported (B1, 2026-05-30)** — `services/sheet-tool/` is deploy-ready (Dockerfile, R2 write-through). Still TODO: create the Railway service + wire a launcher `/sheet` route.

**Infra / cleanup:**
6. **Security** — rotate the secrets pasted during setup (R2 token, Postgres pw, CF Access service-token secret) and scrub the committed `comfy_org_api_key` in the `Invisible_Pipeline` repo. See docs/INFRA.md.
7. **cloudflared as a service** — install it so the tunnel survives reboots. (Partial: B2 added Start/Stop tunnel buttons to the local launcher GUI, but it's not yet a persistent Windows service via `cloudflared service install`.)
8. **Local launcher cleanup** — `Invisible_Launcher.py` should manage only ComfyUI + cloudflared (tool UIs are online now).

### Key lessons from the 2026-05-29 session (don't repeat)
- **Always `git push`** after committing — a Railway service can't deploy commits that are only local. (We lost time because 5 commits were committed but not pushed.)
- **Railway staged vars** — adding a var only stages it; click "Apply changes / Deploy". A plain redeploy doesn't apply it. Prefer a **code default** for non-secret config (e.g. `ATLAS_TOOL_URL`) so deploys don't depend on the dashboard.
- **Cloudflare blocks `Python-urllib` UA with 403** — always send a custom User-Agent to ComfyUI.
- **Windows trailing-dot folders** — Windows silently strips a trailing `.` from directory names, so a folder named `symbols.` behaves as `symbols` locally but NOT on Linux/R2. Manifest ref paths like `refs/atlasslices/symbols./x.png` resolved locally but broke in the cloud ("no ref"). Fixed by normalizing path segments in the R2 manifests (`services/atlas-tool/fix_manifest_paths.py`). Watch for this on any Windows-sourced data.
- When something "isn't working" on a deployed service, **verify what the runtime actually sees** (a throwaway diagnostic) instead of guessing or re-checking config.
