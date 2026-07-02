<script lang="ts" module>
	import type { Scene } from './types';
	import type { FlowEntranceTransition } from './FlowFade.svelte';

	export type { FlowEntranceTransition };

	export type Props = {
		/** The scene to mount (a Flow-active screen's backing LayoutDoc scene). */
		scene: Scene;
		/**
		 * The entrance transition surfaced by the interpreter for THIS scene's activation (design
		 * doc §6, the droppable "Transition" node). Present ⇒ mount HIDDEN (alpha 0) and tween
		 * alpha→1 over `ms` (scaled by `timeScale`) — the fade starts from the FIRST painted frame,
		 * so there is NO full-alpha flash. Absent ⇒ render the scene directly (a hard cut, parity §7).
		 */
		transition?: FlowEntranceTransition;
		/** The live turbo scalar — the fade duration is divided by it like a `Delay` / `delayMs`. */
		timeScale?: () => number;
	};
</script>

<script lang="ts">
	import LayoutScene from './LayoutScene.svelte';
	import FlowFade from './FlowFade.svelte';

	const { scene, transition, timeScale }: Props = $props();
</script>

<!-- <FlowFade> owns the mount-hidden alpha 0→1 tween (or renders directly for a hard cut); this
     wrapper just pairs it with the generic `<LayoutScene>` mount so a Flow-active SCREEN fades in
     without duplicating the tween logic across mount sites. -->
<FlowFade {transition} {timeScale}>
	<LayoutScene {scene} />
</FlowFade>
