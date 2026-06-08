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
 * (balance / win / bet) by its `source` param. `root` is a local-space
 * container holding a CAPTION text node stacked over a VALUE text node, mirroring
 * `UiLabel`'s stacked layout (caption at y:0, value one font-size below). The
 * value node carries a static sample (`'1,234'`) so the Component-Editor preview
 * reads like a real readout before any live value feed binds `value`.
 *
 * Bindings drive the consumer (`LayoutNodeView`): the caption binds its `text`
 * to the `label` param (string); the value binds `text` to the `value` param
 * (number → `<ParamReadoutText>`, formatted + optional count-up) and its
 * `style.fill`/`style.fontSize`/`style.fontFamily` to the matching style params.
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
				id: 'hudReadout-caption',
				kind: 'text',
				x: 0,
				y: 0,
				anchor: { x: 0.5, y: 0 },
				text: 'LABEL',
				style: {
					fontFamily: HUD_FONT_FAMILY,
					fontSize: HUD_CAPTION_FONT_SIZE,
					fill: HUD_FILL,
				},
				paramBindings: { text: 'label' },
			},
			{
				id: 'hudReadout-value',
				kind: 'text',
				x: 0,
				y: HUD_VALUE_FONT_SIZE,
				anchor: { x: 0.5, y: 0 },
				text: '1,234',
				style: {
					fontFamily: HUD_FONT_FAMILY,
					fontSize: HUD_VALUE_FONT_SIZE,
					fill: HUD_FILL,
				},
				paramBindings: {
					text: 'value',
					'style.fill': 'fill',
					'style.fontSize': 'fontSize',
					'style.fontFamily': 'fontFamily',
				},
			},
		],
	},
	params: [
		{ key: 'source', kind: 'string' },
		{ key: 'label', kind: 'string', default: 'BALANCE' },
		{ key: 'fill', kind: 'color', default: HUD_FILL },
		{ key: 'fontSize', kind: 'number', default: HUD_VALUE_FONT_SIZE },
		{ key: 'fontFamily', kind: 'string', default: HUD_FONT_FAMILY },
		{ key: 'countUp', kind: 'boolean', default: false },
		{ key: 'value', kind: 'number', engineProvided: true },
	],
};

/** Every built-in component def — the launcher's lowest-precedence layer. */
export const BUILTIN_COMPONENTS: ComponentDef[] = [HUD_READOUT_DEF];
