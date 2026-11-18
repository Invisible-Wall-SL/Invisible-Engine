import type { CharacterClips, ComponentDef, LayoutDoc, LayoutNode, Scene } from '../types';
import { arcadeReferenceLayout, textBox } from './arcade';
import { SALMONS_FIELD_LAYER, salmonsRiverNode, type SalmonsRiverDrawing } from './salmonsRiver';

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
 * with). The river screen is isometric (P11.4): the ground drawn 2:1, the players upright, mirrored
 * as the original drew it (the source top-left, the sea bottom-right).
 * Played by `scripts/playtest/salmons-play.mjs`; written into a project by
 * `scripts/salmons/export.mjs`. Not exported from the package entry, so no game bundles it.
 */

/** The spawn layer the room's players are drawn in (`arcade.online.layer`'s default). */
export const SALMONS_FIELD = { id: SALMONS_FIELD_LAYER, cap: 120 } as const;

/**
 * How the camera follows the device's own player (`online.ts` gives it the target), as the original
 * client's (`client/game.js`): no dead zone, eased (its 0.15 a frame at 60 fps is a time constant
 * of about 0.1 s), never held inside the world, and a cell drawn 64 × 32 window px (the old tile:
 * a 96 × 48 cell at 2/3), half that on a phone or tablet.
 */
export const SALMONS_CAMERA = {
	deadZone: { w: 0, h: 0 },
	smoothing: 0.1,
	clampToWorld: false,
	zoom: 2 / 3,
	mobileZoom: 1 / 3,
	zoomIn: 'window',
} as const;

/** How a placeholder sits on its place: a character stands on it (its feet there, as the S0 art's
 *  bottom-centre anchor), an ability's reach is centred on it. A `rect` is drawn about its centre
 *  (anchor 0.5), so its x / y is where its middle goes. */
type Seat = 'stand' | 'centre';

const placeholder = (
	id: string,
	name: string,
	w: number,
	h: number,
	color: number,
	seat: Seat,
	round = false,
	characterClips?: CharacterClips,
): ComponentDef => ({
	id,
	name,
	version: 1,
	scope: 'project',
	category: 'ui',
	params: [],
	...(characterClips ? { characterClips } : {}),
	root: {
		id: `${id}-root`,
		kind: 'container',
		x: 0,
		y: 0,
		children: [
			{
				id: `${id}-shape`,
				kind: 'rect',
				x: 0,
				y: seat === 'stand' ? -h / 2 : 0,
				width: w,
				height: h,
				color,
				...(round ? { borderRadius: Math.min(w, h) / 2 } : {}),
			},
		],
	},
});

/**
 * The S0 clips each character plays once they are in the project (`characterClips.ts`), drawn at
 * its body's width: `salmon_pink_*` (the golden salmon's are `salmon_golden_*` if made, else the
 * pink ones drawn gold), `bear_*` and `fisherman_*`. With none, the placeholder is drawn.
 */
export const SALMONS_CHARACTER_CLIPS = {
	salmon: {
		prefixes: { base: 'salmon_pink', marked: 'salmon_golden' },
		displayWidth: 90,
		idle: 'swim',
		on: { jumped: 'hop', climbed: 'hop', caught: 'caught' },
	},
	bear: {
		prefixes: { base: 'bear' },
		displayWidth: 92,
		idle: 'idle',
		walk: 'walk',
		on: { ability: 'swipe' },
	},
	fisherman: {
		prefixes: { base: 'fisherman' },
		displayWidth: 56,
		idle: 'idle',
		walk: 'walk',
		holding: 'reel',
		on: { ability: 'cast' },
	},
} as const satisfies Record<string, CharacterClips>;

/** The three characters' looks, sized to their bodies in `salmonsConfig`, the looks of the
 *  bear's swipe and the fisherman's cast, sized to their reaches, and the splash the flow draws at
 *  a climb or a hook. Placeholders, until each character's clips are in the project. */
