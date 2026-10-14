/**
 * What a Flow `componentInstance` / `waitForState` node gets from a placed instance that is NOT
 * registered, and how a wait on one is released (Rive plan §6.2, Phase 7) — the game env's rule,
 * Svelte-free so `check:flow-instance-nodes` drives every case in Node: slammed before the wait
 * starts, slammed during it, not on screen, mounting late, never mounting.
 *
 * `<ComponentInstance>` registers while mounted (`engine-layout` `flowInstances.ts`). When it is
 * not registered:
 *  - its screen is SHOWN (per the mount model) ⇒ it is mounting (the mirror renders on the next
 *    flush): a fire or a wait defers to the registration, bounded by a short grace — paid on EACH
 *    fire or wait against a placement that never registers (say a def the game lacks);
 *  - its screen is not shown ⇒ a trigger is DROPPED (the state machine's own rule: a win heard
 *    while hidden must not play minutes late), a value reads `undefined`, a wait resolves at once
 *    (never a hang), and an input set is STASHED and applied when the instance next mounts — so
 *    "set the amount, then show the screen" works in that order.
 * A handle whose screen is not the node's (`sceneId` against the container's scene) is not the
 * addressed placement: Flow names a screen and a node id, and two screens could place one id — a
 * fire, a read or a wait finds nothing there, and a set is kept for the addressed screen's own
 * mount. Every outcome is traced.
 */
import type { FlowInstanceHandle, InstanceSetOutcome } from 'engine-layout';
import type { InstanceRef } from 'engine-flow-v2';
import type { SkipToken } from 'utils-shared/skipToken';

export const INSTANCE_MOUNT_GRACE_MS = 250;

export interface InstanceWaitDeps {
	/** The mount model's read: is the container shown? */
	isShown(container: string): boolean;
	/** The scene a container renders; `undefined` ⇒ unknown, the handle's screen is not checked. */
	sceneIdOf(container: string): string | undefined;
	getFlowInstance(instanceId: string): FlowInstanceHandle | undefined;
	getFlowInstanceOn(
		instanceId: string,
		sceneId: string | undefined,
	): FlowInstanceHandle | undefined;
	/** Forget every value kept for a mount; called by `dispose` so a torn-down game hands nothing
	 *  to the next. */
	clearFlowInstanceStash?(): void;
	stashFlowInstanceInput(
		instanceId: string,
		input: string,
		value: unknown,
		sceneId?: string,
	): InstanceSetOutcome | 'stashed';
	watchFlowInstance(
		instanceId: string,
		listener: (handle: FlowInstanceHandle | undefined) => void,
	): () => void;
	/** The round's slam token: a wait never outlives a skipped round. */
	skip: Pick<SkipToken, 'isSkipped' | 'onSkip'>;
	/** The registry's drop feed (a stashed value refused on mount), traced here; released by
	 *  `dispose`. */
	onFlowInstanceDrop?(
		listener: (
			instanceId: string,
			input: string,
			value: unknown,
			outcome: Exclude<InstanceSetOutcome, 'set'>,
		) => void,
	): () => void;
	trace(op: string, ...rest: unknown[]): void;
	graceMs?: number;
}

export interface InstanceWaits {
	/** The addressed placement's live handle right now, `undefined` when it is not mounted or the
	 *  mounted one is on another screen. */
	liveInstance(ref: InstanceRef): FlowInstanceHandle | undefined;
	/** A `componentInstance` node's fed data-in: set on the addressed placement when it is mounted;
	 *  otherwise kept for its next mount on THAT screen — a same-id placement mounted on another
	 *  screen never takes it. Every outcome is traced. */
	setInstanceInput(ref: InstanceRef, input: string, value: unknown): void;
	/** A `componentInstance` node's `value:` data-out: the addressed placement's value, `undefined`
	 *  when it is not on screen. */
	readInstanceValue(ref: InstanceRef, value: string): unknown;
	/** The addressed placement's live handle: at once when registered, after its registration when
	 *  its screen is shown (bounded by the grace), `undefined` otherwise. A slam does not cut the
	 *  grace short: a fire must not drop a beat. */
	instanceWhenMounted(ref: InstanceRef): Promise<FlowInstanceHandle | undefined>;
	/** Hold until `layer` of the instance is in `state`; released by the state, by the instance
	 *  hiding or leaving the screen, or by a slam; resolved at once when the instance is not on
	 *  screen, has no such layer, or the round is already slammed. */
	awaitInstanceState(ref: InstanceRef, layer: string, state: string): Promise<void>;
	/** Release the drop-trace listener and forget every value kept for a mount. */
	dispose(): void;
}

