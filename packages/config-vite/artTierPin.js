/**
 * `IE_ART_TIER=full|half`: a build for ONE kind of screen (`docs/design/arcade-4k-builds.md`
 * "One-screen builds"). The game build compiles the tier in as `__IE_ART_TIER__`, which
 * `apps/lines` `chooseArtTier` obeys over its own screen rule and `?tier=`, and the asset pull
 * (`apps/launcher-api/scripts/pull-project-assets.mjs`) leaves the other tier's files out. One
 * variable for both, so the art a build ships and the tier it loads cannot disagree.
 *
 * Read by Node scripts outside any package's dependencies, so this file imports nothing.
 */

/** Mirrors `engine-layout` `RESOLUTION_TIERS` plus `full`; `artTierPin.fixture.ts` (launcher-api)
 *  fails if they drift. */
export const PINNABLE_TIERS = ['full', 'half'];

/** The pinned tier, `null` when unset. Throws on anything else, so a typo cannot quietly ship both
 *  tiers, or a game that loads a tier its build left out. */
export function parseArtTierPin(value) {
	const v = String(value ?? '').trim();
	if (!v) return null;
	if (!PINNABLE_TIERS.includes(v))
		throw new Error(`IE_ART_TIER must be one of ${PINNABLE_TIERS.join(', ')} (got "${v}").`);
	return v;
}

/** `__IE_ART_TIER__`: the pinned tier, or `''` for a build that picks per screen. */
export const artTierDefine = () => ({
	__IE_ART_TIER__: JSON.stringify(parseArtTierPin(process.env.IE_ART_TIER) ?? ''),
});
