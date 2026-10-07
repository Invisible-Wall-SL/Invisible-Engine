<script lang="ts" module>
	import { defineMeta } from '@storybook/addon-svelte-csf';

	import { StoryPixiApp } from 'components-storybook';

	import {
		Container,
		RigProvider,
		RigTrack,
		Rectangle,
	} from 'pixi-svelte';

	const { Story } = defineMeta({
		title: "pixi-svelte/Container Interactions",
		args: {
			width: 400,
			x: 400,
			y: 350,
			zIndex: 1,
			anchor: { x: 0, y: 0 },
		}
	});

	const assets = {
		bigWin: {
			type: 'spine',
			src: {
				skeleton: '/assets/spines/bigwin/mm_bigwin.json',
				atlas: '/assets/spines/bigwin/big_wins.atlas',
			},
		},
	} as const;

	let track = $state('big_win_idle');
	let tint = $state(0xffffff);
</script>

<Story name="Preview">
	{#snippet template(args)}
		<StoryPixiApp {assets}>
			<Container>
				<Rectangle
					width={50}
					height={50}
					cursor="cell"
					eventMode="static"
					backgroundColor={0x000000}
					onclick={() => alert('hi')}
				/>

				<Container
					eventMode="static"
					cursor="pointer"
					onclick={() => console.log('click!')}
					onpointerdown={() => (tint = Math.floor(Math.random() * 16777215))}
					onpointerenter={() => (track = 'mega_win_idle')}
					onpointerleave={() => (track = 'big_win_idle')}
				>
					<RigProvider key="bigWin" {...args} {tint}>
						<RigTrack trackIndex={0} animationName={track} loop />
					</RigProvider>
				</Container>
			</Container>
		</StoryPixiApp>
	{/snippet}
</Story>
