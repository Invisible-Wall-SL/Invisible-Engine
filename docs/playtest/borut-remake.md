# Playtest — book of borut remake (online / generic runtime)

`bookofborutremake` is an **online-published** project (no local dev server, no repo). It boots the
shared generic runtime (`runtime:lines`) from live R2 authoring data, driven by the **`book`** mock
protocol (buy-feature + free spins). This is the truest test — exactly what a player loads.

## Launch (the caller passes the live URL — it carries a secret read token, so it is NOT stored here)

1. The launch URL has the shape
   `https://games.invisiblewall.org/bookofborutremake/?runtime=1&project=bookofborutremake&k=<READ_TOKEN>&editorDocBase=https://app.invisiblewall.org&rgs_url=games.invisiblewall.org/api/bookofborutremake&sessionID=demo&lang=en&currency=USD&device=desktop&ie_authoring=1`
   — **the read token `k=…` is a secret; never commit it.** The caller supplies the full URL at run time.
2. `navigate` the Browser pane to that URL (external site — no dev server / `preview_start`).

## FIRST assertion — confirm you are on LIVE data, not stale baked

The runtime read path can 401/502 and **silently fall back to stale baked data**; the browser often
blames CORS ([[gotcha_runtime_502_silent_stale_baked]], [[gotcha_online_game_stale_baked_readtoken_homoglyph]]).
Before trusting ANY render/math:
- Read `window.__IE_RUNTIME_STALE__` — must be **falsy**.
- With `&ie_authoring=1` (present in the launch link), a **red stale banner** appears if it fell back.
  If you see it, or `__IE_RUNTIME_STALE__` is true → **STOP, report "on stale baked data" with the
  failing `/api/editor/runtime` request** — everything downstream is untrustworthy.

## Drive path (CONFIRMED 2026-07-21 — the Browser pane CANNOT fire a real spin here)

The Browser preview pane keeps the tab **backgrounded** (`document.hidden === true`), which freezes
`requestAnimationFrame`. This game is **flow-driven** and its boot + spin-ready states ride rAF, so:

- **Boot it programmatically:** `window.__IE_FLOW_V2__.dispatch('tapToStart', {})` advances
  `loading → basegame` (Svelte mounts scene containers on a microtask, so they appear despite frozen
  rAF). `window.__IE_FLOW_V2__.ordered()` reads the mounted scene stack; then pump one frame with
  `app.ticker.update(performance.now())` to flush the render. Pixi app handle: `window.__PIXI_APP__`.
- **A real SPIN is NOT drivable in this pane.** There is no `/src` source import (minified bundle) and
  no `window` actor handle; canvas coordinate clicks need a screenshot first (WebGPU screenshots time
  out ~30s); synthetic canvas `PointerEvent`s dispatch but don't advance (rAF-gated); invoking the
  spin widget's handlers produces **no bet POST** because spin-ready is an rAF/GSAP idle state the
  frozen ticker never reaches. **→ S2/S3 (spin math, free spins, count-up, return-to-idle) are BLOCKED
  in the Browser pane. Drive them in a FOREGROUND real browser via the Claude-in-Chrome MCP.**

### Claude-in-Chrome drive path (CONFIRMED 2026-07-21 — this is the way to run S2/S3)
`list_connected_browsers` → `tabs_context_mcp{createIfEmpty:true}` → `navigate` to the launch URL →
`computer` screenshots + **real clicks** (Chrome canvas hit areas take real pointer events). Read the
book from `read_network_requests{urlPattern:'rgs/engine'}`. **The tab MUST stay VISIBLE the whole run**
— Chrome throttles rAF on a hidden tab, so if focus leaves the tab the auto-play / free-spin round
**pauses mid-round** (not a bug — check `document.visibilityState==='visible'` before calling it stuck).
At 1512×812 the controls sit at: Spin = revolver cylinder ~(756,715); BUY FEATURE ~(1318,740); tap-to-
start = anywhere. Boot takes ~15s (runtime assemble) — wait before the first screenshot.
- **You CANNOT force outcomes.** `BIG_WIN`/`FORCE_TRIGGER` are local-mock CLI levers; production's
  mock RGS won't honor them. Money-math rides RNG — but **book-vs-render verifies on every spin, win
  or lose** (read the bet response book; compare to rendered Balance/Win) once a spin CAN be fired.
- Read-only, demo/mock RGS: no real money moves. Do not perform any confirm/submit outside the game.

## Scenarios

### S1 — Boot clean + LIVE-data confirm
- **Do:** navigate to the launch URL; boot via `__IE_FLOW_V2__.dispatch('tapToStart', {})` (the
  loader will NOT self-advance under frozen rAF); pump `app.ticker.update(...)`.
- **Expect:** `window.__IE_RUNTIME_STALE__` falsy + no stale banner; console shows `[runtime] live
  runtime bundle ready`/`editor edits are active`; the `/api/editor/runtime` fetch 200s; after
  tapToStart the stage grows (~155 nodes) with reels + HUD; balance/bet render per config.

### S2 — Single base-game spin (money math)  — BLOCKED in the Browser pane; run via Claude-in-Chrome
- **Do (foreground browser):** fire one spin; capture the bet POST response + book.
- **Expect:** the rendered Balance/Win/Bet equal what the returned **book** dictates
  (`platform.balance`, `gameEnd.win`/`gameRoundOver.win`, `bet.total`); no uncaught exceptions.
- **human-eyes:** count-up + return-to-idle.

### S3 — Free spins (opportunistic / buy-feature)  — BLOCKED in the Browser pane; run via Claude-in-Chrome
- **Do:** if a base spin's book triggers the bonus, follow the round to completion; OR use **BUY
  BONUS** if reachable (book protocol supports the buy-feature) to reach free spins deterministically.
- **Expect:** trigger response stays OPEN (no `gameRoundOver`) with `spinTrigger`/`enterBonus` + the
  special expanding symbol; the free-spin counter shows the right count; on `collect` the accumulated
  win credits and the game returns to base game. (Remake note: some standalone-Borut-only features are
  absent under `runtime:lines` — [[gotcha_standalone_borut_features_missing_in_remake]] — so a missing
  Borut-specific flourish is expected, not a bug; report it as a gap, not a failure.)

### S4 — Symbol / render sanity
- **Do:** inspect the stage graph after a spin settles (pump `app.ticker.update()` to sample a frame).
- **Expect:** the board has the expected symbol sprites/spines (no placeholder dots, no missing-glyph
  black screen). **human-eyes:** actual art fidelity.

## Known issues / regression guards (found 2026-07-21 via Claude-in-Chrome)
- **BUY FEATURE menu copy is off-theme placeholder text (CONTENT BUG).** The five feature tiles read
  *"SAMURAI SPIN is AWESOME!"*, *"Enter the mothership Land values and multiply them with action
  symbols"*, etc. — leftover generic/other-template copy that doesn't belong in a western Book-of game.
  (The BONUS confirm dialog copy IS correctly themed.) Likely the engine's default feature-buy strings
  showing because per-game config isn't in R2 yet (Game Maker Phase 2). Regression guard: the buy menu
  tiles must use Borut/western copy. Report if still present.
