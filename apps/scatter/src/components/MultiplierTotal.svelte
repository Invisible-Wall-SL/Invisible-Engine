<script lang="ts" module>
	export type EmitterEventMultiplierTotal =
		| { type: 'multiplierTotalShow' }
		| { type: 'multiplierTotalHide' }
		| { type: 'multiplierTotalUpdate'; totalMultiplier: number }
		| { type: 'multiplierTotalAnimate' };
</script>

<script lang="ts">
	import { BitmapText, RigProvider, RigSlot, RigTrack } from 'pixi-svelte';
	import { waitForResolve } from 'utils-shared/wait';
	import { stateBetDerived } from 'state-shared';

	import { getContext } from '../game/context';
	import { SYMBOL_SIZE } from '../game/constants';
	import BoardContainer from './BoardContainer.svelte';

	type Animation = 'explosion' | 'static';

	const context = getContext();

	let show = $state(false);
	let animationName = $state<Animation>('static');
	let totalMultiplier = $state(0);
	let oncomplete = $state(() => {});

	context.eventEmitter.subscribeOnMount({
		multiplierTotalShow: () => (show = true),
		multiplierTotalHide: () => (show = false),
		multiplierTotalUpdate: (emitterEvent) => (totalMultiplier = emitterEvent.totalMultiplier),
		multiplierTotalAnimate: async () => {
			animationName = 'explosion';
			await waitForResolve((resolve) => (oncomplete = resolve));
		},
	});
</script>

{#snippet multiplierSnippet()}
	<BitmapText
		scale={3}
		anchor={0.5}
		text={`${totalMultiplier} X`}
		style={{
			fontFamily: 'gold',
			fontSize: SYMBOL_SIZE,
			letterSpacing: -5,
		}}
	/>
{/snippet}

{#if show}
	<BoardContainer>
		<RigProvider
			x={context.stateGameDerived.boardLayout().width * 0.5}
			y={context.stateGameDerived.boardLayout().height * 0.5}
			key="tumble_multiplier"
			width={context.stateGameDerived.boardLayout().width * 4}
		>
			<RigTrack
				trackIndex={0}
				{animationName}
				timeScale={stateBetDerived.timeScale()}
				listener={{
					complete: oncomplete,
				}}
			/>
			<RigSlot slotName="tumblemultiplier">
				{@render multiplierSnippet()}
			</RigSlot>
			<RigSlot slotName="tumblemultiplier_add">
				{@render multiplierSnippet()}
			</RigSlot>
		</RigProvider>
	</BoardContainer>
{/if}
