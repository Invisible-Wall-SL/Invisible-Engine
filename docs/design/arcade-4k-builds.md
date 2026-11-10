# 4K arcade builds — one master, smaller tiers

> Status: [status/engine.md](../status/engine.md) and [status/launcher.md](../status/launcher.md)
> hold what shipped; this file is the plan. Related: [gpu-compressed-textures](gpu-compressed-textures.md)
> (the KTX2 twins this builds on), [delivery-builds](delivery-builds.md) (the profile a cabinet
> build pins), [games-deploy](games-deploy.md).

## Goal

Author a game once for a 4K (3840×2160) arcade cabinet and publish:

- a **4K build** that keeps the art at full resolution, and
- **smaller builds** for desktop and mobile that carry fewer pixels but lay out identically.

## Decision: author in master pixels, ship lower resolutions as Pixi resolution

A game's layout units ARE its master art's pixels. A 4K game sets its Scene Editor **Canvas Size**
to 3840×2160 and uses art made at that size; everything authored in pixels (positions, node sizes,
art boxes, 9-slice insets, clip boxes, rig boxes) is then in one space, with nothing to convert.
`createLayout` already fits any box to any window (`scale = min(w/box.w, h/box.h)`), so a 3840 box
on a 1080p desktop draws at 0.5 and on the cabinet at 1.

A lower tier ships the SAME frames over a smaller page and declares the ratio as the texture's
resolution — `meta.scale` on a TexturePacker sheet, `data.resolution` on a standalone image. Pixi
divides every coordinate by it, so a half-size page still lays out at the master's logical size.
Rigs need nothing: an attachment is sized in skeleton units, so a smaller atlas page only lowers
its pixel count. Bitmap text draws at its authored `fontSize` whatever the glyph page's size.

**Rejected: an `artDensity` setting with layout kept at 1920×1080.** It was the first proposal, and
reading the code killed it: pixel geometry is authored in at least six places (region and clip
boxes, slice insets, rig boxes, part skins, natural sizes) and every one of them, in the editor AND
the runtime, would need dividing by the density, with each missed one a silent misplacement. The
master-pixel model needs none of that, and it is the same mechanism the KTX2 twin already needed.

## The mechanism already existed — and was wrong

The KTX2 twin of a page over 4096 px (or ~11 Mpix) is downscaled by the encoder. Its sheet JSON
rescaled every rect onto the smaller page but wrote `meta.scale: '1'`, so on the compressed tier
(phones) a frame drawn at its natural size came out smaller, and its 9-slice corners thinner.
Explicitly sized nodes, cover-fit backgrounds and contain-fit symbols hid it. With 4K masters most
pages cross 4096, so this had to be fixed first: it is Phase 1.

## Phases

1. **Twin sheets keep their logical size** — BUILT (launcher, 2026-11-09). `sheetOnPage.ts` is
   the one place a twin sheet is derived (editor-art and symbol exports both call it): rects
   rescaled, `meta.scale` = the page ratio, borders kept logical. Guard:
   `apps/launcher-api/sheetOnPage.fixture.ts` parses both through Pixi's own `Spritesheet` and
   fails a twin written the old way.
   Not covered: a **standalone image** (a dropped page) over 4096 px still loads its twin at the
   smaller size — the page store does not record the source's dimensions, and recording them means
   bumping `KTX2_ENCODER_REVISION`, which re-encodes every project's pages. Phase 3 records them
   for a project with tiers (`ktx2Resolution` on the image entry); the runtime reads it in Phase 4.
   A 3840×2160 background is under both caps and is not downscaled.
2. **A 4K canvas works end to end** — BUILT (editor, 2026-11-09). Measured first:
   `scripts/playtest/canvas-scale-probe.mjs` boots the built runtime with a reference layout and
   with it ×2, and compares pixels. What it found:
   - The runtime already fits any box. A `standard` screen (the HUD bar) uses the layout profile's
     bucket box, so a 4K project needs those boxes at 4K as well as its Canvas Size.
   - A `canvas` screen without `scaleWithWindow` is window pixels, and a `background` screen
     cover-fits the window: neither depends on the canvas, so neither is rescaled.
   - The only 1920-unit part left is the coded fallback board, used when a layout has no
     `reelGrid` (the plain lines/ways/cluster/scatter references). It is NOT changed: making it
     follow the canvas would move every current game whose box drifted from its coded box. A slot
     rescaled to 4K needs a Reel Grid, and the editor says so.
   - Result: the Book-of reference ×2 matches to 0.25–0.53% (real-clock animation and HUD-clock
     noise); the lines reference (coded board) differs by 11–13%.

   The editor's **Rescale canvas…** (Canvas Size panel) runs `engine-layout` `rescaleCanvas`:
   boxes and profile boxes multiply, each top-level node of a canvas-unit screen moves and scales
   (children keep their numbers), and a reel grid's nudge and a screen's world/camera/guides
   multiply. Scaling nodes rather than rewriting every pixel field is exact for the art a project
   has; when art is re-made at the new size, a natural-size node's scale goes back to 1.
   Still open: the arcade family (world, camera, spawn layers, tilemaps) is covered by the fixture
   but not booted by the probe; `renderTier`'s `maxResolution` (2) on a real cabinet GPU.
   `determinism-proof.mjs` does not boot on Windows (the hook holds the loading screen), which is
   why the probe uses a real clock.
