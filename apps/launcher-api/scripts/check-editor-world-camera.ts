/**
 * The Scene Editor's world, camera, parallax and despawn-outside-view edits (game-families §4.4,
 * P10.12), over the real `$lib/editor/worldCameraEdit` and the engine sanitizers it writes through:
 *   pnpm --filter launcher-api check:editor-world-camera
 *
 *  1. a world is seeded at 2 × the design box, kept when re-ticked, refused off `game` space, and
 *     turning it off takes the camera too;
 *  2. every camera write stores what the game reads — sparse, defaults dropped (empty follow, 0 s,
 *     clampToWorld true, a 0 × 0 dead zone or auto-scroll), and an all-default camera is removed;
 *  3. parallax 1 × 1 stores nothing; despawn outside view keeps its margin and refuses a negative;
 *  4. the stage overlay's frames: the world from the origin, the camera = the design box there.
 *
 * What it cannot prove: the fields and the stage drawing in a browser — the owner's check.
 */
import { hasWorldCamera, type LayoutNode, type Scene, type SpawnLayerNode } from 'engine-layout';
import {
	cameraFields,
	parallaxFields,
	seedWorld,
	setDespawnMargin,
	setDespawnOutsideView,
	setNodeParallax,
	setSceneCamera,
	setSceneWorldOn,
	setSceneWorldSize,
	worldCameraFrames,
} from '../src/lib/editor/worldCameraEdit.ts';

let checks = 0;
let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
	checks++;
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) return;
	failures++;
	console.error(`FAIL  ${label}\n        expected ${e}\n        got      ${a}`);
}

const MAIN = { width: 1920, height: 1080 };
const scene = (extra: Partial<Scene> = {}): Scene => ({ id: 's', nodes: [], ...extra }) as Scene;

// ── 1. The world ─────────────────────────────────────────────────────────────
check('seed is 2 × the design box', seedWorld(MAIN), { w: 3840, h: 2160 });
{
	const sc = scene();
	setSceneWorldOn(sc, true, MAIN);
	check('ticking seeds the world', sc.world, { w: 3840, h: 2160 });
	check('a world makes a world camera screen', hasWorldCamera(sc), true);
	check('a side above 0 is set', setSceneWorldSize(sc, 'w', 6000), true);
	check('a side of 0 is refused', setSceneWorldSize(sc, 'h', 0), false);
	check('a NaN side is refused', setSceneWorldSize(sc, 'h', Number.NaN), false);
	check('the world after edits', sc.world, { w: 6000, h: 2160 });
	setSceneWorldOn(sc, true, MAIN);
	check('re-ticking keeps the authored world', sc.world, { w: 6000, h: 2160 });
	setSceneCamera(sc, { follow: 'player' });
	setSceneWorldOn(sc, false, MAIN);
	check('unticking drops the world and the camera', [sc.world, sc.camera], [undefined, undefined]);
	check('a size edit without a world is refused', setSceneWorldSize(sc, 'w', 100), false);
}
{
	const sc = scene({ space: 'standard' });
	setSceneWorldOn(sc, true, MAIN);
	check('a non-game screen gets no world', sc.world, undefined);
}

// ── 2. The camera, sparse ────────────────────────────────────────────────────
{
	const sc = scene({ world: { w: 4000, h: 1080 } });
	check('an absent camera shows its defaults', cameraFields(sc), {
		follow: '',
		deadZone: { w: 0, h: 0 },
		smoothing: 0,
		lookAhead: 0,
		clampToWorld: true,
		autoScroll: { x: 0, y: 0 },
	});
	setSceneCamera(sc, { follow: '  player ' });
	check('follow is trimmed', sc.camera, { follow: 'player' });
	setSceneCamera(sc, { deadZone: { w: 200, h: 0 }, smoothing: 0.25, lookAhead: 0 });
	check('defaults are left out', sc.camera, {
		follow: 'player',
		deadZone: { w: 200, h: 0 },
		smoothing: 0.25,
	});
	setSceneCamera(sc, { clampToWorld: false, autoScroll: { x: 0, y: -60 } });
	check('clamp off and auto-scroll are stored', sc.camera, {
		follow: 'player',
		deadZone: { w: 200, h: 0 },
		smoothing: 0.25,
		clampToWorld: false,
		autoScroll: { x: 0, y: -60 },
	});
	setSceneCamera(sc, {
		follow: '',
		deadZone: { w: 0, h: 0 },
		smoothing: 0,
		clampToWorld: true,
		autoScroll: { x: 0, y: 0 },
	});
	check('an all-default camera is removed', sc.camera, undefined);
	setSceneCamera(sc, { smoothing: -1 });
	check('a negative smoothing is not stored', sc.camera, undefined);
}

// ── 3. Parallax and despawn outside view ─────────────────────────────────────
{
	const node = { id: 'bg', kind: 'container', children: [] } as unknown as LayoutNode;
	check('no parallax shows 1 × 1', parallaxFields(node), { x: 1, y: 1 });
	check('a number is accepted', setNodeParallax(node, 'x', 0.5), true);
	check('one axis set', node.parallax, { x: 0.5, y: 1 });
	check('a NaN is refused', setNodeParallax(node, 'y', Number.NaN), false);
	setNodeParallax(node, 'y', 0);
	check('both axes set', node.parallax, { x: 0.5, y: 0 });
	setNodeParallax(node, 'x', 1);
	setNodeParallax(node, 'y', 1);
	check('1 × 1 stores nothing', 'parallax' in node, false);
}
{
	const layer = { id: 'sp', kind: 'spawnLayer', spawnable: [] } as unknown as SpawnLayerNode;
	check('a margin while off is refused', setDespawnMargin(layer, 40), false);
	setDespawnOutsideView(layer, true);
	check('ticking starts at margin 0', layer.despawnOutsideView, { margin: 0 });
	check('a margin is set', setDespawnMargin(layer, 120), true);
	check('a negative margin is refused', setDespawnMargin(layer, -5), false);
	setDespawnOutsideView(layer, true);
	check('re-ticking keeps the margin', layer.despawnOutsideView, { margin: 120 });
	setDespawnOutsideView(layer, false);
	check('unticking removes it', 'despawnOutsideView' in layer, false);
}

// ── 4. The stage overlay ─────────────────────────────────────────────────────
check('no world, no overlay', worldCameraFrames(scene(), MAIN), undefined);
check('world and camera frames', worldCameraFrames(scene({ world: { w: 5000, h: 1500 } }), MAIN), {
	world: { x: 0, y: 0, w: 5000, h: 1500 },
	camera: { x: 0, y: 0, w: 1920, h: 1080 },
});
check(
	'a non-game screen draws no overlay',
	worldCameraFrames(scene({ space: 'canvas', world: { w: 5000, h: 1500 } }), MAIN),
	undefined,
);

if (failures) {
	console.error(`\n${failures} of ${checks} world-camera editor checks failed`);
	process.exit(1);
}
console.log(`ok  ${checks} world-camera editor checks`);
