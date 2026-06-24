# launcher-api — Claude guide

The Studio portal at `app.invisiblewall.org` (Railway project `Invisible launcher`, + Postgres). SvelteKit 2 + Svelte 5, `adapter-node`. Invite-only email+password auth (scrypt), sessions in Postgres/Drizzle, roles + per-role tool manifest. Dev port **3010**.

## Layout
- `src/routes/(app)/` — authed area (the `+layout.server.ts` enforces login). Tool pages live here: `/atlas`, `/spine`. Routes OUTSIDE `(app)` are public (`/login`, `/auth/*`).
- `src/lib/roles.ts` — the tool registry (`TOOLS`) + which tools each role gets (`ROLE_TOOLS`). Add a tool here.
- `src/lib/server/` — `auth.ts` (sessions/scrypt), `env.ts` (typed env access), `r2.ts` (R2 client), `db/` (Drizzle).

## Conventions specific here
- **Tools are FULL-PAGE — never iframes.** `/atlas` and `/spine` `throw redirect(303, …)` after the auth+role gate (atlas → the external tool URL; spine → static `/spine/view.html`). Keep this pattern for new tools.
- **Every tool renders the shared `ToolTopBar`.** `$lib/ToolTopBar.svelte` (emblem → home, current tool name, online-tool switcher) is the header for every launcher tool. **It owns its own `<header class="iw-toolbar">` chrome** — render it DIRECTLY inside your `.shell`/`.page` (`<ToolTopBar current="<toolId>" tools={data.tools} [clientKey] [projectKey] />`); do NOT wrap it in your own `<header>` or restyle the bar. Page-specific right-aligned header content (counters, save pill, …) goes through the `{#snippet meta()}…{/snippet}` child so the chrome stays identical on every tool. Register the tool in `roles.ts` and add it to `TOOL_BAR_ORDER`. See `docs/design/unified-tool-bar.md` + `docs/ui-inventory.md` §7. (Python tools — atlas/sheet — render a visually identical `.iw-toolbar` HTML twin; keep them in sync.)
- **Env access goes through `ENV` in `src/lib/server/env.ts`.** For non-secret config (URLs, flags), give it a **code default** there — Railway env vars are easy to mis-apply (they stage), so don't make the app depend on the dashboard. Example: `ATLAS_TOOL_URL` defaults to the tool's known URL.
- Svelte 5 runes; SvelteKit file conventions; TypeScript, no `any`; Prettier (tabs, single quotes, 100 cols).

## Validate / ship
- `pnpm --filter launcher-api build` before committing (this is also the type-check — there's no separate `check` script, and repo `eslint` is currently misconfigured).
- DB: `pnpm --filter launcher-api db:generate` / `db:migrate` / `db:push` / `db:seed`.
- Deploy = push to `main` (auto-deploy). Use the `/deploy` skill. After pushing, verify the live URL picked it up (auth routes 303→/login; new public routes 404→200).

See `docs/INFRA.md` and `docs/STATUS.md`.
