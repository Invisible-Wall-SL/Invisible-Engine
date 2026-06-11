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

→ **Target:** a small `<DataTable>` (columns def + rows + per-row actions) in `components-shared`. Would simplify admin (health-eval #3) and localization.

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
| Sheet Maker region rendering | B | `services/sheet-tool/ui.html` (canvas) | |

### 6. Client/project selector (header)
| Impl | Domain | File(s) | Status |
|---|---|---|---|
| Launcher two-step CLIENT→PROJECT header selector | A | `(app)/+page.svelte` | ⚠️ **buggy — see STATUS B23**; rebuild before reusing |
| atlas-tool / sheet-tool top-bar project dropdown | B | `ui_server.py` / `sheet_server.py` top bar | |

### 7. Tool top bar / cross-tool nav
| Impl | Domain | File(s) | Status |
|---|---|---|---|
| Sheet Maker top bar: `← Launcher` link + "Atlas Maker linked ✓" status pill | B | `services/sheet-tool/ui.html` (90, 96, 199-202) | see STATUS B24 |
| Atlas Maker top bar (no nav at all) | B | `services/atlas-tool/ui_server.py` (~1506-1510) | gap — see B24 |
| Launcher Emblem header | A | `$lib/Emblem.svelte` | brand mark |

### 8. Server gate + active-scope resolution (not UI, but the #1 duplicated thing)
| Impl | Domain | File(s) | Status |
|---|---|---|---|
| Shared `gate()` + `assertAllowed` + `allowedPrefixes` | A | `lib/server/ftpScope.ts` | **canonical — use this** |
| Inline duplicate gates (editor, localization, atlas, sheet, spine, storybook) | A | each route's `+page.server.ts` / `+server.ts`; `lib/server/storybooks.ts` (`requireStorybookAccess`, mirrors spine's) | duplicated; consolidate (health-eval #4) |

→ Two divergent `allowedPrefixes()` exist (editor allows `spines/_shared/`, ftp doesn't). Reconcile into one parameterized definition.
