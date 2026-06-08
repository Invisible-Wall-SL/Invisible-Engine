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
 * MOUNT path (§14.3, owner-chosen 2026-06-08): `root` is a local-space container
 * whose single child `bind`s the coded `HudReadout` component (registered via
 * `registerBoundComponents`). That coded component keeps the PROVEN coded-label
 * rendering — the localized caption, `UiLabel`'s stacked caption+value, the
 * per-source currency formatting, and the count-up — instead of re-implementing
 * them as engine text nodes (which would lose currency formatting + bitmap-font
 * fidelity). The mounted component reads the SAME params (`source`/`label`/`fill`/
 * `fontSize`/`fontFamily`/`countUp`/`value`) off the param context that
 * `<ComponentInstance>` provides — they flow to it through the context, not via
 * text `paramBindings`. The Component Editor still owns the def (so B3 per-project
 * defaults apply) and the preview path falls back to the bound-component catalog
 * art for this `bind` anchor.
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
				id: 'hudReadout-mount',
				kind: 'container',
				x: 0,
				y: 0,
				bind: { component: 'HudReadout' },
				preview: { w: HUD_CAPTION_FONT_SIZE * 8, h: HUD_VALUE_FONT_SIZE * 3, style: 'label' },
				children: [],
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
