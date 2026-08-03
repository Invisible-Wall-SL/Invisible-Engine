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
	import type { WinLevelData } from '../game/winLevelMap';
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

	// Per-tier PRESENTATION resolution — the `win` component owns spine + intro/idle/outro per tier,
	// keyed by the tier's ALIAS (generated from the config's big tiers; see `winComponentDef`). For a
	// tier: `<alias>Spine`/`<alias>Intro/Idle/Outro` (per-tier) ?? the SHARED set
	// (`winSpine`/`introAnimation`/`idleAnimation`/`exitAnimation`, all tiers) ?? the config/coded tier's
	// own `spineKey`/`animation`. All params empty ⇒ the config/coded value ⇒ byte-identical. The spine
	// fallback (`<alias>Spine` ?? tier.spineKey ?? winSpine) is what closes the single-tier gap where the
	// coded path used to ignore the config tier's `spineKey`. A tier with no animation anywhere ⇒
	// `animationMap: undefined` (a small/medium tier presents as a plain number).
	type TierPresentation = {
		spine: string;
		animationMap?: { intro: string; idle: string; outro: string };
	};
	const resolveTierPresentation = (data: WinLevelData | undefined): TierPresentation | undefined => {
		if (!data) return undefined;
		const alias = data.alias;
		const conv = data.animation;
		const spine = stringParam(`${alias}Spine`) ?? data.spineKey ?? winSpine;
		const intro = stringParam(`${alias}Intro`) ?? stringParam('introAnimation') ?? conv?.intro;
		const idle = stringParam(`${alias}Idle`) ?? stringParam('idleAnimation') ?? conv?.idle;
		const outro = stringParam(`${alias}Outro`) ?? stringParam('exitAnimation') ?? conv?.outro;
		if (!intro && !idle && !outro) return { spine };
		return { spine, animationMap: { intro: intro ?? '', idle: idle ?? '', outro: outro ?? '' } };
	};

	const activePresentation = $derived(resolveTierPresentation(winLevelData));
	const resolvedAnimationMap = $derived(activePresentation?.animationMap);
	/** The spine bundle for the active (single-tier) presentation: per-tier component spine ?? the
	 *  config/coded tier's `spineKey` ?? the shared `winSpine` — closing the single-tier `spineKey` gap. */
	const activeSpine = $derived(activePresentation?.spine ?? winSpine);

	/**
	 * The SEQUENTIAL-ESCALATION chain (Invisible Game Config win tiers): the ordered tiers a win plays
	 * before the winning one, each resolved through {@link resolveTierPresentation} so its spine bundle
	 * + animation names honour the same per-tier ?? shared ?? config precedence. Present ONLY when the
	 * config authors `winLevels` AND `escalateTiers` is on (`activeWinLevelChain` returns `undefined`
	 * otherwise, so an un-authored / un-escalating game keeps the single-tier `resolvedAnimationMap`
	 * path — byte-identical). Tiers with no animation are skipped (a small/medium tier in the range
	 * presents no spine). A single-element chain (the winning tier is the escalation start) still routes
	 * through `WinAnimation`'s chain path, so its FINAL-tier outro plays on count-up completion.
	 */
	const escalationChain = $derived.by<WinAnimationStep[] | undefined>(() => {
		const level = winLevelData?.level;
		if (level === undefined) return undefined;
		const chain = activeWinLevelChain(level);
		if (!chain) return undefined;
		const steps = chain
			.map((tier) => resolveTierPresentation(tier))
			.filter((pres): pres is Required<TierPresentation> => !!pres?.animationMap)
			.map((pres) => ({ key: pres.spine, slotName, animationMap: pres.animationMap }));
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
			key={activeSpine}
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
