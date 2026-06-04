# Unified project repo — one R2 tree per (client, project)

Status: design proposal (2026-06-02). **Supersedes the per-tool split** introduced in
[`r2-client-isolation-and-scaffold.md`](./r2-client-isolation-and-scaffold.md) — but only
the `<tool>/` top-level segment. **Client/project isolation is preserved**; we are
reorganizing _within_ a project, not loosening separation.

## 0. Goal & motivation

Today every tool owns a separate top-level R2 namespace keyed by the same `(client, project)`:

```
atlas_maker/<C>/<P>/…   sheet_maker/<C>/<P>/…   localization/<C>/<P>/…   editor/<C>/<P>/…   spines/<C>/<P>/…
```

Consequences the owner hit in practice:
- The Sheet Maker can't see manifests authored in the Atlas Maker — they live in different trees, bridged only by a one-way Sheet→Atlas copy ([`sheet_server.py:360-368`](../../services/sheet-tool/sheet_server.py), [`cloud_paths.py:111-113`](../../services/sheet-tool/cloud_paths.py)).
- "Where did my asset go" confusion: each tool hydrates only its own slice.
- The editor has to read across five namespaces to assemble one palette ([`projectAssets.ts:53-108`](../../apps/launcher-api/src/lib/server/projectAssets.ts)).

**Target:** one project repository `<C>/<P>/` that all tools read and write, organized by
**asset type** (not by tool), so a project is a single coherent folder.

### What stays the same
- **Client/project isolation** — still `<C>/<P>` at the root; nothing leaks across clients.
- **The launcher → tool contract** — the launcher still passes `client` + `project` on the redirect; tools still resolve them the same way.
- **`test_server/<gameKey>/`** — published game bundles are keyed by game key, an orthogonal axis. **Unchanged.**
- **Per-service staging disks** — each tool still hydrates into its own local `/tmp` staging tree (keyed by `<C>/<P>`); only the **R2 prefix** unifies.

### What changes
- The `<tool>/` top-level segment is **removed**.
- Each tool's subfolders are remapped onto a shared, asset-typed layout (below).
- `manifests/` becomes a **single shared folder** both Atlas + Sheet read/write → the Sheet→Atlas copy is retired and issue #1 (Sheet can't see Atlas manifests) dissolves.
- Cross-project shared spines move under a root `_shared/` area.

## 1. Canonical unified schema

Slug rule unchanged: `^[a-z0-9][a-z0-9_-]{0,63}$`. Reserved client `unassigned`; default project `cloud`.

Per-project layout (C = client key, P = project key):

| Subfolder                     | Producer(s)            | Holds                                                            |
| ----------------------------- | ---------------------- | --------------------------------------------------------------- |
| `<C>/<P>/atlas_config.json`   | Atlas Maker            | Atlas tool config (comfy key stripped)                          |
| `<C>/<P>/sheet_config.json`   | Sheet Maker            | Sheet tool config                                               |
| `<C>/<P>/input/`              | Atlas Maker            | reference images; `input/refs/atlas/<name>.atlas` + page bitmaps (geometry). Kept as `input/` so manifest-relative `refs/atlas/<name>` paths stay valid (no double-`refs`). |
| `<C>/<P>/sheet_src/<sheet>/`  | Sheet Maker            | uploaded loose sprite PNGs, per sheet (own folder so the Atlas `input/` hydrate never pulls sheet sprites) |
| `<C>/<P>/manifests/`          | **Atlas + Sheet (shared)** | `atlas_manifest_*.json` (+ legacy `.atlas`)                 |
| `<C>/<P>/atlas/`              | Atlas Maker            | composed atlas pages (`<stem>_new.{png,webp,atlas}`)            |
| `<C>/<P>/batch/`             | Atlas Maker            | ComfyUI-generated variants                                      |
| `<C>/<P>/sheets/<sheet>/`     | Sheet Maker            | packed `<basename>.{png,atlas,json}` (manifest goes to `manifests/`) |
| `<C>/<P>/deploy/`             | Atlas Maker            | deploy-ready final assets in the game's `static/assets/` shape — **the game asset contract; builds pull from here** (see `docs/design/live-assets.md`) |
| `<C>/<P>/spines/<bundle>/`    | Spine sync             | spine atlas/png/skeleton per bundle                             |
| `<C>/<P>/localization/strings.json` | Localization     | translated strings                                              |
| `<C>/<P>/editor/scenes.json` | Editor                 | scene layout doc                                                |

