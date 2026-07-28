# Launcher / Studio platform — status

> Design: [unified-project-repo](../design/unified-project-repo.md) · [r2-client-isolation-and-scaffold](../design/r2-client-isolation-and-scaffold.md) · [project-explicit-tool-scoping](../design/project-explicit-tool-scoping.md) · [unified-tool-bar](../design/unified-tool-bar.md) · Guide: [tools/launcher.md](../tools/launcher.md) (portal) · [tools/invisible-launcher.md](../tools/invisible-launcher.md) (desktop) · Agent: `.claude/agents/launcher-studio.md`

**One-line state:** Shipped and live at **app.invisiblewall.org** — the SvelteKit (adapter-node) portal that every Invisible tool is reached through; auth, sessions, roles, admin, and the client→project model all work.

## Current state
The **portal** (`apps/launcher-api`) on Railway project "Invisible launcher" + Postgres:

- **Auth / sessions** — invite-only email+password (scrypt), server-side sessions in Postgres/Drizzle, "remember me" (`REMEMBER_TTL_DAYS` vs `SESSION_TTL_HOURS`). Not signed in → `/login`.
- **Roles + tool matrix** — three-layer entitlement: `TOOLS`/`ROLE_TOOLS` registry (`src/lib/roles.ts`) → editable role→tool matrix → per-user overrides. Managed capabilities gate sensitive actions (`gamePublish` for the deploy token, `fontPublish`/`blueprintPublish` for shared-library writes).
- **Admin panel** — `/admin`, tabbed + full-bleed: users, roles, tools, projects, clients, games, sessions, plus **Settings → Deploy token** (view masked / reveal once / set / rotate). Login expiry configurable.
- **Client → project hierarchy** — accounts get scoped project access; R2 is **isolated per `<client>/<project>/`** (one unified single-project repo shared by all tools — the old per-`<tool>/` namespaces were retired 2026-06-02). Home game cards are scoped to the active project (`games.project_key`; null = global).
- **Tool pages** — full-page, never iframes: each route (`/atlas`, `/spine`, `/sheet`, `/editor`, `/rigger`, `/localization`, `/fonts`, `/files`, `/storybook`) runs an auth+role gate then serves in-launcher or `throw redirect(303,…)`. Shared `$lib/ToolTopBar.svelte` (`.iw-toolbar`) owns the chrome (see unified-tool-bar).
- **Tool registry + docs** — `roles.ts` is the single registry; the launcher **serves the guides** at authed `/docs/[slug]` (rendered from `docs/tools/*.md`), and `/onboarding` links to them. CLAUDE.md rule #9 keeps a new/renamed tool from shipping doc-less.
- **Download links / install paths** — desktop **Invisible Launcher** (`.exe`, separate `invisible-launcher` repo) served over open routes `/api/launcher/download` + `/api/launcher/latest` (no session — the desktop app has none); it self-updates via the manifest. Also `/api/launcher/projects` (session-scoped project sync) + `/api/launcher/deploy-token` (`gamePublish`-gated).
- **DB migrations** — on-boot migrator with the prod-safety discipline: **`db:push` is BANNED on prod** (use `db:generate` + the migrator); `reconcilePushProvisioned` replays every journal migration tolerating duplicate-object errors so a push-provisioned DB reconciles with no baseline overshoot.
- **UI** — full-bleed home: online tools grouped into **game-making stage sections** (Create / Assets / Build / Files & Reference) plus Games and Local tools, Invisible Wall emblem branding, DNS-only (grey-cloud) CNAME to Railway (proxying breaks Railway TLS). Stages are the single source `TOOL_STAGES` in `roles.ts`; the top-bar switcher tints each tool icon by its stage accent (see unified-tool-bar).

## Open items / next
1. **Onboarding** is a basic first version — a fuller per-role walkthrough is planned (backlog B6).
2. **Local-tool install paths not persisted** (backlog B5) — local tool cards describe the tool but per-user install paths / download bookmarks aren't stored yet.
3. **Refactor debt** — the gate + "resolve active (client,project)" prelude is copy-pasted across ~9 routes and there are two divergent `allowedPrefixes()` kept in lockstep by hand; per-request DB fan-out (~4 sequential queries, resolved twice per navigation) is a known perf cost.
4. **Grant `gamePublish`** to any non-admin publishers (owner) now that the deploy token is capability-gated.

