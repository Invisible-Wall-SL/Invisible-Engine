import { findElementFxSpec, type ElementFxEntry } from 'constants-shared/elementFx';
import type { ScreenTransitionSpec } from 'constants-shared/screenTransition';
import { playElementFx, type ElementFxHandle, type ElementFxPose } from 'pixi-svelte/elementFx';
import { Container, Matrix, Rectangle, Sprite, Texture, Ticker, UPDATE_PRIORITY } from 'pixi.js';
import { createPixiSurface, sharedPixiRenderer } from './sharedGl.client';

/**
 * The ELEMENT FX PREVIEW: the ▶ on an Element FX row (Properties, and the Screen block) plays that
 * one effect on the stage. The stage is not a Pixi scene per node — it is 2D canvases plus overlays
 * drawn through the shared contexts (`sharedGl.client.ts`) — so the preview is a capture and an
 * overlay: the canvas shows the element alone for a few frames (under a frozen copy of the stage,
 * {@link coverStage}), copies what its screen's surfaces drew into a still, hides the element, and
 * plays the effect on the still in a Pixi overlay through the runtime the game uses
 * (`pixi-svelte/elementFx`). A screen's still is LIVE: its surfaces keep drawing, hidden, and are
 * copied into the still every frame, so a timeline playing on the screen keeps moving under the
 * effect. A node's still follows the node's drawn pose (the timeline moving, scaling or turning it),
 * but what it shows holds still: a playing rig freezes for the preview, while the game plays the
 * effect on the live element.
 *
 * A timeline previewing a `keyed` entry (scrubbed, played, or a state machine's stage preview) POSES
 * it the same way ({@link poseOnStill}): a still per posed node, cut again only once its art or a
 * view that cropped or blurred it has settled, an overlay that follows the node's drawn pose, and the
 * real node hidden only while the effect is past its rest.
 *
 * Every mounted `EditorCanvas` (the Screens side and the Components side) adds a handler; the first
 * whose stage is showing and holds the target plays it. One preview at a time; never saved. The
 * Screen FX block's ▶ plays on the whole stage the same way (`{ kind: 'stage' }` for a post FX,
 * {@link playScreenTransitionPreview} for the `transition` cue's row), through the game's runtime
 * on a Pixi app of its own (`stagePreview.client.ts`).
 */

/** What ▶ plays on: a node, a screen, or the whole stage (a post FX, `stagePreview.client.ts`). */
export type ElementFxPreviewTarget =
	| { kind: 'node'; id: string }
	| { kind: 'screen'; sceneId: string }
	| { kind: 'stage'; antialias?: boolean };

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

/** What the `transition` cue's ▶ asks for: the row, and how to show the screen it plays into. */
export interface ScreenTransitionPreview {
	spec: ScreenTransitionSpec;
	/** Show (`true`) or take back (`false`) the screen the transition reveals; unset ⇒ it reveals
	 *  the stage as it is. */
	reveal?: (on: boolean) => void;
	/** The project's "Anti-aliasing under stage effects". */
	antialias?: boolean;
}

/** A canvas's preview of a transition: as {@link ElementFxPreviewHandler}. */
export type ScreenTransitionPreviewHandler = (
	preview: ScreenTransitionPreview,
	finished: () => void,
) => (() => void) | null;

const handlers: ElementFxPreviewHandler[] = [];
const transitionHandlers: ScreenTransitionPreviewHandler[] = [];
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
function stopElementFxPreview(): void {
	const run = current;
	current = null;
	run?.cancel();
}

/** Start a preview through the first handler that takes it, replacing any preview playing. */
function startPreview(
	attempts: readonly ((finished: () => void) => (() => void) | null)[],
): boolean {
	stopElementFxPreview();
	for (let i = attempts.length - 1; i >= 0; i--) {
		const run = { cancel: () => {} };
		const cancel = attempts[i](() => {
			if (current === run) current = null;
		});
		if (!cancel) continue;
		run.cancel = cancel;
		current = run;
		return true;
	}
	return false;
}

/**
 * Play `entry` on `target` on the stage, replacing any preview playing. False when no stage shows
 * the target: its screen is hidden, or it or a container above it is.
 */
