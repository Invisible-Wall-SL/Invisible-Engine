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
	/**
	 * Background cover-scale multiplier — a dedicated UNIFORM zoom on the fitted
	 * cover (`1` = exact edge-to-edge cover). Independent of {@link BaseNode.scale},
	 * which authors the free non-uniform STRETCH ratio on top. Absent = `1`.
	 */
	coverScale?: number;
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
	 * Background cover fit (§10.4). Canonical fit for a plain `background`-SPACE
	 * sprite/spine node — `'cover'` (default) fills the window edge-to-edge (may
	 * crop), `'contain'` scales the art to fit INSIDE the window keeping aspect.
	 * The cover *scale* multiplier lives in {@link BaseNode.coverScale} (1 = exact
	 * cover); `scale.x`/`scale.y` author the free non-uniform stretch on top. For a
	 * `bind` cover anchor (e.g. the animated Background) the canonical fit is read
	 * from {@link BaseNode.preview}.art.fit instead — see `backgroundFit`. Both the
	 * game runtime and the editor preview read fit + scale through one helper so the
	 * two agree. Additive — absent = `'cover'`.
	 */
	fit?: 'cover' | 'contain';
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
	 *   rounded square + icon label; labels = ticker + caption + value; `tile` =
	 *   just the ticker tile with NO text — used by a DECOMPOSED readout whose
	 *   caption/value live in sibling `text` parts; `text` = a single line), so
	 *   the author sees roughly the real HUD instead of a generic placeholder box.
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
		style?: 'button' | 'label' | 'text' | 'tile';
		/**
		 * Editor-only: for a `style: 'text'` (or `'label'`) chip, the resolved
		 * component-param key whose value the chip displays — so a decomposed
		 * readout's Caption part shows its `label` ("BALANCE") and the Value part
		 * shows its numeric `value`, instead of the bare part name. Resolved against
		 * the open component's params (the canvas / text overlay look it up); absent
		 * ⇒ the chip falls back to the node label. The game ignores it.
		 */
		textParam?: string;
		art?: {
			kind: 'spine' | 'sprite';
			assetKey: string;
			region?: string;
			fit?: 'cover' | 'contain';
		};
	};
	/**
	 * Parametric binding (§13.2 "param threading"). Maps a node FIELD PATH (e.g.
	 * `'text'`, `'style.fill'`, `'style.fontFamily'`, `'style.fontSize'`) to a
	 * {@link ComponentParam} key. Resolved only when the node renders inside a
	 * `componentInstance` expansion that provides params (via the param context);
	 * the bound field then reads its value from the resolved param instead of the
	 * node's own static value. Absent ⇒ no effect (a top-level scene node, or a
	 * node with no bindings, renders exactly as today — parity).
	 */
	paramBindings?: Record<string, string>;
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

export interface SpineCue {
	/** A ComponentSignal key declared on the owning component (e.g. 'win','bigWin'). */
	signal: string;
	/** Animation name on this spine to play when the signal fires. */
	animation: string;
	loop?: boolean;
}

/** One state's playback: the animation to play (+ whether it loops while held). */
export interface SpineStateAnimation {
	/** Animation name on this spine. Empty/absent ⇒ that state is unmapped (the
	 * cascade falls back to a neighbour, ultimately `defaultAnimation`). */
	animation: string;
	loop?: boolean;
}

/** Button-INTERACTION-state → spine animation map (the state-driven analogue of the
 * `image*` state cascade). Each entry is optional; an unmapped state cascades to a
 * neighbour exactly like the state-image cascade (pressed→hover→selected→resting),
 * where the resting animation is the node's `defaultAnimation`. */
export interface ButtonStateAnimations {
	hover?: SpineStateAnimation;
	pressed?: SpineStateAnimation;
	selected?: SpineStateAnimation;
	disabled?: SpineStateAnimation;
	spinning?: SpineStateAnimation;
}

