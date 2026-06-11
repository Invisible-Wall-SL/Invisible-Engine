<script lang="ts">
	import { onMount } from 'svelte';

	import { EnablePixiExtension } from 'components-pixi';
	import { EnableHotkey, OnHotkey } from 'components-shared';
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
		i18nDerived,
	} from 'components-ui-pixi';
	import { GameVersion, Modals } from 'components-ui-html';
	import { LayoutScene } from 'engine-layout/svelte';
	import {
		registerBoundComponents,
		registerComponents,
		registerComponentValues,
		registerComponentActions,
		registerComponentSignals,
		HUD_READOUT_DEF,
		BUTTON_DEF,
		TEXT_BOX_DEF,
		FREE_SPIN_COUNTER_DEF,
		findReelGridNode,
		resolveTransform,
		backgroundCoverScale,
		backgroundCoverStretch,
		backgroundFit,
	} from 'engine-layout';

	import { infoManifest } from '../game/infoManifest';
	import { setBoardOverride } from '../game/stateGame.svelte';
	import { valueSource } from '../game/valueSource.svelte';
	import { boolSource } from '../game/boolSource.svelte';
	import { textSource } from '../game/textSource.svelte';
	import { eventSignal } from '../game/signalSource';
	import { HUD_BUTTON_INSTANCES } from '../game/editorFlags';
	import {
		fallbackEditorScenes,
		loadEditorScenes,
		registerBakedComponents,
		registerEditorTextLocalization,
	} from '../editor-scenes';
	import messagesMap from '../i18n/messagesMap';

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
	// `BUTTON_DEF` (§16.3 B6.3) is registered beside it so `getComponent('button')`
	// resolves — required for any `button` componentInstance to expand into its
	// `ButtonFrame`/`ButtonLabel` parts. No live scene carries a button instance yet
	// (B6.4 converts the HUD cluster), so this is pure registration — no render change.
	registerComponents({
		[HUD_READOUT_DEF.id]: HUD_READOUT_DEF,
		[BUTTON_DEF.id]: BUTTON_DEF,
		[TEXT_BOX_DEF.id]: TEXT_BOX_DEF,
		// Slice 1 of the FreeSpinCounter decomposition (additive): registering the def
		// makes `getComponent('freeSpinCounter')` resolve so a `componentInstance` of it
		// can expand into its frame/caption/value nodes. No live scene carries such an
		// instance — the `freeSpinCounter` scene still mounts the coded `FreeSpinCounter`
		// via its `bind` anchor — so this is pure registration with no render change.
		[FREE_SPIN_COUNTER_DEF.id]: FREE_SPIN_COUNTER_DEF,
	});
	// Build-time freeze: register any custom/edited ComponentDefs baked into the
	// bundle AFTER the built-ins, so a baked def (e.g. a customized `button` with an
	// author-added background node) shadows the coded one. No-op when not baked
	// (`apps/lines` dev) → parity. See docs/design/live-assets.md → "Layout-doc bake".
	registerBakedComponents();
	// Layout-doc text localization (§18): any doc text matching a catalog key —
	// code catalogs + the baked Localization-tool strings — renders translated.
	registerEditorTextLocalization(messagesMap);
	registerComponentValues({
		balance: valueSource(() => stateBet.balanceAmount),
		win: valueSource(() => stateBet.winBookEventAmount),
		bet: valueSource(() => stateBetDerived.betCost()),
		// Composed-string feed for the `freeSpinCounter` def's `value` param — the live
		// "current OF total" the coded `FreeSpinCounter` shows, sourced from the SAME
		// `stateUi` fields the coded overlay reads (set in bookEventHandlerMap). A string
		// source, so it renders verbatim through the text path. Unwired until a
		// `freeSpinCounter` componentInstance is placed (parity with the coded mount).
		freeSpins: textSource(
			() => `${stateUi.freeSpinCounterCurrent} OF ${stateUi.freeSpinCounterTotal}`,
		),
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

	// Component signal feed (§8.5) — the EVENT sibling of the value/action feeds
	// above. Maps the game's win presentation events → signal NAMES from the
	// catalog, so a placed `componentInstance` whose `kind:'spine'` node carries
	// `cues:[{ signal:'win'|'bigWin', animation, loop }]` plays that animation when
	// these fire. Registration alone is a no-op: it has NO effect until such a cued
	// component instance is placed in a scene (pure parity with the doc-less boot) —
	// `<ComponentInstance>` only subscribes a signal a cue names. `win` fires when the
	// win presentation begins (`winShow`); `bigWin` fires only on the `'big'` win-level
	// tier (covers big/superwin/mega/epic/max — see game/winLevelMap.ts).
	registerComponentSignals({
		win: eventSignal((run) => context.eventEmitter.subscribe({ winShow: () => run() })),
		bigWin: eventSignal((run) =>
			context.eventEmitter.subscribe({
				winUpdate: (e) => {
					if (e.winLevelData.type === 'big') run();
				},
			}),
		),
	});

	// §16.4 B6.4 — the spin/stop state machine, lifted VERBATIM from
	// `ButtonBetProvider.svelte` so the parametric `spin` action behaves identically
	// to the coded `ButtonBet`. `stopDisabled` is the internal latch the coded
	// provider keeps: a `stopButtonClick` arms it (stop is then a no-op until the game
	// re-enables it via `stopButtonEnable`), so a double-tap can't fire two stops.
	// `getSpinKey()` is `ButtonBetProvider.getKey` byte-for-byte; the action's
	// `disabled`/`label` sources below derive from it, exactly as `ButtonBet`'s
	// `UiSprite` grey + `Text` caption derive from the coded `key`.
	let stopDisabled = $state(false);
	context.eventEmitter.subscribeOnMount({
		stopButtonClick: () => (stopDisabled = true),
		stopButtonEnable: () => (stopDisabled = false),
	});
	const getSpinKey = (): 'spin_default' | 'spin_disabled' | 'stop_default' | 'stop_disabled' => {
		if (context.stateXstateDerived.isIdle()) {
			if (!stateBetDerived.isBetCostAvailable()) return 'spin_disabled';
			return 'spin_default';
		}

		if (!context.stateXstateDerived.isIdle()) {
			if (stopDisabled) return 'stop_disabled';
			if (stateBetDerived.hasAutoBetCounter()) return 'stop_default';
			if (stateBet.isTurbo) return 'stop_disabled';
			return 'stop_default';
		}

		return 'spin_default';
	};

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
				const biggest = stateConfig.betAmountOptions[stateConfig.betAmountOptions.length - 1];
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
		// ButtonBetProvider + ButtonBet — spin/stop, now a FAITHFUL replication (B6.4).
		// `onpress` is `ButtonBetProvider.onpress` byte-for-byte: sound, then idle →
		// `bet()` (reset an armed buy-mode to BASE, broadcast `bet`), else → `stop()`
		// (gated on `!stopDisabled`, reset an auto-bet counter, broadcast
		// `stopButtonClick`). `disabled`/`label` derive from `getSpinKey()` (=
		// `ButtonBetProvider.getKey`) exactly as `ButtonBet`'s coded `UiSprite` grey +
		// `Text` caption do: the button greys on the `*_disabled` keys, and the caption
		// is `bet()` on the `spin_*` keys else `stop()`. `boolSource`/`textSource` replay
		// those live deriveds to the bound `button` instance. The Space hotkey the coded
		// `ButtonBet` mounts is replaced in the markup below, gated on the same flag.
		spin: {
			onpress: () => {
				context.eventEmitter.broadcast({ type: 'soundPressBet' });

				if (context.stateXstateDerived.isIdle()) {
					// bet()
					if (stateBetDerived.activeBetMode()?.type === 'buy') stateBet.activeBetModeKey = 'BASE';
					context.eventEmitter.broadcast({ type: 'bet' });
				} else {
					// stop() — the `stopDisabled` latch makes a second tap a no-op.
					if (!stopDisabled) {
						if (stateBetDerived.hasAutoBetCounter()) stateBet.autoSpinsCounter = 0;
						context.eventEmitter.broadcast({ type: 'stopButtonClick' });
					}
				}
			},
			disabled: boolSource(() => ['spin_disabled', 'stop_disabled'].includes(getSpinKey())),
			label: textSource(() =>
				getSpinKey().startsWith('spin_') ? i18nDerived.bet() : i18nDerived.stop(),
			),
		},
	});

	// §16.4 B6.4 — replacement Space hotkey for the spin button. Once the cluster is
	// flipped to `componentInstance(button)` nodes (`HUD_BUTTON_INSTANCES`), the coded
	// `ButtonBet` (and its own `<OnHotkey hotkey="Space">`) is no longer mounted, so
	// Space would stop working. This mirrors `ButtonBet`'s binding — `disabled` =
	// `!isBetCostAvailable()` (the coded provider's hotkey-disabled), `onpress` = the
	// SAME spin handler the action registers (re-derived here so it reads the same
	// `stopDisabled`/state). GATED on the flag so it never double-fires alongside the
	// coded button's own hotkey while the cluster is still coded (parity when OFF).
	const spinHotkeyDisabled = $derived(!stateBetDerived.isBetCostAvailable());
	const spinHotkeyPress = () => {
		context.eventEmitter.broadcast({ type: 'soundPressBet' });
		if (context.stateXstateDerived.isIdle()) {
			if (stateBetDerived.activeBetMode()?.type === 'buy') stateBet.activeBetModeKey = 'BASE';
			context.eventEmitter.broadcast({ type: 'bet' });
		} else if (!stopDisabled) {
			if (stateBetDerived.hasAutoBetCounter()) stateBet.autoSpinsCounter = 0;
			context.eventEmitter.broadcast({ type: 'stopButtonClick' });
		}
	};

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

		<!--
			§16.4 B6.4 — replacement Space hotkey for the flipped spin button. Mounted
			ONLY when `HUD_BUTTON_INSTANCES` is on (the flip suppresses the coded
			`ButtonBet`'s own `<OnHotkey>`); OFF ⇒ not rendered, so the coded hotkey is the
			sole Space binding (parity, no double-fire). Mirrors `ButtonBet`'s binding.
		-->
		{#if HUD_BUTTON_INSTANCES}
			<OnHotkey hotkey="Space" disabled={spinHotkeyDisabled} onpress={spinHotkeyPress} />
		{/if}

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
