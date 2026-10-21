import { elementFxSpec, type ElementFxEntry } from 'constants-shared/elementFx';
import { playElementFx, type ElementFxHandle, type ElementFxPose } from 'pixi-svelte/elementFx';
import { Container, Matrix, Rectangle, Sprite, Texture, Ticker, UPDATE_PRIORITY } from 'pixi.js';
import { createPixiSurface, sharedPixiRenderer } from './sharedGl.client';

/**
 * The ELEMENT FX PREVIEW: the ▶ on an Element FX row (Properties, and the Screen block) plays that
 * one effect on the stage. The stage is not a Pixi scene per node — it is 2D canvases plus overlays
 * drawn through the shared contexts (`sharedGl.client.ts`) — so the preview is a capture and an
 * overlay: the canvas shows the element alone for a few frames, copies what its screen's surfaces
 * drew into a still, hides the element, and plays the effect on the still in a Pixi overlay through
 * the runtime the game uses (`pixi-svelte/elementFx`). A playing rig freezes for the preview; the
 * game plays the effect on the live element.
 *
 * A timeline previewing a `keyed` entry (scrubbed, played, or a state machine's stage preview) POSES
 * it the same way ({@link poseOnStill}): one still per posed node per preview, an overlay that
 * follows the node's drawn pose, and the real node hidden only while the effect is past its rest.
 *
 * Every mounted `EditorCanvas` (the Screens side and the Components side) adds a handler; the first
 * whose stage is showing and holds the target plays it. One preview at a time; never saved.
 */

export type ElementFxPreviewTarget =
	{ kind: 'node'; id: string } | { kind: 'screen'; sceneId: string };

/**
 * A canvas's preview of `entry` on `target`: the function that cancels it, or null when the target
 * is not on its stage. `finished` is called once the preview has ended, however it ended — never
 * before the handler returns.
 */
export type ElementFxPreviewHandler = (
	target: ElementFxPreviewTarget,
	entry: ElementFxEntry,
	finished: () => void,
) => (() => void) | null;

const handlers: ElementFxPreviewHandler[] = [];
let current: { cancel: () => void } | null = null;

/** Offer a canvas's handler; the returned function withdraws it (call it on unmount). */
export function addElementFxPreviewHandler(handler: ElementFxPreviewHandler): () => void {
	handlers.push(handler);
	return () => {
		const index = handlers.indexOf(handler);
		if (index >= 0) handlers.splice(index, 1);
	};
}

/** End the preview playing, if any: the element shows again at once. */
export function stopElementFxPreview(): void {
	const run = current;
	current = null;
	run?.cancel();
}

/**
 * Play `entry` on `target` on the stage, replacing any preview playing. False when no stage shows
 * the target: its screen is hidden, or it or a container above it is.
 */
export function playElementFxPreview(
	target: ElementFxPreviewTarget,
	entry: ElementFxEntry,
): boolean {
	stopElementFxPreview();
	for (let i = handlers.length - 1; i >= 0; i--) {
		const run = { cancel: () => {} };
		const cancel = handlers[i](target, entry, () => {
			if (current === run) current = null;
		});
		if (!cancel) continue;
		run.cancel = cancel;
		current = run;
		return true;
	}
	return false;
}

/** Settles after `count` animation frames: what the stage's layers take to redraw a change. */
export function afterFrames(count: number): Promise<void> {
	return new Promise((resolve) => {
		const next = (left: number): void => {
			if (left <= 0) resolve();
			else requestAnimationFrame(() => next(left - 1));
		};
		next(count);
	});
}

/** A rectangle on the stage, in CSS px from its top-left. */
export interface StageRect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** The part of `a` inside `b`, or null when they do not overlap. */
export function intersectRect(a: StageRect, b: StageRect): StageRect | null {
	const x = Math.max(a.x, b.x);
	const y = Math.max(a.y, b.y);
	const w = Math.min(a.x + a.w, b.x + b.w) - x;
	const h = Math.min(a.y + a.h, b.y + b.h) - y;
	return w >= 1 && h >= 1 ? { x, y, w, h } : null;
}

/** One stage surface a still is copied from. */
export interface StillSource {
	canvas: HTMLCanvasElement;
	/** Its top-left on the stage, CSS px. */
	x: number;
	y: number;
	/** Backing-store pixels per CSS px. */
	scaleX: number;
	scaleY: number;
}

/** `canvas` as laid out on the stage whose top-left is `origin`; null while it has no size. */
export function stageSource(canvas: HTMLCanvasElement, origin: DOMRect): StillSource | null {
	const box = canvas.getBoundingClientRect();
	if (box.width === 0 || box.height === 0) return null;
	return {
		canvas,
		x: box.left - origin.left,
		y: box.top - origin.top,
		scaleX: canvas.width / box.width,
		scaleY: canvas.height / box.height,
	};
}

