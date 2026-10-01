/**
 * What a press surface does when a press is HELD: `enabled` is read at each pointer-down (false ⇒ the
 * press is a plain click), `start` runs once the press has lasted `holdMs`, `end` when it is let go.
 */
export type PressHold = {
	holdMs: number;
	enabled: () => boolean;
	start: () => void;
	end: () => void;
};

/**
 * Press-and-hold for a pixi press surface whose click lands on pointer-up. A press shorter than
 * `holdMs` is the surface's ordinary click. A longer one runs `hold.start`, then the surface's `press`
 * (the click it would have made, made NOW rather than on release), and its release makes no second
 * click.
 *
 * The release is read off the WINDOW, not the surface: a surface that greys mid-hold stops hit-testing
 * (`eventMode: 'none'`) and would never see the pointer-up, and a release off the surface, a
 * `pointercancel`, the pointer leaving the page, a window blur or a hidden tab all end the hold too —
 * so a hold can never outlive the finger. While a press is live the browser's long-press menu and
 * text selection are suppressed.
 */
export const createPressHold = ({
	hold,
	press,
}: {
	hold: () => PressHold | undefined;
	press: () => void;
}) => {
	let pointerId: number | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let started: PressHold | undefined;
	// The pointer whose press became a hold: its release on the surface is not a click.
	let heldPointerId: number | undefined;

	const onWindowRelease = (e: PointerEvent) => {
		if (e.pointerId === pointerId) finish();
	};
	const onVisibilityChange = () => {
		if (document.visibilityState === 'hidden') finish();
	};
	const preventDefault = (e: Event) => e.preventDefault();

	// Built on first use: a surface is constructed during SSR too, where there is no `window`.
	let listeners: [EventTarget, string, (e: Event) => void, boolean][] | undefined;
	const getListeners = (): [EventTarget, string, (e: Event) => void, boolean][] =>
		(listeners ??= [
			[window, 'pointerup', (e) => onWindowRelease(e as PointerEvent), true],
			[window, 'pointercancel', (e) => onWindowRelease(e as PointerEvent), true],
			[window, 'blur', () => finish(), false],
			[window, 'contextmenu', preventDefault, true],
			[window, 'selectstart', preventDefault, true],
			[document, 'visibilitychange', onVisibilityChange, false],
			[document.documentElement, 'pointerleave', () => finish(), false],
		]);

	const listen = (on: boolean) => {
		for (const [target, type, listener, capture] of getListeners()) {
			if (on) target.addEventListener(type, listener, capture);
			else target.removeEventListener(type, listener, capture);
		}
	};

	function finish() {
		if (pointerId === undefined) return;
		clearTimeout(timer);
		timer = undefined;
		pointerId = undefined;
		listen(false);
		const ending = started;
		started = undefined;
		ending?.end();
	}

	return {
		down: (id: number) => {
			if (pointerId !== undefined) return;
			heldPointerId = undefined;
			const pressHold = hold();
			if (!pressHold?.enabled()) return;
			pointerId = id;
			listen(true);
			timer = setTimeout(() => {
				timer = undefined;
				started = pressHold;
				heldPointerId = id;
				pressHold.start();
				press();
			}, pressHold.holdMs);
		},
		/** The surface's own pointer-up: the click, unless this press became a hold. */
		up: (id: number) => {
			const held = heldPointerId === id;
			heldPointerId = undefined;
			if (id === pointerId) finish();
			if (!held) press();
		},
		/** The surface went inert: drop a press that is not a hold yet (a hold runs on to its release). */
		disarm: () => {
			if (!started) finish();
		},
		/** Unmount: end everything, a running hold included. */
		cancel: () => {
			heldPointerId = undefined;
			finish();
		},
	};
};
