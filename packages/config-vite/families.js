// The game families a runtime build carries (`docs/design/phase-11.md` §2.2). Dependency-free, like
// `deliveryProfile.js`, so a fixture can drive it without starting sveltekit()/lingui().
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The families a build may leave out. `slot` is not one: every runtime carries the reel stack. */
export const OPTIONAL_FAMILIES = Object.freeze(['match3', 'arcade', 'card']);

/**
 * The families to compile in, from `PUBLIC_IE_FAMILIES`: a comma list of `match3`, `arcade`,
 * `card` (and `slot`, which is implied), or `all`. Unset is `all`, so every build that does not opt
 * in ships what it shipped before the seams. Empty is unset too: a blank CI input or service
 * variable must never strip a release, so a slot-only build names `slot`. An unknown name throws:
 * a typo would otherwise quietly strip a family out of a release.
 */
export const compiledFamilies = (value = process.env.PUBLIC_IE_FAMILIES) => {
	if (!value?.trim()) return ['slot', ...OPTIONAL_FAMILIES];
	const names = value
		.split(',')
		.map((n) => n.trim())
		.filter(Boolean);
	for (const name of names) {
		if (name !== 'all' && name !== 'slot' && !OPTIONAL_FAMILIES.includes(name)) {
			throw new Error(
				`PUBLIC_IE_FAMILIES='${value}': '${name}' is not a family ` +
					`(use ${[...OPTIONAL_FAMILIES, 'slot', 'all'].join(', ')}).`,
			);
		}
	}
	const all = names.includes('all');
	return ['slot', ...OPTIONAL_FAMILIES.filter((f) => all || names.includes(f))];
};

/**
 * The family a config plays as: `game-config`'s `resolveFamily` over its `normalizeFamily`, here
 * because this file imports no package (`families.fixture.mjs` pins the two equal).
 */
export const familyOfConfig = (config) => {
	const family = config?.family;
	return OPTIONAL_FAMILIES.includes(family) ? family : 'slot';
};

const ENGINE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * The baked bundle the build compiles: `src/` of an engine app, or the engine's `apps/lines/src` in
 * a standalone game repo — `config-svelte`'s `appSrcDir()` rule, where `bake:doc` writes it.
 */
export const bakedBundlePath = (cwd = process.cwd()) => {
	const rel = relative(ENGINE_ROOT, cwd);
	const inEngine = rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
	const src = inEngine ? resolve(cwd, 'src') : resolve(ENGINE_ROOT, 'apps/lines/src');
	return join(src, 'baked-editor-bundle.json');
};

/**
 * The families a build carries (`docs/design/phase-11.md` §2.4). `PUBLIC_IE_FAMILIES` when set.
 * Otherwise, in a build, the baked config's family plus slot, so a game repo's build carries only
 * what its game plays. A bundle with no `config` key (the checked-in placeholder, or no bundle) is
 * every family, and says so in `warning`. A dev server never infers: it serves every family.
 */
const readBundle = (bundlePath) => {
	try {
		return JSON.parse(readFileSync(bundlePath, 'utf8'));
	} catch (e) {
		throw new Error(
			`${bundlePath} is not valid JSON (${e.message}); re-run the bake (\`pnpm bake:doc\`).`,
		);
	}
};

export const buildFamilies = ({
	value = process.env.PUBLIC_IE_FAMILIES,
	bundlePath = bakedBundlePath(),
	dev = false,
} = {}) => {
	if (value?.trim() || dev) return { list: compiledFamilies(value), warning: null };
	const bundle = existsSync(bundlePath) ? readBundle(bundlePath) : null;
	if (bundle && typeof bundle === 'object' && Object.hasOwn(bundle, 'config')) {
		const family = familyOfConfig(bundle.config);
		return { list: family === 'slot' ? ['slot'] : ['slot', family], warning: null };
	}
	return {
		list: compiledFamilies(undefined),
		warning:
			`no baked config at ${bundlePath} and PUBLIC_IE_FAMILIES unset: ` +
			'compiling every family (set PUBLIC_IE_FAMILIES, or bake the game first)',
	};
};

const SEAM = /(?:^|\/)families\/(match3|arcade|card)(?:\.ts)?$/;

/**
 * Resolve each left-out family's seam module (`apps/lines/src/families/<family>.ts`) to its inert
 * stub beside it (`families/off/<family>.ts`), so the bundler never sees the family's code.
 *
 * It matches the RESOLVED file, not a fixed path: `apps/lines` compiles `apps/lines/src`, a
 * standalone game repo compiles `engine/apps/lines/src`, and both import the seams by relative
 * path. A seam is only swapped when its stub exists beside it, so a module that merely shares the
 * name is left alone.
 */
export const familySeams = (families) => {
	const off = new Set(OPTIONAL_FAMILIES.filter((f) => !families.includes(f)));
	return {
		name: 'ie-family-seams',
		enforce: 'pre',
		resolveId(source, importer) {
			if (!off.size || !importer || !source.startsWith('.')) return null;
			const match = SEAM.exec(source);
			if (!match || !off.has(match[1])) return null;
			const seam = resolve(dirname(importer.split('?')[0]), source).replace(/\.ts$/, '');
			const stub = join(dirname(seam), 'off', `${match[1]}.ts`);
			return existsSync(`${seam}.ts`) && existsSync(stub) ? stub.replace(/\\/g, '/') : null;
		},
	};
};
