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
  (Pixi's default is an external CDN — forbidden). The `libktx.{js,wasm}` files are vendored
  INTO the engine package (`pixi-svelte/src/lib/transcoders/ktx/`) and imported via Vite
  `?url`, so they emit into every consuming build's own `_app/immutable/assets/` with a
  correct base-aware URL — reaching standalone game builds too (whose `static/` comes from
  the game repo, NOT the engine, so a `static/` file + `document.baseURI` would 404 there).
  `config-vite` excludes libktx from its `assetsInlineLimit: Infinity` single-file inlining so
  the transcoder stays a real, lazily-fetched file (a Worker's `importScripts()` rejects the
  `data:` URI an inlined asset becomes; the runtime also defensively converts any `data:` URL
  to a `blob:` one). `apps/lines/src/editor-scenes.ts` `bakedEditorArtAssets()`
  registers the `ktx2Json`/`ktx2` variant unless `?quality=high`, keying the loadedAssets
  entry off the WebP path so lookups are tier-identical.

## Adaptive quality tier

ONE build serves every device. `editor-scenes.ts` `preferCompressedTextures()` auto-detects:
**iOS** (WebKit's per-tab memory cap is the whole reason this exists) **or low `deviceMemory`
(≤4 GB)** → load the compressed KTX2 variants (4× less VRAM, **same resolution**); everything
else (Samsung, desktop, **arcade/kiosk**) → the uncompressed full-res originals (best quality).
`?quality=high` / `?quality=low` force it. So the low/high split is **compressed vs uncompressed
at full resolution**, not a resolution cut — arcade keeps pristine art, iPhone fits in memory.
KTX2 is encoded **without mipmaps** (a 2D game draws near 1:1; mips add ~33% VRAM + transcode
cost) — `ktx2Encode` takes a `mipmaps` opt for a future downscale tier.

## Spine / rig atlases (the dominant VRAM)

The rig/spine atlas pages — NOT the editor-art sheets — are the bulk (~490 MB in the remake,
dominated by full-screen backgrounds/UI used as rig atlases). `spine.ts` `exportSpineBundle`
encodes a `.ktx2` twin of each atlas page and writes a second `.atlas` whose page-name lines
point at the twins (region coords unchanged — same page dimensions); carried on
`ExportedSpineEntry.ktx2Atlas`. Spine's own atlas loader loads each page via `loader.load({src})`
**by extension**, so a `.ktx2` page routes through our KTX2 loader with no spine-runtime change.
The game swaps `atlas`→`ktx2Atlas` on the compressed tier (`bakedEditorArtAssets` spine loop).

## Automatic downscaling (no manual resize)

`ktx2Encode` auto-downscales the COMPRESSED variant so its longest side ≤ `DEFAULT_MAX_DIMENSION`
(4096 — clears the encoder's ~12 Mpix cap AND every iPhone GPU's `MAX_TEXTURE_SIZE`) and returns
the encoded dimensions. Pages ≤4096 ship at full resolution; only larger ones (e.g. a 4096×8096
cinematic → 2072×4096) shrink — **in the pipeline, so no source art is touched**. Callers rescale
the matching coords by the same factor: `toTexturePackerJson(set, file, sx, sy)` for sheets, and
`rewriteAtlasForKtx2` for spine (page-aware: rewrites each downscaled page's `size:` line + rescales
its region `bounds`/`offsets`/`orig`/… — uniform scale, so rotated regions stay correct; UVs are
unchanged so art renders at the same size, just lower-res). Verified on the real `R_Cinematic1` rig
(all coords stay in-bounds). Spine attachment sizes come from the SKELETON, not the atlas, so a
downscaled rig page renders at the authored world size regardless — the reason this is safe.

## Rollout

1. Set `KTX2_ENCODE=1` on the launcher; re-bake + pull + Runtime release + republish +
   admin Reconcile the remake (`reference_runtime_release`,
   `gotcha_online_remake_stale_until_republish_reconcile`).
2. The transcoder ships automatically with the engine bundle (Vite `?url`) — no static-file
   step. It only needs a fresh build of the game so the emitted `libktx.*` assets are present.
3. Verify: Browser-pane memory walk (five 32 MB pages → ~4–8 MB each), then a clean load on
   the affected iPhone (iOS 18+) and Pixel.

## Page dedup (the over-time leak fix)

The rig/spine atlas pages were the dominant VRAM, and worse, each rig carried its OWN copy of
its page — the same full-screen image (`S_Game_UI2` → R_SpinButtonNew + R_Turbo + R_Auto + the
sheet) loaded as 3–4 separate 32 MB textures, and MORE loaded as features mounted over play, a
monotonic climb that OOM-crashed iOS after a while (confirmed live: `managedTextures` grew
25→41). `pageStore.ts` is a **content-addressed page store**: `PageStore.ensure(sourceKey, ext)`
writes each unique page (keyed by source ETag+size) ONCE to `deploy/_pages/<hash>.{webp,ktx2}`
and every sheet/rig references it by the base-independent relative path `../../_pages/…`
(verified to resolve through Pixi's `path.normalize` + the spritesheet loader, baked + runtime).
So a page shared by N rigs + the sheet becomes ONE GPU texture. `editorArtExport.ts` (sheets +
standalone images) and `exportSpineBundle` (rigs, via a shared `pageStore` param) both dedup
through it; `symbolExport` omits the store and keeps its per-bundle copy. A downscaled shared
ktx2 page reports its dims so every referencer rescales coords by the SAME factor (composes with
#179). Content-cached (skip-if-exists, meta sidecar) so the per-boot `/api/editor/runtime`
assemble stays fast; `_pages/` is pruned against `pageStore.written`.

## Follow-ups

- Symbol spine pages already ride `exportSpineBundle` (so they get `ktx2Atlas`), but
  `bakedSymbolAssets()` doesn't yet SELECT it — wire the tier there too (they're smaller than
  the rig backgrounds, so lower priority). Symbol bundles also don't dedup (no `pageStore`).
- Optional per-device RESOLUTION downscale tier (encode a smaller ktx2 variant + scale atlas
  coords) if compression-at-full-res ever isn't enough for a very low-memory device.
- Isolate the encode in a worker/child process (non-blocking + memory-isolated + stdout
  captured) so it's safe to run inline on the shared launcher without the OFF default.
