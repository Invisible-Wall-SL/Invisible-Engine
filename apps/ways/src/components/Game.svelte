<script lang="ts">
	import { onMount } from 'svelte';

	import { EnablePixiExtension, DebugStage } from 'components-pixi';
	import { EnableHotkey } from 'components-shared';
	import { MainContainer } from 'components-layout';
	import { App, Text, REM } from 'pixi-svelte';
	import { stateModal } from 'state-shared';

	import { UI, UiGameName } from 'components-ui-pixi';
	import {
		GameVersion,
		Modals,
		DebugMenu,
		registerBuyFeature,
		BuyBonusConfirm,
	} from 'components-ui-html';
	import { LayoutScene, BuyFeatureScreen } from 'engine-layout/svelte';
	import {
		LAYER_BAND_TAKEOVER,
		registerComponents,
		registerComponentValues,
		registerComponentVisibility,
		registerFontCatalog,
		FREE_SPIN_COUNTER_DEF,
		type Scene,
	} from 'engine-layout';

	import { getContext } from '../game/context';
	import { SYMBOL_SIZE } from '../game/constants';
	import { textSource } from '../game/textSource.svelte';
	import { boolSource } from '../game/boolSource.svelte';
	import EnableSound from './EnableSound.svelte';
	import EnableGameActor from './EnableGameActor.svelte';
	import ResumeBet from './ResumeBet.svelte';
	import Sound from './Sound.svelte';
	import Background from './Background.svelte';
	import LoadingScreen from './LoadingScreen.svelte';
	import BoardFrame from './BoardFrame.svelte';
	import Board from './Board.svelte';
	import Anticipations from './Anticipations.svelte';
	import Win from './Win.svelte';
	import FreeSpinIntro from './FreeSpinIntro.svelte';
	import FreeSpinOutro from './FreeSpinOutro.svelte';
	import Transition from './Transition.svelte';

	// Invisible Debug — register this game's debug tools (symbol overlay). Dynamic-
	// imported only under the build switch so the tools + their component modules
	// tree-shake out of a player build (docs/design/invisible-debug-framework.md).
	if (__IE_DEBUG__) {
		void import('../game/debugTools');
	}

	const context = getContext();

	// Free-spin counter — render the REUSABLE engine-layout `freeSpinCounter`
	// componentInstance (frame + "FREE SPIN" caption + "X OF Y" value) instead of the
	// coded <FreeSpinCounter>. The def + its feeds are registered at boot; the live
	// "current OF total" + show/hide are driven off the SAME `freeSpinCounter*` events
	// the game already broadcasts (bookEventHandlerMap is untouched), held in local
	// `$state` so the getters the sources capture stay reactive. The coded
	// FreeSpinCounter.svelte stays in the repo as a fallback (no longer mounted).
	let fsShow = $state(false);
	let fsCurrent = $state(0);
	let fsTotal = $state(0);
	context.eventEmitter.subscribeOnMount({
		freeSpinCounterShow: () => (fsShow = true),
		freeSpinCounterHide: () => (fsShow = false),
		freeSpinCounterUpdate: (emitterEvent) => {
			if (emitterEvent.current !== undefined) fsCurrent = emitterEvent.current;
			if (emitterEvent.total !== undefined) fsTotal = emitterEvent.total;
		},
	});
	registerComponents({ [FREE_SPIN_COUNTER_DEF.id]: FREE_SPIN_COUNTER_DEF });
	registerComponentValues({ freeSpins: textSource(() => `${fsCurrent} OF ${fsTotal}`) });
	registerComponentVisibility({ freeSpinCounterShow: boolSource(() => fsShow) });
	// Mark the game's built-in bitmap fonts so the engine-layout text path emits
	// `<BitmapText>` (not a system `<Text>`) for the counter's `gold` caption/value —
	// the same blitter the coded <FreeSpinCounter> used. Names are the BMFont
	// `<info face>` each `.xml` installs under (shipped in `assets.ts`).
	registerFontCatalog({
		prefix: '',
		fonts: [
			{ id: 'gold', name: 'gold', kind: 'bitmap', folder: '' },
			{ id: 'goldblur', name: 'goldblur', kind: 'bitmap', folder: '' },
			{ id: 'silver', name: 'silver', kind: 'bitmap', folder: '' },
			{ id: 'purple', name: 'purple', kind: 'bitmap', folder: '' },
		],
	});

	// The def's Frame/caption/value are sized for SYMBOL_SIZE 120 (panel 240px, font
	// 33); a uniform `scale` reproduces this game's `SYMBOL_SIZE*2` panel + `*0.275`
	// font exactly. `space:'game'` wraps the instance in a MainContainer, so `x/y` is
	// the panel TOP-LEFT in MAIN coords — the SAME `boardLayout()` formula the coded
	// overlay used (the def's root is local-space, anchor {0,0}).
	const FS_SCALE = SYMBOL_SIZE / 120;
	const fsPanelWidth = SYMBOL_SIZE * 2;
	const fsCounterScene = $derived<Scene>({
		id: 'freeSpinCounter',
		name: 'Free-spin counter',
		space: 'game',
		nodes: [
			{
				id: 'fs-counter',
				kind: 'componentInstance',
				componentId: 'freeSpinCounter',
				x:
					context.stateGameDerived.boardLayout().x -
					context.stateGameDerived.boardLayout().width * 0.5 -
					fsPanelWidth -
					SYMBOL_SIZE * 0.7,
				y:
					context.stateGameDerived.boardLayout().y -
					context.stateGameDerived.boardLayout().height * 0.5,
				scale: { x: FS_SCALE, y: FS_SCALE },
				params: {
					source: 'freeSpins',
					visibleSource: 'freeSpinCounterShow',
					label: 'FREE SPIN',
				},
			},
		],
	});

	onMount(() => (context.stateLayout.showLoadingScreen = true));

	// Register the SHARED in-canvas Select-Feature (buy-bonus) menu — the built-in `featureCard`
	// def + the `featureCards` repeater source (fed from the active `stateMeta.betModeMeta`). The
	// `<BuyFeatureScreen>` takeover below renders it; the HTML `ModalBuyBonus` is gone.
	registerBuyFeature();

	context.eventEmitter.subscribeOnMount({
		buyBonusConfirm: () => {
			stateModal.modal = { name: 'buyBonusConfirm' };
		},
	});
