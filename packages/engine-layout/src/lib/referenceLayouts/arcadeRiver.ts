import type { LayoutDoc, LayoutNode, Scene } from '../types';
import { ARCADE_FIELD, arcadeReferenceLayout } from './arcade';

/**
 * The SCROLLING arcade sample's screens (`docs/design/game-families.md` §4.4, P10.12): the P10.8
 * scene set with its play field turned into a river four screens tall. The `basegame` screen gets a
 * `world` and a `camera` that follows the salmon (a dead zone, easing, a look-ahead, held inside the
 * world); its spawn layer despawns what the camera leaves behind; a backdrop of banks and ripples
 * moves at half the camera's vertical speed (`parallax`). Placeholder shapes only.
 *
 * Played by `check:arcade-camera` and `scripts/playtest/arcade-camera-play.mjs` with
 * `engine-flow-v2`'s `ARCADE_RIVER_SEED_DOC`. Not a Game Maker kind, and not exported from the
 * package entry, so no game bundles it.
 */

/** The river: the desktop design width, four desktop screens tall. */
export const ARCADE_RIVER_WORLD = { w: 1422, h: 3200 } as const;

/** How the camera follows the salmon. */
export const ARCADE_RIVER_CAMERA = {
	follow: 'player',
	deadZone: { w: 360, h: 220 },
	smoothing: 0.12,
	lookAhead: 0.2,
} as const;

/** Past the view, px, where the camera still keeps what it spawned ahead. */
export const ARCADE_RIVER_DESPAWN_MARGIN = 240;

/** The backdrop's vertical parallax: half the camera's speed. */
export const ARCADE_RIVER_PARALLAX = { x: 1, y: 0.5 } as const;

const rect = (id: string, x: number, y: number, width: number, height: number, color: number) =>
	({ id, kind: 'rect', x, y, width, height, color, anchor: { x: 0, y: 0 } }) as LayoutNode;

/** Banks down both sides and a ripple every 400 px, over the river's parallax height. */
const backdrop = (): LayoutNode => {
	const height = ARCADE_RIVER_WORLD.h * ARCADE_RIVER_PARALLAX.y + 800;
	const ripples: LayoutNode[] = [];
	for (let y = 200, n = 0; y < height; y += 400, n++)
		ripples.push(rect(`river-ripple-${n}`, 260, y, ARCADE_RIVER_WORLD.w - 520, 6, 0x5fa8d3));
	return {
		id: 'river-backdrop',
		label: 'River backdrop',
		kind: 'container',
		x: 0,
		y: 0,
		zIndex: -1,
		parallax: { ...ARCADE_RIVER_PARALLAX },
		children: [
			rect('river-bank-left', 0, 0, 160, height, 0x3d6b35),
			rect('river-bank-right', ARCADE_RIVER_WORLD.w - 160, 0, 160, height, 0x3d6b35),
			...ripples,
		],
	};
};

export function arcadeRiverReferenceLayout(): LayoutDoc {
	const doc = arcadeReferenceLayout();
	const scenes: Scene[] = doc.scenes.map((scene) =>
		scene.id !== 'basegame'
			? scene
			: {
					...scene,
					name: 'River',
					world: { ...ARCADE_RIVER_WORLD },
					camera: {
						...ARCADE_RIVER_CAMERA,
						deadZone: { ...ARCADE_RIVER_CAMERA.deadZone },
					},
					nodes: [
						backdrop(),
						...scene.nodes.map((node) =>
							node.id === ARCADE_FIELD.id
								? { ...node, despawnOutsideView: { margin: ARCADE_RIVER_DESPAWN_MARGIN } }
								: node,
						),
					],
				},
	);
	return { ...doc, projectKey: 'arcade-river', scenes };
}