Root-level, **outside** any single project:

| Prefix                  | Notes                                                                |
| ----------------------- | -------------------------------------------------------------------- |
| `_shared/spines/<bundle>/` | spine bundles shared across projects (was `spines/_shared/<bundle>/`) |
| `test_server/<gameKey>/`   | published game bundles + `test_server/games.json` — **unchanged**    |

### Key semantics
- **`manifests/` is shared.** An Atlas-authored and a Sheet-authored `atlas_manifest_<name>.json` with the same `<name>` resolve to the **same** key — this is the intended single-source-of-truth behavior (it already happens today via the Sheet→Atlas copy). Tools must treat a write as upsert.
- The old double-nesting `output/<P>/atlas` / `output/<P>/batch` (the redundant `<P>` segment) **goes away** — now just `atlas/` / `batch/`.

## 2. Single source of truth — `projectPrefix(client, project)`

Two parallel builders must change **together** and stay byte-identical:

### TS (launcher) — [`projectPaths.ts`](../../apps/launcher-api/src/lib/server/projectPaths.ts)

```ts
export const UNASSIGNED_CLIENT = 'unassigned';

/** Root of one project's R2 repository. Was `${tool}/${client}/${project}`. */
export function projectPrefix(client: string, project: string): string {
	assertSlug(client); assertSlug(project);
	return `${client}/${project}`;
}

// Asset-type subfolders — the one place each path lives.
export const SUB = {
	manifests:  (c: string, p: string) => `${projectPrefix(c, p)}/manifests`,
	refs:       (c: string, p: string) => `${projectPrefix(c, p)}/refs`,
	atlas:      (c: string, p: string) => `${projectPrefix(c, p)}/atlas`,
	sheets:     (c: string, p: string) => `${projectPrefix(c, p)}/sheets`,
	deploy:     (c: string, p: string) => `${projectPrefix(c, p)}/deploy`,
	spines:     (c: string, p: string) => `${projectPrefix(c, p)}/spines`,
	localization:(c: string, p: string) => `${projectPrefix(c, p)}/localization`,
	editor:     (c: string, p: string) => `${projectPrefix(c, p)}/editor`,
} as const;
export const sharedSpinesPrefix = (bundle: string) => `_shared/spines/${bundle}`;
```

### Python (shared) — [`iw_common/context.py`](../../services/_shared/iw_common/context.py)

```py
def project_prefix(client: str, project: str) -> str:
    """Root of one project's R2 repo. Replaces prefix_for_tool(tool, c, p)."""
    return f"{client}/{project}"
```

`ToolContext.r2_project_prefix(client, project)` drops `self.tool_namespace` and returns
`project_prefix(client, project)`. The `tool_namespace` field is **retained** (it still names
the per-service staging dir and the banner) but no longer prefixes R2 keys. `prefix_for_tool`
is kept as a thin deprecated shim for one cycle, then removed once the Sheet→Atlas caller is gone.

## 3. Per-tool `resolve()` remap

### Atlas Maker — [`cloud_paths.py`](../../services/atlas-tool/cloud_paths.py)
Staging root unchanged (`STAGING_BASE/<C>/<P>`). R2 subfolder mapping:

| resolve() key  | old R2 subfolder           | new R2 subfolder |
| -------------- | -------------------------- | ---------------- |
| `manifest_dir` | `atlas_maker/<C>/<P>/manifests` | `<C>/<P>/manifests` |
| `input_dir`    | `atlas_maker/<C>/<P>/input`     | `<C>/<P>/input`     |
| `atlas_dir`    | `atlas_maker/<C>/<P>/output/<P>/atlas` | `<C>/<P>/atlas` |
| `batch_dir`    | `atlas_maker/<C>/<P>/output/<P>/batch` | `<C>/<P>/batch` |
| deploy target  | `atlas_maker/<C>/<P>/deploy`    | `<C>/<P>/deploy`    |
| config         | `atlas_maker/<C>/<P>/atlas_config.json` | `<C>/<P>/atlas_config.json` |

`comfy_filename_prefix_base` recomputes from the new prefix (already lifted from `resolve()`,
no functional change). `_mirror`/`_unmirror` key by relative path under `R2_PREFIX` — they keep
working once `R2_PREFIX` = `<C>/<P>` and the staging subdirs match the new names.

