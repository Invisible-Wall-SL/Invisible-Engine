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
	 * Editor-only render hint for `bind` nodes whose real component is a simple
	 * shape+text (the HUD: buttons = rounded square + icon label; labels = ticker
	 * + text). Lets the 2D editor draw a faithful chip at this size/style instead
	 * of a generic placeholder box, so an author sees roughly the real HUD. The
	 * game ignores it (it mounts the real Pixi component).
	 */
	preview?: { w: number; h: number; style: 'button' | 'label' | 'text' };
}

export interface ContainerNode extends BaseNode {
	kind: 'container';
	children: LayoutNode[];
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

export interface TextNode extends BaseNode {
	kind: 'text';
	/** May be a localization key — engine layer resolves before render. */
	text: string;
	style?: {
		fontFamily?: string;
		fontSize?: number;
		fontWeight?: string;
		fill?: number;
	};
}

export type LayoutNode = ContainerNode | SpriteNode | SpineNode | TextNode;

export interface Scene {
	id: string;
	name: string;
	nodes: LayoutNode[];
	/**
	 * Which coordinate space this scene authors into — decides the box the editor
	 * frames the scene against and the wrapper the game mounts `<LayoutScene>` in.
	 * - `game` (default) — the doc's `mainSizesMap` box, plain `<MainContainer>`
	 *   (every existing scene).
	 * - `standard` — the fixed `STANDARD_MAIN_SIZES_MAP` box, `<MainContainer standard>`
	 *   (the HUD bottom bar).
	 * - `canvas` — raw window; nodes use {@link BaseNode.screenAnchor}, mounted at
	 *   the `<App>` root (the HUD corners — logo / game name).
	 * Additive — absent = `game`.
	 */
	space?: 'game' | 'standard' | 'canvas';
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
