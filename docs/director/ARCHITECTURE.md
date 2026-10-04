# Architecture — Invisible Director + Invisible Pipeline Changes

How the two tools plug into the platform. §1 maps what exists today (Phase 0 exploration);
§2 is the proposed shape, pending the ADRs; §3 lists decisions as they are approved. `L/` means
`apps/launcher-api/`.

## 1. Platform map (what exists, 2026-10-04)

### 1.1 Tool registry, launcher, header
- **Registry:** `L/src/lib/roles.ts`.
  - `TOOLS` (`ToolDef`: id, name, barName, description, kind `online|local`, url, icon).
  - `TOOL_ICONS`.
  - `TOOL_STAGES` is the single source of launcher sections and order: `create`, `assets`,
    `build` and `reference`, each with an accent colour.
  - `TOOL_BAR_ORDER` is derived from `TOOL_STAGES`.
  - Also here: `ROLE_TOOLS` and `TOOL_DOC_SLUG` (→ `docs/tools/<slug>.md`, served at `/docs/<slug>`).
- **Launcher home:** `L/src/routes/(app)/+page.svelte`, built from `stageSections`. A tool in no
  stage falls into "Other". Data comes from `L/src/routes/(app)/+layout.server.ts`
  (`manifestForRole`).
- **"New" badge:** none exists today. One has to be added (a `ToolDef` flag plus a card tag).
- **Shared tool header:** `L/src/lib/ToolTopBar.svelte` (props `current`, `tools`, `clientKey`,
  `projectKey`, `meta`).
  - Four HTML twins copy `TOOL_ICONS`: `L/static/rigger/view.html`, `L/static/spine/view.html`,
    `services/atlas-tool/ui_server.py` and `services/sheet-tool/ui.html`.
  - `scripts/check-toolbar-icons.mjs` enforces that every twin carries every tool's icon.
- **Route gating:**
  - Page loaders check `roleHasTool`.
  - The shared helper `gate()` lives in `L/src/lib/server/toolScope.ts`, alongside
    `resolveToolScope`, `resolveActionScope` and `requireProjectScope`.
  - API launch gates live in `L/src/lib/launcherGates.ts`.

### 1.2 Roles and capabilities
- **Roles:** admin, developer, artist, animator, pipelineTester, localizationReviewer, audio
  (`roles.ts` l.1–34).
- **Capabilities:** `adminPanel`, `blueprintPublish`, `fontPublish`, `gamePublish` and
  `componentPublish`. They are listed in `CAPABILITIES` (l.600), default via `capabilityDefault`,
  and are checked by `roleHasCapability`.
- **Resolver:** `effectiveToolIds(role, roleOverrides, userOverrides)` applies `ROLE_TOOLS`,
  then role overrides, then user overrides.
- **DB:** `role_tool_access` and `user_tool_access` (`L/src/lib/server/db/schema.ts`). A row is
  Grant or Revoke; no row means Default.
  - Accessors: `roleToolAccess.ts` and `userToolAccess.ts`.
- **Admin UI:** `L/src/routes/(app)/admin/+page.svelte`, with tabs users, roles, tools,
  projects, clients, games, sessions, costs and settings.
  - Server: `+page.server.ts` (`requireAdmin`, `setRoleToolAccess`, `setToolAccess`).

### 1.3 Projects, games, publishing
- **Game Maker create:** the `create` action in `L/src/routes/(app)/game-maker/+page.server.ts`
  writes a Postgres `projects` row (`projects.ts` `createProject`). It then seeds R2 with
  create-only writes via `projectScaffold.ts` `scaffoldProject`.
  - **There is no git commit and no branch.** A project is a DB row plus an R2 tree
    `<client>/<project>/…`.
- **Duplicate:** `POST /api/game-maker/duplicate` (`projectDuplicate.ts`, scope `setup|full`).
  It copies an existing project. This is the natural base for "start from a template game".
