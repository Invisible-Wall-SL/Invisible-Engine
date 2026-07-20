# Invisible Flipbook — status

> Design: [docs/design/invisible-flipbook.md](../design/invisible-flipbook.md) · Guide: _not written yet (ships with the `/flipbook` route, rule 9)_ · Agent: _none yet — use `engine-pixi-svelte` + `atlas-python-tools`_

**One-line state:** Foundations only. The doc schema, canonicalizer, and clip registry are on `main` with offline fixtures; **no consumer is wired, so nothing renders yet**. The `/flipbook` tool itself is unbuilt.

## Current state
Live on `main` (steps 1–3 of the design doc's build plan):

- **`packages/engine-flipbook`** — `FlipbookDoc` / `FlipbookClip` types + `normalizeFlipbookDoc`, mirroring `engine-fx`. Deliberately dependency-free so it stays Node-resolvable for fixtures. `registerFlipbooks` / `resolveFlipbook` live in `engine-layout` beside `registerEffects` / `registerRigFx` (same module-scoped `Map`, same latest-wins).
- **`tools/flipbook-spike`** — offline fixtures (`run doc`, `run registry`), since the launcher build is not a type check. Assert frame order survives verbatim, duplicate frames are kept (a held frame), a bad fps falls back to the default, normalization is idempotent, and a dangling `clipId` resolves to `undefined` rather than throwing.
- **FX flipbook honesty fix** — `bindArt` no longer emits a dead `loop: true` alongside `framerate: -1` (the library coerces it to `false`, so flipbook particles have always played once per lifetime, contrary to the old doc comment). Both fx-spike fixtures now assert `loop` stays absent. **Not a behaviour change** — making looping real would silently restyle every authored effect in a shipped game.
- **Dangling FX frame names are now reported** — `editorArtExport` counts a layer's `art.frames[]` as used regions, so a renamed/deleted region shows up in `index.missing`. Previously invisible at every stage, degrading to `EffectLayer` dropping frames or `ParticleEmitter` binding the whole sheet.
- **Sheet Maker natural ordering** — upload order drives region order drives manifest order, which the clip editor reads; see [sheet-maker status](sheet-maker.md).

## Open items / next
1. **Step 4 — build the `/flipbook` tool.** Region picker, ordered frame list with drag-reorder, fps + loop, live scrub preview. Reads region sets via `loadRegionSet`; reuse `/fx`'s atlas-slicing preview (`framesToTextures`). Registry entry + `docs/tools/flipbook.md` in the SAME change (rule 9).
2. **Step 5 — runtime playback seam.** Resolve a clip's ordered frames to textures and feed `AnimatedSprite` (which works but has **zero call sites** today). Editor-art registers as `sprites` (flat map), so resolve frame-by-frame via `editorArtTextureKey` rather than relying on `spriteSheet`'s ordered array.
3. **Step 6 — consumers**, ascending risk: FX (`clipId?` on `EmitterArt`) → Symbols (widen `symbolCellSchema.type`) → Scene Editor (`FlipbookNode` in the `LayoutNode` union). **Owner has not yet picked whether Symbols or Scene Editor comes first.**
4. **Step 7 — export/bake/pull/register wiring** (rule 8). Clip frames must become real refs and the bake must `bail()` on a dangling one, not warn.
5. **Rename-repair hint is unconfirmed** — `src` survives a rename, but `sheet_session.json` is one open sheet's working state, so per-sheet durable recovery of `src` must be verified before the tool promises "did you mean…".

## Blocked (owner / external)
- Nothing flipbook-specific. Note `main`'s launcher build is red for an unrelated reason (`symbols/+page.svelte` imports `builtinSpineKey` / `hasBuiltinSpine`, absent from `editorSpine.client.ts`) — being handled separately, but it blocks build-verifying any launcher-side flipbook work.

## Recent changes
- 2026-07-20 — sheet-tool natural sprite ordering (`d7107f4`).
- 2026-07-20 — `FlipbookDoc` schema, canonicalizer, clip registry + fixtures (`54e3e25`).
- 2026-07-20 — dangling FX frame names reported at export (`ee3073a`); dead `loop` flag dropped from the flipbook art binding (`3bf16aa`).
