/**
 * Put the baked build stamp where a person can read it: `__IE_BUILD__` in the console of a running
 * game answers "which build is this, cut from which engine and game commit, with which lockfile".
 *
 * The define itself is a compile-time substitution, so without this the answer exists only inside
 * the bundle — and a player build hides the on-screen stamp (`GameVersion`'s `fixed` mode is debug
 * only). Frozen, because it is a record of the build rather than a setting.
 */
export function exposeBuildInfo(): void {
	if (typeof window === 'undefined' || typeof __IE_BUILD__ === 'undefined') return;
	Object.defineProperty(window, '__IE_BUILD__', {
		value: Object.freeze({ ...__IE_BUILD__ }),
		configurable: true,
	});
}
