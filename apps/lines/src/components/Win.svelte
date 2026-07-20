<script lang="ts" module>
	import type { WinLevelData } from '../game/winLevelMap';

	export type EmitterEventWin =
		| { type: 'winShow' }
		| { type: 'winHide' }
		| { type: 'winUpdate'; amount: number; winLevelData: WinLevelData };
</script>

<script lang="ts">
	import { Container } from 'pixi-svelte';
	import { FadeContainer, WinCountUpProvider, ResponsiveBitmapText } from 'components-pixi';
	import { waitForResolve } from 'utils-shared/wait';
	import { roundSkip } from 'utils-shared/skipToken';
	import { bookEventAmountToCurrencyString } from 'utils-shared/amount';
	import { CanvasSizeRectangle, MainContainer } from 'components-layout';
	import { OnMount } from 'components-shared';

	import { formatWinText } from 'engine-layout';

	import WinCoins from './WinCoins.svelte';
	import WinAnimation from './WinAnimation.svelte';
	import PressToContinue from './PressToContinue.svelte';
	import { SYMBOL_SIZE } from '../game/constants';
	import { getContext } from '../game/context';
	import { flowV2DrivesScreens } from '../game/flowV2Runtime.svelte';
	import { bakedWinText } from '../editor-scenes';

	const context = getContext();

	// Under a v2 flow that DRIVES the screens, the authored container's `tapToContinue` overlay is
	// the SOLE tap surface (a `showContainer{awaitComplete}` node owns any round-block hold), so
	// this coded full-screen press steps aside exactly as the free-spin gates do in `Game.svelte`
	// — otherwise a v2 game carries a second, un-authored `OnPressFullScreen` + `MM_pressanywhere`
	// prompt the author never asked for and cannot see in either editor. The count-up still
	// self-resolves via `OnMount` below (the tap only ever SKIPPED it), so dropping the press
	// cannot hang the round. Read through the canonical doc-level predicate — the same one
	// `Sound.svelte` gates the boot music on, resolved synchronously from the doc so it is valid
	// at first render. No v2 doc / a book-events-only flow ⇒ `false` ⇒ byte-identical to today.
	const codedPressOwned = !flowV2DrivesScreens();

	let show = $state(false);
	let amount = $state(0);
	let winLevelData = $state<WinLevelData>();

	/**
	 * The authored win-level caption (Invisible Win Text) for this tier, e.g. `big` → "BIG WIN",
	 * localized + interpolated by `formatWinText`.
	 *
	 * OPT-IN: empty unless authored, and nothing is drawn when empty. The tier words a player sees
	 * today are painted into the big-win SPINE ART, not drawn as text (`winLevelMap`'s `text` field
	 * is dead data nothing reads), so defaulting this to the coded literals would double the
	 * caption on every existing game. Author it only for a game whose art carries no words — which
	 * is also what lets a tier be translated without re-cutting art per language.
	 */
	const levelCaption = $derived(
		winLevelData?.alias
			? formatWinText(bakedWinText().winLevels[winLevelData.alias] ?? '', {
					amount: bookEventAmountToCurrencyString(amount),
				})
			: '',
	);
	let oncomplete = $state(() => {});

	context.eventEmitter.subscribeOnMount({
		winShow: () => (show = true),
		winHide: () => (show = false),
		winUpdate: async (emitterEvent) => {
			amount = emitterEvent.amount;
			winLevelData = emitterEvent.winLevelData;
			await waitForResolve((resolve) => (oncomplete = resolve));
		},
	});
</script>

<FadeContainer {show}>
	{#if winLevelData}
		{@const isBigWin = winLevelData.type === 'big'}
		{@const duration = winLevelData.presentDuration}
		<WinCountUpProvider {amount} {duration}>
			{#snippet children({ countUpAmount, startCountUp, finishCountUp, countUpCompleted })}
				{#if isBigWin}
					<CanvasSizeRectangle backgroundColor={0x000000} backgroundAlpha={0.5} />
				{/if}

				<OnMount
					onmount={async () => {
						await startCountUp();
						await roundSkip.wait(300);
						oncomplete();
					}}
				/>

				<MainContainer>
					<Container
						x={context.stateGameDerived.boardLayout().x}
						y={context.stateGameDerived.boardLayout().y}
					>
						{#if winLevelData?.animation}
							<WinAnimation animationMap={winLevelData.animation}>
								{#if levelCaption}
									<Container y={-SYMBOL_SIZE * 2.6}>
										<ResponsiveBitmapText
											anchor={0.5}
											maxWidth={2130}
											text={levelCaption}
											style={{
												fontFamily: 'gold',
												fontSize: SYMBOL_SIZE * 1.8,
												align: 'center',
												fontWeight: 'bold',
												letterSpacing: 0,
											}}
										/>
									</Container>
								{/if}
								<ResponsiveBitmapText
									anchor={0.5}
									maxWidth={2130}
									text={bookEventAmountToCurrencyString(countUpAmount)}
									style={{
										fontFamily: 'gold',
										fontSize: SYMBOL_SIZE * 3.6,
										align: 'center',
										fontWeight: 'bold',
										letterSpacing: 0,
									}}
								/>
							</WinAnimation>
						{:else}
							<ResponsiveBitmapText
								anchor={0.5}
								maxWidth={context.stateLayoutDerived.canvasSizes().width /
									context.stateLayoutDerived.mainLayout().scale}
								text={bookEventAmountToCurrencyString(countUpAmount)}
								style={{
									fontFamily: 'gold',
									fontSize: SYMBOL_SIZE,
									align: 'center',
									fontWeight: 'bold',
									letterSpacing: 0,
								}}
							/>
						{/if}
					</Container>
				</MainContainer>

				<WinCoins emit={!countUpCompleted} levelAlias={winLevelData?.alias} />

				{#if codedPressOwned}
					<PressToContinue onpress={() => (countUpCompleted ? oncomplete() : finishCountUp())} />
				{/if}
			{/snippet}
		</WinCountUpProvider>
	{/if}
</FadeContainer>
