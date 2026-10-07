# Invisible Rig Viewer — status

> Design: _none (thin tool; the guide is the reference)_ · Guide: [docs/tools/rig-viewer.md](../tools/rig-viewer.md) · Agent: `launcher-studio` (no dedicated agent — thin, stable tool)

**One-line state:** Shipped and stable — a launcher-hosted, R2-backed WebGL rig viewer at `/rig-viewer` that lists the active project's skeletons (falling back to the shared library). Nothing is outstanding.

## Current state
Live on `main`, served directly by the launcher (no separate service); assets stream from R2.

- **Full-page viewer** at `/rig-viewer` (redirect to the static `static/rig-viewer/view.html` with a `?v=BUILD_ID` cache-bust; never iframed), gated on the `spineViewer` tool (admin / developer / animator / pipelineTester by default). The file endpoints go through `requireRigAccess`, which also admits `rigger` and `fx` holders, because both read the same skeletons.
- **Per-project skeletons.** `GET /rig-viewer/skeletons` reads `<client>/<project>/spines/skeletons.json` for the launcher session's active project, falling back to `_shared/spines/skeletons.json` when the project has none; the response names the resolved project so the header and the read-only project select show it. `GET /rig-viewer/file` resolves each bundle file project-first, then `_shared/spines/`, and rewrites lossy `.webp`/`.jpg` atlas page refs to a `.png` sibling when one exists (`atlasPreferPng`). Both are `no-store`, so a rig the Rigger just saved appears on refresh.
- **Our own rig runtime** (`static/rig-viewer/vendor/invisible-rig.js`, built from `engine-rig/webgl`) reads 4.1 and 4.2 exports alike — the same skeleton code the game runs. Lists skeletons, loads one onto the canvas, plays/scrubs animations, adjusts speed + display options.

## Open items / next
1. Nothing outstanding — it's a stable viewer. Authoring stays in Invisible Rigger (or any external rig editor).

## Blocked (owner / external)
- None.

## Recent changes
- 2026-10-07 — **R2 paths and format names put back where the rename overreached.** The rig
  rename (#1107) had rewritten some messages and comments to name `rigs/skeletons.json` and
  `_shared/rigs/skeletons.json`, but bundles and their index still live under `spines/` and
  `_shared/spines/` (`_shared/rigs/` is the Rigger's separate skeleton-doc library). The promote
  error, the `/admin` promote note, the seed script, the reindex route and their comments name the
  real prefixes again; the Atlas Maker and Sheet Maker copy calls the file format a "Spine-format
  `.atlas`" again, and the Atlas Maker's back-link reads "View in Rig Viewer". No stored value, key,
  prefix or route changed.
- 2026-10-07 — **Renamed to Invisible Rig Viewer.** The route is now `/rig-viewer` (the launcher
  308-redirects the old `/spine…` addresses there, query kept), with the static page and its
  endpoints under `static/rig-viewer/` and `/rig-viewer/{skeletons,file}`, and the guide at
  `docs/tools/rig-viewer.md`. The tool id stays `spineViewer`: role defaults and per-user overrides
  are stored under it.
- 2026-09-29 — **Docs caught up with the per-project index.** The status and guide still described
  a hardcoded `spines/hotfruits` prefix; the endpoints have resolved the session project's
  `spines/` root (with the `_shared/spines/` fallback) since the per-client R2 isolation work.
- 2026-05-31 — removed the hardcoded "HotFruits" project literal; dropdown reflects the real session project; empty-state message names the resolved prefix ([detail in history](../history.md))
