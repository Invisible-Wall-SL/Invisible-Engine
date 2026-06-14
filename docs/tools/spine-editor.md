# Spine Editor (third-party)

The desktop skeletal-animation editor from Esoteric Software. It is where
animators **author** Spine skeletons, meshes, and animations; the engine then
plays the exported runtime files.

> Spine is a third-party product, so it keeps its real name. This page documents
> **how it fits the Invisible Wall pipeline** and how to install it from the
> launcher — not how to animate in Spine in general (see Esoteric's own docs for
> that).

## What it is

- **A local desktop app**, not an online tool. It needs an Esoteric Software
  **licence** to launch, so it can't be a cloud page — the launcher hands it out
  as a **local** tool you install on your own machine and then point the launcher
  at (save its install path in onboarding).
- **Where it runs:** on your workstation. The launcher only stores the install
  path so it knows where it lives — it does not embed or stream the editor.
- **Access:** the `spine` tool is granted by default to the `animator` role
  (`admin` gets every tool). Overridable per role/user from the admin panel.

## How it relates to our Spine tools

There are three Spine-related entries in the launcher; don't confuse them:

- **Spine Editor** (this page) — the third-party authoring app. Local, licensed.
  Used to *create* skeletons and animations from scratch.
- **[Invisible Spine Viewer](spine-viewer.md)** — our online, read-only viewer
  for inspecting exported skeletons + playing their animations in the browser.
- **[Invisible Rigger](rigger.md)** — our online skeleton/mesh/weight editor. Its
  native file is Spine 4.2 JSON, so rigs round-trip with the runtime; it covers
  much of the rigging workflow online without a Spine licence.

Use the Spine Editor when you need the full authoring environment; use the
Viewer/Rigger for inspection and lighter online edits.

## Installing it (locally)

From `/onboarding` → **Install your local tools**, the Spine Editor card walks
you through it:

1. **Download the Spine installer** from
   [esotericsoftware.com/spine-download](https://esotericsoftware.com/spine-download)
   (a licence is required to launch the editor).
2. **Install Spine** and sign in with the studio licence.
3. **Save the install path** in the onboarding form so the launcher can find it.

## Version & exports

- Target **Spine 4.2** — it's what the engine's runtime
  (`@esotericsoftware/spine-pixi-v8`) and the Invisible Rigger's `.irig` format
  expect. Exporting from a mismatched editor version can produce skeletons the
  runtime won't load.
- Exported runtime assets (atlas + skeleton JSON/binary + page PNGs) are what the
  engine and the online tools consume — keep frame/region names stable so atlas
  page references resolve.

## Known limitations / TODOs

- **Licence-gated:** the editor will not launch without a valid Esoteric licence;
  the launcher cannot provide one.
- **No download proxy:** unlike the [Invisible Launcher](invisible-launcher.md)
  (which streams from our own storage), the Spine Editor links straight to
  Esoteric's site — there is no studio-hosted installer.
