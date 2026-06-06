import { setContext, getContext } from 'svelte';

export { MAX_COMPONENT_DEPTH } from './registerComponents';

/**
 * Nesting guard for `componentInstance` expansion (see
 * `docs/design/invisible-editor.md` §8.9 "Nesting"). A component must not
 * instance itself transitively, and nesting is capped at 2 levels for v1. Each
 * `<ComponentInstance>` reads the parent guard, derives a child guard (one level
 * deeper, with its own id added to the visited set) and provides it to the
 * sub-tree it renders.
 */
export interface ComponentNestState {
	/** How many `componentInstance` levels deep we are (root scene = 0). */
	depth: number;
	/** Component ids currently on the instancing stack — cycle detection. */
	visited: ReadonlySet<string>;
}

const NS = '@@engine_layout_component_nest';

export function setComponentNestState(value: ComponentNestState): void {
	setContext(NS, value);
}

export function getComponentNestState(): ComponentNestState {
	return getContext(NS) ?? { depth: 0, visited: new Set<string>() };
}
