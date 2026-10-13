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
 * addressed placement: Flow names a screen and a node id, and two screens could place one id.
 * Every outcome is traced.
 */
import type { FlowInstanceHandle } from 'engine-layout';
import type { InstanceRef } from 'engine-flow-v2';
import type { SkipToken } from 'utils-shared/skipToken';

export const INSTANCE_MOUNT_GRACE_MS = 250;

export interface InstanceWaitDeps {
	/** The mount model's read: is the container shown? */
	isShown(container: string): boolean;
	/** The scene a container renders; `undefined` ⇒ unknown, the handle's screen is not checked. */
	sceneIdOf(container: string): string | undefined;
	getFlowInstance(instanceId: string): FlowInstanceHandle | undefined;
	watchFlowInstance(
		instanceId: string,
		listener: (handle: FlowInstanceHandle | undefined) => void,
	): () => void;
	/** The round's slam token: a wait never outlives a skipped round. */
	skip: Pick<SkipToken, 'isSkipped' | 'onSkip'>;
	trace(op: string, ...rest: unknown[]): void;
	graceMs?: number;
}

export interface InstanceWaits {
	/** The addressed placement's live handle right now, `undefined` when it is not mounted or the
	 *  mounted one is on another screen. */
	liveInstance(ref: InstanceRef): FlowInstanceHandle | undefined;
	/** The addressed placement's live handle: at once when registered, after its registration when
	 *  its screen is shown (bounded by the grace), `undefined` otherwise. A slam does not cut the
	 *  grace short: a fire must not drop a beat. */
	instanceWhenMounted(ref: InstanceRef): Promise<FlowInstanceHandle | undefined>;
	/** Hold until `layer` of the instance is in `state`; released by the state, by the instance
	 *  hiding or leaving the screen, or by a slam; resolved at once when the instance is not on
	 *  screen, has no such layer, or the round is already slammed. */
	awaitInstanceState(ref: InstanceRef, layer: string, state: string): Promise<void>;
}

export function createInstanceWaits(deps: InstanceWaitDeps): InstanceWaits {
	const grace = deps.graceMs ?? INSTANCE_MOUNT_GRACE_MS;
	const addressed = (
		ref: InstanceRef,
		handle: FlowInstanceHandle | undefined,
	): FlowInstanceHandle | undefined => {
		if (!handle) return undefined;
		const scene = deps.sceneIdOf(ref.container);
		if (scene !== undefined && handle.sceneId !== undefined && handle.sceneId !== scene) {
			deps.trace(
				'instance',
				ref.instance,
				`· not on screen '${ref.container}' (scene ${scene}; the handle is on ${handle.sceneId})`,
			);
			return undefined;
		}
		return handle;
	};
	const liveInstance = (ref: InstanceRef): FlowInstanceHandle | undefined =>
		addressed(ref, deps.getFlowInstance(ref.instance));
	const instanceWhenMounted = (ref: InstanceRef): Promise<FlowInstanceHandle | undefined> => {
		const live = liveInstance(ref);
		if (live || !deps.isShown(ref.container)) return Promise.resolve(live);
		return new Promise((resolve) => {
			let settled = false;
			const finish = (handle: FlowInstanceHandle | undefined): void => {
				if (settled) return;
				settled = true;
				unwatch();
				clearTimeout(timer);
				resolve(addressed(ref, handle));
			};
			const unwatch = deps.watchFlowInstance(ref.instance, (next) => {
				if (next) finish(next);
			});
			const timer = setTimeout(() => finish(deps.getFlowInstance(ref.instance)), grace);
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
		if (deps.getFlowInstance(ref.instance) !== handle) {
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
			unwatch = deps.watchFlowInstance(ref.instance, (next) => {
				if (next !== handle) finish('▶ instance left the screen');
			});
			unskip = deps.skip.onSkip(() => finish('▶ slammed'));
			// A synchronous fire (the token tripped between the check above and here) released the
			// hold before `unskip` was assigned: drop the listener now, or the round-long token keeps it.
			if (settled) unskip();
		});
	};
	return { liveInstance, instanceWhenMounted, awaitInstanceState };
}
