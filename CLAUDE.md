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
