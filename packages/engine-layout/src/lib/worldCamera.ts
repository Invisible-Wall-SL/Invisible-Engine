/**
 * A play-field screen's WORLD and CAMERA (`docs/design/game-families.md` §4.4, P10.12), read
 * defensively (the save keeps a node's fields as authored). Free of Svelte and of
 * `engine-flow-v2`, so Node gates and the editor read the same answer the game does. The live
 * camera the game draws by is `worldCameraView.svelte.ts`.
 */

import type { LayoutNode, Point2D, Scene, SceneCamera, SpawnLayerNode } from './types';

const positive = (v: unknown): number | undefined =>
	typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
const nonNegative = (v: unknown): number | undefined =>
	typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
const finite = (v: unknown): number | undefined =>
	typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const record = (v: unknown): Record<string, unknown> | undefined =>
	v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

/** A screen's world, when it is whole (both sides > 0) and the screen is `game` space. */
export const sceneWorld = (scene: Scene | undefined): { w: number; h: number } | undefined => {
	if (!scene || (scene.space ?? 'game') !== 'game') return undefined;
	const world = record(scene.world);
	const w = positive(world?.w);
	const h = positive(world?.h);
	return w && h ? { w, h } : undefined;
};

/** A screen's camera block, sanitized: only the fields that are whole, defaults left out. */
export const sceneCamera = (scene: Scene | undefined): SceneCamera | undefined => {
	if (!scene || (scene.space ?? 'game') !== 'game') return undefined;
	const raw = record(scene.camera);
	if (!raw) return undefined;
	const out: SceneCamera = {};
	if (typeof raw.follow === 'string' && raw.follow.trim()) out.follow = raw.follow.trim();
	const dead = record(raw.deadZone);
	const dw = nonNegative(dead?.w);
	const dh = nonNegative(dead?.h);
	if (dw || dh) out.deadZone = { w: dw ?? 0, h: dh ?? 0 };
	const smoothing = positive(raw.smoothing);
	if (smoothing) out.smoothing = smoothing;
	const lookAhead = positive(raw.lookAhead);
	if (lookAhead) out.lookAhead = lookAhead;
	if (raw.clampToWorld === false) out.clampToWorld = false;
	const scroll = record(raw.autoScroll);
	const sx = finite(scroll?.x);
	const sy = finite(scroll?.y);
	if (sx || sy) out.autoScroll = { x: sx ?? 0, y: sy ?? 0 };
	return out;
};

/** Whether a screen is drawn through a world camera: a `game` screen with a world, or a camera that
 *  sets anything (an all-default `camera: {}` alone is none). */
export const hasWorldCamera = (scene: Scene | undefined): boolean => {
	if (sceneWorld(scene)) return true;
	const camera = sceneCamera(scene);
	return !!camera && Object.keys(camera).length > 0;
};

/** The play field's screen: the first that declares a world or a camera, or none (the game then
 *  has no camera, as before P10.12). */
export const worldCameraScene = (scenes: readonly Scene[]): Scene | undefined =>
	scenes.find((scene) => hasWorldCamera(scene));

/** A node's parallax factor, when it departs from moving with the world (1, 1). A spawn layer has
 *  none: the arcade loop judges its bodies against the view in world px, so it must move with the
 *  world. */
export const nodeParallax = (node: LayoutNode): Point2D | undefined => {
	if (node.kind === 'spawnLayer') return undefined;
	const raw = record((node as { parallax?: unknown }).parallax);
	if (!raw) return undefined;
	const x = finite(raw.x) ?? 1;
	const y = finite(raw.y) ?? 1;
	return x === 1 && y === 1 ? undefined : { x, y };
};

/** A spawn layer's `despawnOutsideView` margin, when set (≥ 0). */
export const despawnOutsideViewMargin = (node: SpawnLayerNode): number | undefined =>
	nonNegative(record(node.despawnOutsideView)?.margin);

/** Where a parallax layer is drawn relative to where the world puts it (`camera.js`
 *  `parallaxOffset`; the same arithmetic, so the editor and the game agree). */
export const parallaxShift = (
	camera: { x: number; y: number },
	factor: Point2D,
): { x: number; y: number } => ({ x: camera.x * (1 - factor.x), y: camera.y * (1 - factor.y) });
