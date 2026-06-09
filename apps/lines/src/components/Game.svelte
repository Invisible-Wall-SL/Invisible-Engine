<script lang="ts">
	import { onMount } from 'svelte';

	import { EnablePixiExtension } from 'components-pixi';
	import { EnableHotkey } from 'components-shared';
	import { MainContainer } from 'components-layout';
	import { App, Container, Text, REM } from 'pixi-svelte';
	import { stateBet, stateBetDerived, stateConfig, stateModal, stateUi } from 'state-shared';

	import {
		UI,
		UiGameName,
		InfoOverlay,
		HudReadout,
		HudTicker,
		HudCaption,
		HudValue,
		ButtonFrame,
		ButtonLabel,
	} from 'components-ui-pixi';
	import { GameVersion, Modals } from 'components-ui-html';
	import { LayoutScene } from 'engine-layout/svelte';
	import {
		registerBoundComponents,
		registerComponents,
		registerComponentValues,
		registerComponentActions,
		HUD_READOUT_DEF,
		findReelGridNode,
		resolveTransform,
		backgroundCoverScale,
		backgroundCoverStretch,
		backgroundFit,
	} from 'engine-layout';

	import { infoManifest } from '../game/infoManifest';
	import { setBoardOverride } from '../game/stateGame.svelte';
	import { valueSource } from '../game/valueSource';
	import { boolSource } from '../game/boolSource';
	import { fallbackEditorScenes, loadEditorScenes } from '../editor-scenes';

	import { getContext } from '../game/context';
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
	import FreeSpinCounter from './FreeSpinCounter.svelte';
	import FreeSpinOutro from './FreeSpinOutro.svelte';
	import Transition from './Transition.svelte';
	import I18nTest from './I18nTest.svelte';
	import SymbolDebug from './SymbolDebug.svelte';

	// `HudTicker`/`HudCaption`/`HudValue` are the three coded parts the `hudReadout`
	// ComponentDef MOUNTS (§14.3 separate-coded-parts path): the def's `root` has one
	// `bind` child per part by name, so each must be in the bound-component registry
	// alongside the animated overlays. They reuse the coded HUD rendering (tile +
	// caption localization + currency format + count-up + bet tap). `HudReadout` (the
	// pre-split single mount) stays registered for revert safety; it's unused by the
	// def now.
	registerBoundComponents({
		Win,
		Transition,
		HudReadout,
		HudTicker,
		HudCaption,
		HudValue,
		// `ButtonFrame`/`ButtonLabel` are the two coded parts the `button` ComponentDef
		// MOUNTS (§16.2 separate-coded-parts path, the button analogue of the HUD split):
		// the def's `root` has one `bind` child per part by name (Frame = the `UiSprite`
		// tile + hit area, Label = the localized icon/label `Text`), so each must be in
		// the bound-component registry. Unused until the HUD button cluster is converted
		// to `componentInstance`s (B6.4) — registered now keeps B6.1 purely additive.
		ButtonFrame,
		ButtonLabel,
		// Move 3 Phase A — the free-spin overlays are now mounted from the doc via
		// `<LayoutScene>` (canvas-space bind anchors), so the editor can position
		// them. They self-show/animate off book events; the doc owns only placement.
		FreeSpinIntro,
		FreeSpinCounter,
		FreeSpinOutro,
	});
	// Batch B / B4.4 — register the parametric HUD readout def + its live value
	// sources. The three HUD bar nodes (balance/win/bet) are now `componentInstance`
	// nodes of `hudReadout` (see `referenceLayouts/hud.ts`), so this powers the live
	// HUD: the def mounts the coded `HudReadout`, fed `value` from these sources.
	registerComponents({ [HUD_READOUT_DEF.id]: HUD_READOUT_DEF });
	registerComponentValues({
		balance: valueSource(() => stateBet.balanceAmount),
		win: valueSource(() => stateBet.winBookEventAmount),
		bet: valueSource(() => stateBetDerived.betCost()),
	});

	const fallbackBasegame = fallbackEditorScenes.scenes.find((scene) => scene.id === 'basegame')!;
	const fallbackOverlays = fallbackEditorScenes.scenes.find(
		(scene) => scene.id === 'basegameOverlays',
	)!;

	/** Fetched at boot from the launcher; seeded with the bundled fallback so the
	 * game renders immediately and degrades gracefully when offline. */
	let editorDoc = $state(fallbackEditorScenes);
	const basegameScene = $derived(
		editorDoc.scenes.find((scene) => scene.id === 'basegame') ?? fallbackBasegame,
	);
	const basegameOverlaysScene = $derived(
		editorDoc.scenes.find((scene) => scene.id === 'basegameOverlays') ?? fallbackOverlays,
	);
	// Move 3 Phase A — free-spin overlays as editor scenes (the fallback layout
	// ships them, so the `!` is safe + a no-doc boot is parity). Each is a
	// `canvas`-space bind anchor at (0,0): <LayoutScene> wraps it in a no-op
	// Container and the coded component renders at canvas origin, self-positioning
	// exactly as the prior hardcoded mount. An editor transform then offsets it.
	const fallbackFsIntro = fallbackEditorScenes.scenes.find((s) => s.id === 'freeSpinIntro')!;
	const fsIntroScene = $derived(
		editorDoc.scenes.find((scene) => scene.id === 'freeSpinIntro') ?? fallbackFsIntro,
	);
	const fallbackFsCounter = fallbackEditorScenes.scenes.find((s) => s.id === 'freeSpinCounter')!;
	const fsCounterScene = $derived(
		editorDoc.scenes.find((scene) => scene.id === 'freeSpinCounter') ?? fallbackFsCounter,
	);
	const fallbackFsOutro = fallbackEditorScenes.scenes.find((s) => s.id === 'freeSpinOutro')!;
	const fsOutroScene = $derived(
		editorDoc.scenes.find((scene) => scene.id === 'freeSpinOutro') ?? fallbackFsOutro,
	);
	// HUD layer as editor scenes — when present the `<UI>` positions its HUD from
	// them (editable in the Invisible Editor); absent → coded layout.
	const hudBarScene = $derived(editorDoc.scenes.find((scene) => scene.id === 'hudBar'));
	const hudCornersScene = $derived(editorDoc.scenes.find((scene) => scene.id === 'hudCorners'));

	// Doc-driven background cover: the node in the `background` scene bound to the coded
	// `Background` component (id `bg`). When present the editor's cover scale/fit/stretch
	// drive the full-bleed background; absent → the component defaults to exact cover.
	const bgNode = $derived(
		editorDoc.scenes
			.find((scene) => scene.id === 'background')
			?.nodes.find((node) => node.id === 'bg' || node.bind?.component === 'Background'),
	);
	const backgroundCover = $derived(
		bgNode
			? {
					scale: backgroundCoverScale(bgNode),
					fit: backgroundFit(bgNode),
					stretch: backgroundCoverStretch(bgNode),
				}
			: undefined,
	);

	const context = getContext();

	// Phase B6.2 — register the 7 Borut button actions beside the value feed above.
	// Each entry LIFTS the coded HUD button's `onpress`/`disabled`/`active` logic
	// verbatim (from `components-ui-pixi`), wired to the SAME `context`
	// (`eventEmitter` + `stateXstateDerived`) and `state-shared` selectors the coded
	// buttons use, so a `button` componentInstance bound to one of these names behaves
	// identically to its coded counterpart. `boolSource` replays each live derived as
	// the registry's `BoolSource`. Nothing mounts a button instance yet (B6.3/B6.4),
	// so this is pure registration plumbing — no render change.
	registerComponentActions({
		// ButtonMenu — open the menu overlay. No disabled/active.
		menu: {
			onpress: () => {
				context.eventEmitter.broadcast({ type: 'soundPressGeneral' });
				stateUi.menuOpen = true;
			},
		},
		// ButtonBuyBonus — open the buy-bonus modal, or disable the active buy mode
		// when one is armed. Disabled while not idle; active while a buy mode is on.
		buyBonus: {
			onpress: () => {
				context.eventEmitter.broadcast({ type: 'soundPressGeneral' });
				if (stateBetDerived.activeBetMode()?.type === 'activate') {
					stateBet.activeBetModeKey = 'BASE';
				} else {
					stateModal.modal = { name: 'buyBonus' };
				}
			},
			disabled: boolSource(() => !context.stateXstateDerived.isIdle()),
			active: boolSource(() => stateBetDerived.activeBetMode()?.type === 'activate'),
		},
		// ButtonAutoSpin — open the auto-spin modal, or stop a running auto-spin.
		// Active while an auto-bet counter is live; disabled per its compound derived.
		autoSpin: {
			onpress: () => {
				context.eventEmitter.broadcast({ type: 'soundPressGeneral' });
				stateBetDerived.hasAutoBetCounter()
					? (stateBet.autoSpinsCounter = 0)
					: (stateModal.modal = { name: 'autoSpin' });
			},
			disabled: boolSource(() => {
				if (stateBet.isSpaceHold) return true;
				if (!context.stateXstateDerived.isIdle() && !stateBetDerived.hasAutoBetCounter())
					return true;
				if (!stateBetDerived.isBetCostAvailable()) return true;
				return false;
			}),
			active: boolSource(() => stateBetDerived.hasAutoBetCounter()),
		},
		// ButtonTurbo — toggle persistent turbo. Active while turbo is on; disabled
		// while space is held. (The stop-button turbo nuance is a `subscribeOnMount`
		// concern of the coded button, not part of the press/flag contract here.)
		turbo: {
			onpress: () => {
				context.eventEmitter.broadcast({ type: 'soundPressGeneral' });
				stateBetDerived.updateIsTurbo(!stateBet.isTurbo, { persistent: true });
			},
			disabled: boolSource(() => stateBet.isSpaceHold),
			active: boolSource(() => stateBet.isTurbo),
		},
		// ButtonIncrease — step the bet to the next larger option. Disabled while not
		// idle or already at the biggest option.
		increase: {
			onpress: () => {
				context.eventEmitter.broadcast({ type: 'soundPressGeneral' });
				const biggest =
					stateConfig.betAmountOptions[stateConfig.betAmountOptions.length - 1];
				const nextBigger = [...stateConfig.betAmountOptions]
					.sort((a, b) => a - b)
					.find((option) => option > stateBet.betAmount);
				stateBetDerived.setBetAmount(nextBigger || biggest);
			},
			disabled: boolSource(
				() =>
					!context.stateXstateDerived.isIdle() ||
					stateBet.betAmount ===
						stateConfig.betAmountOptions[stateConfig.betAmountOptions.length - 1],
			),
		},
		// ButtonDecrease — step the bet to the next smaller option. Disabled while not
		// idle or already at the smallest option.
		decrease: {
			onpress: () => {
				context.eventEmitter.broadcast({ type: 'soundPressGeneral' });
				const smallest = stateConfig.betAmountOptions[0];
				const nextSmaller = [...stateConfig.betAmountOptions]
					.sort((a, b) => b - a)
					.find((option) => option < stateBet.betAmount);
				stateBetDerived.setBetAmount(nextSmaller || smallest);
			},
			disabled: boolSource(
				() =>
					!context.stateXstateDerived.isIdle() ||
					stateBet.betAmount === stateConfig.betAmountOptions[0],
			),
		},
		// ButtonBetProvider — spin/stop. Roughly-correct B6.2 entry lifted from
		// `ButtonBetProvider`: idle → `bet()`, else → `stop()`; disabled only while
		// idle && the bet cost is unavailable.
		// B6.4: DEFER the full behaviour parity — the dynamic bet↔stop LABEL flip
		// (`getKey`/`ButtonBetKey`), the internal `stopDisabled` state machine
		// (`stopButtonClick`/`stopButtonEnable` subscriptions gating `stop()`), the
		// turbo/auto-bet stop nuances, and the `OnHotkey` Space binding all land in
		// B6.4. Do NOT build them here.
		spin: {
			onpress: () => {
				context.eventEmitter.broadcast({ type: 'soundPressBet' });
				if (context.stateXstateDerived.isIdle()) {
					if (stateBetDerived.activeBetMode()?.type === 'buy') {
						stateBet.activeBetModeKey = 'BASE';
					}
					context.eventEmitter.broadcast({ type: 'bet' });
				} else {
					if (stateBetDerived.hasAutoBetCounter()) stateBet.autoSpinsCounter = 0;
					context.eventEmitter.broadcast({ type: 'stopButtonClick' });
				}
			},
			disabled: boolSource(
				() =>
					context.stateXstateDerived.isIdle() && !stateBetDerived.isBetCostAvailable(),
			),
		},
	});

	// Move 3 Phase B — doc-driven loading splash. The `loading` scene holds one
	// `canvas`-space node bound to `LoadingScreen`; its transform repositions/rescales
	// the whole splash in-game. `LoadingScreen` keeps its coded mount + required
	// `onloaded` callback (it's an either/or with the game, so it can't be a generic
	// `bind`), so we mirror LayoutNodeView's canvas-space mount here and WRAP it.
	const loadingNode = $derived(
		editorDoc.scenes
			.find((scene) => scene.id === 'loading')
			?.nodes.find(
				(node) => node.id === 'loading-screen' || node.bind?.component === 'LoadingScreen',
			),
	);
	const loadingTransform = $derived(
		loadingNode
			? resolveTransform(loadingNode, context.stateLayoutDerived.layoutType())
			: undefined,
	);
	// Canvas-space placement, identical formula to LayoutNodeView: pin to a window edge
	// via `screenAnchor * canvasSize + (x, y)`, else use x/y verbatim. Default node
	// (x:0, y:0, no screenAnchor) → posX/posY = 0, so the container is a no-op.
	const loadingPos = $derived.by(() => {
		if (!loadingTransform) return { x: 0, y: 0 };
		const canvas = context.stateLayoutDerived.canvasSizes();
		return {
			x: loadingTransform.screenAnchor
				? loadingTransform.screenAnchor.x * canvas.width + loadingTransform.x
				: loadingTransform.x,
			y: loadingTransform.screenAnchor
				? loadingTransform.screenAnchor.y * canvas.height + loadingTransform.y
				: loadingTransform.y,
		};
	});

	onMount(() => {
		context.stateLayout.showLoadingScreen = true;
		void loadEditorScenes().then((doc) => {
			editorDoc = doc;
			setBoardOverride(findReelGridNode(doc) ?? null);
		});
	});

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

	<Background cover={backgroundCover} />

	{#if context.stateLayout.showLoadingScreen}
		<!--
			Move 3 Phase B — the doc-driven `loading` scene transform repositions/rescales
			the whole splash as one unit. Default node (x:0, y:0, no scale) → no-op container
			(x=0, y=0, scale/rotation/alpha undefined), byte-identical to the hardcoded mount.
			The coded mount + `onloaded` callback are kept verbatim (LoadingScreen is an
			either/or with the game, so it can't be a generic `bind`).
		-->
		<Container
			x={loadingPos.x}
			y={loadingPos.y}
			scale={loadingTransform?.scale}
			rotation={loadingTransform?.rotation}
			alpha={loadingTransform?.alpha}
			zIndex={loadingTransform?.zIndex}
		>
			<LoadingScreen onloaded={() => (context.stateLayout.showLoadingScreen = false)} />
		</Container>
	{:else}
		<ResumeBet />
		<!--
			The reason why <Sound /> is rendered after clicking the loading screen:
			"Autoplay with sound is allowed if: The user has interacted with the domain (click, tap, etc.)."
			Ref: https://developer.chrome.com/blog/autoplay
		-->
		<Sound />

		<LayoutScene scene={basegameScene} />

		<MainContainer>
			<BoardFrame />
			<Board />
			<Anticipations />
		</MainContainer>

		<UI hud={{ bar: hudBarScene, corners: hudCornersScene }}>
			{#snippet gameName(override)}
				<UiGameName name="LINES GAME" {override} />
			{/snippet}
			{#snippet logo(override)}
				<Text
					anchor={{ x: 1, y: 0 }}
					text={override?.text ?? 'ADD YOUR LOGO'}
					style={{
						fontFamily: 'proxima-nova',
						fontSize: REM * 1.5,
						fontWeight: '600',
						lineHeight: REM * 2,
						fill: 0xffffff,
						...override?.style,
					}}
				/>
			{/snippet}
		</UI>
		<LayoutScene scene={basegameOverlaysScene} />
		<LayoutScene scene={fsIntroScene} />
		{#if ['desktop', 'landscape'].includes(context.stateLayoutDerived.layoutType())}
			<LayoutScene scene={fsCounterScene} />
		{/if}
		<LayoutScene scene={fsOutroScene} />
		<InfoOverlay manifest={infoManifest} />

		<I18nTest />
		<SymbolDebug />
	{/if}
</App>

<Modals disabledModals={['payTable', 'gameRules']}>
	{#snippet version()}
		<GameVersion version="0.0.0" />
	{/snippet}
</Modals>