export const playElementFxPreview = (
	target: ElementFxPreviewTarget,
	entry: ElementFxEntry,
): boolean => startPreview(handlers.map((handler) => (done) => handler(target, entry, done)));

/** Offer a canvas's transition handler; the returned function withdraws it. */
export function addScreenTransitionPreviewHandler(
	handler: ScreenTransitionPreviewHandler,
): () => void {
	transitionHandlers.push(handler);
	return () => {
		const index = transitionHandlers.indexOf(handler);
		if (index >= 0) transitionHandlers.splice(index, 1);
	};
}

/**
 * Play the `transition` cue's row on the stage, replacing any preview playing: the stage as it is
 * now is frozen, the screen `reveal` shows comes in under it, and the transition plays between
 * them. False when no stage is showing.
 */
export const playScreenTransitionPreview = (preview: ScreenTransitionPreview): boolean =>
	startPreview(transitionHandlers.map((handler) => (done) => handler(preview, done)));

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
	/** How it lays over what is under it (its CSS opacity and blend mode); unset ⇒ as drawn. */
	alpha?: number;
	blend?: GlobalCompositeOperation;
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

/** `rect` of every source, bottom first, copied over the whole of `still` (cleared first). */
export function drawStill(
	still: HTMLCanvasElement,
	sources: readonly StillSource[],
	rect: StageRect,
): boolean {
	const ctx = still.getContext('2d');
	if (!ctx) return false;
	ctx.clearRect(0, 0, still.width, still.height);
	for (const s of sources) {
		ctx.globalAlpha = s.alpha ?? 1;
		ctx.globalCompositeOperation = s.blend ?? 'source-over';
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
	ctx.globalAlpha = 1;
	ctx.globalCompositeOperation = 'source-over';
	return true;
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
	if (!drawStill(still, sources, rect)) return null;
	try {
		still.getContext('2d')?.getImageData(0, 0, 1, 1);
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
export const OVERLAY_ATTR = 'data-element-fx-overlay';

/** Whether `canvas` is an Element FX overlay's, not a stage surface. */
export function isFxOverlayCanvas(canvas: Element): boolean {
	return canvas.closest(`[${OVERLAY_ATTR}]`) !== null;
}

/** CSS `mix-blend-mode`s the 2D context names differently; the rest share their names. */
const COMPOSITE: Record<string, GlobalCompositeOperation> = {
	normal: 'source-over',
	'plus-lighter': 'lighter',
};

/** How `canvas` lays over the stage under it: its opacity and blend mode, or null when it does
 *  not show (no display, hidden, or fully transparent). */
export function layerLook(
	canvas: HTMLCanvasElement,
): { alpha: number; blend: GlobalCompositeOperation } | null {
	const style = getComputedStyle(canvas);
	const alpha = Number.parseFloat(style.opacity);
	if (style.display === 'none' || style.visibility === 'hidden' || alpha === 0) return null;
	return {
		alpha: Number.isFinite(alpha) ? alpha : 1,
		blend: COMPOSITE[style.mixBlendMode] ?? (style.mixBlendMode as GlobalCompositeOperation),
	};
}

/** Where `el` paints in `stage`: the z-index of the nearest element (itself included) under the
 *  stage that sets one, else 0. DOM order breaks ties. */
export function stackZ(el: Element, stage: HTMLElement): number {
	for (let at: Element | null = el; at && at !== stage; at = at.parentElement) {
		const z = Number.parseInt(getComputedStyle(at).zIndex, 10);
		if (Number.isFinite(z)) return z;
	}
	return 0;
}

/**
 * Freeze what `stage` shows: a copy of every canvas on it (the overlays included, each with its
 * blend mode and opacity), above them at `zIndex`, so the frames a still is cut in — the rest of its
 * screen hidden — never reach the author. The returned function lifts it.
 */
export function coverStage(stage: HTMLElement, zIndex: number): () => void {
	const box = stage.getBoundingClientRect();
	const width = stage.clientWidth;
	const height = stage.clientHeight;
	if (width === 0 || height === 0) return () => {};
	const origin = new DOMRect(box.left + stage.clientLeft, box.top + stage.clientTop, width, height);
	const resolution = window.devicePixelRatio || 1;
	const cover = document.createElement('canvas');
	cover.width = Math.round(width * resolution);
	cover.height = Math.round(height * resolution);
	const ctx = cover.getContext('2d');
	if (!ctx) return () => {};
	const layers = [...stage.querySelectorAll('canvas')]
		.map((canvas, order) => ({ canvas, order, z: stackZ(canvas, stage) }))
		.sort((a, b) => a.z - b.z || a.order - b.order);
	for (const { canvas } of layers) {
		const look = layerLook(canvas);
		const at = stageSource(canvas, origin);
		if (!at || !look) continue;
		ctx.globalAlpha = look.alpha;
		ctx.globalCompositeOperation = look.blend;
		ctx.drawImage(
			canvas,
			at.x * resolution,
			at.y * resolution,
			(canvas.width / at.scaleX) * resolution,
			(canvas.height / at.scaleY) * resolution,
		);
	}
	cover.setAttribute(OVERLAY_ATTR, '');
	cover.style.cssText = `position:absolute;left:0;top:0;width:${width}px;height:${height}px;pointer-events:none;z-index:${zIndex}`;
	stage.appendChild(cover);
	return () => cover.remove();
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
	/** The container holding the still, once the shared renderer is up; null if it never comes.
	 *  `redrawn` uploads the still again after it was drawn over in place. */
	ready: Promise<{
		target: Container;
		ticker: Ticker;
		render: () => void;
		redrawn: () => void;
	} | null>;
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
		const uploaded = texture;
		return {
			target,
			ticker,
			render: () => surface.render(),
			redrawn: () => uploaded.source.update(),
		};
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
	/** Read every frame, before the effect steps: draw the still again from the stage as it is now
	 *  (a screen whose surfaces keep drawing under the overlay). False leaves it as it was. */
	refresh?: () => boolean;
	/** Read every frame: the still's transform on the stage now, so it follows a node the previewed
	 *  timeline moves, scales or turns. */
	placement?: () => readonly [number, number, number, number, number, number];
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
		const spec = findElementFxSpec(entry.kind);
		if (!parts || !spec) return end();
		const { target, ticker, render, redrawn } = parts;
		const { refresh, placement } = options;
		const matrix = new Matrix();
		// Ahead of the effect's own step, which takes what is written here as the still's rest. A copy
		// that can no longer be uploaded (a cross-origin image reached a surface) ends the preview.
		if (refresh || placement) {
			ticker.add(
				() => {
					if (over) return;
					if (placement) target.setFromMatrix(matrix.set(...placement()));
					try {
						if (refresh?.()) redrawn();
					} catch {
						end();
					}
				},
				undefined,
				UPDATE_PRIORITY.HIGH,
			);
		}
		const looping = entry.trigger === 'always';
		const keyed = entry.trigger === 'keyed';
		const loopMs = (entry.delayMs ?? 0) + ALWAYS_PLAYS * (entry.durationMs ?? spec.durationMs);
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

/** A still posing a node's keyed entries. */
export interface PosedOverlay {
	/** Pose these entries instead (the node's Element FX were edited), on the same still. */
	setEntries(entries: readonly ElementFxEntry[]): void;
	stop(): void;
}

/**
 * POSE a node's keyed entries on a still while a timeline previews, the way `<LayoutNodeView>` poses
 * them in game (`playElementFx` with `pose`): no clock, each frame where the timeline puts it. At
 * rest the overlay draws nothing (the real node shows); it draws only when what it shows changed.
 */
export function poseOnStill(options: PosedStill): PosedOverlay {
	const { pose } = options;
	let entries = options.entries;
	const overlay = openStill(options);
	let handles: ElementFxHandle[] = [];
	let over = false;
	/** (Re)starts the entries' effects on the still, once the overlay is up. */
	let start: (() => void) | null = null;
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
		const host = { ticker, renderer: sharedPixiRenderer() ?? undefined };
		start = (): void => {
			for (const handle of handles) handle.stop();
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
					host,
				),
			);
			dirty = true;
		};
		start();
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
	return {
		setEntries(next): void {
			entries = next;
			start?.();
		},
		stop(): void {
			if (over) return;
			over = true;
			for (const handle of handles) handle.stop();
			overlay.close();
		},
	};
}
