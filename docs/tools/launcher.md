# The Launcher

The Studio portal — your single entry point to every Invisible tool.

## What it is

A SvelteKit (adapter-node) web app that authenticates you, figures out which
tools your role is entitled to, and opens each one full-page. It is the front
door for the whole pipeline: online tools are reached *through* the launcher
(it forwards your session), and local tools are listed here for you to install.

- **Source:** `apps/launcher-api/`
- **Live URL:** **app.invisiblewall.org**
- **Where it runs:** cloud — Railway project `Invisible launcher`, with a
  Postgres database for users and sessions.

## Signing in

Access is **invite-only**: an admin creates your account. You sign in with
**email + password** (passwords are hashed with scrypt). A "remember me" option
keeps you signed in for longer (`REMEMBER_TTL_DAYS`); normal sessions last
`SESSION_TTL_HOURS`. Sessions are stored server-side in Postgres.

1. Go to `app.invisiblewall.org` — if you're not signed in you land on `/login`.
2. Enter your email + password.
3. You arrive at the launcher home: your tools grouped into **Online tools**
   and **Local tools**.

## Roles and the tool manifest

Every account has one role, and each role sees a different set of tools. The
registry lives in `apps/launcher-api/src/lib/roles.ts` (`TOOLS` = every tool;
`ROLE_TOOLS` = which tools each role gets):

| Role | Tools |
|---|---|
| **admin** | all tools |
| **developer** | Invisible Atlas Maker, Invisible Spine Viewer, ComfyUI |
| **artist** | Invisible Atlas Maker, ComfyUI, Invisible Sheet Maker |
| **animator** | Invisible Spine Viewer, Spine Editor |

Tools are typed `online` (opened in the browser) or `local` (installed on your
machine). Online tool cards are clickable and link straight into the tool;
local tool cards show an "install" tag.

## How tool pages work

**Tools are always full-page — never iframes.** Each online tool route
(`/atlas`, `/spine`) is a server `load` that:

1. redirects to `/login` if you're not authenticated;
2. returns **403** if your role isn't entitled to that tool;
3. otherwise `throw redirect(303, …)` straight to the tool.

For the Atlas Maker, the redirect target is the external tool URL
(`ATLAS_TOOL_URL`), with an optional shared secret appended as `?k=<secret>` so
the tool's own gate lets you in (only the launcher knows the secret). For the
Spine Viewer it redirects to the static `/spine/view.html` document served by
the launcher itself.

## Other pages

- **`/onboarding`** ("Getting started" link in the header) — a guided
  walkthrough. Currently a first version; a fuller per-role onboarding is
  planned (backlog B6).
- **Sign out** — header form posting to `/auth/logout`.

## Config / env (names only — values in Railway)

`DATABASE_URL`, `ORIGIN`, `REMEMBER_TTL_DAYS`, `SESSION_TTL_HOURS`,
`RESEND_API_KEY`, `R2_*` (R2 access for spine assets), `ATLAS_BACKEND_URL`,
`ATLAS_TOOL_URL` (has a code default so it works without the dashboard),
`ATLAS_TOOL_SECRET` (optional gate), `ATLAS_MANIFEST_KEY`, `ATLAS_STYLE_REF_KEY`.

Non-secret config (URLs, flags) is given a **code default** in
`src/lib/server/env.ts` because Railway env vars only *stage* until you click
"Apply changes / Deploy".

## Running locally (developers)

```bash
pnpm --filter launcher-api dev      # dev server on port 3010
pnpm --filter launcher-api build    # build + type-check (no separate check script)
```
DB helpers: `db:generate` / `db:migrate` / `db:push` / `db:seed`.
Deploy = push to `main` (Railway auto-deploys); verify the live URL picked it up.

## Known limitations / TODOs

- **DNS must stay grey-cloud (DNS-only):** `app` is a CNAME to Railway;
  proxying through Cloudflare breaks Railway's TLS.
- Onboarding is a basic first version (backlog B6).
- Local-tool download links + per-user install paths are not yet persisted
  (backlog B5) — local tool cards currently only describe the tool.
- TODO: confirm a single launcher/Postgres behind `app.invisiblewall.org`
  (backlog B3) so users/sessions aren't split across duplicate services.
