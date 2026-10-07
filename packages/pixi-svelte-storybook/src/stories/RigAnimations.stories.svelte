<script lang="ts" module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { StoryPixiApp } from 'components-storybook';

	import { RigProvider, RigTrack } from 'pixi-svelte';

	const ANIMATION_NAME_LIST = [
		'big_win_intro',
		'big_win_idle',
		'big_win_exit',
		'super_win_intro',
		'super_win_idle',
		'super_win_exit',
		'mega_win_intro',
		'mega_win_idle',
		'mega_win_exit',
		'epic_win_intro',
		'epic_win_idle',
		'epic_win_exit',
		'max_win_intro',
		'max_win_idle',
		'max_win_exit',
	];

	const { Story } = defineMeta({
		tags: ['autodocs'],
		title: 'pixi-svelte/Rig/Animations',
		component: RigTrack,
		argTypes: {
			animationName: { control: 'radio', options: ANIMATION_NAME_LIST },
		},
		args: {
			alpha: 1,
			loop: true,
			trackIndex: 0,
			mixDuration: 0,
			animationName: 'big_win_idle',
		},
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

	const rigProps = {
		width: 500,
		x: 500,
		y: 400,
		zIndex: 1,
		anchor: { x: 0, y: 0 },
	};
</script>

<Story name="Preview">
	{#snippet template(args)}
		{@const props = { ...args, trackIndex: args.trackIndex ?? 0, animationName: args.animationName ?? '' }}
		<StoryPixiApp {assets}>
			<RigProvider key="bigWin" {...rigProps}>
				<RigTrack {...props} listener={{
					event: (track, event) => {
						if(event.data.name) console.log(`animation ${track.animation?.name} triggers event ${event.data.name}`)
					},
					complete: (track) => console.log(`animation ${track.animation?.name} is completed`),
				}} />
			</RigProvider>
		</StoryPixiApp>
	{/snippet}
</Story>
