# The Launcher

The Studio portal — your single entry point to every Invisible tool.

## What it is

A SvelteKit (adapter-node) web app that authenticates you, figures out which
tools your role is entitled to, and opens each one full-page. It is the front
door for the whole pipeline: online tools are reached *through* the launcher
(it forwards your session), and local tools are listed here for you to install.

- **Source:** `apps/launcher-api/`
- **Live URL:** **app.invisiblewall.org**
- **Where it runs:** cloud — the `launcher` service on Railway, with a Postgres
  database for users and sessions.

## Signing in

Access is **invite-only**: an admin creates your account. You sign in with
**email + password** (passwords are hashed with scrypt). A "remember me" option
keeps you signed in for longer (`REMEMBER_TTL_DAYS`); normal sessions last
`SESSION_TTL_HOURS`. Sessions are stored server-side in Postgres.

1. Go to `app.invisiblewall.org` — if you're not signed in you land on `/login`.
2. Enter your email + password.
3. You arrive at the launcher home: your tools grouped into **Online tools**
   and **Local tools**.

### Changing your password

1. On the launcher home, click **Change password** in the header (next to
   *Getting started* and *Sign out*) — it opens `/account/password`.
2. Enter your **current password**, then the **new password** twice.
3. Click **Change password**. You see *"Password changed. Other sessions were
   signed out."* — this browser stays signed in; every other browser or device
   you were signed in on is signed out and needs the new password.

The new password must be **at least 12 characters**, must differ from the
current one, and must not be your email address. There are no other
composition rules — a long phrase is fine. A wrong current password counts as
a failed sign-in: after several in a row you are briefly locked out with
*"Too many attempts. Please wait and try again."*, exactly as on `/login`.

Passwords set before the 12-character minimum (2026-10-01) **keep working** —
nothing forces a change; the rule applies only when a password is set.

## Roles and the tool manifest

Every account has one role, and each role sees a different set of tools. The
registry lives in `apps/launcher-api/src/lib/roles.ts` (`TOOLS` = every tool;
`ROLE_TOOLS` = which tools each role gets):

