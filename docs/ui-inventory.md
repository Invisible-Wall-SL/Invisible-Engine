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

⚠️ **A 5th browser was deliberately NOT built (2026-08-26).** The Flipbook Video mode needs a
source-image picker whose returned paths the atlas-tool's ref resolver can consume (`sheets/…`,
`sheet_src/…`, input-rooted `refs/…`). A launcher-side picker would have to reproduce that
per-root relativization and would drift from it, so `/flipbook`'s picker **proxies the domain-B
`/fsbrowse`** through `api/flipbook/video/[...path]` instead. Precedent worth copying when a
domain-A surface needs paths only a domain-B resolver defines — but note it does NOT make
`/fsbrowse` a domain-A component: it is reachable only through that gated, allow-listed proxy.

**Still true after the picker grew two more sources (2026-08-27).** The Flipbook video picker now
offers three tabs — project files, an atlas REGION, and a file from the author's computer — and the
first is unchanged: it is still the proxied `/fsbrowse`, precisely because that is the only thing
that knows the per-root relativization. The other two are not browsers. A region is not a file and a
local file is not in the project, so each has to BECOME one: both are written to
`input/refs/flipbook/<name>` by a presigned PUT (`api/flipbook/source-url`, which mints the key and
the matching `refs/…` ref in one place so the two cannot drift) and the tool resolves the result
through its normal INPUT_DIR routing. The rule to carry forward: **do not add a fourth browser —
add a source that ends in a ref the tool already resolves.**

### 2. Table / data-grid view
| Impl | Domain | File(s) | Status |
|---|---|---|---|
| Localization grid (rows = strings, cols = languages, editable cells) | A | `(app)/localization/+page.svelte` | bespoke |
| Admin tables ×7 (users, roles matrix, projects, clients, games, sessions) | A | `(app)/admin/+page.svelte` (1279 lines) | bespoke, monolithic |
| Win Text grid (rows = symbols, cols = match counts, editable cells; placeholder shows the inherited value) | A | `(app)/win-text/+page.svelte` | bespoke — 3rd instance; **extract next** |

