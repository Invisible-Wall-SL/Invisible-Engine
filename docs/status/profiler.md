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
counts, never fps. Step **P4 "Findings" built 2026-11-18**: eight rules as pure functions over a
project's readings and builds give a ranked list of what to cut — severity, a measured saving (or
"unmeasured"), the owner, the evidence — on a **Findings** tab, and **Compare** puts any two
readings side by side. Step **P5 "File as bug" built 2026-11-18**: each finding opens Bug Reports'
own form filled in — a game or a pipeline bug, its area from the owner — once per finding, and the
readings and builds it cites are kept while the bug exists. **P7 parked 2026-11-25**: the owner
tests cloud phones by hand on BrowserStack Live, through an ordinary capture session. Step **P8
"Arcade phases" built 2026-11-26** (#1933): an arcade game's reading (`perf: 8`, `kind:
'arcade'`) is split into `menu` and `play` with what its sim and room did per frame, and the
launcher shows, budgets and judges it so; a slot reading is unchanged. Step **P9 "Network" built
2026-11-26** (#1939): every reading (`perf: 9`) says what its page downloaded — each file's path
and sizes, by class and by load stage, the first frame, the RGS's requests and the arcade room's
messages — and the launcher keeps its transfer MB, lists its files, compares it across builds,
budgets it per device class and ranks five network findings. Step **P10 "Probe accuracy" built
2026-11-27** (Salmons performance track T1, in review): `perf: 10` readings carry busy time per phase
against the display's frame, hidden and throttled time (such a reading is marked "not comparable"),
an arcade game's `loading` / `lobby` / `play` / `spectate` split, a p95 per work counter, a scene
sample, GPU time and the room's bytes by kind — and an arcade game is judged on busy time, not fps.

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
- **Reading a report.** `src/lib/profiler.ts` `summarizePerfReport`: reads `perf: 7`, `8` and `9`;
  refuses a non-report, another version, or one with no frames in its own phases, with a sentence.
  Summary = the game's `kind` and phase set (P8: `arcade` → menu / play, else slot), `capped30`
  (a browser cap, re-checked for v7), device class and reason, GPU, UA family (browser + OS, no
  full UA), DPR, canvas, build version / sha, test-switch flags, the set's
  fps-p50-p95-hitches-frames per phase, draws and JS ms a frame, texture MB, and (`perf: 9`) the
  network summary (`profilerNetwork.ts` `networkSummary`: transfer MB, cached MB, files, files whose
  size was hidden, first frame ms, MB before it, the largest file, RGS requests and p95, room KB/s).
- **Network (P9).** The probe's `network` block (`apps/lines/src/game/perfNetwork.ts`, observed by
  `PerfHud.svelte` with `PerformanceObserver({ type: 'resource', buffered: true })` + the navigation
  entry; the page's whole load, never cleared by Reset): per file its path (query and hash dropped,
  a token segment read `…`: by position under every token-bearing launcher route (`TOKEN_ROUTES`:
  `/api/deploy/f/<token>`, `/api/published/f/<token>`, `/play/<token>`, `/profiler/go/<link>/<token>`),
  whatever the token's format, else by shape (a JWT-like or long hex/base64url segment);
  the host only when not the page's), class (`document js css image ktx2 json rig audio font api
other`), initiator, transfer / encoded / decoded bytes (`null` = a cross-origin answer without
  `Timing-Allow-Origin`, counted as `unknown`, never 0), start, ms, stage (`beforeFirstFrame` until
  the first Pixi tick the probe sees, else First Contentful Paint; `boot` until `stateApp.loaded`;
  `play`), cache (`hit`, `revalidated`, `network`, `unknown`); totals by class and stage, the
  heaviest 20, paths downloaded twice in one load, RGS requests (Play4Fun `/rgs/engine` or a
  `sid`+`seq` query, Stake `/wallet/…`, `/bet/event`: count, bytes, p50 / p95 / max, the 3 slowest;
  summed, not listed), `loadId` (`performance.timeOrigin`) and the navigation type. Online arcade:
  `socket` (messages in / out, bytes, largest, a second, the states among them) from
  `arcadePerf.message`, called by `online.ts` `meterMessages` beside the per-frame `patches` count
  (one meter), which now also wraps the connection's `send` / `sendUnreliable`. The file list keeps
  the heaviest 150 (`FILES_KEPT`); the short form sent on hide keeps the heaviest 20 only. Bounded
  over a soak: a file is folded into running totals once the first frame and the boot are both known
  (up to 2000 held before that), and an RGS request is summed as it arrives — `rgs.requests` counts
  every one, `rgs.ms` the first 4000 (`ms.count`). The launcher redacts the same routes again on
  receipt (`profilerNetwork.ts` `redactReportText`, every string of the report, before the R2 write
  in `store.ts`; `pathOnly` in the facts), so no route token is stored even from an old probe. The HUD
  body shows a `net` line (MB, files, sizes hidden, first frame, largest) and an RGS / room line.
  The launcher sends `Timing-Allow-Origin: *` with `DEPLOY_CORS_HEADERS` (`/api/deploy*`,
  `/api/published/*`, `/api/editor/runtime`, `/api/editor/doc`), so an online game's art and runtime
  bundle are sized. Reading: `profilerNetwork.ts` `readNetwork` (bounded, strips a query again,
  derives `uncompressed` — text ≥ 8 KB served at ≥ 90% of decoded — and `crossed` — ≥ 50 KB that
  crossed the network) into `facts.network`; columns `transfer_mb`, `first_frame_ms`, `network`
  (migration `drizzle/0051_perf_reports_network.sql`). **Readings** gains **Transfer MB** (with the
  first frame under it; click → a **Files** card that reads the reading's JSON: totals, stages,
  classes, RGS / room, the file table); **Builds** a **Transfer MB** column and "Downloaded
  (readings)" in the detail (`profilerBuilds.ts` `buildTransferMb`: median of the as-shipped readings
  on the build, the build before on hover); **Compare** a `network` group; **Devices** Transfer MB
  and Largest file. Budgets `transferMb` (every class: warn 20 / fail 25 MB, the shipped-size line)
  and `fileMb` (warn 3 / fail 6 MB, studio default), judged only for groups with a `perf: 9` reading
  (`knownTransferMb`: every size hidden = no data).
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
  GPU). P4 adds 14–16 in `scripts/check-profiler-findings.ts`: the facts (a report, and a breakdown
  from the real analyser), each rule against its fixture AND a planted mutant of it (a lab reading's
  fps read, `renderMs` read as the JS, the switch paired across GPUs, idle spikes counted, the
  whole texture MB as the estimate, every build judged, a guessed Optimize saving) that the fixture
  must fail with an assertion, the ranking, owners against the real `owners.json`, Compare. P5
  adds 17–18 in `scripts/check-profiler-bugs.ts`: every rule and variant's list and area (with
  mutants), the text and the form's prefill; once per finding over an in-memory store with the
  table's key (two at once, after a delete, a purged citation), the schema's key and cascade, and
  the purge claim's rendered SQL skipping cited rows (with a mutant).
  `check:launcher-gates` accepts `buildOrigin(` as a project check only because it
  asserts `buildOrigin` calls `canAccessProject`.

- **Findings (P4).** `src/lib/profilerFindings/`: `finding.ts` (the shape `{ id, rule, severity,
title, detail, evidence, estimate, owner, deviceClass, gameKey }`, owners, ranking), one file per
  rule in `rules/`, `index.ts` (`findings(ctx)` runs them all and ranks), `compare.ts`. Every
  estimate is a measurement — a switch's delta, a file's bytes, a breakdown figure — or null
  ("unmeasured"). Ranked by severity (`high` = a budget fails, `medium` = a warn or a cost worth
  cutting, `low`), then the saving as a share of a typical budget (fps / 60, MB / 25, GPU MB / 150,
  draws / 100, spikes / 10), unmeasured last. Rules that judge "the build players have" read each
  game's newest build (`currentReadings` / `stampsNewestFirst`: by the build record a stamp joins,
  else the build number, else the newest capture — so re-measuring an old build never makes it
  current) or newest build record (`newestBuilds`). Ids carry the build, so P5 can tell a filed one.
  - **Fps below budget** — P3's `deviceGroups` per game (median, ≥ 120 frames, as shipped); fps
    and p95 past warn/fail; estimate = fps short of the warn line; owner = the project's game kind's
    agent (`owners.json` `kinds`, else `engine-pixi-svelte`).
  - **GPU- or CPU-bound** — for a phase that misses its fps line: our JS (`jsMs`) against the
    interval (≥ 60% CPU-bound, naming the largest of render submit / game code `tickMs − renderMs` /
    JS outside the tick; < 40% outside our JS), a `?perfgpu=1` reading's GPU wait against the
    display frame (≥ 60% GPU-bound); its own fps never read. No estimate. `engine-pixi-svelte`.
  - **Feature cost** — a reading with exactly one switch (`particles=off` → `invisible-fx`, `fx=0`
    → `invisible-shader-graph`, `aa=0` → `engine-pixi-svelte`) beside the nearest as-shipped
    reading on the same game, stamp, class, GPU and browser; fps and draws per phase; shown at
    ≥ 2 fps or ≥ 10% (and ≥ 5) draws; a lab pair gives draws only.
  - **Spikes by cause** — `spikeCauses` in spinning + round (idle left out), per device, ≥ 2;
    owner by cause (particles → `invisible-fx`, rigs → `invisible-rigger`, game code → the kind's
    agent, else `engine-pixi-svelte`). Never lab.
  - **Textures** (`atlas-python-tools`) — texture MB past the `gpuMb` line (estimate: MB of the five
    largest in `textureList`), KTX2 assets that fell back (unmeasured: a fallback names the loader's
    asset key, not a page `textureList` lists), oversize pages in the newest build (unmeasured:
    splitting a page ships about the same bytes). Lab counts here.
  - **Unused bytes** — the newest build's never-loaded and duplicate bytes; owner = the project's
    author (Invisible FTP Browser).
  - **Optimize off** — newest build without 🗜 Optimize; estimate = the PNG twins and extra audio
    formats Optimize drops that the game loads (a twin nothing loads is already Unused bytes),
    never the re-encode; owner = the publisher.
  - **Regression** — size vs `previousBuild` (shipped ≥ max(1 MB, 5%), GPU ≥ max(10 MB, 5%)), a 0 on
    either side is no data; fps per device vs the build before (≥ max(3 fps, 5%)), between the two
    newest builds a device measured, lab counts past `LAB_TOLERANCE` between the two newest builds the lab measured;
    with the categories the joined build records grew.
  - **P9 network rules** (`perf: 9` readings of the current build, `networkReadings`): **Heavy
    downloads** (`heavyTransfer`: a device class's median transfer past `transferMb`, and each of the
    newest reading's heaviest files past `fileMb`, with a hint by class and the GPU MB it holds when
    Textures lists it; owner `areas.assets` for art, the engine for code; lab counts),
    **Uncompressed text** (`uncompressedText`: the servers named; `areas.delivery`; unmeasured),
    **Downloaded again** (`notCached`: the newest page load against the one before on one device —
    class, GPU, browser, label — by `loadId`, a reload that still downloads, or a path twice in one
    load; never lab; the MB again), **Before the first frame** (`firstFrame`: ≥ 1.5 MB, medium from
    3 MB; engine), **Slow or heavy messages** (`netTraffic`: RGS p95 ≥ 500 ms / 1 s over ≥ 5 requests,
    never lab, or an answer ≥ 100 KB, `areas.rgs`; the room ≥ 30 / 100 KB a second in or a message
    ≥ 32 KB, `areas.gameServer`). Bug targets: a heavy art file is the game's `loading`, the rest
    pipeline (`engine`).
- **Facts.** `perf_reports.facts` / `perf_builds.facts` (jsonb, migration `0046_perf_facts.sql`):
  what the rules read beyond the summary, reduced from the full JSON at receipt
  (`profilerFindings/facts.ts` `reportFacts` — per-phase render / tick / JS / GPU-wait ms, spike
  causes and the 8 longest spikes, the 12 largest textures plus every oversize one, KTX2 fallbacks;
  `buildFacts` — oversize pages, never-loaded files and duplicates from the
  breakdown's own issues, Optimize twins). Rows kept before P4, or filled by an older `FACTS_VERSION`, are filled
  from R2 by the page load, 12 a load, 4 at a time (`server/profiler/findings.ts`); a file that is
  gone, too large or not JSON is marked `missing` and not retried, while an R2 error leaves the row
  for a later load. A failure there never fails the page: the Findings tab says it could not be
  worked out. The page computes the findings server-side; only the list reaches the browser.
- **Findings tab** (`FindingsTab.svelte`): one `SectionCard`, Owner and Device filters in its header;
  columns Severity (`VerdictBadge`), Finding (rule, game, detail lines), Saving (value, unit, basis —
  or "unmeasured"), Owner, Evidence (a reading opens Compare with the finding's pair, a build its
  detail card on Builds). **Compare tab** (`CompareTab.svelte`, `?tab=compare&a=&b=`): two reading
  pickers; per phase fps / p95 / > 33 ms / frames, the idle and spinning per-frame counts, texture
  MB, B − A coloured better / worse; a note when a lab run is beside a device.
- **File as bug (P5).** The Findings tab's **Bug** column: **File as bug** links to the existing
  report form — `/game-bugs` or `/bugs` with `?new=1&project=&finding=<id>` (`fileFindingHref`).
  The page load re-reads the finding server-side (`profiler/findingBugs.ts` `findingDraft`) and fills
  in kind, area, title and text (`profilerFindings/bug.ts`): a **game** bug for the game's content
  (texture MB and oversize pages → art; unused bytes, Optimize off, a build that grew → loading;
  particles / Element FX cost → art), a **pipeline** bug for the engine or a tool (fps, GPU/CPU-bound,
  spikes, KTX2 fallback, antialiasing cost, fps or lab-count regressions), its area the tool the
  owning agent owns first in `owners.json`, else `engine`. The text: rule, measurement, saving,
  owner, a Compare link per reading and a `?tab=builds&build=` link per build (with their JSON),
  the finding id. The form posts `/api/bugs` with `finding: { project, id }`; `createBug` →
  `prepareFindingBug` (Profiler tool + project + the finding still found + its own list) files the
  bug, a `perf_finding_bugs` row (migration `0047_perf_finding_bugs.sql`, primary key project +
  finding id, FK to `bug_reports` on delete cascade, the cited reading / build ids) and Keep on the
  evidence in `insertBug`'s transaction (`within`, `findingBugLink.ts`). A second filing — two at
  once included — loses on the key, rolls back its bug and gets 409 naming the first; a cited row
  the purge claimed meanwhile files nothing (409). Once filed the column shows **Filed as BUG-n**
  and its status. Un-Keep of a cited row is 409 (`citingBug`), and the purge's claim skips any
  cited row whatever its Keep (`purgeJob.ts` `uncited`) — the guarantee. Who files: whoever has the
  Profiler and the list's own tool (`requireBugAccess` / `requireKind`).
- **Owners** come from `docs/knowledge/owners.json`, mirrored into `src/lib/tool-docs/owners.json`
  by `scripts/copy-tool-docs.mjs` (as `agents.json` is). P9 adds its `areas` map (what no tool or
  kind owns): `assets` → `atlas-python-tools`, `delivery` (caching, compression) → `infra-railway`,
  `rgs` → `engine-pixi-svelte`, `gameServer` → `arcade-games`; `check:agents-knowledge` checks each
  names a real agent.
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

0. **P8 / P9 on a real phone.** P9 was verified live on desktop Chrome (below); the first real-phone
   `perf: 9` reading arrived the same evening (BS Live · Galaxy S24 · Android 16, Salmons: 4.9 MB,
   first frame 4.2 s). A slot on a real phone is still owed. A 3D arcade game's reading
   (`arcade3d` runtime) counts its play frames only: no sim or room counts, and no room traffic in
   its network block (`online3d.ts` has no meter). Known blind spots of the network block: the
   partner's RGS host and the game server's matchmaking HTTP send no `Timing-Allow-Origin` (their
   time is known, their size is not); a page that fetched over 250 files before the probe mounted
   loses the earliest (`bufferFull`); the games host's `assets/` are `no-store`
   (`docs/INFRA.md`), so **Downloaded again** will name them on any device that loads a game twice —
   that is the finding, not a bug in it.
   - **An arcade game's "first frame" is its first FIELD frame.** Salmons' title and join dialog are
     HTML; the Pixi app draws only after Join, so the first frame (and "before the first frame") counts
     the time a player spends on the title: 45.2 s on the live check. Read Salmons' first frame as
     "join to field", or move the mark to the first paint of the HTML title for such games.
   - **A partner-session capture link loses the probe.** BookOfBorutRemake's "Book of Borut —
     Emanuele's RGS" card opens through `/api/partner-session?…&perf=1&perfsession=…`, and its
     redirect lands on the game without `perf` or `perfsession` (checked 2026-11-26): that card can
     never be profiled. Pre-existing (P1's capture links), not P9's.
   - **Salmons downloads the slot's stock audio.** The live reading's heaviest files are
     `assets/audio/stock/bgm_main.ogg` (1.4 MB), `bgm_freespin.ogg`, `winlevel_beds.ogg`,
     `anticipation_coinloop.ogg` and `spines/bigwin/mm_bigwin.json`: 3.2 MB of slot audio and a
     big-win rig an arcade game may never play (the stock asset table, `stateApp.ts`). For
     `arcade-games` / `engine-pixi-svelte` to confirm and cut.
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
7. **P4 is unverified on production.** Verified locally (PGlite + fake R2, a seeded project: 2
   builds, 9 readings incl. lab, every row's facts filled from R2 by the page load): 17 findings, the
   filters, Compare from a finding, a build link to its detail. Left open: P3's Devices tab now leaves
   lab readings out (it counted their fps before); a finding has no "dismissed" state yet (P5 files
   it as a bug); `textureList` is missing from a trimmed reading (open item 5), so its texture
   estimates say "unmeasured".
8. **P5 is unverified on production.** Verified locally (PGlite + fake R2, the P4 seed): a game
   bug and a pipeline bug filed from the Findings tab, their rows, links and Keep; a second filing,
   two at once, a stale finding id and un-Keep of a cited reading / build all 409; a deleted bug frees
   its finding. Left open: a filed bug is a snapshot (its text is not updated, and it is not resolved
   when the finding drops out); a deleted bug leaves its evidence kept; there is still no "dismissed"
   state for a finding nobody will fix.
9. **P7 — Cloud phones (parked 2026-11-25).** The owner chose BrowserStack **Live** (manual, one
   user) over Automate: phones are tested by hand through a capture session's **Copy link** (see
   the guide, "Capture on a cloud phone"). The scripted run needs an Automate plan with mobile
   devices and the `BROWSERSTACK_USERNAME` / `BROWSERSTACK_ACCESS_KEY` Actions secrets; the lab
   script already takes a Playwright-shaped page, so the adapter is the only missing piece.

## Recent changes

- 2026-11-27 — **P10 "Probe accuracy"** (`claude/salmons-perf-t1-probe`; plan:
  `docs/design/salmons-performance.md` §2, track T1; `perf: 10`, perf 7 / 8 / 9 stay readable and a
  slot reading's summary is unchanged — a `perf: 10` slot twin of a `perf: 9` one reads the same but
  for its version and `counts.timing`, held by `check:profiler` 14). Why: the Salmons readings
  could not say why the game is slow — fps hid headroom (a flagship that misses 60 Hz by 1.4 ms reads
  30.0), two readings were throttled background tabs and nothing marked them, `menu` mixed the lobby,
  the countdown, spectating and the level mount, and nothing named what costs.
  - **Busy time.** `perfStats.ts` reports, per phase over the WHOLE reading (a log histogram, within
    ~2%; the old frame-time percentiles are the last 600 frames), the p50 / p95 / max of `lateMs +
    tickMs + afterMs`, and `budgetMs`, the display's frame period (60 Hz at least; 30 Hz's when the
    browser caps). The HUD header reads "spin busy p95 11 / 16.7 ms · 60 fps". The launcher keeps it
    in `counts.timing` (no migration: `counts` is jsonb), judges it with a new **p95 busy time**
    budget (warn 14, fail 16.7 ms; lobby, play, spectate; every class) and a `fpsBelowBudget`
    finding, and an arcade reading that has it is NOT judged on fps / p95 (an older one still is).
    Compare gets "busy p50 / p95" rows, Devices and Readings a **busy** column.
  - **Hidden and throttled.** The probe counts no frame while `document.hidden` (`pause()` /
    `resume()` on `visibilitychange`): `hiddenMs` (wall time), `hiddenFrames`, `throttledFrames`
    (visible intervals over 250 ms) and `visibilityState` at send. The launcher marks a reading
    **throttled — not comparable** (`profilerTiming.ts`; `counts.throttled` holds why) when its
    busiest phase's median frame is over 250 ms (any version: this catches 10308430 and 49aadb1f)
    or it was hidden for over 5% of it (`perf: 10`). Such a reading is kept and listed with a tag,
    and left out of budgets, findings (`fpsReadings`) and Devices timing; its draws and MB still count.
  - **Rates.** `refreshHz` was the achieved rate: now `achievedHz`, beside `displayHz`, the fastest
    rate a side rAF loop ever saw (the display's when the page ever idled; not cleared by Reset).
    Facts keep reading `refreshHz` for `perf: 7`–`9`.
  - **p95 per work counter** (`work.<phase>.perFrame.<key>.p95`, over the whole reading).
  - **Arcade phases.** `loading` (a level's mount — the room joined, its art landed, the local loop
    started: `arcadePerf.mount()` — until its first ticked frame and 1 s after), `lobby` (the old
    `menu`: no tick, a countdown, a win screen), `play`, `spectate` (online: the room running and the
    player out of it). A spike's `state` is the room's phase (`lobby` / `countdown` / `running` /
    `over`) for an arcade game, not the slot machine's; a record carries `loading` / `spectate`
    flags beside `play`. The launcher's arcade phase set is those four, plus `menu` for `perf: 8` /
    `9` (`phasesFor`; `phasesOf` lists an arcade phase only where a reading has frames in it).
  - **Scene sample** (`pixi-svelte` `sceneProbe.ts`, `glCounters.ts`): every 30 frames, outside the
    frame's busy time, a walk of the display tree under the stage: nodes, renderables, drawn and
    culled (a node or ancestor with `visible` / `renderable` false), filtered nodes, render groups,
    and per top-level layer; a layer that is its own render group also carries its draws, passes,
    filter passes and target switches (a wrap of Pixi's render-group pipe, nested groups included),
    and the stage's own share is the frame's less theirs. A layer that is not a render group draws
    inside the stage's own instructions, so its draws are not told apart: **make a layer a render
    group to see it** (T4 does this for the river). Reported as `scene` (means by layer, the latest
    sample) in an arcade reading; in the facts for a rule to use.
  - **GPU time**: `EXT_disjoint_timer_query_webgl2` where offered (a query round per tick, read
    back when ready: never waited for, results arrive a few frames late), reported per phase as
    `gpuMs`; else `gpuTimer: "n/a"`. Off under `?perfgpu=1`. Not verified on a phone yet (below).
  - **Socket by kind**: in and out room messages tallied by kind (`patch`, `state`, the message's
    type name, `code <n>`; 12 kept, the rest `other`), the state bytes against the rest, and the
    fixed steps run, so "sends per step" reads off `network.socket.perStep` (`online.ts`
    `meterMessages`, `perfNetwork.ts` `messageLabel`). The 3D room does not meter yet.
  - **Gates.** `check:profiler` 101 (five new: the perf 10 summary, its slot twin, throttled, busy budgets, throttled in budgets),
    findings 24 (was 22), network 17 (was 16), the probe fixtures (`perfStats` now pins busy,
    display rate, hidden, throttled, p95, scene and GPU; its slot snapshot hash holds with the new
    keys stripped, so the old recording still stands), the new `arcadePerf.fixture.ts` (loading
    window, room state, socket tally) and `sceneProbe.fixture.ts`. svelte-check at baseline
    (`apps/lines` 145, `pixi-svelte` 14).
  - **Not verified:** the HUD on a real phone and the timer query on Mali / Adreno / Apple (the
    extension is often absent; the probe says `n/a`); the render-group wrap against a real Salmons
    frame (the fixture drives stand-in nodes — a live `?perf=1` read of Salmons is the check).

- 2026-11-26 — **P9 review fixes** (the #1939 merge-sweep review, which held the merge on a token
  leak; #1939 merged before the fix, so it ships as #1949 — a runtime release):
  - **Token leak.** The probe redacted only `/api/deploy/f/<token>` by position; a published boot's
    `/api/published/f/<token>/…` relied on the shape guess, which misses a digit-less read token
    (~0.8% of `mintReadToken`'s) and any `EDITOR_DOC_SECRET`. Now `TOKEN_ROUTES` (the deploy and
    published trees, `/play/<token>`, `/profiler/go/<link>/<token>`) redacts by position in the probe
    (doubled slashes collapsed first), and the launcher scrubs every string and key of a report
    before it writes R2 and in the facts' paths — a route after any non-path character, with `%2F` /
    `\/` slashes decoded and doubled ones collapsed (linear: ~0.2 s on an 8 MB worst case).
    Gate 19 holds the two lists equal and equal to every `[token]` folder under `src/routes`, with a
    digit-less token and a free-form secret; gate 20 sends a leaky report from an "old probe" and
    finds no token in R2's text or the facts; a mutant dropping `/api/published/f` fails both.
  - **Missing global.** `PerfHud.svelte` `watchNetwork` guards `typeof PerformanceObserver`, so a
    browser without it loses the network block only, not the whole probe.
  - **Bounded monitor.** `createNetworkMonitor` folds files into running totals (above) instead of
    keeping and re-sorting every entry each 500 ms; the probe fixture (now run inside
    `check:profiler`) proves a 21,800-entry soak gives the same block whether the stages settled
    before the files or after.
  - Nits: `socket()` clamps negative seconds and rates; `profiler.ts`'s long comment line wrapped.
  - Known limit: `repeats` watches the first 2000 distinct paths (`CROSSED_KEPT`), so a later
    path's second download is not seen; above 2000 files held before the first frame and boot, a
    file is folded at the stage it reads then.
  - Reviewed by `code-reviewer` (nothing blocking); its gaps in the launcher's scrub (keys, other
    separators, encoded or doubled slashes) and the probe's doubled-slash miss were fixed, each with a
    gate case.

- 2026-11-26 — **P9 "Network" (#1939, merged as c6945262d; a runtime release)**: the owner asked, after
  profiling Salmons, to see whether anything is too heavy to transfer. Design:
  [invisible-profiler §8](../design/invisible-profiler.md).
  - **Probe (`perf: 9`).** `apps/lines/src/game/perfNetwork.ts` (no game import) + `PerfHud.svelte`:
    the report's `network` block (above, "Network (P9)"). Paths only, by construction: the query and
    hash never reach it, token segments read `…`. A slot reading's other fields are what `perf: 8`
    sent. Online arcade room traffic is tallied by `arcadePerf.message` from the meter that already
    counted the state patches (`online.ts` `meterMessages`, which now also wraps the connection's
    `send` / `sendUnreliable`, one boolean test a message for a player without `?perf=1`).
  - **Found by booting it** (each fixed, with a fixture case in the probe and in the gate): the
    navigation entry spread into an object kept no field (a browser's timing entry keeps them on its
    prototype) and read `/undefined`; a 24-letter folder name (`foregroundFeatureAnimation`) read as
    a token; a font service's file asked by a stylesheet (`use.typekit.net/af/…/l`) read as CSS text
    and was called uncompressed.
  - **Launcher.** `PERF_REPORT_VERSIONS = [7, 8, 9]`; `profilerNetwork.ts` (`readNetwork`,
    `networkSummary`, `knownTransferMb`); migration `0051_perf_reports_network.sql` (`transfer_mb`,
    `first_frame_ms`, `network`); `facts.network` (`FACTS_VERSION` stays 1: no older reading has
    one); the Readings column and Files card, the Builds column and detail line, Compare's `network`
    group, Devices' two columns, the `transferMb` / `fileMb` budgets; five rules (`heavyTransfer`,
    `uncompressedText`, `notCached`, `firstFrame`, `netTraffic`) and their bug targets;
    `owners.json` `areas` (+ `check:agents-knowledge`); `Timing-Allow-Origin: *` on the deploy /
    runtime / doc responses.
  - **Gates.** `perfNetwork.fixture.ts` (probe, by hand: paths, classes, cache, unknown sizes,
    stages, RGS, repeats, the room, the caps, the getter entry); `check:profiler` 94/94 (80 before:
    `check-profiler-network.ts` 19–21 over the REAL probe core — no token, `sid` or query in a whole
    block; sizes unknown never 0; caps; the summary and older versions; budgets; per-build transfer;
    Compare; each of the five rules against a fixture and a planted mutant — this load's transfer read
    as the weight, every text file called uncompressed, lab readings counted as a device's cache, the
    whole load called "before the first frame", a lab run's latency counted). `check-profiler-bugs`
    gains the new rules' targets and a "delivery filed as the game's" mutant.
    `check:svelte` at baseline for `apps/launcher-api` (44) and `apps/lines` (145); `pnpm lint` clean;
    `check:undefined-names` clean.
  - **Bundles** (`check:runtime-bytes`, Linux manifests from CI's artifact): every runtime's lazy
    `?perf=1` chunk +2.7 KB gzip; main bundles lines / match-3 / card +6 B, arcade and arcade3d
    +220 B (the room tally and the metered `send`).
  - **Verified live** (2026-11-26, after the merge, c6945262d): the launcher's `/api/health` names
    `c6945262dc2f` with `schema: current` (migration 0051 applied); the Runtime release moved
    `lines`, `card` and `arcade` to `@c6945262dc2f` (`X-Runtime-Release`). A capture on desktop
    Chrome: **Salmons** sent `perf: 9` — 85 files, 4.58 MB (0.19 MB from the cache), 17 sizes hidden
    (all `rooms.invisiblewall.org`: the lobby's `/rooms` poll and matchmaking, plus Typekit), the
    bundle served gzip (0.77 MB as served, 2.54 MB decoded), the room 20 messages / 4.7 KB a second;
    the readout's `net` and room lines showed, Send answered "sent", and the page hidden sent the
    trimmed form too. The Readings list shows **4.6+** Transfer MB with "1st frame 45.2 s" (see the
    open item on arcade first frames); clicking it opened the **Files** card with all 85 files, the
    stages and classes, the `/api/published/f/<token>/` segment read `…`. **BookOfBorutRemake**
    (mock RGS): 118 files, 8.0 MB (4.6 MB from the cache), 3 sizes hidden (Typekit only — every
    `app.invisiblewall.org` file sized, so `Timing-Allow-Origin` works), RGS 2 requests p95 185 ms;
    its Findings list **Heavy downloads** "1 file over 3 MB on desktop" — a 3.42 MB published
    `sounds/snd_….mp3`, owner the project author. Salmons raised no network finding (4.6 MB, largest
    1.4 MB, 1.1 MB before the first frame, text gzipped). A BS Live Galaxy S24 (Android 16) reading of
    Salmons arrived as `perf: 9` too (4.9+ MB, first frame 4.2 s).
  - **Played locally** (a release-env `apps/lines` build, headless shell). `cg-lines` stand-in on the
    real test server: `perf: 9`, 91 files, 9.0 MB (2 sizes hidden: Typekit's pixel and the local
    snapshot server's runtime bundle, which sends no `Timing-Allow-Origin`), first frame 0.9 s
    (`tick`) after 3.0 MB in 21 files, boot done 2.1 s, RGS 4 requests p95 12 ms, a 35 KB report, no
    token / `sid` / query anywhere; HUD `net 9.0 MB in 91 files · 2 size unknown · first frame 0.9 s
after 3.0 MB · largest bundle….js 2.6 MB` and `RGS 4 req · p50 4 · p95 12 ms`. Salmons against a
    real game server: 74 files, 8.7 MB, first frame 0.7 s after 3.2 MB, the room 19.9 messages /
    16 KB a second in (largest 1.2 KB, 554 of 612 messages room states), 23 / 254 B a second out,
    matchmaking HTTP size hidden; HUD `room in 16 KB/s (19.8/s, max 1 KB) · out 254 B/s`. Through the
    launcher's own functions both readings give **Uncompressed text** (the local test server sends the
    2.6 MB bundle without gzip) and **Before the first frame** (2.95 / 3.2 MB, the bundle the largest).

- 2026-11-26 — **The readout stays on screen on an iPhone (BrowserStack Live, iPhone 16 Pro Max /
  iOS 27, Salmons)**: the owner could not find Send. The game page had slid about 60 px up (title
  cut, a black strip over Safari's toolbar), taking the top-left readout off the screen. The page
  shell is pinned now (`apps/lines/src/app.html`), and the readout follows the visual viewport
  (`PerfHud.svelte`), so a page iOS pans or zooms cannot hide Send. Checked in Chromium at
  430 × 739 (page cannot scroll, canvas fills, readout shown); **not yet checked on the real
  iPhone**.

- 2026-11-26 — **P8 "Arcade phases" (#1933; a runtime release)**: the owner's first
  Salmons reading (26 Nov 09:48, BS Live · Galaxy S24 Ultra, Adreno 750) put all 5,153 frames in
  `idle` and its findings named no arcade cause. Design: [invisible-profiler §7](../design/invisible-profiler.md).
  - **Probe (`perf: 8`).** Every report says `kind` (the config's family). An arcade game's frames
    go to `menu` / `play` (`perfStats.ts` `createPerfStats(now, 'arcade')`), decided by the
    runtime's own tick through `apps/lines/src/game/arcadePerf.ts` (written only while the probe
    sets `on`): `play` while the local loop moved a body (`arcade.ts`) or the online room's
    `state.phase` is `running` (`online.ts` `tickOnline`), else `menu`; a 3D arcade game marks
    `play` on a tick that advanced its field (`ArcadeStage3D.svelte`), with no counts. No `busy`
    phase: the only clean split was a body count, which means different things offline and
    online. Per frame, in `work` beside the renderer's keys: `simSteps`, `simCatchUp`,
    `simDroppedMs` (past the loop's 5-step cap, or cut by Pixi's 100 ms ticker clamp), `simMs`,
    `netMs` (the room's messages, a WebSocket task between frames: `online.ts` `meterMessages`
    wraps the SDK's `connection.events.onmessage`), `bodies`, `pairs` (`motion.js` `overlaps`
    gains an optional counts sink), `spawns`, `despawns`, `looks`, `patches`, `patchBytes`,
    `cameraPx`; `engine-game` `createArcadeLoop` gains an optional `perf` sink. Online,
    `arcade.lateMs.<phase>` = how late each room state came against the patch periods its steps
    span (`noteLate`; the first version read ±17 ms on a perfect network, as Salmons patches at
    20 Hz between 30 Hz steps). New spike causes (`perfSpikes.ts`): `sim catch-up`, `sim`,
    `spawn burst`, `tilemap/upload`, `state patch`. A slot reading is byte-for-byte what it was:
    `perfStats.fixture.ts` hashes a slot feed's snapshot against its pre-P8 recording; only `perf`
    and `kind` are new on its report (a booted `cg-lines` report's keys are v7's plus `kind`).
  - **capped30 fixed (both kinds).** The owner's reading was flagged `capped30`, but it was not a
    cap: BS Live Android phones read their real 60 / 90 Hz the same day (Galaxy M32, A16 on
    Buffalo Duel), and its ~25 ms of main thread a frame (JS 19.4, late 3.8, after 3.1) cannot fit
    a 16.7 ms frame, so vsync halved it to exactly 30. A cap now also needs the median
    `lateMs + tickMs + afterMs` under 0.75 of a 60 Hz frame (12.5 ms); the launcher re-checks a
    `perf: 7` flag against the work means (`profiler.ts` `cappedBrowser`). A capped reading is
    tagged **30 cap**, left out of fps / p95 budgets and the fps rules, and counted under Devices.
    `gpuCpuBound` now weighs our JS against `1000 / max(60, refreshHz)`, not the achieved
    interval: the owner's reading reads CPU-bound, render submit the largest part (14.9 ms), not
    "between CPU and GPU".
  - **Launcher.** `PERF_REPORT_VERSIONS = [7, 8]`; `PHASE_SETS`, `phaseSetOf(kind)` (arcade →
    `menu`/`play`, anything else or v7 → slot); migration `drizzle/0050_perf_reports_arcade.sql`
    (`game_kind`, `arcade_phases` jsonb, `capped30`). Readings, Devices, Compare and the Builds
    detail show the phases of the listed readings' sets; Budgets lists the project's game kind's
    set (studio lines: `menu` = idle's, `play` = spinning's, by analogy); `evaluateReadings` judges
    a device only on its readings' own phases. Facts gain an optional `arcade` block
    (`FACTS_VERSION` stays 1: no stored row was a v8 reading). Lab counts gain `menu` / `play`
    (idle's tolerance band, not measured yet) and six arcade counts for Compare. Rules: `spikes`
    counts `play` (not `menu`) and owns the arcade causes to `arcade-games`; new **Sim catch-up**,
    **Spawn churn**, **Cost per body**, **Patch / jitter stutter** (`rules/*.ts`, owner
    `kindOwner(arcade)` = `arcade-games`, pipeline bugs, no estimate). `lab-sequence.mjs` counts an
    arcade report's frames at boot (it waited for idle frames that a v8 arcade report no longer
    has).
  - **Gates.** `perfStats.fixture` (+ the slot hash, arcade phases, the cap with busy frames),
    `perfSpikes.fixture` (+ each arcade cause and its near miss, a slot frame unchanged),
    `check:profiler` 80/80 (61 before; the three profiler files, each new rule with a planted
    mutant), `check:arcade-motion` 19, `check:arcade-camera` 90 (the sinks change no body, camera,
    signal or step). svelte-check at baseline for `apps/lines` (145) and `apps/launcher-api` (44).
  - **Bundles** (`check:runtime-bytes`, Linux manifests from CI's artifact): lines / match-3 / card
    main bundle +16 / +13 / +18 B gzip, the lazy `?perf=1` chunk +1.25 KB (loaded only with the
    flag); arcade main bundle +1.1 KB and arcade3d +1.2 KB (the counters in the arcade runtime),
    each runtime +1.3–2.4 KB in all.
  - **Played locally** (a release-env `apps/lines` build, headless shell): Salmons against a real
    game server with `?perf=1` read `kind: arcade`, menu 850 frames then play 1,527 (the lobby,
    then the river running), 73 bodies, 0.5 steps a frame at 30 Hz, room states late p50 1.3 /
    p95 22.7 ms, `capped30: false`; the HUD shows the menu / play lines, the arcade line and both
    columns. `cg-lines` through `lab-run.mjs --local` passed (warm-up, idle, 3 spins) with a slot
    report. Both reports read correctly through `summarizePerfReport` and `reportFacts`.

- 2026-11-26 — **Cloud phones: Live starts the phone; capture links name no device**: the owner
  picked iPhone Duo / iOS 27.1 and Live dropped `device` and `start` and started nothing. The
  builder sent `os=ios`, but BrowserStack's integration-URL page
  (https://www.browserstack.com/docs/live/integration-url-params, read 2026-11-26) spells it `iOS` /
  `Android`. `browserStackLiveUrl` now sends `osName(os)` and writes a space as `+`, as in the
  page's `os=OS+X` example. It sends only the documented keys `os os_version device
device_browser scale_to_fit speed url start`. iPhone Duo / 27.1 IS on Live's device list. The
  iPhone, iPad, Samsung, Pixel and other mobile entries of `LIVE_DEVICES` were re-checked against
  that list (2026-11-26) and match. The page documents no mobile `device` naming or `os_version`
  format; we keep brand + model for Android ("Samsung Galaxy S25"). Capture links (QR, GO, Copy,
  Live) now drop the launch URL's `device=desktop` (`captureLinks`). It was inert: nothing in
  `apps/lines` or `packages/*` reads `?device=` (`stateUrl` only types the key). The layout
  follows the viewport bucket, and `deviceClass` follows the UA and touch signals. A muted
  Playwright iPhone boot (390×844, touch, iOS UA) of `overlay-buffaloduel` with and without
  `device=desktop` gave the same result: portrait layout, readout `device.class: phone`
  (`phone-ua`). Players' launch URLs (`publishGame.ts`) keep the inert `device=desktop`.
  `check:profiler` gate 3 adds: the exact Live URL for iPhone Duo, documented keys only, and
  `os` casing on every listed phone. It also checks that no capture link carries `device`.
  Not yet clicked through on the real dashboard.
- 2026-11-25 — **Cloud phones: every Live phone, and Send on them**: the owner's first Live
  capture could only Copy (into the cloud phone's own clipboard), and the list was 5 phones. (1)
  `$lib/profilerCloudPhones.ts` now lists 130 phone × OS-version entries from BrowserStack's Live
  device list (read 2026-11-25), grouped by brand in an `<optgroup>` picker, plus **Other phone…**
  (device name, OS, OS version typed as Live shows them). Labels are
  `BS Live · <model> · <OS> <version>` and name the phone back, typed ones included. (2) The Live
  button now hands Live a **GO link** — `/profiler/go/<link id>/<capture token>`
  (`src/routes/profiler/go/[link]/[token]/+server.ts`, `$lib/server/profiler/go.ts`): public,
  no sign-in, the token the only authority, 302 to the capture link with `perfsession`. It has no
  `?` or `&`, so Live's `url=` survives whether Live decodes the hash before splitting it on `&`
  (the suspected cause) or not. **Copy link** copies it too and shows it under each QR. (3) The
  game's readout explains itself: "no Send: this link has no capture session", and "not sent:" now
  names an unreachable launcher host or what a bare HTTP status means (`perfSendCore.ts`, fixture
  case 5). Gate 3 of `check:profiler`: no raw `?`/`&` inside `url=` under either parse, the GO
  route lands on a URL with `perfsession`, and refuses a bad, expired, other-project or unpublished
  token. Live's list page names models without their brand; the dashboard `device` is brand +
  model ("Samsung Galaxy S25", as PR #1913 used); the Vivo/Oppo/Realme/OnePlus brand of those
  blocks is read off the model names. Not yet clicked through on the real BrowserStack dashboard.
- 2026-11-25 — **New capture → BrowserStack Live in one click**: a **Cloud phone** picker
  (`$lib/profilerCloudPhones.ts`: Galaxy S25, Pixel 9, Galaxy A16 5G, iPhone 16, iPhone 13, with
  the OS versions BrowserStack Live lists) sets the session's device label to "BS Live · <phone>",
  and each capture link gets a **BrowserStack Live** button: the Live integration URL
  (`live.browserstack.com/dashboard#os=…&os_version=…&device=…&device_browser=…&url=…&start=true`)
  that starts that phone on the link. No BrowserStack key; gate 3 in `check:profiler` checks the
  capture link round-trips. iPhone 13 Pro is not on BrowserStack's Live list, so iPhone 13 stands
  in. Superseded the same day by the entry above.
- 2026-11-25 — **P7 parked**: the owner bought BrowserStack Live, not Automate; cloud phones are
  captured by hand. The guide gains "Capture on a cloud phone"; the owner blocker is gone from
  `docs/STATUS.md`.
- 2026-11-18 — **P5 "File as bug" built**: `profilerFindings/bug.ts` (list, area, text),
  `profiler/findingBugs.ts` + `findingBugLink.ts` (draft, filing, link, Keep), `perf_finding_bugs`
  - migration 0047, `insertBug`'s `within` hook, the Bug column on Findings, the prefill on
    `/bugs` and `/game-bugs` (`withFindingDraft`), the un-Keep 409, the purge guard, `?build=` on the
    Builds tab, gates 17–18.
- 2026-11-18 — **P4 "Findings" built**: `src/lib/profilerFindings/` (eight rules, one file each,
  ranking, Compare), `facts` columns + migration 0046 filled at receipt and backfilled from R2 on
  load, the **Findings** and **Compare** tabs, owners from `owners.json` (mirrored by
  `copy-tool-docs.mjs`), `check:profiler` tests 14–16 with a planted mutant per rule. The Devices tab
  leaves lab runs out. `vite.config.js` bundles every `workspace:` package under `vite dev` (the
  launcher's project pages 500'd in dev once `constants-shared` reached `engine-flow-v2`).
  Verified locally, not on production. Docs: guide, `ui-inventory.md` §2.

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
