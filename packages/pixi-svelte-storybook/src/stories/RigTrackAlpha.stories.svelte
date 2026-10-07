<script lang="ts" module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { Tween } from 'svelte/motion';
	import { backInOut } from 'svelte/easing';

	import { StoryPixiApp } from 'components-storybook';

	import { RigProvider, RigTrack, Text } from 'pixi-svelte';

	const { Story } = defineMeta({
		title: 'pixi-svelte/Rig/TrackAlpha',
		args: {
			width: 600,
			x: 450,
			y: 350,
			zIndex: 1,
			anchor: { x: 0, y: 0 },
		},
	});
</script>

<script lang="ts">
	import { onMount, onDestroy } from 'svelte';

	const assets = {
		reelhouse: {
			type: 'spine',
			src: {
				skeleton: '/assets/spines/reelhouse/reelhouse_glow.json',
				atlas: '/assets/spines/reelhouse/reelhouse_glow.atlas',
			},
		},
	} as const;

	const idleTrackAlpha = new Tween(1, { duration: 600, easing: backInOut });
	const startTrackAlpha = new Tween(0, { duration: 600, easing: backInOut });
	const exitTrackAlpha = new Tween(0, { duration: 600, easing: backInOut });
	const trackAlphas = [idleTrackAlpha, startTrackAlpha, exitTrackAlpha];

	const clickHandler = async () => {
		const complete = trackAlphas.find((alpha) => alpha.current !== 0);
		if (!complete) return;

		const availableTracks = trackAlphas.filter((alpha) => alpha.current === 0);
		const chosenTrack = availableTracks[Math.floor(Math.random() * availableTracks.length)];

		const currentTrack = trackAlphas.find((alpha) => alpha.current === 1);

		if (currentTrack) currentTrack.set(0);
		chosenTrack.set(1);
	};
	
	onMount(() => window.addEventListener('click', clickHandler));
	onDestroy(() => window.removeEventListener('click', clickHandler));
</script>

<Story name="Preview">
	{#snippet template(args)}
		<StoryPixiApp {assets}>
			<Text text="CLICK TO CROSSFADE TO A RANDOM TRACK WITH ALPHA EASING" />
			<RigProvider {...args} key="reelhouse">
				<RigTrack
					trackIndex={0}
					animationName="reelhouse_glow_idle"
					loop
					alpha={idleTrackAlpha.current}
				/>
				<RigTrack
					trackIndex={1}
					animationName="reelhouse_glow_start"
					loop
					alpha={startTrackAlpha.current}
				/>
				<RigTrack
					trackIndex={2}
					animationName="reelhouse_glow_exit"
					loop
					alpha={exitTrackAlpha.current}
				/>
			</RigProvider>
		</StoryPixiApp>
	{/snippet}
</Story>
