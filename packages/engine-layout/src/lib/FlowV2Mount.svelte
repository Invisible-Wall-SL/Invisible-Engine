<script lang="ts" module>
	import type { Scene } from './types';

	/** A container the v2 flow currently has mounted — its backing scene + stack position.
	 *  Structural (mirrors engine-flow-v2's `MountedContainer`) so engine-layout stays free of an
	 *  engine-flow-v2 dependency at this boundary — the game passes its real objects through. */
	export type MountedContainerRef = {
		id: string;
		sceneId: string;
		z: number;
	};

	export type Props = {
		/** The mounted containers, ALREADY z-sorted ASC (base first, overlays on top). The game
		 *  mirrors the mount model's `ordered()` into a rune and passes it here; this list drives
		 *  what is on screen — showing/hiding a container is just this array growing/shrinking. */
		containers: MountedContainerRef[];
		/** Resolve a container's `sceneId` → its backing LayoutDoc `Scene` (from the live editor
		 *  doc). A container whose scene doesn't resolve is skipped (parity-safe, never throws). */
		resolveScene: (sceneId: string) => Scene | undefined;
	};
</script>

<script lang="ts">
	import { Container } from 'pixi-svelte';

	import LayoutScene from './LayoutScene.svelte';

	const { containers, resolveScene }: Props = $props();
</script>

<!--
	Invisible Flow v2 — the generic z-ordered container MOUNTER (Phase 4b; replaces v1's
	active-set render loop). It renders each mounted container's scene via the SAME
	`<LayoutScene>` the coded/v1 path uses (so MainContainer scaling + `visibleSource` are
	honoured unchanged). Stacking is by render order: the `containers` list is z-sorted ASC, so
	an earlier entry paints under a later one — `zIndex` is also set so a `sortableChildren`
	parent stacks identically. Keyed by container id so a container keeps its instance (and any
	in-flight component animation) across reorders. No entrance fade here: v2 timing is authored
	explicitly with `delay` nodes, so a `show` is a hard cut (design doc §4).
-->
{#each containers as container (container.id)}
	{@const scene = resolveScene(container.sceneId)}
	{#if scene}
		<Container zIndex={container.z}>
			<LayoutScene {scene} />
		</Container>
	{/if}
{/each}
