# Symbols — lessons

What has bitten symbols work before, newest first. Format and rules: [README](../README.md).
Current state lives in [status/symbols.md](../../status/symbols.md); this file only keeps the
traps. Older detail: [symbols-history.md](../../status/symbols-history.md).

### Art set on a symbol state that never plays
- **Symptom:** a Hold and Win project showed 17 state columns per row; art set on most of them
  shipped but never showed (a token's Win, a coin's Post-win).
- **Cause:** the grid offered every state to every row; nothing traced which beat plays which state.
- **Fix:** `symbolStatesPlayed` in `packages/engine-layout/src/lib/symbolStates.ts`; rows offer
  only played states, `unplayed` cells get a Clear. A held coin's `clearReel` kept on review.
- **Guard:** `check:symbols-kind-gating` §5 (every kind and setup, every seed lists nothing).
- **PR:** not recorded (2026-10-23) · source: `docs/status/symbols.md`

### A flying pots token showed the win frame
- **Symptom:** the authored Highlight drew around a pots token while it flew to its meter.
- **Cause:** the head flies as `flyToMeter`, which is in `WIN_HIGHLIGHT_SYMBOL_STATES`.
- **Fix:** `Symbol.svelte` takes `inFlight` (no win frame, no coin label); `FlightLayer` sets it.
- **Guard:** none.
- **PR:** not recorded (2026-10-16) · source: `docs/status/symbols.md`

### The grid listed symbols the game never deals
- **Symptom:** a never-saved scatter project listed `L4` and missed `M`; pots tokens were listed
  here but badged unused in `/config`.
- **Cause:** the page filtered on the SAVED config only and kept its own rule for tokens.
- **Fix:** both pages read `symbolUses` (`packages/game-config/src/symbolUse.ts`) over
  `resolveGameConfig`; coins get their own group.
- **Guard:** `check:symbols-follow-config` (2,569 checks over every kind and config state).
- **PR:** not recorded (2026-10-07) · source: `docs/status/symbols.md`

### One unknown field wiped the whole symbols doc
- **Symptom:** after a rollback every binding vanished, and the next save overwrote the real doc.
- **Cause:** `.strict()` blocks and enum-keyed records failed the parse on one newer key, state or
  enum value; `loadSymbolsDocWithEtag` fell back to the empty doc.
- **Fix:** reads strip unknowns with a warning; saves keep unknown top-level blocks.
- **Guard:** `check:doc-readers-unknown-fields`, `check:save-keeps-unknown-blocks`; rule in
  `docs/conventions/doc-readers.md`.
- **PR:** #961 and follow-ups (2026-10-01) · source: `docs/status/symbols.md`

### Held coin labels drew black
- **Symptom:** coin values on the respin board rendered black instead of the authored tint.
- **Cause:** pixi `BitmapText` defaults `fill` to white only in its constructor; `CoinLabel`
  re-assigned a fill-less style every render.
