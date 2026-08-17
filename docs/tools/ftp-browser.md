# Invisible FTP Browser

Browse and manage the cloud asset storage for the active project — upload,
download, move/rename, and delete files and folders — without leaving the
launcher.

## What it is

An in-launcher, full-page file manager. There are **two modes, decided by role**:

- **Scoped mode** (`developer` and other non-admin holders of the tool): a file
  manager for the shared Cloudflare R2 bucket (`invisibleassets`), **strictly
  scoped to the active client/project**. It only ever shows the namespaces that
  belong to the project you currently have selected — no other client's/project's
  files, no cross-project `_shared` access.
- **Full server mode** (`admin`): a two-tab "full server" browser:
  - **R2 Storage** — the WHOLE `invisibleassets` bucket from the root, browse
    anywhere (every client/project, `_shared`, `comfyui-models`, …).
  - **Railway (Postgres)** — a read-only inspector for the launcher's Railway
    Postgres database (list tables, page through rows). See below.

- **Where it runs:** the launcher itself, at `/files` (a real page inside
  `(app)`, behind the auth + role gate — not a redirect, not an iframe).
- **Storage layout (scoped mode):** the canonical per-project tree
  `<toolNs>/<client>/<project>/…`. The browser exposes these namespaces as the
  top-level folders: `atlas_maker`, `sheet_maker`, `localization`, `editor`,
  `spines`.
- **Access:** `admin`, `developer`, `pipelineTester` and `audio` (Music / SFX) roles
  — artists/animators don't get it.
  Overridable per role/user via the admin panel like any other tool. The full
  server view + the Railway/Postgres tab are **admin-only**; a non-admin with the
  tool always gets the scoped, project-locked view.

## Operations

- **Browse / navigate** — folders first, then files with name, human-readable
  size, and last-modified. Click a folder to descend; a breadcrumb walks back
  up. "Load more" pages large folders.
- **Download** — streams the object as an attachment.
- **Upload / overwrite** — multipart upload of one or more files into the
  current folder. Re-uploading the same name overwrites it (this is also how you
  "update" a file).
- **Delete** — a single file, a multi-select of files, or a whole folder
  **recursively** (R2 has no native folder, so the recursive delete enumerates
  every key under the prefix).
- **Move / rename** — works on files and folders. R2 has no native move, so the
  server copies then deletes; folder moves re-base every key under the prefix.

All destructive actions confirm first, and the listing refreshes after any
mutation.

## Railway (Postgres) tab — admin only

A read-only inspector for the launcher's Railway Postgres, backed by
`src/lib/server/dbBrowser.ts` and `GET /api/db/{tables,rows}` (both behind
`gateFull` — admin role required):

- **Tables** — only `public`-schema base tables are listed (introspected from
  `information_schema`).
- **Rows** — one page at a time (`limit`/`offset`, default 50, capped at 200),
  with a Prev/Next pager and total count.
- **Secrets are redacted server-side** so a browse can never leak credentials:
  columns matching `password|secret|hash` are fully masked (`••••••`); bearer-
  token-like ids (`sessions.id`, `login_attempts.key`) are truncated to a short
  prefix.
- It is **read-only** — no insert/update/delete. Use `/admin` for managing
  users/projects/sessions.

## Security model

Every operation is gated and validated **server-side** — the client UI is never
trusted:

- The shared `gate()` (`src/lib/server/ftpScope.ts`) requires an authenticated
  user with the `ftpBrowser` tool entitlement, then resolves the **session-bound
  active project** to its `(client, project)` and flags `full` for the built-in
  `admin` role. The project comes from the session row, not from any request
  parameter, so a non-admin can only ever act on a project they've switched to.
  `gateFull()` additionally requires `full` (admin) — used by the `/api/db/*`
  endpoints.
- **Scoped mode:** `allowedPrefixes(client, project)` builds the only key
  prefixes in scope — the project's own tool namespaces, nothing else.
- **Full mode:** `assertAllowed` only enforces that keys are escape-free
  (non-empty, no leading `/`, no `..`); the whole bucket is in scope.
- `assertAllowed(key, scope)` rejects any key that is empty, starts with `/`,
  contains `..`, or (in scoped mode) falls outside the allowed prefixes, throwing
  `403`. It is applied to every supplied key **and** to every key discovered
  server-side (recursive delete/move re-validate each enumerated key — defense in
  depth).
- Uploads sanitize each filename to a bare basename (no path separators, no
  escapes) before building the destination key, and enforce a per-request size
  cap.

## API endpoints

All under `/api/files/`, each re-running the shared gate:

- `GET list?prefix=&token=` — folder listing (`{ folders, files, nextToken }`);
  empty prefix returns the namespace roots (scoped) or the live bucket root
  (full/admin).
- `GET download?key=` — attachment stream.
- `POST upload` — multipart (`prefix` + one or more `file`).
- `POST delete` — JSON `{ keys?: string[] }` or `{ prefix }` (recursive).
- `POST move` — JSON `{ from, to }` (file or folder; trailing `/` = folder).

Railway/Postgres tab, under `/api/db/` (admin-only, `gateFull`):

- `GET tables` — `{ tables: string[] }` (public base tables).
- `GET rows?table=&limit=&offset=` — `{ columns, rows, total }` (secrets
  redacted).

## Known limitations / TODOs

- Folders only exist as key prefixes, so there's no "new empty folder" — a
  folder appears once you upload a file into that path.
- Uploads are held in memory server-side; very large files are capped per
  request. Not yet smoke-tested against live R2.
- Large-folder pagination (`Load more`) and recursive move/delete on very large
  trees need live verification.
