# Project status & roadmap

> Where things stand and what's left. Update this at the end of meaningful work.
> Last updated: 2026-05-31.

There are two tracks in this repo:
1. **Engine & games** — the Stake-Engine fork (pixi-svelte, Svelte 5, PixiJS 8) + the games.
2. **Studio / pipeline tools** — the launcher portal + the cloud-hosted asset tools (atlas) + ComfyUI pipeline.

---

## Track 1 — Engine & games

- **RGS translator (Play4Fun):** ✅ done. `packages/rgs-translator-eagaming` maps the Stake internal request shape to the Play4Fun `/rgs/engine` protocol (verified from real Hot Fruits captures). Stake-shaped facade lets `apps/lines` run unmodified against a local mock via `PUBLIC_RGS_TRANSPORT=play4fun`. See root `CLAUDE.md` for protocol details.
- **Games:** `apps/{lines,cluster,scatter,ways,number-picker,price}`. New game **Book of Borut** (evolution of Hot Fruits, Book-of slot type) lives in its own repo with the engine as a submodule (port 3002).
- **Rule:** engine changes go on `main` — never per-game engine branches. Don't dismantle the Turborepo/pnpm-workspace structure.

## Track 2 — Studio / pipeline tools

### Current live state
*(One line each; full done-work narrative in `docs/history.md`.)*
- **Launcher** at `app.invisiblewall.org` — invite-only email+password auth (scrypt) + Postgres sessions, three-layer role/user tool matrix, `/admin` panel (users/roles/tools/projects/clients/games/sessions), project + client layer (R2 isolated per `<tool>/<client>/<project>/`). (history: see `docs/history.md`)
- **Online tools** — `/atlas` (redirect to atlas-tool), `/spine` (Spine Viewer), `/sheet` (redirect to sheet-tool), `/localization` (in-launcher), `/editor` (Invisible Editor, in-launcher), `/files` (FTP Browser, project-scoped R2 manager). (history: see `docs/history.md`)
- **atlas-tool + sheet-tool** on Railway — Python Atlas/Sheet Makers re-hosted; now **repo-root Docker build** sharing `services/_shared/iw_common` + thread-local per-request context. (history: see `docs/history.md`)
- **atlas-backend** (FastAPI) — aligned to `<tool>/<client>/<project>/` + Dockerfile-pinned, **parked/dormant** (nothing calls it; atlas-tool runs generation itself). (history: see `docs/history.md`)
- **ComfyUI tunnel** — local RTX 4070 ComfyUI reached over the Cloudflare named tunnel (`comfy.invisiblewall.org`); the only genuinely-local footprint. (history: see `docs/history.md`)

### Open items

