/**
 * The Scene Editor's edits of a play field's WORLD and CAMERA, a node's PARALLAX and a spawn
 * layer's DESPAWN OUTSIDE VIEW (`docs/design/game-families.md` §4.4, P10.12). Pure: each function
 * mutates the scene or node it is given and the host owns the reassign + markDirty.
 *
 * Every write goes back through the engine's own sanitizers (`engine-layout` `worldCamera.ts`), so
 * the doc stores exactly what the game reads: sparse, defaults left out (an empty follow, 0 s,
 * `clampToWorld` true, parallax 1 × 1). `check:editor-world-camera` holds it.
 */
import {
	despawnOutsideViewMargin,
	hasWorldCamera,
	nodeParallax,
	sceneCamera,
	sceneWorld,
	type LayoutNode,
	type Scene,
	type SceneCamera,
	type SceneProjection,
	type SpawnLayerNode,
} from 'engine-layout';

type Size = { width: number; height: number };
export type WorldRect = { x: number; y: number; w: number; h: number };

/** A new world is this many design boxes wide and tall. */
export const WORLD_SEED_FACTOR = 2;

/** The world a screen gets when the author turns it on: {@link WORLD_SEED_FACTOR} × the design
 *  box of the active layout. */
export const seedWorld = (main: Size): { w: number; h: number } => ({
	w: Math.round(main.width * WORLD_SEED_FACTOR),
	h: Math.round(main.height * WORLD_SEED_FACTOR),
});

/** Give the screen a world (seeded from `main`, kept if it already has one) or take the world and
 *  its camera away. Only a `game` screen has one, so another space is left without. */
export function setSceneWorldOn(scene: Scene, on: boolean, main: Size): void {
	if (on && (scene.space ?? 'game') === 'game') {
		scene.world = sceneWorld(scene) ?? seedWorld(main);
		return;
	}
	delete scene.world;
	delete scene.camera;
	delete scene.projection;
}

/** Set the screen's projection (P11.4), sparse: `flat` deletes it. Only a `game` screen with a
 *  world or a camera draws projected, so it is refused (false) on any other. */
export function setSceneProjection(scene: Scene, projection: 'flat' | SceneProjection): boolean {
	if (projection === 'flat') {
		delete scene.projection;
		return true;
	}
	if ((scene.space ?? 'game') !== 'game' || !hasWorldCamera(scene)) return false;
	scene.projection = projection;
	return true;
}

/** Set one side of the world. A side that is not a number above 0 is refused (false). */
export function setSceneWorldSize(scene: Scene, side: 'w' | 'h', v: number): boolean {
	const world = sceneWorld(scene);
	if (!world || !Number.isFinite(v) || v <= 0) return false;
	scene.world = { ...world, [side]: v };
	return true;
}

/** Merge `patch` into the camera and store what the game would read; an all-default camera is
 *  removed. */
export function setSceneCamera(scene: Scene, patch: Partial<SceneCamera>): void {
	const next = sceneCamera({ ...scene, camera: { ...scene.camera, ...patch } });
	if (next && Object.keys(next).length) scene.camera = next;
	else delete scene.camera;
}

/** The camera as the Properties fields show it: every field filled, defaults included. */
export function cameraFields(scene: Scene): Required<SceneCamera> {
	const c = sceneCamera(scene) ?? {};
	return {
		follow: c.follow ?? '',
		deadZone: c.deadZone ?? { w: 0, h: 0 },
		smoothing: c.smoothing ?? 0,
		lookAhead: c.lookAhead ?? 0,
		clampToWorld: c.clampToWorld ?? true,
		autoScroll: c.autoScroll ?? { x: 0, y: 0 },
	};
}

/** The stage overlay, in the screen's (main-box) coords: the world's bounds and the camera's first
 *  frame — the design box at the world origin, where the camera starts. */
export function worldCameraFrames(
	scene: Scene,
	main: Size,
): { world: WorldRect; camera: WorldRect } | undefined {
	const world = sceneWorld(scene);
	if (!world) return undefined;
	return {
		world: { x: 0, y: 0, w: world.w, h: world.h },
		camera: { x: 0, y: 0, w: main.width, h: main.height },
	};
}

/** A node's parallax as the fields show it (1 × 1 when unset). */
export const parallaxFields = (node: LayoutNode): { x: number; y: number } =>
	nodeParallax(node) ?? { x: 1, y: 1 };

/** Set one axis of a node's parallax; 1 × 1 removes it. A non-number is refused (false). */
export function setNodeParallax(node: LayoutNode, axis: 'x' | 'y', v: number): boolean {
	if (!Number.isFinite(v)) return false;
	const next = nodeParallax({ ...node, parallax: { ...parallaxFields(node), [axis]: v } });
	if (next) node.parallax = next;
	else delete node.parallax;
	return true;
}

/** Turn a spawn layer's despawn-outside-view on (margin kept, else 0) or off. */
export function setDespawnOutsideView(node: SpawnLayerNode, on: boolean): void {
	if (on) node.despawnOutsideView = { margin: despawnOutsideViewMargin(node) ?? 0 };
	else delete node.despawnOutsideView;
}

/** Set the despawn margin, px. Only while on; a negative or non-number margin is refused (false). */
export function setDespawnMargin(node: SpawnLayerNode, v: number): boolean {
	if (despawnOutsideViewMargin(node) === undefined || !Number.isFinite(v) || v < 0) return false;
	node.despawnOutsideView = { margin: v };
	return true;
}
