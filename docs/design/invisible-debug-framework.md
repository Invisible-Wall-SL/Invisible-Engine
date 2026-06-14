# Invisible Debug — publish-time debug toggle + in-game debug menu

**Status:** design registered 2026-06-14. Not yet built. Build plan below (D1–D7).
**Owner ask:** "an easy way to access debug (and future debugs) in a published game —
a *publish with debug on/off* option that includes them."

## Problem

Today each game hand-wires its own debug affordances:

- `SymbolDebugOverlay` (Pixi) + a `d`-hotkey toggle in `Game.svelte`.
- A win-state `console.log` probe behind an `$effect`.

Both are gated by `import.meta.env.DEV || localStorage.IE_DEBUG === '1'`. In a **published**
build `DEV` is false, so the only switch is `localStorage.IE_DEBUG`, which is read **once at
load** and is **per-origin** — so on a deployed (often iframed) game you must open the *game
frame's* console, set the flag, reload, then find the right hotkey. It's fiddly, undiscoverable,
and doesn't scale: every new debug needs its own flag + hotkey + per-game wiring.

## Goals

1. **Publish-time on/off.** A checkbox in the launcher's Build & publish flow decides whether a
   build includes debug tooling. Debug-**off** is the default and **ships zero debug code**
   (tree-shaken) — no bundle bloat, no surface exposed to players.
2. **Zero-ceremony access in a debug build.** An on-screen button (works in an iframe, on any
   origin, on mobile, no devtools) opens a menu of available tools. No console, no reload, no
   memorised hotkeys.
3. **Extensible.** Adding a *future* debug tool is one `registerDebugTool({...})` call; it shows
   up in the menu automatically. No per-game menu/hotkey edits.

## Architecture — three layers

### Layer 1 — the build switch: `__IE_DEBUG__`

A **compile-time global**, defined per game in `vite.config`:

```ts
// vite.config — every game (added by new-game.mjs; back-filled into existing games)
define: {
  __IE_DEBUG__: JSON.stringify(
    mode !== 'production' || process.env.PUBLIC_IE_DEBUG === '1',
  ),
}
```

- `mode !== 'production'` → on during `vite dev` (local dev parity).
- `PUBLIC_IE_DEBUG=1` in the build env → on for a **debug publish**.
- Neither → `__IE_DEBUG__ === false`, a **static literal**, so every `if (__IE_DEBUG__)` /
  `{#if __IE_DEBUG__}` is dead-code-eliminated. Debug-off bundles contain none of the framework.

Why a `define` global and not `$env/static/public`: the gate must be readable from **shared
packages** (`components-*`, `state-shared`), which cannot import a SvelteKit app's `$env`
module. A Vite `define` is the standard `__DEV__`-style lever and is statically replaced
everywhere — app and packages alike. Declared once for TS:

```ts
// packages/utils-shared/src/debug.d.ts  (ambient)
declare const __IE_DEBUG__: boolean;
```

A thin helper re-exports it so app/game code reads a named symbol, not the raw global:

```ts
// packages/utils-shared/src/debug.ts
export const DEBUG_BUILD: boolean = typeof __IE_DEBUG__ !== 'undefined' && __IE_DEBUG__;
```

No `localStorage` flag in the gate — a debug build is simply *on*. (`localStorage.IE_DEBUG`
may remain inside a debug build as an extra per-tool default, but it is no longer the access
mechanism.)

### Layer 2 — the registry: `state-shared/stateDebug.svelte.ts`

A runes store (sibling to `stateBet`, `stateUi`, …). The single source of truth for which tools
exist and which are toggled on.

```ts
export type DebugSurface = 'pixi' | 'html';
export type DebugTool = {
  id: string;            // stable key, e.g. 'symbols'
  label: string;         // menu label, e.g. 'Symbol overlay'
  group?: string;        // optional menu section, e.g. 'Rendering'
  surface: DebugSurface; // where it draws
  component: Component;  // Svelte component rendered when active
};

class StateDebug {
  enabled = DEBUG_BUILD;          // mirror of the build switch (lets HTML gate cheaply)
  tools = $state<DebugTool[]>([]);
  active = $state<Record<string, boolean>>({});
  register(tool: DebugTool) { /* idempotent by id */ }
  toggle(id: string) { this.active[id] = !this.active[id]; }
}
export const stateDebug = new StateDebug();
export const registerDebugTool = (t: DebugTool) => stateDebug.register(t);
```

Registration is guarded by the caller under `__IE_DEBUG__`, so it too tree-shakes when off.

### Layer 3 — the surfaces (two mount points, because Pixi ≠ DOM)

Pixi components can only mount inside the `<App>` tree; the menu chrome is DOM. So the framework
ships **two** components, both internally gated by `{#if __IE_DEBUG__}` (mount them
unconditionally in every game — off-builds drop them):

- **`<DebugMenu>` — HTML** (`components-ui-html`, beside `Modals`/`GameVersion`). The floating
  button + slide-out panel. Lists every registered tool with an on/off switch (reads
  `stateDebug.tools`, calls `stateDebug.toggle`). Renders active **`surface: 'html'`** tools in a
  DOM layer. This is the *controller* + HTML tool host.
