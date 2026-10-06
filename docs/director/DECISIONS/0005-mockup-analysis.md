# ADR-0005 — Mockup analysis

- **Status:** approved (2026-10-04, owner)
- **Date:** 2026-10-04

## Context

The owner uploads mockups, tags each with a screen or "Style reference only", picks a fidelity mode,
and confirms ownership. The Mockup analyst maps every element to a template region, extracts the
palette and font gaps, and flags clashes with locked items. Nothing renders until the owner confirms.

## Recommendation

### Storage

- Images go to `<C>/<P>/director/mockups/<uploadId>.<ext>` and are written create-only (`If-None-Match`).
- A doc at `<C>/<P>/director/mockups.json` lists each image:
  - `{id, file, w, h, tag, styleOnly, uploadedBy, uploadedAt}`
  - plus the run's `fidelity` and `ownershipConfirmed: {by, at}`
- Upload limits:
  - PNG/JPG only
  - 20 MB per file
  - 12 files
- Images are downscaled server-side to ≤ 1568 px on the long edge for the model. The original is kept.

### Analysis

There is one Mockup analyst turn per image. It is vision input (base64) plus the template's region
catalogue, which contains:
- region names and groups from the Atlas manifest
- region sizes
- Scene Editor screen nodes for the tagged screen
- the locked-item list from ADR-0002

The analyst returns **structured output** (JSON schema via `output_config.format`):
- `elements[]`: `{n, box:{x,y,w,h} in image px, name, region|null, status: matched|needs_you|left_out, reason, lockedItem?}`
- `palette[]`: `{name, hex}`, at most 8 entries
- `fontGaps[]`: `{text, styleNote}`
- `uncoveredRegions[]`

### Conflict handling

- **Code**, not the model, decides `left_out`. An element whose proposed region or feature depends on
  a locked item (e.g. buy-bonus with no buy mode in `betModes`) is forced to `left_out` with the
  locked item's name.
- The model's "matched" claims are validated against the real region list. An unknown region becomes
  `needs_you`.

### Palette

- The model proposes the palette.
- Code verifies each hex against a k-means of the image pixels, excluding style-only images from
  region matching. Swatches the image doesn't support are dropped.

### Fonts

Text elements are compared against the project's and `_shared` Font Maker catalogs by name and style
note. A gap is reported, never auto-filled; the Builder bakes a candidate for approval later.

### Fidelity

The mode is stored on each region's brief:
- `match` means the atlas artist uses the mockup crop as an img2img / IP-adapter reference, if the
  blueprint has a `reference` binding, and the art director judges silhouette and colour against the
  crop.
- `start` means the crop is a mood reference only.

### Crops

The `box` of a matched element is cropped server-side and stored as
`director/crops/<runId>/<region>.png`. The Live run review panel shows it next to the variants.

### Ownership

The run cannot be created without the checkbox. The confirmation is recorded on the run and in
`mockups.json`, and it is shown in the run header.

## Consequences

- New R2 subtree `<C>/<P>/director/`. It is **not** an asset class the game ships, so rule 8 (the
  deploy chain) does not apply. It is excluded from deploy, bake and pull.
- Analysis costs about 1 Opus call per image (estimated $0.05–0.15 each). The cost shows up in the
  New-game estimate.

## Needs owner approval

- The R2 location.
- The upload limits.
- The rule that code (not the model) has the final word on `left_out`.

## Amendments

### 2026-10-06 (PR #1067)
The breakdown step is now entirely worker-driven:

1. **One vision call per image.** `analyzeMockups` + `submitBreakdown` run before any agent turn.
   A single checkpoint, `breakdown`, opens once per attempt. Each call is preceded by the owner's
   pause/stop check and the cap check, carries the drive signal (`driving: true`), and is billed
   before anything else. A refusal, unusable answer or permanent API error pauses at once. A
   stopped pass re-asks only missing images.

2. **Per-image storage.** Every vision answer is stored as a `breakdown_image` activity row, keyed
   by attempt ID, image-bytes hash and `blake2b(system + prompt)`. Answers are not regenerated
   unless the hash changes or a stopped pass drops them.

3. **Three verdicts on conflict.** Code (not the model) has the final word. A rule is applied only
   if it mentions the element (tokenized names, joined tokens). Three outcomes:
   - `clash`: the rule forbids the element. It is forced to `left_out` with the rule's name.
   - `cleared`: the model's region claim or feature is disallowed. The element's region is matched
     as regions allow, and its `status` does not become `matched` from the model claim alone.
   - `unjudged`: no rule governs this element + region pair. The model's claim stands, unless it
     names a locked item, in which case it is capped at `needs_you`.

4. **Regions is a list.** The `regions[]` field on each element's brief is unordered; it is the
   model's preference. `uncoveredRegions[]` is computed by code, never by the model.

5. **Owner revise.** When the owner revises a breakdown (e.g. to resolve conflicts), the run
   re-runs as the next attempt; the owner's notes are added to every image's prompt for that pass.
