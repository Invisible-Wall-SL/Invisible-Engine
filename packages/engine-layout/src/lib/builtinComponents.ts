import { BUILTIN_REGION } from './builtinRegions';
import { BUTTON_LOOKS, BUTTON_STATE_IMAGE_PARAMS, type ButtonLook } from './buttonStateImage';
import {
	HOLD_AND_WIN_VALUE_SOURCE_KEYS,
	HOLD_AND_WIN_VISIBILITY_SOURCE_KEYS,
	PLATFORM_JACKPOT_VALUE_SOURCE_KEYS,
	PLATFORM_JACKPOT_VISIBILITY_SOURCE_KEYS,
	TEXT_SOURCE_KEYS,
	VALUE_SOURCE_KEYS,
	VISIBILITY_SOURCE_KEYS,
	type SignalScopeKind,
} from './componentCatalog';
import { kindCapabilities, type KindCapabilityConfig } from './kindCapabilities';
import { POT_SKIN_PARAMS } from './potSkin';
import { WHEEL_SKIN_PARAMS } from './wheelSkin';
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
/** White (`constants-shared` `WHITE`), the coded label fill. */
const HUD_FILL = 0xffffff;
/**
 * The coded ticker tile's BOX — the size `HudTicker` draws its `UiSprite` at
 * (`UI_BASE_FONT_SIZE * 3 * 326/73` × `UI_BASE_FONT_SIZE * 3`). Exported because three
 * surfaces have to agree on it: the coded part, the editor's bound-component catalog (which
 * previews the Background at the size the GAME draws it — the chip stood in at a made-up
 * 240px) and an instance's `backgroundWidth`/`backgroundHeight` overrides, which fall back
 * to exactly these numbers.
 */
export const HUD_TILE_WIDTH = HUD_VALUE_FONT_SIZE * 3 * (326 / 73);
export const HUD_TILE_HEIGHT = HUD_VALUE_FONT_SIZE * 3;
/**
 * The readout's background TICKER width, rounded. Used as the default `alignWidth` — the box
 * the caption/value text aligns WITHIN — so `align: left`/`right` push the text to the
 * background's edges out of the box. A readout with a wider/narrower custom background
 * just overrides `alignWidth` to its own width.
 */
const HUD_ALIGN_WIDTH = Math.round(HUD_TILE_WIDTH);

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
				preview: { w: HUD_TILE_WIDTH, h: HUD_TILE_HEIGHT, style: 'tile' },
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
		// PER-INSTANCE BACKGROUND — the `Background` part (the coded `HudTicker` tile).
		// `backgroundImage` swaps the coded rounded-rect tile for a picked atlas frame, through
		// the same `image`-kind region picker the button's state frames use. It is a PARAM, not
		// another `bind.props` tile knob, precisely so it resolves per PLACED INSTANCE: balance
		// / win / bet can each carry their own art without forking the def (the tile knobs —
		// texture key / outline / corner radius — style the DEF, hence every instance of it).
		// Unset ⇒ the coded tile renders exactly as before (parity). `backgroundTint` multiplies
		// whichever of the two draws. A picked frame sizes by `aspectBox`: blank ⇒ its natural
		// size, ONE of the pair ⇒ the other follows the frame's ratio, both ⇒ that exact box. Only
		// the coded tile falls back to `HUD_TILE_WIDTH` × `HUD_TILE_HEIGHT` — forcing custom art
		// into that 326:73 ratio squashed whatever the author picked, which is also why `alignWidth`
		// exists.
		{ key: 'backgroundImage', kind: 'image', group: 'Background', label: 'image' },
		{ key: 'backgroundTint', kind: 'color', group: 'Background', label: 'tint' },
		{
			key: 'backgroundWidth',
			kind: 'number',
			group: 'Background',
			label: 'width (blank = image size)',
		},
		{
			key: 'backgroundHeight',
			kind: 'number',
			group: 'Background',
			label: 'height (blank = image size)',
		},
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
		...BUTTON_STATE_IMAGE_PARAMS.map((p): ComponentParam => ({
			key: p.key,
			kind: 'image',
			group: 'State images',
			label: p.label,
		})),
		{ key: 'disabled', kind: 'boolean', engineProvided: true },
		{ key: 'active', kind: 'boolean', engineProvided: true },
		{ key: 'spinning', kind: 'boolean', engineProvided: true },
	],
};

// ---------------------------------------------------------------------------------------------
// THE AUTHORED BUTTON (Rive plan Phase 8d, `docs/design/rive-style-editor.md` §13.8): how the
// parametric `button` looks per state — the coded `ButtonFrame`'s frame, its spin rotation, the
// `uiShow` / `uiHide` fade and the press sound — as nodes a seeded state machine drives. The press
// road and the gates that feed the flags stay coded; the label stays the coded `ButtonLabel`.
// ---------------------------------------------------------------------------------------------

export const BUTTON_PRESENTATION_ID = 'buttonPresentation';

/** The node names the button machine's timelines bind (labels, unique within the def). */
export const BUTTON_PRESENTATION_NODES = {
	fade: 'fade',
	frame: 'frame',
	label: 'label',
} as const;

/** `UiSprite`'s corner radius (`<Rectangle borderRadius={50}>`). */
const BUTTON_TILE_RADIUS = 50;
/** The coded frame's painted downstate: the tile fill, or the frame sprite's tint. */
export const BUTTON_DISABLED_GREY = 0xaaaaaa;
/** The coded frame's active border on the tile. */
const BUTTON_ACTIVE_BORDER = 10;
/** The press sounds a press can hand the machine — the game's `Sound` events, by name. */
export const BUTTON_PRESS_SOUNDS = [
	'soundPressGeneral',
	'soundPressBet',
	'soundPressStop',
] as const;
/** The machine's reserved inputs, fed by the instance (`ComponentDef.buttonStates`). */
export const BUTTON_STATE_INPUTS = {
	look: 'look',
	rotating: 'rotating',
	fadeWithUi: 'fadeWithUi',
	uiHide: 'uiHide',
	uiShow: 'uiShow',
} as const;
/** The coded `FadeContainer`'s default tween — the HUD's `uiShow` / `uiHide` fade. */
export const BUTTON_FADE_MS = 400;

const buttonTimelineId = (suffix: string): string => `c_buttonpresentation_${suffix.toLowerCase()}`;
export const buttonLookTimelineId = (look: ButtonLook): string => buttonTimelineId(`look_${look}`);
export const BUTTON_SPIN_STILL_TIMELINE_ID = buttonTimelineId('spin_still');
export const BUTTON_SPIN_ROTATING_TIMELINE_ID = buttonTimelineId('spin_rotating');
export const BUTTON_FADE_SHOWN_TIMELINE_ID = buttonTimelineId('fade_shown');
export const BUTTON_FADE_HIDDEN_TIMELINE_ID = buttonTimelineId('fade_hidden');
export const BUTTON_SOUND_QUIET_TIMELINE_ID = buttonTimelineId('sound_quiet');
export const buttonSoundTimelineId = (sound: string): string => buttonTimelineId(`sound_${sound}`);

const tileNode = (look: ButtonLook, disabled: boolean, active: boolean): LayoutNode => ({
	id: `buttonPresentation-${look}`,
	label: look,
	kind: 'rect',
	x: 0,
	y: 0,
	anchor: { x: 0.5, y: 0.5 },
	width: BUTTON_BASE_SIZE,
	height: BUTTON_BASE_SIZE,
	borderRadius: BUTTON_TILE_RADIUS,
	...(disabled ? { color: BUTTON_DISABLED_GREY } : {}),
	...(active ? { borderWidth: BUTTON_ACTIVE_BORDER } : {}),
	paramBindings: {
		...(disabled ? {} : { color: 'tileColor' }),
		...(active ? { borderColor: 'tileBorderColor' } : {}),
	},
});

const imageNode = (look: ButtonLook, grey: boolean): LayoutNode => ({
	id: `buttonPresentation-${look}`,
	label: look,
	kind: 'sprite',
	x: 0,
	y: 0,
	anchor: { x: 0.5, y: 0.5 },
	// No static texture: the frame is the bound `image` (a look with none never shows this node).
	assetKey: '',
	width: BUTTON_BASE_SIZE,
	height: BUTTON_BASE_SIZE,
	...(grey ? { tint: BUTTON_DISABLED_GREY } : {}),
	paramBindings: { region: 'image' },
});

/** One look's state: the look's frame node shown, the other five hidden. */
const lookState = (look: ButtonLook) => ({ id: look, timeline: buttonLookTimelineId(look) });

/**
 * The AUTHORED parametric button (Rive plan Phase 8d, §13.8.2): beside, not instead of, `button`
 * (whose bound `ButtonFrame` stays the coded path). Same params as `button`, so a swapped instance
 * keeps its own. `internal`: nothing references it until a project turns on
 * `settings.authoredOverlays.buttons`, and no palette offers it during the pilot.
 *
 * `fade` (the fade layer's alpha) › `frame` (the spin layer's rotation, the `tint` param — the coded
 * frame tints its container) › the six frame nodes, one shown per look (`BUTTON_LOOKS`): four
 * rounded-rect tiles, each the ONE `Rectangle` the coded `UiSprite` draws for that look (variant
 * fill or the grey, with or without the active border), and the state frame sprite plain or greyed,
 * its `region` the cascade-resolved frame the instance provides as `image`; then `label`, the coded
 * `ButtonLabel`, outside `frame` as it is coded. The machine's four layers each key their own nodes.
 */
export const BUTTON_PRESENTATION_DEF: ComponentDef = {
	id: BUTTON_PRESENTATION_ID,
	name: 'Button presentation',
	version: 1,
	scope: 'shared',
	category: 'ui',
	internal: true,
	frameExact: true,
	buttonStates: true,
	settles: true,
	root: {
		id: 'buttonPresentation-root',
		kind: 'container',
		x: 0,
		y: 0,
		children: [
			{
				id: 'buttonPresentation-fade',
				label: BUTTON_PRESENTATION_NODES.fade,
				kind: 'container',
				x: 0,
				y: 0,
				children: [
					{
						id: 'buttonPresentation-frame',
						label: BUTTON_PRESENTATION_NODES.frame,
						kind: 'container',
						x: 0,
						y: 0,
						paramBindings: { tint: 'tint' },
						children: [
							tileNode('tile', false, false),
							tileNode('tileDisabled', true, false),
							tileNode('tileActive', false, true),
							tileNode('tileDisabledActive', true, true),
							imageNode('image', false),
							imageNode('imageDisabled', true),
						],
					},
					{
						id: 'buttonPresentation-label',
						label: BUTTON_PRESENTATION_NODES.label,
						kind: 'container',
						x: 0,
						y: 0,
						anchor: { x: 0.5, y: 0.5 },
						bind: { component: 'ButtonLabel' },
						children: [],
					},
				],
			},
		],
	},
	inputs: [
		{ id: BUTTON_STATE_INPUTS.look, kind: 'number', note: 'The frame look (fed by the instance).' },
		{ id: BUTTON_STATE_INPUTS.rotating, kind: 'bool', note: 'The spin frame rotates.' },
		{ id: BUTTON_STATE_INPUTS.fadeWithUi, kind: 'bool', note: 'The button fades on its own.' },
		{ id: BUTTON_STATE_INPUTS.uiHide, kind: 'trigger', note: 'The game hides its UI.' },
		{ id: BUTTON_STATE_INPUTS.uiShow, kind: 'trigger', note: 'The game shows its UI.' },
		...BUTTON_PRESS_SOUNDS.map((sound) => ({
			id: sound,
			kind: 'trigger' as const,
			note: 'A press makes this sound.',
		})),
	],
	stateMachine: {
		layers: [
			{
				id: 'look',
				name: 'Look',
				entry: 'tile',
				states: BUTTON_LOOKS.map(lookState),
				transitions: BUTTON_LOOKS.map((look, index) => ({
					id: `to-${look}`,
					from: 'any',
					to: look,
					conditions: [{ input: BUTTON_STATE_INPUTS.look, op: '==' as const, value: index }],
				})),
			},
			{
				id: 'spin',
				name: 'Spin',
				entry: 'still',
				states: [
					{ id: 'still', timeline: BUTTON_SPIN_STILL_TIMELINE_ID },
					{ id: 'rotating', timeline: BUTTON_SPIN_ROTATING_TIMELINE_ID, loop: true },
				],
				transitions: [
					{
						id: 'start',
						from: 'still',
						to: 'rotating',
						conditions: [{ input: BUTTON_STATE_INPUTS.rotating, op: '==', value: true }],
					},
					{
						id: 'stop',
						from: 'rotating',
						to: 'still',
						conditions: [{ input: BUTTON_STATE_INPUTS.rotating, op: '==', value: false }],
					},
				],
			},
			{
				id: 'fade',
				name: 'Fade',
				entry: 'shown',
				states: [
					{ id: 'shown', timeline: BUTTON_FADE_SHOWN_TIMELINE_ID },
					{ id: 'hidden', timeline: BUTTON_FADE_HIDDEN_TIMELINE_ID },
				],
				transitions: [
					{
						id: 'hide',
						from: 'shown',
						to: 'hidden',
						conditions: [
							{ input: BUTTON_STATE_INPUTS.uiHide, op: 'fired' },
							{ input: BUTTON_STATE_INPUTS.fadeWithUi, op: '==', value: true },
						],
						blend: BUTTON_FADE_MS,
					},
					{
						id: 'show',
						from: 'hidden',
						to: 'shown',
						conditions: [
							{ input: BUTTON_STATE_INPUTS.uiShow, op: 'fired' },
							{ input: BUTTON_STATE_INPUTS.fadeWithUi, op: '==', value: true },
						],
						blend: BUTTON_FADE_MS,
					},
				],
			},
			{
				id: 'sound',
				name: 'Press sound',
				entry: 'quiet',
				states: [
					{ id: 'quiet', timeline: BUTTON_SOUND_QUIET_TIMELINE_ID },
					...BUTTON_PRESS_SOUNDS.map((sound) => ({
						id: sound,
						timeline: buttonSoundTimelineId(sound),
					})),
				],
				// From any other state, and again from its own (a second press of the same sound).
				transitions: BUTTON_PRESS_SOUNDS.flatMap((sound) => [
					{
						id: `play-${sound}`,
						from: 'any',
						to: sound,
						conditions: [{ input: sound, op: 'fired' as const }],
					},
					{
						id: `replay-${sound}`,
						from: sound,
						to: sound,
						conditions: [{ input: sound, op: 'fired' as const }],
					},
				]),
			},
		],
	},
	params: [
		...(BUTTON_DEF.params ?? []),
		{ key: 'fadeWithUi', kind: 'boolean', default: false, label: 'fade on UI show / hide' },
	],
};

