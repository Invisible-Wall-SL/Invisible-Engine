import { type DeliveryProfile } from './types.ts';

export interface DeliveryProfileMerge {
	profile: DeliveryProfile;
	/** Fields that were present but unusable. Logged at boot, never thrown: the losing half of this
	 *  merge is `config.json` on an operator's own server, edited by people who cannot rebuild the
	 *  game. A typo there must degrade to the baked value, not black-screen a live title. */
	warnings: string[];
}

/**
 * Which half of the resolution chain a patch is.
 *
 * `baked` may set anything. `override` — the operator's `config.json` — may REPOINT the build
 * (`rgs.baseUrl`, `rgs.endpoint`, `session.param`, `id`) but may not re-police it: the three fields
 * that decide whether a missing token is fatal, whether the host page can repoint the wallet, and
 * whether calls are credentialed are decisions we make when cutting the delivery, not ones an
 * edited file downstream gets to flip. A staging↔production move needs none of them.
 */
export type DeliveryProfileScope = 'baked' | 'override';

const BAKE_ONLY_FIELDS = [
	'rgs.source',
	'rgs.withCredentials',
	'rgs.allowUrlOverride',
	'session.required',
];

/** Every field a profile may carry, by section. Exported because the BUILD-time validator in
 *  `packages/config-vite` keeps its own copy — see the note there — and `profile.fixture.ts`
 *  asserts the two agree. */
export const DELIVERY_PROFILE_FIELDS: Record<string, string[]> = {
	'': ['id', 'rgs', 'session'],
	rgs: ['source', 'baseUrl', 'endpoint', 'withCredentials', 'simpleRequest', 'allowUrlOverride'],
	session: ['param', 'source', 'required'],
};

/** Characters that must never reach a URL we will fetch: whitespace, backslashes (WHATWG folds them
 *  into path separators, so they hide structure) and C0/DEL controls. */
// eslint-disable-next-line no-control-regex
const UNSAFE_URL_CHARS = /[\s\\]|[\u0000-\u001f\u007f]/;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Validate a base URL by PARSING it rather than pattern-matching it, then return the original
 * spelling. Two forms have to survive — a bare host (`localhost:7788`, `games.example/api/x`, how
 * `?rgs_url=` has always been written) and a full origin — and the transport's `buildBaseUrl` is
 * what picks the scheme, so normalising to `url.origin` here would force `https://localhost`.
 *
 * Rejected, each because it reads as one host to a person and resolves to another (or somewhere
 * else entirely) to the browser:
 *   - `https://our.rgs@evil.example`  — userinfo; the real host is after the `@`
 *   - a query or fragment             — swallows the endpoint path appended to this base
 *   - anything but http/https
 */