- **Fix:** the style always passes `fill: 0xffffff` (the tint multiplies it).
- **Guard:** none specific (`check:coin-label` covers the label's shape).
- **PR:** #963 (2026-10-01) · source: `docs/status/symbols.md`

### Manual Save overwrote a newer save
- **Symptom:** Save never warned that a colleague had saved in between.
- **Cause:** `onclick={save}` with `save(force = false)` passed the click event as `force`, so
  `writeGuard` skipped the ETag check. Same bug in `/fx` and `/localization`.
- **Fix:** `onclick={() => save()}`.
- **Guard:** `check:event-bound-flags` (any boolean-first handler bound straight to an event).
- **PR:** #821 (2026-09-28) · source: `docs/status/symbols.md`

### A renamed rig shipped as nothing
- **Symptom:** a cell, highlight or board glow bound to a renamed or deleted rig showed nothing.
- **Cause:** `symbolExport.ts` returned in silence when `exportRigBundle` found no bundle; the doc
  kept the key.
- **Fix:** `SymbolExportIndex.spinesMissing`, reported at bake, publish, boot and delivery.
- **Guard:** the `spinesMissing` report itself (warning, not a failure).
- **PR:** not recorded (2026-09-28) · source: `docs/status/symbols-history.md`

### Symbols showed as black boxes on phones
- **Symptom:** symbols rendered black on 8 GB phones; high-memory phones were clean.
- **Cause:** `bakedSymbolAssets()` (`apps/lines/src/editor-scenes.ts`) never chose the KTX2 twins,
  and the bake's export endpoint passed no `PageStore`, so symbol pages shipped raw (107 MB).
- **Fix:** tier check in `bakedSymbolAssets()` and `layerAssets()`; the endpoint builds a store;
  `runtimeBundle`'s `prune:pages` is the only `_pages/` pruner.
- **Guard:** `scripts/check-page-store-shared.mjs`.
- **PR:** not recorded (2026-09-22) · source: `docs/status/symbols-history.md`

### The FX preview was offset at 150 percent zoom
- **Symptom:** an FX layer sat in the wrong place and was clipped in `/symbols` and `/rigger`,
  correct in the game. First chased as a blend bug, which cost a round.
- **Cause:** `createFxOverlay` (`apps/launcher-api/src/lib/fx/fxOverlay.client.ts`) set
  `resolution` from `devicePixelRatio` without `autoDensity`, so the canvas took its backing size.
- **Fix:** `autoDensity: true`. **Guard:** none.
- **PR:** not recorded (2026-09-18) · source: `docs/status/symbols-history.md`

### The win pop ran the whole beat budget every paying spin
- **Symptom:** after a big win the cells showed no symbols; every paying spin waited the full cap.
- **Cause:** an absent `loop` means LOOP, so `explosion` and `clearReel` rigs never completed and
  the one `Promise.all` waited `WIN_BEAT_CAP_MS`.
- **Fix:** `TERMINAL_SYMBOL_STATES` play once by default (`engine-layout/symbolStates.ts`); the
  Book-of column-morph waits are capped. **Guard:** none specific.
- **PR:** not recorded (2026-09-15) · source: `docs/status/symbols-history.md`

### A source gate failed only on Windows clones
- **Symptom:** `check:tumble-pattern` reported 1 of 34 failed on `core.autocrlf=true` checkouts.
- **Cause:** a regex with a TRAILING `\n` over raw file text; CRLF breaks a trailing newline but
  not a leading one, so it fails in ones and twos and looks like a real breach.
- **Fix:** read source through `scripts/lib/read-lf.mjs`.
- **Guard:** the shared helper; copy it into any new source-scanning gate.
- **PR:** not recorded (2026-09-15) · source: `docs/status/symbols-history.md`

### The Highlight framed only rig symbols
- **Symptom:** the authored win frame skipped sprite and flipbook symbols.
- **Cause:** the frame was mounted inside the rig arm of `Symbol.svelte`'s renderer switch.
- **Fix:** `apps/lines/src/components/SymbolWinFrame.svelte`, mounted after the switch.
- **Guard:** none.
- **PR:** not recorded (2026-09-07) · source: `docs/status/symbols-history.md`

### A setting snapped back or Save stayed disabled
- **Symptom:** `winCycle` choices reverted on Save; later "wait after a big win" left Save greyed.
- **Cause:** hand-copied field lists: the PUT body in `saveSymbolsDoc` enumerated fields, and
  `docSignature()` (the dirty tracker in `symbols.client.ts`) did not list `holdAfterBigWin`.
- **Fix:** the PUT body spreads the doc; every new field is added to `docSignature`.
- **Guard:** `check:win-cycle` (real `docSignature`); see the offline-fixture rule in
  [game-config lessons](game-config.md#a-data-contract-looked-fine-until-the-browser).
- **PR:** not recorded (2026-07-24, 2026-09-08) · source: `docs/status/symbols-history.md`

### Rig cells came up blank on a cold load
- **Symptom:** every rig cell drew as its label chip, `physics is undefined` each frame.
- **Cause:** `rigRuntime.client.ts` injected one vendored runtime per line (4.1 and 4.2); the last
  to load owned the global and posed 4.2 skeletons.
- **Fix:** one runtime (4.2), loaded once and captured at load.
- **Guard:** `check:builtin-rigs`.
- **PR:** not recorded (2026-09-03) · source: `docs/status/symbols-history.md`

### The parity gate demanded a blank Intro cell
- **Symptom:** `check:symbol-state-parity` failed on a clean `main` and could catch nothing.
- **Cause:** it kept a third hand-written inheritance table that #499 did not update.
- **Fix:** expectations derived from the engine and tool resolvers, not copied.
- **Guard:** the gate itself; never give a gate its own copy of a table.
- **PR:** not recorded (2026-08-27) · source: `docs/status/symbols-history.md`

### Bound FX drifted right across the grid
- **Symptom:** "I can see the FX in the state machine but it's offset", worse further right.
- **Cause:** the stage was sized from `.grid-scroll`'s `clientWidth`, a scrollbar short of the
  canvas, so the rig canvas stretched while the FX overlay did not.
- **Fix:** size from the canvas's own box. **Guard:** `check:symbol-stage-geometry`.
- **PR:** not recorded (2026-08-27) · source: `docs/status/symbols-history.md`

### The symbols FX differed from the game
- **Symptom:** a rig FX looked right in `/symbols` or `/rigger` and wrong in the game, or reverse.
- **Cause:** three renderers kept in sync by hand: `RigBoneAttach` (game, BAKED data), `/fx`
  `FxStage`, and `fxOverlay.client.ts` (tools, LIVE data from `/api/editor/rig-fx`).
- **Fix:** all three apply the full bone transform; the runtime bundle ships `effects`/`rigFx`.
  Mirroring fix: [status/rigger.md](../../status/rigger.md) (2026-09-01).
- **Guard:** none; change all three together and prove the bake and runtime paths both carry data.
- **PR:** not recorded (2026-07-13, 2026-07-14) · source: `docs/history.md`

### Publish symbol defaults failed silently twice
- **Symptom:** `/symbols` kept listing a dropped symbol (`H5`) for a real game after every build.
- **Cause:** `publish-symbol-defaults.mjs` threw on the game's extensionless imports, then got a
  400 from the `.strict()` cell schema; `--optional` swallowed both as a warning.
- **Fix:** a resolve hook retries `.ts`; `sanitizeCells()`; `defaultCellSchema` is `.strip()`.
- **Guard:** none; publish from a local checkout without `--optional` and fail loud.
- **PR:** not recorded (2026-06-19) · source: `docs/history.md`
