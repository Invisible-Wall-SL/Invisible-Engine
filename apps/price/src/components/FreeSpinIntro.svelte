<script lang="ts" module>
	export type EmitterEventFreeSpinIntro =
		| { type: 'freeSpinIntroShow' }
		| { type: 'freeSpinIntroHide' }
		| { type: 'freeSpinIntroUpdate'; totalFreeSpins: number };
</script>

<script lang="ts">
	import { CanvasSizeRectangle } from 'components-layout';
	import { stateUrlDerived } from 'state-shared';
	import { FadeContainer } from 'components-pixi';
	import { waitForResolve } from 'utils-shared/wait';
	import { BitmapText, RigProvider, RigSlot, RigTrack, Sprite } from 'pixi-svelte';

	import { getComponentParams } from 'engine-layout/svelte';

	import { getContext } from '../game/context';
	import PressToContinue from './PressToContinue.svelte';
	import FreeSpinAnimation from './FreeSpinAnimation.svelte';

	type AnimationName = string;

	// Standalone, board-centred free-spin intro overlay (it self-centres via
	// `FreeSpinAnimation`'s own `<MainContainer>`). Props/defaults reproduce the
	// hardcodes; the editor can override the rig bundle / animations / slot.
	const {
		introSpine: introRigProp = 'fsIntroNumber',
		introAnimation: introAnimationProp = 'intro',
		idleAnimation: idleAnimationProp = 'idle',
		slotName: slotNameProp = 'slot_number',
	}: {
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
	let oncomplete = $state(() => {});

	context.eventEmitter.subscribeOnMount({
		freeSpinIntroShow: () => (show = true),
		freeSpinIntroHide: () => (show = false),
		freeSpinIntroUpdate: async (emitterEvent) => {
			// `introSpine` defaults to a real bundle so this guard never trips; it only
			// keeps a deliberately-cleared overlay from blocking the press-gate.
			if (!introRig) return;
			// if (emitterEvent.extraSpins) {
			// 	context.eventEmitter.broadcast({ type: 'soundOnce', name: 'sfx_fs_respins' });
			// }
			// freeSpinsFromEvent = emitterEvent.extraSpins ?? emitterEvent.totalFreeSpins;
			freeSpinsFromEvent = emitterEvent.totalFreeSpins;
			await waitForResolve((resolve) => (oncomplete = resolve));
		},
	});
</script>

{#if introRig}
	<FadeContainer {show}>
		<CanvasSizeRectangle backgroundColor={0x000000} backgroundAlpha={0.5} />

		<FreeSpinAnimation>
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
								fontSize: sizes.width * 0.2,
								fontWeight: 'bold',
							}}
						/>
					</RigSlot>
				</RigProvider>

				<Sprite anchor={{ x: 0.5, y: -3 }} width={183 * 2.2} height={42 * 2.2} key="freespins.png" />
			{/snippet}
		</FreeSpinAnimation>

		<PressToContinue onpress={() => oncomplete()} />
	</FadeContainer>
{/if}
