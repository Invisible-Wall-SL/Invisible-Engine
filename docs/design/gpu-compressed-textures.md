# GPU-compressed textures (KTX2) + quality tiers

## Problem

Shipped atlas PAGES are WebP/PNG that the browser decodes to **full RGBA in VRAM**: a
2048×4096 page = 32 MB. The Book of Borut remake holds ~160 MB in just five
background/UI pages (measured live: `S_Game_Background`, `S_Game_UI`, `S_Game_UI2`,
`S_Game_UI2_2`, `S_Game_Freespin`), before spine symbol atlases. That exceeds iOS
Safari's per-tab memory ceiling, so the WebContent process is jettisoned ("A problem
repeatedly occurred") — the game runs (buttons/sound/flow) but the canvas is dead.
Desktop and Samsung survive on headroom. (Renderer is already WebGL — PR #169 — this is
memory, not the backend.)

## Approach

Ship **KTX2 (Basis Universal, UASTC)** twins of large pages. KTX2 stays compressed into
VRAM — the loader transcodes per-device to ASTC/ETC2/BC — cutting texture memory **4–8×**
at the SAME resolution. One `.ktx2` is universal (transcodes on any WebGL2 device), so no
per-device page variants. A `?quality=high` tier opts high-memory targets (arcade / kiosk)
back into the uncompressed full-res pages.

**Fail-safe / parity:** every hop degrades to today's WebP/PNG when a KTX2 twin is absent
(un-encoded project, encoder off, page skipped) or when `?quality=high` is set.

## Pipeline (produce → carry → load)

- **Encode** — `apps/launcher-api/src/lib/server/ktx2Encode.ts` wraps `ktx2-encoder`
  (bundles the Binomial `basis_encoder.wasm`; runs in Node). `encodePageToKtx2(bytes)`
  decodes via `sharp` → raw RGBA, encodes **UASTC q1 + Zstd + mipmaps** (validated sweet
  spot: ~9 s, ~3.5 MB, ~345 MB peak for a 2048×4096 page). Returns null (→ ship WebP) when
  a page is < 1 Mpix, > 12 Mpix (encoder hard cap — we don't downscale, it would desync
  atlas frame rects), or on any failure. stdout is silenced (the wasm spams per-slice).
- **Export funnel** — `editorArtExport.ts` `exportManifest()` / images loop: after the
  verbatim page copy, `encodeSheetKtx2(...)` writes a `.ktx2` page + a SECOND spritesheet
  JSON whose `meta.image` points at it (identical frame rects), recorded as
  `EditorArtSheet.ktx2Json`. Standalone images get a `.ktx2` twin + `EditorArtImage.ktx2`
  (single texture — no JSON). Gated by **`ENV.KTX2_ENCODE`** (default OFF — encoding is
  CPU/memory-heavy and blocks the loop; enable deliberately per bake, verify launcher RAM).
- **Transport** — unchanged: `bake-editor-doc.mjs` embeds the index, `pull-project-assets.mjs`
  mirrors every `deploy/` byte, `runtimeBundle.ts` carries the same `EditorArtIndex`. The new
  `ktx2Json`/`ktx2` fields ride along.
- **Load** — `pixi-svelte/InitialiseApplication.svelte` registers Pixi's KTX2 loader
  (`import 'pixi.js/ktx2'`) and **self-hosts the transcoder** via `setKTXTranscoderPath(...)`
  pointing at vendored `static/transcoders/ktx/libktx.{js,wasm}` (Pixi's default is an
  external CDN — forbidden). `apps/lines/src/editor-scenes.ts` `bakedEditorArtAssets()`
  registers the `ktx2Json`/`ktx2` variant unless `?quality=high`, keying the loadedAssets
  entry off the WebP path so lookups are tier-identical.

## Quality tier

`?quality=high` → uncompressed full-res (arcade/kiosk); default/absent → compressed KTX2
when available. Read canonically via `state-shared/stateUrl.svelte.ts` `quality` getter, and
raw (`URLSearchParams`) in `editor-scenes.ts` `preferCompressedTextures()` for the import-time
builder path. The high tier is generic (no arcade-platform assumption baked in yet).

## Rollout

1. Set `KTX2_ENCODE=1` on the launcher; re-bake + pull + Runtime release + republish +
   admin Reconcile the remake (`reference_runtime_release`,
   `gotcha_online_remake_stale_until_republish_reconcile`).
2. Ensure `static/transcoders/ktx/` ships in the deployed game static (vendored in
   `apps/lines/static`, which the shared `_runtime/lines` bundle is built from).
3. Verify: Browser-pane memory walk (five 32 MB pages → ~4–8 MB each), then a clean load on
   the affected iPhone (iOS 18+) and Pixel.

## Follow-ups

- Symbol pages (`symbolExport.ts` / `bakedSymbolAssets()`) — mirror the editor-art path once
  proven; they're the next-largest VRAM consumer after backgrounds/UI.
- Isolate the encode in a worker/child process (non-blocking + memory-isolated + stdout
  captured) so it's safe to run inline on the shared launcher without the OFF default.
- Consider `quality=high` also selecting a higher-res source pack once the arcade target
  is chosen.
