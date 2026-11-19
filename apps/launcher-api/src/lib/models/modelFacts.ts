/**
 * What a master GLB holds, read once when it is registered and kept in its `model.json`: the
 * Invisible Model Viewer builds its report from these, so opening a model never re-reads the master.
 * Pure and import-free: the page and `modelStorage.ts` both use it.
 */
export interface ModelMasterFacts {
	/** Every mesh level: `base` is the name without its `_LOD<n>` suffix, `level` −1 is `_LODU`. */
	levels: { base: string; level: number; tris: number }[];
	textures: { name: string; w: number; h: number }[];
	clips: string[];
	/** `SK_<name>` empties, without the prefix. */
	sockets: string[];
}

/** Ceilings on what a `model.json` stores, so one odd master cannot make it large. */
const MAX_LEVELS = 256;
const MAX_TEXTURES = 64;
const MAX_NAMES = 512;
const MAX_NAME = 120;

const isObject = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === 'object' && !Array.isArray(v);
const count = (v: unknown): number =>
	typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0;
const name = (v: unknown): string => (typeof v === 'string' ? v.slice(0, MAX_NAME) : '');
const names = (v: unknown): string[] =>
	Array.isArray(v)
		? v
				.filter((n) => typeof n === 'string')
				.slice(0, MAX_NAMES)
				.map(name)
		: [];

/** Stored facts as the page reads them, or `undefined` when `raw` is not a facts object. */
export function normalizeModelFacts(raw: unknown): ModelMasterFacts | undefined {
	if (!isObject(raw) || !Array.isArray(raw.levels) || !Array.isArray(raw.textures))
		return undefined;
	return {
		levels: raw.levels
			.filter(isObject)
			.filter((l) => Number.isInteger(l.level))
			.slice(0, MAX_LEVELS)
			.map((l) => ({ base: name(l.base), level: l.level as number, tris: count(l.tris) })),
		textures: raw.textures
			.filter(isObject)
			.slice(0, MAX_TEXTURES)
			.map((t) => ({ name: name(t.name), w: count(t.w), h: count(t.h) })),
		clips: names(raw.clips),
		sockets: names(raw.sockets),
	};
}
