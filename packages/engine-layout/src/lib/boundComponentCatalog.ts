import { BUILTIN_REGION } from './builtinRegions';
import { HUD_TILE_HEIGHT, HUD_TILE_WIDTH } from './builtinComponents';
import type { ComponentDef, LayoutNode, LayoutType, Scene } from './types';

/**
 * Shared, game-agnostic catalog of how the editor treats well-known **coded**
 * components (the ones mounted via a `bind` anchor — Background, Win, free-spins,
 * …). It exists so a coded component is previewed + spaced THE SAME WAY in every
 * game and on every screen, instead of each game's seed hand-mapping each item.
 *
 * - `space`: the coordinate space a scene hosting this component should author in
 *   (these are full-screen/self-positioning coded overlays → `canvas`).
 * - `preview`: the editor-only stand-in art the editor draws in the anchor's
 *   place (the game always ignores `preview` and mounts the real component). The
 *   asset is referenced by a CONVENTION name (`bundle` for a rig, `region` for
 *   an atlas frame) that the editor resolves against the active project's assets,
 *   so it works across games WITHOUT a per-game asset list here.
 *
 * Precedence: an explicit `node.preview.art` on a placement always wins; this
 * catalog is the default when a node has none. A project whose assets don't
 * follow the convention either renames them or sets `preview.art` explicitly.
 *
 * The asset-naming convention this encodes (the home for documenting it is
 * `docs/conventions/`): the base background rig is `foregroundAnimation`, the
 * big-win rig `bigwin`, the transition rig `transition`, the free-spin intro/
 * outro rigs `fsIntro`/`fsOutro`, and the free-spin counter panel frame the
 * atlas region `Frame_FSCounter.png`.
 */

/**
 * EDITOR-PREVIEW ONLY: declares that a coded component RIDES a stand-in symbol on a bone of an
 * authored rig, so the Scene Editor can render that symbol tracking the live bone WITHOUT running
 * the game (the runtime already does this via `<RigBoneAttach>`). Keyed off `bind.component`,
 * this names the ENCLOSING component-instance param keys the editor reads to build the rider — it
 * stays data-driven (any future bone-riding component declares its own binding here) rather than
 * hardcoding a component id in the editor. All values are plain strings/numbers/booleans resolved
 * from the instance's params; an empty `boneParam` value ⇒ no rider (parity). Never written to the
 * layout doc — purely an editor affordance, mirroring {@link BoundComponentPreview}.
 */
export interface BoneRiderBinding {
	/** Instance param naming the rig RIG bundle the bone lives on (e.g. `introSpine`). */
	spineParam: string;
	/** Instance param naming the BONE to follow (e.g. `symbolBone`). Empty value ⇒ no rider. */
	boneParam: string;
	/** Instance param for the animation to auto-play so the bone MOVES (e.g. `introAnimation`). */
	animationParam?: string;
	/** Instance param for the pixel offset added in the rig's local space (default 0). */
	offsetXParam?: string;
	offsetYParam?: string;
	/** Instance param toggling whether the symbol also takes the bone's world rotation (default true). */
	followRotationParam?: string;
	/** Instance param toggling whether the symbol also takes the bone's world scale (default true). */
	followScaleParam?: string;
	/** Instance param for the extra symbol scale multiplier (default 1). */
	scaleParam?: string;
	/** Optional instance param (kind `image`) pointing the stand-in at a real symbol atlas region;
	 * when set + resolvable the editor draws that frame instead of the labelled placeholder box. */
	imageParam?: string;
}

/**
 * EDITOR-PREVIEW ONLY: declares that a coded TILE part (the HUD readout's `Background`) can have
 * its coded art REPLACED, per placed instance, by an atlas frame the author picks — so the Scene
 * Editor draws the real frame instead of the grey stand-in chip. Keyed off `bind.component`, this
 * names the ENCLOSING component-instance param keys the editor reads, so it stays data-driven
 * (any future skinnable tile declares its own binding here) rather than hardcoding a component id
 * in the canvas. The runtime reads the SAME params off the param context `<ComponentInstance>`
 * provides — this entry only teaches the editor to preview what the game already draws. Never
 * written to the layout doc, mirroring {@link BoundComponentPreview} and {@link BoneRiderBinding}.
 */
