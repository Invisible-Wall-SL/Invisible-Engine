# Invisible Profiler — how a published game performs, on which devices, and what to cut

**Status:** design registered 2026-11-16; owner decisions recorded the same day. Not yet built. Build plan below (P1–P7).
**Owner ask:** "a tool to control and optimize games, to see what is going on and how it performs
on different devices, understand problems so a plan to solve them can be created. It should work
on final builds, to monitor if the build is efficient, and say where things can be saved to reach
FPS and build-size targets for each project."

## Problem

The measuring exists; nothing keeps, compares or acts on what it measures.

- **On-device:** `?perf=1` (`apps/lines/src/components/PerfHud.svelte`, numbers in
  `apps/lines/src/game/perfStats.ts`, spikes in `perfSpikes.ts`, GL counts in `pixi-svelte`'s
  `glCounters.ts` and `churnProbe.ts`) reads, on any device and any published build: fps and
  frame-interval p50/p95/max with hitches for the idle, spinning and round phases; the GPU, the
  context, textures by GPU format and every texture (`textureList`); per frame draws, passes,
  uploads, GL calls, render and tick CPU ms, particles, rigs, shader compiles and churn; every spike
  with a likely cause. `window.__IE_PERF__()` returns it as one JSON (`perf: 7`). The test switches
  (`?particles=off`, `?fx=0`, `?aa=0`, `?render=reduced`, …) each remove one cost. What each field
  means is owned by `docs/status/engine.md`, not restated here.
- **Build size:** every ☁ Publish and 📦 Deliver writes a build breakdown
  (`scripts/build-breakdown.mjs` → `build-breakdown.json` + `.html`, see the launcher guide
  §"📊 Build breakdown"): size by category, an estimated GPU memory, files nothing loads,
  duplicates, oversize textures, what 🗜 Optimize saved.

But the readings travel by hand: someone opens the game on a phone, taps Copy, pastes the JSON
into a chat, and the number lives in that chat. The breakdown is a local HTML file on the machine
that published, kept for 10 builds. There is no history per game and device, no target per
project, no "this build is worse than the last one", and no list of what to cut ordered by what
it would save. Every perf investigation in `docs/status/engine.md` "Open items" is blocked on
"the owner's `?perf=1` Copy" for exactly this reason.

## Goals

1. **Every reading is kept**, tagged with project, build, runtime release and device, without a
   copy-paste step.
2. **Devices side by side:** one game's readings grouped by device class and GPU.
3. **Budgets per project** (fps per device class and phase, shipped MB, GPU MB, draws a frame);
   each build is marked pass / warn / fail against them and against the previous build.
4. **Where to save:** a ranked list of findings, each with its evidence, an estimated saving and
   the agent that owns the fix.
5. **A plan out of a finding:** one click files it as a game or pipeline bug with the evidence, so
   the existing triage route (`pipeline-triage` → owning agent) picks it up.
6. **Final builds only:** every number is read from a published or delivered build, never from a
   dev server or the editor's preview.

