<script lang="ts">
	import type { Snippet } from 'svelte';

	import { Container } from 'pixi-svelte';
	import { FadeContainer, ResponsiveBitmapText } from 'components-pixi';
	import { bookEventAmountToCurrencyString } from 'utils-shared/amount';
	import { MainContainer } from 'components-layout';
	import { getComponentParams } from 'engine-layout/svelte';

	import { formatWinText } from 'engine-layout';

	import { getContext } from '../game/context';
	import { SYMBOL_SIZE } from '../game/constants';
	import WinAnimation from './WinAnimation.svelte';
	import { winState } from '../game/winState.svelte';
	import { bakedWinText } from '../editor-scenes';

	// The board-relative VISUAL of the WIN overlay (big-win presentation): the tier spine (via
	// `WinAnimation`) + the count number in the spine's slot, PLUS the small/medium plain-number
	// path + the authored win-level caption (Invisible Win Text). Reads `winLevelData`/`amount`/
	// `countUpAmount` from `winState` (the GATE publishes them). `boundToInstance` makes it render
	// at the `win` instance node's position; absent (the OFF composer) ⇒ it self-centres on the
	// board. The gate owns the dim / press / round-await / count-up driver / `WinCoins`.
	const {
		boundToInstance = false,
		winSpine: winSpineProp = 'bigwin',
		slotName: slotNameProp = 'slot_win_count',
	}: {
		boundToInstance?: boolean;
		winSpine?: string;
		slotName?: string;
	} = $props();

	const context = getContext();

	const stringParam = (key: string): string | undefined => {
		const value = getComponentParams()[key];
		return typeof value === 'string' && value.length > 0 ? value : undefined;
	};

	const winSpine = $derived(stringParam('winSpine') ?? winSpineProp);
	const slotName = $derived(stringParam('slotName') ?? slotNameProp);

	let show = $state(true);

	const winLevelData = $derived(winState.winLevelData);
	const amount = $derived(winState.amount);
	const countUpAmount = $derived(winState.countUpAmount);

	// Per-tier animation-name resolution (see `WIN_DEF`): for the active tier, a PER-TIER override
	// (`<prefix>Intro/Idle/Exit`) ?? the SHARED set (`introAnimation`/`idleAnimation`/`exitAnimation`)
	// ?? the coded `winLevelMap` convention default. Only the 5 big tiers carry `.animation`; each
	// maps to its param prefix. All params empty ⇒ pure convention ⇒ byte-identical to before.
	const TIER_PREFIX: Record<string, string> = {
		big: 'big',
		superwin: 'super',
		mega: 'mega',
		epic: 'epic',
		max: 'max',
	};
	const resolvedAnimationMap = $derived.by(() => {
		const convention = winLevelData?.animation;
		if (!convention) return undefined;
		const prefix = TIER_PREFIX[winLevelData?.alias ?? ''];
		const pick = (suffix: string, sharedKey: string, fallback: string) =>
			(prefix ? stringParam(`${prefix}${suffix}`) : undefined) ?? stringParam(sharedKey) ?? fallback;
		return {
			intro: pick('Intro', 'introAnimation', convention.intro),
			idle: pick('Idle', 'idleAnimation', convention.idle),
			outro: pick('Exit', 'exitAnimation', convention.outro),
		};
	});

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

	context.eventEmitter.subscribeOnMount({
		winShow: () => (show = true),
		winHide: () => (show = false),
	});
</script>

{#snippet content()}
	{#if resolvedAnimationMap}
		<WinAnimation animationMap={resolvedAnimationMap} key={winSpine} {slotName}>
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
{/snippet}

{#if winLevelData}
	<FadeContainer {show}>
		{#if boundToInstance}
			<!-- Bound to a `win` VISUAL componentInstance: no own MainContainer / boardLayout offset.
				The instance node (default = board-centre) + the scene's game-space MainContainer place +
				scale this. -->
			{@render content()}
		{:else}
			<MainContainer>
				<Container
					x={context.stateGameDerived.boardLayout().x}
					y={context.stateGameDerived.boardLayout().y}
				>
					{@render content()}
				</Container>
			</MainContainer>
		{/if}
	</FadeContainer>
{/if}
