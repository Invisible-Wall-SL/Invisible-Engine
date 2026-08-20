<script lang="ts">
	import { CanvasSizeRectangle } from 'components-layout';
	import { hasContinuePress, runTopContinuePress } from 'state-shared';

	// The canvas-top INPUT MASK for a press-to-continue overlay (free-spin intro/outro, big win,
	// any authored `tapToContinue` screen). Mounted ONCE by the game, above every z-band.
	//
	// The problem it solves: `PressToContinue` renders its own full-screen hit rect, but that rect
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
	// Nothing is mounted while no press is live ⇒ the HUD behaves exactly as before.
</script>

{#if hasContinuePress()}
	<CanvasSizeRectangle
		onpointerup={() => runTopContinuePress()}
		cursor="pointer"
		eventMode="static"
		backgroundColor={0xffffff}
		backgroundAlpha={0.001}
	/>
{/if}
