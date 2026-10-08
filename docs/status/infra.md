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
- **svelte-check ratchet runs on every PR + push, NOT required yet** (`.github/workflows/svelte-check.yml`,
  jobs `svelte-check (1/2)` / `svelte-check (2/2)`). `pnpm check:svelte`
  (`scripts/svelte-check-ratchet.mjs`) type-checks each of the 17 workspace packages that have a
  `.svelte` file (`svelte-kit sync` first, 8 GB heap for `apps/lines`). It compares each package's errors, as
  a count per (file, `<source>:<code>`), to `svelte-check-baseline.json`. Any count going up fails;
  going down passes with a notice to lower it. A crashed run (no `COMPLETED` line) fails.
- **Dependabot** (`.github/dependabot.yml`): weekly grouped npm / pip / github-actions updates, capped
  open PRs, gated by the same required checks. `current-games` needs secrets Dependabot's runs never
  get, so a Dependabot PR touching the runtime is re-landed on a normal branch (INFRA "Dependabot");
  `@types/node` majors are ignored (types follow Node 22). Its security updates wait on the owner switch
  (Blocked). There is no rig runtime package to pin any more — rigs run on our own
  `packages/engine-rig` — and `scripts/check-rig-runtime-free.mjs` (check:all) fails any
  third-party rig runtime manifest entry, lockfile entry, import or vendored file (2026-10-06 below).

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
5. **Make `svelte-check (1/2)` / `svelte-check (2/2)` required** once they have run green on `main`
   for a while — an owner ruleset change only (INFRA "Branch ruleset on `main`"). Until then a red
   run does not block a merge, so read it.
6. **Burn down the svelte-check baseline** (`svelte-check-baseline.json`). Every Svelte package
   carries errors; the largest share in `apps/lines` is the tracked `static/assets/**/index.ts`
   asset indexes. Lower an entry with `pnpm check:svelte --only <pkg> --update` in the PR that fixes
   it — the job prints a notice when a package is below its baseline.
7. **Runtime source maps stopped reaching Sentry with SvelteKit 2.70.** Under
   `bundleStrategy: 'inline'`, kit now deletes the client bundle after inlining it, and with it
   the map. `scripts/sentry-sourcemaps.mjs` finds no map, warns "nothing to upload" and stays green.
   This is harmless while Sentry is dormant (owner setup, Blocked) but must be fixed before it goes
   live. The likely fix is a Vite `generateBundle` hook in `config-vite` that writes the bundle's
   map aside before kit deletes it.

## Blocked (owner / external)
- **Dependabot security updates (owner, ~2 min, GitHub → Settings → Advanced Security):** switch on
  Dependabot alerts, Dependabot security updates and Grouped security updates. Both are off today
  (read via `gh api`); the weekly version updates run without them, security PRs do not. Details
  and the read-back commands: INFRA "Dependabot".
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
- 2026-10-08 — **current-games no longer fails games republished mid-run.** Each render shard used
  to re-read `test_server/games.json` from R2 minutes after the plan hashed it. The launcher rewrites
  that one key on every publish (`upsertTestServerGame`, and the entry's `updatedAt` is part of the
  hashed contract), so a publish between the two reads failed that game on BOTH sides with "the
  game's mock contract changed during the run". Runs 37788159984, 37807647398 and Phase 5a's run on
  aab1ead each needed a re-run, and the one-side-only captures inflated "N changed screens". The plan
  now freezes the contracts it hashed in `contracts.json` beside `plan.json`
  (`scripts/current-games/lib/contracts.mjs`), sealed with AES-256-GCM under a key derived from the
  R2 read secret, because the plan folder is a public artifact. The shards deal from that copy and
  never read the manifest. The hash check stays as a safety net. Proof: `contracts.fixture.mjs`, plus
  a plan → rewrite → render run on the stand-in fixtures (in the PR).