/**
 * `rect` of every source, bottom first, copied into one canvas at `resolution` px per CSS px. Null
 * when the copy cannot be read back — a cross-origin image tainted a surface, and the overlay could
 * not upload it.
 */
export function captureStill(
	sources: readonly StillSource[],
	rect: StageRect,
	resolution: number,
): HTMLCanvasElement | null {
	const still = document.createElement('canvas');
	still.width = Math.max(1, Math.round(rect.w * resolution));
	still.height = Math.max(1, Math.round(rect.h * resolution));
	const ctx = still.getContext('2d');
	if (!ctx) return null;
	for (const s of sources) {
		ctx.drawImage(
			s.canvas,
			(rect.x - s.x) * s.scaleX,
			(rect.y - s.y) * s.scaleY,
			rect.w * s.scaleX,
			rect.h * s.scaleY,
			0,
			0,
			still.width,
			still.height,
		);
	}
	try {
		ctx.getImageData(0, 0, 1, 1);
	} catch {
		return null;
	}
	return still;
}

/** How long the last frame stays up after the effect has played out (an exit kind's hidden end). */
const HOLD_MS = 350;
/** An `always` entry loops for this many plays. */
const ALWAYS_PLAYS = 2;
/** At most this many plays of a counted entry ("until stopped" included). */
const MAX_PLAYS = 3;
/** Marks an overlay's host: a still never copies another preview's overlay. */
const OVERLAY_ATTR = 'data-element-fx-overlay';

/** Whether `canvas` is an Element FX overlay's, not a stage surface. */
export function isFxOverlayCanvas(canvas: Element): boolean {
	return canvas.closest(`[${OVERLAY_ATTR}]`) !== null;
}

/** Where a still goes on the stage. */
export interface StillOverlay {
	/** Where the overlay goes: the target's screen group (it keeps the screen's place in the
	 *  stack), or the stage. */
	mount: HTMLElement;
	/** The overlay's stacking order in `mount`. */
	zIndex?: number;
	still: HTMLCanvasElement;
	/** Where the still sits on the stage. */
	rect: StageRect;
	/** The element's own box inside the still, from its top-left: what the effect measures, turns
	 *  about and breaks. The rest is the margin a glow it draws past its box needs. */
	element: StageRect;
}

interface OpenStill {
	/** The container holding the still, once the shared renderer is up; null if it never comes. */
	ready: Promise<{ target: Container; ticker: Ticker; render: () => void } | null>;
	/** Tear the overlay down. Stop the effects on it first: the ticker they run on goes. */
	close(): void;
}

/** A Pixi overlay through the shared renderer with `still` in one container, its own ticker idle. */
function openStill(options: StillOverlay): OpenStill {
	const { rect, element } = options;
	const host = document.createElement('div');
	host.setAttribute(OVERLAY_ATTR, '');
	host.style.cssText = 'position:absolute;inset:0;pointer-events:none';
	if (options.zIndex !== undefined) host.style.zIndex = String(options.zIndex);
	options.mount.appendChild(host);
	const surface = createPixiSurface(host, window.devicePixelRatio || 1);
	const ticker = new Ticker();
	let texture: Texture | null = null;
	let closed = false;
	const ready = surface.ready.then((ok) => {
		if (!ok || closed) return null;
		texture = Texture.from(options.still, true);
		const sprite = new Sprite(texture);
		sprite.setSize(rect.w, rect.h);
		const target = new Container();
		target.position.set(rect.x, rect.y);
		target.boundsArea = new Rectangle(element.x, element.y, element.w, element.h);
		target.addChild(sprite);
		surface.stage.addChild(target);
		return { target, ticker, render: () => surface.render() };
	});
	return {
		ready,
		close(): void {
			if (closed) return;
			closed = true;
			ticker.destroy();
			surface.destroy();
			texture?.destroy(true);
			host.remove();
		},
	};
}

export interface StillPreview extends StillOverlay {
	entry: ElementFxEntry;
	/** The still is on the stage: hide the real element now. */
	onShown: () => void;
	/** Played out (after {@link HOLD_MS}), went stale, or could not start. Not called after the
	 *  returned stop. */
	onEnd: () => void;
	/** Read every frame: true once the stage moved under the still (pan, zoom, layout). */
	stale: () => boolean;
}

/**
 * Play `entry` on a still in a Pixi overlay; the returned function tears it down at once. A `keyed`
 * entry plays once from rest to its end, as a timeline keying it 0 → 1 would (no delay: a timeline
 * places it).
 */
