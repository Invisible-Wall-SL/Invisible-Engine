# Repo strategy & games deployment

> Decided 2026-06-03. Answers a recurring question: "we used to have separate
> repos (engine / launcher / pipeline / games) — should we split again, and how
> do shipped game frontends deploy?"

## The two things that look like one problem

1. **A messy, hard-to-track history** on a single `main`. This is a *hygiene*
   problem, not an architecture problem — see "History hygiene" below.
2. **Where shipped game frontends live and deploy.** This *is* an architecture
   question, and the answer is: games get their own repos.

Don't solve #1 by splitting the engine/tools/launcher back apart — that
re-introduces real pain (below) to fix a cosmetic one.

## Why engine + tools + launcher stay in ONE repo

The engine (`packages/*`), the games used for engine dev (`apps/{lines,…}`), the
launcher (`apps/launcher-api`), and the pipeline tools (`services/*`) all share
code through **`workspace:*`** dependencies. The launcher and editor import the
same engine packages the games do.

Splitting these into separate repos means every engine change becomes: publish a
version → bump it in the launcher repo → bump it in each tool repo → reconcile
lockfiles. That version-coordination tax is exactly what a monorepo exists to
remove, and it's why the old engine/launcher/pipeline split was retired. We are
**not** un-doing that.

## Games ARE the legitimate split

A shipped game is different from engine-dev code:

- it ships to a client and deploys on **its own cadence**;
- it can pin a **specific engine commit** for a hand-over, so a delivered build is
  reproducible;
- it has its own deploy target.

So each standalone game lives in **its own repo**, with this engine vendored as a
**git submodule**.

```
book-of-foo/                   ← the game's own repo + own deploy
├── engine/                     ← git submodule → Invisible-Engine (branch main)
├── static/                     ← boot assets; pull:assets mirrors R2 over them
├── pnpm-workspace.yaml         ← packages: ["engine/packages/*", "."]
├── package.json                ← engine packages via workspace:*
├── svelte.config.js            ← extends engine's config-svelte
└── vite.config.js              ← extends config-vite; fs.allow opened to engine/
```

**There is no `src/`, and that is the design.** The game layer is compiled from
`engine/apps/lines/src` — `config-svelte` points SvelteKit's `kit.files` there
(`packages/config-svelte/appSrc.js`) — which is the *same source*
`runtime-release.yml` builds the shared online bundle from. A game repo owns its
identity, its `static/` and its lockfile; the game itself is authored online
(scenes, flow, symbols, sounds, config) and baked in at build time.

Repos used to carry a scaffold-time COPY of `apps/lines/src`, and it went stale
immediately — the desktop launcher advances the submodule to `origin/main` before
every build, so `packages/*` were current while the game layer was frozen at
scaffold day, and 53 of the last 60 engine commits touch `apps/lines/src`. See
the 2026-09-17 entry in [status/engine](../status/engine.md). A leftover `src/` in
an older repo is ignored, with a build-log notice naming `git rm -r src`.

| Repo | Contains | Deploys as |
|---|---|---|
| `Invisible-Engine` (this one) | engine + packages + launcher + pipeline tools; `apps/{lines,…}` as **dev/reference** games | launcher-api on Railway; tools on Railway |
| each shipped game | one game's identity + assets, engine as submodule (no `src/`) | its own frontend deploy |

**The `apps/{lines,cluster,…}` here are reference/template games for engine
development — not the shipped artifacts.** Shipped games are separate repos.

### Spin up a new game

```bash
node scripts/new-game.mjs --name "Book of Foo" --port 3003
```

This bootstraps the repo + engine submodule + the engine-consumption wiring
(workspace, configs, Vite `fs.allow`) and seeds `static/`, then prints the
push/deploy steps. It writes no application source — there is none to write.

### Which engine a build gets

A **desktop-launcher publish** advances the submodule to `origin/main` first, so a
published build is always on the latest engine. That is the normal path and needs
no action.

The **committed pin** is what a plain `git clone` + `pnpm build` gets, and it is
what a hand-over should be cut from. Move it deliberately — the pin and the
lockfile must travel together, or the launcher's frozen install fails with
`ERR_PNPM_OUTDATED_LOCKFILE`:

```bash
node engine/scripts/bump-game-engine.mjs      # advances engine + lockfile, one commit
```

## History hygiene (fixes the "messy commits" feeling without splitting)

The single `main` is kept *filterable per area* by three things:

1. **Scoped commit subjects** — every commit starts with an area scope
   (`engine:`, `launcher:`, `editor:`, `atlas-tool:`, `docs:`, …). Enforced by
   the `commit-msg` hook (`scripts/check-commit-scope.mjs`; allowed scopes
   listed there). Then `git log --grep '^launcher:'` shows just that area.
2. **Squash-merge PRs** — each PR lands as **one** commit on `main` (the PR
   title, which must carry a scope), not 3–4 WIP commits + a merge commit. The
   repo is configured squash-only with auto-delete of the merged branch.
3. **CODEOWNERS** (`.github/CODEOWNERS`) — the canonical path→area map; also
   auto-requests review. Keep its area names in sync with the commit scopes.

### Enable the hooks (once per clone)

```bash
git config core.hooksPath scripts/git-hooks
```

This activates both the secret scanner (`pre-commit`) and the scope check
(`commit-msg`). Genuine one-off bypass: `git commit --no-verify`.
