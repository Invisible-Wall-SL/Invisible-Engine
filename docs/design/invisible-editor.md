# Invisible Editor — Design (v1)

The missing layout step in the pipeline. Sheet Maker defines regions, Atlas Maker generates art, Spine packs animations. The editor places those assets across game **screens**, exporting a JSON layout the engine renders. Animation/book-event logic stays in code on top of the static layout.

## 1. What the engine looks like today

Games (`apps/lines`, `apps/cluster`) build their UI as Svelte component trees inside `<App>` (from `pixi-svelte`). Each component places a sprite/spine with explicit props on `pixi-svelte` primitives (`Sprite`, `SpineProvider`, `Container`, `Rectangle`, `Text`, `ParticleEmitter`). See `apps/lines/src/components/Game.svelte`, `Background.svelte`, `BoardFrame.svelte`, `Symbol.svelte`.

Key facts the editor must respect:

- Assets are registered in `apps/<game>/src/game/assets.ts` keyed by string (e.g. `"frame_bg.png"`, `"H1"`). `<Sprite key=…>` and `<SpineProvider key=…>` read `context.stateApp.loadedAssets[key]` (see `packages/pixi-svelte/src/lib/components/Sprite.svelte`, `SpineProvider.svelte`).
- Placement props are bare Pixi: `x, y, width, height, anchor, scale, rotation, alpha, zIndex, tint` — derived from `OverwriteCursor<PIXI.SpriteOptions>` / `PIXI.ContainerOptions`.
- Responsive layout is `utils-layout/createLayout` — a fixed `mainSizesMap` per `layoutType` (`desktop | tablet | landscape | portrait`) with a single uniform `scale`. Screens are authored in main-layout coordinates inside `<MainContainer>` (`packages/components-layout/src/components/MainContainer.svelte`). Background sprites use a separate `normalBackgroundLayout({scale})` derivation. Children outside `<MainContainer>` (e.g. `Background`, `LoadingScreen`) draw in canvas coords.
- "Screens" today are not first-class — they are `{#if context.stateGame.gameType === 'basegame'}` / `{showLoadingScreen}` toggles in `Game.svelte`. Per-screen book-event animation lives in dedicated components (`Win.svelte`, `FreeSpinIntro.svelte`, `Transition.svelte`).

The editor exports a **complementary** layer: static layout for sprites/spines/containers/text per screen, per `layoutType`. Animated/book-event-driven things stay coded.

## 2. Layout data format (`scenes.json`)

Stored at R2 key `editor/<projectKey>/scenes.json`, same pattern as `localization/<projectKey>/strings.json`.

```ts
// packages/engine-layout/src/types.ts (proposed new package)
export type LayoutType = 'desktop' | 'tablet' | 'landscape' | 'portrait';

export interface LayoutDoc {
  version: 1;
  projectKey: string;
  mainSizesMap: Record<LayoutType, { width: number; height: number }>;
  scenes: Scene[];
  updatedAt: string;
}

export interface Scene {
  id: string;              // 'loading' | 'basegame' | 'freegame' | 'winIntro' | …
  name: string;            // human label
  nodes: LayoutNode[];     // tree (children inside container nodes)
}

export type LayoutNode =
  | ContainerNode
  | SpriteNode
  | SpineNode
  | TextNode;

interface BaseNode {
  id: string;              // stable uuid
  label?: string;          // editor-only
  // Placement in main-layout coords for the *base* layoutType (desktop).
  x: number; y: number;
  anchor?: { x: number; y: number };
  scale?: { x: number; y: number };
  rotation?: number;       // radians
  alpha?: number;
  zIndex?: number;
  // Per-layoutType overrides (sparse). Engine applies override on top of base.
  overrides?: Partial<Record<LayoutType, NodeOverride>>;
  visibleFor?: LayoutType[];   // optional gate (defaults to all)
  // Optional binding to a coded component (escape hatch).
  bind?: { component: string; props?: Record<string, unknown> };
}

export interface NodeOverride {
  x?: number; y?: number;
  width?: number; height?: number;
  anchor?: { x: number; y: number };
  scale?: { x: number; y: number };
  rotation?: number; alpha?: number; zIndex?: number;
  visible?: boolean;
}

export interface ContainerNode extends BaseNode {
  kind: 'container';
  children: LayoutNode[];
}
export interface SpriteNode extends BaseNode {
  kind: 'sprite';
  assetKey: string;        // matches assets.ts key
  width?: number; height?: number;
  tint?: number;
}
export interface SpineNode extends BaseNode {
  kind: 'spine';
  assetKey: string;        // spine key in assets.ts
  width?: number; height?: number;
  defaultAnimation?: string;
  loop?: boolean;
}
export interface TextNode extends BaseNode {
  kind: 'text';
  text: string;            // may be a localization key — engine resolves
  style?: { fontFamily?: string; fontSize?: number; fontWeight?: string; fill?: number };
}
```

Notes:

- Coords are authored once in the base (`desktop`) main-layout space and overridden per layoutType — same model `utils-layout` already uses (uniform scale + per-layoutType `mainSizes`).
- `bind.component` is the escape hatch: e.g. a node with `bind: { component: 'Win' }` tells the engine to mount the existing animated `Win.svelte` at that transform instead of a static sprite. No editor change needed when devs add new bound components.
- `assetKey` references `assets.ts` keys — atlas/spine assets exported by Atlas Maker land in `atlas_maker/cloud/<project>` / `sheet_maker/cloud/<project>` and the editor pulls the registry from R2 (see Section 5).

## 3. Editor v1 scope

