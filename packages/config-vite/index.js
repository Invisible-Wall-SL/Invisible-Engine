// Don't convert this to a ts file, because of this https://github.com/vitejs/vite/issues/5370
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sveltekit } from '@sveltejs/kit/vite';
import { lingui } from '@lingui/vite-plugin';
import { defineConfig } from 'vite';
// The profile SHAPE check lives in its own dependency-free module so a fixture can drive it —
// see the note there. Importing this file instead would run sveltekit()/lingui() first.
import { deliveryProfileProblems } from './deliveryProfile.js';
import { sentryDebugIds } from './debugIds.js';
import { OPTIONAL_FAMILIES, buildFamilies, familySeams } from './families.js';
import { lazyChunks } from './lazyChunks.js';
import { eagerPixiBoot, noWebGpuRenderer } from './pixiRenderers.js';
import { buildProvenance } from './provenance.js';
import { assertSvelteVersions } from './svelteVersions.js';

const KTX_TRANSCODER_RE = /[\\/]libktx\.(js|wasm)$/;
/** Salmons' built-in art (`engine-layout` `salmonsArt/sheets/`): fetched only by a Salmons room. */
const SALMONS_ART_RE = /[\\/]salmonsArt[\\/]sheets[\\/][^\\/]+\.webp$/;

const NODE_ENV = process.env.NODE_ENV;
let dev = NODE_ENV === 'development';

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

/** On during dev and for a debug publish; a static `false` otherwise, so the Invisible Debug
 * framework + its tools tree-shake out of a player build entirely. */
const debugBuild = () => dev || process.env.PUBLIC_IE_DEBUG === '1';

/** The commit a build was cut from — the identity an error report names as its `release`. The
 * runtime release passes it explicitly (`PUBLIC_BUILD_SHA: github.sha`). */
const buildSha = () => process.env.PUBLIC_BUILD_SHA || '';

/**
 * The Invisible Debug switch + the build stamp (`docs/design/invisible-debug-framework.md`).
 * `GameVersion.svelte` reads `__IE_BUILD__` to print which build is on screen, and the desktop
 * launcher passes the SAME version/time it registers to the portal so the stamp and the Games
 * card can be compared at a glance.
 *
 * It belongs in the shared base for the reason the delivery profile does: anything an app has to
 * opt into by hand is something a build can be cut without — and one was. `scripts/new-game.mjs`
 * wrote a scaffolded game a `vite.config.js` that declared `__IE_DEBUG__` but not `__IE_BUILD__`,
 * a copy of `apps/lines`'s config that drifted the moment the stamp was added. `GameVersion`
 * guards with `typeof`, so it did not crash — every desktop-built game just quietly showed a blank
 * build stamp. Declared here, a game repo gets it by existing.
 *
 * An app that sets its own still wins: `mergeConfig(base, overrides)` gives `define` to the
 * overrides, so `apps/lines`'s mode-accurate version stays authoritative for the monorepo apps.
 */
const gameBuildDefine = () => ({
	__IE_DEBUG__: JSON.stringify(debugBuild()),
	__IE_BUILD__: JSON.stringify(buildStamp(debugBuild())),
});

/**
 * The `__IE_BUILD__` value: the stamp plus where the build came from (`provenance.js`). Exported so
 * an app that sets its own `define` (`apps/lines`, for its mode-accurate `debug`) carries the same
 * fields rather than a copy of them.
 */
export const buildStamp = (debug) => ({
	...buildProvenance(),
	sha: buildSha(),
	debug,
});

/**
 * `IE_SOURCEMAPS=hidden` (the runtime release) writes source maps WITHOUT a `sourceMappingURL`
 * comment, and gives every chunk a debug ID (`debugIds.js`), for `scripts/sentry-sourcemaps.mjs`
 * to upload to Sentry and then delete. The repo and the bundle are public, so a map must never ship
 * next to the code; unset keeps a production build map-less.
 */
const sourcemap = () => (dev ? true : process.env.IE_SOURCEMAPS === 'hidden' ? 'hidden' : false);

/**
 * The family set (`families.js`, `docs/design/phase-11.md` §2.2, §2.4): `PUBLIC_IE_FAMILIES`, else
 * the baked config's family, picks which of match-3, arcade and card this build carries, and
 * `__IE_FAMILIES__` tells the boot, which refuses a config of a family the bundle lacks. Here, not
 * in `apps/lines`, so a game repo gets the same.
 */