/** The default `textBox` body size — readable at HUD scale without dwarfing it. */
const TEXT_BOX_FONT_SIZE = 32;

/**
 * §text-box model, as PER-INSTANCE component params — the bindings a text node needs so an
 * author can give it a fixed box (`boxWidth`/`boxHeight`/`padding`), align the glyphs inside it
 * and auto-shrink the font to stay in it. Declared ONCE ({@link TEXT_BOX_LAYOUT_PARAMS} is the
 * matching control list) because every text-bearing component wants the same thing, and the two
 * halves are useless apart: params without bindings render controls wired to nothing.
 *
 * `LayoutNodeView` / `EditorTextLayer` resolve these off the node, so a component only has to
 * declare them — the box math itself is shared (`textBoxLayout.ts`).
 */
const TEXT_BOX_LAYOUT_BINDINGS: Record<string, string> = {
	'style.align': 'align',
	'style.verticalAlign': 'verticalAlign',
	width: 'boxWidth',
	height: 'boxHeight',
	padding: 'padding',
	autoFit: 'autoFit',
};

/**
 * The editor controls for {@link TEXT_BOX_LAYOUT_BINDINGS}. Unset `boxWidth` ⇒ no box ⇒ the text
 * auto-sizes exactly as it did before (parity), so these are additive on any component.
 *
 * `align`/`verticalAlign` take DEFAULTS because inside a box they decide where the block sits, and
 * unset means "left/top". A component whose text node is anchor-centred (the Info Bar's message,
 * centred on its plaque) must default to `center`/`middle`, or merely giving it a box width would
 * shove the text to the box's left edge — the author ticks one box and the text jumps.
 */
function textBoxLayoutParams(
	defaults: { align?: string; verticalAlign?: string } = {},
): ComponentParam[] {
	return [
		{
			key: 'align',
			kind: 'string',
			options: ['left', 'center', 'right'],
			label: 'align',
			...(defaults.align ? { default: defaults.align } : {}),
		},
		{
			key: 'verticalAlign',
			kind: 'string',
			options: ['top', 'middle', 'bottom'],
			label: 'vertical align',
			...(defaults.verticalAlign ? { default: defaults.verticalAlign } : {}),
		},
		{ key: 'boxWidth', kind: 'number', label: 'box width (blank = fit text)' },
		{ key: 'boxHeight', kind: 'number', label: 'box height (blank = fit text)' },
		{ key: 'padding', kind: 'number', label: 'box padding (px)' },
		{
			key: 'autoFit',
			kind: 'boolean',
			default: false,
			label: 'auto-fit font to box (needs a box width)',
		},
	];
}

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
					...TEXT_BOX_LAYOUT_BINDINGS,
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
		// No alignment defaults: a Text Box is placed by its own anchor, and its historical
		// unset-align behaviour is the parity baseline for every already-authored instance.
		...textBoxLayoutParams(),
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
					// Text-box layout (§text-box model), the SAME per-instance box the Text Box
					// exposes — the bar's line is engine-fed and LOCALIZED, so a translation is
					// routinely longer than the English the plaque was drawn for. Set `boxWidth`
					// to the plaque's inner width + `autoFit` and the message shrinks to stay
					// inside the frame instead of spilling past its ends. Unset ⇒ auto-size
					// (byte-identical to the old bar — parity).
					...TEXT_BOX_LAYOUT_BINDINGS,
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
		// The message line is engine-fed and LOCALIZED — a translation is routinely longer than
		// the English the plaque art was drawn for, so the bar needs the box + auto-fit knobs to
		// keep the text inside its frame. Centred by default: the message node is anchor-centred
		// on the plaque, so setting a box width alone must not shift the text off-centre.
		...textBoxLayoutParams({ align: 'center', verticalAlign: 'middle' }),
		// Engine-fed message string (the `message` source); a `string` value so it renders
		// verbatim through the text path, not the numeric readout.
		{ key: 'value', kind: 'string', engineProvided: true },
	],
};

/** The coded splash logo (`apps/lines` `LoadingScreen.svelte` `RigProvider key="loader"`
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
 * `transition` event → play `TransitionAnimation` → rig `complete` → resolve the
 * round-blocking `await broadcastAsync`). What the migration changes is OWNERSHIP OF
 * POSITION: under the `TRANSITION_INSTANCE` flag the coded part renders at its LOCAL
 * origin (see `Transition.svelte` / `TransitionAnimation.svelte`), so the editor node's
 * transform places the wipe — drag/scale the instance to move it — instead of the coded
 * part hardcoding canvas-centre. Placed `canvas`-space centred (`screenAnchor {0.5,0.5}`)
 * to reproduce the coded centre, and the coded part still reads `canvasSizes()` for its
 * height so sizing stays viewport-responsive (no baked size). Animation stays coded (no
 * per-rig cue); the editor owns placement. The intro/outro extend this by also
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
 * The AUTHORED Transition (Rive plan Phase 8a, `docs/design/rive-style-editor.md` §13.2): the
 * same full-screen wipe as the coded `Transition` part, as a component the editor owns end to end
 * — one rig node, `wipe`, on the engine's static `transition` bundle, and a built-in timeline
 * (`builtinTimelines.ts`) that plays its clip on the game's `transition` cue and holds the awaited
 * cue until the clip ends. The node reproduces the coded part's placement exactly: a `coverFit`
 * rig in a `canvas` scene centres on the canvas and `fit: 'height'` × `coverScale` 1.7 sizes it to
 * 1.7 × the canvas height, which is `TransitionAnimation`'s `height = canvasHeight × 1.7` at the
 * canvas centre; so the instance is placed at (0, 0) with no anchor, and the rig node carries no
 * anchor (pivot 0 — the skeleton origin at the centre, as `RigProvider` placed the coded one).
 * `hiddenUntilSignal` keeps the rig off screen until the cue first fires; the timeline's visibility
 * track hides it again when the clip ends (the coded part unmounted its rig at `complete`).
 *
 * A NEW id beside `transition` (the hybrid twin whose bound child is still the coded part): a game
 * that baked a copy of `transition`, or placed it, is untouched. Nothing references this def until
 * a project turns on `settings.authoredOverlays.transition`; the game then swaps its
 * `bind: Transition` node for an instance of this def (`authoredOverlays.ts`, this package). The
 * coded part retires, and `transition` moves to this content as its next version, only after the
 * owner's browser check (§13.2 "Removal").
 */
export const TRANSITION_WIPE_DEF: ComponentDef = {
	id: 'transitionWipe',
	name: 'Transition wipe',
	version: 1,
	scope: 'shared',
	category: 'overlay',
	internal: true,
	root: {
		id: 'transitionWipe-root',
		kind: 'container',
		x: 0,
		y: 0,
		children: [
			{
				id: 'transitionWipe-rig',
				label: 'wipe',
				kind: 'spine',
				x: 0,
				y: 0,
				assetKey: 'transition',
				coverFit: true,
				fit: 'height',
				coverScale: 1.7,
				hiddenUntilSignal: 'transition',
			},
		],
	},
};

/**
 * The board-relative VISUAL of the free-spin INTRO (§17 Phase 3) — the editor-positioned
 * half of the intro/gate split. Wraps the coded `FreeSpinIntroVisual` (the `FreeSpinAnimation`
 * frame rig + the count rig, count in its slot) as a `bind` child with
 * `boundToInstance:true`, so the coded part renders at THIS instance's node position
 * instead of self-centring on the board — drag/scale the instance to move the intro art.
 * The dim, the tap and the round-blocking hold belong to the flow's intro screen (its
 * `tapToContinue` + a `showContainer{awaitComplete}`), not to this visual. Placed `game`-space,
 * defaulted to board-centre (the scene node sets `x/y = boardLayout`), so parity holds at
 * the default position. Params forward the rig bundle / animations / slot to the part.
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
		{ key: 'introSpine', kind: 'spine', default: 'fsIntroNumber', label: 'intro rig bundle' },
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
 * coded `FreeSpinOutroVisual` (the `FreeSpinAnimation` frame rig + win sprites + the
 * count rig, count in its slot reading the count-up amount the engine's outro driver
 * publishes) as a `bind` child with `boundToInstance:true`. The dim, the tap and the
 * round-blocking hold belong to the flow's outro screen, not to this visual.
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
		{ key: 'outroSpine', kind: 'spine', default: 'fsOutroNumber', label: 'outro rig bundle' },
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
 * `WinVisual` (the tier rig via `WinAnimation` + the count number in its slot, reading the gate's
 * published count-up amount + win level from `winState`) as a `bind` child with
 * `boundToInstance:true`, so the coded part renders at THIS instance's node position instead of
 * self-centring on the board — drag/scale the instance to move the big-win art. The full-screen GATE
 * (dim + count-up driver + WinCoins + press + round-await) stays the coded `canvas` bind `WinGate`.
 *
 * ANIMATION + RIG + DURATION + SOUND per BIG TIER — the presentation half of the config/component
 * split (`docs/tools/game-config.md`): the `/config` panel owns tier STRUCTURE (count / name /
 * threshold / type / escalation); this component owns per-tier PRESENTATION. The per-tier groups are
 * GENERATED from the active game config's big tiers (keyed by the tier's ALIAS) via
 * {@link winTierPresentationParams}, so the two stay in sync — a config that authors `big`/`mega`/`max`
 * gets exactly those three groups. The built-in {@link WIN_DEF} is generated from
 * {@link DEFAULT_WIN_TIERS} (the coded `winLevelMap`'s big tiers) so an un-authored project renders
 * byte-identically; the editor rebuilds the def from the ACTIVE config's tiers on load.
 *
 * Per tier `<alias>` the group carries: `<alias>rig` (rig picker), `<alias>Slot` (that rig's
 * count slot), `<alias>Intro`/`Idle`/`Outro`
 * (`spineAnimation` dropdowns of the tier's chosen rig — no blind typing), `<alias>Duration` (ms),
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
 * Per-tier presentation params for the `win` component — a rig picker + a count-slot dropdown +
 * intro/idle/outro dropdowns (of that rig's animations) + duration, ONE collapsible
 * group per tier, keyed by the
 * tier's ALIAS so the runtime resolves each field by `<alias><Field>`. Generated from a big-tier list
 * (the active config's tiers, or {@link DEFAULT_WIN_TIERS} un-authored) so the component's groups mirror
 * the config's tiers. The per-tier `<alias>rig` carries NO default, so an unset tier rig falls back
 * to the config `spineKey` then the shared `winSpine` at runtime (correct precedence); the editor's
 * animation dropdowns fall back to `winSpine`'s animations when the tier rig is unset.
 *
 * A tier's SOUNDS are not here. They are authored in Invisible Sound, with the rest of the game's
 * audio and next to the button that plays it. The `<alias>Sfx` / `<alias>Bgm` params a project
 * authored before that move are still READ at runtime (`withWinPresentation`, below the sound doc)
 * — dropping the pickers must not silence a game that already shipped with them, only stop new ones
 * from being written where nobody would think to look for them.
 */
