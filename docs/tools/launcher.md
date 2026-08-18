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

| Role | Label in the UI | Tools |
|---|---|---|
| `admin` | Admin | all tools |
| `developer` | Developer | every online tool except the Sheet Maker, plus the desktop Invisible Launcher |
| `artist` | Artist | the art + authoring set: Atlas Maker, Sheet Maker, ComfyUI, Scene Editor, Flow, FX, Flipbook, Symbols SM, Component Editor, Font Maker, Game Config, Localization, Win Text, + the desktop Invisible Launcher |
| `animator` | Animator | Invisible Spine Viewer, Invisible Rigger, Spine Editor |
| `pipelineTester` | Pipeline Tester | the whole authoring + build chain to test it end to end (Game Maker, Game Config, Scene Editor, Flow, FX, Flipbook, Symbols SM, Component Editor, Atlas Maker, Sheet Maker, Font Maker, Spine Viewer, Localization, Win Text, FTP Browser, Storybook, desktop Invisible Launcher) — **without** the publish capabilities, which stay admin-default |
| `localizationReviewer` | Localization Reviewer | Invisible Localization, Invisible Win Text |
| `audio` | Music / SFX | Invisible FTP Browser (deliver audio into the project storage), Invisible Storybook, desktop Invisible Launcher — there is no dedicated audio tool yet |

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
- **`/admin`** (admins only) — tabbed: Users, Roles, Tools, Projects, Clients,
  Games, Sessions, **Costs**, Settings.
- **Sign out** — header form posting to `/auth/logout`.

### Admin → Costs

What the pipeline is spending, per provider, read live from each provider's own
API and cached for ten minutes (**Refresh** re-reads now).

| Provider | Shows | Needs |
|---|---|---|
| **RunPod** (GPU) | real prepaid **balance**, burn rate, per-pod $/hr, runway | `RUNPOD_API_KEY` — already set for the `/comfyui` card, so this card works with no extra setup |
| **Railway** (services + Postgres) | current-cycle estimated cost, broken down by measurement | `RAILWAY_API_TOKEN` (account or **workspace** token — a project token uses a different header and won't work), `RAILWAY_PROJECT_ID` |
| **Cloudflare R2** (assets) | stored GB, class A/B operation counts, derived cost | `CF_ACCOUNT_ID`, `CF_ANALYTICS_TOKEN` (Account → Account Analytics: Read — the existing `CF_API_TOKEN` is zone-scoped for cache purge and **cannot** read this) |
| **OpenAI** (translations) | spend by line item | `OPENAI_ADMIN_API_KEY` — an **admin** key (`sk-admin-…`) mintable only by an org **Owner**; a project key (`sk-proj-…`) gets 401 |
| **Anthropic** (Claude API) | spend by model / cost type | `ANTHROPIC_ADMIN_API_KEY` — an **admin** key (`sk-ant-admin…`), a different credential from `ANTHROPIC_API_KEY`; it reads usage and cannot spend |

Only **one** LLM card shows: `translate.ts` uses an OpenAI-compatible endpoint
when `LOCALIZATION_LLM_BASE_URL` + `LOCALIZATION_LLM_API_KEY` are set and
Anthropic otherwise, so the page shows the card for whichever provider is
actually being billed (or either one that holds an admin key).

Two labels carry meaning and are worth reading:

- **`live`** — the provider's own billed figure.
- **`estimate`** — our arithmetic over the provider's usage counters. R2 has no
  billing API at all, so its dollar figure is stored bytes and operation counts
  multiplied by the published rates. Reconcile estimates against the provider's
  invoice, not against this page.

A provider with no credentials still renders a card, naming the env vars it
wants. That is deliberate: a missing card would read as "$0".

**Prepaid top-ups.** Only RunPod publishes a balance. Anthropic reports spend
but never a remaining balance, and Railway and R2 have no prepaid concept — so
for those you record what you added, and the page derives *credit left ≈
recorded top-ups − measured spend since your first entry*. That figure is only
as good as the ledger: it assumes the balance started at zero and that every
top-up is recorded. Anthropic is the only provider it is derived for, because
it is the only one whose spend can be measured from an arbitrary start date;
the others show the recorded total without a derived remainder.

## Config / env (names only — values in Railway)

`DATABASE_URL`, `ORIGIN`, `REMEMBER_TTL_DAYS`, `SESSION_TTL_HOURS`,
`RESEND_API_KEY`, `R2_*` (R2 access for spine assets), `ATLAS_BACKEND_URL`,
`ATLAS_TOOL_URL` (has a code default so it works without the dashboard),
`ATLAS_TOOL_SECRET` (optional gate), `ATLAS_MANIFEST_KEY`, `ATLAS_STYLE_REF_KEY`.

Admin → Costs (all optional, read-only, each degrades to a "not configured"
card): `RAILWAY_API_TOKEN`, `RAILWAY_PROJECT_ID`, `CF_ACCOUNT_ID`,
`CF_ANALYTICS_TOKEN`, `OPENAI_ADMIN_API_KEY`, `ANTHROPIC_ADMIN_API_KEY`.

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
