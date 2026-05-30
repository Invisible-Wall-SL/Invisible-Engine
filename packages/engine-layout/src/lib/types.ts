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
}

export interface LayoutDoc {
	version: 1;
	projectKey: string;
	mainSizesMap: Record<LayoutType, { width: number; height: number }>;
	scenes: Scene[];
	updatedAt: string;
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
}
