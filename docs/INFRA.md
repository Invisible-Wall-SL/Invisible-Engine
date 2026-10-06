# Infrastructure

> Source of truth for the cloud setup. Keep this updated when services/URLs/envs change.
> **No secrets in this file** — only names of env vars and non-secret IDs.

## Overview

```
 Cloudflare DNS (zone invisiblewall.org) — app. and games. are DNS-only CNAMEs to Railway
 │
 ├─ app.invisiblewall.org ──► LAUNCHER (SvelteKit, adapter-node) ──► Postgres (Railway)
 │                            auth, roles, every tool page (full-page, never an iframe),
 │                            publish, the runtime assemble, signed tool launch tokens
 │        │ 303 + ?iw_launch=<token>
 │        ├──────────────► SHEET-TOOL  (Python, services/sheet-tool)
 │        └──────────────► ATLAS-TOOL  (Python, services/atlas-tool) ── generation ──┐
 │                                                                                   ▼
 │     RunPod Serverless endpoint (image atlas-comfy-worker) ◄ production generation
 │     comfy.invisiblewall.org → a person's own ComfyUI (Cloudflare tunnel + Access) ◄ "My computer"
 │     RunPod R&D pods, the launcher's /comfyui fleet (image atlas-comfy-pod) ◄ interactive R&D
 │
 ├─ games.invisiblewall.org ─► INVISIBLE TEST SERVER (Node, services/test-server)
 │                            serves published games + the shared online runtime, mock RGS
 │
 ├─ (no public domain) ──────► DIRECTOR WORKER (Node, services/director-worker) ──► the launcher's
 │                            Postgres; drives Invisible Director runs (Anthropic API from PLAN 3.4)
 │
 └─ R2 bucket invisibleassets — the shared system of record every service above reads/writes
    R2 bucket invisible-backups — nightly encrypted backups (GitHub Actions, see "Backups")

 GitHub Actions: runtime release/rollback → R2 `_runtime/`; builds the two RunPod images → GHCR
```

## Services (Railway)

**One Railway project, environment `production`** (consolidated 2026-05-30), so the services
share variables. Railway's commit statuses name it `Invisible Pipeline` (see below); some older
notes call it `Invisible launcher`.

| Service                         | URL                                                                        | Stack                            | Root dir                                                           |
| ------------------------------- | -------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------ |
| **launcher** (Invisible-Engine) | `app.invisiblewall.org`                                                    | SvelteKit / Node (pnpm monorepo) | repo root, build `pnpm --filter launcher-api build`                |
| **atlas-tool**                  | `atlas-tool-production.up.railway.app`                                     | Python (http.server)             | **repo root**, Dockerfile Path `services/atlas-tool/Dockerfile`    |
| **sheet-tool**                  | `sheet-tool-production.up.railway.app`                                     | Python (http.server)             | **repo root**, Dockerfile Path `services/sheet-tool/Dockerfile`    |
| **Invisible-test-Server**       | `games.invisiblewall.org`                                                  | Node (`server.mjs`)              | **repo root**, Dockerfile Path `services/test-server/Dockerfile`   |
| **director-worker**             | none (private) — **the owner creates it**, see "Invisible Director worker" | Node 22 (`src/main.ts`)          | **repo root**, Dockerfile Path `services/director-worker/Dockerfile` |
| **Postgres**                    | internal (`postgres.railway.internal`)                                     | Postgres                         | —                                                                  |

All deploy from GitHub `Invisible-Wall-SL/Invisible-Engine`, branch `main`, **auto-deploy on push**.

Outside Railway: the **RunPod Serverless endpoint** (Atlas Maker / Flipbook generation — see
`COMFY_TRANSPORT` below) and the **R&D pod fleet** (§ "ComfyUI R&D pod"), both run images that
GitHub Actions builds into **GHCR** (`atlas-comfy-worker.yml`, `atlas-comfy-pod.yml`). The
**online engine** is not a service at all: `runtime-release.yml` builds it into R2 as a versioned
release the test server serves (see "Runtime releases" in
[design/games-deploy](design/games-deploy.md)).

### ⚠️ launcher build-time binary: `ffmpeg-static` (2026-09-23)

The launcher caps the bitrate of exported audio (`audioTranscode.ts`), which needs an `ffmpeg`
binary. `ffmpeg-static` does **not** vendor it — its `install.js` DOWNLOADS an ~83 MB binary from
GitHub Releases during install. Two consequences for a deploy:

- **It only runs because `ffmpeg-static` is in `onlyBuiltDependencies`** (root `package.json`).
  pnpm 10 blocks postinstall scripts by default; without that entry the package installs, the
  path it exports points at a file that does not exist, and the transcode silently no-ops
  (`capAudioBitrate` returns null ⇒ audio ships verbatim — degraded, not broken).
- **The Railway build now depends on GitHub Releases being reachable.** If that download fails
  the build may still succeed with no binary, so the symptom is "audio stopped shrinking",
  not a red build. Verify after a deploy by re-exporting a project's sounds and checking that a
  known over-encoded file came back smaller.

`SOUND_TRANSCODE=0` disables the whole step if the dependency ever becomes a problem.

**Every repo-root service now sets Watch Paths** (2026-09-07), so a push only rebuilds the services whose own files changed:

| Service                   | Watch Paths                                                 |
| ------------------------- | ----------------------------------------------------------- |
| **atlas-tool**            | `/services/atlas-tool/**`, `/services/_shared/**`           |
| **sheet-tool**            | `/services/sheet-tool/**`, `/services/_shared/**`           |
| **Invisible-test-Server** | `/services/test-server/**`, `/scripts/mock-rgs-server*.mjs` |
| **director-worker**       | `/services/director-worker/**`, `/packages/director-costs/**` |

Each list is exactly what that service's Dockerfile `COPY`s, so **a new build input needs a new watch path** or the service will quietly keep deploying the old code. The **launcher** deliberately has none: it builds from the whole pnpm workspace (`apps/`, `packages/`, the lockfile, turbo config), and a partial list there would strand a real change.

> ### ⚠️ The launcher has no healthcheck, so every push to `main` is a brief launcher outage
>
> Because it watches no paths, **the launcher rebuilds on every push** — including the engine pushes that trigger a runtime release, and it is the slower of the two. On `13571da2` the release went green at **12:48:47Z** and the launcher only answered at **12:50:31Z**: a 104s window in which `/api/editor/runtime` answers 502 or refuses the connection. An online game booted in that window used to fall straight through to the engine's sample game — no project art, no project config — which is where "my runtime release wiped the game" comes from (see [engine history, 2026-09-18](status/engine-history.md)). The game now retries for ~75s and says so on screen when it still can't get through, but **the window itself is still open**.
>
> **The fix is a Railway healthcheck on the launcher service** (Settings → Deploy → Health Check Path `/api/health`, timeout 300s), so Railway holds the old container until the new one is ready. Since 2026-09-29 [`/api/health`](../apps/launcher-api/src/routes/api/health/+server.ts) is a **readiness** check: 200 only when Postgres answers AND its recorded migrations reach the newest one the build carries — so the same setting also keeps a build whose migration failed from ever going live (see "Monitoring & error tracking" below). NOT SET as of 2026-09-29 — verify in the dashboard before assuming the window is closed.

