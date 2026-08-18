# Invisible Engine — Claude Working Guide

## ⭐ Start here (read these first)
Shared, in-repo knowledge (NOT personal memory — so the whole team sees it):
- **`docs/ONBOARDING.md`** — setup, how to run things, where code lives.
- **`docs/INFRA.md`** — cloud services, URLs, env vars, the ComfyUI tunnel, R2, DNS.
- **`docs/STATUS.md`** — the **global index**: cross-cutting roadmap + owner/external blockers + the map of every tool's docs. It is NO LONGER a changelog.
- **`docs/status/<tool>.md`** — each tool/area's **living current state** (done / broken / next). Read the one for the tool you're touching; update it when you finish work. See `docs/status/README.md` for the four-surfaces model (design = plan · status = current state · tool guide = UI · agent = pointers; one fact, one home).
- **`docs/history.md`** — a **frozen archive** of done work up to 2026-07-29. Read-only: never append. New done-detail goes in `docs/status/<tool>.md`.
- Per-area guides: `apps/launcher-api/CLAUDE.md`, `services/atlas-tool/CLAUDE.md`.
- Claude helpers: per-tool subagents in `.claude/agents/` — `engine-pixi-svelte`, `book-of-game`, `launcher-studio`, `atlas-python-tools`, `infra-railway`, `invisible-flow`, `invisible-fx`, `invisible-components`, `invisible-rigger`, `invisible-symbols`, `invisible-game-maker`, `invisible-localization`, `invisible-ftp-browser`, `game-playtester` (automated QA — plays a game, detects bugs, fixes + re-verifies; driven by `docs/playtest/<game>.md`), plus `code-reviewer`, `docs-keeper`; skill `/deploy`. Per-game-template agents (e.g. `book-of-game`) own a specific slot type and build on `engine-pixi-svelte`. (Note: some tool agents may need a Claude Code restart to register.)

### Hard rules (non-negotiable)
1. **Never commit secrets.** A pre-commit hook (`scripts/check-secrets.mjs`) blocks them; enable it once per clone: `git config core.hooksPath scripts/git-hooks`. Secrets live in env vars only.
2. **Always `git push` after committing** — Railway auto-deploys from `main`; an unpushed commit does nothing. (This wasted hours once.) **Push to `origin` (our fork), never `upstream`** — see GitHub Workflow below.
3. **Tools are full-page — never iframes** (redirect or same-origin serve).
4. **Engine changes go on `main`** via feature branches — never per-game engine branches. Don't dismantle the Turborepo/pnpm-workspace structure.
5. **`pnpm` only** (10.5.0), Node ≥ 22.16.0. TypeScript, no `any` unless unavoidable. Prettier: tabs, single quotes, 100 cols. No dead code, no noise comments.
6. **When you finish meaningful work, update the tool's `docs/status/<tool>.md`** (its current-state file) so the next person/session inherits the context — NOT `docs/STATUS.md` (a slim index) and NOT `docs/history.md` (a **frozen archive** — do not append). The status file owns the whole story for its tool: current state, open items, and the dated "Recent changes" detail. Keep the design doc to the *plan*; keep progress in status. One fact, one home — don't restate a fact across design/status/guide/agent (see `docs/status/README.md`).
   **Also touch the two cross-cutting surfaces when — and only when — your work changes them:** `docs/STATUS.md` if a tool crossed planned → built, a roadmap item closed, or an owner blocker cleared; `docs/tools/<slug>.md` if the UI changed (rule 9). These are the surfaces that decay, because per-tool status files get updated faithfully and these don't.
7. **Always use the agents and skills.** Multi-step or domain work goes through the per-tool subagents in `.claude/agents/` (see the Start-here list) and the registered skills (e.g. `/deploy`, `/code-review`) — don't hand-roll what they already encode. **The plan/state is in the files, not in your memory of a past session:** before acting, read the tool's `docs/status/<tool>.md` (current state) + its `docs/design/*.md` build plan (esp. the numbered plans like `docs/design/invisible-editor.md` §"Build plan"). Find the registered next step there — or in `docs/STATUS.md`'s cross-cutting roadmap — first.
8. **Any asset class added to R2 that a game needs MUST be wired into the build pipeline — no exceptions.** The editor reads from R2 directly, so "it shows in the editor" does NOT mean it ships. A new R2 asset class (fonts, spines, art, audio, …) is only done when it travels the full chain: **export → `deploy/` → `bake` (embed index in the bundle) → `pull` (mirror into `static/assets/`) → runtime register in the game**. Mirror the existing `editorArtExport.ts` / `fontExport.ts` pattern; never leave an asset stranded at its source R2 prefix. See `docs/design/live-assets.md`.
9. **A new/renamed tool is not done until its doc ships in the SAME change.** When you add, rename, or remove an entry in the launcher registry (`apps/launcher-api/src/lib/roles.ts` — `TOOLS` / `ROLE_TOOLS` / `TOOL_BAR_ORDER` / `TOOL_DOC_SLUG`), you MUST also: (a) write/update `docs/tools/<slug>.md` (slug = `TOOL_DOC_SLUG[id]`), grounded in the real route UI; (b) add/refresh its row in `docs/tools/README.md`; (c) confirm the onboarding "Read the guide" link resolves (`/docs/<slug>` renders it). Use the **`docs-keeper`** subagent to write/audit these. "Shows in the launcher" ≠ "documented". This rule exists because a one-time docs pass once decayed — every tool since shipped doc-less.

