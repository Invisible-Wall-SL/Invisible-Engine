<script lang="ts" module>
	export type EmitterEventFreeSpinIntro =
		| { type: 'freeSpinIntroShow' }
		| { type: 'freeSpinIntroHide' }
		| { type: 'freeSpinIntroUpdate'; totalFreeSpins: number };
</script>

<script lang="ts">
	import { stateUrlDerived } from 'state-shared';
	import { FadeContainer } from 'components-pixi';
	import { getComponentParams } from 'engine-layout/svelte';
	import { BitmapText, RigProvider, RigSlot, RigTrack, Sprite } from 'pixi-svelte';

	import { getContext } from '../game/context';
	import FreeSpinAnimation from './FreeSpinAnimation.svelte';

	type AnimationName = string;

	// The board-relative VISUAL of the free-spin intro (§17 Phase 3): the
	// `FreeSpinAnimation` frame rig + the count rig with the count in its slot. Usable as
	// an editor-positioned `componentInstance` (`freeSpinIntroVisual`): `boundToInstance` (set
	// on the def's bind child) makes it render at the instance node's position; absent (a bare
	// scene bind) ⇒ it self-centres on the board. The count value arrives on
	// `freeSpinIntroUpdate`. It holds nothing — the flow's intro screen owns the dim, the tap
	// and the round-block (its `tapToContinue` + a `showContainer{awaitComplete}`).
	const {
		boundToInstance = false,
		introSpine: introRigProp = 'fsIntroNumber',
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

	const introRig = $derived(stringParam('introSpine') ?? introRigProp);
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
		freeSpinIntroUpdate: (emitterEvent) => {
			freeSpinsFromEvent = emitterEvent.totalFreeSpins;
		},
	});
</script>

{#if introRig}
	<FadeContainer {show}>
		<FreeSpinAnimation {boundToInstance}>
			{#snippet children({ sizes })}
				<Sprite
					anchor={{ x: 0.5, y: 1.2 }}
					width={500 * 2.2}
					height={156 * 2.2}
					key="freespins_{stateUrlDerived.lang()}.png"
				/>

				<RigProvider key={introRig} width={sizes.width * 0.3}>
					<RigTrack
						trackIndex={0}
						{animationName}
						loop={animationName === idleAnimation}
						listener={{
							complete: () => (animationName = idleAnimation),
						}}
					/>
					<RigSlot {slotName}>
						<BitmapText
							anchor={{ x: 0.5, y: 0.5 }}
							text={freeSpinsFromEvent}
							style={{
								fontFamily: 'gold',
								fontSize: sizes.width * 0.1,
								fontWeight: 'bold',
							}}
						/>
					</RigSlot>
				</RigProvider>

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
