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
- **Costs** — `/admin` → Costs reads RunPod, Railway, Cloudflare R2 and whichever LLM provider Localization bills at, plus **Anthropic (agents)** (Invisible Director's spend, from the `director_spend` ledger), cached 10 min, with euro figures at the ECB rate and a monthly history per calendar year. See [tools/launcher.md](../tools/launcher.md) §Admin → Costs.
- **Client → project hierarchy** — accounts get scoped project access; R2 is **isolated per `<client>/<project>/`** (one unified repo per project shared by all tools). Home game cards are scoped to the active project (`games.project_key`; null = global). Projects soft-delete (restore / purge from /admin).
- **Tool pages** — full-page, never iframes: each route runs an auth+role gate then renders in the launcher or `throw redirect(303,…)` (atlas/sheet with a signed launch token; spine/rigger to a static `view.html`). Shared `$lib/ToolTopBar.svelte` (`.iw-toolbar`) owns the chrome (see unified-tool-bar).
- **Loading screens** — ONE boot experience across stacks: the CRT boot splash (`$lib/BootSplash.svelte` · `static/shared/boot-splash.js` · `iw_common/splash.py`) covers a tool that is still opening; the dimmed overlay + card (`$lib/BusyOverlay.svelte`) covers loading INSIDE an open tool. See `docs/ui-inventory.md` §12.
- **Tool registry + docs** — `roles.ts` is the single registry; the launcher **serves the guides** at authed `/docs/[slug]` (rendered from `docs/tools/*.md`). `/onboarding` walks each role through its tools with a guide link per tool and saves each user's local-tool install paths (`tool_installs`). CLAUDE.md rule 9 keeps a new/renamed tool from shipping doc-less.
- **Desktop launcher support** — the `.exe` (separate `invisible-launcher` repo) is served over open routes `/api/launcher/download` + `/api/launcher/latest`; it self-updates via the manifest. `/api/launcher/projects` (session-scoped project sync, with a **derived** build profile from the project's game kind when none is stored — `launcherProfile.ts`, `mockProtocol.ts`), `/api/launcher/game-upload` (the publish relay), `register-game`, `deploy-token` and `git-credentials` (`gamePublish`-gated).
- **Saving together** — every authoring tool saves through `$lib/saveState.svelte.ts` with R2 conditional writes, holds a soft lease (`/api/lease`, `doc_leases`) with a presence banner, and keeps rolling backups of its whole-doc saves (`docBackups.ts`).
- **DB migrations** — applied by the launcher at boot (`init` hook → `runMigrations()`); `0000`–`0028` are live, `0029_director_recipes` ships with Director card 8D, and `/api/health` reports `schema: current`. **`db:push` is banned on prod** — `db:generate` + the boot migrator.
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
6. **`<DataTable>` extraction** (`docs/ui-inventory.md` §2): the Pipeline Changes Check 2 games
   table is the 4th matrix instance and the first read-only one, so it is the cheapest to move
   first; localization, win-text and the admin tables follow.

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

- 2026-10-07 — **Director 8D cleanup: the artist's render tools are the technician's alone.** With
  the narrowed `atlas-artist.md` on main, `queue_variants`, `choose_variant`, `pack_sheet` and
  `comfyui.job_status` serve only `atlas-technician`; the ungated artist path in `queue_variants`
  is gone (`step` is required again); `TRANSITION_TOOLS` keeps only the coordinator's
  `atlas.list_blueprints`, dropped after the coordinator's definition lands; `AWAITING_DEFINITION`
  is gone (the technician's definition is on main), so every known agent must have a definition.

- 2026-10-07 — **Invisible Director: the atlas technician** (ADR-0008 card 8D). Inert for a person
  and for every current game: only a Director run reaches any of it.
  - **Agents:** the code lands first, with NO change under `services/director-worker/agents/`;
    the three definitions follow as one PR each (agent-eval takes exactly one file): add
    `atlas-technician.md` (Sonnet 5.5, high, `TECHNICIAN_TOOLS` in `recipes.ts`), narrow
    `atlas-artist.md` to prompts and curation (`gptPrompt`), extend `coordinator.md`
    (`atlas.list_blueprints`, the Art plan). Until then the code is inert: `DIRECTOR_AGENTS` knows
    `atlas-technician` but nothing assigns it (`run.assign_task` refuses an agent with no
    definition), the artist keeps `queue_variants` / `choose_variant` / `pack_sheet` /
    `job_status` and renders the pre-8D way (no `step`, no recipe gate; `lock` omitted keeps the
    pin), and the five transition allowances live in `TRANSITION_TOOLS` (`registry.ts`), per agent all or
    none (main's definition or the new one, never a mix), read by the Agents tab's rules and
    `check:director-adapters` (with `AWAITING_DEFINITION` for the technician). **Follow-up owed:**
    `check:director-adapters` prints `CLEANUP OWED` once an agent's definition on main reaches its
    new state; once
    the three definition PRs land, a final small PR empties `TRANSITION_TOOLS`, removes
    `AWAITING_DEFINITION` and the artist's pre-8D branch in `queue_variants`.
  - **Adapter ops** (`director/ops/atlasSetup.ts`): `list_blueprints` (reviewed image cards from
    atlas-tool `GET /blueprints`, cached a minute), `set_atlas_pipeline` (`/saveconfig` with only
    `atlas_pipeline`, the size and the card's per-atlas keys or `bpParams[<id>]`), `set_region_pipeline`
    and `set_refs` (`/regionadv` then the WHOLE card to `/saveadv`; variant refs copied
    create-only to `input/refs/director_<atlas>_<region>_<id>.png` — the atlas is in the name, unlike
    ADR-0008 §4's sketch, so two scratch atlases with the same tag cannot share a copy; crops to
    `director_<region>_crop_<run>.png`; a `key` ref must be this project's), `duplicate_atlas`, `add_layer` / `remove_layer` (scratch
    atlases only, i.e. ones this run's `duplicate_atlas` made — read from `director_ops`),
    `set_output` (refused over a tile this run did not commit: `isRunTile` matches 8B's
    `refs/useroutput/<region>_<run>_<sha12>.png`), `deploy_atlas` (never a scratch atlas, never a
    fully-qualified `deploy_path` outside `deploy/`). `queue_variants`, `choose_variant` (now with
    `lock` and the variant's seed), `pack_sheet` and `comfyui.job_status` move to the technician.
  - **Rendered once:** a resent recipe keeps the status, job and pick of every step it leaves
    unchanged (same n, kind, pipeline, atlas, region, size, variants), so a rendered step is never
    re-opened; the launcher answers the steps its gate matched and the worker marks exactly those
    `queued` at once, so a second queue in the same turn is refused. Scratch atlases are known
    across the project's runs (`projectOpResults`): an earlier run's is never packed, deployed or
    given a tile. Ref copies are `director_<atlas>_<sha12 of atlas/region/id>.png` (crops
    `director_crop_<sha12>.png`); a crop is named by a region. Projections fail closed: an unknown
    size is unpriced, a guessed card is priced at no less than `seedSecondsPerRender`, more variants
    or a bigger size need re-approval, and the cap check counts every recipe still to render,
    against the default cap when the run has none. atlas-tool refuses a Director deploy whose
    resolved key (an asset-map target too) is not under `<project>/deploy/`.
  - **Queue gate:** `atlas.queue_variants` takes `step` and refuses (`409 no_approved_step`) any
    region with no APPROVED, not yet rendered recipe step on that atlas at the atlas's own pipeline
    (or the region's override), generation size, variant count and the step's settings as the
    atlas/region now hold them; a step counts only on its recipe's own region or a scratch atlas this
    run made. `choose_variant` with `lock: false` never unpins a pinned region; `art_plan_open` while the owner reviews;
    `atlas_not_configured` until `set_atlas_pipeline` ran.
  - **Refusals** (`refusals.ts`): by name `library`, `run_on`, `global_config`, `art_deletion`,
    `template_rect`, `template_add`; ops raise `RefusalError` (`layers`, `run_on`, `global_config`,
    `art_deletion`) and the gate answers it like the name refusals; the write guard refuses
    `_shared/` and `atlas_config.json`.
  - **Recipes** (`packages/director-costs/src/recipe.ts`, export `director-costs/recipe`): the §5
    rules in one module the worker validates with and the launcher gate reads. Migration
    `0029_director_recipes`: `director_regions.recipe_json` / `recipe_rev`, `director_template_recipes`
    (versioned group defaults, written after an Art plan approval), `director_blueprint_timings`
    (empty until 8E), and `waiting_on` accepts `art_plan`.
  - **Worker:** `run.set_recipe` (validated, stored as rev + 1, refused with every reason), the Art
    plan opened by code when every planned region has a recipe (`plan_ready` in `runState.ts`;
    `checkpoints_json.artPlan`, default on; off = approved `auto` only when the projection is priced
    and fits the cap, else the run pauses on the `budget` checkpoint and a resume re-checks), approval writes
    the template defaults, a revision that changes a pipeline or raises the cost drops its
    approval, a queued render marks its steps `queued`. The technician's task carries the
    template's defaults, else the old preset's chain (the fallback until 8C).
  - **Deploy:** `pnpm --filter director-worker check:idle [--pause]` (the deploy skill runs it)
    before the deploy of the artist's narrowed definition (a running artist would wake without
    `queue_variants`).
  - Tests: `check:director-adapters` 439, `check:director-runs` 413, `check:recipes` 42,
    `check:run-state`, `check:agents`, `prove:art-plan` 31, `prove:idle` 6 (both in the Director
    worker workflow).
  - **Open (8E):** the Art plan's own panel and `recipeEdits`, chain pricing in the estimate,
    timings from `job_done`. Recipes of regions a later `run.set_plan` drops stay stored and
    approved (the queue gate does not read the plan). A revision that needs re-approval during
    `build` cannot reopen `art_plan` (`plan_ready` is allowed in style_pack and regions only). ⏳ Owed: a live pass with a Director token (no signing secret here).

- 2026-10-07 — **A new key can no longer alias a project's R2 folder** (OPEN_QUESTIONS 17, the
  #1085 follow-up). A project's files live under `r2Slug(client)/r2Slug(key)`, so `my_game` beside
  `my-game` (or `x_y` under client `acme_co` beside `x-y` under `acme-co`) would read and write one
  tree.
  - **`createProject`** (Game Maker, Admin, desktop sync, duplicate / Director copy) re-checks under
    `withProjectKeyLock`, on the lock's `tx`, and throws `ProjectFolderTakenError` (`projectPaths.ts`)
    naming the project that holds the folder under that client, live or soft-deleted. Of two racing
    aliases exactly one lands. Each caller answers in its own shape: Game Maker / Admin `fail(400)`,
    desktop sync and duplicate 409, Director `create_from_template` 409 `project_exists`.
  - **Re-homing:** `assignProjectToClient` (Admin › Projects re-assign, the desktop sync's client
    change) takes the same lock and refuses moving a project into a client folder another project
    holds (Admin `fail(400)`, sync 409; the sync now re-assigns before it renames, so a refusal
    changes nothing).
  - **Director:** `requireDirectorProjectScope` answers a creatable pending key whose folder is a
    project's under the request's client with a **409 that names no project**
    (`FOLDER_TAKEN_WORDS`: the caller may hold no grant on it; doc, upload and image routes; the
    New-game form shows it as the key hint). The check runs only after the caller is known to be
    able to create under that client, so the bare 403 is unchanged. `createRun` refuses the same
    key under its lock, before any run names it (409 `key_folder_taken`, same words).
  - `projectInFolder` now returns the holder's key and takes an optional `client` (folder-equal,
    `r2SlugSql` over `coalesce(client_key, 'unassigned')`); without one it is any client, which the
    mockup cleanup keeps. Another client's same-slug key is a different folder and stays allowed.
  - **Existing aliases are untouched.** `pnpm --filter launcher-api list:project-folder-aliases`
    (read-only, one SELECT) lists folders held by more than one project row.
  - Fixtures: new `check:project-create` (the real `createProject` + advisory-lock SQL over a
    pg-proxy in-memory table: folder rule, deleted holder, client-folder aliasing, the race, a
    lock-off control that shows the race, and `assignProjectToClient`'s moves),
    `check:project-scope` (the Director gate's decision table), `check:director-mockups`, `check:director-runs`, `check:director-adapters` (every
    caller's answer).
  - **Not covered:** `deleteClient` — the FK's `ON DELETE SET NULL` moves every project of the
    client to `unassigned`, where one can land beside a same-slug project. And the reverse
    direction: a pending `my_game` mockup doc followed by Game Maker creating `my-game` folds that
    doc into the new project's `director/` tree (existing behaviour, left as is).

- 2026-10-06 — **Invisible Director: pending-key mockup cleanup** (#1069/#1072 follow-up).
  Mockups uploaded under a key that never became a game no longer stay in R2 forever
  (`director/mockupCleanup.ts`).
  - **Two triggers:** removing the last image of a PENDING key (the mockups route's `remove`)
    clears the key's `director/mockups.json`, originals and `director/crops/`. **Admin › Settings ›
    Invisible Director › Clear abandoned mockups** sweeps every pending folder with nothing written
    for N days. N is the app setting `DIRECTOR_PENDING_MOCKUP_DAYS` (default 14, 1–365), like the
    run budget; the worker has no R2 access, so the sweep is the launcher's. Unlisted originals
    (strays) go too once they are older than a 10-minute grace.
  - **Per R2 folder, not per key:** a folder is `r2Slug(key)`, so `my-game` and `my_game` share one.
    A folder is pending only when no project row (live or deleted) and no Director run has a key
    that slugs to it. The first draft compared keys and cleared a real project's folder in the
    fixture.
  - **Lock:** `withProjectKeyLock` (`projectKeyLock.ts`) is a `pg_advisory_xact_lock` keyed by the
    folder slug, with a 30 s `lock_timeout`. It is taken by `createProject`, which every creation
    path calls (Game Maker, Admin, desktop sync, duplicate / Director copy); by `createRun` around
    the mockup read and the draft insert; and by the cleanup, which re-checks "no project, no run"
    inside it. Every query inside the lock runs on the lock's own `tx`, so each holder needs ONE
    pooled connection: `projectInFolder` / `runInFolder` compare by slug in SQL
    (`r2SlugSql`), and `insertDraftRun` takes the `tx`.
  - **Sweep cost:** project and run keys are read once, outside any lock. A folder with a project
    is skipped. One with no mockup objects is skipped. One a run names, or with anything newer than
    the cutoff (or of unknown age), is reported kept. Only the remaining candidates take the lock.
    The banner names each kept folder and why.
  - **Uploads are not lost:** uploads stay lock-free. R2 has no conditional delete, so the cleanup
    first **seals** the doc: a CAS on the ETag it read, to an empty doc with `sealedAt`. Only then
    does it delete the doc. `updateDoc` will not write over a fresh seal: it waits, then answers
    409 `clearing`, and the seal lapses after 5 min if a cleanup died. The sweep also refuses
    (`changed`) a doc that moved since its listing.
  - Fixture: `check:director-mockups` (now 144 checks), plus a `check:director-runs` check that
    every draft insert holds the lock and runs on its `tx`.
  - **Open (closed 2026-10-07, above):** `requireDirectorProjectScope` accepted a free key whose
    folder is an existing project's (`sunken_temple` vs `sunken-temple`). The cleanup refuses to
    clear such a folder.

- 2026-10-06 — **Invisible Director: the Live run screen** (Director card 4C, PLAN 4.3; over
  #1069, #1067 and #1072).
  - `/director/[runId]` is now the Live run screen (mockup 04) for every state past the breakdown;
    the Mockup breakdown panel of #1072 stays the view while the run waits on that checkpoint.
    The page asks the run's event stream from id 0 on open, so the whole history folds into the
    screen, then tails it (one `EventSource` per run id, `Last-Event-ID` on the browser's own
    reconnect, the 5 s polling fallback also reading the stream for refusals). The folding is a
    pure module, `routes/(app)/director/liveRun.ts`: every payload read by shape, nothing trusted,
    nothing rendered as HTML. Fixture: `check:director-live` (63 checks; wired into Lint).
  - **Steps rail** from the summary plus `run_status` rows: done / running / waiting / paused /
    failed / stopped / not reached, with the breakdown's figures and "n of m approved" on Regions.
    **Banner** per state: review n now (scrolls to the panel), the build to review, paused at the
    cap with **Raise cap and resume** (`resume` + `budgetCapUsd`), paused for a person with the
    worker's reason, stopping / stopped / failed (with the last error) / handed off (Play draft +
    Open in Game Maker). Spend against the cap as a bar in the header; RunPod meter adds "n jobs
    queued".
  - **Region groups and galleries** from the coordinator's `plan` activity (batches → groups),
    `job_queued` / `job_done` (drafting → variants to review; a failed render says why), the art
    director's `review` findings (its pick by variant id or letter; a reject sends the region back)
    and the owner's `region_batch` approval. Tiles show the pick (else the first variant, else the
    mockup crop); filters All / To review / Approved / Drafting; click opens the region detail —
    the mockup crop beside the variants, the art director's and QA's words — and any image opens
    full size in a `<dialog>` lightbox. "As they land" galleries list every image key an event
    names under the project (atlas, sheets, symbols, editor, …).
  - **Review panels** for `region_batch` (Approve these n regions / Redo with my note),
    `before_publish` (Play draft, Open in Game Maker, Approve and hand off / Send back) and any
    checkpoint the page does not know (its text and the two buttons), all through the existing
    request-id client; inputs lock while a request is outstanding; refusals shown.
  - **Activity feed** newest first, grouped by the step the row was written in, agent name, text,
    tool chip and the cost of a spend row (a "hide costs" toggle); capped at 150 with "Show older".
    **Message box** sends the existing `message` owner action. Pause / Stop (confirmed) / Resume
    gated by `allowedActions`.
  - Server: `GET /api/director/runs/[runId]/image?key=` serves one image of the run's project out
    of R2 (owner-only, key under the project prefix, no traversal, PNG/JPEG/WebP by magic bytes,
    nosniff + CSP sandbox) and `GET …/variant?atlas=&region=&id=&size=` proxies a rendered variant
    out of the Atlas Maker (same gate, the adapter's own patterns, placeholder SVG → 404, 6 MB cap).
    `RunSummary` gains `r2Prefix` and `game.url` (the project's first game, for Play draft through
    `asAuthoringLaunch`). `check:director-runs` grew to 410 checks (auth, IDOR across projects,
    traversal, content types, the variant proxy); `check:director-mockups` to 118.
  - Rendered in Chromium through the real adapter-node build against a local Postgres seeded with
    six runs (running, waiting on a batch, waiting before publish, paused at the cap, failed,
    handed off) and compared with mockup 04.
  - Guide: `tools/director.md` § Live run. Inventory: `docs/ui-inventory.md` §14 (the variant
    gallery is the second A instance) and §18.
- 2026-10-06 — **Invisible Pipeline Changes: merge, History, roll back** (Director card 5C, PLAN
  5.3; ADR-0007). `POST /api/pipeline/changes/<n>/merge` (`pipelineMerge`, 403 otherwise; body
  `{headSha, requestId}`) re-reads the change and, only when it is open, not a draft, Ready on that
  very head (every Check 1 job passed, `current-games` success, no conflict), mergeable by GitHub's
  own answer, and neither harness-editing nor file-truncated, calls GitHub's merge API as the App:
  `merge_method: squash`, `sha` pinned to the head, `commit_title` `<title> (#n)` (GitHub's own
  squash subject) and an explicit `commit_message` the launcher writes — never the PR body. A
  title or merger name carrying a CI-skip directive (`[skip ci]` and its variants) is a 409 before
  GitHub is asked: GitHub reads the whole squash message, and such a merge would skip main's push
  workflows and the runtime release. A title without a commit scope is a 409 too, by the hook's
  own rule — `scripts/commit-scope.mjs` now holds `SCOPES`, `subjectHasScope()` for the
  `commit-msg` hook (`check-commit-scope.mjs`, unchanged) and `squashSubjectHasScope()` for the
  launcher, so an API squash cannot land an unscoped subject on main: a `revert:` title passes, the
  hook's other machinery forms (`Merge …`, `fixup!`, `squash!`, `amend!`) do not. Branch protection
  stays the gate: a
  ruleset unmet (405), the head moved under the pinned SHA (409) and 422 come back with GitHub's
  status and sentence and nothing recorded. Anything short of Ready is a 409 before GitHub is asked
  ("The head moved: you looked at <7> and the branch is now at <7>.", "Still testing: 7 of 8 checks
  have passed.", the Blocked reason, the draft and conflict sentences). The record is two writes
  in two systems, so it is CLAIMED first: a `pipeline_merges` row with `merge_sha` null goes in
  before the PUT (unique `pr_number` and `request_id`, inserted with no conflict target, so any
  clash answers null and is settled before GitHub is touched — a completed row is `already`, a
  fresh claim by someone else is a 409 naming them, a claim older than 2 min is taken over) and is
  completed from GitHub's answer; a refusal drops it, a transport error keeps it (GitHub may have
  merged). A resend with the same `requestId` is answered from its row without GitHub (a request
  that merged another PR is a 409); a retry or History's `reconcileClaims` finishes a stale claim
  from the PR's own merge state — merged by THIS App's bot (`<slug>[bot]`, the slug read once per
  process with the App JWT via `GET /app`, `githubApp.slug()`) on the claimed head → completed from
  `merge_commit_sha`; merged by a person, by another App, on another head, or not merged → dropped —
  and a merged PR with NO claim is a 409 "merged on GitHub, not from here", never recorded: a merge
  the launcher made always has a claim. One merge per PR at a time in-process; the claim row is the
  cross-process lock. The row: PR, title, head, merge commit, launcher user (id + name), time, the
  approvals that counted (per screen the newest by an approver in standing: diff id, game, screen,
  approver, note, time), `revert_pr` (the revert PR the launcher itself opened for this merge) and
  `revert_of`, set when a PR merges only if a recorded merge names it as its `revert_pr` — a branch
  or title that merely looks like a revert proves nothing. `GET /api/pipeline/merges` (History; the
  `pipelineChanges` tool) first settles claims older than two minutes against GitHub (a write), then
  answers from the table — completed rows only, 200 even with the App unconfigured — newest 200
  first, each with its PR and commit links, `reverts` (what a revert undid), `revertedBy` (the
  merged revert that undoes it NOW: a revert of the revert puts the change back, so it is live and
  rollbackable again) and `revertOpen` (the recorded revert PR when the cached changes list shows it
  open; the list cache carries a generation so a read in flight across a merge can no longer
  re-cache the pre-merge list).
  `POST /api/pipeline/merges/<n>/revert` (`pipelineMerge`; `{reason?}`) opens a revert PR: the
  squash commit must have one parent; its parent's tree, its own and main's tip are read whole
  (`?recursive=1`; a truncated one refuses) and every file the merge changed goes back to the
  parent's entry — one already back is left alone, one changed again on main since is a conflict,
  as is a file turned into a folder or a folder into a file, and the whole revert is a 409 "revert
  by hand" with nothing written; a mode-only change counts, a submodule stays a `commit`. Then one
  tree (`base_tree` main's, `sha: null` deletes), one commit
  on main's tip in the launcher's words only (the typed reason goes in the PR body as its **Why**),
  one branch `revert/<n>-<sha7>`, one PR `revert: <title>` into main — a pipeline change like any
  other, merged from the Changes tab. A resend answers the branch's open PR (200 `existing`); a
  closed or merged revert on the branch's tip is not opened again (one of an earlier branch by that
  name, deleted on merge, is not in the way); a branch the launcher left without a PR, or an open
  PR it never recorded, is used only when the tip is the launcher's own revert commit (one parent,
  "This reverts commit <sha>"), else a 409 naming the branch to delete; a 422 on the ref or on the
  PR (another request won) answers that request's PR and records it; a failed PR create keeps the
  branch for the retry; an unrecorded merge is a 404 and one currently rolled back a 409. UI:
  the header reads `can merge` / `read-only`; the Ready bar offers **Merge into main** (a
  confirmation naming the 7-char and full head SHA and the squash subject, captured before the
  dialog so a refresh cannot swap the head under it; the requestId is kept for **Try again** after
  a 5xx or no answer; then "Merged into main as <7> by <who> · just now" and the list drops the PR;
  any refusal re-reads the change), disabled for a draft, absent for by-hand changes and for
  read-only users ("Merging needs the “Merge pipeline changes” permission."). **History · N**
  (`HistoryPanel.svelte`): rows newest first with PR and commit links, "Merged by X · when", the
  approvals fold, the `revert` tag with "Rolls back #m", "Rolled back by #m" or "Rollback #m is
  open", and **Roll back** (an optional reason) → the page switches to the new change. Also: an
  image asked with an `?artifact` id the cached walk does not hold re-walks only when the walk is
  over 5 s old or the id is newer (the 5B follow-up). Fixture: `check:pipeline-changes` (3981
  checks). Guide: `docs/tools/pipeline-changes.md`. INFRA: the App's Contents and Pull requests
  permissions are now read & write; the App stays off the ruleset's bypass list; "Automatically
  delete head branches" stays on. Not built: Discard branch, the Agents tab (5D).
- 2026-10-06 — **Invisible Pipeline Changes: the Agents tab, agent-definition changes and their
  evaluation** (Director card 5D, PLAN 5.4; ADR-0007 "Agents tab"). `/pipeline`'s **Agents** tab
  lists Director's seven runtime agents as `main` holds them (`services/director-worker/agents/
  <name>.md`, read through the GitHub App: model, effort, tools, the last commit touching the file,
  the open agent-definition changes editing it; `?agent=<name>` deep-links one) and opens one in a
  text editor. The **Validation** panel re-runs, on every keystroke, the worker's own frontmatter
  loader (moved to the pure `services/director-worker/src/agentDefinition.ts`, imported by the
  browser and the server alike; `agents.ts` re-exports it), the runnable-model list
  (`src/models.ts`, what `model.ts` has a request profile for — a priced-only fallback model is
  refused like the worker's boot would) and the adapter allow-lists `check:director-adapters`
  pins: an edit that adds or drops an adapter op is refused as a launcher change, not a
  definition change (`$lib/agentEdit.ts` `validateAgentEdit`, the same verdict on submit). A
  valid, changed definition with a one-line why is **submitted as a pipeline change** (needs
  `pipelineMerge`; read-only otherwise): `POST /api/pipeline/agents/<name>/changes` opens, as the
  App, a branch `agents/<name>-<short>` off main's current commit, ONE commit changing only that
  file (the Git Data API: blob → tree → commit → ref; never a push to `main`), and a PR titled
  `agents: <name> — <why>` labelled `agent-definition` (the label is created if the repo lacks
  it), the launcher user named in the body and never by email. `requestId` is the idempotency
  key (`<short>` is derived from it, so a resend finds its branch and PR — or finishes a branch
  whose PR never got opened — and a resend with other content is a 409); a `baseSha` that is
  not main's blob (the editor is stale), an unchanged file, and a `main` that moved twice while
  the commit was made are 409s; the commit is made again once when main moved under it.
  `GET /api/pipeline/agents[/<name>]` are session-gated like the Changes tab;
  `scripts/check-commit-scope.mjs` accepts the `agents` scope. **The evaluation**:
  `.github/workflows/agent-eval.yml` runs on `pull_request_target` (main's workflow file and
  code; the PR contributes one Markdown file by `git show`, never executed) for a same-repo PR
  with the label that edits exactly one agent definition, runs main's definition and the edited
  one over the agent's reference set (`services/director-worker/src/eval/`: today only
  `mockup-analyst`, over `docs/director/eval/mockups/` scored against `expected-breakdown.json`
  — per expected element ½ status agreement + ½ region agreement, elements matched by box
  overlap; any other agent gets "no eval set" and passes), with a **$20 hard cap** enforced in
  code from the usage the API returns (stop before the next call once the total reaches it;
  "capped" is a failure), posts the commit status `agent-eval` on the PR head and uploads
  `report.json` as the `agent-eval-report` artifact (the shape in `src/eval/report.ts`, kept 90
  days). It needs the `ANTHROPIC_API_KEY` Actions secret (INFRA "Agent eval"; the owner adds
  it; never printed). The change detail of an `agent-definition` PR shows an **Agent evaluation**
  section between the two checks (read from that artifact through the run the status names,
  verified to be the eval workflow's from this repo with a report for this head and agent;
  bounded read, same `safeHref` rules): before/after scores, cost of cap, capped, the per-item
  diff; a failed or capped eval, or a labelled change that does not edit exactly one definition,
  is **Blocked** with `agent-eval: …` (the list counts the status like `current-games`). Merge
  is not here (card 5C); `agent-eval` is not a GitHub-required check (open question). Fixtures:
  `check:pipeline-changes` (the fake GitHub grew the Git Data, labels and eval-run routes),
  the worker's `check:agent-eval` (the scorer and the runner over a fake model, the cap paths),
  `check:agents`. Guide: `docs/tools/pipeline-changes.md`.
- 2026-10-06 — **Invisible Director: New game and Mockup breakdown screens** (Director card 4B,
  PLAN 4.1 + 4.2; over the owner API of #1069 and the breakdown step of #1067).
  - `/director` is the New game screen (mockup 02): Game Maker's project fields and validation
    (the key slugified from the name, Game Maker's own words on a bad or taken key), the Director
    templates per game type with their GAME / USING / LOCKED chips, the preset fields, mockup
    upload (one request per file, retag, remove, fidelity, the ownership check), notes, the
    checkpoints, and the estimate panel against the cap. Create = `POST /api/director/runs` with a
    request id made once per (key, client, template) and resent unchanged on a lost connection;
    then `start` with its own id; then the run page. Mockups upload under the pending key and
    client, which lock while any are stored. A "Your runs" table links each run.
  - `/director/[runId]` (owner-only, the API's 404 otherwise) renders the `breakdown` checkpoint
    (mockup 03): one tab per mockup, the analyst's numbered boxes over the original (red = a
    confirmed clash with a locked item, amber = needs you), the found list with regions and
    status, "Needs your call", font gaps, the staged font requests with **Mark done** through
    `/api/director/fonts`, crops per region, the palette with dropped swatches, and Approve /
    Revise-with-note (note required to revise). The run's other states show the banner and the
    allowed actions only (Start with the New-game refusal carried over, Pause, Resume with a cap
    raise, Stop behind `askConfirm`); the Live run panels are card 4C. Live updates: the page
    follows `/director/[runId]/events` (SSE) and refreshes the summary on every event; `error`
    events of type `refused_request` are shown; a closed stream falls back to polling every 5 s.
  - Server bits: `GET /api/director/templates` also answers the clients the caller may create
    under (`mayTargetClient`, as Game Maker's loader) and the agents the estimate prices with
    their models; `GET /api/director/mockups/image?project=&client=&id=` serves an original
    (same gate as the doc, pending project allowed); `POST /api/director/mockups` takes
    `action=retag`; `GET /api/director/runs/[runId]/crop?region=` serves a crop (owner-only).
    Fixtures: `check:director-runs` (362 checks) and `check:director-mockups` (96) cover them.
  - Rendered in Chromium against mocked API answers and compared with mockups 02 and 03; the
    draft, paused and refused-request states were exercised the same way.
  - Guide: `tools/director.md`. Client types mirror the worker's `Breakdown` in
    `routes/(app)/director/director.client.ts` because the worker's sources import with `.ts`
    extensions the launcher's tsconfig does not accept.
- 2026-10-06 — **Invisible Pipeline Changes screens: the Changes tab** (Director card 5B, PLAN 5.1
  + 5.2; ADR-0007). `/pipeline` now shows the list and the detail over the 5A endpoints, client-side
  fetched and refreshed every minute while visible, `?change=<n>` deep-links a change. The list:
  Testing (*n* of *m*) / Blocked (the failing row's reason in red) / Ready, Dependabot's folded
  apart, a note when forks were skipped. The detail: the Blocked reason in mockup 05's wording
  ("Breaks <game>: 2 of 12 screens look different (win, bigwin)", "Merge conflict with main",
  "Lint: lint failed"), the PR body's "why" as plain text, the files (renames as `old → new`, the
  3000-file truncation named), the diff link, Check 1 as tiles per workflow with job counts and a
  jobs fold, Check 2 as the games table (Build / Game tests / Looks the same, "Show all N") or one
  plain sentence per report state (none / running / skipped / missing / expired / stale /
  unreadable), and under it every changed screen with before / after / diff images
  (`ScreenCompare.svelte`, side by side or one at a time). Approve per diff only with
  `pipelineMerge` — the `(app)` layout resolves it as `canPipelineMerge` beside `canAdmin`, from
  the override layers it already reads, so the page adds no query (the header says `can approve`
  or `read-only`); each block shows who approved and
  when, a lapsed approval in amber, the `withheld` reason, "current-games was posted" once a set
  completes, and **Post approval again** when a re-run reset the status on the same head. A change
  that edits the harness, has more files than GitHub lists, or fails a build/test shows "Merge by
  hand after review" and no Approve button. No Merge / Discard / History (5C) and no Agents (5D).
  New: `GET /api/pipeline/changes/<n>/report/<path>?artifact=<id>` streams one image of the
  current-games report out of the run's full artifact (`current-games-report`) through the App's
  `download()` by byte range — the archive's tail for the central directory (its own range when it
  is bigger than the 64 KB tail), then the entry alone, inflated as it streams — so the launcher
  never holds the artifact; a blob store that ignores the range gets a small archive read whole and
  a large one refused. Same session gate as the detail; the path must be one the report itself
  lists (`reportImagePaths`), so `report.json`, `index.html` and any traversal are 404s; the
  ready report state now carries `images: {artifactId, sizeInBytes, expiresAt} | null` (null once
  the full artifact expired while the report-only one still reads) and `?artifact=` pins the
  answer to that artifact (409 once a re-run replaced it, cacheable 3 days when given). A branch
  controls the artifact's bytes, so a streamed entry is cut off past the smaller of what it
  declares and 32 MB, a whole-archive answer is bounded by its `content-length` and its bytes,
  ZIP64 is refused, and every link the page renders passes `safeHref()` (GitHub pages only). The
  central directory is cached per artifact (the report's own images alone) and read once for a
  cold detail; the walk from a change to its images is single-flighted with a 30 s TTL and redone
  at once for an artifact id it does not know, so a re-run's new images never 409 behind the cache.
  `$lib/server/zip.ts` gained the range helpers (`locateCentralDirectory`,
  `parseCentralDirectory`, `localDataOffset`). Fixture: `check:pipeline-changes` (987 checks: the
  route, the ranges, the whitelist, the expired-images state, the no-range fallback, a central
  directory past the tail). Guide: `docs/tools/pipeline-changes.md`; inventory §2 and §18.
- 2026-10-06 — **Invisible Pipeline Changes backend: GitHub App, changes list + detail, diff
  approvals** (Director card 5A, PLAN 5.1 + 5.2; ADR-0007). `$lib/server/githubApp.ts` turns
  `GITHUB_APP_ID` / `GITHUB_APP_INSTALLATION_ID` / `GITHUB_APP_PRIVATE_KEY` into an installation
  token (minted once, shared, renewed 5 min before expiry, once more after a 401; never logged).
  `GET /api/pipeline/changes` lists every open PR into `main` bar `director-game`, Dependabot's
  apart, each Testing (*n* of *m*) / Blocked (the failing row's reason) / Ready; `GET
  /api/pipeline/changes/<n>` adds files, the diff link, the body's "why", Check 1 (check runs
  grouped by workflow, with job counts; the harness's own jobs are Check 2's) and Check 2 (the
  report read from the new `current-games-report-json` artifact — `report.json` alone, so the
  launcher never holds the images in memory; a run older than that upload falls back to the full
  artifact while it is small — through `$lib/server/zip.ts`; an expired artifact, a report for
  another head or another attempt is a state, not an error).
  `POST /api/pipeline/changes/<n>/approvals` (`pipelineMerge`, 403 otherwise) records a changed
  screen's approval in `pipeline_approvals` (migration `0027`, ids embed the head SHA so a push
  voids them) and, once every diff on that exact head is approved and the run's only failures are
  changed screens, posts `success` to `current-games` on that SHA naming the approvers (never an
  email address; approvals on one head run one at a time; one row per diff per approver). What
  the post trusts: only the run the harness's own workflow file made for the PR from this
  repository; a report naming this head; the run's jobs read from the jobs API for that attempt
  (every job but `report` succeeded); approvers who hold `pipelineMerge` at post time (a lapsed
  approval is named and someone in standing approves beside it). Forks are never listed or
  approved; a change that edits `.github/workflows/**` or `scripts/current-games/**` — anywhere in
  its paged file list, renames included — or has more files than GitHub lists cannot be approved
  through the launcher (its report is its own). The artifact download follows GitHub's redirect
  without the token. Both gates in `$lib/server/pipelineAccess.ts`. `current-games.yml` uploads
  the report-only artifact beside the full one and overwrites both on a re-run. The `/pipeline` tabs are still empty (card 5B). Fixture:
  `check:pipeline-changes`. Env: INFRA "GitHub App (Pipeline Changes)".
- 2026-10-04 — **Anthropic (agents) cost card + Director run budget** (Director Phase 1, tasks
  1.11–1.12; ADR-0006).
  - Prices live in `services/director-worker/pricing.json` (Claude $/MTok, cache ×0.1 read /
    ×1.25 write, RunPod $/s per GPU marked `placeholder`), validated at load by
    `costs/directorPricing.ts`. An optional JSON override in `app_settings`
    (`directorPricingOverride`) is laid over it by `costs/pricingConfig.ts`; a bad or unreadable
    override degrades to the file and says why.
  - `costOfUsage(model, usage, pricing)` is pure and throws on an unknown model.
  - New table `director_spend` (migration `0020_director_spend`) and a new `ProviderId`
    `anthropicAgents`. Its collector sums the `claude` rows month-to-date (Madrid month): total,
    by agent, top 5 runs. It gets a monthly column through `recordAndLock`.
  - `INCLUDED_IN` marks it as a subset of `anthropic`, so neither the page total nor the month
    Total counts it twice. The org-wide Anthropic card notes that it includes agent spend.
  - `ProviderId` now derives from `PROVIDER_IDS`, and `/admin` uses `isProviderId` instead of a
    hand-copied list.
  - Settings → **Invisible Director**: run budget (`DIRECTOR_RUN_BUDGET_USD`, default 25,
    $1–$500; `getDirectorRunBudget()` mirrors `getRunpodIdleConfig()`), the effective price table,
    and the override editor. Actions: `setDirectorBudget`, `setDirectorPricingOverride`.
  - Fixture: `check:director-costs` (wired into Lint).
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
