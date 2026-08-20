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
  Games, Sessions, **Costs**, Settings (deploy token, layout default, **engine
  boot mark**, ComfyUI pod fleet, edge cache).
- **Sign out** — header form posting to `/auth/logout`.

### Admin → Settings → Engine boot mark

The spine that opens **every** game — the engine's own logo, shown before the
game's own splash. This is what replaced the Stake Engine loader, so it is
deliberately admin-owned: a client editing their project cannot change it.

Pick a bundle from the **shared** spine library (`_shared/spines/`), then set:

| Field | Notes |
|---|---|
| **Spine bundle** | The `_shared/spines/<bundle>` folder. Only the shared root is offered — a same-named project bundle can never shadow the engine mark. `— none —` skips the engine splash entirely. |
| **Animation** | The clip to play. Leave blank only if the skeleton's *first* clip is the right one: a spine left on its setup pose renders **empty**, which reads as a broken splash rather than an unset one. |
| **Background** | Painted immediately, before the spine loads, so boot never flashes white. |

A bundle that is renamed or removed keeps showing in the dropdown marked
`(missing)` so you notice rather than silently getting a different logo.

#### Getting a spine INTO the shared library

Rigs are authored inside a project, so a new mark starts life at
`<client>/<project>/spines/`. **Bring a spine into the shared library** (same
card) copies one across: pick the project, pick the bundle, submit. It is a
**copy, not a link** — the engine mark opens every game, so it must not break
when that project is renamed or deleted. Re-promoting the same name overwrites
it. This is the only writer of `_shared/spines/`.

The bundle must be listed in its project's `spines/skeletons.json`, which is
what makes a folder of files loadable (it names the skeleton and the atlas). If
it isn't listed, open the rig in the [Rigger](/docs/rigger) and save — or
re-sync its atlas — first.

> **`_shared/rigs/` is a different library.** It holds skeleton *documents*
> (bones, slots, skins, animations) with **no atlas and no page textures** —
> things you *apply* onto art in the Rigger. A game cannot load one, so a rig
> there is not a boot mark. What you want is a spine **bundle**.

**When it takes effect:** on a game's **next publish** (or its next live runtime
assemble), because the mark ships through that project's `deploy/_boot/` tree.
It is not retroactive to an already-loaded page. The per-game second splash is
set separately, per project, in Scene Editor → Game Settings → Boot splash.

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

**Euros.** Every provider bills in USD, so EUR is a display conversion shown
beside each figure at the ECB reference rate (via Frankfurter), with the rate
and its publication date printed in the footer. ECB publishes once per working
day, so that date is often yesterday and holds over a weekend. If the rate can't
be fetched the page shows USD only rather than converting at a stale rate.

Two labels carry meaning and are worth reading:

- **`live`** — the provider's own billed figure.
- **`estimate`** — our arithmetic over the provider's usage counters. R2 has no
  billing API at all, so its dollar figure is stored bytes and operation counts
  multiplied by the published rates. Reconcile estimates against the provider's
  invoice, not against this page.

A provider with no credentials still renders a card, naming the env vars it
wants. That is deliberate: a missing card would read as "$0".

### Monthly history

Below the cards, one table per calendar year: a row per month with each
provider's estimated USD, the month total, the change against the previous
month, and the euro amount you were actually charged.

Months are **Europe/Madrid calendar months** grouped into **calendar years**,
matching the Spanish tax year.

A month has two states:

- **Open** — the current month, tagged `open`. Its figure is rewritten from the
  live estimate on every refresh, so it rises and falls during the month as the
  providers revise their numbers. That movement is the point, not a fault.
- **Locked** — once the month ends it is frozen at the last value observed and
  never recomputed. A filed number has to stop moving, and the providers can't
  rebuild a past month anyway (RunPod publishes no spend history at all, Railway
  reports current-cycle only, R2's analytics retention is short).

A background recorder (started with the server) snapshots every 3 hours and once
just after midnight Madrid on the 1st, so a month's figure doesn't depend on
anyone opening the page, and the lock happens minutes after the month ends.

**Every provider now produces a figure, and every figure is an estimate.**
Neither RunPod nor Railway publishes a monthly total, so each is derived:

- **RunPod** publishes a balance and a burn rate, never a period total, so its
  month is *integrated from the rate* — each snapshot adds `rate × hours since
  the last one`. A gap longer than 12 hours is capped, which under-counts a real
  outage rather than booking spend for pods that may have been stopped.
- **Railway** returns usage units with no cost measurement at all, so those
  units are priced at Railway's published rates — the same arithmetic their
  dashboard does. The units are not what their names suggest: `MEMORY_USAGE_GB`
  is GB-**minutes** and `CPU_USAGE` is vCPU-**minutes**. Verified by reconciling
  a live read against Railway's own panel: $9.18 against their $9.22, a 0.4%
  match. Note it's Railway's *projection for the whole cycle*, not
  month-to-date — the number they headline.

Any cell can still be overridden by typing in it. A typed figure renders boxed
and amber, and sets a `manual` flag that stops the recorder overwriting it;
clearing the cell hands it back to the estimator.

**The EUR column is the corrective, and the number to file.** USD is our
estimate; the euro figure is what your bank actually charged, typed in by you.
The two will never match exactly — card FX spread sits between them — so the
real debit is the authoritative one. It accepts either `1.234,56` or `1,234.56`,
so a figure copied off a Spanish statement needs no reformatting. Note this is
deliberately *not* a conversion of the USD estimate: converting January's cost
at today's rate is not valid for taxation.

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
