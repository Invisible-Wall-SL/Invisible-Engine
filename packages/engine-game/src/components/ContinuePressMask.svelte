<script lang="ts">
	import { CanvasSizeRectangle, createPressStarts } from 'components-layout';
	import { hasContinuePress, runContinuePress, topContinuePress } from 'state-shared';

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
	// and runs the press body of the overlay that was on top when the press STARTED. A press already
	// in progress when the mask (or the overlay) armed runs nothing on release — the free-spin
	// outro's tap-to-skip lands the count on pointer-DOWN and arms the outro's own tap, and that
	// press's pointer-UP must not dismiss the total it just landed. See `runContinuePress`.
	//
	// Nothing is mounted while no press is live ⇒ the HUD behaves exactly as before.
	const presses = createPressStarts<number | undefined>();
</script>

{#if hasContinuePress()}
	<CanvasSizeRectangle
		onpointerdown={(e) => presses.down(e.pointerId, topContinuePress())}
		onpointerup={(e) => {
			const press = presses.up(e.pointerId);
			if (press) runContinuePress(press.startedOn);
		}}
		onpointerupoutside={(e) => presses.cancel(e.pointerId)}
		cursor="pointer"
		eventMode="static"
		backgroundColor={0xffffff}
		backgroundAlpha={0.001}
	/>
{/if}
