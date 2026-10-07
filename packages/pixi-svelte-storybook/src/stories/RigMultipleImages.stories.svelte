<script lang="ts" module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { StoryPixiApp } from 'components-storybook';

	import {
		RigProvider,
		RigTrack,
	} from 'pixi-svelte';

	const { Story } = defineMeta({
		title: 'pixi-svelte/Rig/MultipleImages', // static/rigs/two-pages.atlas spans two images
		args: {
			width: 300,
			x: 400,
			y: 300,
			zIndex: 1,
			anchor: { x: 0, y: 0 },
		}
	});

	const assets = {
		multi: {
			type: 'spine',
			src: {
				skeleton: '/rigs/two-pages.json',
				atlas: '/rigs/two-pages.atlas',
			}
		},
	} as const;
</script>

<Story name="Preview">
	{#snippet template(args)}
		<StoryPixiApp {assets}>
			<RigProvider key="multi" {...args}>
				<RigTrack trackIndex={0} animationName="spin" loop />
			</RigProvider>
		</StoryPixiApp>
	{/snippet}
</Story>
