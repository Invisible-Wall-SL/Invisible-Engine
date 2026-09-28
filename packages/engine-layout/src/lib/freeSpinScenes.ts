import type { LayoutNode, Scene } from './types';
import {
	TAP_ARM_AFTER_SIGNAL_PARAM,
	TAP_DIM_ALPHA_PARAM,
	TAP_TO_CONTINUE_PARAM,
} from './tapToContinue';

/**
 * The engine-default free-spin INTRO / OUTRO screens every reference layout seeds — the screens a
 * v2 flow shows around the feature (`showContainer` … `showContainer{awaitComplete}` …
 * `hideContainer`). Each is self-sufficient, so a fresh project's intro and outro hold the round
 * on the player's tap with no engine gate:
 *
 *   - a `tapToContinue` instance carrying the dim — its tap completes the container, which
 *     releases the flow's `awaitComplete` hold. The OUTRO's is armed only after
 *     `freeSpinOutroCountUpComplete`, so a tap during the count-up can't dismiss a total the player
 *     has not seen yet (its dim arrives with it);
 *   - the coded board-centred VISUAL (`FreeSpinIntroVisual` / `FreeSpinOutroVisual`), which
 *     animates off the free-spin cues and reads the engine outro driver's count-up.
 *
 * The dim lives on the tap instance rather than a separate `rect`, because the "New game from
 * kind" scaffold keeps engine-owned nodes only (`engineOwnedOnly`) and would drop a plain rect.
 * Both screens are `alwaysOnTop`, so the dim covers the HUD the way the retired engine gates did.
 */

const tap = (id: string, armAfterSignal?: string): LayoutNode => ({
	id,
	label: 'Tap to continue',
	kind: 'componentInstance',
	componentId: 'tapToContinue',
	x: 0,
	y: 0,
	params: {
		[TAP_TO_CONTINUE_PARAM]: true,
		[TAP_DIM_ALPHA_PARAM]: 0.5,
		...(armAfterSignal ? { [TAP_ARM_AFTER_SIGNAL_PARAM]: armAfterSignal } : {}),
	},
});

export function defaultFreeSpinIntroScene(name = 'Free-spin intro'): Scene {
	return {
		id: 'freeSpinIntro',
		name,
		space: 'canvas',
		alwaysOnTop: true,
		nodes: [
			tap('fs-intro-tap'),
			{
				id: 'fs-intro',
				slotId: 'freeSpinIntro',
				label: 'Free-spin intro',
				kind: 'container',
				x: 0,
				y: 0,
				bind: {
					component: 'FreeSpinIntroVisual',
					props: {
						boundToInstance: false,
						introSpine: 'fsIntroNumber',
						introAnimation: 'intro',
						idleAnimation: 'idle',
						slotName: 'slot_number',
					},
				},
				children: [],
			},
		],
	};
}

export function defaultFreeSpinOutroScene(name = 'Free-spin outro'): Scene {
	return {
		id: 'freeSpinOutro',
		name,
		space: 'canvas',
		alwaysOnTop: true,
		nodes: [
			tap('fs-outro-tap', 'freeSpinOutroCountUpComplete'),
			{
				id: 'fs-outro',
				slotId: 'freeSpinOutro',
				label: 'Free-spin outro',
				kind: 'container',
				x: 0,
				y: 0,
				bind: {
					component: 'FreeSpinOutroVisual',
					props: {
						boundToInstance: false,
						outroSpine: 'fsOutroNumber',
						outroAnimation: 'intro',
						idleAnimation: 'idle',
						slotName: 'slot_number',
					},
				},
				children: [],
			},
		],
	};
}
