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
 * It draws a STAMP: one picture per zone, fitted inside the zone (its own ratio kept) and centred
 * on it, times `scale`; its picture a project sheet's frame, an Invisible Flipbook clip or (for a
 * zone family, not scenery: {@link zoneArtTakesRig}) one of the project's rigs playing one of its
 * animations. The `fill` / `edge` placements are the next phase: {@link normalizeZoneArt} drops
 * them.
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

/**
 * One of the project's rigs (`.irig`, Invisible Rigger) by its bundle name, as a character sheet's
 * rig source names it, playing one of its animations from a start the seed picks per zone
 * ({@link zoneArtPhaseFor}); looped unless `loop` is `false` (a one-shot plays once, from its
 * start, and holds its last pose).
 */
export type ZoneArtRig = { kind: 'rig'; rig: string; animation: string; loop?: false };

/**
 * A PROP COMPONENT of the project (`docs/design/arcade-prop-components.md` §6) at its pinned
 * version: a component def with a `prop` block whose zone kind is the family's (`bridge#` ⇒
 * `bridge`, {@link zoneArtPropKind}). It draws every zone of the family itself (the game's art
 * places it, not a stamp), and its collider is compiled into `arcade.online.props` on the save.
 * A family's only picture: never a variant, never scenery.
 */
export type ZoneArtComponent = { kind: 'component'; component: string; version: number };

export type ZoneArtSource = ZoneArtSprite | ZoneArtFlipbook | ZoneArtRig | ZoneArtComponent;

export const ZONE_ART_SOURCE_KINDS = Object.freeze([
	'sprite',
	'flipbook',
	'rig',
	'component',
] as const);

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

/**
 * Whether the pieces of map key `key` may be drawn with a rig: a zone family's may, a scenery
 * key's may not. Salmons draws about 430 trees, and as many rigs cost a phone several milliseconds
 * a frame and a freeze to make (`docs/design/zone-art.md` §3), where a frame or a clip costs next
 * to nothing.
 */
export const zoneArtTakesRig = (key: string): boolean => !isZoneArtScenery(key.trim());

