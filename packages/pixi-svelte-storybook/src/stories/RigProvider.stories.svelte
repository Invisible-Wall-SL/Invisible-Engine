<script lang="ts" module>
	import { defineMeta } from '@storybook/addon-svelte-csf';

	import { StoryPixiApp } from 'components-storybook';

	import {
		RigProvider,
		RigTrack,
		Sprite,
		RigSlot,
	} from 'pixi-svelte';

	const { Story } = defineMeta({
		title: 'pixi-svelte/Rig/RigProvider',
		args: {
			width: 250,
			x: 300,
			y: 100,
			zIndex: 1,
			anchor: { x: 0, y: 0 },
		}
	});

	const assets = {
		guitar: {
			type: 'spine',
			src: {
				skeleton:
					'https://test-twist-front-2.s3.ap-southeast-2.amazonaws.com/pixi-svelte-package/guitar/transition_char.json',
				atlas:
					'https://test-twist-front-2.s3.ap-southeast-2.amazonaws.com/pixi-svelte-package/guitar/transition_char.atlas',
			},
		},
		sprites: {
			type: 'sprites',
			src: 'https://test-twist-front-2.s3.ap-southeast-2.amazonaws.com/pixi-svelte-package/sprites/sprites.json',
		},
	} as const;
</script>

<Story name="Preview">
	{#snippet template(args)}
		<StoryPixiApp {assets}>
			<RigProvider {...args} key="guitar">
				<RigTrack trackIndex={0} animationName="transition_loop" loop />
				<RigSlot slotName="stage_cloud">
					<Sprite key="logo.png" width={500} height={500} />
				</RigSlot>
				<RigSlot slotName="stage_light_a_beam_1">
					<Sprite key="logo.png" width={500} height={500} />
				</RigSlot>
			</RigProvider>
			<Sprite x={args.x + args.width} key="logo.png" width={500} height={500} />
		</StoryPixiApp>
	{/snippet}
</Story>
