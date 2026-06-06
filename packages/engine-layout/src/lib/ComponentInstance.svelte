<script lang="ts" module>
	import type { ComponentInstanceNode, Scene } from './types';

	export type Props = { node: ComponentInstanceNode; space?: Scene['space'] };
</script>

<script lang="ts">
	import LayoutNodeView from './LayoutNodeView.svelte';
	import { getComponent } from './registerComponents';
	import {
		getComponentNestState,
		setComponentNestState,
		MAX_COMPONENT_DEPTH,
	} from './componentInstanceContext';

	const { node, space }: Props = $props();

	// Resolve the def the instance references. Missing → render nothing (warned
	// once below), mirroring the bound-component miss path.
	const def = $derived(getComponent(node.componentId, node.componentVersion));

	// Nesting guard (§8.9): cap depth at 2 levels and refuse a transitive cycle
	// (a component instancing itself). Derive the child state we'd provide to the
	// rendered sub-tree, and decide whether this instance is allowed to expand.
	const parentNest = getComponentNestState();
	const isCycle = $derived(parentNest.visited.has(node.componentId));
	const depthExceeded = $derived(parentNest.depth >= MAX_COMPONENT_DEPTH);
	const allowed = $derived(!!def && !isCycle && !depthExceeded);

	$effect(() => {
		if (!def) {
			console.warn(`[engine-layout] no component registered for id '${node.componentId}'.`);
		} else if (isCycle) {
			console.warn(
				`[engine-layout] component '${node.componentId}' instances itself transitively — skipped (cycle guard).`,
			);
		} else if (depthExceeded) {
			console.warn(
				`[engine-layout] component '${node.componentId}' exceeds the max nesting depth of ${MAX_COMPONENT_DEPTH} — skipped.`,
			);
		}
	});

	// Provide the deeper guard to whatever the component renders, so a nested
	// `componentInstance` inside `def.root` sees the updated depth + visited set.
	// Set during init (Svelte requires `setContext` at component initialisation);
	// a keyed instance node never swaps its `componentId`, so this is stable.
	setComponentNestState({
		depth: parentNest.depth + 1,
		visited: new Set([...parentNest.visited, node.componentId]),
	});

	// STATIC ONLY (v1): `def.params` / `def.signals` and the instance's
	// `node.params` are ignored here. The param/signal wiring + authored-behavior
	// timeline land in a later step (§8.5 / §8.6) — this is the seam where the
	// instance's params would be threaded into the rendered sub-tree.
</script>

{#if allowed && def}
	<LayoutNodeView node={def.root} {space} />
{/if}