### Branding & naming
- **Our tools are always named "Invisible …"** — Invisible Atlas Maker, Invisible Spine Viewer, Invisible Test Server, Invisible Sheet Maker, etc. (Third-party products keep their real names: ComfyUI, Spine Editor.)
- **Brand mark:** the Invisible Wall emblem. Source: `C:\Invisible Wall SL\Company Website\Images\` (`iw-emblem.svg` = recolorable vector via `currentColor`, `iw-emblem.png`, `iw-emblem-square.png`, `iw-hero.png`, favicons). In the launcher use the inline `$lib/Emblem.svelte` (an external `<img>` SVG renders `currentColor` black). A copy lives at `apps/launcher-api/static/brand/iw-emblem.svg` and `services/atlas-tool/iw-emblem.svg`. Use these emblems to brand every tool/page.

## Role
You are a **Frontend Framework Developer** acting as the technical lead on this project.
- Expert in **PixiJS 8** (rendering, filters, spine animations, particle emitters, WebGL)
- Expert in **Svelte 5** (runes, snippets, SvelteKit 2, reactivity model)
- You understand the full monorepo architecture and how packages compose together

## Project Context
This is a **personal fork / revision** of the Stake Engine web SDK (`twist-turbo`). The owner is building their own branch of the platform on GitHub. The goal is to iterate on the engine — improving the framework, adding new game types, and evolving the architecture.

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
| Animation | GSAP, Spine 4.2 (@esotericsoftware) |
| Particles | @barvynkoa/particle-emitter |
| Filters | pixi-filters 6 |
| Build | Vite 6 + Turbo 2 |
| Testing | Playwright (E2E), Chromatic (visual regression), Storybook |
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
pnpm e2e          # Run Playwright E2E suite
```

Per-app (e.g. from `apps/lines/`):
```bash
pnpm dev          # Vite dev server on port 3001
pnpm storybook    # Storybook on port 6001
```

## GitHub Workflow

### Remotes (important — get this right)
- **`origin` = `Invisible-Wall-SL/Invisible-Engine`** — OUR fork. **All commits + pushes go here.** This is what Railway auto-deploys from.
- **`upstream` = `StakeEngine/web-sdk`** — the original Stake Engine SDK. **Read-only** (fetch to pull in upstream changes; the owner's account CANNOT push here — it 403s).
- ⚠️ The local `main` branch may be set to *track* `upstream/main` (a clone artifact). That makes a bare `git push` / `git status` ahead-behind compare against the wrong remote and a bare push 403. **Always push explicitly with `git push origin main`**, or fix tracking once with `git branch --set-upstream-to=origin/main main`.

### One unified repo + games as submodules (see `docs/design/games-deploy.md`)
- **Engine + pipeline + cloud tools + launcher stay in this ONE repo** (`apps/*`, `packages/*`, `services/*`). They share `packages/*` via `workspace:*`, so splitting them back into separate repos re-introduces version-coordination hell — the reason the old engine/tools/launcher split was retired. Don't re-separate them or push pieces to old per-area remotes.
- **Shipped games get their OWN repo**, each vendoring this engine as a **git submodule** pinned to a `main` commit, deploying on its own cadence (e.g. Book of Borut). The `apps/{lines,cluster,…}` here are **dev/reference** games, not shipped artifacts. Spin a new one up with `node scripts/new-game.mjs --name "…"`.
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
- Spine runtime: `@esotericsoftware/spine-pixi-v8` for PixiJS 8 compatibility
- Avoid deprecated v7 APIs: `PIXI.Loader`, `PIXI.utils`, `PIXI.Container.sortableChildren` (use `sortChildren()`)

## Project state (as of 2026-04-30)

**Phase 1 — Translator + protocol verification:** ✅ done
- `rgs-translator-eagaming` package: types, sessionState, translator, fetcher
- Verified protocol from real Hot Fruits captures (Play4Fun on EAGaming brand)
- Mock RGS server (Play4Fun-faithful)
- Smoke tests for protocol round-trip
- Demo overlay (paste-into-game-tab presentation panel)

**Phase 2 — Stake game running on Play4Fun:** ✅ done
- Stake-shaped facade (`stake-facade.ts`): drop-in replacement for `rgs-requests`
- Vite alias in `apps/lines` enables it via `PUBLIC_RGS_TRANSPORT=play4fun`
- `apps/lines` runs unmodified against the local mock through our facade:
  - Symbol mapping (`PIC*` → `H*`/`L*`/`S`) in facade
  - Amount scaling (Play4Fun cents ↔ Stake API millions) in facade
  - Event-vocabulary adapter (`playedSpin` → `reveal`, `spinWin` → `winInfo`,
    `gameEnd` → `setTotalWin`, `gameRoundOver` → `finalWin`)
  - Reveal board padded 3 rows → 5 rows for Stake's animation buffer
  - Two-step balance flow: `requestBet` returns interim, `requestEndRound`
    returns final (wallet "fills up" in sync with the count-up animation)
  - bookEvent amounts use Stake's `BOOK_AMOUNT_MULTIPLIER` (fixed-point
    bet-multipliers), not absolute amounts
