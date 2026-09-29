# Invisible FTP Browser — status

> Guide: [docs/tools/ftp-browser.md](../tools/ftp-browser.md) · Agent: none yet (launcher tool — closest owner `.claude/agents/launcher-studio.md`)

**One-line state:** shipped — in-launcher R2 file manager. Non-admins get the active project's `<client>/<project>/` tree; admins get the whole bucket plus a read-only Postgres view. The scoped operations and the admin view are still owed a live browser pass.

## Current state

Live in the launcher at `/files` (full page, `admin` + `developer` + `pipelineTester` + `audio`; artists/animators don't get it). Every operation is gated and validated **server-side** — the client UI is never trusted.

- **Scoped mode (non-admin holders)** — a file manager for the shared R2 bucket (`invisibleassets`) **strictly locked to the session-bound active project**. The root is the project's single unified prefix `<client>/<project>/` (`toolScope.allowedPrefixes`; layout in [unified-project-repo.md](../design/unified-project-repo.md)), so every asset-typed subtree of the project is visible there. No other project's files and no `_shared/` library (the FTP gate opts into none of the shared prefixes).
- **Full server mode (admin)** — a two-tab browser: **R2 Storage** (the whole bucket from root — every client/project, `_shared`, `comfyui-models`, …) and **Railway (Postgres)** (read-only DB inspector).
- **Operations** — browse/navigate (folders-first listing with size + last-modified, breadcrumb, `Load more` paging), download (attachment stream), upload/overwrite (multipart, per-request size cap, filenames sanitized to a bare basename), delete (single / multi-select / recursive folder — R2 has no native folder so it enumerates every key), move/rename (copy-then-delete; folder moves re-base every key). All destructive actions confirm first; listing refreshes after any mutation.
- **Railway/Postgres tab (admin-only)** — `GET /api/db/{tables,rows}` behind `gateFull`; lists `public` base tables, pages rows (limit≤200), **secrets redacted server-side** (`password|secret|hash` masked; bearer-like ids truncated). Read-only.

### Scope / security model
- `gate()` (`src/lib/server/ftpScope.ts`, a thin wrapper over the shared `toolScope.gate`) requires an authed user with the `ftpBrowser` entitlement, resolves `(client, project)` from the **session row** (never a request param), and flags `full` for the built-in `admin` role. `gateFull()` additionally requires `full`.
- **Scoped:** `allowedPrefixes(client, project)` is the only key set in scope. **Full:** the whole bucket, `assertAllowed` only enforcing escape-free keys.
- **Writes** (upload, move destinations) go through `assertWritable`: `assertAllowed` plus a refusal of storybook trees (`_shared/storybook/`, `<client>/<project>/storybook/`), which are served as live pages and only published by `publish-storybook.mjs`.
- **Content types:** an upload is stored with the type derived from its extension (`$lib/server/userContent.ts`), never the browser's `File.type`; downloads are always `attachment` + `nosniff` + a locked-down CSP. The same helper serves project content elsewhere in the launcher, where HTML/SVG/XML/unknown types are always sent as downloads (#827).
- `assertAllowed(key, scope)` rejects empty / leading-`/` / `..` / (scoped) out-of-prefix keys → 403, applied to every supplied key **and** every server-enumerated key (recursive delete/move re-validate each — defense in depth).

## Open items / next
1. No "new empty folder" — folders exist only as key prefixes (a folder appears once a file is uploaded into that path).
2. Uploads are multipart through the launcher and held in memory — bounded by the request-body limit (`BODY_SIZE_LIMIT`, 32 MB default in `scripts/start.mjs`) before the route's own 200 MB cap. Big files need a presigned direct-to-R2 path like the sound upload's.
3. Backlog: extract the `<R2Browser>` shared component from `ftpScope.ts` + `api/files` (reuse-check §, `docs/ui-inventory.md`) — infra done, extraction pending.

## ⏳ Live-verify (not yet browser-tested against live R2)
- Scoped mode: binary upload, recursive delete/move, `Load more` pagination, `%2F`-encoded `CopySource` move/rename.
- Admin full-server view + Railway/Postgres tab (code only, 2026-06-02) — not yet browser-tested live.

## Recent changes
- 2026-09-28 — upload stores the extension-derived type; storybook trees refused as write targets; download headers from the shared `userContent` helper (see [launcher status](launcher.md) same date)
- 2026-06-02 — admin two-tab **full-server view**: whole-bucket browse + Railway/Postgres inspector (`/api/db/{tables,rows}`, `gateFull`, secrets redacted) — code only ([detail in history](../history.md))
- 2026-05-31 — project-scoped R2 file manager shipped (`ftpBrowser` tool, `/files`, `ftpScope.ts` gate, `r2.ts` put/delete/copy/list helpers); registered + doc ([detail in history](../history.md))