export interface SpineNode extends BaseNode {
	kind: 'spine';
	assetKey: string;
	width?: number;
	height?: number;
	defaultAnimation?: string;
	loop?: boolean;
	skin?: string;
	/** Signal-driven playback cues (design §8.5, narrowed to spine-only). When the
	 * named component `signal` fires, this spine plays `animation` on track 0. The
	 * simplest behavior tier — no timeline/tween. Only active when the spine is
	 * inside a `componentInstance` whose game registered a matching signal source via
	 * `registerComponentSignals`; otherwise ignored (a scene-level spine just uses
	 * `defaultAnimation`, parity). */
	cues?: SpineCue[];
	/** Button-state-driven playback: when this spine is inside an INTERACTIVE button
	 * component, the engine resolves the current interaction state (hover / press /
	 * selected / disabled / spinning) and plays the mapped animation, cascading like
	 * the state-image cascade and returning to `defaultAnimation` when no state is
	 * active. Lets a button BE a spine whose animation is driven purely by its state
	 * (the interaction analogue of `imageHover`/`imagePressed`/…). Only active when the
	 * spine's `componentInstance` owns the press (an `action` feed, no coded bind part);
	 * a scene-level spine ignores it (parity). */
	stateAnimations?: ButtonStateAnimations;
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
 * A solid filled rectangle — the basic fill primitive (full-screen dims, panels,
 * colour blocks). `width`/`height` are its size in local space (resize with the editor
 * handles); `color` is the fill (hex int, default white); opacity is the standard
 * {@link BaseNode} `alpha`. No asset — it ships in the doc and renders as a flat fill.
 */
export interface RectNode extends BaseNode {
	kind: 'rect';
	width: number;
	height: number;
	/** Fill colour (hex int). Absent ⇒ white (`0xffffff`). */
	color?: number;
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
	/**
	 * Per-instance overrides for a spine node's button {@link ButtonStateAnimations}
	 * (its "Plays on button state" map), keyed by the spine node's `id` inside the
	 * resolved {@link ComponentDef.root}. Each entry overlays the def's per-state
	 * animation for THIS placement only — an absent state inherits the def — so two
	 * placements of one button can play different state animations (the spine
	 * analogue of overriding `imageHover`/`imagePressed`/… per instance). Merged at
	 * runtime by `mergeButtonStateAnimations`; absent ⇒ the def map is used verbatim
	 * (parity). */
	stateAnimationOverrides?: Record<string, ButtonStateAnimations>;
}

/**
 * Parametric reel/board grid — the "configurable grid primitive" of route B
 * (see `docs/design/invisible-editor.md` §8.7). Exposes the board's existing
 * layout parameters for visual editing: the editor draws a static placeholder
 * grid of `reels × rows` cells of `cellSize` px so the author can position the
 * board and dial its shape, standing in for the (coded) dynamic symbols.
 *
 * v1 is EDITOR-ONLY: the engine renders nothing for this kind (the real board
 * still draws from the game's coded `Board.svelte`), so a doc carrying a
 * `reelGrid` node is parity-safe in-game. A later phase makes the runtime board
 * read these params. The fields mirror the game's board constants 1:1 —
 * `reels`/`rows` = `BOARD_DIMENSIONS.x`/`.y`, `cellSize` = `SYMBOL_SIZE`,
 * `reelPadding` = `REEL_PADDING`.
 */
export interface ReelGridNode extends BaseNode {
	kind: 'reelGrid';
	/** Number of reels (columns) — the game's `BOARD_DIMENSIONS.x`. */
	reels: number;
	/** Number of visible rows — the game's `BOARD_DIMENSIONS.y`. */
	rows: number;
	/** Square cell pitch in px — the game's `SYMBOL_SIZE`. */
	cellSize: number;
	/**
	 * Per-axis cell size in px for NON-SQUARE cells. Absent ⇒ falls back to the
	 * square {@link cellSize} on that axis (so an unset pair = today's square
	 * grid, parity-safe). When set, the cell is drawn/positioned `cellWidth ×
	 * cellHeight` instead of `cellSize × cellSize`.
	 */
	cellWidth?: number;
	cellHeight?: number;
	/**
	 * Cell SPACING (gaps) in px — the empty pitch ADDED between adjacent cells
	 * (column pitch = `cellWidth + gapX`, row pitch = `cellHeight + gapY`).
	 * Absent ⇒ 0 = cells sit flush (today's behaviour). This is distinct from
	 * {@link reelPadding}/{@link rowPadding}, which inset the whole grid; gaps
	 * change the distance BETWEEN cells.
	 */
	gapX?: number;
	gapY?: number;
	/**
	 * Horizontal symbol-centre inset factor — the game's `REEL_PADDING` (the
	 * `getSymbolX` `cellSize * (reelIndex + reelPadding)` term). ≈0.5 = centred.
	 * Absent = 0.5.
	 */
	reelPadding?: number;
	/**
	 * Vertical symbol-centre inset factor — the analog of {@link reelPadding} on
	 * the row axis (the `getSymbolY` `(rowIndex + rowPadding)` term). ≈0.5 =
	 * centred. Absent = 0.5 (today's hard-coded value).
	 */
	rowPadding?: number;
	/**
	 * Symbol size as a ratio of one cell (`{ width, height }`, `1` = the symbol fills
	 * its cell). Applied on top of the cell pitch so it scales the symbol art WITHIN
	 * each cell, independent of the board/cell scaling that {@link cellSize} + the
	 * node transform drive. Absent ⇒ the game's coded per-symbol sizes
	 * (`SYMBOL_INFO_MAP` `sizeRatios`) are used unchanged (parity). Edited on the reel
	 * in the Scene Editor; reaches the game via the layout doc (no bake step).
	 */
	symbolSizeRatios?: { width: number; height: number };
	/**
	 * Spin-FEEL tuning (animation, not layout): optional per-field overrides of the
	 * game's coded `SPIN_OPTIONS_*`, applied by the game's `spinOptions` getter.
	 * Absent / empty ⇒ the coded constants are used unchanged (parity).
	 */
	spin?: ReelSpinTuning;
	/**
	 * Free-spin anticipation overlay tuning (the per-reel spine "hold" effect):
	 * optional per-field overrides of the game's coded `ANTICIPATION` config.
	 * Absent / empty ⇒ the coded defaults are used unchanged (parity). The `*Ratio`
	 * fields are multiples of one cell; `*Animation`/`spineKey` are the spine asset
	 * + track names; `sound` is the loop sfx name.
	 */
	anticipation?: AnticipationProfile;
}

/**
 * Per-field overrides for one spin profile — mirrors the engine's
 * `SpinningReelSpinOptions` (all optional; an unset field falls back to the
 * game's coded value). Speeds are px/ms; `reelSpinDelay` is ms of stagger per
 * reel; the `reelPaddingMultiplier*` scale the spin LENGTH.
 */
export interface ReelSpinProfile {
	reelPreSpinSpeed?: number;
	reelSpinSpeed?: number;
	reelSpinSpeedBeforeBounce?: number;
	reelBounceBackSpeed?: number;
	reelBounceSizeMulti?: number;
	reelSpinDelay?: number;
	reelPaddingMultiplierNormal?: number;
	reelPaddingMultiplierAnticipated?: number;
}

/**
 * Spin tuning split by profile: `normal` overrides the coded `SPIN_OPTIONS_DEFAULT`
 * (also used by anticipated spins), `fast` overrides `SPIN_OPTIONS_FAST` (turbo).
 */
export interface ReelSpinTuning {
	normal?: ReelSpinProfile;
	fast?: ReelSpinProfile;
}

/**
 * Per-field overrides for the free-spin anticipation overlay — mirrors a game's
 * coded `ANTICIPATION` config (all optional; an unset field falls back to the
 * coded value). The `*Ratio` fields are multiples of one cell; `spineKey` +
 * `*Animation` are the spine asset key and its track names; `sound` is the loop
 * sfx name.
 */
export interface AnticipationProfile {
	spineKey?: string;
	widthRatio?: number;
	heightRatio?: number;
	yOffsetRatio?: number;
	introAnimation?: string;
	loopAnimation?: string;
	outAnimation?: string;
	sound?: string;
}

export type LayoutNode =
	| ContainerNode
	| SpriteNode
	| SpineNode
	| TextNode
	| RectNode
	| ComponentInstanceNode
	| ReelGridNode;

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
	 * - `background` — full-bleed cover layer: nodes cover-fit the canvas via true
	 *   cover, the node's {@link BaseNode.coverScale} acting as the uniform cover
	 *   multiplier (default 1 = exact edge-to-edge) and `scale.x`/`scale.y` as the
	 *   free non-uniform stretch on top. For a static background image/spine;
	 *   animated multi-state crossfade stays coded.
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
	/**
	 * Game-lifecycle gate for the WHOLE screen: a key into the game's registered
	 * visibility feeds (the same `registerComponentVisibility` registry a component's
	 * `visibleSource` param binds to — see {@link VISIBILITY_SOURCE_KEYS}). When set AND
	 * the game registered a `BoolSource` for it, `<LayoutScene>` wraps the screen in a
	 * `<Container visible={…}>` so it shows ONLY while that state is active (e.g. a
	 * "Free-spin intro" screen bound to `freeSpinIntroShow` appears only during the
	 * intro, instead of always). Absent / unregistered ⇒ the screen renders always
	 * (today's behaviour). The editor keeps rendering the screen for authoring,
	 * regardless — the gate is a runtime concern. Mirrors the per-component gate so
	 * authored overlay content follows the round lifecycle without per-node wiring.
	 */
	visibleSource?: string;
	/**
	 * Author overrides for the engine-owned press-to-continue GATE that holds a blocking
	 * lifecycle moment (the free-spin intro/outro). The engine always owns the HOLD + the
	 * full-screen tap-catcher; these only restyle its dim + default prompt so the gate's
	 * LOOK is custom per game. Read by the game from the screen gated to the matching
	 * blocking `visibleSource`. All optional:
	 * - `dimColor` — full-window dim colour (hex int, default `0x000000`).
	 * - `dimAlpha` — dim opacity 0–1 (default `0.5`; `0` = no dim, draw your own in-screen).
	 * - `hidePrompt` — hide the default "press anywhere to continue" prompt so an authored
	 *   continue graphic in the screen stands in (the tap still resolves anywhere).
	 */
	gate?: {
		dimColor?: number;
		dimAlpha?: number;
		hidePrompt?: boolean;
	};
}

