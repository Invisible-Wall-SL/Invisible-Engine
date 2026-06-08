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
	import { setComponentParams } from './componentParamsContext';
	import { resolveComponentParams } from './componentParams';
	import { getComponentValueSource, type ValueSource } from './registerComponentValues';

	const { node, space }: Props = $props();

	// Resolve the def the instance references. Missing → render nothing (warned
	// once below), mirroring the bound-component miss path. Init-stable: the
	// component registry is populated once at boot (before any scene renders) and a
	// keyed instance node never swaps its `componentId` — so this (and the guards
	// below) are plain reads, not `$derived` (which would also be read at init by
	// `setContext` and so never update anyway → Svelte's `state_referenced_locally`).
	const def = getComponent(node.componentId, node.componentVersion);

	// Nesting guard (§8.9): cap depth at 2 levels and refuse a transitive cycle
	// (a component instancing itself). `parentNest` is a stable context value, so
	// these guards are init-stable too.
	const parentNest = getComponentNestState();
	const isCycle = parentNest.visited.has(node.componentId);
	const depthExceeded = parentNest.depth >= MAX_COMPONENT_DEPTH;
	const allowed = !!def && !isCycle && !depthExceeded;

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

	// Param threading (§13.2 / Phase B1): resolve the instance's effective params
	// (def defaults ◁ project defaults [stubbed undefined until B3] ◁ instance
	// overrides). As in B1 the static set is read at init.
	const staticParams = allowed && def ? resolveComponentParams(def, node.params) : {};

	// Engine value feed (§13.2 step 2 / Phase B2): if the resolved params name a
	// `source` AND the game registered a value store under it, subscribe and keep
	// the latest number in `liveValue`. The subscription lives in an `$effect` so
	// it re-binds if the registered store changes and tears down on unmount (the
	// returned unsubscribe is the effect cleanup). No source/provider ⇒ `liveValue`
	// stays undefined and the provided params equal B1's static map exactly (parity
	// — the `value` getter below then never appears).
	const source = typeof staticParams['source'] === 'string' ? staticParams['source'] : undefined;
	const valueSource: ValueSource | undefined = source
		? getComponentValueSource(source)
		: undefined;
	let liveValue = $state<number | undefined>(undefined);
	$effect(() => {
		if (!valueSource) return;
		return valueSource.subscribe((value) => {
			liveValue = value;
		});
	});

	// Provide the params to the rendered sub-tree (§13.2). `setContext` captures the
	// reference once at init, so the provided object stays STABLE while exposing a
	// REACTIVE `value` via a getter: a descendant text node's `$derived` reads
	// `params['value']`, which runs the getter inside its tracking scope and so
	// re-runs on every `liveValue` emit. When no value feed is active the `value`
	// getter is NOT defined, so the object is exactly B1's static
	// `resolveComponentParams` map (parity). Provide `{}` when the instance can't
	// expand (cycle/depth/missing def) so a descendant never reads a stale PARENT
	// instance's params. Set once at init, same discipline as the nest state.
	const providedParams: Record<string, unknown> = { ...staticParams };
	if (valueSource) {
		Object.defineProperty(providedParams, 'value', {
			enumerable: true,
			get: () => liveValue,
		});
	}
	setComponentParams(allowed && def ? providedParams : {});
</script>

{#if allowed && def}
	<LayoutNodeView node={def.root} {space} />
{/if}
