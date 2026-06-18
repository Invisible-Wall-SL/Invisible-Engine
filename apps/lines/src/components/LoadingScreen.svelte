<script lang="ts">
	import { SpineProvider, SpineTrack, Container, Sprite } from 'pixi-svelte';
	import { FadeContainer, LoadingProgress } from 'components-pixi';
	import { MainContainer } from 'components-layout';
	import { LayoutScene } from 'engine-layout/svelte';
	import type { Scene } from 'engine-layout';

	import { getContext } from '../game/context';
	import TransitionAnimation from './TransitionAnimation.svelte';
	import PressToContinue from './PressToContinue.svelte';

	type Props = {
		onloaded: () => void;
		/**
		 * The author's splash VISUAL from the editor's `loading` scene — the placed
		 * nodes (e.g. a `loadingIntro` component = logo + progress bar + percentage, or
		 * a bare logo). When present it REPLACES the coded logo+progress for the `start`
		 * phase, so the editor owns the splash look. The press-to-continue + transition
		 * shell below stay coded — a placed component can't carry the interactive
		 * `onloaded` flow (§ loading splash). Absent ⇒ the coded splash renders unchanged
		 * (parity for un-authored docs / games not on the editor-doc path). The scene's
		 * `space` ('canvas') drives `<LayoutScene>`'s own wrapper, so it is rendered bare
		 * here (no `MainContainer`), exactly as the coded fallback's canvas placement.
		 */
		authoredScene?: Scene;
	};

	const props: Props = $props();
	const context = getContext();

	let loadingType = $state<'start' | 'transition'>('start');
</script>

<!-- logo and loading progress -->
<FadeContainer show={loadingType === 'start'}>
	{#if props.authoredScene}
		<LayoutScene scene={props.authoredScene} />
	{:else}
		<MainContainer>
			<Container
				x={context.stateLayoutDerived.mainLayout().width * 0.5}
				y={context.stateLayoutDerived.mainLayout().height * 0.5}
			>
				<SpineProvider key="loader" width={300}>
					<SpineTrack trackIndex={0} animationName={'title_screen'} loop timeScale={3} />
				</SpineProvider>
				{#if !context.stateApp.loaded}
					<LoadingProgress y={250} width={1967 * 0.2} height={346 * 0.2}>
						{#snippet background(sizes)}
							<Sprite key="progressBarBackground.png" {...sizes} />
						{/snippet}
						{#snippet progress(sizes)}
							<Sprite key="progressBar.png" {...sizes} />
						{/snippet}
						{#snippet frame(sizes)}
							<Sprite key="progressBarFrame.png" {...sizes} />
						{/snippet}
					</LoadingProgress>
				{/if}
			</Container>
		</MainContainer>
	{/if}
</FadeContainer>

<!-- press to continue -->
<FadeContainer show={loadingType === 'start' && context.stateApp.loaded}>
	<PressToContinue onpress={() => (loadingType = 'transition')} />
</FadeContainer>

<!-- transition between the loading screen and the game -->
<FadeContainer show={loadingType === 'transition'}>
	<TransitionAnimation oncomplete={props.onloaded} />
</FadeContainer>
