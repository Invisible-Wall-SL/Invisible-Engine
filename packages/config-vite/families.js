// The game families a runtime build carries (`docs/design/phase-11.md` §2.2). Dependency-free, like
// `deliveryProfile.js`, so a fixture can drive it without starting sveltekit()/lingui().
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

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
