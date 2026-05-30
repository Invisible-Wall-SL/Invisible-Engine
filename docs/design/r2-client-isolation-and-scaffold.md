# R2 client isolation + canonical project scaffold

Status: design proposal (2026-05-30). Two coupled changes:

1. **Client isolation (Option B):** R2 layout becomes `<tool>/<client>/<project>/…` (was `<tool>/cloud/<project>/…`). Storage is siloed per client.
2. **Canonical scaffold:** one source of truth for the per-project skeleton + seed files, used by both the migration and the launcher's `createProject` action.

## 1. Canonical R2 schema

Slug rule (unchanged): `^[a-z0-9][a-z0-9_-]{0,63}$` (shared by `clients.ts`, `projects.ts`, both `cloud_paths.py`). Reserved client key for legacy / NULL `client_key`: **`unassigned`** (new row inserted into `clients` as part of the migration). The default project `cloud` belongs to `unassigned` unless reassigned.

Per-project layout (T = tool namespace, C = client key, P = project key):

| Tool / area    | Prefix root                              | Subtree                                                                                     |
| -------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| Atlas Maker    | `atlas_maker/<C>/<P>/`                   | `atlas_config.json` · `manifests/*.json` · `input/refs/*.png` · `output/<prefix>/{batch,atlas}/` |
| Sheet Maker    | `sheet_maker/<C>/<P>/`                   | `sheet_config.json` · `input/<sheet>/*.png` · `output/<sheet>/{sheet.png,coords.json,manifest.json}` |
| Localization   | `localization/<C>/<P>/`                  | `strings.json`                                                                              |
| Editor (future)| `editor/<C>/<P>/`                        | `scenes.json` · `assets/*`                                                                  |
| Spine Viewer   | `spines/<C>/<P>/<bundle>/`               | atlas/png/skel — moved out of the hardcoded `spines/hotfruits`                              |

Seed files (written by `scaffoldProject` on create):

- `atlas_maker/<C>/<P>/atlas_config.json` — minimal `{ "version": 1, "output_prefix": "<P>" }`
- `atlas_maker/<C>/<P>/manifests/.keep`
- `sheet_maker/<C>/<P>/sheet_config.json` — `{ "version": 1 }`
- `localization/<C>/<P>/strings.json` — `{ "sourceLang": "en", "targetLangs": [], "context": "", "entries": [], "updatedAt": "" }`
- `editor/<C>/<P>/scenes.json` — `{ "version": 1, "scenes": [] }`

## 2. `projectPrefix()` — single source of truth

**Decision:** keep it **embedded per-tool**, not a shared package. Reasoning: the layout is one f-string per tool; a shared TS/Python package adds publish/version overhead for ~5 lines. The discipline is **one constant + one function per side**, identical names everywhere.

### TS (launcher) — `apps/launcher-api/src/lib/server/projectPaths.ts`

```ts
export type ToolNs = 'atlas_maker' | 'sheet_maker' | 'localization' | 'editor' | 'spines';
export const UNASSIGNED_CLIENT = 'unassigned';

export function projectPrefix(tool: ToolNs, client: string, project: string): string {
	return `${tool}/${client}/${project}`;
}
```

Callers: `localization.ts` (`docKey`), `spine.ts` (`SPINE_PREFIX` becomes per-project), future `editor.ts`. Each caller resolves `client` from the project row (`projects.clientKey ?? UNASSIGNED_CLIENT`).

### Python (both tools) — embedded in each `cloud_paths.py`

```py
UNASSIGNED_CLIENT = "unassigned"

def r2_project_prefix(client_key: str, proj_key: str) -> str:
    return f"{TOOL_NAMESPACE}/{client_key}/{proj_key}"
```

Module state grows by one field: `_CURRENT_CLIENT` alongside `_CURRENT_PROJECT`.

## 3. Migration plan (two-phase, idempotent)

`scripts/migrate-r2-client-isolation.py` (boto3, run from a workstation with R2 creds; dry-run flag default-on).

**Phase A — copy (non-destructive):**

1. Query Postgres `projects` → `[(key, clientKey)]`. Treat `clientKey IS NULL` as `unassigned`.
2. For each `(P, C)`:
   - `atlas_maker/cloud/<P>/…`   → `atlas_maker/<C>/<P>/…`
   - `sheet_maker/cloud/<P>/…`   → `sheet_maker/<C>/<P>/…`
   - `localization/<P>/…`         → `localization/<C>/<P>/…`
   - `spines/<oldBundleRoot>/…`   → `spines/<C>/<P>/<bundle>/…` (one-time mapping table for the HotFruits bundle).
3. Use `CopyObject` (server-side, no download). Log `(src, dst, size)`. Skip when dst already exists with same `ETag`.
4. **Verify counts** per prefix (`list_keys` old vs new) before printing the "ready for Phase B" banner.

**Phase B — delete (after cutover verified):**

1. List old prefixes again and `DeleteObjects` in batches of 1000.
2. Refuses to run unless `--phase=b --i-verified-cutover` is passed.

**Rollback:** Phase A is non-destructive — old prefixes intact. Revert deploy and resume.

## 4. Code change list

