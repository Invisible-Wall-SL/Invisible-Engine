# Launcher — lessons

What has bitten launcher work before, newest first. Format and rules: [README](../README.md).
Current state lives in [status/launcher.md](../../status/launcher.md); this file only keeps the
traps. Localization, FTP Browser, Font Maker and Bug Reports have their own status files under
`docs/status/`. Publish and runtime traps are in [game-maker.md](game-maker.md).

### A desktop publish sits on "Writing the build breakdown…" for an hour
- **Symptom:** after the build finished, ☁ Publish stayed on "Writing the build breakdown…" far
  longer than the build itself (a 30 MB game); ending `node.exe` let the upload carry on.
- **Cause:** `scripts/lib/build-breakdown.mjs` matched its path pattern (`[…]+\.(png|…)\b`) across
  whole bundles; on a long base64 data URI with no extension it backtracks from every start
  position, so time grows with the square of the run (80 KB ≈ 4 s, a few MB ≈ an hour). The
  launcher runs the script with no time limit.
- **Fix:** match one path-character run at a time and skip runs over 1 KB (no path is that long).
- **Guard:** `node scripts/check-build-breakdown-desktop.mjs` (a 2 MB data URI must scan in < 2 s).
- **PR:** see git log (2026-10-28) · source: this lesson

### A desktop request gets an HTML error instead of the reason
- **Symptom:** the desktop launcher shows "the portal returned HTTP 409" and nothing else.
- **Cause:** its `http.client` sends no `Accept`, and SvelteKit answers a thrown `error()` to such a
  request with its HTML error page, which the launcher cannot parse.
- **Fix:** `hooks.server.ts` answers an `/api/launcher/*` request with no `Accept` as JSON
  (`{message}`); a browser still gets the page.
- **Guard:** `check:game-bundle-relay`.
- **PR:** not recorded (2026-10-21) · source: `docs/status/launcher.md`

### An edit made during a save is lost
- **Symptom:** an edit typed during an in-flight save never reached R2, though the tool said saved.
- **Cause:** `$lib/saveState.svelte.ts` cleared `dirty` on every success, and a write still in
  flight for the old doc could adopt its ETag onto the new one.
- **Fix:** edits are counted (`markDirty`); a success with a newer edit stays dirty and writes it on
  the adopted ETag. Sound, win-text, config, symbols, flipbook and fx still lose one (manual save).
- **Guard:** `check:save-state`.
- **PR:** not recorded (2026-10-14) · source: `docs/status/launcher.md`

### The project dropdown disagrees with the tool that opens
- **Symptom:** after a Duplicate, the copy was missing from the home dropdown and a tool card opened
  a third project.
- **Cause:** the session's project is shared by every tab and moves without the tab knowing
  (Publish pins it, a `?project=` launch syncs it); tool cards opened the session's project.
- **Fix:** the home page reloads on focus/visibility; every online tool card links `?project=`.
- **Guard:** none.
- **PR:** not recorded (2026-10-03) · source: `docs/status/launcher.md`

### Unsaved work discarded on a tool switch
- **Symptom:** a tool-bar switch, Back or reload threw away unsaved edits with no question.
- **Cause:** pages guarded only `beforeunload` (never fires for in-app navigation), or nothing.
- **Fix:** every manual-Save tool calls `guardUnsavedWork` (`src/lib/unsavedGuard.ts`), which owns
  both exits; native pop-ups replaced by `dialogs.svelte.ts`.
- **Guard:** `check:native-dialogs`.
- **PR:** not recorded (2026-09-29, 2026-09-30) · source: `docs/status/launcher.md`

### A manual Save overwrote a colleague's newer save
- **Symptom:** Save in `/localization`, `/symbols` and `/fx` never raised a conflict.
- **Cause:** `onclick={save}` with `save(force = false)`: the click event arrived as a truthy
  `force`, so the write skipped its ETag check.
- **Fix:** `onclick={() => save()}`.
- **Guard:** `check:event-bound-flags` (a boolean first parameter bound to an `on…` handler).
- **PR:** #821 (2026-09-28) · source: `docs/status/localization.md`

### A publisher could reach another client's project
- **Symptom:** a crafted publish body for an unshared project worked and pinned the session to it.
- **Cause:** publish and `register-game` checked only that the project existed; other routes
  decided access from a login alone.
- **Fix:** `requireProjectScope` / `canAccessProject` on every route naming a project
  (`toolScope.ts`); `sessionProjectScope` re-checks the stored project on each request.
- **Guard:** the `check:` gates launcher-gates, project-scope, lease-scope and deploy-read.
- **PR:** #811, #812, #814, #818, #826, #827 (2026-09-28) · source: `docs/status/launcher.md`