3. **Publish writes resolution tiers** — BUILT (launcher, 2026-11-09). Opt-in per project:
   `LayoutDoc.resolutionTiers: ['half']`, ticked in the Scene Editor's Canvas Size panel ("Also
   publish half-resolution art"). A project that has not ticked it writes exactly what it did, and
   the assemble costs it one extra small read (the doc).
   - `PageStore` writes each shared page's half copy (`_pages/<hash>@half.webp`, resized with sharp
     and re-encoded near-lossless like every shared page) and its own KTX2 twin, cached by a
     `<hash>@half<variant>.meta.json` sidecar that also records the source's size. The first
     assemble after ticking pays a resize and an encode per page; later ones one small GET each.
   - Sheets (editor art, symbols): `tierSheets` writes `<stem>.<v>@half.json` and
     `@half.ktx2.json` through `sheetOnPage`, so they lay out like the full sheet; the index entry
     gains `tiers.half: { json, ktx2Json? }`.
   - Standalone images: `tiers.half: { file, resolution, ktx2?, ktx2Resolution? }`, and the full
     KTX2 twin's `ktx2Resolution` when the encoder downscaled it.
   - Rigs (`exportRigBundle`, through a store only): `<atlas>@half.atlas` and `@half.ktx2.atlas`,
     each page renamed to its copy with its region coords rescaled (the KTX2 atlas rewrite); a
     page with no copy keeps its full page. The entry gains `tiers.half: { atlas, ktx2Atlas? }`.
   - Pull mirrors `_pages/` and the export folders whole, and 🗜 Optimize only removes unreferenced
     same-name PNG/WebP pairs, so the tier files ship with no change to either.
   - The game picks a tier since Phase 4. A desktop or delivery build of a ticked project carries
     both tiers (about +25% page bytes); leaving out the one a pinned build never loads is open.
   - Guards: `apps/launcher-api/scripts/check-resolution-tiers.ts` (the real store, resize, Basis
     encode and rig export over an in-memory R2: parity with no tiers, half sizes, twin, cache, half
     atlases), `apps/launcher-api/sheetOnPage.fixture.ts` (tier sheets lay out like the full one,
     image resolutions), `check:doc-readers-unknown-fields` (the doc keeps the switch, drops an
     unknown tier id).
