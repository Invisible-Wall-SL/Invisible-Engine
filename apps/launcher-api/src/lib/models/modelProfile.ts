/**
 * A model's settings as the Invisible Model Viewer edits them: the `model.json` overrides laid over
 * what the model inherits (the Game Config `models` block over the code defaults), and where each
 * value comes from. Precedence: `model.json` → Game Config → code default
 * (`docs/design/3d/assets-evaluation.md` §5.3).
 *
 * Pure. The inherited layer is resolved on the server by the export's own `resolveModelProfile`, and
 * {@link effectiveProfile} lays the model's overrides over it the same way; `check:model-viewer`
 * holds the two equal, so what the page shows is what the export derives.
 */
import {
	MODEL_CLASS_DEFAULTS,
	MODEL_LOD_ULTRA,
	MODEL_TIERED_MAPS,
	MODEL_TIERS,
	type ModelClass,
	type ModelLodScreenSize,
	type ModelTextureEncoding,
	type ModelTieredMap,
	type ModelTierId,
	type ModelTierProfile,
} from 'constants-shared/modelTiers';

/** One tier's override in a `model.json`: any part of the profile. */
export interface TierOverride {
	lods?: [number, number];
	maps?: Partial<Record<ModelTieredMap, number | 'drop'>>;
	encoding?: Partial<Record<ModelTieredMap, ModelTextureEncoding>>;
}
export type TierOverrides = Partial<Record<ModelTierId, TierOverride>>;

/** What a class inherits before a model's own overrides: Game Config over the code defaults. */
export interface InheritedModelSettings {
	tiers: Record<ModelTierId, ModelTierProfile>;
	lodScreenSize: ModelLodScreenSize;
}

export type SettingSource = 'model' | 'project' | 'default';

export const SETTING_SOURCE_LABEL: Record<SettingSource, string> = {
	model: 'This model',
	project: 'Game Config',
	default: 'Default',
};

export const MODEL_ENCODINGS: readonly ModelTextureEncoding[] = ['uastc', 'etc1s', 'png'];

/** The map sizes an override may ask for, largest first (`normalizeOverride`: a power of two ≥ 4). */
export const MODEL_MAP_SIZES: readonly number[] = [4096, 2048, 1024, 512, 256, 128, 64];

