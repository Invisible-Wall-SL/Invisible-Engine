export const zIndex = {
	// The operator strip (clock, session time, HOME, HISTORY): over the canvas, under every modal —
	// a modal the player opened must never have its corner covered by the operator's links.
	chrome: 40,
	modal: 50,
	dialog: 100,
	info: 150,
	// Above the HTML shell's `#ie-boot` splash (99999) so a lost connection shows during boot too;
	// below the debug menu (2147483646) so its preview toggles stay reachable.
	connection: 1_000_000,
} as const;
