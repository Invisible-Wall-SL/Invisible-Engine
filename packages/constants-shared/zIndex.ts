export const zIndex = {
	modal: 50,
	dialog: 100,
	info: 150,
	// Above the HTML shell's `#ie-boot` splash (99999) so a lost connection shows during boot too;
	// below the debug menu (2147483646) so its preview toggles stay reachable.
	connection: 1_000_000,
} as const;
