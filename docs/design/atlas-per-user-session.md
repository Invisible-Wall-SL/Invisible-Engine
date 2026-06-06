# Pipeline tools — per-user session (selection / open-location isolation)

Status: **planned** (not yet implemented).

Owner decision 2026-06-06: **every user gets their own session in every pipeline
tool** (Atlas Maker **and** Sheet Maker) so people don't (a) clobber each other's
*open location / working selection* or (b) see each other's render/progress.
Scope is **selection-only**: keep R2 `<client>/<project>/deploy/` (and the
committed project artifacts) as the single shared source of truth — do NOT fork
manifests/assets per user, and do NOT add a publish step or edit-lock.

### Accepted residual (owner decision)
Selection-only isolates *which file each person is in* and their job/progress —
**not** a lock on identical edits. If two users open the **exact same** file
(same manifest, or same-named sheet), they still write the same shared file and
can overwrite each other. That trade-off is accepted for now; the upgrade path if
it ever bites is the rejected "shared assets + edit-lock" option (see History).

## The problem (as observed)

Two users open a tool on the same `(client, project)`. User A browses to a
different JSON; User B opens the tool and sees **A's** JSON. The "current session"
is unique on the *server*, not per *user*.

## Root cause

The tools have **no user dimension** anywhere.

- **Atlas:** "Current JSON" is `cfg["manifest_path"]` in `atlas_config.json`, keyed
  only by `(client, project)` on disk + R2 — `ui_server.py:157`,
  `cloud_paths.py:245`. Whoever switches last wins for everyone on that project,
  and (because it's mirrored to R2 + rehydrated on boot) the wrong selection even
  survives restarts.
- **Identity never crosses the wire.** The launcher authenticates users and knows
  `locals.user.id`, but the redirects carry only `k` (shared secret) + `client` +
  `project` (`apps/launcher-api/src/routes/(app)/atlas/+page.server.ts:26-50`, and
  the sibling `sheet` route). The launcher `session` cookie is httpOnly + scoped
  to the launcher origin, so it does not cross to the tools' separate Railway
  origins. The Python services literally cannot tell two users apart.
- **Secondary leaks (Atlas):** render/progress is a process-wide global
  (`_render_state`/`_render_lock`/`_render_proc`/`_stopped`, `ui_server.py:238-242`),
  so one user's progress bar shows another user's render. Same for the transient
  banners `_load_warning` (`ui_server.py:1282`) and `_ingested_manifests`
  (`ui_server.py:1286`).
- **Sheet Maker:** compose is stateless (geometry comes from the request payload,
  `sheet_server.py:286-287`) and "which sheet I have open" is tracked client-side
  (the `sheet` name rides on each request). Its server-side shared state is the
  canvas *defaults* in `sheet_config.json` (`sheet_server.py:221-224`) plus the
  uploaded-sprite scratch pile + composed outputs under the `(client, project)`
  tree. So Sheet Maker has no server-side "current selection" to leak today — but
  it still needs the same user-id plumbing for parity and to scope any per-user
  view state (so future server-remembered state is per-user from day one).

## Scope

Per-user, when two users share a `(client, project)`:
- which file/JSON/sheet they're viewing (the selection / open location),
- their render/progress job + transient banners (Atlas).

Stays **shared** (R2 source of truth, deploy contract):
- manifest *content*, ref images, composed atlases, composed sheets, uploaded
  sprite piles, and `deploy/` assets.

## The linchpin (Atlas)

Almost every Atlas operation resolves the active manifest through one function:
`manifest_path()` → `creative_manifest_path()` → `load_config().get("manifest_path")`
(`ui_server.py:854 / 848 / 870`). Make **that one resolver user-aware** and every
save/load/render automatically targets the calling user's selected manifest — no
need to touch every endpoint or fork the staging tree.

## Build plan

### Phase 1 — Thread a stable `user` id launcher → tools
- **Launcher:** add `params.set('user', locals.user.id)` to **both** tool
  redirects — `apps/launcher-api/src/routes/(app)/atlas/+page.server.ts` and the
  `sheet` route. Use `users.id` (stable UUID), **not** the session token (rotates).
- **Tools:** parse `?user=` → thread-local + `iw_user` cookie, exactly like the
  existing `iw_client`/`iw_project` pattern — in `_resolve_context()` for both
  `services/atlas-tool/ui_server.py:3177-3223` and
  `services/sheet-tool/sheet_server.py:1066`. Fall back to `"default"` when absent
  (back-compat for direct access / old links).
- Note: `user` is a *partition key*, not a security boundary — the gate secret
  already authorizes "came from launcher", and assets are shared anyway, so
  spoofing another user's id only changes whose *view* you get.

### Phase 2 — Per-user selection (Atlas: the actual bug)
- New per-user overlay file `staging_root/.sessions/<user>.json` holding
  `{ "manifest_path": ... }` (room to grow for other view state). Mirrored to R2
  under a `.sessions/` prefix so it survives Railway restarts; kept out of the
  `deploy/` contract.
- **Resolver** (`creative_manifest_path()`, `ui_server.py:848-870`): read the
  per-user overlay first; fall back to shared `cfg["manifest_path"]` as the
  default when the user has no selection yet.
- **Writers** — route *only* `manifest_path` to the per-user overlay, leave all
  other config keys shared:
  - `_saveconfig` (`ui_server.py:4906-4947`) — split: `manifest_path` → overlay;
    pipeline/model/deploy settings → shared `atlas_config.json` as today.
  - Deep-link handler (`_handle_deeplink`, `ui_server.py:3229-3277`) — `?atlas=…`
    writes the user's overlay, so "Open in Atlas Maker" only changes *your* view.
  - Auto-create side effects (`import_sheet_to_manifest` `ui_server.py:1256`,
    import path `ui_server.py:1127`) — set the overlay, not shared config.

### Phase 3 — Per-user render/progress + transient banners (Atlas)
- Replace the module globals (`ui_server.py:238-242`) with
  `_render_sessions: dict[user_id, RenderSession]` via a `_render_session(ctx)`
  helper. `/progress`, render-start, and `/stop` operate on the calling user's
  session.
- Make `_load_warning` and `_ingested_manifests` per-user (dict keyed by user) so
  banners/dedup don't bleed.
- **Known limitation:** ComfyUI is one local GPU, so concurrent renders queue at
  ComfyUI regardless — this fixes *progress display* bleed, not parallel GPU
  throughput.

### Phase 4 — Sheet Maker parity
- With Phase 1's `user` id available, scope Sheet Maker's per-user view state the
  same way: a `.sessions/<user>.json` overlay for any server-remembered selection,
  and per-user canvas defaults instead of the shared `sheet_config.json` block
  (`sheet_server.py:221-224`) if we want each user's canvas size/padding to stick
  to them. Composed sheets, manifests, and the uploaded-sprite pile stay shared
  (deploy contract) — same accepted residual as Atlas.
- Sheet Maker has no long-running job (compose is synchronous), so there is no
  render-state global to split. Keep this phase minimal.

### Phase 5 — Verify + document
- Two-user test (two browser profiles, same project), per tool: switch the open
  file as A → B's view unchanged; (Atlas) start a render as A → B's progress stays
  clean; a direct no-`user` request still works (fallback).
- Confirm shared behavior intact: both users on the *same* selected file still
  write the same file; `deploy/` assets untouched.
- Update `docs/STATUS.md` + the `project_invisible_pipeline_tools` memory.

## Touch list
- `apps/launcher-api/src/routes/(app)/atlas/+page.server.ts` and the `sheet` route
- `services/atlas-tool/ui_server.py` (`_resolve_context`, `creative_manifest_path`,
  `_saveconfig`, `_handle_deeplink`, render-state block, banner globals)
- `services/atlas-tool/cloud_paths.py` (per-user overlay path helper + `iw_user`
  thread-local)
- `services/sheet-tool/sheet_server.py` (`_resolve_context` + `iw_user`,
  optional per-user view-state overlay)
- `services/sheet-tool/cloud_paths.py` (if a per-user path helper is needed)
- `docs/STATUS.md`

## Risk / sequencing
Phases 1–2 are what actually fix the reported "wrong JSON" leak in Atlas and are
low-risk + additive. Phase 3 (render-state refactor) carries the most weight.
Phase 4 (Sheet Maker) is small because that tool is largely stateless server-side.

## History
- Rejected alternatives (2026-06-06): "full per-user workspace" (private asset
  copies + explicit Publish step) — too heavy, breaks the single-`deploy/` model;
  and "shared assets + edit-lock" (soft-lock a file so only one user edits at a
  time) — kept as the upgrade path if the accepted residual above ever bites.