/** A jurisdiction preset for {@link GameSettings}. `'UK'` forces every speed
 * feature off (the UK Gambling Commission prohibits autoplay, turbo/quick spin and
 * player-led spin-stop on licensed slots), overriding the individual `features`. */
export type GameJurisdiction = 'default' | 'UK';

/**
 * Game-level UI settings authored in the editor's "Game Settings" — currently the
 * player-led SPEED feature toggles. The engine always SHIPS the turbo/autoplay/
 * space-hold machinery; these flags only decide whether its entry points are shown
 * (the "defang via config, never gut" rule). Absent ⇒ engine defaults (all on).
 * Applied at boot via `setUiFeatures` (see the game's `loadEditorScenes` consumer).
 */
export interface GameSettings {
	jurisdiction?: GameJurisdiction;
	features?: {
		turbo?: boolean;
		autoplay?: boolean;
		spaceHold?: boolean;
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
	/** Optional + additive game-level settings (speed-feature toggles / jurisdiction).
	 * Absent in older docs — the runtime falls back to the engine defaults. */
	settings?: GameSettings;
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
	/**
	 * The game's real board shape (reels × visible rows). The source of truth for
	 * validating an editor-authored {@link ReelGridNode}: `reels`/`rows` are
	 * RGS/data-coupled (the book delivers a fixed N×M result), so the editor warns
	 * when a `reelGrid` node diverges from this — they're descriptive, not yet
	 * runtime-driven. `cellSize` is the game's `SYMBOL_SIZE` — used to seed a
	 * converted `reelGrid` node so its `scale` (`cellSize / SYMBOL_SIZE`) is 1
	 * (board parity). Optional + additive — absent = no board-shape check.
	 */
	board?: { reels: number; rows: number; cellSize?: number };
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
	/**
	 * The coordinate space this component is authored + previewed in, mirroring a
	 * {@link Scene.space}. Absent ⇒ `'game'` (the default): nodes are in the host
	 * game's MAIN-box coords and the editor previews them through the same
	 * `<MainContainer>` map the runtime uses (so a component is WYSIWYG against the
	 * project's real main box, NOT a neutral 1920×1080 frame). Set `'canvas'` for a
	 * full-window OVERLAY (a free-spin intro dim, a modal scrim): nodes are raw
	 * window pixels and the editor previews them full-frame — matching a runtime
	 * `space:'canvas'` screen (no MainContainer). This is an authoring/preview hint;
	 * at runtime the component still inherits the host scene's space, so mount a
	 * `'canvas'` component inside a `space:'canvas'` screen for editor↔game parity.
	 */
	space?: Scene['space'];
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
	/**
	 * `image` is a STRING value (an atlas frame/region name) the editor renders with
	 * a region picker instead of a free-text box — bind a sprite's atlas-frame to it
	 * to swap art per instance. The engine resolves it exactly like a `string` region
	 * bind, so no runtime branch is needed; it's an editor input hint.
	 *
	 * `spine` / `spineAnimation` / `spineSlot` are likewise STRING values the editor
	 * renders as DROPDOWNS instead of free-text: `spine` lists the project's spine
	 * bundles; `spineAnimation` / `spineSlot` list the animations / slots of the bundle
	 * selected by a sibling `spine`-kind param (named in {@link ComponentParam.spineParam}).
	 * The engine resolves all three as plain strings — they're editor input hints, so
	 * existing readers ignore the new kinds.
	 */
	kind:
		| 'number'
		| 'string'
		| 'color'
		| 'boolean'
		| 'image'
		| 'spine'
		| 'spineAnimation'
		| 'spineSlot';
	default?: unknown;
	engineProvided?: boolean;
	/**
	 * For `spineAnimation` / `spineSlot` — the key of the sibling `spine`-kind param
	 * whose selected bundle's animations / slots populate this dropdown.
	 */
	spineParam?: string;
	/**
	 * Author-defined param — created by the user in the Component Editor (vs the
	 * component's built-in/coded params or an engine-catalog value). Only these are
	 * listed as removable in the editor's "Your params" UI, so the author can't
	 * accidentally delete a param a coded part depends on. Purely an editor hint.
	 */
	author?: boolean;
	/**
	 * Editor-only display grouping. When set, the editor shows this param inside a
	 * collapsible section titled `group` (e.g. all the params exposed from a text
	 * node named "Title"), so a component with several text objects edits each one's
	 * params independently. Ungrouped params render flat, as before.
	 */
	group?: string;
	/**
	 * Editor-only display name shown for this param INSIDE its `group` (e.g. `text`,
	 * `font`, `size`, `colour`), so grouped params read as plain field names while
	 * their `key` stays globally unique. Falls back to `key` when absent.
	 */
	label?: string;
	/**
	 * Closed set of allowed values (a string enum) — the editor renders a dropdown
	 * instead of a free text field wherever the param is set (the component's
	 * default + a placed instance's override). Used by the readout's `source`
	 * (`balance | win | bet | …`): the engine value feed the readout binds to, so
	 * the author picks from the registered sources rather than typing a name.
	 */
	options?: string[];
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
