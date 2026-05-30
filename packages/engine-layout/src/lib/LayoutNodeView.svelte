<script lang="ts" module>
	import type { LayoutNode } from './types';

	export type Props = { node: LayoutNode };
</script>

<script lang="ts">
	import { Container, Sprite, SpineProvider, SpineTrack, Text } from 'pixi-svelte';
	import { getContextLayout } from 'utils-layout';

	import { resolveTransform } from './resolveTransform';
	import { getBoundComponent } from './registerBoundComponents';

	const { node }: Props = $props();
	const layoutContext = getContextLayout();

	const transform = $derived(resolveTransform(node, layoutContext.stateLayoutDerived.layoutType()));

	const Bound = $derived(node.bind ? getBoundComponent(node.bind.component) : undefined);
</script>

{#if transform.visible}
	{#if Bound}
		<Container
			x={transform.x}
			y={transform.y}
			scale={transform.scale}
			rotation={transform.rotation}
			alpha={transform.alpha}
			zIndex={transform.zIndex}
		>
			<Bound {transform} {...(node.bind?.props ?? {})} />
		</Container>
	{:else if node.kind === 'container'}
		<Container
			x={transform.x}
			y={transform.y}
			scale={transform.scale}
			rotation={transform.rotation}
			alpha={transform.alpha}
			zIndex={transform.zIndex}
		>
			{#each node.children as child (child.id)}
				<svelte:self node={child} />
			{/each}
		</Container>
	{:else if node.kind === 'sprite'}
		<Sprite
			key={node.assetKey}
			x={transform.x}
			y={transform.y}
			anchor={transform.anchor}
			scale={transform.scale}
			rotation={transform.rotation}
			alpha={transform.alpha}
			zIndex={transform.zIndex}
			width={transform.width}
			height={transform.height}
			tint={transform.tint}
		/>
	{:else if node.kind === 'spine'}
		<SpineProvider
			key={node.assetKey}
			x={transform.x}
			y={transform.y}
			anchor={transform.anchor}
			scale={transform.scale}
			rotation={transform.rotation}
			alpha={transform.alpha}
			zIndex={transform.zIndex}
			width={transform.width}
			height={transform.height}
		>
			{#if node.defaultAnimation}
				<SpineTrack
					trackIndex={0}
					animationName={node.defaultAnimation}
					loop={node.loop ?? true}
				/>
			{/if}
		</SpineProvider>
	{:else if node.kind === 'text'}
		<Text
			text={node.text}
			x={transform.x}
			y={transform.y}
			anchor={transform.anchor}
			scale={transform.scale}
			rotation={transform.rotation}
			alpha={transform.alpha}
			zIndex={transform.zIndex}
			style={node.style}
		/>
	{/if}
{/if}
