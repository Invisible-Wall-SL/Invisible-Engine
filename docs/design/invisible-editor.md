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

---

## 7. Addendum — Templates + Import (owner direction 2026-06-02)

v1 (§1–6) proved the pipe physically works: editor → `scenes.json` → `<LayoutScene>` → engine, with the runtime R2 fetch shipped and `editor-scenes.ts` as the checked-in fixture. Two follow-on capabilities are now in scope and are **designed together** because they reinforce each other:

1. **Template/slot contract** — make a placement *mean* something to the engine instead of being free scenery.
2. **Import an existing game** — open a shipped game (`lines`/Borut) in the editor with its current layout already populated, instead of authoring from a blank canvas.

The link: **the template is the target schema; import is the first-fill of that schema from the engine's own truth.** New game = pick a template, slots empty. Existing game = same template, slots auto-filled by the importer. The editor is the human-refinement layer over whichever start you got.

### 7.1 Template/slot model

Each **game type** (`lines`, `cluster`, `ways`, `book-of`, …) ships a **template manifest**: the scenes it has, and within each scene the named **slots** an author may fill.

```ts
// packages/engine-layout/src/lib/types.ts (additions)

export type SlotKind = 'sprite' | 'spine' | 'text' | 'mount';

export interface TemplateSlot {
  slotId: string;            // stable, unique within the template (e.g. 'boardFrame', 'logo', 'reelGrid')
  name: string;              // human label shown in the editor
  kind: SlotKind;
  required?: boolean;        // save-time validation: a required slot must be filled
  // 'mount' slots are engine-owned: the editor only places the anchor transform;
  // the game fills the content at runtime (reel grid, win-lines, symbols…).
  // It resolves through the existing bind/registry path, keyed by slotId.
  mountComponent?: string;   // for kind:'mount' — registered component name (see registerBoundComponents)
  // Optional authoring hint: which asset kinds the editor offers for this slot.
  accepts?: ('sprite' | 'spine' | 'text')[];
}

export interface TemplateScene {
  id: string;                // 'loading' | 'basegame' | 'freegame' | …
  name: string;
  slots: TemplateSlot[];
}

export interface GameTemplate {
  gameType: string;          // 'lines' | 'cluster' | 'book-of' | …
  version: 1;
  scenes: TemplateScene[];
}
```