export function winTierPresentationParams(tiers: WinTierMeta[]): ComponentParam[] {
	return tiers.flatMap(({ alias, name }): ComponentParam[] => {
		const rigParam = `${alias}Spine`;
		return [
			{ key: rigParam, kind: 'spine', group: name, label: 'rig bundle' },
			// The tier's own COUNT SLOT. A tier that points at its own rig almost never repeats the base
			// bundle's slot name, and without this there was no way to say so: every tier inherited the
			// shared `slotName`, so the count silently failed to mount on any tier whose rig lacked it
			// (`[RigSlot] no slot "slot_win_count"`). Empty ⇒ the shared `slotName` ⇒ parity. The
			// dropdown lists the TIER rig's slots, falling back to `winSpine`'s when the tier rig is
			// unset — the same resolution the intro/idle/outro dropdowns already use.
			{
				key: `${alias}Slot`,
				kind: 'spineSlot',
				spineParam: rigParam,
				group: name,
				label: 'count slot',
			},
			{
				key: `${alias}Intro`,
				kind: 'spineAnimation',
				spineParam: rigParam,
				group: name,
				label: 'intro',
			},
			{
				key: `${alias}Idle`,
				kind: 'spineAnimation',
				spineParam: rigParam,
				group: name,
				label: 'idle',
			},
			{
				key: `${alias}Outro`,
				kind: 'spineAnimation',
				spineParam: rigParam,
				group: name,
				label: 'outro',
			},
			{ key: `${alias}Duration`, kind: 'number', group: name, label: 'duration (ms)' },
		];
	});
}

