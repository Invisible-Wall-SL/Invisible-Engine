/**
 * The Game Config's `models` block as the Invisible Model Viewer edits it: the project's settings
 * per model class, the layer between a model's own `model.json` overrides and the code defaults
 * (`docs/design/3d/assets-evaluation.md` §5.3).
 *
 * Pure. The block is saved inside the whole Game Config (`PUT /api/game-config`), so
 * {@link withModelsBlock} swaps that one key and leaves the rest of the doc as it was loaded.
 * {@link inheritedFromBlock} is what a class inherits under a block; `check:model-viewer` holds it
 * equal to the export's `resolveModelProfile` / `resolveLodScreenSize`, so the page can show a
 * block that is not saved yet as the export would read it.
 */
import {
	MODEL_CLASSES,
	MODEL_CLASS_DEFAULTS,
	type ModelClass,
	type ModelLodScreenSize,
} from 'constants-shared/modelTiers';
import type { GameConfigModels } from '$lib/server/modelConfig';
import {
	canonicalOverrides,
	effectiveProfile,
	type InheritedModelSettings,
	type TierOverrides,
} from './modelProfile';

/** What a block sets for one class; a part is `undefined` while the class inherits it. */
export interface ClassDefaults {
	tiers: TierOverrides | undefined;
	lodScreenSize: ModelLodScreenSize | undefined;
}

export const classDefaultsOf = (
	block: GameConfigModels | undefined,
	cls: ModelClass,
): ClassDefaults => ({
	tiers: block?.profiles?.[cls],
	lodScreenSize: block?.lodScreenSize?.[cls],
});

/**
 * `block` in one key order (classes as `MODEL_CLASSES`, tiers and maps as `canonicalOverrides`),
 * with every empty part dropped, or `undefined` when it sets nothing: two equal blocks read the
 * same however they were edited, so the page can tell "changed" by comparing them.
 */
export function canonicalModelsBlock(
	block: GameConfigModels | undefined,
): GameConfigModels | undefined {
	const profiles: NonNullable<GameConfigModels['profiles']> = {};
	const lodScreenSize: NonNullable<GameConfigModels['lodScreenSize']> = {};
	for (const cls of MODEL_CLASSES) {
		const tiers = canonicalOverrides(block?.profiles?.[cls]);
		if (tiers) profiles[cls] = tiers;
		const size = block?.lodScreenSize?.[cls];
		// A block with no levels is what the export ignores (`modelConfig.ts` `normalizeScreenSize`):
		// a clip library has no LOD, so the page must not show one either.
		if (size?.levels.length)
			lodScreenSize[cls] = {
				levels: [...size.levels],
				...(size.ultra === undefined ? {} : { ultra: size.ultra }),
				cullBelow: size.cullBelow,
			};
	}
	const out: GameConfigModels = {
		...(Object.keys(profiles).length ? { profiles } : {}),
		...(Object.keys(lodScreenSize).length ? { lodScreenSize } : {}),
	};
	return Object.keys(out).length ? out : undefined;
}

/** Set a class's tier overrides; `undefined` goes back to the code defaults. */
export function setClassTiers(
	block: GameConfigModels | undefined,
	cls: ModelClass,
	tiers: TierOverrides | undefined,
): GameConfigModels | undefined {
	return canonicalModelsBlock({ ...block, profiles: { ...block?.profiles, [cls]: tiers } });
}

/** Set a class's LOD screen sizes; `undefined` goes back to the code defaults. */
export function setClassScreenSize(
	block: GameConfigModels | undefined,
	cls: ModelClass,
	size: ModelLodScreenSize | undefined,
): GameConfigModels | undefined {
	return canonicalModelsBlock({
		...block,
		lodScreenSize: { ...block?.lodScreenSize, [cls]: size },
	});
}

const sameValue = (a: unknown, b: unknown): boolean =>
	JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * An author's unsaved block carried onto someone else's newer one. `base` is the stored block the
 * author started from, `mine` their draft, `theirs` what the store holds now. What the author
 * changed stays (a class's tiers and its screen sizes are told apart), and everything they left
 * alone becomes theirs, so saving it does not undo another author's change to another class.
 */
export function rebaseModelsBlock(
	base: GameConfigModels | undefined,
	mine: GameConfigModels | undefined,
	theirs: GameConfigModels | undefined,
): GameConfigModels | undefined {
	let out = canonicalModelsBlock(theirs);
	for (const cls of MODEL_CLASSES) {
		const was = classDefaultsOf(canonicalModelsBlock(base), cls);
		const now = classDefaultsOf(canonicalModelsBlock(mine), cls);
		if (!sameValue(now.tiers, was.tiers)) out = setClassTiers(out, cls, now.tiers);
		if (!sameValue(now.lodScreenSize, was.lodScreenSize))
			out = setClassScreenSize(out, cls, now.lodScreenSize);
	}
	return out;
}

/** The `models` block of a Game Config doc as it was loaded, in canonical form. */
export const modelsBlockOf = (doc: object): GameConfigModels | undefined =>
	canonicalModelsBlock((doc as { models?: GameConfigModels }).models);

/**
 * `doc` with its `models` key set to `block`, or without the key when the block sets nothing.
 * Every other key is the loaded doc's own, untouched: the Game Config is saved whole, and this
 * tool edits that one block of it.
 */
export function withModelsBlock<T extends object>(doc: T, block: GameConfigModels | undefined): T {
	const out = { ...doc } as T & { models?: GameConfigModels };
	const canonical = canonicalModelsBlock(block);
	if (canonical) out.models = canonical;
	else delete out.models;
	return out;
}

/** What a class inherits under `block`: its entry over the code defaults. */
export function inheritedFromBlock(
	cls: ModelClass,
	block: GameConfigModels | undefined,
): InheritedModelSettings {
	const own = classDefaultsOf(block, cls);
	return {
		tiers: effectiveProfile(MODEL_CLASS_DEFAULTS[cls].tiers, own.tiers),
		lodScreenSize: own.lodScreenSize ?? MODEL_CLASS_DEFAULTS[cls].lodScreenSize,
	};
}

/** {@link inheritedFromBlock} for every class: what every model is shown against. */
export function inheritedLayers(
	block: GameConfigModels | undefined,
): Record<ModelClass, InheritedModelSettings> {
	const out = {} as Record<ModelClass, InheritedModelSettings>;
	for (const cls of MODEL_CLASSES) out[cls] = inheritedFromBlock(cls, block);
	return out;
}