/** The trace wording for each way a set can be refused (`InstanceSetOutcome`). */
export const DROP_REASON: Record<Exclude<InstanceSetOutcome, 'set'>, string> = {
	'no-input': 'no such input',
	'wrong-kind': 'not its kind',
	'no-machine': 'no state machine to set it on',
};

export function createInstanceWaits(deps: InstanceWaitDeps): InstanceWaits {
	const grace = deps.graceMs ?? INSTANCE_MOUNT_GRACE_MS;
	/** The handle mounted on the node's screen, or `undefined` — traced when the only mounted
	 *  placement of that id is on another screen. */
	const liveInstance = (ref: InstanceRef): FlowInstanceHandle | undefined => {
		const scene = deps.sceneIdOf(ref.container);
		const handle = deps.getFlowInstanceOn(ref.instance, scene);
		if (handle) return handle;
		const elsewhere = deps.getFlowInstance(ref.instance);
		if (elsewhere)
			deps.trace(
				'instance',
				ref.instance,
				`· not on screen '${ref.container}' (scene ${scene}; the handle is on ${elsewhere.sceneId})`,
			);
		return undefined;
	};
	const setInstanceInput = (ref: InstanceRef, input: string, value: unknown): void => {
		const line = `${ref.instance}.${input} = ${JSON.stringify(value)}`;
		const scene = deps.sceneIdOf(ref.container);
		const mounted = deps.getFlowInstance(ref.instance);
		const elsewhere =
			!!mounted &&
			scene !== undefined &&
			mounted.sceneId !== undefined &&
			mounted.sceneId !== scene;
		const outcome = deps.stashFlowInstanceInput(ref.instance, input, value, scene);
		if (outcome === 'set') deps.trace('instance', line);
		else if (outcome === 'stashed')
			deps.trace(
				'instance',
				line,
				elsewhere
					? `(stashed for container '${ref.container}' (scene ${scene}); the mounted '${ref.instance}' is on screen ${mounted.sceneId})`
					: '(stashed)',
			);
		else deps.trace('instance', line, `· dropped (${DROP_REASON[outcome]})`);
	};
	// A stashed set the instance refuses when it mounts (an input gone from the def, not its kind
	// any more, no machine) is traced as a live drop is.
	const stopDropTrace =
		deps.onFlowInstanceDrop?.((instanceId, input, value, outcome) =>
			deps.trace(
				'instance',
				`${instanceId}.${input} = ${JSON.stringify(value)}`,
				`· dropped on mount (${DROP_REASON[outcome]})`,
			),
		) ?? ((): void => undefined);
	const readInstanceValue = (ref: InstanceRef, value: string): unknown =>
		liveInstance(ref)?.values()[value];
	const instanceWhenMounted = (ref: InstanceRef): Promise<FlowInstanceHandle | undefined> => {
		const live = liveInstance(ref);
		if (live || !deps.isShown(ref.container)) return Promise.resolve(live);
		const scene = deps.sceneIdOf(ref.container);
		return new Promise((resolve) => {
			let settled = false;
			const finish = (handle: FlowInstanceHandle | undefined): void => {
				if (settled) return;
				settled = true;
				unwatch();
				clearTimeout(timer);
				resolve(handle);
			};
			// A registration on another screen is not the one awaited: keep waiting for the grace.
			const unwatch = deps.watchFlowInstance(ref.instance, () => {
				const mine = deps.getFlowInstanceOn(ref.instance, scene);
				if (mine) finish(mine);
			});
			const timer = setTimeout(() => finish(deps.getFlowInstanceOn(ref.instance, scene)), grace);
		});
	};
	const awaitInstanceState = async (
		ref: InstanceRef,
		layer: string,
		state: string,
	): Promise<void> => {
		const label = `${ref.instance} ${layer}.state == ${state}`;
		// A slammed round holds nothing: checked before the mount grace too, so a slam several book
		// events before the hold costs no wait at all.
		if (deps.skip.isSkipped()) {
			deps.trace('instance wait', label, '· skipped (round slammed)');
			return;
		}
		// A slam that lands DURING the mount grace releases the wait at once (a fire keeps its grace:
		// it must not drop a beat; a wait only holds time).
		let unskipGrace = (): void => undefined;
		const handle = await Promise.race([
			instanceWhenMounted(ref),
			new Promise<undefined>((resolve) => {
				unskipGrace = deps.skip.onSkip(() => resolve(undefined));
			}),
		]);
		unskipGrace();
		if (deps.skip.isSkipped()) {
			deps.trace('instance wait', label, '· skipped (round slammed)');
			return;
		}
		if (!handle) {
			deps.trace('instance wait', label, '· skipped (not on screen)');
			return;
		}
		const current = handle.stateOf(layer);
		if (current === undefined) {
			deps.trace('instance wait', label, '· skipped (no such layer)');
			return;
		}
		if (current === state) return;
		// Mounted but hidden (its own gate or its screen's): its machine has not started, or nobody
		// sees it advance — "not on screen", so the wait resolves at once rather than holding a chain
		// a press outside a round started (no slam would ever release it).
		if (!handle.shown()) {
			deps.trace('instance wait', label, '· skipped (hidden)');
			return;
		}
		if (deps.skip.isSkipped()) {
			deps.trace('instance wait', label, '· skipped (round slammed)');
			return;
		}
		// The handle resolved a tick ago: one that unregistered meanwhile would hold until a slam.
		const scene = deps.sceneIdOf(ref.container);
		if (deps.getFlowInstanceOn(ref.instance, scene) !== handle) {
			deps.trace('instance wait', label, '· skipped (instance left the screen)');
			return;
		}
		deps.trace('instance HOLD', label, '⏸');
		await new Promise<void>((resolve) => {
			let settled = false;
			// Each release is assigned below; `onSkip` can fire synchronously, so every unsubscribe
			// starts as a no-op rather than a binding not yet initialised.
			let unchange = (): void => undefined;
			let unwatch = (): void => undefined;
			let unskip = (): void => undefined;
			const finish = (why: string): void => {
				if (settled) return;
				settled = true;
				unchange();
				unwatch();
				unskip();
				deps.trace('instance RELEASE', label, why);
				resolve();
			};
			unchange = handle.onChange(() => {
				if (handle.stateOf(layer) === state) finish('▶ reached');
				else if (!handle.shown()) finish('▶ instance hidden');
			});
			unwatch = deps.watchFlowInstance(ref.instance, () => {
				// Judged on the node's screen: another screen's same-id placement mounting on top (or
				// leaving) is not this one leaving.
				if (deps.getFlowInstanceOn(ref.instance, scene) !== handle)
					finish('▶ instance left the screen');
			});
			unskip = deps.skip.onSkip(() => finish('▶ slammed'));
			// A synchronous fire (the token tripped between the check above and here) released the
			// hold before `unskip` was assigned: drop the listener now, or the round-long token keeps it.
			if (settled) unskip();
		});
	};
	return {
		liveInstance,
		setInstanceInput,
		readInstanceValue,
		instanceWhenMounted,
		awaitInstanceState,
		dispose: () => {
			stopDropTrace();
			deps.clearFlowInstanceStash?.();
		},
	};
}