→ **Target:** a small `<DataTable>` (columns def + rows + per-row actions) in `components-shared`. Would simplify admin (health-eval #3), localization, and win-text. The win-text grid adds a requirement the other two don't have: a cell's **placeholder** renders its inherited/effective value, so the extraction needs a per-cell "fallback display" hook.

⚠️ **The Invisible Sound library list is NOT a 4th instance** — do not count it toward the extraction. Every impl above is a MATRIX (rows × columns of same-typed cells, one entity per row and one attribute per column); `/sound` is a per-entity row of heterogeneous controls (play button, text, select, number, toggles, a `<details>` metadata panel). A `<DataTable>` built to cover both would be a layout engine, not a table. See §13.

### 13. Per-entity editable list (row = one record, mixed controls)
| Impl | Domain | File(s) | Status |
|---|---|---|---|
| Invisible Sound library — sectioned rows: audition button, name/kind/section, duration, volume, loop, approve pill, delete, plus a collapsible provenance panel | A | `(app)/sound/+page.svelte` | first instance — build the 2nd against this, extract on the 3rd |
| **Audio audition** — ONE shared `<audio>` element for the whole list (not one per row), src swapped on play, plays at the row's authored volume so what you hear is what the game plays | A | same file | the reusable bit if a second tool ever previews audio |
| **Upload drop-zone** — drag/drop + "choose files", `accept` derived from the shared extension whitelist, per-file progress, client-side duration measured with `decodeAudioData` before the POST | A | same file | ditto |

→ Distinct from §2: there are no columns, and a row's controls differ by field type. If a second tool needs one, copy from `/sound` rather than reinventing, and extract on the third (the rule §2 is living out).

⚠️ **The Invisible Sound library list is NOT a 4th instance** — do not count it toward the extraction. Every impl above is a MATRIX (rows × columns of same-typed cells, one entity per row and one attribute per column); `/sound` is a per-entity row of heterogeneous controls (play button, text, select, number, toggles, a `<details>` metadata panel). A `<DataTable>` built to cover both would be a layout engine, not a table. See §13.

### 14. Generated-variant gallery (N AI results for one prompt, pick one)
| Impl | Domain | File(s) | Status |
|---|---|---|---|
| Atlas Maker per-region variant gallery (thumbs + seed lock + delete) | B | `services/atlas-tool/ui_server.py` (`/vthumb/`, `/vfull/`, `_serve_variant`) | reference B impl |
| Flipbook **Video mode** results grid (self-playing animated-WEBP tiles on a checkerboard, seed copy, per-tile status/error) | A | `apps/launcher-api/src/routes/(app)/flipbook/VideoMode.svelte` | first A impl |

→ Same idea either side of the A/B line (generate N, browse, pick one), so keep them visually
consistent like §4 — but they cannot share code. The A impl needs no `<video>`: an animated WEBP
plays and loops in a plain `<img>`, and the checkerboard is load-bearing (it is how the author
sees whether the cutout produced real alpha).

### 13. Per-entity editable list (row = one record, mixed controls)
| Impl | Domain | File(s) | Status |
|---|---|---|---|
| Invisible Sound library — sectioned rows: audition button, name/kind/section, duration, volume, loop, approve pill, delete, plus a collapsible provenance panel | A | `(app)/sound/+page.svelte` | first instance — build the 2nd against this, extract on the 3rd |
| **Audio audition** — ONE shared `<audio>` element for the whole list (not one per row), src swapped on play, plays at the row's authored volume so what you hear is what the game plays | A | same file | the reusable bit if a second tool ever previews audio |
| **Upload drop-zone** — drag/drop + "choose files", `accept` derived from the shared extension whitelist, per-file progress, client-side duration measured with `decodeAudioData` before the POST | A | same file | ditto |

→ Distinct from §2: there are no columns, and a row's controls differ by field type. If a second tool needs one, copy from `/sound` rather than reinventing, and extract on the third (the rule §2 is living out).

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
| `regionCrop.ts` — the same geometry, but at NATIVE size and out to a PNG blob (`cropRegionToPng`), for feeding a region to an image model | A | `(app)/editor/regionCrop.ts` | 2nd A consumer of the geometry; used by `/flipbook`'s video source picker |
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

### 11. Colour picker (swatch + popover)
| Impl | Domain | File(s) | Status |
|---|---|---|---|
| **`ColorField.svelte`** — Photoshop-style picker: swatch button → fixed-position popover (SV square + hue slider + hex entry). Click-drag with pointer capture (keeps tracking outside the picker), stays open while picking, commits & closes on click-away, Esc reverts. `#rrggbb` in/out via `bind:value` **or** `value` + `oninput`/`onchange(hex)`; `disabled`; `title`; `class`. | A | `apps/launcher-api/src/lib/ColorField.svelte` | **canonical for domain A** — used by config (paylines, bet-mode card params), editor (fills/tints/strokes/shadow/rect), symbols (highlight/win-line/glow/text/overlay tint), fx (particle tint), fonts (fill/gradient/outline/shadow) |
| **`color-field.js`** — vanilla twin (no framework): an *enhancer* that upgrades every `<input type="color">` into the same popover, keeping the native input as a hidden value-holder (preserves id/class/value, fires `input`/`change`). Auto-runs on load + MutationObserver for dynamically-added inputs. Same HSV maths + behaviour as the Svelte one. | static / Python | `apps/launcher-api/static/shared/color-field.js` (canonical) · `services/atlas-tool/color-field.js` (inlined copy — separate origin) | used by spine `view.html` (bg) and the atlas-tool FX `color` param; a separate-origin copy can't be shared, kept identical by convention (like §7/§9) |

### 12. Tool loading screens (boot splash vs in-tool overlay)
| Impl | Domain | File(s) | Status |
|---|---|---|---|
| **`BootSplash.svelte`** — the CRT boot splash: black screen, phosphor green, scanlines + vignette + power-on sweep, ASCII emblem + BIOS dateline, then a typed `> phrase ..... [ OK ]` loop. Props `tool` / `version` / `phrases` / `ready` / `minMs` / `onfinished`; the parent flips `ready` and the splash finishes its line (never before `minMs`) and calls `onfinished`. Mounted by `(app)/+layout.svelte` for every client-side navigation to a TOOL route (>200 ms) | A | `apps/launcher-api/src/lib/BootSplash.svelte` + `bootPhrases.ts` (per-tool WORK pools) | **canonical for domain A** |
| **`boot-splash.js`** — vanilla twin: auto-installs on parse (`<script data-tool="…" data-phrases="a\|b" [data-settle-ms]>` first in `<body>`), lifts on `IWBoot.done()`, falls open on `window.load`+`data-settle-ms` (400 ms) and a 20 s cap | static | `apps/launcher-api/static/shared/boot-splash.js` — used by `static/{spine,rigger}/view.html`, and injected into the launcher shell by `hooks.server.ts` for a HARD load of a tool page (`data-settle-ms="8000"`; the root `+layout.svelte` calls `IWBoot.done()`) | canonical for the static line |
| **`splash_html()`** — Python twin, served as the instant first byte for `GET /` (the real UI is background-fetched at `?fast=1` and swapped in) | B | `services/_shared/iw_common/splash.py` — used by atlas-tool + sheet-tool | canonical for domain B |
| **`BusyOverlay.svelte`** — the in-tool loader: dimmed veil + card (spinner, `label`, `detail`, optional `progress` bar), `position: 'absolute' \| 'fixed'` | A | `apps/launcher-api/src/lib/BusyOverlay.svelte` — reference use: the Editor canvas' asset-load overlay | **canonical for domain A** |
| Rigger `#loadingOverlay` (`showLoading()`/`hideLoading()`) — same idea, vanilla | static | `apps/launcher-api/static/rigger/view.html` | the static twin; keep visually aligned |

→ **Both halves of "a tool is opening" are covered:** a CLIENT-SIDE navigation mounts `<BootSplash>` from `(app)/+layout.svelte`; a HARD load — typed URL, refresh, a link out of a static tool, or an in-tool full navigation (Flipbook's `window.location.href = '/flipbook?clip=…'`) — has no app running yet, so `hooks.server.ts` injects the vanilla twin into the shell at `<!--iw-boot-splash-->` and the root `+layout.svelte` lifts it on mount (the root, so an error page lifts it too). Tool pages are `ssr = false`, so without this a hard load sits on a blank shell. Any new full-page navigation to a tool inherits this for free — it is keyed off `TOOLS[].url`, not per-page wiring.

→ **One OPEN, not one document — the splash latches across a hop:** the `handsOff` rule above covers a launcher route that redirects to a *different origin*, but plenty of tool opens legitimately span two documents on the SAME origin: `/rigger` → `/rigger/view.html`, and every in-tool full navigation (`/fx?effect=…`, `/flipbook?clip=…`, Editor → Component Editor). Each document boots its own splash, so the second replaying the power-on sweep, ASCII logo and BIOS dateline is what reads as the CRT firing twice. `splashTrail.ts` (Svelte) and the inlined twin in `boot-splash.js` (vanilla) share a `sessionStorage` heartbeat — per-TAB, and it survives a document navigation — rewritten on every 60 ms poll tick, so it means *a splash was on screen a moment ago* rather than *a splash started recently* and the latch holds however long the first one ran. Within `HANDOFF_MS` (1500) the new splash CONTINUES: no sweep (`.warm` / `.iw-warm`), no logo, no BIOS, no `minMs` floor — it picks up at the phrase loop and the two documents read as one boot. Cross-origin (the Python tools) can't see the storage, which is exactly why `handsOff` still exists. Covered by `node scripts/verify-boot-splash.mjs`, which runs the real splash source over stubbed DOM with one shared storage and asserts cold→full, hop→continue, expired→full again.

→ **The trail is the diagnostic.** A double crosses a document boundary, so no single page can be watched to catch it and "it happens every now and then" never turns into a reproduction. Every splash start is recorded — URL, nav type (`navigate`/`reload`/`back_forward`), impl — and a continuation logs the document it continued FROM. After a suspected double, read `window.__IW_SPLASH_TRAIL__` in the console: the two halves name themselves.

→ **Exactly ONE splash per open — a tool that redirects out of the app is flagged `handsOff`:** `/atlas`, `/sheet`, `/spine` and `/rigger` don't render a launcher page, they `redirect(303)` to another document (the Python origin, or the static `view.html`) that boots this same CRT itself. A client-side click still starts as a SvelteKit navigation, and SvelteKit finishes a redirect to a non-route URL with `location.href` — so without the flag `<BootSplash>` plays for the hop and the destination then plays its own from the top: the screen runs twice. `ToolDef.handsOff` marks them and `(app)/+layout.svelte` skips the splash; the destination owns the loading screen. Set it on any new tool whose route redirects to a document that carries its own splash.

→ **The split is the rule, not the styling:** a tool that is still OPENING (nothing usable on screen yet) shows the **CRT boot splash** — the same screen on every stack, so opening any Invisible tool feels identical. A tool that is ALREADY open and is loading/updating a part of itself (assets, a document, a publish) shows the **dimmed overlay + card**. Never boot-splash an in-tool load, and never spinner-card a tool boot. The three boot-splash impls exist only because the three origins can't share code — keep them visually identical (same convention as the tool-bar §7, mode-bar §9, and colour-field §11 twins).

→ Every colour input in a Svelte tool uses `<ColorField>`; every colour input in a static/Python tool is covered by `color-field.js` — do NOT reach for a bare `<input type="color">` (the OS picker closes on the first click, can't be click-dragged, and looks different per platform; that inconsistency is exactly what this replaced). Svelte callers that store a NUMBER keep their `hexFrom()` / `fromColorInput()` conversions around the `#rrggbb` boundary; the vanilla enhancer needs no wiring — include the script and it upgrades native inputs in place, so existing `.value` reads and `input`/`change` listeners keep working. `services/atlas-tool/color-field.js` is a byte-identical copy of the canonical file (separate Railway origin can't reference it); keep them in sync, same as the tool-bar/emblem twins in §7.

### 16. Run picker (choose one of N past generations)
| Impl | Domain | File(s) | Status |
|---|---|---|---|
| **`RunPicker.svelte`** — popover list; each row is a lazy thumbnail + the line you recognise the run BY + dim meta, with a live/bad status dot | A | `apps/launcher-api/src/lib/RunPicker.svelte` | **canonical for domain A** — used by `/flipbook` 🎬 Video's session rail |
| Atlas Maker region-variant strip (thumbs of one region's generations) | B | `services/atlas-tool/ui_server.py` (`/vthumb/`) | reference B impl — see also §14 |

→ Built because a native `<select>` cannot show a picture, and a list of generated runs is close
to unusable without one: every row renders as the same recipe name plus a count and an age, which
identifies the RECIPE and not the run (owner report on 🎬 Video, 20+ rows all reading
"Wan 2.2 I2V — flipbook source · 10 · 3d ago"). The two things that tell runs apart are what was
ASKED FOR and what CAME OUT, so a row carries both. The component knows nothing about sessions,
prompts or R2 — the caller maps its own records into `RunPickerItem` **and derives the title**, so
a title stays a caller policy (🎬 Video cuts the prompt on a word boundary). Two things to keep
if you reuse it: thumbnails are `loading="lazy"` (opening a picker must not fetch every run's
render), and it closes on a full-screen backdrop, not on its own clicks — the §"submenu stays
stuck open" bug.

### 15. Bounds box (a declared size frame drawn over art)
| Impl | Domain | File(s) | Status |
|---|---|---|---|
| **`BoundsBox.svelte`** — the draggable declared-size frame: an absolutely-positioned rect with 8 edge/corner handles + a move body, pointer-captured drag computed from the box as it was at pointer-down (no rounding drift), edges normalised so dragging one past its opposite flips rather than inverts. Props `bounds` (`{x,y,w,h}` in ART pixels, top-left relative to the art's ORIGIN), `fit` (`{scale,originX,originY}` — the host's art→stage mapping), `stage` (the positioned host element), `onchange`, `color`. | A | `apps/launcher-api/src/lib/BoundsBox.svelte` | **canonical for domain A** — used by `/flipbook` (a clip's box) and the Scene Editor's `ArtBoundsEditor` (a region's box) |
| Rigger **Bounds** button + `drawBoundsOverlay`/`boundsHit`/`applyBoundsDrag` — the same frame in skeleton-world y-up, drawn through the spine renderer's `line`/`circle` overlay rather than the DOM | static | `apps/launcher-api/static/rigger/view.html` | the ORIGINAL; a separate origin (static page, WebGL overlay, y-up space) so it cannot share the component — keep the interaction identical |

→ **One concept, three homes, one meaning:** a rig declares `skeleton.{x,y,width,height}`, a
flipbook clip declares `FlipbookClip.bounds`, and a sprite region declares an entry in
`editor/art-bounds.json`. All three say the same thing — *this is the box every consumer sizes and
anchors by, whatever the pixels happen to be* — and all three are ART pixels, top-left relative to
the art's own origin (its centre), so a centred box is `x = -w/2`.

→ **The overlay is parented to the THUMBNAIL, never to the stage around it.** Both hosts centre a square thumbnail inside a larger stage; positioning the box against the stage puts it `(stageWidth − thumbnail) / 2` px from the art it describes and drags it by the same offset, because `BoundsBox` measures pointers against the element it is handed. That shipped once and was unusable on first contact (562px of drift on a 1400px window). Each host wraps the thumbnail and the overlay in ONE exactly-sized element; the art→screen maths lives in `$lib/boundsFit.ts` and is pinned by `node apps/launcher-api/boundsFit.fixture.ts`, which simulates both layouts.

→ **The arithmetic has exactly one implementation:** `applyClipBounds` in `engine-flipbook`
(`bounds.ts`) re-states a frame as `orig` (the box) + `trim` (the art inside it). The runtime calls
it to rebuild a clip's textures, the editor canvas calls it to draw, `RegionThumb` takes the result
as its `box` prop, and `editorArtExport` calls it to write a region's `sourceSize`/`spriteSourceSize`
into the shipped sheet. A fourth hand-written copy is how the editor and the game start disagreeing
about where a boxed frame lands — don't add one.

→ **A box SMALLER than the art is legal and load-bearing**, not a validation gap: it is how a symbol
is sized by the part that reads while a wide invisible flourish hangs outside the cell. PIXI draws
it correctly (`updateQuadBounds` positions the quad from `trim` and takes only the anchor from
`orig`) — pinned by `pnpm --filter flipbook-spike run pixi-bounds` against the real pixi build.

### 16. Pan/zoom canvas viewport (a positioned pane inside a clipping window)
| Impl | Domain | File(s) | Status |
|---|---|---|---|
| **`panZoom.ts`** — the arithmetic: `paneSize` (zoom → pixel size, clamped), `zoomAbout` (anchored zoom — what is under the cursor stays under it), `centrePane`, `toPane`. Pure, offline-fixtured (`panZoom.fixture.ts`). The `/flipbook` preview consumes it | A | `apps/launcher-api/src/lib/panZoom.ts` | **canonical for domain A** |
| Scene Editor canvas — its own `panX`/`panY`/`zoom` with `clientToWorld` / `worldToScreen`, wheel zoom and drag pan, wired into a 2D canvas draw rather than into DOM elements | A | `(app)/editor/EditorCanvas.svelte` | predates the module; different enough (it transforms a `ctx`, not a positioned element) that sharing was not forced — revisit if a third viewport appears |

→ **Nothing measured is ever written back into what is measured.** A resize observer that read a
stage's BORDER-box height and assigned it as the CONTENT-box height added the 2px border on every
pass and grew the preview without limit, in a shipped build (248px → 650px in 200 ticks). The rule
that replaced it: the height is owned by a drag grip writing pointer DELTAS, the observer writes
only `contentRect` into values no style reads back, and the pane inside is absolutely positioned so
it cannot size its parent.

→ **Zoom by changing the pane's SIZE, not by a CSS `scale` on an ancestor.** Anything positioned
inside a scaled element — a bounds box, a handle, a hit-test — has its pixel numbers and its
pointer offsets silently multiplied, so it drifts at every zoom but 100%. Sizing the pane keeps its
children in plain screen pixels and keeps a redrawn canvas sharp instead of upscaled.

### 17. Confirmation / destructive-action dialog
| Impl | Domain | File(s) | Status |
|---|---|---|---|
| **`ConfirmDialog.svelte`** — native `<dialog>` + `showModal()`. Snippet `body`, optional `requireText` typed guard, `busy` (holds it open + un-dismissable while the action runs), `blocked` (a precondition typing can't defeat), `error` (a failed attempt rendered inside), `danger` fill. `onconfirm(typed)` hands the guard text back so the SERVER can re-validate it | A | `apps/launcher-api/src/lib/ConfirmDialog.svelte` | **canonical for domain A** — consumers: admin project delete + purge |
| `window.confirm()` — ~15 call sites (`files`, `fx`, `flipbook`, `components`, `editor`, `comfyui`) | A | various `(app)/*/+page.svelte` | **legacy** — migrate to `<ConfirmDialog>`; a `askConfirm(): Promise<boolean>` wrapper over one host in `(app)/+layout.svelte` is the natural next step |
| Hand-rolled `.modal-backdrop` divs | A | `(app)/game-maker/+page.svelte` (×3) | **legacy** — same target |

→ **`showModal()` is the reason to use the native element, and it is not cosmetic.** It makes the
rest of the page *inert* — neighbouring buttons cannot be clicked, focused or tab-reached — so a
misclick during an in-flight action is impossible without maintaining a list of `disabled`
attributes. It also brings a real focus trap, Escape as a cancellable `cancel` event, and the top
layer (above every `z-index`). This replaced a bare `<button class="danger">Delete</button>` sitting
one button away from Rescaffold, with no confirmation at all, which is exactly how a project with
2,488 R2 objects got deleted by accident.

→ **A client-side guard is decoration.** Whatever `requireText` demands, the action re-checks it
server-side (`purgeProject` compares the posted `confirmKey` to the project key) — and re-runs its
own preconditions at the moment of the write, because the dialog may have sat open for minutes.

→ **`open` is ONE-WAY and `oncancel` is REQUIRED** — the dialog never closes itself. It was briefly
a `$bindable` no consumer bound, which meant Cancel wrote a local override that only re-synced
because `oncancel` happened to change the parent expression; a consumer omitting `oncancel` would
have got a dialog that closed once and could never reopen, silently.

→ **Don't hand a value to a submit through a bound hidden `<input>`.** Svelte flushes template
effects in a microtask, but `requestSubmit()` dispatches `submit` synchronously and SvelteKit's
`enhance` builds `new FormData(form)` before its first `await` — so the POST carries the PREVIOUS
value and only a second click works. Set it on the `FormData` inside the enhance callback.
