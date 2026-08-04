import { BUILTIN_REGION } from './builtinRegions';
import { BUTTON_STATE_IMAGE_PARAMS } from './buttonStateImage';
import { TEXT_SOURCE_KEYS, VALUE_SOURCE_KEYS, VISIBILITY_SOURCE_KEYS } from './componentCatalog';
import type { ComponentDef, ComponentParam, LayoutNode } from './types';

/**
 * Built-in component defs — the code path that makes a {@link ComponentDef}
 * available with no R2 doc (§14.1 / §14.2 B4.1). Symmetric with the built-in
 * GAME TEMPLATES (`templates/index.ts`): the launcher lists these as the
 * lowest-precedence layer (built-in ◁ shared R2 ◁ project R2), so every
 * project's Component Editor lists them and the scene editor can resolve an
 * instance even before anyone authors an R2 override. The game registers them
 * at boot via `registerComponents`.
 *
 * Svelte-free PLAIN DATA — re-exported from the bare `engine-layout` (type-only)
 * entry, so the launcher (which has no pixi-svelte) can import them.
 */

/**
 * `proxima-nova` — the font the coded HUD labels render (`UiLabel.svelte`
 * `baseStyle.fontFamily`). Used as the `fontFamily` param default so a
 * `HudReadout` placed in the editor previews — and later renders in-game —
 * with the same family the live HUD uses.
 */
const HUD_FONT_FAMILY = 'proxima-nova';

/** Mirrors `components-ui-pixi` `UI_BASE_FONT_SIZE` (`UI_BASE_SIZE 150 * 0.3`). */
const HUD_VALUE_FONT_SIZE = 45;
/** A smaller caption above the value, so the readout reads label-over-number. */
const HUD_CAPTION_FONT_SIZE = 30;
/** White (`constants-shared` `WHITE`), the coded label fill. */
const HUD_FILL = 0xffffff;
/**
 * The readout's background TICKER width (`HudTicker` draws its `UiSprite` at
 * `UI_BASE_FONT_SIZE * 3 * 326/73`). Used as the default `alignWidth` — the box the
 * caption/value text aligns WITHIN — so `align: left`/`right` push the text to the
 * background's edges out of the box. A readout with a wider/narrower custom background
 * just overrides `alignWidth` to its own width.
 */
const HUD_ALIGN_WIDTH = Math.round(HUD_VALUE_FONT_SIZE * 3 * (326 / 73));

/**
 * The single parametric HUD readout (§14.1) — one def instanced three ways
 * (balance / win / bet) by its `source` param.
 *
 * SEPARATE CODED PARTS path (§14.3, owner-chosen 2026-06-09): `root` is a
 * local-space container whose THREE children each `bind` a small coded part —
 * `HudTicker` (Background tile), `HudCaption` (localized caption Text), `HudValue`
 * (currency value Text + count-up + bet tap) — all registered via
 * `registerBoundComponents`. The split keeps the PROVEN coded rendering (no new
 * format contract: the value part keeps the coded currency formatter), but makes
 * each part its OWN editable node the author can move / restyle / hide / delete,
 * with room to add new nodes around them. All three read the SAME params
 * (`source`/`label`/`fill`/`fontSize`/`fontFamily`/`countUp`/`value`) off the param
 * context that `<ComponentInstance>` provides — they flow through the context, not
 * via text `paramBindings`.
 *
 * The three children's positions RECREATE `UiLabel`'s stacked+tiled layout so the
 * live render is unchanged: tile at `y:-20`, caption at `y:0`, value at
 * `y:HUD_VALUE_FONT_SIZE` (45 = `UI_BASE_FONT_SIZE`), all `anchor {0.5,0}`.
 */
export const HUD_READOUT_DEF: ComponentDef = {
	id: 'hudReadout',
	name: 'HUD Readout',
	version: 3,
	scope: 'shared',
	category: 'ui',
	root: {
		id: 'hudReadout-root',
		kind: 'container',
		x: 0,
		y: 0,
		children: [
			{
				id: 'hudReadout-bg',
				label: 'Background',
				kind: 'container',
				x: 0,
				y: -20,
				anchor: { x: 0.5, y: 0 },
				bind: { component: 'HudTicker' },
				// Tile ONLY (no caption/value text) — the caption + value are their own
				// sibling parts below, so this draws just the ticker background.
				preview: { w: HUD_CAPTION_FONT_SIZE * 8, h: HUD_VALUE_FONT_SIZE * 3, style: 'tile' },
				children: [],
			},
			{
				id: 'hudReadout-caption',
				label: 'Caption',
				kind: 'container',
				x: 0,
				y: 0,
				anchor: { x: 0.5, y: 0 },
				bind: { component: 'HudCaption' },
				// Editor preview shows the resolved `label` param ("BALANCE"), not "Caption".
				preview: { style: 'text', textParam: 'label' },
				children: [],
			},
			{
				id: 'hudReadout-value',
				label: 'Value',
				kind: 'container',
				x: 0,
				y: HUD_VALUE_FONT_SIZE,
				anchor: { x: 0.5, y: 0 },
				bind: { component: 'HudValue' },
				// Editor preview shows the resolved `value` (engine-fed; 0 until placed).
				preview: { style: 'text', textParam: 'value' },
				children: [],
			},
		],
	},
	params: [
		// The engine value feed this readout binds to — picked from the registered
		// sources (editor renders `options` as a dropdown), not typed by hand.
		{ key: 'source', kind: 'string', options: VALUE_SOURCE_KEYS },
		{ key: 'label', kind: 'string', default: 'BALANCE' },
		// SHARED style — the base applied to BOTH the Caption and Value texts. Each text
		// can override any of these independently through its own collapsible group below.
		{ key: 'fill', kind: 'color', default: HUD_FILL },
		{ key: 'fontSize', kind: 'number', default: HUD_VALUE_FONT_SIZE },
		{ key: 'fontFamily', kind: 'string', default: HUD_FONT_FAMILY },
		{ key: 'countUp', kind: 'boolean', default: false },
		// PER-TEXT overrides (v2) — the readout draws two texts (Caption + Value) as
		// separate coded parts (`HudCaption`/`HudValue`); these let each be styled on its
		// own. NO default so an unset field INHERITS the shared style above (the coded
		// parts read `caption*`/`value*` ?? the shared key ?? the coded base). `group`
		// renders each set as a collapsible section in the instance editor; `label:'font'`
		// makes the family field a font dropdown (see `fontParamKeysOf`).
		{ key: 'captionFill', kind: 'color', group: 'Caption', label: 'fill' },
		{ key: 'captionFontSize', kind: 'number', group: 'Caption', label: 'size' },
		{ key: 'captionFontFamily', kind: 'string', group: 'Caption', label: 'font' },
		{
			key: 'captionAlign',
			kind: 'string',
			group: 'Caption',
			label: 'align',
			options: ['left', 'center', 'right'],
		},
		{ key: 'valueFill', kind: 'color', group: 'Value', label: 'fill' },
		{ key: 'valueFontSize', kind: 'number', group: 'Value', label: 'size' },
		{ key: 'valueFontFamily', kind: 'string', group: 'Value', label: 'font' },
		{
			key: 'valueAlign',
			kind: 'string',
			group: 'Value',
			label: 'align',
			options: ['left', 'center', 'right'],
		},
		// The box (px) the caption/value text aligns WITHIN — `align: left`/`right`
		// push the text to this box's edges (centred on the readout origin), so it hugs
		// the background with no manual positioning. Defaults to the coded ticker width;
		// override to a custom background's width. `align` unset ⇒ inherit the node's
		// manual transform anchor (back-compat), and `alignWidth` is ignored.
		{ key: 'alignWidth', kind: 'number', default: HUD_ALIGN_WIDTH, label: 'align width (px)' },
		{ key: 'value', kind: 'number', engineProvided: true },
	],
};

/** Mirrors `components-ui-pixi` `UI_BASE_SIZE` — the coded button frame's square px. */
const BUTTON_BASE_SIZE = 150;
/** `UiButton`'s label size (`UI_BASE_FONT_SIZE 45 * 0.9`). */
const BUTTON_FONT_SIZE = 40.5;

/**
 * The single parametric HUD button (§16.2) — one def instanced per HUD button
 * (spin/bet, menu, buy-bonus, auto-spin, turbo, bet +/−) by its `action` param.
 * The button analogue of {@link HUD_READOUT_DEF}: where the readout binds a
 * `value`, the button binds an `action`.
 *
 * SEPARATE CODED PARTS path (§16.2, owner-chosen 2026-06-09, mirroring B5's §14.3):
 * `root` is a local-space container whose TWO children each `bind` a small coded
 * part — `ButtonFrame` (the `UiSprite` tile AND the hit area: variant bg, active
 * border, disabled-grey, tint, `onpointerup` → the action) and `ButtonLabel` (the
 * localized icon/label `Text`) — both registered via `registerBoundComponents`. The
 * split keeps the PROVEN coded rendering but makes each part its OWN editable node
 * the author can move / restyle / hide / delete. Both read the SAME params off the
 * param context that `<ComponentInstance>` provides — they flow through the context,
 * not via text `paramBindings`.
 *
 * Both children RECREATE `UiButton`'s centred layout so the live render is unchanged:
 * frame and label both at `x:0,y:0`, anchor `{0.5,0.5}` — the label sits centred over
 * the frame, exactly as `UiButton` stacks its `UiSprite` and `Text` (both `{...center}
 * anchor={0.5}`).
 *
 * `disabled`/`active` are `engineProvided` (the action feed's `disabled`/`active`
 * stores arrive via `registerComponentActions` in B6.2); `action` is the behaviour
 * binding the engine resolves to an `onpress`. No HUD references this def yet (B6.1
 * is def + parts + registration only), so the game renders byte-identically.
 */
