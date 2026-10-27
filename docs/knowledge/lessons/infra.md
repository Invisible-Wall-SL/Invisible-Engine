# Infra — lessons

What has bitten infra work before, newest first. Format and rules: [README](../README.md).
Current state lives in [status/infra.md](../../status/infra.md); this file only keeps the traps.
Covers Railway deploys, Cloudflare (DNS, tunnel), R2, CI workflows, GHCR, git workflow and the
launcher's Drizzle migrations on prod. URLs, env-var names and runbooks: `docs/INFRA.md` and the
`/deploy` skill. ComfyUI and RunPod traps live in [comfyui.md](comfyui.md).

### CI render shards died before rendering anything
- **Symptom:** current-games and parity jobs failed at set-up; retries could only wait and fail.
- **Cause:** a slow apt mirror; `timeout` killed pnpm but not the `sudo apt-get` it started, which
  kept the dpkg lock; and each of 20 shards fetched the same fonts and libraries itself.
- **Fix:** `scripts/current-games/headless-shell.sh` waits for orphaned apt, installs from an
  `actions/cache` entry keyed on runner image + Playwright version; shards went 20 → 8.
- **Guard:** `scripts/current-games/retry.fixture.mjs` (step names classify set-up failures).
- **PR:** not recorded (2026-10-22; 2026-10-23; 2026-10-26) · source: `docs/status/infra.md`

### A merged commit never deployed
- **Symptom:** during a Railway outage a commit merged and never reached its service.
- **Cause:** Railway deploys on the push webhook only; a Watch Paths service misses a lost deploy
  until a later push touches its own files. A skipped service also reports `success`.
- **Fix:** every service reports `commit` in its health check; `scripts/deploy-drift.mjs` compares
  them with `main`, and `deploy-drift.yml` runs it after every push and keeps one issue open.
- **Guard:** `scripts/deploy-drift.fixture.mjs` (also pins Watch Paths against `docs/INFRA.md`).
- **PR:** not recorded (2026-10-21) · source: `docs/status/infra.md`

### Dependabot PRs can never go green
- **Symptom:** a Dependabot PR touching the runtime stays red on the required `current-games`.
- **Cause:** Dependabot runs get no Actions secrets. A `"latest"` spec also resolves across majors
  (`adapter-static` 4 needs SvelteKit 3), and a "minor" can be a data-format boundary.
- **Fix:** re-land the bumps on a normal branch; pin ranges; `@types/node` majors are ignored.
- **Guard:** `.github/dependabot.yml` header; INFRA "Dependabot".
- **PR:** #1049, #1106 re-landed (2026-10-08) · source: `docs/status/infra.md`

### Runtime release went red while every game served it
- **Symptom:** "verify the served bundle" timed out after 15 min and opened an issue.
- **Cause:** SvelteKit 2.70 deletes `bundle.<hash>.js` after inlining it into `index.html`, so the
  verifier's HEAD on it 404'd forever. The same deletion takes the source map with it.
- **Fix:** `verify-runtime-live.mjs` HEADs the bundle only for an embed build; inline builds are
  proved by the hashed name in `index.html` plus `X-Runtime-Release`. Maps: open item 7.
- **Guard:** none dedicated.
- **PR:** not recorded (2026-10-01) · source: `docs/status/infra.md`

### Chrome spikes failed with no devtools endpoint
- **Symptom:** required `check-all (n/3)` jobs failed in pairs at random; re-runs passed.
- **Cause:** a fresh runner reads Chrome's 435 MB install slowly the first time; launches beside
  other checks overran the 20 s stderr wait. Five copied launchers had drifted.
- **Fix:** one launcher, `tools/rigger-spike/chrome.mjs` (CDP pipe, retried launch only),
  one browser spike at a time, Chrome pre-read during install.
- **Guard:** the launcher prints `[chrome] ready in … (attempt n of 3)` so a retry is visible.
- **PR:** #921 (2026-09-30) · source: `docs/status/infra.md`

