/**
 * LayoutDoc — the document format the Invisible Editor produces and games consume.
 * Coords are authored in the base (`desktop`) main-layout space; per-layoutType
 * sparse overrides reposition/rescale nodes for other form factors. Same mental
 * model as utils-layout's `mainSizesMap` (uniform scale per layoutType).
 */
import type { LayoutProfile } from 'constants-shared/layoutProfile';

/**
 * A layout bucket id. Historically a closed union (`desktop`/`tablet`/`landscape`/
 * `portrait`); now a `string` because the bucket set is author-defined via
 * `LayoutProfile` (`constants-shared/layoutProfile`). The four legacy ids remain the
 * DEFAULT profile's ids, so existing docs keyed by them are unaffected. Enumerate
 * buckets from the resolved profile at runtime — never a hand-copied literal array.
 */
export type LayoutType = string;

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
	/**
	 * Per-layoutType TEXT-STYLE override for a {@link TextNode} — a sparse patch merged onto
	 * the node's base `style` for THIS layoutType (so e.g. a headline can shrink its
	 * `fontSize` in `portrait` without a stretchy `scale`). Any omitted field falls through
	 * to the base style. Resolved by {@link resolveOverrideTextStyle}, applied by both the
	 * runtime (`<LayoutNodeView>`'s `resolvedStyle`) and the editor (`EditorTextLayer`), so
	 * the two surfaces agree. For a text node whose style is param-bound (a Text Box), the
	 * bound param wins — vary it per-layout via {@link NodeOverride.params} instead. Ignored
	 * for non-text nodes. Absent ⇒ the base style (parity).
	 */
	style?: Partial<TextStyle>;
	/**
	 * Per-layoutType COMPONENT-PARAM override for a {@link ComponentInstanceNode} — a sparse
	 * patch merged onto the instance's base `params` for THIS layoutType (so a Text Box's
	 * `fontSize`/`boxWidth`/`align`/`fill`, or ANY component param, can differ per screen
	 * ratio). Keys present here win over the base `params` for that layoutType; a live engine
	 * feed (a count-up `value`, a spin/stop `label`) still wins over both. Merged by
	 * {@link resolveLayoutInstanceParams} (editor render) and overlaid reactively in
	 * `<ComponentInstance>` (runtime), so rotating the device re-resolves them. Ignored for
	 * non-componentInstance nodes. Absent ⇒ the base params (parity).
	 */
	params?: Record<string, unknown>;
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
	 * Per-node opt-in to true cover-fit (aspect-preserving fill to the canvas/window)
	 * for a sprite/spine node in a normal `canvas`-space (flow-gated) scene — the SAME
	 * cover math the `background` space applies ({@link coverTransform} +
	 * {@link BaseNode.coverScale}/{@link BaseNode.fit}/`scale` stretch), but WITHOUT the
	 * always-on persistent-background mounting of `Scene.space === 'background'`. So a
	 * flow screen (free-spin intro, etc.) can host a full-screen stretched animation that
	 * the flow still shows/hides. Orthogonal to `background` space (a `coverFit` node is
	 * NOT persistent). Ignored for a `background`-space node (that already covers) and for
	 * non-sprite/spine kinds. Additive — absent = today's authored transform (parity).
	 */
	coverFit?: boolean;
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
	/**
	 * Per-node press route inside a `componentInstance` (the two-button dialog primitive). When set,
	 * this node becomes an interactive hit surface whose press calls the owning instance's action of
	 * the SAME name — the instance's `actions` prop / injected binding (e.g. a confirm-dialog's
	 * `confirm`/`cancel` buttons each name their action here). Routed via the component-press context
	 * `<ComponentInstance>` provides, so it works ONLY inside a component expansion; a top-level scene
	 * node (no provider) or an instance with no matching action ⇒ inert (parity — byte-identical to
	 * today). The generalisation of the whole-instance `onSelect` press to N named press regions.
	 */
	pressAction?: string;
	/**
	 * Reveal gate (Invisible Flow — intro-complete sequencing). When set, this node starts HIDDEN
	 * and becomes visible only once the named component-scoped signal has FIRED for this instance —
	 * so a "free spin amount" text or a tap prompt appears only AFTER a sibling spine's one-shot
	 * completes (its {@link SpineCue.completeSignal}). The signal may also be a declared component
	 * signal (e.g. `enter`, `win`). Re-arms on each fresh mount (re-hides on the next free-spin
	 * entry). Only meaningful inside a `componentInstance` expansion (which provides the fired-signal
	 * context); a top-level scene node has no provider ⇒ always visible. Absent ⇒ always visible
	 * (parity — byte-identical to today).
	 */
	hiddenUntilSignal?: string;
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
	/**
	 * Author-named component-scoped signal FIRED when this cue's one-shot animation COMPLETES —
	 * the moment a non-looping cue (e.g. `enter → intro`) finishes and hands off to the resting
	 * loop. Sibling nodes can gate on it via {@link BaseNode.hiddenUntilSignal} (reveal the free-spin
	 * amount + a tap prompt only AFTER the intro plays), and a tap surface can arm on it
	 * (`tapArmAfterSignal`). Purely a NOTIFIER — it plays no animation itself. Absent ⇒ nothing is
	 * fired on completion (parity). Ignored for a looping cue (a loop has no single completion).
	 */
	completeSignal?: string;
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
	spinningHover?: SpineStateAnimation;
	spinningPressed?: SpineStateAnimation;
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
	/**
	 * Reveal-symbol rider — ride the chosen "reveal" symbol (`stateGame.specialSymbol`) on
	 * one of THIS spine's OWN bones, WITHOUT spawning a second rig or a bound component. When
	 * set to a bone name AND the game registered a `revealSymbolRider` bound component,
	 * `<LayoutNodeView>` mounts that rider on the named bone via `<SpineBoneAttach>` (the same
	 * bone-hosting mechanism {@link EffectNode.hostSpineId} uses for effects), so the special
	 * symbol banks/scales with the rig's animation. Lets an author place e.g. `R_Cage_Freespin`
	 * as a normal spine node and show the book symbol on its `Socket` bone — the on-node
	 * alternative to the rig-spawning `freeSpinIntroSymbolReveal` component. Absent ⇒ no rider
	 * mounts, byte-identical to today (parity). */
	revealSymbolBone?: string;
	/** Symbol state-machine state the rider renders in (e.g. `'bookIdle'`). Typed as string —
	 * the concrete `SymbolState` set is game-side. Absent ⇒ the rider's `'bookIdle'` default. */
	revealSymbolState?: string;
	/** Uniform scale of the ridden symbol, applied on the rider's own container. Absent ⇒ 1. */
	revealSymbolScale?: number;
	/** Pixel offset added to the bone position (spine-local space), forwarded to
	 * `<SpineBoneAttach offset>`. Absent ⇒ 0. */
	revealSymbolOffsetX?: number;
	revealSymbolOffsetY?: number;
	/** Rotate the ridden symbol with the bone's world rotation (`<SpineBoneAttach followRotation>`).
	 * Absent ⇒ true. */
	revealSymbolFollowRotation?: boolean;
	/** Scale the ridden symbol with the bone's world scale (`<SpineBoneAttach followScale>`).
	 * Absent ⇒ true. */
	revealSymbolFollowScale?: boolean;
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
	/**
	 * Vertical placement of the text block WITHIN a text box (a {@link TextNode} with an
	 * explicit `width`/`height`). Ignored for a box-less text node (nothing to align in).
	 * Absent ⇒ `'top'` (the block sits at the box top edge).
	 */
	verticalAlign?: 'top' | 'middle' | 'bottom';
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
	/**
	 * Optional TEXT BOX. When `width` (and optionally `height`) is set, the node becomes a
	 * fixed-area box: the glyphs lay out INSIDE it (horizontally via `style.align` across
	 * `width`, vertically via `style.verticalAlign` across `height`) and the editor's resize
	 * handles change THIS box — never `scale` — so a bitmap/web font is never stretched or
	 * pixelated. Both editor + runtime read them off the resolved transform (`resolveTransform`
	 * surfaces them, so they take per-layoutType overrides like a sprite/rect). Absent on both
	 * axes ⇒ auto-size: the box hugs the rendered text (legacy behaviour — parity).
	 * Local (pre-scale) pixels.
	 */
	width?: number;
	height?: number;
	/**
	 * Shrink the font so the text fits the box when it would otherwise overflow — never grows it
	 * past `style.fontSize`. Needs a `width`; `height` is optional (a width-only box fits a
	 * too-long single line, the localization case: a translated string is longer than the one the
	 * layout was drawn for). Absent ⇒ off (text may overflow the box; the box just positions it).
	 */
	autoFit?: boolean;
	/**
	 * Inset (local, pre-scale px) between the box edges and the text, applied on ALL sides.
	 * The content area the text wraps/aligns/auto-fits into is `width - 2·padding` wide and
	 * `height - 2·padding` tall. Only meaningful with an explicit box. Absent ⇒ 0.
	 */
	padding?: number;
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
	/**
	 * Per-instance overrides for a spine node's RESTING look — its
	 * {@link SpineNode.defaultAnimation} / {@link SpineNode.loop} /
	 * {@link SpineNode.skin} — keyed by the spine node's `id` in the resolved
	 * {@link ComponentDef.root} (the at-rest sibling of {@link stateAnimationOverrides}).
	 * Any field absent ⇒ inherit the def spine node's value, so two placements of one
	 * component can show a different resting pose. Provided to `<LayoutNodeView>` via
	 * `componentSpineRestContext`; absent ⇒ the def values are used verbatim (parity). */
	spineRestOverrides?: Record<string, SpineRestOverride>;
	/**
	 * Per-instance rebinding of WHICH engine signal drives a spine node's
	 * {@link SpineCue}s — keyed by the spine node's `id` in the resolved
	 * {@link ComponentDef.root} (the signal-feed sibling of {@link spineRestOverrides}).
	 * The inner map remaps a cue's ORIGINAL {@link SpineCue.signal} → the replacement
	 * engine-signal key, so two placements of one component can react to different
	 * signals (e.g. one cue driven by `win`, another copy by `bigWin`) without forking
	 * the def. Keyed by original signal (not cue index) so a spine carrying several
	 * cues remaps cleanly. A cue not listed (or no entry for the node) ⇒ its def signal
	 * is used verbatim, so an absent map is byte-identical to today (parity). Applied
	 * when `<ComponentInstance>` builds its cue → `SignalSource` subscriptions. */
	cueSignalOverrides?: Record<string, Record<string, string>>;
}

