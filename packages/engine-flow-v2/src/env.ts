/**
 * Invisible Flow v2 — the `FlowV2Env` FACTORY (Phase 4b, design doc §10.1).
 *
 * The interpreter (`runFlowEvent`) talks ONLY to an injected `FlowV2Env`; this assembles a
 * concrete one from a game's real primitives + the z-ordered container mount model. It is the
 * single wiring seam between the pure interpreter and a game: a game supplies the same emitter /
 * turbo scalar / `waitForTimeout` / effect registry / `$engine` reader the coded path uses, plus
 * a `ContainerMountModel`, and gets back the env the interpreter drives.
 *
 * Keeping it here (engine-side, pure) means the game-side wiring is trivial + declarative, the
 * show/hide → mount-model plumbing has one home, and the assembly is unit-testable (a harness
 * injects fakes and asserts each node kind reaches the right sink).
 *
 * Parity-safe: an effect name with no registered implementation resolves to a no-op (an
 * un-registered effect cannot break a partially-authored flow — mirrors v1's `effect?` contract).
 */

import type { FlowV2Env } from './runtime';
import type { ContainerMountModel } from './mount';

/** A registered game-side effect/command implementation — receives the interpreter's resolved
 *  payload and may return a promise the interpreter awaits (so an awaited board op blocks the
 *  chain exactly as the coded handler does). */
export type FlowV2Effect = (payload: Record<string, unknown>) => void | Promise<void>;

/** The game primitives a `FlowV2Env` is assembled from — each wired to the SAME thing the coded
 *  path uses, so an authored flow reproduces the coded timing/behaviour. */
export interface FlowV2EnvDeps {
	/** The z-ordered container mount model — `showContainer`/`hideContainer` delegate to it. */
	mount: ContainerMountModel;
	/** Resolve a registered effect/command by name, or `undefined` (⇒ the interpreter no-ops it).
	 *  A game passes its closed effect registry here; the env never implements an effect itself. */
	effect: (name: string) => FlowV2Effect | undefined;
	/** Broadcast a named cue with its resolved payload (the game wires its event emitter). */
	broadcast: (cue: string, payload: Record<string, unknown>) => void | Promise<void>;
	/** `waitForTimeout` — `(ms) => new Promise(r => setTimeout(r, ms))`; the interpreter passes the
	 *  ALREADY turbo-scaled duration (it divides by `timeScale()` before calling). */
	waitForTimeout: (ms: number) => Promise<void>;
	/** The live turbo scalar — `() => isTurbo ? 2 : 1`; a `delay`'s ms is divided by it. */
	timeScale: () => number;
	/** A bounded `$engine.<key>` reader — the same closed key→live-value map a guard/readout uses. */
	engineRead: (key: string) => unknown;
}

/**
 * Assemble a `FlowV2Env` from a game's primitives. `showContainer`/`hideContainer` drive the
 * injected mount model (the passed `z` is ignored — the model resolves it from the flow's declared
 * `containers`, one source of truth); everything else passes straight through to the game surface.
 *
 * ROUND-BLOCK HOLD: `awaitContainerComplete(id)` returns a promise that resolves the next time that
 * container is HIDDEN — which is what a `complete:<id>` edge does (its `hideContainer`, i.e. the
 * tap-to-continue dismissal). So a `showContainer{awaitComplete}` node blocks the exec chain (and
 * the awaiting book pump) until the player taps. The registry lives HERE, in the one env shared
 * across every `runFlowEvent` call, so the hold set on one run (the freeSpinTrigger chain) is
 * released by the hide on a LATER run (the complete dispatch).
 */
export const createFlowV2Env = (deps: FlowV2EnvDeps): FlowV2Env => {
	// containerId → resolvers waiting for its next hide. Cleared + fired when that hide lands.
	const holds = new Map<string, Array<() => void>>();
	const releaseHolds = (containerId: string): void => {
		const pending = holds.get(containerId);
		if (!pending) return;
		holds.delete(containerId);
		for (const resolve of pending) resolve();
	};
	return {
		effect: (name, payload) => deps.effect(name)?.(payload),
		broadcast: (cue, payload) => deps.broadcast(cue, payload),
		waitForTimeout: (ms) => deps.waitForTimeout(ms),
		timeScale: () => deps.timeScale(),
		showContainer: (containerId) => deps.mount.show(containerId),
		hideContainer: (containerId) => {
			releaseHolds(containerId); // a hide is the container completing → release any round-block.
			deps.mount.hide(containerId);
		},
		awaitContainerComplete: (containerId) =>
			new Promise<void>((resolve) => {
				const arr = holds.get(containerId) ?? [];
				arr.push(resolve);
				holds.set(containerId, arr);
			}),
		engineRead: (key) => deps.engineRead(key),
	};
};
