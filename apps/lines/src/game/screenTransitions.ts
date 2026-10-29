/**
 * Screen transitions in the game (Invisible Shader Graph step 8e.4,
 * `docs/design/shader-graph-screens.md` §6.2, §8, §9): the Flow's `screenTransition` and
 * `waitForScreenTransition`, and what the awaited `transition` cue plays.
 *
 * Everything here goes through {@link ScreenTransitionsApi}, which the game binds to the transition
 * runtime. Until one is bound the game behaves as a runtime before 8e (§12): `screenTransition` is
 * a cut that resolves at once, `waitForScreenTransition` resolves at once, and the `transition` cue
 * plays the wipe. Svelte-free, so a flow-spike harness drives exactly what the game runs.
 */

import type { TransitionCueStatus } from 'engine-layout';
import type { ElementFxParamValue } from 'constants-shared/elementFx';
import { readScreenTransition, type ScreenTransitionSpec } from 'constants-shared/screenTransition';
import { roundSkip } from 'utils-shared/skipToken';

/** One transition the game asks the runtime to play. */
export interface ScreenTransitionPlay extends ScreenTransitionSpec {
	/** Screens → Reverse reads 1. */
	reverse?: boolean;
}

export interface ScreenTransitionHandle {
	/** Resolves once the old screen is frozen (the next frame): the screen may change under it. */
	captured: Promise<void>;
	/** Resolves when it has played out, or was ended by another transition, a slam, a resize or
	 *  teardown. */
	done: Promise<void>;
}

/** The transition runtime as the game reaches it. */
export interface ScreenTransitionsApi {
	/** Ends any transition playing at its end state, then starts this one. */
	play(transition: ScreenTransitionPlay): ScreenTransitionHandle;
	/** Resolves when no transition is playing; at once when none is. */
	wait(): Promise<void>;
	/** Ends the playing transition now, at its end state; nothing when none is playing. */
	skip(): void;
}

let api: ScreenTransitionsApi | null = null;

// A slam (the player's stop press trips `roundSkip`) cuts a playing transition to the new screen.
roundSkip.onSkip(() => api?.skip());

/** Bind the runtime (or unbind it with `null`). Returns the unbind, which leaves a later binding
 *  in place. */
export function bindScreenTransitions(next: ScreenTransitionsApi | null): () => void {
	api = next;
	return () => {
		if (api === next) api = null;
	};
}

const fxdebug = (): boolean =>
	typeof location !== 'undefined' && new URLSearchParams(location.search).has('fxdebug');

let warnedUnbound = false;
const warnUnbound = (): void => {
	if (warnedUnbound || !fxdebug()) return;
	warnedUnbound = true;
	console.warn(
		'[fxdebug] screenTransition: no transition runtime bound (not bound yet, or torn down), played as a cut',
	);
};

/** A `screenTransition` node's payload as a play, or `undefined` when it names no transition kind. */
export function readScreenTransitionPayload(
	payload: Record<string, unknown>,
): ScreenTransitionPlay | undefined {
	const params: Record<string, ElementFxParamValue> | undefined =
		typeof payload.color === 'string' ? { color: payload.color } : undefined;
	const spec = readScreenTransition({
		kind: payload.kind,
		durationMs: payload.durationMs,
		intensity: payload.intensity,
		params,
	});
	if (!spec) return undefined;
	return payload.reverse === true ? { ...spec, reverse: true } : spec;
}

/**
 * `screenTransition`: freeze the screen and go on once it is captured, so the next nodes change the
 * screen under the transition; `blocking` holds until it has played out instead.
 */
export function screenTransitionEffect(
	payload: Record<string, unknown>,
): Promise<void> | undefined {
	if (!api) {
		warnUnbound();
		return undefined;
	}
	const transition = readScreenTransitionPayload(payload);
	if (!transition) return undefined;
	const handle = api.play(transition);
	return payload.blocking === true ? handle.done : handle.captured;
}

/** `waitForScreenTransition`: hold until no transition is playing. */
export function waitForScreenTransitionEffect(): Promise<void> | undefined {
	return api?.wait();
}

/**
 * The `transition` cue's status as this boot plays it: the shared rule's, read only with a runtime
 * bound. Without one the row is ignored, as a runtime before 8e ignores it, so the wipe plays.
 */
export function bootTransitionCueStatus(status: () => TransitionCueStatus): TransitionCueStatus {
	return api ? status() : 'off';
}

/**
 * The awaited `transition` cue while it plays a screen transition (`status` is `screen`): its
 * handler starts the row's transition and resolves once the old screen is captured, so the nodes
 * after the cue change the screen under it. Any other status subscribes nothing, so the wipe holds
 * the cue exactly as before. Returns the unsubscribe.
 */
export function subscribeTransitionCue(
	status: TransitionCueStatus,
	cue: ScreenTransitionSpec | undefined,
	subscribe: (handler: () => Promise<void>) => () => void,
): () => void {
	if (status !== 'screen' || !cue) return () => {};
	return subscribe(async () => {
		await api?.play(cue).captured;
	});
}