export const BUTTON_DEF: ComponentDef = {
	id: 'button',
	name: 'Button',
	version: 1,
	scope: 'shared',
	category: 'ui',
	root: {
		id: 'button-root',
		kind: 'container',
		x: 0,
		y: 0,
		children: [
			{
				id: 'button-frame',
				label: 'Frame',
				kind: 'container',
				x: 0,
				y: 0,
				anchor: { x: 0.5, y: 0.5 },
				bind: { component: 'ButtonFrame' },
				preview: { w: BUTTON_BASE_SIZE, h: BUTTON_BASE_SIZE, style: 'button' },
				children: [],
			},
			{
				id: 'button-label',
				label: 'Label',
				kind: 'container',
				x: 0,
				y: 0,
				anchor: { x: 0.5, y: 0.5 },
				bind: { component: 'ButtonLabel' },
				preview: { style: 'text' },
				children: [],
			},
		],
	},
	params: [
		{ key: 'action', kind: 'string' },
		{ key: 'icon', kind: 'string' },
		{ key: 'label', kind: 'string' },
		// The button's already-declared look (`UiButton`): dark/light bg + text.
		{ key: 'variant', kind: 'string', default: 'dark', options: ['dark', 'light'] },
		{ key: 'tint', kind: 'color', default: HUD_FILL },
		{ key: 'fontSize', kind: 'number', default: BUTTON_FONT_SIZE },
		{ key: 'fill', kind: 'color', default: HUD_FILL },
		{ key: 'fontFamily', kind: 'string', default: HUD_FONT_FAMILY },
		// Per-state background IMAGES (atlas frame names — `kind: 'image'` renders the
		// editor's region picker). `ButtonFrame` swaps its bg by interaction state:
		// `image` is the resting look, `imageSelected` shows while the engine `active`
		// flag is on, `imageDisabled` is the downstate (engine `disabled` flag), a missing
		// `imagePressed` falls back to `imageHover` then `image`, and while the engine
		// `spinning` flag is on the button renders `imageSpinning` (rotated) — the live
		// SLAM-STOP frame — with its own `imageSpinningHover`/`imageSpinningPressed`
		// feedback (each falling back to `imageSpinning`). All absent ⇒ the coded variant
		// tile renders unchanged (parity). DERIVED from the shared source-of-truth so this
		// def, the picker (`BUTTON_STATE_PARAMS`) and the cascade key list can't drift.
		...BUTTON_STATE_IMAGE_PARAMS.map(
			(p): ComponentParam => ({
				key: p.key,
				kind: 'image',
				group: 'State images',
				label: p.label,
			}),
		),
		{ key: 'disabled', kind: 'boolean', engineProvided: true },
		{ key: 'active', kind: 'boolean', engineProvided: true },
		{ key: 'spinning', kind: 'boolean', engineProvided: true },
	],
};

/** The default `textBox` body size — readable at HUD scale without dwarfing it. */
const TEXT_BOX_FONT_SIZE = 32;

/**
 * The single reusable TEXT BOX (§18) — ONE def for every text field in a game.
 * Its `text` param is a literal string OR a localization key (the engine's
 * registered text resolver translates known keys at render — see
 * `registerTextResolver`), and its optional `source` param binds the SAME
 * instance to a live engine value feed (clock/balance/player name/…): when a
 * source is registered, `<ComponentInstance>` overrides the `text` param with
 * the live value — numbers route through the formatted/count-up readout path,
 * strings render as text. So static captions, localized labels and dynamic
 * readouts are all instances of this one component, restyled per instance via
 * the font/size/fill params.
 */
export const TEXT_BOX_DEF: ComponentDef = {
	id: 'textBox',
	name: 'Text Box',
	version: 1,
	scope: 'shared',
	category: 'ui',
	root: {
		id: 'textBox-root',
		kind: 'container',
		x: 0,
		y: 0,
		children: [
			{
				id: 'textBox-text',
				label: 'Text',
				kind: 'text',
				x: 0,
				y: 0,
				anchor: { x: 0.5, y: 0.5 },
				text: 'Text',
				style: { fontFamily: HUD_FONT_FAMILY, fontSize: TEXT_BOX_FONT_SIZE, fill: HUD_FILL },
				paramBindings: {
					text: 'text',
					'style.fontFamily': 'fontFamily',
					'style.fontSize': 'fontSize',
					'style.fill': 'fill',
					// Text-box layout (§text-box model): a boxWidth turns the node into a fixed box
					// the glyphs align inside (H via align across width, V via verticalAlign across
					// height), auto-shrinking the font when autoFit — per instance. Unset boxWidth ⇒
					// auto-size (byte-identical to a plain readout — parity).
					'style.align': 'align',
					'style.verticalAlign': 'verticalAlign',
					width: 'boxWidth',
					height: 'boxHeight',
					autoFit: 'autoFit',
				},
			},
		],
	},
	params: [
		{ key: 'text', kind: 'string', default: 'Text', label: 'text (or localization key)' },
		{ key: 'source', kind: 'string', options: TEXT_SOURCE_KEYS, label: 'live value source' },
		{ key: 'fontFamily', kind: 'string', default: HUD_FONT_FAMILY },
		{ key: 'fontSize', kind: 'number', default: TEXT_BOX_FONT_SIZE },
		{ key: 'fill', kind: 'color', default: HUD_FILL },
		{ key: 'countUp', kind: 'boolean', default: false },
		{ key: 'align', kind: 'string', options: ['left', 'center', 'right'], label: 'align' },
		{
			key: 'verticalAlign',
			kind: 'string',
			options: ['top', 'middle', 'bottom'],
			label: 'vertical align',
		},
		{ key: 'boxWidth', kind: 'number', label: 'box width (blank = fit text)' },
		{ key: 'boxHeight', kind: 'number', label: 'box height (blank = fit text)' },
		{
			key: 'autoFit',
			kind: 'boolean',
			default: false,
			label: 'auto-fit font to box (needs box w+h)',
		},
		{ key: 'value', kind: 'number', engineProvided: true },
	],
};

/**
 * The free-spin counter panel (`apps/lines` `FreeSpinCounter.svelte`) as an
 * editor-visible/editable component (mirrors the §14.3 HUD-readout decomposition).
 * This is the LIVE in-game render: the `freeSpinCounter` scene carries a
 * `componentInstance` of this def (`referenceLayouts/lines.ts`, Borut's editor
 * doc), fed `value` from the game's `freeSpins` string source and gated on the
 * `freeSpinCounterShow` bool source. The coded `FreeSpinCounter` stays registered
 * as a fallback but is no longer referenced by the reference layouts.
 *
 * PLAIN-NODE path (NOT the HUD's separate-coded-parts path): `root` is a
 * local-space container with three EDITOR-NATIVE children —
 * - a real `kind:'sprite'` Frame (`Frame_FSCounter.png`), sized to the coded panel
 *   (`SYMBOL_SIZE*2` wide at the 824/622 ratio), which renders directly in the
 *   editor and stays draggable/resizable with no coded part;
 * - a `kind:'text'` Caption ("FREE SPIN", static);
 * - a `kind:'text'` Value bound (`paramBindings.text → 'value'`) to the
 *   engine-fed string source, so it shows "X OF Y" verbatim.
 *
 * Why plain text over reusing `HudCaption`/`HudValue`: `HudValue` is hardwired to a
 * NUMERIC currency formatter so it can't render the "X OF Y" string at all, whereas
 * plain text nodes are fully editor-native + directly editable (the owner-preferred
 * path) and correctly express the string value. The `gold` bitmap font renders at
 * parity because `LayoutNodeView`'s text path now emits `<BitmapText>` for any
 * `style.fontFamily` the boot-registered font catalog marks as a bitmap font (§9.4),
 * exactly as the coded `FreeSpinCounter` did.
 */
const FS_PANEL_RATIO = 824 / 622;
/** Coded panel width (`SYMBOL_SIZE*2`, SYMBOL_SIZE = 120). */
const FS_PANEL_WIDTH = 240;
/** Coded panel height (`width / ratio`). */
const FS_PANEL_HEIGHT = FS_PANEL_WIDTH / FS_PANEL_RATIO;
/** Coded label size (`SYMBOL_SIZE * 0.275`). */
const FS_FONT_SIZE = 33;
/** The bitmap font the coded counter renders (`<BitmapText fontFamily='gold'>`). */
const FS_FONT_FAMILY = 'gold';

