import { isObject, num } from './normalizeParts';
import type { GameConfigIssue } from './validate';

/**
 * ZONE ART (`docs/design/zone-art.md`): what an arcade game's zones are drawn with, by zone FAMILY
 * (`arcade.zoneArt`). A family is a zone id with its numbers as `#` ({@link zoneFamilyOf}), so
 * `rock0` … `rock99` are the one family `rock#`, as `/config`'s Zones chips group them. A few
 * reserved keys name scenery a generator's art places on no zone ({@link ZONE_ART_SCENERY}).
 *
 * Cosmetic: no rule, no room and no fingerprint reads it (a device and its room agree on a level
 * whatever art it is drawn with). A family with no entry draws exactly as it did without one.
 *
 * Phase 1 draws a STAMP: one picture per zone, fitted inside the zone (its own ratio kept) and
 * centred on it, times `scale`; its picture a project sheet's frame or an Invisible Flipbook clip.
 * A rig source and the `fill` / `edge` placements are the next phase: {@link normalizeZoneArt}
 * drops them.
 *
 * CARRIED, NOT NORMALIZED (as `arcade.online.slide` and the touch schemes are): the config's
 * normalizer drops the field, the launcher's save puts the normalized map back ({@link withZoneArt}),
 * and the arcade runtime reads it off the baked config ({@link zoneArtOf}). So the normalizer every
 * runtime carries is unchanged, and no runtime but an arcade one carries a byte of this module
 * (`check:runtime-bytes`). Plain functions and literals, no top-level calls.
 */

/** A frame of a project sheet, as the region picker stores it: `<manifest key>::<frame>`. */
export type ZoneArtSprite = { kind: 'sprite'; region: string };

/** An Invisible Flipbook clip by id, looped; `fps` overrides the clip's own. */
export type ZoneArtFlipbook = { kind: 'flipbook'; clip: string; fps?: number };

export type ZoneArtSource = ZoneArtSprite | ZoneArtFlipbook;

export const ZONE_ART_SOURCE_KINDS = Object.freeze(['sprite', 'flipbook'] as const);

export const ZONE_ART_PLACEMENTS = Object.freeze(['stamp'] as const);

export type ZoneArtPlacement = (typeof ZONE_ART_PLACEMENTS)[number];

export type ZoneArt = {
	source: ZoneArtSource;
	/** More pictures: each zone of the family draws one of `[source, ...variants]`, chosen by the
	 *  room's seed and the zone's id ({@link zoneArtSourceFor}), the same on every device. */
	variants?: ZoneArtSource[];
	placement: ZoneArtPlacement;
	/** Times the fitted size. Absent ⇒ 1. */
	scale?: number;
};

export type ZoneArtMap = Record<string, ZoneArt>;

export const ZONE_ART_LIMITS = Object.freeze({
	families: 64,
	variants: 8,
	scale: Object.freeze({ min: 0.05, max: 20 }),
	fps: Object.freeze({ min: 1, max: 60 }),
});

/** A zone id's family: its numbers as `#` (`band12Water` → `band#Water`, `source` → `source`). */
export const zoneFamilyOf = (id: string): string => id.replace(/\d+/g, '#');

/**
 * The SCENERY keys of the map: pieces a generator's own art places itself, on no zone (Salmons'
 * forest trees, `@trees`), drawn as a family's stamps are, picked per piece by the seed and its
 * cell ({@link sceneryArtSourceFor}). No zone a generator makes has an `@` in its id, `/config`
 * refuses one in a zone it edits, and {@link zoneArtStamps} stamps no zone of such a family.
 */
export const ZONE_ART_SCENERY = Object.freeze(['@trees'] as const);

export type ZoneArtScenery = (typeof ZONE_ART_SCENERY)[number];

export const isZoneArtScenery = (key: string): key is ZoneArtScenery =>
	(ZONE_ART_SCENERY as readonly string[]).includes(key);

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** A frame ref the runtime can scope by: a sheet and a frame either side of `::`. */
const isFrameRef = (ref: string): boolean => {
	const at = ref.indexOf('::');
	return at > 0 && at + 2 < ref.length;
};

