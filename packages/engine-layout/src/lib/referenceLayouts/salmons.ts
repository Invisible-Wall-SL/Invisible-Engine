import type { ComponentDef, LayoutDoc, LayoutNode, Scene } from '../types';
import { arcadeReferenceLayout, textBox } from './arcade';
import { salmonsRiverNode, type SalmonsRiverDrawing } from './salmonsRiver';

export type { SalmonsRiverDrawing } from './salmonsRiver';

/**
 * SALMONS' SCREENS (`docs/design/game-families.md` P10.16): the river a seed made
 * (`engine-mechanics` `salmonsRiver`), drawn as the play field's world, with a camera that follows
 * the device's own salmon, bear or fisherman (`apps/lines` `game/online.ts`), the spawn layer
 * the room's players are drawn in, and (P11.2) the HUD and the round-over screen, fed by the
 * variables the room owns (`engine-flow-v2` `SALMONS_SEED_DOC`). Placeholder shapes until the S0
 * art replaces the three characters' components ({@link SALMONS_CHARACTER_COMPONENTS}) and the
 * backdrop's rectangles.
 *
 * The river is passed in, not imported: this package does not depend on `engine-mechanics`; the
 * river itself is drawn by `./salmonsRiver` (which a room's device also draws its own river
 * with). The river screen is isometric (P11.4): the ground drawn 2:1, the players upright.
 * Played by `scripts/playtest/salmons-play.mjs`; written into a project by
 * `scripts/salmons/export.mjs`. Not exported from the package entry, so no game bundles it.
 */

/** The spawn layer the room's players are drawn in (`arcade.online.layer`'s default). */
export const SALMONS_FIELD = { id: 'field', cap: 120 } as const;

/** How the camera follows the device's own player (`online.ts` gives it the target). */
export const SALMONS_CAMERA = { deadZone: { w: 320, h: 200 }, smoothing: 0.1 } as const;

const placeholder = (
	id: string,
	name: string,
	w: number,
	h: number,
	color: number,
	round = false,
): ComponentDef => ({
	id,
	name,
	version: 1,
	scope: 'project',
	category: 'ui',
	params: [],
	root: {
		id: `${id}-root`,
		kind: 'container',
		x: 0,
		y: 0,
		children: [
			{
				id: `${id}-shape`,
				kind: 'rect',
				x: -w / 2,
				y: -h / 2,
				width: w,
				height: h,
				color,
				...(round ? { borderRadius: Math.min(w, h) / 2 } : {}),
			},
		],
	},
});

/** The three characters' looks, sized to their bodies in `salmonsConfig`, and the looks of the
 *  bear's swipe and the fisherman's cast, sized to their reaches. Placeholders. */
export const SALMONS_CHARACTER_COMPONENTS: readonly ComponentDef[] = [
	placeholder('salmonsSalmon', 'Salmon (placeholder)', 90, 44, 0xfa8072),
	placeholder('salmonsBear', 'Bear (placeholder)', 92, 92, 0x6b4423, true),
	placeholder('salmonsFisherman', 'Fisherman (placeholder)', 56, 88, 0xe0b04a),
	placeholder('salmonsSwipe', 'Swipe (placeholder)', 220, 220, 0xffe08a, true),
	placeholder('salmonsCast', 'Cast (placeholder)', 560, 560, 0xc8e6ff, true),
];

/** The screens the Salmons flow shows over the river. */
export const SALMONS_SCREENS = { hud: 'salmonsHud', over: 'salmonsRoundOver' } as const;

/** One HUD readout: its caption, and its value bound to a variable the room owns. */
const readout = (key: string, caption: string, y: number): LayoutNode[] => [
	textBox(`sm-${key}-caption`, `${caption} caption`, 60, y, { text: caption, fontSize: 28 }),
	textBox(`sm-${key}-value`, caption, 60, y + 38, {
		text: '0',
		source: `var:${key}`,
		fontSize: 44,
	}),
];

/** The score, the round and its clock, top left. */
const hud = (): Scene => ({
	id: SALMONS_SCREENS.hud,
	name: 'Score, round and time',
	space: 'canvas',
	nodes: [
		...readout('score', 'SCORE', 40),
		...readout('round', 'ROUND', 140),
		...readout('secondsLeft', 'TIME', 240),
	],
});

/** Between rounds: the next one starts on its own, counted down by the room's clock. */
const roundOver = (): Scene => ({
	id: SALMONS_SCREENS.over,
	name: 'Round over',
	space: 'canvas',
	alwaysOnTop: true,
	nodes: [
		{
			...textBox('sm-over-title', 'Round over', 0, -80, {
				text: 'ROUND OVER',
				fontSize: 72,
				boxWidth: 1000,
				align: 'center',
			}),
			screenAnchor: { x: 0.5, y: 0.5 },
		},
		{
			...textBox('sm-over-next', 'Next round in', 0, 20, {
				text: 'NEXT ROUND IN',
				fontSize: 32,
				boxWidth: 1000,
				align: 'center',
			}),
			screenAnchor: { x: 0.5, y: 0.5 },
		},
		{
			...textBox('sm-over-seconds', 'Seconds', 0, 70, {
				text: '0',
				source: 'var:secondsLeft',
				fontSize: 56,
				boxWidth: 1000,
				align: 'center',
			}),
			screenAnchor: { x: 0.5, y: 0.5 },
		},
	],
});

/**
 * Salmons' layout: the arcade scene set's loading and background screens, its play field as the
 * river's world with the players' spawn layer (which also holds the swipes and casts the flow
 * draws), the HUD and the round-over screen.
 */
export function salmonsReferenceLayout(river: SalmonsRiverDrawing): LayoutDoc {
	const base = arcadeReferenceLayout();
	const keep = new Set(['loading', 'background']);
	return {
		...base,
		projectKey: 'salmons',
		scenes: [
			...base.scenes.filter((scene) => keep.has(scene.id)),
			{
				id: 'basegame',
				name: 'River',
				role: 'basegame',
				world: { ...river.world },
				camera: { ...SALMONS_CAMERA, deadZone: { ...SALMONS_CAMERA.deadZone } },
				projection: 'isometric',
				nodes: [
					salmonsRiverNode(river),
					{
						id: SALMONS_FIELD.id,
						label: 'Players',
						kind: 'spawnLayer',
						x: 0,
						y: 0,
						spawnable: SALMONS_CHARACTER_COMPONENTS.map((def) => def.id),
						placement: 'free',
						cap: SALMONS_FIELD.cap,
					},
				],
			},
			hud(),
			roundOver(),
		],
	};
}
