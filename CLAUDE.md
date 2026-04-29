# Invisible Engine — Claude Working Guide

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
- Branch: `main` is the base — create feature branches from it
- Commit style: imperative present tense, concise (`add spin replay support`)
- Push to origin freely when the user asks for it
- PRs target `main`; use `gh pr create` for pull requests

## Session Tracking
At the start of each session:
1. Run `git log --oneline -10` to orient on recent work
2. Check `git status` for any in-progress changes
3. Review memory files for project context
4. Summarise where things stand before starting new work

## PixiJS 8 Notes
- Use `new Application()` with `await app.init({...})` (async init — breaking change from v7)
- `Sprite.from()` is synchronous; prefer asset bundles loaded via `Assets.load()`
- Filters: import from `pixi-filters` or `pixi.js` — check version compat
- Spine runtime: `@esotericsoftware/spine-pixi-v8` for PixiJS 8 compatibility
- Avoid deprecated v7 APIs: `PIXI.Loader`, `PIXI.utils`, `PIXI.Container.sortableChildren` (use `sortChildren()`)

## Comm Translator (rgs-translator-eagaming)

Plug-and-play translator that maps the Stake Engine internal request shape to **EAGaming**'s batched-action protocol. Lives in [packages/rgs-translator-eagaming](packages/rgs-translator-eagaming) — kept separate so the original `rgs-fetcher`/`rgs-requests` path remains the default and can be swapped in/out.

### Wire format (observed from Hot Fruits at eagaming.com)
```
POST {baseUrl}/game/engine?sid={sid}&seq={n}
Body: [{action: "bet", context: [5, 2]}, {action: "play", context: null}]
```
- Single endpoint, batched `{action, context}` envelopes
- `seq` increments per request, scoped to the `sid`
- Response shape: still being reverse-engineered

### Files
- `src/types.ts` — wire types (provisional)
- `src/sessionState.ts` — sid + seq counter
- `src/translator.ts` — `buildBetActions`, `buildSingleAction`, `translateBetResponse`
- `src/eagamingFetcher.ts` — HTTP transport (`createEAGamingFetcher`)

### Test harnesses
- **Storybook** (primary): `apps/lines/src/stories/EAGamingProbe.stories.svelte` — interactive UI under `COMM/EAGaming Probe`. Configure sid/cookie/baseUrl, fire actions, inspect raw + translated responses live.
- **Node probe** (secondary): `scripts/probe-eagaming.ts` — terminal alternative for batch capture. Run with `pnpm tsx scripts/probe-eagaming.ts --sid=... --base=https://eagaming.com --cookie="..."`.

### CORS note
Hitting `eagaming.com` from the Storybook origin will be blocked by CORS. Either configure a Vite proxy in dev, or use the Node script for unrestricted requests.

## Svelte 5 Notes
- Use **runes** (`$state`, `$derived`, `$effect`, `$props`) — not the legacy Options API
- Use **snippets** instead of slots where possible
- `{#each}` with keyed blocks for lists; `{#await}` for async data
- Avoid `writable()` stores in new code — prefer runes-based state
- SvelteKit: use `+page.svelte`, `+layout.svelte`, `+server.ts` file conventions
