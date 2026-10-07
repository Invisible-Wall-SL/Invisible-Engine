<script lang="ts" module>
	import { defineMeta } from '@storybook/addon-svelte-csf';

	import {
		Text,
		RigProvider,
		RigTrack,
	} from 'pixi-svelte';

	import { StoryPixiApp } from 'components-storybook';

	const { Story } = defineMeta({
		title: 'pixi-svelte/Rig/Events',
		args: {
			width: 400,
			x: 500,
			y: 400,
			zIndex: 1,
			timeScale: 1,
			anchor: { x: 0, y: 0 },
		}
	});

	const assets = {
		rigEvents: {
			type: 'spine',
			src: {
				skeleton: '/assets/spines/bigwin/mm_bigwin.json',
				atlas: '/assets/spines/bigwin/big_wins.atlas',
			},
		},
	} as const;

	let onComplete = $state('not yet');
	let onCompleteTrack2 = $state('not yet');
	let onEvent = $state('not yet');
</script>

<Story name="Preview">
	{#snippet template(args)}
		<StoryPixiApp {assets}>
			<RigProvider {...args} key="rigEvents">
				<RigTrack
					trackIndex={0}
					animationName="big_win_intro"
					loop
					listener={{
						event: (entry, event) => {
							onEvent = 'done!';
							console.log('rig event:', event.data.name, entry, event);
						},
						complete: (entry) => {
							onComplete = 'done!';
							console.log('complete event', entry);
						}
					}}
				/>
				<RigTrack
					trackIndex={1}
					animationName="big_win_idle"
					loop
					listener={{
						complete: (entry) => {
							onCompleteTrack2 = 'done!';
							console.log('track2 complete event', entry);
						}
					}}
				/>
			</RigProvider>
			<Text
				x={20}
				y={20}
				text="oncomplete: {onComplete}"
				style={{ fill: 0x000000 }}
			/>
			<Text
				x={20}
				y={60}
				text="oncompleteTrack2: {onCompleteTrack2}"
				style={{ fill: 0x000000 }}
			/>
			<Text x={20} y={100} text="onevent: {onEvent}" style={{ fill: 0x000000 }} />
		</StoryPixiApp>
	{/snippet}

</Story>
