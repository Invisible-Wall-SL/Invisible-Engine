/**
 * LayoutDoc — the document format the Invisible Editor produces and games consume.
 * Coords are authored in the base (`desktop`) main-layout space; per-layoutType
 * sparse overrides reposition/rescale nodes for other form factors. Same mental
 * model as utils-layout's `mainSizesMap` (uniform scale per layoutType).
 */

export type LayoutType = 'desktop' | 'tablet' | 'landscape' | 'portrait';

export interface Point2D {
	x: number;
	y: number;
}

/**
 * Sparse override applied on top of base transform for a specific layoutType.
 * Any omitted field falls through to the base. `visible: false` hides the node
 * for that layoutType (preferred over editing the base).
 */
export interface NodeOverride {
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	anchor?: Point2D;
	scale?: Point2D;
	rotation?: number;
	alpha?: number;
	zIndex?: number;
	tint?: number;
	visible?: boolean;
	screenAnchor?: Point2D;
}

/**
 * Base transform shared by every node kind. Mirrors PIXI.Container / PIXI.Sprite
 * placement fields the engine already uses today.
 */
interface BaseNode {
	id: string;
	label?: string;
	x: number;
	y: number;
	anchor?: Point2D;
	scale?: Point2D;
	rotation?: number;
	alpha?: number;
	zIndex?: number;
	overrides?: Partial<Record<LayoutType, NodeOverride>>;
	visibleFor?: LayoutType[];
	/**
	 * Which template slot this node fills. When set, the node is "filling" the
	 * slot of that `slotId` in the game type's {@link GameTemplate}; when absent
	 * the node is free scenery (still allowed — slots constrain, they don't
	 * forbid). For a `mount` slot the node is a `ContainerNode` anchor whose
	 * `bind.component` (set by the editor from the slot's `mountComponent`)
	 * mounts the engine-owned component — `slotId` is the slot-identity tag for
	 * validation, not the registry key. Purely additive — docs without `slotId`
	 * are unchanged.
	 */
	slotId?: string;
	/**
	 * Editor-only: when true the editor disables selection/drag/transform of this
	 * node. The engine ignores it (purely an authoring affordance).
	 */
	locked?: boolean;
	/**
	 * Escape hatch: mount a coded Svelte component registered via
	 * `registerBoundComponents()` at this node's transform. The component
	 * receives the resolved transform plus `props`.
	 */
	bind?: { component: string; props?: Record<string, unknown> };
	/**
	 * Window-edge anchor for `canvas`-space scenes (see {@link Scene.space}).
	 * When set, the runtime/editor place the node at
	 * `screenAnchor * canvasSize + (x, y)` — i.e. `x`/`y` become an offset from
	 * the chosen window edge/point (0 = left/top, 0.5 = centre, 1 = right/bottom).
	 * This generalises the HUD corners' current literals
	 * (`x = canvasSizes().width - 20` ⇒ `screenAnchor {x:1, y:0}` + `x:-20`).
	 * Ignored for `game`/`standard` scenes (additive — absent = today's behaviour).
	 */
	screenAnchor?: Point2D;
	/**
	 * Editor-only render hint for `bind` nodes whose real coded component the
	 * editor can't run. Two flavours, both purely editor-side — the game ALWAYS
	 * ignores `preview` and mounts the real Pixi component:
	 * - `style` (+ `w`/`h`): a simple 2D chip for HUD bind anchors (buttons =
	 *   rounded square + icon label; labels = ticker + text), so the author sees
	 *   roughly the real HUD instead of a generic placeholder box.
	 * - `art`: a real spine/sprite the editor draws in the anchor's place (e.g. the
	 *   animated `Background`, which is full-bleed + crossfades in-game and so has
	 *   to stay a coded `bind`). Lets "see the game composed" work without the
	 *   editor running game code. `fit` controls how the art is sized to the scene
	 *   frame: `'cover'` fills the frame (may crop — the full-bleed background),
	 *   `'contain'` scales to fit INSIDE the frame keeping aspect, centred (the
	 *   centred overlays), absent = natural size at the node transform.
	 */
	preview?: {
		w?: number;
		h?: number;
		style?: 'button' | 'label' | 'text';
		art?: {
			kind: 'spine' | 'sprite';
			assetKey: string;
			region?: string;
			fit?: 'cover' | 'contain';
		};
	};
}

export interface ContainerNode extends BaseNode {
	kind: 'container';
	children: LayoutNode[];
	/**
	 * Optional box size for an editor-visible anchor (e.g. a `mount` slot's
	 * placeholder you positioned on the canvas). `resolveTransform` surfaces it so
	 * the editor draws + resizes a real box. A PLAIN container ignores it in-game;
	 * a `bind` container forwards it to the mounted component via `transform`
	 * (which "SHOULD read transform.width/height" — see LayoutNodeView), so sizing
	 * the box sizes the component for any game that consumes the anchor.
	 */
	width?: number;
	height?: number;
}

