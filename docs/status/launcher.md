# Launcher / Studio platform — status

> Design: [unified-project-repo](../design/unified-project-repo.md) · [r2-client-isolation-and-scaffold](../design/r2-client-isolation-and-scaffold.md) · [project-explicit-tool-scoping](../design/project-explicit-tool-scoping.md) · [unified-tool-bar](../design/unified-tool-bar.md) · [multi-user-concurrency](../design/multi-user-concurrency.md) · Guide: [tools/launcher.md](../tools/launcher.md) (portal) · [tools/invisible-launcher.md](../tools/invisible-launcher.md) (desktop) · Agent: `.claude/agents/launcher-studio.md`

**One-line state:** Shipped and live at **app.invisiblewall.org** — the portal every Invisible tool
is reached through, with auth, roles, admin and the client → project model all working. Desktop
publishing goes through the portal (no R2 key on any publisher's machine), and players boot
published snapshots.

## Current state
The **portal** (`apps/launcher-api`) runs as the `launcher` service on Railway, with Postgres
(`docs/INFRA.md`):

- **Auth / sessions** — invite-only email+password (scrypt), server-side sessions in Postgres/Drizzle, "remember me" (`REMEMBER_TTL_DAYS` vs `SESSION_TTL_HOURS`). Not signed in → `/login`. Users change their own password at `/account/password` (header link); a new password — self-service or admin create/reset — needs 12+ characters (`$lib/passwordPolicy.ts`), never checked at sign-in.
- **Roles + tool matrix** — seven roles (admin, developer, artist, animator, pipelineTester, localizationReviewer, audio; labels in `ROLE_LABELS`). Three-layer entitlement: `TOOLS`/`ROLE_TOOLS` registry (`src/lib/roles.ts`) → editable role→tool matrix → per-user overrides. Managed capabilities gate sensitive actions (`gamePublish` for every publish path, `fontPublish`/`blueprintPublish` for shared-library writes, `pipelineMerge` for Pipeline Changes merges, `adminPanel`).
- **Access scoping** — ONE gate for tool APIs, `$lib/server/toolScope.ts`: `gate()` (auth + tool + the session's project, re-checked every request), `requireProjectScope` for APIs that name a project, and the single `allowedPrefixes()`. Desktop-facing routes go through `$lib/server/launcherAuth.ts`. Pinned in CI by `check:launcher-gates`, `check:project-scope`, `check:lease-scope`, `check:change-password`, `check:deploy-read`.
- **Admin panel** — `/admin`, tabbed + full-bleed: users, roles, tools, projects, clients, games, sessions, **costs**, plus **Settings** (deploy token, engine boot mark, ComfyUI pod fleet, …). Login expiry configurable.
- **Costs** — `/admin` → Costs reads RunPod, Railway, Cloudflare R2 and whichever LLM provider Localization bills at, cached 10 min, with euro figures at the ECB rate and a monthly history per calendar year. See [tools/launcher.md](../tools/launcher.md) §Admin → Costs.
- **Client → project hierarchy** — accounts get scoped project access; R2 is **isolated per `<client>/<project>/`** (one unified repo per project shared by all tools). Home game cards are scoped to the active project (`games.project_key`; null = global). Projects soft-delete (restore / purge from /admin).
- **Tool pages** — full-page, never iframes: each route runs an auth+role gate then renders in the launcher or `throw redirect(303,…)` (atlas/sheet with a signed launch token; spine/rigger to a static `view.html`). Shared `$lib/ToolTopBar.svelte` (`.iw-toolbar`) owns the chrome (see unified-tool-bar).
- **Loading screens** — ONE boot experience across stacks: the CRT boot splash (`$lib/BootSplash.svelte` · `static/shared/boot-splash.js` · `iw_common/splash.py`) covers a tool that is still opening; the dimmed overlay + card (`$lib/BusyOverlay.svelte`) covers loading INSIDE an open tool. See `docs/ui-inventory.md` §12.
- **Tool registry + docs** — `roles.ts` is the single registry; the launcher **serves the guides** at authed `/docs/[slug]` (rendered from `docs/tools/*.md`). `/onboarding` walks each role through its tools with a guide link per tool and saves each user's local-tool install paths (`tool_installs`). CLAUDE.md rule 9 keeps a new/renamed tool from shipping doc-less.
- **Desktop launcher support** — the `.exe` (separate `invisible-launcher` repo) is served over open routes `/api/launcher/download` + `/api/launcher/latest`; it self-updates via the manifest. `/api/launcher/projects` (session-scoped project sync, with a **derived** build profile from the project's game kind when none is stored — `launcherProfile.ts`, `mockProtocol.ts`), `/api/launcher/game-upload` (the publish relay), `register-game`, `deploy-token` and `git-credentials` (`gamePublish`-gated).
- **Saving together** — every authoring tool saves through `$lib/saveState.svelte.ts` with R2 conditional writes, holds a soft lease (`/api/lease`, `doc_leases`) with a presence banner, and keeps rolling backups of its whole-doc saves (`docBackups.ts`).
- **DB migrations** — applied by the launcher at boot (`init` hook → `runMigrations()`); all 20 (`0000`–`0019`) are live and `/api/health` reports `schema: current`. **`db:push` is banned on prod** — `db:generate` + the boot migrator.
- **UI** — full-bleed home: online tools grouped into **game-making stage sections** (Create / Assets / Build / Files & Reference / Pipeline) plus Games and Local tools, Invisible Wall emblem branding. Stages are the single source `TOOL_STAGES` in `roles.ts`; the top-bar switcher tints each tool icon by its stage accent.

## Open items / next
1. **Grant `gamePublish`** to the non-admin publishers (owner) — `developer` and `pipelineTester` are the roles that can open Game Maker at all. Every publish endpoint reads the capability (2026-09-18); the grant itself is owed in /admin → Roles. It also opens the desktop Sync's zero-login clone (`git-credentials`).
2. **Hand-rolled `.modal-backdrop` divs still to migrate** (`docs/ui-inventory.md` §17) — 3 in `game-maker`, 1 in `config`, 1 (`.lp-modal-backdrop`) in `editor`. These are rich panels rather than questions, so they want `<ConfirmDialog>`'s `body` snippet, not the promise helpers.
3. **Orphaned R2 prefixes with no project row** — `invisible_wall/test7/` (179 objects, 204 MB) and `invisible_wall/waysonwavesbuild/` (1,169 objects, 165 MB, a byte-identical clone of the Hot Fruits atlas seed). Purge needs a project row to purge FROM — an admin-side "orphan prefix" sweep is the missing piece.
4. **`canAccessProject` is paid per request on three hot paths.** `requireProjectScope` costs four
   queries (`listProjects` + two grant reads inside `canAccessProject`, then `projectClientKey`).
   `/api/sounds/file` GET pays it on every audio range request, and `/api/lease` pays the same four
   on every 10 s heartbeat of every open tool tab. `sessionProjectScope` pays `canAccessProject` on
   every `gate()`d request while the session sits on a non-default project (+2 queries for a
   non-admin, +3 on an unassigned project; the default skips it), including the editor's per-image
   `/api/editor/asset` and `/regions` streams. `canAccessProject` already holds the project row, so
   returning its client would drop one; a single keyed query (the live project row plus the two
   grant `EXISTS`) would make it about one.
5. **Owed browser checks:** a two-profile restore-from-a-stale-tab test of the doc backups (expect
   409); the signed-in refusals of the 2026-09-28 access pass (a non-admin `adminPanel` holder, a
   user without a client grant, a role without a lease's tool) — pinned offline, not yet clicked
   through with non-admin test accounts.

## Blocked (owner / external)
- **Secret rotation (owner):** rotate the secrets in `docs/INFRA.md` "Security / secret rotation";
  since desktop launcher v1.0.56 the R2 key no longer lives on any publisher's desktop.
- Env vars the portal degrades gracefully without until set: `ANTHROPIC_API_KEY` *or* `LOCALIZATION_LLM_BASE_URL` + `LOCALIZATION_LLM_API_KEY` (Localization Translate — either provider), `GITHUB_ENGINE_READ_TOKEN` (engine "release pending" pill — absent ⇒ the pill never shows pending).

## Key lessons / gotchas
- **Never `db:push` on prod** — it records nothing in `__drizzle_migrations`, so the boot migrator replays from 0000 (500s). Generate a migration instead.
- **`build` is not a type-check** — a type error ships green; prefer designs a missing type can't break and verify contracts in a Node fixture over the real modules (`apps/launcher-api/CLAUDE.md`).
- The **desktop launcher self-updates only as the frozen `.exe`** via the Update button; a source `.py` copy never updates.
- Done-work detail before 2026-09-08 (admin panel, per-client R2 isolation, role→tool matrix, Railway consolidation, concurrency phases 0–2, boot splash, costs) is in [../history.md](../history.md) and the git log.

## Recent changes

- 2026-10-04 — **Invisible Director + Invisible Pipeline Changes registered** (Director Phase 1,
  tasks 1.7–1.10). `director` (Create, after Game Config) and `pipelineChanges` (a new **Pipeline**
  stage, accent `#f778ba`) are in `TOOLS`, with icons in `TOOL_ICONS` and the four toolbar twins.
  Defaults: Director is Admin only; Pipeline Changes is Admin plus Pipeline Tester. A new
  capability, `pipelineMerge` ("Merge pipeline changes"), is Admin only. `/director` and
  `/pipeline` are early-access empty pages behind the parent-manifest 403. A new `ToolDef.isNew`
  flag puts a "new" tag on the home card and the Admin › Roles row, and `CAPABILITIES` entries
  take the same flag. Drop it once Director ships its Phase 4 screens. Fixture:
  `check:director-access`. Guides: `tools/director.md`, `tools/pipeline-changes.md`.
- 2026-10-04 — **`GET /api/pipeline/games`, the current-games harness's game list** (Director
  Phase 1, task 1.1; ADR-0004). Read-only, gated by the bearer `PIPELINE_CI_TOKEN` alone (constant-
  time compare; no session ever stands in; unset → 503). Returns every `listGames()` row whose
  project is live (soft-deleted projects' games dropped, global games kept with null project
  fields): key, name, project/client/game type, version, builtAt, the published pointer key
  (`publishedPointerKey` in `projectPaths.ts`, now also used by `publishedRuntime.ts`) and
  `hasOwnBuiltBundle`. Fixture: `check:pipeline-games`; `check:launcher-gates` pins the gate.
- 2026-10-03 — **The home Project selector can no longer disagree with the session.** Owner report
  after duplicating Book of Borut: the copy was missing from the dropdown, the dropdown showed
  BookOfBorutRemake, and the Scene Editor opened `borut-pots-sample`. Cause: the session is
  shared by every tab and moves without this tab knowing (Game Maker Publish pins the project
  it published; a `?project=` tool launch syncs it). A home tab loaded before the Duplicate kept
  its old list and selection, and the tool cards (no `?project=`) opened the session's project.
  Picking the original did nothing, because the original was the option already selected, so
  no `change` fired. Two fixes in `(app)/+page.svelte`:
  - The home page re-runs its loads (`invalidateAll`, at most once per 2s) on `visibilitychange`
    to visible and on window `focus`. Only the home page: a tool page must not switch project
    under an open document.
  - Every online tool card links `?project=<the selected project>`, so a tool opens the project
    the dropdown shows. This also covers clicking a card in a side-by-side window before the
    reload lands. Routes without `resolveToolScope` (`/files`, `/rigger`, `/spine`, `/comfyui`,
    `/storybook`, `/game-maker`) ignore the param, as before.
  - Guide: [tools/launcher.md § Choosing a project](../tools/launcher.md#choosing-a-project).
    The Duplicate naming half of the report is in [game-maker.md](game-maker.md).
- 2026-10-02 — **`/admin` → promote spine no longer copies the bundle's `source.json`** into `_shared/spines/`, so a shared bundle is a real snapshot (the sidecar let a re-pack in the authoring project rewrite it). Detail: [editor status](editor.md).
- 2026-09-30 — **Build uploads client source maps to Sentry when `SENTRY_AUTH_TOKEN` is set** (`vite.config.js` hidden maps → `build` script runs `scripts/sentry-sourcemaps.mjs launcher build`: inject debug IDs, upload for `RAILWAY_GIT_COMMIT_SHA`, delete every `.map`, fail if one is left in `client/_app`). Without the token the build is unchanged. Owner steps: docs/INFRA.md "Readable stack traces — source maps".

### 2026-10-01 — self-service password change; 12-character minimum
- **`/account/password`** (an `(app)` page, not a tool — no registry entry; linked as *Change
  password* in the home header beside *Getting started* / *Sign out*). Current + new + confirm,
  plain form action. The new password is validated first (`passwordChangeProblem` in
  `$lib/passwordPolicy.ts`: confirm matches, 12+ characters, not the current one, not the email),
  so a typo costs no throttle attempt. Then the login throttle (`checkLoginThrottle` on the IP +
  email → 429), `verifyCredentials` (uniform timing) with ONE message for every failure, recorded
  with `recordLoginFailure`. On success: `recordLoginSuccess`, re-hash, and every OTHER session of
  the user is revoked; the caller's stays. Core in `$lib/server/changePassword.ts`.
- **`revokeUserSessions` moved from `$lib/server/admin.ts` to `$lib/server/auth.ts`** — the admin
  reset and the self-service change share it.
- **Admin create + reset use `MIN_PASSWORD_LENGTH` (12)** instead of a local 8, with `minlength` and
  a hint on both inputs. Existing shorter passwords keep working — sign-in never checks length, and
  nothing forces a reset.
- **`check:change-password`** (51 checks, in CI's launcher-gates step) runs the real route action
  over an in-memory users + sessions store that evaluates the shipped Drizzle conditions through
  Drizzle's own Postgres dialect: signed-out redirect, policy (11 refused / 12 accepted, mismatch,
  equals-current, equals-email) with no throttle attempt consumed, lockout → 429 with no verify,
  wrong/expired current → the same message + a recorded failure, success → other sessions gone,
  this one and another user's kept. 14 planted mutants all killed. `check:launcher-gates` also pins
  that admin create/reset call `passwordLengthProblem` and that sign-in never imports the policy.

### 2026-09-30 — FX, Flipbook and Symbols ask before discarding unsaved work
- **The last three manual-Save tools now call `guardUnsavedWork`.** `/fx` and `/flipbook` dropped
  their own `beforeunload` listener (which covered only a real unload) for the shared guard, so a
  tool-bar switch or Back now asks too; `/symbols` had no guard at all and now has both. The
  launcher guide's "tool-bar switch loses unsaved work" Trap is gone — every tool with a manual
  Save and a dirty state now asks.
- **A backup restore no longer asks twice.** `/symbols` and `/config` restore a version then
  `location.reload()`; with unsaved edits, the guard's `beforeunload` would raise the browser's
  "Leave site?" over a restore the server had already applied (cancelling it left a pre-restore doc on a
  stale ETag). The history dialog already warns that restoring discards unsaved edits, so both
  now mark the doc settled before reloading.

### 2026-09-30 — Leftovers from the docs drift sweep (#872)
- **Invisible Launcher onboarding steps** now describe its real job — sign in, ↻ Sync,
  ☁ Publish / 📦 Deliver — with ComfyUI + tunnel marked optional (`roles.ts` `install.steps`).
- **`/comfyui`'s "keep a pack" note** points at Custom nodes (`nodes.json`) instead of hand-editing
  the pod Dockerfile.
- **`pnpm check:toolbar-icons` runs in CI** (Lint → launcher gates); it had only ever been run by
  hand.
- `scripts/bump-game-engine.mjs` deleted — a game repo's engine submodule is never bumped by hand;
  desktop builds advance it. Stale comments fixed in `ktx2Encode.ts` (mipmaps are off) and
  `flipbookExport.ts` / `bake-editor-doc.mjs` (clips ARE reachability-pruned).

### 2026-09-30 — /admin's cache hint no longer says `games` is behind Cloudflare
- **The "Edge cache & build" card now matches INFRA's "Game freshness".** `games` is DNS-only like
  `app.`, so a zone purge drops nothing for either. For a stale game the hint says to reload with
  `?cb=` and then check `lastHydrate` on the games host's `/healthz`.
- **`verify-runtime-live.mjs` gives the real reason** it never fetches the bare bundle URL: an early
  404 has no cache headers, so a browser or proxy may keep it. There is no edge to hold it.

### 2026-09-29 — Game Config, Win Text and Localization ask before discarding unsaved work
- **Wired the existing guard into the three pages** that tracked a dirty state but registered
  none (`/config`, `/win-text`, `/localization`): a tool-bar switch, Back, a reload or a tab close
  no longer discards unsaved edits without asking.
- **`guardUnsavedWork` now owns both exits.** It registers the `beforeNavigate` guard (in-app
  navigation — `beforeunload` never fires for one) AND the `beforeunload` listener (a real unload —
  `beforeNavigate` cannot hold one), both keyed on the same `cost()`. Sound and the Component
  Editor dropped their own copies of that listener; their behaviour is unchanged.
- **Still exposed:** FX and Flipbook guard only a real unload, Symbols guards nothing — see the
  launcher guide's Traps.

### 2026-09-29 — docs caught up with the code
Open items for onboarding (it is a per-role walkthrough with guide links), local-tool install
paths (persisted in `tool_installs`), the one `allowedPrefixes()` and the 0019 migration (live —
`schema: current`) were already done and are closed. The portal guide now lists Sound for artist,
pipelineTester and audio, says `build` is not a type-check, and points at INFRA for env vars; the
desktop launcher's registry description names publishing; this file's Recent changes were pruned
to 2026-09-08 onward.

### 2026-09-29 — desktop publishing needs no R2 key; builds say which build they are (#866)
With desktop launcher v1.0.56 (`invisible-launcher` repo).
- **☁ Publish goes through the relay by default** (`api/launcher/game-upload`) as the signed-in
  `gamePublish` user, with no R2 credentials. Direct-to-R2 is an owner opt-in and falls back to the
  relay when R2 is unreachable or rejects the saved key — so the bucket's write key can be rotated
  without touching a desktop.
- **Sized against real bundles** (87–390 MB, largest file 30.6 MB): each file is its own PUT, so
  the only real limit is per file — adapter-node's `BODY_SIZE_LIMIT` (code default 32M). Presigned
  URLs were not needed, and would point at the R2 host the Spanish ISP block null-routes.
- **Relay GET** reports the limit actually enforced, `min(64 MB cap, BODY_SIZE_LIMIT)`, and with
  `?key=` lists `{path, size, md5}` of the game's prefix so a republish skips unchanged files.
- **Provenance:** `packages/config-vite/provenance.js` → `buildProvenance()` (version, builtAt,
  `engineSha` compiled, `gameSha`, `lockfileSha256`, `launcherVersion`), baked into
  `window.__IE_BUILD__` and written as `build-info.json` beside the bundle (and into `EMBED.md` §5).
- **Refusals as data:** `bake-editor-doc.mjs` and `build-delivery.mjs --json` emit the flow,
  paytable and missing-art refusals as `{gate, error, details, override}`; the launcher shows the
  reason and offers the named override behind an explicit confirmation. Checks:
  `check:game-bundle-relay` (39), `check:build-provenance` (23). Runbook:
  [guides/publisher-runbook.md](../guides/publisher-runbook.md).

### 2026-09-29 — rolling backups for every whole-doc save (#847, #857)
- `docBackups.ts` `putDocWithBackup(target, text, baseEtag, mode)` owns copy-before-PUT and
  prune-after-PUT for scenes, Flow v2, Symbols, Game Config and component defaults
  (`editor/<project>/component-defaults-backups/<slug(id)>/`). A save that will 409 takes no
  backup; a force save always backs up; a duplicated project starts its own history; only an
  `'auto'` copy opens the 5-minute coalescing window (a restore of the oldest backup no longer
  loses it on the next autosave).
- History endpoints: `/api/flow-v2/backups`, `/api/editor/symbols/backups`,
  `/api/game-config/backups`, `/api/editor/component-defaults/backups` (each behind its route's own
  gate + project scope). `check:doc-backups` (184). Live (#847): the routes answer and a flow
  History → Restore was clicked through on `test2`. Owed: open item 5.

### 2026-09-29 — error reporting + a real `/api/health` (#852)
- `/api/health` is readiness: 200 only when Postgres answers (3 s) and the migrations journal
  reaches the newest migration the build ships; 503 names the state only. A failed boot migration
  is reported to Sentry and turns it red.
- Sentry, dormant until DSNs are set: server `handleError` + `init` (`SENTRY_DSN`), browser
  `hooks.client.ts` (`PUBLIC_SENTRY_DSN`); no query values, cookies, headers or user are sent.

### 2026-09-29 — published runtime snapshots (Game Maker) (#841)
- Players boot an immutable snapshot Publish writes to R2 `<client>/<project>/published/`; new routes
  `/api/published/f/<token>/<project>/<id>/…` (immutable asset serving, streamed) and
  `POST /api/game-maker/rollback`; `/api/editor/runtime` picks snapshot vs live by `authoring=1`.
  Every `deploy/` writer runs under `runtimeBundleCache.withDeployWrite` (per-project mutex + a
  launcher-wide cap of 2 assembles). Detail in [game-maker.md](game-maker.md).

### 2026-09-28 — asset-pipeline gaps: symbol spines, sounds prune, boot splash in the bake
- Stranded symbol spines are reported (`SymbolExportIndex.spinesMissing`) at bake, publish and
  boot, and the online publish now shows the author a ⚠ note (`PublishResult.spinesMissing`).
- `POST /api/editor/export-boot` (deploy-token gate) exports the boot splash, and
  `bake-editor-doc.mjs` calls it before the pull, so desktop/delivery builds ship the current one.
- `pull-project-assets.mjs` prunes `sounds/` — detail in [sound.md](sound.md).

### 2026-09-28 — access checks consolidated and tightened (#811, #812, #814, #818, #826, #827)
One pass over every launcher route that decided access from a login alone or from something the
request named. What exists now:
- **`requireProjectScope(user, project)`** (`toolScope.ts`) on every session-gated authoring API
  that takes a project; refusal is a 403, unknown keys included. Component routes use
  `requireOptionalProjectKey`. Publish (`game-maker/publish`, `register-game`) requires
  `canAccessProject`.
- **`sessionProjectScope`** re-checks the session's stored project on every `gate()` and
  `resolveToolScope` read, and clears it (compare-and-clear) once access is gone; save actions
  scope through `resolveActionScope` and never fall back from a named project.
- **`/api/lease`** requires access to the project, the project's own client, and the tool the lease
  is for; `/api/deploy/f/…` serves from the project's DB client; `partner-session` mints only for a
  card the caller could see; `git-credentials` is `gamePublish`-gated; creating/duplicating under a
  client needs that client; `adminPanel` holders who are not admins cannot act on admin accounts;
  a password reset signs the user out everywhere; the DB browser masks `app_settings` values not on
  an allow-list.
- **Served R2 content** (`/api/editor/asset`, `/api/fonts/asset`, `/spine/file`,
  `/api/files/download`) takes its headers from `$lib/server/userContent.ts` (extension allow-list,
  `nosniff`, sandbox CSP, attachment for HTML/SVG/XML); baseline security headers on every dynamic
  response in `hooks.server.ts`; `ADDRESS_HEADER`/`XFF_DEPTH` default in `scripts/start.mjs`; login
  timing is uniform.
- The pure decisions live in `$lib/accessRules.ts`; `check:launcher-gates` (292),
  `check:project-scope` (41), `check:lease-scope` (26) and `check:deploy-read` (30) run in CI and
  each was mutation-tested. Verified live on each deploy that every touched route still boots and
  refuses a signed-out caller; the signed-in refusals are open item 5.

### 2026-09-18 — publish capability, native pop-ups, spine guard
- **`gamePublish` now actually lets someone publish.** `game-maker/publish` + `publish-all` checked
  `adminPanel`, and `register-game`, `game-upload` and `projects` (POST) compared a literal `'admin'`
  role; all now read `GAME_PUBLISH_CAPABILITY` through `$lib/server/launcherAuth.ts`
  (`requireLauncherAdmin` / `requireLauncherPublisher`), which replaced six copies of the bearer
  parser. `tunnel-bundle`, `models-manifest` and `comfyui-nodes` stay owner-only by design.
- **No native browser pop-ups remain** (46 calls in 11 files): `src/lib/dialogs.svelte.ts`
  (`askConfirm` / `askMessage` / `askText`, one `<DialogHost>` in the layout, FIFO). The
  `beforeNavigate` unsaved-work guards go through `src/lib/unsavedGuard.ts`, which **cancels first
  and re-issues on confirm** (`history.go(delta)` for Back/Forward). `check:native-dialogs` fails on
  a re-introduced call. Out of scope: `static/rigger/cinematic.js` (6 calls, vanilla JS).
- **A spine the build could not resolve no longer ships in silence.** `EditorArtIndex.spinesMissing`
  collects every placed spine whose bundle prefix resolved to nothing; the bake, the online publish
  and game boot all report it (`$lib/spineBundleKey.ts`, `check:spine-bundle-key`). A bundle NAME
  from a `spine`-kind param is still unguarded.
- Desktop launcher v1.0.54–1.0.55: **📦 Deliver** (a partner-hosted build with ▶ Play it) and a
  publish that backfills engine packages a game repo's `package.json` predates — see
  [tools/invisible-launcher](../tools/invisible-launcher.md) and
  [status/engine-history](engine-history.md) (2026-09-18).

### 2026-09-17 — publishing from a line that cannot reach R2
- **`POST`/`PUT /api/launcher/game-upload`** relays a built bundle through Railway into
  `test_server/<key>/`, verifying every file before it registers and carrying the project pin
  forward (`$lib/server/gameBundleRelay.ts`, `check:game-bundle-relay`). The online-runtime guard is
  ported and fails closed. `scripts/publish-game-via-portal.mjs` is its plain-node twin (resumable;
  pokes `/refresh` and waits for the new bundle). `BODY_SIZE_LIMIT` got its 32M code default.
- A desktop ☁ Publish now builds the latest engine, game layer included — game repos no longer
  carry `apps/lines/src` ([status/engine-history](engine-history.md), 2026-09-17).

### 2026-09-16 — Game Maker card: `shared runtime` chip + a protocol-drift warning
The card read "lines runtime" on every game (it's one shared bundle); it now reads
`shared runtime`, and an amber `protocolDrift` chip flags a published mock protocol that trails the
game kind (both read `mockProtocol.ts`). `gameProfileChips.fixture.ts`. Doc: `docs/tools/game-maker.md`.

### 2026-09-09 — project delete is a soft delete, purge is separate
`?/deleteProject` was one unguarded click. Now: `projects.deleted_at` (migration 0019) tombstones the
row — its `read_token` and client survive and **Restore** is one click, R2 untouched; games go with
the project. **Purge** is a separate action on an already-deleted project, needs the key typed,
erases both R2 roots (`<client>/<project>/`, `editor/<project>/`) and refuses on a slug collision
or on project data outside those roots. `ConfirmDialog.svelte` (native `<dialog>`, page inert while
busy) and a lazy `GET /api/admin/project-footprint` show the exact object count and bytes.
`projectPurge.fixture.ts` (13).

### 2026-09-08 — online projects buildable on the desktop
`GET /api/launcher/projects` derives a build profile from the project's game kind when none is
stored (flagged `derived: true`, so a local block wins), sends `gameType`, and accepts one on create
only; `protocolFor` moved to `mockProtocol.ts`. Desktop v1.0.44–1.0.45 added the read-only game-kind
row and **🏗 Scaffold** for a project that has no repo. `verify-launcher-profile.mts` (17).
