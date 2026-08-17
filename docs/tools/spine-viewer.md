# Invisible Spine Viewer

Browse and play back Spine skeletons and animations in the browser.

## What it is

A web viewer for [Spine](https://esotericsoftware.com/) skeletal-animation
assets. It lists the skeletons in the shared asset repository, loads one onto a
WebGL canvas, and lets you scrub through and play its animations. Built on the
Spine WebGL runtime (versions 4.1 and 4.2 are bundled).

- **Source:** static document at `apps/launcher-api/static/spine/view.html`,
  with bundled runtimes under `static/spine/vendor/`. Skeleton data is served by
  launcher endpoints under `src/routes/(app)/spine/`.
- **Where it runs:** cloud — served **directly by the launcher** (no separate
  service). Assets stream from Cloudflare R2.

## How to access it

Sign in to the launcher (`app.invisiblewall.org`) and open the **Invisible
Spine Viewer** card, or go to `/spine`. The launcher checks your role
(admin/developer/animator/pipeline tester) and redirects you full-page to the static
`/spine/view.html` document. (Tools are never iframed.)

## How it works

- **Skeleton list:** `GET /spine/skeletons` reads
  `spines/hotfruits/skeletons.json` from R2 and returns the available skeletons.
- **Asset files:** `GET /spine/file` streams the individual skeleton/atlas/image
  files from the R2 `spines/hotfruits` prefix. Atlas page refs that point at
  lossy `.webp`/`.jpg` are rewritten to a `.png` sibling when one exists in R2
  (`atlasPreferPng`), avoiding lossy-WebP alpha artefacts.
- Both endpoints enforce access via `requireSpineAccess` (must be signed in and
  have the `spineViewer` tool for your role).

## Typical workflow

1. Open `/spine` from the launcher.
2. Pick a skeleton from the sidebar list (filterable).
3. The viewer loads it onto the canvas.
4. Select an animation, play/pause, scrub the timeline, adjust speed, and toggle
   display options.

## Prerequisites

- A signed-in launcher account with a role that includes the Spine Viewer
  (admin, developer, animator, pipeline tester).
- Spine assets present in R2 under `spines/<game>` with a `skeletons.json` index.

## Known limitations / TODOs

- The skeleton index is currently scoped to the `spines/hotfruits` R2 prefix
  (`SPINE_PREFIX`). TODO: confirm whether multi-game prefixes are planned.
- Bundled runtimes are Spine **4.1 and 4.2**; skeletons exported from other Spine
  versions may not load.
- This is the **viewer** only — authoring is done in the third-party Spine
  Editor (a separate local tool in the launcher's local-tools list).