- **Screens**: `loading`, `basegame`, `freegame`, `winIntro`, `winOutro`, `freeSpinIntro`, `freeSpinOutro`, `transition` (matches what `lines`/`cluster` already toggle on).
- **Node kinds**: `sprite`, `spine` (static pose preview), `container` (group + transform), `text`. No particles in v1 — particles stay coded.
- **Affordances**: drag, resize handles, rotate handle, anchor presets (9-point), snap-to-grid + snap-to-other-node edges/centres, z-order (bring-forward/send-back), per-layoutType override toggle (you flip into `portrait` mode and the next edit writes an override, never the base), properties panel (`x/y/anchor/scale/rotation/alpha/zIndex/tint/text`), keyboard nudge.
- **Asset library**: lists atlases + spines for the active project, sourced from R2. Drag-and-drop into the canvas.
- **Scene switcher** + node tree (outliner) sidebar.
- **Out of v1**: timeline/animation, particles, hit-tests, in-editor book-event playback (use the live game).

## 4. Architecture

- New launcher tool at `/editor`, role-gated. Add a `ToolDef` keyed `'editor'` in `apps/launcher-api/src/lib/roles.ts` with `url: '/editor'`; grant to `developer` + `artist` + `admin` in `ROLE_TOOLS`.
- Project-centric: requires an active project (uses the same project model as Atlas Maker / Localization).
- Storage: `LayoutDoc` JSON in R2 (`editor/<projectKey>/scenes.json`) with `load`/`save` server functions paralleling `apps/launcher-api/src/lib/server/localization.ts`. Asset list comes from existing R2 listing endpoints under the project's `atlas_maker/cloud/<project>` / `sheet_maker/cloud/<project>` prefixes.
- Server routes: `GET /api/editor/[project]/doc`, `PUT /api/editor/[project]/doc`, `GET /api/editor/[project]/assets`.
- Canvas tech: **PixiJS 8**, embedded via a minimal `pixi-svelte` `<App>` in the editor page. Justification: the editor renders the exact textures/atlases the game will render (same atlas slicing, same Spine runtime, same filter/blend behaviour) — using DOM/SVG forces a second renderer and a constant fidelity drift, especially for spine and tinting. Editor chrome (toolbars, sidebars, properties panel) is plain Svelte/HTML on top of the Pixi canvas.

## 5. Engine-side contract

Add one new package, `packages/engine-layout`, exporting:

- The TS types in Section 2.
- A Svelte component `<LayoutScene scene={Scene} />` that walks `nodes` and emits the matching `pixi-svelte` primitive (`Container`/`Sprite`/`SpineProvider+SpineTrack`/`Text`), resolving per-layoutType overrides via `getContextLayout()` (same `utils-layout` context everything else uses).
- A registry `registerBoundComponents({ Win, FreeSpinIntro, … })` so games declare which `bind.component` names map to which Svelte components.

Game-side migration is one line per screen: replace a hand-coded `<MainContainer><Sprite … /><SpineProvider … /></MainContainer>` block with `<LayoutScene scene={layoutDoc.scenes.find(s => s.id === 'basegame')!} />`. Existing animated components (`Win`, `Transition`, …) keep working via `bind`. No `pixi-svelte` changes required.

Friction: `<Symbol>`, win-line draws, and anything coordinate-derived from runtime state (`boardLayout()`) stay coded — the editor only owns _static_ scenery + frames + labels + intro/outro spine poses. That's an acceptable v1 boundary.

## 6. Build plan (ordered)

1. `packages/engine-layout` — types + a stub `<LayoutScene>` that renders sprites/containers/text/spine from a hard-coded doc. Smoke in Storybook.
2. R2 storage in launcher: `src/lib/server/editor.ts` (load/save/normalize), `src/routes/api/editor/[project]/doc/+server.ts`.
3. Asset listing endpoint reading from `atlas_maker/cloud/<project>` + `sheet_maker/cloud/<project>` — returns `{ assetKey, kind, thumbUrl }[]`.
4. Launcher route `/editor` (auth + role gate + project picker). Shell only.
5. Editor canvas: `<App>` + base `<MainContainer>` mirror + per-layoutType switcher + asset-library sidebar with drag-in.
6. Selection model + transform handles (move, resize, rotate, anchor presets, snap).
7. Properties panel + outliner + scene switcher + z-order + override-mode toggle.
8. Save/load wired to API; autosave + dirty indicator.
9. Engine-side: ship `<LayoutScene>` in `engine-layout`, port `apps/lines` `basegame` background+frame as the first consumer; verify visual parity.
10. Smoke: load `editor/lines/scenes.json` in `apps/lines`, run a real spin against the local Play4Fun mock; confirm animated overlays still mount via `bind`.

## Open decisions (need owner input)

- **Project model unification** — the launcher currently has projects (`src/lib/server/projects.ts`) and Atlas Maker has its own. Editor assumes the launcher's. Confirm before step 3.
- **Asset key namespacing** — Atlas Maker outputs assets per project; the engine's `assets.ts` is per game. Do we (a) auto-generate `assets.ts` from the editor's asset list, or (b) require the dev to register them by hand? Step 5 dependency.
- **`bind.component` discovery** — global string registry vs per-game `registerBoundComponents()`. Per-game is safer; confirm.
- **`<MainContainer>` standard mode** — should `LayoutDoc.mainSizesMap` always equal the game's `stateLayout` map, or do we allow editor-only overrides? Recommend: must match, validated on save.
- **Per-layoutType authoring** — base = `desktop` everywhere, or per-project base? Recommend desktop fixed for v1.
