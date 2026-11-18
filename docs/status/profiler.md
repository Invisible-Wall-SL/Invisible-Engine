# Invisible Profiler — status

> Guide: [docs/tools/profiler.md](../tools/profiler.md) · Plan:
> [docs/design/invisible-profiler.md](../design/invisible-profiler.md) · Agent:
> `.claude/agents/launcher-studio.md` (the probe side: `engine-pixi-svelte`)

**One-line state:** step **P1 "Capture and keep" built 2026-11-16** (merged, #1691) — a launcher
tool (`/profiler`, every role, Create section) that opens a 24-hour capture session for a project's
published games, keeps every `?perf=1` reading the game sends (or that is pasted) in R2 and
Postgres, and lists them per project; readings go after 15 days unless kept. Step **P2 "Builds"
built 2026-11-17** (merged, #1697): every desktop ☁ Publish / 📦 Deliver (launcher v1.0.68+) registers its
build breakdown, listed on a **Builds** tab with the previous-build diff and the readings taken on
each build. Step **P3 "Devices and budgets" built 2026-11-17** (#1738): per-project
budget overrides on top of the studio defaults in code, a **Devices** tab judging readings per
device class and GPU, a **Budgets** tab to edit the lines, and pass / warn / fail on every build.
Step **P6 "Lab runs" built 2026-11-17**: a nightly / on-demand GitHub Actions run plays every live
online game headless and keeps a `lab` reading, compared with the game's previous one on per-frame
counts, never fps. P4, P5 and P7 are planned.

## Current state

- **Registry.** Tool id `profiler`, "Invisible Profiler" (bar name **Profiler**), doc slug
  `profiler`, `kind: 'online'`, in `ROLE_TOOLS` of every role and in the **Create** stage
  (`apps/launcher-api/src/lib/roles.ts`); `check-family-tools.ts` lists it.
- **Page.** `src/routes/(app)/profiler/+page.svelte` + `+page.server.ts`: project picker
  (`resolveToolScope`, `?project=`), four tabs (**Readings**, **Devices**, **Builds**, **Budgets**;
  `?tab=devices|builds|budgets`; the tab bar is copied from Pipeline Changes). Readings has three `SectionCard`s — **New capture** (device
  label, Open capture → per published game four QR codes: As shipped, Particles off, Element FX
  off, Antialias off), **Paste a reading** (textarea + device label + **Game** picker → Keep
  reading) and **Readings** (newest 500; the game under the device, per-phase fps / p95 / >33 ms,
  draws, texture MB, a Keep checkbox with the days left, a JSON link).
  The list re-reads every 10 s while a session is open and the tab is visible.
- **Builds tab.** One row per build, newest first (200 max): built time, `v<build>` with kind /
  profile / `opt` / `debug` tags and the game key, a stacked bar by category, shipped MB, Δ MB
  against the previous build of the same game key and kind, GPU MB, issues, readings count, Keep
  (`newest` when it is the newest of its game key and kind), **Breakdown** and **JSON** links.
  Clicking a build number opens a detail card: facts, the diff line, a category table with the
  previous MB and Δ, and the readings on that build. Helpers in `src/lib/profilerBuilds.ts`
  (`summarizeBuildBreakdown`, `previousBuild`, `buildDiff`, `readingOnBuild`).
- **Build records.** `perf_builds` (migration `drizzle/0042_perf_builds.sql`, schema `perfBuilds`,
  FK to `projects` on delete cascade): one row per desktop Publish / Deliver, id = the presigned
  upload's id; game key, build number (counted per game key per launcher machine, so not unique
  alone), kind `publish` / `delivery`, profile, debug, optimize, `builtAt`, `engineSha` (stands in
  for a runtime release: a desktop build boots no shared runtime), shipped / code / GPU-estimate /
  removed / never-loaded / duplicate bytes, categories (id, label, files, bytes), issue counts, R2
  key, `keep`, `purging_at`. The game key must be one of the project's games; a 📦 Deliver may
  also use a key no game holds yet (a game only ever delivered), never another project's
  (`gameKeyRefusal`, 403) — so no request can open a line whose newest build the purge never takes.
- **Build flow.** Desktop launcher `upload_build_record` → `POST /api/profiler/uploads?project=` with
  its portal Bearer token (needs `gamePublish` + the project; `profiler/origin.ts` `buildOrigin`) →
  presigned PUT to `perf/uploads/` → `POST /api/profiler/builds { project, gameKey, upload }`. The
  server reads and summarises the breakdown itself (`profiler/builds.ts` `registerBuild`; only the
  game key is taken from the launcher), writes
  `<client>/<project>/perf/builds/<gameKey>/v<build>-<id>.json` (`perfBuildKey` — not the design's `perf/builds/v<build>.json`: build numbers repeat across game
  keys and machines), inserts the row, drops the staged copy. Category ids are merged by id (a
  repeated or missing id is one row). Resend-safe: a second register of the same upload answers the
  first (also once the staged copy is gone); only the request that wrote the build file may delete
  it, and a racing register that loses answers the winner's row. Bearer uploads do not count
  against the 20-pending staged-upload cap readings have (a capture filling the slots must not cost
  a publish its record — the launcher does not retry). A failed send is one line in the launcher's
  result, never a failed publish; a 📦 Deliver package-only override re-run (after a missing-art
  refusal) sends the record of the build it packages. The desktop launcher repo's fixture
  `verify_profiler_upload.py` (26 checks) covers its side. `GET` / `PATCH
/api/profiler/builds/[id]` (JSON; Keep); `GET …/[id]/breakdown` renders the engine's own
  breakdown page (`scripts/lib/build-breakdown.mjs`) from the JSON, served sandboxed.
- **Readings ↔ builds.** `readingOnBuild`: the same game (`perf_reports.game_key`, migration
  `0043`: the capture token names it, Paste's Game picker sets it; a reading without one is matched
  on the stamp alone), the same build number in the `__IE_BUILD__` stamp, and the same commit when
  both have one (a short sha matches its long form). Reading list items carry `gameKey`,
  `buildSha` and `runtimeRelease`.
- **Runtime release on readings.** A reading from an ONLINE card (`?runtime=1`) is stamped at
  receipt with the version its project's published snapshot's runtime pointer
  (`_runtime/<runtime>/current.json`) names (`store.ts` `runtimeReleaseOf`) — the release the phone
  loaded unless one shipped between its load and its send. Null for a desktop build (its engine
  commit is in the stamp) and for a reading with no game.
- **Capture token.** `src/lib/server/profiler/captureToken.ts`: the tool-launch-token format with
  its own audience (`typ: perf`, `aud: profiler`), one session, one project and — since P2's
  follow-up — one game (a token per game of the session; a token minted before verifies with no
  game), 24 h. Signed with
  `PROFILER_SIGNING_SECRET`, else a key HMAC-derived from `R2_SECRET_ACCESS_KEY`. It rides the game
  URL as `&perfsession=` and comes back in `X-IW-Perf-Session`. On every send the opener is checked
  as they are now (active, still holding the tool and the project), so revoking them ends their
  sessions.
- **API.** `POST /api/profiler/sessions` (open a capture, QR codes server-rendered by `qrcode`);
  `POST /api/profiler/reports` (a report body, or `{ upload: id }` to register a presigned one;
  capture token or a signed-in Paste); `POST /api/profiler/uploads` (presigned PUT for a report over
  `PERF_INLINE_MAX_BYTES` = 480 KB; 8 MB max kept — the URL names a staging key under
  `perf/uploads/`, never a reading's key; register reads it bounded and only while its ETag is the
  one the HEAD saw, writes the reading's own file, then drops the staged copy; registering twice
  answers the same id, also once the staged copy is gone; only the request that wrote the file may
  delete it); `GET` / `PATCH /api/profiler/reports/[id]`
  (full JSON download; Keep). The two probe routes answer CORS `*` without credentials on every
  status (`profiler/cors.ts`, applied in `hooks.server.ts`), so a bad token reads as its 401 — `*`
  rather than the games origin, safe because no response allows credentials and Paste (cookie)
  requires `application/json` exactly, which forces a preflight. A session takes 200 readings (429
  after); a project may have 20 staged reading uploads waiting (a presigned PUT cannot be size-limited on
  R2, so the count bounds it; the sweep also removes any staged file over 8 MB at once).
- **Reading a report.** `src/lib/profiler.ts` `summarizePerfReport`: reads `perf: 7` only; refuses
  a non-report, another version, or one with no frames, with a sentence. Summary = device class and
  reason, GPU, UA family (browser + OS, no full UA), DPR, canvas, build version / sha, test-switch
  flags, idle / spinning / round fps-p50-p95-hitches-frames, draws and JS ms a frame, texture MB.
- **Storage.** Full JSON in R2 at `<client>/<project>/perf/reports/<id>.json` (`perfReportKey`,
  `SUB.perf`; written create-only, file before row, a failed insert removes the file unless the row
  turns out to exist); summary in
  `perf_reports` (migration `drizzle/0041_perf_reports.sql`, FK to `projects` on delete cascade). A
  duplicated project starts without `perf/` (`projectDuplicate.ts`).
- **Retention.** Readings: 15 days from capture unless `keep` (`PERF_RETENTION_DAYS`). Builds: 15
  days from `registered_at` unless `keep`, except the newest build of each game key and kind (a
  superset of the owner's "newest build of each project is never purged": a publish and a delivery
  each keep one to compare with). `profiler/purge.ts`
  claims (`purging_at`), deletes the R2 file, then the row — each step repeatable, Keep cannot land
  on a claimed row. The same run sweeps staged uploads older than a day (never registered), and
  reading and build files older than a day that no row names (`sweepOrphanFiles`: a crash between a
  file write and its row). Both sweeps list every `<client>/<project>` the project's perf files may
  live under — its client now, plus every client a reading or build was kept under, since moving a
  project to another client moves no R2 data. `purgeJob.ts` `runPerfPurge` runs readings, builds,
  then the two sweeps, 5 min after boot and every 24 h, started from `hooks.server.ts` `init`.
- **Probe (engine — merging it is a runtime release).** `apps/lines/src/components/PerfHud.svelte`
  imports `apps/lines/src/game/perfSend.ts` only when the URL has `perfsession`; then the readout
  shows **Send**, and also sends on its own before a Reset clears it and when the page is hidden
  (only a reading with frames not yet sent; on hide without `textureList` and `spikes`, marked
  `trimmed`, so it fits a `keepalive` request ≤ 60 KB). `__IE_PERF__('reset' | 'take')` never
  sends. It posts to the launcher the game boots from (`?editorDocBase=`, else `DEFAULT_DOC_BASE`).
  Without `perfsession` it makes no request. A reading over 480 KB goes by presigned PUT; when that
  cannot go, the same trimmed form is posted inline instead and the readout says "trimmed"
  (`perfSendCore.ts`, fixture `apps/lines/src/game/perfSend.fixture.ts`). Today it never can from
  a phone: R2's CORS allows PUT only from `app.invisiblewall.org` (probed 2026-11-17), so a phone's
  large reading arrives trimmed — open item 4.
- **Budgets.** `perf_budgets` (migration `drizzle/0044_perf_budgets.sql`, schema `perfBudgets`,
  FK to `projects` on delete cascade) holds **per-project overrides only**. The studio defaults
  are `STUDIO_BUDGETS` in `src/lib/profilerBudgets.ts` — code, reviewed, not an editable studio
  row, so no role can change every project's budget at once. Key = project, device class
  (`phone` / `tablet` / `desktop`, or `all` for shipped size), metric (`fps`, `p95`, `draws`,
  `gpuMb`, `shippedMb`), phase (`idle` / `spinning` / `round`, `''` when not per phase); columns
  `warn`, `fail` (either may be null, not both — a CHECK), `rev`, `updated_by`, `updated_at`.
  Studio defaults (owner decision 2026-11-16, warn bands inside each fail line): phone and tablet
  fps idle fail < 55 warn < 58 ("60 fps" = locked to a 60 Hz display, which reads 59.x), fps
  spinning and round fail < 50 warn < 55, p95 every phase fail > 25 ms warn > 20 ms, GPU memory
  fail > 150 MB warn > 120 MB; desktop fps every phase fail < 55 warn < 58, p95 fail > 25 warn >
  20, no GPU line; shipped size (all devices) fail > 25 MB warn > 20 MB. Draws a frame has no
  default (no owner number). Tablet gets phone's lines; the probe
  (`packages/pixi-svelte/src/lib/deviceClass.ts`) reports only phone / desktop, so no reading is
  judged as tablet yet.
- **Evaluation** (pure, `profilerBudgets.ts`; the page and the gate call the same functions):
  pass / warn / fail per metric (`judge`); "not enough data" when a phase has fewer than 120 frames
  (`MIN_PHASE_FRAMES`) in every reading — never a pass; "no budget" when unset. Device groups =
  class + GPU, each number the median over the group's readings (`deviceGroups`,
  `evaluateReadings`); test-switch readings (`flags`) and unknown classes are left out. A build
  (`evaluateBuild`): shipped size and GPU estimate from its breakdown (a figure of 0 = no data,
  never a 0 MB pass); each device class = the worst of its GPU groups among the as-shipped readings on the build.
- **Devices tab** (`DevicesTab.svelte`): one row per device group, worst first — Readings count,
  a `VerdictBadge`, per-phase fps / p95 / >33, draws, GPU MB, cells coloured by verdict with the
  lines on hover; a footnote counts the left-out readings. Clicking a device opens its readings
  build by build (`readingsByBuild`: the build record they join, else the stamped number). The
  **Builds** tab gains a **Devices** column (a badge per class) and coloured Shipped / GPU MB cells.
- **Budgets tab** (`BudgetsTab.svelte`): a `SectionCard` per scope (Phone, Tablet, Desktop, Every
  device), one row per key — warn / fail inputs pre-filled with the effective line, the studio
  default beside them with a `project` tag when overridden, a reset `IconButton` (new `reset`
  icon). Enter or blur saves; `budgetRefusal` checks range and warn-vs-fail order on both sides.
- **Budget save path.** `PUT /api/profiler/budgets` — every role with the Profiler and the project
  (`requireTool` + `requireProjectScope`). Conditional writes on `rev` (`profiler/budgets.ts`): a
  first override inserts only if absent, an edit or reset updates / deletes only where `rev`
  matches, each write takes a new random `rev` (a counter restarting after a reset could let an old
  edit land on a new override). A stale save gets 409 with the current line; the page re-reads and
  shows theirs with a note.
- **Gate.** `pnpm --filter launcher-api check:profiler` (`scripts/check-profiler.ts`): report
  summary, token, capture links, purge and Keep races, CORS paths (1–5); P2 adds a summary from the
  REAL engine analyser, the diff, the reading ↔ build join and the purge never taking the newest
  build (6–9); the follow-up adds the game claim, the game-key rule, the join by game and the
  orphan sweep; P3 adds 10–12 (studio defaults, override / reset, refusals; judge on both sides,
  not enough data, the median, device groups, `readingsByBuild`; build verdicts incl. the worst
  GPU). `check:launcher-gates` accepts `buildOrigin(` as a project check only because it
  asserts `buildOrigin` calls `canAccessProject`.

- **Lab runs (P6).** `scripts/playtest/lab-sequence.mjs` is the sequence, written against a subset
  of Playwright's `Page` (`evaluate(string)`, `keyboard.press`) so P7 can hand it a BrowserStack
  page: wait for the probe (stop on `__IE_RUNTIME_STALE__`), a warm-up round (Space until a round
  starts, wait for idle — boot compiles and uploads stay out), `__IE_PERF__('reset')`, idle 20 s,
  10 spins (Space; idle = two 1 s polls of `__IE_PERF__()` where only idle frames grew; Space again
  after 25 s of a round with no idle frame — a big-win hold or a feature intro), a forced feature,
  `__IE_PERF__('take')`. Free-play kinds (`familyOfKind` ≠ slot) idle only.
  `scripts/playtest/lab-run.mjs` drives it on the current-games harness's headless shell
  (`current-games/lib/browser.mjs` `openPage`, 1280×720, real clock — never `?ie_determinism`, whose
  virtual clock reads JS ms as 0), opens the card URL with `perf=1` and its own `sessionID=lab-…`
  (no `perfsession`: the script posts the reading itself through the probe's own wire,
  `perfSendCore.ts`, so a page hidden on close cannot send a second one). `--local <fixture>
  --runtime <build>` plays a current-games stand-in on the real test server without a launcher.
  Failure lines are scrubbed of the card's read token (`k=`) before they reach the artifact; a page
  that stops answering CDP fails its game after 30 s.
- **Lab sessions.** `POST /api/pipeline/profiler-lab { game }` (bearer `PIPELINE_CI_TOKEN`, as
  `/api/pipeline/games`): only an online runtime game with no built bundle of its own; answers a
  2-hour capture token for that game (`labSession.ts`, `uid: 'lab'`, claim `lab` = a fingerprint of
  the CI token) and the card URL. `reportOrigin` keeps its readings as `source: 'lab'`,
  `createdBy: null`, and refuses them once the launcher's CI token is unset or rotated. The token
  verifies as lab only with `uid: 'lab'`, and a person's token never does.
- **Counts.** `perf_reports.counts` (jsonb, migration `0045_perf_reports_lab.sql`, which also adds
  `lab` to the source check): per phase (idle, spinning) the per-frame means of draws, passes,
  texture uploads, GL calls and JS ms, plus texture MB (`profilerLab.ts` `perfCounts`, filled for
  every reading). The **Lab runs** card (`ProfilerLabRuns.svelte`, on the Readings tab above
  Readings) shows each game's newest lab reading beside the previous lab reading of the same game
  and switches (`previousLabReading`), with Δ, a change past `LAB_TOLERANCE` in orange, and "fps:
  not comparable". The Readings table tags it `lab`.
- **Workflow** (#1739, admin-merged on the owner's word 2026-11-18 — any `.github/workflows/`
  edit fails `current-games` by design).
  `.github/workflows/profiler-lab.yml` ("Profiler lab run"): 03:17 UTC nightly over
  every live online game (`/api/pipeline/games`: a project, no own bundle), or Run workflow with a
  `game` key; one matrix job per game (4 at a time), the headless shell installed as current-games
  does, the run's files (`<game>.json`, `<game>.report.json`) uploaded for 7 days. No new secret.
- **Run-to-run tolerance (measured 2026-11-17).** Three local runs of one build (`cg-lines`
  stand-in, unseeded mock, Windows GPU): spinning counts agreed within 2% (draws 36.3–37.0, GL calls
  191–194, passes 2, uploads 0.1 per frame), texture MB identical (119.6); idle spread wider (draws
  37–47, GL calls 197–217) because idle carries the win cycle of whatever the RNG dealt; JS ms
  1.3–1.6 idle, 2.4–3.0 spinning; fps 43→60 between runs on the same machine. Hence
  `LAB_TOLERANCE`: spinning draws and GL calls ±5%, idle draws ±35% and GL calls ±20%, passes
  ±10% spinning / ±35% idle, uploads ±50%, JS ms ±50%, texture MB ±2% (each with an absolute floor).
- **On the CI runner (2026-11-18, verified).** Two `workflow_dispatch` runs of `bookofborutremake`
  (runs 44280229817, 44281849356; SwiftShader, fps 3.2–3.6) each left a `lab` reading the page lists
  and the Lab runs card compares. Spinning per frame: draws 20.5 / 20.8, passes 4.5 / 4.6, GL calls
  150.5 / 153.5, uploads 0.1 / 0.1, JS ms 6.3 / 6.1; texture MB 484.8 / 485.4. Idle: draws 22.3 / 21,
  GL calls 171.4 / 153.2, passes 6.2 / 4.5 — the first run hit two big-win holds, whose idle
  presentation adds passes, so the idle passes band went from ±25% to ±35%. The artifact carried no
  read token. A run takes about 10 minutes per game.

## Open items / next

1. **P6 tolerance across games.** Measured on one game on CI (above); widen or narrow
   `LAB_TOLERANCE` as the first nightlies of the other games come in. The
   forced-feature step is skipped online: a published game's player mock refuses `/force` (an
   authoring tool), so it only runs where a mock accepts it; whether a feature ran is in the
   artifact, not on the reading. The lab runs nightly, not after each Publish (the design's "per
   Publish") — a Publish hook can dispatch the workflow later.
2. **Verify P1 live** (merged, #1691) — the design's done-when: a phone scanning the QR leaves a
   reading the page lists, and a player URL without `perfsession` makes no request.
3. **P2 is unverified on production.** Verified locally only (PGlite + fake R2). Live needs desktop
   launcher **v1.0.68** merged (invisible-launcher#33) and released (`build_and_publish.py`) —
   older launchers send nothing. R2 bucket CORS is irrelevant here (the PUT comes from Python).
4. **Auto-send on page hide is unverified on real phones.** iOS may suspend the page before the
   `keepalive` request (which needs a CORS preflight) leaves; check on an iPhone and an Android
   phone. P1 was verified in the desktop app's browser pane only.
5. **R2 CORS refuses a phone's large reading upload (owner, infra).** Probed 2026-11-17: the
   `invisibleassets` bucket answers a PUT preflight from `app.invisiblewall.org` but 403s
   `games.invisiblewall.org`. The probe now falls back to the trimmed reading, so nothing is lost
   but the per-texture list and spike records of a reading over 480 KB. To keep them, add
   `https://games.invisiblewall.org` (PUT, header `content-type`) to the bucket's CORS rule in the
   Cloudflare dashboard.
6. **P3 is unverified on production** (#1738). Verified locally only (PGlite + a seeded
   project: 3 builds, 10 readings): all three tabs, edit + reset in the UI, the PUT race cases.
   Left open: a duplicated project does not copy its budget overrides (`projectDuplicate.ts`); no
   reading is judged as a tablet until the probe tells one apart. The Devices headline takes the
   median over every kept reading of a device, across builds, so an old slow build can colour it
   after a fix ships (open the row for the build-by-build view).
7. **P4 — Findings:** the rules as pure functions with fixtures in `check:profiler`; Findings tab;
   Compare.
8. **P5 — File as bug:** prefilled Bug Reports from a finding, with the evidence links.
9. **P7 — Cloud phones:** the lab script on an online real-device service, calibrated first.

## Recent changes

- 2026-11-17 — **P6 "Lab runs" built**: `lab-sequence.mjs` (Playwright `Page` subset) +
  `lab-run.mjs`, `POST /api/pipeline/profiler-lab` (CI bearer → a 2-hour lab capture token),
  `source: 'lab'`, `perf_reports.counts` + migration 0045, the Lab runs card, the "Profiler lab run"
  workflow (nightly + dispatch, #1739), `check:profiler` tests 13, tolerance measured on four local runs.
  Docs: guide, INFRA (the CI token now also opens lab sessions; the workflow).

- 2026-11-17 — **P3 "Devices and budgets" built** (#1738): `perf_budgets` + migration
  0044 (per-project overrides; studio defaults `STUDIO_BUDGETS` in code), the pure evaluation in
  `profilerBudgets.ts` (pass / warn / fail, not enough data under 120 frames, median per device
  group, build verdicts), `PUT /api/profiler/budgets` with conditional writes on `rev` (409 on a
  stale save), the **Devices** and **Budgets** tabs, the Builds tab's Devices column and coloured
  Shipped / GPU MB, `VerdictBadge`, IconButton `reset` icon, `check:profiler` tests 10–12. Verified
  locally (PGlite, seeded project), not on production. Docs: guide, `ui-inventory.md` §2 / §21,
  STATUS row.

- 2026-11-17 — **P2 follow-up — the open items**: a capture token per game and `perf_reports.game_key`
  (migration 0043) so a reading joins only its game's builds, Paste's Game picker; the build's game
  key must belong to the project (a delivery may use an unheld key); readings from an online card
  stamped with the live runtime release; a daily sweep of reading / build files no row names, and
  both sweeps over every client a project's perf files lived under; P1's reading register made
  resend- and race-safe like the builds'; the probe posts the trimmed reading when a large upload
  cannot go (R2 CORS refuses the games origin — open item 4); `vite dev` no longer 500s
  (`error-tracking` in `ssr.noExternal`). Verified locally (PGlite + fake R2) end to end.

- 2026-11-17 — **P2 "Builds" built** (#1697): `perf_builds` + migration 0042, the build upload
  (Bearer, `gamePublish`) and register / Keep / JSON / sandboxed breakdown routes, R2 key
  `perf/builds/<gameKey>/v<build>-<id>.json`, the Builds tab with the previous-build diff and the
  build detail card, readings joined by the `__IE_BUILD__` stamp (`buildSha` on reading items), build
  retention (newest of each game key and kind never purged) in the daily job, `check:profiler`
  tests 6–9. Desktop launcher v1.0.68 sends the record after ☁ Publish / 📦 Deliver and reports it
  in one result line. Verified locally (PGlite + fake R2), not on production. Docs: guide, launcher
  guide, `ui-inventory.md` §2, STATUS row.

- 2026-11-16 — **P1 "Capture and keep" built**: registry entry, `/profiler` page, capture sessions
  and their token, the report / upload / session / Keep routes with CORS for the probe,
  `perf_reports` + R2 storage, the 15-day purge, the probe's Send and auto-send, `check:profiler`;
  guide `docs/tools/profiler.md`, README row, STATUS map row, INFRA env line, `owners.json` entry.