export const FREE_SPIN_COUNTER_DEF: ComponentDef = {
	id: 'freeSpinCounter',
	name: 'Free-Spin Counter',
	version: 1,
	scope: 'shared',
	category: 'ui',
	root: {
		id: 'freeSpinCounter-root',
		kind: 'container',
		x: 0,
		y: 0,
		children: [
			{
				id: 'freeSpinCounter-frame',
				label: 'Frame',
				kind: 'sprite',
				x: 0,
				y: 0,
				anchor: { x: 0, y: 0 },
				assetKey: BUILTIN_REGION.freeSpinCounterFrame,
				region: BUILTIN_REGION.freeSpinCounterFrame,
				width: FS_PANEL_WIDTH,
				height: FS_PANEL_HEIGHT,
				// Bind the frame texture to the `frameImage` param so the author can swap the
				// panel art per instance (region picker) WITHOUT forking a project copy — the
				// reason a custom frame previously needed one. Default `Frame_FSCounter.png`
				// (bare name) resolves to the game-bundled frame ⇒ parity; a picked editor-art
				// region (`<sheet>::<region>`) resolves scoped via `LayoutNodeView`'s spriteRef.
				paramBindings: { region: 'frameImage' },
			},
			{
				id: 'freeSpinCounter-caption',
				label: 'Caption',
				kind: 'text',
				x: FS_PANEL_WIDTH * 0.5,
				y: FS_PANEL_HEIGHT * 0.48 - FS_FONT_SIZE,
				anchor: { x: 0.5, y: 0 },
				text: 'FREE SPIN',
				style: { fontFamily: FS_FONT_FAMILY, fontSize: FS_FONT_SIZE, fill: HUD_FILL },
				paramBindings: {
					text: 'label',
					'style.fontFamily': 'fontFamily',
					'style.fontSize': 'fontSize',
					'style.fill': 'fill',
				},
				// Editor preview shows the resolved `label` param ("FREE SPIN").
				preview: { style: 'text', textParam: 'label' },
			},
			{
				id: 'freeSpinCounter-value',
				label: 'Value',
				kind: 'text',
				x: FS_PANEL_WIDTH * 0.5,
				y: FS_PANEL_HEIGHT * 0.48,
				anchor: { x: 0.5, y: 0 },
				text: '0 OF 0',
				style: { fontFamily: FS_FONT_FAMILY, fontSize: FS_FONT_SIZE, fill: HUD_FILL },
				paramBindings: {
					text: 'value',
					'style.fontFamily': 'fontFamily',
					'style.fontSize': 'fontSize',
					'style.fill': 'fill',
				},
				// Editor preview shows the engine-fed "X OF Y" value.
				preview: { style: 'text', textParam: 'value' },
			},
		],
	},
	params: [
		// The engine value feed this counter binds to — picked from the registered
		// sources (the `freeSpins` composed-string source the game registers).
		{ key: 'source', kind: 'string', options: VALUE_SOURCE_KEYS },
		// The engine visibility feed this counter binds to: when set to a registered
		// boolean source (`freeSpinCounterShow`, true only during free spins) the whole
		// instance hides while that source is false. DEFAULTS to `freeSpinCounterShow` —
		// a free-spin counter that's always visible is almost never what's wanted, so the
		// natural gate is the out-of-the-box behaviour (all games register that feed); an
		// instance can clear it to render the counter ungated. `options` makes the editor
		// render a dropdown (pick the feed) instead of an undiscoverable free-text box.
		// NOTE: this gates the panel children: frame/caption/value.
		{
			key: 'visibleSource',
			kind: 'string',
			options: VISIBILITY_SOURCE_KEYS,
			default: 'freeSpinCounterShow',
		},
		{ key: 'label', kind: 'string', default: 'FREE SPIN' },
		// The panel frame texture — pick a region from the project's atlases/sheets to
		// use a custom frame (e.g. a WANTED poster) on the BUILT-IN counter, so a custom
		// frame no longer requires forking a project copy. Default = the game-bundled
		// `Frame_FSCounter.png` (parity).
		{
			key: 'frameImage',
			kind: 'image',
			default: BUILTIN_REGION.freeSpinCounterFrame,
			label: 'frame image',
		},
		{ key: 'fill', kind: 'color', default: HUD_FILL },
		{ key: 'fontSize', kind: 'number', default: FS_FONT_SIZE },
		{ key: 'fontFamily', kind: 'string', default: FS_FONT_FAMILY },
		// Engine-fed "X OF Y" string (the `freeSpins` source); a `string` value so it
		// renders verbatim through the text path, not the numeric readout.
		{ key: 'value', kind: 'string', engineProvided: true },
	],
};

/** The default info-bar body size — readable over the reels without dwarfing them. */
const INFO_BAR_FONT_SIZE = 36;
/**
 * Gold (`MessageToast` `.win` fill `#ffe9a8`) — the colour the toast used for win
 * lines, the common case the bar shows ("You win $1.00 with 2 Bananas").
 */
const INFO_BAR_FILL = 0xffe9a8;

/**
 * The transient info / win bar (§18) — the editor-native, placeable replacement for
 * the coded HTML `MessageToast` (`components-ui-html`, a CSS pill the scene editor
 * can't touch). Mirrors the §14.3 free-spin-counter decomposition: a coded overlay
 * re-homed as a `componentInstance` so the author owns its position, size, font,
 * font-size and colour from the scene editor, fed by an engine source + gated on a
 * visibility source.
 *
 * PLAIN-NODE path (NOT the HUD's separate-coded-parts path), like
 * {@link FREE_SPIN_COUNTER_DEF}: `root` is a local-space container with two
 * EDITOR-NATIVE children, both centred at the origin so they overlay —
 * - a real `kind:'sprite'` Background whose `region`/`tint` bind to the author-picked
 *   `background` image param (the pill/plaque atlas frame; §13.2 sprite param binding,
 *   `LayoutNodeView`). Absent ⇒ the sprite resolves no texture and the bar renders
 *   text-only — no crash, so the asset isn't a blocker to start;
 * - a `kind:'text'` Message bound (`paramBindings.text → 'value'`) to the engine-fed
 *   STRING source, so it renders the toast text verbatim (a `string` value routes
 *   through the `<Text>`/`<BitmapText>` path, never the numeric readout).
 *
 * The GAME feeds it via `registerComponentValues({ message: textSource(() =>
 * stateMessage.current?.text ?? '') })` and gates it via
 * `registerComponentVisibility({ messageShow: boolSource(() => !!stateMessage.current)
 * })` — the same `showMessage` state the HTML toast read, so the existing auto-clear
 * timer hides the bar exactly as before. Per-`kind` recolour (info/win/warn) is a
 * later follow-on; this uses one authored `fill` (gold, the win look).
 */
export const INFO_BAR_DEF: ComponentDef = {
	id: 'infoBar',
	name: 'Info Bar',
	version: 1,
	scope: 'shared',
	category: 'overlay',
	root: {
		id: 'infoBar-root',
		kind: 'container',
		x: 0,
		y: 0,
		children: [
			{
				id: 'infoBar-bg',
				label: 'Background',
				kind: 'sprite',
				x: 0,
				y: 0,
				anchor: { x: 0.5, y: 0.5 },
				// No static texture: the author picks the pill/plaque frame via the `background`
				// image param (region picker), which drives `region` below. `tint` recolours
				// it. Empty static `assetKey` + no picked frame ⇒ no texture resolves ⇒ the bar
				// renders text-only (no crash), so the asset isn't a blocker to start.
				assetKey: '',
				paramBindings: { region: 'background', tint: 'tint' },
				// Editor preview hint: a tile so the slot reads as a background even before a
				// frame is picked.
				preview: { w: INFO_BAR_FONT_SIZE * 14, h: INFO_BAR_FONT_SIZE * 2.4, style: 'tile' },
			},
			{
				id: 'infoBar-text',
				label: 'Message',
				kind: 'text',
				x: 0,
				y: 0,
				anchor: { x: 0.5, y: 0.5 },
				// Sample text for the EDITOR only (the engine feeds the real string through
				// `paramBindings.text`). Kept in step with the Invisible Win Text defaults, so the
				// editor previews a sentence the game can actually say.
				text: 'You win $1.00 with 2 Bananas',
				style: {
					fontFamily: HUD_FONT_FAMILY,
					fontSize: INFO_BAR_FONT_SIZE,
					fill: INFO_BAR_FILL,
				},
				paramBindings: {
					text: 'value',
					'style.fontFamily': 'fontFamily',
					'style.fontSize': 'fontSize',
					'style.fill': 'fill',
				},
				// Editor preview shows the engine-fed message string.
				preview: { style: 'text', textParam: 'value' },
			},
		],
	},
	params: [
		// The engine value feed the bar binds to — defaults to the `message` string source
		// (the `showMessage` toast feed). Picked from the registered sources dropdown.
		{ key: 'source', kind: 'string', options: VALUE_SOURCE_KEYS, default: 'message' },
		// The engine visibility feed: DEFAULTS to `messageShow` (true only while a message
		// is active), so the bar appears only when there's something to say — an
		// always-visible info bar is almost never wanted. Clear it to render ungated.
		{
			key: 'visibleSource',
			kind: 'string',
			options: VISIBILITY_SOURCE_KEYS,
			default: 'messageShow',
		},
		// The pill/plaque background frame (atlas region) + its tint.
		{ key: 'background', kind: 'image', group: 'Background', label: 'background frame' },
		{ key: 'tint', kind: 'color', default: HUD_FILL, group: 'Background' },
		{ key: 'fill', kind: 'color', default: INFO_BAR_FILL },
		{ key: 'fontSize', kind: 'number', default: INFO_BAR_FONT_SIZE },
		{ key: 'fontFamily', kind: 'string', default: HUD_FONT_FAMILY },
		// Engine-fed message string (the `message` source); a `string` value so it renders
		// verbatim through the text path, not the numeric readout.
		{ key: 'value', kind: 'string', engineProvided: true },
	],
};

/** The coded splash logo (`apps/lines` `LoadingScreen.svelte` `SpineProvider key="loader"`
 * `width={300}`, animation `title_screen`). */
const LOADING_LOGO_BUNDLE = 'loader';
const LOADING_LOGO_ANIMATION = 'title_screen';
const LOADING_LOGO_WIDTH = 300;
/** Coded progress-bar offset below the logo centre (`LoadingProgress y={250}`). */
const LOADING_BAR_Y = 250;
/** Coded progress-bar size (`width={1967*0.2} height={346*0.2}`). */
const LOADING_BAR_WIDTH = 393.4;
const LOADING_BAR_HEIGHT = 69.2;
/** The percentage readout under the bar — readable at splash scale. */
const LOADING_PERCENT_FONT_SIZE = 40;

/**
 * The loading / intro SPLASH (the startup screen) as an editor-visible/editable
 * component — the loading-screen analogue of {@link FREE_SPIN_COUNTER_DEF} /
 * {@link INFO_BAR_DEF}: the coded `apps/lines` `LoadingScreen.svelte` splash content
 * (logo over the progress bar) re-homed as a `componentInstance` so the author owns
 * each piece's position / size / font / colour from the scene editor, with the boot
 * asset-load wired in.
 *
 * HYBRID path — the Logo is an EDITOR-NATIVE plain node (like the free-spin counter),
 * but the progress BAR can't be: its fill is a live mask whose width tracks the load,
 * which the static node model can't express. So the bar is the ONE coded part — a
 * `bind: { component: 'LoadingBar' }` child (the §14.3 HUD-readout decomposition),
 * reusing the proven masked render:
 * - a `kind:'spine'` Logo (`loader` bundle, `title_screen` animation, looped) — the
 *   centrepiece, drawn directly in the editor and fully draggable/resizable;
 * - the bound `LoadingBar` (the masked fill, reading `barWidth`/`barHeight` + the
 *   `image*` frame params off the param context, hiding itself once `stateApp.loaded`),
 *   which ALSO draws the optional PERCENTAGE readout (`showPercent` + `percent*` style
 *   params) from the same live `loadingProgress`, inside the same `{#if !loaded}` — so
 *   the number shares the bar's lifecycle and can't drift or linger at "100%". (The
 *   percentage used to be a separate `kind:'text'` node; folding it into the bar fixed
 *   it lingering after the bar vanished, and made it editable AS PART OF the bar.)
 *
 * The GAME registers the coded `LoadingBar` part via `registerBoundComponents`. It does
 * NOT replace the coded
 * `LoadingScreen` mount (which owns the interactive press-to-continue → transition
 * flow + the `onloaded` callback the component can't carry); this is a placeable
 * building block for composing the splash's static content in the editor. Defaults
 * mirror the coded splash so a freshly placed instance reads like the original.
 */
