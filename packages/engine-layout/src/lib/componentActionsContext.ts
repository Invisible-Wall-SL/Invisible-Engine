import { setContext, getContext } from 'svelte';

/**
 * Component-press context — routes a `pressAction` node's press to its owning instance's action.
 * `<ComponentInstance>` provides {@link setComponentPress} (routing to `actions[name]`); a node
 * inside the rendered `def.root` that carries {@link import('./types').BaseNode.pressAction} reads
 * it via {@link getComponentPress} and, on press, calls `fire(pressAction)`. The per-node, N-button
 * generalisation of the whole-instance `onSelect` press (a two-button confirm dialog routes its
 * `confirm`/`cancel` buttons to two callbacks). No provider (a top-level scene node) ⇒ `undefined`
 * ⇒ the node is inert (parity). Mirrors `componentParamsContext`.
 */
const NS = '@@engine_layout_component_press';

export type ComponentPress = (name: string) => void;

export function setComponentPress(fire: ComponentPress): void {
	setContext(NS, fire);
}

export function getComponentPress(): ComponentPress | undefined {
	return getContext(NS);
}