- **"Templates":** `hw-3pots-sample`, `hw-classic-sample` and `hw-collector-sample` are ordinary
  `holdAndWin` projects made from the three H&W presets. They are not a template kind.
  - Game kinds come from `gameKinds.ts` `selectableGameKinds()`.
  - Editor templates come from `templateStorage.ts`.
- **GAME / USING chips:** `gameProfile.ts` (`buildGameProfile`, `FEATURE_DETECTORS`).
- **Math contract:** `GameConfigDoc` in `packages/game-config/src/types.ts`, stored at
  `<C>/<P>/config/config.json` and written with `If-Match` via `gameConfigStorage.ts`.
  - **There is no "lock" concept today.** Director has to enforce one (ADR-0002).
- **Publish:** `POST /api/game-maker/publish` calls `publishGame.ts`.
  1. Gates: sound, flow-v2, paytable drift.
  2. `buildRuntimeBundle`, then a snapshot under `<C>/<P>/published/` (5 retained, rollback
     available).
  3. The `games` row is written.
  4. `test_server/games.json`.
- **Runtime:** there is one shared runtime, `_runtime/lines@<v>`, built by
  `.github/workflows/runtime-release.yml` on push to main.
- **Play and Live links:**
  - Play: `games.invisiblewall.org/<key>/?runtime=1&…`.
  - Live: adds `ie_authoring=1`. The authoring mock allows forced outcomes (`…/authoring/force`).
- **Listing every game:**
  - The `games` table (`games.ts` `listGames()`).
  - `projects` (`accessibleProjectsWithClient`).
  - The R2 manifest `test_server/games.json`.

### 1.4 Asset tools (what the agents will drive)
- **Atlas Maker** (`services/atlas-tool/ui_server.py`, Python stdlib http.server):
  - Auth is a launcher-signed `iw_launch` token.
  - Regions live in `manifests/atlas_manifest_<name>.json`. Variants are
    `batch/<region>_<NNNNN>_.png`.
  - Routes:
    - `/render` queues a render.
    - `/save` picks a variant (`region.variant`).
    - `/createatlas` composes.
    - `/deployatlas` deploys.
    - `/progress` reports render state.
  - Packing: `pack.py` MaxRects with padding 2.
  - Machine writes use `_write_manifest_at` (CAS, rebase and retry).
- **Blueprints:** `_shared/blueprints/<id>/{blueprint.json,workflow.json}`. The id is the
  region's `pipeline` value.
- **ComfyUI:** the RunPod serverless endpoint.
  - `batch_atlas.runpod_submit` posts `/run`.
  - `_runpod_run_and_wait` polls `/status` every 2 s *inside the render subprocess*. There are
    no webhooks.
  - A lost still-image job is lost. Video (`video_runner.py`) has a queue, leases and
    `resume_orphans()`.
- **Symbols SM:** `SymbolsDoc` at `<C>/<P>/symbols/symbols.json`, via `/api/editor/symbols`.
- **Scene Editor:** `LayoutDoc` at `<C>/<P>/editor/scenes.json`.
  - Saved by the editor form action with `baseEtag`.
  - Read by `/api/editor/scenes`.
- **Win Text:** `WinTextDoc` at `<C>/<P>/win-text/win-text.json`, via `/api/win-text`.
- **Localization:** `LocalizationDoc` at `<C>/<P>/localization/strings.json`.
  - Translate goes through `translate.ts`.
  - Only reviewed lines ship.
- **Font Maker:** `FontCatalog` at `<C>/<P>/fonts/fonts.json`, via `/api/fonts/*`.
- **Concurrency** (`docs/design/multi-user-concurrency.md`):
  - Every write is conditional: `r2.ts` `PutPrecondition` with `baseEtag`, returning 409 on
    conflict.
  - Leases are advisory (`/api/lease`, `doc_leases`).
  - Python writers use `iw_common/storage.py` and `docsave.py`.

