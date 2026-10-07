# Invisible Rig Viewer

Browse and play back rig skeletons and animations in the browser.

## What it is

A web viewer for skeletal-animation rigs. It lists the skeletons of your active project, loads one onto a WebGL
canvas, and lets you scrub through and play its animations. Built on our own
license-free rig runtime (`engine-rig`), the same skeleton code the games run.

- **Source:** static document at `apps/launcher-api/static/rig-viewer/view.html`,
  with the runtime bundled as `static/rig-viewer/vendor/invisible-rig.js`. Skeleton data is served by
  launcher endpoints under `src/routes/(app)/rig-viewer/`.
- **Where it runs:** cloud — served **directly by the launcher** (no separate
  service), full-page, behind the launcher's sign-in. Assets stream from
  Cloudflare R2.
- **Access:** the `spineViewer` tool, granted by default to the `admin`,
  `developer` and `animator` roles (and to `pipelineTester`). Overridable per role
  or user in the admin panel.

## How to access it

Sign in to the launcher (`app.invisiblewall.org`) and open the **Invisible Rig Viewer** card, or go to `/rig-viewer`. The launcher checks your access and
redirects you full-page to the static `/rig-viewer/view.html` document. (Tools are
never iframed.)

## How it works

- **Which skeletons you see:** the viewer shows the project you have selected in
  the launcher — its name appears in the header and in the (read-only) **Active
  project** select. To view another project, switch project in the launcher.
- **Skeleton list:** `GET /rig-viewer/skeletons` reads the project's
  `<client>/<project>/spines/skeletons.json` from R2. A project with no rigs of
  its own shows the shared engine library (`_shared/spines/`) instead; an empty
  project says which project it looked in.
- **Asset files:** `GET /rig-viewer/file` streams each skeleton/atlas/image file,
  looking in the project first and the shared library second. Atlas page refs that
  point at lossy `.webp`/`.jpg` are rewritten to a `.png` sibling when one exists
  (`atlasPreferPng`), avoiding lossy-WebP alpha artefacts.
- Neither response is cached, so a rig you just saved in Invisible Rigger appears
  when you reload the viewer.

## Typical workflow

1. Select the project in the launcher, then open `/rig-viewer`.
2. Pick a skeleton from the sidebar list (filterable).
3. The viewer loads it onto the canvas.
4. Select an animation, play/pause, scrub the timeline, adjust speed, and toggle
   display options.

## Prerequisites

- A signed-in launcher account with access to the Rig Viewer.
- Rig assets in the project's R2 `spines/` folder with a `skeletons.json`
  index — the Rigger and the Scene Editor's rig upload keep it up to date.

## Known limitations / TODOs

- Skeletons are read with rig **4.2** semantics, as the games read them. A 4.1
  export loads and looks as it does in the game (a 4.1-only bone `transform` is
  ignored there too); exports from other versions may not load.
- The viewer does not switch projects itself; the launcher owns the active
  project.
- This is the **viewer** only — authoring is done in Invisible Rigger or the
  third-party an external rig editor (a separate local tool in the launcher's local-tools
  list).