const parseBaseUrl = (raw: string): string | null => {
	if (UNSAFE_URL_CHARS.test(raw)) return null;
	// A base names a HOST; a leading slash means someone wrote a path (or the protocol-relative
	// `//host`, which `new URL` would happily fold into a host and accept).
	if (raw.startsWith('/')) return null;
	const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
	let url: URL;
	try {
		url = new URL(candidate);
	} catch {
		return null;
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
	if (url.username || url.password) return null;
	if (url.search || url.hash) return null;
	return raw.replace(/\/+$/, '');
};

const readSection = (
	source: Record<string, unknown>,
	key: string,
	warnings: string[],
): Record<string, unknown> => {
	const value = source[key];
	if (value === undefined) return {};
	if (!isPlainObject(value)) {
		warnings.push(`${key} must be an object — the whole section was ignored`);
		return {};
	}
	return value;
};

/** A key we do not know is almost always a typo (`baseURL`, `sessionParam`), and a silent one is
 *  the likeliest failure for a file edited by someone who cannot rebuild the game. `_`-prefixed
 *  keys are the documented way to leave a note in a profile, so they pass. */
const warnUnknownKeys = (
	source: Record<string, unknown>,
	section: string,
	warnings: string[],
): void => {
	const known = DELIVERY_PROFILE_FIELDS[section] ?? [];
	for (const key of Object.keys(source)) {
		if (key.startsWith('_') || known.includes(key)) continue;
		warnings.push(`unknown field ${section ? `${section}.${key}` : key} — ignored`);
	}
};

const readString = (
	source: Record<string, unknown>,
	key: string,
	path: string,
	warnings: string[],
): string | null => {
	const value = source[key];
	if (value === undefined) return null;
	if (typeof value !== 'string') {
		warnings.push(`${path} must be a string — ignored`);
		return null;
	}
	return value;
};

const readBoolean = (
	source: Record<string, unknown>,
	key: string,
	path: string,
	scope: DeliveryProfileScope,
	warnings: string[],
): boolean | null => {
	const value = source[key];
	if (value === undefined) return null;
	if (scope === 'override' && BAKE_ONLY_FIELDS.includes(path)) {
		warnings.push(`${path} is set when the build is cut and cannot be overridden — ignored`);
		return null;
	}
	if (typeof value !== 'boolean') {
		warnings.push(`${path} must be true or false — ignored`);
		return null;
	}
	return value;
};

/**
 * Merge a partial profile (baked JSON, or an operator's `config.json`) over `base`.
 *
 * Every field is independently optional and independently validated: a delivery that only needs to
 * move to a staging host writes `{"rgs":{"baseUrl":"…"}}` and keeps the rest of its baked profile,
 * and one bad field does not discard the good ones alongside it.
 */
export const mergeDeliveryProfile = (
	base: DeliveryProfile,
	patch: unknown,
	scope: DeliveryProfileScope = 'baked',
): DeliveryProfileMerge => {
	const warnings: string[] = [];
	if (!isPlainObject(patch)) {
		if (patch !== undefined && patch !== null) warnings.push('profile must be an object — ignored');
		return { profile: base, warnings };
	}

	const rgsPatch = readSection(patch, 'rgs', warnings);
	const sessionPatch = readSection(patch, 'session', warnings);
	warnUnknownKeys(patch, '', warnings);
	warnUnknownKeys(rgsPatch, 'rgs', warnings);
	warnUnknownKeys(sessionPatch, 'session', warnings);

	const id = readString(patch, 'id', 'id', warnings)?.trim() ?? null;

	// `baseUrl` is the one field where an explicit empty string is meaningful ("the RGS serves this
	// page"), so it is tested UNTRIMMED: a whitespace-only value is a typo, not that declaration.
	let baseUrl = base.rgs.baseUrl;
	const baseUrlPatch = readString(rgsPatch, 'baseUrl', 'rgs.baseUrl', warnings);
	if (baseUrlPatch !== null) {
		if (baseUrlPatch === '') {
			baseUrl = '';
		} else {
			const parsed = parseBaseUrl(baseUrlPatch.trim());
			if (parsed === null || parsed === '') {
				warnings.push(
					`rgs.baseUrl ${JSON.stringify(baseUrlPatch)} is not a plain http(s) host — ignored`,
				);
			} else {
				baseUrl = parsed;
			}
		}
	}

	// Bake-only, like the three booleans below it and for the same reason: it decides WHERE the
	// wallet call goes. An operator's `config.json` may repoint a build between their own hosts; it
	// may not change the build from "the RGS we shipped you" to "whatever your page says".
	let rgsSource = base.rgs.source;
	const rgsSourcePatch = readString(rgsPatch, 'source', 'rgs.source', warnings)?.trim() ?? null;
	if (rgsSourcePatch !== null) {
		if (scope === 'override') {
			warnings.push('rgs.source is set when the build is cut and cannot be overridden — ignored');
		} else if (rgsSourcePatch === 'profile' || rgsSourcePatch === 'host') {
			rgsSource = rgsSourcePatch;
		} else {
			warnings.push('rgs.source must be "profile" or "host" — ignored');
		}
	}

	let endpoint = base.rgs.endpoint;
	const endpointPatch = readString(rgsPatch, 'endpoint', 'rgs.endpoint', warnings)?.trim() ?? null;
	if (endpointPatch !== null) {
		if (endpointPatch === '' || UNSAFE_URL_CHARS.test(endpointPatch)) {
			warnings.push(`rgs.endpoint ${JSON.stringify(endpointPatch)} is not a usable path — ignored`);
		} else {
			endpoint = endpointPatch.startsWith('/') ? endpointPatch : `/${endpointPatch}`;
		}
	}

	let sessionSource = base.session.source;
	const sourcePatch =
		readString(sessionPatch, 'source', 'session.source', warnings)?.trim() ?? null;
	if (sourcePatch !== null) {
		if (sourcePatch === 'param' || sourcePatch === 'host') {
			sessionSource = sourcePatch;
		} else {
			warnings.push(`session.source must be "param" or "host" — ignored`);
		}
	}

	let sessionParam = base.session.param;
	const sessionParamPatch =
		readString(sessionPatch, 'param', 'session.param', warnings)?.trim() ?? null;
	if (sessionParamPatch !== null) {
		if (sessionParamPatch === '') {
			warnings.push('session.param must not be empty — ignored');
		} else {
			sessionParam = sessionParamPatch;
		}
	}

	return {
		profile: {
			id: id === null || id === '' ? base.id : id,
			rgs: {
				source: rgsSource,
				baseUrl,
				endpoint,
				withCredentials:
					readBoolean(rgsPatch, 'withCredentials', 'rgs.withCredentials', scope, warnings) ??
					base.rgs.withCredentials,
				simpleRequest:
					readBoolean(rgsPatch, 'simpleRequest', 'rgs.simpleRequest', scope, warnings) ??
					base.rgs.simpleRequest,
				allowUrlOverride:
					readBoolean(rgsPatch, 'allowUrlOverride', 'rgs.allowUrlOverride', scope, warnings) ??
					base.rgs.allowUrlOverride,
			},
			session: {
				param: sessionParam,
				source: sessionSource,
				required:
					readBoolean(sessionPatch, 'required', 'session.required', scope, warnings) ??
					base.session.required,
			},
		},
		warnings,
	};
};
