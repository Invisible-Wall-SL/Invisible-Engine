<script lang="ts" module>
	import * as PIXI from 'pixi.js';
	import type { Snippet } from 'svelte';

	import type { OverwriteCursor } from '../types';

	export type Props = OverwriteCursor<Omit<PIXI.ContainerOptions, 'children'>> & {
		children: Snippet;
	};
</script>

<script lang="ts">
	import { propsSyncEffect } from '../utils.svelte';
	import { getContextParent, createContextParent } from '../context.svelte';

	const props: Props = $props();
	const parentContext = getContextParent();
	const container = new PIXI.Container();

	propsSyncEffect({ props, target: container, ignore: ['children'] });
	parentContext.addToParent(container);
	createContextParent(container);
</script>

<!--
	The children's anchors (Svelte leaves a comment or text node in the page for every block) go in
	an element of this container's own, so the page holds the Pixi tree as a tree. Flat, the whole
	tree's anchors were one run of siblings beside the canvas (~10k on a booted game), and WebKit, on
	every node it inserts, removes or moves, walks the parent's children to the nearest element on
	each side: ~0.1 ms a node there, on every mount, unmount and keyed move. Hidden: it never draws.
-->
<div hidden>{@render props.children()}</div>