export const LOADING_INTRO_DEF: ComponentDef = {
	id: 'loadingIntro',
	name: 'Loading / Intro',
	version: 1,
	scope: 'shared',
	category: 'overlay',
	root: {
		id: 'loadingIntro-root',
		kind: 'container',
		x: 0,
		y: 0,
		children: [
			{
				id: 'loadingIntro-logo',
				label: 'Logo',
				kind: 'spine',
				x: 0,
				y: 0,
				anchor: { x: 0.5, y: 0.5 },
				assetKey: LOADING_LOGO_BUNDLE,
				width: LOADING_LOGO_WIDTH,
				defaultAnimation: LOADING_LOGO_ANIMATION,
				loop: true,
			},
			{
				id: 'loadingIntro-bar',
				label: 'Progress bar',
				kind: 'container',
				x: 0,
				y: LOADING_BAR_Y,
				anchor: { x: 0.5, y: 0 },
				bind: { component: 'LoadingBar' },
				// Editor-only placeholder: a tile sized to the coded bar. The game ignores
				// `preview` and mounts the real `LoadingBar` (the live masked fill).
				preview: { w: LOADING_BAR_WIDTH, h: LOADING_BAR_HEIGHT, style: 'tile' },
				children: [],
			},
		],
	},
	params: [
		// Progress-bar geometry — forwarded through the param context to the bound
		// `LoadingBar`, so resizing the bar is an editor edit (no code change).
		{ key: 'barWidth', kind: 'number', default: LOADING_BAR_WIDTH, group: 'Progress bar' },
		{ key: 'barHeight', kind: 'number', default: LOADING_BAR_HEIGHT, group: 'Progress bar' },
		// The three bar frames (atlas region names) the bound `LoadingBar` draws: the
		// empty track, the fill (masked to the progress), and the frame over both.
		// Defaults match the coded splash; a game with different art overrides them.
		{
			key: 'imageBackground',
			kind: 'image',
			default: BUILTIN_REGION.progressBarTrack,
			group: 'Progress bar',
			label: 'track',
		},
		{
			key: 'imageProgress',
			kind: 'image',
			default: BUILTIN_REGION.progressBarFill,
			group: 'Progress bar',
			label: 'fill',
		},
		{
			key: 'imageFrame',
			kind: 'image',
			default: BUILTIN_REGION.progressBarFrame,
			group: 'Progress bar',
			label: 'frame',
		},
		// Percentage readout — drawn BY the bound `LoadingBar` (so it shares the bar's
		// `{#if !loaded}` and can't drift/linger). Toggle + style, forwarded through the
		// param context. `percentOffsetY` nudges it off the bar's vertical centre.
		{ key: 'showPercent', kind: 'boolean', default: true, group: 'Percentage' },
		{ key: 'percentFill', kind: 'color', default: HUD_FILL, group: 'Percentage', label: 'colour' },
		{
			key: 'percentFontSize',
			kind: 'number',
			default: LOADING_PERCENT_FONT_SIZE,
			group: 'Percentage',
			label: 'font size',
		},
		{
			key: 'percentFontFamily',
			kind: 'string',
			default: HUD_FONT_FAMILY,
			group: 'Percentage',
			label: 'font',
		},
		{ key: 'percentOffsetY', kind: 'number', default: 0, group: 'Percentage', label: 'offset Y' },
	],
};

/**
 * The full-screen TRANSITION wipe (§17.4 step 4 — the FIRST animated overlay migrated
 * off a direct coded `bind` to an editor-owned `componentInstance`; the proof of the
 * HYBRID pattern the FS intro/outro will follow). A thin wrapper: the root holds ONE
 * `bind` child mounting the coded `Transition`, which KEEPS its proven lifecycle (the
 * `transition` event → play `TransitionAnimation` → spine `complete` → resolve the
 * round-blocking `await broadcastAsync`). What the migration changes is OWNERSHIP OF
 * POSITION: under the `TRANSITION_INSTANCE` flag the coded part renders at its LOCAL
 * origin (see `Transition.svelte` / `TransitionAnimation.svelte`), so the editor node's
 * transform places the wipe — drag/scale the instance to move it — instead of the coded
 * part hardcoding canvas-centre. Placed `canvas`-space centred (`screenAnchor {0.5,0.5}`)
 * to reproduce the coded centre, and the coded part still reads `canvasSizes()` for its
 * height so sizing stays viewport-responsive (no baked size). Animation stays coded (no
 * per-spine cue); the editor owns placement. The intro/outro extend this by also
 * decomposing their count text into a sibling editor-native node.
 */
export const TRANSITION_DEF: ComponentDef = {
	id: 'transition',
	name: 'Transition',
	version: 1,
	scope: 'shared',
	category: 'overlay',
	root: {
		id: 'transition-root',
		kind: 'container',
		x: 0,
		y: 0,
		children: [
			{
				id: 'transition-anim',
				label: 'Transition',
				kind: 'container',
				x: 0,
				y: 0,
				// `boundToInstance` tells the coded `Transition` it's the instance's child:
				// render the wipe at LOCAL origin so THIS node's transform places it (the
				// instance is centred via `screenAnchor`). A direct `bind:Transition` scene
				// anchor passes no such prop ⇒ the coded part self-centres (parity). Encoding
				// it on the def (not a per-game flag) means every game inherits it via the
				// shared component — Book of Borut included.
				bind: { component: 'Transition', props: { boundToInstance: true } },
				children: [],
			},
		],
	},
};

/**
 * The board-relative VISUAL of the free-spin INTRO (§17 Phase 3) — the editor-positioned
 * half of the intro/gate split. Wraps the coded `FreeSpinIntroVisual` (the `FreeSpinAnimation`
 * frame spine + the count spine, count in its slot) as a `bind` child with
 * `boundToInstance:true`, so the coded part renders at THIS instance's node position
 * instead of self-centring on the board — drag/scale the instance to move the intro art.
 * The full-screen GATE (dim + press-to-continue + the round-blocking await) stays a coded
 * `canvas` bind (`FreeSpinIntroGate`), so it isn't editor-positioned. Placed `game`-space,
 * defaulted to board-centre (the scene node sets `x/y = boardLayout`), so parity holds at
 * the default position. Params forward the spine bundle / animations / slot to the part.
 */
export const FREE_SPIN_INTRO_VISUAL_DEF: ComponentDef = {
	id: 'freeSpinIntroVisual',
	name: 'Free-spin intro',
	version: 1,
	scope: 'shared',
	category: 'overlay',
	root: {
		id: 'freeSpinIntroVisual-root',
		kind: 'container',
		x: 0,
		y: 0,
		children: [
			{
				id: 'freeSpinIntroVisual-anim',
				label: 'Free-spin intro',
				kind: 'container',
				x: 0,
				y: 0,
				bind: { component: 'FreeSpinIntroVisual', props: { boundToInstance: true } },
				children: [],
			},
		],
	},
	params: [
		{ key: 'introSpine', kind: 'spine', default: 'fsIntroNumber', label: 'intro spine bundle' },
		{
			key: 'introAnimation',
			kind: 'spineAnimation',
			spineParam: 'introSpine',
			default: 'intro',
			label: 'intro animation',
		},
		{
			key: 'idleAnimation',
			kind: 'spineAnimation',
			spineParam: 'introSpine',
			default: 'idle',
			label: 'idle animation',
		},
		{
			key: 'slotName',
			kind: 'spineSlot',
			spineParam: 'introSpine',
			default: 'slot_number',
			label: 'number slot',
		},
	],
};

/**
 * The board-relative VISUAL of the free-spin OUTRO (§17 Phase 3) — the editor-positioned
 * half of the outro/gate split, mirroring {@link FREE_SPIN_INTRO_VISUAL_DEF}. Wraps the
 * coded `FreeSpinOutroVisual` (the `FreeSpinAnimation` frame spine + win sprites + the
 * count spine, count in its slot reading the gate's published count-up amount) as a `bind`
 * child with `boundToInstance:true`. The full-screen GATE (dim + count-up driver + WinCoins
 * + press + round-await) stays the coded `canvas` bind `FreeSpinOutroGate`.
 */
export const FREE_SPIN_OUTRO_VISUAL_DEF: ComponentDef = {
	id: 'freeSpinOutroVisual',
	name: 'Free-spin outro',
	version: 1,
	scope: 'shared',
	category: 'overlay',
	root: {
		id: 'freeSpinOutroVisual-root',
		kind: 'container',
		x: 0,
		y: 0,
		children: [
			{
				id: 'freeSpinOutroVisual-anim',
				label: 'Free-spin outro',
				kind: 'container',
				x: 0,
				y: 0,
				bind: { component: 'FreeSpinOutroVisual', props: { boundToInstance: true } },
				children: [],
			},
		],
	},
	params: [
		{ key: 'outroSpine', kind: 'spine', default: 'fsOutroNumber', label: 'outro spine bundle' },
		{
			key: 'outroAnimation',
			kind: 'spineAnimation',
			spineParam: 'outroSpine',
			default: 'intro',
			label: 'outro animation',
		},
		{
			key: 'idleAnimation',
			kind: 'spineAnimation',
			spineParam: 'outroSpine',
			default: 'idle',
			label: 'idle animation',
		},
		{
			key: 'slotName',
			kind: 'spineSlot',
			spineParam: 'outroSpine',
			default: 'slot_number',
			label: 'number slot',
		},
	],
};

