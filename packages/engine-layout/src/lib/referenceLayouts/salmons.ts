import type { CharacterClips, ComponentDef, LayoutDoc, LayoutNode, Scene } from '../types';
import { arcadeReferenceLayout, textBox } from './arcade';
import { SALMONS_CHARACTER_CLIPS } from './salmonsClips';
import { SALMONS_FIELD_LAYER, salmonsRiverNode, type SalmonsRiverDrawing } from './salmonsRiver';
import { SALMONS_SCREEN_ART } from './salmonsScreens';

export { SALMONS_CHARACTER_CLIPS } from './salmonsClips';
export type { SalmonsRiverDrawing } from './salmonsRiver';
export { SALMONS_SCREEN_ART } from './salmonsScreens';

/**
 * SALMONS' SCREENS (`docs/design/game-families.md` P10.16): the river a seed made
 * (`engine-mechanics` `salmonsRiver`), drawn as the play field's world, with a camera that follows
 * the device's own salmon, bear or fisherman (`apps/lines` `game/online.ts`), the spawn layer
 * the room's players are drawn in, and the original game's screens over it: the death screen, the
 * win animation and the lobby's note, shown by the flow (`engine-flow-v2`
 * `SALMONS_SEED_DOC`) and drawn in code by the room's built-in art (`./salmonsScreens.ts`).
 * Placeholder shapes until the art replaces the three characters' components
 * ({@link SALMONS_CHARACTER_COMPONENTS}) and the backdrop's rectangles.
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

/** A character's placeholder stands on its place (its feet there, as the S0 art's bottom-centre
 *  anchor). A `rect` is drawn about its centre (anchor 0.5), so it is raised by half its height. */
const placeholder = (
	id: string,
	name: string,
	w: number,
	h: number,
	color: number,
	round: boolean,
	characterClips: CharacterClips,
): ComponentDef => ({
	id,
	name,
	version: 1,
	scope: 'project',
	category: 'ui',
	params: [],
	characterClips,
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
				y: -h / 2,
				width: w,
				height: h,
				color,
				...(round ? { borderRadius: Math.min(w, h) / 2 } : {}),
			},
		],
	},
});

/** The three characters' looks, sized to their bodies in `salmonsConfig`. Placeholders, until
 *  each character's clips are in the project (or the room's built-in art draws them). */
export const SALMONS_CHARACTER_COMPONENTS: readonly ComponentDef[] = [
	placeholder('salmonsSalmon', 'Salmon (placeholder)', 90, 44, 0xfa8072, false, {
		...SALMONS_CHARACTER_CLIPS.salmon,
	}),
	placeholder('salmonsBear', 'Bear (placeholder)', 92, 92, 0x6b4423, true, {
		...SALMONS_CHARACTER_CLIPS.bear,
	}),
	placeholder('salmonsFisherman', 'Fisherman (placeholder)', 56, 88, 0xe0b04a, false, {
		...SALMONS_CHARACTER_CLIPS.fisherman,
	}),
];

/** The screens the Salmons flow shows over the river. */
export const SALMONS_SCREENS = {
	caught: 'salmonsCaught',
	won: 'salmonsWon',
	lobby: 'salmonsLobby',
	countdown: 'salmonsCountdown',
} as const;

/** The node a part of a screen drawn in code (`salmonsScreens.ts`) is drawn in place of: an empty
 *  container, so a screen without the room's art draws nothing there. */
const codeDrawn = (id: string, label: string): LayoutNode => ({
	id,
	label,
	kind: 'container',
	x: 0,
	y: 0,
	children: [],
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

/** The own player was caught (owner decision 4): "You have been caught / by NAME", what to
 *  respawn as and the Respawn button, all drawn in code; the flow shows it on the catch and hides
 *  it once the player is back. */
const caught = (): Scene => ({
	id: SALMONS_SCREENS.caught,
	name: 'Caught',
	space: 'canvas',
	alwaysOnTop: true,
	nodes: [codeDrawn(SALMONS_SCREEN_ART.caught, 'Death screen (drawn in code)')],
});

/** The round's end (the first salmon at the source): the original's win animation, drawn in code,
 *  whose button leaves for a new river. */
const won = (): Scene => ({
	id: SALMONS_SCREENS.won,
	name: 'Won',
	space: 'canvas',
	alwaysOnTop: true,
	nodes: [codeDrawn(SALMONS_SCREEN_ART.won, 'Win animation (drawn in code)')],
});

/**
 * Before a session (a game with `rules.lobby`): the room waits for its players, and the lobby's
 * note (drawn in code: the room's river, the people in it, who the device plays) sits under the
 * title. The texts are authored like any other: edit them in `/editor`; the flow shows the screen
 * while the room waits. The note's node keeps the label it was published with (the start menu was
 * drawn there until 2026-11-20; it comes before the join now): changing it is a layout upload.
 */
const lobby = (): Scene => ({
	id: SALMONS_SCREENS.lobby,
	name: 'Lobby',
	space: 'canvas',
	alwaysOnTop: true,
	nodes: [
		centred('sm-lobby-name', 'Game title', -270, 'Salmons!!!', 48),
		centred('sm-lobby-tagline', 'Tagline', -225, 'A massively multiplayer river survival game', 16),
		centred('sm-lobby-title', 'Lobby title', -185, 'WAITING FOR PLAYERS', 24),
		codeDrawn(SALMONS_SCREEN_ART.lobby, 'Start menu (drawn in code)'),
	],
});

/** The lobby's countdown to the session, under the menu, on the room's clock. */
const countdown = (): Scene => ({
	id: SALMONS_SCREENS.countdown,
	name: 'Lobby countdown',
	space: 'canvas',
	alwaysOnTop: true,
	nodes: [
		centred('sm-countdown-caption', 'Starting in', 210, 'STARTING IN', 24),
		centred('sm-countdown-seconds', 'Seconds', 250, '0', 40, 'var:secondsLeft'),
	],
});

/**
 * Salmons' layout: the arcade scene set's loading screen (with the original's loading phrases) and
 * background, its play field as the river's world with the players' spawn layer, the death screen,
 * the win animation, and the lobby with its note and countdown, shown before the first round
 * when the config has a lobby. No HUD: the original shows none (owner decision, 2026-11-18).
 */
export function salmonsReferenceLayout(river: SalmonsRiverDrawing): LayoutDoc {
	const base = arcadeReferenceLayout();
	const keep = new Set(['loading', 'background']);
	return {
		...base,
		projectKey: 'salmons',
		scenes: [
			...base.scenes
				.filter((scene) => keep.has(scene.id))
				.map((scene) =>
					scene.id === 'loading'
						? {
								...scene,
								nodes: [
									...scene.nodes,
									codeDrawn(SALMONS_SCREEN_ART.phrases, 'Loading phrases (drawn in code)'),
								],
							}
						: scene,
				),
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
			caught(),
			won(),
			lobby(),
			countdown(),
		],
	};
}