const families = () => {
	const { list, warning } = buildFamilies({ dev });
	if (warning) console.warn(`[config-vite] ${warning}`);
	if (list.length <= OPTIONAL_FAMILIES.length)
		console.info(`[config-vite] compiling families: ${list.join(', ')}`);
	return { plugin: familySeams(list), define: { __IE_FAMILIES__: JSON.stringify(list) } };
};

/**
 * Class syntax a game build keeps as written. Vite's default target (`safari14`, `chrome87`) made
 * esbuild LOWER every `#private` class field — Svelte's runtime is built on them — to a WeakMap per
 * field, so each effect and branch Svelte creates paid a WeakMap write and every read a brand check,
 * and the entries fed the collector: on `overlay-buffaloduel`'s Hold and Win bonus (CPU slowed 4×)
 * its worst frames were single 1–3 s collections in the middle of a mount. esbuild lowers a class
 * whole or not at all, so the field features are listed together. Only these, not an `es2022`
 * target: Terser minifying the es2022 output kept a text's stale width after its string changed
 * (the HUD clock moved the game name on some screens: the current-games harness caught it), and
 * static blocks need Safari 16.4. Every browser the runtime runs on has the rest: every game calls
 * `Array.prototype.at` unpolyfilled at boot (the mode stack), which is newer than all of them.
 */
const NATIVE_CLASSES = Object.fromEntries(
	[
		'class-field',
		'class-static-field',
		'class-private-field',
		'class-private-method',
		'class-private-accessor',
		'class-private-static-field',
		'class-private-static-method',
		'class-private-static-accessor',
		'class-private-brand-check',
	].map((feature) => [feature, true]),
);

/**
 * Terser, not esbuild, minifies the client bundle: ~35 KB gz less on the slot runtime for ~25 s
 * more per build. Its defaults make only safe transforms, and its mangling renames locals as
 * esbuild's did, so nothing that relied on a name survived either. The SSR pass (which prerenders
 * `index.html`) stays unminified, as it was: `build.minify` set in the config would reach it too,
 * and SvelteKit hands the config's `minify` on to its client pass.
 */
const terserClient = () => ({
	name: 'ie-terser-client',
	apply: 'build',
	// After sveltekit(), whose own config hook is what marks its first pass `build.ssr`.
	enforce: 'post',
	config: (config) =>
		config.build?.ssr || config.build?.minify !== undefined
			? undefined
			: { build: { minify: 'terser', terserOptions: { compress: { passes: 2 } } } },
});

/**
 * Every game build passes through this factory — the engine's apps and every standalone game repo's
 * `vite.config.js` alike — so it is where a game repo whose Svelte pins drifted from the engine's is
 * stopped, before anything compiles (`svelteVersions.js`).
 */
export default () => {
	assertSvelteVersions();
	const familySet = families();
	return defineConfig({
		plugins: [
			familySet.plugin,
			noWebGpuRenderer(),
			eagerPixiBoot(),
			terserClient(),
			sveltekit(),
			lingui(),
			lazyChunks(),
			sentryDebugIds({ enabled: sourcemap() === 'hidden' }),
		],
		logLevel: 'info',
		define: {
			...gameBuildDefine(),
			...deliveryProfileDefine(),
			...deliveryProfilesDefine(),
			...familySet.define,
		},
		// Dev SSR externalizes workspace packages without a svelte dependency and hands them to Node,
		// whose ESM loader cannot resolve their extensionless TS re-exports (`./src/scrub`).
		ssr: { noExternal: ['error-tracking'] },
		esbuild: { supported: NATIVE_CLASSES },
		// Inline every build-time asset into the bundle EXCEPT the KTX2 transcoder
		// (`libktx.{js,wasm}`, ~520 KB gz, imported by `pixi-svelte` via `?url`): only a phone on the
		// compressed tier ever fetches it, so it ships as a real `_app/immutable/assets/` file instead
		// of a base64 copy every desktop downloads. The bundle is an ES module, so its URL is
		// `new URL(…, import.meta.url)`: beside the bundle, wherever the build is served from.
		// `pixi-svelte/ktx2Transcoder.ts` fetches it on the first `.ktx2` load. Salmons' built-in art
		// likewise: only a Salmons room fetches it (`engine-layout/salmons-art`).
		build: {
			assetsInlineLimit: (file) => !KTX_TRANSCODER_RE.test(file) && !SALMONS_ART_RE.test(file),
			sourcemap: sourcemap(),
			output: {
				sourcemap: sourcemap(),
			},
		},
	});
};
