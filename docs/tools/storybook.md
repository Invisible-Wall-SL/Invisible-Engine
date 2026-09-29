# Invisible Storybook

Browse published [Storybook](https://storybook.js.org/) builds in the launcher — the engine
reference (apps/lines) and one per project — without checking out the repo or running a dev
server.

## What it is

A picker over every Storybook build that has been published to the shared asset storage. Each
build is a static Storybook site; opening one serves it full-page from the launcher.

- **Where it runs:** the launcher itself, at `/storybook` — a full-page tool inside the signed-in
  area, never an iframe. An opened build lives under `/storybook/view/…`, behind the same sign-in
  and access check.
- **Access:** the `admin`, `developer`, `pipelineTester` and `audio` (Music / SFX) roles get it by
  default; admins can grant or revoke it per role or per user in the admin panel.
- **What you can see:** the shared engine reference is open to anyone who has the tool; a
  project's build is listed only if you have access to that project.

| Storybook                     | Stored under                    | Who can view                      |
| ----------------------------- | ------------------------------- | --------------------------------- |
| Engine reference (apps/lines) | `_shared/storybook/engine/`     | anyone entitled to the tool       |
| Per-project                   | `<client>/<project>/storybook/` | users with access to that project |

## How to use it

1. Sign in at `app.invisiblewall.org` and open **Invisible Storybook** (`/storybook`). The top bar
   shows how many storybooks you can open.
2. Each published build is a card: the name (**Invisible Engine** for the engine reference, else
   the project's name), a detail line (*engine reference (apps/lines)*, or the client and project
   key), and a **shared** badge on the engine reference.
3. Click a card to open that Storybook full-page. Use the browser's Back button to return to the
   picker.

If nothing has been published that you can see, the page says so and names the publish commands
below.

### Publishing a build

Builds are published from a checkout with the publish script — not through the launcher, and not
through the **Invisible FTP Browser**, which refuses uploads into a `storybook/` folder. The
script builds (or takes a pre-built `storybook-static/`), uploads it with correct content-types,
and **prunes stale keys** (Storybook hashes its filenames, so the folder would otherwise grow
forever). It needs `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` in the
env.

**1. Engine reference** — build in `apps/lines`, publish with `--shared`:

```bash
cd apps/lines && pnpm build-storybook
node ../../apps/launcher-api/scripts/publish-storybook.mjs --shared --dir storybook-static
```

**2. A game's storybook** — build it wherever it can build (the game repo, once it has a
`.storybook/` config; or any checkout that can build it), then publish **from an engine
checkout** with `--project` and `--dir`:

```bash
node apps/launcher-api/scripts/publish-storybook.mjs \
  --project <client>/<project> --dir <path-to-storybook-static>
```

```bash
# Preview without writing anything:
node apps/launcher-api/scripts/publish-storybook.mjs --shared --dir apps/lines/storybook-static --dry-run
```

Run `node apps/launcher-api/scripts/publish-storybook.mjs --help` for all flags.

## Known limitations / TODOs

- **`pnpm publish:storybook` in a new game repo does not work out of the box.** The scaffold
  (`new-game.mjs`) adds the script but writes no `.storybook/` config, so there is no
  `storybook-static/` to upload yet, and the script's `@aws-sdk/client-s3` dependency is not
  installed by the engine submodule. To publish from inside a game repo, `pnpm add -D
  @aws-sdk/client-s3` there first (the script then resolves the SDK from the game repo's
  `node_modules`), or publish from an engine checkout as above.
- **No publishing from the launcher.** A build only appears after someone runs the publish script;
  there is no button that builds or refreshes one.
- **Builds run under a locked-down page policy.** A story can load from HTTPS hosts (web fonts,
  asset CDNs, an RGS), but not over plain HTTP and not through browser plugins. A story that
  needs either will not work here.