- **`<DebugStage>` — Pixi** (`components-pixi`, mounted inside `<App>`). Renders active
  **`surface: 'pixi'`** tools (e.g. `SymbolDebugOverlay`) into the canvas.

```
<App>
  …game…
  <DebugStage />        <!-- pixi tools (gated) -->
</App>
<Modals />
<DebugMenu />           <!-- button + panel + html tools (gated) -->
```

### Per-game tool registration

Each game owns a tiny `game/debugTools.ts` (only imported under `__IE_DEBUG__`) that registers
its tools:

```ts
if (__IE_DEBUG__) {
  registerDebugTool({ id: 'symbols', label: 'Symbol overlay', surface: 'pixi',
    component: SymbolDebugTool });
  registerDebugTool({ id: 'winstate', label: 'Win-state probe', surface: 'html',
    component: WinStateProbe });
}
```

The engine framework (registry + menu + stage) is game-agnostic; the *tools* are per-game (they
read the game's `SYMBOL_INFO_MAP`, `stateBet`, etc.), mirroring how `getSymbolInfo` is per-game
today.

## Publish-with-debug toggle (launcher)

The build command is an opaque per-project profile (`game.publish.build_cmd`) stored in the
portal; the **desktop launcher** (separate app) fetches it and runs the build, then uploads.

- **Launcher UI:** add an **"Include debug tools"** checkbox to the Build & publish dialog
  (off by default).
- **Mechanism:** when checked, the launcher sets `PUBLIC_IE_DEBUG=1` in the **environment of the
  spawned build process** (not by string-editing `build_cmd` — that's cross-platform fragile).
  Vite's `define` reads `process.env.PUBLIC_IE_DEBUG` → `__IE_DEBUG__ = true`.
- **Contract for this repo:** the only thing the engine/games depend on is the env var name
  `PUBLIC_IE_DEBUG`. Documented here so the launcher side is a clean add. Interim, before the
  checkbox ships: a debug build is produced by running the build with `PUBLIC_IE_DEBUG=1`
  (e.g. a temporary tweak to the project's `build_cmd`, or a local `pnpm build`).

## Security / footprint

- Debug-**off** (default publish): `__IE_DEBUG__` is a static `false`; the registry, menu, stage,
  and all per-game tool modules are eliminated by the bundler. A shipped player build contains
  **no debug code or affordance**.
- Debug-**on**: the button is visible by design (that's the point). Don't gate anything
  security-sensitive behind "debug build present" — it's a developer/QA artifact, not a secret.

## Build plan (ordered)

- **D1 — Build switch.** `__IE_DEBUG__` define + ambient d.ts + `utils-shared/debug.ts`
  (`DEBUG_BUILD`). Add the `define` to all `apps/*` vite configs and to `new-game.mjs`. Verify a
  production `vite build` with no env strips a sentinel `if (__IE_DEBUG__) console.log()`.
- **D2 — Registry.** `state-shared/stateDebug.svelte.ts` + `registerDebugTool`. Unit-level: register
  is idempotent by id; `toggle` flips `active`.
- **D3 — Surfaces.** `<DebugMenu>` (components-ui-html) + `<DebugStage>` (components-pixi), both
  `{#if __IE_DEBUG__}`. Menu: floating button → panel listing `stateDebug.tools` with toggles;
  hosts html tools. Stage: renders active pixi tools.
- **D4 — Migrate existing tools (apps/lines first).** Wrap `SymbolDebugOverlay` as a registered
  `surface:'pixi'` tool; turn the win-state probe into a `surface:'html'` `WinStateProbe` panel.
  Delete the old `SymbolDebug.svelte` + hotkey/`$effect` wiring. Mount `<DebugStage>`/`<DebugMenu>`
  in `apps/lines/Game.svelte`. Verify byte-identical when off; menu+tools work in `pnpm dev`.
- **D5 — Mirror to the other reference games** (`cluster`, `scatter`, `ways`, `number-picker`,
  `price`) per the record-every-engine-change rule, to the extent each has debug-worthy tools.
- **D6 — Book of Borut.** Mirror D4 into the Book-of-Borut repo (its own `Game.svelte`,
  `SymbolDebugOverlay`, win-probe) + add the `define` to its `vite.config`. This is the game the
  owner is actively publishing.
- **D7 — Launcher checkbox.** "Include debug tools" in the Build & publish dialog → sets
  `PUBLIC_IE_DEBUG=1` in the build env. (Desktop-launcher app, separate repo; portal exposes the
  per-publish flag if needed.) Prove end-to-end: publish Borut with debug on → open the deployed
  game → on-screen button → Symbol overlay shows H1·win / L2·win → `T_Icon_Pear`.

## Open decisions

- **Menu chrome placement** — corner button (which corner?) vs a slide-in tab. Default:
  bottom-right floating button, panel slides from the right. Cheap to change.
- **Tool persistence** — remember which tools were toggled on across reloads (per-origin
  `localStorage`)? Nice-to-have; default off.
- **`d` hotkey** — keep as an optional "open menu" shortcut inside debug builds, or drop entirely
  in favour of the button? Default: keep as an alias for "toggle menu".
- **HTML vs Pixi for the menu** — chosen HTML so it's reliably clickable on top of the canvas and
  trivial on mobile; tools themselves pick their own surface.
