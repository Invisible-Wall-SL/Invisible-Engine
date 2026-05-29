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

### 📋 Backlog — assigned to agents (added 2026-05-29)
Pick these up in fresh sessions via the named subagent. Owner = the agent that should do it.

| # | Task | Owner agent |
|---|------|-------------|
| B1 | **Port Invisible Sheet Maker** to the cloud (same pattern as atlas-tool: cloud_paths/storage/Comfy bridge, Railway service). | `atlas-python-tools` |
| B2 | **Local launcher cleanup** — `C:\Invisible Wall SL\ComfyUI\Invisible_Launcher.py` should manage ONLY ComfyUI + cloudflared (tool UIs are online now); stop opening local tool web UIs. | `atlas-python-tools` |
| B3 | **Cloud launcher/Postgres dedup** — confirm a single launcher behind `app.invisiblewall.org`; retire any duplicate service/DB so users/sessions aren't split. | `infra-railway` |
| B4 | **Add the new CLIs** — the Studio game-spec CLI (validate/generate) + any pipeline CLIs: author/wire them, document usage. | `engine-pixi-svelte` |
| B5 | **Tool download links + per-user install paths** — DB schema to persist each user's local-tool install path; download URLs for local tools (ComfyUI, Spine Editor, Test Server, Sheet Maker); surface in launcher so we always know the path. | `launcher-studio` |
| B6 | **Full onboarding session in the launcher** — expand `/onboarding` into a complete guided walkthrough per role: each tool explained, install steps for local tools, download links (B5), links to docs. (Current `/onboarding` is a basic first version.) | `launcher-studio` |
| B7 | **Per-tool docs** — create/update a doc for EVERY tool (Atlas Maker, Spine Viewer, Sheet Maker, Test Server, ComfyUI usage, the launcher itself) under `docs/tools/`; create the ones that don't exist yet. | each tool's owner agent; `code-reviewer` checks |
| B8 | **Naming sweep** — ensure every one of OUR tools/pages reads "Invisible …" everywhere (cards, page titles, tool headers). (Spine viewer header fixed 2026-05-29.) | `launcher-studio` |
| B9 | **Security cleanup** — rotate the secrets pasted during setup (R2 token incl. `a6f88a7d…`, Postgres pw, CF Access service-token secret) + scrub the committed `comfy_org_api_key` in the Invisible_Pipeline repo. | `infra-railway` |
| B10 | **Atlas card "pick from R2"** — add an R2 ref picker to the region cards (template + set-style-ref-from-R2 endpoint); upload source image + `.atlas` geometry to R2 and repoint manifests (for Slice/Compose). | `atlas-python-tools` |
| B11 | **Verify FLUX + gpt_image pipelines** in the cloud (only SDXL is proven). | `atlas-python-tools` |

> When you complete a backlog item, move it out of this table into the "Done" list with a date + commit.

### ⚠️ Remaining work (the pipeline is NOT finished)

**atlas-tool (immediate):**
1. ✅ **Seed R2 — done (2026-05-29).** `seed_r2.py` uploaded 1158 objects to `atlas_maker/cloud/cloud/` (10 manifests, 1147 refs, config). Tool redeployed and hydrated — UI lists all manifests. Hydrate now pulls manifests/config synchronously + refs in a background thread (fast boot). ⚠️ The R2 creds used were pasted in chat → **rotate them** (security debt below). Open item: the loaded manifests reference `.atlas` geometry via local Windows paths (won't resolve in cloud) — fine for generate, needed for compose/slice (item 3).
2. **Access gate** — `ATLAS_TOOL_SECRET` is currently unset (tool is open on its URL). When set, the launcher appends `?k=<secret>`; verify the cookie flow.
3. **`.atlas` geometry + source image for compose/slice** — manifest `atlas.atlas_file` and `atlas.source_image` still point at local Windows paths (e.g. `apps/lines/static/assets/spines/symbols/symbols.png`); they need uploading to R2 and the manifest repointed to R2-relative paths. Needed for "Slice source → refs" and compose.
   - **File pickers now browse R2 (done):** `/fsbrowse` browses the project's R2 asset repo via the staging mirror and returns R2-relative paths, so the SETTINGS file pickers (atlas source image, .atlas geometry) pick from R2 instead of the local disk.
   - **Card "Choose file" is still local-upload only** — add an R2 "pick existing ref" option to the cards (needs card-template change + a set-style-ref-from-R2 endpoint). Local upload (uploadRef/useMyImage) still works.
   - **Outputs/variants intentionally NOT seeded.** The seed uploaded `input/` (refs + the 248 curated `useroutput_*` overrides) but NOT `output/` (the 577 raw batch variants — heavy, re-downloaded every boot, and regeneratable). The card prefers the override for display, so curated finals show once hydrate completes (verified 7/8 override regions render). Pure-prompt regions with no saved final correctly show "no output yet" until (re)generated. If raw prior variants are ever wanted in-cloud, seed `Shared/output/atlas_maker/<proj>/` → R2 `…/output/` (and ensure ATLAS_OUTPUT_PREFIX matches the local prefix dir, e.g. `HotFruits`).
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