</script>

<App>
	<EnableSound />
	<EnableHotkey />
	<EnableGameActor />
	<EnablePixiExtension />

	<Background />

	{#if context.stateLayout.showLoadingScreen}
		<LoadingScreen onloaded={() => (context.stateLayout.showLoadingScreen = false)} />
	{:else}
		<ResumeBet />
		<!--
			The reason why <Sound /> is rendered after clicking the loading screen:
			"Autoplay with sound is allowed if: The user has interacted with the domain (click, tap, etc.)."
			Ref: https://developer.chrome.com/blog/autoplay
		-->
		<Sound />

		<MainContainer>
			<BoardFrame />
		</MainContainer>

		<MainContainer>
			<Board />
			<Anticipations />
		</MainContainer>

		<UI>
			{#snippet gameName()}
				<UiGameName name="WAYS GAME" />
			{/snippet}
			{#snippet logo()}
				<Text
					anchor={{ x: 1, y: 0 }}
					text="ADD YOUR LOGO"
					style={{
						fontFamily: 'proxima-nova',
						fontSize: REM * 1.5,
						fontWeight: '600',
						lineHeight: REM * 2,
						fill: 0xffffff,
					}}
				/>
			{/snippet}
		</UI>
		<Win />
		<FreeSpinIntro />
		{#if ['desktop', 'landscape'].includes(context.stateLayoutDerived.layoutType())}
			<LayoutScene scene={fsCounterScene} />
		{/if}
		<FreeSpinOutro />
		<Transition />
		<!--
			Buy-bonus SELECT menu — the shared in-canvas `<BuyFeatureScreen>` takeover (replaces the
			deleted HTML `ModalBuyBonus`). Visibility keys DIRECTLY on `stateModal`; a tap on the
			backdrop clears it. No non-default bet mode means the menu never has cards to show.
		-->
		<BuyFeatureScreen
			open={stateModal.modal?.name === 'buyBonus'}
			onDismiss={() => (stateModal.modal = null)}
			zIndex={LAYER_BAND_TAKEOVER}
		/>
		<!--
			Buy-bonus CONFIRM step — the shared in-canvas `<BuyBonusConfirm>` (→ `<ConfirmDialog>`),
			replacing the deleted HTML `ModalBuyBonusConfirm`. Shown while `buyBonusConfirm`; CONFIRM
			commits the bet mode, CANCEL/backdrop returns to the SELECT screen.
		-->
		<BuyBonusConfirm zIndex={LAYER_BAND_TAKEOVER} />
	{/if}

	<DebugStage />
</App>

<Modals>
	{#snippet version()}
		<GameVersion />
	{/snippet}
</Modals>

<GameVersion fixed />

<DebugMenu />
