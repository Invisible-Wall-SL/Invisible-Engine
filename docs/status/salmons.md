# Salmons (arcade reference project) — status

> Plan: [design/game-families.md](../design/game-families.md) §1 (Salmons and its art pass, S0), §4.3–§4.5, P10.16, §9 #28 · Online rooms: [design/realtime-multiplayer.md](../design/realtime-multiplayer.md) · The art pass's own guide: `docs/art-pass.md` in `GuiltyForever/Salmon-` · The sample it builds on: [playtest/arcade-sample.md](../playtest/arcade-sample.md) · Agents: `atlas-python-tools`, `invisible-flipbook`, `invisible-fx`, `invisible-components`, then per phase

**One-line state:** the owner approved the art pass (S0) on 2026-10-26. Its groundwork was
already done in the Salmon repository: the art is in the pipeline's formats, and the look and the
recipes are written down. What is left is generating the 22 character clips in the launcher's
tools. None has been generated yet.

## Current state

- **The Salmons that players reach today is not built from this repository.** It lives in
  `GuiltyForever/Salmon-` (a Colyseus 0.15 server and a PixiJS client) and deploys from there.
  Nothing merged here changes it until P10.16 rebuilds it on the shared runtime and moves its
  players over.
- **S0's groundwork, in the Salmon repository** (`main` 41811c2, read 2026-10-26; its
  `docs/art-pass.md` owns the detail):
  - the original images are kept untouched in `art/source/legacy/` (16 files);
    `scripts/build-sheets.py` packs them with the Atlas Maker's own packer into `terrain`,
    `props` and `characters` sheets (TexturePacker JSON) and a FlipbookDoc `clips.json`, so a
    sheet or clip exported from the pipeline drops in;
  - the look is fixed: 2:1 isometric, painted cartoon with dark outlines, sizes on screen, frames
    generated at about 4×, a bottom-centre anchor, real transparency;
  - facings: four diagonals, drawn south-east and north-east and mirrored for the west;
  - the client already plays clips named `<character>_<state>_<facing>` as soon as they exist
    (`client/rendering/characterLook.js`), falling back to the old drawings until then;
  - recipes: Atlas Maker `gpt_image` stills with the current art as the style reference and a
    BiRefNet cutout, then Flipbook 🎬 Video with `wan22_i2v_flipbook`, then download through the
    FTP Browser into `art/imported/` and rebuild;
  - `art/imported/` is empty: no clip has been generated.
- **The `salmons` portal project** (client `invisible_wall`), read from R2 on 2026-10-26
  (read-only): one test background from 2026-06-02 (`Background_Test_1`), an empty scene list, no
  strings, and a Flow doc that is the **Book-of template's** (`templateId: bookOf`). It was made as
  a slot project, so it has none of the arcade scaffold. Nothing is published. None of the Salmon
  repository's sheets is in it: that repository builds them locally.
- **The two design docs' disagreement is settled:** realtime-multiplayer §2 item 4 is right that
  the art is in the pipeline's formats; game-families §1 now says what is left.

## Open items / next (S0)

1. **Generate the 22 character clips** in the project `salmons`, following the Salmon repository's
   `docs/art-pass.md` recipes: `salmon_pink` and `salmon_golden` (`swim`, `hop`, `caught`), `bear`
   (`idle`, `walk`, `swipe`), `fisherman` (`idle`, `walk`, `cast`, `reel`), each `_se` and `_ne`.
   The salmon (drawn side-on) and the bear (drawn from above) matter most; they are the off-angle
   ones. The golden salmon may be the pink one recoloured with a `_colour` FX layer.
2. **The arcade sample's four sprites** (§9 #6), for a result in the shared runtime: the salmon,
   bear, hook and fish stills from item 1 and the props sheet, re-skinning `arcadeSalmon` /
   `arcadeBear` / `arcadeHook` / `arcadeFish` and sizing the config bodies to the art
   ([status/game-families](game-families.md) open item 11). This needs the `salmons` project to
   become an arcade project (below).
3. **Lower priority, from the art pass's list:** the bridge pieces (generated placeholders today)
   and drawn tiles for the riverbed, water surface and sea (drawn in code today; the Salmon client
   needs a small change to use them).
4. **Back into the Salmon repository:** each generated sheet and clip is downloaded into
   `art/imported/` and `build-sheets.py` re-run, so today's game shows the new art before the
   rebuild.

Shipping (rule 8): atlases, clips and effects already travel export → deploy → bake → pull →
register. Tiles and characters get their chains in P10.13 and P10.11. S0 adds no asset class.

## Decided (owner, 2026-10-26)

- **Models:** licence-clean only. The art pass's recipes already are: `gpt_image` (clear), a
  BiRefNet cutout instead of the default RMBG-2.0, and Wan 2.2 for video
  ([model-licences](../reference/model-licences.md)).
- **Project:** the `salmons` project is reused for the rebuild, replacing what is in it. The
  original game stays safe in its repository.
- **Facings:** a per-game option, 4 or 8 (game-families §9 #28). Salmons draws 4.

## Blocked (owner / external)

- **The generation runs in the launcher's tools** (ComfyUI on RunPod, through the Atlas Maker,
  Flipbook and FX). They are pages behind the launcher's sign-in, and a cloud session has no
  launcher account, no R2 write and no ComfyUI. Items 1–3 need a person at those tools.
- **Turning `salmons` into an arcade project** is a launcher action: `/admin`'s per-project kind
  picker, then a re-scaffold. Its Book-of Flow and scenes are replaced. Check that the
  re-scaffold writes the arcade scaffold over them (it writes some docs only when absent) before
  relying on it.

## Recent changes

- 2026-10-26 — **Step 0 done: read the Salmon repository and recorded the owner's three choices.**
  The S0 groundwork was already there (above), so the work list is now the 22 clips plus the
  lower-priority pieces. Facings became §9 #28. The R2 read of `salmons` stands.
- 2026-10-26 — **S0 approved by the owner; this file opened.** The owner asked why the
  coordinating session never raised S0. Nothing it reads said an owner go was pending: S0 was
  written as "not a build step", so it had no row in game-families §8 (the table the coordinator
  walks), and it was never listed under STATUS.md's owner blockers. S0 now has a row in §8 and an
  entry in STATUS.md's owner list.
