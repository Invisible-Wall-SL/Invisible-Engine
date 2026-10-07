<script lang="ts" module>
	import { defineMeta } from '@storybook/addon-svelte-csf';

	import {
		RigProvider,
		RigTrack,
	} from 'pixi-svelte';

	import { StoryPixiApp } from 'components-storybook';

	const { Story } = defineMeta({
		title: 'pixi-svelte/Rig/MeshSequence',
		args: {
			width: 300,
			x: 400,
			y: 300,
			zIndex: 1,
			anchor: { x: 0, y: 0 },
		}
	});

	const assets = {
		rigMeshSequence: {
			type: 'spine',
			src: {
				skeleton: '/assets/spines/symbols3/W.json',
				atlas: '/assets/spines/symbols3/symbols3.atlas',
			},
		},
	} as const;
</script>

<Story name="Preview">
	{#snippet template(args)}
		<StoryPixiApp {assets}>
			<RigProvider {...args} key="rigMeshSequence">
				<RigTrack trackIndex={0} animationName="wild_dynamite" loop />
			</RigProvider>
		</StoryPixiApp>
	{/snippet}
</Story>
