const warned = new Set<string>();

/**
 * Report a missing asset key ONCE. The per-component missing-asset diagnostic lives in a
 * reactive `{#if …}` block, so it used to re-run on EVERY re-render while a key stayed absent —
 * during a spin that is many times per frame, per affected node. Worse, each run also did
 * `$state.snapshot(stateApp)` to dump the whole asset map, which is expensive and measurably
 * dropped frames. Dedupe on the message so a genuinely-missing key is surfaced once, cheaply,
 * and the hot path is a single Set lookup thereafter.
 */
export const warnMissingAsset = (message: string): void => {
	if (warned.has(message)) return;
	warned.add(message);
	console.error(message);
};

/**
 * Whether an asset key is ASSIGNED at all. An empty/absent key is not a missing asset — it is a
 * node the author has not pointed at anything yet, which the editor treats as a legitimate state
 * ("an empty `spineKey` ⇒ no rig resolves ⇒ nothing renders"). Nothing renders either way, so
 * reporting it as an error only buries the real missing keys under noise a boot can never clear.
 *
 * Lives here, beside {@link warnMissingAsset}, so the four diagnostics that use it (`Sprite`,
 * `SpineProvider`, `SpriteSheet`, `Particles`) share ONE rule instead of re-deriving it.
 */
export const hasAssetKey = (key: string | undefined): boolean =>
	typeof key === 'string' && key.length > 0;
