# Invisible Spine Viewer — status

> Design: _none (thin tool; the guide is the reference)_ · Guide: [docs/tools/spine-viewer.md](../tools/spine-viewer.md) · Agent: `launcher-studio` (no dedicated agent — thin, stable tool)

**One-line state:** Shipped and stable — a launcher-hosted, R2-backed WebGL Spine viewer at `/spine` that lists the active project's skeletons (falling back to the shared library). Nothing is outstanding.

## Current state
Live on `main`, served directly by the launcher (no separate service); assets stream from R2.

- **Full-page viewer** at `/spine` (redirect to the static `static/spine/view.html` with a `?v=BUILD_ID` cache-bust; never iframed), gated on the `spineViewer` tool (admin / developer / animator / pipelineTester by default). The file endpoints go through `requireSpineAccess`, which also admits `rigger` and `fx` holders, because both read the same skeletons.
- **Per-project skeletons.** `GET /spine/skeletons` reads `<client>/<project>/spines/skeletons.json` for the launcher session's active project, falling back to `_shared/spines/skeletons.json` when the project has none; the response names the resolved project so the header and the read-only project select show it. `GET /spine/file` resolves each bundle file project-first, then `_shared/spines/`, and rewrites lossy `.webp`/`.jpg` atlas page refs to a `.png` sibling when one exists (`atlasPreferPng`). Both are `no-store`, so a rig the Rigger just saved appears on refresh.
- **Bundled Spine runtimes 4.1 + 4.2** (WebGL, one global at a time). Lists skeletons, loads one onto the canvas, plays/scrubs animations, adjusts speed + display options.

## Open items / next
1. Nothing outstanding — it's a stable viewer. Authoring stays in Invisible Rigger and the third-party Spine Editor.

## Blocked (owner / external)
- None.

## Recent changes
- 2026-09-29 — **Docs caught up with the per-project index.** The status and guide still described
  a hardcoded `spines/hotfruits` prefix; the endpoints have resolved the session project's
  `spines/` root (with the `_shared/spines/` fallback) since the per-client R2 isolation work.
- 2026-05-31 — removed the hardcoded "HotFruits" project literal; dropdown reflects the real session project; empty-state message names the resolved prefix ([detail in history](../history.md))
