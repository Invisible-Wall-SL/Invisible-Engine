/**
 * A build pinned to ONE art tier (`docs/design/arcade-4k-builds.md` "One-screen builds").
 *
 * A project that publishes resolution tiers ships every page twice: the full copy and its `@half`
 * copy. A build made for one kind of screen (a 4K cabinet, a phone-only delivery) only ever loads
 * one of them, so `IE_ART_TIER=full|half` pins it: the game is compiled to load that tier
 * (`__IE_ART_TIER__`, `config-vite` `artTierPin.js`), and the asset pull drops the other tier's files.
 *
 * Tier files are named by inserting `@<tier>` into the full file's name (`_pages/<hash>@half.webp`,
 * `<sheet>@half.json`, `<rig>@half.atlas`, …), so the pair is read off the names alone. A file that
 * a KEPT descriptor still names is never dropped — a rig's half atlas, for one, keeps any page that
 * had no half copy — so the drop can only remove bytes nothing left in the build loads.
 */

// By relative path: inside a game repo the engine submodule's node_modules is never installed.
import { PINNABLE_TIERS } from '../../../../packages/config-vite/artTierPin.js';

export { parseArtTierPin } from '../../../../packages/config-vite/artTierPin.js';

const TIER_MARK = new RegExp(`@(${PINNABLE_TIERS.filter((t) => t !== 'full').join('|')})(?=[.])`);

/** The full file a tier file copies (`a/b@half.webp` → `a/b.webp`), or `null` for a full file. */
export function fullSiblingOf(rel) {
	const slash = rel.lastIndexOf('/') + 1;
	const name = rel.slice(slash);
	const m = TIER_MARK.exec(name);
	return m ? { tier: m[1], full: rel.slice(0, slash) + name.replace(TIER_MARK, '') } : null;
}

const baseName = (rel) => rel.slice(rel.lastIndexOf('/') + 1);

/** Text files a loaded file is reached through: a sheet names its page, an atlas its pages. An
 *  export's `index.json` is not one: it lists every tier, and the game never loads it (the bake
 *  embeds the index in the bundle), so counting it would keep every file. */
export const isDescriptor = (rel) => /\.(json|atlas)$/i.test(rel) && baseName(rel) !== 'index.json';

/**
 * Which of `rels` a build pinned to `tier` does not load.
 *
 * - `full`: every tier copy.
 * - `half`: every full file that has a half copy beside it.
 *
 * `textOf(rel)` reads a descriptor; a dropped name that a kept descriptor contains is kept instead
 * (and reported), whatever the names said.
 */
export async function artTierDrop(rels, tier, textOf) {
	const present = new Set(rels);
	const drop = new Set();
	for (const rel of rels) {
		const pair = fullSiblingOf(rel);
		if (!pair) continue;
		if (tier === 'full') drop.add(rel);
		else if (pair.tier === tier && present.has(pair.full)) drop.add(pair.full);
	}
	const keptDescriptors = rels.filter((rel) => isDescriptor(rel) && !drop.has(rel));
	const named = [];
	const texts = await Promise.all(keptDescriptors.map(async (rel) => [rel, await textOf(rel)]));
	for (const rel of [...drop]) {
		const name = baseName(rel);
		const by = texts.find(([, text]) => text.includes(name));
		if (by) {
			drop.delete(rel);
			named.push({ rel, by: by[0] });
		}
	}
	return { drop: [...drop].sort(), named };
}