/** The prop zone kind a family's component must compile to: the family without its `#`s. */
export const zoneArtPropKind = (family: string): string => family.trim().replace(/#/g, '');

/** One picture, or `undefined` when it cannot be drawn; a rig only where `rig` allows one, a
 *  component only where `component` does (a zone family's source). */
export function normalizeZoneArtSource(
	raw: unknown,
	rig = true,
	component = false,
): ZoneArtSource | undefined {
	if (!isObject(raw)) return undefined;
	if (raw.kind === 'component' && component) {
		const id = text(raw.component);
		const version = raw.version;
		if (!id || typeof version !== 'number' || !Number.isInteger(version) || version < 1)
			return undefined;
		return { kind: 'component', component: id, version };
	}
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
	if (raw.kind === 'rig' && rig) {
		const name = text(raw.rig);
		const animation = text(raw.animation);
		if (!name || !animation) return undefined;
		const source: ZoneArtRig = { kind: 'rig', rig: name, animation };
		if (raw.loop === false) source.loop = false;
		return source;
	}
	return undefined;
}

/** The entry of map key `key` ({@link zoneArtTakesRig}), or `undefined` when it draws nothing. */
export function normalizeZoneArtEntry(raw: unknown, key = ''): ZoneArt | undefined {
	if (!isObject(raw)) return undefined;
	const rig = zoneArtTakesRig(key);
	const source = normalizeZoneArtSource(raw.source, rig, rig);
	const placement = ZONE_ART_PLACEMENTS.find((p) => p === raw.placement);
	if (!source || !placement) return undefined;
	const art: ZoneArt = { source, placement };
	const variants = Array.isArray(raw.variants)
		? raw.variants
				.map((variant: unknown) => normalizeZoneArtSource(variant, rig))
				.filter((v): v is ZoneArtSource => v !== undefined)
				.slice(0, ZONE_ART_LIMITS.variants)
		: [];
	if (variants.length && source.kind !== 'component') art.variants = variants;
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
		const art = normalizeZoneArtEntry(entry, family);
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

/** `h` with every bit mixed into every other (murmur3's finalizer): an FNV-1a's high bits barely
 *  move between two ids that differ in their last digit (`rock1`, `rock2`). */
function mixed(h: number): number {
	h ^= h >>> 16;
	h = Math.imul(h, 0x85ebca6b);
	h ^= h >>> 13;
	h = Math.imul(h, 0xc2b2ae35);
	h ^= h >>> 16;
	return h >>> 0;
}

/**
 * Where in its animation zone `zoneId`'s rig starts in a room seeded `seed`, 0 to 1 of its length:
 * by the seed and the zone alone (another hash than the picture's, mixed), so neighbouring rigs do
 * not play in lockstep and every device starts each at the same point.
 */
export const zoneArtPhaseFor = (zoneId: string, seed: number | string): number =>
	mixed(hash(`${seed}\u0001${zoneId}`)) / 0x1_0000_0000;

/** One zone's stamp: the picture, and the box it is fitted in (world px, top-left and size): the
 *  zone's grown about its centre by `scale`. A rig's has the start of its animation (`phase`). */
export type ZoneStamp = {
	zone: string;
	family: string;
	/** Never a component: the game's art places a component itself. */
	source: Exclude<ZoneArtSource, ZoneArtComponent>;
	scale: number;
	x: number;
	y: number;
	w: number;
	h: number;
	phase?: number;
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
		const source = zoneArtSourceFor(art, zone.id, seed);
		// A component is placed by the game's own art (its prop mount), not stamped.
		if (source.kind === 'component') continue;
		stamps.push({
			zone: zone.id,
			family,
			source,
			scale,
			x: zone.x + (zone.w - w) / 2,
			y: zone.y + (zone.h - h) / 2,
			w,
			h,
			...(source.kind === 'rig' ? { phase: zoneArtPhaseFor(zone.id, seed) } : {}),
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
 * The rigs a RAW config's zone art names, for the ship chain (rule 8), by bundle name: what
 * `editorArtExport` ships as it ships a character sheet's rigs (`characterSheetRigRoots`), though
 * no scene places them. Distinct, in authored order.
 */
export function zoneArtRigRoots(rawDoc: unknown): string[] {
	const out: string[] = [];
	for (const source of sourcesOf(zoneArtOf(rawDoc)))
		if (source.kind === 'rig' && !out.includes(source.rig)) out.push(source.rig);
	return out;
}

/**
 * The art a RAW config's zone art names, as the names a published bundle lists it by
 * (`characterArt`, beside a character sheet's): each frame scoped (`<sheet>::<frame>`), then each
 * rig's bundle name. The runtime's normalizer drops zone art, so without them its boot would leave
 * their sheets and rigs unloaded as art nothing names.
 */
export const zoneArtArtNames = (rawDoc: unknown): string[] => [
	...zoneArtStillRoots(rawDoc).map((still) => `${still.assetKey}::${still.region}`),
	...zoneArtRigRoots(rawDoc),
];

/**
 * The prop components a RAW config's zone art names, by family, at their pinned versions: what the
 * save compiles into `arcade.online.props` and the ship chain (rule 8) folds into the bundle's
 * component closure (`runtimeBundle`, `editorArtExport`), though no scene places them.
 */
export function zoneArtComponentRoots(
	rawDoc: unknown,
): { family: string; component: string; version: number }[] {
	return Object.entries(zoneArtOf(rawDoc) ?? {}).flatMap(([family, art]) =>
		art.source.kind === 'component'
			? [{ family, component: art.source.component, version: art.source.version }]
			: [],
	);
}

/** Whether `map` names a rig anywhere: only then does the runtime load the rig drawing. */
export const zoneArtNamesRig = (map: ZoneArtMap | undefined): boolean =>
	sourcesOf(map).some((source) => source.kind === 'rig');

/** The clips a RAW config's zone art names, for the ship chain: `clipReachability` counts each as
 *  played. Distinct, in authored order. */
export function zoneArtClipRoots(rawDoc: unknown): string[] {
	const out: string[] = [];
	for (const source of sourcesOf(zoneArtOf(rawDoc)))
		if (source.kind === 'flipbook' && !out.includes(source.clip)) out.push(source.clip);
	return out;
}

/** A raw rig picture's issue: one that names no rig or no animation, or that a scenery key
 *  names ({@link zoneArtTakesRig}), is dropped, so not drawn. */
function rigPictureIssues(raw: unknown): GameConfigIssue[] {
	if (!isObject(raw)) return [];
	const issues: GameConfigIssue[] = [];
	for (const [key, entry] of Object.entries(raw)) {
		if (!isObject(entry)) continue;
		const variants = Array.isArray(entry.variants) ? entry.variants : [];
		const pictures: [string, unknown][] = [
			['source', entry.source],
			...variants.map((v: unknown, i): [string, unknown] => [`variants.${i}`, v]),
		];
		for (const [at, picture] of pictures) {
			if (
				isObject(picture) &&
				picture.kind === 'component' &&
				(at !== 'source' || !zoneArtTakesRig(key))
			)
				issues.push({
					severity: 'warning',
					path: `arcade.zoneArt.${key.trim()}.${at}`,
					message: `A component draws a whole zone family, as its only picture: as ${at === 'source' ? 'scenery' : 'a variant'} it is not drawn.`,
				});
			if (!isObject(picture) || picture.kind !== 'rig') continue;
			if (!zoneArtTakesRig(key)) {
				issues.push({
					severity: 'warning',
					path: `arcade.zoneArt.${key.trim()}.${at}`,
					message: `"${key.trim()}" is not drawn with a rig (as many rigs as pieces are too heavy for a phone), so this picture is not drawn: pick a sheet frame or a Flipbook clip.`,
				});
				continue;
			}
			const missing = [
				...(text(picture.rig) ? [] : ['rig']),
				...(text(picture.animation) ? [] : ['animation']),
			];
			if (missing.length)
				issues.push({
					severity: 'warning',
					path: `arcade.zoneArt.${key.trim()}.${at}`,
					message: `A rig picture names no ${missing.join(' and no ')}, so it is not drawn: name one of the project's rigs and one of its animations.`,
				});
		}
	}
	return issues;
}

/**
 * What is wrong with a config's zone art: a rig picture that names no rig or no animation, or that
 * scenery names, is not drawn (the normalizer drops it); a family none of its stored zones has
 * draws nothing, and scenery draws nothing in a game with no generator (only a generator's own art
 * places it). A game whose generator makes its zones is not checked for its families here (they
 * are its generator's; `/config` lists them from the level a seed makes).
 */
export function validateZoneArt(rawDoc: unknown): GameConfigIssue[] {
	const arcade = arcadeOf(rawDoc);
	const rigs = rigPictureIssues(arcade?.zoneArt);
	const map = zoneArtOf(rawDoc);
	const online = isObject(arcade?.online) ? arcade.online : undefined;
	if (!map || online?.generator) return rigs;
	const zones = Array.isArray(arcade?.zones) ? arcade.zones : [];
	const families = new Set(
		zones.flatMap((z) => (isObject(z) && typeof z.id === 'string' ? [zoneFamilyOf(z.id)] : [])),
	);
	return [
		...rigs,
		...Object.keys(map)
			.filter((key) => isZoneArtScenery(key) || !families.has(key))
			.map((key) => ({
				severity: 'warning' as const,
				path: `arcade.zoneArt.${key}`,
				message: isZoneArtScenery(key)
					? `"${key}" is scenery a generator's art places, and this game has no generator, so it is never drawn.`
					: `No zone of arcade.zones is of the family "${key}", so its art is never drawn.`,
			})),
	];
}