### A docs-only PR waited forever on a required check
- **Symptom:** risk found before making checks required: a skipped workflow never reports.
- **Cause:** `paths-ignore` skips the whole workflow, so its required check stays pending.
- **Fix:** no `paths-ignore`; `.github/actions/code-changed` skips the steps on docs-only diffs,
  so the job reports in about 10 s. A job skipped by `if:` reports its matrix name unexpanded.
- **Guard:** the action itself; all six names are required in the `main` ruleset.
- **PR:** #881 (2026-09-30) · source: `docs/status/infra.md`

### The games host reported healthy while serving nothing
- **Symptom:** an R2 blip during refresh took every game offline; `/healthz` still said ok.
- **Cause:** a failed manifest read emptied the registry instead of throwing; `/healthz` was
  always ok. Setting the refresh secret would also have 403'd every Publish refresh silently.
- **Fix:** a failed read throws and keeps serving; `/healthz` reports `lastHydrate` and 503s when
  empty; the launcher sends the secret as a header.
- **Guard:** the uptime monitor's `"ok":true` keyword check.
- **PR:** #868 (2026-09-29) · source: `docs/status/infra.md`

### Exported audio stopped shrinking
- **Symptom:** sound exports ship at full bitrate; the build is green.
- **Cause:** `ffmpeg-static` downloads its binary in a postinstall script that pnpm 10 blocks
  unless the package is in `onlyBuiltDependencies` (root `package.json`), or when GitHub Releases
  is unreachable at build time; `capAudioBitrate` then silently returns null.
- **Fix:** keep the `onlyBuiltDependencies` entry; `SOUND_TRANSCODE=0` disables the step.
- **Guard:** none; after a deploy, re-export a known over-encoded sound and check it shrank.
- **PR:** not recorded (2026-09-23) · source: `docs/INFRA.md`

### My runtime release wiped the game
- **Symptom:** an online game booted with no project art or config right after a push.
- **Cause:** the launcher rebuilds on every push and has no Railway healthcheck, so for ~100 s
  `/api/editor/runtime` 502s; a game booted then fell through to the sample game.
- **Fix:** the game retries ~75 s and says so. The window closes only with the launcher's
  Healthcheck Path `/api/health` (owner setting, not confirmed set).
- **Guard:** none until the healthcheck is set.
- **PR:** not recorded (2026-09-18) · source: `docs/INFRA.md`

### R2 unreachable from a Spanish line
- **Symptom:** tools talking to R2 from Spain time out (`ConnectTimeoutError`) at times.
- **Cause:** Spanish ISPs null-route Cloudflare anycast ranges around football matches; R2's S3
  endpoint sits in them. Railway is unaffected.
- **Fix:** none on our side; a desktop publish relays through the portal
  (`publish-game-via-portal.mjs`). Check TCP 443 first, not credentials or the bucket.
- **Guard:** none.
- **PR:** not recorded (2026-09-17) · source: `docs/INFRA.md`

### Every push killed a running atlas render
- **Symptom:** "lost contact with RunPod"; thirteen finished renders stranded in one week.
- **Cause:** a rollout is a container swap; `atlas-tool` keeps video sessions in memory, and with
  no Watch Paths every push (even docs-only) rebuilt it.
- **Fix:** Watch Paths on every repo-root service; `video_runner` re-attaches at boot and collects
  a finished render from its R2 hand-off slot.
- **Guard:** `scripts/deploy-drift.fixture.mjs` pins the Watch Paths table.
- **PR:** not recorded (2026-09-07) · source: `docs/INFRA.md`

### A route 404'd in production but was in my tree
- **Symptom:** `GET /comfyui/build → 404` live; the commit and CI were green.
- **Cause:** `.gitignore`'s bare `build` is unanchored and matched `routes/(app)/comfyui/build/`;
  `git add -A` skips ignored files silently.
- **Fix:** negations for `src/**/build/` in `.gitignore`.
- **Guard:** none; check `git status --ignored` when a new path seems missing.
- **PR:** not recorded (2026-08-25) · source: `docs/status/comfyui.md`

### A Railway build failed with an empty log
- **Symptom:** a service failed to build a commit that did not touch it, with no build log.
- **Cause:** Railway's builder, not our Dockerfile (a bad `COPY`/`RUN` always prints).
- **Fix:** deployment ⋮ → Redeploy; the last good deploy stays live meanwhile.
- **Guard:** none.
- **PR:** not recorded (2026-08-20) · source: `docs/INFRA.md`