- 2026-10-08 — **Dependabot #1049 (npm) and #1106 (pip) re-landed in one PR.** Neither could pass the
  required `current-games` check: Dependabot runs get no Actions secrets. The re-land carries
  #1049's bumps (pixi.js 8.21 → 8.22, @sentry/browser + node 11.1 → 11.4, @anthropic-ai/sdk 0.131,
  typescript-eslint 8.71, turbo 2.11.7, addon-svelte-csf 5.1.5, …) except
  `@sveltejs/adapter-static`, which was `"latest"` and would resolve to 4.0.0 (needs SvelteKit 3; we
  are on 2): it is now `^3` in config-svelte, config-storybook, components-storybook and
  pixi-svelte-storybook. `@types/node` in eslint-config-custom goes 26.2.0 → 22.13.5, like every
  other package (vite's optional peer still resolves to 26.2.0 in the lock; no manifest asks for
  it). #1106: boto3/botocore 1.43.108, tzdata 2026.5 (backup hashes checked against PyPI), sentry-sdk
  floor 2.71. `.github/dependabot.yml` ignores `@types/node` majors, and its header plus INFRA
  "Dependabot" now say why such PRs are re-landed. #1089 (actions) is re-landed in its own PR: it
  edits the harness.
- 2026-10-06 — **rig runtime gate replaced.** The old version gate (which pinned
  the third-party runtime packages to 4.2.x) is gone with the packages themselves; the new
  `scripts/check-rig-runtime-free.mjs` fails any of them coming back, and `.github/dependabot.yml`
  drops its rig ignore block. Detail: `docs/status/rigger.md` (Phase 6, `engine-rig`).
- 2026-10-01 — **The runtime release verifier accepts an inlined bundle.** #936's release
  (`lines@e81c0c21ce3f`) went red at "verify the served bundle" after 15 min and opened #940, though
  every game was already serving it. SvelteKit 2.70 deletes the emitted `bundle.<hash>.js` once it
  has inlined it into `index.html`, so the verifier's HEAD on `/_app/immutable/bundle.<hash>.js`
  404'd forever. `verify-runtime-live.mjs` now HEADs that file only when the served page loads it
  by `<script src>` (an embed build). For an inline build, the content-hashed name in the served
  `index.html` plus `X-Runtime-Release` is the proof. Run against live, it reports LIVE after 11 s.
  `publish-game-via-portal.mjs` and the desktop `verify_deploy_live()` only match the marker inside
  `index.html`, so they were unaffected. Source maps: open item 7.
- 2026-10-01 — **Dependabot's 34-package npm group (#929) and TypeScript 5.9.3 (#915) land in one
  PR.** This is a runtime release: pixi.js 8.8 → 8.21, svelte 5.35 → 5.57, the reference Pixi runtime 4.2.74 →
  4.2.120, SvelteKit 2.17 → 2.70, xstate, tsx 4.23, esbuild 0.28 and more. #929 was red for four
  reasons, plus one finding:
  - ESLint: svelte 5.57 no longer emits two a11y warnings, so two `svelte-ignore` comments became
    unused (editor `+page.svelte`, flow-v2 `PinDropMenu.svelte`). Removed.
  - svelte-check: pixi 8.21 types `container.filters` as `readonly Filter[]`
    (`cameraEffects.ts`). TS 5.9 made six launcher `new Response(bytes)` calls fail
    (`Uint8Array<ArrayBufferLike>` is not a `BodyInit`). Fixed once, in `getObjectBytes`, which now
    returns `Uint8Array<ArrayBuffer>` through a type predicate (no copy on Node). Baselines went down:
    components-storybook 8 → 7 and engine-layout 296 → 291.
  - `tools/flow-spike:slamcounter`: tsx ≥ 4.20 resolves through `module.registerHooks` and
    short-circuits every specifier, so the stub's off-thread `register()` hook never ran
    (ERR_UNKNOWN_FILE_EXTENSION ".svelte"). It now registers in-thread.
  - `cinematic-pixi`'s source regex broke on the reference Pixi runtime's rewritten `autoUpdate` setter. Verdict
    and the behavioural replacement: [cinematic](cinematic.md). The seven esbuild spikes stopped
    hard-coding `esbuild@0.25.5` ([rigger](rigger.md)).
  - Found in the browser proof: `<Cinematic>` had thrown on every in-game mount since it was written.
    The cause is a pre-existing bug, not the bump ([cinematic](cinematic.md)).
  - Before merge: a local `apps/lines` build played the remake's live data at 60 fps on the headless
    shell, against the book mock with `BIG_WIN=1`. It covered spins, a MEGA WIN, a bought 10-spin
    round with intro and outro, and the cinematic. Every rig track ran at 1.00× real time, no
    update ran twice in a tick, and there were 0 console errors. The 13
    `[Cache] already has key` warnings are also on the live pixi 8.8 build.