### A role with gamePublish still could not publish
- **Symptom:** a non-admin granted `gamePublish` was refused by publish endpoints.
- **Cause:** routes checked `adminPanel` or a literal `'admin'` role, through six bearer parsers.
- **Fix:** every publish path reads `GAME_PUBLISH_CAPABILITY` via `$lib/server/launcherAuth.ts`.
- **Guard:** `check:launcher-gates`.
- **PR:** not recorded (2026-09-18) · source: `docs/status/launcher.md`

### Translations reach the game but show in English
- **Symptom:** a translated build still showed English HUD captions, buy cards and menus.
- **Cause:** the merged Lingui catalog was built at module-eval, before the runtime bundle; `label`
  params and engine chrome were never resolved; bet-mode copy was never harvested.
- **Fix:** lazy `getMessagesMap()` (`apps/lines/src/i18n/messagesMap`), label resolution, and
  `harvestBetModeText` (`localizationHarvest.ts`).
- **Guard:** `localizationHarvest.fixture.ts`.
- **PR:** not recorded (2026-08-17, 2026-08-18) · source: `docs/status/localization.md`

### Translate says done but applies nothing
- **Symptom:** "Translated." while every cell stayed empty; the server had answered correctly.
- **Cause:** action results are devalue-encoded at every depth; a hand decoder resolved only the
  top level, so `translations` read `{ <id>: 2 }`.
- **Fix:** use SvelteKit's `deserialize` (`$app/forms`) in the localization page.
- **Guard:** none.
- **PR:** not recorded (2026-08-15) · source: `docs/status/localization.md`

### Two fonts with one face collapse into one
- **Symptom:** picking a gradient variant of a font changed nothing; the last-loaded face won.
- **Cause:** fonts were keyed on the shared BMFont `<info face>`, not the catalog `id`.
- **Fix:** `findFont` / `fontFamilyForRef` (engine-layout `fontCatalog.ts`) resolve `id` first; a
  same-id save is a 409 unless `overwrite`; `fonts.json` writes are CAS'd.
- **Guard:** none named.
- **PR:** not recorded (2026-07-28, 2026-08-04) · source: `docs/status/font-maker.md`

### A missing bitmap glyph blacks out the game
- **Symptom:** a translated or currency string blacks out the whole game.
- **Cause:** pixi 8 dereferences `charData.kerning` for a char a static bitmap font was not baked
  with (and no space glyph), which kills the render loop.
- **Fix:** `packages/pixi-svelte/src/lib/sanitizeBitmapText.ts` drops unbaked chars before layout.
  The letters still vanish: re-bake the font with the glyphs the locale needs.
- **Guard:** the sanitiser in `<BitmapText>`; no tool warning yet (win-text open item 2).
- **PR:** not recorded · source: `docs/status/font-maker.md`, `docs/status/win-text.md`

### A type error ships green
- **Symptom:** author component params were silently stripped, twice, with a green build.
- **Cause:** `pnpm --filter launcher-api build` is a bare `vite build` (strips types, checks
  nothing); a hand-copied allowlist drifted from its type.
- **Fix:** derive runtime lists from one exported value (`COMPONENT_PARAM_KINDS`); prove contracts
  in a Node fixture over the real modules.
- **Guard:** `check:undefined-names`, `pnpm lint`, the `check:svelte` ratchet: part of it, not all.
- **PR:** not recorded (2026-07-17) · source: `apps/launcher-api/CLAUDE.md`

### A real 404 or 401 reads as a CORS error
- **Symptom:** the browser reports "No Access-Control-Allow-Origin" for a game asset.
- **Cause:** `/api/deploy` set CORS only on its 200, so an `error()` (404, 401) had none and hid
  its real status.
- **Fix:** `hooks.server.ts` sets `DEPLOY_CORS_HEADERS` on every `/api/deploy` response.
- **Guard:** none.
- **PR:** not recorded (2026-07-09) · source: `docs/history.md`

### Rigger or Rig Viewer runs old code after a change
- **Symptom:** an FX change shipped everywhere except the Rigger.
- **Cause:** the static pages load COMMITTED vendored bundles (`static/rigger/vendor/*.js`,
  `static/rig-viewer/vendor/invisible-rig.js`), not source.
- **Fix:** run `pnpm --filter launcher-api build:<name>` and commit the bundle in the same change.
- **Guard:** `check:vendored-bundles`.
- **PR:** not recorded · source: `apps/launcher-api/CLAUDE.md`

### A tool 404s on a chunk right after a deploy
- **Symptom:** a missing `_app/immutable/nodes/*.js` chunk, odd errors, a feature not showing.
- **Cause:** the open tab holds the previous build; its chunks are gone after the deploy.
- **Fix:** hard reload once the deploy settles; check `/_app/version.json` for the live build.
- **Guard:** none.
- **PR:** not recorded (2026-07-08) · source: `docs/history.md`

A schema change that 500s every signed-in route (`db:push` on prod) lives in
[infra.md](infra.md#prod-500s-after-a-migration-because-of-db-push).