/** The profile the export derives with: `inherited` with the model's overrides laid over it. */
export function effectiveProfile(
	inherited: Readonly<Record<ModelTierId, ModelTierProfile>>,
	overrides: TierOverrides | undefined,
): Record<ModelTierId, ModelTierProfile> {
	const out = {} as Record<ModelTierId, ModelTierProfile>;
	for (const tier of MODEL_TIERS) {
		const base = inherited[tier];
		const o = overrides?.[tier];
		out[tier] = o
			? {
					...base,
					lods: o.lods ?? base.lods,
					maps: { ...base.maps, ...o.maps },
					encoding: { ...base.encoding, ...o.encoding },
				}
			: base;
	}
	return out;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Where an inherited value comes from: the Game Config when it differs from the code default. */
const inheritedSource = (inherited: unknown, codeDefault: unknown): SettingSource =>
	same(inherited, codeDefault) ? 'default' : 'project';

export function lodsSource(
	cls: ModelClass,
	tier: ModelTierId,
	inherited: InheritedModelSettings,
	overrides: TierOverrides | undefined,
): SettingSource {
	if (overrides?.[tier]?.lods) return 'model';
	return inheritedSource(inherited.tiers[tier].lods, MODEL_CLASS_DEFAULTS[cls].tiers[tier].lods);
}

export function mapSource(
	cls: ModelClass,
	tier: ModelTierId,
	map: ModelTieredMap,
	inherited: InheritedModelSettings,
	overrides: TierOverrides | undefined,
): SettingSource {
	if (overrides?.[tier]?.maps?.[map] !== undefined) return 'model';
	return inheritedSource(
		inherited.tiers[tier].maps[map],
		MODEL_CLASS_DEFAULTS[cls].tiers[tier].maps[map],
	);
}

export function encodingSource(
	cls: ModelClass,
	tier: ModelTierId,
	map: ModelTieredMap,
	inherited: InheritedModelSettings,
	overrides: TierOverrides | undefined,
): SettingSource {
	if (overrides?.[tier]?.encoding?.[map] !== undefined) return 'model';
	return inheritedSource(
		inherited.tiers[tier].encoding[map],
		MODEL_CLASS_DEFAULTS[cls].tiers[tier].encoding[map],
	);
}

export function screenSizeSource(
	cls: ModelClass,
	inherited: InheritedModelSettings,
	own: ModelLodScreenSize | undefined,
): SettingSource {
	if (own) return 'model';
	return inheritedSource(inherited.lodScreenSize, MODEL_CLASS_DEFAULTS[cls].lodScreenSize);
}

/**
 * A model's own screen sizes after its class changes: one size per level the new class has, its
 * own where it had one and the inherited one elsewhere, and a LODU size only for a class with one.
 */
export function fitScreenSize(
	own: ModelLodScreenSize,
	cls: ModelClass,
	inherited: ModelLodScreenSize,
): ModelLodScreenSize {
	const base = MODEL_CLASS_DEFAULTS[cls].lodScreenSize;
	const ultra = base.ultra === undefined ? undefined : (own.ultra ?? inherited.ultra ?? base.ultra);
	return {
		levels: base.levels.map((size, i) => own.levels[i] ?? inherited.levels[i] ?? size),
		...(ultra === undefined ? {} : { ultra }),
		cullBelow: own.cullBelow,
	};
}

/** `record`'s set keys in the maps' own order, or `undefined` when none is set. */
function inMapOrder<V>(
	record: Partial<Record<ModelTieredMap, V>> | undefined,
): Partial<Record<ModelTieredMap, V>> | undefined {
	const out: Partial<Record<ModelTieredMap, V>> = {};
	for (const map of MODEL_TIERED_MAPS) {
		const value = record?.[map];
		if (value !== undefined) out[map] = value;
	}
	return Object.keys(out).length ? out : undefined;
}

/**
 * `overrides` as a save stores it and in one key order (tiers, then `lods` / `maps` / `encoding`,
 * maps in their own order), with empty parts dropped: two equal sets of overrides read the same
 * however they were edited, so the page can tell "changed" by comparing them.
 */
export function canonicalOverrides(
	overrides: TierOverrides | undefined,
): TierOverrides | undefined {
	const out: TierOverrides = {};
	for (const tier of MODEL_TIERS) {
		const o = overrides?.[tier];
		if (!o) continue;
		const maps = inMapOrder(o.maps);
		const encoding = inMapOrder(o.encoding);
		const kept: TierOverride = {
			...(o.lods ? { lods: [o.lods[0], o.lods[1]] } : {}),
			...(maps ? { maps } : {}),
			...(encoding ? { encoding } : {}),
		};
		if (Object.keys(kept).length) out[tier] = kept;
	}
	return Object.keys(out).length ? out : undefined;
}

/** `overrides` with one tier replaced, in canonical form. */
function withTier(
	overrides: TierOverrides | undefined,
	tier: ModelTierId,
	next: TierOverride,
): TierOverrides | undefined {
	return canonicalOverrides({ ...overrides, [tier]: next });
}

const without = <K extends string, V>(
	record: Partial<Record<K, V>> | undefined,
	key: K,
): Partial<Record<K, V>> => {
	const out = { ...record };
	delete out[key];
	return out;
};

/** Set a tier's LOD window; `null` goes back to the inherited one. */
export function setLodsOverride(
	overrides: TierOverrides | undefined,
	tier: ModelTierId,
	lods: [number, number] | null,
): TierOverrides | undefined {
	const current = overrides?.[tier] ?? {};
	const rest: TierOverride = { maps: current.maps, encoding: current.encoding };
	return withTier(overrides, tier, lods ? { ...rest, lods } : rest);
}

/** Set one map's size cap (or drop it) on a tier; `null` goes back to the inherited value. */
export function setMapOverride(
	overrides: TierOverrides | undefined,
	tier: ModelTierId,
	map: ModelTieredMap,
	value: number | 'drop' | null,
): TierOverrides | undefined {
	const current = overrides?.[tier] ?? {};
	const maps = value === null ? without(current.maps, map) : { ...current.maps, [map]: value };
	return withTier(overrides, tier, { ...current, maps });
}

/** Set one map's encoding on a tier; `null` goes back to the inherited one. */
export function setEncodingOverride(
	overrides: TierOverrides | undefined,
	tier: ModelTierId,
	map: ModelTieredMap,
	value: ModelTextureEncoding | null,
): TierOverrides | undefined {
	const current = overrides?.[tier] ?? {};
	const encoding =
		value === null ? without(current.encoding, map) : { ...current.encoding, [map]: value };
	return withTier(overrides, tier, { ...current, encoding });
}

/** How many values `overrides` sets, over every tier. */
export function overrideCount(overrides: TierOverrides | undefined): number {
	let n = 0;
	for (const tier of MODEL_TIERS) {
		const o = overrides?.[tier];
		if (!o) continue;
		if (o.lods) n += 1;
		n += Object.keys(o.maps ?? {}).length + Object.keys(o.encoding ?? {}).length;
	}
	return n;
}

/** The master levels a class has, most detailed first: `_LODU` (−1) when the class has one. */
export function classLodLevels(cls: ModelClass): number[] {
	const gen = MODEL_CLASS_DEFAULTS[cls].lodGenerate as {
		tris: readonly number[];
		ultraTris?: number;
	};
	const levels = gen.tris.map((_, i) => i);
	return gen.ultraTris === undefined ? levels : [MODEL_LOD_ULTRA, ...levels];
}

export const lodLabel = (level: number): string =>
	level === MODEL_LOD_ULTRA ? 'LODU' : `LOD${level}`;

export const MODEL_TIER_LABEL: Record<ModelTierId, string> = {
	ultra: 'Ultra',
	full: 'Full',
	half: 'Half',
	quarter: 'Quarter',
};

export const TIERED_MAP_LABEL: Record<ModelTieredMap, string> = {
	baseColor: 'Base colour',
	normal: 'Normal',
	orm: 'ORM',
	emissive: 'Emissive',
};
