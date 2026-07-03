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
		stateSound,
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
	import { LayoutScene, FlowMount, FlowScreenMount, FlowFade } from 'engine-layout/svelte';
	import type { FlowEntranceTransition } from 'engine-layout/svelte';
	import {
		registerBoundComponents,
		registerComponents,
		registerComponentValues,
		registerComponentActions,
		registerComponentVisibility,
		registerFlowComplete,
		registerFlowValueSource,
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
		TAP_TO_CONTINUE_DEF,
		LOADING_BAR_DEF,
		findReelGridNode,
		backgroundCoverScale,
		backgroundCoverStretch,
		backgroundFit,
		backgroundScenes,
		hasAuthoredBackground,
		extraMountScenes,
		authoredHudScenes,
		hasAuthoredHud,
		docLayerZIndex,
		LAYER_BAND_TAKEOVER,
		LAYER_BAND_TOP,
		sceneByRole,
		loadingSceneId,
		basegameSceneId,
	} from 'engine-layout';
	import type { Scene } from 'engine-layout';

	import { infoManifest } from '../game/infoManifest';
	import { resetSymbolMapCache } from '../game/symbolMap';
	import { createLinesFlow, linesValueResolver, type LinesFlow } from '../game/flowRuntime.svelte';
	import {
		setFlowInterpreter,
		completeActiveScreen,
		emitFlowSignal,
		hasFlowAction,
		emitFlowAction,
	} from '../game/flowInterpreterHolder';
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
	import TapToContinue from './TapToContinue.svelte';
	import Transition from './Transition.svelte';
	import Effects from './Effects.svelte';
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
		// The symbol→binding map is memoised on first read (`symbolMap.ts`), and
		// `infoManifest.ts` reads it at IMPORT time — before this async runtime bundle
		// landed — so the memo froze to the coded template symbols. Drop it now that the
		// overrides are live, so the first reel render recomputes the merge WITH them.
		// Otherwise an online game shows the template defaults despite a baked symbols doc.
		resetSymbolMapCache();
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
		// Invisible Flow tap-to-continue (§6.2): the coded press surface the engine
		// mounts over any `overlay` instance whose shared `tapToContinue` param is on.
		// `OnPressFullScreen` + `OnHotkey "Space"`; on tap calls BOTH Flow holder APIs
		// (`completeActiveScreen` + `emitFlowSignal(tapSignal)`). Unused until an author
		// flips the toggle on an overlay instance ⇒ pure registration, no render change.
		TapToContinue,
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
	});
	// Flow-driven-game §1 — wire the engine's feed-triggered `completeOnLoaded` capability
	// (`<ComponentInstance>` → `getFlowComplete()`) to THIS game's Flow holder, the non-visual
	// sibling of the `TapToContinue` bound-component mount. A `completeOnLoaded` instance's
	// `assetsLoaded` rising edge then advances the active Flow screen exactly as a tap does.
	// SAFE: the holder helpers are no-ops with no active interpreter (no FlowDoc ⇒ pure coded
	// path), so this is inert on a normal boot — parity.
	registerFlowComplete({
		completeActiveScreen: () => void completeActiveScreen(),
		emitSignal: (signal: string) => void emitFlowSignal(signal),
	});
	// Flow value dataflow (design doc §11.4) — wire `<ComponentInstance>`'s value-feed lookup through
	// the interpreter's authored value-binding overrides (+ the dev `__IE_FLOW_VALUE__` hook). No
	// FlowDoc / inert interpreter / no override ⇒ `linesValueResolver` returns each display's own
	// `source` verbatim ⇒ subscriptions byte-identical to today (parity §11.6).
	registerFlowValueSource(linesValueResolver);
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
		// Config-feature gates for the parametric turbo / auto-spin buttons (B6 M1) — mirror the
		// coded `UIDefault` `{#if stateUi.config.features.turbo/.autoplay}` wraps so a flipped
		// `componentInstance(button)` turbo/auto-spin hides when the config disables the feature.
		turboFeature: boolSource(() => stateUi.config.features.turbo),
		autoplayFeature: boolSource(() => stateUi.config.features.autoplay),
	});

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
	// §17 Phase 3 — author-overridable GATE look. The engine still owns exactly one
	// full-screen intro/outro gate (mounted below) with the round-blocking hold + tap;
	// only its dim + default prompt restyle. Read the `gate` config off the authored
	// SCREEN gated to the matching blocking lifecycle (`Scene.visibleSource`), so a game
	// styles the gate from the same scene it draws its custom intro/outro in. No such
	// scene / no `gate` ⇒ `undefined` ⇒ the gates fall back to their defaults (today's
	// behaviour, byte-identical).
	const fsIntroGate = $derived(
		editorDoc.scenes.find((scene) => scene.visibleSource === 'freeSpinIntroShow')?.gate,
	);
	const fsOutroGate = $derived(
		editorDoc.scenes.find((scene) => scene.visibleSource === 'freeSpinOutroShow')?.gate,
	);

	// HUD layer as editor scenes — when present the `<UI>` positions its HUD from
	// them (editable in the Invisible Editor); absent → coded layout.
	const hudBarScene = $derived(editorDoc.scenes.find((scene) => scene.id === 'hudBar'));
	const hudCornersScene = $derived(editorDoc.scenes.find((scene) => scene.id === 'hudCorners'));
	// The HUD scene ids the `<UI>` chrome renders — the flow can model the HUD as its own screen
	// by authoring one of these ids as a FlowDoc screen, so the loading→HUD `complete` handoff can
	// reveal it on the tap (mirroring the base-game reel gate). Kept to the ids the engine already
	// resolves — no magic per-game id.
	const HUD_SCENE_IDS = ['hudBar', 'hudCorners'] as const;
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
					scale: backgroundCoverScale(bgNode),
					fit: backgroundFit(bgNode),
					stretch: backgroundCoverStretch(bgNode),
				}
			: undefined,
	);

	// Authored PERSISTENT background scenes (§ persistent-bg-scene). An author's "New
	// background screen" gets a fresh-id scene with `space: 'background'` (NOT the coded
	// `background`-id / `space:'canvas'` spine anchor above) carrying full-bleed art.
	// `backgroundScenes` selects them by SPACE (not id, so a custom scene id mounts) in
	// editor order; `hasAuthoredBackground` is true only when one has real content (not
	// just the coded `Background` bind anchor). Both are the engine-layout contract,
	// shared with the editor + other games. `apps/lines`' fallback ships NO
	// `space:'background'` scene (lines.ts has none on purpose), so the list is empty and
	// the flag is false ⇒ byte-identical to today (parity).
	const bgScenes = $derived(backgroundScenes(editorDoc.scenes));
	const suppressCodedBackground = $derived(hasAuthoredBackground(editorDoc.scenes));

	// Authored REPLACEMENT HUD screens (§16 HUD generalization, FULL-REPLACE contract). The
	// Scene Editor's "New HUD screen" mints `hud_`-prefixed scenes carrying the author's own HUD
	// chrome (buttons / bottom bar / readouts). `authoredHudScenes` selects them by the `hud_`
	// prefix (excluding the canonical `hudBar`/`hudCorners` that drive the coded `<UI>`);
	// `hasAuthoredHud` is true when at least one has real content ⇒ the author screens BECOME the
	// HUD and the coded `<UI>` is fully suppressed. Both are the engine-layout contract shared with
	// the editor + other games (mirroring `backgroundScenes`/`hasAuthoredBackground`). `apps/lines`'
	// fallback authors NO `hud_*` scene ⇒ list empty, flag false ⇒ the coded `<UI>` renders
	// unconditionally as today (byte-identical parity).
	const authoredHud = $derived(authoredHudScenes(editorDoc.scenes));
	const suppressCodedHud = $derived(hasAuthoredHud(editorDoc.scenes));

	const context = getContext();

	// Invisible Flow (Phase 4) — the runtime interpreter, built once the live editor doc
	// loads (it resolves authored screen ids to their scenes). ABSENT by default (no FlowDoc
	// ⇒ `createLinesFlow` returns `undefined`), so the interpreter is inert and every screen
	// mounts via the coded path below — byte-identical to current `main` (§7). When active,
	// it drives book-event dispatch (via `flowInterpreterHolder`, read in `game/utils.ts`)
	// and the generic mounter resolves which authored screen mounts here.
	let flow = $state<LinesFlow | undefined>(undefined);
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
	// Whether the base-game screen node is currently active. The reel board + basegame mount gate
	// on this: during `loading` (basegame not yet active) the reels are HIDDEN; once loading
	// completes and basegame activates, they appear. INERT-FLOW FALL-THROUGH: with no FlowDoc the
	// interpreter is undefined and this is `false` — but the board then falls through to its coded
	// unconditional mount (the `!flow` fall-through below), so a non-flow game is unchanged (§7).
	const isBasegameActive = $derived(activeScreenIds.includes(basegameScreenId));
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
	] as const;
	const reservedSceneIds = $derived(
		new Set<string>([
			...RESERVED_SCENE_IDS,
			// The role-resolved loading/basegame scenes (custom ids included) — so a renamed,
			// role-tagged loading/base scene is handled by its own path and never ALSO mounts
			// here as a generic overlay (the double-background/double-splash the owner hit).
			loadingScreenId,
			basegameScreenId,
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
			(scene) => !scene.id.startsWith('hud_'),
		),
	);

	// Cross-screen z-order (design doc §11.5 follow-up C). The LAYERABLE scenes — the HUD
	// chrome, the base-game overlays, the special-book bonus, custom author overlays, and the
	// flow takeover — now paint in the editor's screen-LIST order (their position in
	// `editorDoc.scenes`) rather than this component's fixed markup sequence. `docLayerZIndex`
	// maps each scene's doc index into a band ABOVE the base game and BELOW the engine-owned top
	// band (`LAYER_BAND_TOP`, where the full-screen free-spin gates + loading + info overlay
	// live, so a reorder can never bury a blocking gate). The reel board (`<MainContainer>`) is
	// NOT layerable — it stays between the below/above-reel slices, unmoved. PARITY: the
	// reference layout lists these scenes in the same relative order as the old markup (HUD →
	// basegameOverlays → specialBook), so an un-reordered / flow-less boot assigns z that
	// reproduces today's stacking (`undefined` ⇒ no override, default insertion order). The HUD
	// takes the lower of its two scene ids' z so the whole chrome sits at one layer.
	const hudZIndex = $derived(
		Math.min(
			docLayerZIndex(editorDoc.scenes, 'hudBar') ?? Number.MAX_SAFE_INTEGER,
			docLayerZIndex(editorDoc.scenes, 'hudCorners') ?? Number.MAX_SAFE_INTEGER,
		),
	);
	const basegameOverlaysZIndex = $derived(docLayerZIndex(editorDoc.scenes, 'basegameOverlays'));
	const specialBookZIndex = $derived(docLayerZIndex(editorDoc.scenes, 'specialBook'));
	// The takeover (loading splash at boot + transient celebrations) is NOT a doc-ordered
	// persistent layer — it sits at the fixed TAKEOVER band ABOVE every layerable scene (so the
	// boot splash is never painted under `basegameOverlays`/`specialBook`, matching the old markup
	// where the takeover mounted OVER the base + HUD + overlays) and below the engine top band.
	const activeScreenTakeoverZIndex = LAYER_BAND_TAKEOVER;

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
	// The idle→bet / else→stop decision, byte-for-byte `ButtonBetProvider.onpress`' body (minus
	// the leading `soundPressBet`). Extracted so the coded spin `onpress` AND the flow `invokeIntent`
	// share ONE source of truth for the decision — an authored Spin pin runs the EXACT same bet/stop
	// as the hard-coded button (design doc §8.2/§8.5). Not the sound (that stays on the button press).
	const doSpinBetOrStop = (): void => {
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
	};

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
	};

	// Functional action pin routing (design doc §8.5): if an author wired this button's `pin`
	// action into a flow intent, route the press THROUGH the flow (which calls `invokeIntent`)
	// and stop — one path, no double-fire. UNWIRED / inert interpreter ⇒ `hasFlowAction` is
	// false ⇒ `coded()` runs exactly as today (parity §8.8). Shared by every HUD action's
	// `onpress` so the flow-routing lives in ONE place, not copied per button.
	const routeActionThroughFlow = (pin: string, coded: () => void): void => {
		if (hasFlowAction(pin)) {
			emitFlowAction(pin);
			return;
		}
		coded();
	};

	registerComponentActions({
		// ButtonMenu — open the menu overlay. No disabled/active.
		menu: {
			onpress: () => {
				context.eventEmitter.broadcast({ type: 'soundPressGeneral' });
				routeActionThroughFlow('menu', doOpenMenu);
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
				stateUi.menuOpen = false;
				stateModal.modal = { name: 'payTable' };
			},
		},
		gameRules: {
			onpress: () => {
				context.eventEmitter.broadcast({ type: 'soundPressGeneral' });
				stateUi.menuOpen = false;
				stateModal.modal = { name: 'gameRules' };
			},
		},
		settings: {
			onpress: () => {
				context.eventEmitter.broadcast({ type: 'soundPressGeneral' });
				stateUi.menuOpen = false;
				stateModal.modal = { name: 'settings' };
			},
		},
		// ButtonSoundSwitch — toggle master volume. `active` reflects sound-on so an
		// authored button can show its selected-state image while unmuted.
		soundToggle: {
			onpress: () => {
				context.eventEmitter.broadcast({ type: 'soundPressGeneral' });
				stateSound.volumeValueMaster = stateSound.volumeValueMaster === 0 ? 50 : 0;
			},
			active: boolSource(() => stateSound.volumeValueMaster !== 0),
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
				routeActionThroughFlow('turbo', doToggleTurbo);
			},
			disabled: boolSource(() => stateBet.isSpaceHold),
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
				// Functional action pin (design doc §8.5): an authored `spin` action → intent edge
				// routes the press THROUGH the flow; unwired / inert ⇒ the coded bet/stop runs
				// exactly as today (parity §8.8). Same shared helper the other HUD actions use.
				routeActionThroughFlow('spin', doSpinBetOrStop);
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
			flow = createLinesFlow(
				doc,
				(screenIds, entrances) => applyActiveScreens(screenIds, entrances),
				// Intent host bridge (design doc §8.5): a wired `action → intent` edge invokes the EXACT
				// coded behaviour of that HUD button (spin/increase/decrease/turbo/menu) via the shared
				// `invokeHostIntent` dispatch. An unknown intent is a safe no-op (parity §8.8).
				(_screenId, intent) => invokeHostIntent(intent),
			);
			setFlowInterpreter(flow);
			// Seed the rune from the interpreter's initial active set (the `initial` node), then run
			// its enter choreography. `onActiveScreensChange` keeps it in sync on add/remove.
			activeScreenIds = flow?.activeScreenIds ?? [];
			void flow?.start();
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
		Persistent authored background (§ persistent-bg-scene). Any `space: 'background'`
		scene the author created renders here as a full-bleed layer BEHIND everything
		(`zIndex={-10}`, below the coded background's -3..-1 and the loading screen), and
		OUTSIDE the loading `{#if}` so it shows across the WHOLE session — base + free game
		and behind the splash. `<LayoutScene>` cover-fits each node to the canvas (the
		engine's `space:'background'` path) and honours the scene's own `visibleSource`
		gate; an ungated scene is always-on. Rendered in editor scene order (lowest first).
		Empty list ⇒ nothing renders (parity). When at least one such scene has real
		content, the coded bundled `<Background>` spine is suppressed so the authored art
		REPLACES the reference background; absent ⇒ the coded `<Background>` renders as today.
	-->
	{#each bgScenes as scene (scene.id)}
		<Container zIndex={-10}>
			<LayoutScene {scene} />
		</Container>
	{/each}

	{#if !suppressCodedBackground}
		<Background cover={backgroundCover} />
	{/if}

	<ResumeBet />
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
		<OnHotkey hotkey="Space" disabled={spinHotkeyDisabled} onpress={spinHotkeyPress} />
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
			below-reel layers, the reel board (BoardFrame + Board + Anticipations), and its
			above-reel layers — renders ONLY while the base-game screen NODE is active
			(`isBasegameActive`). During `loading` (basegame not yet activated) the reels are
			HIDDEN behind the loading splash; the `complete` swap to basegame reveals them on the
			clean background. This fixes the reels being visible behind the loading overlay.

			INERT-FLOW FALL-THROUGH (parity §7): when NO flow drives the game (`!flow` — no
			FlowDoc, the interpreter is undefined), the base game renders UNCONDITIONALLY exactly
			as today, so a non-flow game is byte-identical to current `main`. Only a flow-driven
			boot (which always exists in apps/lines via the synthesized loading leg) gates on the
			active set. -->
	{#if !flow || isBasegameActive}
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

		<MainContainer>
			<BoardFrame />
			<Board />
			<Anticipations />
		</MainContainer>

		{#if basegameMount}
			{#if basegameMountAboveReel && basegameMountAboveReel.nodes.length}
				<LayoutScene scene={basegameMountAboveReel} />
			{/if}
		{:else if basegameAboveReel && basegameAboveReel.nodes.length}
			<LayoutScene scene={basegameAboveReel} />
		{/if}
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
		-->
	{#if (!isHudFlowManaged || isHudActive) && !suppressCodedHud}
		<!-- Cross-screen z-order (§11.5-C): the HUD chrome paints at its doc-list position via
				 `hudZIndex`. Leaving it where the reference layout places it (before the win/bonus
				 overlays) reproduces today's stacking; moving it in the editor re-layers it. -->
		<Container zIndex={hudZIndex}>
			<!-- The HUD is rendered by `<UI>`, not a `<LayoutScene>`, so it can't use
					 `<FlowScreenMount>`; `<FlowFade>` wraps the chrome the same way (mount-hidden alpha
					 0→1) when its activating edge carried an entrance transition, else renders it
					 directly (hard cut — parity). Keyed on `hudEntrance` so a fresh entrance remounts
					 the fader; `hudEntrance` is undefined when the HUD isn't flow-managed. -->
			{#key hudEntrance}
				<FlowFade transition={hudEntrance} timeScale={stateBetDerived.timeScale}>
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
				</FlowFade>
			{/key}
		</Container>
	{/if}
	<!--
			§16 — author REPLACEMENT HUD screens (the FULL-REPLACE contract). Each `hud_`-prefixed
			author scene renders as the top HUD layer via `<LayoutScene>` (a `space:'standard'` +
			`align.vertical:'bottom'` scene bottom-frames exactly like the coded bar), painted at its
			editor screen-list position (`docLayerZIndex`, the §11.5-C layerable contract) so a
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
		{#if !flow || !flow.mounter.authoredScreenIds().has(scene.id) || activeScreenIds.includes(scene.id)}
			<Container zIndex={docLayerZIndex(editorDoc.scenes, scene.id)}>
				<LayoutScene {scene} />
			</Container>
		{/if}
	{/each}
	<Container zIndex={basegameOverlaysZIndex}>
		<LayoutScene scene={basegameOverlaysScene} />
	</Container>
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
	{#each extraScenes as scene (scene.id)}
		<Container zIndex={docLayerZIndex(editorDoc.scenes, scene.id)}>
			<LayoutScene {scene} />
		</Container>
	{/each}
	<!--
			Invisible Flow (Phase 4, flow-driven-game §4) — the GENERIC active-screen TAKEOVER
			layer. When the interpreter swaps the active exclusive screen to an authored id that is
			NOT `basegame`/`loading` (a `bigWin`/`freeSpinIntro`/future celebration), it mounts here
			as a TRANSIENT layer OVER the base game + HUD — at the z-position the coded win/free-spin
			celebration overlays occupy (this sits just above `extraScenes` + the base/HUD and beside
			the free-spin gates/visuals below). The base board PERSISTS behind it (the reel is
			engine-owned, not a flow screen), so a celebration overlays the reels rather than
			replacing them. `<LayoutScene>` self-wraps by `scene.space` + honours `visibleSource` (no
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
			§17 Phase 3 — the free-spin INTRO/OUTRO press-to-continue HOLD is engine-owned.
			Exactly one full-screen `<FreeSpinIntroGate>` / `<FreeSpinOutroGate>` is mounted
			here (dim + press-to-continue + the round-blocking `waitForResolve`), so the round
			ALWAYS holds until the player taps — whether the intro/outro is this doc-driven
			VISUAL scene below or an author's custom screen gated via `Scene.visibleSource =
			'freeSpinIntroShow'`/`'freeSpinOutroShow'` (no gate component required). The doc
			scenes (`fsIntroScene`/`fsOutroScene`) and the composer never mount a gate now, so
			there is never a second `waitForResolve` subscriber (two would hang the round).
		-->
	<!-- Engine-owned TOP band (§11.5-C): the full-screen free-spin gates + their doc VISUAL
			 scenes + the free-spin counter + the info overlay sit at a FIXED `LAYER_BAND_TOP` z,
			 ABOVE every doc-ordered layerable scene — so an author reordering the HUD/overlays/
			 specialBook in the editor can never bury a round-blocking gate or the counter. Exactly
			 one gate each is mounted (the single `waitForResolve` subscriber), unchanged. -->
	<Container zIndex={LAYER_BAND_TOP}>
		<FreeSpinIntroGate
			dimColor={fsIntroGate?.dimColor}
			dimAlpha={fsIntroGate?.dimAlpha}
			hidePrompt={fsIntroGate?.hidePrompt}
		/>
		<FreeSpinOutroGate
			dimColor={fsOutroGate?.dimColor}
			dimAlpha={fsOutroGate?.dimAlpha}
			hidePrompt={fsOutroGate?.hidePrompt}
		/>
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
		<InfoOverlay manifest={infoManifest} />
	</Container>
	<!-- specialBook paints at its doc-list position (§11.5-C), interleaving with the HUD /
			 overlays / extras band. Reference-layout order reproduces today's stacking. -->
	<Container zIndex={specialBookZIndex}>
		<LayoutScene scene={specialBookScene} />
	</Container>

	<!--
			Invisible FX (§4.4 / §8) — play this project's baked effects. Free effects mount at
			the scene level; bone-placed effects mount inside a host `<SpineProvider>` so they
			ride the rig. Renders nothing when no effects are baked (parity, byte-identical).
		-->
	<Effects />

	<I18nTest />

	<DebugStage />
</App>

<Modals disabledModals={['payTable', 'gameRules']}>
	{#snippet version()}
		<GameVersion />
	{/snippet}
</Modals>

<GameVersion fixed />

<DebugMenu />
