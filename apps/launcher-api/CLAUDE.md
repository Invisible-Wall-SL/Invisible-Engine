# launcher-api — Claude guide

The Studio portal at `app.invisiblewall.org` (Railway service `launcher`, + Postgres — see `docs/INFRA.md`). SvelteKit 2 + Svelte 5, `adapter-node`. Invite-only email+password auth (scrypt), sessions in Postgres/Drizzle, roles + per-role tool manifest. Dev port **3010**.

## Layout
- `src/routes/(app)/` — authed area (the `+layout.server.ts` enforces login). Every tool page lives here. Routes OUTSIDE `(app)` are public (`/login`, `/auth/*`) or authenticate themselves (`src/routes/api/`).
- `src/lib/roles.ts` — the tool registry (`TOOLS`) + which tools each role gets (`ROLE_TOOLS`). Add a tool here.
- `src/lib/server/` — `auth.ts` (sessions/scrypt), `env.ts` (typed env access), `r2.ts` (R2 client), `db/` (Drizzle).

## Conventions specific here
- **Tools are FULL-PAGE — never iframes.** A tool either renders inside the launcher, or `throw redirect(303, …)`s after the auth+role gate (atlas/sheet → the external tool with a signed launch token, `$lib/server/toolLaunch.ts`; rig/rigger → a static `view.html`). Keep one of these shapes for new tools.
- **Every tool renders the shared `ToolTopBar`.** `$lib/ToolTopBar.svelte` (emblem → home, current tool name, online-tool switcher) is the header for every launcher tool. **It owns its own `<header class="iw-toolbar">` chrome** — render it DIRECTLY inside your `.shell`/`.page` (`<ToolTopBar current="<toolId>" tools={data.tools} [clientKey] [projectKey] />`); do NOT wrap it in your own `<header>` or restyle the bar. Page-specific right-aligned header content (counters, save pill, …) goes through the `{#snippet meta()}…{/snippet}` child so the chrome stays identical on every tool. Register the tool in `roles.ts` and add it to `TOOL_BAR_ORDER`. See `docs/design/unified-tool-bar.md` + `docs/ui-inventory.md` §7. (Python tools — atlas/sheet — render a visually identical `.iw-toolbar` HTML twin; keep them in sync.)
- **Env access goes through `ENV` in `src/lib/server/env.ts`.** For non-secret config (URLs, flags), give it a **code default** there — Railway env vars are easy to mis-apply (they stage), so don't make the app depend on the dashboard. Example: `ATLAS_TOOL_URL` defaults to the tool's known URL.
- Svelte 5 runes; SvelteKit file conventions; TypeScript, no `any`; Prettier (tabs, single quotes, 100 cols).

## Validate / ship
- `pnpm --filter launcher-api build` before committing — but **it is NOT a type-check**. `build` is a bare
  `vite build`: Vite *transpiles* TS and strips types without checking them, there's no `check` script,
  and `svelte-check` isn't a dep. **A type error compiles and ships green** (verified 2026-07-17 by
  deleting a required key from a `Record<Union, true>` and watching the build pass). So the build proves
  "it bundles", never "it's correct".
- **What does run:** `pnpm lint` from the repo root (ESLint 9 with the `eslint-suppressions.json`
  baseline — a NEW violation fails CI; run it from the root, not the package, or the baseline doesn't
  apply) and `pnpm check:undefined-names` (a narrow `tsc` pass for names that don't exist, `.ts` and
  `.svelte`). Both run in `lint.yml`, with the launcher's `check:*` fixtures.
- **Therefore: don't rely on a compile-time guard here.** Prefer designs a missing type can't break —
  derive a runtime list from ONE exported value rather than hand-copying it behind a type
  (`COMPONENT_PARAM_KINDS` in `engine-layout` is the worked example: a copied `ComponentParam.kind`
  allowlist in `componentStorage.ts` silently stripped author params *twice* before it was made an
  import). Verify contracts offline in a Node fixture over the real modules; note the built `dist/`
  is not directly runnable (extensionless imports), so bundle with esbuild first.
- **DB:** change `src/lib/server/db/schema.ts`, run `pnpm --filter launcher-api db:generate`, commit the
  new `drizzle/` migration. The launcher applies it itself at boot (`hooks.server.ts` `init` →
  `runMigrations()`), so schema + code ship in one deploy, and `/api/health` reports
  `schema: current` once it has. **Never `db:push` against production** — it records nothing in the
  migrations journal (`docs/INFRA.md` "Auto-migrate on boot"). `db:seed` seeds a local DB.
- Deploy = push to `main` (auto-deploy). Use the `/deploy` skill. After pushing, verify the live build:
  `/_app/version.json` is SvelteKit's build stamp (see `docs/INFRA.md` "How to tell whether a push
  actually deployed").

See `docs/INFRA.md` and `docs/status/launcher.md`.
