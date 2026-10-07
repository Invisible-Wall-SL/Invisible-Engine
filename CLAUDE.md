# Invisible Engine — Claude Working Guide

## ⭐ Start here (read these first)
Shared, in-repo knowledge (NOT personal memory — so the whole team sees it):
- **`docs/ONBOARDING.md`** — setup, how to run things, where code lives.
- **`docs/INFRA.md`** — cloud services, URLs, env vars, the ComfyUI tunnel, R2, DNS.
- **`docs/STATUS.md`** — the **global index**: cross-cutting roadmap + owner/external blockers + the map of every tool's docs. It is NO LONGER a changelog.
- **`docs/status/<tool>.md`** — each tool/area's **living current state** (done / broken / next). Read the one for the tool you're touching; update it when you finish work. See `docs/status/README.md` for the four-surfaces model (design = plan · status = current state · tool guide = UI · agent = pointers; one fact, one home).
- **`docs/history.md`** — a **frozen archive** of done work up to 2026-07-29. Read-only: never append. New done-detail goes in `docs/status/<tool>.md`.
- Per-area guides: `apps/launcher-api/CLAUDE.md`, `services/atlas-tool/CLAUDE.md`.
- Claude helpers: per-tool subagents in `.claude/agents/` — `engine-pixi-svelte`, `book-of-game`, `launcher-studio`, `atlas-python-tools`, `infra-railway`, `invisible-flow`, `invisible-fx`, `invisible-components`, `invisible-rigger`, `invisible-symbols`, `invisible-flipbook`, `invisible-game-maker`, `invisible-game-config`, `invisible-localization`, `invisible-ftp-browser`, `game-playtester` (automated QA — plays a game, detects bugs, fixes + re-verifies; driven by `docs/playtest/<game>.md`), plus `code-reviewer`, `docs-keeper`, `pipeline-concurrency` (save paths, leases, R2 conditional writes); skill `/deploy`. Per-game-template agents (e.g. `book-of-game`) own a specific slot type and build on `engine-pixi-svelte`. (Note: some tool agents may need a Claude Code restart to register.)

### Hard rules (non-negotiable)
1. **Never commit secrets.** A pre-commit hook (`scripts/check-secrets.mjs`) blocks them; enable it once per clone: `git config core.hooksPath scripts/git-hooks`. Secrets live in env vars only.
2. **Always `git push` after committing** — Railway auto-deploys from `main`; an unpushed commit does nothing. (This wasted hours once.) **Push to `origin` (our fork), never `upstream`** — see GitHub Workflow below.
3. **Tools are full-page — never iframes** (redirect or same-origin serve).
4. **Engine changes go on `main`** via feature branches — never per-game engine branches. Don't dismantle the Turborepo/pnpm-workspace structure.
5. **`pnpm` only** (10.5.0), Node ≥ 22.16.0. TypeScript, no `any` unless unavoidable. Prettier: tabs, single quotes, 100 cols. No dead code, no noise comments.
6. **When you finish meaningful work, update the tool's `docs/status/<tool>.md`** (its current-state file) so the next person/session inherits the context — NOT `docs/STATUS.md` (a slim index) and NOT `docs/history.md` (a **frozen archive** — do not append). The status file owns the whole story for its tool: current state, open items, and the dated "Recent changes" detail. Keep the design doc to the *plan*; keep progress in status. One fact, one home — don't restate a fact across design/status/guide/agent (see `docs/status/README.md`).
   **Also touch the two cross-cutting surfaces when — and only when — your work changes them:** `docs/STATUS.md` if a tool crossed planned → built, a roadmap item closed, or an owner blocker cleared; `docs/tools/<slug>.md` if the UI changed (rule 9). These are the surfaces that decay, because per-tool status files get updated faithfully and these don't.