/**
 * The board-relative VISUAL of the WIN overlay (big-win presentation) — the editor-positioned
 * half of the win gate/visual split, mirroring {@link FREE_SPIN_OUTRO_VISUAL_DEF}. Wraps the coded
 * `WinVisual` (the tier spine via `WinAnimation` + the count number in its slot, reading the gate's
 * published count-up amount + win level from `winState`) as a `bind` child with
 * `boundToInstance:true`, so the coded part renders at THIS instance's node position instead of
 * self-centring on the board — drag/scale the instance to move the big-win art. The full-screen GATE
 * (dim + count-up driver + WinCoins + press + round-await) stays the coded `canvas` bind `WinGate`.
 *
 * ANIMATION + SPINE + DURATION + SOUND per BIG TIER — the presentation half of the config/component
 * split (`docs/tools/game-config.md`): the `/config` panel owns tier STRUCTURE (count / name /
 * threshold / type / escalation); this component owns per-tier PRESENTATION. The per-tier groups are
 * GENERATED from the active game config's big tiers (keyed by the tier's ALIAS) via
 * {@link winTierPresentationParams}, so the two stay in sync — a config that authors `big`/`mega`/`max`
 * gets exactly those three groups. The built-in {@link WIN_DEF} is generated from
 * {@link DEFAULT_WIN_TIERS} (the coded `winLevelMap`'s big tiers) so an un-authored project renders
 * byte-identically; the editor rebuilds the def from the ACTIVE config's tiers on load.
 *
 * Per tier `<alias>` the group carries: `<alias>Spine` (spine picker), `<alias>Intro`/`Idle`/`Outro`
 * (`spineAnimation` dropdowns of the tier's chosen spine — no blind typing), `<alias>Duration` (ms),
 * `<alias>Sfx`, `<alias>Bgm`. Resolution per field, at runtime: the PER-TIER value ?? the SHARED set
 * (`winSpine`/`introAnimation`/`idleAnimation`/`exitAnimation`, all tiers) ?? the config/coded tier's
 * own value (`spineKey`/`animation`/`durationMs`/`sound`). Every per-tier field is empty by default, so
 * an un-authored instance falls all the way through to the config/coded value ⇒ parity.
 * {@link mergeBuiltinCodedParams} unions these onto an already-placed pinned instance at resolve time,
 * so adding them needs no version bump.
 */

/** Display metadata for one win TIER the `win` component authors a presentation group for. */
export type WinTierMeta = { alias: string; name: string };

/**
 * The conventional big tiers (the coded `apps/lines` `winLevelMap` big rows). The DEFAULT presentation
 * groups when a project has NOT authored config `winLevels`, so the built-in `win` component is
 * byte-identical to before. The editor replaces these with the ACTIVE config's big tiers when one is
 * authored (see the launcher's `/editor` `winTierPresentationParams` overlay).
 */
export const DEFAULT_WIN_TIERS: WinTierMeta[] = [
	{ alias: 'big', name: 'Big win' },
	{ alias: 'superwin', name: 'Super win' },
	{ alias: 'mega', name: 'Mega win' },
	{ alias: 'epic', name: 'Epic win' },
	{ alias: 'max', name: 'Max win' },
];

/**
 * Editor-only option lists for the per-tier SOUND dropdowns — the game's `bgm_*` beds and its
 * one-shot (`sfx_*` / `jng_*`) cues. Supplied by the editor from the ONE generated sound enum
 * (`engine-flow-v2` `MUSIC_NAMES` / `SOUND_EFFECT_NAMES`, itself generated from the game's
 * `sound.ts`), so the author picks a sound that exists instead of typing. Omitted at runtime (the
 * built-in {@link WIN_DEF} has none) — `options` is a pure editor hint, so the shipped def + saved
 * doc are unaffected.
 */
export type WinSoundOptions = { bgm: string[]; sfx: string[] };

/**
 * Per-tier presentation params for the `win` component — a spine picker + intro/idle/outro dropdowns
 * (of that spine's animations) + duration + sfx/bgm, ONE collapsible group per tier, keyed by the
 * tier's ALIAS so the runtime resolves each field by `<alias><Field>`. Generated from a big-tier list
 * (the active config's tiers, or {@link DEFAULT_WIN_TIERS} un-authored) so the component's groups mirror
 * the config's tiers. The per-tier `<alias>Spine` carries NO default, so an unset tier spine falls back
 * to the config `spineKey` then the shared `winSpine` at runtime (correct precedence); the editor's
 * animation dropdowns fall back to `winSpine`'s animations when the tier spine is unset.
 *
 * `soundOptions` (editor-only) turns the `<alias>Sfx` / `<alias>Bgm` fields into DROPDOWNS of the
 * game's real sounds (BGM = `bgm_*` beds, SFX = the non-bgm cues); omitted (the runtime call) leaves
 * them free-text `kind:'string'`. Either way an empty value ⇒ the config/coded sound (byte-identical).
 */
export function winTierPresentationParams(
	tiers: WinTierMeta[],
	soundOptions?: WinSoundOptions,
): ComponentParam[] {
	return tiers.flatMap(({ alias, name }): ComponentParam[] => {
		const spineParam = `${alias}Spine`;
		const sfx: ComponentParam = { key: `${alias}Sfx`, kind: 'string', group: name, label: 'sfx' };
		const bgm: ComponentParam = { key: `${alias}Bgm`, kind: 'string', group: name, label: 'bgm' };
		if (soundOptions) {
			if (soundOptions.sfx.length) sfx.options = soundOptions.sfx;
			if (soundOptions.bgm.length) bgm.options = soundOptions.bgm;
		}
		return [
			{ key: spineParam, kind: 'spine', group: name, label: 'spine bundle' },
			{ key: `${alias}Intro`, kind: 'spineAnimation', spineParam, group: name, label: 'intro' },
			{ key: `${alias}Idle`, kind: 'spineAnimation', spineParam, group: name, label: 'idle' },
			{ key: `${alias}Outro`, kind: 'spineAnimation', spineParam, group: name, label: 'outro' },
			{ key: `${alias}Duration`, kind: 'number', group: name, label: 'duration (ms)' },
			sfx,
			bgm,
		];
	});
}

/** The `win` component's base + shared params (everything that is NOT a per-tier group). */
const WIN_BASE_PARAMS: ComponentParam[] = [
	{ key: 'winSpine', kind: 'spine', default: 'bigwin', label: 'big-win spine bundle' },
	{
		key: 'slotName',
		kind: 'spineSlot',
		spineParam: 'winSpine',
		default: 'slot_win_count',
		label: 'count slot',
	},
	// The coin-fountain particles, now part of the placeable visual (position/scale follow the
	// `win` instance node). Default true ⇒ parity with the coded gate that used to own them.
	{ key: 'showCoins', kind: 'boolean', default: true, label: 'coin fountain' },
	// Shared set — applies to ALL tiers unless a per-tier group below overrides it. Empty ⇒ the
	// config/coded tier's own animation (parity).
	{
		key: 'introAnimation',
		kind: 'spineAnimation',
		spineParam: 'winSpine',
		group: 'Animations (all tiers)',
		label: 'intro',
	},
	{
		key: 'idleAnimation',
		kind: 'spineAnimation',
		spineParam: 'winSpine',
		group: 'Animations (all tiers)',
		label: 'idle',
	},
	{
		key: 'exitAnimation',
		kind: 'spineAnimation',
		spineParam: 'winSpine',
		group: 'Animations (all tiers)',
		label: 'exit',
	},
];

/**
 * Build the `win` component def for a big-tier list — the base/shared params + one presentation group
 * per tier ({@link winTierPresentationParams}). The built-in uses {@link DEFAULT_WIN_TIERS}; the editor
 * calls this with the ACTIVE game config's big tiers so the component's groups mirror the config.
 */
export function winComponentDef(tiers: WinTierMeta[] = DEFAULT_WIN_TIERS): ComponentDef {
	return {
		id: 'win',
		name: 'Win Overlay',
		version: 1,
		scope: 'shared',
		category: 'overlay',
		root: {
			id: 'win-root',
			kind: 'container',
			x: 0,
			y: 0,
			children: [
				{
					id: 'win-anim',
					label: 'Win Overlay',
					kind: 'container',
					x: 0,
					y: 0,
					bind: { component: 'WinVisual', props: { boundToInstance: true } },
					children: [],
				},
			],
		},
		params: [...WIN_BASE_PARAMS, ...winTierPresentationParams(tiers)],
	};
}

export const WIN_DEF: ComponentDef = winComponentDef();

/**
 * A droppable full-screen TAP-TO-CONTINUE overlay (Invisible Flow §6.2). An author
 * drops this on ANY Flow screen from the Scene Editor palette to get a full-screen
 * tap-to-continue that advances the flow (`completeActiveScreen` + optional
 * `emitFlowSignal`), with an optional per-instance dim/prompt look.
 *
 * The def is deliberately a MINIMAL empty-root `overlay` container — it carries no art
 * of its own. Its behaviour comes from the SHARED `tapToContinue` capability (which the
 * editor surfaces for every `overlay` instance and `<ComponentInstance>` honours
 * universally): a freshly-placed instance is invisible until the author flips
 * `tapToContinue` on, and stays transparent until they raise `tapDimAlpha` above 0 —
 * the parity-safe default. The dim/prompt + tap surface mount via the coded
 * `TAP_TO_CONTINUE_COMPONENT` bind, not via this def's children.
 *
 * Additive: a doc that doesn't reference this def is unchanged.
 */
export const TAP_TO_CONTINUE_DEF: ComponentDef = {
	id: 'tapToContinue',
	name: 'Tap to Continue',
	version: 1,
	scope: 'shared',
	category: 'overlay',
	root: {
		id: 'tapToContinue-root',
		kind: 'container',
		x: 0,
		y: 0,
		children: [],
	},
};

