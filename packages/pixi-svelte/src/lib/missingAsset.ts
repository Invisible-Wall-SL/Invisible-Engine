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
