# Invisible FTP Browser

Browse and manage the cloud asset storage for the active project — upload,
download, move/rename, and delete files and folders — without leaving the
launcher.

## What it is

An in-launcher, full-page file manager for the shared Cloudflare R2 bucket
(`invisibleassets`). It is **strictly scoped to the active client/project**: it
only ever shows the namespaces that belong to the project you currently have
selected. There is no way to see another client's or project's files, and no
cross-project `_shared` access.

- **Where it runs:** the launcher itself, at `/files` (a real page inside
  `(app)`, behind the auth + role gate — not a redirect, not an iframe).
- **Storage layout:** the canonical per-project tree
  `<toolNs>/<client>/<project>/…`. The browser exposes these namespaces as the
  top-level folders: `atlas_maker`, `sheet_maker`, `localization`, `editor`,
  `spines`.
- **Access:** `admin` and `developer` roles only (artists/animators don't get
  it). Overridable per role/user via the admin panel like any other tool.

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

## Security model

Every operation is gated and validated **server-side** — the client UI is never
trusted:

- The shared `gate()` (`src/lib/server/ftpScope.ts`) requires an authenticated
  user with the `ftpBrowser` tool entitlement, then resolves the **session-bound
  active project** to its `(client, project)`. The project comes from the
  session row, not from any request parameter, so a user can only ever act on a
  project they've actually switched to.
- `allowedPrefixes(client, project)` builds the only key prefixes that are in
  scope — the project's own tool namespaces, nothing else.
- `assertAllowed(key)` rejects any key that is empty, starts with `/`, contains
  `..`, or falls outside those prefixes, throwing `403`. It is applied to every
  supplied key **and** to every key discovered server-side (recursive
  delete/move re-validate each enumerated key — defense in depth).
- Uploads sanitize each filename to a bare basename (no path separators, no
  escapes) before building the destination key, and enforce a per-request size
  cap.

## API endpoints

All under `/api/files/`, each re-running the shared gate:

- `GET list?prefix=&token=` — folder listing (`{ folders, files, nextToken }`);
  empty prefix returns the namespace roots.
- `GET download?key=` — attachment stream.
- `POST upload` — multipart (`prefix` + one or more `file`).
- `POST delete` — JSON `{ keys?: string[] }` or `{ prefix }` (recursive).
- `POST move` — JSON `{ from, to }` (file or folder; trailing `/` = folder).

## Known limitations / TODOs

- Folders only exist as key prefixes, so there's no "new empty folder" — a
  folder appears once you upload a file into that path.
- Uploads are held in memory server-side; very large files are capped per
  request. Not yet smoke-tested against live R2.
- Large-folder pagination (`Load more`) and recursive move/delete on very large
  trees need live verification.