### 1.5 AI providers, costs, settings
- **Anthropic in the launcher:** `@anthropic-ai/sdk` ^0.128 is already a dependency.
  - `translate.ts` uses `claude-sonnet-4-6` with `ENV.ANTHROPIC_API_KEY` (`L/src/lib/server/env.ts`).
  - It has no explicit retries (SDK default) and no per-call cost tracking.
- **Costs:** `L/src/lib/server/costs/`.
  - `ProviderId = runpod|railway|r2|anthropic|openai`.
  - `getCosts()` caches for 10 minutes and runs collectors under `Promise.allSettled`.
  - `costs/anthropic.ts` reads the **org-wide** `cost_report` with `ANTHROPIC_ADMIN_API_KEY`.
  - Months live in `cost_months` (`months.ts`, `recorder.ts` every 3 h).
  - No per-run or per-agent ledger exists.
- **Settings:** the `app_settings` key/value table (`appSettings.ts`).
  - The pattern to copy is `getRunpodIdleConfig()` plus the `setRunpodIdle` action plus a card.

### 1.6 Jobs, deploy, tests
- **Jobs:** no queue or worker exists.
  - Bulk republish (`publishAllJob.ts`) runs in-process and in memory, so it is lost on restart.
  - Watchdogs use `setInterval`.
  - Migrations run at boot (`hooks.server.ts`).
- **Railway** (`docs/INFRA.md`):
  - `launcher` (app.invisiblewall.org, Postgres).
  - `atlas-tool`.
  - `sheet-tool`.
  - `Invisible-test-Server` (games.invisiblewall.org).
  - All auto-deploy from `main`.
- **DB migrations:** Drizzle. `pnpm --filter launcher-api db:generate` writes `L/drizzle/00NN_*.sql`,
  which is applied at boot.
- **Tests:**
  - No vitest. Node/tsx fixture gates are discovered by `scripts/check-all.mjs`.
  - Launcher `check:*` scripts.
  - Python plain-script tests run by `scripts/check-python.py`.
  - CI: `.github/workflows/lint.yml`, `checks.yml` and `svelte-check.yml` (a ratchet against
    `svelte-check-baseline.json`).
  - **No screenshot or visual-diff tooling exists.**
  - A headless Playwright shell exists (`scripts/playtest/headless-shell.mjs`).
  - Deterministic mocks: `scripts/mock-rgs-server.mjs` (`SEED`, `FORCE_TRIGGER`, …) and the
    authoring force channel.

## 2. Proposed shape (pending ADR approval)

```
 Browser (launcher pages, full width, ToolTopBar)
   /director  /director/[runId]          /pipeline
        │  form actions + SSE                │
        ▼                                    ▼
 launcher-api (SvelteKit)  ── Postgres: director_runs, director_events, director_spend,
        │                                    pipeline_changes, pipeline_checks, pipeline_merges
        │  enqueue / signal (DB rows)        │  GitHub REST (branches, PRs, revert)
        ▼                                    ▼
 director-worker (new Railway service, Node)   GitHub Actions: pipeline tests +
   Anthropic SDK tool runner (ADR-0001)        current-games harness (ADR-0004)
   adapters (ADR-0002) ──► launcher /api/director/adapter/* (service token)
                           ──► atlas-tool HTTP (launch token)
   GPU jobs: submit → persist job id → resume on completion event (no LLM polling)
```

- **Runtime agents** are markdown with YAML frontmatter in
  `services/director-worker/agents/*.md`. Changing one is a pipeline change: a branch, then an
  evaluation, then a merge.
- **Every adapter write** goes through the existing conditional-write paths, as the agent's
  service identity, and is stamped `saved_by.tool = 'director'`.
- **Locked items** are enforced in the adapter layer. No adapter can write
  `config/config.json`, publish, change roles or merge.

## 3. Approved decisions

None yet. Every ADR in `DECISIONS/` is `proposed`.