export interface TileImageBinding {
	/** Instance param (kind `image`) whose picked frame REPLACES the coded tile. Empty ⇒ tile. */
	imageParam: string;
	/** Instance param (kind `color`) multiplying whichever of the two draws. */
	tintParam?: string;
	/** Instance params (kind `number`) overriding the box. With a picked frame they size it by
	 *  `aspectBox` (blank ⇒ the frame's own size, one alone keeps its ratio); with none, blank ⇒
	 *  {@link width}/{@link height}. */
	widthParam?: string;
	heightParam?: string;
	/** The coded tile's own box in component-local px — what the part draws with nothing set. */
	width: number;
	height: number;
}

/**
 * A coded part an author can SKIN (Phase 12c, design `hold-and-win.md` §8). The part draws the
 * picked art in place of its coded drawing, and the author's own nodes INSIDE it — its `bind`
 * node's children, which the game hands the part as its `skin` — draw over that art (under an
 * `overNodes` layer), while the part keeps its behaviour. Declaring this is what lets the editors draw those children and the
 * art instead of the stand-in chip, and lets the Component Editor step inside the part to author
 * them. Keyed off `bind.component`, naming the ENCLOSING instance's param keys like
 * {@link TileImageBinding}; never written to the layout doc.
 */
export interface PartSkinBinding {
	/**
	 * Instance params (kind `image`) drawn bottom → top, centred on the part. A layer with a
	 * `directionParam` is a FILL: the game reveals it by a value from the edge that param names
	 * (12b's `fillMaskRect`); the editor previews it at `POT_PREVIEW_FILL_SHARE`. An `overNodes`
	 * layer draws over the author's nodes, as the game draws it (the wheel's rim frames everything).
	 */
	layers: { imageParam: string; directionParam?: string; overNodes?: boolean }[];
	/** Instance params (kind `number`) overriding every layer's box; blank ⇒ each image's own. */
	widthParam?: string;
	heightParam?: string;
	/** A round part (the wheel): with width and height blank, every layer's box is twice this
	 *  instance param, its radius. */
	radiusParam?: string;
}

export interface BoundComponentPreview {
	kind: 'spine' | 'sprite';
	/** Convention rig-bundle name (kind `spine`), resolved against project rigs. */
	bundle?: string;
	/** Fallback rig-bundle names (kind `spine`), tried in order when `bundle` isn't
	 * in the project. Encodes common reuse — e.g. a free-spin OUTRO that has no
	 * dedicated `fsOutro` rig and reuses the INTRO frame (`fsIntro`). */
	fallbackBundles?: string[];
	/** Convention atlas-region name (kind `sprite`), resolved against the project manifest. */
	region?: string;
}

/**
 * Where the editor draws a coded component's preview, so it lands on (≈) its
 * real in-game spot. The board-relative ones are resolved against the game's
 * board geometry — universal across games (formula, not magic numbers) — by
 * {@link computeOverlayPlacement}:
 * - `cover` — fill the canvas (full-bleed background).
 * - `centre` — fit-inside + centre on the scene (full-screen overlays: intro/
 *   outro/transition self-position centred, so this matches them).
 * - `boardCentre` — centred on the reel board (e.g. the win animation).
 * - `boardLeft` — to the LEFT of the board, top-aligned (the free-spin counter).
 * (Room to add `boardRight`/`boardTop`/… as games need them.)
 */
export type OverlayPlacement = 'cover' | 'centre' | 'boardCentre' | 'boardLeft';

export interface BoundComponentDefault {
	/** Coordinate space for a scene hosting (only) this component. */
	space?: Scene['space'];
	/** Editor-only preview art (see {@link BoundComponentPreview}). */
	preview?: BoundComponentPreview;
	/** Editor-only bone-ridden stand-in symbol (see {@link BoneRiderBinding}). */
	ridesBone?: BoneRiderBinding;
	/** Editor-only per-instance tile skin (see {@link TileImageBinding}). */
	tileImage?: TileImageBinding;
	/** A part the author can skin with art and their own nodes (see {@link PartSkinBinding}). */
	skin?: PartSkinBinding;
	/** Where the editor places the preview (see {@link OverlayPlacement}). */
	placement?: OverlayPlacement;
	/** Default render order when the component is dropped as an anchor. */
	zIndex?: number;
	/** layoutTypes the component is shown for (absent = all). */
	visibleFor?: LayoutType[];
}