**Owner-side (action required):**
1. ⚠️ **HIGHEST PRIORITY — live anonymous-access exposure:** set `ATLAS_TOOL_SECRET` + `SHEET_TOOL_SECRET` (unset → code returns "allowed", so the public Railway URLs are an unauthed path to R2 read/write/delete + GPU/comfy.org spend), and **rotate the R2 token** (read+write whole bucket, shared by 4 services) + Postgres pw + CF Access service-token secret. Owner-side (Railway/CF dashboards). ~30 min. **Do first.** See `docs/INFRA.md` "Security / secret rotation".
2. **Pin a Railway `/data` persistent volume** on atlas-tool + sheet-tool — payoff of perf fix #5 (incremental-hydrate skip only persists across deploys with a real volume; on ephemeral disk the first hydrate per boot still pulls everything). NOTE: doc has no `railway.json` confirming `/data` is persistent — verify whether already done.
3. **Flip atlas-tool + sheet-tool + atlas-backend Railway Root Directory → repo root + Dockerfile Path = `services/<svc>/Dockerfile`** (coupled deploy from fixes #3 + #7 — Dockerfiles now build from the repo root). Until flipped, builds fail (last good deploy stays live → no outage). See `docs/INFRA.md` "atlas-tool + sheet-tool build from the REPO ROOT".
4. **cloudflared as a Windows service** — install it so the tunnel survives reboots (`cloudflared service install`). Partial today: B2 added Start/Stop tunnel buttons to the local launcher GUI, but it's not yet a persistent service. (#8)
5. **B20 — local launcher strip** (owner-run; file outside repo): reduce `C:\Invisible Wall SL\ComfyUI\Invisible_Launcher.py` to ComfyUI + cloudflared start/stop/status; remove the Projects tab, `ProjectDialog`/`ProjectCard`, projects config list, `launch_game`/service-bat plumbing (local↔cloud "project" drift — cloud is the single source of truth). Consider vendoring it into `tools/local-launcher/`.

**NEEDS OWNER env vars (unset → consequence):**
- `EDITOR_DOC_SECRET` on the launcher — until set, `GET /api/editor/doc` 503s and games use the checked-in `editor-scenes.ts` fallback (no R2 doc fetch).
- `ANTHROPIC_API_KEY` on the launcher — until set, the Localization tool loads but Translate returns a clear error.
- `GAMES_BASE_URL` — set to the current test server, else the home Games section shows a muted hint. (Now superseded by the admin-managed games DB, but the env still gates the legacy quick-bridge.)
- `COMFY_ORG_API_KEY` (+ comfy.org credits) — required to run gpt_image generation.
- `SHEET_TOOL_URL` (+ matching `SHEET_TOOL_SECRET`) on the launcher — until set, `/sheet` shows the "not configured" page. Also still owed: create the Railway service from `services/sheet-tool/` (envs `R2_*`, optional `SHEET_PROJECT`/`SHEET_TOOL_SECRET`).

**Live-verify owed (✅ code / ⏳ NOT browser-tested):**
- **atlas-tool compose/slice (B10 / `.atlas` Part A):** upload `.atlas` + compose + slice against live R2.
- **FLUX + gpt_image live:** FLUX proven live (2026-05-30, ~105s txt2img); **gpt_image still blocked** — `Images to RGB` node not installed + needs `COMFY_ORG_API_KEY`; only SDXL ControlNets installed (FLUX+shape_ref/ControlNet won't work).
- **FTP Browser (`/files`):** binary upload, recursive delete/move, `Load more` pagination, `%2F`-encoded `CopySource` move/rename — against live R2.
- **Invisible Editor end-to-end:** expand→thumbnail→drag→render→overlay→save (B18) + non-fallback doc fetch (seed a real `editor/<client>/lines/scenes.json` in R2; port consumer into Book of Borut, "step 9b/10b").
- **sheet-tool project-file + B19:** rename/Save/Save As + blank/dup name guards, browser-tested live.
- **B12 project switch:** browser test an actual project switch + cross-project ref picking via `/fsbrowse`.
- **Spine Viewer (B21):** active-project propagation + named empty-state message live (data: run `r2-sync-spines.mjs` for projects meant to have spines — none synced for non-hotfruits yet).
- **Launcher beauty pass (B22):** authed home page not browser-tested.
- **Threaded-race concurrent smoke (fix #2):** two concurrent `?project=` requests for different projects → each writes only its own R2 prefix.
- **iw_common deploys (fixes #3/#7):** verify atlas-tool/sheet-tool/atlas-backend build + run after the Root-Directory flip.

**Open backlog (B-items):**
- **B23 — launcher CLIENT/PROJECT selector broken** ✅ DONE (2026-05-31). Rebuilt the two-step selector in `(app)/+page.svelte` (no schema change — client stays derivable). The four root causes are gone: (A) the re-seeding `$effect` that clobbered the user's pick on every `invalidateAll` now re-seeds ONLY when the server's active project actually changes (gated by a `syncedActive` sentinel) — never mid-edit; (B) **CLIENT is now a pure local filter** — `onClientChange` only re-filters the PROJECT list (keeps the project selected if it belongs to the chosen client, else blanks it), it no longer auto-submits `?/setProject`; (C) committing happens ONLY on an explicit PROJECT change (`onProjectChange` submits on a real change); a blank state shows a disabled "— choose a project —" placeholder so a cross-client browse forces an explicit pick instead of silently snapping; (D) dropped the `await tick()` papering (and the now-unused `tick` import + `activeProject` derived) since the options no longer change out from under the submit. Server `?/setProject` (validates `canAccessProject`) + the layout's accessible-list fallback to `cloud` are unchanged — that fallback is now benign (client=Unassigned, project=cloud, stable) rather than triggering a reshuffle. `pnpm --filter launcher-api build` GREEN. ⏳ Not browser-tested live (authed page) — verify: pick a project → it sticks across reloads; switch CLIENT → only the project list refilters (active unchanged until you pick); pick a project under the new client → commits + sticks.
- **B24 — restore back/forward navigation between tools (+ back to launcher)** ⏳ TODO: the Sheet Maker "Atlas Maker linked ✓" pill was never a link (a status pill). Fix: (1) launcher appends `sibling=<other tool URL>` + `home=<origin>` on each redirect; (2) Sheet Maker adds an "Atlas Maker →" anchor (carry `client/project/k`); (3) Atlas Maker adds `← Launcher` + "Sheet Maker →" anchors (surface `home`/`sibling` into `_index()` HTML + add `LAUNCHER_URL` to `atlas-tool/.env.example`). All plumbing exists (`ENV.ATLAS_TOOL_URL`/`ENV.SHEET_TOOL_URL`; redirects already append `?k=&client=&project=`).
- **B25 extraction (the real payoff)** ⏳ pending: progressively extract genuinely-shared UI into `packages/components-*` (start `<R2Browser>` from `ftpScope.ts`+`api/files`, `<DataTable>` for admin/localization) + the launcher gate/scope consolidation. Keep `docs/ui-inventory.md` updated. (`reuse-check` skill + `docs/ui-inventory.md` infra is ✅ DONE.)
- **B26 — tool output/staging not reachable from the FTP Browser** ⏳ TODO (needs investigation): sheet-tool output (e.g. `/data/sheet-tool/invisible_wall/test1/output`) + atlas-tool outputs aren't visible in `/files`. **Key distinction:** `/data/<tool>/...` is the tool's **container-local staging**; the FTP Browser only browses **R2** (`<tool>/<client>/<project>/` via `ftpScope.allowedPrefixes`). So an output is FTP-visible only if **mirrored to R2** under `sheet_maker|atlas_maker/<client>/<project>/output/`. Likely root: outputs aren't (fully) written through to R2 (atlas-tool's raw `output/` is intentionally not mirrored; sheet-tool may only `_mirror` some paths) → they live only on container disk. **Decision:** (1) write outputs through to R2 so the existing FTP browser shows them (preferred, no new UI) vs (2) add a "browse tool staging" mode for the `/data` disk (heavier, ephemeral). Confirm what's actually missing from R2 first. Files: `lib/server/ftpScope.ts`, `api/files/list`, `services/{atlas-tool,sheet-tool}` mirror/`push_dir` logic.
- **B27 — Atlas Maker can't generate: Sheet-authored manifest's `atlas.atlas_file` is a raw Windows path, not an R2 key** ⏳ TODO (needs investigation). Error: `Atlas geometry not found in R2: C:\Invisible Wall SL\Projects\iGaming\Borut\HotFruits\engine\apps\hotfruits\static\assets\spines\symbols\symbols.atlas` ("looked under the staging mirror at `/data/atlas-tool/unassigned/cloud/input/C:/Invisible Wall SL/.../symbols.atlas`", exit 2). **The manifest + `.atlas` were authored by the Invisible Sheet Maker**, so per **B14 (sheet manifest self-contained)** `atlas.atlas_file` should already be an **R2 key** (+ `export_prefix`/`source_image_path`) and atlas-tool's `_ingest_self_contained` should fetch + repoint it — but it's a raw absolute Windows path instead. Investigate: (1) **Sheet side** — does `sheet-tool/atlas_writers.build_manifest` actually emit `atlas_file` as an R2 key on libGDX export (B14 says only "when libgdx exported" + `R2_PREFIX` set — confirm both held); (2) **Ingest side** — `_ingest_self_contained` correctly no-ops on a Windows path (not an R2 key) → nothing repoints; (3) **Geometry resolver bug** — it naively **joined the absolute path onto INPUT_DIR** (`/data/.../input/C:/...`) instead of applying the B15/Part-A normalization that source images get (`batch_atlas.source_image_candidates`/`resolve_manifest_arg`: strip abs/Windows prefix → try bare name under `refs/atlas/`); atlas geometry resolution lacks that fallback. **Also:** tool ran under **`unassigned/cloud`**, not the asset's real HotFruits/Borut project — possibly related to project-context propagation (cf. B23). **Fix:** (a) make `build_manifest` always emit the R2 key for `atlas_file` (root); (b) give geometry resolution the same Windows-abs→`refs/atlas/<name>` fallback as source images; (c) today's workaround = region card **Upload .atlas / Pick from R2** (`POST /uploadatlas`, B10) repoints to a staging-relative path. (Closely related to the "`.atlas` geometry — Part B" data-migration note below.) Files: `services/sheet-tool/atlas_writers.py`, `services/atlas-tool/ui_server.py` (`load_manifest`/`_ingest_self_contained`/`atlas_file_path`), `services/atlas-tool/batch_atlas.py`.

**`.atlas` geometry — Part B (data migration), PENDING owner + R2 creds:** existing manifests still point `atlas.atlas_file`/`atlas.source_image` at local Windows paths; the real `.atlas` + page bitmaps live in `apps/<game>/static/assets/spines/<group>/` (pages often `.webp` while some manifests name `.png` — fix the mismatch on repoint). Migration = upload each `.atlas` + page to R2 `atlas_maker/unassigned/cloud/input/refs/atlas/<name>`, repoint manifest fields to `refs/atlas/<name>.<ext>`, re-upload manifests, restart atlas-tool. Easiest path: per region card, **Upload .atlas (B10)** auto-does it. (`fix_manifest_paths.py` still targets the STALE `atlas_maker/cloud/<proj>/` prefix — needs `atlas_maker/unassigned/cloud/`.) Needs `R2_*` env + the engine repo. (Part A code ✅ done.)

### Key lessons
Full list (+ the 2026-05-29 session lessons) in `docs/history.md#key-lessons`. The operationally-critical few:
- **Always `git push`** after committing — Railway can't deploy local-only commits.
- **Railway staged vars** — adding a var only stages it; click "Apply changes / Deploy". Prefer a **code default** for non-secret config so deploys don't depend on the dashboard.
- **Cloudflare blocks `Python-urllib` UA with 403** — always send a custom User-Agent to ComfyUI.
- **Windows trailing-dot folders** — Windows silently strips a trailing `.` (`symbols.` → `symbols` locally but NOT on Linux/R2); normalize path segments in R2 manifests. Watch on any Windows-sourced data.

---

Full done-work changelog: `docs/history.md`.
