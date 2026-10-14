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
 * its `sceneId` so the env can check the address (a Flow node names the screen too). Only a
 * TOP-LEVEL placement registers (one placed on a screen, not an instance nested inside another
 * component's def, which Flow cannot name); should two mounted placements ever share an id, the
 * last mounted one is the live handle, and unmounting it hands the older one back.
 *
 * Not mounted (the screen is hidden, or not shown yet): `getFlowInstance` is `undefined`. What a
 * Flow node does then is the game env's rule (`apps/lines` `flowV2Runtime`): an input set while the
 * instance is away is STASHED here and applied the moment it registers (so "set the amount, then
 * show the screen" works), a trigger is dropped (the state machine's own rule — a win must not
 * play minutes late), a value reads `undefined`, a wait resolves. `watchFlowInstance` lets the env
 * defer to a registration it knows is imminent (the screen is shown, the instance is mounting).
 */

/** What became of a Flow set: applied, or why not. */
export type InstanceSetOutcome = 'set' | 'no-input' | 'wrong-kind' | 'no-machine';

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
	/** Set a bool / number input on its state machine, or a text input's key, read as the input's
	 *  kind (`coerceInstanceInput`). Anything but `'set'` set nothing and says why: an unknown id,
	 *  a value not of that kind, or a bool / number on a def with no state machine. */
	setInput(input: string, value: unknown): InstanceSetOutcome;
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

/** Mounted handles per id, oldest first; the last is live. */
const live = new Map<string, FlowInstanceHandle[]>();
/** Per id, per input: the value kept for the next mount, and the screen it was addressed to (an
 *  undefined screen matches any mount). */
const stashed = new Map<string, Map<string, { value: unknown; sceneId?: string }>>();
const watchers = new Map<string, Set<(handle: FlowInstanceHandle | undefined) => void>>();
type DropListener = (
	instanceId: string,
	input: string,
	value: unknown,
	outcome: Exclude<InstanceSetOutcome, 'set'>,
) => void;
const dropListeners = new Set<DropListener>();

/** Is a handle the placement a set addressed — on that screen, or with no screen to compare? */
const onScreen = (handle: FlowInstanceHandle, sceneId: string | undefined): boolean =>
	sceneId === undefined || handle.sceneId === undefined || handle.sceneId === sceneId;

const notify = (instanceId: string, handle: FlowInstanceHandle | undefined): void => {
	for (const watcher of [...(watchers.get(instanceId) ?? [])]) watcher(handle);
};

/**
 * Register a mounted placement's handle. Inputs stashed while it was away are applied first, so a
 * watcher already sees them. Returns the unregister, which removes only THIS handle: a later
 * registration under the same id stays live, and when the live one leaves, an older one still
 * mounted is live again (watchers hear it).
 */
export function registerFlowInstance(handle: FlowInstanceHandle): () => void {
	const id = handle.instanceId;
	let stack = live.get(id);
	if (!stack) live.set(id, (stack = []));
	stack.push(handle);
	const pending = stashed.get(id);
	if (pending) {
		for (const [input, kept] of [...pending]) {
			if (!onScreen(handle, kept.sceneId)) continue; // kept for a mount on its own screen
			pending.delete(input);
			const outcome = handle.setInput(input, kept.value);
			if (outcome !== 'set')
				for (const listener of [...dropListeners]) listener(id, input, kept.value, outcome);
		}
		if (pending.size === 0) stashed.delete(id);
	}
	notify(id, handle);
	return () => {
		const mounted = live.get(id);
		const at = mounted?.indexOf(handle) ?? -1;
		if (!mounted || at === -1) return;
		const wasLive = at === mounted.length - 1;
		mounted.splice(at, 1);
		if (mounted.length === 0) live.delete(id);
		if (wasLive) notify(id, mounted.at(-1));
	};
}

/** The live handle for a placed node id, or `undefined` while it is not mounted. */
export function getFlowInstance(instanceId: string): FlowInstanceHandle | undefined {
	return live.get(instanceId)?.at(-1);
}

/** Keep an input value for an instance that is not mounted on `sceneId` (any screen when
 *  undefined); applied when it next registers there (last write wins). A mounted instance on that
 *  screen takes the value at once and the outcome is returned; `'stashed'` otherwise. */
export function stashFlowInstanceInput(
	instanceId: string,
	input: string,
	value: unknown,
	sceneId?: string,
): InstanceSetOutcome | 'stashed' {
	const handle = getFlowInstance(instanceId);
	if (handle && onScreen(handle, sceneId)) return handle.setInput(input, value);
	let pending = stashed.get(instanceId);
	if (!pending) stashed.set(instanceId, (pending = new Map()));
	pending.set(input, { value, sceneId });
	return 'stashed';
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

/** Run `listener` when a stashed value is refused by the handle it was kept for, with the reason
 *  (the env traces it, as it traces a live drop). Returns the unsubscribe. */
export function onFlowInstanceDrop(listener: DropListener): () => void {
	dropListeners.add(listener);
	return () => dropListeners.delete(listener);
}

/** Forget every handle, stash, watcher and drop listener (tests). */
export function clearFlowInstances(): void {
	live.clear();
	stashed.clear();
	watchers.clear();
	dropListeners.clear();
}
