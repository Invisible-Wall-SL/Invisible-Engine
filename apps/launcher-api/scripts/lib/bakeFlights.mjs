/**
 * The BAKE half of the Hold and Win `flights` block (`bake-editor-doc.mjs`) — split out so
 * `check:flights` can run the exact code the bake runs instead of grepping for it.
 *
 * Deliberately a SHAPE rebuild, not a second normalizer: the server already normalized the block
 * (`engine-layout` `normalizeFlights`) and the game re-normalizes every style it resolves
 * (`resolveFlightStyle`), so a copy of those rules here would only be a copy that drifts. This keeps
 * an object of non-empty style objects under flight-shaped keys, and nothing else.
 */

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** `toTotal` / `toCollector` / `boostBeam` / `toCounter` / `upgradeBeam` / `unlockRow` / `toMeter`
 *  / `toMeter:<id>` — by shape. */
const FLIGHT_KEY =
	/^(toTotal|toCollector|boostBeam|toCounter|upgradeBeam|unlockRow|toMeter|toMeter:\S(.*\S)?)$/;

/** The baked `symbols.flights`, or undefined (no key) when nothing is authored. */
export function bakeFlights(raw) {
	if (!isRecord(raw)) return undefined;
	const out = {};
	for (const [key, style] of Object.entries(raw)) {
		if (!FLIGHT_KEY.test(key) || !isRecord(style) || !Object.keys(style).length) continue;
		out[key] = style;
	}
	return Object.keys(out).length ? out : undefined;
}

/** Every effect the baked block plays — trails and arrivals — for the reachable-effects keep-set. */
export function bakedFlightEffectIds(flights) {
	const ids = new Set();
	for (const style of Object.values(flights ?? {})) {
		const trail = style?.trail;
		if (
			isRecord(trail) &&
			trail.off !== true &&
			typeof trail.effectId === 'string' &&
			trail.effectId
		)
			ids.add(trail.effectId);
		const arrival = style?.arrival;
		if (isRecord(arrival) && typeof arrival.effectId === 'string' && arrival.effectId)
			ids.add(arrival.effectId);
	}
	return [...ids];
}
