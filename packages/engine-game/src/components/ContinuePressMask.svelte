<script lang="ts">
	import { CanvasSizeRectangle } from 'components-layout';
	import {
		hasContinuePress,
		hasSkipGesture,
		runTopContinuePress,
		runTopSkipGesture,
	} from 'state-shared';

	// The canvas-top INPUT MASK for a press-to-continue overlay (free-spin intro/outro, big win,
	// any authored `tapToContinue` screen) AND for a count-up's skip gesture (`CountUpInteraction`).
	// Mounted ONCE by the game, above every z-band.
	//
	// The problem it solves: those surfaces render their own full-screen hit rect, but that rect
	// paints at the OVERLAY's z. The HUD paints above most overlays, so a pointer resting on the
	// spin (or turbo) button won the hit test and swallowed the tap — the button is inert under the
	// celebration lock, so the click did nothing AND the overlay never advanced. The player had to
	// move the pointer off the button to skip a cinematic. Locking the button's press was never
	// going to fix that: an inert button still eats the pointer.
	//
	// So the overlay masks the chrome, rather than the chrome masking the overlay. While any press
	// is live this rect covers the whole canvas above everything, absorbs the tap wherever it lands
	// and runs the newest overlay's press body. The HUD buttons underneath become unclickable for
	// exactly as long as the overlay is up — no per-button pointer surgery, and it covers every
	// button (menu, bet steppers, buy) not just the two that were locked by hand.
	//
	// A press-to-continue OUTRANKS a skip gesture when both are live: the press is the round-blocking
	// gate the player is being asked to answer, while a count-up under it is already resolving. Both
	// register newest-first, so the surface that mounted last owns the tap within its own kind.
	//
	// Nothing is mounted while neither is live ⇒ the HUD behaves exactly as before.
</script>

{#if hasContinuePress() || hasSkipGesture()}
	<CanvasSizeRectangle
		onpointerdown={() => {
			if (!hasContinuePress()) runTopSkipGesture('down');
		}}
		onpointerup={() => (hasContinuePress() ? runTopContinuePress() : runTopSkipGesture('up'))}
		onpointerupoutside={() => {
			if (!hasContinuePress()) runTopSkipGesture('cancel');
		}}
		cursor="pointer"
		eventMode="static"
		backgroundColor={0xffffff}
		backgroundAlpha={0.001}
	/>
{/if}
