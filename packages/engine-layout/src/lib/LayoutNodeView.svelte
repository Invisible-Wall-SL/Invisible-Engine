<script lang="ts" module>
	import type { LayoutNode, Scene } from './types';

	export type Props = { node: LayoutNode; space?: Scene['space'] };
</script>

<script lang="ts">
	import { Container, Sprite, SpineProvider, SpineTrack, Text } from 'pixi-svelte';
	import { getContextLayout } from 'utils-layout';

	import { resolveTransform } from './resolveTransform';
	import { getBoundComponent } from './registerBoundComponents';

	const { node, space }: Props = $props();
	const layoutContext = getContextLayout();

	const transform = $derived(resolveTransform(node, layoutContext.stateLayoutDerived.layoutType()));

	const Bound = $derived(node.bind ? getBoundComponent(node.bind.component) : undefined);

	// `canvas`-space nodes pin to a window edge: effective position is
	// `screenAnchor * canvasSize + (x, y)` (x/y act as an offset from that edge).
	// Absent screenAnchor → x/y are used verbatim (game/standard scenes).
	const canvas = $derived(layoutContext.stateLayoutDerived.canvasSizes());
	const posX = $derived(
		transform.screenAnchor ? transform.screenAnchor.x * canvas.width + transform.x : transform.x,
	);
	const posY = $derived(
		transform.screenAnchor ? transform.screenAnchor.y * canvas.height + transform.y : transform.y,
	);

	// `background`-space sprites/spine cover-fit the canvas via the layout context's
	// `normalBackgroundLayout` (the node's `scale.x` is the cover scale, default 0.5
	// to match the coded Background). The helper sets exactly one of width/height
	// (the cover dimension); the undefined one lets the texture keep aspect. Sprites
	// take a centre anchor (their origin is top-left); spine keeps the node's own
	// anchor (pivot 0 by default — a background skeleton is authored around its own
	// origin, matching apps/lines `Background.svelte`).
	const isBackground = $derived(space === 'background');
	const bg = $derived(
		isBackground
			? layoutContext.stateLayoutDerived.normalBackgroundLayout({ scale: node.scale?.x ?? 0.5 })
			: undefined,
	);
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
			x={posX}
			y={posY}
			scale={transform.scale}
			rotation={transform.rotation}
			alpha={transform.alpha}
			zIndex={transform.zIndex}
		>
			<Bound {transform} {...node.bind?.props ?? {}} />
		</Container>
	{:else if node.kind === 'container'}
		<Container
			x={posX}
			y={posY}
			scale={transform.scale}
			rotation={transform.rotation}
			alpha={transform.alpha}
			zIndex={transform.zIndex}
		>
			{#each node.children as child (child.id)}
				<svelte:self node={child} {space} />
			{/each}
		</Container>
	{:else if node.kind === 'sprite'}
		<Sprite
			key={node.region ?? node.assetKey}
			x={bg ? bg.x : posX}
			y={bg ? bg.y : posY}
			anchor={bg ? { x: 0.5, y: 0.5 } : transform.anchor}
			scale={bg ? undefined : transform.scale}
			rotation={transform.rotation}
			alpha={transform.alpha}
			zIndex={transform.zIndex}
			width={bg ? bg.width : transform.width}
			height={bg ? bg.height : transform.height}
			tint={transform.tint}
		/>
	{:else if node.kind === 'spine'}
		<SpineProvider
			key={node.assetKey}
			x={bg ? bg.x : posX}
			y={bg ? bg.y : posY}
			anchor={transform.anchor}
			scale={bg ? undefined : transform.scale}
			rotation={transform.rotation}
			alpha={transform.alpha}
			zIndex={transform.zIndex}
			width={bg ? bg.width : transform.width}
			height={bg ? bg.height : transform.height}
		>
			{#if node.defaultAnimation}
				<SpineTrack trackIndex={0} animationName={node.defaultAnimation} loop={node.loop ?? true} />
			{/if}
		</SpineProvider>
	{:else if node.kind === 'text'}
		<Text
			text={node.text}
			x={posX}
			y={posY}
			anchor={transform.anchor}
			scale={transform.scale}
			rotation={transform.rotation}
			alpha={transform.alpha}
			zIndex={transform.zIndex}
			style={node.style}
		/>
	{/if}
{/if}
