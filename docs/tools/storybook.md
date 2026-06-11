# Invisible Storybook

Browse published [Storybook](https://storybook.js.org/) builds in the launcher —
the engine reference (apps/lines) and one per project — without checking out the
repo or running a dev server.

**Access:** sign in at `app.invisiblewall.org` → **Invisible Storybook** (`/storybook`).
The picker lists every storybook you may open: the shared engine reference plus
each project you have access to that has a published build. Selecting one opens
the static Storybook site full-page.

## Where builds live (R2)

| Storybook                     | R2 prefix                       | Who can view                      |
| ----------------------------- | ------------------------------- | --------------------------------- |
| Engine reference (apps/lines) | `_shared/storybook/engine/`     | anyone entitled to the tool       |
| Per-project                   | `<client>/<project>/storybook/` | users with access to that project |

## Publishing

The publish script builds (or takes a pre-built `storybook-static/`), uploads it
with correct content-types, and **prunes stale keys** (storybook hashes its
filenames, so the prefix would otherwise grow forever). It needs `R2_ENDPOINT`,
`R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` in the env.

Two supported flows:

**1. Engine reference** — build in `apps/lines`, publish with `--shared`:

```bash
cd apps/lines && pnpm build-storybook
node ../../apps/launcher-api/scripts/publish-storybook.mjs --shared --dir storybook-static
```

**2. A game's storybook** — build it wherever it can build (the game repo, once
it has a `.storybook/` config; or any checkout that can build it), then publish
**from an engine checkout** with `--project` and `--dir`:

```bash
node apps/launcher-api/scripts/publish-storybook.mjs \
  --project <client>/<project> --dir <path-to-storybook-static>
```

The scaffolded `pnpm publish:storybook` in a fresh game repo (new-game.mjs) is
this same command, but it does **not** work out of the box: the scaffold writes
no `.storybook/` config (so there's no `storybook-static/` to upload yet), and
the publish script's `@aws-sdk/client-s3` dependency is not installed by the
engine submodule — to publish from inside a game repo, `pnpm add -D
@aws-sdk/client-s3` there first (the script then resolves the SDK from the
game repo's `node_modules`).

```bash
# Preview without writing anything:
node apps/launcher-api/scripts/publish-storybook.mjs --shared --dir apps/lines/storybook-static --dry-run
```

Run `node apps/launcher-api/scripts/publish-storybook.mjs --help` for all flags.
