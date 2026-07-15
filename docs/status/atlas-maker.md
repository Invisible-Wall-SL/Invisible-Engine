# Invisible Atlas Maker — status

> Design: [docs/design/atlas-per-user-session.md](../design/atlas-per-user-session.md) · Guide: [docs/tools/atlas-maker.md](../tools/atlas-maker.md) · Agent: `.claude/agents/atlas-python-tools.md`

**One-line state:** Live on Railway (`atlas-tool`). SDXL generate → slice → compose → deploy proven end-to-end; FLUX txt2img proven; gpt_image still blocked.

## Current state
Works today on `main` / live:
- The local Python Atlas Maker (stdlib `http.server` + Pillow) **re-hosted on Railway** — `cloud_paths.py` staging mirrors the R2 prefix 1:1, `storage.py` write-through, ComfyUI reached over the Cloudflare tunnel (refs via `/upload/image`, outputs via `/view`).
- **SDXL** generate / slice / compose / deploy — the proven, default pipeline.
- Per-region card: prompt edit, seed lock/unlock, style/shape ref pick — **rembg (background-removal) toggle**, refs uploaded locally or **picked from R2** via `/fsbrowse`, one-click "lock the seed that made this".
- **Self-contained manifests** — Windows path/trailing-dot normalisation done in R2; `.atlas` + source-page upload (B10) repoints the manifest to staging-relative paths.
- **FLUX builder complete** — txt2img proven live (2026-05-30, ~105s on the 8GB 4070).
- **Blueprints loop** — committed + publish-gated (`ATLAS_BLUEPRINT_SECRET`); Settings panel has the resolved-workflow (`/blueprintresolved`) export for debugging.
- **Sheet-derived FX cells auto-derive** on load/Process from their base region (not AI-generated), keyed on `shine.fx_layer_info` + `mode in FX_PRESETS` — no wasted ComfyUI credits.

## Open items / next
1. **`.atlas` compose/slice (B10 / Part A) — live browser smoke-test owed** against live R2 (Part B = repoint the stale Windows-path `atlas.atlas_file`/`source_image` fields, owner + R2 creds).
2. **FLUX ref/ControlNet path unproven** — only SDXL ControlNets are installed locally; FLUX base + Redux work, shape_ref/ControlNet does not.
3. **Per-user session isolation — planned, unbuilt** (design `atlas-per-user-session.md`): the active-manifest resolver is process-global, so two users on one project clobber each other's open selection + see each other's render progress. Phases 1–3 (thread `user` id → per-user overlay → per-user render state).
4. **Access gate** — `ATLAS_TOOL_SECRET` unset → tool is open on its Railway URL; verify the launcher `?k=` flow when set.

## Blocked (owner / external)
- **gpt_image generation** — needs the `Images to RGB` ComfyUI node **and** `COMFY_ORG_API_KEY` (+ comfy.org credits) installed locally. Code is ready; the default transparent path already skips the redundant RMBG cutout.
- **FLUX ControlNet models** — not installed on the local GPU (only SDXL ControlNets are).

## Recent changes
- 2026-07-06 — sheet-derived FX cells now auto-derive on load/Process instead of being AI-generated ([detail in history](../history.md)).
- 2026-05-30 — FLUX proven live (~105s txt2img); B10 `.atlas`/source upload + R2 ref picking landed ([detail in history](../history.md)).
- 2026-05-29 — R2 seeded (1158 objects); tool hydrates + lists manifests ([detail in history](../history.md)).
