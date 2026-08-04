# UI / feature inventory — reuse catalog

> **Purpose:** stop re-implementing things we already have (file browsers, tables, layouts, item UIs, selectors).
> Before building any recurring UI surface, find it here first. The `reuse-check` skill drives this.
> Keep this updated whenever a pattern is added, moved, or extracted into a shared component.

## Two reuse domains — you CANNOT share components across them

| Domain | Stack | Where shared code goes |
|---|---|---|
| **A — Launcher** | `apps/launcher-api`, SvelteKit 2 + Svelte 5 runes | extract to `packages/components-*` (e.g. `components-shared`, `components-ui-html`, `components-layout`) and import |
| **B — Python tools** | `services/atlas-tool`, `services/sheet-tool` — server-rendered HTML strings (`ui_server.py` / `sheet_server.py` + `ui.html`) + vanilla JS | extract to a shared module per the `iw_pipeline_common` plan (STATUS health-eval #3) |

A file browser can be one shared Svelte component **within** the launcher, but the Python `/fsbrowse` is a different world — do not try to "reuse" across the A/B line. The catalog tags each entry with its domain.

## Patterns

### 1. File browser / R2 picker
| # | Impl | Domain | File(s) | Status |
|---|---|---|---|---|
| | atlas-tool `/fsbrowse` R2 browser (returns INPUT_DIR-relative paths; reused by SETTINGS pickers + B10 card "Pick from R2") | B | `services/atlas-tool/ui_server.py` (`/fsbrowse`) | canonical for domain B |
| | Launcher **FTP Browser** (navigate/upload/download/delete/move, project-scoped) | A | `lib/server/ftpScope.ts` + `api/files/{list,download,upload,delete,move}/+server.ts` + `(app)/files/+page.svelte` | most complete A impl; **extract from here** |
| | Launcher **Editor asset library** (atlas/sheet/spine listing + region thumbnails + drag) | A | `lib/server/projectAssets.ts`, `api/editor/{assets,asset,regions}/+server.ts`, `(app)/editor/+page.svelte` | overlaps FTP browser; consolidate |
| | Spine viewer skeleton/project list | A | `static/spine/view.html` + `api/spine/skeletons` | bespoke (static page) |

→ **Target shared component:** `<R2Browser>` (domain A) backed by one gated, project-scoped list endpoint. The FTP version (`ftpScope.ts`) is the reference for scoping.

### 2. Table / data-grid view
| Impl | Domain | File(s) | Status |
|---|---|---|---|
| Localization grid (rows = strings, cols = languages, editable cells) | A | `(app)/localization/+page.svelte` | bespoke |
| Admin tables ×7 (users, roles matrix, projects, clients, games, sessions) | A | `(app)/admin/+page.svelte` (1279 lines) | bespoke, monolithic |
| Win Text grid (rows = symbols, cols = match counts, editable cells; placeholder shows the inherited value) | A | `(app)/win-text/+page.svelte` | bespoke — 3rd instance; **extract next** |

→ **Target:** a small `<DataTable>` (columns def + rows + per-row actions) in `components-shared`. Would simplify admin (health-eval #3), localization, and win-text. The win-text grid adds a requirement the other two don't have: a cell's **placeholder** renders its inherited/effective value, so the extraction needs a per-cell "fallback display" hook.

### 3. Page layout
| Impl | Domain | File(s) | Status |
|---|---|---|---|
| Full-bleed page shell (B16/B17) — home, admin, tool pages | A | `(app)/+page.svelte`, `(app)/admin/+page.svelte`, tool pages | pattern, not componentized |
| 3-pane editor grid (library / canvas / properties) | A | `(app)/editor/+page.svelte` | bespoke |

→ **Target:** a `<FullBleedPage>` / section primitives so the B22 beauty-pass sectioning is defined once.

### 4. Item UI / floating toolbar (attached to a selected object)
| Impl | Domain | File(s) | Status |
|---|---|---|---|
| Editor item overlay (W×H, name, delete/lock, anchor, scale, z-order; tracks pan/zoom) | A | `apps/launcher-api/src/lib/.../EditorItemOverlay.svelte` | reference A impl |
| Sheet Maker selected-sprite panel + bottom toolbar | B | `services/sheet-tool/ui.html` | the visual model B18 says to mirror |

→ These two are **intentionally meant to look alike** (B18). Keep them visually consistent; can't share code across A/B.

### 5. Region thumbnail (crop a frame from an atlas/sheet page)
| Impl | Domain | File(s) | Status |
|---|---|---|---|
| Editor `RegionThumb.svelte` (9-arg drawImage crop, trim offsets) | A | `apps/launcher-api/src/lib/.../RegionThumb.svelte` | reference A impl |
| Sheet Maker region rendering | B | `services/sheet-tool/ui.html` (canvas) | **reference B impl** — `computeBbox` (alpha-bbox scan) + the `#viewport` cursor-anchored wheel zoom |
| Atlas Maker **Region Overlay Inspector** (`/atlasview`) — rect + measured art alpha bbox + trim frame over a composed page, zoom/pan, FILLS/INSET verdict | B | `services/atlas-tool/ui_server.py` (`ATLASVIEW`, `_view_region`, `_atlasview`) | ported from the Sheet Maker's idiom above; the only atlas-side region renderer |

→ **Backlog (domain B, not done here):** the two B impls now both carry an
alpha-bbox scan + a cursor-anchored wheel zoom, and `ATLASVIEW`/`ui.html` each
duplicate the `.iw-toolbar` chrome. Extraction into `services/_shared/iw_common`
(alongside `banner`/`context`/`imgcache`/`storage`) is the obvious next step —
an `iw_common.regionview` (bbox scan + footprint/trim geometry for
rotated/trimmed frames) and an `iw_common.chrome` (tool-bar HTML+CSS). Deferred:
the inspector was scoped as a diagnostic. Within `ui_server.py` the tool-bar CSS
is at least now single-sourced (`IW_TOOLBAR_CSS`, shared by `PAGE` + `ATLASVIEW`).

### 6. Client/project selector (header)
| Impl | Domain | File(s) | Status |
|---|---|---|---|
| Launcher two-step CLIENT→PROJECT header selector | A | `(app)/+page.svelte` | ⚠️ **buggy — see STATUS B23**; rebuild before reusing |
| atlas-tool / sheet-tool top-bar project dropdown | B | `ui_server.py` / `sheet_server.py` top bar | |

### 7. Tool top bar / cross-tool nav
| Impl | Domain | File(s) | Status |
|---|---|---|---|
| **`ToolTopBar.svelte`** — emblem (→ home) + current tool name + online-tool switcher (`TOOL_BAR_ORDER`); now OWNS the `<header class="iw-toolbar">` chrome + a `meta` snippet for page right-side content, so consumers no longer wrap it — they just render `<ToolTopBar>` and pass page meta via `{#snippet meta()}` | A | `apps/launcher-api/src/lib/ToolTopBar.svelte` + `roles.ts` (`TOOL_BAR_ORDER`, `toolBarItems`) | **canonical for domain A** — used by all launcher tool pages |
| **Bar twin** (`.iw-toolbar`) — same emblem/name/switcher, vanilla HTML/CSS/JS, fed by `?home`+`?tools` | B + static | `apps/launcher-api/static/spine/view.html` (Spine viewer), `services/atlas-tool/ui_server.py` (`IW_TOOLBAR`), `services/sheet-tool/ui.html` | **canonical twin** — mirror `ToolTopBar.svelte`; copy the `ICON` map + renderer from `view.html` when adding a new non-Svelte tool |
| Launcher Emblem header | A | `$lib/Emblem.svelte` | brand mark (consumed by `ToolTopBar`) |

→ **Design + decisions:** `docs/design/unified-tool-bar.md`. The launcher bakes the role-gated tool list into the redirect (`toolBarParams` in `lib/server/toolBar.ts` → `?home`+`?tools`); every switcher link routes back through the launcher (no per-tool secret baked). The B/static twin is kept visually identical to the Svelte original by convention (B18-style).

### 8. Server gate + active-scope resolution (not UI, but the #1 duplicated thing)
| Impl | Domain | File(s) | Status |
|---|---|---|---|
| Shared `gate()` + `assertAllowed` + `allowedPrefixes` | A | `lib/server/ftpScope.ts` | **canonical — use this** |
| Inline duplicate gates (editor, localization, atlas, sheet, spine, storybook) | A | each route's `+page.server.ts` / `+server.ts`; `lib/server/storybooks.ts` (`requireStorybookAccess`, mirrors spine's) | duplicated; consolidate (health-eval #4) |

→ Two divergent `allowedPrefixes()` exist (editor allows `spines/_shared/`, ftp doesn't). Reconcile into one parameterized definition.

### 9. Floating canvas mode/device bar (segmented control over a canvas)
| Impl | Domain | File(s) | Status |
|---|---|---|---|
| **`CanvasModeBar.svelte`** — generic floating segmented control, top-centre of a `position:relative` canvas (`options`/`value`/`onChange`, generic over the value type) | A | `apps/launcher-api/src/lib/CanvasModeBar.svelte` | **canonical for domain A** — used by the editor's device selector (`DESKTOP/TABLET/LANDSCAPE/PORTRAIT`) |
| Rigger `#modeBar` (`Preview/Setup/Animate`) — same `.seg` look, vanilla HTML/CSS | static | `apps/launcher-api/static/rigger/view.html` | the visual model `CanvasModeBar` mirrors; can't share code across the Svelte/static line |

→ Build any new on-canvas mode/device switcher (Svelte tools) with `<CanvasModeBar>` — don't re-roll header pills. The static rigger twin is kept visually identical by convention (like the tool-bar twin in §7).

### 10. Save-state machine + save-status pill (etag/dirty/conflict/autosave)
| Impl | Domain | File(s) | Status |
|---|---|---|---|
| **`SaveState`** (rune helper) — the save/dirty/etag/conflict/autosave state machine: injected transport, held ETag re-adopted per save, `idle/saving/saved/error/conflict/scope-mismatch`, no-re-arm-on-conflict, force, create-path, two debounce semantics (`resetDebounceOnEveryEdit`: flow trailing / editor leading) | A | `apps/launcher-api/src/lib/saveState.svelte.ts` | **canonical for domain A** — every authoring tool's save logic routes here (multi-user-concurrency Phase 2a) |
| **`SaveStatusBadge.svelte`** — the shared save pill (saving/saved/dirty/error/conflict/scope-mismatch + Save/Retry/Reload theirs/Overwrite actions), driven by a `SaveState`; parameterized for the editor/flow pill drift (`okAccent`, `actionClass`, `overwritable`) | A | `apps/launcher-api/src/lib/SaveStatusBadge.svelte` | **canonical for domain A** — the pill for editor + flow-v2 (doc + library); banner/`confirm()` tools drive their bespoke conflict UX off the same `SaveState` |
| **`LeaseState`** (rune helper) — the CLIENT soft-lease lifecycle (acquire → heartbeat → takeover → release) against `POST /api/lease`; exposes reactive `held` / `readOnly` / `heldBy`; `enabled:false` no-ops; fails open (never wedges) before acquire / on error; a lost heartbeat flips read-only + stops beating | A | `apps/launcher-api/src/lib/leaseState.svelte.ts` | **canonical for domain A** — a tool wires `blockWhen: () => lease.readOnly` into its DOC `SaveState`; wired into editor + flow-v2 (multi-user-concurrency Phase 2c); other tools = later 2c-rest |
| **`PresenceBanner.svelte`** — the read-only banner shown when another user (or your own other tab, `heldBy.mine`) holds the edit lease: names the holder, "active N ago", and an always-enabled **Take over**; driven by a `LeaseState`, renders nothing when `!lease.readOnly` | A | `apps/launcher-api/src/lib/PresenceBanner.svelte` | **canonical for domain A** — the presence/takeover surface; sits in the tool chrome next to `SaveStatusBadge` |

→ Any new authoring tool with a save MUST build on `SaveState` (thread the ETag, adopt the lease via `LeaseState` + `blockWhen`) rather than re-rolling dirty/etag/conflict — a hand-rolled `fetch`+`putObjectText` is the regression the review gate exists to catch. Render the common pill with `<SaveStatusBadge>` and the read-only/takeover surface with `<PresenceBanner>`; keep a bespoke conflict UX (like components' versioned `confirm()`) driven off `state.status`/`state.message`, not re-invented. Lease only the tool's OWN per-project doc — GLOBAL `_shared/*` keys (flow-v2 library, editor templates/kinds) stay unleased (a per-project lease can't cover them; their `If-Match` CAS is the floor). The transport callback is the seam where a form action and a `fetch` both fit.