### Sheet Maker — [`cloud_paths.py`](../../services/sheet-tool/cloud_paths.py) + [`sheet_server.py`](../../services/sheet-tool/sheet_server.py)

| resolve() key | old R2 subfolder            | new R2 subfolder |
| ------------- | --------------------------- | ---------------- |
| `input_dir`   | `sheet_maker/<C>/<P>/input/<sheet>` | `<C>/<P>/sheet_src/<sheet>` |
| `output_root` | `sheet_maker/<C>/<P>/output/<sheet>` | `<C>/<P>/sheets/<sheet>` |
| manifest write| `…/output/<sheet>/atlas_manifest_*.json` **+** copy to `atlas_maker/<C>/<P>/manifests/` | `<C>/<P>/manifests/atlas_manifest_*.json` (single write) |
| config        | `sheet_maker/<C>/<P>/sheet_config.json` | `<C>/<P>/sheet_config.json` |

**Retire** `atlas_maker_manifest_prefix()` and the cross-tool `storage.put` copy
([`sheet_server.py:360-368`](../../services/sheet-tool/sheet_server.py)) — the manifest now lands
in the shared `manifests/` directly. The Sheet browser's "projects" mode lists `manifests/`
(shared), so it sees Atlas-authored manifests automatically.

### Hydrate scope (both tools)
Each tool must pull the shared `manifests/` so it sees the other's work. Proposed split,
mirroring today's sync/background pattern:
- **Sync pull** (small, needed for the file list): `manifests/`, `*_config.json`.
- **Background pull** (heavy, only for editing): the tool's own producer subfolders (Atlas: `refs/ atlas/ batch/ deploy/`; Sheet: `input/sheets/ sheets/`).
- A tool does **not** need to pull the other tool's heavy outputs; it only shares `manifests/`. (If we later want full cross-tool asset editing, widen the background pull to the whole `<C>/<P>/` tree — flagged as a follow-up, not part of this change.)

> ⚠️ `pull_prefix` skips files whose local size matches (write-once heuristic). With a shared
> `manifests/`, a manifest re-saved at the **same byte size** by the other tool would not refresh
> in an already-hydrated staging dir until restart. Low-probability, but the refresh button
> (already added to both tools) + force-hydrate covers it; note it in the tool docs.

## 4. Launcher-side changes

| File | Change |
| --- | --- |
| [`projectPaths.ts`](../../apps/launcher-api/src/lib/server/projectPaths.ts) | `projectPrefix(client, project)` (drop tool arg); add `SUB.*` + `sharedSpinesPrefix`. |
| [`toolScope.ts`](../../apps/launcher-api/src/lib/server/toolScope.ts) | `allowedPrefixes()` returns the single `<C>/<P>/` prefix (+ `_shared/spines/` read). `PROJECT_TOOL_NS` removed. The FTP browser then exposes the whole project tree. |
| [`projectScaffold.ts`](../../apps/launcher-api/src/lib/server/projectScaffold.ts) | Seed one tree: `<C>/<P>/{atlas_config.json, sheet_config.json, manifests/.keep, refs/.keep, localization/strings.json, editor/scenes.json}`. |
| [`localization.ts`](../../apps/launcher-api/src/lib/server/localization.ts) | `docKey` → `${SUB.localization(c,p)}/strings.json`. |
| [`editorStorage.ts`](../../apps/launcher-api/src/lib/server/editorStorage.ts) | scenes key → `${SUB.editor(c,p)}/scenes.json`. |
| [`spine.ts`](../../apps/launcher-api/src/lib/server/spine.ts) | per-project bundle → `${SUB.spines(c,p)}/<bundle>`; shared fallback → `sharedSpinesPrefix(bundle)`. |
| [`projectAssets.ts`](../../apps/launcher-api/src/lib/server/projectAssets.ts) + `editorRegions.ts` | Cross-namespace reads collapse to one tree: `manifests/`, `atlas/`, `sheets/`, `spines/`. **Net simplification.** |
| [`(app)/{atlas,sheet}/+page.server.ts`](../../apps/launcher-api/src/routes/(app)) | No change to the contract — still redirect with `&client=&project=`. |
| [`scripts/r2-sync-spines.mjs`](../../apps/launcher-api/scripts/r2-sync-spines.mjs) | Target `${SUB.spines(c,p)}/<bundle>` instead of legacy `spines/hotfruits`. |
| [`seed_r2.py`](../../services/atlas-tool/seed_r2.py) | Write the unified layout. |

