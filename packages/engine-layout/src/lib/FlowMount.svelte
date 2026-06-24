<script lang="ts" module>
	import type { Scene } from './types';
	import type { Snippet } from 'svelte';

	export type Props = {
		/** The scene the Invisible Flow interpreter resolved for the active screen (design
		 *  doc §8, §11.3). Present ⇒ render it via `<LayoutScene>` (the generic mounter —
		 *  honours MainContainer scaling + the `visibleSource` gate, retiring §20.1). Absent
		 *  ⇒ the interpreter is NOT driving this screen, so render the coded `fallback`
		 *  snippet, byte-identical to current `main` (the §7 fall-through). The game computes
		 *  this from the engine-flow mounter's `MountDecision`, keeping the decision logic in
		 *  engine-flow (tested headlessly) and this component a pure renderer. */
		scene: Scene | undefined;
		/** The coded mounting for this screen — rendered whenever `scene` is absent. */
		fallback: Snippet;
	};
</script>

<script lang="ts">
	import LayoutScene from './LayoutScene.svelte';

	const { scene, fallback }: Props = $props();
</script>

{#if scene}
	<!-- Interpreter-driven: <LayoutScene> self-wraps in the right MainContainer for the
	     scene's `space` (game/standard/canvas/background) and applies its `visibleSource`
	     gate — the generic mounter, retiring §20.1. -->
	<LayoutScene {scene} />
{:else}
	<!-- Fall-through: the game's coded mounting for this screen (parity, §7). -->
	{@render fallback()}
{/if}
