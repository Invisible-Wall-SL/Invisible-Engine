# Engine shell — lessons

What has bitten the page every game boots in before, newest first. Format and rules:
[README](../README.md). Current state lives in [status/engine.md](../../status/engine.md); this file
only keeps the traps. It covers `apps/lines/src/app.html` (the shell of every runtime build), the
embed loader `scripts/build-embed.mjs` (a delivery's `game.js`, on the partner's page) and the
page-level overlays (`PerfHud`). Traps that hit every game in play: [current-games.md](current-games.md).
The runtime's rendering (`pixi-svelte`, render quality): [engine.md](engine.md).

### A profiler reading stored a published game's read token

- **Symptom:** a `perf: 9` reading from a published game could keep the project's read token in
  `perf_reports.network` and the R2 report, as `/api/published/f/<token>/…` in a file path.
- **Cause:** the probe redacted by position only under `/api/deploy/f`; elsewhere it guessed from
  shape (long, mixed letters and digits), which misses a digit-less token or a free-form secret. The
  launcher trusted the device.
- **Fix:** the probe and the launcher both redact by position under every token-bearing route
  (`TOKEN_ROUTES`); the launcher scrubs every string of a report before it writes R2.
- **Guard:** `check:profiler` gates 19–20: the two lists equal each other and every `[token]` folder
  under `src/routes`, a digit-less token and a free-form secret, a mutant dropping a route.
- **PR:** #1949 (2026-11-26) · source: `docs/status/profiler.md`

### On an iPhone the game slid up and the profiler's Send went off screen

- **Symptom:** owner, 2026-11-26, BrowserStack iPhone, Salmons: title cut, black strip, no Send.
- **Cause:** `<body>` only had `overflow: hidden`, which iOS Safari still scrolls; the lobby line was
  sized in the playtest's fallback font, narrower than the pixel font a phone loads.
- **Fix:** `app.html` pins `html`/`body`; an embed pins only its own container (`build-embed.mjs`, never the
  partner's page); `PerfHud` follows `visualViewport`; the lobby lines fit the canvas.
- **Guard:** none for the scroll (Chromium does not scroll like Safari): check on a real iPhone.
  Accepted (owner, 2026-11-26): pinned, iOS Safari's toolbar no longer folds away on a swipe.
- **PR:** #1937 (2026-11-26) and its follow-up, branch `claude/wonderful-wozniak-d6hr0p`

### The Profiler lists the same measurement several times, and a filed finding keeps coming back

- **Symptom:** many dated and repeated readings; a finding already filed as a bug (and being fixed)
  still at the top of Findings, again as "new" after the next build.
- **Cause:** the probe's reading is the whole window since the last Reset, sent on every tap, every
  hide and every Reset under a fresh server id, so one window became several readings; Findings ids
  embed the build, so a new build is a new id and loses the link to the bug filed on the old one.
- **Fix:** the probe names its window (`sendKey`), the store keeps the fullest send and the list
  folds repeats; findings carry a build-free `subject`, one row per subject, and the bug link follows
  the subject; readings and builds can be archived or deleted (the purge's own path).
- **Guard:** `check:profiler` 22–24 (`scripts/check-profiler-archive.ts`).
- **PR:** `claude/profiler-archive-dedupe`