## 5. Migration — copy → verify → retire (idempotent, dry-run default)

New script `scripts/migrate-r2-unified-repo.py` (boto3, R2 creds from env, `--dry-run` default-on).
Per `(C, P)` resolved from Postgres `projects` (NULL `clientKey` → `unassigned`):

**Phase A — copy (non-destructive, server-side `CopyObject`):**

| Source (old)                                  | Dest (new)                          |
| --------------------------------------------- | ----------------------------------- |
| `atlas_maker/<C>/<P>/manifests/*`             | `<C>/<P>/manifests/*`               |
| `atlas_maker/<C>/<P>/input/*`                 | `<C>/<P>/input/*`                   |
| `atlas_maker/<C>/<P>/output/<any>/atlas/*`    | `<C>/<P>/atlas/*`                   |
| `atlas_maker/<C>/<P>/output/<P>/batch/*`      | `<C>/<P>/batch/*`                   |
| `atlas_maker/<C>/<P>/deploy/*`                | `<C>/<P>/deploy/*`                  |
| `atlas_maker/<C>/<P>/atlas_config.json`       | `<C>/<P>/atlas_config.json`         |
| `sheet_maker/<C>/<P>/input/<sheet>/*`         | `<C>/<P>/sheet_src/<sheet>/*`       |
| `sheet_maker/<C>/<P>/output/<sheet>/atlas_manifest_*.json` | `<C>/<P>/manifests/<that>.json` |
| `sheet_maker/<C>/<P>/output/<sheet>/*` (png/.atlas/json) | `<C>/<P>/sheets/<sheet>/*`     |
| `sheet_maker/<C>/<P>/sheet_config.json`       | `<C>/<P>/sheet_config.json`         |
| `localization/<C>/<P>/strings.json`           | `<C>/<P>/localization/strings.json` |
| `editor/<C>/<P>/scenes.json`                  | `<C>/<P>/editor/scenes.json`        |
| `spines/<C>/<P>/<bundle>/*`                   | `<C>/<P>/spines/<bundle>/*`         |
| `spines/_shared/<bundle>/*`                   | `_shared/spines/<bundle>/*`         |
| `spines/hotfruits/*` (legacy, one-time map)   | `borut/hotfruits/spines/<bundle>/*` |

Log every `(src, dst, size)`; skip when dst exists with matching `ETag`; **verify per-prefix counts** (old vs new) before printing "ready for Phase B".

**Phase B — retire (after cutover verified):** `DeleteObjects` the old `atlas_maker/`,
`sheet_maker/`, `localization/`, `editor/`, and migrated `spines/` prefixes in batches.
Refuses to run without `--phase=b --i-verified-cutover`.

**Existing real data:** `atlas_maker/borut/hotfruits/` (from [`seed_r2.py`](../../services/atlas-tool/seed_r2.py)) + legacy `spines/hotfruits`. These are the concrete prefixes Phase A must move.

## 6. Cutover plan

1. **Phase A copy** — run with `--dry-run`, review the move log, then for real. Verify counts.
2. **Deploy code** to `main` (auto-deploy). Both source-of-truth builders flip together.
   Behind `FEATURE_OLD_PATHS_FALLBACK=1`: on a 404 read, tools/launcher also try the old
   `<tool>/<C>/<P>/…` key for one deploy cycle (covers any object missed by Phase A).
3. **Restart** atlas-tool + sheet-tool (they hydrate at boot) — the deploy restart handles this.
4. **Smoke test** per tool on Borut/HotFruits: Atlas manifest list, Sheet "projects" list now
   shows the **same** manifests; upload/generate/compose/export/deploy round-trips; localization,
   spine, editor palette.
5. **Phase B retire** — `--phase=b --i-verified-cutover`.
6. Remove `FEATURE_OLD_PATHS_FALLBACK` from env + code.

**Rollback:** Phase A is non-destructive (old prefixes intact until Phase B). To roll back, revert
the deploy and unset the flag; data is untouched.

## 7. Risks

- **Two builders must change atomically.** TS (launcher) writes/reads and Python (tools) read/write
  the same keys — a mismatch silently splits data again. Mitigation: change both in one PR, the
  fallback flag, and a smoke test that asserts a launcher-written key is read by the tool.
