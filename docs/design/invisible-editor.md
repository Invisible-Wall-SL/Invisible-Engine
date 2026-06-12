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

## 9. Addendum — Fonts: edit text + see/ship the real game fonts (owner direction 2026-06-05)

**Status: SCOPED, not started.** Owner ask: from a selected text node's **Properties** panel, (1) **see the same fonts in the editor that the game renders**, (2) **edit the text** and have it appear in-game, (3) **change the font/bitmap** and have the appearance change in-game.

### 9.1 Why this is two systems (the gap)
- **Editor** draws every text node with **HTML5 Canvas2D** `ctx.fillText` (`apps/launcher-api/src/routes/(app)/editor/EditorCanvas.svelte` ~L849), `fontFamily ?? 'sans-serif'`. It loads **none** of the game's fonts → an unknown family (e.g. a bitmap-font name) silently falls back to a system font. (Same root cause as the older "rendered serif" note in STATUS.)
- **Game** loads bitmap fonts as BMFont `.xml` + page PNG (`apps/lines/src/game/assets.ts` ~L136: `goldFont`/`goldBlur`/`silverFont`/`purpleFont`) and renders custom text via `<BitmapText fontFamily="gold">` (e.g. `FreeSpinCounter.svelte`). Web fonts go through `<Text>` (WebFontLoader).
- **Engine layout text path** is *also* a gap: `packages/engine-layout/src/lib/LayoutNodeView.svelte` (~L116) renders a layout text node with the regular `<Text>` only — so a layout text node **cannot show a bitmap font even in-game** today. Closing both gaps is what makes "what I see in the editor == what ships."

### 9.2 Scope boundary (agreed)
- **In scope:** static / semi-static **layout text nodes** (labels, headings, captions) rendered through `<LayoutScene>` — their string + font are editor-authored and flow to the game via `/api/editor/doc`.
- **Out of scope (v1):** **dynamic coded text** (free-spin counter value, balance/bet/win numbers, count-ups) — the *string* is computed at runtime in coded components and stays coded. Their **font/position** can be made editor-driven later (Phase 4), but not their text content.