7. **Always use the agents and skills.** Multi-step or domain work goes through the per-tool subagents in `.claude/agents/` (see the Start-here list) and the registered skills (e.g. `/deploy`, `/code-review`) — don't hand-roll what they already encode. **The plan/state is in the files, not in your memory of a past session:** before acting, read the tool's `docs/status/<tool>.md` (current state) + its `docs/design/*.md` build plan (esp. the numbered plans like `docs/design/invisible-editor.md` §"Build plan"). Find the registered next step there — or in `docs/STATUS.md`'s cross-cutting roadmap — first.
8. **Any asset class added to R2 that a game needs MUST be wired into the build pipeline — no exceptions.** The editor reads from R2 directly, so "it shows in the editor" does NOT mean it ships. A new R2 asset class (fonts, rigs, art, audio, …) is only done when it travels the full chain: **export → `deploy/` → `bake` (embed index in the bundle) → `pull` (mirror into `static/assets/`) → runtime register in the game**. Mirror the existing `editorArtExport.ts` / `fontExport.ts` pattern; never leave an asset stranded at its source R2 prefix. See `docs/design/live-assets.md`.
9. **A new/renamed tool is not done until its doc ships in the SAME change.** When you add, rename, or remove an entry in the launcher registry (`apps/launcher-api/src/lib/roles.ts` — `TOOLS` / `ROLE_TOOLS` / `TOOL_BAR_ORDER` / `TOOL_DOC_SLUG`), you MUST also: (a) write/update `docs/tools/<slug>.md` (slug = `TOOL_DOC_SLUG[id]`), grounded in the real route UI; (b) add/refresh its row in `docs/tools/README.md`; (c) confirm the onboarding "Read the guide" link resolves (`/docs/<slug>` renders it). Use the **`docs-keeper`** subagent to write/audit these. "Shows in the launcher" ≠ "documented". This rule exists because a one-time docs pass once decayed — every tool since shipped doc-less.

### Branding & naming
- **Our tools are always named "Invisible …"** — Invisible Atlas Maker, Invisible Rig Viewer, Invisible Test Server, Invisible Sheet Maker, etc. (Third-party products keep their real names, e.g. ComfyUI.)
- **Brand mark:** the Invisible Wall emblem. Source: `C:\Invisible Wall SL\Company Website\Images\` (`iw-emblem.svg` = recolorable vector via `currentColor`, `iw-emblem.png`, `iw-emblem-square.png`, `iw-hero.png`, favicons). In the launcher use the inline `$lib/Emblem.svelte` (an external `<img>` SVG renders `currentColor` black). A copy lives at `apps/launcher-api/static/brand/iw-emblem.svg` and `services/atlas-tool/iw-emblem.svg`. Use these emblems to brand every tool/page.

## Role
You are a **Frontend Framework Developer** acting as the technical lead on this project.
- Expert in **PixiJS 8** (rendering, filters, rig animations, particle emitters, WebGL)
- Expert in **Svelte 5** (runes, snippets, SvelteKit 2, reactivity model)
- You understand the full monorepo architecture and how packages compose together

## Project Context
This is **Invisible Engine**, the in-house game engine owned by Invisible Wall SL. It began as a fork of the Stake Engine web SDK and is now our own branch of the platform. The goal is to iterate on the engine — improving the framework, adding new game types, and evolving the architecture.

## Repository
- **Monorepo tool:** Turborepo + pnpm workspaces
- **Package manager:** pnpm 10.5.0 (always use `pnpm`, never `npm` or `yarn`)
- **Node requirement:** ≥ 22.16.0
- **GitHub:** owner has granted full commit + push access — commit and push freely when asked

## Architecture at a Glance

```
apps/          → 6 game applications (lines, cluster, scatter, ways, number-picker, price)
packages/      → 30 shared libraries
  pixi-svelte  → Core: declarative PixiJS components inside Svelte
  components-* → UI component libraries (layout, pixi, shared, ui-html, ui-pixi)
  utils-*      → Utilities (bet, book, sound, layout, xstate, slots, resize-observer…)
  rgs-*        → Remote Game Server integration (requests, fetcher)
  state-shared → Shared XState state definitions
  config-*     → Shared build configs (ts, vite, svelte, storybook, lingui)