/**
 * Default editor treatment per coded component name. Keyed by the SAME name a
 * game passes to `registerBoundComponents` and writes into `bind.component`.
 */
export const BOUND_COMPONENT_DEFAULTS: Record<string, BoundComponentDefault> = {
	// The HUD readout's Background tile. No `space`/`preview`/`placement` — it is a part INSIDE a
	// component, never a droppable overlay anchor — so `hostedComponentSpace` still walks past it
	// (parity). It is here only to declare the per-instance skin the editor must preview.
	HudTicker: {
		tileImage: {
			imageParam: 'backgroundImage',
			tintParam: 'backgroundTint',
			widthParam: 'backgroundWidth',
			heightParam: 'backgroundHeight',
			width: HUD_TILE_WIDTH,
			height: HUD_TILE_HEIGHT,
		},
	},
	// The Pot Meter's coded pot. A part inside the `potMeter` def, never a droppable anchor, so —
	// like `HudTicker` — no `space`/`preview`/`placement`. Its art params are `POT_SKIN_PARAMS`.
	PotMeter: {
		skin: {
			layers: [
				{ imageParam: 'backgroundImage' },
				{ imageParam: 'fillImage', directionParam: 'fillDirection' },
				{ imageParam: 'frameImage' },
			],
			widthParam: 'artWidth',
			heightParam: 'artHeight',
		},
	},
	// The Respin Counter's coded part: its art is the def's own nodes, which sit inside it — no layer
	// params, so the editor draws those nodes and offers to edit inside the part.
	RespinCounterPart: { skin: { layers: [] } },
	// The Jackpot Tile's coded part, the same shape: its art is the tile's own nodes, inside it.
	JackpotTilePart: { skin: { layers: [] } },
	// The Total Win Bar's coded part, the same shape again.
	TotalWinBarPart: { skin: { layers: [] } },
	// A Letter Tile's coded part: the dim and lit art and letter, inside it.
	LetterTilePart: { skin: { layers: [] } },
	// A Cell Tile's coded part: the tile and its held overlay, inside it.
	CellTilePart: { skin: { layers: [] } },
	// The Wheel's coded part: the turning face under the fixed rim, at the wheel's size. The pointer
	// sits off-centre at the rim, so only the game draws it.
	HoldAndWinWheelPart: {
		skin: {
			layers: [{ imageParam: 'faceImage' }, { imageParam: 'rimImage', overNodes: true }],
			widthParam: 'artSize',
			heightParam: 'artSize',
			radiusParam: 'radius',
		},
	},
	LoadingScreen: {
		// The startup splash: the game's `loader` rig (the `title_screen`
		// animation = the logo) over the progress bar, self-centred in
		// `<MainContainer>`. Editor-only preview; the game mounts its coded
		// `LoadingScreen.svelte` regardless.
		space: 'canvas',
		placement: 'centre',
		preview: { kind: 'spine', bundle: 'loader' },
	},
	Background: {
		space: 'canvas',
		zIndex: -10,
		placement: 'cover',
		preview: { kind: 'spine', bundle: 'foregroundAnimation' },
	},
	Win: {
		space: 'canvas',
		placement: 'boardCentre',
		preview: { kind: 'spine', bundle: 'bigwin' },
	},
	Transition: {
		space: 'canvas',
		placement: 'centre',
		preview: { kind: 'spine', bundle: 'transition' },
	},
	FreeSpinCounter: {
		space: 'canvas',
		placement: 'boardLeft',
		preview: { kind: 'sprite', region: BUILTIN_REGION.freeSpinCounterFrame },
	},
	// The board-relative free-spin intro VISUAL (a bare scene bind, or the `game`-space
	// `freeSpinIntroVisual` componentInstance the owner positions). Previews the `fsIntro` frame
	// rig at board centre (the def's default node position), so the editor preview matches the
	// in-game default; dragging the instance moves it.
	FreeSpinIntroVisual: {
		space: 'game',
		placement: 'boardCentre',
		preview: { kind: 'spine', bundle: 'fsIntro' },
	},
	// The board-relative free-spin outro VISUAL (a bare scene bind, or the `game`-space
	// `freeSpinOutroVisual` componentInstance the owner positions), previewed at board centre.
	FreeSpinOutroVisual: {
		space: 'game',
		placement: 'boardCentre',
		preview: { kind: 'spine', bundle: 'fsOutro', fallbackBundles: ['fsIntro'] },
	},
	// The board-relative VISUAL half of the WIN overlay split (a `game`-space componentInstance the
	// owner positions), previewed at board centre with the `bigwin` rig — mirroring the coded
	// `Win` anchor's own preview so the editor default matches the in-game default.
	WinVisual: {
		space: 'game',
		placement: 'boardCentre',
		preview: { kind: 'spine', bundle: 'bigwin' },
	},
	SpecialBook: {
		// The expanding-symbol reveal sits on the board centre; its art is the chosen
		// symbol's rig (state machine), so there's no fixed preview bundle — the editor
		// shows a board-centred placeholder until the game runs.
		space: 'canvas',
		placement: 'boardCentre',
	},
	// The board's chosen book expanding symbol as a POSITIONABLE part (the `expandingSymbol`
	// def's bind). Placed `game`-space at board centre, mirroring `FreeSpinIntroVisual`; its
	// art is the chosen symbol's rig (state machine), so there's no fixed preview bundle —
	// the editor shows a board-centred placeholder until the game runs.
	ExpandingSymbol: {
		space: 'game',
		placement: 'boardCentre',
	},
	// The chosen symbol merged onto a bone of an authored intro rig (the `freeSpinIntroSymbolReveal`
	// def's bind). Placed `game`-space at board centre; previews the authored intro rig bundle so
	// the rig is visible in the editor, while the ridden symbol art only appears once the game runs.
	FreeSpinIntroSymbolReveal: {
		space: 'game',
		placement: 'boardCentre',
		preview: { kind: 'spine', bundle: 'fsIntro' },
		// The rig previews from the instance's `introSpine` param; the editor also mounts a
		// stand-in symbol on `symbolBone` that rides the played `introAnimation`, honouring the
		// offset / follow / scale knobs — mirroring the runtime `FreeSpinIntroSymbolReveal.svelte`.
		ridesBone: {
			spineParam: 'introSpine',
			boneParam: 'symbolBone',
			animationParam: 'introAnimation',
			offsetXParam: 'offsetX',
			offsetYParam: 'offsetY',
			followRotationParam: 'followRotation',
			followScaleParam: 'followScale',
			scaleParam: 'symbolScale',
			imageParam: 'previewImage',
		},
	},
};