/**
 * A droppable LOADING BAR overlay (flow-driven-game §1) — the loading-gate, AUTHORABLE
 * in the flow. An author drops this on the `loading` screen from the Scene Editor palette
 * to get the boot progress bar PLUS a built-in `completeOnLoaded: true`, so the flow's
 * `complete` edge fires the moment asset-loading finishes — the author then wires what
 * happens next in `/flow` instead of it being hard-coded in `LoadingScreen.svelte`.
 *
 * It reuses the PROVEN coded `LoadingBar` bound part (the masked progress fill the static
 * node model can't express, already registered by the game) that {@link LOADING_INTRO_DEF}
 * mounts — but is JUST the bar (no logo/title spine), so it composes freely with whatever
 * splash art the author places around it. Same progress-bar geometry/frame/percentage params
 * as the loading-intro splash, defaulted to the coded look. The `completeOnLoaded` capability
 * itself is the SHARED `overlay` instance param (read by `<ComponentInstance>`); the def only
 * SEEDS it true on drop via `defaultInstanceParams` (an author can clear it for a non-advancing
 * bar). Additive: a doc that doesn't reference this def is unchanged.
 */
export const LOADING_BAR_DEF: ComponentDef = {
	id: 'loadingBar',
	name: 'Loading Bar',
	version: 1,
	scope: 'shared',
	category: 'overlay',
	// The loading gate's default capabilities, applied at RUNTIME (see `resolveComponentParams`),
	// so the bar IS a flow-driven loading gate out of the box on EVERY project — hand-authored
	// scaffold nodes included, not just editor-dropped ones. Both are shared `overlay` params (not
	// declared in `params`); the editor surfaces the toggles so an author can clear either.
	//  - `completeOnLoaded`: AUTO-advance the flow the moment boot assets finish (no tap needed).
	//  - `tapToContinue`: the RELIABLE FALLBACK — a real player tap advances the flow too (the way
	//    Book of Borut's loading works). The boot splash covers the canvas until assets load, so the
	//    tap can only land post-load ⇒ it never advances prematurely. If `completeOnLoaded` fires
	//    first (the normal case) the loading screen unmounts before the tap prompt is ever seen;
	//    if it somehow doesn't, the prompt appears and the tap still gets the player into the game.
	defaultInstanceParams: { completeOnLoaded: true, tapToContinue: true },
	root: {
		id: 'loadingBar-root',
		kind: 'container',
		x: 0,
		y: 0,
		children: [
			{
				id: 'loadingBar-bar',
				label: 'Progress bar',
				kind: 'container',
				x: 0,
				y: 0,
				anchor: { x: 0.5, y: 0 },
				bind: { component: 'LoadingBar' },
				// Editor-only placeholder: a tile sized to the coded bar. The game ignores
				// `preview` and mounts the real `LoadingBar` (the live masked fill).
				preview: { w: LOADING_BAR_WIDTH, h: LOADING_BAR_HEIGHT, style: 'tile' },
				children: [],
			},
		],
	},
	params: [
		// Progress-bar geometry — forwarded through the param context to the bound
		// `LoadingBar` (mirrors {@link LOADING_INTRO_DEF}'s bar params).
		{ key: 'barWidth', kind: 'number', default: LOADING_BAR_WIDTH, group: 'Progress bar' },
		{ key: 'barHeight', kind: 'number', default: LOADING_BAR_HEIGHT, group: 'Progress bar' },
		{
			key: 'imageBackground',
			kind: 'image',
			default: BUILTIN_REGION.progressBarTrack,
			group: 'Progress bar',
			label: 'track',
		},
		{
			key: 'imageProgress',
			kind: 'image',
			default: BUILTIN_REGION.progressBarFill,
			group: 'Progress bar',
			label: 'fill',
		},
		{
			key: 'imageFrame',
			kind: 'image',
			default: BUILTIN_REGION.progressBarFrame,
			group: 'Progress bar',
			label: 'frame',
		},
		// Percentage readout — drawn BY the bound `LoadingBar` (shares its `{#if !loaded}`).
		{ key: 'showPercent', kind: 'boolean', default: true, group: 'Percentage' },
		{ key: 'percentFill', kind: 'color', default: HUD_FILL, group: 'Percentage', label: 'colour' },
		{
			key: 'percentFontSize',
			kind: 'number',
			default: LOADING_PERCENT_FONT_SIZE,
			group: 'Percentage',
			label: 'font size',
		},
		{
			key: 'percentFontFamily',
			kind: 'string',
			default: HUD_FONT_FAMILY,
			group: 'Percentage',
			label: 'font',
		},
		{ key: 'percentOffsetY', kind: 'number', default: 0, group: 'Percentage', label: 'offset Y' },
	],
};

/**
 * The board's chosen book EXPANDING SYMBOL as a PLACEABLE component (book-reveal authoring) —
 * the "component authored to do this" half of the pure-hooks book reveal. It renders the chosen
 * `stateGame.specialSymbol` via the coded `ExpandingSymbol` bind (the same `<Symbol>` state-machine
 * render the coded `SpecialBook` uses), WITHOUT the shuffle: the author wraps their own reveal
 * animation + timing around it (their spine cued by the `specialBookReveal`/`specialBookHide`
 * signals + Flow choreography), while this simply shows the correct landed art at the instance's
 * position. Gated by a `visibleSource` (default `specialBookShow`, true while a symbol is chosen)
 * so it appears only during the reveal. Mirrors {@link FREE_SPIN_INTRO_VISUAL_DEF}: a `bind` child
 * renders the coded part at the instance node's (`game`-space) position.
 */
export const EXPANDING_SYMBOL_DEF: ComponentDef = {
	id: 'expandingSymbol',
	name: 'Expanding Symbol',
	version: 1,
	scope: 'shared',
	category: 'overlay',
	root: {
		id: 'expandingSymbol-root',
		kind: 'container',
		x: 0,
		y: 0,
		children: [
			{
				id: 'expandingSymbol-art',
				label: 'Expanding symbol',
				kind: 'container',
				x: 0,
				y: 0,
				bind: { component: 'ExpandingSymbol' },
				children: [],
			},
		],
	},
	params: [
		// The engine visibility feed — DEFAULTS to `specialBookShow` (true while a book symbol is
		// chosen), so the landed art appears only during the reveal. Clear it to render ungated.
		{
			key: 'visibleSource',
			kind: 'string',
			options: VISIBILITY_SOURCE_KEYS,
			default: 'specialBookShow',
		},
		// The symbol STATE the `<Symbol>` state machine renders (e.g. `bookIdle` to loop the
		// idle spine, `bookIntro` for the intro animation, `static` for the resting frame).
		{ key: 'state', kind: 'string', default: 'bookIdle', label: 'symbol state' },
		{ key: 'scale', kind: 'number', default: 1, label: 'scale' },
	],
};

/**
 * The chosen book EXPANDING SYMBOL merged into an authored intro Spine RIG (book-reveal
 * authoring) — the reusable "the animation flips through symbols and lands on YOUR symbol"
 * node every book-of game can drop in. Unlike {@link EXPANDING_SYMBOL_DEF} (which just shows the
 * landed art) this plays an author-picked intro rig animation and RIDES the chosen
 * `stateGame.specialSymbol` on a named BONE of that rig via `<SpineBoneAttach>`, so the symbol
 * banks/scales with the animation. Driven by the SAME `specialBookReveal` cue as the coded
 * shuffle (fired at `setExpandingSymbol` time, when the symbol is known) and returns its
 * completion promise, so the round blocks until the rig's intro animation finishes. Placing an
 * instance in the `specialBook` scene flips book-reveal ownership (it is authored content, not the
 * `SpecialBook` bind anchor) ⇒ the coded shuffle is suppressed and this reveal replaces it. A
 * `bind` child renders the coded part at the instance node's (`game`-space) position.
 */
export const FREE_SPIN_INTRO_SYMBOL_REVEAL_DEF: ComponentDef = {
	id: 'freeSpinIntroSymbolReveal',
	name: 'Free-spin symbol reveal',
	version: 1,
	scope: 'shared',
	category: 'overlay',
	root: {
		id: 'freeSpinIntroSymbolReveal-root',
		kind: 'container',
		x: 0,
		y: 0,
		children: [
			{
				id: 'freeSpinIntroSymbolReveal-anim',
				label: 'Symbol reveal',
				kind: 'container',
				x: 0,
				y: 0,
				bind: { component: 'FreeSpinIntroSymbolReveal' },
				children: [],
			},
		],
	},
	params: [
		{ key: 'introSpine', kind: 'spine', default: 'fsIntro', label: 'reveal spine bundle' },
		{
			key: 'introAnimation',
			kind: 'spineAnimation',
			spineParam: 'introSpine',
			default: 'intro',
			label: 'reveal animation',
		},
		{
			key: 'idleAnimation',
			kind: 'spineAnimation',
			spineParam: 'introSpine',
			default: 'idle',
			label: 'idle animation',
		},
		{
			key: 'symbolBone',
			kind: 'spineBone',
			spineParam: 'introSpine',
			default: '',
			label: 'symbol bone',
		},
		{ key: 'offsetX', kind: 'number', default: 0, label: 'symbol offset X' },
		{ key: 'offsetY', kind: 'number', default: 0, label: 'symbol offset Y' },
		{
			key: 'followRotation',
			kind: 'boolean',
			default: true,
			label: 'symbol follows bone rotation',
		},
		{ key: 'followScale', kind: 'boolean', default: true, label: 'symbol follows bone scale' },
		{ key: 'symbolScale', kind: 'number', default: 1, label: 'symbol scale' },
		// The symbol STATE the `<Symbol>` state machine renders on the bone (e.g. `bookIdle` to
		// loop the idle spine, `static` for the resting frame). The RIG animation provides the
		// motion; the symbol provides the identity.
		{ key: 'symbolState', kind: 'symbolState', default: 'bookIdle', label: 'symbol state' },
		// EDITOR-PREVIEW ONLY: point the Scene Editor's bone-ridden stand-in at a real symbol
		// atlas region so the author sees the actual art track the bone (instead of a labelled
		// box). The game ignores this — at runtime the ridden symbol is the chosen book symbol.
		{ key: 'previewImage', kind: 'image', default: '', label: 'preview symbol (editor only)' },
	],
};