- 2026-10-01 — **Dependabot stops offering 4.3-format.** The weekly `npm-minor-patch` group (#911)
  carried the reference runtime + the reference Pixi runtime 4.2.74 → 4.3.13 among 34 bumps, because
  semver calls it a minor. For rig it is a data-format boundary: the runtime must match the editor
  version, and every exported skeleton and the Rigger's `.irig` are 4.2 JSON. CI caught it only
  because the Rigger spikes hard-coded the reference core runtime's 4.2.74 `.pnpm` store path
  (ERR_MODULE_NOT_FOUND).
  - `.github/dependabot.yml` ignores `semver-major` and `semver-minor` for the third-party runtime packages
    (4.2.x patches still come). A 4.3 move is a project: re-export the assets, move the Rigger's
    format, the vendored reference WebGL runtime and the spikes.
  - New version gate (discovered by check:all; since replaced by `scripts/check-rig-runtime-free.mjs`): every tracked
    `package.json`'s third-party runtime spec must be `4.2.x` / `~4.2.x` (a `^` range is refused —
    a fresh lock could resolve 4.3), and every lockfile entry must resolve to 4.2.x. Mutants: a
    `^4.3.13` spec in pixi-svelte and a 4.3.13 core-runtime lockfile key each fail it, exit 1.
  - The spikes resolve rig through one helper, `tools/rigger-spike/rig.mjs` ([rigger](rigger.md)).
  - #911 was asked to `@dependabot recreate` once this landed.