/** The default editor treatment for a coded component name, if known. */
export function boundComponentDefault(name: string): BoundComponentDefault | undefined {
	return BOUND_COMPONENT_DEFAULTS[name];
}

/**
 * The coordinate SPACE the overlay a componentInstance HOSTS is designed for — the catalog
 * {@link BoundComponentDefault.space} of the FIRST bound component in the def's tree (walking
 * containers), or `undefined` when the def hosts no catalogued bind.
 *
 * A board-relative overlay (the win / free-spin VISUALS declare `space:'game'`) is authored as
 * a `componentInstance` the owner drops on ANY screen. On a `game`-space screen it inherits the
 * scene's `<MainContainer>` (main→window scale + board mapping) and previews == ships. But on a
 * `canvas`-space screen there is NO `<MainContainer>`, so the game draws the overlay at RAW
 * window pixels — smaller, and offset to the upper-left of the (main-scaled) board — while the
 * Scene Editor previews it board-centred. Both surfaces read this to re-apply the SAME main
 * framing regardless of the host screen's space, so a game-space overlay is WYSIWYG wherever it
 * is placed. A def hosting a `canvas`/no-catalog bind returns that (⇒ no main framing — parity).
 */
export function hostedComponentSpace(def: ComponentDef | undefined): Scene['space'] | undefined {
	if (!def) return undefined;
	let space: Scene['space'] | undefined;
	const walk = (node: LayoutNode): void => {
		if (space !== undefined) return;
		if (node.bind) {
			space = boundComponentDefault(node.bind.component)?.space;
			if (space !== undefined) return;
		}
		if (node.kind === 'container') for (const child of node.children) walk(child);
	};
	walk(def.root);
	return space;
}