**Schema change to the existing node types:** add an optional `slotId?: string` to `BaseNode`. A node with a `slotId` is "filling that slot"; a node without one is free scenery (still allowed — slots constrain, they don't forbid). This is purely additive; existing `scenes.json` docs and the `editor-scenes.ts` fixture stay valid.

**Slot kinds:**
- `sprite` / `spine` / `text` — **artist-owned static scenery**: background, board frame, logo, buy button, free-spin intro pose. The editor places a real `SpriteNode`/`SpineNode`/`TextNode` and the author owns its transform.
- `mount` — **engine-owned**: the editor only places the *anchor* (a `ContainerNode` carrying the `slotId`); at runtime the game fills it via the registry, keyed by `slotId`. This is the typed replacement for today's freeform `bind: { component }` escape hatch. `reelGrid` (filled by `boardLayout()` + symbols) is the canonical example. The `bind` hatch stays for one-offs not worth templating.

**Consumption:** `<LayoutScene>` already walks nodes. It gains: resolve `mount` nodes through the same registry `registerBoundComponents()` uses, keyed by `slotId` (falling back to `bind.component` when present). No new render path.

**Validation:** `editorStorage.normalizeDoc` (launcher) gains a template-aware pass — given the project's `gameType`, flag any `required` slot with no filling node ("slot `boardFrame` empty"). Surfaced in the editor's save/dirty UI, non-blocking save but visibly warned.

**New-project seeding:** the scaffold (`docs/design/r2-client-isolation-and-scaffold.md`) already seeds an empty `scenes.json`. It instead seeds **from the chosen template**: one empty scene per `TemplateScene`, no nodes, slots advertised as drop targets. "Start a new game" becomes *pick template → fill its slots → engine builds it.*

### 7.2 Import — first-fill a template from the engine's own truth

Goal: point the importer at `lines` (or Borut) and get a `scenes.json` whose slots are already placed with the game's current resolved coordinates, ready to open in the editor.

**Mechanism — derive from the engine's layout helpers, do NOT scrape source or capture at runtime.** The `editor-scenes.ts` fixture is the proof of concept: it reconstructs `BoardFrame.svelte` by computing from `boardLayout()`, `mainSizesMap`, and the component's `SPRITE_SCALE` / `POSITION_ADJUSTMENT` constants — all statically computable, all the real source of truth.

- ❌ **AST scrape of `.svelte`/`.ts`** — coords are derived (`boardLayout()`, responsive `mainSizesMap`, per-layoutType uniform scale), not literals. Cannot resolve statically.
- ❌ **Runtime scene-graph capture** — brittle; needs a funded Play4Fun RGS mock just to render the board (see Borut step-10b blank-basegame note), and mixes dynamic state into static scenery.
- ✅ **Per-game `defaultLayout()` builder** — promote `editor-scenes.ts` from a hand-written one-off into a **template-shaped generator** living next to each game's template. It calls the same layout functions the game uses and emits a `LayoutDoc` with each static slot filled (base + sparse per-layoutType overrides, exactly as the fixture does).

**Import flow:**
1. `defaultLayout(gameType)` runs (server-side or a small CLI) → `LayoutDoc` filling the template's `sprite`/`spine`/`text` slots, and dropping anchor `ContainerNode`s for `mount` slots.
2. Upload to `editor/<projectKey>/scenes.json` in R2 (idempotent; only when no author-edited doc exists, or behind an explicit "re-import / reset to engine defaults" action — never silently overwrite hand edits).
3. Author opens `/editor`, sees the game already laid out, refines.

`mount` slots need no import data — the importer just places the anchor; the game fills them at runtime. This is why combining 1+3 makes import tractable: the template tells the importer *exactly which slots are static (must be filled) vs engine-owned (anchor only)*, so it never tries to reverse-engineer dynamic content.

### 7.3 Build order (addendum)

1. Types: add `SlotKind`/`TemplateSlot`/`TemplateScene`/`GameTemplate` + `slotId?` on `BaseNode` in `engine-layout`. Additive, no behaviour change.
2. `<LayoutScene>`: resolve `mount` nodes via the registry keyed by `slotId` (keep `bind` fallback).
3. First template: `apps/lines` `template.ts` (scenes: `loading`/`basegame`/`freegame`/…; slots: `boardFrame` sprite, `reelGrid` mount, `logo`, …).
4. `defaultLayout('lines')` — refactor `editor-scenes.ts` into the template-shaped generator; assert it round-trips through `normalizeDoc` and renders identically to today (visual parity gate, same as step 9/10).
5. Launcher: template registry + template-aware `normalizeDoc` validation; scaffold seeds `scenes.json` from template.
6. Editor UI: slots as labelled drop targets in the outliner/canvas; required-slot warnings; "re-import from engine defaults" action.
7. Prove on **Book of Borut** (engine submodule): import → refine → run against the RGS mock; confirm `reelGrid` + animated overlays still mount.

### 7.4 Open decisions (addendum)

- **Where `defaultLayout()` runs** — server-side launcher function vs a `engine-layout` CLI vs a dev-only route in the game app. Recommend: a pure function in each game's `src/game/` (re-using its own layout consts) that a thin launcher endpoint *or* CLI calls — keeps the engine truth co-located with the game.
- **Re-import semantics** — never overwrite an author-edited doc silently. Recommend an explicit, confirmed "reset scene to engine defaults" per-scene action, plus auto-import only when no doc exists.
- **`gameType` source** — the project/client model needs to know each project's `gameType` to pick its template. Confirm where that's stored (launcher project record vs `scenes.json` header vs template inferred from a manifest).
- **Slot vs free scenery strictness** — v1 recommendation: slots are advisory drop targets + validation, free nodes still allowed. Revisit if we want strict template conformance later.

### 7.5 Authoring templates in the editor (owner direction 2026-06-02)

The same tool that *fills* a template should also *create* one. A `GameTemplate` is structurally a `LayoutDoc` with two differences — its nodes carry **slot metadata** (`slotId`/`name`/`kind`/`required`) instead of binding concrete assets, and `mount` slots are bare anchors. So template authoring is **a mode on the existing canvas**, not a new surface: place nodes, tag each as a slot, export a `GameTemplate` instead of a filled doc. All the drag/transform/outliner/override machinery is reused.

**The hard boundary — declare ≠ implement.** The editor can fully author the *skeleton + static slots* (`sprite`/`spine`/`text` placements, anchors, required flags). It can *declare* `mount` slots (drop an anchor, set `kind:'mount'` + `mountComponent`), but what fills a mount at runtime is engine code. So a mount slot is a **contract the game must satisfy** via `registerBoundComponents()` — exactly the validation shape of a missing localization key or an unknown `bind.component` today: warned at editor save-time, logged + safely skipped at game boot.

**Templates become data, with a code fallback — symmetric with `scenes.json`:**

| | Source of truth (R2) | Checked-in fallback |
|---|---|---|
| Layout | `editor/<projectKey>/scenes.json` | `editor-scenes.ts` |
| Template | `editor/templates/<gameType>.json` | per-game `template.ts` |

R2 template is authored visually and is the source of truth; `template.ts` is the offline/boot fallback — the same R2-doc-with-code-fallback model §7.2 / `loadEditorScenes()` already use. This lets a designer create a new game type's template without a deploy, while the engine still validates mount components at boot. New-project seeding (§7.1) reads the R2 template when present, the code fallback otherwise.

**Authoring affordances (additive to the editor UI):** a "template mode" toggle; per-node "convert to slot" (set `slotId`/`name`/`kind`/`required`); a mount-component picker populated from the game's registered names (so you can only name a mount that exists, or are warned if you type a new one); export/save to `editor/templates/<gameType>.json`. Filling mode then surfaces those slots as the drop targets from §7.1.

**Build order impact:** this is a follow-on to §7.3 — land the template *schema + filling + import* first (so the contract is proven against `lines`), then add the authoring mode. Don't build authoring before the engine honours templates, or you can author slots nothing consumes.

**Added open decision:** template *versioning/migration* — when a designer edits a template that existing projects already filled, how do their `scenes.json` docs reconcile (orphaned slots, newly-required slots)? Defer to post-v1, but note it: a template edit is a schema change to every project on that template.

### 7.6 Symbol naming convention as a shared contract (owner direction 2026-06-02)

Companion to the slot contract: a **slot** says *where + what role* (boardFrame, reelGrid); a **symbol name** says *what the asset is* (`H1` is a high-pay symbol). The engine already speaks this language, but the rule is implicit and the classification is duplicated. Make it an explicit, shared contract.

**It already exists — wire it, don't reinvent.** `packages/game-spec/src/schema.ts` already models it:
- `SymbolKindSchema = 'high' | 'low' | 'wild' | 'scatter' | 'wildScatter' | 'bonus' | 'multiplier'` — "drives engine behaviour AND info-page rendering".
- `SymbolSpec = { id: 'H1'|'L1'|'W'|'S'…, kind, name?, pay?, asset?, trigger? }`. `id` is the symbol's canonical name; `kind` is its pay-class; `asset.key` (`'h1.webp'`, `'M'`) is the loaded texture, which may differ from `id`.

Today's gap is purely wiring + enforcement:
- The engine hardcodes `HIGH_SYMBOLS = ['H1'…'H5']` (`apps/lines/src/game/constants.ts`) and infers scatter/wild by ad-hoc prefix checks. Nothing reads `SymbolSpec`.
- `id` and `kind` are independent fields — `{ id:'H1', kind:'low' }` is structurally valid. The name is not yet authoritative.
- The editor doesn't read the spec at all.

**The contract (make the name authoritative):**
- A canonical prefix convention, owned by `game-spec`: `H{n}` → `high`, `L{n}` → `low`, `W` → `wild`, and `S` → `scatter` **or** `wildScatter` (the special symbol can be both — Book-of uses `S` as the Book). Reserved tokens for `bonus`/`multiplier`. (No `mid` tier today — `multiplier` is its own kind, and `M` currently appears only as an *asset filename*, not a symbol id. Adding an `M{n}` mid-pay tier is a deliberate `SymbolKindSchema` extension, not an existing fact.)
- **Built** (`packages/game-spec/src/symbols.ts`): `classifySymbol(id)` for the unambiguous prefixes + `isKindConsistentWithId(id, kind)` — the *compatibility* check, since `S` is legitimately `scatter` or `wildScatter`. The editor / spec validation call these so `H1` cannot be declared anything but high-pay, without rejecting a valid `{ id:'S', kind:'wildScatter' }`. A hard `SymbolSpec` schema refinement is **deferred** (it would have to encode the same compatibility rule and risks breaking existing specs); the helper is the contract for now.
- The RGS/protocol vocabulary (`PIC1`, `SCAT` — see `packages/utils-shared/paytable.ts`) is a **separate space** translated into engine names at the RGS adapter/facade boundary. The editor and templates only ever speak engine names; adapters own the mapping.

**Two readers, one source:**
- **Engine** derives `HIGH_SYMBOLS`, scatter/wild handling, and paytable `mode` from the project's `SymbolSpec[]` via `classifySymbol`, instead of hardcoding.
- **Editor** reads the same `SymbolSpec[]` to (a) group the asset library by kind ("High / Low / Scatter / Wild"), and (b) validate `mount` slots: a `reelGrid` slot declares its symbol-set requirement in `SymbolKind`s ("requires ≥1 scatter, ≥1 wild"), and the editor warns if the project's atlas provides no matching-named frames. This is the asset-identity layer beneath the slot/position layer — together they are the full "declare ≠ implement" contract: the editor declares + validates against names; the engine implements behaviour keyed off the same names.

**Build order impact:** independent of, but complementary to, §7.3. The `classifySymbol` + refinement can land in `game-spec` early (small, self-contained); engine-side consumption (replace `HIGH_SYMBOLS`) and editor-side grouping/validation follow when their respective surfaces are touched. Don't block the template work on it.

**Decision (owner 2026-06-02):** keep high/low only for now — **no `mid` tier**. Add `'mid'` + an `M{n}` prefix only when a game needs it. The human-readable tier list is published at [`docs/conventions/symbol-naming.md`](../conventions/symbol-naming.md) (mirrors `SymbolKindSchema`; code stays source of truth), linked from the Sheet Maker / Atlas Maker tool docs where regions are named.

---

## 8. Addendum — Components (prefabs) + authored behavior (owner direction 2026-06-05)

§1–7 give the editor four tiers: **node** (sprite/spine/text/container) → **scene** (a screen's nodes) → **template** (the typed slots a scene must fill) → the `mount`/`bind` escape hatch for engine-owned content. The missing tier is a **reusable composite between node and scene**: a named object that bundles several nodes (and their mount anchors) into one thing the editor can open, display, place, and reuse. The owner calls these **components**; "Base game overlays" is the canonical example. Today that overlay group is opaque code (`Win.svelte` + `Transition.svelte` mounted via `bind`), so the editor can't show it — making it a component is what lets the editor "display everything," which is the locked-in end-goal (open a project and *see* the real game composed).

**Owner decisions (2026-06-05), all the ambitious branch:**
1. **Core intent = both, one mechanism** — the same `ComponentDef` both *data-fies today's coded pieces* (so they're visible/composable) and *serves as a reusable prefab* across scenes/games.
2. **Contents = layout + authored behavior** — a component carries static placements, mount anchors, **and** authored animation/behavior, not just bindings to coded behavior. This is the large, novel layer; §8.5 bounds it so it doesn't break `declare ≠ implement`.
3. **Scope = both tiers** — a shared global library **and** per-project components (project shadows shared).

### 8.1 The component tier (where it fits)

A **component** is structurally a **mini `LayoutDoc`**: a reusable node sub-tree with its own params, slots, and behavior. It sits one level below a scene. A scene (or another component) references it through a new node kind, `componentInstance`, which `<LayoutScene>` **expands** while walking nodes — same "no new render path" discipline kept for `mount`. This is the well-trodden prefab / nested-symbol pattern (Unity prefab, Flash symbol, Rive artboard), adapted to the existing `LayoutNode` model.

### 8.2 Data model (additive)

```ts
// packages/engine-layout/src/lib/types.ts (additions)

export interface ComponentDef {
  id: string;                  // stable, unique (e.g. 'baseGameOverlays')
  name: string;                // human label
  version: number;             // bumped on edit; instances pin a version (§8.9)
  scope: 'shared' | 'project';
  root: ContainerNode;         // the sub-tree (a container + children) — reuses LayoutNode
  params?: ComponentParam[];   // typed inputs an instance or the engine can set
  signals?: ComponentSignal[]; // named triggers the engine fires (enter/exit/win/…)
  tracks?: BehaviorTrack[];    // authored timelines keyed by signal (§8.5)
  slots?: TemplateSlot[];      // optional: a component may expose its own slots
}

export interface ComponentParam {
  key: string;                 // 'winAmount', 'tint'
  kind: 'number' | 'string' | 'color' | 'boolean';
  default?: unknown;
  // declare≠implement: a param the ENGINE supplies at runtime (not author-set).
  // The editor only declares it; the game feeds the value when it fires a signal.
  engineProvided?: boolean;
}

export interface ComponentSignal {
  key: string;                 // 'enter' | 'exit' | 'idle' | custom ('win', 'bigWin')
  note?: string;               // doc of which engine/book event the game wires it to
}

// New node kind — a placement that references a ComponentDef.
export interface ComponentInstanceNode extends BaseNode {
  kind: 'componentInstance';
  componentId: string;
  componentVersion?: number;   // pin; omit = latest (§8.9)
  params?: Record<string, unknown>;  // author-set param overrides
  // BaseNode already gives transform + per-layoutType `overrides` + `slotId`.
}
```

`LayoutNode` gains `| ComponentInstanceNode`. Everything else is purely additive — existing `scenes.json` / templates / `editor-scenes.ts` stay valid.

### 8.3 Storage + scope (both tiers)

Symmetric with scenes (`editor/<projectKey>/scenes.json`) and templates (`_shared/editor-templates/<gameType>.json`):

| Tier | R2 key | Source of truth |
|---|---|---|
| Shared component | `_shared/editor-components/<id>.json` | reusable across all clients/projects/game types |
| Project component | `editor/<projectKey>/components/<id>.json` | project-local; **shadows** a shared component of the same id |

`componentStorage.ts` (launcher) = `loadComponent(id, projectKey?)` (project shadows shared, exactly like `loadTemplate`'s R2-over-built-in precedence), `saveComponent`, `listComponents(scope)`. Launcher routes `GET/POST /api/editor/component` + `GET /api/editor/components`, all `toolScope.gate('editor')`.

### 8.4 Authoring — a mode on the existing canvas

Like Template mode (§7.5), component authoring is **not a new surface**: open/create a component on the same canvas, edit its `root` sub-tree with all the existing drag/transform/outliner/override machinery, save to R2. In scene mode, a **component picker** drops a `ComponentInstanceNode`; the Properties panel edits its `params` and per-layoutType transform. Editing a component and editing a scene are the same canvas in two modes (scene mode / template mode / component mode).

### 8.5 Behavior model — the `declare ≠ implement` bridge (the hard part)

The owner wants to author behavior **in** the editor. The danger: the overlays it would replace are *book-event-driven* (`Win.svelte` reacts to a `winInfo` event with a real amount, counts up, etc.). We must NOT try to author that data/branching logic as data — that way lies a worse, slower codegen. The line that keeps `declare ≠ implement` intact:

- **The editor authors the *timeline*** (tweens on node props, spine animation playback, particle bursts) and **declares** two things: named **signals** (when to play) and **engine-provided params** (values fed in).
- **The engine implements the *triggers and data***: it fires the declared signals (mapping book events → signal once, the same way `registerBoundComponents` maps names → components) and supplies the `engineProvided` param values.

So the editor says *"on the `win` signal, play spine `celebrate` and count a text node up to `winAmount`"*; the engine says *"`win` = the `winInfo` book event, and here is `winAmount`."* Neither side owns both halves.

```ts
export interface BehaviorTrack {
  signal: string;              // which ComponentSignal triggers this track
  steps: TweenStep[];
}

export interface TweenStep {
  targetNodeId: string;        // a node inside the component's root
  delay?: number; duration: number; ease?: string;   // seconds / GSAP ease name
  // exactly one of:
  prop?: { name: 'x'|'y'|'alpha'|'scaleX'|'scaleY'|'rotation'|'tint'; from?: number; to: number };
  spine?: { animation: string; loop?: boolean };
  // bind a text node to an engine-provided param (the one data binding in v1):
  bindParam?: { key: string; countUp?: boolean };    // key must be engineProvided
}
```

**v1 behavior ceiling (a staging line, not the destination):** node-prop tweens + spine playback + signal-triggered tracks + *one* data binding (count-up text from an `engineProvided` param). Anything needing branching, RGS math, or stateful logic is, **for v1**, still a coded `mount`. We are building a small interpreted timeline (GSAP under the hood) first, not a scripting language — but the coded `mount` is scaffolding to be removed, not a permanent boundary (§8.7).

### 8.6 Engine consumption

`engine-layout` gains a `<ComponentInstance instance={node} />` that:
1. resolves the `ComponentDef` (R2 with code fallback, like everything else),
2. renders `def.root` through the existing `LayoutNodeView`/`<LayoutScene>` walk (static composition — works with zero behavior),
3. subscribes to the declared `signals` on `utils-event-emitter`, and on a signal runs the matching `BehaviorTrack` via GSAP, reading `engineProvided` params from the firing payload.

The game wires book-event → signal + supplies params **once**, via a small registry mirroring `registerBoundComponents` (e.g. `registerComponentSignals({ baseGameOverlays: { win: emitter.on('winInfo', …) } })`). Editor declares signal *names*; engine owns the *wiring*.

### 8.7 The `mount`/`bind` hatch is a scaffold, driven to zero (owner direction 2026-06-05)

**Correction to the earlier "both coexist permanently" steer.** The owner does *not* want a permanent coded escape hatch. The end-goal is a **bidirectional translator between code and editor** so that *all* hand-coded work can be done visually. `mount`/`bind` is therefore a **migration scaffold**, not a fixture: it holds a concern until that concern has a real visual primitive, then it goes away. The target is **zero coded mounts** for the games we ship.

That goal is more reachable than it sounds, but only because the work splits into three layers that are *not* equally hard — and being honest about which is which is the whole plan:

1. **Placement / scenery** (where things sit) — *fully visual already.* Nodes, scenes, templates (§1–7).
2. **Presentation behavior** (entrance/exit tweens, spine playback, particle bursts, count-ups, reactions to a named signal) — *visual via the timeline/signal model* (§8.5). This is the bulk of what `Win`/`Transition`/intros actually do, and it is tractable as data.
3. **Game logic / flow / math** (reel evaluation, win-line geometry, RGS book consumption, the XState game flow) — *the genuinely hard layer.* This is program logic, not layout or animation.

The decisive fact that makes "no escape hatch" realistic: **the math is already external.** Stake's model (and ours) puts game math in the Python math SDK, delivered to the frontend as pre-determined "books." So the frontend rarely *computes* — it mostly *presents a pre-computed result*. That collapses most of layer 3 into layer 2 (read book event → drive a timeline). What's genuinely irreducible on the frontend is narrow: the reel/board render loop, win-line geometry, the flow skeleton, RGS plumbing.

**So we remove the hatch by making it unnecessary, concern by concern** — each coded `mount` is retired when its concern gets a typed visual primitive (board/reels → a configurable grid primitive; win-lines → line data; UI → a placeable block; flow → see the fork below). Per [[feedback_engine_extensibility]] this is still "defang, don't gut": we don't delete `Win.svelte` on day one — we migrate `Transition` first, prove the model, then walk the list down to zero. "Permanent coexistence" was the wrong framing; "scaffold with a demolition order" is the right one.

**The one real fork — how to make layer 3 visual.** For the irreducible logic/flow that can't be reduced to a timeline, there are two routes, and they differ by an order of magnitude:
- **(A) Visual scripting / node-graph** — author logic itself as connected nodes (Unreal Blueprint / Unity Visual Scripting / Rive state-machine / Godot VisualScript). This is the literal "do the hard-coded work visually" and the true *code↔editor translator*, but it is a visual-programming platform — a multi-quarter effort, not a feature.
- **(B) Presentation-complete, logic-bound** — make *everything presentational* visual (layers 1–2 to 100%), and let the small irreducible logic core stay code behind a single typed contract that the editor *configures* (parameters, not control flow). ~95% of "build a game visually" with a fraction of (A)'s cost.

✅ **DECIDED (owner 2026-06-05): route (B) is the v1–v2 destination.** Make everything presentational visual (layers 1–2 to 100%) — that already retires almost every coded mount. The small irreducible logic core stays code behind one typed contract the editor *configures* (parameters, not control flow). **Route (A) — visual scripting / node-graph — is explicitly a later, separately-scoped initiative**, NOT a v1–v2 goal; visual-scripting ambition must not block shipping presentation-complete authoring. Revisit (A) only once (B) has driven the mount list near zero.

### 8.8 Build order (layered — behavior is LAST)

1. **Schema** — `ComponentDef` / `ComponentInstanceNode` / `componentInstance` kind in `engine-layout`. Additive, no behavior. Round-trips `normalizeDoc`.
2. **Static expansion** — `<LayoutScene>`/`<ComponentInstance>` renders `def.root` (static only). Prove a hand-written static component renders identically inlined vs instanced.
3. **Storage (both tiers)** — `componentStorage.ts` (shared + project shadow) + launcher API routes.
4. **Editor component mode** — open/create/save a component on the canvas; component picker drops an instance; param overrides in Properties.
5. **First real component** — extract a *static* composite (e.g. logo + frame group) and reuse it across two scenes. Proves visibility + reuse end-to-end **before any behavior**.
6. **Behavior layer** (the big one) — signals + `engineProvided` params + `BehaviorTrack`; the GSAP interpreter in `engine-layout`; `registerComponentSignals` in the game; editor timeline UI (per-signal track editor). v1 ceiling per §8.5.
7. **Migrate one coded overlay** — move `Transition` (simplest) from a coded `mount` to an authored component as the proof; keep `Win` coded until then.

Land 1–5 (composition + reuse, no behavior) and stop to verify online before starting 6 — the behavior layer is where scope can run away, and it's worthless if the composition tier isn't solid first.

### 8.9 Open decisions (need owner input)

- **Versioning / migration** — ✅ **DECIDED (owner 2026-06-05): version components, pin-by-default.** Instances pin `componentVersion`; editing a component bumps its version; an instance stays on its pinned version until an explicit per-instance "update to latest." Same model as template versioning (§7.5). Still to spec: where the "update to latest" action lives + how a bumped component flags its outdated instances.
- **Layer-3 fork (the big one)** — ✅ **DECIDED (owner 2026-06-05): route B** (presentation-complete; logic core stays code behind one editor-configured contract) is the v1–v2 destination. Route A (visual-scripting/node-graph) is a later, separately-scoped initiative, not a v1–v2 goal. See §8.7. This anchors build order past step 7: keep extending presentation primitives + retiring mounts; do **not** start a logic node-graph.
- **Nesting** — components inside components: recommend allow (1–2 levels v1) with a **hard cycle guard** (a component cannot instance itself transitively). Confirm depth.
- **Behavior ceiling** — confirm the §8.5 line (timeline + spine + one count-up binding; everything stateful stays `mount`). This is the decision most likely to creep.
- **Signal vocabulary + wiring** — fixed core (`enter`/`exit`/`idle`) + per-game custom signals mapped to book events in **code** (`registerComponentSignals`) for v1; editor only declares names. Confirm engine owns the wiring (vs a data-authored event map later).
- **Shared vs project precedence** — confirm project component **shadows** shared of the same id (mirrors template R2-over-built-in).
- **Does a component subsume a template?** — a `ComponentDef` and a `GameTemplate` are both "mini `LayoutDoc` + metadata." Decide whether a template is just a top-level component, or they stay distinct (recommend distinct for now: template = per-scene slot contract, component = reusable instanced object; revisit if they converge).
