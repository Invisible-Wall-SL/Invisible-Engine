# ADR-0010 — QA's draft play

- **Status:** approved (2026-10-27, owner; see "Owner decision" at the end)
- **Date:** 2026-10-27
- **Scope:** PLAN card 9D, the prerequisite in ADR-0009 §3: serve `build.request_draft` and
  `build.play_draft` so QA can play the run's game with forced outcomes.
- **Builds on:** ADR-0002 (adapters, `director_ops`, jobs), ADR-0003 (events), ADR-0004 (harness).

## Context

- `qa.md` names `build.request_draft` and `build.play_draft`. No ops module serves them
  (`L/src/lib/server/director/registry.ts`), so `run.assign_task` refuses QA
  (`services/director-worker/src/workerTools.ts:402`). `check:director-adapters` allows only this gap.
- **A draft is not a code build.** A game is the shared runtime `_runtime/lines@<v>` plus the
  project's bundle. Publish assembles that bundle with `buildRuntimeBundle` (20–26 s, rewrites
  `deploy/` in place, under `withDeployWrite`) and freezes it with `deploy/` as a snapshot
  (`publishedRuntime.ts` `stageSnapshot`: ~430 server-side copies, 130–200 MB).
- **The harness already plays a frozen game.** `scripts/current-games/lib/serve.mjs` serves a
  `runtime.json` + `deploy/` on a runtime dir, beside a fresh Invisible Test Server dealt from the
  game's mock contract. `play.mjs` runs `screens/<kind>.json` through `window.__IE_DETERMINISM__`.
  `browser.mjs` records console errors over CDP in chrome-headless-shell.
- **Measured play time** (`scripts/current-games/costs.json`, one side, ubuntu-latest, SwiftShader):
  hw-classic-sample 135 s, lines 251 s, bookofborutremake 517 s, test2 644 s. So 2–11 minutes.