/**
 * EDITOR-PREVIEW ONLY: the rig bundle NAME a componentInstance should preview its bound
 * rig art from — the VALUE of its def's FIRST `spine`-kind param, read from the instance's
 * already-resolved params (def defaults ◁ instance overrides). This lets the Scene Editor
 * render the AUTHORED rig (the win overlay's `winSpine`, the free-spin visuals' `introSpine`/
 * `outroSpine`) on the canvas — which publishes its live `RigMeta`, so the instance's
 * `spineAnimation`/`spineSlot`/`spineBone` param dropdowns populate for a custom rig instead
 * of degrading to free-text. Discovered generically off `kind:'spine'` (no per-component id),
 * so every def that declares a rig param benefits. Returns `undefined` when the def declares
 * no rig param, or the value isn't a non-empty string — the caller then previews the fixed
 * catalog bundle (parity). Never written to the layout doc; a purely editor affordance.
 */
export function instancePreviewRigBundle(
	def: ComponentDef,
	params: Record<string, unknown>,
): string | undefined {
	const key = def.params?.find((p) => p.kind === 'spine')?.key;
	if (!key) return undefined;
	const value = params[key];
	return typeof value === 'string' && value ? value : undefined;
}

/**
 * The bone-rider binding a coded component declares (see {@link BoneRiderBinding}), or
 * `undefined` for a component that doesn't ride a bone. Keyed off the `bind.component` name so
 * the editor stays data-driven — it never hardcodes `freeSpinIntroSymbolReveal`.
 */
export function boundComponentRidesBone(name: string): BoneRiderBinding | undefined {
	return BOUND_COMPONENT_DEFAULTS[name]?.ridesBone;
}

/**
 * The per-instance tile skin a coded component declares (see {@link TileImageBinding}), or
 * `undefined` for a tile whose art is fixed. Keyed off the `bind.component` name so the editor
 * stays data-driven — it never hardcodes `HudTicker`.
 */
export function boundComponentTileImage(name: string | undefined): TileImageBinding | undefined {
	return name ? BOUND_COMPONENT_DEFAULTS[name]?.tileImage : undefined;
}

/**
 * The skin a coded part declares (see {@link PartSkinBinding}), or `undefined` for a part whose
 * drawing is fixed. Keyed off the `bind.component` name, so the editor never hardcodes `PotMeter`.
 */
export function boundComponentSkin(name: string | undefined): PartSkinBinding | undefined {
	return name ? BOUND_COMPONENT_DEFAULTS[name]?.skin : undefined;
}

/**
 * One editable parameter a coded (bound) component exposes to the editor — the
 * UNIVERSAL generalization of the per-component appearance knob (it subsumes the
 * bespoke HUD-text override in `hudText.ts`). The editor auto-renders a control
 * per entry and persists the value to the anchor's `bind.props`, which already
 * flows to the component at runtime (`LayoutNodeView`/`LayoutEditable` spread
 * `bind.props`). PLACEMENT (x/y/scale/rotation) and VISIBILITY stay on the node
 * transform — they're already universal — so they are NOT params here.
 *
 * `group: 'style'` nests the value under `bind.props.style` (a `Partial<TextStyle>`,
 * matching {@link HudTextOverride}); otherwise it's a top-level `bind.props` key.
 * The component must consume the prop it declares (the "implement" half) — e.g.
 * a label merges `style`, a button reads `tint`. Declaring a param the component
 * doesn't yet read is harmless (no-op in-game) — opt-in per component.
 */
export interface EditableParam {
	/** The `bind.props` key (or `bind.props.style` key when `group: 'style'`). */
	key: string;
	kind: 'number' | 'color' | 'boolean' | 'string' | 'font';
	label: string;
	/** Nest under `bind.props.style` (text styling) vs. a top-level `bind.props` key. */
	group?: 'style';
	/** Shown as the control placeholder (e.g. the coded default the empty field falls back to). */
	placeholder?: string;
}

