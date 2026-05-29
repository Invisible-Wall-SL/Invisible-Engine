# Onboarding

Welcome. This is a Turborepo + pnpm monorepo: a Stake-Engine fork (Svelte 5 + PixiJS 8) plus a Studio/pipeline platform (launcher + cloud asset tools). Read order: this file → root `CLAUDE.md` → `docs/INFRA.md` → `docs/STATUS.md`.

## Prerequisites
- **Node ≥ 22.16.0**
- **pnpm 10.5.0** (`corepack enable` then `corepack prepare pnpm@10.5.0 --activate`). **Always use `pnpm`** — never npm/yarn.
- For the Python tools (`services/atlas-*`): Python 3.12+.

## First-time setup
```bash
pnpm install
# Enable the shared git hooks (secret-scan on commit) — REQUIRED:
git config core.hooksPath scripts/git-hooks
```

## Run things
```bash
pnpm dev          # all dev servers (Turbo)
pnpm build        # build everything
pnpm storybook    # component explorer
pnpm lint         # ESLint
pnpm format       # Prettier
pnpm e2e          # Playwright
```
Per-app (e.g. `apps/lines`): `pnpm dev` (Vite, port 3001), `pnpm storybook` (6001). Launcher: `apps/launcher-api` dev on **3010**.

## Where things live
- `apps/` — the games + `launcher-api` (the Studio portal).
- `packages/` — shared libs (`pixi-svelte` is the core declarative PixiJS↔Svelte bridge).
- `services/atlas-backend` — FastAPI generation backend (Python).
- `services/atlas-tool` — the re-hosted Python Atlas Maker (Python).
- `docs/` — INFRA, STATUS, this file.
- `.claude/` — agents, skills, commands for working with Claude here.

## How we work (hard rules — also enforced in CLAUDE.md)
- **Never commit secrets.** The pre-commit hook scans for them; don't bypass it. Secrets go in env vars only.
- **Always push** after you commit (Railway auto-deploys from `main`; local commits do nothing).
- **No iframes for tools** — tools are full-page (redirect or same-origin serve).
- **Engine changes go on `main`**, via feature branches; never per-game engine branches.
- **Don't dismantle** the Turborepo/pnpm-workspace structure.
- TypeScript everywhere, no `any` unless unavoidable. Prettier (tabs, single quotes, 100 cols).

## Deploying
Railway auto-deploys each service from `main` on push. For the full checklist (build → push → verify the running service actually picked it up) use the **`/deploy`** skill, or read `.claude/skills/deploy/SKILL.md`.

## Working with Claude in this repo
- Domain subagents exist for focused work: **engine-pixi-svelte**, **atlas-python-tools**, **infra-railway**, plus **code-reviewer**. Use them for tasks in their area.
- Skills: **`/deploy`** (deploy checklist).
- Keep `docs/STATUS.md` updated as you finish work — it's the shared memory across people and sessions.
