/**
 * `IE_ART_TIER=<tier>`: a build for ONE kind of screen (`docs/design/arcade-4k-builds.md` "One-screen
 * builds", `docs/design/3d/runtime-evaluation.md` §5.1). The game build compiles the tier in, which
 * the runtime obeys over its own screen rule and `?tier=`, and the asset pull
 * (`apps/launcher-api/scripts/pull-project-assets.mjs`) leaves the other tiers' files out. One
 * variable for both, so the art a build ships and the tier it loads cannot disagree.
 *
 * Two tier lists. 2D art has `full` and `half` (`engine-layout` `RESOLUTION_TIERS` plus `full`);
 * 3D models have `ultra`, `full`, `half`, `quarter` (`constants-shared/modelTiers.ts`
 * `MODEL_TIERS`). `quarter` and `ultra` are accepted only by a 3D build (`PUBLIC_IE_3D=1`), and
 * never reach 2D code: `__IE_ART_TIER__` (read by `apps/lines` `chooseArtTier`) gets the 2D tier
 * they stand for (`quarter` → `half`, `ultra` → `full`), `__IE_MODEL_TIER__` (read by `engine-3d`)
 * the pin itself. A pin still moves the HUD's art and the models together.
 *
 * Read by Node scripts outside any package's dependencies, so this file imports nothing.
 */

/** 2D art tiers: `engine-layout` `RESOLUTION_TIERS` plus `full`; `check-art-tier-pin.mjs` fails if
 *  they drift. */
export const PINNABLE_TIERS_2D = ['full', 'half'];

/** Every tier a build may pin: `constants-shared` `MODEL_TIERS`, best first; `check:engine-3d`
 *  fails if they drift. */
export const PINNABLE_TIERS = ['ultra', 'full', 'half', 'quarter'];

const TIER_2D = { ultra: 'full', full: 'full', half: 'half', quarter: 'half' };

/** The 2D art tier a pin stands for, `null` for none. */
export const artTierOf2d = (pin) => (pin ? TIER_2D[pin] : null);

/** The pinned tier, `null` when unset. Throws on anything else, so a typo cannot quietly ship every
 *  tier, or a game load a tier its build left out; a 3D-only tier throws in a 2D build. */
export function parseArtTierPin(value, { view3d = false } = {}) {
	const v = String(value ?? '').trim();
	if (!v) return null;
	if (!PINNABLE_TIERS.includes(v))
		throw new Error(`IE_ART_TIER must be one of ${PINNABLE_TIERS.join(', ')} (got "${v}").`);
	if (!view3d && !PINNABLE_TIERS_2D.includes(v))
		throw new Error(
			`IE_ART_TIER=${v} is a 3D model tier: only a 3D build (PUBLIC_IE_3D=1) takes it; a 2D build pins ${PINNABLE_TIERS_2D.join(' or ')}.`,
		);
	return v;
}

/** `__IE_ART_TIER__` (the 2D tier) and `__IE_MODEL_TIER__` (the pin): `''` for a build that
 *  picks per screen. */
export const artTierDefine = ({ view3d = false } = {}) => {
	const pin = parseArtTierPin(process.env.IE_ART_TIER, { view3d });
	return {
		__IE_ART_TIER__: JSON.stringify(artTierOf2d(pin) ?? ''),
		__IE_MODEL_TIER__: JSON.stringify(pin ?? ''),
	};
};
