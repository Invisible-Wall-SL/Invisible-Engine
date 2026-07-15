# Invisible FTP Browser — status

> Guide: [docs/tools/ftp-browser.md](../tools/ftp-browser.md) · Agent: none yet (launcher tool — closest owner `.claude/agents/launcher-studio.md`)

**One-line state:** shipped (code) — in-launcher R2 file manager; non-admins get a project-scoped view, admins get a whole-bucket + read-only Railway/Postgres view. ⏳ not yet browser-tested against live R2.

## Current state

Live in the launcher at `/files` (full page, `admin` + `developer`; artists/animators don't get it). Every operation is gated and validated **server-side** — the client UI is never trusted.

- **Scoped mode (non-admin holders)** — a file manager for the shared R2 bucket (`invisibleassets`) **strictly locked to the session-bound active project**. Top-level folders = the project's own tool namespaces (`atlas_maker`, `sheet_maker`, `localization`, `editor`, `spines`) under `<toolNs>/<client>/<project>/…`. No other project's files, no cross-project `spines/_shared/`.
- **Full server mode (admin)** — a two-tab browser: **R2 Storage** (the whole bucket from root — every client/project, `_shared`, `comfyui-models`, …) and **Railway (Postgres)** (read-only DB inspector).
- **Operations** — browse/navigate (folders-first listing with size + last-modified, breadcrumb, `Load more` paging), download (attachment stream), upload/overwrite (multipart, per-request size cap, filenames sanitized to a bare basename), delete (single / multi-select / recursive folder — R2 has no native folder so it enumerates every key), move/rename (copy-then-delete; folder moves re-base every key). All destructive actions confirm first; listing refreshes after any mutation.
- **Railway/Postgres tab (admin-only)** — `GET /api/db/{tables,rows}` behind `gateFull`; lists `public` base tables, pages rows (limit≤200), **secrets redacted server-side** (`password|secret|hash` masked; bearer-like ids truncated). Read-only.

### Scope / security model
- `gate()` (`src/lib/server/ftpScope.ts`, a thin wrapper over the shared `toolScope.gate`) requires an authed user with the `ftpBrowser` entitlement, resolves `(client, project)` from the **session row** (never a request param), and flags `full` for the built-in `admin` role. `gateFull()` additionally requires `full`.
- **Scoped:** `allowedPrefixes(client, project)` is the only key set in scope. **Full:** the whole bucket, `assertAllowed` only enforcing escape-free keys.
- `assertAllowed(key, scope)` rejects empty / leading-`/` / `..` / (scoped) out-of-prefix keys → 403, applied to every supplied key **and** every server-enumerated key (recursive delete/move re-validate each — defense in depth).

## Open items / next
1. No "new empty folder" — folders exist only as key prefixes (a folder appears once a file is uploaded into that path).
2. Uploads held in memory server-side; very large files capped per request — needs a streaming path for big files.
3. Backlog: extract the `<R2Browser>` shared component from `ftpScope.ts` + `api/files` (reuse-check §, `docs/ui-inventory.md`) — infra done, extraction pending.

## ⏳ Live-verify (not yet browser-tested against live R2)
- Scoped mode: binary upload, recursive delete/move, `Load more` pagination, `%2F`-encoded `CopySource` move/rename.
- Admin full-server view + Railway/Postgres tab (code only, 2026-06-02) — not yet browser-tested live.

## Recent changes
- 2026-06-02 — admin two-tab **full-server view**: whole-bucket browse + Railway/Postgres inspector (`/api/db/{tables,rows}`, `gateFull`, secrets redacted) — code only ([detail in history](../history.md))
- 2026-05-31 — project-scoped R2 file manager shipped (`ftpBrowser` tool, `/files`, `ftpScope.ts` gate, `r2.ts` put/delete/copy/list helpers); registered + doc ([detail in history](../history.md))