export const SALMONS_CHARACTER_COMPONENTS: readonly ComponentDef[] = [
	placeholder('salmonsSalmon', 'Salmon (placeholder)', 90, 44, 0xfa8072, 'stand', false, {
		...SALMONS_CHARACTER_CLIPS.salmon,
	}),
	placeholder('salmonsBear', 'Bear (placeholder)', 92, 92, 0x6b4423, 'stand', true, {
		...SALMONS_CHARACTER_CLIPS.bear,
	}),
	placeholder('salmonsFisherman', 'Fisherman (placeholder)', 56, 88, 0xe0b04a, 'stand', false, {
		...SALMONS_CHARACTER_CLIPS.fisherman,
	}),
	placeholder('salmonsSwipe', 'Swipe (placeholder)', 220, 220, 0xffe08a, 'centre', true),
	placeholder('salmonsCast', 'Cast (placeholder)', 560, 560, 0xc8e6ff, 'centre', true),
	placeholder('salmonsSplash', 'Splash (placeholder)', 150, 70, 0x9fd8ff, 'centre', true),
];

/** The screens the Salmons flow shows over the river. */
export const SALMONS_SCREENS = {
	hud: 'salmonsHud',
	over: 'salmonsRoundOver',
	golden: 'salmonsGolden',
	lobby: 'salmonsLobby',
	countdown: 'salmonsCountdown',
} as const;

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

/** A centred line of a full-screen message. */
const centred = (
	id: string,
	label: string,
	y: number,
	text: string,
	fontSize: number,
	source?: string,
): LayoutNode => ({
	...textBox(id, label, 0, y, {
		text,
		fontSize,
		boxWidth: 1000,
		align: 'center',
		...(source ? { source } : {}),
	}),
	screenAnchor: { x: 0.5, y: 0.5 },
});

/**
 * Before the first round (a game with `rules.lobby`): the room is waiting for players. An authored
 * screen like any other: edit it in `/editor`; the flow shows it while the room waits.
 */
const lobby = (): Scene => ({
	id: SALMONS_SCREENS.lobby,
	name: 'Lobby',
	space: 'canvas',
	alwaysOnTop: true,
	nodes: [
		centred('sm-lobby-title', 'Lobby title', -80, 'WAITING FOR PLAYERS', 64),
		centred('sm-lobby-note', 'Lobby note', 10, 'THE RIVER OPENS WHEN THE ROOM IS READY', 28),
	],
});

/** The lobby's countdown to round 1, under its title, on the room's clock. */
const countdown = (): Scene => ({
	id: SALMONS_SCREENS.countdown,
	name: 'Lobby countdown',
	space: 'canvas',
	alwaysOnTop: true,
	nodes: [
		centred('sm-countdown-caption', 'Starting in', 70, 'STARTING IN', 32),
		centred('sm-countdown-seconds', 'Seconds', 120, '0', 56, 'var:secondsLeft'),
	],
});

/** The device's own salmon turned golden: a banner across the top for a moment. */
const golden = (): Scene => ({
	id: SALMONS_SCREENS.golden,
	name: 'Golden salmon',
	space: 'canvas',
	nodes: [
		{
			...textBox('sm-golden-title', 'Golden salmon', 0, 60, {
				text: 'GOLDEN SALMON — WORTH 3×',
				fontSize: 48,
				boxWidth: 1000,
				align: 'center',
			}),
			screenAnchor: { x: 0.5, y: 0 },
		},
	],
});

/**
 * Salmons' layout: the arcade scene set's loading and background screens, its play field as the
 * river's world with the players' spawn layer (which also holds the swipes and casts the flow
 * draws), the HUD, the golden salmon's banner, the round-over screen, and the lobby with its
 * countdown, shown before the first round when the config has a lobby.
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
				// The original's orientation: the source top-left, the sea bottom-right.
				mirrored: true,
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
			golden(),
			roundOver(),
			lobby(),
			countdown(),
		],
	};
}
