# Invisible Spine Viewer — status

> Design: _none (thin tool; the guide is the reference)_ · Guide: [docs/tools/spine-viewer.md](../tools/spine-viewer.md) · Agent: `launcher-studio` (no dedicated agent — thin, stable tool)

**One-line state:** Shipped and stable — a launcher-hosted, R2-backed WebGL Spine viewer at `/spine`. The one open item is generalizing the skeleton index beyond the hardcoded `spines/hotfruits` prefix.

## Current state
Live on `main`, served directly by the launcher (no separate service); assets stream from R2.

- **Full-page viewer** at `/spine` (redirect to the static `static/spine/view.html`; never iframed), gated by `requireSpineAccess` (signed in + the `spineViewer` tool for your role — admin/developer/animator/pipelineTester).
- **Bundled Spine runtimes 4.1 + 4.2** (WebGL). Lists skeletons, loads one onto the canvas, plays/scrubs animations, adjusts speed + display options.
- **Endpoints:** `GET /spine/skeletons` (reads `skeletons.json` from R2) and `GET /spine/file` (streams skeleton/atlas/image files). Lossy `.webp`/`.jpg` atlas page refs are rewritten to a `.png` sibling when one exists (`atlasPreferPng`) to avoid WebP alpha artefacts.
- The active-project dropdown reflects the launcher's session project (the old hardcoded "HotFruits" literal was removed — see [history](../history.md), B21).

## Open items / next
1. **Generalize the skeleton index off `spines/hotfruits`** — the index is still scoped to the hardcoded `SPINE_PREFIX` (`spines/hotfruits`), while the rest of the platform moved to per-`<client>/<project>` R2 isolation. Resolve the prefix from the session's active project so non-hotfruits projects list their own skeletons. (Tracked as the guide's TODO.)
2. Nothing else outstanding — it's a stable viewer. Authoring stays in the third-party Spine Editor.

## Blocked (owner / external)
- None.

## Recent changes
- 2026-05-31 — removed the hardcoded "HotFruits" project literal; dropdown reflects the real session project; empty-state message names the resolved prefix ([detail in history](../history.md))