**Non-goals:** a player-side RUM/analytics feed (players never load the probe, and the partner
owns the player relationship); profiling the authoring tools themselves; changing what the probe
measures (that stays the engine's, in `docs/status/engine.md`).

## Where it lives — a launcher web tool

`/profiler` in `apps/launcher-api`, tool id `profiler`, doc slug `profiler`, full-page like every
tool (hard rule 3). Not a desktop tool: the readings come from phones anywhere, and the history must
be the team's. The desktop launcher contributes what only it has — the build breakdown — by
uploading it after Publish or Deliver.

## Architecture

```
 phone / tablet / desktop                 desktop launcher                 lab job (P6)
 game ?perf=1&perfsession=<t>             ☁ Publish · 📦 Deliver            headless Chrome
        │  Send / auto at Reset                 │ build-breakdown.json           │ __IE_PERF__('take')
        ▼                                       ▼                               ▼
   POST /api/profiler/reports        presigned PUT → R2 + POST /api/profiler/builds
                         \                     |                     /
                          ▼                    ▼                    ▼
              R2  <client>/<project>/perf/{reports,builds}/…   (the full JSON)
              Postgres  perf_reports · perf_builds · perf_budgets   (summary rows)
                                         │
                                         ▼
                 /profiler: Devices · Builds · Budgets · Findings → file a bug
```

### 1. Capture sessions — how a phone sends without a launcher sign-in

A game runs on `games.invisiblewall.org`; a phone is rarely signed in to `app.invisiblewall.org`.
So the Profiler opens a **capture session**: pick the project (and optionally a build and a device
label), and it shows a QR code and a link to the published game with
`&perf=1&perfsession=<token>`. The token is launcher-signed (the tool-launch-token pattern), scoped
to that one session and project, and expires after 24 h. Scanning it on the phone opens the game
with the probe and the session.

- The probe gets a **Send** button beside Copy; it also sends on its own at every Reset and when the
  page is hidden, so a tester who only plays still leaves a reading.
- The sender lives in the probe's own chunk, which loads only under `?perf=1`: players download no
  byte of it, and without a `perfsession` it never makes a request.
- `POST /api/profiler/reports` answers CORS for the games origin (like `/api/editor/runtime` in
  `hooks.server.ts`) on every status, so a bad token reads as a 401, not as a CORS error.
- A report over the 512 KB request-body cap (a long `textureList`) is uploaded by presigned PUT,
  then registered — the launcher's upload rule.
- **Deliveries** run on a partner's page; nothing posts from there. Their readings come in by
  **Paste** in the Profiler (the Copy JSON), tagged to the delivery build by its `build-info.json`.

### 2. Build records

After a Publish or Deliver the desktop launcher already has `build-breakdown.json`. It uploads it
(presigned, to `<client>/<project>/perf/builds/v<build>.json`) and registers a summary row: build
number, kind (publish / delivery), profile, runtime release, shipped bytes by category, estimated
GPU MB, issue counts, Optimize on/off. A report is joined to its build by the `__IE_BUILD__` stamp
the probe already reads.

### 3. Storage

Full JSON in R2 under the project (`perf/reports/<id>.json`, `perf/builds/v<n>.json`), so
backups, purge and the project's own folder rules apply (`docs/design/unified-project-repo.md`).
Summary rows in Postgres (Drizzle, `apps/launcher-api/src/lib/server/db/schema.ts`):

- `perf_reports` — id, project key, build, runtime release, captured at, session, device class and
  its reason, GPU, UA family, DPR, canvas size, `perf` version, and per phase fps / p50 / p95 /
  hitches, draws mean, texture MB, JS ms; plus the R2 key of the full JSON.
- `perf_builds` — project key, build, kind, profile, runtime release, shipped MB by category, GPU
  MB estimate, issue counts; R2 key.
- `perf_budgets` — project key, device class, metric, phase, warn and fail thresholds.

Budgets are a Profiler concern, not game behaviour, so they do not go in Game Config.

### 4. Findings — the rules

A finding is `{ rule, severity, evidence, estimate, owner }`, computed from a report, a build, or
the pair, by small pure functions with fixtures (one file per rule, a `check:profiler` gate). The
first set reads only fields that exist today:

| Rule | Reads | Says | Owner |
|---|---|---|---|
| Fps below budget | report phases | which phase, by how much, on which devices | the game kind's agent |
| GPU-bound or CPU-bound | render/tick ms vs interval, `?perfgpu=1` wait | which side to cut | `engine-pixi-svelte` |
| Feature cost | two reports, one with a test switch | fps and draws a switch buys (`particles=off`, `fx=0`, `aa=0`) | `invisible-fx` / `invisible-shader-graph` / engine |
| Spikes by cause | `spikes` | shader compiles, uploads, churn mid-round | `engine-pixi-svelte` |
| Textures over budget | `textureList`, breakdown | largest textures, oversize pages, WebP where KTX2 was expected | `atlas-python-tools` |
| Unused bytes | breakdown issues | files nothing loads, duplicates, MB saved by removing | the project's author (FTP Browser) |
| Optimize off | breakdown | MB a 🗜 Optimize build would save | publisher |
| Regression | this build vs the last on the same device class | the metric that moved and the categories that grew | the build's changes |

Estimates come from what was measured (a test-switch delta, the bytes of a file), never from a
model of the GPU. A finding without a measurement behind it says "unmeasured" rather than a number.

### 5. A plan out of a finding

**File as bug** opens the existing Bug Reports form prefilled: a game bug for a game's content
(oversize art, unused files) or a pipeline bug for the engine or a tool, with the evidence and links
to the report and build. From there the existing route applies — `pipeline-triage` reproduces it
and names the owning agent and branch; the fix PR's `## Lesson` closes the loop. The Profiler does
not grow a second ticket system.

### 6. Lab runs — a steady number per build (P6)

Real phones are the truth for fps, but they are not on hand for every build. After each Publish a
job boots the published game in headless Chrome, plays a scripted sequence (idle 20 s, 10 spins,
a forced feature where the mock supports it), reads `__IE_PERF__('take')` and posts it as a
`lab` report. Lab reports are compared on **counts** — draws, passes, uploads, GL calls, texture MB,
JS ms per frame — not fps: fps on a shared runner swings about 2× run to run. It runs where the
current-games harness already runs headless Chrome (`.github/workflows/current-games.yml`,
`scripts/playtest/online-play.mjs`). Real phones from an online service are "Cloud phones" below (P7).

## The page

Four tabs on one project (the project selector the tools already share), each a set of foldable
`SectionCard`s with their descriptions in header tooltips (hard rule 10):

- **Devices** — a row per device class and GPU, columns per phase (fps, p95, hitches), coloured by
  budget; open a row to see its readings over builds.
- **Builds** — a row per build: shipped MB by category, GPU MB, pass/warn/fail, the diff with the
  previous build; opens the build's breakdown page.
- **Findings** — the ranked list, filter by owner; File as bug on each.
- **Budgets** — the thresholds per device class, with a studio default a project can override.

Plus **New capture** (the QR / link, with the test-switch variants as one-tap links so a tester can
measure a feature's cost) and **Paste** for a delivery's Copy. **Compare** puts any two reports side
by side.

## Build plan (ordered)

Each step is one PR, usable on its own.

- **P1 — Capture and keep.** Capture sessions and their token; `POST /api/profiler/reports` with
  CORS and presigned upload; the probe's Send button and auto-send (engine, so a runtime release);
  `perf_reports` + R2; a bare `/profiler` listing reports per project with Paste. Registry entry,
  `docs/tools/profiler.md`, its README row and `docs/status/profiler.md` in the same PR (hard
  rule 9). **Done when** a phone scanning the QR leaves a report the page lists, and a player URL
  without `perfsession` makes no request.
- **P2 — Builds.** The desktop launcher uploads `build-breakdown.json` after Publish and Deliver;
  `perf_builds`; the Builds tab with the previous-build diff; reports joined to their build.
- **P3 — Devices and budgets.** `perf_budgets` with a studio default; the Devices tab; pass / warn /
  fail per build and device class.
- **P4 — Findings.** The rules above as pure functions with fixtures and a `check:profiler` gate;
  the Findings tab; Compare.
- **P5 — File as bug.** Prefilled Bug Reports from a finding, with the evidence links.
- **P6 — Lab runs.** The scripted headless run per Publish, compared on counts; the Builds tab shows
  its counts beside the phones' fps.
- **P7 — Cloud phones.** The same script on the real-device service's phones ("Cloud phones" below): calibration
  against an owned phone first, then the device matrix on demand and nightly per live game.

## Decisions (owner, 2026-11-16)

1. **Name:** Invisible Profiler, `/profiler`.
2. **Who sees it:** every role, for now. Budgets and Keep are editable by every role too; narrow it
   later with a capability if needed.
3. **Retention:** readings and build records are deleted after **15 days** unless marked **Keep**
   (a pin on a reading or a build). A daily purge removes the R2 file and the row together. The
   newest build of each project is never purged, so a new build always has one to compare with.
   Budgets are settings, not readings, and are kept.
4. **Studio default budgets:** phone 60 fps idle and ≥ 50 spinning (p95 ≤ 25 ms), desktop 60 / 60;
   shipped ≤ 25 MB; GPU ≤ 150 MB on phones. A project can override any of them.
5. **Phones from an online service** — see "Cloud phones" below.

## Cloud phones — real devices from an online service (P7)

The owner wants to test on phones nobody on the team owns, from an online real-device service,
driven by the same script as the lab run.

**Proposed service: BrowserStack Automate.** It runs Playwright on real Android phones (Chrome)
and real iPhones and iPads (Safari), which is what the lab script is written against. LambdaTest
(now TestMu AI) offers the same on iOS and is the fallback if pricing or the device list decides it.
Either way the service is a seam: one adapter (`profiler/devices/<service>.ts`) that opens a
session on a named device, so swapping provider touches one file.

**How a cloud run works.** The Profiler (or the nightly job) asks the adapter for a session on each
device in the project's matrix, opens the published game with `&perf=1&perfsession=<token>`, plays
the lab script, and the probe posts its report like any phone, tagged `source: cloud` and the
service's device name. The game is public on `games.invisiblewall.org`, so no tunnel is needed.

**The data is ours by construction.** The numbers never pass through the service: the probe on the
cloud phone posts straight to our launcher, so every reading lands in our R2 and Postgres whatever
the service exports. The service's REST API is used only to start and end sessions and to read a
session's metadata (device, OS and browser version, status, the links to its logs), which is
stored on the report. Changing or dropping the service loses no history.

**What to trust.** A cloud phone is real hardware, but it is driven remotely and may be recording
video, which costs it frames. So:

- **Calibrate first.** Before any cloud number is used against a budget, the same build runs on the
  service's iPhone 13 Pro and Galaxy S25 and on the owner's own two phones. If fps differs by more
  than ~10 %, cloud readings are compared to each other (build to build), never to the budget, and
  the page says so.
- Video recording is turned off for perf runs; logs only.
- The counts (draws, uploads, texture MB, JS ms) are trusted as on any device.

**When it runs.** On demand from **New capture → Cloud phones** (pick devices), and nightly on
each live game's newest build over a small default matrix (one low, one mid and one high Android;
two iPhones), kept to the plan's monthly minutes. Not on every Publish: device minutes cost money.

**Owner steps (not code):** open the account and choose the plan; the username and access key go
into the runner's env vars only (`BROWSERSTACK_USERNAME`, `BROWSERSTACK_ACCESS_KEY`), never into
the repo (hard rule 1).