- **The repo is public**, so Actions logs and artifacts are public (ADR-0004 #1061/#1062).
- **Math must be proven unchanged.** OPEN_QUESTIONS: QA fails a run whose `templateConfigEtag` is
  null (`runs.ts:338`, `ops/gamemaker.ts:167`).
- **The worker's `job_done` is atlas-shaped** (`driver.ts:1384`). `billJob` records an `unbilled_job`
  error for a `finished` job with no `runpod` usage, and that error blocks the run's GPU submits.
  `finishStop` counts `director_atlas_jobs` only.

## 1. What a draft is

**Recommendation: a run-scoped freeze, the way Publish freezes, under the run's `director/` folder.**

- `build.request_draft` (agent `qa`; later `game-doctor`) does, under `withDeployWrite`:
  1. The publish gates that need no owner: family gate, `hasOwnBuiltBundle` (refuse), the flow check
     (`checkShippedFlowV2`; no override, so an invalid flow is a QA finding).
  2. `buildRuntimeBundle(projectKey, false)`, as Publish does.
  3. Copy `deploy/` and write `runtime.json` to `<C>/<P>/director/drafts/<draftId>/`, `runtime.json`
     last. One copy helper is shared with `stageSnapshot` (extracted, behaviour unchanged).
  4. Write `draft.json`: draftId, runId, runtime (`runtimePointer('lines')` today: version and
     commit), the mock contract, the project's config ETag, createdAt.
- **Never touched:** `published/**`, the pointer, `test_server/**` (games.json), `config/config.json`.
  The refusal layer already rejects those keys (`refusals.ts`).
- **The mock contract** is `mockContractOfBundle(protocol, draftBundle, …)`, the derivation Publish
  freezes. It works for a never-published project. The math is the template's, so this is the
  template's contract. `request_draft` proves it:
  - refuse when the run's `templateConfigEtag` is null (fail closed);
  - refuse when the project's config ETag differs from the run's `projectConfigEtag`;
  - when the template is published, refuse when its snapshot's contract differs from the draft's.
  Each refusal names the reason. QA reports it as a fail. Nothing is "fixed".
- `draftId` is `20261027T101530Z-3fa9` (the snapshot id format). Cost: ~30 s, ~430 Class A ops,
  130–200 MB.
- **Cleanup:** a run keeps its 2 newest drafts (`request_draft` deletes older ones). All of a run's
  drafts go 14 days after it ends, in the Admin › Invisible Director sweep that clears pending
  mockups (`mockupCleanup.ts`). A folder with no `runtime.json` is never played and is swept after 1 h.

## 2. Where the browser runs

Per play: one side of the kind's scenarios, 2–11 min. Railway figures are at its usage rates
($20/vCPU-month, $10/GB-month). Memory and image size are estimates, to be measured in 9D.

| Option | Cost per play | Wall time | Image / memory | New secrets / env | Privacy |
|---|---|---|---|---|---|
| (a) director-worker | ~$0.01 | 2–11 min | +250–350 MB; 0.5–1 GB per play beside every run's drive | none, but the worker has no R2 access today | private |
| **(b) `draft-player` service** | ~$0.01, idle ~$1–2/month | 2–11 min | ~400 MB image; 0.5–1 GB, one play at a time | `DRAFT_PLAYER_SECRET` (both), `DRAFT_PLAYER_URL` (launcher, code default) | private |
| (c) Actions `workflow_dispatch` | $0 (public repo) | +1–3 min cold start; jobs not picked up in ~15 min are cancelled | runner | a GitHub token with `actions: write` on the launcher | logs and artifacts public |
| (d) atlas-tool | ~$0.01 | 2–11 min | Python image + Node 22 + Chromium + test server | none | private |
| (e) launcher | ~$0.01 | 2–11 min | +350 MB on the user-facing image | none | private |

- **(a)** One process holds every run's lease and model stream. SwiftShader uses every core for
  minutes, and an out-of-memory kill stops every run. The worker would also need R2 or presigned URLs.
- **(c)** Draft art must not reach a public log or artifact. A console error can name a client's
  assets. The launcher would hold a write token to the repo's Actions. The queue is the slowest.
- **(d)** Another service's image and owner, and Node next to its GPU queue. No gain over (b).
- **(e)** No. A 2–11 min CPU-bound browser starves every user's request. The launcher also settles
  the job, so it must not be the thing that can hang.
- **Recommendation: (b).** A small Node 22 service, `services/draft-player`, with no public domain.
  It reuses `scripts/current-games/lib/{serve,play,browser}.mjs` and `services/test-server`
  unchanged. It holds **no R2 or database credential**: the launcher sends presigned URLs
  (`r2.ts` `presignManifestEntries` / `presignPut`).

## 3. Job lifecycle (mirrors the atlas render)

- **`build.play_draft { draftId, scenarios? }`** returns `{ jobRef }` at once. The default is every
  scenario of the kind's script. `jobRef` is `dp_[0-9a-f]{16}`. It is idempotent through
  `director_ops` (a replay returns the same `jobRef`). One play per run is queued at a time; a second
  call returns the queued one.
- **`director_draft_jobs`**, modelled on `director_atlas_jobs`: jobRef (pk), runId (cascade), agent,
  draftId, scenarios, status `queued|finished|failed|cancelled`, result, doneVia `callback|poll`,
  queuedAt, doneAt, plus the same two checks.
- **Submit (launcher → player):** `POST <DRAFT_PLAYER_URL>/play`, signed with `DRAFT_PLAYER_SECRET`.
  The body has the jobRef, presigned GETs for the draft's files and `_runtime/lines@<v>`, the
  contract, the scenarios, presigned PUTs for the report and up to 40 screenshots (1 h TTL), and a
  callback URL with a token (`atlasCallback.ts` scheme, its own scope). The player answers 202 and
  runs plays one at a time.
- **Report (player → launcher):** a signed `POST /api/director/drafts/callback?run=`. The launcher
  inserts and settles the rows and is the only writer of `job_done`; the worker's stop flips a
  stopping run's queued rows to `cancelled`, with no event. `settleDraftJob` updates the row where `status = 'queued'` and inserts
  `job_done` with `tool: 'build.play_draft'` in one transaction. Its NOTIFY wakes the worker.
- **Fallback watch:** in-process, `/progress?jobRef=` on a 60/120/240 s backoff. Unknown to the player
  (it restarted): submit again once, then fail. Give up 30 min after `queuedAt`. Re-armed at boot
  like `resumeAtlasJobWatches`.
- **No player deployed** (`DRAFT_PLAYER_URL` unset): `play_draft` queues and settles the job in the
  same transaction, as `failed` with `reason: 'no_player'`, "no draft player is deployed". This
  differs from a short timeout window: nothing could claim the job, so waiting proves nothing.
  It takes the same `job_done` path.
- **Stop:** a stopping run's queued plays are marked `cancelled`, and the player gets a best-effort
  `/cancel`. A late callback is a duplicate. Plays do not hold a stop open (`finishStop` is unchanged).
- **Worker routing:** `driver.ts`'s `job_done` branches on `event.tool === 'build.play_draft'`
  **before** `billJob` / `settleJob`. Those two are atlas-only: `billJob` would raise
  `unbilled_job` and block GPU submits. The draft branch appends the report summary to the queueing
  agent, then calls `finishStop`. Plays are not billed. At ~$0.01 they are Railway spend, not run
  spend (ADR-0006).

## 4. The play report

`plays/<jobRef>/report.json` in the draft folder. The summary rides on `job_done`:

- `draftId`, `runtime` (version + commit), `kind`, `contract` hash, `seconds`.
- `bootRefused`: the runtime's own `[runtime] boot stopped — …` line, or null.
- Per scenario:
  - `expected` (the script's `capture` list) and `reached`
  - `missing`: expected but not reached
  - `stall`: the op, frames and probe state when a wait ran out, or null
  - `consoleErrors`: the last 20, each cut to 300 characters
  - `shots`: screen → screenshot key
- **Routing:** QA reads the summary, then calls `run.submit_qa` (findings per screen: reached /
  missing / stalled / errors). Today that writes an activity line. 9D also makes the worker append
  QA's summary to the coordinator, as `qa.md` says ("a failure goes to the coordinator"). The art
  director gets it through the coordinator, as with QA's asset numbers. The run page shows the
  screenshots at the batch and "before publishing" checkpoints (a director-frontend follow-up).

## 5. What is built before the owner answers

Agreed, with two changes. Built now, with no service, no Chromium in an image, and no new env var or
secret:

- `ops/build.ts` (both ops, the refusals in §1) and `build: 'gameMaker'` in `ADAPTER_TOOL_IDS`.
- `director_draft_jobs` and its migration, `settleDraftJob`, the callback route, the fallback watch,
  the boot re-arm and the `no_player` settle.
- The worker's `build.play_draft` branch. `check:director-adapters` drops its allowed gap.
- **Change 1:** the player module lives in `services/draft-player/src/` and imports the harness lib
  unchanged. Any edit under `scripts/current-games/**` makes `current-games-verdict.yml` fail without
  reading the report, so the owner would have to post the status by hand (ADR-0004 #1082). Its local
  fixture plays a small checked-in draft against a locally built runtime.
- **Change 2:** while no player exists, a play settles at once as `no_player` (§3). There is no
  timer. QA then reports "draft not played: no draft player is deployed", and the coordinator says so
  at hand-off.
- Waits for the owner: the Railway service, its Dockerfile deploy and the two env vars.

## Consequences

- One new Railway service (private, ~$1–2/month idle) and one new shared secret.
- Each draft adds 130–200 MB to the run's R2 folder, with 2 per run kept and swept 14 days after the
  run ends.
- QA runs on every run. Until the player is deployed, every run's QA honestly reports "not played".
- The draft shows what Publish would ship today, on today's runtime. It is not a branch build:
  engine changes are proven by ADR-0004, not here.

## Needs owner approval

1. **Where plays run:** a new private Railway service `draft-player`, which you create, with
   `DRAFT_PLAYER_SECRET` shared with the launcher. Default: yes. The alternative, GitHub Actions,
   is free but public.
2. **A template with no authored `config/config.json`** gets `templateConfigEtag` null today
   (`runs.ts:338`: both reads are null). Under "fail closed" its QA always fails, even though nothing
   moved. Default: record "no config, before and after" as proven (the kind's committed config is
   the math), and keep null for "the template moved".
3. **Draft retention:** keep 2 per run, and delete them all 14 days after the run ends. Default: yes.
4. **Not played is not a pass:** when no player is deployed, QA reports "not played" and the run can
   still hand off with that stated. Default: yes. The stricter option blocks hand-off.

## Owner decision (2026-10-27)

All four defaults approved:

1. **Plays run in a new private Railway service, `draft-player`**, with `DRAFT_PLAYER_SECRET`
   shared with the launcher.
2. **A template with no authored `config/config.json`** is recorded as "no config before and
   after", which counts as proven unchanged: the kind's committed config is the math. A null
   `templateConfigEtag` still means "the template moved", and QA fails it.
3. **Drafts:** at most 2 per run, all deleted 14 days after the run ends.
4. **Not played is not a pass.** With no player deployed, QA reports "not played" and the
   hand-off says so. It does not block the hand-off.
