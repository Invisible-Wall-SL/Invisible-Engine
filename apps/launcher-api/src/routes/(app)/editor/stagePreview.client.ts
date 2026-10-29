import { findElementFxSpec, type ElementFxEntry } from 'constants-shared/elementFx';
import type { ScreenTransitionSpec } from 'constants-shared/screenTransition';
import {
	bindStagePostFx,
	elementFxHostFor,
	playElementFx,
	type ElementFxHandle,
} from 'pixi-svelte/elementFx';
import {
	disposeScreenTransitions,
	playScreenTransition,
	setStageFxAntialias,
	type ScreenTransitionHandle,
	type StageApp,
} from 'pixi-svelte/screenFx';
import { Rectangle, Sprite, Texture, Ticker, UPDATE_PRIORITY } from 'pixi.js';
import { OVERLAY_ATTR, type StageRect } from './elementFxPreview.client.svelte';
import { createPixiSurface, sharedPixiRenderer, type PixiSurface } from './sharedGl.client';

/**
 * ▶ ON THE STAGE (Shader Graph 8e, `shader-graph-screens.md` §9.2): a post FX entry or the
 * `transition` cue's row played over the whole stage the editor shows, through the game's own
 * runtime. The stage is 2D canvases and overlays, not one Pixi app, so the preview is a still of
 * every screen shown on a Pixi surface laid over the frame, drawn through the editor's shared
 * renderer (`sharedGl.client.ts`, never a context of its own) and driven as a stage app
 * (`StageApp`): the surface's root, the frame as its viewport, a ticker of its own. A post FX
 * plays in stage mode on that root (`playElementFx`, its filters in the stage filter owner's post
 * FX slot, held to the stage's refusals and caps); a transition plays through
 * `playScreenTransition`, which freezes the still it shows and then reveals what the stage draws
 * next. A live still is copied from the stage every frame, so what plays on the screens keeps
 * moving under the effect. One surface per preview, gone when it ends.
 */

/** How long the last frame stays up after the effect has played out. */
const HOLD_MS = 350;
/** An `always` entry loops for this many plays. */
const ALWAYS_PLAYS = 2;
/** At most this many plays of a counted entry ("until stopped" included). */
const MAX_PLAYS = 3;
/** Where the transition's still sits on the preview's stage: above the screen it shows. */
const TRANSITION_Z = 1;

export interface StageOverlay {
	/** Where the overlay goes (the stage), and its stacking order there. */
	mount: HTMLElement;
	zIndex: number;
	/** Where the frame sits on the stage, CSS px. */
	rect: StageRect;
	/** The stage as shown, cut once (`captureStill`). */
	still: HTMLCanvasElement;
	/** Read every frame, before the effect steps: draw `still` again from the stage as it is now.
	 *  False leaves it as it was. */
	refresh: () => boolean;
	/** Read every frame: true once the stage moved under the overlay (pan, zoom, layout). */
	stale: () => boolean;
	/** The overlay is up: hide what it stands in for. */
	onShown: () => void;
	/** Played out (after {@link HOLD_MS}), went stale, or could not start. Not called after the
	 *  returned stop. */
	onEnd: () => void;
	/** The project's "Anti-aliasing under stage effects" (§16.10). */
	antialias: boolean;
}

export interface StagePostFx extends StageOverlay {
	entry: ElementFxEntry;
}

export interface StageTransition extends StageOverlay {
	spec: ScreenTransitionSpec;
	/** Called once the old screen is frozen: show what the transition reveals. */
	onCaptured: () => void;
}

interface OpenStage {
	app: StageApp;
	/** Draw the surface now. */
	render: () => void;
	/** Upload the still again after it was drawn over in place. */
	redrawn: () => void;
	close: () => void;
}

/** A stage app over `host` showing `still`, its ticker drawing the surface; null when the shared
 *  renderer will not come up. */
async function openStage(options: StageOverlay, host: HTMLElement): Promise<OpenStage | null> {
	const { rect, still } = options;
	const surface: PixiSurface = createPixiSurface(host, window.devicePixelRatio || 1);
	const renderer = (await surface.ready) ? sharedPixiRenderer() : null;
	if (!renderer) {
		surface.destroy();
		return null;
	}
	const texture = Texture.from(still, true);
	const sprite = new Sprite(texture);
	sprite.setSize(rect.w, rect.h);
	surface.stage.addChild(sprite);
	const ticker = new Ticker();
	const app: StageApp = {
		stage: surface.stage,
		screen: new Rectangle(0, 0, rect.w, rect.h),
		ticker,
		renderer,
	};
	setStageFxAntialias(app, options.antialias);
	// After the stage's own pre-render work (the filter owner's, a transition's capture).
	ticker.add(() => surface.render(), undefined, UPDATE_PRIORITY.LOW);
	return {
		app,
		render: () => surface.render(),
		redrawn: () => texture.source.update(),
		close: () => {
			disposeScreenTransitions(app);
			ticker.destroy();
			surface.destroy();
			texture.destroy(true);
		},
	};
}

