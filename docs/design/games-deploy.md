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
- it must pin a **specific, known-good engine version** — an engine change on
  `main` must never silently alter a shipped game;
- it has its own deploy target.

So each standalone game lives in **its own repo**, with this engine vendored as a
**git submodule** pinned to a commit on `main`. This pattern already exists and
works: **Book of Borut** (`Projects/iGaming/Borut/Book of Borut`).

```
book-of-borut/                 ← the game's own repo + own deploy
├── engine/                     ← git submodule → Invisible-Engine @ <pinned sha>
├── src/                        ← the game (components, game logic, assets)
├── pnpm-workspace.yaml         ← packages: ["engine/packages/*", "."]
├── package.json                ← engine packages via workspace:*
├── svelte.config.js            ← extends engine's config-svelte
└── vite.config.js              ← extends config-vite; fs.allow opened to engine/
```

| Repo | Contains | Deploys as |
|---|---|---|
| `Invisible-Engine` (this one) | engine + packages + launcher + pipeline tools; `apps/{lines,…}` as **dev/reference** games | launcher-api on Railway; tools on Railway |
| `book-of-borut` (+ each future game) | one game, engine as submodule | its own frontend deploy, **pinned** engine version |

**The `apps/{lines,cluster,…}` here are reference/template games for engine
development — not the shipped artifacts.** Shipped games are separate repos.

### Spin up a new game

```bash
node scripts/new-game.mjs --name "Book of Foo" --port 3003
```

This bootstraps the repo + engine submodule + the engine-consumption wiring
(workspace, configs, Vite `fs.allow`) to match Book of Borut, then prints the
push/deploy steps. Start from the placeholder route it writes, or copy `src/`
from an existing game.

### Bump the engine in a game (deliberate, never automatic)

```bash
cd engine && git fetch && git checkout main && git pull && cd ..
git add engine && git commit -m "games: bump engine to <short-sha>"
```

The game takes new engine work only when you choose to — that's the whole point
of pinning.

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