export interface SpriteNode extends BaseNode {
	kind: 'sprite';
	/**
	 * The asset the game loads. Without `region` this IS the texture key looked
	 * up in `loadedAssets` (a standalone `type: 'sprite'` texture). With `region`
	 * set it instead names the atlas/spritesheet (`type: 'sprites'`) the game must
	 * load so the frame is present at runtime — the render lookup then happens by
	 * `region`, not `assetKey`.
	 */
	assetKey: string;
	/**
	 * A single packed frame WITHIN the `assetKey` atlas/spritesheet. When set, the
	 * engine renders that frame: pixi-svelte's `sprites` loader flattens an atlas
	 * into `loadedAssets` keyed by frame name, so the frame texture is resolved by
	 * `<Sprite key={region}>` (same path `apps/lines` uses for `frame_bg.png`).
	 * When absent, behaviour is unchanged — `assetKey` is a standalone texture.
	 */
	region?: string;
	width?: number;
	height?: number;
	tint?: number;
}

export interface SpineNode extends BaseNode {
	kind: 'spine';
	assetKey: string;
	width?: number;
	height?: number;
	defaultAnimation?: string;
	loop?: boolean;
}

/**
 * Text styling — a typed subset of `PIXI.TextStyle` (pixi-svelte's `<Text>`
 * forwards `style` straight to `new PIXI.Text({ style })`, so every field here
 * maps 1:1 onto a real Pixi text option). Covers what a game label/heading/
 * count-up actually needs: multi-line **wrapping** + alignment, line/letter
 * spacing, an outline `stroke`, and a `dropShadow` (win amounts almost always
 * want one). All optional + additive — an existing `{ fontFamily, fontSize,
 * fontWeight, fill }` doc stays valid.
 *
 * Font note: `fontFamily` only renders correctly if the *game* has loaded that
 * web font (WebFontLoader) before first paint — otherwise Pixi silently falls
 * back to a system font and the metrics shift. The editor records the family;
 * keeping the game's loaded fonts in sync is the asset-registration concern (see
 * `docs/design/invisible-editor.md` — asset/font validation).
 */
export interface TextStyle {
	fontFamily?: string;
	fontSize?: number;
	/** `'normal' | 'bold' | '100'..'900'` — Pixi accepts the CSS weight strings. */
	fontWeight?: string;
	fontStyle?: 'normal' | 'italic' | 'oblique';
	fill?: number;
	align?: 'left' | 'center' | 'right' | 'justify';
	/** Enable multi-line wrapping. Requires `wordWrapWidth` to bound the lines. */
	wordWrap?: boolean;
	/** Wrap width in the text node's local (pre-scale) pixels. */
	wordWrapWidth?: number;
	/** Break inside words when a single word exceeds `wordWrapWidth` (CJK/URLs). */
	breakWords?: boolean;
	lineHeight?: number;
	letterSpacing?: number;
	/** Outline. Pixi 8 takes a fill+width object. */
	stroke?: { color: number; width: number };
	dropShadow?: {
		color?: number;
		alpha?: number;
		blur?: number;
		/** Shadow direction in radians. */
		angle?: number;
		distance?: number;
	};
}

export interface TextNode extends BaseNode {
	kind: 'text';
	/** May be a localization key — engine layer resolves before render. */
	text: string;
	style?: TextStyle;
}

/**
 * A placement that references a {@link ComponentDef} (the prefab tier — see
 * `docs/design/invisible-editor.md` §8.2). The editor's component picker drops
 * one; the Properties panel edits its `params` + per-layoutType transform. The
 * resolved `ComponentDef.root` mounts at this node's transform.
 */
export interface ComponentInstanceNode extends BaseNode {
	kind: 'componentInstance';
	componentId: string;
	/** Pin a specific {@link ComponentDef.version}; omit = latest. */
	componentVersion?: number;
	/** Author-set overrides for the component's {@link ComponentParam}s. */
	params?: Record<string, unknown>;
}

export type LayoutNode =
	| ContainerNode
	| SpriteNode
	| SpineNode
	| TextNode
	| ComponentInstanceNode;

export interface Scene {
	id: string;
	name: string;
	nodes: LayoutNode[];
	/**
	 * Which coordinate space this scene authors into. `<LayoutScene>` reads this
	 * and **self-wraps** in the matching container, so a scene renders identically
	 * regardless of where the game mounts it (this is what fixes the "scene mounted
	 * outside MainContainer draws main-coords as raw canvas pixels → offset" bug —
	 * see `docs/design/invisible-editor.md`). The editor frames the same box.
	 * - `game` (default) — the doc's `mainSizesMap` box, wrapped in `<MainContainer>`
	 *   (every existing scene).
	 * - `standard` — the fixed `STANDARD_MAIN_SIZES_MAP` box, `<MainContainer standard>`
	 *   (the HUD bottom bar). Honours {@link Scene.align}.
	 * - `canvas` — raw window; nodes use {@link BaseNode.screenAnchor}, rendered at
	 *   the `<App>` root with no wrapper (the HUD corners — logo / game name).
	 * - `background` — full-bleed cover layer: nodes cover-fit the canvas via the
	 *   layout context's `normalBackgroundLayout`, the node's `scale.x` acting as
	 *   the cover scale (defaults to 0.5, matching the coded `Background`). For a
	 *   static background image/spine; animated multi-state crossfade stays coded.
	 * Additive — absent = `game`.
	 */
	space?: 'game' | 'standard' | 'canvas' | 'background';
	/**
	 * Alignment of a `space: 'standard'` scene within the canvas — forwarded to
	 * `<MainContainer standard alignVertical alignHorizontal>`. The HUD bottom bar
	 * is `{ vertical: 'bottom' }`. Ignored for other spaces. Absent = centred.
	 */
	align?: {
		vertical?: 'center' | 'bottom';
		horizontal?: 'center' | 'left' | 'right';
	};
}

