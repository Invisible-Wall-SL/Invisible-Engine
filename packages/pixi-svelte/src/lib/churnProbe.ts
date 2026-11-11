import { Particle } from '@barvynkoa/particle-emitter';
import { RigView } from 'engine-rig/pixi';
import {
	AbstractText,
	Container,
	Graphics,
	Mesh,
	Sprite,
	ViewContainer,
	type DestroyOptions,
	type Renderer,
} from 'pixi.js';

/**
 * CHURN, for the `?perf=1` readout: what a frame built and threw away. Turned on and off with the
 * rest of the probe (`perfProbe.ts` `setPerfProbe`, the renderer's part by `glCounters.ts`
 * `instrumentApp`); off, nothing here is installed, so a display object is built, destroyed and
 * drawn exactly as without it.
 *
 * - **Display objects built and destroyed, by kind.** Pixi's `Container` constructor assigns
 *   `this.uid` before anything else, so while the probe is on `Container.prototype` carries a `uid`
 *   setter that makes the instance's own `uid` (as the assignment would have) and counts the
 *   object; `Container.prototype.destroy`, which every subclass's `destroy` reaches through
 *   `super`, is wrapped to count it once. A `RigView` counts as a rig, not a container; a sprite
 *   an emitter spawns as a particle.
 * - **Text renders**: each time canvas `Text` drew a texture (`CanvasTextSystem.getTexture`, a
 *   cache miss of a text and style it was not showing) and each `HTMLText` texture build. A
 *   counter whose label changes pays one per change.
 * - **DOM nodes**: Svelte keeps a comment or text anchor in the page for every block of the Pixi
 *   component tree, in the `<div>` that holds the canvas (`InitialiseApplication`), so each mount
 *   and unmount inserts and removes nodes there. A `MutationObserver` counts them. Its callback is
 *   a microtask queued by the first change, after the frame callback's own timing microtask
 *   (`perfProbe.ts`), so the counting is not in `jsMs`; making the records is, inside Svelte's flush.
 *
 * A frame's churn runs from its first animation-frame callback to the next frame's, as `jsMs` is
 * keyed: what a frame's callbacks, their microtasks and the tasks before the next frame built.
 */

export interface ChurnCounts {
	/** Display objects built: every kind below, rigs included. */
	created: number;
	createdContainers: number;
	createdSprites: number;
	/** Sprites an emitter spawned (`@barvynkoa/particle-emitter` `Particle`). */
	createdParticles: number;
	/** `Text`, `BitmapText`, `HTMLText`. */
	createdTexts: number;
	createdGraphics: number;
	createdMeshes: number;
	/** Other drawn views: `ParticleContainer`, `NineSliceSprite`, `TilingSprite`. */
	createdOther: number;
	destroyed: number;
	destroyedContainers: number;
	destroyedSprites: number;
	destroyedParticles: number;
	destroyedTexts: number;
	destroyedGraphics: number;
	destroyedMeshes: number;
	destroyedOther: number;
	/** `RigView`s built and destroyed (each also builds its meshes and a measuring `Graphics`). */
	rigsBuilt: number;
	rigsDestroyed: number;
	/** Text textures drawn: canvas `Text` and `HTMLText`. */
	textRenders: number;
	/** Ms drawing canvas text textures (`HTMLText` builds theirs asynchronously, not timed). */
	textMs: number;
	/** Nodes inserted into and removed from the canvas's host `<div>`. */
	domAdded: number;
	domRemoved: number;
}

export const CHURN_KEYS = [
	'created',
	'createdContainers',
	'createdSprites',
	'createdParticles',
	'createdTexts',
	'createdGraphics',
	'createdMeshes',
	'createdOther',
	'destroyed',
	'destroyedContainers',
	'destroyedSprites',
	'destroyedParticles',
	'destroyedTexts',
	'destroyedGraphics',
	'destroyedMeshes',
	'destroyedOther',
	'rigsBuilt',
	'rigsDestroyed',
	'textRenders',
	'textMs',
	'domAdded',
	'domRemoved',
] as const satisfies readonly (keyof ChurnCounts)[];

export const emptyChurnCounts = (): ChurnCounts => ({
	created: 0,
	createdContainers: 0,
	createdSprites: 0,
	createdParticles: 0,
	createdTexts: 0,
	createdGraphics: 0,
	createdMeshes: 0,
	createdOther: 0,
	destroyed: 0,
	destroyedContainers: 0,
	destroyedSprites: 0,
	destroyedParticles: 0,
	destroyedTexts: 0,
	destroyedGraphics: 0,
	destroyedMeshes: 0,
	destroyedOther: 0,
	rigsBuilt: 0,
	rigsDestroyed: 0,
	textRenders: 0,
	textMs: 0,
	domAdded: 0,
	domRemoved: 0,
});

export type ChurnKind =
	'rig' | 'particle' | 'sprite' | 'text' | 'graphics' | 'mesh' | 'other' | 'container';

type CountKey = keyof ChurnCounts;

const CREATED: Record<ChurnKind, CountKey> = {
	rig: 'rigsBuilt',
	particle: 'createdParticles',
	sprite: 'createdSprites',
	text: 'createdTexts',
	graphics: 'createdGraphics',
	mesh: 'createdMeshes',
	other: 'createdOther',
	container: 'createdContainers',
};

const DESTROYED: Record<ChurnKind, CountKey> = {
	rig: 'rigsDestroyed',
	particle: 'destroyedParticles',
	sprite: 'destroyedSprites',
	text: 'destroyedTexts',
	graphics: 'destroyedGraphics',
	mesh: 'destroyedMeshes',
	other: 'destroyedOther',
	container: 'destroyedContainers',
};

