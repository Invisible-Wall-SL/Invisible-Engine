<script lang="ts">
	import { Sprite, SpineProvider, SpineTrack, SpineSlot } from 'pixi-svelte';
	import { FadeContainer, ResponsiveBitmapText } from 'components-pixi';
	import { bookEventAmountToCurrencyString } from 'utils-shared/amount';
	import { stateUrlDerived } from 'state-shared';
	import { getComponentParams } from 'engine-layout/svelte';

	import { getContext } from '../game/context';
	import FreeSpinAnimation from './FreeSpinAnimation.svelte';
	import { freeSpinOutroState } from '../game/freeSpinOutroState.svelte';

	type AnimationName = string;

	// The board-relative VISUAL of the free-spin outro (§17 Phase 3): the `FreeSpinAnimation`
	// frame spine + win/total-win sprites + the count spine (count in its slot, reading the
	// live count-up amount the GATE publishes to `freeSpinOutroState`). `boundToInstance`
	// makes it render at the `freeSpinOutroVisual` instance node's position; absent (the OFF
	// composer) ⇒ it self-centres on the board. The gate owns the dim / press / round-await /
	// count-up driver / `WinCoins`; the win level + amount arrive via the shared state.
	const {
		boundToInstance = false,
		outroSpine: outroSpineProp = 'fsOutroNumber',
		outroAnimation: outroAnimationProp = 'intro',
		idleAnimation: idleAnimationProp = 'idle',
		slotName: slotNameProp = 'slot_number',
	}: {
		boundToInstance?: boolean;
		outroSpine?: string;
		outroAnimation?: string;
		idleAnimation?: string;
		slotName?: string;
	} = $props();

	const context = getContext();

	const stringParam = (key: string): string | undefined => {
		const value = getComponentParams()[key];
		return typeof value === 'string' && value.length > 0 ? value : undefined;
	};

	const outroSpine = $derived(stringParam('outroSpine') ?? outroSpineProp);
	const outroAnimation = $derived(stringParam('outroAnimation') ?? outroAnimationProp);
	const idleAnimation = $derived(stringParam('idleAnimation') ?? idleAnimationProp);
	const slotName = $derived(stringParam('slotName') ?? slotNameProp);

	let show = $state(true);
	let animationName = $state<AnimationName>(outroAnimationProp);
	$effect(() => {
		animationName = outroAnimation;
	});

	/**
	 * Re-arm the outro animation each time the visual is shown.
	 *
	 * The track's `complete` listener parks on `idleAnimation`, and nothing put it back: the
	 * `$effect` above only refires when `outroAnimation` CHANGES, which it never does across
	 * sessions. So the first outro played `intro` → `idle`, and every outro after it opened
	 * already parked on `idle` — the authored animation ran exactly once per page load.
	 */
	const armOutroAnimation = () => {
		animationName = outroAnimation;
		show = true;
	};

	const winLevelData = $derived(freeSpinOutroState.winLevelData);
	const isBigWin = $derived(winLevelData?.type === 'big');
	const countUpAmount = $derived(freeSpinOutroState.countUpAmount);

	context.eventEmitter.subscribeOnMount({
		freeSpinOutroShow: () => armOutroAnimation(),
		freeSpinOutroHide: () => (show = false),
	});
</script>

{#if winLevelData}
	<FadeContainer {show}>
		<FreeSpinAnimation {boundToInstance}>
			{#snippet children({ sizes })}
				{#if isBigWin}
					<Sprite
						anchor={{ x: 0.5, y: 1.2 }}
						width={500 * 2.2}
						height={156 * 2.2}
						key="freespins_{stateUrlDerived.lang()}.png"
					/>
				{:else}
					<Sprite
						anchor={{ x: 0.5, y: 1.2 }}
						width={500 * 4.5}
						height={80 * 4.5}
						key="winsmall_{stateUrlDerived.lang()}.png"
					/>
				{/if}

				<SpineProvider key={outroSpine} width={sizes.width * 0.4}>
					<SpineTrack
						trackIndex={0}
						{animationName}
						loop={animationName === idleAnimation}
						listener={{
							complete: () => (animationName = idleAnimation),
						}}
					/>
					<SpineSlot {slotName}>
						<ResponsiveBitmapText
							anchor={0.5}
							style={{
								fontFamily: 'gold',
								fontSize: sizes.width * 0.08,
							}}
							text={bookEventAmountToCurrencyString(countUpAmount)}
							maxWidth={sizes.width}
						/>
					</SpineSlot>
				</SpineProvider>

				<Sprite
					anchor={{ x: 0.5, y: isBigWin ? -3.2 : -2 }}
					width={177 * (isBigWin ? 2.2 : 3)}
					height={42 * (isBigWin ? 2.2 : 3)}
					key="totalwin.png"
				/>
			{/snippet}
		</FreeSpinAnimation>
	</FadeContainer>
{/if}
