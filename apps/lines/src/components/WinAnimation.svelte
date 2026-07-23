<script lang="ts">
	import type { Snippet } from 'svelte';

	import { SpineProvider, SpineTrack, SpineSlot } from 'pixi-svelte';

	import { getContext } from '../game/context';

	type AnimationState = 'intro' | 'idle' | 'outro';

	type Props = {
		// Resolved intro/idle/outro animation names for the active tier — the coded `winLevelMap`
		// convention by default, or author-picked per-tier/shared overrides (see `WIN_DEF`), so any
		// string the `winSpine` bundle exposes is valid (no longer the fixed convention literals).
		animationMap: {
			intro: string;
			idle: string;
			outro: string;
		};
		/** The big-win spine bundle + the slot the count number is injected into. Configurable so a
		 * game can point the shared `win` component at its own art; the coded defaults reproduce the
		 * original hardcodes (`bigwin` / `slot_win_count`), so an un-authored game renders identically. */
		key?: string;
		slotName?: string;
		children: Snippet;
	};

	const { animationMap, key = 'bigwin', slotName = 'slot_win_count', children }: Props = $props();
	const context = getContext();

	let oncomplete = $state(() => {});
	let animationState = $state<AnimationState>('intro');
</script>

<SpineProvider width={context.stateGameDerived.boardLayout().width} {key}>
	<SpineTrack
		trackIndex={0}
		animationName={animationMap[animationState]}
		loop={animationState === 'idle'}
		listener={{
			complete: () => {
				if (animationState === 'intro') animationState = 'idle';
				if (animationState === 'outro') oncomplete();
			},
		}}
	/>
	<SpineSlot {slotName}>
		{@render children()}
	</SpineSlot>
</SpineProvider>
