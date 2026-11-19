import {
	isModelClass,
	isModelTierId,
	MODEL_TIERED_MAPS,
	type ModelClass,
	type ModelLodScreenSize,
	type ModelTextureEncoding,
	type ModelTierId,
} from 'constants-shared/modelTiers';

/**
 * The model overrides as authored — a `model.json`'s and the Game Config `models` block's — read
 * the one way the export resolves them (`modelStorage.ts` `resolveModelProfile`). Free of the
 * optimizer, so the Game Config storage can keep the block without loading it.
 */

/** One tier's override: any part of the code default's profile. */
export interface ModelTierOverride {
	lods?: [number, number];
	maps?: Partial<Record<(typeof MODEL_TIERED_MAPS)[number], number | 'drop'>>;
	encoding?: Partial<Record<(typeof MODEL_TIERED_MAPS)[number], ModelTextureEncoding>>;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === 'object' && !Array.isArray(v);
const ENCODINGS: readonly ModelTextureEncoding[] = ['uastc', 'etc1s', 'png'];

export function normalizeOverride(raw: unknown): ModelTierOverride | undefined {
	if (!isObject(raw)) return undefined;
	const out: ModelTierOverride = {};
	if (
		Array.isArray(raw.lods) &&
		raw.lods.length === 2 &&
		raw.lods.every((n) => Number.isInteger(n) && n >= -1 && n <= 8)
	)
		out.lods = [raw.lods[0] as number, raw.lods[1] as number];
	if (isObject(raw.maps)) {
		const maps: ModelTierOverride['maps'] = {};
		for (const map of MODEL_TIERED_MAPS) {
			const v = raw.maps[map];
			if (v === 'drop' || (typeof v === 'number' && v >= 4 && Number.isInteger(Math.log2(v))))
				maps[map] = v;
		}
		if (Object.keys(maps).length) out.maps = maps;
	}
	if (isObject(raw.encoding)) {
		const enc: ModelTierOverride['encoding'] = {};
		for (const map of MODEL_TIERED_MAPS) {
			const v = raw.encoding[map];
			if (ENCODINGS.includes(v as ModelTextureEncoding)) enc[map] = v as ModelTextureEncoding;
		}
		if (Object.keys(enc).length) out.encoding = enc;
	}
	return Object.keys(out).length ? out : undefined;
}

export function normalizeScreenSize(raw: unknown): ModelLodScreenSize | undefined {
	if (!isObject(raw) || !Array.isArray(raw.levels)) return undefined;
	const levels = raw.levels.filter((n): n is number => typeof n === 'number' && n >= 0 && n <= 4);
	const cull = typeof raw.cullBelow === 'number' && raw.cullBelow >= 0 ? raw.cullBelow : 0;
	if (!levels.length) return undefined;
	return {
		levels,
		...(typeof raw.ultra === 'number' && raw.ultra > 0 ? { ultra: raw.ultra } : {}),
		cullBelow: cull,
	};
}

/** The Game Config's `models` block: per-class tier overrides and LOD screen sizes. */
export interface GameConfigModels {
	profiles?: Partial<Record<ModelClass, Partial<Record<ModelTierId, ModelTierOverride>>>>;
	lodScreenSize?: Partial<Record<ModelClass, ModelLodScreenSize>>;
}

/**
 * The `models` block as {@link resolveModelProfile} / {@link resolveLodScreenSize} read it: only
 * what they would use, so resolving the result equals resolving the raw block. `undefined` when
 * nothing usable is left. Kept by the Game Config save and load (`gameConfig3d.ts`).
 */
export function normalizeGameConfigModels(raw: unknown): GameConfigModels | undefined {
	if (!isObject(raw)) return undefined;
	const out: GameConfigModels = {};
	if (isObject(raw.profiles)) {
		const profiles: NonNullable<GameConfigModels['profiles']> = {};
		for (const [cls, tiers] of Object.entries(raw.profiles)) {
			if (!isModelClass(cls) || !isObject(tiers)) continue;
			const kept: Partial<Record<ModelTierId, ModelTierOverride>> = {};
			for (const [tier, override] of Object.entries(tiers)) {
				const o = isModelTierId(tier) ? normalizeOverride(override) : undefined;
				if (o) kept[tier as ModelTierId] = o;
			}
			if (Object.keys(kept).length) profiles[cls] = kept;
		}
		if (Object.keys(profiles).length) out.profiles = profiles;
	}
	if (isObject(raw.lodScreenSize)) {
		const sizes: NonNullable<GameConfigModels['lodScreenSize']> = {};
		for (const [cls, size] of Object.entries(raw.lodScreenSize)) {
			const s = isModelClass(cls) ? normalizeScreenSize(size) : undefined;
			if (s) sizes[cls as ModelClass] = s;
		}
		if (Object.keys(sizes).length) out.lodScreenSize = sizes;
	}
	return Object.keys(out).length ? out : undefined;
}
