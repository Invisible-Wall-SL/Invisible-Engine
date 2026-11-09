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

1. **Twin sheets keep their logical size** — BUILT (launcher, 2026-11-09). `ktx2SheetTwin.ts` is
   the one place a twin sheet is derived (editor-art and symbol exports both call it): rects
   rescaled, `meta.scale` = the page ratio, borders kept logical. Guard:
   `apps/launcher-api/ktx2SheetTwin.fixture.ts` parses both through Pixi's own `Spritesheet` and
   fails a twin written the old way.
   Not covered: a **standalone image** (a dropped page) over 4096 px still loads its twin at the
   smaller size — the page store does not record the source's dimensions, and recording them means
   bumping `KTX2_ENCODER_REVISION`, which re-encodes every project's pages. Phase 3 records them
   anyway (a tier needs the ratio), so it lands there. A 3840×2160 background is under both caps and
   is not downscaled.
2. **A 4K canvas works end to end.** Measure, don't assume: boot one game with a 3840×2160 Canvas
   Size in the editor and the runtime, and fix whatever is still laid out in 1920 units (coded HUD
   fallbacks, reference layouts, component defaults, font defaults). Add an editor action that
   rescales an existing layout to a new Canvas Size (positions, sizes, font sizes, overrides), so a
   1080p game can become a 4K one and a 4K reference can be seeded. Check `renderTier`'s
   `maxResolution` (2) on the cabinet's GPU and density.
3. **Publish writes resolution tiers.** Between pull and 🗜 Optimize, write each page at the tiers
   the game asks for — `full` (the master), `half`, and `mobile` (half, KTX2) — each with its own
   sheet JSON through `ktx2SheetTwin`'s rule and its own KTX2 twin, plus the source dimensions the
   standalone-image case needs. The 4096 cap must never shrink the `full` tier's WebP/PNG page.
4. **The runtime picks a tier.** Online: the smallest tier covering `box × fit scale × dpr`, the
   same seam as `?quality=auto` (`preferCompressedTextures`), with `?tier=` to force it. A cabinet
   build pins `full` through a delivery profile (`arcade-4k`), which can also carry kiosk/fullscreen
   and the full render tier.
5. **Video flipbooks and FX get tiers** (one encode per tier; particle art rides the sheets).

## Constraints to keep

- A game that never opts in must render exactly as before. Phases 2–4 are engine changes: a merge
  to `main` releases them to every online game, so each one lands with a current-games pass.
- 4K art is about 4× the memory of 1080p art. Phones must never load the `full` tier.
- The arcade FAMILY is refused by 📦 Deliver (`scripts/delivery-family-gate.mjs`); a cabinet
  running an arcade-family game goes through ☁ Publish, or that gate is lifted on its own.