Until then every push to `main` rebuilt every service — a docs-only or engine-only commit still rebuilt all the Python services, and for `atlas-tool` that meant killing whatever it was rendering (see the box below). That is what makes builder flakes visible here: on 2026-08-20 a since-retired Python service failed the build of `67799605` (an engine-only commit touching nothing in its image) with **no build logs at all** and Railway's own "Diagnosis failed for this deployment" — while `atlas-tool` built the same commit from the same repo-root context minutes later. **A failed build with an empty build log is Railway's builder, not our Dockerfile** (a bad `COPY`/`RUN` always prints); the fix is deployment ⋮ → **Redeploy**, and the last good deploy stays live meanwhile. The **Skipped Builds** feature flag would cut the remaining pointless rebuilds (the launcher's).

> ### ⚠️ A rollout is a container swap, and `atlas-tool` holds live render state
>
> The Flipbook video runner keeps its sessions in memory, so **a rebuild of this service kills whatever it is rendering**. Until Watch Paths were set (above), every push to `main` did that — including a docs-only push. On **2026-09-07** three rollouts (`326daa95` live 13:56:49Z, `ff64e95c` — nine lines of this file — live 15:37:46Z, `a3b2691c` live 16:35:29Z) each landed mid-session: the GPU finished all five orphaned jobs and uploaded them to R2, nothing was left to collect them, and by the time the sessions were reopened RunPod had dropped every job record (it keeps a finished job ~30 min) and answered `404 job not found` — which the tool reported as _"lost contact with RunPod for 182s"_. It had been happening all week: **thirteen** finished renders were stranded in their hand-off slots between 2026-09-02 and 2026-09-07 — five that day, eight from earlier in the week, each of them stranded by a rollout that caught a session with jobs in flight. Two sessions ran concurrently as a result, six jobs against three workers, one of them queued 46 min and then ran 100 min before it was cancelled.
>
> The runner now [re-attaches at boot](../services/atlas-tool/video_runner.py) and collects a render straight from its R2 hand-off slot whenever the job ends without handing one back — a gone record, a FAILED/TIMED_OUT job that had already uploaded, an empty payload, a late stop, even a job whose id was lost — so a swap costs minutes rather than the render. A **boot** only ever _collects_ — the sweep never starts a variation its author had queued. Note the limit of that: a READ adopts the ordinary way (`collect_only=False`), so a browser left open on the session does resume the queued tail — not instantly, though. While the collect-only pass is running the session is in memory and a read returns it without adopting; the tail starts on the first poll (≤2.5 s) after the collected job finishes and the session is handed back. Unattended, nothing is spent; attended, it finishes as its author asked. **That is damage control; the fix is the Watch Paths above**, which now keep an unrelated push from touching this service at all. A push under `services/atlas-tool/**` or `services/_shared/**` still swaps the container, so don't ship one while a video session is running.

**How to tell whether a push actually deployed, without the Railway dashboard.** Railway writes to TWO GitHub APIs, and they are not equally useful. **Use the COMMIT STATUS api — it names the service and says what happened to it in words:**

```bash
gh api repos/Invisible-Wall-SL/Invisible-Engine/commits/$(git rev-parse HEAD)/status \
  --jq '.statuses[] | "\(.state)\t\(.context)\t\(.description)"'
```

```
success  Invisible Pipeline - Atlas Tool     Success - atlas-tool-production.up.railway.app
success  Invisible Pipeline - Launcher       Success - app.invisiblewall.org
success  Invisible Pipeline - Sheet Tool     No deployment needed - watched paths not modified
```

**Read the DESCRIPTION, not the state — a SKIPPED service also reports `success`.** That is the trap this whole section used to fall into: counting `success` rows counts the services that did nothing. Three strings, observed on `bb74ebc2` (2026-09-09):

| description                                         | what it means                                           |
| --------------------------------------------------- | ------------------------------------------------------- |
| `Success - <domain>`                                | this service really deployed, and that is where it went |
| `No deployment needed - watched paths not modified` | **skipped** (state is still `success`)                  |
| `Railway is deploying the service`                  | still building (state `pending`)                        |

So a push is fully out when **every service you expected to build says `Success -`** and the rest say `No deployment needed`. Which services _should_ build depends on the PATHS the commit touches (Watch Paths, above): `services/_shared/**` builds three — launcher, atlas-tool, sheet-tool (the test-server does not watch `_shared`); a single service's dir builds that one plus the launcher; `docs/**` or `apps/**` builds only the launcher. Their rows settle independently and minutes apart — on `bb74ebc2` the three skips landed at once, Atlas Tool went green at +1m, the Launcher a little after — so a half-`pending` reading is mid-rollout, not a failure. (No `failure`/`error` row appears in the last 20 commits on `main`, so the wording Railway uses for a failed build is not recorded here; treat anything that is neither `success` nor `pending` as one and read its description.)

**The deployments API is the WEAKER read — don't reach for it first.** `deployments?sha=…` → `/deployments/<id>/statuses` returns bare `in_progress` rows with an empty description, no service name and no commit, only a project URL: the repo-root Python services share ONE deployment record (`Invisible Pipeline / production`) and the launcher has a record of its own, so _which_ service succeeded is genuinely not recoverable there. It also leaves stale `in_progress` rows behind forever — on `bb74ebc2` it still showed two `in_progress` and no `success` at a moment when the commit-status API already had Atlas Tool green. Those rows mean nothing. Everything the old "count `success`" advice was working around is an artefact of this endpoint, not of Railway.

**Rows still `pending` are NOT proof of a flake — deploys are wildly uneven, so wait before re-triggering.** (Measured before the commit-status read above, by counting `success` on the deployments API — hence the `n/4` shorthand; the patience is what carries over.) Measured the same day: `234e4c69` went 4/4 in **6 minutes**, while `ec07abaa` three minutes later was still at **1/4 after 27 minutes** and only reached 3/4 at **+34**. Both were fine. Give a deploy **half an hour** before treating it as the builder flake documented above; re-pushing early just queues another round of builds behind the ones already running, which is what makes the next one look stuck too.

**Then verify the RUNNING code, not the build:**

- **launcher** — `curl -s https://app.invisiblewall.org/_app/version.json` returns `{"version":"<ms epoch>"}`, SvelteKit's build stamp. Decode it (`new Date(Number(v))`); if it is minutes old, this deploy is live. This works for ANY launcher change, unlike probing a route for a 404 → 401 flip, which only proves a deploy when the change ADDS a route.
- **atlas-tool / sheet-tool** — `GET /healthz` (gate-exempt since 2026-09-29) names the running commit (`"commit"`, 12 chars of `RAILWAY_GIT_COMMIT_SHA`), the direct answer to "did my commit deploy?". Every other path needs a launcher session, so the only proof of BEHAVIOUR is exercising the change through the launcher, signed in. The commit-status read works too and needs no Railway token:

  ```bash
  gh api repos/Invisible-Wall-SL/Invisible-Engine/commits/$(git rev-parse HEAD)/status \
    --jq '.statuses[] | select(.context | test("Atlas Tool|Sheet Tool")) | "\(.state)\t\(.context)\t\(.description)"'
  ```

  That is the commit-status read from the top of this section, narrowed to the service you care about: `Success - atlas-tool-production.up.railway.app` is Railway naming the service AND the domain it rolled out to, which is exactly the "did my commit deploy?" answer this bullet needs. It still says nothing about whether the change WORKS — for that, exercise it through the launcher, signed in. (The older recipe here read `/deployments/<id>/statuses` and could not break out which service deployed; see the weaker-read note above for why. 2026-09-07: `9489570b` went green ~5 min after the merge; 2026-09-09: `bb74ebc2`'s Atlas Tool row was green ~1 min after, while the deployments API still showed only stale `in_progress`.)

**⚠️ atlas-tool + sheet-tool build from the REPO ROOT (since 2026-05-31, fix #3).** Both Python tools now share `services/_shared/iw_common/` (storage, banner, ComfyUI client headers, thread-local context base — see each tool's `cloud_paths.py` thin layer). For the Dockerfile to `COPY services/_shared/iw_common`, the build **context must be the repo root**, so each service's Railway **Root Directory = repo root** and **Dockerfile Path = `services/<svc>/Dockerfile`** (Settings → Build). The Dockerfiles `COPY services/<svc>/requirements.txt`, `COPY services/_shared/iw_common ./iw_common`, then `COPY services/<svc>/ .` with `ENV PYTHONPATH=/app`. **This is a COUPLED change:** the new Dockerfiles only work once the Root Directory is flipped, and the old subdir setting only works with the old Dockerfiles — flip the setting and deploy the new commit together (Railway keeps the last good deploy live if a build fails, so there's no outage, just a failed build until both sides match).

**⚠️ Launcher build note (monorepo):** the launcher service's **Root Directory must be the repo root** (not `apps/launcher-api`) so Railpack sees `pnpm-lock.yaml` + `packageManager: pnpm@10.5.0` and uses pnpm; with a custom **Install Command** `pnpm install --frozen-lockfile`. If Root Directory is the subdir, Railpack falls back to `npm install` which chokes on `workspace:*`. The launcher's tool-URL env vars also have **code defaults** in `env.ts` pointing at the `*-production` domains, so the launcher works even if a Railway var doesn't apply.

### Shared Variables (define once per environment, reference with `${{shared.NAME}}`)

Set at project → Settings → Shared Variables (environment `production`), referenced by each service. Shared: `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `COMFY_URL`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`, `COMFY_ORG_API_KEY`, `ATLAS_TOOL_SIGNING_SECRET`, `SHEET_TOOL_SIGNING_SECRET` (launcher + the one tool each — see "Tool launch tokens"), and until the 2026-10-13 cut-over the legacy `ATLAS_TOOL_SECRET`, `SHEET_TOOL_SECRET`. Per-service (not shared): launcher URLs (`ATLAS_TOOL_URL`/`SHEET_TOOL_URL`/`ORIGIN`/`DATABASE_URL`), `ATLAS_PROJECT`/`ATLAS_OUTPUT_PREFIX`/`ATLAS_STAGING`, `SHEET_PROJECT`/`SHEET_STAGING`, `DEFAULT_CKPT`. `PORT` is injected by Railway — never set it.

| Var                 | Service        | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `COMFY_CATALOG_URL` | **atlas-tool** | **Optional override — normally leave UNSET.** With _Run generation on_ = RunPod, **⟳ Refresh model lists** asks the RunPod API which pods are RUNNING and reads `/object_info` from the first that answers, deriving the address from the pod id (`https://<id>-8188.proxy.runpod.net`) exactly as the launcher does — so there is no pod id to copy anywhere and nothing goes stale when the fleet changes. Any running pod is a valid reader: the fleet shares the Network Volume (`Invisible_RunPod_Storage`) that the serverless workers mount, so its model list IS what a render will load. Set this only to PIN a specific reader (e.g. the always-on CPU volume pod that `COMFY_VOLUME_URL` points at) or to reach one the RunPod API can't list; a pinned URL is tried before discovery. Strictly read-only either way — a GraphQL _query_ plus `GET /system_stats` + `GET /object_info` — so it can never start, resume or bill a pod. Not consulted for _My computer_, whose lists come live from `COMFY_URL` (the tunnel). **A value that is not an http(s) base URL is ignored** (logged, then pod discovery takes over) — it was once set to the Network Volume's S3 endpoint + bucket pasted together, which can never answer `/object_info`. |

### Railway environments — history (resolved)

There were briefly **two environments** (`production` + a stray `atlas`), each with its OWN Postgres — this caused a prod outage on 2026-05-30 when a migration was applied to the wrong env's DB, then a wrong-environment confusion. The stray `atlas` environment was **deleted**; only `production` remains. **LESSON:** a Railway _environment_ is a full separate copy incl. its own Postgres → always confirm you're on `production` before migrating, and apply schema migrations to the production DB **before** deploying schema-dependent code (else authed requests 500).

### Auto-migrate on boot (2026-06-13)

The launcher now applies pending Drizzle migrations **itself**, at server startup, before serving any request — via the SvelteKit `init` server hook (`src/hooks.server.ts` → `runMigrations()` in `src/lib/server/db/migrate.ts`, the `drizzle-orm/postgres-js` programmatic migrator pointed at the committed `drizzle/` folder). So pushing a schema migration + its schema-dependent code in ONE deploy is now safe — the new code's first boot brings the prod schema up to date itself; **no manual `db:migrate` step**. Properties: never crashes boot (a missing `DATABASE_URL`, unlocatable folder, or migration error is logged, reported to Sentry, and turns `/api/health` red — 503 — so with the Railway healthcheck set the failed build is never promoted and the previous container keeps serving; a crash-loop would instead be an outage whenever no healthcheck is set); idempotent + transactional (tracked in `__drizzle_migrations`). **The workflow is `pnpm --filter launcher-api db:generate` → commit the new `drizzle/` file → deploy**; never `db:push` against production (it records nothing in the journal — the incident below). `/api/health` reports `schema: current` once the boot migrator has applied every migration the build ships. (Always-confirm-the-env lesson above still holds: the migrator targets whatever `DATABASE_URL` the service runs with.)

> ⚠️ **The migrator compares by `created_at` THRESHOLD, not per-hash** (verified in `drizzle-orm` `pg-core/dialect.js` `migrate()`): it reads the newest `created_at` in `drizzle.__drizzle_migrations` and applies every journal entry whose `when` (folderMillis) is greater. So an **empty** migrations table makes it replay from `0000`. **This bit us on 2026-06-13:** prod's schema was originally created with `db:push` (which writes the tables but records NOTHING in `__drizzle_migrations`), so the first auto-migrate boot tried to replay `0000` → `relation "sessions" already exists` → aborted → `0010` (the `game_type` column) never applied → every authed route 500'd. **`db:migrate` would NOT have fixed it** — it replays from the same empty journal. The real fix is to **baseline** an already-provisioned DB: apply the pending migration's effect, then insert ONE row with `created_at` = the latest applied migration's `when`. We ran (2026-06-13): `ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "game_type" text;` + `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) SELECT 'baseline-0010', 1781337176046 WHERE NOT EXISTS (…)`. Prod is now baselined through `0010`, so future migrations apply cleanly on deploy.
>
> **SELF-HEALING GUARD (built 2026-06-13, `migrate.ts` `baselineIfPushProvisioned`):** `runMigrations()` now does this baseline AUTOMATICALLY at boot — if `__drizzle_migrations` is empty BUT a core table (`public.users`) already exists (the `db:push` signature), it records one baseline row at the latest journal timestamp before calling `migrate()`, so it never replays from `0000`. A truly empty DB (no app tables) is left alone → migrates from `0000` as normal; a migrate-managed DB (populated journal) is untouched. So a NEW `db:push`-provisioned Postgres (e.g. a fresh environment) no longer needs the manual baseline — but running the first `drizzle-kit migrate` against a truly empty DB is still the cleanest provisioning path.

> ⚠️ **Railway gotcha (cost us hours):** adding an env var only **stages** it; you must click the **"Apply changes / Deploy"** banner. A plain "Redeploy" does NOT apply staged vars. When a var "isn't working", verify what the _runtime_ actually sees rather than re-checking the dashboard. For launcher tool URLs we now keep a **code default** (`env.ts`) so it works regardless.

## Invisible Director worker (2026-10-04, PLAN 3.1)

`services/director-worker` drives Invisible Director runs (ADR-0001, ADR-0003). It loads the runtime
agent definitions (`agents/*.md`, validated against `pricing.json` and the tool catalogue
`src/tools.ts`), claims runs from `director_runs` with a lease (`SELECT … FOR UPDATE SKIP LOCKED`),
and wakes on Postgres `LISTEN director_wake` (an AFTER INSERT trigger on `director_events` sends it
for owner rows and `job_done`, migration 0025) plus a 60 s sweep. It then drives the run's turn loop
(PLAN 3.4–3.7): one streamed Anthropic call per agent turn, the history stored after every turn, the
adapters called on the launcher with a deterministic `opId`, one `director_spend` row per response
(unique `request_id`), and a pause before any call or GPU submit that would reach the run's cap. It
offers an agent only the ops `GET /api/director/adapter` lists, and claims only runs with work, so a
run waiting on the owner or a GPU job costs nothing. A drive that fails (the launcher or the API
unreachable, an adapter answer that leaves an op's outcome unknown) changes nothing and holds the
run back 15 s, doubling to 2 min; after 6 failures in a row the run pauses with an `error` event
naming the cause. On SIGTERM it stops claiming and gives turns in flight 20 s to finish.

- **Database:** the launcher's Postgres. The worker owns no migrations: its tables are in the
  launcher schema, and the **launcher applies them at boot**. So on a push that adds a Director
  migration the worker can come up first and see the old schema. Its sweep fails, `/healthz` is
  503, and with the healthcheck set Railway keeps the previous worker. Redeploy the worker once the
  launcher is up if it stays stuck.
- **Image:** `node:22-slim` with the service folder, `npm install --omit=dev` of its npm
  dependencies (`postgres`, `@anthropic-ai/sdk`), and the one workspace package it uses,
  `packages/director-costs`, copied to `/packages` and linked into `node_modules` (Node strips
  types only outside `node_modules`). The TypeScript runs directly with `--experimental-strip-types`. Locally: `pnpm --filter director-worker start`;
  `pnpm --filter director-worker build` is the typecheck.
- **Replicas:** safe to scale. The lease keeps one driver per run, and
  `pnpm --filter director-worker prove:lease` proves it against a scratch database;
  `prove:turns` proves the turn loop there with a fake model. Both run in the `Director worker`
  workflow on a `postgres:16` service container.

**Owner set-up (once):** open the **existing** Railway project, the one whose canvas already shows the
launcher, atlas-tool, sheet-tool, Invisible-test-Server and Postgres. Inside it, **+ Create → GitHub
Repo** → this repo.

Do **not** create a new project for the worker. A separate project can't reference `Postgres`, can't reach
the database privately, and can't share variables with the launcher.

Then, on the new service:

1. **Name** `director-worker`. **Settings → Source:** Root Directory = repo root (empty), branch
   `main`. **Build:** Builder = Dockerfile, Dockerfile Path = `services/director-worker/Dockerfile`.
   **Watch Paths:** `/services/director-worker/**` and `/packages/director-costs/**`.
   - Root Directory **must stay empty**. With `/services/director-worker` there, the build fails with
     `"/services/director-worker/pricing.json": not found`, because every `COPY` path in the
     Dockerfile starts at the repo root.
   - If the build log shows **Railpack** instead of Docker steps, the Builder isn't set to
     Dockerfile yet.
2. **Networking:** no public domain. Nothing calls the worker; it only calls out.
3. **Deploy → Healthcheck Path** `/healthz`, timeout 120 s. It is liveness: 200 when the process is
   up and the run tables answer, whether or not runs are driven. `"driving": false` in its body
   means `ANTHROPIC_API_KEY` or `DIRECTOR_SERVICE_TOKEN` is unset, so the worker claims nothing
   until both are set; that is a state to read, not a failed deploy. 503 is reserved for no
   `DATABASE_URL` or run tables that do not answer (a schema still behind), so Railway then keeps
   the previous worker.
4. **Variables:** `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`; `DIRECTOR_SERVICE_TOKEN` = the
   launcher's value (or make it a Shared Variable both reference); `ANTHROPIC_API_KEY` = the agents'
   key. Then **Apply changes / Deploy**.
5. **Verify:** the deploy log shows `"msg":"agents loaded"` with seven agents and `"msg":"sweep"`,
   and the service's commit status reads `Success -`.
   - `/healthz` 503 with **`"msg":"DATABASE_URL is unset"`** in the log means `DATABASE_URL` is
     missing. If `${{Postgres…}}` doesn't autocomplete, the service is in the wrong project.
   - `/healthz` 503 with **`"msg":"sweep failed"`** (or **`"run tables do not answer"`** while not
     driving) means the launcher hasn't applied the Director migrations yet. Redeploy the launcher,
     then the worker.
   - `/healthz` 200 with **`"driving":false`** and **`"msg":"ANTHROPIC_API_KEY or
     DIRECTOR_SERVICE_TOKEN is unset"`** in the log: the worker is up and idle. Set both
     (`DIRECTOR_SERVICE_TOKEN` must equal the launcher's), then redeploy.

## ComfyUI tunnel (optional — a person's own GPU)

Production generation runs on the RunPod Serverless endpoint (`COMFY_TRANSPORT=serverless`, below).
The tunnel is what ⚙ _Run generation on_ = **My computer** reaches; nothing in production depends
on it being up.

- **Local:** ComfyUI on `localhost:8188` + a `cloudflared` connector, both managed by the desktop
  Invisible Launcher.
- **Tunnel:** Cloudflare **named tunnel** `comfy-gualtiero`, ingress `comfy.invisiblewall.org → http://localhost:8188`.
- **Auth:** Cloudflare **Access** (Service Auth) in front. Backends send `CF-Access-Client-Id` / `CF-Access-Client-Secret` headers (`CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`).
- **⚠️ User-Agent gotcha (cost us hours):** Cloudflare blocks the default `Python-urllib/x` UA with **403**. All ComfyUI calls must send a custom UA (`InvisibleAtlas/1.0`). Handled in `iw_common.comfy.cf_headers()`.
- **ComfyUI models are mirrored to R2 (B36):** model files live at R2 `comfyui-models/<subfolder>/<file>` (subfolders match ComfyUI's `Shared\Models` layout: `checkpoints/`, `loras/`, `vae/`, `controlnet/`, …). Seed/refresh with `py scripts/seed-comfyui-models.py` (owner, `R2_*` env). The launcher pulls them via `GET /api/launcher/models-manifest` (admin-only; returns each model with a 6-h presigned R2 URL) → **Sync models** button → downloads R2→client directly (not through Railway) → restart ComfyUI.
  - **The mirror has four arcs, and the fourth was missing until 2026-09-07.** `seed-comfyui-models.py` is desktop→R2, `runpod/pull-models.py` is R2→volume, **Sync models** is R2→desktop — all one way, out of the desktop. Nothing went **volume→R2**, so anything BORN on the pod could never reach a desktop or the serverless worker: a LoRA trained there, and every set `fetch-models.py` pulls straight onto the volume (which bypasses R2 on purpose — routing 50 GB of public weights through a home uplink and back "costs two transfers and buys nothing"). `runpod/push-models.py` closes it. **Dry run by default** (`--apply` to write), because it rewrites the manifest the launcher serves to every desktop; it never deletes, MERGES the manifest rather than replacing it, skips files already in R2 at the same size, and caps at 5 GB (`--include-large` to override) since the case it exists for is the small irreplaceable artifact, not a public checkpoint anyone can re-fetch. A file already in R2 but absent from the manifest is re-indexed with no transfer — exactly the state `fetch-models.py` leaves behind. **Not baked into the pod image** (the Dockerfile copies only `services/atlas-comfy-pod/tools/`), so it is pasted onto a pod. **Caveat:** the manifest is read-modify-write, so two runs at once — or one racing `seed-comfyui-models.py` — can drop entries; these are owner-run maintenance scripts, and the seeder has always had the same shape.
- **Fresh-machine setup is automated (B35):** the desktop Invisible Launcher auto-installs `cloudflared.exe` (official standalone, into `_tools/`, no admin) and provisions `~/.cloudflared/{config.yml,<id>.json,cert.pem}` by fetching the credentials bundle from the portal after owner login (`POST /api/launcher/login` → short-lived token → `GET /api/launcher/tunnel-bundle`, role `admin` only). The bundle lives in R2 at `tools/invisible-launcher/cloudflared-bundle.json` — (re)seed it with `node apps/launcher-api/scripts/seed-tunnel-bundle.mjs` (owner, `R2_*` env). On write the launcher repoints the `credentials-file:` line to the new machine's path.
- **⚠️ ComfyUI-Manager is REQUIRED for Blueprints model auto-install (B43 phases 1+4):** the local ComfyUI must have **[ComfyUI-Manager](https://github.com/Comfy-Org/ComfyUI-Manager)** installed, at **security level "middle" or below** (`security_level = middle` — or lower — in ComfyUI's `user/default/ComfyUI-Manager/config.ini`; `high`/`strong` returns **403** on the install/reboot calls). The Atlas Maker's blueprint "prepare" step drives Manager's queue API over this same tunnel (`POST /manager/queue/install_model` → `/queue/start` → poll `/queue/status` → `POST /manager/reboot`) to download a blueprint's declared `models[]` before generating. **Two boundaries to know:** (a) Manager only auto-installs models whose _(`save_path`, `base`, `filename`)_ triple is in its curated `model-list.json` catalog — custom Civitai/gated-HF URLs that aren't catalogued fall to a manual-download checklist by design; (b) if Manager is absent (`404` on `/manager/*`), unreachable, or a model stays missing after reboot, the step degrades to a readable checklist and never crashes. Kill-switch: `BLUEPRINT_AUTO_INSTALL_MODELS` env on atlas-tool (default **enabled**; set falsy to emit the checklist only, since reboot interrupts in-flight ComfyUI work). See `docs/design/invisible-blueprints.md` §4.
- TODO: install cloudflared as a Windows service (`cloudflared service install`) so the tunnel survives reboots.

## ComfyUI R&D pod (RunPod)

On-demand RunPod GPU **pods** running the **interactive ComfyUI web UI** for artist R&D — the surface where an artist builds/tunes a workflow that later becomes an Atlas Maker blueprint. It is **distinct from `services/atlas-serverless`** (the headless serverless worker that runs baked blueprints, `COMFYUI_REF=v0.33.1`) and from the local tunnel above. Only these pods expose an interactive UI. Each is reached through RunPod's proxy at `https://<podId>-8188.proxy.runpod.net`. See `docs/design/runpod-comfyui-backend.md` and `docs/design/comfyui-serverless.md`; current state in `docs/status/comfyui.md`.

- **This is now a FLEET, not one pod.** The launcher keeps several pods on **different GPU cards** and the artist starts whichever has a free GPU. Two operational cautions: **(1) run only ONE pod at a time when they share a Network Volume** — concurrent pods writing the same volume (models + custom nodes) risk write conflicts; **(2) a stopped pod does NOT reserve its GPU**, so a Start can fail ("not enough free GPUs") on scarce cards (e.g. Blackwell) — which is exactly why we keep more than one card.
- **The fleet is admin-managed in the DB, not env** — `app_settings` key **`runpodPods`** = JSON `[{id,label}, …]`, edited under the launcher's **Admin → Settings → "ComfyUI R&D pod fleet"** (add/remove pods, each = pod id + label like "RTX 4090"). Each pod's ComfyUI URL is **derived from its id** (`https://<id>-8188.proxy.runpod.net`); no per-pod URL is stored. `RUNPOD_POD_ID`/`COMFY_RND_URL` are now only the **legacy single-pod fallback** (synthesized as a "Default" pod when `runpodPods` is empty).
- **Every pod attaches Network Volume `Invisible_RunPod_Storage`** (persists ComfyUI + models + custom nodes across stop/start). The fleet spans several cards (RTX PRO 4000, RTX 4090, RTX PRO 4500 Blackwell 32 GB); the current list is in Admin → Settings.

### "Access to <podId>-8188.proxy.runpod.net was denied" — clicking through from a tool

**Symptom:** the pod link 403s (Chrome: _"You don't have authorisation to view this page"_) when you click it **from a page** — the launcher's `/comfyui` card, the Atlas Maker, anywhere — but pasting the SAME url into a fresh tab works. Nothing is wrong with the pod.

**Cause:** RunPod's proxy rejects any browser request that arrives with **`Sec-Fetch-Site: cross-site`**. The browser stamps that header from the _initiator_ origin, so a click from `app.invisiblewall.org` gets it and an address-bar navigation (`Sec-Fetch-Site: none`) does not. Measured against a live pod:

| request                                       | result  |
| --------------------------------------------- | ------- |
| top-level nav, `Sec-Fetch-Site: cross-site`   | **403** |
| iframe, `cross-site`                          | **403** |
| iframe, `same-origin`                         | 200     |
| top-level nav, `Sec-Fetch-Site: same-site`    | 200     |
| WebSocket upgrade, cross-origin `Origin:`     | 101     |
| no `Sec-Fetch-Site` (address bar / fresh tab) | 200     |
| server-side: curl / undici / node / no UA     | 200     |
| server-side: `User-Agent: Python-urllib/*`    | **403** |

Only `cross-site` fails — `none`, `same-origin` and `same-site` all pass, and a **WebSocket upgrade passes cross-origin** because browsers send no `Sec-Fetch-*` on a WS handshake (so ComfyUI's progress socket was never affected by this rule, only page loads were). The `same-site` row is what makes a hostname under `invisiblewall.org` a possible fleet-wide alternative to per-pod TCP; it would need a Cloudflare host-header rewrite per pod and would break when pod ids change, which is why TCP won.

**It is NOT an iframe problem** — the destination is irrelevant (a `same-origin` iframe returns 200); only the initiator origin matters. `/comfyui` is correctly full-page and needs no change. Don't "fix" this by reworking framing.

The 403 is a bare `Content-Length: 0` from `Server: cloudflare` with **no block page and no `cf-mitigated` header**, i.e. RunPod's own edge anti-hotlink rule, not a Cloudflare WAF challenge — so no User-Agent or Referer tweak gets past it.

**Server-side calls are unaffected, so generation does not break** — only clicking through from a page does. But note the last row: the pod proxy is Cloudflare-fronted like the old tunnel was, so the original **`Python-urllib` UA → 403** trap applies here too. Every Python call site already sends `InvisibleAtlas/1.0` via `iw_common.comfy.cf_headers()`; never add a ComfyUI call that skips it.

**What to do — expose 8188 as a TCP port** (RunPod → Edit Pod, alongside the HTTP one). That yields a direct `http://<ip>:<publicPort>` which is not behind the proxy, so the cross-site rule never applies **and** the `/ws` drop above stops too. The `/comfyui` card picks it up automatically: `podProbe` reads `runtime.ports` on each poll and `directUrlFromPorts` (`$lib/server/runpod.ts`) turns a TCP-typed, public, `privatePort: 8188` entry into the link. RunPod assigns that external port **at each resume and it changes every start**, so it is read live and never cached — unlike the proxy URL, it cannot be derived from the pod id.

**Configure every pod as `HTTP 8189` + `TCP 8188`.** RunPod will not give one container port both, and both are needed — TCP for the clickable direct link, HTTP for the proxy hostname the launcher probes and a human pastes. The pod image forwards `8189 → 8188` (`services/atlas-comfy-pod/tools/port-forward.py`, started by `start.sh`) so ComfyUI answers on both. **Never put 8188 in the HTTP box**: exposing it as TCP removes its HTTP proxy (that hostname answers 404), and a pod set to `HTTP 8188 + TCP 8188` — or TCP-only — is unreachable by every route at once while ComfyUI runs fine. The launcher probes 8189 then 8188 and falls back to the direct endpoint, so an older pod still works.

**TCP 8188 is therefore REQUIRED pod config, not a nicety** — a pod without it cannot be opened from the launcher at all. The card marks such a pod **⚠ not reachable** and states the one-time fix, rather than degrading into a copy-the-url chore that would read as normal UX.

A launcher **same-origin proxy** would also work (the `same-origin` row above proves it, and it is rule 3's sanctioned "same-origin serve"), but proxying ComfyUI including its `/ws` socket is real work — don't start there.

> Unconfirmed: whether this is **new** RunPod behaviour or something we simply had not hit. It could not be compared against an older pod (the one tried was stopped, returning 404). Starting an old pod and clicking through from the launcher would settle it.

### Debugging "ComfyUI disconnected" on a pod

ComfyUI reports execution errors **over the `/ws` progress socket**, so when that socket drops the failing node never turns red and you get a generic disconnect instead of the error — even though the server recorded it. `/history` keeps it, and there are now two ways to read it back.

**In the browser, automatically** — the baked image ships **`ComfyUI-Invisible-ErrorRecall`** (`services/atlas-comfy-pod/custom_nodes/`), a frontend-only extension that re-checks `/history` on **reconnect** (modal) and on **page load** (toast only), then highlights the failing node and centres the canvas on it. It never mutates the graph — highlighting goes through `app.lastNodeErrors`, the transient channel ComfyUI uses for `/prompt` validation errors — and every frontend API it touches is feature-detected. An error you already saw live is not replayed. **A pod only gets it after the image rebuilds AND that pod is redeployed**; to try it on a pod that's already up, copy the folder to **`/workspace/ComfyUI/custom_nodes/`** and restart ComfyUI — the volume test lane, so it survives a container recreate (`/ComfyUI/custom_nodes/` does not). See the pod README.

**From a terminal** — for when the browser can't reach the pod at all. **`node scripts/comfy-last-error.mjs https://<podId>-8188.proxy.runpod.net`** reads it back: the failing node's id + class + **canvas title**, the exception, that node's inputs and what feeds it, and the traceback. Its three outcomes each diagnose a different layer — a failing node (real graph error) / "last run did NOT fail" (transport only, the render probably finished) / "No history" (ComfyUI **restarted**, i.e. the process died — go to `tail -200 /workspace/comfyui.log` for `torch.OutOfMemoryError` or `Killed`). Same `/history` read the Atlas Maker uses (`batch_atlas.py`).

Three causes worth ruling out in order, before suspecting the graph:

1. **Is the pod Spot/Interruptible?** RunPod reclaims those the instant someone outbids — mid-render, silently, nothing in any log. Use **On-Demand** for R&D.
2. **The RunPod proxy drops idle WebSockets.** `<podId>-8188.proxy.runpod.net` is an HTTP proxy and ComfyUI's `/ws` goes quiet during a long checkpoint load or VAE decode. The render keeps going server-side; only the feed is lost. Expose **TCP 8188** and connect direct to bypass it.
3. **VRAM exhaustion** — `comfyui_controlnet_aux`'s DepthAnything loads outside ComfyUI's memory manager so `/free` can't release it (the reason the serverless worker restarts ComfyUI between jobs; an interactive pod has no such reset).

The launcher's idle auto-stop was a fourth cause until 2026-08-19 — fixed in PR #334, see `docs/status/comfyui.md`.

### ✅ Recommended: deploy the pod FROM the baked image

Deploy each R&D pod from the **baked GHCR image** `ghcr.io/invisible-wall-sl/atlas-comfy-pod:latest` (built by `services/atlas-comfy-pod/` — see its [README](../services/atlas-comfy-pod/README.md)). Everything Python — ComfyUI `v0.33.1`, **cu128 torch (Blackwell, pinned)**, all custom nodes (IPAdapter_plus, RMBG, controlnet_aux, PuLID_ComfyUI, the vendored PuLID-Flux, PuLID-Flux2, ComfyUI-Manager) and the face stack — is **already in the image**, so:

- **It survives RunPod recreating the container on resume.** Hand-installed deps do NOT: a resume changes the container id and wipes site-packages (`tqdm`/`torch` gone → ComfyUI crash-loops). Models are safe (on the volume); only container packages are lost. The baked image is the permanent fix — the manual runbook below is only a fallback for a pod that predates the image.
- **No "Container Start Command" is needed** — the image auto-starts ComfyUI on 8188 and keeps the container alive (`sleep infinity`), so a ComfyUI crash never locks you out of the terminal.
- Deploy: RunPod → Pods → Deploy → custom image `ghcr.io/invisible-wall-sl/atlas-comfy-pod:latest`, a Blackwell GPU, **attach `Invisible_RunPod_Storage` at `/workspace`**, expose HTTP **8188**. Models stay on the volume at `/workspace/ComfyUI/models` (baked `extra_model_paths.yaml` points there). Adding a model = drop it on the volume; only a new custom **node** needs an image rebuild (push under `services/atlas-comfy-pod/**` → CI rebuilds + pushes). Startup log: `tail -f /workspace/comfyui.log`.

### Launcher integration (the `/comfyui` card)

The launcher's `/comfyui` card lists the fleet and can **start/stop** each pod (RunPod GraphQL `podResume` / `podStop`). The only env var required is the shared API key; pods themselves live in `app_settings.runpodPods` (above). Set on the **launcher-api** Railway service → **Apply changes / Deploy**:

| Var                     | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `RUNPOD_API_KEY`        | RunPod API key used to start/stop every pod (secret; shared across the fleet).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `RUNPOD_POD_ID`         | **Legacy fallback only** — a single pod id, synthesized as a "Default" pod when `runpodPods` is empty. Prefer the admin fleet editor.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `COMFY_RND_URL`         | **Legacy fallback only** — overrides the derived URL for the single `RUNPOD_POD_ID` pod. Not used once a fleet is configured.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `GITHUB_ACTIONS_TOKEN`  | **Optional.** A GitHub token with **`actions: write`** on `GITHUB_ENGINE_REPO`. Powers **Rebuild image** on `/comfyui` (a `workflow_dispatch` of `atlas-comfy-pod.yml`) and reading that workflow's runs. Deliberately NOT the read-only `GITHUB_ENGINE_READ_TOKEN` — dispatching is a write and deserves its own blast radius. **Falls back to `GIT_CLONE_TOKEN`**, which may or may not work: cloning is GitHub's `contents` permission while dispatching is `actions`, so a CLASSIC PAT (`repo` covers both) dispatches, while a FINE-GRAINED one needs "Actions: Read and write" ticked for this repo. It is tried rather than assumed — a 403 says so in the panel, naming the permission. Unset entirely → the button is replaced by a line saying so. |
| `RUNPOD_DATA_CENTER_ID` | **Optional** (e.g. `EU-RO-1`). Scopes the per-card **GPU availability** badge to one region. Stock is reported per GPU _type_, but a stopped pod can only resume where its disk already is, so an unfiltered figure answers a different question. The launcher tries to read each pod's own data centre first and falls back to this; unset, the badge asks globally and says so in its tooltip. The whole fleet shares one region anyway — the Network Volume pins it.                                                                                                                                                                                                                                                                                      |
| `COMFY_VOLUME_POD_ID`   | **Optional — we deliberately leave it UNSET** (see `docs/status/comfyui.md` open item 3). Pod id of an **always-on volume pod** used ONLY to read what's installed for the card's "What's installed" panel (models on the Network Volume + loaded node packs). Point it at a cheap **CPU pod** that mounts the same volume and runs ComfyUI in CPU mode — it never generates, it only answers HTTP — and the panel keeps working with the whole GPU fleet stopped. **We don't run one:** an always-on pod is a fixed monthly cost, and the panel's fallback (any running GPU pod) is the configuration it is actually verified in. Unset → that fallback.                                                                                                    |
| `COMFY_VOLUME_URL`      | **Optional.** Explicit base URL for that reader, overriding the id-derived one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

- **Idle auto-stop is NOT env** — it's **admin-configured** and stored in the `app_settings` table (`runpodIdleEnabled`, `runpodIdleMinutes`, default **20**). An admin toggles it + sets the minutes from the launcher admin UI; the launcher stops an idle pod after that many minutes (a non-empty ComfyUI render queue counts as activity, so a running render is never interrupted).

### ⚠️ Legacy/manual fallback — REQUIRED pod config for a NON-baked pod

> **Prefer the baked image above.** The rest of this section is the **legacy hand-install runbook** for a pod that was created before the baked image (ComfyUI installed by hand on the volume). A pod deployed from `atlas-comfy-pod` needs none of it — no Start Command, no manual pip.

The launcher can **resume** the pod via API but **cannot SSH in** to launch ComfyUI. So a **non-baked** pod's container **Start Command** (Docker container start command, set in the RunPod pod config → **Edit Pod** → _Container Start Command_, or when creating the pod) must run:

```
bash /workspace/start-comfyui.sh
```

(`start-comfyui.sh` lives on the Network Volume, mounted at `/workspace`, and `cd`s into `/workspace/ComfyUI` then launches `python main.py --listen 0.0.0.0 --port 8188`.) **Without this**, pressing **Start** from the `/comfyui` card boots the pod but ComfyUI never comes up — the proxy URL just hangs/502s. This is the single most important pod-config step.

### FLUX.2 / Qwen-Image on an R&D pod

Both are **native in ComfyUI core** from the `v0.33.1` pin (`comfy/ldm/flux` + the built-in `Flux.2 …` blueprints) — no custom node, so nothing to rebuild. Only the weights are missing, and they come from Hugging Face straight onto the Network Volume (not via R2 — no reason to pay two transfers for a public set):

```
python /fetch-models.py --list
python /fetch-models.py --set flux2-klein
```

The script is **baked into the pod image** at `/fetch-models.py` (a pod older than that
image won't have it — rebuild + redeploy, or paste it in). `--dest` defaults to the
volume.

**Wan 2.2 (video) is core-native too** (`comfy/ldm/wan` + the built-in `Text to Video (Wan 2.2)` / `Image to Video (Wan 2.2)` blueprints) — `wan22-t2v`, `wan22-i2v`, `wan22-turbo`, `wan22-ti2v-5b`. Pull `wan22-turbo` alongside a Wan set or the built-in blueprints open with a missing LoRA.

**`pulid-flux2` is the exception to "no custom node".** The FLUX.2 identity adapter needs `ComfyUI-PuLID-Flux2`, which is baked into the image — so unlike every set above, weights alone are not enough and a pod on an older image cannot load them. It is also **R&D-only**: node and weights are MIT, but it depends on InsightFace **antelopev2**, which is non-commercial research only, so attaching a face pulls otherwise-Apache `flux2-klein` into non-commercial. Anything that must ship in a game stays on `qwen-image`.

- **`flux2-klein`** (12.5 GB, **apache-2.0**) — start here. The only FLUX.2 variant that is both licence-clean enough to ever ship in a game (unlike FLUX.1-dev/PuLID, which stay R&D-only) and small enough to run without CPU offload on the fleet's cards.
- **`flux2-dev`** (53.8 GB, **non-commercial**) — quality comparison only. Its ~35 GB of diffusion weights exceed the biggest card we have (32 GB RTX PRO 4500), so ComfyUI falls back to CPU offload and it is slow. **Check the volume has ~54 GB spare first** — it was sized for SDXL/FLUX.1.
- The shared `flux2-vae` file is served from the `Comfy-Org/flux2-dev` repo (licensed `other`, not apache-2.0), so confirm its terms before anything from klein ships commercially.

- **`qwen-image`** (30.1 GB, **apache-2.0**) — the base the cartoon-character pipeline sits on (ComfyUI's built-in "Text to Image (Qwen-Image 2512)" blueprint). ~30 GB on disk but the encoder and diffusion model load in sequence, so peak VRAM is ~20 GB, inside a 24 GB card.
- **`qwen-toon`** (0.6 GB, **apache-2.0**) — renderartist's Toon-Tacular style LoRA for Qwen-Image.

**A LoRA binds to ONE base architecture.** `qwen-toon` declares `base_model: Qwen/Qwen-Image-2512`, so it loads onto `qwen-image` and **not** onto FLUX.2 or FLUX.1; `flux2-dev-turbo` is likewise FLUX.2-only. Pairing a LoRA with the wrong base either errors on load or produces noise. Qwen-Image + its LoRA are the only **fully** apache-2.0 image path we have — everything is licence-clean end to end, unlike FLUX.1-dev/PuLID.

The script is idempotent and resumes a partial download over HTTP Range — which matters, because a pod web terminal will drop before a 35 GB file finishes. Re-running a set the volume already has is a no-op.

**FLUX 3 is NOT available to fetch.** BFL announced it 2026-07-23 (multimodal: image/video/audio/action-prediction) but it is playground + API only — there is no `black-forest-labs/FLUX.3*` repo on Hugging Face and no `flux3` support in ComfyUI core. An open-weight **FLUX 3 [dev]** is confirmed in their launch plan with no date, no licence, and no parameter count published. Until weights land there is nothing for a pod to load; when they do, adding a set is a single `MODEL_SETS` entry in `fetch-models.py`.

### Pod software setup (LEGACY manual runbook — persists on the Network Volume)

> **Legacy only.** These steps are already baked into `atlas-comfy-pod`. Use them only to repair a pre-baked-image pod, or to understand what the image encodes. On a baked-image pod they are unnecessary (and re-running `pip install torch` by hand won't survive a container recreate — that's the whole reason for the baked image).

These were needed to get the artist's FLUX/PuLID blueprint running on a hand-built pod. Run from the pod's web terminal / SSH; everything under `/workspace` survives stop/start.

1. **Pin ComfyUI to `v0.33.1`** (in `/workspace/ComfyUI`):
   ```
   git fetch --depth 1 origin refs/tags/v0.33.1:refs/tags/v0.33.1 && git checkout v0.33.1
   ```
   Pin to a **tag**, never master: an unpinned core changes generation behaviour with no commit, and lets the pod and the serverless worker drift apart. The ref **must match the serverless worker** (`services/atlas-serverless/Dockerfile` `COMFYUI_REF`) so R&D and production stay in lockstep — bump both in ONE PR. **Still do NOT use ComfyUI-Manager's "Update ComfyUI"**: it patches the ephemeral container layer, so on a baked-image pod it silently reverts on the next container recreate. Bump the `ARG` and rebuild instead.
   > Superseded history: we held `v0.3.66` from 2025-10-21 to 2026-08-19 because `comfy/quant_ops.py` pulled in the `comfy_kitchen` backend, whose na3d op annotated a param as `list[int]` and was rejected by torch's `infer_schema` (crash on import). Fixed upstream — `quant_ops.py` no longer registers a `torch.library` op and `comfy_kitchen` is a version-pinned wheel in ComfyUI's own `requirements.txt`.
2. **Blackwell GPU needs cu128 torch.** The base image's `torch 2.4.1+cu124` has **no Blackwell (`sm_120`) kernels** → `CUDA error: no kernel image is available`. Fix:
   ```
   pip install --upgrade torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
   ```
   Upgrade **torchaudio too** (leaving it on the old build makes its native lib fail to load).
3. **Custom nodes** — clone into `/workspace/ComfyUI/custom_nodes`:
   - `Fannovel16/comfyui_controlnet_aux`
   - `cubiq/PuLID_ComfyUI`
   - the artist's **modified** `ComfyUI-PuLID-Flux` — vendored in-repo at `services/atlas-serverless/custom_nodes/ComfyUI-PuLID-Flux/`. The stock `balazik/ComfyUI-PuLID-Flux` node lacks the `attn_mask` fix and errors `forward_orig() got an unexpected keyword argument 'attn_mask'`; use the vendored copy, not the upstream one.
     Then the face stack: `pip install insightface onnxruntime-gpu facexlib`.
4. **ComfyUI-Manager "outdated" alert:** while the core sat on `v0.3.66`, Manager reported _"Security Alert: ComfyUI outdated. Installations blocked"_ and greyed out its install buttons even at security level **"middle"**. The `v0.33.1` bump clears it. If it ever comes back, it means the pin has gone stale again — **re-check whether the pin still has a reason** rather than clicking "Update ComfyUI" (which cannot persist; see step 1). Installing custom nodes from the terminal (step 3) is the workaround, but the real fix on a baked-image pod is to add the node under `services/atlas-comfy-pod/custom_nodes/` and let CI rebuild.

### Cost model

- **GPU is billed per-second only while the pod is Running.** Closing the browser does **NOT** stop it — only **Stop** (the card's Stop button, or idle auto-stop) halts GPU billing.
- **Network Volume is a flat ~$12–18/mo, always** (charged whether or not the pod runs) — it's what makes models/nodes persist.
- **Cold start ~1–3 min** (models already on the volume). Idle auto-stop + the card's Stop button are the cost controls; leave idle auto-stop on.

## R2 (Cloudflare object storage)

- Bucket: `invisibleassets`. Endpoint: `https://175d2ae4501d5de0a1ca970f2bb31448.r2.cloudflarestorage.com`.

> ⚠️ **From Spain, R2's S3 endpoint is intermittently unreachable — and it is not our outage.** That
> hostname resolves to `172.64.66.1` / `172.64.190.1`, inside Cloudflare anycast ranges Spanish ISPs
> null-route under the LaLiga anti-piracy court orders (typically around match kick-offs). The
> fingerprint, measured 2026-09-17: DNS answers normally, TCP 443 to both addresses never connects
> (a bare `ConnectTimeoutError` / 25 s with no SYN-ACK), while `cloudflare.com`,
> `api.cloudflare.com`, `app.invisiblewall.org` and `games.invisiblewall.org` all connect in ~25 ms.
> **Railway is not affected**, so anything server-side (the online Game Maker publish, the exe
> download, the test server's own hydrate) keeps working — it is only tools that talk to R2 *from a
> Spanish line* that fail. Publishing a desktop-built game has a way through:
> `apps/launcher-api/scripts/publish-game-via-portal.mjs` relays the bundle through the portal (see
> [status/launcher](status/launcher.md), 2026-09-17). Don't debug these as credential or bucket
> problems: check TCP 443 to those two addresses first.
>
> **`BODY_SIZE_LIMIT` (launcher-api) defaults to `32M` in code** (`apps/launcher-api/scripts/start.mjs`,
> the `start` script) because adapter-node otherwise caps request bodies at 512 KB, which the bundle
> relay needs to exceed. A service variable of the same name still wins — and **if that service's
> start command is set in the Railway dashboard to `node build/index.js`, the wrapper is bypassed**
> and the variable is the only way to raise it.
- Key layout:
  - `test_server/games.json` + `test_server/<key>/…` — the test server's manifest and each desktop-built game's own bundle
  - `test_server/_runtime/lines@<version>/…` — one immutable online-engine release each; `test_server/_runtime/lines/current.json` is the pointer the test server serves (`releases.json` = history, `release.json` = the launcher's status stamp). Written only by the **Runtime release** Action, flipped by the **Runtime rollback** Action; see "Runtime releases" in [design/games-deploy](design/games-deploy.md). `games.invisiblewall.org/healthz` shows the served version; every runtime response carries `X-Runtime-Release`.
  - `_ci/typekit-mirror/current.json` + `_ci/typekit-mirror/blobs/<sha256>` — the Typekit kit
    (stylesheet, script, font files) the current-games harness renders with instead of asking
    Adobe; players still load from `use.typekit.net`. Written only by the **Typekit mirror** Action
    (`.github/workflows/typekit-mirror.yml`, the release's `R2_*` key; blobs are never overwritten,
    the manifest is one write), read by the harness's read-only key. Private on purpose: Adobe's
    fonts are licensed, so they are mirrored into this bucket and never into the public repo. How
    and when to refresh: `docs/playtest/current-games.md` ("Typekit mirror").
  - `atlas/manifests/loader.json` — Svelte-era manifest (legacy path)
  - `spines/hotfruits/…` — spine assets
  - `atlas_maker/cloud/<project>/{manifests,input,output,deploy}/…` — the ported tool's store
  - **Backed up nightly** (encrypted, to the separate bucket `invisible-backups`): everything here except `comfyui-models/`, `comfyui-nodes/`, `tools/`, `test_server/` (but `games.json` is), `_shared/storybook/` and each project's `published/`, `deploy/`, `batch/`, `video/` — see "Backups" below.
  - `<client>/<project>/published/` — **published runtime snapshots** (online Game Maker, 2026-09-29):
    `pointer.json` (the version players boot + ≤5 retained, CAS-written) and one `<id>/` per version
    holding `runtime.json` + a frozen copy of `deploy/`. Written only by Publish / rollback; players
    read it through `/api/editor/runtime` and `/api/published/f/<token>/<project>/<id>/…` (served
    `immutable` — a republish is a new id, so a rotated read token's old asset URLs can stay in edge
    caches; they are public game assets). Design: `docs/design/live-assets.md` § Published snapshots.

## Environment variables (names only)

**Launcher** (read through `ENV` in `apps/launcher-api/src/lib/server/env.ts`; "default" = has a
code default, so the dashboard need not set it):

- **Core:** `DATABASE_URL`, `ORIGIN`, `REMEMBER_TTL_DAYS`, `SESSION_TTL_HOURS`, `R2_ENDPOINT`,
  `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `BODY_SIZE_LIMIT` + `ADDRESS_HEADER` +
  `XFF_DEPTH` (defaults in `scripts/start.mjs`).
- **Tools:** `ATLAS_TOOL_URL`, `SHEET_TOOL_URL`, `TEST_SERVER_URL`, `GAMES_BASE_URL` (defaults);
  `TEST_SERVER_SECRET` (only if the test server sets one — sent as a header on the launcher's
  `/refresh` pokes); `ATLAS_TOOL_SIGNING_SECRET` + `SHEET_TOOL_SIGNING_SECRET` (sign the tool
  launch tokens — see "Tool launch tokens"); `ATLAS_TOOL_SECRET` / `SHEET_TOOL_SECRET` /
  `ATLAS_BLUEPRINT_SECRET` (legacy handoff, used only while the matching signing secret is unset;
  remove after the cut-over); `EDITOR_DOC_SECRET`
  (fallback for the deploy token, which normally lives in Admin → Settings).
- **Export / bake:** `KTX2_ENCODE` (default OFF — encode GPU-compressed KTX2 page twins; CPU- and
  memory-heavy, see [design/gpu-compressed-textures](design/gpu-compressed-textures.md)),
  `PAGE_WEBP` (default ON — near-lossless WebP pages), `SOUND_TRANSCODE` (default ON) +
  `SOUND_MAX_KBPS` (default 128).
- **Localization:** `ANTHROPIC_API_KEY`, or `LOCALIZATION_LLM_BASE_URL` + `LOCALIZATION_LLM_API_KEY`
  (+ optional `LOCALIZATION_LLM_MODEL`) for an OpenAI-compatible provider.
- **ComfyUI / RunPod:** `RUNPOD_API_KEY`, `RUNPOD_DATA_CENTER_ID`, `COMFY_VOLUME_POD_ID`,
  `COMFY_VOLUME_URL`, `GITHUB_ACTIONS_TOKEN`, legacy `RUNPOD_POD_ID` / `COMFY_RND_URL` — see
  "Launcher integration" above.
- **Publishing / engine status:** `GIT_CLONE_TOKEN`, `GIT_CLONE_USERNAME` (default),
  `GITHUB_ENGINE_READ_TOKEN` (optional), `GITHUB_ENGINE_REPO` (default), `PARTNER_RGS` (optional,
  partner launches), `CF_API_TOKEN` + `CF_ZONE_ID` (optional cache purge — see below).
- **Pipeline CI:** `PIPELINE_CI_TOKEN` (secret, no default) — the bearer token the current-games
  regression harness (`docs/director/DECISIONS/0004-current-games-regression-harness.md`) sends to
  the read-only `GET /api/pipeline/games` to list every live game. Held by the launcher and by the
  GitHub Actions secret of the same name. Unset → that endpoint answers 503; nothing else uses it.
- **Current-games harness (GitHub Actions secrets, `.github/workflows/current-games.yml`):**
  `PIPELINE_GAMES_URL` (the launcher's `/api/pipeline/games` URL), `PIPELINE_CI_TOKEN` (above), and
  an R2 API token with **Object Read only** on the bucket (R2 scopes tokens per bucket, not per key
  prefix; the harness reads only `*/published/**`, `test_server/games.json` and
  `_ci/typekit-mirror/**`):
  `CURRENT_GAMES_R2_ENDPOINT`, `CURRENT_GAMES_R2_BUCKET`, `CURRENT_GAMES_R2_ACCESS_KEY_ID`,
  `CURRENT_GAMES_R2_SECRET_ACCESS_KEY`. Deliberately NOT the release's read-write `R2_*`: the harness
  never writes. A missing one fails the run and the `current-games` commit status, naming it. The
  status is posted through the API, so making it required means adding `current-games` to the `main`
  ruleset with source **any** (not "GitHub Actions"). How to run and read it:
  `docs/playtest/current-games.md`.
- **Director adapters:** `DIRECTOR_SERVICE_TOKEN` (secret, no default) — the bearer token the
  Invisible Director worker sends to `POST /api/director/adapter/<tool>/<op>`
  (`docs/director/DECISIONS/0002-tool-adapters.md`). Every call also names a run and an agent, and
  acts as that run's owner, within the owner's project access. Held by the launcher and the
  `director-worker` service (the same value on both). Unset → every adapter call answers 503.
  The Atlas Maker ops (`atlas.*`, `comfyui.job_status`) call atlas-tool with an `api` launch token
  (`ATLAS_TOOL_SIGNING_SECRET`, required — the legacy handoff cannot name the acting agent) and
  `ATLAS_CALLBACK_SECRET` (secret, no default; the SAME value as atlas-tool's) — it mints the
  token for a render's completion callback to `POST /api/director/atlas/callback` and verifies
  the callback's `X-Atlas-Signature`. Unset → renders are queued without a callback (a
  `/progress` poll settles them) and the callback route answers 503. The callback URL is built
  from `ORIGIN`, so `ORIGIN` must be the launcher's public https origin.
- **Admin → Costs** (all optional): `RAILWAY_API_TOKEN`, `RAILWAY_PROJECT_ID`, `CF_ACCOUNT_ID`,
  `CF_ANALYTICS_TOKEN`, `ANTHROPIC_ADMIN_API_KEY`, `OPENAI_ADMIN_API_KEY`.
- **Error tracking** (optional, see "Monitoring & error tracking"): `SENTRY_DSN` +
  `PUBLIC_SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_SAMPLE_RATE`, `PUBLIC_SENTRY_ENVIRONMENT`,
  `PUBLIC_SENTRY_SAMPLE_RATE`; build-time source-map upload: `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`,
  `SENTRY_PROJECT` (+ `SENTRY_URL` for a personal token) — see "Readable stack traces".

**Invisible Director worker** (`services/director-worker`, read in `src/env.ts`; ADR-0001):
`DATABASE_URL` (reference the Postgres service's, `${{Postgres.DATABASE_URL}}` — the run tables live
in the launcher's database and its migrations), `ANTHROPIC_API_KEY` (the agents' key, never logged —
the worker logs only `anthropicApiKeySet`), `DIRECTOR_SERVICE_TOKEN` (the launcher's value, for the
adapter gate and catalog), `DIRECTOR_LAUNCHER_URL` (optional; code default
`https://app.invisiblewall.org`). Without the key or the token the worker claims no run and
`/healthz` answers 503 `db: not_driving`. `PORT` is injected by
Railway. With `DATABASE_URL` unset the worker still boots but claims nothing and `/healthz` answers
503 `db: unconfigured`. See "Invisible Director worker" below.

**Invisible Test Server:** `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
(read), `TEST_SERVER_SECRET` (gates `POST /refresh`, taken as the `x-test-server-secret` header or
`?secret=`; the launcher and the runtime-release Actions hold it too), `CASCADE_GAMES`,
`CONTRACT_TIMEOUT_MS`, `CONTRACT_TTL_MS` (optional), `TEST_SERVER_LOCAL` (local dev only). See
[tools/test-server](tools/test-server.md).

> **Admin → Costs (running-cost dashboard):** `/admin` → **Costs** reads each paid provider's own API and shows balance / spend / breakdown per provider. Every credential is **optional and read-only**; an unset provider renders a "not configured" card naming the vars it wants, so the page is useful with none of them set. Set on the **launcher-api** service → **Apply changes / Deploy**.
>
> - **RunPod** — reuses the existing `RUNPOD_API_KEY`. **No new secret**; this is the only provider that publishes a real prepaid balance.
> - **Railway** — `RAILWAY_API_TOKEN` (Account Settings → Tokens; must be an **account or workspace** token, since a _project_ token authenticates with `Project-Access-Token` rather than `Authorization: Bearer`) + `RAILWAY_PROJECT_ID` (the id in the project URL). Railway does not document the usage side of its GraphQL schema, so the collector surfaces Railway's own error text verbatim if a field is renamed — verify at `https://railway.com/graphiql`.
> - **Cloudflare R2** — `CF_ACCOUNT_ID` + `CF_ANALYTICS_TOKEN` with **Account → Account Analytics: Read**. ⚠️ Deliberately NOT `CF_API_TOKEN`, which is **zone**-scoped for cache purge and cannot read account analytics. R2 has no billing API, so the dollar figure is stored bytes + class A/B operation counts × the published rates (`RATES` in `costs/r2.ts` — a price list in code, so re-check it against Cloudflare's pricing page when it moves).
> - **OpenAI / Anthropic (whichever Localization actually uses)** — `translate.ts` dispatches to an **OpenAI-compatible** endpoint when `LOCALIZATION_LLM_BASE_URL` + `LOCALIZATION_LLM_API_KEY` are set, and only falls back to Anthropic otherwise. The page mirrors that: it shows the card for the **active** provider (or either one that holds a key), so the dormant one isn't a permanent "not configured" card for a bill nobody gets.
>   - **OpenAI** — `OPENAI_ADMIN_API_KEY`, an **admin** key (`sk-admin-…`) from platform.openai.com → Settings → Organization → Admin keys; only an org **Owner** can mint one, and a project key (`sk-proj-…`) gets 401. `GET /v1/organization/costs`, `Authorization: Bearer`, `start_time` in **Unix seconds**, and `amount.value` in **dollars**.
>   - **Anthropic** — `ANTHROPIC_ADMIN_API_KEY` (`sk-ant-admin…`) from Console → Settings → Admin keys. A **different credential** from `ANTHROPIC_API_KEY`. `x-api-key` auth, RFC-3339 `starting_at`, and `amount` in **cents as a decimal string**.
>   - ⚠️ The two differ on units, time format _and_ auth header — don't copy one collector's parsing onto the other. Neither exposes a credit-balance endpoint, so remaining prepaid credit is derived from the admin-entered top-up ledger (`cost_top_ups`, migration `0015_loud_triton.sql`), never measured.

> **Partner RGS launches (`PARTNER_RGS`):** a JSON map, keyed by the **delivery-profile id** the
> game is launched with, that lets `GET /api/partner-session` mint a session on a partner RGS and
> redirect into the game. **It holds admin credentials** — the partner's session endpoint takes a
> username and password and will mint for ANY player id — which is exactly why minting is
> server-side and nothing here may ever reach a bundle, a redirect or a log line. Unset ⇒ no
> partner launches, and every other launch path is unaffected.
>
> ```
> PARTNER_RGS={"2complex":{"baseUrl":"https://gs.2-complex.science",
>                          "adminPath":"/webnode/api/admin.js",
>                          "user":"…","pass":"…","gameId":"2",
>                          "players":["player1","player2","player3"],
>                          "sessionParam":"sid"}}
> ```
>
> - `players` is **required in practice for this partner**: it answers `player not found` for a
>   `remote_id` it did not pre-create (and does so with **HTTP 200** and an error body, so a caller
>   that only checks the status sees success). Launcher users are spread across the pool
>   deterministically, so a given user keeps the same partner wallet between launches.
> - `sessionParam` must match the delivery profile's `session.param` — the launcher decides where
>   to PUT the token, the game decides where to READ it, and a disagreement is a game that refuses
>   to boot. Defaults to `sid`.
> - The game must be launched with a runtime bundle that carries the matching profile
>   (`PUBLIC_DELIVERY_PROFILES`, see `docs/design/delivery-builds.md`).
>   **Engine "release pending" pill (C2):** the launcher home pill can also flag when engine `main` has un-released ENGINE changes (`apps/lines/`, `packages/`) ahead of the live runtime bundle's stamped commit. To activate, set on the **launcher-api** Railway service: `GITHUB_ENGINE_READ_TOKEN` = a **fine-grained PAT** with **read-only "Contents"** on `Invisible-Wall-SL/Invisible-Engine` (optionally `GITHUB_ENGINE_REPO` = `owner/repo` to override the default). The launcher calls the GitHub compare API (`{deployed}...main`) best-effort, cached ~60s. **If `GITHUB_ENGINE_READ_TOKEN` is unset (or any GitHub error/timeout), the pill simply never shows "release pending"** — it behaves exactly as before (green/deployed). `GIT_CLONE_TOKEN` is used only as a best-effort fallback and is scoped to game repos, so a dedicated read token is preferred. After setting → **Apply changes / Deploy**.

> **Game freshness — no edge cache in front of `games`.** `games.invisiblewall.org` is a DNS-only
> CNAME to Railway (checked 2026-09-29: responses come from Railway's edge with no Cloudflare
> headers), so there is no CDN copy to purge. Freshness is the test server's own headers: a game's
> `index.html` and `assets/…` are `no-store, must-revalidate`, and `_app/immutable/…` is
> content-hashed and cached for a year. After `POST /api/launcher/register-game` the launcher still
> calls Cloudflare's purge for the game's URLs (`cfPurge.ts`); with `games` DNS-only that call has
> no effect, and with `CF_API_TOKEN` / `CF_ZONE_ID` unset it is skipped. The two vars only matter
> if `games` is ever switched to proxied.

> **`ADDRESS_HEADER=x-forwarded-for` + `XFF_DEPTH=1` let the login throttle (B38) see real client IPs** — they default in `apps/launcher-api/scripts/start.mjs` (a dashboard value still wins, so the vars no longer need setting). They are read by `adapter-node` itself (not `env.ts`) so `getClientAddress()` parses the `X-Forwarded-For` Railway's edge adds instead of returning the proxy's address. `XFF_DEPTH=1` = one trusted hop (Railway's edge; `app.` is DNS-only on Cloudflare, so nothing else sits in front); raise it only if another proxy is added. Without them every request looks like one shared IP and the per-IP bucket collapses into a global counter. Railway also documents an `X-Real-IP` header with the client address. A local `node scripts/start.mjs` needs an `X-Forwarded-For` on login requests (or `ADDRESS_HEADER=` blank).

**atlas-tool:** `COMFY_URL`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`, `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `COMFY_ORG_API_KEY` (optional, gpt_image). **atlas-tool also:** `COMFY_TRANSPORT` + `RUNPOD_ENDPOINT_ID` + `RUNPOD_API_KEY` (generation target — below), `ATLAS_PROJECT`, `ATLAS_OUTPUT_PREFIX`, `ATLAS_TOOL_SIGNING_SECRET`, `ATLAS_TOOL_SECRET` + `ATLAS_BLUEPRINT_SECRET` (legacy, until the cut-over), `ATLAS_STAGING`, `COMFY_CATALOG_URL` (optional — see the env table), `BLUEPRINT_AUTO_INSTALL_MODELS`, the `VIDEO_*` knobs below, `ATLAS_CALLBACK_SECRET` (optional — signs/verifies still-render completion callbacks; unset = every `/render` callback is refused, see [atlas-maker status](status/atlas-maker.md) 2026-10-04) and `STILL_RESUME_WINDOW_HOURS` (default 12 — how old an interrupted still render may be and still be resumed or have its callback redelivered). **sheet-tool:** `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `SHEET_PROJECT`, `SHEET_STAGING`. **atlas-tool + sheet-tool:** `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_SAMPLE_RATE` (optional, error reporting; release = Railway's own `RAILWAY_GIT_COMMIT_SHA`), `IW_LEGACY_TOOL_KEY_UNTIL` (optional, moves or ends the legacy-handoff window). **sheet-tool also:** `SHEET_TOOL_SIGNING_SECRET`, `SHEET_TOOL_SECRET` (legacy, until the cut-over).

> **The blueprint importers and the live settings refresh read node CONTRACTS the same way** (Flipbook video mode + the Atlas Maker's 🎛 Blueprint settings, via `POST /video/nodespecs` → `comfy_specs`): a node's full `/object_info` declaration — an input's min/max/step, a COMBO's option list — not only the model lists above, and **for the target the render will run on**: the Atlas Maker follows ⚙ _Run generation on_; a video render always runs on the service default (`COMFY_TRANSPORT`), so the Flipbook reads the pod's contracts in production. Same source rules as ⟳ (`comfy_catalog._probe_sources`): _RunPod_ = a pinned `COMFY_CATALOG_URL` or a discovered running pod, never `COMFY_URL`; _My computer_ = `COMFY_URL` only. Nothing answering is normal: the importer says so in the modal and types the setting from the baked value (no range, no list), the panels keep the list the blueprint was published with, and in between sits the target's catalog — **⟳ Refresh model lists also caches every published blueprint's select lists** for its target, so a blueprint's dropdown shows the last-seen pod list while no pod is running.

> ⚠️ **`COMFY_URL` must be the TUNNEL to a person's own ComfyUI — never a RunPod address.** It is what ⚙ _Run generation on_ = **My computer** resolves to (`iw_common.comfy.comfy_url` calls it "the full ComfyUI tunnel base URL"), so pointing it at a pod makes that choice silently render in a data centre. Found live 2026-09-04 with `COMFY_URL` set to a pod's `https://<podId>-8188.proxy.runpod.net`: the panel read _"your ComfyUI has never answered at https://…proxy.runpod.net"_ — true, and it sends you off to restart a tunnel that was never the problem. Correct value: **`https://comfy.invisiblewall.org`** (the named tunnel `comfy-gualtiero`). The tool now refuses such a render and says so rather than reporting it as unreachable (`ui_server.local_target_misconfigured`). RunPod addresses belong in `RUNPOD_ENDPOINT_ID` (serverless) and `COMFY_CATALOG_URL` (the optional model-list override) — not here.
>
> **`COMFY_TRANSPORT` picks which ComfyUI the atlas-tool generates on — production is `serverless`.** Since 2026-09-03 it is only the **default**: ⚙ Global settings → _Run generation on_ (`run_on`: blank / `pod` / `local`) overrides it per render, as an env override on the render subprocess — `pod` = `serverless`, `local` = `http` over the tunnel (`COMFY_URL` + `CF_ACCESS_*`, or the user's own registered tunnel from `_users/<slug>/comfy.json`). An explicit `local` never wakes a RunPod pod and preflights `<url>/system_stats` so a machine that isn't answering fails in one sentence.
> `serverless` submits the api-prompt graph to a **RunPod Serverless endpoint** (`RUNPOD_ENDPOINT_ID` + `RUNPOD_API_KEY`); unset or `http` uses the **local ComfyUI over the tunnel** (`COMFY_URL` + the two `CF_ACCESS_*` vars). Live `atlas-tool` is on `serverless` (2026-08-18), so `COMFY_URL`/`CF_ACCESS_*` are **not** on the generation path there even though they're still set — a generation failure in production is a RunPod/worker-image issue, not a local-tunnel one. Changing this var silently changes which machine's installed nodes/models a pipeline needs, which is exactly how gpt_image and the FLUX ControlNet path were blocked for months. `RUNPOD_API_KEY` is shared with the `/comfyui` R&D pod fleet; `RUNPOD_ENDPOINT_ID` is the serverless endpoint only.

> ### ⚠️ The serverless WORKER needs `RUNPOD_ENDPOINT_ID` + `RUNPOD_API_KEY` too — set them on the **endpoint**, not just on `atlas-tool`
>
> Without them **Cancel cannot stop a running generation.** RunPod's `/cancel` marks a job
> cancelled, but it does **not** interrupt a synchronous handler: the worker keeps rendering to
> completion and billing for it, and throws the result away — while the tool, the tile and the
> button all report it stopped. (Owner, 2026-09-02: _"I have canceled jobs, and the UI is telling me
> they are cancelled, but when I look at the runpod, I can see the server is still running and
> generating."_)
>
> With them set, a running job polls its own status on the same public route the runner uses and,
> when it sees `CANCELLED`, interrupts the prompt and kills ComfyUI. Set both under the Serverless
> endpoint's own **Environment Variables** (RunPod does not inject them). `RUNPOD_ENDPOINT_ID` is
> that endpoint's id — the same value `atlas-tool` already carries. The worker logs a line at the
> first cancel check when they are missing, so the container log says which side is unset.
>
> ### A render does NOT come back through RunPod
>
> RunPod's payload limits are **fixed** — 10 MB on `/run`, 20 MB on `/runsync`, with base64
> inflating a file by a third on the way — and their own guidance for a large result is object
> storage, not a bigger response. A lossless animated WEBP of opaque frames clears that cap easily,
> which is how switching a background cutout off came to break a render outright (the job ran the
> full 15 minutes, RunPod reported COMPLETED, and handed back nothing).
>
> So `video_runner` presigns a few **PUT-only, single-key, expiring** R2 URLs at submit time and
> passes them as `input.upload_urls`; the worker PUTs each output straight to R2 and returns only a
> slot number. **No storage credentials go anywhere near the worker** — a presigned URL is
> PUT-only, single-key and expiring, so even a leaked one can write one object and nothing
> else. Both directions degrade safely: a worker that predates this ignores the field and base64s
> as before, and a runner that cannot reach R2 to sign simply runs the old way at the old ceiling.
> The scratch objects live at `<client>/<project>/video/_out/` and are deleted as soon as the real
> render is written (`meta.json` is what makes a session, so they can never look like one).

> ### ⚠️ The worker's cutout weights come from `fetch-models.py`, not the node
>
> Since 2026-09-30 the worker does not link the volume's `models/RMBG/` (a shared, node-rewritten
> folder tore once and failed every cutout for 14 hours). It verifies `fetch-models.py`'s `rmbg` +
> `birefnet` sets at boot, file by file, and stages what passes into the container. A file that
> is missing or does not match is left out, and the node downloads it into that container on
> first use — it still renders, just slower on every cold worker. A fresh or new volume
> therefore wants, from an R&D pod, `python /fetch-models.py --set rmbg --set birefnet`. The boot
> log says `== verified 20 file(s) of rmbg+birefnet` when it is right.

> ### ⚠️ The endpoint's image is `atlas-comfy-worker` — NEVER `atlas-comfy-pod`
>
> Two images in one registry and only one of them answers a job. `services/atlas-serverless`
> bakes `handler.py` and ends in `exec python -u /handler.py`; the R&D pod image
> (`services/atlas-comfy-pod`) has no handler at all and ends in `exec sleep infinity`. An
> endpoint pointed at the pod image pulls, boots, idles, and answers nothing.
>
> It is an easy paste to get wrong, because the advice just below — _set the endpoint's image
> to the immutable `:<sha>`_ — reads identically for both, while `/comfyui`'s **Update to
> `<sha>`** button displays a full `ghcr.io/…/atlas-comfy-pod:<40-char sha>` that is correct
> for a POD and wrong for the endpoint. Found live 2026-09-14 on the production endpoint,
> pinned to `atlas-comfy-pod:964daead…` — the SemanticLayers commit, i.e. someone reaching
> for a node pack that at the time existed only in the pod image.
>
> **Both GHCR packages are PRIVATE** — neither pulls anonymously — so the endpoint needs a
> credential under _Container Registry Credentials_ (a GitHub PAT with `read:packages`).
> GHCR grants access **per package**, so a credential that has pulled `atlas-comfy-worker`
> for months can still be denied on `atlas-comfy-pod`. That surfaces as `error pulling image:
… denied: denied` and reads exactly like an expired token — **check the image NAME before
> hunting for a dead PAT.** A quick discriminator, anonymously: a public package answers
> `https://ghcr.io/token?scope=repository:<owner>/<pkg>:pull&service=ghcr.io` with a token,
> a private one with `UNAUTHORIZED`.
>
> **Which image is a worker actually running?** The boot log answers it —
> `[handler] atlas-comfy-worker build <sha> (JOB_TIMEOUT=…s, cancel-aware=True/False)` — and every
> error result ENDS with `[worker <sha>]` — RunPod keeps only a failing result's `error` STRING (the `worker_build` and `detail` keys beside it never leave the worker), so the build and, since 2026-09-04, ComfyUI's failing node + exception travel inside the string. **A serverless endpoint pinned to `:latest` caches by
> digest, so pushing a new `:latest` does NOT reliably roll the workers**; that cost three rounds of
> diagnosis, answerable only by noticing an error quoting a timeout we had since changed. CI also
> pushes an immutable `:<commit sha>` tag — **set the endpoint's image to that** when you need a
> specific build live, then confirm the sha in the boot log.
>
> Two more the worker reads, both optional: `COMFY_JOB_TIMEOUT` (default 9000s) — the worker's own
> cap on one generation, and the **fourth** clock on a job after the endpoint's Execution Timeout,
> `VIDEO_JOB_TIMEOUT_SECONDS` and ComfyUI itself. It was a hardcoded 1800 and silently became the
> binding limit the moment an endpoint was set past 30 min, failing renders the endpoint was happy
> to run and blaming ComfyUI for it. **Keep it at or above the endpoint's Execution Timeout** —
> RunPod's is the authority. And `CANCEL_POLL_SECONDS` (default 5) — how often a running job asks
> whether it is still wanted.
>
> On `atlas-tool`, `VIDEO_PARALLEL_JOBS` (default 1) caps how many of ONE video session's
> variations are in flight at once. RunPod wakes a second worker only when a second job is
> waiting, so at 1 an endpoint with three workers uses one. **Set it to the endpoint's max
> workers (the owner's is 3), never above** — the surplus just sits IN_QUEUE, and each extra
> worker is its own cold start and its own share of the burn rate.
>
> Also `VIDEO_SLOT_SWEEP_MINUTES` (default 60, 0 disables) — how often one project's `video/_out/`
> hand-off prefix is swept for renders nothing is coming back for, off the back of a session
> listing. The boot sweep runs regardless; this is what keeps a container that stays up for days
> from accumulating them.
>
> Also `VIDEO_RESUME_WINDOW_HOURS` (default 12) — how far back the boot sweep looks for a
> session the previous container was mid-render on. A doc older than this has no collectable
> job left (RunPod dropped it long ago), so re-attaching to one could only fail slowly, once
> per container start.

## Monitoring & error tracking (2026-09-29)

Three layers, each answering a different question: **is it up** (external uptime monitor → health
endpoints), **is it broken for someone** (Sentry → errors from players, artists and the tools), and
**did the engine ship** (runtime-release failures → a GitHub issue).

### Error tracking — Sentry (free Developer plan)

**Why Sentry and not a self-built beacon.** A beacon is ~30 lines to send and months to make useful:
it would need an ingest endpoint, storage, grouping of the same error across players, stack traces
readable through minification, per-release filtering, alert rules, and a Python client — Sentry
ships all of that for the three runtimes we have (browser, Node, Python) and its free plan (5k
errors/month, 1 seat, 30-day retention) covers our volume; `sampleRate` is the lever if it doesn't.
The costs we accept: the 1-seat limit (Team plan if more people need to triage), and ~97 KB minified
added to the game bundle **only in a build that has a DSN** (the game is a single inlined file, so
the SDK cannot be a lazy chunk there; the launcher lazy-loads it). **Create the org in the EU region**
(`de.sentry.io`) — player-side errors from EU players should stay in the EU.

**Everything is a no-op without a DSN** — no SDK loaded, nothing sent — so every env var below is
optional and unset means today's behaviour. DSNs live in env/secrets only (the repo is PUBLIC).

| Surface | Where the code is | DSN var (where set) | What is captured |
| --- | --- | --- | --- |
| **Game runtime** (online `_runtime/lines` bundle + delivery builds) | `packages/error-tracking` (shared browser reporter, scrubber), `apps/lines/src/game/errorTracking.ts` | `PUBLIC_SENTRY_DSN` — **GitHub Actions secret**, baked by `runtime-release.yml` at build time; `PUBLIC_SENTRY_SAMPLE_RATE` = Actions **variable** (default 1) | uncaught errors + unhandled rejections; RGS failures (`area: rgs`, `action` authenticate/bet/endRound, `status` = the statusCode e.g. `ERR_HTTP_502`, grouped by action+status); runtime boot failure (`area: boot`). Tags: `runtime` (= release, the `_runtime/lines@<sha12>` prefix), `game` (on `?runtime=1` boots), `project`, `profile`, `profile_source`. |
| **Launcher** server | `apps/launcher-api/src/lib/server/errorTracking.ts`, `hooks.server.ts` `handleError` + `init` | `SENTRY_DSN` (Railway, launcher) | every unexpected server error (not `error(4xx)`), tagged `route`/`method`/`status`; a failed boot migration (`area: migrate`). Release = `RAILWAY_GIT_COMMIT_SHA`. |
| **Launcher** browser | `apps/launcher-api/src/hooks.client.ts` | `PUBLIC_SENTRY_DSN` (Railway, launcher — read at runtime, no rebuild) | uncaught errors + load/navigation errors on launcher pages. |
| **atlas-tool / sheet-tool** | `services/_shared/iw_common/errors.py` | `SENTRY_DSN` (Railway, each service) | request exceptions (the 500 handlers + whatever stdlib `http.server` would only print), failed render/compose jobs, a video session's runner dying. Tag `service`. |

Suggested Sentry layout: one project per surface kind — **game-runtime** (Browser JS), **launcher**
(Node; its browser half can share the DSN — events carry `service: launcher | launcher-client`),
**pipeline-tools** (Python; `service: atlas-tool | sheet-tool`). Alert rule on each: *a new issue
is created → email*.

**Privacy (the part not to regress).** The player's session id IS a wallet credential (`?sid=`,
`?sessionID=`), and the tools' gate secret travels as `?k=` / a cookie. So: Sentry 11's
`dataCollection` defaults (user, cookies, headers, bodies, query strings, local variables — ALL on
by default in v11) are switched off (`PRIVATE_DATA_COLLECTION`), and a `beforeSend`/`beforeBreadcrumb`
scrubber blanks sensitive parameters by NAME in every URL, message, breadcrumb and extra
(`packages/error-tracking/src/scrub.ts`; Python twin in `iw_common/errors.py`, which also blanks the
literal values of secret env vars). No release-health session beacon is sent from the browser.
RGS failures attach only the status code and a ≤200-char reason, never the response or session.
Fixtures: `pnpm --filter error-tracking check:scrub`, `services/atlas-tool/test_error_tracking.py`.

**Delivery builds (partner-hosted) are OFF by default**, even when built with the DSN: a baked
delivery profile must opt in with `"telemetry": { "errors": true }` (bake-only; `config.json` cannot
flip it). Only opt a partner in once they have agreed. See `docs/design/delivery-builds.md`.

**Not done yet:** the Play4Fun authenticate that gets a bodiless non-2xx still reads as success in
the facade, so it is not reported (changing it changes boot behaviour).

### Readable stack traces — source maps (Sentry only, never served)

The repo and every served bundle are **public**, so a source map must never sit next to the code:
maps are built, uploaded to Sentry, and **deleted from the build before anything is published**.
All of it lives in `scripts/sentry-sourcemaps.mjs`; the fixture is
`node scripts/sentry-sourcemaps.fixture.mjs` (run by `check:all`).

| Surface | How | Release the maps are filed under |
| --- | --- | --- |
| **Game runtime** (`runtime-release.yml`) | Always built with `IE_SOURCEMAPS=hidden` (a map, no `sourceMappingURL`). Step *Upload source maps to Sentry and strip them* re-bases the map onto `index.html`, adds a debug-ID snippet to the page, uploads, deletes every `.map`; step *Gate: no source map or sourceMappingURL ships* re-checks; `publish-runtime-bundle.mjs` also refuses any `.map`. | the commit's first 12 chars — what the SDK reports (`__IE_BUILD__.sha`) and the `_runtime/lines@<sha12>` prefix |
| **Launcher** (Railway build) | `vite.config.js` writes hidden maps **only when `SENTRY_AUTH_TOKEN` is set**; the `build` script's `sentry-sourcemaps.mjs launcher build` step runs `sentry-cli sourcemaps inject` on `build/client/_app`, uploads, deletes every `.map` under `build/`, and fails the build if one is left in `client/_app`. Server code is not minified, so its frames read fine without maps. | `RAILWAY_GIT_COMMIT_SHA` (the server SDK's release; the client SDK sets none — debug IDs resolve without it) |

**Why the game's map is re-based.** The game is ONE inlined file: SvelteKit copies
`bundle.<hash>.js` byte for byte into a `<script>` in `index.html`, and that copy is what runs. A
browser numbers an inline script's frames by *document* line/column (the bundle starts at line
~127), so the staged map describes `index.html` — the same mappings shifted by the bundle's offset —
and frames find it by **debug ID**, not by URL (the page URL is a different game key on every online
game). Verified in a real browser: a frame at `/:1956:14340` resolved through the staged map to
`@sentry/browser/…/helpers.js:63`, the exact call site. `embed` delivery builds and desktop builds
upload nothing (the release job is the only uploader).

**No token → the upload is skipped with a notice; a failed upload is a `::warning::`.** Neither ever
fails a release or a launcher deploy — only a map left in the build does. Dry run of the upload (the
real `sentry-cli` against a local stand-in for Sentry's API, then checks what it assembled):

```bash
IE_SOURCEMAPS=hidden PUBLIC_RGS_TRANSPORT=play4fun PUBLIC_DELIVERY_PROFILES='*' pnpm --filter lines build
node scripts/sentry-sourcemaps.mjs runtime apps/lines/build --dry-run
```

(`… launcher apps/launcher-api/build --dry-run` for a launcher build made with `SENTRY_AUTH_TOKEN` set.)

**Owner setup (~10 min, after the Sentry projects above exist):**

1. **Create the auth token.** Preferred: Sentry → Settings → Developer Settings → **Organization
   Tokens** → *Create New Token*, name `ci-sourcemaps`. Its scope is fixed to `org:ci` (release +
   source-map upload, nothing else) and it carries the EU region, so no URL is needed. Alternative:
   a **Personal Token** (User Settings → Personal Tokens) with only **`project:releases`** and
   **`org:read`** — then also set the variable `SENTRY_URL` = `https://de.sentry.io` in steps 2–3.
   Copy the token once; Sentry never shows it again.
2. **GitHub** → repo → Settings → Secrets and variables → Actions: **secret** `SENTRY_AUTH_TOKEN`
   = the token; **variables** `SENTRY_ORG` = the org slug (from the Sentry URL),
   `SENTRY_PROJECT` = `game-runtime`, and `SENTRY_URL` only if step 1 used a personal token.
3. **Railway** → launcher → Variables: `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` =
   `launcher` (+ `SENTRY_URL` if needed) → **Apply changes** (they stage — see "Railway env vars").
   Railway passes service variables to the build, which is where they are used.
4. **Trigger a release:** Actions → *Runtime release* → *Run workflow* (runtime `lines`, both boxes
   ticked). Green, with step *Upload source maps…* printing `Uploaded source maps for release
   <sha12>` (a `Source maps not uploaded:` line means a secret/variable is missing). In Sentry →
   Settings → Projects → game-runtime → **Source Maps → Artifact Bundles**, the new bundle lists
   `~/index.html.js` + `~/index.html.js.map` with one debug ID, release `<sha12>`.
5. **Check a readable stack.** Open any online game, and in the browser console run
   `setTimeout(() => { throw new Error('sourcemap check') })`. The Sentry issue's in-bundle frame
   must read `helpers.js` in `@sentry/browser` (line 63, `fn.apply(this, wrappedArguments)`), not
   `/:1956:…`. If it shows raw positions, open the event's *Unminify Code* / processing-error panel.
   The launcher's first deploy after step 3 uploads its maps the same way (project `launcher`).
6. **Confirm nothing leaked** (any time): `curl -s https://games.invisiblewall.org/<gameKey>/ | grep -c sourceMappingURL`
   prints `0`, and the bundle's `….js.map` URL is a 404.

### Health endpoints

| Endpoint | Green means | Notes |
| --- | --- | --- |
| `https://app.invisiblewall.org/api/health` | 200 `{"ok":true,"db":"ok","migrations":{"boot":"ok","schema":"current"}}` — Postgres answered (3s budget) and `max(created_at)` in `drizzle.__drizzle_migrations` reaches the newest journal entry this build ships. | 503 otherwise, with `db: down/unconfigured` or `schema: behind/unknown`. Public, so it names states only — no error text. `boot` is reported, not gated on (a boot that failed only because the DB blinked must not stay red once the schema is current). |
| `https://games.invisiblewall.org/healthz` | 200 `{"ok":true,…}`; **503 `"ok":false`** when it serves nothing because its boot read of R2 failed | the test server / online games host. `lastHydrate.succeeded: false` with `ok:true` = a later refresh failed and it still serves the previous games (publishes are not landing — see the log). |
| director-worker `/healthz` (private; Railway's healthcheck) | 200 `{"ok":true,"agents":7,"db":"up","workerId":…}` — every agent definition loaded and validated, and the last Postgres round-trip (the `LISTEN director_wake` connect or the 60 s sweep) succeeded. | 503 with `db: down/unconfigured/not_driving` (`not_driving` = `ANTHROPIC_API_KEY` or `DIRECTOR_SERVICE_TOKEN` unset). A definition that fails validation stops the boot outright, so a bad agent edit shows as a failed deploy, never as a worker running without it. |
| `https://atlas-tool-production.up.railway.app/healthz`, `https://sheet-tool-production.up.railway.app/healthz` | 200 `{"ok":true,"service":…,"build":…,"commit":…}` | Gate-exempt (the only path that is); `commit` = the first 12 chars of `RAILWAY_GIT_COMMIT_SHA`, so it also answers "which commit is running?". |

### Uptime — Better Stack Uptime (free plan)

Recommended over UptimeRobot, whose free plan is for non-commercial use: Better Stack's free tier
gives 10 monitors at a 3-minute interval with email alerts and a keyword check, which is all four
endpoints with room to spare. **Owner setup** (betterstack.com → Uptime → Create monitor), one per row:

| Monitor | URL | Alert when | Keyword | Interval / timeout | Confirmation |
| --- | --- | --- | --- | --- | --- |
| Launcher | `https://app.invisiblewall.org/api/health` | URL doesn't contain keyword | `"ok":true` | 3 min / 10 s | 2 failed checks (a deploy swap is ~1–2 min) |
| Games host | `https://games.invisiblewall.org/healthz` | URL doesn't contain keyword | `"ok":true` | 3 min / 10 s | 2 |
| Atlas tool | `https://atlas-tool-production.up.railway.app/healthz` | URL doesn't contain keyword | `"ok": true` | 3 min / 15 s | 2 |
| Sheet tool | `https://sheet-tool-production.up.railway.app/healthz` | same | `"ok": true` | 3 min / 15 s | 2 |

Regions: pick Europe **plus one outside Spain** — during LaLiga matches Cloudflare ranges are
null-routed from Spanish ISPs and a Spain-only prober would page for an outage that isn't ours.
Escalation: email the owner (add the Better Stack mobile app for push if wanted).

### Runtime-release failures → a GitHub issue

`runtime-release.yml` goes red on any failed gate, build, upload or live verification (#831). A red
run on its own only emails the person who triggered it, and only if their personal Actions
notification setting allows it — so a merge by someone else, or a muted setting, means nobody sees
that every online game is still on the previous engine. The workflow's last step therefore
**opens an issue "Runtime release failed: lines"** (or comments on the open one) with the run link;
issues notify everyone watching the repo. Close it once a release is green. Owner settings that make
this reach you: **Watch** the repo (at least Custom → Issues), and in
github.com/settings/notifications → **Actions** keep "Only notify for failed workflows" + email on.

### Tool launch tokens — atlas-tool + sheet-tool (2026-09-29)

The launcher is the only thing that decides who may open the Atlas Maker / Sheet Maker and on which
`(client, project)`. After its own access check it mints a **signed launch token** (HMAC-SHA256,
`v1.<payload>.<sig>`, 120 s) carrying the user id, name, role, client, project and capabilities
(`apps/launcher-api/src/lib/server/toolLaunch.ts`). The redirect carries only `?iw_launch=<token>`; the
Flipbook video proxy mints a separate server-to-server kind per request and sends it as an
`X-IW-Launch` header (a redirect token is not accepted there). The tool
(`services/_shared/iw_common/launch.py`) verifies signature, audience and expiry, accepts a launch
token once, sets a signed `iw_atlas_session` / `iw_sheet_session` cookie (12 h, HttpOnly; never a
secret), redirects to the same URL without the token, and scopes **every** request from that
session only — `client`/`project` in a URL are ignored. Switching project = back through the
launcher, which mints a new token. Blueprint publishing rides as the token's `blueprintPublish`
capability. Refused → 403 "open … from the launcher". A session keeps the role and capabilities
of the launch that made it: a role or tool-access change applies at the user's next launch (at most
12 h); rotating a signing secret ends every session of that tool immediately. On Railway a tool with
no secret at all refuses everything but `/healthz` (it is only open in local dev).

**Owner setup** _(done and verified live 2026-09-29 — both secrets are Shared Variables referenced by the launcher + the one tool each; kept here for a rotation)_. Generate two NEW random values (e.g.
`openssl rand -base64 48`; not the R2 key, not the old gate secret) and set each on BOTH ends:

| Var | Set on | Notes |
| --- | --- | --- |
| `ATLAS_TOOL_SIGNING_SECRET` | launcher-api **and** atlas-tool | identical value on both |
| `SHEET_TOOL_SIGNING_SECRET` | launcher-api **and** sheet-tool | identical value on both; different from the atlas one |
| `IW_LEGACY_TOOL_KEY_UNTIL` | atlas-tool, sheet-tool (optional) | `YYYY-MM-DD` to move the cut-over, `off` to end it now |

Order: set the tool side first, then the launcher (a tool with the secret still accepts the old
handoff inside the window, so nothing breaks in between). Each tool logs its mode at boot:
`[gate] signed launch tokens (…); legacy ?k= accepted until 2026-10-13`.

**Transition and cut-over.** While a tool has no signing secret, nothing changes: the launcher keeps
sending the old handoff and the tool keeps its old gate. Once a tool HAS its signing secret, the old
handoff is still accepted **through 2026-10-13 (UTC)**, then refused automatically. It is only there
for tabs opened before the switch, so once both ends are set and a launch is verified, **end it
early** with `IW_LEGACY_TOOL_KEY_UNTIL=off` on both tools. After the cut-over: remove
`ATLAS_TOOL_SECRET`, `SHEET_TOOL_SECRET` and `ATLAS_BLUEPRINT_SECRET` from Railway and delete the
legacy branch in `launch.py` + `toolLaunch.ts` (tracked in the atlas-maker / sheet-maker status
files). Rotating a signing secret signs everyone out of that tool (they reopen it from the
launcher); there is no other session state to clean up.

## Backups (2026-09-29)

Nightly, encrypted, **off-bucket** backups of the launcher Postgres and the authored R2 sources.

- **Workflow:** `.github/workflows/nightly-backup.yml` runs `scripts/backup/iwbackup.py` at 02:37 UTC.
- **Where they go:** the separate R2 bucket **`invisible-backups`**, never `invisibleassets`.
- **Encryption:** age, to public keys. The job cannot decrypt what it wrote.
- **Nightly self-test:** every dump is test-restored into a throwaway `postgres:18`, and every row
  count is compared.
- **Alerting:** a failure opens the issue **"Nightly backup failed"**.

Design, the R2-versioning comparison, owner setup, restore runbooks and the 2026-09-29 test restore
are in **[docs/guides/backups.md](guides/backups.md)**.

| Prefix in `invisible-backups` | Holds | Lifecycle (owner-set) | Bucket lock |
| --- | --- | --- | --- |
| `postgres/` | `pg_dump -Fc` + per-table row counts (`.tar.age`) | expire 35 d | 7 d |
| `r2-docs/` | authored docs + `_backup/manifest.tsv` (`.tar.gz.age`) | expire 90 d | 7 d |
| `r2-assets/` | authored source assets + manifest (`.tar.age`) | expire 14 d | 7 d |
| `_restore-drill/` | scratch re-uploads from drills | expire 7 d | — |

**GitHub `backups` environment** (deployment branches: `main` only; no required reviewers):

- Secrets:
  - `BACKUP_DATABASE_URL`: the connection URL of a read-only `backup_reader` role;
  - `BACKUP_SRC_R2_ACCESS_KEY_ID` + `BACKUP_SRC_R2_SECRET_ACCESS_KEY`: R2 token
    `backup-source-reader`, Object Read only, scoped to `invisibleassets`;
  - `BACKUP_R2_ACCESS_KEY_ID` + `BACKUP_R2_SECRET_ACCESS_KEY`: R2 token `backup-writer`, Object
    Read & Write, scoped to `invisible-backups` only.
- Variables:
  - `BACKUP_AGE_RECIPIENTS`: required; the owner's age public keys, space-separated;
  - `BACKUP_R2_BUCKET` and `BACKUP_R2_ENDPOINT`: optional, default `invisible-backups` on the
    main account endpoint;
  - `BACKUP_SRC_R2_BUCKET` and `BACKUP_SRC_R2_ENDPOINT`: optional.
- Everything is dormant until `BACKUP_DATABASE_URL` is set: the run is a green no-op with a
  warning.

The **age identity** (the private key) lives only with the owner: a password manager plus an
offline copy, with a second break-glass key. It is never in Railway, GitHub or a session. Losing
every identity makes the backups unreadable.

**Railway's built-in Postgres backups** (Backups tab: Daily 6 d / Weekly 27 d / Monthly 89 d; PITR
optional) exist only on **Pro/Enterprise**. Turn them on if the workspace is on Pro. They complement
ours, but they live inside Railway and are deleted with the volume.

## DNS (Cloudflare)

- Zone `invisiblewall.org` on Cloudflare. `www`/`app` = CNAME → Railway, **DNS-only (grey cloud)** — proxying breaks Railway TLS.
- `games` = CNAME → Railway (the test server), **DNS-only** as well.
- `comfy` = the named tunnel (proxied/orange, behind Access).

## Branch ruleset on `main` (GitHub)

The repo is public, so rulesets are free. One **active** branch ruleset named `main` (id
`24185070`, GitHub → Settings → Rules → Rulesets) protects the default branch. It is set by the
owner only; agents never change repository settings.

**The ruleset, exactly:**

| Setting | Value |
|---|---|
| Enforcement status | **Active** |
| Bypass list | **empty** (nobody bypasses — owner included) |
| Target branches | **Include default branch** (`main`) |
| Restrict deletions | **on** |
| Block force pushes | **on** |
| Require a pull request before merging | **on** — required approvals **0**, no code-owner review, allowed methods merge/squash/rebase (the repo itself only enables squash) |
| Require status checks to pass | **on** — "Require branches to be up to date" **off**; source **GitHub Actions** for each check |
| Required checks (exact names) | `check-all (1/3)` · `check-all (2/3)` · `check-all (3/3)` · `python tests` · `eslint` · `check-secrets` |

Approvals stay at 0 because the owner and agents open and merge their own PRs; the checks are the
gate. "Up to date" stays off because it would re-run ~15 CPU-minutes of `check-all` on every PR each
time `main` moves.

**Where the names come from:** `check-all (n/3)` and `python tests` are the jobs in
`.github/workflows/checks.yml`, `eslint` is `.github/workflows/lint.yml`, `check-secrets` is
`.github/workflows/secrets.yml`. Renaming a job or the `check-all` matrix renames the check — change
the ruleset in the same PR, or every PR waits on a check that no longer exists.

**Why a docs-only PR is not blocked:** none of these workflows uses `paths-ignore` (a required check
skipped that way never reports and the PR waits forever). Checks and Lint always run; their first
step, `.github/actions/code-changed`, diffs the PR (merge commit vs its base parent) or the push
(`before..HEAD`), and when every changed file is `docs/**`, `.claude/**` or `*.md` it skips every
later step, so each job reports success in ~10 s without installing anything. An undecidable diff
(force-push, new branch) runs everything.

**State (2026-09-30):** applied — the live ruleset requires all six checks, plus deletions, force
pushes and PR-required (0 approvals). To recreate or repair it from a terminal with an admin token,
the whole ruleset in one call:

```bash
gh api -X PUT repos/Invisible-Wall-SL/Invisible-Engine/rulesets/24185070 --input - <<'EOF'
{"name":"main","target":"branch","enforcement":"active","bypass_actors":[],
 "conditions":{"ref_name":{"include":["~DEFAULT_BRANCH"],"exclude":[]}},
 "rules":[{"type":"deletion"},{"type":"non_fast_forward"},
  {"type":"pull_request","parameters":{"required_approving_review_count":0,
   "dismiss_stale_reviews_on_push":false,"require_code_owner_review":false,
   "require_last_push_approval":false,"required_review_thread_resolution":false,
   "require_extra_approval_for_unattributed_changes":true,
   "allowed_merge_methods":["merge","squash","rebase"]}},
  {"type":"required_status_checks","parameters":{"strict_required_status_checks_policy":false,
   "do_not_enforce_on_create":false,"required_status_checks":[
    {"context":"check-all (1/3)","integration_id":15368},
    {"context":"check-all (2/3)","integration_id":15368},
    {"context":"check-all (3/3)","integration_id":15368},
    {"context":"python tests","integration_id":15368},
    {"context":"eslint","integration_id":15368},
    {"context":"check-secrets","integration_id":15368}]}}]}
EOF
```

`15368` is the GitHub Actions app, so a status of the same name posted by anything else does not
satisfy the check. Verify afterwards with
`gh api repos/Invisible-Wall-SL/Invisible-Engine/rulesets/24185070 --jq '.rules[] | select(.type=="required_status_checks") | .parameters.required_status_checks[].context'`
— six names. With no bypass, a direct `git push origin main` is refused: every change lands through
a PR.

**Candidate, not yet required: `svelte-check (1/2)` · `svelte-check (2/2)`** —
`.github/workflows/svelte-check.yml`, the type-check ratchet against `svelte-check-baseline.json`
(`pnpm check:svelte`). It already follows the pattern above (no `paths-ignore`, `code-changed`
skip), so making it required is a settings change only: once it has run green on `main` for a
while, add both names (integration `15368`) to the `required_status_checks` list in the call above.

## Dependabot (GitHub)

`.github/dependabot.yml` asks for weekly (Monday 06:00 Madrid) grouped updates for three
ecosystems: **npm** (the pnpm workspace root lockfile), **pip** (`services/atlas-tool`,
`services/sheet-tool` and the hash-pinned `scripts/backup`) and **github-actions**. Minor + patch
bumps come as one PR per ecosystem per week. A major bump gets its own PR. For pip, every bump
shares one PR per directory, majors included. The services pin floors (`>=`), so Dependabot cannot
tell minor from major there: on the first run, 5 pip bumps came as 5 separate PRs (#904–#908).
Open version-update PRs are capped at 5 / 3 / 3. Security updates are grouped per ecosystem too, but they arrive when an
advisory lands, not on the schedule.

**Spine is pinned to 4.2.x.** Dependabot ignores major and minor bumps of `@esotericsoftware/*`, so
only 4.2.x patches arrive. A Spine runtime must match the editor version that exported the data, and
semver calls 4.2 → 4.3 a minor. Moving to 4.3 is a deliberate project, not a dependency bump.
`scripts/check-spine-version.mjs` (run by check:all) fails a hand bump the same way.

A Dependabot PR is gated like any other: it runs Checks, Lint and Secrets and cannot merge until
the six required checks pass. None of those jobs needs a secret, so Dependabot's secret-less runs
behave the same as a person's PR. Subjects are `deps: …` / `ci: …`, both accepted commit scopes.

**Owner step (one-time, GitHub → Settings → Advanced Security):** switch on **Dependabot alerts**
and **Dependabot security updates**. The config file alone schedules the version updates. Security
PRs are only raised with that switch on, and grouping them (the `applies-to: security-updates`
groups) also needs **Grouped security updates** on. Agents never change repository settings. To
check it from a terminal:
`gh api repos/Invisible-Wall-SL/Invisible-Engine --jq .security_and_analysis.dependabot_security_updates.status`
→ `enabled`, and `gh api -i repos/Invisible-Wall-SL/Invisible-Engine/vulnerability-alerts` → `204`
(alerts on; `404` = off). **State (2026-09-30):** both off, so this step is owed.

## Security / secret rotation

A rotation runbook: where each secret lives, who reads it, and what to redeploy. Never paste a
value into any doc or commit. After a rotation, **verify the runtime** (below), not the dashboard.
Railway variables only take effect after **Apply changes / Deploy** — a plain redeploy does not
apply staged vars.

### B9.2 — Rotation checklist for setup-time secrets

| Secret | Lives in / read by | How to rotate | Redeploy after |
| --- | --- | --- | --- |
| **R2 access key** (`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`, bucket `invisibleassets`) | Cloudflare R2 → API Tokens. Read by: Railway **launcher**, **atlas-tool**, **sheet-tool**, **Invisible-test-Server**; GitHub Actions repo secrets (`runtime-release.yml`, `runtime-rollback.yml` — miss those and every engine release fails; `typekit-mirror.yml`); the owner's desktop launcher only if its Settings opt-in *Publish games straight to R2* (or the owner-only model/node/tunnel publishing, *Seed Atlas*, `build_and_publish.py`) is used; owner-run maintenance scripts (`apps/launcher-api/scripts/*`, `scripts/seed-comfyui-models.py`); a RunPod pod while `pull-models.py` / `push-models.py` runs. Full consumer list: [rotate-a-secret](guides/rotate-a-secret.md). | Create a new token scoped to `invisibleassets` (read+write), switch every consumer, then delete the old token. | Each Railway service → Apply changes / Deploy; update the two Actions secrets; re-enter it in the owner's launcher via *R2 credentials…*. Since launcher v1.0.56 no publisher desktop needs it — ☁ Publish goes through the portal (`api/launcher/game-upload`), and a desktop still holding the old key falls back to the portal on its first rejected publish. |
| **Postgres password** | Inside `DATABASE_URL` on the **launcher** (and `BACKUP_DATABASE_URL` if it holds that role — see the backup row). | Railway Postgres service → Variables → regenerate credentials (or `ALTER USER … WITH PASSWORD …`). | Launcher → Apply changes / Deploy; `/api/health` must read `db: ok`. |
| **CF Access service token** (`CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`) | Cloudflare Zero Trust → Access → Service Auth (the token in front of `comfy.invisiblewall.org`). Read by **atlas-tool**. | Rotate/regenerate the service token, or create a new one, allow it in the Access policy, then delete the old. | atlas-tool → Apply changes / Deploy. Verify with `curl -H "CF-Access-Client-Id: …" -H "CF-Access-Client-Secret: …" https://comfy.invisiblewall.org/system_stats`. |
| **Tool signing secrets** (`ATLAS_TOOL_SIGNING_SECRET`, `SHEET_TOOL_SIGNING_SECRET`) | Railway Shared Variables → launcher + the one tool each. | New random value (see "Tool launch tokens"); set the tool side, then the launcher. | Both services. Everyone is signed out of that tool and reopens it from the launcher. |
| **Deploy token** | Admin → Settings → Deploy token (`app_settings`); `EDITOR_DOC_SECRET` is only its env fallback. Held by the build runners. | Admin → Settings → Rotate. | None for the portal; desktop launchers fetch the new value on their next Sync. |
| **`TEST_SERVER_SECRET`** | Invisible-test-Server; the **launcher** (sends it as a header on its `/refresh` pokes); the GitHub Actions secret of the same name; the owner's portal-publish script. | New random value in every place at once, while no Runtime release or rollback is running. | Test server + launcher → Apply changes / Deploy. A launcher left on the old value still publishes, but the game goes live only on the test server's next hydrate. |
| **`PIPELINE_CI_TOKEN`** | The **launcher**; the GitHub Actions secret of the same name (the current-games harness). Grants only the read-only game list `GET /api/pipeline/games`. | New random value (e.g. `openssl rand -hex 32`) in both places. | Launcher → Apply changes / Deploy. Harness runs between the two updates get a 401. |
| **`DIRECTOR_SERVICE_TOKEN`** | The **launcher**; the `director-worker` service once it exists (PLAN 3.x). Lets the worker call the Director adapters as a run's owner; no publish, Game Config, roles or merge op exists behind it. | New random value (e.g. `openssl rand -hex 32`) in both places. | Launcher + worker → Apply changes / Deploy. Adapter calls between the two updates get a 401; the worker retries them with the same `opId`. |
| **`RUNPOD_API_KEY`** | RunPod → Settings → API Keys. Read by the launcher, atlas-tool and the Serverless endpoint's own env. | Create a new key, switch all three, delete the old. | Launcher + atlas-tool; edit the endpoint's env in RunPod. |
| **`COMFY_ORG_API_KEY`** (gpt_image) | platform.comfy.org → API Keys. Read by atlas-tool, and locally by the desktop Atlas Maker. | Create a new key, switch consumers, revoke the old. | atlas-tool → Apply changes / Deploy. |
| **Backup source-reader R2 token** (`backup-source-reader`) | Cloudflare R2 → API Tokens. Object Read only on `invisibleassets`. GitHub env `backups` secrets `BACKUP_SRC_R2_ACCESS_KEY_ID` / `BACKUP_SRC_R2_SECRET_ACCESS_KEY`. Not used by any Railway service. | Create a new token with the same scope, then delete the old one. | Update the two secrets. Actions → **Nightly backup** → Run workflow → green. |
| **Backup writer R2 token** (`backup-writer`) | Cloudflare R2 → API Tokens. Object Read & Write on `invisible-backups` only. GitHub env `backups` secrets `BACKUP_R2_ACCESS_KEY_ID` / `BACKUP_R2_SECRET_ACCESS_KEY`. | Create a new token with the same scope, then delete the old one. A leaked copy cannot decrypt backups. The 7-day bucket lock stops it deleting the last week. | Update the two secrets → Run workflow → green. |
| **Backup DB role** (`backup_reader` password) | Inside `BACKUP_DATABASE_URL` (GitHub env `backups`). | `ALTER ROLE backup_reader PASSWORD '…';` via Railway → Postgres → Data. If the secret holds the superuser URL instead, rotating the Postgres password (row above) breaks the backup too. | Update `BACKUP_DATABASE_URL` → Run workflow → green. |
| **Backup age identity** (private key; public half in the `BACKUP_AGE_RECIPIENTS` variable) | Owner's password manager + an offline copy, never in a service. | `age-keygen -o new.txt`, then replace the old public key in `BACKUP_AGE_RECIPIENTS`. **Keep the old identity** until lifecycle has expired every archive made to it (90 d), or those become unreadable. | Run workflow, then do restore drill A (docs/guides/backups.md) with the new key. |

> This table is the summary. **Every** secret — including the GitHub, Cloudflare API and LLM keys it leaves out — with all its consumers, the rotation order and how to verify it, is in **[docs/guides/rotate-a-secret.md](guides/rotate-a-secret.md)**. The tool launch signing secrets have no dual-key window: expect a short 403 window while one is rotated.

> After every rotation, **verify the runtime** (not just the dashboard): probe the live URL / a no-secret diagnostic to confirm the new value took, then remove the diagnostic.