// Text styling knobs (font/size/colour) shared by every HUD text element.
const TEXT_STYLE_PARAMS: EditableParam[] = [
	{ key: 'fontFamily', kind: 'font', label: 'Font', group: 'style' },
	{ key: 'fontSize', kind: 'number', label: 'Font size', group: 'style' },
	{ key: 'fill', kind: 'color', label: 'Colour', group: 'style' },
];
// Logo / game-name: an editable label string on top of the style knobs.
const HUD_TEXT_PARAMS: EditableParam[] = [
	{ key: 'text', kind: 'string', label: 'Label text', placeholder: '(coded default)' },
	...TEXT_STYLE_PARAMS,
];
// Buttons: a recolour tint (the icon/background tint the coded button reads).
const BUTTON_PARAMS: EditableParam[] = [{ key: 'tint', kind: 'color', label: 'Tint' }];
// REUSABLE tile-styling knobs — for any coded `UiSprite`-backed tile/frame (the
// readout `HudTicker` + the `ButtonFrame`; attach to others by referencing this).
// `texture` is the loaded sprite key the game's `UiSprite` resolves (the reference
// `UiSprite` is a plain rounded Rectangle and ignores it — `tint` → `backgroundColor`
// recolours that fallback; a textured game `UiSprite` uses both). `borderColor`/
// `borderWidth` map to the `Rectangle` stroke (no-ops on a textured sprite, whose
// frame is baked into the art). The component reads + forwards what it supports.
const TILE_PARAMS: EditableParam[] = [
	{ key: 'texture', kind: 'string', label: 'Texture key', placeholder: 'base_ticker' },
	{ key: 'tint', kind: 'color', label: 'Tint' },
	{ key: 'borderColor', kind: 'color', label: 'Outline colour' },
	{ key: 'borderWidth', kind: 'number', label: 'Outline width', placeholder: '0' },
	{ key: 'borderRadius', kind: 'number', label: 'Corner radius', placeholder: '35' },
];

/**
 * Editable-param schema per coded component, keyed by the SAME name written into
 * `bind.component`. The editor reads this to auto-render the param controls. Add a
 * component here (+ wire it to read the prop) to make it editor-configurable.
 */
export const BOUND_COMPONENT_PARAMS: Record<string, EditableParam[]> = {
	// Free-spin intro VISUAL — swap the coded rig bundle + animation names + the
	// number slot the count is injected into. The component reads these as $props()
	// with the coded values as defaults, so an unauthored game renders identically.
	// NB: a custom `introSpine` bundle MUST expose a slot matching `slotName`, else
	// the count BitmapText has nowhere to mount.
	FreeSpinIntroVisual: [
		{
			key: 'introSpine',
			kind: 'string',
			label: 'Intro rig bundle',
			placeholder: 'fsIntroNumber',
		},
		{ key: 'introAnimation', kind: 'string', label: 'Intro animation', placeholder: 'intro' },
		{ key: 'idleAnimation', kind: 'string', label: 'Idle animation', placeholder: 'idle' },
		{ key: 'slotName', kind: 'string', label: 'Number slot', placeholder: 'slot_number' },
	],
	// Free-spin outro VISUAL — same shape as the intro, for the outro rig. A custom
	// `outroSpine` bundle MUST expose a slot matching `slotName`, else the count BitmapText has
	// nowhere to mount. The engine's headless outro driver emits NO coin fountain; an author who
	// wants coins places their own (FX / particle / rig), so there are no fountain params here.
	FreeSpinOutroVisual: [
		{
			key: 'outroSpine',
			kind: 'string',
			label: 'Outro rig bundle',
			placeholder: 'fsOutroNumber',
		},
		{ key: 'outroAnimation', kind: 'string', label: 'Outro animation', placeholder: 'intro' },
		{ key: 'idleAnimation', kind: 'string', label: 'Idle animation', placeholder: 'idle' },
		{ key: 'slotName', kind: 'string', label: 'Number slot', placeholder: 'slot_number' },
	],
	// Special-Book bonus overlay — only a placement scale knob. The reveal symbol + its
	// animations come from the symbol state machine (`bookIntro`/`bookIdle`), never params.
	SpecialBook: [{ key: 'scale', kind: 'number', label: 'Scale', placeholder: '1.6' }],
	// Readout background tile + the parametric button's frame — same tile knobs
	// (texture / tint / outline / corner radius). The button's engine STATES
	// (disabled grey, active border) override the authored resting style.
	HudTicker: TILE_PARAMS,
	ButtonFrame: TILE_PARAMS,
	// HUD corner text (already consumed by the game's gameName/logo snippets).
	HudGameName: HUD_TEXT_PARAMS,
	HudLogo: HUD_TEXT_PARAMS,
	// HUD bottom-bar labels — the live VALUE stays coded (§9.2); style is editable.
	UiLabelBalance: TEXT_STYLE_PARAMS,
	UiLabelWin: TEXT_STYLE_PARAMS,
	UiLabelBet: TEXT_STYLE_PARAMS,
	// HUD button cluster — recolour tint.
	UiButtonMenu: BUTTON_PARAMS,
	UiButtonBuyBonus: BUTTON_PARAMS,
	UiButtonAutoSpin: BUTTON_PARAMS,
	UiButtonBet: BUTTON_PARAMS,
	UiButtonTurbo: BUTTON_PARAMS,
	UiButtonDecrease: BUTTON_PARAMS,
	UiButtonIncrease: BUTTON_PARAMS,
};