### 9.3 Contract + architecture decisions
- **Font catalog = single source of truth.** New `FontEntry { name, kind: 'bitmap' | 'web', files }` in `packages/engine-layout` + a per-project `fonts.json` manifest in R2 (`<client>/<project>/fonts/…`, plus a `_shared/fonts/` library — mirror the spine `includeSharedSpines` posture). The catalog drives: the editor's font dropdown, the editor's renderer (which path), the engine's `<Text>`-vs-`<BitmapText>` choice, the game's boot-time font loading, and editor **validation** (warn when a text node references a font the project lacks — mirrors slot/asset warnings).
- **Editor bitmap rendering = 2D-canvas BMFont blitter (recommended).** Fetch `.xml`+page, parse glyph/kerning table, blit glyph quads with `drawImage` on the existing 2D canvas. Rationale: text already lives on the 2D canvas, no new runtime, controllable metrics. (Alternative considered: route text through a WebGL/PIXI overlay like spine — heavier, only worth it if we need pixel-exact PIXI parity. **Owner decision still open — see 9.5.**)
- **Persistence:** `style.fontFamily` already round-trips via `editorStorage.normalizeDoc`; `node.text` edits already flow to the game for layout text nodes. The new identity (which font + that it's bitmap) is resolved via the catalog by name — no per-node `bitmap` flag needed if the catalog is authoritative.
- **Server pattern:** clone the spine endpoint — `GET /api/editor/fonts` (gated `gate({tool:'editor'})`, returns the catalog) + reuse `GET /api/editor/asset?key=…` to stream `.xml`/page bytes; resolver in `lib/server/fonts.ts`. Sync via `scripts/r2-sync-fonts.mjs` (clone of `r2-sync-spines.mjs`).

### 9.4 Build order (phased; editor-only first, engine contract last)
1. **Phase 0 — contract + fonts into R2 (foundation). ✅ LANDED 2026-06-06 (code-only).** `engine-layout` `FontEntry`/`FontCatalog` in `fontCatalog.ts` (+ `findFont`/`isBitmapFont`); `fonts.json` written by `scripts/r2-sync-fonts.mjs` (BMFont `<info face>`+pages / web-by-ext; `--dry-run` verified on the `lines` fonts); `GET /api/editor/fonts` + `lib/server/fonts.ts` `resolveEditorFonts` (project→`_shared/fonts/` fallback, files via `/api/editor/asset`); `projectPaths` `SUB.fonts`/`fontCatalogKey`/`fontBundlePath`; `toolScope` `includeSharedFonts`. `pnpm --filter {launcher-api,engine-layout} build` GREEN. Owner step: run the sync with R2 creds to seed a project's catalog. Effort ~M, risk low (spine analogue).
2. **Phase 1 — editor fidelity (read-only). ✅ LANDED 2026-06-06 (code-only, not browser-verified).** **WebGL/PIXI overlay (decided, §9.5).** `EditorTextLayer.svelte` — a transparent raw-PIXI `Application` over the 2D canvas (mirrors `EditorSpineLayer`), rendering each TOP-LEVEL text node as `PIXI.BitmapText` (catalog `kind:'bitmap'`) or `PIXI.Text` (web/system), positioned via the parent's `nodeTransform` → `world*zoom+pan` (one coord source, passed as `worldTransformOf`). `fonts.client.ts` loads bitmap fonts through PIXI `Assets.load` and web fonts via `FontFace`; the bitmap descriptor's relative `<page file>` refs are rewritten to absolute editor-gated URLs by `/api/editor/asset?font=1` (the relativity gotcha). Font loads fold into the existing "Loading assets…" overlay (`fontStarted/fontSettled` → `loadPending`); the overlay reports the node ids it owns (`onReadyIdsChange`) so the 2D canvas skips their `fillText` (no double-draw); "↻ Reload art" drops the catalog + bumps `fontReload`. `pixi.js@8.8.1` added as a launcher dep. `pnpm --filter launcher-api build` GREEN. **Caveats:** the overlay matches the GAME's pixi-text anchor, NOT the old `fillText` alphabetic baseline (intended); "Reload art" re-fetches the catalog but the per-font client caches don't reset, so a changed font PAGE needs a full reload. **UPDATE 2026-06-11 — unified text renderer:** `EditorTextLayer` is now the SINGLE renderer for EVERY `kind:'text'` node + HUD text bind anchor — top-level, nested in containers, AND inside `componentInstance` expansions (params threaded like `drawComponentInstance`). The old 2D-canvas `fillText` text path is DELETED. Nested world transforms compose through ONE shared path (`editorCanvas.helpers.ts` `composeWorldMatrix`/`matFromTransform`/`childLocalTransform`): the top-level node is framed by the canvas's `nodeTransform` (the editor equivalent of the single root `<MainContainer>`), every nested node composes in pure local space — so the 2D canvas (refactored to use `childLocalTransform` for nested nodes), the overlay, and the runtime's container tree land every nested node identically. A loading catalog font renders immediately as a system-fallback `<Text>` and swaps in on load (text never disappears). **Owner verify:** seed a project's `fonts.json` (`scripts/r2-sync-fonts.mjs`) then check `app.invisiblewall.org/editor`. Effort ~M–L, risk med (overlay sync + parity). *After this: you see the real fonts.*
3. **Phase 2 — Properties: edit text + pick font. ✅ LANDED 2026-06-06 (code-only).** `EditorProperties.svelte`: the freeform `fontFamily` input is now a `<select>` populated from `/api/editor/fonts` (via the cached `fetchFontCatalog` in `fonts.client.ts`) — `(game default)` + each catalog font tagged `[bitmap]`/`[web]`, with the current off-catalog family preserved as a `(custom)` option so a pick never drops it; an empty-catalog hint points at the sync script. The `text` textarea (already bound to `node.text`) is kept. For a selected **bitmap** font: the `fill` control relabels to **tint** (the overlay maps `style.fill`→`BitmapText.tint`), a note explains "tint + size only (size scales the baked atlas), weight/style/stroke/shadow don't apply", and the **Stroke + Drop-shadow sections are gated off** (`{#if !isBitmapSelected}`). `pnpm --filter launcher-api build` GREEN. **Tradeoff:** replacing the freeform input means an arbitrary (non-cataloged) web family can no longer be typed in — sync it into the catalog first. Effort ~M, risk low.
4. **Phase 3 — engine consumption (makes choices ship; touches the contract).** `LayoutNodeView` renders `<BitmapText>` when the catalog says `kind==='bitmap'`, else `<Text>`; game registers the catalog's fonts in its asset manifest at boot; parity fallback (no change → byte-identical). Parity-gated, per game (`apps/lines` + Book of Borut), same discipline as the reskin rollout. Effort ~M–L, risk med (engine contract change).
5. **Phase 4 — optional.** Browser font upload (drag `.xml`+page → R2, cloud-native, no PowerShell); shared `_shared/fonts/` library; ~~editor-driven fonts for coded HUD text~~ **✅ HUD-text override LANDED 2026-06-06 (owner-chosen, engine+lines+editor)**; per-`layoutType` text style overrides.
   - **HUD-text override (logo / game-name).** The coded HUD corners (`<UiGameName>`, the `logo` `<Text>`) now take an editor-authored **font + size + fill + label** override, so a project can restyle/rename them without touching game code. Contract: `engine-layout` `HudTextOverride { style?: Partial<TextStyle>; text? }` + `getHudTextOverride(node)` (read from the bind anchor's `bind.props`; persists via `normalizeNode` pass-through). Engine: `hudPositions.hudTextOverride()`; `<LayoutEditable>` passes it to the `gameName`/`logo` snippets (`Snippet<[HudTextOverride?]>` — a snippet that ignores the arg keeps parity, so opting in is per-game); `<UI>`/`<UIDefault>` forward the param; `<UiGameName>` + `apps/lines` snippets merge `{ ...base, ...override.style }` and `override.text ?? coded`. Editor: a **"HUD text"** Properties section (font dropdown + size + fill/tint + label) appears for a `container` bind anchor tagged `preview.style:'text'`, writing to `bind.props`; the **PIXI text overlay renders the anchor with the chosen font** (the 2D HUD chip steps aside once the overlay owns it). `pnpm --filter launcher-api build` + `lines` svelte-check GREEN. **To ship in-game:** a game must (a) bump its engine submodule and (b) apply the same `gameName`/`logo` snippet merge (lines = reference), then rebuild/republish — the editor preview works from the doc with no game change.

**Recommended:** land 0→1→2 (faithful, editable preview; editor-only, low risk) and verify online before Phase 3 (the only part that modifies the engine contract).

### 9.5 Open decisions (need owner input)
- **Editor render path** — ✅ DECIDED 2026-06-06: **WebGL/PIXI overlay** (owner choice — pixel-exact PIXI parity over the lighter 2D blitter). Phase 1 mirrors the spine overlay (`EditorSpineLayer.svelte`): a transparent layer above the 2D canvas, here a small PIXI app rendering `<BitmapText>`/`<Text>` from the live `/api/editor/fonts` catalog, kept in sync with pan/zoom. ~~2D-canvas BMFont blitter (recommended, self-contained)~~.
- **Dynamic-text fonts** — ✅ DECIDED 2026-06-06: the **semi-static coded HUD text (logo / game-name) IS editor-overridable** (font+size+fill+label) — landed as the Phase 4 HUD-text override above. Truly dynamic numeric values (balance/win/bet, FS counter) stay coded, per 9.2.
- **Bitmap "change appearance" expectations** — bitmap fonts are baked atlases: tint + scale yes; arbitrary recolor/stroke/shadow no. Confirm that's acceptable, or a font swap (pick a different baked variant, e.g. `gold`→`silver`) is the intended "change appearance" path.
- **Font discovery for the catalog** — seed `fonts.json` from each game's `assets.ts` `type:'font'` entries (Phase 0 sync), or author it in the editor. Recommend sync-from-game first.

## 10. Addendum — Background sizing + fixed window-reference (full-bleed parity) (owner direction 2026-06-06)

### 10.1 The two coupled bugs (measured, not guessed)
Measured from a live game (`[bg-diag]`, window 1639×1301): the engine picked `layoutType: 'tablet'` (almost-square → main box 1000×1000, scale 1.301); the background spine `foregroundAnimation` is authored 3059.92×1501.3.
1. **Background sized wrong in-game.** The coded `Background.svelte` called `normalBackgroundLayout({ scale: 0.5 })` → background at HALF the canvas. `scale: 1` is the exact cover. **Interim fix LANDED** (Book of Borut `Background.svelte` → `scale: 1`, full-bleed). The engine's `createBackgroundLayout` (utils-layout) IS the cover helper; the per-game `0.5` was just wrong for this art.
2. **Editor composites against the ACTIVE scene's frame, not a fixed window.** `+page.svelte` `frameSize` = `mainSizesMap[layoutType]` for `game`-space scenes but `STANDARD_MAIN_SIZES_MAP` for `canvas`/`standard` scenes. So switching the active screen resizes the whole composite (background small on "Base game", big on "Base game overlays"); only fixed game-coord nodes (the reels frame) stay put. This also makes the editor's background never match the full-bleed game.

Root cause is shared: background sizing lives in **two implementations** (engine `createBackgroundLayout` for the game; `EditorSpineLayer.placeArt` cover-to-frame for the editor) AND the editor frames per-active-scene instead of per-viewport.

### 10.2 Design (single source of truth, fixed window reference)
- **One cover helper, true cover from art dims.** Generalize/replace the `backgroundRatio`-driven `createBackgroundLayout` with a cover computed from the art's authored size: `scale = max(targetW/artW, targetH/artH) * coverScale` (default `coverScale = 1` = exact cover), centred. Robust regardless of `backgroundRatio` config. Spine art dims come from `skeleton.data.width/height` (the same source the pixi-svelte spine-sizing fix uses); sprite art from natural size. Lives in `utils-layout`/`engine-layout`, used by BOTH renderers.
- **Game runtime.** Background bind/spine nodes size via the shared cover against the **full canvas** (`canvasSizes()`), reading art dims — so coded `Background.svelte` no longer hardcodes a scale. The cover `scale` + `fit` come from the editor doc node (default exact cover).
- **Editor = fixed window reference.** The composite renders every scene against ONE viewport reference per `layoutType` (the game window), NOT the active scene's frame. `game`/`canvas`/`background` spaces all map into that one window the way the engine does at runtime (main box centred + scaled by `mainLayout`; canvas-edges pinned to the window; background cover-fit to the window). Switching the active screen no longer rescales anything, and the background covers the window = matches the full-bleed game per layout type.
- **Doc-driven.** Background cover `scale` (default 1) + `fit: cover|contain` become node properties editable in Properties; persist via `normalizeNode` pass-through.

### 10.3 Build order
1. **Interim game fix. ✅ LANDED 2026-06-06.** Book of Borut `Background.svelte` `scale: 0.5 → 1` (full-bleed via existing engine cover). Validates the cover; unblocks the game. (Per-game; the pipeline removes the hardcoding.)
2. **Shared cover helper (engine). ✅ LANDED 2026-06-07.** `packages/engine-layout/src/lib/coverTransform.ts` — `coverTransform({artWidth,artHeight,targetWidth,targetHeight,coverScale=1,fit})` → `{scale,x,y}` (true cover from authored art dims, centred). Exported from `engine-layout`; used by `EditorCanvas.backgroundTransform` + `EditorSpineLayer` cover.
3. **Editor fixed window-reference. ✅ LANDED + owner-verified 2026-06-07 (`0f9304a`).** `+page.svelte` `frameSize = STANDARD_MAIN_SIZES_MAP[layoutType]` for ALL scenes (the window — its per-type aspect matches the viewport that selects that layoutType + contains the main box). `EditorCanvas.nodeTransform` game-space maps main→window like `<MainContainer>` (origin `mainToWorld`, scale ×`mainScale`); `writeXY`/`writeScale` invert it so drags round-trip to raw main coords; `backgroundTransform` + `EditorSpineLayer` cover the window via `coverTransform` (`coverScale` default 1); the main box is drawn as a centred inner dashed guide. Switching the active screen no longer rescales the composite; background previews full-bleed per layout type. Editor-only (game unaffected). Owner confirmed selection/drag/scale round-trip + full-bleed across layout tabs.
4. **Doc-driven cover props. ✅ LANDED 2026-06-08 (editor-only; owner verifies visually).** Cover **scale** + **fit** are now doc-driven + editable in the editor Properties. **Canonical fields:** cover scale = `node.scale.x` (uniform multiplier; `1` = exact edge-to-edge); cover fit = `'cover' | 'contain'` read from `node.preview.art.fit` for a `bind` preview-art anchor (the field those anchors already round-trip), else a NEW node-level `BaseNode.fit` for plain `background`-space sprite/spine nodes. Two `engine-layout` readers (`coverTransform.ts`) are the SINGLE source: `backgroundCoverScale(node)` + `backgroundFit(node)`. All THREE editor cover paths now read them — `EditorCanvas.backgroundTransform`, `EditorCanvas.placedArtTransform` (cover branch), `EditorSpineLayer` (`background`-space + `placeArt` cover) — no hardcoded `'cover'`/`1` left. Properties gains a **"Background"** section (cover-scale number input 0.1–4 step 0.05 → uniform `scale`; fit `<select>` → canonical fit field), shown when the page detects the selected node is a background cover node (mirrors `isBackgroundCover`: `background`-space sprite/spine OR a `cover`-placement bind anchor). Cover stays non-draggable; scale is edited via the control. Persistence: `editorStorage.normalizeNode` returns nodes verbatim, so `fit` passes through with no special handling. Step 5 wires the game (engine consumption) next.
5. **Engine consumption + per-game rollout. ✅ ENGINE + pixi-svelte LANDED 2026-06-08 (engine side; owner verifies in-game + applies the per-game `Background.svelte`).** Background sizing is now doc-driven end-to-end through `LayoutNodeView`, reading the SAME `backgroundCoverScale`/`backgroundFit` canonical readers the editor uses — so editor == game for any authored scale/fit.
   - **pixi-svelte (`utils.svelte.ts` `spineSizeScale` + `BaseSpineProvider.svelte`):** new additive `fit?: 'cover' | 'contain'`. When `fit` is set AND both `width`/`height` are given, the spine sizes by a UNIFORM cover (`max`) / contain (`min`) scale from `skeleton.data` dims instead of the per-axis stretch — true cover, no distortion. `fit` absent = prior behaviour (parity); non-background spines unaffected. `SpineProvider` forwards `fit` through `...baseSpineProps` unchanged.
   - **engine `LayoutNodeView.svelte`:** a `background`-space **bind** anchor (Borut's `bg`) now receives a `cover={{ scale: backgroundCoverScale(node), fit: backgroundFit(node) }}` prop on `<Bound>` (additive — a component that ignores `cover` renders exactly as today). A `background`-space **sprite/spine NODE** (non-bind) honours the same readers: the sprite `bg` path applies `backgroundFit` (cover sets the fill axis via `normalBackgroundLayout`, contain sets the opposite axis so the art fits INSIDE the canvas) with `backgroundCoverScale` as the multiplier; the spine path feeds the canvas box on both axes (× cover scale) + `fit` to `<SpineProvider>`, getting a true uniform cover from `skeleton.data` (matching `coverTransform`). Default cover scale is now `1` (`scale.x ?? 1`) — the old per-game `0.5` was the bug §10.1 measured.
   - **Per-game (NOT applied here — separate repo): Book of Borut `Background.svelte`** accepts the new `cover` prop and sizes each background `SpineProvider` to the canvas via the pixi-svelte `fit`; default (no `cover`) stays today's full-bleed `scale:1` cover. Exact before/after is reported with this change. Games bump the engine submodule + apply the snippet + rebuild; parity-gated per game (lines + Book of Borut).

6. **Cover scale ↔ stretch decoupling + coded-Background consumption. ✅ LANDED 2026-06-08 (engine + editor + `apps/lines`; owner-verified full-bleed live in `apps/lines`).** Owner direction: cover scale must be a uniform zoom, and SCALE.X/SCALE.Y a FREE vertical-vs-horizontal stretch — previously they were the SAME field (`backgroundCoverScale = node.scale.x`, and `setCoverScale` wrote both `scale.x`+`scale.y`), so editing cover scale moved the Transform scale and there was no stretch.
   - **Canonical fields changed:** cover scale = NEW dedicated **`BaseNode.coverScale`** (`coverScale ?? 1`, uniform); stretch = `node.scale` (free per-axis, default `{1,1}`) via new reader **`backgroundCoverStretch(node)`**. `coverTransform` now returns `{ scaleX, scaleY, x, y }` = `fitScale · coverScale · stretch{X,Y}`. Persists verbatim through `editorStorage.normalizeNode`. Migration-safe: docs are days old and default `scale` is `{1,1}`, so repurposing `scale` as stretch changes nothing existing.
   - **All cover paths updated** to consume `scaleX/scaleY` + stretch: editor `EditorCanvas.backgroundTransform`/`placedArtTransform`, `EditorSpineLayer`; engine `LayoutNodeView` (bound `cover` now carries `stretch`; sprite/spine bg fold stretch onto width/height + `scale`). pixi-svelte composes stretch with `fit`: `spine.scale.set(baseX·sizeScale.x, baseY·sizeScale.y)` (`BaseSpineProvider.svelte`) — uniform cover × free stretch, no wrapping container.
   - **Coded background is now doc-driven (the real in-game fix).** `apps/lines/src/components/Background.svelte` dropped `normalBackgroundLayout({ scale: 0.5 })` (half-size, ratio-driven) for a true full-bleed cover via pixi-svelte `fit`, accepting a `cover={{ scale, fit, stretch }}` prop (default = exact edge-to-edge cover). `Game.svelte` derives the `background` scene's `bg` node and passes the canonical readers. **Note:** `apps/lines`' fallback doc has no `background` scene → `<Background>` runs its default full-bleed cover (verified live: background fills the viewport edge-to-edge, was half-size). **Borut mirror PENDING (separate repo):** apply the same `Background.svelte`/`Game.svelte` edits + bump the engine submodule + rebuild engine dist + republish.

### 10.4 Open decisions (need owner input)
- **Viewport reference per layoutType in the editor** — ✅ DECIDED 2026-06-07: use `STANDARD_MAIN_SIZES_MAP[layoutType]` (desktop 1920×1080, tablet 1920×1920, landscape 1920×1080, portrait 1080×1920). Its per-type aspect matches the viewport aspect that selects that layoutType, it contains the main box, and window==STANDARD makes the existing `standardToWorld` fit identity. Owner-verified across layout tabs.
- **Contain vs cover default** — ✅ DECIDED 2026-06-08: default = **cover** (the `backgroundFit` reader falls back to `'cover'` when unset, so existing docs are unchanged + full-bleed). `contain` IS now available as an editable per-node choice in the Properties "Background" section for the rare background that should letterbox/fit-inside instead of crop — the author opts in; nothing defaults to it.

## 11. Addendum — Configurable grid primitive: expose the board's layout params (owner direction 2026-06-08)

**Owner ask:** stop presenting empty "component" shells; instead **open the real game's parts and expose the parameters that drive them** — board position, padding, rows, columns, cell size — as editable fields, with **static placeholder images standing in for the dynamic objects** so the author dials placement, not animation. This is exactly route (B)/§8.7's "board/reels → a configurable grid primitive": presentation-configurable, the coded symbol/spin logic stays code.

**Boundary (reaffirmed):** the editor exposes the *parametric layout* (the numbers in each game's `constants.ts` — `SYMBOL_SIZE`, `BOARD_DIMENSIONS`, `REEL_PADDING` — surfaced via `boardLayout()`/`getSymbolX-Y`). It does NOT open the coded animation. v1 keeps to the params that exist today (square cell + horizontal inset); independent cell-W/H and explicit gaps are deferred.

### 11.1 Where the params live (investigation 2026-06-08)
Board layout is fully derived from a tiny constant set, **per game** (no shared `boardLayout()` package): `apps/lines/src/game/constants.ts` (`SYMBOL_SIZE=120`, `REEL_PADDING=0.53`, `BOARD_DIMENSIONS` inferred from `INITIAL_BOARD` shape → `{x:5,y:3}`), centred by `boardLayout()` in `stateGame.svelte.ts` (`mainLayout().w/h * 0.5`), stepped by `getSymbolX/Y` in `utils/utils.ts` + `utils-slots/createReelForSpinning`. Book of Borut is a byte-identical clone. The engine already DECLARES a `reelGrid` mount slot in `templates/{lines,bookof}.ts` but emits no node — the designated insertion point.

### 11.2 Build order (editor-first, engine contract last — parity-gated)
- **Phase 1 — editor-only, zero game risk. ✅ LANDED 2026-06-08 (code-only, not browser-verified).**
  - `engine-layout` new `ReelGridNode` (`kind:'reelGrid'`, fields `reels`/`rows`/`cellSize`/`reelPadding?` mirroring the constants) added to the `LayoutNode` union (`types.ts`). Additive.
  - The engine **ignores** the kind: `LayoutNodeView`'s `if/else` chain has no `reelGrid` branch → renders nothing, so a doc carrying it is byte-parity in-game (the coded `Board.svelte` still draws symbols). No engine render change in Phase 1.
  - `editorStorage.normalizeDoc` `NODE_KINDS` += `'reelGrid'` (round-trips the node + its params).
  - Seeded into `referenceLayouts/bookof.ts` "Base game" scene with the **real** values (5×3, cell 120, padding 0.53, centred + per-layoutType centre overrides) so the picker opens it non-empty.
  - Editor: `editorCanvas.helpers.nodeBox` returns the `reels×rows×cellSize` footprint (selection/hit lines up); `EditorCanvas.drawNode` draws a static `reels×rows` cell grid placeholder (anchor-centred, drawn in the already-scaled node space); `EditorProperties` gets a "Reel grid" section (number fields: reels, rows, cell size, reel padding); `EditorOutline` glyph `⊞`. `pnpm --filter {engine-layout,launcher-api} build` GREEN.
  - **Caveats:** `reelPadding` is stored for the runtime (Phase 2's `getSymbolX`) but the placeholder draws cells anchor-centred without offsetting by it (avoids cells poking past the selection box; padding≈0.5 ⇒ negligible anyway). The grid only appears once a project loads the bookof reference (existing project docs in R2 won't have it until re-seeded / "Load a game scene"). The game's own `Book of Borut/src/game/defaultLayout.ts` is NOT updated yet (deferred to Phase 2 with engine consumption).
  - **Owner verify:** open `/editor` on the Borut project, Load the bookof game scene, select **Reel grid** in the Base game scene — confirm the grid draws over the board, is movable/scalable, and the Properties numbers change its shape.
- **Phase 2 — engine consumption, LAYOUT-ONLY (owner-chosen 2026-06-08). ✅ LANDED for engine + `apps/lines` (on `main` `9a37cf0`) + Borut mirror committed (code-only, not browser-verified).** **Scope decision:** the board is built at module load (`_.range(BOARD_DIMENSIONS.x)`, fixed `INITIAL_BOARD`) and **the RGS book delivers a fixed N×M result**, so `reels`/`rows` are RGS/data-coupled — driving them live is a math change, NOT presentation. Phase 2 therefore drives only **position + cell size + reel padding** (pure layout); `reels`/`rows` stay editor-descriptive with a save-time mismatch **warning**.
  - **Mechanism (board-container transform, not per-symbol math):** new shared readers in `engine-layout/reelGrid.ts` (`findReelGridNode`, `resolveReelGridFromNode`, `resolveReelGridLayout`) + `ReelGridNode` exported. The game bridges the loaded doc's node into `boardLayout()`: **position** = node's resolved (per-`layoutType`) x/y else `mainLayout()` centre; **scale** = `cellSize / SYMBOL_SIZE` (applied to `BoardContainer` + the coded `BoardFrame` glow so coded board pieces stay coherent); **reelPadding** = `(reelPadding − REEL_PADDING) · SYMBOL_SIZE · scale` x-offset. No per-symbol math / `getSymbolX-Y` / `createReelForSpinning` change. `Game.svelte` calls `setBoardOverride(findReelGridNode(doc) ?? null)` after the doc loads. **Parity:** no `reelGrid` node ⇒ `scale: 1`, centre position, zero offset ⇒ byte-identical to today (`setBoardOverride(null)`; `lines`' `defaultLayout` has no node).
  - **Warning:** `GameTemplate.board {reels, rows}` (lines/bookOf = 5×3) is the truth; `reelGridWarnings(doc, template)` flags a diverging node, folded into the editor's existing non-blocking `warnings` channel (`editor/+page.server.ts`, load + save). `pnpm --filter {engine-layout,launcher-api} build` + `apps/lines` `vite build` GREEN.
  - **Borut mirror ✅ PUSHED (Book of Borut `e53012b` on origin/main, 2026-06-08, build-green; republish pending).** Engine submodule bumped `1e043dc → 9a37cf0`; the same 4 game-file edits mirrored. `pnpm build:engine` + `vite build` GREEN. Parity-safe (Borut's live doc has no `reelGrid` node yet → identical to today). **Only remaining owner step:** republish (Build&Deploy with the Portal project key) so editor board-edits reach the live game.
  - **Convert affordance (closes the "existing doc has no `reelGrid` node" gap, 2026-06-08).** An existing project doc holds the OLD `container` mount-anchor for the `reelGrid` slot (from the `1d443e5` mount-anchor feature), not a parametric node — so neither the Phase-1 placeholder nor the Phase-2 board-read engages. Added a **"⊞ Convert to parametric grid"** Properties button (`EditorProperties` `onConvertToReelGrid`; handler in editor `+page.svelte`) shown for a selected `container` filling the `reelGrid` slot (`slotId==='reelGrid'` or `bind.component==='ReelGrid'`). It replaces the node in-place (same id) with a `reelGrid` node seeded from `GameTemplate.board` (`reels`/`rows`/`cellSize`, now `5×3 @ 120` for lines/bookOf) at the board's **natural centre per layoutType** (NOT the anchor's offset rect) with `anchor {0.5,0.5}` — so the live board stays put (centre, `scale = cellSize/SYMBOL_SIZE = 1`, zero offset = parity); drops the no-op `bind`/`width`/`height`/`children`/`locked`. `bind:'ReelGrid'` was already unregistered in Borut (board renders from coded `Board.svelte`), so dropping it is a no-op. `pnpm --filter {engine-layout,launcher-api} build` GREEN.
- **Phase 3 — later.** `reels`/`rows` runtime-driving as a separate RGS/math-coupled effort (matching `INITIAL_BOARD` + the mock/real book shape); win-line geometry (next primitive); per-layoutType grid overrides; flip the `reelGrid` template slot `required` and retire the coded board mount.

### 11.3 Addendum — cell spacing + non-square cells (owner direction 2026-06-12)
**Owner ask:** more grid-placement control — explicit **horizontal + vertical cell spacing (gaps)**, **non-square cell width/height**, a **row padding** (vertical analog of `reelPadding`), and the spin-feel params surfaced too. Owner chose the largest scope (real in-game, not preview-only). This UN-defers the §11 line-516 boundary ("independent cell-W/H and explicit gaps are deferred").

**Why it's a real engine change (not the Phase-2 mechanism):** Phase-2 drives the board via a UNIFORM board-container transform (`cellSize/SYMBOL_SIZE` scale). Gaps + non-square can't be a uniform transform — they need per-symbol math: `getSymbolX` (`apps/*/game/utils.ts`), the vertical pitch `symbolHeight` baked into `utils-slots/createReelForSpinning` (used for BOTH row pitch AND every spin distance), plus `SymbolWrap`/`BoardMask` framing.

- **Phase 1 (gaps/non-square) — editor-only, additive, parity-safe in-game. ✅ LANDED 2026-06-12 (code-only, not browser-verified).**
  - `ReelGridNode` += optional `cellWidth`/`cellHeight` (non-square; absent ⇒ falls back to `cellSize`), `gapX`/`gapY` (inter-cell spacing; absent ⇒ 0 = flush), `rowPadding` (vertical inset; absent ⇒ 0.5). All optional ⇒ absent = today's square/flush grid, byte-parity. `normalizeNode` passes new fields through (no storage change).
  - Editor: Properties "Reel grid" section gained cell width/height, gap X/Y, row padding fields (blank = square/0/0.5) + the stale "editor preview today" copy fixed (position/cellSize/reelPadding ARE live; reels/rows descriptive; new fields render in preview + feed the engine's next pass). `EditorCanvas.drawReelGrid` + `editorCanvas.helpers.nodeBox` use `pitchX=cellW+gapX`/`pitchY=cellH+gapY` footprint = `reels·cellW+(reels−1)·gapX` (tight, no trailing gap) so selection matches the draw. `pnpm --filter {engine-layout,launcher-api} build` GREEN.
  - **Symbol marker (owner ask 2026-06-12):** `drawReelGrid` also draws a warm inner SYMBOL square per cell, seated at the padding offset (`cellW·reelPadding`, `cellH·rowPadding` from each cell's top-left = the engine's `getSymbolX/Y` seat), side `min(cellW,cellH)`. So the author SEES padding (off-centre when ≠0.5), spacing (gaps between cell boxes), and the symbol's position inside the grid.
  - **Owner decision 2026-06-12: non-square keeps STAKE symbol sizing** (no stretch/fit). So `cellWidth/cellHeight` drive the CELL box + per-axis PITCH (row/column spacing), NOT the symbol draw size — symbols stay Stake-sized (`SYMBOL_SIZE·sizeRatios`), centred in the cell via padding. This simplifies Phase 2: no per-symbol sprite-aspect change, only positions/pitch.
  - The engine resolver (`resolveReelGridFromNode`) still reads only `cellSize`/`reelPadding` ⇒ live game unchanged for the NEW fields until Phase 2.
- **Phase 2 (engine consumption) — ✅ LANDED for engine + `apps/lines` 2026-06-12 (parity browser-verified; Borut mirror pending).**
  - **Resolver:** `resolveReelGridFromNode` → `ReelGridLayout` extended with `cellWidth`/`cellHeight`/`gapX`/`gapY` (all fold the transform scale, default to `cellSize`/0) + `rowPadding` (default 0.5).
  - **Shared reel (`utils-slots`):** `symbolHeight` widened to `number | (() => number)`, resolved lazily via `getSymbolHeight()` in BOTH `createReelForSpinning` + `createReelForCascading` (a plain number is byte-identical). In the spinning reel the resting Y `defaultY` became `homeY()` (tracks the reactive pitch) and a SECOND, gated `$effect` re-homes a settled reel when the pitch changes (`isReactiveHeight && motion==='stopped' && reelY.current!==homeY()`) — inert for number inputs, so all other games are untouched. The original `readyToSpin` effect is unchanged.
  - **Decomposition (keeps parity):** per-index SLOPE (gaps + non-square pitch) → `getSymbolX` (now a reactive export of `stateGame`, honours `columnExtraLocal`) + the reel's `symbolHeight` getter (`rowPitchLocal`); uniform TRANSLATE (reel/row padding) → board-container x/y offset in `boardLayout()`. `boardGeometry()` (lines `stateGame`) resolves both locals in board-local space; `{0, SYMBOL_SIZE}` when no node ⇒ byte-parity. `getSymbolX`/`getSymbolY` removed from `apps/lines/game/utils.ts` (the reactive one lives in `stateGame`; `getSymbolY` was dead).
  - **Symbol sizing unchanged (owner decision):** art stays Stake-sized (uniform `cellSize/SYMBOL_SIZE` zoom); gaps/non-square only move the lattice, so square art never distorts in a non-square cell.
  - **Verification:** `pnpm --filter {engine-layout,utils-slots(via lines),launcher-api,lines} build` GREEN. Ran `apps/lines` (play4fun mock): clean boot, zero runtime errors, and the Pixi scene-graph showed the board at **exactly** 120 px column + row pitch with the first column at `120·REEL_PADDING` — byte-identical lattice to baseline (parity). Gap on-screen pitch = `cellW+gapX` / `cellH+gapY` (reduces to parity at defaults), already visible in the Phase-1 editor preview. A live in-game gap screenshot wasn't captured (WebGPU `preview_screenshot` times out; the RGS reload flow is fragile for runtime injection) — best confirmed by the owner via the editor pipeline (a doc carrying a `reelGrid` node with gaps + the `?k=` token).
  - **Borut mirror — ✅ DONE + PUSHED (Book of Borut `913f425`, 2026-06-12).** Engine submodule bumped `652a4fb → 3709aa7` (carries the `engine-layout` resolver + `utils-slots` `symbolHeight` getter); the `apps/lines` game-file edits mirrored character-identically into Borut's own `stateGame.svelte.ts` (`getSymbolX`/`boardGeometry`/`boardLayout` rowPadding), `ReelSymbol.svelte`, `utils.ts`. `pnpm build:engine` + `vite build` GREEN. Committed surgically (engine pointer + 3 src files; the owner's concurrent `static/assets`/`package.json`/`baked-editor-bundle` left untouched). Parity-safe (Borut's live doc has no `reelGrid` node ⇒ byte-identical board). **Only remaining owner step:** republish (Build & Deploy w/ Portal key) so editor board-edits reach the live game.
- **Phase 3 (spin-feel params) — ✅ LANDED for engine + `apps/lines` + Borut 2026-06-12 (runtime-verified).** `ReelGridNode.spin?: ReelSpinTuning` (`normal`/`fast` profiles, each a `ReelSpinProfile` = partial override of the 8 `SpinningReelSpinOptions` fields); `resolveReelSpinProfile(node, which)` returns only the authored finite fields. The game's `spinOptions` getter merges the profile over the coded `SPIN_OPTIONS_DEFAULT`/`FAST` (`{ ...base, ...override }`); no node / no `spin` ⇒ coded constants (parity). Editor: a collapsible **"Spin tuning (advanced)"** section under Reel grid with Normal + Turbo sub-groups (8 fields each, blank = game default), authored to `node.spin`. **Motion blur intentionally NOT exposed** — `MOTION_BLUR_VELOCITY` has no consumer in the game (only its constant exists), so a control would be a no-op. **Runtime-verified** (`apps/lines`): base = coded `(spinSpeed 3, delay 145)`; an injected `{normal:{reelSpinSpeed:99,reelSpinDelay:0}}` → getter returns `99`/`0` with other fields unchanged. Engine `1550099`; Borut mirror `ade1d24` (submodule `3709aa7→1550099` + the `spinOptions` getter edit). Builds GREEN: engine-layout, lines, launcher, Borut. Owner step: Borut republish.

### 11.4 Addendum — gap-aware board centring fix (2026-06-12)
**Bug:** with the Phase-2 gap/non-square consumption landed, any non-zero `gapX`/`gapY` (or `cellWidth/cellHeight ≠ cellSize`) pushed the live board off-centre and made it asymmetric. The editor's `drawReelGrid` centres the FULL footprint (`reels·cellW+(reels−1)·gapX`) symmetrically on the node origin, but in-game `getSymbolX` grows the gap **cumulatively rightward** (`+ reelIndex·columnExtraLocal`) and the reel pitch grows it **cumulatively downward** (`symbolY = (symbolIndex−0.5)·rowPitchLocal`), while `boardLayout()`'s pivot stayed at the flush, gap-less centre (`BOARD_SIZES/2`). That half was never updated when the gap term was added, so the symbol cluster drifted off the container origin — lopsided on its own and disagreeing with the editor.

**Fix (`apps/lines/game/stateGame.svelte.ts`, `boardLayout()`):** recentre the pivot on the gap-extended cluster so its true centre sits under the container origin (matching the editor's symmetric layout):
- `pivot.x = BOARD_SIZES.width/2 + ((BOARD_DIMENSIONS.x − 1)/2)·columnExtraLocal`
- `pivot.y = BOARD_SIZES.height/2 + (BOARD_DIMENSIONS.y/2)·(rowPitchLocal − SYMBOL_SIZE)`

where `columnExtraLocal`/`rowPitchLocal` come from `boardGeometry()`.

**Why the Y factor is `rows/2`, not `(rows−1)/2` (it does NOT literally mirror X):** X reel indices run `0..reels−1` (mean index `(reels−1)/2`), so the mean reel's extra is `(reels−1)/2·columnExtraLocal`. But the VISIBLE rows are `symbolIndex 1..rows` with a `−0.5` pitch lead (`symbolY=(symbolIndex−0.5)·pitch` in `createReelForSpinning`), so their mean centre lands at `(rows/2)·pitch` — the index base differs (the board is top-padded by one hidden row), hence `rows/2`.

**Parity preserved (byte-identical, no override):** `boardGeometry()` returns `{columnExtraLocal:0, rowPitchLocal:SYMBOL_SIZE}` with no node, so both added terms evaluate to exactly `0` and the pivot is `{BOARD_SIZES.width/2, BOARD_SIZES.height/2}` — unchanged from today. The existing `REEL_PADDING` (0.53) flush lead is untouched; only the gap-induced correction is added.

**Scope:** only `apps/lines` carries the override pattern in this repo (cluster/ways/scatter/price/number-picker do not). `BoardMask` is a `BoardContainer` child (board-local space) so it now centres on the cluster too — strictly better than today's drift; its flush `SYMBOL_SIZE` height (vs the gap-expanded pitch) is a separate, pre-existing limitation. `Anticipation` is rendered OUTSIDE `BoardContainer` from `boardLayout().x/width` and already ignores the gap + scale (a pre-existing limitation, unchanged by this fix). **Book of Borut's own repo carries a separate copy of `stateGame.svelte.ts` (engine vendored as a submodule, game code outside this working dir) and needs the identical `boardLayout()` pivot edit.**

## 12. Addendum — Universal bound-component params (owner direction 2026-06-08)

**Owner ask:** generalize the bespoke per-component appearance editing (the reelGrid params + the HUD logo/game-name text override) into ONE mechanism that works for ALL coded components — starting with the HUD.

**Finding (what was already universal):** node **placement** (x/y/scale/rotation) and **visibility** (`visible`/`visibleFor`/override) are already editable for every node, HUD anchors included — the HUD's `LayoutEditable` already applies `hudPos().scaleX/scaleY` and gates each element `{#if visible}`. So "scale a button" and "hide an element" needed nothing. The genuinely-new surface was **author-set appearance params** (text font/size/colour/label, button tint).

**Mechanism (✅ LANDED 2026-06-08, parity-gated, code-only/not browser-verified):** a declarative param schema per coded component, auto-rendered by the editor, flowing via the already-universal `bind.props`.
- **Schema (declare):** `EditableParam { key, kind: 'number'|'color'|'boolean'|'string'|'font', label, group?:'style', placeholder? }` + `BOUND_COMPONENT_PARAMS: Record<componentName, EditableParam[]>` + `getEditableParams()` in `engine-layout/boundComponentCatalog.ts`. `group:'style'` nests under `bind.props.style` (a `Partial<TextStyle>`, matching `HudTextOverride`); else top-level `bind.props`. Seeded for HUD: logo/game-name (text + font/size/fill), balance/win/bet labels (font/size/fill — live VALUE stays coded), buttons (tint).
- **Editor (auto-render):** `EditorProperties` replaced the hardcoded "HUD text" section with a schema-driven loop (font dropdown / number / hex colour / checkbox / text), reading+writing `bind.props` generically (`readParam`/`writeParam`/`writeColorParam`). `EditorCanvas.drawHudChip` reflects a button's `tint` + a label's `style.fill`/`fontSize` so edits show in the editor without a republish.
- **Game (consume, the per-component "implement" half):** the HUD `LayoutEditable` path (NOT `LayoutNodeView`) forwards each bar element's `bind.props` to its snippet; `hudPositions` gained `hudStyle`/`hudText`/`hudTint` readers; `UiLabel` merges `style` over caption+value (`{ ...baseStyle, ...props.style }`); `UiButton`/`ButtonBet`/`ButtonBuyBonus` wrap visuals in `<Container tint={tint ?? 0xffffff}>` (PIXI multiply). All in shared `components-ui-pixi`, so Book of Borut inherits it via an engine-submodule bump (no game-file edits). **Parity:** no `bind.props` ⇒ spreads of `undefined` / white tint ⇒ byte-identical render.
- **Shipped:** engine `3ae6d6d` (schema + editor) + `3b20be6` (consumption + chip), Borut submodule → `3b20be6` (`b958ba7`). `apps/lines` + launcher + Borut builds GREEN. **Owner step:** republish Borut to see label/button params in the live game.
- **To extend to ANY component:** add an entry to `BOUND_COMPONENT_PARAMS` + make the component read the prop. Placement/visibility need nothing (already universal).

## 13. Addendum — Parametric components with value binding ("Batch B": one component, instanced by param) (owner direction 2026-06-08)

**Owner ask:** the Component Editor currently shows near-duplicate *custom* shells — a "Balance" component AND a "Win" component — that **should be ONE component instanced with different parameters.** The author defines a component **once, with default params (enough to render/preview it), in the Component Editor**; in the scene Editor each placed instance **overrides** those params. The owner explicitly chose the ambitious reading (2026-06-08): **value-as-param** — the *data source itself* (balance vs win vs bet) is a parameter, so HUD Balance/Win/Bet become **one `HudReadout` component instanced three ways**, not three components. Defaults are stored **per-project**.

### 13.0 The finding that frames this (current state, verified 2026-06-08)
There are **two parallel "component" systems**, drifted apart:
- **System A — `ComponentDef` prefabs** (`/components`, §8). Authored node-trees + the params/instance-override SCHEMA (`ComponentDef.params`, `ComponentInstanceNode.params`). **Build steps 1–5 are DONE:** schema, static expansion (`engine-layout/ComponentInstance.svelte` resolves a def via `registerComponents` + renders `def.root` through `LayoutNodeView`, with a depth/cycle guard), R2 storage (shared+project shadow), editor component mode, reuse. The "Balance"/"Win" rows the owner sees are **empty materialized shells** (from "Edit as component") — dead artifacts, not wired to the HUD; they render nothing (the empty canvas).
- **System B — bound coded components** (`/editor`, §12). The REAL HUD. Already parametric for **appearance**: `boundComponentCatalog.BOUND_COMPONENT_PARAMS` gives `UiLabelBalance/Win/Bet` the SAME `TEXT_STYLE_PARAMS`, flowing via `bind.props`, overridable per-placement. The live VALUE stays **coded identity** (which `bind.component` you mount), per §9.2.

**So the owner's vision = build step 6 of §8.8** (the param/signal/value-binding layer — the explicitly-deferred seam at `ComponentInstance.svelte:53` "STATIC ONLY (v1): params ignored here"). Steps 1–5 are the proven foundation; §12 proves the appearance half on the bound path. Batch B implements value binding + the per-project defaults layer + the Component-Editor surface, and **reconciles A and B** by making the HUD readouts real instanced components.

### 13.1 What "value-as-param" means concretely (the `HudReadout` component)
A per-project `ComponentDef` `HudReadout`:
- `root`: a `text` node (the readout) — so it renders non-empty from defaults.
- `params` (author-set unless noted): `source` (`'balance'|'win'|'bet'` — **the data binding**), `label` (string), style (`fontFamily`/`fontSize`/`fill`), `countUp` (boolean; win counts up); plus an `engineProvided` `value` (number) the engine feeds.
- Placed 3× as `componentInstance`s with `params: { source:'balance', label:'BALANCE' }`, `{ source:'win', … }`, `{ source:'bet', … }`. ONE def, three instances.
- The **number itself stays computed in code** (§9.2 / §8.5 ceiling: "one count-up data binding from an `engineProvided` param"). The editor never authors RGS math — it only declares *which source* + label + style; the game feeds the live value.

### 13.2 Data-model + mechanism additions
1. **Param threading (the `ComponentInstance.svelte:53` seam).** Resolve an instance's effective params = `def.param defaults` ◁ `per-project component defaults` (§13.3) ◁ `node.params` overrides, and provide them to the rendered `def.root` via a Svelte context (mirrors `componentInstanceContext`). A text node inside `root` reads its content/style from the resolved params. Parity: an instance with no params + a def with no defaults ⇒ today's static render, byte-identical.
2. **Engine value-feed registry.** New `registerComponentValues({ HudReadout: (source) => Readable<number> })` (sibling to `registerComponents`/`registerBoundComponents`) — the game maps a `source` param → its live store (balance/win/bet selectors that already drive `UiLabel*`). `<ComponentInstance>` reads the instance's `source`, subscribes, and feeds `value` into the param context. This is the §8.6 "engine owns the wiring; editor declares names" rule, narrowed to a value provider (no signal timeline needed for a plain readout; `countUp` reuses the §8.5 GSAP count-up).
3. **Value binding in the node.** The text node binds `value` (formatted) — the `TweenStep.bindParam { key:'value', countUp }` shape from §8.5, or a lighter direct binding for v1 (a readout isn't a timeline). Decide at B2 (lean: direct bind now; fold into the track interpreter when §8.5 lands fully).

### 13.3 Per-project defaults store (owner-chosen scope)
New R2 key `editor/<projectKey>/component-defaults/<componentId>.json` = `{ params: Record<string, unknown> }` (author-set defaults set in the Component Editor). Precedence at render: **instance override > project default > `def.param.default` > coded fallback.** Loaded alongside components in `+page.server.ts`/the editor load; written by a `POST /api/editor/component-defaults`. (Deliberately a thin sidecar, NOT a new `scope` on `ComponentDef`, so a shared def can carry per-project defaults without forking the def.)

### 13.4 Editor surfaces
- **Component Editor (`/components`) — kills the empty canvas.** When a component is open: render its `def.params` as controls (reuse the §12 auto-render loop / `EditableParam` style) bound to the **per-project defaults**; render `def.root` on the canvas using those defaults so the component shows a real text readout (not blank). For a coded/bound component with no `def.root` (the catalog-only path), fall back to placeholder art via `resolveAnchorPreviewArt` + `getEditableParams`. A `source` picker is just a param control.
- **Scene Editor (`/editor`).** The component picker drops a `HudReadout` instance; Properties overrides `source`/`label`/style per placement (extend the existing `onSetInstanceParam` UI already wired in `EditorProperties`).

### 13.5 Build order (parity-gated; HUD migration LAST)
- **Phase B1 — param threading (pure plumbing, parity).** Thread resolved params (def defaults + instance overrides; project defaults stubbed) through `<ComponentInstance>` into `def.root`; a text node consumes `label`/style. Prove a hand-written `HudReadout` def renders its label/style from instance params. No game/HUD change ⇒ byte-identical where unused.
- **Phase B2 — value feed.** `registerComponentValues` + `source`→store wiring + the `value` binding (+`countUp`). Prove on **one instance in a scratch scene** (a "balance mirror" placed in `/editor`), NOT the live HUD bar yet. Verify the number tracks + win counts up.
- **Phase B3 — per-project defaults + Component-Editor surface (§13.3/§13.4).** Defaults store + API; Component Editor renders params + non-empty preview; retire the dead System-A shells (Batch A's delete already enables cleanup).
- **Phase B4 — HUD migration (the risky bulk, behind a parity gate).** Convert HUD Balance/Win/Bet to instances of the per-project `HudReadout`; keep §12's `bind.props` appearance path until B4 proves out; `apps/lines` stays byte-identical until the flip, Borut mirrors after. **Sub-fork to settle at B4 (not before):** (i) full ComponentDef path — the HUD bar mounts `componentInstance`s (cleanest §8 end-goal, biggest migration of the `LayoutEditable`/`bind` HUD), vs (ii) shortcut — add a `source` param to the existing bound `UiLabel` via `BOUND_COMPONENT_PARAMS`+`bind.props` so one CODED label reads its source (smaller, stays in the proven §12 lane, but the Component Editor doesn't own the node-tree). Recommend building the mechanism on path (i) and deciding the HUD bar's flip at B4 against measured risk.

### 13.6 Open decisions (owner)
- **B4 HUD sub-fork** (i vs ii above) — defer to B4; flagged here so it isn't a surprise.
- **Value binding vs full track interpreter** — B2 leans a direct readout binding; confirm we don't block B2 on the full §8.5 GSAP track UI (a plain readout doesn't need a timeline).
- **Does `HudReadout` subsume the `UiLabel` coded component, or wrap it?** — i.e. is the readout a `text` node the engine draws, or a `mount` of the existing coded `UiLabel` (keeps number-formatting/font-fallback code)? Recommend wrap-via-mount first (least re-implementation), revisit.

> **Status:** B1+B2 SHIPPED (`b26bc3b`), B3 SHIPPED (`ff3fc78`). B4 scoped in §14. Steps 1–5 + §12 are the foundation; Batch B = build step 6 narrowed to the HUD readout, phased B1→B4 with parity gates.

## 14. Addendum — B4: migrate the HUD readouts to one parametric `HudReadout` (owner-chosen HYBRID, 2026-06-08)

**Owner decision (2026-06-08):** the **hybrid** path. NOT a full HUD-through-engine rewrite, NOT the §12 `source`-prop shortcut. `LayoutEditable` keeps its bespoke positioning, but **mounts a `<ComponentInstance>`** of a single per-project `HudReadout` def for the three readouts — so B1/B2/B3 become the HUD's foundation and the owner's model holds (Component Editor owns `HudReadout` + per-project defaults; scene editor overrides per-instance).

### 14.0 The architecture this migrates (mapped 2026-06-08)
The HUD bottom bar is a **bespoke `LayoutEditable` renderer**, fully decoupled from the engine `<LayoutScene>`/`<ComponentInstance>` path (it does NOT expand `componentInstance` nodes, does NOT call `registerComponents`/`registerComponentValues`):
- **Scene:** `referenceLayouts/hud.ts` `hudBarScene()` (~L114–140) defines balance/win/bet as **`bind` nodes** (`bind:{component:'UiLabelBalance', props:{stacked:true}}`).
- **Render:** `components-ui-pixi/LayoutEditable.svelte` (~L114–190) reads each node by id, computes `hudPos()`/`hudStyle()`/`hudText()` (`hudPositions.ts` L80/89/98), spreads the §12 overrides into a coded **snippet**.
- **Snippets:** three SEPARATE coded components `Label{Balance,Win,Bet}.svelte` wrapping base `UiLabel.svelte`, each **hardcoded** to a store. **Values:** `stateBet.balanceAmount` (`state-shared/stateBet.svelte.ts:10`), `stateBet.winBookEventAmount` (:15, tweened/count-up today), `stateBetDerived.betCost()` (:61).
- HUD labels are passed as **snippet props** to `<UI>`→`<LayoutEditable>`; the only `registerBoundComponents` call is `{ Win, Transition }` (`apps/lines/Game.svelte:43`) — labels aren't in it.

### 14.1 Target shape
- **One `HudReadout` ComponentDef** (shared built-in, `_shared/editor-components/hudReadout.json`, so every project's Component Editor lists it; per-project appearance via the B3 defaults sidecar). `root` = a container with a **caption** text node (`paramBindings:{ text:'label' }`) stacked over a **value** text node (`paramBindings:{ text:'value', 'style.fill':'fill', 'style.fontSize':'fontSize', 'style.fontFamily':'fontFamily' }`). Params: `source`(string), `label`(string), `fill`/`fontSize`/`fontFamily`(style), `countUp`(boolean), `value`(number, `engineProvided`).
- **Three HUD nodes become `componentInstance`** of `hudReadout` with `params:{ source:'balance'|'win'|'bet', label, countUp? }` (win `countUp:true`).
- **`registerComponentValues({ balance, win, bet })`** at game boot wraps the live selectors as `ValueSource`s (raw target value — `ParamReadoutText` owns the count-up via `countUp`, replacing `LabelWin`'s tween).

### 14.2 Build order (parity-gated; lines byte-identical until the flip)
- **B4.1 — `HudReadout` def + registration.** Author the def (R2 `_shared` for the editor + a code/seed path so the game `registerComponents({ hudReadout })` at boot). No HUD wiring yet ⇒ parity. Open it in the Component Editor → confirm B3's defaults + non-empty preview render (this is also what makes B3 demonstrable).
- **B4.2 — value sources.** `registerComponentValues({ balance, win, bet })` in `apps/lines/Game.svelte`, wrapping `stateBet.*`/`betCost()` as `ValueSource`s (a small `$state`→subscribe adapter, or reuse the existing tween stores raw). Unused until B4.3 ⇒ parity.
- **B4.3 — `LayoutEditable` mounts `<ComponentInstance>`.** Teach `LayoutEditable` to render a `componentInstance` HUD node by wrapping `<ComponentInstance node={node}>` at the computed `hudPos()` Container (it already provides the pixi/layout context the game uses). Prove on ONE scratch readout node first (not the live three).
- **B4.4 — convert the 3 nodes + parity flip.** A convert/seed turns the balance/win/bet `bind` nodes → `componentInstance(hudReadout,{source,…})` (mirrors the reelGrid "Convert to parametric grid" affordance). **Parity gate:** the readout must render at the same position, font, value, and count-up as the coded label before the coded `Label*` snippets are retired; keep both behind a flag until verified online. `apps/lines` `vite build` + visual parity GREEN.
- **B4.5 — `projectDefaults` into the GAME render path.** Today B3's defaults feed only the editor preview; the game's `resolveComponentParams` 3rd arg is stubbed. Deliver the per-project defaults to the standalone game (it has no launcher session — it fetches via `/api/editor/doc?k=`). **Sub-decision:** (a) the launcher BAKES the project defaults into each served def's `param.default` when the game fetches components (engine stays simple — no runtime projectDefaults), vs (b) a token-gated `/api/editor/component-defaults` fetch the game registers via a new `registerComponentDefaults`. Recommend (a) — fewer moving parts, one delivery channel.
- **B4.6 — Borut mirror + republish.** Once proven on `apps/lines`, mirror to Book of Borut (submodule bump + `build:engine` + republish), per the §11/§12 mirror pattern. Borut stays parity-safe until its HUD nodes are converted.

### 14.3 Open sub-decisions (settle during B4)
- **`HudReadout` = engine-drawn text nodes vs `mount` of coded `UiLabel`?** (§13.6 carried.) The hybrid leans engine-drawn text nodes (so the Component Editor truly owns the tree + B3 preview works). Risk: re-implementing `UiLabel`'s stacked caption/value + bitmap-font fallback as nodes. Validate the font path (the HUD uses a bitmap/web font via the catalog) renders correctly through `LayoutNodeView`/`ParamReadoutText` before retiring `UiLabel`.
- **Where the `HudReadout` def is registered for the game** — bundled in the game vs fetched from R2 at boot. Coupled to B4.5's delivery choice.
- **Caption (`label`) source** — a static text node value vs a `label` param (so the Component Editor can rename it per project). Lean param.

> **Status:** SCOPED (not built). Path = HYBRID. Start B4.1 (def + registration, parity) — it also makes B3 demonstrable. Verify each phase online before the B4.4 flip; mirror to Borut only after `apps/lines` parity holds.

## 15. Addendum — Complete + reconcile the scene set ("editor owns the full screen list") (owner direction 2026-06-08)

**Owner report:** opening Book of Borut in the editor, *not all the game's screens appear* — notably **the startup logo/loading screen is missing** — and the free-spin intro/outro **look like duplicates**.

**Root cause (investigated 2026-06-08): there was no single source of truth for the scene list, and the sources had drifted.** The editor renders `doc.scenes` from the loaded R2 `scenes.json` (the template is only used for slot-warnings, §7.1). FOUR generators each defined a *different* set, and **none defined a logo/loading scene** (it lived only in coded `LoadingScreen.svelte`):
- `templates/{bookof,lines}.ts` — 3 / 2 scenes (schema only).
- `referenceLayouts/bookof.ts` — 7 scenes incl. free-spins, **no HUD, no loading**.
- `referenceLayouts/lines.ts` (`defaultLayout`) — basegame + overlays + HUD, **no loading/freeSpin**.
- `scripts/seed-game-editor.mjs` (what writes the live R2 doc) — 8 scenes incl. HUD, **no loading, no freegame**.

**Phase 1 — LANDED 2026-06-08 (code-only; owner re-seed pending).** Make the **logo/loading screen a first-class scene** and bring every source into agreement (additive, parity-safe):
1. `boundComponentCatalog.ts` — new `LoadingScreen` default (`space:'canvas'`, `placement:'centre'`, preview spine bundle `loader` = the `title_screen` logo) so the editor draws the splash.
2. `templates/{bookof,lines}.ts` — now enumerate the **full screen set** (`loading`, `background`, basegame, [`freegame` bookOf only], `basegameOverlays`, `freeSpinIntro`, `freeSpinCounter`, `freeSpinOutro`). New mount slots are **not `required`** (the game still renders these from coded components → no validation noise). The HUD stays a universal layer appended via `hudScenes()`, not enumerated in the template.
3. `referenceLayouts/bookof.ts` — added the `loading` scene + appended `...hudScenes()` so the reference doc is complete and matches the seed.
4. `referenceLayouts/lines.ts` — added inert `loading` + `freeSpin*` scenes. **Deliberately NO `background` scene** (Game.svelte reads a `background`-scene `bg` node to drive the coded `<Background>` cover; its absence keeps `apps/lines` on its exact-cover default per §10.6 — unchanged).
5. `scripts/seed-game-editor.mjs` — `buildDoc()` now emits the `loading` scene (bind `LoadingScreen`).

**Parity:** every new scene is a `bind` anchor to a coded component NOT in `registerBoundComponents` (e.g. `LoadingScreen`), and the game looks scenes up by id (never iterates all), so the additions are **inert in-game** — the coded screens render exactly as today. Editor-only visibility. `pnpm --filter {engine-layout,launcher-api} build` + `apps/lines` `vite build` GREEN.

**Owner step to see it (TWO ways):**
- **In-app button (no console) — LANDED 2026-06-08.** The editor scene-bar now has an **"＋ Add missing screens (N)"** button next to "Add HUD layer". It diffs the project's doc against the game type's canonical full scene set (`engine-layout` `getFullSceneSet(gameType)` — covers `lines` + `bookOf`) and appends only the scenes the doc LACKS, **by id, non-destructively** (existing scenes + edits untouched); autosave persists it. Mirrors the existing `addHudLayer()` pattern. The button only shows when something's missing, and tooltips the screen names. Safe for `bookOf` because the merge adopts only ABSENT scenes — never `bookofReferenceLayout`'s board-frame nodes (a seeded project already has `basegame`). This is the §7.4 "reset/import to engine defaults" action, scoped to a non-destructive top-up.
- **Re-seed (console, also rewrites the atlas manifest):** `node scripts/seed-game-editor.mjs --client borut --project bookofborut --tp … --page …` with R2 creds — needed only when the board atlas itself changes; for just picking up new screens, the button is enough.

**Deliberately deferred / explained:**
- **`freegame`** — template-declared but given NO placeholder doc content: its only distinct asset is a free-game background not yet available, and a basegame-clone scene would itself read as a fake "duplicate." Add real free-game art when it exists.
- **intro/outro "duplicate"** — NOT a bug: Borut ships no dedicated `fsOutro` spine, so `FreeSpinOutro`'s catalog preview falls back to the `fsIntro` frame (and the game reuses the same frame in-game too). The editor is faithful. A distinct outro needs distinct art or a per-node `preview.art` override.

**Move 2 — LANDED 2026-06-08 (single source via generated JSON + automation).** The seed (`.mjs`) and the TS `referenceLayouts` were two generators of the bookOf scene set that hand-mirrored each other (the seed even inlined a ~180-line copy of `hudScenes()`) — exactly what drifted. Unified per §7.2:
- **Generator** `packages/engine-layout/scripts/gen-scene-sets.mjs` — uses **esbuild** (a build-time devDep, already in-tree via Vite; the monorepo has no runtime TS loader and consumes packages as raw `.ts`) to bundle the **pure-data** reference graph (no `.svelte` in it) and emit `packages/engine-layout/scenes/bookof.json` from `bookofReferenceLayout()`. Deterministic (fixed `updatedAt`). `--check` = structural drift guard.
- **Reconciled the source first:** `bookofReferenceLayout()` had silent drift vs the seed — its `background`/`basegameOverlays`/`freeSpin*` scenes were missing `space:'canvas'`. Fixed (+ slotIds) so the JSON is correct; verified the JSON's non-basegame scenes are **byte-identical** to the seed's prior hand-written ones.
- **Seed now reads the JSON:** `import bookofSceneSet from 'engine-layout/scenes/bookof.json' with { type: 'json' }` (new `./scenes/*` export). It composes the doc from the JSON, overriding ONLY `basegame` (the manifest-dependent region sprites). Deleted the inlined `hudScenes()` + the hand-written scene literals (~260 lines). HUD now comes from the authoritative `referenceLayouts/hud.ts`.
- **Automation (can't be forgotten):** `gen:scenes` runs in `engine-layout`'s `build` (before `svelte-package`), AND the **pre-commit hook** runs `--check` whenever a reference/template/seed/scenes file is staged — a stale JSON blocks the commit with the fix command. Verified: stale → exit 1, fresh → pass.

**Move 3 — make the game RENDER each screen from the doc (route B, §8.7), so the editor *owns* not just *previews* every screen.** The editor showed every screen (Moves 1–2), but `Game.svelte` only read the doc for a few scenes; the logo/loading splash + free-spins were hardcoded, so editing them did nothing in-game. Phases:
- **Phase B — loading/logo splash (LANDED). `apps/lines` + Book of Borut.** `LoadingScreen` can't be a generic `bind` (required `onloaded` callback + it's an either/or with the game), so the coded mount is **wrapped in a doc-driven `<Container>`** built from the `loading` scene node's resolved transform (mirrors `LayoutNodeView`'s canvas-space `screenAnchor·canvasSize + (x,y)` formula). Dragging the logo in the editor now repositions/rescales the whole splash in-game. **Parity-safe:** default node (x:0,y:0,no-scale) → no-op container → byte-identical. No engine change (uses existing `resolveTransform` + pixi-svelte `Container`). `apps/lines` build GREEN (folded into engine commit `5143fd1` by a concurrent session); **Book of Borut** mirrored + built GREEN + pushed (`Book-of-Borut@9e3fa9c`) — republishes via its host. **Verification:** build-green + the game loads the `loading` scene at default (parity); pixel-level A/B was blocked by the WebGPU renderer (preview screenshot can't capture it) — confirm visually in-browser. **Owner step to SEE it on Borut:** in the editor, "Add missing screens" (or re-seed) so the live doc has the `loading` scene → drag the logo → Save → open Borut from the launcher (with `?k=`).
- **Phase A — free-spin screens in `apps/lines` (LANDED).** `apps/lines` now registers `FreeSpinIntro/Counter/Outro` in `registerBoundComponents` and mounts them via `<LayoutScene>` (canvas-space bind anchors) instead of hardcoded tags — matching Borut, so the editor positions them. Parity by construction: the fallback ships those scenes at (0,0) → no-op container → byte-identical; the components keep their book-event self-show, the doc owns only placement. Background stays coded (`<Background cover>`) per §10.6 (no `background` scene in the lines fallback). `apps/lines` build GREEN.
- **Phase D — later (deferred):** per-element transforms within a screen + driving show/hide + count-ups from the doc via the behavior/timeline layer (§8.5). The big "behavior as data" work route B parks.

## 16. Addendum — B6: the HUD button cluster as one parametric `Button` component (owner direction 2026-06-09)

**Owner ask:** continue building the editor components Book of Borut needs, next up the HUD — turn the **button** we already have into an editor-owned component, the same way B5 turned the HUD readout into one. **Owner decisions (2026-06-09):** (i) build it as **separate coded parts** (match the B5 readout split — each part individually movable/restylable/hideable), NOT a single dispatcher that mounts the coded buttons whole; (ii) first pass covers the **Borut HUD cluster only** (spin/bet, menu, buy-bonus, auto-spin, turbo, bet +/−), not the full ~16-variant `Button*` family.

### 16.0 The pattern this extends (B5, on `main` `65a5917`)
B5 (§14.3 "separate coded parts") is the reference: **one `ComponentDef`** (`HUD_READOUT_DEF`, `engine-layout/builtinComponents.ts`) instanced 3 ways by a `source` param; its `root` is a container of three `bind` parts (`HudTicker`/`HudCaption`/`HudValue` in `components-ui-pixi`), each reading the def's params off the **param context** `<ComponentInstance>` provides (`getComponentParams()`), with the live number arriving via `registerComponentValues({ source → store })`. Parts registered in the game's `registerBoundComponents`; the def is a built-in so every Component Editor lists it. The button mirrors this exactly — with an **action** binding where the readout has a **value** binding.

### 16.1 The architecture this migrates (mapped 2026-06-09)
- Base coded button `components-ui-pixi/UiButton.svelte` wraps `components-pixi` `Button` (hover/press/disabled) → a `UiSprite` frame (variant dark/light, active border, disabled-grey) + a localized `Text` icon label + a `tint`.
- ~16 specialized `Button*` each own their **behaviour** (onpress action, disabled logic, hotkeys, providers): heaviest is `ButtonBet` (`ButtonBetProvider` spin/stop state + `OnHotkey` Space); the rest (`ButtonMenu`/`ButtonBuyBonus`/`ButtonAutoSpin`/`ButtonTurbo`/`ButtonIncrease`/`ButtonDecrease`) are plain onpress + a disabled selector.
- In the HUD they're already **`bind` anchors** (`UiButtonMenu`, `UiButtonBet`, …) with a §12 `tint` param (`BOUND_COMPONENT_PARAMS`). Not yet `componentInstance`s — B6 is the rung that makes the cluster one parametric component.

### 16.2 Target shape
- **One `BUTTON_DEF`** (built-in beside `HUD_READOUT_DEF`), instanced per HUD button. **Params:** `action`(string — `spin`|`menu`|`buyBonus`|`autoSpin`|`turbo`|`increase`|`decrease`, the behaviour binding), `icon`/`label`(string), `variant`(string `dark`/`light`), `tint`(color), `fontSize`/`fill`/`fontFamily`(style), `disabled`(boolean, **engineProvided**), `active`(boolean, **engineProvided**, for toggles turbo/auto-spin).
- **`root` parts** (each a `bind` child reading `getComponentParams()`): **`ButtonFrame`** = the `UiSprite` tile (variant bg, active border, disabled-grey, tint) **and** the hit area (`eventMode="static"`, `onpointerup` → the action handler, disabled cursor) — the `HudValue`-owns-the-bet-tap analogue; **`ButtonLabel`** = the localized `Text` label (`i18nDerived[icon]()` + size/fill/font) — the `HudCaption` analogue. (A `ButtonIcon` sprite-glyph part is deferred until a Borut button needs art instead of text.)
- **New `registerComponentActions({ spin, menu, buyBonus, … })`** (sibling to `registerComponentValues`): each entry `{ onpress: () => void, disabled: ValueSource<boolean>, active?: ValueSource<boolean> }`. `<ComponentInstance>` reads `action`, subscribes `disabled`/`active` into the param context (same reactive-getter trick as `value`) and exposes `onpress` for `ButtonFrame`. Engine owns the wiring; the editor only declares the action name. **Heaviest entry = `spin`** — its `disabled`/`onpress`/key come from `ButtonBetProvider`'s spin/stop state surfaced as stores (the one real re-implementation; isolated to its own phase).

### 16.3 Build order (parity-gated; `apps/lines` byte-identical until the flip)
- **B6.1 — def + parts + registration (parity).** Author `BUTTON_DEF`; add `ButtonFrame`/`ButtonLabel` to `components-ui-pixi`; register them in `registerBoundComponents`. Built-in so the Component Editor lists it + previews non-empty. No HUD wiring ⇒ parity.
- **B6.2 — action feed.** `registerComponentActions` + `ComponentInstance.svelte` subscribes disabled/active + exposes onpress; wire the 7 Borut actions in `apps/lines/Game.svelte` (spin via the provider's surfaced state, the rest via existing selectors). Unused until B6.4 ⇒ parity.
- **B6.3 — `LayoutEditable` mounts `<ComponentInstance>`** for a button node — proved on ONE scratch button first (not the live cluster).
- **B6.4 — convert the cluster + parity flip.** A convert/seed turns each `UiButton*` `bind` node → `componentInstance(button,{action,icon})` (mirrors the reelGrid "Convert to parametric grid" affordance). **Parity gate:** same position, frame, label, **press, disabled, hotkey, active** as the coded button before the coded `Button*` are retired; keep both behind a flag until verified online. `apps/lines` `vite build` + visual+behaviour parity GREEN.
- **B6.5 — Borut mirror + republish** once `apps/lines` parity holds (submodule bump + `build:engine` + republish, per the §11/§12 mirror pattern).

### 16.4 Open sub-decisions (settle during B6)
- **`spin` action surfacing** — expose `ButtonBetProvider`'s state as stores for the action registry vs. let `ButtonFrame` keep the provider/`OnHotkey` internally for the spin case only. Lean: surface as stores so all 7 actions are uniform; fall back to internal-provider if the state proves awkward to lift.
- **`active` for toggles** — confirm turbo/auto-spin need the engineProvided `active` in v1 or can defer (they render an active border).
- **Font path** — same caveat as §14.3: validate the label renders correctly through the bound part (bitmap/web font via the catalog) before retiring `UiButton`'s coded `Text`.

> **Status:** SCOPED + Phase B6.1 STARTED (def + parts + registration, parity), branch `feat/editor-button-component`. Decisions locked: split coded parts; Borut HUD cluster only. Verify each phase online before the B6.4 flip; mirror to Borut only after `apps/lines` parity holds.

## 17. Addendum — Component behavior layer: signal-triggered timelines (the animated overlays) (owner direction 2026-06-09)

**Owner ask:** make the animated overlays (`Win`, `Transition`, FreeSpin `intro`/`outro`) editor-owned, not just placement-editable. This is the §8.8-step-6 / §8.5 "behavior" layer — deliberately deferred until the static/composition tier was solid. It is now scoped.

### 17.0 The reframe that sizes this (timeline ≠ node graph)
The instinct that "behavior needs its own visual editor" is correct — but the **right surface is a timeline/track editor, NOT a node/flow graph.** Two different shapes:
- **Timeline/track editor** (After Effects / GSAP timeline / Unity Animation window) authors *animation* — tweens on node props over time. **This is what these overlays need.**
- **Node/flow graph** (Unreal Blueprint / Rive state machine) authors *logic/flow* — branching, conditions, data routing. This is **route A (§8.7), and it stays DEFERRED** (owner re-confirmed 2026-06-09). The overlays do not need it.

Why the overlays are animation, not logic:
- **Transition** = enter+exit tween (wipe/fade), maybe a spine play.
- **FS intro/outro** = on-enter: play a spine + reveal text.
- **Win** = on a `win` signal: play the `celebrate` spine + count a number up to `winAmount`.

Each is "*when signal X fires, run this timeline.*" The *when* (flow) is a **signal** wired to a book event **in code** (`registerComponentSignals`, §8.6) — a one-line map, not an authored graph. Branching that would tempt a node graph (small win vs big win) is just **two signals** (`win`/`bigWin`) wired in code. So neither the animation nor the flow needs route A.

### 17.1 Altitude — Tier 0 → Tier 1, shared interpreter (owner-chosen 2026-06-09)
The §8.5 schema (`BehaviorTrack`/`TweenStep`) **already exists** — scoping is about *how much editor surface* sits on top. Build the engine interpreter ONCE (shared by all tiers), then stage the UI:
- **Tier 0 — signal presets (no canvas).** A node's Properties gains "on `<signal ▾>` → `<preset ▾>` over `<duration>`" with a fixed preset menu (fade / slide / pop / spine-play / count-up). Covers most of `Transition` + FS-intro with zero timeline UI. Ships first; proves signals→animation end-to-end on `Transition` (the §8.8-step-7 first migration).
- **Tier 1 — the §8.5 timeline editor.** Time axis, one row per child node, draggable keyframe tweens, a per-signal track list, GSAP under the hood. Covers all overlays at the v1 ceiling. **Additive on top of Tier 0** — same interpreter + schema, no rewrite.
- **Tier 2 — node/flow graph (route A).** DEFERRED. Not on the path for these overlays.

### 17.2 The model (already designed — §8.5/§8.6 recap)
- `BehaviorTrack { signal, steps: TweenStep[] }`; `TweenStep` = a prop tween (`x/y/alpha/scaleX/scaleY/rotation/tint`) **or** `spine` playback **or** one `bindParam` (count-up text from an `engineProvided` param). Stored on the `ComponentDef` (round-trips `normalizeDoc`).
- **Editor authors** the timeline + **declares** signal names + `engineProvided` param names. **Engine implements** the triggers (book event → signal) + supplies the param values. Neither side owns both halves (`declare ≠ implement`).

### 17.3 What it touches (cost made visible)
1. **Engine interpreter** (`engine-layout`) — `<ComponentInstance>` subscribes to its `signals` on `utils-event-emitter`; on a signal, runs the matching `BehaviorTrack` via GSAP, reading `engineProvided` params from the firing payload. *The one genuinely new engine piece; shared by Tier 0 + Tier 1.*
2. **Signal registry** — `registerComponentSignals({ … })` in the game maps book events → signal names (mirrors `registerBoundComponents`/`registerComponentValues`). ~1 line per signal.
3. **Editor surface** — Tier 0 = Properties dropdowns (preset → a generated `BehaviorTrack`); Tier 1 = the timeline panel (authors `TweenStep`s directly).
4. **Migration** — `Transition` first (simplest, the proof), then `Win`, then FS `intro`/`outro`. Each parity-gated: keep the coded `mount` behind a flag until the authored version matches on screen, then retire it (§8.7 "defang, don't gut").

### 17.4 Build order (parity-gated; nothing renders differently until a component opts in)
1. **Interpreter + schema wiring** — `BehaviorTrack` execution in `<ComponentInstance>` (GSAP); no component references a track yet ⇒ parity.
2. **Signal registry** — `registerComponentSignals`; wire the core signals (`enter`/`exit`/`idle`/`win`/`bigWin`) to Borut's book events. Unused until a track exists ⇒ parity.
3. **Tier 0 Properties UI** — preset dropdowns that emit a `BehaviorTrack`; author a `Transition` component as the first real one.
4. **Migrate `Transition`** — convert the coded `mount` → authored component behind a flag; verify on screen; flip; retire the coded path.
5. **Migrate `Win`** (signal `win` + count-up `bindParam`) and **FS `intro`/`outro`** (enter signal + spine).
6. **Tier 1 timeline editor** — the track/keyframe panel on top of the same interpreter; only once Tier 0 has proven the loop online.
7. **Borut mirror + republish** per the §11/§12 pattern, after `apps/lines` parity holds.

### 17.5 The v1 ceiling (the scope-creep line — hold it)
Tweens + spine playback + **one** count-up binding per the §8.5 ceiling. Anything needing branching, RGS math, or stateful logic stays a coded `mount` for v1. This is the line that keeps the feature a *timeline*, not a slide into building a scripting language. Crossing it = route A, which is deferred.

### 17.6 Open sub-decisions (settle when build starts)
- **Preset catalog (Tier 0)** — the exact fixed list (fade/slide/pop/spine-play/count-up) + their default durations/eases. Curated + code-owned (like `ENGINE_SIGNAL_CATALOG`).
- **Signal vocabulary** — confirm the core set (`enter`/`exit`/`idle`/`win`/`bigWin`) + which Borut book events map to each. Per-game custom signals are code-wired for v1 (editor only declares names).
- **Component versioning** — a behavior edit bumps the `ComponentDef` version; instances stay pinned until "update to latest" (§8.9). Confirm where that action lives.
- **Where the timeline panel lives (Tier 1)** — a new Component-Editor panel vs. an expandable Properties section. Decide when Tier 1 starts.

> **Status:** SCOPED (owner-chosen 2026-06-09: Tier 0 → Tier 1, shared interpreter; route A deferred). NOT started — parked behind the static-mount work (B6 + the placement-only sweep). The §8.5 schema already exists; remaining = engine interpreter + signal registry + the staged editor surface + per-overlay migration. Pick up at 17.4 step 1.

## 18. Addendum — One reusable Text Box + universal text localization (owner direction 2026-06-10)

**Owner ask:** the HUD corner game-name/logo being coded `bind` anchors (not text nodes) surfaced the
deeper want: ONE reusable text component for *every* text field in a game, with dynamic values fed by
the engine through params — and **all text localizable**, end to end (Localization tool → shipped game).
This generalizes §13/§14's value-as-param architecture to text, and removes the limitation that forced
B5's "separate coded parts" choice (a plain text node previously couldn't be localized or dynamic).

### 18.1 What shipped (CODE BUILT 2026-06-10)
1. **Engine text-localization resolver** (`engine-layout/registerTextResolver.ts`): the game registers
   ONE resolver at boot; `LayoutNodeView` runs every text node's FINAL string (static `node.text` or a
   string param bind) through it. Known catalog key → translation for the active language; unknown
   string / no resolver → literal (parity). This implements the long-documented aspiration on
   `TextNode.text` ("may be a localization key").
2. **String value sources**: `ValueSource` widened to `number | string`; `<ComponentInstance>`'s live
   feed carries either. Numbers keep the formatted/count-up readout path; strings render as text.
3. **`TEXT_BOX_DEF` built-in** (`textBox`): one def, a single text node with `paramBindings`
   (`text`/`fontFamily`/`fontSize`/`fill` → params). `text` param = literal OR localization key.
   Optional `source` param (options = `TEXT_SOURCE_KEYS`, the full `ENGINE_PARAM_CATALOG`): when a
   registered feed exists, `<ComponentInstance>` OVERRIDES the `text` param with the live value (the
   §16.4 `label`-override precedent, applied only to defs that declare a `text` param — HudReadout/
   Button untouched). Static caption, localized label, and live readout are all ONE component.
4. **Localization delivery (tool → game)**: new token-gated `GET /api/localization/strings?project&k`
   exports the Localization tool's doc as per-locale message maps — source language fully, target
   languages REVIEWED-only. `bake-editor-doc.mjs` embeds it as `bundle.localization`; the game merges
   it into its Lingui catalog LAST (project strings override code catalogs) via
   `bakedLocalizationMessagesMap()` in `editor-scenes.ts`, and registers the resolver with
   `registerEditorTextLocalization(messagesMap)` at boot (`Game.svelte`).

### 18.2 Verified
`engine-layout` + `launcher-api` + `apps/lines` builds GREEN; `apps/lines` dev parity verified in the
browser (HUD readouts, game-name/clock, board, i18n test overlay — no console errors).

### 18.3 Next steps (not started)
- **Borut mirror** (editor-scenes/messagesMap/Game.svelte + submodule bump) — same files as §14 B4.6.
- **Migrate the HUD corners**: re-seed `hudCornersScene()` game-name as a `textBox` instance with a
  `gameName`/`clock` source (needs the game to register those string sources) — retiring the
  `HudGameName` bind for doc-driven games; `HudLogo` becomes a sprite slot or image-param textBox.
- **Editor key-picker**: surface the project's Localization-tool keys as suggestions on text params
  (today the author types the key; unknown keys render literal).
- Editor canvas preview stays source-language (authoring shows keys/source text — by design for now).

### 18.4 Default hit surface for art-only components (owner bug 2026-06-10)
A custom button authored in the Component Editor (background sprite + text — no coded `bind` part)
published as a STATIC IMAGE: all button interactivity (hit area, cursor, `onpointerup`) lived in the
coded `ButtonFrame` part, and plain sprite/text nodes carry no event handling. Fix in
`<ComponentInstance>`: when the instance resolved an ACTION feed and the def's root contains NO
`bind` node, the engine provides the default hit surface — the expansion wraps in an interactive
`Container` (`eventMode static`, pointer/not-allowed cursor, press → `onpress` unless disabled), so
the whole rendered art hit-tests. A def containing ANY bind part keeps the coded part as the sole
press owner (no wrapper → no double-fire → parity for the built-in `button`).

### 18.5 Free author art on HUD scenes (owner bug 2026-06-10)
A plain sprite/text/container dropped on a HUD scene (`hudBar`/`hudCorners`) in the Scene Editor
showed in the editor but NOT in the game. Cause: HUD scenes don't render through the generic
`<LayoutScene>` node-walker — they're consumed by the bespoke `LayoutEditable` (`components-ui-pixi`),
which only (a) positions the coded HUD snippets by KNOWN id (`hud-balance`, `hud-btn-*`, …) and
(b) renders author-placed `componentInstance` nodes. Any other node was silently dropped. Fix:
`LayoutEditable` now also renders every "free" node (not a reserved coded id, not a componentInstance)
through the engine `<LayoutNodeView>` in the scene's own space — `hudBar` standard (inside the bottom-bar
MainContainer), `hudCorners` canvas — BEFORE the coded snippets so a bar-background sits behind them
(author `zIndex` still wins). The live seed carries no such nodes → byte-identical parity until art is
added. So: NO special component needed — drop any sprite/text on a HUD screen and it ships.

### 18.6 Ghost coded HUD buttons when replaced by from-scratch instances (owner bug 2026-06-10)
After authoring custom button COMPONENTS onto the HUD bar, the old coded buttons (spin/turbo/±) still
rendered as duplicates. Cause: `LayoutEditable`'s double-render guard `mounted(id)` only suppressed a
coded snippet when a `componentInstance` had the snippet's RESERVED id (`hud-btn-bet`, …). A button the
author places from scratch (or via the picker) gets a RANDOM id, so the guard missed it and the coded
snippet kept drawing at its fallback position — a ghost of the old graphic. Fix: also suppress a coded
element when a placed instance COVERS its action (buttons: `hud-btn-bet`→`spin`, `hud-btn-turbo`→`turbo`,
…) or its value source (readouts: `hud-balance`→`balance`, …), read from the instance's own param,
regardless of id. Stock seeds are unaffected (their instances already carry the reserved ids → same
result). So an author can drop their own button component over a coded HUD slot and the coded one steps
aside once the instance's `action` matches.

### 18.7 Editor↔game HUD text fidelity (font + alignment) (owner bug 2026-06-10)
The HUD readout caption/value looked different in the editor vs the game. Two causes, both editor-side
(the game render is the reference): (1) FONT — the games load proxima-nova via a Typekit kit
(`apps/lines/app.html`); the launcher didn't, so the editor fell back to sans-serif. Added the same
Typekit `<link>` to `apps/launcher-api/src/app.html` (+ an `onMount document.fonts.ready` redraw in
`EditorCanvas` so the first paint isn't the fallback). (2) ALIGNMENT/SIZE — `EditorCanvas.drawHudChip`
drew the decomposed `style:'text'` chip (the coded `HudCaption`/`HudValue` parts) with a hardcoded
`600 30px sans-serif`, vertically CENTRED; the coded parts render `<Text anchor={{x:0.5,y:0}}>` in the
resolved `fontFamily` (proxima-nova) at the resolved `fontSize` (UiLabel base 45), normal weight,
TOP-anchored at the node origin. Fixed the chip to use the resolved family/size + top baseline at the
origin (and threaded `fontFamily` through the param-style). Now editor ≈ game. NOTE: the coded HUD parts
are still an editor APPROXIMATION (the editor can't run them); for pixel-exact WYSIWYG, author the
caption/value as `textBox`/text nodes (§18), which render through the identical engine `<Text>` path in
both. Launcher-only change — no game republish.
