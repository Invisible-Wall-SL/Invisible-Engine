<script lang="ts">
	import { onMount } from 'svelte';

	import { EnablePixiExtension } from 'components-pixi';
	import { EnableHotkey } from 'components-shared';
	import { MainContainer } from 'components-layout';
	import { App, Text, REM } from 'pixi-svelte';
	import { stateBet, stateBetDerived, stateModal } from 'state-shared';

	import { UI, UiGameName, InfoOverlay } from 'components-ui-pixi';
	import { GameVersion, Modals } from 'components-ui-html';
	import { LayoutScene } from 'engine-layout/svelte';
	import {
		registerBoundComponents,
		registerComponents,
		registerComponentValues,
		HUD_READOUT_DEF,
		findReelGridNode,
		backgroundCoverScale,
		backgroundCoverStretch,
		backgroundFit,
	} from 'engine-layout';

	import { infoManifest } from '../game/infoManifest';
	import { setBoardOverride } from '../game/stateGame.svelte';
	import { valueSource } from '../game/valueSource';
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

	registerBoundComponents({ Win, Transition });
	// Batch B / B4.2 — register the parametric HUD readout def + its live value
	// sources. PARITY-SAFE: nothing mounts a `hudReadout` `componentInstance` yet
	// (the HUD still renders the coded `Label*` snippets), so this has NO render
	// effect — it only populates the engine-layout registries for B4.3+.
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
		<LoadingScreen onloaded={() => (context.stateLayout.showLoadingScreen = false)} />
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
		<FreeSpinIntro />
		{#if ['desktop', 'landscape'].includes(context.stateLayoutDerived.layoutType())}
			<FreeSpinCounter />
		{/if}
		<FreeSpinOutro />
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
