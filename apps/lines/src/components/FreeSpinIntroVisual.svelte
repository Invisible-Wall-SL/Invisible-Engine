<script lang="ts">
	import { stateUrlDerived } from 'state-shared';
	import { FadeContainer } from 'components-pixi';
	import { getComponentParams } from 'engine-layout/svelte';
	import { BitmapText, SpineProvider, SpineSlot, SpineTrack, Sprite } from 'pixi-svelte';

	import { getContext } from '../game/context';
	import FreeSpinAnimation from './FreeSpinAnimation.svelte';

	type AnimationName = string;

	// The board-relative VISUAL of the free-spin intro (§17 Phase 3): the
	// `FreeSpinAnimation` frame spine + the count spine with the count in its slot. Split
	// out of `FreeSpinIntro` so it can be an editor-positioned `componentInstance`
	// (`freeSpinIntroVisual`). `boundToInstance` (set on the def's bind child) makes it
	// render at the instance node's position; absent (the OFF composer) ⇒ it self-centres
	// on the board, byte-identical. The full-screen gate (dim + press + round-await) lives
	// in `FreeSpinIntroGate`; the count value arrives on `freeSpinIntroUpdate`.
	const {
		boundToInstance = false,
		introSpine: introSpineProp = 'fsIntroNumber',
		introAnimation: introAnimationProp = 'intro',
		idleAnimation: idleAnimationProp = 'idle',
		slotName: slotNameProp = 'slot_number',
	}: {
		boundToInstance?: boolean;
		introSpine?: string;
		introAnimation?: string;
		idleAnimation?: string;
		slotName?: string;
	} = $props();

	const context = getContext();

	const stringParam = (key: string): string | undefined => {
		const value = getComponentParams()[key];
		return typeof value === 'string' && value.length > 0 ? value : undefined;
	};

	const introSpine = $derived(stringParam('introSpine') ?? introSpineProp);
	const introAnimation = $derived(stringParam('introAnimation') ?? introAnimationProp);
	const idleAnimation = $derived(stringParam('idleAnimation') ?? idleAnimationProp);
	const slotName = $derived(stringParam('slotName') ?? slotNameProp);

	let show = $state(false);
	let animationName = $state<AnimationName>('intro');
	$effect(() => {
		animationName = introAnimation;
	});
	let freeSpinsFromEvent = $state(0);

	context.eventEmitter.subscribeOnMount({
		freeSpinIntroShow: () => (show = true),
		freeSpinIntroHide: () => (show = false),
		// Just set the count — the GATE owns the round-blocking await, not the visual.
		freeSpinIntroUpdate: (emitterEvent) => {
			freeSpinsFromEvent = emitterEvent.totalFreeSpins;
		},
	});
</script>

{#if introSpine}
	<FadeContainer {show}>
		<FreeSpinAnimation {boundToInstance}>
			{#snippet children({ sizes })}
				<Sprite
					anchor={{ x: 0.5, y: 1.2 }}
					width={500 * 2.2}
					height={156 * 2.2}
					key="freespins_{stateUrlDerived.lang()}.png"
				/>

				<SpineProvider key={introSpine} width={sizes.width * 0.3}>
					<SpineTrack
						trackIndex={0}
						{animationName}
						loop={animationName === idleAnimation}
						listener={{
							complete: () => (animationName = idleAnimation),
						}}
					/>
					<SpineSlot {slotName}>
						<BitmapText
							anchor={{ x: 0.5, y: 0.5 }}
							text={freeSpinsFromEvent}
							style={{
								fontFamily: 'gold',
								fontSize: sizes.width * 0.1,
								fontWeight: 'bold',
							}}
						/>
					</SpineSlot>
				</SpineProvider>

				<Sprite
					anchor={{ x: 0.5, y: -3 }}
					width={183 * 2.2}
					height={42 * 2.2}
					key="freespins.png"
				/>
			{/snippet}
		</FreeSpinAnimation>
	</FadeContainer>
{/if}