4. **The runtime picks a tier** — BUILT (engine, 2026-11-09). `apps/lines/src/game/artTier.ts`
   `chooseArtTier`: the art's on-screen scale is the window's fit of the canvas box (the box of the
   window's bucket, as `createLayout` picks it) times the device pixel ratio capped by the render
   tier; the smallest tier still covering it wins, else `full`. Decided once at boot, before art
   registers; `?tier=full|half` forces it. A 4K game: full on a 4K cabinet and a 1440p desktop,
   half on a 1080p desktop and a phone; a 2× iPad in portrait shows it at 71% and keeps full. A game
   with no tiers has nothing to pick, so every entry falls back to its full files (parity).
   - `editor-scenes.ts` registers each sheet, image and rig from its tier entry when it has one
     (`sheetSrc` / `imageSrc` / `rigSrc`), the KTX2/WebP choice unchanged on top; an image carries
     the resolution its file loads at, and so does a downscaled full KTX2 image (`ktx2Resolution`,
     the Phase 1 gap).
   - `pixi-svelte`: `Asset.resolution` / `fallbackResolution` load a `sprite` with
     `data.resolution`, and give it a texture of its own framed by the source's logical size —
     Pixi's cache may hand back a texture made before a shared page's resolution was set.
   - No delivery-profile pin: the profile resolves after the art registers (a `config.json` fetch,
     awaited at authenticate), and the automatic rule already picks `full` on a 4K screen. A build
     flag can be added if a cabinet ever needs one.
   - Guards: `apps/lines/src/game/artTier.fixture.ts` (the rule on real device sizes) and
     `scripts/playtest/art-tier-probe.mjs`, which boots the built runtime with a synthetic 4K sheet
     and image published as tiers: auto in a 1280×720 window fetches only the `@half` files,
     `?tier=full` only the full ones, the two pictures match to 0.29%, and the half image with its
     resolution removed (the control) differs by 16%.
5. **Video flipbooks and FX** — CLOSED (2026-11-09): nothing to build, measured rather than
   assumed. Every class of art that reaches a game was walked:
   - **Video** never ships. A render is an authoring artifact (`invisible-flipbook-video.md`
     "Storage"): it becomes a packed sheet and a clip, and the runtime has no video path at all.
   - **Flipbook clips** resolve their frames through the same `loadedAssets` keys a tier sheet
     registers (`engine-flipbook` `resolveClipFrames`), so they draw from the tier the sheet loaded.
     `art-tier-probe.mjs` plays one over a tiered sheet: half and full draw it the same size.
   - **FX** particles take their textures from `loadedAssets` too (`EffectLayer` → `engine-fx`
     `bindArt`), and a baked effect ships as sheet frames, so both ride the sheet tiers.
   - The effect, flipbook, rig-flipbook, rig-FX, shader and cinematic exports write no image bytes
     of their own; every page goes through `PageStore` (sheets, images, rigs).
   - **Not tiered, on purpose:** bitmap-font pages (`fontExport` copies them verbatim — a font is
     a page or two, and a half font would mean rescaling every glyph metric of its descriptor) and
     the boot splash (a private ~1 MB copy that paints before the bundle, `check:page-store-shared`).
     A 4K game should bake its bitmap fonts at its own size, which the phone then downsamples.

## One-screen builds — BUILT (2026-11-10)

A desktop or delivery build of a project with tiers carried both copies of every page, though a
build made for one kind of screen only ever loads one. `IE_ART_TIER=full|half` pins it — one
variable for both halves, so the art a build ships and the tier it loads cannot disagree:

- **The game** (`config-vite` `artTierPin.js`): compiled in as `__IE_ART_TIER__`, which
  `chooseArtTier` obeys over its screen rule AND `?tier=` — a pinned build has no other tier's
  files, so the query must not be able to ask for them. A bad value fails the build.
- **The pull** (`pull-project-assets.mjs`, also `--art-tier`): leaves the other tier out of
  `static/assets/`, never downloading it, and deletes a copy an earlier pull left. Pairs are read off
  the names (`@half` inserted into the full file's name). `full` drops every `@half` file; `half`
  drops each full file that has a half copy. A file a KEPT sheet or atlas still names is fetched and
  kept anyway (a rig's half atlas keeps any page that had no half copy); an export's `index.json`
  does not count, because it lists every tier and the game never loads it (the bake embeds the index).
  The log and `pull.json` (`artTier.notPulled`) say what was left out and its size.
- **The desktop launcher** (v1.0.65): each project card's **Art: Auto / Full / Half** picker sets
  it for ☁ Publish and 📦 Deliver (`invisible-launcher` `verify_art_tier.py`).
- **A delivery**: `build-delivery.mjs --art-tier full|half` adds it to the build env and to
  `--print-env`. Deliberately not a delivery-profile field: a profile describes the operator's RGS,
  and the same one can go to a cabinet or a phone.
- Unset (every online game, every build that does not ask) changes nothing.
- Guards: `apps/launcher-api/scripts/check-art-tier-pin.mjs` (the tier list against
  `RESOLUTION_TIERS`, the compiled pin, the drop rule, and a pull against a fake `/api/deploy`:
  pinned half never fetches a full copy that has a half one but keeps the page a half atlas names,
  pinned full removes a stale half copy, a bad value refuses before fetching); `artTier.fixture.ts`
  §7 (the pin beats the screen and `?tier=`); `art-tier-probe.mjs --pinned-build` (a build made with
  `IE_ART_TIER=full`, opened with `?tier=half` in a small window, loads only full files).

## Still open

- After art is re-made at 4K, the nodes drawn at their art's natural size need their scale set back
  to 1 by hand; a one-click "art is now ×2" reset in the Scene Editor would do it.
- Nothing yet ran on a real 4K cabinet or a real phone.

## Constraints to keep

- A game that never opts in must render exactly as before. Phases 2–4 are engine changes: a merge
  to `main` releases them to every online game, so each one lands with a current-games pass.
- 4K art is about 4× the memory of 1080p art. Phones must never load the `full` tier.
- The arcade FAMILY is refused by 📦 Deliver (`scripts/delivery-family-gate.mjs`); a cabinet
  running an arcade-family game goes through ☁ Publish, or that gate is lifted on its own.
