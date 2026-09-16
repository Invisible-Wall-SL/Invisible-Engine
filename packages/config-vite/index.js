// Don't convert this to a ts file, because of this https://github.com/vitejs/vite/issues/5370
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sveltekit } from '@sveltejs/kit/vite';
import { lingui } from '@lingui/vite-plugin';
import { defineConfig } from 'vite';

const NODE_ENV = process.env.NODE_ENV;
let dev = NODE_ENV === 'development';

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

const deliveryProfileDefine = () => {
	const name = process.env.PUBLIC_DELIVERY_PROFILE;
	if (!name) return {};

	const looksLikePath = /[\\/]/.test(name) || name.endsWith('.json');
	const file = looksLikePath
		? resolve(process.cwd(), name)
		: fileURLToPath(new URL(`../delivery-profile/profiles/${name}.json`, import.meta.url));

	let raw;
	try {
		raw = readFileSync(file, 'utf8');
	} catch {
		throw new Error(
			`PUBLIC_DELIVERY_PROFILE='${name}': no profile found at ${file}. ` +
				`Add one under packages/delivery-profile/profiles/, or pass a path to a JSON file.`,
		);
	}

	let profile;
	try {
		profile = JSON.parse(raw);
	} catch (error) {
		throw new Error(
			`PUBLIC_DELIVERY_PROFILE='${name}': ${file} is not valid JSON — ${error.message}`,
		);
	}

	const problems = deliveryProfileProblems(profile);
	if (problems.length) {
		throw new Error(
			`PUBLIC_DELIVERY_PROFILE='${name}': ${file} is not a usable delivery profile —\n` +
				problems.map((p) => `  - ${p}`).join('\n'),
		);
	}

	console.info(`[config-vite] baking delivery profile '${name}' from ${file}`);
	return { __IE_DELIVERY_PROFILE__: JSON.stringify(profile) };
};

export default () =>
	defineConfig({
		plugins: [sveltekit(), lingui()],
		logLevel: 'info',
		define: deliveryProfileDefine(),
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
