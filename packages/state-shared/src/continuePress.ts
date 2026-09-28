/**
 * The live press-to-continue handlers, oldest first. Held OUTSIDE `$state` because they are
 * callbacks, not reactive data (the reactive half is `stateUi.continuePressCount`, read via
 * `hasContinuePress()`). Import-free, so fixtures can load it headlessly.
 *
 * Why a registry at all: an overlay's own full-screen hit rect sits at the overlay's z, so any
 * chrome painted ABOVE it (the HUD - spin, turbo, bet steppers) hit-tests FIRST and swallows the
 * click. The press then does nothing at all: the button is inert under the celebration lock, and
 * the tap never reaches the overlay. Hovering the spin button therefore made the celebration
 * unskippable until the player moved the pointer off it. The fix is a single canvas-top INPUT MASK
 * (`ContinuePressMask`) the game mounts above every band, so the overlay masks the chrome instead
 * of the chrome masking the overlay. The mask needs to know WHICH overlay's press to run - that is
 * this registry.
 */
const continuePressHandlers: { id: number; onpress: () => void }[] = [];
let continuePressNextId = 1;

/**
 * Register `onpress` as a live press-to-continue handler and return its unregister. Called by the
 * `PressToContinue` overlay alongside the `continuePressCount` bump.
 */
export const registerContinuePress = (onpress: () => void): (() => void) => {
	const id = continuePressNextId++;
	continuePressHandlers.push({ id, onpress });
	return () => {
		const index = continuePressHandlers.findIndex((entry) => entry.id === id);
		if (index >= 0) continuePressHandlers.splice(index, 1);
	};
};

/**
 * The handler a press STARTING now belongs to - the NEWEST live one, which the mask captures on
 * pointer-DOWN. Newest, not oldest: two gates overlap across a fade-out/fade-in, and the one that
 * just mounted is the one in front of the player (what the per-overlay hit rects did on their own -
 * the later mount painted on top and won the hit test). `undefined` when nothing is live.
 */
export const topContinuePress = (): number | undefined =>
	continuePressHandlers[continuePressHandlers.length - 1]?.id;

/**
 * Run the handler a press started on ({@link topContinuePress} at its pointer-DOWN) - the mask's
 * pointer-UP. Never one registered DURING the press: that surface armed mid-press, and the release
 * of a press it never saw begin is not a tap on it (a free-spin outro's skip tap landed the count on
 * pointer-DOWN, armed the outro's tap-to-continue, and its own pointer-UP dismissed the outro). A
 * handler that went away mid-press runs nothing, rather than handing the press to whichever
 * overlay sat beneath it.
 *
 * Ids are never reused. The mask can hold a press record past its handler's life (Pixi forwards no
 * `pointercancel`, and a rect unmounted mid-press gets no `pointerupoutside`), and that is safe only
 * because a dead id can never name a live handler.
 */
export const runContinuePress = (id: number | undefined): void => {
	continuePressHandlers.find((entry) => entry.id === id)?.onpress();
};
