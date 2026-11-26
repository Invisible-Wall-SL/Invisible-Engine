# Engine shell — lessons

What has bitten the page every game boots in before, newest first. Format and rules:
[README](../README.md). Current state lives in [status/engine.md](../../status/engine.md); this file
only keeps the traps. It covers `apps/lines/src/app.html` (the shell of every runtime build), the
embed loader `scripts/build-embed.mjs` (a delivery's `game.js`, on the partner's page) and the
page-level overlays (`PerfHud`). Traps that hit every game in play: [current-games.md](current-games.md).

### On an iPhone the game slid up and the profiler's Send went off screen

- **Symptom:** owner, 2026-11-26, BrowserStack iPhone 16 Pro Max / iOS 27 on Salmons: title cut, a
  black strip over Safari's toolbar, no Send; the lobby's river line ran off both sides.
- **Cause:** `<body>` only had `overflow: hidden`, which iOS Safari still scrolls; the lobby line was
  sized in the playtest's fallback font, narrower than the pixel font a phone loads.
- **Fix:** `app.html` pins `html`/`body`; an embed pins only its own container (`build-embed.mjs`, never the
  partner's page); `PerfHud` follows `visualViewport`; the lobby lines fit the canvas.
- **Guard:** none for the scroll (Chromium does not scroll like Safari): check on a real iPhone.
- **PR:** #1937 (2026-11-26) and its follow-up, branch `claude/wonderful-wozniak-d6hr0p`
