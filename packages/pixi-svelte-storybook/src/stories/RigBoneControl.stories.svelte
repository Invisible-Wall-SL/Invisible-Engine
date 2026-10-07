<script lang="ts" module>
	import { defineMeta } from '@storybook/addon-svelte-csf';

	import { RigProvider } from 'pixi-svelte';

	import MousePositionProvider from '../components/MousePositionProvider.svelte';
	import { StoryPixiApp } from 'components-storybook';

	import {
		RigTrack,
		RigBone,
	} from 'pixi-svelte';


	const { Story } = defineMeta({
		title: 'pixi-svelte/Rig/BoneControl',
		args: {
			width: 10,
			x: 600,
			y: 400,
			zIndex: 1,
			timeScale: 1,
			boneName: 'ALL_Mover',
		}
	});

	const assets = {
		fox: {
			type: 'spine',
			src: {
				skeleton:
					'https://test-twist-front-2.s3.ap-southeast-2.amazonaws.com/pixi-svelte-package/fox/fox.json',
				atlas:
					'https://test-twist-front-2.s3.ap-southeast-2.amazonaws.com/pixi-svelte-package/fox/fox.atlas',
			},
		},
		tracks: {
			type: 'spine',
			src: {
				skeleton:
					'https://test-twist-front-2.s3.ap-southeast-2.amazonaws.com/pixi-svelte-package/tracks/feature_background.json',
				atlas:
					'https://test-twist-front-2.s3.ap-southeast-2.amazonaws.com/pixi-svelte-package/tracks/feature_background.atlas',
			},
		},
	} as const;
</script>

<Story name="Preview">
	{#snippet template(args)}
		<StoryPixiApp {assets}>
			<RigProvider key="tracks" x={600} y={400} width={2000}>
				<RigTrack trackIndex={0} animationName="idle" loop />
			</RigProvider>
			<MousePositionProvider>
				{#snippet children({ x, y })}
					{@const ratio = 100 / args.width}
					<RigProvider key="fox" {...args}>
						<RigTrack trackIndex={0} animationName="animation" loop />
						<RigBone boneName={args.boneName} x={ratio * (x - args.x) - 1000} y={ratio * (y - args.y)} />
					</RigProvider>
				{/snippet}
			</MousePositionProvider>
		</StoryPixiApp>
	{/snippet}
</Story>