| Role | Label in the UI | Tools |
|---|---|---|
| `admin` | Admin | all tools |
| `developer` | Developer | every online tool except the Sheet Maker, Invisible Director and Invisible Pipeline Changes, plus the desktop Invisible Launcher |
| `artist` | Artist | the art + authoring set: Atlas Maker, Sheet Maker, ComfyUI, Scene Editor, Flow, FX, Flipbook, Symbols SM, Component Editor, Font Maker, Game Config, Sound, Localization, Win Text, + the desktop Invisible Launcher |
| `animator` | Animator | Invisible Rig Viewer, Invisible Rigger, an external rig editor |
| `pipelineTester` | Pipeline Tester | the whole authoring + build chain to test it end to end (Game Maker, Game Config, Scene Editor, Flow, FX, Flipbook, Symbols SM, Component Editor, Atlas Maker, Sheet Maker, Font Maker, Sound, Rig Viewer, Localization, Win Text, FTP Browser, Storybook, desktop Invisible Launcher, Invisible Pipeline Changes) — **without** the publish capabilities or `pipelineMerge`, which stay admin-default |
| `localizationReviewer` | Localization Reviewer | Invisible Localization, Invisible Win Text |
| `audio` | Music / SFX | Invisible Sound (upload, audition and approve the game's music and SFX), Invisible FTP Browser, Invisible Storybook, desktop Invisible Launcher |

Tools are typed `online` (opened in the browser) or `local` (installed on your
machine). Online tool cards are clickable and link straight into the tool;
local tool cards show an "install" tag.

### Choosing a project

The **Client** and **Project** dropdowns in the header pick the project your tools
work on. Picking a project saves it to your session, and every online tool card
opens **the project the dropdown shows** (the link carries `?project=`). The
project then shows in the tool's top bar as `<client> / <project>`.

Your session is shared by all your tabs, and other tabs can change it: a Game
Maker **Publish** switches you to the project it published, and opening a tool for
another project switches you to that one. When you come back to a launcher tab, it
reloads its project list and selection, so a project created or duplicated in
another tab shows up, and the dropdown shows where your session is now.

## How tool pages work

**Tools are always full-page — never iframes.** Each online tool route is a
server `load` that:

1. redirects to `/login` if you're not authenticated;
2. returns **403** if your role isn't entitled to that tool;
3. otherwise renders the tool inside the launcher — or, for the Atlas Maker,
   Sheet Maker, Rig Viewer and Rigger, `throw redirect(303, …)` straight to it.

For the Atlas Maker, the redirect target is the external tool URL
(`ATLAS_TOOL_URL`) with a short-lived **signed launch token** (`?iw_launch=`)
naming you, your role and your current project; the tool turns it into its own
session. The Sheet Maker works the same way (see [INFRA](../INFRA.md), "Tool
launch tokens"). For the
Rig Viewer and the Rigger it redirects to their static `view.html` documents
(`/rig-viewer/view.html`, `/rigger/view.html`) served by the launcher itself.

## Other pages

- **`/onboarding`** ("Getting started" link in the header) — a walkthrough for
  your role: how the studio works, your online tools (each with a **Read the
  guide** link), your local tools (download, plus a box to save where you
  installed each one), and where to get help.
- **`/account/password`** ("Change password" link in the header) — change your
  own password; see [Changing your password](#changing-your-password).
- **`/admin`** (admins only) — tabbed: Users, Roles, Tools, Projects, Clients,
  Games, Sessions, **Costs**, Settings (deploy token, layout default, **engine
  boot mark**, ComfyUI pod fleet, edge cache, **Invisible Director** budget + prices). **Create user**'s initial
  password and a user's **Reset** password must be at least 12 characters (the
  same rule as a self-service change); a reset signs that user out everywhere.
- **Sign out** — header form posting to `/auth/logout`.

### Admin → Games

One row per game card, four columns (labelled in the header row): the **key**,
the **game name** (Rename), the **launch URL** (Save URL), and the **project
scope** (Save scope).

The scope dropdown lists **projects**, and each entry is the *project's* name —
not the game's. The two are separate records and one project usually hosts more
than one game card, so renaming a game never changes what that dropdown reads;
rename the project on the **Projects** tab if the project's own name is stale.
The scope decides where the card shows up: a game scoped to a project appears on
the home Games grid only while that project (or its client) is selected;
`Global (all projects)` shows it on every selection.

Leave the URL blank when creating and it auto-fills the standard test-server URL
for the key, including the `runtime=1` flag the shared engine bundle needs to
read the project's live authoring data. The game still has to be published to
that path to actually load.

### Admin → Projects → Migrate Book-of projects to Lines

A one-time tool at the bottom of the **Projects** tab. It turns every project of the retired
**Book of** kind into a **Lines** project whose Game Config carries the Book-of feature (the
expanding symbol), so the Invisible Test Server keeps dealing it the same game.

- **Census and dry run** lists every Book-of project with what the migration reads (its kind,
  whether its config is authored, the book symbol and its properties, bet modes, free spins, a pots
  overlay, the layout's kind, its test-server entries and game cards), then what it would change,
  what it would republish or skip, and anything that **blocks** it. It writes nothing. The top line
  also counts the games still dealt by the book mock and says whether the Book-of editor template
  exists.
- **Apply to N projects** appears under a dry run, behind the *I read this dry run* box. It
  migrates one project at a time and shows each result as it lands: it works out that project's
  plan again on the server, saves its config and its layout (each with a History backup), switches
  its kind to Lines, and republishes its online game. Results: **migrated**, **blocked** (with
  why), **republish-pending** (the kind moved but the republish did not land — run it again), or
  **error** (its message says whether running it again picks the project up).

What blocks a project, before anything is written: someone else has its `/config` or `/editor`
open; its config or layout does not read; its board is not 5×3; it has no scatter; its free spins
are switched off (turn them on in `/config`); one of its desktop builds is not marked as able to
sell bet tables ("rebuild it from the desktop launcher first"); or its republish would be refused
by a publish check (a draft sound, an invalid flow, a paytable that differs from the partner's) —
fix what it names and run the dry run again. A desktop build and a partner game's card are never
republished. A project whose republish is pending stays on the list until it lands. Running it
again after everything is done changes nothing. The owner's step-by-step runbook is in
[status/game-config](../status/game-config.md) ("Book-of migration").

### Admin → Settings → Invisible Director

- **Run budget (USD)** — the cap each Director run pauses at, asking the owner to raise it or
  stop. Default **$25**; Settings accepts $1–$500. A run copies the cap when it starts, so a change
  applies to new runs only.
- **Prices** — the table the agents are billed at: per-model $/MTok in/out, the cache read/write
  multipliers, and RunPod $/s per GPU (tagged `placeholder` until the owner confirms them). They
  come from `services/director-worker/pricing.json`, a reviewed file. The pill says `pricing.json`
  or `override`.
- **Override (optional)** — JSON in the same shape as `pricing.json`, every field optional (e.g.
  `{"perMTok":{"claude-opus-5-5":{"output":18}}}`), so a price can change without a deploy. It is
  validated on save; empty clears it. Nothing in code carries a price.
- **Abandoned mockups** — mockups uploaded on Director's New-game screen under a game key that was
  never created. **Clear abandoned mockups** deletes every such key's mockups, originals and crops
  when there is no project with that key (live or deleted), no Director run for it, and nothing
  uploaded for **Older than (days)** — default **14**, 1–365; the value is kept for next time. The
  banner says how many keys and files were cleared and how many were kept because they changed or
  are in use. An existing project's files are never touched.

### Admin → Settings → Engine boot mark

The rig that opens **every** game — the engine's own logo, shown before the
game's own splash. This is what replaced the Invisible Engine loader, so it is
deliberately admin-owned: a client editing their project cannot change it.

Pick a bundle from the **shared** rig library (`_shared/spines/`), then set:

| Field | Notes |
|---|---|
| **Rig bundle** | The `_shared/spines/<bundle>` folder. Only the shared root is offered — a same-named project bundle can never shadow the engine mark. `— none —` skips the engine splash entirely. |
| **Animation** | A dropdown of the clips actually on the selected skeleton (read from the rig, so it can't disagree with it). A clip saved earlier that is no longer on the rig stays listed as `(not on this rig)` rather than silently snapping to another — the runtime falls back to the first clip, and you should know that happened. |
| **Background** | Painted immediately, before the rig loads, so boot never flashes white. |
| **Size** | Multiplier on the automatic fit, **not** an absolute size. `1.00×` is the mark scaled to sit inside a safe box, so one value holds on every screen. Above ~`1.6×` it can run past the viewport edges. Range `0.1×`–`3×`. |

A **live preview** beside the fields plays the mark at the chosen animation,
size and background, so you can judge it without a publish–reload round trip. It
matches the runtime deliberately: same fit rule, same shared-only resolution, and
a 16:9 frame so "how much of the screen does it fill" reads true.

Beneath it, **Currently saved** shows what is actually stored — the fields above
are your working copy, this is the server's.

A bundle that is renamed or removed keeps showing in the dropdown marked
`(missing)` so you notice rather than silently getting a different logo.

#### Getting a rig INTO the shared library

Rigs are authored inside a project, so a new mark starts life at
`<client>/<project>/spines/`. **Bring a rig into the shared library** (same
card) copies one across: pick the project, pick the bundle, submit. It is a
**copy, not a link** — the engine mark opens every game, so it must not break
when that project is renamed or deleted. Re-promoting the same name overwrites
it. This is the only writer of `_shared/spines/` **from the launcher UI** — the
library's curated engine set is seeded out-of-band by
`apps/launcher-api/scripts/seed-shared-engine-rigs.mjs`, which merges its entries into
`skeletons.json` rather than rewriting it, so a promotion and a re-seed never clobber each
other. See [the shared rig library](invisible-editor.md#the-shared-rig-library).

The bundle must be listed in its project's `spines/skeletons.json`, which is
what makes a folder of files loadable (it names the skeleton and the atlas). If
it isn't listed, open the rig in the [Rigger](/docs/rigger) and save — or
re-sync its atlas — first.

> **`_shared/rigs/` is a different library.** It holds skeleton *documents*
> (bones, slots, skins, animations) with **no atlas and no page textures** —
> things you *apply* onto art in the Rigger. A game cannot load one, so a rig
> there is not a boot mark. What you want is a rig **bundle**.

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
| **Anthropic** (Claude API) | spend by model / cost type; its org-wide total **includes** Invisible Director agent spend (the card says so) | `ANTHROPIC_ADMIN_API_KEY` — an **admin** key (`sk-ant-admin…`), a different credential from `ANTHROPIC_API_KEY`; it reads usage and cannot spend |
| **Anthropic (agents)** | Invisible Director's own Claude spend this month: the total, **By agent** and **Top runs** | nothing — it sums the launcher's own `director_spend` ledger, so it always shows (a real $0 until runs exist) |

**Anthropic (agents)** prices each call when the Director worker records it, from
`services/director-worker/pricing.json` (or the override under Settings → Invisible Director).
GPU time from Director runs is not on this card — it already drains the RunPod balance. Because
the agent spend is part of the Anthropic bill, the page's *Measured spend* and the monthly
**Total** leave it out whenever the Anthropic card has a figure, and count it only when it doesn't.

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

## Config / env

Every env var the launcher reads is listed (names only) in
[INFRA](../INFRA.md) → "Environment variables". Non-secret config (URLs, flags)
has a **code default** in `src/lib/server/env.ts`, because Railway env vars only
*stage* until you click "Apply changes / Deploy".

## Running locally (developers)

```bash
pnpm --filter launcher-api dev      # dev server on port 3010
pnpm --filter launcher-api build    # production bundle — NOT a type-check
```
`build` is a bare `vite build`, so a type error still builds green; from the
repo root, `pnpm lint` and `pnpm check:undefined-names` are what CI checks.
Schema changes: edit `src/lib/server/db/schema.ts`, run `db:generate`, commit
the migration — the launcher applies it at boot. Never run `db:push` against
production. `db:seed` seeds a local database.
Deploy = push to `main` (Railway auto-deploys); verify the live URL picked it up.

## Traps

- **"Invalid email or password" with the right password.** — A disabled account, or one whose
  login expiry date has passed, gets the same message as a wrong password, and an expiry or a
  revoked session also signs you out mid-session. Ask an admin to check your account in `/admin`.

## Known limitations / TODOs

- **DNS must stay grey-cloud (DNS-only):** `app` is a CNAME to Railway;
  proxying through Cloudflare breaks Railway's TLS.
- Open items (refactor debt, per-request DB cost, owed owner grants) are tracked
  in [status/launcher](../status/launcher.md).
