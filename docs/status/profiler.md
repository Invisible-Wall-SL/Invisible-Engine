# Invisible Profiler — status

> Guide: [docs/tools/profiler.md](../tools/profiler.md) · Plan:
> [docs/design/invisible-profiler.md](../design/invisible-profiler.md) · Agent:
> `.claude/agents/launcher-studio.md` (the probe side: `engine-pixi-svelte`)

**One-line state:** step **P1 "Capture and keep" built 2026-11-16** (PR open; live once merged) — a
launcher tool (`/profiler`, every role, Create section) that opens a 24-hour capture session for a
project's published games, keeps every `?perf=1` reading the game sends (or that is pasted) in R2
and Postgres, and lists them per project; readings go after 15 days unless kept. P2–P7 are planned.

## Current state

- **Registry.** Tool id `profiler`, "Invisible Profiler" (bar name **Profiler**), doc slug
  `profiler`, `kind: 'online'`, in `ROLE_TOOLS` of every role and in the **Create** stage
  (`apps/launcher-api/src/lib/roles.ts`); `check-family-tools.ts` lists it.
- **Page.** `src/routes/(app)/profiler/+page.svelte` + `+page.server.ts`: project picker
  (`resolveToolScope`, `?project=`), three `SectionCard`s — **New capture** (device label, Open
  capture → per published game four QR codes: As shipped, Particles off, Element FX off, Antialias
  off), **Paste a reading** (textarea + device label → Keep reading) and **Readings** (newest 500;
  per-phase fps / p95 / >33 ms, draws, texture MB, a Keep checkbox with the days left, a JSON link).
  The list re-reads every 10 s while a session is open and the tab is visible.
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
  after); a project may have 20 staged uploads waiting (a presigned PUT cannot be size-limited on
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
- **Retention.** 15 days from capture unless `keep` (`PERF_RETENTION_DAYS`). `profiler/purge.ts`
  claims (`purging_at`), deletes the R2 file, then the row — each step repeatable, Keep cannot land
  on a claimed row. The same run sweeps every project's `perf/uploads/` of staged uploads older than
  a day (never registered). `purgeJob.ts` runs it 5 min after boot and every 24 h, started from
  `hooks.server.ts` `init`.
- **Probe (engine — merging it is a runtime release).** `apps/lines/src/components/PerfHud.svelte`
  imports `apps/lines/src/game/perfSend.ts` only when the URL has `perfsession`; then the readout
  shows **Send**, and also sends on its own before a Reset clears it and when the page is hidden
  (only a reading with frames not yet sent; on hide without `textureList` and `spikes`, marked
  `trimmed`, so it fits a `keepalive` request ≤ 60 KB). `__IE_PERF__('reset' | 'take')` never sends. It posts to the launcher the
  game boots from (`?editorDocBase=`, else `DEFAULT_DOC_BASE`). Without `perfsession` it makes no
  request.
- **Gate.** `pnpm --filter launcher-api check:profiler` (`scripts/check-profiler.ts`): report
  summary, token, capture links, purge and Keep races, CORS paths.

## Open items / next

1. **Merge and deploy P1, then verify live** — the design's done-when: a phone scanning the QR
   leaves a reading the page lists, and a player URL without `perfsession` makes no request.
2. **Auto-send on page hide is unverified on real phones.** iOS may suspend the page before the
   `keepalive` request (which needs a CORS preflight) leaves; check on an iPhone and an Android
   phone. P1 was verified in the desktop app's browser pane only.
3. **Presigned upload from the games origin is unverified.** A reading over 480 KB sent from a phone
   PUTs straight to R2 from `games.invisiblewall.org`; that only works if the R2 bucket's CORS
   allows PUT from that origin. Not checked yet (Paste uploads from the launcher's own origin).
4. **`runtime_release` is always empty** until P2 fills it.
5. **Staged uploads of a project moved to another client** are swept under the new client's prefix
   only (moving a project moves no R2 data), so an old one there is never swept. Edge case.
6. **P2 — Builds:** the desktop launcher uploads `build-breakdown.json` after Publish and Deliver;
   `perf_builds`; Builds tab with the previous-build diff; readings joined to their build (a pasted
   delivery reading is tagged to its build by `build-info.json` then).
7. **P3 — Devices and budgets:** `perf_budgets` with the studio default; Devices tab; pass / warn /
   fail per build and device class.
8. **P4 — Findings:** the rules as pure functions with fixtures in `check:profiler`; Findings tab;
   Compare.
9. **P5 — File as bug:** prefilled Bug Reports from a finding, with the evidence links.
10. **P6 — Lab runs:** a scripted headless run per Publish, compared on counts.
11. **P7 — Cloud phones:** the lab script on an online real-device service, calibrated first.

## Recent changes

- 2026-11-16 — **P1 "Capture and keep" built**: registry entry, `/profiler` page, capture sessions
  and their token, the report / upload / session / Keep routes with CORS for the probe,
  `perf_reports` + R2 storage, the 15-day purge, the probe's Send and auto-send, `check:profiler`;
  guide `docs/tools/profiler.md`, README row, STATUS map row, INFRA env line, `owners.json` entry.
