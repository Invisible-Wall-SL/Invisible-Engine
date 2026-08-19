<script lang="ts">
	import { CanvasSizeRectangle } from 'components-layout';
	import { FadeContainer } from 'components-pixi';
	import { waitForResolve } from 'utils-shared/wait';

	import { getContext } from '../game/context';
	import { PressToContinue } from 'engine-game';

	// The optional full-screen GATE of the book reveal (Phase 3): the dim backdrop + the
	// press-to-continue tap, and it OWNS the round-blocking await. Mirrors `FreeSpinIntroGate`
	// exactly — a single AWAITABLE arm (`bookRevealGateShow`) both shows the gate AND returns the
	// `waitForResolve` hold, so a `broadcastAwait('bookRevealGateShow')` in the choreography blocks
	// the round until the player taps. Always mounted; only visible while the hold is pending.
	// Alternative to the auto-play `broadcast('specialBookReveal') → delay(ms)` pacing (author's
	// choice, per choreography). Mounted as a `canvas`-space bind anchor, never positioned.
	const context = getContext();

	let show = $state(false);
	let oncomplete = $state(() => {});

	context.eventEmitter.subscribeOnMount({
		bookRevealGateShow: async () => {
			show = true;
			await waitForResolve((resolve) => (oncomplete = resolve));
			show = false;
		},
	});
</script>

<FadeContainer {show}>
	<CanvasSizeRectangle backgroundColor={0x000000} backgroundAlpha={0.5} />
	<PressToContinue onpress={() => oncomplete()} />
</FadeContainer>