export function playOnStill(options: StillPreview): () => void {
	const { entry } = options;
	const overlay = openStill(options);
	let handle: ElementFxHandle | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let over = false;

	const stop = (): void => {
		if (over) return;
		over = true;
		clearTimeout(timer);
		handle?.stop();
		overlay.close();
	};
	// Deferred: it can be asked from inside a tick, and the ticker must not be destroyed mid-update.
	const end = (afterMs = 0): void => {
		if (over || timer !== undefined) return;
		timer = setTimeout(() => {
			if (over) return;
			stop();
			options.onEnd();
		}, afterMs);
	};

	void overlay.ready.then((parts) => {
		if (over) return;
		if (!parts) return end();
		const { target, ticker, render } = parts;
		const looping = entry.trigger === 'always';
		const keyed = entry.trigger === 'keyed';
		const loopMs =
			(entry.delayMs ?? 0) +
			ALWAYS_PLAYS * (entry.durationMs ?? elementFxSpec(entry.kind).durationMs);
		let elapsedMs = 0;
		handle = playElementFx(
			target,
			{
				kind: entry.kind,
				durationMs: entry.durationMs,
				delayMs: keyed ? 0 : entry.delayMs,
				intensity: entry.intensity,
				params: entry.params,
				repeat: looping ? 0 : keyed ? 1 : Math.min(entry.repeat ?? 1, MAX_PLAYS) || MAX_PLAYS,
			},
			{ ticker, renderer: sharedPixiRenderer() ?? undefined },
		);
		if (!looping) void handle.done.then(() => end(HOLD_MS));
		ticker.add(
			() => {
				if (over) return;
				render();
				elapsedMs += ticker.deltaMS;
				if (options.stale() || (looping && elapsedMs >= loopMs)) end();
			},
			undefined,
			UPDATE_PRIORITY.LOW,
		);
		render();
		options.onShown();
		ticker.start();
	});
	return stop;
}

export interface PosedStill extends StillOverlay {
	/** The node's enabled `keyed` entries. */
	entries: readonly ElementFxEntry[];
	/** Read every frame: where the previewed timeline poses entry `entryId`; undefined ⇒ at rest. */
	pose: (entryId: string) => ElementFxPose | undefined;
	/** Read every frame: the still's transform on the stage now (`[a, b, c, d, tx, ty]`), so it
	 *  follows a node the timeline also moves, scales or turns. */
	placement: () => readonly [number, number, number, number, number, number];
}

/** Some entry is past its rest: the overlay shows the effect, and the real node hides. */
export function posedPastRest(
	entries: readonly ElementFxEntry[],
	pose: (entryId: string) => ElementFxPose | undefined,
): boolean {
	return entries.some((entry) => (pose(entry.id)?.progress ?? 0) > 0);
}

/**
 * POSE a node's keyed entries on a still while a timeline previews, the way `<LayoutNodeView>` poses
 * them in game (`playElementFx` with `pose`): no clock, each frame where the timeline puts it. At
 * rest the overlay draws nothing (the real node shows); it draws only when what it shows changed.
 * The returned function tears it down.
 */
export function poseOnStill(options: PosedStill): () => void {
	const { entries, pose } = options;
	const overlay = openStill(options);
	let handles: ElementFxHandle[] = [];
	let over = false;
	void overlay.ready.then((parts) => {
		if (!parts || over) return;
		const { target, ticker, render } = parts;
		const matrix = new Matrix();
		let placed = '';
		let shownKey = '';
		let dirty = true;
		// Ahead of the effects' own step, which takes what is written here as the still's rest.
		ticker.add(
			() => {
				const placement = options.placement();
				const where = placement.join();
				if (where !== placed) {
					placed = where;
					target.setFromMatrix(matrix.set(...placement));
				}
				target.visible = posedPastRest(entries, pose);
				const now = JSON.stringify([where, entries.map((entry) => pose(entry.id))]);
				if (now !== shownKey) {
					shownKey = now;
					dirty = true;
				}
			},
			undefined,
			UPDATE_PRIORITY.HIGH,
		);
		handles = entries.map((entry) =>
			playElementFx(
				target,
				{
					kind: entry.kind,
					durationMs: entry.durationMs,
					intensity: entry.intensity,
					params: entry.params,
					pose: () => pose(entry.id),
				},
				{ ticker, renderer: sharedPixiRenderer() ?? undefined },
			),
		);
		ticker.add(
			() => {
				if (!dirty) return;
				dirty = false;
				render();
			},
			undefined,
			UPDATE_PRIORITY.LOW,
		);
		ticker.start();
	});
	return () => {
		if (over) return;
		over = true;
		for (const handle of handles) handle.stop();
		overlay.close();
	};
}