- Verified end-to-end: correct symbols, correct math, correct round flow

**Phase 3 — Studio platform + cloud pipeline tools:** 🚧 in progress (as of 2026-05-29)
- **`apps/launcher-api`** — SvelteKit (adapter-node) launcher/portal on Railway, live at **app.invisiblewall.org**. Invite-only email+password auth (scrypt) + sessions in Postgres/Drizzle, roles, per-role tool manifest, full-bleed tool pages (no nav menu). `/spine` = Spine Viewer hosted fully from R2 (DONE). `/atlas` = online Atlas Maker UI (minimal stub for now).
- **`services/atlas-backend`** — FastAPI (Python) generation service on Railway. Drives the user's LOCAL ComfyUI over a Cloudflare named tunnel (`comfy.invisiblewall.org`, protected by Cloudflare Access service token). Ported from `Invisible_Pipeline/tools/Invisible Atlas Maker`: `/generate-region` (SDXL), `/slice`, `/compose`. Assets/manifests in Cloudflare R2 (bucket `invisibleassets`).
- **Infra:** DNS on Cloudflare; Railway (launcher + atlas-backend + Postgres); R2 (shared asset repo); Cloudflare Tunnel → local ComfyUI (RTX 4070) — only ComfyUI stays local, everything else is cloud.

> **For the full live state + exact next steps, read the memory file `project_invisible_pipeline_tools.md`** (auto-loaded). It has the current blocker, service URLs, and the ordered to-do (finish Access fix, remove /debug/access, build the full Atlas UI, port FLUX/gpt pipelines, security cleanup, launcher cleanup). Related memory: `project_pipeline_infra`, `project_studio_platform`, `feedback_launcher_ux`, `feedback_auth_password`.

(Phase 1 & 2 below were the RGS-translator work; Phase 3 is the separate Studio/launcher initiative.)

## Comm Translator (rgs-translator-eagaming → Play4Fun protocol)

Plug-and-play translator package. Maps the Stake Engine internal request shape to the **Play4Fun** `/rgs/engine` batched-action protocol. Lives in [packages/rgs-translator-eagaming](packages/rgs-translator-eagaming) — kept separate so the original `rgs-fetcher`/`rgs-requests` path stays default and can be swapped per-app.

> **Naming note:** the package is currently named `rgs-translator-eagaming` because the discovery target was `eagaming.com`. We've since confirmed the actual protocol belongs to **Play4Fun** (the EAGaming brand wrapper proxies to a Play4Fun RGS host, e.g. `www.best00qpin.com`). Will likely rename to `rgs-translator-play4fun` once we've verified the same protocol on another brand. Internal types/functions already use `Play4Fun*` names with `EAGaming*` back-compat aliases.

### Wire format (verified from Hot Fruits)
```
POST {origin}/rgs/engine?sid={sid}&seq={n}[&gid={gameRoundId}]
Body: [{action, context}, …]
```

**Actions:**
- `bet` — `context: [a, betPerLine]` — total stake = `a * betPerLine`
- `play` — `context: null` (round stays open, requires separate `collect`) or `''` (auto-collect)
- `collect` — closes a round; needs `gid` query param
- `[]` (empty body) — heartbeat, returns `{events:[], platform:{balance}}`

**Response:**
```ts
{
  events: [
    { event: 'bet'|'gameStart'|'spinStart'|'spinWin'|'playedSpin'|'gameEnd'|'gameRoundOver', context: {…} },
    …
  ],
  platform: { balance, gameRound?: { updating: true, id: 'G…' } }
}
```

The `events` array IS the Stake-Engine book-event sequence — translation is mostly pass-through.

**`seq` is NOT a monotonic counter:** resets to 0 each new round, increments only within an in-flight round. Owned by the session state (`startRound()` / `nextSeq()` / `bindRound(gid)` / `endRound()`).

**Cloudflare:** the EAGaming edge is behind Cloudflare managed challenge. Server-side fetches (Node, curl) get bounced. Probing must run inside a real browser tab on the game origin.

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