/**
 * Run `play` on a stage overlay; the returned function tears it down at once. `play` starts the
 * effect on the open stage and returns its handle's end and when it is done.
 */
function runOnStage(
	options: StageOverlay,
	play: (stage: OpenStage) => { done: Promise<void>; stop: () => void; looping: number } | null,
): () => void {
	const { rect } = options;
	const host = document.createElement('div');
	host.setAttribute(OVERLAY_ATTR, '');
	host.style.cssText = `position:absolute;left:${rect.x}px;top:${rect.y}px;width:${rect.w}px;height:${rect.h}px;pointer-events:none;z-index:${options.zIndex}`;
	options.mount.appendChild(host);
	let opened: OpenStage | null = null;
	let effect: { stop: () => void } | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let over = false;

	const stop = (): void => {
		if (over) return;
		over = true;
		clearTimeout(timer);
		effect?.stop();
		opened?.close();
		host.remove();
	};
	// Deferred: it can be asked from inside a tick, and the app must not be destroyed mid-update.
	const end = (afterMs = 0): void => {
		if (over || timer !== undefined) return;
		timer = setTimeout(() => {
			if (over) return;
			stop();
			options.onEnd();
		}, afterMs);
	};

	void openStage(options, host).then((stage) => {
		if (over) {
			stage?.close();
			return;
		}
		if (!stage) return end();
		opened = stage;
		const { app, render, redrawn } = stage;
		// Before the effect's step and the stage filter owner's: the still as the stage is now.
		app.ticker.add(
			() => {
				if (over) return;
				try {
					if (options.refresh()) redrawn();
				} catch {
					end();
				}
			},
			undefined,
			UPDATE_PRIORITY.HIGH,
		);
		const started = play(stage);
		if (!started) return end();
		effect = started;
		let elapsedMs = 0;
		void started.done.then(() => end(HOLD_MS));
		app.ticker.add(
			() => {
				if (over) return;
				elapsedMs += app.ticker.deltaMS;
				if (options.stale() || (started.looping > 0 && elapsedMs >= started.looping)) end();
			},
			undefined,
			UPDATE_PRIORITY.LOW,
		);
		render();
		options.onShown();
		app.ticker.start();
	});
	return stop;
}

/**
 * Play post FX `entry` on the stage overlay through the stage mode, as the game plays
 * `settings.postFx`; the returned function tears it down. An `always` entry loops
 * {@link ALWAYS_PLAYS} times; a cue entry plays as its cue would start it.
 */
export function playPostFxOnStage(options: StagePostFx): () => void {
	const { entry } = options;
	return runOnStage(options, ({ app }) => {
		const spec = findElementFxSpec(entry.kind);
		const host = elementFxHostFor(app);
		if (!spec || !host) return null;
		const unbind = bindStagePostFx(app);
		const looping = entry.trigger === 'always';
		const handle: ElementFxHandle = playElementFx(
			app.stage,
			{
				kind: entry.kind,
				durationMs: entry.durationMs,
				delayMs: entry.delayMs,
				intensity: entry.intensity,
				params: entry.params,
				repeat: looping ? 0 : Math.min(entry.repeat ?? 1, MAX_PLAYS) || MAX_PLAYS,
			},
			host,
		);
		return {
			done: looping ? new Promise<void>(() => {}) : handle.done,
			stop: () => {
				handle.stop();
				unbind();
			},
			looping: looping
				? (entry.delayMs ?? 0) + ALWAYS_PLAYS * (entry.durationMs ?? spec.durationMs)
				: 0,
		};
	});
}

/**
 * Play the transition `spec` on the stage overlay through `playScreenTransition`, as the game plays
 * the `transition` cue's row: the still shown now is frozen, `onCaptured` shows what comes next,
 * and the transition reveals it. The returned function tears it down.
 */
export function playTransitionOnStage(options: StageTransition): () => void {
	const { spec } = options;
	return runOnStage(options, ({ app }) => {
		const host = elementFxHostFor(app);
		if (!host) return null;
		const handle: ScreenTransitionHandle = playScreenTransition(
			app,
			{
				kind: spec.kind,
				durationMs: spec.durationMs,
				intensity: spec.intensity,
				params: spec.params,
				zIndex: TRANSITION_Z,
			},
			host,
		);
		// `captured` settles also when the transition is ended before its still is taken: a preview
		// stopped by then must not show what it would have revealed.
		let stopped = false;
		void handle.captured.then(() => {
			if (!stopped) options.onCaptured();
		});
		return {
			done: handle.done,
			stop: () => {
				stopped = true;
				handle.end();
			},
			looping: 0,
		};
	});
}
