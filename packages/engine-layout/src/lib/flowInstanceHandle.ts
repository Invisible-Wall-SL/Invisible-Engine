/**
 * The handle a mounted `<ComponentInstance>` registers for Flow (`flowInstances.ts`), built here
 * so it is Svelte-free: the coercion a Flow set goes through is gated in Node, and the instance's
 * text inputs and change listeners are plain collections (nothing renders them). The instance
 * supplies the live pieces — its runner, its `fireTrigger`, its visibility — as closures read at
 * call time.
 */
import type { FlowInstanceHandle } from './flowInstances';
import type { ComponentStateMachineRunner } from './stateMachine';
import type { ComponentInput, ComponentInputKind } from './types';

export interface FlowInstanceHost {
	instanceId: string;
	componentId: string;
	version?: number;
	sceneId?: string;
	/** The def's inputs (`componentInputs`), kinds and text defaults. */
	inputs: readonly ComponentInput[];
	shown(): boolean;
	/** Fire a trigger input exactly as a heard signal is (the instance's own `fireTrigger`). */
	fireTrigger(id: string): void;
	/** The state-machine runner, when the def has a machine. */
	runner():
		Pick<ComponentStateMachineRunner, 'setInput' | 'input' | 'values' | 'stateOf'> | undefined;
}

/**
 * A Flow value read as an input's kind, the way the runner's own `setInput` reads one: a bool from
 * a boolean or `0` / `1`, a number from a finite number or a decimal string (a `float` pin fed by a
 * string compute; `'1e3'` and `'0x10'` are not), a text key from a string. `undefined` ⇒ not of that
 * kind (the set is dropped).
 */
const DECIMAL = /^-?(\d+\.?\d*|\.\d+)$/;
export const coerceInstanceInput = (
	kind: ComponentInputKind | undefined,
	value: unknown,
): boolean | number | string | undefined => {
	switch (kind) {
		case 'bool':
			if (typeof value === 'boolean') return value;
			return value === 0 || value === 1 ? value === 1 : undefined;
		case 'number': {
			const n = typeof value === 'string' && DECIMAL.test(value.trim()) ? Number(value) : value;
			return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
		}
		case 'text':
			return typeof value === 'string' ? value : undefined;
		default:
			return undefined;
	}
};

/** The handle plus the `notify` the instance calls when its machine starts or changes state, or
 *  it is shown or hidden. */
export function createFlowInstanceHandle(host: FlowInstanceHost): {
	handle: FlowInstanceHandle;
	notify(): void;
} {
	const kinds = new Map(host.inputs.map((input) => [input.id, input.kind]));
	const textInputs = new Map<string, string>();
	const listeners = new Set<() => void>();
	for (const input of host.inputs) {
		if (input.kind === 'text' && typeof input.default === 'string')
			textInputs.set(input.id, input.default);
	}
	const handle: FlowInstanceHandle = {
		instanceId: host.instanceId,
		componentId: host.componentId,
		version: host.version,
		sceneId: host.sceneId,
		shown: () => host.shown(),
		fire: (trigger) => {
			if (kinds.get(trigger) === 'trigger') host.fireTrigger(trigger);
		},
		setInput: (input, value) => {
			const kind = kinds.get(input);
			const coerced = coerceInstanceInput(kind, value);
			if (coerced === undefined) return false;
			if (kind === 'text') textInputs.set(input, coerced as string);
			else host.runner()?.setInput(input, coerced as boolean | number);
			return true;
		},
		input: (input) =>
			kinds.get(input) === 'text' ? textInputs.get(input) : host.runner()?.input(input),
		values: () => host.runner()?.values() ?? {},
		stateOf: (layer) => host.runner()?.stateOf(layer),
		onChange: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
	return {
		handle,
		notify: () => {
			for (const listener of [...listeners]) listener();
		},
	};
}
