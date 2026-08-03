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
	import { activeWinLevelChain } from '../game/gameConfig';
	import WinAnimation, { type WinAnimationStep } from './WinAnimation.svelte';
	import WinCoins from './WinCoins.svelte';
	import { winState } from '../game/winState.svelte';
	import { bakedWinText } from '../editor-scenes';

	// The board-relative VISUAL of the WIN overlay (big-win presentation): the tier spine (via
	// `WinAnimation`) + the count number in the spine's slot, PLUS the small/medium plain-number
	// path + the authored win-level caption (Invisible Win Text) + the coin-fountain `WinCoins`
	// (authorable via `showCoins`). Reads `winLevelData`/`amount`/`countUpAmount`/`coinsEmit` from
	// `winState` (the GATE publishes them). `boundToInstance` makes it render at the `win` instance
	// node's position; absent (the OFF composer) ⇒ it self-centres on the board. The gate owns the
	// dim / press / round-await / count-up driver.
	const {
		boundToInstance = false,
		winSpine: winSpineProp = 'bigwin',
		slotName: slotNameProp = 'slot_win_count',
		showCoins: showCoinsProp = true,
	}: {
		boundToInstance?: boolean;
		winSpine?: string;
		slotName?: string;
		showCoins?: boolean;
	} = $props();

	const context = getContext();

	const stringParam = (key: string): string | undefined => {
		const value = getComponentParams()[key];
		return typeof value === 'string' && value.length > 0 ? value : undefined;
	};
	const booleanParam = (key: string): boolean | undefined => {
		const value = getComponentParams()[key];
		return typeof value === 'boolean' ? value : undefined;
	};

	const winSpine = $derived(stringParam('winSpine') ?? winSpineProp);
	const slotName = $derived(stringParam('slotName') ?? slotNameProp);
	const showCoins = $derived(booleanParam('showCoins') ?? showCoinsProp);

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
			(prefix ? stringParam(`${prefix}${suffix}`) : undefined) ??
			stringParam(sharedKey) ??
			fallback;
		return {
			intro: pick('Intro', 'introAnimation', convention.intro),
			idle: pick('Idle', 'idleAnimation', convention.idle),
			outro: pick('Exit', 'exitAnimation', convention.outro),
		};
	});

	/**
	 * The SEQUENTIAL-ESCALATION chain (Invisible Game Config win tiers): the ordered tiers a win plays
	 * before the winning one, each with its own spine bundle key + resolved animation names. Present
	 * ONLY when the config authors `winLevels` AND `escalateTiers` is on (`activeWinLevelChain`
	 * returns `undefined` otherwise, so an un-authored / un-escalating game keeps the single-tier
	 * `resolvedAnimationMap` path — byte-identical). Tiers with no animation are skipped (a
	 * small/medium tier in the range presents no spine). A single-element chain (the winning tier is
	 * the escalation start) still routes through `WinAnimation`'s chain path, so its FINAL-tier outro
	 * plays on count-up completion.
	 */
	const escalationChain = $derived.by<WinAnimationStep[] | undefined>(() => {
		const level = winLevelData?.level;
		if (level === undefined) return undefined;
		const chain = activeWinLevelChain(level);
		if (!chain) return undefined;
		const steps = chain
			.filter((tier) => tier.animation)
			.map((tier) => ({
				key: tier.spineKey ?? winSpine,
				slotName,
				animationMap: {
					intro: tier.animation!.intro,
					idle: tier.animation!.idle,
					outro: tier.animation!.outro,
				},
			}));
		return steps.length ? steps : undefined;
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
	<!-- Behind the tier spine / count number (rendered first), matching the pre-move z-order where
		the gate's coins sat behind the later-mounted visual. Emit while the count-up runs
		(`winState.coinsEmit`); `showCoins` false ⇒ no fountain. -->
	{#if showCoins}
		<WinCoins emit={winState.coinsEmit} levelAlias={winLevelData?.alias} />
	{/if}

	{#if resolvedAnimationMap}
		<!-- Size base: the OFF composer keeps the coded board-width fit (parity); the AUTHORED
			instance passes no width, so the rig renders at the natural size the Scene Editor
			previews — the instance node's transform is then the only thing that sizes/places it. -->
		<WinAnimation
			animationMap={resolvedAnimationMap}
			key={winSpine}
			{slotName}
			chain={escalationChain}
			countUpComplete={winState.countUpComplete}
			width={boundToInstance ? undefined : context.stateGameDerived.boardLayout().width}
		>
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