export function normalizeZoneArtSource(raw: unknown): ZoneArtSource | undefined {
	if (!isObject(raw)) return undefined;
	if (raw.kind === 'sprite') {
		const region = text(raw.region);
		return isFrameRef(region) ? { kind: 'sprite', region } : undefined;
	}
	if (raw.kind === 'flipbook') {
		const clip = text(raw.clip);
		if (!clip) return undefined;
		const source: ZoneArtFlipbook = { kind: 'flipbook', clip };
		const fps = num(raw.fps);
		const { min, max } = ZONE_ART_LIMITS.fps;
		if (fps !== undefined && fps >= min && fps <= max) source.fps = fps;
		return source;
	}
	return undefined;
}

export function normalizeZoneArtEntry(raw: unknown): ZoneArt | undefined {
	if (!isObject(raw)) return undefined;
	const source = normalizeZoneArtSource(raw.source);
	const placement = ZONE_ART_PLACEMENTS.find((p) => p === raw.placement);
	if (!source || !placement) return undefined;
	const art: ZoneArt = { source, placement };
	const variants = Array.isArray(raw.variants)
		? raw.variants
				.map(normalizeZoneArtSource)
				.filter((v): v is ZoneArtSource => v !== undefined)
				.slice(0, ZONE_ART_LIMITS.variants)
		: [];
	if (variants.length) art.variants = variants;
	const scale = num(raw.scale);
	const { min, max } = ZONE_ART_LIMITS.scale;
	if (scale !== undefined && scale !== 1 && scale >= min && scale <= max) art.scale = scale;
	return art;
}

/** `arcade.zoneArt` with only usable entries, keyed by family; `undefined` when none is. */
export function normalizeZoneArt(raw: unknown): ZoneArtMap | undefined {
	if (!isObject(raw)) return undefined;
	const out: ZoneArtMap = {};
	for (const [key, entry] of Object.entries(raw)) {
		const family = key.trim();
		if (!family || family in out) continue;
		if (Object.keys(out).length >= ZONE_ART_LIMITS.families) break;
		const art = normalizeZoneArtEntry(entry);
		if (art) out[family] = art;
	}
	return Object.keys(out).length ? out : undefined;
}