/** Per-instance overrides for a spine node's resting look (see
 * {@link ComponentInstanceNode.spineRestOverrides}). Any field absent ⇒ inherit
 * the def spine node's corresponding value. */
export interface SpineRestOverride {
	defaultAnimation?: string;
	loop?: boolean;
	skin?: string;
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
	 * Reel LEAD (horizontal) — where the FIRST column's centre is seated from the
	 * grid's left edge, in cell-size units (the `getSymbolX` `cellSize * (reelIndex +
	 * reelPadding)` lead term). `0.5` = symmetric (the reel cluster sits centred on
	 * the grid's position); the engine's coded baseline is `0.53`. This ONLY seats the
	 * reel cluster — it no longer doubles as a whole-board offset (that is now
	 * {@link boardNudgeX}) nor a per-cell art seat (that is now {@link symbolAlignX}),
	 * so changing it never moves the alignment and vice-versa. Absent = 0.5.
	 */
	reelPadding?: number;
	/**
	 * Row LEAD (vertical) — the analog of {@link reelPadding}: where the FIRST row's
	 * centre is seated from the grid's top edge, in cell-size units. `0.5` = symmetric.
	 * Absent = 0.5.
	 */
	rowPadding?: number;
	/**
	 * Per-cell SEAT ALIGNMENT — where a symbol's art sits WITHIN its own cell on each
	 * axis (`0` = top/left edge, `0.5` = centred, `1` = bottom/right edge). Fully
	 * independent of the lead ({@link reelPadding}/{@link rowPadding}), which seats the
	 * whole cluster: moving alignment never moves the cluster and vice-versa. Absent =
	 * 0.5 (centred = today's behaviour).
	 */
	symbolAlignX?: number;
	symbolAlignY?: number;
	/**
	 * Board NUDGE — a fine px offset of the WHOLE board (cells + mask + symbols move
	 * together), added on top of the node's transform position. Use it to align the
	 * live reels to fixed frame art. In the SAME units as the node's `transform.x`/`y`.
	 * Absent = 0 (no shift). This replaces the old hidden "reelPadding − baseline"
	 * board offset, so padding and board position are no longer entangled.
	 */
	boardNudgeX?: number;
	boardNudgeY?: number;
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

/**
 * A placed Invisible FX particle effect (design `invisible-fx.md` §4.4 / `invisible-editor.md`).
 * References an authored `EffectDoc` by `effectId` (its file stem in `<client>/<project>/<id>.fx.json`,
 * the same id the `/api/editor/effects` picker lists). At runtime `LayoutNodeView` mounts an
 * `<EffectPlayer>` for the resolved doc INSIDE this node's transform `<Container>`, so the effect
 * plays at the placed position (the layer's own `placement.offset` composes on top). The effect doc
 * itself ships via the FX export chain (`bakedEffects()` → `registerEffects()`), so the node carries
 * only the id + placement — never the layers.
 *
 * v1 constraint: a scene-placed effect is for FREE-layer effects. A `bone`-placed layer needs a host
 * `<SpineProvider>` a scene node doesn't provide (it falls back to origin+offset); bone effects are
 * mounted on their host rig via the game's `components/Effects.svelte` path instead.
 *
 * The editor can't run a WebGL emitter in its 2D canvas (same as `reelGrid`/`bind`), so it draws a
 * labelled placeholder chip; the game ALWAYS mounts the real `<EffectPlayer>`.
 */
export interface EffectNode extends BaseNode {
	kind: 'effect';
	/** The authored effect's id (file stem of its `.fx.json`), resolved via `registerEffects`. */
	effectId: string;
	/**
	 * Optional — the `id` of a placed SPINE node in the SAME scene this effect ATTACHES to. When set
	 * (and the target spine exists), the effect is mounted INSIDE that rig's `<SpineProvider>` instead
	 * of at its own scene position, so a `placement.space:'bone'` layer rides that specific rig's bone
	 * and the rig's animation-timeline events (rebroadcast — `BaseSpineProvider.rebroadcastEvents`) fire
	 * the effect on the beat. The effect then RIDES the rig (its own node transform is ignored at
	 * runtime; the rig drives position). Absent / dangling ⇒ a normal scene-placed effect at its
	 * transform. `LayoutScene` does the pairing; only top-level scene nodes participate.
	 */
	hostSpineId?: string;
}

/** How a {@link RepeaterNode} arranges its per-item instances. */
export interface RepeaterLayout {
	/** `row` lays every item out along +x; `grid` wraps to a new row every `columns` items. */
	direction: 'row' | 'grid';
	/** Pixel gap ADDED between adjacent items (both axes for a grid). */
	gap: number;
	/** Grid only — items per row before wrapping to the next row. Ignored for `row`. */
	columns?: number;
}

/**
 * A data-driven REPEATER (the buy-feature / select-feature primitive). Resolves `source`
 * to a live array via the {@link import('./registerRepeaterSources').RepeaterSource} registry
 * (the game registers it at boot, exactly like a value/action feed) and renders ONE
 * {@link ComponentInstanceNode} of `componentId` per item, offset by the `layout` rule. Each
 * item feeds its OWN `engineProvided` param values into its instance (so one prefab renders N
 * cards with different title/price/icon) and wires that instance's `select` press to the item's
 * `onSelect` callback. The def itself carries only the id + layout — never the per-item data.
 *
 * The editor can't run the live source in its 2D canvas (same as `reelGrid`/`bind`/`effect`), so
 * it draws a labelled placeholder; the game ALWAYS mounts the real per-item instances. Additive —
 * a doc that carries no `repeater` node is byte-identical to today (parity).
 */
export interface RepeaterNode extends BaseNode {
	kind: 'repeater';
	/** Registered repeater-source key (see `registerRepeaterSources`) → the live item array. */
	source: string;
	/** The {@link ComponentDef} each item instantiates (collected onto the bake/pull chain). */
	componentId: string;
	/** How the per-item instances are arranged. */
	layout: RepeaterLayout;
}

export type LayoutNode =
	| ContainerNode
	| SpriteNode
	| SpineNode
	| TextNode
	| RectNode
	| ComponentInstanceNode
	| ReelGridNode
	| EffectNode
	| RepeaterNode;

export interface Scene {
	id: string;
	name: string;
	nodes: LayoutNode[];
	/**
	 * The engine ROLE this scene fills — the id-independent identity the game boot resolves
	 * behaviour by, so scene ids stay free-form / renameable. The game reads e.g. the
	 * loading splash and the persistent base scene by `role`, NOT by matching a magic id.
	 * - `loading` — the loading splash (its authored nodes become the splash visual; the
	 *   coded logo/progress is suppressed). One per doc.
	 * - `basegame` — the persistent base scene (the reel-split mount / offline fallback).
	 * - `buyFeature` — the buy-bonus SELECT menu, mounted by the `<BuyFeatureScreen>` takeover
	 *   (gated on the buy modal), so an owner can tag any authored scene as THE buy screen
	 *   without matching the magic `buyFeature` id. One per doc.
	 * - `buyConfirm` — the buy-bonus CONFIRM dialog, mounted by the `<BuyBonusConfirm>` takeover.
	 * Resolution order at boot: the flow's `initial`/`start` node (when a FlowDoc is loaded)
	 * → the scene with this `role` → the legacy scene whose `id` equals the role name
	 * (parity for un-migrated docs). Absent ⇒ falls back to the legacy id match, so a doc
	 * with no roles boots byte-identically to today. Additive.
	 */
	role?: 'loading' | 'basegame' | 'buyFeature' | 'buyConfirm';
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
	 * Pin this screen ABOVE every doc-ordered layer instead of reading its z from the
	 * screen-list position ({@link sceneLayerZIndex}). The editor exposes it as the
	 * "Always on top" tick in a screen's Properties.
	 *
	 * Absent (the default) ⇒ the screen layers by its position in the doc `scenes[]`
	 * array, so dragging it in the Screens list re-stacks it in-game. Set ⇒ it mounts at
	 * the fixed `LAYER_BAND_TAKEOVER` band, above every layerable screen and below the
	 * engine-owned top band (the round-blocking gates), and its list position no longer
	 * affects it — for a transient overlay that must never be buried (a boot splash, a
	 * big-win celebration).
	 *
	 * This replaces the old hard-coded rule that EVERY flow-active "takeover" screen
	 * mounted at the fixed band, which made a persistent authored screen (e.g. a progress
	 * bar) impossible to re-layer from the editor and gave no clue why.
	 */
	alwaysOnTop?: boolean;
	/**
	 * Mount this screen BEHIND the engine's reel board — in front of the background, under the
	 * reels. The editor exposes it as the "Behind the reels" tick in a screen's Properties.
	 *
	 * The list-ordered band sits entirely ABOVE the board (which is engine-owned at the implicit
	 * z 0 and is NOT itself layerable), so a screen's list position alone can never put it under
	 * the reels — dragging an overlay above the `basegame` row looks like it should, and does
	 * nothing. This tick is the only way to express it. Screens in the under-reel band still
	 * order among themselves by list position.
	 *
	 * Ignored when {@link Scene.alwaysOnTop} is also set (contradictory; the editor keeps the two
	 * mutually exclusive). Absent (the default) ⇒ the screen layers above the board as before.
	 */
	behindReels?: boolean;
	/**
	 * Make this screen ZOOM + PAN in lockstep with the reel-anticipation camera
	 * (`docs/design/reel-anticipation.md`). The editor exposes it as the "Zoom with
	 * anticipation" tick in a screen's Properties.
	 *
	 * When set AND the game has registered a camera-transform source
	 * ({@link registerSceneCameraTransform}) AND this scene is `game` space, `<LayoutScene>`
	 * wraps the screen's content INSIDE its `MainContainer` with the SAME scale + pan-about-focal
	 * transform the reel camera applies — so a "base game top / bottom" screen zooms toward the
	 * SAME reel centre as the board during an anticipation, not on an independent path. The
	 * transform is published once by the game and read by both the reel camera and every opted-in
	 * screen (one coherent camera move).
	 *
	 * Only `game`-space scenes zoom (they share the board's `MainContainer` coordinate space, so
	 * the focal point lines up); `standard`/`canvas`/`background` screens ignore it. Absent (the
	 * default) ⇒ NO wrapper is added — byte-identical to today. Off by default: with anticipation
	 * off, or no source registered, the transform is identity so an opted-in screen still renders
	 * unchanged. Sparse: stored only when true.
	 */
	zoomWithAnticipation?: boolean;
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
	/**
	 * Optional per-project LAYOUT PROFILE override — the author-defined bucket set +
	 * selection rules (`constants-shared/layoutProfile`). Absent ⇒ the project inherits
	 * the admin global default, else the coded {@link DEFAULT_LAYOUT_PROFILE}. Stored
	 * sparse: the editor omits it when it equals the resolved default. Bucket ids here
	 * key this doc's `mainSizesMap` and every node's `overrides`. */
	layoutProfile?: LayoutProfile;
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
	/**
	 * Per-instance param values seeded onto a freshly DROPPED instance (the editor's
	 * `placeComponentInstance`). Unlike a {@link ComponentParam.default} (which lives on the
	 * def and is merged at resolve), these are written onto the new `node.params` so the
	 * placement starts with a SHARED-capability param turned on — e.g. the `loadingBar` def
	 * carries `{ completeOnLoaded: true }` so dropping it = a flow-driven loading screen with
	 * no extra clicks. Keys here are NOT declared in `params` (so the editor still surfaces
	 * the shared `completeOnLoaded` control); they're an authoring convenience. Absent ⇒ a
	 * bare instance (parity) — only `loadingBar` sets it.
	 */
	defaultInstanceParams?: Record<string, unknown>;
	/** Named triggers the engine fires (enter/exit/win/…). */
	signals?: ComponentSignal[];
	/** A component may expose its own slots. */
	slots?: TemplateSlot[];
	// tracks?: BehaviorTrack[]  // RESERVED for v2 authored-behavior timeline (§8.5) — NOT in v1
}

/**
 * Every `ComponentParam.kind`, as a VALUE — the one list, which {@link ComponentParam.kind}
 * derives its type from.
 *
 * It is a value and not just a union because the launcher's saved-def validator
 * (`componentStorage.ts`) needs to check kinds at runtime, and a hand-copied allowlist there
 * has silently STRIPPED author data twice: once dropping the FS-intro/outro defs'
 * `spine`/`spineAnimation`/`spineSlot`, and again for `spineBone` (so forking the book-reveal
 * def lost its `symbolBone`). A copy can't drift if there's nothing to copy — the validator
 * imports this array. Note the launcher has NO type-check step (`build` is a bare
 * `vite build`, no `svelte-check`), so a compile-time-only guard would not have caught either.
 *
 * All kinds are STRING values at runtime except `number`/`boolean`/`color`; the extra kinds are
 * EDITOR INPUT HINTS, so existing readers can ignore them:
 * - `image` — an atlas frame/region name, rendered with a region picker.
 * - `spine` — lists the project's spine bundles.
 * - `spineAnimation` / `spineSlot` / `spineBone` — list the animations / slots / bones of the
 *   bundle selected by a sibling `spine`-kind param (named in {@link ComponentParam.spineParam}).
 * - `symbolState` — the fixed `SYMBOL_STATES` set (./symbolStates) the Invisible Symbols State
 *   Machine authors as its grid columns.
 */
export const COMPONENT_PARAM_KINDS = [
	'number',
	'string',
	'color',
	'boolean',
	'image',
	'spine',
	'spineAnimation',
	'spineSlot',
	'spineBone',
	'symbolState',
] as const;

/**
 * A typed input on a {@link ComponentDef}. `engineProvided` declares (without
 * implementing) that the engine supplies the value at runtime — the
 * `declare ≠ implement` bridge (§8.5).
 */
export interface ComponentParam {
	key: string;
	/** See {@link COMPONENT_PARAM_KINDS} for what each kind renders as. */
	kind: (typeof COMPONENT_PARAM_KINDS)[number];
	default?: unknown;
	engineProvided?: boolean;
	/**
	 * For `spineAnimation` / `spineSlot` / `spineBone` — the key of the sibling `spine`-kind
	 * param whose selected bundle's animations / slots / bones populate this dropdown.
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

/**
 * An Invisible Cinematic document — a non-linear SEQUENCER over several rigs, authored in
 * `/rigger`'s Cinematic mode and played in-game by the `<Cinematic>` component.
 * Plan: `docs/design/invisible-cinematic.md`.
 *
 * Deliberately structural rather than exhaustive: track kinds beyond `animation` / `property` /
 * `camera` are additive, and the evaluator already SKIPS anything it cannot resolve. A stricter
 * type here would reject a document authored by a newer tool for no gain — the same reasoning as
 * the server-side `isCinematicDoc` shape guard.
 */
export interface CinematicCast {
	actorId: string;
	/** The rig's folder under `<project>/spines/` — the STABLE identity, and the spine bundle
	 *  name the game registers. Never the skeleton index's positional `id`. */
	rigFolder?: string;
	rigId?: string | number;
	rigName?: string;
	/** Scene node this actor binds to, when the cinematic is staged over a Scene (design §4.1). */
	nodeId?: string | null;
	place: Record<string, number | boolean>;
	z?: number;
	visible?: boolean;
}

export interface CinematicDoc {
	schemaVersion: number;
	id: string;
	name: string;
	/** Seconds. */
	duration: number;
	/** Snap grid only — evaluation is continuous. */
	fps: number;
	stage: { sceneId: string | null; cast: CinematicCast[] };
	tracks: Array<Record<string, unknown>>;
	markers: Array<Record<string, unknown>>;
}