/** The default feature-card size — one buy-feature tile in the buy-bonus menu. */
const FEATURE_CARD_WIDTH = 280;
const FEATURE_CARD_HEIGHT = 380;
const FEATURE_CARD_TITLE_SIZE = 34;
const FEATURE_CARD_BODY_SIZE = 22;
const FEATURE_CARD_PRICE_SIZE = 30;
const FEATURE_CARD_BUTTON_SIZE = 28;
/** Gold (`INFO_BAR_FILL`), reused for the price so it reads as the headline number. */
const FEATURE_CARD_PRICE_FILL = INFO_BAR_FILL;

/**
 * One buy-feature / select-feature CARD (§ feature cards) — the per-item prefab a `repeater`
 * node instances once per buy-bonus mode. The engine-native, placeable twin of the coded HTML
 * `BonusCards`/`BonusCard`: a panel background + icon + the title / description / price /
 * button-label texts, with every VARIABLE part bound to an `engineProvided` param the repeater
 * feeds per item (`title`/`description`/`price`/`buttonLabel`/`iconKey`). The whole card is the
 * press surface — its `select` press routes to the item's `onSelect` (the `stateBonus`
 * selected-mode + `buyBonusConfirm` broadcast the HTML card fired), exposed as the `select`
 * signal.
 *
 * PLAIN-NODE path (like {@link FREE_SPIN_COUNTER_DEF} / {@link INFO_BAR_DEF}): every child is an
 * EDITOR-NATIVE node so the owner restyles the tile in the editor later. The layout here is
 * deliberately simple/neutral — correct param + press wiring matters more than looks. The panel
 * background carries no static texture (empty `assetKey`) so it's a blank slot until the owner
 * picks art; the icon binds `assetKey → iconKey` (the resolved icon key the repeater feeds).
 */
export const FEATURE_CARD_DEF: ComponentDef = {
	id: 'featureCard',
	name: 'Feature Card',
	version: 1,
	scope: 'shared',
	category: 'ui',
	root: {
		id: 'featureCard-root',
		kind: 'container',
		x: 0,
		y: 0,
		children: [
			{
				id: 'featureCard-bg',
				label: 'Panel',
				kind: 'sprite',
				x: 0,
				y: 0,
				anchor: { x: 0, y: 0 },
				// No static texture: the owner picks the panel frame via the `panelImage` param
				// (region picker). Empty ⇒ no texture resolves ⇒ a blank slot (no crash), so the
				// asset isn't a blocker to start authoring.
				assetKey: '',
				width: FEATURE_CARD_WIDTH,
				height: FEATURE_CARD_HEIGHT,
				paramBindings: { region: 'panelImage', tint: 'panelTint' },
				preview: { w: FEATURE_CARD_WIDTH, h: FEATURE_CARD_HEIGHT, style: 'tile' },
			},
			{
				id: 'featureCard-icon',
				label: 'Icon',
				kind: 'sprite',
				x: FEATURE_CARD_WIDTH * 0.5,
				y: FEATURE_CARD_HEIGHT * 0.28,
				anchor: { x: 0.5, y: 0.5 },
				assetKey: '',
				width: 120,
				height: 120,
				// The engine-fed icon key (`assets.icon`, a resolved editor-art key/URL). Bound to
				// `assetKey` so the sprite resolves it through the normal loaded-asset path.
				paramBindings: { assetKey: 'iconKey' },
			},
			{
				id: 'featureCard-title',
				label: 'Title',
				kind: 'text',
				x: FEATURE_CARD_WIDTH * 0.5,
				y: FEATURE_CARD_HEIGHT * 0.5,
				anchor: { x: 0.5, y: 0.5 },
				text: 'Feature',
				style: {
					fontFamily: HUD_FONT_FAMILY,
					fontSize: FEATURE_CARD_TITLE_SIZE,
					fill: HUD_FILL,
					align: 'center',
				},
				paramBindings: { text: 'title' },
				preview: { style: 'text', textParam: 'title' },
			},
			{
				id: 'featureCard-description',
				label: 'Description',
				kind: 'text',
				x: FEATURE_CARD_WIDTH * 0.5,
				y: FEATURE_CARD_HEIGHT * 0.62,
				anchor: { x: 0.5, y: 0.5 },
				text: 'Description',
				style: {
					fontFamily: HUD_FONT_FAMILY,
					fontSize: FEATURE_CARD_BODY_SIZE,
					fill: HUD_FILL,
					align: 'center',
				},
				paramBindings: { text: 'description' },
				preview: { style: 'text', textParam: 'description' },
			},
			{
				id: 'featureCard-price',
				label: 'Price',
				kind: 'text',
				x: FEATURE_CARD_WIDTH * 0.5,
				y: FEATURE_CARD_HEIGHT * 0.74,
				anchor: { x: 0.5, y: 0.5 },
				text: '$0.00',
				style: {
					fontFamily: HUD_FONT_FAMILY,
					fontSize: FEATURE_CARD_PRICE_SIZE,
					fill: FEATURE_CARD_PRICE_FILL,
					align: 'center',
				},
				paramBindings: { text: 'price' },
				preview: { style: 'text', textParam: 'price' },
			},
			{
				id: 'featureCard-button',
				label: 'Button label',
				kind: 'text',
				x: FEATURE_CARD_WIDTH * 0.5,
				y: FEATURE_CARD_HEIGHT * 0.88,
				anchor: { x: 0.5, y: 0.5 },
				text: 'Buy',
				style: {
					fontFamily: HUD_FONT_FAMILY,
					fontSize: FEATURE_CARD_BUTTON_SIZE,
					fill: HUD_FILL,
					align: 'center',
				},
				paramBindings: { text: 'buttonLabel' },
				preview: { style: 'text', textParam: 'buttonLabel' },
			},
		],
	},
	params: [
		// The panel background frame (atlas region) + tint — the owner's tile art.
		{ key: 'panelImage', kind: 'image', group: 'Panel', label: 'panel frame' },
		{ key: 'panelTint', kind: 'color', default: HUD_FILL, group: 'Panel', label: 'tint' },
		// Shared style knobs so the owner can restyle the tile without editing each text node.
		{ key: 'fill', kind: 'color', default: HUD_FILL },
		{ key: 'fontFamily', kind: 'string', default: HUD_FONT_FAMILY, label: 'font' },
		// Engine-fed per-item values (the `repeater` feeds one card per buy-bonus mode). All
		// `engineProvided`, so the editor renders no control — the source supplies them at runtime.
		{ key: 'title', kind: 'string', engineProvided: true },
		{ key: 'description', kind: 'string', engineProvided: true },
		{ key: 'price', kind: 'string', engineProvided: true },
		{ key: 'buttonLabel', kind: 'string', engineProvided: true },
		{ key: 'iconKey', kind: 'string', engineProvided: true },
	],
	// The card's press — the repeater wires it to the item's `onSelect` (select the mode +
	// broadcast `buyBonusConfirm`), so a downstream author can also target it by name.
	signals: [{ key: 'select', note: 'Fired when the card is pressed (buy the feature).' }],
};

/** The default confirm-dialog size — a centred "are you sure?" panel. */
const CONFIRM_DIALOG_WIDTH = 560;
const CONFIRM_DIALOG_HEIGHT = 420;
const CONFIRM_DIALOG_TITLE_SIZE = 40;
const CONFIRM_DIALOG_MESSAGE_SIZE = 26;
const CONFIRM_DIALOG_BUTTON_SIZE = 28;
const CONFIRM_DIALOG_BUTTON_WIDTH = 220;
const CONFIRM_DIALOG_BUTTON_HEIGHT = 68;
/** Dark panel + green/grey buttons — a neutral, visible-out-of-the-box look the owner restyles. */
const CONFIRM_DIALOG_PANEL_FILL = 0x1a1a2e;
const CONFIRM_DIALOG_CONFIRM_FILL = 0x27ae60;
const CONFIRM_DIALOG_CANCEL_FILL = 0x4a4a5a;

/**
 * A GENERIC, reusable CONFIRMATION DIALOG (§ confirm dialog) — the engine-native, placeable twin of
 * the retired HTML `ModalBuyBonusConfirm`: a centred panel + title + message + a CONFIRM and a CANCEL
 * button, every variable part bound to an `engineProvided` param a MOUNT feeds (`title`/`message`/
 * `confirmLabel`/`cancelLabel`/`imageKey`). NOTHING here is buy-specific — buy-bonus is merely the
 * first consumer; any "are you sure?" flow reuses it by threading its own copy + callbacks through
 * `<ConfirmDialog>`.
 *
 * PLAIN-NODE path (like {@link FEATURE_CARD_DEF}): every child is an EDITOR-NATIVE node so the owner
 * restyles the dialog in the editor. The panel + buttons are `rect`s so the dialog is visible with no
 * art; the optional image sprite binds `assetKey → imageKey` (blank ⇒ no texture ⇒ text-only, no
 * crash). The two buttons are `container`s carrying {@link BaseNode.pressAction} `confirm`/`cancel`,
 * so each routes to the matching action the mount supplies (the two-button generalisation of the
 * feature card's whole-instance `select`). Both actions are exposed as `signals` for downstream flow.
 */
