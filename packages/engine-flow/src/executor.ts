import type { ChoreographyNode } from './types';
import type { FlowRuntime } from './runtime';
import { resolveList, resolvePayload, type FlowScope } from './accessor';

/**
 * Choreography executor — tree-walks a sub-graph driving the EXISTING primitives, in the
 * exact async shape the coded handlers use (design doc §8, §11.1):
 *
 *   sequence  → serial `await` in declared order      (≡ `sequence()` / `for…of await`)
 *   parallel  → `Promise.all(children.map(run))`       (≡ `Promise.all`)
 *   broadcast → `emitter.broadcast` (sync) OR `broadcastAsync` (awaited / fire-and-forget)
 *   delay     → `await waitForTimeout(ms / timeScale())`
 *   forEach   → `sequence(list, body)` (serial) OR `Promise.all(list.map(body))` (parallel)
 *
 * The three broadcast shapes are kept distinct because their timing differs subtly: a
 * `broadcast` returns synchronously; an AWAITED `broadcastAsync` blocks on its subscribers'
 * promises; a FIRE-AND-FORGET `broadcastAsync` (the coded `eventEmitter.broadcastAsync(...)`
 * with no `await` — e.g. `winLevelSoundsPlay`'s `uiHide`) starts the subscribers but does
 * NOT block the sequence. Reproducing this split is the parity crux Phase 0 proves.
 */
export const runChoreography = async (
	node: ChoreographyNode,
	runtime: FlowRuntime,
	scope: FlowScope,
): Promise<void> => {
	switch (node.kind) {
		case 'sequence': {
			for (const child of node.children) {
				await runChoreography(child, runtime, scope);
			}
			return;
		}
		case 'parallel': {
			await Promise.all(node.children.map((child) => runChoreography(child, runtime, scope)));
			return;
		}
		case 'broadcast': {
			const emitterEvent = resolvePayload(node.event, node.payload, scope);
			if (node.async) {
				const promise = runtime.emitter.broadcastAsync(emitterEvent);
				// `await: true` ⇒ block the sequence on the subscribers (an awaited
				// `broadcastAsync`); otherwise fire-and-forget (do NOT await the promise).
				if (node.await) await promise;
			} else {
				// Synchronous fire-and-return. `broadcast` is void; nothing to await.
				runtime.emitter.broadcast(emitterEvent);
			}
			return;
		}
		case 'delay': {
			// Divide by the LIVE scalar at the moment of execution (turbo can toggle mid-
			// round), matching the coded `waitForTimeout(ms / timeScale())` call sites.
			await runtime.waitForTimeout(node.ms / runtime.timeScale());
			return;
		}
		case 'forEach': {
			const items = resolveList(node.list, scope);
			if (node.mode === 'sequence') {
				for (const item of items) {
					await runChoreography(node.body, runtime, { ...scope, item });
				}
			} else {
				await Promise.all(
					items.map((item) => runChoreography(node.body, runtime, { ...scope, item })),
				);
			}
			return;
		}
	}
};