export interface LayoutDoc {
	version: 1;
	projectKey: string;
	/**
	 * The game type whose {@link GameTemplate} this doc fills (e.g. `'lines'`,
	 * `'bookOf'`). Persisted so the editor reopens with the right template's slots
	 * without a per-session re-pick, and so seeding/validation resolve the same
	 * template the author chose. Optional + additive — absent docs fall back to the
	 * project's resolved game type.
	 */
	gameType?: string;
	mainSizesMap: Record<LayoutType, { width: number; height: number }>;
	scenes: Scene[];
	updatedAt: string;
}

/**
 * Template — the schema a game *type* advertises (its scenes + named slots),
 * authored as data and consumed when seeding/filling a project's LayoutDoc.
 * See `docs/design/invisible-editor.md` §7.1 / §7.5.
 *
 * - `sprite`/`spine`/`text` slots are **artist-owned** static scenery: the
 *   editor places a real node and the author owns its transform.
 * - `mount` slots are **engine-owned**: the editor places only a container
 *   anchor whose `bind.component` is the slot's `mountComponent`; at runtime the
 *   game fills it via `registerBoundComponents`. This is the typed declaration
 *   over the freeform `bind` hatch — the slot says *what* must be mounted, the
 *   game implements it.
 */
export type SlotKind = 'sprite' | 'spine' | 'text' | 'mount';

export interface TemplateSlot {
	slotId: string;
	name: string;
	kind: SlotKind;
	/** Save-time validation: a required slot must be filled by some node. */
	required?: boolean;
	/**
	 * For `kind: 'mount'` — the `registerBoundComponents` name the engine mounts
	 * behind this slot. The editor writes it to the anchor node's
	 * `bind.component`; the game must register a component under this name.
	 */
	mountComponent?: string;
	/** Authoring hint: which asset kinds the editor offers for this slot. */
	accepts?: ('sprite' | 'spine' | 'text')[];
}

export interface TemplateScene {
	id: string;
	name: string;
	slots: TemplateSlot[];
}

export interface GameTemplate {
	gameType: string;
	version: 1;
	scenes: TemplateScene[];
}

/**
 * Component (prefab) tier — see `docs/design/invisible-editor.md` §8. A
 * `ComponentDef` both *data-fies* today's coded pieces (so they're visible +
 * composable in the editor) and serves as a reusable prefab dropped across
 * scenes/games via a {@link ComponentInstanceNode}. Purely additive — a doc
 * without components is unchanged.
 */
export type ComponentCategory = 'ui' | 'overlay' | 'scenery';

export interface ComponentDef {
	/** Stable, unique id (e.g. `'baseGameOverlays'`). */
	id: string;
	name: string;
	/** Bumped on edit; an instance pins a {@link ComponentInstanceNode.componentVersion}. */
	version: number;
	scope: 'shared' | 'project';
	category: ComponentCategory;
	/** The reusable sub-tree, authored on the same canvas as a scene. */
	root: ContainerNode;
	/** Typed inputs an instance or the engine can set. */
	params?: ComponentParam[];
	/** Named triggers the engine fires (enter/exit/win/…). */
	signals?: ComponentSignal[];
	/** A component may expose its own slots. */
	slots?: TemplateSlot[];
	// tracks?: BehaviorTrack[]  // RESERVED for v2 authored-behavior timeline (§8.5) — NOT in v1
}

/**
 * A typed input on a {@link ComponentDef}. `engineProvided` declares (without
 * implementing) that the engine supplies the value at runtime — the
 * `declare ≠ implement` bridge (§8.5).
 */
export interface ComponentParam {
	key: string;
	kind: 'number' | 'string' | 'color' | 'boolean';
	default?: unknown;
	engineProvided?: boolean;
}

/** A named trigger the engine fires at a component (wiring is engine-owned). */
export interface ComponentSignal {
	key: string;
	note?: string;
}

/**
 * Resolved transform after applying the base + per-layoutType override.
 * What `<LayoutScene>` passes down to each pixi-svelte primitive (and to
 * bound components via their resolved props).
 */
export interface ResolvedTransform {
	x: number;
	y: number;
	anchor?: Point2D;
	scale?: Point2D;
	rotation?: number;
	alpha?: number;
	zIndex?: number;
	width?: number;
	height?: number;
	tint?: number;
	visible: boolean;
	/** Window-edge anchor for `canvas`-space scenes — see {@link BaseNode.screenAnchor}. */
	screenAnchor?: Point2D;
}