### Prod 500s after a migration because of db push
- **Symptom:** authed routes 500'd after a deploy; later a migration's table was never created.
- **Cause:** `db:push` records nothing in `__drizzle_migrations`, and the migrator applies only
  entries newer than the max `created_at`: it replayed `0000`; a hand baseline then skipped `0009`.
- **Fix:** `migrate.ts` `reconcilePushProvisioned` replays journal SQL tolerating duplicates.
  `db:push` is banned on prod: `db:generate`, commit, deploy; the launcher migrates at boot.
- **Guard:** `/api/health` reports `schema: current` (503 when behind). No migrator fixture.
- **PR:** not recorded (2026-06-13; 2026-06-20) · source: `docs/INFRA.md`, `docs/history.md`

### The env var I set does nothing
- **Symptom:** a variable set in the Railway dashboard and "redeployed" has no effect.
- **Cause:** adding a variable only STAGES it; only the "Apply changes / Deploy" banner applies
  it, and a plain Redeploy of an old deployment does not.
- **Fix:** apply the staged change; give non-secret config a code default (`env.ts`).
- **Guard:** none; verify what the runtime sees, not the dashboard (`/deploy` skill).
- **PR:** not recorded · source: `docs/INFRA.md`, `.claude/skills/deploy/SKILL.md`

### The launcher build fell back to npm
- **Symptom:** the launcher's Railway build choked on `workspace:*`.
- **Cause:** with Root Directory `apps/launcher-api`, Railpack cannot see `pnpm-lock.yaml` or
  `packageManager` and runs `npm install`. The Python tools also need the repo root as context.
- **Fix:** Root Directory = repo root for launcher, atlas-tool and sheet-tool (Dockerfile Path set).
- **Guard:** none; INFRA "Services (Railway)".
- **PR:** not recorded (2026-05-31) · source: `docs/INFRA.md`

### A migration went to the wrong Railway environment
- **Symptom:** every authed request 500'd after an admin feature shipped, despite a migration.
- **Cause:** the code read columns the prod DB did not have yet, and the first migration attempt
  went to a stray second Railway environment, which carries its own Postgres.
- **Fix:** the stray environment was deleted; migrations now self-apply at boot (entry above).
- **Guard:** only `production` exists; confirm the env before any manual DB step.
- **PR:** not recorded (2026-05-30) · source: `docs/history.md`

### Railway TLS broke after proxying a record
- **Symptom:** a custom domain stopped serving valid TLS after turning on Cloudflare's proxy.
- **Cause:** Railway terminates TLS itself; an orange-cloud record breaks its certificate.
- **Fix:** `www`, `app`, `games` (and `rooms`) are DNS-only CNAMEs; only `comfy` is proxied.
- **Guard:** none; with `games` DNS-only there is no edge cache to purge.
- **PR:** not recorded · source: `docs/INFRA.md`

### A bare git push was refused with 403
- **Symptom:** `git push` 403s, or `git status` ahead/behind looks wrong; the fix never deploys.
- **Cause:** the clone's `main` may track `upstream` (the read-only SDK we forked from). A commit
  that is not pushed to `origin` deploys nothing.
- **Fix:** push explicitly (`git push origin <branch>`), or set `main` to track `origin/main`.
- **Guard:** `/deploy` skill: `git log origin/main..HEAD` must be empty after merging.
- **PR:** not recorded · source: root `CLAUDE.md`, `.claude/skills/deploy/SKILL.md`

### A PR carried commits from another branch
- **Symptom:** a small fix PR shows unrelated commits and files from someone's unmerged work.
- **Cause:** the fix branch was cut from the current (feature) branch, so its commits ride along
  and land with the squash-merge, unreviewed.
- **Fix:** `git fetch origin` and branch from `origin/main` for every fix, whatever is checked out.
- **Guard:** none automatic; check `git log origin/main..HEAD` before opening the PR.
- **PR:** not recorded · source: `.claude/agents/game-playtester.md`, root `CLAUDE.md`