## Blocked (owner / external)
- **Security rotation (owner, Railway/CF):** rotate the shared R2 token (read+write whole bucket, used by 4 services), Postgres password, and CF Access service-token secret; rotate `EDITOR_DOC_SECRET` (deploy token — was plaintext in local config / screenshot-exposed). See `docs/INFRA.md` "Security / secret rotation".
- Env vars the portal degrades gracefully without until set: `ANTHROPIC_API_KEY` (Localization Translate), `GAMES_BASE_URL` (legacy home Games bridge), `GITHUB_ENGINE_READ_TOKEN` (engine "release pending" pill — absent ⇒ the pill never shows pending), tool URLs/secrets (`SHEET_TOOL_URL`, `ATLAS_TOOL_SECRET`, …).

## Key lessons / gotchas
- **Never `db:push` on prod** — it replays from 0000 on an empty `__drizzle_migrations` (500s) and reports spurious PK-recreate drift; baseline/reconcile instead. (`gotcha_drizzle_automigrate_baseline`)
- The **desktop launcher self-updates only as the frozen `.exe`** via the Update button; a source `.py` copy never updates. (`gotcha_launcher_source_copy_never_updates`, `reference_launcher_release`)
- More done-work detail (B12/B16/B17/B22, admin panel, per-client R2 isolation, role→tool matrix, Railway consolidation) is archived in [../history.md](../history.md).

## Recent changes
- 2026-07-28 — **Tool-bar responsiveness + icon drift fixed across the four HTML twins** (rigger/spine static `view.html`, atlas `ui_server.py`, sheet `ui.html`). (1) Each twin's hand-copied `ICON` map had drifted — six online tools (gameMaker, gameConfig, flow, fx, flipbook, winText) plus rigger/symbols on the non-rigger twins rendered icon-less; all 17 online tools are now covered. (2) The twins collapsed labels only at a blunt `@media (max-width:1100px)` *viewport* breakpoint, so with the full switcher the labelled row overflowed its real track and `overflow:hidden` **silently clipped** the rightmost tools. Replaced with the measured ResizeObserver collapse from `$lib/ToolTopBar.svelte` (icon-only exactly when the labelled row overflows the bar's own width, with re-expand hysteresis) + `overflow-x:auto` on `.compact` so an over-full icon-only row scrolls instead of clipping. Added the same scroll fallback to `ToolTopBar.svelte`. New guard `scripts/check-toolbar-icons.mjs` asserts every twin covers every online tool (run it to prevent re-drift). **Live tools need a redeploy** (launcher for the static twins; atlas + sheet Railway services for the Python twins).
- 2026-07-27 — Engine deploy pill gained a **"release pending" (C2)** state: `$lib/server/engineSource.ts#enginePending` compares the live runtime bundle's stamped commit against engine `main` (GitHub compare API, path-filtered to `apps/lines/`+`packages/`, cached ~60s, 4s timeout), merged into `EngineDeployStatus` by the `(app)` layout load. Distinct non-pulsing amber pill (`.engine-pending`). Gated on `GITHUB_ENGINE_READ_TOKEN` (falls back to `GIT_CLONE_TOKEN`); absent ⇒ identical to before (green, never "pending").
- 2026-07-27 — Online tools grouped by game-making **stage** (`TOOL_STAGES` in `roles.ts`, single source; `TOOL_BAR_ORDER` derived from it): home grid renders one colour-accented section per stage; top-bar switcher tints each icon by stage. The `tools=` payload now bakes a per-tool `accent`, so the four HTML twins (atlas/sheet/rigger/spine) tint their icons to match. (The twins' `TOOL_ICONS` mirrors were completed 2026-07-28 — see below.)
- 2026-06-20 — Prod `app_settings` created + migrator hardened (`reconcilePushProvisioned` replaces baseline-overshoot). ([history](../history.md))
- 2026-06-14 — Launcher now serves the tool guides at `/docs/[slug]`; onboarding links fixed; CLAUDE rule #9 institutionalized. ([history](../history.md))
- 2026-06-12 — Deploy token moved to admin-managed `app_settings` + `gamePublish`-gated route. ([history](../history.md))
- 2026-06-11 — Desktop launcher pulls accessible projects from the cloud (`/api/launcher/projects`), grouped by client. ([history](../history.md))
- 2026-06-02 — R2 unified single-project repo (`<client>/<project>/`); per-client isolation, per-tool namespaces retired. ([history](../history.md))