/** The `win` component's base + shared params (everything that is NOT a per-tier group). */
const WIN_BASE_PARAMS: ComponentParam[] = [
	{ key: 'winSpine', kind: 'spine', default: 'bigwin', label: 'big-win rig bundle' },
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

/** The coded board cell (`engine-game` `SYMBOL_SIZE`), the unit `WinVisual` sized its text by. */
const WIN_SYMBOL_SIZE = 120;

/** The coded `FadeContainer`'s tween: 400 ms, linear (`svelte/motion` `Tween` defaults). */
export const WIN_FADE_MS = 400;
/** The fade layer's two static poses (generated beside the tier timelines, `builtinTimelines.ts`). */
export const WIN_FADE_HIDDEN_TIMELINE_ID = 'c_winpresentation_fade_hidden';
export const WIN_FADE_SHOWN_TIMELINE_ID = 'c_winpresentation_fade_shown';

/** The shared rig + count slot the coded `WinVisual` hardcoded — `WIN_BASE_PARAMS`' defaults, the
 *  one fact the synthesized `winVisual` instance and the game's tier resolution both read. */
export const WIN_PRESENTATION_DEFAULTS = {
	winSpine: 'bigwin',
	slotName: 'slot_win_count',
} as const;

/** One big tier the authored win presentation (Rive plan Phase 8b) is generated for. */
export interface WinPresentationTier extends WinTierMeta {
	/** The tier's Win Text caption (`winLevels.<alias>`, a key or source text); empty ⇒ none drawn. */
	caption?: string;
	/** The spins modes' own captions for the tier (mode id → caption), when they differ. */
	modeCaptions?: Record<string, string>;
}

/** The node names the generated win timelines bind (`findActorNode` matches a component's nodes by label). */
export const WIN_PRESENTATION_NODES = {
	fade: 'fade',
	visual: 'visual',
	coins: 'coins',
	tier: 'tier',
	caption: 'caption',
	count: 'count',
	countPlain: 'countPlain',
} as const;

const winGoldText = (fontSize: number) => ({
	fontFamily: 'gold',
	fontSize,
	align: 'center' as const,
	fontWeight: 'bold',
	letterSpacing: 0,
});

/**
 * The AUTHORED big-win presentation (Rive plan Phase 8b, `docs/design/rive-style-editor.md`
 * §13.6.3): what the coded `WinVisual` draws, as nodes the generated per-tier timelines
 * (`winTierTimelines`) drive — beside, not instead of, the `win` twin whose bound child is still
 * the coded part. Same params as `win` (a `win` instance's params map one-to-one when the game
 * swaps it), generated from the same tier list. `internal`: nothing references it until a project
 * turns on `settings.authoredOverlays.win`, and no palette offers it during the pilot.
 *
 * Root, back to front as `WinVisual` stacks them, inside a `fade` container holding a `visual`
 * container. The `fade` node's alpha is the coded `FadeContainer`'s TWEEN, reproduced by the def's
 * state machine (one layer, `hidden` ⇄ `shown`, 400 ms linear blends on the `winFade` / `winHide`
 * triggers): that container fades IN on every win (its mount, then every `show`) and, on
 * `winHide`, tweens to 0 FROM WHEREVER IT IS — a hide inside the fade-in (a slammed win) leaves
 * from the half-faded value, which only a blend from the pose on screen can do, not a keyed
 * timeline. The `visual` node's visibility is the mount the coded container dropped at alpha 0
 * (the hide and rest timelines key it) — a separate node, because a timeline wins a node whole:
 * - `tier` — ONE rig node on the shared `winSpine` bundle, no resting clip (nothing drawn until a
 *   tier timeline poses it); its `boardFit` is bound to the `fitBoard` param (default off), which
 *   ONLY the synthesized `winVisual` instance turns on — the coded composer fitted the rig to the
 *   board width, a placed `win` instance rendered at its natural size, and the swap keeps both;
 * - `caption` / `count` — text nodes riding the rig's count slot (`rigSlot`, bound to `slotName`),
 *   as the coded ones did through `<RigSlot>`; the count reads the live `winCountUpAmount` through
 *   the def's `source` param (self-animated, currency-formatted — the HudReadout road), the caption
 *   is switched to a tier's Win Text key by that tier's walk timeline (`switchKeys` lists them);
 * - `countPlain` — the small / medium number, shown only by the plain timeline;
 * - `coins` — LAST, in front: the coded `WinCoins` fountain as a bound child (`showCoins` read by
 *   the part). The emitter adds each particle straight into its enclosing container as it spawns,
 *   so on the coded path the coins land after the rig and draw over the banner; the node sits last
 *   for the same reason (measured by `check:win-parity`: first, they hid behind the banner).
 */
export function winPresentationDef(tiers: WinPresentationTier[] = DEFAULT_WIN_TIERS): ComponentDef {
	const captions = [
		...new Set(
			tiers
				.flatMap((tier) => [tier.caption ?? '', ...Object.values(tier.modeCaptions ?? {})])
				.filter((caption) => caption.length > 0),
		),
	];
	return {
		id: 'winPresentation',
		name: 'Win presentation',
		version: 1,
		scope: 'shared',
		category: 'overlay',
		internal: true,
		frameExact: true,
		settles: true,
		root: {
			id: 'winPresentation-root',
			kind: 'container',
			x: 0,
			y: 0,
			children: [
				{
					id: 'winPresentation-fade',
					label: WIN_PRESENTATION_NODES.fade,
					kind: 'container',
					x: 0,
					y: 0,
					children: [
						{
							id: 'winPresentation-visual',
							label: WIN_PRESENTATION_NODES.visual,
							kind: 'container',
							x: 0,
							y: 0,
							children: [
								{
									id: 'winPresentation-tier',
									label: WIN_PRESENTATION_NODES.tier,
									kind: 'spine',
									x: 0,
									y: 0,
									assetKey: WIN_PRESENTATION_DEFAULTS.winSpine,
									paramBindings: { assetKey: 'winSpine', boardFit: 'fitBoard' },
								},
								{
									id: 'winPresentation-caption',
									label: WIN_PRESENTATION_NODES.caption,
									kind: 'text',
									x: 0,
									y: -WIN_SYMBOL_SIZE * 2.6,
									anchor: { x: 0.5, y: 0.5 },
									text: '',
									...(captions.length ? { switchKeys: captions } : {}),
									style: winGoldText(WIN_SYMBOL_SIZE * 1.8),
									rigSlot: WIN_PRESENTATION_DEFAULTS.slotName,
									paramBindings: { rigSlot: 'slotName' },
								},
								{
									id: 'winPresentation-count',
									label: WIN_PRESENTATION_NODES.count,
									kind: 'text',
									x: 0,
									y: 0,
									anchor: { x: 0.5, y: 0.5 },
									text: '',
									style: winGoldText(WIN_SYMBOL_SIZE * 3.6),
									rigSlot: WIN_PRESENTATION_DEFAULTS.slotName,
									paramBindings: { text: 'value', rigSlot: 'slotName' },
								},
								{
									id: 'winPresentation-countPlain',
									label: WIN_PRESENTATION_NODES.countPlain,
									kind: 'text',
									x: 0,
									y: 0,
									anchor: { x: 0.5, y: 0.5 },
									text: '',
									style: winGoldText(WIN_SYMBOL_SIZE),
									paramBindings: { text: 'value' },
								},
								{
									id: 'winPresentation-coins',
									label: WIN_PRESENTATION_NODES.coins,
									kind: 'container',
									x: 0,
									y: 0,
									bind: { component: 'WinCoins' },
									children: [],
								},
							],
						},
					],
				},
			],
		},
		inputs: [
			// Fired by the gate when the coded `FadeContainer` would start its tween: on `winShow` once a
			// presentation has mounted before, and one frame after the FIRST `winUpdate` (the coded
			// container's mount awaits a zero-length tween before it fades in).
			{ id: 'winFade', kind: 'trigger', note: 'The win presentation fades in.' },
			{ id: 'winHide', kind: 'trigger', note: 'The win presentation ends.' },
		],
		stateMachine: {
			layers: [
				{
					id: 'fade',
					name: 'Fade',
					entry: 'hidden',
					states: [
						{ id: 'hidden', timeline: WIN_FADE_HIDDEN_TIMELINE_ID },
						{ id: 'shown', timeline: WIN_FADE_SHOWN_TIMELINE_ID },
					],
					transitions: [
						{
							id: 'show',
							from: 'any',
							to: 'shown',
							conditions: [{ input: 'winFade', op: 'fired' }],
							blend: WIN_FADE_MS,
						},
						{
							id: 'hide',
							from: 'any',
							to: 'hidden',
							conditions: [{ input: 'winHide', op: 'fired' }],
							blend: WIN_FADE_MS,
						},
					],
				},
			],
		},
		params: [
			// The live count: the game's `winCountUpAmount` value source (self-animated, so the bound
			// text snaps to it each frame — no second count-up on top).
			{ key: 'source', kind: 'string', default: 'winCountUpAmount', options: VALUE_SOURCE_KEYS },
			// Fit the tier rig to the game's board width (the coded composer's size). Off by default: a
			// placed instance keeps its natural size, as the coded `win` instance did.
			{ key: 'fitBoard', kind: 'boolean', default: false, label: 'fit to board width' },
			...WIN_BASE_PARAMS,
			...winTierPresentationParams(tiers),
		],
	};
}

export const WIN_PRESENTATION_DEF: ComponentDef = winPresentationDef();

// ---------------------------------------------------------------------------------------------
// THE AUTHORED FREE-SPIN INTRO / OUTRO (Rive plan Phase 8c, `docs/design/rive-style-editor.md`
// §13.7): what the coded `FreeSpinIntroVisual` / `FreeSpinOutroVisual` draw, as nodes the built-in
// free-spin timelines (`builtinTimelines.ts`) drive. The coded outro driver, the screens' taps and
// the flow's holds stay coded; nothing here holds a cue (the coded visuals held nothing).
// ---------------------------------------------------------------------------------------------

export const FREE_SPIN_INTRO_PRESENTATION_ID = 'freeSpinIntroPresentation';
export const FREE_SPIN_OUTRO_PRESENTATION_ID = 'freeSpinOutroPresentation';

/** The node names the free-spin timelines bind (labels, unique within each def). */
export const FREE_SPIN_PRESENTATION_NODES = {
	fade: 'fade',
	visual: 'visual',
	frame: 'frame',
	content: 'content',
	number: 'number',
	count: 'count',
	caption: 'caption',
	footer: 'footer',
	captionBig: 'captionBig',
	captionSmall: 'captionSmall',
	footerBig: 'footerBig',
	footerSmall: 'footerSmall',
} as const;

/** The coded rigs, clips and slots `FreeSpinAnimation` / the two visuals hardcoded (their defaults). */
export const FREE_SPIN_PRESENTATION_RIGS = {
	frame: 'fsIntro',
	frameSlot: 'slot_text_placeholder',
	introNumber: 'fsIntroNumber',
	outroNumber: 'fsOutroNumber',
	numberSlot: 'slot_number',
	intro: 'intro',
	idle: 'idle',
} as const;

/** The fade layer's poses, one pair per def (the 8b fade machine, `WIN_FADE_MS`). */
export const freeSpinFadeTimelineId = (defId: string, pose: 'hidden' | 'shown'): string =>
	`c_${defId.toLowerCase()}_fade_${pose}`;

/**
 * The game signals the presentations show and hide on — registered by the game only on the authored
 * path, each fired one animation frame after its emitter event (`freeSpinIntroShow`, the outro's
 * `freeSpinOutroCountUp` by win level, `freeSpinIntroHide` / `freeSpinOutroHide`): the coded
 * `FadeContainer` starts its tween, and mounts its rigs, on the tick after the event, so a fire on
 * the event ran the whole presentation a frame ahead (measured by `check:freespin-parity`).
 */
export const FREE_SPIN_INTRO_SHOW_SIGNAL = 'freeSpinIntroShown';
export const FREE_SPIN_INTRO_HIDE_SIGNAL = 'freeSpinIntroHidden';
export const FREE_SPIN_OUTRO_BIG_SIGNAL = 'freeSpinOutroShownBig';
export const FREE_SPIN_OUTRO_SMALL_SIGNAL = 'freeSpinOutroShownSmall';
export const FREE_SPIN_OUTRO_HIDE_SIGNAL = 'freeSpinOutroHidden';
/** The game text source the intro count reads (the coded visual's own `freeSpinIntroUpdate` number). */
export const FREE_SPIN_INTRO_COUNT_SOURCE = 'freeSpinIntroCount';

export interface FreeSpinPresentationInput {
	/** The board cell (`engine-game` `SYMBOL_SIZE`). */
	symbolSize: number;
	/** The board's columns (`boardDimensions().x`). */
	boardColumns: number;
	/** The boot's language — the localized sprites' key suffix (`freespins_{lang}.png`). */
	lang: string;
}

const FS_DEFAULT_INPUT: FreeSpinPresentationInput = {
	symbolSize: 120,
	boardColumns: 5,
	lang: 'en',
};

const fsSprite = (
	label: string,
	assetKey: string,
	anchorY: number,
	width: number,
	height: number,
): LayoutNode => ({
	id: `fs-${label}`,
	label,
	kind: 'sprite',
	x: 0,
	y: 0,
	anchor: { x: 0.5, y: anchorY },
	assetKey,
	width,
	height,
});

const fsFadeMachine = (defId: string, show: string[], hide: string) => ({
	layers: [
		{
			id: 'fade',
			name: 'Fade',
			entry: 'hidden',
			states: [
				{ id: 'hidden', timeline: freeSpinFadeTimelineId(defId, 'hidden') },
				{ id: 'shown', timeline: freeSpinFadeTimelineId(defId, 'shown') },
			],
			transitions: [
				...show.map((input) => ({
					id: `show-${input}`,
					from: 'any' as const,
					to: 'shown',
					conditions: [{ input, op: 'fired' as const }],
					blend: WIN_FADE_MS,
				})),
				{
					id: 'hide',
					from: 'any' as const,
					to: 'hidden',
					conditions: [{ input: hide, op: 'fired' as const }],
					blend: WIN_FADE_MS,
				},
			],
		},
	],
});

/**
 * The two AUTHORED free-spin presentations for this boot (§13.7.2), generated because the coded
 * sizes are fractions of the board width (`SYMBOL_SIZE × boardDimensions().x`) and the sprite keys
 * carry the boot's language. The coded nesting, node for node: `fade` (the `FadeContainer` alpha,
 * the def's fade machine) › `visual` (its mount) › the `frame` rig (the coded authoring box's
 * residue as its y) + `content` riding the frame's `slot_text_placeholder` › the caption sprite(s),
 * the `number` rig with the `count` text riding its `slot_number`, the footer sprite(s). The outro
 * carries the big-win and the small-win art; its show timelines pick one.
 */
export function freeSpinPresentationDefs(input: FreeSpinPresentationInput = FS_DEFAULT_INPUT): {
	intro: ComponentDef;
	outro: ComponentDef;
} {
	const N = FREE_SPIN_PRESENTATION_NODES;
	const R = FREE_SPIN_PRESENTATION_RIGS;
	const width = input.symbolSize * input.boardColumns;
	// `FreeSpinAnimation`: the frame at (0.5w, 0.4w) in a w × w panel, the wrapper's pivot at the
	// centre of a w × w·720/920 box — net (0, 0.4w − 0.5w·720/920).
	const frameY = width * 0.4 - (width / (920 / 720)) * 0.5;
	const def = (
		id: string,
		name: string,
		numberRig: string,
		numberWidth: number,
		count: LayoutNode,
		caption: LayoutNode[],
		footer: LayoutNode[],
		source: string,
		show: string[],
		hide: string,
	): ComponentDef => ({
		id,
		name,
		version: 1,
		scope: 'shared',
		category: 'overlay',
		internal: true,
		frameExact: true,
		boardAnchored: true,
		settles: true,
		root: {
			id: `${id}-root`,
			kind: 'container',
			x: 0,
			y: 0,
			children: [
				{
					id: `${id}-fade`,
					label: N.fade,
					kind: 'container',
					x: 0,
					y: 0,
					children: [
						{
							id: `${id}-visual`,
							label: N.visual,
							kind: 'container',
							x: 0,
							y: 0,
							children: [
								{
									id: `${id}-frame`,
									label: N.frame,
									kind: 'spine',
									x: 0,
									y: frameY,
									width,
									assetKey: R.frame,
								},
								{
									id: `${id}-content`,
									label: N.content,
									kind: 'container',
									x: 0,
									y: 0,
									rigSlot: R.frameSlot,
									children: [
										...caption,
										{
											id: `${id}-number`,
											label: N.number,
											kind: 'spine',
											x: 0,
											y: 0,
											width: numberWidth,
											assetKey: numberRig,
										},
										{ ...count, id: `${id}-count`, rigSlot: R.numberSlot },
										...footer,
									],
								},
							],
						},
					],
				},
			],
		},
		inputs: [
			...show.map((signal) => ({
				id: signal,
				kind: 'trigger' as const,
				note: 'The presentation fades in.',
			})),
			{ id: hide, kind: 'trigger', note: 'The presentation fades out.' },
		],
		stateMachine: fsFadeMachine(id, show, hide),
		params: [{ key: 'source', kind: 'string', default: source, options: VALUE_SOURCE_KEYS }],
	});
	const countText = (fontSize: number, bold: boolean): LayoutNode => ({
		id: 'count',
		label: N.count,
		kind: 'text',
		x: 0,
		y: 0,
		anchor: { x: 0.5, y: 0.5 },
		text: '',
		style: { fontFamily: 'gold', fontSize, ...(bold ? { fontWeight: 'bold' } : {}) },
		paramBindings: { text: 'value' },
	});
	const intro = def(
		FREE_SPIN_INTRO_PRESENTATION_ID,
		'Free-spin intro presentation',
		R.introNumber,
		width * 0.3,
		countText(width * 0.1, true),
		[fsSprite(N.caption, `freespins_${input.lang}.png`, 1.2, 500 * 2.2, 156 * 2.2)],
		[fsSprite(N.footer, 'freespins.png', -3, 183 * 2.2, 42 * 2.2)],
		FREE_SPIN_INTRO_COUNT_SOURCE,
		[FREE_SPIN_INTRO_SHOW_SIGNAL],
		FREE_SPIN_INTRO_HIDE_SIGNAL,
	);
	const outro = def(
		FREE_SPIN_OUTRO_PRESENTATION_ID,
		'Free-spin outro presentation',
		R.outroNumber,
		width * 0.4,
		countText(width * 0.08, false),
		[
			fsSprite(N.captionBig, `freespins_${input.lang}.png`, 1.2, 500 * 2.2, 156 * 2.2),
			fsSprite(N.captionSmall, `winsmall_${input.lang}.png`, 1.2, 500 * 4.5, 80 * 4.5),
		],
		[
			fsSprite(N.footerBig, 'totalwin.png', -3.2, 177 * 2.2, 42 * 2.2),
			fsSprite(N.footerSmall, 'totalwin.png', -2, 177 * 3, 42 * 3),
		],
		'freeSpinOutroTotalWin',
		[FREE_SPIN_OUTRO_BIG_SIGNAL, FREE_SPIN_OUTRO_SMALL_SIGNAL],
		FREE_SPIN_OUTRO_HIDE_SIGNAL,
	);
	return { intro, outro };
}

const FREE_SPIN_PRESENTATIONS = freeSpinPresentationDefs();
export const FREE_SPIN_INTRO_PRESENTATION_DEF: ComponentDef = FREE_SPIN_PRESENTATIONS.intro;
export const FREE_SPIN_OUTRO_PRESENTATION_DEF: ComponentDef = FREE_SPIN_PRESENTATIONS.outro;

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
 * to get the boot progress bar PLUS a built-in `tapToContinue: true`, so the player's tap
 * completes the loading screen (a `showContainer{awaitComplete}` hold, or a `complete:loading`
 * handoff) — the author then wires what happens next in `/flow` instead of it being
 * hard-coded in `LoadingScreen.svelte`. Auto-advance on loaded (`completeOnLoaded`) is an
 * explicit tick, never a seed: a screen the author holds with "await complete" waits for the
 * tap and nothing else (owner direction 2026-09-02).
 *
 * It reuses the PROVEN coded `LoadingBar` bound part (the masked progress fill the static
 * node model can't express, already registered by the game) that {@link LOADING_INTRO_DEF}
 * mounts — but is JUST the bar (no logo/title rig), so it composes freely with whatever
 * splash art the author places around it. Same progress-bar geometry/frame/percentage params
 * as the loading-intro splash, defaulted to the coded look. `tapToContinue` / `completeOnLoaded`
 * are the SHARED `overlay` instance params (read by `<ComponentInstance>`); the def only SEEDS
 * the tap via `defaultInstanceParams`. Additive: a doc that doesn't reference this def is
 * unchanged.
 */
export const LOADING_BAR_DEF: ComponentDef = {
	id: 'loadingBar',
	name: 'Loading Bar',
	version: 1,
	scope: 'shared',
	category: 'overlay',
	// The loading gate's default capability, applied at RUNTIME (see `resolveComponentParams`),
	// so the bar IS a flow-driven loading gate out of the box on EVERY project — hand-authored
	// scaffold nodes included, not just editor-dropped ones. A shared `overlay` param (not declared
	// in `params`); the editor surfaces the toggle so an author can clear it.
	//  - `tapToContinue`: a real player tap advances the flow (the way Book of Borut's loading
	//    works). The boot splash covers the canvas until assets load, so the tap can only land
	//    post-load ⇒ it never advances prematurely.
	// `completeOnLoaded` (auto-advance the moment boot assets finish) is deliberately NOT seeded:
	// it used to be, and it silently completed a `showContainer{awaitComplete}` hold on load, so a
	// splash the author wired "show → wait for the tap → hide" vanished before anyone could tap
	// while the Scene Editor drew the toggle off. An author who wants auto-advance ticks it.
	defaultInstanceParams: { tapToContinue: true },
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
 * animation + timing around it (their rig cued by the `specialBookReveal`/`specialBookHide`
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
		// idle rig, `bookIntro` for the intro animation, `static` for the resting frame).
		{ key: 'state', kind: 'string', default: 'bookIdle', label: 'symbol state' },
		{ key: 'scale', kind: 'number', default: 1, label: 'scale' },
	],
};

/**
 * The chosen book EXPANDING SYMBOL merged into an authored intro rig RIG (book-reveal
 * authoring) — the reusable "the animation flips through symbols and lands on YOUR symbol"
 * node every book-of game can drop in. Unlike {@link EXPANDING_SYMBOL_DEF} (which just shows the
 * landed art) this plays an author-picked intro rig animation and RIDES the chosen
 * `stateGame.specialSymbol` on a named BONE of that rig via `<RigBoneAttach>`, so the symbol
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
		{ key: 'introSpine', kind: 'spine', default: 'fsIntro', label: 'reveal rig bundle' },
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
		// loop the idle rig, `static` for the resting frame). The RIG animation provides the
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
/** The icon slot + the frame sprite that sits BEHIND it (a touch larger, so it reads as a bezel). */
const FEATURE_CARD_ICON_SIZE = 120;
const FEATURE_CARD_ICON_FRAME_SIZE = 150;
/** The animated rig accent that overlays the icon region — sized to sit over the icon slot. */
const FEATURE_CARD_RIG_SIZE = 160;
/** The button/ribbon plate that sits BEHIND the button label. */
const FEATURE_CARD_BUTTON_WIDTH = 200;
const FEATURE_CARD_BUTTON_HEIGHT = 56;

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
 * EDITOR-NATIVE node so the owner restyles the tile in the editor later. This is a NEUTRAL-but-
 * COMPLETE template the owner DUPLICATES and restyles, so the chrome is exposed as pickable
 * image/colour params and the content stays data-bound:
 *  - CHROME (pickable art): a `panelImage`+`panelTint` panel, an `iconFrameImage` bezel behind the
 *    icon, an animated `spineKey` accent over the icon, and a `buttonImage` ribbon behind the
 *    button label. EVERY art param is empty by default ⇒ the sprite resolves no texture / the
 *    rig no rig ⇒ the card still renders (text-only, no crash) — byte-safe defaults.
 *  - CONTENT (engine-fed, bound to `engineProvided` params the repeater feeds per item):
 *    `iconKey`/`title`/`description`/`price`/`buttonLabel`.
 *
 * RIG SLOT: a `kind:'spine'` node binds `assetKey → spineKey` (the rig picker stores the bundle
 * name) plus `defaultAnimation → spineAnimation` and `loop → spineLoop` (the playback param binds
 * `<LayoutNodeView>` resolves). An empty `spineKey` ⇒ no rig resolves ⇒ nothing renders, exactly
 * like an empty image param; picking a rig + animation plays it looped over the icon region.
 *
 * The whole card is the press surface — its `select` press routes to the item's `onSelect`.
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
				id: 'featureCard-icon-frame',
				label: 'Icon frame',
				kind: 'sprite',
				x: FEATURE_CARD_WIDTH * 0.5,
				y: FEATURE_CARD_HEIGHT * 0.28,
				anchor: { x: 0.5, y: 0.5 },
				// Optional bezel BEHIND the icon (drawn before it). Empty ⇒ no texture ⇒ no bezel,
				// so the card reads with just the icon — parity-safe.
				assetKey: '',
				width: FEATURE_CARD_ICON_FRAME_SIZE,
				height: FEATURE_CARD_ICON_FRAME_SIZE,
				paramBindings: { region: 'iconFrameImage' },
			},
			{
				id: 'featureCard-icon',
				label: 'Icon',
				kind: 'sprite',
				x: FEATURE_CARD_WIDTH * 0.5,
				y: FEATURE_CARD_HEIGHT * 0.28,
				anchor: { x: 0.5, y: 0.5 },
				assetKey: '',
				width: FEATURE_CARD_ICON_SIZE,
				height: FEATURE_CARD_ICON_SIZE,
				// The engine-fed icon key (`assets.icon`, a resolved editor-art key/URL). Bound to
				// `assetKey` so the sprite resolves it through the normal loaded-asset path.
				paramBindings: { assetKey: 'iconKey' },
			},
			{
				id: 'featureCard-spine',
				label: 'Rig',
				kind: 'spine',
				x: FEATURE_CARD_WIDTH * 0.5,
				y: FEATURE_CARD_HEIGHT * 0.28,
				anchor: { x: 0.5, y: 0.5 },
				// Optional animated accent over the icon region. `assetKey` is empty by default and
				// bound to the `spineKey` picker (stored as the bundle name); the animation + loop
				// bind to `spineAnimation`/`spineLoop`. Empty `spineKey` ⇒ no rig resolves ⇒ nothing
				// renders, exactly like an empty image param — byte-safe.
				assetKey: '',
				width: FEATURE_CARD_RIG_SIZE,
				height: FEATURE_CARD_RIG_SIZE,
				loop: true,
				paramBindings: {
					assetKey: 'spineKey',
					defaultAnimation: 'spineAnimation',
					loop: 'spineLoop',
				},
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
					// Wrap long titles within the card instead of overflowing its edges (the card is
					// FEATURE_CARD_WIDTH wide; leave a small side margin). Centre-anchored, so wrapped
					// lines stay centred.
					wordWrap: true,
					wordWrapWidth: FEATURE_CARD_WIDTH - 40,
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
					// Wrap the (often long) description within the card so copy like "Shoot your way
					// through 10 free spins" flows to multiple lines instead of bleeding past the edges.
					wordWrap: true,
					wordWrapWidth: FEATURE_CARD_WIDTH - 40,
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
				id: 'featureCard-button-ribbon',
				label: 'Button ribbon',
				kind: 'sprite',
				x: FEATURE_CARD_WIDTH * 0.5,
				y: FEATURE_CARD_HEIGHT * 0.88,
				anchor: { x: 0.5, y: 0.5 },
				// Optional plate/ribbon BEHIND the button label (drawn before it). Empty ⇒ no texture
				// ⇒ the label reads on its own — parity-safe.
				assetKey: '',
				width: FEATURE_CARD_BUTTON_WIDTH,
				height: FEATURE_CARD_BUTTON_HEIGHT,
				paramBindings: { region: 'buttonImage', tint: 'buttonTint' },
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
		// The card's main image behind/around the icon (atlas region). Empty ⇒ nothing (parity).
		// Key stays `iconFrameImage` so existing authored `cardParams` keep resolving; only the
		// author-facing LABEL is renamed to reflect how it's used (the card's primary picture).
		{ key: 'iconFrameImage', kind: 'image', group: 'Icon', label: 'card main image' },
		// The optional animated rig accent over the icon: the rig bundle (picker → bundle name),
		// its animation (dropdown of the picked rig's animations), and whether it loops. Empty
		// `spineKey` ⇒ no rig renders (parity).
		{ key: 'spineKey', kind: 'spine', group: 'Rig', label: 'rig bundle' },
		{
			key: 'spineAnimation',
			kind: 'spineAnimation',
			spineParam: 'spineKey',
			group: 'Rig',
			label: 'animation',
		},
		{ key: 'spineLoop', kind: 'boolean', default: true, group: 'Rig', label: 'loop' },
		// The optional plate/ribbon behind the button label (atlas region) + tint. Empty ⇒ no plate
		// (parity).
		{ key: 'buttonImage', kind: 'image', group: 'Button', label: 'button/ribbon frame' },
		{ key: 'buttonTint', kind: 'color', default: HUD_FILL, group: 'Button', label: 'tint' },
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

/** The default option-tile size — three across fit a menu grid without crowding. */
const OPTION_CARD_WIDTH = 220;
const OPTION_CARD_HEIGHT = 96;
const OPTION_CARD_LABEL_SIZE = 34;
/** Neutral plate + white label, going gold when picked — visible out of the box, restyled by art. */
const OPTION_CARD_PLATE_FILL = 0x23233a;
export const OPTION_CARD_LABEL_FILL = HUD_FILL;
export const OPTION_CARD_LABEL_FILL_SELECTED = 0xffd35c;

/**
 * A GENERIC, repeated CHOICE TILE — the engine-native, authorable twin of the HTML option grids
 * (`BetMenuAmountGrid`, `AutoSpinsOptions`, the two limit grids): a plate, a label, and a press. It
 * carries NOTHING bet- or autoplay-specific; it is simply what a `repeater` stamps when the list is a
 * set of values to pick from rather than a set of feature cards, so one def serves the bet ladder,
 * the auto-spin counts and both limit ladders.
 *
 * PLAIN-NODE path (like {@link FEATURE_CARD_DEF}): every child is an editor-native node, so the owner
 * restyles or replaces it in the Component Editor. With no coded `bind` part, `<ComponentInstance>`
 * makes the WHOLE tile the hit surface once the repeater injects the item's `onSelect` — the tile is
 * pressable with no `action` binding, exactly like a feature card.
 *
 * SELECTED is fed, not computed: the repeater source marks the item that is currently staked/picked
 * (`values.selected`), which reaches the tile two ways — as the shared button-state cascade's `active`
 * flag (so an authored `imageSelected` region paints the choice, the same knob every other button
 * uses), and as `labelFill`, the label colour the source swaps so the pick is legible with NO art
 * authored at all. A hand-built replacement card that declares neither param simply ignores both.
 */
export const OPTION_CARD_DEF: ComponentDef = {
	id: 'optionCard',
	name: 'Option Tile',
	version: 1,
	scope: 'shared',
	category: 'ui',
	root: {
		id: 'optionCard-root',
		kind: 'container',
		x: 0,
		y: 0,
		children: [
			{
				id: 'optionCard-plate',
				label: 'Plate',
				kind: 'rect',
				x: OPTION_CARD_WIDTH * 0.5,
				y: OPTION_CARD_HEIGHT * 0.5,
				anchor: { x: 0.5, y: 0.5 },
				width: OPTION_CARD_WIDTH,
				height: OPTION_CARD_HEIGHT,
				color: OPTION_CARD_PLATE_FILL,
				alpha: 0.92,
			},
			{
				id: 'optionCard-bg',
				label: 'Frame',
				kind: 'sprite',
				x: OPTION_CARD_WIDTH * 0.5,
				y: OPTION_CARD_HEIGHT * 0.5,
				anchor: { x: 0.5, y: 0.5 },
				// No static texture: the owner picks the tile art via the `image` param, and the
				// state cascade swaps it for hover/pressed/selected. Empty ⇒ no texture resolves ⇒
				// the plate below shows through, so art is never a blocker to start authoring.
				assetKey: '',
				width: OPTION_CARD_WIDTH,
				height: OPTION_CARD_HEIGHT,
				paramBindings: { region: 'image', tint: 'tint' },
				preview: { w: OPTION_CARD_WIDTH, h: OPTION_CARD_HEIGHT, style: 'tile' },
			},
			{
				id: 'optionCard-label',
				label: 'Label',
				kind: 'text',
				x: OPTION_CARD_WIDTH * 0.5,
				y: OPTION_CARD_HEIGHT * 0.5,
				anchor: { x: 0.5, y: 0.5 },
				text: '0.00',
				style: {
					fontFamily: HUD_FONT_FAMILY,
					fontSize: OPTION_CARD_LABEL_SIZE,
					fill: OPTION_CARD_LABEL_FILL,
					align: 'center',
				},
				paramBindings: {
					text: 'label',
					'style.fill': 'labelFill',
					'style.fontSize': 'fontSize',
					'style.fontFamily': 'fontFamily',
				},
				preview: { style: 'text', textParam: 'label' },
			},
		],
	},
	params: [
		{ key: 'tint', kind: 'color', default: HUD_FILL, group: 'Plate', label: 'frame tint' },
		{ key: 'fontSize', kind: 'number', default: OPTION_CARD_LABEL_SIZE },
		{ key: 'fontFamily', kind: 'string', default: HUD_FONT_FAMILY, label: 'font' },
		// Per-state tile IMAGES — the SAME cascade every button resolves, so `imageSelected` paints
		// the picked tile and hover/pressed give the press its feedback. All absent ⇒ the plate +
		// label render unchanged. Derived from the shared source of truth so this def, the picker and
		// the cascade key list can't drift.
		...BUTTON_STATE_IMAGE_PARAMS.map((p): ComponentParam => ({
			key: p.key,
			kind: 'image',
			group: 'State images',
			label: p.label,
		})),
		// Engine-fed per-item values (the `repeater` feeds one tile per option). All `engineProvided`,
		// so the editor renders no control — the source supplies them at runtime.
		{ key: 'label', kind: 'string', engineProvided: true },
		{ key: 'labelFill', kind: 'color', engineProvided: true },
		{ key: 'selected', kind: 'boolean', engineProvided: true },
	],
	// The tile's press — the repeater wires it to the item's `onSelect`, and fuses the whole list into
	// one `<repeaterId>.onSelect` flow pin, so an author wires the choice wherever it belongs.
	signals: [{ key: 'select', note: 'Fired when the tile is pressed (pick this option).' }],
};

// ─── Segmented counter (a count-mode repeater, `RepeaterNode.count`) ─────────────────────────────
//
// One segment per spin of a count the engine feeds (respins, free spins), lit while the spins left
// reach its position — the Hold and Win respin bar's look, drawn from plain nodes and a state
// machine, so a copy re-skins and re-binds with no code. Offered to every kind; placed only by an
// author.

export const SEGMENTED_COUNTER_ID = 'segmentedCounter';
export const SEGMENTED_COUNTER_SEGMENT_ID = 'segmentedCounterSegment';
/** The node names the segment's timelines bind (labels, unique within the def). */
export const SEGMENTED_COUNTER_SEGMENT_NODES = { lit: 'lit', unlit: 'unlit' } as const;
/** The segment's number input the bar passes the live count to. */
export const SEGMENTED_COUNTER_VALUE_INPUT = 'value';
const segmentTimelineId = (suffix: string): string =>
	`c_${SEGMENTED_COUNTER_SEGMENT_ID.toLowerCase()}_${suffix}`;
export const SEGMENTED_COUNTER_LIT_TIMELINE_ID = segmentTimelineId('lit');
export const SEGMENTED_COUNTER_UNLIT_TIMELINE_ID = segmentTimelineId('unlit');
const SEGMENT_WIDTH = 80;
const SEGMENT_HEIGHT = 56;

/**
 * A segment's look in one state: a fill (`litColor` / `unlitColor`) under optional art. Its machine
 * keys the group's `alpha`, so the group carries an explicit `alpha: 1`: the fold hands a keyed 1
 * back as the node's own alpha, and with none the 0 of the other state would stay on screen.
 */
const segmentLook = (lit: boolean): LayoutNode => {
	const state = lit ? 'lit' : 'unlit';
	const name = lit ? 'Lit' : 'Unlit';
	return {
		id: `${SEGMENTED_COUNTER_SEGMENT_ID}-${state}`,
		label: SEGMENTED_COUNTER_SEGMENT_NODES[state],
		kind: 'container',
		x: 0,
		y: 0,
		alpha: 1,
		children: [
			{
				id: `${SEGMENTED_COUNTER_SEGMENT_ID}-${state}Fill`,
				label: `${name} fill`,
				kind: 'rect',
				x: 0,
				y: 0,
				anchor: { x: 0, y: 0 },
				width: SEGMENT_WIDTH,
				height: SEGMENT_HEIGHT,
				color: lit ? 0xf5a623 : 0x5a1414,
				borderRadius: 8,
				paramBindings: { color: `${state}Color` },
			},
			{
				id: `${SEGMENTED_COUNTER_SEGMENT_ID}-${state}Art`,
				label: `${name} art`,
				kind: 'sprite',
				x: 0,
				y: 0,
				anchor: { x: 0, y: 0 },
				assetKey: '',
				width: SEGMENT_WIDTH,
				height: SEGMENT_HEIGHT,
				paramBindings: { region: `${state}Image` },
				preview: { w: SEGMENT_WIDTH, h: SEGMENT_HEIGHT, style: 'tile' },
			},
		],
	};
};

/**
 * One segment of a {@link SEGMENTED_COUNTER_DEF}: the repeater hands it its 1-based `index` and the
 * `count`, and passes the bar's live value to its `value` input. Its machine shows `lit` while
 * `value >= index` and `unlit` below — 3 left of 3 lights all three, 1 left lights the first only.
 * It enters `Unlit` and takes `Lit` on its first evaluation, ahead of the first frame drawn.
 * Re-skin it with `litImage` / `unlitImage` (over the fills, which `litColor` / `unlitColor`
 * recolour); its label shows `index`.
 */
export const SEGMENTED_COUNTER_SEGMENT_DEF: ComponentDef = {
	id: SEGMENTED_COUNTER_SEGMENT_ID,
	name: 'Counter Segment',
	version: 1,
	scope: 'shared',
	category: 'ui',
	root: {
		id: `${SEGMENTED_COUNTER_SEGMENT_ID}-root`,
		kind: 'container',
		x: 0,
		y: 0,
		children: [
			segmentLook(false),
			segmentLook(true),
			{
				id: `${SEGMENTED_COUNTER_SEGMENT_ID}-label`,
				label: 'Number',
				kind: 'text',
				x: SEGMENT_WIDTH / 2,
				y: SEGMENT_HEIGHT / 2,
				anchor: { x: 0.5, y: 0.5 },
				text: '1',
				style: {
					fontFamily: 'Arial',
					fontWeight: 'bold',
					fontSize: 30,
					fill: 0xffffff,
					stroke: { color: 0x000000, width: 4 },
				},
				paramBindings: { text: 'index', 'style.fill': 'labelColor' },
				preview: { style: 'text', textParam: 'index' },
			},
		],
	},
	params: [
		{
			key: 'index',
			kind: 'number',
			default: 1,
			label: 'position, 1 = the first (the bar sets it)',
		},
		{ key: 'count', kind: 'number', default: 3, label: 'segments in the bar (the bar sets it)' },
		{ key: 'litColor', kind: 'color', default: 0xf5a623, label: 'fill while lit' },
		{ key: 'unlitColor', kind: 'color', default: 0x5a1414, label: 'fill while dark' },
		{ key: 'litImage', kind: 'image', label: 'art while lit' },
		{ key: 'unlitImage', kind: 'image', label: 'art while dark' },
		{ key: 'labelColor', kind: 'color', default: 0xffffff, label: 'number colour' },
	],
	inputs: [
		{
			id: SEGMENTED_COUNTER_VALUE_INPUT,
			kind: 'number',
			default: 3,
			note: 'How many are lit (the bar passes its live count).',
		},
	],
	stateMachine: {
		layers: [
			{
				id: 'light',
				name: 'Light',
				entry: 'Unlit',
				states: [
					{ id: 'Unlit', timeline: SEGMENTED_COUNTER_UNLIT_TIMELINE_ID },
					{ id: 'Lit', timeline: SEGMENTED_COUNTER_LIT_TIMELINE_ID },
				],
				transitions: [
					{
						id: 'light-on',
						from: 'Unlit',
						to: 'Lit',
						conditions: [{ input: SEGMENTED_COUNTER_VALUE_INPUT, op: '>=', param: 'index' }],
					},
					{
						id: 'light-off',
						from: 'Lit',
						to: 'Unlit',
						conditions: [{ input: SEGMENTED_COUNTER_VALUE_INPUT, op: '<', param: 'index' }],
					},
				],
			},
		],
	},
};

/**
 * A SEGMENTED COUNTER: one {@link SEGMENTED_COUNTER_SEGMENT_DEF} per spin of the engine number
 * `countSource` names, in a centred row, each lit while `valueSource` reaches it. Respins by
 * default (`respinsStart` / `respinsLeft`); `freeSpinsTotal` / `freeSpinsLeft` count free spins.
 * `backgroundImage` draws behind the row (none by default). The count and the lit value are the
 * repeater's `count.source` and `passInputs`, templated on these two params.
 */
export const SEGMENTED_COUNTER_DEF: ComponentDef = {
	id: SEGMENTED_COUNTER_ID,
	name: 'Segmented Counter',
	version: 1,
	scope: 'shared',
	category: 'ui',
	root: {
		id: `${SEGMENTED_COUNTER_ID}-root`,
		kind: 'container',
		x: 0,
		y: 0,
		children: [
			{
				id: `${SEGMENTED_COUNTER_ID}-background`,
				label: 'Background',
				kind: 'sprite',
				x: 0,
				y: 0,
				anchor: { x: 0.5, y: 0.5 },
				assetKey: '',
				width: 300,
				height: 76,
				paramBindings: { region: 'backgroundImage' },
				preview: { w: 300, h: 76, style: 'tile' },
			},
			{
				id: `${SEGMENTED_COUNTER_ID}-segments`,
				label: 'Segments',
				kind: 'repeater',
				x: 0,
				y: 0,
				anchor: { x: 0.5, y: 0.5 },
				source: '',
				componentId: SEGMENTED_COUNTER_SEGMENT_ID,
				layout: { direction: 'row', gap: 6 },
				count: { source: '{countSource}', preview: 3 },
				passInputs: { [SEGMENTED_COUNTER_VALUE_INPUT]: '{valueSource}' },
				previewInputs: { [SEGMENTED_COUNTER_VALUE_INPUT]: 2 },
			},
		],
	},
	params: [
		{
			key: 'countSource',
			kind: 'string',
			default: 'respinsStart',
			label: 'how many segments (an engine number)',
			options: ['respinsStart', 'freeSpinsTotal'],
		},
		{
			key: 'valueSource',
			kind: 'string',
			default: 'respinsLeft',
			label: 'how many are lit (an engine number)',
			options: ['respinsLeft', 'freeSpinsLeft', 'freeSpinsPlayed'],
		},
		{ key: 'backgroundImage', kind: 'image', label: 'art behind the segments' },
	],
};

// ─── Hold and Win (design `docs/design/hold-and-win.md` §5, Phase 6) ─────────────────────────────
//
// Kind-gated (`capability: 'holdAndWin'`): the Scene Editor offers them only to a project with the
// Hold and Win feature — the Pot Meter (`'pots'`) also to one with the pots overlay add-on. Each
// one's moving parts are engine-fed — the counter, jackpot tiles and total bar through the
// {@link HOLD_AND_WIN_VALUE_SOURCE_KEYS} feeds, the pot / letters / wheel through coded parts
// (`apps/lines`) that read the same state. Sizes are in the shared runtime's cell units
// (`SYMBOL_SIZE = 120`).

const HW_FONT_SIZE = 34;
const HW_CAPTION_SIZE = 22;
/** Gold — the jackpot / total figures. */
const HW_VALUE_FILL = 0xffd35c;

const HW_SOURCE_PARAM_OPTIONS = [
	...HOLD_AND_WIN_VALUE_SOURCE_KEYS,
	...PLATFORM_JACKPOT_VALUE_SOURCE_KEYS,
	...VALUE_SOURCE_KEYS,
];
const HW_VISIBILITY_OPTIONS = [
	...HOLD_AND_WIN_VISIBILITY_SOURCE_KEYS,
	...PLATFORM_JACKPOT_VISIBILITY_SOURCE_KEYS,
	...VISIBILITY_SOURCE_KEYS,
];

type HoldAndWinPanel = {
	id: string;
	name: string;
	caption: string;
	sample: string;
	source: string;
	width: number;
	height: number;
	visibleSource?: string;
	note: string;
	/** The param the panel's signal scope comes from, and its kind (`ComponentDef.signalScope`). */
	signalScope?: { param: string; kind: SignalScopeKind };
};

/**
 * A caption over an engine-fed value on an author-picked frame — the respin counter, a jackpot tile
 * and the total win bar. PLAIN-NODE path, like {@link FREE_SPIN_COUNTER_DEF}: the frame is a sprite
 * whose `region` is the `frameImage` param (none picked ⇒ text only), the caption is the `label`
 * param, and the value text is the `value` the instance's `source` feeds, through that source's own
 * formatter (currency for a jackpot or the total).
 */
const holdAndWinPanel = (panel: HoldAndWinPanel): ComponentDef => ({
	id: panel.id,
	name: panel.name,
	version: 1,
	scope: 'shared',
	category: 'ui',
	capability: 'holdAndWin',
	...(panel.signalScope
		? { signalScope: panel.signalScope.param, signalScopeKind: panel.signalScope.kind }
		: {}),
	root: {
		id: `${panel.id}-root`,
		kind: 'container',
		x: 0,
		y: 0,
		children: [
			{
				id: `${panel.id}-frame`,
				label: 'Frame',
				kind: 'sprite',
				x: 0,
				y: 0,
				anchor: { x: 0.5, y: 0.5 },
				assetKey: '',
				width: panel.width,
				height: panel.height,
				paramBindings: { region: 'frameImage', tint: 'frameTint' },
				preview: { w: panel.width, h: panel.height, style: 'tile' },
			},
			{
				id: `${panel.id}-caption`,
				label: 'Caption',
				kind: 'text',
				x: 0,
				y: -panel.height * 0.2,
				anchor: { x: 0.5, y: 0.5 },
				text: panel.caption,
				style: { fontFamily: HUD_FONT_FAMILY, fontSize: HW_CAPTION_SIZE, fill: HUD_FILL },
				paramBindings: {
					text: 'label',
					'style.fontFamily': 'fontFamily',
					'style.fill': 'captionFill',
				},
				preview: { style: 'text', textParam: 'label' },
			},
			{
				id: `${panel.id}-value`,
				label: 'Value',
				kind: 'text',
				x: 0,
				y: panel.height * 0.18,
				anchor: { x: 0.5, y: 0.5 },
				text: panel.sample,
				style: { fontFamily: HUD_FONT_FAMILY, fontSize: HW_FONT_SIZE, fill: HW_VALUE_FILL },
				paramBindings: {
					text: 'value',
					'style.fontFamily': 'fontFamily',
					'style.fontSize': 'fontSize',
					'style.fill': 'fill',
				},
				preview: { style: 'text', textParam: 'value' },
			},
		],
	},
	params: [
		{ key: 'source', kind: 'string', options: HW_SOURCE_PARAM_OPTIONS, default: panel.source },
		{
			key: 'visibleSource',
			kind: 'string',
			options: HW_VISIBILITY_OPTIONS,
			...(panel.visibleSource ? { default: panel.visibleSource } : {}),
		},
		{ key: 'label', kind: 'string', default: panel.caption },
		{ key: 'frameImage', kind: 'image', label: 'frame image' },
		{ key: 'frameTint', kind: 'color' },
		{ key: 'fill', kind: 'color', default: HW_VALUE_FILL },
		{ key: 'captionFill', kind: 'color', default: HUD_FILL },
		{ key: 'fontSize', kind: 'number', default: HW_FONT_SIZE },
		{ key: 'fontFamily', kind: 'string', default: HUD_FONT_FAMILY },
		{ key: 'countUp', kind: 'boolean', default: false },
		{ key: 'value', kind: 'number', engineProvided: true, label: panel.note },
	],
});

/** A coded part's box in the editor (the game draws the real thing). */
const codedPart = (id: string, label: string, component: string, w: number, h: number) =>
	({
		id,
		label,
		kind: 'container',
		x: 0,
		y: 0,
		bind: { component, props: { boundToInstance: true } },
		preview: { w, h, style: 'tile' },
		children: [],
	}) satisfies LayoutNode;

/**
 * A plain-node panel moved INSIDE a coded part (Phase 12c — the Respin Counter, the Jackpot Tile,
 * the Total Win Bar):
 * the panel's nodes keep their ids (so a saved copy's bindings merge by id) and become the part's
 * `skin`; the part adds the behaviour the static node model can't express. The part sits at the
 * panel's origin with the panel's box, so placements and the editor's selection box are unchanged.
 */
const panelInPart = (
	panel: ComponentDef,
	part: { id: string; label: string; component: string; width: number; height: number },
	extraParams: ComponentParam[],
): ComponentDef => ({
	...panel,
	root: {
		...panel.root,
		children: [
			{
				...codedPart(part.id, part.label, part.component, part.width, part.height),
				children: panel.root.children,
			},
		],
	},
	params: [...(panel.params ?? []), ...extraParams],
});

const RESPIN_COUNTER_PANEL = holdAndWinPanel({
	id: 'respinCounter',
	name: 'Respin Counter',
	caption: 'RESPINS',
	sample: '3',
	source: 'respinsLeft',
	visibleSource: 'respinCounterShow',
	width: 240,
	height: 96,
	note: 'respins left (engine)',
});

/**
 * "RESPINS 3" — the respins left, shown for the whole feature (`respinCounterShow`). SKINNABLE
 * (Phase 12c): the panel's frame, caption and value sit INSIDE the coded `Counter` part, which
 * pulses them on every reset and "+N" (`pulseScale`, 1 = still, as the authored counter always was),
 * registers the `respinCounter` anchor the "+N" flies into and counts the instance in as the
 * counter. With nothing inside, the part draws the coded counter. It `standsFor` the part, so a
 * counter saved before the part existed (its nodes at the root) still registers through a stand-in.
 * Same node ids as the plain panel, so its bindings merge by id.
 */
export const RESPIN_COUNTER_DEF: ComponentDef = {
	...panelInPart(
		RESPIN_COUNTER_PANEL,
		{
			id: 'respinCounter-counter',
			label: 'Counter',
			component: 'RespinCounterPart',
			width: 240,
			height: 96,
		},
		[
			{
				key: 'pulseScale',
				kind: 'number',
				default: 1,
				label: 'pulse on a reset or "+N" (1 = none)',
			},
		],
	),
	standsFor: 'RespinCounterPart',
};

const JACKPOT_TILE_PANEL = holdAndWinPanel({
	id: 'jackpotTile',
	name: 'Jackpot Tile',
	caption: 'GRAND',
	sample: '$2,000.00',
	source: 'jackpot.grand',
	width: 240,
	height: 96,
	note: 'jackpot × total bet (engine)',
	// `jackpot.grand` scopes the tile to the GRAND tier's signals (`jackpotWin`), so a celebration
	// authored inside the tile plays on the tile whose tier was won.
	signalScope: { param: 'source', kind: 'tier' },
});

/**
 * One jackpot's name and its value at the current bet. The bar places four. SKINNABLE (Phase 12c):
 * the panel's frame, caption and value sit INSIDE the coded `Tile` part, which pulses them when the
 * tile's own tier is won (`winPulseScale`, 1 = still, as the tile always was) — a `jackpot.<tier>`
 * source on a Hold and Win jackpot win, a `platformJackpot.<tier>` one on the platform's. The tile
 * registers nothing (nothing flies to it, and no coded tile steps aside for it), so it stands for
 * no part: a tile saved before the part keeps drawing and only lacks the pulse.
 */
export const JACKPOT_TILE_DEF: ComponentDef = panelInPart(
	JACKPOT_TILE_PANEL,
	{ id: 'jackpotTile-tile', label: 'Tile', component: 'JackpotTilePart', width: 240, height: 96 },
	[
		{
			key: 'winPulseScale',
			kind: 'number',
			default: 1,
			label: 'pulse when its tier is won (1 = none)',
		},
	],
);

const TOTAL_WIN_BAR_PANEL = holdAndWinPanel({
	id: 'totalWinBar',
	name: 'Total Win Bar',
	caption: 'TOTAL WIN',
	sample: '$12.50',
	source: 'featureTotal',
	visibleSource: 'respinCounterShow',
	width: 360,
	height: 96,
	note: 'feature total (engine)',
});

/**
 * "TOTAL WIN" — what the feature has won (`featureTotal`, the same figure as the HUD's win meter).
 * SKINNABLE (Phase 12c): the panel's frame, caption and value sit INSIDE the coded `Bar` part. With
 * `catchesCoins` on, the part registers `TOTAL_WIN_BAR_ANCHOR`, so the feature end's coins (and a
 * swept Grand column's) fly into this bar instead of the HUD's win meter. It pulses on each coin that
 * lands (`landPulseScale`). Both are off by default: the bar never caught the coins, so every
 * existing game flies them where it always did. It `standsFor` the part, so a bar drawn without it
 * still catches the coins through a stand-in.
 */
export const TOTAL_WIN_BAR_DEF: ComponentDef = {
	...panelInPart(
		TOTAL_WIN_BAR_PANEL,
		{ id: 'totalWinBar-bar', label: 'Bar', component: 'TotalWinBarPart', width: 360, height: 96 },
		[
			{
				key: 'catchesCoins',
				kind: 'boolean',
				default: false,
				label: 'coins fly here at the feature end',
			},
			{
				key: 'landPulseScale',
				kind: 'number',
				default: 1,
				label: 'pulse on each coin that lands (1 = none)',
			},
		],
	),
	standsFor: 'TotalWinBarPart',
};

const JACKPOT_TIERS = ['mini', 'minor', 'major', 'grand'] as const;
/** Tile pitch in the bar — a tile plus a 16px gap. */
const JACKPOT_TILE_PITCH = 256;

/**
 * MINI · MINOR · MAJOR · GRAND, each a nested {@link JACKPOT_TILE_DEF} fed `jackpot.<tier>` — the
 * jackpot table every reference game (Grand, Super Hotfire Diamonds, 3 Pots of Egypt) shows. A tile
 * whose jackpot the project's config does not declare reads empty.
 */
export const JACKPOT_BAR_DEF: ComponentDef = {
	id: 'jackpotBar',
	name: 'Jackpot Bar',
	version: 1,
	scope: 'shared',
	category: 'ui',
	capability: 'holdAndWin',
	root: {
		id: 'jackpotBar-root',
		kind: 'container',
		x: 0,
		y: 0,
		children: JACKPOT_TIERS.map((tier, index): LayoutNode => ({
			id: `jackpotBar-${tier}`,
			label: tier.toUpperCase(),
			kind: 'componentInstance',
			componentId: JACKPOT_TILE_DEF.id,
			x: (index - (JACKPOT_TIERS.length - 1) / 2) * JACKPOT_TILE_PITCH,
			y: 0,
			params: { source: `jackpot.${tier}`, label: tier.toUpperCase() },
		})),
	},
};

/**
 * The OPERATOR PLATFORM JACKPOT's bar — any kind (design `hold-and-win.md` §7 11c): MINI · MINOR ·
 * MAJOR · GRAND {@link JACKPOT_TILE_DEF}s fed `platformJackpot.<tier>`, the platform's own live values,
 * each gated `platformJackpotShow` so the bar stays hidden in a game whose operator runs none.
 * Offered to every kind; the tiles inside it are the Hold and Win ones, restyled per instance.
 */
export const PLATFORM_JACKPOT_BAR_DEF: ComponentDef = {
	id: 'platformJackpotBar',
	name: 'Platform Jackpot Bar',
	version: 1,
	scope: 'shared',
	category: 'ui',
	root: {
		id: 'platformJackpotBar-root',
		kind: 'container',
		x: 0,
		y: 0,
		children: JACKPOT_TIERS.map((tier, index): LayoutNode => ({
			id: `platformJackpotBar-${tier}`,
			label: tier.toUpperCase(),
			kind: 'componentInstance',
			componentId: JACKPOT_TILE_DEF.id,
			x: (index - (JACKPOT_TIERS.length - 1) / 2) * JACKPOT_TILE_PITCH,
			y: 0,
			params: {
				source: `platformJackpot.${tier}`,
				visibleSource: 'platformJackpotShow',
				label: tier.toUpperCase(),
			},
		})),
	},
};

/**
 * ONE persistent meter (a 3 Pots pot): its level bar, "<ID> level/max", what a full one activates,
 * a size step at each of the meter's `sizeStages` and a pulse when it fills. The coded `PotMeter`
 * reads `meter.<id>.level` / `meter.<id>.max` for its `meter` param and registers the
 * `meter:<id>` anchor the specials fly into. A meter the config does not declare draws nothing.
 *
 * SKINNABLE (Phase 12c): the {@link POT_SKIN_PARAMS} swap the coded bar for the author's art per
 * instance, and nodes the author puts INSIDE the `Pot` part replace its coded drawing while the
 * part keeps the level, stages, pulse, anchor and its count as that meter's pot. It `standsFor` the
 * part, so a copy whose `Pot` was deleted still registers as that meter's pot.
 */
export const POT_METER_DEF: ComponentDef = {
	id: 'potMeter',
	name: 'Pot Meter',
	version: 1,
	scope: 'shared',
	category: 'ui',
	capability: 'pots',
	// Each placed pot hears its own meter's signals only (`potFill`, `potActivate`, …).
	signalScope: 'meter',
	signalScopeKind: 'meter',
	standsFor: 'PotMeter',
	root: {
		id: 'potMeter-root',
		kind: 'container',
		x: 0,
		y: 0,
		children: [codedPart('potMeter-pot', 'Pot', 'PotMeter', 120, 60)],
	},
	params: [
		{ key: 'meter', kind: 'string', default: 'red', label: 'meter id (Game Config)' },
		{ key: 'scale', kind: 'number', default: 1 },
		...POT_SKIN_PARAMS,
	],
};

/** The coded column letter's font size: 0.36 of a 120 px cell (`HoldAndWinLetter`). */
const LETTER_FONT_SIZE = 43.2;

/** A column letter in one state, drawn the way the coded letter draws it in that state. */
const letterText = (lit: boolean): LayoutNode => ({
	id: lit ? 'letterTile-lit' : 'letterTile-dim',
	label: lit ? 'Letter (lit)' : 'Letter (dim)',
	kind: 'text',
	x: 0,
	y: 0,
	anchor: { x: 0.5, y: 0.5 },
	text: 'G',
	...(lit ? {} : { alpha: 0.45 }),
	style: {
		fontFamily: 'Arial',
		fontWeight: 'bold',
		fontSize: LETTER_FONT_SIZE,
		fill: lit ? 0xffd24a : 0x6b6b6b,
		stroke: { color: lit ? 0x7a3d00 : 0x000000, width: 6 },
	},
	paramBindings: { text: 'letter' },
	valueBindings: [
		{ target: 'visible', source: 'letter.{reel}.lit', ...(lit ? {} : { below: true }) },
	],
	preview: { style: 'text', textParam: 'letter' },
});

/** The art behind a column letter in one state (`tileImage` / `litTileImage`; none ⇒ nothing). */
const letterArt = (lit: boolean): LayoutNode => ({
	id: lit ? 'letterTile-litArt' : 'letterTile-art',
	label: lit ? 'Art (lit)' : 'Art (dim)',
	kind: 'sprite',
	x: 0,
	y: 0,
	anchor: { x: 0.5, y: 0.5 },
	assetKey: '',
	width: 100,
	height: 100,
	paramBindings: { region: lit ? 'litTileImage' : 'tileImage' },
	valueBindings: [
		{ target: 'visible', source: 'letter.{reel}.lit', ...(lit ? {} : { below: true }) },
	],
	preview: { w: 100, h: 100, style: 'tile' },
});

/**
 * One of Grand's column letters, for a Letters Strip to draw per reel (its `tile` param). SKINNABLE
 * (Phase 12c), the Jackpot Tile's pattern: the dim and lit art and letter sit INSIDE the coded
 * `Letter` part, which pulses them when the letter lights (`pulseScale`, the coded letter's 1.6 by
 * default). Each node shows in one state through a 12b `visible` binding on `letter.{reel}.lit`.
 * The strip feeds each tile its `reel` and `letter`; the tile is scoped by its reel (12a), so a cue
 * on **Letter lit** inside it plays on its own letter only. With nothing inside, the part draws the
 * coded letter. It registers nothing, so it stands for no part.
 */
export const LETTER_TILE_DEF: ComponentDef = {
	id: 'letterTile',
	name: 'Letter Tile',
	version: 1,
	scope: 'shared',
	category: 'ui',
	capability: 'holdAndWin',
	signalScope: 'reel',
	signalScopeKind: 'reel',
	root: {
		id: 'letterTile-root',
		kind: 'container',
		x: 0,
		y: 0,
		children: [
			{
				...codedPart('letterTile-letter', 'Letter', 'LetterTilePart', 100, 100),
				children: [letterArt(false), letterArt(true), letterText(false), letterText(true)],
			},
		],
	},
	params: [
		{ key: 'reel', kind: 'number', default: 0, label: 'column (0 = the first; the strip sets it)' },
		{ key: 'letter', kind: 'string', default: 'G', label: 'the letter (the strip sets it)' },
		{ key: 'tileImage', kind: 'image', label: 'art behind the letter while dim' },
		{ key: 'litTileImage', kind: 'image', label: 'art behind the letter once lit' },
		{
			key: 'pulseScale',
			kind: 'number',
			default: 1.6,
			label: 'pulse when the letter lights (1 = none)',
		},
	],
};

/** What a mounted Letters Strip counts in under, whatever its id, so the coded row steps aside. */
export const LETTERS_STRIP_MOUNT = 'lettersStrip';

/**
 * Grand's column letters — one per reel, lit as its column completes. The coded `LettersStrip`
 * spells the config's `boardEnd.letters` at `spacing` px (the cell pitch, so the strip lines up with
 * the reels when centred on the board), and counts itself in as the letters row so the coded row
 * steps aside. SKINNABLE (Phase 12c): `tile` names a component each letter draws as (a project's
 * Letter Tile copy); blank, the default, draws the coded letters. It `standsFor` its part, so a
 * strip drawn without it still steps the coded row aside. A project whose board end is not column
 * letters draws nothing.
 */
export const LETTERS_STRIP_DEF: ComponentDef = {
	id: 'lettersStrip',
	name: 'Letters Strip',
	version: 1,
	scope: 'shared',
	category: 'ui',
	capability: 'holdAndWin',
	root: {
		id: 'lettersStrip-root',
		kind: 'container',
		x: 0,
		y: 0,
		children: [codedPart('lettersStrip-letters', 'Letters', 'LettersStrip', 600, 70)],
	},
	params: [
		{ key: 'spacing', kind: 'number', default: 120, label: 'letter pitch (px)' },
		{
			key: 'tile',
			kind: 'component',
			default: '',
			label: 'each letter drawn as (blank = the coded letters)',
			fedParams: ['reel', 'letter'],
		},
	],
	standsFor: 'LettersStrip',
};

/** What a mounted Line Overlay counts in under, whatever its id, so the coded coin-board line
 *  markers step aside (`docs/design/hold-and-win-coin-board.md` §1.4). */
export const LINE_OVERLAY_MOUNT = 'lineOverlay';

/**
 * A coin board's paying lines (`docs/design/hold-and-win-coin-board.md` §1.4): each active payline
 * as a path between its cells, and a numbered tab at each end of the board. Placed in the `respinBoard`
 * scene; like the cell tiles, WHERE it sits does not matter — the coded `LineOverlayPart` counts the
 * instance in as the Line Overlay and hands its look to the board, which draws the lines on its own
 * cells, so the coded overlay steps aside for a copy of any id. Not placed ⇒ the coded overlay, the
 * same look at the defaults below. Draws nothing on a game that is not a coin board.
 *
 * SKINNABLE (the Phase 12c pattern): the params restyle the lines (width, opacity, one colour for
 * all; blank keeps each line's `paylineColors` colour) and the tabs (shown, size, number colour).
 * It `standsFor` its part, so a copy whose author deleted the part to draw the lines with their own
 * nodes still steps the coded overlay aside. The locked cells' colour is the Game Config's
 * `inactiveOverlay`, drawn by the board, not this component.
 */
export const LINE_OVERLAY_DEF: ComponentDef = {
	id: 'lineOverlay',
	name: 'Line Overlay',
	version: 1,
	scope: 'shared',
	category: 'ui',
	capability: 'holdAndWin',
	root: {
		id: 'lineOverlay-root',
		kind: 'container',
		x: 0,
		y: 0,
		children: [codedPart('lineOverlay-lines', 'Lines', 'LineOverlayPart', 600, 360)],
	},
	params: [
		{ key: 'lineWidth', kind: 'number', default: 4.2, label: 'line width (px)' },
		{ key: 'lineAlpha', kind: 'number', default: 0.8, label: 'line opacity (0–1)' },
		{
			key: 'lineColor',
			kind: 'color',
			label: 'every line in one colour (blank = payline colours)',
		},
		{ key: 'showTabs', kind: 'boolean', default: true, label: 'numbered tab at each end' },
		{ key: 'tabScale', kind: 'number', default: 1, label: 'tab size (1 = the coded size)' },
		{ key: 'tabTextFill', kind: 'color', default: 0x111111, label: 'tab number colour' },
	],
	standsFor: 'LineOverlayPart',
};

/** What a mounted Wheel counts in under, whatever its id, so the coded wheel steps aside. */
export const WHEEL_MOUNT = 'wheel';

/**
 * The pre-feature wheel (Super Hotfire Diamonds) at the instance's position: the coded
 * `HoldAndWinWheelPart` draws the same art and spin as the coded board-centred wheel, and counts
 * itself in as the wheel, so that one steps aside for a copy of any id. Draws nothing until the
 * wheel beat puts a wheel up.
 *
 * SKINNABLE (Phase 12c), the Pot's pattern: art params (`WHEEL_SKIN_PARAMS`) swap the turning face,
 * the fixed rim and the pointer, and nodes the author puts inside the `Wheel` part turn with the
 * face, in place of the coded segments. The prize labels and the landed outline stay coded, each
 * behind a switch. Fixed decoration goes beside the part. It `standsFor` the part, so a wheel drawn
 * without it still steps the coded wheel aside.
 */
export const WHEEL_DEF: ComponentDef = {
	id: 'wheel',
	name: 'Wheel',
	version: 1,
	scope: 'shared',
	category: 'overlay',
	capability: 'holdAndWin',
	root: {
		id: 'wheel-root',
		kind: 'container',
		x: 0,
		y: 0,
		children: [codedPart('wheel-art', 'Wheel', 'HoldAndWinWheelPart', 440, 440)],
	},
	params: [{ key: 'radius', kind: 'number', default: 220 }, ...WHEEL_SKIN_PARAMS],
	standsFor: 'HoldAndWinWheelPart',
};

/** A respin cell's design box: a Cell Tile is authored on one cell, and the board fits it to each. */
export const CELL_TILE_SIZE = 120;

/**
 * One respin cell's tile, for the Respin Cell Tiles to draw under every cell (their `tile` param).
 * SKINNABLE (Phase 12c), the Letter Tile's pattern: the tile art and a held overlay sit INSIDE the
 * coded `Cell` part, which pulses them when a coin lands on its cell (`landPulseScale`, 1 = still,
 * as the coded tiles are). The board feeds each tile its `reel` and `row`, and `held` (1 while a coin
 * holds the cell, else 0), which the overlay shows through a 12b `visible` binding. Authored on one
 * cell's box ({@link CELL_TILE_SIZE} square, centred); the board fits it to each cell's window. It
 * registers nothing, so it stands for no part.
 */
export const CELL_TILE_DEF: ComponentDef = {
	id: 'cellTile',
	name: 'Cell Tile',
	version: 1,
	scope: 'shared',
	category: 'ui',
	capability: 'holdAndWin',
	root: {
		id: 'cellTile-root',
		kind: 'container',
		x: 0,
		y: 0,
		children: [
			{
				...codedPart('cellTile-cell', 'Cell', 'CellTilePart', CELL_TILE_SIZE, CELL_TILE_SIZE),
				children: [
					{
						id: 'cellTile-tile',
						label: 'Tile',
						kind: 'sprite',
						x: 0,
						y: 0,
						anchor: { x: 0.5, y: 0.5 },
						assetKey: '',
						width: CELL_TILE_SIZE,
						height: CELL_TILE_SIZE,
						paramBindings: { region: 'tileImage', tint: 'tileTint' },
						preview: { w: CELL_TILE_SIZE, h: CELL_TILE_SIZE, style: 'tile' },
					},
					{
						id: 'cellTile-held',
						label: 'Held',
						kind: 'sprite',
						x: 0,
						y: 0,
						anchor: { x: 0.5, y: 0.5 },
						assetKey: '',
						width: CELL_TILE_SIZE,
						height: CELL_TILE_SIZE,
						paramBindings: { region: 'heldImage' },
						valueBindings: [{ target: 'visible', param: 'held' }],
						preview: { w: CELL_TILE_SIZE, h: CELL_TILE_SIZE, style: 'tile' },
					},
				],
			},
		],
	},
	params: [
		{ key: 'reel', kind: 'number', default: 0, label: 'column (the board sets it)' },
		{ key: 'row', kind: 'number', default: 0, label: 'row (the board sets it)' },
		{
			key: 'held',
			kind: 'number',
			engineProvided: true,
			label: '1 while a coin holds the cell (the board sets it)',
		},
		{ key: 'tileImage', kind: 'image', label: 'tile under the cell' },
		{ key: 'tileTint', kind: 'color' },
		{ key: 'heldImage', kind: 'image', label: 'over the tile while a coin holds the cell' },
		{
			key: 'landPulseScale',
			kind: 'number',
			default: 1,
			label: 'pulse when a coin lands on the cell (1 = none)',
		},
	],
};

/**
 * The respin board's per-cell TILE and the gap between cells (the references draw every respin cell
 * on a tile, an empty cell as a bare tile). Placed in the `respinBoard` scene; WHERE it sits does not
 * matter — the coded `RespinCellTiles` hands its params to the respin board, which stamps the tile
 * under each cell at that cell's seat and insets each cell's rolling window by `gap` (a share of a
 * cell; a gap with no tile parts the windows over the background). Not placed ⇒ no tiles and no gap,
 * the coded look. In the Scene Editor it shows as a handle only — the tiles draw in the game.
 *
 * SKINNABLE (Phase 12c): `tile` names a component each cell draws as instead of `tileImage` (a
 * project's Cell Tile copy), fed its `reel`, `row` and `held`; blank, the default, stamps
 * `tileImage` as before.
 */
export const RESPIN_CELLS_DEF: ComponentDef = {
	id: 'respinCells',
	name: 'Respin Cell Tiles',
	version: 1,
	scope: 'shared',
	category: 'ui',
	capability: 'holdAndWin',
	root: {
		id: 'respinCells-root',
		kind: 'container',
		x: 0,
		y: 0,
		children: [codedPart('respinCells-tiles', 'Cell tiles', 'RespinCellTiles', 120, 120)],
	},
	params: [
		{ key: 'tileImage', kind: 'image', label: 'tile under every respin cell' },
		{ key: 'tileTint', kind: 'color' },
		{
			key: 'gap',
			kind: 'number',
			default: 0,
			label: 'gap between cells (share of a cell, 0–0.45)',
		},
		{
			key: 'tile',
			kind: 'component',
			default: '',
			label: 'each cell drawn on (blank = tileImage)',
			fedParams: ['reel', 'row', 'held'],
		},
	],
};

/**
 * What every LOCKED cell of an expanding respin board shows (design §7 11b) — the rows below the
 * open ones, until a beat unlocks them. Placed in the `respinBoard` scene; like the cell tiles, WHERE
 * it sits does not matter — the coded `RespinLockedRows` hands its art to the respin board, which
 * stamps it at each locked cell's seat. Not placed, or no image ⇒ the coded overlay (a dark panel
 * marked LOCKED). Draws nothing on a board that never grows.
 */
export const LOCKED_ROW_DEF: ComponentDef = {
	id: 'lockedRow',
	name: 'Locked Row',
	version: 1,
	scope: 'shared',
	category: 'ui',
	capability: 'holdAndWin',
	root: {
		id: 'lockedRow-root',
		kind: 'container',
		x: 0,
		y: 0,
		children: [codedPart('lockedRow-cells', 'Locked cells', 'RespinLockedRows', 120, 120)],
	},
	params: [
		{ key: 'lockedImage', kind: 'image', label: 'art over every locked cell' },
		{ key: 'lockedTint', kind: 'color' },
	],
};

/** The Hold and Win components, in palette order. */
export const HOLD_AND_WIN_COMPONENTS: ComponentDef[] = [
	RESPIN_COUNTER_DEF,
	JACKPOT_TILE_DEF,
	JACKPOT_BAR_DEF,
	TOTAL_WIN_BAR_DEF,
	POT_METER_DEF,
	LETTERS_STRIP_DEF,
	LETTER_TILE_DEF,
	WHEEL_DEF,
	RESPIN_CELLS_DEF,
	CELL_TILE_DEF,
	LOCKED_ROW_DEF,
	LINE_OVERLAY_DEF,
];

/** Every built-in component def — the launcher's lowest-precedence layer. */
export const BUILTIN_COMPONENTS: ComponentDef[] = [
	HUD_READOUT_DEF,
	BUTTON_DEF,
	BUTTON_PRESENTATION_DEF,
	TEXT_BOX_DEF,
	FREE_SPIN_COUNTER_DEF,
	INFO_BAR_DEF,
	LOADING_INTRO_DEF,
	TRANSITION_DEF,
	TRANSITION_WIPE_DEF,
	FREE_SPIN_INTRO_VISUAL_DEF,
	FREE_SPIN_OUTRO_VISUAL_DEF,
	WIN_DEF,
	WIN_PRESENTATION_DEF,
	FREE_SPIN_INTRO_PRESENTATION_DEF,
	FREE_SPIN_OUTRO_PRESENTATION_DEF,
	TAP_TO_CONTINUE_DEF,
	LOADING_BAR_DEF,
	EXPANDING_SYMBOL_DEF,
	FREE_SPIN_INTRO_SYMBOL_REVEAL_DEF,
	FEATURE_CARD_DEF,
	CONFIRM_DIALOG_DEF,
	OPTION_CARD_DEF,
	PLATFORM_JACKPOT_BAR_DEF,
	SEGMENTED_COUNTER_DEF,
	SEGMENTED_COUNTER_SEGMENT_DEF,
	...HOLD_AND_WIN_COMPONENTS,
];

/**
 * Whether the Scene Editor's palette offers `def` to a project of kind `gameType` (with the add-ons
 * its `config` carries): a def gated on a capability (`ComponentDef.capability`) only where
 * `kindCapabilities` grants it. A saved snapshot of a built-in keeps the built-in's gate, so
 * forking the respin counter does not offer it to a lines project. Palette only — never consulted
 * when rendering a doc.
 */
export function componentOfferedForKind(
	def: ComponentDef,
	gameType: string | undefined,
	config?: KindCapabilityConfig,
): boolean {
	if (def.internal || BUILTIN_COMPONENTS.find((b) => b.id === def.id)?.internal) return false;
	const capability = def.capability ?? BUILTIN_COMPONENTS.find((b) => b.id === def.id)?.capability;
	return capability === undefined || kindCapabilities(gameType, config)[capability];
}

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
	return builtin ? mergeCodedParams(def, builtin) : def;
}

/**
 * {@link mergeBuiltinCodedParams} against a GIVEN coded twin instead of this build's
 * `BUILTIN_COMPONENTS` — the same merge for a caller that holds another engine's built-ins (the
 * current-games harness, which bakes a game as a republish on each side of a PR would).
 */
export function mergeCodedParams(def: ComponentDef, builtin: ComponentDef): ComponentDef {
	const have = new Set((def.params ?? []).map((p) => p.key));
	const missing = (builtin.params ?? []).filter((p) => !have.has(p.key));
	// Also refresh each node's `paramBindings` from the coded twin (additive, author wins),
	// so a SAVED snapshot gains bindings the coded def added later — e.g. the Text Box's
	// box/align bindings. Merging the params list ALONE would surface the new controls but
	// wire them to nothing (the frozen root has no binding to the inner text node's box).
	const twinById = indexNodesById(builtin.root);
	const nextRoot = mergeNodeBindings(def.root, twinById);
	const rootChanged = nextRoot !== def.root;
	// The part a snapshot saved before `standsFor` existed still stands for (by id, like the params).
	const standsFor = def.standsFor ?? builtin.standsFor;
	if (!missing.length && !rootChanged && standsFor === def.standsFor) return def;
	return {
		...def,
		...(standsFor ? { standsFor } : {}),
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
