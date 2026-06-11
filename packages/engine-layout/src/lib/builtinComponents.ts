import { TEXT_SOURCE_KEYS, VALUE_SOURCE_KEYS } from './componentCatalog';
import type { ComponentDef } from './types';

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
	version: 1,
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
		{ key: 'fill', kind: 'color', default: HUD_FILL },
		{ key: 'fontSize', kind: 'number', default: HUD_VALUE_FONT_SIZE },
		{ key: 'fontFamily', kind: 'string', default: HUD_FONT_FAMILY },
		{ key: 'countUp', kind: 'boolean', default: false },
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
		// flag is on, `imageDisabled` is the downstate (engine `disabled` flag), and a
		// missing `imagePressed` falls back to `imageHover` then `image`. All absent ⇒
		// the coded variant tile renders unchanged (parity).
		{ key: 'image', kind: 'image', group: 'State images', label: 'normal' },
		{ key: 'imageHover', kind: 'image', group: 'State images', label: 'hover' },
		{ key: 'imagePressed', kind: 'image', group: 'State images', label: 'pressed' },
		{ key: 'imageSelected', kind: 'image', group: 'State images', label: 'selected' },
		{ key: 'imageDisabled', kind: 'image', group: 'State images', label: 'downstate' },
		{ key: 'disabled', kind: 'boolean', engineProvided: true },
		{ key: 'active', kind: 'boolean', engineProvided: true },
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
		{ key: 'value', kind: 'number', engineProvided: true },
	],
};

/**
 * The free-spin counter panel (`apps/lines` `FreeSpinCounter.svelte`) as an
 * editor-visible/editable component — slice 1 of decomposing the coded overlay
 * (mirrors the §14.3 HUD-readout decomposition). PURELY ADDITIVE: the live game
 * still renders the coded `FreeSpinCounter` via its `bind` anchor in the
 * `freeSpinCounter` scene (parity), so this def is unwired until a later slice
 * flips that anchor to a `componentInstance`.
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
 * Why plain text over reusing `HudCaption`/`HudValue`: the engine layout text
 * path (`LayoutNodeView`) renders text via `<Text>` only — it does NOT yet emit
 * `<BitmapText>` for a `kind:'bitmap'` font (design §9.4 Phase 3 is decided but
 * unlanded), and `HudValue` is hardwired to a NUMERIC currency formatter so it
 * can't render the "X OF Y" string at all. Plain text nodes are fully
 * editor-native + directly editable (the owner-preferred path), correctly express
 * the string value, and will pick up the `gold` bitmap font with no def change the
 * moment §9.4 Phase 3 lands. The coded `FreeSpinCounter` keeps owning the live
 * bitmap render until then.
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
				assetKey: 'Frame_FSCounter.png',
				region: 'Frame_FSCounter.png',
				width: FS_PANEL_WIDTH,
				height: FS_PANEL_HEIGHT,
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
		// The engine visibility feed this counter binds to: when set per-instance to a
		// registered boolean source (e.g. `freeSpinCounterShow`, true only during free
		// spins) the whole instance hides while that source is false. No default — the
		// shared def stays game-agnostic; an instance opts in (slice 2b).
		{ key: 'visibleSource', kind: 'string' },
		{ key: 'label', kind: 'string', default: 'FREE SPIN' },
		{ key: 'fill', kind: 'color', default: HUD_FILL },
		{ key: 'fontSize', kind: 'number', default: FS_FONT_SIZE },
		{ key: 'fontFamily', kind: 'string', default: FS_FONT_FAMILY },
		// Engine-fed "X OF Y" string (the `freeSpins` source); a `string` value so it
		// renders verbatim through the text path, not the numeric readout.
		{ key: 'value', kind: 'string', engineProvided: true },
	],
};

/** Every built-in component def — the launcher's lowest-precedence layer. */
export const BUILTIN_COMPONENTS: ComponentDef[] = [
	HUD_READOUT_DEF,
	BUTTON_DEF,
	TEXT_BOX_DEF,
	FREE_SPIN_COUNTER_DEF,
];
