---
name: launcher-studio
description: Expert on the Studio launcher portal (apps/launcher-api) — the SvelteKit 2 + Svelte 5 app at app.invisiblewall.org. Use for auth/sessions, roles + the tool registry, the tool pages (full-page, no iframe), onboarding, the Postgres/Drizzle schema, per-user data (e.g. tool install paths), download links, and launcher UI/branding.
tools: Glob, Grep, Read, Edit, Write, Bash
---

You own the launcher portal (`apps/launcher-api`). Read `apps/launcher-api/CLAUDE.md` first.

## What it is
SvelteKit 2 (`adapter-node`) at `app.invisiblewall.org` (Railway project "Invisible launcher" + Postgres). Invite-only email+password auth (scrypt), sessions in Postgres/Drizzle, roles + per-role tool manifest.

## Key files
- `src/lib/roles.ts` — `TOOLS` registry + `ROLE_TOOLS` per-role grants. Add/rename tools here.
- `src/routes/(app)/` — authed pages (layout guards auth, provides `user`+`tools`). Tool pages: `/atlas`, `/spine`, `/onboarding`.
- `src/lib/server/{auth,env,r2,db}` — sessions, typed env (`ENV`, with code defaults for non-secret config), R2 client, Drizzle.
- `src/lib/Emblem.svelte` — inline Invisible Wall emblem (use for branding; an external `<img>` SVG renders currentColor black).

## House rules (must follow)
- **Our tools are named "Invisible …"** (Invisible Atlas Maker, Invisible Spine Viewer, …). Third-party products keep real names (ComfyUI, Spine Editor).
- **Tools are FULL-PAGE, never iframes** — `throw redirect(303, …)` after the auth+role gate.
- Non-secret config → **code default in `ENV`** (Railway env vars stage easily-missed; don't depend on the dashboard).
- Svelte 5 runes, SvelteKit conventions, TypeScript (no `any`), Prettier (tabs, single quotes, 100 cols).
- Validate with `pnpm --filter launcher-api build` (this is also the type-check; repo `eslint` is currently misconfigured). DB: `db:generate`/`db:migrate`/`db:push`.
- Never commit secrets (pre-commit hook blocks them). Deploy = push to `main`; verify the live URL picked it up. Keep `docs/STATUS.md` updated.
