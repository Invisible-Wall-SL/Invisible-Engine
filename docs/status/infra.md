# Infra — status

> **Reference (source of truth for URLs / env vars / secrets / the tunnel):** [docs/INFRA.md](../INFRA.md) · Agent: `.claude/agents/infra-railway.md`
>
> This file is a THIN status layer — current operational state + open items only. For any URL, env-var name, R2 key layout, tunnel id, or rotation procedure, go to **docs/INFRA.md**; do not duplicate its tables here.

**One-line state:** Healthy and serving — every cloud service is live in one Railway project and
production generation runs on RunPod Serverless. What is owed is owner-side: routine secret
rotation, the monitoring setup and the backups setup (see Blocked).

## Current state
The topology is **cloud-stateless Railway services + a shared R2 system-of-record**. ComfyUI runs in
three places: the **RunPod Serverless endpoint** the Atlas Maker generates on
(`COMFY_TRANSPORT=serverless`, owner-confirmed 2026-08-18), **RunPod R&D pods** for artist
experimentation (`/comfyui`, a fleet), and optionally a person's **own GPU over the Cloudflare named
tunnel** (⚙ _Run generation on_ = My computer). Nothing in production depends on a local machine
being up. See docs/INFRA.md for the diagram and the service/env tables.

- **Railway (one project, env `production`):** launcher (`app.invisiblewall.org`), `atlas-tool`,
  `sheet-tool`, `Invisible-test-Server` (`games.invisiblewall.org`) and Postgres. All auto-deploy
  from GitHub `main`; the repo-root Python services and the test server rebuild only on their
  Watch Paths.
