<script lang="ts">
	import { onMount } from 'svelte';

	import { EnablePixiExtension, DebugStage } from 'components-pixi';
	import { EnableHotkey, OnHotkey } from 'components-shared';
	import { MainContainer } from 'components-layout';
	import { App, Container, Text, REM } from 'pixi-svelte';
	import {
		stateBet,
		stateBetDerived,
		stateConfig,
		stateMessage,
		stateModal,
		stateUi,
		setUiFeatures,
		UI_FEATURES_UK,
	} from 'state-shared';
	import { numberToCurrencyString, bookEventAmountToCurrencyString } from 'utils-shared/amount';

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
		LoadingBar,
		i18nDerived,
	} from 'components-ui-pixi';
	import { GameVersion, Modals, DebugMenu } from 'components-ui-html';
	import { LayoutScene } from 'engine-layout/svelte';
	import {
		registerBoundComponents,
		registerComponents,
		registerComponentValues,
		registerComponentActions,
		registerComponentVisibility,
		registerComponentSignals,
		registerFontCatalog,
		mergeBakedFontCatalog,
		registerBakedWebFonts,
		bakedFontAssets,
		HUD_READOUT_DEF,
		BUTTON_DEF,
		TEXT_BOX_DEF,
		FREE_SPIN_COUNTER_DEF,
		INFO_BAR_DEF,
		LOADING_INTRO_DEF,
		TRANSITION_DEF,
		FREE_SPIN_INTRO_VISUAL_DEF,
		FREE_SPIN_OUTRO_VISUAL_DEF,
		findReelGridNode,
		resolveTransform,
		backgroundCoverScale,
		backgroundCoverStretch,
		backgroundFit,
	} from 'engine-layout';
	import type { Scene } from 'engine-layout';

	import { infoManifest } from '../game/infoManifest';
	import { setBoardOverride, stateGame } from '../game/stateGame.svelte';
	import { valueSource } from '../game/valueSource.svelte';
	import { boolSource } from '../game/boolSource.svelte';
	import { textSource } from '../game/textSource.svelte';
	import { eventSignal } from '../game/signalSource';
	import { HUD_BUTTON_INSTANCES } from '../game/editorFlags';
	import {
		bakedEditorArtAssets,
		bakedFontCatalog,
		bakedFontSrcBase,
		bakedSymbolAssets,
		fallbackEditorScenes,
		isRuntimeBundleActive,
		loadEditorScenes,
		registerBakedComponents,
		registerEditorTextLocalization,
	} from '../editor-scenes';
	import messagesMap from '../i18n/messagesMap';

	import { getContext } from '../game/context';
	import { stateApp } from '../game/stateApp';
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
	import FreeSpinIntroGate from './FreeSpinIntroGate.svelte';
	import FreeSpinIntroVisual from './FreeSpinIntroVisual.svelte';
	import FreeSpinCounter from './FreeSpinCounter.svelte';
	import FreeSpinOutro from './FreeSpinOutro.svelte';
	import FreeSpinOutroGate from './FreeSpinOutroGate.svelte';
	import FreeSpinOutroVisual from './FreeSpinOutroVisual.svelte';
	import SpecialBook from './SpecialBook.svelte';
	import Transition from './Transition.svelte';
	import I18nTest from './I18nTest.svelte';

	// Invisible Debug — register this game's debug tools (symbol overlay + win-state
	// probe). Dynamic-imported only under the build switch so the tools + their
	// component modules tree-shake out of a player build (docs/design/invisible-debug-framework.md).
	if (__IE_DEBUG__) {
		void import('../game/debugTools');
	}

	// Live runtime (Invisible Game Maker, Phase 0). `stateApp.assets` was built at
	// import time by `createApp` (`game/stateApp.ts`), BEFORE `+layout.ts`'s `load()`
	// fetched the runtime bundle — so its editor-art/font/symbol entries were empty.
	// Now that the bundle is ready, re-merge those entries (now resolving to the
	// launcher's absolute `/api/deploy` URLs) so `AssetsLoader` (mounts below) loads
	// them. The registration KEYS are identical to the baked path, so `LayoutNodeView`
	// lookups resolve unchanged. Gated on `isRuntimeBundleActive()` ⇒ a complete no-op
	// for baked + live-doc dev (parity); `stateApp.assets` is `$state`, so the spread
	// reactively refreshes `AssetsLoader`'s pre/post asset lists before first paint.
	if (isRuntimeBundleActive()) {
		stateApp.assets = {
			...stateApp.assets,
			...bakedEditorArtAssets(),
			...bakedFontAssets(bakedFontCatalog(), bakedFontSrcBase()),
			...bakedSymbolAssets(),
		};
	}

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
		// §17 Phase 3 — the intro split: the full-screen GATE (dim + press + round-await)
		// and the board-relative VISUAL (the `freeSpinIntroVisual` componentInstance mounts
		// this, positioned by its node). Registered for the ON path; the OFF composer
		// `FreeSpinIntro` mounts both itself.
		FreeSpinIntroGate,
		FreeSpinIntroVisual,
		FreeSpinCounter,
		FreeSpinOutro,
		// §17 Phase 3 — the outro split (gate + positionable visual), mirroring the intro.
		FreeSpinOutroGate,
		FreeSpinOutroVisual,
		// Special-Book bonus overlay — board-centred, self-shows/animates off the
		// `specialBookReveal`/`specialBookHide` book events; the doc owns only placement.
		SpecialBook,
		// The ONE coded part of the `loadingIntro` splash def — the masked progress
		// fill the static node model can't express (the logo + percentage around it are
		// editor-native nodes). Reads `loadingProgress`/`loaded` off `stateApp` + its
		// frame/size params off the instance, hiding itself once loading completes.
		LoadingBar,
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
		// The FreeSpinCounter decomposition: registering the def makes
		// `getComponent('freeSpinCounter')` resolve so the `freeSpinCounter` scene's
		// `componentInstance` (see `referenceLayouts/lines.ts`) expands into its
		// frame/caption/value nodes. This IS the live render — the coded `FreeSpinCounter`
		// stays registered only as a fallback (no longer referenced by the scene).
		[FREE_SPIN_COUNTER_DEF.id]: FREE_SPIN_COUNTER_DEF,
		// The InfoBar decomposition: registering the def makes `getComponent('infoBar')`
		// resolve so an `infoBar` componentInstance expands into its background + message
		// nodes. The editor-native replacement for the coded HTML `MessageToast`; fed by
		// the `message` value source + gated on `messageShow` (registered below).
		[INFO_BAR_DEF.id]: INFO_BAR_DEF,
		// The loading/intro splash decomposition: registering the def makes
		// `getComponent('loadingIntro')` resolve so a `loadingIntro` componentInstance
		// expands into its logo + bound `LoadingBar` + percentage nodes. A placeable
		// building block for composing the splash in the editor; the coded
		// `LoadingScreen` still owns the press-to-continue/transition flow + `onloaded`.
		[LOADING_INTRO_DEF.id]: LOADING_INTRO_DEF,
		// §17.4 step 4 — the Transition migrated off its direct coded `bind` to an
		// editor-owned `componentInstance`. Registering the def makes
		// `getComponent('transition')` resolve so a `transition` instance (placed only when
		// `TRANSITION_INSTANCE` is on, see `editor-scenes.ts`) expands into its bound coded
		// `Transition` part, now positioned by the editor node. Pure registration otherwise
		// (no scene references it ⇒ no render change — parity).
		[TRANSITION_DEF.id]: TRANSITION_DEF,
		// §17 Phase 3 — makes `getComponent('freeSpinIntroVisual')` resolve so the
		// `freeSpinIntroVisual` `game`-space scene (emitted only when the overlays are split)
		// expands into its bound `FreeSpinIntroVisual` part, positioned by the editor node.
		[FREE_SPIN_INTRO_VISUAL_DEF.id]: FREE_SPIN_INTRO_VISUAL_DEF,
		// §17 Phase 3 — same for the outro's positionable visual.
		[FREE_SPIN_OUTRO_VISUAL_DEF.id]: FREE_SPIN_OUTRO_VISUAL_DEF,
	});
	// §9.4 — register the game's bitmap-font catalog so the engine layout text path
	// renders `<BitmapText>` (pixi's BitmapFont blitter) for a text node whose
	// `style.fontFamily` names one of these families, instead of a system-font
	// `<Text>`. The names are the BMFont `<info face>` each `.xml` installs under (the
	// runtime sibling of the editor's `/api/editor/fonts` catalog). Web fonts need no
	// entry — absent ⇒ `<Text>` ⇒ parity. No live scene text node references a bitmap
	// family — the `freeSpinCounter` scene's componentInstance renders its caption/value
	// through `<BitmapText>` because `gold` is registered below as a bitmap family, which
	// gives the engine-layout counter parity with the old coded `FreeSpinCounter`.
	// The game's built-in bitmap fonts (shipped in `assets.ts`). Merged with the
	// baked per-project font catalog (Font Maker output, frozen into the bundle by
	// `bake-editor-doc.mjs`) via the engine's shared `mergeBakedFontCatalog` so an
	// editor-authored font reaches the shipped game; a baked font with the same
	// family name overrides a built-in. Bitmap fonts load as `{type:'font'}` assets
	// (`bakedFontAssets` in `stateApp.ts`); web fonts load via `registerBakedWebFonts`.
	const builtinFonts = [
		{ id: 'gold', name: 'gold', kind: 'bitmap' as const, folder: '' },
		{ id: 'goldblur', name: 'goldblur', kind: 'bitmap' as const, folder: '' },
		{ id: 'silver', name: 'silver', kind: 'bitmap' as const, folder: '' },
		{ id: 'purple', name: 'purple', kind: 'bitmap' as const, folder: '' },
	];
	registerFontCatalog(mergeBakedFontCatalog(builtinFonts, bakedFontCatalog()));
	// Load any baked WEB fonts (FontFace) so a `<Text>` renders the real face. The
	// src base is the default `assets/` for baked/dev (parity); in live runtime mode
	// it's the launcher's absolute `/api/deploy` base so cross-origin fonts resolve.
	void registerBakedWebFonts(bakedFontCatalog(), bakedFontSrcBase());
	// Build-time freeze: register any custom/edited ComponentDefs baked into the
	// bundle AFTER the built-ins, so a baked def (e.g. a customized `button` with an
	// author-added background node) shadows the coded one. No-op when not baked
	// (`apps/lines` dev) → parity. See docs/design/live-assets.md → "Layout-doc bake".
	registerBakedComponents();
	// Layout-doc text localization (§18): any doc text matching a catalog key —
	// code catalogs + the baked Localization-tool strings — renders translated.
	registerEditorTextLocalization(messagesMap);
	registerComponentValues({
		balance: valueSource(() => stateBet.balanceAmount, numberToCurrencyString),
		win: valueSource(() => stateBet.winBookEventAmount, bookEventAmountToCurrencyString),
		// `totalWin` is the round/feature win total — the value a free-spin OUTRO shows. The
		// engine tracks one win-meter amount (`winBookEventAmount`), which by the outro holds
		// the accumulated feature total, so `totalWin` reads the same field as `win` but is the
		// clearly-labelled param to bind an outro readout to (catalog entry was previously
		// declared but never fed → binding it showed nothing).
		totalWin: valueSource(() => stateBet.winBookEventAmount, bookEventAmountToCurrencyString),
		bet: valueSource(() => stateBetDerived.betCost(), numberToCurrencyString),
		// Plain count of free spins awarded — the INTRO headline ("10"). Set early in the
		// `freeSpinTrigger` handler (before the intro shows) so it's populated while the intro
		// is on screen, unlike the `freeSpins` counter string which is "current OF total".
		freeSpinsWon: valueSource(() => stateUi.freeSpinCounterTotal),
		// Composed-string feed for the `freeSpinCounter` def's `value` param — the live
		// "current OF total" the counter shows, sourced from the SAME `stateUi` fields the
		// old coded overlay read (set in bookEventHandlerMap). A string source, so it
		// renders verbatim through the text path. The `freeSpinCounter` scene's
		// componentInstance binds its value node to this via `params.source: 'freeSpins'`.
		freeSpins: textSource(
			() => `${stateUi.freeSpinCounterCurrent} OF ${stateUi.freeSpinCounterTotal}`,
		),
		// Composed-string feed for the `infoBar` def's `value` param — the transient
		// `showMessage` toast text (e.g. "Win $1.00 — 2 of a kind"). A string source, so
		// it renders verbatim through the text path. The `infoBar` scene's componentInstance
		// binds its message node to this via `params.source: 'message'`. Empty until a game
		// calls `showMessage`, gated invisible by `messageShow` below.
		message: textSource(() => stateMessage.current?.text ?? ''),
		// Numeric feed for the `loadingIntro` def's percentage readout — the boot
		// asset-load progress 0–100 off `stateApp` (the SAME field the coded
		// `LoadingProgress` mask reads). The formatter renders it "73%" so a plain text
		// node bound to `value` shows the percentage; the `loadingIntro` instance binds
		// its percent node to this via `params.source: 'loadingProgress'`.
		//
		// The formatter yields '' once `stateApp.loaded` flips, so the readout BLANKS at
		// load-complete — vanishing in lockstep with the coded `LoadingBar`'s own
		// `{#if !loaded}`, instead of the "100%" lingering until press-to-continue. This
		// gates from the LIVE feed (read here, reactive through `ParamReadoutText`) rather
		// than a node attribute, so it reaches even a BAKED/customised `loadingIntro` def
		// whose frozen percent node a coded-def change can't touch.
		loadingProgress: valueSource(
			() => stateApp.loadingProgress,
			(n) => (stateApp.loaded ? '' : `${Math.round(n)}%`),
		),
	});
	// Visibility feed — register the boolean source that gates the `freeSpinCounter`
	// componentInstance: `stateUi.freeSpinCounterShow` is true only
	// during free spins. The scene's instance sets `visibleSource:
	// 'freeSpinCounterShow'`, so the whole counter hides while that source is false —
	// the engine-layout equivalent of the coded `FreeSpinCounter`'s book-event
	// self-show/hide.
	registerComponentVisibility({
		freeSpinCounterShow: boolSource(() => stateUi.freeSpinCounterShow),
		// Gates the `infoBar` componentInstance: true while a transient `showMessage` toast
		// is active, so the bar shows only when there's a message and hides on the existing
		// auto-clear — the engine-layout equivalent of the coded HTML `MessageToast`.
		messageShow: boolSource(() => stateMessage.current !== null),
		// Gates loading-only content (e.g. the `loadingIntro` percentage readout): true
		// only while the boot asset-load is in flight, so it hides the moment loading
		// completes — the engine-layout equivalent of the coded splash's `{#if !loaded}`.
		assetsLoading: boolSource(() => !stateApp.loaded),
		// Round-lifecycle gates — bind a whole authored SCREEN (`Scene.visibleSource`) or a
		// single component so it shows ONLY during that presentation phase, the engine-layout
		// equivalent of the coded intro/outro/win gates' book-event self-show/hide. The
		// intro/outro/win flags are set in `bookEventHandlerMap` next to the matching event
		// broadcasts; free-game / base-game derive from `gameType`.
		freeSpinIntroShow: boolSource(() => stateUi.freeSpinIntroShow),
		freeSpinOutroShow: boolSource(() => stateUi.freeSpinOutroShow),
		freeGameShow: boolSource(() => stateGame.gameType === 'freegame'),
		baseGameShow: boolSource(() => stateGame.gameType === 'basegame'),
		winShow: boolSource(() => stateUi.winShow),
		bigWinShow: boolSource(() => stateUi.bigWinShow),
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
	// Reel z-order: the editor lets you order the `reelGrid` placeholder among the
	// basegame layers, but the real <Board/> mounts in its OWN trailing MainContainer
	// (a separate Pixi container), so it always paints over the whole scene — no editor
	// ordering can put a layer above it. Split the scene at the top-level reelGrid index
	// into a below-reel pass and an above-reel pass; the board renders BETWEEN them, so
	// layers authored after the reel now stack above it (matching the editor preview).
	// The board subtree is left untouched. No top-level reelGrid → single pass, byte-
	// identical to before (parity for doc-less boot / nested reelGrid).
	const reelGridIndex = $derived(basegameScene.nodes.findIndex((node) => node.kind === 'reelGrid'));
	const basegameBelowReel = $derived(
		reelGridIndex < 0
			? basegameScene
			: { ...basegameScene, nodes: basegameScene.nodes.slice(0, reelGridIndex) },
	);
	const basegameAboveReel = $derived(
		reelGridIndex < 0
			? undefined
			: { ...basegameScene, nodes: basegameScene.nodes.slice(reelGridIndex + 1) },
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
	// §17 Phase 3 — the board-relative VISUAL scene of the split intro (`game`-space, so
	// <LayoutScene> wraps it in its own MainContainer for main-scaling). Present only when
	// the overlays are split (the `FREE_SPIN_OVERLAY_INSTANCES` fallback emits it, or the
	// owner authored it in the editor); `undefined` otherwise ⇒ the mount renders nothing
	// (the OFF composer `FreeSpinIntro` draws the visual itself). Parity-safe.
	const fsIntroVisualScene = $derived(
		editorDoc.scenes.find((scene) => scene.id === 'freeSpinIntroVisual') ??
			fallbackEditorScenes.scenes.find((s) => s.id === 'freeSpinIntroVisual'),
	);
	const fallbackFsCounter = fallbackEditorScenes.scenes.find((s) => s.id === 'freeSpinCounter')!;
	const fsCounterScene = $derived(
		editorDoc.scenes.find((scene) => scene.id === 'freeSpinCounter') ?? fallbackFsCounter,
	);
	const fallbackFsOutro = fallbackEditorScenes.scenes.find((s) => s.id === 'freeSpinOutro')!;
	const fsOutroScene = $derived(
		editorDoc.scenes.find((scene) => scene.id === 'freeSpinOutro') ?? fallbackFsOutro,
	);
	// §17 Phase 3 — the board-relative VISUAL scene of the split outro (`game`-space).
	// Present only when the overlays are split; `undefined` otherwise ⇒ no mount (the OFF
	// composer `FreeSpinOutro` draws the visual itself). Parity-safe.
	const fsOutroVisualScene = $derived(
		editorDoc.scenes.find((scene) => scene.id === 'freeSpinOutroVisual') ??
			fallbackEditorScenes.scenes.find((s) => s.id === 'freeSpinOutroVisual'),
	);
	const fallbackSpecialBook = fallbackEditorScenes.scenes.find((s) => s.id === 'specialBook')!;
	const specialBookScene = $derived(
		editorDoc.scenes.find((scene) => scene.id === 'specialBook') ?? fallbackSpecialBook,
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

		// A round is in progress. Autoplay-only STOP (mirrors `ButtonBetProvider`): the
		// button only acts as STOP to cancel an autoplay sequence; a single bet's roll
		// is inert (and shows the rotating `imageSpinning` frame when one is authored).
		if (stateBetDerived.hasAutoBetCounter()) {
			return stopDisabled ? 'stop_disabled' : 'stop_default';
		}

		return 'spin_disabled';
	};
	// Reels rolling on a plain bet (NOT an autoplay sequence) → spin the frame.
	const isSpinning = () =>
		context.stateXstateDerived.isPlaying() && !stateBetDerived.hasAutoBetCounter();

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
			spinning: boolSource(isSpinning),
			label: textSource(() =>
				getSpinKey().startsWith('spin_') ? i18nDerived.bet() : i18nDerived.stop(),
			),
		},
	});

	// §16.4 B6.4 — replacement Space hotkey for the spin button. Once the cluster is
	// flipped to `componentInstance(button)` nodes (`HUD_BUTTON_INSTANCES`), the coded
	// `ButtonBet` (and its own `<OnHotkey hotkey="Space">`) is no longer mounted, so
	// Space would stop working. This mirrors `ButtonBet`'s binding — `disabled` tracks
	// the spin key (inert during a single roll, enabled only to cancel autoplay), so
	// Space can't re-fire mid-roll; `onpress` = the SAME spin handler the action
	// registers (re-derived here so it reads the same `stopDisabled`/state). GATED on
	// the flag so it never double-fires alongside the coded button's own hotkey while
	// the cluster is still coded (parity when OFF).
	const spinHotkeyDisabled = $derived(['spin_disabled', 'stop_disabled'].includes(getSpinKey()));
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
	const loadingScene = $derived(editorDoc.scenes.find((scene) => scene.id === 'loading'));
	const loadingNode = $derived(
		loadingScene?.nodes.find(
			(node) => node.id === 'loading-screen' || node.bind?.component === 'LoadingScreen',
		),
	);
	// Authored splash VISUAL: every loading-scene node EXCEPT the inert `LoadingScreen`
	// bind anchor (which the game renders as the coded splash, not as a scene node). When
	// the author placed real content here (a `loadingIntro` component, a logo, …) we hand
	// those nodes to `<LoadingScreen authoredScene>` so they ARE the splash visual; the
	// coded logo+progress is suppressed and only the press-to-continue/transition shell
	// stays coded. No authored content ⇒ `undefined` ⇒ the coded splash renders unchanged
	// (parity for un-authored docs). The `loading-screen` anchor is dropped so it can't
	// double-draw (it's inert in-game anyway — `LoadingScreen` isn't a bound component).
	const authoredLoadingScene = $derived.by((): Scene | undefined => {
		if (!loadingScene) return undefined;
		const nodes = loadingScene.nodes.filter(
			(node) => node.id !== 'loading-screen' && node.bind?.component !== 'LoadingScreen',
		);
		return nodes.length > 0 ? { ...loadingScene, nodes } : undefined;
	});
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
			// Game-level settings (§ Game Settings): apply the authored speed-feature
			// toggles. A `UK` jurisdiction forces every speed feature off (overrides the
			// individual flags); otherwise the per-feature overrides merge in. Absent
			// settings ⇒ engine defaults (all on) — parity for un-authored docs.
			if (doc.settings?.jurisdiction === 'UK') setUiFeatures(UI_FEATURES_UK);
			else if (doc.settings?.features) setUiFeatures(doc.settings.features);
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
		{#if authoredLoadingScene}
			<!--
				AUTHORED splash: the editor's `loading` scene carries placed visual content
				(a `loadingIntro` component = logo + progress + percentage, a bare logo, ...),
				so it IS the splash. `<LoadingScreen authoredScene>` renders those nodes (each
				self-positions via its own canvas-space transform) and keeps only the coded
				press-to-continue / transition / `onloaded` shell. The `loadingIntro` bar
				self-hides on `stateApp.loaded`, then the coded press-to-continue appears.
			-->
			<LoadingScreen
				authoredScene={authoredLoadingScene}
				onloaded={() => (context.stateLayout.showLoadingScreen = false)}
			/>
		{:else}
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
		{/if}
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

		<!-- `basegameScene` is `game` space → <LayoutScene> self-wraps in its own
			 MainContainer. Do NOT wrap it again here (that double-scales it).
			 Split at the reelGrid placeholder: below-reel layers, then the board, then
			 above-reel layers (so editor stacking order around the reel is honored). -->
		<LayoutScene scene={basegameBelowReel} />

		<MainContainer>
			<BoardFrame />
			<Board />
			<Anticipations />
		</MainContainer>

		{#if basegameAboveReel && basegameAboveReel.nodes.length}
			<LayoutScene scene={basegameAboveReel} />
		{/if}

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
		{#if fsIntroVisualScene && fsIntroVisualScene.nodes.length}
			<LayoutScene scene={fsIntroVisualScene} />
		{/if}
		{#if ['desktop', 'landscape'].includes(context.stateLayoutDerived.layoutType())}
			<LayoutScene scene={fsCounterScene} />
		{/if}
		<LayoutScene scene={fsOutroScene} />
		{#if fsOutroVisualScene && fsOutroVisualScene.nodes.length}
			<LayoutScene scene={fsOutroVisualScene} />
		{/if}
		<LayoutScene scene={specialBookScene} />
		<InfoOverlay manifest={infoManifest} />

		<I18nTest />
	{/if}

	<DebugStage />
</App>

<Modals disabledModals={['payTable', 'gameRules']}>
	{#snippet version()}
		<GameVersion />
	{/snippet}
</Modals>

<GameVersion fixed />

<DebugMenu />
