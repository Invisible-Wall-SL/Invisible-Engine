# Atlas Maker — per-user session (view/selection isolation)

Status: **planned** (not yet implemented). Owner decision 2026-06-06: scope is
**view/selection only** — keep R2 `<client>/<project>/deploy/` as the single
source of truth for assets; do NOT fork manifests/assets per user.

## The problem (as observed)

Two users open the Atlas Maker on the same `(client, project)`. User A browses to
a different JSON; User B opens the atlas and sees **A's** JSON. The "current
session" is unique on the *server*, not per *user*.

## Root cause

The tool has **no user dimension** anywhere.

- "Current JSON" is `cfg["manifest_path"]` stored in `atlas_config.json`, keyed
  only by `(client, project)` on disk + R2 — `ui_server.py:157`,
  `cloud_paths.py:245`. Whoever switches last wins for everyone on that project,
  and (because it's mirrored to R2 + rehydrated on boot) the wrong selection even
  survives restarts.
- The launcher authenticates users and knows `locals.user.id`, but never forwards
  it. The atlas redirect carries only `k` (shared secret) + `client` + `project`
  — `apps/launcher-api/src/routes/(app)/atlas/+page.server.ts:26-50`. The launcher
  `session` cookie is httpOnly + scoped to the launcher origin, so it does not
  cross to the tool's separate Railway origin. The Python service literally cannot
  tell two users apart.
- Secondary leak: render/progress is a process-wide global
  (`_render_state`/`_render_lock`/`_render_proc`/`_stopped`, `ui_server.py:238-242`),
  so one user's progress bar shows another user's render. Same for the transient
  banners `_load_warning` (`ui_server.py:1282`) and `_ingested_manifests`
  (`ui_server.py:1286`).

## Scope (owner decision)

Per-user, when two users share a `(client, project)`:
- which manifest/JSON they're viewing (the selection),
- their render/progress job,
- transient banners / ingest-dedup.

Stays **shared** (R2 source of truth, deploy contract):
- manifest *content*, ref images, composed atlases, `deploy/` assets.

So two users selecting the *same* manifest still edit one shared file — that is by
design. Soft-locking manifest content (a rejected hybrid) is explicitly out.

## The linchpin

Almost every operation resolves the active manifest through one function:
`manifest_path()` → `creative_manifest_path()` → `load_config().get("manifest_path")`
(`ui_server.py:854 / 848 / 870`). Make **that one resolver user-aware** and every
save/load/render automatically targets the calling user's selected manifest — no
need to touch every endpoint or fork the staging tree.

## Build plan

### Phase 1 — Thread a stable `user` id launcher → tool
- **Launcher** (`apps/launcher-api/src/routes/(app)/atlas/+page.server.ts`): add
  `params.set('user', locals.user.id)` to the atlas redirect query. Use
  `users.id` (stable UUID), **not** the session token (rotates). The `sibling`
  (Sheet Maker) URL needs no `user` — Sheet Maker is stateless (see
  "Checked / not affected").
- **Tool** (`_resolve_context()`, `ui_server.py:3177-3223`): parse `?user=` →
  thread-local + `iw_user` cookie, exactly like the existing `iw_client`/
  `iw_project` pattern. Fall back to `"default"` when absent (back-compat for
  direct access / old links).
- Note: `user` is a *partition key*, not a security boundary — the gate secret
  already authorizes "came from launcher", and assets are shared anyway, so
  spoofing another user's id only changes whose *view* you get.

### Phase 2 — Per-user manifest selection (the actual bug)
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

### Phase 3 — Per-user render/progress + transient banners
- Replace the module globals (`ui_server.py:238-242`) with
  `_render_sessions: dict[user_id, RenderSession]` via a `_render_session(ctx)`
  helper. `/progress`, render-start, and `/stop` operate on the calling user's
  session.
- Make `_load_warning` and `_ingested_manifests` per-user (dict keyed by user) so
  banners/dedup don't bleed.
- **Known limitation:** ComfyUI is one local GPU, so concurrent renders queue at
  ComfyUI regardless — this fixes *progress display* bleed, not parallel GPU
  throughput.

### Phase 4 — Verify + document
- Two-user test (two browser profiles, same project): switch manifest as A →
  B's view unchanged; start a render as A → B's progress stays clean; a direct
  no-`user` request still works (fallback).
- Confirm shared behavior intact: both users on the *same* selected manifest still
  write the same file; `deploy/` assets untouched.
- Update `docs/STATUS.md` + the `project_invisible_pipeline_tools` memory.

## Out of scope (follow-ups)
- No soft-locking of manifest *content*.

## Checked / not affected
- **Sheet Maker** (`services/sheet-tool`) — verified 2026-06-06: **no equivalent
  bug.** Compose is stateless (geometry comes entirely from the request payload,
  `sheet_server.py:286-287`); `sheet_config.json` holds only shared canvas
  *defaults* (width/padding/rotation, read at `:221-224`), not a browsed
  selection. Nothing per-user to isolate, so no change needed there.

## Touch list
- `apps/launcher-api/src/routes/(app)/atlas/+page.server.ts`
- `services/atlas-tool/ui_server.py` (`_resolve_context`, `creative_manifest_path`,
  `_saveconfig`, `_handle_deeplink`, render-state block, banner globals)
- `services/atlas-tool/cloud_paths.py` (per-user overlay path helper + `iw_user`
  thread-local)
- `docs/STATUS.md`

## Risk
Most weight is Phase 3 (render-state refactor). Phases 1–2 are what actually fix
the reported "wrong JSON" leak and are low-risk + additive.