/** The kind a display object counts as, most specific first. */
export function churnKind(object: object): ChurnKind {
	if (object instanceof RigView) return 'rig';
	if (object instanceof Particle) return 'particle';
	if (object instanceof Sprite) return 'sprite';
	if (object instanceof AbstractText) return 'text';
	if (object instanceof Graphics) return 'graphics';
	if (object instanceof Mesh) return 'mesh';
	if (object instanceof ViewContainer) return 'other';
	return 'container';
}

/** The churn of the frame whose callbacks are running, and of the frame before. */
const frames = {
	at: Number.NaN,
	counts: emptyChurnCounts(),
	beforeAt: Number.NaN,
	before: emptyChurnCounts(),
};

const clear = (counts: ChurnCounts): void => {
	for (const key of CHURN_KEYS) counts[key] = 0;
};

/** A new frame's first callback: what came before it was the previous frame's. */
export function churnFrameStarts(at: number): void {
	if (at === frames.at) return;
	const reused = frames.before;
	clear(reused);
	frames.before = frames.counts;
	frames.beforeAt = frames.at;
	frames.counts = reused;
	frames.at = at;
}

/** The churn of the frame at `at`, once the next frame has begun; the latest frame's so far. */
export function frameChurn(at: number): ChurnCounts | undefined {
	if (at === frames.at) return { ...frames.counts };
	if (at === frames.beforeAt) return { ...frames.before };
	return undefined;
}

/** Forget every frame (the probe turned off or on). */
export function resetChurn(): void {
	frames.at = Number.NaN;
	frames.beforeAt = Number.NaN;
	clear(frames.counts);
	clear(frames.before);
}

const built = (object: object): void => {
	const counts = frames.counts;
	counts[CREATED[churnKind(object)]]++;
	counts.created++;
};

const thrown = (object: object): void => {
	const counts = frames.counts;
	counts[DESTROYED[churnKind(object)]]++;
	counts.destroyed++;
};

type Destroy = (this: Container, options?: DestroyOptions) => void;
let nativeDestroy: Destroy | undefined;
let countingDestroy: Destroy | undefined;
let countingUid = false;

/**
 * Count every display object built and destroyed while `on`. Returns whether building is counted:
 * not where `Container.prototype` already has a `uid` of its own (a Pixi that no longer builds
 * `uid` the way 8.22 does), which leaves the prototype as it is.
 */
export function trackDisplayObjects(on: boolean): boolean {
	const proto = Container.prototype as unknown as { uid?: number; destroy: Destroy };
	if (on) {
		if (!nativeDestroy) {
			const native = proto.destroy;
			nativeDestroy = native;
			countingDestroy = function (this: Container, options?: DestroyOptions) {
				if (!this.destroyed) thrown(this);
				native.call(this, options);
			};
			proto.destroy = countingDestroy;
		}
		if (!countingUid && !Object.getOwnPropertyDescriptor(proto, 'uid')) {
			Object.defineProperty(proto, 'uid', {
				configurable: true,
				set(this: Container, value: number) {
					Object.defineProperty(this, 'uid', {
						value,
						writable: true,
						enumerable: true,
						configurable: true,
					});
					built(this);
				},
			});
			countingUid = true;
		}
		return countingUid;
	}
	if (nativeDestroy) {
		if (proto.destroy === countingDestroy) proto.destroy = nativeDestroy;
		nativeDestroy = undefined;
		countingDestroy = undefined;
	}
	if (countingUid) {
		delete proto.uid;
		countingUid = false;
	}
	return false;
}

type AnyMethod = (...args: unknown[]) => unknown;

/** Replace `owner[name]` with `wrap(it)` on the instance; returns the undo. */
function wrapOwn(owner: object, name: string, wrap: (fn: AnyMethod) => AnyMethod): () => void {
	const target = owner as Record<string, unknown>;
	const fn = target[name];
	if (typeof fn !== 'function') return () => {};
	const own = Object.getOwnPropertyDescriptor(owner, name);
	const wrapped = wrap(fn as AnyMethod);
	target[name] = wrapped;
	return () => {
		if (target[name] !== wrapped) return;
		if (own) Object.defineProperty(owner, name, own);
		else delete target[name];
	};
}

/** Count (and time) every text texture `renderer` draws; returns the undo. */
export function probeTextRenders(renderer: Renderer): () => void {
	const systems = renderer as unknown as { canvasText?: object; htmlText?: object };
	const undo: (() => void)[] = [];
	if (systems.canvasText)
		undo.push(
			wrapOwn(
				systems.canvasText,
				'getTexture',
				(fn) =>
					function (this: unknown, ...args: unknown[]) {
						const start = performance.now();
						try {
							return fn.apply(this, args);
						} finally {
							const counts = frames.counts;
							counts.textRenders++;
							counts.textMs += performance.now() - start;
						}
					},
			),
		);
	if (systems.htmlText)
		undo.push(
			wrapOwn(
				systems.htmlText,
				'_buildTexturePromise',
				(fn) =>
					function (this: unknown, ...args: unknown[]) {
						frames.counts.textRenders++;
						return fn.apply(this, args);
					},
			),
		);
	return () => {
		for (const u of undo) u();
	};
}

/** Count the nodes inserted into and removed from `host` and everything under it; the undo. */
export function observeDomChurn(host: Node): () => void {
	const observer = new MutationObserver((records) => {
		const counts = frames.counts;
		for (const record of records) {
			counts.domAdded += record.addedNodes.length;
			counts.domRemoved += record.removedNodes.length;
		}
	});
	observer.observe(host, { childList: true, subtree: true });
	return () => observer.disconnect();
}
