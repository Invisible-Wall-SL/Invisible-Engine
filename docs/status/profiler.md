# Invisible Profiler — status

> Guide: [docs/tools/profiler.md](../tools/profiler.md) · Plan:
> [docs/design/invisible-profiler.md](../design/invisible-profiler.md) · Agent:
> `.claude/agents/launcher-studio.md` (the probe side: `engine-pixi-svelte`)

**One-line state:** step **P1 "Capture and keep" built 2026-11-16** (merged, #1691) — a launcher
tool (`/profiler`, every role, Create section) that opens a 24-hour capture session for a project's
published games, keeps every `?perf=1` reading the game sends (or that is pasted) in R2 and
Postgres, and lists them per project; readings go after 15 days unless kept. Step **P2 "Builds"
built 2026-11-17** (PR open): every desktop ☁ Publish / 📦 Deliver (launcher v1.0.68+) registers its
build breakdown, listed on a **Builds** tab with the previous-build diff and the readings taken on
each build. P3–P7 are planned.

## Current state

- **Registry.** Tool id `profiler`, "Invisible Profiler" (bar name **Profiler**), doc slug
  `profiler`, `kind: 'online'`, in `ROLE_TOOLS` of every role and in the **Create** stage
  (`apps/launcher-api/src/lib/roles.ts`); `check-family-tools.ts` lists it.
- **Page.** `src/routes/(app)/profiler/+page.svelte` + `+page.server.ts`: project picker
  (`resolveToolScope`, `?project=`), two tabs (**Readings**, **Builds** = `?tab=builds`; the tab
  bar is copied from Pipeline Changes). Readings has three `SectionCard`s — **New capture** (device
  label, Open capture → per published game four QR codes: As shipped, Particles off, Element FX
  off, Antialias off), **Paste a reading** (textarea + device label → Keep reading) and **Readings** (newest 500;
  per-phase fps / p95 / >33 ms, draws, texture MB, a Keep checkbox with the days left, a JSON link).
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
  key, `keep`, `purging_at`.
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
- **Readings ↔ builds.** `readingOnBuild`: the reading's `__IE_BUILD__` stamp has the same build
  number, and the same commit when both have one (a short sha matches its long form). Reading list
  items carry `buildSha`. Readings carry no game key, so two game keys of one project with the same
  build number AND engine commit both claim a reading.
- **Capture token.** `src/lib/server/profiler/captureToken.ts`: the tool-launch-token format with
  its own audience (`typ: perf`, `aud: profiler`), one session and one project, 24 h. Signed with
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
  answers the same id); `GET` / `PATCH /api/profiler/reports/[id]`
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
  on a claimed row. The same run sweeps every project's `perf/uploads/` of staged uploads older than
  a day (never registered). `purgeJob.ts` `runPerfPurge` runs readings, then builds, then the
  staged-upload sweep, 5 min after boot and every 24 h, started from `hooks.server.ts` `init`.
- **Probe (engine — merging it is a runtime release).** `apps/lines/src/components/PerfHud.svelte`
  imports `apps/lines/src/game/perfSend.ts` only when the URL has `perfsession`; then the readout
  shows **Send**, and also sends on its own before a Reset clears it and when the page is hidden
  (only a reading with frames not yet sent; on hide without `textureList` and `spikes`, marked
  `trimmed`, so it fits a `keepalive` request ≤ 60 KB). `__IE_PERF__('reset' | 'take')` never sends. It posts to the launcher the
  game boots from (`?editorDocBase=`, else `DEFAULT_DOC_BASE`). Without `perfsession` it makes no
  request.
- **Gate.** `pnpm --filter launcher-api check:profiler` (`scripts/check-profiler.ts`): report
  summary, token, capture links, purge and Keep races, CORS paths (1–5); P2 adds a summary from the
  REAL engine analyser, the diff, the reading ↔ build join and the purge never taking the newest
  build (6–9).

## Open items / next

1. **Verify P1 live** (merged, #1691) — the design's done-when: a phone scanning the QR leaves a
   reading the page lists, and a player URL without `perfsession` makes no request.
2. **P2 is unverified on production.** Verified locally only (PGlite + fake R2): the real Python
   function registered three builds the page listed with their diff, a pasted reading joined its
   build, Keep, the breakdown page, and the purge (called directly) kept the newest of each line and
   deleted the rest with their files. Live needs the merge AND desktop launcher **v1.0.68** released
   (`build_and_publish.py`) — older launchers send nothing. R2 bucket CORS is irrelevant here (the
   PUT comes from Python, not a browser).
3. **Auto-send on page hide is unverified on real phones.** iOS may suspend the page before the
   `keepalive` request (which needs a CORS preflight) leaves; check on an iPhone and an Android
   phone. P1 was verified in the desktop app's browser pane only.
4. **Presigned upload from the games origin is unverified.** A reading over 480 KB sent from a phone
   PUTs straight to R2 from `games.invisiblewall.org`; that only works if the R2 bucket's CORS
   allows PUT from that origin. Not checked yet (Paste uploads from the launcher's own origin).
5. **`runtime_release` on readings is still empty.** A desktop build has no runtime release
   (`engineSha` stands in and the join uses it); online-game readings still lack it.
6. **Local `vite dev` 500s every SSR route** (dev only): it externalizes `packages/error-tracking`,
   whose TS has extensionless imports. Needs `error-tracking` in `ssr.noExternal` beside
   `engine-fx`. Follow-up, not fixed in P2.
7. **A build's game key is only format-checked**, not checked to belong to the project: a publisher
   (needs `gamePublish` + the project) could register under any key, making a "newest of its line"
   row the purge never removes. Low impact.
8. **A crash between the build file write and the row insert** leaves a file under `perf/builds/`
   that no sweep reclaims (the same trade-off as P1 readings).
9. **P1's reading register shares two edge cases fixed for builds** — a racing register deleting
   the reading file, and a 404 to a resend that lost the race. Follow-up in `profiler/store.ts`.
10. **Staged uploads of a project moved to another client** are swept under the new client's prefix
    only (moving a project moves no R2 data), so an old one there is never swept. Edge case.
11. **P3 — Devices and budgets:** `perf_budgets` with the studio default; Devices tab; pass / warn /
    fail per build and device class.
12. **P4 — Findings:** the rules as pure functions with fixtures in `check:profiler`; Findings tab;
    Compare.
13. **P5 — File as bug:** prefilled Bug Reports from a finding, with the evidence links.
14. **P6 — Lab runs:** a scripted headless run per Publish, compared on counts.
15. **P7 — Cloud phones:** the lab script on an online real-device service, calibrated first.

## Recent changes

- 2026-11-17 — **P2 "Builds" built** (PR open): `perf_builds` + migration 0042, the build upload
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