/** A 32-bit FNV-1a of `s`: whole-number arithmetic only, so every device picks alike. */
function hash(s: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

/** The picture zone `zoneId` of a room seeded `seed` draws, of `art`'s source and variants. */
export function zoneArtSourceFor(
	art: ZoneArt,
	zoneId: string,
	seed: number | string,
): ZoneArtSource {
	const pool = [art.source, ...(art.variants ?? [])];
	return pool.length === 1 ? art.source : pool[hash(`${seed}\u0000${zoneId}`) % pool.length];
}

/** The picture a piece of scenery at cell (`c`, `r`) of a room seeded `seed` draws, of `art`'s
 *  source and variants: by the seed and the cell alone, the same on every device. */
export const sceneryArtSourceFor = (
	art: ZoneArt,
	c: number,
	r: number,
	seed: number | string,
): ZoneArtSource => zoneArtSourceFor(art, `${c},${r}`, seed);

/** One zone's stamp: the picture, and the box it is fitted in (world px, top-left and size): the
 *  zone's grown about its centre by `scale`. */
export type ZoneStamp = {
	zone: string;
	family: string;
	source: ZoneArtSource;
	scale: number;
	x: number;
	y: number;
	w: number;
	h: number;
};

/**
 * Every stamp `zones` draw with `map` in a room seeded `seed`, in the zones' order: a zone whose
 * family has an entry, its box the zone's grown about its centre by the entry's `scale`. Empty
 * for an empty or absent map. A scenery key is no zone's family.
 */
export function zoneArtStamps(
	zones: readonly { id: string; x: number; y: number; w: number; h: number }[],
	map: ZoneArtMap | undefined,
	seed: number | string,
): ZoneStamp[] {
	if (!map) return [];
	const stamps: ZoneStamp[] = [];
	for (const zone of zones) {
		const family = zoneFamilyOf(zone.id);
		if (isZoneArtScenery(family)) continue;
		const art = Object.hasOwn(map, family) ? map[family] : undefined;
		if (!art) continue;
		const scale = art.scale ?? 1;
		const w = zone.w * scale;
		const h = zone.h * scale;
		stamps.push({
			zone: zone.id,
			family,
			source: zoneArtSourceFor(art, zone.id, seed),
			scale,
			x: zone.x + (zone.w - w) / 2,
			y: zone.y + (zone.h - h) / 2,
			w,
			h,
		});
	}
	return stamps;
}

/** Every source an entry can draw. */
const sourcesOf = (map: ZoneArtMap | undefined): ZoneArtSource[] =>
	Object.values(map ?? {}).flatMap((art) => [art.source, ...(art.variants ?? [])]);

const arcadeOf = (rawDoc: unknown): Record<string, unknown> | undefined => {
	const arcade = isObject(rawDoc) ? rawDoc.arcade : undefined;
	return isObject(arcade) ? arcade : undefined;
};

/** A RAW config's zone art, normalized: what the runtime draws. */
export const zoneArtOf = (rawDoc: unknown): ZoneArtMap | undefined =>
	normalizeZoneArt(arcadeOf(rawDoc)?.zoneArt);

/**
 * `doc` (normalized from `rawDoc`) with `rawDoc`'s zone art put back, normalized, on an arcade
 * config; `doc` itself when there is none or the config is not arcade.
 */
export function withZoneArt<T>(doc: T, rawDoc: unknown): T {
	const map = zoneArtOf(rawDoc);
	if (!map || !isObject(doc) || doc.family !== 'arcade') return doc;
	const arcade = isObject(doc.arcade) ? doc.arcade : {};
	return { ...doc, arcade: { ...arcade, zoneArt: map } };
}

/**
 * The frames a RAW config's zone art names, for the ship chain (rule 8), as the sheet and the
 * frame: what `editorArtExport` ships though no scene places them. Distinct, in authored order.
 */
export function zoneArtStillRoots(rawDoc: unknown): { assetKey: string; region: string }[] {
	const out: { assetKey: string; region: string }[] = [];
	for (const source of sourcesOf(zoneArtOf(rawDoc))) {
		if (source.kind !== 'sprite') continue;
		const at = source.region.indexOf('::');
		const still = { assetKey: source.region.slice(0, at), region: source.region.slice(at + 2) };
		if (!out.some((s) => s.assetKey === still.assetKey && s.region === still.region))
			out.push(still);
	}
	return out;
}

/**
 * The frames a RAW config's zone art names, as the scoped names a published bundle lists them by
 * (`characterArt`, beside a character sheet's): the runtime's normalizer drops zone art, so
 * without them its boot would leave their sheets unloaded as art nothing names.
 */
export const zoneArtArtNames = (rawDoc: unknown): string[] =>
	zoneArtStillRoots(rawDoc).map((still) => `${still.assetKey}::${still.region}`);

/** The clips a RAW config's zone art names, for the ship chain: `clipReachability` counts each as
 *  played. Distinct, in authored order. */
export function zoneArtClipRoots(rawDoc: unknown): string[] {
	const out: string[] = [];
	for (const source of sourcesOf(zoneArtOf(rawDoc)))
		if (source.kind === 'flipbook' && !out.includes(source.clip)) out.push(source.clip);
	return out;
}

/**
 * What is wrong with a config's zone art: a family none of its stored zones has draws nothing, and
 * scenery draws nothing in a game with no generator (only a generator's own art places it). A
 * game whose generator makes its zones is not checked here (its families are its generator's;
 * `/config` lists them from the level a seed makes).
 */
export function validateZoneArt(rawDoc: unknown): GameConfigIssue[] {
	const map = zoneArtOf(rawDoc);
	const arcade = arcadeOf(rawDoc);
	const online = isObject(arcade?.online) ? arcade.online : undefined;
	if (!map || online?.generator) return [];
	const zones = Array.isArray(arcade?.zones) ? arcade.zones : [];
	const families = new Set(
		zones.flatMap((z) => (isObject(z) && typeof z.id === 'string' ? [zoneFamilyOf(z.id)] : [])),
	);
	return Object.keys(map)
		.filter((key) => isZoneArtScenery(key) || !families.has(key))
		.map((key) => ({
			severity: 'warning' as const,
			path: `arcade.zoneArt.${key}`,
			message: isZoneArtScenery(key)
				? `"${key}" is scenery a generator's art places, and this game has no generator, so it is never drawn.`
				: `No zone of arcade.zones is of the family "${key}", so its art is never drawn.`,
		}));
}
