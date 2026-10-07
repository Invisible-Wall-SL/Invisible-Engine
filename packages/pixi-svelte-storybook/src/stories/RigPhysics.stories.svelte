<script lang="ts" module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { StoryPixiApp } from 'components-storybook';

	import {
		RigProvider,
		RigTrack,
	} from 'pixi-svelte';

	const { Story } = defineMeta({
		title: 'pixi-svelte/Rig/Physics',
		args: {
			width: 150,
			x: 400,
			y: 350,
			zIndex: 1,
			anchor: { x: 0, y: 0 },
		}
	});

	const assets = {
		physics: {
			type: 'spine',
			src: {
				skeleton: '/rigs/physics-swing.json',
				atlas: '/assets/spines/symbols/symbols.atlas',
			}
		},
	} as const;
</script>

<Story name="Preview">
	{#snippet template(args)}
		<StoryPixiApp {assets}>
			<RigProvider key="physics" {...args}>
				<RigTrack trackIndex={0} animationName="sway" loop />
			</RigProvider>
		</StoryPixiApp>
	{/snippet}
</Story>
