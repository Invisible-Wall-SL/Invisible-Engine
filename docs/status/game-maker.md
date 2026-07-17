# Invisible Game Maker — status

> Design: [docs/design/invisible-game-maker.md](../design/invisible-game-maker.md) · Guide: [docs/tools/game-maker.md](../tools/game-maker.md) · Agent: none yet (launcher tool — closest owner `.claude/agents/launcher-studio.md` + `.claude/agents/engine-pixi-svelte.md`)

**One-line state:** in-progress — Phases 0–1 shipped (create + one-click online Publish for `lines`-type reskins, no repo/no build); Phases 2–4 (config-from-R2, more game-types, behavior tracks) unbuilt.

## Current state

Closes the "author online → play" gap without a per-game repo, CLI, or desktop build. Ships **one prebuilt generic engine runtime** that boots any project from its live R2 authoring data — Publish is a **data + manifest operation, not a build**.

- **Scaffold** — the `gameMaker` tool at `/game-maker` (full-page, admin + developer by default). "Create a game" seeds the launcher project + its cloud scaffold (`editor/scenes.json`, `atlas_config.json`, `manifests/`, `input/refs/`, `sheet_config.json`, `localization/strings.json`) — same scaffold as the `/admin` create action. Any tool holder can create; you then author with the existing online tools (editor / atlas / sheet / fonts / symbols / localization).
- **Publish** (Phase 1, `/api/game-maker/publish`, **admin-only for now**) — freshens `deploy/` exports (`ensureDeployExports`), mints/reuses a per-project **read-only token** for the runtime's public live fetches (never exposes the shared deploy token), read-modify-writes `test_server/games.json` with `{ protocol, name, runtime }`, upserts the portal `games` row with a runtime-pointed launch URL, best-effort refreshes the test server. Result plays at `https://games.invisiblewall.org/<key>/` against the mock RGS.
- **Publish pins the session** — after a successful publish the endpoint `setActiveProjectKey(session, project)` so the top bar + home selector land on the just-built project (fixed the "selection jumps to another client on Re-publish" footgun).
- **Generic runtime (Phase 0)** — `GET /api/editor/runtime?project=&k=` (`runtimeBundle.ts`) serves a project's full `BakedBundle` live; `apps/lines` boots it via opt-in `?runtime=1`, parity-guaranteed byte-identical when off. Assets served via the **path-form** `/api/deploy/f/<token>/<client>/<project>/<...rel>` route so Spine/spritesheet/bitmap-font sub-pages resolve relative to their parent URL.
- **The runtime read path is single-flighted + briefly cached** (`runtimeBundleCache.ts`, 2026-07-17). Assembling a bundle re-runs all 7 exporters (~17-19s measured on `bookofborutremake`), so a per-request assemble made concurrent boots pile up and 502 — and **any** fetch failure silently drops the game onto the stale baked doc. A game-side retry (`fetchRuntimeWithRetry`) now JOINS the in-flight assemble rather than starting another cold one; the two only work as a pair. TTL is deliberately 10s (shorter than a human edit→reload) because the bundle's inputs span three unrelated R2 trees — `<client>/<project>/`, `editor/<projectKey>/components/`, `_shared/editor-components/` — and a fingerprint that missed one would yield a false cache HIT, i.e. the same stale-data bug in subtler form. **Do not raise the TTL without a real source fingerprint.**
- **A stale fallback is now visible to AUTHORS** — `?ie_authoring=1` (added only by the launcher's own launch links, never by the published/copied URL) shows a red banner when the game falls back to baked data. `window.__IE_RUNTIME_STALE__` is set for every boot regardless.

**Reskin / template games work today:** background, scenery, HUD, free-spin intro/counter/outro, loading splash, board position/shape/spin-feel, fonts, localized text, and per-instance prefab art are all doc + R2-driven.

## Open items / next
1. **Phase 2 — config from R2.** `config.ts`/`constants.ts`/paytable/winLevelMap/infoManifest still compile per app; move to R2 JSON + loader so per-game math/symbols/geometry change without a rebuild. Until then a published game runs its runtime's default math.
2. **Phase 3 — more game-types.** Publish currently maps **every** project to the only prebuilt runtime (`lines`); `ways`/`cluster`/`scatter`/`bookOf` need their own prebuilt bundle + a `gameType` runtime switch (engine gap 1 — `gameType` is an editor hint only today).
3. **Phase 4 — behavior tracks (the long pole).** Novel per-event animation is still per-game TypeScript (`bookEventHandlerMap.ts`); the declarative `tracks?: BehaviorTrack[]` format + interpreter + versioned vocabulary is a multi-quarter engine project, own design doc.
4. **Widen Publish beyond admin** to `developer` (deliberate later decision).
5. **Runtime-mode localization** — i18n inits at module-eval, before the live bundle fetch, so the runtime string merge is not yet wired.
6. **Stop exporting on the runtime READ path** (the durable fix for the 17-19s assemble; the cache above only collapses bursts). Exports belong on save/publish — `publishGame.ts` already calls `ensureDeployExports`. Needs an audit that every authoring tool exports reliably on save before the read path can trust `deploy/`. The new per-exporter timing line (`[runtime] assembled "<project>" — art=… symbols=…`) is the data for it: check Railway logs for which of the seven dominates.

## ⏳ Live-verify
- On-screen Pixi render / boot-order timing for the runtime boot is owner-confirm only (headless gate PASSED).
- Publish pin fix: rebuild a non-active project → selection lands on it (owner verify owed).

## Recent changes
- 2026-07-17 — `/api/editor/runtime` single-flight + 10s cache + game-side retry + author-only stale banner + per-exporter timing logs. Root-caused from "a duplicated FX node only shows once in the game": the node had saved and published correctly — the game had never received the live doc, because the endpoint 502'd and fell back to baked data silently ([detail in history](../history.md))
- 2026-07-02 — Publish now pins the session to the project it built (`setActiveProjectKey`) ([detail in history](../history.md))
- 2026-06-26 — fixed the runtime symbol-map boot-order race (online game rendered template symbols, ignoring authored Symbols State Machine bindings); shared `_runtime/lines` bundle republished ([detail in history](../history.md))
- 2026-06-16 — Phase 0 generic-runtime boot live (`/api/editor/runtime`, `?runtime=1`, path-form asset serving); headless gate vs `test1` PASS ([detail in history](../history.md))
