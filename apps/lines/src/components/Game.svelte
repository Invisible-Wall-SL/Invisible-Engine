<script lang="ts">
	import { onMount } from 'svelte';

	import { EnablePixiExtension, DebugStage } from 'components-pixi';
	import { EnableHotkey, EnableSpaceHold, OnHotkey } from 'components-shared';
	import { MainContainer } from 'components-layout';
	import { App, Container, Text } from 'pixi-svelte';
	import {
		stateBet,
		stateBetDerived,
		stateConfig,
		stateMeta,
		stateMetaDerived,
		stateMessage,
		stateModal,
		stateSound,
		stateUi,
		stateFullscreen,
		toggleFullscreen,
		isFullscreenSupported,
		setUiFeatures,
		hasContinuePress,
		UI_FEATURES_UK,
	} from 'state-shared';
	import { numberToCurrencyString, bookEventAmountToCurrencyString } from 'utils-shared/amount';
	import {
		getSpinButtonKey,
		getSpinPressSound,
		isCelebrationLocked,
		isSpinButtonDisabled,
		isSpinButtonSpinning,
		runSpinOrSlamStop,
		type SpinButtonKey,
	} from 'utils-shared/spinStop';
	import { setSpinButtonHoldSource, spinButtonHold } from 'utils-shared/spinHold';

	import {
		UI,
		HudGameName,
		HudLogo,
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
	import {
		GameVersion,
		Modals,
		DebugMenu,
		registerBuyFeature,
		registerHudMenus,
		BuyBonusConfirm,
		RoundStartConfirm,
	} from 'components-ui-html';
	import {
		LayoutScene,
		FlowMount,
		FlowScreenMount,
		FlowFade,
		FlowV2Mount,
		BuyFeatureScreen,
	} from 'engine-layout/svelte';
	import type { FlowEntranceTransition, MountedContainerRef } from 'engine-layout/svelte';
	import {
		registerBoundComponents,
		registerComponents,
		registerEffects,
		registerFlipbooks,
		registerRigFlipbooks,
		registerRigFx,
		registerComponentValues,
		registerComponentActions,
		registerComponentVisibility,
		registerFlowComplete,
		registerFlowValueSource,
		registerFlowPress,
		registerComponentSignals,
		registerInlineImageResolver,
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
		WIN_DEF,
		EXPANDING_SYMBOL_DEF,
		FREE_SPIN_INTRO_SYMBOL_REVEAL_DEF,
		TAP_TO_CONTINUE_DEF,
		LOADING_BAR_DEF,
		HOLD_AND_WIN_COMPONENTS,
		findReelGridNode,
		backgroundCoverAnchor,
		backgroundCoverScale,
		backgroundCoverStretch,
		backgroundFit,
		backgroundScenes,
		hasAuthoredBackground,
		hasAuthoredBookReveal,
		boardGlowScene,
		hasAuthoredBoardGlow,
		extraMountScenes,
		authoredHudScenes,
		fullReplaceHudScenes,
		CODED_HUD_SCENE_IDS,
		hasAuthoredHud,
		sceneLayerZIndex,
		isSceneLayerPinned,
		LAYER_BAND_BACKGROUND,
		LAYER_BAND_BACKGROUND_CODED,
		LAYER_BAND_FLIGHTS,
		LAYER_BAND_INPUT_MASK,
		LAYER_BAND_TAKEOVER,
		LAYER_BAND_TOP,
		LAYER_BAND_WIN_PRESENTATION,
		sceneByRole,
		loadingSceneId,
		basegameSceneId,
		collectComponentIds,
		buyFeatureSceneId,
		buyConfirmSceneId,
		betMenuSceneId,
		autoSpinSceneId,
		formatWinText,
		registerSceneCameraTransform,
		sceneInActiveModes,
		hudScenesForMode,
	} from 'engine-layout';
	import type { Scene } from 'engine-layout';

	import {
		publishSoundBindings,
		publishWinPresentation,
		getActiveGameConfig,
		resetGameConfigCache,
		captureServerGrid,
		warnOnGameConfigIssues,
		warnOnServerGridMismatch,
		warnOnServerPaytableMismatch,
	} from '../game/gameConfig';
	import { paytable } from '../game/paytable';
	import {
		activeModeHud,
		activeModeIds,
		modeHudIds,
		setModeTransitionPresenter,
	} from '../game/stateModes.svelte';
	import { syncBetModeMeta } from '../game/betModeMeta';
	import { infoManifest } from '../game/infoManifest';
	import { getActiveSymbolInfoMap, resetSymbolMapCache } from '../game/symbolMap';
	import { createLinesFlow, linesValueResolver, type LinesFlow } from '../game/flowRuntime.svelte';
	import {
		setFlowInterpreter,
		completeActiveScreen,
		emitFlowSignal,
		hasFlowAction,
		emitFlowAction,
	} from '../game/flowInterpreterHolder';
	import { createLinesFlowV2, type LinesFlowV2 } from '../game/flowV2Runtime.svelte';
	import {
		setFlowV2,
		getFlowV2,
		dispatchFlowV2Complete,
		dispatchFlowV2Event,
		resolveFlowV2Press,
	} from '../game/flowV2InterpreterHolder';
	import { resolveCelebrationLock } from '../game/celebrationLock';
	import {
		boolSource,
		eventSignal,
		freeSpinsCurrent,
		freeSpinsRemaining,
		freeSpinsTotal,
		resolveWinMount,
		textSource,
		valueSource,
	} from 'engine-game';
	import { freeSpinOutroState } from '../game/freeSpinOutroState.svelte';
	import { winState } from '../game/winState.svelte';
	import {
		rebuildBoard,
		setBoardOverride,
		stateGame,
		stateGameDerived,
	} from '../game/stateGame.svelte';
	import { stateRespinBoard } from '../game/stateRespinBoard.svelte';
	import {
		activeModifiersText,
		shownCollectorLevel,
		stateHoldAndWin,
	} from '../game/stateHoldAndWin.svelte';
	import { configuredLetters, stateLetters } from '../game/holdAndWinLetters.svelte';
	import {
		configuredMeters,
		meterLevelShown,
		meterMax,
		seedHoldAndWinMeters,
	} from '../game/holdAndWinMeters.svelte';
	import { jackpotMultiplier, seedHoldAndWinJackpots } from '../game/holdAndWinJackpots.svelte';
	import { HUD_BUTTON_INSTANCES } from '../game/editorFlags';
	import {
		bakedEditorArtAssets,
		bakedFontCatalog,
		bakedFontSrcBase,
		bakedEffects,
		bakedFlipbooks,
		bakedRigFlipbooks,
		bakedRigFx,
		bakedSymbolAssets,
		bakedWinCycleConfig,
		bakedWinText,
		bakedSoundBindings,
		bakedWinPresentationParams,
		fallbackEditorScenes,
		isRuntimeBundleActive,
		loadEditorScenes,
		registerBakedComponents,
		registerEditorTextLocalization,
	} from '../editor-scenes';
	import { getMessagesMap } from '../i18n/messagesMap';

	import { getContext } from '../game/context';
	import { stateApp } from '../game/stateApp';
	import EnableSound from './EnableSound.svelte';
	import EnableGameActor from './EnableGameActor.svelte';
	import { ResumeBet } from 'engine-game';
	import Sound from './Sound.svelte';
	import { Background } from 'engine-game';
	import BoardFrame from './BoardFrame.svelte';
	import Board from './Board.svelte';
	import Anticipations from './Anticipations.svelte';
	import AnticipationCamera from './AnticipationCamera.svelte';
	import {
		anticipationCameraTransform,
		updateAnticipationCameraTarget,
	} from '../game/anticipationCamera.svelte';
	import WinLine from './WinLine.svelte';
	import Win from './Win.svelte';
	import WinGate from './WinGate.svelte';
	import WinVisual from './WinVisual.svelte';
	import { ContinuePressMask } from 'engine-game';
	import FreeSpinIntroVisual from './FreeSpinIntroVisual.svelte';
	import FreeSpinCounter from './FreeSpinCounter.svelte';
	import FreeSpinOutroDriver from './FreeSpinOutroDriver.svelte';
	import FreeSpinOutroVisual from './FreeSpinOutroVisual.svelte';
	import SpecialBook from './SpecialBook.svelte';
	import TumbleBoard from './TumbleBoard.svelte';
	import MultiplierBoard from './MultiplierBoard.svelte';
	import RespinBoard from './RespinBoard.svelte';
	import FlightLayer from './FlightLayer.svelte';
	import HoldAndWinBanner from './HoldAndWinBanner.svelte';
	import HoldAndWinWheel from './HoldAndWinWheel.svelte';
	import PotMeter from './PotMeter.svelte';
	import LettersStrip from './LettersStrip.svelte';
	import HoldAndWinWheelPart from './HoldAndWinWheelPart.svelte';
	import RespinCellTiles from './RespinCellTiles.svelte';
	import { stateHoldAndWinBanner } from '../game/holdAndWinBanner.svelte';
	import FreeSpinIntroSymbolReveal from './FreeSpinIntroSymbolReveal.svelte';
	import ExpandingSymbol from './ExpandingSymbol.svelte';
	import MessageSymbol from './MessageSymbol.svelte';
	import RevealSymbolRider from './RevealSymbolRider.svelte';
	import TapToContinue from './TapToContinue.svelte';
	import { Transition } from 'engine-game';
	import Effects from './Effects.svelte';
	import FlowV2Messages from './FlowV2Messages.svelte';
	import FlowV2Cinematics from './FlowV2Cinematics.svelte';

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
		// The symbol→binding map is memoised on first read (`symbolMap.ts`), and
		// `infoManifest.ts` reads it at IMPORT time — before this async runtime bundle
		// landed — so the memo froze to the coded template symbols. Drop it now that the
		// overrides are live, so the first reel render recomputes the merge WITH them.
		// Otherwise an online game shows the template defaults despite a baked symbols doc.
		resetSymbolMapCache();
		// Same trap, same fix, for the authored game config: `paytable.ts` / `infoManifest.ts` read
		// it through `getActiveGameConfig()`, which memoises on first read — before this bundle
		// landed. Without this the game would spin the TEMPLATE's strips and show the template's
		// paytable despite having authored its own, which is the entire failure Invisible Game
		// Config exists to fix.
		resetGameConfigCache();
		// The RGS server-config overlay (`__IE_SERVER_CONFIG__`, published by the Play4Fun facade on the
		// boot `config` event) needs no reset here for PAYLINES / numLines / the in-play gate / strips:
		// those are live accessors, so a config arriving after this branch still takes effect the next
		// time they are read (per-render / per-spin). Deliberately not folded into the memoised config
		// for that reason (`docs/design/invisible-game-config.md`, server-authoritative phase).
		//
		// The GRID is the exception and is handled below by `captureServerGrid()`, outside this branch:
		// it resizes a board that was BUILT once rather than read per render, and a baked bundle — which
		// never enters this branch — needs it just as much.
		// The board was built at `stateGame` module init from the compiled template's grid — before
		// this bundle landed. Rebuild it now the authored config is live, so an online project's
		// numReels/numRows actually resizes the board (grid-dimensions enhancement). No-op in effect
		// for baked/dev, where the board was already built with the right config (parity).
		rebuildBoard();
	}

	// Say out loud what the active config gets wrong — a payline off the grid, a symbol dealt by the
	// strips with no art. This replaces a guarantee Phase 3 gave up on purpose: `SymbolName` used to
	// be a compile-time union over the compiled config, so an undrawable symbol was a build error;
	// an authored config is only known here, at runtime. Runs after the runtime-bundle branch above
	// so it inspects the config the game will actually run, not the one it booted with.
	warnOnGameConfigIssues(getActiveSymbolInfoMap());

	// ADOPT the RGS's declared board, and rebuild the reels if that changed the grid.
	//
	// UNCONDITIONAL — outside the runtime-bundle branch above, unlike the `rebuildBoard()` in it.
	// Every OTHER server-authoritative reader is a live accessor that needs no boot hook, which is
	// what that branch's note says; the board is the exception, because `stateGame.board` is BUILT
	// once at module init rather than read per render. A baked bundle never enters that branch, so
	// without this line it would size its mask, seats and cull off the server's window while the
	// reels kept the authored column count — half of one board and half of another.
	//
	// Gated on the grid ACTUALLY changing, which is what makes this parity-safe: a game whose server
	// declares no window, or declares the board the project already authored, rebuilds nothing and
	// keeps the cells it booted with.
	//
	// Safe here for the same reason the warning below is: `<Authenticate>` gates this mount on the
	// request that publishes the overlay, so the server's declared window is already in.
	if (captureServerGrid()) rebuildBoard();

	// Hold and Win: the persistent meters' levels the server declared at boot (published by the facade
	// on the same `config` request `<Authenticate>` gates this mount on). A no-op for every game whose
	// server declares none, and once a book event has recorded the meters itself.
	seedHoldAndWinMeters();
	// …and its progressive jackpot pools, followed on every heartbeat refresh from here on.
	onMount(seedHoldAndWinJackpots);

	// And say out loud when the RGS is dealing a DIFFERENT board than the one the project authored.
	// The board follows the server now (above); this is what stops it doing so SILENTLY. An online
	// project fetches its config live while the mock RGS follows a copy synced at publish, so a grid
	// changed without republishing shows up here rather than as a game that stopped working.
	warnOnServerGridMismatch();

	// The same for PRICES: the info page quotes the authored paytable, the server pays its own. After
	// the runtime-bundle branch above, so it compares the paytable the player will actually be shown.
	warnOnServerPaytableMismatch(paytable());

	// Build the bet-selector / buy-bonus menu from the ACTIVE config (Invisible Game Config Phase 6),
	// replacing the shared `DEFAULT_BET_MODE_META` placeholder for this game. Runs after the
	// runtime-bundle branch above so it reads the config the game will actually run — an online
	// project's authored bet modes, cost and copy — not the one it booted with.
	syncBetModeMeta();

	// Publish the placed `win` componentInstance's authored params so its per-tier DURATION + SOUND
	// overrides reach the out-of-tree consumers (`WinGate` duration, `winLevelSoundsPlay`). Runs after
	// the runtime-bundle branch, from the doc the game will actually run. Un-authored / coded-`Win`-bind
	// ⇒ empty ⇒ every field falls back to the config/coded tier (byte-identical).
	publishWinPresentation(bakedWinPresentationParams());

	// Publish WHAT PLAYS WHEN — the Invisible Sound doc's choices, already migrated by the export from
	// a pre-move project's config/symbols docs. Must run after the runtime-bundle branch, on the
	// bundle the game will actually run. Un-baked dev or a bundle built before the move ⇒ undefined ⇒
	// slots and win tiers fall back to the config/coded path exactly as before (byte-identical).
	publishSoundBindings(bakedSoundBindings());

	// DEV/testing fallback for the reel-anticipation mode. The REAL owner is now the Flow
	// `enableAnticipationMode` effect (Phase 4, `flowEffects.ts`) — it sets these same flags from an
	// authored graph. This URL param is kept as the pre-Flow test path: `?anticipation=possible|guaranteed`
	// turns the mode on at boot so it can be verified live (with the mock RGS) without authoring a flow;
	// any other / absent value leaves the mode OFF ⇒ nothing mounts, byte-parity. `possible` teases
	// near-misses (max bound); `guaranteed` only fires once the big win is locked in (min bound).
	if (typeof location !== 'undefined') {
		const anticipationParam = new URLSearchParams(location.search).get('anticipation');
		if (anticipationParam === 'possible' || anticipationParam === 'guaranteed') {
			stateGame.anticipationMode = true;
			stateGame.anticipationConfidence = anticipationParam;
		}
	}

	// Boot loading screen (defined in the HTML shell, `app.html`): feed real asset-load
	// progress into the pre-mount splash and dismiss it once the game's assets are ready.
	// The splash covered the black window BEFORE Pixi + the in-canvas `LoadingBar` existed
	// (the `?runtime=1` runtime-doc + R2 asset wait); from `loaded` on, the in-canvas visuals
	// own the screen. Optional-chained ⇒ inert in Storybook / any host without the shell.
	$effect(() => {
		const boot = window.__ieBoot;
		if (!boot) return;
		boot.progress(stateApp.loadingProgress);
		if (stateApp.loaded) boot.done();
	});

	// Drive the SHARED reel-anticipation camera (`game/anticipationCamera`). Kept here (not in
	// `AnticipationCamera.svelte`) so the transform tracks the armed reels regardless of whether the
	// reel camera is mounted — an opted-in screen zooms whenever the board would. The driver reads
	// the armed reels / tier reactively and eases the tween to identity when nothing is anticipating,
	// so an un-armed board is byte-identical to today (parity).
	$effect(() => {
		updateAnticipationCameraTarget();
	});

	// `HudTicker`/`HudCaption`/`HudValue` are the three coded parts the `hudReadout`
	// ComponentDef MOUNTS (§14.3 separate-coded-parts path): the def's `root` has one
	// `bind` child per part by name, so each must be in the bound-component registry
	// alongside the animated overlays. They reuse the coded HUD rendering (tile +
	// caption localization + currency format + count-up + bet tap). `HudReadout` (the
	// pre-split single mount) stays registered for revert safety; it's unused by the
	// def now.
	registerBoundComponents({
		Win,
		// The WIN overlay split (gate + positionable visual):
		// the full-screen GATE (dim + count-up driver + WinCoins + press + round-await) and the
		// board-relative VISUAL (the `win` componentInstance mounts `WinVisual`, positioned by its
		// node). Registered for the ON path; the OFF composer `Win` mounts both itself.
		WinGate,
		WinVisual,
		Transition,
		HudReadout,
		HudTicker,
		HudCaption,
		HudValue,
		// The HUD CORNERS (game-name + logo) as bound components so a flow-v2-driven game — where
		// the coded `<UI>` chrome is suppressed — renders them: `<FlowV2Mount>` mounts the reserved
		// `hudCorners` scene and `LayoutNodeView` resolves these `HudGameName`/`HudLogo` binds via
		// `getBoundComponent`. Without this the corners mount as EMPTY containers (the coded `<UI>`
		// was their only renderer), the logo/game-name twin of the §Phase-1 blank bottom bar. In the
		// CODED path `hudCorners` is a RESERVED scene (never generically mounted), so the coded `<UI>`
		// snippet stays the sole corner renderer there — no double-mount. Same components both paths.
		HudGameName,
		HudLogo,
		// `ButtonFrame`/`ButtonLabel` are the two coded parts the `button` ComponentDef
		// MOUNTS (§16.2 separate-coded-parts path, the button analogue of the HUD split):
		// the def's `root` has one `bind` child per part by name (Frame = the `UiSprite`
		// tile + hit area, Label = the localized icon/label `Text`), so each must be in
		// the bound-component registry. Unused until the HUD button cluster is converted
		// to `componentInstance`s (B6.4) — registered now keeps B6.1 purely additive.
		ButtonFrame,
		ButtonLabel,
		// The free-spin intro/outro VISUALS — board-centred as a bare scene bind, or positioned by a
		// `freeSpinIntroVisual`/`freeSpinOutroVisual` componentInstance. They self-show/animate off the
		// free-spin cues and hold nothing: the flow's intro/outro containers own the dim, the tap and
		// the round-block.
		FreeSpinIntroVisual,
		FreeSpinCounter,
		FreeSpinOutroVisual,
		// Special-Book bonus overlay — board-centred, self-shows/animates off the
		// `specialBookReveal`/`specialBookHide` book events; the doc owns only placement.
		SpecialBook,
		// The board's chosen book expanding symbol as a POSITIONABLE part (the `expandingSymbol`
		// def's bind) — renders `stateGame.specialSymbol` via `<Symbol>` WITHOUT the shuffle, so an
		// author owns the reveal via their own spine + choreography (pure-hooks book reveal).
		ExpandingSymbol,
		// The inline symbol renderer for message strings (Invisible Win Text "show symbol as image").
		// `engine-layout`'s `InlineImageText` mounts this by name (`INLINE_IMAGE_BOUND_COMPONENT`) per
		// image token; it renders the symbol at text size via the SAME `<Symbol>` state machine, so
		// spine high symbols show (a flat `<Sprite>` in the engine layer couldn't draw them). The key
		// MUST be `messageSymbol` to match `getBoundComponent(INLINE_IMAGE_BOUND_COMPONENT)`.
		messageSymbol: MessageSymbol,
		// The chosen symbol MERGED onto a bone of an authored intro rig (the
		// `freeSpinIntroSymbolReveal` def's bind) — plays the rig's intro animation and rides the
		// chosen `stateGame.specialSymbol` on a named bone, driven by the same awaited
		// `specialBookReveal` cue. The reusable "flip through → land on YOUR symbol" reveal node.
		FreeSpinIntroSymbolReveal,
		// Rides the chosen `stateGame.specialSymbol` on a bone of a PLACED spine node that sets
		// `revealSymbolBone` — the on-node alternative to `FreeSpinIntroSymbolReveal` that brings NO
		// rig of its own (the author places their own rig, e.g. `R_Cage_Freespin`, and the symbol
		// shows on its `Socket` bone). `<LayoutNodeView>` mounts it via `<SpineBoneAttach>`; the key
		// MUST be `revealSymbolRider` to match `getBoundComponent('revealSymbolRider')`.
		revealSymbolRider: RevealSymbolRider,
		// The ONE coded part of the `loadingIntro` splash def — the masked progress
		// fill the static node model can't express (the logo + percentage around it are
		// editor-native nodes). Reads `loadingProgress`/`loaded` off `stateApp` + its
		// frame/size params off the instance, hiding itself once loading completes.
		LoadingBar,
		// Invisible Flow tap-to-continue (§6.2): the coded press surface the engine
		// mounts over any `overlay` instance whose shared `tapToContinue` param is on.
		// `OnPressFullScreen` + `OnHotkey "Space"`; on tap calls BOTH Flow holder APIs
		// (`completeActiveScreen` + `emitFlowSignal(tapSignal)`). Unused until an author
		// flips the toggle on an overlay instance ⇒ pure registration, no render change.
		TapToContinue,
		// The Hold and Win components' coded parts (`potMeter`, `lettersStrip`, `wheel`, `respinCells`
		// defs): live pots, lit letters, the config's wheel and the respin cells' tiles, which the
		// static node model can't express.
		PotMeter,
		LettersStrip,
		HoldAndWinWheelPart,
		RespinCellTiles,
	});
	// Batch B / B4.4 — register the parametric HUD readout def + its live value
	// sources. The three HUD bar nodes (balance/win/bet) are now `componentInstance`
	// nodes of `hudReadout` (see `referenceLayouts/hud.ts`), so this powers the live
	// HUD: the def mounts the coded `HudReadout`, fed `value` from these sources.
	// `BUTTON_DEF` (§16.3 B6.3) is registered beside it so `getComponent('button')`
	// resolves — required for any `button` componentInstance to expand into its
	// `ButtonFrame`/`ButtonLabel` parts. No live scene carries a button instance yet
	// (B6.4 converts the HUD cluster), so this is pure registration — no render change.
	registerComponents(
		{
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
			// §17 Phase 3 — makes `getComponent('freeSpinIntroVisual')` resolve so an
			// author-placed `freeSpinIntroVisual` instance expands into its bound
			// `FreeSpinIntroVisual` part, positioned by the editor node.
			[FREE_SPIN_INTRO_VISUAL_DEF.id]: FREE_SPIN_INTRO_VISUAL_DEF,
			// §17 Phase 3 — same for the outro's positionable visual.
			[FREE_SPIN_OUTRO_VISUAL_DEF.id]: FREE_SPIN_OUTRO_VISUAL_DEF,
			// Makes `getComponent('win')` resolve so the `winVisual` `game`-space scene (emitted only
			// when the win overlay is split) expands into its bound `WinVisual` part, positioned by the
			// editor node. Pure registration otherwise (no scene references it ⇒ no render change — the
			// OFF composer `bind:Win` renders unchanged). Book of Borut opts in by placing the `win`
			// component in the editor (the shared def carries `boundToInstance:true`).
			[WIN_DEF.id]: WIN_DEF,
			// Book-reveal authoring — makes `getComponent('expandingSymbol')` resolve so an
			// `expandingSymbol` instance expands into its bound `ExpandingSymbol` part (the chosen
			// symbol's art), positioned by the editor node. Placeable so an author renders the landed
			// symbol inside their own reveal; the coded `SpecialBook` shuffle stays as the fallback.
			[EXPANDING_SYMBOL_DEF.id]: EXPANDING_SYMBOL_DEF,
			// Book-reveal authoring — makes `getComponent('freeSpinIntroSymbolReveal')` resolve so a
			// `freeSpinIntroSymbolReveal` instance expands into its bound `FreeSpinIntroSymbolReveal`
			// part: the author-picked intro rig with the chosen symbol ridden on a bone. Placing it in
			// the `specialBook` scene flips book-reveal ownership ⇒ the coded shuffle is suppressed.
			[FREE_SPIN_INTRO_SYMBOL_REVEAL_DEF.id]: FREE_SPIN_INTRO_SYMBOL_REVEAL_DEF,
			// Invisible Flow §6.2 — the droppable full-screen tap-to-continue overlay. A
			// minimal empty-root `overlay` def: an author can drop it on ANY Flow screen from
			// the palette to get a full-screen tap-to-continue. Its behaviour + per-instance
			// dim come from the SHARED `tapToContinue` capability (mounts the coded
			// `TapToContinue` bind), so a freshly-placed instance starts transparent until the
			// author flips the toggle and raises the dim — parity otherwise.
			[TAP_TO_CONTINUE_DEF.id]: TAP_TO_CONTINUE_DEF,
			// Flow-driven-game §1 — the droppable LOADING BAR. A minimal `overlay` def that
			// mounts the proven coded `LoadingBar` part and carries `completeOnLoaded: true` (seeded
			// on drop), so dropping it on the `loading` screen makes the flow's `complete` edge fire
			// when boot loading finishes — the loading gate becomes authorable in `/flow`. Inert
			// until a doc references it (parity); the capability is a no-op with no active interpreter.
			[LOADING_BAR_DEF.id]: LOADING_BAR_DEF,
			// The kind-gated Hold and Win components (respin counter, jackpot bar / tile, total win
			// bar, pot meter, letters strip, wheel). Inert until a doc places one (parity).
			...Object.fromEntries(HOLD_AND_WIN_COMPONENTS.map((def) => [def.id, def])),
			// BUILT-IN (lowest precedence): these SEED the engine defs, but `registerBakedComponents()`
			// (below) must be free to override any id with the project's EDITED def — so the built-in
			// never shadows a baked/project def, whatever the boot order (§8 "project shadows shared").
		},
		{ builtin: true },
	);
	// Flow-driven-game §1 — wire the engine's feed-triggered `completeOnLoaded` capability
	// (`<ComponentInstance>` → `getFlowComplete()`) to THIS game's Flow holder, the non-visual
	// sibling of the `TapToContinue` bound-component mount. A `completeOnLoaded` instance's
	// `assetsLoaded` rising edge then advances the active Flow screen exactly as a tap does.
	// SAFE: the holder helpers are no-ops with no active interpreter (no FlowDoc ⇒ pure coded
	// path), so this is inert on a normal boot — parity.
	// Phase A — a v2 flow scopes "the current screen finished" to its TOPMOST shown container
	// (`complete:<top>`, e.g. a `loading` tap swapping loading→game). Try v2 first; it runs ALONE
	// only when the flow OWNS that screen's complete, else falls through to the v1/coded
	// `completeActiveScreen` (parity — no v2 doc / un-authored screen ⇒ v2 returns `false`).
	registerFlowComplete({
		completeActiveScreen: () =>
			void dispatchFlowV2Complete().then((owned) => {
				if (!owned) void completeActiveScreen();
			}),
		emitSignal: (signal: string) => void emitFlowSignal(signal),
	});
	// Flow value dataflow (design doc §11.4) — wire `<ComponentInstance>`'s value-feed lookup through
	// the interpreter's authored value-binding overrides (+ the dev `__IE_FLOW_VALUE__` hook). No
	// FlowDoc / inert interpreter / no override ⇒ `linesValueResolver` returns each display's own
	// `source` verbatim ⇒ subscriptions byte-identical to today (parity §11.6).
	registerFlowValueSource(linesValueResolver);
	// Flow press routing (§Part 2) — wire `<ComponentInstance>`'s press through the v2 flow's authored
	// container-event ownership. When the flow OWNS a component's event (an authored exec edge from its
	// fused pin) the press fires the flow's chain ALONE and the coded `onpress` is SUPPRESSED (no
	// double-fire); un-owned / no v2 doc ⇒ `resolveFlowV2Press` returns undefined ⇒ the coded press runs
	// unchanged (parity). Consulted at click time, so it tracks the live handle regardless of boot order.
	// Flow routing SKIPS the coded `onpress`, which is where the press-feedback SOUND is broadcast — so
	// replay it here before dispatching (faithful mapping: spin → the shared bet/slam cue, every other
	// HUD button → `soundPressGeneral`), else a flow-owned button press would be silent.
	registerFlowPress((componentId, action, payload) => {
		// Thread the press PAYLOAD through: a `<Repeater>` card passes `{ betModeKey: <key> }` so the
		// fused `onSelect` pin's data-out resolves to WHICH card fired. Dropping it here armed the flow's
		// `selectBetMode` with `undefined`, so a buy-card press committed no mode. A button passes none
		// (byte-identical). Consulted at click time, so it tracks the live handle regardless of boot order.
		const routed = resolveFlowV2Press(componentId, action, payload);
		if (!routed) return undefined;
		return () => {
			context.eventEmitter.broadcast(
				action === 'spin'
					? getSpinPressSound({ isIdle: context.stateXstateDerived.isIdle() })
					: { type: 'soundPressGeneral' },
			);
			routed();
		};
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
	// editor-authored font reaches the shipped game; keyed by unique `id`, so a baked
	// font overrides a built-in of the same id and same-face VARIANTS both survive.
	// Bitmap fonts load as `{type:'font'}` assets that register under `${id}-bitmap`
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
	// Register the project's baked Invisible FX effects so PLACED `effect` nodes resolve their
	// `effectId` → doc at render (`registerEffects`/`resolveEffect`). No-op when un-baked / no
	// effects (parity). `components/Effects.svelte` still auto-mounts bone + unplaced free effects.
	registerEffects(bakedEffects());
	// Register the rig-timeline direct FX bindings so a rig plays its bound effects on the beat of
	// its own animation events (`registerRigFx`/`resolveRigFx`; `<SpineProvider>` mounts a
	// `<RiggedEffect>` per binding, for every rig wherever it is mounted — registering here is also
	// what installs that seam). No-op when un-baked / no rig has a bound event (parity).
	registerRigFx(bakedRigFx());
	// Register the project's baked Invisible Flipbook clips so anything referencing one by `clipId`
	// resolves it → its ordered frames at render (`registerFlipbooks`/`resolveFlipbook`). No-op when
	// un-baked / no clips (parity).
	registerFlipbooks(bakedFlipbooks());
	// …and the rig-timeline direct FLIPBOOK bindings, so a placed rig plays its bound CLIPS on the
	// beat of its own animation events (`registerRigFlipbooks`/`resolveRigFlipbooks`). Registered
	// AFTER `registerFlipbooks` for readability only — a binding resolves its clip at render, not
	// here. No-op when un-baked / no rig has a bound clip (parity).
	registerRigFlipbooks(bakedRigFlipbooks());
	// Layout-doc text localization (§18): any doc text matching a catalog key —
	// code catalogs + the baked Localization-tool strings — renders translated.
	registerEditorTextLocalization(getMessagesMap());
	// Inline-image resolver for message strings (Invisible Win Text "show symbol as image"): a KNOWN
	// symbol id resolves to itself, so the info-bar toast draws the paying symbol inline (engine-layout
	// `InlineImageText` mounts the `messageSymbol` bound component below with this id). Any symbol type
	// is renderable — the bound component goes through the `<Symbol>` state machine, so sprite, spine
	// AND flipbook high symbols all show (the high symbols are spines, which a flat `<Sprite>` couldn't
	// draw — the reason this resolves an id, not a texture key). An unknown id ⇒ undefined ⇒ the
	// message keeps the written name. Reads the LIVE merged map each call, so it tracks a runtime
	// symbol-doc swap (`resetSymbolMapCache`).
	registerInlineImageResolver((symbol) =>
		getActiveSymbolInfoMap()[symbol]?.static ? symbol : undefined,
	);
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
		// Hold and Win: the respins left on the counter (`respinUpdate`, restated by every snapshot) — what
		// an authored respin counter binds; the coded one in `RespinCounter` reads the same field.
		respinsLeft: valueSource(() => stateRespinBoard.counter.left),
		// …and the modifiers active in the feature ("PAYER · MULTIPLIER"), what the coded counter's
		// second line shows.
		activeModifiers: textSource(activeModifiersText),
		// The collector level (1 single, 2 double, 3 triple — raised by the wheel's `extraCollect`).
		collectorLevel: valueSource(shownCollectorLevel),
		// Grand's column letters: how many are lit (each letter's own flag is a visibility source,
		// below). Registered only for a config whose board ends on column letters.
		...(configuredLetters().length > 0
			? { lettersLit: valueSource(() => stateLetters.lit.length) }
			: {}),
		// Each persistent meter the Game Config declares: `meter.<id>.level` (the level the pot shows —
		// the server's, ticking up as a special lands) and `meter.<id>.max`, what Phase 6's authored
		// pots bind. None declared ⇒ none registered.
		...Object.fromEntries(
			configuredMeters().flatMap(({ id }) => [
				[`meter.${id}.level`, valueSource(() => meterLevelShown(id))],
				[`meter.${id}.max`, valueSource(() => meterMax(id))],
			]),
		),
		// What the authored Total Win bar reads: the win meter the feature end counts every coin into
		// (`tallyCountUp`), so the bar and the HUD win readout can never disagree.
		featureTotal: valueSource(() => stateBet.winBookEventAmount, bookEventAmountToCurrencyString),
		// Each configured jackpot's value at the current bet (`jackpot.<name>`, lower-case), what the
		// authored jackpot tiles read: a fixed tier's multiplier, a progressive tier's LIVE pool (the
		// server's, moving with every round and heartbeat). None configured ⇒ none registered.
		...Object.fromEntries(
			(getActiveGameConfig().holdAndWin?.jackpots ?? []).map(({ name }) => [
				`jackpot.${name.toLowerCase()}`,
				valueSource(
					() => jackpotMultiplier(name) * stateBetDerived.betCost(),
					numberToCurrencyString,
				),
			]),
		),
		// The coded banner's headline and detail line ("GRAND JACKPOT", the amount), what the authored
		// `luckySpin` / `jackpotWin` screens show — one beat sets them for both paths.
		holdAndWinBanner: textSource(() => stateHoldAndWinBanner.current?.title ?? ''),
		holdAndWinBannerDetail: textSource(() => stateHoldAndWinBanner.current?.detail ?? ''),
		// The RETRIGGER delta — extra free spins won mid-feature. Set universally at dispatch
		// (`engine-game`'s `playBook.ts`) so it's populated whether the flow or the coded path
		// presents the retrigger.
		// `freeSpinsAdded` is the bare COUNT (e.g. `10` — add your own "+" in a label); bind
		// `freeSpinsAddedText` for the whole localized sentence (the win-text `freeSpins.retrigger`
		// template, localize-then-interpolate — e.g. "You won +10 Extra Free Spins").
		freeSpinsAdded: valueSource(() => stateUi.freeSpinsAdded),
		freeSpinsAddedText: textSource(() =>
			formatWinText(bakedWinText().freeSpins.retrigger, { count: stateUi.freeSpinsAdded }),
		),
		// FS-7 decision C — the LIVE counting-up free-spin OUTRO total (the count-up tween value the
		// gate/driver publishes per frame to `freeSpinOutroState.countUpAmount`), currency-formatted.
		// An authored outro count text binds `source: 'freeSpinOutroTotalWin'` to it, so a fully
		// author-rebuilt outro shows the number ticking up without the coded `FreeSpinOutroVisual`.
		// Unlike `totalWin` (the static final `winBookEventAmount`) this is the ANIMATING value.
		freeSpinOutroTotalWin: valueSource(
			() => freeSpinOutroState.countUpAmount,
			bookEventAmountToCurrencyString,
			true, // selfAnimated — already the count-up tween; a bound readout snaps (no double count-up).
		),
		// Design doc §14 (win-overlay twin) — the LIVE counting-up WIN total (the count-up tween value
		// `WinGate` publishes per frame to `winState.countUpAmount`), currency-formatted. An authored win
		// container's own Text Box binds `source: 'winCountUpAmount'` to show the number ticking up
		// without the coded `WinVisual`. Unlike `totalWin`/`win` (the static final amount) this ANIMATES.
		winCountUpAmount: valueSource(
			() => winState.countUpAmount,
			bookEventAmountToCurrencyString,
			true, // selfAnimated — already the count-up tween; a bound readout snaps (no double count-up).
		),
		// The two HALVES of the `freeSpins` string as bindable numbers, so an authored counter can
		// choose its own direction + layout instead of inheriting the composed "current OF total".
		// Both read `freeSpinCounterValues` — the same module the flow's `$engine.freeSpinsRemaining`
		// read uses — so a readout and a flow branch cannot disagree about how many spins are left.
		freeSpinsRemaining: valueSource(() => freeSpinsRemaining()),
		freeSpinsCurrent: valueSource(() => freeSpinsCurrent()),
		// Composed-string feed for the `freeSpinCounter` def's `value` param — the live
		// "current OF total" the counter shows, sourced from the SAME `stateUi` fields the
		// old coded overlay read (set in bookEventHandlerMap). A string source, so it
		// renders verbatim through the text path. The `freeSpinCounter` scene's
		// componentInstance binds its value node to this via `params.source: 'freeSpins'`.
		// Composed through the SAME finite-guarded readers as `freeSpinsCurrent`/`freeSpinsRemaining`
		// above rather than off `stateUi` raw. This string was the one readout that could still render
		// a non-number at the player: a mis-authored flow pin writes `undefined`, `updateFreeSpinCounter`
		// turns that into `NaN` via `amount + 1`, and the gold BMFont has no letter glyphs — so "NaN OF 10"
		// dropped to a blank where the count belongs, which reads as a layout bug rather than a wiring one.
		freeSpins: textSource(() => `${freeSpinsCurrent()} OF ${freeSpinsTotal()}`),
		// The name of the chosen book expanding symbol (empty until one is picked). A string
		// source so an authored readout renders it verbatim; the LANDED symbol's ART is rendered
		// by the `expandingSymbol` builtin (which reads `stateGame.specialSymbol` directly through
		// the same `<Symbol>` + `getActiveSymbolInfoMap()` path the coded `SpecialBook` uses).
		specialSymbol: textSource(() => stateGame.specialSymbol ?? ''),
		// Composed-string feed for the `infoBar` def's `value` param — the transient
		// `showMessage` toast text (e.g. "You win $1.00 with 2 Bananas"). A string source, so
		// it renders verbatim through the text path. The `infoBar` scene's componentInstance
		// binds its message node to this via `params.source: 'message'`. Empty until a game
		// calls `showMessage`, gated invisible by `messageShow` below.
		// Prefer the RICH variant (inline symbol image, Invisible Win Text "show symbol as image") when
		// the message carries one; the Pixi text node renders its sentinels as sprites. Plain `text`
		// (the written name) is the fallback for an ordinary message.
		message: textSource(() => stateMessage.current?.richText ?? stateMessage.current?.text ?? ''),
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
		// Hold and Win: true while the respin counter is up — the whole feature, trigger to end.
		respinCounterShow: boolSource(() => stateRespinBoard.counter.show),
		// …and each column letter's lit flag (`letter.<reel>.lit`), what Phase 6's authored letters
		// row binds to swap a letter's lit art in. Only for a config whose board ends on letters.
		...Object.fromEntries(
			configuredLetters().map((_, reel) => [
				`letter.${reel}.lit`,
				boolSource(() => stateLetters.lit.includes(reel)),
			]),
		),
		// …and the two banner beats the authored `luckySpin` / `jackpotWin` screens gate on.
		luckySpinShow: boolSource(() => stateHoldAndWinBanner.current?.kind === 'luckySpin'),
		jackpotWinShow: boolSource(() => stateHoldAndWinBanner.current?.kind === 'jackpot'),
		// Gates the `infoBar` componentInstance: true while a transient `showMessage` toast
		// is active, so the bar shows only when there's a message and hides on the existing
		// auto-clear — the engine-layout equivalent of the coded HTML `MessageToast`.
		messageShow: boolSource(() => stateMessage.current !== null),
		// Gates loading-only content (e.g. the `loadingIntro` percentage readout): true
		// only while the boot asset-load is in flight, so it hides the moment loading
		// completes — the engine-layout equivalent of the coded splash's `{#if !loaded}`.
		assetsLoading: boolSource(() => !stateApp.loaded),
		// Inverse of `assetsLoading`: true the moment boot loading completes. Gates splash
		// content that should appear AFTER load (e.g. a logo that pops in once the loading
		// bar fills, before press-to-continue), the complement of the `{#if !loaded}` bar.
		assetsLoaded: boolSource(() => stateApp.loaded),
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
		// True while a book expanding symbol is chosen — gates the `expandingSymbol` component so
		// the landed art shows only during the reveal (the author's own reveal spine + choreography
		// own the timing; this simply mirrors `stateGame.specialSymbol`'s presence).
		specialBookShow: boolSource(() => stateGame.specialSymbol !== null),
		// Config-feature gates for the parametric turbo / auto-spin buttons (B6 M1) — mirror the
		// coded `UIDefault` `{#if stateUi.config.features.turbo/.autoplay}` wraps so a flipped
		// `componentInstance(button)` turbo/auto-spin hides when the config disables the feature.
		turboFeature: boolSource(() => stateUi.config.features.turbo),
		autoplayFeature: boolSource(() => stateUi.config.features.autoplay),
		buyFeature: boolSource(() => stateMetaDerived.hasFeatureBetModes()),
		// True when NO full-screen tap-to-continue overlay is up (`continuePressCount === 0`). Bind an
		// authored ambient/background node (e.g. drifting smoke) to this so it hides during any
		// tap-to-continue celebration — the authored-scene equivalent of the coded `Background` dust
		// fade, which auto-hides on the same signal so the dimmed board stays clean, not murky.
		tapOverlayIdle: boolSource(() => stateUi.continuePressCount === 0),
	});
	// Buy-bonus SELECT menu (§ feature cards): register the SHARED in-canvas Select-Feature wiring —
	// the built-in `featureCard` def + the `featureCards` repeater source (one card per non-default
	// bet mode, fed from the active `stateMeta.betModeMeta`; `select` → pick mode + `buyBonusConfirm`).
	// The `<BuyFeatureScreen>` takeover (mounted below) renders it; the HTML `ModalBuyBonus` is gone.
	registerBuyFeature();
	registerHudMenus();
	// Reel-anticipation camera bridge (`docs/design/reel-anticipation.md`): publish THIS game's
	// shared camera transform to engine-layout, so an opted-in screen (`Scene.zoomWithAnticipation`)
	// zooms in lockstep with the reel camera toward the SAME focal point (one coherent move). The
	// source is identity while nothing is armed ⇒ an opted-in screen renders byte-identically until
	// an anticipation fires; a screen without the tick adds no wrapper at all (parity).
	registerSceneCameraTransform(anticipationCameraTransform);

	const fallbackBasegame = fallbackEditorScenes.scenes.find((scene) => scene.id === 'basegame')!;
	const fallbackOverlays = fallbackEditorScenes.scenes.find(
		(scene) => scene.id === 'basegameOverlays',
	)!;

	/** Fetched at boot from the launcher; seeded with the bundled fallback so the
	 * game renders immediately and degrades gracefully when offline. */
	let editorDoc = $state(fallbackEditorScenes);
	// Screen identity resolves by ROLE (engine-layout `sceneByRole`) — not by matching a magic
	// scene id — so scene ids stay free-form and renameable (the owner's ask). It reads the scene
	// `role`, falling back to the legacy scene whose id equals the role name (parity for un-migrated
	// docs). It needs no FlowDoc, which is why it fixes the CODED boot — no shipped game loads a flow
	// yet. A flow still "drives" the screen by authoring that same scene id
	// (`flow.mounter.has(loadingScreenId)` below). Absent role + absent flow ⇒ today's selection.
	const basegameScreenId = $derived(basegameSceneId(editorDoc.scenes));
	const basegameScene = $derived(sceneByRole(editorDoc.scenes, 'basegame') ?? fallbackBasegame);
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
	// Whether the doc places its OWN win VISUAL — a `win` componentInstance in ANY scene (the Win
	// Overlay component dropped on a flow screen, or the split's `winVisual` scene). When it does,
	// the coded `bind:Win` COMPOSER must not ALSO draw a visual: `Win` is the gate PLUS a param-less
	// `WinVisual`, so a second, unauthored big-win presentation renders board-centred over the
	// authored one — and, having no `componentInstance` params, at the component's DEFAULTS, which is
	// how a `showCoins: false` instance still rained coins. Degrading the node to its GATE half
	// (`bind:WinGate`) below keeps the load-bearing part (count-up + `winState` + round-block, which
	// the authored visual READS) and drops the duplicate art. Recurses into container children, so a
	// win overlay nested inside an authored screen counts.
	const docPlacesWinVisual = $derived(
		collectComponentIds(editorDoc.scenes.flatMap((scene) => scene.nodes)).includes('win'),
	);
	// The overlays scene, with that degrade applied. This is exactly the `WIN_INSTANCE`-ON shape the
	// gate/visual split was designed for — it was simply never reached by a doc that authors the
	// visual while leaving `basegameOverlays` at the reference default, or omitting the scene
	// entirely (then `fallbackOverlays` supplies `bind:Win`, and the game gets both halves twice).
	// No `Win` bind, or no authored win visual ⇒ the SAME scene object back ⇒ byte-identical (parity).
	const basegameOverlaysScene = $derived.by(() => {
		const scene = editorDoc.scenes.find((s) => s.id === 'basegameOverlays') ?? fallbackOverlays;
		if (!docPlacesWinVisual) return scene;
		let degraded = false;
		const nodes = scene.nodes.map((node) => {
			if (node.bind?.component !== 'Win') return node;
			degraded = true;
			return { ...node, bind: { ...node.bind, component: 'WinGate' } };
		});
		return degraded ? { ...scene, nodes } : scene;
	});
	// Whether the (unconditionally-mounted) `basegameOverlays` scene STILL carries a coded WIN gate
	// bind — the reference layout's `WIN_INSTANCE` shapes: `bind:Win` (the OFF composer, gate +
	// visual) or `bind:WinGate` (the ON full-screen gate). When it does, THAT gate is the sole
	// `winUpdate` `waitForResolve` subscriber, so the engine-owned flow gate (mounted below) must NOT
	// also mount — two subscribers would each hold the round on `winUpdate` and hang it. Book of
	// Borut authored the gate OUT and placed just the `win` VISUAL componentInstance, so this is
	// false there ⇒ the engine gate becomes the sole count-up/`winState`/round-block driver. The
	// engine gate is flow-gated regardless, so a non-flow game is unaffected either way (parity).
	const basegameOverlaysHasCodedWinGate = $derived(
		basegameOverlaysScene.nodes.some(
			(node) => node.bind?.component === 'Win' || node.bind?.component === 'WinGate',
		),
	);
	// The board-relative VISUAL scene of the split WIN overlay (`game`-space, so <LayoutScene>
	// wraps it in its own MainContainer for main-scaling). Present only when the overlay is split
	// (the `WIN_INSTANCE` fallback emits it, or the owner authored a `win` component in the editor);
	// `undefined` otherwise ⇒ the mount renders nothing (the OFF composer `Win` draws the visual
	// itself). Parity-safe.
	const winVisualScene = $derived(
		editorDoc.scenes.find((scene) => scene.id === 'winVisual') ??
			fallbackEditorScenes.scenes.find((s) => s.id === 'winVisual'),
	);
	// The free-spin counter as an editor scene (the fallback layout ships it, so the `!` is safe + a
	// no-doc boot is parity) — the coded path's counter; a v2 flow mounts it as a container instead.
	const fallbackFsCounter = fallbackEditorScenes.scenes.find((s) => s.id === 'freeSpinCounter')!;
	const fsCounterScene = $derived(
		editorDoc.scenes.find((scene) => scene.id === 'freeSpinCounter') ?? fallbackFsCounter,
	);
	// Authored BOOK REVEAL (book-reveal authoring). The `specialBook` scene normally carries only
	// the coded `SpecialBook` bind anchor (the shuffle-through-symbols reference reveal). When an
	// author places their OWN reveal content there (an `expandingSymbol` instance + their reveal
	// spine), `hasAuthoredBookReveal` is true ⇒ the author's reveal BECOMES the mechanic and the
	// coded `<SpecialBook>` shuffle is suppressed. `apps/lines`' fallback ships only the coded
	// anchor, so the flag is false ⇒ the coded shuffle still plays (parity). Mirrors
	// `suppressCodedBackground` / `suppressCodedHud`.
	const suppressCodedBookReveal = $derived(hasAuthoredBookReveal(editorDoc.scenes));
	const fallbackSpecialBook = fallbackEditorScenes.scenes.find((s) => s.id === 'specialBook')!;
	const rawSpecialBookScene = $derived(
		editorDoc.scenes.find((scene) => scene.id === 'specialBook') ?? fallbackSpecialBook,
	);
	// Book-reveal authoring — when the author supplies their OWN reveal content the coded
	// `SpecialBook` shuffle is suppressed: strip its bind anchor from the scene so only the
	// authored nodes mount. Un-authored (`apps/lines` dev) ⇒ the anchor stays ⇒ the coded shuffle
	// plays (parity). Mirrors `suppressCodedBackground`/`suppressCodedHud`.
	const specialBookScene = $derived(
		suppressCodedBookReveal
			? {
					...rawSpecialBookScene,
					nodes: rawSpecialBookScene.nodes.filter((node) => node.bind?.component !== 'SpecialBook'),
				}
			: rawSpecialBookScene,
	);

	// Buy-bonus SELECT menu — the authored buy-feature scene (a `repeater` of `featureCard`s over
	// a dimmed backdrop), else the engine default seeded by `defaultLayout`. Passed to the shared
	// `<BuyFeatureScreen>` takeover below, which keys its visibility DIRECTLY on `stateModal`
	// (`buyBonus` = show; a card press advances to `buyBonusConfirm` ⇒ the HTML confirm takes over).
	// Resolution is by ROLE first (`sceneByRole`), so an owner can tag ANY authored scene as the buy
	// screen without matching the magic `buyFeature` id — then the legacy `buyFeature` id, then the
	// seeded fallback. PARITY: a doc with no role-tagged scene resolves exactly as before (id → fallback).
	const fallbackBuyFeature = fallbackEditorScenes.scenes.find((s) => s.id === 'buyFeature')!;
	const buyFeatureScene = $derived(
		sceneByRole(editorDoc.scenes, 'buyFeature') ??
			editorDoc.scenes.find((scene) => scene.id === 'buyFeature') ??
			fallbackBuyFeature,
	);
	// Buy-bonus CONFIRM step — the authored buy-confirm scene (a dimmed backdrop + a `confirmDialog`
	// instance), else the engine default seeded by `defaultLayout`. Passed to the shared
	// `<BuyBonusConfirm>` (→ `<ConfirmDialog>`) below, which keys visibility on `stateModal`
	// (`buyBonusConfirm`) and injects the dialog's title/message/labels + confirm/cancel callbacks.
	// ROLE-first resolution, mirroring the SELECT scene above (role → legacy `buyConfirm` id → fallback).
	const fallbackBuyConfirm = fallbackEditorScenes.scenes.find((s) => s.id === 'buyConfirm')!;
	const buyConfirmScene = $derived(
		sceneByRole(editorDoc.scenes, 'buyConfirm') ??
			editorDoc.scenes.find((scene) => scene.id === 'buyConfirm') ??
			fallbackBuyConfirm,
	);
	// The operator's round-start CONFIRM (`confirmGameRoundStart`) — an authored `roundConfirm`
	// scene if the doc has one, else `undefined` ⇒ `<ConfirmDialog>` renders the engine default.
	// There is no `roundConfirm` ROLE and no seeded fallback: a doc that never authored it gets the
	// engine's dialog, not a copy of the buy page.
	const roundConfirmScene = $derived(editorDoc.scenes.find((scene) => scene.id === 'roundConfirm'));

	// HUD layer as editor scenes — when present the `<UI>` positions its HUD from
	// them (editable in the Invisible Editor); absent → coded layout.
	const hudBarScene = $derived(editorDoc.scenes.find((scene) => scene.id === 'hudBar'));
	const hudCornersScene = $derived(editorDoc.scenes.find((scene) => scene.id === 'hudCorners'));
	// The HUD scene ids the `<UI>` chrome renders — the flow can model the HUD as its own screen
	// by authoring one of these ids as a FlowDoc screen, so the loading→HUD `complete` handoff can
	// reveal it on the tap (mirroring the base-game reel gate). Kept to the ids the engine already
	// resolves — no magic per-game id.
	const HUD_SCENE_IDS = CODED_HUD_SCENE_IDS;
	// Whether the HUD is FLOW-MANAGED: at least one HUD scene id is an authored FlowDoc screen (the
	// same source `reservedSceneIds` uses). INERT-FLOW FALL-THROUGH (§7): with no flow, or a flow
	// that authors no HUD node, this is false ⇒ the `<UI>` renders UNCONDITIONALLY below exactly as
	// today (byte-identical to `main`). Only a flow that AUTHORS a HUD screen gates the chrome.
	const isHudFlowManaged = $derived.by(() => {
		const authored = flow?.mounter.authoredScreenIds();
		return authored ? HUD_SCENE_IDS.some((id) => authored.has(id)) : false;
	});
	// Whether the flow-managed HUD is currently ACTIVE (any of its scene ids is in the active set).
	// Only consulted when `isHudFlowManaged` is true; during `loading` (HUD not yet activated) the
	// chrome is HIDDEN, and the loading→HUD `complete` handoff (fan-out) reveals it on the tap.
	const isHudActive = $derived(HUD_SCENE_IDS.some((id) => activeScreenIds.includes(id)));
	// The entrance transition for the flow-managed HUD, if its activating edge carried one (design
	// doc §6). The HUD is rendered by `<UI>` (not a `<LayoutScene>`, so `<FlowScreenMount>` can't
	// wrap it), so we drive the HUD `<Container>`'s alpha from a Tween seeded off this — the same
	// mount-hidden fade, applied to the chrome container. `undefined` ⇒ a hard cut (alpha stays 1).
	const hudEntrance = $derived(
		HUD_SCENE_IDS.map((id) => entranceById[id]).find((t) => t !== undefined),
	);

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
					scale: backgroundCoverScale(bgNode, context.stateLayoutDerived.layoutType()),
					fit: backgroundFit(bgNode, context.stateLayoutDerived.layoutType()),
					stretch: backgroundCoverStretch(bgNode, context.stateLayoutDerived.layoutType()),
					anchor: backgroundCoverAnchor(bgNode, context.stateLayoutDerived.layoutType()),
				}
			: undefined,
	);

	const suppressCodedBackground = $derived(hasAuthoredBackground(editorDoc.scenes));

	// Authored free-spin BOARD GLOW (the reel-house backdrop behind the reels). Mirrors the
	// background/book-reveal gates: the `boardGlow` scene ships only the coded `BoardFrame` bind
	// anchor, so `hasAuthoredBoardGlow` is false and the coded pink glow renders unchanged
	// (parity). Drop real art in the scene ⇒ the coded spine steps aside and the authored scene
	// mounts in its place, in the BELOW-reel slot (the anchor's own `zIndex:-1` position).
	// TIMING is unchanged either way: both react to `boardFrameGlowShow`/`boardFrameGlowHide`
	// (declared cues ⇒ a flow `fireCue` drives them; the coded free-spin handlers fire them when
	// the events are un-owned), so an authored glow needs no new flow wiring.
	const glowScene = $derived(boardGlowScene(editorDoc.scenes));
	const suppressCodedBoardGlow = $derived(hasAuthoredBoardGlow(editorDoc.scenes));

	// Authored REPLACEMENT HUD screens (§16 HUD generalization, FULL-REPLACE contract). The Scene
	// Editor's "New HUD screen" mints `hud_`-prefixed scenes carrying the author's own HUD chrome
	// (buttons / bottom bar / readouts). `hasAuthoredHud` is true when at least one `hud_*` scene has
	// real content ⇒ the author screens BECOME the HUD and the coded `<UI>` is fully suppressed
	// (`suppressCodedHud`). Suppression is keyed on `hud_*` ONLY so a normal coded-HUD game with
	// content on `hudBar` never trips full-replace (parity, mirroring `hasAuthoredBackground`).
	// The RENDER list, however, is `fullReplaceHudScenes` — a superset that ALSO adopts a
	// content-bearing canonical `hudBar`/`hudCorners`. Without that adoption, an author who put real
	// buttons on the `hudBar` scene (its natural home) would see them mount NOWHERE once suppression
	// switches off the coded `<UI>` (the only path that mounts `hudBar`). Empty ⇒ not suppressed ⇒
	// the coded `<UI>` renders the HUD itself (byte-identical parity for `apps/lines`' fallback).
	const suppressCodedHud = $derived(hasAuthoredHud(editorDoc.scenes));
	// GAME MODES (hold-and-win §4.5): a mode-tagged screen mounts only while its mode is on the stack,
	// and a mode that names its own HUD replaces the HUD while it is on top. No mode screens and no
	// mode HUDs (every doc authored before modes) ⇒ both filters keep every screen (parity).
	const modeIds = $derived(activeModeIds());
	const inActiveModes = (scene: Scene) => sceneInActiveModes(scene, modeIds);
	const authoredHud = $derived(
		suppressCodedHud
			? hudScenesForMode(
					fullReplaceHudScenes(editorDoc.scenes).filter(inActiveModes),
					modeHudIds(),
					activeModeHud(),
				)
			: [],
	);

	const context = getContext();

	// Invisible Flow (Phase 4) — the runtime interpreter, built once the live editor doc
	// loads (it resolves authored screen ids to their scenes). ABSENT by default (no FlowDoc
	// ⇒ `createLinesFlow` returns `undefined`), so the interpreter is inert and every screen
	// mounts via the coded path below — byte-identical to current `main` (§7). When active,
	// it drives book-event dispatch (via `flowInterpreterHolder`, read by `playBook.ts`)
	// and the generic mounter resolves which authored screen mounts here.
	let flow = $state<LinesFlow | undefined>(undefined);
	// Invisible Flow v2 (Phase 4b) — the DEV-gated v2 handle + its z-ordered mounted containers,
	// mirrored into a rune so `<FlowV2Mount>` re-renders on show/hide. `undefined`/empty on a normal
	// boot (`__IE_FLOW_V2_DOC__` unset) ⇒ v2 inert, the v1/coded path above is untouched (parity).
	let flowV2ResolveScene = $state<((sceneId: string) => Scene | undefined) | undefined>(undefined);
	let flowV2Containers = $state<MountedContainerRef[]>([]);
	// The v2 handle itself, mirrored into a rune so `<FlowV2Messages>` (the §6.3 text-message overlay)
	// re-renders once the flow is built at load. Independent of `flowV2DrivesScreens` — a book-events-only
	// flow that owns no screens can still author messages. `undefined` with no v2 flow (parity: nothing).
	let flowV2Handle = $state<LinesFlowV2 | undefined>(undefined);
	// Whether a v2 flow drives the game — when true `<FlowV2Mount>` is the SOLE scene renderer, so the
	// v1 interpreter is NOT built (`flow` is undefined) and the coded AUTHORED-scene mounts below
	// suppress on `flowV2DrivesScreens` (they'd double FlowV2Mount). Engine-owned bands (reels, gates) instead
	// gate on `isFlowDriven` (v1 OR v2) so they still hide during loading and reveal on the game screen.
	let flowV2DrivesScreens = $state(false);
	// Authored background scenes (§ persistent-bg-scene). An author's "New background screen"
	// gets a fresh-id scene with `space: 'background'` (NOT the coded `background`-id /
	// `space:'canvas'` spine anchor above) carrying full-bleed art. `backgroundScenes` selects
	// them by SPACE (not id, so a custom scene id mounts) in editor order; `hasAuthoredBackground`
	// is true only when one has real content (not just the coded `Background` bind anchor). Both
	// are the engine-layout contract, shared with the editor + other games. `apps/lines`' fallback
	// ships NO `space:'background'` scene (lines.ts has none on purpose), so the list is empty and
	// the flag is false ⇒ byte-identical to today (parity).
	// ONLY the coded (non-flow-driven) path mounts these persistently. Under a v2 flow that drives
	// the screens the space is a COORDINATE FRAME and nothing more: the scene is an ordinary
	// container that `<FlowV2Mount>` shows/hides exactly as authored (owner direction 2026-09-02 —
	// a splash on a background-space screen kept painting behind the game after its
	// `hideContainer`, because this always-on layer drew a second copy the flow couldn't touch).
	const bgScenes = $derived(
		flowV2DrivesScreens ? [] : backgroundScenes(editorDoc.scenes).filter(inActiveModes),
	);
	// Design doc §14 (win-overlay twin) — whether the v2 flow OWNS the `setWin` event (the ownership
	// trigger for the headless win driver — an authored win container of ANY name), and the static set
	// of `showContainer{awaitComplete}` target container ids (the name-agnostic celebration-lock
	// signal). Both default off/empty ⇒ no v2 flow / a non-owning flow is byte-identical (parity).
	let flowOwnsSetWin = $state(false);
	let winAwaitTargets = $state<ReadonlySet<string>>(new Set());
	// The static set of container ids the v2 doc ever `hideContainer`s — which is what decides
	// whether a container's MOUNT means "on screen now" or means nothing at all. See the celebration
	// lock below and `hideContainerIds`. Empty ⇒ no v2 flow (parity).
	let flowHideTargets = $state<ReadonlySet<string>>(new Set());
	// The interpreter's CURRENT active SET (the pin-driven active-SET model), mirrored into a
	// rune so screen add/remove re-mounts. Render-ordered: base first, later-activated overlays on
	// top. The interpreter's internal active set is a plain array (not a rune), so it is pushed
	// here via `onActiveScreensChange` (wired in `onMount`) + seeded from `flow.activeScreenIds` at
	// boot. EMPTY ⇒ inert (no FlowDoc) ⇒ pure coded path.
	let activeScreenIds = $state<readonly string[]>([]);
	// Invisible Flow entrance transitions (the droppable "Transition" node, design doc §6). When a
	// flow edge carries a `transition`, the interpreter SURFACES it here per activation (via
	// `onActiveScreensChange`'s `entrances`); the mount sites below wrap the newly-activated screen
	// in `<FlowScreenMount>`, which mounts it HIDDEN (alpha 0) and tweens it in — so there is no
	// full-alpha flash. Keyed by screen id; an entry is set when a screen enters WITH a transition
	// and cleared when it leaves the active set (so a fade never replays while the screen persists,
	// and a hard-cut edge never has an entry ⇒ instant mount, parity §7). EMPTY on an inert boot.
	let entranceById = $state<Record<string, FlowEntranceTransition | undefined>>({});
	// Apply an active-set change: prune entrances for screens that left, then record the entrance
	// transition for each freshly-entered screen (undefined for a hard cut). Called from the
	// interpreter's `onActiveScreensChange` callback (wired in `onMount`).
	const applyActiveScreens = (
		screenIds: readonly string[],
		entrances: readonly { screenId: string; transition?: FlowEntranceTransition }[],
	): void => {
		const present = new Set(screenIds);
		const next: Record<string, FlowEntranceTransition | undefined> = {};
		for (const [id, t] of Object.entries(entranceById)) if (present.has(id)) next[id] = t;
		for (const e of entrances) next[e.screenId] = e.transition;
		entranceById = next;
		activeScreenIds = screenIds;
	};
	// The TOPMOST active screen (the last-activated) — the transient takeover/celebration layer.
	// `undefined` ⇒ the active set is empty (inert) ⇒ pure coded path.
	const activeScreenId = $derived(activeScreenIds[activeScreenIds.length - 1]);
	// Flow-driven (v1 OR v2): the engine-owned bands (reels, HUD chrome) gate on THIS instead of the
	// v1-only `!flow`, so under v2 they still hide during loading and reveal once the game screen shows.
	const isFlowDriven = $derived(!!flow || flowV2DrivesScreens);
	// Whether the base-game screen node is currently active. The reel board + basegame mount gate
	// on this: during `loading` (basegame not yet active) the reels are HIDDEN; once loading
	// completes and basegame activates, they appear. INERT-FLOW FALL-THROUGH: with no FlowDoc the
	// interpreter is undefined and this is `false` — but the board then falls through to its coded
	// unconditional mount (the `!flow` fall-through below), so a non-flow game is unchanged (§7).
	const isBasegameActive = $derived(activeScreenIds.includes(basegameScreenId));
	// Design doc §14 (win-overlay twin) — the SINGLE decision for which WIN surface mounts, so the
	// mount site can't drift from the exactly-one-`winUpdate`-subscriber invariant. See
	// `resolveWinMount`.
	const winMount = $derived(
		resolveWinMount({ flowV2DrivesScreens, flowOwnsSetWin, basegameOverlaysHasCodedWinGate }),
	);
	// The base-game screen's resolved scene for the generic mounter. Resolved whenever the
	// base-game screen is ACTIVE (in the active set) — NOT only when it is the topmost screen —
	// so an overlay layered ON TOP (a celebration) never drops the base's authored below/above-reel
	// slices back to the coded fallback. `undefined` ⇒ the interpreter is not driving basegame ⇒
	// `<FlowMount>` renders the coded fall-through.
	const basegameMount = $derived.by(() => {
		if (!isBasegameActive) return undefined;
		const decision = flow?.mounter.resolve(basegameScreenId);
		if (decision?.kind === 'authored' && decision.screenId === basegameScreenId) {
			return decision.scene as Scene;
		}
		return undefined;
	});
	// Flow-driven Phase 1 (design doc flow-driven-game §1) — the loading splash is a Flow screen,
	// mounted through the GENERIC active-screen path (below), NOT a coded `<LoadingScreen>`. The
	// interpreter ALWAYS exists at boot (a synthesized default `loading → basegame` flow when no
	// doc is authored — see `flowRuntime.svelte.ts`), STARTS on `loading` (its `initial` screen),
	// and the loading bar's `completeOnLoaded` capability (or a tap) fires the `complete` edge →
	// `activeScreenId` becomes `basegame`. The coded `<LoadingScreen>` splash + its
	// `showLoadingScreen` flag are GONE.
	// The loading screen's id, resolved by ROLE (id-independent): the `role:'loading'` scene, else
	// the legacy `loading` id (parity). A renamed loading scene is still recognized as the splash,
	// and reserved below so it doesn't ALSO mount as a generic overlay/extra scene.
	const loadingScreenId = $derived(loadingSceneId(editorDoc.scenes));
	// The player is IN: the boot has settled which path runs, and under a flow the board is on screen
	// with no loading / tap-to-start screen over it. A resumed round plays only from here, so it never
	// runs (and finishes) behind the splash. No flow ⇒ true once the boot settles, as before. "Over
	// it" = stacked above the base game, so a loading screen a flow leaves mounted beneath the board
	// (a non-`complete` v1 edge, a v2 container never hidden) cannot hold a resume forever.
	let bootSettled = $state(false);
	const isLoadingScreenUp = $derived.by(() => {
		const v1Loading = activeScreenIds.indexOf(loadingScreenId);
		if (v1Loading > activeScreenIds.indexOf(basegameScreenId)) return true;
		const z = (sceneId: string) => flowV2Containers.find((c) => c.sceneId === sceneId)?.z;
		const v2Loading = z(loadingScreenId);
		const v2Base = z(basegameScreenId);
		return v2Loading !== undefined && (v2Base === undefined || v2Loading > v2Base);
	});
	const isPlayerIn = $derived(
		bootSettled && (!isFlowDriven || (isBasegameActive && !isLoadingScreenUp)),
	);
	// Phase-5 above-reel z-order (design doc §11.5 follow-up B.1). When the interpreter
	// AUTHORS basegame it owns the basegame mount, but the board MainContainer is engine-owned
	// (the reel is not a flow screen), so the interpreter must STILL reproduce the coded
	// below-reel → board → above-reel stacking. We split the AUTHORED scene at its top-level
	// reelGrid index exactly as the coded path splits `basegameScene` (lines below), feed the
	// below-reel slice to `<FlowMount>`, and render the above-reel slice after the board —
	// unconditionally (no `!basegameMount` gate), so an authored basegame stacks identically
	// to the coded one. No reelGrid in the authored scene ⇒ single pass (the whole scene goes
	// below-reel, above is undefined), byte-identical to a nested-reelGrid coded boot.
	const mountReelGridIndex = $derived(
		basegameMount ? basegameMount.nodes.findIndex((node) => node.kind === 'reelGrid') : -1,
	);
	const basegameMountBelowReel = $derived.by((): Scene | undefined => {
		if (!basegameMount) return undefined;
		return mountReelGridIndex < 0
			? basegameMount
			: { ...basegameMount, nodes: basegameMount.nodes.slice(0, mountReelGridIndex) };
	});
	const basegameMountAboveReel = $derived.by((): Scene | undefined => {
		if (!basegameMount || mountReelGridIndex < 0) return undefined;
		return { ...basegameMount, nodes: basegameMount.nodes.slice(mountReelGridIndex + 1) };
	});

	// Phase 4 (flow-driven-game §4) — the GENERIC active-screen TAKEOVER mount. When the
	// interpreter's active screen is an authored exclusive screen that is NOT `basegame` (the
	// persistent base, mounted via the reel-split above), it is a TOP-LAYER takeover: the
	// `loading` splash at boot, and TRANSIENT celebrations (`bigWin`, `freeSpinIntro`, any future
	// authored id) mid-round. The base game (board) PERSISTS behind it (the reel is engine-owned,
	// not a flow screen), so a celebration/splash overlays the reels rather than replacing them.
	// This is a single GENERIC mount, NOT per-id special-casing — the swap to ANY such screen
	// (loading included) reproduces the right stacking. The scene is `<LayoutScene>`-mounted,
	// which self-wraps by `scene.space` and honours `scene.visibleSource` (no double-wrap). It
	// renders ONLY while that screen is the active screen (gated on `activeScreenId` via the
	// resolve below), so the loading splash unmounts on the `complete` swap to `basegame`.
	// `undefined` ⇒ nothing extra mounts (the active screen IS `basegame`, or falls through / has
	// no backing scene). `loading` is STILL reserved (below) so it doesn't ALSO mount as an
	// overlay/extra scene.
	const activeScreenTakeover = $derived.by((): Scene | undefined => {
		if (activeScreenId === basegameScreenId) return undefined;
		// The HUD scenes render through the `<UI>` chrome (gated on `isHudActive`), never as a
		// generic takeover LayoutScene — skip them here so a flow-managed HUD that is the topmost
		// active screen doesn't ALSO double-mount as a raw takeover layer.
		if (HUD_SCENE_IDS.includes(activeScreenId as (typeof HUD_SCENE_IDS)[number])) return undefined;
		const decision = flow?.mounter.resolve(activeScreenId);
		return decision?.kind === 'authored' ? (decision.scene as Scene) : undefined;
	});

	// Phase 3 (flow-driven-game §3) — DRIVE the interpreter's `condition` transitions. A
	// `condition` edge re-checks its `$engine.*` guard only when the game pings `flow.evaluate()`
	// (presentation.ts `evaluate`); without this, the `condition` trigger can never fire (the
	// pre-Phase-3 dead state). This effect reads the SAME live engine values the bounded
	// `linesEngineReader` (flowRuntime) exposes — so it re-runs (and pings) whenever any of them
	// changes — and is a SAFE no-op when the interpreter is inert: with no FlowDoc, `flow` is
	// `undefined` ⇒ `flow?.evaluate()` is a no-op ⇒ byte-identical to `main` (§7). A FlowDoc that
	// authors no `condition` edge makes `evaluate()` itself a no-op (the HSM finds no matching
	// edge), so this is parity-safe for the Phase-1/2/4 fixtures too. Kept cheap: it tracks only
	// the closed reader vocabulary (free-spin counter, game type, the win/balance/bet feeds).
	$effect(() => {
		// Touch every value the reader can expose so the effect re-runs on any of their changes.
		void stateBet.balanceAmount;
		void stateBet.winBookEventAmount;
		void stateBetDerived.betCost();
		void stateGame.gameType;
		void stateUi.freeSpinCounterTotal;
		void stateUi.freeSpinCounterCurrent;
		void stateBet.autoSpinsCounter;
		void flow?.evaluate();
	});

	// §20.1 — generic doc-driven scene mounting. Every scene the game ALREADY mounts/handles
	// by hard-coded id (below), PLUS any FlowDoc-authored screen ids (the interpreter owns
	// those — `flow.mounter.authoredScreenIds()` — so a Flow-mounted screen isn't also mounted
	// here). `background`-space scenes aren't listed: `extraMountScenes` excludes them by
	// space (they're handled by `backgroundScenes`/§25), and the coded `background`-id /
	// `space:'canvas'` spine anchor IS listed so it never double-mounts.
	const RESERVED_SCENE_IDS = [
		'basegame',
		'basegameOverlays',
		'winVisual',
		'freeSpinIntro',
		'freeSpinIntroVisual',
		'freeSpinCounter',
		'freeSpinOutro',
		'freeSpinOutroVisual',
		'specialBook',
		'hudBar',
		'hudCorners',
		'loading',
		'background',
		// The board glow is mounted by its own BELOW-reel path (behind the board). Listed here so
		// it never ALSO mounts as a generic overlay — that would draw it ON TOP of the reels, and
		// (since the stock scene carries the coded `BoardFrame` anchor) would mount the coded glow
		// a second time on an un-authored game.
		'boardGlow',
		// The Hold and Win beat screens (`referenceLayouts/holdAndWin.ts`) are a flow's to show around
		// their beat, like the free-spin intro/outro above: mounted generically they would hold a tap
		// dim over every respin, and the Lucky Spin / jackpot ones would double the coded banner.
		'featureIntro',
		'featureOutro',
		'wheel',
		'luckySpin',
		'jackpotWin',
		// The buy-bonus SELECT menu is mounted by its OWN `<BuyFeatureScreen>` takeover (below),
		// gated on `stateModal`. Reserved so it never ALSO mounts as an always-on generic overlay
		// (which would show the feature cards permanently).
		'buyFeature',
		// The buy-bonus CONFIRM dialog is mounted by its OWN `<BuyBonusConfirm>` takeover (below),
		// gated on `stateModal`. Reserved so it never ALSO mounts as an always-on generic overlay
		// (which would show the confirm dialog permanently).
		'buyConfirm',
		// The round-start CONFIRM is mounted by its OWN `<RoundStartConfirm>` takeover (below), gated
		// on a pending confirmation — same reason as `buyConfirm`.
		'roundConfirm',
		// The bet-amount and auto-spin menus are shown ONLY by the flow (a `Show` wired off the HUD
		// bet readout's `onBetMenu` / the auto-spin button's `onAutoSpin`). Unlike the buy screens
		// they have no coded takeover at all — with no flow wiring the coded HTML modal opens instead
		// and these scenes mount nowhere, which is the intent. Reserved so an authored menu can never
		// mount as an always-on generic overlay, i.e. the whole bet grid painted permanently over the
		// game (exactly the buy-feature failure above).
		'betMenu',
		'autoSpin',
	] as const;
	const reservedSceneIds = $derived(
		new Set<string>([
			...RESERVED_SCENE_IDS,
			// The role-resolved loading/basegame scenes (custom ids included) — so a renamed,
			// role-tagged loading/base scene is handled by its own path and never ALSO mounts
			// here as a generic overlay (the double-background/double-splash the owner hit).
			loadingScreenId,
			basegameScreenId,
			// The role-resolved buy SELECT/CONFIRM scenes (custom ids included) — a scene tagged
			// with the `buyFeature`/`buyConfirm` ROLE is mounted ONLY by its own `<BuyFeatureScreen>`/
			// `<BuyBonusConfirm>` takeover (gated on the buy modal), so it must be reserved here or it
			// would ALSO mount as an always-on generic overlay (the very failure a `basegame`-tagged buy
			// scene shows today — cards rendered permanently over the base game).
			buyFeatureSceneId(editorDoc.scenes),
			buyConfirmSceneId(editorDoc.scenes),
			// The role-resolved bet-menu / auto-spin scenes (custom ids included) — same reason as the
			// buy pair: a menu tagged with the role but named anything must not fall through to the
			// generic overlay mount and paint itself over the game.
			betMenuSceneId(editorDoc.scenes),
			autoSpinSceneId(editorDoc.scenes),
			...(flow?.mounter.authoredScreenIds() ?? []),
		]),
	);
	// The author's NEW screens (custom ids, non-background space) the game would otherwise
	// never mount. Empty for `apps/lines`' fallback doc (it reserves all its ids + ships no
	// extra scene) ⇒ the `{#each}` renders nothing ⇒ byte-identical to `main` (parity).
	// `hud_`-prefixed author HUD screens are EXCLUDED here — they mount as the top HUD layer
	// (`authoredHud` below), so leaving them in `extraScenes` would double-mount them.
	const extraScenes = $derived(
		extraMountScenes(editorDoc.scenes, reservedSceneIds).filter(
			(scene) => !scene.id.startsWith('hud_') && inActiveModes(scene),
		),
	);

	// Cross-screen z-order (design doc §11.5 follow-up C). The LAYERABLE scenes — the HUD
	// chrome, the base-game overlays, the special-book bonus, custom author overlays, and the
	// flow takeover — now paint in the editor's screen-LIST order (their position in
	// `editorDoc.scenes`) rather than this component's fixed markup sequence. `sceneLayerZIndex`
	// maps each scene's doc index into a band ABOVE the base game and BELOW the engine-owned top
	// band (`LAYER_BAND_TOP`, where the coded free-spin counter + info overlay live, so a
	// reorder can never bury them) — or into the PINNED band when the author ticked
	// "Always on top". The reel board (`<MainContainer>`) is NOT layerable — it stays between the
	// below/above-reel slices, unmoved. PARITY: the reference layout lists these scenes in the
	// same relative order as the old markup (HUD → basegameOverlays → specialBook), so an
	// un-reordered / flow-less boot assigns z that reproduces today's stacking (`undefined` ⇒ no
	// override, default insertion order).
	// The coded HUD is ONE chrome drawn from TWO scenes, so it needs a single z: it takes the
	// LOWER of the pair (leaving the reference layout's placement reproduces today's stacking).
	// But if either scene is PINNED ("Always on top"), the lower one would silently win and the
	// editor's TOP badge would do nothing — so a pinned half pins the whole chrome.
	const hudZIndex = $derived.by(() => {
		const bar = sceneLayerZIndex(editorDoc.scenes, 'hudBar');
		const corners = sceneLayerZIndex(editorDoc.scenes, 'hudCorners');
		if (isSceneLayerPinned(bar) || isSceneLayerPinned(corners)) {
			return Math.max(bar ?? LAYER_BAND_TAKEOVER, corners ?? LAYER_BAND_TAKEOVER);
		}
		return Math.min(bar ?? Number.MAX_SAFE_INTEGER, corners ?? Number.MAX_SAFE_INTEGER);
	});
	// The HUD's menu drawer (its dim + PayTable/Rules/Settings buttons) lives INSIDE the
	// `<UI>` chrome, so it can never out-z a SIBLING container — and the win line is fixed
	// above the HUD at `LAYER_BAND_WIN_PRESENTATION` (deliberately, so board art can't bury
	// it). That leaves the win line bleeding through the menu's dim while it's open. While —
	// and only while — the drawer is open, lift the whole chrome above the win band so it
	// covers the line; a closed menu is byte-identical to before (parity). `Math.max` never
	// LOWERS an already-pinned HUD, and the lift stays below the pinned takeover band + the
	// engine top band, so a big-win takeover / always-on-top celebration still covers the menu.
	const hudZIndexEffective = $derived(
		stateUi.menuOpen ? Math.max(hudZIndex, LAYER_BAND_WIN_PRESENTATION + 1) : hudZIndex,
	);
	const basegameOverlaysZIndex = $derived(sceneLayerZIndex(editorDoc.scenes, 'basegameOverlays'));
	// The engine-owned outro count-up driver mounts at the `freeSpinOutro` scene's OWN band (its
	// authored container's z), and BEFORE `<FlowV2Mount>` in markup — so its count-up press surface
	// sits beneath the authored outro screen (same-z, insertion-order tiebreak), exactly as the win
	// engine gate sits below the win visual.
	const freeSpinOutroZIndex = $derived(sceneLayerZIndex(editorDoc.scenes, 'freeSpinOutro'));
	const specialBookZIndex = $derived(sceneLayerZIndex(editorDoc.scenes, 'specialBook'));
	// The active-screen TAKEOVER layers like every other screen: by its position in the editor's
	// screen list, unless the author ticked "Always on top" (`Scene.alwaysOnTop` ⇒ the fixed
	// TAKEOVER band, above every layerable scene and below the engine top band — for a transient
	// overlay that must never be buried, e.g. a boot splash or a big-win celebration).
	// This used to be the hard-coded `LAYER_BAND_TAKEOVER` for EVERY takeover, which silently
	// pinned a PERSISTENT flow-active screen (e.g. an authored progress bar) above everything with
	// no way to re-layer it from the editor and no clue why. A screen not in the doc keeps the
	// fixed band (parity for a fallback/un-authored boot).
	const activeScreenTakeoverZIndex = $derived(
		sceneLayerZIndex(editorDoc.scenes, activeScreenId) ?? LAYER_BAND_TAKEOVER,
	);

	// Component signal feed (§8.5) — the EVENT sibling of the value/action feeds
	// above. Maps the game's win presentation events → signal NAMES from the
	// catalog, so a placed `componentInstance` whose `kind:'spine'` node carries
	// `cues:[{ signal:'win'|'bigWin', animation, loop }]` plays that animation when
	// these fire. Registration alone is a no-op: it has NO effect until such a cued
	// component instance is placed in a scene (pure parity with the doc-less boot) —
	// `<ComponentInstance>` only subscribes a signal a cue names. `win` fires when the
	// win presentation begins (`winShow`); `bigWin` fires only on the `'big'` win-level
	// tier (covers big/superwin/mega/epic/max — see engine-game's winLevelMap).
	// `freeSpinStart`/`freeSpinEnd` fire on the free-spin lifecycle: the intro presents
	// (`freeSpinIntroShow`) and the outro presents (`freeSpinOutroShow`) — cues a flow's
	// `freeSpinTrigger`/`freeSpinEnd` choreography fires (the coded handlers are state-only and
	// fire neither). The existing emitter events, reused (no new event).
	registerComponentSignals({
		win: eventSignal((run) => context.eventEmitter.subscribe({ winShow: () => run() })),
		bigWin: eventSignal((run) =>
			context.eventEmitter.subscribe({
				winUpdate: (e) => {
					if (e.winLevelData?.type === 'big') run();
				},
			}),
		),
		// Design doc §14 (win-overlay twin of the FS-7 outro) — fired when the WIN overlay count-up
		// FINISHES (`WinGate` broadcasts `winCountUpComplete`). An authored `bigWin` container's
		// `tapToContinue` / prompt sets `tapArmAfterSignal: 'winCountUpComplete'` (or `hiddenUntilSignal`)
		// so it appears only after the count. Un-authored ⇒ nothing subscribes ⇒ inert (parity). SEED off
		// `winState.countUpComplete` on subscribe: a ZERO / instant count-up finishes in the same tick the
		// container mounts, so the broadcast can fire BEFORE this subscribes and the emitter has no replay
		// (the fire is lost ⇒ the tap never arms). Mirrors `freeSpinOutroCountUpComplete`.
		winCountUpComplete: eventSignal((run) => {
			if (winState.countUpComplete) run();
			return context.eventEmitter.subscribe({ winCountUpComplete: () => run() });
		}),
		freeSpinStart: eventSignal((run) =>
			context.eventEmitter.subscribe({ freeSpinIntroShow: () => run() }),
		),
		freeSpinEnd: eventSignal((run) =>
			context.eventEmitter.subscribe({ freeSpinOutroShow: () => run() }),
		),
		// FS-7 decision D — the outro WIN-LEVEL branch, fired off the SAME `freeSpinOutroCountUp`
		// broadcast the driver drives the count-up from (so the art reveals in lockstep with the
		// count). Big vs small mirrors the `bigWin` signal's `winLevelData.type` test. An authored
		// outro gates its big/small art with `hiddenUntilSignal: 'freeSpinOutroBigWin'`/`'…SmallWin'`
		// (plain art) or plays a spine cue on them. Un-authored ⇒ nothing subscribes ⇒ inert (parity).
		freeSpinOutroBigWin: eventSignal((run) =>
			context.eventEmitter.subscribe({
				freeSpinOutroCountUp: (e) => {
					if (e.winLevelData?.type === 'big') run();
				},
			}),
		),
		freeSpinOutroSmallWin: eventSignal((run) =>
			context.eventEmitter.subscribe({
				freeSpinOutroCountUp: (e) => {
					if (e.winLevelData?.type !== 'big') run();
				},
			}),
		),
		// FS-7 follow-up — fired when the outro count-up FINISHES (the driver broadcasts
		// `freeSpinOutroCountUpComplete`). An authored `tapToContinue` / prompt sets
		// `tapArmAfterSignal: 'freeSpinOutroCountUpComplete'` (or `hiddenUntilSignal`) so it appears only
		// after the count. Un-authored ⇒ nothing subscribes ⇒ inert (parity). SEED off the driver's
		// `countUpComplete` latch on subscribe: a ZERO / instant count-up (level 1 `'zero'`, `amount:0`)
		// finishes in the same tick the authored screen mounts, so the broadcast can fire BEFORE this
		// subscribes and the emitter has no replay (the fire is lost ⇒ the tap never arms ⇒ stuck outro).
		// Seeding a late subscriber from the latch makes arming order-independent; a real win's long
		// count-up keeps the latch false until well after the screen subscribes, so it is unaffected.
		freeSpinOutroCountUpComplete: eventSignal((run) => {
			if (freeSpinOutroState.countUpComplete) run();
			return context.eventEmitter.subscribe({ freeSpinOutroCountUpComplete: () => run() });
		}),
		// The book expanding-symbol reveal lifecycle — an authored spine cue on the author's own
		// reveal component plays with the mechanic (mirrors `freeSpinStart`/`freeSpinEnd`). These
		// are payload-less: the chosen symbol comes from the `specialSymbol` value source + the
		// `expandingSymbol` def's live art, NOT through the signal.
		specialBookReveal: eventSignal((run) =>
			context.eventEmitter.subscribe({ specialBookReveal: () => run() }),
		),
		specialBookHide: eventSignal((run) =>
			context.eventEmitter.subscribe({ specialBookHide: () => run() }),
		),
		// The free-spin board-glow lifecycle — so an authored glow component's spine cues play the
		// enter/exit the coded `BoardFrame` hard-codes as `reelhouse_glow_start`→`_idle`→`_exit`.
		// These ride the EXISTING `boardFrameGlow*` emitter events (no new event), which are both
		// declared cues AND fired by the coded `freeSpinTrigger`/`freeSpinEnd` handlers — so an
		// authored glow gets the same timing whether the flow owns those events or not.
		boardGlowShow: eventSignal((run) =>
			context.eventEmitter.subscribe({ boardFrameGlowShow: () => run() }),
		),
		boardGlowHide: eventSignal((run) =>
			context.eventEmitter.subscribe({ boardFrameGlowHide: () => run() }),
		),
	});

	// The board glow is a STATE — lit for the whole free-spin feature — but it arrives as one-shot
	// `boardFrameGlow*` cues. `<BoardFrame>` renders it from INSIDE the base-game block below, which
	// unmounts whenever the base-game screen leaves the active set; a flow that hides `basegame` for a
	// transition (the book-reveal chain does exactly that, across a delay) therefore tears down its
	// subscription, so a cue fired in that window reached NOBODY and the glow never came back for the
	// rest of the feature. Tracking it HERE — on the always-mounted `<Game>` — makes it survive that
	// unmount, and `<BoardFrame>` re-arms off the flag on mount. Un-owned cues fire this identically,
	// so a coded/v1 game is unchanged.
	let boardGlowActive = $state(false);
	context.eventEmitter.subscribeOnMount({
		boardFrameGlowShow: () => (boardGlowActive = true),
		boardFrameGlowHide: () => (boardGlowActive = false),
	});

	// FREE-SPIN CELEBRATION VISIBILITY, for a flow that MOUNTS its intro/outro once and toggles them
	// by CUE (the model projects seeded before 2026-09-28 were born with — see `hideContainerIds`).
	// Under that model the container is shown at start-up and never hidden, so the celebration lock
	// below cannot read its mount; these are the cues the doc's own choreography fires and the bound
	// visuals already subscribe to (`<FreeSpinIntroVisual>`, `<FreeSpinOutroVisual>`), so they track
	// what is actually drawn. Same shape as the board-glow latch above.
	let freeSpinIntroCueShown = $state(false);
	let freeSpinOutroCueShown = $state(false);
	context.eventEmitter.subscribeOnMount({
		freeSpinIntroShow: () => (freeSpinIntroCueShown = true),
		freeSpinIntroHide: () => (freeSpinIntroCueShown = false),
		freeSpinOutroShow: () => (freeSpinOutroCueShown = true),
		freeSpinOutroHide: () => (freeSpinOutroCueShown = false),
	});

	// SPIN-BUTTON CELEBRATION LOCK — maintain `stateUi.celebrationLock` so `hasCelebrationOverlay()`
	// (read by `utils-shared/spinStop`) is correct on every presentation path: coded, flow-v1 and
	// flow-v2 alike. The RULE — which signals mean "a celebration owns the screen", and why a
	// container's mount is trustworthy under one authoring model and meaningless under the other —
	// lives once in `../game/celebrationLock`, where it can be asserted headlessly.
	//
	// A big win whose presentation is a HUD count-up + tap (no celebration screen mounted at all) is
	// not covered here: it is caught by `hasContinuePress()`, OR'd in at the `spinStop` chokepoint.
	$effect(() => {
		const lock = resolveCelebrationLock({
			activeScreenIds,
			flowV2DrivesScreens,
			flowHideTargets,
			winAwaitTargets,
			introCueShown: freeSpinIntroCueShown,
			outroCueShown: freeSpinOutroCueShown,
		});
		stateUi.celebrationLock.intro = lock.intro;
		stateUi.celebrationLock.outro = lock.outro;
		stateUi.celebrationLock.win = lock.win;
		winState.flowHoldsPresentation = lock.flowHoldsPresentation;
	});

	// §16.4 B6.4 — the spin/stop state machine. The decision itself lives ONCE in
	// `utils-shared/spinStop`, shared with `ButtonBetProvider.svelte`, so the parametric
	// `spin` action and the coded `ButtonBet` cannot drift (they were duplicated verbatim
	// and did). Slam stop is always on: a rolling round shows a live STOP.
	const getSpinKey = (): SpinButtonKey =>
		getSpinButtonKey({ isIdle: context.stateXstateDerived.isIdle() });
	// Reels rolling on a plain bet (NOT an autoplay sequence) → spin the frame. Shared with the coded
	// `ButtonBetProvider`, so a between-spins hold parks the frame on both (`isSpinButtonSpinning`).
	const isSpinning = () =>
		isSpinButtonSpinning({ isPlaying: context.stateXstateDerived.isPlaying() });

	// Phase B6.2 — register the 7 Borut button actions beside the value feed above.
	// Each entry LIFTS the coded HUD button's `onpress`/`disabled`/`active` logic
	// verbatim (from `components-ui-pixi`), wired to the SAME `context`
	// (`eventEmitter` + `stateXstateDerived`) and `state-shared` selectors the coded
	// buttons use, so a `button` componentInstance bound to one of these names behaves
	// identically to its coded counterpart. `boolSource` replays each live derived as
	// the registry's `BoolSource`. Nothing mounts a button instance yet (B6.3/B6.4),
	// so this is pure registration plumbing — no render change.
	// The idle→bet / else→slam-stop decision — the SAME `runSpinOrSlamStop` the coded
	// `ButtonBetProvider` presses, so an authored Spin pin runs exactly what the hard-coded button
	// does (design doc §8.2/§8.5). Not the sound (that stays on the button press).
	const doSpinBetOrStop = (): void =>
		runSpinOrSlamStop({
			isIdle: context.stateXstateDerived.isIdle(),
			broadcast: context.eventEmitter.broadcast,
		});

	// Shared coded bodies for the HUD action intents (design doc §8.5). Each is the exact
	// press behaviour of the matching coded button, extracted so ONE source of truth serves
	// BOTH the registered `onpress` (a directly-bound `params.action` button) AND the flow
	// `invokeIntent` bridge (an authored `action → intent` edge). `doSpinBetOrStop` above is
	// the `spin` member. None of these plays the press SOUND — that stays on the button press
	// so an intent-invoked action doesn't double up the sound the button already made.
	const doIncreaseBet = (): void => {
		const biggest = stateConfig.betAmountOptions[stateConfig.betAmountOptions.length - 1];
		const nextBigger = [...stateConfig.betAmountOptions]
			.sort((a, b) => a - b)
			.find((option) => option > stateBet.betAmount);
		stateBetDerived.setBetAmount(nextBigger || biggest);
	};
	const doDecreaseBet = (): void => {
		const smallest = stateConfig.betAmountOptions[0];
		const nextSmaller = [...stateConfig.betAmountOptions]
			.sort((a, b) => b - a)
			.find((option) => option < stateBet.betAmount);
		stateBetDerived.setBetAmount(nextSmaller || smallest);
	};
	const doToggleTurbo = (): void => {
		stateBetDerived.updateIsTurbo(!stateBet.isTurbo, { persistent: true });
	};
	const doOpenMenu = (): void => {
		stateUi.menuOpen = true;
	};
	const doCloseMenu = (): void => {
		stateUi.menuOpen = false;
	};
	// Runs INSIDE the press's call stack (both the coded path and the flow's
	// `toggleFullscreen` intent command reach it synchronously) — the browser refuses
	// `requestFullscreen` outside a user gesture, so nothing may await ahead of it.
	const doToggleFullscreen = (): void => {
		toggleFullscreen();
	};
	const doOpenPayTable = (): void => {
		stateUi.menuOpen = false;
		stateModal.modal = { name: 'payTable' };
	};
	const doOpenGameRules = (): void => {
		stateUi.menuOpen = false;
		stateModal.modal = { name: 'gameRules' };
	};
	const doOpenSettings = (): void => {
		stateUi.menuOpen = false;
		stateModal.modal = { name: 'settings' };
	};
	const doToggleSound = (): void => {
		stateSound.volumeValueMaster = stateSound.volumeValueMaster === 0 ? 50 : 0;
	};
	const doAutoSpin = (): void => {
		stateBetDerived.hasAutoBetCounter()
			? (stateBet.autoSpinsCounter = 0)
			: (stateModal.modal = { name: 'autoSpin' });
	};
	// ButtonBuyBonus coded body (design doc §8.5): an ARMED `activate` mode disarms back to BASE;
	// otherwise open the buy-bonus select modal. Extracted so the registered `buyBonus` press can
	// route through the flow gate (a flow that OWNS the `buyBonus` intent drives it) and fall
	// through to this exact behaviour when un-owned — byte-identical to today (parity §8.8).
	const codedOpenBuyModal = (): void => {
		if (stateBetDerived.activeBetMode()?.type === 'activate') {
			stateBet.activeBetModeKey = 'BASE';
		} else {
			stateModal.modal = { name: 'buyBonus' };
		}
	};

	// The intent host bridge (design doc §8.5): the game IMPLEMENTS `invokeIntent`, called by
	// the interpreter for every `action → intent` edge. Maps an intent NAME to its shared coded
	// body above, so a HUD button whose action pin is wired into a Base-game intent runs the
	// EXACT coded behaviour. An unknown intent is a safe no-op (parity §8.8). Shared with the
	// `onMount` interpreter build below so there is ONE dispatch table.
	const invokeHostIntent = (intent: string): void => {
		if (intent === 'spin') doSpinBetOrStop();
		else if (intent === 'increase') doIncreaseBet();
		else if (intent === 'decrease') doDecreaseBet();
		else if (intent === 'turbo') doToggleTurbo();
		else if (intent === 'menu') doOpenMenu();
		else if (intent === 'menuClose') doCloseMenu();
		else if (intent === 'buyBonus') stateModal.modal = { name: 'buyBonus' };
		else if (intent === 'payTable') doOpenPayTable();
		else if (intent === 'gameRules') doOpenGameRules();
		else if (intent === 'settings') doOpenSettings();
		else if (intent === 'soundToggle') doToggleSound();
		else if (intent === 'autoSpin') doAutoSpin();
		else if (intent === 'fullscreen') doToggleFullscreen();
	};

	// Functional action pin routing (design doc §8.5): if an author wired this button's `pin`
	// action into a flow intent, route the press THROUGH the flow (which calls `invokeIntent`)
	// and stop — one path, no double-fire. UNWIRED / inert interpreter ⇒ `hasFlowAction` is
	// false ⇒ `coded()` runs exactly as today (parity §8.8). Shared by every HUD action's
	// `onpress` so the flow-routing lives in ONE place, not copied per button.
	const routeActionThroughFlow = (pin: string, coded: () => void): void => {
		// Phase A — a v2 flow that OWNS this button's intent EVENT (`pin` = `spin`/`menu`/…) drives the
		// press: dispatch the event into v2 (its `event <pin>` runs presentation + an invoke-intent
		// action that calls back into `invokeHostIntent`, so the real bet/stop fires once). v2 not
		// owning it ⇒ fall through to v1's action edge, then the coded body (parity).
		const v2 = getFlowV2();
		if (v2?.ownsEvent(pin)) {
			void v2.dispatch(pin, {});
			return;
		}
		if (hasFlowAction(pin)) {
			emitFlowAction(pin);
			return;
		}
		coded();
	};

	// Hold-to-spin on the spin button is a per-project switch (Symbols → `winCycle.spinButtonHold`),
	// read at each press so a late-arriving runtime bundle still counts. Covers the coded button too.
	setSpinButtonHoldSource(() => bakedWinCycleConfig().spinButtonHold);
	registerComponentActions({
		// ButtonMenu — open the menu overlay. No disabled/active.
		menu: {
			onpress: () => {
				context.eventEmitter.broadcast({ type: 'soundPressGeneral' });
				routeActionThroughFlow('menu', doOpenMenu);
			},
		},
		// Fullscreen toggle. `active` mirrors the REAL browser state (the `fullscreenchange`
		// listener in `stateFullscreen`), not a local flip — the player can leave via Esc
		// without pressing this, and the icon must follow. Disabled where the API is absent
		// (iPhone Safari has no Fullscreen API; iPad does) or the jurisdiction forbids it.
		fullscreen: {
			onpress: () => {
				context.eventEmitter.broadcast({ type: 'soundPressGeneral' });
				routeActionThroughFlow('fullscreen', doToggleFullscreen);
			},
			active: boolSource(() => stateFullscreen.active),
			disabled: boolSource(
				() => !isFullscreenSupported() || stateConfig.jurisdiction.disabledFullscreen,
			),
		},
		// ButtonMenuClose — close the menu overlay. Mirrors `menu` so an authored
		// submenu's close button projects an `onMenuClose` pin: wired into a
		// `hideContainer` the flow closes the authored screen and the coded
		// `stateUi.menuOpen` body never runs; unwired it closes the coded drawer.
		menuClose: {
			onpress: () => {
				context.eventEmitter.broadcast({ type: 'soundPressGeneral' });
				routeActionThroughFlow('menuClose', doCloseMenu);
			},
		},
		// The four buttons that live INSIDE the menu overlay, lifted so each can be
		// placed as a STANDALONE authored button (no popup). Byte-for-byte the coded
		// `ButtonPayTable`/`ButtonGameRules`/`ButtonSettings`/`ButtonSoundSwitch`
		// `onpress` bodies. Each closes the overlay (harmless if it was never open) so
		// they behave identically whether reached via the popup or as a direct button.
		payTable: {
			onpress: () => {
				context.eventEmitter.broadcast({ type: 'soundPressGeneral' });
				doOpenPayTable();
			},
		},
		gameRules: {
			onpress: () => {
				context.eventEmitter.broadcast({ type: 'soundPressGeneral' });
				doOpenGameRules();
			},
		},
		settings: {
			onpress: () => {
				context.eventEmitter.broadcast({ type: 'soundPressGeneral' });
				doOpenSettings();
			},
		},
		// ButtonSoundSwitch — toggle master volume. `active` reflects sound-on so an
		// authored button can show its selected-state image while unmuted.
		soundToggle: {
			onpress: () => {
				context.eventEmitter.broadcast({ type: 'soundPressGeneral' });
				doToggleSound();
			},
			active: boolSource(() => stateSound.volumeValueMaster !== 0),
		},
		// ButtonBuyBonus — open the buy-bonus modal, or disable the active buy mode
		// when one is armed. Disabled while not idle; active while a buy mode is on.
		buyBonus: {
			onpress: () => {
				context.eventEmitter.broadcast({ type: 'soundPressGeneral' });
				routeActionThroughFlow('buyBonus', codedOpenBuyModal);
			},
			disabled: boolSource(
				() => !context.stateXstateDerived.isIdle() || !stateMetaDerived.hasFeatureBetModes(),
			),
			active: boolSource(() => stateBetDerived.activeBetMode()?.type === 'activate'),
		},
		// ButtonAutoSpin — open the auto-spin modal, or stop a running auto-spin.
		// Active while an auto-bet counter is live; disabled per its compound derived.
		autoSpin: {
			onpress: () => {
				context.eventEmitter.broadcast({ type: 'soundPressGeneral' });
				doAutoSpin();
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
		// while space is held, and while a non-skippable celebration owns the screen (the same
		// `isCelebrationLocked` read the spin button greys on — the `<ContinuePressMask>` already
		// eats the press there, so the button must look dead rather than silently do nothing).
		// (The stop-button turbo nuance is a `subscribeOnMount`
		// concern of the coded button, not part of the press/flag contract here.)
		turbo: {
			onpress: () => {
				context.eventEmitter.broadcast({ type: 'soundPressGeneral' });
				routeActionThroughFlow('turbo', doToggleTurbo);
			},
			disabled: boolSource(() => stateBet.isSpaceHold || isCelebrationLocked()),
			active: boolSource(() => stateBet.isTurbo),
		},
		// ButtonIncrease — step the bet to the next larger option. Disabled while not
		// idle or already at the biggest option.
		increase: {
			onpress: () => {
				context.eventEmitter.broadcast({ type: 'soundPressGeneral' });
				routeActionThroughFlow('increase', doIncreaseBet);
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
				routeActionThroughFlow('decrease', doDecreaseBet);
			},
			disabled: boolSource(
				() =>
					!context.stateXstateDerived.isIdle() ||
					stateBet.betAmount === stateConfig.betAmountOptions[0],
			),
		},
		// ButtonBetProvider + ButtonBet — spin/stop, now a FAITHFUL replication (B6.4).
		// `onpress` is `ButtonBetProvider.onpress`: sound, then the shared
		// `runSpinOrSlamStop` (idle → bet, else → slam the round). `disabled`/`label`
		// derive from the shared `getSpinButtonKey` exactly as `ButtonBet`'s coded
		// `UiSprite` grey + `Text` caption do: the button greys on the `*_disabled` keys,
		// and the caption is `bet()` on the `spin_*` keys else `stop()`.
		// `boolSource`/`textSource` replay those live deriveds to the bound `button`
		// instance. The Space hotkey the coded `ButtonBet` mounts is replaced in the
		// markup below, gated on the same flag.
		spin: {
			onpress: () => {
				context.eventEmitter.broadcast(
					getSpinPressSound({ isIdle: context.stateXstateDerived.isIdle() }),
				);
				// Functional action pin (design doc §8.5): an authored `spin` action → intent edge
				// routes the press THROUGH the flow; unwired / inert ⇒ the coded bet/stop runs
				// exactly as today (parity §8.8). Same shared helper the other HUD actions use.
				routeActionThroughFlow('spin', doSpinBetOrStop);
			},
			// When the project turns it on, holding the button is holding Space: the press fires at the
			// hold threshold, then rounds chain in turbo until release (`utils-shared/spinHold`).
			hold: spinButtonHold,
			disabled: boolSource(() => isSpinButtonDisabled(getSpinKey())),
			spinning: boolSource(isSpinning),
			label: textSource(() =>
				getSpinKey().startsWith('spin_') ? i18nDerived.bet() : i18nDerived.stop(),
			),
		},
	});

	// §16.4 B6.4 — replacement Space hotkey for the spin button. Once the cluster is
	// flipped to `componentInstance(button)` nodes (`HUD_BUTTON_INSTANCES`), the coded
	// `ButtonBet` (and its own `<OnHotkey hotkey="Space">`) is no longer mounted, so
	// Space would stop working. This mirrors `ButtonBet`'s binding exactly — same
	// `getSpinKey()` disabled rule (so Space is a live SLAM mid-round, like the button)
	// and the same shared press body. GATED on the flag so it never double-fires
	// alongside the coded button's own hotkey while the cluster is still coded.
	// `hasContinuePress()` mirrors `ButtonBetProvider`'s `hotkeyDisabled`: while a
	// press-to-continue overlay is up it OWNS Space, so this stands down and one keypress
	// runs the continue-press only. `ignorePressInProgress` as on `ButtonBet`: bet on a fresh press.
	const spinHotkeyDisabled = $derived(isSpinButtonDisabled(getSpinKey()) || hasContinuePress());
	// Whether the coded `<UI>` is mounted (gate documented at its mount below). Hold-Space continuous
	// play (`EnableSpaceHold`) lives in the coded `UIDefault`, so when that is absent — an authored
	// HUD, a v2 flow driving the screens, a flow-managed HUD not yet shown — the game mounts it.
	const codedHudMounted = $derived(
		(!isHudFlowManaged || isHudActive) && !suppressCodedHud && !flowV2DrivesScreens,
	);
	const spinHotkeyPress = () => {
		context.eventEmitter.broadcast(
			getSpinPressSound({ isIdle: context.stateXstateDerived.isIdle() }),
		);
		doSpinBetOrStop();
	};

	onMount(() => {
		void loadEditorScenes().then((doc) => {
			editorDoc = doc;
			setBoardOverride(findReelGridNode(doc) ?? null);
			// Game-level settings (§ Game Settings): apply the authored speed-feature
			// toggles. A `UK` jurisdiction forces every speed feature off (overrides the
			// individual flags); otherwise the per-feature overrides merge in. Absent
			// settings ⇒ engine defaults (all on) — parity for un-authored docs.
			if (doc.settings?.jurisdiction === 'UK') setUiFeatures(UI_FEATURES_UK);
			else if (doc.settings?.features) setUiFeatures(doc.settings.features);
			// Invisible Flow (Phase 4): build the interpreter from the (optional) FlowDoc +
			// the just-loaded scenes, and publish it for the book-event play path. Returns
			// `undefined` when no FlowDoc is authored ⇒ the holder stays null ⇒ pure coded
			// path (parity, §7). `start()` runs the initial screen's enter choreography.
			// Invisible Flow v2 (Phase 4b) — build the v2 handle FIRST. A v2 flow DRIVES SCREENS only when
			// it authors the `load` lifecycle (a translated whole-game flow does; a book-events-only flow
			// like the apps/lines reference does NOT — it just handles book events over the coded/v1
			// screens). When it DRIVES screens it is the SOLE screen renderer (its containers via
			// `<FlowV2Mount>`); its shown set becomes `activeScreenIds` (so the engine gates track it) and
			// the v1 interpreter is NOT built (both mounting every screen is the double-logo/tap bug).
			const flowV2 = createLinesFlowV2(
				doc,
				(containers) => {
					flowV2Containers = containers;
					// When v2 drives screens, its shown set IS the active set. (For a book-events-only flow
					// this callback never fires with content — it shows no containers — so v1 keeps ownership.)
					if (flowV2DrivesScreens) activeScreenIds = containers.map((c) => c.id);
				},
				// Phase A intent bridge — an intent-command action (startSpin/…) invokes the SAME coded
				// body the button press runs (shared with v1's `invokeIntent`).
				(intent) => invokeHostIntent(intent),
			);
			setFlowV2(flowV2);
			// The mode stack presents its transitions through this flow's Mode trigger entries, if any.
			setModeTransitionPresenter(flowV2?.presentModeTransition);
			// "Drives screens" ⇒ the flow authors the `load` entry (shows the initial screen). A
			// book-events-only flow doesn't, so the coded/v1 screen path stays (no regression).
			flowV2DrivesScreens = flowV2?.ownsEvent('load') ?? false;
			flowV2ResolveScene = flowV2?.resolveScene;
			flowV2Containers = flowV2?.ordered() ?? [];
			// Mirror the handle for `<FlowV2Messages>` — its `textMessages` (static) + `messageShown`
			// (reactive) drive the text-message overlay, regardless of whether the flow drives screens.
			flowV2Handle = flowV2;
			// Design doc §14 (win-overlay twin) — does the flow OWN the `setWin` event? That is the
			// ownership TRIGGER for the headless win driver (an authored win container of ANY name), read
			// the same way `flowV2DrivesScreens` reads `ownsEvent('load')`. `awaitTargets` is the static
			// set of containers a `showContainer{awaitComplete}` node holds the round on — the
			// name-agnostic signal the celebration lock reads. Both empty/false with no v2 flow (parity).
			flowOwnsSetWin = flowV2?.ownsEvent('setWin') ?? false;
			winAwaitTargets = flowV2?.awaitTargets ?? new Set();
			flowHideTargets = flowV2?.hideTargets ?? new Set();

			// Invisible Flow v1 — ONLY when v2 does NOT drive screens (else every screen doubles). v1's
			// screen mounts are all `flow`-gated, so leaving `flow` undefined makes them inert;
			// `<FlowV2Mount>` is then the sole scene renderer.
			flow = flowV2DrivesScreens
				? undefined
				: createLinesFlow(
						doc,
						(screenIds, entrances) => applyActiveScreens(screenIds, entrances),
						// Intent host bridge (design doc §8.5): a wired `action → intent` edge invokes the EXACT
						// coded behaviour of that HUD button (spin/increase/decrease/turbo/menu) via the shared
						// `invokeHostIntent` dispatch. An unknown intent is a safe no-op (parity §8.8).
						(_screenId, intent) => invokeHostIntent(intent),
					);
			setFlowInterpreter(flow);
			// Seed the rune from the active flow: v1's initial active set, else v2's shown containers.
			if (flow) {
				activeScreenIds = flow.activeScreenIds;
				void flow.start();
			} else {
				activeScreenIds = flowV2Containers.map((c) => c.id);
			}
			// Phase A boot — kick the flow's entry event so it shows its initial screen (a translated
			// flow authors `load` → showContainer(initial); the mount `onChange` mirror updates
			// `flowV2Containers`). Ownership-gated ⇒ inert for the book-event-only reference flow and a
			// normal (no-v2) boot (parity). The screen swaps then run off `complete:<top>` (the tap).
			void dispatchFlowV2Event('load');
			bootSettled = true;
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

	<!--
		Persistent authored background (§ persistent-bg-scene) — CODED PATH ONLY. Without a
		screen-driving flow, any `space: 'background'` scene the author created renders here as
		a full-bleed layer BEHIND everything (`LAYER_BAND_BACKGROUND`, below the coded
		background and the loading screen), and OUTSIDE the loading `{#if}` so it shows across
		the WHOLE session — base + free game and behind the splash. `<LayoutScene>` cover-fits
		each node to the canvas (the engine's `space:'background'` path) and honours the scene's
		own `visibleSource` gate; an ungated scene is always-on. Rendered in editor scene order
		(lowest first). Under a v2 flow that drives the screens `bgScenes` is EMPTY — the flow
		owns visibility universally, so a background-space screen mounts through `<FlowV2Mount>`
		like every other container (its space only sets the coordinate frame). Empty list ⇒
		nothing renders (parity). When at least one such scene has real content, the coded
		bundled `<Background>` spine is suppressed so the authored art REPLACES the reference
		background; absent ⇒ the coded `<Background>` renders as today.
	-->
	{#each bgScenes as scene (scene.id)}
		<Container zIndex={LAYER_BAND_BACKGROUND}>
			<LayoutScene {scene} />
		</Container>
	{/each}

	<!-- The coded background is WRAPPED at its own band rather than emitting its `-3..-1`
			 children straight into the root: that keeps its internal order while leaving room for
			 the BEHIND-the-reels band above it, so a screen ticked "Behind the reels" paints in
			 front of the background and under the reels. Relative order is unchanged (authored
			 background scenes stay behind the coded one), so this is parity for every game. -->
	{#if !suppressCodedBackground}
		<Container zIndex={LAYER_BAND_BACKGROUND_CODED}>
			<Background cover={backgroundCover} />
		</Container>
	{/if}

	<ResumeBet ready={isPlayerIn} />
	<!--
			The reason why <Sound /> is rendered after clicking the loading screen:
			"Autoplay with sound is allowed if: The user has interacted with the domain (click, tap, etc.)."
			Ref: https://developer.chrome.com/blog/autoplay
		-->
	<Sound />

	<!--
			§16.4 B6.4 — replacement Space hotkey for the spin button. Mounted whenever the coded
			`ButtonBet` (and its own `<OnHotkey hotkey="Space">`) is NOT present: either the cluster is
			flipped to `componentInstance(button)` nodes (`HUD_BUTTON_INSTANCES`), OR the author
			authored replacement HUD screens that suppress the whole coded `<UI>` (`suppressCodedHud`,
			§16 full-replace). In both cases the coded hotkey is gone, so this is the SOLE Space binding
			(no double-fire). Neither ⇒ not rendered, coded hotkey is the sole binding (parity). Mirrors
			`ButtonBet`'s binding.
		-->
	{#if HUD_BUTTON_INSTANCES || suppressCodedHud}
		<OnHotkey
			hotkey="Space"
			disabled={spinHotkeyDisabled}
			ignorePressInProgress
			onpress={spinHotkeyPress}
		/>
	{/if}
	<!-- At most one hold-Space binding, gated as in `UIDefault` (a `disabledAutoplay` jurisdiction or
			the doc's Game Settings turn `spaceHold` off). -->
	{#if !codedHudMounted && stateUi.config.features.spaceHold}
		<EnableSpaceHold isIdle={context.stateXstateDerived.isIdle} />
	{/if}

	<!-- `basegameScene` is `game` space → <LayoutScene> self-wraps in its own
			 MainContainer. Do NOT wrap it again here (that double-scales it).
			 Split at the reelGrid placeholder: below-reel layers, then the board, then
			 above-reel layers (so editor stacking order around the reel is honored).

			 Invisible Flow (Phase 4/5): `<FlowMount>` is the generic-mounter boundary. When the
			 interpreter authors `basegame` it mounts the authored scene's BELOW-reel slice (via
			 <LayoutScene>); otherwise it renders the coded below-reel split — byte-identical to
			 `main` (§7). The board MainContainer always mounts (the reel is engine-owned, not a
			 flow screen), and the ABOVE-reel slice renders AFTER it below — so an authored
			 basegame reproduces the exact below-reel → board → above-reel z-order (§11.5 B.1). -->
	<!--
			Base-game visibility gate (the pin-driven active-SET model). The base game — its
			below-reel layers, the reel board (BoardFrame + Board), and its
			above-reel layers — renders ONLY while the base-game screen NODE is active
			(`isBasegameActive`). During `loading` (basegame not yet activated) the reels are
			HIDDEN behind the loading splash; the `complete` swap to basegame reveals them on the
			clean background. This fixes the reels being visible behind the loading overlay.

			INERT-FLOW FALL-THROUGH (parity §7): when NO flow drives the game (`!flow` — no
			FlowDoc, the interpreter is undefined), the base game renders UNCONDITIONALLY exactly
			as today, so a non-flow game is byte-identical to current `main`. Only a flow-driven
			boot (which always exists in apps/lines via the synthesized loading leg) gates on the
			active set. -->
	{#if !isFlowDriven || isBasegameActive}
		<!-- The base game INTERLEAVES with the engine-owned reels via the reelGrid split: the authored
				 below-reel layers (e.g. the board background) render BEHIND the board, the above-reel layers
				 in front. This runs under v1 AND v2 — a v2 flow shows the `basegame` CONTAINER, but
				 `<FlowV2Mount>` SKIPS basegame (below), so THIS split is the sole basegame renderer and the
				 reel z-order is preserved (rendering the whole scene as one block put the background above
				 the reels). -->
		{#if basegameMountBelowReel && entranceById[basegameScreenId]}
			<!-- Flow-authored basegame with an ENTRANCE transition (design doc §6): fade the
					 below-reel slice in via <FlowScreenMount> (mount-hidden, no flash). The board +
					 above-reel slice below are engine-owned / render as normal. -->
			<FlowScreenMount
				scene={basegameMountBelowReel}
				transition={entranceById[basegameScreenId]}
				timeScale={stateBetDerived.timeScale}
			/>
		{:else}
			<FlowMount scene={basegameMountBelowReel}>
				{#snippet fallback()}
					<LayoutScene scene={basegameBelowReel} />
				{/snippet}
			</FlowMount>
		{/if}

		<!-- Authored free-spin board glow — the BELOW-reel slot, so it draws behind the reels
				 exactly where the coded `<BoardFrame>`'s `zIndex:-1` spine does. `game` space ⇒
				 <LayoutScene> self-wraps in its own MainContainer, so do NOT wrap it again here
				 (that double-scales it). Only mounts when the author put real content in the scene;
				 that same condition suppresses the coded spine below, so the two never both draw. -->
		{#if suppressCodedBoardGlow && glowScene}
			<LayoutScene scene={glowScene} />
		{/if}

		<!-- The reel stack (coded glow frame + reels), factored into a snippet so the
				 reel-anticipation camera can wrap it WITHOUT duplicating it. Rendered verbatim
				 when the mode is off ⇒ byte-identical to the un-wrapped mount (parity). -->
		{#snippet reelStack()}
			{#if !suppressCodedBoardGlow}
				<BoardFrame active={boardGlowActive} />
			{/if}
			<Board />
			<!-- The cascade + multiplier-collect overlays, mounted BESIDE the board because that is
					 what they are: `TumbleBoard` stands in for the reels for the length of a tumble
					 (`boardHide` → it shows → `boardShow`), and `MultiplierBoard` flies the landed
					 multipliers to the board centre. Both render NOTHING until their own cue arrives, so a
					 game whose RGS never sends `tumbleBoard`/`boardMultiplierInfo` is byte-identical with
					 them here — which is why they can mount unconditionally rather than behind a game-type
					 test the runtime has no way to make.

					 Mounted DIRECTLY rather than through `registerBoundComponents` (where they started, and
					 where they were unreachable — a registry entry only says a scene node MAY bind them,
					 and nothing did, so they never mounted and their cues fired into nothing). A direct
					 mount also cannot double-subscribe the way a bind anchor plus a coded mount would. They
					 need no placement: both position themselves from `boardLayout()`, so there is nothing
					 for an author to move. -->
			<TumbleBoard />
			<MultiplierBoard />
			<!-- The Hold and Win respin board — an unconditional, empty container until a feature puts
			     the per-cell board up in the reels' place (`RespinBoard.svelte`). -->
			<RespinBoard />
		{/snippet}

		<MainContainer>
			{#if stateGameDerived.anticipationActive()}
				<!-- Reel-anticipation mode (Phase 3): a dedicated camera wraps the reel stack +
						 the anticipation overlays (spine stack + grey-out) so the zoom/pan never fights
						 MainContainer or the editor coordinate boxes. Both are inside the camera so they
						 zoom together; the camera + overlays are identity until a reel arms. The camera is
						 gated on the Flow-authored `anticipationZoom` toggle (default on ⇒ Phase 3 unchanged);
						 off ⇒ the overlays render without the zoom (spine stack + grey-out only).

						 `anticipationActive()` rather than the raw flag: on a swap-in-place board the whole
						 feature stands down (there is no roll to hold), and the `{:else}` here is the exact
						 path a game with the mode off already takes — the bare reel stack, no camera, no
						 overlays. That also takes the geometry-bound anticipation GREY-OUT down with it.
						 The per-symbol win dim is a different feature entirely (`SYMBOL_DIM_TINT` through
						 `SymbolWrap`, no geometry) and is untouched. -->
				{#if stateGame.anticipationZoom}
					<AnticipationCamera>
						{@render reelStack()}
						<Anticipations />
					</AnticipationCamera>
				{:else}
					{@render reelStack()}
					<Anticipations />
				{/if}
			{:else}
				{@render reelStack()}
			{/if}
		</MainContainer>

		{#if basegameMount}
			{#if basegameMountAboveReel && basegameMountAboveReel.nodes.length}
				<LayoutScene scene={basegameMountAboveReel} />
			{/if}
		{:else if basegameAboveReel && basegameAboveReel.nodes.length}
			<LayoutScene scene={basegameAboveReel} />
		{/if}

		<!-- The win line + the amount it stamps are HUD chrome, not board furniture: they read as
				 the game TELLING the player what they won, so nothing the author layers over the board
				 may bury them. They used to live inside the board `<MainContainer>` above (implicit z 0),
				 which put them under every list-ordered screen — the HUD, the base-game overlays, an
				 author's own above-reel art. Now they mount as their OWN board-space layer at
				 `LAYER_BAND_WIN_PRESENTATION`, above that whole band and still below the pinned
				 takeovers + the engine's round-blocking gates.

				 `<WinLine>` positions through `<BoardContainer>` (board-local coords), so it needs the
				 game-space transform its old parent gave it — hence its own `<MainContainer>` here.
				 `<MainContainer>` is pure derived layout, so a second instance costs nothing and
				 reproduces the identical transform: the line lands in exactly the same PLACE, only
				 higher in the stack. Still inside the base-game gate, so it unmounts with the board
				 exactly as before. -->
		<Container zIndex={LAYER_BAND_WIN_PRESENTATION}>
			<MainContainer>
				<WinLine />
			</MainContainer>
		</Container>
	{/if}

	<!--
			HUD chrome visibility gate (the pin-driven active-SET model, mirroring the base-game
			reel gate above). When the flow MODELS the HUD as its own screen (`isHudFlowManaged` — a
			`hudBar`/`hudCorners` id is an authored FlowDoc screen), the `<UI>` chrome renders ONLY
			while that HUD screen is active (`isHudActive`). During `loading` the HUD is hidden; the
			loading→HUD `complete` handoff reveals it on the tap, just like the base game.

			INERT-FLOW FALL-THROUGH (parity §7): when there is NO flow, OR the HUD is NOT a flow
			screen (`!isHudFlowManaged`), the `<UI>` renders UNCONDITIONALLY exactly as today — a
			flow-less game and a flow that authors no HUD node are byte-identical to current `main`.

			FULL-REPLACE (§16): when the author authored replacement HUD screen(s) (`suppressCodedHud`),
			the coded `<UI>` is suppressed entirely and the `authoredHud` scenes below BECOME the HUD.

			V2 SUPPRESSION: `<UI>` renders the `hudBar`/`hudCorners` scenes itself, and a v2 flow that
			drives the screens mounts those SAME scenes as containers through `<FlowV2Mount>` — so
			without this guard the whole HUD mounts TWICE (verified live: two centre-anchored copies of
			every readout on the same pixel, whose independent count-up `Tween`s disagree mid-change and
			overhang each other by the width difference). Neither existing condition catches it:
			`isHudFlowManaged` reads the V1 mounter only, and `suppressCodedHud` is keyed on `hud_*`
			scenes, never the canonical `hudBar`. Same guard the `authoredHud` + `extraScenes` blocks
			below already carry — under a driven v2 flow `<FlowV2Mount>` is the SOLE scene renderer.
		-->
	{#if codedHudMounted}
		<!-- Cross-screen z-order (§11.5-C): the HUD chrome paints at its doc-list position via
				 `hudZIndex`. Leaving it where the reference layout places it (before the win/bonus
				 overlays) reproduces today's stacking; moving it in the editor re-layers it. -->
		<Container zIndex={hudZIndexEffective}>
			<!-- The HUD is rendered by `<UI>`, not a `<LayoutScene>`, so it can't use
					 `<FlowScreenMount>`; `<FlowFade>` wraps the chrome the same way (mount-hidden alpha
					 0→1) when its activating edge carried an entrance transition, else renders it
					 directly (hard cut — parity). Keyed on `hudEntrance` so a fresh entrance remounts
					 the fader; `hudEntrance` is undefined when the HUD isn't flow-managed. -->
			{#key hudEntrance}
				<FlowFade transition={hudEntrance} timeScale={stateBetDerived.timeScale}>
					<!-- The corners render through the SAME `HudGameName`/`HudLogo` components the
							 `hudCorners` scene mounts under a flow-v2-driven game (registered as bound
							 components below), so the two paths can't drift (§ default-HUD Phase 2). -->
					<UI hud={{ bar: hudBarScene, corners: hudCornersScene }}>
						{#snippet gameName(override)}
							<HudGameName name="LINES GAME" text={override?.text} style={override?.style} />
						{/snippet}
						{#snippet logo(override)}
							<HudLogo text={override?.text} style={override?.style} />
						{/snippet}
					</UI>
				</FlowFade>
			{/key}
		</Container>
	{/if}
	<!--
			§16 — author REPLACEMENT HUD screens (the FULL-REPLACE contract). Each `hud_`-prefixed
			author scene renders as the top HUD layer via `<LayoutScene>` (a `space:'standard'` +
			`align.vertical:'bottom'` scene bottom-frames exactly like the coded bar), painted at its
			editor screen-list position (`sceneLayerZIndex`, the §11.5-C layerable contract) so a
			reorder re-layers it. Excluded from `extraScenes` above (no double-mount). Empty for any
			game that authors no `hud_*` screen ⇒ renders nothing (parity, byte-identical to `main`).
		-->
	{#each authoredHud as scene (scene.id)}
		<!--
				Active-SET gate (the pin-driven active-SET model, mirroring the base-game reel gate +
				the coded `<UI>` gate above). When the flow MODELS this HUD screen as its own node
				(`flow.mounter.authoredScreenIds().has(scene.id)`), it renders ONLY while that screen
				is in the active set (`activeScreenIds.includes(scene.id)`): during `loading` the HUD is
				hidden, and the `loading→HUD` `complete` handoff reveals it on the tap.

				INERT-FLOW FALL-THROUGH (parity §7): with NO flow, OR a HUD screen the flow does NOT
				author, this renders UNCONDITIONALLY exactly as today (byte-identical to `main`). Only a
				flow that authors this exact HUD screen id gates it on the active set.
			-->
		{#if !flowV2DrivesScreens && (!flow || !flow.mounter
					.authoredScreenIds()
					.has(scene.id) || activeScreenIds.includes(scene.id))}
			<!-- Suppressed under a v2 flow — `<FlowV2Mount>` renders the hud_* container instead. -->
			<Container zIndex={sceneLayerZIndex(editorDoc.scenes, scene.id)}>
				<LayoutScene {scene} />
			</Container>
		{/if}
	{/each}
	<!--
			Flow-driven WIN gate — the count-up + `winState` + round-block DRIVER, mounted ENGINE-OWNED
			(it must run UNDER a driven flow, not off it). Under a v2 flow that DRIVES the screens the owner authors the coded
			`bind:Win`/`bind:WinGate` OUT and places just the `win` VISUAL componentInstance, so NOTHING
			subscribes to the flow's awaited `winUpdate` action (`flowEffects.winUpdate` → `awaitPresentation`
			broadcast): `winState` is never written, the count-up never runs, the round never blocks, and the
			placed visual draws nothing (the reported "big win never shows"). This gate is the missing
			subscriber — it OWNS the `WinCountUpProvider` count-up, writes the win level / amount /
			`countUpAmount` to `winState` for the VISUAL to read, and holds the round on `winUpdate` until the
			count-up self-resolves (its `OnMount startCountUp`, not a tap). It is a DRIVER, not a screen-gate:
			its `PressToContinue` already self-suppresses under flow (`codedPressOwned = !flowV2DrivesScreens()`),
			so it adds no second tap surface the author never asked for.

			Placed at `basegameOverlaysZIndex` (the coded composer's own band) and BEFORE the overlays scene,
			so the big-win dim scrim sits BEHIND the placed `win` visual exactly as the coded composer stacks
			gate-then-visual — no double dim, right band. Routed through `resolveWinMount` (design doc §14,
			the win-overlay twin of the FS-7 outro), the SINGLE OWNERSHIP-based + NAME-AGNOSTIC decision
			guaranteeing exactly one `winUpdate` subscriber: it stands DOWN (`null`) when a coded
			`Win`/`WinGate` binds the `basegameOverlays` scene (`basegameOverlaysHasCodedWinGate` — that gate
			already subscribes, so a second would double the round-block) or when no v2 flow drives the game;
			it mounts the HEADLESS gate (`'driver'`, `headless` ⇒ no big-win dim) when the flow OWNS `setWin`
			(`flowOwnsSetWin` — the authored container of ANY name owns dim / text / art / tap), else the full
			`'gate'` (the coded `setWin` handler broadcasts `winShow`/`winUpdate` — today's Borut remake path).
			A non-flow / non-owning game therefore mounts EXACTLY what `main` did ⇒ byte-identical. The gate's
			`PressToContinue` already self-suppresses under flow (`codedPressOwned = !flowV2DrivesScreens()`),
			so it adds no second tap surface; its `OnMount` broadcasts `winCountUpComplete` on count-up
			completion, so an authored container's `tapArmAfterSignal: 'winCountUpComplete'` tap arms only
			after the count (inert when un-authored — no subscriber, no emitter replay).
		-->
	{#if winMount}
		<Container zIndex={basegameOverlaysZIndex}>
			<WinGate headless={winMount === 'driver'} />
		</Container>
	{/if}
	<!--
			The free-spin OUTRO count-up DRIVER — the engine's only part in the outro, the twin of the WIN
			gate above. It is the SOLE subscriber to the flow's awaited `freeSpinOutroCountUp` action: it
			runs the count-up, publishes the win level + live amount to `freeSpinOutroState` (read by the
			outro screen's count text or `FreeSpinOutroVisual`), and self-resolves the hold once the count
			finishes. The flow's `freeSpinOutro` container owns everything the player sees and presses —
			the dim, the tap-to-continue (armed on `freeSpinOutroCountUpComplete`) and the
			`showContainer{awaitComplete}` round-block. Only under a v2 flow that drives the screens: a game
			without one has no outro screen to count into.

			At `freeSpinOutroZIndex` (the outro container's OWN band) and BEFORE `<FlowV2Mount>`, so the
			driver's count-up press surface (hold-to-speed-up / tap-to-skip, only while counting) sits in
			the outro's band beneath the authored screen.
		-->
	{#if flowV2DrivesScreens}
		<Container zIndex={freeSpinOutroZIndex}>
			<FreeSpinOutroDriver />
		</Container>
	{/if}
	<Container zIndex={basegameOverlaysZIndex}>
		<LayoutScene scene={basegameOverlaysScene} />
	</Container>
	<!-- The split WIN overlay's board-relative VISUAL (`game`-space `componentInstance(win)`).
			 Present only when the overlay is split (`WIN_INSTANCE` ON, or a `win` component authored in
			 the editor); the full-screen `WinGate` is the `basegameOverlays` scene bind above. Empty ⇒
			 renders nothing (the OFF composer `bind:Win` draws the visual itself) — byte-identical to
			 `main` (parity). Mirrors the free-spin outro VISUAL scene. -->
	{#if winVisualScene && winVisualScene.nodes.length}
		<Container zIndex={LAYER_BAND_WIN_PRESENTATION}>
			<LayoutScene scene={winVisualScene} />
		</Container>
	{/if}
	<!--
			§20.1 — generic doc-driven scene mounting. Mount every AUTHOR-created screen the
			game doesn't already handle (custom-id scenes from the Scene Editor), as an overlay
			layer above the base game. `extraMountScenes` returns them in doc order, excluding
			the reserved ids (everything mounted by hard-coded id above + any FlowDoc-authored
			screens) and `space:'background'` scenes (handled by `backgroundScenes` above).
			`<LayoutScene>` self-wraps by `scene.space` and honours `scene.visibleSource`, so an
			ungated author screen is always-on and a gated one shows only in its phase. Empty for
			`apps/lines`' fallback doc ⇒ renders nothing (parity, byte-identical to `main`).
		-->
	<!-- Suppressed under a v2 flow — every authored screen mounts through `<FlowV2Mount>` (its shown
			 containers), so mounting them here too would double them. -->
	{#if !flowV2DrivesScreens}
		{#each extraScenes as scene (scene.id)}
			<Container zIndex={sceneLayerZIndex(editorDoc.scenes, scene.id)}>
				<LayoutScene {scene} />
			</Container>
		{/each}
	{/if}
	<!--
			Invisible Flow (Phase 4, flow-driven-game §4) — the GENERIC active-screen mount. When the
			interpreter swaps the active exclusive screen to an authored id that is NOT `basegame`
			(the boot `loading` splash, a `bigWin`/`freeSpinIntro` celebration, or an author's own
			screen), it mounts here. Its z is `sceneLayerZIndex` like every other screen — the
			Screens-list position, or the PINNED band when the author ticked "Always on top" (what a
			transient celebration/splash wants, and what a v1 doc's splash is backfilled to). This
			used to be a hard-coded top band for EVERY active screen, which pinned a persistent
			authored screen (a progress bar) above everything with no way to re-layer it. The base
			board PERSISTS behind it (the reel is engine-owned, not a flow screen), so a celebration
			overlays the reels rather than replacing them. `<LayoutScene>` self-wraps by `scene.space` + honours `visibleSource` (no
			double-wrap); it unmounts on the swap back to `basegame` (gated on `activeScreenId`).
			`undefined` ⇒ nothing renders: no FlowDoc, a fall-through/unbacked active screen, or the
			base/loading screens (their own paths) — byte-identical to current `main` (§7).
		-->
	{#if activeScreenTakeover}
		<Container zIndex={activeScreenTakeoverZIndex}>
			{#if activeScreenId && entranceById[activeScreenId]}
				<!-- The takeover screen (loading splash / a celebration) activated WITH an entrance
						 transition (design doc §6): fade it in mount-hidden (no flash). -->
				<FlowScreenMount
					scene={activeScreenTakeover}
					transition={entranceById[activeScreenId]}
					timeScale={stateBetDerived.timeScale}
				/>
			{:else}
				<LayoutScene scene={activeScreenTakeover} />
			{/if}
		</Container>
	{/if}
	<!--
			Buy-bonus SELECT menu — the shared in-canvas `<BuyFeatureScreen>` takeover (the twin of the
			deleted HTML `ModalBuyBonus`), at the `LAYER_BAND_TAKEOVER` band the flow celebrations use.
			Visibility keys DIRECTLY on `stateModal`: shown while `buyBonus`, hidden the moment a card press
			advances to `buyBonusConfirm` (the in-canvas confirm dialog then takes over). A tap on the
			backdrop clears the modal. No buy mode means the HUD has no buy button, so it never opens.
		-->
	<BuyFeatureScreen
		open={stateModal.modal?.name === 'buyBonus'}
		onDismiss={() => (stateModal.modal = null)}
		zIndex={LAYER_BAND_TAKEOVER}
		scene={buyFeatureScene}
	/>
	<!--
			Buy-bonus CONFIRM step — the shared in-canvas `<BuyBonusConfirm>` (→ `<ConfirmDialog>`, the
			twin of the deleted HTML `ModalBuyBonusConfirm`), at the same takeover band. Visibility keys
			on `stateModal` (`buyBonusConfirm`); CONFIRM commits the picked bet mode, CANCEL/backdrop
			returns to the SELECT screen. Uses the authored/fallback `buyConfirm` scene.
		-->
	<BuyBonusConfirm zIndex={LAYER_BAND_TAKEOVER} scene={buyConfirmScene} />
	<!--
			The operator's round-start CONFIRM (`confirmGameRoundStart`) — the same in-canvas
			`<ConfirmDialog>` at the same takeover band, shown only while `newGame` holds a paid round on
			the player's answer. An operator that never asked ⇒ it never opens.
		-->
	<RoundStartConfirm zIndex={LAYER_BAND_TAKEOVER} scene={roundConfirmScene} />
	<!-- FLIGHTS (Hold and Win §4.4) — a coin's glow travelling from the board into the win meter or a
			 pot. Unconditional, at its own fixed band (above the board, the HUD and the win line, below the
			 pinned celebrations), and empty until a flight runs (`FlightLayer.svelte`). -->
	<Container zIndex={LAYER_BAND_FLIGHTS}>
		<FlightLayer />
		<!-- The Hold and Win pre-feature wheel and banner (Lucky Spin, jackpots, the wheel's prize):
		     nothing mounted until one is up; their own zIndex seats put the wheel above the flights and
		     the banner above both, whatever mounted first. -->
		<HoldAndWinWheel />
		<HoldAndWinBanner />
	</Container>
	<!-- Engine-owned TOP band (§11.5-C): the coded path's free-spin counter + the info overlay sit at
			 a FIXED `LAYER_BAND_TOP` z, ABOVE every doc-ordered layerable scene — so an author reordering
			 the HUD/overlays/specialBook in the editor can never bury them. The free-spin intro / outro are
			 not here: they are a v2 flow's containers (`<FlowV2Mount>`), whose `tapToContinue` owns the dim
			 + tap and whose `showContainer{awaitComplete}` owns the round-block. -->
	<Container zIndex={LAYER_BAND_TOP}>
		{#if !flowV2DrivesScreens && ['desktop', 'landscape'].includes(context.stateLayoutDerived.layoutType())}
			<LayoutScene scene={fsCounterScene} />
		{/if}
		<InfoOverlay manifest={infoManifest} />
	</Container>
	<!-- specialBook paints at its doc-list position (§11.5-C), interleaving with the HUD /
			 overlays / extras band. Reference-layout order reproduces today's stacking. -->
	{#if !flowV2DrivesScreens}
		<!-- specialBook is a v2 container — `<FlowV2Mount>` renders it under a v2 flow (no double). -->
		<Container zIndex={specialBookZIndex}>
			<LayoutScene scene={specialBookScene} />
		</Container>
	{/if}

	<!--
			Invisible FX (§4.4 / §8) — play this project's baked effects. Free effects mount at
			the scene level; bone-placed effects mount inside a host `<SpineProvider>` so they
			ride the rig. Renders nothing when no effects are baked (parity, byte-identical).
		-->
	<Effects />

	<!--
		Invisible Flow v2 (Phase 4b) — the generic z-ordered container MOUNTER. Renders each
		container a v2 flow has SHOWN (via `showContainer`), each `<Container zIndex={z}>` sorting
		within this root stack by its author-assigned z (so a v2 overlay can sit above/below any
		coded band). Empty on a normal boot (`__IE_FLOW_V2_DOC__` unset ⇒ v2 inert) ⇒ nothing
		renders, byte-identical to `main`. Phase 4c gives templates a real vocabulary; Phase 5
		hard-cuts v1 and this becomes the sole scene mounter.
	-->
	{#if flowV2ResolveScene}
		<!-- SKIP the `basegame` container: it interleaves with the engine reels via the reelGrid split
				 (rendered above), so mounting it here as one block would put the board background above the
				 reels + double it. Every other container (loading / HUDs / overlays) mounts normally. -->
		<FlowV2Mount
			containers={flowV2Containers.filter((c) => c.id !== basegameScreenId)}
			resolveScene={flowV2ResolveScene}
		/>
	{/if}

	<!--
		Invisible Flow v2 (§6.3) — the in-game TEXT MESSAGE overlay. Renders each authored
		`textMessage` node whose `visibleWhile` state-gate matches OR whose flow-driven flag is
		raised, at its normalized `place` in the main design box. Mounted UNGATED by
		`flowV2DrivesScreens` — a book-events-only flow (no screens) can still author messages.
		Renders nothing when no v2 flow / no message nodes (parity). Last in the stack so a
		prompt sits above the board + overlays.
	-->
	<FlowV2Messages flow={flowV2Handle} />

	<!--
		Invisible Cinematic — whatever the flow's `playCinematic` nodes currently want on screen.
		Above the board (a cinematic is a takeover) but below the debug stage. Renders nothing when
		no v2 flow, no cinematic node, or no shipped cinematic (parity).
	-->
	<FlowV2Cinematics flow={flowV2Handle} />

	<DebugStage />

	<!--
		Press-to-continue INPUT MASK — the LAST thing in the stack, at its own band above
		`LAYER_BAND_TOP`. While any `PressToContinue` is live (free-spin intro/outro, big win, an
		authored `tapToContinue` screen) this full-canvas hit rect absorbs the tap wherever the
		pointer is and runs that overlay's press.

		Without it the overlay's own hit rect sits at the OVERLAY's z, so the HUD — which paints
		above most overlays — hit-tested first: a pointer resting on the spin button ate the click
		(the button is inert under the celebration lock, so nothing happened at all) and the player had
		to move off the button to skip the cinematic; turbo/menu/bet were worse, still fully live under
		a full-screen overlay. Locking a button's press can't fix that — an inert button still eats the
		pointer — so the overlay masks the chrome instead. Mounted only while a press is live ⇒ the
		HUD is untouched the rest of the time (parity).
	-->
	<Container zIndex={LAYER_BAND_INPUT_MASK}>
		<ContinuePressMask />
	</Container>
</App>

<Modals disabledModals={['payTable', 'gameRules']}>
	{#snippet version()}
		<GameVersion />
	{/snippet}
</Modals>

<GameVersion fixed />

<DebugMenu />