/** The editable-param schema for a coded component name (empty when none/unknown). */
export function getEditableParams(name: string | undefined): EditableParam[] {
	return name ? (BOUND_COMPONENT_PARAMS[name] ?? []) : [];
}

/**
 * The render-ready preview art shape both editor draw paths (the 2D canvas and the
 * rig WebGL overlay) already consume — i.e. what a node's `preview.art` is. The
 * resolver below produces this from the catalog so the two paths agree on ONE art.
 */
export interface ResolvedPreviewArt {
	kind: 'spine' | 'sprite';
	/** The asset key the draw path resolves: a rig bundle prefix, or the manifest
	 * key that contains the sprite `region`. Empty when a sprite region isn't located
	 * yet (the caller draws a placeholder until its region index fills in). */
	assetKey: string;
	region?: string;
	/** Where to draw it — feed to {@link computeOverlayPlacement} with the geometry. */
	placement: OverlayPlacement;
}

/**
 * Minimal view of a project's assets the resolver needs — kept structural so
 * `engine-layout` doesn't depend on launcher-api's asset types. `rigs[].name`
 * is the bundle name (the last path segment of the bundle key); `rigs[].key`
 * is the bundle prefix the editor's rig preview loads.
 */
export interface PreviewAssets {
	spines: { name: string; key: string }[];
}

/**
 * Resolve the editor stand-in art for a node, with this precedence:
 *  1. an explicit `node.preview.art` (a per-node override) always wins;
 *  2. else the catalog default for `node.bind.component`, resolved against the
 *     project's `assets`:
 *     - **rig**: the project rig whose bundle name === the catalog `bundle`;
 *       its key becomes the rig `assetKey`.
 *     - **sprite**: the catalog `region` resolved against `spriteRegionIndex`
 *       (region name → manifest key) — supplied by the caller, which scans the
 *       project manifests lazily. Until the region is located the art is returned
 *       with an empty `assetKey` so callers draw a placeholder (never crash).
 * Returns `undefined` when there's no override and no catalog default (or the
 * default's asset isn't in the project) → the caller falls back to a placeholder.
 */
