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
	import { BitmapText, SpineProvider, SpineSlot, SpineTrack, Sprite } from 'pixi-svelte';

	import { getComponentParams } from 'engine-layout/svelte';

	import { getContext } from '../game/context';
	import PressToContinue from './PressToContinue.svelte';
	import FreeSpinAnimation from './FreeSpinAnimation.svelte';

	type AnimationName = string;

	// Standalone, board-centred free-spin intro overlay (it self-centres via
	// `FreeSpinAnimation`'s own `<MainContainer>`). Props/defaults reproduce the
	// hardcodes; the editor can override the spine bundle / animations / slot.
	const {
		introSpine: introSpineProp = 'fsIntroNumber',
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
	let oncomplete = $state(() => {});

	context.eventEmitter.subscribeOnMount({
		freeSpinIntroShow: () => (show = true),
		freeSpinIntroHide: () => (show = false),
		freeSpinIntroUpdate: async (emitterEvent) => {
			// `introSpine` defaults to a real bundle so this guard never trips; it only
			// keeps a deliberately-cleared overlay from blocking the press-gate.
			if (!introSpine) return;
			// if (emitterEvent.extraSpins) {
			// 	context.eventEmitter.broadcast({ type: 'soundOnce', name: 'sfx_fs_respins' });
			// }
			// freeSpinsFromEvent = emitterEvent.extraSpins ?? emitterEvent.totalFreeSpins;
			freeSpinsFromEvent = emitterEvent.totalFreeSpins;
			await waitForResolve((resolve) => (oncomplete = resolve));
		},
	});
</script>

{#if introSpine}
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

				<SpineProvider key={introSpine} width={sizes.width * 0.4}>
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
								fontSize: sizes.width * 0.15,
								fontWeight: 'bold',
							}}
						/>
					</SpineSlot>
				</SpineProvider>

				<Sprite anchor={{ x: 0.5, y: -3 }} width={183 * 2.2} height={42 * 2.2} key="freespins.png" />
			{/snippet}
		</FreeSpinAnimation>

		<PressToContinue onpress={() => oncomplete()} />
	</FadeContainer>
{/if}
