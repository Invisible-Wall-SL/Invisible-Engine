/**
 * SHAPE check on a baked delivery profile, run at build time so a broken one FAILS THE BUILD.
 *
 * Deliberately not the runtime merge (`mergeDeliveryProfile`), and not a duplicate of it: that one
 * is the semantic authority and is built to DEGRADE, because it also parses an operator's
 * `config.json` on a live site where a typo must not black-screen the game. Here the opposite is
 * right — nothing is running yet, and a profile that merged down to internal defaults would ship a
 * delivery pointing at no RGS at all. So: the structural mistakes a person actually makes (typo'd
 * key, wrong type, missing the fields a delivery cannot work without), and nothing more.
 *
 * IT LIVES IN ITS OWN FILE BECAUSE IT HAS TO BE TESTABLE. In `index.js` it was not, and could not
 * be: that module's factory builds a real vite config, so `sveltekit()` and `lingui()` run — and
 * throw — before this check is ever reached. A fixture driving it through the factory reports
 * whatever those plugins did instead, which is worse than no fixture. That untestability is the
 * direct cause of the `KNOWN` list drifting twice (`rgs.simpleRequest`, then `session.source`),
 * each time shipping a field the runtime understood and the build refused. Dependency-free here,
 * `profile.fixture.ts` imports it and compares the two field lists for real.
 */

/** KEEP IN SYNC with `DELIVERY_PROFILE_FIELDS` in packages/delivery-profile/src/normalize.ts.
 *  The two checks are separate on purpose — this one fails the build, that one degrades at runtime
 *  — but the FIELD LIST is one fact, and `profile.fixture.ts` asserts they agree. */
export const KNOWN_PROFILE_FIELDS = {
	'': ['id', 'rgs', 'session'],
	rgs: ['source', 'baseUrl', 'endpoint', 'withCredentials', 'simpleRequest', 'allowUrlOverride'],
	session: ['param', 'source', 'required'],
};

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

export const deliveryProfileProblems = (profile) => {
	const problems = [];

	if (!isObject(profile)) return ['the file must contain a JSON object'];

	for (const [section, keys] of Object.entries(KNOWN_PROFILE_FIELDS)) {
		const target = section ? profile[section] : profile;
		if (target === undefined) continue;
		if (!isObject(target)) {
			problems.push(`${section} must be an object`);
			continue;
		}
		for (const key of Object.keys(target)) {
			if (key.startsWith('_') || keys.includes(key)) continue;
			problems.push(`unknown field ${section ? `${section}.${key}` : key}`);
		}
	}

	const rgsSource = isObject(profile.rgs) ? profile.rgs.source : undefined;
	if (rgsSource !== undefined && rgsSource !== 'profile' && rgsSource !== 'host') {
		problems.push('rgs.source must be "profile" or "host"');
	}

	// The two a delivery is useless without: where the RGS is, and how the host page names the token.
	//
	// `source: 'host'` is the other way to answer the first one — the operator's page is the RGS's
	// own origin and names the path — so it stands in for a base URL. It has to be an explicit
	// DECLARATION rather than an omission, which is why an empty `baseUrl` alone still fails: a
	// delivery that shipped pointing at no RGS at all is the accident this check exists to stop.
	const baseUrl = isObject(profile.rgs) ? profile.rgs.baseUrl : undefined;
	const hasBaseUrl = typeof baseUrl === 'string' && baseUrl.trim() !== '';
	if (!hasBaseUrl && rgsSource !== 'host') {
		problems.push(
			'rgs.baseUrl must be a non-empty string (the partner RGS host), ' +
				'or rgs.source must be "host" (the operator\'s page is the RGS origin)',
		);
	}

	const param = isObject(profile.session) ? profile.session.param : undefined;
	if (typeof param !== 'string' || param.trim() === '') {
		problems.push('session.param must be a non-empty string (the query param carrying the token)');
	}

	for (const [section, key] of [
		['rgs', 'withCredentials'],
		['rgs', 'simpleRequest'],
		['rgs', 'allowUrlOverride'],
		['session', 'required'],
	]) {
		const value = isObject(profile[section]) ? profile[section][key] : undefined;
		if (value !== undefined && typeof value !== 'boolean') {
			problems.push(`${section}.${key} must be true or false`);
		}
	}

	return problems;
};
