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
2. **Phase 1 — editor fidelity (read-only). ✅ LANDED 2026-06-06 (code-only, not browser-verified).** **WebGL/PIXI overlay (decided, §9.5).** `EditorTextLayer.svelte` — a transparent raw-PIXI `Application` over the 2D canvas (mirrors `EditorSpineLayer`), rendering each TOP-LEVEL text node as `PIXI.BitmapText` (catalog `kind:'bitmap'`) or `PIXI.Text` (web/system), positioned via the parent's `nodeTransform` → `world*zoom+pan` (one coord source, passed as `worldTransformOf`). `fonts.client.ts` loads bitmap fonts through PIXI `Assets.load` and web fonts via `FontFace`; the bitmap descriptor's relative `<page file>` refs are rewritten to absolute editor-gated URLs by `/api/editor/asset?font=1` (the relativity gotcha). Font loads fold into the existing "Loading assets…" overlay (`fontStarted/fontSettled` → `loadPending`); the overlay reports the node ids it owns (`onReadyIdsChange`) so the 2D canvas skips their `fillText` (no double-draw); "↻ Reload art" drops the catalog + bumps `fontReload`. `pixi.js@8.8.1` added as a launcher dep. `pnpm --filter launcher-api build` GREEN. **Caveats:** top-level text only (nested-in-container falls back to 2D `fillText`); the overlay matches the GAME's pixi-text anchor, NOT the old `fillText` alphabetic baseline (intended); "Reload art" re-fetches the catalog but the per-font client caches don't reset, so a changed font PAGE needs a full reload. **Owner verify:** seed a project's `fonts.json` (`scripts/r2-sync-fonts.mjs`) then check `app.invisiblewall.org/editor`. Effort ~M–L, risk med (overlay sync + parity). *After this: you see the real fonts.*
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
  - **Borut mirror ✅ COMMITTED (Book of Borut `e53012b`, 2026-06-08, build-green; not pushed/republished).** Engine submodule bumped `1e043dc → 9a37cf0`; the same 4 game-file edits mirrored. `pnpm build:engine` + `vite build` GREEN. Parity-safe (Borut's live doc has no `reelGrid` node yet → identical to today). **Owner step:** push the Borut repo + republish (Build&Deploy with the Portal project key) so editor board-edits reach the live game.
- **Phase 3 — later.** `reels`/`rows` runtime-driving as a separate RGS/math-coupled effort (matching `INITIAL_BOARD` + the mock/real book shape); win-line geometry (next primitive); per-layoutType grid overrides; flip the `reelGrid` template slot `required` and retire the coded board mount.