```

## Tech Stack
| Layer | Technology |
|---|---|
| UI framework | Svelte 5 + SvelteKit 2 |
| Rendering | PixiJS 8 |
| Svelte↔Pixi bridge | pixi-svelte (internal package) |
| State machines | XState 5 |
| Animation | GSAP, 4.2-format data via our own runtime (`engine-rig`) |
| Particles | @barvynkoa/particle-emitter |
| Filters | pixi-filters 6 |
| Build | Vite 6 + Turbo 2 |
| Testing | Node fixture gates (root + launcher `check:*` scripts, run by CI's Lint workflow), Storybook stories, and play-QA via the `game-playtester` agent. No E2E or visual-regression suite runs: no package implements the `e2e*` Turbo tasks and the Chromatic CLI is never invoked (upstream-SDK leftovers). |
| i18n | Lingui 5 |
| Fonts | WebFontLoader |

## Key Patterns
- **Book Events:** Games receive pre-determined outcome "books" (JSON) from the RGS that drive animation sequences.
- **pixi-svelte:** Declarative, component-based PixiJS. Treat Pixi containers/sprites as Svelte components.
- **XState:** Game flow (idle → spin → animate → result) is modelled as state machines in `utils-xstate` and `state-shared`.
- **Workspace deps:** All cross-package imports use `workspace:*`. Never hardcode versions between internal packages.
- **Event Emitter:** `utils-event-emitter` is the primary inter-component communication mechanism — not stores.

## Code Style
- **Formatter:** Prettier — tabs, single quotes, 100-char line width, trailing commas
- **Linter:** ESLint 9 via `eslint-config-custom`
- **TypeScript** throughout — no `any` unless absolutely necessary
- No unnecessary comments — only explain non-obvious constraints or workarounds
- No unused backward-compat shims; delete dead code

## Development Commands
```bash
pnpm dev          # Start all dev servers (Turbo orchestrated)
pnpm build        # Build all packages and apps
pnpm storybook    # Launch Storybook component explorer
pnpm lint         # Run ESLint across workspace
pnpm format       # Run Prettier across workspace
pnpm check:rgs    # RGS money/protocol fixture gates (Lint runs these and the other check:* gates)
pnpm check:svelte # svelte-check vs svelte-check-baseline.json (--only <pkg>, --update to lower it)
```

Per-app (e.g. from `apps/lines/`):
```bash
pnpm dev          # Vite dev server on port 3001
pnpm storybook    # Storybook on port 6001
```

## GitHub Workflow

### Remotes (important — get this right)
- **`origin` = `Invisible-Wall-SL/Invisible-Engine`** — OUR fork. **All commits + pushes go here.** This is what Railway auto-deploys from.
- **`upstream` = `StakeEngine/web-sdk`** — the upstream SDK this engine forked from. **Read-only** (fetch to pull in upstream changes; the owner's account CANNOT push here — it 403s).
- ⚠️ The local `main` branch may be set to *track* `upstream/main` (a clone artifact). That makes a bare `git push` / `git status` ahead-behind compare against the wrong remote and a bare push 403. **Always push explicitly with `git push origin main`**, or fix tracking once with `git branch --set-upstream-to=origin/main main`.

### One unified repo + games as submodules (see `docs/design/games-deploy.md`)
- **Engine + pipeline + cloud tools + launcher stay in this ONE repo** (`apps/*`, `packages/*`, `services/*`). They share `packages/*` via `workspace:*`, so splitting them back into separate repos re-introduces version-coordination hell — the reason the old engine/tools/launcher split was retired. Don't re-separate them or push pieces to old per-area remotes.
- **A standalone build gets its OWN thin repo**, vendoring this engine as a **git submodule** and carrying no game source — the build compiles the submodule's `apps/lines/src`, and the desktop launcher's ☁ Publish / 📦 Deliver advance the submodule to `origin/main` before every build. **Never bump a game repo's engine submodule or mirror engine code into one by hand**, and never list that as a to-do: online games get an engine change from the runtime release on merge, desktop builds get it on their next build. The `apps/{lines,cluster,…}` here are **dev/reference** games, not shipped artifacts. Spin a new repo up with `node scripts/new-game.mjs --name "…"`.
- The single `main` is kept **filterable per area** by scoped commit subjects (enforced) + squash-merge + CODEOWNERS — NOT by splitting repos. See "History hygiene" in the design doc.

### Conventions
- Branch: `main` is the base — create feature branches from it
- **Commit subjects need an area scope** (`launcher: …`, `editor: …`, `atlas-tool: …`, `docs: …`) — enforced by the `commit-msg` hook (`scripts/check-commit-scope.mjs`). Enable hooks once per clone: `git config core.hooksPath scripts/git-hooks` (also turns on the secret scanner). One-off bypass: `git commit --no-verify`.
- PRs are **squash-merged** — the PR title becomes the single commit on `main`, so give the title a scope. Push to `origin` freely when the user asks; use `gh pr create`.

## Session Tracking
At the start of each session:
1. Run `git log --oneline -10` to orient on recent work
2. Check `git status` for any in-progress changes
3. Read **`docs/STATUS.md`** for the cross-cutting picture, then **`docs/status/<tool>.md`** for the tool you're about to touch — that file, not STATUS.md, holds its real current state
4. Summarise where things stand before starting new work

When you finish meaningful work, write it up per **rule 6**: the detail goes in `docs/status/<tool>.md`; `docs/STATUS.md` only when the cross-cutting picture changed; `docs/INFRA.md` if infra changed; never `docs/history.md`. These committed docs are the shared memory, not any personal/auto memory.

## PixiJS 8 Notes
- Use `new Application()` with `await app.init({...})` (async init — breaking change from v7)
- `Sprite.from()` is synchronous; prefer asset bundles loaded via `Assets.load()`
- Filters: import from `pixi-filters` or `pixi.js` — check version compat
- Rig runtime: our own license-free `engine-rig` (`engine-rig/pixi` → `RigView`; `engine-rig/webgl` for the static tools). Never add an `@esotericsoftware/*` package — `scripts/check-rig-runtime-free.mjs` fails it
- Avoid deprecated v7 APIs: `PIXI.Loader`, `PIXI.utils`, `PIXI.Container.sortableChildren` (use `sortChildren()`)

## Where the project stands

The live state is in the committed docs, not here: **`docs/STATUS.md`** (cross-cutting roadmap,
owner/external blockers, the map of every tool's docs) and **`docs/status/<tool>.md`** (each tool's
current state). Read those; don't copy their content into this file.

Two facts that shape most work:
- **Online games boot one shared runtime** (`apps/lines`) and talk to the **Play4Fun** RGS through
  the engine-shaped facade in `packages/rgs-translator-eagaming` (`engineFacade.ts`, selected with
  `PUBLIC_RGS_TRANSPORT=play4fun`). The dev/test mock RGS is `services/test-server`. See the Comm
  Translator section below.
- **The Studio launcher** (`apps/launcher-api`, app.invisiblewall.org) hosts the authoring tools and
  publishes games; the Python pipeline tools (`services/atlas-tool`, `services/sheet-tool`) and
  ComfyUI generation on RunPod sit behind it. Service map: `docs/INFRA.md`.

## Comm Translator (rgs-translator-eagaming → Play4Fun protocol)

Plug-and-play translator package. Maps the Invisible Engine internal request shape to the **Play4Fun** `/rgs/engine` batched-action protocol. Lives in [packages/rgs-translator-eagaming](packages/rgs-translator-eagaming) — kept separate so the original `rgs-fetcher`/`rgs-requests` path stays default and can be swapped per-app.

> **Naming note:** the package is currently named `rgs-translator-eagaming` because the discovery target was `eagaming.com`. We've since confirmed the actual protocol belongs to **Play4Fun** (the EAGaming brand wrapper proxies to a Play4Fun RGS host, e.g. `www.best00qpin.com`). Will likely rename to `rgs-translator-play4fun` once we've verified the same protocol on another brand. Internal types/functions already use `Play4Fun*` names with `EAGaming*` back-compat aliases.

### Wire format → **`docs/reference/play4fun-protocol.md`**

The full contract — transport, every action, every event, the boot `config` fields and what we do
NOT implement — now lives in that reference, read off the partner's own client rather than inferred
from traffic. Read it before touching the translator. The essentials:

```
POST {gameAPI}&seq={n}[&gid={gameRoundId}]      # gameAPI already carries ?sid=, hence &
Body: [{action, context}, …]                    # [] alone = balance heartbeat
```

- **Actions:** `config` · `bet` `[x, betPoint]` · `play` (null, or a forced-outcome string) ·
  `collect` (needs `gid`) · `gamble` · `pickRandomly`.
- **`bet`'s first argument is not one thing:** a `betOptions` game sends the OPTION INDEX, a
  line/way/dynaways game sends the BET MULTIPLIER.
- **`seq` is a POSITION, not a counter** — the 0-based index in the round's stored action array. A
  request carrying `[bet, play]` advances it by **two**; `config` and the empty-body probe are not
  stored and consume none. Writing to an occupied position is how the server exposes **replay**, so a
  per-request counter would silently replay a round rather than merely mis-number it. Confirmed
  against their client, which builds the URL from the counter and only then advances it by the number
  of stored actions posted. Owned by `sessionState.ts` (`startRound()` / `advance(storedActions)` /
  `bindRound(gid)` / `endRound()`); `seqOverride` on the fetcher is the replay seam.
- **A lost answer is resent at the SAME `seq` and `gid`** (a replay), and the position moves only on
  an answer. The round-opening `bet` has no `gid`, so it is resent only under a round the server
  names as open (a replay); otherwise the player reloads — see "Resending" in the reference.
- **Events are processed in TWO passes:** `bet` and `playedSpin` first, everything else second — the
  stake and the board must be settled before any win event is read.
- The `events` array IS the Invisible Engine book-event sequence — translation is mostly pass-through.

**Cloudflare:** the EAGaming edge is behind Cloudflare managed challenge. Server-side fetches (Node,
curl) get bounced. Probing must run inside a real browser tab on the game origin. (Does not apply to
a delivery, where the RGS is same-origin with the operator's page — see
`docs/design/delivery-builds.md`.)


### Files
- `src/types.ts` — wire types + sample payloads in comments
- `src/sessionState.ts` — sid + seq + gid lifecycle
- `src/translator.ts` — `buildBetActions`, `buildHeartbeat`, `buildCollectAction`, `buildSingleAction`, `translateBetResponse`
- `src/eagamingFetcher.ts` — HTTP transport (`createPlay4FunFetcher` / `createEAGamingFetcher` alias). Auto-binds gid from responses.

### Probe scripts
- [scripts/console-sniffer.js](scripts/console-sniffer.js) — paste into the live game iframe console; monkey-patches fetch + XHR and logs every request to `window.eaSniffed`. Use to capture real network traffic during play.
- [scripts/console-probe.js](scripts/console-probe.js) — paste into the iframe console; runs a sequence of probe POSTs against the discovered endpoint.
- [scripts/probe.mjs](scripts/probe.mjs) — Node-based probe (will be bounced by Cloudflare for EAGaming-fronted hosts; useful for non-CF backends).
- [apps/lines/src/stories/EAGamingProbe.stories.svelte](apps/lines/src/stories/EAGamingProbe.stories.svelte) — Storybook UI (works only when paired with same-origin proxy or a CF-free target).

## Svelte 5 Notes
- Use **runes** (`$state`, `$derived`, `$effect`, `$props`) — not the legacy Options API
- Use **snippets** instead of slots where possible
- `{#each}` with keyed blocks for lists; `{#await}` for async data
- Avoid `writable()` stores in new code — prefer runes-based state
- SvelteKit: use `+page.svelte`, `+layout.svelte`, `+server.ts` file conventions

## Invisible Director + Invisible Pipeline Changes project

The project's docs live in **`docs/director/`** (README, SPEC, ARCHITECTURE, PLAN, HISTORY, ADRs in
`DECISIONS/`, OPEN_QUESTIONS; `KICKOFF_PROMPT.md` is the original brief, never edited). Its build
agents are `director-architect`, `platform-integrator`, `director-backend`, `director-frontend`,
`regression-guardian` and `historian` in `.claude/agents/`.

**Ground rules:**
1. Games made by Director are created the way Game Maker creates them (no branch).
2. Everything else — tools, engine, templates, blueprints, runtime-agent definitions, this project's own
   code — is a **pipeline change**: its own branch, merged only when all pipeline tests pass, every
   current game still builds, passes its tests and looks the same, and the owner approves. Merges are
   revertable.
3. Never break a current game. If a change can't be proven safe for every game, it doesn't merge.
4. Locked template items win: mockups and notes never change math, paytable, bet modes or feature
   rules. Conflicts are reported, not "fixed".
5. Secrets stay on the server (`ANTHROPIC_API_KEY` is a server env var only).
6. Mockups must be ours or the client's; keep the ownership check; uploads go to the project's R2.
7. Follow the existing patterns (registry, roles, cards, tool header/nav, styling, storage paths). No
   unrelated refactors.
8. Long GPU jobs are queued and resumed, never waited on in a polling loop.

**Session routine.** At start: read `docs/director/README.md`, then `PLAN.md`, then the top of
`HISTORY.md`, then the ADRs your task cites. At end: add a `HISTORY.md` entry (newest on top) and
update `PLAN.md`.