- 2026-09-30 — **The "no devtools endpoint" flake in the required `check-all (n/3)` jobs is fixed**
  (PR #921).
  - The five Chrome spikes (`skins-panel`, `rig-switch`, `rigtext-panel`, `rigtext-browser`,
    `trimmesh`) failed intermittently with "no devtools endpoint", and re-runs passed. On
    2026-09-30 alone: 14 spike failures in 9 Checks runs, including on `main`.
  - **Root cause, measured on the runner:** Chrome's install is 435 MB, and a fresh runner's disk
    reads it slowly the first time. A cold read took 3.3–7.9 s; a second read took 43–58 ms. The
    first launch waited on that read: 4–14 s on an idle runner, then ~0.2 s after it. Beside the
    shard's other checks it took 30.9 s and 39.6 s. Two spikes launching together shared the wait
    and finished in the same second, which is why they failed in pairs. The copied launchers read
    the DevTools URL off stderr with a 20 s limit. Ruled out by probes: CPU load, cold page cache
    (`drop_caches`), fontconfig.
  - **Fix:** `tools/rigger-spike/chrome.mjs` is the one launcher; all five spikes import it, and the
    copies are gone. The copies had drifted: two never closed Chrome, two never timed out a CDP call.
    - CDP runs over `--remote-debugging-pipe`, with a fresh profile per launch.
    - Chrome counts as started when it answers `Browser.getVersion` and a page is attached.
    - Only the launch is retried: 45 s per attempt, 3 attempts, on `about:blank`, so a thrown-away
      launch never reaches the spike's server. Nothing after the launch is retried; every CDP call
      has its own timeout.
    - Teardown is `Browser.close`, then a process-group kill, then removal of the profile. It also
      runs on process exit, and Chrome exits by itself when the pipe closes.
  - **Also:** `check:all` runs one browser spike at a time (`BROWSER_SLOTS`), and prints each one's
    `[chrome] ready in … (attempt n of 3)` line even when it passes, so a retry is visible.
    `checks.yml` pre-reads Chrome's install in the background while pnpm installs. Serialising
    costs 2–8 s per shard, within run-to-run noise.
  - **Proof:**
    - 150 local runs (30 rounds × 5 spikes, 5 at once) and 420 CI runs (14 runners × 30): no
      failures and no retries.
    - Worst CI time-to-ready was 39.6 s, in the synthetic case of 5 cold first launches at once,
      still inside one attempt.
    - In real check-all with the full fix, Chrome was ready in 0.3–2.2 s; the same shard-2 spike
      took 34.6 s before the pre-read.
    - Mutants on the runner: a flipped assertion still fails, with one launch and no retry. A page
      stuck in `for(;;)` fails on the CDP timeout, with no relaunch. A Chrome that never answers
      fails after 3 × 45 s (151 s), under the runner's 300 s per-check kill. A crashing Chrome
      fails in under 1 s, with its stderr. SIGKILLing a spike leaves 0 Chrome processes.
- 2026-09-30 — **svelte-check ratchet + Dependabot.** Closed the old open item 5 ("svelte-check is
  not a dependency anywhere").
  - `svelte-check@4.7.6` is now a devDependency of all 17 packages with a `.svelte` file. A new
    Svelte package is discovered automatically, and the run refuses it until it declares the dependency.
  - The baseline was taken on a fresh worktree after `pnpm install` and confirmed on CI's Linux:
    **1,165 errors**. Per package: `apps/lines` 166 · `apps/launcher-api` 53 · cluster 111 · price 119 · scatter 110 · ways 101 ·
    number-picker 26 · engine-layout 296 (276 in its Node `scripts/`, no `@types/node`) · engine-game
    38 · pixi-svelte-storybook 43 · components-shared 25 · -ui-html 24 · -ui-pixi 23 · pixi-svelte
    14 · components-storybook 8 · components-pixi 7 · components-layout 1.
  - The Windows-taken baseline matched Linux CI in all 17 packages except for one flaky error. In
    `components-shared`, 7 `svelte(style)` "No Lingui config found" errors appear on every Windows
    run, and on 1 Linux CI run in 3 of the same baseline (a YAML-only PR, #916). That run failed.
    The runner drops exactly that error on every platform (`withoutFlakyErrors`). Its root cause,
    the style preprocessor sometimes failing to load `lingui.config.ts`, is not investigated.
  - CI time: `svelte-check (1/2)` 2m11s, `(2/2)` 1m52s, in parallel with the other checks.
  - Why lines is below the ad-hoc ~189 and the launcher below ~59: the runner `svelte-kit sync`s
    first, so `$app/*` / `./$types` resolve.
  - `packages/pixi-svelte/tsconfig.json` now excludes `src/lib/transcoders`. The vendored Emscripten
    `libktx.js` is only loaded by URL, and `checkJs` reported 3,114 errors in it.
  - Proof: a planted `const x: number = "x"` failed the run with an `::error` annotation, exit 1.
    A re-run on an unchanged tree matched the baseline exactly. Local wall time is ~5.5 min for all 17
    packages in sequence.
  - `.github/dependabot.yml` was added (INFRA "Dependabot"). Security updates need the owner switch
    (Blocked).
  - Dependabot's first run on the merge: github-actions grouped as designed (#903, 7 updates in one
    PR). pip opened 5 single PRs (#904–#908), because the services pin floors, so a `minor`/`patch`
    filter matches nothing. A follow-up groups every pip bump by pattern alone. The 5 open PRs stay
    open: closing a Dependabot PR by hand tells it to ignore that version.
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
