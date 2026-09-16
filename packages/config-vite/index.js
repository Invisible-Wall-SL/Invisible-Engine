// Don't convert this to a ts file, because of this https://github.com/vitejs/vite/issues/5370
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sveltekit } from '@sveltejs/kit/vite';
import { lingui } from '@lingui/vite-plugin';
import { defineConfig } from 'vite';

const NODE_ENV = process.env.NODE_ENV;
let dev = NODE_ENV === 'development';

/**
 * SHAPE check on a baked profile, run at build time so a broken one FAILS THE BUILD.
 *
 * Deliberately not the runtime merge (`mergeDeliveryProfile`), and not a duplicate of it: that one
 * is the semantic authority and is built to DEGRADE, because it also parses an operator's
 * `config.json` on a live site where a typo must not black-screen the game. Here the opposite is
 * right — nothing is running yet, and a profile that merged down to internal defaults would ship a
 * delivery pointing at no RGS at all. So: the structural mistakes a person actually makes
 * (typo'd key, wrong type, missing the two fields a delivery cannot work without), and nothing more.
 */
const deliveryProfileProblems = (profile) => {
	const KNOWN = {
		'': ['id', 'rgs', 'session'],
		rgs: ['baseUrl', 'endpoint', 'withCredentials', 'simpleRequest', 'allowUrlOverride'],
		session: ['param', 'required'],
	};
	const problems = [];
	const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

	if (!isObject(profile)) return ['the file must contain a JSON object'];

	for (const [section, keys] of Object.entries(KNOWN)) {
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

	// The two a delivery is useless without: where the RGS is, and how the host page names the token.
	const baseUrl = isObject(profile.rgs) ? profile.rgs.baseUrl : undefined;
	if (typeof baseUrl !== 'string' || baseUrl.trim() === '') {
		problems.push('rgs.baseUrl must be a non-empty string (the partner RGS host)');
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

const PROFILES_DIR = fileURLToPath(new URL('../delivery-profile/profiles/', import.meta.url));

/** Read + parse + shape-check one profile, throwing with the env var that asked for it. */
const loadProfile = (name, envVar) => {
	const looksLikePath = /[\\/]/.test(name) || name.endsWith('.json');
	const file = looksLikePath ? resolve(process.cwd(), name) : resolve(PROFILES_DIR, `${name}.json`);

	let raw;
	try {
		raw = readFileSync(file, 'utf8');
	} catch {
		throw new Error(
			`${envVar}='${name}': no profile found at ${file}. ` +
				`Add one under packages/delivery-profile/profiles/, or pass a path to a JSON file.`,
		);
	}

	let profile;
	try {
		profile = JSON.parse(raw);
	} catch (error) {
		throw new Error(`${envVar}='${name}': ${file} is not valid JSON — ${error.message}`);
	}

	const problems = deliveryProfileProblems(profile);
	if (problems.length) {
		throw new Error(
			`${envVar}='${name}': ${file} is not a usable delivery profile —\n` +
				problems.map((p) => `  - ${p}`).join('\n'),
		);
	}

	return { file, profile };
};

/**
 * Bake a DELIVERY PROFILE into the bundle (`packages/delivery-profile`). Set
 * `PUBLIC_DELIVERY_PROFILE` to either a name in `packages/delivery-profile/profiles/` or a path to
 * a JSON file — the latter so a game living in its own repo can keep a partner-specific profile
 * next to the game rather than in the engine.
 *
 * It lives HERE, not in an app's own vite config, because a shipped game is its own repo with the
 * engine as a submodule: anything an app has to opt into by hand is something a delivery build can
 * be cut without.
 *
 * Unset (every internal build) injects nothing, leaving `__IE_DELIVERY_PROFILE__` undeclared and
 * the runtime on `DEFAULT_DELIVERY_PROFILE` — the pre-profile behaviour, unchanged.
 *
 * A named-but-unreadable profile THROWS rather than falling back: a delivery build that silently
 * shipped internal defaults would point a client's players at no RGS at all.
 */
const deliveryProfileDefine = () => {
	const name = process.env.PUBLIC_DELIVERY_PROFILE;
	if (!name) return {};
	const { file, profile } = loadProfile(name, 'PUBLIC_DELIVERY_PROFILE');
	console.info(`[config-vite] baking delivery profile '${name}' from ${file}`);
	return { __IE_DELIVERY_PROFILE__: JSON.stringify(profile) };
};

/**
 * Compile a REGISTRY of profiles the launch URL may choose between (`?rgs_profile=<id>`).
 *
 * This is the shared-runtime case, and it is the opposite shape from the single bake above. A
 * DELIVERED build is pinned to one RGS and must not be repointable; the shared `_runtime/*` bundle
 * is the one artifact that has to reach several — our own test server for development, a partner's
 * RGS for the real thing — without a rebuild per target. Compiling a fixed set and selecting by id
 * keeps that switch a WHITELIST: the URL picks among hosts we shipped, it can never name one.
 *
 * `PUBLIC_DELIVERY_PROFILES` is a comma-separated list of names, or `*` for every profile in
 * `packages/delivery-profile/profiles/`. Unset injects nothing, so a build that does not opt in has
 * no registry and `?rgs_profile=` does nothing — the pre-existing behaviour.
 *
 * `internal` is always available without being listed: it is the built-in default (our RGS via
 * `?rgs_url=`), and naming it explicitly is how a launch URL asks for development mode.
 */
const deliveryProfilesDefine = () => {
	const list = process.env.PUBLIC_DELIVERY_PROFILES;
	if (!list) return {};

	const names =
		list.trim() === '*'
			? readdirSync(PROFILES_DIR)
					.filter((f) => f.endsWith('.json'))
					.map((f) => f.slice(0, -'.json'.length))
			: list
					.split(',')
					.map((n) => n.trim())
					.filter(Boolean);

	const registry = {};
	for (const name of names) {
		if (name === 'internal') {
			throw new Error(
				`PUBLIC_DELIVERY_PROFILES: 'internal' is reserved for the built-in default (our RGS) ` +
					`and is always selectable — remove it from the list.`,
			);
		}
		registry[name] = loadProfile(name, 'PUBLIC_DELIVERY_PROFILES').profile;
	}

	console.info(
		`[config-vite] compiling selectable delivery profiles: ${['internal', ...names].join(', ')}`,
	);
	return { __IE_DELIVERY_PROFILES__: JSON.stringify(registry) };
};

export default () =>
	defineConfig({
		plugins: [sveltekit(), lingui()],
		logLevel: 'info',
		define: { ...deliveryProfileDefine(), ...deliveryProfilesDefine() },
		// Inline EVERY build-time asset into the bundle (single-file game deploy). This includes
		// the KTX2/libktx transcoder (`pixi-svelte` imports it via `?url`): a standalone game's
		// deploy remaps/omits `_app/immutable/assets/`, so an emitted transcoder file 404s there.
		// Inlined, the transcoder travels IN the bundle regardless of deploy layout;
		// `InitialiseApplication.svelte` converts its `data:` URI to a `blob:` URL at runtime
		// (a Worker's `importScripts()` rejects `data:` but accepts `blob:`).
		build: {
			assetsInlineLimit: Infinity,
			sourcemap: dev ? true : false,
			output: {
				sourcemap: dev ? true : false,
			},
		},
	});
