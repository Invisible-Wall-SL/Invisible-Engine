<script lang="ts" module>
	export type EmitterEventBoardFrame =
		| { type: 'boardFrameGlowShow' }
		| { type: 'boardFrameGlowHide' };
</script>

<script lang="ts">
	import { Sprite, RigProvider, RigTrack } from 'pixi-svelte';

	import { getContext } from '../game/context';

	const context = getContext();
	const RIG_SCALE = { width: 0.62, height: 0.66 };
	const SPRITE_SCALE = { width: 1.25, height: 0.72 };
	const POSITION_ADJUSTMENT = 1.01;

	type AnimationName = 'reelhouse_glow_start' | 'reelhouse_glow_idle' | 'reelhouse_glow_exit';

	let animationName = $state<AnimationName | undefined>(undefined);
	let loop = $state(false);

	context.eventEmitter.subscribeOnMount({
		boardFrameGlowShow: () => {
			animationName = 'reelhouse_glow_start';
			loop = false;
		},
		boardFrameGlowHide: () => {
			if (animationName) animationName = 'reelhouse_glow_exit';
		},
	});
</script>

{#if animationName}
	<RigProvider
		zIndex={-1}
		key="reelhouse"
		x={context.stateGameDerived.boardLayout().x * POSITION_ADJUSTMENT}
		y={context.stateGameDerived.boardLayout().y * POSITION_ADJUSTMENT}
		width={context.stateGameDerived.boardLayout().width * RIG_SCALE.width}
		height={context.stateGameDerived.boardLayout().height * RIG_SCALE.height}
	>
		<RigTrack
			trackIndex={0}
			{animationName}
			{loop}
			listener={{
				complete: (entry) => {
					if (entry.animation) {
						if (entry.animation.name === 'reelhouse_glow_start') {
							animationName = 'reelhouse_glow_idle';
							loop = true;
						}

						if (entry.animation.name === 'reelhouse_glow_exit') {
							animationName = undefined;
							loop = false;
						}
					}
				},
			}}
		/>
	</RigProvider>
{/if}

<Sprite
	key="frame_bg.png"
	anchor={0.5}
	x={context.stateGameDerived.boardLayout().x * POSITION_ADJUSTMENT}
	y={context.stateGameDerived.boardLayout().y * POSITION_ADJUSTMENT}
	width={context.stateGameDerived.boardLayout().width * SPRITE_SCALE.width}
	height={context.stateGameDerived.boardLayout().width * SPRITE_SCALE.height}
/>

<Sprite
	key="frame_edge.png"
	anchor={0.5}
	x={context.stateGameDerived.boardLayout().x * POSITION_ADJUSTMENT}
	y={context.stateGameDerived.boardLayout().y * POSITION_ADJUSTMENT}
	width={context.stateGameDerived.boardLayout().width * SPRITE_SCALE.width}
	height={context.stateGameDerived.boardLayout().width * SPRITE_SCALE.height}
/>
