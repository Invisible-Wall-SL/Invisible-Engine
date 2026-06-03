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
		<!--
			Bound-component contract (read before migrating a coded component to a
			`bind` node — see docs/design/invisible-editor.md §7.1):
			this wrapping <Container> already applies POSITION x/y + scale/rotation/
			alpha/zIndex. The bound component is therefore mounted at the node's
			placement and MUST render its art at LOCAL origin — do NOT re-apply
			transform.x/y (that double-positions it). It SHOULD read transform.anchor
			+ transform.width/height for its own sprite/spine (Containers carry no
			anchor/size), and leave scale at 1 (the container scales). With the
			generator's transform == the component's current placement, a no-doc boot
			renders byte-for-byte as before.
		-->
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
			key={node.region ?? node.assetKey}
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
