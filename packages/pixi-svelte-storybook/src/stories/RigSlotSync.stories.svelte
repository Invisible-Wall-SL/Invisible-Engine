<script lang="ts" module>
	import { defineMeta } from '@storybook/addon-svelte-csf';

	import { StoryPixiApp } from 'components-storybook';

	import {
		RigProvider,
		RigEventEmitterProvider,
		RigTrack,
		Sprite,
		RigSlot,
	} from 'pixi-svelte';

	const { Story } = defineMeta({
		title: 'pixi-svelte/Rig/SlotSyncWithAttachment',
		args: {
			width: 250,
			x: 300,
			y: 200,
			zIndex: 1,
			anchor: { x: 0, y: 0 },
		}
	});

	const assets = {
		rigSlotSync: {
			type: 'spine',
			src: {
				skeleton: '/assets/spines/globalMultiplier/multiframe.json',
				atlas: '/assets/spines/globalMultiplier/multiframe.atlas',
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
			<RigProvider {...args} key="rigSlotSync">
				<RigTrack trackIndex={0} animationName="reset" loop />
				<RigEventEmitterProvider>
					<RigSlot slotName="slot_multi">
						<Sprite key="logo.png" width={500} height={500} />
					</RigSlot>
					<RigSlot slotName="slot_multi_next">
						<Sprite key="logo.png" width={500} height={500} />
					</RigSlot>
				</RigEventEmitterProvider>
			</RigProvider>
			<Sprite x={args.x + args.width} key="logo.png" width={500} height={500} />
		</StoryPixiApp>
	{/snippet}
</Story>