- **Shared `manifests/` name collisions** — an Atlas and a Sheet manifest with the same `<name>`
  now overwrite. This is the intended single-source behavior, but worth a UI note ("saving
  overwrites the project manifest of the same name").
- **`pull_prefix` size-skip staleness** on the shared `manifests/` (see §3 warning).
- **Slug hyphen/underscore bug** (`bug_launcher_slug_hyphen`) still lurks — the launcher allows
  hyphen keys while Python `safe_proj_name` rewrites to `_`. Migration must use the **R2-verbatim
  slug** both tools actually use, or data lands under a divergent prefix. Fix that bug first, or
  pin the migration to the exact existing keys.
- **toolScope/FTP** must accept the new single prefix before the tools write it, or scoped reads 403.
- **Staging disk** on Railway grows if hydrate scope widens; keep the §3 sync/background split.

## 8. Decisions — RESOLVED (2026-06-02, owner: "go ahead")

1. **Subfolder names** — Atlas inputs stay at `<C>/<P>/input/` (NOT `refs/` — keeping `input/` means manifest-relative `refs/atlas/<name>` paths stay valid and avoids a `refs/refs/atlas` double-nest). Sheet sprites get their own `<C>/<P>/sheet_src/<sheet>/` (so the Atlas `input/` hydrate never pulls them). `atlas/` + `batch/` sit at the project root.
2. **Config files** — kept separate (`atlas_config.json` + `sheet_config.json`); zero collision, smaller diff.
3. **Cross-tool editing** — share `manifests/` now; widen the hydrate to the whole tree later if needed.
4. **Spines** — folded into `<C>/<P>/spines/` + cross-project `_shared/spines/`. Legacy pre-isolation prefixes (e.g. `spines/hotfruits`) need an explicit `--legacy-spine` map at migration time.
5. **Slug hyphen bug** — fixed as part of this work: a single canonical `r2_slug` (lowercase, non-alphanumerics → `_`, 60-char cap) in `iw_common.context`, the launcher (`r2Slug`), `seed_r2.py`, atlas-backend, and the migration script — all byte-identical.
6. **Sequencing** — game-cards (needs DB password) + atlas→game live-assets sync remain parked behind this.

## 9. Implementation status (2026-06-02)

**Code — DONE, builds/compiles clean** (not yet committed/deployed):
- Python: `iw_common/context.py` (r2_slug + project_prefix), both `cloud_paths.py`, `atlas-tool/{ui_server,batch_atlas}.py`, `sheet-tool/sheet_server.py`, `atlas-tool/seed_r2.py`, `atlas-backend/{paths,workflows}.py`.
- Launcher: `projectPaths.ts` (r2Slug + projectPrefix + SUB), `toolScope.ts`, `projectScaffold.ts`, `spine.ts`, `projectAssets.ts`, `editorRegions.ts`, `scripts/r2-sync-spines.mjs`.
- Migration: `scripts/migrate-r2-unified-repo.py` (dry-run default; `--apply`, `--verify`, `--phase-b --i-verified-cutover`).

**Remaining (needs R2 creds + a deploy window):** run Phase A dry-run → `--apply` → deploy code + restart tools → smoke-test → `--phase-b`. See §6.

## 10. Cutover — COMPLETE (2026-06-02)

Shipped to `main` and executed end-to-end:
- Phase A copied **3731** objects into the unified layout (+ stragglers re-synced as the tools kept being used); verified.
- Code deployed: Python tools (committed alongside the lazy-hydrate/FX work) + launcher (`d839f62`) both on the unified layout; the launcher's hyphen/underscore slug bug fixed.
- Smoke-tested on Borut/HotFruits + bookofborut: Sheet Maker loads shared manifests, packs generation manifests, and opens packed `.atlas` via the R2 Import browser.
- **Phase B deleted 4902 old objects** — `atlas_maker/ sheet_maker/ localization/ editor/ spines/` (per-tool namespaces), the stale `book_of_borut` dupe, and the `cloud/batch`+`cloudtest/batch` strays. New layout intact (borut/hotfruits 1255, bookofborut 1292, unassigned/cloud 1158, invisible_wall/test1 42, salmons 11, borut/cloud 6).
- The lone `localization/cloud/strings.json` orphan (old client-less default) was deleted afterward — R2 is now fully clean (every old per-tool namespace lists 0 objects).

Decisions captured: kept the active `bookofborut`, dropped the stale `book_of_borut`; `spines/hotfruits/*` legacy folded into `borut/hotfruits/spines/`.
