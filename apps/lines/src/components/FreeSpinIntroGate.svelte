<script lang="ts">
	import { CanvasSizeRectangle } from 'components-layout';
	import { FadeContainer } from 'components-pixi';
	import { waitForResolve } from 'utils-shared/wait';

	import { getContext } from '../game/context';
	import PressToContinue from './PressToContinue.svelte';

	// The full-screen GATE of the free-spin intro (§17 Phase 3): the dim backdrop + the
	// press-to-continue tap, and it OWNS the round-blocking await (so the board-relative
	// VISUAL — `FreeSpinIntroVisual` — can be an editor-positioned componentInstance while
	// this stays full-screen). Mounted as a `canvas`-space bind anchor, never positioned.
	const context = getContext();

	// Author overrides for the engine-owned gate LOOK (Scene.gate). The HOLD + full-screen
	// tap stay engine-owned; only the dim + default prompt restyle. Defaults reproduce
	// today's behaviour exactly (0x000000 / 0.5 / prompt shown).
	type Props = {
		dimColor?: number;
		dimAlpha?: number;
		hidePrompt?: boolean;
	};
	const props: Props = $props();

	let show = $state(false);
	let oncomplete = $state(() => {});

	context.eventEmitter.subscribeOnMount({
		freeSpinIntroShow: () => (show = true),
		freeSpinIntroHide: () => (show = false),
		freeSpinIntroUpdate: async () => {
			await waitForResolve((resolve) => (oncomplete = resolve));
		},
	});
</script>

<FadeContainer {show}>
	<CanvasSizeRectangle
		backgroundColor={props.dimColor ?? 0x000000}
		backgroundAlpha={props.dimAlpha ?? 0.5}
	/>
	<PressToContinue onpress={() => oncomplete()} hidePrompt={props.hidePrompt} />
</FadeContainer>
