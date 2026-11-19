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
import {
	artTierOf2d,
	parseArtTierPin as parsePin,
	PINNABLE_TIERS,
	PINNABLE_TIERS_2D,
} from '../../../../packages/config-vite/artTierPin.js';

/** The pull takes every tier a build may pin; a 3D-only one is refused by a 2D game's own build. */
export const parseArtTierPin = (value) => parsePin(value, { view3d: true });

const tierMark = (tiers) => new RegExp(`@(${tiers.filter((t) => t !== 'full').join('|')})(?=[.])`);
const TIER_MARK = tierMark(PINNABLE_TIERS_2D);
/** The 3D models' copies (`modelExport.ts`): `@ultra`, `@half`, `@quarter`, under `models/` only. */
const MODEL_TIER_MARK = tierMark(PINNABLE_TIERS);
const MODELS = 'models/';
const MODEL_TEXTURES = 'models/_tex/';

/** The full file a tier file copies (`a/b@half.webp` → `a/b.webp`), or `null` for a full file. A
 *  model file under `models/` may carry any model tier; any other file only a 2D one. */
export function fullSiblingOf(rel) {
	const mark = rel.startsWith(MODELS) ? MODEL_TIER_MARK : TIER_MARK;
	const slash = rel.lastIndexOf('/') + 1;
	const name = rel.slice(slash);
	const m = mark.exec(name);
	return m ? { tier: m[1], full: rel.slice(0, slash) + name.replace(mark, '') } : null;
}

const baseName = (rel) => rel.slice(rel.lastIndexOf('/') + 1);

/** Files a loaded file is reached through: a sheet names its page, an atlas its pages, a model GLB
 *  its textures (its JSON chunk is plain text inside the binary, so reading the file as text finds
 *  the names). An export's `index.json` is not one: it lists every tier, and the game never loads it
 *  (the bake embeds the index in the bundle), so counting it would keep every file. */
export const isDescriptor = (rel) =>
	/\.(json|atlas|glb)$/i.test(rel) && baseName(rel) !== 'index.json';

/**
 * Which of `rels` a build pinned to `pin` does not load.
 *
 * 2D art, by the 2D tier the pin stands for (`artTierOf2d`):
 * - `full`: every tier copy.
 * - `half`: every full file that has a half copy beside it.
 *
 * 3D models (`models/`), by the pin itself:
 * - `full`: every tier copy;
 * - any other tier X: every copy of a tier other than X, and every full file that has an X copy
 *   (a full file with no X copy is X's fallback, and stays);
 * - a model texture (`models/_tex/`) only when a kept GLB names it, never as a fallback on its own:
 *   a `quarter` GLB drops the normal map, so the full-tier normal map must not ride along.
 *
 * `textOf(rel)` reads a descriptor; a dropped name that a kept descriptor contains is kept instead
 * (and reported), whatever the names said.
 */
export async function artTierDrop(rels, pin, textOf) {
	// The 2D art a 3D pin stands for (`quarter` → `half`, `ultra` → `full`); model files are not 2D art.
	const tier = artTierOf2d(pin);
	const present = new Set(rels);
	const drop = new Set();
	for (const rel of rels) {
		const pair = fullSiblingOf(rel);
		if (rel.startsWith(MODELS)) {
			if (!pin) continue;
			if (!pair) {
				if (pin !== 'full' && rel.startsWith(MODEL_TEXTURES)) drop.add(rel);
			} else if (pair.tier !== pin) drop.add(rel);
			else if (present.has(pair.full)) drop.add(pair.full);
			continue;
		}
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