| File | Change |
| --- | --- |
| `apps/launcher-api/src/lib/server/projectPaths.ts` | NEW: `projectPrefix`, `UNASSIGNED_CLIENT`. |
| `apps/launcher-api/src/lib/server/localization.ts` | `docKey(project)` → `docKey(client, project)`; callers resolve `client` from project row. |
| `apps/launcher-api/src/lib/server/spine.ts` | `SPINE_PREFIX` removed; export `spinePrefix(client, project, bundle)`. Update `/spine` loader. |
| `apps/launcher-api/src/lib/server/projects.ts` | NEW: `scaffoldProject(clientKey, projectKey)` writing seed files via `putObjectText`. Called from `createProject` admin action. |
| `apps/launcher-api/src/lib/server/r2.ts` | No change (generic). |
| `apps/launcher-api/src/routes/(app)/admin/+page.server.ts` | After `await createProject(...)`, call `await scaffoldProject(clientKey, key)`. Add `rescaffoldProject` action. |
| `apps/launcher-api/src/routes/(app)/{atlas,sheet}/+page.server.ts` | Resolve `clientKey` from the active project row; redirect URL gains `&client=<C>`. |
| `services/atlas-tool/cloud_paths.py` | Add `_CURRENT_CLIENT`, `set_client_project(client, project)`, `switch_to(client, project)`; `r2_project_prefix(client, project)`; `resolve()` uses both; staging path becomes `STAGING_BASE/<C>/<P>`. |
| `services/atlas-tool/ui_server.py` | Read `client` from query/cookie alongside `project`; call `switch_to`. Cookie `iw_client` for stickiness. |
| `services/sheet-tool/cloud_paths.py` + `sheet_server.py` | Same pattern. `atlas_maker_manifest_prefix(client, project)`. |
| `services/atlas-tool/batch_atlas.py` | `comfy_filename_prefix_base` recomputed from new prefix (already lifted from `resolve()` dict — no functional change). |
| `services/atlas-tool/seed_r2.py` | Accept `--client` arg; default `unassigned`. |

## 5. Launcher↔tool contract

Redirect URL becomes:

```
{TOOL_URL}/?k={secret}&client={C}&project={P}
```

Tool resolution order on each request:

1. Query string `client`+`project` (highest precedence; stickies into cookies `iw_client`, `iw_project`).
2. Cookies `iw_client`+`iw_project` (sticky for the user's tab).
3. Env defaults (`unassigned` / `cloud`).

**Legacy single-`project=` requests:** the tool calls `GET {LAUNCHER_URL}/api/projects/{P}/client` (small, returns `{client}`) and falls back to `unassigned`. This avoids inventing client-resolution rules in two places.

## 6. Auto-scaffold in `createProject`

```ts
export async function scaffoldProject(client: string, project: string): Promise<void> {
	const seeds: Array<[string, string, string]> = [
		[`${projectPrefix('atlas_maker', client, project)}/atlas_config.json`, JSON.stringify({ version: 1, output_prefix: project }, null, 2), 'application/json'],
		[`${projectPrefix('atlas_maker', client, project)}/manifests/.keep`, '', 'text/plain'],
		[`${projectPrefix('sheet_maker',  client, project)}/sheet_config.json`, JSON.stringify({ version: 1 }, null, 2), 'application/json'],
		[`${projectPrefix('localization', client, project)}/strings.json`, JSON.stringify({ sourceLang: 'en', targetLangs: [], context: '', entries: [], updatedAt: '' }, null, 2), 'application/json'],
		[`${projectPrefix('editor',      client, project)}/scenes.json`, JSON.stringify({ version: 1, scenes: [] }, null, 2), 'application/json'],
	];
	for (const [k, body, ct] of seeds) {
		if (!(await objectExists(k))) await putObjectText(k, body, ct);
	}
}
```

Admin "Rescaffold" button: same call, but with `objectExists` skip (idempotent). Backfills legacy projects.

## 7. Cutover plan

1. **DB:** ensure the `unassigned` client row exists (additive seed, no migration).
2. **Phase A migration:** run `migrate-r2-client-isolation.py --phase=a`. Verify counts match.
3. **Deploy code** (`main`, auto-deploy) — launcher writes new paths; tools read new paths. Behind a `FEATURE_OLD_PATHS_FALLBACK=1` env flag both tools also try the old prefix on a 404 read, for one deploy cycle.
4. **Smoke test** atlas + sheet + localization + spine on at least one project per client.
5. **Phase B cleanup:** `migrate-r2-client-isolation.py --phase=b --i-verified-cutover`.
6. Remove `FEATURE_OLD_PATHS_FALLBACK` from env + code.

## 8. Open questions

1. **Default client name** — `unassigned` vs `default` vs `cloud` (current project name collision risk)?
2. **Spine bundles** — is HotFruits one bundle per project, or shared across projects? Affects whether `spines/<C>/<P>/<bundle>/` or `spines/<C>/_shared/<bundle>/`.
3. **Atlas Maker `output_prefix`** — currently env-driven `HotFruits`; should the scaffold lock it to `<P>` going forward?
4. **Client rename** — do we forbid renames (key is the slug everywhere), or write a key-rename migration too? Recommend forbid; rename `name` only.
5. **`/api/projects/{P}/client` endpoint** — public-readable OK, or require the shared tool secret?
6. **Sheet→Atlas manifest handoff** — currently writes into `atlas_maker/cloud/<P>/manifests/`. Confirm same client+project on both sides (yes, presumed).