export function resolveAnchorPreviewArt(
	node: LayoutNode,
	assets: PreviewAssets,
	spriteRegionIndex?: Map<string, string>,
	/** EDITOR-PREVIEW ONLY: a rig bundle NAME that overrides the catalog `bundle` for
	 * this node's rig preview — the AUTHORED rig of the enclosing componentInstance
	 * (its `spine`-kind param value; see {@link instancePreviewRigBundle}). Tried FIRST,
	 * then the catalog `bundle` + `fallbackBundles`, so a custom rig (e.g. the win overlay's
	 * `winSpine`) renders in place of the fixed stand-in; an unset / not-in-project name
	 * falls back to the catalog default (parity). Ignored for sprite previews. */
	previewRigBundle?: string,
	/** The layoutType being previewed. The `fit` that decides this anchor's placement is
	 *  per-layoutType like every other cover input ({@link NodeOverride.fit}), so without it a
	 *  ratio that overrides a `contain` anchor to a window-filling fit previews CENTRED while the
	 *  game covers — the editor/game split the cover readers exist to prevent. Omitted ⇒ the base
	 *  `preview.art.fit` alone (parity). */
	layoutType?: LayoutType,
): ResolvedPreviewArt | undefined {
	// 1. Explicit per-node override wins. Its simple `fit` maps to a placement (any
	//    WINDOW-filling fit — `cover` and the per-axis `width`/`height` — → the cover
	//    placement, which then honours the node's own fit/scale/stretch; anything else →
	//    centred); a node needing a board-relative spot just leaves `art` off and lets the
	//    catalog default apply. An UNSET fit stays centred, so this reads the layout's own `fit`
	//    override (not `backgroundFit`, whose `'cover'` default would make every fit-less preview
	//    anchor full-bleed).
	const override = node.preview?.art;
	if (override) {
		const fit = (layoutType ? node.overrides?.[layoutType]?.fit : undefined) ?? override.fit;
		const fillsWindow = fit === 'cover' || fit === 'width' || fit === 'height';
		return {
			kind: override.kind,
			assetKey: override.assetKey,
			region: override.region,
			placement: fillsWindow ? 'cover' : 'centre',
		};
	}
	const component = node.bind?.component;
	if (!component) return undefined;
	const def = boundComponentDefault(component);
	const preview = def?.preview;
	if (!preview) return undefined;
	const placement: OverlayPlacement = def?.placement ?? 'centre';
	if (preview.kind === 'spine') {
		const bundles = [previewRigBundle, preview.bundle, ...(preview.fallbackBundles ?? [])].filter(
			(b): b is string => !!b,
		);
		const match = bundles.map((name) => assets.spines.find((s) => s.name === name)).find((m) => m);
		if (!match) return undefined;
		return { kind: 'spine', assetKey: match.key, placement };
	}
	// sprite
	if (!preview.region) return undefined;
	const assetKey = spriteRegionIndex?.get(preview.region) ?? '';
	return { kind: 'sprite', assetKey, region: preview.region, placement };
}

/**
 * The board's geometry in the game's main-layout coords (centre + size), plus the
 * main box and the preview art's natural size — everything {@link
 * computeOverlayPlacement} needs. The editor reads the board from the project's
 * `boardFrame` node (every game's basegame has one), so this stays game-agnostic.
 */
export interface PlacementGeometry {
	main: { width: number; height: number };
	board?: { x: number; y: number; width: number; height: number };
	art?: { width: number; height: number };
}

/**
 * How the caller should draw the preview. `cover`/`contain` reuse the existing
 * fit paths; `positioned` gives an explicit MAIN-coord centre + anchor the editor
 * maps to screen (via the doc's `mainSizesMap`, like `<MainContainer>`).
 */
export type OverlayPlacementResult =
	| { mode: 'cover' }
	| { mode: 'contain' }
	| { mode: 'positioned'; x: number; y: number; anchor: { x: number; y: number } };

/**
 * Resolve an {@link OverlayPlacement} to concrete drawing instructions for the
 * editor, given the game's geometry. Board-relative placements fall back to
 * `contain` (centred) when no board is known. The formulas mirror the coded
 * components (Win = board centre; FreeSpinCounter = a panel to the left of the
 * board, top-aligned) but in terms of the board rect, so they hold for any game.
 */
export function computeOverlayPlacement(
	placement: OverlayPlacement,
	geom: PlacementGeometry,
): OverlayPlacementResult {
	if (placement === 'cover') return { mode: 'cover' };
	if (placement === 'centre') return { mode: 'contain' };
	const board = geom.board;
	if (!board) return { mode: 'contain' };
	if (placement === 'boardCentre') {
		return { mode: 'positioned', x: board.x, y: board.y, anchor: { x: 0.5, y: 0.5 } };
	}
	// boardLeft: the panel's RIGHT edge sits a small gap left of the board, its TOP
	// aligned to the board top — the free-spin counter's coded placement, expressed
	// over the board rect (gap ≈ the coded SYMBOL_SIZE*0.7 for a ~5-col board).
	const gap = board.width * 0.12;
	return {
		mode: 'positioned',
		x: board.x - board.width / 2 - gap,
		y: board.y - board.height / 2,
		anchor: { x: 1, y: 0 },
	};
}