export const CONFIRM_DIALOG_DEF: ComponentDef = {
	id: 'confirmDialog',
	name: 'Confirm Dialog',
	version: 1,
	scope: 'shared',
	category: 'ui',
	root: {
		id: 'confirmDialog-root',
		kind: 'container',
		x: 0,
		y: 0,
		children: [
			{
				id: 'confirmDialog-panel',
				label: 'Panel',
				kind: 'rect',
				x: 0,
				y: 0,
				anchor: { x: 0.5, y: 0.5 },
				width: CONFIRM_DIALOG_WIDTH,
				height: CONFIRM_DIALOG_HEIGHT,
				color: CONFIRM_DIALOG_PANEL_FILL,
				alpha: 0.96,
			},
			{
				id: 'confirmDialog-title',
				label: 'Title',
				kind: 'text',
				x: 0,
				y: -CONFIRM_DIALOG_HEIGHT * 0.5 + 52,
				anchor: { x: 0.5, y: 0.5 },
				text: 'Title',
				style: {
					fontFamily: HUD_FONT_FAMILY,
					fontSize: CONFIRM_DIALOG_TITLE_SIZE,
					fill: HUD_FILL,
					align: 'center',
				},
				paramBindings: { text: 'title' },
				preview: { style: 'text', textParam: 'title' },
			},
			{
				id: 'confirmDialog-image',
				label: 'Image',
				kind: 'sprite',
				x: 0,
				y: -CONFIRM_DIALOG_HEIGHT * 0.08,
				anchor: { x: 0.5, y: 0.5 },
				// No static texture: the mount feeds an optional image key (`assets.dialogImage`).
				// Empty ⇒ no texture resolves ⇒ the dialog is text-only (no crash) — parity-safe.
				assetKey: '',
				width: 180,
				height: 130,
				paramBindings: { assetKey: 'imageKey' },
			},
			{
				id: 'confirmDialog-message',
				label: 'Message',
				kind: 'text',
				x: 0,
				y: CONFIRM_DIALOG_HEIGHT * 0.14,
				anchor: { x: 0.5, y: 0.5 },
				text: 'Message',
				style: {
					fontFamily: HUD_FONT_FAMILY,
					fontSize: CONFIRM_DIALOG_MESSAGE_SIZE,
					fill: HUD_FILL,
					align: 'center',
					wordWrap: true,
					wordWrapWidth: CONFIRM_DIALOG_WIDTH - 80,
				},
				paramBindings: { text: 'message' },
				preview: { style: 'text', textParam: 'message' },
			},
			{
				id: 'confirmDialog-cancel',
				label: 'Cancel button',
				kind: 'container',
				x: -CONFIRM_DIALOG_WIDTH * 0.24,
				y: CONFIRM_DIALOG_HEIGHT * 0.5 - 60,
				// The whole button routes its press to the `cancel` action the mount supplies.
				pressAction: 'cancel',
				children: [
					{
						id: 'confirmDialog-cancel-bg',
						label: 'Background',
						kind: 'rect',
						x: 0,
						y: 0,
						anchor: { x: 0.5, y: 0.5 },
						width: CONFIRM_DIALOG_BUTTON_WIDTH,
						height: CONFIRM_DIALOG_BUTTON_HEIGHT,
						color: CONFIRM_DIALOG_CANCEL_FILL,
					},
					{
						id: 'confirmDialog-cancel-label',
						label: 'Label',
						kind: 'text',
						x: 0,
						y: 0,
						anchor: { x: 0.5, y: 0.5 },
						text: 'Cancel',
						style: {
							fontFamily: HUD_FONT_FAMILY,
							fontSize: CONFIRM_DIALOG_BUTTON_SIZE,
							fill: HUD_FILL,
							align: 'center',
						},
						paramBindings: { text: 'cancelLabel' },
						preview: { style: 'text', textParam: 'cancelLabel' },
					},
				],
			},
			{
				id: 'confirmDialog-confirm',
				label: 'Confirm button',
				kind: 'container',
				x: CONFIRM_DIALOG_WIDTH * 0.24,
				y: CONFIRM_DIALOG_HEIGHT * 0.5 - 60,
				// The whole button routes its press to the `confirm` action the mount supplies.
				pressAction: 'confirm',
				children: [
					{
						id: 'confirmDialog-confirm-bg',
						label: 'Background',
						kind: 'rect',
						x: 0,
						y: 0,
						anchor: { x: 0.5, y: 0.5 },
						width: CONFIRM_DIALOG_BUTTON_WIDTH,
						height: CONFIRM_DIALOG_BUTTON_HEIGHT,
						color: CONFIRM_DIALOG_CONFIRM_FILL,
					},
					{
						id: 'confirmDialog-confirm-label',
						label: 'Label',
						kind: 'text',
						x: 0,
						y: 0,
						anchor: { x: 0.5, y: 0.5 },
						text: 'Confirm',
						style: {
							fontFamily: HUD_FONT_FAMILY,
							fontSize: CONFIRM_DIALOG_BUTTON_SIZE,
							fill: HUD_FILL,
							align: 'center',
						},
						paramBindings: { text: 'confirmLabel' },
						preview: { style: 'text', textParam: 'confirmLabel' },
					},
				],
			},
		],
	},
	params: [
		// Shared style knobs so the owner can restyle the dialog without editing each text node.
		{ key: 'fill', kind: 'color', default: HUD_FILL },
		{ key: 'fontFamily', kind: 'string', default: HUD_FONT_FAMILY, label: 'font' },
		// Engine-fed per-mount values (the `<ConfirmDialog>` mount feeds them). All `engineProvided`,
		// so the editor renders no control — the mount supplies them at runtime.
		{ key: 'title', kind: 'string', engineProvided: true },
		{ key: 'message', kind: 'string', engineProvided: true },
		{ key: 'confirmLabel', kind: 'string', engineProvided: true },
		{ key: 'cancelLabel', kind: 'string', engineProvided: true },
		{ key: 'imageKey', kind: 'string', engineProvided: true },
	],
	// The dialog's two presses — a mount wires them to its `confirm`/`cancel` callbacks (and a
	// downstream author can target them by name).
	signals: [
		{ key: 'confirm', note: 'Fired when the confirm button is pressed.' },
		{ key: 'cancel', note: 'Fired when the cancel button is pressed.' },
	],
};

/** Every built-in component def — the launcher's lowest-precedence layer. */
export const BUILTIN_COMPONENTS: ComponentDef[] = [
	HUD_READOUT_DEF,
	BUTTON_DEF,
	TEXT_BOX_DEF,
	FREE_SPIN_COUNTER_DEF,
	INFO_BAR_DEF,
	LOADING_INTRO_DEF,
	TRANSITION_DEF,
	FREE_SPIN_INTRO_VISUAL_DEF,
	FREE_SPIN_OUTRO_VISUAL_DEF,
	WIN_DEF,
	TAP_TO_CONTINUE_DEF,
	LOADING_BAR_DEF,
	EXPANDING_SYMBOL_DEF,
	FREE_SPIN_INTRO_SYMBOL_REVEAL_DEF,
	FEATURE_CARD_DEF,
	CONFIRM_DIALOG_DEF,
];

/**
 * Union the code-defined ("built-in") params INTO a resolved def, ADDITIVELY — every
 * built-in param whose key the def doesn't already declare is appended (order + the
 * def's own params untouched). A saved component is a FROZEN snapshot of a coded
 * component; when the engine later adds a coded param (e.g. HudReadout's per-text
 * `caption*`/`value*` in v2), an old snapshot would otherwise hide it forever — the
 * coded part reads the param, but the editor renders NO control because the schema is
 * missing it, so the author can never set it. This keeps a coded component's param
 * SCHEMA honest (code is the source of truth) without removing or overriding an
 * author's own params, and without bumping the stored version (resolve-time only —
 * never fed to the save path). A non-built-in id (a purely authored component) passes
 * through untouched. Pure + Svelte-free so the launcher's storage layer can reuse it.
 */
export function mergeBuiltinCodedParams(def: ComponentDef): ComponentDef {
	const builtin = BUILTIN_COMPONENTS.find((b) => b.id === def.id);
	if (!builtin) return def;
	const have = new Set((def.params ?? []).map((p) => p.key));
	const missing = (builtin.params ?? []).filter((p) => !have.has(p.key));
	// Also refresh each node's `paramBindings` from the coded twin (additive, author wins),
	// so a SAVED snapshot gains bindings the coded def added later — e.g. the Text Box's
	// box/align bindings. Merging the params list ALONE would surface the new controls but
	// wire them to nothing (the frozen root has no binding to the inner text node's box).
	const twinById = indexNodesById(builtin.root);
	const nextRoot = mergeNodeBindings(def.root, twinById);
	const rootChanged = nextRoot !== def.root;
	if (!missing.length && !rootChanged) return def;
	return {
		...def,
		params: missing.length ? [...(def.params ?? []), ...missing] : def.params,
		root: rootChanged ? (nextRoot as ComponentDef['root']) : def.root,
	};
}

/** Index every node in a tree by id (for binding-merge lookups). */
function indexNodesById(
	node: LayoutNode,
	out: Map<string, LayoutNode> = new Map(),
): Map<string, LayoutNode> {
	out.set(node.id, node);
	if (node.kind === 'container') for (const child of node.children) indexNodesById(child, out);
	return out;
}

/**
 * Return `node` with any `paramBindings` its coded twin (same id) declares but this node
 * lacks added (author's own bindings win). Recurses into containers. Returns the SAME
 * reference when nothing changed, so the caller can cheaply detect a no-op — additive and
 * parity-safe for every builtin whose coded bindings are unchanged.
 */
function mergeNodeBindings(node: LayoutNode, twinById: Map<string, LayoutNode>): LayoutNode {
	let changed = false;
	let bindings = node.paramBindings;
	const twin = twinById.get(node.id);
	if (twin?.paramBindings) {
		const merged = { ...twin.paramBindings, ...(node.paramBindings ?? {}) };
		if (Object.keys(merged).length > Object.keys(node.paramBindings ?? {}).length) {
			bindings = merged;
			changed = true;
		}
	}
	if (node.kind === 'container') {
		const nextChildren = node.children.map((c) => mergeNodeBindings(c, twinById));
		if (nextChildren.some((c, i) => c !== node.children[i])) {
			return { ...node, paramBindings: bindings, children: nextChildren };
		}
	}
	return changed ? { ...node, paramBindings: bindings } : node;
}
