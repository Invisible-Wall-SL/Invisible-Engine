/**
 * The LIVE placed component instances Flow can reach (Rive plan §6.2, Phase 7) — the runtime
 * sibling of `registerFlowPress`: `<ComponentInstance>` registers a handle under its placed node
 * id while it is mounted, and the game's Flow env looks the handle up when a `componentInstance`
 * node fires a trigger, sets an input, reads a value or waits for a state. Svelte-free and
 * module-scoped (each game bundle has its own copy), so this file is on the bare `engine-layout`
 * entry and a Node gate can drive it directly.
 *
 * Addressing: Flow stores a screen (container) AND the placed node id; the registry is keyed by
 * the node id alone, because the Scene Editor mints ids that are unique across a layout
 * (`c_<random>`) and `registerFlowPress` already addresses an instance that way. The handle carries
 * its `sceneId` for the env's trace. Only a TOP-LEVEL placement registers (one placed on a screen,
 * not an instance nested inside another component's def, which Flow cannot name); should two
 * mounted placements ever share an id, the last mounted one is the live handle.
 *
 * Not mounted (the screen is hidden, or not shown yet): `getFlowInstance` is `undefined`. What a
 * Flow node does then is the game env's rule (`apps/lines` `flowV2Runtime`): an input set while the
 * instance is away is STASHED here and applied the moment it registers (so "set the amount, then
 * show the screen" works), a trigger is dropped (the state machine's own rule — a win must not
 * play minutes late), a value reads `undefined`, a wait resolves. `watchFlowInstance` lets the env
 * defer to a registration it knows is imminent (the screen is shown, the instance is mounting).
 */

export interface FlowInstanceHandle {
	/** The placed node id. */
	instanceId: string;
	componentId: string;
	/** The pinned `ComponentDef.version` the placement renders. */
	version?: number;
	/** The screen it is placed on, when the scene provides it. */
	sceneId?: string;
	/** Is the instance drawn right now — its own gate and its screen's (`selfVisible`)? A mounted
	 *  but hidden instance is "not on screen" to Flow: its machine has not started, or it will not
	 *  advance where anyone can see it. */
	shown(): boolean;
	/** Fire a trigger input on this instance — as the signal of that name on its own bus, scoped
	 *  exactly as a heard signal is. An unknown id, or a non-trigger, does nothing. */
	fire(trigger: string): void;
	/** Set a bool / number input on its state machine, or a text input's key. A value of the wrong
	 *  kind, or an unknown id, does nothing. */
	setInput(input: string, value: unknown): void;
	/** The current value of a bool / number / text input. */
	input(input: string): unknown;
	/** The values the component reports (`<layer>.state`), `{}` without a state machine. */
	values(): Record<string, string>;
	/** The current state of a layer; `undefined` without that layer. */
	stateOf(layer: string): string | undefined;
	/** Run `listener` whenever the state machine starts or changes state, or the instance is shown
	 *  or hidden. Returns the unsubscribe. */
	onChange(listener: () => void): () => void;
}

const live = new Map<string, FlowInstanceHandle>();
const stashed = new Map<string, Map<string, unknown>>();
const watchers = new Map<string, Set<(handle: FlowInstanceHandle | undefined) => void>>();

const notify = (instanceId: string, handle: FlowInstanceHandle | undefined): void => {
	for (const watcher of [...(watchers.get(instanceId) ?? [])]) watcher(handle);
};

/**
 * Register a mounted placement's handle. Inputs stashed while it was away are applied first, so a
 * watcher already sees them. Returns the unregister, which removes only THIS handle (a later
 * registration under the same id is left in place).
 */
export function registerFlowInstance(handle: FlowInstanceHandle): () => void {
	const id = handle.instanceId;
	live.set(id, handle);
	const pending = stashed.get(id);
	if (pending) {
		stashed.delete(id);
		for (const [input, value] of pending) handle.setInput(input, value);
	}
	notify(id, handle);
	return () => {
		if (live.get(id) !== handle) return;
		live.delete(id);
		notify(id, undefined);
	};
}

/** The live handle for a placed node id, or `undefined` while it is not mounted. */
export function getFlowInstance(instanceId: string): FlowInstanceHandle | undefined {
	return live.get(instanceId);
}

/** Keep an input value for an instance that is not mounted; applied when it next registers
 *  (last write wins). A mounted instance takes the value at once. */
export function stashFlowInstanceInput(instanceId: string, input: string, value: unknown): void {
	const handle = live.get(instanceId);
	if (handle) {
		handle.setInput(input, value);
		return;
	}
	let pending = stashed.get(instanceId);
	if (!pending) stashed.set(instanceId, (pending = new Map()));
	pending.set(input, value);
}

/** Run `listener` with the handle on each registration under `instanceId`, and with `undefined`
 *  when it unregisters. Returns the unsubscribe. */
export function watchFlowInstance(
	instanceId: string,
	listener: (handle: FlowInstanceHandle | undefined) => void,
): () => void {
	let set = watchers.get(instanceId);
	if (!set) watchers.set(instanceId, (set = new Set()));
	set.add(listener);
	return () => {
		set.delete(listener);
		if (set.size === 0) watchers.delete(instanceId);
	};
}

/** Forget every handle, stash and watcher (tests). */
export function clearFlowInstances(): void {
	live.clear();
	stashed.clear();
	watchers.clear();
}