- **Health:** the launcher's `/api/health` is a readiness check (DB + migrations); atlas-tool and
  sheet-tool `/healthz` name the running commit; the test server's `/healthz` reports its last
  hydrate and answers 503 when it serves nothing (#868). All four answered green on 2026-09-29.
- **DB migrations self-apply on boot** (SvelteKit `init` hook → Drizzle migrator, fail-soft,
  idempotent). All 20 migrations (`0000`–`0019`) are applied in production: `/api/health` reported
  `schema: current` on 2026-09-29. **Never run `db:push` on prod — use
  `pnpm --filter launcher-api db:generate` + the on-boot migrator.**
- **Cloudflare:** DNS zone `invisiblewall.org`; `www`/`app`/`games` = CNAME → Railway,
  **DNS-only** (proxying breaks Railway TLS); `comfy` = the named tunnel (proxied, behind an Access
  service token). With `games` DNS-only there is no edge cache to purge — the test server's own
  `no-store` / content-hashed headers keep games fresh (INFRA "Game freshness").
- **R2 bucket `invisibleassets`** is the unified single-project repo
  (`<client>/<project>/{input,manifests,atlas,batch,sheets,sheet_src,deploy,spines,localization,editor,published,…}`),
  shared by all tools. The online engine ships as versioned releases under `test_server/_runtime/`
  (Runtime release / rollback Actions). Nightly backups go to the separate bucket
  `invisible-backups`.
- **Tool launch tokens are on:** `ATLAS_TOOL_SIGNING_SECRET` + `SHEET_TOOL_SIGNING_SECRET` are set
  on both ends and were verified live 2026-09-29; the legacy handoff ends 2026-10-13 (INFRA "Tool
  launch tokens").
- **Repo security settings are on** (the repo is public): secret scanning, push protection and an
  active ruleset on `main`; the `Secrets` workflow also scans every PR and push.
- **CI runs every offline check** (`.github/workflows/checks.yml`, every PR + push to `main`):
  `check-all (1/3…3/3)` runs `pnpm check:all --exclude-lint` — every fixture, `check-*`/`verify-*`/
  `smoke-*` script, launcher `check:*`, package test, headless spike and codegen `--check`,
  DISCOVERED by file pattern, minus what `Lint` already runs (read from `lint.yml`, so a gate is
  never run twice nor dropped). A check that talks to the mock RGS gets a private one, seeded with
  the check's id, so it deals the same rounds on every run. `python tests` runs
  `scripts/check-python.py`: every `services/*/test_*.py`, the ComfyUI-SemanticLayers suite on CPU
  torch, and the backup CLI. Every deliberate skip carries its reason (`pnpm check:all --list`); a
  Python test declares a need with `# check: requires <module|network> — why`.
- **Every would-be required check reports on every PR** — `check-all (1/3…3/3)`, `python tests`,
  `eslint`, `check-secrets`. Checks and Lint dropped `paths-ignore`; their first step
  (`.github/actions/code-changed`) skips the rest on a docs-only change (`docs/**`, `.claude/**`,
  `*.md`), so those jobs pass in ~10 s with no install. All six are required checks in the `main`
  ruleset (INFRA "Branch ruleset on `main`"), so every change lands through a PR that passed them.

## Open items / next
1. **Pin a Railway `/data` persistent volume** on atlas-tool + sheet-tool — the incremental-hydrate
   skip only persists across deploys with a real volume; on ephemeral disk the first hydrate per
   boot re-reads everything, which costs R2 request operations (R2 has no egress fees). Disk growth
   is bounded (lazy hydrate + "Clear local cache"), but **no `railway.json` confirms `/data` is
   persistent — verify whether already done.**
2. **Launcher OOM-on-bake (Railway RAM):** the editor bake/export path has 502'd mid-bake from the
   launcher running out of memory (bake retries 5xx as a soft cover). Durable fix = more RAM on the
   launcher service / stream exports rather than buffering.
3. **cloudflared as a Windows service** (`cloudflared service install`) so a person's tunnel
   survives reboots. Low priority — production generation does not use the tunnel.
4. **Tool signing secrets have no dual-key window** — each tool verifies against one
   `*_TOOL_SIGNING_SECRET`, so rotating one signs everyone out of that tool for a short 403
   window. Accepting a previous secret during a rotation would close it.
5. **svelte-check ratchet** — not built: `svelte-check` is not a dependency anywhere (people run it
   ad hoc; `apps/lines` sits at ~189–193 errors per the engine status). Needs it added as a
   devDependency, then a baseline-count gate.
## Blocked (owner / external)
- **Nightly backups setup (owner, ~25 min; the workflow is a green no-op until done):** the full numbered list is "One-time owner setup" in [guides/backups](../guides/backups.md). In short:
  - Cloudflare: create R2 bucket `invisible-backups`. Add lifecycle rules `postgres/` 35 d, `r2-docs/` 90 d, `r2-assets/` 14 d, `_restore-drill/` 7 d, and abort multipart after 1 d. Add 7-day bucket-lock rules on the first three prefixes.
  - Cloudflare: create R2 tokens `backup-writer` (Object R&W, that bucket only) and `backup-source-reader` (Object Read, `invisibleassets` only).
  - Postgres: create the `backup_reader` role (`GRANT pg_read_all_data`).
  - Your machine: `age-keygen` twice (main + break-glass). Store both identities offline.
  - GitHub: environment `backups`, restricted to `main`, with secrets `BACKUP_DATABASE_URL`, `BACKUP_SRC_R2_ACCESS_KEY_ID`, `BACKUP_SRC_R2_SECRET_ACCESS_KEY`, `BACKUP_R2_ACCESS_KEY_ID`, `BACKUP_R2_SECRET_ACCESS_KEY` and variable `BACKUP_AGE_RECIPIENTS`.
  - Then: run the workflow once, and do restore drill A with your real key.
  - **Railway:** if the workspace is on **Pro**, also enable Postgres → Backups → Daily + Weekly. It is Pro/Enterprise only; if the tab is missing or locked, you are on Hobby and ours is the only DB backup.
- **Monitoring setup (owner, ~30 min; everything is dormant until done):** (1) create a Sentry org in the **EU** region with projects `game-runtime` (Browser JS), `launcher` (Node), `pipeline-tools` (Python), alert rule "new issue → email" on each; (2) GitHub → Settings → Secrets and variables → Actions: secret `PUBLIC_SENTRY_DSN` (game-runtime DSN), optional variable `PUBLIC_SENTRY_SAMPLE_RATE`; the next runtime release bakes it; (3) Railway launcher: `SENTRY_DSN` + `PUBLIC_SENTRY_DSN` (launcher DSN) → Apply changes; (4) Railway atlas-tool + sheet-tool: `SENTRY_DSN` (pipeline-tools DSN) → Apply changes; (5) Railway launcher → Settings → Deploy → Healthcheck Path `/api/health`, timeout 300; (6) Better Stack monitors per the INFRA table; (7) Watch the repo (Custom → Issues) so "Runtime release failed" issues reach you; (8) readable stack traces: a Sentry auth token as `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` / `SENTRY_PROJECT` in GitHub Actions and on the Railway launcher — the numbered steps are docs/INFRA.md "Readable stack traces — source maps".
- **Secret rotation (owner, Railway / Cloudflare / RunPod dashboards):** rotate the secrets listed
  in docs/INFRA.md "Security / secret rotation", following that table and, for every consumer, the
  order and the verification, [guides/rotate-a-secret](../guides/rotate-a-secret.md). Verify the
  runtime after each, not just the dashboard. Since desktop launcher v1.0.56 the R2 key can be
  rotated without touching a publisher's desktop.
- **ComfyUI-Manager prerequisite** for Blueprints model auto-install — needs ComfyUI-Manager at
  security level "middle" or below on whichever ComfyUI generates (else 403). The baked R&D pod
  image already ships it at `middle`; a person's **local** install is the one still to confirm. The
  feature is **code-complete** (install queue, poll, reboot, wait-for-back, recheck and a manual
  checklist, behind `BLUEPRINT_AUTO_INSTALL_MODELS`), and a declared model already resolves against
  the `comfyui-models/` mirror (#604, `services/atlas-tool/model_mirror.py`). What remains is
  delivering a missing model onto the machine that renders, plus one live run with a real Manager:
  [atlas-maker](atlas-maker.md) open item 7, [comfyui](comfyui.md).

## Recent changes
- 2026-09-30 — **Source maps go to Sentry and never ship.** The runtime release now builds the game
  with hidden maps, and `scripts/sentry-sourcemaps.mjs` re-bases the bundle's map onto
  `index.html` (the game is one inlined file, so frames are numbered by the page), tags page + map
  with one debug ID, uploads them for release `<sha12>`, deletes every `.map`, and gates the build;
  `publish-runtime-bundle.mjs` refuses a `.map` too. The launcher's Railway build does the standard
  inject → upload → delete when `SENTRY_AUTH_TOKEN` is set. No token = a notice, a failed upload = a
  warning; neither fails a release. Verified: fixture (`scripts/sentry-sourcemaps.fixture.mjs`, with
  line- and column-shift mutants), `--dry-run` of the real `sentry-cli` against a local stand-in API
  for both surfaces, and a real-browser frame resolved through the staged map to the exact call
  site. Owner setup under Blocked (8); detail in docs/INFRA.md "Readable stack traces".
- 2026-09-30 — **All six CI checks are required on `main`.** The owner added `check-all (1/3…3/3)`,
  `python tests` and `eslint` beside `check-secrets` in ruleset `24185070` (read back via `gh api`).
  Every name reports on docs-only and code PRs alike: #882 (docs-only test) 8–11 s each, #887 and
  #886 (code) ran them for real, and push runs on `main` report all six too.
- 2026-09-30 — **Retired service removed: `atlas-backend`.** The owner deleted the Railway service
  (nothing called it); this change deletes `services/atlas-backend/`, the launcher's unused
  `ATLAS_BACKEND_URL` / `ATLAS_MANIFEST_KEY` / `ATLAS_STYLE_REF_KEY` getters, the ComfyUI
  submit/poll/upload/fetch client in `iw_common/comfy.py` that only it imported (atlas-tool keeps
  `USER_AGENT`, `cf_headers`, `comfy_url`), and every doc, agent, CODEOWNERS and commit-scope
  entry that named it. Railway is now four app services + Postgres.
- 2026-09-30 — **Every CI check the owner wants required now reports on every PR** (#881). Checks
  and Lint dropped `paths-ignore`, which would have left a docs-only PR pending forever on a required
  check. A composite action, `.github/actions/code-changed`, diffs the PR merge commit against its
  base parent (or a push's `before..HEAD`) and, when only `docs/**`, `.claude/**` or `*.md` changed,
  every later step is skipped — the job passes without installing anything. It is a step, not a
  gating job, because a job skipped by `if:` reports the matrix name unexpanded. Job and matrix names
  unchanged. Proof: docs-only test PR #882 (closed) reported all six names in 8–11 s with every install
  and check step skipped; #881 itself ran them for real (3 × 87 checks, 44 Python tests, every Lint gate). Closed open item 6; the ruleset change itself is the owner's (Blocked).
- 2026-09-29 — **Test server: the refresh secret reaches it, and `/healthz` stops lying** (#868).
  - The launcher now sends `TEST_SERVER_SECRET` (a new launcher env var, as the
    `x-test-server-secret` header) on Game Maker Publish's and `register-game`'s `/refresh`
    (`src/lib/server/testServerRefresh.ts`). Before, setting the secret would have 403'd every
    Publish refresh, silently. The server takes the header or the old `?secret=` (workflows, desktop
    launcher), compared in constant time.
  - A manifest read that fails for any reason other than "absent" (R2 unreachable, bad key, corrupt
    JSON) now THROWS instead of emptying the registry: a refresh during an R2 blip used to take every
    game offline while reporting healthy, and a boot failure skipped the background retry.
  - `/healthz` reports `lastHydrate` (`succeeded`, `at`, error name) and answers **503 `"ok":false`**
    when it serves nothing, so the Better Stack `"ok":true` keyword check catches a failed boot.
    Verified locally (TEST_SERVER_LOCAL): empty dir → 200; corrupt manifest at boot → 503 + retry; a
    corrupt manifest on a later refresh → keeps serving, 200 with `succeeded:false`; secret via
    header/query → 202, missing/wrong → 403.
- 2026-09-29 — **Operations runbooks + a first-game walkthrough** (#867, docs only), so the platform
  can be run without the lead dev: [build-your-first-game](../guides/build-your-first-game.md),
  [publish-and-deliver](../guides/publish-and-deliver.md), [release-and-rollback](../guides/release-and-rollback.md),
  [rotate-a-secret](../guides/rotate-a-secret.md), [incident-first-response](../guides/incident-first-response.md);
  linked from ONBOARDING and STATUS. Author-facing gotchas that were only in personal memory now sit in
  each tool guide's **Traps** section (verified against current code; fixed ones left out), and stale
  tool-guide claims found on the way were corrected (published snapshots freeze flow + config; ways/cluster/
  scatter mocks + starter flows; symbol size comes from the art; atlas access via signed launch token).
  Gaps it recorded: the tool signing secrets have no dual-key window (still open — Open items); the
  launcher's missing `TEST_SERVER_SECRET` and the games host's always-ok `/healthz` (fixed the same
  day, #868); INFRA's rotation table lacked the deploy token, `TEST_SERVER_SECRET` and RunPod (rows
  added by the reconciliation below; GitHub, Cloudflare API and LLM keys stay in the rotate guide).
- 2026-09-29 — **Docs reconciled with the running infra.** INFRA's diagram now shows sheet-tool,
  the test server, RunPod Serverless + the R&D fleet, GHCR and the backups bucket; the Railway
  project structure reads one way throughout; `games` is recorded as DNS-only (checked live: no
  Cloudflare in front, so the republish purge has nothing to purge); the env tables gained
  `KTX2_ENCODE`, `PAGE_WEBP`, the sound, localization and RunPod vars and the test server's own,
  and lost the unused `RESEND_API_KEY`; the rotation table now lists every consumer of each
  secret by env-var name. Verified live: `/api/health` green with `schema: current` (all 20
  migrations applied), both tools' `/healthz` on `4837fcc8`.
- 2026-09-29 — **Tool launch tokens live** (#863, verified in #865): both signing secrets set on
  the launcher and each tool; the tools take their scope from a signed token and every path but
  `/healthz` is gated. Legacy handoff ends 2026-10-13.
- 2026-09-29 — **Nightly backups + restore runbooks** (#864). `.github/workflows/nightly-backup.yml`
  runs `scripts/backup/iwbackup.py` at 02:37 UTC and writes age-encrypted Postgres, authored-doc
  and authored-asset archives to the separate bucket `invisible-backups`, test-restoring every
  dump into a throwaway Postgres and opening "Nightly backup failed" on any failure. R2 has no
  object versioning, so the nightly copy is the recommendation; Railway's built-in DB backups are
  Pro/Enterprise only. A test restore from production sources into scratch targets matched every
  table row count and byte-verified every doc and asset; it also found 17 case-only key
  collisions, which `restore-r2` now handles. Design, owner setup and the drill:
  [guides/backups](../guides/backups.md). Still owed: the owner setup under Blocked.
- 2026-09-29 — **Game dev servers boot again after the error-tracking change.** Vite dev SSR
  externalized the `error-tracking` package and Node's ESM loader could not resolve its
  extensionless re-exports; `packages/config-vite` now sets `ssr.noExternal: ['error-tracking']`
  for all six apps. Production builds were never affected.
- 2026-09-29 — **Monitoring + error tracking** (#852). Sentry wired into the game runtime, the
  launcher (server + browser) and atlas-tool/sheet-tool — all no-ops until DSNs are set; partner
  deliveries off unless their profile opts in. `/api/health` checks the DB + migration state (503
  when behind). Runtime-release failures open/update a GitHub issue. Uptime: Better Stack free,
  config in docs/INFRA.md "Monitoring & error tracking". Owner setup under Blocked.
- 2026-09-28 — **Secret scanning hardened + a server-side backstop.** `scripts/check-secrets.mjs`
  recognises the provider key formats we use plus PEM keys and credentialed DB URLs, ignores
  documentation placeholders, and gained `--diff <base>` / `--history` modes and fixtures
  (`node scripts/check-secrets.test.mjs`). `.github/workflows/secrets.yml` runs it on every PR's
  added lines and every push to `main`, printing file/line/type only. A full-history scan (every
  branch and PR ref) with it and gitleaks found no live credential. The owner has since turned on
  GitHub secret scanning, push protection and a `main` ruleset.
- 2026-09-16 — **staging hydration no longer overwrites newer local work** (`iw_common.storage.pull_prefix`, so atlas-tool AND sheet-tool). It used to re-download over any local file whose byte count differed from the object; because `hydrate()` pulls producer prefixes (`atlas/`, `input/`) in a **background thread**, a pull landing mid-job could replace a file the tool had just written with the older copy from the bucket — and stamp it with a fresh mtime, which is how a stale atlas page got published under fresh rects ([atlas-maker status](atlas-maker.md), 2026-09-16). A local file newer than the object's LastModified is now skipped; a genuinely re-uploaded object (newer LastModified than our copy) still re-downloads, so the same-size/stale-pixels skip is unchanged.
- 2026-08-15 — **serverless worker hardened**: cu128 / torch 2.8 so one image spans Blackwell → Ampere, and a free-VRAM-conditional ComfyUI restart between jobs to fix the DepthAnything OOM (it loads a transformers model outside ComfyUI's memory manager, so `/free` can't release it). Detail in [status/comfyui](comfyui.md).
- 2026-08-13 — **ComfyUI went multi-host**: a RunPod Serverless endpoint for Atlas Maker generation (`COMFY_TRANSPORT=serverless`) + a multi-pod R&D fleet behind `/comfyui` + a baked pod image (`services/atlas-comfy-pod`) that survives RunPod recreating the container on resume. Runbook in [docs/INFRA.md](../INFRA.md) "ComfyUI R&D pod (RunPod)".
- 2026-06-13 — auto-migrate on boot shipped + prod baselined through `0010` after the `db:push` replay-from-0000 incident ([detail in history](../history.md)).
