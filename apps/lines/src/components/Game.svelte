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
	import { LayoutScene, FlowMount } from 'engine-layout/svelte';
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
		backgroundScenes,
		hasAuthoredBackground,
		extraMountScenes,
	} from 'engine-layout';
	import type { Scene } from 'engine-layout';

	import { infoManifest } from '../game/infoManifest';
	import { resetSymbolMapCache } from '../game/symbolMap';
	import { createLinesFlow, type LinesFlow } from '../game/flowRuntime.svelte';
	import { setFlowInterpreter } from '../game/flowInterpreterHolder';
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

	const context = getContext();

	// Invisible Flow (Phase 4) — the runtime interpreter, built once the live editor doc
	// loads (it resolves authored screen ids to their scenes). ABSENT by default (no FlowDoc
	// ⇒ `createLinesFlow` returns `undefined`), so the interpreter is inert and every screen
	// mounts via the coded path below — byte-identical to current `main` (§7). When active,
	// it drives book-event dispatch (via `flowInterpreterHolder`, read in `game/utils.ts`)
	// and the generic mounter resolves which authored screen mounts here.
	let flow = $state<LinesFlow | undefined>(undefined);
	// The interpreter's CURRENT active screen, mirrored into a rune so the loading↔basegame
	// swap (Phase 1) re-mounts. The interpreter's internal `activeScreenId` is a plain variable
	// (not a rune), so it is pushed here via `onActiveScreenChange` (wired in `onMount`) + seeded
	// from `flow.activeScreenId` at boot. `undefined` ⇒ inert (no FlowDoc) ⇒ pure coded path.
	let activeScreenId = $state<string | undefined>(undefined);
	// The active screen's resolved scene for the generic mounter. `undefined` ⇒ the
	// interpreter is not driving this screen ⇒ `<FlowMount>` renders the coded fall-through.
	const basegameMount = $derived.by(() => {
		const decision = flow?.mounter.resolve(activeScreenId);
		if (decision?.kind === 'authored' && decision.screenId === 'basegame') {
			return decision.scene as Scene;
		}
		return undefined;
	});
	// Flow-driven Phase 1 — the loading splash as a Flow screen (design doc flow-driven-game
	// §1). The interpreter OWNS `loading` only when the FlowDoc authors it AND a backing
	// `loading` scene exists (`mounter.has`). When it does, the interpreter decides when the
	// splash is shown (it is the `initial` active screen) and dismissed (a tap fires its
	// `complete` edge → `activeScreenId` becomes `basegame`), instead of the coded
	// `showLoadingScreen=false` on `onloaded`. When it does NOT (every normal apps/lines boot —
	// `LINES_FLOW_DOC` has only `basegame`), this is `false` and the coded `showLoadingScreen` /
	// `onloaded` path below is byte-identical to current `main` (§7).
	const flowOwnsLoading = $derived(flow?.mounter.has('loading') ?? false);
	// Whether the splash should render this frame. Flow-owned ⇒ while the interpreter's active
	// screen is `loading`; coded ⇒ the existing mutable `showLoadingScreen` flag (untouched).
	const showLoading = $derived(
		flowOwnsLoading ? activeScreenId === 'loading' : context.stateLayout.showLoadingScreen,
	);
	// The authored `loading` scene the interpreter resolved (when it owns loading) — its placed
	// content becomes the splash VISUAL via `<LoadingScreen authoredScene>`, exactly as the
	// coded `authoredLoadingScene` path does. `undefined` ⇒ no Flow ownership ⇒ coded path.
	const flowLoadingMount = $derived.by((): Scene | undefined => {
		if (!flowOwnsLoading) return undefined;
		const decision = flow?.mounter.resolve('loading');
		return decision?.kind === 'authored' ? (decision.scene as Scene) : undefined;
	});
	// Dismiss the splash. Flow-owned ⇒ the tap/transition completes the active `loading` screen
	// (its `complete` edge swaps to `basegame`); coded ⇒ the existing flag flip (parity).
	const dismissLoading = (): void => {
		if (flowOwnsLoading) void flow?.completeActiveScreen();
		else context.stateLayout.showLoadingScreen = false;
	};
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
	// interpreter's active screen is an authored exclusive screen that is NEITHER `basegame`
	// (the persistent base, mounted via the reel-split above) NOR `loading` (the splash, owned
	// by the Phase-1 path), it is a TRANSIENT TOP-LAYER takeover (`bigWin`, `freeSpinIntro`, any
	// future authored id): the base game (board) PERSISTS behind it, the takeover overlays it
	// (a big-win celebration sits OVER the reels, it does not replace them). This is a single
	// GENERIC mount, NOT per-id special-casing — the swap to ANY such screen reproduces the
	// right stacking. The scene is `<LayoutScene>`-mounted, which self-wraps by `scene.space`
	// and honours `scene.visibleSource` (no double-wrap). It renders ONLY while that screen is
	// the active screen (gated on `activeScreenId` via the resolve below), so it unmounts on the
	// swap back to `basegame`. `undefined` ⇒ nothing extra mounts:
	//   - no FlowDoc ⇒ `flow` is undefined ⇒ `resolve` is undefined (parity, §7);
	//   - the active screen falls through / has no backing scene ⇒ `fallThrough`/undefined;
	//   - the active screen IS `basegame`/`loading` ⇒ handled by their own paths above.
	// apps/lines' default doc authors no such screen ⇒ inert (byte-identical to `main`, §7).
	const activeScreenTakeover = $derived.by((): Scene | undefined => {
		if (activeScreenId === 'basegame' || activeScreenId === 'loading') return undefined;
		const decision = flow?.mounter.resolve(activeScreenId);
		return decision?.kind === 'authored' ? (decision.scene as Scene) : undefined;
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
		new Set<string>([...RESERVED_SCENE_IDS, ...(flow?.mounter.authoredScreenIds() ?? [])]),
	);
	// The author's NEW screens (custom ids, non-background space) the game would otherwise
	// never mount. Empty for `apps/lines`' fallback doc (it reserves all its ids + ships no
	// extra scene) ⇒ the `{#each}` renders nothing ⇒ byte-identical to `main` (parity).
	const extraScenes = $derived(extraMountScenes(editorDoc.scenes, reservedSceneIds));

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
	const stripLoadingAnchor = (scene: Scene): Scene | undefined => {
		const nodes = scene.nodes.filter(
			(node) => node.id !== 'loading-screen' && node.bind?.component !== 'LoadingScreen',
		);
		return nodes.length > 0 ? { ...scene, nodes } : undefined;
	};
	const authoredLoadingScene = $derived(
		loadingScene ? stripLoadingAnchor(loadingScene) : undefined,
	);
	// The splash VISUAL the game hands to `<LoadingScreen authoredScene>`. When the interpreter
	// OWNS loading (Phase 1), it is the interpreter-resolved `loading` scene (still stripped of
	// the inert `LoadingScreen` anchor so it can't double-draw); otherwise the coded
	// `authoredLoadingScene`. Identical filter either way, so an un-owned boot is unchanged.
	const splashAuthoredScene = $derived(
		flowLoadingMount ? stripLoadingAnchor(flowLoadingMount) : authoredLoadingScene,
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
			flow = createLinesFlow(doc, (screenId) => (activeScreenId = screenId));
			setFlowInterpreter(flow);
			// Seed the rune from the interpreter's initial active screen (the `initial` node),
			// then run its enter choreography. `onActiveScreenChange` keeps it in sync on swaps.
			activeScreenId = flow?.activeScreenId;
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

	{#if showLoading}
		<!--
			Move 3 Phase B — the doc-driven `loading` scene transform repositions/rescales
			the whole splash as one unit. Default node (x:0, y:0, no scale) → no-op container
			(x=0, y=0, scale/rotation/alpha undefined), byte-identical to the hardcoded mount.
			The coded mount + `onloaded` callback are kept verbatim (LoadingScreen is an
			either/or with the game, so it can't be a generic `bind`).
		-->
		{#if splashAuthoredScene}
			<!--
				AUTHORED splash: the editor's `loading` scene carries placed visual content
				(a `loadingIntro` component = logo + progress + percentage, a bare logo, ...),
				so it IS the splash. `<LoadingScreen authoredScene>` renders those nodes (each
				self-positions via its own canvas-space transform) and keeps only the coded
				press-to-continue / transition / `onloaded` shell. The `loadingIntro` bar
				self-hides on `stateApp.loaded`, then the coded press-to-continue appears.
				`dismissLoading` flips the coded flag, OR — when the interpreter owns `loading`
				(Phase 1) — completes the active `loading` screen so its `complete` edge swaps to
				`basegame`. The asset-load gate stays inside `<LoadingScreen>` (press-to-continue
				is gated on `stateApp.loaded`), so the tap only arms after load.
			-->
			<LoadingScreen authoredScene={splashAuthoredScene} onloaded={dismissLoading} />
		{:else}
			<Container
				x={loadingPos.x}
				y={loadingPos.y}
				scale={loadingTransform?.scale}
				rotation={loadingTransform?.rotation}
				alpha={loadingTransform?.alpha}
				zIndex={loadingTransform?.zIndex}
			>
				<LoadingScreen onloaded={dismissLoading} />
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
			 above-reel layers (so editor stacking order around the reel is honored).

			 Invisible Flow (Phase 4/5): `<FlowMount>` is the generic-mounter boundary. When the
			 interpreter authors `basegame` it mounts the authored scene's BELOW-reel slice (via
			 <LayoutScene>); otherwise it renders the coded below-reel split — byte-identical to
			 `main` (§7). The board MainContainer always mounts (the reel is engine-owned, not a
			 flow screen), and the ABOVE-reel slice renders AFTER it below — so an authored
			 basegame reproduces the exact below-reel → board → above-reel z-order (§11.5 B.1). -->
		<FlowMount scene={basegameMountBelowReel}>
			{#snippet fallback()}
				<LayoutScene scene={basegameBelowReel} />
			{/snippet}
		</FlowMount>

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
			<LayoutScene {scene} />
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
			<LayoutScene scene={activeScreenTakeover} />
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
		<LayoutScene scene={specialBookScene} />
		<InfoOverlay manifest={infoManifest} />

		<!--
			Invisible FX (§4.4 / §8) — play this project's baked effects. Free effects mount at
			the scene level; bone-placed effects mount inside a host `<SpineProvider>` so they
			ride the rig. Renders nothing when no effects are baked (parity, byte-identical).
		-->
		<Effects />

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
