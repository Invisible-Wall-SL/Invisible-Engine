<script lang="ts" module>
	import type { ComponentInstanceNode, RepeaterNode, Scene } from './types';

	export type Props = {
		node: RepeaterNode;
		space?: Scene['space'];
	};
</script>

<script lang="ts">
	import { Container } from 'pixi-svelte';
	import { getContextLayout } from 'utils-layout';

	import ComponentInstance from './ComponentInstance.svelte';
	import { componentDesignSize } from './componentDesignSize';
	import { resolveComponent } from './registerComponents';
	import { getRepeaterSource, type RepeaterItem } from './registerRepeaterSources';

	const { node, space }: Props = $props();
	const layoutContext = getContextLayout();

	// Resolve the live item array (§ feature cards). Init-stable, like `ComponentInstance`'s
	// value feed: the registry is populated once at boot. The subscription lives in an
	// `$effect` so it re-binds if the registered store changes and tears down on unmount. No
	// source registered ⇒ `items` stays empty ⇒ nothing renders (parity, safe no-op).
	const source = getRepeaterSource(node.source);
	let items = $state<RepeaterItem[]>([]);
	$effect(() => {
		if (!source) return;
		return source.subscribe((next) => {
			items = next;
		});
	});

	// The per-item design size drives the layout stride. `componentDesignSize` unions the
	// def's sized leaves (the same box the editor previews); a def with only explicit
	// sizes needs no loaded textures, so a `null` intrinsic getter suffices. Unsizable ⇒
	// stride from the gap alone (items stack at the gap pitch).
	const def = resolveComponent(node.componentId).def;
	const box = $derived(
		def
			? componentDesignSize(def, () => null, layoutContext.stateLayoutDerived.layoutType())
			: null,
	);
	const itemWidth = $derived(box?.width ?? 0);
	const itemHeight = $derived(box?.height ?? 0);
	const columns = $derived(Math.max(1, node.layout.columns ?? 1));

	const offsetOf = (index: number): { x: number; y: number } => {
		if (node.layout.direction === 'grid') {
			const col = index % columns;
			const row = Math.floor(index / columns);
			return {
				x: col * (itemWidth + node.layout.gap),
				y: row * (itemHeight + node.layout.gap),
			};
		}
		return { x: index * (itemWidth + node.layout.gap), y: 0 };
	};

	// A synthetic instance node per item: the wrapping <Container> below applies the
	// per-item offset, so the instance renders at its own local origin (x/y 0) and its
	// values/press arrive via props, not via the doc.
	const itemNode = (item: RepeaterItem, index: number): ComponentInstanceNode => ({
		kind: 'componentInstance',
		id: `${node.id}:${item.key ?? index}`,
		componentId: node.componentId,
		x: 0,
		y: 0,
	});
</script>

{#each items as item, index (item.key ?? index)}
	{@const off = offsetOf(index)}
	<Container x={off.x} y={off.y}>
		<ComponentInstance
			node={itemNode(item, index)}
			{space}
			engineValues={item.values}
			onSelect={item.onSelect}
		/>
	</Container>
{/each}
